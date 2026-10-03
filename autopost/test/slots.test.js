import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlots, slotMatches, nextSlot, nextSlots, describeSlots } from '../src/slots.js';

test('parses days@times into one slot per combination', () => {
  assert.equal(parseSlots('mon-fri@09:00,17:00').length, 10);
  assert.equal(parseSlots('sat,sun@11:30').length, 2);
  assert.equal(parseSlots('mon-fri@09:00,17:00; sat,sun@11:30').length, 12);
});

test('supports the everyday / weekdays / weekends aliases', () => {
  assert.equal(parseSlots('everyday@08:00').length, 7);
  assert.equal(parseSlots('weekdays@08:00').length, 5);
  assert.equal(parseSlots('weekends@10:00').length, 2);
});

test('day ranges may wrap around the week', () => {
  assert.deepEqual(parseSlots('fri-mon@10:00').map((s) => s.day), [0, 1, 5, 6]);
});

test('duplicate slots collapse', () => {
  assert.equal(parseSlots('mon@09:00; mon@09:00; monday@09:00').length, 1);
});

test('rejects malformed specs with a useful message', () => {
  assert.throws(() => parseSlots('mon 09:00'), /days@times/);
  assert.throws(() => parseSlots('funday@09:00'), /Unknown day/);
  assert.throws(() => parseSlots('mon@9am'), /HH:MM/);
  assert.throws(() => parseSlots('mon@25:00'), /not a valid time/);
  assert.throws(() => parseSlots(''), /empty/);
});

test('slotMatches is exact to the minute', () => {
  const slots = parseSlots('mon@09:00');
  assert.equal(slotMatches(slots, new Date('2026-10-05T09:00:00Z'), 'UTC'), true);
  assert.equal(slotMatches(slots, new Date('2026-10-05T09:01:00Z'), 'UTC'), false);
  assert.equal(slotMatches(slots, new Date('2026-10-06T09:00:00Z'), 'UTC'), false);
});

test('slots are evaluated in the configured timezone', () => {
  const slots = parseSlots('mon@09:00');
  // 09:00 Monday in New York is 13:00 UTC during DST.
  assert.equal(slotMatches(slots, new Date('2026-10-05T13:00:00Z'), 'America/New_York'), true);
  assert.equal(slotMatches(slots, new Date('2026-10-05T09:00:00Z'), 'America/New_York'), false);
});

test('nextSlot and nextSlots walk forward in order', () => {
  const slots = parseSlots('mon-fri@09:00,17:00');
  const from = new Date('2026-10-05T08:00:00Z'); // a Monday
  assert.equal(nextSlot(slots, from, 'UTC').toISOString(), '2026-10-05T09:00:00.000Z');

  const upcoming = nextSlots(slots, 3, from, 'UTC').map((d) => d.toISOString());
  assert.deepEqual(upcoming, [
    '2026-10-05T09:00:00.000Z',
    '2026-10-05T17:00:00.000Z',
    '2026-10-06T09:00:00.000Z',
  ]);
});

test('nextSlot skips the weekend for a weekday-only schedule', () => {
  const slots = parseSlots('weekdays@09:00');
  // From Friday evening, the next slot is Monday.
  const next = nextSlot(slots, new Date('2026-10-09T18:00:00Z'), 'UTC');
  assert.equal(next.toISOString(), '2026-10-12T09:00:00.000Z');
});

test('describeSlots summarises and reports errors without throwing', () => {
  const ok = describeSlots('mon-fri@09:00', 'UTC');
  assert.equal(ok.valid, true);
  assert.equal(ok.count, 5);
  assert.match(ok.summary, /mon,tue,wed,thu,fri @ 09:00/);
  assert.equal(ok.next.length, 3);

  assert.equal(describeSlots('nonsense').valid, false);
});
