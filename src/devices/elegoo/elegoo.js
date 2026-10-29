import * as THREE from 'three';
import { BaseDevice } from '../base.js';
import { buildMarsModel, EGEO } from './model.js';
import { MarsTouchUI } from './touch.js';
import { RESINS, RESIN_SAMPLES, defaultParams, toResinPositions, sliceAt, sectionArea, drawMask, analyse, CuredPart, resinThumb } from './resin.js';
import { MotorVoice, FanVoice } from '../../core/audio.js';
import { rbox, cyl, textPlane } from '../../core/parts.js';
import { buildUsbStick, UsbStick } from '../../core/hand.js';
import { guideCard } from '../../core/workshop.js';

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
    this.touch = new MarsTouchUI(this);
    this.vatResin = RESINS[0];
    this.vatMl = 220;
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
    this.buildUsb();
    this.buildGuide();
    this.applyResin();
    this.setupInteractions();
    this.setupAudio();
    this.loadSamples();

    this.view('overview', 'Übersicht', [240, 520, 720], [0, 230, 0]);
    this.view('touch', 'Touchscreen', [-62, 120, 330], [-62, 70, 110], { minDistance: 80 });
    this.view('vat', 'Wanne & Plattform', [210, 330, 400], [0, 200, 20]);
    this.view('back', 'Rückseite', [340, 230, -270], [80, 50, -110]);
    this.view('bottles', 'Resin-Flaschen', [-300, 330, 430], [-300, 90, 20]);
    this.view('station', 'Wash & Cure', [330, 260, 260], [260, 40, -40]);
    this.view('guide', 'Kurzanleitung', [130, 230, 470], [130, 50, 215], { minDistance: 80 });
    this.updateMechanics();
  }

  // resin currently in the vat (or the last one used)
  get resin() {
    return this.vatResin || RESINS[0];
  }

  viewById(id) {
    return this.cameraViews.find((v) => v.id === id);
  }

  focusViewFor(obj) {
    const inside = (g) => {
      let o = obj;
      while (o) {
        if (o === g) return true;
        o = o.parent;
      }
      return false;
    };
    const H = this.H;
    if (inside(H.touch) || inside(H.usbSocket) || inside(this.stickItem.object)) return this.viewById('touch');
    if (inside(H.power)) return this.viewById('back');
    if (this.bottles.some((b) => inside(b.group))) return this.viewById('bottles');
    if (inside(this.station)) return this.viewById('station');
    if (inside(this.guide)) return this.viewById('guide');
    if (inside(H.cover) || inside(H.vat) || inside(H.zc)) return this.viewById('vat');
    return this.viewById('overview');
  }

  // ---------------------------------------------------------------- USB
  buildUsb() {
    this.stick = new UsbStick('ELEGOO');
    const hand = this.app.hand;
    this.usbSocket = hand.addSocket({
      anchor: this.H.usbSocket,
      onInsert: () => (this.touch.ui.dirty = true),
      onRemove: () => (this.touch.ui.dirty = true)
    });
    this.stickItem = hand.addItem({ object: buildUsbStick(this.app.M, 0x8a1c1c, 'ELEGOO'), kind: 'usb', data: this.stick, socket: this.usbSocket });
    this.stick.listeners.add(() => (this.touch.ui.dirty = true));
  }

  // layer files on the inserted stick
  get usb() {
    const st = this.usbSocket.item?.data;
    return {
      inserted: !!st,
      files: st ? st.files.filter((f) => f.kind === 'goo') : [],
      remove: (f) => st && st.remove(f)
    };
  }

  buildGuide() {
    const card = guideCard('ELEGOO Mars 4', [
      { lines: ['• Netzschalter hinten. Bedienung über den Touchscreen.', '• Haube anklicken = abnehmen. Resin-Flasche anklicken = 100 ml eingießen.', '• Haube wieder aufsetzen, dann Drucken → Datei → Drucken.', '• Danach: Haube ab, Plattform anklicken = Bauteil abnehmen.', '• Resin wechseln: Wanne herausnehmen, anklicken (leeren), wieder einsetzen.'] }
    ], { w: 190, h: 132 });
    card.position.set(130, 0, 200);
    card.rotation.y = -0.35;
    this.root.add(card);
    this.guide = card;
  }

  // ---------------------------------------------------------------- setup
  buildAccessories() {
    const M = this.app.M;
    // resin bottles (one per resin type)
    const hdpe = new THREE.MeshPhysicalMaterial({ color: 0x18191b, roughness: 0.55, clearcoat: 0.2 });
    const capMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e2e2, roughness: 0.4 });
    const spots = [[-205, 75], [-305, 75], [-405, 75], [-255, -35], [-355, -35]];
    this.bottles = RESINS.map((resin, i) => {
      const g = new THREE.Group();
      g.position.set(spots[i][0], 0, spots[i][1]);
      g.rotation.y = 0.3 - i * 0.15;
      g.add(cyl(45, 170, hdpe, { y: 85 }, 40));
      g.add(cyl(36, 14, hdpe, { y: 177 }, 32, 45));
      g.add(cyl(18, 22, capMat, { y: 195 }, 24));
      const label = new THREE.Mesh(new THREE.CylinderGeometry(45.4, 45.4, 90, 40, 1, true, -1.2, 2.4), new THREE.MeshStandardMaterial({ map: this.bottleLabelTexture(resin), roughness: 0.6 }));
      label.position.y = 90;
      label.rotation.y = 0.2;
      g.add(label);
      g.traverse((o) => o.isMesh && (o.castShadow = true));
      this.root.add(g);
      const b = { resin, ml: i === 0 ? 780 : 1000, group: g, home: g.position.clone(), homeRot: g.rotation.y };
      this.app.interaction.add(g, { onClick: () => this.pourResin(b) });
      return b;
    });
    // nitrile gloves box
    const gb = rbox(120, 60, 70, 4, new THREE.MeshStandardMaterial({ color: 0x2f62b8, roughness: 0.7 }), { x: -470, y: 30, z: -120, ry: 0.3 });
    this.root.add(gb);
    const glv = textPlane('NITRIL', { w: 40, h: 10, color: '#fff', font: '800 70px Inter, Arial', px: 256 });
    glv.position.set(-455, 40, -85);
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

  bottleLabelTexture(resin) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.font = '800 64px Inter, Arial';
    ctx.fillText('ELEGOO', 256, 86);
    ctx.font = '600 28px Inter, Arial';
    ctx.fillText(resin.name.replace('ELEGOO ', '').split('–')[0].trim(), 256, 134);
    ctx.font = '500 24px Inter, Arial';
    ctx.fillText((resin.name.split('–')[1] || '').trim(), 256, 164);
    ctx.fillStyle = resin.color;
    ctx.fillRect(176, 180, 160, 30);
    ctx.font = '500 20px Inter, Arial';
    ctx.fillStyle = '#333';
    ctx.fillText('405 nm · 1000 g', 256, 240);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  applyResin() {
    const r = this.resin;
    this.H.resinMat.color.set(r.liquid);
    this.H.resinMat.opacity = r.opacity < 1 ? 0.75 : 0.95;
  }

  async loadSamples() {
    for (const s of RESIN_SAMPLES) {
      const { positions, bbox } = toResinPositions(s.build());
      const params = defaultParams(this.resin);
      const info = analyse(positions, bbox, params);
      this.stick.add({ kind: 'goo', name: s.file, title: s.title, positions, bbox, params, info, thumb: resinThumb(positions), size: info.layers * 3200 });
      await new Promise((r) => setTimeout(r, 0));
    }
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
        // a real Mars does not notice – the layer simply does not form
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
  }

  onPrintDone(job) {
    if (this.fw.sound && !job.stopped) {
      const p = this.sfxPos(this.H.touch);
      this.app.audio.beep(p, 2200, 0.15, 0.1, 'sine');
      setTimeout(() => this.app.audio.beep(p, 2800, 0.25, 0.1, 'sine'), 220);
    }
    this.touch.ui.dirty = true;
  }

  // refused action: a dull knock at the object
  deny(obj) {
    this.app.audio.thunk(this.sfxPos(obj), 0.15, 130, 0.06);
  }

  removePart() {
    const part = this.part;
    if (!part || part.height <= 0) return;
    if (this.coverOn || this.fw.job || this.fw.z < 60) return this.deny(this.H.plate);
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
      onClick: () => {
        if (part.wet) {
          // washed in IPA and post-cured: the part turns matte
          part.finishCure();
          this.app.audio.click(this.sfxPos(this.station), 0.2, 600, 0.08);
        } else {
          this.app.interaction.remove(mesh);
          part.dispose();
          this.finished = this.finished.filter((f) => f !== part);
        }
      }
    });
    this.app.audio.click(this.sfxPos(this.H.plate), 0.3, 900, 0.05);
  }

  // ---------------------------------------------------------------- interactions
  setupInteractions() {
    const I = this.app.interaction;
    const H = this.H;
    I.add(H.power, {
      onClick: () => {
        this.fw.setPower(!this.fw.powered);
        H.rocker.rotation.x = this.fw.powered ? 0.25 : -0.25;
        this.app.audio.thunk(this.sfxPos(H.power), 0.3, 220, 0.08);
        this.touch.screen = 'home';
        this.touch.ui.dirty = true;
      }
    });
    H.rocker.rotation.x = -0.25;
    const toPx = (hit) => (hit && hit.uv ? [hit.uv.x * 480, (1 - hit.uv.y) * 320] : null);
    I.add(H.touch, {
      noHighlight: true,
      cursor: 'pointer',
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
    I.add(H.cover, { onClick: () => this.toggleCover() });
    I.add(H.vat, { onClick: () => this.onVatClick() });
    I.add(H.plate, { onClick: () => this.removePart() });
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
  }

  onVatClick() {
    if (this.coverOn) return this.deny(this.H.cover);
    if (this.film) {
      // scrape the cured film off the FEP
      this.H.vat.remove(this.film);
      this.film.geometry.dispose();
      this.film = null;
      this.app.audio.click(this.sfxPos(this.H.vat), 0.25, 700, 0.06);
      return;
    }
    if (this.fw.job || this.fw.task || this.fw.z < 60 || this.vatAnim) return this.deny(this.H.vat);
    if (!this.vatIn && this.vatMl > 1) {
      // vat on the bench: filter the resin back into its bottle
      const b = this.bottles.find((x) => x.resin === this.vatResin);
      if (b) b.ml = Math.min(1000, b.ml + this.vatMl * 0.97);
      this.vatMl = 0;
      this.vatResin = null;
      this.app.audio.click(this.sfxPos(this.H.vat), 0.25, 500, 0.12);
      return;
    }
    this.vatIn = !this.vatIn;
    const v = this.H.vat;
    this.vatAnim = { t: 0, from: v.position.clone(), to: this.vatIn ? new THREE.Vector3(0, EGEO.FEP_Y - 0.4, EGEO.LCD_Z) : new THREE.Vector3(-205, 0.2, -170) };
    this.app.audio.click(this.sfxPos(v), 0.25, 900, 0.05);
  }

  pourResin(b) {
    if (this.pourAnim) return;
    const mixed = this.vatMl > 1 && this.vatResin && this.vatResin !== b.resin;
    if (this.coverOn || !this.vatIn || mixed || this.vatMl >= VAT_MAX_ML - 5 || b.ml <= 1) return this.deny(b.group);
    const amount = Math.min(100, VAT_MAX_ML - this.vatMl, b.ml);
    if (this.vatMl < 1) {
      this.vatResin = b.resin;
      this.applyResin();
    }
    this.pourAnim = { t: 0, amount, poured: 0, bottle: b };
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
      const bt = a.bottle;
      const b = bt.group;
      const vp = new THREE.Vector3(-150, 210, 20);
      const home = bt.home;
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
        bt.ml -= d;
        if (!this.pourStream) {
          this.pourStream = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 1, 10), new THREE.MeshPhysicalMaterial({ color: this.resin.liquid, roughness: 0.1, clearcoat: 1 }));
          this.root.add(this.pourStream);
        }
        const top = 205;
        const bottom = EGEO.FEP_Y + 2;
        this.pourStream.material.color.set(this.resin.liquid);
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
}
