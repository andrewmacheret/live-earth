// Where to learn more about a satellite: its own Wikipedia article if Wikidata links one,
// otherwise the article for the constellation or program it belongs to.
const PROGRAMS = [
  [/^STARLINK/, 'Starlink'],
  [/^ONEWEB/, 'OneWeb'],
  [/^KUIPER/, 'Project Kuiper'],
  [/^IRIDIUM/, 'Iridium satellite constellation'],
  [/^(FLOCK|SKYSAT|DOVE|SUPERDOVE|PELICAN)/, 'Planet Labs'],
  [/^LEMUR/, 'Spire Global'],
  [/^GLOBALSTAR/, 'Globalstar'],
  [/^ORBCOMM/, 'Orbcomm'],
  [/^QIANFAN/, 'Qianfan'],
  [/^HULIANWANG/, 'Guowang'],
  [/^(NAVSTAR|GPS )/, 'Global Positioning System'],
  [/^(GALILEO|GSAT0)/, 'Galileo (satellite navigation)'],
  [/^BEIDOU/, 'BeiDou'],
  [/GLONASS/, 'GLONASS'],
  [/^YAOGAN/, 'Yaogan']
];

export function articleFor(record, wiki = {}) {
  const own = wiki[record.NORAD_CAT_ID];
  if (own) return { title: own, program: false };
  const match = PROGRAMS.find(([pattern]) => pattern.test(record.OBJECT_NAME));
  return match ? { title: match[1], program: true } : null;
}

export function trackerLinks(noradId) {
  return [
    { label: 'N2YO', href: `https://www.n2yo.com/satellite/?s=${noradId}` },
    { label: 'Heavens-Above', href: `https://www.heavens-above.com/SatInfo.aspx?satid=${noradId}` },
    { label: 'CelesTrak', href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${noradId}` }
  ];
}

const summaries = new Map();

// Wikipedia's summary API allows requests from any site. Results are kept for the session.
export function fetchSummary(title) {
  if (!summaries.has(title)) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
    const request = fetch(url)
      .then(response => (response.ok ? response.json() : null))
      .then(page =>
        page && page.type !== 'disambiguation'
          ? {
              title: page.title,
              description: page.description,
              extract: page.extract,
              image: page.thumbnail?.source,
              url: page.content_urls?.desktop?.page
            }
          : null
      )
      .catch(() => {
        summaries.delete(title);
        return null;
      });
    summaries.set(title, request);
  }
  return summaries.get(title);
}
