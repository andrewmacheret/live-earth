import assert from 'node:assert/strict';
import { test } from 'node:test';
import { julianDay } from '../src/space/smallBodies.js';
import { downloadMoons, fitOrbit, fromCompactMoons, MOONS, moonOffset, moonPath, parseElements } from '../src/space/moons.js';

const NOW = Date.parse('2026-11-24T00:00:00Z');
const TDB_AHEAD_DAYS = 69.184 / 86400;

// a made-up moon whose orbit turns at a steady rate, like Horizons would describe it each day
const truth = { a: 185000, e: 0.02, i: 1.5, node: 40, dnode: -1, peri: 100, dperi: 1, L: 200, n: 381.99 };
const elementsOn = (jd, epoch) => {
  const dt = jd - epoch;
  const node = truth.node + truth.dnode * dt;
  const peri = truth.peri + truth.dperi * dt;
  const L = truth.L + truth.n * dt;
  const mod = value => ((value % 360) + 360) % 360;
  return { jd, e: truth.e, i: truth.i, node: mod(node), peri: mod(peri - node), M: mod(L - peri), a: truth.a, n: truth.n };
};

const horizonsText = rows =>
  [
    '$$SOE',
    ...rows.map(r =>
      [r.jd + TDB_AHEAD_DAYS, 'A.D. 2026-Nov-24 00:00:00.0000', r.e, 0, r.i, r.node, r.peri, 0, r.n, r.M, 0, r.a, 0, 0].join(', ')
    ),
    '$$EOE'
  ].join('\n');

test('reads Horizons orbit rows and moves their times from TDB to UTC', () => {
  const epoch = julianDay(NOW);
  const rows = parseElements(horizonsText([elementsOn(epoch, epoch)]));
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].jd - epoch) < 1e-9);
  assert.equal(rows[0].a, truth.a);
  assert.equal(rows[0].n, truth.n);
});

test('fitting a year of daily rows finds the steady orbit, even though the moon goes around many times a day', () => {
  const epoch = julianDay(NOW);
  const rows = [];
  for (let d = -365; d <= 365; d++) rows.push(elementsOn(epoch + d, epoch));
  const fit = fitOrbit(rows, epoch);
  assert.ok(Math.abs(fit.n - truth.n) < 1e-6);
  assert.ok(Math.abs(fit.dnode - truth.dnode) < 1e-6);
  assert.ok(Math.abs(fit.dperi - truth.dperi) < 1e-6);
  assert.ok(Math.abs(fit.L - truth.L) < 1e-4);
  assert.ok(Math.abs(fit.node - truth.node) < 1e-4);
  assert.ok(Math.abs(fit.a - truth.a) < 1);
});

test('a moon stays on its orbit line, and the line starts right at the moon', () => {
  const epoch = julianDay(NOW);
  const moon = { ...truth, epoch };
  for (const jd of [epoch - 1000, epoch, epoch + 123.4]) {
    const p = moonOffset(moon, jd);
    const r = Math.hypot(...p);
    assert.ok(r > truth.a * (1 - truth.e) - 1e-6 && r < truth.a * (1 + truth.e) + 1e-6);
    const path = moonPath(moon, jd, new Array(129 * 3), 128);
    assert.ok(Math.hypot(path[0] - p[0], path[1] - p[1], path[2] - p[2]) < 1e-6);
    assert.ok(Math.hypot(path.at(-3) - p[0], path.at(-2) - p[1], path.at(-1) - p[2]) < 1e-6);
  }
});

test('downloads every moon and skips one that fails', async () => {
  const fetchImpl = async url => {
    const params = new URL(url).searchParams;
    if (params.get('COMMAND') === "'607'") return { ok: false, status: 503 };
    const epoch = julianDay(NOW);
    const rows = [];
    for (let d = -365; d <= 365; d++) rows.push(elementsOn(epoch + d, epoch));
    return { ok: true, json: async () => ({ result: horizonsText(rows) }) };
  };
  const logs = [];
  const data = await downloadMoons({ fetchImpl, now: NOW, log: message => logs.push(message) });
  assert.equal(data.count, MOONS.length - 1);
  assert.deepEqual(data.skipped, ['hyperion']);
  assert.ok(logs.some(message => message.includes('Hyperion')));
  const moons = fromCompactMoons(JSON.parse(JSON.stringify(data)));
  assert.equal(moons.find(moon => moon.id === 'titan').planet, 'saturn');
  assert.ok(Math.abs(moons[0].n - truth.n) < 1e-6);
});
