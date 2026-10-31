// Task mall-playtest-revision-20261031 (lane SHOPS, U11 — user: "gun store didn't have a gun! I think it should have on average 1
// gun"). The per-GUN-SHOP weapon allocation (gen/mall/shopsWeapons.ts) replacing the old mall-wide ~2.3-gun quota:
//  - the stock distribution: exactly 1.0 gun per gun shop in expectation, bounded (0 / 1 / 2, P(empty) 2 %), independent per shop
//    (a second gun shop draws its own stock — it never "adds none" by design);
//  - loadout-free: the start weapon / inventory / Travel never enter the plan (same stock with a rifle or a pistol start, with the
//    level-wide gear roll appended as the registry does on a Travel arrival);
//  - placement on the shop's real display benches (else its gun rack's shelf), lying along them, one box of its own calibre each,
//    reachable from the shop entry and targetable by the real PickupManager from the customer side;
//  - the runtime spawn path (game.ts buildSection order: run/memory.ts pickupPlan -> PickupManager; capturePickups on leaving) with
//    a starter loadout AND an already-owned gun: nothing is filtered, taken stays taken, the untaken gun stays, nothing duplicates.
// Layout-agnostic: the synthetic shop rings (tests/helpers/mallShopsFixture.ts) with two forced gun shops; one generated level for the
// start-weapon / Travel invariance (cached).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {assignMallPrograms, shopFit} from '../src/gen/mall/shops';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {GUN_DISPLAY_TOP, GUN_RACK_SHELF_Y} from '../src/gen/mall/kinds';
import {GUN_SHOP_STOCK, MALL_FIND_WEAPONS, MAX_GUNS_PER_SHOP, gunShopStock, gunShopStockDistribution, mallWeaponPlan, placeMallWeapons, type MallWeaponReport} from '../src/gen/mall/shopsWeapons';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {generateMallLevel} from '../src/gen/mall/index';
import {LEVELS} from '../src/levels/registry';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {createMemory, pickupPlan} from '../src/run/memory';
import {capturePickups, restorePickup} from '../src/run/worldMemory';
import {starterInventory} from '../src/run/starter';
import type {Inventory} from '../src/items/inventory';
import {PickupManager, type Pickup} from '../src/world/pickups';
import {mallShopsFixture} from './helpers/mallShopsFixture';

installCanvasShim(false);
{
  // the item label atlas clips its cells (the no-raster shim has no clip): a no-op is enough here
  const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
  proto.clip ??= () => {};
}

const GUNS = MALL_FIND_WEAPONS as readonly string[];
/** Two gun shops on the synthetic ring: a 13 x 12 m north unit and a 17 x 8 m south unit. */
const FORCE = {'L1-N02': 'guns', 'L1-S03': 'guns'} as const;

function dressed(seed: number): {layout: StationLayout; report: MallWeaponReport} {
  const {layout} = mallShopsFixture(1);
  assignMallPrograms(layout, new Rng(seed), {force: FORCE});
  dressMallShops(layout, new Rng(seed ^ 0x5eed), {frame: 'absolute'});
  const report = placeMallWeapons(layout, 7000 + seed);
  return {layout, report};
}
const cache = new Map<number, ReturnType<typeof dressed>>();
const get = (seed: number) => { let v = cache.get(seed); if (!v) cache.set(seed, (v = dressed(seed))); return v; };
const SEEDS = [1, 2, 3, 4];

