import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Credentials obtained through "Connect account" live here rather than in
// .env, so the OAuth flow can write them and the refresher can update them
// without a human editing a file. Same idea as Buffer's token vault.
//
// The file holds live access tokens, so it is created 0600 and never served
// over the dashboard API.
export class TokenVault {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = join(dataDir, 'tokens.json');
    this.data = { version: 1, accounts: {} };
    this.load();
  }

  load() {
    mkdirSync(this.dataDir, { recursive: true });
    if (!existsSync(this.file)) return this.data;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = { version: 1, accounts: {}, ...parsed };
    } catch (err) {
      // Never silently drop credentials: keep the file and report it.
      this.loadError = err.message;
    }
    return this.data;
  }

  save() {
    mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch { /* Windows and some filesystems do not support this */ }
    return this;
  }

  get(platform) {
    return this.data.accounts[platform] || null;
  }

  has(platform) {
    return Boolean(this.get(platform)?.accessToken);
  }

  list() {
    return Object.entries(this.data.accounts).map(([platform, a]) => ({
      platform,
      accountName: a.accountName || null,
      accountId: a.accountId || null,
      scope: a.scope || null,
      connectedAt: a.connectedAt || null,
      expiresAt: a.expiresAt || null,
      expiresInDays: a.expiresAt ? daysUntil(a.expiresAt) : null,
      refreshable: Boolean(a.refreshToken),
      status: statusOf(a),
    }));
  }

  set(platform, tokens) {
    const existing = this.data.accounts[platform] || {};
    this.data.accounts[platform] = {
      ...existing,
      ...tokens,
      // A refresh response often omits the refresh token; keep the old one.
      refreshToken: tokens.refreshToken || existing.refreshToken || null,
      connectedAt: existing.connectedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.data.accounts[platform];
  }

  remove(platform) {
    if (!this.data.accounts[platform]) return false;
    delete this.data.accounts[platform];
    this.save();
    return true;
  }

  // Deletes the whole vault. Used by `disconnect --all`.
  destroy() {
    this.data = { version: 1, accounts: {} };
    if (existsSync(this.file)) unlinkSync(this.file);
    return this;
  }

  // True when the token expires within `withinMinutes` and we can renew it.
  needsRefresh(platform, withinMinutes = 10) {
    const account = this.get(platform);
    if (!account?.expiresAt || !account.refreshToken) return false;
    return new Date(account.expiresAt).getTime() - Date.now() < withinMinutes * 60_000;
  }

  expired(platform) {
    const account = this.get(platform);
    if (!account?.expiresAt) return false;
    return new Date(account.expiresAt).getTime() <= Date.now();
  }
}

export function daysUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function statusOf(account) {
  if (!account?.accessToken) return 'disconnected';
  if (!account.expiresAt) return 'connected';
  const days = daysUntil(account.expiresAt);
  if (days < 0) return account.refreshToken ? 'expired (will refresh)' : 'expired - reconnect needed';
  if (days <= 7) return account.refreshToken ? `renews soon (${days}d)` : `expires in ${days}d - reconnect needed`;
  return `connected (${days}d)`;
}
