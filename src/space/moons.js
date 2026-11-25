// The bigger and better-known moons of Mars, Jupiter, Saturn, Uranus, Neptune and Pluto.
// The Lambda asks JPL's Horizons system how each moon's orbit changes over a year either side of today,
// then fits a simple orbit that turns at a steady rate. That's a few numbers per moon, and it stays
// close for years. Everything is measured against the planet's own equator.
// Earth's Moon comes from Astronomy Engine in bodies.js instead. The Lambda uses this file too.
import { solveKepler } from './smallBodies.js';
import { HORIZONS_URL } from './spacecraft.js';

const DAY_MS = 86400000;
const DEG = Math.PI / 180;
const SPAN_DAYS = 365;
// Horizons counts time in TDB, which runs about 69 seconds ahead of UTC
const TDB_AHEAD_DAYS = 69.184 / 86400;

// planet is a body id from bodies.js. radiusKm is the mean radius.
export const MOONS = [
  { id: 'phobos', horizons: 401, planet: 'mars', name: 'Phobos', radiusKm: 11.1, color: '#a39486', article: 'Phobos (moon)' },
  { id: 'deimos', horizons: 402, planet: 'mars', name: 'Deimos', radiusKm: 6.2, color: '#b9a68f', article: 'Deimos (moon)' },
  { id: 'io', horizons: 501, planet: 'jupiter', name: 'Io', radiusKm: 1821.6, color: '#e8d36b', article: 'Io (moon)' },
  { id: 'europa', horizons: 502, planet: 'jupiter', name: 'Europa', radiusKm: 1560.8, color: '#d9c8a8', article: 'Europa (moon)' },
  { id: 'ganymede', horizons: 503, planet: 'jupiter', name: 'Ganymede', radiusKm: 2634.1, color: '#a89c8c', article: 'Ganymede (moon)' },
  { id: 'callisto', horizons: 504, planet: 'jupiter', name: 'Callisto', radiusKm: 2410.3, color: '#857869', article: 'Callisto (moon)' },
  { id: 'amalthea', horizons: 505, planet: 'jupiter', name: 'Amalthea', radiusKm: 83.5, color: '#b0664a', article: 'Amalthea (moon)' },
  { id: 'himalia', horizons: 506, planet: 'jupiter', name: 'Himalia', radiusKm: 69.8, color: '#9a9086', article: 'Himalia (moon)' },
  { id: 'mimas', horizons: 601, planet: 'saturn', name: 'Mimas', radiusKm: 198.2, color: '#c8c8c8', article: 'Mimas (moon)' },
  { id: 'enceladus', horizons: 602, planet: 'saturn', name: 'Enceladus', radiusKm: 252.1, color: '#f4f8ff', article: 'Enceladus' },
  { id: 'tethys', horizons: 603, planet: 'saturn', name: 'Tethys', radiusKm: 531.1, color: '#e2e2dc', article: 'Tethys (moon)' },
  { id: 'dione', horizons: 604, planet: 'saturn', name: 'Dione', radiusKm: 561.4, color: '#d6d4cc', article: 'Dione (moon)' },
  { id: 'rhea', horizons: 605, planet: 'saturn', name: 'Rhea', radiusKm: 763.8, color: '#cfcac0', article: 'Rhea (moon)' },
  { id: 'titan', horizons: 606, planet: 'saturn', name: 'Titan', radiusKm: 2574.7, color: '#e5b55a', article: 'Titan (moon)' },
  { id: 'hyperion', horizons: 607, planet: 'saturn', name: 'Hyperion', radiusKm: 135, color: '#b8a48a', article: 'Hyperion (moon)' },
  { id: 'iapetus', horizons: 608, planet: 'saturn', name: 'Iapetus', radiusKm: 734.5, color: '#a69a86', article: 'Iapetus (moon)' },
  { id: 'phoebe', horizons: 609, planet: 'saturn', name: 'Phoebe', radiusKm: 106.5, color: '#7a7268', article: 'Phoebe (moon)' },
  { id: 'miranda', horizons: 705, planet: 'uranus', name: 'Miranda', radiusKm: 235.8, color: '#c4c4c4', article: 'Miranda (moon)' },
  { id: 'ariel', horizons: 701, planet: 'uranus', name: 'Ariel', radiusKm: 578.9, color: '#d2d2d2', article: 'Ariel (moon)' },
  { id: 'umbriel', horizons: 702, planet: 'uranus', name: 'Umbriel', radiusKm: 584.7, color: '#929292', article: 'Umbriel' },
  { id: 'titania', horizons: 703, planet: 'uranus', name: 'Titania', radiusKm: 788.4, color: '#c0b8b0', article: 'Titania (moon)' },
  { id: 'oberon', horizons: 704, planet: 'uranus', name: 'Oberon', radiusKm: 761.4, color: '#a89c94', article: 'Oberon (moon)' },
  { id: 'triton', horizons: 801, planet: 'neptune', name: 'Triton', radiusKm: 1353.4, color: '#d8c8c0', article: 'Triton (moon)' },
  { id: 'proteus', horizons: 808, planet: 'neptune', name: 'Proteus', radiusKm: 210, color: '#8a8a8a', article: 'Proteus (moon)' },
  { id: 'nereid', horizons: 802, planet: 'neptune', name: 'Nereid', radiusKm: 170, color: '#a0a0a0', article: 'Nereid (moon)' },
  { id: 'charon', horizons: 901, planet: 'pluto', name: 'Charon', radiusKm: 606, color: '#a8a29a', article: 'Charon (moon)' }
];
export const MOON_BY_ID = Object.fromEntries(MOONS.map(moon => [moon.id, moon]));