describe('U11 stock distribution: one gun per gun shop on average, bounded, independent per shop', () => {
  it('exact distribution 0 / 1 / 2 = 2 / 96 / 2 % (expectation 1.0); sampled means agree; two guns are always different', () => {
    const dist = gunShopStockDistribution();
    expect(dist.reduce((s, d) => s + d.p, 0)).toBeCloseTo(1, 9);
    expect(dist.reduce((s, d) => s + d.guns * d.p, 0)).toBeCloseTo(1, 9);
    expect(dist.find(d => d.guns === 0)!.p).toBe(GUN_SHOP_STOCK.none);
    let n = 0, sum = 0, zeros = 0, twos = 0;
    const byGun: Record<string, number> = {};
    for (let seed = 1; seed <= 2000; seed++) for (const id of ['L1-N03', 'L2-E05']) {
      const st = gunShopStock(seed, id);
      n++; sum += st.length; if (!st.length) zeros++; if (st.length === 2) twos++;
      expect(st.length).toBeLessThanOrEqual(MAX_GUNS_PER_SHOP);
      expect(new Set(st).size).toBe(st.length);
      for (const w of st) { expect(GUNS).toContain(w); byGun[w] = (byGun[w] ?? 0) + 1; }
      expect(gunShopStock(seed, id)).toEqual(st); // deterministic
    }
    expect(sum / n).toBeGreaterThan(0.98);
    expect(sum / n).toBeLessThan(1.02);
    expect(zeros / n).toBeGreaterThan(0.008);
    expect(zeros / n).toBeLessThan(0.035);
    expect(twos / n).toBeGreaterThan(0.008);
    for (const w of GUNS) expect(byGun[w], w).toBeGreaterThan(n * 0.15); // every gun shows up
  });

  it('a second gun shop draws its OWN stock: independent of the first (not "adds none"), never a mall-wide quota', () => {
    let both = 0, secondEmpty = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
    const N = 3000;
    for (let seed = 1; seed <= N; seed++) {
      const a = gunShopStock(seed, 'L1-N02').length, b = gunShopStock(seed, 'L1-S03').length;
      if (a && b) both++;
      if (!b) secondEmpty++;
      sa += a; sb += b; sab += a * b; saa += a * a; sbb += b * b;
    }
    const cov = sab / N - (sa / N) * (sb / N), corr = cov / Math.sqrt((saa / N - (sa / N) ** 2) * (sbb / N - (sb / N) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.06);
    expect(secondEmpty / N).toBeLessThan(0.035);
    expect(both / N).toBeGreaterThan(0.94);
    expect(sb / N).toBeGreaterThan(0.97); // the second shop averages one gun too
  });
});

describe('U11 placement in the gun shops (synthetic ring with two gun shops)', () => {
  it('every planned gun lies on its own shop\'s display bench (or rack shelf), along it, with ONE box of its own calibre', () => {
    for (const seed of SEEDS) {
      const {layout, report} = get(seed);
      const shops = layout.mall!.shops.filter(s => shopFit(s)?.program === 'guns');
      expect(shops.map(s => s.id).sort()).toEqual(Object.keys(FORCE).sort());
      expect(report.shops.map(s => s.shop).sort()).toEqual(Object.keys(FORCE).sort());
      expect(report.missed, `seed ${seed}`).toEqual([]);
      for (const s of report.shops) {
        expect(s.stock).toEqual(gunShopStock(7000 + seed, s.shop)); // the shop's own draw
        expect(s.placed).toBe(s.stock.length);
      }
      expect(report.finds.length).toBe(report.plan.length);
      for (const f of report.finds) {
        expect(f.on, `seed ${seed} ${f.weapon}`).not.toBe('floor');
        const [gi, ai] = f.pickups;
        const g = layout.pickups[gi], a = layout.pickups[ai];
        const shop = layout.mall!.shops.find(s => s.id === f.shop)!;
        expect(g.itemId).toBe(f.weapon);
        expect(g.area).toBe(shop.area);
        expect(a.itemId).toBe(WEAPON_FIND_AMMO[f.weapon][0]);
        expect(a.count).toBe(WEAPON_FIND_AMMO[f.weapon][1]);
        // on a host top inside its footprint, at its measured height, lying along it
        const kind = f.on === 'display' ? 'gunDisplay' : 'gunRack', top = f.on === 'display' ? GUN_DISPLAY_TOP : GUN_RACK_SHELF_Y;
        const host = layout.props.find(p => p.kind === kind && p.area === shop.area && Math.abs(p.y + top - g.y) < 1e-3
          && Math.abs(p.x - g.x) <= p.hx + 1e-3 && Math.abs(p.z - g.z) <= p.hz + 1e-3);
        expect(host, `seed ${seed} ${f.weapon} host`).toBeDefined();
        expect(g.yaw).toBeCloseTo(host!.rot, 3);
        expect(Math.abs(host!.x - a.x) <= host!.hx + 1e-3 && Math.abs(host!.z - a.z) <= host!.hz + 1e-3).toBe(true);
        expect(Math.hypot(g.x - a.x, g.z - a.z)).toBeGreaterThan(0.4); // the box beside the gun, not inside it
      }
      // finite: exactly one ammo box per placed gun, nothing else in the gun shops from the plan
      const planned = report.finds.flatMap(f => f.pickups);
      expect(new Set(planned).size).toBe(planned.length);
      expect(layout.pickups.filter(p => GUNS.includes(p.itemId)).length).toBe(report.finds.length);
    }
  });

  it('discoverable: each gun is reachable from its shop entry and targeted by the real PickupManager from the customer side', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const {layout, report} = get(seed);
      const L = levelsOf(layout);
      const pm = new PickupManager({});
      const inv = starterInventory('pistol');
      const live = new Map<number, Pickup>();
      for (const f of report.finds) { const p = layout.pickups[f.pickups[0]]; live.set(f.pickups[0], pm.add(inv.makeStack(p.itemId, 1), p.x, p.y, p.z, p.yaw)); }
      for (const f of report.finds) {
        const g = layout.pickups[f.pickups[0]];
        const host = layout.props.find(p => (p.kind === 'gunDisplay' || p.kind === 'gunRack') && p.area === g.area && Math.abs(p.x - g.x) <= p.hx + 1e-3 && Math.abs(p.z - g.z) <= p.hz + 1e-3)!;
        // the customer stands 0.45 m off the host's front face (its local +z), eye 1.6 m above the floor
        const d = PROP_DEFS[host.kind].d / 2 + 0.45, fx = Math.sin(host.rot), fz = Math.cos(host.rot);
        const st = {x: g.x + fx * d, z: g.z + fz * d};
        const grid = L.grid(g.level ?? 0), [cx, cy] = grid.cellOf(st.x, st.z);
        expect(grid.walkable(cx, cy), `seed ${seed} ${f.weapon} stand cell`).toBe(true);
        const floor = host.y;
        const eye = new THREE.Vector3(st.x, floor + 1.6, st.z);
        const look = new THREE.Vector3(g.x - eye.x, g.y + 0.05 - eye.y, g.z - eye.z).normalize();
        expect(pm.target(eye, look, L), `seed ${seed} ${f.weapon} targeted`).toBe(live.get(f.pickups[0]));
      }
      void CELL;
    }
  });

  it('loadout-free and deterministic: the same stock and placements with a rifle start, a pistol start or none', () => {
    const {layout: a} = get(1);
    const base = (s: 'rifle' | 'pistol' | undefined) => {
      const {layout} = mallShopsFixture(1);
      assignMallPrograms(layout, new Rng(1), {force: FORCE});
      dressMallShops(layout, new Rng(1 ^ 0x5eed), {frame: 'absolute'});
      placeMallWeapons(layout, 7001, s);
      return layout.pickups;
    };
    expect(base('rifle')).toEqual(a.pickups);
    expect(base('pistol')).toEqual(a.pickups);
    expect(base(undefined)).toEqual(a.pickups);
    expect(mallWeaponPlan(7001, a.mall!.shops)).toEqual(get(1).report.plan);
  });
});

