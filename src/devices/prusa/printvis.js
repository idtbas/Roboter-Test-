import * as THREE from 'three';

// Real-time visualisation of extruded plastic. Each extrusion move becomes an
// instance of a rounded "bead" profile scaled to its length/width/height.
// Coordinates are printer coordinates mapped into the print anchor:
//   local x = X, local y = Z, local z = -Y

const CHUNK = 32768;

function beadGeometry() {
  // cross-section: 10-gon ellipse in (z,y), width 1 (z in [-0.5,0.5]), height 1 (y in [-1,0])
  const N = 10;
  const prof = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // squarer ellipse (superellipse exponent) – flattened top/bottom like real extrudate
    const sz = Math.sign(c) * Math.pow(Math.abs(c), 0.75) * 0.5;
    const sy = Math.sign(s) * Math.pow(Math.abs(s), 0.85) * 0.5 - 0.5;
    prof.push({ z: sz, y: sy, nz: c, ny: s });
  }
  const pos = [];
  const nor = [];
  const idx = [];
  // side walls along x from 0..1
  for (let i = 0; i < N; i++) {
    const p = prof[i];
    pos.push(0, p.y, p.z, 1, p.y, p.z);
    const l = Math.hypot(p.nz, p.ny * 2);
    nor.push(0, (p.ny * 2) / l, p.nz / l, 0, (p.ny * 2) / l, p.nz / l);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    const b = ((i + 1) % N) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  // end caps
  const base = pos.length / 3;
  for (const x of [0, 1]) {
    const c0 = pos.length / 3;
    pos.push(x, -0.5, 0);
    nor.push(x ? 1 : -1, 0, 0);
    for (let i = 0; i < N; i++) {
      pos.push(x, prof[i].y, prof[i].z);
      nor.push(x ? 1 : -1, 0, 0);
    }
    for (let i = 0; i < N; i++) {
      const a = c0 + 1 + i;
      const b = c0 + 1 + ((i + 1) % N);
      if (x) idx.push(c0, b, a);
      else idx.push(c0, a, b);
    }
  }
  void base;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // fix winding so outer faces point outwards
  return g;
}

export class PrintVisualizer {
  constructor(parent) {
    this.parent = parent;
    this.root = new THREE.Group();
    this.root.name = 'printed-part';
    parent.add(this.root);
    this.geo = beadGeometry();
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35
    });
    this.chunks = [];
    this.count = 0;
    this.color = new THREE.Color(0xff7a2f);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 1, 0);
    this.partial = new THREE.Mesh(this.geo, this.material.clone());
    this.partial.visible = false;
    this.partial.castShadow = true;
    this.partial.raycast = () => {};
    this.root.add(this.partial);
    this.dirty = new Set();
    this.bounds = new THREE.Box3();
    this.bounds.makeEmpty();
    this.segments = 0;
  }

  setColor(hex) {
    this.color.set(hex);
    this.partial.material.color.copy(this.color);
  }

  newChunk() {
    const m = new THREE.InstancedMesh(this.geo, this.material, CHUNK);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.raycast = () => {};
    m.userData.noPick = true;
    // allocate color buffer
    m.setColorAt(0, this.color);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.root.add(m);
    this.chunks.push(m);
    return m;
  }

  composeMatrix(x0, y0, z0, x1, y1, z1, w, h, out) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const yaw = Math.atan2(-dz, dx);
    this._q.setFromAxisAngle(this._axis, yaw);
    const ext = Math.min(w * 0.5, 0.3);
    const ux = dx / len;
    const uz = dz / len;
    this._p.set(x0 - ux * ext, Math.max(y0, y1), z0 - uz * ext);
    this._s.set(len + ext * 2, h, w);
    out.compose(this._p, this._q, this._s);
    return true;
  }

  // add a completed extrusion segment (printer coords)
  addSegment(X0, Y0, Z0, X1, Y1, Z1, w, h) {
    if (!this.composeMatrix(X0, Z0, -Y0, X1, Z1, -Y1, w, h, this._m)) return;
    let chunk = this.chunks[this.chunks.length - 1];
    if (!chunk || chunk.count >= CHUNK) chunk = this.newChunk();
    const i = chunk.count++;
    chunk.setMatrixAt(i, this._m);
    chunk.setColorAt(i, this.color);
    if (chunk._dirtyStart === undefined || chunk._dirtyStart > i) chunk._dirtyStart = i;
    chunk._dirtyEnd = i + 1;
    this.dirty.add(chunk);
    this.count++;
    this.segments++;
    this.bounds.expandByPoint(this._p.set(X0, Z0, -Y0));
    this.bounds.expandByPoint(this._p.set(X1, Z1, -Y1));
  }

  setPartial(X0, Y0, Z0, X1, Y1, Z1, w, h) {
    if (!this.composeMatrix(X0, Z0, -Y0, X1, Z1, -Y1, w, h, this._m)) {
      this.partial.visible = false;
      return;
    }
    this.partial.matrixAutoUpdate = false;
    this.partial.matrix.copy(this._m);
    this.partial.visible = true;
  }

  hidePartial() {
    this.partial.visible = false;
  }

  flush() {
    for (const c of this.dirty) {
      const s = c._dirtyStart;
      const e = c._dirtyEnd;
      c.instanceMatrix.clearUpdateRanges();
      c.instanceMatrix.addUpdateRange(s * 16, (e - s) * 16);
      c.instanceMatrix.needsUpdate = true;
      c.instanceColor.clearUpdateRanges();
      c.instanceColor.addUpdateRange(s * 3, (e - s) * 3);
      c.instanceColor.needsUpdate = true;
      c._dirtyStart = undefined;
    }
    this.dirty.clear();
  }

  clear() {
    for (const c of this.chunks) {
      this.root.remove(c);
      c.dispose();
    }
    this.chunks = [];
    this.count = 0;
    this.partial.visible = false;
    this.bounds.makeEmpty();
  }

  get isEmpty() {
    return this.count === 0;
  }

  // Detach the printed object (e.g. after removal from the sheet).
  // Returns a group containing the instanced meshes; the visualiser is reset.
  detach() {
    const g = new THREE.Group();
    for (const c of this.chunks) {
      this.root.remove(c);
      g.add(c);
    }
    this.chunks = [];
    this.count = 0;
    this.partial.visible = false;
    const b = this.bounds.clone();
    this.bounds.makeEmpty();
    g.userData.bounds = b;
    return g;
  }
}
