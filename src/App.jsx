import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from './globe/Globe.js';
import { articleFor, fetchSummary, trackerLinks } from './sats/about.js';
import { CATEGORIES, categoryFor, fromCompact } from './sats/catalog.js';
import { loadFavorites, saveFavorites, toggleFavorite } from './favorites.js';
import { fromCompactPlanes } from './planes/compact.js';
import { BODIES, BODY_BY_ID, nasaLink } from './space/bodies.js';
import { fromCompactBodies, KIND_BY_ID, KINDS, NOTABLE } from './space/smallBodies.js';
import { fromCompactMoons } from './space/moons.js';
import { CRAFT_COLOR, fromCompactSpacecraft } from './space/spacecraft.js';
import { PARENT_BY_ID, peakLabel, SHOWERS } from './space/meteors.js';
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
  // NOAA's aurora forecast, like { peak: 19, observed: Date }
  const [aurora, setAurora] = useState(null);
  // the day of NASA's cloud picture, like '2026-11-23'
  const [cloudDay, setCloudDay] = useState(null);
  // on phones the info panel covers most of the screen, so closing it shrinks it to a bar instead
  const narrow = useMediaQuery('(max-width: 720px)');
  const [collapsed, setCollapsed] = useState(false);
  const tapEmptyRef = useRef(null);
  // the body the camera is centered on, and which Go to button is lit
  const [anchor, setAnchor] = useState('earth');
  const [view, setView] = useState('earth');
  useEffect(() => setView(v => (v === 'system' && anchor === 'sun' ? v : anchor)), [anchor]);
  // moons, asteroids, comets and spacecraft load the first time you zoom out or search
  const [moons, setMoons] = useState(null);
  const [rocks, setRocks] = useState(null);
  const [crafts, setCrafts] = useState(null);
  const loadSpaceRef = useRef(null);
  // the legend shows Earth things near the Earth and space things once you zoom out
  const [legendTab, setLegendTab] = useState('earth');

  useEffect(() => {
    const globe = new Globe(containerRef.current, {
      onHover: setHover,
      onInfo: setInfo,
      onTapEmpty: () => tapEmptyRef.current?.(),
      onAnchor: setAnchor,
      onAurora: setAurora,
      onClouds: setCloudDay,
      onZone: zone => {
        setLegendTab(zone);
        if (zone === 'space') loadSpaceRef.current?.();
      }
    });
    let spaceRequested = false;
    const getJson = url =>
      fetch(url).then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))));
    // a link to a rock or spacecraft opens on it once it loads
    const openLinked = prefix => {
      const wanted = new URLSearchParams(location.search).get('body');
      if (wanted?.startsWith(prefix) && globe.solar.has(wanted)) {
        globe.selectBody(wanted);
        globe.goTo(wanted);
      }
    };
    loadSpaceRef.current = () => {
      if (spaceRequested) return;
      spaceRequested = true;
      getJson('data/small-bodies.json')
        .then(data => {
          if (cancelled) return;
          const records = fromCompactBodies(data);
          globe.setRocks(records);
          const counts = {};
          for (const record of records) counts[record.kind] = (counts[record.kind] || 0) + 1;
          setRocks({ records, counts, generated: data.generated });
          openLinked('rock:');
        })
        // no rocks is fine, the rest still works
        .catch(() => setRocks(rocks => rocks ?? { records: [], counts: {}, failed: true }));
      getJson('data/moons.json')
        .then(data => {
          if (cancelled) return;
          const list = fromCompactMoons(data);
          globe.setMoons(list);
          setMoons({ list, generated: data.generated });
          openLinked('moon:');
        })
        .catch(() => setMoons(moons => moons ?? { list: [], failed: true }));
      getJson('data/spacecraft.json')
        .then(data => {
          if (cancelled) return;
          const list = fromCompactSpacecraft(data);
          globe.setSpacecraft(list);
          setCrafts({ list, generated: data.generated });
          openLinked('craft:');
        })
        .catch(() => setCrafts(crafts => crafts ?? { list: [], failed: true }));
    };
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
        const linked = params.get('body');
        // meteor showers are built in, so like planets they don't wait for anything to load
        const body = BODY_BY_ID[linked]?.id ?? (linked?.startsWith('shower:') && globe.solar.has(linked) ? linked : null);
        let start = records.findIndex(r => r.NORAD_CAT_ID === wanted);
        if (start < 0 && body) {
          globe.selectBody(body);
          if (body !== 'earth') globe.goTo(body);
          return;
        }
        if (start < 0 && /^(rock|craft|moon):/.test(params.get('body'))) return loadSpaceRef.current();
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
  const isRock = info?.type === 'rock';
  const isCraft = info?.type === 'craft';
  const isMoon = info?.type === 'moon';
  const isShower = info?.type === 'shower';
  const bodyId = info?.type === 'body' || isRock || isCraft || isMoon || isShower ? info.id : null;
  const isSat = !!info && !info.type;
  const selectionKey = info ? (isPlane ? `plane ${info.icao}` : bodyId ? `body ${bodyId}` : `sat ${info.noradId}`) : null;
  // open the full panel again whenever something new is picked
  useEffect(() => setCollapsed(false), [selectionKey]);
  const showBar = narrow && collapsed && !!info;
  const closePanel = () => {
    if (narrow) setCollapsed(true);
    else deselect();
  };
  const deselect = () => {
    if (isPlane) globeRef.current.selectPlane(null);
    else if (bodyId) globeRef.current.selectBody(null);
    else globeRef.current.select(-1);
  };
  // tapping empty space on a phone shrinks the panel first, then deselects on the next tap
  tapEmptyRef.current = () => {
    if (!narrow || !info || collapsed) return false;
    setCollapsed(true);
    return true;
  };
  const selectedRecord = isSat ? catalog?.records[info.index] : null;
  const rockArticle = isRock
    ? info.article
    : isCraft
      ? info.craft.article
      : isMoon
        ? info.moon.article
        : isShower
          ? info.shower.article
          : null;
  const article = useMemo(() => {
    if (bodyId) {
      const title = BODY_BY_ID[bodyId]?.article ?? rockArticle;
      return title ? { title, program: false } : null;
    }
    return selectedRecord && articleFor(selectedRecord, catalog.wiki);
  }, [selectedRecord, catalog, bodyId, rockArticle]);
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

  const pickBody = id => {
    globeRef.current.selectBody(id);
    globeRef.current.goTo(id);
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
    if (bodyId) url.searchParams.set('body', bodyId);
    // keep a rock or spacecraft from the link until they've loaded
    else {
      const linked = url.searchParams.get('body') ?? '';
      const waiting =
        (linked.startsWith('rock:') && !rocks) ||
        (linked.startsWith('craft:') && !crafts) ||
        (linked.startsWith('moon:') && !moons);
      if (!waiting) url.searchParams.delete('body');
    }
    if (url.href !== location.href) history.replaceState(null, '', url);
  }, [selectedId, selectedPlane, bodyId, catalog, planes, rocks, crafts, moons]);

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
    globeRef.current.setRocksHidden(new Set(KINDS.filter(kind => next.has(`rock:${kind.id}`)).map(kind => kind.id)));
    globeRef.current.setCraftsHidden(next.has('craft'));
    globeRef.current.setMoonsHidden(next.has('moons'));
    globeRef.current.setShowersHidden(next.has('showers'));
    globeRef.current.setConstellationsHidden(next.has('constellations'));
    globeRef.current.setAuroraHidden(next.has('aurora'));
    globeRef.current.setCloudsHidden(next.has('clouds'));
  };

  const toggleCategory = id => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyHidden(next);
  };

  // Show all and Hide all only change the tab you're looking at
  const tabIds =
    legendTab === 'space'
      ? ['moons', 'craft', 'showers', 'constellations', ...KINDS.map(kind => `rock:${kind.id}`)]
      : [...CATEGORIES.map(c => c.id), 'planes', 'clouds', 'aurora'];
  const tabHidden = tabIds.some(id => hidden.has(id));
  const toggleAll = () => {
    const next = new Set(hidden);
    for (const id of tabIds) {
      if (tabHidden) next.delete(id);
      else next.add(id);
    }
    applyHidden(next);
  };

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
  // the aurora fades out 3 to 6 hours away from NOAA's forecast (see Globe.js)
  const auroraNearLive = aurora && Math.abs(simTime - aurora.observed.getTime()) < 3 * 3600000;

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
              rocks={rocks?.records ?? []}
              crafts={crafts?.list ?? []}
              moons={moons?.list ?? []}
              onPick={pickAndFace}
              onPickPlane={pickPlane}
              onPickBody={pickBody}
              onFocus={() => loadSpaceRef.current?.()}
            />
            {Object.keys(catalog.withArticles).length > 0 && (
              <button className="surprise" onClick={surprise} title="Jump to a random satellite that has a Wikipedia article">
                Surprise me
              </button>
            )}
          </div>
        )}
        <nav className="go-row" aria-label="Go to">
          {['earth', 'moon', 'sun'].map(id => (
            <button
              key={id}
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                if (id === 'earth') globeRef.current.goTo('earth');
                else pickBody(id);
              }}
            >
              <span className="swatch" style={{ background: BODY_BY_ID[id].color, color: BODY_BY_ID[id].color }} />
              {BODY_BY_ID[id].name}
            </button>
          ))}
          <button
            aria-pressed={view === 'system'}
            onClick={() => {
              setView('system');
              globeRef.current.showSolarSystem();
            }}
          >
            <span className="swatch system" aria-hidden="true" />
            Solar system
          </button>
        </nav>
      </header>

      {catalog && (
        <section className="panel bottom-left legend">
          <div className="legend-head">
            <div className="legend-tabs" role="tablist">
              {['earth', 'space'].map(tab => (
                <button key={tab} role="tab" aria-selected={legendTab === tab} onClick={() => setLegendTab(tab)}>
                  {tab === 'earth' ? 'Earth' : 'Space'}
                </button>
              ))}
            </div>
            <button onClick={toggleAll}>{tabHidden ? 'Show all' : 'Hide all'}</button>
          </div>
          {legendTab === 'space' && (
            <>
              {(!rocks || !crafts || !moons) && <p className="hint">Loading moons, asteroids, comets and spacecraft…</p>}
              {moons?.list.length > 0 && (
                <button
                  className={hidden.has('moons') ? 'off' : ''}
                  onClick={() => toggleCategory('moons')}
                  aria-pressed={!hidden.has('moons')}
                >
                  <span className="swatch" style={{ background: '#cfcac0' }} />
                  Moons of other planets
                  <span className="count">{number.format(moons.list.length)}</span>
                </button>
              )}
              {crafts?.list.length > 0 && (
                <button
                  className={hidden.has('craft') ? 'off' : ''}
                  onClick={() => toggleCategory('craft')}
                  aria-pressed={!hidden.has('craft')}
                >
                  <span className="swatch" style={{ background: CRAFT_COLOR }} />
                  Spacecraft
                  <span className="count">{number.format(crafts.list.length)}</span>
                </button>
              )}
              <button
                className={hidden.has('showers') ? 'off' : ''}
                onClick={() => toggleCategory('showers')}
                aria-pressed={!hidden.has('showers')}
              >
                <span className="swatch" style={{ background: PARENT_BY_ID['swift-tuttle'].color }} />
                Meteor showers
                <span className="count">{SHOWERS.length}</span>
              </button>
              <button
                className={hidden.has('constellations') ? 'off' : ''}
                onClick={() => toggleCategory('constellations')}
                aria-pressed={!hidden.has('constellations')}
              >
                <span className="swatch" style={{ background: '#5b7fb5' }} />
                Constellations
                <span className="count">88</span>
              </button>
              {rocks &&
                KINDS.filter(kind => rocks.counts[kind.id]).map(kind => (
                  <button
                    key={kind.id}
                    className={hidden.has(`rock:${kind.id}`) ? 'off' : ''}
                    onClick={() => toggleCategory(`rock:${kind.id}`)}
                    aria-pressed={!hidden.has(`rock:${kind.id}`)}
                  >
                    <span className="swatch" style={{ background: kind.color }} />
                    {kind.plural}
                    <span className="count">{number.format(rocks.counts[kind.id])}</span>
                  </button>
                ))}
              <p className="hint">Drag to spin, scroll to zoom, click a dot to see its path around the Sun.</p>
            </>
          )}
          {legendTab === 'earth' && (
            <>
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
              {cloudDay && (
                <button
                  className={hidden.has('clouds') ? 'off' : ''}
                  onClick={() => toggleCategory('clouds')}
                  aria-pressed={!hidden.has('clouds')}
                  title="Clouds from NASA's picture of the whole Earth, put together from a weather satellite's passes"
                >
                  <span className="swatch" style={{ background: '#e8eef5' }} />
                  Clouds
                  <span className="count">
                    {new Date(`${cloudDay}T12:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                </button>
              )}
              {aurora && (
                <button
                  className={hidden.has('aurora') ? 'off' : ''}
                  onClick={() => toggleCategory('aurora')}
                  aria-pressed={!hidden.has('aurora')}
                  title={`Where the aurora might be overhead tonight, from NOAA's forecast at ${aurora.observed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It only shows on the night side.`}
                >
                  <span className="swatch" style={{ background: '#33ff73' }} />
                  Aurora
                  <span className="count">{auroraNearLive ? `up to ${Math.round(aurora.peak)}%` : 'live only'}</span>
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
              <p className="hint">
                Dim dots are in Earth's shadow. Drag to spin, scroll to zoom, click a dot. Zoom out for the Moon, planets and
                asteroids.
              </p>
            </>
          )}
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
                aria-label={notch.label}
              >
                <span className="long">{notch.label}</span>
                <span className="short">{notch.short}</span>
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

      {isRock && !showBar && (
        <RockPanel
          info={info}
          summary={summary}
          onGo={() => globeRef.current.goTo(info.anchored ? 'earth' : bodyId)}
          onClose={closePanel}
        />
      )}

      {isCraft && !showBar && (
        <CraftPanel
          info={info}
          summary={summary}
          onGo={() => globeRef.current.goTo(info.anchored ? 'earth' : bodyId)}
          onClose={closePanel}
        />
      )}

      {isMoon && !showBar && (
        <MoonPanel
          info={info}
          summary={summary}
          onGo={() => globeRef.current.goTo(info.anchored ? 'earth' : bodyId)}
          onClose={closePanel}
        />
      )}

      {isShower && !showBar && (
        <ShowerPanel
          info={info}
          summary={summary}
          onGo={() => globeRef.current.goTo(info.anchored ? 'earth' : bodyId)}
          onClose={closePanel}
        />
      )}

      {bodyId && !isRock && !isCraft && !isMoon && !isShower && !showBar && (
        <BodyPanel
          info={info}
          summary={summary}
          onGo={() => globeRef.current.goTo(info.anchored ? 'earth' : bodyId)}
          onClose={closePanel}
        />
      )}

      {isSat && !showBar && (
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
        {aurora && (
          <>
            {' '}
            · Aurora from <a href="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast">NOAA</a>
          </>
        )}
        {cloudDay && (
          <>
            {' '}
            · Clouds from <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api">NASA GIBS</a>
          </>
        )}{' '}
        · Positions from <a href="https://github.com/cosinekitty/astronomy">Astronomy Engine</a> · Stars from the{' '}
        <a href="https://github.com/ofrohn/d3-celestial">Yale Bright Star Catalog via d3-celestial</a>
        {rocks?.generated && (
          <>
            {' '}
            · Asteroids and comets from <a href="https://ssd.jpl.nasa.gov/tools/sbdb_query.html">NASA JPL</a>, updated{' '}
            {ageLabel(rocks.generated)}
          </>
        )}
        {(crafts?.generated || moons?.generated) && (
          <>
            {' '}
            · Moons and spacecraft from <a href="https://ssd.jpl.nasa.gov/horizons/">JPL Horizons</a>
          </>
        )}{' '}
        · Earth textures from{' '}
        <a href="https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets">three.js</a>, others from{' '}
        <a href="https://www.solarsystemscope.com/textures/">Solar System Scope</a> (
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>) ·{' '}
        <a href="https://github.com/andrewmacheret/live-earth">Source</a>
      </footer>
    </>
  );
}

function Search({ records, wiki, favorites, planes, rocks, crafts, moons, onPick, onPickPlane, onPickBody, onFocus }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  // "433 EROS" also matches "EROS"
  const rockNames = useMemo(
    () => rocks.map(rock => [rock.name.toUpperCase(), rock.name.toUpperCase().replace(/^\d+ |^\d+P\/|^\(/, '')]),
    [rocks]
  );
  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    // the Sun, Moon and planets go above any satellite
    const out = BODIES.filter(body => body.name.toUpperCase().includes(q)).map(body => ({
      rank: body.name.toUpperCase().startsWith(q) ? -2 : -1,
      type: 'body',
      id: body.id
    }));
    // then moons like Titan
    moons.forEach((moon, i) => {
      const name = moon.name.toUpperCase();
      if (name.includes(q)) out.push({ rank: name.startsWith(q) ? -1.5 : -0.8, type: 'moon', index: i });
    });
    // meteor showers like the Perseids
    SHOWERS.forEach((shower, i) => {
      const name = shower.name.toUpperCase();
      if (name.includes(q)) out.push({ rank: name.startsWith(q) ? -0.95 : 0.3, type: 'shower', index: i });
    });
    // spacecraft like Voyager go right after the planets and moons
    crafts.forEach((craft, i) => {
      const names = [craft.name, craft.short ?? ''].map(name => name.toUpperCase());
      if (names.some(name => name && name.includes(q))) {
        out.push({ rank: names.some(name => name && name.startsWith(q)) ? -0.9 : 0.4, type: 'craft', index: i });
      }
    });
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
    // famous rocks like Ceres or Halley go above satellites, and the rest below
    for (let i = 0, found = 0; i < rocks.length && found < 50; i++) {
      const [name, short] = rockNames[i];
      if (!name.includes(q)) continue;
      const starts = name.startsWith(q) || short.startsWith(q);
      const rank = NOTABLE[rocks[i].pdes] ? (starts ? -0.5 : 0.5) : starts ? 0.6 : 1.6;
      out.push({ rank, type: 'rock', index: i });
      found++;
    }
    // names that start with what you typed go first
    return out.sort((a, b) => a.rank - b.rank).slice(0, 8);
  }, [query, records, wiki, planes, rocks, rockNames, crafts, moons]);

  // with nothing typed, show your favorites instead
  const showingFavorites = !query.trim() && favorites.length > 0;
  const list = showingFavorites ? favorites.map(index => ({ type: 'sat', index })) : matches;

  const pick = item => {
    if (item.type === 'plane') onPickPlane(planes[item.index].icao);
    else if (item.type === 'body') onPickBody(item.id);
    else if (item.type === 'rock') onPickBody(`rock:${rocks[item.index].pdes}`);
    else if (item.type === 'craft') onPickBody(`craft:${crafts[item.index].id}`);
    else if (item.type === 'moon') onPickBody(`moon:${moons[item.index].id}`);
    else if (item.type === 'shower') onPickBody(`shower:${SHOWERS[item.index].id}`);
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
        placeholder={planes.length ? 'Search: ISS, Hubble, Mars, UAL…' : 'Search: ISS, Hubble, Mars…'}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={event => {
          if (event.key === 'Enter' && list.length) pick(list[0]);
          if (event.key === 'Escape') inputRef.current.blur();
        }}
        aria-label={planes.length ? 'Find a satellite, planet or flight' : 'Find a satellite or planet'}
      />
      {open && list.length > 0 && (
        // keep the input focused while clicking, so the list doesn't close first
        <ul onMouseDown={event => event.preventDefault()}>
          {showingFavorites && <li className="list-title">★ Favorites</li>}
          {list.map(item =>
            item.type === 'body' ? (
              <li key={`body ${item.id}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="body-swatch" style={{ background: BODY_BY_ID[item.id].color }} />
                    {BODY_BY_ID[item.id].name}
                  </span>
                  <span className="count">{BODY_BY_ID[item.id].kind}</span>
                </button>
              </li>
            ) : item.type === 'moon' ? (
              <li key={`moon ${item.index}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="body-swatch" style={{ background: moons[item.index].color }} />
                    {moons[item.index].name}
                  </span>
                  <span className="count">Moon of {BODY_BY_ID[moons[item.index].planet].name}</span>
                </button>
              </li>
            ) : item.type === 'shower' ? (
              <li key={`shower ${item.index}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="body-swatch" style={{ background: PARENT_BY_ID[SHOWERS[item.index].parent].color }} />
                    {SHOWERS[item.index].name}
                  </span>
                  <span className="count">Meteor shower · {peakLabel(SHOWERS[item.index])}</span>
                </button>
              </li>
            ) : item.type === 'craft' ? (
              <li key={`craft ${item.index}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="body-swatch" style={{ background: CRAFT_COLOR }} />
                    {crafts[item.index].name}
                  </span>
                  <span className="count">Spacecraft</span>
                </button>
              </li>
            ) : item.type === 'rock' ? (
              <li key={`rock ${item.index}`}>
                <button onClick={() => pick(item)}>
                  <span>
                    <span className="body-swatch" style={{ background: KIND_BY_ID[rocks[item.index].kind].color }} />
                    {rocks[item.index].name}
                  </span>
                  <span className="count">{KIND_BY_ID[rocks[item.index].kind].short}</span>
                </button>
              </li>
            ) : item.type === 'plane' ? (
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
      <About summary={summary} partOf={article?.program} links={trackerLinks(info.noradId)} />
    </aside>
  );
}

function BodyPanel({ info, summary, onGo, onClose }) {
  const body = BODY_BY_ID[info.id];
  const home = info.id === 'earth';
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: body.color }}>
        {body.kind}
      </div>
      <h2>{titleName(body)}</h2>
      <p className="ids">{number.format(Math.round(body.radiusKm * 2))} km across</p>
      <dl>
        {!home && (
          <>
            <dt>From Earth</dt>
            <dd>{formatDistance(info.fromEarthKm)}</dd>
          </>
        )}
        {info.id !== 'sun' && (
          <>
            <dt>From the Sun</dt>
            <dd>{formatDistance(info.fromSunKm)}</dd>
          </>
        )}
        {!home && (
          <>
            <dt>Light time</dt>
            <dd>{formatLightTime(info.lightSeconds)} to reach Earth</dd>
          </>
        )}
        {info.phase && (
          <>
            <dt>Phase</dt>
            <dd>
              {info.phase} <span className="muted">({Math.round(info.lit * 100)}% lit)</span>
            </dd>
          </>
        )}
        {body.periodDays && (
          <>
            <dt>Orbit</dt>
            <dd>
              around the {info.id === 'moon' ? 'Earth' : 'Sun'} every {formatDays(body.periodDays)}
            </dd>
          </>
        )}
      </dl>
      {!(home && info.anchored) && (
        <div className="actions">
          <button className="follow" onClick={onGo}>
            {info.anchored ? 'Back to Earth' : home ? 'Go back to Earth' : `Go to ${theName(body)}`}
          </button>
        </div>
      )}
      <About summary={summary} links={[{ label: 'NASA', href: nasaLink(body) }]} />
    </aside>
  );
}

function RockPanel({ info, summary, onGo, onClose }) {
  const size = info.sizeKm >= 10 ? number.format(Math.round(info.sizeKm)) : info.sizeKm.toPrecision(2);
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: info.kind.color }}>
        {info.kind.label}
      </div>
      <h2>{info.name}</h2>
      <p className="ids">
        {info.sizeKnown || info.sizeGuessed ? (
          <>
            {info.sizeGuessed && 'about '}
            {size} km across
            {info.sizeGuessed && <span className="muted"> (guessed from how bright it is)</span>}
          </>
        ) : (
          'Size unknown'
        )}
      </p>
      <dl>
        <dt>From Earth</dt>
        <dd>{formatDistance(info.fromEarthKm)}</dd>
        <dt>From the Sun</dt>
        <dd>{formatDistance(info.fromSunKm)}</dd>
        <dt>Light time</dt>
        <dd>{formatLightTime(info.lightSeconds)} to reach Earth</dd>
        <dt>Orbit</dt>
        {info.periodDays ? (
          <dd>
            around the Sun every {formatDays(info.periodDays)}
            <span className="muted">
              {' '}
              ({info.nearestAu.toFixed(info.nearestAu < 10 ? 2 : 0)} to {info.farthestAu.toFixed(info.farthestAu < 10 ? 2 : 0)} AU
              out)
            </span>
          </dd>
        ) : (
          <dd>
            passing through once, never coming back
            <span className="muted">
              {' '}
              (closest to the Sun {info.closest < new Date() ? 'was' : 'is'} {info.nearestAu.toFixed(2)} AU on{' '}
              {info.closest.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })})
            </span>
          </dd>
        )}
      </dl>
      <div className="actions">
        <button className="follow" onClick={onGo}>
          {info.anchored ? 'Back to Earth' : `Go to ${info.name.replace(/^\d+ /, '')}`}
        </button>
      </div>
      <About summary={summary} links={[{ label: 'NASA JPL', href: info.jpl }]} />
    </aside>
  );
}

function MoonPanel({ info, summary, onGo, onClose }) {
  const { moon, planet } = info;
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: moon.color }}>
        {info.kind}
      </div>
      <h2>{moon.name}</h2>
      <p className="ids">{number.format(Math.round(moon.radiusKm * 2))} km across</p>
      <dl>
        <dt>From Earth</dt>
        <dd>{formatDistance(info.fromEarthKm)}</dd>
        <dt>From {planet.name}</dt>
        <dd>{formatDistance(info.fromPlanetKm)}</dd>
        <dt>Light time</dt>
        <dd>{formatLightTime(info.lightSeconds)} to reach Earth</dd>
        <dt>Orbit</dt>
        <dd>
          around {planet.name} every {info.periodDays < 2 ? `${(info.periodDays * 24).toFixed(1)} hours` : formatDays(info.periodDays)}
          {info.retrograde && <span className="muted"> (backward, against {planet.name}'s spin)</span>}
        </dd>
      </dl>
      <div className="actions">
        <button className="follow" onClick={onGo}>
          {info.anchored ? 'Back to Earth' : `Go to ${moon.name}`}
        </button>
      </div>
      <About summary={summary} links={[]} />
    </aside>
  );
}

function ShowerPanel({ info, summary, onGo, onClose }) {
  const { shower, parent } = info;
  const when = info.peak.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: info.color }}>
        Meteor shower
      </div>
      <h2>{shower.name}</h2>
      <p className="ids">Comes from the direction of {shower.radiant}</p>
      <dl>
        <dt>Next peak</dt>
        <dd>
          {when}
          <span className="muted"> ({info.daysToPeak === 0 ? 'today' : info.daysToPeak === 1 ? 'tomorrow' : `in ${info.daysToPeak} days`})</span>
        </dd>
        <dt>At its best</dt>
        <dd>
          about {shower.zhr} meteors an hour <span className="muted">(under a perfectly dark sky)</span>
        </dd>
        <dt>Speed</dt>
        <dd>{shower.speedKmS} km/s into the air</dd>
        <dt>Dust from</dt>
        <dd>{parent.name}</dd>
      </dl>
      <p className="note">{shower.note}</p>
      <div className="actions">
        <button className="follow" onClick={onGo}>
          {info.anchored ? 'Back to Earth' : `Go to the ${shower.name}`}
        </button>
      </div>
      <About summary={summary} links={[]} />
    </aside>
  );
}

