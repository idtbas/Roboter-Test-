import { CanvasUI } from '../../core/canvasui.js';

// ---------------------------------------------------------------------------
// ELEGOO Mars 4 – 3.5" capacitive touchscreen UI (480 x 320).
// ---------------------------------------------------------------------------

const W = 480;
const H = 320;
const HEAD = 30;
const BLUE = '#1e88e5';
const FONT = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';

const T = {
  de: {
    print: 'Drucken', tools: 'Werkzeuge', system: 'System', back: 'Zurück', files: 'USB-Stick', noUsb: 'Kein USB-Stick erkannt', noFiles: 'Keine Druckdateien',
    layers: 'Schichten', time: 'Druckzeit', resin: 'Resin', exposure: 'Belichtung', start: 'Drucken', del: 'Löschen', printing: 'Druckt', paused: 'Pausiert',
    pause: 'Pause', resume: 'Fortsetzen', stop: 'Stopp', settings: 'Einstellung', elapsed: 'Verstrichen', remaining: 'Verbleibend', layer: 'Schicht',
    manual: 'Manuell', expTest: 'Belichtungstest', clean: 'Wanne reinigen', level: 'Nivellieren', info: 'Info', language: 'Sprache', sound: 'Ton', reset: 'Werkseinst.',
    home: 'Home', zpos: 'Z-Position', step: 'Schritt', on: 'An', off: 'Aus', done: 'Druck abgeschlossen', stopped: 'Druck gestoppt', ok: 'OK', yes: 'Ja', no: 'Nein',
    stopQ: 'Druck wirklich stoppen?', delQ: 'Datei löschen?', homing: 'Referenzfahrt …', lifting: 'Plattform fährt hoch …', expRunning: 'LCD-Test läuft', cleanRunning: 'Reinigungsbelichtung',
    expHint: 'Wanne entfernen, um das LCD-Testbild zu sehen.', cleanHint: 'Härtet eine dünne Schicht auf der FEP-Folie aus, um Resin-Reste zu entfernen. Plattform muss oben sein.',
    lvl1: '1. Plattform-Schrauben lösen (Plattform locker).', lvl2: '2. Home: Plattform fährt auf das LCD und richtet sich aus.', lvl3: '3. Plattform leicht andrücken und Schrauben festziehen.', lvl4: '4. Z=0 setzen. Fertig!',
    next: 'Weiter', setZ0: 'Z=0 setzen', leveled: 'Nivellierung gespeichert.', model: 'Modell', fw: 'Firmware', res: 'Auflösung', vol: 'Bauraum', resetQ: 'Auf Werkseinstellungen zurücksetzen?',
    noVat: 'Keine Resin-Wanne eingesetzt!', lowResin: 'Zu wenig Resin in der Wanne für diesen Druck. Trotzdem starten?', plateMissing: 'Keine Druckplattform montiert!', expAdj: 'Belichtungszeit', liftSpd: 'Hubgeschw.',
    finishedHint: 'Haube abnehmen und das Bauteil an der Plattform entnehmen.', estimated: 'Geschätzt'
  },
  en: {
    print: 'Print', tools: 'Tools', system: 'System', back: 'Back', files: 'USB drive', noUsb: 'No USB drive detected', noFiles: 'No print files',
    layers: 'Layers', time: 'Print time', resin: 'Resin', exposure: 'Exposure', start: 'Print', del: 'Delete', printing: 'Printing', paused: 'Paused',
    pause: 'Pause', resume: 'Resume', stop: 'Stop', settings: 'Settings', elapsed: 'Elapsed', remaining: 'Remaining', layer: 'Layer',
    manual: 'Manual', expTest: 'Exposure test', clean: 'Clean vat', level: 'Leveling', info: 'Info', language: 'Language', sound: 'Sound', reset: 'Factory reset',
    home: 'Home', zpos: 'Z position', step: 'Step', on: 'On', off: 'Off', done: 'Print complete', stopped: 'Print stopped', ok: 'OK', yes: 'Yes', no: 'No',
    stopQ: 'Really stop the print?', delQ: 'Delete file?', homing: 'Homing …', lifting: 'Platform rising …', expRunning: 'LCD test running', cleanRunning: 'Cleaning exposure',
    expHint: 'Remove the vat to see the LCD test pattern.', cleanHint: 'Cures a thin layer on the FEP film to remove resin debris. Platform must be raised.',
    lvl1: '1. Loosen the platform screws.', lvl2: '2. Home: the platform moves onto the LCD and aligns itself.', lvl3: '3. Press the platform gently and tighten the screws.', lvl4: '4. Set Z=0. Done!',
    next: 'Next', setZ0: 'Set Z=0', leveled: 'Leveling saved.', model: 'Model', fw: 'Firmware', res: 'Resolution', vol: 'Build volume', resetQ: 'Reset to factory settings?',
    noVat: 'No resin vat installed!', lowResin: 'Not enough resin in the vat for this print. Start anyway?', plateMissing: 'No build platform mounted!', expAdj: 'Exposure', liftSpd: 'Lift speed',
    finishedHint: 'Lift the cover and remove the part from the platform.', estimated: 'Estimated'
  }
};

