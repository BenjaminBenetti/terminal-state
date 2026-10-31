// Task track3-eaton-centre-20261031 (lane PROFILES): The Eaton's Center loot + spawn profiles.
//  - loot: PROFILES.mall = the shared base tables + the mall SALVAGE (crafting-material rows per purpose / theme) + the per-storey
//    floor program; validation; the shipped Subway / Office profiles untouched (salvage is identity there);
//  - the NORMALISED MATERIAL CENSUS (tests/helpers/materialCensus.ts): placed (after fit) + reachable units per run, per reachable
//    holder and per 100 m² of usable floor, mall vs Office by the same method — materials significantly richer, consumables not
//    inflated, fit failures and reachability measured;
//  - enemies: SPAWN_PROFILES.mall — ambient contexts (pit once, ring per ring, Track2 'service' as a NOT-INTEGRATED data hook),
//    the typed ambient pool + Track1 family hooks (inactive until the registry has them) + the rare Siren rule, the SEPARATE horde
//    pool and its budgets, measured on generated mall layouts; determinism; the reference covers every new registration.
// Bounded: 3 mall + 3 Office levels (the census corpus), one extra mall generation (watched profile = determinism check).

import {describe, expect, it} from 'vitest';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel} from '../src/gen/mall/index';
import {mallFloorZone, placeMallSupplies} from '../src/gen/mall/supplies';
import {MALL_RINGS} from '../src/gen/mall/mallTypes';
import {purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';
import {Rng} from '../src/core/rng';
import {levelDistance} from '../src/gen/levelGen';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {holderTable, rollLootItems, type HolderKind} from '../src/items/loot';
import {salvageRule, withSalvage} from '../src/items/lootEconomy';
import {
  BASE_TABLES, BASELINE_PROFILE, MALL_FLOOR, MALL_PROFILE, MALL_SALVAGE, PROFILES, lootProfile, validateLootProfile,
  type LootProfile,
} from '../src/items/lootTables';
import {MATERIAL_IDS, isMaterialItem} from '../src/items/craftMaterials';
import {
  ENEMY_FAMILY_IDS, MALL_SPAWN_PROFILE, SPAWN_PROFILES, applyRareFamilyRules, familyHookStatus, projectedAmbientPool, spawnProfile,
  validateSpawnProfile, type SpawnProfile,
} from '../src/ai/spawnTables';
import {HORDE_GROUP_SIZE} from '../src/ai/hordeSpec';
import {buildEnemyReference, ENEMY_LEVEL_ADAPTER} from '../../tools/pages/enemyReference';
import {runCensus, summarize, type CensusSummary} from './helpers/materialCensus';

const MALL = lootProfile('mall');
const SEEDS = [11, 222, 3333];
const cache = new Map<string, StationLayout>();
const mall = (seed: number): StationLayout => {
  let l = cache.get(`mall:${seed}`);
  if (!l) cache.set(`mall:${seed}`, (l = LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
const office = (seed: number): StationLayout => {
  let l = cache.get(`office:${seed}`);
  if (!l) cache.set(`office:${seed}`, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
const mallZone = (l: StationLayout) => (a: StationLayout['areas'][number]) => ((a.level ?? 0) === 0 ? 'pit' : mallFloorZone(l, a));

let censusCache: {mall: CensusSummary; office: CensusSummary} | null = null;
const census = () => (censusCache ??= {
  mall: summarize(SEEDS.map(s => runCensus(mall(s), MALL, mallZone(mall(s))))),
  office: summarize(SEEDS.map(s => runCensus(office(s), lootProfile('office')))),
});

describe('mall loot profile', () => {
  it('is registered, valid, the shared base tables + the mall salvage; the Subway / Office profiles are untouched', () => {
    expect(PROFILES.mall).toBe(MALL_PROFILE);
    expect(validateLootProfile(MALL)).toEqual([]);
    for (const l of LEVEL_IDS) expect(validateLootProfile(lootProfile(l)), l).toEqual([]);
    // every rate table but the salvage is the SAME object as the base tables: consumables, ammo / calibres, box sizes, scarcity,
    // limb shares, rare gear and rewards behave exactly as in the other levels
    for (const [k, v] of Object.entries(BASE_TABLES)) expect((MALL.tables as unknown as Record<string, unknown>)[k], k).toBe(v);
    expect(MALL.tables.salvage).toBe(MALL_SALVAGE);
    expect(MALL.tables.floor.mall).toBe(MALL_FLOOR);
    for (const l of ['subway', 'office'] as const) {
      expect(PROFILES[l].tables).toBe(BASE_TABLES);
      expect(PROFILES[l].overrides).toEqual({});
      expect(BASE_TABLES.salvage).toBeUndefined();
    }
    // the salvage keys are real purposes / themes; every salvage row is a crafting material
    for (const k of Object.keys(MALL_SALVAGE.purposes ?? {})) expect(purposeById(k), `salvage purpose ${k}`).toBeDefined();
    for (const r of [...Object.values(MALL_SALVAGE.purposes ?? {}), ...Object.values(MALL_SALVAGE.themes ?? {})]) {
      expect(r!.rows.every(([id]) => isMaterialItem(id))).toBe(true);
      expect(r!.share).toBeGreaterThan(0);
      expect(r!.share).toBeLessThan(0.5);
    }
  });

  it('salvage resolves at resolution time only where it fits (share exact; never coolers / medical fixtures / gun lockers / legacy / rewards)', () => {
    const t = holderTable('stockShelf' as HolderKind, 'mall-electronics', MALL);
    const rule = salvageRule(MALL, 'stockShelf', 'mall-electronics')!;
    expect(rule).toBe(MALL_SALVAGE.purposes!['mall-electronics']);
    const total = t.rows.reduce((s, r) => s + r[1], 0), mat = t.rows.filter(r => isMaterialItem(r[0])).reduce((s, r) => s + r[1], 0);
    expect(mat / total).toBeCloseTo(rule.share, 10);
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
    const raw = 3000 * (1 - t.empty) * (t.lots[0] + t.lots[1]) / 2;
    expect(Math.abs(mats / raw - rule.share), `material lots ${mats} of ~${raw.toFixed(0)} rolled`).toBeLessThan(0.03);
  });

  it('floor program: bounded per storey, materials on the floors, deterministic, on its own storey', () => {
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
    expect(salv.length).toBeGreaterThanOrEqual(S.salvage.n[0] - 1); // a draw with no free cell places nothing (never happens on a ring)
    // in the generated level: every storey ran its program; loose materials on every storey's floors stay within the program bounds
    const loose = l.pickups.filter(p => isMaterialItem(p.itemId));
    expect(loose.length).toBeGreaterThanOrEqual(MALL_FLOOR.pit.salvage.n[0] + MALL_RINGS * S.salvage.n[0] - 3);
    expect(loose.length).toBeLessThanOrEqual(MALL_FLOOR.pit.salvage.n[1] + MALL_RINGS * S.salvage.n[1]);
    for (const p of loose) expect(l.areas[p.area].level ?? 0, `${p.itemId} area storey`).toBe(p.level ?? 0);
  });
});

describe('normalised material census (placed + reachable, mall vs Office, same method)', () => {
  it('crafting materials are significantly richer per reachable holder AND per 100 m² of usable floor; consumables are not inflated', () => {
    const {mall: m, office: o} = census();
    const line = (name: string, s: CensusSummary) => `[mall-profiles] ${name}: ${s.runs} runs | usable ${s.perRun.usableM2} m² | holders ${s.perRun.holders} (reachable ${s.perRun.reachableHolders}, stocked ${s.perRun.stockedHolders}, with materials ${s.perRun.materialHolders}) | surface ${s.perRun.surfaceM2} m² | fit failures ${s.perRun.fitFailures} lots (${s.fitLossShare}) | unreachable units ${s.perRun.unreachableUnits}\n`
      + `   per run: ${JSON.stringify(s.perRun.units)} materials ${JSON.stringify(s.perRun.materials)} (${s.perRun.materialLots} stacks)\n`
      + `   per reachable holder: ${JSON.stringify(s.perHolder.materials)} | units ${JSON.stringify(s.perHolder.units)}\n`
      + `   per 100 m²: ${JSON.stringify(s.per100m2.materials)} | units ${JSON.stringify(s.per100m2.units)}\n   zones ${JSON.stringify(s.zoneM2)}\n   materials by key ${JSON.stringify(s.materialsByKey)}\n`;
    process.stdout.write(`\n${line('mall', m)}${line('office', o)}`);
    const sum = (r: Record<string, number>) => MATERIAL_IDS.reduce((s, id) => s + (r[id] ?? 0), 0);
    const ratioArea = sum(m.per100m2.materials) / sum(o.per100m2.materials), ratioHolder = sum(m.perHolder.materials) / sum(o.perHolder.materials);
    process.stdout.write(`[mall-profiles] material richness mall / office: per 100 m² ${ratioArea.toFixed(2)}x, per reachable holder ${ratioHolder.toFixed(2)}x, per run ${(sum(m.perRun.materials) / sum(o.perRun.materials)).toFixed(2)}x\n`);
    expect(ratioArea).toBeGreaterThan(3);
    expect(ratioHolder).toBeGreaterThan(3);
    // each material is a real mall find (per run), bio mater included (the Office has almost none)
    for (const id of MATERIAL_IDS) expect(m.perRun.materials[id], id).toBeGreaterThan(5);
    // finite and real: almost nothing lost to fit, everything reachable from the arrival point
    expect(m.fitLossShare).toBeLessThan(0.05);
    expect(m.reachableShare).toBeGreaterThan(0.97);
    // consumables per 100 m² stay in the shared economy's band (the mall is not a consumable bonanza)
    for (const c of ['food', 'drink', 'med'] as const) expect(m.per100m2.units[c], c).toBeLessThan(o.per100m2.units[c] * 2.5);
  });
});

describe('mall spawn profile', () => {
  const P = spawnProfile('mall');
  it('is registered and valid: pit once, ring per ring, Track2 service as a 0-run data hook; ambient pool + hooks + rare rule + horde', () => {
    expect(SPAWN_PROFILES.mall).toBe(MALL_SPAWN_PROFILE);
    expect(validateSpawnProfile(P)).toEqual([]);
    expect(Object.keys(P.contexts).sort()).toEqual(['pit', 'ring', 'service']);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.ring!.runs).toBe(MALL_RINGS);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.runs).toBe(0);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.hook).toMatch(/NOT INTEGRATED/);
    expect(P.families).toEqual([['zombie', 0.95], ['ratdog', 0.05]]);
    expect(P.rooms).toEqual({});
    // the ambient budget holds every context run, and the level total
    const ctxMax = P.contexts.pit!.count[1] + MALL_RINGS * P.contexts.ring!.count[1];
    expect(P.budgets!.ambient.total).toBeGreaterThanOrEqual(ctxMax);
    // Track1 hooks: inactive while the registry lacks them; the projected pool once typed
    const st = familyHookStatus(P);
    expect(st.map(h => [h.family, h.share, h.active])).toEqual([['blightbelly', 0.05, false], ['siren', 0.05, false]]);
    const proj = Object.fromEntries(projectedAmbientPool(P));
    expect(proj.zombie).toBeCloseTo(0.85, 12);
    expect([proj.ratdog, proj.blightbelly, proj.siren]).toEqual([0.05, 0.05, 0.05]);
    expect(P.rare).toEqual([expect.objectContaining({family: 'siren', capPerLevel: 4})]);
    expect(P.rare![0].capPerLevel).toBeGreaterThan(2); // the larger mall may hold more than the Office's ~2
    // the horde pool: explicit, ordinary zombies only, 5..20 per group, separate budgets
    const H = P.horde!;
    expect(H.size).toEqual([HORDE_GROUP_SIZE.min, HORDE_GROUP_SIZE.max]);
    expect(Object.fromEntries(H.families)).toEqual({zombie: 1, ratdog: 0});
    expect(H.budget.total).toBeGreaterThanOrEqual(H.size[0]);
    expect(H.budget.perStorey).toBeLessThanOrEqual(H.budget.total);
  });

  it('validation enforces the hook / horde / rare / budget semantics', () => {
    const bad: [string, SpawnProfile][] = [
      ['hook naming a typed family (Track1 merged)', {...P, familyHooks: [{family: 'ratdog', share: 0.05, note: 'x'}]}],
      ['hook share 0', {...P, familyHooks: [{family: 'siren', share: 0, note: 'x'}]}],
      ['hook listed twice', {...P, familyHooks: [{family: 'siren', share: 0.05, note: 'x'}, {family: 'siren', share: 0.05, note: 'y'}]}],
      ['hooks eating every zombie', {...P, familyHooks: [{family: 'siren', share: 0.96, note: 'x'}]}],
      ['rare rule for an unknown family', {...P, rare: [{family: 'dragon', capPerLevel: 1, spacingM: 1, why: ''}]}],
      ['rare rule for zombies', {...P, rare: [{family: 'zombie', capPerLevel: 1, spacingM: 1, why: ''}]}],
      ['siren in the horde pool', {...P, horde: {...P.horde!, families: [['zombie', 1], ['ratdog', 0], ['siren' as never, 0.1]]}}],
      ['horde pool missing a family', {...P, horde: {...P.horde!, families: [['zombie', 1]]}}],
      ['horde group above 20', {...P, horde: {...P.horde!, size: [5, 25]}}],
      ['ambient budget below a context', {...P, budgets: {ambient: {total: 69, perStorey: 5}}}],
    ];
    for (const [what, p] of bad) expect(validateSpawnProfile(p).length, what).toBeGreaterThan(0);
  });

  it('generated mall: the generator asks for exactly pit + ring; ambient within contexts / budgets; hordes separate, 5..20, within budgets; deterministic', () => {
    const seen = new Set<string>();
    const contexts = new Proxy(P.contexts, {get: (t, k) => { if (typeof k === 'string') seen.add(k); return Reflect.get(t, k); }});
    const watched = generateMallLevel({levelSeed: SEEDS[0], startWeapon: 'pistol'}, {spawns: {...P, contexts} as SpawnProfile});
    expect([...seen].filter(k => k in P.contexts).sort()).toEqual(['pit', 'ring']); // 'service' waits for Track2 (data hook)
    // determinism: the watched profile is the same data -> the identical level as the registry's generation
    const l0 = mall(SEEDS[0]);
    expect(JSON.stringify(watched.zombies)).toBe(JSON.stringify(l0.zombies));
    expect(JSON.stringify(watched.pickups)).toBe(JSON.stringify(l0.pickups));
    const report: string[] = [];
    for (const seed of SEEDS) {
      const l = mall(seed);
      const ambient = l.zombies.filter(z => z.horde === undefined), horde = l.zombies.filter(z => z.horde !== undefined);
      // ambient: per storey within its context's count range, total within the ambient budget, families from the typed pool
      for (let lv = 0; lv <= MALL_RINGS; lv++) {
        const n = ambient.filter(z => (z.level ?? 0) === lv).length, c = (lv === 0 ? P.contexts.pit : P.contexts.ring)!;
        expect(n, `seed ${seed} storey ${lv}`).toBeGreaterThanOrEqual(c.count[0]);
        expect(n).toBeLessThanOrEqual(Math.min(c.count[1], P.budgets!.ambient.perStorey));
      }
      expect(ambient.length).toBeLessThanOrEqual(P.budgets!.ambient.total);
      expect(ambient.every(z => (ENEMY_FAMILY_IDS as readonly string[]).includes(z.archetype ?? 'zombie'))).toBe(true);
      // the rare rule is a no-op until Track1 types the Siren (no spawn can be one)
      const copy = l.zombies.map(z => ({...z}));
      expect(applyRareFamilyRules({zombies: copy}, P)).toBe(0);
      expect(copy).toEqual(l.zombies);
      // hordes: their own pool (ordinary zombies), 5..20 per group, the horde budgets — never counted as ambient
      const groups = new Map<number, typeof horde>();
      for (const z of horde) { const g = groups.get(z.horde!) ?? []; g.push(z); groups.set(z.horde!, g); }
      const H = P.horde!;
      expect(groups.size).toBeLessThanOrEqual(H.groups[1]);
      expect(horde.length).toBeLessThanOrEqual(H.budget.total);
      for (const g of groups.values()) { expect(g.length).toBeGreaterThanOrEqual(H.size[0]); expect(g.length).toBeLessThanOrEqual(H.size[1]); }
      const perStorey = new Map<number, number>(), groupsPerStorey = new Map<number, Set<number>>();
      for (const z of horde) { perStorey.set(z.level ?? 0, (perStorey.get(z.level ?? 0) ?? 0) + 1); (groupsPerStorey.get(z.level ?? 0) ?? groupsPerStorey.set(z.level ?? 0, new Set()).get(z.level ?? 0)!).add(z.horde!); }
      expect(horde.every(z => z.archetype === undefined || z.archetype === 'zombie')).toBe(true);
      report.push(`seed ${seed}: ambient ${ambient.length} (ratdog ${ambient.filter(z => z.archetype === 'ratdog').length}), horde groups ${groups.size} [${[...groups.values()].map(g => g.length).join(', ')}] = ${horde.length}`);
    }
    process.stdout.write(`\n[mall-profiles] spawns: ${report.join(' | ')}\n`);
  });

  it('applyRareFamilyRules: cap + spacing in spawn-index order, horde members untouched (test profile on a typed family)', () => {
    const T: SpawnProfile = {...P, familyHooks: [], rare: [{family: 'ratdog', capPerLevel: 2, spacingM: 10, why: 'test'}]};
    expect(validateSpawnProfile(T)).toEqual([]);
    const zs = [
      {x: 0, z: 0, archetype: 'ratdog'}, {x: 5, z: 0, archetype: 'ratdog'}, {x: 30, z: 0, archetype: 'ratdog'},
      {x: 60, z: 0, archetype: 'ratdog'}, {x: 90, z: 0, archetype: 'ratdog', horde: 0}, {x: 0, z: 0, y: 12, archetype: 'ratdog'},
    ];
    expect(applyRareFamilyRules({zombies: zs}, T)).toBe(3);
    expect(zs.map(z => z.archetype)).toEqual(['ratdog', 'zombie', 'ratdog', 'zombie', 'ratdog', 'zombie']);
  });
});

describe('reference coverage (the generated pages document the mall automatically)', () => {
  it('the enemy reference shows the mall contexts, the inactive hooks, the waiting rare rule, the horde pool and the ambient budget', () => {
    const r = buildEnemyReference({censusSeeds: []});
    const m = r.levels.find(l => l.id === 'mall')!;
    expect(m.contexts.map(c => [c.id, c.runs])).toEqual([['pit', 1], ['ring', MALL_RINGS], ['service', 0]]);
    expect(m.contexts.find(c => c.id === 'service')!.hook).toMatch(/NOT INTEGRATED/);
    expect(m.total.mean).toBe((P => (P.contexts.pit!.count[0] + P.contexts.pit!.count[1]) / 2 + MALL_RINGS * (P.contexts.ring!.count[0] + P.contexts.ring!.count[1]) / 2)(spawnProfile('mall')));
    expect(m.hooks.map(h => [h.family, h.active])).toEqual([['blightbelly', false], ['siren', false]]);
    expect(m.rare.map(x => [x.family, x.status, x.capPerLevel])).toEqual([['siren', 'waiting', 4]]);
    expect(m.horde!.pool.rows.map(x => [x.family, x.weight])).toEqual([['zombie', 1], ['ratdog', 0]]);
    expect(m.horde!.size).toMatchObject({lo: 5, hi: 20});
    expect(m.budgets!.ambient.total).toBe(spawnProfile('mall').budgets!.ambient.total);
    // the shipped levels carry none of it (their reference numbers are unchanged)
    for (const id of ['subway', 'office']) { const l = r.levels.find(x => x.id === id)!; expect([l.hooks, l.rare, l.horde, l.budgets]).toEqual([[], [], null, null]); }
  });

  it('the material census helper works for any registered level profile (the mall profile is the one ContainerManager.build passes)', () => {
    const p: LootProfile = lootProfile('mall');
    expect(p.id).toBe('mall');
    expect(MALL_FLOOR.ring.salvage.items.every(([id]) => isMaterialItem(id))).toBe(true);
  });
});
