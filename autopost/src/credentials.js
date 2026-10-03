import { TokenVault } from './tokens.js';
import { loadConfig } from './config.js';
import { ensureFresh } from './oauth/flow.js';

// Maps a vault entry onto the config fields the posting adapters read, so a
// platform connected through "Connect account" looks identical to one set up
// by hand in .env. Anything the OAuth flow learned (a Page id, a LinkedIn URN,
// a Tumblr blog name) is carried across here too.
const APPLY = {
  x: (p, a) => {
    // The X adapter signs with OAuth 1.0a when given keys, and uses a bearer
    // token when connected over OAuth 2.0. Both reach the same v2 endpoint.
    p.x.oauth2Token = a.accessToken;
  },
  reddit: (p, a) => {
    p.reddit.accessToken = a.accessToken;
    if (a.refreshToken) p.reddit.refreshToken = a.refreshToken;
  },
  mastodon: (p, a) => { p.mastodon.accessToken = a.accessToken; },
  linkedin: (p, a) => {
    p.linkedin.accessToken = a.accessToken;
    if (a.extra?.authorUrn) p.linkedin.authorUrn = a.extra.authorUrn;
  },
  facebook: (p, a) => {
    p.facebook.accessToken = a.accessToken;
    if (a.extra?.pageId) p.facebook.pageId = a.extra.pageId;
  },
  instagram: (p, a) => {
    p.instagram.accessToken = a.accessToken;
    if (a.extra?.userId) p.instagram.userId = a.extra.userId;
  },
  threads: (p, a) => {
    p.threads.accessToken = a.accessToken;
    if (a.extra?.userId) p.threads.userId = a.extra.userId;
  },
  pinterest: (p, a) => {
    p.pinterest.accessToken = a.accessToken;
    if (a.extra?.boardId) p.pinterest.boardId = a.extra.boardId;
  },
  tumblr: (p, a) => {
    p.tumblr.accessToken = a.accessToken;
    if (a.extra?.blogIdentifier) p.tumblr.blogIdentifier = a.extra.blogIdentifier;
  },
  youtube: (p, a) => {
    if (a.refreshToken) p.youtube.refreshToken = a.refreshToken;
    p.youtube.accessToken = a.accessToken;
  },
  tiktok: (p, a) => { p.tiktok.accessToken = a.accessToken; },
};

/**
 * Overlays connected accounts onto a config. The vault wins over .env, because
 * a token obtained by clicking "Connect" is newer and self-renewing; a stale
 * hand-pasted value in .env should not shadow it.
 *
 * Returns the same config object, mutated, so callers can keep their reference.
 */
export function applyVault(config, vault) {
  config.connected = {};
  for (const [platform, apply] of Object.entries(APPLY)) {
    const account = vault.get(platform);
    if (!account?.accessToken && !account?.refreshToken) continue;
    apply(config.platforms, account);
    config.connected[platform] = {
      accountName: account.accountName || null,
      expiresAt: account.expiresAt || null,
      refreshable: Boolean(account.refreshToken),
    };
  }
  return config;
}

// Builds a vault, refreshes anything near expiry, and applies it. Call this
// once before a publish run so no post fails on a token that lapsed overnight.
export async function prepareCredentials({ config, logger, refresh = true }) {
  const vault = new TokenVault(config.dataDir);
  if (vault.loadError) {
    logger.warn(`tokens.json could not be read (${vault.loadError}); connected accounts are being ignored this run.`);
    applyVault(config, vault);
    return vault;
  }

  if (refresh && config.refreshTokens) {
    for (const platform of Object.keys(APPLY)) {
      if (vault.needsRefresh(platform)) {
        await ensureFresh(platform, { config, vault, logger });
      }
    }
  }
  applyVault(config, vault);
  return vault;
}

/**
 * Rebuilds `config.platforms` from the environment, then re-applies the vault.
 *
 * Needed after a disconnect: applyVault only ever *writes* credentials, so
 * without this the running process would keep using a token the user just
 * revoked until the next restart.
 */
export function reapplyCredentials(config, vault) {
  const rebuilt = loadConfig({ envFile: config.envFile });
  config.platforms = rebuilt.platforms;
  return applyVault(config, vault);
}

export { TokenVault };
