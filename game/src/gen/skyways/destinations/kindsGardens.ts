// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): the planted GALLERIES and COURTS' built-in planters (kindTypes.ts
// DestKindSpec each), merged by registry.ts into the shared tables (PROP_DEFS / PROP_DAMAGE / PROP_PHYSICS_AUDIT / OPENABLE_AUDIT).
// Placed by gen/skyways/gardens.ts; drawn by world/skywaysGardens.ts (procedural planter bodies + the office's existing potted-plant
// foliage model, sunk into the soil: no new model, no new texture).
//  - skyArchGalleryPlanter: a 1.5 m precast planter trough set along a gallery balustrade round an atrium opening (the reference's
//    dense shrubs along the railing); placed end to end into continuous troughs, gaps at stair heads, doors and bridge mouths;
//  - skyArchBenchPlanter: a built-in timber bench-planter of a skylit / atrium court (a raised planting bed with a wide slatted seat
//    along its front, the reference's court benches).
// Affordances (root CLAUDE.md "Props — core design rules"): neither reads as storage (soil beds: no door, lid or drawer — rule 1 none);
// both are built-in fixtures full of soil (hundreds of kg) — rule 3 static 'built-in' with the reason recorded; the shrubs are living
// plants rooted in the soil (part of the fixture, not loose clutter: rule 4 lists them as planting, not removable items); real-world
// scale (rule 5): GARDEN_SCALE below and docs/prop-affordances.md.

import type {DestKindSpec} from './kindTypes';

export const GARDEN_KINDS = ['skyArchGalleryPlanter', 'skyArchBenchPlanter'] as const;
export type GardenKind = (typeof GARDEN_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(GARDEN_KINDS);
export const isSkywaysGardenKind = (k: string): k is GardenKind => KIND_SET.has(k);

/** Planter sizes (m): the trough segment (along x, deep z, the soil line) and the bench-planter (seat height = its collider top). */
export const GALLERY_PLANTER = {w: 1.5, d: 0.46, h: 0.52, soil: 0.47, lip: 0.06} as const;
export const BENCH_PLANTER = {w: 2.6, d: 1.3, h: 0.46, seatD: 0.42, seatT: 0.05, rim: 0.12, soil: 0.42} as const;
/** Shrubs per planter (the foliage model instanced along its soil bed) and their size over the model's own (uniform scale). */
export const GARDEN_SHRUBS = {gallery: 4, bench: 4, scale: 2.4, jitter: 0.12} as const;

export const GARDEN_SPECS: Readonly<Record<GardenKind, DestKindSpec>> = {
  skyArchGalleryPlanter: {
    def: {w: GALLERY_PLANTER.w, d: GALLERY_PLANTER.d, h: GALLERY_PLANTER.h, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'precast concrete planter trough full of soil and shrubs (~450 kg) set against a gallery balustrade: a bump or a bullet never shifts it; the shrubs are foliage over its collider'},
    damage: 'concrete',
    open: {cls: 'none', role: 'decor', how: 'an open soil bed: no door, lid or drawer'},
  },
  skyArchBenchPlanter: {
    def: {w: BENCH_PLANTER.w, d: BENCH_PLANTER.d, h: BENCH_PLANTER.h, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'built-in timber-clad raised planting bed with a slatted bench along its front (tonnes of soil), fixed to the court floor: its collider is the seat-height box; the shrubs are foliage'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'a raised soil bed with a bench rim: no door, lid or drawer'},
  },
};

/**
 * Scale-check record (rule 5; tools/asset-pipeline/props/scale-check.mjs beside a runtime-scaled zombie): W x H x D, contact, notes.
 */
export const GARDEN_SCALE: Readonly<Record<GardenKind, string>> = {
  skyArchGalleryPlanter: '1.50 x 0.52 x 0.46 m trough (soil line 0.47 m), 2.01 x 1.19 x 1.19 m with its shrubs (foliage to 1.19 m); grounded on its full base (4 contact corners): knee-high against the 1.0 m balustrade, the shrubs just over the rail',
  skyArchBenchPlanter: '2.60 x 0.46 x 1.30 m (seat 0.46 m, 0.42 m deep), 2.70 x 1.03 x 1.42 m with its shrubs (foliage to 1.03 m); grounded on its full base (4 contact corners): a bench seat at chair height',
};
