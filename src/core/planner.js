// Look-ahead motion planner with trapezoidal velocity profiles and
// junction-deviation cornering (same model as Marlin/GRBL).
// Axes: [X, Y, Z, E] (E optional; GRBL uses only 3).

const EPS = 1e-9;

export class Planner {
  constructor(cfg = {}) {
    this.cfg = Object.assign(
      {
        axes: 4,
        maxFeed: [300, 300, 12, 120], // mm/s
        maxAccel: [4000, 4000, 200, 2500], // mm/s^2
        accel: 4000, // printing / default
        travelAccel: 4000,
        retractAccel: 1200,
        jd: 0.013, // junction deviation mm
        minSpeed: 0.5,
        maxBlocks: 32
      },
      cfg
    );
    this.queue = [];
    this.pos = new Float64Array(this.cfg.axes); // planned end position
    this.cur = null;
    this.lastUnit = null;
    this.onBlockStart = null;
    this.onBlockEnd = null;
    this.totalTime = 0;
  }

  get length() {
    return this.queue.length;
  }

  get full() {
    return this.queue.length >= this.cfg.maxBlocks;
  }

  get idle() {
    return this.queue.length === 0;
  }

  // Seconds of motion still queued
  get queuedTime() {
    let t = 0;
    for (const b of this.queue) {
      if (!b.planned) this.computeTrapezoid(b, b.entry, this.nextEntry(b));
      t += b.duration - (b.t || 0);
    }
    return t;
  }

  setPosition(p) {
    for (let i = 0; i < this.cfg.axes; i++) if (p[i] !== undefined && p[i] !== null) this.pos[i] = p[i];
  }

  nextEntry(b) {
    const i = this.queue.indexOf(b);
    const n = this.queue[i + 1];
    return n ? n.entry : 0;
  }

  // Add a dwell / synchronisation block (no motion)
  addDwell(seconds, meta = {}) {
    const b = {
      start: Float64Array.from(this.pos),
      delta: new Float64Array(this.cfg.axes),
      dist: 0,
      dwell: Math.max(0, seconds),
      nominal: 0,
      accel: 1,
      maxEntry: 0,
      entry: 0,
      meta,
      t: 0
    };
    if (this.queue.length && this.queue[this.queue.length - 1].locked) b.entryFixed = this.queue[this.queue.length - 1].exit;
    this.queue.push(b);
    this.lastUnit = null;
    this.recalc();
    return b;
  }

