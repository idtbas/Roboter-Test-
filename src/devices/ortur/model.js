import * as THREE from 'three';
import {
  box, rbox, cyl, cylX, cylZ, group, extrude, extrusion, roundedRectShape, circlePath, capScrew, buttonHead,
  stepper, axialFan, beltStrand, gt2Pulley, tube, textPlane, mergeStatic
} from '../../core/parts.js';
import { honeycombTextures } from '../../core/textures.js';

// ---------------------------------------------------------------------------
// Ortur Laser Master 3 (+ honeycomb bed, laptop). Units mm, origin = bench
// surface below the centre of the 400 x 400 mm work area.
//   machine X  -> device x = X - 200
//   machine Y  -> device z = 200 - Y   (Y grows towards the back)
// ---------------------------------------------------------------------------

export const LGEO = {
  X0: -200,
  Z0: 200,
  BED_TOP: 22, // honeycomb surface
  RAIL_X: 262,
  GANTRY_Y: 66,
  MOD_DZ: 36, // laser spot is this far in front (+z) of the gantry centre
  FOCAL: 12 // nozzle bottom -> focus distance
};

export function buildOrturModel(M) {
  const root = group('ortur-lm3');
  const H = {};
  const blackAl = M.blackAnodized;
  const cover = M.galaxyBlack;

  // ======================= Frame =======================================
  const frame = group('frame');
  const railLen = 560;
  const railZc = -20;
  for (const sx of [-1, 1]) {
    frame.add(extrusion(20, 40, railLen, blackAl, { x: sx * LGEO.RAIL_X, y: 28, z: railZc }));
    // end caps / corner blocks
    for (const z of [railZc - railLen / 2 - 6, railZc + railLen / 2 + 6]) {
      frame.add(rbox(44, 46, 26, 4, cover, { x: sx * (LGEO.RAIL_X + 6), y: 27, z }));
      frame.add(cyl(11, 6, M.rubber, { x: sx * (LGEO.RAIL_X + 6), y: 3, z }, 20));
    }
    // Y belt along the outside of the rail
    const yb = beltStrand(M, railLen - 30, 6, 1.2);
    yb.rotation.y = Math.PI / 2;
    yb.position.set(sx * (LGEO.RAIL_X + 11), 40, railZc);
    yb.userData.keep = true;
    frame.add(yb);
    H[sx < 0 ? 'yBeltL' : 'yBeltR'] = yb.userData.beltTex;
    // Y motor at the back
    const ym = stepper(M, { length: 34, shaftLen: 14 });
    ym.rotation.set(0, 0, sx < 0 ? -Math.PI / 2 : Math.PI / 2);
    ym.position.set(sx * (LGEO.RAIL_X + 26), 40, railZc - railLen / 2 + 22);
    frame.add(ym);
  }
  // front + back beams (2020)
  frame.add(extrusion(20, 20, 2 * LGEO.RAIL_X - 20, blackAl, { y: 18, z: railZc + railLen / 2 - 10, ry: Math.PI / 2 }));
  frame.add(extrusion(20, 20, 2 * LGEO.RAIL_X - 20, blackAl, { y: 18, z: railZc - railLen / 2 + 6, ry: Math.PI / 2 }));
  // front logo cover strip
  const logo = textPlane('ORTUR', { w: 70, h: 12, color: '#e9e9e9', font: '800 80px Inter, Arial', px: 512 });
  logo.position.set(-120, 18, railZc + railLen / 2 + 0.4);
  frame.add(logo);
  const model3 = textPlane('LASER MASTER 3', { w: 80, h: 7, color: '#c8c8c8', font: '600 60px Inter, Arial', px: 512 });
  model3.position.set(-30, 18, railZc + railLen / 2 + 0.4);
  frame.add(model3);
  // ruler marks on the front beam (mm scale)
  const rulerTex = rulerTexture();
  const ruler = new THREE.Mesh(new THREE.PlaneGeometry(400, 10), new THREE.MeshStandardMaterial({ map: rulerTex, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  ruler.rotation.x = -Math.PI / 2;
  ruler.position.set(0, 28.2, railZc + railLen / 2 - 10);
  frame.add(ruler);

  // ---- controller box (front right) with E-stop, power, key ----
  const ctrl = group('controller', { x: 240, y: 0, z: 262 });
  ctrl.add(rbox(96, 58, 70, 6, cover, { y: 29 }));
  ctrl.add(rbox(84, 2, 58, 4, M.plasticGrey, { y: 58.5 }));
  const lab = textPlane('POWER     KEY     STOP', { w: 80, h: 5, color: '#bfbfbf', font: '600 52px Inter, Arial', px: 512 });
  lab.rotation.x = -Math.PI / 2;
  lab.position.set(0, 59.7, 25);
  ctrl.add(lab);
  // USB-C + DC on the right side
  ctrl.add(rbox(1, 4, 10, 1.5, M.zinc, { x: 48.3, y: 30, z: 10 }));
  ctrl.add(cylX(5.5, 2, M.plasticBlack, { x: 48.5, y: 30, z: -18 }, 20));
  // SD slot
  ctrl.add(box(1, 2, 14, M.plasticBlack, { x: 48.3, y: 18, z: 10 }));
  root.add(ctrl);
  H.ctrl = ctrl;

  // power button (illuminated ring)
  const pwr = group('power-btn', { x: -28, y: 60, z: 2 });
  pwr.add(cyl(9, 3, M.zinc, { y: 1.5 }, 32));
  const pwrCap = cyl(6.5, 3, M.plasticBlack, { y: 3.2 }, 32);
  pwr.add(pwrCap);
  const ledMat = M.ledBlue.clone();
  const pwrRing = new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.8, 8, 32), ledMat);
  pwrRing.rotation.x = Math.PI / 2;
  pwrRing.position.y = 3.1;
  pwr.add(pwrRing);
  pwr.userData.keep = true;
  ctrl.add(pwr);
  H.powerBtn = pwr;
  H.powerCap = pwrCap;
  H.powerLed = ledMat;

  // key switch
  const key = group('key-switch', { x: 0, y: 60, z: 2 });
  key.add(cyl(8, 3, M.zinc, { y: 1.5 }, 32));
  key.add(cyl(5, 1.5, M.brass, { y: 3.4 }, 24));
  const keyRot = new THREE.Group();
  keyRot.position.y = 4;
  keyRot.add(box(1.6, 3, 7, M.zinc, { y: 1.5 }));
  keyRot.add(rbox(3, 18, 16, 3, M.plasticBlack, { y: 12 }));
  keyRot.add(cylX(2, 3.4, M.zinc, { y: 17 }, 12));
  key.add(keyRot);
  key.userData.keep = true;
  ctrl.add(key);
  H.keySwitch = key;
  H.keyRot = keyRot;

  // emergency stop (red mushroom on yellow plate)
  const es = group('estop', { x: 28, y: 60, z: 2 });
  es.add(cyl(14, 2, new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }), { y: 1 }, 32));
  const mush = new THREE.Group();
  mush.add(cyl(6, 6, M.plasticBlack, { y: 4 }, 24));
  const capGeo = new THREE.SphereGeometry(12, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(1, 0.45, 1);
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc8141a, roughness: 0.35, clearcoat: 0.6 });
  const cap = new THREE.Mesh(capGeo, red);
  cap.position.y = 7;
  cap.castShadow = true;
  mush.add(cap);
  mush.add(cyl(12, 1.6, red, { y: 7 }, 32));
  es.add(mush);
  es.userData.keep = true;
  ctrl.add(es);
  H.estop = es;
  H.estopMush = mush;

  // ======================= Honeycomb bed ================================
  const hc = honeycombTextures();
  for (const t of [hc.map, hc.normalMap, hc.roughnessMap]) t.repeat.set(430 / 48, 430 / 47);
  const hcMat = new THREE.MeshStandardMaterial({ map: hc.map, normalMap: hc.normalMap, roughnessMap: hc.roughnessMap, metalness: 0.8, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) });
  const bed = group('honeycomb');
  const top = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), hcMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = LGEO.BED_TOP - 0.2;
  top.receiveShadow = true;
  bed.add(top);
  // frame of the panel
  const panelFrame = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    bed.add(box(8, LGEO.BED_TOP, 436, panelFrame, { x: sx * 214, y: LGEO.BED_TOP / 2 }));
    bed.add(box(420, LGEO.BED_TOP, 8, panelFrame, { z: sx * 214, y: LGEO.BED_TOP / 2 }));
  }
  bed.add(box(436, 2, 436, M.darkSteel, { y: 1 }));
  root.add(bed);
  H.honeycomb = bed;
  H.honeycombTop = top;

  // ======================= Gantry (moves along Y / device z) ==============
  const gantry = group('gantry');
  gantry.userData.keep = true;
  const gs = group('gantry-static');
  gs.add(extrusion(40, 20, 2 * LGEO.RAIL_X + 20, blackAl, { y: LGEO.GANTRY_Y, ry: Math.PI / 2 }));
  for (const sx of [-1, 1]) {
    const px = sx * (LGEO.RAIL_X + 15);
    gs.add(rbox(6, 70, 96, 5, blackAl, { x: px, y: 46 }));
    gs.add(rbox(8, 30, 70, 4, cover, { x: px + sx * 5, y: 60 }));
    // V-wheels riding on the rail
    for (const z of [-30, 30]) {
      gs.add(cylX(11.5, 10, M.plasticBlack, { x: sx * (LGEO.RAIL_X + 2), y: 54, z }, 24));
      gs.add(cylX(4, 12.5, M.steel, { x: sx * (LGEO.RAIL_X + 2), y: 54, z }, 12));
    }
    for (const y of [30, 66]) for (const z of [-38, 38]) gs.add(buttonHead(2.5, M.zinc, M.rubber, { x: px + sx * 3.2, y, z, rz: (-sx * Math.PI) / 2 }));
  }
  // X motor on the left plate
  const xm = stepper(M, { length: 34, shaftLen: 14 });
  xm.rotation.set(Math.PI / 2, 0, 0);
  xm.position.set(-LGEO.RAIL_X + 22, LGEO.GANTRY_Y, -24);
  gs.add(xm);
  // X belt on the front face of the beam
  const xb = beltStrand(M, 2 * LGEO.RAIL_X - 40, 6, 1.2);
  xb.position.set(0, LGEO.GANTRY_Y + 5, 21.5);
  xb.rotation.x = Math.PI / 2;
  xb.userData.keep = true;
  gs.add(xb);
  H.xBelt = xb.userData.beltTex;
  // cable channel on top of the beam
  gs.add(box(2 * LGEO.RAIL_X - 40, 6, 14, cover, { y: LGEO.GANTRY_Y + 13, z: -6 }));
  mergeStatic(gs);
  gantry.add(gs);
  root.add(gantry);
  H.gantry = gantry;

  // ======================= Laser carriage + module ======================
  const carriage = group('carriage');
  carriage.userData.keep = true;
  const cs = group('carriage-static');
  cs.add(rbox(66, 60, 6, 4, blackAl, { y: LGEO.GANTRY_Y, z: 26 }));
  for (const sx of [-1, 1]) for (const y of [-26, 26]) cs.add(cylZ(10, 9, M.plasticBlack, { x: sx * 22, y: LGEO.GANTRY_Y + y, z: 18 }, 20));
  // vertical slide for focusing
  cs.add(rbox(28, 70, 8, 3, cover, { y: LGEO.GANTRY_Y - 4, z: 31 }));
  mergeStatic(cs);
  carriage.add(cs);
  gantry.add(carriage);
  H.carriage = carriage;

  // module (slides vertically for focus)
  const mod = group('laser-module');
  mod.userData.keep = true;
  const ms = group('module-static');
  const mz = LGEO.MOD_DZ; // module centre z
  // main body
  ms.add(rbox(44, 64, 46, 4, M.blackAnodized, { y: 52, z: mz }));
  // heatsink fins (top part)
  for (let i = 0; i < 9; i++) ms.add(box(42, 2, 46, M.blackAnodized, { y: 88 + i * 4, z: mz }));
  ms.add(box(8, 36, 40, M.blackAnodized, { y: 102, z: mz }));
  // fan on top
  const fan = axialFan(M, 40, 10);
  fan.group.rotation.x = -Math.PI / 2;
  fan.group.position.set(0, 128, mz);
  fan.group.userData.keep = true;
  mod.add(fan.group);
  H.moduleFan = fan.rotor;
  // fan guard
  for (let i = -3; i <= 3; i++) ms.add(box(38, 1, 1, M.zinc, { y: 133.5, z: mz + i * 5 }));
  // lens barrel + air-assist nozzle
  ms.add(cyl(9, 16, M.blackAnodized, { y: 16, z: mz }, 24));
  ms.add(cyl(6, 8, M.aluminiumRaw, { y: 5, z: mz }, 24, 3.4));
  ms.add(cylX(2.4, 22, M.plasticBlack, { x: 18, y: 22, z: mz + 12, rz: 0.3 }, 10));
  // labels
  const t1 = textPlane('ORTUR', { w: 30, h: 7, color: '#ffffff', font: '800 70px Inter, Arial', px: 512 });
  t1.position.set(0, 66, mz + 23.2);
  ms.add(t1);
  const t2 = textPlane('LU2-10A  10W', { w: 34, h: 4.5, color: '#f0a020', font: '700 52px Inter, Arial', px: 512 });
  t2.position.set(0, 56, mz + 23.2);
  ms.add(t2);
  const warn = textPlane('⚠ LASER 4', { w: 22, h: 6, color: '#111', bg: '#f2c200', font: '800 50px Inter, Arial', px: 256 });
  warn.position.set(0, 38, mz + 23.2);
  ms.add(warn);
  mergeStatic(ms);
  mod.add(ms);
  // translucent orange laser shield
  const shieldMat = new THREE.MeshPhysicalMaterial({ color: 0xff6a00, roughness: 0.15, transmission: 0.0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, emissive: 0x401000, emissiveIntensity: 0.2 });
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 22, 32, 1, true), shieldMat);
  shield.position.set(0, 11, mz);
  shield.userData.transparentToPick = true;
  mod.add(shield);
  H.shieldMat = shieldMat;
  // focus thumb screw on the right
  const thumb = group('thumb', { x: 18, y: 52, z: 31 });
  thumb.add(cylX(5.5, 6, M.plasticBlack, { x: 4 }, 16));
  thumb.add(cylX(2, 6, M.zinc, {}, 10));
  thumb.userData.keep = true;
  mod.add(thumb);
  H.thumb = thumb;
  // fixed-focus gauge (fold-down)
  const gauge = group('gauge', { x: -26, y: 30, z: mz });
  const gaugeArm = new THREE.Group();
  gaugeArm.add(box(3, 42, 10, M.plasticGrey, { y: -21 }));
  gaugeArm.add(box(6, 2, 12, M.plasticGrey, { y: -42 }));
  gauge.add(gaugeArm);
  gauge.add(cylX(3, 6, M.zinc, {}, 12));
  gaugeArm.rotation.z = Math.PI * 0.97; // stowed (folded up)
  gauge.userData.keep = true;
  mod.add(gauge);
  H.gauge = gauge;
  H.gaugeArm = gaugeArm;
  // laser spot anchor (nozzle tip)
  const tipAnchor = new THREE.Object3D();
  tipAnchor.position.set(0, 0.5, mz);
  mod.add(tipAnchor);
  H.tip = tipAnchor;
  carriage.add(mod);
  H.module = mod;

  // cable from the gantry to the module
  H.cableMat = M.wireBlack;

  // spot glow sprite + light
  const spotTex = glowTexture();
  const spotMat = new THREE.SpriteMaterial({ map: spotTex, color: 0x8a7dff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true });
  const spot = new THREE.Sprite(spotMat);
  spot.scale.set(10, 10, 1);
  spot.visible = false;
  spot.userData.noPick = true;
  root.add(spot);
  H.spot = spot;
  H.spotMat = spotMat;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: spotTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  core.scale.set(2.5, 2.5, 1);
  core.visible = false;
  root.add(core);
  H.spotCore = core;
  const light = new THREE.PointLight(0x6f5bff, 0, 420, 1.6);
  light.castShadow = false;
  root.add(light);
  H.spotLight = light;
  // beam (thin cone from lens to spot)
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x7d6bff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.6, 1, 8, 1, true), beamMat);
  beam.userData.noPick = true;
  root.add(beam);
  H.beam = beam;
  H.beamMat = beamMat;

  mergeStatic(frame);
  root.add(frame);
  return { root, H };
}

