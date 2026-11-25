// Helpers for the real night sky in sky.json (made by scripts/fetch-sky.js).

const RAD = Math.PI / 180;

// Unit vector toward a right ascension and declination in degrees (J2000)
export function skyVector(ra, dec) {
  const c = Math.cos(dec * RAD);
  return { x: c * Math.cos(ra * RAD), y: c * Math.sin(ra * RAD), z: Math.sin(dec * RAD) };
}

// Star color from its B-V index. Blue-white hot stars are near -0.3, the Sun is 0.65, red giants are near 2.
const STOPS = [
  [-0.4, [0.62, 0.71, 1]],
  [0, [0.8, 0.85, 1]],
  [0.35, [0.98, 0.97, 1]],
  [0.65, [1, 0.95, 0.88]],
  [1.0, [1, 0.84, 0.66]],
  [1.5, [1, 0.72, 0.45]],
  [2.0, [1, 0.6, 0.35]]
];
export function starColor(bv) {
  if (bv <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [b, color] = STOPS[i];
    if (bv <= b) {
      const [a, from] = STOPS[i - 1];
      const k = (bv - a) / (b - a);
      return from.map((v, j) => v + (color[j] - v) * k);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// How big and bright a star looks. Smaller magnitudes are brighter: Sirius is -1.5, the faintest you
// can see on a dark night is about 6.
export function starLook(mag) {
  return {
    size: Math.max(1.8, 8 - mag - 1.5),
    brightness: Math.min(1, Math.max(0.4, 1.1 - mag * 0.12))
  };
}
