// Task track3-eaton-centre-20261031 (lane SHOPS): the mall's shops — catalogue / program mix, unit kinds and census, interior
// substance (fixtures per m², stock rooms), frontage / entry / door clearance, reachable holders, the mall prop kinds' audits (openables +
// physics + loot surfaces), no baked clutter, themed loot, the gun-shop weapon plan, determinism.
// Task mall-playtest-revision-20261031 (lane SHOPS): REWRITTEN for the revised mall — programs by LOT FAMILY (gen/mall/lots.ts) with the
// seeded catalogue rotation (MALL_ALWAYS + mallRotation), focal merchandising, corner / recessed / end / narrow units, compact food
// stalls. Layout-agnostic: the synthetic lot-family storey (tests/helpers/mallShopsFixture.ts mallLotsFixture: every family, seeded
// sizes) for the mix / interiors / circulation; the old lot-less shop rings for the inferred-family path; two generated levels at the end.
import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS} from '../src/gen/props';
import {ROOM_PURPOSES, STORE_PURPOSES, purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';
import type {MallProgram} from '../src/gen/mall/mallTypes';
import {GARMENT_RAIL_Y, MALL_HOLDER_KINDS, MALL_KINDS, MALL_KIND_ASSET, MALL_OPEN_AUDIT, MALL_PHYS, MALL_SURFACES, isMallHolderKind} from '../src/gen/mall/kinds';
import {MALL_DIMS} from '../src/assets/mallDims.generated';
import {COMMONS} from '../src/gen/mall/commons';
import {MALL_ALWAYS, MALL_ASSIGN_STATS, MALL_PROGRAMS, MALL_ROTATION, assignMallPrograms, inferLot, mallShopCensus, shopFit} from '../src/gen/mall/shops';
import {MALL_LOTS, lotSuits} from '../src/gen/mall/lots';
import {MALL_COMMONS_STATS, MALL_FOCAL, SPOOKY_MANNEQUINS, dressMallShops, frameOf, frontageSide, uvXZ} from '../src/gen/mall/shopsDress';
import {MALL_FIND_WEAPONS, mallGearSpots, mallShopPose, mallWeaponPlan, placeMallWeapons} from '../src/gen/mall/shopsWeapons';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, openableSpec} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {dynamicKind} from '../src/physics/dynamicItems';
import {HOLDER_ALLOW, HOLDER_SLOTS, OPENABLE_TABLES, econCat} from '../src/items/lootTables';
import {holderTable, isLootHolderKind, rollLootItems} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {mallLotsFixture, mallShopsFixture} from './helpers/mallShopsFixture';
import {checkMenu} from './helpers/mallAdsChecks'; // (R5 real-mall ad case)
import {mallAds, type MallAd} from '../src/gen/mall/ads';
import {generateMallLevel, mallIssues} from '../src/gen/mall/index';

/** A dressed synthetic lot-family storey (absolute frame) for `seed` (fixture sizes + assignment + dressing all from the seed). */
function dressed(seed: number): {layout: StationLayout; reports: ReturnType<typeof dressMallShops>; rotation: MallProgram[]; featured: MallProgram[]} {
  const {layout} = mallLotsFixture(seed);
  assignMallPrograms(layout, new Rng(seed * 7919));
  const {rotation, featured} = MALL_ASSIGN_STATS.last!;
  const reports = dressMallShops(layout, new Rng(seed ^ 0x5eed), {frame: 'absolute'});
  return {layout, reports, rotation: [...rotation], featured: [...featured]};
}
const cache = new Map<number, ReturnType<typeof dressed>>();
const get = (seed: number) => {
  let v = cache.get(seed);
  if (!v) cache.set(seed, (v = dressed(seed)));
  return v;
};
const SEEDS = [1, 2, 3, 4];
/** The rotation sample (D04: every delivered model somewhere across it). */
const ROT_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const REAL = (k: string) => k === 'store' || k === 'anchor' || k === 'food';

describe('program mix by lot family (synthetic lot storey) and the catalogue rotation', () => {
  it('assigns every unit a program / kind / brand / fit, labels areas with the brand, keeps brands unique', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      const shops = layout.mall!.shops;
      const brands: string[] = [];
      for (const sh of shops) {
        const f = shopFit(sh)!;
        expect(f, sh.id).toBeDefined();
        expect(sh.program).toBe(f.program);
        expect(MALL_PROGRAMS[sh.program].units.includes(sh.kind) || sh.kind === 'kiosk' || sh.kind === 'vacant', `${sh.id} ${sh.program} ${sh.kind}`).toBe(true);
        const a = layout.areas[sh.area];
        expect(a.purpose, sh.id).toBe(f.purpose);
        expect(purposeById(a.purpose)).toBeDefined();
        expect(a.label.startsWith(sh.brand), a.label).toBe(true);
        if (sh.backroom !== undefined) {
          expect(layout.areas[sh.backroom].label).toContain(sh.brand);
          expect(purposeById(layout.areas[sh.backroom].purpose)).toBeDefined();
        }
        if (REAL(sh.kind)) brands.push(sh.brand);
      }
      expect(new Set(brands).size, `seed ${s}`).toBe(brands.length);
    }
  });

  it('programs suit their lot family and size: kiosks in kiosk cells, food in food stalls, anchors in deep units; the always-programs appear', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      const shops = layout.mall!.shops;
      const n = (p: MallProgram) => shops.filter(q => q.program === p).length;
      for (const sh of shops) {
        const lot = MALL_LOTS[sh.lot!];
        expect(lotSuits(sh.lot, sh.program), `seed ${s} ${sh.id} ${sh.lot} -> ${sh.program}`).toBe(true);
        const d = MALL_PROGRAMS[sh.program];
        if (sh.program !== 'service' && sh.program !== 'vacant' && sh.program !== 'kiosk') {
          expect(sh.salesArea, `${sh.id} ${sh.program} area`).toBeGreaterThanOrEqual(d.min.area - 1e-6);
          expect(sh.depth, `${sh.id} ${sh.program} depth`).toBeGreaterThanOrEqual(d.min.depth - 1e-6);
        }
        if (sh.kind === 'kiosk') expect(lot.shape, sh.id).toBe('cell');
        if (sh.program === 'food-court') expect(lot.shape, sh.id).toBe('counter');
        if (sh.kind === 'anchor') expect(['deep', 'end']).toContain(lot.shape);
      }
      for (const p of MALL_ALWAYS) expect(n(p), `seed ${s} ${p}`).toBeGreaterThanOrEqual(1);
      expect(n('guns')).toBeLessThanOrEqual(2);
      expect(n('service'), `seed ${s} service rooms`).toBeGreaterThanOrEqual(1);
      expect(n('service')).toBeLessThanOrEqual(2);
      expect(n('vacant'), `seed ${s} vacant`).toBeLessThanOrEqual(Math.ceil(shops.length * 0.1));
      expect(shops.filter(q => q.kind === 'food').length, `seed ${s} food stalls`).toBeGreaterThanOrEqual(2);
    }
  });

  it('D04 rotation: deterministic per seed, a different curated subset per seed, the whole catalogue in use across a small sample', () => {
    const programs = new Set<string>(), models = new Set<string>();
    const featured: string[][] = [];
    for (const s of ROT_SEEDS) {
      const g = get(s);
      expect(g.rotation.length).toBe(MALL_ROTATION.length);
      expect(new Set(g.rotation)).toEqual(new Set(MALL_ROTATION));
      featured.push(g.featured);
      for (const sh of g.layout.mall!.shops) programs.add(sh.program);
      for (const p of g.layout.props) if (MALL_KIND_ASSET[p.kind as keyof typeof MALL_KIND_ASSET]) models.add(p.kind);
      console.info(`[rotation seed ${s}] ${g.rotation.join(' ')} | featured ${g.featured.join(' ')}`);
    }
    expect(dressed(3).rotation).toEqual(get(3).rotation); // deterministic
    expect(new Set(featured.map(f => f.join())).size, 'featured subsets differ across seeds').toBeGreaterThanOrEqual(ROT_SEEDS.length - 1);
    // not every program in one small mall ...
    for (const s of ROT_SEEDS) expect(new Set(get(s).layout.mall!.shops.map(q => q.program)).size).toBeLessThan(Object.keys(MALL_PROGRAMS).length);
    // ... but across the sample: every delivered model furnishes some shop / gallery, and most of the catalogue appears
    const missing = Object.keys(MALL_KIND_ASSET).filter(k => !models.has(k));
    expect(missing, 'delivered models never placed across the rotation sample').toEqual([]);
    expect(programs.size, `programs across the sample: ${[...programs].sort().join(' ')}`).toBeGreaterThanOrEqual(22);
  });

  it('census: stores vs kiosks vs service vs vacant, sales area / depth stats, stock rooms per lot policy', () => {
    const {layout} = get(1);
    const census = mallShopCensus(layout);
    expect(census.length).toBe(1);
    const c = census[0];
    expect(c.units).toBe(layout.mall!.shops.length);
    expect(c.units).toBeGreaterThanOrEqual(18);
    expect(c.stores + c.kiosks + c.service + c.vacant).toBe(c.units);
    expect(Object.values(c.byKind).reduce((a, b) => a + b, 0)).toBe(c.units);
    expect(c.salesArea.min).toBeLessThan(35); // compact / stall units exist
    expect(c.salesArea.max).toBeGreaterThan(220); // and an anchor
    expect(c.backrooms).toBe(layout.mall!.shops.filter(q => q.stock && q.stock !== 'none').length);
    for (const sh of layout.mall!.shops) if (MALL_LOTS[sh.lot!].stock === 'none') expect(sh.backroom, sh.id).toBeUndefined();
    console.info(`[census seed 1] ${JSON.stringify(census.map(q => ({stores: q.stores, kiosks: q.kiosks, service: q.service, vacant: q.vacant, byKind: q.byKind, area: q.salesArea, depth: q.depth, programs: q.programs})))}`);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = dressed(7), b = dressed(7), c = dressed(8);
    expect(a.layout.mall!.shops.map(s => [s.program, s.brand])).toEqual(b.layout.mall!.shops.map(s => [s.program, s.brand]));
    expect(a.layout.props).toEqual(b.layout.props);
    expect(a.layout.mall!.shops.map(s => s.program)).not.toEqual(c.layout.mall!.shops.map(s => s.program));
  });

  it('a lot-less unit (old synthetic rings) gets a family from its size and still dresses', () => {
    const {layout} = mallShopsFixture(1);
    assignMallPrograms(layout, new Rng(5));
    const rep = dressMallShops(layout, new Rng(6), {frame: 'absolute'});
    for (const sh of layout.mall!.shops) {
      const lot = inferLot(sh, sh.salesArea);
      expect(lotSuits(lot, sh.program), `${sh.id} ${lot} -> ${sh.program}`).toBe(true);
      if (sh.salesArea < 16) expect(lot).toBe('kiosk-cell');
    }
    expect(rep.filter(r => r.props > 0).length).toBeGreaterThan(rep.length * 0.8);
  });
});

