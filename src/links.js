// Links that open on the same moment and the same view: t is the sim time, speed the clock speed,
// at what the camera looks at and cam where the camera sits from there, in Earth radii.

const short = value => String(Number(value.toPrecision(5)));

// The extra link params for this view. A live link leaves out the time and speed, so it stays live.
export function viewParams({ time, live, speed, anchor, offset }) {
  const params = {};
  if (!live) {
    params.t = new Date(Math.round(time / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    if (speed !== 1) params.speed = String(speed);
  }
  params.at = anchor;
  params.cam = offset.map(short).join(',');
  return params;
}

// What a link asks for. Anything missing or broken comes back as null.
export function readView(params) {
  const time = Date.parse(params.get('t') ?? '');
  const speed = Number(params.get('speed'));
  const offset = (params.get('cam') ?? '').split(',').map(Number);
  const anchor = params.get('at');
  const goodOffset = offset.length === 3 && offset.every(Number.isFinite) && Math.hypot(...offset) > 0;
  return {
    time: Number.isFinite(time) ? time : null,
    speed: params.has('speed') && Number.isFinite(speed) ? speed : null,
    anchor: anchor && goodOffset ? anchor : null,
    offset: anchor && goodOffset ? offset : null
  };
}

export const VIEW_KEYS = ['t', 'speed', 'at', 'cam'];
