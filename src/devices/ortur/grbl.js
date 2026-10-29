import { Planner } from '../../core/planner.js';
import { parseGcodeLine } from '../../core/gcode.js';

// ---------------------------------------------------------------------------
// GRBL 1.1 emulation as found on the Ortur Laser Master 3 (OLF firmware).
// Serial protocol: line based, "ok"/"error:N" responses, 128 byte RX buffer,
// real-time commands (?, !, ~, ctrl-x, jog cancel, overrides).
// ---------------------------------------------------------------------------

export const GRBL_ERRORS = {
  1: 'G-code words consist of a letter and a value. Letter was not found.',
  2: 'Numeric value format is not valid or missing an expected value.',
  3: "Grbl '$' system command was not recognized or supported.",
  8: "Grbl '$' command cannot be used unless Grbl is IDLE.",
  9: 'G-code locked out during alarm or jog state.',
  15: 'Jog target exceeds machine travel. Command ignored.',
  16: "Jog command with no '=' or contains prohibited g-code.",
  20: 'Unsupported or invalid g-code command found in block.',
  22: 'Feed rate has not yet been set or is undefined.',
  24: 'Two G-code commands that both require the use of the XYZ axis words were detected in the block.',
  33: 'The motion command has an invalid target.'
};

export const GRBL_ALARMS = {
  1: 'Hard limit triggered.',
  2: 'G-code motion target exceeds machine travel.',
  3: 'Reset while in motion. Grbl cannot guarantee position.',
  8: 'Homing fail. Cycle failed to clear limit switch.',
  9: 'Homing fail. Could not find limit switch.',
  10: 'Emergency stop pressed.'
};

const DEFAULT_SETTINGS = {
  0: 10, 1: 255, 2: 0, 3: 2, 4: 0, 5: 0, 6: 0, 10: 1, 11: 0.01, 12: 0.002, 13: 0,
  20: 1, 21: 0, 22: 1, 23: 0, 24: 1000, 25: 3000, 26: 100, 27: 1,
  30: 1000, 31: 0, 32: 1,
  100: 80, 101: 80, 102: 80, 110: 20000, 111: 20000, 112: 1000,
  120: 2500, 121: 2500, 122: 500, 130: 400, 131: 400, 132: 1
};

