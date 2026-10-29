import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dataTexture, heightToNormal } from './textures.js';

// ---------------------------------------------------------------------------
// Generic helpers. Units: millimetres. Y is up.
// ---------------------------------------------------------------------------

export function place(obj, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s, cast = true, receive = true, name } = {}) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  if (s !== undefined) {
    if (typeof s === 'number') obj.scale.setScalar(s);
    else obj.scale.set(s[0], s[1], s[2]);
  }
  if (obj.isMesh) {
    obj.castShadow = cast;
    obj.receiveShadow = receive;
  }
  if (name) obj.name = name;
  return obj;
}

export function mesh(geo, mat, opts) {
  return place(new THREE.Mesh(geo, mat), opts);
}

export function box(w, h, d, mat, opts) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, opts);
}

export function rbox(w, h, d, r, mat, opts, seg = 3) {
  const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
  return mesh(new RoundedBoxGeometry(w, h, d, seg, Math.max(0.01, rr)), mat, opts);
}

export function cyl(r, h, mat, opts, seg = 24, rBottom) {
  return mesh(new THREE.CylinderGeometry(r, rBottom ?? r, h, seg), mat, opts);
}

// Cylinder oriented along X / Z
export function cylX(r, len, mat, opts = {}, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return mesh(g, mat, opts);
}
export function cylZ(r, len, mat, opts = {}, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return mesh(g, mat, opts);
}

export function group(name, opts = {}) {
  const g = new THREE.Group();
  g.name = name || '';
  place(g, opts);
  return g;
}

// Extrude a 2D shape (in XY plane) along +Z by depth, centred on Z if centered
export function extrude(shape, depth, mat, opts = {}, { bevel = 0, curveSegments = 12, centered = true } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments
  });
  if (centered) g.translate(0, 0, -depth / 2);
  return mesh(g, mat, opts);
}

export function roundedRectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function roundedRectPath(w, h, r, cx = 0, cy = 0) {
  const p = new THREE.Path();
  const x = cx - w / 2;
  const y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

export function circlePath(r, cx = 0, cy = 0, cw = false) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, cw);
  return p;
}

