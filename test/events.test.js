import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HelioState } from 'astronomy-engine';
import { cometEvents, craftEvents, skyEvents } from '../src/space/events.js';
import { julianDay, meanMotion, orbitOf } from '../src/space/smallBodies.js';

const FROM = new Date('2026-11-24T22:00:00Z');
const DAY_MS = 86400000;
const KM_PER_AU = 149597870.7;
const dayOf = event => event.date.toISOString().slice(0, 10);

test('finds the eclipses, shower peaks, planets and seasons of the next year, soonest first', () => {
  const events = skyEvents(FROM);
  const find = title => events.find(event => event.title === title);
  assert.equal(dayOf(find('Annular solar eclipse')), '2027-02-06');
  assert.equal(dayOf(find('Total solar eclipse')), '2027-08-02');
  assert.equal(dayOf(find('Mars at opposition')), '2027-02-19');
  assert.equal(dayOf(find('Jupiter at opposition')), '2027-02-11');
  assert.equal(dayOf(find('December solstice')), '2026-12-21');
  assert.equal(dayOf(find('Earth closest to the Sun')), '2027-01-03');
  assert.equal(dayOf(find('Geminids peak')), '2026-12-14');
  assert.equal(find('Annular solar eclipse').view.type, 'eclipse');
  assert.equal(find('Geminids peak').view.id, 'shower:geminids');
  // the next lunar eclipse that isn't faint is in January 2028, more than a year away
  assert.ok(!events.some(event => event.title.endsWith('lunar eclipse')));
  const meeting = find('Venus and Saturn meet');
  assert.equal(dayOf(meeting), '2027-05-07');
  assert.match(meeting.detail, /^0\.\d° apart in the morning sky$/);
  assert.deepEqual(meeting.view, { type: 'pair', ids: ['venus', 'saturn'] });
  for (let k = 1; k < events.length; k++) assert.ok(events[k - 1].date <= events[k].date);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  assert.ok(events.every(event => event.date >= FROM && event.date - FROM <= 365 * DAY_MS));
});

// a made-up craft that coasts past the Earth in a straight line, 10,000 km from its center on day 20
function flybyCraft() {
  const closest = julianDay(FROM) + 20;
  const relative = [0.004, 0.001, 0]; // AU a day, about 7 km/s
  const miss = 10000 / KM_PER_AU;
  const times = [];
  const samples = [];
  for (let jd = julianDay(FROM) - 1; jd <= julianDay(FROM) + 60; jd += 0.25) {
    const earth = HelioState('Earth', new Date((jd - 2440587.5) * DAY_MS));
    const t = jd - closest;
    times.push(jd);
    samples.push(earth.x + relative[0] * t, earth.y + relative[1] * t, earth.z + miss, earth.vx + relative[0], earth.vy + relative[1], earth.vz);
  }
  return { id: 'test', name: 'Test Probe', center: 'sun', times, samples, start: times[0], end: times.at(-1) };
}

test('finds a spacecraft flyby and how close it gets', () => {
  const [event] = craftEvents([flybyCraft()], FROM, 365);
  assert.equal(event.title, 'Test Probe flies past Earth');
  assert.ok(Math.abs(event.date - (FROM.getTime() + 20 * DAY_MS)) < 3600000, event.date.toISOString());
  const km = Number(event.detail.replace(/[^\d]/g, ''));
  assert.ok(Math.abs(km - 10000) < 300, event.detail);
  assert.deepEqual(event.view, { type: 'body', id: 'craft:test', lead: 12 * 3600000, speed: 600 });
});

test("lists Parker's closest passes of the Sun every orbit", () => {
  const orbit = orbitOf({ e: 0.88, a: 0.388, i: 3.4, node: 76, peri: 26, M: 180, epoch: julianDay(FROM) });
  const parker = { id: 'parker', name: 'Parker Solar Probe', center: 'sun', ellipse: { ...orbit, M0: orbit.M0 } };
  const events = craftEvents([parker], FROM, 365);
  const period = (2 * Math.PI) / meanMotion(0.388);
  assert.equal(events.length, Math.floor((365 - period / 2) / period) + 1);
  // halfway around from the farthest point at the start
  assert.ok(Math.abs(events[0].date - (FROM.getTime() + (period / 2) * DAY_MS)) < 60000);
  assert.ok(events.every(event => event.title === 'Parker Solar Probe skims the Sun'));
});

test("finds a famous comet's next pass by the Sun, and skips ones that aren't famous", () => {
  // Encke a quarter turn before its closest point
  const a = 2.215;
  const n = meanMotion(a) / (Math.PI / 180);
  const encke = { pdes: '2P', name: '2P/Encke', kind: 'comet', e: 0.848, a, M: 360 - 30 * n, epoch: julianDay(FROM) };
  const unknown = { ...encke, pdes: '999P', name: '999P/Nobody' };
  const events = cometEvents([encke, unknown], FROM);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, '2P/Encke closest to the Sun');
  assert.ok(Math.abs(events[0].date - (FROM.getTime() + 30 * DAY_MS)) < 60000);
  assert.equal(events[0].view.id, 'rock:2P');
});
