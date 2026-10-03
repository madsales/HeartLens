import { defineAdapter, textFor, withLink, splitThread, loadMedia, multipart, TIERS } from './base.js';
import { request } from '../http.js';

export default defineAdapter({
  id: 'mastodon',
  label: 'Mastodon',
  tier: TIERS.API,
  limits: { text: 500, media: 4 },
  docs: 'https://docs.joinmastodon.org/methods/statuses/',
  notes: 'Settings -> Development -> New application, with the write:statuses and write:media scopes.',
  required: (c) => ({
    MASTODON_BASE_URL: c.platforms.mastodon.baseUrl,
    MASTODON_ACCESS_TOKEN: c.platforms.mastodon.accessToken,
  }),

  async publish(post, { config, timeoutMs }) {
    const { baseUrl, accessToken } = config.platforms.mastodon;
    const root = baseUrl.replace(/\/+$/, '');
    const auth = { authorization: `Bearer ${accessToken}` };

    const mediaIds = [];
    for (const ref of (post.media || []).slice(0, this.limits.media)) {
      const file = await loadMedia(ref, { timeoutMs });
      const form = multipart({ file });
      const up = await request(`${root}/api/v2/media`, {
        method: 'POST',
        headers: { ...auth, 'content-type': form.contentType },
        body: form.body,
        timeoutMs,
      });
      if (up.body?.id) mediaIds.push(up.body.id);
    }

    // A body over the instance limit becomes a self-reply thread.
    const parts = splitThread(withLink(textFor(post, 'mastodon'), post.link), this.limits.text);
    let replyTo = null;
    let first = null;
    for (const [i, part] of parts.entries()) {
      const payload = { status: part, visibility: 'public' };
      if (i === 0 && mediaIds.length) payload.media_ids = mediaIds;
      if (replyTo) payload.in_reply_to_id = replyTo;
      const res = await request(`${root}/api/v1/statuses`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs,
      });
      replyTo = res.body?.id;
      first ||= res.body;
    }
    return { id: first?.id || '', url: first?.url || null, raw: first };
  },
});