describe('U11 runtime: starter / already-owned loadouts, leave + revisit (game.ts buildSection pickup order)', () => {
  /** game.ts buildSection's pickup step: first visit = every layout pickup, then exactly the remembered loose items. */
  function build(layout: StationLayout, mem: ReturnType<typeof createMemory>, inv: Inventory) {
    const pm = new PickupManager({});
    const idx = new Map<Pickup, number>();
    const plan = pickupPlan(layout.pickups.length, mem);
    for (const i of plan.fromLayout) { const p = layout.pickups[i]; idx.set(pm.add(inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0), i); }
    for (const rec of plan.restored) { const pk = restorePickup(pm, inv, rec); if (rec.layoutIndex !== undefined) idx.set(pk, rec.layoutIndex); }
    return {pm, idx};
  }
  it('a starter loadout and a loadout that already owns the stocked gun both see every gun; taken stays taken, the rest stays, no duplicates', () => {
    // a seed whose two gun shops stock >= 2 guns in total
    const seed = SEEDS.find(s => get(s).report.finds.length >= 2)!;
    expect(seed).toBeDefined();
    const {layout, report} = get(seed);
    const gunIdx = report.finds.map(f => f.pickups[0]);
    for (const owned of [[], [layout.pickups[gunIdx[0]].itemId]]) {
      const inv = starterInventory('pistol');
      for (const w of owned) inv.add(inv.makeStack(w, 1)); // already owns the stocked gun
      const mem = createMemory({level: 'mall', section: 'main'});
      // first visit (NewGame or a Travel arrival: same layout, the memory is what differs) — nothing filtered by the loadout
      const v1 = build(layout, mem, inv);
      const live = (b: typeof v1) => [...b.idx.entries()].filter(([, i]) => gunIdx.includes(i)).map(([p, i]) => ({p, i}));
      expect(live(v1).map(e => e.i).sort((x, y) => x - y)).toEqual([...gunIdx].sort((x, y) => x - y));
      // take the first gun (+ its box), leave
      const take = live(v1).find(e => e.i === gunIdx[0])!;
      expect(inv.add(take.p.stack)).toBe(0);
      v1.pm.remove(take.p);
      const box = [...v1.idx.entries()].find(([, i]) => i === report.finds[0].pickups[1])![0];
      inv.add(box.stack); v1.pm.remove(box);
      mem.pickups = capturePickups(v1.pm.list, p => v1.idx.get(p));
      // revisit twice: the taken gun / box never come back, every other gun is there exactly once
      for (let visit = 0; visit < 2; visit++) {
        const v = build(layout, mem, inv);
        const guns = live(v).map(e => e.i);
        expect(guns).not.toContain(gunIdx[0]);
        expect(guns.sort((x, y) => x - y)).toEqual(gunIdx.slice(1).sort((x, y) => x - y));
        expect([...v.idx.values()]).not.toContain(report.finds[0].pickups[1]);
        expect(new Set(v.idx.values()).size).toBe(v.idx.size);
        mem.pickups = capturePickups(v.pm.list, p => v.idx.get(p));
      }
    }
  });
});

