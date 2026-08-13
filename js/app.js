/* =====================================================================
   Umbra — interface
   ===================================================================== */
const $ = s => document.querySelector(s);
const TAU = Math.PI * 2, D2R = Math.PI / 180;
let lang = null;
try { lang = localStorage.getItem('umbra-lang'); } catch (e) { }
if (!lang || !I18N[lang]) lang = 'en';
let L = I18N[lang];
const TYPES = {
  T: { label: L.types.T, color: '#FFE4A0' },
  A: { label: L.types.A, color: '#FF9147' },
  H: { label: L.types.H, color: '#C98BFF' },
  P: { label: L.types.P, color: '#5E86B8' }
};
const DOMAIN = [1500, 2500], HARD = [-1999, 3000], MAXSPAN = 400;

const state = {
  y0: 2025, y1: 2050,
  filters: { T: true, A: true, H: true, P: false },
  color: 'type',
  view: 'globe',
  tab: 'list',
  sel: null,
  probe: null,
  anim: null,        // {jd, playing, t0, t1}
  hover: null
};
const cache = new Map();          // decade -> eclipse[]
let visible = [];                 // eclipses currently displayed
let allInRange = [];

/* ---------------- date helpers ---------------- */
function fmtDate(jd, short) {
  const c = calFromJd(jd);
  const d = Math.floor(c.d);
  if (short) return L.dateShort === 'iso'
    ? `${c.y}-${String(c.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : `${String(d).padStart(2, '0')}/${String(c.m).padStart(2, '0')}/${c.y}`;
  return `${d} ${L.months[c.m - 1]} ${c.y < 1 ? (1 - c.y) + ' ' + L.bc : c.y}`;
}
function fmtTime(jd) {
  let h = ((jd + 0.5) % 1) * 24; if (h < 0) h += 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round((((h - hh) * 60) - mm) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm + (ss === 60 ? 1 : 0)).padStart(2, '0')}:${String(ss % 60).padStart(2, '0')}`;
}
function fmtDur(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m} min ${String(r).padStart(2, '0')} s`;
}
function fmtObsc(o) {
  // keep a decimal for near misses, so a 99.86 % partial never reads as 100 %
  const v = o * 100;
  if (v >= 99.9) return '> 99.9';   // a partial eclipse must never read as a full 100 %
  return v > 99 ? v.toFixed(1) : v.toFixed(0);
}
function fmtLat(v) { return `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'N' : 'S'}`; }
function fmtLon(v) { return `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : L.lonW}`; }

/* ---------------- computation pipeline ---------------- */
let computing = false, queue = [];
function decadesFor(y0, y1) {
  const out = [];
  for (let d = Math.floor(y0 / 10) * 10; d <= y1; d += 10) out.push(d);
  return out;
}
function requestRange() {
  queue = decadesFor(state.y0, state.y1).filter(d => !cache.has(d));
  if (!computing) runQueue();
  collect();
}
function runQueue() {
  if (!queue.length) { computing = false; $('#progress').style.width = '0'; collect(); draw(); return; }
  computing = true;
  const total = queue.length;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 90) {
      const d = queue.shift();
      cache.set(d, buildDecade(d));
    }
    $('#progress').style.width = (100 * (1 - queue.length / total)).toFixed(0) + '%';
    collect(); draw(); renderPane();
    if (queue.length) requestAnimationFrame(step);
    else { computing = false; $('#progress').style.width = '0'; }
  };
  requestAnimationFrame(step);
}
function buildDecade(d) {
  const list = scanRange(d, d + 9);
  for (const e of list) {
    if (e.central) {
      e.path = computePath(e);
      if (e.path.hybrid) e.type = 'H';
      e.dur = e.path.maxDur; e.width = e.path.width;
    }
    e.year = calFromJd(e.jd).y;
  }
  return list;
}
function collect() {
  allInRange = [];
  for (const d of decadesFor(state.y0, state.y1)) {
    const l = cache.get(d); if (!l) continue;
    for (const e of l) if (e.year >= state.y0 && e.year <= state.y1) allInRange.push(e);
  }
  allInRange.sort((a, b) => a.jd - b.jd);
  visible = allInRange.filter(e => state.filters[e.type]);
  $('#countInfo').textContent = L.count(visible.length);
  const counts = { T: 0, A: 0, H: 0, P: 0 };
  allInRange.forEach(e => counts[e.type]++);
  document.querySelectorAll('.filt').forEach(el => {
    el.querySelector('b').textContent = counts[el.dataset.t];
  });
  drawRibbon();
}

/* ---------------- projection ---------------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { zoom: 1, lon0: 0, lat0: 0, glon: 0, glat: 20, gzoom: 1 };

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.parentElement.getBoundingClientRect();
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rb = $('#ribbon'), rr = rb.parentElement.getBoundingClientRect();
  rb.width = Math.round(rr.width * DPR); rb.height = Math.round(rr.height * DPR);
  rb.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0);
  draw(); drawRibbon();
}
function kFlat() { return (W / 360) * cam.zoom; }
/* zoom that makes the full map fill the stage height (never below world width) */
function fitZoom() { return Math.max(1, Math.min(8, 2 * H / W)); }
function globeR() { return Math.min(W, H) * 0.46 * cam.gzoom; }

function proj(lon, lat) {         // -> [x, y, visible]
  if (state.view === 'flat') {
    const k = kFlat();
    return [W / 2 + (lon - cam.lon0) * k, H / 2 - (lat - cam.lat0) * k, true];
  }
  const R = globeR(), p = lat * D2R, l = (lon - cam.glon) * D2R, p0 = cam.glat * D2R;
  const cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l), sl = Math.sin(l);
  const cosc = Math.sin(p0) * sp + Math.cos(p0) * cp * cl;
  let x = R * cp * sl, y = -R * (Math.cos(p0) * sp - Math.sin(p0) * cp * cl);
  if (cosc < 0) { const m = Math.hypot(x, y) || 1; x = x / m * R; y = y / m * R; }
  return [W / 2 + x, H / 2 + y, cosc >= 0];
}
function unproj(px, py) {
  if (state.view === 'flat') {
    const k = kFlat();
    let lon = (px - W / 2) / k + cam.lon0, lat = cam.lat0 - (py - H / 2) / k;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    if (Math.abs(lat) > 90) return null;
    return [lon, lat];
  }
  const R = globeR(), x = px - W / 2, y = py - H / 2, rho = Math.hypot(x, y);
  if (rho > R) return null;
  const cc = Math.asin(Math.min(1, rho / R)), p0 = cam.glat * D2R;
  const lat = Math.asin(Math.cos(cc) * Math.sin(p0) + (rho ? (-y) * Math.sin(cc) * Math.cos(p0) / rho : 0)) / D2R;
  const lon = cam.glon + Math.atan2(x * Math.sin(cc), rho * Math.cos(cc) * Math.cos(p0) + y * Math.sin(cc) * Math.sin(p0)) / D2R;
  return [((lon + 180) % 360 + 360) % 360 - 180, lat];
}
function lonOffsets() {
  if (state.view !== 'flat') return [0];
  const k = kFlat(), half = (W / 2) / k;
  const lo = cam.lon0 - half, hi = cam.lon0 + half, out = [];
  for (let o = Math.floor((lo + 180) / 360) * 360; o <= hi + 180; o += 360) out.push(o);
  return out.length ? out : [0];
}

/* ---- orthographic helpers: cull & clip at the horizon (globe view) ---- */
function projRaw(lon, lat) {      // centered coords + visibility, no limb clamping
  const R = globeR(), p = lat * D2R, l = (lon - cam.glon) * D2R, p0 = cam.glat * D2R;
  const cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l), sl = Math.sin(l);
  return {
    x: R * cp * sl,
    y: -R * (Math.cos(p0) * sp - Math.sin(p0) * cp * cl),
    cosc: Math.sin(p0) * sp + Math.cos(p0) * cp * cl
  };
}
function horizonCross(a, b) {     // point of segment a-b lying on the horizon (a in front, b behind)
  const t = a.cosc / (a.cosc - b.cosc);
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  const m = Math.hypot(x, y) || 1, R = globeR();
  return { x: x / m * R, y: y / m * R, ang: Math.atan2(y, x) };
}
/* closed ring clipped at the horizon: hidden runs are replaced by an arc
   along the limb, so a band or a landmass can never swallow the whole disc */
function traceGlobeFill(pts) {
  const P = pts.map(q => projRaw(q[0], q[1]));
  const n = P.length, cx = W / 2, cy = H / 2, R = globeR();
  const s = P.findIndex(p => p.cosc >= 0);
  if (s < 0) return;                                   // fully behind the globe
  if (P.every(p => p.cosc >= 0)) {                     // fully in front
    ctx.moveTo(cx + P[0].x, cy + P[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(cx + P[i].x, cy + P[i].y);
    ctx.closePath(); return;
  }
  ctx.moveTo(cx + P[s].x, cy + P[s].y);
  let exit = null;
  for (let k = 0; k < n; k++) {
    const a = P[(s + k) % n], b = P[(s + k + 1) % n];
    if (a.cosc >= 0 && b.cosc >= 0) { ctx.lineTo(cx + b.x, cy + b.y); }
    else if (a.cosc >= 0 && b.cosc < 0) {              // going behind
      const c = horizonCross(a, b);
      ctx.lineTo(cx + c.x, cy + c.y); exit = c.ang;
    } else if (a.cosc < 0 && b.cosc >= 0) {            // coming back in front
      const c = horizonCross(b, a);
      if (exit !== null) {                             // bridge along the limb, short way
        let d = c.ang - exit; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        ctx.arc(cx, cy, R, exit, exit + d, d < 0);
      } else ctx.moveTo(cx + c.x, cy + c.y);
      ctx.lineTo(cx + b.x, cy + b.y); exit = null;
    }
  }
  ctx.closePath();
}

/* trace a polyline given as [[lon,lat],...] ; on the globe the line is cut
   at the horizon instead of being clamped onto the limb */
function tracePoly(pts, off, close) {
  if (state.view !== 'flat') {
    if (close) return traceGlobeFill(pts);
    const cx = W / 2, cy = H / 2;
    let prev = null, started = false;
    for (let i = 0; i < pts.length; i++) {
      const p = projRaw(pts[i][0], pts[i][1]);
      if (prev) {
        if (prev.cosc >= 0 && p.cosc >= 0) {
          if (!started) { ctx.moveTo(cx + prev.x, cy + prev.y); started = true; }
          ctx.lineTo(cx + p.x, cy + p.y);
        } else if (prev.cosc >= 0 && p.cosc < 0) {
          const c = horizonCross(prev, p);
          if (!started) { ctx.moveTo(cx + prev.x, cy + prev.y); started = true; }
          ctx.lineTo(cx + c.x, cy + c.y); started = false;
        } else if (prev.cosc < 0 && p.cosc >= 0) {
          const c = horizonCross(p, prev);
          ctx.moveTo(cx + c.x, cy + c.y); ctx.lineTo(cx + p.x, cy + p.y); started = true;
        }
      }
      prev = p;
    }
    return;
  }
  let started = false, prevLon = null;
  for (let i = 0; i < pts.length; i++) {
    const lon = pts[i][0], lat = pts[i][1];
    if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
      started = false;                      // dateline jump
    }
    prevLon = lon;
    const [x, y] = proj(lon + off, lat);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  if (close) ctx.closePath();
}
function anyVisible(pts) {
  if (state.view === 'flat') return true;
  for (let i = 0; i < pts.length; i += 3) { if (proj(pts[i][0], pts[i][1])[2]) return true; }
  return false;
}

/* ---------------- base map ---------------- */
function drawGraticule() {
  ctx.strokeStyle = '#111A2A'; ctx.lineWidth = 1; ctx.beginPath();
  const offs = lonOffsets();
  for (const off of offs) {
    for (let lon = -180; lon <= 180; lon += 30) {
      const seg = [];
      for (let lat = -90; lat <= 90; lat += 5) seg.push([lon, lat]);
      tracePoly(seg, off, false);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const seg = [];
      for (let lon = -180; lon <= 180; lon += 5) seg.push([lon, lat]);
      tracePoly(seg, off, false);
    }
  }
  ctx.stroke();
  if (state.view === 'flat') return;
  ctx.strokeStyle = '#1C2942'; ctx.beginPath();
  const eq = []; for (let lon = -180; lon <= 180; lon += 4) eq.push([lon, 0]);
  tracePoly(eq, 0, false); ctx.stroke();
}
const STARS = (() => {
  let seed = 20260812, out = [];
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 260; i++) out.push([rnd(), rnd(), 0.3 + rnd() * 1.05, 0.12 + rnd() * 0.5]);
  return out;
})();
function drawStars() {
  for (const [fx, fy, r, a] of STARS) {
    ctx.beginPath(); ctx.arc(fx * W, fy * H, r, 0, TAU);
    ctx.fillStyle = `rgba(214,226,245,${a})`; ctx.fill();
  }
}
function drawBase() {
  ctx.fillStyle = '#04060C'; ctx.fillRect(0, 0, W, H);
  drawStars();
  if (state.view === 'globe') {
    const R = globeR();
    const g = ctx.createRadialGradient(W / 2 - R * .3, H / 2 - R * .35, R * .1, W / 2, H / 2, R);
    g.addColorStop(0, '#122036'); g.addColorStop(1, '#080E1A');
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, TAU); ctx.clip();
  } else {
    ctx.fillStyle = '#0A1322';
    const k = kFlat();
    ctx.fillRect(0, H / 2 - (90 - cam.lat0) * k, W, 180 * k);
  }
  drawGraticule();
  const offs = lonOffsets();
  ctx.fillStyle = '#182337'; ctx.strokeStyle = '#31425D'; ctx.lineWidth = 0.7;
  for (const off of offs) {
    ctx.beginPath();
    for (const r of LAND) {
      const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
      if (!anyVisible(pts)) continue;
      tracePoly(pts, off, true);
    }
    ctx.fill(); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(94,118,155,.28)'; ctx.lineWidth = 0.6;
  for (const off of offs) {
    ctx.beginPath();
    for (const r of BORDERS) {
      const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
      if (!anyVisible(pts)) continue;
      tracePoly(pts, off, false);
    }
    ctx.stroke();
  }
  if (state.view === 'globe') {
    ctx.restore();
    const R = globeR();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, TAU);
    ctx.strokeStyle = '#33456180'; ctx.lineWidth = 1; ctx.stroke();
  } else {
    const k = kFlat();
    ctx.strokeStyle = '#22304780'; ctx.lineWidth = 1;
    ctx.strokeRect(-1, H / 2 - (90 - cam.lat0) * k, W + 2, 180 * k);
  }
}

/* ---------------- eclipse rendering ---------------- */
function eclipseColor(e) {
  if (state.color === 'type') return TYPES[e.type].color;
  const t = (e.year - state.y0) / Math.max(1, state.y1 - state.y0);
  const h = 260 - 260 * t;                    // violet -> rouge
  return `hsl(${h},72%,${58 + 8 * Math.sin(t * 3)}%)`;
}
function drawBands() {
  const offs = lonOffsets();
  const dim = state.sel !== null || state.probe;
  const order = state.sel && visible.includes(state.sel)
    ? visible.filter(e => e !== state.sel).concat([state.sel]) : visible;
  for (const e of order) {
    if (!e.path) continue;
    const isSel = state.sel === e;
    const col = eclipseColor(e);
    const a = isSel ? 0.55 : (dim ? 0.10 : 0.28);
    for (const off of offs) {
      ctx.beginPath();
      tracePolyBand(e.path.limA, e.path.limB, off);
      ctx.fillStyle = hexA(col, a); ctx.fill();
    }
  }
  for (const e of order) {
    if (!e.path) continue;
    const isSel = state.sel === e;
    ctx.lineWidth = isSel ? 1.6 : 0.8;
    ctx.strokeStyle = hexA(eclipseColor(e), isSel ? 1 : (dim ? 0.22 : 0.65));
    for (const off of offs) { ctx.beginPath(); tracePoly(e.path.center, off, false); ctx.stroke(); }
  }
  // greatest-eclipse markers for non-central events
  for (const e of visible) {
    if (e.path || e.gLat == null) continue;
    for (const off of offs) {
      const [x, y, v] = proj(e.gLon + off, e.gLat); if (!v) continue;
      ctx.beginPath(); ctx.arc(x, y, state.sel === e ? 4 : 2.4, 0, TAU);
      ctx.fillStyle = hexA(eclipseColor(e), state.sel === e ? 1 : .55); ctx.fill();
    }
  }
}
function tracePolyBand(A, B, off) {
  if (state.view !== 'flat') {               // globe: one ring, clipped at the horizon
    traceGlobeFill(A.concat(B.slice().reverse()));
    return;
  }
  // build closed sub-polygons, splitting on dateline jumps (flat view)
  const segs = [];
  let cur = [];
  for (let i = 0; i < A.length; i++) {
    if (state.view === 'flat' && i > 0 &&
      (Math.abs(A[i][0] - A[i - 1][0]) > 180 || Math.abs(B[i][0] - B[i - 1][0]) > 180)) {
      if (cur.length > 1) segs.push(cur); cur = [];
    }
    cur.push(i);
  }
  if (cur.length > 1) segs.push(cur);
  for (const s of segs) {
    let started = false;
    for (const i of s) { const [x, y] = proj(A[i][0] + off, A[i][1]); started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true); }
    for (let j = s.length - 1; j >= 0; j--) { const i = s[j]; const [x, y] = proj(B[i][0] + off, B[i][1]); ctx.lineTo(x, y); }
    ctx.closePath();
  }
}
function hexA(hex, a) {
  if (hex[0] !== '#') return hex.replace('hsl', 'hsla').replace(')', `,${a})`);
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

/* ---------------- animation layer ---------------- */
function drawShadow() {
  const A = state.anim; if (!A || !state.sel) return;
  const e = state.sel, jd = A.jd;
  const b = bessel(jd);
  const subLat = b.d, subLon = -b.mu;
  drawNight(subLat, subLon);
  const offs = lonOffsets();
  // penumbra
  const pen = shadowOutline(jd, 'pen');
  ctx.beginPath();
  for (const off of offs) tracePoly(pen.pts, off, true);
  ctx.fillStyle = 'rgba(6,10,20,.42)'; ctx.fill();
  ctx.strokeStyle = 'rgba(160,190,220,.35)'; ctx.lineWidth = 1; ctx.stroke();
  // umbra
  if (jd >= e.path.jdStart && jd <= e.path.jdEnd) {
    const um = shadowOutline(jd, 'umb');
    ctx.beginPath();
    for (const off of offs) tracePoly(um.pts, off, true);
    ctx.fillStyle = 'rgba(0,0,0,.82)'; ctx.fill();
    ctx.strokeStyle = TYPES[e.type === 'H' ? 'H' : e.type].color; ctx.lineWidth = 1.4; ctx.stroke();
    for (const off of offs) {
      const [x, y, v] = proj(um.center[0] + off, um.center[1]); if (!v) continue;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU);
      ctx.strokeStyle = hexA(TYPES[e.type].color, .35); ctx.lineWidth = 1; ctx.stroke();
    }
  }
  // sub-solar point
  for (const off of offs) {
    const [x, y, v] = proj(subLon + off, subLat); if (!v) continue;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fillStyle = '#FFE4A0'; ctx.fill();
  }
}
function drawNight(subLat, subLon) {
  const pts = [];
  for (let i = 0; i <= 360; i += 2) {
    const az = i * D2R;
    const p0 = subLat * D2R, l0 = subLon * D2R, c = Math.PI / 2;
    const lat = Math.asin(Math.sin(p0) * Math.cos(c) + Math.cos(p0) * Math.sin(c) * Math.cos(az));
    const lon = l0 + Math.atan2(Math.sin(az) * Math.sin(c) * Math.cos(p0),
      Math.cos(c) - Math.sin(p0) * Math.sin(lat));
    pts.push([((lon / D2R + 180) % 360 + 360) % 360 - 180, lat / D2R]);
  }
  ctx.save();
  if (state.view === 'globe') {
    const R = globeR();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, TAU); ctx.clip();
    ctx.fillStyle = 'rgba(1,3,9,.66)';
    // the terminator projects to an ellipse; fill the hemisphere opposite the sub-solar point
    const antiVisible = proj(subLon > 0 ? subLon - 180 : subLon + 180, -subLat)[2];
    ctx.beginPath();
    let st = false;
    for (const p of pts) { const [x, y] = proj(p[0], p[1]); st ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), st = true); }
    ctx.closePath();
    if (antiVisible) ctx.fill();
    else { ctx.arc(W / 2, H / 2, R, 0, TAU); ctx.fill('evenodd'); }
  } else {
    // fill from the terminator curve to the winter pole
    const sorted = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const t = Math.tan(subLat * D2R);
      let lat = Math.atan(-Math.cos((lon - subLon) * D2R) / (t === 0 ? 1e-9 : t)) / D2R;
      sorted.push([lon, lat]);
    }
    const poleLat = subLat >= 0 ? -90 : 90;
    ctx.fillStyle = 'rgba(1,3,9,.66)';
    for (const off of lonOffsets()) {
      ctx.beginPath();
      let st = false;
      for (const p of sorted) { const [x, y] = proj(p[0] + off, p[1]); st ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), st = true); }
      const [xe] = proj(180 + off, poleLat), [xs] = proj(-180 + off, poleLat);
      const [, yp] = proj(0, poleLat);
      ctx.lineTo(xe, yp); ctx.lineTo(xs, yp); ctx.closePath(); ctx.fill();
      ctx.beginPath(); st = false;
      for (const p of sorted) { const [x, y] = proj(p[0] + off, p[1]); st ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), st = true); }
      ctx.strokeStyle = 'rgba(255,228,160,.22)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------------- probe marker ---------------- */
function drawProbe() {
  if (!state.probe) return;
  for (const off of lonOffsets()) {
    const [x, y, v] = proj(state.probe.lon + off, state.probe.lat); if (!v) continue;
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, TAU);
    ctx.strokeStyle = '#79CFEE'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 6.5, y);
    ctx.moveTo(x + 6.5, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 6.5);
    ctx.moveTo(x, y + 6.5); ctx.lineTo(x, y + 10); ctx.stroke();
  }
}
function draw() {
  if (!W) return;
  drawBase();
  drawBands();
  drawShadow();
  drawProbe();
  $('#scaleNote').textContent = state.view === 'flat'
    ? `${(kFlat() / 111.32 * 1000).toFixed(0)} px / 1000 km · zoom ×${cam.zoom.toFixed(1)}`
    : `${L.center} ${fmtLat(cam.glat)} ${fmtLon(cam.glon)}`;
}

/* ---------------- ribbon ---------------- */
function drawRibbon() {
  const c = $('#ribbon'), g = c.getContext('2d');
  const w = c.width / DPR, h = c.height / DPR;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#090E19'; g.fillRect(0, 0, w, h);
  const y0 = state.y0, y1 = state.y1 + 1, sp = y1 - y0;
  const X = y => 14 + (y - y0) / sp * (w - 28);
  // gridlines
  const stepC = sp > 300 ? 100 : sp > 120 ? 50 : sp > 60 ? 20 : sp > 25 ? 10 : 5;
  g.font = '9px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  for (let y = Math.ceil(y0 / stepC) * stepC; y <= y1; y += stepC) {
    const x = X(y);
    g.strokeStyle = '#141D2E'; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 13); g.stroke();
    g.fillStyle = '#4E5C74'; g.fillText(String(y), x, h - 3);
  }
  g.strokeStyle = '#1A2436'; g.beginPath(); g.moveTo(0, h - 13.5); g.lineTo(w, h - 13.5); g.stroke();
  for (const e of visible) {
    const x = X(e.year + 0.5), hh = e.type === 'P' ? 8 : e.type === 'T' ? 26 : 20;
    g.strokeStyle = hexA(eclipseColor(e), state.sel === e ? 1 : .62);
    g.lineWidth = state.sel === e ? 2 : 1;
    g.beginPath(); g.moveTo(x, h - 14); g.lineTo(x, h - 14 - hh); g.stroke();
  }
  if (state.sel) {
    const x = X(state.sel.year + 0.5);
    g.fillStyle = '#79CFEE'; g.beginPath();
    g.moveTo(x, 3); g.lineTo(x - 4, -3); g.lineTo(x + 4, -3); g.closePath(); g.fill();
  }
}

/* ---------------- panels ---------------- */
function renderPane() {
  const p = $('#pane');
  if (state.tab === 'list') return renderList(p);
  if (state.tab === 'detail') return renderDetail(p);
  return renderProbe(p);
}
function renderList(p) {
  if (!visible.length) {
    p.innerHTML = `<div class="empty">${computing ? L.computing : L.noneFilters}</div>`; return;
  }
  const frag = document.createElement('div');
  frag.innerHTML = `<div class="listHead eyebrow" style="margin:0">
      <span>${L.listHead}</span><span>${state.filters.P ? L.durMag : L.durMax}</span></div>` +
    visible.map((e, i) => `
    <div class="row" data-i="${i}" aria-selected="${state.sel === e}">
      <span class="dot" style="background:${eclipseColor(e)}"></span>
      <span class="dt">${fmtDate(e.jd, true)}</span>
      <span class="tp">${e.type}</span>
      <span class="du">${e.dur ? fmtDur(e.dur).replace(' min ', "'").replace(' s', '"') : (e.mag ? e.mag.toFixed(2) : '')}</span>
    </div>`).join('') + `<div class="note" style="padding:14px 18px 24px">${L.methodNote}</div>`;
  p.innerHTML = ''; p.appendChild(frag);
  p.querySelectorAll('.row').forEach(r => r.onclick = () => select(visible[+r.dataset.i], { frame: true }));
  const sel = p.querySelector('[aria-selected=true]');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function renderDetail(p) {
  const e = state.sel;
  if (!e) { p.innerHTML = `<div class="empty">${L.selectPrompt}</div>`; return; }
  const T = TYPES[e.type];
  const path = e.path;
  let rows = `
    <dt>${L.rows.maxUT}</dt><dd>${fmtTime(e.jdut)}</dd>
    <dt>${L.rows.maxTT}</dt><dd>${fmtTime(e.jd)}</dd>
    <dt>${L.rows.dT}</dt><dd>${e.dT.toFixed(1)} s</dd>
    <dt>${L.rows.gamma}</dt><dd>${e.gamma.toFixed(4)}</dd>
    <dt>${L.rows.mag}</dt><dd>${e.mag.toFixed(4)}</dd>`;
  if (path) {
    const gi = path.meta.reduce((b, m, i) => Math.abs(m.jd - e.jd) < Math.abs(path.meta[b].jd - e.jd) ? i : b, 0);
    rows += `
    <dt>${L.rows.maxDur}</dt><dd>${fmtDur(path.maxDur)}</dd>
    <dt>${L.rows.maxDurPlace}</dt><dd>${fmtLat(path.maxDurPt.lat)} ${fmtLon(path.maxDurPt.lon)}</dd>
    <dt>${L.rows.width}</dt><dd>${path.width.toFixed(0)} km</dd>
    <dt>${L.rows.sunAlt}</dt><dd>${path.meta[gi].sunAlt.toFixed(0)}°</dd>
    <dt>${L.rows.pathStart}</dt><dd>${fmtTime(path.jdStart - e.dT / 86400)}</dd>
    <dt>${L.rows.pathEnd}</dt><dd>${fmtTime(path.jdEnd - e.dT / 86400)}</dd>`;
  } else if (e.gLat != null) {
    rows += `<dt>${L.rows.greatestAt}</dt><dd>${fmtLat(e.gLat)} ${fmtLon(e.gLon)}</dd>`;
  }
  const c = calFromJd(e.jd);
  p.innerHTML = `
    <div class="dHead">
      <div class="kind" style="color:${T.color}">${L.kind(T.label)}${e.central === false && e.type !== 'P' ? L.nonCentral : ''}</div>
      <div class="date">${fmtDate(e.jd)}</div>
      <div class="sub">${c.greg ? L.gregorian : L.julian}${path ? ' · ' + L.maxAt + fmtLat(pathCenterAt(e).lat) + ' ' + fmtLon(pathCenterAt(e).lon) : ''}</div>
    </div>
    <dl class="kv">${rows}</dl>
    ${path ? `<div style="padding:0 18px 14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="chip" id="btnAnim">${L.btnAnim}</button>
      <button class="chip" id="btnZoom">${L.btnZoom}</button>
      <button class="chip" id="btnGeo">${L.btnGeo}</button></div>` : ''}
    <div class="note">${L.magNote}</div>`;
  if (path) {
    $('#btnAnim').onclick = () => startAnim(e);
    $('#btnZoom').onclick = () => frameEclipse(e);
    $('#btnGeo').onclick = () => exportGeoJSON(e);
  }
}
function pathCenterAt(e) {
  const p = e.path; let bi = 0, bd = 1e9;
  p.meta.forEach((m, i) => { const v = Math.abs(m.jd - e.jd); if (v < bd) { bd = v; bi = i; } });
  return { lat: p.center[bi][1], lon: p.center[bi][0] };
}
function renderProbe(p) {
  if (!state.probe) {
    p.innerHTML = `<div class="empty">${L.probeEmpty}</div>`;
    return;
  }
  const pr = state.probe;
  const rows = pr.res.map((r, i) => `
    <div class="pr" data-i="${i}">
      <span class="d" style="color:${TYPES[r.e.type].color}">${fmtDate(r.e.jd, true)}</span>
      <span class="d" style="color:var(--dim2)">${fmtTime(r.jdut)}</span>
      <span class="m">${r.type === 'P' ? fmtObsc(r.obsc) + ' %'
        : '<b style="color:' + TYPES[r.type].color + '">' + (r.type === 'T' ? L.probeTotal : L.probeAnnular)
          + fmtDur(r.dur).replace(' min ', "'").replace(' s', '"') + '</b>'}</span>
    </div>`).join('');
  const nT = pr.res.filter(r => r.type !== 'P').length;
  p.innerHTML = `
    <div class="probeHead">
      <div>
        <div class="eyebrow" style="margin:0">${L.probePoint}</div>
        <div style="font-family:var(--mono);font-size:12px;margin-top:3px">${fmtLat(pr.lat)} · ${fmtLon(pr.lon)}</div>
      </div>
      <button class="close" id="pclose" aria-label="${L.probeClear}">✕</button>
    </div>
    <div class="note" style="padding:0 18px 10px">${L.probeSummary(pr.res.length, nT, state.y0, state.y1)}</div>
    ${rows || `<div class="empty">${L.probeNone}</div>`}`;
  $('#pclose').onclick = () => { state.probe = null; renderPane(); draw(); };
  p.querySelectorAll('.pr').forEach(r => r.onclick = () => select(pr.res[+r.dataset.i].e, { frame: true, detail: true }));
}

/* ---------------- actions ---------------- */
function select(e, opt) {
  opt = opt || {};
  state.sel = e;
  if (state.anim && state.anim.e !== e) stopAnim();
  if (opt.frame && e.path) frameEclipse(e);
  if (opt.detail) setTab('detail'); else renderPane();
  draw(); drawRibbon();
}
function frameEclipse(e) {
  if (!e.path) return;
  let minLon = 999, maxLon = -999, minLat = 99, maxLat = -99, prev = null, unwrapped = [];
  for (const p of e.path.center) {
    let lon = p[0];
    if (prev !== null) { while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
    prev = lon; unwrapped.push(lon);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
  }
  const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2;
  if (state.view === 'flat') {
    cam.lon0 = ((cLon + 180) % 360 + 360) % 360 - 180; cam.lat0 = cLat;
    cam.zoom = Math.max(1, Math.min(8, 0.8 * Math.min(360 / Math.max(20, maxLon - minLon), (180 / Math.max(12, maxLat - minLat)) * (W / H) / 2)));
  } else { cam.glon = ((cLon + 180) % 360 + 360) % 360 - 180; cam.glat = cLat; }
  draw();
}
function startAnim(e) {
  const pad = 40 / 1440;
  state.anim = { e, t0: e.path.jdStart - pad, t1: e.path.jdEnd + pad, jd: e.jd, playing: true };
  $('#player').classList.add('on'); $('#play').textContent = '❚❚';
  tickAnim(true);
  requestAnimationFrame(loopAnim);
}
function stopAnim() { state.anim = null; $('#player').classList.remove('on'); draw(); }
let lastT = 0;
function loopAnim(ts) {
  const A = state.anim; if (!A) return;
  if (A.playing) {
    const dt = Math.min(60, ts - lastT); lastT = ts;
    A.jd += (A.t1 - A.t0) * dt / 9000;
    if (A.jd > A.t1) A.jd = A.t0;
    tickAnim();
  }
  requestAnimationFrame(loopAnim);
}
function tickAnim(setSlider) {
  const A = state.anim; if (!A) return;
  const f = (A.jd - A.t0) / (A.t1 - A.t0);
  if (setSlider || A.playing) $('#scrub').value = Math.round(f * 1000);
  const dT = deltaT(yearOf(A.jd)) / 86400;
  $('#clock').textContent = fmtTime(A.jd - dT);
  const e = A.e;
  let info = L.shadowOff;
  if (A.jd >= e.path.jdStart && A.jd <= e.path.jdEnd) {
    let bi = 0, bd = 1e9;
    e.path.meta.forEach((m, i) => { const v = Math.abs(m.jd - A.jd); if (v < bd) { bd = v; bi = i; } });
    const m = e.path.meta[bi], c = e.path.center[bi];
    info = `${fmtDur(m.dur).replace(' min ', "'").replace(' s', '"')} · ${m.w.toFixed(0)} km`;
  }
  $('#umbraInfo').textContent = info;
  draw();
}
function exportGeoJSON(e) {
  const fc = {
    type: 'FeatureCollection',
    properties: { source: 'Umbra', date: fmtDate(e.jd), type: TYPES[e.type].label },
    features: [
      { type: 'Feature', properties: { name: L.geo.center }, geometry: { type: 'LineString', coordinates: e.path.center } },
      { type: 'Feature', properties: { name: L.geo.lim1 }, geometry: { type: 'LineString', coordinates: e.path.limA } },
      { type: 'Feature', properties: { name: L.geo.lim2 }, geometry: { type: 'LineString', coordinates: e.path.limB } }
    ]
  };
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const c = calFromJd(e.jd);
  a.download = `eclipse_${c.y}-${String(c.m).padStart(2, '0')}-${String(Math.floor(c.d)).padStart(2, '0')}.geojson`;
  a.click(); URL.revokeObjectURL(a.href);
}
function probeAt(lon, lat) {
  const res = [];
  for (const e of allInRange) {
    const c = localCircumstances(e, lat, lon);
    if (c) { c.e = e; res.push(c); }
  }
  state.probe = { lat, lon, res };
  setTab('probe'); draw();
}

/* ---------------- interactions ---------------- */
let drag = null;
const pointers = new Map();       // active pointers, for two-finger pinch
let pinch = null;                 // {dist, mx, my} while two fingers are down
function hideHint() { const h = $('#hint'); if (h && !h.classList.contains('gone')) h.classList.add('gone'); }
setTimeout(hideHint, 14000);
function panBy(dx, dy) {
  if (state.view === 'flat') {
    const k = kFlat(); cam.lon0 -= dx / k; cam.lat0 += dy / k;
    cam.lat0 = Math.max(-88, Math.min(88, cam.lat0));
    cam.lon0 = ((cam.lon0 + 180) % 360 + 360) % 360 - 180;
  } else {
    const s = 0.35 / cam.gzoom;
    cam.glon -= dx * s; cam.glat = Math.max(-89, Math.min(89, cam.glat + dy * s));
    cam.glon = ((cam.glon + 180) % 360 + 360) % 360 - 180;
  }
}
function zoomAt(px, py, f) {
  if (state.view === 'flat') {
    const before = unproj(px, py);
    cam.zoom = Math.max(0.7, Math.min(60, cam.zoom * f));
    const after = unproj(px, py);
    if (before && after) {
      cam.lon0 += before[0] - after[0]; cam.lat0 += before[1] - after[1];
      cam.lat0 = Math.max(-88, Math.min(88, cam.lat0));
      cam.lon0 = ((cam.lon0 + 180) % 360 + 360) % 360 - 180;
    }
  } else cam.gzoom = Math.max(0.75, Math.min(14, cam.gzoom * f));
}
cv.addEventListener('pointerdown', ev => {
  hideHint(); $('#tip').style.display = 'none';
  try { cv.setPointerCapture(ev.pointerId); } catch (err) { }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {        // second finger: start pinching, cancel the tap
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    drag = null;
  } else if (pointers.size === 1) {
    drag = { x: ev.clientX, y: ev.clientY, moved: 0, sx: ev.clientX, sy: ev.clientY };
  }
});
cv.addEventListener('pointermove', ev => {
  const r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (pinch.dist > 8 && dist > 8) zoomAt(mx - r.left, my - r.top, dist / pinch.dist);
    panBy(mx - pinch.mx, my - pinch.my);
    pinch = { dist, mx, my };
    draw(); return;
  }
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    panBy(dx, dy);
    drag.x = ev.clientX; drag.y = ev.clientY; draw(); return;
  }
  const ll = unproj(px, py);
  $('#coords').textContent = ll ? `${fmtLat(ll[1])}  ${fmtLon(ll[0])}` : '';
  hoverTest(ll, px, py);
});
function nearestPath(ll) {
  let best = null, bd = 1e9;
  for (const e of visible) {
    if (!e.path) continue;
    for (let i = 0; i < e.path.center.length; i += 2) {
      const p = e.path.center[i];
      let dl = Math.abs(p[0] - ll[0]); if (dl > 180) dl = 360 - dl;
      const d = Math.hypot(dl * Math.cos(ll[1] * D2R), p[1] - ll[1]);
      if (d < bd) { bd = d; best = e; }
    }
  }
  const tol = state.view === 'flat' ? 12 / kFlat() : 900 / globeR();
  return bd < tol ? best : null;
}
function showTip(e, px, py) {
  const tip = $('#tip');
  tip.style.display = 'block';
  tip.innerHTML = `<b style="color:${eclipseColor(e)}">${TYPES[e.type].label}</b><br>
      <span class="t">${fmtDate(e.jd)}</span><br>
      <span class="t">${fmtDur(e.dur)} · ${e.width.toFixed(0)} km</span>`;
  tip.style.left = Math.max(4, Math.min(W - 240, px + 14)) + 'px';
  tip.style.top = Math.max(4, py - 50) + 'px';
}
function hoverTest(ll, px, py) {
  const tip = $('#tip');
  if (!ll) { tip.style.display = 'none'; state.hover = null; return; }
  const best = nearestPath(ll);
  if (best) {
    showTip(best, px, py);
    state.hover = best;
  } else { tip.style.display = 'none'; state.hover = null; }
}
let tipTimer = null;
cv.addEventListener('pointerup', ev => {
  pointers.delete(ev.pointerId);
  if (pinch) {                      // pinch ends: no tap; the last finger resumes panning
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      drag = { x: p.x, y: p.y, moved: 999, sx: p.x, sy: p.y };
    }
    if (pointers.size < 2) pinch = null;
    return;
  }
  const wasDrag = drag && drag.moved > 6;
  drag = null;
  if (wasDrag) return;
  const r = cv.getBoundingClientRect();
  const ll = unproj(ev.clientX - r.left, ev.clientY - r.top);
  if (!ll) return;
  const hit = nearestPath(ll);
  if (hit) {
    select(hit, { detail: true });
    if (ev.pointerType !== 'mouse') {     // no hover on touch: show the tooltip on tap
      showTip(hit, ev.clientX - r.left, ev.clientY - r.top);
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { $('#tip').style.display = 'none'; }, 4000);
    }
  } else probeAt(ll[0], ll[1]);
});
cv.addEventListener('pointercancel', ev => {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  drag = null;
});
cv.addEventListener('pointerleave', () => { $('#tip').style.display = 'none'; $('#coords').textContent = ''; });
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0016));
  draw();
}, { passive: false });

$('#zin').onclick = () => { if (state.view === 'flat') cam.zoom = Math.min(60, cam.zoom * 1.5); else cam.gzoom = Math.min(14, cam.gzoom * 1.4); draw(); };
$('#zout').onclick = () => { if (state.view === 'flat') cam.zoom = Math.max(0.7, cam.zoom / 1.5); else cam.gzoom = Math.max(0.75, cam.gzoom / 1.4); draw(); };
$('#zreset').onclick = () => { cam.zoom = fitZoom(); cam.lon0 = 0; cam.lat0 = 0; cam.gzoom = 1; draw(); };
document.querySelectorAll('#viewBtns button').forEach(b => b.onclick = () => {
  if (state.view === b.dataset.v) return;
  state.view = b.dataset.v;
  document.querySelectorAll('#viewBtns button').forEach(x => x.setAttribute('aria-pressed', x === b));
  if (state.sel && state.sel.path) frameEclipse(state.sel);
  else if (state.probe) { cam.glon = state.probe.lon; cam.glat = state.probe.lat; }
  draw();
});
$('#play').onclick = () => {
  const A = state.anim; if (!A) return;
  A.playing = !A.playing; lastT = performance.now();
  $('#play').textContent = A.playing ? '❚❚' : '▶';
};
$('#scrub').oninput = ev => {
  const A = state.anim; if (!A) return;
  A.playing = false; $('#play').textContent = '▶';
  A.jd = A.t0 + (A.t1 - A.t0) * (+ev.target.value / 1000);
  tickAnim();
};
$('#closePlayer').onclick = stopAnim;

/* ribbon interaction */
$('#ribbon').addEventListener('click', ev => {
  const r = ev.currentTarget.getBoundingClientRect();
  const w = r.width, x = ev.clientX - r.left;
  const y = state.y0 + (x - 14) / (w - 28) * (state.y1 + 1 - state.y0);
  let best = null, bd = 1e9;
  for (const e of visible) { const d = Math.abs(e.year + 0.5 - y); if (d < bd) { bd = d; best = e; } }
  if (best) select(best, { frame: true, detail: true });
});

/* ---------------- controls ---------------- */
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === t));
  renderPane();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
document.querySelectorAll('#colorSeg button').forEach(b => b.onclick = () => {
  state.color = b.dataset.c;
  document.querySelectorAll('#colorSeg button').forEach(x => x.setAttribute('aria-pressed', x === b));
  draw(); drawRibbon(); renderPane(); buildLegend();
});
function buildFilters() {
  $('#filters').innerHTML = Object.entries(TYPES).map(([k, v]) => `
    <label class="filt ${state.filters[k] ? 'on' : ''}" data-t="${k}" style="color:${state.filters[k] ? '' : ''}">
      <input type="checkbox" ${state.filters[k] ? 'checked' : ''} style="color:${v.color}">
      <span class="sw" style="background:${v.color}"></span>${v.label}<b>0</b>
    </label>`).join('');
  $('#filters').querySelectorAll('.filt').forEach(l => {
    l.querySelector('input').onchange = ev => {
      state.filters[l.dataset.t] = ev.target.checked;
      l.classList.toggle('on', ev.target.checked);
      collect(); draw(); renderPane();
    };
  });
}
function buildLegend() {
  if (state.color === 'type') {
    $('#legend').innerHTML = Object.entries(TYPES).map(([k, v]) =>
      `<div><i style="background:${v.color}"></i>${v.label}</div>`).join('');
  } else {
    $('#legend').innerHTML = `<div style="gap:6px">
      <span>${state.y0}</span>
      <i style="width:96px;height:7px;border-radius:3px;background:linear-gradient(90deg,hsl(260,72%,58%),hsl(195,72%,58%),hsl(130,72%,58%),hsl(60,72%,58%),hsl(0,72%,58%))"></i>
      <span>${state.y1}</span></div>`;
  }
}
/* dual slider */
const slider = $('#slider');
/* the ruler is deliberately non-linear: it dilates the years around the present */
const BP = [[-1999, 0], [1000, .09], [1600, .17], [1800, .24], [1900, .32], [2000, .44],
[2050, .58], [2100, .70], [2200, .80], [2500, .91], [3000, 1]];
function sx(y) {
  if (y <= BP[0][0]) return 0;
  for (let i = 1; i < BP.length; i++) {
    if (y <= BP[i][0]) {
      const [a, fa] = BP[i - 1], [b, fb] = BP[i];
      return fa + (y - a) / (b - a) * (fb - fa);
    }
  }
  return 1;
}
function sxInv(f) {
  f = Math.max(0, Math.min(1, f));
  for (let i = 1; i < BP.length; i++) {
    if (f <= BP[i][1]) {
      const [a, fa] = BP[i - 1], [b, fb] = BP[i];
      return Math.round(a + (f - fa) / (fb - fa) * (b - a));
    }
  }
  return BP[BP.length - 1][0];
}
function syncSlider() {
  const w = slider.clientWidth;
  const a = Math.max(0, Math.min(1, sx(state.y0))), b = Math.max(0, Math.min(1, sx(state.y1)));
  $('#k0').style.left = a * w + 'px'; $('#k1').style.left = b * w + 'px';
  $('#sfill').style.left = a * w + 'px'; $('#sfill').style.width = (b - a) * w + 'px';
  $('#y0').value = state.y0; $('#y1').value = state.y1;
  $('#spanInfo').textContent = (state.y1 - state.y0 + 1) + ' ' + L.yearsWord;
  buildLegend();
}
function knobDrag(el, which) {
  const move = ev => {
    const r = slider.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    let y = sxInv(f);
    if (which === 0) state.y0 = Math.min(y, state.y1 - 1); else state.y1 = Math.max(y, state.y0 + 1);
    clampSpan(which);
    syncSlider(); scheduleRange();
  };
  el.addEventListener('pointerdown', ev => {
    el.setPointerCapture(ev.pointerId);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    move(ev);
  });
  el.addEventListener('keydown', ev => {
    const d = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : ev.key === 'PageUp' ? 10 : ev.key === 'PageDown' ? -10 : 0;
    if (!d) return; ev.preventDefault();
    if (which === 0) state.y0 = Math.min(state.y1 - 1, state.y0 + d); else state.y1 = Math.max(state.y0 + 1, state.y1 + d);
    clampSpan(which); syncSlider(); scheduleRange();
  });
}
function clampSpan(which) {
  state.y0 = Math.max(HARD[0], state.y0); state.y1 = Math.min(HARD[1], state.y1);
  if (state.y1 - state.y0 > MAXSPAN) {
    if (which === 0) state.y1 = state.y0 + MAXSPAN; else state.y0 = state.y1 - MAXSPAN;
  }
}
knobDrag($('#k0'), 0); knobDrag($('#k1'), 1);
let rangeTimer = null;
function scheduleRange() {
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => { requestRange(); renderPane(); }, 260);
}
[['#y0', 0], ['#y1', 1]].forEach(([sel, w]) => {
  $(sel).addEventListener('change', ev => {
    const v = parseInt(ev.target.value, 10);
    if (isNaN(v)) { syncSlider(); return; }
    if (w === 0) state.y0 = Math.min(v, state.y1 - 1); else state.y1 = Math.max(v, state.y0 + 1);
    clampSpan(w); syncSlider(); requestRange(); renderPane();
  });
});
function buildPresets() {
  $('#presets').innerHTML = L.presets.map((p, i) => `<button class="chip" data-i="${i}">${p[0]}</button>`).join('');
  $('#presets').querySelectorAll('button').forEach(b => b.onclick = () => {
    const p = L.presets[+b.dataset.i];
    state.y0 = p[1]; state.y1 = p[2]; syncSlider(); requestRange(); renderPane();
  });
}
$('#sticks').innerHTML = [-1999, 1800, 2000, 2200, 3000]
  .map(y => `<span style="left:${(sx(y) * 100).toFixed(2)}%">${y < 0 ? '\u22122000' : y}</span>`).join('');

/* ---------------- language ---------------- */
function setLang(l) {
  lang = l; L = I18N[l];
  try { localStorage.setItem('umbra-lang', l); } catch (e) { }
  document.documentElement.lang = l;
  document.title = L.title;
  for (const k in TYPES) TYPES[k].label = L.types[k];
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = L.ui[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', L.ui[el.dataset.i18nAria]));
  document.querySelectorAll('[data-i18n-title]').forEach(el => el.setAttribute('title', L.ui[el.dataset.i18nTitle]));
  document.querySelectorAll('#langSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === l));
  buildFilters(); buildPresets(); syncSlider(); collect(); renderPane(); buildLegend(); draw();
}
document.querySelectorAll('#langSeg button').forEach(b =>
  b.onclick = () => { if (b.dataset.l !== lang) setLang(b.dataset.l); });

/* ---------------- boot ---------------- */
window.addEventListener('resize', () => { resize(); syncSlider(); });
document.querySelectorAll('#viewBtns button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.view));
setLang(lang); resize(); cam.zoom = fitZoom(); draw(); requestRange(); setTab('list');
