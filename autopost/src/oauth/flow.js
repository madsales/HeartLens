import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveProvider } from './providers.js';
import { request, postForm } from '../http.js';

// ---- PKCE ----------------------------------------------------------------

export const base64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

// ---- URL building --------------------------------------------------------

export function buildAuthUrl(provider, { clientId, redirectUri, state, pkce }) {
  const url = new URL(provider.authUrl);
  const params = {
    response_type: 'code',
    [provider.clientIdParam || 'client_id']: clientId,
    redirect_uri: redirectUri,
    scope: provider.scope,
    state,
    ...(provider.extraAuthParams || {}),
  };
  if (provider.pkce && pkce) {
    params.code_challenge = pkce.challenge;
    params.code_challenge_method = pkce.method;
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

// ---- code -> token -------------------------------------------------------

export async function exchangeCode(provider, { code, clientId, clientSecret, redirectUri, pkce, timeoutMs = 30000 }) {
  const fields = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  };
  if (provider.pkce && pkce) fields.code_verifier = pkce.verifier;

  const headers = { accept: 'application/json' };
  if (provider.clientAuth === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    // Several providers (X among them) still want client_id in the body too.
    fields[provider.clientIdParam || 'client_id'] = clientId;
  } else {
    fields[provider.clientIdParam || 'client_id'] = clientId;
    fields.client_secret = clientSecret;
  }

  const res = await postForm(provider.tokenUrl, fields, { headers, timeoutMs });
  return normaliseTokens(res.body);
}

export async function refreshToken(provider, { refreshToken: token, clientId, clientSecret, timeoutMs = 30000 }) {
  const fields = { grant_type: 'refresh_token', refresh_token: token };
  const headers = { accept: 'application/json' };
  if (provider.clientAuth === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    fields[provider.clientIdParam || 'client_id'] = clientId;
  } else {
    fields[provider.clientIdParam || 'client_id'] = clientId;
    fields.client_secret = clientSecret;
  }
  const res = await postForm(provider.tokenUrl, fields, { headers, timeoutMs });
  return normaliseTokens(res.body);
}

// Providers disagree on casing and nesting; flatten to one shape.
export function normaliseTokens(body) {
  if (!body || typeof body !== 'object') throw new Error(`Token endpoint returned an unexpected body: ${String(body).slice(0, 200)}`);
  const data = body.data && body.data.access_token ? body.data : body;
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) {
    throw new Error(`Token endpoint returned no access_token: ${JSON.stringify(body).slice(0, 300)}`);
  }
  const expiresIn = Number(data.expires_in ?? data.expiresIn);
  return {
    accessToken,
    refreshToken: data.refresh_token || data.refreshToken || null,
    scope: data.scope || null,
    tokenType: data.token_type || 'Bearer',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  };
}

// ---- callback server -----------------------------------------------------

const PAGE = (title, message, ok) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#0b1020;color:#f2f3f9;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#171d33;border:1px solid #2a3354;border-radius:20px;padding:36px;max-width:460px;text-align:center}
h1{margin:0 0 10px;font-size:1.3rem;color:${ok ? '#4ad4a0' : '#ff7a85'}}
p{color:#9aa3c4;margin:0;line-height:1.6}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;

// Waits for the provider to redirect back, verifying `state` to defeat CSRF.
export function waitForCallback({ port, host = '127.0.0.1', path = '/callback', state, timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${host}:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const send = (status, title, message, ok) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE(title, message, ok));
      };

      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') || error;
        send(400, 'Authorisation refused', escapeHtml(description), false);
        cleanup();
        reject(new Error(`Provider refused authorisation: ${description}`));
        return;
      }

      const returned = url.searchParams.get('state') || '';
      // Constant-time compare so the state value cannot be probed by timing.
      const a = Buffer.from(returned);
      const b = Buffer.from(state);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        send(400, 'State mismatch', 'The <code>state</code> value did not match. This request was discarded as a possible CSRF attempt. Start the connect flow again.', false);
        cleanup();
        reject(new Error('OAuth state mismatch - the callback did not come from the flow we started'));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        send(400, 'No code returned', 'The provider redirected back without an authorisation code.', false);
        cleanup();
        reject(new Error('Callback carried no authorisation code'));
        return;
      }

      send(200, 'Connected', 'You can close this tab and go back to the terminal.', true);
      cleanup();
      resolve({ code });
    });

    let timer;
    function cleanup() {
      clearTimeout(timer);
      // Give the response time to flush before tearing the socket down.
      setTimeout(() => server.close(), 150);
    }

    server.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Set OAUTH_CALLBACK_PORT to a free port (and update the redirect URI registered with the provider).`));
      } else reject(err);
    });

    server.listen(port, host, () => {
      timer = setTimeout(() => {
        server.close();
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser redirect.`));
      }, timeoutMs);
      timer.unref?.();
    });
  });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Best-effort browser launch; the URL is always printed as a fallback.
