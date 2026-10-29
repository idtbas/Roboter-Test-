import ClipperLib from 'clipper-lib';
import { Planner } from '../core/planner.js';

// ---------------------------------------------------------------------------
// Compact FDM slicer producing PrusaSlicer-style G-code for the MK4S.
// Mesh in printer coordinates (mm, Z up, already placed on the bed).
// ---------------------------------------------------------------------------

const S = 1000; // clipper scale: 1 unit = 1 µm
const FIL_AREA = Math.PI * 0.875 * 0.875;

export const PROFILES = {
  '0.10mm DETAIL': { layer: 0.1, first: 0.2, top: 9, bottom: 7, speedMul: 0.8 },
  '0.15mm QUALITY': { layer: 0.15, first: 0.2, top: 7, bottom: 5, speedMul: 0.9 },
  '0.20mm SPEED': { layer: 0.2, first: 0.2, top: 5, bottom: 4, speedMul: 1 },
  '0.30mm DRAFT': { layer: 0.3, first: 0.3, top: 4, bottom: 3, speedMul: 1.05 }
};

export const FILAMENTS = {
  PLA: { nozzle: 215, first: 215, bed: 60, density: 1.24, fanFull: 3 },
  PETG: { nozzle: 240, first: 230, bed: 85, density: 1.27, fanFull: 4 },
  ASA: { nozzle: 260, first: 260, bed: 105, density: 1.07, fanFull: 99 },
  ABS: { nozzle: 255, first: 255, bed: 100, density: 1.04, fanFull: 99 },
  FLEX: { nozzle: 240, first: 240, bed: 50, density: 1.21, fanFull: 4 }
};

export function defaultSettings() {
  return {
    profile: '0.20mm SPEED',
    perimeters: 2,
    infill: 0.15,
    material: 'PLA',
    vase: false,
    width: 0.45,
    brim: 0
  };
}

// ---------------------------------------------------------------- geometry
function sliceTriangles(pos, layers) {
  const nTri = pos.length / 9;
  const zmin = new Float32Array(nTri);
  const zmax = new Float32Array(nTri);
  const order = new Uint32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const z0 = pos[t * 9 + 2];
    const z1 = pos[t * 9 + 5];
    const z2 = pos[t * 9 + 8];
    zmin[t] = Math.min(z0, z1, z2);
    zmax[t] = Math.max(z0, z1, z2);
    order[t] = t;
  }
  order.sort((a, b) => zmin[a] - zmin[b]);
  let ptr = 0;
  let active = [];
  const out = [];
  const P = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  for (const L of layers) {
    const zs = L.zs;
    while (ptr < nTri && zmin[order[ptr]] <= zs) active.push(order[ptr++]);
    active = active.filter((t) => zmax[t] >= zs);
    const segs = [];
    for (const t of active) {
      for (let k = 0; k < 3; k++) {
        P[k][0] = pos[t * 9 + k * 3];
        P[k][1] = pos[t * 9 + k * 3 + 1];
        P[k][2] = pos[t * 9 + k * 3 + 2];
      }
      const d = [P[0][2] - zs, P[1][2] - zs, P[2][2] - zs];
      for (let k = 0; k < 3; k++) if (d[k] === 0) d[k] = 1e-7;
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const a = k;
        const b = (k + 1) % 3;
        if (d[a] > 0 === d[b] > 0) continue;
        // canonical order so neighbouring triangles compute identical points
        let A = P[a];
        let B = P[b];
        let dA = d[a];
        let dB = d[b];
        if (A[0] > B[0] || (A[0] === B[0] && (A[1] > B[1] || (A[1] === B[1] && A[2] > B[2])))) {
          [A, B] = [B, A];
          [dA, dB] = [dB, dA];
        }
        const f = dA / (dA - dB);
        pts.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]);
      }
      if (pts.length !== 2) continue;
      // orientation from triangle normal: direction = up x n
      const ux = P[1][0] - P[0][0];
      const uy = P[1][1] - P[0][1];
      const uz = P[1][2] - P[0][2];
      const vx = P[2][0] - P[0][0];
      const vy = P[2][1] - P[0][1];
      const vz = P[2][2] - P[0][2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      // up x n = (-ny, nx, 0)
      const dx = pts[1][0] - pts[0][0];
      const dy = pts[1][1] - pts[0][1];
      if (dx * -ny + dy * nx < 0) pts.reverse();
      segs.push(pts);
    }
    out.push(chainSegments(segs));
  }
  return out;
}

