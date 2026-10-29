import * as THREE from 'three';

// Pointer interaction with 3D objects (buttons, knobs, screens, …).
// There is deliberately no 2D overlay: feedback happens in the world
// (hover glow, cursor, sounds, the devices' own displays).
export class Interaction {
  constructor(engine) {
    this.engine = engine;
    this.camera = engine.camera;
    this.dom = engine.canvas;
    this.controls = engine.controls;
    this.scene = engine.scene;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enable(1); // layer 1 = invisible pick proxies
    this.pointer = new THREE.Vector2();
    this.handlers = new Map();
    this.owners = new Map(); // object root -> device (keyboard focus)
    this.hovered = null;
    this.captured = null;
    this.downPos = null;
    this.lastMoveEvent = null;
    this.needsHoverUpdate = false;
    this.keyTarget = null;
    this.hand = null; // set by the app: holds a picked-up item
    this.onDoubleClick = null;
    this.onGlobalKey = null;

    const d = this.dom;
    // capture phase: runs before OrbitControls' own listeners
    d.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    d.addEventListener('pointermove', (e) => this.onPointerMove(e), { capture: true });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { capture: true });
    d.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    d.addEventListener('dblclick', (e) => this.onDblClick(e));
    d.addEventListener('pointerleave', () => {
      this.lastMoveEvent = null;
      this.setHover(null);
    });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  add(obj, h) {
    obj.userData.interactive = true;
    this.handlers.set(obj, h);
    return obj;
  }

  remove(obj) {
    this.handlers.delete(obj);
    if (this.hovered === obj) this.setHover(null);
  }

  setOwner(root, device) {
    this.owners.set(root, device);
  }

  ownerOf(o) {
    while (o) {
      const d = this.owners.get(o);
      if (d) return d;
      o = o.parent;
    }
    return null;
  }

  resolve(o) {
    while (o) {
      const h = this.handlers.get(o);
      if (h) return { obj: o, h };
      o = o.parent;
    }
    return null;
  }

  setPointer(e) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  visibleHits(e) {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    const held = this.hand && this.hand.item ? this.hand.item.object : null;
    return hits.filter((hit) => {
      const o = hit.object;
      if (o.userData.noPick || !o.visible) return false;
      if (o.material && o.material.visible === false) return false;
      let p = o.parent;
      while (p) {
        if (!p.visible || p === held) return false;
        p = p.parent;
      }
      return o !== held;
    });
  }

  // first interactive object under the pointer (respecting occlusion)
  pick(e) {
    const holding = !!(this.hand && this.hand.item);
    for (const hit of this.visibleHits(e)) {
      const r = this.resolve(hit.object);
      // sockets only matter while carrying something
      if (r && r.h.socket && !holding) continue;
      if (r && (!r.h.enabled || r.h.enabled())) return { ...r, hit };
      if (hit.object.userData.transparentToPick || hit.object.layers.mask === 2) continue;
      return null;
    }
    return null;
  }

  // first solid surface under the pointer (ignores layer-1 proxies)
  rawHit(e) {
    for (const hit of this.visibleHits(e)) {
      if (hit.object.layers.mask === 2) continue;
      if (hit.object.userData.transparentToPick) continue;
      return hit;
    }
    return null;
  }