// Horizons' code for each planet's center
const CENTERS = { mars: 499, jupiter: 599, saturn: 699, uranus: 799, neptune: 899, pluto: 999 };
const time = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function elementsUrl(moon, start, stop) {
  const params = {
    format: 'json',
    COMMAND: `'${moon.horizons}'`,
    EPHEM_TYPE: 'ELEMENTS',
    CENTER: `'500@${CENTERS[moon.planet]}'`,
    START_TIME: `'${time(start)}'`,
    STOP_TIME: `'${time(stop)}'`,
    STEP_SIZE: "'1 d'",
    // angles measured from the planet's equator
    REF_PLANE: 'BODY EQUATOR',
    OUT_UNITS: 'KM-D',
    CSV_FORMAT: 'YES',
    OBJ_DATA: 'NO'
  };
  return `${HORIZONS_URL}?${new URLSearchParams(params)}`;
}

// Rows of { jd, e, i, node, peri, M, a, n } from a Horizons answer. Angles are degrees, n is degrees a day.
export function parseElements(text) {
  const table = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text)?.[1] ?? '';
  return table
    .split('\n')
    .map(line => line.split(',').map(cell => cell.trim()))
    .filter(cells => cells.length >= 13)
    .map(([jd, , e, , i, node, peri, , n, M, , a]) => ({
      jd: Number(jd) - TDB_AHEAD_DAYS,
      e: Number(e),
      i: Number(i),
      node: Number(node),
      peri: Number(peri),
      M: Number(M),
      a: Number(a),
      n: Number(n)
    }));
}

// a straight line through (x, y) points, as [value at x = 0, slope]
function fitLine(xs, ys) {
  const count = xs.length;
  const mx = xs.reduce((sum, x) => sum + x, 0) / count;
  const my = ys.reduce((sum, y) => sum + y, 0) / count;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < count; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return [my - slope * mx, slope];
}

