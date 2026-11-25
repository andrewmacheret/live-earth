// Asteroids, dwarf planets and comets from NASA JPL's Small-Body Database (SBDB).
// JPL's API doesn't let web pages call it directly, so Lambda LiveEarth downloads them once a day.
// This file has no imports because the Lambda uses it too.

export const SBDB_QUERY_URL = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
export const SBDB_LOOKUP_URL = 'https://ssd-api.jpl.nasa.gov/sbdb.api';

const FIELDS = ['full_name', 'pdes', 'name', 'prefix', 'kind', 'class', 'neo', 'pha', 'e', 'a', 'q', 'i', 'om', 'w', 'ma', 'tp', 'epoch', 'H', 'diameter'];

// The brighter asteroids (smaller H is brighter, and roughly bigger), every potentially hazardous one,
// every numbered comet, and the other comets passing the Sun within 3 years of now, which includes
// the ones that come by once and never come back. That's about 19,000 rocks.
function queries(now) {
  const jd = julianDay(now);
  return [
    { 'sb-kind': 'a', 'sb-cdata': JSON.stringify({ AND: ['H|LT|13'] }) },
    { 'sb-group': 'pha' },
    { 'sb-kind': 'c', 'sb-ns': 'n' },
    { 'sb-kind': 'c', 'sb-ns': 'u', 'sb-cdata': JSON.stringify({ AND: [`tp|RG|${jd - 1100}|${jd + 1100}`, 'q|LT|6'] }) }
  ];
}

// famous comets without a number, and the three visitors from other stars, looked up one at a time
const EXTRA = ['1I', '2I', '3I', 'C/1995 O1', 'C/2020 F3'];
const INTERSTELLAR = { '1I': '1I/ʻOumuamua', '2I': '2I/Borisov', '3I': '3I/ATLAS' };

// Pluto is already a planet in bodies.js
const SKIP = new Set(['134340']);

// short is for tight spots like the search list, and plural is for the legend
export const KINDS = [
  { id: 'dwarf', label: 'Dwarf planet', short: 'Dwarf planet', plural: 'Dwarf planets', color: '#efe2c8' },
  {
    id: 'hazardous',
    label: 'Potentially hazardous asteroid',
    short: 'Hazardous asteroid',
    plural: 'Potentially hazardous',
    color: '#ff6b6b'
  },
  { id: 'neo', label: 'Near-Earth asteroid', short: 'Near-Earth asteroid', plural: 'Other near-Earth', color: '#ffa94d' },
  { id: 'main', label: 'Main-belt asteroid', short: 'Asteroid', plural: 'Main asteroid belt', color: '#b3a28c' },
  { id: 'trojan', label: 'Jupiter trojan asteroid', short: 'Jupiter trojan', plural: 'Jupiter trojans', color: '#8fd16a' },
  {
    id: 'centaur',
    label: 'Centaur (between Jupiter and Neptune)',
    short: 'Centaur',
    plural: 'Centaurs',
    color: '#c792ff'
  },
  { id: 'tno', label: 'Trans-Neptunian object', short: 'Beyond Neptune', plural: 'Kuiper belt and beyond', color: '#6fa8ff' },
  { id: 'comet', label: 'Comet', short: 'Comet', plural: 'Comets', color: '#7ff0ff' },
  {
    id: 'interstellar',
    label: 'Interstellar object, passing through from another star',
    short: 'Interstellar',
    plural: 'Interstellar visitors',
    color: '#ff7bd5'
  }
];
export const KIND_BY_ID = Object.fromEntries(KINDS.map(kind => [kind.id, kind]));

const DWARFS = new Set(['1', '136199', '136108', '136472']);

