import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readView, viewParams } from '../src/links.js';

test('a link keeps the time, speed and camera, and reads back the same', () => {
  const time = Date.parse('2027-08-02T09:46:12.400Z');
  const params = viewParams({ time, live: false, speed: 60, anchor: 'earth', offset: [1.234567, -3.5, 0.000123456] });
  assert.deepEqual(params, { t: '2027-08-02T09:46:12Z', speed: '60', at: 'earth', cam: '1.2346,-3.5,0.00012346' });
  const view = readView(new URLSearchParams(params));
  assert.equal(view.time, Date.parse('2027-08-02T09:46:12Z'));
  assert.equal(view.speed, 60);
  assert.equal(view.anchor, 'earth');
  assert.deepEqual(view.offset, [1.2346, -3.5, 0.00012346]);
});

test('a live link leaves out the time and speed, so it opens live', () => {
  const params = viewParams({ time: Date.now(), live: true, speed: 1, anchor: 'moon:io', offset: [10, 0, 0] });
  assert.deepEqual(Object.keys(params), ['at', 'cam']);
  const view = readView(new URLSearchParams(params));
  assert.equal(view.time, null);
  assert.equal(view.speed, null);
  assert.equal(view.anchor, 'moon:io');
});

test('broken or missing params are ignored', () => {
  const empty = readView(new URLSearchParams(''));
  assert.deepEqual(empty, { time: null, speed: null, anchor: null, offset: null });
  const broken = readView(new URLSearchParams('t=soon&speed=fast&at=earth&cam=1,2'));
  assert.deepEqual(broken, { time: null, speed: null, anchor: null, offset: null });
  // a camera sitting right on what it looks at can't look anywhere
  assert.equal(readView(new URLSearchParams('at=earth&cam=0,0,0')).anchor, null);
  // paused is a real speed
  assert.equal(readView(new URLSearchParams('speed=0')).speed, 0);
});
