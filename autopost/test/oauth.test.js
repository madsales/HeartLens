import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPkce, base64url, buildAuthUrl, exchangeCode, refreshToken, normaliseTokens, waitForCallback, connect } from '../src/oauth/flow.js';
import { PROVIDERS, getProvider, resolveProvider, NON_OAUTH } from '../src/oauth/providers.js';
import { TokenVault } from '../src/tokens.js';
import { applyVault } from '../src/credentials.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger({ level: 'silent', color: false });
const fresh = () => mkdtempSync(join(tmpdir(), 'heartlens-oauth-'));

// ---- PKCE ----------------------------------------------------------------

test('PKCE challenge is the S256 hash of the verifier', () => {
  const p = createPkce();
  assert.equal(p.method, 'S256');
  assert.equal(base64url(createHash('sha256').update(p.verifier).digest()), p.challenge);
  assert.ok(p.verifier.length >= 43, 'verifier must meet the RFC 7636 minimum length');
  assert.doesNotMatch(p.challenge, /[+/=]/, 'challenge must be base64url, not base64');
});

test('each PKCE pair is unique', () => {
  assert.notEqual(createPkce().verifier, createPkce().verifier);
});

// ---- auth URL ------------------------------------------------------------

test('auth URL carries the required OAuth parameters', () => {
  const config = loadConfig({ envFile: '/nonexistent' });
  const pkce = createPkce();
  const url = new URL(buildAuthUrl(resolveProvider('x', config), {
    clientId: 'CID', redirectUri: 'http://127.0.0.1:4311/callback', state: 'STATE', pkce,
  }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'CID');
  assert.equal(url.searchParams.get('state'), 'STATE');
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /tweet\.write/);
});

test('a non-PKCE provider omits the challenge', () => {
  const config = loadConfig({ envFile: '/nonexistent' });
  const url = new URL(buildAuthUrl(resolveProvider('linkedin', config), {
    clientId: 'C', redirectUri: 'r', state: 's', pkce: createPkce(),
  }));
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('TikTok uses client_key rather than client_id', () => {
  const config = loadConfig({ envFile: '/nonexistent' });
  const url = new URL(buildAuthUrl(resolveProvider('tiktok', config), {
    clientId: 'KEY', redirectUri: 'r', state: 's', pkce: createPkce(),
  }));
  assert.equal(url.searchParams.get('client_key'), 'KEY');
  assert.equal(url.searchParams.has('client_id'), false);
});

test('Reddit asks for a permanent grant, or it gets no refresh token', () => {
  const config = loadConfig({ envFile: '/nonexistent' });
  const url = new URL(buildAuthUrl(resolveProvider('reddit', config), { clientId: 'C', redirectUri: 'r', state: 's' }));
  assert.equal(url.searchParams.get('duration'), 'permanent');
});

test('Mastodon builds its endpoints from the instance URL', () => {
  const config = loadConfig({ envFile: '/nonexistent', overrides: { MASTODON_BASE_URL: 'https://fosstodon.org/' } });
  const p = resolveProvider('mastodon', config);
  assert.equal(p.authUrl, 'https://fosstodon.org/oauth/authorize');
  assert.equal(p.tokenUrl, 'https://fosstodon.org/oauth/token');
});

test('Mastodon without an instance URL fails with a clear message', () => {
  const config = loadConfig({ envFile: '/nonexistent' });
  assert.throws(() => resolveProvider('mastodon', config), /MASTODON_BASE_URL/);
});

// ---- token parsing -------------------------------------------------------

test('normaliseTokens handles flat, nested and snake/camel shapes', () => {
  const flat = normaliseTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 's' });
  assert.equal(flat.accessToken, 'a');
  assert.equal(flat.refreshToken, 'r');
  assert.ok(new Date(flat.expiresAt) > new Date());

  assert.equal(normaliseTokens({ data: { access_token: 'nested' } }).accessToken, 'nested');
  assert.equal(normaliseTokens({ accessToken: 'camel' }).accessToken, 'camel');
  assert.equal(normaliseTokens({ access_token: 'a' }).expiresAt, null, 'no expires_in means no expiry');
});

