// The Sun, the Moon and the planets. Astronomy Engine works out where they are, right in the browser.
import {
  Body,
  GeoMoon,
  GeoMoonState,
  HelioState,
  HelioVector,
  Illumination,
  KM_PER_AU,
  MakeTime,
  MoonPhase,
  RotationAxis,
  Rotation_EQJ_EQD
} from 'astronomy-engine';
import { EARTH_RADIUS_KM, toScene } from '../sats/frames.js';
import { orbitFromState } from './smallBodies.js';

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
  planet('mercury', 'Mercury', 2439.7, 87.97, '#b8aa9c', { article: 'Mercury (planet)' }),
  planet('venus', 'Venus', 6051.8, 224.7, '#e9d3a1', { texture: 'venus_atmosphere.jpg' }),
  planet('earth', 'Earth', 6371, 365.26, '#7cb4ff', { texture: null }),
  planet('mars', 'Mars', 3389.5, 686.98, '#e07a4f'),
  planet('jupiter', 'Jupiter', 69911, 4332.59, '#d9b38c', {
    // the halo, the main ring, then the two faint gossamer rings
    rings: {
      innerKm: 92000,
      outerKm: 226000,
      color: '#a08670',
      bands: [
        [92000, 122500, 0.08],
        [122500, 129000, 0.45],
        [129000, 182000, 0.07],
        [182000, 226000, 0.04]
      ]
    }
  }),
  planet('saturn', 'Saturn', 58232, 10759.22, '#e8d29b', { rings: { innerKm: 74500, outerKm: 140220 } }),
  planet('uranus', 'Uranus', 25362, 30688.5, '#a9e3ea', {
    // the 13 narrow rings, from ring 6 out to epsilon, the widest
    rings: {
      innerKm: 41000,
      outerKm: 52000,
      color: '#8f9aa0',
      bands: [
        [41837, 41839, 0.5],
        [42234, 42236, 0.5],
        [42571, 42573, 0.5],
        [44718, 44726, 0.6],
        [45661, 45672, 0.6],
        [47176, 47178, 0.5],
        [47627, 47630, 0.5],
        [48300, 48307, 0.6],
        [50024, 50026, 0.35],
        [51129, 51169, 0.9]
      ]
    }
  }),
  planet('neptune', 'Neptune', 24622, 60195, '#6b8cf0', {
    // Galle, Le Verrier, the wide faint Lassell, Arago, then Adams
    rings: {
      innerKm: 40000,
      outerKm: 63500,
      color: '#8c8f99',
      bands: [
        [40900, 42900, 0.12],
        [53150, 53260, 0.5],
        [53260, 57200, 0.08],
        [57150, 57250, 0.35],
        [62910, 62950, 0.6]
      ]
    }
  }),
  planet('pluto', 'Pluto', 1188.3, 90560, '#d8c2a6', {
    kind: 'Dwarf planet',
    texture: null,
    nasa: 'dwarf-planets/pluto',
    dot: 4
  })
];

function planet(id, name, radiusKm, periodDays, color, more = {}) {
  return { id, name, kind: 'Planet', radiusKm, periodDays, color, texture: `${id}.jpg`, article: name, nasa: id, dot: 5, ...more };
}

// the bodies that go around the Sun, which get orbit lines
export const PLANETS = BODIES.filter(body => body.periodDays && body.id !== 'moon');

export const BODY_BY_ID = Object.fromEntries(BODIES.map(body => [body.id, body]));

// straight up from the plane the planets orbit in, in J2000 coordinates
const TILT = (23.4392911 * Math.PI) / 180;
export const ECLIPTIC_NORTH = { x: 0, y: -Math.sin(TILT), z: Math.cos(TILT) };

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

// The ellipse a planet is on right now (see orbitFromState), in AU from the Sun (J2000)
export function planetOrbit(id, date) {
  return orbitFromState(HelioState(BODY_BY_ID[id].name, date));
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

// How much heavier the smaller body is than the bigger one, for the Lagrange points
const MASS_RATIO = { earth: 3.0404e-6, jupiter: 9.5479e-4, moon: 0.012150 };

// turn v by angle around the axis straight up from the plane that v and its speed w move in
function turn(v, w, angle) {
  const h = { x: v.y * w.z - v.z * w.y, y: v.z * w.x - v.x * w.z, z: v.x * w.y - v.y * w.x };
  const length = Math.hypot(h.x, h.y, h.z);
  h.x /= length;
  h.y /= length;
  h.z /= length;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: v.x * c + (h.y * v.z - h.z * v.y) * s,
    y: v.y * c + (h.z * v.x - h.x * v.z) * s,
    z: v.z * c + (h.x * v.y - h.y * v.x) * s
  };
}

// The Lagrange points, where a small thing can stay put compared to two bodies, like Webb at the
// Sun and Earth's L2. Returns [{ id, name, between: [big, small], x, y, z }] in AU from the Earth (J2000).
// L4 runs 60 degrees ahead of the smaller body, and L5 60 degrees behind.
export function lagrangePoints(date) {
  const time = MakeTime(date);
  const out = [];
  const add = (system, between, n, p) => out.push({ id: `${system}-l${n}`, name: `${between.map(id => BODY_BY_ID[id].name).join('–')} L${n}`, between, ...p });
  const plus = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
  const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });

  // Sun and Earth. L1 and L2 sit about 1.5 million km from the Earth, toward and away from the Sun.
  const earth = HelioState(Body.Earth, time);
  const e = { x: earth.x, y: earth.y, z: earth.z };
  const ev = { x: earth.vx, y: earth.vy, z: earth.vz };
  const hill = Math.cbrt(MASS_RATIO.earth / 3);
  add('sun-earth', ['sun', 'earth'], 1, scale(e, -hill));
  add('sun-earth', ['sun', 'earth'], 2, scale(e, hill));
  add('sun-earth', ['sun', 'earth'], 3, scale(e, -2 - (5 * MASS_RATIO.earth) / 12));
  add('sun-earth', ['sun', 'earth'], 4, plus(turn(e, ev, Math.PI / 3), e, -1));
  add('sun-earth', ['sun', 'earth'], 5, plus(turn(e, ev, -Math.PI / 3), e, -1));

  // Earth and Moon. These numbers are where the points sit along the Earth to Moon line.
  const moon = GeoMoonState(time);
  const m = { x: moon.x, y: moon.y, z: moon.z };
  const mv = { x: moon.vx, y: moon.vy, z: moon.vz };
  add('earth-moon', ['earth', 'moon'], 1, scale(m, 0.8491));
  add('earth-moon', ['earth', 'moon'], 2, scale(m, 1.1678));
  add('earth-moon', ['earth', 'moon'], 3, scale(m, -0.9929));
  add('earth-moon', ['earth', 'moon'], 4, turn(m, mv, Math.PI / 3));
  add('earth-moon', ['earth', 'moon'], 5, turn(m, mv, -Math.PI / 3));

  // Sun and Jupiter, just L4 and L5, where the trojan asteroids gather
  const jupiter = HelioState(Body.Jupiter, time);
  const jv = { x: jupiter.vx, y: jupiter.vy, z: jupiter.vz };
  add('sun-jupiter', ['sun', 'jupiter'], 4, plus(turn(jupiter, jv, Math.PI / 3), e, -1));
  add('sun-jupiter', ['sun', 'jupiter'], 5, plus(turn(jupiter, jv, -Math.PI / 3), e, -1));
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
