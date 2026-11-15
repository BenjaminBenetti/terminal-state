// Task studio-reactor-glowing-zombies-20261115-013245-01: THE REACTOR'S IRRADIATED ZOMBIES — the spawn rule (ai/irradiated.ts) and the
// placement (gen/reactor/irradiated.ts) through the real level registry. User: "keep ALL existing regular zombies, then add a 40%
// zombie-population boost on the lower levels. EVERY added zombie is a glowing irradiated regular zombie with 1.5x normal health. These are
// additions, not replacements." Checked here: the integer rule and the split; version 4 = version 3 record for record plus the appended
// additions (Reactor only, lower storeys only, ordinary family, legal spots, isolated from every RNG stream); the version pin (an old save's
// visited Reactor keeps its enemies and kills); the stats (1.5x hp, nothing else).
import {describe, expect, it} from 'vitest';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {ROSTER_LANE, ROSTER_VERSION, ZOMBIE_FREE_LEVELS, rosterOf, rosterVersionFor} from '../src/ai/enemyRoster';
import {IRRADIATED, irradiatedAddCount, irradiatedOf, isIrradiated, isRegularZombie, splitAdditions} from '../src/ai/irradiated';
import {REACTOR_LOWER_LEVELS, addReactorIrradiated} from '../src/gen/reactor/irradiated';
import {CORE_LEVEL, REACTOR_LEVELS} from '../src/gen/reactor/index';
import {IRRADIATED_STATS, SPRINTER_STATS, ZOMBIE_STATS, spawnStats} from '../src/ai/brain';
import {sprinterEligible} from '../src/ai/sprinter';
import {FLOOR} from '../src/gen/grid';
import {createRun} from '../src/run/runState';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';

const V = IRRADIATED.since, V_BEFORE = V - 1;
const gen = (seed: number, rosterVersion: number): StationLayout => LEVELS.reactor.generate('main', {levelSeed: seed, rosterVersion});
const strip = (l: StationLayout): string => JSON.stringify({...l, zombies: undefined});
/** Census corpus: the level seeds of the roster census (docs/enemy-spawns.md "Census with the roster"), the first 12. */
const SEEDS = Array.from({length: 12}, (_, k) => 1201 + 7919 * k);

describe('irradiated zombies: the integer rule (pure)', () => {
  it('N = round(0.4 R) = floor((2R + 2) / 5); never a half', () => {
    expect([IRRADIATED.boost, IRRADIATED.hpScale, IRRADIATED.since, IRRADIATED.key]).toEqual([0.4, 1.5, 4, 'irradiated']);
    expect(ROSTER_VERSION).toBeGreaterThanOrEqual(V);
    for (let R = 0; R <= 200; R++) {
      expect(irradiatedAddCount(R), `R=${R}`).toBe(Math.round(0.4 * R));
      expect((4 * R) % 10, 'no exact half').not.toBe(5);
    }
    expect([1, 2, 3, 4, 5, 10, 20, 26, 27].map(irradiatedAddCount)).toEqual([0, 1, 1, 2, 2, 4, 8, 10, 11]);
    expect(irradiatedAddCount(-3)).toBe(0);
  });

  it('the per-storey split: proportional, exact total, ties to the deeper storey', () => {
    const at = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    expect(at(splitAdditions(8, [{level: 3, regular: 7}, {level: 4, regular: 7}, {level: 5, regular: 6}]))).toEqual([3, 3, 2]);
    expect(at(splitAdditions(1, [{level: 3, regular: 5}, {level: 4, regular: 5}, {level: 5, regular: 5}]))).toEqual([0, 0, 1]);
    expect(at(splitAdditions(2, [{level: 3, regular: 5}, {level: 4, regular: 5}, {level: 5, regular: 5}]))).toEqual([0, 1, 1]);
    expect(at(splitAdditions(4, [{level: 3, regular: 0}, {level: 4, regular: 10}, {level: 5, regular: 0}]))).toEqual([0, 4, 0]);
    expect(at(splitAdditions(0, [{level: 3, regular: 4}]))).toEqual([0]);
    for (let t = 0; t < 200; t++) {
      const rows = REACTOR_LOWER_LEVELS.map((level, i) => ({level, regular: (t * 7 + i * 13) % 11}));
      const R = rows.reduce((n, r) => n + r.regular, 0), N = irradiatedAddCount(R), s = splitAdditions(N, rows);
      expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(N);
      for (const r of rows) expect(Math.abs(s.get(r.level)! - N * r.regular / Math.max(1, R))).toBeLessThan(1);
    }
  });

  it('the lower levels are the bottom half of the six pit storeys: tier 3, tier 4, the core floor', () => {
    expect(REACTOR_LEVELS).toBe(6);
    expect([...REACTOR_LOWER_LEVELS]).toEqual([3, 4, 5]);
    expect(REACTOR_LOWER_LEVELS[REACTOR_LOWER_LEVELS.length - 1]).toBe(CORE_LEVEL);
  });

  it('stats: 1.5x the type hp, every other number the ordinary type; never a sprinter', () => {
    for (const t of ['shambler', 'coated'] as const) {
      expect(IRRADIATED_STATS[t]).toEqual({...ZOMBIE_STATS[t], hp: ZOMBIE_STATS[t].hp * 1.5});
      expect(spawnStats({type: t, irradiated: true})).toBe(IRRADIATED_STATS[t]);
      expect(spawnStats({type: t, irradiated: true, sprinter: true})).toBe(IRRADIATED_STATS[t]);
      expect(spawnStats({type: t, sprinter: true})).toBe(SPRINTER_STATS[t]);
      expect(spawnStats({type: t})).toBe(ZOMBIE_STATS[t]);
    }
    expect([IRRADIATED_STATS.shambler.hp, IRRADIATED_STATS.coated.hp]).toEqual([150, 247.5]);
    expect(sprinterEligible({irradiated: true})).toBe(false);
    // a special family's spawn never is one, whatever its tag
    expect(isIrradiated({archetype: 'siren', irradiated: true})).toBe(false);
    expect(isRegularZombie({archetype: 'ratdog'})).toBe(false);
    expect(isRegularZombie({})).toBe(true);
  });
});

