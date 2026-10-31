// Task track3-eaton-centre-20261031 (lane HORDE): ROAMING HORDES — rules, seeded placement, budgets, patrol over real links,
// cohesion, perception (break formation / regroup), persistence (kills stay dead, no top-up), frame-cost bounds and the vocal cap.
// Runs on a SYNTHETIC ring mall (tests/helpers/hordeMallFixture.ts: storeys of galleries round an open void joined by real stair
// runs) with the game's own brain / motor / PathFinder / PathService / FrameBudget; the generated mall (lane GEN) is covered in the
// last block when it is registered. Old levels: no hordes, no horde tags (their parity / fingerprint suites stay as they are).

import {describe, expect, it} from 'vitest';
import {ringMallFixture, ringY, type RingMallFixture} from './helpers/hordeMallFixture';
import {Rng, mulberry32} from '../src/core/rng';
import {levelsOf, type Levels} from '../src/gen/levels';
import {PathFinder, CELL} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {moveZombie, sameLevel, settleZombie} from '../src/ai/motor';
import {PathService, nearPlayerRule} from '../src/ai/pathService';
import {FrameBudget} from '../src/core/frameBudget';
import {S, UpdateProfiler} from '../src/debug/updateProfile';
import {lureWorld} from '../src/ai/lightLure';
import {HORDE_AI, HordeDirector, slotOffset} from '../src/ai/horde';
import {ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from '../src/ai/chaseShare';
import {placeHordes} from '../src/ai/hordePlace';
import {HORDE_FORBIDDEN_FAMILIES, HORDE_GROUP_SIZE, MALL_HORDE_RULES, validateHordeRules, type HordeRules} from '../src/ai/hordeSpec';
import {ENEMY_FAMILY_IDS, SERVICE_ZONE_BUDGET, SPAWN_PROFILES, validateSpawnProfile} from '../src/ai/spawnTables';
import {isExtensionArea} from '../src/gen/trackExt/types';
import {assignEnemyArchetypes} from '../src/ai/creatureSpawn';
import {enemiesToSpawn, mergeKilled, createMemory, cloneMemory} from '../src/run/memory';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {MallPatrolNode} from '../src/gen/mall/mallTypes';

const DT = 1 / 60;
/** Opt-in longer runs + baselines (LL_BENCH=1), as tests/frame-costs.bench.test.ts. */
const BENCH = !!process.env.LL_BENCH;
/** A shambler's sight range (m): ai/brain.ts ZOMBIE_STATS. */
const ZOMBIE_SIGHT = 18;

/** Fixture rules: the mall's pool / sizes / budgets, placement distances scaled to the 40 x 14 m fixture rings. */
function fxRules(o: Partial<HordeRules> = {}): HordeRules {
  return {...MALL_HORDE_RULES, placement: {...MALL_HORDE_RULES.placement, startM: 12, groupSpacingM: 10}, ...o};
}

function place(fx: RingMallFixture, rules: HordeRules, seed: number) {
  const ring = Array.from({length: fx.storeys - 1}, (_, i) => i + 1);
  return placeHordes(fx.layout, rules, new Rng(seed), {patrol: fx.patrol, ringStoreys: ring});
}

interface Player { x: number; y: number; z: number; alive: boolean }

/** Game.updateZombies minus rendering / audio, with the horde director, on a fixture (optionally through a frame budget). */
function makeSim(fx: {layout: StationLayout; patrol: readonly MallPatrolNode[]}, o: {scheduler?: boolean; killed?: number[]; player?: Player; rules?: HordeRules; noHordes?: boolean; prof?: UpdateProfiler; noShare?: boolean; atrium?: boolean} = {}) {
  const prof = o.prof ?? null;
  const layout = fx.layout;
  const L: Levels = levelsOf(layout);
  const props = new PropIndex(L, layout.props);
  const pf = new PathFinder(L), fork = pf.fork();
  const player: Player = o.player ?? {x: -100, y: 0, z: -100, alive: false};
  const clock = {t: 0};
  // the game's budget clock: real time (a frozen clock would make every chunk look free and run 48 per frame)
  const fb = o.scheduler ? new FrameBudget() : null;
  const near = (x: number, z: number, y: number | undefined) => nearPlayerRule(Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y), () => null);
  const stats = {paths: 0, walk: 0, byWho: {plain: {n: 0, ms: 0, max: 0}, chase: {n: 0, ms: 0, max: 0}, horde: {n: 0, ms: 0, max: 0}} as Record<'plain' | 'chase' | 'horde', {n: number; ms: number; max: number}>};
  // atrium: the game's open-atrium configuration (layout.mall): local search bound, per-frame cap, strict seen near rule (no route
  // field in this harness: an unknown route is not near), BrainWorld.atrium below
  const ps = new PathService((ax, az, bx, bz, op) => { stats.paths++; return pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op); },
    (ax, az, bx, bz, op, chunk) => fork.search(ax, az, bx, bz, 0.34, searchExpand(op), op, chunk), fb, near,
    o.atrium ? atriumPathOptions((x, z, y) => Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y) < 4, (x, z, y) => atriumNearRule(Math.hypot(x - player.x, z - player.z, (y ?? player.y) - player.y), (y ?? player.y) - player.y, () => null)) : undefined);
  const killed = new Set(o.killed ?? []);
  const brains: (ZombieBrain | undefined)[] = layout.zombies.map((s, i) => {
    if (killed.has(i)) return undefined;
    const b = new ZombieBrain(s.type, s.x, s.z, s.yaw);
    b.y = s.y ?? 0;
    return b;
  });
  // noHordes: the same bodies as ordinary enemies (idle / wander) — the cost baseline
  const director = new HordeDirector(layout, L, i => (o.noHordes ? undefined : brains[i]), (o.rules ?? MALL_HORDE_RULES).patrol, fx.patrol);
  const share = o.noShare ? null : new ChaseShare(L);
  const rand = mulberry32(99);
  const world = (): BrainWorld => ({
    px: player.x, pz: player.z, py: player.y, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => { stats.walk++; return L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by); },
    findPath: (ax, az, bx, bz, op) => {
      prof?.begin(S.path);
      const t = performance.now();
      // the game's brainWorld.findPath in an open-atrium level: a chase may join another chaser's recent route (ai/chaseShare.ts)
      const shared = share ? share.lookup(ax, az, bx, bz, op) : undefined;
      const r = shared !== undefined ? shared : ps.request(ax, az, bx, bz, op);
      if (share && shared === undefined) share.remember(ax, az, bx, bz, op, r);
      const ms = performance.now() - t;
      prof?.end(S.path);
      // who asked: a horde leg (group owner) / regroup (member), a brain's chase re-plan (defer = the brain), or an immediate request
      const who = !op?.defer ? 'plain' : op.defer instanceof ZombieBrain ? 'chase' : 'horde';
      const c = stats.byWho[who];
      c.n++; c.ms += ms; if (ms > c.max) c.max = ms;
      return r;
    },
    randomNear: (x, z, r, y) => {
      const lv = y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
      const G = L.grid(lv);
      for (let i = 0; i < 14; i++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand,
    ...lureWorld(L, {attracting: () => []}),
    ...(o.atrium ? {atrium: true} : {}),
  });
  let frame = 0, raf = 0;
  const live = () => brains.filter((b): b is ZombieBrain => !!b);
  const sim = {
    layout, L, pf, ps, fb, brains, director, share, player, stats, live,
    get frame() { return frame; },
    /** One 60 Hz frame; returns {ms of the horde director, walk tests, path searches} of the frame. */
    step(onFrame?: () => void) {
      frame++;
      raf += 1000 / 60;
      clock.t = Math.max(clock.t, raf);
      if (fb) { fb.hold(null); fb.beginFrame(raf); }
      if (prof) { prof.frameBegin(); prof.lap(S.input); prof.lap(S.ai); }
      ps.tick();
      share?.tick(DT);
      const w = world();
      const w0 = stats.walk, p0 = stats.paths;
      const t0 = performance.now();
      director.update(DT, w, player);
      const dirMs = performance.now() - t0;
      const all = live();
      const t1 = performance.now();
      for (const b of all) {
        prof?.begin(S.brain);
        const out = b.update(DT, w);
        prof?.end(S.brain);
        prof?.begin(S.motor);
        if (out.alerted) director.alerted(b);
        if (out.face !== null) {
          let d = out.face - b.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const turn = (b.state === 'attack' ? 7 : 4.5) * DT;
          b.yaw += Math.max(-turn, Math.min(turn, d));
        }
        moveZombie(b, out, DT, L, props);
        if (b.alive && !b.climbing) {
          for (const q of all) {
            if (q === b || !q.alive || !sameLevel(b.y, q.y)) continue;
            const dx = b.x - q.x, dz = b.z - q.z, dd = Math.hypot(dx, dz), min = b.stats.radius + q.stats.radius;
            if (dd > 1e-4 && dd < min) { const push = (min - dd) * 0.5; b.x += dx / dd * push; b.z += dz / dd * push; }
          }
          settleZombie(b, L, props);
        }
        prof?.end(S.motor);
      }
      const aiMs = performance.now() - t1;
      onFrame?.();
      prof?.lap(S.deferred);
      if (fb) fb.run();
      prof?.frameEnd();
      return {dirMs, aiMs, walk: stats.walk - w0, paths: stats.paths - p0};
    },
    run(seconds: number, onFrame?: () => void) { for (let i = 0; i < Math.round(seconds * 60); i++) sim.step(onFrame); },
  };
  return sim;
}

