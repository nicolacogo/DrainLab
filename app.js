// ---------- DrainLab v0.4 ----------

// 1. Map and base layers
const map = L.map('map').setView([51.3, 0.5], 9);
const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const esriAttr = 'Tiles &copy; Esri and contributors';
const streets = L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esriAttr }).addTo(map);
const satellite = L.layerGroup([
  L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esriAttr + ', Maxar, Earthstar Geographics' }),
  L.tileLayer(esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
  L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
]);
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17, attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)'
});
const layersCtl = L.control.layers({ 'Streets': streets, 'Satellite (with labels)': satellite, 'Topographic (contours)': topo }).addTo(map);
L.control.scale({ metric: true, imperial: false }).addTo(map);

// 2. Drawing tools (one catchment at a time)
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
let drawing = false;
map.on('draw:drawstart draw:editstart draw:deletestart', () => { drawing = true; });
map.on('draw:drawstop draw:editstop draw:deletestop', () => { setTimeout(() => { drawing = false; }, 50); });

map.on(L.Draw.Event.CREATED, e => {
  drawnItems.clearLayers();
  drawnItems.addLayer(e.layer);
  updateArea();
  const c = turf.centroid(e.layer.toGeoJSON()).geometry.coordinates;
  lookupRain(c[1], c[0], 'catchment centroid');
});
map.on(L.Draw.Event.EDITED, updateArea);
map.on(L.Draw.Event.DELETED, updateArea);

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

// 3. FSR grid lookup (M5-60 and r)
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs');
let grid = null;
let lookupMarker = null;

fetch('data/fsr_grid.json')
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(g => {
    grid = g;
    msg('Rainfall grid loaded. Click the map (or draw a catchment) to read M5-60 and r.', 'ok');
    addCoverageLayer();
  })
  .catch(() => msg('Rainfall grid not available – enter M5-60 and r manually. ' +
                   '(Testing locally? Run "python -m http.server 8000" and open http://localhost:8000.)', 'bad'));

function cellValue(arr, ix, iy) {
  if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) return null;
  return arr[iy * grid.nx + ix];
}
function sample(arr, x, y) {
  const fx = (x - grid.x0) / grid.cell - 0.5, fy = (y - grid.y0) / grid.cell - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const v = [cellValue(arr, ix, iy), cellValue(arr, ix + 1, iy), cellValue(arr, ix, iy + 1), cellValue(arr, ix + 1, iy + 1)];
  if (v.every(n => n !== null)) return v[0] * (1 - tx) * (1 - ty) + v[1] * tx * (1 - ty) + v[2] * (1 - tx) * ty + v[3] * tx * ty;
  return cellValue(arr, Math.round(fx), Math.round(fy));
}

