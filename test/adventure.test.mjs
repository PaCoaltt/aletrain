import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVENTURES, platformFor, stopTime, usableReturn, swissDateTime, swissTimestamp, delayMinutes, hasPrediction, cancelled } from '../adventure.js';
import { createVisitCounter } from '../visits.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real-time departure and platform override the timetable', () => {
  const stop = { departure: '2026-11-17T10:00:00+01:00', platform: '1',
    prognosis: { departure: '2026-11-17T10:05:00+01:00', platform: '3' } };
  assert.equal(stopTime(stop), stop.prognosis.departure);
  assert.equal(platformFor({ stop }), '3');
  assert.equal(platformFor({ stop: { platform: '1' } }), '1');
  assert.deepEqual(ADVENTURES.all, ['train', 'tram', 'ship', 'bus', 'cableway']);
});

test('scheduled time alone never implies live data or zero delay; explicit predictions are validated', () => {
  const planned = { departure: '2026-11-17T19:27:00+0100', delay: null };
  assert.equal(hasPrediction(planned), false);
  assert.equal(delayMinutes(planned), null);
  assert.equal(hasPrediction({ ...planned, delay: 0 }), true);
  assert.equal(delayMinutes({ ...planned, delay: 2 }), 2);
  assert.equal(delayMinutes({ ...planned, prognosis: { departure: '2026-11-17T19:29:00+0100' } }), 2);
  assert.equal(hasPrediction({ ...planned, prognosis: { departure: 'invalid' } }), false);
  assert.equal(stopTime({ ...planned, prognosis: { departure: 'invalid' } }), planned.departure);
  assert.equal(platformFor({ stop: { prognosis: { platform: null } } }), '');
  assert.equal(cancelled({ stop: { cancelled: true } }), true);
  assert.equal(cancelled({ canceled: true }), true);
  assert.equal(cancelled({}), false);
});

test('return must leave after the visit and arrive before the deadline, including delays', () => {
  const earliest = Date.parse('2026-11-17T14:00:00+01:00');
  const deadline = Date.parse('2026-11-17T15:00:00+01:00');
  const trip = { from: { departure: '2026-11-17T14:10:00+01:00' },
    to: { arrival: '2026-11-17T14:50:00+01:00' }, sections: [{ journey: {} }] };
  assert.equal(usableReturn(trip, earliest, deadline), true);
  assert.equal(usableReturn({ ...trip, from: { departure: '2026-11-17T13:59:00+01:00' } }, earliest, deadline), false);
  assert.equal(usableReturn({ ...trip, to: { ...trip.to, prognosis: { arrival: '2026-11-17T15:05:00+01:00' } } }, earliest, deadline), false);
  assert.equal(usableReturn({ ...trip, sections: [{ journey: { cancelled: true } }] }, earliest, deadline), false);
  assert.equal(usableReturn({ ...trip, sections: [] }, earliest, deadline), false);
  assert.equal(usableReturn({ ...trip, to: {} }, earliest, deadline), false);
});

test('Swiss time conversion handles midnight, summer time and the missing spring hour', () => {
  assert.deepEqual(swissDateTime(Date.parse('2026-11-17T23:30:00Z')), { date: '2026-11-18', time: '00:30' });
  assert.equal(swissTimestamp('2026-07-17T19:00'), Date.parse('2026-07-17T17:00:00Z'));
  assert.equal(swissTimestamp('2026-11-17T19:00'), Date.parse('2026-11-17T18:00:00Z'));
  assert.ok(Number.isNaN(swissTimestamp('2026-03-29T02:30')));
  assert.ok(Number.isNaN(swissTimestamp('invalid')));
});

test('visits deduplicate the session cookie, batch writes and survive a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aletrain-visits-'));
  const path = join(directory, 'visits.json');
  let counter;
  try {
    counter = await createVisitCounter(path);
    assert.equal(counter.visit(''), 1);
    assert.equal(counter.visit('other=1; aletrain_visit=1'), 1);
    assert.equal(counter.visit('aletrain_visit=10'), 2);
    await Promise.all([counter.flush(), counter.flush()]);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { visits: 2 });
    await counter.close();
    counter = await createVisitCounter(path);
    assert.equal(counter.count(), 2);
    counter.visit('');
    await counter.close();
    assert.equal(JSON.parse(await readFile(path, 'utf8')).visits, 3);
  } finally {
    if (counter) await counter.close();
    await rm(directory, { recursive: true, force: true });
  }
});
