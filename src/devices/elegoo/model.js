import * as THREE from 'three';
import { box, rbox, cyl, cylX, cylZ, group, extrude, extrusion, roundedRectShape, roundedRectPath, capScrew, buttonHead, stepper, leadScrew, textPlane, mergeStatic, tube } from '../../core/parts.js';
import { brushedTextures, plasticNormal } from '../../core/textures.js';

// ---------------------------------------------------------------------------
// ELEGOO Mars 4 (9K) MSLA resin printer. Units mm, origin = bench surface
// at the centre of the base footprint.
//   build area 153.36 x 77.76 mm (x by z), Z height 175 mm
// ---------------------------------------------------------------------------

export const EGEO = {
  BASE_H: 120,
  LCD_W: 153.36,
  LCD_D: 77.76,
  LCD_Z: 25, // centre of the LCD (device z)
  FEP_Y: 121.6, // vat floor surface (FEP touching the LCD glass)
  TOWER_Z: -82,
  MAX_Z: 175,
  COVER_H: 330
};

export function buildMarsModel(M) {
  const root = group('mars4');
  const H = {};
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.42, metalness: 0.25, clearcoat: 0.35, clearcoatRoughness: 0.35, normalMap: plasticNormal(31, 0.4, 64), normalScale: new THREE.Vector2(0.25, 0.25) });
  const trimMat = new THREE.MeshPhysicalMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.6 });
  const brushed = brushedTextures(77, { streak: true });
  brushed.normalMap.repeat.set(3, 1);
  const alu = new THREE.MeshPhysicalMaterial({ color: 0xc2c6cb, metalness: 1, roughness: 0.3, normalMap: brushed.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughnessMap: brushed.roughnessMap });

  // ======================= Base ===========================================
  const base = group('base');
  base.add(rbox(260, EGEO.BASE_H, 230, 10, bodyMat, { y: EGEO.BASE_H / 2 }));
  // top plate
  base.add(rbox(250, 3, 220, 6, trimMat, { y: EGEO.BASE_H + 0.5 }));
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.add(cyl(10, 4, M.rubber, { x: sx * 110, y: 1, z: sz * 95 }, 20));
  // front logo
  const logo = textPlane('ELEGOO', { w: 60, h: 10, color: '#d8dadd', font: '800 80px Inter, Arial', px: 512 });
  logo.position.set(60, 92, 115.2);
  base.add(logo);
  const model = textPlane('MARS 4  9K', { w: 50, h: 6, color: '#9da2a8', font: '600 60px Inter, Arial', px: 512 });
  model.position.set(60, 78, 115.2);
  base.add(model);
  // LCD glass + bezel (visible when the vat is removed)
  base.add(box(EGEO.LCD_W + 30, 1.2, EGEO.LCD_D + 30, M.plasticGlossBlack, { y: EGEO.BASE_H + 1.4, z: EGEO.LCD_Z }));
  // vat locating rails
  for (const sx of [-1, 1]) base.add(box(6, 4, 150, trimMat, { x: sx * 112, y: EGEO.BASE_H + 3, z: EGEO.LCD_Z }));
  // vents on the sides
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) base.add(box(1.2, 4, 120, M.plasticBlack, { x: sx * 130.2, y: 30 + i * 7, z: 0 }));
  // back: power switch + DC jack
  base.add(cylZ(5.5, 2, M.plasticBlack, { x: 80, y: 40, z: -115.5 }, 20));
  base.userData.keep = false;

  // the mono LCD (shows the layer mask)
  const lcdMat = new THREE.MeshStandardMaterial({ color: 0x050507, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.18, metalness: 0 });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(EGEO.LCD_W, EGEO.LCD_D), lcdMat);
  lcd.rotation.x = -Math.PI / 2;
  lcd.position.set(0, EGEO.BASE_H + 2.05, EGEO.LCD_Z);
  lcd.userData.keep = true;
  root.add(lcd);
  H.lcd = lcd;
  H.lcdMat = lcdMat;

  // touchscreen (front left)
  const tsGroup = group('touch', { x: -62, y: 66, z: 115.2 });
  tsGroup.add(rbox(86, 60, 2, 3, M.plasticGlossBlack, { z: -0.6 }));
  const touchMat = new THREE.MeshLambertMaterial({ color: 0x030303, emissive: 0xffffff, emissiveIntensity: 0 });
  const touch = new THREE.Mesh(new THREE.PlaneGeometry(74, 49.3), touchMat);
  touch.position.z = 0.55;
  touch.userData.keep = true;
  tsGroup.add(touch);
  tsGroup.userData.keep = true;
  root.add(tsGroup);
  H.touch = touch;
  H.touchMat = touchMat;

  // USB port (front right)
  const usb = group('usb', { x: 108, y: 30, z: 115.2 });
  usb.add(box(14.5, 6.5, 1, M.zinc, {}));
  usb.add(box(12, 4.5, 1.2, M.plasticBlack, { z: 0.2 }));
  usb.userData.keep = true;
  root.add(usb);
  H.usbPort = usb;
  const stick = group('usb-stick');
  stick.add(box(12.2, 4.6, 12, M.zinc, { z: -4 }));
  stick.add(rbox(18, 8, 34, 3, new THREE.MeshPhysicalMaterial({ color: 0x8a1c1c, roughness: 0.4, clearcoat: 0.4 }), { z: 17 }));
  stick.userData.keep = true;
  stick.position.set(108, 30, 115.2);
  root.add(stick);
  H.usbStick = stick;

  // power rocker on the back
  const pw = group('power', { x: 100, y: 40, z: -115.2 });
  pw.add(rbox(16, 22, 3, 1.5, M.plasticBlack, {}));
  const rocker = new THREE.Group();
  rocker.add(rbox(11, 17, 5, 1.2, M.plasticGlossBlack, { z: -2 }));
  rocker.add(box(1.2, 4, 0.4, M.plasticWhite, { y: 4, z: -4.6 }));
  pw.add(rocker);
  pw.userData.keep = true;
  root.add(pw);
  H.power = pw;
  H.rocker = rocker;

  mergeStatic(base);
  root.add(base);

  // ======================= Z tower ========================================
  const tower = group('tower');
  const towerTop = EGEO.BASE_H + 318;
  tower.add(extrusion(40, 40, towerTop - EGEO.BASE_H, M.blackAnodized, { x: 0, y: (towerTop + EGEO.BASE_H) / 2, z: EGEO.TOWER_Z, rx: Math.PI / 2 }));
  // linear rail on the front face
  tower.add(box(15, towerTop - EGEO.BASE_H - 20, 9, M.steel, { y: (towerTop + EGEO.BASE_H) / 2, z: EGEO.TOWER_Z + 24 }));
  // top cap with bearing block
  tower.add(rbox(76, 14, 46, 4, bodyMat, { y: towerTop + 2, z: EGEO.TOWER_Z }));
  // bottom block (motor housing inside base)
  tower.add(rbox(76, 20, 44, 6, bodyMat, { y: EGEO.BASE_H + 10, z: EGEO.TOWER_Z }));
  mergeStatic(tower);
  root.add(tower);
  // lead screw (rotates)
  const lsLen = towerTop - EGEO.BASE_H - 26;
  const ls = leadScrew(M, lsLen, 8, 2);
  ls.position.set(30, EGEO.BASE_H + 20 + lsLen / 2, EGEO.TOWER_Z + 6);
  ls.userData.keep = true;
  root.add(ls);
  H.leadScrew = ls;

  // ======================= Z carriage + build plate =======================
  const zc = group('zcarriage');
  zc.userData.keep = true;
  const zs = group('zc-static');
  // carriage block on the rail (sits above the vat even at Z=0)
  zs.add(rbox(80, 60, 22, 5, bodyMat, { y: 40, z: EGEO.TOWER_Z + 36 }));
  zs.add(cyl(9, 12, M.brass, { x: 30, y: 16, z: EGEO.TOWER_Z + 6 }, 20));
  zs.add(rbox(20, 16, 20, 3, bodyMat, { x: 30, y: 16, z: EGEO.TOWER_Z + 16 }));
  // arm reaching forward to the plate
  const armLen = EGEO.LCD_Z - (EGEO.TOWER_Z + 36);
  zs.add(rbox(44, 16, armLen + 10, 4, alu, { y: 22, z: EGEO.TOWER_Z + 36 + armLen / 2 }));
  mergeStatic(zs);
  zc.add(zs);
  // build plate assembly (removable): local origin = plate bottom centre
  const plate = group('plate');
  plate.userData.keep = true;
  const ps = group('plate-static');
  const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.55, roughnessMap: brushedTextures(91, { streak: false }).roughnessMap });
  ps.add(rbox(EGEO.LCD_W + 8, 10, EGEO.LCD_D + 10, 2, plateMat, { y: 5 }));
  // laser engraved grid on the bottom (visible when lifted)
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(EGEO.LCD_W + 6, EGEO.LCD_D + 8), new THREE.MeshStandardMaterial({ map: gridTexture(), metalness: 0.9, roughness: 0.7, transparent: true }));
  grid.rotation.x = Math.PI / 2;
  grid.position.y = -0.05;
  ps.add(grid);
  // pyramid mount + knob
  ps.add(cyl(14, 22, alu, { y: 21 }, 4, 26));
  ps.add(rbox(50, 8, 30, 3, alu, { y: 36 }));
  ps.add(cylZ(9, 24, M.plasticBlack, { y: 40, z: 22 }, 24));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ps.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 18, y: 32, z: sz * 9 }));
  mergeStatic(ps);
  plate.add(ps);
  // anchor for cured part (hangs below plate)
  const partAnchor = new THREE.Group();
  plate.add(partAnchor);
  H.partAnchor = partAnchor;
  plate.position.set(0, -30, EGEO.LCD_Z);
  zc.add(plate);
  H.plate = plate;
  zc.position.set(0, 0, 0);
  root.add(zc);
  H.zc = zc;

  // ======================= Vat =============================================
  const vat = group('vat');
  vat.userData.keep = true;
  const vs = group('vat-static');
  const vatMat = new THREE.MeshPhysicalMaterial({ color: 0x2a2d33, metalness: 0.75, roughness: 0.35 });
  const vatShape = roundedRectShape(214, 150, 10);
  vatShape.holes.push(roundedRectPath(194, 128, 6));
  // wall (extruded ring)
  const ring = extrude(vatShape, 40, vatMat, { rx: -Math.PI / 2, y: 0 }, { centered: false });
  vs.add(ring);
  // flange at the bottom
  const fl = roundedRectShape(236, 150, 10);
  fl.holes.push(roundedRectPath(194, 128, 6));
  vs.add(extrude(fl, 3, vatMat, { rx: -Math.PI / 2, y: 0 }, { centered: false }));
  // thumb screws
  for (const sx of [-1, 1]) {
    vs.add(cyl(8, 10, M.plasticBlack, { x: sx * 110, y: 8, z: 0 }, 16));
    vs.add(cyl(3, 4, M.zinc, { x: sx * 110, y: 1, z: 0 }, 10));
  }
  // MAX fill mark
  const mx = textPlane('MAX ——', { w: 24, h: 5, color: '#e9e9e9', font: '700 60px Inter, Arial', px: 256 });
  mx.position.set(70, 26, 64.1);
  vs.add(mx);
  mergeStatic(vs);
  vat.add(vs);
  // FEP film (slightly reflective translucent)
  const fep = new THREE.Mesh(new THREE.PlaneGeometry(194, 128), new THREE.MeshPhysicalMaterial({ color: 0xe8eef2, transparent: true, opacity: 0.25, roughness: 0.15, metalness: 0, depthWrite: false }));
  fep.rotation.x = -Math.PI / 2;
  fep.position.y = 0.4;
  fep.userData.transparentToPick = true;
  vat.add(fep);
  // resin volume
  const resinMat = new THREE.MeshPhysicalMaterial({ color: 0x6f747b, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.94 });
  const resin = new THREE.Mesh(new THREE.BoxGeometry(192, 1, 126), resinMat);
  resin.position.y = 0.5;
  resin.userData.transparentToPick = true;
  vat.add(resin);
  H.resin = resin;
  H.resinMat = resinMat;
  vat.position.set(0, EGEO.FEP_Y - 0.4, EGEO.LCD_Z);
  root.add(vat);
  H.vat = vat;

  // ======================= UV cover (amber acrylic) ========================
  const cover = group('cover');
  cover.userData.keep = true;
  const coverMat = new THREE.MeshPhysicalMaterial({
    color: 0xffb437,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.2,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
    envMapIntensity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
    emissive: 0xff7a00,
    emissiveIntensity: 0
  });
  const cw = 246;
  const cd = 212;
  const ch = EGEO.COVER_H;
  const t = 3;
  const panels = [
    [cw, ch, t, 0, ch / 2, cd / 2],
    [cw, ch, t, 0, ch / 2, -cd / 2],
    [t, ch, cd, cw / 2, ch / 2, 0],
    [t, ch, cd, -cw / 2, ch / 2, 0],
    [cw, t, cd, 0, ch, 0]
  ];
  for (const [w, hh, d, x, y, z] of panels) {
    const m = box(w, hh, d, coverMat, { x, y, z, cast: false });
    m.renderOrder = 2;
    m.userData.transparentToPick = false;
    cover.add(m);
  }
  // edges (slightly darker, polished)
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xff9d00, roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cover.add(box(4, ch, 4, edgeMat, { x: sx * (cw / 2), y: ch / 2, z: sz * (cd / 2), cast: false }));
  const ctext = textPlane('ELEGOO', { w: 70, h: 11, color: '#ffffff', font: '800 80px Inter, Arial', px: 512 });
  ctext.position.set(0, ch - 40, cd / 2 + 1.8);
  cover.add(ctext);
  mergeStatic(cover);
  cover.position.set(0, EGEO.BASE_H + 1, 0);
  root.add(cover);
  H.cover = cover;
  H.coverMat = coverMat;

  // UV light (lights the plate/resin from below while exposing)
  const uv = new THREE.PointLight(0x7a5cff, 0, 260, 1.4);
  uv.position.set(0, EGEO.BASE_H + 30, EGEO.LCD_Z);
  root.add(uv);
  H.uvLight = uv;

  return { root, H };
}

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(40,42,46,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}