export function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ---- the whole dance -----------------------------------------------------

export async function connect(platformId, { config, vault, logger, openInBrowser = true, onAuthUrl = null }) {
  const provider = resolveProvider(platformId, config);
  if (!provider) throw new Error(`"${platformId}" has no OAuth flow. Run \`accounts\` to see what is connectable.`);

  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Set ${provider.clientIdEnv} and ${provider.clientSecretEnv} in .env first.\n  ${provider.setup}\n  Docs: ${provider.docs}`,
    );
  }

  const port = config.oauthCallbackPort;
  const redirectUri = config.oauthRedirectUri || `http://127.0.0.1:${port}/callback`;
  const state = base64url(randomBytes(24));
  const pkce = provider.pkce ? createPkce() : null;
  const authUrl = buildAuthUrl(provider, { clientId, redirectUri, state, pkce });

  logger.info(`Connecting ${provider.label}…`);
  if (provider.needsReview) {
    logger.warn(`${provider.label} requires platform app review before posts from a normal account go live.`);
  }

  // Start listening before anything can redirect back, or a fast provider
  // bounce arrives before the server is up.
  const pending = waitForCallback({ port, state, timeoutMs: config.oauthTimeoutMs });

  // Hand the URL to the caller: the CLI prints and opens it, the dashboard
  // redirects the browser to it, and tests drive it directly.
  if (onAuthUrl) {
    await onAuthUrl(authUrl, { redirectUri, provider });
  } else {
    console.log(`\n  Redirect URI (must be registered with the provider):\n    ${redirectUri}\n`);
    console.log(`  If the browser does not open, paste this:\n    ${authUrl}\n`);
    if (openInBrowser) openBrowser(authUrl);
  }

  const { code } = await pending;
  logger.info('Code received, exchanging for a token…');

  let tokens = await exchangeCode(provider, {
    code, clientId, clientSecret, redirectUri, pkce, timeoutMs: config.requestTimeoutMs,
  });

  // Meta/Threads need extra hops (long-lived token, then a Page token).
  if (provider.postProcess) {
    const extra = await provider.postProcess(tokens, { request, config });
    tokens = { ...tokens, ...extra };
  }

  // Record who we actually connected as, so `accounts` is meaningful.
  if (provider.identify) {
    try {
      const who = await provider.identify(tokens.accessToken, { request, config });
      tokens = { ...tokens, ...who, extra: { ...(tokens.extra || {}), ...(who.extra || {}) } };
    } catch (err) {
      logger.warn(`Connected, but could not read the account name: ${err.message}`);
    }
  }

  const saved = vault.set(platformId, tokens);
  logger.info(`${provider.label} connected${saved.accountName ? ` as ${saved.accountName}` : ''}.`);
  if (saved.expiresAt) {
    logger.info(`Token expires ${saved.expiresAt}${saved.refreshToken ? ' and will be refreshed automatically.' : ' and has NO refresh token - you will need to reconnect.'}`);
  }
  return saved;
}

// Renews a token that is near expiry. Called before every publish.
export async function ensureFresh(platformId, { config, vault, logger }) {
  if (!vault.needsRefresh(platformId)) return vault.get(platformId);

  const provider = resolveProvider(platformId, config);
  const account = vault.get(platformId);
  if (!provider || !account?.refreshToken) return account;

  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) return account;

  try {
    logger.info(`${provider.label}: token near expiry, refreshing…`);
    const tokens = await refreshToken(provider, {
      refreshToken: account.refreshToken, clientId, clientSecret, timeoutMs: config.requestTimeoutMs,
    });
    const saved = vault.set(platformId, tokens);
    logger.info(`${provider.label}: token refreshed${saved.expiresAt ? `, valid until ${saved.expiresAt}` : ''}.`);
    return saved;
  } catch (err) {
    // A failed refresh must not abort the run: the old token may still work.
    logger.warn(`${provider.label}: token refresh failed (${err.message}). Trying the existing token; reconnect if it fails.`);
    return account;
  }
}
