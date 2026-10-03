#!/usr/bin/env node
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { Store } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';
import { publishPost } from '../src/publisher.js';
import { serve } from '../src/server.js';
import { statusReport, resolveTargets, ADAPTERS } from '../src/platforms/index.js';
import { nextFromPack, loadPack, materialise } from '../src/content.js';
import { describeCron } from '../src/cron.js';

// Tiny flag parser: --key=value, --key value, --flag, and positional args.
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) { flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags[body] = next; i += 1; }
    else flags[body] = true;
  }
  return { flags, positional };
}

const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const truthy = (v) => v === true || /^(1|true|yes)$/i.test(String(v));

const HELP = `
HeartLens Auto-Poster

  heartlens-autopost <command> [options]

Commands
  setup                 Create .env from the template and print next steps
  doctor                Show every platform, what is wired up and what is missing
  postnow [text]        Post once, right now, to every ready platform  (the 1-click path)
  queue <text>          Add a post to the queue
  list                  Show the queue and recent history
  pack                  Show the built-in HeartLens content pack
  fill                  Load the whole content pack into the queue
  run                   Run one scheduled cycle immediately, then exit
  daemon                Keep running and post on the schedule
  serve                 Start the dashboard (and the scheduler unless --no-schedule)
  next                  Print the next few scheduled run times
  help                  This text

Options
  --platforms x,bluesky   Limit to these platforms (default: every ready one)
  --dry-run / --live      Override DRY_RUN for this command
  --force                 Ignore the duplicate guard and the minimum gap
  --title "..."           Title for Reddit / YouTube / Pinterest
  --link URL              Link to attach
  --media a.png,b.jpg     Media paths or public https URLs
  --at "2026-10-04T09:00" Schedule time for \`queue\`
  --no-schedule           For \`serve\`: dashboard only, no scheduler
  --json                  Machine-readable output where it applies
  --env FILE              Use a different .env file

Examples
  heartlens-autopost doctor
  heartlens-autopost postnow --dry-run
  heartlens-autopost postnow "Understand the vibe before you text." --live
  heartlens-autopost queue "New feature out today" --at "2026-10-05T18:30"
  heartlens-autopost serve
`;

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = (positional.shift() || 'help').toLowerCase();

  if (command === 'help' || flags.help) { console.log(HELP); return 0; }

  const overrides = {};
  if (truthy(flags['dry-run'])) overrides.DRY_RUN = 'true';
  if (truthy(flags.live)) overrides.DRY_RUN = 'false';
  if (flags.platforms) overrides.ENABLED_PLATFORMS = flags.platforms;

  const config = loadConfig({ envFile: flags.env, overrides });
  const logger = createLogger({ level: flags.quiet ? 'warn' : config.logLevel });
  const store = new Store(config.dataDir);
  if (store.loadError) {
    logger.warn(`The store was unreadable and has been reset; the old file is at ${store.loadError.backup}`);
  }
  const ctx = { config, store, logger };

  const only = list(flags.platforms);
  const buildPost = (text) => ({
    id: null,
    title: typeof flags.title === 'string' ? flags.title : null,
    text,
    link: typeof flags.link === 'string' ? flags.link : config.siteUrl,
    media: list(flags.media) || [],
    tags: list(flags.tags) || [],
    source: 'cli',
  });

  switch (command) {
    case 'setup': return await cmdSetup(config, logger);

    case 'doctor': {
      const report = statusReport(config).map((p) => ({
        ...p,
        lastPostedAt: store.data.platformState[p.id]?.lastPostedAt || null,
      }));
      if (truthy(flags.json)) {
        console.log(JSON.stringify({ config: safeConfig(config), platforms: report }, null, 2));
        return 0;
      }
      printDoctor(config, report, store);
      return report.some((p) => p.configured) ? 0 : 1;
    }

    case 'postnow': {
      const text = positional.join(' ').trim();
      const post = text ? buildPost(text) : nextFromPack(store, config).post;
      if (!text) logger.info(`No text given, so using the next content pack item: "${post.title}"`);
      const result = await publishPost(post, { ...ctx, only, force: truthy(flags.force) });
      if (truthy(flags.json)) console.log(JSON.stringify(result, null, 2));
      return result.skipped || result.failed > 0 ? 1 : 0;
    }

    case 'queue': {
      const text = positional.join(' ').trim();
      if (!text) { logger.error('Give the post text: heartlens-autopost queue "your text"'); return 1; }
      const post = store.addPost({
        ...buildPost(text),
        platforms: only,
        scheduledAt: flags.at ? new Date(flags.at).toISOString() : null,
      });
      logger.info(`Queued ${post.id}${post.scheduledAt ? ` for ${post.scheduledAt}` : ' for the next scheduled run'}.`);
      return 0;
    }

    case 'list': {
      const pending = store.queued();
      console.log(`\nQueue (${pending.length})`);
      if (!pending.length) console.log('  (empty - a scheduled run will fall back to the content pack)');
      for (const p of pending) {
        console.log(`  ${p.id.slice(0, 8)}  ${p.scheduledAt || 'next run'}  ${oneLine(p.text, 60)}`);
      }
      console.log(`\nRecent history (${store.data.history.length})`);
      if (!store.data.history.length) console.log('  (nothing published yet)');
      for (const h of store.data.history.slice(0, 10)) {
        const ok = h.results.filter((r) => r.ok && !r.skipped).map((r) => r.platform);
        const bad = h.results.filter((r) => !r.ok && !r.skipped).map((r) => r.platform);
        console.log(`  ${h.at}  ok:[${ok.join(',')}]${bad.length ? ` failed:[${bad.join(',')}]` : ''}`);
      }
      console.log('');
      return 0;
    }

    case 'pack': {
      const pack = loadPack();
      const cursor = store.data.cursor || 0;
      console.log(`\n${pack.name} - ${pack.posts.length} posts (next up: #${(cursor % pack.posts.length) + 1})\n`);
      pack.posts.forEach((entry, i) => {
        const m = materialise(entry, pack, config);
        const marker = i === cursor % pack.posts.length ? '>' : ' ';
        console.log(`${marker} ${String(i + 1).padStart(2)}. ${m.title}`);
        console.log(`     ${oneLine(m.text, 92)}`);
      });
      console.log('');
      return 0;
    }

    case 'fill': {
      const pack = loadPack();
      const spacing = Number(flags.spacing) > 0 ? Number(flags.spacing) : null;
      const start = flags.at ? new Date(flags.at) : null;
      let added = 0;
      pack.posts.forEach((entry, i) => {
        const draft = materialise(entry, pack, config);
        store.addPost({
          ...draft,
          platforms: only,
          scheduledAt: start && spacing ? new Date(start.getTime() + i * spacing * 60000).toISOString() : null,
        });
        added += 1;
      });
      logger.info(`Queued ${added} posts${start && spacing ? ` starting ${start.toISOString()}, ${spacing}m apart` : ''}.`);
      return 0;
    }

    case 'run': {
      const scheduler = new Scheduler(ctx);
      const result = await scheduler.runOnce({ trigger: 'cli' });
      if (truthy(flags.json)) console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    case 'next': {
      const info = describeCron(config.schedule, config.timezone);
      if (!info.valid) { logger.error(`SCHEDULE is invalid: ${info.error}`); return 1; }
      const scheduler = new Scheduler(ctx);
      let cursor = new Date();
      console.log(`\nSchedule "${info.source}" in ${config.timezone}:`);
      for (let i = 0; i < Number(flags.count || 5); i += 1) {
        const next = scheduler.nextRunAt(cursor);
        if (!next) break;
        console.log(`  ${next.toISOString()}   (${next.toLocaleString('en-US', { timeZone: config.timezone })} ${config.timezone})`);
        cursor = next;
      }
      console.log('');
      return 0;
    }

    case 'daemon': {
      preflight(config, logger);
      const scheduler = new Scheduler(ctx).start();
      shutdownOn(() => scheduler.stop(), logger);
      await new Promise(() => {}); // run until signalled
      return 0;
    }

    case 'serve': {
      preflight(config, logger);
      const wantSchedule = config.scheduleEnabled && !truthy(flags['no-schedule']);
      const scheduler = new Scheduler(ctx);
      if (wantSchedule) scheduler.start();
      else logger.info('Scheduler is off; the dashboard still posts on demand.');
      const server = await serve({ ...ctx, scheduler });
      shutdownOn(() => { scheduler.stop(); server.close(); }, logger);
      await new Promise(() => {});
      return 0;
    }

    default:
      console.error(`Unknown command "${command}".`);
      console.log(HELP);
      return 1;
  }
}

