import * as THREE from 'three';
import { BaseDevice } from '../base.js';
import { buildOrturModel, buildLaptop, LGEO } from './model.js';
import { Grbl } from './grbl.js';
import { LaptopOS, SCREEN_W, SCREEN_H } from '../../laptop/os.js';
import { LASER_MATERIALS, Workpiece, Smoke } from './burn.js';
import { MotorVoice, FanVoice, HumVoice } from '../../core/audio.js';
import { tube, box, rbox, group } from '../../core/parts.js';
import { guideCard } from '../../core/workshop.js';

const MAX_W = 10; // optical watts (LU2-10A)

export class OrturLM3 extends BaseDevice {
  constructor(app, slot, laptopSlot) {
    super(app, slot, { id: 'ortur', name: 'Ortur Laser Master 3', kind: 'Diodenlaser 10 W' });
    const { root, H } = buildOrturModel(app.M);
    this.root.add(root);
    this.H = H;
    this.root.rotation.y = -0.05;

    // laptop
    const lap = buildLaptop(app.M);
    this.laptop = lap;
    const lp = laptopSlot.clone().sub(slot);
    lap.group.position.set(lp.x, 0, lp.z);
    lap.group.rotation.y = -0.38;
    this.root.add(lap.group);
    this.root.updateMatrixWorld(true);

    this.grbl = new Grbl({
      onOutput: (line) => this.serialOut(line),
      onLimit: () => this.app.audio.click(this.sfxPos(this.H.carriage), 0.25, 2600, 0.015),
      onAir: (on) => (this.air = on),
      onBoot: () => {},
      onProgramEnd: () => {}
    });
    this.cableConnected = true;
    this.keyOn = true;
    this.estopPressed = false;
    this.air = false;
    this.nozzleY = 52; // device y of the nozzle bottom (module height)
    this.workpiece = null;
    this.finished = [];
    this.glasses = false;
    this.mpos = new Float64Array(3);
    this.prevPos = new Float64Array(3);
    this.tmp = new THREE.Vector3();
    this.os = new LaptopOS(app, this);
    this.laserApp = this.os.laser;
    this.laserPowerNow = 0;

    // laptop screen texture
    this.screenTex = new THREE.CanvasTexture(this.os.ui.canvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 8;
    lap.screenMat.emissiveMap = this.screenTex;
    lap.screenMat.emissiveIntensity = 0.85;

    this.smoke = new Smoke(this.root);
    this.buildCables();
    this.buildMaterialStack();
    this.setupInteractions();
    this.setupAudio();
    this.setupGlasses();
    this.buildLaptopUsb();
    this.buildGuide();
    this.placeMaterial(LASER_MATERIALS[0]);
    this.focusTo(LGEO.BED_TOP + LASER_MATERIALS[0].t + LGEO.FOCAL + 4); // slightly out of focus at start

    this.view('overview', 'Übersicht', [120, 720, 980], [60, 40, 20]);
    const laptopView = this.view('laptop', 'Laptop', [0, 0, 0], [0, 0, 0], { minDistance: 120, fullscreen: true });
    laptopView.pos = () => this.laptopCam().pos;
    laptopView.target = () => this.laptopCam().target;
    this.view('head', 'Laserkopf', [90, 230, 330], [0, 60, 0], {
      follow: () => this.H.tip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 20, 0))
    });
    this.view('controls', 'Bedienfeld', [330, 230, 470], [280, 40, 230], { minDistance: 80 });
    this.view('material', 'Material', [-10, 650, 200], [-10, 20, 30]);
    this.view('stack', 'Materialstapel', [-460, 330, 480], [-460, 10, 30]);
    this.view('guide', 'Kurzanleitung', [-190, 230, 560], [-190, 50, 360], { minDistance: 80 });
    this.view('usb', 'Laptop-USB', [840, 200, 320], [760, 30, 120], { minDistance: 60 });

