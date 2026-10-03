import { defineAdapter, textFor, isRemote, TIERS } from './base.js';
import { request } from '../http.js';

export default defineAdapter({
  id: 'facebook',
  label: 'Facebook Page',
  tier: TIERS.REVIEW,
  limits: { text: 63206, media: 1 },
  docs: 'https://developers.facebook.com/docs/pages-api/posts',
  notes: 'Needs a Page access token with pages_manage_posts. Personal profiles cannot be posted to via the API.',
  required: (c) => ({
    FACEBOOK_PAGE_ID: c.platforms.facebook.pageId,
    FACEBOOK_PAGE_ACCESS_TOKEN: c.platforms.facebook.accessToken,
  }),

  async publish(post, { config, timeoutMs }) {
    const { pageId, accessToken, apiVersion } = config.platforms.facebook;
    const base = `https://graph.facebook.com/${apiVersion}`;
    const message = textFor(post, 'facebook');
    const photo = (post.media || []).find((m) => isRemote(m));

    // The Graph API takes a publicly reachable URL, not uploaded bytes, so a
    // local-only file falls back to a plain text post rather than failing.
    if (photo) {
      const res = await request(`${base}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          url: photo,
          caption: message,
          published: 'true',
          access_token: accessToken,
        }).toString(),
        timeoutMs,
      });
      const id = res.body?.post_id || res.body?.id || '';
      return { id, url: id ? `https://facebook.com/${id}` : null, raw: res.body };
    }

    const fields = { message, access_token: accessToken };
    if (post.link) fields.link = post.link;
    const res = await request(`${base}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      timeoutMs,
    });
    const id = res.body?.id || '';
    return { id, url: id ? `https://facebook.com/${id}` : null, raw: res.body };
  },
});
