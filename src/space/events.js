// Things coming up in the sky, like eclipses, meteor shower peaks, planets at their brightest and
// spacecraft flybys. Each event says when it is and what the camera should look at.
//
// view is one of:
//   { type: 'eclipse', eclipse }    an eclipse from eclipses.js
//   { type: 'body', id, lead, speed } select a body (any id the globe knows) and fly to it
// lead is how long before the event to start the clock, and speed how fast to run it (1 is real time).
//   { type: 'earth', lead, speed }    the Earth from the side, so you can see which pole leans toward the Sun
//   { type: 'pair', ids }             two planets close together in the sky, seen past the Earth
import { AngleFromSun, GeoVector, HelioVector, NextPlanetApsis, PairLongitude, SearchMaxElongation, SearchPlanetApsis, SearchRelativeLongitude, Seasons } from 'astronomy-engine';
import { nextLunarEclipse, nextSolarEclipse, placeLabel } from './eclipses.js';
import { nextPeak, SHOWERS } from './meteors.js';
import { craftPosition } from './spacecraft.js';
import { julianDay, meanMotion, NOTABLE, orbitOf, positionAt } from './smallBodies.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const DEG = Math.PI / 180;

const PLANET_NAMES = { mercury: 'Mercury', venus: 'Venus', earth: 'Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' };
const capital = text => text[0].toUpperCase() + text.slice(1);
const formatKm = km => (km >= 1e6 ? `${(km / 1e6).toFixed(1)} million km` : `${Math.round(km).toLocaleString('en-US')} km`);

function eclipses(from, until) {
  const out = [];
  for (let date = from, k = 0; k < 4; k++) {
    const eclipse = nextSolarEclipse(date);
    if (eclipse.peak > until) break;
    const where = placeLabel(eclipse.latitude, eclipse.longitude);
    out.push({
      id: `solar-${eclipse.peak.toISOString()}`,
      date: eclipse.peak,
      kind: 'eclipse',
      title: `${capital(eclipse.kind)} solar eclipse`,
      detail: where ? `The Moon's shadow is darkest at ${where}` : 'Only a partial bite out of the Sun, near a pole',
      view: { type: 'eclipse', eclipse }
    });
    date = new Date(eclipse.peak.getTime() + DAY_MS);
  }
  for (let date = from, k = 0; k < 4; k++) {
    const eclipse = nextLunarEclipse(date, { skipFaint: true });
    if (eclipse.peak > until) break;
    out.push({
      id: `lunar-${eclipse.peak.toISOString()}`,
      date: eclipse.peak,
      kind: 'eclipse',
      title: `${capital(eclipse.kind)} lunar eclipse`,
      detail: eclipse.totalMinutes > 0 ? `The Moon turns red for ${eclipse.totalMinutes} minutes` : `The Earth's shadow covers part of the Moon for ${eclipse.partialMinutes} minutes`,
      view: { type: 'eclipse', eclipse }
    });
    date = new Date(eclipse.peak.getTime() + DAY_MS);
  }
  return out;
}

function showers(from, until) {
  return SHOWERS.map(shower => ({ shower, peak: nextPeak(shower, from) }))
    .filter(({ peak }) => peak <= until)
    .map(({ shower, peak }) => ({
      id: `shower-${shower.id}-${peak.getUTCFullYear()}`,
      date: peak,
      kind: 'shower',
      title: `${shower.name} peak`,
      detail: `Up to ${shower.zhr} meteors an hour under a dark sky`,
      view: { type: 'body', id: `shower:${shower.id}` }
    }));
}

