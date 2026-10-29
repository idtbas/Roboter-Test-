import * as THREE from 'three';
import { BaseDevice, h } from '../base.js';
import { buildMarsModel, EGEO } from './model.js';
import { MarsTouchUI } from './touch.js';
import { RESINS, RESIN_SAMPLES, defaultParams, toResinPositions, sliceAt, sectionArea, drawMask, analyse, CuredPart, resinThumb } from './resin.js';
import { MotorVoice, FanVoice } from '../../core/audio.js';
import { rbox, cyl, box, textPlane } from '../../core/parts.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const VAT_AREA = 194 * 128; // mm²
const VAT_MAX_ML = 500;

// ---------------------------------------------------------------------------
// Firmware (Z axis, exposure cycle, tools)
// ---------------------------------------------------------------------------
class MarsFirmware {
  constructor(dev) {
    this.dev = dev;
    this.powered = false;
    this.booting = 0;
    this.z = 140;
    this.zTarget = 140;
    this.zSpeed = 5;
    this.task = null;
    this.wait = null;
    this.time = 0;
    this.job = null;
    this.lastJob = null;
    this.paused = false;
    this.lang = 'de';
    this.sound = true;
    this.leveled = true;
    this.uv = 0;
    this.phase = 'idle';
  }

  setPower(on) {
    this.powered = on;
    this.task = null;
    this.wait = null;
    this.uv = 0;
    this.zTarget = this.z;
    if (on) this.booting = 2.5;
    else {
      if (this.job) {
        this.job.stopped = true;
        this.lastJob = this.job;
        this.job = null;
      }
      this.dev.lcdOff();
    }
  }

  update(dt) {
    if (!this.powered) return;
    if (this.booting > 0) {
      this.booting -= dt;
      if (this.booting <= 0) this.dev.touch.ui.dirty = true;
      return;
    }
    let rem = dt;
    let guard = 0;
    while (rem > 1e-9 && guard++ < 2000) {
      const step = Math.min(rem, 0.05);
      rem -= step;
      this.time += step;
      // Z motion
      if (this.z !== this.zTarget) {
        const d = this.zTarget - this.z;
        const mv = Math.sign(d) * Math.min(Math.abs(d), this.zSpeed * step);
        this.z += mv;
        if (Math.abs(this.zTarget - this.z) < 1e-6) this.z = this.zTarget;
      }
      if (this.job && !this.paused) this.job.elapsed += step;
      // tasks
      for (let k = 0; k < 20 && this.task; k++) {
        const w = this.wait;
        if (w) {
          if (w.time !== undefined && this.time < w.time) break;
          if (w.until && !w.until()) break;
        }
        const r = this.task.next();
        if (r.done) {
          this.task = null;
          this.wait = null;
          this.taskName = null;
          break;
        }
        const v = r.value || {};
        if (v.time !== undefined) v.time += this.time;
        this.wait = v;
      }
      if (this.wait && this.wait.time !== undefined) this.taskRemain = Math.max(0, this.wait.time - this.time);
    }
  }

  run(gen, name) {
    this.task = gen;
    this.taskName = name;
    this.wait = null;
  }

  *moveZ(target, mmPerMin) {
    this.zTarget = Math.max(0, Math.min(EGEO.MAX_Z, target));
    this.zSpeed = mmPerMin / 60;
    yield { until: () => this.z === this.zTarget };
  }

  jog(dz) {
    if (this.task) return;
    const self = this;
    this.run((function* () { yield* self.moveZ(self.z + dz, dz > 0 ? 600 : 300); })(), 'jog');
  }

  home(level = false) {
    if (this.task) return;
    const self = this;
    this.run(
      (function* () {
        self.phase = 'homing';
        if (self.z > 10) yield* self.moveZ(10, 600);
        yield* self.moveZ(0, 150);
        self.dev.app.audio.click(self.dev.sfxPos(self.dev.H.plate), 0.15, 2000, 0.02);
        if (level) self.dev.plateSettle = 1;
        self.phase = 'idle';
      })(),
      'home'
    );
  }

  stopMotion() {
    if (this.taskName === 'jog' || this.taskName === 'home') {
      this.task = null;
      this.wait = null;
      this.zTarget = this.z;
    }
  }

  cancelTask() {
    this.task = null;
    this.wait = null;
    this.uv = 0;
    this.dev.lcdOff();
  }

  exposureTest() {
    if (this.task) return;
    const self = this;
    this.run(
      (function* () {
        self.dev.lcdTestPattern();
        self.uv = 1;
        yield { time: 10 };
        self.uv = 0;
        self.dev.lcdOff();
      })(),
      'exptest'
    );
  }

  cleanVat() {
    if (this.task) return;
    const self = this;
    this.run(
      (function* () {
        if (self.z < 60) yield* self.moveZ(80, 600);
        self.dev.lcdFull();
        self.uv = 1;
        yield { time: 15 };
        self.uv = 0;
        self.dev.lcdOff();
        self.dev.formFilm();
      })(),
      'clean'
    );
  }

