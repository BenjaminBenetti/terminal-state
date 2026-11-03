// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): THE SURFACE KIT REGISTRY — the swap registry of the ruined
// city round the Reactor's roof aperture (user: "The player will see a city up there, with all the destroyed buildings"). Pure data
// (no three.js): which models, at which scale, where (rings out from the surface plaza), how many and facing what. The planner
// (surfacePlan.ts) reads only this; the builder (surfaceCity.ts) only the lazy-library keys / dims it names.
//
// Two sources, mixed for near / far variety (no new art from this lane):
//  - the lead's NEW Meshy T2.5 ruined-city kit (assets/reactorSurfaceKit.generated.ts REACTOR_SURFACE_KIT: high-rise 75 m, brick
//    apartment 24 m, garage skeleton 16 m, storefront row 8 m; front +Z, Meshy PBR maps kept), level-only reactor-*.glb files;
//  - the approved Office exterior kit already in the pack (assets/officeAssets.ts use 'exterior': ruined-tower 60 m, ruined-midrise
//    30 m, car / bus wrecks, rubble pile; assets/companyAssets.ts water-tower; front -Z, vehicles long along X with the nose at +X).
// Every model: real size in metres, +Y up, grounded (min y 0), centred on x / z. `dims` = the measured runtime bounds [x, y, z].
// SWAP: add / replace an entry (same role) — the plan picks per role by `weight` among the entries whose model is delivered
// (`available(key)`); an undelivered key simply drops out (an empty role leaves its lots as rubble).
//
// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CITY; user: "It should have more buildings going back a
// little further, as you can easily tell the buildings end"): THE FAR SKYLINE entries (`skyline: true`) — the SAME delivered models
// (no new art, no retexture), drawn only in the outer blocks and the outskirts belt round the street grid, a little larger (fewer,
// bigger silhouettes in the distance mist: there are no LOD meshes), with their own caps and their own instanced meshes (the builder
// gives the far band finer sectors for culling). `tris` (from the source registries) feeds the plan's triangle budget.

import {OFFICE_ASSETS, type OfficeAssetId} from '../../assets/officeAssets';
import {COMPANY_ASSETS} from '../../assets/companyAssets';
import {REACTOR_SURFACE_KIT} from '../../assets/reactorSurfaceKit.generated';

/** What a kit piece is in the city (the planner's placement class). */
export type SurfaceRole = 'highrise' | 'midrise' | 'lowrise' | 'rubble' | 'car' | 'bus' | 'tank';

export interface SurfaceKitEntry {
  /** Stable registry id. */
  id: string;
  role: SurfaceRole;
  /** Lazy-library key (game.ts propModels) and its runtime URL (named here so the release packager ships it). */
  key: string;
  url: string;
  /** Measured runtime bounds [x, y, z] (m) at scale 1. */
  dims: readonly [number, number, number];
  /** Triangles per instance (the source registry's count: the plan's triangle budget). */
  tris: number;
  /** Rings it may stand in (0 = the ring road round the plaza, 1 = the blocks facing it, 2.. outward): [min, max]. */
  rings: readonly [number, number];
  /** Uniform scale band (the plan shrinks toward the min to fit a block, never below it). */
  scale: readonly [number, number];
  /** Most instances per city. */
  max: number;
  /** Relative pick weight inside its role. */
  weight: number;
  /** The model's FRONT: +Z (Meshy native, the new kit) or -Z (the Office kit convention). The plan turns fronts to the street. */
  front: 1 | -1;
  /** Vehicles: the body's long axis is model X (nose +X). */
  longX?: boolean;
  /** A steel stand drawn under it (m; the water tank sits on legs this tall). */
  stand?: number;
  /** The far skyline (the outer blocks and the outskirts belt only; the near rows never pick it). */
  skyline?: true;
  source: 'reactor-surface' | 'office' | 'company';
}

const S = REACTOR_SURFACE_KIT;
const office = (id: OfficeAssetId) => {
  const a = OFFICE_ASSETS[id];
  return {key: `office-${id}`, url: a.url ?? '', dims: (a.dims ?? [a.sizeM, a.sizeM, a.sizeM]) as readonly [number, number, number], tris: a.tris};
};
const kit = (m: (typeof S)[keyof typeof S]) => ({key: m.key, url: m.url, dims: m.dims, tris: m.tris});
const tank = COMPANY_ASSETS['water-tower'];