describe('interiors: substantial, distinct, purposeful', () => {
  it('every real unit gets a dressed floor (fixtures per m²) and a stock room furnished to its size', () => {
    for (const s of SEEDS) {
      const {layout, reports} = get(s);
      for (const r of reports) {
        const sh = layout.mall!.shops.find(q => q.id === r.shop)!;
        if (sh.kind === 'vacant') continue;
        const minProps = sh.kind === 'kiosk' ? 1 : sh.kind === 'food' ? 2 : sh.salesArea >= 80 ? 8 : 4;
        expect(r.props, `seed ${s} ${sh.id} ${sh.lot} ${sh.program} (${sh.salesArea} m²)`).toBeGreaterThanOrEqual(minProps);
        expect(r.holders, `${sh.id} ${sh.program}`).toBeGreaterThanOrEqual(sh.kind === 'kiosk' || sh.kind === 'food' ? 1 : 3);
        if (sh.backroom !== undefined) expect(r.backProps, `${sh.id} back`).toBeGreaterThanOrEqual(layout.areas[sh.backroom].w * layout.areas[sh.backroom].h * CELL * CELL >= 6 ? 3 : 1);
      }
      const dens = reports.filter(r => layout.mall!.shops.find(q => q.id === r.shop)!.kind === 'store').map(r => r.density);
      expect(dens.reduce((a, b) => a + b, 0) / dens.length, `seed ${s} mean props / 10 m²`).toBeGreaterThan(1.2);
    }
  });

  it('focal merchandising on the entry axis; narrow boutiques keep the till at the far end; corner units open on both frontages', () => {
    let focal = 0, focalWanted = 0, narrow = 0, corners = 0;
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        const f = shopFit(sh)!, a = layout.areas[sh.area];
        const kinds = MALL_FOCAL[f.recipe];
        const side = frontageSide(a, sh), fs = side === 'N' || side === 'S' ? Math.min(sh.frontage.x0, sh.frontage.x1) : Math.min(sh.frontage.z0, sh.frontage.z1);
        const fr = frameOf(a, side, f.entry, fs);
        if (kinds && REAL(sh.kind) && sh.kind !== 'food') {
          focalWanted++;
          const end = MALL_LOTS[sh.lot!].shape === 'end';
          const [ax, az] = uvXZ(fr, end ? fr.W / 2 : (fr.entry[0] + fr.entry[1]) / 2, end ? Math.max(3.0, fr.D * 0.4) : Math.min(Math.max(2.6, fr.D * 0.3), Math.max(2.6, fr.D - 2.4)));
          if (layout.props.some(p => p.area === a.id && kinds.some(([k]) => k === p.kind) && Math.hypot(p.x - ax, p.z - az) < 1.8)) focal++;
        }
        if (MALL_LOTS[sh.lot!].shape === 'narrow-deep' && fr.D >= 8 && REAL(sh.kind)) {
          const till = layout.props.find(p => p.area === a.id && p.kind === 'shopCounter');
          if (till) { narrow++; expect(xzV(fr, till.x, till.z), `seed ${s} ${sh.id} ${sh.program} till depth`).toBeGreaterThan(fr.D * 0.5); }
        }
        if (sh.frontages?.length === 2 && f.entry2 && f.shutter !== 'closed') {
          corners++;
          for (const [fx, en] of [[sh.frontages[0], f.entry], [sh.frontages[1], f.entry2]] as const) {
            const s2 = {...sh, frontage: fx}, sd = frontageSide(a, s2);
            const fr2 = frameOf(a, sd, en, sd === 'N' || sd === 'S' ? Math.min(fx.x0, fx.x1) : Math.min(fx.z0, fx.z1));
            const g = layout.levels[a.level ?? 0].grid, [ex, ez] = uvXZ(fr2, (fr2.entry[0] + fr2.entry[1]) / 2, 0.75), [cx, cy] = g.cellOf(ex, ez);
            expect(g.walkable(cx, cy), `seed ${s} ${sh.id} corner entry ${sd}`).toBe(true);
          }
          expect(layout.props.filter(p => p.area === a.id && p.kind === 'shopGlazing').length, `${sh.id} glazing on both frontages`).toBeGreaterThanOrEqual(f.front === 'glazed' ? 3 : 0);
        }
      }
    }
    expect(focal / focalWanted, `focal displays placed ${focal} / ${focalWanted}`).toBeGreaterThan(0.75);
    expect(corners).toBeGreaterThan(0);
    console.info(`[focal] ${focal} / ${focalWanted}; narrow tills checked ${narrow}; corner units ${corners}`);
  });

  it('signature fixtures per program (gun counters + display benches + racks / lockers; dispensary; checkouts + aisles; kitchens)', () => {
    const SIG: Partial<Record<MallProgram, string[][]>> = {
      guns: [['glassCounter'], ['gunDisplay'], ['shelf', 'gunLocker', 'gunRack']],
      pharmacy: [['shopCounter'], ['medCabinet', 'glassCounter', 'pharmacyDispensaryCounter', 'medicineDrawerCabinet']],
      electronics: [['deviceWall', 'techDisplay', 'tvWall']],
      hardware: [['stockShelf', 'shelf']],
      clothing: [['wallBay', 'clothingWallUnit'], ['shopCounter', 'mannequinFull']],
      womenswear: [['clothingWallUnit', 'garmentRail', 'garmentRailRound'], ['mannequinFemale'], ['shopCounter', 'glassCounter']], // (R4)
      grocery: [['shopCounter', 'checkoutLane'], ['stockShelf', 'retailGondola'], ['shopCooler', 'produceStand']],
      'food-court': [['shopCounter', 'shopDisplay'], ['grillLine', 'pizzaOven', 'wokLine', 'deliLine', 'blenderBar', 'espressoBar', 'shopBackbar', 'fridge', 'snackRack']],
      cafe: [['shopCounter', 'shopDisplay', 'bakeryCase']],
    };
    let checked = 0;
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        const sig = SIG[sh.program];
        if (!sig || sh.kind === 'kiosk') continue;
        const kinds = new Set(layout.props.filter(p => p.area === sh.area).map(p => p.kind as string));
        for (const any of sig) expect(any.some(k => kinds.has(k)), `seed ${s} ${sh.id} ${sh.program}: one of ${any} (has ${[...kinds]})`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('programs read differently: their fixture sets overlap little', () => {
    const sets = new Map<string, Set<string>>();
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        if (sh.kind !== 'store' && sh.kind !== 'anchor') continue;
        const k = new Set(layout.props.filter(p => p.area === sh.area && !['shopGlazing', 'shopShutter', 'cashRegister', 'bin'].includes(p.kind)).map(p => p.kind as string));
        const prev = sets.get(sh.program);
        sets.set(sh.program, prev ? new Set([...prev, ...k]) : k);
      }
    }
    const progs = [...sets.keys()];
    let pairs = 0, similar = 0;
    for (let i = 0; i < progs.length; i++) for (let j = i + 1; j < progs.length; j++) {
      const a = sets.get(progs[i])!, b = sets.get(progs[j])!;
      const inter = [...a].filter(x => b.has(x)).length, uni = new Set([...a, ...b]).size;
      pairs++;
      if (uni && inter / uni > 0.6) similar++;
    }
    expect(progs.length).toBeGreaterThan(8);
    expect(similar / pairs).toBeLessThan(0.1);
  });
});