  startPrint(file, resin) {
    if (this.job || this.task) return;
    const params = { ...file.params };
    this.job = { file, params, layers: file.info.layers, layer: 0, elapsed: 0, resin, done: false };
    this.paused = false;
    this.stopReq = false;
    this.dev.onPrintStart(this.job);
    const self = this;
    const j = this.job;
    this.run(
      (function* () {
        const p = j.params;
        self.phase = 'homing';
        if (self.z > 10) yield* self.moveZ(10, 600);
        yield* self.moveZ(0, 150);
        for (let i = 0; i < j.layers; i++) {
          const bottom = i < p.bottomLayers;
          const z = (i + 1) * p.layerHeight;
          self.phase = 'retract';
          yield* self.moveZ(z, p.retractSpeed);
          self.phase = 'rest';
          yield { time: p.restBefore };
          j.layer = i;
          self.phase = 'expose';
          self.dev.showLayer(j, i);
          self.uv = 1;
          yield { time: bottom ? p.bottomExposure : p.exposure };
          self.uv = 0;
          self.dev.lcdOff();
          self.dev.cureLayer(j, i);
          self.phase = 'lift';
          self.layerZ = z;
          yield* self.moveZ(z + (bottom ? p.bottomLiftDist : p.liftDist), bottom ? p.bottomLiftSpeed : p.liftSpeed);
          yield { time: p.restAfterLift };
          if (self.paused) {
            self.phase = 'paused';
            const back = self.z;
            yield* self.moveZ(Math.min(EGEO.MAX_Z, z + 90), 600);
            yield { until: () => !self.paused };
            yield* self.moveZ(back, 400);
          }
        }
        j.layer = j.layers;
        self.phase = 'finish';
        yield* self.moveZ(Math.min(EGEO.MAX_Z, Math.max(self.z + 60, 150)), 600);
        j.done = true;
        self.lastJob = j;
        self.job = null;
        self.phase = 'idle';
        self.dev.onPrintDone(j);
      })(),
      'print'
    );
  }

  pause() {
    if (this.job) this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    if (!this.job) return;
    const j = this.job;
    this.task = null;
    this.wait = null;
    this.uv = 0;
    this.dev.lcdOff();
    j.stopped = true;
    this.lastJob = j;
    this.job = null;
    this.paused = false;
    const self = this;
    this.run(
      (function* () {
        self.phase = 'finish';
        yield* self.moveZ(Math.min(EGEO.MAX_Z, Math.max(self.z + 60, 150)), 600);
        self.phase = 'idle';
      })(),
      'stop'
    );
    this.dev.onPrintDone(j);
  }

  remaining() {
    const j = this.job;
    if (!j) return 0;
    const per = j.file.info.time / j.layers;
    return Math.max(0, (j.layers - j.layer) * per);
  }

  phaseLabel(lang) {
    const de = { homing: 'Referenzfahrt', retract: 'Absenken', rest: 'Wartezeit', expose: 'Belichtung', lift: 'Abziehen (Lift)', paused: 'Pausiert', finish: 'Fährt hoch', idle: 'Bereit' };
    const en = { homing: 'Homing', retract: 'Retracting', rest: 'Rest', expose: 'Exposing', lift: 'Lifting', paused: 'Paused', finish: 'Raising', idle: 'Ready' };
    return (lang === 'de' ? de : en)[this.phase] || this.phase;
  }
}

// ---------------------------------------------------------------------------
export class ElegooMars4 extends BaseDevice {
  constructor(app, slot) {
    super(app, slot, { id: 'elegoo', name: 'ELEGOO Mars 4', kind: 'Resin-Drucker (MSLA)' });
    app.engine.renderer.localClippingEnabled = true;
    const { root, H } = buildMarsModel(app.M);
    this.root.add(root);
    this.H = H;
    this.root.rotation.y = -0.18;
    this.root.updateMatrixWorld(true);

    this.fw = new MarsFirmware(this);
    this.usb = { inserted: true, files: [], remove: (f) => { this.usb.files = this.usb.files.filter((x) => x !== f); this.panelDirty = true; } };
    this.touch = new MarsTouchUI(this);
    this.resin = RESINS[0];
    this.vatMl = 220;
    this.bottleMl = 780;
    this.coverOn = true;
    this.vatIn = true;
    this.film = null;
    this.part = null;
    this.finished = [];

    // touchscreen texture
    this.touchTex = new THREE.CanvasTexture(this.touch.ui.canvas);
    this.touchTex.colorSpace = THREE.SRGBColorSpace;
    this.touchTex.anisotropy = 8;
    H.touchMat.emissiveMap = this.touchTex;
    // LCD mask texture
    this.lcdCanvas = document.createElement('canvas');
    this.lcdCanvas.width = 1024;
    this.lcdCanvas.height = 520;
    this.lcdCtx = this.lcdCanvas.getContext('2d');
    this.lcdTex = new THREE.CanvasTexture(this.lcdCanvas);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    H.lcdMat.emissiveMap = this.lcdTex;
    H.lcdMat.emissive = new THREE.Color(0xa58cff);
    this.lcdOff();

    this.buildAccessories();
    this.applyResin();
    this.setupInteractions();
    this.setupAudio();
    this.loadSamples();

    this.view('overview', 'Übersicht', [240, 520, 720], [0, 230, 0]);
    this.view('touch', 'Touchscreen', [-62, 120, 330], [-62, 70, 110], { minDistance: 80 });
    this.view('vat', 'Wanne & Plattform', [210, 330, 400], [0, 200, 20]);
    this.view('back', 'Rückseite', [340, 230, -270], [80, 50, -110]);
    this.updateMechanics();
  }

