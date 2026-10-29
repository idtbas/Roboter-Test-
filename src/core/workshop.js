import * as THREE from 'three';
import { woodBlockTextures, concreteTextures, plasterTextures, pegboardTextures } from './textures.js';
import { box, rbox, cyl, group, mesh, mergeStatic, place, extrusion, roundedRectShape, extrude } from './parts.js';

export const BENCH_TOP = 860; // mm, height of the work surface
export const BENCH_Z = -470; // centre of bench depth
export const BENCH_DEPTH = 820;
export const BENCH_W = 3800;
export const WALL_Z = -900;

// Builds the room, the workbench and the lighting. Returns slot positions.
export function buildWorkshop(scene, engine, M, app) {
  const root = group('workshop');
  scene.add(root);

  // ---------------- Room ----------------
  const conc = concreteTextures();
  for (const t of [conc.map, conc.roughnessMap, conc.normalMap]) t.repeat.set(9, 7);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: conc.map,
    roughnessMap: conc.roughnessMap,
    normalMap: conc.normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 1,
    metalness: 0
  });
  const floor = mesh(new THREE.PlaneGeometry(9000, 7000), floorMat, { rx: -Math.PI / 2, y: 0, z: 1600, cast: false });
  floor.userData.noHighlight = true;
  root.add(floor);

  const plaster = plasterTextures();
  plaster.normalMap.repeat.set(10, 4);
  plaster.roughnessMap.repeat.set(10, 4);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xb9b6ae,
    roughness: 1,
    roughnessMap: plaster.roughnessMap,
    normalMap: plaster.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });
  const sideWallMat = wallMat.clone();
  sideWallMat.color = new THREE.Color(0xa9a8a3);
  const backWall = mesh(new THREE.PlaneGeometry(9000, 3000), wallMat, { y: 1500, z: WALL_Z, cast: false });
  root.add(backWall);
  const leftWall = mesh(new THREE.PlaneGeometry(7000, 3000), sideWallMat, { x: -4500, y: 1500, z: 2600, ry: Math.PI / 2, cast: false });
  const rightWall = mesh(new THREE.PlaneGeometry(7000, 3000), sideWallMat, { x: 4500, y: 1500, z: 2600, ry: -Math.PI / 2, cast: false });
  root.add(leftWall, rightWall);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xd8d7d2, roughness: 0.95 });
  root.add(mesh(new THREE.PlaneGeometry(9000, 7000), ceilMat, { rx: Math.PI / 2, y: 3000, z: 2600, cast: false }));
  // skirting board
  root.add(box(9000, 80, 14, new THREE.MeshStandardMaterial({ color: 0x8f8d88, roughness: 0.7 }), { y: 40, z: WALL_Z + 7 }));

  // ---------------- Workbench ----------------
  const wood = woodBlockTextures();
  const top = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: wood.map,
    roughnessMap: wood.roughnessMap,
    normalMap: wood.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 1,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45
  });
  for (const t of [wood.map, wood.roughnessMap, wood.normalMap]) t.repeat.set(3.6, 1);
  const benchTop = box(BENCH_W, 42, BENCH_DEPTH, top, { y: BENCH_TOP - 21, z: BENCH_Z });
  // map UVs of box top so grain runs along X
  root.add(benchTop);
  const bench = group('bench-frame');
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.3, clearcoat: 0.3 });
  const legH = BENCH_TOP - 42;
  for (const x of [-BENCH_W / 2 + 60, -BENCH_W / 6, BENCH_W / 6, BENCH_W / 2 - 60]) {
    for (const z of [BENCH_Z - BENCH_DEPTH / 2 + 50, BENCH_Z + BENCH_DEPTH / 2 - 50]) {
      bench.add(box(50, legH, 50, frameMat, { x, y: legH / 2, z }));
      bench.add(cyl(30, 8, M.rubber, { x, y: 4, z }, 16));
    }
    bench.add(box(40, 40, BENCH_DEPTH - 100, frameMat, { x, y: legH - 20, z: BENCH_Z }));
    bench.add(box(40, 40, BENCH_DEPTH - 100, frameMat, { x, y: 180, z: BENCH_Z }));
  }
  for (const z of [BENCH_Z - BENCH_DEPTH / 2 + 50, BENCH_Z + BENCH_DEPTH / 2 - 50]) {
    bench.add(box(BENCH_W - 120, 60, 40, frameMat, { y: legH - 30, z }));
    bench.add(box(BENCH_W - 120, 40, 40, frameMat, { y: 180, z }));
  }
  // lower shelf board
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x9c8a6c, roughness: 0.8, map: wood.map });
  bench.add(box(BENCH_W - 140, 18, BENCH_DEPTH - 120, shelfMat, { y: 209, z: BENCH_Z }));
  // storage boxes under the bench
  const boxColors = [0x2d5f8a, 0x3a3f45, 0x2d5f8a, 0x7a2d2d, 0x3a3f45];
  boxColors.forEach((c, i) => {
    const bm = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, clearcoat: 0.2 });
    const bx = -1500 + i * 720;
    bench.add(rbox(420, 260, 560, 12, bm, { x: bx, y: 218 + 130, z: BENCH_Z + 10 }));
    bench.add(rbox(440, 24, 580, 8, bm, { x: bx, y: 218 + 270, z: BENCH_Z + 10 }));
  });
  mergeStatic(bench);
  root.add(bench);

  // ---------------- Pegboard & shelf on the wall ----------------
  const peg = pegboardTextures();
  peg.map.repeat.set(3200 / 100, 900 / 100);
  peg.normalMap.repeat.copy(peg.map.repeat);
  const pegMat = new THREE.MeshStandardMaterial({
    map: peg.map,
    normalMap: peg.normalMap,
    roughness: 0.7,
    alphaTest: 0.5,
    side: THREE.DoubleSide
  });
  const pegboard = mesh(new THREE.PlaneGeometry(3200, 900), pegMat, { y: BENCH_TOP + 120 + 450, z: WALL_Z + 22 });
  pegboard.receiveShadow = true;
  root.add(pegboard);
  // pegboard frame
  const pf = group('pegframe');
  const pfm = new THREE.MeshStandardMaterial({ color: 0xe4e2dc, roughness: 0.6 });
  pf.add(box(3240, 20, 30, pfm, { y: BENCH_TOP + 120, z: WALL_Z + 15 }));
  pf.add(box(3240, 20, 30, pfm, { y: BENCH_TOP + 120 + 900, z: WALL_Z + 15 }));
  pf.add(box(20, 920, 30, pfm, { x: -1610, y: BENCH_TOP + 570, z: WALL_Z + 15 }));
  pf.add(box(20, 920, 30, pfm, { x: 1610, y: BENCH_TOP + 570, z: WALL_Z + 15 }));
  addPegTools(pf, M);
  mergeStatic(pf);
  root.add(pf);

  // wall shelf above pegboard
  const shelf = group('shelf');
  const shelfTop = new THREE.MeshPhysicalMaterial({ map: wood.map, roughness: 0.8, color: 0xf0e6d8 });
  shelf.add(box(3000, 24, 260, shelfTop, { y: BENCH_TOP + 1180, z: WALL_Z + 130 }));
  for (const x of [-1300, 0, 1300]) {
    shelf.add(box(30, 200, 8, frameMat, { x, y: BENCH_TOP + 1080, z: WALL_Z + 4 }));
    shelf.add(box(30, 8, 230, frameMat, { x, y: BENCH_TOP + 1164, z: WALL_Z + 120 }));
  }
  mergeStatic(shelf);
  root.add(shelf);

  // ---------------- Ceiling lights ----------------
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6ea, emissiveIntensity: 2.2 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, metalness: 0.2 });
  for (const x of [-1100, 1100]) {
    const lamp = group('lamp', { x, y: 2560, z: -250 });
    lamp.add(box(1500, 40, 180, housingMat, { y: 20 }));
    const diff = box(1460, 4, 150, lampMat, { y: -1, cast: false, receive: false });
    lamp.add(diff);
    for (const sx of [-600, 600]) lamp.add(cyl(1.5, 440, M.steel, { x: sx, y: 240 }, 6));
    root.add(lamp);
    const ral = new THREE.RectAreaLight(0xfff3e4, 2.4, 1460, 150);
    ral.position.set(x, 2556, -250);
    ral.lookAt(x, 0, -250);
    root.add(ral);
  }

  // Key light with soft shadows (acts like the ceiling fixtures)
  const sun = new THREE.DirectionalLight(0xfff4e8, 1.25);
  sun.position.set(-700, 3200, 1400);
  sun.target.position.set(0, BENCH_TOP, BENCH_Z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.userData.shadowSize = 4096;
  sun.shadow.camera.left = -2100;
  sun.shadow.camera.right = 2100;
  sun.shadow.camera.top = 1100;
  sun.shadow.camera.bottom = -900;
  sun.shadow.camera.near = 1500;
  sun.shadow.camera.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  sun.shadow.radius = 3;
  root.add(sun, sun.target);

  // Fill from the front
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
  fill.position.set(900, 1600, 3000);
  fill.target.position.set(0, BENCH_TOP, BENCH_Z);
  root.add(fill, fill.target);

  const hemi = new THREE.HemisphereLight(0xf2efe8, 0x3a3631, 0.25);
  root.add(hemi);

  // ---------------- Workshop manual on the pegboard ----------------
  const manualTex = paperTexture(1000, 1414, 'Werkstatt – Kurzanleitung', [
    { h: 'Umsehen', lines: ['• Linke Maustaste ziehen: drehen · rechte Maustaste: verschieben · Mausrad: zoomen', '• Doppelklick auf ein Gerät oder Teil: hingehen · Esc: zurück zur Übersicht', '• Alles, was beim Überfahren aufleuchtet, kannst du anfassen (anklicken).', '• Tastatur gehört dem zuletzt angeklickten Gerät. M: Ton an/aus.'] },
    { h: 'Zeit', lines: ['• Alles läuft in Echtzeit. Die Uhr an der Lochwand anklicken (oder am Mausrad drehen), um die Zeit schneller laufen zu lassen.'] },
    { h: 'USB-Sticks', lines: ['• Stick anklicken = in die Hand nehmen. Dann in einen USB-Anschluss stecken (Drucker oder Laptop) oder irgendwo ablegen. Esc = zurück.'] },
    { h: 'Original Prusa MK4S (links)', lines: ['• Netzschalter: hinten rechts am Netzteil.', '• Bedienung: Display mit Drehknopf (Mausrad / ziehen, Klick = drücken, oder Pfeiltasten + Enter).', '• Filament wechseln: erst entladen, dann eine Spule im Regal anklicken.'] },
    { h: 'Ortur Laser Master 3 (Mitte)', lines: ['• Netztaster, Schlüssel und Not-Aus: Bedienfeld vorne rechts.', '• Gesteuert wird er am Laptop mit LaserWerk (Verbinden → Home → Rahmen → Start).', '• Material vom Stapel links auflegen. Fokus: Lasermodul anklicken. Schutzbrille liegt vor dem Laser!'] },
    { h: 'ELEGOO Mars 4 (rechts)', lines: ['• Netzschalter hinten. Bedienung über den Touchscreen.', '• Haube abnehmen, Resin aus einer Flasche eingießen, Haube wieder drauf.'] },
    { h: 'Laptop', lines: ['• LaserWerk: Laser steuern · SliceWerk: eigene Modelle für Prusa und Mars slicen · Dateien: auf USB-Stick kopieren.'] }
  ]);
  const manual = new THREE.Mesh(new THREE.PlaneGeometry(210, 297), new THREE.MeshStandardMaterial({ map: manualTex, roughness: 0.85 }));
  manual.position.set(MANUAL.x, MANUAL.y, WALL_Z + 32 + 7.2);
  manual.receiveShadow = true;
  root.add(manual);

  // ---------------- Wall clock = simulation speed ----------------
  const clock = group('clock', { x: -560, y: BENCH_TOP + 760, z: WALL_Z + 34 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(140, 9, 16, 64), new THREE.MeshPhysicalMaterial({ color: 0x1d1e21, roughness: 0.35, clearcoat: 0.5 }));
  clock.add(rim);
  clock.add(cyl(140, 10, new THREE.MeshStandardMaterial({ color: 0x2a2b2e }), { z: -6, rx: Math.PI / 2 }, 64));
  let speedShown = 1;
  const faceMat = new THREE.MeshStandardMaterial({ map: clockFaceTexture(1), roughness: 0.7 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(136, 64), faceMat);
  face.position.z = 0.5;
  clock.add(face);
  clock.add(new THREE.Mesh(new THREE.CircleGeometry(138, 64), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.02, clearcoat: 1 })).translateZ(9));
  const handMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.5 });
  const mkHand = (len, wdt, z, mat = handMat) => {
    const piv = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, 1.5), mat);
    m.position.y = len / 2 - 14;
    m.castShadow = true;
    piv.add(m);
    piv.position.z = z;
    clock.add(piv);
    return piv;
  };
  const hHand = mkHand(80, 9, 2);
  const mHand = mkHand(118, 6, 3.5);
  const sHand = mkHand(126, 2, 5, new THREE.MeshStandardMaterial({ color: 0xd4471b }));
  clock.add(cyl(6, 8, handMat, { z: 6, rx: Math.PI / 2 }, 20));
  root.add(clock);
  if (app) {
    app.interaction.add(clock, {
      onClick: () => {
        app.cycleSpeed(1);
        app.audio.click(clock.getWorldPosition(new THREE.Vector3()), 0.2, 2200, 0.02);
      },
      onWheel: (steps) => {
        app.cycleSpeed(steps < 0 ? 1 : -1);
        app.audio.click(clock.getWorldPosition(new THREE.Vector3()), 0.15, 2600, 0.015);
        return true;
      }
    });
  }
  const t0 = Date.now();

  const views = {
    manual: { pos: new THREE.Vector3(MANUAL.x, MANUAL.y - 6, WALL_Z + 560), target: new THREE.Vector3(MANUAL.x, MANUAL.y - 6, WALL_Z + 30), minDistance: 120 },
    clock: { pos: new THREE.Vector3(-560, BENCH_TOP + 740, WALL_Z + 760), target: new THREE.Vector3(-560, BENCH_TOP + 760, WALL_Z + 30) }
  };

  return {
    root,
    views,
    focusViewFor(obj) {
      let o = obj;
      while (o) {
        if (o === manual) return views.manual;
        if (o === clock) return views.clock;
        o = o.parent;
      }
      return null;
    },
    update() {
      if (!app) return;
      if (app.simSpeed !== speedShown) {
        speedShown = app.simSpeed;
        faceMat.map.dispose();
        faceMat.map = clockFaceTexture(speedShown);
      }
      const d = new Date(t0 + app.simTime * 1000);
      const sec = d.getSeconds() + d.getMilliseconds() / 1000;
      const min = d.getMinutes() + sec / 60;
      const hr = (d.getHours() % 12) + min / 60;
      sHand.rotation.z = -(sec / 60) * Math.PI * 2;
      mHand.rotation.z = -(min / 60) * Math.PI * 2;
      hHand.rotation.z = -(hr / 12) * Math.PI * 2;
    },
    slots: {
      prusa: new THREE.Vector3(-1250, BENCH_TOP, BENCH_Z + 30),
      ortur: new THREE.Vector3(-60, BENCH_TOP, BENCH_Z + 20),
      laptop: new THREE.Vector3(530, BENCH_TOP, BENCH_Z + 170),
      elegoo: new THREE.Vector3(1250, BENCH_TOP, BENCH_Z + 10)
    }
  };
}

