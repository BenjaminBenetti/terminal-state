// Task studio-bb-production-20261112-234540-01 (lane REGISTRY-DOCS): BB IN THE SEEDED ROSTER (ai/enemyRoster.ts FAMILY_ROSTER.bb) — where
// and how often the new family appears, and that adding it rerolled nothing. The approved design: BB is a roster-only family (weight 0
// in every pool); a deterministic 40 % of COMBAT level maps hold BBs at all, never the Survivor Market; a selected level holds 1-3 of
// them, dealt from the shared pool of four looks, each in the slot of an ordinary ambient zombie; the rule applies from roster version
// 3 and is placed LAST, so every earlier family stands exactly where version 2 put it and a station recorded at version 2 or lower
// regenerates without BB. (The brain, the locomotion, the actor and the audio have their own tests; this file is the roster and the
// registry only.)
import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {
  BB_VARIANT_IDS, FAMILY_ROSTER, ROSTER_LANE, ROSTER_PLACE_LAST, ROSTER_PLACE_PRIORITY, ROSTER_VERSION, ZOMBIE_FREE_LEVELS, applyEnemyRoster, familyInRoster, rosterOf,
  rosterRate, rosterRoll, rosterVersionFor,
} from '../src/ai/enemyRoster';
import {
  CONTEXT_LOCKED_FAMILIES, DEFAULT_FAMILY_SHARES, ENEMY_FAMILY_IDS, ENEMY_POOL, OPT_IN_FAMILIES, ROSTER_ONLY_FAMILIES, SPAWN_PROFILES, markSpawnContext, spawnContextOf,
  spawnProfile, validateSpawnProfile, type EnemyFamilyId, type SpawnContextId, type SpawnProfile,
} from '../src/ai/spawnTables';
import {pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../src/ai/enemyModels';
import {CORPSE_TRAITS, corpseFeedable} from '../src/ai/corpseTrait';
import {HORDE_FORBIDDEN_FAMILIES} from '../src/ai/hordeSpec';
import {COSPLAY_FAMILY_POOL} from '../src/ai/cosplayContext';
import {MELEE_MASS, meleeMassOf} from '../src/combat/meleeImpact';
import {sprinterEligible, sprinterRoll, SPRINTER} from '../src/ai/sprinter';
import {BB_ASSET, BB_BODY, BB_CADENCE, BB_CLIMB, BB_POUNCE, BB_SCALE, BB_SENSE, BB_STATS, BB_VARIANTS, BB_VOICE_Y, bbVariantOf} from '../src/ai/bb';
import {BB_ACTOR} from '../src/ai/bbActor';
import {createRun} from '../src/run/runState';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';

const COMBAT = LEVEL_IDS.filter(l => !ZOMBIE_FREE_LEVELS.includes(l));
const RULE = (() => {
  const r = FAMILY_ROSTER.bb;
  if (r.mode !== 'seeded' || r.place !== 'count') throw new Error('BB is a counted, seeded roster family');
  return r;
})();
/** The version BB's rule applies from, and the last version without it. */
const V_BB = RULE.since, V_BEFORE = RULE.since - 1;
const arch = (z: ZombieSpawn): EnemyFamilyId => z.archetype ?? 'zombie';
const bbIndices = (l: {zombies: readonly ZombieSpawn[]}): number[] => l.zombies.map((z, i) => (arch(z) === 'bb' ? i : -1)).filter(i => i >= 0);
/** BB spawn indices in the order the pass took them (its seeded slot order: the roll's own keys — they ARE the roll, never renamed). */
const pickOrder = (seed: number, idx: readonly number[]): number[] => [...idx].sort((a, b) => rosterRoll(seed, `${RULE.key}:slot:${a}`) - rosterRoll(seed, `${RULE.key}:slot:${b}`) || a - b);
const firstVariant = (seed: number): number => Math.floor(rosterRoll(seed, `${RULE.key}:variant`) * BB_VARIANT_IDS.length);
const dist3 = (p: ZombieSpawn, q: ZombieSpawn): number => Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z);
/** What a BB slot must be, given the spawn it replaced: the same record + the family and its look, minus a sprinter tag. */
const asBb = (was: ZombieSpawn, variant: string | undefined): ZombieSpawn => { const o: ZombieSpawn = {...was, archetype: 'bb', variant}; delete o.sprinter; return o; };

