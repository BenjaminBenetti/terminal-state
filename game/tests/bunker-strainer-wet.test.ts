// Task gameplay-feedback-20261111 (lane SPAWNS). User: "Investigate … missing Strainers in Bunker wet areas. Distinguish legitimate
// random absence from broken location eligibility. Fix broken placement without erasing intended seed chances, including Strainer's
// 35% inclusion rule."
//
// FINDINGS (measured on main, lane SPAWNS census; ai/wanderHome.ts has the numbers):
//  - the RULE (ai/enemyRoster.ts FAMILY_ROSTER.strainer: 'context-one', rate 0.35; ai/spawnTables.ts BUNKER_DAMP_CONTEXT): ONE roll per
//    Bunker map from its own seed; an included map holds EXACTLY ONE Strainer, in the slot of the 'damp' context's one spawn
//    (gen/bunker/spawns.ts: the water-damaged areas only, layout.bunker.damp = the maintenance & water storey 4); the other maps none;
//  - generation is right: seeds 1..200 (layout version 2) -> 68 included (34.0 %), every one of them exactly one Strainer in a damp area
//    of storey 4, the damp run placed its spawn on every map (always eligible); seeds 1..60 on version 1 likewise (24 included). So a
//    Bunker without a Strainer is the 65 % roll — a legitimate absence, not broken eligibility;
//  - at runtime it drifted out of its damp rooms now and then (the unbounded idle wander; 6-7 of 8 inside at 180-300 s). FIX: its
//    wander home (ai/wanderHome.ts) — the damp areas. The 35 % roll, the roster and every spawn record are untouched.
// PINNED HERE: the roll's rate; the bounded generation census (inclusion = the roll, exactly one, damp area, storey 4) on both layout
// versions; the Strainer's home is the damp set (nobody else in the damp zone has one); with the home it keeps to the wet rooms.

import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {mulberry32} from '../src/core/rng';
import {aiCpuSim, loadEnemyModels} from './helpers/aiCpuSim';
import {LEVELS} from '../src/levels/registry';
import {FAMILY_ROSTER, ROSTER_VERSION, familyInRoster, rosterOf, rosterRate} from '../src/ai/enemyRoster';
import {spawnContextOf, spawnProfile} from '../src/ai/spawnTables';
import {homeRandomNear, wanderHomeOf} from '../src/ai/wanderHome';
import {Levels} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const P = spawnProfile('bunker');
const gen = (seed: number, layoutVersion?: number): StationLayout =>
  LEVELS.bunker.generate('main', {levelSeed: seed, startWeapon: 'pistol', rosterVersion: ROSTER_VERSION, ...(layoutVersion ? {layoutVersion} : {})});
const strainers = (L: StationLayout) => L.zombies.map((z, i) => (z.archetype === 'strainer' ? i : -1)).filter(i => i >= 0);

describe('bunker Strainer: the 35 % inclusion roll', () => {
  it('the rule is unchanged: 35 % per map, context-one, the damp zone among its contexts', () => {
    const r = FAMILY_ROSTER.strainer;
    expect(r).toMatchObject({mode: 'seeded', since: 1, key: 'strainer', rate: 0.35, place: 'context-one'});
    if (r.mode !== 'seeded' || r.place !== 'context-one') throw new Error('strainer rule');
    expect(r.contexts).toContain('damp');
    expect(rosterRate('strainer', 'bunker')).toBe(0.35);
  });

  it('over 20,000 seeds the Bunker roll includes the Strainer on ~35 % of maps', () => {
    let n = 0;
    const N = 20000;
    for (let s = 1; s <= N; s++) if (familyInRoster('strainer', 'bunker', s)) n++;
    expect(n / N).toBeGreaterThan(0.338);
    expect(n / N).toBeLessThan(0.362);
  });
});

