import { LASER_MATERIALS } from '../devices/ortur/burn.js';
import { generateJob, estimateTime, drawObjectFill, objectOutlines, textAspect, FONTS, sampleMandala, boundsOf } from '../devices/ortur/lasergen.js';
import { GRBL_ERRORS, GRBL_ALARMS } from '../devices/ortur/grbl.js';
import { pickFiles } from './os.js';

// ---------------------------------------------------------------------------
// "LaserWerk 2" – laser control software running on the laptop. Talks to the
// Ortur over a simulated USB serial port (115200 baud, GRBL character
// counting protocol). Rendered with the immediate-mode CanvasUI.
// ---------------------------------------------------------------------------

const W = 1280;
const H = 800;
const TOP = 56;
const TASK_H = 28;
const STATUS_Y = H - TASK_H - 22;
const LEFT_W = 50;
const RIGHT_X = 860;
const BOTTOM_Y = 560;
const COLORS = { line: '#1e6ff2', fill: '#e6e6e6', image: '#c8c8c8', cut: '#ff3b3b' };
const MODE_LABEL = { line: 'Linie', fill: 'Füllen', image: 'Bild', cut: 'Schneiden' };
const BAUD = 115200;

let nextId = 1;

export class LaserApp {
  constructor(dev, ui) {
    this.dev = dev;
    this.ui = ui;
    this.objects = [];
    this.selected = null;
    this.tool = 'select';
    this.console = [];
    this.cmd = '';
    this.connected = false;
    this.port = 'COM3';
    this.state = { status: 'Getrennt', x: 0, y: 0, z: 0, f: 0, s: 0 };
    this.view = { s: 1.1, ox: 0, oy: 0 };
    this.fitView();
    this.job = null;
    this.txBuffer = '';
    this.inflight = [];
    this.pollT = 0;
    this.jogStep = 10;
    this.jogFeed = 3000;
    this.dialog = null;
    this.menuOpen = null;
    this.estimate = null;
    this.estimateDirty = true;
    this.redrawT = 0;
    this.log('LaserWerk 2.4.1 gestartet', 'sys');
    this.log('Gerätprofil: Ortur Laser Master 3 (GRBL, Ursprung vorne links, 400 × 400 mm)', 'sys');
  }

  // ------------------------------------------------------------------ util
  log(text, kind = 'rx') {
    this.console.push({ text, kind });
    if (this.console.length > 400) this.console.splice(0, this.console.length - 400);
    this.ui.dirty = true;
  }

  fitView() {
    const cw = RIGHT_X - LEFT_W - 40;
    const ch = BOTTOM_Y - TOP - 40;
    const s = Math.min(cw / 410, ch / 410);
    this.view.s = s;
    this.view.ox = LEFT_W + 28 + (cw - 400 * s) / 2;
    this.view.oy = TOP + 22 + (ch + 400 * s) / 2;
  }

  toScreen(X, Y) {
    return [this.view.ox + X * this.view.s, this.view.oy - Y * this.view.s];
  }

  toMachine(x, y) {
    return [(x - this.view.ox) / this.view.s, (this.view.oy - y) / this.view.s];
  }

  get grbl() {
    return this.dev.grbl;
  }

  portAvailable() {
    return this.dev.cableConnected && this.grbl.powered;
  }

  // ------------------------------------------------------------------ serial
  connect() {
    if (!this.portAvailable()) {
      this.log(`Fehler: Port ${this.port} nicht gefunden. Ist der Laser eingeschaltet und per USB verbunden?`, 'err');
      this.showDialog('Keine Verbindung', `Port ${this.port} wurde nicht gefunden.\nPrüfe Netzteil/Schalter am Laser und das USB-Kabel.`, [{ label: 'OK' }]);
      return;
    }
    this.connected = true;
    this.txBuffer = '';
    this.inflight = [];
    this.waitingWelcome = true;
    this.log(`Verbinde mit ${this.port} @ ${BAUD} Baud …`, 'sys');
    this.grbl.receive('\x18');
  }

  disconnect(reason) {
    if (!this.connected) return;
    this.connected = false;
    this.job = null;
    this.txBuffer = '';
    this.inflight = [];
    this.state.status = 'Getrennt';
    this.log(reason || 'Verbindung getrennt.', reason ? 'err' : 'sys');
  }

  // called by the device for every line GRBL emits
  onSerialLine(line) {
    if (!this.connected) return;
    if (line === 'ok' || line.startsWith('error:')) {
      const sent = this.inflight.shift();
      if (sent && sent.job) {
        this.job.acked++;
      }
      if (line.startsWith('error:')) {
        const n = +line.slice(6);
        this.log(`${line}  ${GRBL_ERRORS[n] || ''}${sent ? `  → "${sent.text}"` : ''}`, 'err');
        if (sent && sent.job && this.job) {
          this.abortJob(`Fehler im Auftrag (Zeile ${sent.lineNo + 1}): ${GRBL_ERRORS[n] || line}`);
        } else if (n === 9) {
          this.showAlarmHelp();
        }
      } else if (sent && sent.echo) this.log('ok', 'ok');
      return;
    }
    if (line.startsWith('<')) {
      this.parseStatus(line);
      return;
    }
    if (line.startsWith('ALARM:')) {
      const n = +line.slice(6);
      this.log(`${line}  ${GRBL_ALARMS[n] || ''}`, 'err');
      if (this.job) this.abortJob(`Alarm ${n}: ${GRBL_ALARMS[n] || ''}`);
      this.inflight = [];
      this.txBuffer = '';
      return;
    }
    if (line.startsWith('Grbl')) {
      if (this.waitingWelcome) {
        this.waitingWelcome = false;
        this.log(`Verbunden: ${line}`, 'ok');
      } else this.log(line, 'rx');
      this.inflight = [];
      return;
    }
    if (line === '') return;
    this.log(line, 'rx');
  }

  parseStatus(line) {
    const body = line.slice(1, -1).split('|');
    const st = this.state;
    st.status = body[0];
    for (const part of body.slice(1)) {
      const [k, v] = part.split(':');
      if (k === 'MPos' || k === 'WPos') {
        const [x, y, z] = v.split(',').map(Number);
        st.x = x;
        st.y = y;
        st.z = z;
      } else if (k === 'FS') {
        const [f, s] = v.split(',').map(Number);
        st.f = f;
        st.s = s;
      } else if (k === 'Ov') st.ov = v;
    }
    this.ui.dirty = true;
  }

  // queue a line on the serial port (character counting)
  sendLine(text, { echo = true, job = false, lineNo = 0 } = {}) {
    if (!this.connected) {
      this.log('Nicht verbunden.', 'err');
      return false;
    }
    if (echo) this.log(text, 'tx');
    this.pending = this.pending || [];
    this.pending.push({ text, echo, job, lineNo });
    return true;
  }

  realtime(ch) {
    if (!this.connected) return;
    this.grbl.receive(ch);
  }

