import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural sample models (printer coordinates: mm, Z up). Each model is
// returned as non-indexed triangle positions centred on the bed.

const BED_CX = 125;
const BED_CY = 105;

function toPrinter(geo) {
  // three.js geometries are Y-up: convert to Z-up and place on the bed
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(BED_CX - (bb.min.x + bb.max.x) / 2, BED_CY - (bb.min.y + bb.max.y) / 2, -bb.min.z);
  return g;
}

export function geometryToPrinterPositions(geo) {
  return toPrinter(geo).attributes.position.array.slice();
}

// Z-up geometry (e.g. from STL) -> centred on bed
export function placeZUp(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(BED_CX - (bb.min.x + bb.max.x) / 2, BED_CY - (bb.min.y + bb.max.y) / 2, -bb.min.z);
  g.computeBoundingBox();
  return g;
}

function cube() {
  // 20 mm calibration cube with small chamfer at the bottom edges
  const s = new THREE.Shape();
  s.moveTo(-10, -10);
  s.lineTo(10, -10);
  s.lineTo(10, 10);
  s.lineTo(-10, 10);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 20, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

function gear() {
  const teeth = 24;
  const m = 1.5;
  const rp = (teeth * m) / 2;
  const ro = rp + m;
  const rr = rp - 1.25 * m;
  const s = new THREE.Shape();
  const N = teeth * 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ph = ((i % 16) + 0.5) / 16; // position within tooth period
    // trapezoidal tooth profile
    let r;
    if (ph < 0.18 || ph > 0.82) r = rr;
    else if (ph < 0.33) r = rr + (ro - rr) * ((ph - 0.18) / 0.15);
    else if (ph < 0.67) r = ro;
    else r = ro - (ro - rr) * ((ph - 0.67) / 0.15);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, 4.1, 0, Math.PI * 2, true);
  s.holes.push(hole);
  // lightening holes
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 10.5, Math.sin(a) * 10.5, 3.2, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const plate = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: false, curveSegments: 24 });
  const hubS = new THREE.Shape();
  hubS.absarc(0, 0, 7, 0, Math.PI * 2, false);
  const hh = new THREE.Path();
  hh.absarc(0, 0, 4.1, 0, Math.PI * 2, true);
  hubS.holes.push(hh);
  const hub = new THREE.ExtrudeGeometry(hubS, { depth: 10, bevelEnabled: false, curveSegments: 32 });
  const g = mergeGeometries([plate.toNonIndexed(), hub.toNonIndexed()]);
  g.rotateX(-Math.PI / 2);
  return g;
}

function vase() {
  const H = 90;
  const N = 144;
  const rings = 91;
  const pos = [];
  const R = (z, a) => {
    const t = z / H;
    const base = 26 + 9 * Math.sin(t * Math.PI * 0.95) - 4 * t;
    return base * (1 + 0.07 * Math.cos(9 * a));
  };
  const pt = (z, i) => {
    const a = (i / N) * Math.PI * 2;
    const tw = (z / H) * Math.PI * 0.45;
    const r = R(z, a);
    return [Math.cos(a + tw) * r, Math.sin(a + tw) * r, z];
  };
  for (let k = 0; k < rings - 1; k++) {
    const z0 = (k / (rings - 1)) * H;
    const z1 = ((k + 1) / (rings - 1)) * H;
    for (let i = 0; i < N; i++) {
      const a = pt(z0, i);
      const b = pt(z0, (i + 1) % N);
      const c = pt(z1, (i + 1) % N);
      const d = pt(z1, i);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  // caps
  for (const [z, up] of [[0, false], [H, true]]) {
    for (let i = 0; i < N; i++) {
      const a = pt(z, i);
      const b = pt(z, (i + 1) % N);
      if (up) pos.push(0, 0, z, ...a, ...b);
      else pos.push(0, 0, z, ...b, ...a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // already Z-up -> convert to Y-up for uniform handling
  g.rotateX(-Math.PI / 2);
  return g;
}

function heartTag() {
  const s = new THREE.Shape();
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    if (i === 0) s.moveTo(x * 1.35, y * 1.35);
    else s.lineTo(x * 1.35, y * 1.35);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 7.5, 3, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 3.2, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function phoneStand() {
  const d = [Math.cos((70 * Math.PI) / 180), Math.sin((70 * Math.PI) / 180)];
  const n = [d[1], -d[0]];
  const F0 = [25, 5];
  const F1 = [F0[0] + 78 * d[0], F0[1] + 78 * d[1]];
  const B1 = [F1[0] + 6 * n[0], F1[1] + 6 * n[1]];
  const tB = (5 - (F0[1] + 6 * n[1])) / d[1];
  const B0 = [F0[0] + 6 * n[0] + tB * d[0], 5];
  const s = new THREE.Shape();
  const pts = [[0, 0], [72, 0], [72, 5], B0, B1, F1, F0, [6, 5], [6, 15], [0, 15]];
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 60, bevelEnabled: false });
  // shape: x -> X, y -> Z(up), extrusion -> Y   (we build in Y-up space: y is up already)
  return g;
}

export const SAMPLE_MODELS = [
  { id: 'heart', file: 'Herz_Anhaenger_0.2mm_PLA_MK4S.gcode', title: 'Herz-Anhänger', build: heartTag, settings: { profile: '0.20mm SPEED', infill: 0.15 } },
  { id: 'cube', file: 'Kalibrierwuerfel_20mm_PLA_MK4S.gcode', title: 'Kalibrierwürfel 20 mm', build: cube, settings: { profile: '0.20mm SPEED', infill: 0.15 } },
  { id: 'gear', file: 'Zahnrad_Z24_m1.5_PETG_MK4S.gcode', title: 'Zahnrad Z24', build: gear, settings: { profile: '0.20mm SPEED', infill: 0.25, material: 'PETG' } },
  { id: 'vase', file: 'Spiralvase_Twist_0.2mm_PLA_MK4S.gcode', title: 'Spiralvase', build: vase, settings: { profile: '0.20mm SPEED', vase: true, infill: 0 } },
  { id: 'stand', file: 'Handystaender_0.2mm_PLA_MK4S.gcode', title: 'Handyständer', build: phoneStand, settings: { profile: '0.20mm SPEED', infill: 0.15, perimeters: 2 } }
];