function key(p) {
  return `${Math.round(p[0] * 2e4)},${Math.round(p[1] * 2e4)}`;
}

function chainSegments(segs) {
  const byStart = new Map();
  segs.forEach((s, i) => {
    const k = key(s[0]);
    let a = byStart.get(k);
    if (!a) byStart.set(k, (a = []));
    a.push(i);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0], segs[i][1]];
    let end = segs[i][1];
    for (let guard = 0; guard < segs.length; guard++) {
      const cands = byStart.get(key(end));
      let next = -1;
      if (cands) for (const c of cands) if (!used[c]) {
        next = c;
        break;
      }
      if (next < 0) break;
      used[next] = 1;
      end = segs[next][1];
      loop.push(end);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ---------------------------------------------------------------- clipper
const C = ClipperLib;

function toPath(loop) {
  return loop.map((p) => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
}

function union(paths, fill = C.PolyFillType.pftNonZero) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const sol = new C.Paths();
  c.Execute(C.ClipType.ctUnion, sol, fill, fill);
  return sol;
}

function boolOp(type, a, b) {
  const c = new C.Clipper();
  c.AddPaths(a, C.PolyType.ptSubject, true);
  c.AddPaths(b, C.PolyType.ptClip, true);
  const sol = new C.Paths();
  c.Execute(type, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return sol;
}

const intersect = (a, b) => boolOp(C.ClipType.ctIntersection, a, b);
const difference = (a, b) => boolOp(C.ClipType.ctDifference, a, b);

function offset(paths, delta, join = C.JoinType.jtMiter) {
  if (!paths.length) return [];
  const co = new C.ClipperOffset(2.5, 0.01 * S);
  co.AddPaths(paths, join, C.EndType.etClosedPolygon);
  const sol = new C.Paths();
  co.Execute(sol, delta * S);
  return sol;
}

function toExPolygons(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return C.JS.PolyTreeToExPolygons(tree).map((e) => [e.outer, ...e.holes]);
}

function areaMm2(paths) {
  let a = 0;
  for (const p of paths) a += C.Clipper.Area(p);
  return a / (S * S);
}

function clipLines(lines, region) {
  if (!lines.length || !region.length) return [];
  const c = new C.Clipper();
  c.AddPaths(lines, C.PolyType.ptSubject, false);
  c.AddPaths(region, C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctIntersection, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return C.Clipper.OpenPathsFromPolyTree(tree);
}

// rectilinear lines over region at angle (rad) with spacing (mm)
function hatch(region, angle, spacing, phase = 0) {
  if (!region.length) return [];
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // bounds in rotated frame
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const path of region) {
    for (const p of path) {
      const x = p.X / S;
      const y = p.Y / S;
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const lines = [];
  const k0 = Math.floor((minV - phase) / spacing);
  const k1 = Math.ceil((maxV - phase) / spacing);
  for (let k = k0; k <= k1; k++) {
    const v = phase + k * spacing;
    const u0 = minU - 1;
    const u1 = maxU + 1;
    lines.push([
      { X: Math.round((u0 * ca - v * sa) * S), Y: Math.round((u0 * sa + v * ca) * S) },
      { X: Math.round((u1 * ca - v * sa) * S), Y: Math.round((u1 * sa + v * ca) * S) }
    ]);
  }
  const clipped = clipLines(lines, region);
  // sort by line index (v) then along u, for serpentine ordering
  const items = clipped
    .filter((l) => l.length >= 2)
    .map((l) => {
      const a = l[0];
      const b = l[l.length - 1];
      const ax = a.X / S;
      const ay = a.Y / S;
      const bx = b.X / S;
      const by = b.Y / S;
      const v = -((ax + bx) / 2) * sa + ((ay + by) / 2) * ca;
      const ua = ax * ca + ay * sa;
      const ub = bx * ca + by * sa;
      const p0 = ua <= ub ? [ax, ay] : [bx, by];
      const p1 = ua <= ub ? [bx, by] : [ax, ay];
      return { v: Math.round((v - phase) / spacing), u: Math.min(ua, ub), p0, p1 };
    });
  items.sort((a, b) => a.v - b.v || a.u - b.u);
  let flip = false;
  let lastV = null;
  const out = [];
  for (const it of items) {
    if (it.v !== lastV) {
      flip = !flip;
      lastV = it.v;
    }
    out.push(flip ? [it.p0, it.p1] : [it.p1, it.p0]);
  }
  return out;
}

function pathToPts(p) {
  return p.map((q) => [q.X / S, q.Y / S]);
}

function loopLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return l;
}

// start loop at the rear-most vertex (aligned seam)
function rotateSeam(pts) {
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[best][1] + 1e-6 || (Math.abs(pts[i][1] - pts[best][1]) < 1e-6 && pts[i][0] < pts[best][0])) best = i;
  return pts.slice(best).concat(pts.slice(0, best));
}

// ---------------------------------------------------------------- G-code
class Emitter {
  constructor(cfg) {
    this.cfg = cfg;
    this.lines = [];
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.retracted = false;
    this.filament = 0;
    this.layerLines = null;
    this.planner = new Planner({ axes: 4, maxFeed: [300, 300, 12, 100], maxAccel: [4000, 4000, 200, 2500], accel: 2500, travelAccel: 4000, retractAccel: 1200, jd: 0.022, maxBlocks: 1e9 });
    this.ppos = [0, 0, 0, 0];
    this.curType = null;
    this.feedNow = null;
  }

  out(s) {
    this.lines.push(s);
  }

  // estimation planner: keep a lookahead window of 24 blocks
  plan(target, feed, travel) {
    const t = [target[0] ?? this.ppos[0], target[1] ?? this.ppos[1], target[2] ?? this.ppos[2], this.ppos[3] + (target[3] || 0)];
    this.planner.addMove(t, feed, { travel });
    this.ppos = t;
    while (this.planner.length > 24) {
      if (!this.planner.cur) this.planner.startBlock();
      const c = this.planner.cur;
      this.planner.update(c.duration - c.t + 1e-9);
    }
  }

  flushPlanner() {
    this.planner.update(1e9);
    return this.planner.totalTime;
  }

  type(t) {
    if (t !== this.curType) {
      this.out(`;TYPE:${t}`);
      this.curType = t;
    }
  }

  retract() {
    if (this.retracted) return;
    this.out('G1 E-.7 F2100');
    this.plan([undefined, undefined, undefined, -0.7], 35, true);
    this.retracted = true;
    this.feedNow = 2100;
  }

  unretract() {
    if (!this.retracted) return;
    this.out('G1 E.7 F2100');
    this.plan([undefined, undefined, undefined, 0.7], 35, true);
    this.retracted = false;
    this.feedNow = 2100;
  }

  travel(x, y, speed) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.01) return;
    if (d > 2) this.retract();
    this.out(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${Math.round(speed * 60)}`);
    this.feedNow = Math.round(speed * 60);
    this.plan([x, y], speed, true);
    this.x = x;
    this.y = y;
  }

  extrude(x, y, w, h, speed, flow = 1) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 0.005) return;
    this.unretract();
    const area = h * (w - h * (1 - Math.PI / 4));
    const e = ((area * d) / FIL_AREA) * flow;
    this.filament += e;
    const f = Math.round(speed * 60);
    this.out(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)}${f !== this.feedNow ? ` F${f}` : ''}`);
    this.feedNow = f;
    this.plan([x, y, undefined, e], speed, false);
    this.x = x;
    this.y = y;
  }

  moveZ(z, speed = 12) {
    this.out(`G1 Z${z.toFixed(3)} F${Math.round(speed * 60)}`);
    this.plan([undefined, undefined, z], speed, true);
    this.z = z;
    this.feedNow = null;
  }
}

// ---------------------------------------------------------------- main
export function sliceMesh(positions, settings = {}, onProgress) {
  const st = Object.assign(defaultSettings(), settings);
  const prof = PROFILES[st.profile] || PROFILES['0.20mm SPEED'];
  const fil = FILAMENTS[st.material] || FILAMENTS.PLA;
  const w = st.width;
  const nPer = st.vase ? 1 : st.perimeters;

  // bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = 0;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  // layers
  const layers = [];
  let z = prof.first;
  layers.push({ z, h: prof.first, zs: prof.first / 2 });
  while (z + prof.layer * 0.5 < maxZ) {
    const h = prof.layer;
    z = +(z + h).toFixed(4);
    layers.push({ z, h, zs: z - h / 2 });
  }

  onProgress?.(0.05, 'slicing');
  const raw = sliceTriangles(positions, layers);
  onProgress?.(0.2, 'polygons');

  // build layer regions
  const slices = raw.map((loops) => {
    let paths = loops.map(toPath);
    paths = C.Clipper.CleanPolygons(paths, 0.004 * S);
    paths = paths.map((p) => C.JS.Lighten(p, 0.012 * S)).filter((p) => p.length >= 3);
    const u = union(paths);
    return u.filter((p) => Math.abs(C.Clipper.Area(p)) > 0.05 * S * S);
  });

  const spacing = (L) => w - L.h * (1 - Math.PI / 4);
  const fillRegions = [];
  const perimeterSets = [];
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const sp = spacing(L);
    const islands = toExPolygons(slices[i]);
    const perIsl = [];
    const fills = [];
    for (const isl of islands) {
      const loops = [];
      for (let k = 0; k < nPer; k++) {
        const d = -(w / 2 + k * sp);
        const off = offset(isl, d);
        if (!off.length) break;
        loops.push(off);
      }
      const inner = offset(isl, -(w / 2 + (nPer - 1) * sp + sp - 0.15 * w));
      perIsl.push({ isl, loops, inner });
      if (inner.length) fills.push(...inner);
    }
    perimeterSets.push(perIsl);
    fillRegions.push(fills);
    if (i % 10 === 0) onProgress?.(0.2 + (0.25 * i) / layers.length, 'perimeters');
  }

  // solid / sparse classification
  const solidRegions = [];
  const bridgeRegions = [];
  for (let i = 0; i < layers.length; i++) {
    const fr = fillRegions[i];
    if (!fr.length) {
      solidRegions.push([]);
      bridgeRegions.push([]);
      continue;
    }
    let cover = null;
    let full = false;
    for (let j = i - prof.bottom; j <= i + prof.top; j++) {
      if (j === i) continue;
      if (j < 0 || j >= layers.length) {
        full = true;
        break;
      }
      cover = cover === null ? slices[j] : intersect(cover, slices[j]);
      if (!cover.length) {
        full = true;
        break;
      }
    }
    let solid = full ? fr : difference(fr, offset(cover, -0.2));
    if (!full && solid.length) {
      // grow a bit for anchoring, then limit to fill region
      solid = intersect(offset(solid, w * 1.5), fr);
      if (areaMm2(solid) < 1) solid = [];
    }
    if (st.vase && i >= prof.bottom) solid = [];
    solidRegions.push(solid);
    let bridge = [];
    if (i > 0 && solid.length) {
      bridge = intersect(solid, difference(fr, offset(slices[i - 1], 0.1)));
      if (areaMm2(bridge) < 2) bridge = [];
    }
    bridgeRegions.push(bridge);
    if (i % 10 === 0) onProgress?.(0.45 + (0.2 * i) / layers.length, 'infill');
  }

  // ------------------------------------------------------------- G-code
  const E = new Emitter(st);
  const header = [];
  const area = { x: Math.max(0, minX), y: Math.max(0, minY), w: Math.min(250, maxX) - Math.max(0, minX), h: Math.min(210, maxY) - Math.max(0, minY) };
  const layerTexts = [];
  const layerTimes = [];
  let tPrev = 0;
  const speedMul = prof.speedMul;
  let lastSpiralEnd = null;

  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const sp = spacing(L);
    E.lines = [];
    const first = i === 0;
    const vaseActive = st.vase && i >= prof.bottom;
    E.out(';LAYER_CHANGE');
    E.out(`;Z:${L.z.toFixed(2)}`);
    E.out(`;HEIGHT:${L.h.toFixed(2)}`);
    // fan
    if (i === 1) E.out(`M106 S${fil.fanFull > 10 ? 40 : 102}`);
    if (i === 2) E.out(`M106 S${fil.fanFull > 10 ? 60 : 178}`);
    if (i === Math.min(fil.fanFull, 3)) E.out(`M106 S${fil.fanFull > 10 ? 76 : 255}`);
    if (i === 1) {
      E.out(`M104 S${fil.nozzle}`);
    }
    if (!vaseActive) {
      E.retract();
      E.moveZ(L.z);
    }
    const sp1 = first ? 25 : 1;
    const v = (base) => (first ? Math.min(base, 25) : base * speedMul);
    const islands = perimeterSets[i];
    // order islands nearest neighbour
    const remaining = islands.slice();
    const ordered = [];
    let cx = E.x;
    let cy = E.y;
    while (remaining.length) {
      let bi = 0;
      let bd = Infinity;
      remaining.forEach((isl, k) => {
        const p = isl.isl[0][0];
        const d = Math.hypot(p.X / S - cx, p.Y / S - cy);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      });
      const isl = remaining.splice(bi, 1)[0];
      ordered.push(isl);
      cx = isl.isl[0][0].X / S;
      cy = isl.isl[0][0].Y / S;
    }

    if (vaseActive) {
      // spiral vase: only the outermost contour, z ramps continuously
      let best = null;
      let bestA = 0;
      for (const isl of ordered) {
        for (const outer of isl.loops[0] || []) {
          const a = Math.abs(C.Clipper.Area(outer));
          if (a > bestA) {
            bestA = a;
            best = outer;
          }
        }
      }
      if (best) {
        let pts = pathToPts(best);
        if (C.Clipper.Area(best) < 0) pts.reverse();
        // start near previous end
        if (lastSpiralEnd) {
          let bi = 0;
          let bd = Infinity;
          pts.forEach((p, k) => {
            const d = Math.hypot(p[0] - lastSpiralEnd[0], p[1] - lastSpiralEnd[1]);
            if (d < bd) {
              bd = d;
              bi = k;
            }
          });
          pts = pts.slice(bi).concat(pts.slice(0, bi));
        } else pts = rotateSeam(pts);
        const total = loopLength(pts);
        const z0 = layers[i - 1].z;
        E.type('External perimeter');
        E.out(`;WIDTH:${w.toFixed(3)}`);
        if (!lastSpiralEnd) {
          E.travel(pts[0][0], pts[0][1], 150);
          E.unretract();
        }
        let acc = 0;
        const n = pts.length;
        for (let k = 1; k <= n; k++) {
          const a = pts[k - 1];
          const b = pts[k % n];
          acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
          const zz = z0 + (L.h * acc) / total;
          const d = Math.hypot(b[0] - E.x, b[1] - E.y);
          const area2 = L.h * (w - L.h * (1 - Math.PI / 4));
          const e = (area2 * d) / FIL_AREA;
          E.filament += e;
          E.out(`G1 X${b[0].toFixed(3)} Y${b[1].toFixed(3)} Z${zz.toFixed(3)} E${e.toFixed(5)} F${Math.round(v(38) * 60)}`);
          E.plan([b[0], b[1], zz, e], v(38), false);
          E.x = b[0];
          E.y = b[1];
          E.z = zz;
        }
        lastSpiralEnd = [E.x, E.y];
      }
    } else {
      for (const isl of ordered) {
        // perimeters: inner first, external last
        for (let k = isl.loops.length - 1; k >= 0; k--) {
          const ext = k === 0;
          for (const path of isl.loops[k]) {
            let pts = pathToPts(path);
            if (pts.length < 3) continue;
            pts = rotateSeam(pts);
            const len = loopLength(pts);
            const small = len < 40;
            const spd = ext ? (small ? v(35) : v(70)) : small ? v(40) : v(110);
            E.type(ext ? 'External perimeter' : 'Perimeter');
            E.out(`;WIDTH:${w.toFixed(3)}`);
            E.travel(pts[0][0], pts[0][1], first ? 150 : 250);
            for (let q = 1; q < pts.length; q++) E.extrude(pts[q][0], pts[q][1], w, L.h, spd);
            // close loop, stop slightly short (seam)
            const a = pts[pts.length - 1];
            const b = pts[0];
            const dd = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const f = dd > 0.3 ? (dd - 0.15) / dd : 1;
            E.extrude(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, w, L.h, spd);
          }
        }
        // infill inside this island
        const islFill = isl.inner;
        if (!islFill.length) continue;
        const solid = intersect(solidRegions[i], islFill);
        const bridge = bridgeRegions[i].length ? intersect(bridgeRegions[i], solid) : [];
        const solidNoBridge = bridge.length ? difference(solid, bridge) : solid;
        const sparse = solid.length ? difference(islFill, offset(solid, 0.05)) : islFill;
        const ang = i % 2 ? -Math.PI / 4 : Math.PI / 4;
        const isTop = i + 1 >= layers.length || !slices[i + 1]?.length;
        if (bridge.length) {
          E.type('Bridge infill');
          for (const [p0, p1] of hatch(bridge, ang, sp)) {
            E.travel(p0[0], p0[1], 250);
            E.extrude(p1[0], p1[1], w, L.h, v(28));
          }
        }
        if (solidNoBridge.length) {
          const topSurf = isTop || (i + 1 < layers.length && areaMm2(difference(solidNoBridge, slices[i + 1])) > areaMm2(solidNoBridge) * 0.5);
          E.type(topSurf ? 'Top solid infill' : 'Solid infill');
          E.out(`;WIDTH:${w.toFixed(3)}`);
          for (const [p0, p1] of hatch(solidNoBridge, ang, sp)) {
            const dt = Math.hypot(p0[0] - E.x, p0[1] - E.y);
            if (dt < sp * 2.2 && dt > 0.01) E.extrude(p0[0], p0[1], w, L.h, first ? 25 : v(topSurf ? 60 : 120));
            else E.travel(p0[0], p0[1], first ? 150 : 250);
            E.extrude(p1[0], p1[1], w, L.h, first ? sp1 : v(topSurf ? 70 : 140));
          }
        }
        if (sparse.length && st.infill > 0 && !first) {
          E.type('Internal infill');
          const gap = (2 * sp) / st.infill;
          const lines = [...hatch(sparse, Math.PI / 4, gap, 0), ...hatch(sparse, -Math.PI / 4, gap, 0)];
          for (const [p0, p1] of lines) {
            E.travel(p0[0], p0[1], 250);
            E.extrude(p1[0], p1[1], w, L.h, v(180));
          }
        } else if (sparse.length && first) {
          // first layer is always solid
          E.type('Solid infill');
          for (const [p0, p1] of hatch(sparse, ang, sp)) {
            E.travel(p0[0], p0[1], 150);
            E.extrude(p1[0], p1[1], w, L.h, 25);
          }
        }
      }
    }
    const tNow = E.flushPlanner();
    layerTimes.push(tNow - tPrev);
    tPrev = tNow;
    layerTexts.push(E.lines);
    if (i % 5 === 0) onProgress?.(0.65 + (0.33 * i) / layers.length, 'gcode');
  }

  const total = tPrev;
  const filMm = E.filament;
  const filCm3 = (filMm * FIL_AREA) / 1000;
  const filG = filCm3 * fil.density;

  // assemble
  const start = startGcode(fil, area);
  const body = [];
  let acc = 0;
  for (let i = 0; i < layerTexts.length; i++) {
    const p = Math.floor((acc / total) * 100);
    const r = Math.ceil((total - acc) / 60);
    body.push(`M73 P${p} R${r}`);
    body.push(`M73 Q${p} S${Math.ceil(r * 1.05)}`);
    for (const l of layerTexts[i]) body.push(l);
    acc += layerTimes[i];
  }
  body.push('M73 P100 R0');
  body.push('M73 Q100 S0');
  const end = endGcode(maxZ);
  const meta = {
    time: total,
    filamentM: filMm / 1000,
    filamentG: filG,
    material: st.material,
    layers: layers.length,
    height: maxZ,
    nozzle: 0.4,
    printerModel: 'MK4S',
    layerHeight: prof.layer,
    nozzleTemp: fil.nozzle,
    bedTemp: fil.bed
  };
  const footer = [
    '',
    `; filament used [mm] = ${filMm.toFixed(2)}`,
    `; filament used [cm3] = ${filCm3.toFixed(2)}`,
    `; filament used [g] = ${filG.toFixed(2)}`,
    `; filament cost = ${(filG * 0.025).toFixed(2)}`,
    `; estimated printing time (normal mode) = ${fmtTime(total)}`,
    `; estimated printing time (silent mode) = ${fmtTime(total * 1.05)}`,
    `; estimated first layer printing time (normal mode) = ${fmtTime(layerTimes[0] || 0)}`,
    '; printer_model = MK4S',
    '; nozzle_diameter = 0.4',
    `; filament_type = ${st.material}`,
    `; layer_height = ${prof.layer}`,
    `; first_layer_height = ${prof.first}`,
    `; fill_density = ${Math.round(st.infill * 100)}%`,
    `; perimeters = ${nPer}`,
    `; spiral_vase = ${st.vase ? 1 : 0}`,
    `; temperature = ${fil.nozzle}`,
    `; bed_temperature = ${fil.bed}`,
    `; max_layer_z = ${maxZ.toFixed(2)}`
  ];
  header.push(
    '; generated by Maker-Werkstatt Slicer 1.0 (PrusaSlicer-compatible output)',
    `; profile: ${st.profile} @MK4S, ${st.material}`,
    ''
  );
  onProgress?.(1, 'done');
  return {
    header: header.join('\n'),
    body: [start, body.join('\n'), end, footer.join('\n')].join('\n'),
    meta
  };
}

