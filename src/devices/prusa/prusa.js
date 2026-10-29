import * as THREE from 'three';
import { BaseDevice } from '../base.js';
import { buildPrusaModel, buildSpool, GEO } from './model.js';
import { PrusaFirmware } from './firmware.js';
import { PrusaLCD } from './lcd.js';
import { PrintVisualizer } from './printvis.js';
import { MotorVoice, FanVoice } from '../../core/audio.js';
import { SAMPLE_MODELS, geometryToPrinterPositions } from '../../slicer/models.js';
import { buildUsbStick, UsbStick } from '../../core/hand.js';
import { guideCard } from '../../core/workshop.js';
import { box, cylX, rbox, group, mergeStatic } from '../../core/parts.js';

export const SPOOLS = [
  { id: 'pla-azure', name: 'Prusament PLA Azure Blue', type: 'PLA', color: '#2a6fd6' },
  { id: 'pla-orange', name: 'Prusament PLA Prusa Orange', type: 'PLA', color: '#f2711c' },
  { id: 'pla-galaxy', name: 'Prusament PLA Galaxy Black', type: 'PLA', color: '#222327' },
  { id: 'pla-white', name: 'Prusament PLA Pristine White', type: 'PLA', color: '#eeeeea' },
  { id: 'pla-red', name: 'Prusament PLA Lipstick Red', type: 'PLA', color: '#c4161c' },
  { id: 'pla-green', name: 'Prusament PLA Mystic Green', type: 'PLA', color: '#2f7a52' },
  { id: 'petg-ultra', name: 'Prusament PETG Ultramarine Blue', type: 'PETG', color: '#1c3fa8' },
  { id: 'petg-black', name: 'Prusament PETG Jet Black', type: 'PETG', color: '#101113' },
  { id: 'petg-orange', name: 'Prusament PETG Prusa Orange', type: 'PETG', color: '#f06a2a' }
];

export class PrusaMK4S extends BaseDevice {
  constructor(app, slot) {
    super(app, slot, { id: 'prusa', name: 'Original Prusa MK4S', kind: 'FDM-3D-Drucker' });
    const { root, H } = buildPrusaModel(app.M);
    this.model = root;
    this.root.add(root);
    this.H = H;
    this.root.rotation.y = 0.12;
    this.root.updateMatrixWorld(true);

    this.fw = new PrusaFirmware(this.firmwareHooks());
    this.lcd = new PrusaLCD(this);
    this.vis = new PrintVisualizer(H.printAnchor);

    // LCD texture
    this.screenTex = new THREE.CanvasTexture(this.lcd.canvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 8;
    H.screenMat.emissiveMap = this.screenTex;
    H.screenMat.emissiveIntensity = 0;

    // state
    this.spool = SPOOLS[0];
    this.fw.filament.type = this.spool.type;
    this.applySpool();
    this.sheetState = 'bed';
    this.finished = [];
    this.knobAngle = 0;
    this.loadcell = 0;
    this.purgeLen = 0;
    this.purgeDrop = null;
    this.tmpV = new THREE.Vector3();
    this.machinePos = new Float64Array(4);
    this.axisVel = new Float64Array(4);
    this.eAngle = 0;
    this.lastFilamentKey = '';

    this.buildFilamentPath();
    this.buildPurge();
    this.buildSpoolRack();
    this.buildUsb();
    this.buildGuide();
    this.setupInteractions();
    this.setupAudio();

    this.view('overview', 'Übersicht', [330, 560, 980], [0, 220, 40]);
    this.view('display', 'Display', [-80, 205, 560], [-100, 50, 300], { minDistance: 120 });
    this.view('nozzle', 'Druckkopf', [150, 200, 300], [0, 110, 0], {
      follow: () => this.H.nozzleTip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 30, 0))
    });
    this.view('bed', 'Druckbett', [40, 420, 420], [0, 80, 40]);
    this.view('back', 'Netzteil (hinten)', [560, 330, -300], [170, 110, -130]);
    this.view('rack', 'Spulenregal', [-470, 330, 520], [-470, 210, -120]);
    this.view('guide', 'Kurzanleitung', [215, 230, 520], [215, 50, 345], { minDistance: 80 });
    this.view('prints', 'Fertige Drucke', [420, 300, 220], [420, 20, -120]);