// angles in degrees that only jump by whole turns, turned into one smooth run
function unwrap(values, predict = (previous, k) => previous) {
  const out = [values[0]];
  for (let k = 1; k < values.length; k++) {
    const guess = predict(out[k - 1], k);
    out.push(values[k] + 360 * Math.round((guess - values[k]) / 360));
  }
  return out;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// The steady orbit that best matches a year of Horizons rows, around the day epoch.
// L is where it is (node + peri + M, the "mean longitude"), and node and peri turn slowly at dnode and dperi.
export function fitOrbit(rows, epoch) {
  const t = rows.map(row => row.jd - epoch);
  const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const nodes = unwrap(rows.map(row => row.node));
  // the longitude of the closest point, which is still steady when the orbit is tipped
  const peris = unwrap(rows.map(row => row.node + row.peri));
  // a moon goes around many times between rows, so guess each step from how fast it was going
  const L = unwrap(
    rows.map(row => row.node + row.peri + row.M),
    (previous, k) => previous + rows[k - 1].n * (rows[k].jd - rows[k - 1].jd)
  );
  const [node, dnode] = fitLine(t, nodes);
  const [peri, dperi] = fitLine(t, peris);
  const [L0, n] = fitLine(t, L);
  const mod = value => ((value % 360) + 360) % 360;
  return {
    a: round(mean('a'), 1),
    e: round(mean('e'), 6),
    i: round(mean('i'), 5),
    node: round(mod(node), 5),
    dnode: round(dnode, 9),
    peri: round(mod(peri), 5),
    dperi: round(dperi, 9),
    L: round(mod(L0), 5),
    n: round(n, 8)
  };
}

async function getText(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Horizons answered ${response.status}`);
  const { result, error } = await response.json();
  if (!result) throw new Error(error || 'empty answer');
  return result;
}

// Every moon's fitted orbit. One that fails is left out.
export async function downloadMoons({ fetchImpl = fetch, now = Date.now(), log = () => {} } = {}) {
  const epoch = Math.round(now / DAY_MS) + 2440587.5;
  const out = [];
  for (const moon of MOONS) {
    try {
      const rows = parseElements(
        await getText(elementsUrl(moon, now - SPAN_DAYS * DAY_MS, now + SPAN_DAYS * DAY_MS), fetchImpl)
      );
      if (rows.length < 30) throw new Error(`only ${rows.length} rows`);
      out.push({ id: moon.id, ...fitOrbit(rows, epoch) });
    } catch (err) {
      log(`Skipped ${moon.name}: ${err.message}`);
    }
  }
  return { generated: new Date(now).toISOString(), source: 'NASA JPL Horizons', epoch, count: out.length, moons: out };
}

// Ready-to-use moons from the downloaded file, each with its details from MOONS
export function fromCompactMoons(data) {
  return data.moons.filter(entry => MOON_BY_ID[entry.id]).map(entry => ({ ...MOON_BY_ID[entry.id], ...entry, epoch: data.epoch }));
}

// The moon's orbit on this Julian day. E is where it is on it (the eccentric anomaly).
function orbitAt(moon, jd) {
  const dt = jd - moon.epoch;
  const node = (moon.node + moon.dnode * dt) * DEG;
  const peri = (moon.peri + moon.dperi * dt) * DEG;
  const M = (moon.L + moon.n * dt) * DEG - peri;
  return { a: moon.a, e: moon.e, i: moon.i * DEG, node, w: peri - node, E: solveKepler(M, moon.e) };
}

// the spot at E on the orbit, written into out at index k
function pointOn({ a, e, i, node, w }, E, out, k = 0) {
  const px = a * (Math.cos(E) - e);
  const py = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw] = [Math.cos(w), Math.sin(w)];
  const [cn, sn] = [Math.cos(node), Math.sin(node)];
  const x = px * cw - py * sw;
  const y = px * sw + py * cw;
  out[k] = x * cn - y * Math.cos(i) * sn;
  out[k + 1] = x * sn + y * Math.cos(i) * cn;
  out[k + 2] = y * Math.sin(i);
  return out;
}

// Where the moon is on this Julian day, in km from its planet, measured against the planet's equator
// (x toward where the equator crosses Earth's, z toward the planet's north pole)
export function moonOffset(moon, jd, out = [0, 0, 0]) {
  const orbit = orbitAt(moon, jd);
  return pointOn(orbit, orbit.E, out);
}

// One trip around as [x, y, z, ...] in km, starting and ending right at the moon, so it sits on the line
export function moonPath(moon, jd, out, points) {
  const orbit = orbitAt(moon, jd);
  for (let j = 0; j <= points; j++) pointOn(orbit, orbit.E + (j / points) * 2 * Math.PI, out, j * 3);
  return out;
}

// days for one trip around
export function moonPeriod(moon) {
  return 360 / moon.n;
}
