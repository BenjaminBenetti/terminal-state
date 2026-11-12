// Task studio-screacher-production-20261110-221858-01: THE SEEDED ENEMY ROSTER — which special enemy families a generated level
// contains AT ALL, decided once per level map from that map's own seed. Pure (no three.js, no RNG stream).
//
// User (the Screacher): "per level ya. 40% chance based on the seed of them spawning AT ALL ... sometimes NONE ... deterministic";
// "Survivor Markets remain zombie free ... special level". User (every other family, the roster proposal with the concentration
// option B): "I like it, lets go!" — Blightbelly 60 % (Reactor 100 %), rat/dog 60 % (Reactor 100 %), Siren 85 % on her existing levels
// (Subway 0), Strainer 35 % of the levels that have its contexts; ordinary zombies always the baseline.
//
// THE RULE (applyEnemyRoster, run once on the FINISHED layout by the level registry, levels/registry.ts):
//  - one INDEPENDENT roll per family per generated level map: present = rosterRoll(level seed, family) < rate. One map = one roll:
//    every storey of an Office / Mall / Bunker / Reactor / Skyways level shares it; never per floor, per spawn or per campaign;
//  - every roll is a hash of (level seed, a key): NO existing RNG stream is consumed (layout, loot and every spawn's position, type
//    and per-spawn family draw are bit-identical), and the same seed gives the same roster on every revisit, reload, Retry and import;
//  - families only ever swap with ORDINARY AMBIENT ZOMBIE slots: the enemy count, the spawn positions and the spawn indices (the
//    per-index kill memory) never change. Roaming-horde members and store / convention outfit zombies are never touched;
//  - an ABSENT family has exactly none in that level: what its per-spawn roll placed becomes an ordinary zombie (the eligibility
//    fallback's rule: nothing is renormalised, no other family's draw moves);
//  - a PRESENT family is really there, by its placement policy (RosterPlacement below);
//  - a ZOMBIE-FREE level (the Survivor Market) never gets any family: it has no enemies at all.
// Order: first every roll (absent families are cleared), then the present families the MOST CONSTRAINED FIRST — the context-locked
// Strainer, the room-eligible Siren, the counted Screacher, then the share top-ups — each on the ordinary zombie slots still left. A
// constrained family whose only legal slot holds an unrestricted family's member (the Bunker's one damp spawn rolled a rat/dog)
// takes it, and that member is exchanged to an ordinary slot elsewhere: a selected Strainer is ALWAYS exactly one.
//
// VERSION PIN (save compatibility; the layout-version lanes' convention, level-generic): a station's section memory records the
// roster version it was first built with (lane ROSTER_LANE = {v}); a memory with visits but no record was built before the roster
// existed -> version 0 (no pass: its enemies, kills and ids stay exact); a station never entered (new campaign or an old campaign's
// unvisited node) -> the current version, recorded when it is first built. A future rule change bumps ROSTER_VERSION and gates on
// `since`, so a visited station keeps regenerating the roster it was built with.
//
// Task studio-sprinter-zombies-20261112-033210-01: version 2 = version 1's families, unchanged, + the SPRINTERS (ai/sprinter.ts): after the
// families are placed, a seeded 10 % of the eligible ordinary zombies are tagged to run while they pursue. A station recorded at 1 (or 0)
// regenerates exactly as before — no sprinters; only a station first built at 2 has them.

import {hashString, mulberry32} from '../core/rng';
import type {Area, AreaKind, ZombieSpawn} from '../gen/stationTypes';
import type {LevelId} from '../levels/types';
import {
  ENEMY_FAMILY_IDS, STRAINER_CONTEXTS, eligibilityFailure, roomFamilyPool, spawnContextOf, spawnProfile,
  type EligibilityLayout, type EnemyFamilyId, type FamilyPool, type SpawnContextId, type SpawnProfile,
} from './spawnTables';
import {SPRINTER, applySprinters, type SprinterReport} from './sprinter';

/** Section-memory lane holding {v}: the roster version a station was first built with. */
export const ROSTER_LANE = 'enemy.roster';
/**
 * 0 = before the roster (no pass); 1 = the seeded roster: the Screacher's 40 % and the user-approved rates of the existing families
 * (one version: it was finalised before its first release); 2 = the same families + the sprinters (ai/sprinter.ts SPRINTER.since).
 */
