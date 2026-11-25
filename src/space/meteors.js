// Meteor showers happen when the Earth plows through dust that a comet (or an asteroid) left along its orbit.
// Each parent's orbit is from JPL's Small-Body Database (angles in degrees against the planets' plane, in AU).
// peak is the usual day of the shower's peak, as [month, day]. zhr is about how many meteors an hour you'd
// see at the peak under a perfectly dark sky, speedKmS is how fast they hit the air, and radiant is the
// constellation they seem to come from.
import { Body, HelioVector } from 'astronomy-engine';
import { orbitOf, pointAt } from './smallBodies.js';

export const PARENTS = [
  { id: 'swift-tuttle', name: '109P/Swift–Tuttle', e: 0.963226, a: 26.0921, i: 113.4538, node: 139.3812, peri: 152.9822, color: '#9fd8ff' },
  { id: 'tempel-tuttle', name: '55P/Tempel–Tuttle', e: 0.905553, a: 10.3383, i: 162.4866, node: 235.271, peri: 172.5003, color: '#c9b6ff' },
  { id: 'phaethon', name: '3200 Phaethon', e: 0.889672, a: 1.27146, i: 22.3105, node: 265.0988, peri: 322.3002, color: '#ffd59a' },
  { id: 'halley', name: '1P/Halley', e: 0.967936, a: 17.9286, i: 162.1905, node: 59.0989, peri: 112.2414, color: '#a8ffd8' },
  { id: 'encke', name: '2P/Encke', e: 0.847039, a: 2.21826, i: 11.3413, node: 334.0134, peri: 187.2815, color: '#ffb59a' },
  { id: 'giacobini-zinner', name: '21P/Giacobini–Zinner', e: 0.71047, a: 3.5003, i: 32.0026, node: 195.4045, peri: 172.8125, color: '#ffa8d8' },
  { id: 'thatcher', name: 'C/1861 G1 (Thatcher)', e: 0.983465, a: 55.6819, i: 79.7733, node: 31.8674, peri: 213.4496, color: '#d8ffa8' },
  { id: '2003-eh1', name: '2003 EH1', e: 0.618659, a: 3.12296, i: 70.8747, node: 283.0012, peri: 171.3389, color: '#a8c8ff' },
  { id: 'tuttle', name: '8P/Tuttle', e: 0.819788, a: 5.70029, i: 54.982, node: 270.3422, peri: 207.5115, color: '#fff0a8' }
];
export const PARENT_BY_ID = Object.fromEntries(PARENTS.map(parent => [parent.id, parent]));

export const SHOWERS = [
  {
    id: 'quadrantids',
    name: 'Quadrantids',
    parent: '2003-eh1',
    peak: [1, 3],
    zhr: 110,
    speedKmS: 41,
    radiant: 'Boötes',
    article: 'Quadrantids',
    note: 'Strong but short: the best hours last only about half a day.'
  },
  { id: 'lyrids', name: 'Lyrids', parent: 'thatcher', peak: [4, 22], zhr: 18, speedKmS: 49, radiant: 'Lyra', article: 'Lyrids', note: 'Seen for over 2,700 years, the oldest recorded shower.' },
  {
    id: 'eta-aquariids',
    name: 'Eta Aquariids',
    parent: 'halley',
    peak: [5, 6],
    zhr: 50,
    speedKmS: 66,
    radiant: 'Aquarius',
    article: 'Eta Aquariids',
    note: "Dust from Halley's Comet, best seen from the Southern Hemisphere."
  },
  { id: 'perseids', name: 'Perseids', parent: 'swift-tuttle', peak: [8, 12], zhr: 100, speedKmS: 59, radiant: 'Perseus', article: 'Perseids', note: 'The favorite summer shower in the north, with lots of bright meteors.' },
  {
    id: 'draconids',
    name: 'Draconids',
    parent: 'giacobini-zinner',
    peak: [10, 8],
    zhr: 10,
    speedKmS: 21,
    radiant: 'Draco',
    article: 'Draconids',
    note: 'Usually quiet, but some years it bursts into hundreds or thousands an hour.'
  },
  { id: 'orionids', name: 'Orionids', parent: 'halley', peak: [10, 21], zhr: 20, speedKmS: 66, radiant: 'Orion', article: 'Orionids', note: "Halley's Comet's other shower, from the other side of its orbit." },
  { id: 'taurids', name: 'Taurids', parent: 'encke', peak: [11, 5], zhr: 5, speedKmS: 27, radiant: 'Taurus', article: 'Taurids', note: 'Few and slow, but known for big, bright fireballs.' },
  {
    id: 'leonids',
    name: 'Leonids',
    parent: 'tempel-tuttle',
    peak: [11, 17],
    zhr: 15,
    speedKmS: 71,
    radiant: 'Leo',
    article: 'Leonids',
    note: 'The fastest meteors. About every 33 years it becomes a storm of thousands an hour.'
  },
  { id: 'geminids', name: 'Geminids', parent: 'phaethon', peak: [12, 14], zhr: 150, speedKmS: 35, radiant: 'Gemini', article: 'Geminids', note: 'The strongest shower of the year, from an asteroid instead of a comet.' },
  { id: 'ursids', name: 'Ursids', parent: 'tuttle', peak: [12, 22], zhr: 10, speedKmS: 33, radiant: 'Ursa Minor', article: 'Ursids', note: 'A small shower around the winter solstice.' }
];
export const SHOWER_BY_ID = Object.fromEntries(SHOWERS.map(shower => [shower.id, shower]));

