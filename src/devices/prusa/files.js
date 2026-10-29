// USB drive contents + G-code metadata/thumbnail parsing (PrusaSlicer
// compatible), including binary G-code (.bgcode: deflate / heatshrink /
// MeatPack) as written by PrusaSlicer for the MK4/MK4S.

export class UsbDrive {
  constructor() {
    this.inserted = true;
    this.files = [];
    this.listeners = new Set();
  }

  add(file) {
    const i = this.files.findIndex((f) => f.name === file.name);
    if (i >= 0) this.files.splice(i, 1, file);
    else this.files.push(file);
    this.changed();
  }

  remove(file) {
    this.files = this.files.filter((f) => f !== file);
    this.changed();
  }

  changed() {
    for (const l of this.listeners) l();
  }
}

// --------------------------------------------------------------- parsing
function parseDuration(s) {
  // "1d 2h 3m 4s"
  let t = 0;
  const re = /(\d+)\s*([dhms])/g;
  let m;
  while ((m = re.exec(s))) t += +m[1] * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
  return t;
}

function applyKV(meta, k, v) {
  k = k.trim();
  v = v.trim();
  if (k === 'estimated printing time (normal mode)') meta.time = parseDuration(v);
  else if (k === 'filament used [mm]') meta.filamentM = parseFloat(v) / 1000;
  else if (k === 'filament used [g]') meta.filamentG = parseFloat(v);
  else if (k === 'filament_type') meta.material = v.split(';')[0];
  else if (k === 'printer_model') meta.printerModel = v;
  else if (k === 'nozzle_diameter') meta.nozzle = parseFloat(v.split(',')[0]);
  else if (k === 'layer_height') meta.layerHeight = parseFloat(v);
  else if (k === 'max_layer_z') meta.height = parseFloat(v);
}

export function parseGcodeText(text) {
  const meta = {};
  const thumbs = [];
  const head = text.length > 600000 ? text.slice(0, 600000) : text;
  // thumbnails
  const re = /^; (thumbnail(?:_(QOI|JPG|PNG))?) begin (\d+)x(\d+) \d+\s*$([\s\S]*?)^; \1 end/gm;
  let m;
  while ((m = re.exec(head))) {
    const data = m[5].replace(/^;\s?/gm, '').replace(/\s+/g, '');
    thumbs.push({ format: (m[2] || 'PNG').toUpperCase(), w: +m[3], h: +m[4], data });
  }
  // metadata comments (usually at the end)
  const tail = text.length > 120000 ? text.slice(-120000) : text;
  for (const part of [tail, head.slice(0, 20000)]) {
    const kv = /^;\s*([^=\n]+?)\s*=\s*(.*)$/gm;
    while ((m = kv.exec(part))) applyKV(meta, m[1], m[2]);
  }
  if (!meta.printerModel) {
    const mm = head.match(/M862\.3 P\s*"([^"]+)"/);
    if (mm) meta.printerModel = mm[1];
  }
  return { meta, thumbs };
}

// QOI image decoder -> ImageData
export function decodeQOI(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x716f6966) throw new Error('not qoi');
  const w = dv.getUint32(4);
  const h = dv.getUint32(8);
  const out = new Uint8ClampedArray(w * h * 4);
  const index = new Uint8Array(64 * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;
  let p = 14;
  let run = 0;
  for (let px = 0; px < w * h * 4; px += 4) {
    if (run > 0) run--;
    else if (p < bytes.length - 8) {
      const b1 = bytes[p++];
      if (b1 === 0xfe) {
        r = bytes[p++];
        g = bytes[p++];
        b = bytes[p++];
      } else if (b1 === 0xff) {
        r = bytes[p++];
        g = bytes[p++];
        b = bytes[p++];
        a = bytes[p++];
      } else if ((b1 & 0xc0) === 0x00) {
        const i = b1 * 4;
        r = index[i];
        g = index[i + 1];
        b = index[i + 2];
        a = index[i + 3];
      } else if ((b1 & 0xc0) === 0x40) {
        r = (r + ((b1 >> 4) & 3) - 2) & 255;
        g = (g + ((b1 >> 2) & 3) - 2) & 255;
        b = (b + (b1 & 3) - 2) & 255;
      } else if ((b1 & 0xc0) === 0x80) {
        const b2 = bytes[p++];
        const vg = (b1 & 0x3f) - 32;
        r = (r + vg - 8 + ((b2 >> 4) & 0x0f)) & 255;
        g = (g + vg) & 255;
        b = (b + vg - 8 + (b2 & 0x0f)) & 255;
      } else if ((b1 & 0xc0) === 0xc0) run = b1 & 0x3f;
      const hi = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;
      index[hi] = r;
      index[hi + 1] = g;
      index[hi + 2] = b;
      index[hi + 3] = a;
    }
    out[px] = r;
    out[px + 1] = g;
    out[px + 2] = b;
    out[px + 3] = a;
  }
  return new ImageData(out, w, h);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Create an image (canvas or HTMLImageElement) for the best thumbnail
export function thumbToImage(thumbs) {
  if (!thumbs || !thumbs.length) return null;
  // prefer ~313x173 / 440x240 (MK4 sizes)
  const sorted = thumbs.slice().sort((a, b) => Math.abs(a.w - 320) - Math.abs(b.w - 320));
  for (const t of sorted) {
    try {
      if (t.format === 'QOI') {
        const bytes = t.bytes || b64ToBytes(t.data);
        const img = decodeQOI(bytes);
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0);
        return c;
      }
      const img = new Image();
      const mime = t.format === 'JPG' ? 'image/jpeg' : 'image/png';
      if (t.bytes) img.src = URL.createObjectURL(new Blob([t.bytes], { type: mime }));
      else img.src = `data:${mime};base64,${t.data}`;
      return img;
    } catch (e) {
      console.warn('thumbnail decode failed', e);
    }
  }
  return null;
}

