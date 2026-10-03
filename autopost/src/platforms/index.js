import x from './x.js';
import facebook from './facebook.js';
import instagram from './instagram.js';
import threads from './threads.js';
import linkedin from './linkedin.js';
import reddit from './reddit.js';
import telegram from './telegram.js';
import discord from './discord.js';
import slack from './slack.js';
import mastodon from './mastodon.js';
import bluesky from './bluesky.js';
import pinterest from './pinterest.js';
import tumblr from './tumblr.js';
import youtube from './youtube.js';
import tiktok from './tiktok.js';
import webhook from './webhook.js';
import outbox from './outbox.js';

export const ADAPTERS = [
  x, bluesky, mastodon, threads,
  facebook, instagram, linkedin, reddit,
  telegram, discord, slack,
  pinterest, tumblr, youtube, tiktok,
  webhook, outbox,
];

export const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export const getAdapter = (id) => BY_ID.get(String(id || '').toLowerCase()) || null;

// The platforms a run should actually target: credentialed, and allowed by
// ENABLED_PLATFORMS when that list is set.
//
// An explicit empty list means "no platforms" and must resolve to nothing. It
// is NOT the same as omitting the list, which means "every ready platform" --
// conflating the two would fan a post out to everything at the moment the
// caller asked for nothing.
export function resolveTargets(config, { only = null } = {}) {
  const explicit = Array.isArray(only);
  const allow = (explicit ? only : config.enabledPlatforms).map((s) => String(s).toLowerCase());

  const chosen = allow.length
    ? allow.map((id) => getAdapter(id)).filter(Boolean)
    : explicit
      ? []           // caller passed [] -- they meant none
      : ADAPTERS;    // nothing specified anywhere -- every ready platform

  const unknown = allow.filter((id) => !getAdapter(id));

  const ready = [];
  const notConfigured = [];
  for (const adapter of chosen) {
    if (adapter.configured(config)) ready.push(adapter);
    else notConfigured.push({ id: adapter.id, missing: adapter.missing(config) });
  }
  return { ready, notConfigured, unknown };
}

export function statusReport(config) {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.label,
    tier: a.tier,
    verified: a.verified !== false,
    configured: a.configured(config),
    missing: a.missing(config),
    limits: a.limits,
    notes: a.notes,
    docs: a.docs,
    lastPostedAt: null,
  }));
}
