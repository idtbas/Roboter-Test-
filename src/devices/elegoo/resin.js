import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EGEO } from './model.js';

// ---------------------------------------------------------------------------
// Resin printing: materials, sample models, per-layer slicing for the LCD
// mask, and the growing cured part.
// ---------------------------------------------------------------------------

export const RESINS = [
  { id: 'std-grey', name: 'ELEGOO Standard Resin 2.0 – Grau', color: '#7b7f85', liquid: '#5e6268', exp: 2.5, bottomExp: 30, opacity: 1, rough: 0.45 },
  { id: 'abs-black', name: 'ELEGOO ABS-like Resin – Schwarz', color: '#1f2023', liquid: '#151618', exp: 3.0, bottomExp: 35, opacity: 1, rough: 0.4 },
  { id: 'ww-beige', name: 'ELEGOO Water Washable – Beige', color: '#d8c8a8', liquid: '#c2b190', exp: 2.8, bottomExp: 30, opacity: 1, rough: 0.5 },
  { id: 'clear-green', name: 'ELEGOO Standard – Transparent Grün', color: '#39c27a', liquid: '#2e9e62', exp: 2.2, bottomExp: 28, opacity: 0.7, rough: 0.12 },
  { id: '8k-red', name: 'ELEGOO 8K Resin – Rot', color: '#b8262b', liquid: '#9c1e23', exp: 2.6, bottomExp: 30, opacity: 1, rough: 0.35 }
];

export function defaultParams(resin) {
  return {
    layerHeight: 0.05,
    bottomLayers: 5,
    exposure: resin.exp,
    bottomExposure: resin.bottomExp,
    liftDist: 5,
    bottomLiftDist: 6,
    liftSpeed: 65, // mm/min
    bottomLiftSpeed: 50,
    retractSpeed: 150,
    restBefore: 1.0,
    restAfterLift: 0.5
  };
}

// ---------------------------------------------------------------- models
function lathe(profile, seg = 96) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return g;
}

function rook() {
  const p = [
    [0, 0], [11, 0], [11, 1.5], [10, 2.5], [10.2, 4], [8.8, 5], [7.2, 6.5], [6.4, 10], [5.9, 17], [6.6, 19], [8.2, 20.5], [8.6, 24], [8.6, 29], [6.4, 29], [6.4, 26.5], [0, 26.5]
  ];
  const body = lathe(p, 96);
  // crenellations: 6 notches -> subtract by adding merlons as separate boxes on top ring
  const merlons = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.BoxGeometry(4.2, 3.2, 2.4);
    b.translate(0, 30.6, 7.5);
    b.rotateY(a);
    merlons.push(b.toNonIndexed());
  }
  return mergeGeometries([body.toNonIndexed(), ...merlons]);
}

function pawn() {
  const p = [[0, 0], [9.5, 0], [9.5, 1.8], [8.2, 3], [6.2, 4.4], [4.6, 7], [3.6, 12], [3.4, 15], [5.6, 15.6], [5.8, 16.4], [3.6, 17.2]];
  // head sphere
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + 0.55 + (i / 12) * (Math.PI - 0.55);
    p.push([Math.cos(a) * 5.2, 22.4 + Math.sin(a) * 5.2]);
  }
  p[p.length - 1][0] = 0;
  return lathe(p.map(([r, y]) => [Math.max(0, r), y]), 96);
}

function tealight() {
  const p = [[0, 0], [21, 0], [22, 0.8], [22.5, 4], [21.5, 10], [19.5, 15], [20.5, 18], [22, 19], [20.5, 19], [19, 18], [18, 15], [19.8, 10], [20.4, 4], [19.5, 2], [0, 2]];
  return lathe(p, 128);
}

function rerf() {
  // resin exposure range finder style test: 8 tiles with pins
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 30 - 45;
    const z = Math.floor(i / 4) * 30 - 15;
    const b = new THREE.BoxGeometry(24, 2.5, 24);
    b.translate(x, 1.25, z);
    parts.push(b.toNonIndexed());
    for (let k = 0; k < 4; k++) {
      const pin = new THREE.CylinderGeometry(0.6 + k * 0.4, 0.6 + k * 0.4, 3 + k, 16);
      pin.translate(x - 7.5 + k * 5, 2.5 + (3 + k) / 2, z + 6);
      parts.push(pin.toNonIndexed());
    }
    const bar = new THREE.BoxGeometry(14, 1.2, 1.2);
    bar.translate(x, 3.1, z - 6);
    parts.push(bar.toNonIndexed());
  }
  return mergeGeometries(parts);
}

