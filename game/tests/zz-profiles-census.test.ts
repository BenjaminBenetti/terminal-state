// Task mall-playtest-revision-20261031 (lane PROFILES): POPULATION / ECONOMY / STORAGE CENSUS of the compact mall (CPU only).
// Run (copied transiently into game/tests/ as zz-profiles-census.test.ts, then removed):
//   CENSUS_LABEL=<label> reference/tasks/office-overhaul-20261030/tools/heavy.sh ./node_modules/.bin/vitest run \
//     --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/zz-profiles-census.test.ts
// Writes reference/tasks/mall-playtest-revision-20261031/evidence/census/<label>.json.
// Sample: the 3 named variants x seeds 11 / 222 / 3333 (variant forced) + the registry level of seeds 11 / 222 / 3333 / 44444 when its
// seed variant is not already in the sample; pistol start. Office: seeds 11 / 222 / 3333 (same census method).
import {it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {generateMallLevel} from '../src/gen/mall/index';
import {MALL_VARIANTS} from '../src/gen/mall/frame';
import {mallFloorZone} from '../src/gen/mall/supplies';
import {generateOfficeLevel} from '../src/gen/office/index';
import {levelDistance} from '../src/gen/levelGen';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS, arrivalPose} from '../src/levels/registry';
import {lootProfile, MALL_STORAGE_FILL, PROFILES, type LootProfile} from '../src/items/lootTables';
import {ITEMS} from '../src/items/items';
import {MATERIAL_IDS} from '../src/items/craftMaterials';
import {openableSpec} from '../src/world/openablesSpec';
import {isContainerKind, isLootHolderKind} from '../src/items/loot';
import {dynamicKind} from '../src/physics/dynamicItems';
import {ENEMY_FAMILY_IDS, MALL_SIREN_ELIGIBILITY, eligibilityFailure, spawnContextOf, spawnProfile} from '../src/ai/spawnTables';
import {placeHordes} from '../src/ai/hordePlace';
import {Rng} from '../src/core/rng';
import {layoutHolderDetails} from './helpers/lootEconomy';
import {censusCat, runCensus, summarize, type RunCensus} from './helpers/materialCensus';

const LABEL = process.env.CENSUS_LABEL ?? 'census';
const DIR = new URL('../../reference/tasks/mall-playtest-revision-20261031/evidence/census/', import.meta.url);
const SEEDS = [11, 222, 3333];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? {n, min: r3(s[0]), median: r3(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2), mean: r3(s.reduce((a, b) => a + b, 0) / n), max: r3(s[n - 1])} : {n: 0};
};
const count = (xs: string[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort()); };
const meanCounts = (list: Record<string, number>[]) => {
  const keys = [...new Set(list.flatMap(o => Object.keys(o)))].sort(), n = Math.max(1, list.length);
  return Object.fromEntries(keys.map(k => [k, r3(list.reduce((s, o) => s + (o[k] ?? 0), 0) / n)]));
};
const FILL_ID = 600;

function distOf(l: StationLayout) {
  const st = l.mall?.start ?? arrivalPose(l, {kind: 'start'}), [sx, sy] = l.grid.cellOf(st.x, st.z);
  return levelDistance(l.levels, sx, sy, st.level ?? 0, l.levelLinks);
}

/** Reached walkable m² by bucket: station core / retail floor k / extension tunnel / annex. */
function areaFacts(l: StationLayout, dist: Int32Array[]) {
  const m2: Record<string, number> = {};
  l.levels.forEach((L, lv) => {
    const d = dist[lv], g = L.grid;
    if (!d) return;
    for (let i = 0; i < d.length; i++) {
      if (d[i] < 0) continue;
      const a = l.areas[g.area[i]];
      if (!a || a.role === 'stair' || (a.level ?? 0) !== lv) continue;
      const k = a.ext ? `ext-${a.ext}` : lv === 0 ? 'station' : `floor${lv}`;
      m2[k] = (m2[k] ?? 0) + CELL * CELL;
    }
  });
  const retail = Object.entries(m2).filter(([k]) => k.startsWith('floor')).reduce((a, [, v]) => a + v, 0);
  return {byBucket: Object.fromEntries(Object.entries(m2).map(([k, v]) => [k, r3(v)])), station: r3(m2.station ?? 0), retail: r3(retail),
    core: r3((m2.station ?? 0) + retail), annex: r3(m2['ext-annex'] ?? 0), tunnel: r3(m2['ext-tunnel'] ?? 0)};
}