/** Frame depth v of a world point (shopsDress xzUV's v). */
function xzV(fr: ReturnType<typeof frameOf>, x: number, z: number): number {
  switch (fr.side) {
    case 'N': return z - fr.z0;
    case 'S': return fr.z1 - z;
    case 'W': return x - fr.x0;
    default: return fr.x1 - x;
  }
}

describe('circulation: frontages, entries, doors, reachability', () => {
  it('nothing stands in the shopfront entry span; every shop stays connected; every holder is reachable from its entry', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        const a = layout.areas[sh.area], f = shopFit(sh)!;
        const lv = a.level ?? 0, g = layout.levels[lv].grid;
        const side = frontageSide(a, sh);
        const fs = side === 'N' || side === 'S' ? Math.min(sh.frontage.x0, sh.frontage.x1) : Math.min(sh.frontage.z0, sh.frontage.z1);
        const fr = frameOf(a, side, f.entry, fs);
        // entry span: the first metre behind the frontage is free of floor props (glazing / shutters sit outside the span)
        const [ex, ez] = uvXZ(fr, (fr.entry[0] + fr.entry[1]) / 2, 0.75);
        const [cx, cy] = g.cellOf(ex, ez);
        if (f.shutter !== 'closed') expect(g.walkable(cx, cy), `seed ${s} ${sh.id} entry cell`).toBe(true);
        if (f.shutter === 'closed') continue;
        const dist = g.distanceField(cx, cy);
        for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
          const i = g.idx(x, y);
          if (g.area[i] === a.id && g.cells[i] === FLOOR && !g.blocked[i]) expect(dist[i], `seed ${s} ${sh.id} cell ${x},${y} unreachable`).toBeGreaterThanOrEqual(0);
        }
        // holders: a reachable cell touches the holder's footprint
        for (const p of layout.props.filter(q => q.area === a.id && isLootHolderKind(q.kind) && !q.mounted && q.host === undefined)) {
          const [x0, y0] = g.cellOf(p.x - p.hx, p.z - p.hz), [x1, y1] = g.cellOf(p.x + p.hx - 1e-3, p.z + p.hz - 1e-3);
          let ok = false;
          for (let y = y0 - 1; y <= y1 + 1 && !ok; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (g.inBounds(x, y) && dist[g.idx(x, y)] >= 0) { ok = true; break; }
          expect(ok, `seed ${s} ${sh.id} holder ${p.kind} unreachable`).toBe(true);
        }
      }
    }
  });

  it('door cells (frontage piers aside, staff doors, service doors) are never blocked by a prop', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const d of layout.doors) {
        if (d.shopfront) continue; // the glazing deliberately closes the frontage outside its entry span
        const g = layout.levels[d.level ?? 0].grid;
        for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) expect(g.blocked[g.idx(x, y)], `seed ${s} door ${d.id}`).toBe(0);
      }
      // glazing never covers the whole frontage of an open shop
      for (const sh of layout.mall!.shops) {
        const f = shopFit(sh)!;
        if (f.shutter === 'closed') continue;
        for (const fd of layout.doors.filter(d => d.shopfront && d.b === sh.area)) {
          const g = layout.levels[fd.level ?? 0].grid;
          let open = 0;
          for (let y = fd.y; y < fd.y + fd.h; y++) for (let x = fd.x; x < fd.x + fd.w; x++) if (!g.blocked[g.idx(x, y)]) open++;
          expect(open * CELL, `seed ${s} ${sh.id} open frontage`).toBeGreaterThanOrEqual(Math.min(2.4, Math.max(fd.w, fd.h) * CELL));
        }
      }
    }
  });

  it('closed shutters only on units with a second way in', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        if (shopFit(sh)!.shutter !== 'closed') continue;
        expect(sh.backroom, sh.id).toBeDefined();
        expect(layout.doors.some(d => (d.a === sh.backroom || d.b === sh.backroom) && d.a !== sh.area && d.b !== sh.area)).toBe(true);
      }
    }
  });
});

