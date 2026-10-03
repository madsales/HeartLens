// OAuth 2.0 provider definitions -- the "Connect account" layer that replaces
// hand-pasted API keys.
//
// IMPORTANT, and the reason this is not quite Buffer: Buffer is a *reviewed
// platform partner*, so their one app can post on behalf of any user. Self-
// hosting means you are your own developer app, so you register the app and
// (on Meta, TikTok, LinkedIn, Pinterest) go through their review before posts
// from a normal account go live. The flow below is identical to Buffer's; the
// approval is the part you still do yourself.
//
// Endpoints move. Each entry carries a docs link, and `verified: false` marks
// the ones I could not exercise against a live account -- check the docs if a
// call 4xxs rather than assuming the code is right.

const scopes = (...s) => s.join(' ');

export const PROVIDERS = {
  x: {
    id: 'x',
    label: 'X (Twitter)',
    authUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scope: scopes('tweet.read', 'tweet.write', 'users.read', 'offline.access'),
    pkce: true,            // X requires PKCE even for confidential clients
    clientAuth: 'basic',
    docs: 'https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code',
    setup: 'developer.x.com -> your project -> User authentication settings. Type: Web App. Permissions: Read and write.',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    verified: false,
    // X access tokens are short-lived (hours), so offline.access matters.
    async identify(accessToken, { request }) {
      const me = await request('https://api.x.com/2/users/me', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return { accountId: me.body?.data?.id, accountName: me.body?.data?.username ? `@${me.body.data.username}` : null };
    },
  },

  reddit: {
    id: 'reddit',
    label: 'Reddit',
    authUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scope: scopes('identity', 'submit'),
    pkce: false,
    clientAuth: 'basic',
    // Without duration=permanent Reddit issues no refresh token at all.
    extraAuthParams: { duration: 'permanent' },
    docs: 'https://github.com/reddit-archive/reddit/wiki/OAuth2',
    setup: 'reddit.com/prefs/apps -> create app -> type "web app".',
    clientIdEnv: 'REDDIT_CLIENT_ID',
    clientSecretEnv: 'REDDIT_CLIENT_SECRET',
    verified: false,
    async identify(accessToken, { request, config }) {
      const me = await request('https://oauth.reddit.com/api/v1/me', {
        headers: {
          authorization: `Bearer ${accessToken}`,
          'user-agent': config.platforms.reddit.userAgent,
        },
      });
      return { accountId: me.body?.id, accountName: me.body?.name ? `u/${me.body.name}` : null };
    },
  },

  mastodon: {
    id: 'mastodon',
    label: 'Mastodon',
    // Mastodon is per-instance, so these are built from MASTODON_BASE_URL.
    dynamic: (config) => {
      const base = String(config.platforms.mastodon.baseUrl || '').replace(/\/+$/, '');
      if (!base) throw new Error('Set MASTODON_BASE_URL before connecting Mastodon.');
      return { authUrl: `${base}/oauth/authorize`, tokenUrl: `${base}/oauth/token` };
    },
    scope: scopes('write:statuses', 'write:media', 'read:accounts'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://docs.joinmastodon.org/client/authorized/',
    setup: 'Your instance -> Preferences -> Development -> New application.',
    clientIdEnv: 'MASTODON_CLIENT_ID',
    clientSecretEnv: 'MASTODON_CLIENT_SECRET',
    verified: false,
    async identify(accessToken, { request, config }) {
      const base = String(config.platforms.mastodon.baseUrl).replace(/\/+$/, '');
      const me = await request(`${base}/api/v1/accounts/verify_credentials`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return { accountId: me.body?.id, accountName: me.body?.acct ? `@${me.body.acct}` : null };
    },
  },

  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: scopes('w_member_social', 'openid', 'profile'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow',
    setup: 'linkedin.com/developers -> your app -> Products -> request "Share on LinkedIn" / "Sign In with LinkedIn".',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    needsReview: true,
    verified: false,
    async identify(accessToken, { request }) {
      const me = await request('https://api.linkedin.com/v2/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      // The posting adapter needs the URN, not the bare id.
      return {
        accountId: me.body?.sub,
        accountName: me.body?.name || null,
        extra: { authorUrn: me.body?.sub ? `urn:li:person:${me.body.sub}` : null },
      };
    },
  },

  facebook: {
    id: 'facebook',
    label: 'Facebook Page',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scope: scopes('pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'business_management'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
    setup: 'developers.facebook.com -> create app -> add Facebook Login. Page posting needs App Review.',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    needsReview: true,
    verified: false,
    // Meta hands back a short-lived user token; exchange it for a long-lived
    // one, then for a Page token, which is what actually posts.
    async postProcess(tokens, { request, config }) {
      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      const v = config.platforms.facebook.apiVersion;

      const long = await request(
        `https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: tokens.accessToken,
        })}`,
      );
      const userToken = long.body?.access_token || tokens.accessToken;

      const pages = await request(
        `https://graph.facebook.com/${v}/me/accounts?${new URLSearchParams({ access_token: userToken })}`,
      );
      const page = (pages.body?.data || [])[0];
      if (!page) {
        throw new Error('No Facebook Page found on this account. The API cannot post to personal profiles.');
      }
      return {
        // Page tokens derived from a long-lived user token generally do not expire.
        accessToken: page.access_token,
        expiresAt: null,
        accountId: page.id,
        accountName: page.name,
        extra: { pageId: page.id, userToken, pages: (pages.body.data || []).map((p) => ({ id: p.id, name: p.name })) },
      };
    },
  },

  instagram: {
    id: 'instagram',
    label: 'Instagram (Business/Creator)',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scope: scopes('instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
    setup: 'Instagram must be a Business/Creator account linked to a Facebook Page. Publishing needs App Review.',
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    needsReview: true,
    verified: false,
    async postProcess(tokens, { request, config }) {
      const v = config.platforms.instagram.apiVersion;
      const long = await request(
        `https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          fb_exchange_token: tokens.accessToken,
        })}`,
      );
      const userToken = long.body?.access_token || tokens.accessToken;

      // The IG user id hangs off the linked Page, not off the user directly.
      const pages = await request(
        `https://graph.facebook.com/${v}/me/accounts?${new URLSearchParams({
          fields: 'id,name,instagram_business_account',
          access_token: userToken,
        })}`,
      );
      const linked = (pages.body?.data || []).find((p) => p.instagram_business_account?.id);
      if (!linked) {
        throw new Error(
          'No Instagram Business account is linked to any Page on this login. Convert the account to Business/Creator and link it to a Page first.',
        );
      }
      return {
        accessToken: userToken,
        expiresAt: long.body?.expires_in ? new Date(Date.now() + long.body.expires_in * 1000).toISOString() : null,
        accountId: linked.instagram_business_account.id,
        accountName: linked.name,
        extra: { userId: linked.instagram_business_account.id, pageId: linked.id },
      };
    },
  },

  threads: {
    id: 'threads',
    label: 'Threads',
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scope: scopes('threads_basic', 'threads_content_publish'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://developers.facebook.com/docs/threads/get-started',
    setup: 'developers.facebook.com -> create app -> add the Threads API use case.',
    clientIdEnv: 'THREADS_APP_ID',
    clientSecretEnv: 'THREADS_APP_SECRET',
    needsReview: true,
    verified: false,
    async postProcess(tokens, { request }) {
      // Short-lived -> long-lived (around 60 days), refreshable thereafter.
      const long = await request(
        `https://graph.threads.net/access_token?${new URLSearchParams({
          grant_type: 'th_exchange_token',
          client_secret: process.env.THREADS_APP_SECRET,
          access_token: tokens.accessToken,
        })}`,
      );
      return {
        accessToken: long.body?.access_token || tokens.accessToken,
        expiresAt: long.body?.expires_in ? new Date(Date.now() + long.body.expires_in * 1000).toISOString() : null,
      };
    },
    async identify(accessToken, { request }) {
      const me = await request(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`);
      return {
        accountId: me.body?.id,
        accountName: me.body?.username ? `@${me.body.username}` : null,
        extra: { userId: me.body?.id },
      };
    },
  },

  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    authUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scope: scopes('boards:read', 'pins:read', 'pins:write'),
    pkce: false,
    clientAuth: 'basic',
    docs: 'https://developers.pinterest.com/docs/getting-started/authentication/',
    setup: 'developers.pinterest.com -> your app. New apps start in trial access until reviewed.',
    clientIdEnv: 'PINTEREST_APP_ID',
    clientSecretEnv: 'PINTEREST_APP_SECRET',
    needsReview: true,
    verified: false,
    async identify(accessToken, { request }) {
      const me = await request('https://api.pinterest.com/v5/user_account', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      return { accountId: me.body?.id, accountName: me.body?.username ? `@${me.body.username}` : null };
    },
  },

  tumblr: {
    id: 'tumblr',
    label: 'Tumblr',
    authUrl: 'https://www.tumblr.com/oauth2/authorize',
    tokenUrl: 'https://api.tumblr.com/v2/oauth2/token',
    scope: scopes('basic', 'write', 'offline_access'),
    pkce: false,
    clientAuth: 'body',
    docs: 'https://www.tumblr.com/docs/en/api/v2',
    setup: 'tumblr.com/oauth/apps -> register an application.',
    clientIdEnv: 'TUMBLR_CLIENT_ID',
    clientSecretEnv: 'TUMBLR_CLIENT_SECRET',
    verified: false,
    async identify(accessToken, { request }) {
      const me = await request('https://api.tumblr.com/v2/user/info', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const blog = me.body?.response?.user?.blogs?.[0];
      return {
        accountId: blog?.name,
        accountName: blog?.name || null,
        extra: { blogIdentifier: blog?.name ? `${blog.name}.tumblr.com` : null },
      };
    },
  },

  youtube: {
    id: 'youtube',
    label: 'YouTube',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: scopes('https://www.googleapis.com/auth/youtube.upload'),
    pkce: true,
    clientAuth: 'body',
    // Google only returns a refresh token on the first consent unless forced.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    docs: 'https://developers.google.com/youtube/v3/guides/auth/installed-apps',
    setup: 'console.cloud.google.com -> enable YouTube Data API v3 -> OAuth client (Web application).',
    clientIdEnv: 'YOUTUBE_CLIENT_ID',
    clientSecretEnv: 'YOUTUBE_CLIENT_SECRET',
    verified: false,
  },

  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: scopes('user.info.basic', 'video.publish', 'video.upload'),
    pkce: true,
    clientAuth: 'body',
    // TikTok names this client_key rather than client_id.
    clientIdParam: 'client_key',
    docs: 'https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens',
    setup: 'developers.tiktok.com -> your app -> add Content Posting API. Direct posting requires an audit.',
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    needsReview: true,
    verified: false,
  },
};

export const getProvider = (id) => PROVIDERS[String(id || '').toLowerCase()] || null;

// Platforms that do not use OAuth at all -- there is nothing to "connect",
// you paste one value and you are done.
export const NON_OAUTH = {
  telegram: 'Create a bot with @BotFather and set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.',
  discord: 'Channel -> Integrations -> Webhooks -> set DISCORD_WEBHOOK_URL.',
  slack: 'Create an incoming webhook and set SLACK_WEBHOOK_URL.',
  bluesky: 'Settings -> App Passwords. Set BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD.',
  webhook: 'Set WEBHOOK_URL (and WEBHOOK_SECRET) to your relay endpoint.',
  outbox: 'Always available. No credentials needed.',
};

// Resolves a provider's endpoints, applying any per-instance overrides.
export function resolveProvider(id, config) {
  const provider = getProvider(id);
  if (!provider) return null;
  return provider.dynamic ? { ...provider, ...provider.dynamic(config) } : provider;
}
