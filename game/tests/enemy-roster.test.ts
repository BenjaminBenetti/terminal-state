// Task studio-screacher-production-20261110-221858-01: THE SEEDED ENEMY ROSTER (ai/enemyRoster.ts) — which special families a generated
// level holds AT ALL, from that level map's own seed. User (the Screacher): "per level ya. 40% chance based on the seed of them
// spawning AT ALL ... sometimes NONE ... deterministic"; "Survivor Markets remain zombie free". User (the existing families' rates and
// the concentration option B): "I like it, lets go!" — Blightbelly / rat-dog 60 % (Reactor 100 %), Siren 85 % on her levels, Strainer
// 35 % where its contexts exist (exactly one when present), zombies always the baseline.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {
  FAMILY_ROSTER, ROSTER_LANE, ROSTER_VERSION, SCREACHER_VARIANT_IDS, ZOMBIE_FREE_LEVELS, applyEnemyRoster, familyInRoster, rosterOf, rosterRate, rosterRoll, rosterVersionFor,
} from '../src/ai/enemyRoster';
import {
  ENEMY_FAMILY_IDS, ENEMY_POOL, ROSTER_ONLY_FAMILIES, SPAWN_PROFILES, STRAINER_CONTEXTS, eligibilityFailure, markSpawnContext, spawnContextOf, spawnProfile, validateSpawnProfile,
  type EnemyFamilyId,
} from '../src/ai/spawnTables';
import {pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {createRun} from '../src/run/runState';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';

const COMBAT = LEVEL_IDS.filter(l => !ZOMBIE_FREE_LEVELS.includes(l));
const SPECIAL = ENEMY_FAMILY_IDS.filter(f => f !== 'zombie');
const arch = (z: ZombieSpawn): EnemyFamilyId => z.archetype ?? 'zombie';
const countOf = (l: {zombies: ZombieSpawn[]}, f: EnemyFamilyId): number => l.zombies.filter(z => arch(z) === f).length;

describe('seeded roster: the table and the rolls (pure)', () => {
  it('every registered family decides: zombie = baseline; the user\'s rates for the rest; the Screacher is roster-only (weight 0 in every pool)', () => {
    expect(Object.keys(FAMILY_ROSTER)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(FAMILY_ROSTER.zombie.mode).toBe('baseline');
    const R = (f: EnemyFamilyId, l: LevelId) => rosterRate(f, l);
    for (const l of COMBAT) {
      expect([R('zombie', l), R('screacher', l), R('siren', l), R('strainer', l)]).toEqual([0, 0.4, 0.85, 0.35]);
      expect([R('blightbelly', l), R('ratdog', l)]).toEqual(l === 'reactor' ? [1, 1] : [0.6, 0.6]);
    }
    for (const f of ENEMY_FAMILY_IDS) expect(rosterRate(f, 'market')).toBe(0);
    expect(ZOMBIE_FREE_LEVELS).toEqual(['market']);
    expect(ROSTER_ONLY_FAMILIES).toEqual(['screacher']);
    for (const p of Object.values(SPAWN_PROFILES)) {
      const pools = [p.families, ...Object.values(p.contexts).map(c => c?.families).filter(Boolean), ...(p.horde ? [p.horde.families] : [])];
      for (const pool of pools) expect(pool!.find(r => r[0] === 'screacher')?.[1], `${p.id}: screacher weight`).toBe(0);
      expect(validateSpawnProfile(p)).toEqual([]);
    }
    // a profile that gives the roster-only family weight is rejected
    const bad = {...SPAWN_PROFILES.subway, families: SPAWN_PROFILES.subway.families.map(r => (r[0] === 'screacher' ? ['screacher', 0.1] as const : r[0] === 'zombie' ? ['zombie', r[1] - 0.1] as const : r))};
    expect(validateSpawnProfile(bad).join('\n')).toMatch(/roster-only family with weight 0\.1/);
  });

  it('the roll is a pure function of (level seed, family): deterministic, in [0, 1), independent of the roster version', () => {
    for (const seed of [0, 1, 7, 123456789, 0xffffffff]) {
      const r = rosterRoll(seed, 'screacher:present');
      expect(r).toBe(rosterRoll(seed, 'screacher:present'));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      expect(familyInRoster('screacher', 'subway', seed)).toBe(r < 0.4);
      expect(familyInRoster('screacher', 'subway', seed, 0)).toBe(false); // version 0: no roster
      expect(familyInRoster('screacher', 'market', seed)).toBe(false);
      expect(familyInRoster('zombie', 'subway', seed)).toBe(false); // never rolled
    }
  });

  it('long-run rates over 20,000 level seeds: each family within three sigma of its rate; Reactor Blightbelly / rat-dog always; Market never', () => {
    const N = 20000;
    const frac = (f: EnemyFamilyId, l: LevelId): number => { let n = 0; for (let s = 1; s <= N; s++) if (familyInRoster(f, l, s * 2654435761 >>> 0)) n++; return n / N; };
    for (const f of SPECIAL) {
      const p = rosterRate(f, 'subway'), tol = 3 * Math.sqrt(p * (1 - p) / N);
      expect(Math.abs(frac(f, 'subway') - p), `${f}: ${frac(f, 'subway')} vs ${p}`).toBeLessThanOrEqual(tol);
      expect(frac(f, 'market')).toBe(0);
    }
    expect([frac('blightbelly', 'reactor'), frac('ratdog', 'reactor')]).toEqual([1, 1]);
    expect(Math.abs(frac('screacher', 'reactor') - 0.4)).toBeLessThanOrEqual(3 * Math.sqrt(0.24 / N));
  });

  it('the family rolls are independent of one another (joint frequencies = products, 20,000 seeds)', () => {
    const N = 20000, fams: EnemyFamilyId[] = ['screacher', 'blightbelly', 'ratdog', 'siren', 'strainer'];
    for (let a = 0; a < fams.length; a++) for (let b = a + 1; b < fams.length; b++) {
      let both = 0;
      for (let s = 1; s <= N; s++) { const seed = s * 2246822519 >>> 0; if (familyInRoster(fams[a], 'office', seed) && familyInRoster(fams[b], 'office', seed)) both++; }
      const expected = rosterRate(fams[a], 'office') * rosterRate(fams[b], 'office');
      expect(Math.abs(both / N - expected), `${fams[a]} x ${fams[b]}`).toBeLessThanOrEqual(3.5 * Math.sqrt(expected * (1 - expected) / N));
    }
  });
});

/** A synthetic Subway-profile level: `n` ambient station spawns in one big room, families by the game's own per-spawn roll. */
function synthetic(seed: number, n = 30): {seed: number; zombies: ZombieSpawn[]; areas: {type: 'concourse'; kind: 'concourse'; w: number; h: number}[]} {
  const layout = {seed, zombies: [] as ZombieSpawn[], areas: [{type: 'concourse' as const, kind: 'concourse' as const, w: 80, h: 60}]};
  for (let i = 0; i < n; i++) layout.zombies.push({x: (i % 6) * 9, z: Math.floor(i / 6) * 9, yaw: 0, type: 'shambler', area: 0, archetype: pickEnemyArchetype(seed, i, ENEMY_POOL)});
  markSpawnContext(layout, 0, 'station');
  return layout;
}

describe('seeded roster: placement policies (synthetic levels: the pass itself, thousands of seeds)', () => {
  const N = 6000;
  it('absent = exactly none; present Screacher = 1-3 (40 / 40 / 20 %), spaced, with approved variants; counts and positions never change', () => {
    const hist = [0, 0, 0, 0], variants: Record<string, number> = {};
    let present = 0;
    for (let s = 1; s <= N; s++) {
      const seed = s * 40503 >>> 0, a = synthetic(seed), b = synthetic(seed);
      const rep = applyEnemyRoster(b, 'subway', seed);
      expect(b.zombies.length).toBe(a.zombies.length);
      b.zombies.forEach((z, i) => expect([z.x, z.z, z.type, z.area]).toEqual([a.zombies[i].x, a.zombies[i].z, a.zombies[i].type, a.zombies[i].area]));
      const n = countOf(b, 'screacher'), R = rep.families.screacher!;
      expect(R.present).toBe(familyInRoster('screacher', 'subway', seed));
      if (!R.present) { expect(n).toBe(0); continue; }
      present++;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBe(R.wanted); // the big room always has spaced slots
      expect([R.relaxed, R.noSlot]).toEqual([0, undefined]);
      hist[n]++;
      const mine = b.zombies.filter(z => arch(z) === 'screacher');
      expect(new Set(mine.map(z => z.variant)).size).toBe(mine.length); // distinct looks within a level
      for (const z of mine) { expect(SCREACHER_VARIANT_IDS as readonly string[]).toContain(z.variant); variants[z.variant!] = (variants[z.variant!] ?? 0) + 1; }
      for (const p of mine) for (const q of mine) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(14);
      // a converted slot was an ordinary zombie — as rolled, or a family this level's roster excludes (cleared to a zombie first)
      b.zombies.forEach((z, i) => {
        if (arch(z) !== 'screacher') { expect(z.variant).toBeUndefined(); return; }
        const was = arch(a.zombies[i]);
        expect(was === 'zombie' || rep.families[was]?.present === false, `slot ${i} was ${was}`).toBe(true);
      });
    }
    expect(Math.abs(present / N - 0.4)).toBeLessThan(0.02);
    expect(Math.abs(hist[1] / present - 0.4)).toBeLessThan(0.035);
    expect(Math.abs(hist[2] / present - 0.4)).toBeLessThan(0.035);
    expect(Math.abs(hist[3] / present - 0.2)).toBeLessThan(0.03);
    const total = Object.values(variants).reduce((x, y) => x + y, 0);
    for (const v of SCREACHER_VARIANT_IDS) expect(Math.abs(variants[v] / total - 0.25), `variant ${v}`).toBeLessThan(0.03); // uniform over the four bodies
  });

  it('option B: Blightbelly / rat-dog are absent from ~40 % of levels yet the long-run totals stay about what the per-spawn roll gave', () => {
    for (const f of ['blightbelly', 'ratdog'] as const) {
      let off = 0, on = 0, present = 0, presentWith = 0, offWith = 0;
      for (let s = 1; s <= N; s++) {
        const seed = s * 69069 >>> 0, a = synthetic(seed), b = synthetic(seed);
        const rep = applyEnemyRoster(b, 'subway', seed).families[f]!;
        off += countOf(a, f); on += countOf(b, f);
        if (countOf(a, f)) offWith++;
        if (rep.present) { present++; if (countOf(b, f)) presentWith++; }
        else expect(countOf(b, f)).toBe(0);
        expect(rep.before - rep.removed + rep.added).toBeLessThanOrEqual(rep.after + 3); // (exchanges / other families may take a few)
      }
      expect(Math.abs(present / N - 0.6), f).toBeLessThan(0.02);
      expect(on / off, `${f}: total with the roster / without`).toBeGreaterThan(0.9);
      expect(on / off, `${f}: total with the roster / without`).toBeLessThan(1.1);
      expect(offWith / N).toBeGreaterThan(0.7); // before: in most levels by accident
      expect(presentWith).toBe(present); // now: PRESENT MEANS AT LEAST ONE (a level whose rolls all missed is given one)
    }
  });

  it('families only ever swap with ordinary AMBIENT zombies: horde members and outfit zombies are never touched', () => {
    for (let s = 1; s <= 300; s++) {
      const seed = s * 7919 >>> 0, a = synthetic(seed), b = synthetic(seed);
      for (const l of [a, b]) { l.zombies[3].horde = 0; l.zombies[3].archetype = 'zombie'; l.zombies[4].look = 'cosplay'; l.zombies[4].archetype = 'zombie'; l.zombies[5].horde = 0; l.zombies[5].archetype = 'ratdog'; }
      applyEnemyRoster(b, 'subway', seed);
      for (const i of [3, 4, 5]) expect(b.zombies[i]).toEqual(a.zombies[i]);
    }
  });

  it('version 0 and the Survivor Market are no-ops (no report for version 0; a zombie-free report for the Market)', () => {
    const a = synthetic(99), b = synthetic(99);
    const rep = applyEnemyRoster(b, 'subway', 99, 0);
    expect(b).toEqual(a);
    expect([rep.version, rosterOf(b)]).toEqual([0, undefined]);
    const m = synthetic(99), m0 = synthetic(99);
    expect(applyEnemyRoster(m, 'market', 99)).toMatchObject({zombieFree: true, families: {}});
    expect(m).toEqual(m0);
  });
});

describe('seeded roster: real levels through the registry', () => {
  const SEEDS = [0, 1, 2, 3, 4, 5].map(k => (1201 + k * 7919) >>> 0);
  // (roster version 2, task studio-sprinter-zombies-20261112-033210-01: + the sprinter tag — ai/sprinter.ts, tests/sprinter-zombies.test.ts)
  const strip = (l: StationLayout): string => JSON.stringify(l.zombies.map(z => ({...z, archetype: undefined, variant: undefined, sprinter: undefined})));

  it('rosterVersion absent or 0 = the plain generator output (no pass); the game\'s explicit version turns it on', () => {
    const plain = LEVELS.subway.generate('main', {levelSeed: 1201}), zero = LEVELS.subway.generate('main', {levelSeed: 1201, rosterVersion: 0});
    expect(JSON.stringify(zero.zombies)).toBe(JSON.stringify(plain.zombies));
    expect([rosterOf(plain), rosterOf(zero)]).toEqual([undefined, undefined]);
    expect(plain.zombies.every(z => z.variant === undefined && arch(z) !== 'screacher')).toBe(true);
    const on = LEVELS.subway.generate('main', {levelSeed: 1201, rosterVersion: ROSTER_VERSION});
    expect(rosterOf(on)).toMatchObject({version: ROSTER_VERSION, level: 'subway', zombieFree: false});
  });

  for (const level of COMBAT) {
    it(`${level}: only family types of ambient slots change; absent = none; present = really there; the rules of each family hold`, () => {
      const P = spawnProfile(level);
      for (const seed of SEEDS) {
        const a = LEVELS[level].generate('main', {levelSeed: seed}), b = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
        const again = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
        expect(JSON.stringify(again.zombies), `${level} ${seed}: deterministic`).toBe(JSON.stringify(b.zombies));
        // nothing but archetype / variant differs: the same spawns, positions, order, types, areas, hordes, looks — and everything else
        expect(strip(b)).toBe(strip(a));
        expect(JSON.stringify({...b, zombies: null})).toBe(JSON.stringify({...a, zombies: null}));
        const rep = rosterOf(b)!;
        b.zombies.forEach((z, i) => {
          if (z.horde !== undefined || z.look !== undefined) expect(arch(z), `${level} ${seed} #${i}: horde / outfit untouched`).toBe(arch(a.zombies[i]));
          if (arch(z) !== arch(a.zombies[i])) expect(arch(z) === 'zombie' || arch(a.zombies[i]) === 'zombie' || FAMILY_ROSTER[arch(a.zombies[i])].mode === 'seeded').toBe(true);
        });
        for (const f of SPECIAL) {
          const R = rep.families[f]!, n = countOf(b, f);
          expect(R.present).toBe(R.eligible && familyInRoster(f, level, seed));
          if (!R.present) expect(n, `${level} ${seed}: absent ${f}`).toBe(0);
          // present means at least one — unless the level has no slot the family may take at all (reported, never silent)
          else if (!R.noSlot) expect(n, `${level} ${seed}: present ${f}`).toBeGreaterThanOrEqual(1);
          expect(R.after).toBe(b.zombies.filter(z => z.horde === undefined && z.look === undefined && arch(z) === f).length);
        }
        // the Screacher: 1-3 in an ordinary combat space of the core contexts, each with an approved body
        const S = rep.families.screacher!;
        if (S.present) {
          const mine = b.zombies.map((z, i) => [z, i] as const).filter(([z]) => arch(z) === 'screacher');
          expect(mine.length).toBeGreaterThanOrEqual(1);
          expect(mine.length).toBeLessThanOrEqual(3);
          expect(S.relaxed, `${level} ${seed}: the rule's own slots sufficed`).toBe(0);
          const rule = FAMILY_ROSTER.screacher;
          if (rule.mode !== 'seeded' || rule.place !== 'count') throw new Error('screacher rule');
          for (const [z, i] of mine) {
            expect(SCREACHER_VARIANT_IDS as readonly string[]).toContain(z.variant);
            expect(rule.slots.contexts).toContain(spawnContextOf(b, P, i));
            const area = b.areas[z.area];
            expect(area.kind).not.toBe('closet');
            expect(rule.slots.excludeRooms).not.toContain(area.type);
            if (area.purpose !== undefined) expect(rule.slots.excludeRooms, `${level} ${seed}: a Screacher in ${area.purpose}`).not.toContain(area.purpose);
            expect(Math.min(area.w, area.h)).toBeGreaterThanOrEqual(rule.slots.minSideCells);
            const was = arch(a.zombies[i]); // an ordinary zombie as rolled, or a family this level's roster excludes (cleared first)
            expect(was === 'zombie' || rep.families[was]?.present === false, `${level} ${seed} #${i} was ${was}`).toBe(true);
          }
        }
        // the Strainer: only in its contexts; exactly one when present
        const T = rep.families.strainer!;
        const strainers = b.zombies.map((z, i) => [z, i] as const).filter(([z]) => arch(z) === 'strainer');
        expect(strainers.length).toBe(T.present ? 1 : 0);
        for (const [, i] of strainers) expect(STRAINER_CONTEXTS).toContain(spawnContextOf(b, P, i));
        expect(T.eligible).toBe(b.zombies.some((z, i) => z.horde === undefined && z.look === undefined && STRAINER_CONTEXTS.includes(spawnContextOf(b, P, i)!)));
        // the Siren: never where her profile does not make her eligible; her cap, spacing and room rule still hold
        const er = P.eligibility?.siren, sirens = b.zombies.map((z, i) => [z, i] as const).filter(([z]) => arch(z) === 'siren');
        if (!er) expect(sirens.length).toBe(0);
        else {
          expect(sirens.length).toBeLessThanOrEqual(er.maxPerLevel ?? Infinity);
          for (const [z, i] of sirens) expect(eligibilityFailure(er, b, z, spawnContextOf(b, P, i)), `${level} ${seed}: siren #${i}`).toBeNull();
          const sp = P.spacing?.siren?.spacingM ?? 0;
          for (const [p] of sirens) for (const [q] of sirens) if (p !== q) expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z)).toBeGreaterThanOrEqual(sp);
          const R = rep.families.siren!;
          if (R.present && !R.noSlot) expect(sirens.length).toBeGreaterThanOrEqual(1);
        }
      }
    }, 180_000);
  }

  it('the Survivor Market stays zombie-free with the roster on', () => {
    for (const seed of SEEDS) {
      const m = LEVELS.market.generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
      expect(m.zombies.length).toBe(0);
      expect(rosterOf(m)).toMatchObject({zombieFree: true, families: {}});
    }
  });

  it('a selected Strainer is ALWAYS exactly one: Bunker seeds whose one damp spawn rolled a rat/dog (the slot is taken, the rat/dog exchanged)', () => {
    const P = spawnProfile('bunker');
    for (const seed of [14, 85]) {
      expect(familyInRoster('strainer', 'bunker', seed)).toBe(true);
      const a = LEVELS.bunker.generate('main', {levelSeed: seed}), b = LEVELS.bunker.generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
      const damp = a.zombies.map((_, i) => i).filter(i => spawnContextOf(a, P, i) === 'damp');
      expect(damp.length).toBe(1);
      expect(arch(a.zombies[damp[0]])).toBe('ratdog'); // the conflict: the only slot of its context held another family
      expect(arch(b.zombies[damp[0]])).toBe('strainer');
      expect(countOf(b, 'strainer')).toBe(1);
      expect(b.zombies.length).toBe(a.zombies.length);
      expect(rosterOf(b)!.families.strainer).toMatchObject({present: true, added: 1});
      expect(rosterOf(b)!.families.strainer!.noSlot).toBeUndefined();
      // rat/dogs are in this level's roster too: the displaced one was given an ordinary slot elsewhere (not lost)
      expect(rosterOf(b)!.families.ratdog!.present).toBe(true);
      expect(countOf(b, 'ratdog')).toBeGreaterThanOrEqual(countOf(a, 'ratdog'));
    }
  }, 60_000);
});