  // serial transport, called with simulated time
  update(dt, realDt) {
    if (this.connected && !this.portAvailable()) this.disconnect('Verbindung zum Gerät verloren (USB getrennt oder ausgeschaltet).');
    if (!this.connected) return;
    // job streaming: fill pending queue from the job
    const j = this.job;
    if (j && !j.paused) {
      const inflightChars = () => this.inflight.reduce((a, b) => a + b.text.length + 1, 0) + this.txBuffer.length;
      let guard = 0;
      while (j.sent < j.lines.length && guard++ < 400) {
        const l = j.lines[j.sent];
        if (inflightChars() + (this.pending?.length ? this.pending.reduce((a, b) => a + b.text.length + 1, 0) : 0) + l.length + 1 > 127) break;
        this.pending = this.pending || [];
        this.pending.push({ text: l, echo: false, job: true, lineNo: j.sent });
        j.sent++;
      }
    }
    // move pending -> wire respecting the 127 byte RX buffer (char counting)
    if (this.pending && this.pending.length) {
      let used = this.inflight.reduce((a, b) => a + b.text.length + 1, 0);
      while (this.pending.length && used + this.pending[0].text.length + 1 <= 127) {
        const p = this.pending.shift();
        this.inflight.push(p);
        used += p.text.length + 1;
        this.txBuffer += `${p.text}\n`;
      }
    }
    // baud-limited transfer
    if (this.txBuffer) {
      this.txBudget = (this.txBudget || 0) + (BAUD / 10) * dt;
      const n = Math.min(this.txBuffer.length, Math.floor(this.txBudget));
      if (n > 0) {
        this.txBudget -= n;
        const chunk = this.txBuffer.slice(0, n);
        this.txBuffer = this.txBuffer.slice(n);
        this.grbl.receive(chunk);
      }
    } else this.txBudget = 0;
    // status polling (real time)
    this.pollT -= realDt;
    if (this.pollT <= 0) {
      this.pollT = 0.2;
      this.grbl.receive('?');
    }
    // job completion
    if (j && j.sent >= j.lines.length && j.acked >= j.lines.length && this.state.status === 'Idle' && this.grbl.planner.idle) {
      const t = j.elapsed;
      this.job = null;
      if (!j.frame) {
        this.log(`Auftrag abgeschlossen in ${fmtTime(t)}.`, 'ok');
        this.dev.onJobDone?.(t);
      }
    }
    if (j && !j.paused) j.elapsed += dt;
  }

  // ------------------------------------------------------------------ actions
  requireIdle() {
    if (!this.connected) {
      this.showDialog('Nicht verbunden', 'Bitte zuerst rechts oben mit dem Laser verbinden.', [{ label: 'OK' }]);
      return false;
    }
    if (this.state.status.startsWith('Alarm')) {
      this.showAlarmHelp();
      return false;
    }
    if (this.job) return false;
    return true;
  }

  showAlarmHelp() {
    if (this.dialog) return;
    this.showDialog('Gerät gesperrt (ALARM)', 'Der Laser ist im Alarm-Zustand. Nach dem Einschalten muss er erst eine Referenzfahrt machen (Home) oder entsperrt werden.\nBei Not-Aus: Knopf herausdrehen, dann Home.', [
      { label: 'Home ($H)', primary: true, act: () => this.sendLine('$H') },
      { label: 'Entsperren ($X)', act: () => this.sendLine('$X') },
      { label: 'Abbrechen' }
    ]);
  }

  startJob(frame = false) {
    if (!this.requireIdle()) return;
    if (!this.objects.length) {
      this.showDialog('Nichts zu tun', 'Füge zuerst links Formen, Text oder ein Bild hinzu.', [{ label: 'OK' }]);
      return;
    }
    let lines;
    if (frame) {
      const b = boundsOf(this.objects);
      lines = ['G90', 'G21', `G0 X${b.x0.toFixed(2)} Y${b.y0.toFixed(2)}`, 'M3 S3', `G1 X${b.x1.toFixed(2)} Y${b.y0.toFixed(2)} F3000`, `G1 X${b.x1.toFixed(2)} Y${b.y1.toFixed(2)}`, `G1 X${b.x0.toFixed(2)} Y${b.y1.toFixed(2)}`, `G1 X${b.x0.toFixed(2)} Y${b.y0.toFixed(2)}`, 'M5 S0'];
    } else {
      const outside = this.objects.some((o) => o.x < 0 || o.y < 0 || o.x + o.w > 400 || o.y + o.h > 400);
      if (outside) {
        this.showDialog('Außerhalb des Arbeitsbereichs', 'Mindestens ein Objekt liegt außerhalb der 400 × 400 mm. Bitte verschieben.', [{ label: 'OK' }]);
        return;
      }
      const job = generateJob(this.objects, { sMax: this.grbl.settings[30] });
      lines = job.lines.filter((l) => !l.startsWith(';'));
      this.log(`Auftrag gestartet: ${lines.length} Zeilen G-Code${this.estimate ? `, geschätzt ${fmtTime(this.estimate)}` : ''}`, 'sys');
    }
    this.job = { lines, sent: 0, acked: 0, elapsed: 0, paused: false, frame, total: lines.length };
  }

  pauseJob() {
    if (!this.job) return;
    if (!this.job.paused) {
      this.realtime('!');
      this.job.paused = true;
      this.log('Pause (Feed Hold)', 'sys');
    } else {
      this.realtime('~');
      this.job.paused = false;
      this.log('Fortsetzen (Cycle Start)', 'sys');
    }
  }

  stopJob() {
    if (!this.connected) return;
    this.realtime('!');
    const after = () => {
      this.realtime('\x18');
      this.pending = [];
      this.inflight = [];
      this.txBuffer = '';
      this.job = null;
      this.log('Auftrag abgebrochen.', 'err');
    };
    // wait a moment for the hold to complete (no alarm on reset while stopped)
    setTimeout(after, 120);
  }

  abortJob(msg) {
    this.job = null;
    this.pending = [];
    this.showDialog('Auftrag abgebrochen', msg, [{ label: 'OK' }]);
  }

  jog(dx, dy) {
    if (!this.connected) return this.log('Nicht verbunden.', 'err');
    if (this.state.status.startsWith('Alarm')) return this.showAlarmHelp();
    this.sendLine(`$J=G91 G21 X${(dx * this.jogStep).toFixed(3)} Y${(dy * this.jogStep).toFixed(3)} F${this.jogFeed}`);
  }

  fireTest(on) {
    if (!this.connected || this.state.status.startsWith('Alarm') || this.job) return;
    if (on) {
      this.sendLine('$32=0', { echo: false });
      this.sendLine('M3 S10', { echo: false });
      this.log('Testfeuer AN (1 %)', 'sys');
    } else {
      this.sendLine('M5', { echo: false });
      this.sendLine('$32=1', { echo: false });
      this.log('Testfeuer AUS', 'sys');
    }
  }