// ---- helpers -------------------------------------------------------------

const oneLine = (s, n) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

function safeConfig(config) {
  return {
    dryRun: config.dryRun, timezone: config.timezone, schedule: config.schedule,
    enabledPlatforms: config.enabledPlatforms, minGapMinutes: config.minGapMinutes,
    maxPerRun: config.maxPerRun, dataDir: config.dataDir, siteUrl: config.siteUrl,
  };
}

// Shouted once at startup so a live daemon is never a surprise.
function preflight(config, logger) {
  const { ready } = resolveTargets(config);
  if (!ready.length) {
    logger.warn('No platform is credentialed yet. Runs will only write to the outbox. Try `doctor`.');
  }
  if (config.dryRun) {
    logger.warn('DRY_RUN is on: posts are previewed, never sent. Set DRY_RUN=false in .env to go live.');
  } else {
    logger.warn(`LIVE MODE: posts will really be published to ${ready.map((a) => a.id).join(', ') || '(nothing)'}.`);
  }
}

function printDoctor(config, report, store) {
  const tick = (b) => (b ? '\u001b[32mOK  \u001b[0m' : '\u001b[33m--  \u001b[0m');
  console.log('\nHeartLens Auto-Poster - doctor\n');
  console.log(`  env file        ${config.envFile}`);
  console.log(`  data dir        ${config.dataDir}`);
  console.log(`  mode            ${config.dryRun ? 'DRY RUN (nothing is sent)' : 'LIVE'}`);
  const cron = describeCron(config.schedule, config.timezone);
  console.log(`  schedule        ${config.schedule} (${config.timezone})${cron.valid ? '' : `  <-- INVALID: ${cron.error}`}`);
  if (cron.valid) console.log(`  next run        ${cron.next}`);
  console.log(`  min gap         ${config.minGapMinutes} min per platform`);
  console.log(`  queue           ${store.queued().length} waiting`);
  console.log(`  enabled filter  ${config.enabledPlatforms.length ? config.enabledPlatforms.join(', ') : '(all ready platforms)'}`);

  const groups = { api: 'Direct API', review: 'Direct API (needs platform review)', relay: 'Relay', manual: 'Manual' };
  for (const [tier, heading] of Object.entries(groups)) {
    const rows = report.filter((p) => p.tier === tier);
    if (!rows.length) continue;
    console.log(`\n  ${heading}`);
    for (const p of rows) {
      const flag = p.verified ? '' : ' \u001b[33m(endpoint unverified - check docs)\u001b[0m';
      console.log(`    ${tick(p.configured)} ${p.label}${flag}`);
      if (!p.configured) console.log(`         set: ${p.missing.join(', ')}`);
      else if (p.lastPostedAt) console.log(`         last posted ${p.lastPostedAt}`);
    }
  }

  const readyCount = report.filter((p) => p.configured).length;
  console.log(`\n  ${readyCount} of ${report.length} platforms ready.`);
  if (readyCount <= 1) console.log('  Add credentials to .env, then run doctor again. See README.md for how to get each one.');
  console.log('');
}

