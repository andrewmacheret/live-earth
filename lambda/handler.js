// Lambda LiveEarth. A schedule runs it once a day at 02:30 UTC. It downloads every active
// satellite's orbit, plus asteroids and comets from JPL, and writes them to S3, which CloudFront serves to the page.
import { downloadGroup } from '../src/sats/celestrak.js';
import { refreshCatalog } from '../src/sats/refresh.js';
import { downloadWikiTitles, pickTitles } from '../src/sats/wiki.js';
import { downloadSmallBodies, toCompactBodies } from '../src/space/smallBodies.js';
import { loadFromS3, saveToS3 } from './s3.js';

// short browser cache, then CloudFront and browsers revalidate with the ETag
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';

// Asteroids and comets are nice to have, so a JPL problem only gets logged and the old file stays.
async function refreshSmallBodies({ downloadRocks, saveRocks, log }) {
  try {
    const data = toCompactBodies(await downloadRocks());
    if (data.count < 1000) throw new Error(`Only got ${data.count} asteroids and comets`);
    await saveRocks(JSON.stringify(data));
    log(`Saved ${data.count} asteroids and comets`);
    return data.count;
  } catch (err) {
    log(`Kept old asteroids and comets: ${err.message}`);
    return 0;
  }
}

export function createHandler({
  download,
  downloadWiki = async () => ({}),
  downloadRocks,
  loadPrevious,
  save,
  saveRocks,
  log = console.log
}) {
  return async () => {
    let previous = null;
    try {
      previous = await loadPrevious();
    } catch (err) {
      log(`Starting without previous data: ${err.message}`);
    }
    const { data, fresh, failed } = await refreshCatalog({ previous, download, log });
    if (failed.length) log(`Kept old data for: ${failed.join(', ')}`);
    if (!fresh) throw new Error('Every group failed, so nothing was saved');
    // a short list means CelesTrak sent something odd, so keep the last good file
    if (data.count < 1000) throw new Error(`Only got ${data.count} satellites`);
    // Wikipedia links are nice to have, so keep the old ones if Wikidata is down
    try {
      data.wiki = pickTitles(await downloadWiki(), data.columns.NORAD_CAT_ID);
    } catch (err) {
      log(`Kept old Wikipedia links: ${err.message}`);
      data.wiki = previous?.wiki ?? {};
    }
    await save(JSON.stringify(data));
    log(`Saved ${data.count} satellites, ${fresh} groups fresh, ${Object.keys(data.wiki).length} Wikipedia links`);
    const smallBodies = downloadRocks ? await refreshSmallBodies({ downloadRocks, saveRocks, log }) : 0;
    return { satellites: data.count, fresh, failed, smallBodies };
  };
}

export const handler = createHandler({
  download: downloadGroup,
  downloadWiki: downloadWikiTitles,
  downloadRocks: downloadSmallBodies,
  loadPrevious: loadFromS3,
  save: body => saveToS3(body, CACHE_CONTROL),
  saveRocks: body => saveToS3(body, CACHE_CONTROL, process.env.KEY.replace(/[^/]*$/, 'small-bodies.json'))
});
