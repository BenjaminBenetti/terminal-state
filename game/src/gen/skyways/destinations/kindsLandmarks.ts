// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.
// (The lead pre-defined the two SHARED art kinds every dressing lane places: skyDPoster and skyDPlaque — gen/skyways/destinations/art.ts.)
//
// The six LANDMARK heroes (one per court family, gen/skyways/carve.ts LANDMARK_FAMILIES; placed by landmarks.ts dressLandmark) render
// the Meshy kit models (assets/skywaysDestProps.generated.ts: lm-clock / lm-dino / lm-tree / lm-fountain / lm-geese / lm-orrery, front
// +Z, real size; the Codex concept -> Meshy maps kept) through world/skywaysDestinations.ts. Every footprint / height below is DERIVED
// from that table (the lead's planned sizes until lane KITS writes the measured ones: they flow through), never a literal size:
//  - skyDClock: the cast-iron clock tower on its stone plinth — the whole model box (the plinth is its widest part);
//  - skyDDinosaur: the hadrosaur skeleton cast on its plinth with steel rods — the whole model box (head, tail and plinth: you bump
//    the bones before you could walk under them); lies along the court's longer axis (model long axis X);
//  - skyDFigTree: the fig in its raised round planter with the slatted ring bench — a ROUND collider of the ring bench (variant 0, to
//    the seat) plus collision-only cylinders of the raised planter (variant 1, to its rim) and the trunk (variant 2, up into the crown);
//    the leafy crown is drawn only;
//  - skyDFountain: the dry three-tier stone fountain — a ROUND collider of the basin (variant 0, to its rim) plus a collision-only
//    COLUMN cylinder (variant 1) through the tiers;
//  - skyDGeese: the bronze flock of Canada geese hung from the atrium roof — mounted high (no floor footprint), its cables drawn to
//    the ceiling by the renderer;
//  - skyDOrrery: the brass armillary sphere on its stone plinth — a ROUND collider of the sphere.
// All six are classified static with honest reasons (rule 3: anchored / built-in / mounted exhibits, never storage, never loose) and
// their damage classes mark only (damage/materials.ts NEVER). Scale (rule 5): LANDMARK_SCALE below.

import type {DestKindSpec} from './kindTypes';
import {DEST_POSTER} from './art';
import {SKYWAYS_DEST_PROPS} from '../../../assets/skywaysDestProps.generated';
import type {SkywaysLandmarkFamily} from '../skywaysTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const M = SKYWAYS_DEST_PROPS;

/**
 * The heroes' collision shape as fractions of the model's box (w along X, h) — measured by vertex slices / radial height profiles on
 * the accepted Meshy raws and lane KITS's runtime files (lane LANDMARKS, 2026-11-06; uniform scaling keeps the fractions):
 *  - fig tree (7.48 x 7.00 x 7.35 m): the slatted ring bench (outer radius 0.42 w) with its seat at 0.133 h, the raised planter
 *    inside it (radius 0.333 w) to its rim / soil at 0.24 h, the trunk out of the soil (radius ~0.05 w above the root flare) into the
 *    crown from ~0.40 h; the crown spans the whole w;
 *  - fountain (4.40 x 3.85 x 4.40 m): the round basin (radius 0.5 w; its wall 0.85-1.0 of the radius) to its rim at 0.216 h (the dry
 *    basin floor inside at ~0.11 h); above it the column (radius ~0.12 w) carrying the middle bowl (radius 0.26 w at 0.55-0.65 h) and
 *    the top bowl (0.14 w at 0.85-0.9 h): the column cylinder is taken at 0.14 w (column plus the bowls' inner rings; a bowl's outer
 *    lip may let a shot past).
 */
export const LANDMARK_SHAPE = {
  tree: {ringR: 0.42, seat: 0.133, planterR: 0.333, rim: 0.24, trunkR: 0.05, trunkTop: 0.40},
  fountain: {rim: 0.216, columnR: 0.14},
} as const;

/** Wall poster: the frame's base height above the floor (its centre at DEST_POSTER.y). Place with placeKit.mountProp at this y. */
export const DEST_POSTER_BASE_Y = r3(DEST_POSTER.y - (DEST_POSTER.h + 0.04) / 2);
/** Court plaque lectern: the plaque face (3:2 art) and the slope of the cast head (rotation about X; the face looks up and forward). */
export const DEST_PLAQUE = {w: 0.72, h: 0.48, tilt: -0.62} as const;

export const LANDMARKS_KINDS = ['skyDPoster', 'skyDPlaque', 'skyDClock', 'skyDDinosaur', 'skyDFigTree', 'skyDFountain', 'skyDGeese', 'skyDOrrery'] as const;
export type LandmarksKind = (typeof LANDMARKS_KINDS)[number];

/** The hero kind of each landmark family. */
export const LANDMARK_KIND: Readonly<Record<SkywaysLandmarkFamily, LandmarksKind>> = {
  clock: 'skyDClock', dinosaur: 'skyDDinosaur', 'fig-tree': 'skyDFigTree', fountain: 'skyDFountain', geese: 'skyDGeese', orrery: 'skyDOrrery',
};
/** Round-collider heroes (an upright cylinder of radius w / 2, any yaw; PropPlacement.round). */
export const LANDMARK_ROUND: ReadonlySet<string> = new Set(['skyDFigTree', 'skyDFountain', 'skyDOrrery']);

const T = LANDMARK_SHAPE.tree, F = LANDMARK_SHAPE.fountain;
const tree = M.skyways_d_lm_tree, fountain = M.skyways_d_lm_fountain, orrery = M.skyways_d_lm_orrery;

