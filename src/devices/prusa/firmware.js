import { Planner } from '../../core/planner.js';
import { Heater } from '../../core/heater.js';
import { parseGcodeLine, LineReader } from '../../core/gcode.js';

// ---------------------------------------------------------------------------
// Prusa MK4S firmware emulation (Buddy-like). Executes G-code from files or
// internal commands, drives the planner/heaters and exposes UI state.
// ---------------------------------------------------------------------------

export const MATERIALS = [
  { id: 'PLA', nozzle: 215, bed: 60 },
  { id: 'PETG', nozzle: 230, bed: 85 },
  { id: 'ASA', nozzle: 260, bed: 105 },
  { id: 'PC', nozzle: 275, bed: 110 },
  { id: 'PVB', nozzle: 215, bed: 75 },
  { id: 'ABS', nozzle: 255, bed: 100 },
  { id: 'HIPS', nozzle: 220, bed: 100 },
  { id: 'PP', nozzle: 240, bed: 100 },
  { id: 'FLEX', nozzle: 240, bed: 50 },
  { id: 'PA', nozzle: 285, bed: 100 }
];
export const materialById = (id) => MATERIALS.find((m) => m.id === id) || MATERIALS[0];

const FIL_AREA = Math.PI * 0.875 * 0.875;
const LIMITS = { min: [-2, -9, 0], max: [255, 212, 220] };
const PARK = { x: 242, y: 205 };
export const FW_VERSION = '6.2.4+9214';

