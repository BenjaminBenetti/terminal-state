// Task track3-eaton-centre-20261031 (lane SHOPS): The Eaton's Center shops — catalogue / program mix, unit kinds and census, interior
// substance (fixtures per m², stock rooms), frontage / entry / door clearance, reachable holders, the new mall prop kinds' audits
// (openables + physics + loot surfaces), no baked clutter, themed loot, the bounded once-per-run gun-shop weapon plan, determinism.
// Synthetic rings (tests/helpers/mallShopsFixture.ts) until lane GEN's generator lands; the generated mall is covered by GEN's tests.

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
import {MALL_PROGRAMS, assignMallPrograms, mallShopCensus, shopFit} from '../src/gen/mall/shops';
import {MALL_COMMONS_STATS, dressMallShops, frameOf, frontageSide, uvXZ} from '../src/gen/mall/shopsDress';
import {MALL_FIND_WEAPONS, mallGearSpots, mallShopPose, mallWeaponPlan, placeMallWeapons} from '../src/gen/mall/shopsWeapons';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, openableSpec} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {dynamicKind} from '../src/physics/dynamicItems';
import {HOLDER_ALLOW, HOLDER_SLOTS, OPENABLE_TABLES, econCat} from '../src/items/lootTables';
import {holderTable, isLootHolderKind, rollLootItems} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {mallShopsFixture} from './helpers/mallShopsFixture';
import {generateMallLevel, mallIssues} from '../src/gen/mall/index';

/** A dressed synthetic mall (absolute frame) for `seed`. */
function dressed(seed: number, rings = 2, foodRing?: number): {layout: StationLayout; reports: ReturnType<typeof dressMallShops>} {
  const {layout} = mallShopsFixture(rings);
  assignMallPrograms(layout, new Rng(seed), foodRing ? {foodRing} : {});
  const reports = dressMallShops(layout, new Rng(seed ^ 0x5eed), {frame: 'absolute'});
  return {layout, reports};
}
const cache = new Map<string, ReturnType<typeof dressed>>();
const get = (seed: number, rings = 2, foodRing?: number) => {
  const k = `${seed}:${rings}:${foodRing ?? ''}`;
  let v = cache.get(k);
  if (!v) cache.set(k, (v = dressed(seed, rings, foodRing)));
  return v;
};
const SEEDS = [1, 2, 3, 4];

