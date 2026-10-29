import * as THREE from 'three';
import { brushedTextures, plasticNormal, texturedPEITextures } from './textures.js';

// Shared PBR material library. Created lazily so textures are generated once.

let lib = null;

export function materials() {
  if (lib) return lib;
  const brushed = brushedTextures(5, { streak: true });
  const blasted = brushedTextures(9, { streak: false });
  const plasticN = plasticNormal(13, 1.1, 48);
  const plasticFine = plasticNormal(17, 0.6, 96);
  plasticN.repeat.set(6, 6);
  plasticFine.repeat.set(10, 10);
  brushed.normalMap.repeat.set(4, 1);
  brushed.roughnessMap.repeat.set(4, 1);

  const m = {};

  m.chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe9ecef,
    metalness: 1,
    roughness: 0.09,
    name: 'chrome'
  });
  m.steel = new THREE.MeshPhysicalMaterial({
    color: 0xb9bdc2,
    metalness: 1,
    roughness: 0.32,
    roughnessMap: blasted.roughnessMap,
    name: 'steel'
  });
  m.darkSteel = new THREE.MeshPhysicalMaterial({ color: 0x3a3c40, metalness: 1, roughness: 0.38, name: 'darkSteel' });
  m.blackOxide = new THREE.MeshPhysicalMaterial({ color: 0x141518, metalness: 0.85, roughness: 0.42, name: 'blackOxide' });
  m.zinc = new THREE.MeshPhysicalMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.28, name: 'zinc' });
  m.aluminium = new THREE.MeshPhysicalMaterial({
    color: 0xd4d7db,
    metalness: 1,
    roughness: 0.34,
    normalMap: brushed.normalMap,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughnessMap: brushed.roughnessMap,
    anisotropy: 0.6,
    name: 'aluminium'
  });
  m.aluminiumRaw = new THREE.MeshPhysicalMaterial({
    color: 0xc5c9ce,
    metalness: 1,
    roughness: 0.42,
    roughnessMap: blasted.roughnessMap,
    name: 'aluminiumRaw'
  });
  m.blackAnodized = new THREE.MeshPhysicalMaterial({
    color: 0x1a1b1e,
    metalness: 0.65,
    roughness: 0.42,
    normalMap: blasted.normalMap,
    normalScale: new THREE.Vector2(0.15, 0.15),
    name: 'blackAnodized'
  });
  m.powderBlack = new THREE.MeshPhysicalMaterial({
    color: 0x1c1d20,
    metalness: 0.0,
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    normalMap: plasticFine,
    normalScale: new THREE.Vector2(0.35, 0.35),
    name: 'powderBlack'
  });
  m.prusaOrange = new THREE.MeshPhysicalMaterial({
    color: 0xf0612a,
    metalness: 0,
    roughness: 0.46,
    clearcoat: 0.12,
    clearcoatRoughness: 0.6,
    normalMap: plasticN,
    normalScale: new THREE.Vector2(0.35, 0.35),
    name: 'prusaOrange'
  });
  m.galaxyBlack = new THREE.MeshPhysicalMaterial({
    color: 0x18191c,
    metalness: 0.05,
    roughness: 0.38,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
    normalMap: plasticN,
    normalScale: new THREE.Vector2(0.3, 0.3),
    name: 'galaxyBlack'
  });
  m.plasticBlack = new THREE.MeshPhysicalMaterial({
    color: 0x111214,
    metalness: 0,
    roughness: 0.48,
    normalMap: plasticFine,
    normalScale: new THREE.Vector2(0.2, 0.2),
    name: 'plasticBlack'
  });
  m.plasticGlossBlack = new THREE.MeshPhysicalMaterial({
    color: 0x0b0c0d,
    metalness: 0,
    roughness: 0.18,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    name: 'plasticGlossBlack'
  });
  m.plasticGrey = new THREE.MeshPhysicalMaterial({ color: 0x5b5f66, roughness: 0.5, name: 'plasticGrey' });
  m.plasticWhite = new THREE.MeshPhysicalMaterial({ color: 0xe6e6e2, roughness: 0.45, name: 'plasticWhite' });
  m.rubber = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.92, name: 'rubber' });
  m.silicone = new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, roughness: 0.7, sheen: 0.3, name: 'silicone' });
  m.brass = new THREE.MeshPhysicalMaterial({ color: 0xd9b25a, metalness: 1, roughness: 0.3, name: 'brass' });
  m.copper = new THREE.MeshPhysicalMaterial({ color: 0xd7895a, metalness: 1, roughness: 0.3, name: 'copper' });
  m.pcbGreen = new THREE.MeshPhysicalMaterial({ color: 0x0f4a2a, roughness: 0.35, clearcoat: 0.5, name: 'pcbGreen' });
  m.pcbBlack = new THREE.MeshPhysicalMaterial({ color: 0x101113, roughness: 0.35, clearcoat: 0.5, name: 'pcbBlack' });
  m.beltRubber = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8, name: 'belt' });
  m.wireBlack = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.6, name: 'wireBlack' });
  m.wireRed = new THREE.MeshStandardMaterial({ color: 0xa3161a, roughness: 0.5, name: 'wireRed' });
  m.sleeve = new THREE.MeshStandardMaterial({
    color: 0x17181a,
    roughness: 0.75,
    normalMap: plasticN,
    normalScale: new THREE.Vector2(0.8, 0.8),
    name: 'sleeve'
  });
  m.glassDark = new THREE.MeshPhysicalMaterial({
    color: 0x050607,
    metalness: 0,
    roughness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    name: 'glassDark'
  });
  m.labelWhite = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.6, name: 'labelWhite' });
  m.ledGreen = new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x33ff66, emissiveIntensity: 0, name: 'ledGreen' });
  m.ledRed = new THREE.MeshStandardMaterial({ color: 0x2a0a0a, emissive: 0xff2a2a, emissiveIntensity: 0, name: 'ledRed' });
  m.ledBlue = new THREE.MeshStandardMaterial({ color: 0x0a0f2a, emissive: 0x3388ff, emissiveIntensity: 0, name: 'ledBlue' });
  m.felt = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 1, name: 'felt' });

  const pei = texturedPEITextures();
  m.peiTextures = pei;

  lib = m;
  return m;
}

// Clone a material with an independent color (keeps textures)
export function tinted(base, color, extra = {}) {
  const c = base.clone();
  c.color = new THREE.Color(color);
  Object.assign(c, extra);
  return c;
}