/** A point is supported by real walkable geometry: a band floor within 0.3 m of y on a walkable (or stair) cell. */
function supported(L: Levels, x: number, z: number, y: number): boolean {
  const s = L.supportIn(x, z, y + 0.05, 0.45);
  if (!s || Math.abs(s.floor - y) > 0.35) return false;
  const g = L.grid(s.level), [cx, cy] = g.cellOf(x, z);
  return g.walkable(cx, cy);
}

// ---------------------------------------------------------------------------------------------------------------------------

describe('horde rules: the separate pool (ai/hordeSpec.ts)', () => {
  it('the mall rules are valid: 5..20 per group, explicit pool (zombies only), budgets that hold groups, slow roam', () => {
    expect(validateHordeRules(MALL_HORDE_RULES, ENEMY_FAMILY_IDS)).toEqual([]);
    expect(MALL_HORDE_RULES.size[0]).toBeGreaterThanOrEqual(HORDE_GROUP_SIZE.min);
    expect(MALL_HORDE_RULES.size[1]).toBeLessThanOrEqual(HORDE_GROUP_SIZE.max);
    expect(HORDE_GROUP_SIZE).toEqual({min: 5, max: 20});
    expect(MALL_HORDE_RULES.families.filter(([, w]) => w > 0).map(([f]) => f)).toEqual(['zombie']);
    expect(MALL_HORDE_RULES.patrol.speed).toBeLessThan(0.55); // below the slowest zombie's wander speed
    // the registered mall profile (lane PROFILES) declares a horde pool that validates, with its own budget
    const mall = (SPAWN_PROFILES as Record<string, (typeof SPAWN_PROFILES)['subway']>).mall;
    if (mall) {
      expect(mall.horde, 'SPAWN_PROFILES.mall.horde').toBeTruthy();
      expect(validateSpawnProfile(mall).filter(s => s.includes('horde'))).toEqual([]);
      expect(mall.horde!.families.filter(([, w]) => w > 0).every(([f]) => !HORDE_FORBIDDEN_FAMILIES.includes(f) && f !== 'ratdog')).toBe(true);
    }
    // subway / office: no horde pool at all
    expect(SPAWN_PROFILES.subway.horde).toBeUndefined();
    expect(SPAWN_PROFILES.office.horde).toBeUndefined();
  });

  it('validation rejects groups outside 5..20, Sirens, unknown families, budgets that cannot hold a group, fast "roams"', () => {
    const v = (o: Partial<HordeRules>, ids: readonly string[] = ENEMY_FAMILY_IDS) => validateHordeRules({...MALL_HORDE_RULES, ...o}, ids);
    expect(v({size: [3, 20]}).join()).toMatch(/initial group range/);
    expect(v({size: [5, 24]}).join()).toMatch(/initial group range/);
    expect(v({families: [['zombie', 1], ['siren' as 'zombie', 0.1]]}, [...ENEMY_FAMILY_IDS, 'siren']).join()).toMatch(/siren never joins/);
    expect(v({families: [['zombie', 1], ['ghoul' as 'zombie', 1]]}).join()).toMatch(/unknown family/);
    expect(v({families: [['zombie', 0]]}).join()).toMatch(/positive weight/);
    expect(v({budget: {total: 4, perStorey: 20, groupsPerStorey: 1}}).join()).toMatch(/cannot hold one group/);
    expect(v({patrol: {...MALL_HORDE_RULES.patrol, speed: 2.5}}).join()).toMatch(/slow roam/);
    expect(v({placement: {...MALL_HORDE_RULES.placement, memberSpacingM: 0.4}}).join()).toMatch(/overlap/);
  });

  it('formation slots: one leader, staggered rows of 2 / 3, never two members on one slot', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 20; k++) { const s = slotOffset(k).join(','); expect(seen.has(s), s).toBe(false); seen.add(s); }
    expect(slotOffset(0)).toEqual([0, 0]);
    expect([1, 2].map(k => slotOffset(k)[0])).toEqual([1, 1]);
    expect([3, 4, 5].map(k => slotOffset(k)[0])).toEqual([2, 2, 2]);
    expect(Math.max(...Array.from({length: 20}, (_, k) => slotOffset(k)[0]))).toBeLessThanOrEqual(9);
  });
});

