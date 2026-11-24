import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from './globe/Globe.js';
import { articleFor, fetchSummary, trackerLinks } from './sats/about.js';
import { CATEGORIES, categoryFor, fromCompact } from './sats/catalog.js';
import { loadFavorites, saveFavorites, toggleFavorite } from './favorites.js';
import { fromCompactPlanes } from './planes/compact.js';
import { NOTCHES, SLIDER_MAX, sliderToSpeed, speedLabel, speedToSlider } from './speed.js';

const ISS = 25544;
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const number = new Intl.NumberFormat();
// checking costs almost nothing when the file hasn't changed, since the browser asks "has it changed?"
const PLANES_CHECK_MS = 60000;

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
  const [favorites, setFavorites] = useState(loadFavorites);
  useEffect(() => saveFavorites(favorites), [favorites]);
  const [planes, setPlanes] = useState(null);
  // on phones the info panel covers most of the screen, so closing it shrinks it to a bar instead
  const narrow = useMediaQuery('(max-width: 720px)');
  const [collapsed, setCollapsed] = useState(false);
  const tapEmptyRef = useRef(null);

  useEffect(() => {
    const globe = new Globe(containerRef.current, {
      onHover: setHover,
      onInfo: setInfo,
      onTapEmpty: () => tapEmptyRef.current?.()
    });
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
        const wiki = data.wiki ?? {};
        // grouped by category, so "Surprise me" isn't mostly TV satellites
        const withArticles = {};
        records.forEach((record, i) => {
          if (wiki[record.NORAD_CAT_ID]) (withArticles[categories[i]] ??= []).push(i);
        });
        setCatalog({ records, counts, launches, recent, wiki, withArticles, indexById, generated: data.generated });
        const params = new URLSearchParams(location.search);
        const wanted = Number(params.get('sat'));
        let start = records.findIndex(r => r.NORAD_CAT_ID === wanted);
        // a link to a plane opens on that plane once the planes load
        if (start < 0 && !params.get('plane')) start = records.findIndex(r => r.NORAD_CAT_ID === ISS);
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

  // planes load after the satellites, so the globe shows up first. A missing file means no planes.
  useEffect(() => {
    if (!catalog) return;
    let stopped = false;
    let timer;
    let lastGenerated = null;
    let first = true;
    const load = async () => {
      try {
        if (!document.hidden) {
          const response = await fetch('data/planes.json', { cache: 'no-cache' });
          // no planes file at all, so stop asking
          if (response.status === 404) return;
          const data = response.ok ? await response.json() : null;
          if (data && data.generated !== lastGenerated && !stopped) {
            lastGenerated = data.generated;
            const list = fromCompactPlanes(data);
            globeRef.current.setPlanes(list, data.time * 1000);
            setPlanes({ list, generated: data.generated });
            const wanted = first && new URLSearchParams(location.search).get('plane');
            if (wanted && list.some(plane => plane.icao === wanted)) {
              globeRef.current.selectPlane(wanted);
              globeRef.current.facePlane();
            }
            first = false;
          }
        }
      } catch {
        // try again next time
      }
      if (!stopped) timer = setTimeout(load, PLANES_CHECK_MS);
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [catalog]);

  const isPlane = info?.type === 'plane';
  const selectionKey = info ? (isPlane ? `plane ${info.icao}` : `sat ${info.noradId}`) : null;
  // open the full panel again whenever something new is picked
  useEffect(() => setCollapsed(false), [selectionKey]);
  const showBar = narrow && collapsed && !!info;
  const closePanel = () => {
    if (narrow) setCollapsed(true);
    else deselect();
  };
  const deselect = () => {
    if (isPlane) globeRef.current.selectPlane(null);
    else globeRef.current.select(-1);
  };
  // tapping empty space on a phone shrinks the panel first, then deselects on the next tap
  tapEmptyRef.current = () => {
    if (!narrow || !info || collapsed) return false;
    setCollapsed(true);
    return true;
  };
  const selectedRecord = info && !isPlane ? catalog?.records[info.index] : null;
  const article = useMemo(() => selectedRecord && articleFor(selectedRecord, catalog.wiki), [selectedRecord, catalog]);
  // undefined while loading, null when Wikipedia has nothing
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    setSummary(article ? undefined : null);
    if (!article) return;
    let current = true;
    fetchSummary(article.title).then(result => current && setSummary(result));
    return () => {
      current = false;
    };
  }, [article]);

  const pickAndFace = index => {
    globeRef.current.select(index);
    globeRef.current.faceSelected();
  };

  const pickPlane = icao => {
    if (hidden.has('planes')) toggleCategory('planes');
    globeRef.current.selectPlane(icao);
    globeRef.current.facePlane();
  };

  const randomItem = list => list[Math.floor(Math.random() * list.length)];
  const surprise = () => {
    const groups = Object.values(catalog.withArticles);
    for (let tries = 0; tries < 5; tries++) {
      const index = randomItem(randomItem(groups));
      if (index !== info?.index) return pickAndFace(index);
    }
  };

  // put the selected satellite in the address bar so links open on it (the ISS is the default)
  const selectedId = info?.noradId;
  const selectedPlane = info?.icao;
  useEffect(() => {
    if (!catalog) return;
    const url = new URL(location.href);
    if (selectedId && selectedId !== ISS) url.searchParams.set('sat', selectedId);
    else url.searchParams.delete('sat');
    if (selectedPlane) url.searchParams.set('plane', selectedPlane);
    // keep a plane from the link until the planes have loaded
    else if (planes) url.searchParams.delete('plane');
    if (url.href !== location.href) history.replaceState(null, '', url);
  }, [selectedId, selectedPlane, catalog, planes]);

  const changeSpeed = value => {
    const globe = globeRef.current;
    globe.setClock({ simStart: globe.simNow(), speed: value });
    setSpeed(value);
  };

  const goLive = () => {
    globeRef.current.setClock({ simStart: Date.now(), speed: 1 });
    setSpeed(1);
  };

  const applyHidden = next => {
    setHidden(next);
    globeRef.current.setHidden(next);
  };

  const toggleCategory = id => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyHidden(next);
  };

  const toggleAll = () => applyHidden(hidden.size ? new Set() : new Set([...CATEGORIES.map(c => c.id), 'planes']));

  const applyFocus = value => {
    setFocus(value);
    globeRef.current.setFocus(value?.indices ?? null);
    globeRef.current.setGroupOrbits(value?.key === 'favorites' ? value.indices : null);
  };

  const toggleFocus = next => applyFocus(next && focus?.key !== next.key ? next : null);

  // favorites saved earlier may include satellites that aren't in today's data
  const favoriteIndices = useMemo(
    () => (catalog ? favorites.map(id => catalog.indexById.get(id)).filter(i => i != null) : []),
    [favorites, catalog]
  );
  const favoritesFocus = indices => ({ key: 'favorites', label: 'from your favorites', indices });
  const showFavorites = () => toggleFocus(favoritesFocus(favoriteIndices));

  // keep the highlight in step when you star or unstar while looking at favorites
  useEffect(() => {
    if (focus?.key !== 'favorites') return;
    applyFocus(favoriteIndices.length ? favoritesFocus(favoriteIndices) : null);
  }, [favoriteIndices]);

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
  const planesNearLive = Math.abs(simTime - Date.now()) < 5 * 60000;

  return (
    <>
      <div className="globe" ref={containerRef} />

      <header className="panel top-left">
        <div className="title-row">
          <a className="home" href="https://andrewmacheret.com/">
            <img src="https://andrewmacheret.com/favicon.svg" alt="andrewmacheret.com" width="20" height="20" />
          </a>
          <span className="slash" aria-hidden="true">/</span>
          <h1>Live Earth</h1>
        </div>
        <p className="subtitle">
          {catalog
            ? `${number.format(catalog.records.length)} satellites${
                planes ? ` and ${number.format(planes.list.length)} planes` : ''
              }, where they are right now`
            : error || 'Loading satellites…'}
        </p>
        {catalog && (
          <div className="search-row">
            <Search
              records={catalog.records}
              wiki={catalog.wiki}
              favorites={favoriteIndices}
              planes={planes?.list ?? []}
              onPick={pickAndFace}
              onPickPlane={pickPlane}
            />
            {Object.keys(catalog.withArticles).length > 0 && (
              <button className="surprise" onClick={surprise} title="Jump to a random satellite that has a Wikipedia article">
                Surprise me
              </button>
            )}
          </div>
        )}
      </header>

      {catalog && (
        <section className="panel bottom-left legend">
          <div className="legend-head">
            <span>Categories</span>
            <button onClick={toggleAll}>{hidden.size ? 'Show all' : 'Hide all'}</button>
          </div>
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
          {planes && (
            <button
              className={`planes-row ${hidden.has('planes') ? 'off' : ''}`}
              onClick={() => toggleCategory('planes')}
              aria-pressed={!hidden.has('planes')}
              title={planesNearLive ? undefined : 'Planes only fly in straight lines, so they only show near the live time'}
            >
              <span className="plane-icon" aria-hidden="true">
                ✈
              </span>
              Planes
              <span className="count">{planesNearLive ? number.format(planes.list.length) : 'live only'}</span>
            </button>
          )}
          {favoriteIndices.length > 0 && (
            <button className="recent" onClick={showFavorites} aria-pressed={focus?.key === 'favorites'}>
              <span className="star">★</span>
              Favorites
              <span className="count">{number.format(favoriteIndices.length)}</span>
            </button>
          )}
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
          <span className="now">
            <span className="weekday">{formatWeekday(simTime)}, </span>
            {formatTime(simTime)}
          </span>
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

      {showBar && <SelectionBar info={info} onExpand={() => setCollapsed(false)} onClose={deselect} />}

      {isPlane && !showBar && <PlanePanel info={info} onClose={closePanel} />}

      {info && !isPlane && !showBar && (
        <InfoPanel
          info={info}
          article={article}
          summary={summary}
          favorite={favorites.includes(info.noradId)}
          onFavorite={() => setFavorites(ids => toggleFavorite(ids, info.noradId))}
          launchSize={catalog?.launches.get(selectedLaunch)?.length ?? 0}
          showingLaunch={focus?.key === `launch ${selectedLaunch}`}
          onShowLaunch={showLaunch}
          onFollow={() => globeRef.current.setFollow(!info.following)}
          onClose={closePanel}
        />
      )}

      {hover && (
        <div className="hover-label" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.name}
        </div>
      )}

      <footer className="credits">
        <a href="https://andrewmacheret.com/">More projects</a> · Orbits from <a href="https://celestrak.org/">CelesTrak</a>
        {catalog && `, updated ${ageLabel(catalog.generated)}`}
        {planes && (
          <>
            {' '}
            · Planes from <a href="https://opensky-network.org/">OpenSky Network</a>, updated {ageLabel(planes.generated)}
          </>
        )}{' '}
        · Earth textures from{' '}
        <a href="https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets">three.js</a> ·{' '}
        <a href="https://github.com/andrewmacheret/live-earth">Source</a>
      </footer>
    </>
  );
}

function Search({ records, wiki, favorites, planes, onPick, onPickPlane }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const out = [];
    for (let i = 0; i < records.length && out.length < 50; i++) {
      const { OBJECT_NAME: name, NORAD_CAT_ID: id } = records[i];
      // the Wikipedia title helps when the catalog name is short, like HST for Hubble
      const title = wiki[id]?.toUpperCase() ?? '';
      if (name.includes(q) || title.includes(q) || String(id) === q) {
        const starts = name.startsWith(q) || title.startsWith(q) || String(id) === q;
        out.push({ rank: starts ? 0 : 1, type: 'sat', index: i });
      }
    }
    // planes only match from the start, since callsigns are short codes like UAL927
    for (let i = 0, found = 0; i < planes.length && found < 50; i++) {
      const { callsign, icao } = planes[i];
      if (callsign.startsWith(q) || icao.toUpperCase() === q) {
        out.push({ rank: 0, type: 'plane', index: i });
        found++;
      }
    }
    // names that start with what you typed go first
    return out.sort((a, b) => a.rank - b.rank).slice(0, 8);
  }, [query, records, wiki, planes]);

  // with nothing typed, show your favorites instead
  const showingFavorites = !query.trim() && favorites.length > 0;
  const list = showingFavorites ? favorites.map(index => ({ type: 'sat', index })) : matches;

  const pick = item => {
    if (item.type === 'plane') onPickPlane(planes[item.index].icao);
    else onPick(item.index);
    setQuery('');
    inputRef.current.blur();
  };

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={planes.length ? 'Find a satellite or flight: ISS, Hubble, UAL…' : 'Find a satellite: ISS, Hubble, STARLINK-1008…'}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={event => {
          if (event.key === 'Enter' && list.length) pick(list[0]);
          if (event.key === 'Escape') inputRef.current.blur();
        }}
        aria-label={planes.length ? 'Find a satellite or flight' : 'Find a satellite'}
      />
      {open && list.length > 0 && (
        // keep the input focused while clicking, so the list doesn't close first
        <ul onMouseDown={event => event.preventDefault()}>
          {showingFavorites && <li className="list-title">★ Favorites</li>}
          {list.map(item =>
            item.type === 'plane' ? (
              <li key={`plane ${item.index}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="plane-icon" aria-hidden="true">
                      ✈{' '}
                    </span>
                    {planes[item.index].callsign || planes[item.index].icao.toUpperCase()}
                    <span className="also"> {planes[item.index].country}</span>
                  </span>
                  <span className="count">{planes[item.index].icao.toUpperCase()}</span>
                </button>
              </li>
            ) : (
              <li key={item.index}>
                <button onClick={() => pick(item)}>
                  <span>
                    {records[item.index].OBJECT_NAME}
                    {otherName(records[item.index], wiki) && (
                      <span className="also"> {otherName(records[item.index], wiki)}</span>
                    )}
                  </span>
                  <span className="count">{records[item.index].NORAD_CAT_ID}</span>
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

// the Wikipedia title, when it says more than the catalog name
function otherName(record, wiki) {
  const title = wiki[record.NORAD_CAT_ID];
  const plain = text => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return title && plain(title) !== plain(record.OBJECT_NAME) ? title : null;
}

function InfoPanel(props) {
  const { info, article, summary, favorite, onFavorite, launchSize, showingLaunch, onShowLaunch, onFollow, onClose } =
    props;
  const category = CATEGORY_BY_ID[info.category];
  return (
    <aside className="panel top-right info">
      <button
        className={favorite ? 'favorite on' : 'favorite'}
        onClick={onFavorite}
        aria-pressed={favorite}
        aria-label="Favorite"
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {favorite ? '★' : '☆'}
      </button>
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
      <About article={article} summary={summary} noradId={info.noradId} />
    </aside>
  );
}

// the shrunken info panel on phones. The selection and Ride along keep going underneath
function SelectionBar({ info, onExpand, onClose }) {
  const isPlane = info.type === 'plane';
  const category = isPlane ? null : CATEGORY_BY_ID[info.category];
  const name = isPlane ? info.callsign || info.icao.toUpperCase() : info.name;
  return (
    <aside className="panel top-right selection-bar">
      <button className="expand" onClick={onExpand} aria-expanded="false" aria-label={`Show details for ${name}`}>
        <span className="kind" style={{ color: category?.color ?? '#fff' }}>
          {isPlane ? (info.kind ?? 'Plane') : category.label}
          {info.following && <span className="muted"> · riding along</span>}
        </span>
        <span className="name">{name}</span>
      </button>
      <button className="close" onClick={onClose} aria-label="Deselect" title="Deselect">
        ×
      </button>
    </aside>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function PlanePanel({ info, onClose }) {
  const name = info.callsign || info.icao.toUpperCase();
  const feetPerMin = Math.round((info.climb * 196.85) / 100) * 100;
  const links = [
    info.callsign && { label: 'FlightAware', href: `https://www.flightaware.com/live/flight/${info.callsign}` },
    { label: 'ADS-B Exchange', href: `https://globe.adsbexchange.com/?icao=${info.icao}` },
    { label: 'adsb.lol', href: `https://adsb.lol/?icao=${info.icao}` }
  ].filter(Boolean);
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind plane-kind">{info.kind ?? 'Plane'}</div>
      <h2>{name}</h2>
      <p className="ids">
        ICAO {info.icao.toUpperCase()} · registered in {info.country}
      </p>
      {info.shown ? (
        <dl>
          <dt>Altitude</dt>
          <dd>
            {number.format(Math.round((info.altitude * 3.28084) / 100) * 100)} ft{' '}
            <span className="muted">({(info.altitude / 1000).toFixed(1)} km)</span>
          </dd>
          <dt>Speed</dt>
          <dd>
            {number.format(Math.round(info.speed * 1.94384))} knots{' '}
            <span className="muted">({number.format(Math.round(info.speed * 3.6))} km/h)</span>
          </dd>
          <dt>Heading</dt>
          <dd>
            {Math.round(info.track)}° {compass(info.track)}
          </dd>
          <dt>Climb</dt>
          <dd>
            {Math.abs(feetPerMin) < 200
              ? 'Level'
              : `${feetPerMin > 0 ? 'Climbing' : 'Descending'} ${number.format(Math.abs(feetPerMin))} ft/min`}
          </dd>
          <dt>Over</dt>
          <dd>{formatLatLon(info.lat, info.lon)}</dd>
          <dt>Last heard</dt>
          <dd>{ageLabel(new Date(info.at).toISOString())}</dd>
        </dl>
      ) : (
        <p>Planes only fly in straight lines here, so they only show near the live time.</p>
      )}
      <section className="about">
        <p className="about-links">
          {links.map(link => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </p>
      </section>
    </aside>
  );
}

function compass(degrees) {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][
    Math.round(degrees / 45) % 8
  ];
}

function About({ article, summary, noradId }) {
  return (
    <section className="about">
      {summary === undefined && <p className="muted">Looking it up on Wikipedia…</p>}
      {summary && (
        <>
          {article.program && <div className="about-kind">Part of {summary.title}</div>}
          <div className="about-body">
            {summary.image && <img src={summary.image} alt="" />}
            <div>
              {summary.description && <p className="about-description">{summary.description}</p>}
              <p className="about-extract">{summary.extract}</p>
            </div>
          </div>
        </>
      )}
      <p className="about-links">
        {summary?.url && <a href={summary.url} target="_blank" rel="noreferrer">Wikipedia</a>}
        {trackerLinks(noradId).map(link => (
          <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        ))}
      </p>
    </section>
  );
}

// "2026-256A" was the first object from the 256th launch of 2026
function launchOf(record) {
  return record && /^\d{4}-\d{3}/.exec(record.OBJECT_ID)?.[0];
}

function formatWeekday(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short' });
}

function formatTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
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
  return `${sign}${(hours / 24).toFixed(1)} d`;
}

function ageLabel(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  const hours = seconds / 3600;
  if (hours < 48) return `${Math.floor(hours)} h ${Math.floor((seconds % 3600) / 60)} min ago`;
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