describe('mall prop kinds: classified, holders with surfaces, no baked clutter', () => {
  it('every mall kind appears once in OPENABLE_AUDIT and in PROP_PHYSICS_AUDIT, in step with the live physics', () => {
    for (const k of MALL_KINDS) {
      const rows = OPENABLE_AUDIT.filter(e => e.kind === k);
      expect(rows.length, k).toBe(1);
      expect(rows[0].cls).toBe(MALL_OPEN_AUDIT[k].cls);
      if (MALL_OPEN_AUDIT[k].role === 'storage') expect(['openable', 'exception']).toContain(rows[0].cls);
      const ph = PROP_PHYSICS_AUDIT[k];
      expect(ph, k).toBeDefined();
      expect(ph.cls, k).toBe(MALL_PHYS[k].dynamic ? 'dynamic' : 'static');
      expect(dynamicKind(k), k).toBe(MALL_PHYS[k].dynamic);
      expect(PROP_DEFS[k].w * PROP_DEFS[k].d * PROP_DEFS[k].h, k).toBeGreaterThan(0);
    }
  });

  it('the delivered bookcase (lane ASSETS M09) is an openable container: 2 derived base drawers + its open shelves', () => {
    const spec = openableSpec('bookstoreBookcase')!;
    expect(spec.model).toBe('office-bookstore-bookcase');
    expect(spec.parts.length).toBe(2);
    expect(OPENABLE_CONTAINER_KINDS as readonly string[]).toContain('bookstoreBookcase');
    const surf = holderSurfaces('bookstoreBookcase', PROP_DEFS.bookstoreBookcase);
    expect(surf.filter(q => q.part === undefined).length).toBe(4);
    expect(surf.filter(q => q.part !== undefined).length).toBe(2);
    expect(MALL_OPEN_AUDIT.bookstoreBookcase.cls).toBe('openable');
  });

  it('holder kinds: slot, defaults, surfaces inside the footprint and under the top, open (not storage)', () => {
    for (const k of MALL_HOLDER_KINDS) {
      expect(isLootHolderKind(k), k).toBe(true);
      expect(HOLDER_SLOTS[k], k).toBeTruthy();
      expect(MALL_OPEN_AUDIT[k].cls, k).toBe('open');
      const def = PROP_DEFS[k];
      const surf = holderSurfaces(k, def);
      expect(surf.length, k).toBe(MALL_SURFACES[k].length);
      for (const s of surf) {
        expect(s.x0).toBeGreaterThanOrEqual(-def.w / 2);
        expect(s.x1).toBeLessThanOrEqual(def.w / 2);
        expect(s.z0).toBeGreaterThanOrEqual(-def.d / 2);
        expect(s.z1).toBeLessThanOrEqual(def.d / 2);
        expect(s.y).toBeLessThanOrEqual(def.h + 0.01);
        expect(s.clear).toBeGreaterThan(0.1);
      }
      expect(isMallHolderKind(k)).toBe(true);
    }
    expect(HOLDER_ALLOW.produceStand).toEqual(['food', 'drink']);
  });

  it('shops place only classified kinds; reused kinds with display goods are the recorded exceptions; loose items are loot', () => {
    // reused catalogue kinds whose display goods are part of the fixture (never items): recorded with their reason
    const DISPLAY_GOODS: Record<string, string> = {
      deviceWall: 'tethered demo devices on the wall unit (existing purpose prop)', techDisplay: 'tethered demo devices (existing purpose prop)',
      showcase: 'demo devices inside the glazed showcase (existing purpose prop)', flowerStand: 'flowers are shelf-stock filler (decor)', aquarium: 'fish tank decor (existing)',
    };
    const seen = new Set<string>();
    for (const s of SEEDS) for (const p of get(s).layout.props) seen.add(p.kind);
    for (const k of seen) {
      expect(OPENABLE_AUDIT.some(e => e.kind === k), `${k} openables audit`).toBe(true);
      expect(PROP_PHYSICS_AUDIT[k], `${k} physics audit`).toBeDefined();
    }
    for (const k of Object.keys(DISPLAY_GOODS)) if (seen.has(k)) expect(OPENABLE_AUDIT.find(e => e.kind === k)!.how.length).toBeGreaterThan(8);
    // rule 4: the office kinds with BAKED loose stock (garments / sneakers / books) never furnish a mall shop — the empty garmentRail /
    // wallBay / bookstoreBookcase do (lane ASSETS' rule-4 replacements swap in as models)
    for (const k of ['clothingRack', 'sneakerWall', 'lawBookcase']) expect(seen.has(k), `${k} (baked stock) placed`).toBe(false);
    // separated decor rides a real host: garment groups hang on garment rails, TVs stand on display tables (lane ASSETS M06 / M10)
    for (const s of SEEDS) {
      const props = get(s).layout.props;
      for (const p of props.filter(q => q.kind === 'garmentHangingGroup')) expect(['garmentRail', 'garmentRailRound', 'clothingWallUnit']).toContain(props[p.host!]?.kind);
      for (const p of props.filter(q => q.kind === 'flatScreenTv')) expect(props[p.host!]?.kind).toBe('merchTable');
      for (const p of props.filter(q => q.kind === 'cashRegister')) expect(['shopCounter', 'checkoutLane']).toContain(props[p.host!]?.kind);
    }
    console.info(`[kinds placed] ${[...seen].sort().join(', ')}`);
  });
});

// ---------------------------------------------------------------------------------------------
// Lane ASSETS batch 1 integration (recovery-02): every delivered model renders its kind at its measured size, is classified, and
// furnishes the shops / gallery commons with the prop rules (openables measured, themed finite loot, door strips, no baked clutter).

/** The batch-1 kinds that render a delivered model (lanes/ASSETS.notes section 10). */
const BATCH1 = ['mallCashwrapCounter', 'glassDisplayCabinet', 'retailGondola', 'clothingWallUnit', 'pharmacyDispensaryCounter', 'checkoutLane', 'produceStand', 'gunRack',
  'glassCounter', 'outdoorsPlankShelving', 'mallKioskCart', 'storageTote', 'shoeWallDisplay', 'foodCourtTableSet'] as const;
/** The batch-2 kinds that render a delivered model (lanes/ASSETS.notes section 12; M35 / M45 / M47 and the rest not delivered). */
const BATCH2 = ['ottoman', 'tentDisplay', 'tvWall', 'kiddieRide', 'salonChair', 'displayBed', 'medicineDrawerCabinet',
  // batch 2 resume + 2R (lanes/ASSETS.notes 12c; the info desk M40 was not delivered)
  'gunSafeTall', 'dresserDrawers', 'cardboardBoxFlaps', 'multideckOpenCooler', 'cosmeticsWallUnit', 'mallBench', 'cafeBistroTable', 'cafeChair'] as const;

