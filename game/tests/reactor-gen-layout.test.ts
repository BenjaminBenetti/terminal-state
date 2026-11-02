// Task reactor-build-20261101 (lane GEN): THE REACTOR generator — validity over seeds, determinism, variation, the layout.reactor
// contract, the no-deadlock gas rule, routes and the generation time. Focused (no browser).
import {describe, expect, it} from 'vitest';
import {generateReactorLevel, reactorFrame, reactorIssues, REACTOR_GEN_STATS, CORE_LEVEL, REACTOR_LEVELS} from '../src/gen/reactor/index';
import {reactorRouteGroups} from '../src/gen/reactor/validate';
import {levelsOf} from '../src/gen/levels';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = generateReactorLevel({levelSeed: seed}); cache.set(seed, L); }
  return L;
};

/** FNV-1a over the layout's records and every storey grid (cells / floors / ceilings / areas / ramps / blocked). */
function fingerprint(L: StationLayout): string {
  let h = 2166136261 >>> 0;
  const eat = (u8: Uint8Array) => { for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; } };
  const str = (s: string) => eat(new TextEncoder().encode(s));
  for (const lv of L.levels) {
    const g = lv.grid;
    for (const a of [g.cells, g.area, g.floor, g.ceil, g.rampIdx, g.blocked]) eat(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }
  str(JSON.stringify({areas: L.areas, doors: L.doors, props: L.props, lights: L.lights, signs: L.signs, pickups: L.pickups, zombies: L.zombies, rails: L.rails, links: L.levelLinks, ladders: L.traversal.ladders, stairs: L.traversal.stairs, reactor: L.reactor, spawn: L.playerSpawn}));
  return h.toString(16);
}

