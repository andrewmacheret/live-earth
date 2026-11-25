import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AU,
  BODIES,
  bodyFacts,
  geocentric,
  KM_PER_AU,
  lagrangePoints,
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
  assert.equal(
    PLANETS.map(p => p.id).join(' '),
    'mercury venus earth mars jupiter saturn uranus neptune pluto ceres eris haumea makemake gonggong quaoar sedna orcus'
  );
});

test('the dwarf planets past Pluto are where JPL Horizons puts them', () => {
  const positions = geocentric(DATE);
  const fromSun = id => ['x', 'y', 'z'].map(k => positions[id][k] - positions.sun[k]);
  // Horizons vectors from the Sun's center for this date, in AU (J2000)
  const horizons = {
    eris: [85.05588555, 43.30250109, 0.03570706],
    ceres: [-0.29800948, 2.34214435, 1.16541797],
    sedna: [38.58171924, 72.14009107, 12.76406772]
  };
  for (const [id, want] of Object.entries(horizons)) {
    const got = fromSun(id);
    const off = Math.hypot(...got.map((v, k) => v - want[k]));
    const degrees = (off / Math.hypot(...want)) * (180 / Math.PI);
    assert.ok(degrees < 0.05, `${id} is ${degrees.toFixed(3)}° off`);
  }
  // its orbit line starts right at it
  const orbit = planetOrbit('eris', DATE);
  const start = ellipsePath(orbit, orbit.E, new Float64Array(91 * 3), 90);
  const eris = fromSun('eris');
  assert.ok(Math.hypot(start[0] - eris[0], start[1] - eris[1], start[2] - eris[2]) < 1e-9);
});

test('has a position for every body', () => {
  const positions = geocentric(DATE);
  for (const body of BODIES) assert.ok(positions[body.id], body.id);
  assert.deepEqual(positions.earth, { x: 0, y: 0, z: 0 });
});

test('Lagrange points sit where they should between their two bodies', () => {
  const date = new Date('2026-11-24T00:00:00Z');
  const g = geocentric(date);
  const km = (p, id) => Math.hypot(p.x - g[id].x, p.y - g[id].y, p.z - g[id].z) * KM_PER_AU;
  const points = Object.fromEntries(lagrangePoints(date).map(p => [p.id, p]));
  assert.equal(points['sun-earth-l2'].name, 'Sun–Earth L2');
  // L1 and L2 are about 1.5 million km from the Earth, on either side
  for (const id of ['sun-earth-l1', 'sun-earth-l2']) assert.ok(Math.abs(km(points[id], 'earth') - 1.5e6) < 0.05e6);
  assert.ok(km(points['sun-earth-l1'], 'sun') < km(g.earth, 'sun'));
  assert.ok(km(points['sun-earth-l2'], 'sun') > km(g.earth, 'sun'));
  // L4 and L5 make equal-sided triangles with their two bodies
  for (const [id, a, b] of [
    ['sun-earth-l4', 'sun', 'earth'],
    ['earth-moon-l5', 'earth', 'moon'],
    ['sun-jupiter-l4', 'sun', 'jupiter']
  ]) {
    const side = km(g[b], a);
    assert.ok(Math.abs(km(points[id], a) / side - 1) < 1e-9);
    assert.ok(Math.abs(km(points[id], b) / side - 1) < 1e-9);
  }
  // L4 is ahead of the Earth: going a little forward in time moves the Earth toward it
  const later = geocentric(new Date(date.getTime() + 86400000));
  const sunNow = g.sun;
  const earthLater = { x: later.earth.x - later.sun.x + sunNow.x, y: later.earth.y - later.sun.y + sunNow.y, z: later.earth.z - later.sun.z + sunNow.z };
  const l4 = points['sun-earth-l4'];
  assert.ok(Math.hypot(l4.x - earthLater.x, l4.y - earthLater.y, l4.z - earthLater.z) < Math.hypot(l4.x, l4.y, l4.z));
});
