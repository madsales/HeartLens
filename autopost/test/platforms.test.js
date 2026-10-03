import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTERS, BY_ID, getAdapter, resolveTargets } from '../src/platforms/index.js';
import { truncate, splitThread, withLink, textFor, multipart, mimeFor } from '../src/platforms/base.js';
import { linkFacets } from '../src/platforms/bluesky.js';
import { oauth1Header, rfc3986 } from '../src/oauth1.js';
import { loadConfig } from '../src/config.js';
import outbox from '../src/platforms/outbox.js';

const bare = loadConfig({ envFile: '/nonexistent' });

test('every adapter satisfies the contract', () => {
  for (const a of ADAPTERS) {
    assert.ok(a.id, 'needs an id');
    assert.ok(a.label, `${a.id} needs a label`);
    assert.ok(['api', 'review', 'relay', 'manual'].includes(a.tier), `${a.id} has an unknown tier`);
    assert.equal(typeof a.publish, 'function', `${a.id} needs publish()`);
    assert.equal(typeof a.missing, 'function', `${a.id} needs missing()`);
    assert.ok(Array.isArray(a.missing(bare)), `${a.id}.missing() must return an array`);
    assert.equal(typeof a.configured(bare), 'boolean', `${a.id}.configured() must return a boolean`);
  }
});

test('adapter ids are unique', () => {
  assert.equal(new Set(ADAPTERS.map((a) => a.id)).size, ADAPTERS.length);
});

test('every adapter except outbox reports what it is missing when unconfigured', () => {
  for (const a of ADAPTERS) {
    if (a.id === 'outbox') continue;
    assert.ok(a.missing(bare).length > 0, `${a.id} claims to be ready with no credentials at all`);
    assert.equal(a.configured(bare), false);
  }
});

test('outbox always works, so a run is never a total loss', () => {
  assert.equal(outbox.configured(bare), true);
  assert.deepEqual(outbox.missing(bare), []);
});

test('an unconfigured install resolves to the outbox alone', () => {
  const { ready } = resolveTargets(bare);
  assert.deepEqual(ready.map((a) => a.id), ['outbox']);
});

test('resolveTargets honours an explicit platform list and flags unknown names', () => {
  const { unknown } = resolveTargets(bare, { only: ['x', 'myspace'] });
  assert.deepEqual(unknown, ['myspace']);
  assert.equal(getAdapter('X').id, 'x', 'lookup is case-insensitive');
  assert.equal(getAdapter('nope'), null);
});

test('adapters carry a documentation link', () => {
  for (const a of ADAPTERS) {
    if (a.tier === 'manual') continue;
    assert.ok(/^https?:\/\//.test(a.docs), `${a.id} should link to its API docs`);
  }
});

test('platforms with a character limit declare it', () => {
  for (const id of ['x', 'bluesky', 'mastodon', 'threads', 'telegram', 'discord']) {
    assert.ok(BY_ID.get(id).limits.text > 0, `${id} should declare a text limit`);
  }
  assert.equal(BY_ID.get('x').limits.text, 280);
  assert.equal(BY_ID.get('bluesky').limits.text, 300);
});

// ---- shared helpers ------------------------------------------------------

test('truncate cuts on a word boundary and respects the limit', () => {
  const out = truncate('the quick brown fox jumps over the lazy dog', 20);
  assert.ok(out.length <= 20, `"${out}" is ${out.length} chars`);
  assert.ok(out.endsWith('…'));
  assert.equal(truncate('short', 20), 'short', 'short text is untouched');
});

test('splitThread numbers parts and keeps each within the limit', () => {
  const parts = splitThread('word '.repeat(200).trim(), 100);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 100, `part is ${part.length} chars`);
  assert.match(parts[0], /\(1\/\d+\)$/);
  assert.match(parts.at(-1), new RegExp(`\\(${parts.length}/${parts.length}\\)$`));
  assert.deepEqual(splitThread('fits fine', 100), ['fits fine'], 'short text is not threaded');
});

test('withLink appends a link once, and never twice', () => {
  assert.equal(withLink('body', 'https://a.test'), 'body\n\nhttps://a.test');
  assert.equal(withLink('see https://a.test', 'https://a.test'), 'see https://a.test');
  assert.equal(withLink('body', null), 'body');
});

test('textFor prefers a platform variant and falls back to the shared body', () => {
  const post = { text: 'shared', variants: { x: 'for x', linkedin: '   ' } };
  assert.equal(textFor(post, 'x'), 'for x');
  assert.equal(textFor(post, 'linkedin'), 'shared', 'a blank variant falls back');
  assert.equal(textFor(post, 'telegram'), 'shared');
});

test('mimeFor recognises common types and ignores a query string', () => {
  assert.equal(mimeFor('a.png'), 'image/png');
  assert.equal(mimeFor('https://x.test/v.mp4?token=1'), 'video/mp4');
  assert.equal(mimeFor('weird.xyz'), 'application/octet-stream');
});

test('multipart produces a well-formed body', () => {
  const { body, contentType } = multipart({ a: '1', f: { buffer: Buffer.from('xy'), mime: 'text/plain', name: 'f.txt' } });
  const text = body.toString();
  const boundary = contentType.split('boundary=')[1];
  assert.ok(text.startsWith(`--${boundary}`));
  assert.ok(text.trimEnd().endsWith(`--${boundary}--`));
  assert.match(text, /name="a"/);
  assert.match(text, /filename="f.txt"/);
});

