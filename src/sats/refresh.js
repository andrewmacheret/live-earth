import { fromCompact, toCompact } from './catalog.js';
import { GROUPS, NotUpdated } from './celestrak.js';

// Downloads every group in GROUPS, a few at a time. A group that fails keeps its rows from the
// previous file, so one bad request doesn't throw away the rest.
export async function refreshCatalog({ previous, download, log = console.log, concurrency = 4, now = new Date() }) {
  const old = new Map();
  if (previous?.groups) {
    previous.groups.forEach(group => old.set(group.name, { fetched: group.fetched, records: [] }));
    for (const record of fromCompact(previous)) {
      const group = previous.groups[record.GROUP];
      if (group) old.get(group.name).records.push(record);
    }
  }

  const results = new Array(GROUPS.length);
  let next = 0;
  async function worker() {
    while (next < GROUPS.length) {
      const i = next++;
      const [name] = GROUPS[i];
      try {
        results[i] = { records: await download(name), fetched: now.toISOString(), fresh: true };
      } catch (err) {
        if (!(err instanceof NotUpdated)) log(err.message);
        results[i] = { records: old.get(name)?.records ?? [], fetched: old.get(name)?.fetched ?? null, fresh: false };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const groups = GROUPS.map(([name, category], i) => ({ name, category, fetched: results[i].fetched }));
  const records = results.flatMap((result, i) => result.records.map(record => ({ ...record, GROUP: i })));
  return {
    data: toCompact(records, { groups, generated: now.toISOString() }),
    fresh: results.filter(result => result.fresh).length,
    failed: GROUPS.filter((_, i) => !results[i].fresh).map(([name]) => name)
  };
}
