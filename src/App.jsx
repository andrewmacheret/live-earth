import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from './globe/Globe.js';
import { CATEGORIES, categoryFor, fromCompact } from './sats/catalog.js';

const ISS = 25544;
const SPEEDS = [
  { value: 0, label: 'Pause' },
  { value: 1, label: 'Live' },
  { value: 60, label: '1 min/s' },
  { value: 600, label: '10 min/s' },
  { value: 3600, label: '1 hr/s' }
];
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const number = new Intl.NumberFormat();

export default function App() {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [hover, setHover] = useState(null);
  const [info, setInfo] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [simTime, setSimTime] = useState(Date.now());
  const [hidden, setHidden] = useState(() => new Set());

  useEffect(() => {
    const globe = new Globe(containerRef.current, { onHover: setHover, onInfo: setInfo });
    globeRef.current = globe;
    if (import.meta.env.DEV) window.globe = globe;
    let cancelled = false;
    fetch('data/satellites.json')
      .then(response => {
        if (!response.ok) throw new Error(`Couldn't load satellite data (HTTP ${response.status})`);
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        const records = fromCompact(data);
        const categories = records.map(record => categoryFor(record, data.groups));
        globe.setData(records, categories);
        const counts = {};
        for (const category of categories) counts[category] = (counts[category] || 0) + 1;
        setCatalog({ records, counts, generated: data.generated });
        const wanted = Number(new URLSearchParams(location.search).get('sat'));
        let start = records.findIndex(r => r.NORAD_CAT_ID === wanted);
        if (start < 0) start = records.findIndex(r => r.NORAD_CAT_ID === ISS);
        if (start >= 0) {
          globe.select(start);
          globe.faceSelected(false);
        }
      })
      .catch(err => !cancelled && setError(err.message));

    const timer = setInterval(() => setSimTime(globe.simNow()), 250);
    const onKey = event => {
      if (event.key === 'Escape') globe.select(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      globe.dispose();
    };
  }, []);

  // put the selected satellite in the address bar so links open on it (the ISS is the default)
  const selectedId = info?.noradId;
  useEffect(() => {
    if (!catalog) return;
    const url = new URL(location.href);
    if (selectedId && selectedId !== ISS) url.searchParams.set('sat', selectedId);
    else url.searchParams.delete('sat');
    if (url.href !== location.href) history.replaceState(null, '', url);
  }, [selectedId, catalog]);

  const changeSpeed = value => {
    const globe = globeRef.current;
    globe.setClock({ simStart: globe.simNow(), speed: value });
    setSpeed(value);
  };

  const goLive = () => {
    globeRef.current.setClock({ simStart: Date.now(), speed: 1 });
    setSpeed(1);
  };

  const toggleCategory = id => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    globeRef.current.setHidden(next);
  };

  const live = speed === 1 && Math.abs(simTime - Date.now()) < 3000;

  return (
    <>
      <div className="globe" ref={containerRef} />

      <header className="panel top-left">
        <h1>Live Earth</h1>
        <p className="subtitle">
          {catalog
            ? `${number.format(catalog.records.length)} satellites, where they are right now`
            : error || 'Loading satellites…'}
        </p>
        {catalog && (
          <Search
            records={catalog.records}
            onPick={index => {
              globeRef.current.select(index);
              globeRef.current.faceSelected();
            }}
          />
        )}
      </header>

      {catalog && (
        <section className="panel bottom-left legend">
          {CATEGORIES.filter(c => catalog.counts[c.id]).map(c => (
            <button
              key={c.id}
              className={hidden.has(c.id) ? 'off' : ''}
              onClick={() => toggleCategory(c.id)}
              aria-pressed={!hidden.has(c.id)}
            >
              <span className="swatch" style={{ background: c.color }} />
              {c.label}
              <span className="count">{number.format(catalog.counts[c.id])}</span>
            </button>
          ))}
          <p className="hint">Dim dots are in Earth's shadow. Drag to spin, scroll to zoom, click a dot.</p>
        </section>
      )}

      <section className="panel bottom-right clock">
        <div className="time">
          <span className={live ? 'badge live' : 'badge'}>{live ? 'LIVE' : offsetLabel(simTime - Date.now())}</span>
          {formatTime(simTime)}
        </div>
        <div className="speeds">
          {SPEEDS.map(s => (
            <button key={s.value} className={speed === s.value ? 'on' : ''} onClick={() => changeSpeed(s.value)}>
              {s.label}
            </button>
          ))}
          {!live && <button onClick={goLive}>Back to now</button>}
        </div>
      </section>

      {info && (
        <InfoPanel
          info={info}
          onFollow={() => globeRef.current.setFollow(!info.following)}
          onClose={() => globeRef.current.select(-1)}
        />
      )}

      {hover && (
        <div className="hover-label" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.name}
        </div>
      )}

      <footer className="credits">
        Orbits from <a href="https://celestrak.org/">CelesTrak</a>
        {catalog && `, updated ${ageLabel(catalog.generated)}`} · Earth textures from{' '}
        <a href="https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets">three.js</a> ·{' '}
        <a href="https://github.com/andrewmacheret/live-earth">Source</a>
      </footer>
    </>
  );
}

