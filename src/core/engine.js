import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { setMaxAnisotropy } from './textures.js';

// Rendering core: renderer, camera, controls, post-processing, render loop.
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    RectAreaLightUniformsLib.init();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1c20);

    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 4, 30000);
    this.camera.position.set(0, 1500, 1800);

    // Image based lighting from a neutral studio room
    const pmrem = new THREE.PMREMGenerator(r);
    const env = new RoomEnvironment();
    this.envMap = pmrem.fromScene(env, 0.035).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    env.dispose?.();
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 4200;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.6;
    this.controls.panSpeed = 0.8;
    this.controls.zoomToCursor = true;

    this.quality = 'high';
    this.setupComposer();

    this.updaters = [];
    this.timer = new THREE.Timer();
    this.frame = 0;

    window.addEventListener('resize', () => this.resize());
  }

  setupComposer() {
    const r = this.renderer;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'low' ? 0 : 4
    });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(this.scene, this.camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({
      radius: 14,
      distanceExponent: 1.6,
      thickness: 6,
      scale: 1.0,
      samples: 16,
      distanceFallOff: 1,
      screenSpaceRadius: false
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.enabled = this.quality === 'high';
    // keep transparent / clipped / sprite objects out of the AO normal+depth pass
    this.gtao._overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverse((o) => {
        if (!o.visible) return;
        const m = o.material;
        const skip =
          o.isPoints || o.isLine || o.isLine2 || o.isSprite || o.userData.noAO ||
          (m && !Array.isArray(m) && (m.transparent || (m.clippingPlanes && m.clippingPlanes.length)));
        if (skip) {
          o.visible = false;
          cache.push(o);
        }
      });
    };
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.5, 1.5);
    this.bloom.enabled = this.quality !== 'low';
    this.composer.addPass(this.bloom);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.smaa = null;
    if (this.quality === 'low') {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.25) : 1);
    r.shadowMap.enabled = true;
    this.composer.dispose?.();
    this.gtao.dispose?.();
    this.setupComposer();
    this.resize();
    this.scene.traverse((o) => {
      if (o.isLight && o.shadow && o.userData.shadowSize) {
        const s = q === 'high' ? o.userData.shadowSize : q === 'medium' ? o.userData.shadowSize / 2 : o.userData.shadowSize / 4;
        o.shadow.mapSize.set(s, s);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio?.(this.renderer.getPixelRatio());
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  step(dt) {
    this.frame++;
    for (const fn of this.updaters) fn(dt, this.frame);
    this.controls.update(dt);
    this.composer.render(dt);
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 0.1);
      if (this.paused) return;
      this.step(dt);
    };
    loop();
  }
}
