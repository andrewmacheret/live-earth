// Spacecraft out among the planets, like Voyager 1, from NASA JPL's Horizons system.
// Horizons doesn't let web pages call it directly, so Lambda LiveEarth downloads where each one
// is for a year either side of today, once a day. The Lambda uses this file too.
import { eccentricAnomaly, ellipsePath, orbitFromState, pointAt } from './smallBodies.js';

export const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const DAY_MS = 86400000;
const SPAN_DAYS = 365;
// Horizons counts time in TDB, which runs about 69 seconds ahead of UTC
const TDB_AHEAD_DAYS = 69.184 / 86400;

// step is how many days apart to ask Horizons for positions (a quarter day if missing).
// coast: leaving the solar system in a nearly straight line, so it keeps going past the saved year.
// orbit: swings past the Sun too fast for daily positions, so it's saved as one ellipse instead.
// center 'earth': stays near the Earth, so it's saved from the Earth instead of the Sun.
// toleranceKm: how far off a skipped position may be, when it loops around a planet too fast to keep every loop.
export const SPACECRAFT = [
  {
    id: 'voyager-1',
    horizons: -31,
    name: 'Voyager 1',
    article: 'Voyager 1',
    agency: 'NASA',
    launched: 1977,
    step: 10,
    coast: true,
    link: 'https://science.nasa.gov/mission/voyager/',
    note: 'The farthest thing people have ever made. In interstellar space since 2012.'
  },
  {
    id: 'voyager-2',
    horizons: -32,
    name: 'Voyager 2',
    article: 'Voyager 2',
    agency: 'NASA',
    launched: 1977,
    step: 10,
    coast: true,
    link: 'https://science.nasa.gov/mission/voyager/',
    note: 'The only spacecraft to visit Uranus and Neptune. In interstellar space since 2018.'
  },
  {
    id: 'pioneer-10',
    horizons: -23,
    name: 'Pioneer 10',
    article: 'Pioneer 10',
    agency: 'NASA',
    launched: 1972,
    step: 10,
    coast: true,
    link: 'https://science.nasa.gov/mission/pioneer-10/',
    note: 'The first to cross the asteroid belt and visit Jupiter. Silent since 2003.'
  },
  {
    id: 'pioneer-11',
    horizons: -24,
    name: 'Pioneer 11',
    article: 'Pioneer 11',
    agency: 'NASA',
    launched: 1973,
    step: 10,
    coast: true,
    link: 'https://science.nasa.gov/mission/pioneer-11/',
    note: 'The first to visit Saturn. Silent since 1995.'
  },
  {
    id: 'new-horizons',
    horizons: -98,
    name: 'New Horizons',
    article: 'New Horizons',
    agency: 'NASA',
    launched: 2006,
    step: 10,
    coast: true,
    link: 'https://science.nasa.gov/mission/new-horizons/',
    note: 'Flew past Pluto in 2015 and Arrokoth in 2019.'
  },
  {
    id: 'parker',
    horizons: -96,
    name: 'Parker Solar Probe',
    article: 'Parker Solar Probe',
    agency: 'NASA',
    launched: 2018,
    orbit: true,
    link: 'https://science.nasa.gov/mission/parker-solar-probe/',
    note: "Dives through the Sun's outer atmosphere, closer than anything else has gone."
  },
  {
    id: 'webb',
    horizons: -170,
    name: 'James Webb Space Telescope',
    short: 'Webb',
    article: 'James Webb Space Telescope',
    agency: 'NASA, ESA and CSA',
    launched: 2021,
    step: 1,
    center: 'earth',
    link: 'https://science.nasa.gov/mission/webb/',
    note: 'A space telescope that circles a spot 1.5 million km past the Earth, away from the Sun.'
  },
  {
    id: 'psyche',
    horizons: -255,
    name: 'Psyche',
    article: 'Psyche (spacecraft)',
    agency: 'NASA',
    launched: 2023,
    link: 'https://science.nasa.gov/mission/psyche/',
    note: 'On its way to the metal-rich asteroid 16 Psyche, arriving in 2029.'
  },
  {
    id: 'lucy',
    horizons: -49,
    name: 'Lucy',
    article: 'Lucy (spacecraft)',
    agency: 'NASA',
    launched: 2021,
    link: 'https://science.nasa.gov/mission/lucy/',
    note: "On its way to the Jupiter trojans, the asteroids that share Jupiter's orbit, from 2027."
  },
  {
    id: 'europa-clipper',
    horizons: -159,
    name: 'Europa Clipper',
    article: 'Europa Clipper',
    agency: 'NASA',
    launched: 2024,
    link: 'https://science.nasa.gov/mission/europa-clipper/',
    note: "On its way to Jupiter's moon Europa, arriving in 2030."
  },
  {
    id: 'juice',
    horizons: -28,
    name: 'JUICE',
    article: 'Jupiter Icy Moons Explorer',
    agency: 'ESA',
    launched: 2023,
    note: "On its way to Jupiter's icy moons, arriving in 2031."
  },
  {
    id: 'solar-orbiter',
    horizons: -144,
    name: 'Solar Orbiter',
    article: 'Solar Orbiter',
    agency: 'ESA and NASA',
    launched: 2020,
    note: "Taking the first pictures of the Sun's poles."
  },
  {
    id: 'osiris-apex',
    horizons: -64,
    name: 'OSIRIS-APEX',
    article: 'OSIRIS-REx',
    agency: 'NASA',
    launched: 2016,
    link: 'https://science.nasa.gov/mission/osiris-apex/',
    note: 'Brought back a piece of the asteroid Bennu in 2023. Now headed to Apophis, arriving in 2029.'
  },
  {
    id: 'bepicolombo',
    horizons: -121,
    name: 'BepiColombo',
    article: 'BepiColombo',
    agency: 'ESA and JAXA',
    launched: 2018,
    toleranceKm: 25000,
    note: 'Two orbiters for Mercury, traveling together.'
  },
  {
    id: 'hera',
    horizons: -91,
    name: 'Hera',
    article: 'Hera (space mission)',
    agency: 'ESA',
    launched: 2024,
    note: "Checking on the asteroid Dimorphos, which NASA's DART spacecraft crashed into in 2022."
  }
];
export const CRAFT_BY_ID = Object.fromEntries(SPACECRAFT.map(craft => [craft.id, craft]));
export const CRAFT_COLOR = '#7dffb2';

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const time = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function horizonsUrl(craft, start, stop, step) {
  const params = {
    format: 'json',
    COMMAND: `'${craft.horizons}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: craft.center === 'earth' ? "'500@399'" : "'500@10'",
    START_TIME: `'${time(start)}'`,
    STOP_TIME: `'${time(stop)}'`,
    STEP_SIZE: `'${Math.round(step * 1440)} m'`,
    VEC_TABLE: '2',
    // the same J2000 equator coordinates as everything else here, in AU and AU per day
    REF_PLANE: 'FRAME',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES',
    OBJ_DATA: 'NO'
  };
  return `${HORIZONS_URL}?${new URLSearchParams(params)}`;
}

// Rows of [jd, x, y, z, vx, vy, vz] from a Horizons answer. jd is UTC.
export function parseVectors(text) {
  const table = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text)?.[1] ?? '';
  return table
    .split('\n')
    .map(line => line.split(',').map(cell => cell.trim()))
    .filter(cells => cells.length >= 8)
    .map(([jd, , ...rest]) => [Number(jd) - TDB_AHEAD_DAYS, ...rest.slice(0, 6).map(Number)]);
}

// "No ephemeris for target ... after A.D. 2027-APR-11 00:01:09.1855 TDB" means the data stops then
function dataLimit(text) {
  const match = /(after|prior to) A\.D\. (\d{4})-([A-Z]{3})-(\d{2})/.exec(text);
  if (!match) return null;
  const [, side, year, month, date] = match;
  return { side, ms: Date.UTC(Number(year), MONTHS[month], Number(date)) };
}

async function getText(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Horizons answered ${response.status}`);
  // "the data stops on this day" comes back as an error
  const { result, error } = await response.json();
  return result ?? error ?? '';
}

