import { createHmac } from 'node:crypto';
import { defineAdapter, textFor, TIERS } from './base.js';
import { request } from '../http.js';

// The escape hatch for anything without a direct API: point this at Zapier,
// Make, n8n, Buffer, Hootsuite, Postiz, or your own relay, and that service
// fans the post out to the platforms this package cannot reach itself.
// Signed with HMAC-SHA256 so the receiver can verify the call really came
// from you before it publishes anything.
export default defineAdapter({
  id: 'webhook',
  label: 'Webhook relay (Zapier / Make / n8n / self-hosted)',
  tier: TIERS.RELAY,
  limits: {},
  docs: 'https://github.com/madsales/HeartLens/blob/main/autopost/README.md#webhook-relay',
  notes: 'Verify X-HeartLens-Signature on the receiving side before publishing.',
  required: (c) => ({ WEBHOOK_URL: c.platforms.webhook.url }),

  async publish(post, { config, timeoutMs }) {
    const { url, secret } = config.platforms.webhook;
    const payload = JSON.stringify({
      event: 'heartlens.post',
      sentAt: new Date().toISOString(),
      post: {
        id: post.id,
        title: post.title,
        text: textFor(post, 'webhook'),
        variants: post.variants || {},
        link: post.link,
        media: post.media || [],
        tags: post.tags || [],
      },
    });

    const headers = { 'content-type': 'application/json', 'user-agent': 'heartlens-autopost/1.0' };
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      // Timestamp is inside the signed material so a captured call cannot be
      // replayed indefinitely.
      headers['x-heartlens-timestamp'] = timestamp;
      headers['x-heartlens-signature'] = `sha256=${createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex')}`;
    }

    const res = await request(url, { method: 'POST', headers, body: payload, timeoutMs, expect: 'text' });
    return { id: '', url: null, raw: res.body };
  },
});
