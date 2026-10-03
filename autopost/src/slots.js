// Buffer's scheduling model: you define *when* you post, then drop content in
// a queue and each item takes the next free slot. Easier to reason about than
// raw cron for "three times a day on weekdays", and it is what people mean
// when they ask for "the Buffer workflow".
//
// Format:  mon-fri@09:00,17:00; sat,sun@11:30
//          everyday@08:00
//          mon,wed,fri@09:00

import { zonedParts } from './cron.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const GROUPS = {
  everyday: [0, 1, 2, 3, 4, 5, 6],
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};

function parseDays(spec) {
  const out = new Set();
  for (const part of spec.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (GROUPS[part]) {
      GROUPS[part].forEach((d) => out.add(d));
      continue;
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((d) => DAYS.indexOf(d.slice(0, 3)));
      if (a === -1 || b === -1) throw new Error(`Unknown day range "${part}"`);
      // Ranges may wrap, e.g. fri-mon.
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
      continue;
    }
    const index = DAYS.indexOf(part.slice(0, 3));
    if (index === -1) throw new Error(`Unknown day "${part}"`);
    out.add(index);
  }
  if (!out.size) throw new Error(`No days in "${spec}"`);
  return [...out].sort((a, b) => a - b);
}

function parseTimes(spec) {
  const times = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!m) throw new Error(`Time must look like HH:MM, got "${part}"`);
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) throw new Error(`"${part}" is not a valid time`);
    times.push({ hour, minute });
  }
  if (!times.length) throw new Error(`No times in "${spec}"`);
  return times;
}

export function parseSlots(spec) {
  const groups = String(spec).split(';').map((s) => s.trim()).filter(Boolean);
  if (!groups.length) throw new Error('POSTING_SLOTS is empty');

  const slots = [];
  for (const group of groups) {
    const at = group.indexOf('@');
    if (at === -1) throw new Error(`Each group needs days@times, got "${group}"`);
    const days = parseDays(group.slice(0, at));
    const times = parseTimes(group.slice(at + 1));
    for (const day of days) for (const time of times) slots.push({ day, ...time });
  }

  // De-duplicate, then order within the week.
  const seen = new Set();
  const unique = slots.filter((s) => {
    const key = `${s.day}-${s.hour}-${s.minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.day - b.day || a.hour - b.hour || a.minute - b.minute);
  return unique;
}

// Does `date` fall exactly on a slot, in the given zone?
export function slotMatches(slots, date, timeZone = 'UTC') {
  const p = zonedParts(date, timeZone);
  return slots.some((s) => s.day === p.dayOfWeek && s.hour === p.hour && s.minute === p.minute);
}

// Next slot at or after `from`. Walks forward a minute at a time only within
// a day's candidate slots, so this stays cheap.
export function nextSlot(slots, from = new Date(), timeZone = 'UTC') {
  if (!slots.length) return null;
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // Eight days covers any weekly pattern, including DST shifts.
  for (let i = 0; i < 8 * 24 * 60; i += 1) {
    const candidate = new Date(cursor.getTime() + i * 60_000);
    if (slotMatches(slots, candidate, timeZone)) return candidate;
  }
  return null;
}

export function nextSlots(slots, count = 5, from = new Date(), timeZone = 'UTC') {
  const out = [];
  let cursor = from;
  for (let i = 0; i < count; i += 1) {
    const next = nextSlot(slots, cursor, timeZone);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

export function describeSlots(spec, timeZone = 'UTC') {
  try {
    const slots = parseSlots(spec);
    return {
      valid: true,
      count: slots.length,
      perWeek: slots.length,
      summary: summarise(slots),
      next: nextSlots(slots, 3, new Date(), timeZone).map((d) => d.toISOString()),
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

function summarise(slots) {
  // Group times by the set of days that share them, for a readable summary.
  const byTime = new Map();
  for (const s of slots) {
    const key = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(s.day);
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([time, days]) => `${days.sort((a, b) => a - b).map((d) => DAYS[d]).join(',')} @ ${time}`)
    .join('; ');
}