// Rocks worth a label, by JPL designation, with their Wikipedia article
export const NOTABLE = {
  1: 'Ceres (dwarf planet)',
  4: '4 Vesta',
  2: '2 Pallas',
  10: '10 Hygiea',
  16: '16 Psyche',
  433: '433 Eros',
  25143: '25143 Itokawa',
  101955: '101955 Bennu',
  162173: '162173 Ryugu',
  99942: '99942 Apophis',
  65803: '65803 Didymos',
  3200: '3200 Phaethon',
  486958: '486958 Arrokoth',
  136199: 'Eris (dwarf planet)',
  136108: 'Haumea',
  136472: 'Makemake',
  225088: 'Gonggong',
  50000: '50000 Quaoar',
  90377: '90377 Sedna',
  90482: '90482 Orcus',
  '1P': "Halley's Comet",
  '2P': 'Comet Encke',
  '9P': 'Tempel 1',
  '12P': '12P/Pons–Brooks',
  '55P': '55P/Tempel–Tuttle',
  '67P': '67P/Churyumov–Gerasimenko',
  '81P': '81P/Wild',
  '109P': '109P/Swift–Tuttle',
  'C/1995 O1': 'Comet Hale–Bopp',
  'C/2020 F3': 'Comet NEOWISE',
  '1I': 'ʻOumuamua',
  '2I': '2I/Borisov',
  '3I': '3I/ATLAS'
};

export function kindOf(row) {
  if (INTERSTELLAR[row.pdes]) return 'interstellar';
  if (row.kind?.startsWith('c')) return 'comet';
  if (DWARFS.has(row.pdes)) return 'dwarf';
  if (row.pha === 'Y') return 'hazardous';
  if (row.neo === 'Y') return 'neo';
  if (row.class === 'TJN') return 'trojan';
  if (row.class === 'CEN') return 'centaur';
  if (row.class === 'TNO') return 'tno';
  return 'main';
}

// "433 Eros", "1P/Halley", "C/1995 O1 (Hale-Bopp)", or "(2004 MN4)" when it has no name yet
export function displayName(row) {
  if (INTERSTELLAR[row.pdes]) return INTERSTELLAR[row.pdes];
  if (row.kind?.startsWith('c') && row.name && /^\d+[PD]$/.test(row.pdes)) return `${row.pdes}/${row.name}`;
  if (row.name && /^\d+$/.test(row.pdes)) return `${row.pdes} ${row.name}`;
  return row.full_name.trim();
}

// Comets without a number get their letter back, like "C/2021 G2" instead of "2021 G2", the same as a lookup gives
function toRows({ fields, data }) {
  return (data ?? []).map(values => {
    const row = Object.fromEntries(fields.map((field, i) => [field, values[i]]));
    if (row.prefix && row.pdes.includes(' ') && !row.pdes.includes('/')) row.pdes = `${row.prefix}/${row.pdes}`;
    return row;
  });
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`SBDB answered ${response.status}`);
  return response.json();
}

// a lookup answer looks different from a query answer, so turn it into the same kind of row.
// The interstellar ones keep the short name they were looked up by, like "3I", and remember their
// other name, like "C/2025 N1", so the comet query doesn't add them twice.
function lookupRow({ object, orbit }, sstr) {
  const element = name => orbit.elements.find(el => el.name === name)?.value ?? null;
  // JPL says "1995 O1" here but "C/1995 O1" everywhere else
  const des = object.prefix && !object.des.includes('/') ? `${object.prefix}/${object.des}` : object.des;
  return {
    full_name: object.fullname,
    pdes: INTERSTELLAR[sstr] ? sstr : des,
    alias: des,
    name: null,
    prefix: object.prefix,
    kind: object.kind,
    class: object.orbit_class?.code,
    neo: object.neo ? 'Y' : 'N',
    pha: object.pha ? 'Y' : 'N',
    e: element('e'),
    a: element('a'),
    q: element('q'),
    i: element('i'),
    om: element('om'),
    w: element('w'),
    ma: element('ma'),
    tp: element('tp'),
    epoch: orbit.epoch,
    H: null,
    diameter: null
  };
}

