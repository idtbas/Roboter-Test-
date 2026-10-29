// Minimal immediate-mode GUI on a 2D canvas. Used for the laptop software and
// the resin printer touchscreen. Input arrives from 3D raycasts (uv -> px).

export class CanvasUI {
  constructor(width, height, { scale = 1, font = 'Inter, "Segoe UI", Roboto, Arial, sans-serif' } = {}) {
    this.W = width;
    this.H = height;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
    this.ctx = this.canvas.getContext('2d');
    this.font = font;
    this.mouse = { x: -1, y: -1, down: false, pressed: false, released: false, wheel: 0, dblclick: false };
    this.events = [];
    this.keys = [];
    this.hot = null;
    this.active = null;
    this.focus = null;
    this.overlays = [];
    this.lastClickT = 0;
    this.caretT = 0;
    this.dirty = true;
  }

  // ---------------------------------------------------------- input
  pointerDown(x, y) {
    this.events.push({ t: 'down', x, y });
    this.dirty = true;
  }
  pointerMove(x, y) {
    this.events.push({ t: 'move', x, y });
    this.dirty = true;
  }
  pointerUp(x, y) {
    this.events.push({ t: 'up', x, y });
    this.dirty = true;
  }
  wheel(d) {
    this.mouse.wheel += d;
    this.dirty = true;
  }
  keyDown(e) {
    this.keys.push({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    this.dirty = true;
  }

  // ---------------------------------------------------------- frame
  frame(draw) {
    // collapse events: process one press/release per frame in order
    const m = this.mouse;
    m.pressed = false;
    m.released = false;
    m.dblclick = false;
    const evs = this.events;
    this.events = [];
    // handle at most one down + one up per frame; keep the rest for later
    let handledDown = false;
    let handledUp = false;
    const rest = [];
    for (const e of evs) {
      if (e.t === 'move') {
        m.x = e.x;
        m.y = e.y;
      } else if (e.t === 'down') {
        if (handledDown || handledUp) {
          rest.push(e);
          continue;
        }
        handledDown = true;
        m.x = e.x;
        m.y = e.y;
        m.down = true;
        m.pressed = true;
        const now = performance.now();
        if (now - this.lastClickT < 350) m.dblclick = true;
        this.lastClickT = now;
      } else if (e.t === 'up') {
        if (handledUp) {
          rest.push(e);
          continue;
        }
        handledUp = true;
        m.x = e.x;
        m.y = e.y;
        m.down = false;
        m.released = true;
      }
    }
    this.events = rest;
    this.overlays = [];
    this.hot = null;
    this.blockRect = this.nextBlockRect || null;
    this.nextBlockRect = null;
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.blockInput = false;
    draw(this, ctx);
    for (const o of this.overlays) o();
    if (m.released) this.active = null;
    if (m.pressed && this.focus && this.focusHit !== true) this.focus = null;
    this.focusHit = false;
    m.wheel = 0;
    this.keys = [];
    if (this.events.length) this.dirty = true;
  }

  inside(x, y, w, h) {
    const m = this.mouse;
    return m.x >= x && m.x < x + w && m.y >= y && m.y < y + h;
  }

  // generic clickable region; returns {clicked, hover, active, pressed}
  region(id, x, y, w, h) {
    const m = this.mouse;
    const br = this.blockRect;
    const blocked = br && id !== this.openDropdown && m.x >= br.x && m.x < br.x + br.w && m.y >= br.y && m.y < br.y + br.h;
    const over = !this.blockInput && !blocked && this.inside(x, y, w, h);
    if (over) this.hot = id;
    if (over && m.pressed) this.active = id;
    const isActive = this.active === id;
    const clicked = isActive && m.released && over;
    return { hover: over, active: isActive && m.down, clicked, pressed: over && m.pressed };
  }

  // ---------------------------------------------------------- drawing helpers
  text(str, x, y, { size = 13, color = '#e6e6e6', weight = 400, align = 'left', baseline = 'middle', maxW = 0, family } = {}) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${family || this.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    let s = String(str);
    if (maxW && ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s += '…';
    }
    ctx.fillText(s, x, y);
  }

  rect(x, y, w, h, fill, r = 0, stroke = null, lw = 1) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (r > 0) {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    } else ctx.rect(x, y, w, h);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------- widgets
  button(id, x, y, w, h, label, { primary = false, danger = false, active = false, disabled = false, size = 13, theme } = {}) {
    const t = theme || this.theme || {};
    const r = disabled ? { hover: false, active: false, clicked: false } : this.region(id, x, y, w, h);
    let bg = t.btn || '#30343a';
    if (primary) bg = t.primary || '#2f7cf6';
    if (danger) bg = t.danger || '#d9363e';
    if (active) bg = t.btnActive || '#3b5f99';
    if (r.hover && !disabled) bg = shade(bg, 18);
    if (r.active) bg = shade(bg, -12);
    this.rect(x, y, w, h, disabled ? (t.btnDisabled || '#2a2c30') : bg, 4, t.btnBorder || 'rgba(255,255,255,0.08)');
    this.text(label, x + w / 2, y + h / 2 + 0.5, { size, align: 'center', color: disabled ? '#6b7076' : '#fff', weight: 500, maxW: w - 8 });
    return r.clicked;
  }

  checkbox(id, x, y, label, value, { size = 13, color } = {}) {
    const ctx = this.ctx;
    ctx.font = `400 ${size}px ${this.font}`;
    const w = 18 + 6 + ctx.measureText(label).width;
    const r = this.region(id, x, y - 9, w, 18);
    this.rect(x, y - 8, 16, 16, value ? '#2f7cf6' : '#1d2024', 3, r.hover ? '#5b8fe6' : '#4a4f56');
    if (value) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 7, y + 3.5);
      ctx.lineTo(x + 12.5, y - 3.5);
      ctx.stroke();
    }
    this.text(label, x + 24, y, { size, color: color || '#ddd' });
    return r.clicked ? !value : value;
  }