// Asks for a year either side of now, and if Horizons says the data stops sooner, asks again for less
async function downloadOne(craft, now, fetchImpl) {
  const step = craft.step ?? 0.25;
  let start = now - SPAN_DAYS * DAY_MS;
  let stop = craft.orbit ? now + DAY_MS : now + SPAN_DAYS * DAY_MS;
  if (craft.orbit) start = now;
  for (let tries = 0; tries < 3; tries++) {
    const text = await getText(horizonsUrl(craft, start, stop, step), fetchImpl);
    const rows = parseVectors(text);
    if (rows.length) return rows;
    const limit = dataLimit(text);
    if (!limit) throw new Error(text.trim().split('\n').at(-1) || 'no positions');
    if (limit.side === 'after') stop = Math.min(stop, limit.ms - DAY_MS);
    else start = Math.max(start, limit.ms + DAY_MS);
    if (stop - start < step * 2 * DAY_MS) throw new Error(`No positions near now for ${craft.name}`);
  }
  throw new Error(`No positions for ${craft.name}`);
}

// 8 places of an AU is 1.5 km, and 9 places of an AU per day is under a meter a second
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const compact = row => row.slice(1).map((value, c) => round(value, c < 3 ? 8 : 9));
// how far off a dropped position may be
const TOLERANCE_KM = 500;

