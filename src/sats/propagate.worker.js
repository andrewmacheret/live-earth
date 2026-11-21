// Works out where every satellite is, over and over, off the main thread.
// Each result is a Float32Array with 7 numbers per satellite:
//   x, y, z (Earth radii), vx, vy, vz (Earth radii per second), lit (0 to 1, or -1 if unknown)
import { jday, json2satrec, propagate, shadowFraction, sunPos } from 'satellite.js';
import { EARTH_RADIUS_KM, STRIDE, toScene } from './frames.js';

const STEP_MS = 50;

let satrecs = [];
let clock = null;
let spare = [];
let timer = null;

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    satrecs = data.records.map(record => {
      try {
        return json2satrec(record);
      } catch {
        return null;
      }
    });
    spare = [];
  } else if (data.type === 'clock') {
    clock = data.clock;
  } else if (data.type === 'recycle') {
    spare.push(data.buffer);
  }
  if (!timer && clock && satrecs.length) tick();
};

function tick() {
  const started = performance.now();
  const time = clock.simStart + (Date.now() - clock.realStart) * clock.speed;
  const date = new Date(time);
  const sun = sunPos(jday(date)).rsun;
  const size = satrecs.length * STRIDE;

  let out = spare.pop();
  if (!out || out.length !== size) out = new Float32Array(size);

  for (let i = 0; i < satrecs.length; i++) {
    const o = i * STRIDE;
    const result = satrecs[i] && propagate(satrecs[i], date);
    if (!result || !result.position) {
      out.fill(0, o, o + STRIDE);
      out[o + 6] = -1;
      continue;
    }
    const p = result.position;
    const v = result.velocity;
    toScene(p.x / EARTH_RADIUS_KM, p.y / EARTH_RADIUS_KM, p.z / EARTH_RADIUS_KM, out, o);
    toScene(v.x / EARTH_RADIUS_KM, v.y / EARTH_RADIUS_KM, v.z / EARTH_RADIUS_KM, out, o + 3);
    out[o + 6] = 1 - shadowFraction(sun, p);
  }

  self.postMessage({ time, version: clock.version, buffer: out }, [out.buffer]);
  timer = setTimeout(tick, Math.max(0, STEP_MS - (performance.now() - started)));
}
