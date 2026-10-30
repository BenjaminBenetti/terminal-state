// Task office-interactions-layout-20261030 (lane ROOF), user feedback item 6: "There is no loot on the roof. The roof is sorta the
// 'end' of the level so I think there should at least be good item up there."
//
// The roof payoff on the REAL generated Office Space level: exactly ONE curated reward holder (a supply crate, loot key
// ROOF_CACHE_KEY) per logical Office run, on the roof deck, tucked against the roof plant and reachable from the hatch; its contents
// come from the curated ROOF_CACHE table (items/lootTables.ts: a first-aid kit or a trauma kit + a full ammo box), rolled once, deterministic per seed, EXACT (the documented exception to the scarcity cut: nothing cut / re-themed /
// converted, every lot placed), finite and remembered by run memory (take -> rebuild -> still taken). No rare-gear roll; every other
// storey's holders / pickups / enemies are byte-identical to a build without the reward; the Subway never has one. Bounded corpus.
//
// Task gas-mask-roof-feedback-20261030 (user item 10: "Roof also needs more loot. I got just a med kit in this run ... It should have
// at least 1 gear or weapon item up there"): the ROOF FIND (items/lootTables.ts ROOF_FIND, gen/office/roof.ts placeRoofFind) — ONE
// non-starter long gun + a box of its own caliber, or a protective gear piece, laid on the deck beside the cache as layout pickups
// (reward: ROOF_FIND_KEY), verified AFTER placement on many seeds (walkable, reachable from the start by the ladder, clear of props /
// structures / the hatch), deterministic per level seed (Retry / revisits never re-roll it; a New Game seed rolls again), never the
// start weapon, finite (layout pickup memory); every other storey's loot is unchanged (an explicit roof exception).

import {describe, expect, it} from 'vitest';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateStation} from '../src/gen/station';
import {officeIssues} from '../src/gen/office/validate';
import {FIND_AMMO_CLEAR, FIND_CLEAR, HATCH_CLEAR, ROOF_CACHE_ANCHORS, rollRoofFind, roofRewardIssues, roofRewardPose} from '../src/gen/office/roof';
import {MARGIN, OFFICE_ROOF_LEVEL, towerFrame} from '../src/gen/office/frame';
import {CELL, FLOOR} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {PROP_DEFS} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {
  BASE_TABLES, BOX_COUNT, PROFILES, REWARD_FINDS, ROOF_CACHE, ROOF_CACHE_KEY, ROOF_FIND, ROOF_FIND_KEY, REWARD_TABLES, econCat, gearParams,
  rewardFind, rewardTable, validateLootProfile, type LootProfile, type RewardFind, type RewardTable,
} from '../src/items/lootTables';
import {REWARD_REPACKS, createHolderState, holderFinds, holderTable, rollLootItems, takeLot, type HolderKind, type Lot} from '../src/items/loot';
import {holderSurfaces, placementBox} from '../src/items/lootLayout';
import {Inventory} from '../src/items/inventory';
import {GEAR_ITEMS} from '../src/items/gear';
import {ITEMS} from '../src/items/items';
import {ammoItemFor} from '../src/items/calibers';
import {WEAPONS} from '../src/weapons/weapons';
import {WEAPON_FIND_AMMO, findWeaponsFor} from '../src/gen/weaponFinds';
import {placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import {applyHolderRecord, captureHolder, createMemory, holderKey, pickupPlan, takenLayoutPickups} from '../src/run/memory';
import {ECONOMY_CORPUS, layoutHolders} from './helpers/lootEconomy';

const SEEDS = [11, 222, 3333, 0x5ea1e55, 90210];
const OFFICE = PROFILES.office;
/** The Office profile with no roof reward (the comparison build: same tables otherwise). */
const NO_REWARD: LootProfile = {id: 'office', label: 'Office (no roof reward)', tables: {...BASE_TABLES, rewards: {}, rewardFinds: {}}, overrides: {}};

const cache = new Map<string, StationLayout>();
const gen = (seed: number, profile: LootProfile = OFFICE): StationLayout => {
  const k = `${seed}:${profile === OFFICE ? 'office' : 'none'}`;
  if (!cache.has(k)) cache.set(k, generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}, profile));
  return cache.get(k)!;
};
const rewardHolders = (l: StationLayout, p: LootProfile = OFFICE) => layoutHolders(l, p).filter(h => h.areaType === ROOF_CACHE_KEY);

/** The curated pool and its "worthwhile" (guaranteed) first pick. */
const POOL = new Set(ROOF_CACHE.picks.flatMap(p => p.items.map(r => r[0])));
const WORTHWHILE = new Set(ROOF_CACHE.picks[0].items.map(r => r[0]));

