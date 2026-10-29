import * as THREE from 'three';
import {
  box, rbox, cyl, cylX, cylZ, group, mesh, extrude, extrusion, roundedRectShape, circlePath, capScrew, buttonHead,
  stepper, axialFan, beltStrand, beltWrap, gt2Pulley, leadScrew, tube, textPlane, mergeStatic, chamferRectShape, place
} from '../../core/parts.js';

// ---------------------------------------------------------------------------
// Original Prusa MK4S – procedural model (mm). Device origin: bench surface,
// centre of the printer footprint. +X right, +Y up, +Z towards the viewer.
// ---------------------------------------------------------------------------

export const GEO = {
  X0: -125, // device x of printer X=0
  PRINT_Y: 80.6, // device y of the sheet surface (printer Z=0)
  Z_NOZ: 32, // device z of the nozzle
  FRAME_Z: -62,
  ZROD_X: 168,
  ZSCREW_X: 190,
  ZROD_Z: -32,
  XROD_Z: -8,
  BASE_ZMIN: -230,
  BASE_ZMAX: 280,
  FRAME_TOP: 440,
  BED_W: 254,
  BED_D: 241
};

export function buildPrusaModel(M) {
  const root = group('prusa-mk4s');
  const H = {};
  const matOrange = M.prusaOrange;
  const matBlackPrint = M.galaxyBlack;

  // ======================= Static frame ===================================
  const frame = group('frame');

  // Y-axis aluminium extrusions (2040 lying flat)
  const baseLen = GEO.BASE_ZMAX - GEO.BASE_ZMIN;
  const baseZc = (GEO.BASE_ZMAX + GEO.BASE_ZMIN) / 2;
  for (const sx of [-1, 1]) {
    const ex = extrusion(40, 20, baseLen, M.blackAnodized, { x: sx * 128, y: 28, z: baseZc });
    frame.add(ex);
    // rubber feet
    for (const z of [GEO.BASE_ZMIN + 30, GEO.BASE_ZMAX - 30]) {
      frame.add(cyl(13, 14, M.rubber, { x: sx * 128, y: 7, z }, 24));
      frame.add(cyl(9, 4, M.blackAnodized, { x: sx * 128, y: 16, z }, 16));
    }
  }

  // Front and rear plates (black anodized aluminium, 6 mm)
  const plateShape = roundedRectShape(300, 64, 6);
  plateShape.holes.push(roundedRectHole(70, 22, 4, 0, -2));
  const frontPlate = extrude(plateShape, 6, M.powderBlack, { x: 0, y: 44, z: GEO.BASE_ZMAX + 3 });
  const rearPlate = extrude(plateShape, 6, M.powderBlack, { x: 0, y: 44, z: GEO.BASE_ZMIN - 3 });
  frame.add(frontPlate, rearPlate);
  for (const z of [GEO.BASE_ZMAX + 6.2, GEO.BASE_ZMIN - 6.2]) {
    for (const sx of [-1, 1]) {
      for (const y of [32, 58]) {
        frame.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 128 + (y > 40 ? 10 : -10), y, z: z > 0 ? z : z, rx: z > 0 ? Math.PI / 2 : -Math.PI / 2 }));
      }
    }
  }

  // Y smooth rods + printed holders
  for (const sx of [-1, 1]) {
    const rod = cylZ(4, baseLen - 10, M.chrome, { x: sx * 82, y: 58, z: baseZc }, 20);
    frame.add(rod);
    for (const z of [GEO.BASE_ZMIN + 12, GEO.BASE_ZMAX - 12]) {
      frame.add(rbox(26, 30, 18, 3, matOrange, { x: sx * 82, y: 52, z }));
      frame.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 82, y: 67, z }));
    }
  }

  // Y motor (rear) + Y idler (front)
  const ymotor = stepper(M, { length: 34 });
  ymotor.rotation.set(0, 0, -Math.PI / 2);
  ymotor.position.set(-28, 46, GEO.BASE_ZMIN - 30);
  frame.add(ymotor);
  frame.add(rbox(30, 54, 54, 4, matOrange, { x: -10, y: 46, z: GEO.BASE_ZMIN - 30 }));
  const ypul = gt2Pulley(M, 20, 7, 'x');
  ypul.position.set(0, 46, GEO.BASE_ZMIN - 30);
  frame.add(ypul);
  frame.add(rbox(40, 34, 30, 4, matOrange, { x: 0, y: 46, z: GEO.BASE_ZMAX - 26 }));
  frame.add(cylX(6.5, 10, M.steel, { x: 0, y: 46, z: GEO.BASE_ZMAX - 26 }, 20));

  // ---- Z frame (vertical aluminium plate with window) ----
  const fw = 430;
  const fShape = roundedRectShape(fw, GEO.FRAME_TOP - 30, 10, 0, (GEO.FRAME_TOP + 30) / 2);
  const win = new THREE.Path();
  {
    const x0 = -158;
    const x1 = 158;
    const y0 = 46;
    const y1 = 300;
    const r = 14;
    win.moveTo(x0 + r, y0);
    win.lineTo(x1 - r, y0);
    win.quadraticCurveTo(x1, y0, x1, y0 + r);
    win.lineTo(x1, y1 - r);
    win.quadraticCurveTo(x1, y1, x1 - r, y1);
    win.lineTo(x0 + r, y1);
    win.quadraticCurveTo(x0, y1, x0, y1 - r);
    win.lineTo(x0, y0 + r);
    win.quadraticCurveTo(x0, y0, x0 + r, y0);
  }
  fShape.holes.push(win);
  // lightening slots on the top bar
  for (const x of [-110, 0, 110]) fShape.holes.push(roundedRectHole(70, 22, 8, x, 350));
  const zframe = extrude(fShape, 6, M.powderBlack, { z: GEO.FRAME_Z }, { curveSegments: 6 });
  frame.add(zframe);
  // frame mounting brackets to extrusions
  for (const sx of [-1, 1]) {
    frame.add(rbox(40, 20, 50, 3, M.blackAnodized, { x: sx * 128, y: 48, z: GEO.FRAME_Z + 22 }));
    frame.add(rbox(40, 20, 50, 3, M.blackAnodized, { x: sx * 128, y: 48, z: GEO.FRAME_Z - 22 }));
  }
  // engraved model text on the frame top bar
  const frameText = textPlane('ORIGINAL PRUSA MK4S', { w: 150, h: 11, color: '#d9d9d9', font: '700 70px Inter, Arial, sans-serif', px: 1024 });
  frameText.position.set(0, GEO.FRAME_TOP - 22, GEO.FRAME_Z + 3.1);
  frame.add(frameText);

  // ---- Z axis: motors, smooth rods, top/bottom printed parts ----
  for (const sx of [-1, 1]) {
    const zm = stepper(M, { length: 40, shaftLen: 2 });
    zm.position.set(sx * GEO.ZSCREW_X, 84, GEO.ZROD_Z);
    frame.add(zm);
    // Z bottom printed part
    frame.add(rbox(66, 18, 60, 4, matOrange, { x: sx * 180, y: 93, z: GEO.ZROD_Z - 4 }));
    frame.add(rbox(16, 60, 30, 3, matOrange, { x: sx * 180, y: 70, z: GEO.FRAME_Z + 14 }));
    // smooth rod
    const rodLen = GEO.FRAME_TOP - 8 - 93;
    frame.add(cyl(4, rodLen, M.chrome, { x: sx * GEO.ZROD_X, y: 93 + rodLen / 2, z: GEO.ZROD_Z }, 20));
    // Z top
    frame.add(rbox(60, 22, 52, 4, matOrange, { x: sx * 180, y: GEO.FRAME_TOP - 10, z: GEO.ZROD_Z - 6 }));
    frame.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 172, y: GEO.FRAME_TOP + 1, z: GEO.ZROD_Z - 20 }));
    frame.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 192, y: GEO.FRAME_TOP + 1, z: GEO.ZROD_Z - 20 }));
    // screws on frame
    for (const y of [70, 120, GEO.FRAME_TOP - 40]) frame.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 200, y, z: GEO.FRAME_Z + 3, rx: Math.PI / 2 }));
  }

  // ---- PSU (right rear) with rocker switch ----
  const psu = group('psu', { x: 186, y: 150, z: GEO.FRAME_Z - 62 });
  psu.add(rbox(48, 196, 110, 3, M.powderBlack, {}));
  for (let i = 0; i < 14; i++) psu.add(box(1.2, 4, 80, M.plasticBlack, { x: 24.3, y: -70 + i * 10, z: 5 }));
  const psuLabel = textPlane('24V ⎓ 10A  240W', { w: 60, h: 8, color: '#bdbdbd', font: '600 60px Inter, Arial', px: 512 });
  psuLabel.position.set(24.6, 70, 0);
  psuLabel.rotation.y = Math.PI / 2;
  psu.add(psuLabel);
  // IEC socket
  psu.add(rbox(4, 24, 30, 2, M.plasticBlack, { x: 25, y: -78, z: -28 }));
  frame.add(psu);

  const swGroup = group('power-switch', { x: 186 + 25.5, y: 150 - 78, z: GEO.FRAME_Z - 62 + 18 });
  swGroup.add(rbox(4, 22, 16, 1.5, M.plasticBlack, {}));
  const rocker = group('rocker');
  const rockerMesh = rbox(5, 18, 12, 1.2, M.plasticGlossBlack, { x: 2 });
  rocker.add(rockerMesh);
  const rockerMark = box(0.3, 4, 1.2, M.plasticWhite, { x: 4.6, y: 4 });
  rocker.add(rockerMark);
  swGroup.add(rocker);
  rocker.userData.keep = true;
  swGroup.userData.keep = true;
  H.powerSwitch = swGroup;
  H.rocker = rocker;

  // ---- xBuddy electronics box (left rear) ----
  const ebox = group('xbuddy', { x: -186, y: 170, z: GEO.FRAME_Z - 40 });
  ebox.add(rbox(44, 170, 66, 4, matBlackPrint, {}));
  for (let i = 0; i < 8; i++) ebox.add(box(46, 2.4, 50, M.plasticBlack, { y: -60 + i * 16, z: 4 }));
  ebox.add(rbox(20, 20, 20, 3, matOrange, { y: 92, z: 10 }));
  frame.add(ebox);

  // ---- Spool holder on top of the frame ----
  const holder = group('spool-holder', { y: GEO.FRAME_TOP, z: GEO.FRAME_Z });
  holder.add(rbox(60, 18, 34, 4, matBlackPrint, { y: 6 }));
  holder.add(rbox(22, 98, 16, 4, matBlackPrint, { y: 56, z: 0, x: 0 }));
  holder.add(cylX(10, 130, matBlackPrint, { y: 104 }, 24));
  holder.add(cylX(14, 6, matBlackPrint, { x: 62, y: 104 }, 24));
  frame.add(holder);

  // ---- xLCD module (front, left) ----
  const lcd = group('xlcd', { x: -78, y: 40, z: GEO.BASE_ZMAX + 30 });
  lcd.rotation.x = -0.52;
  const lcdHousing = rbox(176, 74, 26, 5, matBlackPrint, { y: 0, z: -4 });
  lcd.add(lcdHousing);
  const bezel = rbox(98, 66, 2, 2, M.plasticGlossBlack, { x: -30, y: 1, z: 9.5 });
  lcd.add(bezel);
  // bracket to the frame
  lcd.add(rbox(150, 12, 40, 3, matBlackPrint, { y: -30, z: -26 }));
  // logo stripe
  const lcdText = textPlane('Original Prusa', { w: 44, h: 7, color: '#f0612a', font: '700 64px Inter, Arial', px: 512 });
  lcdText.position.set(55, 26, 9.2);
  lcd.add(lcdText);
  // the actual screen (texture provided by firmware UI)
  const screenGeo = new THREE.PlaneGeometry(76.8, 51.2);
  // matte anti-glare TFT surface
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x030303,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.2
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(-30, 1, 10.6);
  screen.userData.keep = true;
  lcd.add(screen);
  H.screen = screen;
  H.screenMat = screenMat;

  // rotary knob (orange cap)
  const knob = group('knob', { x: 52, y: -2, z: 9 });
  knob.rotation.x = Math.PI / 2;
  const knobBody = new THREE.Group();
  knobBody.add(cyl(13, 15, matOrange, { y: 7.5 }, 40));
  knobBody.add(cyl(13.4, 9, M.rubber, { y: 6 }, 40));
  // knurl ribs
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    knobBody.add(box(1.3, 8.6, 1.3, M.rubber, { x: Math.cos(a) * 13.5, y: 6, z: Math.sin(a) * 13.5, ry: -a }));
  }
  knobBody.add(cyl(10, 1, M.galaxyBlack, { y: 15.2 }, 32));
  knobBody.add(box(1.5, 1.2, 7, M.plasticWhite, { y: 15.4, z: -6 }));
  knob.add(knobBody);
  knob.userData.keep = true;
  lcd.add(knob);
  H.knob = knob;
  H.knobBody = knobBody;
  // reset button
  const reset = group('reset', { x: 74, y: -26, z: 9 });
  reset.add(cyl(4, 1.5, M.plasticGrey, { rx: Math.PI / 2 }, 20));
  const resetCap = cyl(2.6, 3, M.plasticBlack, { rx: Math.PI / 2, z: 1.2 }, 16);
  reset.add(resetCap);
  reset.userData.keep = true;
  lcd.add(reset);
  H.resetButton = reset;
  // USB port on the right side
  const usbPort = group('usb-port', { x: 88.4, y: -14, z: -2 });
  usbPort.add(box(1, 7, 14.5, M.zinc, {}));
  usbPort.add(box(1.2, 5, 12, M.plasticBlack, { x: 0.2 }));
  usbPort.userData.keep = true;
  lcd.add(usbPort);
  H.usbPort = usbPort;
  // USB stick (inserted state); moved by the device logic
  const stick = group('usb-stick');
  stick.add(box(14.5, 6.4, 12.2, M.zinc, { x: 6 }));
  stick.add(rbox(36, 9, 19, 3, M.plasticGlossBlack, { x: 30 }));
  const stickLabel = textPlane('USB', { w: 14, h: 5, color: '#fa6831', font: '800 64px Inter, Arial', px: 256 });
  stickLabel.position.set(32, 4.6, 0);
  stickLabel.rotation.x = -Math.PI / 2;
  stick.add(stickLabel);
  stick.userData.keep = true;
  lcd.add(stick);
  stick.position.set(88.4, -14, -2);
  H.usbStick = stick;
  H.lcd = lcd;
  lcd.userData.keep = true;
  frame.add(lcd);

  // ---- Cables (static part) ----
  frame.add(tube([new THREE.Vector3(-128, 38, 270), new THREE.Vector3(-110, 30, 280), new THREE.Vector3(-90, 22, 292)], 3, M.wireBlack, 12, 6));
  frame.add(tube([new THREE.Vector3(186, 60, -95), new THREE.Vector3(150, 30, -140), new THREE.Vector3(60, 12, -200), new THREE.Vector3(-150, 14, -150), new THREE.Vector3(-186, 80, -100)], 3.2, M.sleeve, 40, 8));

  // ======================= Y bed (moves along Z) ===========================
  const bed = group('bed');
  bed.userData.keep = true;
  const bedStatic = group('bed-static');
  // Y carriage plate (local origin = print origin X0,Y0 on sheet surface)
  const cxBed = 125;
  const czBed = -102;
  bedStatic.add(rbox(232, 3, 230, 6, M.blackAnodized, { x: cxBed, y: -14, z: czBed }));
  // bearings on Y rods (LM8UU)
  for (const [sx, z] of [[-1, czBed - 70], [-1, czBed + 70], [1, czBed]]) {
    const bx = cxBed + sx * 82 + 125 + GEO.X0;
    bedStatic.add(cylZ(7.5, 24, M.steel, { x: bx, y: 58 - GEO.PRINT_Y, z }, 24));
    bedStatic.add(rbox(24, 14, 30, 3, matOrange, { x: bx, y: 58 - GEO.PRINT_Y + 9, z }));
  }
  // belt clamp
  bedStatic.add(rbox(22, 14, 40, 3, matOrange, { x: cxBed - 125 - GEO.X0, y: 46 - GEO.PRINT_Y + 4, z: czBed }));
  // heatbed spacers + heatbed PCB
  for (const x of [cxBed - 110, cxBed, cxBed + 110]) {
    for (const z of [czBed - 105, czBed, czBed + 105]) {
      bedStatic.add(cyl(3.2, 9, M.zinc, { x, y: -8, z }, 12));
    }
  }
  const heatbedMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.5, clearcoat: 0.3 });
  bedStatic.add(rbox(GEO.BED_W, 3.2, GEO.BED_D, 3, heatbedMat, { x: cxBed, y: -2.2, z: czBed }));
  // alignment pins at the back
  for (const x of [cxBed - 100, cxBed + 100]) bedStatic.add(cyl(2, 6, M.steel, { x, y: 0.5, z: czBed - GEO.BED_D / 2 + 3 }, 12));
  // heatbed cable at the back
  bedStatic.add(tube([new THREE.Vector3(cxBed + 90, -6, czBed - 118), new THREE.Vector3(cxBed + 95, -25, czBed - 150), new THREE.Vector3(cxBed + 70, -50, czBed - 200)], 3.5, M.sleeve, 16, 8));
  // MK52 silkscreen markings
  const silk = textPlane('MK52   24V', { w: 50, h: 6, color: '#bbbbbb', font: '600 60px Inter, Arial', px: 512 });
  silk.position.set(cxBed, -0.5, czBed + GEO.BED_D / 2 - 6);
  silk.rotation.x = -Math.PI / 2;
  bedStatic.add(silk);
  mergeStatic(bedStatic);
  bed.add(bedStatic);

  // Spring steel sheet (removable)
  const sheet = group('sheet');
  sheet.userData.keep = true;
  const pei = M.peiTextures;
  for (const t of [pei.map, pei.normalMap, pei.roughnessMap]) t.repeat.set(5, 5);
  const sheetMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: pei.map,
    normalMap: pei.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: pei.roughnessMap,
    roughness: 1,
    metalness: 0.15,
    clearcoat: 0.05
  });
  const sheetShape = new THREE.Shape();
  {
    const w = GEO.BED_W;
    const d = GEO.BED_D;
    const r = 6;
    // with two handle tabs at the front and notches at the back
    sheetShape.moveTo(-w / 2 + r, -d / 2);
    sheetShape.lineTo(-w / 2 + 40, -d / 2);
    sheetShape.lineTo(-w / 2 + 44, -d / 2 - 9);
    sheetShape.lineTo(-w / 2 + 70, -d / 2 - 9);
    sheetShape.lineTo(-w / 2 + 74, -d / 2);
    sheetShape.lineTo(w / 2 - 74, -d / 2);
    sheetShape.lineTo(w / 2 - 70, -d / 2 - 9);
    sheetShape.lineTo(w / 2 - 44, -d / 2 - 9);
    sheetShape.lineTo(w / 2 - 40, -d / 2);
    sheetShape.lineTo(w / 2 - r, -d / 2);
    sheetShape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    sheetShape.lineTo(w / 2, d / 2 - r);
    sheetShape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    sheetShape.lineTo(100 + 4, d / 2);
    sheetShape.lineTo(100 + 4, d / 2 - 6);
    sheetShape.lineTo(100 - 4, d / 2 - 6);
    sheetShape.lineTo(100 - 4, d / 2);
    sheetShape.lineTo(-100 + 4, d / 2);
    sheetShape.lineTo(-100 + 4, d / 2 - 6);
    sheetShape.lineTo(-100 - 4, d / 2 - 6);
    sheetShape.lineTo(-100 - 4, d / 2);
    sheetShape.lineTo(-w / 2 + r, d / 2);
    sheetShape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    sheetShape.lineTo(-w / 2, -d / 2 + r);
    sheetShape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  }
  const sheetGeo = new THREE.ExtrudeGeometry(sheetShape, { depth: 0.6, bevelEnabled: false, curveSegments: 6 });
  // planar UVs (ExtrudeGeometry already uses x/y as UV) – scale to 0..1
  const uv = sheetGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / GEO.BED_W + 0.5, uv.getY(i) / GEO.BED_D + 0.5);
  sheetGeo.rotateX(-Math.PI / 2);
  sheetGeo.translate(0, -0.6, 0);
  const sheetMesh = new THREE.Mesh(sheetGeo, sheetMat);
  sheetMesh.castShadow = true;
  sheetMesh.receiveShadow = true;
  sheetMesh.position.set(0, 0, 0);
  // the extrusion went from y=0 down to y=-0.6 after rotation -> top at 0
  sheet.add(sheetMesh);
  sheet.position.set(cxBed, 0, czBed);
  H.sheetMesh = sheetMesh;
  // anchor for printed parts (print origin relative to sheet)
  const printAnchor = new THREE.Group();
  printAnchor.position.set(-cxBed, 0, -czBed);
  sheet.add(printAnchor);
  H.printAnchor = printAnchor;
  bed.add(sheet);
  H.sheet = sheet;
  H.bed = bed;
  root.add(bed);

  // Y belt (static strands, texture animates)
  const yBeltLen = Math.abs(GEO.BASE_ZMIN - 30 - (GEO.BASE_ZMAX - 26));
  const yBeltTop = beltStrand(M, yBeltLen, 6, 1.4);
  yBeltTop.rotation.y = Math.PI / 2;
  yBeltTop.position.set(0, 46 + 6.4 + 0.7, (GEO.BASE_ZMIN - 30 + GEO.BASE_ZMAX - 26) / 2);
  const yBeltBot = beltStrand(M, yBeltLen, 6, 1.4);
  yBeltBot.rotation.y = Math.PI / 2;
  yBeltBot.position.set(0, 46 - 6.4 - 0.7, yBeltTop.position.z);
  root.add(yBeltTop, yBeltBot);
  H.yBelts = [yBeltTop.userData.beltTex, yBeltBot.userData.beltTex];

  // ======================= Z gantry (moves along Y) ========================
  const gantry = group('gantry');
  gantry.userData.keep = true;
  const gStatic = group('gantry-static');
  // local y=0 corresponds to nozzle tip height
  const xRodY0 = 56; // lower X rod above nozzle tip
  const xRodY1 = xRodY0 + 45;
  for (const sx of [-1, 1]) {
    // X-end body
    const xe = group('xend', { x: sx * 178 });
    xe.add(rbox(58, 76, 52, 5, matOrange, { y: xRodY0 + 22, z: -18 }));
    xe.add(rbox(32, 12, 40, 3, matOrange, { x: sx * 14, y: xRodY0 + 66, z: -24 }));
    // bearing housings
    xe.add(cyl(8.5, 70, M.steel, { x: sx * (GEO.ZROD_X - 178), y: xRodY0 + 22, z: GEO.ZROD_Z }, 20));
    // lead screw nut
    xe.add(cyl(11, 8, M.brass, { x: sx * (GEO.ZSCREW_X - 178), y: xRodY0 - 18, z: GEO.ZROD_Z }, 24));
    xe.add(cyl(5, 14, M.brass, { x: sx * (GEO.ZSCREW_X - 178), y: xRodY0 - 10, z: GEO.ZROD_Z }, 16));
    for (const y of [xRodY0 + 2, xRodY0 + 40]) xe.add(capScrew(3, M.blackOxide, M.rubber, { x: sx * 14, y, z: 8.5, rx: Math.PI / 2 }));
    gStatic.add(xe);
  }
  // X smooth rods
  for (const y of [xRodY0, xRodY1]) gStatic.add(cylX(4, 372, M.chrome, { y, z: GEO.XROD_Z }, 20));
  // X motor on the left X-end
  const xmotor = stepper(M, { length: 34 });
  xmotor.rotation.set(Math.PI / 2, 0, 0);
  xmotor.position.set(-178, xRodY0 + 22, -50);
  gStatic.add(xmotor);
  const xpul = gt2Pulley(M, 16, 7, 'z');
  xpul.position.set(-178, xRodY0 + 22, -30 + 18);
  gStatic.add(xpul);
  // idler on the right
  gStatic.add(cylZ(6.5, 9, M.steel, { x: 178, y: xRodY0 + 22, z: -12 }, 20));
  // X belt strands
  const xBeltLen = 356;
  const pr = 5.1;
  const xBeltTop = beltStrand(M, xBeltLen, 6, 1.4);
  xBeltTop.position.set(0, xRodY0 + 22 + pr + 0.7, -12);
  const xBeltBot = beltStrand(M, xBeltLen, 6, 1.4);
  xBeltBot.position.set(0, xRodY0 + 22 - pr - 0.7, -12);
  xBeltTop.userData.keep = true;
  xBeltBot.userData.keep = true;
  gStatic.add(xBeltTop, xBeltBot);
  const wl = beltWrap(M, pr, -1);
  wl.position.set(-178, xRodY0 + 22, -12);
  const wr = beltWrap(M, pr, 1);
  wr.position.set(178, xRodY0 + 22, -12);
  gStatic.add(wl, wr);
  H.xBelts = [xBeltTop.userData.beltTex, xBeltBot.userData.beltTex];
  mergeStatic(gStatic);
  gantry.add(gStatic);

  // Lead screws (rotate, not part of gantry)
  H.leadScrews = [];
  for (const sx of [-1, 1]) {
    const lsLen = GEO.FRAME_TOP - 12 - 88;
    const ls = leadScrew(M, lsLen, 8, 2);
    ls.position.set(sx * GEO.ZSCREW_X, 88 + lsLen / 2, GEO.ZROD_Z);
    ls.userData.keep = true;
    root.add(ls);
    H.leadScrews.push(ls);
  }

  // ======================= X carriage + Nextruder ==========================
  const carriage = group('carriage');
  carriage.userData.keep = true;
  const cStatic = group('carriage-static');
  // carriage block riding on X rods
  cStatic.add(rbox(50, 70, 28, 5, matBlackPrint, { y: xRodY0 + 22, z: GEO.XROD_Z + 2 }));
  for (const y of [xRodY0, xRodY1]) cStatic.add(cylX(7.6, 46, M.steel, { y, z: GEO.XROD_Z }, 20));
  // Nextruder main body
  const nz = GEO.Z_NOZ; // nozzle z
  cStatic.add(rbox(48, 70, 44, 6, matBlackPrint, { y: 64, z: nz - 4 }));
  // gearbox housing (round, front)
  cStatic.add(cylZ(19, 22, matOrange, { x: 0, y: 92, z: nz + 12 }, 40));
  cStatic.add(cylZ(15, 2, matBlackPrint, { x: 0, y: 92, z: nz + 23.5 }, 40));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    cStatic.add(buttonHead(2.2, M.blackOxide, M.rubber, { x: Math.cos(a) * 12, y: 92 + Math.sin(a) * 12, z: nz + 23.2, rx: Math.PI / 2 }));
  }
  // idler lever on the right side
  cStatic.add(rbox(10, 46, 26, 4, matOrange, { x: 27, y: 86, z: nz + 4 }));
  cStatic.add(cylX(3.2, 8, M.zinc, { x: 32, y: 104, z: nz + 4 }, 16));
  // pancake motor (rear top)
  cStatic.add(rbox(36, 36, 22, 4, M.blackAnodized, { y: 100, z: nz - 30 }));
  // front fan shroud (orange) with print fan duct
  cStatic.add(rbox(50, 44, 18, 6, matOrange, { y: 48, z: nz + 16 }));
  const grillMat = M.plasticBlack;
  for (let i = 0; i < 5; i++) cStatic.add(box(34, 2.2, 1.5, grillMat, { y: 36 + i * 6, z: nz + 25.2 }));
  // MK4S 360° nozzle duct ring
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, 19, 0, Math.PI * 2, false);
  ringShape.holes.push(circlePath(13.5, 0, 0, true));
  const ring = extrude(ringShape, 6, matBlackPrint, { y: 12, z: nz, rx: Math.PI / 2 }, { curveSegments: 32 });
  cStatic.add(ring);
  cStatic.add(rbox(14, 22, 8, 3, matBlackPrint, { x: 18, y: 24, z: nz + 8 }));
  // hotend fan on the left side (40x40)
  const hf = axialFan(M, 40, 10);
  hf.group.rotation.y = -Math.PI / 2;
  hf.group.position.set(-29, 54, nz - 4);
  hf.group.userData.keep = true;
  carriage.add(hf.group);
  H.hotendFanRotor = hf.rotor;
  // print fan (blower) inside right side – visible intake
  const pf = axialFan(M, 34, 6);
  pf.group.rotation.y = Math.PI / 2;
  pf.group.position.set(27, 52, nz - 6);
  pf.group.userData.keep = true;
  carriage.add(pf.group);
  H.printFanRotor = pf.rotor;
  // heatsink + heater block + silicone sock + nozzle
  for (let i = 0; i < 6; i++) cStatic.add(cyl(9, 1.4, M.aluminiumRaw, { y: 26 + i * 3.4, z: nz }, 24));
  cStatic.add(rbox(16, 10, 20, 3, M.silicone, { y: 9.5, z: nz + 2 }));
  cStatic.add(cyl(4.2, 3, M.brass, { y: 4, z: nz }, 6));
  cStatic.add(cyl(3.2, 2.2, M.brass, { y: 1.6, z: nz }, 16, 1.2));
  cStatic.add(cyl(0.75, 0.6, M.brass, { y: 0.3, z: nz }, 12));
  // filament sensor + inlet on top
  cStatic.add(rbox(24, 14, 22, 3, matBlackPrint, { y: 106, z: nz - 4 }));
  cStatic.add(cyl(3, 8, M.zinc, { y: 117, z: nz - 4 }, 16));
  cStatic.add(rbox(4, 10, 14, 1.5, matOrange, { x: 10, y: 110, z: nz - 4 }));
  // loadcell label
  const ntext = textPlane('NEXTRUDER', { w: 36, h: 5, color: '#ffffff', font: '700 64px Inter, Arial', px: 512 });
  ntext.position.set(0, 67, nz + 18.3);
  cStatic.add(ntext);
  mergeStatic(cStatic);
  carriage.add(cStatic);
  // nozzle tip anchor
  const tip = new THREE.Object3D();
  tip.position.set(0, 0, nz);
  carriage.add(tip);
  H.nozzleTip = tip;
  // light from hot nozzle (very subtle glow)
  gantry.add(carriage);
  H.carriage = carriage;
  H.gantry = gantry;
  H.xRodY0 = xRodY0;
  root.add(gantry);

  // ======================= Spool =========================================
  const spool = group('spool', { x: 0, y: GEO.FRAME_TOP + 104, z: GEO.FRAME_Z });
  spool.userData.keep = true;
  const spoolInner = new THREE.Group();
  const flangeShape = new THREE.Shape();
  flangeShape.absarc(0, 0, 100, 0, Math.PI * 2, false);
  flangeShape.holes.push(circlePath(26.5, 0, 0, true));
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.12;
    const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.12;
    const hp = new THREE.Path();
    hp.absarc(0, 0, 88, a1, a0, true);
    hp.absarc(0, 0, 42, a0, a1, false);
    flangeShape.holes.push(hp);
  }
  const flMat = M.plasticGlossBlack;
  const fl1 = extrude(flangeShape, 3, flMat, { x: -33, ry: Math.PI / 2 }, { curveSegments: 48 });
  const fl2 = extrude(flangeShape, 3, flMat, { x: 33, ry: Math.PI / 2 }, { curveSegments: 48 });
  spoolInner.add(fl1, fl2);
  spoolInner.add(cylX(42, 64, flMat, {}, 48));
  const filMat = new THREE.MeshPhysicalMaterial({ color: 0x18191c, roughness: 0.38, clearcoat: 0.3 });
  const windTex = makeWindingTexture();
  filMat.normalMap = windTex;
  filMat.normalScale = new THREE.Vector2(1.2, 1.2);
  const windings = cylX(85, 63, filMat, {}, 96);
  spoolInner.add(windings);
  H.spoolWindings = windings;
  H.filamentMat = filMat;
  spool.add(spoolInner);
  H.spool = spool;
  H.spoolInner = spoolInner;
  root.add(spool);

  // Filament path (dynamic tube): spool -> sensor inlet
  H.filamentTubeMat = filMat;

  // merge the static frame for performance (keeps interactive children)
  mergeStatic(frame);
  root.add(frame);
  H.frame = frame;
  return { root, H };
}

function roundedRectHole(w, h, r, cx, cy) {
  const p = new THREE.Path();
  const x = cx - w / 2;
  const y = cy - h / 2;
  // clockwise for holes
  p.moveTo(x + r, y);
  p.quadraticCurveTo(x, y, x, y + r);
  p.lineTo(x, y + h - r);
  p.quadraticCurveTo(x, y + h, x + r, y + h);
  p.lineTo(x + w - r, y + h);
  p.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  p.lineTo(x + w, y + r);
  p.quadraticCurveTo(x + w, y, x + w - r, y);
  p.lineTo(x + r, y);
  return p;
}

function makeWindingTexture() {
  const W = 8;
  const Hh = 128;
  const data = new Uint8Array(W * Hh * 4);
  for (let y = 0; y < Hh; y++) {
    const f = (y % 8) / 8;
    const nY = Math.cos(f * Math.PI * 2);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = 128;
      data[i + 1] = 128 + nY * 90;
      data[i + 2] = 230;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, Hh);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(36, 4);
  t.needsUpdate = true;
  return t;
}
