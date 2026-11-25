import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextLunarEclipse, nextSolarEclipse, placeLabel } from '../src/space/eclipses.js';

test('finds the 2017 eclipse across the US, and the 2027 one over Egypt', () => {
  const us = nextSolarEclipse(new Date('2017-08-01'));
  assert.equal(us.kind, 'total');
  assert.equal(us.peak.toISOString().slice(0, 13), '2017-08-21T18');
  assert.equal(placeLabel(us.latitude, us.longitude), '37°N 88°W');
  const egypt = nextSolarEclipse(new Date('2027-03-01'));
  assert.equal(egypt.kind, 'total');
  assert.equal(egypt.peak.toISOString().slice(0, 10), '2027-08-02');
});

test('can skip the faint lunar eclipses', () => {
  assert.equal(nextLunarEclipse(new Date('2026-11-25')).kind, 'penumbral');
  const visible = nextLunarEclipse(new Date('2026-11-25'), { skipFaint: true });
  assert.notEqual(visible.kind, 'penumbral');
  // the March 2025 total one lasted about an hour
  const total = nextLunarEclipse(new Date('2025-03-01'), { skipFaint: true });
  assert.equal(total.kind, 'total');
  assert.ok(total.totalMinutes > 55 && total.totalMinutes < 75, `${total.totalMinutes} min`);
});
