// Lambda LiveEarthPlanes. A schedule runs it every 3 minutes. It downloads every plane OpenSky
// can see and writes one JSON file to S3. Between runs the page moves each plane along its heading.
import { toCompactPlanes } from '../src/planes/compact.js';
import { downloadStates } from '../src/planes/opensky.js';
import { loadFromS3, saveToS3 } from './s3.js';

// short, so a new file shows up soon after it's written
const CACHE_CONTROL = 'public, max-age=15';

export function createPlanesHandler({ download, loadPrevious, save, log = console.log }) {
  return async () => {
    const answer = await download();
    // the last file helps spot planes whose positions are running late
    let previous = null;
    try {
      previous = await loadPrevious();
    } catch (err) {
      log(`Starting without the last file: ${err.message}`);
    }
    const data = toCompactPlanes(answer, { previous });
    // a short list means OpenSky sent something odd, so keep the last good file
    if (data.count < 1000) throw new Error(`Only got ${data.count} planes`);
    await save(JSON.stringify(data));
    log(`Saved ${data.count} planes (${data.lagging} running late), ${answer.remaining} OpenSky credits left today`);
    return { planes: data.count, lagging: data.lagging, remaining: answer.remaining };
  };
}

export const handler = createPlanesHandler({
  download: () =>
    downloadStates({ clientId: process.env.OPENSKY_CLIENT_ID, clientSecret: process.env.OPENSKY_CLIENT_SECRET }),
  loadPrevious: loadFromS3,
  save: body => saveToS3(body, CACHE_CONTROL)
});
