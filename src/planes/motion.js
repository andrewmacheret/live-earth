// Plane positions in the Earth's own frame (it turns with the globe), in Earth radii.
// Longitude 0 is +x, 90°E is -z and the north pole is +y, the same as the globe texture.
const EARTH_RADIUS_M = 6371000;
// keeps planes a hair above the ground so the globe doesn't cover them
const LIFT = 0.0005;
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;

// The great circle a plane is flying along: where it was at time t0 (seconds), which way it was
// headed, and how fast it turns around the Earth's center (radians per second).
export function pathOf(plane, base) {
  const lat = rad(plane.lat);
  const lon = rad(plane.lon);
  const track = rad(plane.track);
  const r = 1 + LIFT + Math.max(0, plane.altitude) / EARTH_RADIUS_M;
  const north = [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)];
  const east = [-Math.sin(lon), 0, -Math.cos(lon)];
  return {
    start: [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)],
    dir: north.map((n, i) => n * Math.cos(track) + east[i] * Math.sin(track)),
    rate: plane.speed / (EARTH_RADIUS_M * r),
    t0: plane.at / 1000 - base
  };
}

// Where the plane is at time t (seconds from base), and which way it's headed.
export function flyPath({ start, dir, rate, t0 }, t, out = [0, 0, 0], heading = null) {
  const a = rate * (t - t0);
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < 3; i++) {
    out[i] = start[i] * c + dir[i] * s;
    if (heading) heading[i] = dir[i] * c - start[i] * s;
  }
  return out;
}

export function toLatLon([x, y, z]) {
  const r = Math.hypot(x, y, z);
  return { lat: deg(Math.asin(y / r)), lon: deg(Math.atan2(-z, x)) };
}

// compass direction of a heading vector at a point
export function trackAt([x, y, z], [hx, hy, hz]) {
  const { lat, lon } = toLatLon([x, y, z]);
  const la = rad(lat);
  const lo = rad(lon);
  const north = -Math.sin(la) * Math.cos(lo) * hx + Math.cos(la) * hy + Math.sin(la) * Math.sin(lo) * hz;
  const east = -Math.sin(lo) * hx - Math.cos(lo) * hz;
  return (deg(Math.atan2(east, north)) + 360) % 360;
}
