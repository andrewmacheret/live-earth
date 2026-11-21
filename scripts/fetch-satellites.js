// Writes public/data/satellites.json for the dev server.
//
//   node scripts/fetch-satellites.js               copy the live site's file (fast, no limits)
//   node scripts/fetch-satellites.js --celestrak   download from CelesTrak like the Lambda does
//                                                  (each group once per 2 hours per IP)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadGroup } from '../src/sats/celestrak.js';
import { refreshCatalog } from '../src/sats/refresh.js';

const LIVE_URL = 'https://andrewmacheret.com/projects/live-earth/data/satellites.json';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'satellites.json');

let body;
if (process.argv[2] === '--celestrak') {
  const previous = await readFile(OUT, 'utf8').then(JSON.parse, () => null);
  const { data, failed } = await refreshCatalog({ previous, download: downloadGroup });
  if (failed.length) console.log(`Kept old data for: ${failed.join(', ')}`);
  body = JSON.stringify(data);
} else {
  console.log(`Fetching ${LIVE_URL}`);
  const response = await fetch(LIVE_URL);
  if (!response.ok) throw new Error(`${LIVE_URL} answered ${response.status}`);
  body = await response.text();
}

const count = JSON.parse(body).satellites.length;
if (count < 100) throw new Error(`Only got ${count} satellites, refusing to write`);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, body);
console.log(`Wrote ${count} satellites to ${OUT}`);
