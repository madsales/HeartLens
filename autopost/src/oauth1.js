import { createHmac, randomBytes } from 'node:crypto';

// RFC 5849 percent-encoding: stricter than encodeURIComponent.
export const rfc3986 = (value) =>
  encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Builds an OAuth 1.0a HMAC-SHA1 Authorization header. Used by the X/Twitter
// adapter, which signs with user context rather than a bearer token.
export function oauth1Header({
  method,
  url,
  params = {},
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  nonce = randomBytes(16).toString('hex'),
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const target = new URL(url);
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_version: '1.0',
  };
  if (token) oauthParams.oauth_token = token;

  // Query-string params join the signature base; a JSON body does not.
  const allParams = { ...oauthParams, ...params };
  for (const [k, v] of target.searchParams.entries()) allParams[k] = v;

  const normalised = Object.keys(allParams)
    .map((k) => [rfc3986(k), rfc3986(allParams[k])])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const baseUrl = `${target.protocol}//${target.host}${target.pathname}`;
  const baseString = [
    method.toUpperCase(),
    rfc3986(baseUrl),
    rfc3986(normalised),
  ].join('&');

  const signingKey = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret || '')}`;
  const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

  const header = Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
    .join(', ');

  return { header: `OAuth ${header}`, signature, baseString };
}
