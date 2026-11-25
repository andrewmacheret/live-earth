import test from 'node:test';
import assert from 'node:assert/strict';
import { tailLength } from '../src/globe/rocks.js';

test('comet tails grow near the Sun and vanish past 5 AU', () => {
  assert.equal(tailLength(6), 0);
  assert.equal(tailLength(5), 0);
  assert.ok(Math.abs(tailLength(1) - 0.3) < 1e-9);
  assert.ok(tailLength(0.5) > tailLength(1));
  assert.ok(tailLength(1) > tailLength(2));
  assert.ok(tailLength(2) > tailLength(4));
  assert.equal(tailLength(0.1), 0.8);
});
