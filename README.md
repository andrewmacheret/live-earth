# live-earth

[![Build and deploy](https://github.com/andrewmacheret/live-earth/actions/workflows/deploy.yml/badge.svg)](https://github.com/andrewmacheret/live-earth/actions/workflows/deploy.yml) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/live-earth/blob/main/LICENSE.md)

A 3D globe showing every active satellite where it is right now, using [React](https://react.dev/), [three.js](https://threejs.org/) and [satellite.js](https://github.com/shashwatak/satellite-js).

Thousands of Starlinks, the ISS and everything else CelesTrak tracks move in real time over a globe with a real day and night side, yesterday's clouds, tonight's aurora and the real stars behind. Satellites in Earth's shadow are drawn dim. Click one to see its altitude, speed and orbit, then hit Ride along to follow it. Zoom out, or use the Go to buttons, to visit the Moon, the Sun, the planets and their moons, then the asteroid belt, Jupiter's trojans, the Kuiper belt, famous comets like Halley's, the three visitors from other stars like 3I/ATLAS, and spacecraft like Voyager 1, Parker Solar Probe and Webb. The clock can run up to a year per second, forward or backward.

See it running at [andrewmacheret.com/projects/live-earth](https://andrewmacheret.com/projects/live-earth/).

## How it works

- Lambda `LiveEarth` (`lambda/handler.js`) runs once a day at 02:30 UTC from the EventBridge rule `LiveEarthRefresh`. It downloads the latest orbits for every active satellite from [CelesTrak](https://celestrak.org/) and writes them to `data/satellites.json` next to the page, cached for 5 minutes. CelesTrak only allows one download per IP every 2 hours and can be slow, so the page never calls it directly. Day-old orbits put satellites a few kilometres off, which you can't see on the globe, and the footer shows how old the data is.
- A web worker (`src/sats/propagate.worker.js`) runs the SGP4 orbit model for every satellite about 20 times a second. Each frame moves the dots along their velocity in between.
- The Earth spins under the orbits using sidereal time, and the sun position lights it, so the sunrise line and city lights are where they really are.
- The stars behind everything are the real ones: the 5,000 or so you can see without a telescope, from the Yale Bright Star Catalog, sized by brightness and colored by temperature, with the 88 constellations' stick figures and names and the brightest stars' names. They come from [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD license) and are saved in `src/space/sky.json` by `node scripts/fetch-sky.js`, which only needs to run again to change what's kept. The Space legend can hide the constellations.
- The aurora is NOAA's live [OVATION forecast](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast): the chance of seeing it overhead on a 1° grid, redone every few minutes. NOAA allows calls from web pages, so the page downloads it directly every 10 minutes (about 150 kB) and draws it as a glow 110 km up on the night side, green and turning red and purple where it's strong (`src/space/aurora.js`, `src/globe/aurora.js`). It fades out when the clock is more than a few hours from now.
- Clouds are yesterday's, from NASA's [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api): a true color picture of the whole Earth stitched from the VIIRS camera on NOAA-20 (`src/space/clouds.js`). The newest day is still filling in for hours after midnight UTC, so the day before fills its gaps. The picture shows the ground too, so the shader keeps only what's bright, grey and brighter than the Earth's own map there, which leaves out deserts and ice (`src/globe/clouds.js`). GIBS allows calls from web pages, so the page downloads the two pictures (about 1 MB) itself.
- Eclipses draw themselves. The Earth's shader works out how much of the Sun the Moon covers from each spot, so the Moon's shadow crosses the Earth during a solar eclipse, and city lights come on in totality. The Moon's shader does the same with the Earth's shadow, dark red in the middle, during a lunar eclipse. The Sun, Moon and Earth panels show the next eclipse from Astronomy Engine (`src/space/eclipses.js`), skipping the faint penumbral lunar ones, and Watch it jumps the clock to just before the peak at a minute a second and turns the camera to the shadow.
- Coming up, under the clock, lists the next year of things to see (`src/space/events.js`): eclipses, meteor shower peaks, the outer planets at opposition, Mercury and Venus at their farthest from the Sun, planets passing close in the sky, solstices and equinoxes, and Earth's closest and farthest points from the Sun, all from Astronomy Engine. Once the spacecraft and asteroids load it adds flybys (found by looking for each craft's closest pass to a planet or famous asteroid), Parker's closest passes of the Sun, and famous comets' closest passes. Clicking one sets the clock a little before it and points the camera at it.
- The Sun, Moon, planets and Pluto come from [Astronomy Engine](https://github.com/cosinekitty/astronomy), which works out their positions, tilts and spins in the browser (`src/space/bodies.js`). Astronomy Engine doesn't know the other dwarf planets, so Ceres, Eris, Haumea, Makemake and the likely dwarf planets Gonggong, Quaoar, Sedna and Orcus use orbits copied from JPL's Small-Body Database, which stay within 0.05° of where Horizons puts them. Zooming out past the satellites shows the Moon's orbit, then the planets' orbits, and the Moon shows its real phase. Scene units stay Earth radii all the way out, and the camera's near plane follows the zoom so far-away things still draw in the right order. Planet maps only download the first time a planet is big enough to see. Saturn's rings use a picture. The fainter rings of Jupiter, Uranus and Neptune are drawn from a list of each ring's edges. Lagrange points for the Sun and Earth, the Earth and Moon, and the Sun and Jupiter are marked once they're far enough from their bodies on screen (`lagrangePoints` in `src/space/bodies.js`). Zooming out past the planets shows the heliosphere, the bubble the Sun's wind blows: the termination shock and the heliopause, squashed on the side the interstellar wind comes from and stretched behind, about where the Voyagers crossed them. Among the inner planets, the dust streams behind 10 meteor showers, like the Perseids and Geminids, are drawn along their parent comets' orbits, with each shower's name where the Earth meets the stream at its peak (`src/space/meteors.js`). Click a shower's name, or search for it, to light up its stream and see its next peak, meteors an hour and parent comet. The Space legend can hide them.
- About 19,000 asteroids, dwarf planets and comets come from NASA JPL's [Small-Body Database](https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html): every asteroid brighter than magnitude 13, every potentially hazardous asteroid, every numbered comet, and every other comet passing the Sun within 3 years of today, plus Hale–Bopp, NEOWISE and the three interstellar objects, 'Oumuamua, Borisov and 3I/ATLAS (`src/space/smallBodies.js`). Comets that pass by once and never come back are on open orbits instead of ellipses, so they get their own version of Kepler's equation and a line that runs in from far away and back out. JPL's API doesn't allow calls from web pages, so the same daily Lambda run saves them to `data/small-bodies.json`. A JPL problem only gets logged and leaves yesterday's file. The page downloads the file the first time you zoom out or search, then solves Kepler's equation for each rock a few times a second (`src/globe/rocks.js`). Comets inside about 5 AU grow a tail pointing away from the Sun that gets longer as they get closer.
- 85 moons of Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Eris, Quaoar and Orcus, from Io, Titan and Triton down to Pluto's tiny Styx, also come from Horizons (`src/space/moons.js`). The daily Lambda run asks for each moon's orbit once a day for a year either side of today, then fits a steady orbit that slowly turns, and saves it to `data/moons.json` (about 13 kB). The page places each orbit around its planet's equator using the planet's tilt from Astronomy Engine. Pluto's small moons circle the balance point between Pluto and Charon, so they're measured from there. Horizons doesn't know the other dwarf planets' tilts, so their moons are measured against Earth's equator instead, and it has no orbits for the moons of Haumea and Makemake. Most moons stay within 1% of their real spot. A few drift more, by up to 15% of their orbit's size: Hyperion and Helene, Epimetheus, which swaps orbits with Janus, and the far-out moons the Sun tugs on, like Pasiphae.
- 26 spacecraft, like the Voyagers, New Horizons, Parker Solar Probe, Webb, Juno, SOHO and the Mars orbiters, come from NASA JPL's [Horizons](https://ssd.jpl.nasa.gov/horizons/) system (`src/space/spacecraft.js`). Horizons doesn't allow calls from web pages either, so the daily Lambda run saves a year either side of today to `data/spacecraft.json`. It asks for a position every 6 hours (every 30 minutes during flybys), then keeps only the ones the page needs to rebuild the rest within 500 km. The page fills in between with a cubic that matches both positions and speeds. Parker swings past the Sun too fast for that, so it's saved as one ellipse, and so are the craft circling Mars and the Moon every few hours (around their planet instead). Webb and the craft near L1 and L2 are saved from the Earth instead of the Sun, Juno from Jupiter, and the craft leaving the solar system keep going straight past the saved year.

## Planes (parked)

The page can draw live planes from `data/planes.json` (see `src/planes/`), but there's no data source yet, so it shows none. When the file is missing, the page asks once and then stops.

The plan was Lambda `LiveEarthPlanes` (`lambda/planes.js`) behind CloudFront, fetching [OpenSky Network](https://opensky-network.org/) at most every 3 minutes and only while someone is looking. That doesn't work because OpenSky blocks AWS addresses, and its docs ask people not to work around the block. The Lambda, its IAM role and its function URL exist but CloudFront doesn't route to them yet.

About a quarter of OpenSky planes report positions minutes to hours old as if they were current. `toCompactPlanes` drops a plane whose position jumped further than its speed allows since the previous snapshot.

## Development

Built with [Vite](https://vite.dev/). Needs Node.js 24.

```bash
npm install

# copy the live site's orbit data into public/data/, and download moons, asteroids, comets and spacecraft from JPL
npm run fetch-data

# or download the satellites from CelesTrak yourself (at most once every 2 hours)
node scripts/fetch-satellites.js --celestrak

# dev server on http://localhost:5173
npm run dev

npm test

# production build in dist/
npm run build
```

## Deploy

Pushes to `main` run the tests, update the `LiveEarth` Lambda, copy `dist/` to `s3://andrewmacheret.com/projects/live-earth` (leaving `data/` to the Lambda), and clear the CloudFront cache (see `.github/workflows/deploy.yml`). The workflow signs in to AWS with GitHub OIDC using the IAM role in the `AWS_ROLE_ARN` repo variable.

The Lambda runs as IAM role `LiveEarth`, which can only write `projects/live-earth/data/*`. Its logs are in `/aws/lambda/LiveEarth`, kept for 14 days. It doesn't retry when it fails, so a CelesTrak outage just leaves the last good file in place until the next day's run. To refresh sooner, run `aws lambda invoke --function-name LiveEarth --cli-read-timeout 660 out.json --profile personal` (at most once every 2 hours, because of CelesTrak's limit).

Earth textures are from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets). The Sun, Moon and planet textures are from [Solar System Scope](https://www.solarsystemscope.com/textures/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), shrunk to save download size.