function fmt(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function icon(ctx, name, cx, cy, s, color = '#fff') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (name === 'print') {
    ctx.moveTo(-6, -9);
    ctx.lineTo(10, 0);
    ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
  } else if (name === 'tools') {
    ctx.moveTo(-9, 9);
    ctx.lineTo(3, -3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(6, -6, 5, Math.PI * 0.25, Math.PI * 1.9);
    ctx.stroke();
  } else if (name === 'system') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 7 : 10;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (name === 'back') {
    ctx.moveTo(4, -8);
    ctx.lineTo(-5, 0);
    ctx.lineTo(4, 8);
    ctx.stroke();
  } else if (name === 'up' || name === 'down') {
    const d = name === 'up' ? -1 : 1;
    ctx.moveTo(-8, -d * 4);
    ctx.lineTo(0, d * 5);
    ctx.lineTo(8, -d * 4);
    ctx.stroke();
  } else if (name === 'usb') {
    ctx.moveTo(0, 9);
    ctx.lineTo(0, -9);
    ctx.moveTo(-3, -6);
    ctx.lineTo(0, -10);
    ctx.lineTo(3, -6);
    ctx.moveTo(0, 4);
    ctx.lineTo(-6, 0);
    ctx.moveTo(0, 1);
    ctx.lineTo(6, -3);
    ctx.stroke();
  } else if (name === 'home') {
    ctx.moveTo(-9, 1);
    ctx.lineTo(0, -8);
    ctx.lineTo(9, 1);
    ctx.moveTo(-6, -1);
    ctx.lineTo(-6, 8);
    ctx.lineTo(6, 8);
    ctx.lineTo(6, -1);
    ctx.stroke();
  } else if (name === 'pause') {
    ctx.fillRect(-6, -8, 4, 16);
    ctx.fillRect(2, -8, 4, 16);
  } else if (name === 'stop') {
    ctx.fillRect(-7, -7, 14, 14);
  } else if (name === 'sun') {
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
    }
    ctx.stroke();
  } else if (name === 'level') {
    ctx.moveTo(-10, 4);
    ctx.lineTo(10, 4);
    ctx.moveTo(-6, 0);
    ctx.lineTo(-6, -6);
    ctx.moveTo(6, 0);
    ctx.lineTo(6, -6);
    ctx.stroke();
  } else if (name === 'info') {
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (name === 'clean') {
    ctx.moveTo(-8, 6);
    ctx.lineTo(8, 6);
    ctx.lineTo(6, -2);
    ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-3, -5);
    ctx.lineTo(-3, -9);
    ctx.moveTo(3, -5);
    ctx.lineTo(3, -9);
    ctx.stroke();
  } else if (name === 'manual') {
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.moveTo(-4, -6);
    ctx.lineTo(0, -10);
    ctx.lineTo(4, -6);
    ctx.moveTo(-4, 6);
    ctx.lineTo(0, 10);
    ctx.lineTo(4, 6);
    ctx.stroke();
  }
  ctx.restore();
}

