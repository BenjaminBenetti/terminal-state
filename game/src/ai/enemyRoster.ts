// Task studio-screacher-production-20261110-221858-01: THE SEEDED ENEMY ROSTER — which special enemy families a generated level
// contains AT ALL, decided once per level map from that map's own seed. Pure (no three.js, no RNG stream).
//
// User: "per level ya. 40% chance based on the seed of them spawning AT ALL ... sometimes NONE ... deterministic"; "Survivor Markets
// remain zombie free ... special level". And the direction: most enemy types become seed-based this way.
//
// THE RULE (applyEnemyRoster, run once on the finished layout by the level registry, levels/registry.ts):
//  - one roll per SEEDED family per generated level map: present = rosterRoll(level seed, family) < rate. One map = one roll: every
//    storey of an Office / Mall / Bunker / Reactor / Skyways level shares it; never per floor, per spawn or per campaign;
//  - the roll is a hash of (level seed, family key): it consumes NO existing RNG stream (layout, loot and every other spawn draw are
//    bit-identical), and the same seed gives the same roster on every revisit, reload, Retry and import;
//  - a PRESENT family is ACTUALLY in the level: it replaces 1..3 ordinary ambient zombie slots (at least one, in a valid combat
//    space) — the enemy count, the spawn indices and every other spawn stay exactly what the level's spawn profile placed;
//  - an ABSENT family has exactly zero (its weight is 0 in every pool: spawnTables ROSTER_ONLY_FAMILIES);
//  - a ZOMBIE-FREE level (the Survivor Market) never gets any family.
// Today ONE family is seeded: the Screacher, 0.4 (the user's number). Every other family is `legacy`: its existing per-spawn pool
// shares, context locks, eligibility, caps and spacing decide exactly as before — the planner does not touch it. (Proposed rates for
// them are a design proposal outside this source, not shipped.)
//
// VERSION PIN (save compatibility; the layout-version lanes' convention, level-generic): a station's section memory records the
// roster version it was first built with (lane ROSTER_LANE = {v}); a memory with visits but no record was built before the roster
// existed -> version 0 (no pass: its enemies, kills and ids stay exact); a station never entered (new campaign or an old campaign's
// unvisited node) -> the current version, recorded when it is first built. A future rule change bumps ROSTER_VERSION and gates on
// `since`, so a visited station keeps regenerating the roster it was built with.

import {hashString, mulberry32} from '../core/rng';
import type {Area, AreaKind, ZombieSpawn} from '../gen/stationTypes';
import type {LevelId} from '../levels/types';
import {spawnContextOf, spawnProfile, type EnemyFamilyId, type SpawnContextId} from './spawnTables';

/** Section-memory lane holding {v}: the roster version a station was first built with. */
export const ROSTER_LANE = 'enemy.roster';
/** 0 = before the roster (no pass); 1 = the Screacher's seeded presence (task studio-screacher-production-20261110-221858-01). */
export const ROSTER_VERSION = 1;

/** The roster version a station regenerates with, from its section memory (undefined = never touched). */
export function rosterVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[ROSTER_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 0 && rec.v <= ROSTER_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 0 : ROSTER_VERSION;
}

/** Levels that never hold an enemy of any family (the Survivor Market: a calm settlement). Every other level is a combat level. */
export const ZOMBIE_FREE_LEVELS: readonly LevelId[] = ['market'];

/** Where a seeded family may take an ordinary zombie's slot. */
export interface RosterSlotRule {
  /** Generation contexts whose ambient zombie slots qualify (the level's ordinary combat spaces). */
  readonly contexts: readonly SpawnContextId[];
  /** Area kinds / room keys (purpose or room type) that never qualify. */
  readonly excludeKinds: readonly AreaKind[];
  readonly excludeRooms: readonly string[];
  /** The area's shorter side and w x h, in cells of 0.5 m. */
  readonly minSideCells: number;
  readonly minAreaCells: number;
}

export type RosterRule =
  | {readonly mode: 'baseline'; readonly why: string}
  | {readonly mode: 'legacy'; readonly why: string}
  | {
    readonly mode: 'seeded';
    /** The first roster version that applies this rule. */
    readonly since: number;
    /** Stable hash key (never rename: it IS the roll). */
    readonly key: string;
    /** Chance a generated level map contains the family at all. */
    readonly rate: number;
    /** How many of a present family: [count, weight] rows, rolled once per level map. */
    readonly counts: readonly (readonly [number, number])[];
    readonly slots: RosterSlotRule;
    /** Preferred straight-line distance (m, 3D) between two of the family in one level. */
    readonly spacingM: number;
    /** Approved model variants (ZombieSpawn.variant), dealt in turn from a seeded start. Empty = the family has one body. */
    readonly variants: readonly string[];
    readonly why: string;
  };

