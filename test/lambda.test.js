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