function Search({ records, onPick }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const out = [];
    for (let i = 0; i < records.length && out.length < 8; i++) {
      if (records[i].OBJECT_NAME.includes(q) || String(records[i].NORAD_CAT_ID) === q) out.push(i);
    }
    return out;
  }, [query, records]);

  return (
    <div className="search">
      <input
        type="search"
        value={query}
        placeholder="Find a satellite: ISS, Hubble, STARLINK-1008…"
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && matches.length) {
            onPick(matches[0]);
            setQuery('');
          }
        }}
        aria-label="Find a satellite"
      />
      {matches.length > 0 && (
        <ul>
          {matches.map(i => (
            <li key={i}>
              <button
                onClick={() => {
                  onPick(i);
                  setQuery('');
                }}
              >
                {records[i].OBJECT_NAME}
                <span className="count">{records[i].NORAD_CAT_ID}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InfoPanel({ info, onFollow, onClose }) {
  const category = CATEGORY_BY_ID[info.category];
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: category.color }}>
        {category.label}
      </div>
      <h2>{info.name}</h2>
      <p className="ids">
        NORAD {info.noradId}
        {info.launchYear && ` · launched ${info.launchYear}`}
      </p>
      {info.lost ? (
        <p>Its orbit data is too old to say where it is now.</p>
      ) : (
        <dl>
          <dt>Altitude</dt>
          <dd>{number.format(Math.round(info.altitude))} km</dd>
          <dt>Speed</dt>
          <dd>
            {info.speed.toFixed(2)} km/s <span className="muted">({number.format(Math.round(info.speed * 3600))} km/h)</span>
          </dd>
          <dt>Over</dt>
          <dd>{formatLatLon(info.lat, info.lon)}</dd>
          <dt>Orbit</dt>
          <dd>
            every {formatPeriod(info.periodMin)}, tilted {info.inclination.toFixed(1)}°
          </dd>
          <dt>Sunlight</dt>
          <dd>{info.lit == null ? '…' : info.lit > 0.5 ? 'In sunlight' : "In Earth's shadow"}</dd>
        </dl>
      )}
      <button className="follow" onClick={onFollow}>
        {info.following ? 'Stop riding along' : 'Ride along'}
      </button>
    </aside>
  );
}

function formatTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}

function offsetLabel(ms) {
  const sign = ms < 0 ? '−' : '+';
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 60) return `${sign}${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${sign}${hours.toFixed(1)} h`;
  return `${sign}${(hours / 24).toFixed(1)} days`;
}

function ageLabel(iso) {
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours < 1) return 'within the hour';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function formatPeriod(minutes) {
  if (minutes < 120) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}
