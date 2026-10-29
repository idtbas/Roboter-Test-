import * as THREE from 'three';

// Common functionality for all simulated devices.
export class BaseDevice {
  constructor(app, slot, { id, name, kind }) {
    this.app = app;
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = id;
    this.root.position.copy(slot);
    this.slot = slot.clone();
    this.cameraViews = [];
  }

  // world-space point from device-local coordinates
  w(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.root.matrixWorld);
  }

  view(id, label, pos, target, extra = {}) {
    const v = { id, label, pos: this.w(...pos), target: this.w(...target), ...extra };
    this.cameraViews.push(v);
    return v;
  }

  status() {
    return { state: 'off', text: 'Aus' };
  }

  buildPanel(el) {
    el.textContent = '';
  }

  update() {}

  onKey() {
    return false;
  }

  sfxPos(obj) {
    const v = new THREE.Vector3();
    (obj || this.root).getWorldPosition(v);
    return v;
  }
}

// Tiny DOM helper for building side panels
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}
