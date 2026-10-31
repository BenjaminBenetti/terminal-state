// Iteration 12 (AI lane, mandate F "More enemies. Double the number of enemies."): enemy population across a fixed
// seed corpus vs the measured d632ce8 baseline (ai/creatureSpawn.ts ENEMY_SPAWNS_BASELINE: 78 stations, 1033 enemies,
// mean 13.24, 11..16, rat/dog 4.84 %, coated 38.8 % of zombies, main / upper / lower 74.5 / 14.0 / 11.4 %).
// The doubled population must keep the archetype / type proportions, the level share, safe placement (never near the
// player spawn, on its storey's floor, off stair flights, spaced, reachable) and spread over areas, deterministically.

import {describe, expect, it} from 'vitest';
import {isExtensionArea} from '../src/gen/trackExt/index'; // Track 2 (lane CONTENT)
import {ARCHETYPES, generateStation, MIN_ZOMBIE_SPAWN_CELLS, type StationLayout} from '../src/gen/station';
import {FLOOR, PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {levelDistance} from '../src/gen/levelGen';
import {ENEMY_POOL, ENEMY_POPULATION_SCALE, ENEMY_SPAWNS, ENEMY_SPAWNS_BASELINE} from '../src/ai/creatureSpawn';

// 30 natural seeds (the baseline corpus's first 30) + 2 per archetype
const CORPUS = [
  ...Array.from({length: 30}, (_, i) => ({seed: (i * 2654435761 + 12345) >>> 0, arch: undefined as undefined | (typeof ARCHETYPES)[number]})),
  ...ARCHETYPES.flatMap((arch, k) => [0, 1].map(j => ({seed: 9001 + k * 7919 + j * 104729, arch}))),
];
const cache = new Map<string, StationLayout>();
const gen = (seed: number, arch?: (typeof ARCHETYPES)[number]) => {
  const key = `${seed}:${arch ?? ''}`;
  let l = cache.get(key);
  if (!l) cache.set(key, (l = generateStation(seed, arch ? {archetype: arch} : {})));
  return l;
};
const ALL = () => CORPUS.map(c => gen(c.seed, c.arch));

describe('doubled enemy population (mandate F)', () => {
  it('about 2x the d632ce8 baseline per station (22-32 spawns, every one placed), proportions preserved', () => {
    expect(ENEMY_POPULATION_SCALE).toBe(2);
    expect(ENEMY_SPAWNS).toEqual({min: 22, max: 32});
    let total = 0, rat = 0, coated = 0, zombies = 0, offMain = 0;
    const counts: number[] = [];
    for (const l of ALL()) {
      // Track 2 (lane CONTENT): the station context's spawns (a service annex's zone budget is separate: tests/annex-content.test.ts)
      const station = l.zombies.filter(z => !isExtensionArea(l.areas[z.area]));
      const n = station.length;
      counts.push(n);
      expect(n, `${l.seed}`).toBeGreaterThanOrEqual(ENEMY_SPAWNS.min);
      expect(n, `${l.seed}`).toBeLessThanOrEqual(ENEMY_SPAWNS.max);
      total += n;
      for (const z of station) {
        if (z.archetype === 'ratdog') rat++;
        else { zombies++; if (z.type === 'coated') coated++; }
        if (z.level) offMain++;
      }
    }
    const mean = total / counts.length;
    const ratShare = rat / total, coatedShare = coated / zombies, offShare = offMain / total;
    const poolRat = ENEMY_POOL.find(([id]) => id === 'ratdog')![1] / ENEMY_POOL.reduce((s, [, w]) => s + w, 0);
    console.info(`[population] ${counts.length} stations: ${total} enemies, mean ${mean.toFixed(2)} (baseline ${ENEMY_SPAWNS_BASELINE.mean}, x${(mean / ENEMY_SPAWNS_BASELINE.mean).toFixed(2)}), ` +
      `range ${Math.min(...counts)}..${Math.max(...counts)}, rat/dog ${(ratShare * 100).toFixed(1)} %, coated ${(coatedShare * 100).toFixed(1)} % of zombies, off-main ${(offShare * 100).toFixed(1)} %`);
    expect(mean / ENEMY_SPAWNS_BASELINE.mean).toBeGreaterThan(1.85);
    expect(mean / ENEMY_SPAWNS_BASELINE.mean).toBeLessThan(2.25);
    // the per-spawn rolls are unchanged: ~5 % rat/dog of ALL enemies, ~40 % coated zombies, ~1/4 on the upper / lower levels
    expect(Math.abs(ratShare - poolRat)).toBeLessThan(0.03);
    expect(coatedShare).toBeGreaterThan(0.33);
    expect(coatedShare).toBeLessThan(0.47);
    expect(offShare).toBeGreaterThan(0.17);
    expect(offShare).toBeLessThan(0.34);
  });

  it('safe placement holds: far from the player spawn, on its storey floor, off stairs, spaced, spread over areas and levels, reachable', () => {
    for (const l of ALL()) {
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = levelDistance(l.levels, sx, sy);
      const perArea = new Map<number, number>(), levels = new Set<number>();
      for (const z of l.zombies) {
        const g = l.levels[z.level ?? 0].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
        const tag = `${l.seed} ${z.x.toFixed(1)},${z.z.toFixed(1)} L${z.level ?? 0}`;
        expect(g.cells[i], tag).toBe(FLOOR);
        expect(g.rampIdx[i], `${tag} on a stair flight`).toBe(-1);
        expect(z.y ?? 0, tag).toBeCloseTo(g.floorOf(i), 5);
        expect(g.circleClear(z.x, z.z, 0.35), `${tag} intersects geometry`).toBe(true);
        // walking distance from the player spawn (BFS over every storey: also proves reachability)
        expect(dist[z.level ?? 0][i], `${tag} too close / unreachable`).toBeGreaterThanOrEqual(MIN_ZOMBIE_SPAWN_CELLS);
        for (const o of l.zombies) if (o !== z && Math.abs((o.y ?? 0) - (z.y ?? 0)) < 2) expect(Math.hypot(o.x - z.x, o.z - z.z), `${tag} crowded`).toBeGreaterThanOrEqual(4 - 1e-6);
        perArea.set(z.area, (perArea.get(z.area) ?? 0) + 1);
        levels.add(z.level ?? 0);
      }
      // not a crowd in one place: many distinct areas, at most a few per area, every storey populated
      expect(perArea.size, `${l.seed} distinct areas`).toBeGreaterThanOrEqual(Math.ceil(l.zombies.length * 0.6));
      expect(Math.max(...perArea.values()), `${l.seed} per area`).toBeLessThanOrEqual(4);
      if (l.levels.length >= 3) expect(levels.size, `${l.seed} storeys`).toBe(3);
    }
    // A* from the player spawn with the game's body radius (a sample: the per-archetype stations)
    for (const l of CORPUS.filter(c => c.arch).map(c => gen(c.seed, c.arch)).filter((_, k) => k % 2 === 0)) {
      const pf = new PathFinder(levelsOf(l));
      for (const z of l.zombies) expect(pf.find(l.playerSpawn.x, l.playerSpawn.z, z.x, z.z, 0.3, 200000, {ay: 0, by: z.y ?? 0}), `${l.seed} ${z.x},${z.z}`).not.toBeNull();
    }
  });

  it('deterministic per seed', () => {
    for (const c of CORPUS.slice(0, 4)) {
      const a = gen(c.seed, c.arch), b = generateStation(c.seed, c.arch ? {archetype: c.arch} : {});
      expect(b.zombies).toEqual(a.zombies);
    }
  });
});
