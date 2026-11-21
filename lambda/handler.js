// Lambda LiveEarth. A schedule runs it every 2 hours (when CelesTrak updates). It downloads every
// active satellite's orbit and writes one JSON file to S3, which CloudFront serves to the page.
import { downloadGroup } from '../src/sats/celestrak.js';
import { refreshCatalog } from '../src/sats/refresh.js';

// short browser cache, then CloudFront and browsers revalidate with the ETag
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';

export function createHandler({ download, loadPrevious, save, log = console.log }) {
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
    await save(JSON.stringify(data));
    log(`Saved ${data.count} satellites, ${fresh} groups fresh`);
    return { satellites: data.count, fresh, failed };
  };
}

async function s3() {
  const sdk = await import('@aws-sdk/client-s3');
  return { sdk, client: new sdk.S3Client({}) };
}

async function loadFromS3() {
  const { sdk, client } = await s3();
  const result = await client.send(new sdk.GetObjectCommand({ Bucket: process.env.BUCKET, Key: process.env.KEY }));
  return JSON.parse(await result.Body.transformToString());
}

async function saveToS3(body) {
  const { sdk, client } = await s3();
  await client.send(
    new sdk.PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: process.env.KEY,
      Body: body,
      ContentType: 'application/json',
      CacheControl: CACHE_CONTROL
    })
  );
}

export const handler = createHandler({ download: downloadGroup, loadPrevious: loadFromS3, save: saveToS3 });
