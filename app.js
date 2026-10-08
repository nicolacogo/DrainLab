// ---------- DrainLab v0.2.1 ----------

// 1. Map and base layers
const map = L.map('map').setView([53.8, -1.78], 13); // starts near Shipley/Bradford

const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const esriAttr = 'Tiles &copy; Esri and contributors';

const streets = L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: esriAttr
}).addTo(map);

// Satellite imagery + place names + road labels on top
const satellite = L.layerGroup([
  L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esriAttr + ', Maxar, Earthstar Geographics' }),
  L.tileLayer(esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
  L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
]);

// Topographic map with contour lines (coarse, for visual context only)
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)'
});

L.control.layers({ 'Streets': streets, 'Satellite (with labels)': satellite, 'Topographic (contours)': topo }).addTo(map);
L.control.scale({ metric: true, imperial: false }).addTo(map);

// 2. Drawing tools (one catchment at a time)

// Smaller, cleaner vertex handles (default and touch versions)
const vertexIcon = L.divIcon({ className: 'dl-vertex', iconSize: new L.Point(9, 9) });
const midIcon = L.divIcon({ className: 'dl-vertex dl-mid', iconSize: new L.Point(7, 7) });
L.Draw.Polyline.prototype.options.icon = vertexIcon;
L.Draw.Polyline.prototype.options.touchIcon = vertexIcon;
L.Edit.PolyVerticesEdit.prototype.options.icon = vertexIcon;
L.Edit.PolyVerticesEdit.prototype.options.touchIcon = vertexIcon;
L.Edit.PolyVerticesEdit.prototype._createMiddleMarker = (function (orig) {
  return function (a, b) { const m = orig.call(this, a, b); if (m) m.setIcon(midIcon); return m; };
})(L.Edit.PolyVerticesEdit.prototype._createMiddleMarker);

const drawnItems = new L.FeatureGroup().addTo(map);

map.addControl(new L.Control.Draw({
  draw: {
    polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#2a9d8f', weight: 2, fillOpacity: 0.15 } },
    polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
  },
  edit: { featureGroup: drawnItems }
}));

let areaHa = null;

map.on(L.Draw.Event.CREATED, e => {
  drawnItems.clearLayers();          // keep only one catchment
  drawnItems.addLayer(e.layer);
  updateArea();
});
map.on(L.Draw.Event.EDITED, updateArea);
map.on(L.Draw.Event.DELETED, updateArea);

// 3. Area
function updateArea() {
  const layers = drawnItems.getLayers();
  if (layers.length === 0) {
    areaHa = null;
    setText('areaM2', '–'); setText('areaHa', '–');
    document.getElementById('drawHint').style.display = 'block';
  } else {
    const areaM2 = turf.area(layers[0].toGeoJSON());
    areaHa = areaM2 / 10000;
    setText('areaM2', fmt(areaM2, 0) + ' m²');
    setText('areaHa', fmt(areaHa, 3) + ' ha');
    document.getElementById('drawHint').style.display = 'none';
  }
  calculate();
}

// 4. Rainfall + Rational Method
const val = id => parseFloat(document.getElementById(id).value);
const mode = () => document.querySelector('input[name=mode]:checked').value;

function rainfallIntensity() {
  if (mode() === 'direct') return val('rain');

  const m560 = val('m560'), D = val('dur'), z1 = val('z1'), z2 = val('z2'), cc = val('cc') || 0;
  if ([m560, D, z1, z2].some(isNaN) || D <= 0) {
    ['m5d', 'mtd', 'iFsr'].forEach(id => setText(id, '–'));
    return NaN;
  }
  const m5d = z1 * m560;                    // M5-D (mm)
  const mtd = z2 * m5d * (1 + cc / 100);    // MT-D incl. climate change (mm)
  const i = mtd / (D / 60);                 // mm/hr
  setText('m5d', fmt(m5d, 1) + ' mm');
  setText('mtd', fmt(mtd, 1) + ' mm');
  setText('iFsr', fmt(i, 1) + ' mm/hr');
  return i;
}

function calculate() {
  const i = rainfallIntensity();
  const C = val('coef');

  if (areaHa === null || isNaN(i) || isNaN(C) || i < 0 || C < 0 || C > 1) {
    setText('flow', '–');
    setText('calcDetail', areaHa === null ? '' :
      (mode() === 'fsr' ? 'Enter M5-60, D, Z1 and Z2.' : 'Check inputs: C must be 0–1 and i must be positive.'));
    return;
  }
  const Q = 2.78 * C * i * areaHa;
  setText('flow', fmt(Q, 1) + ' L/s');
  setText('calcDetail', `Q = 2.78 × ${C} × ${fmt(i, 2)} × ${fmt(areaHa, 3)} = ${fmt(Q, 1)} L/s`);
}

document.querySelectorAll('#panel input').forEach(el => el.addEventListener('input', calculate));
document.querySelectorAll('input[name=mode]').forEach(el => el.addEventListener('change', () => {
  document.getElementById('directBox').style.display = mode() === 'direct' ? 'block' : 'none';
  document.getElementById('fsrBox').style.display = mode() === 'fsr' ? 'block' : 'none';
  calculate();
}));

// 5. Location search (Nominatim, limited to UK)
document.getElementById('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = document.getElementById('searchBox').value.trim();
  if (!q) return;
  try {
    // UK postcodes: postcodes.io (free, no key)
    const pc = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(q));
    if (pc.ok) {
      const r = (await pc.json()).result;
      map.setView([r.latitude, r.longitude], 17);
      return;
    }
    // Places/addresses: Nominatim (OpenStreetMap)
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url, { headers: { 'Accept': 'application/json' } })).json();
    if (data.length === 0) { alert('Location not found'); return; }
    map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
  } catch (err) {
    alert('Search failed: ' + err.message);
  }
});

// Helpers
function setText(id, txt) { document.getElementById(id).textContent = txt; }
function fmt(n, d) { return n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
