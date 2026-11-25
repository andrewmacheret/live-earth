import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPeak, PARENT_BY_ID, PARENTS, peakLabel, SHOWER_BY_ID, SHOWERS, showerSpot, streamPoints } from '../src/space/meteors.js';

test('every shower has a parent and a peak day', () => {
  for (const shower of SHOWERS) {
    assert.ok(PARENT_BY_ID[shower.parent], shower.name);
    assert.match(peakLabel(shower), /^[A-Z][a-z]{2} \d{1,2}$/);
    // the info panel needs these
    assert.ok(shower.zhr > 0 && shower.speedKmS > 10 && shower.radiant && shower.article && shower.note, shower.name);
  }
  assert.equal(peakLabel(SHOWERS.find(shower => shower.id === 'perseids')), 'Aug 12');
});

test("the Earth runs right through the Perseid, Leonid and Lyrid streams on their peak days", () => {
  for (const id of ['perseids', 'leonids', 'lyrids']) {
    const spot = showerSpot(SHOWERS.find(shower => shower.id === id), 2026);
    assert.ok(spot.missAu < 0.02, `${id} misses by ${spot.missAu} AU`);
    assert.ok(Math.abs(Math.hypot(spot.x, spot.y, spot.z) - 1) < 0.03);
  }
});

test('stream dust stays near the inner part of its orbit, and is the same every time', () => {
  for (const parent of PARENTS) {
    const points = streamPoints(parent, 300, 7);
    assert.deepEqual(points, streamPoints(parent, 300, 7));
    for (let k = 0; k < points.length; k += 3) {
      const r = Math.hypot(points[k], points[k + 1], points[k + 2]);
      assert.ok(r > parent.a * (1 - parent.e) - 0.15 && r < 3.15, `${parent.name} at ${r} AU`);
    }
  }
});

test('the next peak is later this year, today, or next year', () => {
  const geminids = SHOWER_BY_ID.geminids;
  assert.equal(nextPeak(geminids, new Date('2026-11-24T12:00Z')).toISOString(), '2026-12-14T00:00:00.000Z');
  // still the peak until the day is over
  assert.equal(nextPeak(geminids, new Date('2026-12-14T20:00Z')).toISOString(), '2026-12-14T00:00:00.000Z');
  assert.equal(nextPeak(geminids, new Date('2026-12-15T01:00Z')).toISOString(), '2027-12-14T00:00:00.000Z');
});
