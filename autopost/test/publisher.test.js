import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { publishPost, contentHash } from '../src/publisher.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger({ level: 'silent', color: false });

function harness(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-test-'));
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir, ...overrides } });
  config.dataDir = dir;
  const store = new Store(dir);
  return { config, store, logger: silent, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A stand-in adapter, injected via ctx.targets, so the suite never touches
// a real network or needs real credentials.
function fakeAdapter(id, behaviour = {}) {
  let calls = 0;
  return {
    id,
    label: id,
    tier: 'api',
    limits: { text: behaviour.limit ?? 280 },
    verified: true,
    missing: () => [],
    configured: () => true,
    skipReason: behaviour.skipReason,
    get calls() { return calls; },
    async publish() {
      calls += 1;
      if (behaviour.failTimes && calls <= behaviour.failTimes) {
        const err = new Error(`${id} transient failure ${calls}`);
        err.retryable = true;
        throw err;
      }
      if (behaviour.alwaysFail) {
        const err = new Error(`${id} permanent failure`);
        err.retryable = false;
        throw err;
      }
      return { id: `${id}-123`, url: `https://example.test/${id}/123` };
    },
  };
}

const body = (text = 'test body') => ({ id: null, text, media: [] });

test('contentHash ignores whitespace and case differences', () => {
  assert.equal(
    contentHash({ text: 'Hello  World', link: 'https://a.test' }),
    contentHash({ text: 'hello world', link: 'https://a.test' }),
  );
  assert.notEqual(
    contentHash({ text: 'Hello world', link: 'https://a.test' }),
    contentHash({ text: 'Hello world!', link: 'https://a.test' }),
  );
});

test('dry run previews every platform and sends nothing', async () => {
  const h = harness({ DRY_RUN: 'true' });
  const a = fakeAdapter('alpha');
  const b = fakeAdapter('beta');
  const result = await publishPost(body(), { ...h, targets: [a, b], dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((r) => r.dryRun === true));
  assert.equal(a.calls, 0, 'dry run must not call publish()');
  assert.equal(b.calls, 0);
  assert.equal(h.store.data.history.length, 0, 'dry run must not write history');
  h.cleanup();
});

test('dry run flags content that exceeds a platform limit', async () => {
  const h = harness();
  const tight = fakeAdapter('tight', { limit: 20 });
  const result = await publishPost(body('x'.repeat(100)), { ...h, targets: [tight], dryRun: true });

  assert.equal(result.results[0].wouldTruncate, true);
  assert.equal(result.results[0].chars, 100);
  assert.equal(result.results[0].limit, 20);
  h.cleanup();
});

test('a live run publishes to every platform and records history', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0' });
  const a = fakeAdapter('alpha');
  const b = fakeAdapter('beta');
  const result = await publishPost(body('live body'), { ...h, targets: [a, b], dryRun: false });

  assert.equal(result.delivered, 2);
  assert.equal(result.failed, 0);
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 1);
  assert.equal(h.store.data.history.length, 1);
  assert.equal(h.store.data.history[0].anySuccess, true);
  assert.equal(h.store.platform('alpha').successes, 1);
  assert.ok(h.store.platform('alpha').lastPostedAt);
  h.cleanup();
});

test('one platform failing does not stop the others', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '1' });
  const bad = fakeAdapter('bad', { alwaysFail: true });
  const good = fakeAdapter('good');
  const result = await publishPost(body('partial'), { ...h, targets: [bad, good], dryRun: false });

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.anySuccess, true);
  assert.equal(good.calls, 1, 'the good platform still ran after the bad one failed');
  h.cleanup();
});

test('FAIL_OPEN=false stops the run at the first failure', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '1', FAIL_OPEN: 'false' });
  const bad = fakeAdapter('bad', { alwaysFail: true });
  const never = fakeAdapter('never');
  await publishPost(body('halt'), { ...h, targets: [bad, never], dryRun: false });

  assert.equal(never.calls, 0, 'the second platform must not be attempted');
  h.cleanup();
});

test('retries a transient failure and then succeeds', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '3', RETRY_BASE_MS: '1' });
  const flaky = fakeAdapter('flaky', { failTimes: 2 });
  const result = await publishPost(body('retry me'), { ...h, targets: [flaky], dryRun: false });

  assert.equal(result.delivered, 1);
  assert.equal(flaky.calls, 3);
  assert.equal(result.results[0].attempt, 3);
  h.cleanup();
});

