import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = () => ({
  version: 1,
  posts: [],      // queued / scheduled / published content items
  history: [],    // one entry per delivery attempt batch
  platformState: {}, // platform -> { lastPostedAt, failures }
  cursor: 0,      // rotation pointer into the content pack
});

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = join(dataDir, 'store.json');
    this.data = EMPTY();
    this.load();
  }

  load() {
    mkdirSync(this.dataDir, { recursive: true });
    if (!existsSync(this.file)) {
      this.save();
      return this.data;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = { ...EMPTY(), ...parsed };
    } catch (err) {
      // A corrupt store must never take the scheduler down, but we also must
      // not silently discard it -- keep a copy for inspection.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        renameSync(this.file, backup);
      } catch { /* best effort */ }
      this.data = EMPTY();
      this.save();
      this.loadError = { message: err.message, backup };
    }
    return this.data;
  }

  // Write to a temp file then rename, so a crash mid-write cannot leave a
  // half-serialised store behind.
  save() {
    mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
    return this;
  }

  // ---- posts -------------------------------------------------------------

  addPost(post) {
    const entry = {
      id: post.id || randomUUID(),
      text: post.text || '',
      platforms: post.platforms || null, // null = every enabled platform
      variants: post.variants || {},     // platform -> text override
      media: post.media || [],
      link: post.link || null,
      tags: post.tags || [],
      title: post.title || null,
      status: post.status || 'queued',   // queued | published | failed | cancelled
      scheduledAt: post.scheduledAt || null,
      createdAt: post.createdAt || new Date().toISOString(),
      publishedAt: null,
      results: [],
      source: post.source || 'manual',
    };
    this.data.posts.push(entry);
    this.save();
    return entry;
  }

  getPost(id) {
    return this.data.posts.find((p) => p.id === id) || null;
  }

  updatePost(id, patch) {
    const post = this.getPost(id);
    if (!post) return null;
    Object.assign(post, patch);
    this.save();
    return post;
  }

  removePost(id) {
    const before = this.data.posts.length;
    this.data.posts = this.data.posts.filter((p) => p.id !== id);
    const removed = this.data.posts.length !== before;
    if (removed) this.save();
    return removed;
  }

  queued() {
    return this.data.posts.filter((p) => p.status === 'queued');
  }

  // Items that are due: either explicitly scheduled for the past, or
  // unscheduled (meaning "post me whenever the schedule fires").
  due(now = new Date()) {
    return this.queued()
      .filter((p) => !p.scheduledAt || new Date(p.scheduledAt) <= now)
      .sort((a, b) => {
        if (a.scheduledAt && b.scheduledAt) return new Date(a.scheduledAt) - new Date(b.scheduledAt);
        if (a.scheduledAt) return -1;
        if (b.scheduledAt) return 1;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
  }

  // ---- history -----------------------------------------------------------

  addHistory(entry) {
    this.data.history.unshift({ at: new Date().toISOString(), ...entry });
    if (this.data.history.length > 500) this.data.history.length = 500;
    this.save();
    return entry;
  }

  // Did we already publish this exact body in the last `hours`? Guards
  // against a double-click on the dashboard or an overlapping daemon.
  recentlyPublished(hash, hours) {
    if (!hash) return null;
    const cutoff = Date.now() - hours * 3600_000;
    return (
      this.data.history.find(
        (h) => h.hash === hash && h.anySuccess && new Date(h.at).getTime() >= cutoff,
      ) || null
    );
  }

  // ---- platform state ----------------------------------------------------

  platform(name) {
    this.data.platformState[name] ||= { lastPostedAt: null, failures: 0, successes: 0 };
    return this.data.platformState[name];
  }

  markPlatform(name, { ok, at = new Date().toISOString() }) {
    const state = this.platform(name);
    if (ok) {
      state.lastPostedAt = at;
      state.successes += 1;
      state.failures = 0;
    } else {
      state.failures += 1;
    }
    this.save();
    return state;
  }

  advanceCursor() {
    this.data.cursor = (this.data.cursor || 0) + 1;
    this.save();
    return this.data.cursor;
  }
}