function layoutFacts(l: StationLayout) {
  const m = l.mall!;
  const shops = m.shops;
  const rings = m.storeys.filter(s => s.role === 'ring').map(s => s.level);
  const patrol = m.patrol;
  const patrolPerStorey: Record<string, {nodes: number; edgeM: number}> = {};
  for (const n of patrol) {
    const e = (patrolPerStorey[n.level] ??= {nodes: 0, edgeM: 0});
    e.nodes++;
    for (const ed of n.edges) { const t = patrol.find(q => q.id === ed.to); if (t && t.level === n.level) e.edgeM += Math.hypot(t.x - n.x, t.z - n.z) / 2; }
  }
  for (const e of Object.values(patrolPerStorey)) e.edgeM = r3(e.edgeM);
  return {
    seed: l.seed, variant: m.variant, name: m.name, storeys: m.storeys.length, rings: rings.length,
    units: shops.length, unitsPerFloor: count(shops.map(s => String(s.level))), unitsByKind: count(shops.map(s => s.kind)), unitsByLot: count(shops.map(s => s.lot ?? '-')),
    programs: [...new Set(shops.map(s => s.program))].sort(), gunShops: shops.filter(s => s.program === 'guns').length,
    salesAreaM2: shops.map(s => s.salesArea), stockShare: r3(shops.filter(s => s.backroom !== undefined).length / Math.max(1, shops.length)),
    verticals: count(m.verticals.map(v => v.kind)), patrolPerStorey,
  };
}

function enemyFacts(l: StationLayout, af: ReturnType<typeof areaFacts>, dist: Int32Array[]) {
  const P = spawnProfile('mall');
  const ctx = (i: number) => spawnContextOf(l, P, i);
  const fam = (z: {archetype?: string}) => z.archetype ?? 'zombie';
  const svc = l.zombies.filter((z, i) => z.horde === undefined && (ctx(i) === 'service' || !!l.areas[z.area]?.ext));
  const ambIdx = l.zombies.map((z, i) => i).filter(i => l.zombies[i].horde === undefined && !(ctx(i) === 'service' || !!l.areas[l.zombies[i].area]?.ext));
  const amb = ambIdx.map(i => l.zombies[i]);
  const hor = l.zombies.filter(z => z.horde !== undefined);
  const pit = amb.filter(z => (z.level ?? 0) === 0), ring = amb.filter(z => (z.level ?? 0) > 0);
  const sirens = amb.filter(z => fam(z) === 'siren');
  const groups = new Map<number, {n: number; level: number}>();
  for (const z of hor) { const g = groups.get(z.horde!) ?? {n: 0, level: z.level ?? 0}; g.n++; groups.set(z.horde!, g); }
  const minGap = sirens.length > 1 ? Math.min(...sirens.flatMap((a, i) => sirens.slice(i + 1).map(b => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z)))) : null;
  // Siren-eligible ambient slots (the rule's criteria, cap / spacing aside)
  const eligible = ambIdx.filter(i => eligibilityFailure(MALL_SIREN_ELIGIBILITY, l, l.zombies[i], ctx(i)) === null);
  // horde start capacity: placeHordes on a copy (no hordes, ambient positions kept) reports the eligible start nodes per storey
  const copy = {...l, zombies: l.zombies.filter(z => z.horde === undefined), hordes: []} as StationLayout;
  const rep = placeHordes(copy, P.horde, new Rng(1), {dist});
  const per100 = (n: number, m2: number) => (m2 > 0 ? r3(n * 100 / m2) : 0);
  return {
    ambient: amb.length, pit: pit.length, ring: ring.length, ambientPerStorey: count(amb.map(z => String(z.level ?? 0))),
    ambientByFamily: count(amb.map(fam)), service: svc.length, serviceByFamily: count(svc.map(fam)),
    hordeGroups: groups.size, hordeMembers: hor.length, groupSizes: [...groups.values()].map(g => g.n), groupStoreys: [...groups.values()].map(g => g.level),
    hordeNonZombie: hor.filter(z => fam(z) !== 'zombie').length,
    sirens: sirens.length, sirenStoreys: sirens.map(z => z.level ?? 0), sirenRooms: sirens.map(z => l.areas[z.area]?.type), minSirenGapM: minGap === null ? null : r3(minGap),
    sirenEligibleSlots: eligible.length, sirenEligibleByStorey: count(eligible.map(i => String(l.zombies[i].level ?? 0))),
    hordeEligibleNodes: rep.eligibleNodes,
    density: {
      ambientPer100Core: per100(amb.length, af.core), pitPer100Station: per100(pit.length, af.station), ringPer100Retail: per100(ring.length, af.retail),
      hordePer100Retail: per100(hor.length, af.retail), allCorePer100Core: per100(amb.length + hor.length, af.core), servicePer100Annex: per100(svc.length, af.annex + af.tunnel),
    },
  };
}

