// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES; user: "To improve variety in store fronts, lift a few stores, from the
// mall level and sprinkle them in to this level to increase store variety."): the Skywalk's MALL STORE FAMILIES
// (gen/skyways/skywaysMallStores.ts, layout version >= 5) on REAL generated layouts — node only:
//  - the pool: real Mall programmes (purposes, recipe, finish, brand style), none a duplicate of the base pools / the ten major stores;
//  - versions 1-4 never get one (the fingerprints are pinned in tests/skyways-dest-layout-version.test.ts; here: no `mall` storefront);
//  - version 5 over a bounded seed set: 2-4 stores on most maps (the distribution is logged), each family at most once per map, spread out,
//    only on ordinary glazed retail units above the station storey that fit the programme's Mall size + lot family;
//  - each store IS the Mall store: its Mall purpose (no floor piles), a brand from the programme's own pool (unique on the map), the
//    programme's Mall recipe (its signature fixtures), every prop inside the unit, grounded / hosted, no generic station fit-out left;
//  - every kind placed is classified in BOTH audits (openables, physics); its storage opens (openable / existing / open classes); its loose
//    things are dynamic; fixture-drawn merchandise is split (version-4 rule); no baked-stock fixture survives;
//  - loot: every holder resolves its Mall purpose's context table under the SKYWAYS profile (the base tables — never the Mall's), no ammo;
//  - nothing loose on the floor inside a store (no pickups in its area).
// LL log: /tmp/skyways-mall-stores.log (the per-seed census and the distribution).
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {Rng} from '../src/core/rng';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, Storefront} from '../src/gen/stationTypes';
import {CELL} from '../src/gen/grid';
import {ROOM_PURPOSES, STORE_PURPOSES} from '../src/gen/purposes';
import {MALL_PROGRAMS} from '../src/gen/mall/shops';
import {PROGRAM_FINISH} from '../src/world/mallFinishes';
import {
  SKYWAYS_MALL_STORES, SKYWAYS_MALL_STORE_PROGRAMS, SKYWAYS_MALL_STORE_STATS, assignSkywaysMallStores, mallStoreEligible, mallStoreFits,
  mallStoreFront, skywaysMallStoreDressOf, skywaysMallStoresOf,
} from '../src/gen/skyways/skywaysMallStores';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {SKYWAYS_ENCOUNTERS_MIN_VERSION} from '../src/gen/skyways/layoutVersion';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {BASE_TABLES, econCat, lootProfile} from '../src/items/lootTables';
import {MERCH_BARE_VARIANT, STORE_MERCH_KINDS} from '../src/gen/skyways/stores/kinds/merch';

const LOG = '/tmp/skyways-mall-stores.log';
const SEEDS = Array.from({length: 20}, (_, i) => i + 1);
const gen = (seed: number, layoutVersion: number) => LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never) as StationLayout;
interface Run { seed: number; L: StationLayout; stats: NonNullable<typeof SKYWAYS_MALL_STORE_STATS.last>; stores: Storefront[] }
const runs: Run[] = [];
beforeAll(() => {
  fs.writeFileSync(LOG, '');
  for (const seed of SEEDS) {
    const L = gen(seed, 5);
    // (the generator may retry: the census of the attempt it returned is the layout's own storefronts)
    runs.push({seed, L, stats: SKYWAYS_MALL_STORE_STATS.last!, stores: skywaysMallStoresOf(L)});
  }
}, 900_000);

/** Signature kinds of each programme's Mall recipe (at least one stands in every such store). */
const SIGNATURE: Readonly<Record<(typeof SKYWAYS_MALL_STORE_PROGRAMS)[number], readonly string[]>> = {
  womenswear: ['mannequinFemale', 'clothingWallUnit', 'garmentRail', 'garmentRailRound'], shoes: ['shoeWallDisplay', 'ottoman'], jewelry: ['glassCounter'],
  beauty: ['cosmeticsWallUnit', 'salonChair'], optical: ['glassCounter', 'glassDisplayCabinet'], luggage: ['rollingSuitcase'],
  pet: ['catTree', 'aquarium'],
};

