import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { titleBar, fmtSize, pickFiles, SCREEN_W, SCREEN_H } from './os.js';
import { loadUserFile } from '../devices/prusa/files.js';
import { SAMPLE_MODELS } from '../slicer/models.js';
import { RESIN_SAMPLES } from '../devices/elegoo/resin.js';

// ---------------------------------------------------------------------------
// "Dateien" – a small file explorer: the laptop's Downloads folder and an
// inserted USB stick. Files can be imported from the real computer.
// ---------------------------------------------------------------------------

const TYPE_LABEL = { stl: '3D-Modell (STL)', gcode: 'G-Code (Prusa)', goo: 'Resin-Druckdatei (ELEGOO)' };
const TYPE_COLOR = { stl: '#5aa9ff', gcode: '#f08a24', goo: '#b47cff' };

// Y-up three.js geometry -> Z-up STL style positions
function zUpPositions(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.rotateX(Math.PI / 2);
  return g.attributes.position.array.slice();
}

export function stlFromBuffer(name, buf) {
  const geo = new STLLoader().parse(buf);
  const g = geo.index ? geo.toNonIndexed() : geo;
  return { kind: 'stl', name, size: buf.byteLength, positions: g.attributes.position.array.slice() };
}

export class FilesApp {
  constructor(app, os) {
    this.app = app;
    this.os = os;
    this.place = 'downloads';
    this.sel = null;
    this.status = '';
    // a few models to play with
    const add = (name, geoFn) => {
      const positions = zUpPositions(geoFn());
      os.downloads.push({ kind: 'stl', name, size: 84 + (positions.length / 9) * 50, positions });
    };
    const fdm = { heart: 'Herz_Anhaenger.stl', cube: 'Kalibrierwuerfel_20mm.stl', gear: 'Zahnrad_Z24.stl', vase: 'Spiralvase_Twist.stl', stand: 'Handystaender.stl' };
    for (const m of SAMPLE_MODELS) add(fdm[m.id] || `${m.id}.stl`, m.build);
    const resin = { rerf: 'Belichtungstest_RERF.stl', pawn: 'Schach_Bauer.stl', rook: 'Schach_Turm.stl', tealight: 'Teelicht_Schale.stl' };
    for (const m of RESIN_SAMPLES) add(resin[m.id] || `${m.id}.stl`, m.build);
  }

  list() {
    if (this.place === 'usb') return this.os.stick ? this.os.stick.files : [];
    return this.os.downloads;
  }

  importFiles() {
    pickFiles('.stl,.gcode,.bgcode,.gco,.g', true, async (files) => {
      for (const f of files) {
        const lower = f.name.toLowerCase();
        try {
          if (lower.endsWith('.stl')) {
            this.os.downloads.push(stlFromBuffer(f.name, await f.arrayBuffer()));
          } else if (/\.(gcode|bgcode|gco|g)$/.test(lower)) {
            if (f.size > 150e6) throw new Error('Datei größer als 150 MB');
            this.os.downloads.push(await loadUserFile(f));
          } else continue;
          this.status = `„${f.name}“ importiert.`;
        } catch (e) {
          console.error(e);
          this.status = `Fehler bei „${f.name}“: ${e.message}`;
        }
        this.place = 'downloads';
        this.os.ui.dirty = true;
      }
    });
  }

  copyToStick() {
    const f = this.sel;
    const st = this.os.stick;
    if (!f || !st) return;
    st.add(f);
    this.status = `„${f.name}“ wurde auf den USB-Stick „${st.label}“ kopiert.`;
  }

  remove() {
    const f = this.sel;
    if (!f) return;
    if (this.place === 'usb' && this.os.stick) this.os.stick.remove(f);
    else this.os.downloads = this.os.downloads.filter((x) => x !== f);
    this.sel = null;
    this.status = `„${f.name}“ gelöscht.`;
  }

  openInSlicer(f) {
    if (!f || f.kind !== 'stl') return;
    this.os.apps.slicer.setModel(f);
    this.os.switchTo('slicer');
  }