  // Linear move to absolute target. feed in mm/s.
  addMove(target, feed, meta = {}, accelOverride) {
    const n = this.cfg.axes;
    const delta = new Float64Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const t = target[i] === undefined || target[i] === null ? this.pos[i] : target[i];
      delta[i] = t - this.pos[i];
      if (Math.abs(delta[i]) > 1e-7) any = true;
    }
    if (!any) return null;
    const xyz = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + (n > 2 ? delta[2] * delta[2] : 0));
    const eOnly = xyz < 1e-6;
    const dist = eOnly ? Math.abs(delta[3] || 0) : xyz;
    if (dist < 1e-7) return null;

    const mf = this.cfg.maxFeed;
    const ma = this.cfg.maxAccel;
    let v = Math.max(this.cfg.minSpeed, feed);
    let a = accelOverride || (eOnly ? this.cfg.retractAccel : meta.travel ? this.cfg.travelAccel : this.cfg.accel);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(delta[i]);
      if (d < 1e-9) continue;
      v = Math.min(v, (mf[i] * dist) / d);
      a = Math.min(a, (ma[i] * dist) / d);
    }
    const unit = eOnly ? null : [delta[0] / xyz, delta[1] / xyz, n > 2 ? delta[2] / xyz : 0];

    let maxEntry = 0;
    const prev = this.queue.length ? this.queue[this.queue.length - 1] : null;
    if (prev && !prev.dwell && unit && this.lastUnit) {
      const pu = this.lastUnit;
      const cos = -(pu[0] * unit[0] + pu[1] * unit[1] + pu[2] * unit[2]);
      let vj;
      if (cos > 0.999999) vj = this.cfg.minSpeed;
      else if (cos < -0.999999) vj = Infinity;
      else {
        const s = Math.sqrt(0.5 * (1 - cos));
        vj = Math.sqrt((a * this.cfg.jd * s) / (1 - s));
      }
      maxEntry = Math.min(vj, v, prev.nominal);
    } else if (prev && !prev.dwell && eOnly && prev.eOnly) {
      maxEntry = Math.min(v, prev.nominal);
    }
    const b = {
      start: Float64Array.from(this.pos),
      delta,
      dist,
      unit,
      eOnly,
      nominal: v,
      accel: a,
      maxEntry,
      entry: 0,
      meta,
      t: 0
    };
    if (prev && prev.locked) b.entryFixed = prev.exit;
    for (let i = 0; i < n; i++) this.pos[i] += delta[i];
    this.lastUnit = unit;
    this.queue.push(b);
    this.recalc();
    return b;
  }

  recalc() {
    const q = this.queue;
    if (!q.length) return;
    let first = 0;
    while (first < q.length && q[first].locked) first++;
    if (first >= q.length) return;
    // backward pass
    let nextEntry = 0;
    for (let i = q.length - 1; i >= first; i--) {
      const b = q[i];
      b.planned = false;
      if (b.entryFixed !== undefined) {
        b.entry = b.entryFixed;
        nextEntry = b.entry;
        continue;
      }
      if (b.dwell !== undefined) {
        b.entry = 0;
        nextEntry = 0;
        continue;
      }
      const lim = Math.sqrt(nextEntry * nextEntry + 2 * b.accel * b.dist);
      b.entry = Math.min(b.maxEntry, lim);
      nextEntry = b.entry;
    }
    // forward pass
    for (let i = first; i < q.length - 1; i++) {
      const b = q[i];
      const n = q[i + 1];
      if (n.entryFixed !== undefined || n.dwell !== undefined) continue;
      if (b.dwell !== undefined) {
        n.entry = 0;
        continue;
      }
      const lim = Math.sqrt(b.entry * b.entry + 2 * b.accel * b.dist);
      if (n.entry > lim) n.entry = lim;
    }
  }

  computeTrapezoid(b, vIn, vOut) {
    if (b.dwell !== undefined) {
      b.duration = b.dwell;
      b.ta = b.tc = b.td = 0;
      b.planned = true;
      b.vIn = b.vOut = b.vPeak = 0;
      return;
    }
    const d = b.dist;
    const vn = b.nominal;
    let a1 = b.accel;
    let a2 = b.accel;
    vIn = Math.min(vIn, vn);
    vOut = Math.min(vOut, vn);
    // feasibility fallbacks (should rarely trigger)
    if (vIn * vIn > vOut * vOut + 2 * a2 * d) a2 = (vIn * vIn - vOut * vOut) / (2 * d) + EPS;
    if (vOut * vOut > vIn * vIn + 2 * a1 * d) a1 = (vOut * vOut - vIn * vIn) / (2 * d) + EPS;
    let da = (vn * vn - vIn * vIn) / (2 * a1);
    let dd = (vn * vn - vOut * vOut) / (2 * a2);
    let vp = vn;
    let dc;
    if (da + dd > d) {
      // no cruise phase
      vp = Math.sqrt((2 * a1 * a2 * d + a2 * vIn * vIn + a1 * vOut * vOut) / (a1 + a2));
      vp = Math.max(vp, vIn, vOut);
      da = Math.max(0, (vp * vp - vIn * vIn) / (2 * a1));
      dd = Math.max(0, d - da);
      dc = 0;
    } else dc = d - da - dd;
    b.vIn = vIn;
    b.vOut = vOut;
    b.vPeak = vp;
    b.a1 = a1;
    b.a2 = a2;
    b.da = da;
    b.dc = dc;
    b.ta = (vp - vIn) / a1;
    b.tc = vp > EPS ? dc / vp : 0;
    b.td = (vp - vOut) / a2;
    b.duration = Math.max(1e-6, b.ta + b.tc + b.td);
    b.planned = true;
  }

  // distance travelled along the block at time t
  sAt(b, t) {
    if (b.dwell !== undefined) return 0;
    if (t <= b.ta) return b.vIn * t + 0.5 * b.a1 * t * t;
    if (t <= b.ta + b.tc) return b.da + b.vPeak * (t - b.ta);
    const t3 = Math.min(t - b.ta - b.tc, b.td);
    return Math.min(b.dist, b.da + b.dc + b.vPeak * t3 - 0.5 * b.a2 * t3 * t3);
  }

  vAt(b, t) {
    if (b.dwell !== undefined) return 0;
    if (t <= b.ta) return b.vIn + b.a1 * t;
    if (t <= b.ta + b.tc) return b.vPeak;
    return Math.max(0, b.vPeak - b.a2 * (t - b.ta - b.tc));
  }

  startBlock() {
    const b = this.queue[0];
    if (!b) return null;
    const n = this.queue[1];
    const vOut = n ? n.entry : 0;
    this.computeTrapezoid(b, b.entryFixed !== undefined ? b.entryFixed : b.entry, vOut);
    b.locked = true;
    b.exit = b.vOut;
    if (n) n.entryFixed = b.exit;
    b.t = 0;
    this.cur = b;
    if (this.onBlockStart) this.onBlockStart(b);
    return b;
  }

  // Advance time. Returns time not consumed (when queue ran empty).
  update(dt) {
    while (dt > 0) {
      if (!this.cur) {
        if (!this.startBlock()) return dt;
      }
      const b = this.cur;
      const rem = b.duration - b.t;
      if (dt >= rem) {
        dt -= rem;
        b.t = b.duration;
        this.totalTime += rem;
        this.queue.shift();
        this.cur = null;
        if (this.onBlockEnd) this.onBlockEnd(b);
      } else {
        b.t += dt;
        this.totalTime += dt;
        dt = 0;
      }
    }
    return 0;
  }

  // Current interpolated machine position
  position(out) {
    const n = this.cfg.axes;
    out = out || new Float64Array(n);
    const b = this.cur;
    if (!b) {
      // idle: physical position = start of next block (or planned end)
      const nb = this.queue[0];
      const src = nb ? nb.start : this.pos;
      for (let i = 0; i < n; i++) out[i] = src[i];
      return out;
    }
    const f = b.dist > 0 ? this.sAt(b, b.t) / b.dist : 1;
    for (let i = 0; i < n; i++) out[i] = b.start[i] + b.delta[i] * f;
    return out;
  }

  // Current speed (mm/s) and per-axis speeds
  velocity(outAxes) {
    const b = this.cur;
    if (!b || b.dwell !== undefined) {
      if (outAxes) outAxes.fill(0);
      return 0;
    }
    const v = this.vAt(b, b.t);
    if (outAxes) for (let i = 0; i < outAxes.length; i++) outAxes[i] = (b.delta[i] / b.dist) * v;
    return v;
  }

  // Immediate stop (quick stop). Machine position becomes current position.
  abort() {
    const p = this.position();
    this.queue.length = 0;
    this.cur = null;
    this.lastUnit = null;
    for (let i = 0; i < this.cfg.axes; i++) this.pos[i] = p[i];
    return p;
  }

  // Controlled stop (feed hold): replan current block to decelerate ASAP.
  // Returns true when the machine has come to rest.
  hold() {
    const b = this.cur;
    if (!b || b.dwell !== undefined) return true;
    const v = this.vAt(b, b.t);
    if (v < 0.01) return true;
    // build a decel-only block from current position along the same direction
    const s = this.sAt(b, b.t);
    const stopDist = (v * v) / (2 * b.a2 || b.accel);
    const remaining = b.dist - s;
    const d = Math.min(stopDist, remaining);
    const f0 = s / b.dist;
    const f1 = (s + d) / b.dist;
    const n = this.cfg.axes;
    const start = new Float64Array(n);
    const delta = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      start[i] = b.start[i] + b.delta[i] * f0;
      delta[i] = b.delta[i] * (f1 - f0);
    }
    const nb = { start, delta, dist: d, unit: b.unit, eOnly: b.eOnly, nominal: v, accel: b.accel, maxEntry: v, entry: v, meta: b.meta, t: 0, locked: true };
    this.computeTrapezoid(nb, v, 0);
    nb.exit = 0;
    this.queue.length = 0;
    this.queue.push(nb);
    this.cur = nb;
    for (let i = 0; i < n; i++) this.pos[i] = start[i] + delta[i];
    this.lastUnit = null;
    return false;
  }
}
