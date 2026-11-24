import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AU,
  BODIES,
  bodyFacts,
  geocentric,
  KM_PER_AU,
  phaseName,
  planetOrbit,
  PLANETS,
  sceneFrame
} from '../src/space/bodies.js';
import { eccentricAnomaly, ellipsePath, pointAt } from '../src/space/smallBodies.js';
import { sunDirection } from '../src/sats/frames.js';
import { Body, HelioVector } from 'astronomy-engine';

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

test('the planets are about as far from the Sun as they should be', () => {
  const au = facts => facts.fromSunKm / KM_PER_AU;
  assert.ok(au(bodyFacts('mercury', DATE)) > 0.3 && au(bodyFacts('mercury', DATE)) < 0.47);
  assert.ok(au(bodyFacts('jupiter', DATE)) > 4.9 && au(bodyFacts('jupiter', DATE)) < 5.5);
  assert.ok(au(bodyFacts('neptune', DATE)) > 29.7 && au(bodyFacts('neptune', DATE)) < 30.4);
  assert.ok(au(bodyFacts('pluto', DATE)) > 29.6 && au(bodyFacts('pluto', DATE)) < 49.4);
});

test('a planet sits exactly on its orbit line, which goes once around', () => {
  const orbit = planetOrbit('mars', DATE);
  assert.ok(Math.abs(orbit.a - 1.5237) < 0.01 && Math.abs(orbit.e - 0.0934) < 0.005);
  const path = ellipsePath(orbit, orbit.E, new Float64Array(91 * 3), 90);
  const mars = HelioVector(Body.Mars, DATE);
  assert.ok(Math.hypot(path[0] - mars.x, path[1] - mars.y, path[2] - mars.z) < 1e-9);
  assert.ok(Math.hypot(path[0] - path[270], path[1] - path[271], path[2] - path[272]) < 1e-9);
  // a month later Mars is still within a few hundred km of that line
  const later = HelioVector(Body.Mars, new Date(DATE.getTime() + 30 * 86400000));
  const E = eccentricAnomaly({ ...orbit, M0: orbit.E - orbit.e * Math.sin(orbit.E), epoch: 0 }, 30);
  const [x, y, z] = pointAt(orbit, E);
  assert.ok(Math.hypot(x - later.x, y - later.y, z - later.z) * KM_PER_AU < 20000);
  assert.equal(PLANETS.map(p => p.id).join(' '), 'mercury venus earth mars jupiter saturn uranus neptune pluto');
});

test('has a position for every body', () => {
  const positions = geocentric(DATE);
  for (const body of BODIES) assert.ok(positions[body.id], body.id);
  assert.deepEqual(positions.earth, { x: 0, y: 0, z: 0 });
});