/** The Screacher's model variants: one enemy type, four approved looks (ai/screacher.ts SCREACHER_VARIANTS names them). */
export const SCREACHER_VARIANT_IDS = ['sc01', 'sc02', 'sc03', 'sc04'] as const;

/**
 * THE ROSTER TABLE: one entry per registered family (Record<EnemyFamilyId, …> makes a new family decide). Only `seeded` entries are
 * acted on. The Screacher's numbers: rate 0.4 = the user's; 1-3 per selected level ("default one / few, not all zombies": 1 in 40 %, 2
 * in 40 %, 3 in 20 % of the selected levels, mean 1.8 of a level's ~30-50 enemies); slots = ambient zombies of the level's core
 * contexts in a room-sized or larger area (never a closet, stair core, elevator or washroom; never a service annex — the Strainer's
 * cramped lurking ground —, the Bunker's damp zone, a horde member or a store / convention outfit zombie); 14 m apart when the level
 * allows it. The spawn's own placement already kept it off the arrival (the profile's start keep-off) and off landings.
 */
export const FAMILY_ROSTER: Readonly<Record<EnemyFamilyId, RosterRule>> = {
  zombie: {mode: 'baseline', why: 'the ordinary infected: always present, the remainder of every pool; every other family replaces zombie slots'},
  blightbelly: {mode: 'legacy', why: 'per-spawn pool share (DEFAULT_FAMILY_SHARES 0.05 and the per-level / per-context pools): unchanged'},
  siren: {mode: 'legacy', why: 'opt-in per level with its eligibility rule, per-level cap and spacing: unchanged'},
  ratdog: {mode: 'legacy', why: 'per-spawn pool share (0.05; 0.20 in service annexes; the Reactor pools): unchanged'},
  strainer: {mode: 'legacy', why: 'context-locked to service annexes and the Bunker damp zone (STRAINER_CONTEXTS): unchanged'},
  screacher: {
    mode: 'seeded', since: 1, key: 'screacher', rate: 0.4,
    counts: [[1, 0.4], [2, 0.4], [3, 0.2]],
    slots: {
      contexts: ['station', 'street', 'floor', 'roof', 'pit', 'ring'],
      excludeKinds: ['closet'],
      excludeRooms: ['exit-stair', 'washroom', 'office-stair', 'stair-core', 'office-elevator', 'supply-closet', 'janitor-closet'],
      minSideCells: 6, minAreaCells: 80,
    },
    spacingM: 14,
    variants: SCREACHER_VARIANT_IDS,
    why: 'user: 40 % of generated levels contain Screachers at all (per level seed, deterministic); the others have none',
  },
};

/** Deterministic uniform roll in [0, 1) of one roster decision of one level seed (its own hash: no RNG stream is consumed). */
export function rosterRoll(levelSeed: number, what: string): number {
  return mulberry32(hashString(`enemy-roster:${what}`, (levelSeed >>> 0) ^ 0x51ed270b))();
}

/** True when the level map of `levelSeed` contains the seeded family at roster `version` (never in a zombie-free level). */
export function familyInRoster(family: EnemyFamilyId, level: LevelId, levelSeed: number, version: number = ROSTER_VERSION): boolean {
  const r = FAMILY_ROSTER[family];
  if (r.mode !== 'seeded' || version < r.since || ZOMBIE_FREE_LEVELS.includes(level)) return false;
  return rosterRoll(levelSeed, `${r.key}:present`) < r.rate;
}

export interface RosterFamilyReport {
  present: boolean;
  /** The count the level's roll asked for (0 when absent). */
  wanted: number;
  /** Spawn indices converted (pick order). */
  spawns: number[];
  /** 0 = the rule's slots; 1 = any ambient zombie of the rule's contexts; 2 = any ambient zombie (reported, never silent). */
  relaxed: 0 | 1 | 2;
  /** Slots that passed the rule (before the count / spacing). */
  eligible: number;
}
export interface RosterReport {
  version: number;
  level: LevelId;
  zombieFree: boolean;
  families: Partial<Record<EnemyFamilyId, RosterFamilyReport>>;
}

const REPORTS = new WeakMap<object, RosterReport>();
/** The roster a layout was generated with (undefined: no pass ran on it — a direct generator call or roster version 0). */
export function rosterOf(layout: object): RosterReport | undefined {
  return REPORTS.get(layout);
}