/**
 * The collision-only upper cylinders of a hero (each a placement of the same kind with its `variant` >= 1, standing on the part below;
 * radius, base and top above the hero's base in unscaled model metres): the fig tree's planter and trunk, the fountain's column.
 */
export function landmarkUppers(kind: string): readonly {variant: number; r: number; y0: number; y1: number}[] {
  if (kind === 'skyDFigTree') return [{variant: 1, r: r3(T.planterR * tree.w), y0: r3(T.seat * tree.h), y1: r3(T.rim * tree.h)}, {variant: 2, r: r3(T.trunkR * tree.w), y0: r3(T.rim * tree.h), y1: r3(T.trunkTop * tree.h)}];
  if (kind === 'skyDFountain') return [{variant: 1, r: r3(F.columnR * fountain.w), y0: r3(F.rim * fountain.h), y1: fountain.h}];
  return [];
}
/** A placement that is collision only (a hero's upper part): the renderer draws nothing for it. */
export const destCollisionOnly = (p: {kind: string; variant: number}): boolean => p.variant >= 1 && landmarkUppers(p.kind).some(u => u.variant === p.variant);

export const LANDMARKS_SPECS: Readonly<Record<LandmarksKind, DestKindSpec>> = {
  skyDPoster: {
    def: {w: DEST_POSTER.w + 0.04, d: 0.03, h: DEST_POSTER.h + 0.04, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'paper poster in an aluminium snap frame screwed to a shop wall (variant = art piece, art.ts DEST_POSTER_PIECES)'},
    damage: 'cardboard',
    open: {cls: 'none', role: 'decor', how: 'framed wall poster'},
  },
  skyDPlaque: {
    def: {w: 0.82, d: 0.36, h: 1.22, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'cast-bronze court plaque on a heavy cast-iron lectern pedestal (~70 kg) bolted to the court floor'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'solid plaque pedestal: nothing to open'},
  },
  skyDClock: {
    def: {w: M.skyways_d_lm_clock.w, d: M.skyways_d_lm_clock.d, h: M.skyways_d_lm_clock.h, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'cast-iron public clock tower (several tonnes) on a stone plinth bolted into the court slab: a bump or a bullet never shifts it'},
    damage: 'steel',
    model: 'skyways_d_lm_clock',
    open: {cls: 'exception', role: 'equipment', how: 'the glazed pendulum door is a locked service hatch on the clock movement (equipment, not storage): nothing inside to take'},
  },
  skyDDinosaur: {
    def: {w: M.skyways_d_lm_dino.w, d: M.skyways_d_lm_dino.d, h: M.skyways_d_lm_dino.h, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'hadrosaur skeleton cast mounted on steel rods bolted to a long display plinth (~1.5 t): a museum exhibit fixed in place'},
    damage: 'plaster',
    model: 'skyways_d_lm_dino',
    open: {cls: 'none', role: 'decor', how: 'skeleton cast on a solid plinth: nothing to open'},
  },
  skyDFigTree: {
    def: {w: r3(2 * T.ringR * tree.w), d: r3(2 * T.ringR * tree.w), h: r3(T.seat * tree.h), blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'living fig in a raised masonry planter with a slatted ring bench, built into the court floor (tonnes of soil): its colliders are the ring bench, the planter and the trunk (round); the crown is foliage'},
    damage: 'concrete',
    model: 'skyways_d_lm_tree',
    open: {cls: 'none', role: 'decor', how: 'masonry planter full of soil with a bench round it: no door, lid or drawer'},
  },
  skyDFountain: {
    def: {w: Math.min(fountain.w, fountain.d), d: Math.min(fountain.w, fountain.d), h: r3(F.rim * fountain.h), blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'dry three-tier stone fountain plumbed into the court floor: its collider is the round basin to its rim plus the central column through the tiers'},
    damage: 'concrete',
    model: 'skyways_d_lm_fountain',
    open: {cls: 'none', role: 'decor', how: 'solid stone basin and tiers: nothing to open'},
  },
  skyDGeese: {
    def: {w: M.skyways_d_lm_geese.w, d: M.skyways_d_lm_geese.d, h: M.skyways_d_lm_geese.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'bronze flock of Canada geese on a suspension ring hung on cables from the atrium roof, far above head height (no floor contact)'},
    damage: 'steel',
    model: 'skyways_d_lm_geese',
    open: {cls: 'none', role: 'decor', how: 'hung bronze sculpture: nothing to open'},
  },
  skyDOrrery: {
    def: {w: Math.min(orrery.w, orrery.d), d: Math.min(orrery.w, orrery.d), h: orrery.h, blocksSight: false},
    phys: {dynamic: false, why: 'anchored', how: 'brass armillary sphere (~1 t) on a stone plinth bolted to the court floor: its collider is the sphere\'s round footprint'},
    damage: 'steel',
    model: 'skyways_d_lm_orrery',
    open: {cls: 'none', role: 'decor', how: 'brass rings round a solid globe on a solid plinth: nothing to open'},
  },
};

/**
 * Scale-check record (rule 5; tools/asset-pipeline/props/scale-check.mjs beside zombie `lastshift` at runtime scale 1.0, viewed;
 * renders in the task's private qa/landmarks folder). Filled from the renders of the raws at the planned real size until the KITS
 * runtime files land (then re-checked on them).
 */
export const LANDMARK_SCALE: Readonly<Partial<Record<LandmarksKind, string>>> = {};