function shutdownOn(fn, logger) {
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (closing) process.exit(1);
      closing = true;
      logger.info(`${signal} received, shutting down.`);
      try { fn(); } catch { /* best effort */ }
      setTimeout(() => process.exit(0), 200).unref();
    });
  }
}

async function cmdSetup(config, logger) {
  const { copyFile, access } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { PKG_ROOT } = await import('../src/config.js');
  const target = config.envFile;
  const template = join(PKG_ROOT, '.env.example');
  try {
    await access(target);
    logger.info(`${target} already exists; leaving it alone.`);
  } catch {
    await copyFile(template, target);
    logger.info(`Created ${target} from the template.`);
  }
  console.log(`
Next steps
  1. Open ${target} and fill in whichever platforms you want. Each block says where to get the values.
  2. heartlens-autopost doctor        - confirms what is wired up
  3. heartlens-autopost postnow       - a dry-run post, so nothing is sent yet
  4. Set DRY_RUN=false when the previews look right
  5. heartlens-autopost serve         - dashboard + scheduler on http://${config.host}:${config.port}

You can skip all credentials and still use it: the outbox target writes each
post to a file for you to paste by hand.
`);
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    if (process.env.LOG_LEVEL === 'debug') console.error(err.stack);
    process.exit(1);
  });
