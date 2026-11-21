// Lambda LiveEarthPlanes. CloudFront sends requests for data/planes.json here. It only asks OpenSky
// for planes while someone is looking, and at most once every 3 minutes however many people are.
import { toCompactPlanes } from '../src/planes/compact.js';
import { downloadStates } from '../src/planes/opensky.js';

const REFRESH_MS = 3 * 60000;
// when OpenSky is down, wait this long before asking again
const RETRY_MS = 60000;
// CloudFront shares each answer with everyone for a minute. If this Lambda fails,
// CloudFront keeps serving the last good answer for up to 10 minutes.
const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=30, stale-if-error=600';

export function createPlanesHandler({ download, now = () => Date.now(), log = console.log }) {
  // kept between requests while this Lambda stays warm
  let last = null;
  let lastTry = -Infinity;

  async function refresh() {
    lastTry = now();
    const answer = await download();
    // after a cold start, also get the planes from 3 minutes ago to spot positions running late
    let previous = last?.data ?? null;
    if (!previous) {
      try {
        previous = toCompactPlanes(await download({ time: answer.time - 180 }));
      } catch (err) {
        log(`No earlier snapshot to compare with: ${err.message}`);
      }
    }
    const data = toCompactPlanes(answer, { previous });
    // a short list means OpenSky sent something odd, so keep the last good one
    if (data.count < 1000) throw new Error(`Only got ${data.count} planes`);
    last = { data, body: JSON.stringify(data), fetchedAt: now() };
    log(`Got ${data.count} planes (${data.lagging} running late), ${answer.remaining} OpenSky credits left today`);
  }

  return async () => {
    const stale = !last || now() - last.fetchedAt >= REFRESH_MS;
    if (stale && now() - lastTry >= RETRY_MS) {
      try {
        await refresh();
      } catch (err) {
        // fetch hides network problems behind "fetch failed", with the real reason in `cause`
        log(`Couldn't refresh planes: ${err.message}${err.cause ? ` (${err.cause.code ?? err.cause.message})` : ''}`);
      }
    }
    if (!last) {
      return { statusCode: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: 'No planes yet' };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': CACHE_CONTROL, ETag: `"${last.data.time}"` },
      body: last.body
    };
  };
}

export const handler = createPlanesHandler({
  download: ({ time } = {}) =>
    downloadStates({ clientId: process.env.OPENSKY_CLIENT_ID, clientSecret: process.env.OPENSKY_CLIENT_SECRET, time })
});
