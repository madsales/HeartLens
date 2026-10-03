import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { render, loadPack, materialise, nextFromPack } from '../src/content.js';

const config = loadConfig({ envFile: '/nonexistent', overrides: { SITE_URL: 'https://heartlens.app' } });

test('render substitutes known tokens and leaves unknown ones alone', () => {
  assert.equal(render('go to {{site}} now', { site: 'https://x.test' }), 'go to https://x.test now');
  assert.equal(render('{{ site }} spaced', { site: 'A' }), 'A spaced');
  assert.equal(render('keep {{mystery}}', { site: 'A' }), 'keep {{mystery}}');
});

test('the shipped content pack is valid and every post has usable text', () => {
  const pack = loadPack();
  assert.ok(pack.posts.length >= 5, 'the pack should have enough posts to rotate through');
  for (const entry of pack.posts) {
    assert.ok(entry.text && entry.text.trim().length > 20, `"${entry.title}" needs real body text`);
    assert.ok(entry.title, 'every post needs a title for Reddit/YouTube/Pinterest');
  }
});

test('no pack post leaves an unresolved template token after materialising', () => {
  const pack = loadPack();
  for (const entry of pack.posts) {
    const post = materialise(entry, pack, config);
    assert.doesNotMatch(post.text, /\{\{/, `"${entry.title}" still has a token in its body`);
    assert.doesNotMatch(String(post.link), /\{\{/, `"${entry.title}" still has a token in its link`);
    for (const [platform, text] of Object.entries(post.variants)) {
      assert.doesNotMatch(text, /\{\{/, `"${entry.title}" variant ${platform} still has a token`);
    }
  }
});

test('platform variants stay inside that platform character limit', async () => {
  const { BY_ID } = await import('../src/platforms/index.js');
  const pack = loadPack();
  for (const entry of pack.posts) {
    const post = materialise(entry, pack, config);
    for (const [platformId, text] of Object.entries(post.variants)) {
      const adapter = BY_ID.get(platformId);
      assert.ok(adapter, `variant targets unknown platform "${platformId}"`);
      const limit = adapter.limits?.text;
      if (limit) {
        assert.ok(
          text.length <= limit,
          `"${entry.title}" variant for ${platformId} is ${text.length} chars, over the ${limit} limit`,
        );
      }
    }
  }
});

test('the pack cursor rotates and wraps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-content-'));
  const store = new Store(dir);
  const pack = loadPack();
  const seen = [];
  for (let i = 0; i < pack.posts.length + 2; i += 1) seen.push(nextFromPack(store, config).index);

  assert.deepEqual(seen.slice(0, pack.posts.length), pack.posts.map((_, i) => i), 'visits every post once');
  assert.equal(seen[pack.posts.length], 0, 'then wraps back to the start');
  rmSync(dir, { recursive: true, force: true });
});

test('materialise falls back to pack defaults', () => {
  const pack = { name: 't', defaults: { link: '{{site}}', tags: ['d'] }, posts: [{ title: 'x', text: 'body' }] };
  const post = materialise(pack.posts[0], pack, config);
  assert.equal(post.link, 'https://heartlens.app');
  assert.deepEqual(post.tags, ['d']);
});
