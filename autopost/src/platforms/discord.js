import { defineAdapter, textFor, withLink, truncate, loadMedia, multipart, TIERS } from './base.js';
import { request } from '../http.js';

export default defineAdapter({
  id: 'discord',
  label: 'Discord',
  tier: TIERS.API,
  limits: { text: 2000, media: 10 },
  docs: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  notes: 'Channel settings -> Integrations -> Webhooks -> copy the webhook URL.',
  required: (c) => ({ DISCORD_WEBHOOK_URL: c.platforms.discord.webhookUrl }),

  async publish(post, { config, timeoutMs }) {
    const url = `${config.platforms.discord.webhookUrl}?wait=true`;
    const content = truncate(withLink(textFor(post, 'discord'), post.link), this.limits.text);
    const media = (post.media || []).slice(0, this.limits.media);

    if (media.length === 0) {
      const res = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        timeoutMs,
      });
      return { id: res.body?.id || '', url: null, raw: res.body };
    }

    const files = await Promise.all(media.map((m) => loadMedia(m, { timeoutMs })));
    const fields = {
      payload_json: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    };
    files.forEach((file, i) => { fields[`files[${i}]`] = file; });
    const form = multipart(fields);
    const res = await request(url, {
      method: 'POST',
      headers: { 'content-type': form.contentType },
      body: form.body,
      timeoutMs,
    });
    return { id: res.body?.id || '', url: null, raw: res.body };
  },
});
