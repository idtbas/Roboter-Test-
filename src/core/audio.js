// Procedural, spatialised workshop audio (Web Audio API).
// Everything is synthesised – stepper "singing", fans, beeps, clicks.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.8;
    this.voices = [];
    this.pendingVoices = [];
    this.ready = false;
  }

  // Must be called from a user gesture
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // gentle room reverb via short feedback delay network
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(2);
    this.ready = true;
    for (const v of this.pendingVoices) v.init(this);
    this.pendingVoices = [];
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * w; // slightly pinkish
      d[i] = w * 0.6 + b0 * 2.5;
    }
    return buf;
  }

  makePanner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 450;
    p.maxDistance = 20000;
    p.rolloffFactor = 1.1;
    this.setPannerPos(p, pos);
    p.connect(this.master);
    return p;
  }

  setPannerPos(p, pos) {
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._tmpDir || (this._tmpDir = camera.position.clone()));
    const u = camera.up;
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = u.x;
      l.upY.value = u.y;
      l.upZ.value = u.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  register(voice) {
    if (this.ready) voice.init(this);
    else this.pendingVoices.push(voice);
    this.voices.push(voice);
    return voice;
  }

  // One-shot tone (buzzer)
  beep(pos, freq = 2600, dur = 0.08, vol = 0.18, type = 'square') {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setValueAtTime(vol, t + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.makePanner(pos));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Mechanical click (detent, button)
  click(pos, vol = 0.25, tone = 3200, dur = 0.018) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = tone;
    bp.Q.value = 2.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.makePanner(pos));
    src.start(t, Math.random());
    src.stop(t + dur + 0.01);
  }

  // Heavier thunk (lid, power switch)
  thunk(pos, vol = 0.4, tone = 180, dur = 0.12) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(tone * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(tone * 0.6, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.makePanner(pos));
    o.start(t);
    o.stop(t + dur + 0.02);
    this.click(pos, vol * 0.6, 1800, 0.03);
  }
}

// Stepper motor voice: pitch follows full-step frequency.
export class MotorVoice {
  constructor(pos, { gain = 0.07, timbre = 'driver' } = {}) {
    this.pos = pos.clone();
    this.gainMax = gain;
    this.timbre = timbre;
    this.freq = 0;
    this.level = 0;
  }

  init(a) {
    const ctx = a.ctx;
    this.a = a;
    this.osc = ctx.createOscillator();
    // Rich harmonic content like a stepper under micro-stepping
    const real = new Float32Array([0, 1, 0.35, 0.5, 0.12, 0.22, 0.05, 0.08, 0.02]);
    const imag = new Float32Array(real.length);
    this.osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.bp = ctx.createBiquadFilter();
    this.bp.type = 'bandpass';
    this.bp.Q.value = 0.7;
    this.bp.frequency.value = 1400;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.osc.connect(this.bp);
    this.osc2.connect(this.bp);
    this.bp.connect(this.g);
    this.panner = a.makePanner(this.pos);
    this.g.connect(this.panner);
    this.osc.start();
    this.osc2.start();
  }

  set(fullStepHz, load = 1) {
    if (!this.osc) return;
    const ctx = this.a.ctx;
    const f = Math.max(20, Math.min(fullStepHz, 6000));
    const on = fullStepHz > 15 ? 1 : 0;
    const t = ctx.currentTime;
    this.osc.frequency.setTargetAtTime(f, t, 0.012);
    this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.012);
    this.bp.frequency.setTargetAtTime(Math.min(4000, 600 + f * 1.5), t, 0.03);
    const lvl = on * this.gainMax * Math.min(1, 0.35 + fullStepHz / 1500) * load;
    this.g.gain.setTargetAtTime(lvl, t, 0.02);
  }

  setPos(p) {
    if (this.panner) this.a.setPannerPos(this.panner, p);
  }
}

// Fan voice: filtered noise + blade-pass hum
export class FanVoice {
  constructor(pos, { gain = 0.05, size = 40 } = {}) {
    this.pos = pos.clone();
    this.gainMax = gain;
    this.size = size;
  }

  init(a) {
    const ctx = a.ctx;
    this.a = a;
    this.src = ctx.createBufferSource();
    this.src.buffer = a.noiseBuffer;
    this.src.loop = true;
    this.bp = ctx.createBiquadFilter();
    this.bp.type = 'bandpass';
    this.bp.Q.value = 0.9;
    this.bp.frequency.value = this.size < 50 ? 2200 : 900;
    this.hum = ctx.createOscillator();
    this.hum.type = 'sine';
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.25;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.src.connect(this.bp);
    this.bp.connect(this.g);
    this.hum.connect(this.humGain);
    this.humGain.connect(this.g);
    this.panner = a.makePanner(this.pos);
    this.g.connect(this.panner);
    this.src.start(0, Math.random() * 1.5);
    this.hum.start();
  }

  set(speed01) {
    if (!this.g) return;
    const t = this.a.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed01));
    this.g.gain.setTargetAtTime(this.gainMax * s * s, t, 0.4);
    const rpm = s * (this.size < 50 ? 7000 : 3000);
    this.hum.frequency.setTargetAtTime(Math.max(20, (rpm / 60) * 7), t, 0.5);
    this.bp.frequency.setTargetAtTime((this.size < 50 ? 1200 : 500) + s * (this.size < 50 ? 2200 : 900), t, 0.5);
  }

  setPos(p) {
    if (this.panner) this.a.setPannerPos(this.panner, p);
  }
}

// Continuous hum (power supply / UV LEDs / laser module)
export class HumVoice {
  constructor(pos, { freq = 100, gain = 0.02, type = 'sine' } = {}) {
    this.pos = pos.clone();
    this.freq = freq;
    this.gainMax = gain;
    this.type = type;
  }

  init(a) {
    const ctx = a.ctx;
    this.a = a;
    this.o = ctx.createOscillator();
    this.o.type = this.type;
    this.o.frequency.value = this.freq;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 900;
    this.g = ctx.createGain();
    this.g.gain.value = 0;
    this.o.connect(this.lp);
    this.lp.connect(this.g);
    this.panner = a.makePanner(this.pos);
    this.g.connect(this.panner);
    this.o.start();
  }

  set(level01, freq) {
    if (!this.g) return;
    const t = this.a.ctx.currentTime;
    this.g.gain.setTargetAtTime(this.gainMax * level01, t, 0.08);
    if (freq) this.o.frequency.setTargetAtTime(freq, t, 0.05);
  }
}