function fmtTime(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}h ` : ''}${m}m ${sec}s`;
}

function startGcode(fil, a) {
  const ax = Math.max(0, a.x).toFixed(2);
  const ay = Math.max(0, a.y).toFixed(2);
  return [
    'M17 ; enable steppers',
    'M862.1 P0.4 A0 F1 ; nozzle check',
    'M862.3 P "MK4S" ; printer model check',
    'M862.5 P2 ; g-code level check',
    'M862.6 P"Input shaper" ; FW feature check',
    'M115 U6.2.4+9214',
    `M555 X${ax} Y${ay} W${a.w.toFixed(2)} H${a.h.toFixed(2)}`,
    'G90 ; use absolute coordinates',
    'M83 ; extruder relative mode',
    `M140 S${fil.bed} ; set bed temp`,
    'M104 T0 S170 ; set extruder temp for bed leveling',
    'M109 T0 R170 ; wait for temp',
    'M84 E ; turn off E motor',
    'G28 ; home all without mesh bed level',
    'G1 X42 Y-4 Z5 F4800',
    'M302 S160 ; lower cold extrusion limit to 160C',
    'G1 E-2 F2400 ; retraction',
    'M84 E ; turn off E motor',
    'G29 P9 X10 Y-4 W32 H4 ; probe near purge place',
    'G0 Z5 F480 ; move away in Z',
    'M107 ; turn off the fan',
    `M190 S${fil.bed} ; wait for bed temp`,
    `G29 P1 X${ax} Y${ay} W${a.w.toFixed(2)} H${a.h.toFixed(2)} ; probe print area`,
    'G29 P3.2 ; interpolate mbl probes',
    'G29 P3.13 ; extrapolate mbl outside probe area',
    'G29 A ; activate mbl',
    `M104 S${fil.first} ; set extruder temp`,
    'G0 X0 Y-4 Z15 F4800 ; move away and ready for the purge',
    `M109 S${fil.first} ; wait for extruder temp`,
    'G92 E0',
    'M569 S0 E ; set spreadcycle mode for extruder',
    ';',
    '; Extrude purge line',
    ';',
    'G92 E0 ; reset extruder position',
    'G1 E2 F2400 ; deretraction after the initial one before nozzle cleaning',
    'G0 E7 X15 Z0.2 F500 ; purge',
    'G0 X25 E4 F500 ; purge',
    'G0 X35 E4 F650 ; purge',
    'G0 X45 E4 F800 ; purge',
    'G0 X48 Z0.05 F8000 ; wipe, move close to the bed',
    'G0 X51 Z0.2 F8000 ; wipe, move quickly away from the bed',
    'G92 E0',
    'M221 S100 ; set flow to 100%',
    'G21 ; set units to millimeters',
    'G90 ; use absolute coordinates',
    'M83 ; use relative distances for extrusion',
    'M900 K0.05 ; Filament gcode LA 1.5',
    'M107'
  ].join('\n');
}

function endGcode(maxZ) {
  const lift = Math.min(220, maxZ + 10);
  return [
    '; Filament-specific end gcode',
    'G1 E-.7 F2100',
    `G1 Z${lift.toFixed(2)} F720 ; Move print head up`,
    'M104 S0 ; turn off temperature',
    'M140 S0 ; turn off heatbed',
    'M107 ; turn off fan',
    'G1 X241 Y205 F3600 ; park',
    'G4 ; wait',
    'M572 S0 ; reset PA',
    'M593 X T2 F0 ; disable IS',
    'M593 Y T2 F0 ; disable IS',
    'M84 X Y E ; disable motors',
    '; max_layer_z = ' + maxZ.toFixed(2)
  ].join('\n');
}
