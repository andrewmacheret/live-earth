// Writes public/data/small-bodies.json (asteroids and comets) for the dev server,
// downloading from JPL like the Lambda does. JPL has no daily limit.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadSmallBodies, toCompactBodies } from '../src/space/smallBodies.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'small-bodies.json');

const data = toCompactBodies(await downloadSmallBodies());
if (data.count < 1000) throw new Error(`Only got ${data.count} asteroids and comets, refusing to write`);
await mkdir(dirname(OUT), { recursive: true });
const body = JSON.stringify(data);
await writeFile(OUT, body);
console.log(`Wrote ${data.count} asteroids and comets (${Math.round(body.length / 1024)} kB) to ${OUT}`);