  draw(ui) {
    ui.rect(0, 0, SCREEN_W, SCREEN_H, '#1b1d21');
    titleBar(ui, 'Dateien', '#e7c34a');
    const top = 30;
    // toolbar
    ui.rect(0, top, SCREEN_W, 44, '#202328');
    let x = 220;
    if (ui.button('imp', x, top + 8, 130, 28, 'Importieren …', { primary: true })) this.importFiles();
    x += 138;
    const canCopy = this.place === 'downloads' && this.sel && this.os.stick;
    if (ui.button('copy', x, top + 8, 190, 28, 'Auf USB-Stick kopieren', { disabled: !canCopy })) this.copyToStick();
    x += 198;
    if (ui.button('slice', x, top + 8, 170, 28, 'In SliceWerk öffnen', { disabled: !(this.sel && this.sel.kind === 'stl') })) this.openInSlicer(this.sel);
    x += 178;
    if (ui.button('del', x, top + 8, 100, 28, 'Löschen', { disabled: !this.sel, danger: false })) this.remove();
    // navigation
    const navY = top + 44;
    ui.rect(0, navY, 200, SCREEN_H - navY, '#181a1e');
    const nav = [['downloads', 'Downloads', '⬇']];
    if (this.os.stick) nav.push(['usb', `USB-Stick (E:) ${this.os.stick.label}`, '⛁']);
    else if (this.place === 'usb') this.place = 'downloads';
    nav.forEach(([id, label, ic], i) => {
      const y = navY + 12 + i * 34;
      const r = ui.region(`nav-${id}`, 8, y, 184, 30);
      ui.rect(8, y, 184, 30, this.place === id ? '#2f5fa8' : r.hover ? '#24282e' : null, 4);
      ui.text(ic, 22, y + 15, { size: 14, color: '#e7c34a', align: 'center' });
      ui.text(label, 36, y + 15, { size: 12.5, maxW: 150 });
      if (r.clicked) {
        this.place = id;
        this.sel = null;
      }
    });
    if (!this.os.stick) ui.text('Kein USB-Stick eingesteckt', 20, navY + 66, { size: 11.5, color: '#7c838b' });
    // list
    const lx = 210;
    const lw = SCREEN_W - lx - 10;
    let y = navY + 10;
    ui.text('Name', lx + 40, y + 10, { size: 12, color: '#9aa0a6' });
    ui.text('Typ', lx + 560, y + 10, { size: 12, color: '#9aa0a6' });
    ui.text('Größe', lx + lw - 10, y + 10, { size: 12, color: '#9aa0a6', align: 'right' });
    y += 24;
    ui.rect(lx, y, lw, 1, '#2f3338');
    const files = this.list();
    const rowH = 30;
    const maxRows = Math.floor((SCREEN_H - 28 - 40 - y) / rowH);
    files.slice(0, maxRows).forEach((f, i) => {
      const ry = y + 4 + i * rowH;
      const r = ui.region(`f-${this.place}-${i}`, lx, ry, lw, rowH - 2);
      const selected = f === this.sel;
      ui.rect(lx, ry, lw, rowH - 2, selected ? '#2f5fa8' : r.hover ? '#24282e' : null, 3);
      ui.rect(lx + 12, ry + 7, 14, 14, TYPE_COLOR[f.kind] || '#888', 2);
      ui.text(f.name, lx + 40, ry + 14, { size: 13, maxW: 500 });
      ui.text(TYPE_LABEL[f.kind] || f.kind, lx + 560, ry + 14, { size: 12, color: '#b9bec5' });
      ui.text(fmtSize(f.size), lx + lw - 10, ry + 14, { size: 12, color: '#b9bec5', align: 'right' });
      if (r.clicked) {
        if (ui.mouse.dblclick && selected && f.kind === 'stl') this.openInSlicer(f);
        this.sel = f;
      }
    });
    if (!files.length) ui.text(this.place === 'usb' ? 'Der USB-Stick ist leer.' : 'Keine Dateien.', lx + 40, y + 30, { size: 13, color: '#7c838b' });
    // status line
    ui.rect(200, SCREEN_H - 28 - 26, SCREEN_W - 200, 26, '#181a1e');
    const hint = this.status || 'Tipp: USB-Stick in den rechten Anschluss des Laptops stecken, um Dateien zu kopieren. „Importieren …“ holt Dateien von deinem echten Computer.';
    ui.text(hint, 212, SCREEN_H - 28 - 13, { size: 12, color: '#b9bec5', maxW: SCREEN_W - 230 });
  }
}

