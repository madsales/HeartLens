import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PKG_ROOT } from './config.js';

export const DEFAULT_PACK = join(PKG_ROOT, 'src/content/heartlens-pack.json');

// Replaces {{site}} / {{siteUrl}} / {{date}} and any custom token.
export function render(text, vars) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function templateVars(config, extra = {}) {
  const site = String(config.siteUrl || '').replace(/\/+$/, '');
  return {
    site,
    siteUrl: site,
    date: new Date().toISOString().slice(0, 10),
    ...extra,
  };
}

export function loadPack(file = DEFAULT_PACK) {
  if (!existsSync(file)) throw new Error(`Content pack not found: ${file}`);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(pack.posts) || pack.posts.length === 0) {
    throw new Error(`Content pack ${file} has no posts`);
  }
  return pack;
}

// Turns a pack entry into a post, applying pack defaults and templating.
export function materialise(entry, pack, config, extraVars = {}) {
  const vars = templateVars(config, extraVars);
  const defaults = pack.defaults || {};
  const variants = {};
  for (const [platform, text] of Object.entries(entry.variants || {})) {
    variants[platform] = render(text, vars);
  }
  return {
    title: entry.title || null,
    text: render(entry.text || '', vars),
    variants,
    link: render(entry.link || defaults.link || '', vars) || null,
    media: entry.media || defaults.media || [],
    tags: entry.tags || defaults.tags || [],
    source: `pack:${pack.name || 'unnamed'}`,
  };
}

// Round-robins through the pack so repeated runs do not resend post #1.
export function nextFromPack(store, config, { file = DEFAULT_PACK, advance = true } = {}) {
  const pack = loadPack(file);
  const index = (store.data.cursor || 0) % pack.posts.length;
  const entry = pack.posts[index];
  if (advance) store.advanceCursor();
  return { post: materialise(entry, pack, config), index, total: pack.posts.length, pack };
}