function addPegTools(g, M) {
  const y0 = BENCH_TOP + 120;
  const z = -900 + 32;
  const handleRed = new THREE.MeshPhysicalMaterial({ color: 0xb3201f, roughness: 0.45, clearcoat: 0.3 });
  const handleBlue = new THREE.MeshPhysicalMaterial({ color: 0x1f4fb3, roughness: 0.45, clearcoat: 0.3 });
  const handleOrange = new THREE.MeshPhysicalMaterial({ color: 0xe8661f, roughness: 0.45, clearcoat: 0.3 });
  // pegs
  const pegs = [-1450, -1350, -1250, -1150, -950, -850, 900, 1000, 1100, 1250, 1400];
  for (const x of pegs) g.add(cyl(2.5, 40, M.zinc, { x, y: y0 + 720, z: z + 10, rx: Math.PI / 2 - 0.15 }, 8));
  // screwdrivers
  [-1450, -1350, -1250].forEach((x, i) => {
    g.add(cyl(11, 95, i === 1 ? handleBlue : handleRed, { x, y: y0 + 650, z: z + 22 }, 12));
    g.add(cyl(2.6, 120, M.chrome, { x, y: y0 + 545, z: z + 22 }, 8));
  });
  // pliers
  const pl = group('pliers', { x: -1100, y: y0 + 610, z: z + 18 });
  pl.add(rbox(14, 130, 10, 5, handleRed, { x: -10, rz: 0.12 }));
  pl.add(rbox(14, 130, 10, 5, handleRed, { x: 10, rz: -0.12 }));
  pl.add(rbox(18, 50, 12, 3, M.darkSteel, { y: 85 }));
  g.add(pl);
  // flush cutters
  const fc = group('cutters', { x: -900, y: y0 + 630, z: z + 18 });
  fc.add(rbox(12, 100, 9, 5, handleOrange, { x: -8, rz: 0.1 }));
  fc.add(rbox(12, 100, 9, 5, handleOrange, { x: 8, rz: -0.1 }));
  fc.add(rbox(14, 34, 10, 3, M.darkSteel, { y: 64 }));
  g.add(fc);
  // allen keys
  for (let i = 0; i < 6; i++) {
    const s = 2 + i * 0.6;
    g.add(box(s, 70 + i * 12, s, M.blackOxide, { x: 920 + i * 14, y: y0 + 640 - i * 6, z: z + 14 }));
  }
  // steel ruler
  g.add(box(30, 500, 1, M.steel, { x: 1180, y: y0 + 450, z: z + 6 }));
  // spatula (scraper)
  const sp = group('spatula', { x: 1400, y: y0 + 600, z: z + 16 });
  sp.add(rbox(28, 110, 18, 8, handleOrange, { y: 40 }));
  sp.add(box(40, 80, 0.8, M.steel, { y: -40 }));
  g.add(sp);
  // clipboard (the manual sheet itself is added separately with its texture)
  g.add(box(232, 330, 4, new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.8 }), { x: MANUAL.x, y: MANUAL.y + 6, z: z + 4 }));
  g.add(box(80, 16, 10, M.steel, { x: MANUAL.x, y: MANUAL.y + 158, z: z + 10 }));
}

