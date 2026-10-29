import * as THREE from 'three';
import { TileNoise, mulberry32, clamp, lerp, smoothstep } from './noise.js';

// ---------------------------------------------------------------------------
// Procedural texture generation (no external image assets needed).
// All generators return tileable textures with sensible defaults.
// ---------------------------------------------------------------------------

let maxAniso = 8;
export function setMaxAnisotropy(v) {
  maxAniso = v;
}

export function dataTexture(data, w, h, { srgb = false, repeat = [1, 1], mipmaps = true } = {}) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

export function heightToNormal(height, w, h, strength = 1) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function grayToRGBA(gray, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(gray[i], 0, 1) * 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Butcher-block style workbench top (glued beech strips). u runs along grain.
// ---------------------------------------------------------------------------
export function woodBlockTextures(seed = 7) {
  const W = 1024;
  const H = 512;
  const strips = 8;
  const n = new TileNoise(seed, 512);
  const rnd = mulberry32(seed * 31);
  const stripTone = [];
  const stripPhase = [];
  for (let i = 0; i < strips; i++) {
    stripTone.push(0.82 + rnd() * 0.3);
    stripPhase.push(rnd() * 10);
  }
  const color = new Uint8Array(W * H * 4);
  const rough = new Float32Array(W * H);
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const sv = v * strips;
    const si = Math.floor(sv);
    const sl = sv - si;
    const tone = stripTone[si];
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = n.fbm(u, v, 3, 24, 3) * 2.2;
      const ring = Math.sin((sl * 9 + stripPhase[si] + warp + u * 0.6) * Math.PI * 2);
      const late = smoothstep(0.55, 0.98, ring);
      const fine = n.fbm(u, v, 64, 128, 2);
      const pores = smoothstep(0.72, 0.9, n.sample(u * 512, v * 1024, 512, 1024)) * 0.5;
      let r = 0.78 * tone;
      let g = 0.58 * tone;
      let b = 0.38 * tone;
      const dark = late * 0.24 + pores * 0.25 + (fine - 0.5) * 0.08;
      r *= 1 - dark;
      g *= 1 - dark * 1.08;
      b *= 1 - dark * 1.15;
      // glue line between strips
      const edge = Math.min(sl, 1 - sl);
      const glue = 1 - smoothstep(0, 0.012, edge) * 1;
      r *= 1 - glue * 0.35;
      g *= 1 - glue * 0.38;
      b *= 1 - glue * 0.4;
      const i = y * W + x;
      color[i * 4] = clamp(r, 0, 1) * 255;
      color[i * 4 + 1] = clamp(g, 0, 1) * 255;
      color[i * 4 + 2] = clamp(b, 0, 1) * 255;
      color[i * 4 + 3] = 255;
      rough[i] = 0.55 + late * 0.12 + pores * 0.2 + (fine - 0.5) * 0.1;
      height[i] = -late * 0.4 - pores * 1.2 - glue * 2 + fine * 0.3;
    }
  }
  return {
    map: dataTexture(color, W, H, { srgb: true }),
    roughnessMap: dataTexture(grayToRGBA(rough, W, H), W, H),
    normalMap: dataTexture(heightToNormal(height, W, H, 1.2), W, H)
  };
}

// ---------------------------------------------------------------------------
// Sealed concrete floor
// ---------------------------------------------------------------------------
export function concreteTextures(seed = 3) {
  const S = 512;
  const n = new TileNoise(seed, 512);
  const color = new Uint8Array(S * S * 4);
  const rough = new Float32Array(S * S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const big = n.fbm(u, v, 4, 4, 4);
      const mid = n.fbm(u, v, 16, 16, 3);
      const speck = smoothstep(0.78, 0.95, n.sample(u * 256, v * 256, 256, 256));
      const base = 0.36 + (big - 0.5) * 0.12 + (mid - 0.5) * 0.06 - speck * 0.06;
      const i = y * S + x;
      color[i * 4] = clamp(base * 0.98, 0, 1) * 255;
      color[i * 4 + 1] = clamp(base * 0.99, 0, 1) * 255;
      color[i * 4 + 2] = clamp(base * 1.02, 0, 1) * 255;
      color[i * 4 + 3] = 255;
      rough[i] = 0.62 + (mid - 0.5) * 0.25 + speck * 0.2;
      height[i] = mid * 0.6 + speck * 0.8;
    }
  }
  return {
    map: dataTexture(color, S, S, { srgb: true }),
    roughnessMap: dataTexture(grayToRGBA(rough, S, S), S, S),
    normalMap: dataTexture(heightToNormal(height, S, S, 1.5), S, S)
  };
}

// ---------------------------------------------------------------------------
// Painted plaster wall (normal map only, tint via material color)
// ---------------------------------------------------------------------------
export function plasterTextures(seed = 11) {
  const S = 512;
  const n = new TileNoise(seed, 512);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const h = n.fbm(u, v, 24, 24, 4, 0.55);
      height[y * S + x] = h;
      rough[y * S + x] = 0.85 + (h - 0.5) * 0.15;
    }
  }
  return {
    normalMap: dataTexture(heightToNormal(height, S, S, 2.0), S, S),
    roughnessMap: dataTexture(grayToRGBA(rough, S, S), S, S)
  };
}