export class MarsTouchUI {
  constructor(dev) {
    this.dev = dev;
    this.ui = new CanvasUI(W, H, { scale: 2, font: FONT });
    this.screen = 'home';
    this.page = 0;
    this.sel = null;
    this.dialog = null;
    this.manualStep = 1;
    this.lvlStep = 0;
    this.redrawT = 0;
  }

  t(k) {
    return T[this.dev.fw.lang]?.[k] ?? T.en[k] ?? k;
  }

  tap() {
    if (this.dev.fw.sound) this.dev.app.audio.beep(this.dev.sfxPos(this.dev.H.touch), 2400, 0.03, 0.08, 'sine');
  }

  button(id, x, y, w, h, label, { color = '#22324a', ic, fg = '#fff', size = 15, disabled = false } = {}) {
    const ui = this.ui;
    const r = disabled ? {} : ui.region(id, x, y, w, h);
    const ctx = ui.ctx;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    const base = disabled ? '#1a2230' : color;
    g.addColorStop(0, r.active ? shade(base, -10) : shade(base, r.hover ? 14 : 8));
    g.addColorStop(1, r.active ? shade(base, -18) : base);
    ui.rect(x, y, w, h, g, 10, 'rgba(255,255,255,0.08)');
    if (ic) {
      icon(ctx, ic, x + w / 2, y + h / 2 - (label ? 12 : 0), label ? 30 : 22, disabled ? '#556' : fg);
      if (label) ui.text(label, x + w / 2, y + h - 18, { size, align: 'center', color: disabled ? '#667' : fg, weight: 600 });
    } else ui.text(label, x + w / 2, y + h / 2, { size, align: 'center', color: disabled ? '#667' : fg, weight: 600 });
    if (r.clicked) this.tap();
    return !!r.clicked;
  }

  render(dt, force = false) {
    const fw = this.dev.fw;
    this.redrawT -= dt;
    const busy = fw.job || fw.task;
    if (!force && !this.ui.dirty && this.redrawT > 0) return false;
    this.redrawT = busy ? 0.25 : 0.5;
    this.ui.dirty = false;
    this.ui.frame((ui, ctx) => this.draw(ui, ctx));
    return true;
  }

  draw(ui, ctx) {
    const fw = this.dev.fw;
    if (!fw.powered) {
      ui.rect(0, 0, W, H, '#000');
      return;
    }
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0c1524');
    bg.addColorStop(1, '#14233a');
    ui.rect(0, 0, W, H, bg);
    if (fw.booting > 0) {
      ui.text('ELEGOO', W / 2, H / 2 - 14, { size: 40, weight: 800, align: 'center', color: '#fff' });
      ui.text('MARS 4  ·  9K', W / 2, H / 2 + 24, { size: 14, align: 'center', color: '#8fb4e8' });
      return;
    }
    ui.blockInput = !!this.dialog;
    // header
    ui.rect(0, 0, W, HEAD, 'rgba(0,0,0,0.25)');
    ui.text('ELEGOO', 12, HEAD / 2, { size: 14, weight: 800, color: '#fff' });
    const d = new Date();
    ui.text(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, W - 12, HEAD / 2, { size: 13, align: 'right', color: '#cfe0f7' });
    if (this.dev.usb.inserted) icon(ctx, 'usb', W - 62, HEAD / 2, 16, '#cfe0f7');
    // auto-switch to the print screen while printing
    if (fw.job && this.screen !== 'printing' && this.screen !== 'printset') this.screen = 'printing';
    const s = this.screen;
    if (s === 'home') this.drawHome(ui);
    else if (s === 'files') this.drawFiles(ui);
    else if (s === 'detail') this.drawDetail(ui);
    else if (s === 'printing') this.drawPrinting(ui);
    else if (s === 'printset') this.drawPrintSettings(ui);
    else if (s === 'tools') this.drawTools(ui);
    else if (s === 'manual') this.drawManual(ui);
    else if (s === 'exptest' || s === 'clean') this.drawExposure(ui);
    else if (s === 'level') this.drawLevel(ui);
    else if (s === 'system') this.drawSystem(ui);
    else if (s === 'info') this.drawInfo(ui);
    if (this.dialog) this.drawDialog(ui);
  }

