import * as THREE from 'three';

// Renders PrusaSlicer-style thumbnails (transparent PNG, isometric view).
let renderer = null;

function getRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  return renderer;
}

// positions: Z-up printer coordinates
export function renderThumbnail(positions, { w = 313, h = 173, color = 0xf27a3a } = {}) {
  const r = getRenderer();
  r.setSize(w, h, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.rotateX(-Math.PI / 2); // Z-up -> Y-up
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const scene = new THREE.Scene();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(1, 2, 1.5);
  scene.add(d);
  const bs = geo.boundingSphere;
  const cam = new THREE.PerspectiveCamera(30, w / h, 1, 5000);
  const dist = bs.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
  const dir = new THREE.Vector3(1, 0.85, 1.25).normalize();
  cam.position.copy(bs.center).addScaledVector(dir, dist);
  cam.lookAt(bs.center);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  geo.dispose();
  mat.dispose();
  return url;
}

// G-code thumbnail comment block (PrusaSlicer format)
export function thumbnailBlock(dataUrl, w, h) {
  const b64 = dataUrl.split(',')[1];
  const lines = [`; thumbnail begin ${w}x${h} ${b64.length}`];
  for (let i = 0; i < b64.length; i += 78) lines.push(`; ${b64.slice(i, i + 78)}`);
  lines.push('; thumbnail end');
  return lines.join('\n');
}