describe('lane ASSETS batch 1: measured models, openables, audits', () => {
  it('every batch-1 / batch-2 kind renders its delivered model: footprint / height = the measured runtime GLB (collider = visual)', () => {
    for (const k of [...BATCH1, ...BATCH2]) {
      const id = MALL_KIND_ASSET[k];
      expect(id, k).toBeTruthy();
      const dims = MALL_DIMS[id!];
      expect(dims, `${k} ${id} delivered`).toBeDefined();
      const def = PROP_DEFS[k];
      expect(def.w, k).toBeCloseTo(dims[0], 2);
      expect(def.h, k).toBeCloseTo(dims[1], 2);
      expect(def.d, k).toBeCloseTo(dims[2], 2);
    }
  });

  it('the four storage fixtures open (rule 1): measured drawers / doors, own themed finite tables, surfaces inside the box', () => {
    // (batch 2 M29: 33 small drawers + the top cupboard + the full-height door)
    // (M18 storage tote: its one lid, once lane ASSETS closed it)
    const PARTS: Record<string, number> = {mallCashwrapCounter: 6, glassDisplayCabinet: 2, pharmacyDispensaryCounter: 10, mallKioskCart: 2, medicineDrawerCabinet: 35, storageTote: 1,
      gunSafeTall: 1, dresserDrawers: 4, cardboardBoxFlaps: 2}; // (12c: the safe door, the dresser's 2 x 2 drawers, the carton's two flaps)
    for (const [k, n] of Object.entries(PARTS)) {
      const spec = openableSpec(k as never)!;
      expect(spec, k).toBeDefined();
      expect(spec.model, k).toBe(`office-${MALL_KIND_ASSET[k as keyof typeof MALL_KIND_ASSET]}`);
      expect(spec.parts.length, k).toBe(n);
      expect(OPENABLE_CONTAINER_KINDS as readonly string[], k).toContain(k);
      expect(MALL_OPEN_AUDIT[k as keyof typeof MALL_OPEN_AUDIT]).toMatchObject({role: 'storage', cls: 'openable'});
      expect(isLootHolderKind(k), k).toBe(true);
      expect(HOLDER_SLOTS[k as keyof typeof HOLDER_SLOTS], k).toBeTruthy();
      expect((OPENABLE_TABLES as Record<string, unknown>)[k], k).toBeTruthy();
      const def = PROP_DEFS[k as keyof typeof PROP_DEFS];
      const surf = holderSurfaces(k as never, def);
      expect(surf.filter(q => q.part !== undefined).length, `${k}: every compartment has a floor`).toBeGreaterThanOrEqual(n);
      for (const q of surf) {
        expect(q.x0, k).toBeGreaterThanOrEqual(-def.w / 2 - 1e-6);
        expect(q.x1, k).toBeLessThanOrEqual(def.w / 2 + 1e-6);
        expect(q.z0, k).toBeGreaterThanOrEqual(-def.d / 2 - 1e-6);
        expect(q.z1, k).toBeLessThanOrEqual(def.d / 2 + 1e-6);
        expect(q.y, k).toBeLessThanOrEqual(def.h);
      }
      expect(MALL_PHYS[k as keyof typeof MALL_PHYS].dynamic, k).toBe(k === 'storageTote' || k === 'cardboardBoxFlaps');
      expect(!!openableSpec(k as never)!.spill, `${k} spills iff it moves`).toBe(k === 'storageTote' || k === 'cardboardBoxFlaps');
    }
    // contents themed to the container: the dispensary holds medicine, whatever shop it stands in
    const cats: Record<string, number> = {};
    for (let i = 0; i < 300; i++) for (const e of rollLootItems(20261031, i, 'pharmacyDispensaryCounter' as never, 'mall-pharmacy')) { const c = econCat(e.itemId) ?? e.itemId; cats[c] = (cats[c] ?? 0) + e.count; }
    expect((cats.med ?? 0) / Object.values(cats).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
    // ... and so does the medicine drawer cabinet (container-themed), even in a clinic / first-aid room
    const mc: Record<string, number> = {};
    for (let i = 0; i < 300; i++) for (const e of rollLootItems(20261031, i, 'medicineDrawerCabinet' as never, 'mall-first-aid')) { const c = econCat(e.itemId) ?? e.itemId; mc[c] = (mc[c] ?? 0) + e.count; }
    expect((mc.med ?? 0) / Object.values(mc).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
    // the medicine cabinet's drawers: 3 x 11 grid, no two fronts overlap, each a real tray floor
    const med = openableSpec('medicineDrawerCabinet')!;
    const fronts = med.parts.filter(q => q.move.type === 'slide').map(q => q.region![0]);
    expect(fronts.length).toBe(33);
    for (let i = 0; i < fronts.length; i++) for (let j = i + 1; j < fronts.length; j++) {
      const a = fronts[i], b = fronts[j];
      expect(a[0] < b[3] - 1e-6 && b[0] < a[3] - 1e-6 && a[1] < b[4] - 1e-6 && b[1] < a[4] - 1e-6, `drawers ${i} / ${j} overlap`).toBe(false);
    }
  });

  it('exceptions are explicit: the open bays / stands / lanes are open holders, the gun rack empty decor; the tote a lidded spill box', () => {
    // M18 tote (lid closed locally by lane ASSETS): an openable lidded container that moves (rules 1-2) — a light dynamic SPILL holder
    // (knocked loose, its finite lots spill once: nothing floats / duplicates), its lid hinged on the back edge, room-themed own table
    expect(MALL_OPEN_AUDIT.storageTote).toMatchObject({role: 'storage', cls: 'openable'});
    const tote = openableSpec('storageTote')!;
    expect(tote.spill).toBe(true);
    expect(tote.parts[0].move).toMatchObject({type: 'hinge', axis: 'x'});
    expect((tote.parts[0].move as {pivot: readonly number[]}).pivot[2]).toBeLessThan(0);
    expect(MALL_PHYS.storageTote).toMatchObject({dynamic: true, mat: 'pad'});
    expect((MALL_PHYS.storageTote as {mass: number}).mass).toBeGreaterThanOrEqual(2);
    expect((MALL_PHYS.storageTote as {mass: number}).mass).toBeLessThanOrEqual(8);
    expect(dynamicKind('storageTote')).toBe(true);
    expect(MALL_SURFACES.storageTote).toEqual([]);
    expect(holderTable('storageTote', 'mall-guns-back').source).toBe('own');
    // 12c: the gun safe holds ammo / gun-care by the deliberate rule (never a gun item); the carton is a light spill box; the café
    // furniture moves and carries no loot (a moving holder would float its lots); the bench is bolted down; the multideck is open
    const safe: Record<string, number> = {};
    for (let i = 0; i < 300; i++) for (const e of rollLootItems(20261031, i, 'gunSafeTall' as never, 'mall-guns-back')) { const c = econCat(e.itemId) ?? e.itemId; safe[c] = (safe[c] ?? 0) + e.count; }
    expect(safe.ammo ?? 0).toBeGreaterThan(0);
    expect(Object.keys(safe).every(c => ['ammo', 'flare', 'battery'].includes(c)), JSON.stringify(safe)).toBe(true);
    expect(MALL_PHYS.cardboardBoxFlaps).toMatchObject({dynamic: true, mat: 'pad'});
    for (const k of ['cafeBistroTable', 'cafeChair'] as const) {
      expect(dynamicKind(k), k).toBe(true);
      expect(isLootHolderKind(k), `${k} carries no loot`).toBe(false);
      expect(MALL_OPEN_AUDIT[k].cls).toBe('none');
    }
    expect((MALL_PHYS.cafeBistroTable as {mass: number}).mass).toBeGreaterThan((MALL_PHYS.cafeChair as {mass: number}).mass);
    expect(MALL_PHYS.mallBench).toMatchObject({dynamic: false, why: 'anchored'});
    expect(HOLDER_ALLOW.multideckOpenCooler).toEqual(['food', 'drink']);
    for (const k of ['clothingWallUnit', 'retailGondola', 'checkoutLane', 'produceStand', 'glassCounter', 'outdoorsPlankShelving', 'shoeWallDisplay', 'foodCourtTableSet'] as const) {
      expect(MALL_OPEN_AUDIT[k].cls, k).toBe('open');
      expect(MALL_SURFACES[k].length, k).toBeGreaterThan(0);
    }
    expect(MALL_OPEN_AUDIT.gunRack).toMatchObject({role: 'decor', cls: 'none'});
    expect(MALL_PHYS.gunRack.dynamic).toBe(false);
    expect(MALL_PHYS.foodCourtTableSet.dynamic).toBe(false);
  });
});

describe('lane ASSETS batch 1: placement in the shops and the gallery commons', () => {
  it('every batch-1 / batch-2 kind furnishes the synthetic lot storeys; racks stand on the floor; garments ride the rails; tills ride the lanes', () => {
    const seen = new Map<string, number>();
    for (const s of ROT_SEEDS) {
      const {layout} = get(s);
      const props = layout.props;
      for (const p of props) seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
      const floorOf = (p: (typeof props)[number]) => layout.areas[p.area].floorY ?? 0;
      for (const p of props.filter(q => q.kind === 'gunRack' || q.kind === 'tvWall')) { expect(p.mounted, `${p.kind} floor-standing`).toBeFalsy(); expect(p.y).toBeCloseTo(floorOf(p), 3); }
      for (const p of props.filter(q => q.kind === 'garmentHangingGroup')) {
        const h = props[p.host!];
        expect(p.y + PROP_DEFS.garmentHangingGroup.h, `${h.kind} rail`).toBeCloseTo(h.y + GARMENT_RAIL_Y[h.kind as keyof typeof GARMENT_RAIL_Y]!, 2);
      }
      for (const p of props.filter(q => q.kind === 'cashRegister' && props[q.host!].kind === 'checkoutLane')) expect(p.y).toBeCloseTo(props[p.host!].y + 0.89, 3);
      // totes stand in stock rooms only; kiosk carts / table sets outside the shops stand in the galleries
      for (const p of props.filter(q => q.kind === 'storageTote')) expect(layout.areas[p.area].type).toBe('stock-room');
      const gal = new Set(layout.mall!.galleries.flatMap(g => g.areas));
      const shopAreas = new Set(layout.mall!.shops.flatMap(q => [q.area, ...(q.backroom !== undefined ? [q.backroom] : [])]));
      for (const p of props.filter(q => q.kind === 'mallKioskCart')) expect(gal.has(p.area), 'kiosk cart in a gallery').toBe(true);
      for (const p of props.filter(q => q.kind === 'foodCourtTableSet')) expect(gal.has(p.area) || shopAreas.has(p.area)).toBe(true);
    }
    console.info(`[batch-1 kinds placed] ${BATCH1.map(k => `${k} ${seen.get(k) ?? 0}`).join(', ')}`);
    console.info(`[batch-2 kinds placed] ${BATCH2.map(k => `${k} ${seen.get(k) ?? 0}`).join(', ')}`);
    // (mall revision: across the rotation sample every delivered model is placed — the catalogue rotates, nothing is orphaned)
    for (const k of [...BATCH1, ...BATCH2]) expect(seen.get(k) ?? 0, `${k} placed`).toBeGreaterThan(0);
    expect(seen.get('mallCashwrapCounter') ?? 0, 'back counters behind the wraps').toBeGreaterThanOrEqual(6);
  });

  it('gallery commons: one kiosk cart per ring at most, food-hall seating only on the food ring, clear rings of walkable gallery floor', () => {
    for (const s of SEEDS) {
      const {layout} = dressed(s);
      const rejects = MALL_COMMONS_STATS.last?.rejects ?? {};
      const m = layout.mall!;
      for (const gl of m.galleries) {
        const g = layout.levels[gl.level].grid, gal = new Set(gl.areas);
        const on = (k: string) => layout.props.filter(p => p.kind === k && gal.has(p.area));
        const kiosks = on('mallKioskCart'), seats = on('foodCourtTableSet'), benches = on('mallBench');
        expect(kiosks.length, `seed ${s} ring ${gl.level} kiosks`).toBeLessThanOrEqual(COMMONS.kiosk.perRing);
        expect(benches.length, `seed ${s} ring ${gl.level} benches`).toBeLessThanOrEqual(COMMONS.bench.perRing);
        for (let i = 0; i < benches.length; i++) for (let j = i + 1; j < benches.length; j++) expect(Math.hypot(benches[i].x - benches[j].x, benches[i].z - benches[j].z)).toBeGreaterThanOrEqual(COMMONS.bench.gap - 1e-6);
        const food = m.shops.some(q => q.level === gl.level && q.kind === 'food');
        if (!food) expect(seats.length).toBe(0); else expect(seats.length).toBeLessThanOrEqual(COMMONS.seat.max);
        for (const [p, ring] of [...kiosks.map(q => [q, COMMONS.kiosk.ring] as const), ...seats.map(q => [q, COMMONS.seat.ring] as const), ...benches.map(q => [q, COMMONS.bench.ring] as const)]) {
          const rc = Math.ceil(ring / CELL - 1e-6);
          const [x0, y0] = g.cellOf(p.x - p.hx + 0.04, p.z - p.hz + 0.04), [x1, y1] = g.cellOf(p.x + p.hx - 0.04, p.z + p.hz - 0.04);
          for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) {
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
            const i = g.idx(cx, cy);
            expect(gal.has(g.area[i]) && g.cells[i] === FLOOR && !g.blocked[i], `seed ${s} ${p.kind} ring cell ${cx},${cy}`).toBe(true);
          }
        }
        for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) expect(Math.hypot(seats[i].x - seats[j].x, seats[i].z - seats[j].z)).toBeGreaterThanOrEqual(COMMONS.seat.gap - 1e-6);
      }
      const n = (k: string) => layout.props.filter(p => p.kind === k && m.galleries.some(gl => gl.areas.includes(p.area))).length;
      console.info(`[commons seed ${s}] kiosks ${n('mallKioskCart')} seats ${n('foodCourtTableSet')} rejects ${JSON.stringify(rejects)}`);
      expect(n('mallKioskCart'), `seed ${s} kiosks`).toBeGreaterThan(0);
      expect(n('foodCourtTableSet'), `seed ${s} food-hall seats`).toBeGreaterThan(0);
    }
  });
});