  title(ui, text, back = 'home') {
    if (this.button('back', 10, HEAD + 8, 44, 34, '', { ic: 'back' })) this.screen = back;
    ui.text(text, 66, HEAD + 25, { size: 17, weight: 700 });
  }

  drawHome(ui) {
    const items = [
      ['print', 'print', () => { this.screen = 'files'; this.page = 0; }, '#1565c0'],
      ['tools', 'tools', () => (this.screen = 'tools'), '#22324a'],
      ['system', 'system', () => (this.screen = 'system'), '#22324a']
    ];
    const bw = 136;
    const gap = (W - 3 * bw) / 4;
    items.forEach(([k, ic, act, col], i) => {
      if (this.button(`home-${k}`, gap + i * (bw + gap), HEAD + 40, bw, 200, this.t(k), { ic, color: col, size: 18 })) act();
    });
  }

  drawFiles(ui) {
    this.title(ui, this.t('files'));
    const usb = this.dev.usb;
    if (!usb.inserted || !usb.files.length) {
      ui.text(usb.inserted ? this.t('noFiles') : this.t('noUsb'), W / 2, H / 2 + 20, { size: 16, align: 'center', color: '#9fb6d6' });
      return;
    }
    const per = 4;
    const pages = Math.ceil(usb.files.length / per);
    this.page = Math.min(this.page, pages - 1);
    const list = usb.files.slice(this.page * per, this.page * per + per);
    const cw = 200;
    const chh = 112;
    list.forEach((f, i) => {
      const x = 30 + (i % 2) * (cw + 20);
      const y = HEAD + 52 + Math.floor(i / 2) * (chh + 10);
      const r = ui.region(`file-${f.name}`, x, y, cw, chh);
      ui.rect(x, y, cw, chh, r.hover ? '#24395a' : '#1b2a42', 8, 'rgba(255,255,255,0.08)');
      if (f.thumb) ui.ctx.drawImage(f.thumb, x + 6, y + 6, 104, 78);
      ui.text(f.title || f.name, x + 116, y + 22, { size: 12.5, weight: 600, maxW: cw - 122 });
      ui.text(`${f.info.layers} ${this.t('layers')}`, x + 116, y + 44, { size: 11, color: '#9fb6d6' });
      ui.text(fmt(f.info.time), x + 116, y + 62, { size: 11, color: '#9fb6d6' });
      ui.text(`${f.info.volumeMl.toFixed(1)} ml`, x + 116, y + 80, { size: 11, color: '#9fb6d6' });
      ui.text(f.name, x + 8, y + chh - 12, { size: 10, color: '#7f95b5', maxW: cw - 16 });
      if (r.clicked) {
        this.tap();
        this.sel = f;
        this.screen = 'detail';
      }
    });
    if (pages > 1) {
      if (this.button('pgu', W - 56, HEAD + 52, 40, 112, '', { ic: 'up', disabled: this.page === 0 })) this.page--;
      if (this.button('pgd', W - 56, HEAD + 174, 40, 112, '', { ic: 'down', disabled: this.page >= pages - 1 })) this.page++;
    }
  }

  drawDetail(ui) {
    const f = this.sel;
    if (!f) return (this.screen = 'files');
    this.title(ui, f.title || f.name, 'files');
    ui.rect(16, HEAD + 52, 200, 150, '#0e1a2b', 8);
    if (f.thumb) ui.ctx.drawImage(f.thumb, 16, HEAD + 52, 200, 150);
    const rows = [
      [this.t('layers'), `${f.info.layers} × ${f.params.layerHeight} mm`],
      [this.t('time'), fmt(f.info.time)],
      [this.t('resin'), `${f.info.volumeMl.toFixed(1)} ml`],
      [this.t('exposure'), `${f.params.exposure} s / ${f.params.bottomExposure} s`]
    ];
    rows.forEach(([k, v], i) => {
      ui.text(k, 232, HEAD + 66 + i * 36, { size: 11.5, color: '#9fb6d6' });
      ui.text(v, 232, HEAD + 82 + i * 36, { size: 15, weight: 600 });
    });
    if (this.button('del', 16, H - 62, 110, 48, this.t('del'), { color: '#5a2330' })) {
      this.dialog = { text: this.t('delQ'), buttons: [[this.t('yes'), () => { this.dev.usb.remove(f); this.screen = 'files'; }], [this.t('no'), null]] };
    }
    if (this.button('start', W - 196, H - 62, 180, 48, this.t('start'), { color: '#2e7d32', size: 17 })) this.dev.requestPrint(f);
  }

