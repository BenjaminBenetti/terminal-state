// Task studio-base-salvage-20261108-073314-01 (user: "what about if we changed the base loot table? these items are supposed to be basic
// and found in all levels" -> "ok that sounds good. Lets do that"): THE SHARED BASE SALVAGE (items/lootTables.ts BASE_SALVAGE, additive:
// items/loot.ts salvageLot). The three crafting materials are basic finite loot on every level type through the shared tables — no
// per-level whitelist, no guaranteed find, no floor scatter, no refill — while every other find stays exactly as it was:
//  - every registered profile (and any future one on the base tables) has an ordinary-holder path to all three materials;
//  - the mall / Reactor keep their own salvage (never both); the market only in its workshop storage;
//  - only suitable holders (never fridges / coolers / gun lockers / medicine cabinets / bins / container-themed storage / exact tables);
//  - the extra lot is additive: the other lots are byte-identical, it rests on a real surface clear of them, finite and remembered
//    (a remembered holder never gains it; a taken one never comes back), and a fuel can laid on it removes it.
import {describe, expect, it} from 'vitest';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {layoutHolders} from './helpers/lootEconomy';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {ALL_PURPOSES, purposeById} from '../src/gen/purposes';
import {
  ANNEX_CACHE_KEY, ANNEX_PICKED_KEY, ANNEX_SCRAPS_KEY, ANNEX_STASH_KEY, ANNEX_SUPPLY_KEY, BASE_SALVAGE, BASE_TABLES, CONTAINER_THEMED, HOLDER_ALLOW, MALL_SALVAGE, MARKET_SALVAGE, MARKET_WORKSHOP_KEY, PROFILES, RANDOM_HOLDERS,
  THEME_ECONOMY, econCat, lootProfile, resolveRows, validateLootProfile, type LootProfile,
} from '../src/items/lootTables';
import {
  SALVAGE_ID, extraSalvageRule, holderFinds, holderTable, isLootHolderKind, isSalvageLotId, rollHolderLots, rollLootItems, takeLot,
  type HolderKind,
} from '../src/items/loot';
import {lotBoxesOverlap, placementBox} from '../src/items/lootLayout';
import {MATERIAL_IDS, isMaterialItem} from '../src/items/craftMaterials';
import {ContainerManager} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {applyHolders, captureHolders, dropUnrecordedSalvage, holderKeyOf} from '../src/run/worldMemory';
import {Inventory} from '../src/items/inventory';
import {FUEL} from '../src/fuel/fuel';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const layouts = new Map<string, StationLayout>();
const gen = (level: LevelId, seed: number): StationLayout => {
  const k = `${level}:${seed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
const keyOf = (l: StationLayout, p: StationLayout['props'][number]) => { const a = l.areas[p.area]; return p.purpose ?? a?.purpose ?? a?.type ?? 'default'; };
/** The level's profile without its additive salvage (what every holder rolled before the base salvage). */
const withoutSalvage = (P: LootProfile): LootProfile => ({...P, tables: {...P.tables, salvage: P.tables.salvage?.extra ? undefined : P.tables.salvage}});

describe('one shared rule: every level type reaches all three materials through ordinary holders', () => {
  it('the base tables carry the additive base salvage; the mall / Reactor replace it with their own, the market with its workshop table', () => {
    expect(BASE_TABLES.salvage).toBe(BASE_SALVAGE);
    expect(BASE_SALVAGE.extra).toBe(true);
    for (const id of LEVEL_IDS) {
      const P = lootProfile(id);
      expect(validateLootProfile(P), id).toEqual([]);
      const sv = P.tables.salvage;
      expect(sv, `${id} salvage`).toBeDefined();
      // ONE salvage table per profile: the base one, or a replacement (never base + own: no double application)
      if (sv !== BASE_SALVAGE) expect([MALL_SALVAGE, MARKET_SALVAGE], id).toContain(sv);
    }
    expect(PROFILES.subway.tables.salvage).toBe(BASE_SALVAGE);
    expect(PROFILES.office.tables.salvage).toBe(BASE_SALVAGE);
    expect(PROFILES.skyways.tables.salvage).toBe(BASE_SALVAGE);
    expect(PROFILES.bunker.tables.salvage).toBe(BASE_SALVAGE); // (task studio-bunker-level-20261109-072224-01: the shared tables)
    expect(PROFILES.mall.tables.salvage).toBe(MALL_SALVAGE);
    expect(PROFILES.reactor.tables.salvage).toBe(MALL_SALVAGE);
    expect(PROFILES.market.tables.salvage).toBe(MARKET_SALVAGE);
    expect(MALL_SALVAGE.extra).toBeUndefined(); // the mall's established rows semantics, unchanged
    // every base rule: a real purpose / theme, material rows only, all three materials reachable
    for (const k of Object.keys(BASE_SALVAGE.purposes ?? {})) expect(purposeById(k), k).toBeDefined();
    for (const k of Object.keys(BASE_SALVAGE.themes ?? {})) expect(k in THEME_ECONOMY, k).toBe(true);
    const rules = [...Object.values(BASE_SALVAGE.purposes ?? {}), ...Object.values(BASE_SALVAGE.themes ?? {})];
    for (const r of rules) {
      expect(r!.rows.every(([id, w]) => isMaterialItem(id) && w > 0)).toBe(true);
      expect(r!.share).toBeGreaterThan(0);
      expect(r!.share).toBeLessThanOrEqual(0.2); // modest per-holder chances: basic, never a guaranteed find
    }
    expect(new Set(rules.flatMap(r => r!.rows.map(x => x[0])))).toEqual(new Set(MATERIAL_IDS));
  });

  it('every registered level (registry-driven) places ordinary holders whose rolls can yield each of the three materials', () => {
    for (const id of LEVEL_IDS) {
      const P = lootProfile(id), l = gen(id, 11);
      const can = new Set<string>();
      for (const p of l.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const kind = p.kind as HolderKind, key = keyOf(l, p), t = holderTable(kind, key, P);
        // the holder's own table (where it can roll a lot at all) …
        if (t.source !== 'fixture' && t.empty < 1 && t.lots[1] > 0) for (const [m, w] of t.rows) if (w > 0 && isMaterialItem(m)) can.add(m);
        // … and its additive base salvage lot
        const r = extraSalvageRule(kind, key, P, t);
        if (r) for (const [m, w] of resolveRows(P, r.rows)) if (w > 0) can.add(m);
      }
      expect([...can].sort(), `${id} (level seed 11)`).toEqual([...MATERIAL_IDS].sort());
    }
  }, 120000);

  it('a FUTURE level on the shared tables inherits the base salvage (no per-level list to extend)', () => {
    const future: LootProfile = {id: 'future', label: 'A future level', tables: BASE_TABLES, overrides: {}};
    expect(validateLootProfile(future)).toEqual([]);
    expect(extraSalvageRule('stockShelf', 'storage', future)).toBe(BASE_SALVAGE.purposes!.storage);
    expect(extraSalvageRule('cabinetTall', 'workshop', future)).toBe(BASE_SALVAGE.purposes!.workshop);
    // a theme entry covers a purpose no rule names (any service / tech / medical place)
    expect(BASE_SALVAGE.purposes!['service-corridor']).toBeUndefined();
    expect(purposeById('service-corridor')?.theme).toBe('service');
    expect(extraSalvageRule('stockShelf', 'service-corridor', future)).toBe(BASE_SALVAGE.themes!.service);
    // and it rolls: some holders over a few hundred indices get a material lot
    let n = 0;
    for (let i = 0; i < 400; i++) n += rollLootItems(4242, i, 'stockShelf', 'storage', future).filter(e => isMaterialItem(e.itemId)).length;
    expect(n).toBeGreaterThan(400 * BASE_SALVAGE.purposes!.storage.share * 0.6);
    expect(n).toBeLessThan(400 * BASE_SALVAGE.purposes!.storage.share * 1.5);
    // a profile turns it off with its own (empty) salvage table or a 0 material weight
    expect(extraSalvageRule('stockShelf', 'storage', {...future, tables: {...BASE_TABLES, salvage: {}}})).toBeUndefined();
    const zero: LootProfile = {...future, overrides: {categoryWeight: {material: 0}}};
    for (let i = 0; i < 200; i++) expect(rollLootItems(4242, i, 'stockShelf', 'storage', zero).some(e => isMaterialItem(e.itemId))).toBe(false);
  });

  it('only suitable holders: never fridges, coolers, gun lockers, medicine cabinets, food fixtures, bins, container-themed storage or exact tables', () => {
    const P = PROFILES.subway;
    const kinds = new Set<string>([...Object.keys(HOLDER_ALLOW).filter(k => !HOLDER_ALLOW[k]!.includes('material')), ...CONTAINER_THEMED, ...RANDOM_HOLDERS]);
    expect(kinds.has('fridge') && kinds.has('shopCooler') && kinds.has('gunLocker') && kinds.has('medCabinet') && kinds.has('bin')).toBe(true);
    for (const pu of ALL_PURPOSES) for (const k of kinds) if (isLootHolderKind(k)) expect(extraSalvageRule(k, pu.id, P), `${k}@${pu.id}`).toBeUndefined();
    // exact (annex supply / scraps / stash / cache / picked-over / market-empty) tables and curated rewards never take the lot
    for (const pu of ALL_PURPOSES) for (const [k, spec] of Object.entries(pu.loot)) {
      if (!spec?.exact || k === 'default' || !isLootHolderKind(k)) continue;
      expect(extraSalvageRule(k, pu.id, P), `${k}@${pu.id}`).toBeUndefined();
    }
    for (const id of [ANNEX_SUPPLY_KEY, ANNEX_SCRAPS_KEY, ANNEX_STASH_KEY, ANNEX_PICKED_KEY, ANNEX_CACHE_KEY]) for (const k of ['stockShelf', 'crate', 'cabinetTall'] as HolderKind[]) expect(extraSalvageRule(k, id, P), `${k}@${id}`).toBeUndefined();
    // sealed, anchored non-loot fixtures (the Subway's station map kiosks, PR #71) are no loot holders at all: no lot can ever land there
    expect(isLootHolderKind('subwayMapKiosk')).toBe(false);
  });
});

describe('additive: every other find is exactly as before; the lot is finite, fits and is placed clear of the others', () => {
  it.each([['subway', 101], ['office', 11], ['skyways', 4], ['market', 11]] as [LevelId, number][])('%s %i: other lots byte-identical; salvage lots on real surfaces, clear of every lot', (level, seed) => {
    const l = gen(level, seed), P = lootProfile(level);
    const a = layoutHolders(l, P), b = layoutHolders(l, withoutSalvage(P));
    let salvage = 0;
    a.forEach((h, i) => {
      expect(h.lots.filter(x => !isSalvageLotId(x.id)), `${h.kind}#${h.index}@${h.areaType}`).toEqual(b[i].lots);
      const sv = h.lots.filter(x => isSalvageLotId(x.id));
      expect(sv.length).toBeLessThanOrEqual(1); // ONE extra lot at most
      for (const s of sv) {
        salvage++;
        expect(s.id).toBe(h.index * 1000 + SALVAGE_ID);
        expect(isMaterialItem(s.itemId)).toBe(true);
        expect(extraSalvageRule(h.kind, h.areaType, P)).toBeDefined();
        const bx = placementBox(s.itemId, s);
        for (const o of h.lots) if (o !== s) expect(lotBoxesOverlap(bx, placementBox(o.itemId, o)), `${h.kind}#${h.index} lot ${o.id}`).toBe(false);
      }
    });
    expect(salvage, `${level} ${seed} salvage lots`).toBeGreaterThan(0);
    // no floor scatter: the layout's loose pickups never gain a material (the mall's own loose salvage is its floor program, untouched)
    for (const p of l.pickups) expect(isMaterialItem(p.itemId), `${level} pickup ${p.itemId}`).toBe(false);
  }, 60000);

  it('the mall and the Reactor: no base salvage lot anywhere (their own salvage rows, applied once)', () => {
    for (const level of ['mall', 'reactor'] as LevelId[]) {
      const l = gen(level, 11), P = lootProfile(level);
      for (const h of layoutHolders(l, P)) {
        expect(h.lots.some(x => isSalvageLotId(x.id)), `${level} ${h.kind}`).toBe(false);
        expect(extraSalvageRule(h.kind, h.areaType, P)).toBeUndefined();
      }
    }
    // the mall's rows mode: its salvage rows join the table exactly once
    const t = holderTable('stockShelf', 'mall-electronics', PROFILES.mall);
    const mats = t.rows.filter(([id]) => econCat(id) === 'material').map(r => r[0]);
    expect(mats).toEqual(MALL_SALVAGE.purposes!['mall-electronics'].rows.map(r => r[0]));
  }, 120000);

  it('the market: basic salvage ONLY in its workshop storage — nothing else, no other category anywhere', () => {
    let workshopLots = 0;
    for (const seed of [11, 222, 3333]) {
      const l = gen('market', seed), P = lootProfile('market');
      for (const h of layoutHolders(l, P)) {
        for (const x of h.lots) {
          expect(isSalvageLotId(x.id) && isMaterialItem(x.itemId), `${seed} ${h.kind}@${h.areaType} ${x.itemId}`).toBe(true);
          expect(h.areaType, `${seed} ${h.kind}`).toBe(MARKET_WORKSHOP_KEY);
          workshopLots++;
        }
        // no holder's own table rolls anything (every slot 0 lots); finds of every kind empty but the salvage lot
        const finds = holderFinds(l.seed, h.index, h.kind, h.areaType, true, P);
        expect(finds.every(f => f.source === 'salvage'), `${seed} ${h.kind}@${h.areaType}`).toBe(true);
      }
    }
    expect(workshopLots).toBeGreaterThan(0);
  });
});

