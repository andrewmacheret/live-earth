// Finds the English Wikipedia article for every satellite Wikidata knows by NORAD number (P377).
const ENDPOINT = 'https://query.wikidata.org/sparql';
const QUERY = `SELECT ?norad ?title WHERE {
  ?item wdt:P377 ?norad .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
}`;

// Returns { [noradId]: articleTitle }. Wikidata writes some ids with leading zeros, like "00005".
export async function downloadWikiTitles({ timeoutMs = 60_000 } = {}) {
  const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(QUERY)}`, {
    headers: {
      Accept: 'application/sparql-results+json',
      // Wikimedia asks every client to say who it is
      'User-Agent': 'live-earth/1.0 (https://andrewmacheret.com/projects/live-earth/)'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
  const { results } = await response.json();
  const titles = {};
  for (const row of results.bindings) {
    const id = Number(row.norad.value);
    if (id && !titles[id]) titles[id] = row.title.value;
  }
  return titles;
}

// Keeps only satellites in the catalog, so the file stays small.
export function pickTitles(titles, noradIds) {
  const out = {};
  for (const id of noradIds) if (titles[id]) out[id] = titles[id];
  return out;
}