describe('roof reward data (items/lootTables.ts ROOF_CACHE, the documented roof exception)', () => {
  it('is curated existing items, guaranteed non-empty, carried by an existing holder, valid in every profile; no gear', () => {
    expect(REWARD_TABLES[ROOF_CACHE_KEY]).toBe(ROOF_CACHE);
    expect(BASE_TABLES.rewards?.[ROOF_CACHE_KEY]).toBe(ROOF_CACHE);
    expect(ROOF_CACHE.holder).toBe('crate');
    // the worthwhile first pick is guaranteed: no empty chance, one lot, top-tier medicine only
    expect(ROOF_CACHE.picks[0]).toMatchObject({empty: 0, lots: [1, 1]});
    expect([...WORTHWHILE].sort()).toEqual(['medkit', 'trauma_kit']);
    // the ammo pick is guaranteed and generic (the three calibers, ~1/3 each) — no legacy ammo ids
    expect(ROOF_CACHE.picks[1]).toMatchObject({empty: 0, lots: [1, 1]});
    expect(ROOF_CACHE.picks[1].items.map(r => r[0])).toEqual(['ammo_9mm', 'ammo_556', 'ammo_12ga']);
    for (const id of POOL) {
      expect(econCat(id), id).not.toBeNull(); // consumables + ammo only
      expect(id in GEAR_ITEMS, id).toBe(false); // no rare gear in the cache
      expect(/ammo_(pistol|rifle|shells)/.test(id), id).toBe(false);
    }
    for (const p of Object.values(PROFILES)) expect(validateLootProfile(p), p.id).toEqual([]);
    expect(validateLootProfile(NO_REWARD)).toEqual([]);
    // gear stays ONE roll per logical level with the shared parameters (the reward adds no gear roll)
    expect(gearParams(OFFICE)).toBe(BASE_TABLES.gear);
    // identity resolution (byte-identical draws) and the override reach: item weights yes, keep no
    expect(rewardTable(OFFICE, ROOF_CACHE_KEY)).toBe(ROOF_CACHE);
    expect(rewardTable(OFFICE, 'storage')).toBeUndefined();
    const noKit: LootProfile = {id: 'x', label: 'x', tables: BASE_TABLES, overrides: {itemWeight: {medkit: 0}}};
    expect(rewardTable(noKit, ROOF_CACHE_KEY)!.picks[0].items).toEqual([['trauma_kit', 1]]);
  });

  it('validation rejects a broken reward (unknown item, no guaranteed pick, a fixture / unknown holder)', () => {
    const bad = (rw: RewardTable) => validateLootProfile({id: 'bad', label: 'bad', tables: {...BASE_TABLES, rewards: {r: rw}}, overrides: {}});
    expect(bad({...ROOF_CACHE, picks: [{lots: [1, 1], empty: 0, items: [['no_such_item', 1]]}]}).join('\n')).toMatch(/unknown item id no_such_item/);
    expect(bad({...ROOF_CACHE, picks: [{lots: [1, 1], empty: 0.5, items: [['medkit', 1]]}]}).join('\n')).toMatch(/no guaranteed pick/);
    expect(bad({...ROOF_CACHE, picks: [{lots: [0, 1], empty: 0, items: [['medkit', 1]]}]}).join('\n')).toMatch(/no guaranteed pick/);
    expect(bad({...ROOF_CACHE, holder: 'fireExtinguisherCabinet'}).join('\n')).toMatch(/not a loot holder kind/);
    expect(bad({...ROOF_CACHE, holder: 'waterTower'}).join('\n')).toMatch(/not a loot holder kind/);
  });
});