// ---------------------------------------------------------------------------
// Powder-coated textured PEI (golden) spring-steel sheet
// ---------------------------------------------------------------------------
export function texturedPEITextures(seed = 21) {
  const S = 512;
  const n = new TileNoise(seed, 512);
  const color = new Uint8Array(S * S * 4);
  const rough = new Float32Array(S * S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const grains = n.fbm(u, v, 96, 96, 3, 0.6);
      const blotch = n.fbm(u, v, 6, 6, 3);
      const bump = Math.pow(smoothstep(0.35, 0.85, grains), 1.4);
      const i = y * S + x;
      const t = 0.85 + (blotch - 0.5) * 0.12 + bump * 0.18;
      color[i * 4] = clamp(0.66 * t, 0, 1) * 255;
      color[i * 4 + 1] = clamp(0.5 * t, 0, 1) * 255;
      color[i * 4 + 2] = clamp(0.24 * t, 0, 1) * 255;
      color[i * 4 + 3] = 255;
      rough[i] = 0.5 + (1 - bump) * 0.22;
      height[i] = bump;
    }
  }
  return {
    map: dataTexture(color, S, S, { srgb: true }),
    roughnessMap: dataTexture(grayToRGBA(rough, S, S), S, S),
    normalMap: dataTexture(heightToNormal(height, S, S, 2.6), S, S)
  };
}

// ---------------------------------------------------------------------------
// Brushed / bead-blasted metal (roughness + normal), direction along u
// ---------------------------------------------------------------------------
export function brushedTextures(seed = 5, { streak = true } = {}) {
  const S = 512;
  const n = new TileNoise(seed, 512);
  const rough = new Float32Array(S * S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const s = streak ? n.fbm(u, v, 2, 256, 3, 0.6) : n.fbm(u, v, 128, 128, 3, 0.6);
      height[y * S + x] = s;
      rough[y * S + x] = 0.32 + (s - 0.5) * 0.18;
    }
  }
  return {
    roughnessMap: dataTexture(grayToRGBA(rough, S, S), S, S),
    normalMap: dataTexture(heightToNormal(height, S, S, streak ? 0.6 : 0.9), S, S)
  };
}

// ---------------------------------------------------------------------------
// Fine plastic texture (slight orange-peel), used for printed parts / housings
// ---------------------------------------------------------------------------
export function plasticNormal(seed = 13, strength = 1.3, freq = 48) {
  const S = 256;
  const n = new TileNoise(seed, 256);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      height[y * S + x] = n.fbm(x / S, y / S, freq, freq, 2, 0.5);
    }
  }
  return dataTexture(heightToNormal(height, S, S, strength), S, S);
}

// FDM printed-part surface: horizontal layer lines (v direction = up)
export function layerLineNormal(lines = 64, strength = 1.6) {
  const W = 64;
  const H = 256;
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const p = (y / H) * lines;
    const f = p - Math.floor(p);
    const hh = Math.sqrt(Math.max(0, 1 - Math.pow(f * 2 - 1, 2)));
    for (let x = 0; x < W; x++) height[y * W + x] = hh;
  }
  return dataTexture(heightToNormal(height, W, H, strength), W, H);
}

// ---------------------------------------------------------------------------
// Aluminium honeycomb laser bed (top view). One tile = repeat unit.
// ---------------------------------------------------------------------------
export function honeycombTextures() {
  const W = 512; // 8 cells across
  const H = 448; // 8 rows (rows alternate offset -> tileable)
  const cell = 64; // px across flats
  const color = new Uint8Array(W * H * 4);
  const height = new Float32Array(W * H);
  const rough = new Float32Array(W * H);
  const r = cell / 2;
  const rowSpacing = H / 8;
  const hexH = rowSpacing / 0.75;
  const colSpacing = cell;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // nearest hex center (pointy-top)
      let best = 1e9;
      for (let row = -1; row <= Math.ceil(H / rowSpacing) + 1; row++) {
        const cy = row * rowSpacing;
        if (Math.abs(cy - y) > hexH) continue;
        const off = (row & 1) * (colSpacing / 2);
        const col = Math.round((x - off) / colSpacing);
        for (let c = col - 1; c <= col + 1; c++) {
          const cx = c * colSpacing + off;
          const dx = Math.abs(x - cx);
          const dy = Math.abs(y - cy);
          // hex distance (pointy-top)
          const d = Math.max(dx, dx * 0.5 + dy * 0.8660254);
          if (d < best) best = d;
        }
      }
      const wall = smoothstep(r - 3.5, r - 1.0, best);
      const depth = 1 - wall;
      const i = y * W + x;
      const shade = lerp(0.06 + (1 - best / r) * 0.04, 0.72, wall);
      color[i * 4] = shade * 255;
      color[i * 4 + 1] = shade * 255;
      color[i * 4 + 2] = shade * 1.03 * 255;
      color[i * 4 + 3] = 255;
      height[i] = -depth * 3;
      rough[i] = lerp(0.9, 0.38, wall);
    }
  }
  return {
    map: dataTexture(color, W, H, { srgb: true }),
    normalMap: dataTexture(heightToNormal(height, W, H, 1.0), W, H),
    roughnessMap: dataTexture(grayToRGBA(rough, W, H), W, H)
  };
}

