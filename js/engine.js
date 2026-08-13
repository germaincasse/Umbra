/* =====================================================================
   Solar eclipse engine
   Sun  : Meeus ch.25 + classical planetary/lunar perturbation terms
   Moon : Meeus ch.47 (truncated ELP-2000/82)
   Besselian elements computed directly from the geometry (no polynomials)
   Delta T : Espenak & Meeus polynomial expressions (same as NASA canon)
   ===================================================================== */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EARTH_R = 6378.1366;          // equatorial radius, km
const FLAT = 1 / 298.257223563;     // flattening
const ONE_F = 1 - FLAT;
const E2 = 1 - ONE_F * ONE_F;       // eccentricity squared
const K_MOON = 0.2725076;           // moon radius / earth equatorial radius
const K_SUN = 218.24504 / 2;        // sun radius in earth radii (696000/6378.1366)
const AU_ER = 149597870.7 / EARTH_R;

function nm(a) { a %= 360; return a < 0 ? a + 360 : a; }
const sind = a => Math.sin(a * DEG), cosd = a => Math.cos(a * DEG);

/* ---------- calendar ---------- */
function jdFromCal(y, m, d) {            // d may be fractional; Julian cal. before 1582-10-15
  if (m <= 2) { y -= 1; m += 12; }
  let b = 0;
  const greg = (y > 1582) || (y === 1582 && (m > 10 || (m === 10 && d >= 15)));
  if (greg) { const a = Math.floor(y / 100); b = 2 - a + Math.floor(a / 4); }
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}
function calFromJd(jd) {
  const z0 = jd + 0.5, z = Math.floor(z0), f = z0 - z;
  let a = z;
  if (z >= 2299161) { const al = Math.floor((z - 1867216.25) / 36524.25); a = z + 1 + al - Math.floor(al / 4); }
  const b = a + 1524, c = Math.floor((b - 122.1) / 365.25), d = Math.floor(365.25 * c),
    e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { y: year, m: month, d: day, greg: z >= 2299161 };
}
function yearOf(jd) {
  const c = calFromJd(jd);
  return c.y + (c.m - 1) / 12 + c.d / 365.25;
}

