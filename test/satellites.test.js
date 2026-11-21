import assert from 'node:assert/strict';
import { test } from 'node:test';
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import { categoryOf, fromCompact, parseCsv, toCompact } from '../src/sats/catalog.js';
import { behindEarth, sunDirection, toScene } from '../src/sats/frames.js';

const CSV = `OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT
ISS (ZARYA),1998-067A,2026-11-20T11:52:34.209696,15.49509114,.00074095,51.6319,246.5768,46.6569,313.5036,0,U,25544,999,59598,.17778047E-3,.9536E-4,0
STARLINK-1008,2019-074B,2026-11-20T11:06:15.038784,15.70848820,.00029928,53.1452,27.3139,16.3107,343.8007,0,U,44714,999,38863,.11194009E-2,.144117E-2,0
"WEIRD, NAME",2000-001A,2026-11-20T00:00:00.000000,1.00270000,.0001,0.05,10,20,30,0,U,99999,999,1,0,0,0
ISS (ZARYA),1998-067A,2026-11-20T11:52:34.209696,15.49509114,.00074095,51.6319,246.5768,46.6569,313.5036,0,U,25544,999,59598,.17778047E-3,.9536E-4,0
`;

test('parses CelesTrak CSV, including quoted names', () => {
  const records = parseCsv(CSV);
  assert.equal(records.length, 4);
  assert.equal(records[0].OBJECT_NAME, 'ISS (ZARYA)');
  assert.equal(records[2].OBJECT_NAME, 'WEIRD, NAME');
  assert.equal(records[2].NORAD_CAT_ID, '99999');
});

test('compact format round trips and drops duplicates', () => {
  const data = JSON.parse(JSON.stringify(toCompact(parseCsv(CSV), { generated: '2026-11-20T12:00:00Z' })));
  assert.equal(data.count, 3);
  const records = fromCompact(data);
  assert.equal(records.length, 3);
  assert.equal(records[0].OBJECT_NAME, 'ISS (ZARYA)');
  assert.equal(records[0].NORAD_CAT_ID, 25544);
  assert.equal(records[0].MEAN_MOTION, 15.49509114);
  assert.equal(records[0].EPOCH, '2026-11-20T11:52:34.209');
  assert.equal(records[1].EPOCH, '2026-11-20T11:06:15.038');
});

test('still reads the older row format', () => {
  const old = {
    fields: ['OBJECT_NAME', 'EPOCH', 'NORAD_CAT_ID'],
    satellites: [['ISS (ZARYA)', '2026-11-20T11:52:34.209696', 25544]]
  };
  assert.deepEqual(fromCompact(old), [
    { OBJECT_NAME: 'ISS (ZARYA)', EPOCH: '2026-11-20T11:52:34.209696', NORAD_CAT_ID: 25544 }
  ]);
});

test('compact records can be propagated', () => {
  const [iss] = fromCompact(toCompact(parseCsv(CSV)));
  const date = new Date('2026-11-20T23:49:15.592Z');
  const { position } = propagate(json2satrec(iss), date);
  const geo = eciToGeodetic(position, gstime(date));
  assert.ok(geo.height > 400 && geo.height < 450, `ISS height ${geo.height}`);
  assert.ok(Math.abs(degreesLat(geo.latitude)) <= 52);
  assert.ok(Math.abs(degreesLong(geo.longitude)) <= 180);
});

test('sorts satellites into categories', () => {
  assert.equal(categoryOf('ISS (ZARYA)'), 'station');
  assert.equal(categoryOf('CSS (TIANHE)'), 'station');
  assert.equal(categoryOf('STARLINK-1008'), 'starlink');
  assert.equal(categoryOf('ONEWEB-0012'), 'oneweb');
  assert.equal(categoryOf('KUIPER-00042'), 'kuiper');
  assert.equal(categoryOf('GPS BIIF-1  (PRN 25)'), 'gnss');
  assert.equal(categoryOf('HST'), 'other');
});

test('scene coordinates put the north pole up and 90°E on -z', () => {
  assert.deepEqual(toScene(0, 0, 1, []), [0, 1, -0]);
  assert.deepEqual(toScene(0, 1, 0, []), [0, 0, -1]);
});

test('sun is below the equator in November and above it in June', () => {
  assert.ok(sunDirection(new Date('2026-11-20T12:00:00Z'))[1] < -0.3);
  assert.ok(sunDirection(new Date('2026-06-21T12:00:00Z'))[1] > 0.38);
});

test('the Earth hides points on its far side', () => {
  const camera = { x: 0, y: 0, z: 4 };
  assert.equal(behindEarth(camera, { x: 0, y: 0, z: -1.1 }), true);
  assert.equal(behindEarth(camera, { x: 0, y: 0, z: 1.1 }), false);
  assert.equal(behindEarth(camera, { x: 2, y: 0, z: -1 }), false);
});
