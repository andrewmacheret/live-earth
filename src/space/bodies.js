// The Sun, the Moon and the planets. Astronomy Engine works out where they are, right in the browser.
import {
  Body,
  GeoMoon,
  HelioVector,
  Illumination,
  KM_PER_AU,
  MakeTime,
  MoonPhase,
  RotationAxis,
  Rotation_EQJ_EQD
} from 'astronomy-engine';
import { EARTH_RADIUS_KM, toScene } from '../sats/frames.js';

// scene units (Earth radii) in one AU, the Earth's distance from the Sun
export const AU = KM_PER_AU / EARTH_RADIUS_KM;
export { KM_PER_AU };

// Search lists them in this order. `name` is also Astronomy Engine's name for the body.
// `dot` is how many pixels wide a body's dot is when it's too far away to see.
export const BODIES = [
  { id: 'sun', name: 'Sun', the: true, kind: 'Star', radiusKm: 695700, color: '#ffc861', texture: 'sun.jpg', article: 'Sun', nasa: 'sun' },
  {
    id: 'moon',
    name: 'Moon',
    the: true,
    kind: "Earth's moon",
    radiusKm: 1737.4,
    color: '#d9d4c7',
    texture: 'moon.jpg',
    article: 'Moon',
    nasa: 'moon',
    periodDays: 27.32,
    dot: 4
  },
  { id: 'earth', name: 'Earth', kind: 'Planet', radiusKm: 6371, color: '#7cb4ff', article: 'Earth', nasa: 'earth', periodDays: 365.26, dot: 5 }
];

export const BODY_BY_ID = Object.fromEntries(BODIES.map(body => [body.id, body]));

export function nasaLink(body) {
  return `https://science.nasa.gov/${body.nasa}/`;
}

// Returns a function that turns J2000 coordinates (what Astronomy Engine gives) into scene coordinates.
// The Earth turns under the stars using the equator of today's date, which slowly drifts from J2000's.
export function sceneFrame(date) {
  const { rot } = Rotation_EQJ_EQD(MakeTime(date));
  return (x, y, z, out = [0, 0, 0], i = 0, scale = AU) =>
    toScene(
      (rot[0][0] * x + rot[1][0] * y + rot[2][0] * z) * scale,
      (rot[0][1] * x + rot[1][1] * y + rot[2][1] * z) * scale,
      (rot[0][2] * x + rot[1][2] * y + rot[2][2] * z) * scale,
      out,
      i
    );
}

// Where every body is from the Earth's center, in AU (J2000), like { moon: { x, y, z }, ... }.
export function geocentric(date) {
  const time = MakeTime(date);
  const earth = HelioVector(Body.Earth, time);
  const out = {};
  for (const body of BODIES) {
    if (body.id === 'earth') out.earth = { x: 0, y: 0, z: 0 };
    else if (body.id === 'moon') out.moon = GeoMoon(time);
    else if (body.id === 'sun') out.sun = { x: -earth.x, y: -earth.y, z: -earth.z };
    else {
      const v = HelioVector(body.name, time);
      out[body.id] = { x: v.x - earth.x, y: v.y - earth.y, z: v.z - earth.z };
    }
  }
  return out;
}

// The body's north pole (J2000) and how far it has turned, in degrees, for spinning its map.
export function spinAxis(id, date) {
  const { north, spin } = RotationAxis(BODY_BY_ID[id].name, date);
  return { north, spin };
}

const PHASES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent'
];

// angle is how far the Moon is around from the Sun, as seen from Earth: 0 is new, 180 is full
export function phaseName(angle) {
  return PHASES[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
}

const LIGHT_KM_PER_S = 299792.458;

// Distances and such for the info panel.
export function bodyFacts(id, date, positions = geocentric(date)) {
  const p = positions[id];
  const sun = positions.sun;
  const fromEarthKm = Math.hypot(p.x, p.y, p.z) * KM_PER_AU;
  const facts = {
    fromEarthKm,
    fromSunKm: Math.hypot(p.x - sun.x, p.y - sun.y, p.z - sun.z) * KM_PER_AU,
    lightSeconds: fromEarthKm / LIGHT_KM_PER_S
  };
  if (id === 'moon') {
    facts.phase = phaseName(MoonPhase(date));
    facts.lit = Illumination(Body.Moon, date).phase_fraction;
  }
  return facts;
}