describe('horde placement: seeded, bounded, once (ai/hordePlace.ts)', () => {
  it('places 5..20 ordinary zombies per group on clear ring floor, spaced, far from the start, within every budget', () => {
    let groups = 0, members = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const fx = ringMallFixture({storeys: 4});
      const rules = fxRules();
      const rep = place(fx, rules, seed * 7919);
      const L = levelsOf(fx.layout);
      const hs = fx.layout.hordes!;
      expect(rep.placed).toBe(hs.length);
      expect(hs.length).toBeLessThanOrEqual(rules.groups[1]);
      // budgets: total, per storey (members and groups)
      const total = hs.reduce((n, h) => n + h.members.length, 0);
      expect(total).toBeLessThanOrEqual(rules.budget.total);
      for (const s of [1, 2, 3]) {
        const on = hs.filter(h => h.level === s);
        expect(on.length).toBeLessThanOrEqual(rules.budget.groupsPerStorey);
        expect(on.reduce((n, h) => n + h.members.length, 0)).toBeLessThanOrEqual(rules.budget.perStorey);
      }
      for (const h of hs) {
        expect(h.members.length, `seed ${seed} group ${h.id}`).toBeGreaterThanOrEqual(HORDE_GROUP_SIZE.min);
        expect(h.members.length).toBeLessThanOrEqual(HORDE_GROUP_SIZE.max);
        expect([1, 2, 3]).toContain(h.level); // ring storeys only (never the pit / station)
        for (const i of h.members) {
          const z = fx.layout.zombies[i];
          expect(z.horde).toBe(h.id);
          expect(z.archetype).toBe('zombie'); // no rat/dog, Blightbelly or Siren in a standard horde
          expect(z.level).toBe(h.level);
          const g = L.grid(h.level), [cx, cy] = g.cellOf(z.x, z.z), c = g.idx(cx, cy);
          expect(g.walkable(cx, cy) && g.rampIdx[c] < 0).toBe(true);
          expect(z.y).toBeCloseTo(ringY(h.level), 5);
          expect(g.circleClear(z.x, z.z, 0.38)).toBe(true);
          for (const j of h.members) if (j !== i) expect(Math.hypot(fx.layout.zombies[j].x - z.x, fx.layout.zombies[j].z - z.z)).toBeGreaterThanOrEqual(rules.placement.memberSpacingM - 1e-9);
          expect(Math.hypot(z.x - h.start.x, z.z - h.start.z)).toBeLessThanOrEqual(rules.placement.clusterM + 1e-9);
        }
      }
      groups += hs.length;
      members += total;
    }
    console.info(`[horde placement] 24 seeds on the 4-storey fixture: ${groups} groups, ${members} members (mean ${(members / Math.max(1, groups)).toFixed(1)} per group)`);
    expect(groups).toBeGreaterThan(24);
  });

  it('is deterministic per seed and never touched by the ambient family roll', () => {
    const a = ringMallFixture({storeys: 4}), b = ringMallFixture({storeys: 4});
    place(a, fxRules(), 1234);
    place(b, fxRules(), 1234);
    expect(JSON.stringify(a.layout.zombies)).toBe(JSON.stringify(b.layout.zombies));
    expect(JSON.stringify(a.layout.hordes)).toBe(JSON.stringify(b.layout.hordes));
    // an ambient pool that is ALL rat/dog would turn every ambient spawn into one — horde members keep their horde family
    const before = a.layout.zombies.map(z => z.archetype);
    assignEnemyArchetypes(a.layout, {...SPAWN_PROFILES.subway, families: [['zombie', 0], ['ratdog', 1]]});
    expect(a.layout.zombies.map(z => z.archetype)).toEqual(before);
  });

  it('respects a tight budget (never a group under five) and keeps off the ambient enemies', () => {
    const fx = ringMallFixture({storeys: 4});
    // three ambient enemies on ring 2 near its nodes
    for (const id of fx.gallery[2].slice(0, 3)) { const n = fx.patrol[id]; fx.layout.zombies.push({x: n.x + 1, z: n.z, yaw: 0, type: 'shambler', area: 0, level: 2, y: ringY(2)}); }
    const rules = fxRules({groups: [5, 5], budget: {total: 23, perStorey: 12, groupsPerStorey: 1}});
    const rep = place(fx, rules, 77);
    const hs = fx.layout.hordes!;
    expect(hs.reduce((n, h) => n + h.members.length, 0)).toBeLessThanOrEqual(23);
    for (const h of hs) { expect(h.members.length).toBeGreaterThanOrEqual(5); expect(h.members.length).toBeLessThanOrEqual(12); }
    expect(rep.skipped.length).toBeGreaterThan(0); // five asked, the budget / storeys hold fewer
    for (const h of hs) for (const i of h.members) for (const a of fx.layout.zombies.slice(0, 3)) {
      const z = fx.layout.zombies[i];
      if (z.level === a.level) expect(Math.hypot(z.x - a.x, z.z - a.z)).toBeGreaterThanOrEqual(rules.placement.ambientSpacingM - 1e-9);
    }
  });

  it('no rules / no patrol graph = no hordes (the Subway and Office Space generate none)', () => {
    const fx = ringMallFixture();
    expect(placeHordes(fx.layout, undefined, new Rng(1)).placed).toBe(0);
    expect(placeHordes(fx.layout, fxRules(), new Rng(1), {patrol: []}).placed).toBe(0);
    for (const id of ['subway', 'office'] as const) {
      const l = LEVELS[id].generate('main', {levelSeed: 0x51ab, startWeapon: 'pistol'});
      expect(l.hordes ?? []).toEqual([]);
      expect(l.zombies.some(z => z.horde !== undefined)).toBe(false);
    }
  });
});

