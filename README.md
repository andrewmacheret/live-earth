# live-earth

[![Build and deploy](https://github.com/andrewmacheret/live-earth/actions/workflows/deploy.yml/badge.svg)](https://github.com/andrewmacheret/live-earth/actions/workflows/deploy.yml) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/live-earth/blob/main/LICENSE.md)

A 3D globe showing every active satellite where it is right now, using [React](https://react.dev/), [three.js](https://threejs.org/) and [satellite.js](https://github.com/shashwatak/satellite-js).

Thousands of Starlinks, the ISS and everything else CelesTrak tracks move in real time over a globe with a real day and night side. Satellites in Earth's shadow are drawn dim. Click one to see its altitude, speed and orbit, then hit Ride along to follow it. The clock can run up to an hour per second.

See it running at [andrewmacheret.com/projects/live-earth](https://andrewmacheret.com/projects/live-earth/).

## How it works

- Lambda `LiveEarth` (`lambda/handler.js`) runs once a day at 02:30 UTC from the EventBridge rule `LiveEarthRefresh`. It downloads the latest orbits for every active satellite from [CelesTrak](https://celestrak.org/) and writes them to `data/satellites.json` next to the page, cached for 5 minutes. CelesTrak only allows one download per IP every 2 hours and can be slow, so the page never calls it directly. Day-old orbits put satellites a few kilometres off, which you can't see on the globe, and the footer shows how old the data is.
- A web worker (`src/sats/propagate.worker.js`) runs the SGP4 orbit model for every satellite about 20 times a second. Each frame moves the dots along their velocity in between.
- The Earth spins under the orbits using sidereal time, and the sun position lights it, so the sunrise line and city lights are where they really are.

## Planes (parked)

The page can draw live planes from `data/planes.json` (see `src/planes/`), but there's no data source yet, so it shows none. When the file is missing, the page asks once and then stops.

The plan was Lambda `LiveEarthPlanes` (`lambda/planes.js`) behind CloudFront, fetching [OpenSky Network](https://opensky-network.org/) at most every 3 minutes and only while someone is looking. That doesn't work because OpenSky blocks AWS addresses, and its docs ask people not to work around the block. The Lambda, its IAM role and its function URL exist but CloudFront doesn't route to them yet.

About a quarter of OpenSky planes report positions minutes to hours old as if they were current. `toCompactPlanes` drops a plane whose position jumped further than its speed allows since the previous snapshot.

## Development

Built with [Vite](https://vite.dev/). Needs Node.js 24.

```bash
npm install

# copy the live site's orbit data into public/data/
npm run fetch-data

# or download it from CelesTrak yourself (at most once every 2 hours)
npm run fetch-data -- --celestrak

# dev server on http://localhost:5173
npm run dev

npm test

# production build in dist/
npm run build
```

## Deploy

Pushes to `main` run the tests, update the `LiveEarth` Lambda, copy `dist/` to `s3://andrewmacheret.com/projects/live-earth` (leaving `data/` to the Lambda), and clear the CloudFront cache (see `.github/workflows/deploy.yml`). The workflow signs in to AWS with GitHub OIDC using the IAM role in the `AWS_ROLE_ARN` repo variable.

The Lambda runs as IAM role `LiveEarth`, which can only write `projects/live-earth/data/*`. Its logs are in `/aws/lambda/LiveEarth`, kept for 14 days. It doesn't retry when it fails, so a CelesTrak outage just leaves the last good file in place until the next day's run. To refresh sooner, run `aws lambda invoke --function-name LiveEarth --cli-read-timeout 660 out.json --profile personal` (at most once every 2 hours, because of CelesTrak's limit).

Earth textures are from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets).
