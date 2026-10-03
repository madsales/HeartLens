import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { PKG_ROOT } from './config.js';
import { statusReport, ADAPTERS } from './platforms/index.js';
import { publishPost } from './publisher.js';
import { nextFromPack, loadPack, materialise } from './content.js';
import { describeCron } from './cron.js';
import { redact } from './logger.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const json = (res, status, payload) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // The dashboard is a local tool; lock the page down rather than relying
    // on the network boundary alone.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
};

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

export function createApp({ config, store, logger, scheduler }) {
  const ctx = () => ({ config, store, logger });

  const authorised = (req) => {
    if (!config.dashboardToken) return true;
    const header = req.headers.authorization || '';
    const bearer = header.replace(/^Bearer\s+/i, '');
    const url = new URL(req.url, 'http://localhost');
    const supplied = bearer || url.searchParams.get('token') || req.headers['x-dashboard-token'] || '';
    return Boolean(supplied) && safeEqual(supplied, config.dashboardToken);
  };

  const routes = {
    'GET /api/status': async () => {
      const platforms = statusReport(config).map((p) => ({
        ...p,
        lastPostedAt: store.data.platformState[p.id]?.lastPostedAt || null,
        successes: store.data.platformState[p.id]?.successes || 0,
        failures: store.data.platformState[p.id]?.failures || 0,
      }));
      let packInfo = { total: 0, cursor: store.data.cursor || 0 };
      try {
        const pack = loadPack();
        packInfo = {
          name: pack.name,
          total: pack.posts.length,
          cursor: store.data.cursor || 0,
          nextIndex: (store.data.cursor || 0) % pack.posts.length,
        };
      } catch { /* pack is optional */ }

      return {
        ok: true,
        dryRun: config.dryRun,
        siteUrl: config.siteUrl,
        timezone: config.timezone,
        schedule: describeCron(config.schedule, config.timezone),
        scheduleEnabled: config.scheduleEnabled,
        scheduler: scheduler ? scheduler.describe() : null,
        readyCount: platforms.filter((p) => p.configured).length,
        platforms,
        queued: store.queued().length,
        pack: packInfo,
        history: store.data.history.slice(0, 20),
      };
    },

    // The one-click endpoint. With no body it takes the next pack item;
    // with { text } it posts exactly that.
    'POST /api/post-now': async (req) => {
      const body = await readBody(req);
      let post;
      if (body.text && String(body.text).trim()) {
        post = {
          id: null,
          title: body.title || null,
          text: String(body.text),
          variants: body.variants || {},
          link: body.link ?? config.siteUrl,
          media: Array.isArray(body.media) ? body.media : [],
          tags: body.tags || [],
          source: 'dashboard',
        };
      } else if (body.postId) {
        post = store.getPost(body.postId);
        if (!post) return { status: 404, payload: { ok: false, error: 'No queued post with that id' } };
      } else {
        post = nextFromPack(store, config).post;
      }

      const result = await publishPost(post, {
        ...ctx(),
        only: body.platforms || null,
        dryRun: body.dryRun ?? config.dryRun,
        force: Boolean(body.force),
      });
      return { ok: true, post: { title: post.title, text: post.text }, result: redact(result) };
    },

    'GET /api/queue': async () => ({ ok: true, posts: store.data.posts.slice(-100).reverse() }),

    'POST /api/queue': async (req) => {
      const body = await readBody(req);
      if (!body.text || !String(body.text).trim()) {
        return { status: 400, payload: { ok: false, error: 'text is required' } };
      }
      const post = store.addPost({
        title: body.title,
        text: String(body.text),
        variants: body.variants || {},
        link: body.link ?? config.siteUrl,
        media: Array.isArray(body.media) ? body.media : [],
        tags: body.tags || [],
        platforms: body.platforms || null,
        scheduledAt: body.scheduledAt || null,
        source: 'dashboard',
      });
      return { ok: true, post };
    },

    'POST /api/queue/delete': async (req) => {
      const body = await readBody(req);
      const removed = store.removePost(body.id);
      return removed ? { ok: true } : { status: 404, payload: { ok: false, error: 'not found' } };
    },

    // Loads the whole pack into the queue, spaced by MIN_GAP_MINUTES.
    'POST /api/queue/fill-from-pack': async (req) => {
      const body = await readBody(req);
      const pack = loadPack();
      const spacingMin = Number(body.spacingMinutes) > 0 ? Number(body.spacingMinutes) : null;
      const start = body.startAt ? new Date(body.startAt) : null;
      const added = pack.posts.map((entry, i) => {
        const draft = materialise(entry, pack, config);
        const scheduledAt =
          start && spacingMin
            ? new Date(start.getTime() + i * spacingMin * 60_000).toISOString()
            : null;
        return store.addPost({ ...draft, scheduledAt });
      });
      return { ok: true, added: added.length };
    },

    'GET /api/pack': async () => {
      const pack = loadPack();
      return {
        ok: true,
        name: pack.name,
        cursor: store.data.cursor || 0,
        posts: pack.posts.map((entry, i) => ({ index: i, ...materialise(entry, pack, config) })),
      };
    },

    'POST /api/run-now': async () => {
      if (!scheduler) return { status: 400, payload: { ok: false, error: 'Scheduler is not running in this process' } };
      const result = await scheduler.runOnce({ trigger: 'dashboard' });
      return { ok: true, result: redact(result) };
    },

    'GET /api/platforms': async () => ({
      ok: true,
      platforms: ADAPTERS.map((a) => ({
        id: a.id, label: a.label, tier: a.tier, limits: a.limits,
        notes: a.notes, docs: a.docs, verified: a.verified !== false,
        missing: a.missing(config),
      })),
    }),
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const key = `${req.method} ${url.pathname}`;

    try {
      if (url.pathname.startsWith('/api/')) {
        if (!authorised(req)) return json(res, 401, { ok: false, error: 'Unauthorised. Supply DASHBOARD_TOKEN.' });
        const handler = routes[key];
        if (!handler) return json(res, 404, { ok: false, error: `No route ${key}` });
        const out = await handler(req, url);
        if (out && out.status && out.payload) return json(res, out.status, out.payload);
        return json(res, 200, out);
      }

      // Static dashboard files.
      let file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      // Browsers request /favicon.ico unprompted; serve the SVG for it.
      if (file === 'favicon.ico') file = 'favicon.svg';
      // normalize + prefix check keeps "../" out of the public dir.
      const target = join(PKG_ROOT, 'public', normalize(file));
      if (!target.startsWith(join(PKG_ROOT, 'public'))) {
        return json(res, 403, { ok: false, error: 'Forbidden' });
      }
      const data = await readFile(target);
      res.writeHead(200, {
        'content-type': MIME[extname(target)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch (err) {
      if (err.code === 'ENOENT') return json(res, 404, { ok: false, error: 'Not found' });
      logger.error(`Request ${key} failed: ${err.message}`);
      json(res, 500, { ok: false, error: err.message });
    }
  });
}

export function serve({ config, store, logger, scheduler }) {
  const server = createApp({ config, store, logger, scheduler });
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      const base = `http://${config.host}:${config.port}`;
      logger.info(`Dashboard on ${base}${config.dashboardToken ? `?token=${'*'.repeat(8)}` : ''}`);
      if (!config.dashboardToken && config.host !== '127.0.0.1' && config.host !== 'localhost') {
        logger.warn(`HOST is ${config.host} with no DASHBOARD_TOKEN set - anyone who can reach this port can post as you.`);
      }
      resolve(server);
    });
  });
}
