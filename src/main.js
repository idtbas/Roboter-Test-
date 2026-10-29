import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Interaction } from './core/interaction.js';
import { CameraRig } from './core/cameraRig.js';
import { AudioEngine } from './core/audio.js';
import { materials } from './core/materials.js';
import { buildWorkshop, BENCH_TOP } from './core/workshop.js';
import { Hand } from './core/hand.js';
import { SlicerService } from './slicer/service.js';

// Maker-Werkstatt 3D – there is intentionally no on-screen UI. Everything is
// operated through the devices themselves (displays, knobs, buttons, laptop).

const SPEEDS = [1, 2, 5, 10, 30, 100];
const OVERVIEW = { pos: new THREE.Vector3(-80, 1780, 2650), target: new THREE.Vector3(-80, 960, -420) };

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const loaderBar = document.getElementById('loader-progress');
async function progress(p) {
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  await nextFrame();
}

function isPhone() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
  const short = Math.min(screen.width, screen.height);
  return coarse && !fine && short < 700;
}

function isIPad() {
  return /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}

class App {
  constructor() {
    this.devices = [];
    this.simSpeed = 1;
    this.simTime = 0;
    this.benchTop = BENCH_TOP;
    this.currentView = null;
  }

  async init() {
    await progress(0.05);
    const canvas = document.getElementById('view');
    this.engine = new Engine(canvas);
    const params = new URLSearchParams(location.search);
    const q = params.get('quality') || (isIPad() ? 'medium' : null);
    if (q) this.engine.setQuality(q);
    // test hook: ?paused stops the continuous loop (frames rendered via __app.engine.step)
    if (params.has('paused')) this.engine.paused = true;
    this.scene = this.engine.scene;
    this.audio = new AudioEngine();
    this.audio.setMuted(store('mw3d-muted') === '1');
    this.rig = new CameraRig(this.engine);
    this.interaction = new Interaction(this.engine);
    this.hand = new Hand(this);
    this.slicer = new SlicerService();

    await progress(0.15);
    this.M = materials();

    await progress(0.3);
    this.workshop = buildWorkshop(this.scene, this.engine, this.M, this);

    const { PrusaMK4S } = await import('./devices/prusa/prusa.js');
    await progress(0.45);
    this.addDevice(new PrusaMK4S(this, this.workshop.slots.prusa));

    const { OrturLM3 } = await import('./devices/ortur/ortur.js');
    await progress(0.65);
    this.addDevice(new OrturLM3(this, this.workshop.slots.ortur, this.workshop.slots.laptop));

    const { ElegooMars4 } = await import('./devices/elegoo/elegoo.js');
    await progress(0.82);
    this.addDevice(new ElegooMars4(this, this.workshop.slots.elegoo));

    await progress(0.92);
    this.engine.renderer.compile(this.scene, this.engine.camera);

    this.setupNavigation();
    this.engine.onUpdate((dt) => this.update(dt));
    this.engine.start();

    // Devices keep working while the tab is in the background: browsers pause
    // rendering, so the missed time is simulated when the page becomes visible.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt) {
        const away = (performance.now() - this.hiddenAt) / 1000;
        this.hiddenAt = null;
        if (away > 2) this.catchUpLeft = Math.min(away * this.simSpeed, 24 * 3600);
      }
    });

    // first user gesture unlocks audio
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    await progress(1);
    const loader = document.getElementById('loader');
    loader.classList.add('fade');
    setTimeout(() => loader.remove(), 900);

    // first visit: start in front of the workshop manual on the pegboard
    const firstVisit = !store('mw3d-visited');
    store('mw3d-visited', '1');
    const start = params.get('view');
    const dev = this.devices.find((d) => d.id === start);
    if (dev) this.flyToView(dev, dev.cameraViews[0], 0.01);
    else if (firstVisit && !params.has('paused')) this.flyToView(null, this.workshop.views.manual, 0.01);
    else this.overview(0.01);
    this.ready = true;
  }

  addDevice(d) {
    this.devices.push(d);
    this.scene.add(d.root);
    this.interaction.setOwner(d.root, d);
  }

  // ------------------------------------------------------------ navigation
  setupNavigation() {
    const I = this.interaction;
    I.onDoubleClick = (hit) => this.focusOn(hit);
    I.onGlobalKey = (e, down) => {
      if (!down) return false;
      if (e.key === 'Escape') {
        if (this.hand.cancel()) return true;
        this.overview();
        return true;
      }
      if (e.key === 'm' || e.key === 'M') {
        this.audio.unlock();
        this.audio.setMuted(!this.audio.muted);
        store('mw3d-muted', this.audio.muted ? '1' : '0');
        return true;
      }
      return false;
    };
  }

  focusOn(hit) {
    const dev = this.interaction.ownerOf(hit.object);
    let view = dev ? dev.focusViewFor?.(hit.object) : this.workshop.focusViewFor(hit.object);
    if (!view) {
      // generic: move closer to the clicked spot
      const target = hit.point.clone();
      const dir = this.engine.camera.position.clone().sub(target).normalize();
      const dist = Math.min(900, Math.max(320, this.engine.camera.position.distanceTo(target) * 0.5));
      view = { pos: target.clone().addScaledVector(dir, dist), target, generic: true };
    }
    if (view === this.currentView) return;
    this.flyToView(dev, view);
  }

  flyToView(d, view, duration) {
    const pos = typeof view.pos === 'function' ? view.pos() : view.pos;
    const target = typeof view.target === 'function' ? view.target() : view.target;
    const dur = duration ?? view.duration ?? 1.3;
    this.rig.flyTo(pos, target, dur, { minDistance: view.minDistance ?? 50, maxDistance: view.maxDistance ?? 6000 });
    this.currentView = view;
    if (view.follow) {
      setTimeout(() => {
        if (this.currentView === view) this.rig.setFollow(view.follow);
      }, dur * 1000 + 50);
    }
    if (d) this.interaction.keyTarget = d;
    for (const dev of this.devices) dev.onView?.(dev === d ? view : null);
  }

  overview(duration = 1.4) {
    this.rig.flyTo(OVERVIEW.pos, OVERVIEW.target, duration, { minDistance: 50, maxDistance: 6000 });
    this.currentView = null;
    for (const dev of this.devices) dev.onView?.(null);
  }

  // wall clock: cycles the simulation speed
  cycleSpeed(dir = 1) {
    const i = SPEEDS.indexOf(this.simSpeed);
    const n = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + dir));
    const wrap = dir > 0 && i === SPEEDS.length - 1 ? 0 : n;
    this.simSpeed = SPEEDS[wrap];
  }

  // ------------------------------------------------------------ loop
  update(realDt) {
    if (this.catchUpLeft > 0) {
      // fast-forward in small slices without blocking the page for long
      const t0 = performance.now();
      while (this.catchUpLeft > 0 && performance.now() - t0 < 25) {
        const step = Math.min(this.catchUpLeft, 1);
        for (const d of this.devices) d.update(step, 0);
        this.simTime += step;
        this.catchUpLeft -= step;
      }
    }
    const simDt = realDt * this.simSpeed;
    this.simTime += simDt;
    for (const d of this.devices) d.update(simDt, realDt);
    this.workshop.update?.(realDt, simDt);
    this.rig.update(realDt);
    this.interaction.update();
    this.hand.update();
    this.audio.updateListener(this.engine.camera);
    this.adaptQuality(realDt);
  }

  // lower the render quality automatically when frames get slow
  adaptQuality(dt) {
    if (this.engine.paused) return;
    this.fpsWin = this.fpsWin || { t: 0, n: 0, grace: 4 };
    const w = this.fpsWin;
    if (w.grace > 0) {
      w.grace -= dt;
      return;
    }
    w.t += dt;
    w.n++;
    if (w.t >= 4) {
      const fps = w.n / w.t;
      w.t = 0;
      w.n = 0;
      const q = this.engine.quality;
      if (fps < 26 && q !== 'low') {
        this.engine.setQuality(q === 'high' ? 'medium' : 'low');
        w.grace = 3;
      }
    }
  }

  // kept for device code paths; there are no on-screen messages
  toast() {}
}

if (isPhone()) {
  document.getElementById('loader')?.remove();
  document.getElementById('phone-note')?.classList.remove('hidden');
} else {
  const app = new App();
  window.__app = app;
  app.init().catch((err) => {
    console.error(err);
    loaderBar.style.background = '#ff6b6b';
  });
}
