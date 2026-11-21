import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlanesHandler } from '../lambda/planes.js';
import { fromCompactPlanes, toCompactPlanes } from '../src/planes/compact.js';
import { flyPath, pathOf, toLatLon, trackAt } from '../src/planes/motion.js';

const TIME = 1795226769;

// one OpenSky state vector, with the fields we use filled in
function state(icao, overrides = {}) {
  const s = [icao, 'UAL8217 ', 'United States', TIME, TIME, -77.39471, 42.65702, 9113.52, false, 257.06, 87.02, -4.88];
  s[13] = 9410.7;
  s[17] = 4;
  for (const [i, value] of Object.entries(overrides)) s[i] = value;
  return s;
}

test('keeps planes in the air with a recent position, and reads them back', () => {
  const states = [
    state('ab1644'),
    state('e8027c', { 1: null, 2: 'Chile', 3: TIME - 20, 17: 0 }),
    state('a00001', { 8: true }), // on the ground
    state('a00002', { 5: null }), // no position
    state('a00003', { 3: TIME - 1000 }) // position too old
  ];
  const data = toCompactPlanes({ time: TIME, states }, { generated: '2026-11-21T02:06:10.000Z' });
  assert.equal(data.count, 2);
  assert.deepEqual(data.countries, ['United States', 'Chile']);
  const [united, chile] = fromCompactPlanes(data);
  assert.deepEqual(united, {
    icao: 'ab1644',
    callsign: 'UAL8217',
    country: 'United States',
    lat: 42.657,
    lon: -77.3947,
    altitude: 9114,
    speed: 257.1,
    track: 87,
    climb: -4.9,
    at: TIME * 1000,
    kind: 'Large aircraft'
  });
  assert.equal(chile.callsign, '');
  assert.equal(chile.at, (TIME - 20) * 1000);
  assert.equal(chile.kind, null);
});

test('leaves out planes that moved impossibly far since the last file', () => {
  const first = toCompactPlanes({ time: TIME, states: [state('a00001'), state('a00002')] });
  // 3 minutes at 257 m/s is about 46 km east. a00002 jumped 400 km instead.
  const later = TIME + 180;
  const second = toCompactPlanes(
    {
      time: later,
      states: [state('a00001', { 3: later, 5: -76.85 }), state('a00002', { 3: later, 5: -72.5 }), state('a00003', { 3: later })]
    },
    { previous: first }
  );
  assert.equal(second.lagging, 1);
  assert.deepEqual(
    fromCompactPlanes(second).map(plane => plane.icao),
    ['a00001', 'a00003']
  );
});

test('a plane flies along a great circle at its speed', () => {
  const near = (a, b, tolerance = 0.01) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not close to ${b}`);
  // 250 m/s for an hour is 900 km, about 8.09° along the equator
  const east = pathOf({ lat: 0, lon: 10, track: 90, speed: 250, altitude: 0, at: 0 }, 0);
  const heading = [0, 0, 0];
  const there = flyPath(east, 3600, [0, 0, 0], heading);
  near(toLatLon(there).lat, 0);
  near(toLatLon(there).lon, 10 + 8.09);
  near(trackAt(there, heading), 90);

  // heading north from Seattle, it ends up due north
  const north = pathOf({ lat: 47.6, lon: -122.3, track: 0, speed: 250, altitude: 11000, at: 5000 * 1000 }, 1000);
  const later = toLatLon(flyPath(north, 4000 + 600));
  near(later.lon, -122.3);
  assert.ok(later.lat > 48.9 && later.lat < 49, `${later.lat}`);

  // a plane headed northeast keeps turning east as it goes, like real great circle routes
  const ne = pathOf({ lat: 40, lon: -74, track: 45, speed: 250, altitude: 0, at: 0 }, 0);
  const h = [0, 0, 0];
  const p = flyPath(ne, 3 * 3600, [0, 0, 0], h);
  assert.ok(trackAt(p, h) > 50);
});

test('the planes Lambda saves the file, and refuses a suspiciously short list', async () => {
  let saved;
  const states = Array.from({ length: 1200 }, (_, i) => state(i.toString(16).padStart(6, '0')));
  const handler = createPlanesHandler({
    download: async () => ({ time: TIME, states, remaining: 3996 }),
    loadPrevious: async () => {
      throw new Error('NoSuchKey');
    },
    save: async body => (saved = JSON.parse(body)),
    log: () => {}
  });
  assert.deepEqual(await handler(), { planes: 1200, lagging: 0, remaining: 3996 });
  assert.equal(saved.count, 1200);

  const short = createPlanesHandler({
    download: async () => ({ time: TIME, states: states.slice(0, 10) }),
    loadPrevious: async () => null,
    save: async () => assert.fail('should not save'),
    log: () => {}
  });
  await assert.rejects(short(), /Only got 10 planes/);
});
