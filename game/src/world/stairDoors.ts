// Iteration 16 (lane TOWER): stairwell doors of the office tower (layout.office.stairDoors, WORLD-GEN). A steel fire
// door in the wall with a photoluminescent sign ("STAIRS ↑ 6 · ↓ 4"); E travels to the adjacent floor (lane RUN's
// game.travel, arrival 'stairs-up' / 'stairs-down' = the direction travelled). Two entries at one spot (up + down) are
// ONE door with a two-choice list. The lobby's way down is the physical stair to the subway (no door: WORLD-GEN).

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {CELL, type Grid} from '../gen/grid';
import {shapeMaterial} from './shapeMaterials';
import type {WorldMaterials} from './materials';
import {floorLabel, solidAt, wallBox, wallNormalAt, type Box3Like, type P3, type StairDoorInfo} from './towerShared';

export interface StairChoice { dir: 'up' | 'down'; toFloor: number }

export interface StairDoorPlan {
  /** Door centre on the wall face (walkable side) and the storey floor there. */
  x: number; z: number; y: number;
  /** Room-facing normal (wall -> room). */
  n: [number, number];
  /** 'up' first. */
  choices: StairChoice[];
  /** E target box (the leaf) and a line-of-sight point just in front of it. */
  box: Box3Like;
  eye: P3;
  /** Sign text lines. */
  sign: string[];
}

export const STAIR_LEAF = {w: 0.95, h: 2.08};

/** Groups the contract entries into doors (same spot = one door), snaps each onto its wall face. */
export function planStairDoors(list: readonly StairDoorInfo[], g: Grid, floorY: (x: number, z: number) => number, floor: number): StairDoorPlan[] {
  const groups: {x: number; z: number; yaw: number; choices: StairChoice[]}[] = [];
  for (const s of list) {
    if (s.toFloor === floor) continue;
    const near = groups.find(q => Math.hypot(q.x - s.x, q.z - s.z) < 0.8);
    if (near) { if (!near.choices.some(c => c.dir === s.dir)) near.choices.push({dir: s.dir, toFloor: s.toFloor}); continue; }
    groups.push({x: s.x, z: s.z, yaw: s.yaw, choices: [{dir: s.dir, toFloor: s.toFloor}]});
  }
  return groups.map(q => {
    q.choices.sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'up' ? -1 : 1));
    // room-facing normal: from the grid (the wall beside the point), else from the yaw (facing the door = forward)
    const n = wallNormalAt(g, q.x, q.z, 0.6) ?? [Math.sin(q.yaw), Math.cos(q.yaw)] as [number, number];
    const ax: [number, number] = Math.abs(n[0]) >= Math.abs(n[1]) ? [Math.sign(n[0]) || 1, 0] : [0, Math.sign(n[1]) || 1];
    // snap onto the wall face: the boundary of the first solid cell behind the point
    let x = q.x, z = q.z;
    for (let k = 0; k <= 12; k++) {
      const px = q.x - ax[0] * k * 0.05, pz = q.z - ax[1] * k * 0.05;
      if (solidAt(g, px, pz)) {
        if (ax[0] > 0) x = (Math.floor(px / CELL) + 1) * CELL; else if (ax[0] < 0) x = Math.floor(px / CELL) * CELL;
        if (ax[1] > 0) z = (Math.floor(pz / CELL) + 1) * CELL; else if (ax[1] < 0) z = Math.floor(pz / CELL) * CELL;
        break;
      }
    }
    const y = floorY(x + ax[0] * 0.3, z + ax[1] * 0.3);
    const up = q.choices.find(c => c.dir === 'up'), down = q.choices.find(c => c.dir === 'down');
    const sign = ['STAIRS', [up ? `↑ ${floorLabel(up.toFloor)}` : '', down ? `↓ ${floorLabel(down.toFloor)}` : ''].filter(Boolean).join('   ')];
    const c = {x, y: y + STAIR_LEAF.h / 2, z};
    return {
      x, z, y, n: ax, choices: q.choices,
      box: wallBox(c, ax, STAIR_LEAF.w, STAIR_LEAF.h, 0.14),
      eye: {x: x + ax[0] * 0.2, y: y + 1.2, z: z + ax[1] * 0.2},
      sign,
    };
  });
}

