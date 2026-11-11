/* Maine Hunt Map — data & configuration. Edit this file each season. */
window.HUNT_DATA = (function () {
  const ORG = 'https://services1.arcgis.com/RbMX0mRVOFNTdLzd/ArcGIS/rest/services/';
  const ESRI = 'Tiles &copy; Esri, Maxar, Earthstar Geographics, USDA, USGS, GIS User Community';

  // Group the messy PUB_ACCESS free text into 4 buckets
  function access(p) {
    const v = String((p && p.PUB_ACCESS) || '').trim().toLowerCase();
    if (!v || v === 'unknown') return 'unknown';
    if (v.startsWith('allowed') || v.startsWith('guaranteed') || v.startsWith('allow')) return 'open';
    if (v.startsWith('restricted') || v.startsWith('contact') || v.startsWith('limited')) return 'limited';
    if (v.startsWith('no') || v.startsWith('not') || v.startsWith('private') || v.startsWith('closed')) return 'closed';
    return 'unknown';
  }
  const ACCESS_COLOR = { open: '#39d353', limited: '#ffd23f', closed: '#ff4d4d', unknown: '#b0b8a0' };
  const ACCESS_LABEL = { open: 'Public access allowed', limited: 'Restricted / contact landowner', closed: 'No public access', unknown: 'Access unknown' };
  const landPopup = [
    ['Parcel', 'PARCEL_NAME'], ['Type', 'DESIGNATION'], ['Held by', p => [p.HOLD1_NAME, p.HOLD1_TYPE && '(' + p.HOLD1_TYPE + ')'].filter(Boolean).join(' ')],
    ['Interest', 'CONS1_TYPE'], ['Public access', p => p.PUB_ACCESS ? p.PUB_ACCESS + ' → ' + ACCESS_LABEL[access(p)] : ACCESS_LABEL.unknown],
    ['Acres', p => p.CALC_AC ? Math.round(p.CALC_AC).toLocaleString() : '']
  ];
  const LAND_FIELDS = 'OBJECTID,PROJECT,PARCEL_NAME,DESIGNATION,HOLD1_NAME,HOLD1_TYPE,CONS1_TYPE,PUB_ACCESS,CALC_AC';

  return {
    version: '1.0 (2026-27 season)',
    seasonYear: '2026–27',
    wmdNumber: p => (p.IDENTIFIER != null ? Number(p.IDENTIFIER) : null),

    basemaps: [
      { id: 'hybrid', name: 'Satellite + labels', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, attribution: ESRI,
        overlays: [
          { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, attribution: '' },
          { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, attribution: '' }
        ] },
      { id: 'sat', name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, attribution: ESRI },
      { id: 'usgs', name: 'USGS Topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 16, attribution: 'USGS The National Map' },
      { id: 'esritopo', name: 'Esri Topo', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' },
      { id: 'otm', name: 'OpenTopoMap (trails)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxNativeZoom: 17, attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' },
      { id: 'usgsimg', name: 'USGS Imagery + Topo', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', maxNativeZoom: 16, attribution: 'USGS The National Map' }
    ],

    overlays: [
      { id: 'wmd', name: 'WMD boundaries', desc: 'Wildlife Management Districts 1–29', kind: 'all', defaultOn: true,
        url: ORG + 'WMD/FeatureServer/0', where: 'IDENTIFIER > 0', outFields: 'IDENTIFIER,AREASQMI', orderBy: 'OBJECTID_1', maxOffset: 0.0004, precision: 5, pageSize: 2000,
        style: { color: '#ff6a13', weight: 3, opacity: .95, fill: false, dashArray: '10 5' },
        swatch: 'transparent', swatchLine: '#ff6a13',
        title: p => 'WMD ' + p.IDENTIFIER, popup: [['Area', p => p.AREASQMI ? Math.round(p.AREASQMI).toLocaleString() + ' sq mi' : '']] },

      { id: 'conserved', name: 'Public & conserved land', desc: 'Color = public access: green open, yellow restricted, red none', kind: 'bbox', minZoom: 10, cell: 0.2, defaultOn: true,
        url: ORG + 'Maine_Conserved_Lands_All/FeatureServer/0', outFields: LAND_FIELDS, maxOffset: 0.0002, precision: 5, pageSize: 2000,
        style: p => { const c = ACCESS_COLOR[access(p)]; const ease = /ease/i.test(p.CONS1_TYPE || ''); return { color: c, weight: 1.5, fillColor: c, fillOpacity: ease ? .08 : .2, dashArray: ease ? '5 4' : null }; },
        swatch: 'rgba(57,211,83,.35)', swatchLine: '#39d353',
        title: 'PROJECT', popup: landPopup },

      { id: 'wma', name: 'Wildlife Management Areas', desc: 'IF&W-owned WMAs (all statewide)', kind: 'all', defaultOn: true,
        url: ORG + 'MaineDIFW_WildlifeManagementAreas/FeatureServer/0', outFields: LAND_FIELDS, maxOffset: 0.0002, precision: 5, pageSize: 2000,
        style: { color: '#00e0c0', weight: 2, fillColor: '#00e0c0', fillOpacity: .18 },
        swatch: 'rgba(0,224,192,.35)', swatchLine: '#00e0c0',
        title: 'PROJECT', popup: landPopup },

      { id: 'archery', name: 'Expanded archery areas', desc: 'Where the expanded archery deer season applies', kind: 'all', defaultOn: false,
        url: ORG + 'MaineDIFW_ExpandedArcheryAreas/FeatureServer/0', outFields: '*', maxOffset: 0.0004, precision: 5,
        style: { color: '#c58cff', weight: 2, fillColor: '#c58cff', fillOpacity: .12 },
        swatch: 'rgba(197,140,255,.3)', swatchLine: '#c58cff',
        title: p => p.NAME || p.Name || p.AREA_NAME || 'Expanded archery area', popup: [] },

      { id: 'parcels', name: 'Property lines', desc: 'Parcel outlines, no owner names (patchy coverage)', kind: 'bbox', minZoom: 15, cell: 0.02, defaultOn: false,
        url: ORG + 'Parcels/FeatureServer/38', extraUrls: [ORG + 'Maine_Unorganized_Parcel_Layers_view/FeatureServer/0'],
        outFields: '*', maxOffset: 0.00002, precision: 6, pageSize: 2000, cacheDays: 120,
        style: { color: '#ffffff', weight: 1.2, opacity: .85, fill: false },
        swatch: 'transparent', swatchLine: '#ffffff',
        title: p => p.PLAN_LOT ? 'Lot ' + p.PLAN_LOT : (p.Parcel_ID ? 'Parcel ' + p.Parcel_ID : 'Parcel'),
        popup: [['Town', 'TOWN'], ['Acres', p => p.CACREAGE ? Number(p.CACREAGE).toFixed(1) : '']] },

      { id: 'towns', name: 'Town lines', desc: 'Towns & unorganized townships', kind: 'all', defaultOn: false,
        url: ORG + 'Maine_Town_and_Townships_Boundary_Polygons_Dissolved/FeatureServer/0', outFields: 'TOWN', maxOffset: 0.0008, precision: 4, pageSize: 2000,
        style: { color: '#e8e8e8', weight: 1, opacity: .7, fill: false, dashArray: '2 4' },
        swatch: 'transparent', swatchLine: '#e8e8e8',
        title: 'TOWN', popup: [] },

      { id: 'dwa', name: 'Deer wintering areas', desc: 'Mapped deer yards (zoom in)', kind: 'bbox', minZoom: 10, cell: 0.2, defaultOn: false,
        url: ORG + 'MaineDIFW_DeerWinteringAreas/FeatureServer/0', outFields: '*', maxOffset: 0.0002, precision: 5, pageSize: 2000,
        style: { color: '#9ad0ff', weight: 1, fillColor: '#9ad0ff', fillOpacity: .22 },
        swatch: 'rgba(154,208,255,.35)', swatchLine: '#9ad0ff',
        title: () => 'Deer wintering area', popup: [] }
    ],

    pinTypes: [
      { id: 'stand', label: 'Tree stand', emoji: '🪜', color: '#ff6a13', match: ['stand', 'ladder'] },
      { id: 'blind', label: 'Ground blind', emoji: '⛺', color: '#a0522d', match: ['blind'] },
      { id: 'camera', label: 'Trail cam', emoji: '📷', color: '#5a6b7a', match: ['cam'] },
      { id: 'scrape', label: 'Scrape', emoji: '🍂', color: '#b8860b', match: ['scrape'] },
      { id: 'rub', label: 'Rub', emoji: '🌳', color: '#556b2f', match: ['rub'] },
      { id: 'bed', label: 'Bedding', emoji: '🛏️', color: '#8b5a8b', match: ['bed'] },
      { id: 'trail', label: 'Game trail', emoji: '🐾', color: '#6b4f2a', match: ['trail', 'track'] },
      { id: 'sighting', label: 'Sighting', emoji: '👀', color: '#2e8b57', match: ['sight', 'seen'] },
      { id: 'harvest', label: 'Harvest', emoji: '🎯', color: '#c62828', match: ['harvest', 'kill', 'shot'] },
      { id: 'blood', label: 'Blood / hit', emoji: '🩸', color: '#8b0000', match: ['blood', 'hit'] },
      { id: 'truck', label: 'Truck / park', emoji: '🛻', color: '#1e66c8', match: ['truck', 'park', 'car'] },
      { id: 'camp', label: 'Camp', emoji: '🏕️', color: '#2f6f4f', match: ['camp', 'cabin'] },
      { id: 'food', label: 'Food source', emoji: '🌾', color: '#c9a227', match: ['food', 'plot', 'apple', 'acorn', 'oak'] },
      { id: 'water', label: 'Water', emoji: '💧', color: '#1f7fbf', match: ['water', 'spring', 'brook'] },
      { id: 'hazard', label: 'Hazard / posted', emoji: '⚠️', color: '#d4a017', match: ['hazard', 'posted', 'danger'] },
      { id: 'other', label: 'Pin', emoji: '📍', color: '#666', match: [] }
    ],

    rules: {
      noSunday: true,
      // Maine sets legal hunting hours statewide from BANGOR's sunrise/sunset.
      hoursRef: { name: 'Bangor', lat: 44.8012, lng: -68.7778 },
      hoursNote: '<b>How these are figured:</b> Maine sets legal hours <b>statewide from Bangor\'s sunrise and sunset</b>: ½ hour before sunrise to ½ hour after sunset. They match IF&amp;W\'s chart to within a minute or two.<br><br><b>Exceptions:</b> migratory birds and waterfowl end <b>at sunset</b>. Coyote night hunting (Dec 16 to Aug 31) and raccoon night hunting have their own rules. <b>No hunting on Sundays.</b> Check the official <a style="color:#ff6a13" href="https://www.maine.gov/ifw/docs/26-MDIFW-30-Legal-Shooting-Hours-2026-27.pdf" target="_blank" rel="noopener">2026–27 hours chart</a>.',
      seasonsNote: 'Dates are summarized from IF&amp;W\'s 2026–27 season list. <b>Every season is closed on Sundays.</b> Moose and antlerless deer need a permit. Always confirm with the <a style="color:#ff6a13" href="https://www.maine.gov/IFW/hunting-trapping/hunting/laws-rules/season-dates-bag-limits.html" target="_blank" rel="noopener">official season page</a> and law book before you hunt.',
      keyRules: [
        '<b>Blaze orange:</b> during the deer firearms and muzzleloader seasons (and youth days), anyone hunting with a firearm, muzzleloader or crossbow needs <b>2 articles</b>: a solid orange hat plus a vest or jacket that is at least 50% orange. In a WMD open to moose, you need 1 article when using a firearm or crossbow. Bowhunters are exempt but encouraged.',
        '<b>Deer bag:</b> one deer per year. In 2026, WMDs 21–25 and 29 allow either sex without a permit during the firearms and muzzleloader seasons. Elsewhere it\'s antlered only unless you hold an antlerless permit.',
        '<b>Night lights:</b> using artificial lights is illegal from ½ hour after sunset to ½ hour before sunrise, Sept 1 to Dec 15, except for raccoon and authorized coyote hunters.',
        '<b>New for 2026:</b> shooting archery gear within 100 yards of a home without permission means mandatory license revocation. Landowners may remove stands and cameras placed without permission.',
        '<b>Land:</b> in Maine, unposted private land is often open by custom, but posted signs, paint marks and landowner wishes always apply. The land layers here are for reference and are not legal survey lines.'
      ]
    },

    // Ranges are inclusive; Sundays always closed. wmds = only those districts (omit = statewide).
    seasons: [
      { name: 'Deer — firearms', ranges: [{ start: '2026-11-02', end: '2026-11-28' }],
        note: 'Antlered only, except either sex in WMDs 21–25 & 29, or with an antlerless permit.' },
      { name: 'Deer — muzzleloader', ranges: [
        { label: 'Week 1, all WMDs', start: '2026-11-30', end: '2026-12-05' },
        { label: 'Week 2', start: '2026-12-07', end: '2026-12-12', wmds: [12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29] }] },
      { name: 'Deer — expanded archery', ranges: [{ start: '2026-09-12', end: '2026-12-12' }], note: 'Only inside expanded archery areas (turn on that map layer). Separate permits apply.' },
      { name: 'Deer — regular archery', ranges: [{ start: '2026-10-03', end: '2026-10-30' }], note: 'Either sex.' },
      { name: 'Deer — youth days', ranges: [{ start: '2026-10-23', end: '2026-10-24' }] },
      { name: 'Deer — residents-only day', ranges: [{ start: '2026-10-31', end: '2026-10-31' }] },
      { name: 'Bear — general', ranges: [{ start: '2026-08-31', end: '2026-11-28' }], note: 'Bait Aug 31 to Sept 26 · hounds Sept 14 to Oct 30 · trapping Sept 1 to Oct 31. Limit 2 (1 hunting, 1 trapping).' },
      { name: 'Ruffed grouse (partridge)', ranges: [{ start: '2026-09-26', end: '2026-12-31' }], note: 'Daily limit 4, possession 8.' },
      { name: 'Snowshoe hare', ranges: [{ start: '2026-09-26', end: '2027-03-31' }], note: 'Daily limit 4, possession 8.' },
      { name: 'Coyote — night hunting', ranges: [{ start: '2026-12-16', end: '2027-08-31' }], note: 'Daytime coyote hunting is open all year. Night hunting stops at midnight Saturday and resumes 12:01 AM Monday.' },
      { name: 'Raccoon', ranges: [{ start: '2026-10-01', end: '2026-12-31' }], note: 'Night hunting allowed. Lights OK for raccoon.' },
      { name: 'Turkey — fall', ranges: [{ start: '2026-09-14', end: '2026-11-07', wmds: [3, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29] }],
        note: 'Season limit: 5 in WMDs 15–17 & 20–25 · 3 in 26 · 2 in 28 · 1 in 3, 6–8, 10–14, 18, 19, 27, 29. Closed in 1, 2, 4, 5, 9.' },
      { name: 'Turkey — spring 2027', ranges: [{ label: 'Youth', start: '2027-04-30', end: '2027-05-01' }, { label: 'All hunters', start: '2027-05-03', end: '2027-06-05' }], note: 'Two bearded birds in WMDs 7 & 9–29, one in WMDs 1–6 & 8.' },
      { name: 'Moose (permit only)', ranges: [
        { label: 'Sept bull', start: '2026-09-28', end: '2026-10-03', wmds: [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 15, 18, 19, 27, 28] },
        { label: 'Oct bull', start: '2026-10-12', end: '2026-10-17', wmds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 27, 28] },
        { label: 'Oct antlerless', start: '2026-10-26', end: '2026-10-31', wmds: [1, 2, 3, 4, 5, 6, 8] }] },
      { name: 'Woodcock', ranges: [{ start: '2026-09-26', end: '2026-11-17' }], note: 'Migratory: hours end at sunset. Federal HIP registration required.' },
      { name: 'Ducks — North zone', ranges: [{ start: '2026-09-28', end: '2026-12-05' }], note: 'Hours end at sunset. Check your waterfowl zone.' },
      { name: 'Ducks — South zone', ranges: [{ start: '2026-10-01', end: '2026-10-10' }, { start: '2026-10-29', end: '2026-12-26' }], note: 'Hours end at sunset.' },
      { name: 'Ducks — Coastal zone', ranges: [{ start: '2026-10-03', end: '2026-10-10' }, { start: '2026-11-05', end: '2027-01-05' }], note: 'Hours end at sunset.' }
    ],

    sources: [
      { name: 'Maine IF&W: season dates & bag limits', url: 'https://www.maine.gov/IFW/hunting-trapping/hunting/laws-rules/season-dates-bag-limits.html' },
      { name: 'Maine IF&W: legal hunting hours', url: 'https://www.maine.gov/IFW/hunting-trapping/hunting/laws-rules/legal-hunting-hours.html' },
      { name: 'Maine IF&W: hunting equipment & blaze orange', url: 'https://www.maine.gov/IFW/hunting-trapping/hunting/laws-rules/hunting-equipment.html' },
      { name: 'Maine GeoLibrary (WMDs, conserved lands, WMAs, towns, parcels)', url: 'https://maine.hub.arcgis.com/' },
      { name: 'Open-Meteo weather', url: 'https://open-meteo.com/', note: 'free, no key' },
      { name: 'Esri, USGS & OpenTopoMap base maps', url: 'https://www.arcgis.com/' }
    ]
  };
})();
