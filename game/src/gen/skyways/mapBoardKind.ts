// Task studio-skyways-rework-20261107-054512-01 (lane MAPS): the Skyways LOCAL DIRECTORY BOARD prop kind — `skywaysMapBoard`, a round
// freestanding directory on a pedestal (user: "local Skyways maps on boards, like Mall maps and the supplied round map-board photo"):
// a ~0.95 m round printed face tilted back 25 degrees in a steel ring rim on a shallow drum, carried by one steel column on a round
// base plate bolted to the slab; top 1.35 m. Pure data (no three.js). Placed by gen/skyways/mapBoards.ts (layout version 3 only), drawn
// by world/skywaysMapBoards.ts (procedural geometry from the existing shape materials, the face a code-drawn plan of THIS generated
// network: a per-layout runtime-composited data texture, not authored art).
//
// Classified for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into the shared tables
// by one tagged line each: gen/props.ts PROP_DEFS (+ PropKind), damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts
// PROP_PHYSICS_AUDIT, world/openablesSpec.ts OPENABLE_AUDIT:
//  - rule 1: a sealed sign, not storage (the plan sits behind a screwed acrylic face in a welded drum: no door, lid or drawer);
//  - rule 2 / 3: static, `anchored` — a ~90 kg steel pedestal bolted through its base plate (a bump or a bullet never shifts it);
//  - rule 4: nothing loose is part of it; rule 5: SKYWAYS_MAP_BOARD_SCALE below.

import type {PropDef} from '../props';
import type {DamageClass, StaticWhy} from '../../damage/materials';

export const SKYWAYS_MAPBOARD_KINDS = ['skywaysMapBoard'] as const;
export type SkywaysMapBoardKind = (typeof SKYWAYS_MAPBOARD_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(SKYWAYS_MAPBOARD_KINDS);
export const isSkywaysMapBoardKind = (k: string): k is SkywaysMapBoardKind => KIND_SET.has(k);

/**
 * The board's shape (prop frame: origin bottom centre, front +Z, metres). The face disc (`faceD`, the printed plan) sits in a steel
 * ring (`rimD` outer) whose lip stands `rimLip` in front of the face plane and `rimBack` behind it, on a drum (`drumT` behind the face,
 * radius `drumD` / 2); the disc is tilted back by `tilt` (rad: its normal looks up and forward); the face centre is at
 * (0, `centerY`, `centerZ`) so the rim's top edge reaches `top`. The column (radius `colR`) rises from the base plate (radius
 * `plateR`, `plateT` thick) into the drum's back.
 */
export const SKYWAYS_MAP_BOARD = (() => {
  const faceD = 0.95, rimD = 1.0, rimLip = 0.03, rimBack = 0.02, drumD = 0.96, drumT = 0.07, tilt = 25 * Math.PI / 180, top = 1.35;
  const R = rimD / 2, c = Math.cos(tilt), s = Math.sin(tilt);
  // highest point of the tilted rim: its top edge (+R along the disc's up axis) at the front lip (rimLip along the normal)
  const centerY = Math.round((top - R * c - rimLip * s) * 1000) / 1000;
  return {faceD, rimD, rimLip, rimBack, drumD, drumT, tilt, top, centerY, centerZ: 0.03, colR: 0.065, plateR: 0.26, plateT: 0.022} as const;
})();

/** Collision box: the rim's width, the tilted drum's depth (front lip to the back of the drum top) and the top. */
export const SKYWAYS_MAPBOARD_PROP_DEFS: Readonly<Record<SkywaysMapBoardKind, PropDef>> = {
  skywaysMapBoard: {w: SKYWAYS_MAP_BOARD.rimD, d: 0.56, h: SKYWAYS_MAP_BOARD.top, blocksSight: false},
};

export const SKYWAYS_MAPBOARD_DAMAGE_CLASS: Readonly<Record<SkywaysMapBoardKind, DamageClass>> = {skywaysMapBoard: 'steel'};

export const SKYWAYS_MAPBOARD_PHYS: Readonly<Record<SkywaysMapBoardKind, {dynamic: false; why: StaticWhy; how: string}>> = {
  skywaysMapBoard: {dynamic: false, why: 'anchored', how: 'round steel pedestal directory (~90 kg) bolted through its base plate to the floor slab: a bump or a bullet never shifts it'},
};

export const SKYWAYS_MAPBOARD_OPEN_AUDIT: readonly {kind: SkywaysMapBoardKind; cls: 'none'; role: 'equipment'; how: string}[] = [
  {kind: 'skywaysMapBoard', cls: 'none', role: 'equipment', how: 'sealed directory sign: the printed plan behind a screwed acrylic face in a welded steel drum, no door, lid or drawer'},
];

/**
 * Scale-check record (rule 5): filled from the CPU render beside the runtime zombie (tools/asset-pipeline/props/scale-check.mjs --prop
 * on the board's exact runtime geometry exported to a GLB), viewed. W x H x D, grounded contact, notes.
 */
export const SKYWAYS_MAP_BOARD_SCALE = '' as string;
