import * as THREE from 'three';
import { BaseDevice, h } from '../base.js';
import { buildPrusaModel, GEO } from './model.js';
import { PrusaFirmware, materialById } from './firmware.js';
import { PrusaLCD } from './lcd.js';
import { PrintVisualizer } from './printvis.js';
import { UsbDrive, loadUserFile } from './files.js';
import { MotorVoice, FanVoice } from '../../core/audio.js';
import { SlicerService } from '../../slicer/service.js';
import { SAMPLE_MODELS, geometryToPrinterPositions, placeZUp } from '../../slicer/models.js';
import { PROFILES, FILAMENTS } from '../../slicer/slicer.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export const SPOOLS = [
  { id: 'pla-azure', name: 'Prusament PLA Azure Blue', type: 'PLA', color: '#2a6fd6' },
  { id: 'pla-orange', name: 'Prusament PLA Prusa Orange', type: 'PLA', color: '#f2711c' },
  { id: 'pla-galaxy', name: 'Prusament PLA Galaxy Black', type: 'PLA', color: '#222327' },
  { id: 'pla-white', name: 'Prusament PLA Pristine White', type: 'PLA', color: '#eeeeea' },
  { id: 'pla-red', name: 'Prusament PLA Lipstick Red', type: 'PLA', color: '#c4161c' },
  { id: 'pla-green', name: 'Prusament PLA Mystic Green', type: 'PLA', color: '#2f7a52' },
  { id: 'petg-ultra', name: 'Prusament PETG Ultramarine Blue', type: 'PETG', color: '#1c3fa8' },
  { id: 'petg-black', name: 'Prusament PETG Jet Black', type: 'PETG', color: '#101113' },
  { id: 'petg-orange', name: 'Prusament PETG Prusa Orange', type: 'PETG', color: '#f06a2a' },
  { id: 'asa-grey', name: 'Prusament ASA Galaxy Grey', type: 'ASA', color: '#6f7378' }
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

    this.usb = new UsbDrive();
    this.fw = new PrusaFirmware(this.firmwareHooks());
    this.lcd = new PrusaLCD(this);
    this.vis = new PrintVisualizer(H.printAnchor);
    this.slicer = new SlicerService();

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
    this.stickState = 'in';
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
    this.setupInteractions();
    this.setupAudio();

    this.view('overview', 'Übersicht', [330, 560, 980], [0, 220, 40]);
    this.view('display', 'Display', [-80, 205, 560], [-100, 50, 300], { minDistance: 120 });
    this.view('nozzle', 'Druckkopf', [150, 200, 300], [0, 110, 0], {
      follow: () => this.H.nozzleTip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 30, 0))
    });
    this.view('bed', 'Druckbett', [40, 420, 420], [0, 80, 40]);
    this.view('back', 'Rückseite', [520, 420, -620], [80, 160, -80]);

    this.updateMechanics(true);
    this.loadSamples();
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
        if (ok) {
          this.sound('done');
          this.app.toast(`<b>${this.name}</b>: Druck fertig! Nimm das Blech ab, um das Teil zu entnehmen.`, 'ok', 6000);
        }
      },
      dropPurge: () => this.dropPurge(),
      filamentRemoved: () => {
        this.app.toast('Filament ist entladen. Du kannst jetzt im Regal eine andere Spule wählen.', 'info');
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
        const file = await this.slicer.makeFile(m.file, positions, m.settings, null, m.settings.material === 'PETG' ? 0x2a50c8 : color);
        file.source = 'sample';
        this.usb.add(file);
        this.lcd.dirty = true;
        this.panelDirty = true;
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
      tooltip: () => ({ title: `Netzschalter (${fw.powered ? 'EIN' : 'AUS'})`, hint: 'Klicken zum Umschalten' }),
      onClick: () => {
        fw.setPower(!fw.powered);
        H.rocker.rotation.x = fw.powered ? -0.25 : 0.25;
        this.app.audio.thunk(this.sfxPos(H.powerSwitch), 0.35, 220, 0.08);
        if (fw.powered) this.app.toast('Drucker startet …', 'info', 2000);
      }
    });
    H.rocker.rotation.x = 0.25;

    I.add(H.knob, {
      tooltip: () => ({ title: 'Drehknopf', hint: 'Mausrad oder Ziehen = drehen · Klick = drücken · (oder Pfeiltasten + Enter)' }),
      cursor: 'grab',
      onWheel: (steps) => {
        this.rotateKnob(steps);
        return true;
      },
      // drag (mouse or finger) to turn the knob
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
      tooltip: { title: 'Reset-Taste', hint: 'Startet die Elektronik neu (ein laufender Druck geht verloren!)' },
      onClick: () => {
        this.app.audio.click(this.sfxPos(H.resetButton), 0.3, 2500, 0.02);
        if (!fw.powered) return;
        if (fw.printing) this.vis.hidePartial();
        fw.hardReset();
      }
    });

    I.add(H.screen, {
      tooltip: () => (fw.powered ? { title: 'xLCD-Display (3,5″)', hint: 'Kein Touchscreen – bedienen über den Drehknopf rechts daneben' } : { title: 'Display (aus)', hint: 'Drucker am Netzschalter hinten rechts einschalten' })
    });

    I.add(H.usbStick, {
      tooltip: () => ({ title: this.usb.inserted ? 'USB-Stick (eingesteckt)' : 'USB-Stick', hint: this.usb.inserted ? 'Klicken zum Abziehen' : 'Klicken zum Einstecken' }),
      onClick: () => this.toggleUsb()
    });

    I.add(H.sheet, {
      tooltip: () => {
        if (this.sheetState === 'bed') return { title: 'Federstahlblech (Textured PEI)', hint: fw.printing ? 'Während des Drucks nicht abnehmen' : 'Klicken zum Abnehmen' };
        if (this.sheetState === 'bench') return this.vis.isEmpty ? { title: 'Federstahlblech', hint: 'Klicken, um es wieder aufs Heizbett zu legen' } : { title: 'Blech mit fertigem Druck', hint: 'Klicken: Blech biegen und Druck ablösen' };
        return null;
      },
      onClick: () => this.onSheetClick()
    });

    I.add(H.spool, {
      tooltip: () => {
        const ins = fw.filament.inSensor || fw.filament.loaded;
        return { title: this.spool.name, hint: ins ? (fw.filament.loaded ? 'Filament ist im Extruder geladen' : 'Filament steckt im Sensor') : fw.powered ? 'Klicken: Filamentende in den Nextruder einführen' : 'Drucker ist aus' };
      },
      onClick: () => this.insertFilament()
    });

    const tipTarget = this.H.carriage;
    I.add(tipTarget, {
      tooltip: () => ({
        title: 'Nextruder',
        hint: `Düse ${fw.nozzle.displayTemp.toFixed(0)} °C${fw.nozzle.temp > 50 ? ' – Vorsicht, heiß!' : ''} · Klicken: Düse antippen (Wägezelle)`
      }),
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

  toggleUsb() {
    const H = this.H;
    this.usb.inserted = !this.usb.inserted;
    this.stickAnim = { t: 0, from: H.usbStick.position.x, to: this.usb.inserted ? 88.4 : 150 };
    this.app.audio.click(this.sfxPos(H.usbStick), 0.2, 1800, 0.03);
    this.lcd.dirty = true;
    this.panelDirty = true;
    if (!this.usb.inserted && this.fw.mode === 'printing') {
      this.fw.pause();
      this.lcd.info('usbRemoved', 'warning');
      this.sound('error');
    }
  }

  insertFilament() {
    const fw = this.fw;
    if (!fw.powered) {
      this.app.toast('Der Drucker ist ausgeschaltet.', 'warn');
      return;
    }
    if (fw.filament.inSensor || fw.filament.loaded) return;
    if (!this.spool) return;
    if (!fw.settings.fsensor && !(fw.wizard && fw.wizard.kind === 'insert')) {
      this.app.toast('Filamentsensor ist deaktiviert.', 'warn');
    }
    fw.filament.inSensor = true;
    this.lastFilamentKey = '';
    this.app.audio.click(this.sfxPos(this.H.nozzleTip), 0.2, 1200, 0.04);
    // autoload: printer asks which material to load
    if (!fw.task && !fw.printing && !(fw.wizard && fw.wizard.kind === 'insert')) {
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
        this.app.toast('Das Blech kann während der Druckkopf arbeitet nicht abgenommen werden.', 'warn');
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
    holder.position.set(-430 - (idx % 3) * 95, 1, 200 - Math.floor(idx / 3) * 90);
    holder.rotation.y = (Math.random() - 0.5) * 0.6;
    // invisible pick proxy (layer 1: raycast only, never rendered)
    const size = b.getSize(new THREE.Vector3());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x + 2, size.y + 2, size.z + 2), new THREE.MeshBasicMaterial());
    proxy.position.y = size.y / 2;
    proxy.layers.set(1);
    holder.add(proxy);
    this.root.add(holder);
    this.finished.push(holder);
    this.app.interaction.add(holder, {
      tooltip: { title: 'Fertiger Druck', hint: 'Klicken zum Wegräumen' },
      onClick: () => this.removeFinished(holder)
    });
    this.flexAnim = { t: 0 };
    this.app.audio.click(this.sfxPos(this.H.sheet), 0.35, 700, 0.06);
    this.app.toast('Druck abgelöst und auf der Werkbank abgelegt. Klicke das Blech an, um es zurückzulegen.', 'ok');
    this.panelDirty = true;
  }

  removeFinished(holder) {
    this.app.interaction.remove(holder);
    holder.parent?.remove(holder);
    holder.traverse((o) => o.isInstancedMesh && o.dispose());
    this.finished = this.finished.filter((f) => f !== holder);
    this.panelDirty = true;
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

    // USB stick animation
    if (this.stickAnim) {
      const s = this.stickAnim;
      s.t = Math.min(1, s.t + realDt * 2.5);
      const k = s.t * s.t * (3 - 2 * s.t);
      H.usbStick.position.x = s.from + (s.to - s.from) * k;
      H.usbStick.position.y = -14 + Math.sin(k * Math.PI) * 6 + (this.usb.inserted ? 0 : k * -30);
      if (s.t >= 1) this.stickAnim = null;
    }

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

  // ------------------------------------------------------------ status/HUD
  status() {
    const fw = this.fw;
    if (!fw.powered) return { state: 'off', text: 'Aus' };
    if (fw.mode === 'boot') return { state: 'busy', text: 'Startet …' };
    if (fw.mode === 'printing' || fw.mode === 'resuming') return { state: 'busy', text: `Druckt ${Math.floor(fw.progress)}% · ${fmtShort(fw.remaining)}` };
    if (fw.mode === 'paused' || fw.mode === 'pausing') return { state: 'warn', text: 'Pausiert' };
    if (fw.mode === 'finished') return { state: 'on', text: 'Druck fertig ✓' };
    if (fw.mode === 'stopped' || fw.mode === 'stopping') return { state: 'warn', text: 'Gestoppt' };
    if (fw.task) return { state: 'busy', text: 'Beschäftigt …' };
    if (fw.nozzle.heatingUp() || fw.bed.heatingUp()) return { state: 'busy', text: `Heizt ${Math.round(fw.nozzle.temp)}°/${Math.round(fw.bed.temp)}°` };
    return { state: 'on', text: 'Bereit' };
  }

  buildPanel(el) {
    this.panelEl = el;
    const fw = this.fw;
    el.innerHTML = '';

    // --- state
    this.kv = h('dl', { class: 'kv' });
    el.appendChild(h('div', { class: 'section' }, h('h4', {}, 'Zustand'), this.kv));

    // --- hint
    el.appendChild(
      h(
        'div',
        { class: 'section' },
        h('div', {
          class: 'hint',
          html: 'Einschalten: <b>Netzschalter</b> hinten rechts am Netzteil (Kamera „Rückseite“). Bedienen nur über das <b>Display mit Drehknopf</b> vorne links. Druckdateien liegen auf dem <b>USB-Stick</b> am Display.'
        })
      )
    );

    // --- USB
    const usbSec = h('div', { class: 'section' });
    this.usbList = h('ul', { class: 'file-list' });
    const fileInput = h('input', { type: 'file', accept: '.gcode,.bgcode,.stl,.gco,.g', multiple: true, style: 'display:none' });
    fileInput.addEventListener('change', () => {
      for (const f of fileInput.files) this.importFile(f);
      fileInput.value = '';
    });
    this.sliceBox = h('div');
    usbSec.append(
      h('h4', {}, 'USB-Stick'),
      h('p', {}, 'Wie am PC: Lege G-Code (.gcode / .bgcode aus PrusaSlicer für MK4/MK4S) oder ein STL-Modell auf den Stick. STL-Dateien werden mit dem eingebauten Slicer vorbereitet.'),
      this.usbList,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => fileInput.click() }, 'Datei auf Stick kopieren …'), h('button', { class: 'btn', onclick: () => this.toggleUsb() }, 'Stick ab/an')),
      this.sliceBox,
      fileInput
    );
    el.appendChild(usbSec);

    // --- spools
    const spoolSec = h('div', { class: 'section' });
    this.spoolGrid = h('div', { class: 'swatches' });
    spoolSec.append(
      h('h4', {}, 'Filament-Regal'),
      h('p', {}, 'Spule tauschen geht nur, wenn kein Filament im Extruder steckt (Display → Filament → Entladen). Danach Spule anklicken, um das Ende einzuführen.'),
      this.spoolGrid
    );
    el.appendChild(spoolSec);

    // --- finished prints
    this.finishedSec = h('div', { class: 'section' });
    el.appendChild(this.finishedSec);

    this.renderPanelParts();
  }

  renderPanelParts() {
    const fw = this.fw;
    if (!this.panelEl) return;
    // USB list
    this.usbList.innerHTML = '';
    if (!this.usb.files.length) this.usbList.appendChild(h('li', { class: 'file-item' }, h('span', { class: 'fname' }, 'Beispieldateien werden gesliced …')));
    for (const f of this.usb.files) {
      const meta = [f.meta?.time ? fmtShort(f.meta.time) : null, f.meta?.material].filter(Boolean).join(' · ');
      this.usbList.appendChild(
        h(
          'li',
          { class: 'file-item' },
          h('span', { class: 'fname', title: f.name }, f.name),
          h('span', { class: 'fmeta' }, meta),
          f.source === 'sample' ? null : h('button', { class: 'btn', title: 'Vom Stick löschen', onclick: () => { if (fw.job?.file === f) return this.app.toast('Datei wird gerade gedruckt.', 'warn'); this.usb.remove(f); this.renderPanelParts(); this.lcd.dirty = true; } }, '×')
        )
      );
    }
    // spools
    this.spoolGrid.innerHTML = '';
    const locked = fw.filament.inSensor || fw.filament.loaded;
    for (const s of SPOOLS) {
      const b = h(
        'button',
        { class: `swatch${s === this.spool ? ' active' : ''}`, disabled: locked && s !== this.spool, title: s.name },
        h('span', { class: 'chip', style: `background:${s.color}` }),
        h('span', {}, s.name.replace('Prusament ', '')),
        h('span', { class: 'sw-sub' }, `${s.type} · 1 kg`)
      );
      b.addEventListener('click', () => {
        if (s === this.spool) return;
        if (fw.filament.inSensor || fw.filament.loaded) return this.app.toast('Erst Filament entladen (Display → Filament → Filament entladen).', 'warn');
        this.spool = s;
        this.applySpool();
        this.app.audio.thunk(this.sfxPos(this.H.spool), 0.2, 160, 0.1);
        this.renderPanelParts();
      });
      this.spoolGrid.appendChild(b);
    }
    // finished prints
    this.finishedSec.innerHTML = '';
    this.finishedSec.append(
      h('h4', {}, 'Fertige Drucke'),
      h('p', {}, this.finished.length ? `${this.finished.length} Teil(e) liegen links neben dem Drucker auf der Werkbank.` : 'Noch keine. Nach dem Druck: Blech abnehmen und anklicken, um das Teil abzulösen.'),
      this.finished.length ? h('button', { class: 'btn', onclick: () => { [...this.finished].forEach((f) => this.removeFinished(f)); this.renderPanelParts(); } }, 'Alle wegräumen') : null
    );
    this.lastPanelLocked = locked;
  }

  refreshPanel() {
    if (!this.panelEl || !this.kv) return;
    const fw = this.fw;
    const st = this.status();
    const p = fw.planner.position(this.machinePos);
    const rows = [
      ['Status', st.text],
      ['Düse', `${fw.nozzle.displayTemp.toFixed(1)} / ${fw.nozzle.target.toFixed(0)} °C`],
      ['Heizbett', `${fw.bed.displayTemp.toFixed(1)} / ${fw.bed.target.toFixed(0)} °C`],
      ['Filament', fw.filament.loaded ? `${materialById(fw.filament.type).id} geladen` : fw.filament.inSensor ? 'im Sensor' : 'nicht geladen'],
      ['Spule', this.spool.name.replace('Prusament ', '')],
      ['Position', `X${p[0].toFixed(1)} Y${p[1].toFixed(1)} Z${p[2].toFixed(2)}`]
    ];
    this.kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const locked = fw.filament.inSensor || fw.filament.loaded;
    if (this.panelDirty || locked !== this.lastPanelLocked) {
      this.panelDirty = false;
      this.renderPanelParts();
    }
  }

  // ------------------------------------------------------------ import
  async importFile(file) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.stl')) {
        this.showSliceDialog(file);
        return;
      }
      if (!/\.(gcode|bgcode|gco|g)$/.test(lower)) {
        this.app.toast('Nur .gcode, .bgcode oder .stl werden unterstützt.', 'warn');
        return;
      }
      if (file.size > 150e6) {
        this.app.toast('Datei ist zu groß (max. 150 MB).', 'warn');
        return;
      }
      const f = await loadUserFile(file);
      this.usb.add(f);
      this.lcd.dirty = true;
      this.renderPanelParts();
      this.app.toast(`<b>${f.name}</b> liegt jetzt auf dem USB-Stick.`, 'ok');
    } catch (e) {
      console.error(e);
      this.app.toast(`Datei konnte nicht gelesen werden: ${e.message}`, 'err');
    }
  }

  showSliceDialog(file) {
    const box = this.sliceBox;
    box.innerHTML = '';
    const sel = (opts, val) => {
      const s = h('select', {});
      for (const o of opts) s.appendChild(h('option', { value: o, selected: o === val }, o));
      return s;
    };
    const prof = sel(Object.keys(PROFILES), '0.20mm SPEED');
    const mat = sel(Object.keys(FILAMENTS), this.spool.type in FILAMENTS ? this.spool.type : 'PLA');
    const infill = h('input', { type: 'range', min: 0, max: 100, step: 5, value: 15 });
    const infillLbl = h('span', {}, '15 %');
    infill.addEventListener('input', () => (infillLbl.textContent = `${infill.value} %`));
    const per = sel(['1', '2', '3', '4'], '2');
    const vase = h('input', { type: 'checkbox' });
    const scale = h('input', { type: 'number', min: 1, max: 1000, value: 100, step: 1 });
    const prog = h('div', { class: 'loader-bar', style: 'margin-top:8px;display:none' }, h('div', { style: 'height:100%;width:0%;background:var(--accent);transition:width .2s' }));
    const go = h('button', { class: 'btn primary block', style: 'margin-top:10px' }, 'Slicen & auf Stick speichern');
    box.append(
      h(
        'div',
        { class: 'hint', style: 'margin-top:10px' },
        h('b', {}, `STL slicen: ${file.name}`),
        h('label', { class: 'field' }, 'Druckprofil', prof),
        h('label', { class: 'field' }, 'Material', mat),
        h('label', { class: 'field' }, h('span', {}, 'Infill ', infillLbl), infill),
        h('label', { class: 'field' }, 'Perimeter', per),
        h('label', { class: 'field' }, 'Skalierung (%)', scale),
        h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, vase, 'Spiralvasen-Modus'),
        go,
        prog
      )
    );
    go.addEventListener('click', async () => {
      go.disabled = true;
      prog.style.display = 'block';
      try {
        const buf = await file.arrayBuffer();
        const geo = new STLLoader().parse(buf);
        const sc = Math.max(0.01, parseFloat(scale.value) / 100);
        geo.scale(sc, sc, sc);
        const placed = placeZUp(geo);
        const bb = placed.boundingBox;
        const size = bb.getSize(new THREE.Vector3());
        if (size.x > 250 || size.y > 210 || size.z > 220) {
          this.app.toast(`Modell ist zu groß für den Bauraum (${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)} mm). Bitte skalieren.`, 'warn', 6000);
          go.disabled = false;
          return;
        }
        const positions = placed.attributes.position.array;
        const name = file.name.replace(/\.stl$/i, '') + `_${prof.value.split(' ')[0]}_${mat.value}_MK4S.gcode`;
        const f = await this.slicer.makeFile(
          name,
          positions,
          { profile: prof.value, material: mat.value, infill: parseInt(infill.value, 10) / 100, perimeters: parseInt(per.value, 10), vase: vase.checked },
          (p) => (prog.firstChild.style.width = `${Math.round(p * 100)}%`),
          parseInt(this.spool.color.slice(1), 16)
        );
        f.source = 'user';
        this.usb.add(f);
        this.lcd.dirty = true;
        box.innerHTML = '';
        this.renderPanelParts();
        this.app.toast(`<b>${name}</b> gesliced (${fmtShort(f.meta.time)}, ${f.meta.filamentG.toFixed(1)} g) und auf den Stick kopiert.`, 'ok', 6000);
      } catch (e) {
        console.error(e);
        this.app.toast(`Slicen fehlgeschlagen: ${e.message}`, 'err');
        go.disabled = false;
      }
    });
  }
}

function fmtShort(s) {
  s = Math.max(0, Math.round(s || 0));
  const hh = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (hh) return `${hh} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}