export class Grbl {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.settings = { ...DEFAULT_SETTINGS };
    this.powered = false;
    this.rx = []; // pending input lines
    this.rxChars = 0;
    this.out = []; // queued output lines (to host)
    this.planner = new Planner({ axes: 3, maxBlocks: 15, minSpeed: 0.1 });
    this.planner.onBlockEnd = () => {};
    this.applySettings();
    this.reset(true);
    this.mpos = new Float64Array(3);
    this.vel = new Float64Array(3);
  }

  applySettings() {
    const s = this.settings;
    const c = this.planner.cfg;
    c.maxFeed = [s[110] / 60, s[111] / 60, s[112] / 60];
    c.maxAccel = [s[120], s[121], s[122]];
    c.accel = Math.min(s[120], s[121]);
    c.travelAccel = c.accel;
    c.jd = s[11];
  }

  reset(cold = false) {
    this.planner.abort();
    this.rx = [];
    this.rxChars = 0;
    this.modal = { motion: 'G0', abs: true, units: 21, plane: 17, wcs: 54, feedMode: 94, spindle: 'M5', coolant: 'M9', laserOn: false };
    this.feed = 0;
    this.s = 0;
    this.wco = this.wco || [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    this.g92 = [0, 0, 0];
    this.g28 = this.g28 || [0, 0, 0];
    this.g30 = this.g30 || [0, 0, 0];
    this.hold = false;
    this.holdComplete = false;
    this.jogging = false;
    this.homing = null;
    this.checkMode = false;
    this.feedOv = 100;
    this.rapidOv = 100;
    this.spindleOv = 100;
    this.sleep = false;
    this.programEnd = false;
    if (!cold) this.hooks.onReset?.();
  }

  // ---------------------------------------------------------------- power
  setPower(on) {
    if (on === this.powered) return;
    this.powered = on;
    this.planner.abort();
    if (on) {
      this.reset();
      this.alarm = this.settings[22] ? 'locked' : null;
      this.homed = false;
      this.bootTimer = 1.2;
      this.booted = false;
    } else {
      this.out = [];
      this.alarm = null;
    }
  }

  // ------------------------------------------------------------- serial in
  get rxFree() {
    return 127 - this.rxChars;
  }

  // Characters arriving on the serial port (line terminated by \n)
  receive(str) {
    if (!this.powered || !this.booted) return;
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      // real-time commands bypass the buffer
      if (ch === '?') {
        this.sendStatus();
        continue;
      }
      if (ch === '!') {
        this.feedHold();
        continue;
      }
      if (ch === '~') {
        this.cycleStart();
        continue;
      }
      if (code === 0x18) {
        this.softReset();
        continue;
      }
      if (code === 0x85) {
        if (this.jogging) this.jogCancel();
        continue;
      }
      if (code >= 0x90 && code <= 0x9d) {
        this.override(code);
        continue;
      }
      if (ch === '\r') continue;
      this.lineBuf = (this.lineBuf || '') + ch;
      if (ch === '\n') {
        const line = this.lineBuf.slice(0, -1);
        this.lineBuf = '';
        this.rx.push(line);
        this.rxChars += line.length + 1;
      }
    }
  }

  emit(line) {
    this.hooks.onOutput?.(line);
  }

  // ------------------------------------------------------------- status
  get state() {
    if (!this.powered) return 'Off';
    if (this.estop) return 'Alarm';
    if (this.alarm) return 'Alarm';
    if (this.sleep) return 'Sleep';
    if (this.homing) return 'Home';
    if (this.checkMode) return 'Check';
    if (this.hold) return this.holdComplete ? 'Hold:0' : 'Hold:1';
    if (this.jogging) return 'Jog';
    if (!this.planner.idle) return 'Run';
    return 'Idle';
  }

  sendStatus() {
    const p = this.planner.position(this.mpos);
    const v = this.planner.velocity() * 60;
    const b = this.planner.cur;
    const sNow = b && b.meta.laser ? Math.round(b.meta.s) : this.modal.laserOn && this.settings[32] === 0 ? this.s : 0;
    let st = `<${this.state}|MPos:${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}|FS:${Math.round(v)},${sNow}`;
    this.statusCount = (this.statusCount || 0) + 1;
    if (this.statusCount % 10 === 1) {
      const w = this.wcoTotal();
      st += `|WCO:${w[0].toFixed(3)},${w[1].toFixed(3)},${w[2].toFixed(3)}`;
    } else if (this.statusCount % 10 === 2) st += `|Ov:${this.feedOv},${this.rapidOv},${this.spindleOv}`;
    if (this.estop) st += '|Pn:E';
    this.emit(`${st}>`);
  }

  wcoTotal() {
    const w = this.wco[this.modal.wcs - 54];
    return [w[0] + this.g92[0], w[1] + this.g92[1], w[2] + this.g92[2]];
  }

  // ------------------------------------------------------------- realtime
  feedHold() {
    if (this.alarm || this.hold) return;
    if (this.jogging) {
      this.jogCancel();
      return;
    }
    if (this.planner.idle) return;
    this.hold = true;
    this.holdComplete = false;
    // remember the rest of the planned motion so it can resume after '~'
    const q = this.planner.queue;
    this.heldBlocks = q.map((b) => ({
      target: Array.from(b.start, (v, i) => v + b.delta[i]),
      feed: b.meta.feed || b.nominal,
      meta: b.meta,
      dwell: b.dwell
    }));
    this.planner.hold();
  }

  cycleStart() {
    if (this.hold && this.holdComplete) {
      this.hold = false;
      this.holdComplete = false;
      // re-queue the remaining program lines are still in rx; motion resumes
      if (this.heldBlocks) {
        for (const b of this.heldBlocks) {
          if (b.dwell !== undefined) this.planner.addDwell(b.dwell, b.meta);
          else this.planner.addMove(b.target, b.feed, b.meta);
        }
        this.heldBlocks = null;
      }
    }
  }

  softReset() {
    const moving = !this.planner.idle;
    this.planner.abort();
    this.reset();
    this.lineBuf = '';
    if (moving) {
      this.alarm = 3;
      this.emit('ALARM:3');
    }
    this.emit('');
    this.emit("Grbl 1.1f ['$' for help]");
    this.emit('[MSG:Ortur Laser Master 3 Ready!]');
    if (this.estop) this.emit('[MSG:Emergency stop! Release button and reset]');
    if (this.alarm || (this.settings[22] && !this.homed)) {
      if (!this.alarm) this.alarm = 'locked';
      this.emit("[MSG:'$H'|'$X' to unlock]");
    }
  }

  jogCancel() {
    this.planner.hold();
    this.jogCancelPending = true;
  }

  override(code) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    switch (code) {
      case 0x90: this.feedOv = 100; break;
      case 0x91: this.feedOv = clamp(this.feedOv + 10, 10, 200); break;
      case 0x92: this.feedOv = clamp(this.feedOv - 10, 10, 200); break;
      case 0x93: this.feedOv = clamp(this.feedOv + 1, 10, 200); break;
      case 0x94: this.feedOv = clamp(this.feedOv - 1, 10, 200); break;
      case 0x95: this.rapidOv = 100; break;
      case 0x96: this.rapidOv = 50; break;
      case 0x97: this.rapidOv = 25; break;
      case 0x99: this.spindleOv = 100; break;
      case 0x9a: this.spindleOv = clamp(this.spindleOv + 10, 10, 200); break;
      case 0x9b: this.spindleOv = clamp(this.spindleOv - 10, 10, 200); break;
      case 0x9c: this.spindleOv = clamp(this.spindleOv + 1, 10, 200); break;
      case 0x9d: this.spindleOv = clamp(this.spindleOv - 1, 10, 200); break;
      default: break;
    }
  }

  // emergency stop button (Ortur: halts motion, laser off, alarm)
  setEstop(pressed) {
    if (pressed === !!this.estop) return;
    this.estop = pressed;
    if (!this.powered) return;
    if (pressed) {
      this.planner.abort();
      this.rx = [];
      this.rxChars = 0;
      this.hold = false;
      this.jogging = false;
      this.homing = null;
      this.modal.laserOn = false;
      this.alarm = 10;
      this.emit('ALARM:10');
      this.emit('[MSG:Emergency stop! Release button and reset]');
    } else {
      this.emit('[MSG:Emergency stop released. Reset to continue]');
    }
  }

  // ------------------------------------------------------------- main loop
  update(dt) {
    if (!this.powered) return;
    if (!this.booted) {
      this.bootTimer -= dt;
      if (this.bootTimer <= 0) {
        this.booted = true;
        this.emit("Grbl 1.1f ['$' for help]");
        this.emit('[MSG:Ortur Laser Master 3 Ready!]');
        if (this.alarm) this.emit("[MSG:'$H'|'$X' to unlock]");
        this.hooks.onBoot?.();
      }
      return;
    }
    // homing sequence
    if (this.homing) this.updateHoming(dt);
    // process rx lines while planner has room
    let guard = 0;
    while (this.rx.length && !this.planner.full && !this.homing && guard++ < 64) {
      if (this.hold) break;
      const line = this.rx.shift();
      this.rxChars -= line.length + 1;
      this.execLine(line);
    }
    this.planner.update(dt);
    if (this.hold && !this.holdComplete && this.planner.idle) {
      this.holdComplete = true;
    }
    if (this.jogCancelPending && this.planner.idle) {
      this.jogCancelPending = false;
      this.jogging = false;
    }
    if (this.jogging && this.planner.idle && !this.rx.some((l) => l.startsWith('$J='))) this.jogging = false;
  }

  // ------------------------------------------------------------- commands
  execLine(raw) {
    const line = raw.trim();
    if (!line) {
      this.emit('ok');
      return;
    }
    if (line[0] === '$') return this.systemCommand(line);
    if (this.estop) return this.emit('error:9');
    if (this.alarm) return this.emit('error:9');
    if (this.jogging && !line.startsWith('$J')) return this.emit('error:9');
    if (this.sleep) return this.emit('error:9');
    // allow multiple G/M words in one line (GRBL style)
    const r = this.execGcode(line);
    if (r) this.emit(`error:${r}`);
    else this.emit('ok');
  }

  systemCommand(line) {
    const up = line.toUpperCase();
    const idle = this.state === 'Idle' || this.state === 'Alarm' || this.state === 'Check';
    if (up === '$') {
      this.emit('[HLP:$$ $# $G $I $N $x=val $Nx=line $J=line $SLP $C $X $H ~ ! ? ctrl-x]');
      return this.emit('ok');
    }
    if (up === '$$') {
      for (const [k, v] of Object.entries(this.settings)) this.emit(`$${k}=${Number.isInteger(v) ? v : v.toFixed(3)}`);
      return this.emit('ok');
    }
    if (up === '$#') {
      ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].forEach((g, i) => this.emit(`[${g}:${this.wco[i].map((v) => v.toFixed(3)).join(',')}]`));
      this.emit(`[G28:${this.g28.map((v) => v.toFixed(3)).join(',')}]`);
      this.emit(`[G30:${this.g30.map((v) => v.toFixed(3)).join(',')}]`);
      this.emit(`[G92:${this.g92.map((v) => v.toFixed(3)).join(',')}]`);
      this.emit('[TLO:0.000]');
      this.emit('[PRB:0.000,0.000,0.000:0]');
      return this.emit('ok');
    }
    if (up === '$G') {
      const m = this.modal;
      this.emit(`[GC:${m.motion} G${m.wcs} G${m.plane} G${m.units} G${m.abs ? 90 : 91} G${m.feedMode} ${m.spindle} ${m.coolant} T0 F${this.feed} S${this.s}]`);
      return this.emit('ok');
    }
    if (up === '$I') {
      this.emit('[VER:1.1f.20220517:OLM3]');
      this.emit('[OPT:VZ,35,254]');
      this.emit('[MSG:Machine: Ortur Laser Master 3]');
      this.emit('[MSG:Model: OLM3 | OLF 2.0.5]');
      return this.emit('ok');
    }
    if (up === '$N') {
      this.emit('$N0=');
      this.emit('$N1=');
      return this.emit('ok');
    }
    if (up === '$X') {
      if (this.estop) return this.emit('error:9');
      if (this.alarm) {
        this.alarm = null;
        this.emit('[MSG:Caution: Unlocked]');
      }
      return this.emit('ok');
    }
    if (up === '$H') {
      if (this.estop) return this.emit('error:9');
      if (!this.settings[22]) return this.emit('error:5');
      this.startHoming();
      return;
    }
    if (up === '$C') {
      this.checkMode = !this.checkMode;
      this.emit(this.checkMode ? '[MSG:Enabled]' : '[MSG:Disabled]');
      if (!this.checkMode) this.softReset();
      return this.emit('ok');
    }
    if (up === '$SLP') {
      this.sleep = true;
      this.emit('[MSG:Sleeping]');
      return this.emit('ok');
    }
    if (up.startsWith('$RST=')) {
      if (up === '$RST=$' || up === '$RST=*') this.settings = { ...DEFAULT_SETTINGS };
      if (up === '$RST=#' || up === '$RST=*') this.wco = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
      this.applySettings();
      this.emit('[MSG:Restoring defaults]');
      return this.emit('ok');
    }
    if (up.startsWith('$J=')) {
      if (this.alarm || this.estop) return this.emit('error:9');
      if (this.state !== 'Idle' && this.state !== 'Jog') return this.emit('error:8');
      const r = this.jog(line.slice(3));
      return this.emit(r ? `error:${r}` : 'ok');
    }
    const m = up.match(/^\$(\d+)=(-?[\d.]+)$/);
    if (m) {
      if (!idle) return this.emit('error:8');
      const k = +m[1];
      if (!(k in this.settings)) return this.emit('error:3');
      this.settings[k] = parseFloat(m[2]);
      this.applySettings();
      return this.emit('ok');
    }
    const n = up.match(/^\$N(\d)=(.*)$/);
    if (n) return this.emit('ok');
    return this.emit('error:3');
  }

  // ------------------------------------------------------------- homing
  startHoming() {
    this.alarm = null;
    this.homing = { phase: 0 };
    this.planner.abort();
    this.planner.setPosition([this.planner.pos[0], this.planner.pos[1], 0]);
  }

  updateHoming() {
    const h = this.homing;
    const s = this.settings;
    if (!this.planner.idle) return;
    const seek = s[25] / 60;
    const slow = s[24] / 60;
    const pull = s[27];
    const p = this.planner.pos;
    switch (h.phase) {
      case 0:
        // seek both axes towards the switches (front-left corner, slightly beyond 0)
        this.planner.addMove([Math.min(p[0], -0.8), Math.min(p[1], -0.8), 0], seek, { homing: true });
        h.phase = 1;
        break;
      case 1:
        this.hooks.onLimit?.();
        this.planner.setPosition([-0.8, -0.8, 0]);
        this.planner.addMove([pull, pull, 0], slow * 2, { homing: true });
        h.phase = 2;
        break;
      case 2:
        this.planner.addMove([-0.8, -0.8, 0], slow, { homing: true });
        h.phase = 3;
        break;
      case 3:
        this.hooks.onLimit?.();
        this.planner.addMove([0, 0, 0], slow * 2, { homing: true });
        h.phase = 4;
        break;
      default:
        this.planner.setPosition([0, 0, 0]);
        this.homing = null;
        this.homed = true;
        this.emit('ok');
        break;
    }
  }

  // ------------------------------------------------------------- G-code
  toMachine(axisVals, abs) {
    const w = this.wcoTotal();
    const scale = this.modal.units === 20 ? 25.4 : 1;
    const p = this.planner.pos;
    const t = [p[0], p[1], p[2]];
    ['X', 'Y', 'Z'].forEach((k, i) => {
      if (axisVals[k] === undefined) return;
      const v = axisVals[k] * scale;
      t[i] = abs ? v + w[i] : p[i] + v;
    });
    return t;
  }

  checkLimits(t) {
    if (!this.settings[20]) return true;
    const max = [this.settings[130], this.settings[131], this.settings[132]];
    for (let i = 0; i < 2; i++) if (t[i] < -1 || t[i] > max[i] + 1) return false;
    return true;
  }

  jog(rest) {
    // e.g. "G91 X10 F1000" or "G90 G21 X50 Y20 F3000"
    const words = rest.toUpperCase().match(/[A-Z]-?[\d.]+/g) || [];
    let abs = this.modal.abs;
    let units = this.modal.units;
    let mach = false;
    const v = {};
    let f;
    for (const wd of words) {
      const L = wd[0];
      const n = parseFloat(wd.slice(1));
      if (L === 'G') {
        if (n === 90) abs = true;
        else if (n === 91) abs = false;
        else if (n === 20 || n === 21) units = n;
        else if (n === 53) mach = true;
        else return 16;
      } else if (L === 'X' || L === 'Y' || L === 'Z') v[L] = n;
      else if (L === 'F') f = n;
      else return 16;
    }
    if (f === undefined) return 22;
    const scale = units === 20 ? 25.4 : 1;
    const p = this.planner.pos;
    const w = mach ? [0, 0, 0] : this.wcoTotal();
    const t = [p[0], p[1], p[2]];
    ['X', 'Y', 'Z'].forEach((k, i) => {
      if (v[k] === undefined) return;
      t[i] = abs ? v[k] * scale + w[i] : p[i] + v[k] * scale;
    });
    if (this.settings[20]) {
      const max = [this.settings[130], this.settings[131], this.settings[132]];
      if (this.homed) {
        for (let i = 0; i < 2; i++) if (t[i] < 0 || t[i] > max[i]) return 15;
      }
    }
    this.jogging = true;
    this.planner.addMove(t, ((f * scale) / 60) * 1, { jog: true });
    return 0;
  }

  execGcode(line) {
    // GRBL accepts several commands per line; split words
    const clean = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').toUpperCase();
    const words = clean.match(/[A-Z]\s*[-+]?(\d+\.?\d*|\.\d+)/g);
    if (!words) {
      if (clean.trim()) return 1;
      return 0;
    }
    const w = {};
    const gs = [];
    const ms = [];
    for (const wd of words) {
      const L = wd[0];
      const n = parseFloat(wd.slice(1).trim());
      if (Number.isNaN(n)) return 2;
      if (L === 'G') gs.push(n);
      else if (L === 'M') ms.push(n);
      else w[L] = n;
    }
    const m = this.modal;
    let motion = null;
    let nonModal = null;
    for (const g of gs) {
      if ([0, 1, 2, 3].includes(g)) motion = `G${g}`;
      else if (g === 4 || g === 10 || g === 28 || g === 30 || g === 53 || g === 92 || g === 28.1 || g === 30.1 || g === 92.1) nonModal = g;
      else if (g === 90) m.abs = true;
      else if (g === 91) m.abs = false;
      else if (g === 20 || g === 21) m.units = g;
      else if (g === 17 || g === 18 || g === 19) m.plane = g;
      else if (g >= 54 && g <= 59) m.wcs = g;
      else if (g === 93 || g === 94) m.feedMode = g;
      else if (g === 40 || g === 49 || g === 91.1 || g === 61) {
        /* accepted */
      } else if (g === 38.2 || g === 38.3 || g === 38.4 || g === 38.5) return 20;
      else return 20;
    }
    for (const mm of ms) {
      if (mm === 3 || mm === 4) {
        m.spindle = `M${mm}`;
        m.laserOn = true;
      } else if (mm === 5) {
        m.spindle = 'M5';
        m.laserOn = false;
      } else if (mm === 7 || mm === 8) {
        m.coolant = `M${mm}`;
        this.hooks.onAir?.(true);
      } else if (mm === 9) {
        m.coolant = 'M9';
        this.hooks.onAir?.(false);
      } else if (mm === 0 || mm === 1) {
        this.feedHold();
      } else if (mm === 2 || mm === 30) {
        m.spindle = 'M5';
        m.laserOn = false;
        m.coolant = 'M9';
        this.hooks.onAir?.(false);
        this.hooks.onProgramEnd?.();
      } else return 20;
    }
    if (w.F !== undefined) this.feed = w.F * (m.units === 20 ? 25.4 : 1);
    if (w.S !== undefined) this.s = Math.max(0, Math.min(this.settings[30], w.S));
    if (this.checkMode) return 0;

    const hasAxis = w.X !== undefined || w.Y !== undefined || w.Z !== undefined;
    if (nonModal !== null) {
      if (nonModal === 4) {
        this.planner.addDwell(w.P || 0, { dwell: true });
        return 0;
      }
      if (nonModal === 92) {
        const p = this.planner.pos;
        const base = this.wco[m.wcs - 54];
        ['X', 'Y', 'Z'].forEach((k, i) => {
          if (w[k] !== undefined) this.g92[i] = p[i] - base[i] - w[k];
        });
        return 0;
      }
      if (nonModal === 92.1) {
        this.g92 = [0, 0, 0];
        return 0;
      }
      if (nonModal === 10) {
        const idx = (w.P || 1) - 1;
        if (idx < 0 || idx > 5) return 20;
        const p = this.planner.pos;
        ['X', 'Y', 'Z'].forEach((k, i) => {
          if (w[k] === undefined) return;
          if (w.L === 20) this.wco[idx][i] = p[i] - w[k] - this.g92[i];
          else this.wco[idx][i] = w[k];
        });
        return 0;
      }
      if (nonModal === 28.1) {
        this.g28 = Array.from(this.planner.pos);
        return 0;
      }
      if (nonModal === 30.1) {
        this.g30 = Array.from(this.planner.pos);
        return 0;
      }
      if (nonModal === 28 || nonModal === 30) {
        const target = nonModal === 28 ? this.g28 : this.g30;
        if (hasAxis) {
          const mid = this.toMachine(w, m.abs);
          this.planner.addMove(mid, this.settings[110] / 60, { rapid: true });
        }
        this.planner.addMove([target[0], target[1], target[2]], this.settings[110] / 60, { rapid: true });
        return 0;
      }
      if (nonModal === 53) {
        if (!hasAxis) return 0;
        const t = this.planner.pos.slice ? Array.from(this.planner.pos) : [...this.planner.pos];
        ['X', 'Y', 'Z'].forEach((k, i) => {
          if (w[k] !== undefined) t[i] = w[k];
        });
        const mot = motion || m.motion;
        return this.queueLinear(t, mot === 'G0');
      }
    }
    if (motion) m.motion = motion;
    if (!hasAxis && !(w.I !== undefined || w.J !== undefined)) return 0;
    const mot = m.motion;
    if (mot === 'G0' || mot === 'G1') {
      const t = this.toMachine(w, m.abs);
      return this.queueLinear(t, mot === 'G0');
    }
    if (mot === 'G2' || mot === 'G3') return this.queueArc(w, mot === 'G2');
    return 0;
  }

  queueLinear(t, rapid) {
    if (!this.checkLimits(t)) {
      this.planner.abort();
      this.alarm = 2;
      this.emit('ALARM:2');
      return 0;
    }
    if (rapid) {
      this.planner.addMove(t, ((this.settings[110] / 60) * this.rapidOv) / 100, { rapid: true });
      return 0;
    }
    if (!this.feed) return 22;
    const feed = ((this.feed / 60) * this.feedOv) / 100;
    this.planner.addMove(t, feed, {
      laser: this.modal.laserOn ? this.modal.spindle : null,
      s: (this.s * this.spindleOv) / 100,
      feed
    });
    return 0;
  }

  queueArc(w, cw) {
    const m = this.modal;
    const scale = m.units === 20 ? 25.4 : 1;
    const wc = this.wcoTotal();
    const p = this.planner.pos;
    const x0 = p[0];
    const y0 = p[1];
    const t = this.toMachine(w, m.abs);
    let cx;
    let cy;
    if (w.R !== undefined) {
      const r = w.R * scale;
      const dx = t[0] - x0;
      const dy = t[1] - y0;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6 || Math.abs(r) < d / 2 - 1e-6) return 33;
      const hh = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const sgn = (cw ? -1 : 1) * (r < 0 ? -1 : 1);
      cx = (x0 + t[0]) / 2 - (sgn * hh * dy) / d;
      cy = (y0 + t[1]) / 2 + (sgn * hh * dx) / d;
    } else {
      cx = x0 + (w.I || 0) * scale;
      cy = y0 + (w.J || 0) * scale;
    }
    void wc;
    const r = Math.hypot(x0 - cx, y0 - cy);
    let a0 = Math.atan2(y0 - cy, x0 - cx);
    const a1 = Math.atan2(t[1] - cy, t[0] - cx);
    let sweep = a1 - a0;
    if (cw && sweep >= -1e-9) sweep -= Math.PI * 2;
    if (!cw && sweep <= 1e-9) sweep += Math.PI * 2;
    const segs = Math.max(1, Math.ceil((Math.abs(sweep) * r) / 0.5));
    if (!this.feed) return 22;
    for (let i = 1; i <= segs; i++) {
      const a = a0 + (sweep * i) / segs;
      const pt = i === segs ? t : [cx + Math.cos(a) * r, cy + Math.sin(a) * r, t[2]];
      const e = this.queueLinear(pt, false);
      if (e) return e;
    }
    return 0;
  }

  // ------------------------------------------------------------- laser
  // current optical power fraction (0..1) of the laser diode
  laserPower() {
    if (!this.powered || this.estop) return 0;
    const b = this.planner.cur;
    if (!b || b.dwell !== undefined) {
      // spindle mode (no laser mode): laser stays on while idle
      if (this.settings[32] === 0 && this.modal.laserOn) return this.s / this.settings[30];
      return 0;
    }
    const meta = b.meta;
    if (!meta.laser || !meta.s) return 0;
    let p = meta.s / this.settings[30];
    if (meta.laser === 'M4' && this.settings[32] === 1) {
      const v = this.planner.vAt(b, b.t);
      p *= Math.min(1, v / Math.max(1e-6, meta.feed));
    }
    return Math.max(0, Math.min(1, p));
  }
}