export const ROSTER_VERSION = 2;

/** The roster version a station regenerates with, from its section memory (undefined = never touched). */
export function rosterVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[ROSTER_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 0 && rec.v <= ROSTER_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 0 : ROSTER_VERSION;
}

/** Levels that never hold an enemy of any family (the Survivor Market: a calm settlement). Every other level is a combat level. */
export const ZOMBIE_FREE_LEVELS: readonly LevelId[] = ['market'];

/** Where a counted family (the Screacher) may take an ordinary zombie's slot. */
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

/**
 * HOW a present family is placed:
 *  - 'share-topup' (Blightbelly, rat/dog — the approved option B): its existing per-spawn pool share stays, and each remaining
 *    ordinary zombie slot whose pool gives the family weight converts with chance share x (1 / rate - 1) x (slots / zombie slots), so a
 *    present level holds about (today's count) / rate and the long-run family total stays about today's — concentrated on fewer levels;
 *  - 'eligible-min-one' (Siren): her existing draw weight, room eligibility, per-level cap and spacing decide as before; if that left
 *    none and an ordinary zombie stands where she is eligible, that one is converted (at least one when a room qualifies);
 *  - 'context-one' (Strainer): only levels that have spawns in its contexts (a service annex, the Bunker's damp zone); exactly one of
 *    it there — an existing one is kept, extras become zombies, and with none an ordinary zombie slot of those contexts is converted;
 *  - 'count' (Screacher): placed by the roster alone (weight 0 in every pool): `counts` of it replace ordinary zombies in `slots`.
 */
export type RosterPlacement =
  | {readonly place: 'share-topup'}
  | {readonly place: 'eligible-min-one'}
  | {readonly place: 'context-one'; readonly contexts: readonly SpawnContextId[]}
  | {
    readonly place: 'count';
    /** How many of a present family: [count, weight] rows, rolled once per level map. */
    readonly counts: readonly (readonly [number, number])[];
    readonly slots: RosterSlotRule;
    /** Preferred straight-line distance (m, 3D) between two of the family in one level. */
    readonly spacingM: number;
    /** Approved model variants (ZombieSpawn.variant), dealt in turn from a seeded start. */
    readonly variants: readonly string[];
  };

export type RosterRule =
  | {readonly mode: 'baseline'; readonly why: string}
  | ({
    readonly mode: 'seeded';
    /** The first roster version that applies this rule. */
    readonly since: number;
    /** Stable hash key (never rename: it IS the roll). */
    readonly key: string;
    /** Chance a generated level map contains the family at all; `levelRates` overrides it per level. */
    readonly rate: number;
    readonly levelRates?: Readonly<Partial<Record<LevelId, number>>>;
    readonly why: string;
  } & RosterPlacement);

/** The Screacher's model variants: one enemy type, four approved looks (ai/screacher.ts SCREACHER_VARIANTS names them). */
export const SCREACHER_VARIANT_IDS = ['sc01', 'sc02', 'sc03', 'sc04'] as const;

/**
 * THE ROSTER TABLE: one entry per registered family (Record<EnemyFamilyId, …> makes a new family decide). The rates are the user's:
 *  - Blightbelly / rat/dog 0.6, the Reactor 1 (its depth grading is built on them); before the roster a 5 % per-spawn roll put them in
 *    63-96 % of levels by accident — now a level has them or does not, and option B keeps about as many overall;
 *  - Siren 0.85 where her spawn profile already makes her eligible (never the Subway: no eligibility rule there) — about today's
 *    incidence (83-92 %), with her standing counts ("average 2 per mall") left to her existing draw, cap and spacing;
 *  - Strainer 0.35 of the levels that have its contexts — about an annex's former chance of one (37 %) as one clean roll, never two;
 *  - Screacher 0.4: 1-3 per selected level ("one / few, not all zombies": 1 in 40 %, 2 in 40 %, 3 in 20 % of the selected levels) in
 *    place of ambient zombies of the level's core contexts in a room-sized or larger area (never a closet, stair core, elevator or
 *    washroom; never a service annex — the Strainer's cramped ground —, the Bunker's damp zone, a horde member or an outfit zombie),
 *    14 m apart when the level allows it. The spawn's own placement already kept it off the arrival and off landings.
 */