  // ---------------------------------------------------------------- setup
  buildAccessories() {
    const M = this.app.M;
    // resin bottle
    const bottle = new THREE.Group();
    bottle.position.set(-220, 0, 60);
    const hdpe = new THREE.MeshPhysicalMaterial({ color: 0x18191b, roughness: 0.55, clearcoat: 0.2 });
    bottle.add(cyl(45, 170, hdpe, { y: 85 }, 40));
    bottle.add(cyl(36, 14, hdpe, { y: 177 }, 32, 45));
    bottle.add(cyl(18, 22, new THREE.MeshPhysicalMaterial({ color: 0xe2e2e2, roughness: 0.4 }), { y: 195 }, 24));
    const label = new THREE.Mesh(new THREE.CylinderGeometry(45.4, 45.4, 90, 40, 1, true, -1.2, 2.4), new THREE.MeshStandardMaterial({ map: this.bottleLabelTexture(), roughness: 0.6 }));
    label.position.y = 90;
    label.rotation.y = 0.2;
    bottle.add(label);
    this.labelMesh = label;
    bottle.traverse((o) => o.isMesh && (o.castShadow = true));
    this.root.add(bottle);
    this.bottle = bottle;
    // nitrile gloves box + spatula
    const gb = rbox(120, 60, 70, 4, new THREE.MeshStandardMaterial({ color: 0x2f62b8, roughness: 0.7 }), { x: -230, y: 30, z: -110, ry: 0.3 });
    this.root.add(gb);
    const glv = textPlane('NITRIL', { w: 40, h: 10, color: '#fff', font: '800 70px Inter, Arial', px: 256 });
    glv.position.set(-215, 40, -75);
    glv.rotation.y = 0.3;
    this.root.add(glv);
    // wash & cure station (decor + target for finished parts)
    const st = new THREE.Group();
    st.position.set(260, 0, -40);
    st.rotation.y = -0.3;
    st.add(rbox(150, 40, 150, 10, new THREE.MeshPhysicalMaterial({ color: 0x1e1f22, roughness: 0.45, clearcoat: 0.3 }), { y: 20 }));
    st.add(cyl(58, 4, new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.6 }), { y: 42 }, 48));
    const stLabel = textPlane('WASH & CURE', { w: 70, h: 8, color: '#bfc3c9', font: '700 60px Inter, Arial', px: 512 });
    stLabel.position.set(0, 20, 75.5);
    st.add(stLabel);
    this.root.add(st);
    this.station = st;
  }

  bottleLabelTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#111';
    ctx.font = '800 64px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ELEGOO', 256, 86);
    ctx.font = '600 30px Inter, Arial';
    ctx.fillText('Standard Resin 2.0', 256, 136);
    this.labelChip = ctx;
    ctx.fillStyle = '#7b7f85';
    ctx.fillRect(176, 166, 160, 40);
    ctx.font = '500 22px Inter, Arial';
    ctx.fillStyle = '#333';
    ctx.fillText('405 nm · 1000 g', 256, 236);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.labelCanvas = c;
    return t;
  }

  applyResin() {
    const r = this.resin;
    this.H.resinMat.color.set(r.liquid);
    this.H.resinMat.opacity = r.opacity < 1 ? 0.75 : 0.95;
    const ctx = this.labelCanvas.getContext('2d');
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(0, 100, 512, 120);
    ctx.fillStyle = '#111';
    ctx.font = '600 28px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(r.name.replace('ELEGOO ', '').split('–')[0].trim(), 256, 136);
    ctx.fillStyle = r.color;
    ctx.fillRect(176, 166, 160, 40);
    this.labelMesh.material.map.needsUpdate = true;
  }

  async loadSamples() {
    for (const s of RESIN_SAMPLES) {
      const { positions, bbox } = toResinPositions(s.build());
      const params = defaultParams(this.resin);
      const info = analyse(positions, bbox, params);
      this.usb.files.push({ name: s.file, title: s.title, positions, bbox, params, info, thumb: resinThumb(positions) });
      await new Promise((r) => setTimeout(r, 0));
    }
    this.panelDirty = true;
    this.touch.ui.dirty = true;
  }

  // ---------------------------------------------------------------- LCD
  lcdOff() {
    const ctx = this.lcdCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1024, 520);
    this.lcdTex.needsUpdate = true;
    this.lcdOn = false;
  }

  lcdFull() {
    this.lcdCtx.fillStyle = '#fff';
    this.lcdCtx.fillRect(0, 0, 1024, 520);
    this.lcdTex.needsUpdate = true;
    this.lcdOn = true;
  }

  lcdTestPattern() {
    const ctx = this.lcdCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1024, 520);
    ctx.fillStyle = '#fff';
    for (let y = 0; y < 520; y += 40) for (let x = 0; x < 1024; x += 40) if (((x + y) / 40) % 2 === 0) ctx.fillRect(x, y, 40, 40);
    ctx.fillStyle = '#000';
    ctx.fillRect(312, 200, 400, 120);
    ctx.fillStyle = '#fff';
    ctx.font = '800 80px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ELEGOO', 512, 262);
    this.lcdTex.needsUpdate = true;
    this.lcdOn = true;
  }

  showLayer(job, i) {
    const p = job.params;
    const z = (i + 0.5) * p.layerHeight;
    const segs = sliceAt(job.file.positions, z);
    job.lastSegs = segs;
    drawMask(this.lcdCtx, segs, 1024, 520);
    this.lcdTex.needsUpdate = true;
    this.lcdOn = true;
  }

  cureLayer(job, i) {
    const p = job.params;
    const area = sectionArea(job.lastSegs || []);
    const ml = (area * p.layerHeight) / 1000;
    const ok = this.vatIn && this.vatMl > ml + 2 && this.part;
    if (!ok) {
      if (!job.failed) {
        job.failed = !this.vatIn ? 'Keine Wanne eingesetzt' : this.vatMl <= ml + 2 ? 'Resin aufgebraucht' : 'Keine Plattform';
        this.app.toast(`<b>${this.name}</b>: Schicht ${i + 1} konnte nicht aushärten (${job.failed}).`, 'err', 6000);
      }
      return;
    }
    this.vatMl -= ml;
    if (!this.fw.leveled && i < p.bottomLayers) {
      // poorly levelled plate: bottom layers stick to the FEP instead
      job.failed = 'Erste Schichten kleben an der FEP-Folie (Plattform nicht nivelliert)';
      this.formFilm(true);
      return;
    }
    if (job.failed) return;
    this.part.setHeight((i + 1) * p.layerHeight);
  }

  formFilm(fromPrint = false) {
    if (!this.vatIn || this.vatMl < 5) return;
    if (!this.film) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(fromPrint ? 60 : EGEO.LCD_W, 0.4, fromPrint ? 40 : EGEO.LCD_D), new THREE.MeshPhysicalMaterial({ color: this.resin.color, roughness: 0.5 }));
      m.position.set(0, 0.7, 0);
      m.userData.transparentToPick = true;
      this.H.vat.add(m);
      this.film = m;
    }
    if (!fromPrint) this.vatMl -= 0.5;
    this.app.toast('Auf der FEP-Folie ist eine ausgehärtete Schicht. Haube ab und die Wanne anklicken, um sie abzuziehen.', 'info', 6000);
  }

  // ---------------------------------------------------------------- print flow
  requestPrint(file) {
    const ui = this.touch;
    if (!this.vatIn) return ui.showDialog(ui.t('noVat'), [[ui.t('ok'), null]]);
    if (this.part && this.part.height > 0) {
      return ui.showDialog('Auf der Plattform hängt noch ein Bauteil. Bitte erst entnehmen (Haube ab, Plattform anklicken).', [[ui.t('ok'), null]]);
    }
    const go = () => {
      ui.screen = 'printing';
      this.fw.startPrint(file, this.resin);
    };
    if (this.vatMl < file.info.volumeMl + 15) return ui.showDialog(ui.t('lowResin'), [[ui.t('yes'), go], [ui.t('no'), null]]);
    go();
  }

  onPrintStart(job) {
    if (this.part) this.part.dispose();
    this.part = new CuredPart(this.H.partAnchor, job.file.positions, this.resin);
    this.part.setHeight(0);
    this.panelDirty = true;
  }

  onPrintDone(job) {
    if (job.stopped) this.app.toast(`<b>${this.name}</b>: Druck gestoppt.`, 'warn');
    else if (job.failed) this.app.toast(`<b>${this.name}</b>: Druck beendet – aber fehlerhaft: ${job.failed}.`, 'err', 7000);
    else this.app.toast(`<b>${this.name}</b>: Druck fertig! Haube abnehmen und Bauteil entnehmen.`, 'ok', 6000);
    if (this.fw.sound) {
      const p = this.sfxPos(this.H.touch);
      this.app.audio.beep(p, 2200, 0.15, 0.1, 'sine');
      setTimeout(() => this.app.audio.beep(p, 2800, 0.25, 0.1, 'sine'), 220);
    }
    this.touch.ui.dirty = true;
    this.panelDirty = true;
  }

  removePart() {
    const part = this.part;
    if (!part || part.height <= 0) return;
    if (this.coverOn) return this.app.toast('Erst die UV-Haube abnehmen.', 'warn');
    if (this.fw.job) return this.app.toast('Der Druck läuft noch.', 'warn');
    if (this.fw.z < 60) return this.app.toast('Plattform erst hochfahren (Werkzeuge → Manuell).', 'warn');
    // move to the wash & cure station
    const mesh = part.mesh;
    this.station.attach(mesh);
    mesh.position.set((this.finished.length % 2) * 40 - 20, 44 + part.height, 0);
    mesh.rotation.set(0, mesh.rotation.y, 0);
    // the part was printed upside down: flip it upright
    mesh.rotation.x = Math.PI;
    mesh.position.y = 44;
    part.mat.clippingPlanes = [];
    // geometry beyond the cured height must be hidden -> keep a static local clip
    const hgt = part.height;
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    part.mat.clippingPlanes = [plane];
    part.staticClip = { plane, hgt };
    this.finished.push(part);
    this.part = null;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60), new THREE.MeshBasicMaterial());
    proxy.layers.set(1);
    mesh.add(proxy);
    this.app.interaction.add(mesh, {
      tooltip: () => ({ title: part.wet ? 'Frisches Resin-Bauteil (klebrig)' : 'Gewaschenes & gehärtetes Bauteil', hint: part.wet ? 'Klicken: in IPA waschen und mit UV nachhärten' : 'Klicken: wegräumen' }),
      onClick: () => {
        if (part.wet) {
          part.finishCure();
          this.app.toast('Gewaschen (IPA) und 4 min UV-nachgehärtet – jetzt fest und matt.', 'ok');
        } else {
          this.app.interaction.remove(mesh);
          part.dispose();
          this.finished = this.finished.filter((f) => f !== part);
          this.panelDirty = true;
        }
      }
    });
    this.app.audio.click(this.sfxPos(this.H.plate), 0.3, 900, 0.05);
    this.app.toast('Bauteil mit dem Spachtel abgelöst und in die Wash-&-Cure-Station gelegt.', 'ok');
    this.panelDirty = true;
  }

  // ---------------------------------------------------------------- interactions
  setupInteractions() {
    const I = this.app.interaction;
    const H = this.H;
    I.add(H.power, {
      tooltip: () => ({ title: `Netzschalter (${this.fw.powered ? 'EIN' : 'AUS'})`, hint: 'Klicken zum Umschalten' }),
      onClick: () => {
        this.fw.setPower(!this.fw.powered);
        this.app.audio.thunk(this.sfxPos(H.power), 0.3, 220, 0.08);
        this.touch.screen = 'home';
        this.touch.ui.dirty = true;
      }
    });
    const toPx = (hit) => (hit && hit.uv ? [hit.uv.x * 480, (1 - hit.uv.y) * 320] : null);
    I.add(H.touch, {
      noHighlight: true,
      cursor: 'pointer',
      tooltip: () => (this.fw.powered ? null : { title: 'Touchscreen (aus)', hint: 'Netzschalter hinten rechts' }),
      onDown: (hit) => {
        const p = toPx(hit);
        if (p && this.fw.powered) this.touch.ui.pointerDown(p[0], p[1]);
        return true;
      },
      onUp: (hit) => {
        const p = toPx(hit);
        if (this.fw.powered) this.touch.ui.pointerUp(p ? p[0] : -1, p ? p[1] : -1);
      },
      onHoverMove: (hit) => {
        const p = toPx(hit);
        if (p && this.fw.powered) this.touch.ui.pointerMove(p[0], p[1]);
      }
    });
    I.add(H.usbStick, {
      tooltip: () => ({ title: this.usb.inserted ? 'USB-Stick (eingesteckt)' : 'USB-Stick', hint: this.usb.inserted ? 'Klicken zum Abziehen' : 'Klicken zum Einstecken' }),
      onClick: () => {
        this.usb.inserted = !this.usb.inserted;
        H.usbStick.position.z = this.usb.inserted ? 115.2 : 150;
        H.usbStick.position.y = this.usb.inserted ? 30 : 4;
        this.app.audio.click(this.sfxPos(H.usbStick), 0.2, 1800, 0.03);
        this.touch.ui.dirty = true;
      }
    });
    I.add(H.cover, {
      tooltip: () => ({ title: 'UV-Schutzhaube', hint: this.coverOn ? 'Klicken: abnehmen' : 'Klicken: wieder aufsetzen' }),
      onClick: () => this.toggleCover()
    });
    I.add(H.vat, {
      tooltip: () => {
        if (this.coverOn) return { title: 'Resin-Wanne', hint: 'Erst die Haube abnehmen' };
        if (this.film) return { title: 'Ausgehärtete Folie in der Wanne', hint: 'Klicken: mit dem Kunststoffspachtel abziehen' };
        return { title: `Resin-Wanne (${Math.round(this.vatMl)} ml)`, hint: this.vatIn ? 'Klicken: Wanne herausnehmen' : 'Klicken: Wanne einsetzen' };
      },
      onClick: () => this.onVatClick()
    });
    I.add(this.bottle, {
      tooltip: () => ({ title: `${this.resin.name} (${Math.round(this.bottleMl)} ml)`, hint: this.coverOn ? 'Erst die Haube abnehmen' : 'Klicken: 100 ml in die Wanne gießen' }),
      onClick: () => this.pourResin()
    });
    I.add(H.plate, {
      tooltip: () => ({ title: 'Druckplattform', hint: this.part && this.part.height > 0 && !this.fw.job ? 'Klicken: Bauteil abnehmen' : 'Lasergravierte Alu-Plattform' }),
      onClick: () => this.removePart()
    });
  }

  toggleCover() {
    if (this.coverAnim) return;
    const c = this.H.cover;
    const on = this.coverOn;
    const from = c.position.clone();
    const to = on ? new THREE.Vector3(235, 0, -255) : new THREE.Vector3(0, EGEO.BASE_H + 1, 0);
    this.coverAnim = { t: 0, from, to, lift: 220 };
    this.coverOn = !on;
    this.app.audio.thunk(this.sfxPos(c), 0.2, 260, 0.08);
    if (!this.coverOn && this.fw.uv) this.app.toast('Achtung: UV-Licht! Haube während der Belichtung aufsetzen.', 'warn');
  }

  onVatClick() {
    if (this.coverOn) return this.app.toast('Erst die UV-Haube abnehmen (Haube anklicken).', 'warn');
    if (this.film) {
      this.H.vat.remove(this.film);
      this.film.geometry.dispose();
      this.film = null;
      this.app.audio.click(this.sfxPos(this.H.vat), 0.25, 700, 0.06);
      this.app.toast('Ausgehärtete Folie entfernt.', 'ok');
      return;
    }
    if (this.fw.job || this.fw.task) return this.app.toast('Nicht während der Drucker arbeitet.', 'warn');
    if (this.fw.z < 60) return this.app.toast('Plattform erst hochfahren (Werkzeuge → Manuell), sonst stößt die Wanne an.', 'warn');
    this.vatIn = !this.vatIn;
    const v = this.H.vat;
    this.vatAnim = { t: 0, from: v.position.clone(), to: this.vatIn ? new THREE.Vector3(0, EGEO.FEP_Y - 0.4, EGEO.LCD_Z) : new THREE.Vector3(-205, 0.2, -170) };
    this.app.audio.click(this.sfxPos(v), 0.25, 900, 0.05);
    this.panelDirty = true;
  }

  pourResin() {
    if (this.coverOn) return this.app.toast('Erst die UV-Haube abnehmen.', 'warn');
    if (!this.vatIn) return this.app.toast('Erst die Wanne einsetzen.', 'warn');
    if (this.vatMl >= VAT_MAX_ML - 5) return this.app.toast('Die Wanne ist bis zur MAX-Markierung voll.', 'warn');
    if (this.bottleMl <= 1) return this.app.toast('Die Flasche ist leer.', 'warn');
    if (this.pourAnim) return;
    const amount = Math.min(100, VAT_MAX_ML - this.vatMl, this.bottleMl);
    this.pourAnim = { t: 0, amount, poured: 0 };
    this.panelDirty = true;
  }

  // ---------------------------------------------------------------- audio
  setupAudio() {
    const a = this.app.audio;
    this.voices = {
      z: a.register(new MotorVoice(this.w(0, 140, -82), { gain: 0.06 })),
      fan: a.register(new FanVoice(this.w(0, 40, 0), { gain: 0.03, size: 60 }))
    };
  }

  // ---------------------------------------------------------------- update
  updateMechanics() {
    const fw = this.fw;
    const H = this.H;
    H.zc.position.y = EGEO.FEP_Y + fw.z + 30;
    H.leadScrew.rotation.y = (fw.z / 2) * Math.PI * 2;
    // resin level
    const lvl = Math.max(0.01, this.vatMl / (VAT_AREA / 1000));
    H.resin.scale.y = lvl;
    H.resin.position.y = 0.4 + lvl / 2;
    H.resin.visible = this.vatMl > 0.5;
  }

  update(simDt, realDt) {
    const fw = this.fw;
    fw.update(simDt);
    this.updateMechanics();
    const H = this.H;
    // FEP peel effect during the lift right after exposure
    let fepLift = 0;
    if (fw.phase === 'lift' && fw.layerZ !== undefined && this.part && this.part.height > 0) {
      const d = fw.z - fw.layerZ;
      if (d < 1.4) fepLift = d * 0.6;
      if (d >= 1.4 && !this.peeled) {
        this.peeled = true;
        this.app.audio.click(this.sfxPos(H.vat), 0.12, 500, 0.05);
      }
    }
    if (fw.phase !== 'lift') this.peeled = false;
    // UV light & LCD
    const uv = fw.uv;
    H.lcdMat.emissiveIntensity = this.lcdOn ? 2.2 : 0;
    H.uvLight.intensity = uv ? 900 : 0;
    H.coverMat.emissiveIntensity = uv && this.coverOn ? 0.35 : 0;
    // touchscreen
    H.touchMat.emissiveIntensity = fw.powered ? 0.9 : 0;
    if (this.touch.render(realDt)) this.touchTex.needsUpdate = true;
    // part clipping
    if (this.part) this.part.update();
    for (const p of this.finished) {
      if (p.staticClip) {
        // upright part: hide everything above the cured height (local y < -h before flip)
        p.mesh.updateMatrixWorld();
        p.staticClip.plane.set(new THREE.Vector3(0, 1, 0), p.staticClip.hgt + 0.001).applyMatrix4(p.mesh.matrixWorld);
      }
    }
    // animations
    if (this.coverAnim) {
      const a = this.coverAnim;
      a.t = Math.min(1, a.t + realDt / 1.3);
      const k = a.t * a.t * (3 - 2 * a.t);
      H.cover.position.lerpVectors(a.from, a.to, k);
      H.cover.position.y += Math.sin(Math.PI * k) * a.lift;
      if (a.t >= 1) this.coverAnim = null;
    }
    if (this.vatAnim) {
      const a = this.vatAnim;
      a.t = Math.min(1, a.t + realDt / 1.1);
      const k = a.t * a.t * (3 - 2 * a.t);
      H.vat.position.lerpVectors(a.from, a.to, k);
      H.vat.position.y += Math.sin(Math.PI * k) * 80;
      if (a.t >= 1) this.vatAnim = null;
    }
    if (this.pourAnim) {
      const a = this.pourAnim;
      a.t += realDt;
      const b = this.bottle;
      const vp = new THREE.Vector3(-150, 210, 20);
      const home = new THREE.Vector3(-220, 0, 60);
      if (a.t < 0.8) {
        const k = a.t / 0.8;
        b.position.lerpVectors(home, vp, k);
        b.rotation.z = -k * 1.9;
      } else if (a.t < 2.6) {
        const k = (a.t - 0.8) / 1.8;
        const target = a.amount * k;
        const d = target - a.poured;
        a.poured = target;
        this.vatMl += d;
        this.bottleMl -= d;
        if (!this.pourStream) {
          this.pourStream = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 1, 10), new THREE.MeshPhysicalMaterial({ color: this.resin.liquid, roughness: 0.1, clearcoat: 1 }));
          this.root.add(this.pourStream);
        }
        const top = 205;
        const bottom = EGEO.FEP_Y + 2;
        this.pourStream.scale.y = top - bottom;
        this.pourStream.position.set(-58, (top + bottom) / 2, 30);
        this.pourStream.visible = true;
      } else if (a.t < 3.4) {
        if (this.pourStream) this.pourStream.visible = false;
        const k = (a.t - 2.6) / 0.8;
        b.position.lerpVectors(vp, home, k);
        b.rotation.z = -(1 - k) * 1.9;
      } else {
        b.position.copy(home);
        b.rotation.z = 0;
        this.pourAnim = null;
        this.panelDirty = true;
      }
    }
    if (this.plateSettle) {
      this.plateSettle -= realDt;
      H.plate.rotation.z = Math.sin(this.plateSettle * 20) * 0.01 * Math.max(0, this.plateSettle);
      if (this.plateSettle <= 0) {
        this.plateSettle = 0;
        H.plate.rotation.z = 0;
      }
    }
    // FEP film bulge
    const fep = H.vat.children.find((c) => c.geometry && c.geometry.type === 'PlaneGeometry');
    if (fep) fep.position.y = 0.4 + fepLift;
    // audio
    if (this.app.audio.ready) {
      const moving = fw.z !== fw.zTarget;
      this.voices.z.set(moving ? fw.zSpeed * 60 : 0, 1);
      this.voices.fan.set(fw.powered && (fw.job || uv) ? 0.7 : 0);
    }
  }

  // ---------------------------------------------------------------- HUD
  status() {
    const fw = this.fw;
    if (!fw.powered) return { state: 'off', text: 'Aus' };
    if (fw.booting > 0) return { state: 'busy', text: 'Startet …' };
    if (fw.job) return fw.paused ? { state: 'warn', text: 'Pausiert' } : { state: 'busy', text: `Druckt ${Math.floor((fw.job.layer / fw.job.layers) * 100)}% · Schicht ${fw.job.layer + 1}` };
    if (fw.lastJob && fw.lastJob.done) return { state: 'on', text: 'Druck fertig ✓' };
    if (fw.task) return { state: 'busy', text: 'Beschäftigt …' };
    return { state: 'on', text: 'Bereit' };
  }

  buildPanel(el) {
    this.panelEl = el;
    el.innerHTML = '';
    this.kv = h('dl', { class: 'kv' });
    el.appendChild(h('div', { class: 'section' }, h('h4', {}, 'Zustand'), this.kv));
    el.appendChild(
      h(
        'div',
        { class: 'section' },
        h('div', {
          class: 'hint',
          html: 'Einschalten: <b>Netzschalter hinten</b> (Kamera „Rückseite“). Bedienung über den <b>Touchscreen</b> vorne. Vor dem Druck: <b>Haube abnehmen</b>, <b>Resin einfüllen</b> (Flasche anklicken), Haube wieder aufsetzen. Nach dem Druck: Bauteil an der Plattform anklicken.'
        })
      )
    );
    this.resinSec = h('div', { class: 'section' });
    el.appendChild(this.resinSec);
    // files
    const fileSec = h('div', { class: 'section' });
    this.fileList = h('ul', { class: 'file-list' });
    const input = h('input', { type: 'file', accept: '.stl', style: 'display:none' });
    input.addEventListener('change', () => {
      if (input.files[0]) this.importStl(input.files[0]);
      input.value = '';
    });
    fileSec.append(
      h('h4', {}, 'USB-Stick'),
      h('p', {}, 'Eigene Modelle als STL hinzufügen – sie werden mit den Resin-Profilen (0,05 mm) vorbereitet. Modelle sollten eine flache Unterseite haben (keine Stützstrukturen).'),
      this.fileList,
      h('button', { class: 'btn primary', style: 'margin-top:8px', onclick: () => input.click() }, 'STL auf Stick kopieren …'),
      input
    );
    el.appendChild(fileSec);
    this.renderPanelParts();
  }

  renderPanelParts() {
    if (!this.resinSec) return;
    const r = this.resinSec;
    r.innerHTML = '';
    const grid = h('div', { class: 'swatches' });
    for (const res of RESINS) {
      const b = h('button', { class: `swatch${res === this.resin ? ' active' : ''}`, disabled: this.vatMl > 1 && res !== this.resin, title: res.name }, h('span', { class: 'chip', style: `background:${res.color}` }), h('span', {}, res.name.replace('ELEGOO ', '')));
      b.addEventListener('click', () => {
        if (this.vatMl > 1) return;
        this.resin = res;
        this.bottleMl = 1000;
        this.applyResin();
        this.renderPanelParts();
      });
      grid.appendChild(b);
    }
    r.append(
      h('h4', {}, 'Resin'),
      h('p', {}, `Wanne: ${Math.round(this.vatMl)} ml (max. ${VAT_MAX_ML} ml) · Flasche: ${Math.round(this.bottleMl)} ml`),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.pourResin() }, '100 ml eingießen'),
        h('button', { class: 'btn', disabled: this.fw.job || this.vatMl < 1, onclick: () => { if (this.coverOn) return this.app.toast('Erst die Haube abnehmen.', 'warn'); this.bottleMl += this.vatMl * 0.95; this.vatMl = 0; this.renderPanelParts(); } }, 'Wanne leeren')
      ),
      h('p', {}, 'Resin wechseln geht nur mit leerer Wanne:'),
      grid
    );
    // files
    this.fileList.innerHTML = '';
    for (const f of this.usb.files) {
      this.fileList.appendChild(h('li', { class: 'file-item' }, h('span', { class: 'fname', title: f.name }, f.name), h('span', { class: 'fmeta' }, `${f.info.layers} Schichten · ${Math.round(f.info.time / 60)} min`)));
    }
    if (this.finished.length) r.append(h('p', {}, `${this.finished.length} Bauteil(e) in der Wash-&-Cure-Station (rechts).`));
  }

  refreshPanel() {
    if (!this.kv) return;
    const fw = this.fw;
    const rows = [
      ['Strom', fw.powered ? 'EIN' : 'AUS'],
      ['Status', this.status().text],
      ['Phase', fw.powered ? fw.phaseLabel('de') : '—'],
      ['Z-Achse', `${fw.z.toFixed(2)} mm`],
      ['UV-Licht', fw.uv ? 'AN (405 nm)' : 'aus'],
      ['Haube', this.coverOn ? 'aufgesetzt' : 'abgenommen'],
      ['Wanne', this.vatIn ? `${Math.round(this.vatMl)} ml Resin` : 'entnommen'],
      ['Nivelliert', fw.leveled ? 'ja' : 'nein']
    ];
    this.kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (this.panelDirty) {
      this.panelDirty = false;
      this.renderPanelParts();
    }
  }

  async importStl(file) {
    try {
      const geo = new STLLoader().parse(await file.arrayBuffer());
      const { positions, bbox } = toResinPositions(geo, true);
      const size = bbox.getSize(new THREE.Vector3());
      if (size.x > EGEO.LCD_W || size.y > EGEO.LCD_D || size.z > EGEO.MAX_Z) {
        this.app.toast(`Zu groß für den Mars 4 (${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)} mm, max 153×77×175).`, 'warn', 6000);
        return;
      }
      const params = defaultParams(this.resin);
      const info = analyse(positions, bbox, params);
      const name = file.name.replace(/\.stl$/i, '') + '_0.05mm.goo';
      this.usb.files.push({ name, title: file.name.replace(/\.stl$/i, ''), positions, bbox, params, info, thumb: resinThumb(positions) });
      this.touch.ui.dirty = true;
      this.renderPanelParts();
      this.app.toast(`<b>${name}</b> vorbereitet: ${info.layers} Schichten, ca. ${Math.round(info.time / 60)} min, ${info.volumeMl.toFixed(1)} ml Resin.`, 'ok', 6000);
    } catch (e) {
      console.error(e);
      this.app.toast(`STL konnte nicht gelesen werden: ${e.message}`, 'err');
    }
  }
}
