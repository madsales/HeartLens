import { defineAdapter, textFor, withLink, splitThread, loadMedia, multipart, isVideo, TIERS } from './base.js';
import { oauth1Header } from '../oauth1.js';
import { request } from '../http.js';

const TWEET_URL = 'https://api.twitter.com/2/tweets';
const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

function signed(method, url, creds, params = {}) {
  const { header } = oauth1Header({
    method,
    url,
    params,
    consumerKey: creds.apiKey,
    consumerSecret: creds.apiSecret,
    token: creds.accessToken,
    tokenSecret: creds.accessSecret,
  });
  return header;
}

// v1.1 chunked upload: INIT -> APPEND(n) -> FINALIZE. Still the documented
// path for attaching media to a v2 tweet at the time of writing.
async function uploadMedia(ref, creds, timeoutMs) {
  const file = await loadMedia(ref, { timeoutMs });
  const category = isVideo(ref) ? 'tweet_video' : 'tweet_image';

  const initParams = {
    command: 'INIT',
    total_bytes: String(file.buffer.length),
    media_type: file.mime,
    media_category: category,
  };
  const init = await request(UPLOAD_URL, {
    method: 'POST',
    headers: {
      authorization: signed('POST', UPLOAD_URL, creds, initParams),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(initParams).toString(),
    timeoutMs,
  });
  const mediaId = init.body?.media_id_string;
  if (!mediaId) throw new Error('X media INIT returned no media_id_string');

  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, index = 0; i < file.buffer.length; i += CHUNK, index += 1) {
    const chunk = file.buffer.subarray(i, i + CHUNK);
    // APPEND is multipart, so only the oauth_* params are signed -- the
    // media bytes stay out of the signature base string.
    const form = multipart({
      command: 'APPEND',
      media_id: mediaId,
      segment_index: String(index),
      media: { buffer: chunk, mime: 'application/octet-stream', name: 'blob' },
    });
    await request(UPLOAD_URL, {
      method: 'POST',
      headers: {
        authorization: signed('POST', UPLOAD_URL, creds),
        'content-type': form.contentType,
      },
      body: form.body,
      timeoutMs,
    });
  }

  const finalParams = { command: 'FINALIZE', media_id: mediaId };
  const fin = await request(UPLOAD_URL, {
    method: 'POST',
    headers: {
      authorization: signed('POST', UPLOAD_URL, creds, finalParams),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(finalParams).toString(),
    timeoutMs,
  });

  // Video needs transcoding before it can be attached.
  let info = fin.body?.processing_info;
  let waited = 0;
  while (info && info.state !== 'succeeded' && waited < 120000) {
    if (info.state === 'failed') {
      throw new Error(`X media processing failed: ${JSON.stringify(info.error || info)}`);
    }
    const wait = Math.max(1000, (info.check_after_secs || 2) * 1000);
    await new Promise((r) => setTimeout(r, wait));
    waited += wait;
    const statusParams = { command: 'STATUS', media_id: mediaId };
    const url = `${UPLOAD_URL}?${new URLSearchParams(statusParams)}`;
    const st = await request(url, {
      method: 'GET',
      headers: { authorization: signed('GET', url, creds) },
      timeoutMs,
    });
    info = st.body?.processing_info;
  }
  return mediaId;
}

export default defineAdapter({
  id: 'x',
  label: 'X (Twitter)',
  tier: TIERS.API,
  limits: { text: 280, media: 4 },
  docs: 'https://docs.x.com/x-api/posts/creation-of-a-post',
  notes: 'Needs a project with Read and Write permissions; regenerate the access token after changing permissions.',
  required: (c) => ({
    X_API_KEY: c.platforms.x.apiKey,
    X_API_SECRET: c.platforms.x.apiSecret,
    X_ACCESS_TOKEN: c.platforms.x.accessToken,
    X_ACCESS_SECRET: c.platforms.x.accessSecret,
  }),

  async publish(post, { config, timeoutMs }) {
    const creds = config.platforms.x;
    const mediaIds = [];
    for (const ref of (post.media || []).slice(0, this.limits.media)) {
      mediaIds.push(await uploadMedia(ref, creds, timeoutMs));
    }

    const parts = splitThread(withLink(textFor(post, 'x'), post.link), this.limits.text);
    let replyTo = null;
    let first = null;

    for (const [i, text] of parts.entries()) {
      const payload = { text };
      if (i === 0 && mediaIds.length) payload.media = { media_ids: mediaIds };
      if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
      const res = await request(TWEET_URL, {
        method: 'POST',
        headers: {
          // A JSON body is not part of the OAuth 1.0a signature base string.
          authorization: signed('POST', TWEET_URL, creds),
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs,
      });
      replyTo = res.body?.data?.id;
      first ||= res.body?.data;
    }

    return {
      id: first?.id || '',
      url: first?.id ? `https://x.com/i/web/status/${first.id}` : null,
      raw: first,
    };
  },
});
