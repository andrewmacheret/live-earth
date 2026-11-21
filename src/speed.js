// The speed slider goes from -300 to 300. Each 100 steps is 60 times faster:
// 100 is real time, 200 is 1 minute per second, 300 is 1 hour per second.
// Negative values run time backwards, and the middle pauses.
export const SLIDER_MAX = 300;
const PAUSE_ZONE = 8;
const SNAP = 5;

export const NOTCHES = [
  { value: -300, label: '−1 hr' },
  { value: -200, label: '−1 min' },
  { value: -100, label: '−1 s' },
  { value: 0, label: 'pause' },
  { value: 100, label: '1 s' },
  { value: 200, label: '1 min' },
  { value: 300, label: '1 hr' }
];

export function sliderToSpeed(value) {
  let steps = Math.abs(value);
  if (steps < PAUSE_ZONE) return 0;
  // stick to a notch when close, so real time is easy to hit
  for (const notch of [100, 200, 300]) if (Math.abs(steps - notch) <= SNAP) steps = notch;
  return Math.sign(value) * 60 ** (steps / 100 - 1);
}

export function speedToSlider(speed) {
  if (!speed) return 0;
  return Math.sign(speed) * Math.round((Math.log(Math.abs(speed)) / Math.log(60) + 1) * 100);
}

export function speedLabel(speed) {
  if (!speed) return 'Paused';
  const abs = Math.abs(speed);
  let rate;
  if (abs === 1) rate = 'real time';
  else if (abs < 1) rate = `${Number(abs.toPrecision(2))}× speed`;
  else if (abs < 60) rate = `${round(abs)} sec/s`;
  else if (abs < 3600) rate = `${round(abs / 60)} min/s`;
  else rate = `${round(abs / 3600)} hr/s`;
  return speed < 0 ? `Rewinding at ${rate}` : `Playing at ${rate}`;
}

function round(x) {
  return x < 10 ? Number(x.toFixed(1)) : Math.round(x);
}
