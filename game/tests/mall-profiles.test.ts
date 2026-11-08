// Task track3-eaton-centre-20261031 (lane PROFILES): the mall's loot + spawn profiles. REWRITTEN for task mall-playtest-revision-20261031
// (lane PROFILES: D07 / D08 / U10 follow-up / U01 reference naming) — the COMPACT mall (station + 3 retail floors, ~6,400 m² of core
// floor + an optional Track2 tunnel / service annex; was six rings / ~43,800 m²):
//  - loot: PROFILES.mall = the shared base tables + the mall SALVAGE + the per-compartment STORAGE FILL + the per-storey floor program;
//    validation; Subway / Office profiles untouched (salvage / fill are identity there); the generic label (the display name is seeded);
//  - the NORMALISED MATERIAL CENSUS (tests/helpers/materialCensus.ts), core-to-core AND extension-inclusive, placed (after fit) +
//    reachable, per 100 m² of usable floor and per reachable holder — a meaningful advantage over the Office, consumables inside the guard;
//  - the drawers / cupboards (U10): stocked compartments of generated malls, themed fill (materials favoured), the dressings guard;
//  - enemies: SPAWN_PROFILES.mall re-proportioned (pit 3..5, ring 4..6, ambient budget 23 / 6; Siren 0.5 / cap 2 / 30 m; hordes 1..2
//    groups of 5..20 ordinary zombies, budget 32, route capacity, out of sight of the start), measured on generated malls per storey,
//    separate station / retail / service accounting; the RUNTIME registration path (every placed spawn becomes a live enemy on a real
//    floor, station / annex loot present); determinism; the reference documents the mall's dynamic identity and new numbers.
// Bounded: 3 registry malls + 3 Office levels (the census corpus), one extra mall generation (watched profile = determinism check).

