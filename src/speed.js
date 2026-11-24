// The speed slider goes from -500 to 500, with a notch every 100 steps:
// 100 is real time, 200 is 1 minute per second, 300 is 1 hour, 400 is 1 day and 500 is 1 year per second.
// In between, the speed grows smoothly (evenly on a log scale) from one notch to the next.
// Negative values run time backwards, and the middle pauses.
export const SLIDER_MAX = 500;
const PAUSE_ZONE = 8;
const SNAP = 5;

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365.25 * DAY;

// seconds per second at 100, 200, 300, 400 and 500
const STOPS = [1, MINUTE, HOUR, DAY, YEAR];

// short is for phones, where the dial is narrow
const FORWARD = [
  { value: 100, label: '1 s', short: '1s' },
  { value: 200, label: '1 min', short: '1m' },
  { value: 300, label: '1 hr', short: '1h' },
  { value: 400, label: '1 day', short: '1d' },
  { value: 500, label: '1 yr', short: '1y' }
];

export const NOTCHES = [
  ...FORWARD.map(n => ({ value: -n.value, label: `−${n.label}`, short: `−${n.short}` })).reverse(),
  { value: 0, label: 'pause', short: '❚❚' },
  ...FORWARD
];

export function sliderToSpeed(value) {
  let steps = Math.abs(value);
  if (steps < PAUSE_ZONE) return 0;
  // stick to a notch when close, so real time is easy to hit
  for (const { value: notch } of FORWARD) if (Math.abs(steps - notch) <= SNAP) steps = notch;
  // below real time, keep slowing down at the same rate as from 1 s to 1 min
  if (steps <= 100) return Math.sign(value) * MINUTE ** (steps / 100 - 1);
  if (steps >= SLIDER_MAX) return Math.sign(value) * YEAR;
  // between notch i (at i * 100 steps) and the next one up
  const i = Math.floor(steps / 100);
  const k = steps / 100 - i;
  return Math.sign(value) * STOPS[i - 1] * (STOPS[i] / STOPS[i - 1]) ** k;
}

export function speedToSlider(speed) {
  if (!speed) return 0;
  const abs = Math.abs(speed);
  let steps = SLIDER_MAX;
  if (abs <= 1) steps = (Math.log(abs) / Math.log(MINUTE) + 1) * 100;
  else if (abs < YEAR) {
    // the first notch at or above this speed, and how far up from the one below it
    const i = STOPS.findIndex(stop => stop >= abs);
    steps = (i + Math.log(abs / STOPS[i - 1]) / Math.log(STOPS[i] / STOPS[i - 1])) * 100;
  }
  return Math.sign(speed) * Math.round(steps);
}

export function speedLabel(speed) {
  if (!speed) return 'Paused';
  const abs = Math.abs(speed);
  let rate;
  if (abs === 1) rate = 'real time';
  else if (abs < 1) rate = `${Number(abs.toPrecision(2))}× speed`;
  else if (abs < MINUTE) rate = `${round(abs)} sec/s`;
  else if (abs < HOUR) rate = `${round(abs / MINUTE)} min/s`;
  else if (abs < DAY) rate = `${round(abs / HOUR)} hr/s`;
  else if (abs < YEAR * 0.995) rate = round(abs / DAY) === 1 ? '1 day/s' : `${round(abs / DAY)} days/s`;
  else rate = `${round(abs / YEAR)} yr/s`;
  return speed < 0 ? `Rewinding at ${rate}` : `Playing at ${rate}`;
}

function round(x) {
  return x < 10 ? Number(x.toFixed(1)) : Math.round(x);
}
