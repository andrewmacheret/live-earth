// Writes public/data/moons.json for the dev server, downloading from JPL Horizons like the Lambda does.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadMoons } from '../src/space/moons.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'moons.json');

const data = await downloadMoons({ log: console.log });
if (data.count < 20) throw new Error(`Only got ${data.count} moons, refusing to write`);
await mkdir(dirname(OUT), { recursive: true });
const body = JSON.stringify(data);
await writeFile(OUT, body);
console.log(`Wrote ${data.count} moons (${Math.round(body.length / 1024)} kB) to ${OUT}`);
