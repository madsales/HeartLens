import { createHash } from 'node:crypto';
import { resolveTargets } from './platforms/index.js';
import { textFor, truncate } from './platforms/base.js';
import { sleep } from './http.js';

// Identity of a post's *content*, used to spot a repeat publish. Normalised
// so trivial whitespace differences do not defeat it.
export function contentHash(post) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256')
    .update([norm(post.text), norm(post.link), (post.media || []).join('|')].join('\u0000'))
    .digest('hex')
    .slice(0, 32);
}

function backoff(attempt, baseMs) {
  const capped = Math.min(baseMs * 2 ** (attempt - 1), 60_000);
  // Jitter keeps several platforms from retrying in lockstep.
  return Math.round(capped * (0.75 + Math.random() * 0.5));
}

async function attemptPublish(adapter, post, ctx) {
  const { config, logger } = ctx;
  let lastError;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const started = Date.now();
      const result = await adapter.publish(post, {
        config,
        timeoutMs: config.requestTimeoutMs,
        logger,
      });
      return {
        ok: true,
        attempt,
        ms: Date.now() - started,
        id: result?.id || '',
        url: result?.url || null,
      };
    } catch (err) {
      lastError = err;
      const retryable = err.retryable !== false && attempt < config.maxAttempts;
      logger.warn(`${adapter.id}: attempt ${attempt} failed${retryable ? ', retrying' : ''}`, {
        error: err.message,
        status: err.status,
        body: err.body,
      });
      if (!retryable) break;
      await sleep(backoff(attempt, config.retryBaseMs));
    }
  }

  return {
    ok: false,
    attempt: config.maxAttempts,
    error: lastError?.message || 'unknown error',
    status: lastError?.status,
    detail: lastError?.body,
  };
}

/**
 * Sends one post to every resolved platform.
 *
 * Platforms are independent: one failing never stops the others, which is why
 * `failOpen` defaults to true. The post is only marked published if at least
 * one platform accepted it.
 */
export async function publishPost(post, ctx) {
  const { config, store, logger } = ctx;
  const only = ctx.only || post.platforms || null;
  const dryRun = ctx.dryRun ?? config.dryRun;
  // ctx.targets lets a caller supply the adapter list directly; the registry
  // is consulted otherwise. Used by the test suite to avoid real network calls.
  const { ready, notConfigured, unknown } = ctx.targets
    ? { ready: ctx.targets, notConfigured: [], unknown: [] }
    : resolveTargets(config, { only });

  if (unknown.length) logger.warn(`Unknown platform(s) ignored: ${unknown.join(', ')}`);

  const hash = contentHash(post);
  if (!ctx.force && !dryRun) {
    const dupe = store.recentlyPublished(hash, config.duplicateWindowHours);
    if (dupe) {
      logger.warn(
        `Skipping: identical content already published at ${dupe.at} (within ${config.duplicateWindowHours}h). Use --force to override.`,
      );
      return { skipped: true, reason: 'duplicate', duplicateOf: dupe.at, results: [], hash };
    }
  }

  if (ready.length === 0) {
    logger.error('No platform is both enabled and credentialed. Run `doctor` to see what is missing.');
    return { skipped: true, reason: 'no-targets', notConfigured, results: [], hash };
  }

  logger.info(
    `${dryRun ? '[DRY RUN] ' : ''}Publishing "${(post.title || textFor(post, 'default')).slice(0, 60)}" to ${ready.length} platform(s): ${ready.map((a) => a.id).join(', ')}`,
  );

  const results = [];
  for (const adapter of ready) {
    // A platform may legitimately not apply to this post (YouTube with no video).
    const skip = adapter.skipReason?.(post);
    if (skip) {
      logger.info(`${adapter.id}: skipped - ${skip}`);
      results.push({ platform: adapter.id, ok: false, skipped: true, reason: skip });
      continue;
    }

    // Respect a minimum gap so a burst does not trip rate limits or look spammy.
    const state = store.platform(adapter.id);
    if (!dryRun && state.lastPostedAt && config.minGapMinutes > 0) {
      const sinceMin = (Date.now() - new Date(state.lastPostedAt).getTime()) / 60000;
      if (sinceMin < config.minGapMinutes && !ctx.force) {
        const wait = Math.ceil(config.minGapMinutes - sinceMin);
        logger.info(`${adapter.id}: skipped - last post was ${Math.floor(sinceMin)}m ago, min gap is ${config.minGapMinutes}m (${wait}m to go)`);
        results.push({ platform: adapter.id, ok: false, skipped: true, reason: `min gap ${config.minGapMinutes}m not elapsed` });
        continue;
      }
    }

    if (dryRun) {
      const body = textFor(post, adapter.id);
      const limit = adapter.limits?.text;
      results.push({
        platform: adapter.id,
        ok: true,
        dryRun: true,
        preview: truncate(body, limit || 280),
        chars: body.length,
        limit: limit ?? null,
        wouldTruncate: Boolean(limit && body.length > limit),
      });
      logger.info(`${adapter.id}: [dry run] ${body.length}${limit ? `/${limit}` : ''} chars`);
      continue;
    }

    const outcome = await attemptPublish(adapter, post, ctx);
    store.markPlatform(adapter.id, { ok: outcome.ok });
    results.push({ platform: adapter.id, ...outcome });
    if (outcome.ok) {
      logger.info(`${adapter.id}: published${outcome.url ? ` -> ${outcome.url}` : ''}`);
    } else {
      logger.error(`${adapter.id}: failed - ${outcome.error}`);
      if (!config.failOpen) {
        logger.error('FAIL_OPEN=false, stopping the rest of this run.');
        break;
      }
    }
  }

  const anySuccess = results.some((r) => r.ok && !r.skipped);
  const delivered = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok && !r.skipped).length;

  if (!dryRun) {
    store.addHistory({
      postId: post.id,
      hash,
      title: post.title || null,
      anySuccess,
      delivered,
      failed,
      results: results.map(({ platform, ok, skipped, url, error, reason }) => ({
        platform, ok, skipped, url, error, reason,
      })),
    });
    if (post.id && store.getPost(post.id)) {
      store.updatePost(post.id, {
        status: anySuccess ? 'published' : 'failed',
        publishedAt: anySuccess ? new Date().toISOString() : null,
        results,
      });
    }
  }

  logger.info(
    `${dryRun ? '[DRY RUN] ' : ''}Done: ${delivered} delivered, ${failed} failed, ${results.filter((r) => r.skipped).length} skipped.`,
  );

  return { skipped: false, dryRun, anySuccess, delivered, failed, results, hash, notConfigured };
}