test('a token response without a token is an error, not a silent success', () => {
  assert.throws(() => normaliseTokens({ error: 'invalid_grant' }), /no access_token/);
  assert.throws(() => normaliseTokens('<html>502</html>'), /unexpected body/);
});

// ---- callback server -----------------------------------------------------

async function callbackHarness(query, state = 'GOODSTATE') {
  const port = 4390 + Math.floor(Math.random() * 300);
  // The promise settles while the fetch is still in flight, so attach a
  // handler straight away -- otherwise Node reports an unhandled rejection
  // before the assertion gets a chance to look at it.
  const settled = waitForCallback({ port, state, timeoutMs: 5000 }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const res = await fetch(`http://127.0.0.1:${port}/callback?${query}`);
  const html = await res.text();
  return { outcome: await settled, status: res.status, html };
}

test('the callback accepts a matching state and returns the code', async () => {
  const h = await callbackHarness('code=THECODE&state=GOODSTATE');
  assert.equal(h.status, 200);
  assert.equal(h.outcome.ok, true);
  assert.equal(h.outcome.value.code, 'THECODE');
  assert.match(h.html, /Connected/);
});

test('a mismatched state is rejected as CSRF', async () => {
  const h = await callbackHarness('code=X&state=ATTACKER');
  assert.equal(h.status, 400);
  assert.match(h.html, /State mismatch/);
  assert.equal(h.outcome.ok, false);
  assert.match(h.outcome.error.message, /state mismatch/i);
});

test('a provider error is surfaced rather than hanging', async () => {
  const h = await callbackHarness('error=access_denied&error_description=User+said+no');
  assert.equal(h.status, 400);
  assert.equal(h.outcome.ok, false);
  assert.match(h.outcome.error.message, /User said no/);
});

test('the callback page escapes provider-supplied text', async () => {
  const h = await callbackHarness(`error=x&error_description=${encodeURIComponent('<script>alert(1)</script>')}`);
  assert.ok(!h.html.includes('<script>alert(1)</script>'), 'provider text must not land as live HTML');
  assert.match(h.html, /&lt;script&gt;/);
  assert.equal(h.outcome.ok, false);
});

// ---- full flow against a mock provider -----------------------------------

// Stands up a fake OAuth server so the whole dance is exercised for real:
// auth redirect, state check, PKCE verification, code exchange, identify.
function mockProvider({ expectPkce = true } = {}) {
  const seen = {};
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/authorize') {
      seen.auth = Object.fromEntries(url.searchParams.entries());
      // Redirect back exactly as a real provider would.
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'MOCKCODE');
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }

    if (url.pathname === '/token') {
      const body = await new Promise((resolve) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(d))));
      });
      seen.token = { body, auth: req.headers.authorization };

      if (body.grant_type === 'refresh_token') {
        return json(200, { access_token: 'REFRESHED', expires_in: 7200 });
      }
      if (expectPkce) {
        const expected = base64url(createHash('sha256').update(body.code_verifier || '').digest());
        if (expected !== seen.auth.code_challenge) return json(400, { error: 'invalid_grant' });
      }
      return json(200, { access_token: 'MOCKTOKEN', refresh_token: 'MOCKREFRESH', expires_in: 3600, scope: 'write' });
    }

    if (url.pathname === '/me') {
      return json(200, { id: 'u1', username: 'heartlens' });
    }
    res.writeHead(404); res.end();
  });
  return { server, seen };
}

