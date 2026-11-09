// Task studio-bunker-level-20261109-072224-01: THE BUNKER's objective PROP KINDS — the three auxiliary generator slots
// (BUNKER_GENERATOR_KIND: the Reactor's auxiliary generator model, assets/reactorKit.generated.ts REACTOR_KIT.generator) and the
// central processing core's computer cluster (BUNKER_CORE_KIND). Ordinary prop placements (collision / bullets / sight from the
// footprint like every prop) placed by gen/bunker/dress.ts; drawn / animated / interacted with by world/bunker (the objective lane).
// Pure data. Classified for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md) and spread into
// the shared tables by one tagged line each: gen/props.ts PROP_DEFS (+ PropKind), damage/materials.ts PROP_DAMAGE,
// damage/physicsAudit.ts, world/openablesSpec.ts OPENABLE_AUDIT:
//  - rule 1: neither is storage (a diesel generator set on its skid with its control box; a bank of computer cabinets with a screen wall
//    and an operator desk wired into it) — the rooms' storage is their own openable holders;
//  - rule 2 / 3: static — the generator `anchored` machinery (a ~3 t set bolted to its plinth), the core cluster a `built-in` fixture
//    (sealed cabinets + a built-in console bolted to the floor); fronts kept clear: >= 1.6 m before a generator (2.0 m held), >= 1.75 m
//    before the cluster (3.0 m held), the processing hall's headroom 6.4 m (the screen top 3.55 m);
//  - rule 4: nothing loose is part of either (the core's operator terminal is a built-in desk console); rule 5: the dims below are the
//    Reactor model's real size (scale-checked beside a zombie with the Reactor kit) and the contract's cluster footprint.

import type {PropDef} from '../props';
import type {DamageClass, StaticWhy} from '../../damage/materials';
import {BUNKER_CORE_DIMS, BUNKER_CORE_KIND, BUNKER_GENERATOR_DIMS, BUNKER_GENERATOR_KIND} from './bunkerTypes';
import {BUNKER_KIT} from '../../assets/bunkerKit.generated';
import {REACTOR_KIT} from '../../assets/reactorKit.generated';
import {REACTOR_X_KIT} from '../../assets/reactorExpansionKit.generated';

export const BUNKER_OBJECTIVE_KINDS = [BUNKER_GENERATOR_KIND, BUNKER_CORE_KIND] as const;
export type BunkerObjectiveKind = (typeof BUNKER_OBJECTIVE_KINDS)[number];
const SET = new Set<string>(BUNKER_OBJECTIVE_KINDS);
export const isBunkerObjectiveKind = (k: string): k is BunkerObjectiveKind => SET.has(k);

/** Collision boxes (front +Z; the generator's control box side / the cluster's screen + terminal side). */
export const BUNKER_OBJECTIVE_PROP_DEFS: Readonly<Record<BunkerObjectiveKind, PropDef>> = {
  [BUNKER_GENERATOR_KIND]: {w: BUNKER_GENERATOR_DIMS.w, d: BUNKER_GENERATOR_DIMS.d, h: BUNKER_GENERATOR_DIMS.h, blocksSight: true},
  [BUNKER_CORE_KIND]: {w: BUNKER_CORE_DIMS.w, d: BUNKER_CORE_DIMS.d, h: BUNKER_CORE_DIMS.h, blocksSight: true},
};

export const BUNKER_OBJECTIVE_DAMAGE_CLASS: Readonly<Record<BunkerObjectiveKind, DamageClass>> = {[BUNKER_GENERATOR_KIND]: 'steel', [BUNKER_CORE_KIND]: 'sheetMetal'};

/** Physics-affordance rows (damage/physicsAudit.ts). */
export const BUNKER_OBJECTIVE_STATIC: Readonly<Record<BunkerObjectiveKind, readonly [StaticWhy, string]>> = {
  [BUNKER_GENERATOR_KIND]: ['anchored', 'auxiliary diesel generator set: ~3 t of engine, alternator and control box on a steel skid bolted to its plinth (a bump or a bullet never moves it)'],
  [BUNKER_CORE_KIND]: ['built-in', 'central processing cluster: sealed equipment cabinets with the screen wall and a built-in operator console, bolted to the floor and cabled into the hall (a fixture, not loose furniture)'],
};