// A cubic between two spots that also matches how fast it was going at each (Hermite).
// a and b are where [x, y, z, vx, vy, vz] start in list, and h is the days between them.
function hermite(list, a, b, h, s, out) {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = 3 * s2 - 2 * s3;
  const h11 = s3 - s2;
  for (let c = 0; c < 3; c++) {
    out[c] = h00 * list[a + c] + h10 * h * list[a + 3 + c] + h01 * list[b + c] + h11 * h * list[b + 3 + c];
  }
  return out;
}

// Keeps only the rows needed to rebuild the rest within the tolerance. Quiet stretches between
// planets need a few rows a month, and a fast swing past a planet keeps lots.
export function thinRows(rows, toleranceKm = TOLERANCE_KM) {
  const toleranceAu = toleranceKm / 149597870.7;
  const flat = rows.flatMap(row => row.slice(1));
  const p = [0, 0, 0];
  const fits = (i, j) => {
    const h = rows[j][0] - rows[i][0];
    for (let k = i + 1; k < j; k++) {
      hermite(flat, i * 6, j * 6, h, (rows[k][0] - rows[i][0]) / h, p);
      const off = Math.hypot(p[0] - flat[k * 6], p[1] - flat[k * 6 + 1], p[2] - flat[k * 6 + 2]);
      if (off > toleranceAu) return false;
    }
    return true;
  };
  const keep = [0];
  for (let i = 0; i < rows.length - 1; ) {
    let j = i + 1;
    while (j + 1 < rows.length && fits(i, j + 1)) j++;
    keep.push(j);
    i = j;
  }
  return keep.map(k => rows[k]);
}

// Swings past planets bend the path too sharply for a quarter day, so ask again every half hour there.
// A long stretch means it's circling a planet, which would take too many positions, so skip those.
const FINE_STEP = 1 / 48;
const MAX_FINE_DAYS = 10;
async function refine(craft, rows, fetchImpl) {
  const step = craft.step ?? 0.25;
  const kept = thinRows(rows, craft.toleranceKm);
  const windows = [];
  for (let k = 1; k < kept.length; k++) {
    if (kept[k][0] - kept[k - 1][0] > step * 1.01) continue;
    const last = windows.at(-1);
    if (last && kept[k - 1][0] - last[1] < 1) last[1] = kept[k][0];
    else windows.push([kept[k - 1][0], kept[k][0]]);
  }
  let out = rows;
  for (const [from, to] of windows) {
    if (to - from > MAX_FINE_DAYS) continue;
    const start = (from - step - 2440587.5) * DAY_MS;
    const stop = (to + step - 2440587.5) * DAY_MS;
    const fine = parseVectors(await getText(horizonsUrl(craft, start, stop, FINE_STEP), fetchImpl));
    if (!fine.length) continue;
    const [a, b] = [fine[0][0], fine.at(-1)[0]];
    out = [...out.filter(row => row[0] < a || row[0] > b), ...fine].sort((x, y) => x[0] - y[0]);
  }
  return out;
}