function CraftPanel({ info, summary, onGo, onClose }) {
  const { craft } = info;
  return (
    <aside className="panel top-right info">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="kind" style={{ color: CRAFT_COLOR }}>
        Spacecraft
      </div>
      <h2>{craft.name}</h2>
      <p className="ids">
        {craft.agency} · launched {craft.launched}
      </p>
      {info.noData ? (
        <p>JPL has no path for it on this date.</p>
      ) : (
        <dl>
          <dt>From Earth</dt>
          <dd>{formatDistance(info.fromEarthKm)}</dd>
          <dt>From the Sun</dt>
          <dd>{formatDistance(info.fromSunKm)}</dd>
          <dt>Speed</dt>
          <dd>
            {info.speedKmS.toFixed(info.speedKmS < 10 ? 2 : 1)} km/s{' '}
            <span className="muted">(compared to {info.speedFrom})</span>
          </dd>
          <dt>Light time</dt>
          <dd>{formatLightTime(info.lightSeconds)} to reach Earth</dd>
        </dl>
      )}
      <p className="note">
        {craft.note}
        {info.guessed && <span className="muted"> Past JPL's data, so it's assumed to keep going straight.</span>}
      </p>
      <div className="actions">
        <button className="follow" onClick={onGo}>
          {info.anchored ? 'Back to Earth' : `Go to ${craft.short ?? craft.name}`}
        </button>
      </div>
      <About summary={summary} links={craft.link ? [{ label: craft.agency.split(/,| and /)[0], href: craft.link }] : []} />
    </aside>
  );
}