describe('irradiated zombies: the Reactor through the registry (roster version 4)', () => {
  const runs = SEEDS.map(seed => ({seed, v3: gen(seed, V_BEFORE), v4: gen(seed, V)}));

  it('version 4 = version 3 record for record, plus appended irradiated regular zombies on the lower storeys only', () => {
    const census: string[] = [];
    for (const {seed, v3, v4} of runs) {
      const rep = irradiatedOf(v4)!;
      expect(rep, `${seed}`).toBeDefined();
      expect(irradiatedOf(v3)).toBeUndefined();
      expect(strip(v4)).toBe(strip(v3)); // layout, props, pickups (loot), lights, every other record: identical
      const n = v3.zombies.length;
      expect(JSON.stringify(v4.zombies.slice(0, n))).toBe(JSON.stringify(v3.zombies)); // every existing enemy, index, family, look, pose
      const add = v4.zombies.slice(n);
      expect(rep.first).toBe(n);
      expect(add.length).toBe(rep.placed);
      // the base: the regular zombies of the lower storeys AFTER the roster (v3's)
      const R = v3.zombies.filter(z => REACTOR_LOWER_LEVELS.includes(z.level ?? 0) && isRegularZombie(z)).length;
      expect(rep.regular).toBe(R);
      expect(rep.wanted).toBe(Math.round(0.4 * R));
      expect(rep.short, `${seed}: every addition seated`).toBe(0);
      expect(rep.placed).toBe(rep.wanted);
      for (const row of rep.perStorey) expect(add.filter(z => z.level === row.level).length).toBe(row.placed);
      for (const z of add) {
        expect(z.irradiated).toBe(true);
        expect(isIrradiated(z)).toBe(true);
        expect(z.archetype ?? 'zombie').toBe('zombie');
        expect(z.sprinter).toBeUndefined();
        expect(z.horde).toBeUndefined();
        expect(z.look).toBeUndefined();
        expect(z.variant).toBeUndefined();
        expect(REACTOR_LOWER_LEVELS).toContain(z.level);
      }
      // no other spawn is tagged, and nothing outside the lower storeys moved
      expect(v4.zombies.slice(0, n).some(z => z.irradiated)).toBe(false);
      census.push(`${seed}: R ${R} (${rep.perStorey.map(r => r.regular).join('/')}) -> +${rep.placed} (${rep.perStorey.map(r => r.placed).join('/')}); total ${n} -> ${v4.zombies.length}`);
    }
    // eslint-disable-next-line no-console
    if (process.env.LL_IRR_CENSUS) console.log(census.join('\n'));
  });

  it('the additions stand on legal ground of their storey: walkable floor, a non-stair area of that storey, spaced from every enemy', () => {
    for (const {seed, v4} of runs) {
      const rep = irradiatedOf(v4)!;
      for (let i = rep.first; i < v4.zombies.length; i++) {
        const z = v4.zombies[i], L = v4.levels[z.level!], g = L.grid, [cx, cy] = g.cellOf(z.x, z.z), c = g.idx(cx, cy);
        expect(g.cells[c], `${seed}#${i}`).toBe(FLOOR);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(g.rampIdx[c]).toBeLessThan(0);
        const a = v4.areas[g.area[c]];
        expect(a.id).toBe(z.area);
        expect(a.level ?? 0).toBe(z.level);
        expect(a.role).not.toBe('stair');
        expect(z.y).toBeCloseTo(g.floorOf(c), 6);
        // >= the relaxed 2.5 m to every other enemy on the storey (4 m unless a storey needed the relaxed try)
        for (let j = 0; j < v4.zombies.length; j++) {
          const o = v4.zombies[j];
          if (j === i || (o.level ?? 0) !== z.level) continue;
          expect(Math.hypot(o.x - z.x, o.z - z.z), `${seed}#${i}-${j}`).toBeGreaterThanOrEqual(2.5 - 1e-9);
        }
      }
    }
  });

  it('deterministic and once only: the same seed gives the same additions; re-running the pass on a fresh layout gives the same', () => {
    for (const {seed, v4} of runs.slice(0, 4)) {
      expect(JSON.stringify(gen(seed, V).zombies)).toBe(JSON.stringify(v4.zombies));
      // the pass is isolated from every generation stream: running it again on a v3 layout of the same seed appends the same spawns
      const again = gen(seed, V_BEFORE);
      const rep = addReactorIrradiated(again, seed);
      expect(rep.noField).toBeUndefined();
      expect(JSON.stringify(again.zombies)).toBe(JSON.stringify(v4.zombies));
    }
  });

  it('every other level at version 4 is its version 3 record for record (no additions, no report)', () => {
    for (const id of LEVEL_IDS.filter(l => l !== 'reactor')) {
      for (const seed of [1201, 9120]) {
        const a = LEVELS[id].generate('main', {levelSeed: seed, rosterVersion: V_BEFORE});
        const b = LEVELS[id].generate('main', {levelSeed: seed, rosterVersion: V});
        expect(JSON.stringify(b.zombies), `${id} ${seed}`).toBe(JSON.stringify(a.zombies));
        expect(irradiatedOf(b)).toBeUndefined();
        expect(b.zombies.some(z => z.irradiated)).toBe(false);
        if (!ZOMBIE_FREE_LEVELS.includes(id)) expect(rosterOf(b)?.version).toBe(V);
      }
    }
  });
});