/* ---------- Delta T (Espenak & Meeus 2006) ---------- */
function deltaT(year) {
  let u, t;
  if (year < -500) { u = (year - 1820) / 100; return -20 + 32 * u * u; }
  if (year < 500) {
    u = year / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3
      - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
  }
  if (year < 1600) {
    u = (year - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3
      - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  if (year < 1700) { t = year - 1600; return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129; }
  if (year < 1800) { t = year - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (year < 1860) {
    t = year - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4
      + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (year < 1900) { t = year - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (year < 1920) { t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year < 1941) { t = year - 1920; return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3; }
  if (year < 1961) { t = year - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (year < 1986) { t = year - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (year < 2005) {
    t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year < 2050) { t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  if (year < 2150) { u = (year - 1820) / 100; return -20 + 32 * u * u - 0.5628 * (2150 - year); }
  u = (year - 1820) / 100; return -20 + 32 * u * u;
}

/* ---------- nutation & obliquity ---------- */
function nutation(T) {
  const om = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + T * T * T / 450000;
  const L = 280.4665 + 36000.7698 * T;
  const Lp = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.20 * sind(om) - 1.32 * sind(2 * L) - 0.23 * sind(2 * Lp) + 0.21 * sind(2 * om)) / 3600;
  const deps = (9.20 * cosd(om) + 0.57 * cosd(2 * L) + 0.10 * cosd(2 * Lp) - 0.09 * cosd(2 * om)) / 3600;
  return { dpsi, deps };
}
function obliquity(T) {
  const U = T / 100;
  return 23.43929111 - (4680.93 * U + 1.55 * U ** 2 - 1999.25 * U ** 3 - 51.38 * U ** 4 - 249.67 * U ** 5
    - 39.05 * U ** 6 + 7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10) / 3600;
}

/* ---------- Sun (geometric geocentric, mean equinox of date) ---------- */
function sunPos(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M)
    + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
  let lon = L0 + C;
  const v = M + C;
  let R = 1.000001018 * (1 - e * e) / (1 + e * cosd(v));
  // classical planetary + lunar perturbations (Newcomb)
  const A = 153.23 + 22518.7541 * T, B = 216.57 + 45037.5082 * T, Cc = 312.69 + 32964.3577 * T,
    D = 350.74 + 445267.1142 * T - 0.00144 * T * T, E = 231.19 + 20.20 * T, H = 353.40 + 65928.7155 * T;
  lon += 0.00134 * cosd(A) + 0.00154 * cosd(B) + 0.00200 * cosd(Cc) + 0.00179 * sind(D) + 0.00178 * sind(E);
  R += 0.00000543 * sind(A) + 0.00001575 * sind(B) + 0.00001627 * sind(Cc)
    + 0.00003076 * cosd(D) + 0.00000927 * sind(H);
  return { lon: nm(lon), lat: 0, R };
}

/* ---------- Moon (Meeus 47) ---------- */
const ML = [
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
  [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
  [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
  [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
  [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
  [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
  [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
  [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
  [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
  [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
  [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
  [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
  [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
  [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
  [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
  [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752]
];
const MB = [
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
  [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
  [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
  [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
  [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
  [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
  [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
  [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
  [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
  [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],
  [2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],
  [0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
  [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],
  [0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],
  [4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107]
];
function moonPos(T) {
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2 + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2 + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2 + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2 + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T ** 2 - T ** 3 / 3526000 + T ** 4 / 863310000;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const t of ML) {
    let arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    let f = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E * E);
    sl += t[4] * f * sind(arg); sr += t[5] * f * cosd(arg);
  }
  for (const t of MB) {
    let arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
    let f = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E * E);
    sb += t[4] * f * sind(arg);
  }
  sl += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
  sb += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F) + 175 * sind(A1 + F)
    + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);
  return { lon: nm(Lp + sl / 1e6), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

/* ---------- Besselian elements at a given TT instant ---------- */
function bessel(jdtt) {
  const T = (jdtt - 2451545.0) / 36525;
  const nut = nutation(T), eps = obliquity(T) + nut.deps;
  const s = sunPos(T), m = moonPos(T);
  const slon = s.lon + nut.dpsi - 0.005693 / s.R;     // apparent
  const sr = s.R * AU_ER;                             // earth radii
  const mlon = m.lon + nut.dpsi, mlat = m.lat, mr = m.dist / EARTH_R;
  // equatorial rectangular
  const se = sind(eps), ce = cosd(eps);
  const sx = sr * cosd(slon), sy = sr * (sind(slon) * ce), sz = sr * (sind(slon) * se);
  const cmb = cosd(mlat), smb = sind(mlat);
  const mx = mr * cmb * cosd(mlon);
  const my = mr * (cmb * sind(mlon) * ce - smb * se);
  const mz = mr * (cmb * sind(mlon) * se + smb * ce);
  // shadow axis: unit vector Moon -> Sun
  let ux = sx - mx, uy = sy - my, uz = sz - mz;
  const G = Math.hypot(ux, uy, uz);
  ux /= G; uy /= G; uz /= G;
  const a = Math.atan2(uy, ux), d = Math.asin(uz);
  const sa = Math.sin(a), ca = Math.cos(a), sd = Math.sin(d), cd = Math.cos(d);
  const x = -mx * sa + my * ca;
  const y = -mx * sd * ca - my * sd * sa + mz * cd;
  const z = mx * cd * ca + my * cd * sa + mz * sd;
  const tf1 = (K_SUN + K_MOON) / G, tf2 = (K_SUN - K_MOON) / G;
  const l1 = z * tf1 + K_MOON / Math.sqrt(1 - tf1 * tf1);
  const l2 = z * tf2 - K_MOON / Math.sqrt(1 - tf2 * tf2);
  // Greenwich apparent sidereal time at the corresponding UT
  const dt = deltaT(yearOf(jdtt)) / 86400;
  const jdut = jdtt - dt;
  const Tu = (jdut - 2451545.0) / 36525;
  let gmst = 280.46061837 + 360.98564736629 * (jdut - 2451545.0)
    + 0.000387933 * Tu * Tu - Tu ** 3 / 38710000;
  const gast = gmst + nut.dpsi * cosd(eps);
  const mu = nm(gast - a * RAD);
  return { x, y, z, d: d * RAD, mu, l1, l2, tf1, tf2, jdtt, jdut };
}

/* ---------- geometry helpers ---------- */
const RHO1 = d => Math.sqrt(1 - E2 * cosd(d) ** 2);
function auxD(d) {
  const r1 = Math.sqrt(1 - E2 * cosd(d) ** 2), r2 = Math.sqrt(1 - E2 * sind(d) ** 2);
  const sd1 = sind(d) / r1, cd1 = ONE_F * cosd(d) / r1;
  const sd2 = ONE_F * sind(d) / r2, cd2 = cosd(d) / r2;
  const sdd = E2 * sind(d) * cosd(d) / (r1 * r2), cdd = ONE_F / (r1 * r2);
  return { r1, r2, sd1, cd1, sd2, cd2, sdd, cdd };
}
/* project a point (x,y) of the fundamental plane onto the ellipsoid.
   clamp=true pushes points outside the disc back to the limb           */
function project(be, X, Y, clamp) {
  const A = auxD(be.d);
  const eta1 = Y / A.r1;
  let r2 = X * X + eta1 * eta1, off = false;
  let xx = X, ee = eta1;
  if (r2 > 1) { off = true; if (!clamp) return null; const s = 1 / Math.sqrt(r2); xx *= s; ee *= s; r2 = 1; }
  const z1 = Math.sqrt(Math.max(0, 1 - r2));
  const sinu = ee * A.cd1 + z1 * A.sd1;
  const cosucos = z1 * A.cd1 - ee * A.sd1;
  const lat = Math.atan2(sinu, Math.hypot(xx, cosucos) * ONE_F) * RAD;
  const th = Math.atan2(xx, cosucos) * RAD;
  let lon = th - be.mu; lon = ((lon + 180) % 360 + 360) % 360 - 180;
  const zeta = A.r2 * (z1 * A.cdd - ee * A.sdd);
  return { lat, lon, zeta, off };
}

/* ---------- eclipse search ---------- */
function newMoonJDE(k) {
  const T = k / 1236.85;
  return 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
}
function axisDist(jd) { const b = bessel(jd); return Math.hypot(b.x, b.y); }
function axisDist2(jd) { const b = bessel(jd); return b.x * b.x + b.y * b.y; }

function findGreatest(jd0) {
  // the true conjunction may be up to ~0.6 d away from the mean new moon
  let best = jd0, bd = Infinity;
  for (let dt = -0.8; dt <= 0.8; dt += 0.04) {
    const v = axisDist2(jd0 + dt);
    if (v < bd) { bd = v; best = jd0 + dt; }
  }
  // d^2 is very nearly a parabola in t : 3-point fit converges immediately
  let h = 0.04;
  for (let i = 0; i < 12; i++) {
    const f0 = axisDist2(best - h), f1 = axisDist2(best), f2 = axisDist2(best + h);
    const den = f0 - 2 * f1 + f2;
    let shift = den !== 0 ? 0.5 * h * (f0 - f2) / den : 0;
    if (!isFinite(shift)) shift = 0;
    shift = Math.max(-2 * h, Math.min(2 * h, shift));
    best += shift; h = Math.max(h * 0.5, 1e-6);
    if (Math.abs(shift) < 1e-8) break;
  }
  return best;
}

/* full description of one eclipse, given approximate new moon time */
function analyse(jdnm) {
  const jg = findGreatest(jdnm);
  const b = bessel(jg);
  const r1 = RHO1(b.d);
  const y1 = b.y / r1;
  const rho = Math.hypot(b.x, y1);
  const gamma = Math.hypot(b.x, b.y) * (b.y < 0 ? -1 : 1);
  if (rho > 1 + Math.abs(b.l1)) return null;              // no eclipse
  const central = rho < 1;
  let type, mag;
  if (central) {
    const p = project(b, b.x, b.y, false);
    const L2 = b.l2 - p.zeta * b.tf2, L1 = b.l1 - p.zeta * b.tf1;
    type = L2 < 0 ? 'T' : 'A';
    mag = (L1 - L2) / (L1 + L2);
  } else {
    const m = rho - 1;
    mag = (b.l1 - m) / (b.l1 + b.l2);
    if (mag <= 0) return null;
    // the umbra may still graze the limb without the axis touching the globe
    type = (m < Math.abs(b.l2)) ? (b.l2 < 0 ? 'T' : 'A') : 'P';
  }
  const res = { jd: jg, jdut: b.jdut, gamma, type, mag, central, dT: deltaT(yearOf(jg)) };
  if (!central) { const p = project(b, b.x, b.y, true); res.gLat = p.lat; res.gLon = p.lon; return res; }
  res.gLat = null;
  return res;
}

/* ---------- central path ---------- */
function computePath(ecl) {
  // find start / end of the central path
  const f = jd => { const b = bessel(jd); return Math.hypot(b.x, b.y / RHO1(b.d)) - 1; };
  const bisect = (lo, hi) => {
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  let t0 = ecl.jd, t1 = ecl.jd;
  let step = 0.005;
  while (f(t0 - step) < 0 && ecl.jd - t0 < 0.35) t0 -= step;
  while (f(t1 + step) < 0 && t1 - ecl.jd < 0.35) t1 += step;
  const jdStart = bisect(t0, t0 - step), jdEnd = bisect(t1, t1 + step);
  const N = 150;
  const dt = (jdEnd - jdStart) / N;
  const center = [], limA = [], limB = [], meta = [];
  let maxDur = 0, maxDurPt = null, wGreatest = 0, hasT = false, hasA = false, bestDG = 1e9;
  for (let i = 0; i <= N; i++) {
    const jd = jdStart + i * dt;
    const b = bessel(jd);
    const p = project(b, b.x, b.y, true);
    if (!p) continue;
    const h = 1 / 1440;
    const bm = bessel(jd - h), bp = bessel(jd + h);
    const xp = (bp.x - bm.x) / (2 * h), yp = (bp.y - bm.y) / (2 * h);
    let dmu = bp.mu - bm.mu; if (dmu < -180) dmu += 360; if (dmu > 180) dmu -= 360;
    const mup = (dmu * DEG) / (2 * h);
    const L2 = b.l2 - p.zeta * b.tf2, L1 = b.l1 - p.zeta * b.tf1;
    const a = xp - mup * (p.zeta * cosd(b.d) - b.y * sind(b.d));
    const bb = yp - mup * b.x * sind(b.d);
    const n = Math.hypot(a, bb);
    const dur = 2 * Math.abs(L2) / n * 86400;
    // limits : offset perpendicular to the relative motion, refined once on zeta
    const ux = bb / n, uy = -a / n;
    const lim = sgn => {
      let off = Math.abs(L2), pt = null;
      for (let it = 0; it < 2; it++) {
        pt = project(b, b.x + sgn * off * ux, b.y + sgn * off * uy, true);
        off = Math.abs(b.l2 - pt.zeta * b.tf2);
      }
      return pt;
    };
    const pA = lim(1), pB = lim(-1);
    if (L2 < 0) hasT = true; else hasA = true;
    const w = greatCircle(pA.lat, pA.lon, pB.lat, pB.lon);
    if (dur > maxDur) { maxDur = dur; maxDurPt = { lat: p.lat, lon: p.lon, jd }; }
    const dg = Math.abs(jd - ecl.jd);
    if (dg < bestDG) { bestDG = dg; wGreatest = w; }
    center.push([p.lon, p.lat]); limA.push([pA.lon, pA.lat]); limB.push([pB.lon, pB.lat]);
    meta.push({ jd, dur, w, L2, sunAlt: Math.asin(Math.max(-1, Math.min(1, p.zeta))) * RAD });
  }
  return {
    jdStart, jdEnd, center, limA, limB, meta,
    maxDur, maxDurPt, width: wGreatest,
    hybrid: hasT && hasA
  };
}

/* ---------- local circumstances for one observer ---------- */
function observerXYZ(b, latDeg, lonDeg) {
  const u = Math.atan(ONE_F * Math.tan(latDeg * DEG));
  const th = (b.mu + lonDeg) * DEG;
  const cu = Math.cos(u), su = Math.sin(u);
  const xi = cu * Math.sin(th);
  const eta = su * cosd(b.d) * ONE_F - cu * sind(b.d) * Math.cos(th);
  const ze = su * sind(b.d) * ONE_F + cu * cosd(b.d) * Math.cos(th);
  return { xi, eta, ze };
}
/* returns null if no eclipse is visible from that place */
function localCircumstances(ecl, lat, lon) {
  let jd = ecl.jd, b, o, u, v, n, aa, bb;
  const h = 1 / 1440;
  for (let it = 0; it < 8; it++) {
    b = bessel(jd); o = observerXYZ(b, lat, lon);
    const bm = bessel(jd - h), bp = bessel(jd + h);
    const om = observerXYZ(bm, lat, lon), op = observerXYZ(bp, lat, lon);
    u = b.x - o.xi; v = b.y - o.eta;
    aa = ((bp.x - op.xi) - (bm.x - om.xi)) / (2 * h);
    bb = ((bp.y - op.eta) - (bm.y - om.eta)) / (2 * h);
    n = Math.hypot(aa, bb);
    const tau = -(u * aa + v * bb) / (n * n);
    jd += tau;
    if (Math.abs(tau) < 1e-8) break;
  }
  const m = Math.hypot(u, v);
  const L1 = b.l1 - o.ze * b.tf1, L2 = b.l2 - o.ze * b.tf2;
  if (m > L1 || o.ze < 0.002) return null;                // no eclipse, or sun below horizon
  const mag = (L1 - m) / (L1 + L2);
  const obsc = obscuration(mag, L1, L2, m);
  const res = { jd, jdut: b.jdut + (jd - b.jdtt), mag, obsc, alt: Math.asin(Math.max(-1, Math.min(1, o.ze))) * RAD, type: 'P', dur: 0 };
  res.jdut = jd - deltaT(yearOf(jd)) / 86400;
  if (m < Math.abs(L2)) {
    res.type = L2 < 0 ? 'T' : 'A';
    res.dur = 2 * Math.sqrt(Math.max(0, L2 * L2 - (u * bb - v * aa) ** 2 / (n * n))) / n * 86400;
  }
  const half = Math.sqrt(Math.max(0, L1 * L1 - (u * bb - v * aa) ** 2 / (n * n))) / n;
  res.jdC1 = jd - half; res.jdC4 = jd + half;
  return res;
}
function obscuration(mag, L1, L2, m) {
  // fraction of the solar disc area covered
  const rs = (L1 + L2) / 2, rm = (L1 - L2) / 2;   // radii on the fundamental plane scale
  if (m >= rs + rm) return 0;
  if (m <= Math.abs(rs - rm)) return rm >= rs ? 1 : (rm * rm) / (rs * rs);
  const a1 = Math.acos(Math.min(1, Math.max(-1, (m * m + rs * rs - rm * rm) / (2 * m * rs))));
  const a2 = Math.acos(Math.min(1, Math.max(-1, (m * m + rm * rm - rs * rs) / (2 * m * rm))));
  const area = rs * rs * (a1 - Math.sin(2 * a1) / 2) + rm * rm * (a2 - Math.sin(2 * a2) / 2);
  return area / (Math.PI * rs * rs);
}

/* ---------- shadow outline at a given instant (for the animation) ---------- */
function shadowOutline(jd, kind) {
  const b = bessel(jd);
  const L = kind === 'pen' ? b.l1 : b.l2;
  const tf = kind === 'pen' ? b.tf1 : b.tf2;
  const pts = [];
  const R = Math.abs(L);
  for (let i = 0; i <= 72; i++) {
    const a = i / 72 * 2 * Math.PI;
    let off = R, p = null;
    for (let it = 0; it < 2; it++) {
      p = project(b, b.x + off * Math.cos(a), b.y + off * Math.sin(a), true);
      off = Math.abs(L - p.zeta * tf);
    }
    pts.push([p.lon, p.lat, p.off]);
  }
  const c = project(b, b.x, b.y, true);
  return { pts, center: [c.lon, c.lat], onEarth: !c.off, b };
}

function greatCircle(la1, lo1, la2, lo2) {
  const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ---------- scan a year range ---------- */
function scanRange(y0, y1, onProgress) {
  const jd0 = jdFromCal(y0, 1, 1), jd1 = jdFromCal(y1 + 1, 1, 1);
  let k0 = Math.floor((jd0 - 2451550.09766) / 29.530588861) - 2;
  let k1 = Math.ceil((jd1 - 2451550.09766) / 29.530588861) + 2;
  const out = [];
  for (let k = k0; k <= k1; k++) {
    const jd = newMoonJDE(k);
    if (jd < jd0 - 40 || jd > jd1 + 40) continue;
    const e = analyse(jd);
    if (!e) continue;
    if (e.jd < jd0 || e.jd >= jd1) continue;
    e.k = k;
    out.push(e);
  }
  return out;
}

if (typeof module !== 'undefined') Object.assign(module.exports, {
  jdFromCal, calFromJd, bessel, analyse, computePath, scanRange, localCircumstances, shadowOutline, observerXYZ, deltaT, project, moonPos, sunPos, newMoonJDE, yearOf, greatCircle
});