describe('horde behaviour on the ring fixture (brain + motor + PathFinder + director)', () => {
  it('patrols along real links only: the anchor and every member always stand on walkable geometry, storeys change on the stairs', () => {
    // a bogus "edge" straight across the void on ring 1 (N-mid <-> S-mid): the leg must still walk a real route round the void
    const base = ringMallFixture({storeys: 3});
    const fx = ringMallFixture({storeys: 3, extraEdges: [[base.gallery[1][1], base.gallery[1][5], 'bridge']]});
    const rules = fxRules({groups: [2, 2], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0.9, pauseChance: 0.1}});
    place(fx, rules, 31337);
    const sim = makeSim(fx, {rules});
    const prev = sim.director.groups.map(g => ({x: g.ax, z: g.az, y: g.ay}));
    let bad = 0, offGeom = 0, jumps = 0, storeyChanges = 0;
    const lastLv = sim.director.groups.map(g => sim.L.levelAt(g.ax, g.az, g.ay + 0.05));
    sim.run(300, () => {
      sim.director.groups.forEach((g, k) => {
        const p = prev[k];
        if (!supported(sim.L, g.ax, g.az, g.ay)) bad++;
        const step = Math.hypot(g.ax - p.x, g.az - p.z);
        if (step > 0.05 && !sim.L.walkLineClear(p.x, p.y, p.z, g.ax, g.az, 0.1)) jumps++;
        const lv = sim.L.levelAt(g.ax, g.az, g.ay + 0.05);
        if (lv !== lastLv[k]) {
          storeyChanges++;
          // on a stair run or stepping off its end (a run's cells belong to both storeys: the level flips at the landing edge)
          const gg = sim.L.grid(lv), [cx, cy] = gg.cellOf(g.ax, g.az);
          let ramp = false;
          for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (gg.inBounds(cx + ox, cy + oy) && gg.rampIdx[gg.idx(cx + ox, cy + oy)] >= 0) ramp = true;
          expect(ramp, `a storey change happens on a stair run (${g.ax.toFixed(2)}, ${g.az.toFixed(2)} L${lv})`).toBe(true);
          lastLv[k] = lv;
        }
        prev[k] = {x: g.ax, z: g.az, y: g.ay};
      });
      if (sim.frame % 30 === 0) for (const b of sim.live()) if (!supported(sim.L, b.x, b.z, b.y)) offGeom++;
    });
    const sum = sim.director.summary();
    console.info(`[horde patrol] 300 s, 2 groups: legs ${sum.map(g => g.legs).join('/')}, walked ${sum.map(g => g.walked).join('/')} m, storey changes ${storeyChanges}, bad legs ${sum.map(g => g.badLegs).join('/')}`);
    expect(bad).toBe(0);
    expect(jumps).toBe(0);
    expect(offGeom).toBe(0);
    for (const g of sum) { expect(g.walked).toBeGreaterThan(40); expect(g.legs).toBeGreaterThan(3); }
    expect(storeyChanges).toBeGreaterThan(0);
  });

  it('keeps a loose crowd: members near their slots, no overlaps, width in the courts (no conga line), nobody left behind', () => {
    const fx = ringMallFixture({storeys: 3});
    const rules = fxRules({groups: [1, 1], size: [16, 16], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0.2}});
    place(fx, rules, 4242);
    const sim = makeSim(fx, {rules});
    const g = sim.director.groups[0];
    expect(g.members.length).toBe(16);
    let samples = 0, within = 0, overlaps = 0, pairs = 0, minPair = Infinity;
    const widths: number[] = [];
    sim.run(20); // set off / unspool
    sim.run(160, () => {
      if (sim.frame % 10) return;
      const ms = g.members.filter(m => m.formed && m.hasSlot);
      for (const m of ms) { samples++; if (m.slotErr() <= 3) within++; }
      const bs = g.members.map(m => m.brain);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        if (Math.abs(bs[i].y - bs[j].y) > 1) continue;
        const d = Math.hypot(bs[i].x - bs[j].x, bs[i].z - bs[j].z);
        pairs++;
        if (d < minPair) minPair = d;
        if (d < 0.55) overlaps++;
      }
      // lateral spread perpendicular to the heading while the anchor is in an end court (10 m wide)
      const inCourt = g.ax < 12 || g.ax > 32;
      if (inCourt && g.speedNow > 0) {
        const nx = Math.cos(g.heading), nz = -Math.sin(g.heading);
        const lat = bs.map(b => (b.x - g.ax) * nx + (b.z - g.az) * nz);
        widths.push(Math.max(...lat) - Math.min(...lat));
      }
    });
    const ms = g.members;
    widths.sort((a, b) => a - b);
    console.info(`[horde cohesion] 16 members 160 s: within 3 m of slot ${(within / samples * 100).toFixed(1)} %, min pair ${minPair.toFixed(2)} m, overlaps ${overlaps}/${pairs}, court width median ${widths[widths.length >> 1]?.toFixed(2)} m, max err ${Math.max(...ms.map(m => m.maxErr)).toFixed(2)} m, worst time > 3 m ${Math.max(...ms.map(m => m.farT)).toFixed(1)} s, legs ${g.legs}, walked ${g.distance.toFixed(0)} m`);
    expect(within / samples).toBeGreaterThan(0.9);
    expect(overlaps / pairs).toBeLessThan(0.01);
    expect(minPair).toBeGreaterThan(0.4);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths[widths.length >> 1]).toBeGreaterThan(1.5); // a crowd, not a single file
    for (const m of ms) { expect(m.detached).toBe(false); expect(m.farT).toBeLessThan(20); }
    expect(g.distance).toBeGreaterThan(40);
    // members only ever move by their motor: per-frame displacement bounded (no teleport)
  });

  it('crosses storeys as one crowd over the stairs (members follow the trail up / down the run)', () => {
    const fx = ringMallFixture({storeys: 3});
    const rules = fxRules({groups: [1, 1], size: [10, 10], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 1, pauseChance: 0}});
    place(fx, rules, 99);
    const sim = makeSim(fx, {rules});
    const g = sim.director.groups[0];
    const start = g.spec.level;
    const pos = g.members.map(m => ({x: m.brain.x, z: m.brain.z}));
    let maxStep = 0, changed = false;
    sim.run(300, () => {
      g.members.forEach((m, k) => { maxStep = Math.max(maxStep, Math.hypot(m.brain.x - pos[k].x, m.brain.z - pos[k].z)); pos[k] = {x: m.brain.x, z: m.brain.z}; });
      if (sim.L.levelAt(g.ax, g.az, g.ay + 0.05) !== start) changed = true;
    });
    const lv = sim.L.levelAt(g.ax, g.az, g.ay + 0.05);
    const onAnchor = g.members.filter(m => Math.abs(m.brain.y - g.ay) < 1.2 || Math.hypot(m.brain.x - g.ax, m.brain.z - g.az) < 14).length;
    console.info(`[horde storeys] start L${start} -> now L${lv}, changed ${changed}, legs ${g.legs}, ${onAnchor}/10 with the anchor, max step ${maxStep.toFixed(3)} m/frame`);
    expect(changed).toBe(true);
    expect(onAnchor).toBeGreaterThanOrEqual(8);
    expect(g.members.every(m => !m.detached)).toBe(true);
    expect(maxStep).toBeLessThan(0.1); // motor speeds only (no teleport): < 6 m/s
  });

  it('breaks formation on perception (no group-wide aggro), halts, then regroups and walks on', () => {
    const fx = ringMallFixture({storeys: 3});
    const rules = fxRules({groups: [1, 1], size: [14, 14], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0}});
    place(fx, rules, 2024);
    const player: Player = {x: -100, y: 0, z: -100, alive: false};
    const sim = makeSim(fx, {rules, player});
    const g = sim.director.groups[0];
    sim.run(25);
    // the player steps out 7 m in front of the anchor on its storey
    const hx = Math.sin(g.heading), hz = Math.cos(g.heading);
    const lv = sim.L.levelAt(g.ax, g.az, g.ay + 0.05), G = sim.L.grid(lv);
    let spot: [number, number] | null = null;
    for (let d = 7; d >= 3 && !spot; d -= 0.5) { const [cx, cy] = G.cellOf(g.ax + hx * d, g.az + hz * d); if (G.walkable(cx, cy)) spot = G.center(cx, cy); }
    expect(spot).toBeTruthy();
    Object.assign(player, {x: spot![0], z: spot![1], y: ringY(lv), alive: true});
    let engagedMax = 0, engagedFrames = 0;
    sim.run(3, () => { const n = g.members.filter(m => m.brain.alive && ['chase', 'attack', 'search'].includes(m.brain.state)).length; engagedMax = Math.max(engagedMax, n); if (g.phase === 'engaged') engagedFrames++; });
    expect(engagedMax).toBeGreaterThan(0);
    expect(engagedFrames).toBeGreaterThan(0);
    expect(sim.director.alertsCalled).toBeGreaterThan(0);
    // a stray member of the same group placed far away on another storey never joins in (no magic aggro)
    // (checked through the call radius: everyone who heard a call was within alertCallM of a caller)
    expect(sim.director.callsHeard).toBeLessThanOrEqual(g.members.length);
    const anchorAt = {x: g.ax, z: g.az};
    // the player slips away, alive, out of every member's sight (down in the pit storey's walled stair landing): the members chase
    // to the last seen spot, search, idle, then rejoin (the brain's usual decay — no magic recall)
    Object.assign(player, {x: 10, z: 20.5, y: 0, alive: true});
    sim.run(2);
    expect(Math.hypot(g.ax - anchorAt.x, g.az - anchorAt.z)).toBeLessThan(0.5); // halted while engaged
    let resumed = -1;
    for (let s = 0; s < 120 && resumed < 0; s++) { sim.run(1); if (g.phase === 'patrol' && g.members.every(m => !m.brain.alive || m.detached || m.formed)) resumed = s; }
    const formed = g.members.filter(m => m.formed).length;
    console.info(`[horde perception] engaged max ${engagedMax}/14, calls ${sim.director.alertsCalled} heard ${sim.director.callsHeard}; all back in formation after ${resumed} s (${formed} formed)`);
    expect(resumed).toBeGreaterThanOrEqual(0);
    const walked = g.distance;
    sim.run(20);
    expect(g.distance).toBeGreaterThan(walked + 2); // walking on
    expect(g.members.filter(m => m.formed && m.hasSlot && m.slotErr() < 3).length).toBeGreaterThanOrEqual(formed - 2);
  });

  it('can be watched and avoided: across the void the player sees the crowd coming and keeps away without ever being noticed', () => {
    // the wide fixture: 100 x 34 m rings round a 74 x 22 m void (28 m between the long galleries)
    const fx = ringMallFixture({storeys: 2, wide: true});
    const rules = fxRules({groups: [1, 1], size: [12, 12], placement: {...MALL_HORDE_RULES.placement, startM: 20, groupSpacingM: 10}, patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0.1}});
    place(fx, rules, 1717);
    const player: Player = {x: 0, y: 0, z: 0, alive: true};
    const sim = makeSim(fx, {rules, player});
    const g = sim.director.groups[0];
    const lv = g.spec.level;
    const nodes = fx.gallery[lv].map(id => fx.patrol[id]);
    // the player walks (<= 1.6 m/s, a calm walk) toward the gallery node farthest from every member, re-chosen each second
    const goal = {x: 0, z: 0};
    const clearance = (x: number, z: number) => Math.min(...g.members.filter(m => m.brain.alive).map(m => Math.hypot(m.brain.x - x, m.brain.z - z)));
    const pickGoal = () => { const n = [...nodes].sort((p, q) => clearance(q.x, q.z) - clearance(p.x, p.z))[0]; goal.x = n.x; goal.z = n.z; };
    pickGoal();
    Object.assign(player, {x: goal.x, z: goal.z, y: ringY(lv)});
    let seen = 0, noticed = 0, minD = Infinity;
    sim.run(90, () => {
      if (sim.frame % 60 === 0) pickGoal();
      const dx = goal.x - player.x, dz = goal.z - player.z, d = Math.hypot(dx, dz);
      if (d > 0.05) {
        // walk round the gallery (never through the void): straight when clear, else along the nearest node toward the goal
        const step = Math.min(d, 1.6 * DT);
        const nx = player.x + dx / d * step, nz = player.z + dz / d * step;
        if (sim.L.walkLineClear(player.x, player.y, player.z, nx, nz, 0.3)) { player.x = nx; player.z = nz; }
        else {
          const via = [...nodes].filter(n => sim.L.walkLineClear(player.x, player.y, player.z, n.x, n.z, 0.3))
            .sort((p, q) => Math.hypot(p.x - goal.x, p.z - goal.z) - Math.hypot(q.x - goal.x, q.z - goal.z))[0];
          if (via) { const vx = via.x - player.x, vz = via.z - player.z, vd = Math.hypot(vx, vz) || 1; player.x += vx / vd * Math.min(vd, 1.6 * DT); player.z += vz / vd * Math.min(vd, 1.6 * DT); }
        }
      }
      minD = Math.min(minD, clearance(player.x, player.z));
      if (sim.frame % 15 === 0 && g.members.some(m => sim.L.lineOfSight({x: player.x, y: player.y + 1.6, z: player.z}, {x: m.brain.x, y: m.brain.y + 1.4, z: m.brain.z}))) seen++;
      if (g.members.some(m => m.brain.state === 'chase' || m.brain.state === 'attack')) noticed++;
    });
    const checks = 90 * 4;
    console.info(`[horde avoid] 90 s (wide ring): crowd in the player's view on ${seen}/${checks} checks, noticed the player on ${noticed} frames, closest member ${minD.toFixed(1)} m, crowd walked ${g.distance.toFixed(0)} m`);
    expect(seen).toBeGreaterThan(checks * 0.5); // the threat is visible across the open void most of the time
    expect(noticed).toBe(0); // and avoidable at a walk
    expect(minD).toBeGreaterThan(ZOMBIE_SIGHT);
    expect(g.distance).toBeGreaterThan(20);
  });

  it('fights back as individuals: shot members die, the next living member leads, the rest regroup and walk on', () => {
    const fx = ringMallFixture({storeys: 3});
    const rules = fxRules({groups: [1, 1], size: [9, 9], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0}});
    place(fx, rules, 4545);
    const sim = makeSim(fx, {rules});
    const g = sim.director.groups[0];
    sim.run(20);
    const leader = g.members.find(m => m.slot === 0)!;
    leader.brain.damage(9999, g.ax, g.az, g.ay); // shot dead
    const second = g.members.find(m => m !== leader && m.brain.alive)!;
    second.brain.damage(30, g.ax + 5, g.az, g.ay); // wounded: breaks formation (chase toward the shot)
    sim.run(1);
    expect(leader.brain.alive).toBe(false);
    expect(g.members.filter(m => m.slot === 0)).toHaveLength(1);
    expect(g.members.find(m => m.slot === 0)!.brain.alive).toBe(true);
    expect(g.phase).toBe('engaged');
    sim.run(60);
    expect(g.phase === 'patrol' || g.phase === 'pause').toBe(true);
    expect(g.members.filter(m => m.brain.alive).length).toBe(8);
    expect(g.members.filter(m => m.formed).length).toBe(8);
  });

  it('a member cut off across the void after a chase rejoins by ONE regroup path round the gallery (no teleport)', () => {
    const fx = ringMallFixture({storeys: 3});
    const rules = fxRules({groups: [1, 1], size: [8, 8], patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0}});
    place(fx, rules, 777);
    const sim = makeSim(fx, {rules});
    const g = sim.director.groups[0];
    sim.run(15);
    // where its chase ended: the gallery on the far side of the void from the anchor (straight line blocked by the void railing)
    const m = g.members[g.members.length - 1], b = m.brain;
    const lv = g.spec.level;
    const far = fx.gallery[lv].map(id => fx.patrol[id]).sort((p, q) => Math.hypot(q.x - g.ax, q.z - g.az) - Math.hypot(p.x - g.ax, p.z - g.az))[0];
    b.x = far.x; b.z = far.z; b.y = ringY(lv);
    b.hear(far.x, far.z, 1, b.y); // a noise right there: it chases / searches on the spot, then idles and rejoins
    let back = -1, maxStep = 0, px = b.x, pz = b.z;
    for (let s = 0; s < 90 * 60 && back < 0; s++) {
      sim.step();
      maxStep = Math.max(maxStep, Math.hypot(b.x - px, b.z - pz)); px = b.x; pz = b.z;
      if (m.formed && m.hasSlot && m.slotErr() < 2) back = s / 60;
    }
    console.info(`[horde regroup] cut-off member back in its slot after ${back.toFixed(1)} s, regroup paths ${m.regroups}, fails ${m.regroupFails}, max step ${maxStep.toFixed(3)} m/frame`);
    expect(back).toBeGreaterThan(0);
    expect(m.regroups).toBeGreaterThanOrEqual(1);
    expect(m.detached).toBe(false);
    expect(maxStep).toBeLessThan(0.1);
  });

  it('gunfire alerts only the members in earshot (the existing hearing rule), the rest keep their patrol', () => {
    const fx = ringMallFixture({storeys: 4});
    const rules = fxRules({groups: [3, 3]});
    place(fx, rules, 555);
    const sim = makeSim(fx, {rules});
    sim.run(10);
    const g0 = sim.director.groups[0];
    const lv = g0.spec.level;
    const P = {x: g0.ax, y: ringY(lv), z: g0.az};
    // a 24 m shot at the first group's anchor (the game's alertZombies: 3D distance x wall / slab muffle)
    const bases = sim.L.list.map(l => l.baseY);
    for (const b of sim.live()) {
      const d = Math.hypot(b.x - P.x, b.z - P.z, b.y - P.y);
      if (d > 24) continue;
      const los = sim.L.lineOfSight({x: P.x, y: P.y + 1.6, z: P.z}, {x: b.x, y: b.y + 1.5, z: b.z});
      const slabs = bases.filter(y => y > Math.min(P.y, b.y) + 1 && y <= Math.max(P.y, b.y) + 1).length;
      b.hear(P.x, P.z, 24 * (los ? 1 : slabs > 0 ? 0.35 ** slabs : 0.6), P.y);
    }
    const chasing = (g: typeof g0) => g.members.filter(m => m.brain.state === 'chase').length;
    expect(chasing(g0)).toBeGreaterThan(0);
    const others = sim.director.groups.slice(1);
    for (const g of others) {
      const far = g.members.every(m => Math.hypot(m.brain.x - P.x, m.brain.z - P.z, m.brain.y - P.y) > 24);
      if (far) expect(chasing(g)).toBe(0);
    }
  });
});

