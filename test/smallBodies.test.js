import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Body, HelioVector } from 'astronomy-engine';
import {
  displayName,
  fromCompactBodies,
  julianDay,
  kindOf,
  orbitOf,
  orbitPath,
  periodDays,
  positionAt,
  sizeFromH,
  toCompactBodies
} from '../src/space/smallBodies.js';

const DATE = new Date('2026-11-24T22:00:00Z');

// JPL's mean orbits for 2000 (https://ssd.jpl.nasa.gov/planets/approx_pos.html), as if they were asteroids
const J2000 = 2451545.0;
const EARTH = { e: 0.01671123, a: 1.00000261, i: 0, node: 0, peri: 102.93768193, M: 100.46457166 - 102.93768193, epoch: J2000 };
const MARS = {
  e: 0.0933941,
  a: 1.52371034,
  i: 1.84969142,
  node: 49.55953891,
  peri: -23.94362959 - 49.55953891,
  M: -4.55343205 + 23.94362959,
  epoch: J2000
};

function distance(elements, body) {
  const [x, y, z] = positionAt(orbitOf(elements), julianDay(DATE));
  const v = HelioVector(body, DATE);
  return Math.hypot(x - v.x, y - v.y, z - v.z);
}

test('Kepler orbits put Earth and Mars about where Astronomy Engine does', () => {
  assert.ok(distance(EARTH, Body.Earth) < 0.01, `Earth is ${distance(EARTH, Body.Earth)} AU off`);
  assert.ok(distance(MARS, Body.Mars) < 0.05, `Mars is ${distance(MARS, Body.Mars)} AU off`);
  assert.ok(Math.abs(periodDays(orbitOf(MARS)) - 686.98) < 0.5);
});

test('very stretched orbits still solve', () => {
  const halley = orbitOf({ e: 0.9679, a: 17.93, i: 162.19, node: 59.1, peri: 112.24, M: 0, epoch: J2000 });
  const [x, y, z] = positionAt(halley, J2000);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 17.93 * (1 - 0.9679)) < 1e-6);
  for (let day = 0; day < 30000; day += 997) {
    const r = Math.hypot(...positionAt(halley, J2000 + day));
    assert.ok(r > 0.57 && r < 35.3, `${r} AU on day ${day}`);
  }
});

const row = more => ({
  full_name: '     1 Ceres (A801 AA)',
  pdes: '1',
  name: 'Ceres',
  kind: 'an',
  class: 'MBA',
  neo: 'N',
  pha: 'N',
  e: '0.0797',
  a: '2.766',
  i: '10.59',
  om: '80.25',
  w: '73.29',
  ma: '274.42',
  epoch: '2461200.5',
  H: '3.34',
  diameter: '939.4',
  ...more
});

test('sorts rocks into kinds and names them', () => {
  assert.equal(kindOf(row()), 'dwarf');
  assert.equal(kindOf(row({ pdes: '4' })), 'main');
  assert.equal(kindOf(row({ pdes: '99942', pha: 'Y', neo: 'Y' })), 'hazardous');
  assert.equal(kindOf(row({ pdes: '1P', kind: 'cn' })), 'comet');
  assert.equal(kindOf(row({ pdes: '624', class: 'TJN' })), 'trojan');
  assert.equal(displayName(row()), '1 Ceres');
  assert.equal(displayName(row({ pdes: '1P', name: 'Halley', kind: 'cn' })), '1P/Halley');
  assert.equal(displayName(row({ full_name: '       (2025 OK742)', pdes: '2025 OK742', name: null })), '(2025 OK742)');
});

test('packs rocks into columns and moves them all to the same epoch', () => {
  const rows = [
    row(),
    row(), // a duplicate from a second query
    row({ pdes: '134340', name: 'Pluto' }),
    row({ pdes: 'C/2025 X1', kind: 'cu', e: '1.0003' }),
    row({ pdes: '4', name: 'Vesta', e: '0.0894', a: '2.362', H: null, diameter: null })
  ];
  const data = toCompactBodies(rows, { generated: '2026-11-24T02:30:00.000Z' });
  assert.equal(data.count, 2);
  const [ceres, vesta] = fromCompactBodies(JSON.parse(JSON.stringify(data)));
  assert.equal(ceres.name, '1 Ceres');
  assert.equal(ceres.kind, 'dwarf');
  assert.equal(ceres.size, 939.4);
  assert.equal(vesta.H, null);
  // the same spot in the orbit, either from JPL's epoch or the file's
  const fromJpl = positionAt(orbitOf({ ...ceres, M: 274.42, epoch: 2461200.5 }), julianDay(DATE));
  const fromFile = positionAt(orbitOf(ceres), julianDay(DATE));
  assert.ok(Math.hypot(...fromJpl.map((v, k) => v - fromFile[k])) < 1e-4);
});

