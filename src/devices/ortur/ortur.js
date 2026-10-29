import * as THREE from 'three';
import { BaseDevice, h } from '../base.js';
import { buildOrturModel, buildLaptop, LGEO } from './model.js';
import { Grbl } from './grbl.js';
import { LaserApp } from './laserapp.js';
import { LASER_MATERIALS, Workpiece, Smoke } from './burn.js';
import { MotorVoice, FanVoice, HumVoice } from '../../core/audio.js';
import { tube } from '../../core/parts.js';

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
    this.laserApp = new LaserApp(this);
    this.laserPowerNow = 0;

    // laptop screen texture
    this.screenTex = new THREE.CanvasTexture(this.laserApp.ui.canvas);
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
    this.placeMaterial(LASER_MATERIALS[0]);
    this.focusTo(LGEO.BED_TOP + LASER_MATERIALS[0].t + LGEO.FOCAL + 4); // slightly out of focus at start

    this.view('overview', 'Übersicht', [120, 720, 980], [60, 40, 20]);
    const laptopView = this.view('laptop', 'Laptop', [0, 0, 0], [0, 0, 0], { minDistance: 120, fullscreen: true });
    laptopView.pos = () => this.laptopCam().pos;
    laptopView.target = () => this.laptopCam().target;
    this.view('head', 'Laserkopf', [90, 230, 330], [0, 60, 0], {
      follow: () => this.H.tip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 20, 0))
    });
    this.view('controls', 'Bedienfeld', [330, 230, 470], [240, 40, 262], { minDistance: 80 });
    this.view('material', 'Material', [-10, 650, 200], [-10, 20, 30]);

    this.updateMechanics();
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
      this.app.interaction.add(m, {
        tooltip: () => ({ title: def.name, hint: this.workpiece ? 'Erst das aufliegende Werkstück abnehmen' : 'Klicken: auf die Wabenplatte legen (vorne links anlegen)' }),
        onClick: () => this.placeMaterial(def)
      });
    });
  }

  placeMaterial(def) {
    if (this.workpiece) {
      this.app.toast('Auf der Wabenplatte liegt schon ein Werkstück.', 'warn');
      return;
    }
    if (this.grbl.state === 'Run' || this.laserApp.job) {
      this.app.toast('Nicht während der Laser arbeitet!', 'warn');
      return;
    }
    const X0 = 10;
    const Y0 = 10;
    const wp = new Workpiece(def, X0, Y0, LGEO.BED_TOP);
    wp.place((x) => this.mapX(x), (y) => this.mapZ(y));
    this.root.add(wp.mesh);
    this.workpiece = wp;
    this.app.interaction.add(wp.mesh, {
      tooltip: () => ({ title: `${def.name} (auf dem Lasertisch)`, hint: this.laserApp.job ? 'Laser arbeitet …' : 'Klicken: Werkstück abnehmen' }),
      onClick: () => this.takeWorkpiece()
    });
    this.app.audio.thunk(this.sfxPos(wp.mesh), 0.18, 260, 0.06);
    this.laserApp.ui.dirty = true;
    this.laserApp.estimateDirty = true;
    this.panelDirty = true;
  }

  takeWorkpiece() {
    const wp = this.workpiece;
    if (!wp) return;
    if (this.laserApp.job || this.grbl.state === 'Run') {
      this.app.toast('Erst den Auftrag beenden oder stoppen.', 'warn');
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
      this.app.interaction.add(wp.mesh, {
        tooltip: { title: `Fertiges Werkstück: ${wp.def.name}`, hint: 'Klicken zum Wegräumen' },
        onClick: () => this.removeFinished(wp)
      });
      if (this.finished.length > 4) this.removeFinished(this.finished[0]);
      this.app.toast('Werkstück abgenommen und hinten links abgelegt.', 'ok');
    } else {
      this.root.remove(wp.mesh);
      wp.dispose();
    }
    this.laserApp.ui.dirty = true;
    this.panelDirty = true;
  }

  removeFinished(wp) {
    this.app.interaction.remove(wp.mesh);
    this.root.remove(wp.mesh);
    wp.dispose();
    this.finished = this.finished.filter((f) => f !== wp);
    this.panelDirty = true;
  }

  // ------------------------------------------------------------- interactions
  setupInteractions() {
    const I = this.app.interaction;
    const H = this.H;
    I.add(H.powerBtn, {
      tooltip: () => ({ title: `Netztaster (${this.grbl.powered ? 'EIN' : 'AUS'})`, hint: 'Klicken zum Ein-/Ausschalten' }),
      onClick: () => {
        const on = !this.grbl.powered;
        this.grbl.setPower(on);
        if (on && this.estopPressed) this.grbl.setEstop(true);
        H.powerCap.position.y = 2.4;
        setTimeout(() => (H.powerCap.position.y = 3.2), 150);
        this.app.audio.click(this.sfxPos(H.powerBtn), 0.3, 1800, 0.02);
        if (on) this.app.toast('Laser Master 3 startet – danach in der Software verbinden.', 'info', 3000);
      }
    });
    I.add(H.keySwitch, {
      tooltip: () => ({ title: `Schlüsselschalter (${this.keyOn ? 'Laser freigegeben' : 'Laser gesperrt'})`, hint: 'Klicken zum Drehen' }),
      onClick: () => {
        this.keyOn = !this.keyOn;
        this.app.audio.click(this.sfxPos(H.keySwitch), 0.3, 1400, 0.03);
      }
    });
    I.add(H.estop, {
      tooltip: () => ({ title: `Not-Aus${this.estopPressed ? ' (GEDRÜCKT)' : ''}`, hint: this.estopPressed ? 'Klicken: herausdrehen zum Entriegeln' : 'Klicken: sofort alles stoppen' }),
      onClick: () => {
        this.estopPressed = !this.estopPressed;
        this.grbl.setEstop(this.estopPressed);
        this.app.audio.thunk(this.sfxPos(H.estop), 0.4, 200, 0.08);
        if (this.estopPressed) this.laserApp.job = null;
      }
    });
    I.add(H.module, {
      tooltip: () => {
        const d = this.focusDelta();
        const ok = Math.abs(d) < 0.6;
        return {
          title: 'Lasermodul LU2-10A',
          hint: `Fokus: ${ok ? 'OK ✓' : `${d > 0 ? '+' : ''}${d.toFixed(1)} mm daneben`} · Mausrad = Höhe verstellen · Klick = Fokuslehre benutzen`
        };
      },
      onWheel: (steps) => {
        if (this.focusAnim) return true;
        this.focusTo(this.nozzleY - steps * 0.5);
        this.H.thumb.rotation.x += steps * 0.4;
        this.app.audio.click(this.sfxPos(H.module), 0.06, 3000, 0.01);
        return true;
      },
      onClick: () => this.autoFocus()
    });
    // laptop screen = touch/mouse surface
    const screen = this.laptop.screen;
    const toPx = (hit) => (hit && hit.uv ? [hit.uv.x * 1280, (1 - hit.uv.y) * 800] : null);
    const planeHit = (ray) => {
      // keep dragging even when leaving the screen: intersect the screen plane
      const s = this.laptop.screen;
      const n = new THREE.Vector3(0, 0, 1).transformDirection(s.matrixWorld);
      const p = s.getWorldPosition(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
      const hitP = new THREE.Vector3();
      if (!ray.intersectPlane(plane, hitP)) return null;
      const local = s.worldToLocal(hitP);
      return [(local.x / 296 + 0.5) * 1280, (0.5 - local.y / 185) * 800];
    };
    I.add(screen, {
      cursor: 'default',
      noHighlight: true,
      tooltip: null,
      onDown: (hit) => {
        const p = toPx(hit);
        if (p) this.laserApp.ui.pointerDown(p[0], p[1]);
        this.laptopFocus = true;
        this.app.audio.unlock();
        return true;
      },
      onDrag: (hit, e, ray) => {
        const p = (hit && toPx(hit)) || planeHit(ray);
        if (p) this.laserApp.ui.pointerMove(p[0], p[1]);
      },
      onUp: (hit, e) => {
        let p = toPx(hit);
        if (!p) {
          const I2 = this.app.interaction;
          I2.setPointer(e);
          I2.raycaster.setFromCamera(I2.pointer, this.app.engine.camera);
          p = planeHit(I2.raycaster.ray);
        }
        if (p) this.laserApp.ui.pointerUp(p[0], p[1]);
        else this.laserApp.ui.pointerUp(-1, -1);
      },
      onHoverMove: (hit) => {
        const p = toPx(hit);
        if (p) this.laserApp.ui.pointerMove(p[0], p[1]);
      },
      onWheel: (steps) => {
        this.laserApp.ui.wheel(steps);
        return true;
      }
    });
  }

  autoFocus() {
    if (this.focusAnim) return;
    if (this.grbl.state === 'Run') {
      this.app.toast('Nicht während des Laserns fokussieren!', 'warn');
      return;
    }
    const target = this.surfaceY() + LGEO.FOCAL;
    this.focusAnim = { t: 0, from: this.nozzleY, to: target };
    this.app.audio.click(this.sfxPos(this.H.module), 0.2, 1500, 0.03);
  }

  onKey(e, down) {
    if (!down) return false;
    if (this.laptopFocus && this.app.currentView?.id === 'laptop') {
      const used = this.laserApp.onKey(e);
      if (used) this.laserApp.ui.dirty = true;
      return used || this.laserApp.ui.focus !== null;
    }
    return false;
  }

  onView(v) {
    this.laptopFocus = v && v.id === 'laptop';
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
  }

  setGlasses(on) {
    this.glasses = on;
    this.glassesEl.style.display = on ? 'block' : 'none';
  }

  onDeactivate() {
    if (this.glasses) this.setGlasses(false);
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
        this.app.toast('Fokus eingestellt: Lehre berührt das Material, Modul festgezogen.', 'ok', 3000);
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
    if (this.laserApp.render(realDt)) this.screenTex.needsUpdate = true;
    this.updateAudio();
  }

  // ------------------------------------------------------------- HUD
  status() {
    const g = this.grbl;
    if (!g.powered) return { state: 'off', text: 'Aus' };
    if (this.estopPressed) return { state: 'err', text: 'NOT-AUS' };
    const j = this.laserApp.job;
    if (j && !j.frame) return { state: 'busy', text: `Lasert ${Math.floor((j.acked / Math.max(1, j.total)) * 100)}%` };
    const st = g.state;
    if (st === 'Alarm') return { state: 'warn', text: 'Gesperrt (Alarm)' };
    if (st === 'Home') return { state: 'busy', text: 'Referenzfahrt' };
    if (st === 'Run' || st === 'Jog') return { state: 'busy', text: 'Bewegt sich' };
    if (st.startsWith('Hold')) return { state: 'warn', text: 'Pausiert' };
    return { state: 'on', text: this.laserApp.connected ? 'Bereit (verbunden)' : 'Bereit' };
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
          html: 'Kein Display: Der Laser wird wie in echt <b>per USB vom Laptop</b> gesteuert. Ablauf: <b>Netztaster</b> (Bedienfeld vorne rechts) → Kamera <b>„Laptop“</b> → <b>Verbinden</b> → <b>Home</b> → Motiv wählen → <b>Rahmen</b> → <b>Start</b>. Vorher den <b>Fokus</b> am Lasermodul einstellen (Modul anklicken).'
        })
      )
    );
    // safety
    const glassesBtn = h('button', { class: 'btn block' }, '');
    const syncGlasses = () => (glassesBtn.textContent = this.glasses ? 'Laserschutzbrille absetzen' : 'Laserschutzbrille aufsetzen (OD 4+, 445 nm)');
    syncGlasses();
    glassesBtn.addEventListener('click', () => {
      this.setGlasses(!this.glasses);
      syncGlasses();
    });
    el.appendChild(h('div', { class: 'section' }, h('h4', {}, 'Sicherheit'), h('p', {}, 'Ein 10-W-Diodenlaser ist Klasse 4: Ohne Schutzbrille nie in den Laserpunkt schauen. Die Brille filtert das blaue Licht.'), glassesBtn));
    // materials
    this.matSec = h('div', { class: 'section' });
    el.appendChild(this.matSec);
    this.renderPanelParts();
  }

  renderPanelParts() {
    if (!this.matSec) return;
    this.matSec.innerHTML = '';
    const grid = h('div', { class: 'swatches' });
    for (const def of LASER_MATERIALS) {
      const col = { plywood: '#d8b98c', mdf: '#9e7a55', cardboard: '#a58d6c', leather: '#8b5a36', acrylic: '#151515', slate: '#2c2d31', anodized: '#23377a' }[def.surface];
      const b = h('button', { class: `swatch${this.workpiece?.def === def ? ' active' : ''}`, disabled: !!this.workpiece, title: def.name }, h('span', { class: 'chip', style: `background:${col}` }), h('span', {}, def.name), h('span', { class: 'sw-sub' }, `${def.w}×${def.h}×${def.t} mm`));
      b.addEventListener('click', () => {
        this.placeMaterial(def);
        this.renderPanelParts();
      });
      grid.appendChild(b);
    }
    this.matSec.append(
      h('h4', {}, 'Material'),
      h('p', {}, this.workpiece ? `Auf dem Tisch: ${this.workpiece.def.name} (vorne links an X10/Y10 angelegt).` : 'Kein Werkstück aufgelegt. Wähle eines aus dem Stapel (oder klicke den Stapel links neben dem Laser an).'),
      this.workpiece ? h('button', { class: 'btn', onclick: () => { this.takeWorkpiece(); this.renderPanelParts(); } }, 'Werkstück abnehmen') : grid,
      this.finished.length ? h('p', {}, `${this.finished.length} fertige(s) Werkstück(e) liegen links hinter dem Laser.`) : null
    );
  }

  refreshPanel() {
    if (!this.kv) return;
    const g = this.grbl;
    const d = this.focusDelta();
    const rows = [
      ['Strom', g.powered ? 'EIN' : 'AUS'],
      ['Schlüssel', this.keyOn ? 'Laser freigegeben' : 'gesperrt'],
      ['Not-Aus', this.estopPressed ? 'GEDRÜCKT' : 'frei'],
      ['GRBL', g.powered ? g.state : '—'],
      ['Position', `X${this.mpos[0].toFixed(1)} Y${this.mpos[1].toFixed(1)}`],
      ['Laser', this.laserPowerNow > 0 ? `${(this.laserPowerNow * MAX_W).toFixed(2)} W` : 'aus'],
      ['Fokus', Math.abs(d) < 0.6 ? 'scharf ✓' : `${d > 0 ? 'zu hoch' : 'zu tief'} (${Math.abs(d).toFixed(1)} mm)`],
      ['Software', this.laserApp.connected ? 'verbunden' : 'getrennt']
    ];
    this.kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (this.panelDirty) {
      this.panelDirty = false;
      this.renderPanelParts();
    }
  }

  onJobDone() {
    this.app.toast(`<b>${this.name}</b>: Auftrag fertig!`, 'ok', 5000);
  }
}