test('gives up after MAX_ATTEMPTS', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '2', RETRY_BASE_MS: '1' });
  const broken = fakeAdapter('broken', { failTimes: 99 });
  const result = await publishPost(body('nope'), { ...h, targets: [broken], dryRun: false });

  assert.equal(result.failed, 1);
  assert.equal(broken.calls, 2);
  h.cleanup();
});

test('a non-retryable error is attempted only once', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '5', RETRY_BASE_MS: '1' });
  const hard = fakeAdapter('hard', { alwaysFail: true });
  await publishPost(body(), { ...h, targets: [hard], dryRun: false });

  assert.equal(hard.calls, 1, 'retryable:false must not be retried');
  h.cleanup();
});

test('the duplicate guard blocks a repeat and force overrides it', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', DUPLICATE_WINDOW_HOURS: '72' });
  const a = fakeAdapter('alpha');
  const post = body('same exact words');

  const first = await publishPost(post, { ...h, targets: [a], dryRun: false });
  assert.equal(first.delivered, 1);

  const second = await publishPost(post, { ...h, targets: [a], dryRun: false });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'duplicate');
  assert.equal(a.calls, 1, 'the duplicate must not reach the platform');

  const forced = await publishPost(post, { ...h, targets: [a], dryRun: false, force: true });
  assert.equal(forced.delivered, 1);
  assert.equal(a.calls, 2);
  h.cleanup();
});

test('the duplicate guard does not apply to a dry run', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0' });
  const a = fakeAdapter('alpha');
  const post = body('previewed twice');
  await publishPost(post, { ...h, targets: [a], dryRun: false });
  const preview = await publishPost(post, { ...h, targets: [a], dryRun: true });

  assert.equal(preview.skipped, false, 'a preview of already-posted content is still useful');
  h.cleanup();
});

test('the minimum gap holds a platform back, and force overrides it', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '60' });
  const a = fakeAdapter('alpha');
  h.store.markPlatform('alpha', { ok: true, at: new Date(Date.now() - 10 * 60_000).toISOString() });

  const held = await publishPost(body('too soon'), { ...h, targets: [a], dryRun: false });
  assert.equal(held.results[0].skipped, true);
  assert.match(held.results[0].reason, /min gap/);
  assert.equal(a.calls, 0);

  const forced = await publishPost(body('override'), { ...h, targets: [a], dryRun: false, force: true });
  assert.equal(forced.delivered, 1);
  h.cleanup();
});

test('skipReason excludes a platform without failing the run', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0' });
  const videoOnly = fakeAdapter('videoOnly', { skipReason: () => 'no video attached' });
  const text = fakeAdapter('text');
  const result = await publishPost(body('words only'), { ...h, targets: [videoOnly, text], dryRun: false });

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0, 'a skip is not a failure');
  assert.equal(videoOnly.calls, 0);
  assert.equal(result.results.find((r) => r.platform === 'videoOnly').skipped, true);
  h.cleanup();
});

test('a queued post is marked published and keeps its results', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0' });
  const a = fakeAdapter('alpha');
  const queued = h.store.addPost({ text: 'from the queue' });
  await publishPost(queued, { ...h, targets: [a], dryRun: false });

  const after = h.store.getPost(queued.id);
  assert.equal(after.status, 'published');
  assert.ok(after.publishedAt);
  assert.equal(after.results.length, 1);
  h.cleanup();
});

test('a post that fails everywhere is marked failed, not published', async () => {
  const h = harness({ DRY_RUN: 'false', MIN_GAP_MINUTES: '0', MAX_ATTEMPTS: '1' });
  const bad = fakeAdapter('bad', { alwaysFail: true });
  const queued = h.store.addPost({ text: 'doomed' });
  await publishPost(queued, { ...h, targets: [bad], dryRun: false });

  assert.equal(h.store.getPost(queued.id).status, 'failed');
  assert.equal(h.store.data.history[0].anySuccess, false);
  h.cleanup();
});

test('reports no-targets rather than throwing when nothing is configured', async () => {
  const h = harness({ DRY_RUN: 'false' });
  const result = await publishPost(body(), { ...h, targets: [], dryRun: false });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no-targets');
  h.cleanup();
});
