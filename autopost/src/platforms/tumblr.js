import { defineAdapter, textFor, withLink, TIERS } from './base.js';
import { postJson } from '../http.js';

export default defineAdapter({
  id: 'tumblr',
  label: 'Tumblr',
  tier: TIERS.API,
  limits: { text: 4096, media: 0 },
  verified: false,
  docs: 'https://www.tumblr.com/docs/en/api/v2#posting',
  notes: 'Uses the Neue Post Format endpoint. TUMBLR_BLOG_IDENTIFIER is like myblog.tumblr.com.',
  required: (c) => ({
    TUMBLR_ACCESS_TOKEN: c.platforms.tumblr.accessToken,
    TUMBLR_BLOG_IDENTIFIER: c.platforms.tumblr.blogIdentifier,
  }),

  async publish(post, { config, timeoutMs }) {
    const { accessToken, blogIdentifier } = config.platforms.tumblr;
    const content = [{ type: 'text', text: withLink(textFor(post, 'tumblr'), post.link) }];
    const res = await postJson(
      `https://api.tumblr.com/v2/blog/${blogIdentifier}/posts`,
      { content, state: 'published', tags: (post.tags || []).join(',') },
      { headers: { authorization: `Bearer ${accessToken}` }, timeoutMs },
    );
    const id = res.body?.response?.id || '';
    return { id: String(id), url: null, raw: res.body };
  },
});