// ---- bluesky facets ------------------------------------------------------

test('link facets use byte offsets, so emoji do not shift them', () => {
  const text = '💜 see https://heartlens.app now';
  const { facets } = linkFacets(text);
  assert.equal(facets.length, 1);
  const bytes = Buffer.from(text, 'utf8');
  const sliced = bytes.subarray(facets[0].index.byteStart, facets[0].index.byteEnd).toString('utf8');
  assert.equal(sliced, 'https://heartlens.app');
});

test('link facets find several links and exclude trailing punctuation', () => {
  const { facets } = linkFacets('a https://one.test and https://two.test.');
  assert.equal(facets.length, 2);
  assert.equal(facets[1].features[0].uri, 'https://two.test');
});

// ---- oauth 1.0a ----------------------------------------------------------

test('rfc3986 escapes the characters encodeURIComponent leaves alone', () => {
  assert.equal(rfc3986("a*b!c'd(e)"), 'a%2Ab%21c%27d%28e%29');
  assert.equal(rfc3986('safe-._~'), 'safe-._~', 'unreserved characters stay literal');
});

test('oauth1 builds a stable signature and a complete header', () => {
  const args = {
    method: 'POST',
    url: 'https://api.twitter.com/2/tweets',
    consumerKey: 'ck', consumerSecret: 'cs', token: 'tk', tokenSecret: 'ts',
    nonce: 'fixednonce', timestamp: '1700000000',
  };
  const a = oauth1Header(args);
  const b = oauth1Header(args);
  assert.equal(a.signature, b.signature, 'same inputs must give the same signature');
  for (const field of ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version', 'oauth_signature']) {
    assert.ok(a.header.includes(field), `header is missing ${field}`);
  }
  assert.ok(a.header.startsWith('OAuth '));
});

test('oauth1 signature changes when the request changes', () => {
  const base = { consumerKey: 'ck', consumerSecret: 'cs', token: 'tk', tokenSecret: 'ts', nonce: 'n', timestamp: '1' };
  const one = oauth1Header({ ...base, method: 'POST', url: 'https://a.test/x' });
  const two = oauth1Header({ ...base, method: 'GET', url: 'https://a.test/x' });
  const three = oauth1Header({ ...base, method: 'POST', url: 'https://a.test/y' });
  assert.notEqual(one.signature, two.signature, 'method is signed');
  assert.notEqual(one.signature, three.signature, 'path is signed');
});

test('oauth1 includes query-string parameters in the signature base', () => {
  const base = { consumerKey: 'ck', consumerSecret: 'cs', token: 'tk', tokenSecret: 'ts', nonce: 'n', timestamp: '1', method: 'GET' };
  const withQuery = oauth1Header({ ...base, url: 'https://a.test/x?command=STATUS&media_id=9' });
  assert.match(withQuery.baseString, /command%3DSTATUS/);
  assert.match(withQuery.baseString, /media_id%3D9/);
});

// ---- outbox round trip ---------------------------------------------------

test('outbox writes a readable, pasteable file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heartlens-outbox-'));
  const config = { ...bare, dataDir: dir, platforms: { ...bare.platforms, outbox: { dir: join(dir, 'outbox') } } };
  const result = await outbox.publish(
    { id: 'abcdef123456', title: 'Test post', text: 'Body line one', variants: { x: 'short form' }, link: 'https://heartlens.app', tags: ['a'] },
    { config },
  );

  const files = readdirSync(join(dir, 'outbox'));
  assert.equal(files.length, 1);
  const content = readFileSync(join(dir, 'outbox', files[0]), 'utf8');
  assert.match(content, /# Test post/);
  assert.match(content, /Body line one/);
  assert.match(content, /### x/);
  assert.match(content, /short form/);
  assert.ok(result.url.startsWith('file://'));
  rmSync(dir, { recursive: true, force: true });
});

test('an explicitly empty platform list resolves to nothing, not everything', () => {
  // Regression guard: [] means "the caller selected no platforms". Treating it
  // as "unspecified" would fan a post out to every configured platform at the
  // exact moment the caller asked for none.
  const { ready } = resolveTargets(bare, { only: [] });
  assert.deepEqual(ready, []);

  // Omitting the list still means "every ready platform".
  assert.deepEqual(resolveTargets(bare, { only: null }).ready.map((a) => a.id), ['outbox']);
  assert.deepEqual(resolveTargets(bare).ready.map((a) => a.id), ['outbox']);
});

test('ENABLED_PLATFORMS narrows the default target set', async () => {
  const { loadConfig: load } = await import('../src/config.js');
  const narrowed = load({ envFile: '/nonexistent', overrides: { ENABLED_PLATFORMS: 'outbox' } });
  assert.deepEqual(resolveTargets(narrowed).ready.map((a) => a.id), ['outbox']);

  const toX = load({ envFile: '/nonexistent', overrides: { ENABLED_PLATFORMS: 'x' } });
  assert.deepEqual(resolveTargets(toX).ready, [], 'x has no credentials, so nothing is ready');
  assert.equal(resolveTargets(toX).notConfigured[0].id, 'x');
});
