// Track 2 (Beyond the Station), lane VIS: presentation of the track extensions (layout.extensions, GEN) — entry point
// used by world/builder.ts. See DESIGN.md §3 (reference/tasks/track2-beyond-station-20261031/).
//
//   const view = TrackExtView.of(layout);                 // null without extensions: the builder is unchanged
//   faces = view ? view.clipFaces(faces) : faces;          // no stair-stepped grid walls inside a tunnel
//   floors / ceilings: skip cells where view.ownsCell(L, i); black end planes / barricades: skip view.continued ends;
//   default door frames: skip view.doorIds;
//   const built = buildTrackExtensions(group, view, layout, mats);   // shell + caps + doors + graffiti, into the station
//   (GEN-2) service hatches in bed walls (ServiceAnnex.bed): the grid draws the opening + frame; this adds plate + graffiti
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
import {graffitiDecals, graffitiMaterial, stationArtDecals, type GraffitiDecal, type StationArtDecal} from './graffiti';
import {hatchGraffiti, hatchPlates, type HatchPlate} from './hatch';
import {serviceSignMaterial} from './shell';
import type {TrackExtView} from './view';
import {buildAnnexMachines, type MachineBuild} from './machines'; // task track2-playtest-revision (lane ROOMS): annex machinery

export {TrackExtView, extOf, extensionsOf, continuedEnds, endKey, bedFrame, type HatchView} from './view';
export {HATCH_PLATE, type HatchPlate} from './hatch';
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
  /** (GEN-2) Service hatches in bed walls (plates built). */
  hatches: number;
  /** (Playtest revision, lane ART) Station-surface invitation art decals (layout.extensions.art records). */
  art: number;
  /** (lane ROOMS) The annexes' machinery: draws (one per annex x material), triangles, records (not in per100m: tunnels only). */
  machines: {draws: number; triangles: number; records: number};
}

export interface TrackExtBuilt {
  view: TrackExtView;
  shells: ShellBuild;
  decals: GraffitiDecal[];
  /** (GEN-2) SERVICE plates over the service hatches in bed walls. */
  plates: HatchPlate[];
  /** (Playtest revision, lane ART) The station-art decals (same mesh as the clue marks). */
  artDecals: StationArtDecal[];
  /** (lane ROOMS) The annex machinery meshes. */
  machines: MachineBuild;
  stats: TrackExtStats;
}

const voidMats = new WeakMap<WorldMaterials, THREE.Material>();
/** Opaque near-black backing (the darkness behind a gate), like the builder's old end planes. */
export function voidMaterial(mats: WorldMaterials): THREE.Material {
  let m = voidMats.get(mats);
  if (!m) { const mm = new MeshBasicNodeMaterial({color: 0x030303}); mm.name = 'track-ext-void'; voidMats.set(mats, (m = mm)); }
  return m;
}

/** Build every tunnel's shell, cap, door frames and graffiti (+ GEN-2: service-hatch plates and graffiti) into the station group. */
export function buildTrackExtensions(group: THREE.Group, view: TrackExtView, layout: StationLayout, mats: WorldMaterials): TrackExtBuilt {
  const shells = buildShells(group, view, layout, mats, {hazard: hazardMaterial(mats), void: voidMaterial(mats)});
  // Graffiti: one merged decal mesh for the level (shared atlas material).
  const acc = new Acc();
  const decals: GraffitiDecal[] = [];
  view.tunnels.forEach((v, k) => {
    const avoid = shells.perTunnel[k]?.openings ?? [];
    decals.push(...graffitiDecals(acc, v.t, v.f, layout.seed >>> 0, avoid));
  });
  // (GEN-2) service hatches: the bed-wall graffiti joins the same decal mesh; their plates merge into one steel + one sign mesh
  decals.push(...hatchGraffiti(acc, view.hatches, layout.seed >>> 0));
  // (playtest revision, lane ART) the station-surface invitation art on the bed walls the platforms face: the same mesh
  const artDecals = stationArtDecals(acc, view.ext.art ?? [], layout.trenches, layout.seed >>> 0);
  const steel = new Acc(), sign = new Acc();
  const plates = hatchPlates(steel, sign, view.hatches);
  const hatchMeshes: THREE.Mesh[] = [];
  for (const [a, mat, part] of [[steel, mats.get('steel'), 'hatch-steel'], [sign, serviceSignMaterial(mats), 'hatch-sign']] as const) {
    const g = a.geometry();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `track-ext-${part}`;
    mesh.userData.level = 0;
    mesh.userData.trackExt = {tunnel: -1, part};
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    hatchMeshes.push(mesh);
  }
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
  // (lane ROOMS) the annexes' anchored machinery: merged procedural geometry, one mesh per annex and material
  const machines = buildAnnexMachines(group, layout, mats);
  const lengthM = view.tunnels.reduce((n, v) => n + v.f.length, 0);
  const draws = shells.meshes.length + (geo ? 1 : 0) + hatchMeshes.length;
  const triangles = shells.perTunnel.reduce((n, p) => n + p.triangles, 0) + decalTris + steel.triangleCount + sign.triangleCount;
  const per = lengthM > 0 ? 100 / lengthM : 0;
  return {
    view, shells, decals, plates, artDecals, machines,
    stats: {
      tunnels: view.tunnels.length, lengthM, meshes: draws + machines.draws, draws: draws + machines.draws, triangles: triangles + machines.triangles,
      instances: shells.perTunnel.reduce((n, p) => n + p.instances, 0),
      per100m: {draws: Math.round(draws * per * 10) / 10, triangles: Math.round(triangles * per)},
      decals: decals.length,
      hatches: plates.length,
      art: artDecals.length,
      machines: {draws: machines.draws, triangles: machines.triangles, records: machines.records},
    },
  };
}
