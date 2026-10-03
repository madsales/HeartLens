import { defineAdapter, textFor, withLink, truncate, isRemote, isVideo, TIERS } from './base.js';
import { request } from '../http.js';

// Instagram publishes in two steps: create a media container, then publish it.
// The container only accepts a PUBLIC https URL -- the API will not take
// uploaded bytes -- so media must be hosted somewhere reachable first.
export default defineAdapter({
  id: 'instagram',
  label: 'Instagram (Business/Creator)',
  tier: TIERS.REVIEW,
  limits: { text: 2200, media: 1 },
  docs: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  notes: 'Requires a Business or Creator account linked to a Facebook Page, and a publicly hosted media URL.',
  required: (c) => ({
    INSTAGRAM_USER_ID: c.platforms.instagram.userId,
    INSTAGRAM_ACCESS_TOKEN: c.platforms.instagram.accessToken,
  }),

  async publish(post, { config, timeoutMs }) {
    const { userId, accessToken, apiVersion } = config.platforms.instagram;
    const base = `https://graph.facebook.com/${apiVersion}`;
    const media = (post.media || []).find((m) => isRemote(m));

    if (!media) {
      // Not a soft-failure we should paper over: a caption with no image is
      // not a valid Instagram post.
      const err = new Error(
        'Instagram needs a publicly reachable https media URL. Add one to the post (local file paths are not accepted by the API).',
      );
      err.retryable = false;
      throw err;
    }

    const caption = truncate(withLink(textFor(post, 'instagram'), post.link), this.limits.text);
    const container = { caption, access_token: accessToken };
    if (isVideo(media)) {
      container.media_type = 'REELS';
      container.video_url = media;
    } else {
      container.image_url = media;
    }

    const created = await request(`${base}/${userId}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(container).toString(),
      timeoutMs,
    });
    const creationId = created.body?.id;
    if (!creationId) throw new Error('Instagram container creation returned no id');

    // Video containers transcode asynchronously; publishing too early fails.
    if (isVideo(media)) {
      await waitForContainer(base, creationId, accessToken, timeoutMs);
    }

    const published = await request(`${base}/${userId}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }).toString(),
      timeoutMs,
    });
    const id = published.body?.id || '';
    return { id, url: id ? `https://www.instagram.com/p/${id}` : null, raw: published.body };
  },
});

async function waitForContainer(base, creationId, accessToken, timeoutMs, maxWaitMs = 300000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const st = await request(
      `${base}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
      { timeoutMs },
    );
    const code = st.body?.status_code;
    if (code === 'FINISHED') return;
    if (code === 'ERROR') throw new Error(`Instagram container failed: ${st.body?.status || 'unknown'}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Instagram container did not finish processing in time');
}
