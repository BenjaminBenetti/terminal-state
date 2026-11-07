// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): the SKYLIGHT COFFERS of the skylit skyway courts (layout.skyways.skylights,
// gen/skyways/skylights.ts). The generator raised the coffer cells' ceiling to the well's top, so the builder draws the well's four
// walls itself (the ceiling step faces; SkywaysArch.remapFaces gives them the plain plaster of a light well) and asks
// SkywaysArch.ceilKey for the run at the top: SKYLIGHT_SKY_KEY — the MURK SKY seen through the roof light (the mall's sky colour along
// the view ray: the same green-grey overcast as the atrium vaults and the city murk; unlit, never a void, independent of whether the
// exterior is shown). Under it this module adds the glazing: one pane grid per coffer SKYLIGHT_GLASS_DROP under the top, in the bridge
// roofs' intact roof glass (bars on a 1.5 x 1.2 m grid, grime, no open panes — nothing looks broken where no gas flows), and a thin
// dark steel frame round the coffer mouth. Merged: one glass + one frame mesh for every coffer of the level (tagged with its storey).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, cameraPosition, normalize, positionWorld} from 'three/tsl';
import type {SkywaysSkylight} from '../gen/skyways/skywaysTypes';
import {mallSkyColour} from './mallExterior';
import {bridgeRoofGlass} from './skywaysBridgeRoofs';
import {Quads} from './skywaysArch';

/** The ceiling key of a coffer's top (SkywaysArch.ceilKey / material). */
export const SKYLIGHT_SKY_KEY = 'skyways-skylight-sky';
/** The glazing hangs this far under the coffer's top (m); the mouth frame's section (m). */
export const SKYLIGHT_GLASS_DROP = 0.18;
export const SKYLIGHT_FRAME = {w: 0.06, h: 0.08} as const;

let skyMat: MeshBasicNodeMaterial | null = null;
/** The sky seen through a roof light (unlit, never fogged: the mall's murk sky along the view ray). */
export function skylightSkyMaterial(): MeshBasicNodeMaterial {
  if (skyMat) return skyMat;
  const m = new MeshBasicNodeMaterial({fog: false, side: THREE.DoubleSide});
  m.name = SKYLIGHT_SKY_KEY;
  m.colorNode = Fn(() => mallSkyColour(normalize(positionWorld.sub(cameraPosition))))();
  m.userData.skywaysSky = true;
  return (skyMat = m);
}

export interface SkylightStats { coffers: number; panes: number; meshes: number; triangles: number }

/** The coffers' glazing + mouth frames into `group` (one glass + one steel mesh per storey). */
export function buildSkylights(group: THREE.Group, skylights: readonly SkywaysSkylight[], steel: THREE.Material): SkylightStats {
  const st: SkylightStats = {coffers: 0, panes: 0, meshes: 0, triangles: 0};
  const byLevel = new Map<number, {glass: Quads; frame: Quads}>();
  for (const s of skylights) {
    let q = byLevel.get(s.level);
    if (!q) byLevel.set(s.level, (q = {glass: new Quads(), frame: new Quads()}));
    const r = s.rect, y = s.topY - SKYLIGHT_GLASS_DROP;
    // the pane grid: uv in metres (the glass program's bars every 1.5 x 1.2 m from the coffer's corner)
    q.glass.quad([[r.x0, y, r.z0], [r.x1, y, r.z0], [r.x1, y, r.z1], [r.x0, y, r.z1]], [0, -1, 0], [[0, 0], [r.x1 - r.x0, 0], [r.x1 - r.x0, r.z1 - r.z0], [0, r.z1 - r.z0]]);
    st.panes += Math.max(1, Math.round((r.x1 - r.x0) / 1.5)) * Math.max(1, Math.round((r.z1 - r.z0) / 1.2));
    // glazing bars' carrier + the mouth's frame (inside the well, flush with its walls)
    const F = SKYLIGHT_FRAME, V = (x: number, yy: number, z: number) => new THREE.Vector3(x, yy, z);
    for (const [yy, t] of [[y - 0.04, F.w], [s.ceilY + F.h / 2, F.w]] as const) {
      q.frame.beam(V(r.x0, yy, r.z0 + t / 2), V(r.x1, yy, r.z0 + t / 2), F.h, t);
      q.frame.beam(V(r.x0, yy, r.z1 - t / 2), V(r.x1, yy, r.z1 - t / 2), F.h, t);
      q.frame.beam(V(r.x0 + t / 2, yy, r.z0), V(r.x0 + t / 2, yy, r.z1), F.h, t);
      q.frame.beam(V(r.x1 - t / 2, yy, r.z0), V(r.x1 - t / 2, yy, r.z1), F.h, t);
    }
    // a glazing bar across the middle of the pane grid
    q.frame.beam(V((r.x0 + r.x1) / 2, y - 0.04, r.z0), V((r.x0 + r.x1) / 2, y - 0.04, r.z1), 0.05, 0.07);
    st.coffers++;
  }
  for (const [level, q] of byLevel) {
    for (const m of [q.glass.mesh(bridgeRoofGlass(true), 'skyways-skylight-glass', [level]), q.frame.mesh(steel, 'skyways-skylight-frame', [level])]) {
      if (!m) continue;
      m.userData.level = level;
      group.add(m);
      st.meshes++;
      st.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
  }
  return st;
}
