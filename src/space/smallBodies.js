// Asteroids, dwarf planets and comets from NASA JPL's Small-Body Database (SBDB).
// JPL's API doesn't let web pages call it directly, so Lambda LiveEarth downloads them once a day.
// This file has no imports because the Lambda uses it too.

export const SBDB_QUERY_URL = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
export const SBDB_LOOKUP_URL = 'https://ssd-api.jpl.nasa.gov/sbdb.api';

const FIELDS = ['full_name', 'pdes', 'name', 'prefix', 'kind', 'class', 'neo', 'pha', 'e', 'a', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'diameter'];

// The brighter asteroids (smaller H is brighter, and roughly bigger), every potentially hazardous one,
// and every numbered comet. That's about 19,000 rocks.
const QUERIES = [
  { 'sb-kind': 'a', 'sb-cdata': JSON.stringify({ AND: ['H|LT|13'] }) },
  { 'sb-group': 'pha' },
  { 'sb-kind': 'c', 'sb-ns': 'n' }
];

// famous comets without a number, looked up one at a time
const EXTRA = ['C/1995 O1', 'C/2020 F3'];

// Pluto is already a planet in bodies.js
const SKIP = new Set(['134340']);

// short is for tight spots like the search list
export const KINDS = [
  { id: 'dwarf', label: 'Dwarf planet', short: 'Dwarf planet', color: '#efe2c8' },
  { id: 'hazardous', label: 'Potentially hazardous asteroid', short: 'Hazardous asteroid', color: '#ff6b6b' },
  { id: 'neo', label: 'Near-Earth asteroid', short: 'Near-Earth asteroid', color: '#ffa94d' },
  { id: 'main', label: 'Main-belt asteroid', short: 'Asteroid', color: '#b3a28c' },
  { id: 'trojan', label: 'Jupiter trojan asteroid', short: 'Jupiter trojan', color: '#8fd16a' },
  { id: 'centaur', label: 'Centaur (between Jupiter and Neptune)', short: 'Centaur', color: '#c792ff' },
  { id: 'tno', label: 'Trans-Neptunian object', short: 'Beyond Neptune', color: '#6fa8ff' },
  { id: 'comet', label: 'Comet', short: 'Comet', color: '#7ff0ff' }
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
  'C/2020 F3': 'Comet NEOWISE'
};

export function kindOf(row) {
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
  if (row.kind?.startsWith('c') && row.name && /^\d+[PD]$/.test(row.pdes)) return `${row.pdes}/${row.name}`;
  if (row.name && /^\d+$/.test(row.pdes)) return `${row.pdes} ${row.name}`;
  return row.full_name.trim();
}

function toRows({ fields, data }) {
  return (data ?? []).map(values => Object.fromEntries(fields.map((field, i) => [field, values[i]])));
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`SBDB answered ${response.status}`);
  return response.json();
}

// a lookup answer looks different from a query answer, so turn it into the same kind of row
function lookupRow({ object, orbit }) {
  const element = name => orbit.elements.find(el => el.name === name)?.value ?? null;
  return {
    full_name: object.fullname,
    // JPL says "1995 O1" here but "C/1995 O1" everywhere else
    pdes: object.prefix && !object.des.includes('/') ? `${object.prefix}/${object.des}` : object.des,
    name: null,
    prefix: object.prefix,
    kind: object.kind,
    class: object.orbit_class?.code,
    neo: object.neo ? 'Y' : 'N',
    pha: object.pha ? 'Y' : 'N',
    e: element('e'),
    a: element('a'),
    i: element('i'),
    om: element('om'),
    w: element('w'),
    ma: element('ma'),
    epoch: orbit.epoch,
    H: null,
    diameter: null
  };
}

export async function downloadSmallBodies(fetchImpl = fetch) {
  const rows = [];
  for (const query of QUERIES) {
    const params = new URLSearchParams({ fields: FIELDS.join(','), ...query });
    rows.push(...toRows(await getJson(`${SBDB_QUERY_URL}?${params}`, fetchImpl)));
  }
  for (const sstr of EXTRA) {
    // a missing extra comet isn't worth failing over
    try {
      rows.push(lookupRow(await getJson(`${SBDB_LOOKUP_URL}?${new URLSearchParams({ sstr })}`, fetchImpl)));
    } catch {}
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
export function toCompactBodies(rows, { generated = new Date().toISOString() } = {}) {
  const epoch = Math.floor(julianDay(generated) - 0.5) + 0.5;
  const columns = { name: [], pdes: [], kind: [], e: [], a: [], i: [], node: [], peri: [], M: [], H: [], size: [] };
  const kinds = KINDS.map(kind => kind.id);
  const seen = new Set();
  for (const row of rows) {
    const e = num(row.e);
    const a = num(row.a);
    // e of 1 or more means it's passing through and never comes back
    if (seen.has(row.pdes) || SKIP.has(row.pdes) || !(a > 0) || !(e >= 0 && e < 1)) continue;
    seen.add(row.pdes);
    const M = (num(row.ma) + (meanMotion(a) / DEG) * (epoch - num(row.epoch))) % 360;
    columns.name.push(displayName(row));
    columns.pdes.push(row.pdes);
    columns.kind.push(kinds.indexOf(kindOf(row)));
    columns.e.push(e);
    columns.a.push(a);
    columns.i.push(num(row.i));
    columns.node.push(num(row.om));
    columns.peri.push(num(row.w));
    columns.M.push(round(M < 0 ? M + 360 : M, 3));
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
export function orbitOf({ e, a, i, node, peri, M, epoch }) {
  const [ci, si] = [Math.cos(i * DEG), Math.sin(i * DEG)];
  const [cn, sn] = [Math.cos(node * DEG), Math.sin(node * DEG)];
  const [cw, sw] = [Math.cos(peri * DEG), Math.sin(peri * DEG)];
  const toEquator = (x, y, z) => [x, y * COS_TILT - z * SIN_TILT, y * SIN_TILT + z * COS_TILT];
  return {
    e,
    a,
    b: a * Math.sqrt(1 - e * e),
    n: meanMotion(a),
    M0: M * DEG,
    epoch,
    P: toEquator(cn * cw - sn * sw * ci, sn * cw + cn * sw * ci, sw * si),
    Q: toEquator(-cn * sw - sn * cw * ci, -sn * sw + cn * cw * ci, cw * si)
  };
}

export function periodDays(orbit) {
  return (2 * Math.PI) / orbit.n;
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

export function positionAt(orbit, jd, out = [0, 0, 0], k = 0) {
  const { e } = orbit;
  const M = (orbit.M0 + orbit.n * (jd - orbit.epoch)) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let step = 0; step < 30; step++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-9) break;
  }
  return pointAt(orbit, E, out, k);
}

// Rough width in km from how bright it is, assuming it reflects 14% of sunlight like a typical asteroid
export function sizeFromH(H) {
  return (1329 / Math.sqrt(0.14)) * 10 ** (-H / 5);
}

export function jplLink(pdes) {
  return `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(pdes)}`;
}