// The lookups come first, so a visitor's short name like "3I" wins over its comet name
export async function downloadSmallBodies(fetchImpl = fetch, now = Date.now()) {
  const rows = [];
  for (const sstr of EXTRA) {
    // a missing extra comet isn't worth failing over. Without full-prec the numbers come back rounded.
    try {
      const params = new URLSearchParams({ sstr, 'full-prec': 'true' });
      rows.push(lookupRow(await getJson(`${SBDB_LOOKUP_URL}?${params}`, fetchImpl), sstr));
    } catch {}
  }
  for (const query of queries(now)) {
    const params = new URLSearchParams({ fields: FIELDS.join(','), ...query });
    rows.push(...toRows(await getJson(`${SBDB_QUERY_URL}?${params}`, fetchImpl)));
  }
  return rows;
}

const DAY_MS = 86400000;
const DEG = Math.PI / 180;
// the Gaussian gravitational constant: how fast something 1 AU from the Sun goes around, in radians a day
const GAUSS_K = 0.01720209895;

export function julianDay(date) {
  return new Date(date).getTime() / DAY_MS + 2440587.5;
}

export function meanMotion(a) {
  return GAUSS_K / a ** 1.5;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const num = value => (value === null || value === undefined || value === '' ? null : Number(value));

// Rows from JPL, as columns to keep the file small. Every rock's mean anomaly is moved to the same epoch.
// Comets passing through (e of 1 or more) have no ellipse, so for them a is the closest they get to
// the Sun (q), and M is how many days past that closest day they are at the epoch.
export function toCompactBodies(rows, { generated = new Date().toISOString() } = {}) {
  const epoch = Math.floor(julianDay(generated) - 0.5) + 0.5;
  const columns = { name: [], pdes: [], kind: [], e: [], a: [], i: [], node: [], peri: [], M: [], H: [], size: [] };
  const kinds = KINDS.map(kind => kind.id);
  const seen = new Set();
  for (const row of rows) {
    const e = num(row.e);
    const open = e >= 1;
    const a = open ? num(row.q) : num(row.a);
    if (seen.has(row.pdes) || SKIP.has(row.pdes) || !(a > 0) || !(e >= 0) || (open && num(row.tp) == null)) continue;
    seen.add(row.pdes);
    if (row.alias) seen.add(row.alias);
    let M;
    if (open) M = round(epoch - num(row.tp), 3);
    else {
      M = (num(row.ma) + (meanMotion(a) / DEG) * (epoch - num(row.epoch))) % 360;
      M = round(M < 0 ? M + 360 : M, 3);
    }
    columns.name.push(displayName(row));
    columns.pdes.push(row.pdes);
    columns.kind.push(kinds.indexOf(kindOf(row)));
    columns.e.push(e);
    columns.a.push(a);
    columns.i.push(num(row.i));
    columns.node.push(num(row.om));
    columns.peri.push(num(row.w));
    columns.M.push(M);
    columns.H.push(num(row.H));
    columns.size.push(num(row.diameter));
  }
  return { generated, source: 'NASA JPL Small-Body Database', epoch, kinds, count: columns.name.length, columns };
}

export function fromCompactBodies(data) {
  const { columns, kinds, epoch } = data;
  return columns.name.map((name, k) => ({
    name,
    pdes: columns.pdes[k],
    kind: kinds[columns.kind[k]],
    e: columns.e[k],
    a: columns.a[k],
    i: columns.i[k],
    node: columns.node[k],
    peri: columns.peri[k],
    M: columns.M[k],
    H: columns.H[k],
    size: columns.size[k],
    epoch
  }));
}

// The tilt between the planets' plane (which JPL's angles use) and Earth's equator in 2000
const TILT = 23.4392911 * DEG;
const COS_TILT = Math.cos(TILT);
const SIN_TILT = Math.sin(TILT);

// Works out everything about an orbit that doesn't change over time.
// P points to where it's closest to the Sun and Q is a quarter turn ahead, both turned to J2000 equator coordinates.
// An open orbit (e of 1 or more) passes the Sun once, q AU away on Julian day tp.
export function orbitOf({ e, a, i, node, peri, M, epoch }) {
  const [ci, si] = [Math.cos(i * DEG), Math.sin(i * DEG)];
  const [cn, sn] = [Math.cos(node * DEG), Math.sin(node * DEG)];
  const [cw, sw] = [Math.cos(peri * DEG), Math.sin(peri * DEG)];
  const toEquator = (x, y, z) => [x, y * COS_TILT - z * SIN_TILT, y * SIN_TILT + z * COS_TILT];
  const P = toEquator(cn * cw - sn * sw * ci, sn * cw + cn * sw * ci, sw * si);
  const Q = toEquator(-cn * sw - sn * cw * ci, -sn * sw + cn * cw * ci, cw * si);
  if (e >= 1) return { open: true, e, q: a, tp: epoch - M, P, Q };
  return { e, a, b: a * Math.sqrt(1 - e * e), n: meanMotion(a), M0: M * DEG, epoch, P, Q };
}

// days for one trip around, or null for one that never comes back
export function periodDays(orbit) {
  return orbit.open ? null : (2 * Math.PI) / orbit.n;
}

// the closest and farthest it gets from the Sun, in AU. Open orbits have no farthest.
export function distanceRange(orbit) {
  return orbit.open ? [orbit.q, null] : [orbit.a * (1 - orbit.e), orbit.a * (1 + orbit.e)];
}

// Solves the open-orbit version of Kepler's equation, e sinh(H) - H = M, for H
function solveHyperbolic(M, e) {
  let H = Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  for (let step = 0; step < 50; step++) {
    const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return H;
}

// For an open orbit, a number for how far along it is, like E for an ellipse: H for e over 1, or
// tan(half the angle from the closest point) for e of exactly 1
function openAnomaly(orbit, jd) {
  const { e, q } = orbit;
  const dt = jd - orbit.tp;
  if (e > 1) {
    const A = q / (e - 1);
    return solveHyperbolic((GAUSS_K / A ** 1.5) * dt, e);
  }
  // a parabola: solve D + D^3/3 = W (Barker's equation)
  const W = (GAUSS_K * dt) / Math.sqrt(2 * q ** 3);
  const Y = Math.cbrt(1.5 * W + Math.sqrt(2.25 * W * W + 1));
  return Y - 1 / Y;
}

// Where an open orbit is at anomaly H (from openAnomaly), in AU from the Sun (J2000), written into out at index k
function openPoint(orbit, H, out, k = 0) {
  const { e, q, P, Q } = orbit;
  let x;
  let y;
  if (e > 1) {
    const A = q / (e - 1);
    x = A * (e - Math.cosh(H));
    y = A * Math.sqrt(e * e - 1) * Math.sinh(H);
  } else {
    x = q * (1 - H * H);
    y = 2 * q * H;
  }
  out[k] = P[0] * x + Q[0] * y;
  out[k + 1] = P[1] * x + Q[1] * y;
  out[k + 2] = P[2] * x + Q[2] * y;
  return out;
}

// Where it is at this point in its orbit, in AU from the Sun (J2000), written into out at index k.
// E is the eccentric anomaly, the angle you get from solving Kepler's equation.
export function pointAt(orbit, E, out = [0, 0, 0], k = 0) {
  const x = orbit.a * (Math.cos(E) - orbit.e);
  const y = orbit.b * Math.sin(E);
  const { P, Q } = orbit;
  out[k] = P[0] * x + Q[0] * y;
  out[k + 1] = P[1] * x + Q[1] * y;
  out[k + 2] = P[2] * x + Q[2] * y;
  return out;
}

// Solves Kepler's equation for E, given the mean anomaly M (how far around it would be at an even speed)
export function solveKepler(M, e) {
  // starting at E = π only works for M between 0 and 2π, and dates before the epoch give negative M
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let step = 0; step < 50; step++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// how far around the ellipse it is on this Julian day
export function eccentricAnomaly(orbit, jd) {
  return solveKepler(orbit.M0 + orbit.n * (jd - orbit.epoch), orbit.e);
}

export function positionAt(orbit, jd, out = [0, 0, 0], k = 0) {
  if (orbit.open) return openPoint(orbit, openAnomaly(orbit, jd), out, k);
  return pointAt(orbit, eccentricAnomaly(orbit, jd), out, k);
}

// how far out an open orbit's line goes, in AU, unless the body is farther
const OPEN_PATH_AU = 60;

// The orbit's line as [x, y, z, ...] with points + 1 positions, and the body right on one of them.
// An ellipse goes once around from the body. An open orbit runs from far away on the way in to far away
// on the way out, with half the points on each side of the body.
export function orbitPath(orbit, jd, out, points) {
  if (!orbit.open) return ellipsePath(orbit, eccentricAnomaly(orbit, jd), out, points);
  const { e, q } = orbit;
  const now = openAnomaly(orbit, jd);
  // the anomaly where it's OPEN_PATH_AU from the Sun
  const reach = e > 1 ? Math.acosh(((OPEN_PATH_AU * (e - 1)) / q + 1) / e) : Math.sqrt(OPEN_PATH_AU / q - 1);
  const from = Math.min(-reach, now);
  const to = Math.max(reach, now);
  const half = points >> 1;
  for (let j = 0; j <= points; j++) {
    const H = j <= half ? from + ((now - from) * j) / half : now + ((to - now) * (j - half)) / (points - half);
    openPoint(orbit, H, out, j * 3);
  }
  return out;
}

// One trip around the ellipse as [x, y, z, x, y, z, ...], starting and ending exactly at E.
// Starting where the body is means it always sits right on the line.
export function ellipsePath(orbit, E, out, points) {
  for (let j = 0; j <= points; j++) pointAt(orbit, E + (j / points) * 2 * Math.PI, out, j * 3);
  return out;
}

// The ellipse a body is on right now, from where it is and how fast it's going
// (AU and AU per day from the Sun). E is where it is on that ellipse.
// massRatio is for orbits around something else, like a planet, as its mass over the Sun's.
export function orbitFromState({ x, y, z, vx, vy, vz }, massRatio = 1) {
  const mu = GAUSS_K * GAUSS_K * massRatio;
  const r = Math.hypot(x, y, z);
  const a = 1 / (2 / r - (vx * vx + vy * vy + vz * vz) / mu);
  const h = [y * vz - z * vy, z * vx - x * vz, x * vy - y * vx];
  const hLength = Math.hypot(...h);
  // points from the Sun toward the closest point of the orbit, as long as the eccentricity
  const ev = [
    (vy * h[2] - vz * h[1]) / mu - x / r,
    (vz * h[0] - vx * h[2]) / mu - y / r,
    (vx * h[1] - vy * h[0]) / mu - z / r
  ];
  const e = Math.hypot(...ev);
  const P = ev.map(c => c / e);
  const Q = [h[1] * P[2] - h[2] * P[1], h[2] * P[0] - h[0] * P[2], h[0] * P[1] - h[1] * P[0]].map(c => c / hLength);
  const E = Math.atan2((x * vx + y * vy + z * vz) / (e * Math.sqrt(mu * a)), (1 - r / a) / e);
  return { e, a, b: a * Math.sqrt(1 - e * e), n: meanMotion(a) * Math.sqrt(massRatio), P, Q, E };
}

// Rough width in km from how bright it is, assuming it reflects 14% of sunlight like a typical asteroid
export function sizeFromH(H) {
  return (1329 / Math.sqrt(0.14)) * 10 ** (-H / 5);
}

export function jplLink(pdes) {
  return `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(pdes)}`;
}
