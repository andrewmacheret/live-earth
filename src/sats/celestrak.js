import { parseCsv } from './catalog.js';

const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';

// CelesTrak groups to download, and the legend category each one goes in. Together they cover
// almost everything in CelesTrak's "active" list. A satellite in more than one group keeps the
// first one listed here.
export const GROUPS = [
  ['stations', 'station'],
  ['starlink', 'starlink'],
  ['kuiper', 'kuiper'],
  ['oneweb', 'oneweb'],
  ['gnss', 'gnss'],
  ['sbas', 'gnss'],
  ['nnss', 'gnss'],
  ['musson', 'gnss'],
  ['weather', 'earth'],
  ['resource', 'earth'],
  ['sarsat', 'earth'],
  ['dmc', 'earth'],
  ['argos', 'earth'],
  ['planet', 'earth'],
  ['spire', 'earth'],
  ['geo', 'comms'],
  ['iridium-NEXT', 'comms'],
  ['orbcomm', 'comms'],
  ['globalstar', 'comms'],
  ['swarm', 'comms'],
  ['qianfan', 'comms'],
  ['hulianwang', 'comms'],
  ['amateur', 'comms'],
  ['satnogs', 'comms'],
  ['x-comm', 'comms'],
  ['other-comm', 'comms'],
  ['tdrss', 'comms'],
  ['science', 'science'],
  ['geodetic', 'science'],
  ['engineering', 'science'],
  ['education', 'science'],
  ['military', 'military'],
  ['radar', 'military'],
  ['cubesat', 'other'],
  ['other', 'other'],
  ['last-30-days', 'other']
];

// Thrown when CelesTrak says we already have this group's latest data (it allows one
// download per group per IP every 2 hours).
export class NotUpdated extends Error {}

// CelesTrak can be slow (a few kB/s for big groups), so read the reply piece by piece and log
// progress for anything that takes a while.
export async function downloadGroup(group, { timeoutMs = 5 * 60 * 1000, log = console.log } = {}) {
  const started = Date.now();
  let response;
  let text = '';
  let bytes = 0;
  try {
    response = await fetch(`${GP_URL}?GROUP=${encodeURIComponent(group)}&FORMAT=csv`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'live-earth (https://andrewmacheret.com/projects/live-earth/)' }
    });
    const decoder = new TextDecoder();
    let loggedAt = Date.now();
    for await (const chunk of response.body) {
      bytes += chunk.length;
      text += decoder.decode(chunk, { stream: true });
      if (Date.now() - loggedAt > 30000) {
        loggedAt = Date.now();
        log(`${group}: ${Math.round(bytes / 1024)} kB after ${Math.round((loggedAt - started) / 1000)} s`);
      }
    }
    text += decoder.decode();
  } catch (err) {
    // fetch hides the network error (reset, timeout...) in err.cause
    const cause = err.cause ? `${err.cause.code || ''} ${err.cause.message || ''}`.trim() : err.message;
    const seconds = Math.round((Date.now() - started) / 1000);
    throw new Error(`${group}: failed after ${Math.round(bytes / 1024)} kB and ${seconds} s: ${cause}`);
  }
  if (response.status === 403 && text.includes('has not updated')) throw new NotUpdated(`${group}: not updated yet`);
  if (!response.ok) throw new Error(`${group}: CelesTrak answered ${response.status} ${text.trim().slice(0, 200)}`);
  // unknown groups get a 200 with a plain text message instead of CSV
  if (!text.startsWith('OBJECT_NAME,')) throw new Error(`${group}: not CSV: ${text.trim().slice(0, 200)}`);
  return parseCsv(text);
}