  showDialog(title, text, buttons) {
    this.dialog = { title, text, buttons };
    this.ui.dirty = true;
  }

  // ------------------------------------------------------------------ objects
  addObject(o) {
    const mat = this.dev.workpiece?.def || LASER_MATERIALS[0];
    const mode = o.mode || (o.type === 'image' ? 'image' : o.type === 'text' ? 'fill' : 'line');
    const pre = mat.presets[mode];
    const obj = Object.assign(
      {
        id: nextId++,
        name: o.type === 'text' ? 'Text' : o.type === 'image' ? 'Bild' : { rect: 'Rechteck', ellipse: 'Ellipse', star: 'Stern', heart: 'Herz' }[o.type] || o.type,
        mode,
        speed: pre.speed,
        power: pre.power,
        passes: pre.passes || 1,
        interval: pre.interval || 0.1,
        dither: 'jarvis',
        air: true,
        bold: false,
        font: 'Arial'
      },
      o
    );
    this.objects.push(obj);
    this.selected = obj;
    this.estimateDirty = true;
    return obj;
  }

  materialRect() {
    const wp = this.dev.workpiece;
    if (!wp) return null;
    return { x: wp.X0, y: wp.Y0, w: wp.def.w, h: wp.def.h };
  }

  defaultCenter() {
    const m = this.materialRect();
    return m ? [m.x + m.w / 2, m.y + m.h / 2] : [200, 200];
  }

  loadExample(kind) {
    this.objects = [];
    const [cx, cy] = this.defaultCenter();
    const mr = this.materialRect();
    const mat = this.dev.workpiece?.def || LASER_MATERIALS[0];
    if (kind === 'sign') {
      const w = Math.min(160, (mr?.w || 200) - 20);
      const hh = Math.min(60, (mr?.h || 100) - 20);
      const t = this.addObject({ type: 'text', text: 'Werkstatt', font: 'Georgia', bold: true, x: 0, y: 0, w: 10, h: hh * 0.42 });
      t.w = t.h * textAspect(t);
      if (t.w > w - 20) {
        t.w = w - 20;
        t.h = t.w / textAspect(t);
      }
      t.x = cx - t.w / 2;
      t.y = cy - t.h / 2;
      const r = this.addObject({ type: 'rect', x: cx - w / 2, y: cy - hh / 2, w, h: hh, radius: 8, mode: 'cut' });
      const c = mat.presets.cut;
      r.speed = c.speed;
      r.power = c.power;
      r.passes = c.passes;
      r.name = 'Kontur';
    } else if (kind === 'mandala') {
      const s = Math.min(80, (mr ? Math.min(mr.w, mr.h) : 100) - 10);
      this.addObject({ type: 'image', img: sampleMandala(600), x: cx - s / 2, y: cy - s / 2, w: s, h: s, dither: 'jarvis', name: 'Mandala' });
    } else if (kind === 'star') {
      const s = Math.min(70, (mr ? Math.min(mr.w, mr.h) : 100) - 10);
      const o = this.addObject({ type: 'star', x: cx - s / 2, y: cy - s / 2, w: s, h: s, mode: 'cut' });
      const c = mat.presets.cut;
      o.speed = c.speed;
      o.power = c.power;
      o.passes = c.passes;
    }
    this.estimateDirty = true;
  }

