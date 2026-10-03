import { defineAdapter, textFor, withLink, truncate, TIERS } from './base.js';
import { request } from '../http.js';

// LinkedIn has shipped several generations of the share endpoint (shares,
// ugcPosts, then /rest/posts). This uses the /rest/posts shape with a
// versioning header. If LinkedIn returns 404/426 here, bump
// LINKEDIN_VERSION to a current YYYYMM value from their changelog.
export default defineAdapter({
  id: 'linkedin',
  label: 'LinkedIn',
  tier: TIERS.REVIEW,
  limits: { text: 3000, media: 0 },
  verified: false,
  docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
  notes: 'Needs w_member_social (person) or w_organization_social (company page). AUTHOR_URN looks like urn:li:person:xxxx or urn:li:organization:123.',
  required: (c) => ({
    LINKEDIN_ACCESS_TOKEN: c.platforms.linkedin.accessToken,
    LINKEDIN_AUTHOR_URN: c.platforms.linkedin.authorUrn,
  }),

  async publish(post, { config, timeoutMs }) {
    const { accessToken, authorUrn } = config.platforms.linkedin;
    const version = process.env.LINKEDIN_VERSION || '202411';
    const commentary = truncate(withLink(textFor(post, 'linkedin'), post.link), this.limits.text);

    const res = await request('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'linkedin-version': version,
        'x-restli-protocol-version': '2.0.0',
      },
      body: JSON.stringify({
        author: authorUrn,
        commentary,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
      timeoutMs,
      expect: 'json',
    });

    // The post URN comes back in a header rather than the body.
    const id = res.headers?.get?.('x-restli-id') || res.body?.id || '';
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null, raw: res.body };
  },
});