const MANUAL = { x: 260, y: BENCH_TOP + 120 + 470 };

// ---------------------------------------------------------------------------
// Printed paper (manual sheet, quick guide cards) – canvas texture
// ---------------------------------------------------------------------------
export function paperTexture(pxW, pxH, title, blocks, { accent = '#fa6831', subtitle = '' } = {}) {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, pxW, pxH);
  // faint paper grain
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`;
    ctx.fillRect(Math.random() * pxW, Math.random() * pxH, 1.5, 1.5);
  }
  const m = pxW * 0.07;
  const s = pxW / 1000;
  ctx.fillStyle = accent;
  ctx.fillRect(m, m, pxW - 2 * m, 8 * s);
  ctx.fillStyle = '#16181b';
  ctx.font = `800 ${46 * s}px Inter, Arial, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, m, m + 26 * s);
  let y = m + 92 * s;
  if (subtitle) {
    ctx.fillStyle = '#555';
    ctx.font = `500 ${24 * s}px Inter, Arial, sans-serif`;
    ctx.fillText(subtitle, m, y - 18 * s);
    y += 22 * s;
  }
  const maxW = pxW - 2 * m;
  const wrap = (text, font, lh, color, indent = 0) => {
    ctx.font = font;
    ctx.fillStyle = color;
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW - indent && line) {
        ctx.fillText(line, m + indent, y);
        y += lh;
        line = w;
      } else line = t;
    }
    if (line) {
      ctx.fillText(line, m + indent, y);
      y += lh;
    }
  };
  for (const b of blocks) {
    if (b.h) {
      y += 14 * s;
      ctx.fillStyle = accent;
      ctx.fillRect(m, y + 6 * s, 6 * s, 26 * s);
      wrap(b.h, `700 ${30 * s}px Inter, Arial, sans-serif`, 40 * s, '#16181b', 16 * s);
      y += 4 * s;
    }
    for (const l of b.lines || []) {
      const bullet = l.startsWith('• ');
      if (bullet) {
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(m + 8 * s, y + 14 * s, 4 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      wrap(bullet ? l.slice(2) : l, `400 ${25 * s}px Inter, Arial, sans-serif`, 34 * s, '#26282c', bullet ? 24 * s : 0);
      y += 4 * s;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Tent card standing on the bench (quick guide next to a device)
export function guideCard(title, blocks, { w = 170, h = 120, accent } = {}) {
  const g = new THREE.Group();
  g.name = 'guide-card';
  const tex = paperTexture(1000, Math.round((1000 * h) / w), title, blocks, { accent });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const tilt = 0.32;
  front.position.set(0, (h / 2) * Math.cos(tilt), (h / 2) * Math.sin(tilt) * 0 + 0.5);
  front.rotation.x = -tilt;
  front.castShadow = true;
  front.receiveShadow = true;
  g.add(front);
  // back leg
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.9, side: THREE.DoubleSide }));
  back.position.set(0, (h / 2) * Math.cos(tilt), -h * Math.sin(tilt));
  back.rotation.x = tilt;
  back.castShadow = true;
  g.add(back);
  g.userData.card = front;
  return g;
}

function clockFaceTexture(speed) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f6f2';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    ctx.fillStyle = '#1b1c1f';
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(-(big ? 5 : 2), -S / 2 + 18, big ? 10 : 4, big ? 36 : 16);
    ctx.restore();
  }
  ctx.font = '700 46px Inter, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    ctx.fillText(String(h), Math.sin(a) * 168, -Math.cos(a) * 168);
  }
  ctx.fillStyle = speed === 1 ? '#3a3c40' : '#d4471b';
  ctx.font = '800 30px Inter, Arial';
  ctx.fillText(speed === 1 ? 'ECHTZEIT' : `${speed}× SCHNELLER`, 0, 92);
  ctx.fillStyle = '#8a8c90';
  ctx.font = '600 20px Inter, Arial';
  ctx.fillText('WERKSTATT-ZEIT', 0, -92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