export function chamferRectShape(w, h, c) {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = h / 2;
  s.moveTo(-x + c, -y);
  s.lineTo(x - c, -y);
  s.lineTo(x, -y + c);
  s.lineTo(x, y - c);
  s.lineTo(x - c, y);
  s.lineTo(-x + c, y);
  s.lineTo(-x, y - c);
  s.lineTo(-x, -y + c);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------
// Aluminium T-slot extrusion (20 mm system). w,h multiples of 20.
// Geometry runs along +Z (length), centred.
// ---------------------------------------------------------------------------
const profileCache = new Map();
export function extrusionGeometry(w, h, length) {
  const key = `${w}x${h}`;
  let shape = profileCache.get(key);
  if (!shape) {
    shape = new THREE.Shape();
    const pts = [];
    const hw = w / 2;
    const hh = h / 2;
    const slot = (cx, cy, nx, ny) => {
      // slot centred at (cx,cy) on an edge with outward normal (nx,ny); tangent (tx,ty)
      const tx = -ny;
      const ty = nx;
      const P = (t, d) => [cx + tx * t - nx * d, cy + ty * t - ny * d];
      return [P(-3.1, 0), P(-3.1, 1.8), P(-5.6, 1.8), P(-5.6, 2.9), P(-3.0, 5.6), P(3.0, 5.6), P(5.6, 2.9), P(5.6, 1.8), P(3.1, 1.8), P(3.1, 0)];
    };
    const c = 0.6; // corner radius approx via chamfer
    // bottom edge, left -> right (normal 0,-1)
    pts.push([-hw + c, -hh]);
    for (let x = -hw + 10; x < hw; x += 20) pts.push(...slot(x, -hh, 0, -1));
    pts.push([hw - c, -hh], [hw, -hh + c]);
    for (let y = -hh + 10; y < hh; y += 20) pts.push(...slot(hw, y, 1, 0));
    pts.push([hw, hh - c], [hw - c, hh]);
    for (let x = hw - 10; x > -hw; x -= 20) pts.push(...slot(x, hh, 0, 1));
    pts.push([-hw + c, hh], [-hw, hh - c]);
    for (let y = hh - 10; y > -hh; y -= 20) pts.push(...slot(-hw, y, -1, 0));
    pts.push([-hw, -hh + c]);
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    for (let x = -hw + 10; x < hw; x += 20) {
      for (let y = -hh + 10; y < hh; y += 20) shape.holes.push(circlePath(2.1, x, y, true));
    }
    profileCache.set(key, shape);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -length / 2);
  return g;
}

export function extrusion(w, h, length, mat, opts) {
  return mesh(extrusionGeometry(w, h, length), mat, opts);
}

// ---------------------------------------------------------------------------
// Screws, nuts, washers
// ---------------------------------------------------------------------------
let hexSocketGeo = null;
export function capScrew(d = 3, mat, matDark, opts = {}, len = 0) {
  const g = group('screw', opts);
  const headD = d * 1.75;
  const headH = d;
  const head = cyl(headD / 2, headH, mat, { y: headH / 2 }, 20);
  head.geometry = head.geometry.clone();
  g.add(head);
  if (!hexSocketGeo) {
    hexSocketGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  }
  const sock = new THREE.Mesh(hexSocketGeo, matDark);
  sock.scale.set(d * 0.45, 0.4, d * 0.45);
  sock.position.y = headH + 0.01 - 0.2;
  g.add(sock);
  if (len > 0) g.add(cyl(d / 2, len, mat, { y: -len / 2 }, 12));
  return g;
}

export function buttonHead(d = 3, mat, matDark, opts = {}) {
  const g = group('screw', opts);
  const sph = new THREE.SphereGeometry(d, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  sph.scale(1, 0.55, 1);
  g.add(mesh(sph, mat));
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), matDark);
  sock.scale.set(d * 0.35, 0.3, d * 0.35);
  sock.position.y = d * 0.5;
  g.add(sock);
  return g;
}

export function hexNut(d = 3, mat, opts) {
  const g = new THREE.CylinderGeometry(d * 0.92, d * 0.92, d * 0.8, 6);
  return mesh(g, mat, opts);
}