    this.updateMechanics(true);
    this.loadSamples();
  }

  viewById(id) {
    return this.cameraViews.find((v) => v.id === id);
  }

  // which camera view fits a double-clicked part
  focusViewFor(obj) {
    const H = this.H;
    const inside = (g) => {
      let o = obj;
      while (o) {
        if (o === g) return true;
        o = o.parent;
      }
      return false;
    };
    if (inside(H.lcd) || (this.stickItem && inside(this.stickItem.object))) return this.viewById('display');
    if (inside(H.carriage)) return this.viewById('nozzle');
    if (inside(H.bed) || inside(H.sheet)) return this.viewById('bed');
    if (inside(H.powerSwitch)) return this.viewById('back');
    if (inside(this.rack)) return this.viewById('rack');
    if (inside(this.guide)) return this.viewById('guide');
    if (this.finished.some((f) => inside(f))) return this.viewById('prints');
    return this.viewById('overview');
  }

  // ------------------------------------------------------------ USB stick
  buildUsb() {
    this.stick = new UsbStick('PRUSA');
    const hand = this.app.hand;
    this.usbSocket = hand.addSocket({
      anchor: this.H.usbSocket,
      onInsert: () => {
        this.lcd.dirty = true;
      },
      onRemove: () => this.onStickRemoved()
    });
    this.stickItem = hand.addItem({ object: buildUsbStick(this.app.M, 0x141518, 'PRUSA'), kind: 'usb', data: this.stick, socket: this.usbSocket });
    this.stick.listeners.add(() => (this.lcd.dirty = true));
  }

  // files on the inserted stick that this printer can print
  get usb() {
    const st = this.usbSocket.item?.data;
    return { inserted: !!st, files: st ? st.files.filter((f) => f.kind === 'gcode') : [] };
  }

  onStickRemoved() {
    this.lcd.dirty = true;
    if (this.fw.mode === 'printing') {
      this.fw.pause();
      this.lcd.info('usbRemoved', 'warning');
      this.sound('error');
    }
  }

  // ------------------------------------------------------------ spool rack
  buildSpoolRack() {
    const M = this.app.M;
    const rack = group('spool-rack', { x: -470, y: 0, z: -125 });
    const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.6 });
    const st = group('rack-static');
    for (const x of [-182, 182]) {
      st.add(box(8, 460, 150, frameMat, { x, y: 230 }));
      st.add(box(24, 6, 170, frameMat, { x, y: 3 }));
    }
    st.add(box(372, 6, 150, frameMat, { y: 3 }));
    for (const y of [116, 346]) st.add(cylX(9, 372, M.zinc, { y }, 20));
    mergeStatic(st);
    rack.add(st);
    this.rackSlots = [];
    const defs = SPOOLS.slice(1);
    defs.forEach((def, i) => {
      const tier = i < 4 ? 0 : 1;
      const x = -129 + (i % 4) * 86;
      const y = tier ? 346 : 116;
      const holder = new THREE.Group();
      holder.position.set(x, y, 0);
      const { inner, filMat } = buildSpool(M, def.color);
      holder.add(inner);
      rack.add(holder);
      const slot = { def, holder, inner, filMat, home: holder.position.clone() };
      this.rackSlots.push(slot);
      this.app.interaction.add(holder, { onClick: () => this.swapSpool(slot) });
    });
    this.root.add(rack);
    this.rack = rack;
  }

  swapSpool(slot) {
    const fw = this.fw;
    if (this.spoolAnim) return;
    if (fw.filament.inSensor || fw.filament.loaded) {
      // filament still in the extruder: the spool cannot be taken off
      this.app.audio.thunk(this.sfxPos(this.H.spool), 0.2, 120, 0.08);
      this.H.spool.position.y += 3;
      setTimeout(() => (this.H.spool.position.y -= 3), 120);
      return;
    }
    const holderWorld = this.H.spool.getWorldPosition(new THREE.Vector3());
    const slotWorld = slot.holder.getWorldPosition(new THREE.Vector3());
    this.spoolAnim = { t: 0, slot, holderWorld, slotWorld, holderHome: this.H.spool.position.clone() };
    this.app.audio.thunk(this.sfxPos(slot.holder), 0.2, 160, 0.1);
  }

  updateSpoolAnim(dt) {
    const a = this.spoolAnim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 1.6);
    const k = a.t * a.t * (3 - 2 * a.t);
    const arc = Math.sin(Math.PI * k) * 160;
    const toLocal = (obj, world) => obj.parent.worldToLocal(world.clone());
    const p1 = a.slotWorld.clone().lerp(a.holderWorld, k);
    p1.y += arc;
    const p2 = a.holderWorld.clone().lerp(a.slotWorld, k);
    p2.y += arc * 0.6;
    p2.z += Math.sin(Math.PI * k) * 120;
    a.slot.holder.position.copy(toLocal(a.slot.holder, p1));
    this.H.spool.position.copy(toLocal(this.H.spool, p2));
    if (a.t >= 1) {
      // both spools arrived: swap the filament identities and snap back
      a.slot.holder.position.copy(a.slot.home);
      this.H.spool.position.copy(a.holderHome);
      const old = this.spool;
      this.spool = a.slot.def;
      a.slot.def = old;
      a.slot.filMat.color.set(old.color);
      this.applySpool();
      this.lastFilamentKey = '';
      this.spoolAnim = null;
      this.app.audio.thunk(this.sfxPos(this.H.spool), 0.25, 200, 0.08);
    }
  }

  // ------------------------------------------------------------ quick guide
  buildGuide() {
    const card = guideCard('Original Prusa MK4S', [
      { lines: ['• Einschalten: Netzschalter hinten rechts am Netzteil.', '• Drehknopf: Mausrad oder ziehen = drehen, Klick = drücken (oder Pfeiltasten + Enter).', '• Drucken: Drucken → Datei vom USB-Stick → Drucken.', '• Spule wechseln: erst entladen, dann im Regal links anklicken.', '• Danach: Blech anklicken (ab), Blech anklicken (Teil lösen), nochmal (zurück).'] }
    ], { w: 190, h: 132 });
    card.position.set(215, 0, 330);
    card.rotation.y = -0.25;
    this.root.add(card);
    this.guide = card;
  }

  // ------------------------------------------------------------ firmware
  firmwareHooks() {
    return {
      deposit: (x0, y0, z0, x1, y1, z1, w, hh) => {
        if (this.sheetState !== 'bed') return;
        this.vis.addSegment(x0, y0, z0, x1, y1, z1, w, hh);
      },
      extruded: (e, meta) => {
        if (!meta.extrude && e > 0 && this.fw.filament.loaded && (meta.purge || meta.jog)) this.purgeLen += e * 2.4;
      },
      tap: () => {
        this.loadcell = 900 + Math.random() * 200;
        this.app.audio.click(this.sfxPos(this.H.nozzleTip), 0.12, 1400, 0.03);
      },
      beep: (f, d) => this.sound('beep', f, d),
      onState: () => this.onFwState(),
      onBooted: () => this.sound('boot'),
      onPrintStart: () => {
        this.sound('click');
      },
      onPrintEnd: (ok) => {
        if (ok) this.sound('done');
      },
      dropPurge: () => this.dropPurge(),
      filamentRemoved: () => {
        this.lastFilamentKey = '';
      },
      hotendFanOn: () => this.fw.nozzle.temp > 50,
      coldExtrusion: () => {}
    };
  }

  onFwState() {
    this.lcd.dirty = true;
  }

  sound(kind, f, d) {
    const a = this.app.audio;
    const pos = this.sfxPos(this.H.lcd);
    const mode = this.fw.settings.sound;
    if (kind === 'click') {
      if (mode === 'loud' || mode === 'assist') a.beep(pos, 3200, 0.02, 0.06);
    } else if (kind === 'error') a.beep(pos, 900, 0.12, 0.1);
    else if (kind === 'boot') {
      if (mode !== 'silent') a.beep(pos, 2600, 0.08, 0.1);
    } else if (kind === 'done') {
      if (mode !== 'silent') {
        a.beep(pos, 2600, 0.12, 0.12);
        setTimeout(() => a.beep(pos, 2600, 0.12, 0.12), 250);
        setTimeout(() => a.beep(pos, 3200, 0.25, 0.12), 500);
      }
    } else if (kind === 'beep') {
      if (mode !== 'silent') a.beep(pos, f || 2600, d || 0.1, 0.12);
    }
  }

  applyStealth() {
    const st = this.fw.settings.stealth;
    const c = this.fw.planner.cfg;
    c.maxFeed[0] = c.maxFeed[1] = st ? 140 : 300;
    c.accel = st ? 1250 : 2500;
    c.travelAccel = st ? 1250 : 4000;
  }

  // ------------------------------------------------------------ samples
  async loadSamples() {
    for (const m of SAMPLE_MODELS) {
      try {
        const positions = geometryToPrinterPositions(m.build());
        const color = parseInt(this.spool.color.slice(1), 16);
        const file = await this.app.slicer.makeFile(m.file, positions, m.settings, null, m.settings.material === 'PETG' ? 0x2a50c8 : color);
        file.source = 'sample';
        this.stick.add(file);
        this.lcd.dirty = true;
      } catch (e) {
        console.error('sample slicing failed', m.id, e);
      }
    }
  }

  // ------------------------------------------------------------ visuals
  applySpool() {
    const c = new THREE.Color(this.spool.color);
    this.H.filamentMat.color.copy(c);
    this.H.filamentMat.roughness = this.spool.type === 'PETG' ? 0.25 : 0.4;
    this.vis.setColor(this.spool.color);
    this.vis.material.roughness = this.spool.type === 'PETG' ? 0.28 : 0.42;
    this.vis.material.clearcoat = this.spool.type === 'PETG' ? 0.6 : 0.3;
    if (this.purgeMesh) this.purgeMesh.material.color.copy(c);
  }

  buildFilamentPath() {
    this.filTube = new THREE.Mesh(new THREE.BufferGeometry(), this.H.filamentMat);
    this.filTube.castShadow = true;
    this.filTube.userData.noPick = true;
    this.root.add(this.filTube);
  }

  updateFilamentPath() {
    const fw = this.fw;
    const inSensor = fw.filament.inSensor || fw.filament.loaded;
    const tip = this.H.nozzleTip.getWorldPosition(this.tmpV.set(0, 0, 0));
    this.root.worldToLocal(tip);
    const spoolCenter = this.H.spool.position;
    const r = 84;
    const key = inSensor ? `${tip.x.toFixed(1)},${tip.y.toFixed(1)}` : 'loose';
    if (key === this.lastFilamentKey) return;
    this.lastFilamentKey = key;
    let pts;
    if (inSensor) {
      const inlet = new THREE.Vector3(tip.x, tip.y + 125, tip.z - 4);
      const start = new THREE.Vector3(spoolCenter.x, spoolCenter.y - 20, spoolCenter.z + r * 0.98);
      const mid = start.clone().lerp(inlet, 0.5);
      mid.z += 30;
      mid.y += 10;
      pts = [start, start.clone().add(new THREE.Vector3(0, -15, 12)), mid, inlet.clone().add(new THREE.Vector3(0, 40, 0)), inlet];
    } else {
      const s = new THREE.Vector3(spoolCenter.x + 28, spoolCenter.y - 20, spoolCenter.z + r);
      pts = [s, s.clone().add(new THREE.Vector3(0, -18, 16)), s.clone().add(new THREE.Vector3(2, -50, 30)), s.clone().add(new THREE.Vector3(5, -70, 36))];
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.filTube.geometry.dispose();
    this.filTube.geometry = new THREE.TubeGeometry(curve, inSensor ? 48 : 16, 0.875, 6, false);
  }

  buildPurge() {
    const mat = new THREE.MeshPhysicalMaterial({ color: this.spool.color, roughness: 0.35, clearcoat: 0.4 });
    this.purgeMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.purgeMesh.castShadow = true;
    this.purgeMesh.userData.noPick = true;
    this.root.add(this.purgeMesh);
    this.purgeBuiltLen = 0;
  }

  updatePurge(dt) {
    if (this.purgeDrop) {
      const d = this.purgeDrop;
      d.v += 9810 * dt;
      d.y -= d.v * dt;
      d.t += dt;
      this.purgeMesh.position.y = d.y;
      if (d.t > 1.2 || d.y < -400) {
        this.purgeDrop = null;
        this.purgeMesh.visible = false;
        this.purgeMesh.position.y = 0;
        this.purgeBuiltLen = 0;
      }
      return;
    }
    const len = Math.min(70, this.purgeLen);
    if (len < 0.5) {
      this.purgeMesh.visible = false;
      return;
    }
    const tip = this.H.nozzleTip.getWorldPosition(this.tmpV.set(0, 0, 0));
    this.root.worldToLocal(tip);
    if (Math.abs(len - this.purgeBuiltLen) > 0.6 || !this.purgeTip || this.purgeTip.distanceTo(tip) > 0.5) {
      this.purgeBuiltLen = len;
      this.purgeTip = tip.clone();
      const pts = [];
      const n = Math.max(3, Math.ceil(len / 2));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const yy = -t * Math.min(len, 28);
        const curl = t * len > 22 ? (t * len - 22) * 0.6 : 0;
        const a = t * len * 0.35;
        pts.push(new THREE.Vector3(tip.x + Math.sin(a) * (1 + curl), tip.y + yy + curl * 0.2, tip.z + Math.cos(a) * (0.6 + curl)));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      this.purgeMesh.geometry.dispose();
      this.purgeMesh.geometry = new THREE.TubeGeometry(curve, n * 3, 0.55, 6, false);
      this.purgeMesh.visible = true;
    }
  }

  dropPurge() {
    if (this.purgeLen > 0.5) this.purgeDrop = { y: 0, v: 0, t: 0 };
    this.purgeLen = 0;
  }

  loadcellValue() {
    return this.loadcell + (Math.random() - 0.5) * 6;
  }

  updateMechanics(force = false) {
    const fw = this.fw;
    const p = fw.planner.position(this.machinePos);
    const H = this.H;
    H.bed.position.set(GEO.X0, GEO.PRINT_Y, GEO.Z_NOZ + p[1]);
    H.gantry.position.set(0, GEO.PRINT_Y + p[2], 0);
    H.carriage.position.set(GEO.X0 + p[0], 0, 0);
    // lead screws rotate with Z (2 mm lead)
    const a = (p[2] / 2) * Math.PI * 2;
    for (const ls of H.leadScrews) ls.rotation.y = a;
    // belts: move texture so the teeth travel with the axis
    for (const t of H.xBelts) t.offset.x = -p[0] / 2;
    for (const t of H.yBelts) t.offset.x = p[1] / 2;
    // spool rotates with consumed filament
    H.spoolInner.rotation.x = -p[3] / 85;
    if (force) this.lastFilamentKey = '';
  }

  // ------------------------------------------------------------ interaction
  setupInteractions() {
    const I = this.app.interaction;
    const H = this.H;
    const fw = this.fw;

    I.add(H.powerSwitch, {
      onClick: () => {
        fw.setPower(!fw.powered);
        H.rocker.rotation.x = fw.powered ? -0.25 : 0.25;
        this.app.audio.thunk(this.sfxPos(H.powerSwitch), 0.35, 220, 0.08);
      }
    });
    H.rocker.rotation.x = 0.25;

    I.add(H.knob, {
      cursor: 'grab',
      onWheel: (steps) => {
        this.rotateKnob(steps);
        return true;
      },
      // drag to turn the knob
      onDown: (hit, e) => {
        this.knobDrag = { x: e.clientX, y: e.clientY, acc: 0 };
        return true;
      },
      onDrag: (hit, e) => {
        const d = this.knobDrag;
        if (!d) return;
        d.acc += e.clientX - d.x - (e.clientY - d.y);
        d.x = e.clientX;
        d.y = e.clientY;
        while (Math.abs(d.acc) >= 22) {
          const s = Math.sign(d.acc);
          this.rotateKnob(s);
          d.acc -= s * 22;
        }
      },
      onUp: () => (this.knobDrag = null),
      onClick: () => this.pressKnob()
    });

    I.add(H.resetButton, {
      onClick: () => {
        this.app.audio.click(this.sfxPos(H.resetButton), 0.3, 2500, 0.02);
        if (!fw.powered) return;
        if (fw.printing) this.vis.hidePartial();
        fw.hardReset();
      }
    });

    I.add(H.sheet, { onClick: () => this.onSheetClick() });
    I.add(H.spool, { onClick: () => this.insertFilament() });

    I.add(H.carriage, {
      onClick: () => {
        this.loadcell = 1400;
        this.app.audio.click(this.sfxPos(H.nozzleTip), 0.15, 900, 0.03);
        if (this.awaitNozzleTap) {
          const cb = this.awaitNozzleTap;
          this.awaitNozzleTap = null;
          cb();
        }
      }
    });
  }

  rotateKnob(steps) {
    if (!steps) return;
    this.knobAngle += steps * (Math.PI / 10);
    this.H.knobBody.rotation.y = -this.knobAngle;
    this.app.audio.click(this.sfxPos(this.H.knob), 0.08, 4200, 0.012);
    if (this.fw.powered) this.lcd.rotate(Math.sign(steps) * Math.min(5, Math.abs(steps)));
  }

  pressKnob() {
    const kb = this.H.knobBody;
    kb.position.y = -1.2;
    setTimeout(() => (kb.position.y = 0), 120);
    this.app.audio.click(this.sfxPos(this.H.knob), 0.15, 2400, 0.02);
    if (!this.fw.powered) return;
    this.sound('click');
    this.lcd.press();
  }

  onKey(e, down) {
    if (!down) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      this.rotateKnob(1);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      this.rotateKnob(-1);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      this.pressKnob();
      return true;
    }
    return false;
  }

  insertFilament() {
    const fw = this.fw;
    if (fw.filament.inSensor || fw.filament.loaded || this.spoolAnim) return;
    fw.filament.inSensor = true;
    this.lastFilamentKey = '';
    this.app.audio.click(this.sfxPos(this.H.nozzleTip), 0.2, 1200, 0.04);
    // autoload: printer asks which material to load
    if (fw.powered && fw.mode === 'idle' && fw.settings.fsensor && !fw.task && !(fw.wizard && fw.wizard.kind === 'insert')) {
      this.lcd.push(this.lcd.materialPicker((m) => fw.startTask(fw.taskLoad(m), 'load')));
      const idx = this.lcd.top.items.findIndex((it) => it.label === this.spool.type);
      if (idx > 0) this.lcd.top.sel = idx;
      this.lcd.dirty = true;
    }
  }

  onSheetClick() {
    const fw = this.fw;
    if (this.sheetAnim) return;
    if (this.sheetState === 'bed') {
      if (fw.printing || !fw.planner.idle) {
        // the magnets hold it, and the nozzle is busy – nothing happens
        this.app.audio.thunk(this.sfxPos(this.H.sheet), 0.15, 120, 0.06);
        return;
      }
      this.removeSheet();
    } else if (this.sheetState === 'bench') {
      if (!this.vis.isEmpty) this.popPrint();
      else this.returnSheet();
    }
  }

  benchSheetPose() {
    return { pos: new THREE.Vector3(390, 1.2, 150), rotY: -0.35 };
  }

  removeSheet() {
    const sheet = this.H.sheet;
    this.root.attach(sheet);
    const target = this.benchSheetPose();
    this.sheetAnim = {
      t: 0,
      dur: 1.4,
      from: sheet.position.clone(),
      fromRot: sheet.rotation.y,
      to: target.pos,
      toRot: target.rotY,
      lift: 120,
      done: () => {
        this.sheetState = 'bench';
      }
    };
    this.sheetState = 'moving';
    this.app.audio.click(this.sfxPos(sheet), 0.25, 900, 0.05);
  }

  returnSheet() {
    const sheet = this.H.sheet;
    const bedLocal = new THREE.Vector3(125, 0, -102);
    const world = this.H.bed.localToWorld(bedLocal.clone());
    const target = this.root.worldToLocal(world);
    this.sheetAnim = {
      t: 0,
      dur: 1.4,
      from: sheet.position.clone(),
      fromRot: sheet.rotation.y,
      to: target,
      toRot: this.H.bed.rotation.y,
      lift: 120,
      done: () => {
        this.H.bed.attach(sheet);
        sheet.position.copy(bedLocal);
        sheet.rotation.set(0, 0, 0);
        this.sheetState = 'bed';
        this.app.audio.thunk(this.sfxPos(sheet), 0.3, 300, 0.06);
      }
    };
    this.sheetState = 'moving';
  }

  popPrint() {
    // flex the sheet: the print pops off
    const g = this.vis.detach();
    const b = g.userData.bounds;
    if (!b || b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(g);
    g.position.set(-c.x, 0, -c.z);
    const idx = this.finished.length;
    holder.position.set(330 + (idx % 3) * 90, 1, -50 - Math.floor(idx / 3) * 90);
    holder.rotation.y = (Math.random() - 0.5) * 0.6;
    // invisible pick proxy (layer 1: raycast only, never rendered)
    const size = b.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x + 2, size.y + 2, size.z + 2), new THREE.MeshBasicMaterial());
    proxy.position.y = size.y / 2;
    proxy.layers.set(1);
    holder.add(proxy);
    this.root.add(holder);
    this.finished.push(holder);
    this.app.interaction.add(holder, { onClick: () => this.removeFinished(holder) });
    if (this.finished.length > 6) this.removeFinished(this.finished[0]);
    this.flexAnim = { t: 0 };
    this.app.audio.click(this.sfxPos(this.H.sheet), 0.35, 700, 0.06);
  }

  removeFinished(holder) {
    this.app.interaction.remove(holder);
    holder.parent?.remove(holder);
    holder.traverse((o) => o.isInstancedMesh && o.dispose());
    this.finished = this.finished.filter((f) => f !== holder);
  }

  // ------------------------------------------------------------ audio
  setupAudio() {
    const a = this.app.audio;
    const w = (x, y, z) => this.w(x, y, z);
    this.voices = {
      x: a.register(new MotorVoice(w(-178, 150, -40), { gain: 0.055 })),
      y: a.register(new MotorVoice(w(-28, 46, -260), { gain: 0.06 })),
      z: a.register(new MotorVoice(w(0, 60, -32), { gain: 0.05 })),
      e: a.register(new MotorVoice(w(0, 200, 0), { gain: 0.03 })),
      hotend: a.register(new FanVoice(w(-30, 160, 30), { gain: 0.035, size: 40 })),
      print: a.register(new FanVoice(w(30, 160, 30), { gain: 0.05, size: 40 }))
    };
  }

  updateAudio() {
    const fw = this.fw;
    const v = this.voices;
    if (!this.app.audio.ready) return;
    fw.planner.velocity(this.axisVel);
    const stealth = fw.settings.stealth ? 0.45 : 1;
    v.x.set(Math.abs(this.axisVel[0]) * 10, stealth);
    v.y.set(Math.abs(this.axisVel[1]) * 10, stealth);
    v.z.set(Math.abs(this.axisVel[2]) * 100, stealth);
    v.e.set(Math.abs(this.axisVel[3]) * 40, stealth);
    const tip = this.H.nozzleTip.getWorldPosition(this.tmpV);
    v.x.setPos(tip);
    v.hotend.setPos(tip);
    v.print.setPos(tip);
    v.hotend.set(fw.powered && fw.nozzle.temp > 50 ? 0.75 : 0);
    v.print.set(fw.powered ? fw.fan : 0);
  }

  // ------------------------------------------------------------ update
  update(simDt, realDt) {
    const fw = this.fw;
    fw.update(simDt);
    this.updateMechanics();
    // partial segment of the current extrusion block
    const b = fw.planner.cur;
    if (b && b.meta && b.meta.extrude && this.sheetState === 'bed') {
      const p = this.machinePos;
      this.vis.setPartial(b.start[0], b.start[1], b.start[2], p[0], p[1], p[2], b.meta.extrude.w, b.meta.extrude.h);
    } else this.vis.hidePartial();
    this.vis.flush();
    this.updateFilamentPath();
    this.updatePurge(realDt);
    if (this.purgeLen > 0 && !this.purgeDrop) {
      // strand falls off when the head moves away quickly or prints
      const v = fw.planner.velocity();
      if (v > 60 || (b && b.meta && b.meta.extrude)) this.dropPurge();
    }

    // fans
    const H = this.H;
    if (fw.powered && fw.nozzle.temp > 50) H.hotendFanRotor.rotation.z += realDt * 60;
    H.printFanRotor.rotation.z += realDt * 70 * (fw.powered ? fw.fan : 0);
    this.loadcell *= Math.exp(-realDt * 6);

    // screen
    H.screenMat.emissiveIntensity = fw.powered ? 0.95 : 0;
    if (this.lcd.render(realDt)) this.screenTex.needsUpdate = true;

    this.updateSpoolAnim(realDt);

    // sheet animation
    if (this.sheetAnim) {
      const s = this.sheetAnim;
      s.t = Math.min(1, s.t + realDt / s.dur);
      const k = s.t * s.t * (3 - 2 * s.t);
      const sheet = H.sheet;
      sheet.position.lerpVectors(s.from, s.to, k);
      sheet.position.y += Math.sin(Math.PI * k) * s.lift;
      sheet.rotation.y = s.fromRot + (s.toRot - s.fromRot) * k;
      sheet.rotation.x = Math.sin(Math.PI * k) * 0.15;
      if (s.t >= 1) {
        this.sheetAnim = null;
        sheet.rotation.x = 0;
        s.done();
      }
    }
    if (this.flexAnim) {
      const f = this.flexAnim;
      f.t += realDt;
      H.sheet.rotation.z = Math.sin(f.t * 14) * 0.05 * Math.max(0, 1 - f.t * 2);
      if (f.t > 0.6) {
        H.sheet.rotation.z = 0;
        this.flexAnim = null;
      }
    }

    this.updateAudio();
  }
}
