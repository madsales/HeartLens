import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scheduler } from '../src/scheduler.js';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger({ level: 'silent', color: false });

function harness(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-sched-'));
  const config = loadConfig({
    envFile: join(dir, 'none.env'),
    overrides: { DATA_DIR: dir, DRY_RUN: 'true', MIN_GAP_MINUTES: '0', ...overrides },
  });
  config.dataDir = dir;
  const store = new Store(dir);
  return {
    dir, config, store,
    scheduler: new Scheduler({ config, store, logger: silent }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('an invalid SCHEDULE fails loudly at construction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-sched-bad-'));
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir, SCHEDULE: 'every tuesday' } });
  assert.throws(() => new Scheduler({ config, store: new Store(dir), logger: silent }), /cron expression/);
  rmSync(dir, { recursive: true, force: true });
});

test('describe() reports the schedule and the next run', () => {
  const h = harness({ SCHEDULE: '0 9 * * *', TIMEZONE: 'Europe/Berlin' });
  const d = h.scheduler.describe();
  assert.equal(d.schedule, '0 9 * * *');
  assert.equal(d.timezone, 'Europe/Berlin');
  assert.ok(d.nextRunAt);
  assert.equal(d.running, false);
  h.cleanup();
});

test('a tick off-schedule does nothing', async () => {
  const h = harness({ SCHEDULE: '0 9 * * *' });
  const result = await h.scheduler.tick(new Date('2026-10-03T14:23:00Z'));
  assert.equal(result.fired, false);
  h.cleanup();
});

test('a tick on-schedule fires, and the same minute does not fire twice', async () => {
  const h = harness({ SCHEDULE: '0 9 * * *' });
  const at = new Date('2026-10-03T09:00:00Z');

  const first = await h.scheduler.tick(at);
  assert.equal(first.fired, true);
  assert.equal(first.trigger, 'cron');

  // A second tick in the same minute must be ignored, or a 30-second tick
  // interval would post twice.
  const second = await h.scheduler.tick(new Date('2026-10-03T09:00:45Z'));
  assert.equal(second.fired, false);

  // The next day's slot fires again.
  const nextDay = await h.scheduler.tick(new Date('2026-10-04T09:00:00Z'));
  assert.equal(nextDay.fired, true);
  h.cleanup();
});

test('a post scheduled for the past fires even when cron does not match', async () => {
  const h = harness({ SCHEDULE: '0 9 * * *' });
  h.store.addPost({ text: 'due now', scheduledAt: '2026-10-03T10:00:00Z' });

  const result = await h.scheduler.tick(new Date('2026-10-03T14:23:00Z'));
  assert.equal(result.fired, true);
  assert.equal(result.trigger, 'scheduled-post');
  h.cleanup();
});

test('a future post is left alone', async () => {
  const h = harness({ SCHEDULE: '0 9 * * *' });
  h.store.addPost({ text: 'later', scheduledAt: '2026-12-25T10:00:00Z' });
  const result = await h.scheduler.tick(new Date('2026-10-03T14:23:00Z'));
  assert.equal(result.fired, false);
  h.cleanup();
});

test('an empty queue falls back to the content pack', async () => {
  const h = harness({ RECYCLE_CONTENT: 'true' });
  const result = await h.scheduler.runOnce();
  assert.equal(result.runs.length, 1);
  assert.equal(h.store.data.cursor, 1, 'the rotation cursor advanced');
  h.cleanup();
});

test('RECYCLE_CONTENT=false posts nothing when the queue is empty', async () => {
  const h = harness({ RECYCLE_CONTENT: 'false' });
  const result = await h.scheduler.runOnce();
  assert.equal(result.runs.length, 0);
  assert.equal(result.reason, 'queue-empty');
  h.cleanup();
});

test('MAX_PER_RUN caps how many queued posts go out at once', async () => {
  const h = harness({ MAX_PER_RUN: '2' });
  for (const text of ['one', 'two', 'three', 'four']) h.store.addPost({ text });
  const result = await h.scheduler.runOnce();
  assert.equal(result.runs.length, 2);
  h.cleanup();
});

test('a real run publishes queued posts to the outbox and empties the queue', async () => {
  const h = harness({ DRY_RUN: 'false', MAX_PER_RUN: '3' });
  for (const text of ['alpha post body', 'beta post body']) h.store.addPost({ text });

  await h.scheduler.runOnce();
  assert.equal(h.store.queued().length, 0, 'both posts left the queue');
  assert.equal(readdirSync(join(h.dir, 'outbox')).length, 2);
  assert.equal(h.store.data.history.length, 2);
  h.cleanup();
});

test('start and stop are idempotent and do not leave a timer behind', () => {
  const h = harness();
  h.scheduler.start();
  assert.equal(h.scheduler.running, true);
  h.scheduler.start(); // second call is a no-op
  h.scheduler.stop();
  assert.equal(h.scheduler.running, false);
  assert.equal(h.scheduler.timer, null);
  h.scheduler.stop(); // safe to call again
  h.cleanup();
});

test('an overlapping tick is skipped rather than running twice', async () => {
  const h = harness({ SCHEDULE: '* * * * *' });
  h.scheduler.busy = true;
  const result = await h.scheduler.tick(new Date());
  assert.equal(result.fired, false);
  assert.equal(result.reason, 'busy');
  h.cleanup();
});
