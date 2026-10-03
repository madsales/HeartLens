import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'heartlens-store-'));

test('creates its file and survives a reopen', () => {
  const dir = fresh();
  const a = new Store(dir);
  const post = a.addPost({ text: 'persist me' });

  const b = new Store(dir);
  assert.equal(b.getPost(post.id).text, 'persist me');
  rmSync(dir, { recursive: true, force: true });
});

test('recovers from a corrupt store and keeps a backup', () => {
  const dir = fresh();
  new Store(dir);
  writeFileSync(join(dir, 'store.json'), '{ this is not json', 'utf8');

  const store = new Store(dir);
  assert.ok(store.loadError, 'the failure is reported rather than hidden');
  assert.equal(store.data.posts.length, 0);
  assert.ok(readdirSync(dir).some((f) => f.includes('corrupt')), 'the bad file is preserved');
  store.addPost({ text: 'still works' });
  assert.equal(store.data.posts.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('due() returns unscheduled posts and past-due ones, in order', () => {
  const dir = fresh();
  const store = new Store(dir);
  const now = new Date('2026-10-03T12:00:00Z');

  store.addPost({ text: 'future', scheduledAt: '2026-10-04T12:00:00Z' });
  store.addPost({ text: 'past', scheduledAt: '2026-10-03T09:00:00Z' });
  store.addPost({ text: 'unscheduled' });

  const due = store.due(now).map((p) => p.text);
  assert.deepEqual(due, ['past', 'unscheduled'], 'scheduled-and-due comes before unscheduled');
  rmSync(dir, { recursive: true, force: true });
});

test('published posts drop out of the queue', () => {
  const dir = fresh();
  const store = new Store(dir);
  const post = store.addPost({ text: 'one' });
  assert.equal(store.queued().length, 1);
  store.updatePost(post.id, { status: 'published' });
  assert.equal(store.queued().length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('removePost reports whether it removed anything', () => {
  const dir = fresh();
  const store = new Store(dir);
  const post = store.addPost({ text: 'bye' });
  assert.equal(store.removePost(post.id), true);
  assert.equal(store.removePost(post.id), false);
  rmSync(dir, { recursive: true, force: true });
});

test('recentlyPublished only matches a successful post inside the window', () => {
  const dir = fresh();
  const store = new Store(dir);

  store.addHistory({ hash: 'abc', anySuccess: true });
  assert.ok(store.recentlyPublished('abc', 72));
  assert.equal(store.recentlyPublished('other', 72), null);

  // A failed attempt must not block a retry.
  store.data.history = [{ at: new Date().toISOString(), hash: 'failed', anySuccess: false }];
  assert.equal(store.recentlyPublished('failed', 72), null);

  // Nor must one from outside the window.
  store.data.history = [{ at: new Date(Date.now() - 100 * 3600_000).toISOString(), hash: 'old', anySuccess: true }];
  assert.equal(store.recentlyPublished('old', 72), null);
  rmSync(dir, { recursive: true, force: true });
});

test('history is capped so the file cannot grow without bound', () => {
  const dir = fresh();
  const store = new Store(dir);
  for (let i = 0; i < 540; i += 1) store.addHistory({ hash: `h${i}`, anySuccess: true });
  assert.equal(store.data.history.length, 500);
  assert.equal(store.data.history[0].hash, 'h539', 'newest first');
  rmSync(dir, { recursive: true, force: true });
});

test('markPlatform tracks successes and clears the failure streak', () => {
  const dir = fresh();
  const store = new Store(dir);
  store.markPlatform('x', { ok: false });
  store.markPlatform('x', { ok: false });
  assert.equal(store.platform('x').failures, 2);
  store.markPlatform('x', { ok: true });
  assert.equal(store.platform('x').failures, 0);
  assert.equal(store.platform('x').successes, 1);
  rmSync(dir, { recursive: true, force: true });
});