    this.updateMechanics();
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
    if (inside(this.laptop.screen)) return this.viewById('laptop');
    if (inside(this.laptop.group)) return this.viewById('laptop');
    if (inside(this.H.ctrl) || inside(this.glassesGroup)) return this.viewById('controls');
    if (inside(this.H.carriage)) return this.viewById('head');
    if (inside(this.stack)) return this.viewById('stack');
    if (inside(this.guide)) return this.viewById('guide');
    if ((this.workpiece && inside(this.workpiece.mesh)) || inside(this.H.honeycomb)) return this.viewById('material');
    return this.viewById('overview');
  }

  // ------------------------------------------------------------- laptop USB
  buildLaptopUsb() {
    this.laptopSocket = this.app.hand.addSocket({
      anchor: this.laptop.usbSocket,
      onInsert: (item) => this.os.setStick(item.data),
      onRemove: () => this.os.setStick(null)
    });
  }

  // ------------------------------------------------------------- quick guide
  buildGuide() {
    const card = guideCard('Ortur Laser Master 3', [
      { lines: ['• Netztaster, Schlüssel und Not-Aus: Bedienfeld vorne rechts.', '• Gesteuert wird nur am Laptop: LaserWerk → Verbinden → Home.', '• Material vom Stapel links auflegen, Fokus: Lasermodul anklicken.', '• Schutzbrille aufsetzen (liegt vor dem Bedienfeld), Rahmen, Start.'] }
    ], { w: 190, h: 120 });
    card.position.set(-190, 0, 345);
    card.rotation.y = 0.12;
    this.root.add(card);
    this.guide = card;
  }

  laptopCam() {
    const s = this.laptop.screen;
    s.updateMatrixWorld(true);
    const c = s.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(s.matrixWorld);
    const cam = this.app.engine.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const tan = Math.tan(vfov / 2);
    const distH = 92.5 / tan / 0.86;
    const distW = 148 / (tan * cam.aspect) / 0.86;
    const dist = Math.max(distH, distW);
    return { pos: c.clone().addScaledVector(n, dist), target: c };
  }

  // ------------------------------------------------------------- mapping
  mapX(X) {
    return X + LGEO.X0;
  }

  mapZ(Y) {
    return LGEO.Z0 - Y;
  }

  surfaceY() {
    return this.workpiece ? this.workpiece.topY : LGEO.BED_TOP;
  }

  focusDelta() {
    return this.nozzleY - LGEO.FOCAL - this.surfaceY();
  }

  spotDiameter() {
    const d = this.focusDelta();
    return Math.sqrt(0.09 * 0.09 + (0.12 * d) * (0.12 * d));
  }

  focusTo(y) {
    this.nozzleY = Math.max(LGEO.BED_TOP + 3, Math.min(LGEO.BED_TOP + 70, y));
    this.H.module.position.y = this.nozzleY;
  }

  // ------------------------------------------------------------- serial
  serialOut(line) {
    if (this.cableConnected) this.laserApp.onSerialLine(line);
  }

  // ------------------------------------------------------------- objects
  buildCables() {
    const lp = this.laptop.group.position;
    const a = new THREE.Vector3(lp.x - 160 * Math.cos(0.38) + 5, 8, lp.z - 20);
    const b = new THREE.Vector3(240 + 49, 30, 272);
    const mid = a.clone().lerp(b, 0.5);
    mid.y = 4;
    this.usbCable = tube([a, a.clone().add(new THREE.Vector3(-25, -3, 10)), mid, b.clone().add(new THREE.Vector3(25, -10, 0)), b], 2.2, this.app.M.wireBlack, 48, 6);
    this.root.add(this.usbCable);
    // module cable (dynamic)
    this.modCable = new THREE.Mesh(new THREE.BufferGeometry(), this.app.M.sleeve);
    this.modCable.castShadow = true;
    this.root.add(this.modCable);
  }

  updateModuleCable() {
    const tip = this.H.module.getWorldPosition(this.tmp.set(0, 0, 0));
    this.root.worldToLocal(tip);
    const key = `${tip.x.toFixed(0)},${tip.z.toFixed(0)},${tip.y.toFixed(0)}`;
    if (key === this.cableKey) return;
    this.cableKey = key;
    const g = this.H.gantry.position;
    const start = new THREE.Vector3(-LGEO.RAIL_X + 20, LGEO.GANTRY_Y + 18, g.z - 6);
    const end = new THREE.Vector3(tip.x - 14, tip.y + 120, tip.z + LGEO.MOD_DZ - 10);
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 40;
    const curve = new THREE.CatmullRomCurve3([start, start.clone().add(new THREE.Vector3(10, 30, 0)), mid, end.clone().add(new THREE.Vector3(0, 30, 0)), end]);
    this.modCable.geometry.dispose();
    this.modCable.geometry = new THREE.TubeGeometry(curve, 40, 2.6, 6, false);
  }

  buildMaterialStack() {
    // stack of fresh workpieces to the left of the machine
    this.stack = new THREE.Group();
    this.stack.position.set(-460, 0, 120);
    this.stack.rotation.y = 0.12;
    this.root.add(this.stack);
    this.stackItems = [];
    let y = 0;
    const order = LASER_MATERIALS.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    order.forEach((def, i) => {
      const geo = new THREE.BoxGeometry(def.w * 0.5, def.t, def.h * 0.5);
      const col = { plywood: 0xd8b98c, mdf: 0x9e7a55, cardboard: 0xa58d6c, leather: 0x8b5a36, acrylic: 0x111111, slate: 0x2c2d31, anodized: 0x23377a }[def.surface];
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: def.glossy ? 0.1 : 0.8, metalness: def.metal ? 0.8 : 0, clearcoat: def.glossy ? 1 : 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set((i % 2) * 8 - 4, y + def.t / 2, (i % 3) * 6 - 6);
      m.rotation.y = (i % 2 ? 1 : -1) * 0.05;
      m.castShadow = true;
      m.receiveShadow = true;
      y += def.t + 0.2;
      this.stack.add(m);
      this.stackItems.push({ def, mesh: m });
      this.app.interaction.add(m, { onClick: () => this.placeMaterial(def) });
    });
  }

  placeMaterial(def) {
    if (this.workpiece || this.grbl.state === 'Run' || this.laserApp.job) {
      this.app.audio.thunk(this.sfxPos(this.stack), 0.15, 140, 0.06);
      return;
    }
    const X0 = 10;
    const Y0 = 10;
    const wp = new Workpiece(def, X0, Y0, LGEO.BED_TOP);
    wp.place((x) => this.mapX(x), (y) => this.mapZ(y));
    this.root.add(wp.mesh);
    this.workpiece = wp;
    this.app.interaction.add(wp.mesh, { onClick: () => this.takeWorkpiece() });
    this.app.audio.thunk(this.sfxPos(wp.mesh), 0.18, 260, 0.06);
    this.os.ui.dirty = true;
    this.laserApp.estimateDirty = true;
  }

  takeWorkpiece() {
    const wp = this.workpiece;
    if (!wp) return;
    if (this.laserApp.job || this.grbl.state === 'Run') {
      this.app.audio.thunk(this.sfxPos(wp.mesh), 0.15, 140, 0.06);
      return;
    }
    this.app.interaction.remove(wp.mesh);
    this.workpiece = null;
    if (wp.burnedPixels > 50 || wp.cutPixels > 0) {
      // keep the finished piece on the bench (right of the stack)
      const idx = this.finished.length;
      wp.mesh.position.set(-460 + (idx % 2) * 30, wp.def.t / 2 + 1 + Math.floor(idx / 2) * 1, -170 + (idx % 3) * 20);
      wp.mesh.rotation.y = 0.3 - idx * 0.2;
      this.finished.push(wp);
      this.app.interaction.add(wp.mesh, { onClick: () => this.removeFinished(wp) });
      if (this.finished.length > 4) this.removeFinished(this.finished[0]);
    } else {
      this.root.remove(wp.mesh);
      wp.dispose();
    }
    this.os.ui.dirty = true;
  }

  removeFinished(wp) {
    this.app.interaction.remove(wp.mesh);
    this.root.remove(wp.mesh);
    wp.dispose();
    this.finished = this.finished.filter((f) => f !== wp);
  }

  // ------------------------------------------------------------- interactions
  setupInteractions() {
    const I = this.app.interaction;
    const H = this.H;
    I.add(H.powerBtn, {
      onClick: () => {
        const on = !this.grbl.powered;
        this.grbl.setPower(on);
        if (on && this.estopPressed) this.grbl.setEstop(true);
        H.powerCap.position.y = 2.4;
        setTimeout(() => (H.powerCap.position.y = 3.2), 150);
        this.app.audio.click(this.sfxPos(H.powerBtn), 0.3, 1800, 0.02);
      }
    });
    I.add(H.keySwitch, {
      onClick: () => {
        this.keyOn = !this.keyOn;
        this.app.audio.click(this.sfxPos(H.keySwitch), 0.3, 1400, 0.03);
      }
    });
    I.add(H.estop, {
      onClick: () => {
        this.estopPressed = !this.estopPressed;
        this.grbl.setEstop(this.estopPressed);
        this.app.audio.thunk(this.sfxPos(H.estop), 0.4, 200, 0.08);
        if (this.estopPressed) this.laserApp.job = null;
      }
    });
    I.add(H.module, {
      onWheel: (steps) => {
        if (this.focusAnim) return true;
        this.focusTo(this.nozzleY - steps * 0.5);
        this.H.thumb.rotation.x += steps * 0.4;
        this.app.audio.click(this.sfxPos(H.module), 0.06, 3000, 0.01);
        return true;
      },
      onClick: () => this.autoFocus()
    });
    // laptop screen: mouse surface for the laptop OS
    const screen = this.laptop.screen;
    const toPx = (hit) => (hit && hit.uv ? [hit.uv.x * SCREEN_W, (1 - hit.uv.y) * SCREEN_H] : null);
    const planeHit = (ray) => {
      // keep dragging even when leaving the screen: intersect the screen plane
      const n = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
      const p = screen.getWorldPosition(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
      const hitP = new THREE.Vector3();
      if (!ray.intersectPlane(plane, hitP)) return null;
      const local = screen.worldToLocal(hitP);
      return [(local.x / 296 + 0.5) * SCREEN_W, (0.5 - local.y / 185) * SCREEN_H];
    };
    I.add(screen, {
      cursor: 'default',
      noHighlight: true,
      onDown: (hit) => {
        const p = toPx(hit);
        if (p) this.os.pointerDown(p[0], p[1]);
        this.app.audio.unlock();
        return true;
      },
      onDrag: (hit, e, ray) => {
        const p = (hit && toPx(hit)) || planeHit(ray);
        if (p) this.os.pointerMove(p[0], p[1]);
      },
      onUp: (hit, e) => {
        let p = toPx(hit);
        if (!p) {
          const I2 = this.app.interaction;
          I2.setPointer(e);
          I2.raycaster.setFromCamera(I2.pointer, this.app.engine.camera);
          p = planeHit(I2.raycaster.ray);
        }
        this.os.pointerUp(p ? p[0] : -1, p ? p[1] : -1);
      },
      onHoverMove: (hit) => {
        const p = toPx(hit);
        if (p) this.os.pointerMove(p[0], p[1]);
      },
      onWheel: (steps) => {
        this.os.wheel(steps);
        return true;
      }
    });
  }

  autoFocus() {
    if (this.focusAnim) return;
    if (this.grbl.state === 'Run') {
      this.app.audio.thunk(this.sfxPos(this.H.module), 0.15, 140, 0.06);
      return;
    }
    const target = this.surfaceY() + LGEO.FOCAL;
    this.focusAnim = { t: 0, from: this.nozzleY, to: target };
    this.app.audio.click(this.sfxPos(this.H.module), 0.2, 1500, 0.03);
  }

  laptopHasFocus() {
    let o = this.app.interaction.lastDownObject;
    while (o) {
      if (o === this.laptop.group) return true;
      o = o.parent;
    }
    return false;
  }

  onKey(e, down) {
    if (!down || !this.laptopHasFocus()) return false;
    const used = this.os.onKey(e);
    if (used) this.os.render(0, true);
    return used;
  }

  // ------------------------------------------------------------- glasses
  setupGlasses() {
    let el = document.getElementById('laser-glasses');
    if (!el) {
      el = document.createElement('div');
      el.id = 'laser-glasses';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at center, rgba(255,120,0,0.55) 0%, rgba(255,95,0,0.62) 60%, rgba(40,10,0,0.85) 100%);mix-blend-mode:multiply;display:none;';
      document.body.appendChild(el);
    }
    this.glassesEl = el;
    // the glasses lie in an open case in front of the control box
    const M = this.app.M;
    const g = group('glasses-case', { x: 330, y: 0, z: 205, ry: -0.3 });
    const caseMat = new THREE.MeshPhysicalMaterial({ color: 0x1d1f22, roughness: 0.75 });
    g.add(rbox(176, 4, 70, 3, caseMat, { y: 2 }));
    for (const sz of [-1, 1]) g.add(box(176, 22, 3, caseMat, { y: 11, z: sz * 33.5 }));
    for (const sx of [-1, 1]) g.add(box(3, 22, 70, caseMat, { x: sx * 86.5, y: 11 }));
    g.add(box(170, 1, 64, new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 1 }), { y: 4.5 }));
    // OD4+ goggles for 445 nm: orange lens, black frame, folded temples
    const glasses = group('laser-glasses', { y: 5 });
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xff7a00, roughness: 0.06, transparent: true, opacity: 0.8, clearcoat: 1, emissive: 0x4a1800, emissiveIntensity: 0.35 });
    const lens = rbox(144, 2.5, 44, 1, lensMat, { y: 14, z: 6, rx: -0.45 });
    glasses.add(lens);
    glasses.add(box(150, 6, 6, M.plasticBlack, { y: 23, z: -12, rx: -0.45 }));
    glasses.add(box(8, 6, 14, M.plasticBlack, { y: 10, z: 10 }));
    for (const [z, y] of [[-20, 4], [-26, 8]]) glasses.add(box(132, 3.5, 4, M.plasticBlack, { y, z }));
    g.add(glasses);
    this.root.add(g);
    this.glassesGroup = g;
    this.glassesMesh = glasses;
    this.app.interaction.add(g, {
      onClick: () => {
        this.setGlasses(!this.glasses);
        this.app.audio.click(this.sfxPos(g), 0.2, 1200, 0.04);
      }
    });
  }

  setGlasses(on) {
    this.glasses = on;
    this.glassesEl.style.display = on ? 'block' : 'none';
    this.glassesMesh.visible = !on;
  }

  // ------------------------------------------------------------- audio
  setupAudio() {
    const a = this.app.audio;
    this.voices = {
      x: a.register(new MotorVoice(this.w(-240, 70, 0), { gain: 0.05 })),
      y: a.register(new MotorVoice(this.w(0, 40, -280), { gain: 0.06 })),
      fan: a.register(new FanVoice(this.w(0, 160, 0), { gain: 0.03, size: 40 })),
      air: a.register(new HumVoice(this.w(0, 20, 0), { freq: 95, gain: 0.05, type: 'sawtooth' })),
      laser: a.register(new HumVoice(this.w(0, 50, 0), { freq: 1900, gain: 0.006, type: 'square' }))
    };
    this.vel = new Float64Array(3);
  }

  updateAudio() {
    if (!this.app.audio.ready) return;
    const g = this.grbl;
    g.planner.velocity(this.vel);
    const v = this.voices;
    v.x.set(Math.abs(this.vel[0]) * 5, 1);
    v.y.set(Math.abs(this.vel[1]) * 5, 1);
    const tip = this.H.tip.getWorldPosition(this.tmp);
    v.x.setPos(tip);
    v.fan.setPos(tip);
    v.fan.set(g.powered ? 0.8 : 0);
    v.air.set(g.powered && this.air ? 1 : 0);
    v.laser.set(this.laserPowerNow > 0 ? 0.3 + this.laserPowerNow : 0);
  }

  // ------------------------------------------------------------- update
  updateMechanics() {
    const p = this.grbl.planner.position(this.mpos);
    const H = this.H;
    H.gantry.position.z = this.mapZ(p[1]) - LGEO.MOD_DZ;
    H.carriage.position.x = this.mapX(p[0]);
    if (H.yBeltL) {
      H.yBeltL.offset.x = p[1] / 2;
      H.yBeltR.offset.x = p[1] / 2;
    }
    if (H.xBelt) H.xBelt.offset.x = -p[0] / 2;
  }

  update(simDt, realDt) {
    const g = this.grbl;
    const wp = this.workpiece;
    let rem = simDt;
    let burnRate = 0;
    let guard = 0;
    while (rem > 1e-9 && guard++ < 20000) {
      const v = g.planner.velocity();
      const step = Math.min(rem, v > 1 ? Math.max(0.0005, 0.35 / v) : 0.02);
      g.planner.position(this.prevPos);
      g.update(step);
      this.laserApp.update(step, guard === 1 ? realDt : 0);
      const pw = this.keyOn ? g.laserPower() : 0;
      if (pw > 0) {
        const p1 = g.planner.position(this.mpos);
        const watts = pw * MAX_W;
        const joules = watts * step;
        burnRate += joules;
        if (wp) {
          const spot = this.spotDiameter();
          const x0 = this.prevPos[0];
          const y0 = this.prevPos[1];
          const dx = p1[0] - x0;
          const dy = p1[1] - y0;
          const len = Math.hypot(dx, dy);
          const ds = Math.max(0.02, Math.min(wp.px * 0.6, spot * 0.5));
          const n = Math.max(1, Math.ceil(len / ds));
          const e = joules / n;
          for (let i = 0; i < n; i++) {
            const f = (i + 0.5) / n;
            wp.deposit(x0 + dx * f, y0 + dy * f, e, spot);
          }
        }
      }
      rem -= step;
    }
    this.laserPowerNow = this.keyOn ? g.laserPower() : 0;
    this.updateMechanics();
    this.updateModuleCable();

    // focus animation (gauge down, slide module, gauge up)
    if (this.focusAnim) {
      const f = this.focusAnim;
      f.t += realDt;
      const H = this.H;
      if (f.t < 0.5) H.gaugeArm.rotation.z = Math.PI * 0.97 * (1 - f.t / 0.5);
      else if (f.t < 1.6) {
        H.gaugeArm.rotation.z = 0;
        const k = (f.t - 0.5) / 1.1;
        this.focusTo(f.from + (f.to - f.from) * (k * k * (3 - 2 * k)));
      } else if (f.t < 2.1) H.gaugeArm.rotation.z = Math.PI * 0.97 * ((f.t - 1.6) / 0.5);
      else {
        H.gaugeArm.rotation.z = Math.PI * 0.97;
        this.focusTo(f.to);
        this.focusAnim = null;
        this.app.audio.click(this.sfxPos(this.H.module), 0.2, 2600, 0.02);
      }
    }

    // laser spot visuals
    const H = this.H;
    const pw = this.laserPowerNow;
    const glassesK = this.glasses ? 0.25 : 1;
    if (pw > 0) {
      const sy = this.surfaceY() + 0.4;
      const x = this.mapX(this.mpos[0]);
      const z = this.mapZ(this.mpos[1]);
      H.spot.visible = true;
      H.spotCore.visible = true;
      H.spot.position.set(x, sy, z);
      H.spotCore.position.set(x, sy, z);
      const s = (4 + 22 * Math.sqrt(pw)) * (1 + Math.abs(this.focusDelta()) * 0.1);
      H.spot.scale.set(s, s, 1);
      H.spotMat.opacity = Math.min(1, 0.4 + pw) * glassesK;
      H.spotCore.scale.set(1.5 + pw * 3, 1.5 + pw * 3, 1);
      H.spotLight.position.set(x, sy + 6, z);
      H.spotLight.intensity = (250 + 4200 * pw) * glassesK * (0.85 + Math.random() * 0.3);
      H.shieldMat.emissiveIntensity = 0.2 + pw * 2.5;
      // smoke & embers
      if (wp && wp.contains(this.mpos[0], this.mpos[1])) {
        const rate = Math.min(140, (burnRate / Math.max(1e-6, simDt)) * 9 * wp.def.smoke);
        this.smoke.emit(x, sy, z, rate, realDt, this.air);
        if (wp.def.embers && pw > 0.7 && this.grbl.planner.velocity() < 15 && Math.random() < 0.5) this.smoke.embers.emit(x, sy, z, 1);
      }
    } else {
      H.spot.visible = false;
      H.spotCore.visible = false;
      H.spotLight.intensity = 0;
      H.shieldMat.emissiveIntensity = 0.2;
    }
    this.smoke.update(realDt);
    if (wp) wp.flush(this.app.engine.renderer);

    // power LED
    H.powerLed.emissiveIntensity = this.grbl.powered ? 2.4 : 0;
    H.estopMush.position.y = this.estopPressed ? -3 : 0;
    H.estopMush.rotation.y = this.estopPressed ? 0 : 0.6;
    H.keyRot.rotation.y = this.keyOn ? Math.PI / 2 : 0;
    if (this.grbl.powered) H.moduleFan.rotation.z += realDt * 50;

    // laptop screen
    this.os.render(realDt);
    if (this.os.needsUpload) {
      this.os.needsUpload = false;
      this.screenTex.needsUpdate = true;
    }
    this.updateAudio();
  }

  onJobDone() {
    // GRBL itself has no buzzer – the software chimes on the laptop
    const p = this.sfxPos(this.laptop.group);
    this.app.audio.beep(p, 880, 0.12, 0.08, 'sine');
    setTimeout(() => this.app.audio.beep(p, 1320, 0.18, 0.08, 'sine'), 160);
  }
}