describe('finite and remembered: no refill, no reroll, old saves keep their holders exactly', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const build = (l: StationLayout) => {
    const inv = new Inventory(), cm = new ContainerManager({}, mats, () => inv);
    cm.build(l, {}, lootProfile('subway'));
    return {cm, inv};
  };

  it('a taken salvage lot never comes back; a holder remembered from BEFORE the base salvage never gains it; unvisited holders do', () => {
    const l = gen('subway', 101);
    const first = build(l);
    const withSv = first.cm.all.filter(h => h.state.lots.some(x => isSalvageLotId(x.id)));
    expect(withSv.length).toBeGreaterThanOrEqual(3);
    const [taken, oldSave, untouched] = withSv;
    // the player takes the first holder's salvage lot
    const lot = taken.state.lots.find(x => isSalvageLotId(x.id))!;
    taken.state.open = taken.state.searched = true;
    expect(takeLot(taken.state, lot.id, first.inv).taken.length).toBe(1);
    const recs = captureHolders(first.cm);
    expect(recs[holderKeyOf(taken)].lots.includes(lot.id)).toBe(false);
    // an old save: the second holder was realized before the base salvage existed (its record has no salvage lot id)
    recs[holderKeyOf(oldSave)] = {...recs[holderKeyOf(oldSave)], lots: recs[holderKeyOf(oldSave)].lots.filter(id => !isSalvageLotId(id))};
    // the third holder was never realized (an unvisited part of an old save): no record
    delete recs[holderKeyOf(untouched)];
    // the next build: the early drop (Game: right after ContainerManager.build), then the memory
    const again = build(l);
    const byKey = new Map(again.cm.all.map(h => [holderKeyOf(h), h]));
    const dropped = dropUnrecordedSalvage(again.cm, recs);
    expect(dropped).toBeGreaterThanOrEqual(2);
    applyHolders(again.cm, recs);
    expect(byKey.get(holderKeyOf(taken))!.state.lots.some(x => isSalvageLotId(x.id))).toBe(false);
    expect(byKey.get(holderKeyOf(oldSave))!.state.lots.some(x => isSalvageLotId(x.id))).toBe(false);
    expect(byKey.get(holderKeyOf(oldSave))!.state.lots.map(x => x.id)).toEqual(recs[holderKeyOf(oldSave)].lots);
    // new loot where nothing was realized yet
    expect(byKey.get(holderKeyOf(untouched))!.state.lots.some(x => isSalvageLotId(x.id))).toBe(true);
    // a remembered holder whose salvage lot was LEFT keeps it (no reroll)
    const kept = withSv.find(h => h !== taken && h !== oldSave && h !== untouched && recs[holderKeyOf(h)]?.lots.some(id => isSalvageLotId(id)));
    if (kept) expect(byKey.get(holderKeyOf(kept))!.state.lots.find(x => isSalvageLotId(x.id))).toEqual(kept.state.lots.find(x => isSalvageLotId(x.id)));
  }, 60000);

  it('the lot yields to a fuel can laid on it (ContainerManager.addLots); a can elsewhere leaves it', () => {
    const l = gen('subway', 101);
    const {cm} = build(l);
    const [a, b] = cm.all.filter(h => h.state.lots.some(x => isSalvageLotId(x.id)));
    const sa = a.state.lots.find(x => isSalvageLotId(x.id))!;
    const before = a.state.lots.length;
    // a can exactly where the salvage lot rests (fuel placement leaves salvage lots out of its taken room)
    expect(cm.addLots([{holder: a, lots: [{...sa, id: a.index * 1000 + 900, itemId: FUEL.canItem, count: 1, orient: 'up'}]}])).toBe(1);
    expect(a.state.lots.some(x => isSalvageLotId(x.id))).toBe(false);
    expect(a.state.lots.length).toBe(before); // the salvage lot out, the can in
    expect(a.state.rolled).toBe(a.state.lots.length);
    // a can far from b's salvage lot (another surface position) leaves it
    const sb = b.state.lots.find(x => isSalvageLotId(x.id))!;
    const far = {...sb, id: b.index * 1000 + 900, itemId: FUEL.canItem, count: 1, orient: 'up' as const, y: sb.y + 50};
    cm.addLots([{holder: b, lots: [far]}]);
    expect(b.state.lots.some(x => isSalvageLotId(x.id))).toBe(true);
  }, 60000);

  it('the lot is the same every time the holder is rolled (deterministic, its own stream); a holder without room places none', () => {
    const l = gen('subway', 101);
    const a = layoutHolders(l), b = layoutHolders(l);
    expect(a.map(h => h.lots)).toEqual(b.map(h => h.lots));
    const h = a.find(x => x.lots.some(y => isSalvageLotId(y.id)))!;
    // the entry is rolled before fit (holderFinds), the lot only where it fits
    expect(holderFinds(l.seed, h.index, h.kind, h.areaType, false, PROFILES.subway).filter(f => f.source === 'salvage')).toHaveLength(1);
    expect(rollHolderLots(l.seed, h.index, h.kind, h.areaType, [], PROFILES.subway).some(x => isSalvageLotId(x.id))).toBe(false);
  });
});
