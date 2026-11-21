// Favorite satellites, saved in this browser as a list of NORAD ids.
const KEY = 'live-earth:favorites';

export function loadFavorites(storage = globalThis.localStorage) {
  try {
    const ids = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // private browsing or a full disk, favorites just won't stick around
  }
}

export function toggleFavorite(ids, id) {
  return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
}
