import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from './globe/Globe.js';
import { CATEGORIES, categoryFor, fromCompact } from './sats/catalog.js';
import { NOTCHES, SLIDER_MAX, sliderToSpeed, speedLabel, speedToSlider } from './speed.js';

const ISS = 25544;
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
  const [focus, setFocus] = useState(null);

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
        const launches = new Map();
        records.forEach((record, i) => {
          const key = launchOf(record);
          if (key) launches.set(key, [...(launches.get(key) ?? []), i]);
        });
        const indexById = new Map(records.map((record, i) => [record.NORAD_CAT_ID, i]));
        const recent = (data.recent ?? []).map(id => indexById.get(id)).filter(i => i != null);
        setCatalog({ records, counts, launches, recent, generated: data.generated });
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

  const toggleFocus = next => {
    const value = next && focus?.key !== next.key ? next : null;
    setFocus(value);
    globeRef.current.setFocus(value?.indices ?? null);
  };

  const showRecent = () =>
    toggleFocus({ key: 'recent', label: 'launched in the last 30 days', indices: catalog.recent });

  const selectedLaunch = info && launchOf(catalog?.records[info.index]);
  const showLaunch = () =>
    toggleFocus({
      key: `launch ${selectedLaunch}`,
      label: `from launch ${selectedLaunch}`,
      indices: catalog.launches.get(selectedLaunch)
    });

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
          {catalog.recent.length > 0 && (
            <button className="recent" onClick={showRecent} aria-pressed={focus?.key === 'recent'}>
              <span className="swatch" />
              Launched in the last 30 days
              <span className="count">{number.format(catalog.recent.length)}</span>
            </button>
          )}
          <p className="hint">Dim dots are in Earth's shadow. Drag to spin, scroll to zoom, click a dot.</p>
        </section>
      )}

      <section className="panel bottom-right clock">
        <div className="time">
          {live ? (
            <span className="badge live">LIVE</span>
          ) : (
            <button className="badge" onClick={goLive}>
              Back to live
            </button>
          )}
          <span className="now">{formatTime(simTime)}</span>
          <span className="offset">{live ? '' : offsetLabel(simTime - Date.now())}</span>
        </div>
        <div className="dial">
          <input
            type="range"
            min={-SLIDER_MAX}
            max={SLIDER_MAX}
            step={1}
            value={speedToSlider(speed)}
            onChange={event => changeSpeed(sliderToSpeed(Number(event.target.value)))}
            aria-label="Playback speed"
            aria-valuetext={speedLabel(speed)}
          />
          <div className="notches">
            {NOTCHES.map(notch => (
              <button
                key={notch.value}
                style={{ '--at': (notch.value + SLIDER_MAX) / (2 * SLIDER_MAX) }}
                className={speedToSlider(speed) === notch.value ? 'on' : ''}
                onClick={() => changeSpeed(sliderToSpeed(notch.value))}
              >
                {notch.label}
              </button>
            ))}
          </div>
        </div>
        <p className="speed-label">{speedLabel(speed)}</p>
      </section>

      {focus && (
        <div className="panel focus-bar" role="status">
          Highlighting {number.format(focus.indices.length)} satellites {focus.label}
          <button onClick={() => toggleFocus(null)}>Show all</button>
        </div>
      )}

      {info && (
        <InfoPanel
          info={info}
          launchSize={catalog?.launches.get(selectedLaunch)?.length ?? 0}
          showingLaunch={focus?.key === `launch ${selectedLaunch}`}
          onShowLaunch={showLaunch}
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

function InfoPanel({ info, launchSize, showingLaunch, onShowLaunch, onFollow, onClose }) {
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
      <div className="actions">
        <button className="follow" onClick={onFollow}>
          {info.following ? 'Stop riding along' : 'Ride along'}
        </button>
        {launchSize > 1 && (
          <button className="follow" onClick={onShowLaunch} aria-pressed={showingLaunch}>
            {showingLaunch ? 'Show all' : `Its launch (${launchSize})`}
          </button>
        )}
      </div>
    </aside>
  );
}

// "2026-256A" was the first object from the 256th launch of 2026
function launchOf(record) {
  return record && /^\d{4}-\d{3}/.exec(record.OBJECT_ID)?.[0];
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
  if (Math.abs(ms) < 60000) return `${sign}${Math.round(Math.abs(ms) / 1000)} s`;
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