describe('catalogue: programs, brands, purposes, finishes', () => {
  it('every MallProgram has a definition with fictional brands, valid purposes, two distinct finishes and a recipe', () => {
    for (const [id, d] of Object.entries(MALL_PROGRAMS)) {
      expect(d.id).toBe(id);
      if (id !== 'food-court' && id !== 'cafe') expect(d.brands.length, id).toBeGreaterThanOrEqual(3);
      expect(purposeById(d.purpose), `${id} purpose ${d.purpose}`).toBeDefined();
      expect(purposeById(d.back), `${id} back ${d.back}`).toBeDefined();
      expect(d.finishes[0]).not.toEqual(d.finishes[1]);
      expect(d.count[0]).toBeLessThanOrEqual(d.count[1]);
      expect(d.shutter.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    // finishes differ by program, not one wall recoloured
    const walls = new Set(Object.values(MALL_PROGRAMS).flatMap(d => d.finishes.map(f => `${f.floor}/${f.wall}`)));
    expect(walls.size).toBeGreaterThan(30);
    // brands are unique across programs
    const all = Object.values(MALL_PROGRAMS).flatMap(d => d.brands);
    expect(new Set(all).size).toBe(all.length);
  });

  it('mall purposes: weight 0, never offered to the station / office assignment, themed, valid holders', () => {
    const mall = Object.values(ROOM_PURPOSES).filter(p => p.id.startsWith('mall-'));
    expect(mall.length).toBeGreaterThanOrEqual(50);
    for (const p of mall) {
      expect(p.weight, p.id).toBe(0);
      for (const h of Object.keys(p.loot)) if (h !== 'default') expect(isLootHolderKind(h), `${p.id} ${h}`).toBe(true);
    }
    expect(ROOM_PURPOSES['mall-guns'].theme).toBe('security');
    expect(ROOM_PURPOSES['mall-pharmacy'].theme).toBe('medical');
    expect(ROOM_PURPOSES['mall-electronics'].theme).toBe('tech');
    expect(ROOM_PURPOSES['mall-grocery'].theme).toBe('food');
  });
});

describe('program mix and census (synthetic rings)', () => {
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
        if (sh.kind === 'store' || sh.kind === 'anchor' || sh.kind === 'food') brands.push(sh.brand);
      }
      expect(new Set(brands).size, `seed ${s}`).toBe(brands.length);
    }
  });

  it('the core programs appear; guns / outdoors stay rare-ish; anchors in the big units; kiosks only in small units; a food-court ring', () => {
    for (const s of SEEDS) {
      const {layout} = get(s, 2, 1);
      const shops = layout.mall!.shops;
      const n = (p: MallProgram) => shops.filter(q => q.program === p).length;
      for (const p of ['guns', 'pharmacy', 'electronics', 'hardware', 'clothing', 'grocery'] as MallProgram[]) expect(n(p), `seed ${s} ${p}`).toBeGreaterThanOrEqual(1);
      expect(n('guns')).toBeLessThanOrEqual(2);
      expect(n('outdoors')).toBeLessThanOrEqual(2);
      for (const sh of shops) {
        if (sh.kind === 'anchor') expect(sh.salesArea).toBeGreaterThanOrEqual(150);
        if (sh.kind === 'kiosk') expect(sh.salesArea < 16 || sh.depth < 3.5 || ['phone', 'jewelry', 'optical', 'florist', 'beauty', 'luggage', 'kiosk'].includes(sh.program)).toBe(true);
      }
      expect(shops.filter(q => q.kind === 'food' && q.level === 1).length, `seed ${s}`).toBeGreaterThanOrEqual(3);
      expect(shops.some(q => q.kind === 'service')).toBe(true);
    }
  });

  it('census: per ring stores vs kiosks vs service vs vacant, sales area / depth stats, backrooms', () => {
    const {layout} = get(1);
    const census = mallShopCensus(layout);
    expect(census.length).toBe(2);
    for (const c of census) {
      expect(c.units).toBe(16);
      expect(c.stores + c.kiosks + c.service + c.vacant).toBe(c.units);
      expect(Object.values(c.byKind).reduce((a, b) => a + b, 0)).toBe(c.units);
      expect(c.stores).toBeGreaterThanOrEqual(8);
      expect(c.salesArea.min).toBeGreaterThan(0);
      expect(c.depth.max).toBeGreaterThanOrEqual(12);
      expect(c.backrooms).toBe(15);
    }
    console.info(`[census seed 1] ${JSON.stringify(census.map(c => ({ring: c.ring, stores: c.stores, kiosks: c.kiosks, service: c.service, vacant: c.vacant, byKind: c.byKind, area: c.salesArea, depth: c.depth, programs: c.programs})))}`);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = dressed(7), b = dressed(7), c = dressed(8);
    expect(a.layout.mall!.shops.map(s => [s.program, s.brand])).toEqual(b.layout.mall!.shops.map(s => [s.program, s.brand]));
    expect(a.layout.props).toEqual(b.layout.props);
    expect(a.layout.mall!.shops.map(s => s.program)).not.toEqual(c.layout.mall!.shops.map(s => s.program));
  });
});

