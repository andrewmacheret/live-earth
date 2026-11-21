// Orbit data is stored as rows of these fields, in this order, to keep the file small.
// The first 13 are CelesTrak's OMM fields. GROUP is an index into the file's `groups` list.
export const FIELDS = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'NORAD_CAT_ID',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
  'GROUP'
];

const TEXT_FIELDS = new Set(['OBJECT_NAME', 'OBJECT_ID', 'EPOCH']);

export const CATEGORIES = [
  { id: 'station', label: 'Space stations', color: '#ff5d73' },
  { id: 'starlink', label: 'Starlink', color: '#cfe3ff' },
  { id: 'kuiper', label: 'Amazon Kuiper', color: '#ff9f43' },
  { id: 'oneweb', label: 'OneWeb', color: '#c792ff' },
  { id: 'gnss', label: 'GPS & navigation', color: '#6ee7a8' },
  { id: 'earth', label: 'Weather & Earth imaging', color: '#4dd0e1' },
  { id: 'comms', label: 'Other communications', color: '#ffd166' },
  { id: 'science', label: 'Science', color: '#f78fb3' },
  { id: 'military', label: 'Military', color: '#b0bec5' },
  { id: 'other', label: 'Everything else', color: '#5c8dff' }
];

// Used when the data doesn't say which CelesTrak group a satellite came from.
export function categoryOf(name) {
  if (/^(ISS|CSS) \(/.test(name)) return 'station';
  if (name.startsWith('STARLINK')) return 'starlink';
  if (name.startsWith('KUIPER')) return 'kuiper';
  if (name.startsWith('ONEWEB')) return 'oneweb';
  if (/^(NAVSTAR|GPS |GLONASS|COSMOS 2[45]\d\d|GSAT0|GALILEO|BEIDOU|QZS|IRNSS)/.test(name)) return 'gnss';
  return 'other';
}

export function categoryFor(record, groups = []) {
  return groups[record.GROUP]?.category ?? categoryOf(record.OBJECT_NAME);
}

// Small CSV parser. Handles "quoted" fields in case a satellite name has a comma.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}

function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

// Keeps the first row for each satellite, so put the records you prefer first.
export function toCompact(records, { groups = [], generated = new Date().toISOString() } = {}) {
  const seen = new Set();
  const satellites = [];
  for (const record of records) {
    const id = Number(record.NORAD_CAT_ID);
    if (!record.OBJECT_NAME || !record.EPOCH || seen.has(id)) continue;
    seen.add(id);
    satellites.push(
      FIELDS.map(key => {
        if (key === 'GROUP') return record.GROUP ?? -1;
        return TEXT_FIELDS.has(key) ? String(record[key]) : Number(record[key]);
      })
    );
  }
  return { generated, source: 'CelesTrak', groups, fields: FIELDS, satellites };
}

export function fromCompact(data) {
  return data.satellites.map(row => Object.fromEntries(data.fields.map((key, i) => [key, row[i]])));
}
