import { defineAdapter, textFor, truncate, loadMedia, isVideo, isRemote, TIERS } from './base.js';
import { request, postJson } from '../http.js';

// TikTok gates direct publishing hard: until an app passes their audit, posts
// land in the account's drafts/inbox rather than going live, and unaudited
// apps can only post to the developer's own account. Treat a successful call
// here as "uploaded", not necessarily "published".
export default defineAdapter({
  id: 'tiktok',
  label: 'TikTok',
  tier: TIERS.REVIEW,
  limits: { text: 2200, media: 1 },
  verified: false,
  docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  notes: 'Video only, and direct-post needs an audited app. Unaudited apps upload to drafts for manual confirmation.',
  required: (c) => ({ TIKTOK_ACCESS_TOKEN: c.platforms.tiktok.accessToken }),

  skipReason(post) {
    const video = (post.media || []).find((m) => isVideo(m));
    return video ? null : 'no video attached (TikTok accepts video only)';
  },

  async publish(post, { config, timeoutMs }) {
    const { accessToken } = config.platforms.tiktok;
    const video = (post.media || []).find((m) => isVideo(m));
    if (!video) throw new Error('TikTok needs a video file or URL in post.media');

    const auth = { authorization: `Bearer ${accessToken}` };
    const title = truncate(textFor(post, 'tiktok'), this.limits.text);

    // A hosted URL lets TikTok pull the file; otherwise we upload the bytes.
    if (isRemote(video)) {
      const res = await postJson(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          post_info: { title, privacy_level: process.env.TIKTOK_PRIVACY || 'SELF_ONLY' },
          source_info: { source: 'PULL_FROM_URL', video_url: video },
        },
        { headers: auth, timeoutMs },
      );
      return { id: res.body?.data?.publish_id || '', url: null, raw: res.body };
    }

    const file = await loadMedia(video, { timeoutMs: Math.max(timeoutMs, 120000) });
    const init = await postJson(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: { title, privacy_level: process.env.TIKTOK_PRIVACY || 'SELF_ONLY' },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: file.buffer.length,
          chunk_size: file.buffer.length,
          total_chunk_count: 1,
        },
      },
      { headers: auth, timeoutMs },
    );
    const uploadUrl = init.body?.data?.upload_url;
    if (!uploadUrl) throw new Error('TikTok init returned no upload_url');

    await request(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.mime,
        'content-length': String(file.buffer.length),
        'content-range': `bytes 0-${file.buffer.length - 1}/${file.buffer.length}`,
      },
      body: file.buffer,
      timeoutMs: Math.max(timeoutMs, 600000),
      expect: 'text',
    });

    return { id: init.body?.data?.publish_id || '', url: null, raw: init.body };
  },
});
