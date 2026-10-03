import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, cronMatches, nextRun, describeCron, zonedParts } from '../src/cron.js';

test('parses lists, steps and ranges', () => {
  assert.deepEqual([...parseCron('0 9,17 * * *').hour], [9, 17]);
  assert.deepEqual([...parseCron('*/15 * * * *').minute], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron('0 9 * * 1-5').dayOfWeek], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('0 0 * * mon,fri').dayOfWeek], [1, 5]);
  assert.deepEqual([...parseCron('0 0 1 jan *').month], [1]);
});

test('treats day 7 as Sunday', () => {
  assert.deepEqual([...parseCron('0 0 * * 7').dayOfWeek], [0]);
});

test('expands @aliases', () => {
  assert.equal(parseCron('@daily').source, '0 0 * * *');
  assert.equal(parseCron('@weekly').source, '0 0 * * 0');
});

test('rejects malformed expressions', () => {
  assert.throws(() => parseCron('0 9 * *'), /needs 5 fields/);
  assert.throws(() => parseCron('99 * * * *'), /out of range/);
  assert.throws(() => parseCron('0 9 * * * *'), /needs 5 fields/);
  assert.throws(() => parseCron('*/0 * * * *'), /bad step/);
});

test('matches only the scheduled minute', () => {
  const cron = parseCron('30 14 * * *');
  assert.equal(cronMatches(cron, new Date('2026-10-03T14:30:00Z'), 'UTC'), true);
  assert.equal(cronMatches(cron, new Date('2026-10-03T14:31:00Z'), 'UTC'), false);
  assert.equal(cronMatches(cron, new Date('2026-10-03T13:30:00Z'), 'UTC'), false);
});

test('matches in the configured timezone, not UTC', () => {
  const cron = parseCron('0 9 * * *');
  // 09:00 in New York during DST is 13:00 UTC.
  assert.equal(cronMatches(cron, new Date('2026-10-03T13:00:00Z'), 'America/New_York'), true);
  assert.equal(cronMatches(cron, new Date('2026-10-03T09:00:00Z'), 'America/New_York'), false);
  // And in Tokyo, 09:00 is the previous day at 00:00 UTC.
  assert.equal(cronMatches(cron, new Date('2026-10-03T00:00:00Z'), 'Asia/Tokyo'), true);
});

test('zonedParts folds midnight to hour 0', () => {
  const p = zonedParts(new Date('2026-10-03T00:00:00Z'), 'UTC');
  assert.equal(p.hour, 0);
  assert.equal(p.day, 3);
});

test('nextRun finds the following slot and never returns the present minute', () => {
  const cron = parseCron('0 9,17 * * *');
  assert.equal(nextRun(cron, new Date('2026-10-03T09:00:00Z'), 'UTC').toISOString(), '2026-10-03T17:00:00.000Z');
  assert.equal(nextRun(cron, new Date('2026-10-03T18:00:00Z'), 'UTC').toISOString(), '2026-10-04T09:00:00.000Z');
});

test('nextRun returns null for an impossible date rather than hanging', () => {
  assert.equal(nextRun(parseCron('0 0 30 2 *'), new Date('2026-01-01T00:00:00Z'), 'UTC'), null);
});

test('day-of-month and day-of-week are OR-ed when both are restricted', () => {
  const cron = parseCron('0 0 13 * 5'); // the 13th OR any Friday
  assert.equal(cronMatches(cron, new Date('2026-11-13T00:00:00Z'), 'UTC'), true); // Friday 13th
  assert.equal(cronMatches(cron, new Date('2026-10-13T00:00:00Z'), 'UTC'), true); // 13th, a Tuesday
  assert.equal(cronMatches(cron, new Date('2026-10-09T00:00:00Z'), 'UTC'), true); // a Friday
  assert.equal(cronMatches(cron, new Date('2026-10-14T00:00:00Z'), 'UTC'), false);
});

test('describeCron reports errors instead of throwing', () => {
  assert.equal(describeCron('nonsense').valid, false);
  assert.equal(describeCron('0 9 * * *').valid, true);
});
