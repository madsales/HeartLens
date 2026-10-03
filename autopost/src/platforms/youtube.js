import { defineAdapter, textFor, truncate, loadMedia, isVideo, TIERS } from './base.js';
import { request, postForm } from '../http.js';

// YouTube only accepts video, so a text-only post is skipped rather than
// failed -- that keeps a text post from marking the whole run as broken.
export default defineAdapter({
  id: 'youtube',
  label: 'YouTube (Shorts / video)',
  tier: TIERS.API,
  limits: { text: 5000, title: 100, media: 1 },
  docs: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  notes: 'Video only. An unverified app uploads as private; verification is needed for public uploads.',
  required: (c) => ({
    YOUTUBE_CLIENT_ID: c.platforms.youtube.clientId,
    YOUTUBE_CLIENT_SECRET: c.platforms.youtube.clientSecret,
    YOUTUBE_REFRESH_TOKEN: c.platforms.youtube.refreshToken,
  }),

  // Called by the publisher before publish(); a falsy reason means "post it".
  skipReason(post) {
    const video = (post.media || []).find((m) => isVideo(m));
    return video ? null : 'no video attached (YouTube accepts video only)';
  },

  async publish(post, { config, timeoutMs }) {
    const { clientId, clientSecret, refreshToken } = config.platforms.youtube;
    const video = (post.media || []).find((m) => isVideo(m));
    if (!video) throw new Error('YouTube needs a video file or URL in post.media');

    const token = await postForm(
      'https://oauth2.googleapis.com/token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      { timeoutMs },
    );
    const accessToken = token.body?.access_token;
    if (!accessToken) throw new Error('Google OAuth returned no access_token');

    const file = await loadMedia(video, { timeoutMs: Math.max(timeoutMs, 120000) });
    const metadata = {
      snippet: {
        title: truncate(post.title || 'HeartLens', this.limits.title),
        description: truncate(textFor(post, 'youtube'), this.limits.text),
        tags: (post.tags || []).slice(0, 15),
        categoryId: '22',
      },
      status: { privacyStatus: process.env.YOUTUBE_PRIVACY || 'public', selfDeclaredMadeForKids: false },
    };

    // Resumable upload: start a session, then PUT the bytes to the returned URL.
    const init = await request(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-upload-content-length': String(file.buffer.length),
          'x-upload-content-type': file.mime,
        },
        body: JSON.stringify(metadata),
        timeoutMs,
        expect: 'text',
      },
    );
    const uploadUrl = init.headers?.get?.('location');
    if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');

    const done = await request(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.mime, 'content-length': String(file.buffer.length) },
      body: file.buffer,
      timeoutMs: Math.max(timeoutMs, 600000),
    });
    const id = done.body?.id || '';
    return { id, url: id ? `https://youtu.be/${id}` : null, raw: done.body };
  },
});