// only the part of each stream inside this many AU from the Sun, where the Earth can meet it
const STREAM_AU = 3;
// how far the dust strays from the parent's orbit, in AU
const SPREAD_AU = 0.02;

// the same "random" numbers every time, so the streams don't change on each visit
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// The stream's dust as [x, y, z, ...] in AU from the Sun (J2000), spread a little around the parent's orbit
export function streamPoints(parent, count, seed = 1) {
  const random = seeded(seed);
  const orbit = orbitOf({ ...parent, M: 0, epoch: 0 });
  // the eccentric anomaly where it's STREAM_AU from the Sun, or all the way around if it never gets that far
  const reach = parent.a * (1 + parent.e) <= STREAM_AU ? Math.PI : Math.acos((1 - STREAM_AU / parent.a) / parent.e);
  const out = new Float32Array(count * 3);
  const p = [0, 0, 0];
  for (let k = 0; k < count; k++) {
    pointAt(orbit, (random() * 2 - 1) * reach, p);
    for (let c = 0; c < 3; c++) {
      // two uniform numbers make a bell curve (Box-Muller)
      const bell = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      out[k * 3 + c] = p[c] + bell * SPREAD_AU;
    }
  }
  return out;
}

// Where the Earth meets the stream at the peak: the spot on the parent's orbit closest to where the Earth is that day.
// Returns { x, y, z, missAu } in AU from the Sun (J2000), where missAu is how far the orbit passes from the Earth.
export function showerSpot(shower, year = new Date().getUTCFullYear()) {
  const [month, day] = shower.peak;
  const earth = HelioVector(Body.Earth, new Date(Date.UTC(year, month - 1, day)));
  const orbit = orbitOf({ ...PARENT_BY_ID[shower.parent], M: 0, epoch: 0 });
  const p = [0, 0, 0];
  let best = null;
  for (let j = 0; j < 20000; j++) {
    pointAt(orbit, (j / 20000) * 2 * Math.PI, p);
    const miss = Math.hypot(p[0] - earth.x, p[1] - earth.y, p[2] - earth.z);
    if (!best || miss < best.missAu) best = { x: p[0], y: p[1], z: p[2], missAu: miss };
  }
  return best;
}

// the next peak on or after this date
export function nextPeak(shower, date = new Date()) {
  const [month, day] = shower.peak;
  const year = date.getUTCFullYear();
  const peak = new Date(Date.UTC(year, month - 1, day));
  // still counts as "now" until the end of the peak day
  return peak.getTime() + 86400000 > date.getTime() ? peak : new Date(Date.UTC(year + 1, month - 1, day));
}

export function peakLabel(shower) {
  const [month, day] = shower.peak;
  return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