/** Storage compartments (openable parts / one-lid containers) of every loot holder: total and stocked, by kind and by zone. */
function storageFacts(l: StationLayout, P: LootProfile, zoneOf: (areaId: number) => string) {
  const byKind: Record<string, {holders: number; comps: number; stocked: number; base: number; fill: number; zone: Record<string, number>}> = {};
  const fillItems: Record<string, number> = {}, fillCats: Record<string, number> = {};
  for (const h of layoutHolderDetails(l, P)) {
    const kind = h.kind as string;
    const single = !openableSpec(kind) && isContainerKind(kind);
    const comps = new Map<number, number[]>();
    h.surfaces.forEach((s, i) => { const c = s.part ?? (single ? -1 : undefined); if (c !== undefined) comps.set(c, [...(comps.get(c) ?? []), i]); });
    if (!comps.size) continue;
    const e = (byKind[kind] ??= {holders: 0, comps: 0, stocked: 0, base: 0, fill: 0, zone: {}});
    e.holders++;
    const z = zoneOf(h.prop.area);
    for (const c of comps.keys()) {
      e.comps++;
      e.zone[z] = (e.zone[z] ?? 0) + 1;
      const lots = h.lots.filter(lot => (single ? true : lot.part === c));
      if (!lots.length) continue;
      e.stocked++;
      if (lots.some(lot => lot.id % 1000 >= FILL_ID)) e.fill++; else e.base++;
    }
    for (const lot of h.lots) if (lot.id % 1000 >= FILL_ID) { fillItems[lot.itemId] = (fillItems[lot.itemId] ?? 0) + lot.count; const c = censusCat(lot.itemId); fillCats[c] = (fillCats[c] ?? 0) + lot.count; }
  }
  return {byKind, fillItems, fillCats};
}

function weaponFacts(l: StationLayout) {
  const m = l.mall!;
  const guns = l.pickups.filter(p => ITEMS[p.itemId]?.kind === 'weapon' && !p.reward);
  return m.shops.filter(s => s.program === 'guns').map(s => ({shop: s.id, lot: s.lot, level: s.level, guns: guns.filter(g => g.area === s.area || g.area === s.backroom).map(g => g.itemId)}));
}

function propFacts(l: StationLayout) {
  const open = l.props.filter(p => openableSpec(p.kind)).map(p => p.kind as string);
  const dyn = l.props.filter(p => dynamicKind(p.kind)).map(p => p.kind as string);
  return {props: l.props.length, holders: l.props.filter(p => isLootHolderKind(p.kind)).length, openable: open.length, dynamic: dyn.length, openableByKind: count(open)};
}