// Outer planets are closest and brightest at opposition, opposite the Sun and up all night.
// Mercury and Venus are easiest to see when they're farthest from the Sun.
function planets(from, until) {
  const out = [];
  for (const id of ['mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const date = SearchRelativeLongitude(PLANET_NAMES[id], 0, from).date;
    if (date > until) continue;
    out.push({
      id: `opposition-${id}-${date.toISOString().slice(0, 10)}`,
      date,
      kind: 'planet',
      title: `${PLANET_NAMES[id]} at opposition`,
      detail: 'Opposite the Sun, so it is up all night and at its brightest',
      view: { type: 'body', id }
    });
  }
  for (const id of ['mercury', 'venus']) {
    let date = from;
    for (let k = 0; k < 8; k++) {
      const found = SearchMaxElongation(PLANET_NAMES[id], date);
      if (found.time.date > until) break;
      out.push({
        id: `elongation-${id}-${found.time.date.toISOString().slice(0, 10)}`,
        date: found.time.date,
        kind: 'planet',
        title: `${PLANET_NAMES[id]} farthest from the Sun`,
        detail: `${Math.round(found.elongation)}° from the Sun, best seen ${found.visibility === 'morning' ? 'before sunrise' : 'after sunset'}`,
        view: { type: 'body', id }
      });
      date = found.time.AddDays(10).date;
    }
  }
  return out;
}

// Two planets that look close together in the sky, away from the Sun's glare
function meetings(from, until) {
  const ids = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
  const out = [];
  const direction = (id, date) => {
    const v = GeoVector(PLANET_NAMES[id], date, true);
    const length = Math.hypot(v.x, v.y, v.z);
    return [v.x / length, v.y / length, v.z / length];
  };
  const apart = (a, b, date) => {
    const [p, q] = [direction(a, date), direction(b, date)];
    return Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) / DEG;
  };
  const days = Math.ceil((until - from) / DAY_MS);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]];
      const at = k => new Date(from.getTime() + k * DAY_MS);
      let [before, now] = [apart(a, b, at(0)), apart(a, b, at(1))];
      for (let k = 1; k < days; k++) {
        const next = apart(a, b, at(k + 1));
        if (now < before && now <= next && now < 2) {
          // the closest hour within a day either side
          let best = { degrees: now, date: at(k) };
          for (let h = -24; h <= 24; h++) {
            const date = new Date(at(k).getTime() + h * HOUR_MS);
            const degrees = apart(a, b, date);
            if (degrees < best.degrees) best = { degrees, date };
          }
          const glare = Math.min(AngleFromSun(PLANET_NAMES[a], best.date), AngleFromSun(PLANET_NAMES[b], best.date));
          if (glare > 15) {
            const evening = PairLongitude(PLANET_NAMES[a], 'Sun', best.date) < 180;
            out.push({
              id: `meeting-${a}-${b}-${best.date.toISOString().slice(0, 10)}`,
              date: best.date,
              kind: 'planet',
              title: `${PLANET_NAMES[a]} and ${PLANET_NAMES[b]} meet`,
              detail: `${best.degrees < 1 ? best.degrees.toFixed(1) : Math.round(best.degrees * 10) / 10}° apart in the ${evening ? 'evening' : 'morning'} sky`,
              view: { type: 'pair', ids: [a, b] }
            });
          }
        }
        [before, now] = [now, next];
      }
    }
  }
  return out;
}

// half a day at an hour a second, so the Earth spins once on the way
const EARTH_VIEW = { type: 'earth', lead: 12 * HOUR_MS, speed: 3600 };

function earth(from, until) {
  const out = [];
  const names = {
    mar_equinox: ['March equinox', 'Day and night are the same length everywhere. Spring starts in the north'],
    jun_solstice: ['June solstice', 'The longest day in the north and the shortest in the south'],
    sep_equinox: ['September equinox', 'Day and night are the same length everywhere. Autumn starts in the north'],
    dec_solstice: ['December solstice', 'The shortest day in the north and the longest in the south']
  };
  for (let year = from.getUTCFullYear(); year <= until.getUTCFullYear(); year++) {
    const seasons = Seasons(year);
    for (const [key, [title, detail]] of Object.entries(names)) {
      const date = seasons[key].date;
      if (date >= from && date <= until) out.push({ id: `${key}-${year}`, date, kind: 'earth', title, detail, view: EARTH_VIEW });
    }
  }
  for (let apsis = SearchPlanetApsis('Earth', from); apsis.time.date <= until; apsis = NextPlanetApsis('Earth', apsis)) {
    const closest = apsis.kind === 0;
    out.push({
      id: `earth-${closest ? 'perihelion' : 'aphelion'}-${apsis.time.date.getUTCFullYear()}`,
      date: apsis.time.date,
      kind: 'earth',
      title: closest ? 'Earth closest to the Sun' : 'Earth farthest from the Sun',
      detail: `${formatKm(apsis.dist_km)} away`,
      view: EARTH_VIEW
    });
  }
  return out;
}

// The sky events that don't need anything downloaded, soonest first
export function skyEvents(from, days = 365) {
  const until = new Date(from.getTime() + days * DAY_MS);
  return [...eclipses(from, until), ...showers(from, until), ...planets(from, until), ...meetings(from, until), ...earth(from, until)].sort(
    (a, b) => a.date - b.date
  );
}

// how close a craft has to come to count as a flyby, in AU: about 3 million km for planets, and
// 1.5 million km for asteroids
const FLYBY_AU = 0.02;
const ROCK_FLYBY_AU = 0.01;
const KM_PER_AU = 149597870.7;

