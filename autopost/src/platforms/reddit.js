import { defineAdapter, textFor, truncate, TIERS } from './base.js';
import { request, postForm } from '../http.js';

// Reddit is unusually strict about self-promotion: posting the same link to
// several subreddits, or only ever posting your own product, gets accounts
// banned. Set REDDIT_SUBREDDIT to a community whose rules allow it.
export default defineAdapter({
  id: 'reddit',
  label: 'Reddit',
  tier: TIERS.API,
  limits: { text: 40000, title: 300, media: 0 },
  docs: 'https://www.reddit.com/dev/api/#POST_api_submit',
  notes: 'Check each subreddit\'s self-promotion rules first. A script app plus refresh token is the supported path.',
  required: (c) => ({
    REDDIT_CLIENT_ID: c.platforms.reddit.clientId,
    REDDIT_CLIENT_SECRET: c.platforms.reddit.clientSecret,
    REDDIT_SUBREDDIT: c.platforms.reddit.subreddit,
    // Either a refresh token or a username/password pair satisfies this.
    REDDIT_REFRESH_TOKEN_OR_PASSWORD:
      c.platforms.reddit.refreshToken || c.platforms.reddit.password,
  }),

  async publish(post, { config, timeoutMs }) {
    const r = config.platforms.reddit;
    const basic = Buffer.from(`${r.clientId}:${r.clientSecret}`).toString('base64');
    const authHeaders = {
      authorization: `Basic ${basic}`,
      'user-agent': r.userAgent,
    };

    const grant = r.refreshToken
      ? { grant_type: 'refresh_token', refresh_token: r.refreshToken }
      : { grant_type: 'password', username: r.username, password: r.password };

    const token = await postForm('https://www.reddit.com/api/v1/access_token', grant, {
      headers: authHeaders,
      timeoutMs,
    });
    const accessToken = token.body?.access_token;
    if (!accessToken) throw new Error('Reddit returned no access_token');

    const title = truncate(post.title || textFor(post, 'reddit').split('\n')[0], this.limits.title);
    const fields = {
      sr: String(r.subreddit).replace(/^\/?r\//, ''),
      title,
      api_type: 'json',
      resubmit: 'true',
      sendreplies: 'true',
    };
    if (post.link) {
      fields.kind = 'link';
      fields.url = post.link;
    } else {
      fields.kind = 'self';
      fields.text = truncate(textFor(post, 'reddit'), this.limits.text);
    }

    const res = await postForm('https://oauth.reddit.com/api/submit', fields, {
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': r.userAgent },
      timeoutMs,
    });

    // Reddit answers 200 with the error inside the body, so this must be
    // checked explicitly or a rejected post looks like a success.
    const errors = res.body?.json?.errors;
    if (Array.isArray(errors) && errors.length) {
      throw new Error(`Reddit rejected the post: ${JSON.stringify(errors)}`);
    }
    const data = res.body?.json?.data;
    return { id: data?.id || data?.name || '', url: data?.url || null, raw: res.body };
  },
});
