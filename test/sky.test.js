import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { skyVector, starColor, starLook } from '../src/space/sky.js';

const sky = JSON.parse(readFileSync(new URL('../src/space/sky.json', import.meta.url)));

test('sky.json has every star you can see, all 88 constellations and the famous star names', () => {
  assert.ok(sky.stars.length / 4 > 5000);
  assert.equal(Object.keys(sky.lines).length, 88);
  const names = sky.named.map(([name]) => name);
  for (const name of ['Sirius', 'Betelgeuse', 'Vega', 'Polaris']) assert.ok(names.includes(name), name);
  // brightest first, so they win when names would overlap
  assert.equal(names[0], 'Sirius');
});

test('Polaris is almost straight above the North Pole', () => {
  const [, ra, dec] = sky.named.find(([name]) => name === 'Polaris');
  assert.ok(skyVector(ra, dec).z > 0.9998);
  const { x, y, z } = skyVector(90, 0);
  assert.ok(Math.abs(x) < 1e-12 && Math.abs(y - 1) < 1e-12 && Math.abs(z) < 1e-12);
});

test('hot stars are blue, cool stars are orange, and brighter stars are bigger', () => {
  const [r1, , b1] = starColor(-0.3);
  const [r2, , b2] = starColor(1.6);
  assert.ok(b1 > r1 && r2 > b2);
  assert.deepEqual(starColor(5), starColor(2));
  assert.ok(starLook(-1.5).size > starLook(1).size && starLook(1).size > starLook(5).size);
  assert.ok(starLook(-1.5).brightness <= 1 && starLook(6).brightness > 0);
});
