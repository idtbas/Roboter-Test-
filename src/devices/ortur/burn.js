import * as THREE from 'three';
import { materialSurface, dataTexture } from '../../core/textures.js';

// ---------------------------------------------------------------------------
// Laser workpieces + physically motivated burn model.
// Energy density E [J/mm²] accumulates per pixel.
//   discolouration: 1 - exp(-(E - th) / scale)
//   material removal starts at `ablate`, depth = (E - ablate) * depthK [mm]
//   cut through when depth >= thickness
// ---------------------------------------------------------------------------

export const LASER_MATERIALS = [
  {
    id: 'plywood', name: 'Pappelsperrholz 3 mm', w: 300, h: 200, t: 3, surface: 'plywood', edge: 0xc9a77a,
    th: 0.12, scale: 0.6, char: [0.15, 0.075, 0.03], ablate: 0.8, depthK: 0.105, smoke: 1, embers: true,
    presets: { line: { speed: 1500, power: 60 }, fill: { speed: 3000, power: 50, interval: 0.1 }, image: { speed: 3000, power: 55, interval: 0.1 }, cut: { speed: 300, power: 100, passes: 3 } }
  },
  {
    id: 'mdf', name: 'MDF 3 mm', w: 300, h: 200, t: 3, surface: 'mdf', edge: 0x8f6c4a,
    th: 0.1, scale: 0.5, char: [0.1, 0.055, 0.025], ablate: 0.7, depthK: 0.09, smoke: 1.3, embers: true,
    presets: { line: { speed: 1500, power: 60 }, fill: { speed: 3000, power: 45, interval: 0.1 }, image: { speed: 3000, power: 50, interval: 0.1 }, cut: { speed: 250, power: 100, passes: 4 } }
  },
  {
    id: 'cardboard', name: 'Graupappe 2 mm', w: 297, h: 210, t: 2, surface: 'cardboard', edge: 0x9a8162,
    th: 0.06, scale: 0.35, char: [0.12, 0.08, 0.05], ablate: 0.35, depthK: 0.16, smoke: 0.8, embers: true,
    presets: { line: { speed: 3000, power: 40 }, fill: { speed: 6000, power: 30, interval: 0.12 }, image: { speed: 6000, power: 30, interval: 0.12 }, cut: { speed: 600, power: 100, passes: 1 } }
  },
  {
    id: 'leather', name: 'Leder 2 mm (pflanzlich gegerbt)', w: 200, h: 150, t: 2, surface: 'leather', edge: 0x6b4026,
    th: 0.1, scale: 0.55, char: [0.09, 0.05, 0.03], ablate: 0.9, depthK: 0.06, smoke: 0.9, embers: false,
    presets: { line: { speed: 2000, power: 40 }, fill: { speed: 4000, power: 30, interval: 0.1 }, image: { speed: 4000, power: 35, interval: 0.1 }, cut: { speed: 400, power: 100, passes: 2 } }
  },
  {
    id: 'acrylic', name: 'Acryl schwarz 3 mm', w: 300, h: 200, t: 3, surface: 'acrylic', edge: 0x101010,
    th: 0.35, scale: 0.6, char: [0.55, 0.55, 0.56], ablate: 0.6, depthK: 0.09, smoke: 0.5, embers: false, glossy: true,
    presets: { line: { speed: 1000, power: 80 }, fill: { speed: 2000, power: 70, interval: 0.1 }, image: { speed: 2000, power: 70, interval: 0.1 }, cut: { speed: 120, power: 100, passes: 4 } }
  },
  {
    id: 'slate', name: 'Schiefer-Untersetzer 100×100', w: 100, h: 100, t: 5, surface: 'slate', edge: 0x2a2b2e,
    th: 0.25, scale: 0.7, char: [0.78, 0.78, 0.76], ablate: 99, depthK: 0, smoke: 0.2, embers: false, noCut: true,
    presets: { line: { speed: 1500, power: 80 }, fill: { speed: 3000, power: 70, interval: 0.1 }, image: { speed: 3000, power: 70, interval: 0.1 }, cut: { speed: 300, power: 100, passes: 1 } }
  },
  {
    id: 'anodized', name: 'Eloxierte Alu-Visitenkarte', w: 85, h: 54, t: 0.8, surface: 'anodized', edge: 0x1d2c5e,
    th: 0.45, scale: 0.5, char: [0.86, 0.87, 0.89], ablate: 99, depthK: 0, smoke: 0.1, embers: false, noCut: true, metal: true,
    presets: { line: { speed: 1000, power: 100 }, fill: { speed: 1500, power: 100, interval: 0.08 }, image: { speed: 1500, power: 100, interval: 0.08 }, cut: { speed: 300, power: 100, passes: 1 } }
  }
];

