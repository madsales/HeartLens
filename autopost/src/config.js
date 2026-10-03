import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig({ envFile, overrides = {} } = {}) {
  const file = envFile || process.env.HEARTLENS_ENV_FILE || join(PKG_ROOT, '.env');
  loadEnvFile(file);
  const e = { ...process.env, ...overrides };

  return {
    envFile: file,
    dataDir: resolve(e.DATA_DIR || join(PKG_ROOT, 'data')),

    // Safety rail. Nothing reaches a live API until this is explicitly false.
    dryRun: bool(e.DRY_RUN, true),

    timezone: e.TIMEZONE || 'UTC',
    logLevel: e.LOG_LEVEL || 'info',

    // Which platforms the fan-out touches. Empty = every platform that is
    // both configured and credentialed.
    enabledPlatforms: list(e.ENABLED_PLATFORMS),

    // Scheduler
    schedule: e.SCHEDULE || '0 9,17 * * *',
    scheduleEnabled: bool(e.SCHEDULE_ENABLED, true),
    tickSeconds: int(e.TICK_SECONDS, 30),
    maxPerRun: int(e.MAX_PER_RUN, 1),
    minGapMinutes: int(e.MIN_GAP_MINUTES, 30),
    recycleContent: bool(e.RECYCLE_CONTENT, true),

    // Delivery behaviour
    maxAttempts: int(e.MAX_ATTEMPTS, 3),
    retryBaseMs: int(e.RETRY_BASE_MS, 2000),
    requestTimeoutMs: int(e.REQUEST_TIMEOUT_MS, 30000),
    failOpen: bool(e.FAIL_OPEN, true),
    duplicateWindowHours: int(e.DUPLICATE_WINDOW_HOURS, 72),

    // Dashboard
    port: int(e.PORT, 4310),
    host: e.HOST || '127.0.0.1',
    dashboardToken: e.DASHBOARD_TOKEN || '',

    siteUrl: e.SITE_URL || 'https://heartlens.app',

    platforms: {
      x: {
        apiKey: e.X_API_KEY,
        apiSecret: e.X_API_SECRET,
        accessToken: e.X_ACCESS_TOKEN,
        accessSecret: e.X_ACCESS_SECRET,
      },
      facebook: {
        pageId: e.FACEBOOK_PAGE_ID,
        accessToken: e.FACEBOOK_PAGE_ACCESS_TOKEN,
        apiVersion: e.FACEBOOK_API_VERSION || 'v21.0',
      },
      instagram: {
        userId: e.INSTAGRAM_USER_ID,
        accessToken: e.INSTAGRAM_ACCESS_TOKEN,
        apiVersion: e.INSTAGRAM_API_VERSION || 'v21.0',
      },
      threads: {
        userId: e.THREADS_USER_ID,
        accessToken: e.THREADS_ACCESS_TOKEN,
      },
      linkedin: {
        accessToken: e.LINKEDIN_ACCESS_TOKEN,
        authorUrn: e.LINKEDIN_AUTHOR_URN,
      },
      reddit: {
        clientId: e.REDDIT_CLIENT_ID,
        clientSecret: e.REDDIT_CLIENT_SECRET,
        refreshToken: e.REDDIT_REFRESH_TOKEN,
        username: e.REDDIT_USERNAME,
        password: e.REDDIT_PASSWORD,
        subreddit: e.REDDIT_SUBREDDIT,
        userAgent: e.REDDIT_USER_AGENT || 'heartlens-autopost/1.0',
      },
      telegram: {
        botToken: e.TELEGRAM_BOT_TOKEN,
        chatId: e.TELEGRAM_CHAT_ID,
      },
      discord: {
        webhookUrl: e.DISCORD_WEBHOOK_URL,
      },
      slack: {
        webhookUrl: e.SLACK_WEBHOOK_URL,
      },
      mastodon: {
        baseUrl: e.MASTODON_BASE_URL,
        accessToken: e.MASTODON_ACCESS_TOKEN,
      },
      bluesky: {
        service: e.BLUESKY_SERVICE || 'https://bsky.social',
        identifier: e.BLUESKY_IDENTIFIER,
        appPassword: e.BLUESKY_APP_PASSWORD,
      },
      pinterest: {
        accessToken: e.PINTEREST_ACCESS_TOKEN,
        boardId: e.PINTEREST_BOARD_ID,
      },
      tumblr: {
        accessToken: e.TUMBLR_ACCESS_TOKEN,
        blogIdentifier: e.TUMBLR_BLOG_IDENTIFIER,
      },
      youtube: {
        clientId: e.YOUTUBE_CLIENT_ID,
        clientSecret: e.YOUTUBE_CLIENT_SECRET,
        refreshToken: e.YOUTUBE_REFRESH_TOKEN,
      },
      tiktok: {
        accessToken: e.TIKTOK_ACCESS_TOKEN,
      },
      webhook: {
        url: e.WEBHOOK_URL,
        secret: e.WEBHOOK_SECRET,
      },
      outbox: {
        dir: e.OUTBOX_DIR,
        enabled: bool(e.OUTBOX_ENABLED, true),
      },
    },
  };
}
