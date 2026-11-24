import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../lambda/handler.js';
import { categoryFor, fromCompact } from '../src/sats/catalog.js';
import { GROUPS, NotUpdated } from '../src/sats/celestrak.js';
import { refreshCatalog } from '../src/sats/refresh.js';

function fakeRecords(prefix, count, firstId) {
  return Array.from({ length: count }, (_, i) => ({
    OBJECT_NAME: `${prefix}-${i}`,
    OBJECT_ID: '2020-001A',
    EPOCH: '2026-11-20T11:06:15.038784',
    MEAN_MOTION: '15.7',
    ECCENTRICITY: '.0001',
    INCLINATION: '53',
    RA_OF_ASC_NODE: '27',
    ARG_OF_PERICENTER: '16',
    MEAN_ANOMALY: '343',
    NORAD_CAT_ID: String(firstId + i),
    BSTAR: '.001',
    MEAN_MOTION_DOT: '.0001',
    MEAN_MOTION_DDOT: '0'
  }));
}

// every group gets 50 satellites with its own ids, and starlink gets 1500
const fakeCelesTrak = async group => {
  const i = GROUPS.findIndex(([name]) => name === group);
  return group === 'starlink' ? fakeRecords('STARLINK', 1500, 100000) : fakeRecords(group, 50, 1000 + i * 100);
};
const quiet = () => {};

test('downloads every group and tags each satellite with its category', async () => {
  const { data, fresh, failed } = await refreshCatalog({ download: fakeCelesTrak, log: quiet });
  assert.equal(fresh, GROUPS.length);
  assert.deepEqual(failed, []);
  const records = fromCompact(data);
  assert.equal(records.length, 1500 + 50 * (GROUPS.length - 1));
  const iss = records.find(r => r.OBJECT_NAME === 'stations-0');
  assert.equal(categoryFor(iss, data.groups), 'station');
  const starlink = records.find(r => r.OBJECT_NAME === 'STARLINK-0');
  assert.equal(categoryFor(starlink, data.groups), 'starlink');
});

test('a satellite in two groups keeps the first group', async () => {
  const download = async group => (group === 'last-30-days' ? fakeRecords('STARLINK', 5, 100000) : fakeCelesTrak(group));
  const { data } = await refreshCatalog({ download, log: quiet });
  const records = fromCompact(data).filter(r => r.NORAD_CAT_ID === 100000);
  assert.equal(records.length, 1);
  assert.equal(categoryFor(records[0], data.groups), 'starlink');
});

test('lists new launches, and keeps the old list if that group fails', async () => {
  const download = async group => (group === 'last-30-days' ? fakeRecords('STARLINK', 5, 100000) : fakeCelesTrak(group));
  const before = (await refreshCatalog({ download, log: quiet })).data;
  assert.deepEqual(before.recent, [100000, 100001, 100002, 100003, 100004]);
  const failing = async group => {
    if (group === 'last-30-days') throw new Error('last-30-days: CelesTrak answered 500');
    return fakeCelesTrak(group);
  };
  const { data } = await refreshCatalog({ previous: before, download: failing, log: quiet });
  assert.deepEqual(data.recent, before.recent);
});

test('a failed group keeps its rows from the previous file', async () => {
  const before = (await refreshCatalog({ download: fakeCelesTrak, log: quiet, now: new Date('2026-11-20T00:00:00Z') })).data;
  const download = async group => {
    if (group === 'starlink') throw new Error('starlink: failed after 300 kB');
    if (group === 'gnss') throw new NotUpdated('gnss: not updated yet');
    return fakeCelesTrak(group);
  };
  const { data, failed } = await refreshCatalog({ previous: before, download, log: quiet });
  assert.deepEqual(failed, ['starlink', 'gnss']);
  const starlinks = fromCompact(data).filter(r => categoryFor(r, data.groups) === 'starlink');
  assert.equal(starlinks.length, 1500);
  assert.equal(data.groups.find(g => g.name === 'starlink').fetched, '2026-11-20T00:00:00.000Z');
});

test('the Lambda saves the merged catalog', async () => {
  let saved;
  const handler = createHandler({
    download: fakeCelesTrak,
    loadPrevious: async () => {
      throw new Error('NoSuchKey');
    },
    save: async body => (saved = body),
    log: quiet
  });
  const result = await handler();
  assert.equal(result.fresh, GROUPS.length);
  assert.equal(JSON.parse(saved).count, result.satellites);
});

test('the Lambda adds Wikipedia links, and keeps the old ones if Wikidata fails', async () => {
  let saved;
  const save = async body => (saved = JSON.parse(body));
  const options = { download: fakeCelesTrak, save, log: quiet };
  await createHandler({
    ...options,
    downloadWiki: async () => ({ 100000: 'Starlink', 5: 'Vanguard 1' }),
    loadPrevious: async () => null
  })();
  assert.deepEqual(saved.wiki, { 100000: 'Starlink' });
  const previous = saved;
  await createHandler({
    ...options,
    downloadWiki: async () => {
      throw new Error('Wikidata answered 503');
    },
    loadPrevious: async () => previous
  })();
  assert.deepEqual(saved.wiki, { 100000: 'Starlink' });
});

const fakeRocks = async () =>
  Array.from({ length: 1200 }, (_, k) => ({
    full_name: `(2026 A${k})`,
    pdes: `2026 A${k}`,
    kind: 'au',
    class: 'MBA',
    e: '0.1',
    a: '2.5',
    i: '5',
    om: '10',
    w: '20',
    ma: '30',
    epoch: '2461200.5',
    H: '12'
  }));

test('the Lambda saves asteroids and comets, and a JPL problem only gets logged', async () => {
  let rocks;
  const options = { download: fakeCelesTrak, loadPrevious: async () => null, save: async () => {}, log: quiet };
  const result = await createHandler({ ...options, downloadRocks: fakeRocks, saveRocks: async body => (rocks = body) })();
  assert.equal(result.smallBodies, 1200);
  assert.equal(JSON.parse(rocks).count, 1200);

  rocks = undefined;
  const failing = await createHandler({
    ...options,
    downloadRocks: async () => {
      throw new Error('SBDB answered 503');
    },
    saveRocks: async body => (rocks = body)
  })();
  assert.equal(failing.smallBodies, 0);
  assert.equal(failing.fresh, GROUPS.length);
  assert.equal(rocks, undefined);
});

test('the Lambda keeps the old file when every group fails', async () => {
  let saved = false;
  const handler = createHandler({
    download: async group => {
      throw new Error(`${group}: CelesTrak answered 500`);
    },
    loadPrevious: async () => null,
    save: async () => (saved = true),
    log: quiet
  });
  await assert.rejects(handler(), /Every group failed/);
  assert.equal(saved, false);
});