describe('the roof cache is rolled exactly: guaranteed, never cut by the scarcity economy, always fits', () => {
  const N = 600;
  it('every roll holds exactly one top-tier medicine and one full ammo box, all from the curated pool', () => {
    const kits: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const items = rollLootItems(4242, i, 'crate', ROOF_CACHE_KEY, OFFICE);
      expect(items.filter(e => WORTHWHILE.has(e.itemId)), `roll ${i}`).toHaveLength(1);
      const ammo = items.filter(e => econCat(e.itemId) === 'ammo');
      expect(ammo, `roll ${i}`).toHaveLength(1);
      const [lo, hi] = BOX_COUNT[ammo[0].itemId].big; // a crate holds full-size boxes
      expect(ammo[0].count).toBeGreaterThanOrEqual(lo); expect(ammo[0].count).toBeLessThanOrEqual(hi);
      expect(items).toHaveLength(2);
      for (const e of items) expect(POOL.has(e.itemId), e.itemId).toBe(true);
      for (const e of items) if (WORTHWHILE.has(e.itemId)) kits[e.itemId] = (kits[e.itemId] ?? 0) + 1;
      // the scarcity view: every entry is the holder's own exact roll (nothing cut, re-themed or turned into a limb treatment)
      expect(holderFinds(4242, i, 'crate', ROOF_CACHE_KEY, true, OFFICE).every(f => f.source === 'roll')).toBe(true);
    }
    // a first-aid kit 2 : 1 a trauma kit
    expect(kits.medkit / N).toBeGreaterThan(0.58); expect(kits.medkit / N).toBeLessThan(0.75);
    expect(holderTable('crate', ROOF_CACHE_KEY, OFFICE)).toMatchObject({slot: 'container', source: 'reward', empty: 0, lots: [2, 2]});
    // the same crate kind with an ordinary loot key still goes through the scarcity economy
    expect(holderTable('crate', 'storage', OFFICE).source).toBe('purpose');
  });

  it('keep / slot overrides (the scarcity cut, the container slot) never reach it; a med keep of 0 still leaves the medicine', () => {
    const harsh: LootProfile = {id: 'harsh', label: 'harsh', tables: BASE_TABLES, overrides: {keep: {med: 0}, slot: {container: {empty: 10, lots: 0}}}};
    for (let i = 0; i < 200; i++) expect(rollLootItems(77, i, 'crate', ROOF_CACHE_KEY, harsh)).toEqual(rollLootItems(77, i, 'crate', ROOF_CACHE_KEY, OFFICE));
    expect(rollLootItems(77, 3, 'crate', ROOF_CACHE_KEY, harsh).some(e => WORTHWHILE.has(e.itemId))).toBe(true);
  });

  it('every rolled lot is placed inside the crate (model lid split, placeholder lid, test helper split), without overlaps', () => {
    const def = PROP_DEFS.crate;
    expect(REWARD_REPACKS).toBeGreaterThan(0);
    for (const split of [0.81 * def.h, def.h - 0.07, 0.817 * def.h]) {
      const surfaces = holderSurfaces('crate', def, {crateSplitY: split});
      for (let i = 0; i < 1500; i++) {
        const seed = 1000 + (i % 7) * 7919, index = Math.floor(i / 7);
        const rolled = rollLootItems(seed, index, 'crate', ROOF_CACHE_KEY, OFFICE);
        const st = createHolderState(seed, index, 'crate' as HolderKind, ROOF_CACHE_KEY, surfaces, undefined, OFFICE);
        expect(st.lots.map(l => [l.itemId, l.count]), `seed ${seed} index ${index} split ${split.toFixed(3)}`).toEqual(rolled.map(e => [e.itemId, e.count]));
        // placed on the one crate floor, inside it, side by side along X without overlaps
        const s = surfaces[0];
        const spans = st.lots.map(l => {
          const box = placementBoxOf(l);
          expect(box.x0).toBeGreaterThanOrEqual(s.x0 - 1e-6); expect(box.x1).toBeLessThanOrEqual(s.x1 + 1e-6);
          expect(box.z0).toBeGreaterThanOrEqual(s.z0 - 1e-6); expect(box.z1).toBeLessThanOrEqual(s.z1 + 1e-6);
          return box;
        }).sort((a, b) => a.x0 - b.x0);
        for (let k = 1; k < spans.length; k++) expect(spans[k].x0).toBeGreaterThanOrEqual(spans[k - 1].x1 - 1e-6);
      }
    }
  });
});