function lookupRain(lat, lng, where) {
  document.getElementById('region').value = FSR.guessRegion(lat, lng);
  if (!grid) { calculate(); return; }
  const [x, y] = proj4('EPSG:4326', 'EPSG:27700', [lng, lat]);
  const m = sample(grid.m560, x, y), r = sample(grid.r, x, y);

  if (lookupMarker) map.removeLayer(lookupMarker);
  lookupMarker = L.circleMarker([lat, lng], { radius: 5, color: '#0f3b57', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  const xy = `E ${Math.round(x)}, N ${Math.round(y)}`;
  if (m == null || r == null) {
    lookupMarker.bindPopup(`${xy}<br>Outside the digitised area`).openPopup();
    msg(`Outside the digitised area (${xy}). Enter M5-60 and r manually.`, 'bad');
    calculate();
    return;
  }
  document.getElementById('m560').value = m.toFixed(1);
  document.getElementById('ratio').value = r.toFixed(3);
  document.querySelector('input[name=mode][value=fsr]').checked = true;
  showMode();
  lookupMarker.bindPopup(`${xy}<br>M5-60 = <b>${m.toFixed(1)} mm</b><br>r = <b>${r.toFixed(3)}</b>`).openPopup();
  msg(`From grid at ${where} (${xy}): M5-60 = ${m.toFixed(1)} mm, r = ${r.toFixed(3)}. You can overwrite these.`, 'ok');
}
map.on('click', e => { if (!drawing) lookupRain(e.latlng.lat, e.latlng.lng, 'clicked point'); });

function addCoverageLayer() {
  const cells = [], step = 5;
  for (let iy = 0; iy < grid.ny; iy += step) {
    for (let ix = 0; ix < grid.nx; ix += step) {
      const m = grid.m560[iy * grid.nx + ix];
      if (m == null) continue;
      const [lng, lat] = proj4('EPSG:27700', 'EPSG:4326', [grid.x0 + (ix + 0.5) * grid.cell, grid.y0 + (iy + 0.5) * grid.cell]);
      cells.push(L.circleMarker([lat, lng], { radius: 2, stroke: false, fillColor: colour(m), fillOpacity: 0.8, interactive: false }));
    }
  }
  layersCtl.addOverlay(L.layerGroup(cells), 'Rainfall grid coverage (M5-60)');
}
function colour(m) {
  const t = Math.max(0, Math.min(1, (m - 14) / 16));
  return `rgb(${Math.round(200 - 170 * t)},${Math.round(220 - 150 * t)},255)`;
}

// 4. FSR rainfall table + Rational Method
const val = id => parseFloat(document.getElementById(id).value);
const mode = () => document.querySelector('input[name=mode]:checked').value;
const durLabel = d => d < 60 ? `${d} min` : `${+(d / 60).toFixed(2)} hr`;

function fsrInputs() {
  return { m560: val('m560'), r: val('ratio'), rp: val('rp'), cc: val('cc') || 0, region: document.getElementById('region').value };
}

function renderTable() {
  const tbody = document.querySelector('#ddf tbody');
  const p = fsrInputs(), D = val('dur');
  tbody.innerHTML = '';
  if (isNaN(p.m560) || isNaN(p.r)) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6b7a86">Enter or look up M5-60 and r</td></tr>';
    setText('fsrWarn', '');
    return null;
  }
  setText('fsrWarn', FSR.warnings(p).join(' '));
  const ds = [...new Set([...FSR.durations, ...(D >= 5 && D <= 2880 ? [D] : [])])].sort((a, b) => a - b);
  let selected = null;
  for (const d of ds) {
    const res = FSR.intensity({ ...p, D: d });
    const tr = document.createElement('tr');
    if (d === D) { tr.className = 'sel'; selected = res; }
    tr.innerHTML = `<td>${durLabel(d)}</td><td>${res.Z1.toFixed(3)}</td><td>${res.m5d.toFixed(1)}</td>` +
                   `<td>${res.Z2.toFixed(3)}</td><td>${res.mtd.toFixed(1)}</td><td>${res.i.toFixed(1)}</td>`;
    tr.addEventListener('click', () => { document.getElementById('dur').value = d; calculate(); });
    tbody.appendChild(tr);
  }
  return selected;
}

function rainfallIntensity() {
  if (mode() === 'direct') { setText('iUsed', ''); return val('rain'); }
  const sel = renderTable();
  if (!sel) { setText('iUsed', ''); return NaN; }
  setText('iUsed', `i = ${sel.i.toFixed(1)} mm/hr (${val('rp')} yr, ${durLabel(sel.D)}, +${val('cc') || 0}% CC)`);
  return sel.i;
}

function calculate() {
  const i = rainfallIntensity();
  const C = val('coef');
  if (areaHa === null || isNaN(i) || isNaN(C) || i < 0 || C < 0 || C > 1) {
    setText('flow', '–');
    setText('calcDetail', areaHa === null ? '' :
      (mode() === 'fsr' ? 'Enter M5-60, r and a duration between 5 min and 48 hr.' : 'Check inputs: C must be 0–1 and i must be positive.'));
    return;
  }
  const Q = 2.78 * C * i * areaHa;
  setText('flow', fmt(Q, 1) + ' L/s');
  setText('calcDetail', `Q = 2.78 × ${C} × ${fmt(i, 2)} × ${fmt(areaHa, 3)} = ${fmt(Q, 1)} L/s ` +
                        `(${(C * i / 3600).toFixed(4)} L/s/m²)`);
}

function showMode() {
  document.getElementById('directBox').style.display = mode() === 'direct' ? 'block' : 'none';
  document.getElementById('fsrBox').style.display = mode() === 'fsr' ? 'block' : 'none';
  calculate();
}
document.querySelectorAll('#panel input, #panel select').forEach(el => el.addEventListener('input', calculate));
document.querySelectorAll('input[name=mode]').forEach(el => el.addEventListener('change', showMode));
calculate();

// 5. Location search
document.getElementById('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = document.getElementById('searchBox').value.trim();
  if (!q) return;
  try {
    const pc = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(q));
    if (pc.ok) {
      const r = (await pc.json()).result;
      map.setView([r.latitude, r.longitude], 15);
      return;
    }
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url, { headers: { 'Accept': 'application/json' } })).json();
    if (data.length === 0) { alert('Location not found'); return; }
    map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 15);
  } catch (err) {
    alert('Search failed: ' + err.message);
  }
});

// Helpers
function setText(id, txt) { document.getElementById(id).textContent = txt; }
function fmt(n, d) { return n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function msg(t, cls) { const el = document.getElementById('lookupMsg'); el.textContent = t; el.className = 'hint ' + (cls || ''); }