describe('loot hooks: themed, finite', () => {
  const cats = (purpose: string, kind: string, n = 400) => {
    const out: Record<string, number> = {};
    for (let i = 0; i < n; i++) for (const e of rollLootItems(20261031, i, kind as never, purpose)) { const c = econCat(e.itemId) ?? e.itemId; out[c] = (out[c] ?? 0) + e.count; }
    return out;
  };
  it('gun shops: ammo (generic calibres) on counters / shelving / lockers; pharmacy: medicine; grocery: food; electronics: torch cells', () => {
    const g = cats('mall-guns', 'shelf');
    expect(g.ammo ?? 0).toBeGreaterThan(0);
    expect(Object.keys(g).every(c => ['ammo', 'flare', 'battery', 'food', 'drink', 'med'].includes(c))).toBe(true);
    expect(cats('mall-guns', 'glassCounter').ammo ?? 0).toBeGreaterThan(0);
    expect(cats('mall-guns', 'gunLocker').ammo ?? 0).toBeGreaterThan(0);
    const ph = cats('mall-pharmacy', 'stockShelf');
    expect((ph.med ?? 0) / Object.values(ph).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
    const gr = cats('mall-grocery', 'stockShelf');
    expect(((gr.food ?? 0) + (gr.drink ?? 0)) / Object.values(gr).reduce((a, b) => a + b, 0)).toBeGreaterThan(0.6);
    expect(cats('mall-electronics', 'wallBay').battery ?? 0).toBeGreaterThan(0);
    // holder tables resolve from the mall purposes (no legacy fallback in a shop)
    for (const [p, k] of [['mall-guns', 'glassCounter'], ['mall-clothing', 'merchTable'], ['mall-grocery', 'produceStand'], ['mall-pharmacy', 'medCabinet']] as const) {
      expect(holderTable(k, p).source, `${p} ${k}`).toBe('purpose');
    }
    // no gear / weapon rows in any mall table (rare gear stays one roll per level; weapons are the plan's explicit finds)
    for (const P of Object.values(ROOM_PURPOSES).filter(q => q.id.startsWith('mall-'))) {
      for (const spec of Object.values(P.loot)) for (const [id] of spec!.items) expect(econCat(id), `${P.id} ${id}`).not.toBeNull();
    }
  });
});

describe('weapon plan: per gun shop, loadout-free, accessible, matching ammo, persisted as layout pickups', () => {
  // Task mall-playtest-revision-20261031 (lane SHOPS, U11): the old mall-wide "every non-start gun 1-2 times" quota is gone; the
  // per-gun-shop distribution / independence / runtime cases are tests/mall-gunshop.test.ts. Here: the dressed synthetic rings.
  it('every gun shop gets its own seeded stock (0-2, never filtered by the start weapon) on its display benches with its own calibre', () => {
    let twoShops = 0;
    for (const s of SEEDS) {
      const {layout} = dressed(s);
      const before = layout.pickups.length;
      const rep = placeMallWeapons(layout, 1000 + s);
      const guns = layout.mall!.shops.filter(q => q.program === 'guns');
      if (guns.length > 1) twoShops++;
      expect(rep.plan).toEqual(mallWeaponPlan(1000 + s, layout.mall!.shops));
      expect(rep.shops.map(q => q.shop).sort()).toEqual(guns.map(g => g.id).sort().slice(0, 2));
      const placed = layout.pickups.slice(before);
      const weapons = placed.filter(p => (MALL_FIND_WEAPONS as readonly string[]).includes(p.itemId));
      expect(weapons.length, `seed ${s}`).toBe(rep.finds.length);
      expect(rep.missed, `seed ${s}`).toEqual([]);
      for (const f of rep.finds) {
        expect(guns.some(g => g.id === f.shop), `seed ${s} ${f.weapon} in ${f.shop}`).toBe(true);
        expect(f.on, `seed ${s} ${f.weapon}`).not.toBe('floor');
        const [gi, ai] = f.pickups;
        expect(layout.pickups[ai].itemId).toBe(WEAPON_FIND_AMMO[layout.pickups[gi].itemId][0]);
        expect(layout.pickups[ai].count).toBe(WEAPON_FIND_AMMO[layout.pickups[gi].itemId][1]);
        expect(layout.pickups[gi].y).toBeGreaterThanOrEqual(layout.areas[f.area].floorY ?? 0);
      }
      // the same seed re-places exactly the same pickups (persistence by layout pickup index), whatever the start weapon
      const again = dressed(s);
      placeMallWeapons(again.layout, 1000 + s, 'rifle');
      expect(again.layout.pickups).toEqual(layout.pickups);
    }
    console.info(`[weapons] seeds with 2 gun shops: ${twoShops}`);
  });

  it('QA / gear hooks: a stand pose into each program, gear spots in the outfitting shops', () => {
    const {layout} = get(1);
    const pose = mallShopPose(layout, 'guns');
    expect(pose).not.toBeNull();
    const a = layout.areas[layout.mall!.shops.find(q => q.id === pose!.shop)!.area];
    const g = layout.levels[pose!.level].grid;
    const [cx, cy] = g.cellOf(pose!.x, pose!.z);
    expect(g.area[g.idx(cx, cy)]).toBe(a.id);
    expect(mallGearSpots(layout).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Task mall-round3-20261031 (lane SHOPS, R4 — user: "no female clothing store ... which would normally always be in a mall! Lets get
// that in, Make sure to make a female maniqune. This asset will be handy in other spots, because it will be spooooky!").

describe('R4 womenswear store + the reusable female mannequin', () => {
  const inArea = (L: StationLayout, area: number, kind: string) => L.props.filter(p => p.area === area && p.kind === kind);
  it('every mall has a women\'s fashion store (the always set, several lot families), with its own brand pool / purposes / finishes / sign', () => {
    expect(MALL_ALWAYS).toContain('womenswear');
    const fams = (Object.values(MALL_LOTS) as (typeof MALL_LOTS)[keyof typeof MALL_LOTS][]).filter(f => f.programs.includes('womenswear')).map(f => f.id);
    expect(fams.length, fams.join()).toBeGreaterThanOrEqual(5);
    const d = MALL_PROGRAMS.womenswear, c = MALL_PROGRAMS.clothing;
    expect(d.purpose).toBe('mall-womenswear');
    expect(purposeById('mall-womenswear')).toBeDefined();
    expect(purposeById('mall-womenswear-back')).toBeDefined();
    expect(d.brands.filter(b => c.brands.includes(b))).toEqual([]);
    for (const k of [0, 1] as const) expect(d.finishes[k]).not.toEqual(c.finishes[k]);
    expect(d.sign).not.toEqual(c.sign);
    let n = 0;
    for (const s of ROT_SEEDS) {
      const L = get(s).layout, ws = L.mall!.shops.filter(q => q.program === 'womenswear');
      expect(ws.length, `seed ${s} womenswear stores`).toBeGreaterThanOrEqual(1);
      for (const q of ws) {
        n++;
        expect(L.areas[q.area].purpose).toBe('mall-womenswear');
        expect(L.areas[q.area].label.startsWith(q.brand)).toBe(true);
        expect(lotSuits(q.lot, 'womenswear')).toBe(true);
      }
    }
    expect(n).toBeGreaterThanOrEqual(ROT_SEEDS.length);
  });

  it('womenswear interiors: female mannequins (window + floor, never the M07 figure), dress bays / rails, fitting rooms, accessories; distinct from the clothing store', () => {
    let stores = 0, window = 0;
    const kindsOf = (p: MallProgram) => {
      const out = new Set<string>();
      for (const s of SEEDS) {
        const L = get(s).layout;
        for (const q of L.mall!.shops.filter(x => x.program === p && x.kind !== 'kiosk')) for (const pr of L.props) if (pr.area === q.area && !['shopGlazing', 'shopShutter', 'cashRegister', 'bin'].includes(pr.kind)) out.add(pr.kind);
      }
      return out;
    };
    for (const s of ROT_SEEDS) {
      const L = get(s).layout;
      for (const q of L.mall!.shops.filter(x => x.program === 'womenswear')) {
        stores++;
        const a = L.areas[q.area], f = shopFit(q)!;
        const fem = inArea(L, a.id, 'mannequinFemale');
        expect(fem.length, `seed ${s} ${q.id} female mannequins`).toBeGreaterThanOrEqual(1);
        expect(inArea(L, a.id, 'mannequinFull').length, `${q.id} no M07 figure`).toBe(0);
        const kinds = new Set(L.props.filter(p => p.area === a.id).map(p => p.kind as string));
        for (const any of [['clothingWallUnit', 'garmentRail', 'garmentRailRound'], ['shopCounter', 'glassCounter']]) expect(any.some(k => kinds.has(k)), `seed ${s} ${q.id} one of ${any}`).toBe(true);
        const side = frontageSide(a, q), fs = side === 'N' || side === 'S' ? Math.min(q.frontage.x0, q.frontage.x1) : Math.min(q.frontage.z0, q.frontage.z1);
        const fr = frameOf(a, side, f.entry, fs);
        if (fem.some(p => xzV(fr, p.x, p.z) < 1.8 && Math.abs(Math.cos(p.rot - fr.face)) > 0.99)) window++;
        // rule 4: nothing rides a mannequin (no clothing / loot hung on it)
        for (const m of fem) expect(L.props.some(p => p.host === L.props.indexOf(m)), `${q.id} something hosted on a mannequin`).toBe(false);
      }
    }
    expect(window / stores, `window displays ${window} / ${stores}`).toBeGreaterThan(0.6);
    const w = kindsOf('womenswear'), c = kindsOf('clothing');
    const inter = [...w].filter(k => c.has(k)).length, uni = new Set([...w, ...c]).size;
    console.info(`[R4 womenswear] stores ${stores}, window ${window}; kinds ${[...w].sort().join(' ')}; jaccard vs clothing ${(inter / uni).toFixed(2)}`);
    expect(inter / uni, 'womenswear reads differently from the clothing store').toBeLessThan(0.6);
  });

  it('female mannequins elsewhere are bounded spooky extras: back rooms / vacant units / the department floor, standing on the floor, nothing hung on them', () => {
    let extras = 0;
    for (const s of ROT_SEEDS) {
      const L = get(s).layout;
      const prog = new Map<number, MallProgram>();
      const back = new Set<number>();
      for (const q of L.mall!.shops) { prog.set(q.area, q.program); if (q.backroom !== undefined) { prog.set(q.backroom, q.program); back.add(q.backroom); } }
      const out = L.props.filter(p => p.kind === 'mannequinFemale' && !(prog.get(p.area) === 'womenswear' && !back.has(p.area)) && prog.get(p.area) !== 'department');
      extras += out.length;
      expect(out.length, `seed ${s} spooky extras`).toBeLessThanOrEqual(SPOOKY_MANNEQUINS.perMall);
      for (const p of out) {
        expect(back.has(p.area) || prog.get(p.area) === 'vacant', `seed ${s} ${prog.get(p.area)} area ${p.area}`).toBe(true);
        expect(p.host).toBeUndefined();
        expect(p.mounted).toBeFalsy();
        expect(p.y).toBeCloseTo(L.areas[p.area].floorY ?? 0, 3);
      }
    }
    console.info(`[R4 spooky] female mannequins outside the fashion floors over ${ROT_SEEDS.length} synthetic malls: ${extras}`);
    expect(extras, 'the asset reappears in spooky spots').toBeGreaterThan(0);
  });
});

describe('old levels unchanged', () => {
  it('the station store purposes and station back-of-house purposes are untouched by the mall entries', () => {
    expect(Object.keys(STORE_PURPOSES).length).toBe(18);
    expect(Object.values(ROOM_PURPOSES).filter(p => !p.id.startsWith('mall-')).every(p => p.weight >= 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The generated mall (lane GEN's skeleton, gen/mall/index.ts calls assignMallPrograms -> dressMallShops -> placeMallWeapons).

describe('generated mall: shops dressed, census, weapons (bounded seeds)', () => {
  const GEN_SEEDS = [0x7ea3c1, 4242];
  const gen = new Map<number, StationLayout>();
  const mall = (seed: number) => { let L = gen.get(seed); if (!L) gen.set(seed, (L = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'}))); return L; };

  it('census (mall revision): three retail floors, ~18-24 units of GEN\'s lot families, programs suit their lots, the always-programs, no issues', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed);
      expect(mallIssues(L), `seed ${seed}`).toEqual([]);
      const census = mallShopCensus(L);
      const rows = census.map(c => ({level: c.level, units: c.units, stores: c.stores, kiosks: c.kiosks, service: c.service, vacant: c.vacant, area: c.salesArea, depth: c.depth.mean, back: c.backrooms, programs: c.programs}));
      console.info(`[gen census ${seed}] ${JSON.stringify(rows)} rotation ${MALL_ASSIGN_STATS.last ? '' : '(n/a)'}`);
      const shops = L.mall!.shops, units = shops.length;
      expect(L.mall!.storeys.filter(q => q.role === 'ring').length, `seed ${seed} retail floors`).toBe(3);
      expect(units, `seed ${seed} units`).toBeGreaterThanOrEqual(14);
      expect(units, `seed ${seed} units`).toBeLessThanOrEqual(32);
      expect(shops.filter(s => s.kind === 'vacant').length / units, `seed ${seed} vacant share`).toBeLessThan(0.13);
      for (const p of MALL_ALWAYS) expect(shops.some(s => s.program === p), `seed ${seed} ${p}`).toBe(true);
      expect(new Set(shops.map(s => s.lot)).size, `seed ${seed} lot families in use`).toBeGreaterThanOrEqual(5);
      for (const s of shops) {
        expect(shopFit(s), s.id).toBeDefined();
        expect(s.lot, `${s.id} lot (GEN contract)`).toBeDefined();
        expect(lotSuits(s.lot, s.program), `seed ${seed} ${s.id} ${s.lot} -> ${s.program}`).toBe(true);
        if (s.kind === 'vacant') continue;
        const n = L.props.filter(p => p.area === s.area && p.kind !== 'shopGlazing' && p.kind !== 'shopShutter').length;
        expect(n, `seed ${seed} ${s.id} ${s.lot} ${s.program} ${s.salesArea} m²`).toBeGreaterThanOrEqual(s.kind === 'kiosk' ? 1 : s.kind === 'food' ? 2 : 4);
      }
    }
  });

  it('gun shop(s): each stocked gun shop\'s own stock lies in it with its own calibre (U11: per gun shop, loadout-free)', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed);
      const guns = L.mall!.shops.filter(s => s.program === 'guns');
      expect(guns.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      const plan = mallWeaponPlan(seed, L.mall!.shops);
      const found = L.pickups.filter(p => (MALL_FIND_WEAPONS as readonly string[]).includes(p.itemId));
      expect(found.length, `seed ${seed}`).toBe(plan.length);
      for (const e of plan) expect(found.some(p => p.itemId === e.weapon && L.mall!.shops.find(g => g.id === e.shop)!.area === p.area), `seed ${seed} ${e.weapon}`).toBe(true);
      console.info(`[gen weapons ${seed}] plan ${JSON.stringify(plan)} found ${JSON.stringify(found.map(p => ({id: p.itemId, area: p.area, y: p.y})))}`);
    }
  });
  it('gallery commons on the generated mall: kiosk carts / food-hall seats clear of railings, run mouths, elevators and shop entries', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed), m = L.mall!;
      const gal = new Set(m.galleries.flatMap(g => g.areas));
      const pieces = L.props.filter(p => (p.kind === 'mallKioskCart' || p.kind === 'foodCourtTableSet' || p.kind === 'mallBench') && gal.has(p.area));
      for (const p of pieces) {
        const c = p.kind === 'mallKioskCart' ? COMMONS.kiosk : p.kind === 'mallBench' ? COMMONS.bench : COMMONS.seat;
        const lv = p.level ?? 0;
        const b = {x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz};
        const ptBox = (x: number, z: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
        for (const r of L.rails.filter(q => q.level === lv)) {
          let d = Infinity;
          for (let t = 0; t <= 1.0001; t += 0.02) d = Math.min(d, ptBox(r.x0 + (r.x1 - r.x0) * t, r.z0 + (r.z1 - r.z0) * t));
          expect(d, `seed ${seed} ${p.kind} rail`).toBeGreaterThanOrEqual(c.rail - 0.05);
        }
        for (const v of m.verticals) {
          if (v.lower === lv) expect(ptBox(v.foot.x, v.foot.z), `seed ${seed} ${p.kind} run foot`).toBeGreaterThanOrEqual(c.mouth - 1e-6);
          if (v.upper === lv) expect(ptBox(v.head.x, v.head.z), `seed ${seed} ${p.kind} run head`).toBeGreaterThanOrEqual(c.mouth - 1e-6);
        }
        expect(p.y, `${p.kind} on its storey floor`).toBeCloseTo(m.storeys.find(q => q.level === lv)!.baseY, 1);
      }
      console.info(`[gen commons ${seed}] ${pieces.map(p => `${p.kind}@L${p.level ?? 0}`).join(' ') || 'none'} rejects ${JSON.stringify(MALL_COMMONS_STATS.last?.rejects ?? {})}`);
      expect(mallIssues(L), `seed ${seed}`).toEqual([]);
    }
  });
  // Task mall-round3-20261031 (lane SHOPS, R5): moved here from tests/mall-ads.test.ts unchanged — it reuses this block's memoized
  // seed-4242 mall instead of generating its own (CI time, PR #25)
  it('R5: a REAL generated mall — every kind, eye-level posters, every kiosk cart / kiosk cell / food unit carries ads, womenswear ads', () => {
    const L = mall(4242);
    const ads = mallAds(L), by = (f: (a: MallAd) => boolean) => ads.filter(f).length;
    expect(ads.length).toBeGreaterThan(70);
    expect(by(a => a.slot === 'eye')).toBeGreaterThan(20);
    expect(by(a => a.kind === 'cart')).toBe(L.props.filter(p => p.kind === 'mallKioskCart').length);
    const shops = L.mall!.shops.map(s => ({s, f: shopFit(s)!}));
    let food = 0, menus = 0;
    for (const {s, f} of shops) {
      const mine = ads.filter(a => a.shop === s.id);
      if (f.kind === 'kiosk' || f.kind === 'store' || f.kind === 'anchor' || f.kind === 'food') expect(mine.length, `${s.id} ${f.kind} ${f.program}`).toBeGreaterThan(0);
      if (f.kind === 'food') { food++; if (checkMenu(L, s, ads)) menus++; }
    }
    expect(food).toBeGreaterThan(0);
    expect(menus / food).toBeGreaterThan(0.6);
    const women = shops.filter(({f}) => f.program === 'womenswear');
    for (const {s} of women) expect(ads.some(a => a.shop === s.id), `womenswear ${s.id}`).toBe(true);
  });
  it('delivered models furnish the generated malls (the catalogue rotates: most of them in two seeds, all across the synthetic sample)', () => {
    const seen = new Map<string, number>();
    for (const seed of GEN_SEEDS) for (const p of mall(seed).props) seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
    console.info(`[gen batch kinds] ${[...BATCH1, ...BATCH2].map(k => `${k} ${seen.get(k) ?? 0}`).join(', ')}`);
    expect([...BATCH1, ...BATCH2].filter(k => (seen.get(k) ?? 0) > 0).length).toBeGreaterThanOrEqual(24);
    // café chairs stand at their bistro table, facing it (seat front = prop +Z)
    for (const seed of GEN_SEEDS) {
      const props = mall(seed).props, tables = props.filter(p => p.kind === 'cafeBistroTable');
      for (const c of props.filter(p => p.kind === 'cafeChair')) {
        const t = tables.filter(q => q.area === c.area).sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
        expect(t, `seed ${seed} chair without a table`).toBeDefined();
        expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeLessThan(0.8);
        expect(Math.sin(c.rot) * (t.x - c.x) + Math.cos(c.rot) * (t.z - c.z), 'chair faces its table').toBeGreaterThan(0.5);
      }
    }
  });
});
