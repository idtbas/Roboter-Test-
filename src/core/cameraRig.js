import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Smooth camera flights between viewpoints on top of OrbitControls.
export class CameraRig {
  constructor(engine) {
    this.camera = engine.camera;
    this.controls = engine.controls;
    this.anim = null;
    this.follow = null; // function returning a world-space Vector3 to keep as target
    this.followOffset = new THREE.Vector3();
  }

  flyTo(pos, target, duration = 1.3, { minDistance, maxDistance } = {}) {
    this.follow = null;
    this.anim = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos.clone(),
      toTarget: target.clone()
    };
    if (minDistance !== undefined) this.controls.minDistance = minDistance;
    if (maxDistance !== undefined) this.controls.maxDistance = maxDistance;
  }

  setFollow(fn) {
    this.follow = fn;
    if (fn) this.lastFollow = fn().clone();
  }

  get busy() {
    return !!this.anim;
  }

  update(dt) {
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.duration;
      const k = ease(Math.min(1, a.t));
      // arc the path slightly upward for a more natural flight
      const lift = Math.sin(Math.PI * k) * a.fromPos.distanceTo(a.toPos) * 0.08;
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      this.camera.position.y += lift;
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      if (a.t >= 1) this.anim = null;
    } else if (this.follow) {
      const p = this.follow();
      const d = p.clone().sub(this.lastFollow);
      // smooth follow
      d.multiplyScalar(Math.min(1, dt * 6));
      this.controls.target.add(d);
      this.camera.position.add(d);
      this.lastFollow.add(d);
    }
  }
}
