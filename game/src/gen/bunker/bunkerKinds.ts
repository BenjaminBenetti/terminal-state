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
