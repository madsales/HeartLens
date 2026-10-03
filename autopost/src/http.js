export class HttpError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
    // 408/429 and 5xx are worth another attempt; a 400 or 401 is not.
    this.retryable = status === 408 || status === 429 || (status >= 500 && status < 600);
  }
}

function shorten(text, max = 600) {
  if (typeof text !== 'string') return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, expect = 'json' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const raw = await res.text();
    let parsed = raw;
    if (expect === 'json' && raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw; // some endpoints answer 204/empty or text/plain
      }
    }
    if (!res.ok) {
      throw new HttpError(`HTTP ${res.status} ${res.statusText} for ${method} ${url}`, {
        status: res.status,
        body: typeof parsed === 'string' ? shorten(parsed) : parsed,
        url,
      });
    }
    return { status: res.status, body: parsed, headers: res.headers };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'AbortError') {
      const e = new HttpError(`Request to ${url} timed out after ${timeoutMs}ms`, { url });
      e.retryable = true;
      throw e;
    }
    // DNS failures, resets, TLS problems: transient enough to retry.
    const e = new HttpError(`${err.code || err.name || 'NetworkError'}: ${err.message}`, { url });
    e.retryable = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const postJson = (url, payload, opts = {}) =>
  request(url, {
    ...opts,
    method: opts.method || 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(payload),
  });

export const postForm = (url, fields, opts = {}) =>
  request(url, {
    ...opts,
    method: opts.method || 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body: new URLSearchParams(fields).toString(),
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