  importImage() {
    pickFiles('image/*,.svg', false, (files) => {
      const f = files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const sc = Math.min(1, 1200 / Math.max(img.width, img.height));
        c.width = Math.max(1, Math.round(img.width * sc));
        c.height = Math.max(1, Math.round(img.height * sc));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const [cx, cy] = this.defaultCenter();
        const w = 60;
        const hh = (w * c.height) / c.width;
        this.addObject({ type: 'image', img: c, x: cx - w / 2, y: cy - hh / 2, w, h: hh, name: f.name.slice(0, 24) });
        this.ui.dirty = true;
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  deleteSelected() {
    if (!this.selected) return;
    this.objects = this.objects.filter((o) => o !== this.selected);
    this.selected = null;
    this.estimateDirty = true;
  }

  centerSelected() {
    const o = this.selected;
    if (!o) return;
    const [cx, cy] = this.defaultCenter();
    o.x = cx - o.w / 2;
    o.y = cy - o.h / 2;
    this.estimateDirty = true;
  }

  // ------------------------------------------------------------------ keys
  onKey(e) {
    const ui = this.ui;
    if (ui.focus) {
      ui.keyDown(e);
      return true;
    }
    if (this.dialog && e.key === 'Enter') {
      this.dialog = null;
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
      ui.dirty = true;
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    if (this.selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const o = this.selected;
      if (e.key === 'ArrowLeft') o.x -= step;
      if (e.key === 'ArrowRight') o.x += step;
      if (e.key === 'ArrowUp') o.y += step;
      if (e.key === 'ArrowDown') o.y -= step;
      this.estimateDirty = true;
      ui.dirty = true;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ render
  // called by the laptop OS before drawing
  prepare() {
    if (this.estimateDirty && !this.job) {
      this.estimateDirty = false;
      try {
        if (this.objects.length) {
          const j = generateJob(this.objects, { sMax: 1000 });
          this.estimate = estimateTime(j.lines, this.grbl.settings);
          this.estimateLines = j.lines.length;
        } else this.estimate = null;
      } catch (e) {
        console.warn(e);
        this.estimate = null;
      }
    }
  }

  draw(ui, ctx) {
    // modal handling: dialogs block everything, open menus block the area below them
    ui.blockInput = !!this.dialog;
    if (this.menuOpen && this.menuRect) ui.blockRect = this.menuRect;
    // window background
    ui.rect(0, 0, W, H, '#1b1d21');
    this.drawTitle(ui);
    this.drawCanvas(ui, ctx);
    this.drawToolbar(ui);
    this.drawBottom(ui);
    this.drawRight(ui);
    this.drawStatus(ui);
    this.drawMenus(ui);
    if (this.dialog) this.drawDialog(ui);
  }

  drawTitle(ui) {
    ui.rect(0, 0, W, 30, '#121417');
    ui.rect(10, 8, 14, 14, '#2f7cf6', 3);
    ui.text('LaserWerk 2 – Projekt.lwp', 32, 15, { size: 13, color: '#cfd3d8' });
    ui.text('—    ☐    ✕', W - 16, 15, { size: 13, color: '#9aa0a6', align: 'right' });
    ui.rect(0, 30, W, 26, '#202328');
    const menus = ['Datei', 'Bearbeiten', 'Anordnen', 'Laser', 'Hilfe'];
    let x = 10;
    for (const m of menus) {
      ui.ctx.font = `400 13px ${ui.font}`;
      const w = ui.ctx.measureText(m).width + 18;
      const r = ui.region(`menu-${m}`, x, 30, w, 26);
      if (r.hover || this.menuOpen === m) ui.rect(x, 31, w, 24, '#33373d', 3);
      ui.text(m, x + 9, 43, { size: 13, color: '#d7dbe0' });
      if (r.clicked) this.menuOpen = this.menuOpen === m ? null : m;
      this[`menuX_${m}`] = x;
      x += w;
    }
  }

  drawMenus(ui) {
    if (!this.menuOpen) return;
    const items = {
      Datei: [
        ['Neu', () => { this.objects = []; this.selected = null; this.estimateDirty = true; }],
        ['Bild importieren …', () => this.importImage()],
        ['Beispiel: Namensschild', () => this.loadExample('sign')],
        ['Beispiel: Mandala-Gravur', () => this.loadExample('mandala')],
        ['Beispiel: Stern ausschneiden', () => this.loadExample('star')]
      ],
      Bearbeiten: [
        ['Löschen (Entf)', () => this.deleteSelected()],
        ['Alles auswählen', () => (this.selected = this.objects[0] || null)]
      ],
      Anordnen: [
        ['Auf Material zentrieren', () => this.centerSelected()],
        ['Ansicht einpassen', () => this.fitView()]
      ],
      Laser: [
        ['Home ($H)', () => this.sendLine('$H')],
        ['Entsperren ($X)', () => this.sendLine('$X')],
        ['Einstellungen anzeigen ($$)', () => this.sendLine('$$')],
        ['Geräteinfo ($I)', () => this.sendLine('$I')],
        ['Soft-Reset (Strg+X)', () => { this.realtime('\x18'); this.log('Soft-Reset gesendet', 'sys'); }]
      ],
      Hilfe: [['Über LaserWerk', () => this.showDialog('LaserWerk 2.4.1', 'Fiktive Lasersoftware für GRBL-Diodenlaser.\nOrigin vorne links · Character-Counting-Streaming · M4 dynamische Leistung.', [{ label: 'OK' }])]]
    };
    const list = items[this.menuOpen];
    const x = this[`menuX_${this.menuOpen}`];
    const w = 260;
    const ih = 26;
    this.menuRect = { x, y: 56, w, h: list.length * ih };
    const m = ui.mouse;
    let clickedItem = null;
    list.forEach(([label, fn], i) => {
      const y = 56 + i * ih;
      if (m.released && m.x >= x && m.x < x + w && m.y >= y && m.y < y + ih) clickedItem = fn;
    });
    ui.rect(x, 56, w, list.length * ih, '#24272b', 4, '#3c4148');
    list.forEach(([label], i) => {
      const y = 56 + i * ih;
      if (m.x >= x && m.x < x + w && m.y >= y && m.y < y + ih) ui.rect(x + 2, y + 1, w - 4, ih - 2, '#2f7cf6', 3);
      ui.text(label, x + 12, y + ih / 2, { size: 13 });
    });
    if (clickedItem) {
      this.menuOpen = null;
      clickedItem();
    } else if (m.pressed && !(m.y < 56 && m.y > 30) && !(m.x >= x && m.x < x + w && m.y >= 56 && m.y < 56 + list.length * ih)) {
      this.menuOpen = null;
    }
  }

  drawToolbar(ui) {
    ui.rect(0, TOP, LEFT_W, STATUS_Y - TOP, '#202328');
    const tools = [
      ['select', '⬉', 'Auswahl'],
      ['rect', '▭', 'Rechteck'],
      ['ellipse', '◯', 'Ellipse'],
      ['star', '☆', 'Stern'],
      ['heart', '♡', 'Herz'],
      ['text', 'T', 'Text'],
      ['image', '🖼', 'Bild'],
      ['delete', '🗑', 'Löschen'],
      ['center', '⊕', 'Zentrieren']
    ];
    tools.forEach(([id, glyph], i) => {
      const y = TOP + 8 + i * 44;
      const r = ui.region(`tool-${id}`, 6, y, 38, 38);
      const active = this.tool === id;
      ui.rect(6, y, 38, 38, active ? '#2f5fa8' : r.hover ? '#33373d' : null, 5);
      ui.text(glyph, 25, y + 19, { size: id === 'text' ? 20 : 19, align: 'center', color: '#e8eaed', weight: id === 'text' ? 700 : 400 });
      if (r.clicked) {
        if (id === 'image') this.importImage();
        else if (id === 'delete') this.deleteSelected();
        else if (id === 'center') this.centerSelected();
        else this.tool = id;
      }
    });
  }

  drawCanvas(ui, ctx) {
    const x0 = LEFT_W;
    const y0 = TOP;
    const cw = RIGHT_X - LEFT_W;
    const ch = BOTTOM_Y - TOP;
    ui.rect(x0, y0, cw, ch, '#26292e');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, cw, ch);
    ctx.clip();
    const v = this.view;
    const [ax, ay] = this.toScreen(0, 400);
    const size = 400 * v.s;
    ui.rect(ax, ay, size, size, '#f4f5f6');
    // grid
    ctx.lineWidth = 1;
    for (let mm = 0; mm <= 400; mm += 10) {
      ctx.strokeStyle = mm % 50 === 0 ? '#c9ccd1' : '#e4e6e9';
      const [gx] = this.toScreen(mm, 0);
      const [, gy] = this.toScreen(0, mm);
      ctx.beginPath();
      ctx.moveTo(gx + 0.5, ay);
      ctx.lineTo(gx + 0.5, ay + size);
      ctx.moveTo(ax, gy + 0.5);
      ctx.lineTo(ax + size, gy + 0.5);
      ctx.stroke();
    }
    // material outline
    const mr = this.materialRect();
    if (mr) {
      const [mx0, my0] = this.toScreen(mr.x, mr.y + mr.h);
      ctx.fillStyle = 'rgba(214,170,110,0.25)';
      ctx.fillRect(mx0, my0, mr.w * v.s, mr.h * v.s);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#b07a35';
      ctx.strokeRect(mx0 + 0.5, my0 + 0.5, mr.w * v.s, mr.h * v.s);
      ctx.setLineDash([]);
      ui.text(`Material: ${this.dev.workpiece.def.name}`, mx0 + 4, my0 - 8, { size: 11, color: '#d6aa6e' });
    }
    // objects
    for (const o of this.objects) this.drawObject(ui, ctx, o);
    // selection
    const sel = this.selected;
    if (sel) {
      const [sx0, sy0] = this.toScreen(sel.x, sel.y + sel.h);
      const sw = sel.w * v.s;
      const sh = sel.h * v.s;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#2f7cf6';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx0 - 2.5, sy0 - 2.5, sw + 5, sh + 5);
      ctx.setLineDash([]);
      for (const [hx, hy] of this.handles(sel)) ui.rect(hx - 4, hy - 4, 8, 8, '#fff', 1, '#2f7cf6');
    }
    // laser head
    const [hx, hy] = this.toScreen(this.state.x, this.state.y);
    ctx.strokeStyle = this.state.s > 0 ? '#ff2d2d' : '#e0453a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.moveTo(hx - 12, hy);
    ctx.lineTo(hx + 12, hy);
    ctx.moveTo(hx, hy - 12);
    ctx.lineTo(hx, hy + 12);
    ctx.stroke();
    if (this.state.s > 0) {
      ctx.fillStyle = 'rgba(255,40,40,0.6)';
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // rulers
    ui.rect(x0, y0, cw, 18, '#202328');
    ui.rect(x0, y0, 22, ch, '#202328');
    for (let mm = 0; mm <= 400; mm += 50) {
      const [rx] = this.toScreen(mm, 0);
      const [, ry] = this.toScreen(0, mm);
      if (rx > x0 + 22 && rx < x0 + cw) ui.text(String(mm), rx, y0 + 9, { size: 10, color: '#8d939a', align: 'center' });
      if (ry > y0 + 18 && ry < y0 + ch) ui.text(String(mm), x0 + 11, ry, { size: 9, color: '#8d939a', align: 'center' });
    }
    // view buttons
    if (ui.button('fit', x0 + cw - 80, y0 + 24, 70, 22, 'Einpassen', { size: 11 })) this.fitView();
    this.handleCanvasInput(ui, x0 + 22, y0 + 18, cw - 22, ch - 18);
  }

  drawObject(ui, ctx, o) {
    const v = this.view;
    const toPx = (x, y) => this.toScreen(x, y);
    ctx.save();
    if (o.mode === 'image' && o.type === 'image') {
      ctx.globalAlpha = 0.95;
      drawObjectFill(ctx, o, toPx);
    } else if (o.mode === 'fill' || o.mode === 'image') {
      ctx.fillStyle = '#16181b';
      drawObjectFill(ctx, o, toPx);
    } else {
      ctx.strokeStyle = COLORS[o.mode];
      ctx.lineWidth = 1.4;
      if (!o._outlines || o._outKey !== outKey(o)) {
        o._outlines = objectOutlines(o);
        o._outKey = outKey(o);
      }
      ctx.beginPath();
      for (const p of o._outlines) {
        p.forEach(([x, y], i) => {
          const [sx, sy] = this.toScreen(x, y);
          if (i) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
      }
      ctx.stroke();
    }
    ctx.restore();
    void v;
  }

  handles(o) {
    const [x0, y1] = this.toScreen(o.x, o.y);
    const [x1, y0] = this.toScreen(o.x + o.w, o.y + o.h);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  handleCanvasInput(ui, x, y, w, h) {
    const m = ui.mouse;
    const inside = m.x >= x && m.x < x + w && m.y >= y && m.y < y + h && !this.menuOpen && !this.dialog;
    if (inside && m.wheel) {
      const [mx, my] = this.toMachine(m.x, m.y);
      const f = m.wheel > 0 ? 1 / 1.15 : 1.15;
      this.view.s = Math.max(0.6, Math.min(12, this.view.s * f));
      const [nx, ny] = this.toScreen(mx, my);
      this.view.ox += m.x - nx;
      this.view.oy += m.y - ny;
    }
    if (inside && m.pressed && ui.hot === null) {
      const [X, Y] = this.toMachine(m.x, m.y);
      if (this.tool === 'select') {
        // handles first
        const s = this.selected;
        let hi = -1;
        if (s) this.handles(s).forEach(([hx, hy], i) => {
          if (Math.abs(m.x - hx) < 8 && Math.abs(m.y - hy) < 8) hi = i;
        });
        if (hi >= 0) {
          this.drag = { kind: 'resize', o: s, hi, start: { x: s.x, y: s.y, w: s.w, h: s.h } };
        } else {
          const hit = [...this.objects].reverse().find((o) => X >= o.x && X <= o.x + o.w && Y >= o.y && Y <= o.y + o.h);
          if (hit) {
            this.selected = hit;
            this.drag = { kind: 'move', o: hit, dx: X - hit.x, dy: Y - hit.y };
            if (m.dblclick && hit.type === 'text') this.focusText = true;
          } else {
            this.selected = null;
            this.drag = { kind: 'pan', sx: m.x, sy: m.y, ox: this.view.ox, oy: this.view.oy };
          }
        }
      } else if (this.tool === 'text') {
        const t = this.addObject({ type: 'text', text: 'Text', x: X, y: Y, w: 10, h: 12 });
        t.w = t.h * textAspect(t);
        this.tool = 'select';
        this.focusText = true;
      } else {
        this.drag = { kind: 'create', type: this.tool, X0: X, Y0: Y, X1: X, Y1: Y };
      }
    }
    const d = this.drag;
    if (d && m.down) {
      const [X, Y] = this.toMachine(m.x, m.y);
      if (d.kind === 'move') {
        d.o.x = Math.round((X - d.dx) * 10) / 10;
        d.o.y = Math.round((Y - d.dy) * 10) / 10;
        this.estimateDirty = true;
      } else if (d.kind === 'pan') {
        this.view.ox = d.ox + (m.x - d.sx);
        this.view.oy = d.oy + (m.y - d.sy);
      } else if (d.kind === 'create') {
        d.X1 = X;
        d.Y1 = Y;
      } else if (d.kind === 'resize') {
        const o = d.o;
        const st = d.start;
        const fixed = [[st.x + st.w, st.y], [st.x, st.y], [st.x, st.y + st.h], [st.x + st.w, st.y + st.h]][d.hi];
        let nw = Math.max(2, Math.abs(X - fixed[0]));
        let nh = Math.max(2, Math.abs(Y - fixed[1]));
        if (o.type === 'text' || o.type === 'image' || o.lockAspect) {
          const a = st.w / st.h;
          if (nw / nh > a) nw = nh * a;
          else nh = nw / a;
        }
        o.w = Math.round(nw * 10) / 10;
        o.h = Math.round(nh * 10) / 10;
        o.x = X < fixed[0] ? fixed[0] - o.w : fixed[0];
        o.y = Y < fixed[1] ? fixed[1] - o.h : fixed[1];
        this.estimateDirty = true;
      }
    }
    if (d && d.kind === 'create') {
      const [sx0, sy0] = this.toScreen(Math.min(d.X0, d.X1), Math.max(d.Y0, d.Y1));
      const ctx = ui.ctx;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#2f7cf6';
      ctx.strokeRect(sx0, sy0, Math.abs(d.X1 - d.X0) * this.view.s, Math.abs(d.Y1 - d.Y0) * this.view.s);
      ctx.setLineDash([]);
    }
    if (d && m.released) {
      if (d.kind === 'create') {
        let x0 = Math.min(d.X0, d.X1);
        let y0 = Math.min(d.Y0, d.Y1);
        let ww = Math.abs(d.X1 - d.X0);
        let hh = Math.abs(d.Y1 - d.Y0);
        if (ww < 3 || hh < 3) {
          ww = hh = 40;
          x0 = d.X0 - 20;
          y0 = d.Y0 - 20;
        }
        this.addObject({ type: d.type, x: Math.round(x0 * 10) / 10, y: Math.round(y0 * 10) / 10, w: Math.round(ww * 10) / 10, h: Math.round(hh * 10) / 10 });
        this.tool = 'select';
      }
      this.drag = null;
    }
  }

  drawBottom(ui) {
    const y0 = BOTTOM_Y;
    const hh = STATUS_Y - BOTTOM_Y;
    ui.rect(LEFT_W, y0, RIGHT_X - LEFT_W, hh, '#1e2024');
    ui.rect(LEFT_W, y0, RIGHT_X - LEFT_W, 1, '#2f3338');
    // console
    const cx = LEFT_W + 10;
    const cwid = 520;
    ui.text('Konsole', cx, y0 + 14, { size: 12, color: '#9aa0a6', weight: 600 });
    if (ui.button('clr', cx + cwid - 60, y0 + 4, 60, 20, 'Leeren', { size: 11 })) this.console = [];
    ui.rect(cx, y0 + 28, cwid, hh - 66, '#121417', 3, '#2b2f34');
    const lines = this.console.slice(-Math.floor((hh - 72) / 15));
    lines.forEach((l, i) => {
      const col = l.kind === 'err' ? '#ff6b6b' : l.kind === 'tx' ? '#7fb0ff' : l.kind === 'ok' ? '#7ee2a8' : l.kind === 'sys' ? '#c9b37a' : '#d0d4d9';
      ui.text(l.kind === 'tx' ? `> ${l.text}` : l.text, cx + 6, y0 + 38 + i * 15, { size: 11.5, color: col, family: 'Consolas, "Cascadia Mono", Menlo, monospace', maxW: cwid - 12 });
    });
    const inp = ui.input('cmd', cx, y0 + hh - 32, cwid - 70, 26, this.cmd, { placeholder: 'G-Code oder $-Befehl eingeben, Enter zum Senden', mono: true });
    this.cmd = inp.value;
    const sendClicked = ui.button('send', cx + cwid - 64, y0 + hh - 32, 64, 26, 'Senden');
    if ((inp.submitted || sendClicked) && this.cmd.trim()) {
      const c = this.cmd.trim();
      if (c === '?') this.realtime('?');
      else if (c === '!' || c === '~') this.realtime(c);
      else this.sendLine(c);
      this.cmd = '';
    }
    // jog panel
    const jx = cx + cwid + 16;
    const jw = RIGHT_X - jx - 10;
    ui.text('Bewegen', jx, y0 + 14, { size: 12, color: '#9aa0a6', weight: 600 });
    const bs = 40;
    const gx = jx + 6;
    const gy = y0 + 30;
    if (ui.button('jy+', gx + bs + 4, gy, bs, bs, '▲', { size: 16 })) this.jog(0, 1);
    if (ui.button('jx-', gx, gy + bs + 4, bs, bs, '◀', { size: 16 })) this.jog(-1, 0);
    if (ui.button('jhome', gx + bs + 4, gy + bs + 4, bs, bs, '⌂', { size: 18 })) {
      if (this.connected) this.sendLine('$H');
    }
    if (ui.button('jx+', gx + 2 * (bs + 4), gy + bs + 4, bs, bs, '▶', { size: 16 })) this.jog(1, 0);
    if (ui.button('jy-', gx + bs + 4, gy + 2 * (bs + 4), bs, bs, '▼', { size: 16 })) this.jog(0, -1);
    const rx = gx + 3 * (bs + 4) + 10;
    ui.text('Schritt (mm)', rx, gy + 6, { size: 11, color: '#9aa0a6' });
    this.jogStep = ui.dropdown('jstep', rx, gy + 16, jw - (rx - jx) - 4, 24, [0.1, 1, 5, 10, 50, 100].map((v) => ({ value: v, label: `${v} mm` })), this.jogStep);
    ui.text('Geschw. (mm/min)', rx, gy + 54, { size: 11, color: '#9aa0a6' });
    this.jogFeed = ui.dropdown('jfeed', rx, gy + 64, jw - (rx - jx) - 4, 24, [500, 1000, 3000, 6000, 10000].map((v) => ({ value: v, label: `${v}` })), this.jogFeed);
    // test fire (hold)
    const fr = ui.region('fire', rx, gy + 100, jw - (rx - jx) - 4, 28);
    ui.rect(rx, gy + 100, jw - (rx - jx) - 4, 28, fr.active ? '#c9323a' : fr.hover ? '#4a3034' : '#3a2b2e', 4, '#7a3a40');
    ui.text(fr.active ? 'FEUER (1 %)' : 'Laser testen (halten)', rx + (jw - (rx - jx) - 4) / 2, gy + 114, { size: 11.5, align: 'center', color: '#ffd7d7' });
    if (fr.pressed) {
      this.firing = true;
      this.fireTest(true);
    }
    if (this.firing && !ui.mouse.down) {
      this.firing = false;
      this.fireTest(false);
    }
    if (ui.button('origin', gx, gy + 3 * (bs + 4) + 4, 3 * bs + 8, 24, 'Gehe zu X0 Y0', { size: 11 })) {
      if (this.connected) this.sendLine('G90 G0 X0 Y0');
    }
  }

  drawRight(ui) {
    const x = RIGHT_X;
    const w = W - RIGHT_X;
    ui.rect(x, TOP, w, STATUS_Y - TOP, '#202328');
    ui.rect(x, TOP, 1, STATUS_Y - TOP, '#2f3338');
    let y = TOP + 12;
    const pad = 14;
    const iw = w - pad * 2;
    // --- Laser / connection
    ui.text('Laser', x + pad, y + 4, { size: 13, weight: 700 });
    y += 18;
    const ports = this.portAvailable() ? [{ value: 'COM3', label: 'COM3 – USB-SERIAL CH340' }] : [{ value: 'COM3', label: '(kein Gerät gefunden)' }];
    this.port = ui.dropdown('port', x + pad, y, iw - 110, 26, ports, 'COM3');
    if (this.connected) {
      if (ui.button('disc', x + pad + iw - 104, y, 104, 26, 'Trennen')) this.disconnect();
    } else if (ui.button('conn', x + pad + iw - 104, y, 104, 26, 'Verbinden', { primary: true })) this.connect();
    y += 36;
    const st = this.state;
    const statusCol = !this.connected ? '#8a9097' : st.status.startsWith('Alarm') ? '#ff6b6b' : st.status === 'Run' || st.status === 'Jog' || st.status === 'Home' ? '#ffb454' : st.status.startsWith('Hold') ? '#ffd166' : '#7ee2a8';
    ui.rect(x + pad, y, iw, 46, '#16181b', 4, '#2b2f34');
    ui.text(this.connected ? st.status : 'Getrennt', x + pad + 10, y + 14, { size: 14, weight: 700, color: statusCol });
    ui.text(`X ${st.x.toFixed(2)}   Y ${st.y.toFixed(2)}`, x + pad + 10, y + 33, { size: 12, color: '#c5cad0', family: 'Consolas, Menlo, monospace' });
    ui.text(this.connected ? `F ${st.f}  S ${st.s}` : '', x + pad + iw - 10, y + 33, { size: 12, color: st.s > 0 ? '#ff7b7b' : '#8a9097', align: 'right', family: 'Consolas, Menlo, monospace' });
    y += 56;
    const bw = (iw - 12) / 3;
    if (ui.button('home', x + pad, y, bw, 28, 'Home')) this.connected ? this.sendLine('$H') : this.requireIdle();
    if (ui.button('unlock', x + pad + bw + 6, y, bw, 28, 'Entsperren')) this.connected ? this.sendLine('$X') : this.requireIdle();
    if (ui.button('frame', x + pad + 2 * (bw + 6), y, bw, 28, 'Rahmen', { disabled: !!this.job })) this.startJob(true);
    y += 34;
    const running = !!this.job && !this.job.frame;
    if (ui.button('start', x + pad, y, bw, 32, 'Start', { primary: true, disabled: !!this.job })) this.startJob(false);
    if (ui.button('pause', x + pad + bw + 6, y, bw, 32, this.job?.paused ? 'Weiter' : 'Pause', { disabled: !this.job })) this.pauseJob();
    if (ui.button('stop', x + pad + 2 * (bw + 6), y, bw, 32, 'Stopp', { danger: true, disabled: !this.connected })) this.stopJob();
    y += 42;
    // progress
    const j = this.job;
    const prog = j ? j.acked / Math.max(1, j.total) : 0;
    ui.rect(x + pad, y, iw, 8, '#2b2f34', 4);
    ui.rect(x + pad, y, iw * prog, 8, j?.frame ? '#ffb454' : '#2f7cf6', 4);
    y += 20;
    if (running) {
      const rem = this.estimate ? Math.max(0, this.estimate * (1 - prog)) : 0;
      ui.text(`${Math.floor(prog * 100)} %  ·  ${fmtTime(j.elapsed)} vergangen  ·  noch ~${fmtTime(rem)}`, x + pad, y, { size: 12, color: '#c5cad0' });
    } else if (j?.frame) ui.text('Rahmen wird abgefahren …', x + pad, y, { size: 12, color: '#ffb454' });
    else ui.text(this.estimate ? `Geschätzte Dauer: ${fmtTime(this.estimate)}  ·  ${this.estimateLines} Zeilen` : 'Keine Objekte', x + pad, y, { size: 12, color: '#9aa0a6' });
    y += 22;
    ui.rect(x + pad, y, iw, 1, '#2f3338');
    y += 12;

    // --- object settings
    const o = this.selected;
    if (!o) {
      ui.text('Projekt', x + pad, y + 4, { size: 13, weight: 700 });
      y += 22;
      const hints = [
        'Werkzeuge links: Formen aufziehen, Text setzen,',
        'Bild importieren. Objekte anklicken zum Bearbeiten.',
        'Ablauf: Verbinden → Home → Rahmen → Start.',
        'Fokus prüfen! (Fokus-Lehre am Lasermodul)'
      ];
      hints.forEach((t) => {
        ui.text(t, x + pad, y, { size: 12, color: '#9aa0a6' });
        y += 18;
      });
      y += 8;
      ui.text('Beispiele', x + pad, y, { size: 12, weight: 600, color: '#c5cad0' });
      y += 14;
      if (ui.button('ex1', x + pad, y, iw, 28, 'Namensschild (gravieren + ausschneiden)')) this.loadExample('sign');
      y += 34;
      if (ui.button('ex2', x + pad, y, iw, 28, 'Mandala als Bild gravieren')) this.loadExample('mandala');
      y += 34;
      if (ui.button('ex3', x + pad, y, iw, 28, 'Stern ausschneiden')) this.loadExample('star');
      y += 40;
      this.drawObjectList(ui, x + pad, y, iw);
      return;
    }
    ui.text(`${o.name}`, x + pad, y + 4, { size: 13, weight: 700, maxW: iw - 90 });
    if (ui.button('del', x + pad + iw - 80, y - 6, 80, 22, 'Löschen', { size: 11 })) {
      this.deleteSelected();
      return;
    }
    y += 22;
    // mode segmented
    const modes = o.type === 'image' ? ['image', 'line'] : ['line', 'fill', 'cut'];
    const mw = (iw - (modes.length - 1) * 4) / modes.length;
    modes.forEach((md, i) => {
      if (ui.button(`mode-${md}`, x + pad + i * (mw + 4), y, mw, 26, MODE_LABEL[md], { active: o.mode === md, size: 12 })) {
        o.mode = md;
        this.applyPreset(o);
      }
    });
    y += 34;
    // material preset
    const mats = LASER_MATERIALS.map((m) => ({ value: m.id, label: m.name }));
    ui.text('Materialvorgabe', x + pad, y + 6, { size: 11, color: '#9aa0a6' });
    const curMat = this.dev.workpiece?.def.id || LASER_MATERIALS[0].id;
    const picked = ui.dropdown('matpre', x + pad + 110, y - 4, iw - 110, 24, mats, o.preset || curMat);
    if (picked !== (o.preset || curMat)) {
      o.preset = picked;
      this.applyPreset(o);
    }
    y += 30;
    ui.text(`Geschwindigkeit: ${o.speed} mm/min`, x + pad, y, { size: 12 });
    y += 14;
    const sp = ui.slider('speed', x + pad + 6, y + 6, iw - 12, o.speed, 100, 12000, 100);
    if (sp !== o.speed) {
      o.speed = sp;
      this.estimateDirty = true;
    }
    y += 22;
    ui.text(`Leistung: ${o.power} %  (${((o.power / 100) * 10).toFixed(1)} W optisch)`, x + pad, y, { size: 12 });
    y += 14;
    const pw = ui.slider('power', x + pad + 6, y + 6, iw - 12, o.power, 0, 100, 1, { color: '#e5484d' });
    if (pw !== o.power) o.power = pw;
    y += 22;
    ui.text('Durchgänge', x + pad, y + 8, { size: 12 });
    if (ui.button('pm', x + pad + 110, y - 4, 26, 24, '−')) o.passes = Math.max(1, o.passes - 1), (this.estimateDirty = true);
    ui.text(String(o.passes), x + pad + 152, y + 8, { size: 13, align: 'center', weight: 600 });
    if (ui.button('pp', x + pad + 168, y - 4, 26, 24, '+')) o.passes = Math.min(20, o.passes + 1), (this.estimateDirty = true);
    o.air = ui.checkbox('air', x + pad + 220, y + 8, 'Luft (M8)', o.air);
    y += 30;
    if (o.mode === 'fill' || o.mode === 'image') {
      ui.text('Linienabstand', x + pad, y + 6, { size: 12 });
      const iv = ui.dropdown('interval', x + pad + 110, y - 4, 110, 24, [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.3].map((v) => ({ value: v, label: `${v} mm` })), o.interval);
      if (iv !== o.interval) {
        o.interval = iv;
        this.estimateDirty = true;
      }
      y += 30;
    }
    if (o.type === 'image' && o.mode === 'image') {
      ui.text('Bildmodus', x + pad, y + 6, { size: 12 });
      o.dither = ui.dropdown('dither', x + pad + 110, y - 4, iw - 110, 24, [
        { value: 'jarvis', label: 'Jarvis (Dithering)' },
        { value: 'floyd', label: 'Floyd-Steinberg' },
        { value: 'threshold', label: 'Schwellwert' },
        { value: 'gray', label: 'Graustufen' }
      ], o.dither);
      y += 30;
      o.invert = ui.checkbox('inv', x + pad, y + 6, 'Invertieren', !!o.invert);
      y += 24;
    }
    if (o.type === 'text') {
      ui.text('Text', x + pad, y + 6, { size: 12 });
      const inp = ui.input('txt', x + pad + 110, y - 6, iw - 110, 26, o.text);
      if (this.focusText) {
        ui.focus = 'txt';
        ui.focusHit = true;
        this.focusText = false;
      }
      if (inp.value !== o.text) {
        const ratio = o.h;
        o.text = inp.value;
        o.w = ratio * textAspect(o);
        this.estimateDirty = true;
      }
      y += 30;
      ui.text('Schrift', x + pad, y + 6, { size: 12 });
      const f = ui.dropdown('font', x + pad + 110, y - 4, iw - 190, 24, FONTS, o.font);
      if (f !== o.font) {
        o.font = f;
        o.w = o.h * textAspect(o);
        this.estimateDirty = true;
      }
      const b = ui.checkbox('bold', x + pad + iw - 70, y + 8, 'Fett', o.bold);
      if (b !== o.bold) {
        o.bold = b;
        o.w = o.h * textAspect(o);
      }
      y += 30;
    }
    // geometry
    ui.text('Position / Größe (mm)', x + pad, y + 4, { size: 12, color: '#9aa0a6' });
    y += 14;
    const fw = (iw - 18) / 4;
    const fields = [['X', 'x'], ['Y', 'y'], ['B', 'w'], ['H', 'h']];
    const commit = (k, str) => {
      const v = parseFloat(str);
      this.geoEdit = null;
      if (Number.isNaN(v)) return;
      if ((k === 'w' || k === 'h') && (o.type === 'text' || o.type === 'image')) {
        const a = o.w / o.h;
        if (k === 'w') {
          o.w = Math.max(1, v);
          o.h = o.w / a;
        } else {
          o.h = Math.max(1, v);
          o.w = o.h * a;
        }
      } else o[k] = k === 'w' || k === 'h' ? Math.max(1, v) : v;
      this.estimateDirty = true;
    };
    fields.forEach(([lab, k], i) => {
      const fx = x + pad + i * (fw + 6);
      ui.text(lab, fx, y + 12, { size: 11, color: '#9aa0a6' });
      const editing = this.geoEdit && this.geoEdit.k === k && this.geoEdit.o === o;
      const shown = editing ? this.geoEdit.value : o[k].toFixed(1);
      const inp = ui.input(`geo-${k}`, fx + 12, y, fw - 12, 24, shown, { numeric: true, size: 12 });
      if (inp.submitted) commit(k, inp.value);
      else if (inp.focused && ui.focus === `geo-${k}`) this.geoEdit = { k, o, value: inp.value };
      else if (editing) commit(k, this.geoEdit.value);
    });
    y += 34;
    this.drawObjectList(ui, x + pad, y, iw);
  }

  drawObjectList(ui, x, y, w) {
    const maxY = STATUS_Y - 10;
    if (y > maxY - 40) return;
    ui.text(`Objekte (${this.objects.length})`, x, y, { size: 12, weight: 600, color: '#c5cad0' });
    y += 12;
    for (const o of this.objects) {
      if (y > maxY - 22) break;
      const r = ui.region(`obj-${o.id}`, x, y, w, 22);
      ui.rect(x, y, w, 22, o === this.selected ? '#2f5fa8' : r.hover ? '#2b2f34' : null, 3);
      ui.rect(x + 6, y + 7, 8, 8, COLORS[o.mode], 2);
      ui.text(`${o.name}`, x + 20, y + 11, { size: 12, maxW: w - 150 });
      ui.text(`${MODE_LABEL[o.mode]} · ${o.speed} · ${o.power}% ×${o.passes}`, x + w - 6, y + 11, { size: 11, color: '#9aa0a6', align: 'right' });
      if (r.clicked) this.selected = o;
      y += 24;
    }
  }

  applyPreset(o) {
    const mat = LASER_MATERIALS.find((m) => m.id === (o.preset || this.dev.workpiece?.def.id)) || LASER_MATERIALS[0];
    const p = mat.presets[o.mode] || mat.presets.line;
    o.speed = p.speed;
    o.power = p.power;
    o.passes = p.passes || 1;
    if (p.interval) o.interval = p.interval;
    this.estimateDirty = true;
  }

  drawStatus(ui) {
    ui.rect(0, STATUS_Y, W, 22, '#2f7cf6');
    const st = this.state;
    const parts = [
      this.connected ? `${this.port} · ${BAUD} Baud · Verbunden` : 'Nicht verbunden',
      this.connected ? `Status: ${st.status}` : '',
      this.connected ? `X ${st.x.toFixed(3)}  Y ${st.y.toFixed(3)}` : '',
      this.connected ? (st.s > 0 ? `Laser AN (S${st.s})` : 'Laser AUS') : '',
      'Gerät: Ortur Laser Master 3 (GRBL)'
    ].filter(Boolean);
    ui.text(parts.join('     ·     '), 10, STATUS_Y + 11, { size: 12, color: '#fff' });
  }

  drawDialog(ui) {
    const d = this.dialog;
    ui.rect(0, 0, W, H, 'rgba(0,0,0,0.45)');
    const w = 520;
    const lines = d.text.split('\n');
    const h = 110 + lines.length * 20;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    ui.rect(x, y, w, h, '#25282d', 8, '#3c4148');
    ui.text(d.title, x + 20, y + 26, { size: 15, weight: 700 });
    lines.forEach((l, i) => ui.text(l, x + 20, y + 58 + i * 20, { size: 13, color: '#c9ced4', maxW: w - 40 }));
    const bw = 140;
    ui.blockInput = false;
    d.buttons.forEach((b, i) => {
      const bx = x + w - 20 - (d.buttons.length - i) * (bw + 8) + 8;
      // dialog must take precedence: temporarily allow regions
      if (ui.button(`dlg-${i}`, bx, y + h - 44, bw, 30, b.label, { primary: b.primary })) {
        this.dialog = null;
        b.act?.();
      }
    });
  }
}

function outKey(o) {
  return `${o.type}|${o.x}|${o.y}|${o.w}|${o.h}|${o.text}|${o.font}|${o.bold}|${o.radius}`;
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
