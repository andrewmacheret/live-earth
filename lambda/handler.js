// Lambda LiveEarth. A schedule runs it once a day at 02:30 UTC. It downloads every active
// satellite's orbit, plus moons, asteroids, comets and spacecraft from JPL, and writes them to S3, which CloudFront serves to the page.
import { downloadGroup } from '../src/sats/celestrak.js';
import { refreshCatalog } from '../src/sats/refresh.js';
import { downloadWikiTitles, pickTitles } from '../src/sats/wiki.js';
import { downloadSmallBodies, toCompactBodies } from '../src/space/smallBodies.js';
import { downloadMoons } from '../src/space/moons.js';
import { downloadSpacecraft } from '../src/space/spacecraft.js';
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

// Moons and spacecraft are nice to have too. One missing just gets left out, but too many missing keeps the old file.
async function refreshExtra({ what, minimum, download, save, log }) {
  try {
    const data = await download({ log });
    if (data.count < minimum) throw new Error(`Only got ${data.count} ${what}`);
    await save(JSON.stringify(data));
    log(`Saved ${data.count} ${what}`);
    return data.count;
  } catch (err) {
    log(`Kept old ${what}: ${err.message}`);
    return 0;
  }
}

export function createHandler({
  download,
  downloadWiki = async () => ({}),
  downloadRocks,
  downloadCraft,
  downloadMoonOrbits,
  loadPrevious,
  save,
  saveRocks,
  saveCraft,
  saveMoons,
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
    const spacecraft = downloadCraft
      ? await refreshExtra({ what: 'spacecraft', minimum: 5, download: downloadCraft, save: saveCraft, log })
      : 0;
    const moons = downloadMoonOrbits
      ? await refreshExtra({ what: 'moons', minimum: 20, download: downloadMoonOrbits, save: saveMoons, log })
      : 0;
    return { satellites: data.count, fresh, failed, smallBodies, spacecraft, moons };
  };
}

export const handler = createHandler({
  download: downloadGroup,
  downloadWiki: downloadWikiTitles,
  downloadRocks: downloadSmallBodies,
  loadPrevious: loadFromS3,
  save: body => saveToS3(body, CACHE_CONTROL),
  downloadCraft: downloadSpacecraft,
  downloadMoonOrbits: downloadMoons,
  saveRocks: body => saveToS3(body, CACHE_CONTROL, process.env.KEY.replace(/[^/]*$/, 'small-bodies.json')),
  saveCraft: body => saveToS3(body, CACHE_CONTROL, process.env.KEY.replace(/[^/]*$/, 'spacecraft.json')),
  saveMoons: body => saveToS3(body, CACHE_CONTROL, process.env.KEY.replace(/[^/]*$/, 'moons.json'))
});