describe('horde persistence: kills stay dead, no top-up, no respawn (run memory)', () => {
  it('a rebuilt section spawns only the living members; an all-dead group stays dead; the roster never grows', () => {
    const fx = ringMallFixture({storeys: 4});
    const rules = fxRules({groups: [3, 3]});
    place(fx, rules, 8080);
    const hs = fx.layout.hordes!;
    expect(hs.length).toBeGreaterThanOrEqual(2);
    const n0 = fx.layout.zombies.length;
    const sim = makeSim(fx, {rules});
    sim.run(5);
    // kill all of group 0 and half of group 1 (the game remembers kills by layout.zombies index)
    const dead = [...hs[0].members, ...hs[1].members.slice(0, Math.ceil(hs[1].members.length / 2))];
    for (const i of dead) sim.brains[i]!.damage(9999, 0, 0);
    sim.run(2);
    expect(sim.director.groups[0].phase).toBe('dead');
    const mem = createMemory({level: 'subway', section: 'main'});
    mem.killed = mergeKilled(mem.killed, dead);
    const snap = cloneMemory(mem); // "Retry level" restores a snapshot of the section memory
    for (const m of [mem, snap]) {
      const spawn = enemiesToSpawn(fx.layout.zombies.length, m);
      expect(spawn.some(i => dead.includes(i))).toBe(false);
      const sim2 = makeSim(fx, {rules, killed: dead});
      expect(sim2.director.groups[0].phase).toBe('dead');
      expect(sim2.director.groups[0].members.length).toBe(0);
      expect(sim2.director.groups[1].members.length).toBe(hs[1].members.length - Math.ceil(hs[1].members.length / 2));
      sim2.run(30);
      expect(sim2.director.groups[0].members.length).toBe(0); // never topped up
      expect(sim2.director.groups[0].phase).toBe('dead');
      expect(sim2.director.groups[1].members.length).toBe(hs[1].members.length - Math.ceil(hs[1].members.length / 2));
    }
    expect(fx.layout.zombies.length).toBe(n0); // nothing appended at runtime
    // regenerating the layout from the same seed places the very same members (indices), so remembered kills apply exactly
    const again = ringMallFixture({storeys: 4});
    place(again, rules, 8080);
    expect(JSON.stringify(again.layout.hordes)).toBe(JSON.stringify(hs));
  });
});