describe('seeded roster: the version pin (saves)', () => {
  it('rosterVersionFor: a recorded version wins; visited without a record = 0 (before the roster); never entered = current', () => {
    // (2 since task studio-sprinter-zombies-20261112-033210-01: version 1's families + the sprinters; a station recorded at 1 stays at 1)
    expect(ROSTER_VERSION).toBe(2);
    expect(rosterVersionFor(undefined)).toBe(2);
    expect(rosterVersionFor({visits: 0, lanes: {}})).toBe(2);
    expect(rosterVersionFor({visits: 3, lanes: {}})).toBe(0);
    expect(rosterVersionFor({visits: 3, lanes: {[ROSTER_LANE]: {v: 1}}})).toBe(1);
    expect(rosterVersionFor({visits: 3, lanes: {[ROSTER_LANE]: {v: 2}}})).toBe(2);
    expect(rosterVersionFor({visits: 0, lanes: {[ROSTER_LANE]: {v: 0}}})).toBe(0);
    // a damaged / future record falls back to the visits rule
    expect(rosterVersionFor({visits: 2, lanes: {[ROSTER_LANE]: {v: 99}}})).toBe(0);
    expect(rosterVersionFor({visits: 0, lanes: {[ROSTER_LANE]: {v: -1}}})).toBe(2);
    expect(rosterVersionFor({visits: 0, lanes: {[ROSTER_LANE]: 'x'}})).toBe(2);
  });

  it('a campaign: an old visited station keeps version 0 (its enemies exact), a new one records the current version on its first build', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const oldKey = {level: 'subway' as const, section: 'main', station: 'st-old'}, newKey = {level: 'subway' as const, section: 'main', station: 'st-new'};
    run.memory(oldKey).visits = 2; // entered before the roster existed: no record
    run.memory(oldKey).killed = [0, 3, 7];
    const build = (k: typeof oldKey): StationLayout => {
      // Game.generateSection's rule (sectionGenInputs + the lane stamp)
      const rosterVersion = rosterVersionFor(run.peekMemory(k));
      const layout = LEVELS[k.level].generate(k.section, {levelSeed: 4242, rosterVersion});
      if (run.laneStore(ROSTER_LANE, k) === undefined) run.setLaneStore(ROSTER_LANE, {v: rosterVersion}, k);
      return layout;
    };
    const plain = LEVELS.subway.generate('main', {levelSeed: 4242});
    const old1 = build(oldKey), new1 = build(newKey);
    expect(JSON.stringify(old1.zombies)).toBe(JSON.stringify(plain.zombies)); // the visited station: exactly the old enemies, so its kill indices mean the same
    expect(rosterOf(old1)).toBeUndefined();
    expect(rosterOf(new1)).toMatchObject({version: ROSTER_VERSION});
    run.memory(newKey).visits++;
    const old2 = build(oldKey), new2 = build(newKey);
    expect(JSON.stringify(old2.zombies)).toBe(JSON.stringify(old1.zombies));
    expect(JSON.stringify(new2.zombies)).toBe(JSON.stringify(new1.zombies)); // a revisit: the same roster, never rerolled
    expect([run.laneStore(ROSTER_LANE, oldKey), run.laneStore(ROSTER_LANE, newKey)]).toEqual([{v: 0}, {v: ROSTER_VERSION}]);
    expect(run.memory(oldKey).killed).toEqual([0, 3, 7]);
    // the game applies exactly this rule (always an explicit version in the generator inputs, the lane recorded at the first build)
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
    expect(src).toMatch(/rosterVersion: rosterVersionFor\(run\.peekMemory\(key\)\)/);
    expect(src).toMatch(/if \(run\.laneStore\(ROSTER_LANE, key\) === undefined\) run\.setLaneStore\(ROSTER_LANE, \{v: ctx\.rosterVersion \?\? 0\}, key\);/);
    const reg = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/levels/registry.ts'), 'utf8');
    expect(reg).toMatch(/applyEnemyRoster\(layout, id, ctx\.levelSeed, ctx\.rosterVersion \?\? 0\)/);
  });
});