/** THE registry (order = no meaning; the plan is seeded). */
export const SURFACE_KIT: readonly SurfaceKitEntry[] = [
  // --- the lead's new kit (task reactor-surface-ending) ---
  {id: 'cityHighrise', role: 'highrise', ...kit(S.cityHighrise), rings: [2, 9], scale: [0.85, 1.1], max: 8, weight: 3, front: 1, source: 'reactor-surface'},
  {id: 'cityApartment', role: 'midrise', ...kit(S.cityApartment), rings: [1, 9], scale: [0.88, 1.12], max: 14, weight: 3, front: 1, source: 'reactor-surface'},
  {id: 'cityGarage', role: 'midrise', ...kit(S.cityGarage), rings: [1, 4], scale: [0.9, 1.12], max: 7, weight: 1.6, front: 1, source: 'reactor-surface'},
  {id: 'cityStorefronts', role: 'lowrise', ...kit(S.cityStorefronts), rings: [1, 3], scale: [0.92, 1.1], max: 20, weight: 3, front: 1, source: 'reactor-surface'},
  // --- the approved Office exterior kit (already in the pack: 0 B) ---
  {id: 'ruinedTower', role: 'highrise', ...office('ruined-tower'), rings: [2, 9], scale: [0.85, 1.08], max: 5, weight: 2, front: -1, source: 'office'},
  {id: 'ruinedMidrise', role: 'midrise', ...office('ruined-midrise'), rings: [1, 9], scale: [0.85, 1.1], max: 10, weight: 2.2, front: -1, source: 'office'},
  {id: 'carWreck', role: 'car', ...office('car-wreck'), rings: [0, 2], scale: [0.95, 1.05], max: 16, weight: 1, front: -1, longX: true, source: 'office'},
  {id: 'busWreck', role: 'bus', ...office('bus-wreck'), rings: [0, 2], scale: [0.97, 1.03], max: 3, weight: 1, front: -1, longX: true, source: 'office'},
  {id: 'rubblePile', role: 'rubble', ...office('rubble-pile'), rings: [0, 9], scale: [0.7, 2.6], max: 36, weight: 1, front: -1, source: 'office'},
  {id: 'waterTower', role: 'tank', key: 'office-water-tower', url: tank.url ?? '', dims: (tank.dims ?? [4.6, 4.5, 4.6]) as readonly [number, number, number], tris: tank.tris,
    rings: [1, 3], scale: [0.95, 1.1], max: 4, weight: 1, front: -1, stand: 7, source: 'company'},
  // --- the far skyline (task reactor-surface-redesign-credits-20261103, lane CITY): the same models, larger, out in the mist ---
  // (the cheapest silhouettes per triangle lead: the 75 m Meshy high-rise is 10 k triangles; the bulkier ruins add broken tops)
  {id: 'skyHighrise', role: 'highrise', ...kit(S.cityHighrise), rings: [3, 99], scale: [0.95, 1.4], max: 30, weight: 3, front: 1, skyline: true, source: 'reactor-surface'},
  {id: 'skyTower', role: 'highrise', ...office('ruined-tower'), rings: [3, 99], scale: [0.95, 1.3], max: 10, weight: 2.2, front: -1, skyline: true, source: 'office'},
  {id: 'skyApartment', role: 'midrise', ...kit(S.cityApartment), rings: [3, 99], scale: [1.25, 1.75], max: 16, weight: 2.4, front: 1, skyline: true, source: 'reactor-surface'},
  {id: 'skyMidrise', role: 'midrise', ...office('ruined-midrise'), rings: [3, 99], scale: [1.15, 1.6], max: 10, weight: 1.4, front: -1, skyline: true, source: 'office'},
];

/** Registry entry by id (undefined: not registered). */
export const surfaceKitEntry = (id: string): SurfaceKitEntry | undefined => SURFACE_KIT.find(e => e.id === id);

/** Every lazy key the surface may draw (Game.sectionModelKeys on a Reactor layout: fetched behind its loading screen). */
export const surfaceModelKeys = (kit: readonly SurfaceKitEntry[] = SURFACE_KIT): string[] => [...new Set(kit.filter(e => e.url).map(e => e.key))];

/** The registry resolved against what is delivered: role -> placeable entries (a missing model drops out). */
export function resolveSurfaceKit(available: (key: string) => boolean, kit: readonly SurfaceKitEntry[] = SURFACE_KIT): Record<SurfaceRole, SurfaceKitEntry[]> {
  const out: Record<SurfaceRole, SurfaceKitEntry[]> = {highrise: [], midrise: [], lowrise: [], rubble: [], car: [], bus: [], tank: []};
  for (const e of kit) {
    if (!e.url || !(e.dims[0] > 0 && e.dims[1] > 0 && e.dims[2] > 0) || !available(e.key)) continue;
    out[e.role].push(e);
  }
  return out;
}