import {describe, expect, it} from 'vitest';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel, mallVariantV2Of, setMallVariantOverride} from '../src/gen/mall/index';
import {mallFloorZone, placeMallSupplies} from '../src/gen/mall/supplies';
import {MALL_RINGS} from '../src/gen/mall/mallTypes';
import {MALL_GENERIC_NAME} from '../src/gen/mall/names';
import {purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';
import {Rng} from '../src/core/rng';
import {levelDistance} from '../src/gen/levelGen';
import {levelsOf} from '../src/gen/levels';
import {CELL} from '../src/gen/grid';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {holderTable, rollLootItems, type HolderKind} from '../src/items/loot';
import {salvageRule, withSalvage} from '../src/items/lootEconomy';
import {
  BASE_SALVAGE, BASE_TABLES, BASELINE_PROFILE, MALL_FLOOR, MALL_GEAR_PLACE, MALL_PROFILE, MALL_SALVAGE, MALL_STORAGE_FILL, PROFILES, STORAGE_FILL_FALLBACK, lootProfile, validateLootProfile,
  type LootProfile,
} from '../src/items/lootTables';
import {MATERIAL_IDS, isMaterialItem} from '../src/items/craftMaterials';
import {SIREN_HUM} from '../src/audio/sfx'; // mall round 3 (lane ENEMY, R8): the Siren spacing = her hum's audible distance
import {
  ENEMY_FAMILY_IDS, HORDE_CONTEXT, MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, MALL_SIREN_WEIGHT, MALL_SPAWN_PROFILE, SPAWN_PROFILES,
  MALL_AREA_WEIGHTS, MALL_PLACEMENT, MALL_RING_AREA_WEIGHTS, MALL_RING_PLACEMENT, MALL_SHOP_WEIGHT,
  declaredSpawnContexts, eligibilityFailure, familyPool, markSpawnContext, spawnContextOf, spawnProfile, validateSpawnProfile,
  type FamilyEligibility, type SpawnProfile,
} from '../src/ai/spawnTables';
import {assignEnemyArchetypes, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {applyFamilySpacing} from '../src/ai/familySpacing';
import {LINGERIE_CONTEXT, SERVICE_CONTEXT} from '../src/ai/spawnTables';
import {LINGERIE_STORES_MAX} from '../src/gen/mall/lingerieSpawns'; // task mall-lingerie-20261102-221554 (lane CONTEXT)
import {TRACK_EXT_MALL, isExtensionArea} from '../src/gen/trackExt/index'; // lane INTEG (Track2 integration)
import {HORDE_GROUP_SIZE, MALL_HORDE_RULES, validateHordeRules} from '../src/ai/hordeSpec';
import {patrolRouteM} from '../src/ai/hordePlace';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import {buildEnemyReference, ENEMY_LEVEL_ADAPTER} from '../../tools/pages/enemyReference';
import {compartmentCensus, holderTemplates, runCensus, simulatedStockedRate, stockedRate, summarize, type CensusSummary, type CompartmentCensus} from './helpers/materialCensus';
import {layoutHolderDetails} from './helpers/lootEconomy';

const MALL = lootProfile('mall');
const SEEDS = [11, 222, 3333];
const cache = new Map<string, StationLayout>();
// Task mall-round2-20261031 (lane GEN, M08): the census guards below were tuned on these seeds' original layouts; round 2 moved
// seed 222 to an added topology, so the sample stays pinned to each seed's pre-round-2 variant (mallVariantV2Of). The added variants
// measure inside the originals' range on this sample (lanes/GEN.done: e.g. food / 100 m² terrace-cross 0.78, twin-court 0.79).
const mall = (seed: number): StationLayout => {
  let l = cache.get(`mall:${seed}`);
  if (!l) {
    setMallVariantOverride(mallVariantV2Of(seed));
    try { cache.set(`mall:${seed}`, (l = LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'}))); } finally { setMallVariantOverride(null); }
  }
  return l;
};
const office = (seed: number): StationLayout => {
  let l = cache.get(`office:${seed}`);
  if (!l) cache.set(`office:${seed}`, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
const mallZone = (l: StationLayout) => (a: StationLayout['areas'][number]) => (a.ext ? `ext-${a.ext}` : (a.level ?? 0) === 0 ? 'station' : mallFloorZone(l, a));
const isExt = (a: StationLayout['areas'][number] | undefined) => !!a && isExtensionArea(a);
const sumMats = (r: Record<string, number>) => MATERIAL_IDS.reduce((s, id) => s + (r[id] ?? 0), 0);

let censusCache: {mall: CensusSummary; office: CensusSummary; mallCore: CensusSummary; officeCore: CensusSummary; storage: CompartmentCensus[]} | null = null;
const census = () => (censusCache ??= {
  mall: summarize(SEEDS.map(s => runCensus(mall(s), MALL, mallZone(mall(s))))),
  office: summarize(SEEDS.map(s => runCensus(office(s), lootProfile('office')))),
  // core-to-core: the Track2 extension areas (tunnel / service annex) left out of both levels
  mallCore: summarize(SEEDS.map(s => runCensus(mall(s), MALL, mallZone(mall(s)), {exclude: a => isExt(a)}))),
  officeCore: summarize(SEEDS.map(s => runCensus(office(s), lootProfile('office'), undefined, {exclude: a => isExt(a)}))),
  storage: SEEDS.map(s => compartmentCensus(mall(s), MALL, a => !isExt(a))),
});

describe('mall loot profile', () => {
  it('is registered, valid, the shared base tables + the mall salvage + storage fill; the Subway / Office profiles are untouched', () => {
    expect(PROFILES.mall).toBe(MALL_PROFILE);
    expect(validateLootProfile(MALL)).toEqual([]);
    for (const l of LEVEL_IDS) expect(validateLootProfile(lootProfile(l)), l).toEqual([]);
    // (U01) the label is the generic one: the mall's display name is seeded per run ("<Name> Center")
    expect(MALL.label).toMatch(/<Name> Center/);
    expect(MALL.label).not.toMatch(/Eaton/);
    // every rate table but the salvage / storage fill is the SAME object as the base tables: consumables, ammo / calibres, box sizes,
    // scarcity, limb shares, rare gear and rewards behave exactly as in the other levels
    // (task studio-base-salvage-20261108-073314-01: the base tables' own salvage — BASE_SALVAGE — is REPLACED by the mall's: one rule per holder)
    for (const [k, v] of Object.entries(BASE_TABLES)) if (k !== 'salvage') expect((MALL.tables as unknown as Record<string, unknown>)[k], k).toBe(v);
    expect(MALL.tables.salvage).toBe(MALL_SALVAGE);
    expect(MALL.tables.storageFill).toBe(MALL_STORAGE_FILL);
    // task mall-round3-20261031 (lane SHOPS, R6): + the rare-gear PLACEMENT bias (where the ONE roll lands: themed shops); the gear
    // roll itself (tables.gear: count / pieces) is still the base object above (tests/mall-themed-loot.test.ts)
    expect(MALL.tables.gearPlace).toBe(MALL_GEAR_PLACE);
    expect(MALL.tables.floor.mall).toBe(MALL_FLOOR);
    for (const l of ['subway', 'office'] as const) {
      expect(PROFILES[l].tables).toBe(BASE_TABLES);
      expect(PROFILES[l].overrides).toEqual({});
      expect(BASE_TABLES.salvage).toBe(BASE_SALVAGE); // (task base-salvage: the shared basic materials, additive)
      expect(BASE_TABLES.storageFill).toBeUndefined();
      expect(BASE_TABLES.gearPlace).toBeUndefined();
    }
    // the salvage keys are real purposes / themes; every salvage row is a crafting material
    for (const k of Object.keys(MALL_SALVAGE.purposes ?? {})) expect(purposeById(k), `salvage purpose ${k}`).toBeDefined();
    for (const r of [...Object.values(MALL_SALVAGE.purposes ?? {}), ...Object.values(MALL_SALVAGE.themes ?? {})]) {
      expect(r!.rows.every(([id]) => isMaterialItem(id))).toBe(true);
      expect(r!.share).toBeGreaterThan(0);
      expect(r!.share).toBeLessThan(0.5);
    }
    // the fill's snacks / drinks are a fallback (held back where the place stocks other fill rows), never the default draw
    expect([...STORAGE_FILL_FALLBACK].sort()).toEqual(['drink', 'food']);
  });

  it('salvage resolves at resolution time only where it fits (share exact; never coolers / medical fixtures / gun lockers / legacy / rewards)', () => {
    const t = holderTable('stockShelf' as HolderKind, 'mall-electronics', MALL);
    const rule = salvageRule(MALL, 'stockShelf', 'mall-electronics')!;
    expect(rule).toBe(MALL_SALVAGE.purposes!['mall-electronics']);
    const total = t.rows.reduce((s, r) => s + r[1], 0), mat = t.rows.filter(r => isMaterialItem(r[0])).reduce((s, r) => s + r[1], 0);
    // `share` is before overrides; the mall's categoryWeight.material dial then scales the salvage rows (no bio rows in this mix)
    const f = MALL.overrides.categoryWeight?.material ?? 1, eff = rule.share * f / (1 - rule.share + rule.share * f);
    expect(rule.rows.some(([id]) => id === 'bio_mater')).toBe(false);
    expect(mat / total).toBeCloseTo(eff, 10);
    const raw = holderTable('stockShelf' as HolderKind, 'mall-electronics', {...MALL, overrides: {}});
    expect(raw.rows.filter(r => isMaterialItem(r[0])).reduce((s, r) => s + r[1], 0) / raw.rows.reduce((s, r) => s + r[1], 0)).toBeCloseTo(rule.share, 10);
    // the theme entry reaches a purpose without its own entry (tech theme -> electronics salvage)
    expect(salvageRule(MALL, 'stockShelf', 'mall-music')).toBe(MALL_SALVAGE.themes!.tech);
    // fixtures that may not hold materials, legacy halls, junk, container-themed storage: no salvage
    for (const [kind, key] of [['shopCooler', 'mall-electronics'], ['medCabinet', 'mall-pharmacy'], ['gunLocker', 'mall-guns'], ['bin', 'mall-hardware'], ['serverRack', 'mall-electronics-back']] as const) {
      expect(salvageRule(MALL, kind, key), `${kind}@${key}`).toBeUndefined();
    }
    expect(holderTable('shelf' as HolderKind, 'concourse', MALL).source).toBe('legacy');
    expect(holderTable('shelf' as HolderKind, 'concourse', MALL).rows.some(r => isMaterialItem(r[0]))).toBe(false);
    // identity everywhere else: the baseline / Subway / Office profiles return the same array
    const rows = holderTable('stockShelf' as HolderKind, 'mall-electronics', BASELINE_PROFILE).rows;
    for (const P of [BASELINE_PROFILE, lootProfile('subway'), lootProfile('office')]) expect(withSalvage(P, 'stockShelf', 'mall-electronics', rows)).toBe(rows);
    // the rolled share matches: materials are kept exactly as rolled (no scarcity cut)
    let mats = 0;
    for (let i = 0; i < 3000; i++) for (const e of rollLootItems(7, i, 'stockShelf' as HolderKind, 'mall-electronics', MALL)) if (isMaterialItem(e.itemId)) mats++;
    const rolled = 3000 * (1 - t.empty) * (t.lots[0] + t.lots[1]) / 2;
    expect(Math.abs(mats / rolled - eff), `material lots ${mats} of ~${rolled.toFixed(0)} rolled`).toBeLessThan(0.03);
  });

  it('floor program: bounded per storey (station once + each of the 3 retail floors), materials on the floors, deterministic, on its own storey', () => {
    expect(MALL_RINGS).toBe(3);
    const l = mall(SEEDS[0]);
    const start = l.mall!.start, [sx, sy] = l.grid.cellOf(start.x, start.z);
    const field = {dist: levelDistance(l.levels, sx, sy, 0, l.levelLinks), keep: []};
    const before = l.pickups.length;
    const run = () => { try { return placeMallSupplies(l, new Rng(97).fork('mall-supplies-test'), field, [3], 'ring', MALL); } finally { l.pickups.length = before; } };
    const a = run(), b = run();
    expect(b).toEqual(a); // deterministic per fork
    const S = MALL_FLOOR.ring;
    expect(a.length).toBeLessThanOrEqual(S.ammo.draws + 3 * S.scarce.draws + S.salvage.n[1]);
    expect(a.every(p => p.level === 3 && (l.areas[p.area].level ?? 0) === 3)).toBe(true);
    const salv = a.filter(p => isMaterialItem(p.itemId));
    expect(salv.length).toBeLessThanOrEqual(S.salvage.n[1]);
    expect(salv.length).toBeGreaterThanOrEqual(S.salvage.n[0] - 1); // a draw with no free cell places nothing
    // in the generated level: every storey ran its program; loose materials on the core floors stay within the program bounds
    const loose = l.pickups.filter(p => isMaterialItem(p.itemId) && !isExt(l.areas[p.area]));
    expect(loose.length).toBeGreaterThanOrEqual(MALL_FLOOR.pit.salvage.n[0] + MALL_RINGS * S.salvage.n[0] - 3);
    expect(loose.length).toBeLessThanOrEqual(MALL_FLOOR.pit.salvage.n[1] + MALL_RINGS * S.salvage.n[1]);
    for (const p of loose) expect(l.areas[p.area].level ?? 0, `${p.itemId} area storey`).toBe(p.level ?? 0);
  });
});

describe('normalised material census (placed + reachable, mall vs Office, same method; core-to-core and extension-inclusive)', () => {
  it('crafting materials keep a meaningful advantage per reachable holder AND per 100 m²; consumables / ammo / cells stay in the shared economy', () => {
    const {mall: m, office: o, mallCore: mc, officeCore: oc} = census();
    const line = (name: string, s: CensusSummary) => `[mall-profiles] ${name}: ${s.runs} runs | usable ${s.perRun.usableM2} m² | holders ${s.perRun.holders} (reachable ${s.perRun.reachableHolders}, stocked ${s.perRun.stockedHolders}, with materials ${s.perRun.materialHolders}) | fill lots ${s.perRun.fillLots} | fit failures ${s.perRun.fitFailures} lots (${s.fitLossShare}) | unreachable units ${s.perRun.unreachableUnits}\n`
      + `   per run: ${JSON.stringify(s.perRun.units)} materials ${JSON.stringify(s.perRun.materials)}\n   per reachable holder: ${JSON.stringify(s.perHolder.materials)} | per 100 m²: ${JSON.stringify(s.per100m2.materials)} units ${JSON.stringify(s.per100m2.units)}\n`;
    const ratio = (a: CensusSummary, b: CensusSummary) => ({area: sumMats(a.per100m2.materials) / sumMats(b.per100m2.materials), holder: sumMats(a.perHolder.materials) / sumMats(b.perHolder.materials)});
    const core = ratio(mc, oc), ext = ratio(m, o);
    process.stdout.write(`\n${line('mall core', mc)}${line('office core', oc)}${line('mall + annex', m)}${line('office + annexes', o)}`
      + `[mall-profiles] materials mall / office: core ${core.area.toFixed(2)}x per 100 m², ${core.holder.toFixed(2)}x per reachable holder; with extensions ${ext.area.toFixed(2)}x / ${ext.holder.toFixed(2)}x\n`);
    // a meaningful advantage (no need for the old six-ring 8x), measured core-to-core AND whole-level
    for (const r of [core, ext]) { expect(r.area).toBeGreaterThan(5); expect(r.holder).toBeGreaterThan(3.5); }
    // ... not an avalanche: the open shelves keep a light share (the drawers hold most of it)
    expect(core.area).toBeLessThan(25);
    // each material is a real mall find (per run), bio mater included (the Office has none)
    for (const id of MATERIAL_IDS) expect(mc.perRun.materials[id], id).toBeGreaterThan(3);
    // finite and real: almost nothing lost to fit (holder rolls AND the storage fill), everything reachable from the arrival point
    expect(m.fitLossShare).toBeLessThan(0.05);
    expect(m.reachableShare).toBeGreaterThan(0.97);
    // the consumables guard (core per 100 m²): food / drink / dressings < 2.5x the Office's; ammo no richer than the Office; torch cells
    // (the storage fill's small themed items) < 4.5x
    for (const c of ['food', 'drink', 'med'] as const) expect(mc.per100m2.units[c], c).toBeLessThan(oc.per100m2.units[c] * 2.5);
    expect(mc.per100m2.units.ammo).toBeLessThan(oc.per100m2.units.ammo * 1.2);
    expect(mc.per100m2.units.battery).toBeLessThan(oc.per100m2.units.battery * 4.5);
  });

  it('drawers / cupboards (U10): roughly a third to a half of the compartments are stocked; themed fill, materials favoured, finite dressings', () => {
    const {storage} = census();
    const FILL = Object.keys(MALL_STORAGE_FILL);
    const all = stockedRate(storage, FILL), exMed = stockedRate(storage, FILL.filter(k => k !== 'medicineDrawerCabinet'));
    const kinds = [...new Set(storage.flatMap(s => Object.keys(s.byKind)))].filter(k => FILL.includes(k)).sort();
    const rows = kinds.map(k => ({k, ...stockedRate(storage, [k])}));
    const fill = Object.fromEntries(Object.keys(storage[0].fillUnits).map(c => [c, storage.reduce((s, x) => s + (x.fillUnits as Record<string, number>)[c], 0) / storage.length]));
    process.stdout.write(`\n[mall-profiles] drawer / cupboard compartments stocked (fill kinds, core): ${(all.rate * 100).toFixed(1)} % of ${all.comps} (without the medicine cabinet's pill drawers ${(exMed.rate * 100).toFixed(1)} %)\n   ${rows.map(r => `${r.k} ${(r.rate * 100).toFixed(0)} % of ${r.comps}`).join(' | ')}\n   fill units per run ${JSON.stringify(fill)}\n`);
    expect(all.rate).toBeGreaterThan(0.28);
    expect(all.rate).toBeLessThan(0.5);
    expect(exMed.rate).toBeGreaterThan(0.3);
    expect(exMed.rate).toBeLessThan(0.55);
    // the commonly opened drawers / cupboards of shops and stock rooms each hold something often — never every one
    // Task mall-round3 ci-followup (20261101): the per-kind floor (0.22; the tool chest 0.1) is checked on the 3-mall census when a kind
    // has >= 24 sampled compartments. Round 3's women's store (in every mall) took the unit seed 222's clinic used to stand in, so the
    // sample kept only 4 crash carts = 20 compartments: one compartment moves that rate by 5 points (0.20 measured), and the binomial
    // sd at p ~ 0.3, n = 20 is ~0.10 — 20 compartments cannot carry a 0.22 floor. For a kind with 12-23 sampled compartments the SAME
    // floor is enforced on a LARGE direct simulation of that kind's stocking through the real production path (items/loot.ts
    // createHolderState: its own table roll + the mall storage fill + packing on its real surfaces, the census's own holder inputs —
    // helpers/materialCensus.ts simulatedStockedRate, >= 2,000 holders on deterministic streams), and the small census sample must be
    // binomially consistent with that simulated rate (within 3 sigma). The 0.22 contract is unchanged.
    const SIM_HOLDERS = 2000;
    const tpl = (k: string) => SEEDS.flatMap(s => holderTemplates(mall(s), k, a => !isExt(a)));
    for (const r of rows) {
      if (r.comps < 12) continue; // too few in a 3-mall sample for a rate
      if (r.k === 'medicineDrawerCabinet') { expect(r.rate, r.k).toBeLessThan(0.3); continue; } // 33 pill drawers each: the dressings guard
      const floor = r.k === 'rollingToolChest' ? 0.1 : 0.22;
      expect(r.rate, r.k).toBeLessThan(0.75);
      if (r.comps >= 24) { expect(r.rate, r.k).toBeGreaterThan(floor); continue; }
      const sim = simulatedStockedRate(tpl(r.k), MALL, SIM_HOLDERS);
      process.stdout.write(`[mall-profiles] ${r.k}: census ${r.stocked} / ${r.comps} = ${r.rate.toFixed(3)}; simulated ${sim.stocked} / ${sim.comps} = ${sim.rate.toFixed(3)} (${sim.holders} holders)\n`);
      expect(sim.holders, `${r.k} simulated holders`).toBeGreaterThanOrEqual(SIM_HOLDERS);
      expect(sim.rate, `${r.k} simulated stocked rate`).toBeGreaterThan(floor);
      expect(sim.rate, `${r.k} simulated stocked rate`).toBeLessThan(0.75);
      const sd = Math.sqrt(sim.rate * (1 - sim.rate) / r.comps);
      expect(r.rate, `${r.k} census vs simulated (3 sigma)`).toBeGreaterThanOrEqual(sim.rate - 3 * sd);
      expect(r.rate, `${r.k} census vs simulated (3 sigma)`).toBeLessThanOrEqual(sim.rate + 3 * sd);
    }
    // what the fill puts inside: mostly the mall's crafting materials and small themed items; ammo only by the gun safe's arms rule;
    // dressings only in medical storage
    const fillTotal = Object.values(fill).reduce((a, b) => a + b, 0);
    expect(fill.material / fillTotal).toBeGreaterThan(0.5);
    for (const s of storage) for (const [k, c] of Object.entries(s.fillByKind)) {
      if (c.ammo) expect(k, 'ammo only by the arms rule').toBe('gunSafeTall');
      if (c.med) expect(['pharmacyDispensaryCounter', 'medicineDrawerCabinet', 'examTable', 'labBench', 'biohazardFridge', 'crashCart']).toContain(k);
      for (const cat of ['weapon', 'gear'] as const) expect(c[cat] ?? 0, `${k} ${cat}`).toBe(0);
    }
  });
});

describe('mall spawn profile', () => {
  const P = spawnProfile('mall');
  it('is registered and valid: station once, retail floor per floor, Track2 service per annex; Track1 pool + Siren rule + spacing + horde', () => {
    expect(SPAWN_PROFILES.mall).toBe(MALL_SPAWN_PROFILE);
    expect(LEVELS.mall.tier).toBe(2);
    expect(LEVELS.mall.name).toBe(MALL_GENERIC_NAME);
    expect(P.label).toMatch(/<Name> Center/);
    expect(validateSpawnProfile(P)).toEqual([]);
    // (task mall-lingerie-20261102-221554, lane CONTEXT: + 'lingerie', the optional lingerie store's store-local zone)
    expect(Object.keys(P.contexts).sort()).toEqual(['lingerie', 'pit', 'ring', 'service']);
    expect(declaredSpawnContexts(P).sort()).toEqual([HORDE_CONTEXT, 'lingerie', 'pit', 'ring', 'service'].sort());
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.ring!.runs).toBe(MALL_RINGS);
    // (mall revision, D07) re-proportioned to the compact mall: the counts of one run per storey
    expect(P.contexts.pit!.count).toEqual([3, 5]);
    expect(P.contexts.ring!.count).toEqual([4, 6]);
    expect(P.budgets!.ambient).toEqual({total: 23, perStorey: 6});
    expect(P.budgets!.ambient.total).toBeGreaterThanOrEqual(P.contexts.pit!.count[1] + MALL_RINGS * P.contexts.ring!.count[1]);
    // lane INTEG (Track2 integration): 'service' is Track2's per-annex zone budget, as on the Subway / Office (one run per seeded annex)
    expect(P.contexts.service).toBe(SERVICE_CONTEXT);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.runs).toBe(1);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.zone?.runsPerLevel).toEqual([0, TRACK_EXT_MALL.annex.max]);
    expect(TRACK_EXT_MALL.annex.max).toBe(1);
    expect(MALL_SIREN_ELIGIBILITY.contexts).not.toContain('service'); // no Siren in an annex
    // lane CONTEXT: the lingerie store's zone — once per store (0..1 per mall), its own zombie-only pool, no Siren rule names it
    expect(P.contexts.lingerie).toBe(LINGERIE_CONTEXT);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.lingerie!.runs).toBe(1);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.lingerie!.zone?.runsPerLevel).toEqual([0, LINGERIE_STORES_MAX]);
    expect(MALL_SIREN_ELIGIBILITY.contexts).not.toContain('lingerie');
    expect(LINGERIE_CONTEXT.families!.filter(([, w]) => w > 0)).toEqual([['zombie', 1]]);
    // Track1 pool: every family in registry order, Blightbelly / rat-dog 5 % ambient, the Siren's census-tuned draw weight (not the Office's)
    expect(P.families).toEqual(familyPool({siren: MALL_SIREN_WEIGHT}));
    expect(P.families.map(([f]) => f)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(Object.fromEntries(P.families)).toMatchObject({blightbelly: 0.05, ratdog: 0.05, siren: MALL_SIREN_WEIGHT});
    expect(MALL_SIREN_WEIGHT).toBe(0.8); // (mall round 3, R8: kept — the Blightbelly / rat-dog draw bands keep their spawn indices)
    expect(P.rooms).toEqual({});
    // the Siren: retail-floor shops only (never the station, an annex or a horde), the Office's gates, <= 4 per mall (mall round 3, R8: the
    // Office's cap), zombie fallback; 24 m apart (her hum's audible distance)
    expect(P.eligibility).toEqual({siren: MALL_SIREN_ELIGIBILITY});
    expect(MALL_SIREN_ELIGIBILITY).toMatchObject({contexts: ['ring'], kinds: ['room'], minSideCells: 8, minAreaCells: 100, clearCells: 1, doorKeepM: 3, passageRadiusM: 2.5, maxPerLevel: 4, fallback: 'zombie'});
    for (const k of ['washroom', 'stair-core', 'storage', 'utility']) expect(MALL_SIREN_ELIGIBILITY.excludeRooms).toContain(k);
    expect(P.spacing).toEqual({siren: MALL_SIREN_SPACING});
    expect(MALL_SIREN_SPACING.spacingM).toBe(SIREN_HUM.maxDist);
    expect(MALL_SIREN_SPACING.spacingM).toBe(24);
    // (mall round 3, R8) retail-floor placement weights the shop sales floors; the station storey keeps the generic mall weights
    expect(P.contexts.ring!.placement).toBe(MALL_RING_PLACEMENT);
    expect(P.contexts.pit!.placement).toBe(MALL_PLACEMENT);
    expect(MALL_RING_PLACEMENT).toEqual({...MALL_PLACEMENT, areaWeights: MALL_RING_AREA_WEIGHTS});
    expect(MALL_RING_AREA_WEIGHTS.rules[0]).toMatchObject({when: {type: ['shop']}, weight: MALL_SHOP_WEIGHT});
    expect(MALL_RING_AREA_WEIGHTS.rules.slice(1)).toEqual(MALL_AREA_WEIGHTS.rules);
    expect(MALL_RING_AREA_WEIGHTS.otherwise).toBe(MALL_AREA_WEIGHTS.otherwise);
    expect(MALL_SHOP_WEIGHT).toBe(6);
    // the horde pool: explicit (every registry family listed), ordinary zombies only, 5..20 per group, fewer groups, smaller budget,
    // route capacity and an out-of-sight start (lane PROFILES' MALL_HORDE_RULES)
    const H = P.horde!;
    expect(validateHordeRules(H, ENEMY_FAMILY_IDS)).toEqual([]);
    expect(H.size).toEqual([HORDE_GROUP_SIZE.min, HORDE_GROUP_SIZE.max]);
    expect(H.groups).toEqual([1, 2]);
    expect(H.budget).toEqual({total: 32, perStorey: 20, groupsPerStorey: 1});
    expect(H.placement).toBe(MALL_HORDE_RULES.placement);
    expect(H.placement).toMatchObject({startM: 45, routeMPerMember: 18, startClearM: 28});
    expect(Object.fromEntries(H.families)).toEqual({zombie: 1, blightbelly: 0, siren: 0, ratdog: 0, strainer: 0}); // round 4 (lane FAMILY): + strainer 0
  });

  it('validation enforces the Siren / spacing / horde / budget semantics', () => {
    const rule = MALL_SIREN_ELIGIBILITY;
    const bad: [string, SpawnProfile, RegExp][] = [
      ['siren weighted without a rule', {...P, eligibility: undefined, spacing: undefined}, /opt-in family .* needs an eligibility.siren rule/],
      ['siren eligible in a horde', {...P, eligibility: {siren: {...rule, contexts: ['ring', HORDE_CONTEXT]}}}, /separate pool/],
      ['horde declared as an ambient context', {...P, contexts: {...P.contexts, [HORDE_CONTEXT]: P.contexts.ring!}}, /reserved for the separate horde pool/],
      ['spacing without an eligibility rule', {...P, spacing: {blightbelly: {spacingM: 10, why: 'x'}}}, /refines eligibility.blightbelly/],
      ['spacing of 0 m', {...P, spacing: {siren: {spacingM: 0, why: 'x'}}}, /not a finite distance > 0/],
      ['spacing without a reason', {...P, spacing: {siren: {spacingM: 30, why: ' '}}}, /needs a reason/],
      ['spacing unknown knob', {...P, spacing: {siren: {...MALL_SIREN_SPACING, cap: 2} as never}}, /unknown knob/],
      ['siren in the horde pool', {...P, horde: {...P.horde!, families: [['zombie', 1], ['blightbelly', 0], ['siren', 0.1], ['ratdog', 0]]}}, /siren never joins/],
      ['horde pool missing a family', {...P, horde: {...P.horde!, families: [['zombie', 1]]}}, /family blightbelly missing/],
      ['horde group above 20', {...P, horde: {...P.horde!, size: [5, 25]}}, /./],
      ['horde route capacity of 0 m', {...P, horde: {...P.horde!, placement: {...P.horde!.placement, routeMPerMember: 0}}}, /routeMPerMember/],
      ['horde start keep-off negative', {...P, horde: {...P.horde!, placement: {...P.horde!.placement, startClearM: -1}}}, /startClearM/],
      ['ambient budget below a context', {...P, budgets: {ambient: {total: 23, perStorey: 5}}}, /perStorey/],
    ];
    for (const [what, p, re] of bad) expect(validateSpawnProfile(p).join('\n'), what).toMatch(re);
    // a rule naming the pit would be VALID data (the station is a declared context): the mall's own rule is what keeps her out of it
    expect(validateSpawnProfile({...P, eligibility: {siren: {...rule, contexts: ['pit', 'ring']}}})).toEqual([]);
    expect(rule.contexts).toEqual(['ring']);
  });

  it('generated mall: exactly pit + ring (+ service, lingerie) asked; per-storey ambient within counts / budgets; Sirens eligible + spaced; hordes within route capacity, out of sight; separate accounting; deterministic', () => {
    const seen = new Set<string>();
    const contexts = new Proxy(P.contexts, {get: (t, k) => { if (typeof k === 'string') seen.add(k); return Reflect.get(t, k); }});
    const watched = generateMallLevel({levelSeed: SEEDS[0], startWeapon: 'pistol'}, {spawns: {...P, contexts} as SpawnProfile});
    // (lane INTEG: Track2's populateExtensions reads the 'service' zone context on every call, annexes or not; lane CONTEXT: the
    // lingerie pass reads its 'lingerie' zone context on every call, store or not)
    expect([...seen].filter(k => k in P.contexts).sort()).toEqual(['lingerie', 'pit', 'ring', 'service']);
    // determinism: the watched profile is the same data -> the identical level as the registry's generation
    const l0 = mall(SEEDS[0]);
    expect(JSON.stringify(watched.zombies)).toBe(JSON.stringify(l0.zombies));
    expect(JSON.stringify(watched.pickups)).toBe(JSON.stringify(l0.pickups));
    expect(JSON.stringify(watched.hordes)).toBe(JSON.stringify(l0.hordes));
    const report: string[] = [];
    const H = P.horde!;
    for (const seed of SEEDS) {
      const l = mall(seed);
      const ctx = (i: number) => spawnContextOf(l, P, i);
      // (Track2 integration: 'service' annex spawns are appended last, tagged, and NOT part of the station / retail counts)
      const service = l.zombies.filter((z, i) => z.horde === undefined && ctx(i) === 'service');
      // (lane CONTEXT: the lingerie store's store-local spawns are a zone of their own: not ambient, never counted with the storeys)
      const store = l.zombies.filter((z, i) => z.horde === undefined && ctx(i) === 'lingerie');
      expect(store.every(z => z.look === 'lingerie' && z.archetype === 'zombie')).toBe(true);
      expect(l.zombies.filter(z => z.look === 'lingerie')).toEqual(store);
      const ambient = l.zombies.filter((z, i) => z.horde === undefined && ctx(i) !== 'service' && ctx(i) !== 'lingerie'), horde = l.zombies.filter(z => z.horde !== undefined);
      expect(service.every(z => isExtensionArea(l.areas[z.area]))).toBe(true);
      expect(service.length).toBeLessThanOrEqual((l.extensions?.annexes.length ?? 0) * SERVICE_CONTEXT.count[1]);
      expect(l.extensions?.annexes.length ?? 0).toBeLessThanOrEqual(TRACK_EXT_MALL.annex.max);
      expect(service.every(z => z.archetype !== 'siren')).toBe(true);
      // every spawn carries its declared context: ambient 'pit' (storey 0) / 'ring' (storeys 1..3), horde members 'horde'
      l.zombies.forEach((z, i) => expect(ctx(i), `seed ${seed} #${i}`).toBe(z.horde !== undefined ? HORDE_CONTEXT : z.look === 'lingerie' ? 'lingerie' : isExtensionArea(l.areas[z.area]) ? 'service' : (z.level ?? 0) === 0 ? 'pit' : 'ring'));
      // order: ambient, then hordes, then the annex 'service' spawns, then the lingerie store's (the family roll and run memory key on
      // the index)
      const firstHorde = l.zombies.findIndex(z => z.horde !== undefined);
      if (firstHorde >= 0) expect(l.zombies.slice(firstHorde).every((z, k) => z.horde !== undefined || ctx(firstHorde + k) === 'service' || ctx(firstHorde + k) === 'lingerie')).toBe(true);
      const firstService = l.zombies.findIndex((_, i) => ctx(i) === 'service');
      if (firstService >= 0) expect(l.zombies.slice(firstService).every((_, k) => ctx(firstService + k) === 'service' || ctx(firstService + k) === 'lingerie')).toBe(true);
      const firstStore = l.zombies.findIndex((_, i) => ctx(i) === 'lingerie');
      if (firstStore >= 0) expect(l.zombies.slice(firstStore).every((_, k) => ctx(firstStore + k) === 'lingerie')).toBe(true);
      // ambient: per storey within its context's count range, total within the ambient budget, families from the pool
      const perStorey: number[] = [];
      for (let lv = 0; lv <= MALL_RINGS; lv++) {
        const n = ambient.filter(z => (z.level ?? 0) === lv).length, c = (lv === 0 ? P.contexts.pit : P.contexts.ring)!;
        perStorey.push(n);
        expect(n, `seed ${seed} storey ${lv}`).toBeGreaterThanOrEqual(c.count[0]);
        expect(n).toBeLessThanOrEqual(Math.min(c.count[1], P.budgets!.ambient.perStorey));
      }
      expect(ambient.length).toBeLessThanOrEqual(P.budgets!.ambient.total);
      expect(ambient.every(z => (ENEMY_FAMILY_IDS as readonly string[]).includes(z.archetype ?? 'zombie'))).toBe(true);
      // Sirens: drawn by the roll, eligible retail-floor shop / stock-room slots only, <= 4, >= 24 m apart (mall round 3, R8); the post-pass is idempotent
      const sirens = l.zombies.map((z, i) => [z, i] as const).filter(([z]) => z.archetype === 'siren');
      expect(sirens.length).toBeLessThanOrEqual(MALL_SIREN_ELIGIBILITY.maxPerLevel!);
      for (const [z, i] of sirens) {
        expect(z.horde).toBeUndefined();
        expect((z.level ?? 0) >= 1).toBe(true);
        expect(['shop', 'stock-room']).toContain(l.areas[z.area].type);
        expect(eligibilityFailure(MALL_SIREN_ELIGIBILITY, l, z, ctx(i))).toBeNull();
        expect(pickEnemyArchetype(l.seed, i, P.families)).toBe('siren');
      }
      for (let a = 0; a < sirens.length; a++) for (let b = a + 1; b < sirens.length; b++) {
        const [p, q] = [sirens[a][0], sirens[b][0]];
        expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z)).toBeGreaterThanOrEqual(MALL_SIREN_SPACING.spacingM);
      }
      const before = JSON.stringify(l.zombies);
      assignEnemyArchetypes(l, P);
      applyFamilySpacing(l, P);
      expect(JSON.stringify(l.zombies)).toBe(before);
      // hordes: their own pool (ordinary zombies), 5..20 per group, the horde budgets, the start floor's route capacity, retail floors
      // only, >= startM walking and >= startClearM straight from the player start — never counted as ambient
      const st = l.mall!.start, [sx, sy] = l.grid.cellOf(st.x, st.z), dist = levelDistance(l.levels, sx, sy, 0, l.levelLinks);
      const hs = l.hordes ?? [];
      expect(hs.length).toBeLessThanOrEqual(H.groups[1]);
      expect(horde.length).toBeLessThanOrEqual(H.budget.total);
      for (const h of hs) {
        expect(h.members.length).toBeGreaterThanOrEqual(H.size[0]);
        expect(h.members.length).toBeLessThanOrEqual(Math.min(H.size[1], H.budget.perStorey, Math.floor(patrolRouteM(l.mall!.patrol, h.level) / H.placement.routeMPerMember!)));
        expect([1, 2, 3]).toContain(h.level);
        const g = l.levels[h.level].grid, [cx, cy] = g.cellOf(h.start.x, h.start.z);
        expect(dist[h.level][g.idx(cx, cy)] * CELL).toBeGreaterThanOrEqual(H.placement.startM - CELL);
        expect(Math.hypot(h.start.x - st.x, h.start.y, h.start.z - st.z)).toBeGreaterThanOrEqual(H.placement.startClearM!);
        expect(hs.filter(o => o.level === h.level).length).toBeLessThanOrEqual(H.budget.groupsPerStorey);
      }
      expect(horde.every(z => z.archetype === undefined || z.archetype === 'zombie')).toBe(true);
      const fam = (f: string) => ambient.filter(z => (z.archetype ?? 'zombie') === f).length;
      report.push(`seed ${seed} (${l.mall!.variant}, "${l.mall!.name}"): ambient ${ambient.length} [station ${perStorey[0]} / floors ${perStorey.slice(1).join(' / ')}] (siren ${fam('siren')}, blightbelly ${fam('blightbelly')}, ratdog ${fam('ratdog')}), hordes ${hs.length} [${hs.map(h => `L${h.level}:${h.members.length}`).join(' ')}] = ${horde.length}, service ${service.length} (annexes ${l.extensions?.annexes.length ?? 0})`);
    }
    process.stdout.write(`\n[mall-profiles] spawns:\n   ${report.join('\n   ')}\n`);
  });

  it('runtime registration (D07 trace): every placed spawn becomes a live enemy on a real floor of its storey (station, retail, horde, annex); station / annex loot present', () => {
    // game.ts buildSection spawns EVERY layout.zombies index not killed in the run memory (run/memory.ts enemiesToSpawn) — no culling,
    // frame-budget or distance gate (actors are added to the scene directly; the level culler registers only holders / stock), only a
    // Siren whose model is missing is skipped (counted, never a stand-in); spawnEnemy puts the body at s.y ?? the storey grid's floor.
    for (const seed of SEEDS) {
      const l = mall(seed), L = levelsOf(l);
      const live = enemiesToSpawn(l.zombies.length, createMemory({level: 'mall', section: 'main'}));
      expect(live.length, `seed ${seed}: a fresh run spawns every placed enemy`).toBe(l.zombies.length);
      const byContext: Record<string, number> = {};
      for (const i of live) {
        const z = l.zombies[i], lv = z.level ?? 0, g = l.levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z);
        const y = z.y ?? g.floorAt(z.x, z.z); // spawnEnemy's height rule
        const a = l.areas[z.area];
        expect(a, `seed ${seed} #${i} area`).toBeDefined();
        expect(a.level ?? 0, `seed ${seed} #${i} area storey`).toBe(lv);
        expect(g.walkable(cx, cy), `seed ${seed} #${i} (${spawnContextOf(l, P, i)}) stands on walkable floor`).toBe(true);
        const s = L.supportIn(z.x, z.z, y + 0.05, 0.45);
        expect(s, `seed ${seed} #${i} supported`).not.toBeNull();
        expect(s!.level, `seed ${seed} #${i} support storey`).toBe(lv);
        expect(Math.abs(s!.floor - y), `seed ${seed} #${i} floor`).toBeLessThan(0.35);
        const c = spawnContextOf(l, P, i)!;
        byContext[c] = (byContext[c] ?? 0) + 1;
      }
      expect(byContext.pit ?? 0, `seed ${seed}: station enemies`).toBeGreaterThanOrEqual(P.contexts.pit!.count[0]);
      if (l.extensions?.annexes.length) expect(byContext.service ?? 0, `seed ${seed}: annex enemies`).toBeGreaterThanOrEqual(SERVICE_CONTEXT.count[0]);
      // loot in the station storey and the annex: holders with lots (rolled as ContainerManager.build does) and loose finds
      const holders = layoutHolderDetails(l, MALL);
      const stationCore = holders.filter(h => (l.areas[h.prop.area]?.level ?? 0) === 0 && !isExt(l.areas[h.prop.area]));
      expect(stationCore.length, `seed ${seed}: station holders`).toBeGreaterThan(10);
      expect(stationCore.filter(h => h.lots.length).length, `seed ${seed}: stocked station holders`).toBeGreaterThan(2);
      expect(l.pickups.some(p => (p.level ?? 0) === 0 && !isExt(l.areas[p.area])), `seed ${seed}: station loose finds`).toBe(true);
      if (l.extensions?.annexes.length) {
        const annex = holders.filter(h => l.areas[h.prop.area]?.ext === 'annex');
        expect(annex.length, `seed ${seed}: annex holders`).toBeGreaterThan(10);
        expect(annex.filter(h => h.lots.length).length, `seed ${seed}: stocked annex holders`).toBeGreaterThan(1);
      }
    }
  });

  it('applyFamilySpacing: cap + spacing jointly in spawn-index order (a capped draw is placed once an earlier one is spaced out); others / hordes untouched', () => {
    // synthetic retail storey: one eligible room, a near-certain Siren draw (test pool), cap 2, 10 m spacing
    const T: SpawnProfile = {
      ...P, families: familyPool({siren: 0.85}),
      eligibility: {siren: {contexts: ['ring'], maxPerLevel: 2, fallback: 'zombie', why: 'test'} satisfies FamilyEligibility},
      spacing: {siren: {spacingM: 10, why: 'test'}},
    };
    expect(validateSpawnProfile(T)).toEqual([]);
    const seed = 77;
    const draws = Array.from({length: 40}, (_, i) => pickEnemyArchetype(seed, i, T.families));
    const sirenIdx = draws.flatMap((f, i) => (f === 'siren' ? [i] : [])).slice(0, 5);
    expect(sirenIdx.length).toBe(5);
    const n = sirenIdx[4] + 1;
    // A (0 m) kept, B (5 m: too close to A) spaced, C (30 m) kept — assignEnemyArchetypes alone capped it —, D (60 m) capped, E: horde
    const xs = [0, 5, 30, 60, 90];
    const L = {
      seed, areas: [{type: 'shop' as const, purpose: 'mall-vacant', kind: 'room' as const, w: 40, h: 40}],
      zombies: Array.from({length: n}, (_, i) => ({x: 500 + i * 50, z: 0, y: 5, level: 1, area: 0, archetype: undefined as string | undefined, horde: undefined as number | undefined})),
    };
    sirenIdx.forEach((i, k) => { L.zombies[i].x = xs[k]; });
    L.zombies[sirenIdx[4]].horde = 0;
    markSpawnContext(L, 0, 'ring');
    assignEnemyArchetypes(L as never, T);
    expect(sirenIdx.map(i => L.zombies[i].archetype)).toEqual(['siren', 'siren', 'zombie', 'zombie', undefined]); // Track1's cap alone
    const others = L.zombies.map((z, i) => (sirenIdx.includes(i) ? null : z.archetype));
    const rep = applyFamilySpacing(L as never, T);
    expect(sirenIdx.map(i => L.zombies[i].archetype)).toEqual(['siren', 'zombie', 'siren', 'zombie', undefined]);
    expect(rep).toEqual([{family: 'siren', eligible: 4, kept: 2, spaced: 1, capped: 1}]);
    expect(L.zombies.map((z, i) => (sirenIdx.includes(i) ? null : z.archetype))).toEqual(others);
    // a profile without spacing is a no-op
    const snap = JSON.stringify(L.zombies);
    expect(applyFamilySpacing(L as never, {...T, spacing: undefined})).toEqual([]);
    expect(JSON.stringify(L.zombies)).toBe(snap);
  });
});

