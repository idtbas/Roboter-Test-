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
