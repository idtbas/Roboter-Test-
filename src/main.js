import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Interaction } from './core/interaction.js';
import { CameraRig } from './core/cameraRig.js';
import { AudioEngine } from './core/audio.js';
import { materials } from './core/materials.js';
import { buildWorkshop } from './core/workshop.js';
import { Hud } from './ui/hud.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const loaderBar = document.getElementById('loader-progress');
const loaderStep = document.getElementById('loader-step');
async function progress(p, text) {
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  loaderStep.textContent = text;
  await nextFrame();
}

class App {
  constructor() {
    this.devices = [];
    this.active = null;
    this.simSpeed = 1;
    this.simTime = 0;
  }

  async init() {
    await progress(0.05, 'Grafik wird initialisiert');
    const canvas = document.getElementById('view');
    this.engine = new Engine(canvas);
    const params = new URLSearchParams(location.search);
    if (params.get('quality')) {
      this.engine.setQuality(params.get('quality'));
      const sel = document.getElementById('quality');
      if (sel) sel.value = params.get('quality');
    }
    // test hook: ?paused stops the continuous loop (frames rendered via __app.engine.step)
    if (params.has('paused')) this.engine.paused = true;
    this.scene = this.engine.scene;
    this.audio = new AudioEngine();
    this.rig = new CameraRig(this.engine);
    this.interaction = new Interaction(this.engine, document.getElementById('tooltip'));

    await progress(0.15, 'Materialien und Texturen werden erzeugt');
    this.M = materials();

    await progress(0.3, 'Werkstatt wird aufgebaut');
    this.workshop = buildWorkshop(this.scene, this.engine, this.M);

    const { PrusaMK4S } = await import('./devices/prusa/prusa.js');
    await progress(0.45, 'Original Prusa MK4S wird montiert');
    this.addDevice(new PrusaMK4S(this, this.workshop.slots.prusa));

    const { OrturLM3 } = await import('./devices/ortur/ortur.js');
    await progress(0.65, 'Ortur Laser Master 3 wird montiert');
    this.addDevice(new OrturLM3(this, this.workshop.slots.ortur, this.workshop.slots.laptop));

    const { ElegooMars4 } = await import('./devices/elegoo/elegoo.js');
    await progress(0.82, 'ELEGOO Mars 4 wird montiert');
    this.addDevice(new ElegooMars4(this, this.workshop.slots.elegoo));

    await progress(0.92, 'Shader werden kompiliert');
    this.hud = new Hud(this);
    this.engine.renderer.compile(this.scene, this.engine.camera);

    // overview camera
    this.engine.camera.position.set(0, 1900, 2700);
    this.engine.controls.target.set(0, 900, -400);

    this.engine.onUpdate((dt) => this.update(dt));
    this.engine.start();

    // first user gesture unlocks audio
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    await progress(1, 'Fertig');
    const loader = document.getElementById('loader');
    loader.classList.add('fade');
    setTimeout(() => loader.remove(), 700);
    this.hud.show();

    const hash = location.hash.replace('#', '');
    const start = this.devices.find((d) => d.id === hash) || this.devices[0];
    setTimeout(() => this.selectDevice(start, true), 250);
    if (!localStorage.getItem('mw3d-help-seen')) {
      setTimeout(() => this.hud.openHelp(), 1600);
      try {
        localStorage.setItem('mw3d-help-seen', '1');
      } catch {
        /* ignore */
      }
    }
  }

  addDevice(d) {
    this.devices.push(d);
    this.scene.add(d.root);
  }

  selectDevice(d, fly = true) {
    if (this.active === d) {
      if (fly) this.flyToView(d, d.cameraViews[0]);
      return;
    }
    this.active?.onDeactivate?.();
    this.active = d;
    this.interaction.keyTarget = d;
    d.onActivate?.();
    if (fly) this.flyToView(d, d.cameraViews[0]);
    this.hud.onDeviceChanged(d);
    history.replaceState(null, '', `#${d.id}`);
  }

  flyToView(d, view) {
    const pos = typeof view.pos === 'function' ? view.pos() : view.pos;
    const target = typeof view.target === 'function' ? view.target() : view.target;
    this.rig.flyTo(pos, target, view.duration || 1.3, { minDistance: view.minDistance ?? 60, maxDistance: view.maxDistance ?? 4200 });
    this.currentView = view;
    if (view.follow) {
      setTimeout(() => {
        if (this.currentView === view) this.rig.setFollow(view.follow);
      }, (view.duration || 1.3) * 1000 + 50);
    }
    d.onView?.(view);
    this.hud.onViewChanged(view);
  }

  overview() {
    this.rig.flyTo(new THREE.Vector3(0, 1900, 2700), new THREE.Vector3(0, 900, -400), 1.4, { minDistance: 60, maxDistance: 6000 });
    this.currentView = null;
    this.hud.onViewChanged(null);
  }

  update(realDt) {
    const simDt = realDt * this.simSpeed;
    this.simTime += simDt;
    for (const d of this.devices) d.update(simDt, realDt);
    this.rig.update(realDt);
    this.interaction.update();
    this.audio.updateListener(this.engine.camera);
    this.hud?.update(realDt);
  }

  toast(msg, type = 'info', ms = 4200) {
    this.hud?.toast(msg, type, ms);
  }
}

const app = new App();
window.__app = app;
app.init().catch((err) => {
  console.error(err);
  loaderStep.textContent = `Fehler beim Laden: ${err.message}`;
  loaderStep.style.color = '#ff6b6b';
});