// ---------------------------------------------------------------------------
// Stepper motor (NEMA 17 / 14). Shaft along +Y from the front face at y=0.
// Body extends to -length.
// ---------------------------------------------------------------------------
export function stepper(M, { size = 42.3, length = 40, shaftLen = 22, label = false, connector = 'side' } = {}) {
  const g = group('stepper');
  const ch = size * 0.12;
  const sq = chamferRectShape(size, size, ch);
  const capT = 7;
  const front = extrude(sq, capT, M.blackAnodized, { rx: -Math.PI / 2, y: -capT / 2 }, { centered: true });
  g.add(front);
  const mid = extrude(chamferRectShape(size - 0.6, size - 0.6, ch), length - capT * 2, M.plasticGlossBlack, { rx: -Math.PI / 2, y: -length / 2 }, { centered: true });
  g.add(mid);
  const back = extrude(sq, capT, M.blackAnodized, { rx: -Math.PI / 2, y: -length + capT / 2 });
  g.add(back);
  // stator lamination rings
  for (let i = 1; i < 6; i++) {
    const t = capT + ((length - capT * 2) * i) / 6;
    const ring = extrude(chamferRectShape(size - 0.2, size - 0.2, ch), 0.5, M.darkSteel, { rx: -Math.PI / 2, y: -t });
    g.add(ring);
  }
  // pilot boss + shaft
  g.add(cyl(11, 2, M.blackAnodized, { y: 1 }, 32));
  const shaft = cyl(2.5, shaftLen, M.steel, { y: 2 + shaftLen / 2 }, 16);
  shaft.name = 'shaft';
  g.add(shaft);
  // mounting holes
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(1.6, 0.4, M.rubber, { x: sx * 15.5, y: 0.05, z: sz * 15.5 }, 12));
    }
  }
  if (connector === 'side') {
    g.add(box(16, 7, 6, M.plasticWhite, { x: 0, y: -length + capT + 4, z: size / 2 + 3 }));
  }
  if (label) {
    const lab = box(size * 0.6, 0.2, size * 0.5, M.plasticGrey, { y: -length - 0.11 });
    g.add(lab);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Axial fan (square frame). Faces +Z. Returns {group, rotor}
// ---------------------------------------------------------------------------
export function axialFan(M, size = 40, depth = 10, frameMat = M.plasticBlack, bladeMat = M.plasticBlack) {
  const g = group('fan');
  const frame = roundedRectShape(size, size, size * 0.08);
  frame.holes.push(circlePath(size * 0.47, 0, 0, true));
  const holeR = size * 0.04;
  const ho = size / 2 - size * 0.1;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) frame.holes.push(circlePath(holeR, sx * ho, sy * ho, true));
  g.add(extrude(frame, depth, frameMat, {}, { curveSegments: 24 }));
  // spokes behind rotor
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const spoke = box(size * 0.5, 1.2, 1, frameMat, { z: -depth / 2 + 0.6, rz: a });
    spoke.position.x = Math.cos(a) * size * 0.25;
    spoke.position.y = Math.sin(a) * size * 0.25;
    g.add(spoke);
  }
  g.add(cyl(size * 0.17, 1.2, frameMat, { z: -depth / 2 + 0.6, rx: Math.PI / 2 }, 24));
  const rotor = group('rotor');
  rotor.add(cyl(size * 0.16, depth * 0.8, bladeMat, { rx: Math.PI / 2 }, 24));
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, size * 0.13, 0.7), bladeMat);
    blade.geometry.translate(size * 0.15, 0, 0);
    const piv = new THREE.Group();
    piv.rotation.z = a;
    blade.position.x = size * 0.15;
    blade.rotation.x = 0.55;
    blade.castShadow = true;
    piv.add(blade);
    rotor.add(piv);
  }
  g.add(rotor);
  return { group: g, rotor };
}

// ---------------------------------------------------------------------------
// GT2 belt texture (teeth) + belt strand
// ---------------------------------------------------------------------------
let beltTex = null;
export function beltTextures() {
  if (beltTex) return beltTex;
  const W = 64;
  const H = 8;
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = x / W;
      h[y * W + x] = f < 0.45 ? 1 : 0;
    }
  }
  const n = heightToNormal(h, W, H, 3);
  const normal = dataTexture(n, W, H, { mipmaps: true });
  beltTex = { normal };
  return beltTex;
}

// A straight belt strand along X with length L (2mm tooth pitch) – returns mesh with own texture clone
export function beltStrand(M, L, width = 6, thick = 1.4) {
  const t = beltTextures().normal.clone();
  t.needsUpdate = true;
  t.repeat.set(L / 2, 1);
  const mat = M.beltRubber.clone();
  mat.normalMap = t;
  mat.normalScale = new THREE.Vector2(0.8, 0.8);
  const geo = new THREE.BoxGeometry(L, thick, width);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.beltTex = t;
  return m;
}

// Half-wrap of belt around a pulley of radius r, axis along Z (wrap on +X or -X side)
export function beltWrap(M, r, side = 1, width = 6, thick = 1.4) {
  const shape = new THREE.Shape();
  const r0 = r;
  const r1 = r + thick;
  const a0 = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const a1 = side > 0 ? Math.PI / 2 : (3 * Math.PI) / 2;
  shape.absarc(0, 0, r1, a0, a1, false);
  shape.absarc(0, 0, r0, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -width / 2);
  const m = new THREE.Mesh(g, M.beltRubber);
  m.castShadow = true;
  return m;
}

