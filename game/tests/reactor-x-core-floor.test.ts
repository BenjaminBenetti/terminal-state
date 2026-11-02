// Task reactor-expansion-20261101 (lane CORE): THE CORE FLOOR on REAL generated Reactor layouts — the goop pool round the vessel
// (non-walkable, railed on every edge), the walkable radial bridges (>= 3, >= 2 m) to the service ring, the vessel solid without its old
// 12 m drum, every route / control / component still reachable, the coolant loops + turbine with their collision, the core floor's
// mounted lamps and baked green glow sources, determinism and generation time. Focused (no browser).
import {describe, expect, it} from 'vitest';
import {generateReactorLevel, reactorIssues, CORE_LEVEL, REACTOR_GEN_STATS} from '../src/gen/reactor/index';
import {CORE_FLOOR, CORE_FLOOR_STATS, CORE_GLOW_SOURCES, coreFloorIssues} from '../src/gen/reactor/coreFloor';
import {levelDistance} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {CELL, FLOOR, STEP_UP} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 6, 9100, 218558];
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = generateReactorLevel({levelSeed: seed}); cache.set(seed, L); }
  return L;
};

describe('the core floor (lane CORE) on real generated layouts', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: valid (reactorIssues + coreFloorIssues empty), the record filled`, () => {
      const L = gen(seed), R = L.reactor!, cf = R.coreFloor!;
      expect(reactorIssues(L)).toEqual([]);
      expect(coreFloorIssues(L)).toEqual([]);
      expect(cf).toBeDefined();
      expect(cf.x).toBeCloseTo(R.core.x);
      expect(cf.z).toBeCloseTo(R.core.z);
      expect(cf.y).toBe(R.pit.floorY);
      expect(cf.ring.r1).toBe(CORE_FLOOR.ringR1);
      expect(cf.pool.r1).toBeGreaterThanOrEqual(CORE_FLOOR.poolR1Min);
      expect(cf.pool.cells).toBeGreaterThan(1200);
      expect(cf.y - cf.pool.floorY).toBeGreaterThan(1.3); // the drop derives railings
    }, 60_000);

    it(`seed ${seed}: the goop pool is non-walkable (blocked, 1.5 m down), nothing spawns / lies in it, every edge to a walkway is railed`, () => {
      const L = gen(seed), cf = L.reactor!.coreFloor!, g = L.levels[CORE_LEVEL].grid, Lv = levelsOf(L);
      let pool = 0, edges = 0, railed = 0;
      const isPool = (i: number) => g.cells[i] === FLOOR && Math.abs(g.floor[i] - cf.pool.floorY) < 1e-3;
      for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
        const i = g.idx(x, y);
        if (!isPool(i)) continue;
        pool++;
        expect(g.blocked[i], `pool cell ${x},${y} blocked`).toBe(1);
        expect(g.walkable(x, y)).toBe(false);
        // a walkable deck neighbour: the shared edge carries a railing at the deck height
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = g.idx(x + dx, y + dy);
          if (isPool(j) || !g.walkable(x + dx, y + dy) || Math.abs(g.floor[j] - cf.y) > 1e-3) continue;
          edges++;
          const ex = dx ? (dx > 0 ? x + 1 : x) * CELL : (x + 0.5) * CELL, ez = dy ? (dy > 0 ? y + 1 : y) * CELL : (y + 0.5) * CELL;
          const near = [...(Lv.railsAt(j) ?? []), ...(Lv.railsAt(i) ?? [])].some(r => {
            const lx = r.x1 - r.x0, lz = r.z1 - r.z0, l2 = lx * lx + lz * lz || 1;
            const t = Math.max(0, Math.min(1, ((ex - r.x0) * lx + (ez - r.z0) * lz) / l2));
            return Math.hypot(r.x0 + lx * t - ex, r.z0 + lz * t - ez) < 0.05 && Math.abs(r.y0 - cf.y) < 0.05 && (r.h ?? 1.1) >= 1.0;
          });
          if (near) railed++;
        }
      }
      expect(pool).toBe(cf.pool.cells);
      expect(edges).toBeGreaterThan(200);
      expect(railed).toBe(edges);
      expect(Lv.unrailedDrops()).toEqual([]);
      for (const z of L.zombies) if ((z.level ?? 0) === CORE_LEVEL) { const [cx, cy] = g.cellOf(z.x, z.z); expect(isPool(g.idx(cx, cy)), 'zombie in the goop').toBe(false); }
      for (const p of L.pickups) if ((p.level ?? 0) === CORE_LEVEL) { const [cx, cy] = g.cellOf(p.x, p.z); expect(isPool(g.idx(cx, cy)), `pickup ${p.itemId} in the goop`).toBe(false); }
    }, 60_000);

    it(`seed ${seed}: >= 3 walkable radial bridges (>= 2 m clear) from the service ring to the outer floor; the ring and every control reachable`, () => {
      const L = gen(seed), R = L.reactor!, cf = R.coreFloor!, g = L.levels[CORE_LEVEL].grid;
      const g0 = L.grid, [sx, sy] = g0.cellOf(R.start.x, R.start.z);
      const dist = levelDistance(L.levels, sx, sy, 0, L.levelLinks);
      expect(cf.bridges.length).toBeGreaterThanOrEqual(3);
      for (const b of cf.bridges) {
        expect(b.width).toBeGreaterThanOrEqual(2);
        const ux = Math.cos(b.angle), uz = Math.sin(b.angle), nx = -uz, nz = ux;
        // its 2 m clear core is walkable deck all the way across the goop, reachable from the platform
        for (let a = cf.ring.r1 - 0.5; a <= cf.pool.r1 + 0.5; a += 0.25) for (const p of [-0.95, 0, 0.95]) {
          const [cx, cy] = g.cellOf(cf.x + ux * a + nx * p, cf.z + uz * a + nz * p), i = g.idx(cx, cy);
          expect(g.walkable(cx, cy), `bridge ${b.angle.toFixed(2)} at ${a},${p}`).toBe(true);
          expect(Math.abs(g.floor[i] - cf.y)).toBeLessThan(1e-3);
          expect(dist[CORE_LEVEL][i]).toBeGreaterThanOrEqual(0);
        }
        // railed at its envelope: the drawn rails sit beyond the walkable cells
        expect(b.rail).toBeGreaterThanOrEqual(b.width / 2);
        expect(b.rail).toBeLessThan(b.width / 2 + 0.5);
      }
      // the service ring: walkable deck round the vessel, reachable (except the tower-foot notches in the goop)
      let ring = 0, reach = 0;
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2, [cx, cy] = g.cellOf(cf.x + Math.cos(a) * 8.3, cf.z + Math.sin(a) * 8.3), i = g.idx(cx, cy);
        if (!g.walkable(cx, cy)) continue;
        ring++;
        if (dist[CORE_LEVEL][i] >= 0) reach++;
      }
      expect(ring).toBeGreaterThan(36);
      expect(reach).toBe(ring);
      for (const s of R.sites) for (const c of s.controls) {
        const gg = L.levels[c.stand.level].grid, [cx, cy] = gg.cellOf(c.stand.x, c.stand.z);
        expect(dist[c.stand.level][gg.idx(cx, cy)], `${c.id} reachable`).toBeGreaterThanOrEqual(0);
      }
      for (const c of R.components) {
        const p = L.pickups[c.pickup], gg = L.levels[p.level ?? 0].grid, [cx, cy] = gg.cellOf(p.x, p.z);
        expect(dist[p.level ?? 0][gg.idx(cx, cy)], `${c.item} reachable`).toBeGreaterThanOrEqual(0);
      }
    }, 60_000);

    it(`seed ${seed}: the vessel is solid without the 12 m drum (blocked, a riser no body steps over, the body column to the dome)`, () => {
      const L = gen(seed), R = L.reactor!, cf = R.coreFloor!, g = L.levels[CORE_LEVEL].grid;
      for (let k = 0; k < 64; k++) for (const r of [0, 2, 4.8, 5.6, 6.2]) {
        const a = (k / 64) * Math.PI * 2, [cx, cy] = g.cellOf(cf.x + Math.cos(a) * r, cf.z + Math.sin(a) * r), i = g.idx(cx, cy);
        expect(g.blocked[i]).toBe(1);
        expect(g.floor[i] - cf.y).toBeGreaterThan(STEP_UP + 0.5);
        expect(g.floor[i] - cf.y).toBeLessThan(10.1); // never above the vessel model's dome (9.97 m): no drum hides it
      }
      // right outside the plinth: the walkable service ring
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2, [cx, cy] = g.cellOf(cf.x + Math.cos(a) * 7.3, cf.z + Math.sin(a) * 7.3);
        const i = g.idx(cx, cy);
        if (g.blocked[i]) continue; // a tower leg / foot notch
        expect(Math.abs(g.floor[i] - cf.y)).toBeLessThan(1e-3);
      }
    }, 60_000);

    it(`seed ${seed}: coolant loops on the goop with collision, the turbine on a wall run, mounted lamps on the ring / bridges, baked green glow`, () => {
      const L = gen(seed), R = L.reactor!, cf = R.coreFloor!, g = L.levels[CORE_LEVEL].grid;
      const complete = cf.loops.filter(l => l.sg && l.rcp);
      expect(complete.length).toBeGreaterThanOrEqual(3);
      for (const l of cf.loops) for (const p of [l.sg, l.rcp]) {
        if (!p) continue;
        const pr = L.props[p.prop];
        expect(pr.kind).toBe('annexMachine');
        expect(pr.round).toBe(true);
        const r = Math.hypot(p.x - cf.x, p.z - cf.z);
        expect(r - pr.hx).toBeGreaterThan(cf.ring.r1 - 0.45); // stands on the goop, not on the ring
        expect(r + pr.hx).toBeLessThan(cf.pool.r1 + 0.45);
        expect(pr.y).toBeCloseTo(cf.pool.floorY); // lifted onto the pool floor
      }
      if (cf.turbine) {
        const pr = L.props[cf.turbine.prop];
        expect(pr.kind).toBe('annexMachine');
        const near = Math.hypot(Math.max(Math.abs(cf.x - pr.x) - pr.hx, 0), Math.max(Math.abs(cf.z - pr.z) - pr.hz, 0));
        expect(near).toBeGreaterThan(cf.pool.r1 + 2.9); // a 3 m corridor to the goop railing stays
        const [cx, cy] = g.cellOf(pr.x, pr.z);
        expect(g.blocked[g.idx(cx, cy)]).toBe(1);
      }
      // the core floor's mounted post lamps: heads over a walkway at the deck, feet on the railing line
      const posts = L.lights.filter(l => l.level === CORE_LEVEL && l.mount?.kind === 'post' && Math.hypot(l.x - cf.x, l.z - cf.z) < cf.pool.r1 + 0.5);
      expect(posts.length).toBeGreaterThanOrEqual(4);
      for (const l of posts) {
        const [cx, cy] = g.cellOf(l.x, l.z);
        expect(g.walkable(cx, cy)).toBe(true);
        expect(l.y - cf.y).toBeCloseTo(2.5);
        expect(l.mount!.y).toBe(cf.y);
      }
      expect(posts.some(l => !l.dying)).toBe(true); // a steady emergency lamp before the restart
      const glow = L.lights.filter(l => l.virtual && l.level === CORE_LEVEL && l.tint);
      expect(glow.length).toBe(CORE_GLOW_SOURCES.count);
      expect(glow.filter(l => l.dying).length).toBe(CORE_GLOW_SOURCES.count / 2);
      for (const l of glow) expect(l.tint![1]).toBeGreaterThan(l.tint![0] * 2);
    }, 60_000);
  }

  it('is deterministic and fast (core floor < 60 ms of the generation)', () => {
    const a = generateReactorLevel({levelSeed: 4242}), ms = CORE_FLOOR_STATS.carveMs + CORE_FLOOR_STATS.finishMs;
    const b = generateReactorLevel({levelSeed: 4242});
    expect(JSON.stringify(a.reactor!.coreFloor)).toBe(JSON.stringify(b.reactor!.coreFloor));
    expect(REACTOR_GEN_STATS.attempts).toBe(1);
    process.stdout.write(`[reactor-x-core] core floor ms ${ms.toFixed(1)} (carve ${CORE_FLOOR_STATS.carveMs.toFixed(1)}, finish ${CORE_FLOOR_STATS.finishMs.toFixed(1)}), generateReactorLevel ${REACTOR_GEN_STATS.ms.toFixed(0)} ms\n`);
    expect(ms).toBeLessThan(60);
  }, 60_000);
});
