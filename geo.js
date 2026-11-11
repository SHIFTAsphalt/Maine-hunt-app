/* Pure math helpers: sun/moon times, distance/bearing, UTM, point-in-polygon.
   No DOM, so it can be unit-tested in Node. */
(function (root) {
  'use strict';
  const PI = Math.PI, rad = PI / 180, deg = 180 / PI;
  const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const toJulian = d => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = d => toJulian(d) - J2000;
  const e = rad * 23.4397;

  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
  function eclipticLongitude(M) {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + rad * 102.9372 + PI;
  }
  const J0 = 0.0009;
  const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
  const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
  const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const hourAngle = (h, phi, d) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

  // Sun times for the calendar day containing `date` (local noon is used as anchor).
  function sunTimes(date, lat, lng) {
    const noon = new Date(date); noon.setHours(12, 0, 0, 0);
    const lw = rad * -lng, phi = rad * lat;
    const d = toDays(noon);
    const n = julianCycle(d, lw);
    const ds = approxTransit(0, lw, n);
    const M = solarMeanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L, 0);
    const Jnoon = solarTransitJ(ds, M, L);
    const out = { solarNoon: fromJulian(Jnoon) };
    const angles = [[-0.833, 'sunrise', 'sunset'], [-6, 'dawn', 'dusk']];
    for (const [a, rise, set] of angles) {
      const w = hourAngle(a * rad, phi, dec);
      const a2 = approxTransit(w, lw, n);
      const Jset = solarTransitJ(a2, M, L);
      const Jrise = Jnoon - (Jset - Jnoon);
      out[rise] = fromJulian(Jrise);
      out[set] = fromJulian(Jset);
    }
    return out;
  }

  // Maine general rule: 1/2 hour before sunrise to 1/2 hour after sunset.
  function huntingHours(date, lat, lng) {
    const s = sunTimes(date, lat, lng);
    return {
      start: new Date(s.sunrise.getTime() - 30 * 60000),
      end: new Date(s.sunset.getTime() + 30 * 60000),
      sunrise: s.sunrise, sunset: s.sunset, dawn: s.dawn, dusk: s.dusk, solarNoon: s.solarNoon
    };
  }

  function moonIllumination(date) {
    const d = toDays(date || new Date());
    const M = solarMeanAnomaly(d), L = eclipticLongitude(M);
    const sRA = rightAscension(L, 0), sDec = declination(L, 0);
    const Lm = rad * (218.316 + 13.176396 * d), Mm = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    const ml = Lm + rad * 6.289 * Math.sin(Mm), mb = rad * 5.128 * Math.sin(F);
    const mDist = 385001 - 20905 * Math.cos(Mm);
    const mRA = rightAscension(ml, mb), mDec = declination(ml, mb);
    const sdist = 149598000;
    const phi = Math.acos(Math.sin(sDec) * Math.sin(mDec) + Math.cos(sDec) * Math.cos(mDec) * Math.cos(sRA - mRA));
    const inc = Math.atan2(sdist * Math.sin(phi), mDist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(sDec) * Math.sin(sRA - mRA), Math.sin(sDec) * Math.cos(mDec) - Math.cos(sDec) * Math.sin(mDec) * Math.cos(sRA - mRA));
    const fraction = (1 + Math.cos(inc)) / 2;
    const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI;
    const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    const idx = Math.round(phase * 8) % 8;
    return { fraction, phase, name: names[idx] };
  }

  // ---------- distance / bearing ----------
  const R = 6371008.8;
  function distance(a, b) { // meters, a/b = [lat,lng]
    const p1 = a[0] * rad, p2 = b[0] * rad, dp = (b[0] - a[0]) * rad, dl = (b[1] - a[1]) * rad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) { // degrees true, 0..360
    const p1 = a[0] * rad, p2 = b[0] * rad, dl = (b[1] - a[1]) * rad;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * deg + 360) % 360;
  }
  function destination(a, brg, dist) {
    const d = dist / R, t = brg * rad, p1 = a[0] * rad, l1 = a[1] * rad;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * deg, ((l2 * deg + 540) % 360) - 180];
  }
  function polygonArea(pts) { // m^2, pts=[[lat,lng],...]
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length];
      s += (lo2 - lo1) * rad * (2 + Math.sin(la1 * rad) + Math.sin(la2 * rad));
    }
    return Math.abs(s * R * R / 2);
  }
  const compassPoints = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const cardinal = b => compassPoints[Math.round(((b % 360) + 360) % 360 / 22.5) % 16];

  // ---------- UTM (WGS84) ----------
  function toUTM(lat, lon) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const zone = Math.floor((lon + 180) / 6) + 1;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * rad;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = lat * rad, lam = lon * rad;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) y += 10000000;
    const bands = 'CDEFGHJKLMNPQRSTUVWXX';
    const band = bands[Math.floor((lat + 80) / 8)] || '';
    return { zone, band, easting: Math.round(x), northing: Math.round(y) };
  }
  function toDMS(v, pos, neg) {
    const s = v < 0 ? neg : pos; v = Math.abs(v);
    let tenths = Math.round(v * 36000); // total tenths of arc-seconds
    const d = Math.floor(tenths / 36000); tenths -= d * 36000;
    const m = Math.floor(tenths / 600); tenths -= m * 600;
    return `${d}°${m}'${(tenths / 10).toFixed(1)}"${s}`;
  }

  // ---------- point in polygon (GeoJSON, coords are [lng,lat]) ----------
  function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function polyContains(poly, x, y) {
    if (!ringContains(poly[0], x, y)) return false;
    for (let k = 1; k < poly.length; k++) if (ringContains(poly[k], x, y)) return false;
    return true;
  }
  function geometryContains(g, lng, lat) {
    if (!g) return false;
    if (g.type === 'Polygon') return polyContains(g.coordinates, lng, lat);
    if (g.type === 'MultiPolygon') return g.coordinates.some(p => polyContains(p, lng, lat));
    return false;
  }
  function findFeature(fc, lat, lng) {
    if (!fc || !fc.features) return null;
    for (const f of fc.features) if (geometryContains(f.geometry, lng, lat)) return f;
    return null;
  }

  // Tiles covering a bbox at zoom z (slippy map)
  function lon2tile(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
  function lat2tile(lat, z) { const r = lat * rad; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / PI) / 2 * 2 ** z); }
  function tilesInBounds(s, w, n, e2, z) {
    const x1 = lon2tile(w, z), x2 = lon2tile(e2, z), y1 = lat2tile(n, z), y2 = lat2tile(s, z);
    const out = [];
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) out.push([z, x, y]);
    return out;
  }

  const api = { sunTimes, huntingHours, moonIllumination, distance, bearing, destination, polygonArea, cardinal, toUTM, toDMS, geometryContains, findFeature, tilesInBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geo = api;
})(this);