export class Workpiece {
  constructor(def, X0, Y0, bedTop) {
    this.def = def;
    this.X0 = X0;
    this.Y0 = Y0;
    this.bedTop = bedTop;
    this.topY = bedTop + def.t;
    const px = Math.max(0.1, Math.max(def.w, def.h) / 2400);
    this.px = px;
    this.W = Math.ceil(def.w / px);
    this.H = Math.ceil(def.h / px);
    this.E = new Float32Array(this.W * this.H);
    this.data = new Uint8Array(this.W * this.H * 4);
    for (let i = 0; i < this.W * this.H; i++) {
      this.data[i * 4 + 1] = 255; // alpha (G): solid
      this.data[i * 4 + 3] = 255;
    }
    this.cutPixels = 0;
    this.burnedPixels = 0;
    this.dirty = null;
    this.kernelCache = new Map();
    this.buildMesh();
  }

  buildMesh() {
    const d = this.def;
    // base surface texture (sRGB colour)
    const sW = Math.min(1024, Math.round(d.w * 3));
    const sH = Math.min(1024, Math.round(d.h * 3));
    const surf = materialSurface(d.surface, sW, sH, 7 + d.id.length);
    this.surfaceTex = dataTexture(surf, sW, sH, { srgb: true });
    // burn texture on GPU + a CPU staging texture sharing the same array
    this.burnTex = new THREE.DataTexture(this.data, this.W, this.H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.burnTex.generateMipmaps = true;
    this.burnTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.burnTex.magFilter = THREE.LinearFilter;
    this.burnTex.anisotropy = 8;
    this.burnTex.needsUpdate = true;
    this.staging = new THREE.DataTexture(this.data, this.W, this.H, THREE.RGBAFormat, THREE.UnsignedByteType);

    const top = new THREE.MeshPhysicalMaterial({
      map: this.surfaceTex,
      roughness: d.glossy ? 0.08 : d.metal ? 0.35 : d.id === 'slate' ? 0.75 : 0.82,
      metalness: d.metal ? 0.85 : 0,
      clearcoat: d.glossy ? 1 : 0,
      bumpMap: this.burnTex,
      bumpScale: -2.5,
      alphaMap: this.burnTex,
      alphaTest: 0.5
    });
    const charColor = new THREE.Color().setRGB(d.char[0], d.char[1], d.char[2], THREE.SRGBColorSpace);
    top.onBeforeCompile = (shader) => {
      shader.uniforms.burnMap = { value: this.burnTex };
      shader.uniforms.charColor = { value: charColor };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D burnMap;\nuniform vec3 charColor;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float burnAmt = texture2D( burnMap, vMapUv ).r;
          diffuseColor.rgb = mix( diffuseColor.rgb, charColor, burnAmt );`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix( roughnessFactor, 0.9, texture2D( burnMap, vMapUv ).r );`
        );
    };
    top.customProgramCacheKey = () => `burn-${d.id}`;
    const side = new THREE.MeshStandardMaterial({ color: d.edge, roughness: 0.7, metalness: d.metal ? 0.8 : 0 });
    const bottom = new THREE.MeshStandardMaterial({ color: d.edge, roughness: 0.9 });
    const geo = new THREE.BoxGeometry(d.w, d.t, d.h);
    this.mesh = new THREE.Mesh(geo, [side, side, top, bottom, side, side]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.topMat = top;
  }

  // device-local placement for a machine origin mapping
  place(mapX, mapZ) {
    const d = this.def;
    this.mesh.position.set(mapX(this.X0 + d.w / 2), this.bedTop + d.t / 2, mapZ(this.Y0 + d.h / 2));
  }

  contains(X, Y) {
    return X >= this.X0 && X <= this.X0 + this.def.w && Y >= this.Y0 && Y <= this.Y0 + this.def.h;
  }

  kernel(sigmaPx) {
    const key = Math.round(sigmaPx * 20);
    let k = this.kernelCache.get(key);
    if (k) return k;
    const s = Math.max(0.35, key / 20);
    const r = Math.max(1, Math.ceil(s * 2.5));
    const size = r * 2 + 1;
    const w = new Float32Array(size * size);
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const v = Math.exp(-(x * x + y * y) / (2 * s * s));
        w[(y + r) * size + (x + r)] = v;
        sum += v;
      }
    }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    k = { r, size, w };
    this.kernelCache.set(key, k);
    return k;
  }

  // Deposit `joules` at machine position (X,Y) with gaussian spot of diameter spotMm
  deposit(X, Y, joules, spotMm) {
    const px = this.px;
    const fx = (X - this.X0) / px - 0.5;
    const fy = (Y - this.Y0) / px - 0.5;
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    // gaussian spot widened by the heat-affected zone (~0.07 mm)
    const k = this.kernel(Math.max(spotMm / 2 / px / 1.2, 0.07 / px));
    if (cx < -k.r || cy < -k.r || cx > this.W + k.r || cy > this.H + k.r) return 0;
    const area = px * px;
    const ePer = joules / area;
    const d = this.def;
    const W = this.W;
    let maxE = 0;
    for (let j = -k.r; j <= k.r; j++) {
      const y = cy + j;
      if (y < 0 || y >= this.H) continue;
      for (let i = -k.r; i <= k.r; i++) {
        const x = cx + i;
        if (x < 0 || x >= W) continue;
        const idx = y * W + x;
        const e = this.E[idx] + ePer * k.w[(j + k.r) * k.size + (i + k.r)];
        this.E[idx] = e;
        if (e > maxE) maxE = e;
        // update texel
        const c = e > d.th ? 1 - Math.exp(-(e - d.th) / d.scale) : 0;
        const o = idx * 4;
        const cb = Math.min(255, Math.round(c * 255));
        if (cb !== this.data[o]) {
          if (this.data[o] < 30 && cb >= 30) this.burnedPixels++;
          this.data[o] = cb;
        }
        if (!d.noCut && e > d.ablate && this.data[o + 1] === 255) {
          const depth = (e - d.ablate) * d.depthK;
          if (depth >= d.t) {
            this.data[o + 1] = 0;
            this.cutPixels++;
          }
        }
      }
    }
    // dirty rect
    const x0 = Math.max(0, cx - k.r);
    const x1 = Math.min(W, cx + k.r + 1);
    const y0 = Math.max(0, cy - k.r);
    const y1 = Math.min(this.H, cy + k.r + 1);
    if (x1 > x0 && y1 > y0) {
      if (!this.dirty) this.dirty = { x0, x1, y0, y1 };
      else {
        const r = this.dirty;
        if (x0 < r.x0) r.x0 = x0;
        if (x1 > r.x1) r.x1 = x1;
        if (y0 < r.y0) r.y0 = y0;
        if (y1 > r.y1) r.y1 = y1;
      }
    }
    return maxE;
  }

  // Upload dirty region to the GPU
  flush(renderer) {
    if (!this.dirty) return;
    if (!this.gpuReady) {
      renderer.initTexture(this.burnTex);
      this.gpuReady = true;
      this.dirty = null;
      return;
    }
    const r = this.dirty;
    this.dirty = null;
    const box = new THREE.Box2(new THREE.Vector2(r.x0, r.y0), new THREE.Vector2(r.x1, r.y1));
    renderer.copyTextureToTexture(this.staging, this.burnTex, box, new THREE.Vector2(r.x0, r.y0));
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.surfaceTex.dispose();
    this.burnTex.dispose();
    for (const m of this.mesh.material) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Smoke particle system (soft sprites rising from the burn spot)
// ---------------------------------------------------------------------------
export class Smoke {
  constructor(parent, count = 220) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const tex = smokeTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, color: { value: new THREE.Color(0xc9c4bc) }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA); if (gl_FragColor.a < 0.003) discard; }`,
      transparent: true,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.userData.noPick = true;
    this.points.raycast = () => {};
    parent.add(this.points);
    this.embers = new EmberSystem(parent);
  }

  emit(x, y, z, rate, dt, air) {
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 1.5;
      this.pos[i * 3 + 1] = y + 0.5;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.5;
      this.vel[i * 3] = (Math.random() - 0.5) * 12 + (air ? 30 : 0);
      this.vel[i * 3 + 1] = 25 + Math.random() * 30;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 12 + (air ? -20 : 0);
      this.life[i] = 1;
      this.size[i] = 3;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      any = true;
      this.life[i] -= dt * 0.55;
      const k = i * 3;
      this.vel[k] += (Math.random() - 0.5) * 40 * dt;
      this.vel[k + 2] += (Math.random() - 0.5) * 40 * dt;
      this.vel[k + 1] *= 1 - 0.3 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += dt * 22;
      const l = this.life[i];
      this.alpha[i] = Math.max(0, Math.min(1, (1 - l) * 6) * l * 0.32);
    }
    const g = this.points.geometry;
    if (any || this.wasAny) {
      g.attributes.position.needsUpdate = true;
      g.attributes.size.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
    }
    this.wasAny = any;
    this.embers.update(dt);
  }
}

class EmberSystem {
  constructor(parent, count = 80) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.col = new Float32Array(count * 3);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 1.4, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    parent.add(this.points);
  }

  emit(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y + 0.3;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * 60;
      this.vel[i * 3 + 1] = 20 + Math.random() * 50;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.life[i] = 0.25 + Math.random() * 0.3;
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[k + 1] -= 120 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const l = Math.max(0, this.life[i]) * 3;
      this.col[k] = 2.6 * l;
      this.col[k + 1] = 1.1 * l;
      this.col[k + 2] = 0.25 * l;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

function smokeTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
