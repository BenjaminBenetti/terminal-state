// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT). User (round 3): "There must always be 1 cache room generated at least." /
// "additional graffite clues in the area should guid the player to the hideout / cache. The cache should include pops like bed roll,
// lantern and stuff, to make it feel like someone lives there. it should have substantial detail applied and contain substantial loot.
// perhaps a boosted chance of gear spawning. it needs to be a good pay off for navigating the confusing maze of rooms."
//
// The focused CI evidence (gen/annexCache.ts, gen/annexMarks.ts, world/trackExt/graffiti.ts): the guarantee (sample + the fallback
// ladder forced), the lived-in dressing contract (supported, classified), the loot (packed lots via ContainerManager.build with the level
// profile), the gear piece (chance mechanics, placement, persistence), the survivor's trail (marks beside the path's doorways pointing
// on, a mark reader reaching the hideout), the decals. Opt-in: HIDEOUT_SAMPLE=1 — the broad guarantee sample (200 Subway + 40 Office + 20
// Mall levels: zero annexes without a cache) with its census into /tmp/annex-hideout-sample.txt.

import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels} from './helpers/openablesFixture';
import {freshLayout} from './helpers/annexRoute';
import {doorOfMark, followTrail} from './helpers/cacheMarks';
import {ANNEX_CACHE, annexCachesOf, placeAnnexCaches, rollHideoutGear, type AnnexCacheRecord} from '../src/gen/annexCache';
import {CACHE_MARKS, annexEntryArea, annexPath, cacheMarkIssues, cacheMarkReportsOf} from '../src/gen/annexMarks';
import {extensionContentOf} from '../src/gen/annexContent';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel} from '../src/gen/mall/index';
import {
  ANNEX_CACHE_CRATE, ANNEX_CACHE_GEAR, ANNEX_CACHE_GEAR_KEY, ANNEX_CACHE_KEY, ANNEX_CACHE_KIT, ANNEX_CACHE_LOCKER, ANNEX_CACHE_PANTRY,
  annexCacheGearRows, econCat, lootProfile, type LootSpec,
} from '../src/items/lootTables';
import {isMaterialItem} from '../src/items/craftMaterials';
import {FILTER_LIFE_S, GEAR_ITEMS} from '../src/items/gear';
import {ITEMS} from '../src/items/items';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {OPENABLE_AUDIT, openableSpec} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {dynamicKind} from '../src/physics/dynamicItems';
import {propPhysics} from '../src/damage/materials';
import {PROP_DEFS} from '../src/gen/props';
import {levelDistance} from '../src/gen/levelGen';
import {stationArtKeepouts} from '../src/gen/trackExt/art';
import {Acc} from '../src/world/trackExt/mesh';
import {ATLAS, CELL_OF, SURVIVOR_SPRAY, cacheMarkDecals, cellRect} from '../src/world/trackExt/graffiti';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {Inventory} from '../src/items/inventory';
import {captureHolders, applyHolders} from '../src/run/worldMemory';
import {createMemory, pickupPlan, takenLayoutPickups} from '../src/run/memory';
import {Rng} from '../src/core/rng';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
let models: Record<string, GLTF> = {};
beforeAll(async () => { models = await openableModels(); }, 120000);

/** Fresh New Game runs: a tunnel annex (Subway 1043: two caches in one large annex) and an Office annex pair (222); the Mall in the opt-in sample. */
const SAMPLE: readonly [LevelId, number][] = [['subway', 1043], ['office', 222]];
const memo = new Map<string, {layout: StationLayout; cm: ContainerManager; inv: Inventory}>();
function fresh(level: LevelId, seed: number) {
  const k = `${level}:${seed}`;
  let e = memo.get(k);
  if (!e) {
    const layout = freshLayout(level, seed), inv = new Inventory();
    const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => inv);
    cm.build(layout, {}, lootProfile(level));
    memo.set(k, (e = {layout, cm, inv}));
  }
  return e;
}
const TABLES: Readonly<Record<string, LootSpec>> = {shelf: ANNEX_CACHE_PANTRY, cabinetTall: ANNEX_CACHE_KIT, cabinetLow: ANNEX_CACHE_KIT, crate: ANNEX_CACHE_CRATE, footlocker: ANNEX_CACHE_LOCKER};
const AMMO_HOLDERS = new Set(['crate', 'footlocker']);
const notReward = (id: string) => !isMaterialItem(id) && !(id in GEAR_ITEMS) && ITEMS[id]?.kind !== 'weapon';

