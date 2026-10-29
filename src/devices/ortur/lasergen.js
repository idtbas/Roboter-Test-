import { Planner } from '../../core/planner.js';

// ---------------------------------------------------------------------------
// Laser job generation (LightBurn-like): vector lines, scanline fill,
// dithered/greyscale image engraving. Machine coordinates in mm, Y up.
// ---------------------------------------------------------------------------

export const FONTS = ['Arial', 'Georgia', 'Courier New', 'Impact', 'Trebuchet MS', 'Times New Roman', 'Brush Script MT', 'Comic Sans MS'];

// ---------------------------------------------------------------- shapes
// Returns a Path2D-drawing function in local unit space [0..1]x[0..1] (y up)
function shapePolys(o) {
  const N = 160;
  if (o.type === 'rect') {
    const r = Math.min(o.radius || 0, Math.min(o.w, o.h) / 2);
    if (r <= 0) return [[[0, 0], [1, 0], [1, 1], [0, 1]]];
    const pts = [];
    const rx = r / o.w;
    const ry = r / o.h;
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 8; i++) {
        const a = a0 + (i / 8) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
    };
    corner(1 - rx, ry, -Math.PI / 2);
    corner(1 - rx, 1 - ry, 0);
    corner(rx, 1 - ry, Math.PI / 2);
    corner(rx, ry, Math.PI);
    return [pts];
  }
  if (o.type === 'ellipse') {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push([0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]);
    }
    return [pts];
  }
  if (o.type === 'star') {
    const pts = [];
    const n = o.points || 5;
    for (let i = 0; i < n * 2; i++) {
      const a = Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? 0.2 : 0.5;
      pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
    }
    return [pts];
  }
  if (o.type === 'heart') {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([0.5 + x / 34, 0.55 + y / 34]);
    }
    return [pts];
  }
  if (o.type === 'svg' && o.polys) return o.polys;
  return null;
}

// polylines in machine mm for vector output
export function objectOutlines(o) {
  if (o.type === 'text' || o.type === 'image') {
    if (o.type === 'image') return [[[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]]];
    const m = renderMask(o, 10);
    const loops = traceMask(m.data, m.W, m.H, 0.5);
    return loops.map((l) => simplify(l.map(([px, py]) => [o.x + px / m.ppx, o.y + (m.H - py) / m.ppy]), 0.03));
  }
  const polys = shapePolys(o) || [];
  return polys.map((p) => p.map(([u, v]) => [o.x + u * o.w, o.y + v * o.h]));
}

