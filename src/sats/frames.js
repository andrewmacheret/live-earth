import { jday, sunPos } from 'satellite.js';

// The globe has a radius of 1, so 1 scene unit is one Earth radius.
export const EARTH_RADIUS_KM = 6371;

// Numbers per satellite in the worker's output: x, y, z, vx, vy, vz, lit.
export const STRIDE = 7;

// Space coordinates put the north pole on +z, but three.js treats +y as up, so swap them.
// Longitude 0 ends up on +x and 90°E on -z, which is how three.js wraps a world map on a sphere.
export function toScene(x, y, z, out, i = 0) {
  out[i] = x;
  out[i + 1] = z;
  out[i + 2] = -y;
  return out;
}

// True if the Earth (radius 1, at the origin) blocks the line from the camera to the point.
export function behindEarth(camera, point) {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - camera.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (camera.x * dx + camera.y * dy + camera.z * dz);
  const c = camera.x * camera.x + camera.y * camera.y + camera.z * camera.z - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}

// Unit vector pointing at the sun, in scene coordinates (not rotated with the Earth).
export function sunDirection(date) {
  const { x, y, z } = sunPos(jday(date)).rsun;
  const length = Math.hypot(x, y, z);
  return toScene(x / length, y / length, z / length, [0, 0, 0]);
}