/** The material census WITHOUT the Track2 extension holders / pickups / reached m² (the same rolls; holder indices follow the full prop order). */
function coreOnly(l: StationLayout, P: LootProfile, cen: RunCensus) {
  const ext = (areaId: number) => !!l.areas[areaId]?.ext;
  const dist = distOf(l);
  const reached = (lv: number, x0: number, z0: number, x1: number, z1: number) => {
    const g = l.levels[lv]?.grid, d = dist[lv]; if (!g || !d) return false;
    const [ax, ay] = g.cellOf(x0 - 1, z0 - 1), [bx, by] = g.cellOf(x1 + 1, z1 + 1);
    for (let y = Math.max(0, ay); y <= Math.min(g.h - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(g.w - 1, bx); x++) if (d[g.idx(x, y)] >= 0) return true;
    return false;
  };
  const units: Record<string, number> = {}, mats: Record<string, number> = {}, holderMats: Record<string, number> = {};
  let reachH = 0;
  for (const h of layoutHolderDetails(l, P)) {
    if (ext(h.prop.area)) continue;
    const lv = h.prop.level ?? l.areas[h.prop.area]?.level ?? 0;
    if (!reached(lv, h.prop.x - h.prop.hx, h.prop.z - h.prop.hz, h.prop.x + h.prop.hx, h.prop.z + h.prop.hz)) continue;
    reachH++;
    for (const lot of h.lots) { const c = censusCat(lot.itemId); units[c] = (units[c] ?? 0) + lot.count; if (c === 'material') { mats[lot.itemId] = (mats[lot.itemId] ?? 0) + lot.count; holderMats[lot.itemId] = (holderMats[lot.itemId] ?? 0) + lot.count; } }
  }
  for (const q of l.pickups) {
    if (ext(q.area) || !reached(q.level ?? 0, q.x, q.z, q.x, q.z)) continue;
    const c = censusCat(q.itemId); units[c] = (units[c] ?? 0) + q.count; if (c === 'material') mats[q.itemId] = (mats[q.itemId] ?? 0) + q.count;
  }
  const usable = cen.usableM2 - Object.entries(cen.zoneM2).filter(([k]) => k.startsWith('ext-')).reduce((a, [, v]) => a + v, 0);
  return {usableM2: usable, reachableHolders: reachH, units, materials: mats, holderMaterials: holderMats};
}

function summarizeCore(rs: ReturnType<typeof coreOnly>[]) {
  const n = Math.max(1, rs.length), usable = rs.reduce((a, r) => a + r.usableM2, 0), reachH = rs.reduce((a, r) => a + r.reachableHolders, 0);
  const sumK = (f: (r: ReturnType<typeof coreOnly>) => Record<string, number>, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, rs.reduce((a, r) => a + (f(r)[k] ?? 0), 0)]));
  const cats = ['food', 'drink', 'med', 'ammo', 'battery', 'flare', 'material', 'weapon', 'gear', 'other'];
  const u = sumK(r => r.units, cats), m = sumK(r => r.materials, MATERIAL_IDS), hm = sumK(r => r.holderMaterials, MATERIAL_IDS);
  const per = (o: Record<string, number>, d: number, k = 1) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, d > 0 ? r3(v * k / d) : 0]));
  return {runs: rs.length, perRun: {usableM2: r3(usable / n), reachableHolders: r3(reachH / n), units: per(u, n), materials: per(m, n)},
    perHolder: {materials: per(hm, reachH)}, per100m2: {units: per(u, usable, 100), materials: per(m, usable, 100)}};
}

