import { defineAdapter, textFor, withLink, splitThread, isRemote, isVideo, TIERS } from './base.js';
import { request } from '../http.js';

const BASE = 'https://graph.threads.net/v1.0';

export default defineAdapter({
  id: 'threads',
  label: 'Threads',
  tier: TIERS.REVIEW,
  limits: { text: 500, media: 1 },
  docs: 'https://developers.facebook.com/docs/threads/posts',
  notes: 'Needs the threads_basic and threads_content_publish scopes. Media must be a public https URL.',
  required: (c) => ({
    THREADS_USER_ID: c.platforms.threads.userId,
    THREADS_ACCESS_TOKEN: c.platforms.threads.accessToken,
  }),

  async publish(post, { config, timeoutMs }) {
    const { userId, accessToken } = config.platforms.threads;
    const media = (post.media || []).find((m) => isRemote(m));
    const parts = splitThread(withLink(textFor(post, 'threads'), post.link), this.limits.text);

    let replyTo = null;
    let first = null;

    for (const [i, text] of parts.entries()) {
      const fields = { text, access_token: accessToken, media_type: 'TEXT' };
      if (i === 0 && media) {
        fields.media_type = isVideo(media) ? 'VIDEO' : 'IMAGE';
        fields[isVideo(media) ? 'video_url' : 'image_url'] = media;
      }
      if (replyTo) fields.reply_to_id = replyTo;

      const created = await request(`${BASE}/${userId}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        timeoutMs,
      });
      const creationId = created.body?.id;
      if (!creationId) throw new Error('Threads container creation returned no id');

      // Containers are not instantly publishable; a short settle avoids a
      // race the API documents for media posts.
      if (fields.media_type !== 'TEXT') await new Promise((r) => setTimeout(r, 15000));

      const published = await request(`${BASE}/${userId}/threads_publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
        timeoutMs,
      });
      replyTo = published.body?.id;
      first ||= published.body;
    }

    return { id: first?.id || '', url: null, raw: first };
  },
});
