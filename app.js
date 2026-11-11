/* Maine Hunt Map — main app. Depends on Leaflet (L), geo.js (Geo), data.js (HUNT_DATA). */
(function () {
  'use strict';
  const D = window.HUNT_DATA;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('hm_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hm_' + k, JSON.stringify(v)); } catch (e) { toast('Storage full — could not save'); } }
  };
  const TZ = 'America/New_York';
  const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
  const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
  const miles = m => m < 160.9 ? `${Math.round(m * 3.28084)} ft` : `${(m / 1609.344).toFixed(m < 16093 ? 2 : 1)} mi`;
  const yards = m => `${Math.round(m * 1.09361)} yd`;
  const acres = m2 => `${(m2 / 4046.86).toFixed(m2 < 40468 ? 2 : 1)} acres`;
  const isoDay = d => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).forEach(x => p[x.type] = x.value); return `${p.year}-${p.month}-${p.day}`; };
  const weekdayME = d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(d));

  const settings = Object.assign({
    basemap: 'hybrid', overlays: { wmd: true }, coordFmt: 0, scent: false, wake: false, myWmdOnly: true
  }, store.get('settings', {}));
  D.overlays.forEach(o => { if (settings.overlays[o.id] == null) settings.overlays[o.id] = !!o.defaultOn; });
  const saveSettings = () => store.set('settings', settings);

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  // ---------------------------------------------------------------- map
  const startView = store.get('view', { c: [45.3, -69.2], z: 7 });
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19, minZoom: 5, worldCopyJump: false, tapHold: true })
    .setView(startView.c, startView.z);
  L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.on('moveend', () => store.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
  map.createPane('overlayPane2'); map.getPane('overlayPane2').style.zIndex = 420;
  map.createPane('wmdPane'); map.getPane('wmdPane').style.zIndex = 430;
  map.createPane('topPane'); map.getPane('topPane').style.zIndex = 440;
  map.createPane('labelsPane'); map.getPane('labelsPane').style.zIndex = 450; map.getPane('labelsPane').style.pointerEvents = 'none';

  // basemaps
  const baseLayers = {};
  function tileLayer(def, pane) {
    return L.tileLayer(def.url, { maxZoom: 19, maxNativeZoom: def.maxNativeZoom || 19, subdomains: def.subdomains || 'abc', attribution: def.attribution, pane: pane || 'tilePane', detectRetina: false });
  }
  D.basemaps.forEach(b => {
    const parts = [tileLayer(b)];
    (b.overlays || []).forEach(o => parts.push(tileLayer(o, 'labelsPane')));
    baseLayers[b.id] = L.layerGroup(parts);
  });
  let currentBase = null;
  function setBasemap(id) {
    if (!baseLayers[id]) id = D.basemaps[0].id;
    if (currentBase) map.removeLayer(currentBase);
    currentBase = baseLayers[id].addTo(map);
    settings.basemap = id; saveSettings();
  }
  setBasemap(settings.basemap);

  // ---------------------------------------------------------------- data fetching (cached for offline)
  const DATA_CACHE = 'hm-data-v1';
  async function cachedJSON(url, maxAgeDays) {
    let cache = null;
    try { cache = await caches.open(DATA_CACHE); } catch (e) { }
    if (cache) {
      const hit = await cache.match(url);
      if (hit) {
        const age = (Date.now() - Number(hit.headers.get('x-saved') || 0)) / 86400000;
        if (!navigator.onLine || age < (maxAgeDays || 30)) return hit.json();
      }
    }
    try {
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 10000);
      const r = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(to));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      const json = JSON.parse(txt);
      if (json.error) throw new Error(json.error.message || 'Service error');
      if (cache) await cache.put(url, new Response(txt, { headers: { 'content-type': 'application/json', 'x-saved': String(Date.now()) } }));
      return json;
    } catch (err) {
      if (cache) { const hit = await cache.match(url); if (hit) return hit.json(); }
      throw err;
    }
  }

  // Esri feature query → GeoJSON with paging
  function queryUrl(def, extra) {
    const p = Object.assign({
      where: def.where || '1=1', outFields: def.outFields || '*', returnGeometry: 'true', outSR: '4326', f: 'geojson',
      geometryPrecision: def.precision || 5
    }, def.maxOffset ? { maxAllowableOffset: def.maxOffset } : {}, def.orderBy ? { orderByFields: def.orderBy } : {}, extra || {});
    return def.url.replace(/\/$/, '') + '/query?' + Object.entries(p).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  }
  async function queryAll(def, extra) {
    const out = []; let offset = 0; const page = def.pageSize || 1000;
    for (let i = 0; i < 40; i++) {
      const j = await cachedJSON(queryUrl(def, Object.assign({}, extra, { resultOffset: offset, resultRecordCount: page })), def.cacheDays || 60);
      const feats = j.features || [];
      out.push(...feats);
      const more = j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
      if (!more || !feats.length) break;
      offset += feats.length;
    }
    return out;
  }

  // ---------------------------------------------------------------- overlays
  const overlayState = {}; // id -> {def, layer, loaded, ids:Set, cells:Set}
  let wmdData = null;
  function cellsFor(bounds, CELL) {
    const cells = [];
    for (let x = Math.floor(bounds.getWest() / CELL); x <= Math.floor(bounds.getEast() / CELL); x++)
      for (let y = Math.floor(bounds.getSouth() / CELL); y <= Math.floor(bounds.getNorth() / CELL); y++) cells.push([x, y]);
    return cells.length > 400 ? [] : cells;
  }
  function cellExtra(c, CELL) {
    const [x, y] = c;
    return { geometry: [x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL].map(v => v.toFixed(4)).join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  }
  function popupFor(def, props) {
    const rows = (def.popup || []).map(([label, key]) => {
      const v = typeof key === 'function' ? key(props) : props[key];
      return v == null || v === '' || v === ' ' ? '' : `<div><span style="color:#a3ab94">${esc(label)}:</span> ${esc(v)}</div>`;
    }).join('');
    const title = typeof def.title === 'function' ? def.title(props) : (props[def.title] || def.name);
    return `<b>${esc(title)}</b>${rows}<div style="color:#a3ab94;font-size:11px;margin-top:4px">${esc(def.name)}</div>`;
  }
  function makeGeoLayer(def) {
    return L.geoJSON(null, {
      pane: def.id === 'wmd' ? 'wmdPane' : 'overlayPane2',
      style: f => (typeof def.style === 'function' ? def.style(f.properties) : def.style),
      pointToLayer: (f, ll) => L.circleMarker(ll, Object.assign({ radius: 6, pane: 'overlayPane2' }, typeof def.style === 'function' ? def.style(f.properties) : def.style)),
      onEachFeature: (f, lyr) => {
        if (def.popup) lyr.bindPopup(() => popupFor(def, f.properties));
        lyr.on('click', e => { if (measure || crossMode) { lyr.closePopup(); L.DomEvent.stop(e); if (measure) { measure.pts.push([e.latlng.lat, e.latlng.lng]); paintMeasure(); } } });
      }
    });
  }
  function initOverlays() {
    D.overlays.forEach(def => {
      const st = { def, layer: null, ids: new Set(), cells: new Set(), loading: false };
      if (def.kind === 'tiles') st.layer = tileLayer(def, 'overlayPane2');
      else st.layer = makeGeoLayer(def);
      if (def.kind === 'tiles' && def.opacity) st.layer.setOpacity(def.opacity);
      overlayState[def.id] = st;
      if (settings.overlays[def.id]) enableOverlay(def.id, true);
    });
    loadWmd(); // always load WMDs (needed for "which WMD am I in")
    map.on('moveend', refreshBboxOverlays);
  }
  const wmdLabels = L.layerGroup();
  async function loadWmd() {
    const st = overlayState.wmd; if (!st || st.loaded || st.loading) return;
    st.loading = true;
    try {
      const feats = await queryAll(st.def);
      feats.forEach(f => { f.properties = f.properties || {}; f.properties.__wmd = D.wmdNumber(f.properties); });
      wmdData = { type: 'FeatureCollection', features: feats };
      st.layer.addData(wmdData);
      // labels at the visual center of the largest polygon
      feats.forEach(f => {
        const ll = labelPoint(f.geometry); if (!ll) return;
        L.marker(ll, { pane: 'labelsPane', interactive: false, icon: L.divIcon({ className: 'wmdlabel', html: String(f.properties.__wmd), iconSize: [40, 20], iconAnchor: [20, 10] }) }).addTo(wmdLabels);
      });
      st.loaded = true;
      updateWmd();
    } catch (e) {
      console.warn(e); toast('Could not load WMD boundaries — check signal', 4000);
    } finally { st.loading = false; }
  }
  function labelPoint(g) {
    if (!g) return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let best = null, bestA = -1;
    polys.forEach(p => {
      const ring = p[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const k = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += k; cx += (ring[j][0] + ring[i][0]) * k; cy += (ring[j][1] + ring[i][1]) * k;
      }
      if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [cy / (3 * a), cx / (3 * a)]; }
    });
    return best;
  }
  function enableOverlay(id, on) {
    const st = overlayState[id]; if (!st) return;
    settings.overlays[id] = on; saveSettings();
    if (on) {
      st.layer.addTo(map);
      if (id === 'wmd') wmdLabels.addTo(map);
      if (st.def.kind === 'bbox') refreshBboxOverlays();
      if (st.def.kind === 'all' && id !== 'wmd' && !st.loaded) loadAllOverlay(st);
    } else {
      map.removeLayer(st.layer);
      if (id === 'wmd') map.removeLayer(wmdLabels);
    }
  }
  async function loadAllOverlay(st) {
    if (st.loading) return; st.loading = true;
    try { st.layer.addData({ type: 'FeatureCollection', features: await queryAll(st.def) }); st.loaded = true; }
    catch (e) { toast(`Could not load ${st.def.name}`); } finally { st.loading = false; }
  }
  async function loadCells(st, cells) {
    const defs = [st.def].concat((st.def.extraUrls || []).map((u, k) => Object.assign({}, st.def, { url: u, _k: k + 1 })));
    for (const c of cells) for (const def of defs) {
      const key = (def._k || 0) + ':' + c.join(',');
      if (st.cells.has(key)) continue;
      st.cells.add(key);
      try {
        const feats = await queryAll(def, cellExtra(c, st.def.cell || 0.2));
        const fresh = feats.filter(f => {
          const id = f.id != null ? f.id : (f.properties && (f.properties.OBJECTID || f.properties.objectid || f.properties.FID));
          if (id == null) return true;
          const uid = (def._k || 0) + ':' + id;
          if (st.ids.has(uid)) return false; st.ids.add(uid); return true;
        });
        if (fresh.length) st.layer.addData({ type: 'FeatureCollection', features: fresh });
      } catch (e) { st.cells.delete(key); console.warn(st.def.id, e); }
    }
  }
  let bboxTimer = null;
  function refreshBboxOverlays() {
    clearTimeout(bboxTimer);
    bboxTimer = setTimeout(() => {
      Object.values(overlayState).forEach(st => {
        if (st.def.kind !== 'bbox' || !settings.overlays[st.def.id]) return;
        if (map.getZoom() < (st.def.minZoom || 11)) return;
        loadCells(st, cellsFor(map.getBounds().pad(0.1), st.def.cell || 0.2));
      });
    }, 350);
  }

  // ---------------------------------------------------------------- GPS
  let me = null; // {lat,lng,acc,speed,alt,time}
  let follow = false;
  const meIcon = L.divIcon({
    className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    html: '<div class="me" id="meDot"><svg class="cone" viewBox="0 0 80 80"><defs><radialGradient id="cg"><stop offset="0" stop-color="#5ab4ff" stop-opacity=".7"/><stop offset="1" stop-color="#5ab4ff" stop-opacity="0"/></radialGradient></defs><path d="M40 40 L22 2 A40 40 0 0 1 58 2 Z" fill="url(#cg)"/></svg><div class="c"></div></div>'
  });
  const meMarker = L.marker([0, 0], { icon: meIcon, interactive: false, zIndexOffset: 1000 });
  const accCircle = L.circle([0, 0], { radius: 1, color: '#5ab4ff', weight: 1, fillOpacity: .12, interactive: false });
  let gpsWatch = null;
  function startGps() {
    if (!('geolocation' in navigator)) { toast('GPS not available on this device'); return; }
    if (gpsWatch != null) return;
    gpsWatch = navigator.geolocation.watchPosition(onPos, err => {
      const msg = err.code === 1 ? 'Location permission denied. Enable it in Settings › Safari › Location (or your browser settings).' : 'Waiting for a GPS fix…';
      toast(msg, 5000);
      if (err.code === 1) { $('#hrsVal').textContent = 'Location off — using map center'; gpsWatch = null; }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function onPos(p) {
    const first = !me;
    me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, speed: p.coords.speed, time: p.timestamp, heading: p.coords.heading };
    meMarker.setLatLng([me.lat, me.lng]); accCircle.setLatLng([me.lat, me.lng]).setRadius(me.acc);
    if (!map.hasLayer(meMarker)) { accCircle.addTo(map); meMarker.addTo(map); }
    if (first) { map.setView([me.lat, me.lng], Math.max(map.getZoom(), 14)); follow = true; updateLocateBtn(); }
    else if (follow) map.panTo([me.lat, me.lng], { animate: true });
    onTrackPoint(me);
    updateWmd(); updateHours(); updateCoords(); updateNav(); maybeFetchWeather(); updateScent();
  }
  map.on('dragstart', () => { if (follow) { follow = false; updateLocateBtn(); } });
  function updateLocateBtn() { $('#fabLocate').classList.toggle('follow', follow); }
  $('#fabLocate').onclick = () => {
    startGps();
    if (!me) { toast('Getting your location…'); return; }
    if (follow) { follow = false; } else { follow = true; map.setView([me.lat, me.lng], Math.max(map.getZoom(), 15)); }
    updateLocateBtn();
  };
  const here = () => me ? [me.lat, me.lng] : [map.getCenter().lat, map.getCenter().lng];

  // ---------------------------------------------------------------- WMD lookup
  let currentWmd = null;
  function wmdAt(lat, lng) { const f = Geo.findFeature(wmdData, lat, lng); return f ? f.properties.__wmd : null; }
  function updateWmd() {
    const [lat, lng] = here();
    currentWmd = wmdData ? wmdAt(lat, lng) : null;
    $('#wmdVal').textContent = currentWmd != null ? currentWmd : (wmdData ? 'Out' : '--');
  }

  // ---------------------------------------------------------------- hunting hours
  const REF = D.rules.hoursRef;
  const legal = d => Geo.huntingHours(d, REF.lat, REF.lng);
  function hoursStatus(now) {
    const h = legal(now);
    const sunday = weekdayME(now) === 0;
    if (sunday && D.rules.noSunday) {
      const tmr = legal(new Date(now.getTime() + 86400000));
      return { cls: 'off', label: 'Sunday — no hunting', val: `Opens Mon ${fmtTime(tmr.start)}`, h };
    }
    if (now < h.start) {
      const ms = h.start - now;
      return { cls: ms < 3600000 ? 'soon' : 'off', label: 'Not legal yet', val: `Opens ${fmtTime(h.start)} · in ${fmtDur(ms)}`, short: `Opens ${fmtTime(h.start)} (${fmtDur(ms)})`, h };
    }
    if (now <= h.end) {
      const ms = h.end - now;
      return { cls: ms < 1800000 ? 'soon' : 'on', label: 'Legal shooting time', val: `Until ${fmtTime(h.end)} · ${fmtDur(ms)} left`, short: `Til ${fmtTime(h.end).replace(' PM', 'p').replace(' AM', 'a')} · ${fmtDur(ms)} left`, h };
    }
    let next = new Date(now.getTime() + 86400000);
    if (D.rules.noSunday && weekdayME(next) === 0) next = new Date(next.getTime() + 86400000);
    const nh = legal(next);
    return { cls: 'off', label: 'Closed for today', val: `Opens ${weekdayME(next) !== weekdayME(new Date(now.getTime() + 86400000)) ? 'Mon ' : ''}${fmtTime(nh.start)}`, h };
  }
  function updateHours() {
    const s = hoursStatus(new Date());
    $('#hrsDot').className = 'dot ' + s.cls; $('#hrsLabel').textContent = s.label; $('#hrsVal').textContent = s.short || s.val;
    if (sheetView === 'hours') renderHours(true);
  }
  setInterval(updateHours, 20000);

  // ---------------------------------------------------------------- weather / wind (Open-Meteo, no key)
  let wx = store.get('wx', null);
  let wxHourSel = 0; // offset hours from now for scent cone
  let wxFetching = false;
  function maybeFetchWeather(force) {
    const [lat, lng] = here();
    const stale = !wx || (Date.now() - wx.saved > 15 * 60000) || Geo.distance([lat, lng], [wx.lat, wx.lng]) > 8000;
    if ((stale || force) && !wxFetching && navigator.onLine !== false) fetchWeather(lat, lng);
    else renderWindChip();
  }
  async function fetchWeather(lat, lng) {
    wxFetching = true;
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,weather_code' +
      '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FNew_York&past_hours=6&forecast_days=7&forecast_hours=48';
    try {
      const r = await fetch(u); if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      wx = { lat, lng, saved: Date.now(), data: j }; store.set('wx', wx);
      renderWindChip(); updateScent();
      if (sheetView === 'wind') renderWind();
    } catch (e) { if (!wx) $('#windVal').textContent = 'offline'; }
    finally { wxFetching = false; }
  }
  // hourly rows from now (index 0 = current hour)
  function wxHours() {
    if (!wx) return [];
    const h = wx.data.hourly; if (!h) return [];
    const nowKey = new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 13); // 'YYYY-MM-DD HH'
    let i0 = h.time.findIndex(t => t.replace('T', ' ').slice(0, 13) >= nowKey);
    if (i0 < 0) return [];
    const rows = [];
    for (let i = i0; i < h.time.length; i++) rows.push({ i, time: h.time[i], temp: h.temperature_2m[i], pop: h.precipitation_probability[i], code: h.weather_code[i], p: h.surface_pressure[i], ws: h.wind_speed_10m[i], wd: h.wind_direction_10m[i], wg: h.wind_gusts_10m[i] });
    return rows;
  }
  function windNow() {
    if (!wx) return null;
    if (wxHourSel > 0) { const r = wxHours()[wxHourSel]; if (r) return { dir: r.wd, speed: r.ws, gust: r.wg, at: r.time }; }
    const r0 = wxHours()[0]; if (r0 && Date.now() - wx.saved > 3 * 3600000) return { dir: r0.wd, speed: r0.ws, gust: r0.wg, at: r0.time };
    const c = wx.data.current; return { dir: c.wind_direction_10m, speed: c.wind_speed_10m, gust: c.wind_gusts_10m, at: null };
  }
  function arrowSvg(dirFrom, size) {
    return `<svg viewBox="0 0 24 24" style="width:${size || 22}px;height:${size || 22}px;transform:rotate(${(dirFrom + 180) % 360}deg)"><path d="M12 2l5 14-5-3-5 3z" fill="#5ab4ff"/></svg>`;
  }
  function renderWindChip() {
    if (!wx) return;
    const c = wx.data.current;
    $('#windArrow').style.transform = `rotate(${(c.wind_direction_10m + 180) % 360}deg)`;
    $('#windVal').textContent = `${Geo.cardinal(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)}${c.wind_gusts_10m > c.wind_speed_10m + 4 ? '–' + Math.round(c.wind_gusts_10m) : ''}`;
  }
  const WX = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'T-storm, hail', 99: 'T-storm, hail' };
  const WXI = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 || (c >= 80 && c <= 82) ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';

  // ---------------------------------------------------------------- scent cone
  const scentLayer = L.layerGroup().addTo(map);
  let scentAnchor = null; // null = me, else [lat,lng] of a pin
  function updateScent() {
    scentLayer.clearLayers();
    $('#fabScent').classList.toggle('active', settings.scent);
    if (!settings.scent) return;
    const w = windNow(); if (!w) return;
    const origin = scentAnchor || (me ? [me.lat, me.lng] : null); if (!origin) return;
    const downwind = (w.dir + 180) % 360;
    const len = Math.min(900, 180 + w.speed * 45);
    const half = w.speed < 4 ? 40 : w.speed < 8 ? 25 : 16; // light wind swirls
    const pts = [origin];
    for (let a = -half; a <= half; a += 4) pts.push(Geo.destination(origin, downwind + a, len));
    L.polygon(pts, { pane: 'topPane', color: '#ff6a13', weight: 1, fillColor: '#ff6a13', fillOpacity: .22, interactive: false, dashArray: '4 4' }).addTo(scentLayer);
    const mid = Geo.destination(origin, downwind, len * 0.55);
    L.marker(mid, { interactive: false, icon: L.divIcon({ className: '', iconSize: [120, 18], iconAnchor: [60, 9], html: `<div style="text-align:center;color:#fff;font-size:11px;font-weight:700;text-shadow:0 0 3px #000">scent ${w.at ? '@ ' + w.at.slice(11, 16) : ''}</div>` }) }).addTo(scentLayer);
  }
  $('#fabScent').onclick = () => {
    settings.scent = !settings.scent; saveSettings();
    if (settings.scent && !wx) { maybeFetchWeather(true); toast('Loading wind…'); }
    if (settings.scent) toast('Scent cone shows where the wind carries your scent');
    if (!settings.scent) scentAnchor = null;
    updateScent();
  };

  // ---------------------------------------------------------------- compass
  let heading = null, compassOn = false;
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
    if (h == null) return;
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + so + 360) % 360;
    // phones report MAGNETIC north; Maine declination is ~15–18° W. Convert to true.
    const [dla, dln] = here(); const decl = -(14 + (dln + 71) * 0.9 + (dla - 43) * 0.3);
    h = (h + decl + 360) % 360;
    // smooth
    if (heading == null) heading = h; else { let d = ((h - heading + 540) % 360) - 180; heading = (heading + d * 0.3 + 360) % 360; }
    paintHeading();
  }
  let paintQueued = false;
  function paintHeading() {
    if (paintQueued) return; paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false; if (heading == null) return;
      $('#fabNorth svg').style.transform = `rotate(${-heading}deg)`;
      const dot = document.getElementById('meDot');
      if (dot) { dot.classList.add('hd'); dot.querySelector('.cone').style.transform = `rotate(${heading}deg)`; }
      if (sheetView === 'compass') paintRose();
    });
  }
  async function startCompass() {
    if (compassOn) return true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { toast('Compass permission denied'); return false; }
      }
      if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient, true);
      else window.addEventListener('deviceorientation', onOrient, true);
      compassOn = true; return true;
    } catch (e) { toast('Compass not available on this device'); return false; }
  }
  $('#fabNorth').onclick = () => openSheet('compass');

  // ---------------------------------------------------------------- pins / waypoints
  const TYPES = D.pinTypes;
  const typeOf = id => TYPES.find(t => t.id === id) || TYPES[TYPES.length - 1];
  let pins = store.get('pins', []);
  const pinLayer = L.layerGroup().addTo(map);
  const pinMarkers = {};
  const savePins = () => store.set('pins', pins);
  function pinIcon(p) {
    const t = typeOf(p.type);
    return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30], html: `<div class="pin" style="background:${t.color}"><span>${t.emoji}</span></div>` });
  }
  function drawPins() {
    pinLayer.clearLayers();
    pins.forEach(p => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p) }).addTo(pinLayer);
      m.bindTooltip(esc(p.name), { permanent: map.getZoom() >= 15, direction: 'top', offset: [0, -32], className: 'mlabel' });
      m.on('click', () => openPin(p.id));
      pinMarkers[p.id] = m;
    });
  }
  map.on('zoomend', () => {
    const show = map.getZoom() >= 15;
    if (show === drawPins._last) return; drawPins._last = show; drawPins();
  });
  function newPin(lat, lng, type) {
    const n = pins.filter(p => p.type === (type || 'stand')).length + 1;
    const t = typeOf(type || 'stand');
    const p = { id: 'p' + Date.now().toString(36), lat, lng, type: t.id, name: `${t.label} ${n}`, notes: '', created: Date.now() };
    pins.push(p); savePins(); drawPins(); openPin(p.id, true);
  }
  map.on('contextmenu', e => { if (measure || crossMode) return; newPin(e.latlng.lat, e.latlng.lng); });

  // navigation target
  let navTarget = store.get('nav', null); // pin id
  const navLine = L.polyline([], { pane: 'topPane', color: '#ffd23f', weight: 3, dashArray: '8 8', interactive: false }).addTo(map);
  function updateNav() {
    const p = pins.find(x => x.id === navTarget);
    if (!p) { navLine.setLatLngs([]); updateCoords(); return; }
    const from = here();
    navLine.setLatLngs([from, [p.lat, p.lng]]);
    updateCoords();
  }

  // ---------------------------------------------------------------- coordinate readout
  function fmtCoord(lat, lng) {
    switch (settings.coordFmt) {
      case 1: return `${Geo.toDMS(lat, 'N', 'S')} ${Geo.toDMS(lng, 'E', 'W')}`;
      case 2: { const u = Geo.toUTM(lat, lng); return `${u.zone}${u.band} ${u.easting}E ${u.northing}N`; }
      default: return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }
  function updateCoords() {
    const el = $('#coords');
    const pos = me && follow ? [me.lat, me.lng] : (me && !crossMode ? [me.lat, me.lng] : [map.getCenter().lat, map.getCenter().lng]);
    let s = (me && !crossMode ? '📍 ' : '⊕ ') + fmtCoord(pos[0], pos[1]);
    if (me && !crossMode) s += ` ±${Math.round(me.acc * 3.28)}ft`;
    const p = pins.find(x => x.id === navTarget);
    if (p) {
      const from = here(), d = Geo.distance(from, [p.lat, p.lng]), b = Geo.bearing(from, [p.lat, p.lng]);
      s += `<br>➜ ${esc(p.name)}: ${miles(d)} ${Geo.cardinal(b)} (${Math.round(b)}°)`;
    }
    el.innerHTML = s;
  }
  $('#coords').onclick = () => { settings.coordFmt = (settings.coordFmt + 1) % 3; saveSettings(); updateCoords(); };
  map.on('move', () => { if (crossMode || !me) updateCoords(); });

  // ---------------------------------------------------------------- crosshair mode (drop pin / pick point)
  let crossMode = null; // {onPick}
  function startCross(label, onPick) {
    closeSheet();
    crossMode = { onPick };
    $('#cross').classList.add('show');
    showBar(`<span class="grow">${label}</span><button class="btn sm" id="bxCancel">Cancel</button>${me ? '<button class="btn sm" id="bxMe">At me</button>' : ''}<button class="btn sm primary" id="bxOk">Place</button>`);
    $('#bxCancel').onclick = endCross;
    $('#bxOk').onclick = () => { const c = map.getCenter(); const f = crossMode.onPick; endCross(); f(c.lat, c.lng); };
    if (me) $('#bxMe').onclick = () => { const f = crossMode.onPick; endCross(); f(me.lat, me.lng); };
    updateCoords();
  }
  function endCross() { crossMode = null; $('#cross').classList.remove('show'); hideBar(); updateCoords(); }

  // floating action bar above nav
  function showBar(html) {
    let b = $('#actbar');
    if (!b) {
      b = document.createElement('div'); b.id = 'actbar';
      b.style.cssText = 'position:fixed;left:calc(var(--sl) + 8px);right:calc(var(--sr) + 8px);bottom:calc(var(--sb) + 66px);z-index:1150;background:rgba(27,32,22,.97);border:1px solid var(--line);border-radius:14px;padding:8px 10px;display:flex;align-items:center;gap:6px;box-shadow:0 4px 16px #0008';
      document.body.appendChild(b);
    }
    b.innerHTML = html; b.style.display = 'flex';
    $('#coords').style.bottom = 'calc(var(--sb) + 130px)';
  }
  function hideBar() { const b = $('#actbar'); if (b) b.style.display = 'none'; $('#coords').style.bottom = ''; }

  // ---------------------------------------------------------------- tracks
  let tracks = store.get('tracks', []); // {id,name,pts:[[lat,lng,t]],dist,start,end,visible,color}
  let rec = store.get('rec', null); // active recording
  const trackLayer = L.layerGroup().addTo(map);
  const recLine = L.polyline([], { pane: 'topPane', color: '#ff4d4d', weight: 4 }).addTo(map);
  function trackDist(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Geo.distance(pts[i - 1], pts[i]); return d; }
  function drawTracks() {
    trackLayer.clearLayers();
    tracks.filter(t => t.visible !== false).forEach(t => L.polyline(t.pts.map(p => [p[0], p[1]]), { pane: 'topPane', color: t.color || '#ffd23f', weight: 3, opacity: .9 }).bindPopup(`<b>${esc(t.name)}</b><div>${miles(t.dist)} · ${fmtDur(t.end - t.start)}</div>`).addTo(trackLayer));
  }
  function onTrackPoint(p) {
    if (!rec || rec.paused) return;
    if (p.acc > 35) return;
    const last = rec.pts[rec.pts.length - 1];
    if (last && Geo.distance([last[0], last[1]], [p.lat, p.lng]) < 6) return;
    rec.pts.push([+p.lat.toFixed(6), +p.lng.toFixed(6), Date.now()]);
    rec.dist = trackDist(rec.pts);
    store.set('rec', rec); recLine.setLatLngs(rec.pts.map(q => [q[0], q[1]]));
    paintRec();
  }
  function paintRec() {
    $('#recBadge').classList.toggle('show', !!rec);
    if (rec) $('#recStat').textContent = `${miles(rec.dist || 0)} · ${fmtDur(Date.now() - rec.start)}`;
    if (sheetView === 'track') renderTrack();
  }
  setInterval(() => rec && paintRec(), 30000);
  function startRec() { startGps(); rec = { id: 't' + Date.now().toString(36), start: Date.now(), pts: [], dist: 0 }; store.set('rec', rec); recLine.setLatLngs([]); paintRec(); toast('Recording track. Keep the app open — phones pause GPS for web apps when the screen locks.', 5000); }
  function stopRec() {
    if (!rec) return;
    if (rec.pts.length > 1) {
      const d = new Date(rec.start);
      tracks.unshift({ id: rec.id, name: `Track ${fmtDay(d)} ${fmtTime(d)}`, pts: rec.pts, dist: rec.dist, start: rec.start, end: Date.now(), visible: true, color: '#ffd23f' });
      store.set('tracks', tracks);
    } else toast('Track too short — not saved');
    rec = null; store.set('rec', null); recLine.setLatLngs([]); drawTracks(); paintRec();
  }
  $('#recBadge').onclick = () => openSheet('track');

  // ---------------------------------------------------------------- measure
  let measure = null;
  const measureLayer = L.layerGroup().addTo(map);
  function startMeasure() {
    closeSheet(); measure = { pts: [] };
    toast('Tap the map to add points');
    paintMeasure();
  }
  function paintMeasure() {
    measureLayer.clearLayers();
    if (!measure) { hideBar(); return; }
    const pts = measure.pts;
    if (pts.length) {
      L.polyline(pts, { pane: 'topPane', color: '#fff', weight: 3, dashArray: '6 6', interactive: false }).addTo(measureLayer);
      pts.forEach(p => L.circleMarker(p, { pane: 'topPane', radius: 5, color: '#ff6a13', fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(measureLayer));
      if (pts.length > 2) L.polygon(pts, { pane: 'topPane', color: '#ff6a13', weight: 0, fillOpacity: .12, interactive: false }).addTo(measureLayer);
    }
    const d = trackDist(pts);
    const area = pts.length > 2 ? ` · area ${acres(Geo.polygonArea(pts))}` : '';
    showBar(`<span class="grow small"><b>${pts.length < 2 ? 'Tap map to measure' : miles(d) + ' (' + yards(d) + ')'}</b>${area}</span><button class="btn sm" id="mUndo">Undo</button><button class="btn sm primary" id="mDone">Done</button>`);
    $('#mUndo').onclick = () => { measure.pts.pop(); paintMeasure(); };
    $('#mDone').onclick = () => { measure = null; paintMeasure(); };
  }
  map.on('click', e => {
    if (measure) { measure.pts.push([e.latlng.lat, e.latlng.lng]); paintMeasure(); return; }
  });

  // ---------------------------------------------------------------- sheet framework
  let sheetView = null;
  const views = {};
  function openSheet(view, arg) {
    sheetView = view;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.open === view));
    $('#sheet').classList.add('open'); $('#sheet').setAttribute('aria-hidden', 'false');
    views[view](arg);
    $('#sheetBody').scrollTop = 0;
  }
  function closeSheet() {
    sheetView = null; $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true');
    document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on'));
  }
  function setSheet(title, html) { $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; }
  $('#sheetClose').onclick = closeSheet;
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    if (sheetView === b.dataset.open) closeSheet(); else openSheet(b.dataset.open);
  }));
  $('#fabLayers').onclick = () => sheetView === 'layers' ? closeSheet() : openSheet('layers');
  // swipe down to close
  (function () {
    let y0 = null; const s = $('#sheet');
    s.addEventListener('touchstart', e => { if ($('#sheetBody').scrollTop <= 0 && e.target.closest('header,.grab')) y0 = e.touches[0].clientY; }, { passive: true });
    s.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 60) closeSheet(); y0 = null; });
  })();
  function modal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.add('show'); }
  function closeModal() { $('#modal').classList.remove('show'); }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  function confirmBox(msg, okLabel, cb) {
    modal(`<p style="margin-top:0">${esc(msg)}</p><div class="btns"><button class="btn" id="cNo">Cancel</button><button class="btn danger" id="cYes">${esc(okLabel)}</button></div>`);
    $('#cNo').onclick = closeModal; $('#cYes').onclick = () => { closeModal(); cb(); };
  }

  // ---- layers
  views.layers = () => {
    const base = D.basemaps.map(b => `<button data-b="${b.id}" class="${settings.basemap === b.id ? 'on' : ''}">${esc(b.name)}</button>`).join('');
    const ov = D.overlays.map(o => `<div class="row"><span style="width:18px;height:18px;border-radius:4px;flex:0 0 18px;background:${o.swatch};border:2px solid ${o.swatchLine || o.swatch}"></span><div class="grow"><div>${esc(o.name)}</div><div class="sub">${esc(o.desc || '')}${o.minZoom ? ` · zoom in to see` : ''}</div></div><label class="switch"><input type="checkbox" data-o="${o.id}" ${settings.overlays[o.id] ? 'checked' : ''}><span></span></label></div>`).join('');
    setSheet('Map layers', `<h3>Base map</h3><div class="radio">${base}</div><h3>Overlays</h3>${ov}<p class="small muted">Land layers are for reference only. Boundaries can be off by many yards, and land not shown as public is usually private: in Maine, posted land and landowner wishes always apply.</p>`);
    document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { setBasemap(b.dataset.b); views.layers(); });
    document.querySelectorAll('[data-o]').forEach(i => i.onchange = () => enableOverlay(i.dataset.o, i.checked));
  };

  // ---- hours
  function renderHours(soft) {
    const now = new Date(); const [lat, lng] = here(); const s = hoursStatus(now); const h = s.h;
    const loc = Geo.sunTimes(now, lat, lng);
    const moon = Geo.moonIllumination(now);
    let rows = '';
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const hh = legal(d);
      const sun = D.rules.noSunday && weekdayME(d) === 0;
      rows += `<tr class="${i === 0 ? 'today' : ''} ${sun ? 'sun' : ''}"><td>${fmtDay(d)}</td><td>${fmtTime(hh.start)}</td><td>${fmtTime(hh.end)}</td><td class="muted">${fmtTime(hh.sunset)}</td></tr>`;
    }
    const html = `
      <div class="card"><div style="display:flex;align-items:center;gap:8px"><span class="dot ${s.cls}"></span><b>${esc(s.label)}</b></div><div class="big" style="margin-top:4px">${esc(s.val)}</div>
      <div class="small muted">Statewide times (based on Bangor sunrise and sunset)${currentWmd != null ? ' · you\'re in WMD ' + currentWmd : ''}</div></div>
      <div class="grid2">
        <div class="kv"><small>Legal start</small><b>${fmtTime(h.start)}</b></div><div class="kv"><small>Legal end</small><b>${fmtTime(h.end)}</b></div>
        <div class="kv"><small>Waterfowl end</small><b>${fmtTime(h.sunset)}</b><div class="small muted">at sunset</div></div><div class="kv"><small>Moon</small><b style="font-size:15px">${moon.name} ${Math.round(moon.fraction * 100)}%</b></div>
        <div class="kv"><small>Sunrise ${me ? 'here' : '(map)'}</small><b>${fmtTime(loc.sunrise)}</b></div><div class="kv"><small>Sunset ${me ? 'here' : '(map)'}</small><b>${fmtTime(loc.sunset)}</b></div>
      </div>
      <h3>Next 14 days</h3>
      <table class="hrs"><tr><th>Day</th><th>Start</th><th>End</th><th>Waterfowl end</th></tr>${rows}</table>
      <div class="warn">${D.rules.hoursNote}</div>`;
    if (soft && $('#sheetTitle').textContent !== 'Hunting hours') return;
    setSheet('Hunting hours', html);
  }
  views.hours = () => renderHours(false);

  // ---- wind / weather
  function renderWind() {
    if (!wx) { setSheet('Wind & weather', `<p class="muted">${navigator.onLine === false ? 'No signal. Weather loads the next time you have service.' : 'Loading forecast…'}</p>`); maybeFetchWeather(true); return; }
    const c = wx.data.current, hrs = wxHours();
    const past = wx.data.hourly; let trend = '';
    const idxNow = hrs.length ? hrs[0].i : -1;
    if (idxNow >= 3) {
      const dp = past.surface_pressure[idxNow] - past.surface_pressure[idxNow - 3];
      trend = Math.abs(dp) < 0.7 ? 'steady' : dp > 0 ? `rising +${dp.toFixed(1)} hPa` : `falling ${dp.toFixed(1)} hPa`;
    }
    const strip = hrs.slice(0, 24).map((r, k) => `<div class="h ${k === wxHourSel ? 'sel' : ''}" data-h="${k}"><div>${k === 0 ? 'Now' : (h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'))(+r.time.slice(11, 13))}</div>${arrowSvg(r.wd)}<b>${Math.round(r.ws)}</b><div class="muted">${Geo.cardinal(r.wd)}</div><div class="muted">${Math.round(r.temp)}°</div>${r.pop >= 20 ? `<div style="color:#5ab4ff">${r.pop}%</div>` : ''}</div>`).join('');
    const d = wx.data.daily;
    const days = d ? d.time.map((t, i) => `<tr><td>${fmtDay(new Date(t + 'T12:00:00'))}</td><td>${WXI(d.weather_code[i])} ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</td><td>${Geo.cardinal(d.wind_direction_10m_dominant[i])} ${Math.round(d.wind_speed_10m_max[i])}</td><td>${d.precipitation_probability_max[i] ?? '–'}%</td></tr>`).join('') : '';
    const age = Math.round((Date.now() - wx.saved) / 60000);
    setSheet('Wind & weather', `
      <div class="card" style="display:flex;align-items:center;gap:14px">${arrowSvg(c.wind_direction_10m, 54)}
        <div><div class="big">${Geo.cardinal(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} mph</div>
        <div class="muted">From ${Math.round(c.wind_direction_10m)}° · gusts ${Math.round(c.wind_gusts_10m)} mph</div>
        <div class="small muted">The arrow points the way the wind blows, which is where your scent goes.</div></div></div>
      <div class="grid2">
        <div class="kv"><small>Temp</small><b>${Math.round(c.temperature_2m)}°F</b> <span class="muted small">feels ${Math.round(c.apparent_temperature)}°</span></div>
        <div class="kv"><small>Sky</small><b>${WXI(c.weather_code)} ${WX[c.weather_code] || ''}</b></div>
        <div class="kv"><small>Pressure</small><b>${(c.surface_pressure * 0.02953).toFixed(2)} inHg</b><div class="small muted">${trend ? 'Last 3h: ' + trend : ''}</div></div>
        <div class="kv"><small>Humidity</small><b>${c.relative_humidity_2m}%</b></div>
      </div>
      <h3>Hourly wind — tap an hour to show its scent cone</h3><div class="hourly">${strip}</div>
      <div class="btns"><button class="btn ${settings.scent ? 'primary' : ''}" id="wScent">${settings.scent ? 'Scent cone on' : 'Show scent cone'}</button><button class="btn" id="wRefresh">Refresh</button></div>
      <h3>7-day</h3><table class="hrs"><tr><th>Day</th><th>Hi / Lo</th><th>Wind</th><th>Precip</th></tr>${days}</table>
      <p class="small muted">Forecast from Open-Meteo for ${wx.lat.toFixed(3)}, ${wx.lng.toFixed(3)} · updated ${age} min ago. Ground-level wind in the woods swirls and is lighter than the forecast. Check it with a puff bottle.</p>`);
    document.querySelectorAll('.hourly .h').forEach(el => el.onclick = () => { wxHourSel = +el.dataset.h; settings.scent = true; saveSettings(); updateScent(); renderWind(); });
    $('#wScent').onclick = () => { settings.scent = !settings.scent; saveSettings(); updateScent(); renderWind(); };
    $('#wRefresh').onclick = () => { maybeFetchWeather(true); toast('Refreshing…'); };
  }
  views.wind = renderWind;

  // ---- compass
  function paintRose() {
    const rose = $('#rose'); if (!rose || heading == null) return;
    rose.querySelector('.dial').setAttribute('transform', `rotate(${-heading} 150 150)`);
    $('#hdgVal').textContent = `${Math.round(heading)}° ${Geo.cardinal(heading)}`;
  }
  views.compass = () => {
    const ticks = []; for (let a = 0; a < 360; a += 10) { const big = a % 30 === 0; ticks.push(`<line x1="150" y1="${big ? 18 : 24}" x2="150" y2="34" stroke="${big ? '#fff' : '#889'}" stroke-width="${big ? 3 : 1.5}" transform="rotate(${a} 150 150)"/>`); }
    const labels = [['N', 0, '#ff4d4d'], ['E', 90, '#fff'], ['S', 180, '#fff'], ['W', 270, '#fff']].map(([t, a, c]) => `<text x="150" y="58" fill="${c}" font-size="22" font-weight="800" text-anchor="middle" transform="rotate(${a} 150 150)">${t}</text>`).join('');
    const w = windNow();
    const windMark = w ? `<g transform="rotate(${(w.dir + 180) % 360} 150 150)"><path d="M150 70 l10 28 h-20z" fill="#5ab4ff"/><text x="150" y="112" fill="#5ab4ff" font-size="11" text-anchor="middle">wind</text></g>` : '';
    const p = pins.find(x => x.id === navTarget);
    const tgt = p ? `<g transform="rotate(${Geo.bearing(here(), [p.lat, p.lng])} 150 150)"><path d="M150 36 l12 30 h-24z" fill="#ffd23f"/></g>` : '';
    setSheet('Compass', `
      <svg id="rose" viewBox="0 0 300 300"><circle cx="150" cy="150" r="140" fill="#151a11" stroke="#3d4733" stroke-width="3"/>
      <g class="dial">${ticks.join('')}${labels}${windMark}${tgt}</g>
      <path d="M150 4 l10 18 h-20z" fill="#ff6a13"/><circle cx="150" cy="150" r="5" fill="#ff6a13"/></svg>
      <div style="text-align:center"><div class="big" id="hdgVal">${heading == null ? '—' : Math.round(heading) + '°'}</div>
      <div class="small muted">True heading · <span style="color:#5ab4ff">blue = wind direction</span>${p ? ` · <span style="color:#ffd23f">yellow = ${esc(p.name)} (${miles(Geo.distance(here(), [p.lat, p.lng]))})</span>` : ''}</div></div>
      ${compassOn ? '' : '<div class="btns"><button class="btn primary" id="cStart">Turn on compass</button></div>'}
      <p class="small muted">Hold the phone flat, away from metal like your truck or rifle. If it drifts, move the phone in a figure-8 to recalibrate. Bring a real compass as backup.</p>`);
    const b = $('#cStart'); if (b) b.onclick = async () => { if (await startCompass()) views.compass(); };
    paintRose();
  };

  // ---- pins
  views.pins = () => {
    const from = here();
    const list = pins.slice().sort((a, b) => Geo.distance(from, [a.lat, a.lng]) - Geo.distance(from, [b.lat, b.lng]));
    const rows = list.map(p => { const t = typeOf(p.type); const d = Geo.distance(from, [p.lat, p.lng]); const b = Geo.bearing(from, [p.lat, p.lng]); return `<div class="row" data-p="${p.id}"><span style="font-size:22px">${t.emoji}</span><div class="grow"><div><b>${esc(p.name)}</b>${navTarget === p.id ? ' <span style="color:#ffd23f">● navigating</span>' : ''}</div><div class="sub">${t.label} · ${miles(d)} ${Geo.cardinal(b)}</div></div><span class="muted">›</span></div>`; }).join('');
    setSheet(`Pins (${pins.length})`, `
      <div class="btns"><button class="btn primary" id="pAdd">＋ Drop a pin</button>${me ? '<button class="btn" id="pMe">Pin my spot</button>' : ''}</div>
      ${rows || '<p class="muted">No pins yet. Tap “Drop a pin” or long-press anywhere on the map.</p>'}`);
    $('#pAdd').onclick = () => startCross('Move the map to place the pin', (la, ln) => newPin(la, ln));
    if (me) $('#pMe').onclick = () => newPin(me.lat, me.lng);
    document.querySelectorAll('[data-p]').forEach(r => r.onclick = () => { const p = pins.find(x => x.id === r.dataset.p); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16)); openPin(p.id); });
  };
  function openPin(id, editing) { openSheet('pin', { id, editing }); }
  views.pin = ({ id, editing }) => {
    const p = pins.find(x => x.id === id); if (!p) return closeSheet();
    const t = typeOf(p.type);
    if (editing) {
      setSheet('Edit pin', `
        <label class="f">Name</label><input type="text" id="eName" value="${esc(p.name)}" maxlength="60">
        <label class="f">Type</label><div class="types">${TYPES.map(x => `<button data-t="${x.id}" class="${x.id === p.type ? 'on' : ''}"><span class="e">${x.emoji}</span>${esc(x.label)}</button>`).join('')}</div>
        <label class="f">Notes</label><textarea id="eNotes" placeholder="Wind it works on, sign seen, height, etc.">${esc(p.notes || '')}</textarea>
        <div class="btns"><button class="btn danger" id="eDel">Delete</button><button class="btn" id="eMove">Move</button><button class="btn primary" id="eSave">Save</button></div>`);
      let type = p.type;
      document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
        const wasDefault = p.name.startsWith(typeOf(type).label + ' ');
        type = b.dataset.t; document.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
        if (wasDefault) { const n = pins.filter(q => q.type === type && q.id !== p.id).length + 1; $('#eName').value = `${typeOf(type).label} ${n}`; }
      });
      $('#eSave').onclick = () => { p.name = $('#eName').value.trim() || t.label; p.notes = $('#eNotes').value; p.type = type; p.updated = Date.now(); savePins(); drawPins(); openPin(p.id); };
      $('#eDel').onclick = () => confirmBox(`Delete “${p.name}”?`, 'Delete', () => { pins = pins.filter(x => x.id !== p.id); if (navTarget === p.id) { navTarget = null; store.set('nav', null); } savePins(); drawPins(); updateNav(); closeSheet(); });
      $('#eMove').onclick = () => { map.setView([p.lat, p.lng]); startCross(`Drag the map to move “${p.name}”`, (la, ln) => { p.lat = la; p.lng = ln; savePins(); drawPins(); updateNav(); openPin(p.id); }); };
      return;
    }
    const from = here(), d = Geo.distance(from, [p.lat, p.lng]), b = Geo.bearing(from, [p.lat, p.lng]);
    const wmd = wmdData ? wmdAt(p.lat, p.lng) : null;
    const hh = legal(new Date());
    setSheet(`${t.emoji} ${p.name}`, `
      <div class="grid2">
        <div class="kv"><small>Distance</small><b>${miles(d)}</b><div class="small muted">${me ? 'from you' : 'from map center'}</div></div>
        <div class="kv"><small>Bearing</small><b>${Math.round(b)}° ${Geo.cardinal(b)}</b></div>
        <div class="kv"><small>WMD</small><b>${wmd != null ? wmd : '—'}</b></div>
        <div class="kv"><small>Legal today</small><b style="font-size:14px">${fmtTime(hh.start)}–${fmtTime(hh.end)}</b></div>
      </div>
      <div class="card small"><div>${esc(fmtCoord(p.lat, p.lng))}</div>${p.notes ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(p.notes)}</div>` : ''}<div class="muted" style="margin-top:6px">${t.label} · added ${fmtDay(new Date(p.created))}</div></div>
      <div class="btns">
        <button class="btn ${navTarget === p.id ? 'primary' : ''}" id="vNav">${navTarget === p.id ? 'Stop navigating' : 'Navigate'}</button>
        <button class="btn" id="vWind">Wind here</button>
      </div>
      <div class="btns"><button class="btn" id="vCopy">Copy coords</button><button class="btn" id="vEdit">Edit</button></div>`);
    $('#vNav').onclick = () => { navTarget = navTarget === p.id ? null : p.id; store.set('nav', navTarget); startGps(); updateNav(); views.pin({ id }); if (navTarget) toast('Follow the yellow line. Distance and bearing show bottom-left.'); };
    $('#vWind').onclick = () => { scentAnchor = [p.lat, p.lng]; settings.scent = true; saveSettings(); maybeFetchWeather(); updateScent(); openSheet('wind'); };
    $('#vEdit').onclick = () => openPin(p.id, true);
    $('#vCopy').onclick = async () => { try { await navigator.clipboard.writeText(`${p.name}: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`); toast('Copied'); } catch (e) { toast(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`, 6000); } };
  };

  // ---- track
  function renderTrack() {
    const list = tracks.map(t => `<div class="row"><span style="width:14px;height:14px;border-radius:50%;background:${t.color || '#ffd23f'}"></span><div class="grow"><div><b>${esc(t.name)}</b></div><div class="sub">${miles(t.dist)} · ${fmtDur(t.end - t.start)} · ${t.pts.length} pts</div></div>
      <label class="switch"><input type="checkbox" data-tv="${t.id}" ${t.visible !== false ? 'checked' : ''}><span></span></label><button class="btn sm" data-tz="${t.id}">View</button><button class="btn sm danger" data-td="${t.id}">✕</button></div>`).join('');
    setSheet('Tracks', `
      ${rec ? `<div class="card"><div class="big" style="color:#ff4d4d">● ${miles(rec.dist || 0)}</div><div class="muted">${fmtDur(Date.now() - rec.start)} · ${rec.pts.length} points</div></div>
        <div class="btns"><button class="btn danger" id="tStop">Stop & save</button></div>`
        : `<div class="btns"><button class="btn primary" id="tStart">● Start recording</button></div>`}
      <p class="small muted">Records your path so you can find your way back to the truck or follow a blood trail. Web apps can't record GPS while the screen is locked, so turn on “Keep screen awake” under More.</p>
      <h3>Saved tracks</h3>${list || '<p class="muted">None yet.</p>'}`);
    const s = $('#tStart'); if (s) s.onclick = () => { startRec(); renderTrack(); };
    const st = $('#tStop'); if (st) st.onclick = () => { stopRec(); renderTrack(); };
    document.querySelectorAll('[data-tv]').forEach(i => i.onchange = () => { const t = tracks.find(x => x.id === i.dataset.tv); t.visible = i.checked; store.set('tracks', tracks); drawTracks(); });
    document.querySelectorAll('[data-tz]').forEach(b => b.onclick = () => { const t = tracks.find(x => x.id === b.dataset.tz); t.visible = true; store.set('tracks', tracks); drawTracks(); map.fitBounds(L.latLngBounds(t.pts.map(p => [p[0], p[1]])).pad(0.2)); closeSheet(); });
    document.querySelectorAll('[data-td]').forEach(b => b.onclick = () => confirmBox('Delete this track?', 'Delete', () => { tracks = tracks.filter(x => x.id !== b.dataset.td); store.set('tracks', tracks); drawTracks(); renderTrack(); }));
  }
  views.track = renderTrack;

  // ---- seasons
  function seasonStatus(s, today, wmd) {
    // s.ranges: [{start,end,wmds?,label?}]
    const applies = r => !r.wmds || wmd == null || r.wmds.includes(wmd);
    const rs = s.ranges.filter(applies);
    const open = rs.find(r => today >= r.start && today <= r.end);
    if (open) return { cls: 'open', text: `OPEN until ${fmtDay(new Date(open.end + 'T12:00:00'))}`, r: open };
    const next = rs.filter(r => r.start > today).sort((a, b) => a.start < b.start ? -1 : 1)[0];
    if (next) { const days = Math.round((new Date(next.start + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000); return { cls: days <= 14 ? 'soon' : 'closed', text: `Opens ${fmtDay(new Date(next.start + 'T12:00:00'))} (${days}d)`, r: next }; }
    return { cls: 'closed', text: 'Closed for the year' };
  }
  views.seasons = () => {
    const today = isoDay(new Date());
    const wmd = settings.myWmdOnly ? currentWmd : null;
    const items = D.seasons.map(s => {
      const st = seasonStatus(s, today, wmd);
      const ranges = s.ranges.filter(r => !wmd || !r.wmds || r.wmds.includes(wmd)).map(r => `<div class="small muted">• ${r.label ? esc(r.label) + ': ' : ''}${fmtDay(new Date(r.start + 'T12:00:00'))} – ${fmtDay(new Date(r.end + 'T12:00:00'))}${r.wmds && !wmd ? ` (WMDs ${r.wmds.join(', ')})` : ''}</div>`).join('');
      return { st, html: `<div class="season"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(s.name)}</b><span class="${st.cls}">${st.text}</span></div>${ranges}${s.note ? `<div class="small" style="margin-top:3px">${esc(s.note)}</div>` : ''}</div>` };
    });
    items.sort((a, b) => ({ open: 0, soon: 1, closed: 2 }[a.st.cls] - { open: 0, soon: 1, closed: 2 }[b.st.cls]));
    setSheet(`Seasons ${D.seasonYear}`, `
      <div class="row"><div class="grow"><div>Only my WMD</div><div class="sub">${currentWmd != null ? 'WMD ' + currentWmd : 'Unknown (no GPS fix or outside Maine)'}</div></div><label class="switch"><input type="checkbox" id="sMine" ${settings.myWmdOnly ? 'checked' : ''}><span></span></label></div>
      ${items.map(i => i.html).join('')}
      <div class="warn">${D.rules.seasonsNote}</div>
      <h3>Key rules</h3>${D.rules.keyRules.map(r => `<div class="small" style="margin:6px 0">• ${r}</div>`).join('')}`);
    $('#sMine').onchange = e => { settings.myWmdOnly = e.target.checked; saveSettings(); views.seasons(); };
  };

  // ---- tools / more
  views.tools = () => {
    setSheet('More', `
      <h3>Tools</h3>
      <div class="row" id="mMeasure"><span style="font-size:20px">📏</span><div class="grow"><div>Measure distance / area</div><div class="sub">Tap points on the map. Shows yards and acres.</div></div>›</div>
      <div class="row" id="mCompass"><span style="font-size:20px">🧭</span><div class="grow"><div>Compass</div><div class="sub">Heading, wind and bearing to your target</div></div>›</div>
      <div class="row" id="mOffline"><span style="font-size:20px">📥</span><div class="grow"><div>Offline maps</div><div class="sub">Save the area on screen for no-signal use</div></div>›</div>
      <div class="row" id="mShare"><span style="font-size:20px">🆘</span><div class="grow"><div>My location / emergency</div><div class="sub">Copy your coordinates to text someone</div></div>›</div>
      <h3>Data</h3>
      <div class="row" id="mExport"><span style="font-size:20px">📤</span><div class="grow"><div>Export pins & tracks (GPX)</div><div class="sub">Back up your data or move it to another app</div></div>›</div>
      <div class="row"><span style="font-size:20px">📂</span><div class="grow"><div>Import GPX / GeoJSON</div><div class="sub">Waypoints and tracks from onX, Garmin, etc.</div></div><label class="btn sm">Choose<input type="file" id="mImport" accept=".gpx,.json,.geojson,application/gpx+xml,application/json" style="display:none"></label></div>
      <h3>Settings</h3>
      <div class="row"><div class="grow"><div>Keep screen awake</div><div class="sub">Stops the phone from sleeping while the app is open</div></div><label class="switch"><input type="checkbox" id="mWake" ${settings.wake ? 'checked' : ''}><span></span></label></div>
      <div class="row"><div class="grow"><div>Coordinate format</div><div class="sub">Or tap the coordinates on the map</div></div><select id="mFmt" style="width:auto"><option value="0">Decimal</option><option value="1">Deg Min Sec</option><option value="2">UTM</option></select></div>
      <div class="row" id="mInstall"><span style="font-size:20px">📱</span><div class="grow"><div>Add to Home Screen</div><div class="sub">Run it like a normal app</div></div>›</div>
      <div class="row" id="mAbout"><span style="font-size:20px">ℹ️</span><div class="grow"><div>About & data sources</div></div>›</div>
      <div class="btns"><button class="btn danger" id="mWipe">Erase all pins, tracks & saved maps</button></div>`);
    $('#mFmt').value = settings.coordFmt;
    $('#mFmt').onchange = e => { settings.coordFmt = +e.target.value; saveSettings(); updateCoords(); };
    $('#mMeasure').onclick = startMeasure;
    $('#mCompass').onclick = () => openSheet('compass');
    $('#mOffline').onclick = () => openSheet('offline');
    $('#mShare').onclick = () => openSheet('sos');
    $('#mExport').onclick = exportGpx;
    $('#mImport').onchange = e => { const f = e.target.files[0]; if (f) importFile(f); };
    $('#mWake').onchange = e => { settings.wake = e.target.checked; saveSettings(); applyWake(); };
    $('#mInstall').onclick = () => modal(`<h3 style="margin-top:0;color:#eef0e6;text-transform:none;font-size:17px;letter-spacing:0">Install on your phone</h3><p><b>iPhone (Safari):</b> tap the Share button <span style="font-size:18px">⎋</span>, then <b>Add to Home Screen</b>.</p><p><b>Android (Chrome):</b> tap ⋮ then <b>Add to Home screen</b> / <b>Install app</b>.</p><p class="small muted">Open it from the home-screen icon. That's what lets maps you saved work with no signal.</p><div class="btns"><button class="btn primary" id="mx">Got it</button></div>`) || ($('#mx').onclick = closeModal);
    $('#mAbout').onclick = () => openSheet('about');
    $('#mWipe').onclick = () => confirmBox('Erase every pin, track and saved offline map on this phone? This cannot be undone. Export first if you want a backup.', 'Erase everything', async () => {
      pins = []; tracks = []; rec = null; navTarget = null;['pins', 'tracks', 'rec', 'nav'].forEach(k => store.set(k, k === 'pins' || k === 'tracks' ? [] : null));
      try { await caches.delete(TILE_CACHE); } catch (e) { }
      drawPins(); drawTracks(); recLine.setLatLngs([]); updateNav(); paintRec(); toast('Erased');
    });
  };
  // About
  views.about = () => setSheet('About', `
    <p>Maine Hunt Map is a personal tool. It does not replace the Maine IF&amp;W law book, landowner permission, or a paper map and compass.</p>
    <h3>Data sources</h3>${D.sources.map(s => `<div class="small" style="margin:6px 0">• <a style="color:#ff6a13" href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.note ? ' (' + esc(s.note) + ')' : ''}</div>`).join('')}
    <h3>Hunting hours</h3><p class="small">Worked out on your phone from sunrise and sunset at your GPS location, so they work with no signal. Times can differ by a minute or two from the official IF&amp;W tables.</p>
    <p class="small muted">Version ${D.version}</p>`);
  // SOS
  views.sos = () => {
    const p = me ? [me.lat, me.lng] : null;
    const u = p ? Geo.toUTM(p[0], p[1]) : null;
    setSheet('My location', p ? `
      <div class="card"><div class="big" style="font-size:22px">${p[0].toFixed(5)}, ${p[1].toFixed(5)}</div>
      <div class="muted">${Geo.toDMS(p[0], 'N', 'S')} ${Geo.toDMS(p[1], 'E', 'W')}</div><div class="muted">UTM ${u.zone}${u.band} ${u.easting}E ${u.northing}N</div>
      <div class="muted">Accuracy ±${Math.round(me.acc * 3.28)} ft${me.alt != null ? ' · elev ' + Math.round(me.alt * 3.28) + ' ft' : ''}${currentWmd != null ? ' · WMD ' + currentWmd : ''}</div></div>
      <div class="btns"><button class="btn primary" id="sCopy">Copy location message</button></div>
      <div class="warn"><b>Emergency: call 911.</b> Read them the coordinates above. A text to 911 works in much of Maine when a call won't connect. If you have no signal, climb to higher ground. Stay put once you've told someone where you are.</div>`
      : `<p class="muted">No GPS fix yet.</p><div class="btns"><button class="btn primary" id="sGps">Get my location</button></div>`);
    const c = $('#sCopy'); if (c) c.onclick = async () => {
      const msg = `My location: ${p[0].toFixed(5)}, ${p[1].toFixed(5)} (±${Math.round(me.acc * 3.28)} ft) https://maps.google.com/?q=${p[0].toFixed(5)},${p[1].toFixed(5)}`;
      try { await navigator.clipboard.writeText(msg); toast('Copied. Paste it into a text.'); } catch (e) { toast(msg, 8000); }
    };
    const g = $('#sGps'); if (g) g.onclick = () => { startGps(); toast('Getting location…'); };
  };

  // ---------------------------------------------------------------- offline maps
  const TILE_CACHE = 'hm-tiles-v1';
  let dl = null;
  function tileUrl(def, z, x, y) {
    const subs = typeof def.subdomains === 'string' ? def.subdomains.split('') : (def.subdomains || ['a', 'b', 'c']);
    return L.Util.template(def.url, { s: subs[Math.abs(x + y) % subs.length], z, x, y, r: '' });
  }
  function planDownload(maxZ) {
    const b = map.getBounds();
    const base = D.basemaps.find(x => x.id === settings.basemap);
    const defs = [base].concat(base.overlays || []).filter(d => d.offline !== false);
    const urls = [];
    const minZ = Math.max(8, Math.min(map.getZoom(), maxZ) - 3);
    for (let z = minZ; z <= maxZ; z++) {
      defs.forEach(d => {
        const zz = Math.min(z, d.maxNativeZoom || 19);
        Geo.tilesInBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), zz).forEach(([tz, x, y]) => urls.push(tileUrl(d, tz, x, y)));
      });
    }
    return { urls: [...new Set(urls)], base, minZ };
  }
  views.offline = async () => {
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    let used = '';
    try { const e = await navigator.storage.estimate(); used = `${(e.usage / 1048576).toFixed(0)} MB used of ~${(e.quota / 1048576 / 1024).toFixed(1)} GB available`; } catch (e) { }
    let maxZ = Math.min(16, Math.max(13, map.getZoom() + 2));
    const draw = () => {
      const plan = planDownload(maxZ);
      setSheet('Offline maps', `
        ${sw ? '' : '<div class="warn">Offline maps only work when the app is opened from your Home Screen icon (or after reloading once). Install it first under More › Add to Home Screen.</div>'}
        <p>Saves the <b>area on your screen</b> of the <b>${esc(plan.base.name)}</b> map, plus the WMD lines and land layers you have turned on, so it works with no signal.</p>
        <label class="f">Detail (max zoom): <b id="zLbl">${maxZ}</b></label>
        <input type="range" id="zRange" min="12" max="17" value="${maxZ}" style="width:100%">
        <div class="card"><b>${plan.urls.length.toLocaleString()}</b> tiles · about <b>${Math.max(1, Math.round(plan.urls.length * 0.025))} MB</b> <span class="small muted">(zoom ${plan.minZ}–${maxZ})</span>${plan.urls.length > 6000 ? '<div class="small" style="color:#ffd23f">That\'s a lot. Zoom in to a smaller area or lower the detail.</div>' : ''}</div>
        <div class="progress"><div id="dlBar"></div></div><div class="small muted" id="dlTxt">${dl ? 'Downloading…' : ''}</div>
        <div class="btns">${dl ? '<button class="btn danger" id="dlStop">Cancel</button>' : `<button class="btn primary" id="dlGo" ${plan.urls.length > 8000 ? 'disabled' : ''}>Download this area</button>`}</div>
        <p class="small muted">${used}</p>
        <div class="btns"><button class="btn sm" id="dlClear">Delete all saved maps</button></div>
        <p class="small muted">Tip: download your hunting area on Wi-Fi at home. Save it once in Satellite and once in Topo if you use both.</p>`);
      $('#zRange').oninput = e => { maxZ = +e.target.value; draw(); };
      const go = $('#dlGo'); if (go) go.onclick = () => runDownload(plan);
      const st = $('#dlStop'); if (st) st.onclick = () => { if (dl) dl.cancel = true; };
      $('#dlClear').onclick = () => confirmBox('Delete all saved offline maps?', 'Delete', async () => { try { await caches.delete(TILE_CACHE); } catch (e) { } toast('Offline maps deleted'); views.offline(); });
    };
    draw();
  };
  async function runDownload(plan) {
    let cache; try { cache = await caches.open(TILE_CACHE); } catch (e) { toast('This browser can\'t save maps offline'); return; }
    dl = { done: 0, fail: 0, total: plan.urls.length, cancel: false };
    views.offline();
    // also prefetch overlay data for the area
    Object.values(overlayState).forEach(st => { if (st.def.kind === 'bbox' && settings.overlays[st.def.id]) loadCells(st, cellsFor(map.getBounds(), st.def.cell || 0.2)); });
    const queue = plan.urls.slice(); const workers = [];
    const paint = () => { const bar = $('#dlBar'), txt = $('#dlTxt'); if (bar) bar.style.width = (100 * (dl.done + dl.fail) / dl.total) + '%'; if (txt) txt.textContent = `${dl.done} of ${dl.total} saved${dl.fail ? ' · ' + dl.fail + ' failed' : ''}`; };
    for (let w = 0; w < 6; w++) workers.push((async () => {
      while (queue.length && !dl.cancel) {
        const u = queue.shift();
        try {
          if (await cache.match(u)) { dl.done++; paint(); continue; }
          let r = await fetch(u, { mode: 'cors' }).catch(() => null);
          if (!r) r = await fetch(u, { mode: 'no-cors' }); // host without CORS
          else if (!r.ok) throw new Error('HTTP ' + r.status);
          await cache.put(u, r); dl.done++;
        } catch (e) { dl.fail++; }
        if ((dl.done + dl.fail) % 10 === 0) paint();
      }
    })());
    await Promise.all(workers);
    const msg = dl.cancel ? 'Download cancelled' : `Saved ${dl.done} tiles${dl.fail ? ` (${dl.fail} failed)` : ''}`;
    dl = null; toast(msg, 4000); if (sheetView === 'offline') views.offline();
  }

  // ---------------------------------------------------------------- GPX export / import
  function exportGpx() {
    const x = s => esc(s);
    const wpts = pins.map(p => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${x(p.name)}</name><desc>${x(p.notes || '')}</desc><type>${x(typeOf(p.type).label)}</type><time>${new Date(p.created).toISOString()}</time></wpt>`).join('\n');
    const trks = tracks.map(t => `  <trk><name>${x(t.name)}</name><trkseg>\n${t.pts.map(p => `    <trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('\n')}\n  </trkseg></trk>`).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Maine Hunt Map" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n${trks}\n</gpx>\n`;
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const name = `maine-hunt-${isoDay(new Date())}.gpx`;
    const file = new File([blob], name, { type: 'application/gpx+xml' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => { }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Exported ${pins.length} pins, ${tracks.length} tracks`);
  }
  async function importFile(f) {
    const text = await f.text(); let np = 0, nt = 0;
    const typeFromName = s => { s = (s || '').toLowerCase(); const t = TYPES.find(t => s.includes(t.label.toLowerCase()) || (t.match || []).some(m => s.includes(m))); return t ? t.id : 'other'; };
    try {
      if (/^\s*</.test(text)) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        doc.querySelectorAll('wpt').forEach(w => {
          const g = s => (w.querySelector(s) || {}).textContent || '';
          pins.push({ id: 'p' + Date.now().toString(36) + np, lat: +w.getAttribute('lat'), lng: +w.getAttribute('lon'), name: g('name') || 'Imported', notes: g('desc') || g('cmt'), type: typeFromName(g('type') + ' ' + g('sym') + ' ' + g('name')), created: Date.now() }); np++;
        });
        doc.querySelectorAll('trk').forEach(t => {
          const pts = [...t.querySelectorAll('trkpt')].map(p => [+p.getAttribute('lat'), +p.getAttribute('lon'), Date.parse((p.querySelector('time') || {}).textContent) || Date.now()]);
          if (pts.length > 1) { tracks.push({ id: 't' + Date.now().toString(36) + nt, name: ((t.querySelector('name') || {}).textContent) || 'Imported track', pts, dist: trackDist(pts), start: pts[0][2], end: pts[pts.length - 1][2], visible: true, color: '#c58cff' }); nt++; }
        });
      } else {
        const j = JSON.parse(text);
        (j.features || []).forEach(f => {
          const g = f.geometry, pr = f.properties || {};
          if (!g) return;
          if (g.type === 'Point') { pins.push({ id: 'p' + Date.now().toString(36) + np, lat: g.coordinates[1], lng: g.coordinates[0], name: pr.name || pr.title || 'Imported', notes: pr.notes || pr.description || '', type: typeFromName(pr.type || pr.name), created: Date.now() }); np++; }
          if (g.type === 'LineString') { const pts = g.coordinates.map(c => [c[1], c[0], Date.now()]); tracks.push({ id: 't' + Date.now().toString(36) + nt, name: pr.name || 'Imported line', pts, dist: trackDist(pts), start: Date.now(), end: Date.now(), visible: true, color: '#c58cff' }); nt++; }
        });
      }
      savePins(); store.set('tracks', tracks); drawPins(); drawTracks();
      toast(`Imported ${np} pins, ${nt} tracks`, 4000);
    } catch (e) { toast('Could not read that file'); }
  }

  // ---------------------------------------------------------------- wake lock
  let wakeLock = null;
  async function applyWake() {
    try {
      if (settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); }
      else if (!settings.wake && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { if (settings.wake) toast('This browser can\'t keep the screen awake'); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { applyWake(); updateHours(); maybeFetchWeather(); retryData(); } });

  // ---------------------------------------------------------------- boot
  function retryData() { loadWmd(); Object.values(overlayState).forEach(st => { if (st.def.kind === 'all' && st.def.id !== 'wmd' && settings.overlays[st.def.id] && !st.loaded) loadAllOverlay(st); }); refreshBboxOverlays(); }
  window.addEventListener('online', () => { maybeFetchWeather(true); retryData(); });
  initOverlays(); drawPins(); drawTracks(); updateNav(); paintRec(); renderWindChip(); updateHours(); updateCoords(); updateScent();
  if (rec) recLine.setLatLngs(rec.pts.map(q => [q[0], q[1]]));
  startGps(); applyWake(); maybeFetchWeather();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  if (!store.get('welcomed', false)) {
    store.set('welcomed', true);
    setTimeout(() => modal(`<h3 style="margin-top:0;color:#eef0e6;text-transform:none;font-size:18px;letter-spacing:0">🦌 Maine Hunt Map</h3>
      <p class="small">• <b>Top bar:</b> your WMD, legal shooting time and wind.<br>• <b>Long-press</b> the map to drop a pin.<br>• <b>Right buttons:</b> layers, follow my location, compass, scent cone.<br>• Tap the coordinates to switch format.<br>• Save maps for no-signal use under <b>More › Offline maps</b>.</p>
      <p class="small muted">Always check the official IF&amp;W law book. Land layers are approximate, and permission and posted land rules still apply.</p>
      <div class="btns"><button class="btn primary" id="wOk">Let's go</button></div>`) || ($('#wOk').onclick = closeModal), 600);
  }
  window.__hm = { map, Geo, get wmdData() { return wmdData; }, overlayState }; // debug
})();