type RosterLayout = {
  zombies: ZombieSpawn[];
  areas?: readonly (Pick<Area, 'type' | 'purpose'> & Partial<Pick<Area, 'kind' | 'w' | 'h'>>)[];
};

function pickCount(rows: readonly (readonly [number, number])[], roll: number): number {
  let total = 0;
  for (const [, w] of rows) total += Math.max(0, w);
  let r = roll * total;
  for (const [n, w] of rows) { r -= Math.max(0, w); if (r < 0) return n; }
  return rows[rows.length - 1][0];
}

/**
 * Apply the seeded roster to a FINISHED layout (every context placed, the one family roll and its spacing pass done, hordes appended).
 * Only `archetype` (+ `variant`) of the chosen ordinary zombie spawns changes: no spawn is added, removed, moved or reordered, so the
 * per-index kill memory and every other record keep their meaning. `version` 0 (a station built before the roster) is a no-op.
 */
export function applyEnemyRoster(layout: RosterLayout, level: LevelId, levelSeed: number, version: number = ROSTER_VERSION): RosterReport {
  const report: RosterReport = {version, level, zombieFree: ZOMBIE_FREE_LEVELS.includes(level), families: {}};
  if (version < 1) return report;
  REPORTS.set(layout, report);
  if (report.zombieFree) return report;
  const profile = spawnProfile(level);
  for (const [family, rule] of Object.entries(FAMILY_ROSTER) as [EnemyFamilyId, RosterRule][]) {
    if (rule.mode !== 'seeded' || version < rule.since) continue;
    const rep: RosterFamilyReport = {present: familyInRoster(family, level, levelSeed, version), wanted: 0, spawns: [], relaxed: 0, eligible: 0};
    report.families[family] = rep;
    if (!rep.present) continue;
    rep.wanted = pickCount(rule.counts, rosterRoll(levelSeed, `${rule.key}:count`));
    // ordinary ambient zombies only: never a horde member, a store / convention outfit zombie or another family's slot
    const ambient = (s: ZombieSpawn): boolean => (s.archetype ?? 'zombie') === 'zombie' && s.horde === undefined && s.look === undefined;
    const inContext = (i: number): boolean => { const c = spawnContextOf(layout, profile, i); return c !== undefined && rule.slots.contexts.includes(c); };
    const inSpace = (s: ZombieSpawn): boolean => {
      const a = s.area !== undefined ? layout.areas?.[s.area] : undefined;
      if (!a) return false;
      const S = rule.slots;
      if (a.kind !== undefined && S.excludeKinds.includes(a.kind)) return false;
      if (S.excludeRooms.includes(a.type) || (a.purpose !== undefined && S.excludeRooms.includes(a.purpose))) return false;
      return a.w !== undefined && a.h !== undefined && Math.min(a.w, a.h) >= S.minSideCells && a.w * a.h >= S.minAreaCells;
    };
    const tiers: ((s: ZombieSpawn, i: number) => boolean)[] = [(s, i) => ambient(s) && inContext(i) && inSpace(s), (s, i) => ambient(s) && inContext(i), s => ambient(s)];
    let candidates: number[] = [];
    for (let t = 0; t < tiers.length && !candidates.length; t++) {
      candidates = layout.zombies.map((s, i) => (tiers[t](s, i) ? i : -1)).filter(i => i >= 0);
      rep.relaxed = t as 0 | 1 | 2;
    }
    rep.eligible = candidates.length;
    if (!candidates.length) continue; // a level without one ordinary zombie (none of the registered combat levels): reported, wanted > 0 and spawns empty
    // a seeded order over the candidates (stable per (seed, spawn index)); spaced picks first, then the count is what the spacing allows
    const order = candidates.map(i => [rosterRoll(levelSeed, `${rule.key}:slot:${i}`), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(r => r[1]);
    const far = (i: number): boolean => rep.spawns.every(j => {
      const a = layout.zombies[i], b = layout.zombies[j];
      return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z) >= rule.spacingM;
    });
    for (const i of order) { if (rep.spawns.length >= rep.wanted) break; if (far(i)) rep.spawns.push(i); }
    const first = rule.variants.length ? Math.floor(rosterRoll(levelSeed, `${rule.key}:variant`) * rule.variants.length) : 0;
    rep.spawns.forEach((i, k) => {
      const s = layout.zombies[i];
      s.archetype = family;
      if (rule.variants.length) s.variant = rule.variants[(first + k) % rule.variants.length];
    });
  }
  return report;
}