// ---------------------------------------------------------------------------
// Pegboard: color + alpha holes
// ---------------------------------------------------------------------------
export function pegboardTextures() {
  const S = 256; // one tile = 4x4 holes
  const color = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  const n = new TileNoise(41, 256);
  const pitch = S / 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = (Math.floor(x / pitch) + 0.5) * pitch;
      const cy = (Math.floor(y / pitch) + 0.5) * pitch;
      const d = Math.hypot(x - cx, y - cy);
      const hole = d < 7.5;
      const i = y * S + x;
      const v = 0.86 + (n.fbm(x / S, y / S, 32, 32, 2) - 0.5) * 0.06;
      color[i * 4] = v * 0.93 * 255;
      color[i * 4 + 1] = v * 0.93 * 255;
      color[i * 4 + 2] = v * 0.9 * 255;
      color[i * 4 + 3] = hole ? 0 : 255;
      height[i] = hole ? -1 : smoothstep(7.5, 10, d) * 0.4;
    }
  }
  return {
    map: dataTexture(color, S, S, { srgb: true }),
    normalMap: dataTexture(heightToNormal(height, S, S, 1.5), S, S)
  };
}

// ---------------------------------------------------------------------------
// Laser-cut materials (plywood, cardboard, leather, slate, acrylic, anodized)
// Returns an RGBA color array (sRGB) at the requested resolution.
// ---------------------------------------------------------------------------
export function materialSurface(kind, W, H, seed = 3) {
  const n = new TileNoise(seed, 512);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let r = 0.5;
      let g = 0.5;
      let b = 0.5;
      if (kind === 'plywood') {
        const warp = n.fbm(u, v, 2, 6, 3) * 3;
        const ring = Math.sin((v * 14 + warp + u * 0.5) * Math.PI * 2);
        const late = smoothstep(0.45, 1, ring);
        const fine = n.fbm(u, v, 48, 160, 2);
        const t = 0.94 + (n.fbm(u, v, 3, 3, 3) - 0.5) * 0.12;
        r = (0.86 - late * 0.1 + (fine - 0.5) * 0.05) * t;
        g = (0.72 - late * 0.11 + (fine - 0.5) * 0.05) * t;
        b = (0.52 - late * 0.12 + (fine - 0.5) * 0.04) * t;
      } else if (kind === 'mdf') {
        const f = n.fbm(u, v, 64, 64, 3);
        r = 0.62 + (f - 0.5) * 0.05;
        g = 0.47 + (f - 0.5) * 0.05;
        b = 0.32 + (f - 0.5) * 0.04;
      } else if (kind === 'cardboard') {
        const f = n.fbm(u, v, 96, 24, 3);
        const fib = n.fbm(u, v, 256, 64, 1);
        r = 0.66 + (f - 0.5) * 0.06 + (fib - 0.5) * 0.04;
        g = 0.52 + (f - 0.5) * 0.05 + (fib - 0.5) * 0.03;
        b = 0.36 + (f - 0.5) * 0.04;
      } else if (kind === 'leather') {
        const f = n.fbm(u, v, 80, 80, 4, 0.6);
        const crease = smoothstep(0.62, 0.7, n.fbm(u, v, 24, 24, 2));
        r = 0.55 + (f - 0.5) * 0.08 - crease * 0.05;
        g = 0.33 + (f - 0.5) * 0.06 - crease * 0.04;
        b = 0.19 + (f - 0.5) * 0.04 - crease * 0.03;
      } else if (kind === 'slate') {
        const f = n.fbm(u, v, 6, 10, 5, 0.55);
        const streaks = n.fbm(u, v, 2, 40, 3);
        r = 0.16 + (f - 0.5) * 0.06 + (streaks - 0.5) * 0.03;
        g = 0.17 + (f - 0.5) * 0.06 + (streaks - 0.5) * 0.03;
        b = 0.19 + (f - 0.5) * 0.06 + (streaks - 0.5) * 0.03;
      } else if (kind === 'acrylic') {
        const f = n.fbm(u, v, 8, 8, 2);
        r = g = b = 0.025 + (f - 0.5) * 0.008;
      } else if (kind === 'anodized') {
        const f = n.fbm(u, v, 2, 200, 2);
        r = 0.08 + (f - 0.5) * 0.02;
        g = 0.12 + (f - 0.5) * 0.02;
        b = 0.3 + (f - 0.5) * 0.03;
      }
      const i = (y * W + x) * 4;
      out[i] = clamp(r, 0, 1) * 255;
      out[i + 1] = clamp(g, 0, 1) * 255;
      out[i + 2] = clamp(b, 0, 1) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// Canvas helper for labels / decals
export function canvasTexture(w, h, draw, { srgb = true, anisotropy = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (anisotropy) tex.anisotropy = maxAniso;
  return tex;
}
