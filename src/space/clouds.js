// Yesterday's clouds from NASA GIBS: a true color picture of the whole Earth stitched from the VIIRS
// camera on the NOAA-20 satellite. GIBS allows calls from web pages, so the page downloads it directly.
const LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';

// The newest day is still filling in for a while after midnight UTC, so the day before fills its gaps.
// Returns those two days as YYYY-MM-DD, newest first.
export function cloudDays(now = new Date()) {
  const day = n => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
  return [day(1), day(2)];
}

// A picture of the whole Earth for that day, laid out like the Earth's map
export function cloudUrl(day, width = 2048) {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: LAYER,
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(width),
    HEIGHT: String(width / 2),
    FORMAT: 'image/jpeg',
    TIME: day
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}
