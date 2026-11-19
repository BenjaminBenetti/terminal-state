// Task studio-surface-map-tent-cab-20261119-025201-01 (lane TENT; user: "No free gas mask in the tent. Its free starter survival supply
// should be some finite filters ONLY, not masks or other free gear. Reuse the existing filter quantity if suitable; no repeat-visit refill
// or loot duplication ... Do not delete an acquired/equipped/carried or player-moved mask or unrelated saved belongings. Safely correct
// unclaimed generated tent stock where attributable without changing UIDs or refilling; flag a genuine saved-stock attribution question
// rather than inventing a destructive migration"): world/surface/tentStock.ts + gen/surface/checkpoint.ts.
//  1. GENERATION over the three hosts, Surface Run versions 1 and 2 and several seeds: no mask in the tent, the ONE spare filter on the
//     supply table's top (layout.pickups[0], its old record exactly), the map table and its radio in place, exactly one in-tent crate whose
//     first realization (the game's own ContainerManager, the Game 'damage' step's order) keeps only its filter lots while the compound's
//     outdoor crates keep theirs — and the rest of the layout BYTE-identical to main 2f22ccd's once the old mask is put back
//     (helpers/tentLegacy.ts; tests/surface-v1-compat.test.ts and surface-connector-pins.test.ts pin the same for their 6 + 33 districts).
//  2. SAVED DISTRICTS: (a) the old generated mask still lying at its spot is not restored; a moved / dropped / other mask and every other
//     record stay exactly (no uid: the records carry none); (b) an untouched remembered in-tent crate drops its non-filter lots (ids kept),
//     an opened / searched one stays exact and is flagged.
//  3. NO REFILL: leave / return / save (the save codec) / load, a filter taken, never comes back; the rules are idempotent.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {generateSurfaceDistrict} from '../src/gen/surface/index';
import {tentGearSpot} from '../src/gen/surface/checkpoint';
import {SR_MAP_TABLE} from '../src/gen/surface/kinds';
import {GAS_FILTER_ID, GAS_MASK_ID} from '../src/gen/maskLoot';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceHost} from '../src/gen/surface/surfaceRun';
import {lootProfile} from '../src/items/lootTables';
import {Inventory} from '../src/items/inventory';
import {ContainerManager} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {createMemory, pickupPlan, type PickupRecord, type SectionMemory} from '../src/run/memory';
import {applyHolders, captureHolders, dropNaturalFood} from '../src/run/worldMemory';
import {decodeMemory, encodeMemory} from '../src/save/serialize';
import {
  TENT_STOCK, dropUnclaimedTentMask, isTentCrate, legacyTentMask, tentSupplyTable, trimTentCrateStock, untouchedHolder,
} from '../src/world/surface/tentStock';
import {ShimContext, installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {withLegacyTentMask} from './helpers/tentLegacy';

const bytes = (L: unknown) => JSON.stringify(L, (_k, v) => (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') : v));
const digest = (L: unknown) => createHash('sha256').update(bytes(L)).digest('hex').slice(0, 16);

/** Full-layout digests of these districts on main 2f22ccd (before the change: the free mask at layout.pickups[0]). */
const MAIN: Readonly<Record<string, string>> = {
  'subway:1:3': '011bbd6d9541374a', 'subway:1:10': 'e7b087aaea0f4131', 'subway:1:17': '19302aedbd2b33ae',
  'subway:2:3': 'ad328ed618270c63', 'subway:2:10': '956f3dbabb91fd24', 'subway:2:17': 'c5860d0fa8ed9876',
  'office:1:3': 'bf50b87c751a5312', 'office:1:10': '58a8794863cb9888', 'office:1:17': '06eb3c69e3e9e981',
  'office:2:3': '5ea75108340329f6', 'office:2:10': '30fc016d2a50e807', 'office:2:17': 'bef7b68f05e24423',
  'mall:1:3': '1788b9aa195a92c6', 'mall:1:10': '4209a437ea0e8398', 'mall:1:17': '6fc0e5a1e4f90d35',
  'mall:2:3': 'b5b619a7c1d55ce0', 'mall:2:10': 'fbfd2b0a4f8e8035', 'mall:2:17': '3852d973f73f0034',
};
const HOSTS: readonly SurfaceHost[] = ['subway', 'office', 'mall'];
const CASES = HOSTS.flatMap(host => [1, 2].flatMap(v => [3, 10, 17].map(seed => ({host, v, seed, key: `${host}:${v}:${seed}`}))));

const memo = new Map<string, StationLayout>();
const district = (host: SurfaceHost, v: number, seed: number): StationLayout => {
  const k = `${host}:${v}:${seed}`;
  let L = memo.get(k);
  if (!L) memo.set(k, (L = generateSurfaceDistrict(host, {levelSeed: seed, surfaceVersion: v})));
  return L;
};
const inTentRect = (L: StationLayout, x: number, z: number) => { const r = L.surface!.checkpoint.tent.rect; return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; };

let restoreShim: () => void, mats: WorldMaterials;
beforeAll(() => {
  restoreShim = installCanvasShim(false);
  (ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {}; // (the pickups' label atlas clips its cells)
  mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
});
afterAll(() => restoreShim());

/**
 * The district's military crates as the game's ContainerManager rolls them (the crate is an authored openable: no model; a district
 * reduced to its crates keeps their per-kind indices, areas and seed, so their lots are the full district's), then Game.buildSectionSteps'
 * 'damage' order: applyHolders, dropNaturalFood, trimTentCrateStock (`trim` false = main's rules, before this task).
 */
function buildCrates(L: StationLayout, host: SurfaceHost, mem: SectionMemory, trim = true): {cm: ContainerManager; tent: ContainerManager['all'][number]; outdoor: ContainerManager['all']} {
  const cm = new ContainerManager({}, mats, () => new Inventory());
  cm.build({...L, props: L.props.filter(p => p.kind === 'srMilitaryCrate')}, {}, lootProfile(host));
  applyHolders(cm, mem.holders);
  dropNaturalFood(cm, mem.holders, L.seed, mem.id, lootProfile(host));
  if (trim) trimTentCrateStock(L, cm.all, mem.holders);
  const tent = cm.all.filter(h => isTentCrate(L, h));
  expect(tent.length, 'exactly one in-tent crate').toBe(1);
  return {cm, tent: tent[0], outdoor: cm.all.filter(h => !isTentCrate(L, h))};
}
const lotsOf = (h: ContainerManager['all'][number]) => h.state.lots.map(l => ({id: l.id, itemId: l.itemId, count: l.count}));
const memOf = (host: SurfaceHost) => createMemory({level: host, section: 'surface', station: 'st-tent'});

describe('generation: the tent gives the one spare filter, never a mask; nothing else of the district moves', () => {
  let removed = 0, withOther = 0;
  for (const c of CASES) {
    it(`${c.key}`, () => {
      const L = district(c.host, c.v, c.seed), s = L.surface!;
      // no mask anywhere in the tent; exactly the spare filter, first in layout.pickups, its old record (spot, count, yaw, no charge)
      expect(L.pickups.filter(p => p.itemId === GAS_MASK_ID && inTentRect(L, p.x, p.z))).toEqual([]);
      const inTent = L.pickups.filter(p => (p.level ?? 0) === 0 && inTentRect(L, p.x, p.z));
      expect(inTent).toEqual([L.pickups[0]]);
      const si = tentSupplyTable(L);
      expect(si).toBeGreaterThanOrEqual(0);
      const sp = L.props[si];
      expect(sp.kind).toBe('srMapTable');
      expect(L.pickups[0]).toEqual({itemId: GAS_FILTER_ID, count: 1, ...tentGearSpot(sp, 'filter'), area: sp.area, yaw: sp.rot});
      expect(L.pickups[0].y).toBeCloseTo(sp.y + SR_MAP_TABLE.top.y, 3);
      // the functional tent: the planning-map table (its reader pose) with the field radio on it, the supply table beside it
      const mt = L.props[s.checkpoint.mapTable.prop];
      expect(mt.kind).toBe('srMapTable');
      expect(mt.area).toBe(s.checkpoint.tent.area);
      expect(L.props.filter(p => p.kind === 'srFieldRadio' && p.host === s.checkpoint.mapTable.prop).length).toBe(1);
      // the rest of the layout: byte-identical to main's once the old mask is back (the mask's charge was its own fork's only draw)
      const back = withLegacyTentMask(L);
      expect(back.pickups.length).toBe(L.pickups.length + 1);
      expect(digest(back), 'main 2f22ccd bytes with the old mask put back').toBe(MAIN[c.key]);
      // the in-tent crate's first realization: only its filter lots (ids kept); the compound's outdoor crates exactly as rolled
      const mem = memOf(c.host);
      const before = buildCrates(L, c.host, mem, false), after = buildCrates(L, c.host, mem);
      expect(lotsOf(after.tent)).toEqual(lotsOf(before.tent).filter(l => l.itemId === GAS_FILTER_ID));
      expect(after.outdoor.map(lotsOf)).toEqual(before.outdoor.map(lotsOf));
      removed += before.tent.state.lots.length - after.tent.state.lots.length;
      if (before.tent.state.lots.some(l => l.itemId !== GAS_FILTER_ID)) withOther++;
    }, 60000);
  }
  it('the rule bites: in-tent crates of these districts rolled non-filter supplies, all removed', () => {
    expect(withOther).toBeGreaterThan(0);
    expect(removed).toBeGreaterThan(0);
  });
});

/** A record of a generated layout pickup lying untouched where it spawned (what main's capture wrote for it). */
const untouchedRecord = (L: StationLayout, i: number, p = L.pickups[i]): PickupRecord => ({
  stack: {itemId: p.itemId, count: p.count, ...(p.filter !== undefined ? {filter: p.filter} : {})},
  pose: {p: [p.x, p.y, p.z], q: [0, Math.sin((p.yaw ?? 0) / 2), 0, Math.cos((p.yaw ?? 0) / 2)]},
  anchor: [p.x, p.y, p.z], layoutIndex: i,
});

describe('a saved district: the old unclaimed tent mask is not restored; every other record stays exactly', () => {
  const L = district('office', 2, 10);
  /** main's district: [mask, filter, ...interiors]; its memory after a visit that left everything where it lay. */
  const legacy = withLegacyTentMask(L);
  const saved = (): SectionMemory => ({...memOf('office'), visits: 1, pickups: legacy.pickups.map((_, i) => untouchedRecord(legacy, i))});

  it('the record of the old mask at its spot is dropped (removal only); its fitted charge recorded; idempotent', () => {
    const mem = saved(), others = structuredClone(mem.pickups!.slice(1));
    const r = dropUnclaimedTentMask(L, mem);
    expect(r).toMatchObject({dropped: 1, keptMoved: 0, keptDropped: 0, keptOther: 0, unattributed: 0});
    expect(r.charges).toEqual([legacyTentMask(L)!.filter]);
    expect(mem.pickups).toEqual(others); // nothing else touched, nothing added, the old indices kept as they were recorded
    expect(dropUnclaimedTentMask(L, mem).dropped, 'idempotent').toBe(0);
    expect(pickupPlan(L.pickups.length, mem).restored.some(p => p.stack.itemId === GAS_MASK_ID)).toBe(false);
  });

  it('within its spot it is still the unclaimed mask (a nudge, a settled body centre, the save codec\'s rounding); off it, it stays', () => {
    const spot = tentGearSpot(L.props[tentSupplyTable(L)], 'mask');
    const at = (dx: number, dy: number, dz: number) => { const mem = saved(); mem.pickups![0].anchor = [spot.x + dx, spot.y + dy, spot.z + dz]; return dropUnclaimedTentMask(L, mem); };
    expect(at(0.05, 0, 0).dropped).toBe(1);
    expect(at(0, 0.08, -0.06).dropped).toBe(1);
    expect(at(0, TENT_STOCK.above - 0.01, 0).dropped).toBe(1);
    expect(at(TENT_STOCK.spotR + 0.05, 0, 0)).toMatchObject({dropped: 0, keptMoved: 1}); // moved by the player: kept
    expect(at(0.9, 0, 0)).toMatchObject({dropped: 0, keptMoved: 1}); // over to the filter's spot
    expect(at(0, -0.95, 0)).toMatchObject({dropped: 0, keptMoved: 1}); // knocked to the tent floor
    expect(at(0, TENT_STOCK.above + 0.05, 0)).toMatchObject({dropped: 0, keptMoved: 1});
  });

  it('a mask the player took, dropped back at the spot, or found elsewhere stays exactly; so does a spilled lot', () => {
    // taken (carried / worn): main's capture had no record of it any more — nothing to drop, the inventory is never read
    const taken = saved(); taken.pickups = taken.pickups!.slice(1);
    const copy = structuredClone(taken.pickups);
    expect(dropUnclaimedTentMask(L, taken)).toMatchObject({dropped: 0, keptMoved: 0, keptDropped: 0});
    expect(taken.pickups).toEqual(copy);
    // dropped by the player right on the spot: no layoutIndex (the player's own item)
    const dropped = saved(); delete dropped.pickups![0].layoutIndex;
    expect(dropUnclaimedTentMask(L, dropped)).toMatchObject({dropped: 0, keptDropped: 1});
    expect(dropped.pickups!.length).toBe(legacy.pickups.length);
    // a generated mask of another index lying there, a lot that left a holder (fromLot) at the spot, two masks stacked: kept
    const other = saved(); other.pickups![0].layoutIndex = 5;
    expect(dropUnclaimedTentMask(L, other)).toMatchObject({dropped: 0, keptOther: 1});
    const lot = saved(); lot.pickups![0].fromLot = {holder: 3, lot: 3001};
    expect(dropUnclaimedTentMask(L, lot).dropped).toBe(0);
    const two = saved(); two.pickups![0].stack.count = 2;
    expect(dropUnclaimedTentMask(L, two).dropped).toBe(0);
  });

  it('only Surface districts: a host station / a district without a supply table / a first visit are untouched', () => {
    const host = {...legacy, surface: undefined} as StationLayout;
    const mem = saved();
    expect(dropUnclaimedTentMask(host, mem).dropped).toBe(0);
    expect(mem.pickups!.length).toBe(legacy.pickups.length);
    const bare = {...L, props: L.props.filter((_, i) => i !== tentSupplyTable(L))} as StationLayout;
    expect(tentSupplyTable(bare)).toBe(-1);
    expect(dropUnclaimedTentMask(bare, saved())).toMatchObject({dropped: 0, unattributed: 1});
    const first = memOf('office');
    expect(dropUnclaimedTentMask(L, first).dropped).toBe(0);
    expect(first.pickups).toBeNull();
    expect(pickupPlan(L.pickups.length, first).fromLayout.map(i => L.pickups[i].itemId)).not.toContain(GAS_MASK_ID);
  });

  it('through the save codec (anchors rounded to 0.1 mm) the same record is recognised, the rest decodes exactly', () => {
    const mem = decodeMemory('st-tent:surface', structuredClone(encodeMemory(saved())));
    expect(dropUnclaimedTentMask(L, mem).dropped).toBe(1);
    expect(mem.pickups!.length).toBe(legacy.pickups.length - 1);
    expect(mem.pickups!.map(p => p.layoutIndex)).toEqual(legacy.pickups.slice(1).map((_, i) => i + 1));
  });
});

describe('a saved district: the in-tent crate (removal only, ids kept; opened / searched = exact, flagged)', () => {
  /** The first of the cases whose in-tent crate held non-filter lots under main's rules. */
  const pick = () => {
    for (const c of CASES) {
      const L = district(c.host, c.v, c.seed);
      const b = buildCrates(L, c.host, memOf(c.host), false);
      if (b.tent.state.lots.some(l => l.itemId !== GAS_FILTER_ID)) return {c, L};
    }
    throw new Error('no in-tent crate with non-filter lots');
  };

  it('main\'s untouched record: the non-filter lots go, the filter lots stay (same ids); the next capture is exact from then on', () => {
    const {c, L} = pick();
    // main's first visit and leave: the crate as main realized it, never opened
    const mem = memOf(c.host);
    const old = buildCrates(L, c.host, mem, false);
    mem.holders = captureHolders(old.cm);
    const oldTent = lotsOf(old.tent), oldOutdoor = old.outdoor.map(lotsOf);
    expect(untouchedHolder(Object.values(mem.holders)[0])).toBe(true);
    // this build (new rules) over that saved record
    const b = buildCrates(L, c.host, mem);
    expect(lotsOf(b.tent)).toEqual(oldTent.filter(l => l.itemId === GAS_FILTER_ID));
    expect(b.outdoor.map(lotsOf), 'the compound\'s crates exactly as saved').toEqual(oldOutdoor);
    // leave (capture) -> save -> load -> return: exactly that, nothing added back
    mem.holders = captureHolders(b.cm);
    const loaded = decodeMemory(mem.id, structuredClone(encodeMemory(mem)));
    const back = buildCrates(L, c.host, loaded);
    expect(lotsOf(back.tent)).toEqual(lotsOf(b.tent));
    expect(back.outdoor.map(lotsOf)).toEqual(oldOutdoor);
  });

  it('a crate the player opened / searched / saw into stays exactly as remembered and is flagged; one opened and emptied stays empty', () => {
    const {c, L} = pick();
    const mem = memOf(c.host);
    const first = buildCrates(L, c.host, mem, false);
    const opened = first.tent;
    opened.state.parts![0] = true; opened.state.seen![0] = true; opened.state.searched = true; opened.state.open = true; // (as ContainerManager.interactPart opens it)
    mem.holders = captureHolders(first.cm);
    const rec = Object.values(mem.holders).find(r => r.seen?.[0])!;
    expect(untouchedHolder(rec)).toBe(false);
    const b = buildCrates(L, c.host, mem);
    expect(lotsOf(b.tent), 'exact: the non-filter lots stay').toEqual(lotsOf(first.tent));
    const r = trimTentCrateStock(L, b.cm.all, mem.holders);
    expect(r).toMatchObject({flagged: 1, corrected: 0, fresh: 0, removed: 0});
    expect(r.flaggedKeys.length).toBe(1);
    // the player takes everything: it never refills (leave / return / save / load)
    b.tent.state.lots = [];
    mem.holders = captureHolders(b.cm);
    const loaded = decodeMemory(mem.id, structuredClone(encodeMemory(mem)));
    expect(buildCrates(L, c.host, loaded).tent.state.lots).toEqual([]);
  });

  it('the new rules from a first visit on: filter-only, a filter taken never comes back (leave / return / save / load)', () => {
    for (const c of CASES) {
      const L = district(c.host, c.v, c.seed), mem = memOf(c.host);
      const b = buildCrates(L, c.host, mem);
      const filters = lotsOf(b.tent);
      expect(filters.every(l => l.itemId === GAS_FILTER_ID)).toBe(true);
      if (!filters.length) continue;
      // the player opens the lid and takes one filter lot
      b.tent.state.parts![0] = true; b.tent.state.seen![0] = true; b.tent.state.searched = true; b.tent.state.open = true;
      b.tent.state.lots = b.tent.state.lots.slice(1);
      mem.holders = captureHolders(b.cm);
      for (let k = 0; k < 2; k++) {
        const loaded = decodeMemory(mem.id, structuredClone(encodeMemory(mem)));
        const again = buildCrates(L, c.host, loaded);
        expect(lotsOf(again.tent), `${c.key} visit ${k + 2}`).toEqual(filters.slice(1));
        mem.holders = captureHolders(again.cm);
      }
      return;
    }
    throw new Error('no in-tent crate rolled a filter');
  });
});

describe('the supply table\'s filter: finite, never duplicated or refilled', () => {
  it('first visit spawns it once; taken, it is gone for good; left lying, it comes back once (leave / return / save / load)', () => {
    const L = district('mall', 2, 3);
    const mem = memOf('mall');
    const first = pickupPlan(L.pickups.length, mem);
    expect(first.fromLayout.filter(i => L.pickups[i].itemId === GAS_FILTER_ID && inTentRect(L, L.pickups[i].x, L.pickups[i].z))).toEqual([0]);
    // left lying: exactly one record, restored once on every return
    mem.pickups = L.pickups.map((_, i) => untouchedRecord(L, i));
    for (let k = 0; k < 3; k++) {
      const m = decodeMemory(mem.id, structuredClone(encodeMemory(mem)));
      dropUnclaimedTentMask(L, m);
      const plan = pickupPlan(L.pickups.length, m);
      expect(plan.fromLayout).toEqual([]);
      expect(plan.restored.filter(p => p.layoutIndex === 0)).toHaveLength(1);
      expect(plan.restored.length).toBe(L.pickups.length);
    }
    // taken: the capture no longer has it — it never returns
    mem.pickups = mem.pickups.slice(1);
    const m = decodeMemory(mem.id, structuredClone(encodeMemory(mem)));
    dropUnclaimedTentMask(L, m);
    expect(pickupPlan(L.pickups.length, m).restored.some(p => p.layoutIndex === 0)).toBe(false);
  });
});
