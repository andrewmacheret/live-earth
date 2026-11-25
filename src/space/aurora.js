// NOAA's OVATION model: the chance of seeing the aurora overhead right now, on a 1° grid.
// It's redone every few minutes and allows calls from web pages, so the page downloads it directly.
export const AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

export const WIDTH = 360;
export const HEIGHT = 181;

// Turns NOAA's [longitude 0-359, latitude -90-90, percent] list into a texture's bytes, laid out like
// the Earth's map: column 0 is 180° west, row 0 is the South Pole. 255 means 100%.
export function auroraGrid(json) {
  const data = new Uint8Array(WIDTH * HEIGHT);
  let peak = 0;
  for (const [lon, lat, percent] of json.coordinates) {
    const column = (Math.round(lon) + 180) % WIDTH;
    const row = Math.round(lat) + 90;
    if (row < 0 || row >= HEIGHT) continue;
    data[row * WIDTH + column] = Math.round(Math.min(100, Math.max(0, percent)) * 2.55);
    peak = Math.max(peak, percent);
  }
  return {
    data,
    peak,
    observed: new Date(json['Observation Time']),
    forecast: new Date(json['Forecast Time'])
  };
}
