// Writes public/data/spacecraft.json for the dev server, downloading from JPL Horizons like the Lambda does.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadSpacecraft } from '../src/space/spacecraft.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'spacecraft.json');

const data = await downloadSpacecraft({ log: console.log });
if (data.count < 5) throw new Error(`Only got ${data.count} spacecraft, refusing to write`);
await mkdir(dirname(OUT), { recursive: true });
const body = JSON.stringify(data);
await writeFile(OUT, body);
console.log(`Wrote ${data.count} spacecraft (${Math.round(body.length / 1024)} kB) to ${OUT}`);