describe('U11 generated level: Travel arrival / start weapon never change the shop stock (one cached seed)', () => {
  it('the registry\'s Travel path (gear appended, rifle start) places exactly the gun-shop stock of a plain pistol-start generation', () => {
    const S = 0x7ea3c1;
    const plain = generateMallLevel({levelSeed: S, startWeapon: 'pistol'});
    const gear = rollLevelGear(S, 'mall', ['main']).main ?? [];
    const travel = LEVELS.mall.generate('main', {levelSeed: S, startWeapon: 'rifle', gear});
    const shopGuns = (L: StationLayout) => L.pickups.filter(p => GUNS.includes(p.itemId)).map(p => ({id: p.itemId, x: p.x, y: p.y, z: p.z, area: p.area}));
    expect(shopGuns(travel)).toEqual(shopGuns(plain));
    const gunShops = plain.mall!.shops.filter(s => shopFit(s)?.program === 'guns');
    expect(gunShops.length).toBeGreaterThanOrEqual(1);
    // every gun in the level lies in a gun shop, as planned
    const plan = mallWeaponPlan(S, plain.mall!.shops);
    expect(shopGuns(plain).length).toBe(plan.length);
    for (const g of shopGuns(plain)) expect(gunShops.some(s => s.area === g.area)).toBe(true);
  });
});