// Spacecraft flybys of the planets and the famous asteroids, plus Parker's closest passes of the Sun.
// crafts come from fromCompactSpacecraft, and rocks (optional) from fromCompactBodies.
export function craftEvents(crafts, from, days = 365, rocks = []) {
  const planetAt = (id, date) => {
    const v = HelioVector(PLANET_NAMES[id], date);
    return [v.x, v.y, v.z];
  };
  const until = from.getTime() + days * DAY_MS;
  const out = [];
  const targets = ['mercury', 'venus', 'earth', 'mars', 'jupiter'].map(id => ({ id, name: PLANET_NAMES[id], at: date => planetAt(id, date), limit: FLYBY_AU * (id === 'jupiter' ? 5 : 1) }));
  for (const rock of rocks) {
    if (!NOTABLE[rock.pdes] || rock.kind === 'comet' || rock.kind === 'interstellar') continue;
    const orbit = orbitOf(rock);
    targets.push({ id: `rock:${rock.pdes}`, name: rock.name, at: date => positionAt(orbit, julianDay(date)), limit: ROCK_FLYBY_AU });
  }
  const step = 6 * HOUR_MS;
  const p = [0, 0, 0];
  // every target's spot on the same 6-hour grid, worked out once for all the craft
  const times = [];
  for (let time = from.getTime(); time <= until + step; time += step) times.push(time);
  for (const target of targets) target.grid = times.map(time => target.at(new Date(time)));
  for (const craft of crafts) {
    if (craft.center !== 'sun') continue;
    const name = craft.short ?? craft.name;
    if (craft.ellipse) {
      // Parker's closest passes, every few months
      const orbit = craft.ellipse;
      const period = (2 * Math.PI) / orbit.n;
      const last = orbit.epoch - orbit.M0 / orbit.n;
      for (let jd = last + Math.ceil((julianDay(from) - last) / period) * period; (jd - 2440587.5) * DAY_MS <= until; jd += period) {
        out.push({
          id: `perihelion-${craft.id}-${jd.toFixed(1)}`,
          date: new Date((jd - 2440587.5) * DAY_MS),
          kind: 'craft',
          title: `${name} skims the Sun`,
          detail: `${formatKm(orbit.a * (1 - orbit.e) * KM_PER_AU)} from the Sun, the closest anything we've built gets`,
          view: { type: 'body', id: `craft:${craft.id}`, lead: 2 * DAY_MS, speed: 3600 }
        });
      }
      continue;
    }
    const path = times.map(time => (craftPosition(craft, julianDay(time), p) ? [...p] : null));
    for (const target of targets) {
      const distance = time => {
        if (!craftPosition(craft, julianDay(time), p)) return Infinity;
        const t = target.at(new Date(time));
        return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
      };
      const onGrid = k => {
        const c = path[k];
        const t = target.grid[k];
        return c ? Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]) : Infinity;
      };
      // already there, like a craft that has arrived to stay
      if (onGrid(0) < target.limit) continue;
      let [before, now] = [onGrid(0), onGrid(1)];
      for (let k = 1; k + 1 < times.length; k++) {
        const time = times[k];
        const next = onGrid(k + 1);
        if (now < before && now <= next && now < target.limit) {
          let best = { d: now, time };
          for (let t = time - step; t <= time + step; t += 10 * 60000) {
            const d = distance(t);
            if (d < best.d) best = { d, time: t };
          }
          // still close 10 days later means it's staying
          const stays = onGrid(Math.min(k + 40, times.length - 1)) < target.limit;
          out.push({
            id: `flyby-${craft.id}-${target.id}`,
            date: new Date(best.time),
            kind: 'craft',
            title: stays ? `${name} arrives at ${target.name}` : `${name} flies past ${target.name}`,
            detail: stays ? `First pass ${formatKm(best.d * KM_PER_AU)} from its center` : `${formatKm(best.d * KM_PER_AU)} from its center`,
            view: { type: 'body', id: `craft:${craft.id}`, lead: 12 * HOUR_MS, speed: 600 }
          });
          // arriving to stay would count again every orbit, so only the first pass counts
          break;
        }
        [before, now] = [now, next];
      }
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

// The famous comets' closest passes of the Sun. rocks come from fromCompactBodies.
export function cometEvents(rocks, from, days = 365) {
  const until = from.getTime() + days * DAY_MS;
  const jdFrom = julianDay(from);
  const out = [];
  for (const rock of rocks) {
    if (!NOTABLE[rock.pdes] || (rock.kind !== 'comet' && rock.kind !== 'interstellar')) continue;
    let tp;
    // open orbits store how many days past the closest point they are at the epoch
    if (rock.e >= 1) tp = rock.epoch - rock.M;
    else {
      const n = meanMotion(rock.a);
      const period = (2 * Math.PI) / n;
      const last = rock.epoch - (rock.M * DEG) / n;
      tp = last + Math.ceil((jdFrom - last) / period) * period;
    }
    const date = new Date((tp - 2440587.5) * DAY_MS);
    if (date < from || date.getTime() > until) continue;
    const q = rock.e >= 1 ? rock.a : rock.a * (1 - rock.e);
    out.push({
      id: `comet-${rock.pdes}-${date.getUTCFullYear()}`,
      date,
      kind: 'comet',
      title: `${rock.name} closest to the Sun`,
      detail: `${formatKm(q * KM_PER_AU)} from the Sun, with its tail at its longest`,
      view: { type: 'body', id: `rock:${rock.pdes}`, lead: 10 * DAY_MS, speed: 86400 }
    });
  }
  return out;
}