describe('the roof cache on the real Office Space level (bounded seed set)', () => {
  it('exactly one reward holder per logical Office run, on the roof deck, tucked against the roof plant, clear of the hatch', () => {
    const anchors = new Map<string, number>();
    for (const seed of SEEDS) {
      const l = gen(seed), f = towerFrame(seed), R = l.levels[OFFICE_ROOF_LEVEL], g = R.grid;
      expect(officeIssues(l, f), `seed ${seed}`).toEqual([]);
      const caches = l.props.filter(p => p.purpose === ROOF_CACHE_KEY);
      expect(caches, `seed ${seed}`).toHaveLength(1); // the whole level (every storey): ONE reward
      const c = caches[0], rec = l.office!.roof!.reward!;
      expect(c.kind).toBe('crate');
      expect(c.level).toBe(OFFICE_ROOF_LEVEL);
      expect(c.y).toBeCloseTo(R.baseY, 6);
      expect(rec).toMatchObject({kind: 'crate', key: ROOF_CACHE_KEY, x: c.x, y: c.y, z: c.z, rot: c.rot});
      // inside the deck, off the parapet walkway (>= 1 m from the parapet), out of the hatch / ladder-head keep-clear zone
      const x0 = MARGIN * CELL, x1 = (MARGIN + f.TW) * CELL, z0 = MARGIN * CELL, z1 = (MARGIN + f.TD) * CELL;
      expect(c.x - c.hx).toBeGreaterThanOrEqual(x0 + 1 - 1e-6); expect(c.x + c.hx).toBeLessThanOrEqual(x1 - 1 + 1e-6);
      expect(c.z - c.hz).toBeGreaterThanOrEqual(z0 + 1 - 1e-6); expect(c.z + c.hz).toBeLessThanOrEqual(z1 - 1 + 1e-6);
      const h = l.office!.roof!.ladder.hatch;
      expect(Math.hypot(c.x - (h.x0 + h.x1) / 2, c.z - (h.z0 + h.z1) / 2)).toBeGreaterThan(HATCH_CLEAR + 0.5);
      const top = l.office!.roof!.ladder.top;
      expect(Math.hypot(c.x - top.x, c.z - top.z)).toBeGreaterThan(HATCH_CLEAR);
      // never overlapping another roof prop or structure footprint (plinths, vents, hatch, overrun)
      for (const p of l.props) if (p !== c && p.level === OFFICE_ROOF_LEVEL) expect(Math.abs(p.x - c.x) >= p.hx + c.hx - 1e-6 || Math.abs(p.z - c.z) >= p.hz + c.hz - 1e-6, `${p.kind}`).toBe(true);
      for (const s of l.office!.roof!.structures as {kind: string; x: number; z: number; w?: number; d?: number}[]) {
        if (s.w === undefined || s.d === undefined || s.kind === 'cableTray') continue;
        expect(Math.abs(s.x - c.x) >= s.w / 2 + c.hx || Math.abs(s.z - c.z) >= s.d / 2 + c.hz, `${s.kind}`).toBe(true);
      }
      // tucked against roof plant: within ~0.5 m of an anchor's footprint
      const anchor = l.props.filter(p => p.level === OFFICE_ROOF_LEVEL && p.kind === rec.anchor)
        .sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
      expect(anchor, `seed ${seed}: anchor ${rec.anchor}`).toBeDefined();
      expect(ROOF_CACHE_ANCHORS.flat()).toContain(rec.anchor);
      const gap = Math.max(Math.abs(anchor!.x - c.x) - anchor!.hx - c.hx, Math.abs(anchor!.z - c.z) - anchor!.hz - c.hz);
      expect(gap).toBeGreaterThan(0.17); expect(gap).toBeLessThan(0.75); // past its plinth (0.1) + 8 cm, never more than ~a cell away
      anchors.set(rec.anchor, (anchors.get(rec.anchor) ?? 0) + 1);
      // its cells are blocked (collision / nav) and its front access strip is open deck
      const [cx, cy] = g.cellOf(c.x, c.z);
      expect(g.blocked[g.idx(cx, cy)]).toBe(1);
      expect(roofRewardIssues(l)).toEqual([]);
    }
    expect(anchors.get('waterTower') ?? 0).toBeGreaterThan(0); // the landmark first
  });

  it('reachable from the hatch: a walk on the roof grid from the ladder head to the stand point; and from the start by the ladder', () => {
    for (const seed of SEEDS) {
      const l = gen(seed), g = l.levels[OFFICE_ROOF_LEVEL].grid;
      const pose = roofRewardPose(l)!;
      expect(pose.level).toBe(OFFICE_ROOF_LEVEL);
      const [gx, gy] = g.cellOf(pose.x, pose.z);
      expect(g.walkable(gx, gy), `seed ${seed}: stand point`).toBe(true);
      // BFS over the roof deck only (4-connected walkable cells) from the ladder head
      const top = l.office!.roof!.ladder.top, [tx, ty] = g.cellOf(top.x, top.z);
      const seen = new Uint8Array(g.w * g.h), q = [g.idx(tx, ty)];
      seen[q[0]] = 1;
      while (q.length) {
        const i = q.pop()!, x = i % g.w, y = (i - x) / g.w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const j = g.idx(nx, ny);
          if (!seen[j] && g.walkable(nx, ny)) { seen[j] = 1; q.push(j); }
        }
      }
      expect(seen[g.idx(gx, gy)], `seed ${seed}: hatch -> cache`).toBe(1);
      // the facing pose looks at the crate (yaw: forward = (-sin, -cos))
      const c = l.office!.roof!.reward!;
      expect(Math.hypot(pose.x - Math.sin(pose.yaw) * 0.8 - c.x, pose.z - Math.cos(pose.yaw) * 0.8 - c.z)).toBeLessThan(0.5);
      // and the player gets there from the start (stairs + the ladder link)
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      expect(levelDistance(l.levels, sx, sy, 0, l.levelLinks)[OFFICE_ROOF_LEVEL][g.idx(gx, gy)], `seed ${seed}`).toBeGreaterThan(0);
      expect(g.cells[g.idx(gx, gy)]).toBe(FLOOR);
    }
  });

  it('contents: >= 1 worthwhile item from the curated pool, every rolled lot placed, deterministic per seed', () => {
    for (const seed of SEEDS) {
      const l = gen(seed);
      const hs = rewardHolders(l);
      expect(hs, `seed ${seed}`).toHaveLength(1);
      const h = hs[0];
      expect(h.kind).toBe('crate');
      expect(h.lots.filter(t => WORTHWHILE.has(t.itemId)).length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(h.lots.some(t => econCat(t.itemId) === 'ammo')).toBe(true);
      for (const t of h.lots) expect(POOL.has(t.itemId), t.itemId).toBe(true);
      expect(h.lots.map(t => t.itemId)).toEqual(rollLootItems(l.seed, h.index, 'crate', ROOF_CACHE_KEY, OFFICE).map(e => e.itemId));
      // the baseline profile (QA / tests default) rolls the very same reward (shared tables)
      expect(rewardHolders(l, PROFILES.subway)[0].lots).toEqual(h.lots);
      // deterministic: a fresh build of the same seed rolls the same lots at the same holder index
      const again = rewardHolders(generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}))[0];
      expect(again.index).toBe(h.index);
      expect(again.lots).toEqual(h.lots);
    }
  });

  it('finite and remembered: a taken lot stays taken across a rebuild (run memory holderKey + lot ids); nothing re-rolls or refills', () => {
    const seed = SEEDS[0], l = gen(seed);
    const c = l.props.find(p => p.purpose === ROOF_CACHE_KEY)!;
    const h = rewardHolders(l)[0];
    const surfaces = holderSurfaces('crate', PROP_DEFS.crate, {crateSplitY: 0.817 * PROP_DEFS.crate.h});
    const st = createHolderState(l.seed, h.index, 'crate', ROOF_CACHE_KEY, surfaces, undefined, OFFICE);
    const key = holderKey(c.kind, c.level, c.x, c.z);
    const all = st.lots.map(t => t.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // take the worthwhile item
    const inv = new Inventory();
    const kit = st.lots.find(t => WORTHWHILE.has(t.itemId))!;
    const r1 = takeLot(st, kit.id, inv);
    expect(r1.taken).toEqual([{itemId: kit.itemId, count: 1}]);
    const rec = structuredClone(captureHolder(st)); // section memory is JSON-safe (Retry snapshots clone it)
    // leave and come back (ladder / floor / level travel rebuilds nothing in the seamless world; a section rebuild re-rolls the same)
    const l2 = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'});
    const c2 = l2.props.find(p => p.purpose === ROOF_CACHE_KEY)!;
    expect(holderKey(c2.kind, c2.level, c2.x, c2.z)).toBe(key);
    const st2 = createHolderState(l2.seed, rewardHolders(l2)[0].index, 'crate', ROOF_CACHE_KEY, surfaces, undefined, OFFICE);
    expect(st2.lots.map(t => t.id)).toEqual(all); // the same finite roll
    expect(applyHolderRecord(st2, rec, {openable: false, container: true})).toBe(1);
    expect(st2.lots.some(t => t.id === kit.id)).toBe(false);
    expect(st2.lots.map(t => t.id)).toEqual(all.filter(id => id !== kit.id));
    expect(st2.searched).toBe(true);
    // empty it, rebuild again: still empty (never refilled), and a stale / foreign lot id is ignored
    for (const t of [...st2.lots]) takeLot(st2, t.id, inv);
    const rec2 = {...captureHolder(st2), lots: [...captureHolder(st2).lots, 999999]};
    const st3 = createHolderState(l2.seed, rewardHolders(l2)[0].index, 'crate', ROOF_CACHE_KEY, surfaces, undefined, OFFICE);
    applyHolderRecord(st3, rec2, {openable: false, container: true});
    expect(st3.lots).toEqual([]);
  });

  it('no other storey changes: holders / pickups / enemies off the roof are identical to a build without the roof rewards; no gear roll', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const a = gen(seed), b = gen(seed, NO_REWARD);
      expect(a.attempt).toBe(b.attempt);
      expect(b.props.some(p => p.purpose === ROOF_CACHE_KEY)).toBe(false);
      expect(b.office!.roof!.reward).toBeUndefined();
      expect(b.office!.roof!.find).toBeUndefined();
      expect(roofRewardIssues(b)).toEqual([]);
      // the reward is the only added prop, and the last loot holder: every other holder keeps its index and its lots
      expect(a.props.length).toBe(b.props.length + 1);
      expect(a.props[a.props.length - 1].purpose).toBe(ROOF_CACHE_KEY);
      const ha = layoutHolders(a, OFFICE).filter(h => h.areaType !== ROOF_CACHE_KEY), hb = layoutHolders(b, NO_REWARD);
      expect(ha).toEqual(hb);
      // loose finds (floor supplies, weapon finds + ammo) unchanged in count, mix, order and index; the roof find's pickups (task
      // gas-mask-roof-feedback-20261030) are appended LAST and are the only pickups on the roof
      const own = a.pickups.filter(p => p.reward === ROOF_FIND_KEY);
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(a.pickups.slice(0, a.pickups.length - own.length)).toEqual(b.pickups);
      expect(a.pickups.slice(a.pickups.length - own.length)).toEqual(own);
      expect(b.pickups.some(p => p.level === OFFICE_ROOF_LEVEL || p.reward)).toBe(false);
      expect(a.pickups.filter(p => p.level === OFFICE_ROOF_LEVEL)).toEqual(own);
      for (const p of b.pickups) expect(p.itemId in GEAR_ITEMS, p.itemId).toBe(false); // gear is the registry's one level roll (+ the roof find)
      expect(a.zombies.filter(z => z.level !== OFFICE_ROOF_LEVEL)).toEqual(b.zombies.filter(z => z.level !== OFFICE_ROOF_LEVEL));
      expect(a.office!.gearSpots).toEqual(b.office!.gearSpots);
    }
  });

  it('the Subway never has a roof reward and rolls exactly as before (the reward table is never consulted there)', () => {
    const subNo: LootProfile = {...PROFILES.subway, tables: {...BASE_TABLES, rewards: {}}};
    for (const s of ECONOMY_CORPUS.slice(0, 2)) {
      const l = generateStation(s.seed, {startWeapon: 'pistol'});
      expect(l.props.some(p => p.purpose === ROOF_CACHE_KEY)).toBe(false);
      expect(layoutHolders(l, PROFILES.subway)).toEqual(layoutHolders(l, subNo));
      expect(generateStation(s.seed, {startWeapon: 'pistol', loot: subNo}).pickups).toEqual(l.pickups);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Task gas-mask-roof-feedback-20261030 (item 10): the roof FIND.

describe('roof find data (items/lootTables.ts ROOF_FIND): one meaningful existing weapon (+ its own ammo) or gear piece', () => {
  it('rows are existing non-starter long guns and protective gear; a gun pairs the weapon-find box of its own caliber; valid in every profile', () => {
    expect(REWARD_FINDS[ROOF_FIND_KEY]).toBe(ROOF_FIND);
    expect(BASE_TABLES.rewardFinds?.[ROOF_FIND_KEY]).toBe(ROOF_FIND);
    expect(rewardFind(OFFICE, ROOF_FIND_KEY)).toBe(ROOF_FIND);
    expect(ROOF_FIND.pairedAmmo).toBe(true);
    const ids = ROOF_FIND.items.map(r => r[0]);
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) {
      expect(ITEMS[id], id).toBeDefined();
      const weapon = ITEMS[id].kind === 'weapon';
      expect(weapon || id in GEAR_ITEMS, `${id}: a weapon or gear`).toBe(true);
      if (weapon) {
        expect(findWeaponsFor('pistol'), `${id}: a non-starter weapon (the shipped pistol start)`).toContain(id);
        expect(WEAPON_FIND_AMMO[id][0]).toBe(ammoItemFor(WEAPONS[id].caliber!)); // its OWN caliber (the weapon-find convention)
      } else {
        expect(['backpack', 'gas_mask'], `${id}: no bag / mask (a roof stash of armour)`).not.toContain(id);
      }
    }
    // weapons are the main share (the user's "gear or weapon"; guns 2 in 3)
    const w = (pred: (id: string) => boolean) => ROOF_FIND.items.filter(r => pred(r[0])).reduce((s, r) => s + r[1], 0);
    expect(w(id => ITEMS[id].kind === 'weapon') / w(() => true)).toBeCloseTo(2 / 3, 6);
    for (const p of Object.values(PROFILES)) expect(validateLootProfile(p), p.id).toEqual([]);
    expect(validateLootProfile(NO_REWARD)).toEqual([]);
    const bad = (rf: RewardFind) => validateLootProfile({id: 'bad', label: 'bad', tables: {...BASE_TABLES, rewardFinds: {r: rf}}, overrides: {}}).join('\n');
    expect(bad({...ROOF_FIND, items: [['no_such_item', 1]]})).toMatch(/unknown item id no_such_item/);
    expect(bad({...ROOF_FIND, items: [['rifle', 0]]})).toMatch(/no item with weight > 0/);
    // item weight overrides reach it (identity when untouched)
    const noRifle: LootProfile = {id: 'x', label: 'x', tables: BASE_TABLES, overrides: {itemWeight: {rifle: 0}}};
    expect(rewardFind(noRifle, ROOF_FIND_KEY)!.items.map(r => r[0])).toEqual(['shotgun', 'armor_vest', 'helmet']);
  });

  it('the roll: deterministic per level seed, never the start weapon, the documented shares; a gun brings its own ammo box, gear none', () => {
    const N = 3000, seen: Record<string, number> = {};
    for (let s = 0; s < N; s++) {
      const a = rollRoofFind(s * 7919 + 1, ROOF_FIND, 'pistol')!;
      expect(rollRoofFind(s * 7919 + 1, ROOF_FIND, 'pistol')).toEqual(a);
      seen[a.itemId] = (seen[a.itemId] ?? 0) + 1;
      const pair = WEAPON_FIND_AMMO[a.itemId];
      expect(a.ammo).toEqual(pair ? {itemId: pair[0], count: pair[1]} : null);
      // the rifle-start fallback never gets a second rifle
      expect(rollRoofFind(s * 7919 + 1, ROOF_FIND, 'rifle')!.itemId).not.toBe('rifle');
    }
    const total = ROOF_FIND.items.reduce((t, r) => t + r[1], 0);
    for (const [id, w] of ROOF_FIND.items) expect(Math.abs(seen[id] / N - w / total), id).toBeLessThan(0.03);
    expect(rollRoofFind(1, {...ROOF_FIND, items: [['pistol', 1]]}, 'pistol')).toBe(null); // only the start weapon: nothing placeable
  });
});

describe('the roof find on the real Office Space level: guaranteed AFTER placement, beside the cache, reachable, finite', () => {
  // a bounded seed set (generation ~0.3 s each): the five above + 15 more
  const MANY = [...SEEDS, ...Array.from({length: 15}, (_, i) => 1000 + i * 7717)];

  it('every seed: exactly the recorded find on the deck (gun + its own box, or a gear piece), on verified, reachable spots beside the cache', () => {
    const items: Record<string, number> = {};
    let beside = 0;
    for (const seed of MANY) {
      const l = gen(seed), f = towerFrame(seed), R = l.levels[OFFICE_ROOF_LEVEL], g = R.grid;
      expect(officeIssues(l, f), `seed ${seed}`).toEqual([]);
      const F = l.office!.roof!.find!;
      expect(F, `seed ${seed}`).toBeTruthy();
      expect(F.key).toBe(ROOF_FIND_KEY);
      const own = l.pickups.filter(p => p.reward === ROOF_FIND_KEY);
      expect(own.map(p => [p.itemId, p.count]), `seed ${seed}`).toEqual([[F.itemId, 1], ...(F.ammo ? [[F.ammo.itemId, F.ammo.count]] : [])]);
      expect(F).toMatchObject(rollRoofFind(l.seed, ROOF_FIND, 'pistol')!); // the placed item IS the roll: nothing re-picked by placement
      items[F.itemId] = (items[F.itemId] ?? 0) + 1;
      expect(F.itemId).not.toBe(l.startWeapon);
      expect(ITEMS[F.itemId].kind === 'weapon' ? !!F.ammo : !F.ammo).toBe(true);
      // reachable from the start (stairs + the roof ladder) on a walkable deck cell inside the tower, its clear square on the deck
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = levelDistance(l.levels, sx, sy, 0, l.levelLinks);
      for (const p of own) {
        expect(p.level).toBe(OFFICE_ROOF_LEVEL);
        expect(p.y).toBeCloseTo(R.baseY, 3);
        const r = p === own[0] ? FIND_CLEAR : FIND_AMMO_CLEAR;
        for (const [ox, oz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
          const [cx, cy] = g.cellOf(p.x + ox, p.z + oz);
          expect(g.walkable(cx, cy), `seed ${seed}: ${p.itemId}`).toBe(true);
          expect(dist[OFFICE_ROOF_LEVEL][g.idx(cx, cy)], `seed ${seed}: ${p.itemId} reachable`).toBeGreaterThan(0);
          expect(cx - MARGIN).toBeGreaterThanOrEqual(0); expect(cy - MARGIN).toBeGreaterThanOrEqual(0);
          expect(cx - MARGIN).toBeLessThan(f.TW); expect(cy - MARGIN).toBeLessThan(f.TD);
        }
        // clear of every roof prop (+ plinth) and structure footprint, and of the hatch / ladder head
        for (const q of l.props) if (q.level === OFFICE_ROOF_LEVEL) expect(Math.abs(q.x - p.x) >= q.hx + 0.1 + r - 1e-6 || Math.abs(q.z - p.z) >= q.hz + 0.1 + r - 1e-6, `seed ${seed}: ${p.itemId} vs ${q.kind}`).toBe(true);
        const h = l.office!.roof!.ladder.hatch;
        expect(Math.hypot(p.x - (h.x0 + h.x1) / 2, p.z - (h.z0 + h.z1) / 2)).toBeGreaterThan(HATCH_CLEAR + 0.8);
      }
      if (F.ammo) {
        const gap = Math.hypot(F.ammo.x - F.x, F.ammo.z - F.z);
        expect(gap).toBeGreaterThanOrEqual(0.5 - 1e-3); expect(gap).toBeLessThanOrEqual(1.1 + 1e-3);
      }
      // beside the roof cache (it is opened right there): count how often it is within 1.6 m of the crate
      const c = l.office!.roof!.reward!;
      const dc = Math.hypot(F.x - c.x, F.z - c.z);
      expect(dc, `seed ${seed}: near the cache`).toBeLessThan(4.5);
      if (dc < 1.6) beside++;
      expect(roofRewardIssues(l, dist, f), `seed ${seed}`).toEqual([]);
    }
    console.info(`roof find over ${MANY.length} seeds: ${JSON.stringify(items)}; beside the cache (< 1.6 m) ${beside}/${MANY.length}`);
    expect(beside).toBeGreaterThanOrEqual(MANY.length * 0.8);
    // both kinds turn up across seeds (a gun in most)
    expect(Object.keys(items).some(id => ITEMS[id].kind === 'weapon')).toBe(true);
  });

  it('deterministic: the same level seed regenerates the same find at the same pickup indices (Retry / revisits never re-roll it); validation catches a missing / moved find', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const a = gen(seed), b = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'});
      const ia = a.pickups.flatMap((p, i) => (p.reward ? [i] : [])), ib = b.pickups.flatMap((p, i) => (p.reward ? [i] : []));
      expect(ib).toEqual(ia);
      expect(ia.map(i => b.pickups[i])).toEqual(ia.map(i => a.pickups[i]));
      expect(b.office!.roof!.find).toEqual(a.office!.roof!.find);
      // a broken layout fails validation (the generator would retry): the find's pickup gone / moved into the hatch zone
      const f = towerFrame(seed), gone = {...b, pickups: b.pickups.filter(p => !p.reward)};
      expect(roofRewardIssues(gone, undefined, f).join('\n')).toMatch(/roof find pickups/);
      const h = b.office!.roof!.ladder.hatch, moved = structuredClone(b.office!.roof!.find!);
      moved.x = (h.x0 + h.x1) / 2; moved.z = (h.z0 + h.z1) / 2;
      const bad = {...b, office: {...b.office!, roof: {...b.office!.roof!, find: moved}}, pickups: b.pickups.map(p => (p.reward && p.itemId === moved.itemId ? {...p, x: moved.x, z: moved.z} : p))};
      expect(roofRewardIssues(bad, undefined, f).length).toBeGreaterThan(0);
    }
    // a New Game (new seeds) rolls again: different level seeds do not all give the same item
    expect(new Set(SEEDS.map(s => gen(s).office!.roof!.find!.itemId)).size).toBeGreaterThan(1);
  });

  it('finite: taken once, the run memory (layout pickup indices) never offers it again on a rebuild / revisit; never duplicated', () => {
    const seed = SEEDS[0], l = gen(seed);
    const idx = l.pickups.flatMap((p, i) => (p.reward ? [i] : []));
    // the section memory after taking the find (every other layout pickup still lying where it was)
    const mem = createMemory({level: 'office', section: 'main'});
    mem.pickups = l.pickups.flatMap((p, i) => (idx.includes(i) ? [] : [{stack: {itemId: p.itemId, count: p.count}, pose: {x: p.x, y: p.y, z: p.z, yaw: 0}, anchor: [p.x, p.y, p.z], layoutIndex: i}])) as never;
    const again = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}); // a rebuild (Subway <-> Office travel / Retry of a later level)
    expect(takenLayoutPickups(again.pickups.length, structuredClone(mem))).toEqual(idx);
    const plan = pickupPlan(again.pickups.length, mem);
    expect(plan.fromLayout).toEqual([]); // nothing re-spawns from the layout: what is left comes from memory
    expect(plan.restored.some(r => idx.includes(r.layoutIndex!))).toBe(false);
    // one find per logical level: no other pickup of the level is a reward, and the gear roll / its placement are untouched
    expect(l.pickups.filter(p => p.reward).length).toBe(idx.length);
    const before = l.pickups.length;
    const gearA = placeSectionGear(l, rollLevelGear(seed, 'office', ['main']).main);
    l.pickups.length = before;
    const b = gen(seed, NO_REWARD), beforeB = b.pickups.length;
    const gearB = placeSectionGear(b, rollLevelGear(seed, 'office', ['main']).main);
    b.pickups.length = beforeB;
    expect(gearA).toEqual(gearB);
  });
});

/** XZ footprint of a placed lot (yaw-expanded), from items/lootLayout placementBox. */
function placementBoxOf(l: Lot): {x0: number; x1: number; z0: number; z1: number} {
  const b = placementBox(l.itemId, l);
  return {x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2]};
}