it('profiles census', () => {
  const t0 = Date.now();
  const sample: {seed: number; variant: string; source: string; l: StationLayout}[] = [];
  for (const variant of MALL_VARIANTS) for (const seed of SEEDS) sample.push({seed, variant, source: 'forced variant', l: generateMallLevel({levelSeed: seed, startWeapon: 'pistol'}, {variant})});
  for (const seed of [...SEEDS, 44444]) {
    const l = LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
    if (!sample.some(s => s.seed === seed && s.variant === l.mall!.variant)) sample.push({seed, variant: l.mall!.variant, source: 'registry (seed variant)', l});
  }
  const genMs = Date.now() - t0;
  const P = lootProfile('mall'), OP = lootProfile('office');
  const runs = sample.map(s => {
    const l = s.l, dist = distOf(l), af = areaFacts(l, dist);
    const zone = (a: StationLayout['areas'][number]) => (a.ext ? `ext-${a.ext}` : (a.level ?? 0) === 0 ? 'pit' : mallFloorZone(l, a));
    const cen = runCensus(l, P, zone);
    const zoneById = (id: number) => { const a = l.areas[id]; return a ? zone(a) : '?'; };
    return {s, af, lf: layoutFacts(l), en: enemyFacts(l, af, dist), cen, core: coreOnly(l, P, cen), st: storageFacts(l, P, zoneById), weapons: weaponFacts(l), props: propFacts(l)};
  });
  const offices = SEEDS.map(seed => generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}));
  const officeRuns = offices.map(l => {
    const zone = (a: StationLayout['areas'][number]) => (a.ext ? `ext-${a.ext}` : a.publicSpace ? 'public' : 'room');
    const cen = runCensus(l, OP, zone);
    const zoneById = (id: number) => { const a = l.areas[id]; return a ? zone(a) : '?'; };
    const P0 = spawnProfile('office');
    const amb = l.zombies.filter((z, i) => !(spawnContextOf(l, P0, i) === 'service' || !!l.areas[z.area]?.ext)).length;
    return {cen, core: coreOnly(l, OP, cen), st: storageFacts(l, OP, zoneById), ambient: amb, sirens: l.zombies.filter(z => z.archetype === 'siren').length};
  });
  const mall = summarize(runs.map(r => r.cen)), office = summarize(officeRuns.map(r => r.cen));
  const mallCore = summarizeCore(runs.map(r => r.core)), officeCore = summarizeCore(officeRuns.map(r => r.core));
  const sum = (o: Record<string, number>) => MATERIAL_IDS.reduce((a, id) => a + (o[id] ?? 0), 0);
  const storageAgg = (list: ReturnType<typeof storageFacts>[]) => {
    const agg: Record<string, {holders: number; comps: number; stocked: number; base: number; fill: number}> = {};
    for (const st of list) for (const [k, e] of Object.entries(st.byKind)) { const a = (agg[k] ??= {holders: 0, comps: 0, stocked: 0, base: 0, fill: 0}); a.holders += e.holders; a.comps += e.comps; a.stocked += e.stocked; a.base += e.base; a.fill += e.fill; }
    const n = Math.max(1, list.length);
    const rows = Object.fromEntries(Object.entries(agg).sort().map(([k, a]) => [k, {holdersPerRun: r3(a.holders / n), compsPerRun: r3(a.comps / n), stockedRate: r3(a.stocked / Math.max(1, a.comps)), baseRate: r3(a.base / Math.max(1, a.comps)), fillRate: r3(a.fill / Math.max(1, a.comps)), fillKind: k in MALL_STORAGE_FILL}]));
    const tot = (pred: (k: string) => boolean) => { let c = 0, s = 0; for (const [k, a] of Object.entries(agg)) if (pred(k)) { c += a.comps; s += a.stocked; } return {compsPerRun: r3(c / n), stockedRate: r3(s / Math.max(1, c))}; };
    return {byKind: rows, overall: tot(() => true), fillKinds: tot(k => k in MALL_STORAGE_FILL), fillKindsExMedicineCabinet: tot(k => k in MALL_STORAGE_FILL && k !== 'medicineDrawerCabinet'),
      fillItemsPerRun: meanCounts(list.map(x => x.fillItems)), fillCatsPerRun: meanCounts(list.map(x => x.fillCats))};
  };
  const out = {
    task: 'studio-beta-mall-playtest-revision-20261031-01 (lane PROFILES)', label: LABEL, generatedAt: new Date().toISOString(),
    method: 'CPU only. Mall: 3 named variants x seeds 11/222/3333 (variant forced) + registry levels of seeds 11/222/3333/44444 not already sampled; pistol start. Office: seeds 11/222/3333. Loot = game/tests/helpers/materialCensus.ts (holder lots after fit incl. the mall storage fill + loose pickups, counted where the walking field from the arrival point reaches the holder / pickup within 1 m; usable floor = reached walkable cells, stair runs once). Core = without Track2 extension (tunnel / annex) holders, pickups and m². Rare gear / gas masks (withGear) excluded for every level.',
    sample: runs.map(r => ({seed: r.s.seed, variant: r.s.variant, source: r.s.source, attempt: r.s.l.attempt, name: r.lf.name})), generationMs: genMs,
    layout: {
      perRun: runs.map(r => ({seed: r.s.seed, variant: r.s.variant, ...r.af, units: r.lf.units, unitsPerFloor: r.lf.unitsPerFloor, unitsByKind: r.lf.unitsByKind, unitsByLot: r.lf.unitsByLot, gunShops: r.lf.gunShops, programs: r.lf.programs.length, stockShare: r.lf.stockShare, verticals: r.lf.verticals, patrolPerStorey: r.lf.patrolPerStorey})),
      coreM2: stats(runs.map(r => r.af.core)), stationM2: stats(runs.map(r => r.af.station)), retailM2: stats(runs.map(r => r.af.retail)),
      floorM2: Object.fromEntries([1, 2, 3].map(k => [k, stats(runs.map(r => r.af.byBucket[`floor${k}`] ?? 0))])), annexM2: stats(runs.map(r => r.af.annex)), tunnelM2: stats(runs.map(r => r.af.tunnel)),
      units: stats(runs.map(r => r.lf.units)), unitsByKind: meanCounts(runs.map(r => r.lf.unitsByKind)), unitsByLot: meanCounts(runs.map(r => r.lf.unitsByLot)),
      salesAreaM2: stats(runs.flatMap(r => r.lf.salesAreaM2)), gunShops: stats(runs.map(r => r.lf.gunShops)),
    },
    enemies: {
      pool: spawnProfile('mall').families, perRun: runs.map(r => ({seed: r.s.seed, variant: r.s.variant, ...r.en})),
      ambient: stats(runs.map(r => r.en.ambient)), pit: stats(runs.map(r => r.en.pit)), ring: stats(runs.map(r => r.en.ring)), service: stats(runs.map(r => r.en.service)),
      ambientByFamilyMean: meanCounts(runs.map(r => r.en.ambientByFamily)), serviceByFamilyMean: meanCounts(runs.map(r => r.en.serviceByFamily)),
      hordes: {groups: stats(runs.map(r => r.en.hordeGroups)), members: stats(runs.map(r => r.en.hordeMembers)), groupSize: stats(runs.flatMap(r => r.en.groupSizes)), nonZombie: runs.reduce((a, r) => a + r.en.hordeNonZombie, 0)},
      sirens: {...stats(runs.map(r => r.en.sirens)), noneShare: r3(runs.filter(r => r.en.sirens === 0).length / runs.length), eligibleSlots: stats(runs.map(r => r.en.sirenEligibleSlots)), perStorey: count(runs.flatMap(r => r.en.sirenStoreys.map(String)))},
      density: Object.fromEntries(Object.keys(runs[0].en.density).map(k => [k, stats(runs.map(r => (r.en.density as Record<string, number>)[k]))])),
      office: {ambient: stats(officeRuns.map(r => r.ambient)), sirens: stats(officeRuns.map(r => r.sirens)), coreM2: stats(officeRuns.map(r => r.core.usableM2))},
    },
    loot: {
      withExtensions: {mall, office, richness: {per100m2: r3(sum(mall.per100m2.materials) / sum(office.per100m2.materials)), perReachableHolder: r3(sum(mall.perHolder.materials) / sum(office.perHolder.materials)), perRun: r3(sum(mall.perRun.materials) / sum(office.perRun.materials))}},
      core: {mall: mallCore, office: officeCore, richness: {per100m2: r3(sum(mallCore.per100m2.materials) / sum(officeCore.per100m2.materials)), perReachableHolder: r3(sum(mallCore.perHolder.materials) / sum(officeCore.perHolder.materials)), perRun: r3(sum(mallCore.perRun.materials) / sum(officeCore.perRun.materials))},
        consumablesVsOffice: Object.fromEntries(['food', 'drink', 'med', 'ammo'].map(c => [c, r3((mallCore.per100m2.units[c] ?? 0) / Math.max(1e-9, officeCore.per100m2.units[c] ?? 0))]))},
      fitLossShare: {mall: mall.fitLossShare, office: office.fitLossShare}, reachableShare: {mall: mall.reachableShare, office: office.reachableShare},
      overrides: PROFILES.mall.overrides,
    },
    storage: {mall: storageAgg(runs.map(r => r.st)), office: storageAgg(officeRuns.map(r => r.st))},
    gunShops: {perRun: runs.map(r => ({seed: r.s.seed, variant: r.s.variant, shops: r.weapons})), gunsPerShop: stats(runs.flatMap(r => r.weapons.map(w => w.guns.length)))},
    props: {perMall: stats(runs.map(r => r.props.props)), holders: stats(runs.map(r => r.props.holders)), openable: stats(runs.map(r => r.props.openable)), dynamic: stats(runs.map(r => r.props.dynamic)), openableByKindMean: meanCounts(runs.map(r => r.props.openableByKind))},
    families: ENEMY_FAMILY_IDS,
  };
  mkdirSync(DIR, {recursive: true});
  const file = new URL(`${LABEL}.json`, DIR);
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  process.stdout.write(`[profiles-census] ${runs.length} malls in ${genMs} ms -> ${file.pathname}\n`);
}, 600000);
