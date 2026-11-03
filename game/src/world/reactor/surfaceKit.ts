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
  source: 'reactor-surface' | 'office' | 'company';
}

const S = REACTOR_SURFACE_KIT;
const office = (id: OfficeAssetId) => {
  const a = OFFICE_ASSETS[id];
  return {key: `office-${id}`, url: a.url ?? '', dims: (a.dims ?? [a.sizeM, a.sizeM, a.sizeM]) as readonly [number, number, number]};
};
const tank = COMPANY_ASSETS['water-tower'];

/** THE registry (order = no meaning; the plan is seeded). */
export const SURFACE_KIT: readonly SurfaceKitEntry[] = [
  // --- the lead's new kit (task reactor-surface-ending) ---
  {id: 'cityHighrise', role: 'highrise', key: S.cityHighrise.key, url: S.cityHighrise.url, dims: S.cityHighrise.dims, rings: [2, 9], scale: [0.85, 1.1], max: 8, weight: 3, front: 1, source: 'reactor-surface'},
  {id: 'cityApartment', role: 'midrise', key: S.cityApartment.key, url: S.cityApartment.url, dims: S.cityApartment.dims, rings: [1, 9], scale: [0.88, 1.12], max: 12, weight: 3, front: 1, source: 'reactor-surface'},
  {id: 'cityGarage', role: 'midrise', key: S.cityGarage.key, url: S.cityGarage.url, dims: S.cityGarage.dims, rings: [1, 4], scale: [0.9, 1.12], max: 6, weight: 1.6, front: 1, source: 'reactor-surface'},
  {id: 'cityStorefronts', role: 'lowrise', key: S.cityStorefronts.key, url: S.cityStorefronts.url, dims: S.cityStorefronts.dims, rings: [1, 3], scale: [0.92, 1.1], max: 18, weight: 3, front: 1, source: 'reactor-surface'},
  // --- the approved Office exterior kit (already in the pack: 0 B) ---
  {id: 'ruinedTower', role: 'highrise', ...office('ruined-tower'), rings: [2, 9], scale: [0.85, 1.08], max: 5, weight: 2, front: -1, source: 'office'},
  {id: 'ruinedMidrise', role: 'midrise', ...office('ruined-midrise'), rings: [1, 9], scale: [0.85, 1.1], max: 10, weight: 2.2, front: -1, source: 'office'},
  {id: 'carWreck', role: 'car', ...office('car-wreck'), rings: [0, 2], scale: [0.95, 1.05], max: 16, weight: 1, front: -1, longX: true, source: 'office'},
  {id: 'busWreck', role: 'bus', ...office('bus-wreck'), rings: [0, 2], scale: [0.97, 1.03], max: 3, weight: 1, front: -1, longX: true, source: 'office'},
  {id: 'rubblePile', role: 'rubble', ...office('rubble-pile'), rings: [0, 9], scale: [0.7, 2.6], max: 36, weight: 1, front: -1, source: 'office'},
  {id: 'waterTower', role: 'tank', key: 'office-water-tower', url: tank.url ?? '', dims: (tank.dims ?? [4.6, 4.5, 4.6]) as readonly [number, number, number],
    rings: [1, 3], scale: [0.95, 1.1], max: 4, weight: 1, front: -1, stand: 7, source: 'company'},
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
