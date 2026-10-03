import { defineAdapter, textFor, withLink, truncate, loadMedia, multipart, isVideo, TIERS } from './base.js';
import { request } from '../http.js';

export default defineAdapter({
  id: 'telegram',
  label: 'Telegram',
  tier: TIERS.API,
  limits: { text: 4096, caption: 1024, media: 1 },
  docs: 'https://core.telegram.org/bots/api',
  notes: 'Create a bot with @BotFather, then add it to your channel as an admin.',
  required: (c) => ({
    TELEGRAM_BOT_TOKEN: c.platforms.telegram.botToken,
    TELEGRAM_CHAT_ID: c.platforms.telegram.chatId,
  }),

  async publish(post, { config, timeoutMs }) {
    const { botToken, chatId } = config.platforms.telegram;
    const api = (method) => `https://api.telegram.org/bot${botToken}/${method}`;
    const body = withLink(textFor(post, 'telegram'), post.link);
    const media = post.media?.[0];

    if (!media) {
      const res = await request(api('sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: truncate(body, this.limits.text),
          disable_web_page_preview: false,
        }),
        timeoutMs,
      });
      const msg = res.body?.result;
      return { id: String(msg?.message_id ?? ''), url: messageUrl(msg), raw: res.body };
    }

    const file = await loadMedia(media, { timeoutMs });
    const method = isVideo(media) ? 'sendVideo' : 'sendPhoto';
    const field = isVideo(media) ? 'video' : 'photo';
    const form = multipart({
      chat_id: String(chatId),
      caption: truncate(body, this.limits.caption),
      [field]: file,
    });
    const res = await request(api(method), {
      method: 'POST',
      headers: { 'content-type': form.contentType },
      body: form.body,
      timeoutMs,
    });
    const msg = res.body?.result;
    return { id: String(msg?.message_id ?? ''), url: messageUrl(msg), raw: res.body };
  },
});

function messageUrl(msg) {
  const username = msg?.chat?.username;
  if (!username || !msg?.message_id) return null;
  return `https://t.me/${username}/${msg.message_id}`;
}
