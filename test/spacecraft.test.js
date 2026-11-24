import assert from 'node:assert/strict';
import { test } from 'node:test';
import { julianDay, solveKepler } from '../src/space/smallBodies.js';
import {
  craftPath,
  craftPosition,
  craftSpeed,
  downloadSpacecraft,
  fromCompactSpacecraft,
  parseVectors,
  SPACECRAFT,
  thinRows
} from '../src/space/spacecraft.js';

const KM_PER_AU = 149597870.7;
const NOW = Date.parse('2026-11-24T00:00:00Z');
const TDB_AHEAD_DAYS = 69.184 / 86400;

// a circle 1 AU from the Sun, once a year
const circle = jd => {
  const n = (2 * Math.PI) / 365.25;
  const t = n * (jd - 2461000.5);
  return [Math.cos(t), Math.sin(t), 0, -n * Math.sin(t), n * Math.cos(t), 0];
};

const horizonsText = rows =>
  [
    '*******',
    '$$SOE',
    ...rows.map(([jd, ...v]) => `${jd.toFixed(9)}, A.D. 2026-Nov-24 00:00:00.0000, ${v.map(x => x.toExponential(15)).join(', ')},`),
    '$$EOE',
    '*******'
  ].join('\n');

// A pretend Horizons. Hera's data stops 30 days from now, and Lucy always fails.
function fakeHorizons() {
  const calls = [];
  const fetchImpl = async url => {
    const params = new URL(url).searchParams;
    const id = Number(params.get('COMMAND').replaceAll("'", ''));
    const parse = name => Date.parse(`${params.get(name).replaceAll("'", '').replace(' ', 'T')}:00Z`);
    const [start, stop] = [parse('START_TIME'), parse('STOP_TIME')];
    const step = Number(params.get('STEP_SIZE').replace(/'| m/g, '')) / 1440;
    calls.push({ id, start, stop, step });
    const json = body => ({ ok: true, json: async () => body });
    if (id === -49) return { ok: false, status: 503 };
    const limit = NOW + 30 * 86400000;
    if (id === -91 && stop > limit) {
      return json({ error: 'No ephemeris for target "Hera (spacecraft)" after A.D. 2026-DEC-24 00:01:09.1843 TDB' });
    }
    const rows = [];
    for (let jd = julianDay(start); jd <= julianDay(stop) + 1e-9; jd += step) rows.push([jd + TDB_AHEAD_DAYS, ...circle(jd)]);
    return json({ result: horizonsText(rows) });
  };
  return { fetchImpl, calls };
}

test('reads Horizons rows and moves their times from TDB to UTC', () => {
  const rows = parseVectors(horizonsText([[2461368.5 + TDB_AHEAD_DAYS, 1, 2, 3, 0.1, 0.2, 0.3]]));
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0][0] - 2461368.5) < 1e-9);
  assert.deepEqual(rows[0].slice(1), [1, 2, 3, 0.1, 0.2, 0.3]);
});

test('thinning keeps few rows on a smooth path, and everything it drops is within 500 km', () => {
  const rows = [];
  for (let jd = 2461000.5; jd < 2461100.5; jd += 0.25) rows.push([jd, ...circle(jd)]);
  const kept = thinRows(rows);
  assert.ok(kept.length < 20, `kept ${kept.length}`);
  assert.equal(kept[0], rows[0]);
  assert.equal(kept.at(-1), rows.at(-1));
  const craft = fromCompactSpacecraft({
    spacecraft: [
      { id: 'psyche', center: 'sun', start: kept[0][0], days: kept.map(r => r[0] - kept[0][0]), samples: kept.flatMap(r => r.slice(1)) }
    ]
  })[0];
  for (const [jd, x, y, z] of rows) {
    const p = craftPosition(craft, jd);
    assert.ok(Math.hypot(p[0] - x, p[1] - y, p[2] - z) * KM_PER_AU < 501);
  }
});

test('downloads each spacecraft, asks for less when the data stops sooner, and skips one that fails', async () => {
  const { fetchImpl, calls } = fakeHorizons();
  const logs = [];
  const data = await downloadSpacecraft({ fetchImpl, now: NOW, log: message => logs.push(message) });
  assert.equal(data.count, SPACECRAFT.length - 1);
  assert.ok(!data.spacecraft.some(entry => entry.id === 'lucy'));
  assert.ok(logs.some(message => message.includes('Lucy')));

  const heraCalls = calls.filter(call => call.id === -91);
  assert.equal(heraCalls.length, 2);
  assert.ok(heraCalls[1].stop < heraCalls[0].stop);

  const crafts = fromCompactSpacecraft(JSON.parse(JSON.stringify(data)));
  const jd = julianDay(NOW);
  for (const craft of crafts) {
    const p = craftPosition(craft, jd);
    const [x, y, z] = circle(jd);
    assert.ok(Math.hypot(p[0] - x, p[1] - y, p[2] - z) * KM_PER_AU < (craft.toleranceKm ?? 500) + 100, craft.name);
    // a circle at 1 AU goes about 29.8 km/s
    assert.ok(Math.abs((craftSpeed(craft, jd) * KM_PER_AU) / 86400 - 29.8) < 0.1, craft.name);
  }
});

test('past its data a coasting spacecraft keeps going straight, and the rest disappear', async () => {
  const { fetchImpl } = fakeHorizons();
  const crafts = fromCompactSpacecraft(await downloadSpacecraft({ fetchImpl, now: NOW }));
  const voyager = crafts.find(craft => craft.id === 'voyager-1');
  const psyche = crafts.find(craft => craft.id === 'psyche');
  const later = voyager.end + 10;
  const end = craftPosition(voyager, voyager.end);
  const v = voyager.samples.slice(-3);
  const p = craftPosition(voyager, later);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(p[c] - (end[c] + v[c] * 10)) < 1e-9);
  assert.equal(craftPosition(psyche, psyche.end + 10), null);
  assert.equal(craftPosition(psyche, psyche.start - 10), null);
});

test("Parker's ellipse goes all the way around, even before the day it was saved", () => {
  // close to the Sun and very stretched, like Parker's final orbit
  const mu = 0.01720209895 ** 2;
  const [q, Q] = [0.0459, 0.7313];
  const a = (q + Q) / 2;
  const vq = Math.sqrt(mu * (2 / q - 1 / a));
  const epoch = 2461368.5;
  const craft = fromCompactSpacecraft({
    spacecraft: [{ id: 'parker', center: 'sun', epoch, state: [q, 0, 0, 0, vq, 0] }]
  })[0];
  const period = (2 * Math.PI) / craft.ellipse.n;
  assert.ok(Math.abs(period - 88) < 1, `period ${period}`);
  for (let dt = -400; dt <= 400; dt += 0.37) {
    const r = Math.hypot(...craftPosition(craft, epoch + dt));
    assert.ok(r > q - 1e-6 && r < Q + 1e-6, `r ${r} at ${dt}`);
  }
  const back = craftPosition(craft, epoch - period);
  assert.ok(Math.hypot(back[0] - q, back[1], back[2]) < 1e-6);
  const path = craftPath(craft, epoch);
  assert.ok(Math.abs(path[0] - q) < 1e-9 && Math.abs(path.at(-3) - q) < 1e-9);
});

test("Kepler's equation is solved for negative angles on stretched orbits too", () => {
  for (const e of [0.1, 0.88, 0.97]) {
    for (let M = -20; M < 20; M += 0.1) {
      const E = solveKepler(M, e);
      const wrapped = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      assert.ok(Math.abs(E - e * Math.sin(E) - wrapped) < 1e-9, `e ${e} M ${M}`);
    }
  }
});
