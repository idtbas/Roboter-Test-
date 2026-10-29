import * as THREE from 'three';
import { titleBar, fmtDuration, pickFiles, SCREEN_W, SCREEN_H } from './os.js';
import { stlFromBuffer } from './filesapp.js';
import { placeZUp } from '../slicer/models.js';
import { PROFILES, FILAMENTS } from '../slicer/slicer.js';
import { renderThumbnail } from '../slicer/thumbs.js';
import { RESINS, defaultParams, toResinPositions, analyse, resinThumb } from '../devices/elegoo/resin.js';

// ---------------------------------------------------------------------------
// "SliceWerk" – prepares STL models for the Prusa (G-code) or the Mars
// (layer file). The result is saved onto a USB stick plugged into the laptop.
// ---------------------------------------------------------------------------

const PRINTERS = {
  prusa: { name: 'Original Prusa MK4S', bed: [250, 210, 220], color: 0xf27a3a },
  mars: { name: 'ELEGOO Mars 4 (9K)', bed: [153.36, 77.76, 175], color: 0x8d939b }
};

function geoFromPositions(pos, scale) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (scale !== 1) g.scale(scale, scale, scale);
  return g;
}

export class SliceApp {
  constructor(app, os) {
    this.app = app;
    this.os = os;
    this.printer = 'prusa';
    this.model = null;
    this.fdm = { profile: '0.20mm SPEED', material: 'PLA', infill: 15, perimeters: 2, vase: false };
    this.resin = { resinId: RESINS[0].id, layer: 0.05, exposure: RESINS[0].exp, bottom: RESINS[0].bottomExp };
    this.scale = 100;
    this.result = null;
    this.busy = false;
    this.progress = 0;
    this.message = '';
    this.previewKey = '';
    this.preview = null;
  }

  setModel(f) {
    this.model = f;
    this.result = null;
    this.message = '';
    this.os.ui.dirty = true;
  }

  // model scaled and placed for the selected printer
  placed() {
    if (!this.model) return null;
    const geo = geoFromPositions(this.model.positions, this.scale / 100);
    if (this.printer === 'prusa') {
      const g = placeZUp(geo);
      const size = g.boundingBox.getSize(new THREE.Vector3());
      return { positions: g.attributes.position.array, size };
    }
    const r = toResinPositions(geo, true);
    return { positions: r.positions, size: r.bbox.getSize(new THREE.Vector3()), bbox: r.bbox };
  }

  fits(size) {
    const b = PRINTERS[this.printer].bed;
    return size.x <= b[0] && size.y <= b[1] && size.z <= b[2];
  }