  slider(id, x, y, w, value, min, max, step = 1, { color = '#2f7cf6' } = {}) {
    const m = this.mouse;
    const r = this.region(id, x - 6, y - 10, w + 12, 20);
    if (r.active) {
      let v = min + ((m.x - x) / w) * (max - min);
      v = Math.round(v / step) * step;
      value = Math.max(min, Math.min(max, +v.toFixed(4)));
    }
    if (r.hover && m.wheel) value = Math.max(min, Math.min(max, value - Math.sign(m.wheel) * step));
    const t = (value - min) / (max - min);
    this.rect(x, y - 2, w, 4, '#3a3e44', 2);
    this.rect(x, y - 2, w * t, 4, color, 2);
    this.ctx.beginPath();
    this.ctx.arc(x + w * t, y, r.hover || r.active ? 7.5 : 6.5, 0, Math.PI * 2);
    this.ctx.fillStyle = '#f2f2f2';
    this.ctx.fill();
    return value;
  }

  // text input: returns { value, submitted }
  input(id, x, y, w, h, value, { numeric = false, placeholder = '', size = 13, mono = false } = {}) {
    const r = this.region(id, x, y, w, h);
    if (r.pressed) {
      this.focus = id;
      this.focusHit = true;
      this.caretT = performance.now();
    }
    if (this.focus === id && this.mouse.pressed && r.hover) this.focusHit = true;
    const focused = this.focus === id;
    let v = String(value ?? '');
    let submitted = false;
    if (focused) {
      for (const k of this.keys) {
        if (k.key === 'Backspace') v = v.slice(0, -1);
        else if (k.key === 'Enter') {
          submitted = true;
          if (numeric) this.focus = null;
        } else if (k.key === 'Escape') this.focus = null;
        else if (k.key.length === 1 && !k.ctrl) {
          if (numeric && !/[0-9.\-]/.test(k.key)) continue;
          v += k.key;
        }
      }
    }
    this.rect(x, y, w, h, '#15171a', 3, focused ? '#2f7cf6' : r.hover ? '#5a6068' : '#3d4249');
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y, w - 4, h);
    ctx.clip();
    const fam = mono ? 'Consolas, "Cascadia Mono", Menlo, monospace' : undefined;
    if (!v && !focused && placeholder) this.text(placeholder, x + 7, y + h / 2, { size, color: '#6f757c', family: fam });
    else {
      ctx.font = `400 ${size}px ${fam || this.font}`;
      const tw = ctx.measureText(v).width;
      const off = Math.min(0, w - 14 - tw);
      this.text(v, x + 7 + off, y + h / 2, { size, color: '#eee', family: fam });
      if (focused && Math.floor((performance.now() - this.caretT) / 530) % 2 === 0) {
        this.rect(x + 7 + off + tw + 1, y + 5, 1.5, h - 10, '#eee');
      }
    }
    ctx.restore();
    if (focused) this.dirty = true;
    return { value: v, submitted, focused };
  }

  // dropdown select: returns selected value
  dropdown(id, x, y, w, h, options, value, { size = 13 } = {}) {
    const r = this.region(id, x, y, w, h);
    const open = this.openDropdown === id;
    const cur = options.find((o) => (o.value ?? o) === value);
    const label = cur ? cur.label ?? cur : String(value ?? '');
    this.rect(x, y, w, h, r.hover ? '#363a40' : '#2b2e33', 3, open ? '#2f7cf6' : '#454a51');
    this.text(label, x + 8, y + h / 2, { size, maxW: w - 26 });
    const ctx = this.ctx;
    ctx.fillStyle = '#bbb';
    ctx.beginPath();
    ctx.moveTo(x + w - 16, y + h / 2 - 2);
    ctx.lineTo(x + w - 8, y + h / 2 - 2);
    ctx.lineTo(x + w - 12, y + h / 2 + 3);
    ctx.fill();
    let result = value;
    if (r.clicked) this.openDropdown = open ? null : id;
    if (open) {
      const ih = 24;
      const listH = options.length * ih;
      const ly = y + h + listH > this.H - 30 ? y - listH : y + h;
      const m = this.mouse;
      // pick happens immediately (before overlay draw) so the value returns this frame
      if (m.released && m.x >= x && m.x < x + w && m.y >= ly && m.y < ly + listH) {
        const i = Math.floor((m.y - ly) / ih);
        result = options[i].value ?? options[i];
        this.openDropdown = null;
        this.dirty = true;
      } else if (m.pressed && !(m.x >= x && m.x < x + w && m.y >= y && m.y < y + h) && !(m.x >= x && m.x < x + w && m.y >= ly && m.y < ly + listH)) {
        this.openDropdown = null;
      }
      this.overlays.push(() => {
        this.rect(x, ly, w, listH, '#24272b', 3, '#2f7cf6');
        options.forEach((o, i) => {
          const oy = ly + i * ih;
          const hov = m.x >= x && m.x < x + w && m.y >= oy && m.y < oy + ih;
          if (hov) this.rect(x + 1, oy, w - 2, ih, '#2f7cf6');
          this.text(o.label ?? o, x + 8, oy + ih / 2, { size, maxW: w - 16 });
        });
      });
      // block clicks to widgets under the list (applied next frame)
      if (this.openDropdown === id) this.nextBlockRect = { x, y: ly, w, h: listH };
    }
    return result;
  }
}

export function shade(hex, amt) {
  if (!hex || hex[0] !== '#') return hex;
  let c = hex.slice(1);
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
