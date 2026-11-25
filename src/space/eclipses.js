import { NextLunarEclipse, SearchGlobalSolarEclipse, SearchLunarEclipse } from 'astronomy-engine';

// Astronomy Engine's names for each kind, in plain words
const KIND = { penumbral: 'penumbral', partial: 'partial', annular: 'annular', total: 'total' };

// The next solar eclipse after this date, when the Moon's shadow falls on the Earth. latitude and
// longitude are where the middle of the shadow is at the peak (missing for partial ones).
export function nextSolarEclipse(date) {
  const found = SearchGlobalSolarEclipse(date);
  return {
    type: 'solar',
    kind: KIND[found.kind],
    peak: found.peak.date,
    latitude: found.latitude,
    longitude: found.longitude
  };
}

// The next lunar eclipse after this date, when the Earth's shadow falls on the Moon.
// totalMinutes is how long the Moon is all the way in the dark middle of the shadow.
// Penumbral ones only dim the Moon a little, so skipFaint skips them.
export function nextLunarEclipse(date, { skipFaint = false } = {}) {
  let found = SearchLunarEclipse(date);
  while (skipFaint && found.kind === 'penumbral') found = NextLunarEclipse(found.peak);
  return {
    type: 'lunar',
    kind: KIND[found.kind],
    peak: found.peak.date,
    totalMinutes: Math.round(found.sd_total * 2),
    partialMinutes: Math.round(found.sd_partial * 2)
  };
}

// Where to look from for a good view: a place on the Earth like "the South Pacific" is hard, so this
// just names the hemisphere and rough longitude, like "45°S 120°W"
export function placeLabel(latitude, longitude) {
  if (latitude === undefined) return null;
  const lat = `${Math.abs(Math.round(latitude))}°${latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(Math.round(longitude))}°${longitude >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}
