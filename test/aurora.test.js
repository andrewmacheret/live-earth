import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auroraGrid, HEIGHT, WIDTH } from '../src/space/aurora.js';

test("NOAA's grid lands where the Earth's map has the same place", () => {
  const grid = auroraGrid({
    'Observation Time': '2026-11-25T00:58:00Z',
    'Forecast Time': '2026-11-25T02:17:00Z',
    coordinates: [
      [0, -90, 2],
      // 45° west over Greenland, 100%
      [315, 66, 100],
      [180, 90, 50]
    ]
  });
  assert.equal(grid.data.length, WIDTH * HEIGHT);
  assert.equal(grid.peak, 100);
  assert.equal(grid.forecast.toISOString(), '2026-11-25T02:17:00.000Z');
  // column 0 is 180° west, like the Earth's day map
  assert.equal(grid.data[0 * WIDTH + 180], 5);
  assert.equal(grid.data[(66 + 90) * WIDTH + 135], 255);
  assert.equal(grid.data[180 * WIDTH + 0], 127);
});