// Every spacecraft as small as it can be: the days of its kept positions, and a flat list of positions and speeds.
// One that fails is left out, so a single missing spacecraft doesn't cost the rest.
export async function downloadSpacecraft({ fetchImpl = fetch, now = Date.now(), log = () => {} } = {}) {
  const out = [];
  for (const craft of SPACECRAFT) {
    try {
      const rows = await downloadOne(craft, now, fetchImpl);
      const entry = { id: craft.id, center: craft.center ?? 'sun' };
      if (craft.orbit) {
        entry.epoch = rows[0][0];
        entry.state = compact(rows[0]);
      } else {
        const kept = thinRows(craft.coast ? rows : await refine(craft, rows, fetchImpl), craft.toleranceKm);
        entry.start = kept[0][0];
        entry.days = kept.map(row => round(row[0] - kept[0][0], 5));
        entry.samples = kept.flatMap(compact);
      }
      out.push(entry);
    } catch (err) {
      log(`Skipped ${craft.name}: ${err.message}`);
    }
  }
  return { generated: new Date(now).toISOString(), source: 'NASA JPL Horizons', count: out.length, spacecraft: out };
}

// Ready-to-use spacecraft from the downloaded file, each with its details from SPACECRAFT
export function fromCompactSpacecraft(data) {
  return data.spacecraft
    .filter(entry => CRAFT_BY_ID[entry.id])
    .map(entry => {
      const craft = { ...CRAFT_BY_ID[entry.id], ...entry };
      if (entry.state) {
        const [x, y, z, vx, vy, vz] = entry.state;
        const orbit = orbitFromState({ x, y, z, vx, vy, vz });
        craft.ellipse = { ...orbit, M0: orbit.E - orbit.e * Math.sin(orbit.E), epoch: entry.epoch };
      } else {
        craft.times = entry.days.map(d => entry.start + d);
        craft.end = craft.times.at(-1);
      }
      return craft;
    });
}

// Where it is on this Julian day, in AU from the Sun (or the Earth, for center 'earth'), written into out.
// Returns null when there's no data for that day.
export function craftPosition(craft, jd, out = [0, 0, 0]) {
  if (craft.ellipse) return pointAt(craft.ellipse, eccentricAnomaly(craft.ellipse, jd), out);
  const { samples, times, start, end } = craft;
  if (jd < start || jd > end) {
    if (!craft.coast) return null;
    // past the data it just keeps going the same way
    const k = jd < start ? 0 : (times.length - 1) * 6;
    const dt = jd - (jd < start ? start : end);
    for (let c = 0; c < 3; c++) out[c] = samples[k + c] + samples[k + 3 + c] * dt;
    return out;
  }
  // the last saved time at or before jd
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= jd) lo = mid;
    else hi = mid;
  }
  const h = times[hi] - times[lo];
  return hermite(samples, lo * 6, hi * 6, h, (jd - times[lo]) / h, out);
}

// how fast it's going on this day, in AU per day, from where it is a minute either side
export function craftSpeed(craft, jd) {
  const dt = 1 / 1440;
  const a = craftPosition(craft, jd - dt);
  const b = craftPosition(craft, jd + dt);
  if (!a || !b) return null;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * dt);
}

// Its path as [x, y, z, ...]: one trip around for an ellipse, or else every saved day with
// a few points between each pair
export function craftPath(craft, jd, between = 6) {
  if (craft.ellipse) {
    const { ellipse } = craft;
    return ellipsePath(ellipse, eccentricAnomaly(ellipse, jd), new Array(361 * 3), 360);
  }
  const out = [];
  const p = [0, 0, 0];
  const { times } = craft;
  for (let k = 0; k < times.length - 1; k++) {
    for (let j = 0; j < between; j++) out.push(...craftPosition(craft, times[k] + ((times[k + 1] - times[k]) * j) / between, p));
  }
  out.push(...craftPosition(craft, craft.end, p));
  return out;
}