/** Prompt text for a door (single choice: the direct action; two: "choose"). */
export function stairPrompt(p: StairDoorPlan): string {
  if (p.choices.length === 1) {
    const c = p.choices[0];
    return `<b>[E]</b> Stairs ${c.dir} to ${c.toFloor <= 1 ? 'the lobby' : `floor ${c.toFloor}`}`;
  }
  return '<b>[E]</b> Stairwell (up / down)';
}

// ---------------------------------------------------------------------------------------------
// three.js

function signTexture(lines: string[]): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.DataTexture(new Uint8Array([40, 60, 40, 255]), 1, 1);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#16231b'; ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = '#9fdcae'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 240, 144);
    ctx.fillStyle = '#c8f0cf';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(lines[0] ?? 'STAIRS', 128, 52);
    ctx.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(lines[1] ?? '', 128, 110);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface StairDoorView {
  root: THREE.Group;
  /** Leaf pivots (index = plan index) for the open swing. */
  leaves: THREE.Object3D[];
  geometries: THREE.BufferGeometry[];
  /** Per-section sign materials / textures (released with the section, deferred). */
  disposables: {dispose(): void}[];
}

export function buildStairDoors(plans: readonly StairDoorPlan[], mats: WorldMaterials): StairDoorView {
  const root = new THREE.Group(); root.name = 'tower-stair-doors';
  const geometries: THREE.BufferGeometry[] = [], disposables: {dispose(): void}[] = [], leaves: THREE.Object3D[] = [];
  const frame = shapeMaterial(mats, 'shopFrame'), leafMat = shapeMaterial(mats, 'panel'), bar = shapeMaterial(mats, 'kitchenSteel'), dark = shapeMaterial(mats, 'black');
  const geo = <G extends THREE.BufferGeometry>(g: G): G => { geometries.push(g); return g; };
  for (const p of plans) {
    const g = new THREE.Group();
    g.name = 'tower-stair-door';
    g.position.set(p.x, p.y, p.z);
    // local frame: +z = room-facing normal, +x = along the wall
    g.rotation.y = Math.atan2(p.n[0], p.n[1]);
    root.add(g);
    const W = STAIR_LEAF.w, H = STAIR_LEAF.h, fw = 0.07;
    const fr = new THREE.Mesh(geo(new THREE.BoxGeometry(W + 2 * fw, fw, 0.06)), frame); fr.position.set(0, H + fw / 2, 0.03); g.add(fr);
    for (const sx of [-1, 1]) { const j = new THREE.Mesh(geo(new THREE.BoxGeometry(fw, H, 0.06)), frame); j.position.set(sx * (W / 2 + fw / 2), H / 2, 0.03); g.add(j); }
    // leaf on a hinge pivot (hinge at -x), pulled into the room when used
    const pivot = new THREE.Group(); pivot.position.set(-W / 2, 0, 0.035); g.add(pivot);
    const leaf = new THREE.Mesh(geo(new THREE.BoxGeometry(W - 0.01, H - 0.01, 0.045)), leafMat); leaf.position.set(W / 2, H / 2, 0); pivot.add(leaf);
    const pb = new THREE.Mesh(geo(new THREE.BoxGeometry(W * 0.7, 0.05, 0.05)), bar); pb.position.set(W / 2 + 0.05, 1.0, 0.05); pivot.add(pb);
    const vision = new THREE.Mesh(geo(new THREE.BoxGeometry(0.16, 0.5, 0.05)), dark); vision.position.set(W * 0.72, 1.55, 0.003); pivot.add(vision);
    leaves.push(pivot);
    // sign beside the latch side at eye height (photoluminescent: faint emissive)
    const tex = signTexture(p.sign);
    const sm = new MeshStandardNodeMaterial({map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0});
    sm.name = 'tower-stair-sign';
    disposables.push(tex, sm);
    const sign = new THREE.Mesh(geo(new THREE.BoxGeometry(0.4, 0.25, 0.015)), [dark, dark, dark, dark, sm, dark]);
    sign.position.set(W / 2 + fw + 0.32, 1.62, 0.008);
    g.add(sign);
  }
  return {root, leaves, geometries, disposables};
}