describe('the pool', () => {
  it('real Mall programmes with their purposes, recipes, finishes and brands; no duplicate of the base pools or the ten major stores', () => {
    expect(SKYWAYS_MALL_STORE_PROGRAMS.length).toBeGreaterThanOrEqual(4);
    expect(SKYWAYS_MALL_STORE_PROGRAMS.length).toBeLessThanOrEqual(8);
    expect(new Set(SKYWAYS_MALL_STORE_PROGRAMS).size).toBe(SKYWAYS_MALL_STORE_PROGRAMS.length);
    for (const p of SKYWAYS_MALL_STORE_PROGRAMS) {
      const d = MALL_PROGRAMS[p];
      expect(d, p).toBeTruthy();
      expect(d.purpose, p).toBe(`mall-${p}`);
      expect(ROOM_PURPOSES[d.purpose], `${p} purpose`).toBeTruthy();
      expect(d.front, p).toBe('glazed');
      expect(d.brands.length, p).toBeGreaterThanOrEqual(4);
      expect(PROGRAM_FINISH[p], p).toBeTruthy();
      expect(SIGNATURE[p].length, p).toBeGreaterThan(0);
      // not a station shop use (the base pools) nor a gun shop
      expect(p in STORE_PURPOSES, `${p} is a base shop use`).toBe(false);
      expect(p).not.toBe('guns');
    }
    // the major stores' families stay theirs (books, music, arcade, outfitter …)
    for (const fam of Object.keys(SKYWAYS_STORES)) expect(SKYWAYS_MALL_STORE_PROGRAMS as readonly string[], fam).not.toContain(fam);
    for (const dup of ['books', 'music', 'arcade', 'outdoors', 'sports', 'pharmacy', 'phone', 'florist', 'electronics']) expect(SKYWAYS_MALL_STORE_PROGRAMS as readonly string[], dup).not.toContain(dup);
    expect(SKYWAYS_ENCOUNTERS_MIN_VERSION).toBe(5);
  });

  it('the fit rule is the Mall\'s: the programme minimum AND the lot family the unit reads as', () => {
    expect(mallStoreFits('jewelry', 5, 5)).toBe(true);
    expect(mallStoreFits('jewelry', 5, 4)).toBe(false); // (depth under 4.5 m)
    expect(mallStoreFits('womenswear', 4, 6)).toBe(false); // (24 m² < 40)
    expect(mallStoreFits('womenswear', 7, 6)).toBe(true);
    expect(mallStoreFits('toys', 6.5, 6.5)).toBe(false); // (a compact square unit is no toy-shop lot)
  });
});

describe('versions 1-4 never let one', () => {
  for (const v of [4, 3, 2]) it(`seed 3 v${v}: no Mall store, and the assignment refuses below version 5`, () => {
    const L = gen(3, v);
    expect(L.storefronts.filter(sf => sf.mall).length).toBe(0);
    expect(L.props.some(p => /^womens|mannequinFemale$/.test(p.kind) && L.areas[p.area]?.storefront !== undefined && L.storefronts[L.areas[p.area].storefront!].anchor === undefined)).toBe(false);
    expect(assignSkywaysMallStores(L, new Rng(1), v)).toEqual([]);
  }, 300_000);
});