// ---------------------------------------------------------------------------
// Laptop (generic 14" ultrabook). Returns group + screen mesh + material.
// ---------------------------------------------------------------------------
export function buildLaptop(M) {
  const g = group('laptop');
  const alu = new THREE.MeshPhysicalMaterial({ color: 0x9da3aa, metalness: 1, roughness: 0.38, clearcoat: 0.1 });
  const darkAlu = new THREE.MeshPhysicalMaterial({ color: 0x2b2e33, metalness: 0.6, roughness: 0.45 });
  const W = 322;
  const D = 222;
  // base
  g.add(rbox(W, 15, D, 6, alu, { y: 7.5 }));
  // keyboard well + keys
  g.add(rbox(282, 1, 112, 3, darkAlu, { y: 15.1, z: -28 }));
  const keyGeo = new THREE.BoxGeometry(15.5, 1.2, 15);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.65 });
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, 80);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let row = 0; row < 5; row++) {
    const cols = 14;
    for (let c = 0; c < cols && n < 80; c++) {
      const x = -136 + c * 19.6 + (row === 4 ? 0 : row * 3);
      const z = -78 + row * 19.5;
      let sx = 1;
      if (row === 4 && c === 5) sx = 6;
      if (row === 4 && c > 5 && c < 10) continue;
      m.makeScale(sx, 1, 1);
      m.setPosition(x + (sx > 1 ? 48 : 0), 16, z);
      keys.setMatrixAt(n++, m);
    }
  }
  keys.count = n;
  keys.castShadow = true;
  keys.receiveShadow = true;
  g.add(keys);
  // trackpad
  g.add(rbox(110, 0.6, 70, 4, new THREE.MeshPhysicalMaterial({ color: 0x8e949b, metalness: 0.9, roughness: 0.3 }), { y: 15.2, z: 62 }));
  // lid (pivot at the back edge)
  const lid = group('lid', { y: 15, z: -D / 2 + 4 });
  lid.rotation.x = -0.32;
  const lidBody = rbox(W, 210, 6, 6, alu, { y: 105, z: -3 });
  lid.add(lidBody);
  lid.add(rbox(W - 10, 200, 0.6, 5, M.plasticGlossBlack, { y: 105, z: 0.2 }));
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x020202, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6, envMapIntensity: 0.08 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(296, 185), screenMat);
  screen.position.set(0, 108, 0.6);
  screen.userData.keep = true;
  lid.add(screen);
  // webcam
  lid.add(cylZ(1.4, 0.4, M.plasticBlack, { y: 205, z: 0.6 }, 12));
  g.add(lid);
  // USB-A port on the left side
  g.add(box(1, 5, 12, M.plasticBlack, { x: -W / 2 - 0.3, y: 7, z: -20 }));
  return { group: g, screen, screenMat, lid };
}

// ---------------------------------------------------------------------------
function rulerTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 52;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '600 22px Inter, Arial';
  for (let mm = 0; mm <= 400; mm += 2) {
    const x = (mm / 400) * (c.width - 8) + 4;
    const h = mm % 10 === 0 ? 26 : 12;
    ctx.fillRect(x - 1, 0, 2, h);
    if (mm % 50 === 0) ctx.fillText(String(mm), x + 3, 48);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