  drawPrinting(ui) {
    const fw = this.dev.fw;
    const j = fw.job || fw.lastJob;
    if (!j) {
      this.screen = 'home';
      return;
    }
    const f = j.file;
    ui.text(f.title || f.name, 16, HEAD + 22, { size: 15, weight: 700, maxW: W - 32 });
    ui.rect(16, HEAD + 40, 180, 135, '#0e1a2b', 8);
    if (f.thumb) ui.ctx.drawImage(f.thumb, 16, HEAD + 40, 180, 135);
    const prog = j.done ? 1 : j.layer / Math.max(1, j.layers);
    let state = fw.job ? (fw.paused ? this.t('paused') : fw.phaseLabel(this.dev.fw.lang)) : j.stopped ? this.t('stopped') : this.t('done');
    ui.text(state, 212, HEAD + 52, { size: 14, weight: 700, color: fw.job ? '#ffd166' : j.stopped ? '#ff8a80' : '#7ee2a8' });
    ui.text(`${this.t('layer')} ${Math.min(j.layer + (fw.job ? 1 : 0), j.layers)} / ${j.layers}`, 212, HEAD + 80, { size: 15, weight: 600 });
    ui.text(`${this.t('elapsed')}  ${fmt(j.elapsed)}`, 212, HEAD + 106, { size: 13, color: '#cfe0f7' });
    ui.text(`${this.t('remaining')}  ${fmt(fw.job ? fw.remaining() : 0)}`, 212, HEAD + 128, { size: 13, color: '#cfe0f7' });
    ui.rect(212, HEAD + 150, W - 228, 12, '#0e1a2b', 6);
    ui.rect(212, HEAD + 150, (W - 228) * prog, 12, BLUE, 6);
    ui.text(`${Math.floor(prog * 100)} %`, W - 16, HEAD + 176, { size: 13, align: 'right', weight: 700 });
    if (fw.job) {
      if (this.button('pause', 16, H - 66, 140, 52, fw.paused ? this.t('resume') : this.t('pause'), { ic: fw.paused ? 'print' : 'pause', size: 13 })) fw.paused ? fw.resume() : fw.pause();
      if (this.button('pset', 170, H - 66, 140, 52, this.t('settings'), { ic: 'system', size: 13 })) this.screen = 'printset';
      if (this.button('stop', W - 156, H - 66, 140, 52, this.t('stop'), { ic: 'stop', color: '#7a1f2b', size: 13 })) {
        this.dialog = { text: this.t('stopQ'), buttons: [[this.t('yes'), () => fw.stop()], [this.t('no'), null]] };
      }
    } else {
      ui.text(this.t('finishedHint'), 16, H - 80, { size: 12, color: '#9fb6d6', maxW: W - 32 });
      if (this.button('ok', W - 156, H - 62, 140, 48, this.t('ok'), { color: '#1565c0' })) {
        fw.lastJob = null;
        this.screen = 'home';
      }
    }
  }

  drawPrintSettings(ui) {
    const fw = this.dev.fw;
    const j = fw.job;
    this.title(ui, this.t('settings'), 'printing');
    if (!j) return;
    const p = j.params;
    const row = (y, label, val, dec, inc) => {
      ui.text(label, 24, y + 22, { size: 14 });
      if (this.button(`${label}-`, 240, y, 54, 44, '−', { size: 22 })) dec();
      ui.text(val, 340, y + 22, { size: 16, weight: 700, align: 'center' });
      if (this.button(`${label}+`, 388, y, 54, 44, '+', { size: 22 })) inc();
    };
    row(HEAD + 60, this.t('expAdj'), `${p.exposure.toFixed(1)} s`, () => (p.exposure = Math.max(0.5, +(p.exposure - 0.1).toFixed(1))), () => (p.exposure = Math.min(20, +(p.exposure + 0.1).toFixed(1))));
    row(HEAD + 120, this.t('liftSpd'), `${p.liftSpeed} mm/min`, () => (p.liftSpeed = Math.max(20, p.liftSpeed - 5)), () => (p.liftSpeed = Math.min(300, p.liftSpeed + 5)));
  }

