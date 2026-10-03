import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { Scheduler } from '../src/scheduler.js';

const silent = createLogger({ level: 'silent', color: false });

// Boots the real HTTP server on an ephemeral port and returns a fetch helper.
async function boot(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-server-'));
  const config = loadConfig({
    envFile: join(dir, 'none.env'),
    overrides: { DATA_DIR: dir, DRY_RUN: 'true', MIN_GAP_MINUTES: '0', ...overrides },
  });
  config.dataDir = dir;
  const store = new Store(dir);
  const scheduler = new Scheduler({ config, store, logger: silent });
  const server = createApp({ config, store, logger: silent, scheduler });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['content-type'] = 'application/json';
    if (config.dashboardToken && !headers.authorization) headers.authorization = `Bearer ${config.dashboardToken}`;
    const res = await fetch(`${base}${path}`, { ...options, headers });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* static assets are not JSON */ }
    return { status: res.status, body, contentType: res.headers.get('content-type') };
  };

  return {
    call, base, store, config, dir,
    cleanup: () => { server.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('GET /api/status reports mode, schedule and platforms', async () => {
  const s = await boot();
  const { status, body } = await s.call('/api/status');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.ok(Array.isArray(body.platforms));
  assert.ok(body.platforms.length >= 15, 'every adapter should be listed');
  assert.equal(body.schedule.valid, true);
  assert.ok(body.schedule.next, 'a next run time is computed');
  assert.ok(body.pack.total > 0);
  s.cleanup();
});

test('the dashboard page and its assets are served', async () => {
  const s = await boot();
  const page = await s.call('/');
  assert.equal(page.status, 200);
  assert.match(page.contentType, /text\/html/);
  assert.match(page.body, /HeartLens Auto-Poster/);
  assert.match(page.body, /big-post/, 'the one-click button is present');

  for (const [path, type] of [['/app.js', /javascript/], ['/styles.css', /css/]]) {
    const asset = await s.call(path);
    assert.equal(asset.status, 200, `${path} should be served`);
    assert.match(asset.contentType, type);
  }
  s.cleanup();
});

test('a directory-traversal attempt is refused', async () => {
  const s = await boot();
  for (const path of ['/../package.json', '/../../etc/passwd', '/..%2fpackage.json']) {
    const res = await s.call(path);
    assert.ok(res.status === 403 || res.status === 404, `${path} returned ${res.status}`);
    assert.ok(!String(res.body).includes('heartlens-autopost'), `${path} leaked package.json`);
  }
  s.cleanup();
});

test('POST /api/post-now runs a dry-run fan-out with no credentials', async () => {
  const s = await boot();
  const { status, body } = await s.call('/api/post-now', {
    method: 'POST',
    body: JSON.stringify({ text: 'Hello from the test suite' }),
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.result.dryRun, true);
  assert.ok(body.result.results.length >= 1);
  assert.equal(body.result.results[0].platform, 'outbox');
  s.cleanup();
});

test('a live one-click post with no credentials still writes the outbox file', async () => {
  const s = await boot({ DRY_RUN: 'false' });
  const { body } = await s.call('/api/post-now', {
    method: 'POST',
    body: JSON.stringify({ text: 'Real send, outbox only', dryRun: false }),
  });
  assert.equal(body.result.delivered, 1);
  assert.equal(body.result.anySuccess, true);
  const files = readdirSync(join(s.dir, 'outbox'));
  assert.equal(files.length, 1, 'the post was written to the outbox');
  s.cleanup();
});

test('an empty one-click post falls back to the content pack', async () => {
  const s = await boot();
  const { body } = await s.call('/api/post-now', { method: 'POST', body: JSON.stringify({}) });
  assert.ok(body.post.title, 'a pack item was chosen');
  assert.ok(body.post.text.length > 20);
  s.cleanup();
});

test('queue add, list and delete round-trip', async () => {
  const s = await boot();
  const added = await s.call('/api/queue', { method: 'POST', body: JSON.stringify({ text: 'queued item' }) });
  assert.equal(added.status, 200);
  const id = added.body.post.id;

  const listed = await s.call('/api/queue');
  assert.equal(listed.body.posts.length, 1);

  const removed = await s.call('/api/queue/delete', { method: 'POST', body: JSON.stringify({ id }) });
  assert.equal(removed.status, 200);
  assert.equal((await s.call('/api/queue')).body.posts.length, 0);
  s.cleanup();
});

test('queueing with no text is rejected', async () => {
  const s = await boot();
  const res = await s.call('/api/queue', { method: 'POST', body: JSON.stringify({ title: 'no body' }) });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  s.cleanup();
});

test('fill-from-pack loads the whole pack into the queue', async () => {
  const s = await boot();
  const res = await s.call('/api/queue/fill-from-pack', { method: 'POST', body: JSON.stringify({}) });
  assert.ok(res.body.added >= 5);
  assert.equal((await s.call('/api/queue')).body.posts.length, res.body.added);
  s.cleanup();
});

test('fill-from-pack can space posts out over time', async () => {
  const s = await boot();
  const startAt = '2026-11-01T09:00:00.000Z';
  await s.call('/api/queue/fill-from-pack', {
    method: 'POST',
    body: JSON.stringify({ startAt, spacingMinutes: 120 }),
  });
  const posts = (await s.call('/api/queue')).body.posts.filter((p) => p.scheduledAt).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  assert.equal(posts[0].scheduledAt, startAt);
  const gapMs = new Date(posts[1].scheduledAt) - new Date(posts[0].scheduledAt);
  assert.equal(gapMs, 120 * 60_000);
  s.cleanup();
});

test('POST /api/run-now executes one scheduled cycle', async () => {
  const s = await boot();
  const res = await s.call('/api/run-now', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.fired, true);
  assert.equal(res.body.result.runs.length, 1);
  s.cleanup();
});

test('an unknown route and an unknown method give a clean 404', async () => {
  const s = await boot();
  assert.equal((await s.call('/api/nope')).status, 404);
  assert.equal((await s.call('/api/status', { method: 'DELETE' })).status, 404);
  s.cleanup();
});

test('malformed JSON produces an error, not a crash', async () => {
  const s = await boot();
  const res = await fetch(`${s.base}/api/queue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /not valid JSON/);
  // The server is still alive afterwards.
  assert.equal((await s.call('/api/status')).status, 200);
  s.cleanup();
});

test('DASHBOARD_TOKEN gates the API but not the static page', async () => {
  const s = await boot({ DASHBOARD_TOKEN: 'super-secret-token' });

  const noAuth = await fetch(`${s.base}/api/status`);
  assert.equal(noAuth.status, 401);

  const wrong = await fetch(`${s.base}/api/status`, { headers: { authorization: 'Bearer wrong' } });
  assert.equal(wrong.status, 401);

  const right = await fetch(`${s.base}/api/status`, { headers: { authorization: 'Bearer super-secret-token' } });
  assert.equal(right.status, 200);

  const viaQuery = await fetch(`${s.base}/api/status?token=super-secret-token`);
  assert.equal(viaQuery.status, 200, 'the dashboard passes the token as a query parameter');

  assert.equal((await fetch(`${s.base}/`)).status, 200, 'the page itself still loads');
  s.cleanup();
});

test('API responses never echo a credential back', async () => {
  const s = await boot({ TELEGRAM_BOT_TOKEN: 'secret-bot-token-value', TELEGRAM_CHAT_ID: '@chan' });
  const serialised = JSON.stringify((await s.call('/api/status')).body);
  assert.ok(!serialised.includes('secret-bot-token-value'), 'the bot token leaked into /api/status');

  const platforms = JSON.stringify((await s.call('/api/platforms')).body);
  assert.ok(!platforms.includes('secret-bot-token-value'), 'the bot token leaked into /api/platforms');
  s.cleanup();
});

test('post-now with an empty platform list sends to nothing', async () => {
  const s = await boot({ DRY_RUN: 'false' });
  const { body } = await s.call('/api/post-now', {
    method: 'POST',
    body: JSON.stringify({ text: 'should reach nobody', platforms: [], dryRun: false }),
  });
  assert.equal(body.result.skipped, true);
  assert.equal(body.result.reason, 'no-targets');
  assert.ok(!readdirSync(s.dir).includes('outbox'), 'nothing was written');
  s.cleanup();
});