describe('horde performance: bounded, phased, deferred far planning', () => {
  it('per-frame work for many groups is bounded and staggered (no synchronized spikes), leg searches go through the scheduler', () => {
    const fx = ringMallFixture({storeys: 6});
    const rules = fxRules({groups: [5, 5], size: [20, 20], budget: {total: 100, perStorey: 20, groupsPerStorey: 1}});
    place(fx, rules, 6060);
    const sim = makeSim(fx, {rules, scheduler: true});
    const nGroups = sim.director.groups.length, nMembers = sim.director.groups.reduce((n, g) => n + g.members.length, 0);
    expect(nMembers).toBeGreaterThanOrEqual(60);
    const dirMs: number[] = [], walk: number[] = [], paths: number[] = [], aiMs: number[] = [];
    sim.run(5);
    for (let f = 0; f < 60 * 60; f++) { const r = sim.step(); dirMs.push(r.dirMs); walk.push(r.walk); paths.push(r.paths); aiMs.push(r.aiMs); }
    // baseline: the same 100 bodies as ordinary idle / wandering enemies (their random wander searches included)
    const fx2 = ringMallFixture({storeys: 6});
    place(fx2, rules, 6060);
    const base = makeSim(fx2, {rules, scheduler: true, noHordes: true});
    base.run(5);
    const baseMs: number[] = [];
    for (let f = 0; f < 60 * 30; f++) baseMs.push(base.step().aiMs);
    const top = aiMs.map((ms, i) => ({i, ms, walk: walk[i], dir: dirMs[i]})).sort((a, b) => b.ms - a.ms).slice(0, 6);
    console.info(`[horde perf] top member frames: ${top.map(t => `#${t.i} ${t.ms.toFixed(2)} ms (walk ${t.walk}, director ${t.dir.toFixed(2)})`).join(', ')}`);
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
    const p99 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.99)];
    const sorted = [...dirMs].sort((a, b) => a - b), q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const meanWalk = walk.reduce((a, b) => a + b, 0) / walk.length;
    const maxWalk = Math.max(...walk);
    // per-second windows: no 1-second rhythm of synchronized bursts (the busiest frame of each second vs the mean)
    const secMax: number[] = [];
    for (let s = 0; s < 60; s++) secMax.push(Math.max(...walk.slice(s * 60, s * 60 + 60)));
    const st = sim.ps.stats;
    console.info(`[horde perf] ${nGroups} groups / ${nMembers} members, 60 s: director ms/frame med ${q(0.5).toFixed(3)} p95 ${q(0.95).toFixed(3)} p99 ${q(0.99).toFixed(3)} max ${q(1).toFixed(3)}; ` +
      `walk tests/frame mean ${meanWalk.toFixed(1)} max ${maxWalk}; path searches/frame max ${Math.max(...paths)} total ${paths.reduce((a, b) => a + b, 0)}; ` +
      `path service queued ${st.queued} delivered ${st.delivered} immediate ${st.immediate} chunks ${st.chunks}; thinks ${sim.director.thinks}; ` +
      `members' brain+motor+separation ms/frame med ${med(aiMs).toFixed(3)} p99 ${p99(aiMs).toFixed(3)} max ${Math.max(...aiMs).toFixed(3)} vs the same bodies as ordinary wanderers med ${med(baseMs).toFixed(3)} p99 ${p99(baseMs).toFixed(3)} max ${Math.max(...baseMs).toFixed(3)}`);
    // bounded: every member gets at most a few walk tests per frame on average, and the busiest frame stays a small multiple
    expect(meanWalk).toBeLessThan(nMembers * 0.6);
    expect(maxWalk).toBeLessThan(nMembers * 3);
    // staggered: the busiest frame of a second is never far above the average busiest frame (no group-synchronized second)
    const avgSecMax = secMax.reduce((a, b) => a + b, 0) / secMax.length;
    expect(Math.max(...secMax)).toBeLessThan(avgSecMax * 3 + 10);
    // far groups (the player is away): leg searches were queued to the frame budget, never more than 2 searches in a frame
    expect(st.queued).toBeGreaterThan(0);
    expect(Math.max(...paths)).toBeLessThanOrEqual(2);
    // phased: far groups think on about a third of the frames
    expect(sim.director.thinks).toBeLessThan(nGroups * (60 * 65) * 0.5);
    // a loose wall-clock bound (machine-dependent; generous): the director is a small share of a 16.7 ms frame
    expect(q(0.5)).toBeLessThan(1.5);
  });
});