describe('interiors: substantial, distinct, purposeful', () => {
  it('every real store gets a dressed sales floor (fixtures per m²) and a dressed stock room', () => {
    for (const s of SEEDS) {
      const {layout, reports} = get(s);
      for (const r of reports) {
        const sh = layout.mall!.shops.find(q => q.id === r.shop)!;
        if (sh.kind === 'vacant') continue;
        const minProps = sh.kind === 'kiosk' ? 1 : sh.kind === 'food' ? 5 : sh.salesArea >= 80 ? 8 : 4;
        expect(r.props, `seed ${s} ${sh.id} ${sh.program} (${sh.salesArea} m²)`).toBeGreaterThanOrEqual(minProps);
        expect(r.holders, `${sh.id} ${sh.program}`).toBeGreaterThanOrEqual(sh.kind === 'kiosk' ? 1 : 3);
        if (sh.backroom !== undefined) expect(r.backProps, `${sh.id} back`).toBeGreaterThanOrEqual(3);
      }
      const dens = reports.filter(r => layout.mall!.shops.find(q => q.id === r.shop)!.kind === 'store').map(r => r.density);
      expect(dens.reduce((a, b) => a + b, 0) / dens.length, `seed ${s} mean props / 10 m²`).toBeGreaterThan(0.6);
    }
  });

  it('signature fixtures per program (gun counters + display benches + racks / lockers; dispensary; checkouts + aisles; kitchens)', () => {
    const SIG: Partial<Record<MallProgram, string[][]>> = {
      guns: [['glassCounter'], ['gunDisplay'], ['shelf', 'gunLocker', 'gunRack']],
      pharmacy: [['stockShelf'], ['medCabinet', 'glassCounter', 'pharmacyDispensaryCounter']],
      electronics: [['deviceWall', 'techDisplay', 'tvWall']],
      hardware: [['stockShelf', 'shelf']],
      clothing: [['clothingRack', 'wallBay'], ['shopCounter']],
      grocery: [['shopCounter', 'checkoutLane'], ['stockShelf', 'retailGondola'], ['shopCooler', 'produceStand']],
      'food-court': [['shopCounter', 'shopDisplay'], ['grillLine', 'pizzaOven', 'wokLine', 'deliLine', 'blenderBar', 'espressoBar', 'shopBackbar']],
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
    const {layout} = get(2);
    const sets = new Map<string, Set<string>>();
    for (const sh of layout.mall!.shops) {
      if (sh.kind !== 'store' && sh.kind !== 'anchor') continue;
      const k = new Set(layout.props.filter(p => p.area === sh.area && !['shopGlazing', 'shopShutter', 'cashRegister', 'bin'].includes(p.kind)).map(p => p.kind as string));
      const prev = sets.get(sh.program);
      sets.set(sh.program, prev ? new Set([...prev, ...k]) : k);
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

describe('circulation: frontages, entries, doors, reachability', () => {
  it('nothing stands in the shopfront entry span; every shop stays connected; every holder is reachable from its entry', () => {
    for (const s of SEEDS) {
      const {layout} = get(s);
      for (const sh of layout.mall!.shops) {
        const a = layout.areas[sh.area], f = shopFit(sh)!;
        const lv = a.level ?? 0, g = layout.levels[lv].grid;
        const side = frontageSide(a, sh);
        const fs = side === 'N' || side === 'S' ? sh.frontage.x0 : sh.frontage.z0;
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
        for (let k = 0; k < d.w; k++) expect(g.blocked[g.idx(d.x + k, d.y)], `seed ${s} door ${d.id}`).toBe(0);
      }
      // glazing never covers the whole frontage of an open shop
      for (const sh of layout.mall!.shops) {
        const f = shopFit(sh)!;
        if (f.shutter === 'closed') continue;
        const fd = layout.doors.find(d => d.shopfront && d.b === sh.area)!;
        const g = layout.levels[fd.level ?? 0].grid;
        let open = 0;
        for (let k = 0; k < fd.w; k++) if (!g.blocked[g.idx(fd.x + k, fd.y)]) open++;
        expect(open * CELL, `seed ${s} ${sh.id} open frontage`).toBeGreaterThanOrEqual(Math.min(2.4, fd.w * CELL));
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
const BATCH2 = ['ottoman', 'tentDisplay', 'tvWall', 'kiddieRide', 'salonChair', 'displayBed', 'medicineDrawerCabinet'] as const;

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
    const PARTS: Record<string, number> = {mallCashwrapCounter: 6, glassDisplayCabinet: 2, pharmacyDispensaryCounter: 10, mallKioskCart: 2, medicineDrawerCabinet: 35, storageTote: 1};
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
      expect(MALL_PHYS[k as keyof typeof MALL_PHYS].dynamic, k).toBe(k === 'storageTote');
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
  it('every batch-1 kind furnishes the synthetic mall; racks stand on the floor; garments ride the bay rails; tills ride the lanes', () => {
    const seen = new Map<string, number>();
    for (const s of SEEDS) {
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
    // (the tent, kiddie ride and salon chairs furnish outdoors / toys / arcade / beauty floors the small synthetic mall rarely draws:
    // the generated-mall block below requires them)
    for (const k of [...BATCH1, ...BATCH2.filter(q => q !== 'tentDisplay' && q !== 'kiddieRide' && q !== 'salonChair')]) expect(seen.get(k) ?? 0, `${k} placed`).toBeGreaterThan(0);
    expect(seen.get('mallCashwrapCounter') ?? 0, 'back counters behind the wraps').toBeGreaterThanOrEqual(6);
  });

  it('gallery commons: one kiosk cart per ring at most, food-hall seating only on the food ring, clear rings of walkable gallery floor', () => {
    for (const s of SEEDS) {
      const {layout} = get(s, 2, 1);
      const rejects = MALL_COMMONS_STATS.last?.rejects ?? {};
      const m = layout.mall!;
      for (const gl of m.galleries) {
        const g = layout.levels[gl.level].grid, gal = new Set(gl.areas);
        const on = (k: string) => layout.props.filter(p => p.kind === k && gal.has(p.area));
        const kiosks = on('mallKioskCart'), seats = on('foodCourtTableSet');
        expect(kiosks.length, `seed ${s} ring ${gl.level} kiosks`).toBeLessThanOrEqual(COMMONS.kiosk.perRing);
        const food = m.shops.some(q => q.level === gl.level && q.kind === 'food');
        if (!food) expect(seats.length).toBe(0); else expect(seats.length).toBeLessThanOrEqual(COMMONS.seat.max);
        for (const [p, ring] of [...kiosks.map(q => [q, COMMONS.kiosk.ring] as const), ...seats.map(q => [q, COMMONS.seat.ring] as const)]) {
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

describe('weapon plan: bounded, once per run, accessible, matching ammo, persisted as layout pickups', () => {
  it('plans every non-start real gun 1-2 times, never the start weapon, deterministic per level seed', () => {
    for (const start of ['pistol', 'rifle'] as const) for (let seed = 1; seed <= 60; seed++) {
      const plan = mallWeaponPlan(seed, start);
      expect(plan).toEqual(mallWeaponPlan(seed, start));
      for (const w of MALL_FIND_WEAPONS) {
        const n = plan.filter(e => e.weapon === w).length;
        if (w === start) expect(n).toBe(0); else { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(2); }
      }
    }
  });

  it('places the guns on the gun shop display benches with their own calibre beside them; duplicate gun shops do not multiply finds', () => {
    let twoShops = 0;
    for (const s of SEEDS) {
      const {layout} = dressed(s);
      const before = layout.pickups.length;
      const rep = placeMallWeapons(layout, 1000 + s, 'pistol');
      const guns = layout.mall!.shops.filter(q => q.program === 'guns');
      if (guns.length > 1) twoShops++;
      const placed = layout.pickups.slice(before);
      const weapons = placed.filter(p => (MALL_FIND_WEAPONS as readonly string[]).includes(p.itemId));
      expect(weapons.length, `seed ${s}`).toBe(rep.finds.length);
      expect(rep.finds.length + rep.missed.length).toBe(rep.plan.length);
      expect(weapons.length).toBeLessThanOrEqual(rep.plan.length);
      // every copy-0 gun is in a gun shop, on a display bench (accessible) or its floor
      for (const f of rep.finds.filter(q => q.copy === 0)) {
        expect(guns.some(g => g.id === f.shop), `seed ${s} ${f.weapon} in ${f.shop}`).toBe(true);
        const [gi, ai] = f.pickups;
        expect(layout.pickups[ai].itemId).toBe(WEAPON_FIND_AMMO[layout.pickups[gi].itemId][0]);
        expect(layout.pickups[ai].count).toBe(WEAPON_FIND_AMMO[layout.pickups[gi].itemId][1]);
        expect(layout.pickups[gi].y).toBeGreaterThanOrEqual(layout.areas[f.area].floorY ?? 0);
      }
      expect(rep.finds.filter(f => f.copy === 0).length, `seed ${s}`).toBe(rep.plan.filter(e => e.copy === 0).length);
      expect(rep.finds.some(f => f.on === 'display'), `seed ${s} display bench`).toBe(true);
      // the same seed re-places exactly the same pickups (persistence by layout pickup index)
      const again = dressed(s);
      placeMallWeapons(again.layout, 1000 + s, 'pistol');
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

  it('per-ring census: 8+ real stores, few vacant, every unit has a program / brand / dressed interior, no validation issues', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed);
      expect(mallIssues(L), `seed ${seed}`).toEqual([]);
      const census = mallShopCensus(L);
      const rows = census.map(c => ({ring: c.ring, units: c.units, stores: c.stores, kiosks: c.kiosks, service: c.service, vacant: c.vacant, area: c.salesArea, depth: c.depth.mean, back: c.backrooms, programs: c.programs}));
      console.info(`[gen census ${seed}] ${JSON.stringify(rows)}`);
      const units = L.mall!.shops.length, vacant = L.mall!.shops.filter(s => s.kind === 'vacant').length;
      expect(vacant / units, `seed ${seed} vacant share`).toBeLessThan(0.16);
      for (const c of census) if (c.ring >= 1) expect(c.stores, `seed ${seed} ring ${c.ring}`).toBeGreaterThanOrEqual(Math.min(8, c.units - 3));
      for (const s of L.mall!.shops) {
        expect(shopFit(s), s.id).toBeDefined();
        if (s.kind === 'vacant') continue;
        const n = L.props.filter(p => p.area === s.area && p.kind !== 'shopGlazing' && p.kind !== 'shopShutter').length;
        expect(n, `seed ${seed} ${s.id} ${s.program} ${s.salesArea} m²`).toBeGreaterThanOrEqual(s.kind === 'kiosk' ? 1 : 5);
      }
    }
  });

  it('gun shop(s): the plan\'s guns lie on display benches / the shop floor with their own calibre, reachable, no more than planned', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed);
      const guns = L.mall!.shops.filter(s => s.program === 'guns');
      expect(guns.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      const plan = mallWeaponPlan(seed, 'pistol');
      const found = L.pickups.filter(p => (MALL_FIND_WEAPONS as readonly string[]).includes(p.itemId) && L.mall!.shops.some(s => s.area === p.area));
      expect(found.length, `seed ${seed}`).toBeLessThanOrEqual(plan.length);
      for (const e of plan.filter(q => q.copy === 0)) expect(found.some(p => p.itemId === e.weapon && guns.some(g => g.area === p.area)), `seed ${seed} ${e.weapon}`).toBe(true);
      console.info(`[gen weapons ${seed}] plan ${JSON.stringify(plan)} found ${JSON.stringify(found.map(p => ({id: p.itemId, area: p.area, y: p.y})))}`);
    }
  });
  it('gallery commons on the generated mall: kiosk carts / food-hall seats clear of railings, run mouths, elevators and shop entries', () => {
    for (const seed of GEN_SEEDS) {
      const L = mall(seed), m = L.mall!;
      const gal = new Set(m.galleries.flatMap(g => g.areas));
      const pieces = L.props.filter(p => (p.kind === 'mallKioskCart' || p.kind === 'foodCourtTableSet') && gal.has(p.area));
      for (const p of pieces) {
        const c = p.kind === 'mallKioskCart' ? COMMONS.kiosk : COMMONS.seat;
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
  it('every delivered batch-1 / batch-2 model furnishes the generated mall', () => {
    const seen = new Map<string, number>();
    for (const seed of GEN_SEEDS) for (const p of mall(seed).props) seen.set(p.kind, (seen.get(p.kind) ?? 0) + 1);
    console.info(`[gen batch kinds] ${[...BATCH1, ...BATCH2].map(k => `${k} ${seen.get(k) ?? 0}`).join(', ')}`);
    for (const k of [...BATCH1, ...BATCH2]) expect(seen.get(k) ?? 0, `${k} placed`).toBeGreaterThan(0);
  });
});