// Draw object (filled) into a canvas context; ctx in pixel space with y down.
export function drawObjectFill(ctx, o, toPx) {
  if (o.type === 'text') {
    const hPx = Math.abs(toPx(0, o.h)[1] - toPx(0, 0)[1]);
    const [x0, y0] = toPx(o.x, o.y);
    ctx.save();
    ctx.font = textFont(o, 100);
    const m = ctx.measureText(o.text || ' ');
    const asc = m.actualBoundingBoxAscent || 72;
    const desc = m.actualBoundingBoxDescent || 0;
    const totalH = asc + desc;
    const wPx = Math.abs(toPx(o.w, 0)[0] - toPx(0, 0)[0]);
    ctx.translate(x0, y0);
    ctx.scale(wPx / Math.max(1, m.width), hPx / Math.max(1, totalH));
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(o.text || ' ', -(m.actualBoundingBoxLeft || 0) * 0, -desc);
    ctx.restore();
    return;
  }
  if (o.type === 'image') {
    const [x0, y0] = toPx(o.x, o.y + o.h);
    const [x1, y1] = toPx(o.x + o.w, o.y);
    ctx.drawImage(o.img, x0, y0, x1 - x0, y1 - y0);
    return;
  }
  const polys = shapePolys(o) || [];
  ctx.beginPath();
  for (const p of polys) {
    p.forEach(([u, v], i) => {
      const [x, y] = toPx(o.x + u * o.w, o.y + v * o.h);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');
}

export function textFont(o, px) {
  return `${o.bold ? '700' : '400'} ${px}px "${o.font || 'Arial'}", Arial, sans-serif`;
}

// measure natural width/height ratio of a text object
export function textAspect(o) {
  const c = textAspect.canvas || (textAspect.canvas = document.createElement('canvas'));
  const ctx = c.getContext('2d');
  ctx.font = textFont(o, 100);
  const m = ctx.measureText(o.text || ' ');
  const hh = (m.actualBoundingBoxAscent || 72) + (m.actualBoundingBoxDescent || 0);
  return Math.max(0.05, m.width / Math.max(1, hh));
}

// Rasterise an object into a mask (1 = laser on) at ppmm pixels per mm.
// Row 0 = top (max Y).
export function renderMask(o, ppx = 10, ppy = ppx) {
  const W = Math.max(1, Math.ceil(o.w * ppx));
  const H = Math.max(1, Math.ceil(o.h * ppy));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  const toPx = (x, y) => [(x - o.x) * ppx, H - (y - o.y) * ppy];
  drawObjectFill(ctx, o, toPx);
  const img = ctx.getImageData(0, 0, W, H).data;
  const data = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) data[i] = img[i * 4] / 255;
  return { data, W, H, ppx, ppy };
}

// ---------------------------------------------------------------- tracing
function traceMask(data, W, H, iso) {
  const segs = [];
  const v = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[y * W + x]);
  const lerp = (a, b) => (iso - a) / (b - a);
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const a = v(x, y);
      const b = v(x + 1, y);
      const c = v(x + 1, y + 1);
      const d = v(x, y + 1);
      let idx = 0;
      if (a > iso) idx |= 8;
      if (b > iso) idx |= 4;
      if (c > iso) idx |= 2;
      if (d > iso) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const top = () => [x + 0.5 + lerp(a, b), y + 0.5];
      const right = () => [x + 1.5, y + 0.5 + lerp(b, c)];
      const bottom = () => [x + 0.5 + lerp(d, c), y + 1.5];
      const left = () => [x + 0.5, y + 0.5 + lerp(a, d)];
      switch (idx) {
        case 1: segs.push([left(), bottom()]); break;
        case 2: segs.push([bottom(), right()]); break;
        case 3: segs.push([left(), right()]); break;
        case 4: segs.push([right(), top()]); break;
        case 5: segs.push([left(), top()], [right(), bottom()]); break;
        case 6: segs.push([bottom(), top()]); break;
        case 7: segs.push([left(), top()]); break;
        case 8: segs.push([top(), left()]); break;
        case 9: segs.push([top(), bottom()]); break;
        case 10: segs.push([top(), right()], [bottom(), left()]); break;
        case 11: segs.push([top(), right()]); break;
        case 12: segs.push([right(), left()]); break;
        case 13: segs.push([right(), bottom()]); break;
        case 14: segs.push([bottom(), left()]); break;
        default: break;
      }
    }
  }
  // chain segments
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const byStart = new Map();
  segs.forEach((s, i) => {
    const k = key(s[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(i);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    let end = segs[i][1];
    for (let g = 0; g < segs.length; g++) {
      const c = byStart.get(key(end));
      let n = -1;
      if (c) for (const j of c) if (!used[j]) { n = j; break; }
      if (n < 0) break;
      used[n] = 1;
      end = segs[n][1];
      loop.push(end);
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------- images
export function toGray(img, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = d[i * 4 + 3] / 255;
    const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    g[i] = 1 - (l * a + (1 - a)); // darkness 0..1
  }
  return g;
}

export function dither(g, W, H, mode) {
  const out = new Float32Array(W * H);
  if (mode === 'gray') {
    for (let i = 0; i < W * H; i++) out[i] = g[i];
    return out;
  }
  if (mode === 'threshold') {
    for (let i = 0; i < W * H; i++) out[i] = g[i] > 0.5 ? 1 : 0;
    return out;
  }
  const buf = Float32Array.from(g);
  const kern =
    mode === 'jarvis'
      ? [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]]
      : [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]];
  const div = mode === 'jarvis' ? 48 : 16;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = buf[i];
      const q = v > 0.5 ? 1 : 0;
      out[i] = q;
      const err = v - q;
      for (const [dx, dy, w] of kern) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= W || yy >= H) continue;
        buf[yy * W + xx] += (err * w) / div;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- G-code
export function generateJob(objects, opts = {}) {
  const sMax = opts.sMax || 1000;
  const lines = [];
  const preview = []; // [x0,y0,x1,y1,power01] for software preview
  const out = (l) => lines.push(l);
  let curX = 0;
  let curY = 0;
  let laserMode = null;
  const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
  out('; LaserWerk 2.4 - GRBL device profile, absolute coords');
  const bb = boundsOf(objects);
  if (bb) out(`; Bounds: X${fmt(bb.x0)} Y${fmt(bb.y0)} to X${fmt(bb.x1)} Y${fmt(bb.y1)}`);
  out('G00 G17 G40 G21 G54');
  out('G90');
  const setMode = (m) => {
    if (m !== laserMode) {
      out(m);
      laserMode = m;
    }
  };
  const travel = (x, y) => {
    out(`G0 X${fmt(x)} Y${fmt(y)}`);
    curX = x;
    curY = y;
  };
  const burnTo = (x, y, s, f) => {
    out(`G1 X${fmt(x)} Y${fmt(y)} S${Math.round(s)}${f ? ` F${Math.round(f)}` : ''}`);
    preview.push([curX, curY, x, y, s / sMax]);
    curX = x;
    curY = y;
  };
  // order: image -> fill -> line -> cut (engrave before cutting the part loose)
  const order = { image: 0, fill: 1, line: 2, cut: 3 };
  const sorted = objects.slice().sort((a, b) => order[a.mode] - order[b.mode]);
  for (const o of sorted) {
    const passes = Math.max(1, o.passes || 1);
    const power = (Math.max(0, Math.min(100, o.power)) / 100) * sMax;
    const speed = o.speed;
    out(`; ${o.name || o.type} (${o.mode}) @ ${speed} mm/min, ${o.power}% power, ${passes} pass(es)`);
    if (o.air) out('M8');
    for (let pass = 0; pass < passes; pass++) {
      if (o.mode === 'line' || o.mode === 'cut') {
        setMode('M4');
        let polys = objectOutlines(o);
        polys = orderPolys(polys, curX, curY);
        for (const p of polys) {
          if (p.length < 2) continue;
          travel(p[0][0], p[0][1]);
          let first = true;
          for (let i = 1; i < p.length; i++) {
            burnTo(p[i][0], p[i][1], power, first ? speed : 0);
            first = false;
          }
          burnTo(p[0][0], p[0][1], power, 0);
        }
      } else if (o.mode === 'fill') {
        setMode('M4');
        const interval = o.interval || 0.1;
        const m = renderMask(o, 10, 1 / interval);
        const over = o.overscan ?? 2.5;
        let dir = 1;
        let firstF = true;
        for (let r = m.H - 1; r >= 0; r--) {
          const y = o.y + (m.H - 1 - r + 0.5) * interval;
          const runs = [];
          let start = -1;
          for (let c = 0; c <= m.W; c++) {
            const on = c < m.W && m.data[r * m.W + c] > 0.5;
            if (on && start < 0) start = c;
            if (!on && start >= 0) {
              runs.push([start, c]);
              start = -1;
            }
          }
          if (!runs.length) continue;
          if (dir < 0) runs.reverse();
          const xs = (c) => o.x + c / m.ppx;
          const first = runs[0];
          const sx = dir > 0 ? xs(first[0]) : xs(first[1]);
          travel(sx - dir * over, y);
          burnTo(sx, y, 0, firstF ? speed : 0);
          firstF = false;
          for (let k = 0; k < runs.length; k++) {
            const [a, b] = runs[k];
            const xa = dir > 0 ? xs(a) : xs(b);
            const xb = dir > 0 ? xs(b) : xs(a);
            if (Math.abs(xa - curX) > 1e-6) burnTo(xa, y, 0, 0);
            burnTo(xb, y, power, 0);
          }
          burnTo(curX + dir * over, y, 0, 0);
          dir = -dir;
        }
      } else if (o.mode === 'image') {
        setMode('M4');
        const interval = o.interval || 0.1;
        const W = Math.max(1, Math.round(o.w / interval));
        const Hh = Math.max(1, Math.round(o.h / interval));
        const g = toGray(o.img, W, Hh);
        if (o.invert) for (let i = 0; i < g.length; i++) g[i] = 1 - g[i];
        const d = dither(g, W, Hh, o.dither || 'jarvis');
        const minP = (o.minPower || 0) / 100;
        const over = o.overscan ?? 2.5;
        let dir = 1;
        let firstF = true;
        for (let r = Hh - 1; r >= 0; r--) {
          const y = o.y + (Hh - 1 - r + 0.5) * interval;
          // find extent of non-zero pixels
          let c0 = -1;
          let c1 = -1;
          for (let c = 0; c < W; c++) {
            if (d[r * W + c] > 0.02) {
              if (c0 < 0) c0 = c;
              c1 = c;
            }
          }
          if (c0 < 0) continue;
          const xs = (c) => o.x + c * interval;
          const startX = dir > 0 ? xs(c0) : xs(c1 + 1);
          travel(startX - dir * over, y);
          burnTo(startX, y, 0, firstF ? speed : 0);
          firstF = false;
          let c = dir > 0 ? c0 : c1;
          const end = dir > 0 ? c1 + 1 : c0 - 1;
          while (c !== end) {
            const v = d[r * W + c];
            const s = v > 0.02 ? (minP + (1 - minP) * v) * power : 0;
            let c2 = c;
            while (c2 + dir !== end && Math.abs(d[r * W + c2 + dir] - v) < 0.02) c2 += dir;
            const xEnd = dir > 0 ? xs(c2 + 1) : xs(c2);
            burnTo(xEnd, y, s, 0);
            c = c2 + dir;
          }
          burnTo(curX + dir * over, y, 0, 0);
          dir = -dir;
        }
      }
    }
    if (o.air) out('M9');
  }
  out('G1 S0');
  out('M5');
  out('G90');
  out('; return to origin');
  out('G0 X0 Y0');
  out('M2');
  return { lines, preview, bounds: bb };
}

function orderPolys(polys, x, y) {
  // inner (smaller) loops first, nearest neighbour inside each size class
  const rem = polys.map((p) => ({ p, area: Math.abs(polyArea(p)) }));
  rem.sort((a, b) => a.area - b.area);
  const out = [];
  let cx = x;
  let cy = y;
  while (rem.length) {
    // choose among the smallest third the nearest
    const n = Math.max(1, Math.ceil(rem.length / 3));
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const p0 = rem[i].p[0];
      const d = Math.hypot(p0[0] - cx, p0[1] - cy);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const it = rem.splice(bi, 1)[0];
    out.push(it.p);
    cx = it.p[0][0];
    cy = it.p[0][1];
  }
  return out;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function boundsOf(objs) {
  if (!objs.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of objs) {
    x0 = Math.min(x0, o.x);
    y0 = Math.min(y0, o.y);
    x1 = Math.max(x1, o.x + o.w);
    y1 = Math.max(y1, o.y + o.h);
  }
  return { x0, y0, x1, y1 };
}

// Rough job time estimation with the GRBL planner model
export function estimateTime(lines, settings) {
  const p = new Planner({ axes: 3, maxFeed: [settings[110] / 60, settings[111] / 60, 10], maxAccel: [settings[120], settings[121], 100], accel: Math.min(settings[120], settings[121]), travelAccel: Math.min(settings[120], settings[121]), jd: settings[11], maxBlocks: 1e9 });
  let feed = 1000 / 60;
  let x = 0;
  let y = 0;
  const re = /([XYFG])(-?[\d.]+)/g;
  for (const l of lines) {
    if (l[0] !== 'G') continue;
    let m;
    let g = null;
    let nx = x;
    let ny = y;
    re.lastIndex = 0;
    while ((m = re.exec(l))) {
      const v = parseFloat(m[2]);
      if (m[1] === 'G' && g === null) g = v;
      else if (m[1] === 'X') nx = v;
      else if (m[1] === 'Y') ny = v;
      else if (m[1] === 'F') feed = v / 60;
    }
    if (g !== 0 && g !== 1) continue;
    if (nx === x && ny === y) continue;
    p.addMove([nx, ny, 0], g === 0 ? settings[110] / 60 : feed, {});
    x = nx;
    y = ny;
    while (p.length > 24) {
      if (!p.cur) p.startBlock();
      p.update(p.cur.duration - p.cur.t + 1e-9);
    }
  }
  p.update(1e9);
  return p.totalTime;
}

// Procedural sample image (mandala) for the demo project
export function sampleMandala(size = 600) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  const R = size * 0.48;
  const grd = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
  grd.addColorStop(0, '#222');
  grd.addColorStop(1, '#bbb');
  for (let ring = 0; ring < 5; ring++) {
    const n = 8 + ring * 4;
    const r0 = R * (0.15 + ring * 0.17);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.rotate((i / n) * Math.PI * 2 + ring * 0.2);
      ctx.beginPath();
      ctx.ellipse(r0, 0, R * 0.08, R * 0.035 + ring * 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20,20,20,${0.95 - ring * 0.13})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r0 + R * 0.09, 0, Math.PI * 2);
    ctx.lineWidth = size * 0.006;
    ctx.strokeStyle = '#333';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  return c;
}