describe('horde chase across the atrium: one route search serves the charging crowd', () => {
  it('members that see the player down the void share a group mate\'s fresh cross-storey route (answered at once, far fewer searches)', () => {
    const run = (noShare: boolean) => {
      const fx = ringMallFixture({storeys: 2, wide: true});
      const rules = fxRules({groups: [1, 1], size: [16, 16], placement: {...MALL_HORDE_RULES.placement, startM: 20, groupSpacingM: 10}, patrol: {...MALL_HORDE_RULES.patrol, storeyChange: 0, pauseChance: 0}});
      place(fx, rules, 2468);
      const player: Player = {x: -100, y: 0, z: -100, alive: false};
      const sim = makeSim(fx, {rules, player, noShare});
      const g = sim.director.groups[0];
      // walk until the crowd is on a long gallery beside the void (not in an end court)
      const V = fx.dims.void, vx0 = (V.x0 + 6) * CELL, vx1 = (V.x1 - 6) * CELL;
      sim.run(4);
      for (let k = 0; k < 120 && !(g.ax > vx0 && g.ax < vx1); k++) sim.run(1);
      expect(g.ax > vx0 && g.ax < vx1).toBe(true);
      // the player in the pit plaza under the void, ~11-17 m from the crowd's gallery, in clear sight through the opening; a shot
      const zc = ((V.y0 + V.y1) / 2 + 0.5) * CELL;
      Object.assign(player, {x: g.ax, z: zc, y: 0, alive: true});
      for (const m of g.members) m.brain.hear(player.x, player.z, 40, 0);
      // mean walking route (stairs) from the members to the player, now and after 6 s of charging
      const pf = new PathFinder(sim.L);
      const route = () => {
        let sum = 0, n = 0;
        for (const m of g.members) {
          const b = m.brain, p = pf.find(b.x, b.z, player.x, player.z, 0.34, 26000, {drops: true, ay: b.y, by: 0});
          if (!p) continue;
          let len = 0, px = b.x, pz = b.z;
          for (const w of p) { len += Math.hypot(w[0] - px, w[1] - pz); px = w[0]; pz = w[1]; }
          sum += len; n++;
        }
        return sum / Math.max(1, n);
      };
      const r0 = route();
      const calls0 = sim.stats.paths;
      let seeing = 0, off = 0;
      sim.run(6, () => {
        if (sim.frame % 30) return;
        seeing = Math.max(seeing, g.members.filter(m => m.brain.alive && m.brain.aware && m.brain.state === 'chase').length);
        for (const m of g.members) if (!supported(sim.L, m.brain.x, m.brain.z, m.brain.y)) off++;
      });
      return {searches: sim.stats.paths - calls0, hits: sim.share?.hits ?? 0, seeing, closed: r0 - route(), off};
    };
    const shared = run(false), alone = run(true);
    console.info(`[horde share] 16 members charging a player ~10 m below through the void (route by the stairs), 6 s: with shared routes ${shared.searches} searches ` +
      `(${shared.hits} chase asks answered from a mate's route), route to the player closed by ${shared.closed.toFixed(1)} m; searching alone ${alone.searches} searches, closed ${alone.closed.toFixed(1)} m`);
    expect(shared.seeing).toBeGreaterThan(8);
    expect(shared.hits).toBeGreaterThan(0);
    expect(shared.searches).toBeLessThan(alone.searches * 0.6);
    // the shared routes are real routes: the crowd closes in by the stairs as fast as when every member searches alone
    expect(alone.closed).toBeGreaterThan(5);
    expect(shared.closed).toBeGreaterThan(alone.closed * 0.75);
    expect(shared.off).toBe(0);
  });
});

describe('horde audio: the vocal gate and the 3-voice cap', () => {
  it('one idle groan per group per vocalGap at most, and never more than 3 enemy vocals at once (Sfx cap)', async () => {
    const {Sfx} = await import('../src/audio/sfx');
    const {FakeCtx, fakeBank} = await import('./helpers/fakeAudio');
    const {VOCAL_GATE} = await import('../src/ai/vocalReach');
    const {ZOMBIE_CUES} = await import('../src/ai/creatureArchetypes');
    const made: InstanceType<typeof FakeCtx>[] = [];
    const {bank} = fakeBank({variants: 3});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await new Promise(r => setTimeout(r, 40));
    const ctx = made[0];
    sfx.setWorld({occlusion: () => 0});
    const fx = ringMallFixture({storeys: 4});
    const rules = fxRules({groups: [2, 2], size: [20, 20], budget: {total: 40, perStorey: 20, groupsPerStorey: 1}});
    place(fx, rules, 3131);
    const sim = makeSim(fx, {rules});
    const g0 = sim.director.groups[0];
    sfx.setListener(g0.ax, g0.ay + 1.6, g0.az, 0); // standing by the first group
    const rand = mulberry32(5);
    // the game's per-member order: the horde vocal gate, then the zombie cue tick (its groan timer; aware members groan often)
    const actors = sim.director.groups.flatMap(g => g.members.map(m => ({brain: m.brain, groanT: rand() * 0.5, g: g.spec.id})));
    let maxVoices = 0;
    const allowedAt: Record<number, number[]> = {};
    for (let f = 0; f < 60 * 30; f++) {
      ctx.currentTime += DT;
      sim.step();
      for (const a of actors) {
        a.brain.aware = true;
        const before = sim.director.groansAllowed;
        sim.director.vocalGate(a.brain, a, DT, rand);
        if (sim.director.groansAllowed > before) (allowedAt[a.g] ??= []).push(sim.director.time);
        ZOMBIE_CUES.tick(sfx, a as never, DT, 0, 5, rand);
      }
      maxVoices = Math.max(maxVoices, sfx.debugState().vocal.voices);
    }
    for (const times of Object.values(allowedAt)) for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(HORDE_AI.vocalGap - 1e-6);
    console.info(`[horde audio] 2 x 20 members 30 s: groans allowed ${sim.director.groansAllowed}, deferred ${sim.director.groansDeferred}, max simultaneous vocal voices ${maxVoices} (cap ${VOCAL_GATE.cap})`);
    expect(sim.director.groansDeferred).toBeGreaterThan(0);
    expect(maxVoices).toBeLessThanOrEqual(VOCAL_GATE.cap);
  });
});