export const BUNKER_OBJECTIVE_OPEN_AUDIT: readonly {kind: BunkerObjectiveKind; cls: 'none'; role: 'equipment'; how: string}[] = [
  {kind: BUNKER_GENERATOR_KIND, cls: 'none', role: 'equipment', how: 'auxiliary generator set: engine, alternator and control box on a skid (fuel filler and controls, no storage door, lid or drawer)'},
  {kind: BUNKER_CORE_KIND, cls: 'none', role: 'equipment', how: 'computer cluster: sealed equipment cabinets with a screen wall and a built-in operator console (live equipment, not storage)'},
];

/** Rule 5 record: real size (W x H x D) and contact. */
export const BUNKER_OBJECTIVE_SCALE = 'generator 5.60 x 2.48 x 1.67 m (the Reactor kit model at its real size, grounded on its skid; front 1.5 m+ clear); ' +
  'core cluster footprint 6.00 x 3.60 x 2.20 m (cabinets + screen wall + operator desk), grounded, back to the hall\'s far wall';

// ---------------------------------------------------------------------------------------------------------------------------------
// The shelter's MODEL-BACKED flavour kinds (follow-up: the processing core's mainframes, the decontamination showers, the plant / control
// variety) — ordinary prop placements drawn through the builder's generic instanced model path (world/builder.ts MODEL_FOR: one
// InstancedMesh per model mesh, chunk and storey; a non-uniform fit to the PropDef box = the model's own real size, so scale 1). Models:
//  - bunkerMainframe       the Bunker kit's reel-to-reel mainframe tape cabinet (assets/bunkerKit.generated.ts BUNKER_KIT.mainframe:
//                          Meshy T2.5 from a Codex reference, maps kept; 0.90 x 1.90 x 0.52 m);
//  - bunkerDeconShower     REACTOR_X_KIT.deconShower (the waste repository's decontamination shower booth, 1.76 x 2.40 x 1.50 m);
//  - bunkerControlConsole  REACTOR_KIT.controlConsole (a steel operator's console, work top 0.77 m; 3.00 x 1.54 x 1.49 m);
//  - bunkerCoolantPump     REACTOR_KIT.coolantPump (a centrifugal pump + motor on its skid: the pump hall's water pumps; 3.50 x 1.82 x 1.36 m);
//  - bunkerPipeBank        REACTOR_KIT.pipeBank (a 4 m bank of vertical risers with valves / gauges, only where the ceiling clears it).
// Scale (rule 5): every model rendered beside a runtime-scaled standing zombie (tools/asset-pipeline/props/scale-check.mjs --prop <glb>,
// 2026-11-09; renders in the task's private qa folder): grounded, the sizes above; never rescaled. Rule 4: nothing loose is part of any
// of them (the console's gauges / switches and the pump's motor are built-in). Rule 1 / 3: none is storage (classified below).

export const BUNKER_MODEL_KINDS = ['bunkerMainframe', 'bunkerDeconShower', 'bunkerControlConsole', 'bunkerCoolantPump', 'bunkerPipeBank'] as const;
export type BunkerModelKind = (typeof BUNKER_MODEL_KINDS)[number];
const MODEL_SET = new Set<string>(BUNKER_MODEL_KINDS);
export const isBunkerModelKind = (k: string): k is BunkerModelKind => MODEL_SET.has(k);

