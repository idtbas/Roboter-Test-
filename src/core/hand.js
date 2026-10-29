import * as THREE from 'three';
import { box, rbox, textPlane } from './parts.js';

// ---------------------------------------------------------------------------
// "Hand": pick up small objects (USB sticks), carry them with the mouse and
// plug them into sockets or put them down on a surface.
// ---------------------------------------------------------------------------

export class Hand {
  constructor(app) {
    this.app = app;
    this.item = null;
    this.sockets = [];
    this.tmp = new THREE.Vector3();
    app.interaction.hand = this;
  }

  // socket: { anchor: Object3D (+x points out of the port), accepts(item), onInsert(item), onRemove(item) }
  addSocket(socket) {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(40, 26, 30), new THREE.MeshBasicMaterial());
    proxy.layers.set(1);
    proxy.position.set(6, 0, 0);
    socket.anchor.add(proxy);
    socket.proxy = proxy;
    socket.item = null;
    this.app.interaction.add(proxy, { socket, noHighlight: true, cursor: 'copy' });
    this.sockets.push(socket);
    return socket;
  }

  addItem(item) {
    // item: { object, kind, data, socket?, home? }
    this.app.interaction.add(item.object, {
      cursor: 'grab',
      onClick: () => this.take(item)
    });
    if (item.socket) this.plug(item, item.socket, true);
    return item;
  }

  take(item) {
    if (this.item) return;
    const s = item.socket;
    if (s) {
      if (s.canRemove && !s.canRemove(item)) {
        this.deny(item.object);
        return;
      }
      item.home = s;
      s.item = null;
      item.socket = null;
      s.onRemove?.(item);
    }
    this.app.scene.attach(item.object);
    this.item = item;
    item.object.traverse((o) => o.isMesh && (o.castShadow = true));
    this.app.audio.click(this.pos(item.object), 0.2, 1700, 0.03);
    this.app.interaction.refreshHover();
  }

  plug(item, socket, silent = false) {
    socket.anchor.add(item.object);
    item.object.position.set(0, 0, 0);
    item.object.rotation.set(0, 0, 0);
    item.socket = socket;
    socket.item = item;
    if (!silent) {
      socket.onInsert?.(item);
      this.app.audio.click(this.pos(item.object), 0.28, 1500, 0.035);
    }
  }

  click(e) {
    const item = this.item;
    if (!item) return;
    const r = this.app.interaction.pick(e);
    if (r && r.h.socket) {
      const s = r.h.socket;
      if (s.item || (s.accepts && !s.accepts(item))) {
        this.deny(s.anchor);
        return;
      }
      this.item = null;
      this.plug(item, s);
      this.app.interaction.refreshHover();
      return;
    }
    const hit = this.app.interaction.rawHit(e);
    if (!hit || !hit.face) return;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.y < 0.7) {
      this.deny(item.object);
      return;
    }
    this.item = null;
    this.layDown(item, hit.point);
    this.app.audio.click(hit.point, 0.2, 900, 0.03);
    this.app.interaction.refreshHover();
  }

  layDown(item, point) {
    const o = item.object;
    this.app.scene.attach(o);
    o.position.copy(point);
    o.position.y += 3.2;
    o.rotation.set(0, o.rotation.y, 0);
    item.lying = true;
  }

  // Escape: put it back where it came from
  cancel() {
    const item = this.item;
    if (!item) return false;
    this.item = null;
    if (item.home && !item.home.item) this.plug(item, item.home);
    else {
      const p = item.object.position.clone();
      p.y = this.app.benchTop;
      this.layDown(item, p);
    }
    this.app.interaction.refreshHover();
    return true;
  }

  deny(obj) {
    this.app.audio.click(this.pos(obj), 0.25, 300, 0.06);
  }

  pos(obj) {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  update() {
    const item = this.item;
    if (!item) return;
    const e = this.app.interaction.lastMoveEvent;
    if (!e) return;
    const I = this.app.interaction;
    const hit = I.rawHit(e);
    const o = item.object;
    let target;
    if (hit) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      target = hit.point.clone().addScaledVector(n, 14);
      target.y += 10;
    } else {
      target = I.raycaster.ray.at(400, new THREE.Vector3());
    }
    o.position.lerp(target, 0.45);
    const cam = this.app.engine.camera;
    o.rotation.y += (Math.atan2(cam.position.x - o.position.x, cam.position.z - o.position.z) + Math.PI / 2 - o.rotation.y) * 0.2;
    o.rotation.z = 0.25;
  }
}

// USB flash drive. Origin = plug base (the port face); plug points to -x.
export function buildUsbStick(M, color, label) {
  const g = new THREE.Group();
  g.name = 'usb-stick';
  g.add(box(12, 4.6, 12.2, M.zinc, { x: -6 }));
  g.add(box(10, 2.2, 10.5, M.plasticBlack, { x: -6.5, y: 0.6 }));
  const bodyMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.5 });
  g.add(rbox(38, 9, 19, 3, bodyMat, { x: 19 }));
  g.add(rbox(6, 9.6, 19.6, 2, M.plasticBlack, { x: 1.5 }));
  const lab = textPlane(label, { w: 22, h: 6, color: '#ffffff', font: '800 70px Inter, Arial', px: 256 });
  lab.position.set(21, 4.65, 0);
  lab.rotation.x = -Math.PI / 2;
  g.add(lab);
  g.userData.keep = true;
  return g;
}

export class UsbStick {
  constructor(label) {
    this.label = label;
    this.files = [];
    this.listeners = new Set();
  }

  add(file) {
    const i = this.files.findIndex((f) => f.name === file.name);
    if (i >= 0) this.files.splice(i, 1, file);
    else this.files.push(file);
    this.changed();
  }

  remove(file) {
    this.files = this.files.filter((f) => f !== file);
    this.changed();
  }

  changed() {
    for (const l of this.listeners) l();
  }
}