describe('BB roster: the rule and the roll (pure)', () => {
  it('the approved rule: 40 % of combat level maps, 1-3 per selected map, four looks, from roster version 3, placed last; roster-only', () => {
    expect([RULE.rate, RULE.since, RULE.last, RULE.key, RULE.levelRates]).toEqual([0.4, 3, true, 'bb', undefined]);
    expect(ROSTER_VERSION).toBeGreaterThanOrEqual(RULE.since);
    expect(RULE.counts.map(c => c[0])).toEqual([1, 2, 3]);
    for (const [, w] of RULE.counts) expect(w).toBeGreaterThan(0);
    expect(RULE.variants).toBe(BB_VARIANT_IDS);
    expect([...BB_VARIANT_IDS]).toEqual(['lullaby', 'binky', 'teddy', 'changeling']);
    for (const l of COMBAT) expect(rosterRate('bb', l), l).toBe(0.4);
    expect(ZOMBIE_FREE_LEVELS).toEqual(['market']);
    expect(rosterRate('bb', 'market')).toBe(0);
    // it needs walls and ceilings and an ordinary room: never the open roof, an annex, the damp zone, a horde or an outfit zone; no closets
    for (const c of ['roof', 'service', 'damp', 'horde', 'lingerie', 'cosplay'] as const) expect(RULE.slots.contexts, c).not.toContain(c);
    expect(RULE.slots.excludeKinds).toContain('closet');
    expect(RULE.spacingM).toBeGreaterThan(0);
    // appended last in the registry order, and the only family the pass places after every placement policy
    expect(ENEMY_FAMILY_IDS[ENEMY_FAMILY_IDS.length - 1]).toBe('bb');
    expect(Object.keys(FAMILY_ROSTER)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(ROSTER_PLACE_LAST).toBeGreaterThan(Math.max(...Object.values(ROSTER_PLACE_PRIORITY)));
    for (const f of ENEMY_FAMILY_IDS) {
      const r = FAMILY_ROSTER[f];
      if (r.mode !== 'seeded') continue;
      expect(r.last === true, `${f}: placed last`).toBe(f === 'bb');
      // every earlier family's rule predates BB's: none of them was moved to a later version
      if (f !== 'bb') expect(r.since, f).toBeLessThan(RULE.since);
    }
  });

  it('the roll: 40 % of 20,000 level seeds on every combat level (three sigma); exactly none on the Market and below version 3', () => {
    const N = 20000, tol = 3 * Math.sqrt(0.4 * 0.6 / N);
    const seedOf = (s: number): number => s * 2654435761 >>> 0;
    for (const level of COMBAT) {
      let n = 0;
      for (let s = 1; s <= N; s++) if (familyInRoster('bb', level, seedOf(s))) n++;
      expect(Math.abs(n / N - 0.4), `${level}: ${n / N}`).toBeLessThanOrEqual(tol);
    }
    let market = 0, old = 0;
    for (let s = 1; s <= N; s++) {
      const seed = seedOf(s);
      if (familyInRoster('bb', 'market', seed) || familyInRoster('bb', 'market', seed, V_BB)) market++;
      for (const level of COMBAT) for (let v = 0; v < V_BB; v++) if (familyInRoster('bb', level, seed, v)) old++;
      // the roll is the hash of (level seed, the rule's key) against the rate: explicit version 3 = the current default
      if (s <= 200) expect(familyInRoster('bb', 'subway', seed, V_BB)).toBe(rosterRoll(seed, `${RULE.key}:present`) < RULE.rate);
    }
    expect([market, old]).toEqual([0, 0]);
  });

  it('the roll is independent of the Screacher\'s (joint frequency about 0.16) and of every other family\'s', () => {
    const N = 20000;
    for (const other of ENEMY_FAMILY_IDS.filter(f => f !== 'bb' && FAMILY_ROSTER[f].mode === 'seeded')) {
      let both = 0, mine = 0, theirs = 0;
      for (let s = 1; s <= N; s++) {
        const seed = s * 2246822519 >>> 0, a = familyInRoster('bb', 'office', seed), b = familyInRoster(other, 'office', seed);
        if (a) mine++;
        if (b) theirs++;
        if (a && b) both++;
      }
      const expected = rosterRate('bb', 'office') * rosterRate(other, 'office');
      expect(Math.abs(both / N - expected), `bb x ${other}: ${both / N} vs ${expected}`).toBeLessThanOrEqual(3.5 * Math.sqrt(expected * (1 - expected) / N));
      // the same statement as a conditional: BB is as likely with the other family as without it
      expect(Math.abs(both / theirs - mine / N), `bb given ${other}`).toBeLessThan(0.02);
      if (other === 'screacher') expect(expected).toBeCloseTo(0.16, 12);
    }
  });
});

type Synthetic = {seed: number; zombies: ZombieSpawn[]; areas: {type: string; kind: string; purpose?: string; w: number; h: number}[]};
/**
 * A synthetic level of the Subway profile: `n` ambient spawns on a 9 m grid, families by the game's own per-spawn roll, all in area 0
 * (a big concourse unless `area` says otherwise) and tagged with `context`.
 */
function synthetic(seed: number, o: {n?: number; area?: Synthetic['areas'][number]; context?: SpawnContextId; pitchM?: number} = {}): Synthetic {
  const layout: Synthetic = {seed, zombies: [], areas: [o.area ?? {type: 'concourse', kind: 'concourse', w: 80, h: 60}]};
  const pitch = o.pitchM ?? 9;
  for (let i = 0; i < (o.n ?? 30); i++) layout.zombies.push({x: (i % 6) * pitch, z: Math.floor(i / 6) * pitch, yaw: 0, type: 'shambler', area: 0, archetype: pickEnemyArchetype(seed, i, ENEMY_POOL)});
  markSpawnContext(layout, 0, o.context ?? 'station');
  return layout;
}
const pass = (l: Synthetic, version: number = V_BB) => applyEnemyRoster(l as never, 'subway', l.seed, version);
/** The first `n` seeds of a fixed sequence whose roll does (or does not) include BB. */
function seedsWith(present: boolean, n: number, also?: (seed: number) => boolean): number[] {
  const out: number[] = [];
  for (let k = 0; out.length < n; k++) {
    const seed = (3001 + k * 104729) >>> 0;
    if (familyInRoster('bb', 'subway', seed) === present && (also?.(seed) ?? true)) out.push(seed);
  }
  return out;
}

describe('BB roster: placement (synthetic levels: the pass itself, thousands of seeds)', () => {
  const N = 6000;

  it('absent = none; a selected level holds 1-3 by the rule\'s count weights, 9 m apart, its looks dealt in turn from the seeded start', () => {
    const hist: number[] = [0, 0, 0, 0], looks: Record<string, number> = {};
    let present = 0;
    for (let s = 1; s <= N; s++) {
      const seed = s * 40503 >>> 0, plain = synthetic(seed), b = synthetic(seed);
      const R = pass(b).families.bb!;
      const mine = bbIndices(b);
      expect([R.eligible, R.present]).toEqual([true, familyInRoster('bb', 'subway', seed)]);
      expect(b.zombies.length).toBe(plain.zombies.length);
      if (!R.present) { expect([mine.length, R.wanted, R.added]).toEqual([0, undefined, 0]); continue; }
      present++;
      // the big room always has spaced slots: the level holds exactly the count its roll asked for
      expect([mine.length, R.added, R.before, R.removed, R.after]).toEqual([R.wanted, R.wanted, 0, 0, R.wanted]);
      expect([R.relaxed, R.noSlot]).toEqual([0, undefined]);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(3);
      hist[mine.length]++;
      for (const i of mine) for (const j of mine) if (i !== j) expect(dist3(b.zombies[i], b.zombies[j])).toBeGreaterThanOrEqual(RULE.spacingM);
      // the looks: the first one from the seeded start, the next ones in turn — so the looks of one level are all different
      pickOrder(seed, mine).forEach((i, n) => expect(b.zombies[i].variant, `seed ${seed} pick ${n}`).toBe(BB_VARIANT_IDS[(firstVariant(seed) + n) % BB_VARIANT_IDS.length]));
      expect(new Set(mine.map(i => b.zombies[i].variant)).size).toBe(mine.length);
      for (const i of mine) looks[b.zombies[i].variant!] = (looks[b.zombies[i].variant!] ?? 0) + 1;
      // only the family and its look changed, in the slot of a zombie (as rolled, or of a family this level's roster excludes)
      for (const i of mine) expect([b.zombies[i].x, b.zombies[i].z, b.zombies[i].type, b.zombies[i].area]).toEqual([plain.zombies[i].x, plain.zombies[i].z, plain.zombies[i].type, plain.zombies[i].area]);
      // the same seed gives the same BBs (checked on a share of the seeds)
      if (s % 40 === 0) { const again = synthetic(seed); pass(again); expect(again.zombies).toEqual(b.zombies); }
    }
    expect(Math.abs(present / N - RULE.rate)).toBeLessThan(0.02);
    const total = RULE.counts.reduce((t, [, w]) => t + w, 0);
    for (const [n, w] of RULE.counts) expect(Math.abs(hist[n] / present - w / total), `${n} per level: ${hist[n] / present} vs ${w / total}`).toBeLessThan(0.035);
    expect(hist[0]).toBe(0);
    const placed = Object.values(looks).reduce((x, y) => x + y, 0);
    expect(Object.keys(looks).sort()).toEqual([...BB_VARIANT_IDS].sort());
    for (const v of BB_VARIANT_IDS) expect(Math.abs(looks[v] / placed - 0.25), `look ${v}`).toBeLessThan(0.03); // the shared pool: uniform over the four
  });

  it('version 3 = version 2 with BB in the slots of ordinary ambient zombies: no other spawn, family or report moves', () => {
    let withBb = 0, lostTags = 0;
    for (let s = 1; s <= N; s++) {
      const seed = s * 69069 >>> 0, a = synthetic(seed), b = synthetic(seed);
      // a roaming-horde zombie and an outfit zombie among them: never a BB slot
      for (const l of [a, b]) { l.zombies[3].horde = 0; l.zombies[3].archetype = 'zombie'; l.zombies[4].look = 'cosplay'; l.zombies[4].archetype = 'zombie'; }
      const ra = pass(a, V_BEFORE), rb = pass(b, V_BB);
      expect(ra.families.bb).toBeUndefined();
      expect(bbIndices(a)).toEqual([]);
      const mine = bbIndices(b);
      if (!rb.families.bb!.present) { expect(b.zombies).toEqual(a.zombies); expect(rb.sprinters).toEqual(ra.sprinters); }
      else withBb++;
      b.zombies.forEach((z, i) => {
        if (!mine.includes(i)) { expect(z, `seed ${seed} #${i}`).toEqual(a.zombies[i]); return; }
        const was = a.zombies[i];
        expect([arch(was), was.horde, was.look, was.variant], `seed ${seed} #${i} was`).toEqual(['zombie', undefined, undefined, undefined]);
        expect(z, `seed ${seed} #${i}`).toEqual(asBb(was, z.variant));
        expect(BB_VARIANT_IDS as readonly string[]).toContain(z.variant);
        if (was.sprinter) lostTags++;
      });
      // every earlier family's report is the same (what it had, lost, gained and holds), and the sprinters lose exactly the BB slots
      for (const f of ENEMY_FAMILY_IDS) if (f !== 'bb') expect(rb.families[f], `seed ${seed} ${f}`).toEqual(ra.families[f]);
      expect(rb.sprinters!.eligible).toBe(ra.sprinters!.eligible - mine.length);
      expect(rb.sprinters!.sprinters).toBe(ra.sprinters!.sprinters - mine.filter(i => a.zombies[i].sprinter).length);
      // older versions never hold one
      if (s % 20 === 0) for (let v = 0; v < V_BEFORE; v++) { const c = synthetic(seed); pass(c, v); expect(bbIndices(c)).toEqual([]); }
    }
    expect(withBb / N).toBeGreaterThan(0.36);
    expect(lostTags, 'some BB slots were sprinters at version 2 (the one tag a BB slot may lose)').toBeGreaterThan(0);
  });

  it('the slot rule: its contexts and room sizes first; relaxed only when the level has no such slot; never a horde or outfit zombie', () => {
    const SEEDS = seedsWith(true, 150);
    const run = (make: (seed: number) => Synthetic) => SEEDS.map(seed => { const l = make(seed); return {seed, l, R: pass(l).families.bb!, mine: bbIndices(l)}; });
    // a roomy area of a core context: the rule's own slots
    for (const {R, mine} of run(seed => synthetic(seed))) expect([R.relaxed, R.noSlot, mine.length]).toEqual([0, undefined, R.wanted]);
    // too narrow / too small / a closet / an excluded room: no slot of the rule, so any ordinary ambient zombie of its contexts (relaxed 1)
    const S = RULE.slots;
    const noRoom: Synthetic['areas'][number][] = [
      {type: 'concourse', kind: 'concourse', w: S.minSideCells - 1, h: 200},
      {type: 'concourse', kind: 'concourse', w: S.minSideCells, h: Math.ceil(S.minAreaCells / S.minSideCells) - 1},
      {type: 'concourse', kind: S.excludeKinds[0], w: 80, h: 60},
      {type: S.excludeRooms[0], kind: 'room', w: 80, h: 60},
      {type: 'room', kind: 'room', purpose: S.excludeRooms[S.excludeRooms.length - 1], w: 80, h: 60},
    ];
    for (const area of noRoom) for (const {R, mine, seed} of run(seed => synthetic(seed, {area}))) expect([R.relaxed, R.noSlot, mine.length], `${JSON.stringify(area)} seed ${seed}`).toEqual([1, undefined, R.wanted]);
    // exactly at the limits it qualifies
    for (const {R} of run(seed => synthetic(seed, {area: {type: 'concourse', kind: 'concourse', w: S.minSideCells, h: Math.ceil(S.minAreaCells / S.minSideCells)}}))) expect(R.relaxed).toBe(0);
    // a level with spawns only outside its contexts (an annex): any ordinary ambient zombie (relaxed 2) — a selected level is never left without
    for (const {R, mine} of run(seed => synthetic(seed, {context: 'service'}))) expect([R.relaxed, R.noSlot, mine.length >= 1]).toEqual([2, undefined, true]);
    // a mixed level: one qualifying room among closets — BBs only in the room, as many as it has ordinary zombies for (at least one)
    for (const {l, R, mine, seed} of run(seed => {
      const m = synthetic(seed);
      m.areas.push({type: 'concourse', kind: S.excludeKinds[0], w: 80, h: 60});
      m.zombies.forEach((z, i) => { if (i >= 2) z.area = 1; });
      return m;
    })) {
      const roomy = l.zombies.slice(0, 2);
      expect(R.relaxed, `seed ${seed}`).toBe(roomy.some(z => arch(z) === 'zombie' || arch(z) === 'bb') ? 0 : 1);
      if (R.relaxed === 0) { expect(mine.every(i => i < 2)).toBe(true); expect(mine.length).toBeGreaterThanOrEqual(1); expect(mine.length).toBeLessThanOrEqual(Math.min(2, R.wanted!)); }
    }
    // spacing: a cramped level (every spawn within a few metres) holds exactly one, whatever count its roll asked for
    const cramped = run(seed => synthetic(seed, {pitchM: 1}));
    for (const {R, mine} of cramped) expect([mine.length, R.added, R.noSlot]).toEqual([1, 1, undefined]);
    expect(cramped.some(c => c.R.wanted! > 1)).toBe(true);
    // only horde members and outfit zombies: nothing to take — reported as no slot, and none of them is touched
    for (const {l, R, mine, seed} of run(seed => { const m = synthetic(seed); m.zombies.forEach((z, i) => { z.archetype = 'zombie'; if (i % 2) z.horde = 0; else z.look = 'lingerie'; }); return m; })) {
      expect([mine.length, R.added, R.noSlot], `seed ${seed}`).toEqual([0, 0, true]);
      expect(l.zombies.every(z => arch(z) === 'zombie' && z.variant === undefined)).toBe(true);
    }
    // the Survivor Market: no family at all, whatever stands there
    for (const seed of SEEDS.slice(0, 20)) { const m = synthetic(seed), m0 = synthetic(seed); expect(applyEnemyRoster(m as never, 'market', seed, V_BB)).toMatchObject({zombieFree: true, families: {}}); expect(m).toEqual(m0); }
  });
});

describe('BB roster: real levels through the registry', () => {
  // the same seeds on every level (the roll reads the level seed and the family only): three whose roll includes BB — one of them with
  // the Screacher too, the other counted family — and two whose roll does not
  const WITH = [...seedsWith(true, 2, seed => !familyInRoster('screacher', 'subway', seed)), ...seedsWith(true, 1, seed => familyInRoster('screacher', 'subway', seed))];
  const WITHOUT = seedsWith(false, 2);
  const gen = (level: LevelId, seed: number, rosterVersion?: number): StationLayout => LEVELS[level].generate('main', rosterVersion === undefined ? {levelSeed: seed} : {levelSeed: seed, rosterVersion});
  const rest = (l: StationLayout): string => JSON.stringify({...l, zombies: null});
  let held = 0;

  /** Everything the rule promises about the BBs of one generated level, given the same level at the version before BB. */
  function checkLevel(level: LevelId, seed: number, before: StationLayout, after: StationLayout): number[] {
    const what = `${level} ${seed}`, P = spawnProfile(level), R = rosterOf(after)!.families.bb!, mine = bbIndices(after);
    expect(bbIndices(before), `${what}: version ${V_BEFORE} holds no BB`).toEqual([]);
    expect(rosterOf(before)!.families.bb, `${what}: version ${V_BEFORE} does not roll it`).toBeUndefined();
    expect(rosterOf(after)!.version).toBe(V_BB);
    // the layout, the loot and the enemy count are the same level
    expect(rest(after), `${what}: nothing but the spawn list differs`).toBe(rest(before));
    expect(after.zombies.length, what).toBe(before.zombies.length);
    expect([R.eligible, R.present], what).toEqual([true, familyInRoster('bb', level, seed)]);
    if (!R.present) {
      expect(after.zombies, `${what}: a level without BB is the version-${V_BEFORE} level`).toEqual(before.zombies);
      expect(JSON.stringify(after.zombies)).toBe(JSON.stringify(before.zombies));
      expect(rosterOf(after)!.sprinters).toEqual(rosterOf(before)!.sprinters);
      return mine;
    }
    // 1-3, never none on a registered combat level; what the report says is what the level holds
    expect(mine.length, what).toBeGreaterThanOrEqual(1);
    expect(mine.length, what).toBeLessThanOrEqual(3);
    expect(mine.length, what).toBeLessThanOrEqual(R.wanted!);
    expect([R.before, R.removed, R.added, R.after, R.noSlot], what).toEqual([0, 0, mine.length, mine.length, undefined]);
    expect(RULE.counts.map(c => c[0]), what).toContain(R.wanted);
    // THE ONLY DIFFERENCES from the version before: the BB slots — each was an ordinary ambient zombie there (no horde member, no outfit
    // zombie, no other family), and keeps its index, position, yaw, type and area; every other spawn is the same record, in the same order
    after.zombies.forEach((z, i) => {
      const was = before.zombies[i];
      if (!mine.includes(i)) { expect(z, `${what} #${i}`).toEqual(was); return; }
      expect([arch(was), was.horde, was.look, was.variant], `${what} #${i} was`).toEqual(['zombie', undefined, undefined, undefined]);
      expect(z, `${what} #${i}`).toEqual(asBb(was, z.variant));
      expect([z.x, z.z, z.y, z.yaw, z.type, z.area, z.level], `${what} #${i}`).toEqual([was.x, was.z, was.y, was.yaw, was.type, was.area, was.level]);
      expect(z.sprinter, `${what} #${i}: a BB is never a sprinter`).toBeUndefined();
    });
    // the earlier families' reports did not move, and the sprinters lost exactly the BB slots
    for (const f of ENEMY_FAMILY_IDS) if (f !== 'bb') expect(rosterOf(after)!.families[f], `${what} ${f}`).toEqual(rosterOf(before)!.families[f]);
    after.zombies.forEach((z, i) => expect(z.sprinter === true, `${what} #${i} sprinter`).toBe(sprinterEligible(z) && sprinterRoll(seed, i) < SPRINTER.chance));
    // THE SLOT RULE, recomputed from the level as the pass found it (the version-before level: every earlier family already placed)
    const S = RULE.slots;
    const ordinary = (z: ZombieSpawn): boolean => z.horde === undefined && z.look === undefined && arch(z) === 'zombie';
    const inContext = (i: number): boolean => { const c = spawnContextOf(after, P, i); return c !== undefined && S.contexts.includes(c); };
    const inSpace = (z: ZombieSpawn): boolean => {
      const a = after.areas[z.area];
      return !!a && !S.excludeKinds.includes(a.kind) && !S.excludeRooms.includes(a.type) && !(a.purpose !== undefined && S.excludeRooms.includes(a.purpose))
        && Math.min(a.w, a.h) >= S.minSideCells && a.w * a.h >= S.minAreaCells;
    };
    const tiers = [
      before.zombies.map((z, i) => (ordinary(z) && inContext(i) && inSpace(z) ? i : -1)).filter(i => i >= 0),
      before.zombies.map((z, i) => (ordinary(z) && inContext(i) ? i : -1)).filter(i => i >= 0),
      before.zombies.map((z, i) => (ordinary(z) ? i : -1)).filter(i => i >= 0),
    ];
    const tier = tiers.findIndex(t => t.length > 0);
    expect(R.relaxed, `${what}: relaxed only when the level has no slot of the rule`).toBe(tier);
    for (const i of mine) expect(tiers[tier], `${what} #${i}: a slot of the rule`).toContain(i);
    // spacing: always the rule's distance apart; fewer than the count asked for only where no other slot is far enough
    for (const i of mine) for (const j of mine) if (i !== j) expect(dist3(after.zombies[i], after.zombies[j]), `${what} #${i} - #${j}`).toBeGreaterThanOrEqual(RULE.spacingM);
    if (mine.length < R.wanted!) for (const c of tiers[tier]) if (!mine.includes(c)) expect(mine.some(i => dist3(before.zombies[c], before.zombies[i]) < RULE.spacingM), `${what}: slot #${c} was free and far enough`).toBe(true);
    // the looks: approved ids, dealt in turn from the seeded start; the level loads exactly their models
    pickOrder(seed, mine).forEach((i, n) => expect(after.zombies[i].variant, `${what} pick ${n}`).toBe(BB_VARIANT_IDS[(firstVariant(seed) + n) % BB_VARIANT_IDS.length]));
    const bbKey = (k: string): boolean => Object.values(BB_VARIANTS).some(v => v.model === k);
    expect(enemyModelKeysFor(after).filter(bbKey), what).toEqual([...new Set(mine.map(i => BB_VARIANTS[bbVariantOf(after.zombies[i])].model))].sort());
    expect(enemyModelKeysFor(before).filter(bbKey), what).toEqual([]);
    return mine;
  }

  for (const level of COMBAT) {
    it(`${level}: version ${V_BB} = version ${V_BEFORE} with 1-3 BBs in ordinary ambient zombie slots on the seeds that roll it; identical on the others; older versions never`, () => {
      for (const seed of [...WITH, ...WITHOUT]) {
        const before = gen(level, seed, V_BEFORE), after = gen(level, seed, V_BB);
        const mine = checkLevel(level, seed, before, after);
        expect(mine.length > 0, `${level} ${seed}`).toBe(WITH.includes(seed));
        held += mine.length;
      }
      // the same seed gives the same BBs; a station of an older roster version, and the plain generator output, hold none
      const seed = WITH[0];
      expect(JSON.stringify(gen(level, seed, V_BB).zombies), `${level} ${seed}: deterministic`).toBe(JSON.stringify(gen(level, seed, V_BB).zombies));
      for (const old of [gen(level, seed, 1), gen(level, seed, 0), gen(level, seed)]) expect(bbIndices(old), `${level} ${seed}`).toEqual([]);
    }, 300_000);
  }

  it('the Subway over 36 consecutive seeds: a level holds BBs exactly when its roll says so, 1-3 of them, by the count its roll asked for', () => {
    let present = 0, short = 0;
    for (let k = 0; k < 36; k++) {
      const seed = (77003 + k * 7919) >>> 0;
      const l = gen('subway', seed, V_BB), R = rosterOf(l)!.families.bb!, n = bbIndices(l).length;
      expect(R.present).toBe(familyInRoster('bb', 'subway', seed));
      if (!R.present) { expect(n).toBe(0); continue; }
      present++;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(R.wanted!);
      expect([R.relaxed, R.noSlot]).toEqual([0, undefined]);
      if (n < R.wanted!) short++;
      for (const i of bbIndices(l)) expect(BB_VARIANT_IDS as readonly string[]).toContain(l.zombies[i].variant);
    }
    expect(present).toBeGreaterThanOrEqual(6); // (36 seeds at 40 %: 14 expected)
    expect(short).toBeLessThanOrEqual(present / 2); // a station usually has room for the count
  }, 120_000);

  it('never in the Survivor Market, at any version; the per-level tests above held BBs on every selected level', () => {
    for (const seed of [...WITH, ...WITHOUT]) {
      const m = gen('market', seed, V_BB);
      expect(m.zombies.length).toBe(0);
      expect(rosterOf(m)).toMatchObject({zombieFree: true, families: {}});
      expect(enemyModelKeysFor(m)).toEqual([]);
    }
    expect(held).toBeGreaterThanOrEqual(COMBAT.length * WITH.length);
  });
});

describe('BB roster: saves (the roster version pin)', () => {
  it('rosterVersionFor: a station recorded at 2, 1 or 0, or visited without a record, never becomes version 3; an untouched one is built at the current version', () => {
    for (const v of [0, 1, 2]) for (const visits of [0, 1, 7]) expect(rosterVersionFor({visits, lanes: {[ROSTER_LANE]: {v}}}), `recorded ${v}, ${visits} visits`).toBe(v);
    for (const visits of [1, 2, 30]) expect(rosterVersionFor({visits, lanes: {}}), `${visits} visits, no record`).toBe(0);
    expect(rosterVersionFor({visits: 4, lanes: {[ROSTER_LANE]: {v: 99}}})).toBe(0); // a damaged / future record: the visits rule
    expect(rosterVersionFor({visits: 4, lanes: {other: {v: 3}}})).toBe(0);
    expect([rosterVersionFor(undefined), rosterVersionFor({visits: 0, lanes: {}})]).toEqual([ROSTER_VERSION, ROSTER_VERSION]);
    expect(rosterVersionFor({visits: 5, lanes: {[ROSTER_LANE]: {v: V_BB}}})).toBe(V_BB);
    expect(ROSTER_VERSION).toBeGreaterThanOrEqual(V_BB);
  });

  it('a campaign: stations built at versions 2, 1 and 0 regenerate without BB, exactly as built; a new station gets its BBs and keeps them', () => {
    const SEED = seedsWith(true, 1)[0];
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const key = (station: string) => ({level: 'subway' as const, section: 'main', station});
    const v2Key = key('st-v2'), v1Key = key('st-v1'), v0Key = key('st-v0'), newKey = key('st-new');
    run.memory(v2Key).visits = 2; run.setLaneStore(ROSTER_LANE, {v: 2}, v2Key); run.memory(v2Key).killed = [0, 5, 9];
    run.memory(v1Key).visits = 1; run.setLaneStore(ROSTER_LANE, {v: 1}, v1Key);
    run.memory(v0Key).visits = 4; // entered before the roster existed: no record
    const build = (k: typeof v2Key): StationLayout => {
      // Game.generateSection's rule (sectionGenInputs + the lane stamp)
      const rosterVersion = rosterVersionFor(run.peekMemory(k));
      const layout = LEVELS[k.level].generate(k.section, {levelSeed: SEED, rosterVersion});
      if (run.laneStore(ROSTER_LANE, k) === undefined) run.setLaneStore(ROSTER_LANE, {v: rosterVersion}, k);
      return layout;
    };
    const at = (v?: number): string => JSON.stringify(LEVELS.subway.generate('main', v === undefined ? {levelSeed: SEED} : {levelSeed: SEED, rosterVersion: v}).zombies);
    const a = build(v2Key), b = build(v1Key), c = build(v0Key), d = build(newKey);
    expect([JSON.stringify(a.zombies), JSON.stringify(b.zombies), JSON.stringify(c.zombies)]).toEqual([at(2), at(1), at()]); // their enemies and kill indices exactly as built
    for (const l of [a, b, c]) expect(bbIndices(l)).toEqual([]);
    expect(bbIndices(d).length, 'this seed rolls BB for a station built today').toBeGreaterThanOrEqual(1);
    expect([run.laneStore(ROSTER_LANE, v2Key), run.laneStore(ROSTER_LANE, v1Key), run.laneStore(ROSTER_LANE, v0Key), run.laneStore(ROSTER_LANE, newKey)]).toEqual([{v: 2}, {v: 1}, {v: 0}, {v: ROSTER_VERSION}]);
    expect(run.memory(v2Key).killed).toEqual([0, 5, 9]);
    // a revisit (Continue / Retry) and an export / import of the memory keep the version: the same BBs at the same indices in the same
    // looks, and the old stations still without any
    run.memory(newKey).visits++;
    expect(JSON.stringify(build(newKey).zombies)).toBe(JSON.stringify(d.zombies));
    expect(JSON.stringify(build(v2Key).zombies)).toBe(JSON.stringify(a.zombies));
    for (const k of [v2Key, v1Key, v0Key, newKey]) expect(rosterVersionFor(JSON.parse(JSON.stringify(run.peekMemory(k))))).toBe(rosterVersionFor(run.peekMemory(k)));
  }, 60_000);
});

describe('BB: registry coherence (one family, four looks, roster-only)', () => {
  it('the archetype: label, stats, four lazy looks; the family lists agree', () => {
    const d = ENEMY_ARCHETYPES.bb;
    expect([d.id, d.label, d.model, d.stats, d.corpse, d.voiceHeight]).toEqual(['bb', 'BB', null, BB_STATS, CORPSE_TRAITS.bb, BB_VOICE_Y]);
    expect(d.stats).toBe(BB_STATS);
    expect(Object.keys(ENEMY_ARCHETYPES)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(d.variantModels).toEqual({lullaby: 'enemy_bb_lullaby', binky: 'enemy_bb_binky', teddy: 'enemy_bb_teddy', changeling: 'enemy_bb_changeling'});
    expect(Object.keys(d.variantModels!)).toEqual([...BB_VARIANT_IDS]);
    expect(Object.keys(BB_VARIANTS)).toEqual([...BB_VARIANT_IDS]);
    expect(Object.values(BB_VARIANTS).map(v => [v.look, v.name])).toEqual([['A', 'Lullaby'], ['B', 'Binky'], ['C', 'Teddy'], ['D', 'Changeling']]);
    // every look has its own lazily loaded model file entry, and they are four different files
    for (const v of Object.values(BB_VARIANTS)) expect(ENEMY_MODEL_FILES[v.model], v.model).toMatchObject({url: `assets/models/${v.model.replace(/_/g, '-')}.glb`});
    expect(new Set(Object.values(BB_VARIANTS).map(v => ENEMY_MODEL_FILES[v.model].url)).size).toBe(4);
    // one enemy type: a spawn's look only picks the model (an unknown / missing one is the first look, never another family)
    expect([bbVariantOf({variant: 'teddy'}), bbVariantOf({}), bbVariantOf({variant: 'sc01'})]).toEqual(['teddy', 'lullaby', 'lullaby']);
  });

  it('a layout loads exactly the looks its BBs carry (none without BB)', () => {
    const z = (o: Partial<ZombieSpawn>): ZombieSpawn => ({x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, ...o});
    expect(enemyModelKeysFor({zombies: [z({}), z({archetype: 'zombie'}), z({archetype: 'ratdog'})]})).toEqual([]);
    expect(enemyModelKeysFor({zombies: [z({archetype: 'bb', variant: 'teddy'}), z({archetype: 'bb', variant: 'binky'}), z({})]})).toEqual(['enemy_bb_binky', 'enemy_bb_teddy']);
    expect(enemyModelKeysFor({zombies: [z({archetype: 'bb', variant: 'changeling'}), z({archetype: 'screacher', variant: 'sc02'})]})).toEqual(['enemy_bb_changeling', 'enemy_screacher_sc02']);
    for (const v of BB_VARIANT_IDS) expect(enemyModelKeysFor({zombies: [z({archetype: 'bb', variant: v})]})).toEqual([BB_VARIANTS[v].model]);
  });

  it('roster-only: weight 0 in every shipped pool; every shipped profile is valid; a positive BB weight in any pool is rejected', () => {
    expect(ROSTER_ONLY_FAMILIES).toContain('bb');
    expect(DEFAULT_FAMILY_SHARES.bb).toBe(0);
    expect(OPT_IN_FAMILIES).not.toContain('bb');
    expect(CONTEXT_LOCKED_FAMILIES.bb).toBeUndefined();
    const weight = (pool: readonly (readonly [string, number])[] | undefined): number | undefined => pool?.find(r => r[0] === 'bb')?.[1];
    expect(weight(ENEMY_POOL)).toBe(0);
    expect(weight(COSPLAY_FAMILY_POOL)).toBe(0);
    for (const p of Object.values(SPAWN_PROFILES)) {
      expect(validateSpawnProfile(p), p.id).toEqual([]);
      expect(weight(p.families), `${p.id} level pool`).toBe(0);
      for (const [id, c] of Object.entries(p.contexts)) if (c?.families) expect(weight(c.families), `${p.id} ${id} pool`).toBe(0);
      if (p.horde) expect(weight(p.horde.families), `${p.id} horde pool`).toBe(0);
      // a positive weight is rejected wherever it is written: the level pool, a context's own pool, the horde pool
      const give = (pool: SpawnProfile['families']): SpawnProfile['families'] => pool.map(r => (r[0] === 'bb' ? ['bb', 0.1] as const : r[0] === 'zombie' ? ['zombie', Math.round((r[1] - 0.1) * 1e9) / 1e9] as const : r));
      expect(validateSpawnProfile({...p, families: give(p.families)}).join('\n'), `${p.id} level pool`).toMatch(/families\.bb: roster-only family with weight 0\.1/);
      for (const [id, c] of Object.entries(p.contexts)) {
        if (!c?.families) continue;
        expect(validateSpawnProfile({...p, contexts: {...p.contexts, [id]: {...c, families: give(c.families)}}}).join('\n'), `${p.id} ${id} pool`).toMatch(/families\.bb: roster-only family with weight 0\.1/);
      }
      if (p.horde) expect(validateSpawnProfile({...p, horde: {...p.horde, families: give(p.horde.families)}}).join('\n'), `${p.id} horde pool`).toMatch(/bb/);
    }
    // no per-spawn roll can land on it: the roll of 20,000 spawns of every level pool never draws one
    for (const p of Object.values(SPAWN_PROFILES)) for (let i = 0; i < 20000; i++) if (pickEnemyArchetype(1234567 + i, i, p.families) === 'bb') throw new Error(`${p.id}: the per-spawn roll drew a BB`);
  });

  it('hordes, the corpse trait and the melee mass: never in a horde; undead but not a carried body; the lightest body', () => {
    expect(HORDE_FORBIDDEN_FAMILIES).toContain('bb');
    // undead, but not the adult body plan the carry and the chipper feed are built for: recorded with its reason, never fuel
    expect(CORPSE_TRAITS.bb).toMatchObject({undead: true, humanoid: false});
    expect(CORPSE_TRAITS.bb.massKg).toBeGreaterThan(0);
    expect(CORPSE_TRAITS.bb.note).toMatch(/never carried/);
    expect(corpseFeedable('bb')).toBe(false);
    expect(MELEE_MASS.bb).toBeGreaterThan(0);
    expect(meleeMassOf('bb')).toBe(MELEE_MASS.bb);
    for (const [f, m] of Object.entries(MELEE_MASS)) if (f !== 'bb') expect(MELEE_MASS.bb, `lighter than ${f}`).toBeLessThanOrEqual(m);
  });

  it('a small crawler, not a scaled adult: its own stats, body and scale band', () => {
    // (the numbers themselves are the lead's tuning: only the shape of the design is pinned here)
    expect(BB_ASSET.heightM).toBeLessThan(1);
    expect(BB_STATS.height).toBe(BB_BODY.clearM);
    expect(BB_STATS.radius).toBe(BB_BODY.radius);
    expect(BB_BODY.clearM).toBeLessThan(BB_ASSET.heightM); // on all fours it is lower than its standing height
    expect(BB_STATS.attackRange).toBe(0); // no standing swing: its only attack is the pounce
    expect(BB_SCALE.min).toBeLessThanOrEqual(1);
    expect(BB_SCALE.max).toBeGreaterThanOrEqual(1);
    for (const o of [BB_CADENCE, BB_CLIMB, BB_POUNCE, BB_SENSE, BB_BODY]) for (const v of Object.values(o).flat()) expect(typeof v === 'number' && v > 0).toBe(true);
  });
});

// docs/bb.md states its numbers in tables whose last cell names the constant they come from (the Screacher page's convention). Every such
// row is checked against the live constant, so a retune that does not reach the page fails here with the row and the value to write.
describe('BB: docs/bb.md states the source\'s numbers', () => {
  const read = (f: string): string | null => { try { return readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'); } catch { return null; } };
  /** A file the page names that another lane of this task delivers (the runtime clips): skipped only while it does not exist yet. */
  const LANDING: readonly string[] = ['game/src/ai/bbClips.ts'];

  it('every constant table row === the exported constant; the roster statements, the four looks and the file names hold', () => {
    const doc = read('docs/bb.md');
    expect(doc, 'docs/bb.md exists').not.toBeNull();
    const ROOTS: Record<string, unknown> = {BB_STATS, BB_ASSET, BB_BODY, BB_SCALE, BB_CADENCE, BB_CLIMB, BB_POUNCE, BB_SENSE, BB_VOICE_Y, BB_ACTOR, FAMILY_ROSTER, MELEE_MASS, CORPSE_TRAITS, ROSTER_VERSION};
    const resolve = (path: string): unknown => path.split('.').reduce<unknown>((o, k, i) => (i === 0 ? ROOTS[k] : (o as Record<string, unknown> | undefined)?.[k]), undefined);
    const shown = (v: number): string => String(Math.round(v * 1e6) / 1e6);
    const hasNumber = (cell: string, v: number): boolean => new RegExp(`(?<![\\d.])${shown(v).replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(cell);
    let rows = 0;
    const roots = new Set<string>();
    for (const line of doc!.split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 3) continue;
      const symbols = [...cells[cells.length - 1].matchAll(/`([A-Z][A-Z_]*(?:\.[A-Za-z0-9_]+)*)`/g)].map(m => m[1]).filter(sym => sym.split('.')[0] in ROOTS);
      if (!symbols.length) continue;
      const valueCell = cells[cells.length - 2];
      for (const sym of symbols) {
        const v = resolve(sym);
        // a range constant ([lo, hi]) shows both numbers; a number shows itself
        const values = Array.isArray(v) ? v : [v];
        for (const x of values) {
          expect(typeof x, `${sym} is a number constant (row: ${line})`).toBe('number');
          expect(hasNumber(valueCell, x as number), `${sym} = ${values.map(n => shown(n as number)).join(', ')} in "${valueCell}"`).toBe(true);
        }
        roots.add(sym.split('.')[0]);
      }
      rows++;
    }
    // the page really carries its tables: the stats and the body, the roster rule, the registry classification. (A row of the behaviour
    // and locomotion sections — BB_CADENCE, BB_SENSE, BB_POUNCE, BB_CLIMB — is checked the same way as soon as it is written.)
    expect(rows).toBeGreaterThanOrEqual(15);
    for (const r of ['BB_STATS', 'BB_ASSET', 'BB_BODY', 'BB_SCALE', 'FAMILY_ROSTER', 'MELEE_MASS', 'CORPSE_TRAITS']) expect(roots, r).toContain(r);
    // the occurrence statements, recomputed from the rule
    const total = RULE.counts.reduce((t, [, w]) => t + w, 0), pct = (x: number): string => `${Math.round(1000 * x) / 10} %`;
    expect(doc!).toContain(`holds ${RULE.counts.map(([n]) => n).join(', ').replace(/, (\d+)$/, ' or $1')} (\`FAMILY_ROSTER.bb.counts\`: ${RULE.counts.map(([, w]) => pct(w / total)).join(', ').replace(/, ([\d.]+ %)$/, ' and $1')} of those`);
    expect(doc!).toContain(`The other ${pct(1 - RULE.rate)} of combat levels hold none.`);
    expect(doc!).toContain(`roster version ${RULE.since}`);
    // where it stands and where it does not: every context, excluded area kind and excluded room of the rule is named on this page and
    // in the roster section of docs/enemy-spawns.md (a change of the rule must reach both)
    const spawnsDoc = read('docs/enemy-spawns.md')!;
    for (const name of [...RULE.slots.contexts, ...RULE.slots.excludeKinds, ...RULE.slots.excludeRooms]) {
      expect(doc!.includes(`\`${name}\``), `docs/bb.md names ${name}`).toBe(true);
      expect(spawnsDoc.includes(`\`${name}\``), `docs/enemy-spawns.md names ${name}`).toBe(true);
    }
    // the four looks: every variant with its letter, name, lazy model key and file
    for (const [id, v] of Object.entries(BB_VARIANTS)) expect(doc!, id).toContain(`| ${v.look} | \`${id}\` | ${v.name} | \`${v.model}\` | \`${ENEMY_MODEL_FILES[v.model].url}\` |`);
    // every repository file the page names exists (the other lanes' files once they land)
    for (const f of (doc!.match(/`((?:game|tools|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md|mjs|json))`/g) ?? []).map(m => m.slice(1, -1))) {
      if (LANDING.includes(f) && !existsSync(new URL(`../../${f}`, import.meta.url))) continue;
      expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(true);
    }
  });
});