test('guesses sizes from brightness', () => {
  assert.ok(Math.abs(sizeFromH(3.34) - 760) < 50);
  assert.ok(sizeFromH(22) > 0.1 && sizeFromH(22) < 0.2);
});

const MU = 0.01720209895 ** 2;
// speed squared over 2 minus pull, which stays the same all along an orbit
function energy(orbit, jd) {
  const dt = 1e-4;
  const a = positionAt(orbit, jd - dt);
  const b = positionAt(orbit, jd + dt);
  const p = positionAt(orbit, jd);
  const v2 = b.reduce((sum, value, k) => sum + ((value - a[k]) / (2 * dt)) ** 2, 0);
  return v2 / 2 - MU / Math.hypot(...p);
}

test('visitors that pass through once follow their open orbit', () => {
  const tp = 2460977.94;
  for (const e of [1, 1.2, 6.12]) {
    const q = 1.36;
    const orbit = orbitOf({ e, a: q, i: 175.1, node: 322.2, peri: 128, M: 30, epoch: tp + 30 });
    assert.ok(orbit.open);
    assert.equal(periodDays(orbit), null);
    // closest to the Sun, q away, on day tp
    assert.ok(Math.abs(Math.hypot(...positionAt(orbit, tp)) - q) < 1e-9);
    // a parabola has exactly enough energy to escape, and the others have more, the same everywhere
    const expected = e === 1 ? 0 : MU / (2 * (q / (e - 1)));
    for (const day of [-3000, -40, 0, 1, 365, 4000]) {
      assert.ok(Math.abs(energy(orbit, tp + day) - expected) < 1e-9 + Math.abs(expected) * 1e-5, `e ${e} day ${day}`);
    }
    // moving away from the Sun after tp, and toward it before
    const r = day => Math.hypot(...positionAt(orbit, tp + day));
    assert.ok(r(100) > r(50) && r(-100) > r(-50));
    // the line runs through the body
    const path = orbitPath(orbit, tp + 200, new Array(257 * 3), 256);
    const p = positionAt(orbit, tp + 200);
    assert.ok(Math.hypot(path[128 * 3] - p[0], path[128 * 3 + 1] - p[1], path[128 * 3 + 2] - p[2]) < 1e-9);
  }
});

test('keeps comets passing through, and the interstellar visitors under their short names', () => {
  const rows = [
    row({ full_name: 'C/2025 N1 (ATLAS)', pdes: '3I', alias: 'C/2025 N1', kind: 'cu', e: '6.12', a: '-0.264', q: '1.36', tp: '2460977.94' }),
    // the same one again from the comet query, under its comet name
    row({ full_name: 'C/2025 N1 (ATLAS)', pdes: 'C/2025 N1', kind: 'cu', e: '6.12', a: '-0.264', q: '1.36', tp: '2460977.94' }),
    row({ full_name: 'C/2021 G2 (ATLAS)', pdes: 'C/2021 G2', kind: 'cu', e: '1.0006', a: '-8201', q: '4.98', tp: '2460562.63' })
  ];
  const data = toCompactBodies(rows, { generated: '2026-11-24T02:30:00.000Z' });
  assert.equal(data.count, 2);
  const [atlas, comet] = fromCompactBodies(JSON.parse(JSON.stringify(data)));
  assert.equal(atlas.name, '3I/ATLAS');
  assert.equal(atlas.kind, 'interstellar');
  assert.equal(comet.kind, 'comet');
  const orbit = orbitOf(atlas);
  assert.ok(Math.abs(orbit.tp - 2460977.94) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...positionAt(orbit, 2460977.94)) - 1.36) < 1e-9);
});