export function gt2Pulley(M, teeth = 20, width = 7, axis = 'z') {
  const g = group('pulley');
  const r = (teeth * 2) / (2 * Math.PI);
  const body = new THREE.CylinderGeometry(r, r, width, teeth * 2);
  // flanges
  const fl = new THREE.CylinderGeometry(r + 1.8, r + 1.8, 1, 32);
  const hub = new THREE.CylinderGeometry(r + 1, r + 1, 6, 24);
  const parts = [body, fl.clone().translate(0, width / 2 + 0.5, 0), fl.clone().translate(0, -width / 2 - 0.5, 0), hub.translate(0, -width / 2 - 4, 0)];
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  const m = mesh(merged, M.aluminiumRaw);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  g.add(m);
  g.userData.radius = r;
  return g;
}

// ---------------------------------------------------------------------------
// Lead screw texture (threads) – a normal map with diagonal stripes
// ---------------------------------------------------------------------------
let threadTex = null;
export function threadNormal() {
  if (threadTex) return threadTex;
  const W = 64;
  const H = 64;
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = ((x / W + y / H) % 1 + 1) % 1;
      h[y * W + x] = Math.abs(f - 0.5) * 2;
    }
  }
  threadTex = dataTexture(heightToNormal(h, W, H, 4), W, H);
  return threadTex;
}

export function leadScrew(M, len, d = 8, pitch = 2) {
  const tex = threadNormal().clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, len / pitch);
  const mat = M.steel.clone();
  mat.normalMap = tex;
  mat.normalScale = new THREE.Vector2(1.2, 1.2);
  mat.roughness = 0.28;
  return cyl(d / 2, len, mat, {}, 20);
}

// ---------------------------------------------------------------------------
// Cable / tube along a curve
// ---------------------------------------------------------------------------
export function tube(points, radius, mat, segments = 48, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segments, radius, radial, closed);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Text label plane (canvas texture). Plane faces +Z.
// ---------------------------------------------------------------------------
export function textPlane(text, { w = 60, h = 10, color = '#ffffff', bg = null, font = '600 72px Inter, Arial, sans-serif', align = 'center', px = 512, emissive = false, metalness = 0, roughness = 0.6 } = {}) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.max(16, Math.round((px * h) / w));
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const x = align === 'center' ? c.width / 2 : align === 'left' ? 4 : c.width - 4;
  // auto-fit
  let size = parseInt(font.match(/(\d+)px/)?.[1] || '72', 10);
  while (ctx.measureText(text).width > c.width * 0.96 && size > 8) {
    size -= 2;
    ctx.font = font.replace(/\d+px/, `${size}px`);
  }
  ctx.fillText(text, x, c.height / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: !bg,
    roughness,
    metalness,
    depthWrite: !!bg,
    polygonOffset: true,
    polygonOffsetFactor: -2
  });
  if (emissive) {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = tex;
    mat.emissiveIntensity = 0.6;
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Merge all meshes of a (static) group by material to reduce draw calls.
// Children whose userData.keep === true are left untouched.
// ---------------------------------------------------------------------------
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const toRemove = [];
  root.traverse((o) => {
    if (o === root) return;
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep || o.isSkinnedMesh) return;
    let p = o.parent;
    while (p && p !== root) {
      if (p.userData.keep) return;
      p = p.parent;
    }
    const mat = o.material;
    if (Array.isArray(mat)) return;
    const key = mat.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    let b = buckets.get(key);
    if (!b) {
      b = { mat, geos: [], cast: o.castShadow, receive: o.receiveShadow };
      buckets.set(key, b);
    }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    b.geos.push(g);
    toRemove.push(o);
  });
  for (const o of toRemove) o.parent.remove(o);
  // remove now-empty groups
  const empties = [];
  root.traverse((o) => {
    if (o !== root && !o.isMesh && o.children.length === 0 && !o.userData.keep && o.type === 'Group') empties.push(o);
  });
  for (const e of empties) e.parent && e.parent.remove(e);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    root.add(m);
  }
  return root;
}