describe('version 5 over a bounded seed set', () => {
  it('2-4 Mall stores on most maps, each family at most once per map, spread out, several families across the set (distribution logged)', () => {
    const dist = new Map<number, number>(), fam = new Map<string, number>();
    for (const r of runs) {
      const n = r.stores.length;
      dist.set(n, (dist.get(n) ?? 0) + 1);
      const ps = r.stores.map(sf => sf.mall!);
      for (const p of ps) fam.set(p, (fam.get(p) ?? 0) + 1);
      expect(new Set(ps).size, `seed ${r.seed}: one store per family`).toBe(ps.length);
      expect(n, `seed ${r.seed}`).toBeLessThanOrEqual(4);
      // spread: no two on one storey closer than the spacing
      for (const a of r.stores) for (const b of r.stores) {
        if (a === b || (a.level ?? 0) !== (b.level ?? 0)) continue;
        const A = r.L.areas[a.unit], B = r.L.areas[b.unit];
        expect(Math.hypot((A.x + A.w / 2 - B.x - B.w / 2) * CELL, (A.y + A.h / 2 - B.y - B.h / 2) * CELL), `seed ${r.seed} ${a.name} / ${b.name}`).toBeGreaterThanOrEqual(SKYWAYS_MALL_STORES.spacing - 1e-6);
      }
      fs.appendFileSync(LOG, `seed ${r.seed}: ${n} Mall stores (asked ${r.stats.target}, ${r.stats.candidates} candidate units): `
        + r.stores.map(sf => { const a = r.L.areas[sf.unit]; return `${sf.mall} "${sf.name}" L${sf.level} ${(a.w * CELL).toFixed(1)}x${(a.h * CELL).toFixed(1)} m`; }).join('; ') + '\n');
    }
    const total = runs.reduce((s, r) => s + r.stores.length, 0);
    fs.appendFileSync(LOG, `distribution (stores per map: maps) ${JSON.stringify([...dist].sort((a, b) => a[0] - b[0]))}; mean ${(total / runs.length).toFixed(2)}; families ${JSON.stringify([...fam].sort())}\n`);
    expect(runs.filter(r => r.stores.length >= 2).length, 'maps with 2-4 Mall stores').toBeGreaterThanOrEqual(Math.ceil(runs.length * 0.75));
    expect(runs.every(r => r.stores.length >= 1), 'every map lets at least one').toBe(true);
    expect(total / runs.length).toBeGreaterThanOrEqual(2);
    expect(fam.size, 'families seen across the set').toBeGreaterThanOrEqual(6);
    expect(fam.get('womenswear') ?? 0, 'the women\'s fashion store on some maps').toBeGreaterThanOrEqual(3);
  });

  it('only ordinary glazed retail units above the station storey that fit the programme; the record is the Mall store (purpose, brand, sign, no floor piles)', () => {
    for (const r of runs) {
      const names = r.L.storefronts.map(sf => sf.name);
      for (const sf of r.stores) {
        const a = r.L.areas[sf.unit], p = sf.mall!, d = MALL_PROGRAMS[p];
        expect(mallStoreEligible(r.L, {...sf, mall: undefined}), `seed ${r.seed} ${sf.name}`).toBe(true);
        expect(sf.anchor).toBeUndefined();
        expect(sf.food).toBe(false);
        expect(sf.ownDress).toBeUndefined();
        expect(sf.level ?? 0).toBeGreaterThanOrEqual(1);
        const alongX = sf.side === 'N' || sf.side === 'S';
        expect(mallStoreFits(p, (alongX ? a.w : a.h) * CELL, (alongX ? a.h : a.w) * CELL), `seed ${r.seed} ${sf.name}`).toBe(true);
        expect(a.purpose, `seed ${r.seed} ${sf.name}`).toBe(d.purpose);
        expect(a.noFloorLoot).toBe(true);
        expect(a.label).toBe(sf.name);
        expect(d.brands.some(b => sf.name.startsWith(b)), `seed ${r.seed} brand ${sf.name}`).toBe(true);
        expect(names.filter(n => n === sf.name).length, `seed ${r.seed} ${sf.name} unique`).toBe(1);
        expect(sf.color).toBe(d.sign.bg);
        // the unit's front wall: the storefront opening lies just outside it
        const f = mallStoreFront(sf);
        if (f === 'N') expect(sf.oy).toBe(a.y - 1); else if (f === 'S') expect(sf.oy).toBe(a.y + a.h); else if (f === 'W') expect(sf.ox).toBe(a.x - 1); else expect(sf.ox).toBe(a.x + a.w);
      }
    }
  });

  it('each store is furnished by its programme\'s Mall recipe: signature fixtures, every prop inside the unit, grounded or hosted, no generic fit-out', () => {
    const census: string[] = [];
    for (const r of runs) {
      const dressed = skywaysMallStoreDressOf(r.L);
      expect(dressed.length).toBe(r.stores.length);
      for (const sf of r.stores) {
        const p = sf.mall as (typeof SKYWAYS_MALL_STORE_PROGRAMS)[number], a = r.L.areas[sf.unit], lv = sf.level ?? 0, floor = r.L.levels[lv].baseY;
        const own = r.L.props.filter(q => q.area === a.id);
        const kinds = new Set<string>(own.map(q => q.kind));
        expect(SIGNATURE[p].some(k => kinds.has(k)), `seed ${r.seed} ${sf.name} (${p}): ${[...kinds].join(',')}`).toBe(true);
        expect(own.filter(q => q.host === undefined && q.kind !== 'shopGlazing' && q.kind !== 'shopShutter').length, `seed ${r.seed} ${sf.name}`).toBeGreaterThanOrEqual(4);
        // the station's generic storefront fit-out (gen/storefronts.ts dressStorefront tags its props with the storefront) left only the
        // shopfront glazing
        expect(own.filter(q => q.shop === sf.id && q.kind !== 'shopGlazing').map(q => q.kind), `seed ${r.seed} ${sf.name}: generic fit-out`).toEqual([]);
        const x0 = a.x * CELL, z0 = a.y * CELL, x1 = (a.x + a.w) * CELL, z1 = (a.y + a.h) * CELL;
        for (const q of own) {
          if (q.kind === 'shopGlazing' || q.kind === 'shopShutter') continue;
          expect(q.level ?? 0, `${q.kind}`).toBe(lv);
          expect(q.x - q.hx, `seed ${r.seed} ${sf.name} ${q.kind} x`).toBeGreaterThanOrEqual(x0 - 0.01);
          expect(q.x + q.hx).toBeLessThanOrEqual(x1 + 0.01);
          expect(q.z - q.hz, `seed ${r.seed} ${sf.name} ${q.kind} z`).toBeGreaterThanOrEqual(z0 - 0.01);
          expect(q.z + q.hz).toBeLessThanOrEqual(z1 + 0.01);
          if (q.host === undefined) expect(Math.abs(q.y - floor), `seed ${r.seed} ${sf.name} ${q.kind} on its floor`).toBeLessThan(0.02);
          else { const h = r.L.props[q.host]; expect(h.area, `${q.kind} host`).toBe(a.id); expect(q.y, `${q.kind} above its host's base`).toBeGreaterThan(h.y); }
        }
        census.push(`${p}: ${own.length} props (${[...kinds].sort().join(', ')})`);
      }
    }
    fs.appendFileSync(LOG, `furnishing census:\n  ${[...new Set(census)].slice(0, 40).join('\n  ')}\n`);
  });
});

