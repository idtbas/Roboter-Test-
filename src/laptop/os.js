import { CanvasUI } from '../core/canvasui.js';
import { LaserApp } from './laserapp.js';
import { FilesApp } from './filesapp.js';
import { SliceApp } from './sliceapp.js';

// ---------------------------------------------------------------------------
// The laptop: a tiny desktop with a taskbar and three maximised programs.
// Everything is drawn into one canvas that is mapped onto the 3D screen.
// ---------------------------------------------------------------------------

export const SCREEN_W = 1280;
export const SCREEN_H = 800;
const TASK_H = 28;

export class LaptopOS {
  constructor(app, laserDevice) {
    this.app = app;
    this.ui = new CanvasUI(SCREEN_W, SCREEN_H, { scale: 1.25 });
    this.ui.theme = { btn: '#33373d', primary: '#2f7cf6', danger: '#c9323a', btnActive: '#2f5fa8' };
    this.downloads = [];
    this.stick = null; // UsbStick plugged into the laptop
    this.apps = {
      laser: new LaserApp(laserDevice, this.ui),
      slicer: new SliceApp(app, this),
      files: new FilesApp(app, this)
    };
    this.active = 'laser';
    this.redrawT = 0;
  }

  get laser() {
    return this.apps.laser;
  }

  setStick(stick) {
    if (this.stick) this.stick.listeners.delete(this.onStickChange);
    this.stick = stick;
    this.onStickChange = () => (this.ui.dirty = true);
    if (stick) stick.listeners.add(this.onStickChange);
    this.ui.dirty = true;
  }

  switchTo(id) {
    this.active = id;
    this.ui.focus = null;
    this.ui.openDropdown = null;
    this.ui.dirty = true;
  }

  // pointer input from the 3D screen (screen pixels)
  pointerDown(x, y) {
    this.ui.pointerDown(x, y);
  }

  pointerMove(x, y) {
    this.ui.pointerMove(x, y);
  }

  pointerUp(x, y) {
    this.ui.pointerUp(x, y);
    // run the UI right away so that file dialogs open inside the click event
    this.render(0, true);
  }

  wheel(steps) {
    this.ui.wheel(steps);
  }

  onKey(e) {
    const a = this.apps[this.active];
    const used = a.onKey ? a.onKey(e) : false;
    if (!used && this.ui.focus) {
      this.ui.keyDown(e);
      return true;
    }
    if (used) this.ui.dirty = true;
    return used;
  }

  render(realDt, force = false) {
    this.redrawT -= realDt;
    if (!force && !this.ui.dirty && this.redrawT > 0) return false;
    this.redrawT = 0.25;
    this.ui.dirty = false;
    const a = this.apps[this.active];
    a.prepare?.();
    this.ui.frame((ui, ctx) => {
      a.draw(ui, ctx);
      ui.blockInput = false;
      this.drawTaskbar(ui);
    });
    this.needsUpload = true;
    return true;
  }

  drawTaskbar(ui) {
    const y = SCREEN_H - TASK_H;
    ui.rect(0, y, SCREEN_W, TASK_H, '#0d0f12');
    ui.rect(8, y + 5, 18, 18, '#3b8cff', 3);
    const items = [
      ['laser', 'LaserWerk', '#2f7cf6'],
      ['slicer', 'SliceWerk', '#f08a24'],
      ['files', 'Dateien', '#e7c34a']
    ];
    let x = 40;
    for (const [id, label, col] of items) {
      const w = 124;
      const r = ui.region(`task-${id}`, x, y + 2, w, TASK_H - 4);
      const act = this.active === id;
      ui.rect(x, y + 3, w, TASK_H - 6, act ? '#2a2f37' : r.hover ? '#1d2127' : null, 4);
      if (act) ui.rect(x + 8, y + TASK_H - 4, w - 16, 2, col, 1);
      ui.rect(x + 8, y + 8, 12, 12, col, 2);
      ui.text(label, x + 26, y + 14, { size: 12, color: '#ddd' });
      if (r.clicked) this.switchTo(id);
      x += w + 6;
    }
    const d = new Date();
    ui.text(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, SCREEN_W - 12, y + 14, { size: 12, color: '#ddd', align: 'right' });
    const tray = [];
    if (this.apps.laser.dev.cableConnected) tray.push('Laser-USB ⇄');
    if (this.stick) tray.push(`USB-Stick „${this.stick.label}“`);
    ui.text(tray.join('    '), SCREEN_W - 60, y + 14, { size: 11, color: '#8ab4ff', align: 'right' });
  }
}

// shared helpers for the laptop programs
export function titleBar(ui, title, accent = '#2f7cf6') {
  ui.rect(0, 0, SCREEN_W, 30, '#121417');
  ui.rect(10, 8, 14, 14, accent, 3);
  ui.text(title, 32, 15, { size: 13, color: '#cfd3d8' });
  ui.text('—    ☐    ✕', SCREEN_W - 16, 15, { size: 13, color: '#9aa0a6', align: 'right' });
}

export function fmtSize(b) {
  if (!b) return '';
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

export function fmtDuration(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// open the browser's file dialog (must run inside a user gesture)
export function pickFiles(accept, multiple, cb) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => {
    cb([...input.files]);
    input.remove();
  };
  input.click();
}
