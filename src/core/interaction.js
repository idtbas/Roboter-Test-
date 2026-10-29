import * as THREE from 'three';

// Pointer interaction with 3D objects (buttons, knobs, touchscreens, …).
// Objects are registered with handler objects; hits are resolved by walking
// up the parent chain to the first registered ancestor.
export class Interaction {
  constructor(engine, tooltipEl) {
    this.engine = engine;
    this.camera = engine.camera;
    this.dom = engine.canvas;
    this.controls = engine.controls;
    this.scene = engine.scene;
    this.tooltipEl = tooltipEl;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.raycaster.layers.enable(1); // layer 1 = invisible pick proxies
    this.pointer = new THREE.Vector2();
    this.handlers = new Map();
    this.hovered = null;
    this.hoverHit = null;
    this.captured = null;
    this.downPos = null;
    this.lastMoveEvent = null;
    this.needsHoverUpdate = false;
    this.keyTarget = null;
    this.enabled = true;

    const d = this.dom;
    // Registered before OrbitControls handlers fire because we use capture phase
    d.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    d.addEventListener('pointermove', (e) => this.onPointerMove(e), { capture: true });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { capture: true });
    d.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    d.addEventListener('pointerleave', () => {
      this.lastMoveEvent = null;
      this.setHover(null, null);
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

  pick(e) {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      if (hit.object.userData.noPick) continue;
      if (!hit.object.visible) continue;
      // ignore objects that are invisible through a parent
      let vis = true;
      let p = hit.object.parent;
      while (p) {
        if (!p.visible) {
          vis = false;
          break;
        }
        p = p.parent;
      }
      if (!vis) continue;
      if (hit.object.material && hit.object.material.visible === false) continue;
      const r = this.resolve(hit.object);
      if (r && (!r.h.enabled || r.h.enabled())) return { ...r, hit };
      if (hit.object.userData.transparentToPick) continue;
      return null; // occluded by something non-interactive
    }
    return null;
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    this.dom.focus({ preventScroll: true });
    const r = this.pick(e);
    this.downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (!r) return;
    if (e.button === 2) return; // right button is always camera pan
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
    if (!this.captured) return;
    const c = this.captured;
    this.captured = null;
    this.controls.enabled = true;
    const moved = this.downPos ? Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) : 0;
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

  onWheel(e) {
    if (!this.enabled) return;
    const r = this.pick(e);
    if (r && r.h.onWheel) {
      const steps = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 100));
      const used = r.h.onWheel(steps, r.hit, e);
      if (used !== false) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }

  onKey(e, down) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (this.keyTarget && this.keyTarget.onKey) {
      const used = this.keyTarget.onKey(e, down);
      if (used) e.preventDefault();
    }
  }

  setHover(r, e) {
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
    this.hoverHit = r ? r.hit : null;
    if (r && r.h.onHoverMove) r.h.onHoverMove(r.hit);
    this.dom.style.cursor = r ? r.h.cursor || 'pointer' : '';
    this.updateTooltip(r, e);
  }

  updateTooltip(r, e) {
    const el = this.tooltipEl;
    if (!r || !e || !r.h.tooltip) {
      el.classList.add('hidden');
      return;
    }
    const tt = typeof r.h.tooltip === 'function' ? r.h.tooltip(r.hit) : r.h.tooltip;
    if (!tt) {
      el.classList.add('hidden');
      return;
    }
    const title = typeof tt === 'string' ? tt : tt.title;
    const hint = typeof tt === 'string' ? '' : tt.hint || '';
    const html = `<div class="tt-title">${title}</div>${hint ? `<div class="tt-hint">${hint}</div>` : ''}`;
    if (el._html !== html) {
      el.innerHTML = html;
      el._html = html;
    }
    el.classList.remove('hidden');
    const x = Math.min(e.clientX + 16, window.innerWidth - el.offsetWidth - 8);
    const y = Math.min(e.clientY + 18, window.innerHeight - el.offsetHeight - 8);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  highlight(obj, on) {
    obj.traverse((m) => {
      if (!m.isMesh || m.userData.noHighlight) return;
      if (on) {
        if (!m.userData.hlMat) {
          const orig = m.material;
          const hl = orig.clone();
          if (hl.emissive) {
            hl.emissive = hl.emissive.clone().lerp(new THREE.Color(0xff8a50), 0.5);
            hl.emissiveIntensity = Math.max(hl.emissiveIntensity ?? 0, 0) + 0.18;
          }
          m.userData.origMat = orig;
          m.userData.hlMat = hl;
        }
        // keep dynamic maps in sync
        const hl = m.userData.hlMat;
        const orig = m.userData.origMat;
        if (orig.map !== hl.map) hl.map = orig.map;
        if (orig.emissiveMap !== hl.emissiveMap) hl.emissiveMap = orig.emissiveMap;
        m.material = hl;
      } else if (m.userData.origMat) {
        m.material = m.userData.origMat;
      }
    });
  }

  // Must be called once per frame
  update() {
    if (this.needsHoverUpdate && this.lastMoveEvent && !this.captured) {
      this.needsHoverUpdate = false;
      // Skip hover while orbiting with a button pressed
      if (this.lastMoveEvent.buttons && !this.captured) {
        this.setHover(null, null);
        return;
      }
      const r = this.pick(this.lastMoveEvent);
      this.setHover(r, this.lastMoveEvent);
    }
  }

  refreshHover() {
    this.needsHoverUpdate = true;
  }
}
