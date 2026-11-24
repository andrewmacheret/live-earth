import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTCHES, sliderToSpeed, speedLabel, speedToSlider } from '../src/speed.js';

test('notches land on exact speeds, both ways', () => {
  assert.deepEqual(
    NOTCHES.map(n => sliderToSpeed(n.value)),
    [-31557600, -86400, -3600, -60, -1, 0, 1, 60, 3600, 86400, 31557600]
  );
  for (const n of NOTCHES) assert.equal(speedToSlider(sliderToSpeed(n.value)), n.value);
});

test('the middle pauses and nearby values snap to a notch', () => {
  assert.equal(sliderToSpeed(5), 0);
  assert.equal(sliderToSpeed(-7), 0);
  assert.equal(sliderToSpeed(97), 1);
  assert.equal(sliderToSpeed(-204), -60);
  assert.ok(sliderToSpeed(150) > 1 && sliderToSpeed(150) < 60);
  assert.ok(sliderToSpeed(50) > 0 && sliderToSpeed(50) < 1);
  assert.ok(sliderToSpeed(350) > 3600 && sliderToSpeed(350) < 86400);
  assert.ok(sliderToSpeed(-450) < -86400 && sliderToSpeed(-450) > -31557600);
  for (const steps of [37, 150, 250, 350, 450]) assert.equal(speedToSlider(sliderToSpeed(steps)), steps);
});

test('describes the speed in words', () => {
  assert.equal(speedLabel(0), 'Paused');
  assert.equal(speedLabel(1), 'Playing at real time');
  assert.equal(speedLabel(-60), 'Rewinding at 1 min/s');
  assert.equal(speedLabel(720), 'Playing at 12 min/s');
  assert.equal(speedLabel(5400), 'Playing at 1.5 hr/s');
  assert.equal(speedLabel(0.25), 'Playing at 0.25× speed');
  assert.equal(speedLabel(86400 * 30), 'Playing at 30 days/s');
  assert.equal(speedLabel(-31557600), 'Rewinding at 1 yr/s');
});