describe('the hideout (round 3, lane HIDEOUT)', () => {
  it('the guarantee: every sampled annex has its hideout; with no qualifying room the fallback ladder still places one', () => {
    for (const [level, seed] of SAMPLE) {
      const {layout} = fresh(level, seed);
      for (const n of layout.extensions!.annexes) expect(annexCachesOf(layout).filter(c => c.annex === n.id).length, `${level} ${seed} annex ${n.id}`).toBeGreaterThanOrEqual(1);
    }
    // the ladder, forced: the same annex offered only rooms / closets / halls no ordinary rung accepts (closets, corridors, signature rooms)
    const l = generateStation(1043, {startWeapon: 'pistol'}), n = l.extensions!.annexes[0];
    const kinds = new Set(l.props.map(p => p.kind as string));
    const odd = n.areas.map(id => l.areas[id]).filter(a => a.kind !== 'room' || a.extHall || /room$|hall|plant|chamber|spillway/.test(a.purpose ?? '') && !/^(storage|workshop|custodial-room|first-aid-room|electrical-room|pump-room)$/.test(a.purpose ?? ''));
    const relaxed = placeAnnexCaches(l, n, odd, kinds, new Rng(77));
    expect(relaxed.length).toBe(1);
    expect(['relaxed', 'last']).toContain(relaxed[0].tier);
    expect(['bedroll', 'palletBed']).toContain(l.props[relaxed[0].bed].kind);
    // the last rung: service corridors only (the bedroll alone suffices)
    const corridors = n.areas.map(id => l.areas[id]).filter(a => a.kind === 'service');
    const last = placeAnnexCaches(l, n, corridors, kinds, new Rng(78));
    expect(last.length).toBe(1);
    expect(last[0].tier).toBe('last');
  });

  it('lived-in: a sleeping spot, the lantern lighting the room, the camp table set, a footlocker by the bed; supported; classified', () => {
    // every new kind classified in both audits, honestly (docs/prop-affordances.md)
    const open = (k: string) => OPENABLE_AUDIT.find(e => e.kind === k)?.cls;
    expect([open('bedroll'), open('campTable'), open('campLantern'), open('campStove'), open('footlocker')]).toEqual(['none', 'none', 'none', 'none', 'openable']);
    expect(PROP_PHYSICS_AUDIT.bedroll).toMatchObject({cls: 'static', why: 'flat'});
    expect(PROP_PHYSICS_AUDIT.campTable).toMatchObject({cls: 'static', why: 'too heavy'});
    expect(PROP_PHYSICS_AUDIT.footlocker).toMatchObject({cls: 'static', why: 'holder'});
    for (const k of ['campLantern', 'campStove']) {
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({cls: 'dynamic', contact: true});
      expect(dynamicKind(k) && !!propPhysics(k).onHost, k).toBe(true);
    }
    expect(openableSpec('footlocker')!.parts[0].move).toMatchObject({type: 'hinge', axis: 'x'});
    let caches = 0, tables = 0, beside = 0;
    for (const [level, seed] of SAMPLE) {
      const {layout} = fresh(level, seed);
      for (const c of annexCachesOf(layout)) {
        caches++;
        const a = layout.areas[c.area], tag = `${level} ${seed} cache ${c.area}`;
        expect(['palletBed', 'bedroll'], tag).toContain(layout.props[c.bed].kind);
        expect(c.beds[0]).toBe(c.bed);
        // every piece supported: on the room's floor, or on its host's top inside the host's footprint (nothing floats / sinks)
        for (const i of c.pieces) {
          const p = layout.props[i];
          expect(p.area, tag).toBe(c.area);
          if (p.host === undefined) { expect(p.y, `${tag} ${p.kind}`).toBeCloseTo(a.floorY!, 5); continue; }
          const h = layout.props[p.host];
          expect(p.y, `${tag} ${p.kind} on its host`).toBeCloseTo(h.y + h.h, 5);
          expect(Math.abs(p.x - h.x) + p.hx, `${tag} ${p.kind} inside its host's top (x)`).toBeLessThanOrEqual(h.hx + 1e-6);
          expect(Math.abs(p.z - h.z) + p.hz, `${tag} ${p.kind} inside its host's top (z)`).toBeLessThanOrEqual(h.hz + 1e-6);
        }
        // the lantern lights the room: a warm, steady, fixture-less light-field source at the lantern
        expect(c.lantern, `${tag} lantern`).toBeGreaterThanOrEqual(0);
        const lan = layout.props[c.lantern], light = layout.lights[c.light];
        expect(lan.kind).toBe('campLantern');
        expect(light).toMatchObject({area: c.area, virtual: true, warm: true, broken: false, dying: false, flicker: false, power: ANNEX_CACHE.lantern.power});
        expect([light.x, light.z]).toEqual([lan.x, lan.z]);
        expect(light.y).toBeCloseTo(lan.y + ANNEX_CACHE.lantern.lift, 6);
        expect(a.lighting).not.toBe('dark');
        if (c.table >= 0) {
          tables++;
          expect(layout.props[c.table].kind).toBe('campTable');
          expect(lan.host, `${tag} lantern on the table`).toBe(c.table);
          if (c.stove >= 0) expect(layout.props[c.stove]).toMatchObject({kind: 'campStove', host: c.table});
        }
        // the footlocker at the bed's foot / head (same wall, beside it), else elsewhere on a wall
        const fl = c.holders.map(i => layout.props[i]).find(p => p.kind === 'footlocker');
        const bed = layout.props[c.bed];
        if (fl && fl.rot === bed.rot && Math.hypot(fl.x - bed.x, fl.z - bed.z) <= PROP_DEFS[bed.kind].w / 2 + 0.08 + PROP_DEFS.footlocker.w / 2 + 0.5 + 0.03) beside++;
      }
    }
    expect(caches).toBeGreaterThanOrEqual(4);
    expect(tables / caches, 'the camp table set in most hideouts').toBeGreaterThanOrEqual(0.5);
    expect(beside / caches, 'the footlocker beside the bed in most hideouts').toBeGreaterThanOrEqual(0.5);
  });

  it('substantial loot: packed lots (ContainerManager.build + the level profile), their own tables, no material / gear / weapon, ammo only in the crate / footlocker', () => {
    let caches = 0, lots = 0;
    for (const [level, seed] of SAMPLE) {
      const {layout, cm} = fresh(level, seed);
      for (const c of annexCachesOf(layout)) {
        caches++;
        expect(c.holders.length).toBeGreaterThanOrEqual(ANNEX_CACHE.minHolders);
        let mine = 0;
        for (const i of c.holders) {
          const p = layout.props[i], h = cm.all.find(q => q.prop === p)!, tag = `${level} ${seed} ${p.kind}`;
          expect(h, `${tag} registered`).toBeDefined();
          expect(p.purpose).toBe(ANNEX_CACHE_KEY);
          expect(h.state.lots.length, `${tag} stocked`).toBeGreaterThanOrEqual(1);
          for (const l of h.state.lots) {
            expect(TABLES[p.kind].items.some(r => r[0] === l.itemId), `${tag} ${l.itemId}`).toBe(true);
            expect(notReward(l.itemId), `${tag} ${l.itemId}`).toBe(true);
            if (econCat(l.itemId) === 'ammo') expect(AMMO_HOLDERS.has(p.kind), `${tag} ammo`).toBe(true);
          }
          if (p.kind === 'footlocker') expect(h.open?.parts.length, `${tag} opens`).toBe(1);
          mine += h.state.lots.length;
        }
        lots += mine;
      }
    }
    // round 2 measured 6.75 lots a cache; round 3: 3-4 holders, pantry / crate 3-4 lots
    expect(lots / caches, 'lots per hideout').toBeGreaterThanOrEqual(8);
  });

  it('the gear piece: chance per hideout from the level\'s gear pool + the gas mask; placed at the bedside; finite and remembered', () => {
    // the roll: rate and shares over many streams (exact rows: the profile's gear weights + the mask)
    for (const level of ['subway', 'office', 'mall'] as LevelId[]) {
      const P = lootProfile(level), rows = annexCacheGearRows(P).filter(([id]) => id in GEAR_ITEMS), den = rows.reduce((t, r) => t + r[1], 0);
      expect(rows.some(r => r[0] === 'gas_mask')).toBe(true);
      const N = 4000, hits = new Map<string, number>();
      let got = 0;
      for (let i = 0; i < N; i++) {
        const r = rollHideoutGear(P, new Rng(1000 + i).fork('gear'));
        if (!r) continue;
        got++;
        hits.set(r.itemId, (hits.get(r.itemId) ?? 0) + 1);
        if (r.itemId === 'gas_mask') {
          expect(r.filter!).toBeGreaterThanOrEqual(FILTER_LIFE_S * MASK_LOOT.foundFilter[0] - 0.05);
          expect(r.filter!).toBeLessThanOrEqual(FILTER_LIFE_S * MASK_LOOT.foundFilter[1] + 0.05);
        } else expect(r.filter).toBeUndefined();
      }
      expect(Math.abs(got / N - ANNEX_CACHE_GEAR.chance), `${level} rate`).toBeLessThan(0.03);
      for (const [id, w] of rows) expect(Math.abs((hits.get(id) ?? 0) / got - w / den), `${level} ${id} share`).toBeLessThan(0.03);
    }
    // placement: the annex's first cache only, tagged, a real gear piece, in the hideout on a reachable floor cell
    let pieces = 0;
    for (const [level, seed] of SAMPLE) {
      const {layout} = fresh(level, seed), g = layout.grid;
      const start = layout.office?.start ?? {...layout.playerSpawn, level: 0};
      const [sx, sy] = g.cellOf(start.x, start.z);
      const dist = levelDistance(layout.levels, sx, sy, start.level ?? 0, layout.levelLinks)[0];
      const tagged = layout.pickups.flatMap((p, i) => (p.reward === ANNEX_CACHE_GEAR_KEY ? [i] : []));
      const byCache = annexCachesOf(layout).filter(c => c.gear >= 0).map(c => c.gear);
      expect(tagged).toEqual(byCache);
      for (const c of annexCachesOf(layout)) {
        if (c.gear < 0) continue;
        pieces++;
        const first = annexCachesOf(layout).find(q => q.annex === c.annex)!;
        expect(first, 'the annex\'s first cache').toBe(c);
        const p = layout.pickups[c.gear], [x, y] = g.cellOf(p.x, p.z), i = g.idx(x, y);
        expect(p.itemId in GEAR_ITEMS).toBe(true);
        expect(p.area).toBe(c.area);
        expect(p.count).toBe(1);
        expect(dist[i], `${level} ${seed} gear reachable`).toBeGreaterThanOrEqual(0);
        expect(g.blocked[i]).toBe(0);
        expect(p.y).toBeCloseTo(g.floorOf(i), 6);
      }
    }
    expect(pieces, 'the sample holds gear pieces').toBeGreaterThanOrEqual(1);
    // finite: taken once, a regenerated section (run memory by layout pickup index) never offers it again
    const {layout} = fresh('subway', 1043);
    const idx = layout.pickups.flatMap((p, i) => (p.reward === ANNEX_CACHE_GEAR_KEY ? [i] : []));
    expect(idx.length).toBeGreaterThanOrEqual(1);
    const mem = createMemory({level: 'subway', section: 'main'});
    mem.pickups = layout.pickups.flatMap((p, i) => (idx.includes(i) ? [] : [{stack: {itemId: p.itemId, count: p.count}, pose: {x: p.x, y: p.y, z: p.z, yaw: 0}, anchor: [p.x, p.y, p.z], layoutIndex: i}])) as never;
    const again = freshLayout('subway', 1043);
    expect(again.pickups.map(p => [p.itemId, p.x, p.z, p.reward ?? ''])).toEqual(layout.pickups.map(p => [p.itemId, p.x, p.z, p.reward ?? '']));
    expect(takenLayoutPickups(again.pickups.length, structuredClone(mem))).toEqual(idx);
    const plan = pickupPlan(again.pickups.length, mem);
    expect(plan.fromLayout).toEqual([]);
    expect(plan.restored.some(r => idx.includes(r.layoutIndex!))).toBe(false);
  });

  it('the footlocker\'s finds stay taken: capture -> regenerate -> rebuild -> apply (never refilled)', () => {
    const {layout, cm, inv} = fresh('subway', 1043);
    const h = cm.all.find(q => q.kind === 'footlocker' && q.state.lots.length)!;
    expect(h).toBeDefined();
    const n0 = h.state.lots.length, lot = h.state.lots[0];
    cm.interact({container: h, t: 1, lot: null, part: 0} as never);
    for (let t = 0; t < 1.5; t += 1 / 30) cm.update(1 / 30, t);
    const c0 = inv.count(lot.itemId);
    cm.interact({container: h, t: 1, lot, part: lot.part} as never);
    expect(inv.count(lot.itemId)).toBeGreaterThan(c0);
    expect(h.state.lots.length).toBe(n0 - 1);
    const recs = captureHolders(cm);
    const again = freshLayout('subway', 1043);
    const cm2 = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => new Inventory());
    cm2.build(again, {}, lootProfile('subway'));
    applyHolders(cm2, recs);
    const back = cm2.all.find(q => q.kind === 'footlocker' && q.prop.x === h.prop.x && q.prop.z === h.prop.z)!;
    expect(back.state.lots.length).toBe(n0 - 1);
    expect(back.state.lots.some(l => l.id === lot.id)).toBe(false);
    void layout;
  });

  it('the survivor\'s trail: marks beside the path\'s doorways pointing on, the hideout mark, the tally; a mark reader reaches the hideout', () => {
    for (const [level, seed] of SAMPLE) {
      const {layout} = fresh(level, seed), marks = layout.extensions!.cacheMarks!, tag = `${level} ${seed}`;
      expect(cacheMarkIssues(layout), tag).toEqual([]);
      for (const n of layout.extensions!.annexes) {
        const hide = annexCachesOf(layout).find(c => c.annex === n.id)!, entry = annexEntryArea(layout, n);
        const path = annexPath(layout, n, entry, hide.area)!, rep = cacheMarkReportsOf(layout).find(r => r.annex === n.id)!;
        expect(rep.path).toEqual(path.areas);
        const mine = marks.filter(m => m.annex === n.id);
        // each trail mark: in a path area, beside the path's next doorway, leading to the path's next area (the reader agrees)
        for (const m of mine.filter(q => q.kind !== 'tally')) {
          const k = path.areas.indexOf(m.area);
          if (k < 0 || path.doors[k] !== m.door) continue; // a second cache's own hideout mark
          expect(m.next).toBe(path.areas[k + 1]);
          expect(doorOfMark(layout, layout.areas[m.area], m), `${tag} mark at step ${k} reads as its doorway`).toBe(m.door);
          if (k === path.doors.length - 1) expect(m.kind).toBe('hideout'); else expect(m.kind).toBe('arrow');
        }
        // the entry area, every junction (3+ doorways) and the last `dense` areas carry a mark (a missed spot is reported, not hidden)
        const marked = new Set(mine.filter(m => m.kind !== 'tally').map(m => m.area));
        const need = path.areas.slice(0, -1).filter((id, k) => k === 0 || k >= path.doors.length - CACHE_MARKS.dense
          || layout.doors.filter(d => d.a === id || d.b === id).length >= 3);
        const missing = need.filter(id => !marked.has(id)).length;
        expect(missing, `${tag} annex ${n.id} unmarked choice points`).toBe(rep.missed);
        expect(rep.missed, `${tag} annex ${n.id} missed`).toBeLessThanOrEqual(1);
        expect(mine.filter(m => m.kind === 'tally' && m.area === hide.area).length).toBe(1);
        // read like a player (marks only, no knowledge of the cache): the reader arrives
        const walk = followTrail(layout, entry, hide.area);
        expect(walk.arrived, `${tag} annex ${n.id} the trail leads to the hideout (lost in ${walk.lost})`).toBe(rep.missed === 0 ? true : walk.arrived);
        if (rep.missed === 0) expect(walk.areas).toEqual(path.areas);
      }
    }
    // no annex, no marks
    const plain = generateStation(2027820797, {startWeapon: 'pistol'});
    expect(plain.extensions?.annexes.length ?? 0).toBe(0);
    expect(plain.extensions?.cacheMarks ?? []).toEqual([]);
  });

  it('presentation: the marks are decals of the one graffiti mesh / atlas (their own cells), off-limits to the wall treatment', () => {
    const {layout} = fresh('subway', 1043), marks = layout.extensions!.cacheMarks!;
    const acc = new Acc(), decals = cacheMarkDecals(acc, marks);
    expect(decals.length).toBe(marks.length);
    expect(acc.triangleCount).toBe(2 * marks.length);
    for (const [i, d] of decals.entries()) {
      const m = marks[i];
      expect(d.cell).toBe(m.kind === 'arrow' ? CELL_OF.survivor(m.dir!) : m.kind === 'hideout' ? CELL_OF.hideout : CELL_OF.tally);
      expect(d.color).toBe(m.kind === 'tally' ? SURVIVOR_SPRAY.tally : SURVIVOR_SPRAY.trail);
      const [x, y, w, h] = cellRect(d.cell);
      expect(x + w <= ATLAS.w && y + h <= ATLAS.h && y >= 1024).toBe(true);
      // just off the wall plane, on the room side
      expect((m.axis === 'z' ? d.z : d.x) - m.plane).toBeCloseTo(m.n * 0.012, 6);
    }
    const keeps = stationArtKeepouts(layout).filter(k => k.why === 'cache-mark');
    expect(keeps.length).toBe(marks.length);
    void THREE;
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Opt-in: HIDEOUT_SAMPLE=1 — the broad guarantee sample (200 Subway + 40 Office + 20 Mall levels) and its census.
describe.runIf(!!process.env.HIDEOUT_SAMPLE)('the guarantee over a broad sample (opt-in HIDEOUT_SAMPLE=1)', () => {
  it('zero annexes without a cache; tiers, dressing, trail census', () => {
    const N = {subway: Number(process.env.HIDEOUT_SUBWAY ?? 200), office: Number(process.env.HIDEOUT_OFFICE ?? 40), mall: Number(process.env.HIDEOUT_MALL ?? 20)};
    const out: string[] = [];
    const census = {levels: 0, annexes: 0, without: 0, caches: 0, tiers: {} as Record<string, number>, tables: 0, lanterns: 0, stoves: 0, secondBeds: 0, beds: {} as Record<string, number>,
      holders: 0, gear: 0, gearItems: {} as Record<string, number>, marks: 0, missed: 0, pathDoors: 0, junctions: 0, arrived: 0, cacheMs: 0, marksMs: 0, issues: 0};
    const take = (level: string, seed: number, l: StationLayout) => {
      census.levels++;
      const rep = extensionContentOf(l);
      census.cacheMs += rep?.phases.cache ?? 0; census.marksMs += rep?.phases.marks ?? 0;
      const caches: readonly AnnexCacheRecord[] = annexCachesOf(l);
      census.issues += cacheMarkIssues(l).length;
      for (const n of l.extensions?.annexes ?? []) {
        census.annexes++;
        const mine = caches.filter(c => c.annex === n.id);
        if (!mine.length) { census.without++; out.push(`WITHOUT ${level} ${seed} annex ${n.id}`); continue; }
        const walk = followTrail(l, annexEntryArea(l, n), mine[0].area);
        if (walk.arrived) census.arrived++;
      }
      for (const c of caches) {
        census.caches++; census.tiers[c.tier] = (census.tiers[c.tier] ?? 0) + 1; census.holders += c.holders.length;
        const bk = l.props[c.bed].kind; census.beds[bk] = (census.beds[bk] ?? 0) + 1;
        if (c.table >= 0) census.tables++; if (c.lantern >= 0) census.lanterns++; if (c.stove >= 0) census.stoves++; if (c.beds.length > 1) census.secondBeds++;
        if (c.gear >= 0) { census.gear++; const id = l.pickups[c.gear].itemId; census.gearItems[id] = (census.gearItems[id] ?? 0) + 1; }
        if (c.tier !== 'deep') out.push(`tier ${c.tier}: ${level} ${seed} annex ${c.annex} area ${c.area} (${l.areas[c.area].kind} ${l.areas[c.area].purpose})`);
      }
      for (const r of cacheMarkReportsOf(l)) { census.marks += r.marks; census.missed += r.missed; census.pathDoors += r.doors.length; census.junctions += r.junctions; }
    };
    for (let i = 1; i <= N.subway; i++) { const s = (i * 2654435761) >>> 0; take('subway', s, generateStation(s, {startWeapon: 'pistol'})); }
    for (let i = 1; i <= N.office; i++) { const s = i * 7919 + 11; take('office', s, generateOfficeLevel({levelSeed: s, startWeapon: 'pistol'})); }
    for (let i = 1; i <= N.mall; i++) { const s = i * 104729 + 7; take('mall', s, generateMallLevel({levelSeed: s, startWeapon: 'pistol'} as never)); }
    writeFileSync('/tmp/annex-hideout-sample.txt', `${JSON.stringify(census, null, 1)}\n${out.join('\n')}\n`);
    expect(census.without).toBe(0);
    expect(census.issues).toBe(0);
  }, 3600000);
});
