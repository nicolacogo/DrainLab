DrainLab v0.4

FILES
  index.html, style.css, app.js   the web app
  fsr.js                          Z1 / Z2 / intensity calculations
  data/fsr_tables.js              Z1 (Vol 4 Fig A.3, digitised) and Z2 (Vol 4 Tables A1/A2)
  data/fsr_grid.json              your M5-60 / r grid (copy it here - not included)
  tools/make_rain_grid.py         builds data/fsr_grid.json from your QGIS GeoPackages

RUN LOCALLY
  in this folder:  python -m http.server 8000
  then open        http://localhost:8000

TEST VALUES (Shipley, ACO): M5-60 17.7, r 0.30, 50 yr, 15 min, CC 0%
  ACO gives 67.5 mm/hr; DrainLab gives about 70 mm/hr (Z1 read from the Vol 4 chart is ~0.02 higher).
