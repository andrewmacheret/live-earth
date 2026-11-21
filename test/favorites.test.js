import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFavorites, saveFavorites, toggleFavorite } from '../src/favorites.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: key => data[key] ?? null, setItem: (key, value) => (data[key] = value), data };
}

test('favorites survive a save and load', () => {
  const storage = fakeStorage();
  saveFavorites([25544, 20580], storage);
  assert.deepEqual(loadFavorites(storage), [25544, 20580]);
});

test('bad or missing saved data gives an empty list', () => {
  assert.deepEqual(loadFavorites(fakeStorage()), []);
  assert.deepEqual(loadFavorites(fakeStorage({ 'live-earth:favorites': 'not json' })), []);
  assert.deepEqual(loadFavorites(fakeStorage({ 'live-earth:favorites': '{"a":1}' })), []);
  assert.deepEqual(loadFavorites(fakeStorage({ 'live-earth:favorites': '[1,"x",2.5,3]' })), [1, 3]);
  assert.deepEqual(loadFavorites(undefined), []);
});

test('toggling adds then removes', () => {
  assert.deepEqual(toggleFavorite([1], 2), [1, 2]);
  assert.deepEqual(toggleFavorite([1, 2], 1), [2]);
});
