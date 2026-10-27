import {describe, expect, it} from 'vitest';
import {
  ARCHETYPES, generateStation, layoutMetrics, pickArchetype, validateLayout, MIN_ZOMBIE_SPAWN_CELLS, SPAWN_LIT_RADIUS,
  type Archetype, type StationLayout,
} from '../src/gen/station';
import {CELL, FLOOR, PathFinder, SOLID, VOID} from '../src/gen/grid';
import {
  PROP_DEFS, SHELF_TIER_Y, SHOP_BACKBAR_Y, SHOP_COOLER_TIER_Y, SHOP_COUNTER_TOP_Y, SHOP_DISPLAY_DECK_Y, STALL_BACK_SHELF_Y, STALL_COUNTER_Y,
} from '../src/gen/props';
import {SHOP_HOLDERS, storefrontParts} from '../src/gen/storefronts';
import {STORE_PURPOSES} from '../src/gen/purposes';
import {isLootHolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {freshSeed} from '../src/core/rng';

const SEEDS = Array.from({length: 12}, (_, i) => (i * 2654435761 + 12345) >>> 0);
const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: Archetype) => {
  const key = `${seed}:${archetype ?? ''}`;
  let l = cache.get(key);
  if (!l) cache.set(key, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
/** One layout per archetype (forced), plus the natural seed sample. */
const PER_ARCH = ARCHETYPES.map((a, i) => gen(9001 + i * 7919, a));
const SAMPLE = () => [...SEEDS.map(s => gen(s)), ...PER_ARCH];
const MAIN_PUBLIC = ['platform', 'passage', 'concourse', 'fare-hall', 'food-court', 'retail-arcade'];

describe('station generator', () => {
  it('is deterministic for a seed and fast enough', () => {
    const t0 = performance.now();
    const a = generateStation(424242);
    const ms = performance.now() - t0;
    const b = generateStation(424242);
    expect(ms).toBeLessThan(400);
    expect(a.name).toBe(b.name);
    expect(a.archetype).toBe(b.archetype);
    expect(a.areas.map(r => [r.x, r.y, r.w, r.h, r.type])).toEqual(b.areas.map(r => [r.x, r.y, r.w, r.h, r.type]));
    expect(a.props).toEqual(b.props);
    expect(a.storefronts).toEqual(b.storefronts);
    expect(a.zombies).toEqual(b.zombies);
    expect(a.pickups).toEqual(b.pickups);
    expect(a.lights).toEqual(b.lights);
    expect(a.signs).toEqual(b.signs);
    expect(a.decor).toEqual(b.decor);
    expect(a.areas.map(r => r.lighting)).toEqual(b.areas.map(r => r.lighting));
    expect(Buffer.from(a.grid.cells).equals(Buffer.from(b.grid.cells))).toBe(true);
  });

  it('produces valid, fully connected layouts for every archetype', () => {
    const failures: string[] = [];
    for (const l of SAMPLE()) {
      const issues = validateLayout(l);
      if (issues.length) failures.push(`${l.seed}/${l.archetype}: ${issues.join(', ')}`);
    }
    expect(failures).toEqual([]);
    expect(PER_ARCH.map(l => l.archetype)).toEqual([...ARCHETYPES]);
  });

  it('macro layout varies per seed: several archetypes with measurably different structure', () => {
    const ls = SEEDS.map(s => gen(s));
    const archs = new Set(ls.map(l => l.archetype));
    expect(archs.size, [...archs].join(',')).toBeGreaterThanOrEqual(3);
    // Archetype is a function of the seed only (stable across generation retries).
    for (const l of ls) expect(pickArchetype(l.seed)).toBe(l.archetype);
    const m = [...ls, ...PER_ARCH].map(l => layoutMetrics(l));
    // Structural signatures (platform configuration, tracks, fare lines, ticket halls, arcades) differ.
    const sigs = new Set(m.map(x => `${x.platforms}/${x.tracks}/${x.fareLines}/${x.ticketHalls}/${x.arcades}`));
    expect(sigs.size).toBeGreaterThanOrEqual(5);
    expect(new Set(m.map(x => x.tracks))).toEqual(new Set([2, 4]));
    expect(new Set(m.map(x => x.platforms)).size).toBeGreaterThanOrEqual(3);
    // Footprint and where the food court sits relative to the spawn vary a lot, not by jitter.
    const span = (k: string) => { const v = m.map(x => x[k] as number); return Math.max(...v) - Math.min(...v); };
    expect(span('widthM')).toBeGreaterThan(60);
    expect(span('depthM')).toBeGreaterThan(40);
    expect(span('spawnToFoodM')).toBeGreaterThan(50);
    const sigsA = new Set(ls.map(l => l.areas.map(a => `${a.type}${a.x},${a.y},${a.w},${a.h}`).join('|')));
    expect(sigsA.size).toBe(SEEDS.length);
  });

  it('has subway scale: long platforms on track beds, paid halls, fare line, food court, exits', () => {
    for (const l of SAMPLE()) {
      const tag = `${l.seed}/${l.archetype}`;
      const P1 = l.areas[l.platform];
      expect(P1.kind).toBe('platform');
      expect(P1.w * CELL, `${tag} platform length`).toBeGreaterThanOrEqual(94);
      expect(P1.w * CELL).toBeLessThanOrEqual(150);
      for (const id of l.platforms) {
        const p = l.areas[id];
        expect(p.h * CELL, `${tag} platform width`).toBeGreaterThanOrEqual(7);
        expect(p.ceil).toBeGreaterThanOrEqual(4.0);
        expect(p.edge).toBeDefined();
      }
      // Every track bed is VOID in the grid and 4.5 m (one track) or 8 m (two tracks) wide.
      for (const t of l.trenches) {
        expect([4.5, 8]).toContain(Math.round((t.z1 - t.z0) * 10) / 10);
        expect(t.tracks.length).toBe(Math.round((t.z1 - t.z0) * 10) / 10 === 8 ? 2 : 1);
        const [cx, cy] = l.grid.cellOf((t.platformX0 + t.platformX1) / 2, (t.z0 + t.z1) / 2);
        expect(l.grid.cells[l.grid.idx(cx, cy)]).toBe(VOID);
      }
      const of = (type: string) => l.areas.filter(a => a.type === type);
      expect(l.areas.filter(a => a.paid && a.kind === 'concourse').length).toBeGreaterThanOrEqual(1);
      for (const a of [...of('fare-hall'), ...of('food-court')]) {
        expect(Math.min(a.w, a.h) * CELL, `${tag} ${a.type} width`).toBeGreaterThanOrEqual(11);
        expect(a.ceil).toBeGreaterThanOrEqual(3.8);
        expect(a.ceil).toBeLessThanOrEqual(6);
      }
      expect(of('washroom').length).toBe(2);
      expect(of('exit-stair').length).toBeGreaterThanOrEqual(2);
      // The fare line separates paid from unpaid: every fare door joins a paid area to an unpaid one.
      for (const d of l.doors.filter(x => x.fare)) expect(!!l.areas[d.a].paid && !l.areas[d.b].paid).toBe(true);
      // Back-of-house ceilings are low; corridors 3 m wide.
      for (const a of l.areas.filter(x => !x.publicSpace)) expect(a.ceil).toBeLessThanOrEqual(3.0);
      for (const a of l.areas.filter(x => x.kind === 'service')) expect(Math.min(a.w, a.h) * CELL).toBeGreaterThanOrEqual(3);
    }
  });

  it('builds storefronts into hall walls (no freestanding food-court stalls)', () => {
    for (const l of SAMPLE()) {
      const g = l.grid;
      const tag = `${l.seed}/${l.archetype}`;
      expect(l.storefronts.length, tag).toBeGreaterThanOrEqual(8);
      for (const sf of l.storefronts) {
        const hall = l.areas[sf.hall];
        const horiz = sf.oh === 1;
        // Opening is a one-cell slice of the hall's wall, along the full unit frontage.
        if (sf.side === 'S') expect(sf.oy).toBe(hall.y + hall.h);
        if (sf.side === 'N') expect(sf.oy).toBe(hall.y - 1);
        if (sf.side === 'E') expect(sf.ox).toBe(hall.x + hall.w);
        if (sf.side === 'W') expect(sf.ox).toBe(hall.x - 1);
        expect(horiz ? sf.ow : sf.oh).toBe(horiz ? sf.uw : sf.uh);
        for (let k = 0; k < (horiz ? sf.ow : sf.oh); k++) {
          const x = horiz ? sf.ox + k : sf.ox, y = horiz ? sf.oy : sf.oy + k;
          const cell = g.cells[g.idx(x, y)];
          if (sf.unit < 0) expect(cell, `${tag} facade ${sf.name}`).toBe(SOLID);
          else { expect(cell).toBe(FLOOR); expect(g.area[g.idx(x, y)]).toBe(sf.unit); }
        }
        if (sf.unit >= 0) {
          const u = l.areas[sf.unit];
          expect([u.x, u.y, u.w, u.h]).toEqual([sf.ux, sf.uy, sf.uw, sf.uh]);
          expect(u.type).toBe(sf.food ? 'eatery' : 'shop');
          expect(l.doors.some(d => d.shopfront && d.a === hall.id && d.b === u.id)).toBe(true);
        }
        // Architectural building blocks: frame + sign band at least; menus for open food units.
        const parts = storefrontParts(l, sf);
        expect(parts.boxes.some(b => b.m === 'signBand')).toBe(true);
        expect(parts.boxes.filter(b => b.m === 'shopFrame').length).toBeGreaterThanOrEqual(3);
        if (sf.food && sf.unit >= 0) expect(parts.boxes.some(b => b.m.startsWith('menuBoard'))).toBe(true);
        if (sf.shutter === 'closed' && sf.unit < 0 && sf.style !== 'hoarding') expect(parts.boxes.some(b => b.m === 'shutterSteel')).toBe(true);
      }
      // Shutter states vary (abandoned station) and plenty of units are enterable.
      expect(new Set(l.storefronts.map(s => s.shutter)).size).toBeGreaterThanOrEqual(2);
      // The old whole-stall prefab survives at most as one freestanding newsstand island, never in a food court.
      const stalls = l.props.filter(p => p.kind === 'stall');
      expect(stalls.length).toBeLessThanOrEqual(1);
      expect(stalls.filter(p => l.areas[p.area].type === 'food-court').length).toBe(0);
    }
  });

  it('food court: counters on the perimeter, seating in the middle, service corridor behind', () => {
    for (const l of SAMPLE()) {
      const tag = `${l.seed}/${l.archetype}`;
      const F = l.areas.find(a => a.type === 'food-court')!;
      const units = l.storefronts.filter(s => s.hall === F.id);
      expect(units.length, tag).toBeGreaterThanOrEqual(4);
      const open = units.filter(s => s.unit >= 0 && s.shutter !== 'closed');
      expect(open.length, tag).toBeGreaterThanOrEqual(3);
      // Each enterable counter unit is assembled from modular blocks: counter run + the cuisine's
      // back line (iteration 05: grill / pizza oven / espresso bar / wok … per purpose) or a cooler.
      for (const s of open.filter(x => x.food)) {
        const kinds = new Set<string>(l.props.filter(p => p.area === s.unit).map(p => p.kind));
        expect(kinds.has('shopCounter') || kinds.has('shopDisplay'), `${tag} ${s.name}`).toBe(true);
        const back = [...(STORE_PURPOSES[s.use].kitchen ?? []).map(k => k[0]), 'shopBackbar', 'shopCooler'];
        expect(back.some(k => kinds.has(k)), `${tag} ${s.name} back`).toBe(true);
      }
      // Shared seating sits in the middle, clear of the counters (queue + circulation ring).
      const tables = l.props.filter(p => p.kind === 'table' && p.area === F.id);
      expect(tables.length).toBeGreaterThanOrEqual(6);
      const x0 = F.x * CELL, z0 = F.y * CELL, x1 = (F.x + F.w) * CELL, z1 = (F.y + F.h) * CELL;
      for (const t of tables) {
        const gap = Math.min(t.x - t.hx - x0, x1 - (t.x + t.hx), t.z - t.hz - z0, z1 - (t.z + t.hz));
        expect(gap, tag).toBeGreaterThan(1.7);
      }
      expect(l.decor.some(b => b.m === 'quarryTile')).toBe(true);
      // Units on the far wall share a service corridor (rear doors), with stock rooms behind it.
      expect(l.areas.some(a => a.type === 'service-corridor' && l.storefronts.some(s => s.backDoor >= 0 && (l.doors[s.backDoor].a === a.id || l.doors[s.backDoor].b === a.id))), tag).toBe(true);
    }
  });

  it('storefront furniture are loot holders with surfaces matching the building blocks', () => {
    for (const k of SHOP_HOLDERS) expect(isLootHolderKind(k)).toBe(true);
    const top = (k: 'shopCounter' | 'shopDisplay' | 'shopBackbar' | 'shopCooler') => holderSurfaces(k, PROP_DEFS[k]).map(s => Math.round((s.y - 0.002) * 1000) / 1000);
    expect(top('shopCounter')[0]).toBeCloseTo(SHOP_COUNTER_TOP_Y, 2);
    expect(top('shopDisplay')[0]).toBeCloseTo(SHOP_DISPLAY_DECK_Y, 2);
    expect(top('shopBackbar')).toEqual(SHOP_BACKBAR_Y.map(y => Math.round(y * 1000) / 1000));
    expect(top('shopCooler').length).toBe(SHOP_COOLER_TIER_Y.length);
    for (const l of SAMPLE().slice(0, 4)) {
      const holders = l.props.filter(p => SHOP_HOLDERS.includes(p.kind));
      expect(holders.length).toBeGreaterThanOrEqual(6);
      for (const h of holders) expect(h.shop, 'tagged with its storefront').toBeDefined();
      expect(l.props.filter(p => p.kind === 'stockShelf' && l.areas[p.area].type === 'shop').length + l.props.filter(p => p.kind === 'shopCooler').length).toBeGreaterThan(0);
    }
  });

  it('keeps doors and passages clear of props (storefront glazing/shutters sit in their own opening)', () => {
    for (const l of SAMPLE()) {
      const g = l.grid;
      const doorCell = new Uint8Array(g.w * g.h);
      for (const d of l.doors) if (!d.fare && !d.shopfront) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCell[g.idx(x, y)] = 1;
      for (const p of l.props) {
        if (p.y !== 0) continue;
        for (let z = p.z - p.hz + 0.05; z < p.z + p.hz; z += 0.25) for (let x = p.x - p.hx + 0.05; x < p.x + p.hx; x += 0.25) {
          const [cx, cy] = g.cellOf(x, z);
          expect(doorCell[g.idx(cx, cy)], `${l.seed} ${p.kind} blocks a door`).toBe(0);
        }
      }
      // Glazed fronts keep an entry; shutters only close units that have a rear door.
      for (const sf of l.storefronts) {
        if (sf.glazed && sf.shutter !== 'closed') expect(sf.entry[1] - sf.entry[0]).toBeGreaterThanOrEqual(2);
        if (sf.shutter === 'closed' && sf.unit >= 0) expect(sf.backDoor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('mixed lighting: main public spaces lit, back-of-house lit/dim/dark, spawn readable', () => {
    const seen = {lit: 0, dim: 0, dark: 0};
    for (const l of SAMPLE()) {
      for (const a of l.areas) {
        seen[a.lighting]++;
        const own = l.lights.filter(x => x.area === a.id);
        const steady = own.filter(x => !x.broken && !x.dying).length;
        if (MAIN_PUBLIC.includes(a.type)) {
          expect(a.lighting, `public ${a.type} in seed ${l.seed}`).toBe('lit');
          expect(steady / own.length, `public ${a.type} in seed ${l.seed} too dark`).toBeGreaterThanOrEqual(0.6);
        } else if (a.lighting === 'dark') expect(steady).toBe(0);
        else expect(steady, `${a.lighting} ${a.type} in seed ${l.seed} has no working light`).toBeGreaterThan(0);
      }
      const back = l.areas.filter(a => !a.publicSpace);
      expect(back.some(a => a.lighting === 'dark')).toBe(true);
      expect(back.some(a => a.lighting !== 'dark')).toBe(true);
      const spawnArea = l.grid.areaAt(l.playerSpawn.x, l.playerSpawn.z);
      expect(l.areas[spawnArea].lighting).toBe('lit');
      const near = l.lights.filter(x => x.area === spawnArea && Math.hypot(x.x - l.playerSpawn.x, x.z - l.playerSpawn.z) < SPAWN_LIT_RADIUS);
      expect(near.length).toBeGreaterThan(0);
      for (const x of near) expect(!x.broken && !x.flicker && !x.dying && x.power === 1).toBe(true);
    }
    for (const k of ['lit', 'dim', 'dark'] as const) expect(seen[k]).toBeGreaterThan(8);
  });

  it('spawns the player on platform 1 looking down the platform, with the shotgun close by', () => {
    for (const l of SAMPLE()) {
      const sp = l.playerSpawn;
      expect(l.grid.areaAt(sp.x, sp.z)).toBe(l.platform);
      const dx = -Math.sin(sp.yaw), dz = -Math.cos(sp.yaw);
      expect(l.grid.raycast(sp.x, sp.z, dx, dz, 40, true), `seed ${l.seed} spawn faces a wall`).toBeGreaterThan(20);
      const sg = l.pickups.find(p => p.itemId === 'shotgun')!;
      expect(Math.hypot(sg.x - sp.x, sg.z - sp.z)).toBeLessThan(15);
      const shells = l.pickups.filter(p => p.itemId === 'ammo_shells').map(p => Math.hypot(p.x - sg.x, p.z - sg.z));
      expect(Math.min(...shells)).toBeLessThan(4);
    }
  });

  it('spreads 11-16 zombies across public and back-of-house, far from the player, all reachable by A*', () => {
    let coated = 0, shambler = 0, backOfHouse = 0, total = 0;
    for (const l of PER_ARCH) {
      const g = l.grid;
      const [sx, sy] = g.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = g.distanceField(sx, sy);
      expect(l.zombies.length).toBeGreaterThanOrEqual(11);
      expect(l.zombies.length).toBeLessThanOrEqual(16);
      const pf = new PathFinder(g);
      for (const z of l.zombies) {
        const [x, y] = g.cellOf(z.x, z.z);
        expect(g.cells[g.idx(x, y)]).toBe(FLOOR);
        expect(dist[g.idx(x, y)]).toBeGreaterThanOrEqual(MIN_ZOMBIE_SPAWN_CELLS);
        expect(pf.find(l.playerSpawn.x, l.playerSpawn.z, z.x, z.z, 0.3, 200000), `seed ${l.seed}`).not.toBeNull();
        if (z.type === 'coated') coated++; else shambler++;
        if (!l.areas[z.area].publicSpace) backOfHouse++;
        total++;
      }
      for (const p of l.pickups.filter(p => p.y === 0)) expect(pf.find(l.playerSpawn.x, l.playerSpawn.z, p.x, p.z, 0.3, 200000), `seed ${l.seed} ${p.itemId}`).not.toBeNull();
    }
    expect(coated).toBeGreaterThan(0);
    expect(shambler).toBeGreaterThan(0);
    expect(backOfHouse / total).toBeGreaterThan(0.2);
  });

  it('A* resolves cross-platform chases within the game expansion cap', () => {
    for (const l of PER_ARCH) {
      if (l.platforms.length < 2) continue;
      const pf = new PathFinder(l.grid);
      const p1 = l.areas[l.platforms[0]], p2 = l.areas[l.platforms[1]];
      const pick = (p: typeof p1, f: number) => {
        for (let r = 0; r < 12; r++) for (let dx = -r; dx <= r; dx++) {
          const cx = p.x + Math.floor(p.w * f) + dx, cy = p.y + Math.floor(p.h / 2) + (r % 3) - 1;
          if (l.grid.walkable(cx, cy)) return l.grid.center(cx, cy);
        }
        return l.grid.center(p.x + 2, p.y + 2);
      };
      const a = pick(p2, 0.3), b = pick(p1, 0.35);
      const t0 = performance.now();
      const path = pf.find(a[0], a[1], b[0], b[1], 0.34, 26000);
      expect(performance.now() - t0).toBeLessThan(80);
      expect(path, `${l.seed}/${l.archetype}`).not.toBeNull();
    }
  });

  it('exports the loot-surface contract and fresh seeds', () => {
    expect(SHELF_TIER_Y.length).toBeGreaterThanOrEqual(3);
    expect(STALL_COUNTER_Y).toBeGreaterThan(0.8);
    expect(STALL_BACK_SHELF_Y.every(y => y > STALL_COUNTER_Y && y < PROP_DEFS.stall.h)).toBe(true);
    const s = new Set(Array.from({length: 20}, () => freshSeed()));
    expect(s.size).toBeGreaterThan(18);
  });
});
