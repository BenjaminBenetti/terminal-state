// Task track3-eaton-centre-20261031 (lane PROFILES): LOOSE FLOOR SUPPLIES of The Eaton's Center — the interpreter of the mall's
// per-storey floor program (items/lootTables.ts MALL_FLOOR = BASE_TABLES.floor.mall, read through the ONE mall loot profile).
//
// Called by the mall generator (gen/mall/index.ts, lane GEN) once per storey on its own fork (`mall-supplies-<storey>`): variant
// 'pit' for the subway station storey (level 0), 'ring' for each retail ring. Pure data, deterministic, no three.js. Finite: the
// pickups are ordinary layout pickups (run memory remembers what was taken; nothing is ever re-rolled or refilled).
//
// Draw order (per storey): ammo-band draws (one rng.next() per draw against the cumulative thresholds), then the scarce finds on the
// `scarce-floor` fork (per draw: med?, kit-or-bandage?, battery?, flare?), then `salvage.n` loose crafting materials on the
// `salvage` fork (item by weight, stack size BOX_COUNT small). WHERE: a weighted area of the storey (MALL_FLOOR.place: galleries /
// bridges, shop sales floors — themed shops weigh more for salvage —, back of house), then a free walkable cell of it at least
// `place.minCells` walking from the platform start and LANDING_KEEP_M.loot off every landing (10 tries; none = nothing placed).

import type {Rng} from '../../core/rng';
import {purposeById, type LootTheme} from '../purposes';
import {ITEMS} from '../../items/items';
import {econCat, floorChance, floorCount, type LootProfile, type LotRange} from '../../items/lootTables';
import {BATTERY_ID, FLARE_ID} from '../../items/lootEconomy';
import type {Area, PickupPlacement, StationLayout} from '../stationTypes';
import {LANDING_KEEP_M, type SpawnField} from '../office/spawns';

/** Where a loose find may land (MALL_FLOOR.place). */
export type MallFloorZone = 'gallery' | 'shop' | 'back';

/** The zone of an area: a gallery walkway / bridge deck, a shop's sales floor, or back of house (stock rooms, service, cores). */
export function mallFloorZone(layout: StationLayout, a: Area): MallFloorZone {
  const m = layout.mall;
  if (m) {
    if (m.galleries.some(g => g.areas.includes(a.id)) || m.bridges.some(b => b.area === a.id)) return 'gallery';
    if (m.shops.some(s => s.area === a.id)) return 'shop';
    if (m.shops.some(s => s.backroom === a.id)) return 'back';
  }
  return a.publicSpace ? 'gallery' : a.storefront !== undefined || purposeById(a.purpose)?.category === 'retail' ? 'shop' : 'back';
}

const themeOf = (a: Area): LootTheme => purposeById(a.purpose)?.theme ?? 'public';

/**
 * Loose supplies of the storeys `levels` (normally one) of the mall layout under the mall loot profile `loot`: `variant` 'pit' (the
 * station at the bottom of the void) or 'ring' (a retail ring). Returns the pickups it placed (also appended to layout.pickups).
 */
export function placeMallSupplies(layout: StationLayout, rng: Rng, field: SpawnField, levels: readonly number[], variant: 'pit' | 'ring', loot: LootProfile): PickupPlacement[] {
  const prog = loot.tables.floor.mall, S = prog[variant], P = prog.place;
  const on = new Set(levels);
  const used = new Set<string>();
  const placed: PickupPlacement[] = [];
  const nearKeep = (lv: number, x: number, z: number) => field.keep.some(k => k.level === lv && Math.hypot(k.x - x, k.z - z) < LANDING_KEEP_M.loot);
  const cellsCache = new Map<number, [number, number, number][]>();
  const cellsOf = (a: Area): [number, number, number][] => {
    let base = cellsCache.get(a.id);
    if (!base) {
      base = [];
      const lv = a.level ?? 0, g = layout.levels[lv]?.grid, d = field.dist[lv];
      if (g && d) {
        for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
          const i = g.idx(x, y);
          if (!g.walkable(x, y) || g.area[i] !== a.id || g.rampIdx[i] >= 0 || d[i] < P.minCells) continue;
          const [cx, cz] = g.center(x, y);
          if (nearKeep(lv, cx, cz)) continue;
          base.push([lv, x, y]);
        }
      }
      cellsCache.set(a.id, base);
    }
    return base.filter(([lv, x, y]) => !used.has(`${lv}:${layout.levels[lv].grid.idx(x, y)}`));
  };
  const place = (itemId: string, count: number, pool: [Area, number][], r: Rng): void => {
    if (!pool.length || !(itemId in ITEMS) || count < 1) return;
    for (let t = 0; t < 10; t++) {
      const a = r.weighted(pool);
      const cells = cellsOf(a);
      if (!cells.length) continue;
      const [lv, x, y] = r.pick(cells);
      const g = layout.levels[lv].grid;
      used.add(`${lv}:${g.idx(x, y)}`);
      const [wx, wz] = g.center(x, y);
      const p: PickupPlacement = {itemId, count, x: wx + r.range(-0.1, 0.1), y: lv ? g.floorOf(g.idx(x, y)) : 0, z: wz + r.range(-0.1, 0.1), area: a.id};
      if (lv) p.level = lv;
      layout.pickups.push(p);
      placed.push(p);
      return;
    }
  };
  // every area of these storeys except stair runs (track beds are VOID cells: never a candidate)
  const mine = layout.areas.filter(a => on.has(a.level ?? 0) && a.role !== 'stair');
  const base: [Area, number][] = mine.map(a => [a, P[mallFloorZone(layout, a)]] as [Area, number]).filter(e => e[1] > 0);
  const salvagePool: [Area, number][] = base.map(([a, w]) => [a, P.themedFor.includes(themeOf(a)) ? w * P.themed : w] as [Area, number]);
  // ammo bands
  for (let k = 0; k < S.ammo.draws; k++) {
    const x = rng.next();
    const i = S.ammo.thresholds.findIndex((t, j) => x < floorChance(loot, econCat(S.ammo.boxes[j].itemId), t));
    if (i >= 0) place(S.ammo.boxes[i].itemId, S.ammo.boxes[i].count, base, rng);
  }
  // scarce finds
  const scarce = rng.fork('scarce-floor');
  const pMed = floorChance(loot, 'med', S.scarce.med), pBat = floorChance(loot, 'battery', S.scarce.battery), pFlare = floorChance(loot, 'flare', S.scarce.flare);
  for (let k = 0; k < S.scarce.draws; k++) {
    if (scarce.chance(pMed)) place(scarce.chance(S.scarce.medkit) ? 'medkit' : 'bandage', 1, base, scarce);
    if (scarce.chance(pBat)) place(BATTERY_ID, 1, base, scarce);
    if (scarce.chance(pFlare)) place(FLARE_ID, 1, base, scarce);
  }
  // loose salvage
  const sv = rng.fork('salvage');
  const [lo, hi]: LotRange = floorCount(loot, 'material', S.salvage.n);
  const n = lo === hi ? lo : sv.int(lo, hi);
  const rows = S.salvage.items.filter(r => r[1] > 0);
  for (let k = 0; k < n && rows.length; k++) {
    const id = sv.weighted(rows.map(r => [r[0], r[1]] as [string, number]));
    const box = loot.tables.boxCount[id]?.small ?? [1, 1];
    place(id, sv.int(box[0], box[1]), salvagePool, sv);
  }
  return placed;
}