describe('affordances, merchandise and loot of every Mall store prop', () => {
  it('every kind classified in both audits; storage opens; loose things move; no fixture-drawn merchandise left whole', () => {
    const open = new Map(OPENABLE_AUDIT.map(e => [e.kind, e]));
    const seen = new Map<string, string>();
    for (const r of runs) for (const sf of r.stores) for (const q of r.L.props.filter(p => p.area === sf.unit)) {
      const o = open.get(q.kind), ph = PROP_PHYSICS_AUDIT[q.kind];
      expect(o, `${q.kind}: openables audit`).toBeTruthy();
      expect(ph, `${q.kind}: physics audit`).toBeTruthy();
      seen.set(q.kind, `${o!.cls} / ${ph!.cls}${ph!.cls === 'static' ? ` (${(ph as {why?: string}).why})` : ''}`);
      // storage that reads as openable is real storage (openable doors / drawers, or an open holder: nothing closes it)
      if (/Cabinet|Drawers|Cashwrap|Locker|Safe|Fridge/i.test(q.kind)) expect(['openable', 'existing', 'open'], `${q.kind}`).toContain(o!.cls);
      // the version-4 merch rule: a demo table / device wall stands bare (its devices are separate stock props)
      if (q.kind === 'techDisplay' || q.kind === 'deviceWall') expect(q.variant, `${q.kind} split`).toBe(MERCH_BARE_VARIANT);
    }
    // the loose merchandise / furniture of these recipes is dynamic (shot or walked into, it moves)
    for (const k of ['ottoman', 'garmentRail', 'rollingSuitcase', 'mannequinFemale', 'giantTeddy', 'rockingHorse', 'catTree', 'mannequinFull']) {
      if (seen.has(k)) expect(PROP_PHYSICS_AUDIT[k].cls, `${k} moves`).toBe('dynamic');
    }
    for (const k of STORE_MERCH_KINDS) if (seen.has(k)) expect(PROP_PHYSICS_AUDIT[k].cls, `${k} merch`).toBe('dynamic');
    fs.appendFileSync(LOG, `kinds (openables / physics): ${[...seen].sort().map(([k, v]) => `${k} ${v}`).join('; ')}\n`);
    expect(seen.size).toBeGreaterThan(10);
  });

  it('every holder resolves its Mall purpose\'s context table under the SKYWAYS profile (the base tables, never the Mall\'s); no ammo', () => {
    const prof = lootProfile('skyways');
    expect(prof.tables).toBe(BASE_TABLES);
    expect(prof.id).toBe('skyways');
    let holders = 0;
    const bySource = new Map<string, number>();
    for (const r of runs) for (const sf of r.stores) {
      const a = r.L.areas[sf.unit];
      for (const q of r.L.props.filter(p => p.area === a.id)) {
        if (!isLootHolderKind(q.kind)) continue;
        holders++;
        const t = holderTable(q.kind, q.purpose ?? a.purpose!, prof);
        bySource.set(t.source, (bySource.get(t.source) ?? 0) + 1);
        expect(t.source, `${q.kind} in ${a.purpose}`).not.toBe('legacy');
        for (const [item] of t.rows) expect(econCat(item), `${a.purpose} ${q.kind}: ${item}`).not.toBe('ammo');
      }
    }
    fs.appendFileSync(LOG, `holders ${holders}: sources ${JSON.stringify([...bySource])}\n`);
    expect(holders).toBeGreaterThan(runs.length * 2);
    expect(bySource.get('purpose') ?? 0).toBeGreaterThan(0);
  });

  it('nothing loose on a store floor: no pickup in any Mall store area (gear / weapon finds keep out: noFloorLoot)', () => {
    for (const r of runs) {
      const ids = new Set(r.stores.map(sf => sf.unit));
      const inside = r.L.pickups.filter(pk => {
        const lv = pk.level ?? 0, g = r.L.levels[lv].grid, [cx, cy] = g.cellOf(pk.x, pk.z);
        return g.inBounds(cx, cy) && ids.has(g.area[g.idx(cx, cy)]);
      });
      expect(inside.map(pk => `${pk.itemId} @ ${pk.x},${pk.z}`), `seed ${r.seed}`).toEqual([]);
    }
  });

  it('deterministic: the same seed lets the same stores with the same furniture', () => {
    const a = gen(SEEDS[0], 5), b = runs[0].L;
    const sig = (L: StationLayout) => JSON.stringify(skywaysMallStoresOf(L).map(sf => [sf.id, sf.mall, sf.name, L.props.filter(p => p.area === sf.unit).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant])]));
    expect(sig(a)).toBe(sig(b));
  }, 300_000);
});