test('the full connect flow stores a working token', async (t) => {
  const dir = fresh();
  const { server, seen } = mockProvider();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  PROVIDERS.__mock = {
    id: '__mock', label: 'Mock', authUrl: `${base}/authorize`, tokenUrl: `${base}/token`,
    scope: 'write', pkce: true, clientAuth: 'body',
    clientIdEnv: 'MOCK_CLIENT_ID', clientSecretEnv: 'MOCK_CLIENT_SECRET',
    docs: 'https://example.test', setup: 'n/a',
    async identify(token, { request }) {
      const me = await request(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
      return { accountId: me.body.id, accountName: `@${me.body.username}` };
    },
  };
  t.after(() => { delete PROVIDERS.__mock; });

  process.env.MOCK_CLIENT_ID = 'cid';
  process.env.MOCK_CLIENT_SECRET = 'csecret';
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  config.dataDir = dir;
  config.oauthCallbackPort = 4700 + Math.floor(Math.random() * 200);

  const vault = new TokenVault(dir);

  // onAuthUrl receives exactly what a browser would be sent to; following it
  // exercises the provider redirect, the state check and the code exchange.
  const saved = await connect('__mock', {
    config, vault, logger: silent,
    onAuthUrl: async (url) => { await fetch(url, { redirect: 'follow' }); },
  });

  assert.equal(saved.accessToken, 'MOCKTOKEN');
  assert.equal(saved.refreshToken, 'MOCKREFRESH');
  assert.equal(saved.accountName, '@heartlens');
  assert.ok(saved.expiresAt, 'expiry was recorded');
  assert.equal(seen.token.body.grant_type, 'authorization_code');
  assert.ok(seen.token.body.code_verifier, 'the PKCE verifier was sent');
  assert.equal(seen.auth.code_challenge_method, 'S256');

  // Persisted, and private on disk.
  assert.equal(new TokenVault(dir).get('__mock').accessToken, 'MOCKTOKEN');
  assert.equal(statSync(join(dir, 'tokens.json')).mode & 0o077, 0, 'tokens.json must not be group/world readable');

  const refreshed = await refreshToken(PROVIDERS.__mock, {
    refreshToken: 'MOCKREFRESH', clientId: 'cid', clientSecret: 'csecret',
  });
  assert.equal(refreshed.accessToken, 'REFRESHED');
});

test('connect refuses when the app credentials are not set', async () => {
  const dir = fresh();
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  config.dataDir = dir;
  delete process.env.PINTEREST_APP_ID;
  await assert.rejects(
    connect('pinterest', { config, vault: new TokenVault(dir), logger: silent, openInBrowser: false }),
    /PINTEREST_APP_ID/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('connect rejects an unknown platform', async () => {
  const dir = fresh();
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  config.dataDir = dir;
  await assert.rejects(
    connect('myspace', { config, vault: new TokenVault(dir), logger: silent, openInBrowser: false }),
    /no OAuth flow/,
  );
  rmSync(dir, { recursive: true, force: true });
});

// ---- vault -> config -----------------------------------------------------

test('a connected account satisfies the adapter without any .env value', async () => {
  const dir = fresh();
  const { BY_ID } = await import('../src/platforms/index.js');
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  const vault = new TokenVault(dir);

  assert.equal(BY_ID.get('mastodon').configured(config), false);
  vault.set('mastodon', { accessToken: 'tok', accountName: '@a' });
  config.platforms.mastodon.baseUrl = 'https://mastodon.social';
  applyVault(config, vault);
  assert.equal(BY_ID.get('mastodon').configured(config), true);
  assert.equal(config.connected.mastodon.accountName, '@a');
  rmSync(dir, { recursive: true, force: true });
});

test('OAuth extras land where the adapters look for them', () => {
  const dir = fresh();
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  const vault = new TokenVault(dir);

  vault.set('linkedin', { accessToken: 't', extra: { authorUrn: 'urn:li:person:XYZ' } });
  vault.set('facebook', { accessToken: 'pagetok', extra: { pageId: '123' } });
  vault.set('instagram', { accessToken: 'igtok', extra: { userId: '999' } });
  vault.set('tumblr', { accessToken: 'tu', extra: { blogIdentifier: 'blog.tumblr.com' } });
  applyVault(config, vault);

  assert.equal(config.platforms.linkedin.authorUrn, 'urn:li:person:XYZ');
  assert.equal(config.platforms.facebook.pageId, '123');
  assert.equal(config.platforms.instagram.userId, '999');
  assert.equal(config.platforms.tumblr.blogIdentifier, 'blog.tumblr.com');
  rmSync(dir, { recursive: true, force: true });
});

test('an OAuth2 connection satisfies X without the OAuth 1.0a keys', async () => {
  const dir = fresh();
  const { BY_ID } = await import('../src/platforms/index.js');
  const config = loadConfig({ envFile: join(dir, 'none.env'), overrides: { DATA_DIR: dir } });
  const vault = new TokenVault(dir);

  assert.equal(BY_ID.get('x').configured(config), false);
  vault.set('x', { accessToken: 'bearer' });
  applyVault(config, vault);
  assert.equal(BY_ID.get('x').configured(config), true);
  assert.deepEqual(BY_ID.get('x').missing(config), []);
  rmSync(dir, { recursive: true, force: true });
});

test('vault expiry maths and status strings', () => {
  const dir = fresh();
  const vault = new TokenVault(dir);
  const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

  vault.set('x', { accessToken: 'a', refreshToken: 'r', expiresAt: inHours(1) });
  assert.equal(vault.needsRefresh('x', 10), false);
  assert.equal(vault.needsRefresh('x', 120), true);
  assert.equal(vault.expired('x'), false);

  vault.set('reddit', { accessToken: 'a', expiresAt: inHours(-1) });
  assert.equal(vault.expired('reddit'), true);
  assert.equal(vault.needsRefresh('reddit'), false, 'no refresh token means no refresh is possible');
  assert.match(vault.list().find((a) => a.platform === 'reddit').status, /reconnect needed/);

  vault.set('mastodon', { accessToken: 'a' });
  assert.equal(vault.needsRefresh('mastodon'), false, 'a token with no expiry never needs refreshing');
  assert.equal(vault.list().find((a) => a.platform === 'mastodon').status, 'connected');
  rmSync(dir, { recursive: true, force: true });
});

test('a refresh response without a new refresh token keeps the old one', () => {
  const dir = fresh();
  const vault = new TokenVault(dir);
  vault.set('x', { accessToken: 'old', refreshToken: 'keepme' });
  vault.set('x', { accessToken: 'new' });
  assert.equal(vault.get('x').refreshToken, 'keepme');
  assert.equal(vault.get('x').accessToken, 'new');
  rmSync(dir, { recursive: true, force: true });
});

test('disconnect removes only the named account', () => {
  const dir = fresh();
  const vault = new TokenVault(dir);
  vault.set('x', { accessToken: 'a' });
  vault.set('reddit', { accessToken: 'b' });
  assert.equal(vault.remove('x'), true);
  assert.equal(vault.remove('x'), false);
  assert.equal(vault.has('reddit'), true);
  vault.destroy();
  assert.equal(vault.list().length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('every OAuth provider declares what it needs', () => {
  for (const p of Object.values(PROVIDERS)) {
    if (p.id === '__mock') continue;
    assert.ok(p.label, `${p.id} needs a label`);
    assert.ok(p.scope, `${p.id} needs a scope`);
    assert.ok(p.clientIdEnv && p.clientSecretEnv, `${p.id} needs client env var names`);
    assert.match(p.docs, /^https:\/\//, `${p.id} needs a docs link`);
    assert.ok(p.setup, `${p.id} needs setup instructions`);
    assert.ok(p.dynamic || /^https:\/\//.test(p.authUrl), `${p.id} needs an auth URL`);
  }
});

test('platforms are either OAuth-connectable or documented as not needing it', async () => {
  const { ADAPTERS } = await import('../src/platforms/index.js');
  for (const a of ADAPTERS) {
    assert.ok(
      getProvider(a.id) || NON_OAUTH[a.id],
      `${a.id} is neither connectable nor listed in NON_OAUTH, so users get no guidance`,
    );
  }
});
