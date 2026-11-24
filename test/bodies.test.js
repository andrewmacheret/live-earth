import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AU, BODIES, bodyFacts, geocentric, phaseName, sceneFrame } from '../src/space/bodies.js';
import { sunDirection } from '../src/sats/frames.js';

const DATE = new Date('2026-11-24T22:00:00Z');

test('the Sun and Moon are about as far away as they should be', () => {
  const facts = bodyFacts('sun', DATE);
  assert.ok(facts.fromEarthKm > 147e6 && facts.fromEarthKm < 152.2e6);
  assert.ok(facts.lightSeconds > 490 && facts.lightSeconds < 508);
  const moon = bodyFacts('moon', DATE);
  assert.ok(moon.fromEarthKm > 356000 && moon.fromEarthKm < 407000);
});

test('puts the Sun where the satellite code says it is', () => {
  const p = geocentric(DATE).sun;
  const [x, y, z] = sceneFrame(DATE)(p.x, p.y, p.z);
  const length = Math.hypot(x, y, z);
  assert.ok(Math.abs(length / AU - 0.987) < 0.01);
  const [sx, sy, sz] = sunDirection(DATE);
  const degrees = (Math.acos((x * sx + y * sy + z * sz) / length) * 180) / Math.PI;
  assert.ok(degrees < 0.05, `${degrees}° apart`);
});

test('names the Moon phase', () => {
  assert.equal(phaseName(0), 'New moon');
  assert.equal(phaseName(359), 'New moon');
  assert.equal(phaseName(90), 'First quarter');
  assert.equal(phaseName(184), 'Full moon');
  assert.equal(phaseName(300), 'Waning crescent');
  // late November 2026 has a full moon
  assert.equal(bodyFacts('moon', DATE).phase, 'Full moon');
});

test('has a position for every body', () => {
  const positions = geocentric(DATE);
  for (const body of BODIES) assert.ok(positions[body.id], body.id);
  assert.deepEqual(positions.earth, { x: 0, y: 0, z: 0 });
});