export const FAMILY_ROSTER: Readonly<Record<EnemyFamilyId, RosterRule>> = {
  zombie: {mode: 'baseline', why: 'the ordinary infected: always present, never rolled; every other family replaces ordinary zombie slots'},
  blightbelly: {mode: 'seeded', since: 1, key: 'blightbelly', rate: 0.6, levelRates: {reactor: 1}, place: 'share-topup',
    why: 'user-approved: 60 % of levels (Reactor always); option B holds the long-run total'},
  siren: {mode: 'seeded', since: 1, key: 'siren', rate: 0.85, place: 'eligible-min-one',
    why: 'user-approved: 85 % of the levels where she is eligible (never the Subway); eligibility, cap and spacing unchanged; at least one when a room qualifies'},
  ratdog: {mode: 'seeded', since: 1, key: 'ratdog', rate: 0.6, levelRates: {reactor: 1}, place: 'share-topup',
    why: 'user-approved: 60 % of levels (Reactor always); option B holds the long-run total'},
  strainer: {mode: 'seeded', since: 1, key: 'strainer', rate: 0.35, place: 'context-one', contexts: STRAINER_CONTEXTS,
    why: 'user-approved: 35 % of the levels that have a service annex / the Bunker damp zone; exactly one there when present'},
  screacher: {
    mode: 'seeded', since: 1, key: 'screacher', rate: 0.4, place: 'count',
    counts: [[1, 0.4], [2, 0.4], [3, 0.2]],
    slots: {
      contexts: ['station', 'street', 'floor', 'roof', 'pit', 'ring'],
      excludeKinds: ['closet'],
      excludeRooms: ['exit-stair', 'washroom', 'office-stair', 'stair-core', 'office-elevator', 'supply-closet', 'janitor-closet', 'electrical-closet'],
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

/** The family's inclusion rate on a level (0 for the baseline zombie — it is never rolled — and in a zombie-free level). */
export function rosterRate(family: EnemyFamilyId, level: LevelId): number {
  const r = FAMILY_ROSTER[family];
  if (r.mode !== 'seeded' || ZOMBIE_FREE_LEVELS.includes(level)) return 0;
  return r.levelRates?.[level] ?? r.rate;
}

/**
 * THE ROLL: true when the level map of `levelSeed` includes the seeded family at roster `version`. (Whether the level can hold the
 * family at all — a Siren needs her profile's eligibility, a Strainer its contexts — is the layout's part: RosterFamilyReport.eligible.)
 */
export function familyInRoster(family: EnemyFamilyId, level: LevelId, levelSeed: number, version: number = ROSTER_VERSION): boolean {
  const r = FAMILY_ROSTER[family];
  if (r.mode !== 'seeded' || version < r.since || ZOMBIE_FREE_LEVELS.includes(level)) return false;
  return rosterRoll(levelSeed, `${r.key}:present`) < rosterRate(family, level);
}

export interface RosterFamilyReport {
  /** The level can hold the family at all (its pools / eligibility / contexts). An ineligible level is never rolled into it. */
  eligible: boolean;
  /** Eligible and the level's roll included it. */
  present: boolean;
  /** Of the family among the ambient spawns before / after the pass. */
  before: number;
  after: number;
  /** Per-spawn-roll placements turned into ordinary zombies (absent family; a Strainer beyond the one). */
  removed: number;
  /** Ordinary zombie slots converted to the family (top-up / at-least-one / exactly-one / count). */
  added: number;
  /** 'count' only: the count the level's roll asked for; 0 = the rule's slots, 1 = any ambient zombie of its contexts, 2 = any ambient zombie. */
  wanted?: number;
  relaxed?: 0 | 1 | 2;
  /** Present, but the level has no spawn where the family may stand (a Siren without any enemy in an eligible room); reported, never silent. */
  noSlot?: boolean;
}
export interface RosterReport {
  version: number;
  level: LevelId;
  zombieFree: boolean;
  families: Partial<Record<EnemyFamilyId, RosterFamilyReport>>;
  /** Version >= SPRINTER.since on a combat level: the sprinter tags of the finished layout (ai/sprinter.ts); absent = none rolled. */
  sprinters?: SprinterReport;
}

const REPORTS = new WeakMap<object, RosterReport>();
/** The roster a layout was generated with (undefined: no pass ran on it — a direct generator call or roster version 0). */
export function rosterOf(layout: object): RosterReport | undefined {
  return REPORTS.get(layout);
}

type RosterLayout = EligibilityLayout & {
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
 * The order present families are placed in (lower first; ties in ENEMY_FAMILY_IDS order): the MOST CONSTRAINED FIRST — the
 * context-locked one, the room-eligible one, the counted one, then the share top-ups (which may stand anywhere their pools allow).
 */
export const ROSTER_PLACE_PRIORITY: Readonly<Record<RosterPlacement['place'], number>> = {'context-one': 0, 'eligible-min-one': 1, count: 2, 'share-topup': 3};

/** A family's share of a pool (0 for an empty pool). */
function shareOf(pool: FamilyPool, family: EnemyFamilyId): number {
  let total = 0, w = 0;
  for (const [f, x] of pool) { total += Math.max(0, x); if (f === family) w = Math.max(0, x); }
  return total > 0 ? w / total : 0;
}

/** True when some pool of the profile (the level's or a context's) gives the family weight. */
function inSomePool(profile: SpawnProfile, family: EnemyFamilyId): boolean {
  if (shareOf(profile.families, family) > 0) return true;
  return Object.values(profile.contexts).some(c => c?.families !== undefined && shareOf(c.families, family) > 0);
}

/**
 * Apply the seeded roster to a FINISHED layout (every context placed, the one family roll and its spacing pass done, hordes appended).
 * Only `archetype` (+ `variant`) of ambient spawns changes, and only between a family and the ordinary zombie: no spawn is added,
 * removed, moved or reordered, so the per-index kill memory and every other record keep their meaning. `version` 0 (a station built
 * before the roster) is a no-op.
 */
export function applyEnemyRoster(layout: RosterLayout, level: LevelId, levelSeed: number, version: number = ROSTER_VERSION): RosterReport {
  const report: RosterReport = {version, level, zombieFree: ZOMBIE_FREE_LEVELS.includes(level), families: {}};
  if (version < 1) return report;
  REPORTS.set(layout, report);
  if (report.zombieFree) return report;
  const profile = spawnProfile(level), Z = layout.zombies;
  const ctxOf = (i: number): SpawnContextId | undefined => spawnContextOf(layout, profile, i);
  const arch = (s: ZombieSpawn): EnemyFamilyId => s.archetype ?? 'zombie';
  /** An AMBIENT spawn: not a roaming-horde member, not a store / convention outfit zombie. */
  const ambient = (s: ZombieSpawn): boolean => s.horde === undefined && s.look === undefined;
  const ordinary = (s: ZombieSpawn): boolean => ambient(s) && arch(s) === 'zombie';
  const poolOf = (i: number): FamilyPool => {
    const s = Z[i], area = s.area !== undefined ? layout.areas?.[s.area] : undefined, c = ctxOf(i);
    return roomFamilyPool(profile, area, (c && profile.contexts[c]?.families) || profile.families);
  };
  const toZombie = (s: ZombieSpawn): void => { s.archetype = 'zombie'; delete s.variant; };
  const count = (f: EnemyFamilyId): number => Z.reduce((n, s) => n + (ambient(s) && arch(s) === f ? 1 : 0), 0);
  /** Candidate indices in a seeded order (stable per (seed, family, spawn index)). */
  const seeded = (key: string, idx: number[]): number[] => idx.map(i => [rosterRoll(levelSeed, `${key}:slot:${i}`), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(r => r[1]);

  // PHASE 1 — the rolls. An ABSENT family has exactly none: what its per-spawn roll placed is an ordinary zombie in this level.
  const seededFamilies = ENEMY_FAMILY_IDS.filter(f => { const r = FAMILY_ROSTER[f]; return r.mode === 'seeded' && version >= r.since; });
  for (const family of seededFamilies) {
    const rule = FAMILY_ROSTER[family] as Extract<RosterRule, {mode: 'seeded'}>;
    const rep: RosterFamilyReport = {eligible: false, present: false, before: count(family), after: 0, removed: 0, added: 0};
    report.families[family] = rep;
    rep.eligible = rule.place === 'count' ? true
      : rule.place === 'context-one' ? Z.some((s, i) => ambient(s) && rule.contexts.includes(ctxOf(i) as SpawnContextId))
        : rule.place === 'eligible-min-one' ? profile.eligibility?.[family] !== undefined && inSomePool(profile, family)
          : inSomePool(profile, family);
    rep.present = rep.eligible && familyInRoster(family, level, levelSeed, version);
    if (!rep.present) Z.forEach(s => { if (ambient(s) && arch(s) === family) { toZombie(s); rep.removed++; } });
  }
  /**
   * A constrained family took the slot of a member of an unrestricted (share) family `d`: that member is given an ordinary zombie
   * slot elsewhere whose pool gives `d` weight (a type exchange: both families keep their numbers, the spawn records stay put).
   */
  const compensate = (key: string, d: EnemyFamilyId): void => {
    const cand = seeded(`${key}:give:${d}`, Z.map((s, i) => (ordinary(s) && shareOf(poolOf(i), d) > 0 ? i : -1)).filter(i => i >= 0));
    if (cand.length) Z[cand[0]].archetype = d;
  };
  /** Ambient members of an unrestricted (share-topup) family: the only ones a constrained family may displace. */
  const displaceable = (s: ZombieSpawn): boolean => { const r = FAMILY_ROSTER[arch(s)]; return ambient(s) && r.mode === 'seeded' && r.place === 'share-topup'; };

  // PHASE 2 — the present families, the MOST CONSTRAINED FIRST (a family that may only stand in a few places claims its place before
  // the families that may stand anywhere): the context-locked one, the room-eligible one, the counted one, then the share top-ups.
  const PRIORITY = ROSTER_PLACE_PRIORITY;
  const ordered = seededFamilies.map((f, k) => [f, k] as const).sort((a, b) => {
    const pa = PRIORITY[(FAMILY_ROSTER[a[0]] as Extract<RosterRule, {mode: 'seeded'}>).place], pb = PRIORITY[(FAMILY_ROSTER[b[0]] as Extract<RosterRule, {mode: 'seeded'}>).place];
    return pa - pb || a[1] - b[1];
  }).map(r => r[0]);
  for (const family of ordered) {
    const rule = FAMILY_ROSTER[family] as Extract<RosterRule, {mode: 'seeded'}>;
    const rep = report.families[family]!;
    if (!rep.present) continue;
    if (rule.place === 'share-topup') {
      const rate = rosterRate(family, level);
      if (rate < 1) {
        // option B: slots whose pool gives the family weight; the top-up chance per ordinary slot is scaled by slots / zombie slots so
        // the expected extra is share x (1 / rate - 1) per slot of the level, whatever else already took slots
        const withShare: number[] = [];
        Z.forEach((s, i) => { if (ambient(s) && shareOf(poolOf(i), family) > 0) withShare.push(i); });
        const zombieSlots = withShare.filter(i => ordinary(Z[i]));
        const k = zombieSlots.length ? (1 / rate - 1) * withShare.length / zombieSlots.length : 0;
        for (const i of zombieSlots) {
          if (rosterRoll(levelSeed, `${rule.key}:topup:${i}`) < Math.min(1, shareOf(poolOf(i), family) * k)) { Z[i].archetype = family; rep.added++; }
        }
      }
      if (count(family) === 0) {
        // PRESENT MEANS AT LEAST ONE: a level whose per-spawn rolls (and top-ups) all missed gets one, in an ordinary zombie's slot
        // whose pool gives the family weight — picked by weight (the smallest -ln(u) / share), so it stands where it usually does
        const cand = Z.map((s, i) => (ordinary(s) && shareOf(poolOf(i), family) > 0 ? i : -1)).filter(i => i >= 0)
          .map(i => [-Math.log(1 - rosterRoll(levelSeed, `${rule.key}:one:${i}`)) / shareOf(poolOf(i), family), i] as const)
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (cand.length) { Z[cand[0][1]].archetype = family; rep.added++; }
        else rep.noSlot = true; // no ordinary zombie stands where its pools give it weight
      }
    } else if (rule.place === 'eligible-min-one') {
      const er = profile.eligibility?.[family];
      if (er && count(family) === 0) {
        // a slot where she is eligible: an ordinary zombie's first; else an unrestricted family's member there (exchanged elsewhere)
        const here = (i: number): boolean => shareOf(poolOf(i), family) > 0 && eligibilityFailure(er, layout, Z[i], ctxOf(i)) === null;
        let cand = Z.map((s, i) => (ordinary(s) && here(i) ? i : -1)).filter(i => i >= 0);
        if (!cand.length) cand = Z.map((s, i) => (displaceable(s) && here(i) ? i : -1)).filter(i => i >= 0);
        if (cand.length) {
          const i = seeded(rule.key, cand)[0], d = arch(Z[i]);
          Z[i].archetype = family; rep.added++;
          if (d !== 'zombie') compensate(rule.key, d);
        } else rep.noSlot = true; // no enemy stands in a room where she is eligible: no room qualifies in this level
      }
    } else if (rule.place === 'context-one') {
      // EXACTLY ONE in its contexts (strict): an existing one is kept and extras become zombies; with none it takes an ordinary zombie's
      // slot there, else the slot of an unrestricted family's member there (the Bunker's one damp spawn can be a rat/dog) — exchanged
      const inCtx = (i: number): boolean => ambient(Z[i]) && rule.contexts.includes(ctxOf(i) as SpawnContextId);
      const have = seeded(rule.key, Z.map((s, i) => (inCtx(i) && arch(s) === family ? i : -1)).filter(i => i >= 0));
      if (have.length) { for (const i of have.slice(1)) { toZombie(Z[i]); rep.removed++; } }
      else {
        let cand = Z.map((s, i) => (inCtx(i) && ordinary(s) ? i : -1)).filter(i => i >= 0);
        if (!cand.length) cand = Z.map((s, i) => (inCtx(i) && displaceable(s) ? i : -1)).filter(i => i >= 0);
        if (cand.length) {
          const i = seeded(rule.key, cand)[0], d = arch(Z[i]);
          Z[i].archetype = family; rep.added++;
          if (d !== 'zombie') compensate(rule.key, d);
        } else rep.noSlot = true; // unreachable while `eligible` means an ambient spawn of its contexts exists and only share families can hold it
      }
    } else {
      // 'count': placed by the roster alone
      rep.wanted = pickCount(rule.counts, rosterRoll(levelSeed, `${rule.key}:count`));
      const S = rule.slots;
      const inContext = (i: number): boolean => { const c = ctxOf(i); return c !== undefined && S.contexts.includes(c); };
      const inSpace = (s: ZombieSpawn): boolean => {
        const a = s.area !== undefined ? layout.areas?.[s.area] : undefined;
        if (!a) return false;
        if (a.kind !== undefined && S.excludeKinds.includes(a.kind)) return false;
        if (S.excludeRooms.includes(a.type) || (a.purpose !== undefined && S.excludeRooms.includes(a.purpose))) return false;
        return a.w !== undefined && a.h !== undefined && Math.min(a.w, a.h) >= S.minSideCells && a.w * a.h >= S.minAreaCells;
      };
      const tiers: ((s: ZombieSpawn, i: number) => boolean)[] = [(s, i) => ordinary(s) && inContext(i) && inSpace(s), (s, i) => ordinary(s) && inContext(i), s => ordinary(s)];
      let cand: number[] = [];
      for (let t = 0; t < tiers.length && !cand.length; t++) {
        cand = Z.map((s, i) => (tiers[t](s, i) ? i : -1)).filter(i => i >= 0);
        rep.relaxed = t as 0 | 1 | 2;
      }
      if (!cand.length) rep.noSlot = true; // a level without one ordinary zombie (none of the registered combat levels)
      // spaced picks in the seeded order: the count is what the spacing allows, at least one
      const picked: number[] = [];
      const far = (i: number): boolean => picked.every(j => Math.hypot(Z[i].x - Z[j].x, (Z[i].y ?? 0) - (Z[j].y ?? 0), Z[i].z - Z[j].z) >= rule.spacingM);
      for (const i of seeded(rule.key, cand)) { if (picked.length >= rep.wanted) break; if (far(i)) picked.push(i); }
      const first = rule.variants.length ? Math.floor(rosterRoll(levelSeed, `${rule.key}:variant`) * rule.variants.length) : 0;
      picked.forEach((i, n) => {
        Z[i].archetype = family;
        if (rule.variants.length) Z[i].variant = rule.variants[(first + n) % rule.variants.length];
        rep.added++;
      });
    }
  }
  for (const family of seededFamilies) report.families[family]!.after = count(family);
  // last: the sprinters among the ordinary zombies the families left (their own per-spawn hash; no family, count or slot moves)
  if (version >= SPRINTER.since) report.sprinters = applySprinters(Z, levelSeed);
  return report;
}
