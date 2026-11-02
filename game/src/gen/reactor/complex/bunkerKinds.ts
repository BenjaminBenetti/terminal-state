// Task reactor-expansion-20261101 (lane BUNKER): the bunker's HERO PROP KINDS — the lead's Meshy T2.5 models (Codex references made with
// the selected B concept; assets/reactorExpansionKit.generated.ts REACTOR_X_KIT: real size, +Y up, front +Z, grounded, centred; Meshy
// maps kept) placed as ordinary PROP placements (collision / bullets / sight from the footprint like every prop), drawn by
// world/reactor/bunkerModels.ts (instanced, level-only GLBs). Pure data. Each kind is classified here for the prop rules (root CLAUDE.md
// "Props — core design rules"; docs/prop-affordances.md): openables audit, physics audit, damage class; spread into the shared tables
// by one tagged line each (gen/props.ts PROP_DEFS, damage/materials.ts PROP_DAMAGE, damage/physicsAudit.ts, world/openablesSpec.ts).
//
// Scale (rendered beside a runtime zombie: tools/asset-pipeline/props/scale-check.mjs --prop <glb> [--scale k], 2026-11-01):
//  - bunkBed       2.00 x 1.36 x 0.85 m as cooked (lower deck ~0.25 m, upper deck top 1.12 m: a compact shelter double bunk), grounded;
//  - radioConsole  scaled x1.125 (cooked desk top 0.649 m -> 0.73 m, the worktop band): 2.25 x 1.77 x 1.34 m, grounded;
//  - airFilterUnit 3.00 x 1.84 x 0.91 m as cooked (canister bank + blower + stacks, top 1.46 m / stacks 1.84 m), grounded;
//  - blastDoor     4.95 x 4.00 x 5.45 m as cooked: a square frame round a ~2.5 m round opening (free chord >= 1.5 m from 0.79 to 2.97 m
//    above the base) with the round leaf standing OPEN at 90 degrees on its +X side. It stands grounded in the 1 m bulkhead between the
//    lock and the decontamination room; the walkway through it is a raised threshold (0.84 m: three 0.28 m risers each side, cell floors)
//    so the 1.5 m doorway's clear volume (lane 1.3 m x 2.1 m) lies inside the round opening. One placement per piece of collision:
//    variant 0 = the open leaf (+ the render anchor: model origin = centre - R(rot) . BLAST_LEAF.c), variant 1 = frame feet / pillar
//    protrusions beside the opening (collision only).

import type {PropDef} from '../../props';
import {REACTOR_X_KIT} from '../../../assets/reactorExpansionKit.generated';

export const BUNKER_KINDS = ['bunkBed', 'radioConsole', 'airFilterUnit', 'blastDoor'] as const;
export type BunkerKind = (typeof BUNKER_KINDS)[number];
const KIND_SET = new Set<string>(BUNKER_KINDS);
export const isBunkerKind = (k: string): k is BunkerKind => KIND_SET.has(k);