// --------------------------------------------------------------- bgcode
function heatshrinkDecode(input, wBits, lBits, expected) {
  const out = new Uint8Array(expected);
  let o = 0;
  let bytePos = 0;
  let bitPos = 0;
  const total = input.length * 8;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (bytePos * 8 + bitPos >= total) return -1;
      const bit = (input[bytePos] >> (7 - bitPos)) & 1;
      v = (v << 1) | bit;
      bitPos++;
      if (bitPos === 8) {
        bitPos = 0;
        bytePos++;
      }
    }
    return v;
  };
  while (o < expected) {
    const tag = readBits(1);
    if (tag < 0) break;
    if (tag === 1) {
      const c = readBits(8);
      if (c < 0) break;
      out[o++] = c;
    } else {
      const idx = readBits(wBits);
      if (idx < 0) break;
      const cnt = readBits(lBits);
      if (cnt < 0) break;
      const off = idx + 1;
      const n = cnt + 1;
      for (let i = 0; i < n && o < expected; i++) {
        out[o] = out[o - off];
        o++;
      }
    }
  }
  return out.subarray(0, o);
}

const MP_TABLE = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ' ', '\n', 'G', 'X'];

function meatpackDecode(input) {
  let out = '';
  const parts = [];
  let active = false;
  let noSpaces = false;
  let cmdCount = 0;
  let cmdNext = false;
  let fullCount = 0;
  let second = 0;
  const getChar = (n) => (n === 11 && noSpaces ? 'E' : MP_TABLE[n]);
  const emit = (c) => {
    out += c;
    if (out.length > 65536) {
      parts.push(out);
      out = '';
    }
  };
  const inner = (c) => {
    if (!active) {
      emit(String.fromCharCode(c));
      return;
    }
    if (!fullCount) {
      const lo = c & 0xf;
      const hi = (c >> 4) & 0xf;
      const firstLit = lo === 0xf;
      const secondLit = hi === 0xf;
      if (firstLit) {
        fullCount++;
        if (secondLit) fullCount++;
        else second = getChar(hi);
      } else {
        const c1 = getChar(lo);
        emit(c1);
        if (c1 !== '\n') {
          if (secondLit) fullCount++;
          else emit(getChar(hi));
        }
      }
    } else {
      emit(String.fromCharCode(c));
      if (second) {
        emit(second);
        second = 0;
      }
      fullCount--;
    }
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === 0xff) {
      if (cmdCount) {
        cmdNext = true;
        cmdCount = 0;
      } else cmdCount = 1;
      continue;
    }
    if (cmdNext) {
      if (c === 0xfb) active = true;
      else if (c === 0xfa) active = false;
      else if (c === 0xf9) {
        active = false;
        noSpaces = false;
      } else if (c === 0xf7) noSpaces = true;
      else if (c === 0xf6) noSpaces = false;
      cmdNext = false;
      continue;
    }
    if (cmdCount) {
      inner(0xff);
      cmdCount = 0;
    }
    inner(c);
  }
  parts.push(out);
  return parts.join('');
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseBgcode(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x45444347) throw new Error('Keine gültige .bgcode-Datei');
  const checksumType = dv.getUint16(8, true);
  let p = 10;
  const meta = {};
  const thumbs = [];
  const gcodeParts = [];
  const td = new TextDecoder();
  while (p + 8 <= bytes.length) {
    const type = dv.getUint16(p, true);
    const comp = dv.getUint16(p + 2, true);
    const usize = dv.getUint32(p + 4, true);
    let csize = usize;
    p += 8;
    if (comp !== 0) {
      csize = dv.getUint32(p, true);
      p += 4;
    }
    let params;
    if (type === 5) {
      params = { format: dv.getUint16(p, true), w: dv.getUint16(p + 2, true), h: dv.getUint16(p + 4, true) };
      p += 6;
    } else {
      params = { encoding: dv.getUint16(p, true) };
      p += 2;
    }
    const raw = bytes.subarray(p, p + csize);
    p += csize;
    if (checksumType === 1) p += 4;
    let data;
    if (comp === 0) data = raw;
    else if (comp === 1) data = await inflate(raw);
    else if (comp === 2) data = heatshrinkDecode(raw, 11, 4, usize);
    else if (comp === 3) data = heatshrinkDecode(raw, 12, 4, usize);
    else continue;
    if (type === 5) {
      thumbs.push({ format: ['PNG', 'JPG', 'QOI'][params.format] || 'PNG', w: params.w, h: params.h, bytes: data.slice() });
    } else if (type === 1) {
      gcodeParts.push(params.encoding === 0 ? td.decode(data) : meatpackDecode(data));
    } else {
      // INI metadata
      const txt = td.decode(data);
      for (const line of txt.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) applyKV(meta, line.slice(0, i), line.slice(i + 1));
      }
    }
  }
  return { text: gcodeParts.join(''), meta, thumbs };
}

// Build a USB file object from a dropped/uploaded file
export async function loadUserFile(file) {
  const name = file.name;
  const lower = name.toLowerCase();
  if (lower.endsWith('.bgcode')) {
    const buf = await file.arrayBuffer();
    const r = await parseBgcode(buf);
    const extra = parseGcodeText(r.text.slice(-60000));
    const meta = Object.assign({}, extra.meta, r.meta);
    return { name, size: file.size, text: r.text, meta, thumbImg: thumbToImage(r.thumbs), printable: true, source: 'user' };
  }
  const text = await file.text();
  const { meta, thumbs } = parseGcodeText(text);
  return { name, size: file.size, text, meta, thumbImg: thumbToImage(thumbs), printable: true, source: 'user' };
}