describe('irradiated zombies: saves (the roster version pin)', () => {
  it('an old save keeps its visited Reactor exactly (no additions, kills unchanged); a Reactor first entered now gets them, the same on every revisit', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const oldKey = {level: 'reactor' as const, section: 'main', station: 'st-old'}, newKey = {level: 'reactor' as const, section: 'main', station: 'st-new'};
    // an old campaign: this Reactor was built at version 3 and two enemies were killed
    run.setLaneStore(ROSTER_LANE, {v: 3}, oldKey);
    run.memory(oldKey).visits = 1;
    run.memory(oldKey).killed = [2, 5];
    const build = (k: typeof oldKey): StationLayout => {
      const rosterVersion = rosterVersionFor(run.peekMemory(k)); // Game.sectionGenInputs
      const layout = LEVELS[k.level].generate(k.section, {levelSeed: 9120, rosterVersion});
      if (run.laneStore(ROSTER_LANE, k) === undefined) run.setLaneStore(ROSTER_LANE, {v: rosterVersion}, k); // Game.generateSection
      return layout;
    };
    const old1 = build(oldKey), new1 = build(newKey);
    expect(rosterVersionFor(run.peekMemory(oldKey))).toBe(3);
    expect(old1.zombies.some((z: ZombieSpawn) => z.irradiated)).toBe(false);
    expect(JSON.stringify(old1.zombies)).toBe(JSON.stringify(gen(9120, 3).zombies));
    expect(irradiatedOf(new1)?.placed).toBeGreaterThan(0);
    expect(run.laneStore(ROSTER_LANE, newKey)).toEqual({v: ROSTER_VERSION});
    run.memory(newKey).visits++;
    run.memory(newKey).killed = [new1.zombies.length - 1]; // the last addition killed
    const new2 = build(newKey);
    expect(JSON.stringify(new2.zombies)).toBe(JSON.stringify(new1.zombies)); // revisit / Continue / Retry: same spawns, same indices
    expect(run.memory(oldKey).killed).toEqual([2, 5]);
    // a station visited before the roster existed (no record): version 0, nothing at all
    expect(rosterVersionFor({visits: 2, lanes: {}})).toBe(0);
    expect(rosterVersionFor({visits: 2, lanes: {[ROSTER_LANE]: {v: 4}}})).toBe(4);
  });
});
