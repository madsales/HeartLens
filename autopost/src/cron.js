// A small 5-field cron implementation: minute hour day-of-month month day-of-week.
// Supports *, */step, a-b, a-b/step and comma lists. No seconds field, no @macros
// beyond the handful aliased below. Timezone-aware via Intl, so a schedule written
// in the operator's local time fires at that local time even on a UTC server.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ALIASES = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

function normaliseToken(token, fieldName) {
  let t = token.toLowerCase();
  if (fieldName === 'month') {
    MONTHS.forEach((m, i) => { t = t.replace(new RegExp(m, 'g'), String(i + 1)); });
  }
  if (fieldName === 'dayOfWeek') {
    DAYS.forEach((d, i) => { t = t.replace(new RegExp(d, 'g'), String(i)); });
    // Both 0 and 7 are Sunday in common cron dialects.
    t = t.replace(/\b7\b/g, '0');
  }
  return t;
}

function parseField(raw, field) {
  const token = normaliseToken(raw.trim(), field.name);
  const allowed = new Set();

  for (const part of token.split(',')) {
    if (!part) throw new Error(`empty ${field.name} segment in cron expression`);
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`bad step "${stepPart}" in ${field.name}`);
    }

    let start;
    let end;
    if (rangePart === '*') {
      start = field.min;
      end = field.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      start = Number.parseInt(a, 10);
      end = Number.parseInt(b, 10);
    } else {
      start = Number.parseInt(rangePart, 10);
      end = stepPart === undefined ? start : field.max;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`bad ${field.name} value "${rangePart}"`);
    }
    if (start < field.min || end > field.max || start > end) {
      throw new Error(`${field.name} "${rangePart}" out of range ${field.min}-${field.max}`);
    }
    for (let v = start; v <= end; v += step) allowed.add(v);
  }
  return allowed;
}

export function parseCron(expression) {
  const expr = ALIASES[String(expression).trim().toLowerCase()] || String(expression).trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron expression needs 5 fields, got ${parts.length}: "${expression}"`);
  }
  const sets = FIELDS.map((field, i) => parseField(parts[i], field));
  return {
    source: expr,
    minute: sets[0],
    hour: sets[1],
    dayOfMonth: sets[2],
    month: sets[3],
    dayOfWeek: sets[4],
    // Standard cron quirk: when both day-of-month and day-of-week are
    // restricted, either matching is enough.
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
}

// Constructing an Intl.DateTimeFormat is expensive and nextRun() calls this
// once per candidate minute, so formatters are cached per timezone.
const FORMATTERS = new Map();

function formatterFor(timeZone) {
  let fmt = FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

// Break a Date into calendar fields as observed in `timeZone`.
export function zonedParts(date, timeZone) {
  const fmt = formatterFor(timeZone);
  const out = {};
  for (const { type, value } of fmt.formatToParts(date)) out[type] = value;
  const weekday = DAYS.indexOf(String(out.weekday || '').toLowerCase().slice(0, 3));
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Intl renders midnight as "24" in some ICU versions; fold it back to 0.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    dayOfWeek: weekday === -1 ? new Date(date).getUTCDay() : weekday,
  };
}

export function cronMatches(cron, date, timeZone = 'UTC') {
  const p = zonedParts(date, timeZone);
  if (!cron.minute.has(p.minute)) return false;
  if (!cron.hour.has(p.hour)) return false;
  return dateMatches(cron, p);
}

// Next firing at or after `from`. Rather than testing every minute for two
// years, this skips a whole day when the date cannot match and a whole hour
// when the hour cannot match, which turns the worst case (an impossible date
// like Feb 30) from ~1M checks into a few hundred.
export function nextRun(cron, from = new Date(), timeZone = 'UTC') {
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const HORIZON_MS = 366 * 2 * 24 * 3600_000;
  const deadline = from.getTime() + HORIZON_MS;

  while (cursor.getTime() <= deadline) {
    const p = zonedParts(cursor, timeZone);

    // Wrong day? Jump to the start of the next day in the target zone.
    if (!dateMatches(cron, p)) {
      cursor.setTime(cursor.getTime() + (24 * 60 - (p.hour * 60 + p.minute)) * 60_000);
      continue;
    }
    // Right day, wrong hour? Jump to the top of the next hour.
    if (!cron.hour.has(p.hour)) {
      cursor.setTime(cursor.getTime() + (60 - p.minute) * 60_000);
      continue;
    }
    if (cron.minute.has(p.minute)) return new Date(cursor.getTime());
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return null;
}

// Shared by cronMatches and nextRun: the month/day half of a match, including
// the standard "either day field may match when both are restricted" rule.
function dateMatches(cron, p) {
  if (!cron.month.has(p.month)) return false;
  const domOk = cron.dayOfMonth.has(p.day);
  const dowOk = cron.dayOfWeek.has(p.dayOfWeek);
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

export function describeCron(expression, timeZone = 'UTC') {
  try {
    const cron = parseCron(expression);
    const next = nextRun(cron, new Date(), timeZone);
    return {
      valid: true,
      source: cron.source,
      next: next ? next.toISOString() : null,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
