import { defineAdapter, textFor, withLink, truncate, TIERS } from './base.js';
import { request } from '../http.js';

// Useful as an internal announcement channel for the same content, and as a
// smoke test that the pipeline works before pointing it at public platforms.
export default defineAdapter({
  id: 'slack',
  label: 'Slack',
  tier: TIERS.API,
  limits: { text: 3000, media: 0 },
  docs: 'https://api.slack.com/messaging/webhooks',
  notes: 'Incoming webhooks post text only; media is sent as a link.',
  required: (c) => ({ SLACK_WEBHOOK_URL: c.platforms.slack.webhookUrl }),

  async publish(post, { config, timeoutMs }) {
    let text = withLink(textFor(post, 'slack'), post.link);
    const remote = (post.media || []).filter((m) => /^https?:/i.test(m));
    if (remote.length) text += `\n${remote.join('\n')}`;
    const res = await request(config.platforms.slack.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: truncate(text, this.limits.text) }),
      timeoutMs,
      expect: 'text',
    });
    return { id: '', url: null, raw: res.body };
  },
});
