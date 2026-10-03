import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { request } from '../http.js';

export const TIERS = {
  // Direct publish over an official API with ordinary credentials.
  API: 'api',
  // Direct publish, but the platform gates it behind app review / an audit
  // before it will accept a post from a real account.
  REVIEW: 'review',
  // Goes out through a relay you control (webhook, Zapier, Make, n8n).
  RELAY: 'relay',
  // No usable publish API: written to an outbox for a human to paste.
  MANUAL: 'manual',
};

// Collapses a post into the text a given platform should receive: an explicit
// per-platform variant wins, otherwise the shared body.
export function textFor(post, platformId) {
  const variant = post?.variants?.[platformId];
  return (typeof variant === 'string' && variant.trim() ? variant : post?.text || '').trim();
}

export function withLink(text, link, { separator = '\n\n' } = {}) {
  if (!link) return text;
  if (text.includes(link)) return text;
  return `${text}${separator}${link}`;
}

// Trims on a word boundary so a cut body does not end mid-word.
export function truncate(text, max, { ellipsis = '…' } = {}) {
  if (!Number.isFinite(max) || text.length <= max) return text;
  const room = Math.max(0, max - ellipsis.length);
  const slice = text.slice(0, room);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > room * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}${ellipsis}`;
}

// Splits a long body into a numbered thread (X, Mastodon, Bluesky, Threads).
export function splitThread(text, max) {
  if (text.length <= max) return [text];
  const suffixRoom = 8; // room for " (12/34)"
  const chunkMax = max - suffixRoom;
  const words = text.split(/\s+/);
  const chunks = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > chunkMax && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  const total = chunks.length;
  return chunks.map((chunk, i) => (total > 1 ? `${chunk} (${i + 1}/${total})` : chunk));
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function mimeFor(pathOrUrl) {
  const ext = extname(String(pathOrUrl).split('?')[0]).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

export const isRemote = (m) => /^https?:\/\//i.test(String(m));
export const isVideo = (m) => mimeFor(m).startsWith('video/');

// Loads a media reference into a Buffer, from disk or over HTTP.
export async function loadMedia(ref, { timeoutMs = 60000 } = {}) {
  if (isRemote(ref)) {
    const res = await fetch(ref, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Could not fetch media ${ref}: HTTP ${res.status}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get('content-type') || mimeFor(ref),
      name: basename(new URL(ref).pathname) || 'media',
    };
  }
  return { buffer: await readFile(ref), mime: mimeFor(ref), name: basename(ref) };
}

// Builds a multipart/form-data body without a dependency. `fields` values are
// strings or { buffer, mime, name } media descriptors.
export function multipart(fields) {
  const boundary = `----heartlens${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (value && value.buffer) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name || name}"\r\n` +
            `Content-Type: ${value.mime || 'application/octet-stream'}\r\n\r\n`,
        ),
        value.buffer,
        Buffer.from('\r\n'),
      );
    } else {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// Every adapter is created through this, so each one gets the same shape and
// the same readiness reporting that `doctor` and the dashboard rely on.
//
// An adapter declares `required(config)` returning a map of env-var name ->
// resolved value. Readiness is then just "which of those are empty", with no
// guessing about how an env name maps to a config field.
export function defineAdapter(spec) {
  if (typeof spec.id !== 'string' || !spec.id) throw new Error('adapter needs an id');
  if (typeof spec.publish !== 'function') throw new Error(`adapter ${spec.id} needs publish()`);

  return {
    tier: TIERS.API,
    limits: {},
    notes: '',
    docs: '',
    verified: true,
    required: () => ({}),
    ...spec,

    // Required env vars with no value set.
    missing(config) {
      const resolved = this.required(config) || {};
      return Object.entries(resolved)
        .filter(([, value]) => value === undefined || value === null || value === '')
        .map(([name]) => name);
    },

    needs(config) {
      return Object.keys(this.required(config) || {});
    },

    configured(config) {
      return this.missing(config).length === 0;
    },
  };
}

export { request };