  drawTools(ui) {
    this.title(ui, this.t('tools'));
    const items = [
      ['manual', 'manual', () => (this.screen = 'manual')],
      ['expTest', 'sun', () => (this.screen = 'exptest')],
      ['clean', 'clean', () => (this.screen = 'clean')],
      ['level', 'level', () => { this.screen = 'level'; this.lvlStep = 0; }]
    ];
    const bw = 104;
    const gap = (W - 4 * bw) / 5;
    items.forEach(([k, ic, act], i) => {
      if (this.button(`tool-${k}`, gap + i * (bw + gap), HEAD + 70, bw, 150, this.t(k), { ic, size: 13 })) act();
    });
  }

  drawManual(ui) {
    const fw = this.dev.fw;
    this.title(ui, this.t('manual'), 'tools');
    ui.text(this.t('zpos'), 24, HEAD + 70, { size: 13, color: '#9fb6d6' });
    ui.text(`${fw.z.toFixed(2)} mm`, 24, HEAD + 100, { size: 30, weight: 700 });
    ui.text(this.t('step'), 24, HEAD + 140, { size: 13, color: '#9fb6d6' });
    [0.1, 1, 10].forEach((s, i) => {
      if (this.button(`step-${s}`, 24 + i * 66, HEAD + 154, 60, 40, `${s}`, { color: this.manualStep === s ? '#1565c0' : '#22324a' })) this.manualStep = s;
    });
    const busy = !!fw.task;
    if (this.button('zup', 300, HEAD + 50, 160, 70, '', { ic: 'up', disabled: busy })) fw.jog(this.manualStep);
    if (this.button('zdn', 300, HEAD + 130, 160, 70, '', { ic: 'down', disabled: busy })) fw.jog(-this.manualStep);
    if (this.button('zhome', 24, H - 62, 120, 48, this.t('home'), { ic: 'home', size: 12, disabled: busy })) fw.home();
    if (this.button('zstop', W - 136, H - 62, 120, 48, this.t('stop'), { color: '#7a1f2b' })) fw.stopMotion();
  }

  drawExposure(ui) {
    const fw = this.dev.fw;
    const clean = this.screen === 'clean';
    this.title(ui, clean ? this.t('clean') : this.t('expTest'), 'tools');
    ui.text(clean ? this.t('cleanHint') : this.t('expHint'), 24, HEAD + 70, { size: 12.5, color: '#9fb6d6', maxW: W - 48 });
    const running = fw.task && (fw.taskName === 'exptest' || fw.taskName === 'clean');
    if (running) {
      ui.text(clean ? this.t('cleanRunning') : this.t('expRunning'), W / 2, HEAD + 130, { size: 18, weight: 700, align: 'center', color: '#b39dff' });
      ui.text(`${Math.ceil(fw.taskRemain || 0)} s`, W / 2, HEAD + 165, { size: 26, weight: 700, align: 'center' });
      if (this.button('expstop', W / 2 - 70, H - 62, 140, 48, this.t('stop'), { color: '#7a1f2b' })) fw.cancelTask();
    } else if (this.button('expgo', W / 2 - 90, H - 70, 180, 54, this.t('start'), { color: '#5e35b1', ic: 'sun', size: 13 })) {
      if (clean) fw.cleanVat();
      else fw.exposureTest();
    }
  }