  onPointerDown(e) {
    this.dom.focus({ preventScroll: true });
    this.downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
    const raw = this.rawHit(e);
    this.lastDownObject = raw ? raw.object : null;
    const owner = raw ? this.ownerOf(raw.object) : null;
    if (owner) this.keyTarget = owner;
    if (e.button !== 0) return; // right/middle button: camera only
    if (this.hand && this.hand.item) return; // holding something: clicks are handled on release
    const r = this.pick(e);
    if (!r) return;
    const owner2 = this.ownerOf(r.obj);
    if (owner2) this.keyTarget = owner2;
    const consumed = r.h.onDown ? r.h.onDown(r.hit, e) : true;
    if (consumed !== false) {
      this.captured = r;
      this.controls.enabled = false;
      e.stopImmediatePropagation();
      e.preventDefault();
      try {
        this.dom.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  onPointerMove(e) {
    this.lastMoveEvent = e;
    if (this.captured) {
      const c = this.captured;
      if (c.h.onDrag) {
        this.setPointer(e);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObject(c.obj, true);
        c.h.onDrag(hits[0] || null, e, this.raycaster.ray);
      }
      e.stopImmediatePropagation();
      return;
    }
    this.needsHoverUpdate = true;
  }

  onPointerUp(e) {
    const moved = this.downPos ? Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) : 99;
    if (!this.captured) {
      // a plain click on the world while holding an item
      if (e.button === 0 && moved < 6 && this.hand && this.hand.item && e.target === this.dom) this.hand.click(e);
      return;
    }
    const c = this.captured;
    this.captured = null;
    this.controls.enabled = true;
    const r = this.pick(e);
    const same = r && r.obj === c.obj;
    if (c.h.onUp) c.h.onUp(same ? r.hit : null, e);
    if (same && moved < 8 && c.h.onClick) c.h.onClick(r.hit, e);
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  onDblClick(e) {
    if (this.hand && this.hand.item) return;
    const raw = this.rawHit(e);
    if (raw && this.onDoubleClick) this.onDoubleClick(raw, e);
  }

  onWheel(e) {
    if (this.hand && this.hand.item) return;
    const r = this.pick(e);
    if (r && r.h.onWheel) {
      // mouse wheels deliver ~100 per notch, touchpads many small deltas
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      const now = performance.now();
      if (now - (this.wheelT || 0) > 300) this.wheelAcc = 0;
      this.wheelT = now;
      let steps = 0;
      if (Math.abs(dy) >= 50) steps = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 100));
      else {
        this.wheelAcc = (this.wheelAcc || 0) + dy;
        steps = Math.trunc(this.wheelAcc / 60);
        this.wheelAcc -= steps * 60;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (steps) r.h.onWheel(steps, r.hit, e);
    }
  }

  onKey(e, down) {
    let used = false;
    if (this.keyTarget && this.keyTarget.onKey) used = !!this.keyTarget.onKey(e, down);
    if (!used && this.onGlobalKey) used = !!this.onGlobalKey(e, down);
    if (used) e.preventDefault();
  }

  setHover(r) {
    const obj = r ? r.obj : null;
    if (obj !== this.hovered) {
      if (this.hovered) this.highlight(this.hovered, false);
      const prevH = this.hovered && this.handlers.get(this.hovered);
      if (prevH && prevH.onHover) prevH.onHover(false);
      this.hovered = obj;
      if (obj) {
        if (!r.h.noHighlight) this.highlight(obj, true);
        if (r.h.onHover) r.h.onHover(true);
      }
    }
    if (r && r.h.onHoverMove) r.h.onHoverMove(r.hit);
    let cursor = '';
    if (this.hand && this.hand.item) cursor = r && r.h.socket ? 'copy' : 'grabbing';
    else if (r) cursor = r.h.cursor || 'pointer';
    this.dom.style.cursor = cursor;
  }

  highlight(obj, on) {
    obj.traverse((m) => {
      if (!m.isMesh || m.userData.noHighlight || m.layers.mask === 2) return;
      if (on) {
        if (!m.userData.hlMat || m.userData.origMat !== m.material) {
          const orig = m.material;
          if (Array.isArray(orig)) return;
          const hl = orig.clone();
          if (hl.emissive) {
            hl.emissive = hl.emissive.clone().lerp(new THREE.Color(0xff8a50), 0.5);
            hl.emissiveIntensity = Math.max(hl.emissiveIntensity ?? 0, 0) + 0.18;
          }
          hl.onBeforeCompile = orig.onBeforeCompile;
          hl.customProgramCacheKey = orig.customProgramCacheKey;
          m.userData.origMat = orig;
          m.userData.hlMat = hl;
        }
        const hl = m.userData.hlMat;
        const orig = m.userData.origMat;
        if (orig.map !== hl.map) hl.map = orig.map;
        if (orig.emissiveMap !== hl.emissiveMap) hl.emissiveMap = orig.emissiveMap;
        m.material = hl;
      } else if (m.userData.origMat && m.material === m.userData.hlMat) {
        m.material = m.userData.origMat;
      }
    });
  }

  // Must be called once per frame
  update() {
    if (this.needsHoverUpdate && this.lastMoveEvent && !this.captured) {
      this.needsHoverUpdate = false;
      if (this.lastMoveEvent.buttons) {
        this.setHover(null);
        return;
      }
      let r = this.pick(this.lastMoveEvent);
      // while holding an item, only sockets light up
      if (this.hand && this.hand.item && r && !r.h.socket) r = null;
      if (this.hand && !this.hand.item && r && r.h.socket) r = null;
      this.setHover(r);
    }
  }

  refreshHover() {
    this.needsHoverUpdate = true;
  }
}
