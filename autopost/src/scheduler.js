import { parseCron, cronMatches, nextRun } from './cron.js';
import { parseSlots, slotMatches, nextSlot } from './slots.js';
import { publishPost } from './publisher.js';
import { nextFromPack } from './content.js';

// Minute-resolution key used to guarantee one fire per cron minute even when
// the tick interval is shorter than a minute.
const minuteKey = (date) => date.toISOString().slice(0, 16);

export class Scheduler {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    // POSTING_SLOTS (the Buffer model) wins over SCHEDULE when both are set.
    if (config.postingSlots) {
      this.slots = parseSlots(config.postingSlots);
      this.mode = 'slots';
    } else {
      this.cron = parseCron(config.schedule);
      this.mode = 'cron';
    }
    this.lastFiredMinute = null;
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.runCount = 0;
  }

  nextRunAt(from = new Date()) {
    return this.mode === 'slots'
      ? nextSlot(this.slots, from, this.config.timezone)
      : nextRun(this.cron, from, this.config.timezone);
  }

  // Is `date` a firing moment under whichever mode is active?
  dueAt(date) {
    return this.mode === 'slots'
      ? slotMatches(this.slots, date, this.config.timezone)
      : cronMatches(this.cron, date, this.config.timezone);
  }

  describe() {
    const next = this.nextRunAt();
    return {
      mode: this.mode,
      schedule: this.mode === 'slots' ? this.config.postingSlots : this.cron.source,
      slotsPerWeek: this.mode === 'slots' ? this.slots.length : null,
      timezone: this.config.timezone,
      nextRunAt: next ? next.toISOString() : null,
      running: this.running,
      runCount: this.runCount,
      dryRun: this.config.dryRun,
    };
  }

  start() {
    if (this.running) return this;
    this.running = true;
    const intervalMs = Math.max(5, this.config.tickSeconds) * 1000;
    const next = this.nextRunAt();
    const label = this.mode === 'slots'
      ? `${this.slots.length} slots/week: ${this.config.postingSlots}`
      : this.cron.source;
    this.logger.info(
      `Scheduler started (${this.mode}): "${label}" (${this.config.timezone}); next run ${next ? next.toISOString() : 'never'}${this.config.dryRun ? ' [DRY RUN]' : ''}`,
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Scheduler tick failed: ${err.message}`));
    }, intervalMs);
    // Do not hold the event loop open if the host wants to exit.
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.logger.info('Scheduler stopped.');
    return this;
  }

  async tick(now = new Date()) {
    if (this.busy) {
      this.logger.debug('Tick skipped: a run is still in progress.');
      return { fired: false, reason: 'busy' };
    }

    // An explicitly scheduled post fires at its own time, cron or not.
    const explicit = this.store
      .due(now)
      .filter((p) => p.scheduledAt && new Date(p.scheduledAt) <= now);

    const cronDue = this.dueAt(now) && this.lastFiredMinute !== minuteKey(now);

    if (!cronDue && explicit.length === 0) return { fired: false };

    if (cronDue) this.lastFiredMinute = minuteKey(now);

    this.busy = true;
    try {
      return await this.runOnce({ now, trigger: cronDue ? 'cron' : 'scheduled-post' });
    } finally {
      this.busy = false;
    }
  }

  // One scheduled firing: publish up to maxPerRun items, falling back to the
  // content pack when the queue is empty and recycling is on.
  async runOnce({ now = new Date(), trigger = 'manual' } = {}) {
    const ctx = { config: this.config, store: this.store, logger: this.logger };
    const batch = this.store.due(now).slice(0, Math.max(1, this.config.maxPerRun));
    const runs = [];

    if (batch.length === 0) {
      if (!this.config.recycleContent) {
        this.logger.info('Nothing queued and RECYCLE_CONTENT=false, so nothing to post.');
        return { fired: true, trigger, runs: [], reason: 'queue-empty' };
      }
      const { post, index, total } = nextFromPack(this.store, this.config);
      this.logger.info(`Queue empty; using content pack item ${index + 1}/${total}.`);
      runs.push(await publishPost(post, ctx));
    } else {
      for (const post of batch) {
        runs.push(await publishPost(post, ctx));
      }
    }

    this.runCount += 1;
    const next = this.nextRunAt(now);
    this.logger.info(`Run complete (${trigger}). Next run ${next ? next.toISOString() : 'never'}.`);
    return { fired: true, trigger, runs };
  }
}
