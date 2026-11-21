// Planes are stored as one array per field, like the satellites.
// AGE is how many seconds before `time` the position was heard. COUNTRY is an index into `countries`.
// LAGGING is 1 for planes that moved impossibly far since the last file (see below). The page skips them.
export const PLANE_FIELDS = [
  'ICAO',
  'CALLSIGN',
  'COUNTRY',
  'LAT',
  'LON',
  'ALT',
  'SPEED',
  'TRACK',
  'CLIMB',
  'AGE',
  'KIND',
  'LAGGING'
];

// A position heard longer ago than this is too old to guess from.
export const MAX_AGE_S = 300;

// OpenSky's aircraft categories, only the ones worth naming
export const KINDS = {
  2: 'Light aircraft',
  3: 'Small aircraft',
  4: 'Large aircraft',
  5: 'Large aircraft',
  6: 'Heavy aircraft',
  7: 'High performance aircraft',
  8: 'Helicopter',
  9: 'Glider',
  10: 'Balloon',
  12: 'Ultralight',
  14: 'Drone'
};

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

function distanceM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

// Some of OpenSky's positions arrive minutes or hours late but are labeled as new. Those planes
// show up far down their route on the next file, so they look like they flew much faster than
// their speed. A turning plane covers less ground than its speed, never more.
function isLagging(previous, { lat, lon, speed, at }) {
  if (!previous || at - previous.at < 30) return false;
  const impliedSpeed = distanceM(previous.lat, previous.lon, lat, lon) / (at - previous.at);
  return impliedSpeed > speed * 1.3 + 30;
}

// Where each plane was in an earlier file, by ICAO address.
function positionsIn(data) {
  const out = new Map();
  if (!data?.columns?.ICAO) return out;
  const { ICAO, LAT, LON, AGE } = data.columns;
  ICAO.forEach((icao, i) => out.set(icao, { lat: LAT[i], lon: LON[i], at: data.time - AGE[i] }));
  return out;
}

// Keeps planes in the air that have a recent position, a speed and a direction.
// Pass the previous file to flag planes whose positions are running late.
export function toCompactPlanes({ time, states }, { generated = new Date().toISOString(), previous = null } = {}) {
  const columns = Object.fromEntries(PLANE_FIELDS.map(key => [key, []]));
  const countries = [];
  const countryIndex = new Map();
  const before = positionsIn(previous);
  let lagging = 0;
  for (const s of states) {
    const [icao, callsign, country, timePosition, , lon, lat, baroAltitude, onGround, speed, track, climb] = s;
    const geoAltitude = s[13];
    if (onGround || lat == null || lon == null || speed == null || track == null || timePosition == null) continue;
    const age = time - timePosition;
    if (age > MAX_AGE_S) continue;
    if (!countryIndex.has(country)) {
      countryIndex.set(country, countries.length);
      countries.push(country);
    }
    columns.ICAO.push(icao);
    columns.CALLSIGN.push((callsign ?? '').trim());
    columns.COUNTRY.push(countryIndex.get(country));
    columns.LAT.push(round(lat, 4));
    columns.LON.push(round(lon, 4));
    columns.ALT.push(Math.round(baroAltitude ?? geoAltitude ?? 0));
    columns.SPEED.push(round(speed, 1));
    columns.TRACK.push(round(track, 1));
    columns.CLIMB.push(round(climb ?? 0, 1));
    columns.AGE.push(Math.max(0, age));
    columns.KIND.push(s[17] ?? 0);
    const late = isLagging(before.get(icao), { lat, lon, speed, at: timePosition }) ? 1 : 0;
    columns.LAGGING.push(late);
    lagging += late;
  }
  return { generated, time, source: 'OpenSky Network', count: columns.ICAO.length, lagging, countries, columns };
}

// Turns the file back into one object per plane, leaving out the ones running late.
export function fromCompactPlanes(data) {
  const { columns, countries } = data;
  const all = Array.from({ length: data.count }, (_, i) => i);
  return all.filter(i => !columns.LAGGING?.[i]).map(i => ({
    icao: columns.ICAO[i],
    callsign: columns.CALLSIGN[i],
    country: countries[columns.COUNTRY[i]],
    lat: columns.LAT[i],
    lon: columns.LON[i],
    altitude: columns.ALT[i],
    speed: columns.SPEED[i],
    track: columns.TRACK[i],
    climb: columns.CLIMB[i],
    // when the position was heard, in ms
    at: (data.time - columns.AGE[i]) * 1000,
    kind: KINDS[columns.KIND[i]] ?? null
  }));
}
