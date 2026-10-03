import { defineAdapter, textFor, truncate, isRemote, TIERS } from './base.js';
import { postJson } from '../http.js';

export default defineAdapter({
  id: 'pinterest',
  label: 'Pinterest',
  tier: TIERS.REVIEW,
  limits: { text: 500, title: 100, media: 1 },
  verified: false,
  docs: 'https://developers.pinterest.com/docs/api/v5/pins-create/',
  notes: 'Every pin needs an image. Apps start in trial access and need review for full production use.',
  required: (c) => ({
    PINTEREST_ACCESS_TOKEN: c.platforms.pinterest.accessToken,
    PINTEREST_BOARD_ID: c.platforms.pinterest.boardId,
  }),

  async publish(post, { config, timeoutMs }) {
    const { accessToken, boardId } = config.platforms.pinterest;
    const image = (post.media || []).find((m) => isRemote(m));
    if (!image) {
      const err = new Error('Pinterest requires a publicly reachable https image URL on the post.');
      err.retryable = false;
      throw err;
    }

    const res = await postJson(
      'https://api.pinterest.com/v5/pins',
      {
        board_id: boardId,
        title: truncate(post.title || 'HeartLens', this.limits.title),
        description: truncate(textFor(post, 'pinterest'), this.limits.text),
        link: post.link || undefined,
        media_source: { source_type: 'image_url', url: image },
      },
      { headers: { authorization: `Bearer ${accessToken}` }, timeoutMs },
    );
    const id = res.body?.id || '';
    return { id, url: id ? `https://www.pinterest.com/pin/${id}/` : null, raw: res.body };
  },
});