/** The model of each kind and its uniform runtime scale (real size = cooked dims x scale). */
export const BUNKER_MODELS: Readonly<Record<BunkerKind, {model: (typeof REACTOR_X_KIT)[keyof typeof REACTOR_X_KIT]; scale: number}>> = {
  bunkBed: {model: REACTOR_X_KIT.bunkBed, scale: 1},
  radioConsole: {model: REACTOR_X_KIT.radioConsole, scale: 1.125},
  airFilterUnit: {model: REACTOR_X_KIT.airFilter, scale: 1},
  blastDoor: {model: REACTOR_X_KIT.blastDoor, scale: 1},
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const dimsOf = (k: BunkerKind) => BUNKER_MODELS[k].model.dims.map(v => r3(v * BUNKER_MODELS[k].scale)) as [number, number, number];

/**
 * Model-space measurements of the blast door (probed from the cooked GLB, 2026-11-01): opening centre x / free chord, the frame body's
 * z span, the open leaf's box (incl. the frame foot on its side), the other frame feet and the back plinth.
 */
export const BLAST = {
  /** Opening centre (model x), the threshold walking height above the base and the opening's walkable lane half-width. */
  openX: -0.04, sill: 0.84, laneHalf: 0.75,
  /** Frame body depth span (model z; front = +z, the leaf side) and its height. */
  bodyZ: [-2.52, -0.95] as const, bodyH: 4.0,
  /** The open leaf (+ the +x foot): x / z span, height. */
  leaf: {x: [1.6, 2.47] as const, z: [-0.95, 2.72] as const, h: 3.0},
  /** Front feet / back plinth extents (model z) beside the opening. */
  frontFeetZ: -0.42, backPlinthZ: -2.72, halfW: 2.47,
} as const;
/** The leaf box centre / half extents in model space (variant 0's footprint before rotation). */
export const BLAST_LEAF = {c: [r3((BLAST.leaf.x[0] + BLAST.leaf.x[1]) / 2), r3((BLAST.leaf.z[0] + BLAST.leaf.z[1]) / 2)] as const};

export const BUNKER_PROP_DEFS: Readonly<Record<BunkerKind, PropDef>> = (() => {
  const b = dimsOf('bunkBed'), r = dimsOf('radioConsole'), f = dimsOf('airFilterUnit');
  return {
    bunkBed: {w: b[0], d: b[2], h: b[1], blocksSight: false},
    radioConsole: {w: r[0], d: r[2], h: r[1], blocksSight: false},
    airFilterUnit: {w: f[0], d: f[2], h: f[1], blocksSight: true},
    // nominal = the open leaf box (variant 0); variant 1 parts carry their own hx / hz / h per placement
    blastDoor: {w: r3(BLAST.leaf.x[1] - BLAST.leaf.x[0]), d: r3(BLAST.leaf.z[1] - BLAST.leaf.z[0]), h: BLAST.leaf.h, blocksSight: true},
  };
})();

/** Damage class (damage/materials.ts PropDamageSpec 'never' breaks: dents / sparks only, no destructibility system). */
export const BUNKER_DAMAGE_CLASS: Readonly<Record<BunkerKind, 'steel' | 'sheetMetal'>> = {
  bunkBed: 'steel', radioConsole: 'sheetMetal', airFilterUnit: 'sheetMetal', blastDoor: 'steel',
};

/** Physics audit (static, with the honest reason). */
export const BUNKER_STATIC: Readonly<Record<BunkerKind, readonly ['anchored' | 'machinery' | 'structure' | 'built-in', string]>> = {
  bunkBed: ['anchored', 'shelter double bunk: a welded steel frame (~70 kg) bolted to the floor in rows, as civil-defence bunks are: a bump or a bullet does not shove it'],
  radioConsole: ['built-in', 'radio operator\'s console: a steel desk built into its radio rack (~200 kg), cabled to the wall: it does not move'],
  airFilterUnit: ['machinery', 'air filtration unit: canister bank, blower and stacks on a skid (~600 kg), ducted into the plant room wall'],
  blastDoor: ['structure', 'blast-door frame cast into the bulkhead and its open round leaf (tonnes of steel on its hinge): structure, never moves'],
};

/** Openables audit (every kind classified; tests/openables.test.ts). */
export const BUNKER_OPEN_AUDIT: readonly {kind: BunkerKind; cls: 'exception' | 'none'; how: string}[] = [
  {kind: 'bunkBed', cls: 'none', how: 'bare steel double bunk: no door, lid or drawer (the dormitory\'s storage is its footlockers and lockers)'},
  {kind: 'radioConsole', cls: 'exception', how: 'radio operator\'s console: its drawer fronts are the console chassis\' equipment bays wired into the radio rack (live equipment, not storage); the radio room\'s storage is its own openable cabinets'},
  {kind: 'airFilterUnit', cls: 'exception', how: 'sealed air filtration plant (filter canisters, blower housing, inspection hatches bolted shut): equipment, not storage'},
  {kind: 'blastDoor', cls: 'exception', how: 'blast-door frame with its round leaf standing open on its hinge: structure; the leaf never closes (the bunker stays passable), nothing is stored in it'},
];

/** The lazy model keys a layout's bunker props need (game.ts sectionModelKeys through world/reactor/archInstall.ts). */
export function bunkerModelKeysFor(layout: {props?: readonly {kind: string}[]}): readonly string[] {
  const out = new Set<string>();
  for (const p of layout.props ?? []) if (isBunkerKind(p.kind)) out.add(BUNKER_MODELS[p.kind].model.key);
  return [...out];
}
