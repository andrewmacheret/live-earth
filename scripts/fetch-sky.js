// Writes src/space/sky.json: the stars you can see without a telescope (the Yale Bright Star Catalog),
// constellation lines and names, and names of the brightest stars. They come from d3-celestial
// (BSD license). The stars don't move, so this only needs to run again to change what's kept.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'space', 'sky.json');
const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
// stars brighter than this get their names shown
const NAMED_MAG = 1.6;

const get = async file => {
  const response = await fetch(BASE + file);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.json();
};
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
// d3-celestial uses -180 to 180 for right ascension, and 0 to 360 reads better
const ra = degrees => round((degrees + 360) % 360);

const [stars, lines, constellations, names] = await Promise.all([
  get('stars.6.json'),
  get('constellations.lines.json'),
  get('constellations.json'),
  get('starnames.json')
]);

// [right ascension, declination, magnitude, B-V color] for every star, all in one flat list
const starList = stars.features
  .filter(star => star.properties.mag <= 6.5)
  .sort((a, b) => a.properties.mag - b.properties.mag)
  .flatMap(({ properties: { mag, bv }, geometry: { coordinates: [r, d] } }) => [ra(r), round(d), round(mag), round(Number(bv) || 0.6)]);

// the North Star is fainter, but everyone looks for it
const ALSO_NAMED = ['Polaris'];
const named = stars.features
  .filter(star => names[star.id]?.name && (star.properties.mag < NAMED_MAG || ALSO_NAMED.includes(names[star.id].name)))
  .sort((a, b) => a.properties.mag - b.properties.mag)
  .map(({ id, properties: { mag }, geometry: { coordinates: [r, d] } }) => [names[id].name, ra(r), round(d), round(mag)]);

const data = {
  source: 'd3-celestial (https://github.com/ofrohn/d3-celestial), BSD 3-Clause',
  stars: starList,
  // each constellation's stick figure, as lists of [ra, dec, ra, dec, ...] lines
  lines: Object.fromEntries(
    lines.features.map(({ id, geometry }) => [id, geometry.coordinates.map(line => line.flatMap(([r, d]) => [ra(r), round(d)]))])
  ),
  // [short name, name, ra, dec] for where each constellation's name goes
  constellations: constellations.features.map(({ id, properties, geometry: { coordinates: [r, d] } }) => [
    id,
    properties.name,
    ra(r),
    round(d)
  ]),
  named
};

const body = JSON.stringify(data);
await writeFile(OUT, body + '\n');
console.log(
  `Wrote ${starList.length / 4} stars, ${data.constellations.length} constellations and ${named.length} star names (${Math.round(body.length / 1024)} kB) to ${OUT}`
);
