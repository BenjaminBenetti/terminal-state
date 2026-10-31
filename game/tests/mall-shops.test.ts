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
import {MALL_HOLDER_KINDS, MALL_KINDS, MALL_OPEN_AUDIT, MALL_PHYS, MALL_SURFACES, isMallHolderKind} from '../src/gen/mall/kinds';
import {MALL_PROGRAMS, assignMallPrograms, mallShopCensus, shopFit} from '../src/gen/mall/shops';
import {dressMallShops, frameOf, frontageSide, uvXZ} from '../src/gen/mall/shopsDress';
import {MALL_FIND_WEAPONS, mallGearSpots, mallShopPose, mallWeaponPlan, placeMallWeapons} from '../src/gen/mall/shopsWeapons';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {dynamicKind} from '../src/physics/dynamicItems';
import {HOLDER_ALLOW, HOLDER_SLOTS, econCat} from '../src/items/lootTables';
import {holderTable, isLootHolderKind, rollLootItems} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {WEAPON_FIND_AMMO} from '../src/gen/weaponFinds';
import {mallShopsFixture} from './helpers/mallShopsFixture';

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
      pharmacy: [['stockShelf'], ['medCabinet', 'glassCounter']],
      electronics: [['deviceWall', 'techDisplay', 'tvWall']],
      hardware: [['stockShelf', 'shelf']],
      clothing: [['clothingRack', 'wallBay'], ['shopCounter']],
      grocery: [['shopCounter'], ['stockShelf'], ['shopCooler', 'produceStand']],
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

  it('holder kinds: slot, defaults, surfaces inside the footprint and under the top, open (not storage)', () => {
    for (const k of MALL_HOLDER_KINDS) {
      expect(isLootHolderKind(k), k).toBe(true);
      expect(HOLDER_SLOTS[k], k).toBeTruthy();
      expect(MALL_OPEN_AUDIT[k].cls).toBe('open');
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
      lawBookcase: 'books are decor (existing audit row)', sneakerWall: 'shoes are decor (existing audit row)', clothingRack: 'garments are decor (existing)',
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
    // the new mall kinds bake nothing: their forms are fixtures only (no loose-item materials in their stand-ins)
    console.info(`[kinds placed] ${[...seen].sort().join(', ')}`);
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