  drawLevel(ui) {
    const fw = this.dev.fw;
    this.title(ui, this.t('level'), 'tools');
    const steps = ['lvl1', 'lvl2', 'lvl3', 'lvl4'];
    steps.forEach((k, i) => {
      ui.text(this.t(k), 24, HEAD + 72 + i * 32, { size: 13, color: i === this.lvlStep ? '#fff' : i < this.lvlStep ? '#7ee2a8' : '#6f86a6', weight: i === this.lvlStep ? 700 : 400, maxW: W - 48 });
    });
    const busy = !!fw.task;
    if (this.lvlStep === 1) {
      if (this.button('lvhome', W / 2 - 80, H - 62, 160, 48, this.t('home'), { ic: 'home', size: 12, disabled: busy })) {
        fw.home(true);
        this.lvlStep = 2;
      }
    } else if (this.lvlStep === 3) {
      if (this.button('lvz0', W / 2 - 80, H - 62, 160, 48, this.t('setZ0'), { color: '#2e7d32', disabled: busy })) {
        fw.leveled = true;
        fw.z = 0;
        this.dialog = { text: this.t('leveled'), buttons: [[this.t('ok'), () => (this.screen = 'tools')]] };
      }
    } else if (this.button('lvnext', W / 2 - 80, H - 62, 160, 48, this.t('next'), { disabled: busy })) {
      this.lvlStep++;
      if (this.lvlStep === 1) this.dev.plateLoose = true;
      if (this.lvlStep === 3) this.dev.plateLoose = false;
    }
  }

  drawSystem(ui) {
    const fw = this.dev.fw;
    this.title(ui, this.t('system'));
    if (this.button('lang', 30, HEAD + 60, 200, 60, `${this.t('language')}: ${fw.lang === 'de' ? 'Deutsch' : 'English'}`, { size: 14 })) fw.lang = fw.lang === 'de' ? 'en' : 'de';
    if (this.button('snd', 250, HEAD + 60, 200, 60, `${this.t('sound')}: ${fw.sound ? this.t('on') : this.t('off')}`, { size: 14 })) fw.sound = !fw.sound;
    if (this.button('info', 30, HEAD + 140, 200, 60, this.t('info'), { size: 14 })) this.screen = 'info';
    if (this.button('rst', 250, HEAD + 140, 200, 60, this.t('reset'), { size: 14, color: '#4a2a33' })) {
      this.dialog = { text: this.t('resetQ'), buttons: [[this.t('yes'), () => { fw.lang = 'de'; fw.sound = true; }], [this.t('no'), null]] };
    }
  }

  drawInfo(ui) {
    this.title(ui, this.t('info'), 'system');
    const rows = [
      [this.t('model'), 'ELEGOO Mars 4 9K'],
      [this.t('fw'), 'V4.4.3_LCDC_9K'],
      [this.t('res'), '8520 × 4320 (18 µm)'],
      [this.t('vol'), '153,36 × 77,76 × 175 mm'],
      ['UV', 'COB 405 nm, 36 LEDs']
    ];
    rows.forEach(([k, v], i) => {
      ui.text(k, 30, HEAD + 70 + i * 36, { size: 13, color: '#9fb6d6' });
      ui.text(v, 200, HEAD + 70 + i * 36, { size: 14, weight: 600 });
    });
  }

  drawDialog(ui) {
    const d = this.dialog;
    ui.rect(0, 0, W, H, 'rgba(0,0,0,0.55)');
    ui.rect(40, 60, W - 80, 200, '#1b2a42', 12, 'rgba(255,255,255,0.15)');
    const lines = wrap(ui, d.text, W - 120, 15);
    lines.forEach((l, i) => ui.text(l, W / 2, 100 + i * 22, { size: 15, align: 'center' }));
    ui.blockInput = false;
    const n = d.buttons.length;
    const bw = 130;
    d.buttons.forEach(([label, act], i) => {
      const x = W / 2 - (n * bw + (n - 1) * 14) / 2 + i * (bw + 14);
      if (this.button(`dlg-${i}`, x, 196, bw, 46, label, { color: i === 0 ? '#1565c0' : '#22324a' })) {
        this.dialog = null;
        act?.();
      }
    });
  }

  showDialog(text, buttons) {
    this.dialog = { text, buttons };
    this.ui.dirty = true;
  }
}

function wrap(ui, text, maxW, size) {
  const ctx = ui.ctx;
  ctx.font = `400 ${size}px ${FONT}`;
  const words = String(text).split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