  updatePreview() {
    const key = `${this.model?.name}|${this.scale}|${this.printer}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.preview = null;
    this.placedCache = this.placed();
    if (!this.placedCache) return;
    try {
      const url = renderThumbnail(this.placedCache.positions, { w: 520, h: 360, color: PRINTERS[this.printer].color });
      const img = new Image();
      img.onload = () => (this.os.ui.dirty = true);
      img.src = url;
      this.preview = img;
    } catch (e) {
      console.warn(e);
    }
  }

  async slice() {
    const p = this.placedCache;
    if (!p || this.busy) return;
    if (!this.fits(p.size)) {
      this.message = 'Das Modell ist zu groß für den Bauraum. Bitte kleiner skalieren.';
      return;
    }
    this.busy = true;
    this.progress = 0;
    this.result = null;
    this.message = '';
    const base = this.model.name.replace(/\.stl$/i, '');
    try {
      if (this.printer === 'prusa') {
        const st = { profile: this.fdm.profile, material: this.fdm.material, infill: this.fdm.infill / 100, perimeters: this.fdm.perimeters, vase: this.fdm.vase };
        const name = `${base}_${this.fdm.profile.split(' ')[0]}_${this.fdm.material}_MK4S.gcode`;
        this.result = await this.app.slicer.makeFile(name, p.positions, st, (v) => {
          this.progress = v;
          this.os.ui.dirty = true;
        }, 0xf27a3a);
        this.result.source = 'laptop';
      } else {
        const resin = RESINS.find((r) => r.id === this.resin.resinId) || RESINS[0];
        const params = defaultParams(resin);
        params.layerHeight = this.resin.layer;
        params.exposure = this.resin.exposure;
        params.bottomExposure = this.resin.bottom;
        const info = analyse(p.positions, p.bbox, params);
        this.result = {
          kind: 'goo',
          name: `${base}_${this.resin.layer}mm.goo`,
          title: base,
          positions: p.positions,
          bbox: p.bbox,
          params,
          info,
          thumb: resinThumb(p.positions),
          size: Math.round(info.layers * 3200)
        };
      }
      this.message = 'Fertig gesliced. Jetzt auf den USB-Stick speichern.';
    } catch (e) {
      console.error(e);
      this.message = `Slicen fehlgeschlagen: ${e.message}`;
    }
    this.busy = false;
    this.os.ui.dirty = true;
  }

  saveToStick() {
    if (!this.result || !this.os.stick) return;
    this.os.stick.add(this.result);
    this.message = `„${this.result.name}“ liegt jetzt auf dem USB-Stick „${this.os.stick.label}“.`;
  }

  download() {
    if (!this.result || this.result.kind !== 'gcode') return;
    const blob = new Blob([this.result.text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.result.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  openStl() {
    pickFiles('.stl', false, async (files) => {
      const f = files[0];
      if (!f) return;
      try {
        const stl = stlFromBuffer(f.name, await f.arrayBuffer());
        this.os.downloads.push(stl);
        this.setModel(stl);
      } catch (e) {
        this.message = `STL konnte nicht gelesen werden: ${e.message}`;
        this.os.ui.dirty = true;
      }
    });
  }

  prepare() {
    this.updatePreview();
  }

  draw(ui, ctx) {
    ui.rect(0, 0, SCREEN_W, SCREEN_H, '#1b1d21');
    titleBar(ui, 'SliceWerk 1.4 – Slicer für FDM & Resin', '#f08a24');
    const top = 30;
    const bottom = SCREEN_H - 28;
    // ------------------------------------------------ left: printer + model
    ui.rect(0, top, 300, bottom - top, '#202328');
    let y = top + 16;
    ui.text('Drucker', 16, y, { size: 13, weight: 700 });
    y += 14;
    for (const id of ['prusa', 'mars']) {
      if (ui.button(`pr-${id}`, 16, y, 268, 32, PRINTERS[id].name, { active: this.printer === id })) {
        this.printer = id;
        this.result = null;
        this.message = '';
      }
      y += 38;
    }
    y += 10;
    ui.text('Modell', 16, y, { size: 13, weight: 700 });
    if (ui.button('open', 170, y - 12, 114, 24, 'STL öffnen …', { size: 12 })) this.openStl();
    y += 16;
    const stls = this.os.downloads.filter((f) => f.kind === 'stl');
    stls.slice(0, 14).forEach((f, i) => {
      const ry = y + i * 30;
      const r = ui.region(`m-${i}`, 16, ry, 268, 28);
      ui.rect(16, ry, 268, 28, f === this.model ? '#2f5fa8' : r.hover ? '#2a2e34' : null, 4);
      ui.text(f.name, 26, ry + 14, { size: 12.5, maxW: 248 });
      if (r.clicked) this.setModel(f);
    });
    ui.text('Modelle liegen im Ordner „Downloads“.', 16, bottom - 18, { size: 11, color: '#7c838b' });

    // ------------------------------------------------ centre: preview
    const px = 300;
    const pw = 580;
    ui.rect(px, top, pw, bottom - top, '#16181b');
    const bed = PRINTERS[this.printer].bed;
    const scale = Math.min((pw - 80) / bed[0], 330 / bed[1]);
    const bw = bed[0] * scale;
    const bh = bed[1] * scale;
    const bx = px + (pw - bw) / 2;
    const by = top + 70;
    ui.rect(bx, by, bw, bh, this.printer === 'prusa' ? '#3a3122' : '#2b3038', 4, '#4b5058');
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= bed[0]; gx += 10) {
      ctx.beginPath();
      ctx.moveTo(bx + gx * scale, by);
      ctx.lineTo(bx + gx * scale, by + bh);
      ctx.stroke();
    }
    for (let gy = 0; gy <= bed[1]; gy += 10) {
      ctx.beginPath();
      ctx.moveTo(bx, by + gy * scale);
      ctx.lineTo(bx + bw, by + gy * scale);
      ctx.stroke();
    }
    ui.text(`Bauraum ${bed[0]} × ${bed[1]} × ${bed[2]} mm`, px + pw / 2, top + 40, { size: 12, color: '#9aa0a6', align: 'center' });
    if (this.preview && this.preview.complete && this.preview.naturalWidth) {
      ctx.drawImage(this.preview, px + (pw - 520) / 2, by + bh / 2 - 180 + 20, 520, 360);
    }
    const pc = this.placedCache;
    if (pc) {
      const ok = this.fits(pc.size);
      ui.text(`${this.model.name}  ·  ${pc.size.x.toFixed(1)} × ${pc.size.y.toFixed(1)} × ${pc.size.z.toFixed(1)} mm`, px + pw / 2, bottom - 60, { size: 13, align: 'center' });
      ui.text(ok ? 'Passt in den Bauraum' : 'Zu groß für den Bauraum!', px + pw / 2, bottom - 38, { size: 12, align: 'center', color: ok ? '#7ee2a8' : '#ff6b6b' });
    } else ui.text('Links ein Modell auswählen', px + pw / 2, by + bh / 2, { size: 15, color: '#7c838b', align: 'center' });

    // ------------------------------------------------ right: settings
    const rx = px + pw;
    const rw = SCREEN_W - rx;
    ui.rect(rx, top, rw, bottom - top, '#202328');
    const x = rx + 16;
    const iw = rw - 32;
    y = top + 16;
    ui.text('Einstellungen', x, y, { size: 13, weight: 700 });
    y += 22;
    if (this.printer === 'prusa') {
      const f = this.fdm;
      ui.text('Druckprofil', x, y + 12, { size: 12, color: '#9aa0a6' });
      f.profile = ui.dropdown('prof', x + 130, y, iw - 130, 26, Object.keys(PROFILES), f.profile);
      y += 36;
      ui.text('Material', x, y + 12, { size: 12, color: '#9aa0a6' });
      f.material = ui.dropdown('mat', x + 130, y, iw - 130, 26, Object.keys(FILAMENTS), f.material);
      y += 40;
      ui.text(`Infill: ${f.infill} %`, x, y, { size: 12 });
      f.infill = ui.slider('infill', x + 130, y, iw - 140, f.infill, 0, 100, 5);
      y += 30;
      ui.text('Perimeter', x, y + 12, { size: 12, color: '#9aa0a6' });
      f.perimeters = ui.dropdown('per', x + 130, y, iw - 130, 26, [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })), f.perimeters);
      y += 40;
      f.vase = ui.checkbox('vase', x, y, 'Spiralvasen-Modus', f.vase);
      y += 24;
    } else {
      const r = this.resin;
      ui.text('Resin', x, y + 12, { size: 12, color: '#9aa0a6' });
      const id = ui.dropdown('resin', x + 90, y, iw - 90, 26, RESINS.map((m) => ({ value: m.id, label: m.name.replace('ELEGOO ', '') })), r.resinId);
      if (id !== r.resinId) {
        r.resinId = id;
        const def = RESINS.find((m) => m.id === id);
        r.exposure = def.exp;
        r.bottom = def.bottomExp;
      }
      y += 36;
      ui.text('Schichthöhe', x, y + 12, { size: 12, color: '#9aa0a6' });
      r.layer = ui.dropdown('layer', x + 130, y, iw - 130, 26, [0.03, 0.05, 0.1].map((v) => ({ value: v, label: `${v} mm` })), r.layer);
      y += 40;
      ui.text(`Belichtung: ${r.exposure.toFixed(1)} s`, x, y, { size: 12 });
      r.exposure = ui.slider('exp', x + 170, y, iw - 180, r.exposure, 1, 8, 0.1);
      y += 28;
      ui.text(`Bodenschichten: ${r.bottom} s`, x, y, { size: 12 });
      r.bottom = ui.slider('bexp', x + 170, y, iw - 180, r.bottom, 10, 60, 1);
      y += 24;
      ui.text('Hinweis: keine Stützstrukturen – das Modell braucht eine flache Unterseite.', x, y + 8, { size: 11, color: '#9aa0a6', maxW: iw });
      y += 20;
    }
    y += 12;
    ui.text(`Skalierung: ${this.scale} %`, x, y, { size: 12 });
    this.scale = ui.slider('scale', x + 130, y, iw - 140, this.scale, 10, 300, 5);
    y += 34;
    if (ui.button('slice', x, y, iw, 38, this.busy ? 'Slicen …' : 'Slicen', { primary: true, disabled: !pc || this.busy, size: 14 })) this.slice();
    y += 48;
    if (this.busy) {
      ui.rect(x, y, iw, 8, '#2b2f34', 4);
      ui.rect(x, y, iw * this.progress, 8, '#f08a24', 4);
      y += 20;
    }
    const res = this.result;
    if (res) {
      ui.rect(x, y, iw, 104, '#16181b', 6, '#2f3338');
      ui.text(res.name, x + 10, y + 16, { size: 12, weight: 600, maxW: iw - 20 });
      if (res.kind === 'gcode') {
        ui.text(`Druckzeit: ${fmtDuration(res.meta.time)}`, x + 10, y + 40, { size: 12 });
        ui.text(`Filament: ${res.meta.filamentM.toFixed(2)} m · ${res.meta.filamentG.toFixed(1)} g`, x + 10, y + 60, { size: 12 });
        ui.text(`${res.meta.layers} Schichten · ${res.meta.material}`, x + 10, y + 80, { size: 12, color: '#9aa0a6' });
      } else {
        ui.text(`Druckzeit: ${fmtDuration(res.info.time)}`, x + 10, y + 40, { size: 12 });
        ui.text(`Resin: ${res.info.volumeMl.toFixed(1)} ml`, x + 10, y + 60, { size: 12 });
        ui.text(`${res.info.layers} Schichten à ${res.params.layerHeight} mm`, x + 10, y + 80, { size: 12, color: '#9aa0a6' });
      }
      y += 114;
      if (ui.button('save', x, y, iw, 32, this.os.stick ? `Auf USB-Stick „${this.os.stick.label}“ speichern` : 'Kein USB-Stick eingesteckt', { disabled: !this.os.stick })) this.saveToStick();
      y += 40;
      if (res.kind === 'gcode' && ui.button('dl', x, y, iw, 28, 'G-Code auf diesen Computer herunterladen', { size: 12 })) this.download();
      y += 36;
    }
    if (this.message) ui.text(this.message, x, Math.min(y + 8, bottom - 20), { size: 12, color: '#c9b37a', maxW: iw });
  }
}
