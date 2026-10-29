// Small, fast, seedable noise helpers used for procedural textures.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable 2D value noise with smooth interpolation. period = lattice cells per tile.
export class TileNoise {
  constructor(seed = 1, size = 256) {
    const rnd = mulberry32(seed);
    this.size = size;
    this.values = new Float32Array(size * size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rnd();
  }

  // x, y in lattice units; px, py = period (wraps)
  sample(x, y, px, py) {
    const s = this.size;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const v = this.values;
    const a = v[(y0 % s) * s + (x0 % s)];
    const b = v[(y0 % s) * s + (x1 % s)];
    const c = v[(y1 % s) * s + (x0 % s)];
    const d = v[(y1 % s) * s + (x1 % s)];
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }

  // Fractal sum, tileable over [0,1)^2 when u,v in [0,1)
  fbm(u, v, baseFreqX, baseFreqY, octaves = 4, gain = 0.5) {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    let fx = baseFreqX;
    let fy = baseFreqY;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(u * fx, v * fy, fx, fy);
      norm += amp;
      amp *= gain;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  }
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