describe('reference coverage (the generated pages document the mall automatically)', () => {
  it('the enemy reference shows the dynamic identity, tier, contexts, the Siren rule with its spacing, the horde pool and the ambient budget', () => {
    const r = buildEnemyReference({censusSeeds: []});
    const m = r.levels.find(l => l.id === 'mall')!;
    expect(m.tier.value).toBe(2);
    expect(m.name).toBe(MALL_GENERIC_NAME);
    expect(JSON.stringify(m)).not.toMatch(/Eaton/);
    expect(m.generator.note).toMatch(/<Name> Center/);
    expect(m.contexts.map(c => [c.id, c.runs])).toEqual([['pit', 1], ['ring', MALL_RINGS], ['service', 1], ['lingerie', 1]]); // (+ lane CONTEXT's store zone)
    expect(m.contexts.find(c => c.id === 'lingerie')!.zone).toMatchObject({runsPerLevel: {lo: 0, hi: LINGERIE_STORES_MAX}}); // (a zone: not in the total)
    expect(m.contexts.find(c => c.id === 'service')!.zone).toMatchObject({runsPerLevel: {lo: 0, hi: TRACK_EXT_MALL.annex.max}}); // (Track2: a zone, not in the total)
    const S = spawnProfile('mall');
    expect(m.total.mean).toBe((S.contexts.pit!.count[0] + S.contexts.pit!.count[1]) / 2 + MALL_RINGS * (S.contexts.ring!.count[0] + S.contexts.ring!.count[1]) / 2);
    expect(m.pool.rows.map(x => [x.family, x.weight])).toEqual(familyPool({siren: MALL_SIREN_WEIGHT}).map(([f, w]) => [f, w]));
    // (mall round 3, lane ENEMY R8: cap 4, 24 m — read from the live rule)
    expect(m.pool.eligibility.map(e => [e.family, e.contexts, e.maxPerLevel, e.spacing?.metres])).toEqual([['siren', ['ring'], MALL_SIREN_ELIGIBILITY.maxPerLevel, MALL_SIREN_SPACING.spacingM]]);
    expect(m.pool.eligibility[0].criteria.join(' ')).toMatch(new RegExp(`${MALL_SIREN_SPACING.spacingM} m`));
    expect(m.knobs.find(k => k.what === 'spacing (siren, m)')!.value).toBe(MALL_SIREN_SPACING.spacingM);
    expect(m.horde!.pool.rows.map(x => [x.family, x.weight])).toEqual([['zombie', 1], ['blightbelly', 0], ['siren', 0], ['ratdog', 0], ['strainer', 0]]); // (round 4, lane FAMILY: + strainer 0)
    expect(m.horde!.semantics.join(' ')).toMatch(new RegExp(`'${HORDE_CONTEXT}'`));
    expect(m.horde!.size).toMatchObject({lo: 5, hi: 20});
    expect(m.budgets!.ambient.total).toBe(S.budgets!.ambient.total);
    // the shipped levels carry none of the mall's extras (their reference numbers are unchanged)
    for (const id of ['subway', 'office']) { const l = r.levels.find(x => x.id === id)!; expect([l.horde, l.budgets]).toEqual([null, null]); expect(l.pool.eligibility.every(e => e.spacing === null)).toBe(true); }
  });

  it('the material census helper works for any registered level profile (the mall profile is the one ContainerManager.build passes)', () => {
    const p: LootProfile = lootProfile('mall');
    expect(p.id).toBe('mall');
    expect(MALL_FLOOR.ring.salvage.items.every(([id]) => isMaterialItem(id))).toBe(true);
  });
});