export const RESIN_SAMPLES = [
  { id: 'rerf', file: 'Belichtungstest_RERF_0.05mm.goo', title: 'Belichtungstest', build: rerf },
  { id: 'pawn', file: 'Schach_Bauer_0.05mm.goo', title: 'Schach: Bauer', build: pawn },
  { id: 'rook', file: 'Schach_Turm_0.05mm.goo', title: 'Schach: Turm', build: rook },
  { id: 'tealight', file: 'Teelicht_Schale_0.05mm.goo', title: 'Teelicht-Schale', build: tealight }
];

// Y-up three geometry -> Z-up positions centred on the LCD (printer X/Y)
export function toResinPositions(geo, zUp = false) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!zUp) g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  g.computeBoundingBox();
  return { positions: g.attributes.position.array.slice(), bbox: g.boundingBox.clone() };
}

// ---------------------------------------------------------------- slicing
// Returns closed loops (arrays of [x,y]) at height z.
export function sliceAt(pos, z) {
  const segs = [];
  for (let t = 0; t < pos.length; t += 9) {
    const z0 = pos[t + 2] - z;
    const z1 = pos[t + 5] - z;
    const z2 = pos[t + 8] - z;
    if ((z0 > 0 && z1 > 0 && z2 > 0) || (z0 < 0 && z1 < 0 && z2 < 0)) continue;
    const pts = [];
    const d = [z0 || 1e-7, z1 || 1e-7, z2 || 1e-7];
    for (let k = 0; k < 3; k++) {
      const a = k;
      const b = (k + 1) % 3;
      if (d[a] > 0 === d[b] > 0) continue;
      const f = d[a] / (d[a] - d[b]);
      pts.push([pos[t + a * 3] + (pos[t + b * 3] - pos[t + a * 3]) * f, pos[t + a * 3 + 1] + (pos[t + b * 3 + 1] - pos[t + a * 3 + 1]) * f]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

// area of the cross-section (mm²) using an even-odd scanline estimate
export function sectionArea(segs) {
  // sum of signed areas is unreliable without loops -> use bounding raster
  if (!segs.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [a, b] of segs) {
    minX = Math.min(minX, a[0], b[0]);
    maxX = Math.max(maxX, a[0], b[0]);
    minY = Math.min(minY, a[1], b[1]);
    maxY = Math.max(maxY, a[1], b[1]);
  }
  const step = Math.max(0.25, (maxY - minY) / 120);
  let area = 0;
  for (let y = minY + step / 2; y < maxY; y += step) {
    const xs = [];
    for (const [a, b] of segs) {
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) area += (xs[i + 1] - xs[i]) * step;
  }
  return area;
}

// Draw the layer mask into a 2D context mapped to the LCD (white = UV on)
export function drawMask(ctx, segs, W, H) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!segs.length) return;
  const sx = W / EGEO.LCD_W;
  const sy = H / EGEO.LCD_D;
  // scanline fill (even-odd) – robust without loop chaining
  ctx.fillStyle = '#fff';
  for (let py = 0; py < H; py++) {
    const y = EGEO.LCD_D / 2 - (py + 0.5) / sy; // printer Y (back = +)
    const xs = [];
    for (const [a, b] of segs) {
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = (xs[i] + EGEO.LCD_W / 2) * sx;
      const x1 = (xs[i + 1] + EGEO.LCD_W / 2) * sx;
      ctx.fillRect(x0, py, Math.max(1, x1 - x0), 1);
    }
  }
}

// Estimate print time and resin volume
export function analyse(pos, bbox, params) {
  const h = params.layerHeight;
  const layers = Math.max(1, Math.round(bbox.max.z / h));
  let vol = 0;
  const sampleEvery = Math.max(1, Math.floor(layers / 60));
  for (let i = 0; i < layers; i += sampleEvery) {
    const a = sectionArea(sliceAt(pos, (i + 0.5) * h));
    vol += a * h * Math.min(sampleEvery, layers - i);
  }
  let t = 0;
  for (let i = 0; i < layers; i++) {
    const bottom = i < params.bottomLayers;
    const lift = bottom ? params.bottomLiftDist : params.liftDist;
    const ls = (bottom ? params.bottomLiftSpeed : params.liftSpeed) / 60;
    t += params.restBefore + (bottom ? params.bottomExposure : params.exposure) + lift / ls + params.restAfterLift + lift / (params.retractSpeed / 60);
  }
  return { layers, volumeMl: vol / 1000, time: t, height: bbox.max.z };
}

// ---------------------------------------------------------------- visual
// The cured part hanging under the build plate, revealed layer by layer.
export class CuredPart {
  constructor(anchor, positions, resin) {
    const g = new THREE.BufferGeometry();
    // printer (x, y, z_up) -> plate local (x, -z, -y)
    const p = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      p[i] = positions[i];
      p[i + 1] = -positions[i + 2];
      p[i + 2] = -positions[i + 1];
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.computeVertexNormals();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.localPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.mat = new THREE.MeshPhysicalMaterial({
      color: resin.color,
      roughness: resin.rough,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      transparent: resin.opacity < 1,
      opacity: resin.opacity,
      transmission: 0,
      side: THREE.DoubleSide,
      clippingPlanes: [this.plane],
      clipShadows: true
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noPick = true;
    this.mesh.raycast = () => {};
    anchor.add(this.mesh);
    this.height = 0;
    this.wet = true;
  }

  setHeight(hgt) {
    this.height = hgt;
  }

  update() {
    // visible where local y >= -height  ->  plane (0,1,0) const h, to world
    this.localPlane.set(new THREE.Vector3(0, 1, 0), this.height + 0.001);
    this.mesh.updateMatrixWorld();
    this.plane.copy(this.localPlane).applyMatrix4(this.mesh.matrixWorld);
  }

  finishCure() {
    // washed & UV cured: matte, no longer wet
    this.wet = false;
    this.mat.clearcoat = 0;
    this.mat.roughness = Math.min(0.75, this.mat.roughness + 0.25);
  }

  detach() {
    this.mat.clippingPlanes = this.height > 0 ? [this.plane] : [];
    return this.mesh;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// Thumbnail of a resin model (grey on dark blue)
export function resinThumb(positions, color = '#9aa0a8') {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 180;
  const ctx = c.getContext('2d');
  // simple orthographic render via projected triangles with lambert shading
  const tris = [];
  const cos = Math.cos(0.7);
  const sin = Math.sin(0.7);
  const ce = Math.cos(0.5);
  const se = Math.sin(0.5);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const proj = (x, y, z) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    const sy = z * ce - ry * se;
    const depth = z * se + ry * ce;
    return [rx, -sy, depth];
  };
  for (let i = 0; i < positions.length; i += 9) {
    const a = proj(positions[i], positions[i + 1], positions[i + 2]);
    const b = proj(positions[i + 3], positions[i + 4], positions[i + 5]);
    const d = proj(positions[i + 6], positions[i + 7], positions[i + 8]);
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const light = Math.max(0, nx * 0.4 + ny * -0.5 + nz * 0.75);
    tris.push({ a, b, d, z: (a[2] + b[2] + d[2]) / 3, light });
    for (const p of [a, b, d]) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  tris.sort((p, q) => p.z - q.z);
  const s = Math.min(200 / (maxX - minX), 150 / (maxY - minY));
  const ox = 120 - ((minX + maxX) / 2) * s;
  const oy = 90 - ((minY + maxY) / 2) * s;
  const base = new THREE.Color(color);
  for (const t of tris) {
    const k = 0.35 + 0.65 * t.light;
    ctx.fillStyle = `rgb(${Math.round(base.r * 255 * k)},${Math.round(base.g * 255 * k)},${Math.round(base.b * 255 * k)})`;
    ctx.beginPath();
    ctx.moveTo(ox + t.a[0] * s, oy + t.a[1] * s);
    ctx.lineTo(ox + t.b[0] * s, oy + t.b[1] * s);
    ctx.lineTo(ox + t.d[0] * s, oy + t.d[1] * s);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}
