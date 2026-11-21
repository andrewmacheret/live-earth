// Orbit data is stored as one array per field, which compresses better than rows.
// The first 13 are CelesTrak's OMM fields. GROUP is an index into the file's `groups` list.
// EPOCH is stored as milliseconds from `generated`, since the date strings were the biggest part.
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
  const base = Date.parse(generated);
  const seen = new Set();
  const columns = Object.fromEntries(FIELDS.map(key => [key, []]));
  for (const record of records) {
    const id = Number(record.NORAD_CAT_ID);
    if (!record.OBJECT_NAME || !record.EPOCH || seen.has(id)) continue;
    seen.add(id);
    for (const key of FIELDS) {
      let value;
      if (key === 'GROUP') value = record.GROUP ?? -1;
      else if (key === 'EPOCH') value = Date.parse(withZ(record.EPOCH)) - base;
      else value = TEXT_FIELDS.has(key) ? String(record[key]) : Number(record[key]);
      columns[key].push(value);
    }
  }
  return { generated, source: 'CelesTrak', groups, count: seen.size, columns };
}

export function fromCompact(data) {
  // older files stored one row per satellite
  if (data.satellites) {
    return data.satellites.map(row => Object.fromEntries(data.fields.map((key, i) => [key, row[i]])));
  }
  const base = Date.parse(data.generated);
  const keys = Object.keys(data.columns);
  return Array.from({ length: data.count }, (_, i) => {
    const record = Object.fromEntries(keys.map(key => [key, data.columns[key][i]]));
    record.EPOCH = new Date(base + record.EPOCH).toISOString().slice(0, -1);
    return record;
  });
}

function withZ(date) {
  return date.endsWith('Z') ? date : `${date}Z`;
}
