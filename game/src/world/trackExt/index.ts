// Track 2 (Beyond the Station), lane VIS: presentation of the track extensions (layout.extensions, GEN) — entry point
// used by world/builder.ts. See DESIGN.md §3 (reference/tasks/track2-beyond-station-20261031/).
//
//   const view = TrackExtView.of(layout);                 // null without extensions: the builder is unchanged
//   faces = view ? view.clipFaces(faces) : faces;          // no stair-stepped grid walls inside a tunnel
//   floors / ceilings: skip cells where view.ownsCell(L, i); black end planes / barricades: skip view.continued ends;
//   default door frames: skip view.doorIds;
//   const built = buildTrackExtensions(group, view, layout, mats);   // shell + caps + doors + graffiti, into the station
//
// Everything is added to the station group at build time with existing or shared materials (no first-use compile; see
// docs/rendering-warmup.md); steam lives in the effects pool (world/fx.ts Effects.steam, world/trackExt/steam.ts).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {StationLayout} from '../../gen/station';
import type {WorldMaterials} from '../materials';
import {hazardMaterial} from '../traversalBuilder';
import {Acc} from './mesh';
import {buildShells, type ShellBuild} from './shell';
import {graffitiDecals, graffitiMaterial, type GraffitiDecal} from './graffiti';
import type {TrackExtView} from './view';

export {TrackExtView, extOf, extensionsOf, continuedEnds, endKey} from './view';
export {TunnelFrame} from './frame';
export {shellDetailFaces, SHELL_FACE_TYPE} from './shell';

export interface TrackExtStats {
  tunnels: number;
  /** Total centreline length (m). */
  lengthM: number;
  meshes: number;
  /** Draw calls (one per mesh / instanced mesh) and triangles of everything the extensions add. */
  draws: number;
  triangles: number;
  instances: number;
  /** Per 100 m of tunnel (all tunnels together). */
  per100m: {draws: number; triangles: number};
  /** Graffiti decals placed (clue records x marks). */
  decals: number;
}

export interface TrackExtBuilt {
  view: TrackExtView;
  shells: ShellBuild;
  decals: GraffitiDecal[];
  stats: TrackExtStats;
}

const voidMats = new WeakMap<WorldMaterials, THREE.Material>();
/** Opaque near-black backing (the darkness behind a gate), like the builder's old end planes. */
export function voidMaterial(mats: WorldMaterials): THREE.Material {
  let m = voidMats.get(mats);
  if (!m) { const mm = new MeshBasicNodeMaterial({color: 0x030303}); mm.name = 'track-ext-void'; voidMats.set(mats, (m = mm)); }
  return m;
}

/** Build every tunnel's shell, cap, door frames and graffiti into the station group. */
export function buildTrackExtensions(group: THREE.Group, view: TrackExtView, layout: StationLayout, mats: WorldMaterials): TrackExtBuilt {
  const shells = buildShells(group, view, layout, mats, {hazard: hazardMaterial(mats), void: voidMaterial(mats)});
  // Graffiti: one merged decal mesh for the level (shared atlas material).
  const acc = new Acc();
  const decals: GraffitiDecal[] = [];
  view.tunnels.forEach((v, k) => {
    const avoid = shells.perTunnel[k]?.openings ?? [];
    decals.push(...graffitiDecals(acc, v.t, v.f, layout.seed >>> 0, avoid));
  });
  let decalTris = 0;
  const geo = acc.geometry();
  if (geo) {
    const mesh = new THREE.Mesh(geo, graffitiMaterial());
    mesh.name = 'track-ext-graffiti';
    mesh.userData.level = 0;
    mesh.userData.trackExt = {tunnel: -1, part: 'graffiti'};
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    decalTris = acc.triangleCount;
  }
  const lengthM = view.tunnels.reduce((n, v) => n + v.f.length, 0);
  const draws = shells.meshes.length + (geo ? 1 : 0);
  const triangles = shells.perTunnel.reduce((n, p) => n + p.triangles, 0) + decalTris;
  const per = lengthM > 0 ? 100 / lengthM : 0;
  return {
    view, shells, decals,
    stats: {
      tunnels: view.tunnels.length, lengthM, meshes: draws, draws, triangles,
      instances: shells.perTunnel.reduce((n, p) => n + p.instances, 0),
      per100m: {draws: Math.round(draws * per * 10) / 10, triangles: Math.round(triangles * per)},
      decals: decals.length,
    },
  };
}
