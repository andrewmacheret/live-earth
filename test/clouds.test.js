import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudDays, cloudUrl } from '../src/space/clouds.js';

test('clouds come from yesterday, with the day before filling the gaps', () => {
  assert.deepEqual(cloudDays(new Date('2026-11-25T01:10Z')), ['2026-11-24', '2026-11-23']);
  assert.deepEqual(cloudDays(new Date('2027-01-01T23:59Z')), ['2026-12-31', '2026-12-30']);
});

test('the picture covers the whole Earth, twice as wide as tall', () => {
  const url = new URL(cloudUrl('2026-11-23'));
  assert.equal(url.hostname, 'gibs.earthdata.nasa.gov');
  assert.equal(url.searchParams.get('BBOX'), '-90,-180,90,180');
  assert.equal(url.searchParams.get('TIME'), '2026-11-23');
  assert.equal(Number(url.searchParams.get('WIDTH')), 2 * Number(url.searchParams.get('HEIGHT')));
});