// the shrunken info panel on phones. The selection and Ride along keep going underneath
function SelectionBar({ info, onExpand, onClose }) {
  const isPlane = info.type === 'plane';
  const isRock = info.type === 'rock';
  const isCraft = info.type === 'craft';
  const isMoon = info.type === 'moon';
  const isShower = info.type === 'shower';
  const body = info.type === 'body' ? BODY_BY_ID[info.id] : null;
  const category = info.type ? null : CATEGORY_BY_ID[info.category];
  const name = isPlane ? info.callsign || info.icao.toUpperCase() : body ? titleName(body) : info.name;
  const kind = isPlane
    ? (info.kind ?? 'Plane')
    : body
      ? body.kind
      : isRock
        ? info.kind.short
        : isCraft
          ? 'Spacecraft'
          : isMoon
            ? info.kind
            : isShower
              ? 'Meteor shower'
              : category.label;
  return (
    <aside className="panel top-right selection-bar">
      <button className="expand" onClick={onExpand} aria-expanded="false" aria-label={`Show details for ${name}`}>
        <span
          className="kind"
          style={{
            color:
              body?.color ??
              (isRock ? info.kind.color : isCraft ? CRAFT_COLOR : isMoon ? info.moon.color : isShower ? info.color : category?.color) ??
              '#fff'
          }}
        >
          {kind}
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

function About({ summary, partOf, links }) {
  return (
    <section className="about">
      {summary === undefined && <p className="muted">Looking it up on Wikipedia…</p>}
      {summary && (
        <>
          {partOf && <div className="about-kind">Part of {summary.title}</div>}
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
        {links.map(link => (
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
  const days = hours / 24;
  if (days < 365) return `${sign}${days.toFixed(days < 100 ? 1 : 0)} d`;
  return `${sign}${(days / 365.25).toFixed(1)} yr`;
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

// "the Moon", but just "Mars"
function theName(body) {
  return body.the ? `the ${body.name}` : body.name;
}

function titleName(body) {
  return body.the ? `The ${body.name}` : body.name;
}

function formatDistance(km) {
  if (km < 1e7) return `${number.format(Math.round(km))} km`;
  if (km < 1e9) return `${(km / 1e6).toFixed(1)} million km`;
  return `${(km / 1e9).toFixed(2)} billion km`;
}

function formatLightTime(seconds) {
  if (seconds < 90) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}

function formatDays(days) {
  if (days < 400) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(days < 3650 ? 2 : 0)} years`;
}

function formatPeriod(minutes) {
  if (minutes < 120) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}
