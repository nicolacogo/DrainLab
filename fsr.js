// ---------- FSR (Wallingford Modified Rational Method) rainfall calculations ----------
const FSR = (() => {
  const T = FSR_TABLES;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // index + fraction of v inside sorted array xs (optionally in log space)
  function bracket(xs, v, log) {
    const f = log ? Math.log : (x => x);
    v = clamp(v, xs[0], xs[xs.length - 1]);
    let i = 0;
    while (i < xs.length - 2 && v > xs[i + 1]) i++;
    return [i, (f(v) - f(xs[i])) / (f(xs[i + 1]) - f(xs[i]))];
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  // Z1 = M5-D / M5-60 for duration D (min) and ratio r
  function z1(r, D) {
    const [ir, tr] = bracket(T.z1.r, r, false);
    const [id, td] = bracket(T.z1.durations, D, true);
    const v = T.z1.values;
    const a = lerp(Math.log(v[ir][id]), Math.log(v[ir][id + 1]), td);
    const b = lerp(Math.log(v[ir + 1][id]), Math.log(v[ir + 1][id + 1]), td);
    return Math.exp(lerp(a, b, tr));
  }

  // Z2 = MT-D / M5-D for M5-D (mm), return period T (yr), region 'EW' or 'SNI'
  function z2(m5d, rp, region) {
    const tab = T.z2[region];
    const [im, tm] = bracket(T.z2.m5, m5d, false);
    const [it, tt] = bracket(T.z2.returnPeriods, rp, true);
    const row = i => lerp(tab[i][it], tab[i][it + 1], tt);
    return lerp(row(im), row(im + 1), tm);
  }

  // full calculation for one duration
  function intensity({ m560, r, D, rp, region, cc }) {
    const Z1 = z1(r, D);
    const m5d = Z1 * m560;
    const Z2 = z2(m5d, rp, region);
    const mtd = Z2 * m5d * (1 + (cc || 0) / 100);
    return { D, Z1, m5d, Z2, mtd, i: mtd / (D / 60) };
  }

  function warnings({ m560, r, rp }) {
    const w = [];
    if (r < T.z1.r[0] || r > T.z1.r[T.z1.r.length - 1]) w.push(`r = ${r} is outside the chart range 0.12–0.45 (clamped).`);
    if (rp < 1 || rp > 100) w.push(`Return period ${rp} yr is outside the table range 1–100 yr (clamped).`);
    if (m560 < 5) w.push('M5-60 looks too low – check the value.');
    return w;
  }

  // rough region from location: Scotland or Northern Ireland -> 'SNI', else 'EW'
  function guessRegion(lat, lng) {
    if (lng < -5.4 && lat > 54.0 && lat < 55.4) return 'SNI';            // Northern Ireland
    if (lat > 55.82) return 'SNI';
    if (lat > 54.95 && lng < -3.07 + (lat - 55.0) * 1.3) return 'SNI';    // Gretna-Berwick border (approx.)
    return 'EW';
  }

  return { z1, z2, intensity, warnings, guessRegion, durations: T.z1.durations };
})();