/** The model of each kind (lazy prop-library key + url / bytes / real dims [w, h, d]). */
export const BUNKER_MODEL_OF: Readonly<Record<BunkerModelKind, {key: string; url: string; bytes: number; dims: readonly number[]}>> = {
  bunkerMainframe: BUNKER_KIT.mainframe,
  bunkerDeconShower: REACTOR_X_KIT.deconShower,
  bunkerControlConsole: REACTOR_KIT.controlConsole,
  bunkerCoolantPump: REACTOR_KIT.coolantPump,
  bunkerPipeBank: REACTOR_KIT.pipeBank,
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Collision boxes = the models' real size (front +Z). */
export const BUNKER_MODEL_PROP_DEFS: Readonly<Record<BunkerModelKind, PropDef>> = Object.fromEntries(BUNKER_MODEL_KINDS.map(k => {
  const [w, h, d] = BUNKER_MODEL_OF[k].dims;
  return [k, {w: r3(w), h: r3(h), d: r3(d), blocksSight: k !== 'bunkerControlConsole' && k !== 'bunkerCoolantPump'}];
})) as Record<BunkerModelKind, PropDef>;

/** The builder's instanced model per kind (world/builder.ts MODEL_FOR): the lazy library key. */
export const BUNKER_MODEL_FOR: Readonly<Record<BunkerModelKind, string>> = Object.fromEntries(BUNKER_MODEL_KINDS.map(k => [k, BUNKER_MODEL_OF[k].key])) as Record<BunkerModelKind, string>;

/** The lazy prop-library file map of the Bunker kit (game.ts propModels; the Reactor kits' files are already in its catalogue). */
export const BUNKER_KIT_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(Object.values(BUNKER_KIT).map(m => [m.key, {url: m.url, bytes: m.bytes}]));

/** The lazy model keys a layout's model-backed Bunker kinds need (game.ts sectionModelKeys). */
export function bunkerModelKindKeysFor(layout: {props?: readonly {kind: string}[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props ?? []) if (isBunkerModelKind(p.kind)) s.add(BUNKER_MODEL_OF[p.kind].key);
  return [...s].sort();
}

export const BUNKER_MODEL_DAMAGE_CLASS: Readonly<Record<BunkerModelKind, DamageClass>> = {
  bunkerMainframe: 'sheetMetal', bunkerDeconShower: 'sheetMetal', bunkerControlConsole: 'sheetMetal', bunkerCoolantPump: 'steel', bunkerPipeBank: 'steel',
};

/** Physics-affordance rows (damage/physicsAudit.ts): static, with the honest reason. */
export const BUNKER_MODEL_STATIC: Readonly<Record<BunkerModelKind, readonly [StaticWhy, string]>> = {
  bunkerMainframe: ['anchored', 'mainframe tape cabinet: ~400 kg of steel cabinet, tape drives and logic racks bolted to the floor and cabled into the hall (a bump or a bullet never shifts it)'],
  bunkerDeconShower: ['fixture', 'decontamination shower booth: a plumbed steel booth piped to the supply and drain (a fixture)'],
  bunkerControlConsole: ['built-in', 'operator\'s control console: a steel desk built round its instruments, cabled to the wall (~250 kg)'],
  bunkerCoolantPump: ['machinery', 'centrifugal pump and motor on a skid (~1.5 t), bolted down and piped in'],
  bunkerPipeBank: ['structure', 'vertical pipe bank: risers, valves and gauges fixed to the wall and floor (structure)'],
};

/** Openables audit (world/openablesSpec.ts OPENABLE_AUDIT; every kind classified). */
export const BUNKER_MODEL_OPEN_AUDIT: readonly {kind: BunkerModelKind; cls: 'exception' | 'none'; how: string}[] = [
  {kind: 'bunkerMainframe', cls: 'exception', how: 'sealed mainframe tape cabinet: its louvred lower doors are the service panels of a live computer (logic boards, power supplies), not storage; the core hall\'s storage is its own openable cabinets'},
  {kind: 'bunkerDeconShower', cls: 'exception', how: 'decontamination shower booth: a plumbed walk-in fixture with an open front, no door, lid or drawer, nothing stored in it'},
  {kind: 'bunkerControlConsole', cls: 'exception', how: 'operator\'s control console: its lower panels are the instrument bays of the desk (live equipment, not storage); the control room\'s storage is its own filing cabinet'},
  {kind: 'bunkerCoolantPump', cls: 'none', how: 'pump and motor on a skid: machinery, no door, lid or drawer'},
  {kind: 'bunkerPipeBank', cls: 'none', how: 'pipe bank: risers, valves and gauges, no door, lid or drawer'},
];