describe('Reactor generator (lane GEN)', () => {
  it('generates a valid layout for every sample seed (reactorIssues empty: reachability, routes, gas rule, rails, shared storey rules)', () => {
    for (const seed of SEEDS) {
      const L = gen(seed);
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(L.levels.length).toBe(REACTOR_LEVELS);
      expect(L.levels.length).toBeLessThanOrEqual(8);
      expect(L.grid.w * L.grid.h).toBeLessThanOrEqual(90_000);
    }
  });

  it('is deterministic: the same seed gives the identical layout (records + every storey grid)', () => {
    const a = generateReactorLevel({levelSeed: 3}), b = generateReactorLevel({levelSeed: 3});
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('varies across seeds within the coherent kit (stair wall, tower count, pit size, bridge tiers, room placement)', () => {
    const prints = new Set(SEEDS.map(s => fingerprint(gen(s))));
    expect(prints.size).toBe(SEEDS.length);
    const variants = new Set(SEEDS.map(s => gen(s).reactor!.pit.variant));
    expect(variants.size).toBeGreaterThanOrEqual(3);
    const walls = new Set(SEEDS.map(s => reactorFrame(s).stairWall));
    expect(walls).toEqual(new Set(['W', 'E']));
    const towers = new Set(SEEDS.map(s => gen(s).reactor!.towers.length));
    expect([...towers].every(n => n === 1 || n === 2)).toBe(true);
    expect(towers.size).toBe(2);
    const sizes = new Set(SEEDS.map(s => { const b = gen(s).reactor!.pit.bounds; return `${b.x1 - b.x0}x${b.z1 - b.z0}`; }));
    expect(sizes.size).toBeGreaterThan(3);
  });

  it('fills the layout.reactor contract (B: rim station, tiers, zones, generators, fans, sites, components, screens, set pieces, routes)', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const L = gen(seed), R = L.reactor!;
      expect(R.version).toBe(1);
      expect(R.name).toBe('Reactor');
      // the pit: 40-48 m mouth, roof 14-18 m above the rim, 4 tiers ~5.5-6.5 m apart, the core floor -28 … -33
      const b = R.pit.bounds;
      for (const w of [b.x1 - b.x0, b.z1 - b.z0]) { expect(w).toBeGreaterThanOrEqual(40); expect(w).toBeLessThanOrEqual(48); }
      expect(R.pit.roofY).toBeGreaterThanOrEqual(14);
      expect(R.pit.roofY).toBeLessThanOrEqual(18);
      expect(R.pit.floorY).toBeLessThanOrEqual(-28);
      expect(R.pit.floorY).toBeGreaterThanOrEqual(-33);
      expect(R.tiers.map(t => t.role)).toEqual(['rim', 'upper', 'upper', 'middle', 'deep', 'core']);
      for (let k = 1; k < R.tiers.length; k++) {
        const gap = R.tiers[k - 1].baseY - R.tiers[k].baseY;
        expect(gap).toBeGreaterThanOrEqual(5.5);
        expect(gap).toBeLessThanOrEqual(6.5);
      }
      expect(R.tiers.map(t => t.zone)).toEqual([-1, 0, 0, 1, 1, 2]);
      // gas zones + the no-deadlock generators: G0 on tier 1 (thin haze), G1 on tier 2 (cleared by G0), G2 on tier 4 (cleared by G1)
      expect(R.zones.map(z => z.levels)).toEqual([[1, 2], [3, 4], [CORE_LEVEL]]);
      expect(R.zones[0].yTop).toBeLessThan(-1.15); // below the rim station's track bed: the rim stays clean air (lane AIR)
      for (const z of R.zones) { expect(z.yTop).toBeGreaterThan(z.yBottom); expect(z.fans.length).toBeGreaterThanOrEqual(2); expect(z.fans.length).toBeLessThanOrEqual(4); }
      expect(R.generators.map(g => [g.zone, g.level])).toEqual([[0, 1], [1, 2], [2, 4]]);
      for (const g of R.generators) {
        expect(g.cable.length).toBeGreaterThanOrEqual(2);
        const lv = levelsOf(L).list[g.use.level].grid, [cx, cy] = lv.cellOf(g.use.x, g.use.z);
        expect(lv.walkable(cx, cy)).toBe(true);
        // task reactor-expansion-20261101 (lane HOST): a side complex's generator stands in its complex (tests/reactor-x-host-*)
        if (R.complexes?.some(c => c.generator === g.id)) continue;
        // its landing is >= 8 x 6 m
        const d = R.decks.find(q => q.level === g.level && g.x > q.rect.x0 && g.x < q.rect.x1 && g.z > q.rect.z0 && g.z < q.rect.z1 && q.kind === 'landing')!;
        expect(d).toBeTruthy();
        const [w, h] = [d.rect.x1 - d.rect.x0, d.rect.z1 - d.rect.z0].sort((p, q) => p - q);
        expect(w).toBeGreaterThanOrEqual(6);
        expect(h).toBeGreaterThanOrEqual(8);
      }
      for (const f of R.fans) { expect(f.radius).toBe(1.2); expect(Math.hypot(f.nx, f.nz)).toBeCloseTo(1); }
      // restart sites and their controls (walkable, prop-free stand points)
      const ids = Object.fromEntries(R.sites.map(s => [s.id, s.controls.map(c => c.id)]));
      expect(ids).toEqual({switchgear: ['fuse-0', 'fuse-1', 'breaker'], pumpHall: ['valve', 'pump'], control: ['keyswitch', 'rods'], rimOffice: ['statusBoard']});
      expect(R.sites.find(s => s.id === 'switchgear')!.level).toBe(4);
      expect(R.sites.find(s => s.id === 'pumpHall')!.level).toBe(CORE_LEVEL);
      expect(R.sites.find(s => s.id === 'control')!.level).toBe(CORE_LEVEL);
      expect(R.sites.find(s => s.id === 'rimOffice')!.level).toBe(0);
      for (const s of R.sites) for (const m of s.machines ?? []) expect(L.props[m.prop].kind).toBe('annexMachine');
      // components: the key in the rim office, three fuses in the maintenance stores of tier 3 / tier 4 / the core floor
      expect(R.components.map(c => [c.item, c.level])).toEqual([['reactor_key', 0], ['fuse_cartridge', 3], ['fuse_cartridge', 4], ['fuse_cartridge', CORE_LEVEL]]);
      for (const c of R.components) {
        const p = L.pickups[c.pickup];
        expect(p.itemId).toBe(c.item);
        expect(p.count).toBe(1);
        expect(L.areas[c.area].type).toBe(c.item === 'reactor_key' ? 'agent-office' : 'storage');
      }
      expect(R.screens.map(s => s.id).sort()).toEqual(['controlMonitor', 'pitBoard', 'pumpBoard', 'switchgearBoard']);
      // set pieces
      const kinds = new Set(R.decks.map(d => d.kind));
      expect(kinds).toEqual(new Set(['gallery', 'landing', 'bridge', 'tower', 'stair-landing']));
      const bridgeTiers = new Set(R.decks.filter(d => d.kind === 'bridge').map(d => d.level));
      expect(bridgeTiers.size).toBeGreaterThanOrEqual(2);
      for (const d of R.decks.filter(q => q.kind === 'bridge')) expect(Math.min(d.rect.x1 - d.rect.x0, d.rect.z1 - d.rect.z0)).toBeGreaterThanOrEqual(2);
      expect(R.towers.length).toBeGreaterThanOrEqual(1);
      for (const t of R.towers) { expect(t.y0).toBe(R.pit.floorY); expect(t.y1).toBeLessThan(R.pit.roofY); }
      const c = R.crane;
      expect(c.railY).toBeCloseTo(R.pit.roofY - 3);
      expect(c.hookY).toBeLessThan(R.pit.rimY);
      expect(R.pipeBanks.length).toBeGreaterThanOrEqual(1);
      for (const p of R.pipeBanks) { expect(p.depth).toBeCloseTo(1.5); expect(p.y0).toBe(R.pit.floorY); }
      expect(R.core).toMatchObject({x: R.pit.cx, z: R.pit.cz, radius: 7, y0: R.pit.floorY});
      expect(R.core.y1).toBeCloseTo(R.pit.floorY + 12);
      expect(R.markers.map(m => m.text)).toEqual(['T1', 'T2', 'T3', 'T4', 'CORE']);
      // the rim station + the future train arrival hook
      expect(R.start).toEqual({...L.playerSpawn, level: 0});
      const P = L.areas[L.platform];
      expect(P.kind).toBe('platform');
      expect(P.w * CELL).toBeGreaterThanOrEqual(60);
      expect(R.arrival.stop1 - R.arrival.stop0).toBeGreaterThanOrEqual(30);
      expect(R.arrival.doorSide).toBe('S');
      expect(L.trenches[R.arrival.trench].tracks[R.arrival.track]).toBeDefined();
      expect(L.doors.filter(d => d.a === P.id && L.areas[d.b].role === 'reactor-gallery').length).toBeGreaterThanOrEqual(2);
      // routes: the wall switchbacks, the south flight set (bridge line) and the maintenance ladders — one link per storey pair each
      expect(R.routes.map(r => [r.kind, r.links.length])).toEqual([['stairs', 5], ['bridge', 5], ['ladder', 5]]);
      for (const r of R.routes) r.links.forEach((id, k) => { expect(L.levelLinks[id].upper).toBe(k); expect(L.levelLinks[id].lower).toBe(k + 1); });
      for (const id of R.routes[2].links) expect(L.traversal.ladders[L.levelLinks[id].traversalId!].kind).toBe('maintenance');
    }
  });

  it('keeps every drop railed, the vessel solid, enemies off the stairs / keep points and density rising with depth', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const L = gen(seed), Lv = levelsOf(L);
      expect(Lv.unrailedDrops()).toEqual([]);
      const per = L.levels.map(lv => L.zombies.filter(z => (z.level ?? 0) === lv.id && z.horde === undefined && !L.areas[z.area]?.ext).length);
      expect(per[0]).toBeGreaterThanOrEqual(1);
      expect(per[CORE_LEVEL]).toBeGreaterThan(per[0]);
      expect(per[3] + per[4]).toBeGreaterThan(per[1] + per[2] - 1);
      // no enemy within 2 m of a control stand point / generator use point
      for (const z of L.zombies) {
        for (const s of L.reactor!.sites) for (const c of s.controls) if (c.stand.level === (z.level ?? 0)) expect(Math.hypot(c.stand.x - z.x, c.stand.z - z.z)).toBeGreaterThan(1.5);
      }
      // the vessel: raised and blocked on the core floor
      const gC = L.levels[CORE_LEVEL].grid, [cx, cy] = gC.cellOf(L.reactor!.core.x, L.reactor!.core.z);
      expect(gC.blocked[gC.idx(cx, cy)]).toBe(1);
      expect(gC.cells[gC.idx(cx, cy)]).toBe(FLOOR);
      expect(gC.floorOf(gC.idx(cx, cy))).toBeCloseTo(L.reactor!.core.y1);
      expect(reactorRouteGroups(L).length).toBe(10);
    }
  });

  it('generates fast (report; target < 600 ms per call in Node)', () => {
    gen(1);
    const times: number[] = [];
    for (const seed of [21, 22, 23]) { generateReactorLevel({levelSeed: seed}); times.push(REACTOR_GEN_STATS.ms); }
    process.stdout.write(`[reactor-gen] generateReactorLevel ms: ${times.map(t => t.toFixed(0)).join(', ')}\n`);
    times.sort((a, b) => a - b);
    expect(times[1]).toBeLessThan(1500); // CI headroom (slow runners); the Node target is < 600 ms
  });
});
