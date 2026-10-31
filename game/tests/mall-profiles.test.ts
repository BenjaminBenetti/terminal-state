// Task track3-eaton-centre-20261031 (lane PROFILES): The Eaton's Center loot + spawn profiles.
//  - loot: PROFILES.mall = the shared base tables + the mall SALVAGE (crafting-material rows per purpose / theme) + the per-storey
//    floor program; validation; the shipped Subway / Office profiles untouched (salvage is identity there);
//  - the NORMALISED MATERIAL CENSUS (tests/helpers/materialCensus.ts): placed (after fit) + reachable units per run, per reachable
//    holder and per 100 m² of usable floor, mall vs Office by the same method — materials significantly richer, consumables not
//    inflated, fit failures and reachability measured;
//  - enemies: SPAWN_PROFILES.mall — ambient contexts (pit once, ring per ring, Track2 'service' as a NOT-INTEGRATED data hook),
//    the Track1 ambient pool familyPool({siren: MALL_SIREN_WEIGHT}) (Blightbelly / rat-dog 5 %) with the mall's Siren eligibility
//    (ring shops only, <= 4) + whole-mall 30 m spacing (lane INTEG: applyFamilySpacing), the SEPARATE horde pool (tagged 'horde',
//    ordinary zombies only) and its budgets, measured on generated mall layouts; determinism; the reference covers the mall.
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
  ENEMY_FAMILY_IDS, HORDE_CONTEXT, MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, MALL_SIREN_WEIGHT, MALL_SPAWN_PROFILE, SPAWN_PROFILES,
  declaredSpawnContexts, eligibilityFailure, familyPool, markSpawnContext, spawnContextOf, spawnProfile, validateSpawnProfile,
  type FamilyEligibility, type SpawnProfile,
} from '../src/ai/spawnTables';
import {assignEnemyArchetypes, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {applyFamilySpacing} from '../src/ai/familySpacing';
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
    // `share` is before overrides; the mall's categoryWeight.material dial then scales the salvage rows (no bio rows in this mix)
    const f = MALL.overrides.categoryWeight?.material ?? 1, eff = rule.share * f / (1 - rule.share + rule.share * f);
    expect(rule.rows.some(([id]) => id === 'bio_mater')).toBe(false);
    expect(mat / total).toBeCloseTo(eff, 10);
    expect(holderTable('stockShelf' as HolderKind, 'mall-electronics', {...MALL, overrides: {}}).rows.filter(r => isMaterialItem(r[0])).reduce((s, r) => s + r[1], 0) / holderTable('stockShelf' as HolderKind, 'mall-electronics', {...MALL, overrides: {}}).rows.reduce((s, r) => s + r[1], 0)).toBeCloseTo(rule.share, 10);
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
    expect(Math.abs(mats / raw - eff), `material lots ${mats} of ~${raw.toFixed(0)} rolled`).toBeLessThan(0.03);
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
  it('is registered and valid: pit once, ring per ring, Track2 service as a 0-run data hook; Track1 pool + Siren rule + spacing + horde', () => {
    expect(SPAWN_PROFILES.mall).toBe(MALL_SPAWN_PROFILE);
    expect(LEVELS.mall.tier).toBe(2);
    expect(validateSpawnProfile(P)).toEqual([]);
    expect(Object.keys(P.contexts).sort()).toEqual(['pit', 'ring', 'service']);
    expect(declaredSpawnContexts(P).sort()).toEqual([HORDE_CONTEXT, 'pit', 'ring', 'service'].sort());
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.ring!.runs).toBe(MALL_RINGS);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.runs).toBe(0);
    expect(ENEMY_LEVEL_ADAPTER.mall.contexts.service!.hook).toMatch(/NOT INTEGRATED/);
    // Track1 pool: every family in registry order, Blightbelly / rat-dog 5 % ambient, the Siren's census-tuned draw weight (not the Office's)
    expect(P.families).toEqual(familyPool({siren: MALL_SIREN_WEIGHT}));
    expect(P.families.map(([f]) => f)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(Object.fromEntries(P.families)).toMatchObject({blightbelly: 0.05, ratdog: 0.05, siren: MALL_SIREN_WEIGHT});
    expect(MALL_SIREN_WEIGHT).not.toBe(0.19);
    expect(P.rooms).toEqual({});
    // the Siren: ring shops only (never the pit, an annex or a horde), the Office's gates, <= 4 per mall, zombie fallback; 30 m apart
    expect(P.eligibility).toEqual({siren: MALL_SIREN_ELIGIBILITY});
    expect(MALL_SIREN_ELIGIBILITY).toMatchObject({contexts: ['ring'], kinds: ['room'], minSideCells: 8, minAreaCells: 100, clearCells: 1, doorKeepM: 3, passageRadiusM: 2.5, maxPerLevel: 4, fallback: 'zombie'});
    for (const k of ['washroom', 'stair-core', 'storage', 'utility']) expect(MALL_SIREN_ELIGIBILITY.excludeRooms).toContain(k);
    expect(P.spacing).toEqual({siren: MALL_SIREN_SPACING});
    expect(MALL_SIREN_SPACING.spacingM).toBe(30);
    // the ambient budget holds every context run, and the level total
    const ctxMax = P.contexts.pit!.count[1] + MALL_RINGS * P.contexts.ring!.count[1];
    expect(P.budgets!.ambient.total).toBeGreaterThanOrEqual(ctxMax);
    // the horde pool: explicit (every registry family listed), ordinary zombies only, 5..20 per group, separate budgets
    const H = P.horde!;
    expect(H.size).toEqual([HORDE_GROUP_SIZE.min, HORDE_GROUP_SIZE.max]);
    expect(Object.fromEntries(H.families)).toEqual({zombie: 1, blightbelly: 0, siren: 0, ratdog: 0});
    expect(H.budget.total).toBeGreaterThanOrEqual(H.size[0]);
    expect(H.budget.perStorey).toBeLessThanOrEqual(H.budget.total);
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
      ['ambient budget below a context', {...P, budgets: {ambient: {total: 69, perStorey: 5}}}, /perStorey/],
    ];
    for (const [what, p, re] of bad) expect(validateSpawnProfile(p).join('\n'), what).toMatch(re);
    // a rule naming the pit would be VALID data (the pit is a declared context): the mall's own rule is what keeps her out of it
    expect(validateSpawnProfile({...P, eligibility: {siren: {...rule, contexts: ['pit', 'ring']}}})).toEqual([]);
    expect(rule.contexts).toEqual(['ring']);
  });

  it('generated mall: the generator asks for exactly pit + ring; tags; ambient within contexts / budgets; Sirens eligible + spaced; hordes separate; deterministic', () => {
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
      // every spawn carries its declared context: ambient 'pit' (storey 0) / 'ring' (storeys 1..6), horde members 'horde'
      l.zombies.forEach((z, i) => {
        const c = spawnContextOf(l, P, i);
        expect(c, `seed ${seed} #${i}`).toBe(z.horde !== undefined ? HORDE_CONTEXT : (z.level ?? 0) === 0 ? 'pit' : 'ring');
      });
      // hordes are appended after every ambient spawn (the ambient roll and run memory key on the index)
      const firstHorde = l.zombies.findIndex(z => z.horde !== undefined);
      if (firstHorde >= 0) expect(l.zombies.slice(firstHorde).every(z => z.horde !== undefined)).toBe(true);
      // ambient: per storey within its context's count range, total within the ambient budget, families from the pool
      for (let lv = 0; lv <= MALL_RINGS; lv++) {
        const n = ambient.filter(z => (z.level ?? 0) === lv).length, c = (lv === 0 ? P.contexts.pit : P.contexts.ring)!;
        expect(n, `seed ${seed} storey ${lv}`).toBeGreaterThanOrEqual(c.count[0]);
        expect(n).toBeLessThanOrEqual(Math.min(c.count[1], P.budgets!.ambient.perStorey));
      }
      expect(ambient.length).toBeLessThanOrEqual(P.budgets!.ambient.total);
      expect(ambient.every(z => (ENEMY_FAMILY_IDS as readonly string[]).includes(z.archetype ?? 'zombie'))).toBe(true);
      // Sirens: drawn by the roll, eligible ring-shop slots only, <= 4, >= 30 m apart; the post-pass is idempotent
      const sirens = l.zombies.map((z, i) => [z, i] as const).filter(([z]) => z.archetype === 'siren');
      expect(sirens.length).toBeLessThanOrEqual(MALL_SIREN_ELIGIBILITY.maxPerLevel!);
      for (const [z, i] of sirens) {
        expect(z.horde).toBeUndefined();
        expect((z.level ?? 0) >= 1).toBe(true);
        expect(['shop', 'stock-room']).toContain(l.areas[z.area].type);
        expect(eligibilityFailure(MALL_SIREN_ELIGIBILITY, l, z, spawnContextOf(l, P, i))).toBeNull();
        expect(pickEnemyArchetype(l.seed, i, P.families)).toBe('siren');
      }
      for (let a = 0; a < sirens.length; a++) for (let b = a + 1; b < sirens.length; b++) {
        const [p, q] = [sirens[a][0], sirens[b][0]];
        expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z)).toBeGreaterThanOrEqual(MALL_SIREN_SPACING.spacingM);
      }
      // idempotent: re-running the family roll + the spacing post-pass on the generated level changes nothing (Retry / revisit)
      const before = JSON.stringify(l.zombies);
      assignEnemyArchetypes(l, P);
      applyFamilySpacing(l, P);
      expect(JSON.stringify(l.zombies)).toBe(before);
      // hordes: their own pool (ordinary zombies), 5..20 per group, the horde budgets — never counted as ambient
      const groups = new Map<number, typeof horde>();
      for (const z of horde) { const g = groups.get(z.horde!) ?? []; g.push(z); groups.set(z.horde!, g); }
      const H = P.horde!;
      expect(groups.size).toBeLessThanOrEqual(H.groups[1]);
      expect(horde.length).toBeLessThanOrEqual(H.budget.total);
      for (const g of groups.values()) { expect(g.length).toBeGreaterThanOrEqual(H.size[0]); expect(g.length).toBeLessThanOrEqual(H.size[1]); }
      expect(horde.every(z => z.archetype === undefined || z.archetype === 'zombie')).toBe(true);
      const fam = (f: string) => ambient.filter(z => (z.archetype ?? 'zombie') === f).length;
      report.push(`seed ${seed}: ambient ${ambient.length} (siren ${fam('siren')}, blightbelly ${fam('blightbelly')}, ratdog ${fam('ratdog')}), horde groups ${groups.size} [${[...groups.values()].map(g => g.length).join(', ')}] = ${horde.length}`);
    }
    process.stdout.write(`\n[mall-profiles] spawns: ${report.join(' | ')}\n`);
  });

  it('applyFamilySpacing: cap + spacing jointly in spawn-index order (a capped draw is placed once an earlier one is spaced out); others / hordes untouched', () => {
    // synthetic ring storey: one eligible room, a near-certain Siren draw (test pool), cap 2, 10 m spacing
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
  it('the enemy reference shows the mall tier, contexts, the Siren rule with its spacing, the horde pool and the ambient budget', () => {
    const r = buildEnemyReference({censusSeeds: []});
    const m = r.levels.find(l => l.id === 'mall')!;
    expect(m.tier.value).toBe(2);
    expect(m.contexts.map(c => [c.id, c.runs])).toEqual([['pit', 1], ['ring', MALL_RINGS], ['service', 0]]);
    expect(m.contexts.find(c => c.id === 'service')!.hook).toMatch(/NOT INTEGRATED/);
    expect(m.total.mean).toBe((P => (P.contexts.pit!.count[0] + P.contexts.pit!.count[1]) / 2 + MALL_RINGS * (P.contexts.ring!.count[0] + P.contexts.ring!.count[1]) / 2)(spawnProfile('mall')));
    expect(m.pool.rows.map(x => [x.family, x.weight])).toEqual(familyPool({siren: MALL_SIREN_WEIGHT}).map(([f, w]) => [f, w]));
    expect(m.pool.eligibility.map(e => [e.family, e.contexts, e.maxPerLevel, e.spacing?.metres])).toEqual([['siren', ['ring'], 4, 30]]);
    expect(m.pool.eligibility[0].criteria.join(' ')).toMatch(/30 m/);
    expect(m.knobs.find(k => k.what === 'spacing (siren, m)')!.value).toBe(30);
    expect(m.horde!.pool.rows.map(x => [x.family, x.weight])).toEqual([['zombie', 1], ['blightbelly', 0], ['siren', 0], ['ratdog', 0]]);
    expect(m.horde!.semantics.join(' ')).toMatch(new RegExp(`'${HORDE_CONTEXT}'`));
    expect(m.horde!.size).toMatchObject({lo: 5, hi: 20});
    expect(m.budgets!.ambient.total).toBe(spawnProfile('mall').budgets!.ambient.total);
    // the shipped levels carry none of the mall's extras (their reference numbers are unchanged)
    for (const id of ['subway', 'office']) { const l = r.levels.find(x => x.id === id)!; expect([l.horde, l.budgets]).toEqual([null, null]); expect(l.pool.eligibility.every(e => e.spacing === null)).toBe(true); }
  });

  it('the material census helper works for any registered level profile (the mall profile is the one ContainerManager.build passes)', () => {
    const p: LootProfile = lootProfile('mall');
    expect(p.id).toBe('mall');
    expect(MALL_FLOOR.ring.salvage.items.every(([id]) => isMaterialItem(id))).toBe(true);
  });
});