describe('bunker Strainer: generation census', () => {
  for (const [version, seeds] of [[undefined, Array.from({length: 40}, (_, k) => k + 1)], [1, Array.from({length: 12}, (_, k) => k + 1)]] as const) {
    it(`layout version ${version ?? 'current'}: included = the roll; exactly one, in a damp area of the damp storey; absent = none`, () => {
      let included = 0;
      for (const seed of seeds) {
        const L = gen(seed, version), rep = rosterOf(L)!.families.strainer!, damp = new Set(L.bunker!.damp), roll = familyInRoster('strainer', 'bunker', seed);
        const dampLevels = new Set([...damp].map(id => L.areas[id].level ?? 0));
        expect(damp.size, `seed ${seed}: damp areas`).toBeGreaterThan(0);
        expect([...dampLevels], `seed ${seed}: the damp storey`).toEqual([4]);
        // the damp run places its one spawn on every map: the family is always ELIGIBLE (never a silent drop)
        const dampIdx = L.zombies.map((_, i) => i).filter(i => spawnContextOf(L, P, i) === 'damp');
        expect(dampIdx.length).toBe(1);
        expect(damp.has(L.zombies[dampIdx[0]].area)).toBe(true);
        expect(rep.eligible).toBe(true);
        expect(rep.present, `seed ${seed}: present = the roll`).toBe(roll);
        const st = strainers(L);
        if (!roll) { expect(st, `seed ${seed}: absent`).toEqual([]); continue; }
        included++;
        expect(st, `seed ${seed}: exactly one`).toEqual(dampIdx);
        const z = L.zombies[st[0]];
        expect(damp.has(z.area), `seed ${seed}: in a damp area`).toBe(true);
        expect(z.level ?? 0).toBe(4);
      }
      expect(included).toBeGreaterThan(0);
      expect(included).toBeLessThan(seeds.length);
    }, 120000);
  }

  it('the Strainer\'s wander home is the damp set; the damp zone\'s other occupants and every other spawn have none', () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const L = gen(seed);
      L.zombies.forEach((z, i) => {
        const h = wanderHomeOf(L, z);
        if (z.archetype === 'strainer') {
          expect(h?.kind).toBe('strainer-damp');
          expect([...h!.areas].sort()).toEqual([...L.bunker!.damp].sort());
          checked++;
        } else expect(h, `seed ${seed} #${i}`).toBeNull();
      });
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);

  it('homeRandomNear on the damp storey: inside every target is damp; outside and calm near the wet rooms it heads back; aware = ordinary', () => {
    const seed = [...Array(40).keys()].map(k => k + 1).find(s => familyInRoster('strainer', 'bunker', s))!;
    const L = gen(seed), z = L.zombies[strainers(L)[0]], home = wanderHomeOf(L, z)!, lv = new Levels(L.levels, L.levelLinks, L.rails), G = lv.grid(4);
    const rand = mulberry32(0x5eed);
    const isHome = (p: readonly number[]) => { const [cx, cy] = G.cellOf(p[0], p[1]); return home.areas.has(G.area[G.idx(cx, cy)]); };
    for (let k = 0; k < 100; k++) {
      const p = homeRandomNear(lv, home, rand, z.x, z.z, 6, z.y, k % 2 === 0);
      expect(p).not.toBeUndefined();
      if (p) expect(isHome(p)).toBe(true);
    }
    // a walkable non-damp cell of storey 4 next to a damp one (a corridor between wet rooms)
    let out: [number, number] | null = null;
    for (let y = 1; y < G.h - 1 && !out; y++) for (let x = 1; x < G.w - 1 && !out; x++) {
      const i = G.idx(x, y);
      if (!G.walkable(x, y) || home.areas.has(G.area[i]) || (L.areas[G.area[i]]?.level ?? -1) !== 4) continue;
      if ([[2, 0], [-2, 0], [0, 2], [0, -2]].some(([ox, oy]) => G.walkable(x + ox, y + oy) && home.areas.has(G.area[G.idx(x + ox, y + oy)]))) out = G.center(x, y);
    }
    expect(out).not.toBeNull();
    const fy = G.cellFloor(...G.cellOf(out![0], out![1]));
    let back = 0;
    for (let k = 0; k < 50; k++) {
      expect(homeRandomNear(lv, home, rand, out![0], out![1], 6, fy, false), 'aware outside: the ordinary pick').toBeUndefined();
      const p = homeRandomNear(lv, home, rand, out![0], out![1], 6, fy, true);
      if (p) { expect(isHome(p)).toBe(true); back++; }
    }
    expect(back, 'calm outside next to the wet rooms: it heads back in').toBeGreaterThan(30);
  }, 60000);
});

describe('bunker Strainer: it keeps to the wet rooms (real actors, Game.updateZombies replica)', () => {
  let models: Record<string, GLTF>;
  beforeAll(async () => { models = await loadEnemyModels(); }, 300000);

  it('with the player waiting at the start: the included Strainer stays on the damp storey, in its wet rooms (transits aside)', () => {
    const SECS = 180, FPS = 60, EVERY = 10;
    for (const seed of [7, 19]) {
      expect(familyInRoster('strainer', 'bunker', seed)).toBe(true);
      const L = gen(seed), i = strainers(L)[0], home = wanderHomeOf(L, L.zombies[i])!;
      const sim = aiCpuSim(L, {actors: models, clock: 'virtual', dt: 1 / FPS});
      let inside = 0, snaps = 0, wandered = 0;
      for (let f = 1; f <= SECS * FPS; f++) {
        sim.step();
        if (f % (EVERY * FPS) !== 0) continue;
        const b = sim.brains[i], lvl = sim.L.levelAt(b.x, b.z, b.y + 0.05), G = sim.L.grid(lvl), [cx, cy] = G.cellOf(b.x, b.z);
        expect(lvl, `seed ${seed} at ${f / FPS} s: storey`).toBe(4);
        if (home.areas.has(G.area[G.idx(cx, cy)])) inside++;
        snaps++;
        wandered = Math.max(wandered, Math.hypot(b.x - L.zombies[i].x, b.z - L.zombies[i].z));
      }
      expect(inside / snaps, `seed ${seed}: in the wet rooms`).toBeGreaterThanOrEqual(0.9);
      expect(wandered, `seed ${seed}: it still roams its habitat`).toBeGreaterThan(2);
    }
  }, 300000);
});
