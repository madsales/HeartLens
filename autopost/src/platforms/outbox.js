import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineAdapter, textFor, withLink, TIERS } from './base.js';

// Last-resort target, and the reason a run is never a total loss: platforms
// with no usable publish API (or ones you have not connected yet) get a
// ready-to-paste file per post. Always available, needs no credentials.
export default defineAdapter({
  id: 'outbox',
  label: 'Outbox (copy-paste file)',
  tier: TIERS.MANUAL,
  limits: {},
  notes: 'Writes <data>/outbox/<date>-<id>.md for platforms you post to by hand.',
  required: () => ({}),

  async publish(post, { config }) {
    const dir = config.platforms.outbox.dir || join(config.dataDir, 'outbox');
    await mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${stamp}-${String(post.id || 'post').slice(0, 8)}.md`);
    const body = withLink(textFor(post, 'outbox'), post.link);

    const variants = Object.entries(post.variants || {});
    const lines = [
      `# ${post.title || 'HeartLens post'}`,
      '',
      `- Post id: ${post.id || '(none)'}`,
      `- Prepared: ${new Date().toISOString()}`,
      post.tags?.length ? `- Tags: ${post.tags.join(', ')}` : null,
      post.media?.length ? `- Media: ${post.media.join(', ')}` : null,
      '',
      '## Shared body',
      '',
      body,
      '',
      variants.length ? '## Per-platform variants' : null,
      ...variants.flatMap(([platform, text]) => ['', `### ${platform}`, '', text]),
      '',
    ].filter((l) => l !== null);

    await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
    return { id: file, url: `file://${file}`, raw: { file } };
  },
});