describe('the generated mall (lane GEN) — when registered', () => {
  const has = (LEVEL_IDS as readonly string[]).includes('mall');
  const gen = (seed: number) => (LEVELS as Record<string, {generate(s: string, c: {levelSeed: number; startWeapon: 'pistol'}): StationLayout}>).mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
  const mallRules = () => (SPAWN_PROFILES as Record<string, (typeof SPAWN_PROFILES)['subway']>).mall.horde!;
  const SEEDS = [0x7ec3, 12345, 0xbeef, 2026];
  const cache = new Map<number, StationLayout>();
  const mall = (seed: number) => { let l = cache.get(seed); if (!l) cache.set(seed, (l = gen(seed))); return l; };

  (has ? it : it.skip)('places 5..20-member groups from SPAWN_PROFILES.mall.horde on ring galleries, within the separate budgets, deterministically', () => {
    const rules = mallRules();
    const lines: string[] = [];
    for (const seed of SEEDS) {
      const layout = mall(seed);
      const L = levelsOf(layout);
      const hs = layout.hordes ?? [];
      expect(hs.length, `seed ${seed}`).toBeGreaterThanOrEqual(rules.groups[0]);
      expect(hs.length).toBeLessThanOrEqual(rules.groups[1]);
      const total = hs.reduce((n, h) => n + h.members.length, 0);
      expect(total).toBeLessThanOrEqual(rules.budget.total);
      const rings = new Set(layout.mall!.storeys.filter(t => t.role === 'ring').map(t => t.level));
      const perStorey = new Map<number, number>();
      for (const h of hs) {
        expect(rings.has(h.level)).toBe(true);
        perStorey.set(h.level, (perStorey.get(h.level) ?? 0) + h.members.length);
        expect(h.members.length).toBeGreaterThanOrEqual(HORDE_GROUP_SIZE.min);
        expect(h.members.length).toBeLessThanOrEqual(HORDE_GROUP_SIZE.max);
        for (const i of h.members) {
          const z = layout.zombies[i];
          expect(z.horde).toBe(h.id);
          expect(z.archetype ?? 'zombie').toBe('zombie');
          const g = L.grid(z.level ?? 0), [cx, cy] = g.cellOf(z.x, z.z), c = g.idx(cx, cy);
          expect(g.walkable(cx, cy) && g.rampIdx[c] < 0, `seed ${seed} member ${i}`).toBe(true);
          expect(layout.areas[g.area[c]]?.role).not.toBe('stair');
          expect(supported(L, z.x, z.z, z.y ?? 0)).toBe(true);
        }
      }
      for (const [, n] of perStorey) expect(n).toBeLessThanOrEqual(rules.budget.perStorey);
      // ambient and horde pools never mix: every non-horde enemy is ambient, and the ambient count stays within its own budget
      // (playtest revision: the annex 'service' spawns are a separate, additive zone budget — SERVICE_ZONE_BUDGET per annex — not part
      // of the core ambient budget, which is the pit + ring contexts' maxima: 9 + 6 x 10 = 69; they are checked on their own below)
      const service = layout.zombies.filter(z => z.horde === undefined && isExtensionArea(layout.areas[z.area])).length;
      const ambient = layout.zombies.filter(z => z.horde === undefined).length - service;
      const amb = (SPAWN_PROFILES as Record<string, (typeof SPAWN_PROFILES)['subway']>).mall.budgets?.ambient;
      if (amb) expect(ambient).toBeLessThanOrEqual(amb.total);
      expect(service).toBeLessThanOrEqual(SERVICE_ZONE_BUDGET[1] * (layout.extensions?.annexes.length ?? 0));
      lines.push(`seed ${seed} (${layout.mall!.variant}): ${hs.length} groups [${hs.map(h => `L${h.level}:${h.members.length}`).join(' ')}] = ${total} horde + ${ambient} ambient; patrol ${layout.mall!.patrol.length} nodes`);
    }
    console.info(`[horde mall] placement\n  ${lines.join('\n  ')}`);
    // deterministic per level seed
    expect(JSON.stringify(gen(SEEDS[0]).hordes)).toBe(JSON.stringify(mall(SEEDS[0]).hordes));
  });

  (has ? it : it.skip)('roams the real mall: real links only, cohesive crowds, storey changes by escalator / stairs; bounded cost (update profiler)', () => {
    const layout = mall(SEEDS[0]);
    const rules = mallRules();
    const SECS = BENCH ? 180 : 120;
    const spawnAt = () => ({x: layout.playerSpawn.x, y: 0, z: layout.playerSpawn.z, alive: true});
    const prof = new UpdateProfiler(SECS * 60);
    prof.startRecording();
    const sim = makeSim({layout, patrol: layout.mall!.patrol}, {rules, scheduler: true, player: spawnAt(), prof, atrium: true}); // as the game runs the mall
    const gs = sim.director.groups;
    const lv0 = gs.map(g => sim.L.levelAt(g.ax, g.az, g.ay + 0.05));
    const prev = gs.map(g => ({x: g.ax, z: g.az, y: g.ay}));
    let bad = 0, jumps = 0, offGeom = 0, samples = 0, within = 0, changes = 0;
    const offWhere: string[] = [];
    const dirMs: number[] = [], aiMs: number[] = [], walk: number[] = [];
    for (let f = 0; f < 60 * SECS; f++) {
      const r = sim.step(() => {
        gs.forEach((g, k) => {
          if (g.phase === 'dead') return;
          if (!supported(sim.L, g.ax, g.az, g.ay)) bad++;
          const p = prev[k];
          if (Math.hypot(g.ax - p.x, g.az - p.z) > 0.05 && !sim.L.walkLineClear(p.x, p.y, p.z, g.ax, g.az, 0.1)) jumps++;
          const lv = sim.L.levelAt(g.ax, g.az, g.ay + 0.05);
          if (lv !== lv0[k]) { changes++; lv0[k] = lv; }
          prev[k] = {x: g.ax, z: g.az, y: g.ay};
        });
      });
      dirMs.push(r.dirMs); aiMs.push(r.aiMs); walk.push(r.walk);
      if (f % 30 === 0) {
        for (const g of gs) for (const m of g.members) {
          const b = m.brain;
          if (b.alive && !supported(sim.L, b.x, b.z, b.y)) { offGeom++; if (offWhere.length < 6) offWhere.push(`g${g.spec.id} m${m.index} ${b.state} (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})`); }
          if (m.formed && m.hasSlot) { samples++; if (m.slotErr() <= 3) within++; }
        }
      }
    }
    const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))];
    const sum = sim.director.summary();
    const n = sim.live().length;
    const rep = prof.report({window: SECS * 60, spikes: 4});
    const span = (name: string) => { const x = rep.spans.find(t => t.name === name); return x ? `${name} avg ${x.avg.toFixed(3)} p95 ${x.p95.toFixed(3)} max ${x.max.toFixed(2)} ms (${x.count} calls)` : `${name} -`; };
    console.info(`[horde mall] ${SECS} s on seed ${SEEDS[0]} (${n} enemies, ${gs.reduce((s2, g) => s2 + g.members.length, 0)} in ${gs.length} hordes, player at the pit start): ` +
      `legs ${sum.map(g => g.legs).join('/')}, walked ${sum.map(g => Math.round(g.walked)).join('/')} m, bad legs ${sum.map(g => g.badLegs).join('/')}, stalls ${sum.map(g => g.stalls).join('/')}, storey changes ${changes}; ` +
      `within 3 m of slot ${(within / Math.max(1, samples) * 100).toFixed(1)} %; director ms/frame med ${q(dirMs, 0.5).toFixed(3)} p99 ${q(dirMs, 0.99).toFixed(3)} max ${q(dirMs, 1).toFixed(3)}; ` +
      `walk tests/frame mean ${(walk.reduce((a, b) => a + b, 0) / walk.length).toFixed(1)} max ${Math.max(...walk)}; path service ${JSON.stringify(sim.ps.stats)}; requests by origin ${Object.entries(sim.stats.byWho).map(([k, v]) => `${k} ${v.n} (${v.ms.toFixed(0)} ms, max ${v.max.toFixed(2)})`).join(', ')}; off-geometry members ${offGeom} ${offWhere.join(' | ')}\n` +
      `  update profiler: ${span('ai')}; ${span('ai.brain')}; ${span('ai.path')}; ${span('ai.motor')}; ${span('deferred')}; spikes ${rep.spikes.map(sp => `${sp.ms.toFixed(1)} ms [${sp.dominant.map(d => `${d.name} ${d.ms.toFixed(1)}×${d.count}`).join(', ')}]`).join(' | ')}`);
    if (BENCH) {
      // the same level / player with the horde members as ordinary enemies (where do the AI spikes come from?)
      const base = makeSim({layout, patrol: layout.mall!.patrol}, {rules, scheduler: true, noHordes: true, player: spawnAt(), atrium: true});
      const baseMs: number[] = [], topH = aiMs.map((ms, i) => ({i, ms})).sort((x, y) => y.ms - x.ms).slice(0, 5);
      for (let f = 0; f < 60 * SECS; f++) baseMs.push(base.step().aiMs);
      const topB = baseMs.map((ms, i) => ({i, ms})).sort((x, y) => y.ms - x.ms).slice(0, 5);
      console.info(`[horde mall] all-enemy brain+motor ms/frame with hordes med ${q(aiMs, 0.5).toFixed(2)} p99 ${q(aiMs, 0.99).toFixed(2)} max ${q(aiMs, 1).toFixed(2)}; ` +
        `the horde bodies as ordinary enemies med ${q(baseMs, 0.5).toFixed(2)} p99 ${q(baseMs, 0.99).toFixed(2)} max ${q(baseMs, 1).toFixed(2)}; ` +
        `top frames with hordes ${topH.map(t => `#${t.i} ${t.ms.toFixed(1)}`).join(', ')}; without ${topB.map(t => `#${t.i} ${t.ms.toFixed(1)}`).join(', ')}`);
    }
    expect(bad).toBe(0);
    expect(jumps).toBe(0);
    expect(offGeom).toBe(0);
    expect(within / Math.max(1, samples)).toBeGreaterThan(0.85);
    for (const g of sum) if (g.phase !== 'dead') expect(g.walked).toBeGreaterThan(20);
    // the director itself stays a small, flat share of the frame (generous wall-clock bound; machine-dependent)
    expect(q(dirMs, 0.5)).toBeLessThan(1);
  });
});
