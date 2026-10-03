import { defineAdapter, textFor, withLink, splitThread, loadMedia, TIERS } from './base.js';
import { request } from '../http.js';

// Links in a Bluesky post are only clickable if the record carries "facets"
// with byte offsets into the UTF-8 encoding of the text -- character offsets
// would land in the wrong place for any post containing emoji or accents.
export function linkFacets(text) {
  const bytes = Buffer.from(text, 'utf8');
  const facets = [];
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const byteStart = Buffer.byteLength(text.slice(0, match.index), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(match[0], 'utf8');
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }
  return { facets, byteLength: bytes.length };
}

export default defineAdapter({
  id: 'bluesky',
  label: 'Bluesky',
  tier: TIERS.API,
  limits: { text: 300, media: 4 },
  docs: 'https://docs.bsky.app/docs/advanced-guides/posting',
  notes: 'Use an app password (Settings -> App Passwords), never your account password.',
  required: (c) => ({
    BLUESKY_IDENTIFIER: c.platforms.bluesky.identifier,
    BLUESKY_APP_PASSWORD: c.platforms.bluesky.appPassword,
  }),

  async publish(post, { config, timeoutMs }) {
    const { service, identifier, appPassword } = config.platforms.bluesky;
    const root = String(service || 'https://bsky.social').replace(/\/+$/, '');

    const session = await request(`${root}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword }),
      timeoutMs,
    });
    const jwt = session.body?.accessJwt;
    const did = session.body?.did;
    if (!jwt || !did) throw new Error('Bluesky login did not return a session token');
    const auth = { authorization: `Bearer ${jwt}` };

    const images = [];
    for (const ref of (post.media || []).slice(0, this.limits.media)) {
      const file = await loadMedia(ref, { timeoutMs });
      const up = await request(`${root}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: { ...auth, 'content-type': file.mime },
        body: file.buffer,
        timeoutMs,
      });
      if (up.body?.blob) images.push({ alt: post.title || 'HeartLens', image: up.body.blob });
    }

    const parts = splitThread(withLink(textFor(post, 'bluesky'), post.link), this.limits.text);
    let parent = null;
    let rootRef = null;
    let first = null;

    for (const [i, part] of parts.entries()) {
      const { facets } = linkFacets(part);
      const record = {
        $type: 'app.bsky.feed.post',
        text: part,
        createdAt: new Date().toISOString(),
        langs: ['en'],
      };
      if (facets.length) record.facets = facets;
      if (i === 0 && images.length) {
        record.embed = { $type: 'app.bsky.embed.images', images };
      }
      if (parent && rootRef) {
        record.reply = { root: rootRef, parent };
      }
      const res = await request(`${root}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
        timeoutMs,
      });
      const ref = { uri: res.body?.uri, cid: res.body?.cid };
      parent = ref;
      rootRef ||= ref;
      first ||= res.body;
    }

    const rkey = String(first?.uri || '').split('/').pop();
    return {
      id: first?.uri || '',
      url: rkey ? `https://bsky.app/profile/${identifier}/post/${rkey}` : null,
      raw: first,
    };
  },
});
