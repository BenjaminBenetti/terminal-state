// Task reactor-expansion-20261101 (lane CONTROLS): the LOOK of every mounted control part (user feedback: "apply textures to them so
// they look grounded and similar to the fuse box ... apply textures so they match the 3d object"). No flat untextured blocks:
//  - a HOUSING (fuse carrier base, breaker plate, pump start station, key-switch / rod-control plates, generator lever plate) takes
//    its host model's look: the lead's Codex rusted-steel set (REACTOR_TEXTURES rustedSteel, world-mapped at its real tile span)
//    tinted so its mean equals the host model's MEASURED paint at the mount (HOST_PAINT: mean linear base colour of the Meshy map
//    under the mount, probed 2026-11-01; tint = paint / rusted-steel mean);
//  - functional parts (brass clips, red / green buttons, the yellow handle, black phenolic) are the repo's existing approved
//    painted / brushed steel surface sets in those colours; signal lamps stay unlit lenses (dynamic state).
// Before the Codex maps resolve (Node tests, a failed fetch) a housing falls back to the existing painted-steel set in the host's
// measured paint colour. Cached per texture-store version (archAssets.ts reactorTextureStore), shared by every control.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {surfaceMaterial} from '../materials';
import {slotMaterial} from './archMaterials';
import {reactorTextureStore} from './archAssets';
import type {HostPiece} from './controlsMount';

/** Measured mean paint (sRGB hex) of each host model's face under its controls (the Meshy base colour map, linear mean). */
export const HOST_PAINT: Readonly<Record<HostPiece | 'generator', number>> = {
  switchgear: 0x51504c, coolantPump: 0x584b3c, controlConsole: 0x776d5e, coolantValve: 0x605648, generator: 0x5e564b,
};
/** Tint of the rusted-steel Codex set so its mean matches HOST_PAINT (paint / rusted-steel mean 0x6e6353, per channel). */
export const HOST_TINT: Readonly<Record<HostPiece | 'generator', number>> = {
  switchgear: 0xc1d3ea, coolantPump: 0xd0c7bf, controlConsole: 0xffffff, coolantValve: 0xe1e1e1, generator: 0xdbe1e7,
};

export type SkinKey = HostPiece | 'generator' | 'brass' | 'red' | 'green' | 'yellow' | 'phenolic' | 'steel' | 'wheelRed';
export type LampKey = 'lens' | 'litGreen' | 'litRed' | 'litAmber';

let cache: {version: number; m: Map<string, THREE.Material>} = {version: -1, m: new Map()};

/** Node (no DOM: the generated surface sets need a canvas) — a plain lit stand-in; the game always has a document. */
const headless = () => typeof document === 'undefined';

function make(key: SkinKey): THREE.Material {
  const paint = (color: number, metalness = 0.3, name: string = key): THREE.Material => headless()
    ? Object.assign(new THREE.MeshStandardMaterial({color, metalness, roughness: 0.6}), {name: `reactor-ctl-${name}`})
    : Object.assign(surfaceMaterial('paintedSteel', {color, metalness}, {macro: 0.15}), {name: `reactor-ctl-${name}`});
  switch (key) {
    case 'brass': return headless() ? paint(0xc9a14a, 0.85) : Object.assign(surfaceMaterial('brushedSteel', {color: 0xc9a14a, metalness: 0.85, roughness: 0.45}, {macro: 0.1}), {name: 'reactor-ctl-brass'});
    case 'red': return paint(0xa3261f, 0.2);
    case 'wheelRed': return paint(0x8e2a1e, 0.25);
    case 'green': return paint(0x2f7d3a, 0.2);
    case 'yellow': return paint(0xc99a22, 0.25);
    case 'phenolic': return paint(0x2a2623, 0.05);
    case 'steel': return Object.assign(slotMaterial('rustedSteel', {color: 0xb4b2aa, macro: 0.15}) ?? (headless() ? paint(0x6a6e70, 0.6) : surfaceMaterial('brushedSteel', {color: 0x6a6e70, metalness: 0.6}, {macro: 0.1})), {name: 'reactor-ctl-steel'});
    default: {
      const m = slotMaterial('rustedSteel', {color: HOST_TINT[key], macro: 0.15, grime: [0.15, 0.6]}, `reactor-ctl-host-${key}`);
      return m ?? paint(HOST_PAINT[key], 0.35, `host-${key}`);
    }
  }
}

/** The shared material of a control part (cached; rebuilt when the Reactor's Codex maps change). */
export function controlSkin(key: SkinKey): THREE.Material {
  if (cache.version !== reactorTextureStore.version) cache = {version: reactorTextureStore.version, m: new Map()};
  let m = cache.m.get(key);
  if (!m) cache.m.set(key, (m = make(key)));
  return m;
}

let lamps: Record<LampKey, THREE.Material> | null = null;
/** Signal lamp lenses (unlit when lit; a dark glassy lens off). */
export function lampSkin(k: LampKey): THREE.Material {
  if (!lamps) {
    const lit = (name: string, color: number) => { const m = new MeshBasicNodeMaterial({color: new THREE.Color(color)}); m.name = `reactor-lamp-${name}`; return m; };
    lamps = {
      lens: Object.assign(headless() ? new THREE.MeshStandardMaterial({color: 0x22282a, metalness: 0.2, roughness: 0.3}) : surfaceMaterial('paintedSteel', {color: 0x22282a, metalness: 0.2, roughness: 0.3}, {macro: 0}), {name: 'reactor-lamp-lens'}),
      litGreen: lit('green', 0x5cff70), litRed: lit('red', 0xff4030), litAmber: lit('amber', 0xffb432),
    };
  }
  return lamps[k];
}