export class PrusaFirmware {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.planner = new Planner({
      axes: 4,
      maxFeed: [300, 300, 12, 100],
      maxAccel: [4000, 4000, 200, 2500],
      accel: 2500,
      travelAccel: 4000,
      retractAccel: 1200,
      jd: 0.022,
      maxBlocks: 48
    });
    this.planner.onBlockEnd = (b) => this.onBlockEnd(b);
    this.nozzle = new Heater({ name: 'nozzle', power: 40, capacity: 10.5, loss: 0.072, kp: 0.07, ki: 0.004, kd: 0.1, range: 12, maxTemp: 305, noise: 0.15 });
    this.bed = new Heater({ name: 'bed', power: 200, capacity: 650, loss: 1.45, kp: 0.22, ki: 0.0022, kd: 1.2, range: 4, maxTemp: 125, noise: 0.06 });
    this.powered = false;
    this.mode = 'off';
    this.simTime = 0;
    this.stats = { printTime: 0, filament: 0, prints: 0, x: 0, y: 0, z: 0 };
    this.settings = { fsensor: true, stealth: false, sound: 'loud', lang: 'de', timeFormat: '24h' };
    this.filament = { loaded: true, type: 'PLA', inSensor: true };
    this.reset(true);
    // machine sits in a random but plausible spot when first powered
    this.planner.setPosition([125, 105, 60, 0]);
    this.posCache = new Float64Array(4);
    this.velAxes = new Float64Array(4);
  }

  reset(cold = false) {
    this.planner.abort();
    this.task = null;
    this.taskWait = null;
    this.immediate = [];
    this.job = null;
    this.prompt = null;
    this.answer = null;
    this.wizard = null;
    this.message = '';
    this.absolute = true;
    this.relE = false;
    this.feed = 50; // mm/s
    this.feedPct = 100;
    this.flowPct = 100;
    this.fan = 0; // 0..1
    this.offset = [0, 0, 0, 0];
    this.homed = { x: false, y: false, z: false };
    this.mbl = false;
    this.coldMin = 170;
    this.layerH = 0.2;
    this.layerW = null;
    this.zTop = 0;
    this.zPrev = 0;
    this.printArea = null;
    this.motorsOn = false;
    this.nozzle.setTarget(0);
    this.bed.setTarget(0);
    this.idleTimer = 0;
    this.lastProgress = null;
    if (!cold) this.hooks.onReset?.();
  }

  // ------------------------------------------------------------------ power
  setPower(on) {
    if (on === this.powered) return;
    this.powered = on;
    if (on) {
      this.reset();
      this.mode = 'boot';
      this.bootTime = 3.2;
    } else {
      this.planner.abort();
      this.reset();
      this.mode = 'off';
    }
    this.hooks.onState?.();
  }

  hardReset() {
    if (!this.powered) return;
    this.planner.abort();
    this.reset();
    this.mode = 'boot';
    this.bootTime = 3.2;
    this.hooks.onState?.();
  }

  // ------------------------------------------------------------- positions
  get machinePos() {
    return this.planner.position(this.posCache);
  }

  logical(i) {
    return this.machinePos[i] - this.offset[i];
  }

  get busy() {
    return !!this.task || !this.planner.idle || this.immediate.length > 0;
  }

  get printing() {
    return this.mode === 'printing' || this.mode === 'pausing' || this.mode === 'paused' || this.mode === 'resuming';
  }

  // queue commands from the UI (executed when not printing a file)
  run(cmds) {
    if (typeof cmds === 'string') cmds = cmds.split('\n');
    for (const c of cmds) if (c.trim()) this.immediate.push(c);
  }

  // ------------------------------------------------------------- main loop
  update(dt) {
    if (!this.powered) {
      this.nozzle.setTarget(0);
      this.bed.setTarget(0);
      this.nozzle.update(dt);
      this.bed.update(dt);
      return;
    }
    if (this.mode === 'boot') {
      this.bootTime -= dt;
      this.nozzle.update(dt);
      this.bed.update(dt);
      if (this.bootTime <= 0) {
        this.mode = 'idle';
        this.hooks.onState?.();
        this.hooks.onBooted?.();
      }
      return;
    }
    let rem = dt;
    let guard = 0;
    while (rem > 1e-9 && guard++ < 5000) {
      this.pump();
      const step = Math.min(rem, 0.04);
      this.planner.update(step);
      this.nozzle.extraLoss = 0.03 * this.fan + (this.hooks.hotendFanOn?.() ? 0.004 : 0);
      this.nozzle.update(step);
      this.bed.update(step);
      this.simTime += step;
      if (this.job && this.mode === 'printing') {
        this.job.elapsed += step;
        this.stats.printTime += step;
      }
      rem -= step;
    }
    this.pump();
    // safety: heater timeout when idle (Prusa: 30 min)
    if (!this.printing && !this.task && (this.nozzle.target > 0 || this.bed.target > 0) && this.planner.idle) {
      this.idleTimer += dt;
      if (this.idleTimer > 1800) {
        this.nozzle.setTarget(0);
        this.bed.setTarget(0);
        this.idleTimer = 0;
        this.message = 'Heater timeout';
      }
    } else this.idleTimer = 0;
    // finished?
    if (this.mode === 'printing' && this.job && this.job.reader.done && !this.task && this.planner.idle && this.immediate.length === 0) {
      this.finishJob();
    }
  }

  // Execute queued commands until blocked
  pump() {
    for (let guard = 0; guard < 4000; guard++) {
      if (this.task) {
        if (!this.stepTask()) return;
        continue;
      }
      if (this.planner.full) return;
      if (this.planner.queuedTime > 3) return;
      let line = null;
      if (this.immediate.length) line = this.immediate.shift();
      else if (this.job && this.mode === 'printing') {
        line = this.job.reader.next();
        if (line === null) return;
        this.job.bytes = this.job.reader.pos;
      } else return;
      this.execLine(line);
    }
  }

  // ------------------------------------------------------- task scheduler
  startTask(gen, name = 'task') {
    if (this.task) {
      // chain: run after current
      const prev = this.task;
      const self = this;
      this.task = (function* () {
        yield* prev;
        yield* gen;
      })();
      void self;
      return;
    }
    this.task = gen;
    this.taskName = name;
    this.taskWait = null;
  }

  stepTask() {
    // returns true when the task progressed (not blocked)
    const w = this.taskWait;
    if (w) {
      if (w.empty && !this.planner.idle) return false;
      if (w.time !== undefined && this.simTime < w.time) return false;
      if (w.until && !w.until()) return false;
      if (w.room && this.planner.full) return false;
    }
    let r;
    try {
      r = this.task.next();
    } catch (e) {
      console.error(e);
      r = { done: true };
    }
    if (r.done) {
      this.task = null;
      this.taskWait = null;
      return true;
    }
    const v = r.value || {};
    if (v.time !== undefined) v.time = this.simTime + v.time;
    this.taskWait = v;
    return true;
  }

  // ------------------------------------------------------------ G-code
  execLine(raw) {
    const c = parseGcodeLine(raw);
    if (!c) return;
    if (c.comment) this.handleComment(c.comment);
    if (!c.code) return;
    this.exec(c);
  }

  handleComment(cm) {
    if (cm.startsWith('HEIGHT:')) {
      const v = parseFloat(cm.slice(7));
      if (v > 0) this.layerH = v;
    } else if (cm.startsWith('WIDTH:')) {
      const v = parseFloat(cm.slice(6));
      if (v > 0) this.layerW = v;
    } else if (cm.startsWith('LAYER_CHANGE') && this.job) {
      this.job.layer = (this.job.layer || 0) + 1;
    }
  }

  exec(c) {
    const p = c.params;
    switch (c.code) {
      case 'G0':
      case 'G1':
        this.linearMove(p, c.code === 'G0');
        break;
      case 'G2':
      case 'G3':
        this.arcMove(p, c.code === 'G2');
        break;
      case 'G4': {
        const s = (p.S || 0) + (p.P || 0) / 1000;
        this.planner.addDwell(s);
        break;
      }
      case 'G28':
        this.startTask(this.taskHome(p), 'home');
        break;
      case 'G29':
        this.startTask(this.taskMBL(p), 'mbl');
        break;
      case 'G90':
        this.absolute = true;
        this.relE = false;
        break;
      case 'G91':
        this.absolute = false;
        this.relE = true;
        break;
      case 'M82':
        this.relE = false;
        break;
      case 'M83':
        this.relE = true;
        break;
      case 'G92': {
        const mp = this.planner.pos;
        const keys = ['X', 'Y', 'Z', 'E'];
        let any = false;
        keys.forEach((k, i) => {
          if (p[k] !== undefined) {
            this.offset[i] = mp[i] - p[k];
            any = true;
          }
        });
        if (!any) for (let i = 0; i < 4; i++) this.offset[i] = mp[i];
        break;
      }
      case 'G21':
      case 'G20':
        break;
      case 'M104':
        if (p.S !== undefined) this.nozzle.setTarget(p.S);
        else if (p.R !== undefined) this.nozzle.setTarget(p.R);
        break;
      case 'M109': {
        const t = p.S !== undefined ? p.S : p.R;
        if (t !== undefined) this.nozzle.setTarget(t);
        const coolToo = p.R !== undefined;
        this.startTask(this.taskWaitTemp(this.nozzle, coolToo), 'heat');
        break;
      }
      case 'M140':
        if (p.S !== undefined) this.bed.setTarget(p.S);
        else if (p.R !== undefined) this.bed.setTarget(p.R);
        break;
      case 'M190': {
        const t = p.S !== undefined ? p.S : p.R;
        if (t !== undefined) this.bed.setTarget(t);
        this.startTask(this.taskWaitTemp(this.bed, p.R !== undefined), 'heat');
        break;
      }
      case 'M106':
        if (!p.P || p.P === 0) this.fan = Math.max(0, Math.min(1, (p.S !== undefined ? p.S : 255) / 255));
        break;
      case 'M107':
        if (!p.P || p.P === 0) this.fan = 0;
        break;
      case 'M73':
        if (this.job) {
          if (p.P !== undefined) this.job.m73p = p.P;
          if (p.R !== undefined) this.job.m73r = p.R;
          this.job.m73at = this.job.elapsed;
        }
        break;
      case 'M117':
        this.message = c.text;
        break;
      case 'M300':
        this.hooks.beep?.(p.S || 2800, (p.P || 100) / 1000);
        break;
      case 'M400':
        this.startTask(
          (function* () {
            yield { empty: true };
          })(),
          'sync'
        );
        break;
      case 'M600':
        this.startTask(this.taskFilamentChange(), 'm600');
        break;
      case 'M601':
        if (this.job) this.pause();
        break;
      case 'M602':
        if (this.mode === 'paused') this.resume();
        break;
      case 'M0':
      case 'M1':
        this.startTask(this.taskWaitUser(c.text || 'Click to continue'), 'wait');
        break;
      case 'M17':
        this.motorsOn = true;
        break;
      case 'M18':
      case 'M84':
        if (p.E !== undefined && p.X === undefined && p.Y === undefined && p.Z === undefined) break;
        this.startTask(
          function* () {
            yield { empty: true };
            this.motorsOn = false;
            this.homed = { x: false, y: false, z: false };
          }.call(this),
          'motors'
        );
        break;
      case 'M220':
        if (p.S !== undefined) this.feedPct = Math.max(10, Math.min(999, p.S));
        break;
      case 'M221':
        if (p.S !== undefined) this.flowPct = Math.max(10, Math.min(999, p.S));
        break;
      case 'M201':
        ['X', 'Y', 'Z', 'E'].forEach((k, i) => {
          if (p[k] !== undefined) this.planner.cfg.maxAccel[i] = p[k];
        });
        break;
      case 'M203':
        ['X', 'Y', 'Z', 'E'].forEach((k, i) => {
          if (p[k] !== undefined) this.planner.cfg.maxFeed[i] = p[k];
        });
        break;
      case 'M204':
        if (p.P !== undefined) this.planner.cfg.accel = p.P;
        if (p.S !== undefined) {
          this.planner.cfg.accel = p.S;
          this.planner.cfg.travelAccel = p.S;
        }
        if (p.T !== undefined) this.planner.cfg.travelAccel = p.T;
        if (p.R !== undefined) this.planner.cfg.retractAccel = p.R;
        break;
      case 'M302':
        if (p.S !== undefined) this.coldMin = p.S;
        break;
      case 'M555':
        this.printArea = { x: p.X || 0, y: p.Y || 0, w: p.W || 250, h: p.H || 210 };
        break;
      case 'M862.3':
        if (this.job && typeof p.P === 'string') {
          const model = p.P.toUpperCase();
          const ok = ['MK4S', 'MK4', 'MK3.9', 'MK3.9S', 'MK4SMMU3', 'MK4MMU3'].includes(model);
          if (!ok) this.job.warnings.push(`model:${p.P}`);
        }
        break;
      case 'M862.1':
        if (this.job && p.P !== undefined && Math.abs(p.P - 0.4) > 0.01) this.job.warnings.push(`nozzle:${p.P}`);
        break;
      default:
        // M862.x, M115, M569, M572, M900, M142, M486, T0, ... accepted silently
        break;
    }
  }

  clampMachine(t) {
    for (let i = 0; i < 3; i++) t[i] = Math.max(LIMITS.min[i], Math.min(LIMITS.max[i], t[i]));
    return t;
  }

  linearMove(p, rapid) {
    if (p.F !== undefined) this.feed = p.F / 60;
    const mp = this.planner.pos;
    const t = [mp[0], mp[1], mp[2], mp[3]];
    const keys = ['X', 'Y', 'Z'];
    for (let i = 0; i < 3; i++) {
      const v = p[keys[i]];
      if (v === undefined) continue;
      t[i] = this.absolute ? v + this.offset[i] : mp[i] + v;
    }
    let dE = 0;
    if (p.E !== undefined) {
      if (this.relE) dE = p.E;
      else dE = p.E + this.offset[3] - mp[3];
    }
    if (dE > 0) dE *= this.flowPct / 100;
    this.clampMachine(t);
    // cold extrusion prevention
    let blockedE = false;
    if (dE !== 0 && this.nozzle.temp < this.coldMin) {
      blockedE = true;
      if (!this._coldWarned) {
        this._coldWarned = true;
        this.message = 'Cold extrusion prevented';
        this.hooks.coldExtrusion?.();
      }
    }
    const eTarget = blockedE ? mp[3] : mp[3] + dE;
    const xyLen = Math.hypot(t[0] - mp[0], t[1] - mp[1]);
    let feed = this.feed * (this.feedPct / 100);
    const moveZ = Math.abs(t[2] - mp[2]) > 1e-6;
    if (moveZ && xyLen < 1e-6) feed = Math.min(feed, 12);
    const travel = !(dE > 0) || xyLen < 1e-6;
    const meta = { travel };
    if (!blockedE && dE > 0 && xyLen > 0.005) {
      // layer tracking
      if (t[2] > this.zTop + 0.01) {
        this.zPrev = this.zTop;
        this.zTop = t[2];
      }
      let h = this.layerH || this.zTop - this.zPrev || 0.2;
      h = Math.max(0.05, Math.min(0.6, h));
      const area = (dE * FIL_AREA) / xyLen;
      let w = area / h + h * (1 - Math.PI / 4);
      w = Math.max(0.12, Math.min(2.2, w));
      meta.extrude = { w, h };
    } else if (moveZ && t[2] > this.zTop + 0.01 && !(dE > 0)) {
      // z change without extrusion: next layer starts later
    }
    if (dE !== 0 && !blockedE) meta.e = dE;
    this.planner.addMove([t[0], t[1], t[2], eTarget], feed, meta);
    if (!blockedE && dE > 0) this._coldWarned = false;
  }

  arcMove(p, cw) {
    // Support I/J centre format and R format
    const mp = this.planner.pos;
    const x0 = mp[0] - this.offset[0];
    const y0 = mp[1] - this.offset[1];
    let x1 = p.X !== undefined ? (this.absolute ? p.X : x0 + p.X) : x0;
    let y1 = p.Y !== undefined ? (this.absolute ? p.Y : y0 + p.Y) : y0;
    let cx;
    let cy;
    if (p.R !== undefined) {
      const r = p.R;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) return;
      const hh = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const s = (cw ? -1 : 1) * (r < 0 ? -1 : 1);
      cx = mx - (s * hh * dy) / d;
      cy = my + (s * hh * dx) / d;
    } else {
      cx = x0 + (p.I || 0);
      cy = y0 + (p.J || 0);
    }
    const r = Math.hypot(x0 - cx, y0 - cy);
    let a0 = Math.atan2(y0 - cy, x0 - cx);
    let a1 = Math.atan2(y1 - cy, x1 - cx);
    let sweep = a1 - a0;
    if (cw) {
      if (sweep >= -1e-9) sweep -= Math.PI * 2;
    } else if (sweep <= 1e-9) sweep += Math.PI * 2;
    if (Math.hypot(x1 - x0, y1 - y0) < 1e-6 && p.X === undefined && p.Y === undefined) sweep = cw ? -Math.PI * 2 : Math.PI * 2;
    const len = Math.abs(sweep) * r;
    const segs = Math.max(1, Math.ceil(len / 0.8));
    const z0 = mp[2] - this.offset[2];
    const z1 = p.Z !== undefined ? (this.absolute ? p.Z : z0 + p.Z) : z0;
    let eTot = 0;
    if (p.E !== undefined) eTot = this.relE ? p.E : p.E - (mp[3] - this.offset[3]);
    const wasAbs = this.absolute;
    const wasRelE = this.relE;
    this.absolute = true;
    this.relE = true;
    for (let i = 1; i <= segs; i++) {
      const a = a0 + (sweep * i) / segs;
      const sp = { X: cx + Math.cos(a) * r, Y: cy + Math.sin(a) * r, Z: z0 + ((z1 - z0) * i) / segs };
      if (eTot) sp.E = eTot / segs;
      if (i === 1 && p.F !== undefined) sp.F = p.F;
      this.linearMove(sp, false);
    }
    this.absolute = wasAbs;
    this.relE = wasRelE;
    void x1;
    void y1;
  }

  // ------------------------------------------------------------- deposits
  onBlockEnd(b) {
    const m = b.meta;
    const n = this.planner.cfg.axes;
    if (m.extrude) {
      this.hooks.deposit?.(b.start[0], b.start[1], b.start[2], b.start[0] + b.delta[0], b.start[1] + b.delta[1], b.start[2] + b.delta[2], m.extrude.w, m.extrude.h);
    }
    if (m.e) {
      if (m.e > 0) this.stats.filament += m.e;
      this.hooks.extruded?.(m.e, m);
    }
    if (n >= 3) {
      this.stats.x += Math.abs(b.delta[0]);
      this.stats.y += Math.abs(b.delta[1]);
      this.stats.z += Math.abs(b.delta[2]);
    }
  }

  // -------------------------------------------------------------- tasks
  *move(x, y, z, feed, e) {
    // helper to queue a machine move (absolute machine coords; undefined keeps)
    const mp = this.planner.pos;
    const t = [x ?? mp[0], y ?? mp[1], z ?? mp[2], e !== undefined ? mp[3] + e : mp[3]];
    this.clampMachine(t);
    yield { room: true };
    this.planner.addMove(t, feed, { travel: e === undefined || e <= 0, e });
  }

  *taskWaitTemp(heater, both) {
    const label = heater === this.nozzle ? 'nozzle' : 'bed';
    this.heatingLabel = label;
    yield { empty: true };
    const start = this.simTime;
    yield {
      until: () =>
        heater.target === 0 ||
        (both ? Math.abs(heater.temp - heater.target) < 1.6 : heater.temp >= heater.target - 1.6) ||
        (!both && heater.temp > heater.target)
    };
    // residency (Marlin waits a bit to settle)
    if (heater.target > 0 && this.simTime - start > 2) yield { time: heater === this.nozzle ? 2 : 1 };
    this.heatingLabel = null;
  }

  *taskHome(p) {
    const all = p.X === undefined && p.Y === undefined && p.Z === undefined;
    const doX = all || p.X !== undefined;
    const doY = all || p.Y !== undefined;
    const doZ = all || p.Z !== undefined;
    this.motorsOn = true;
    this.homingActive = true;
    yield { empty: true };
    const mp = this.planner.pos;
    // lift Z a bit before homing XY
    if (mp[2] < 5) yield* this.move(undefined, undefined, Math.min(LIMITS.max[2], mp[2] + 5), 10);
    if (doX) {
      yield* this.move(-1.5, undefined, undefined, 80);
      yield* this.move(6, undefined, undefined, 40);
      yield* this.move(-1.5, undefined, undefined, 25);
      yield { empty: true };
      this.hooks.tap?.('x');
      yield* this.move(0, undefined, undefined, 40);
      this.homed.x = true;
    }
    if (doY) {
      yield* this.move(undefined, -8.5, undefined, 80);
      yield* this.move(undefined, -2, undefined, 40);
      yield* this.move(undefined, -8.5, undefined, 25);
      yield { empty: true };
      this.hooks.tap?.('y');
      yield* this.move(undefined, -4, undefined, 40);
      this.homed.y = true;
    }
    if (doZ) {
      // probe Z with the loadcell at the bed centre
      yield* this.move(125, 105, undefined, 150);
      yield* this.probeAt(125, 105, true);
      yield* this.move(undefined, undefined, 5, 10);
      this.homed.z = true;
    }
    yield { empty: true };
    this.offset = [0, 0, 0, this.offset[3]];
    this.homingActive = false;
  }

  *probeAt(x, y, slow = false) {
    const mp = this.planner.pos;
    const hop = slow ? Math.max(3, mp[2]) : 2;
    if (Math.abs(mp[0] - x) > 0.01 || Math.abs(mp[1] - y) > 0.01) {
      if (mp[2] < hop) yield* this.move(undefined, undefined, hop, 12);
      yield* this.move(x, y, undefined, 150);
    }
    const contact = this.meshZ(x, y);
    yield* this.move(undefined, undefined, contact + 0.6, slow ? 10 : 12);
    yield* this.move(undefined, undefined, contact, slow ? 3 : 5);
    yield { empty: true };
    this.hooks.tap?.('z');
    yield { time: 0.08 };
    yield* this.move(undefined, undefined, contact + (slow ? 2 : 1.2), 12);
  }

  meshZ(x, y) {
    // tiny realistic bed unevenness (± 0.05 mm) – physical contact height
    return 0.03 * Math.sin(x * 0.021 + 1.3) * Math.cos(y * 0.017) + 0.015 * Math.sin(y * 0.05);
  }

  *taskMBL(p) {
    this.mblActive = true;
    yield { empty: true };
    if (p.A !== undefined) {
      this.mbl = true;
      this.mblActive = false;
      return;
    }
    if (p.P !== undefined && Math.floor(p.P) === 3) {
      this.mblActive = false;
      return;
    }
    if (p.G !== undefined) {
      // "absorbing heat" – wait a bit for the bed to settle
      yield { time: 10 };
      this.mblActive = false;
      return;
    }
    let area;
    if (p.W !== undefined && p.H !== undefined) area = { x: p.X || 0, y: p.Y || 0, w: p.W, h: p.H };
    else if (this.printArea && p.P === 1) area = this.printArea;
    else area = { x: 2, y: 2, w: 246, h: 206 };
    const nx = Math.max(2, Math.min(7, Math.ceil(area.w / 40) + 1));
    const ny = Math.max(2, Math.min(7, Math.ceil(area.h / 40) + 1));
    const pts = [];
    for (let j = 0; j < ny; j++) {
      const row = [];
      for (let i = 0; i < nx; i++) {
        row.push([area.x + (area.w * i) / (nx - 1), area.y + (area.h * j) / (ny - 1)]);
      }
      if (j % 2) row.reverse();
      pts.push(...row);
    }
    this.mblTotal = pts.length;
    this.mblDone = 0;
    for (const [x, y] of pts) {
      yield* this.probeAt(Math.max(-1, Math.min(254, x)), Math.max(-8, Math.min(211, y)));
      this.mblDone++;
    }
    yield* this.move(undefined, undefined, Math.max(this.planner.pos[2], 2), 12);
    yield { empty: true };
    this.mblActive = false;
  }

  *taskWaitUser(text) {
    yield { empty: true };
    this.answer = null;
    this.prompt = { title: 'Info', text, buttons: [{ id: 'continue', label: 'continue' }] };
    yield { until: () => this.answer !== null };
    this.prompt = null;
  }

  ask(prompt) {
    this.answer = null;
    this.prompt = prompt;
    return { until: () => this.answer !== null };
  }

  // ------------------------------------------------- filament handling
  *taskPreheatFor(mat, withBed = false) {
    if (this.nozzle.target < mat.nozzle) this.nozzle.setTarget(mat.nozzle);
    if (withBed) this.bed.setTarget(mat.bed);
    this.wizard = { kind: 'heat', title: 'preheating', mat: mat.id };
    yield { until: () => this.nozzle.temp >= this.nozzle.target - 3 || this.nozzle.target === 0 };
  }

  *taskLoad(matId, { fromChange = false } = {}) {
    const mat = matId ? MATERIALS.find((m) => m.id === matId) || MATERIALS[0] : MATERIALS[0];
    yield { empty: true };
    // lift nozzle if too low (so the purge does not hit the bed / print)
    if (!fromChange && this.planner.pos[2] < 40) yield* this.move(undefined, undefined, 40, 12);
    yield* this.taskPreheatFor(mat, false);
    if (!this.filament.inSensor) {
      this.wizard = { kind: 'insert', title: 'insert' };
      yield { until: () => this.filament.inSensor };
      yield { time: 0.4 };
    }
    this.wizard = { kind: 'load', title: 'loading', progress: 0 };
    this.filament.type = mat.id;
    // feed filament through the extruder to the nozzle (~ 70 mm)
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      yield { room: true };
      this.planner.addMove([undefined, undefined, undefined, this.planner.pos[3] + 5], 40, { e: 5, travel: true, load: true });
      this.wizard.progress = (i + 1) / (steps + 8);
    }
    yield { empty: true };
    this.filament.loaded = true;
    this.wizard = { kind: 'purge', title: 'purging', progress: 0.6 };
    yield* this.purge(40);
    this.wizard = null;
    for (;;) {
      yield this.ask({ title: 'filament', text: 'colorCorrect', buttons: [{ id: 'yes', label: 'yes' }, { id: 'purge', label: 'purgeMore' }] });
      this.prompt = null;
      if (this.answer === 'yes') break;
      this.wizard = { kind: 'purge', title: 'purging', progress: 0.8 };
      yield* this.purge(25);
      this.wizard = null;
    }
    this.hooks.dropPurge?.();
  }

  *purge(mm) {
    const steps = Math.ceil(mm / 5);
    for (let i = 0; i < steps; i++) {
      yield { room: true };
      this.planner.addMove([undefined, undefined, undefined, this.planner.pos[3] + mm / steps], 3, { e: mm / steps, travel: true, purge: true });
    }
    yield { empty: true };
  }

  *taskUnload({ fromChange = false } = {}) {
    const mat = materialById(this.filament.type);
    yield { empty: true };
    if (!this.filament.loaded && !this.filament.inSensor) {
      yield this.ask({ title: 'filament', text: 'noFilament', buttons: [{ id: 'ok', label: 'ok' }] });
      this.prompt = null;
      return;
    }
    if (!fromChange && this.planner.pos[2] < 40) yield* this.move(undefined, undefined, 40, 12);
    yield* this.taskPreheatFor(mat, false);
    if (this.filament.loaded) {
      this.wizard = { kind: 'unload', title: 'ramming', progress: 0.1 };
      // ramming sequence
      for (const [e, f] of [[8, 6], [-5, 40], [3, 8], [-60, 60], [-35, 50]]) {
        yield { room: true };
        this.planner.addMove([undefined, undefined, undefined, this.planner.pos[3] + e], f, { e, travel: true, unload: true });
      }
      this.wizard.title = 'unloading';
      this.wizard.progress = 0.6;
      yield { empty: true };
      this.filament.loaded = false;
    }
    this.wizard = null;
    yield this.ask({ title: 'filament', text: 'removeFilament', buttons: [{ id: 'continue', label: 'continue' }] });
    this.prompt = null;
    this.filament.inSensor = false;
    this.hooks.filamentRemoved?.();
  }

  *taskFilamentChange() {
    yield { empty: true };
    const saved = Array.from(this.planner.pos);
    const wasFan = this.fan;
    this.fan = 0;
    // retract & park
    yield* this.move(undefined, undefined, undefined, 35, -0.8);
    yield* this.move(undefined, undefined, Math.min(LIMITS.max[2], saved[2] + 10), 12);
    yield* this.move(PARK.x, 10, undefined, 100);
    yield* this.taskUnload({ fromChange: true });
    yield* this.taskLoad(this.filament.type, { fromChange: true });
    // return
    yield* this.move(saved[0], saved[1], undefined, 100);
    yield* this.move(undefined, undefined, saved[2], 12);
    yield* this.move(undefined, undefined, undefined, 35, 0.8);
    yield { empty: true };
    this.planner.setPosition([undefined, undefined, undefined, saved[3]]);
    this.fan = wasFan;
  }

  // ---------------------------------------------------------- printing
  startPrint(file) {
    if (this.printing || !this.powered) return false;
    this.job = {
      file,
      reader: new LineReader(file.text),
      elapsed: 0,
      bytes: 0,
      m73p: null,
      m73r: null,
      warnings: [],
      layer: 0,
      startedAt: Date.now()
    };
    this.feedPct = 100;
    this.flowPct = 100;
    this.zTop = 0;
    this.zPrev = 0;
    this.layerH = 0.2;
    this.absolute = true;
    this.relE = false;
    this.mode = 'printing';
    this.stats.prints++;
    this.hooks.onPrintStart?.(file);
    this.hooks.onState?.();
    return true;
  }

  get progress() {
    const j = this.job;
    if (!j) return 0;
    if (j.m73p !== null) return Math.min(100, j.m73p);
    return Math.min(100, (j.bytes / Math.max(1, j.file.text.length)) * 100);
  }

  // remaining seconds
  get remaining() {
    const j = this.job;
    if (!j) return 0;
    if (j.m73r !== null) {
      const since = j.elapsed - (j.m73at || 0);
      return Math.max(0, j.m73r * 60 - since) / (this.feedPct / 100);
    }
    const p = this.progress / 100;
    if (p < 0.01) return j.file.meta?.time || 0;
    return (j.elapsed / p) * (1 - p);
  }

  pause() {
    if (this.mode !== 'printing') return;
    this.mode = 'pausing';
    this.hooks.onState?.();
    const self = this;
    this.startTask(
      (function* () {
        yield { empty: true };
        self.pauseSaved = { pos: Array.from(self.planner.pos), fan: self.fan, nozzle: self.nozzle.target };
        self.fan = 0;
        yield* self.move(undefined, undefined, undefined, 35, -1);
        yield* self.move(undefined, undefined, Math.min(LIMITS.max[2], self.pauseSaved.pos[2] + 10), 12);
        yield* self.move(PARK.x, PARK.y, undefined, 100);
        yield { empty: true };
        self.mode = 'paused';
        self.hooks.onState?.();
      })(),
      'pause'
    );
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'resuming';
    this.hooks.onState?.();
    const self = this;
    const s = this.pauseSaved;
    this.startTask(
      (function* () {
        if (self.nozzle.target < s.nozzle) self.nozzle.setTarget(s.nozzle);
        yield { until: () => self.nozzle.temp >= self.nozzle.target - 3 };
        yield* self.move(s.pos[0], s.pos[1], undefined, 100);
        yield* self.move(undefined, undefined, s.pos[2], 12);
        yield* self.move(undefined, undefined, undefined, 35, 1);
        yield { empty: true };
        self.planner.setPosition([undefined, undefined, undefined, s.pos[3]]);
        self.fan = s.fan;
        self.mode = 'printing';
        self.hooks.onState?.();
      })(),
      'resume'
    );
  }

  stop() {
    if (!this.printing) return;
    this.planner.abort();
    this.task = null;
    this.taskWait = null;
    this.prompt = null;
    this.wizard = null;
    this.immediate = [];
    this.mode = 'stopping';
    this.hooks.onState?.();
    const self = this;
    this.task = (function* () {
      self.fan = 0;
      self.nozzle.setTarget(0);
      self.bed.setTarget(0);
      yield* self.move(undefined, undefined, undefined, 35, -1);
      yield* self.move(undefined, undefined, Math.min(LIMITS.max[2], self.planner.pos[2] + 10), 12);
      yield* self.move(PARK.x, PARK.y, undefined, 100);
      yield { empty: true };
      self.mode = 'stopped';
      self.hooks.onPrintEnd?.(false);
      self.hooks.onState?.();
    })();
  }

  finishJob() {
    this.mode = 'finished';
    this.job.finishedAt = this.job.elapsed;
    this.hooks.onPrintEnd?.(true);
    this.hooks.onState?.();
  }

  // acknowledge finished/stopped screen
  clearJob() {
    if (this.mode === 'finished' || this.mode === 'stopped') {
      this.mode = 'idle';
      this.lastJob = this.job;
      this.job = null;
      this.hooks.onState?.();
    }
  }

  // ------------------------------------------------------ UI helpers
  answerPrompt(id) {
    this.answer = id;
    if (this.prompt) this.prompt = null;
  }

  // jog a machine axis directly (used by "Move axis")
  jogTo(axis, value) {
    const mp = this.planner.pos;
    const t = [mp[0], mp[1], mp[2], mp[3]];
    t[axis] = value;
    this.clampMachine(t);
    const feeds = [60, 60, 12, 5];
    if (axis === 3) {
      const de = value - mp[3];
      if (de > 0 && this.nozzle.temp < this.coldMin) return false;
      this.planner.addMove(t, feeds[axis], { travel: true, e: de, jog: true });
      return true;
    }
    this.motorsOn = true;
    this.planner.addMove(t, feeds[axis], { travel: true, jog: true });
    return true;
  }
}
