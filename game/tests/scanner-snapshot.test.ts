// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "About every 30 active seconds a sweep refreshes snapshot blips
// … No floorplan/map or continuous live tracking; it should give broad awareness rather than precise navigation.") and task
// studio-scanner-console-refinements-20261114-031614-01 (user: "cycle through exactly this order: All → Food/Water → Ammo → Fuel → Weapon
// → Equipment → Material → All. ALL means all RESOURCES ONLY: remove enemies from this display … Use common item/resource traits so new
// weapons and gear integrate naturally, not another brittle per-kind whitelist … Filter the captured resource snapshot when changing
// mode rather than inventing live tracking or an extra scan."): the scanner's PURE rules (craft/scanner.ts) —
//  - the modes, in the user's order, and what an item is: its catalogue TRAITS (checked over the WHOLE catalogue at run time, so a new
//    item joins by its traits), medical / batteries / flares / grenades / parts in ALL only, an unknown id nothing;
//  - a snapshot of RESOURCES only (no enemy is read): loose pickups (never a stall's ware, never the train's cargo), holders that still
//    hold lots, grounded bags and what is in them, a station's fuel cart with fuel; cut at 100 m from the car's centre; storeys flattened;
//  - a mode is a FILTER of that one snapshot (scanBlips): nothing read, nothing swept; per-mode counts, a bounded count per mode;
//  - coarse: 4 m cells in the TRAIN's frame (the car's front is +x for both ways the car can stand); deterministic in any order;
//  - the sweep clock: 4 active seconds to a world's first sweep, then 30; a long frame queues none.
// Node only: plain objects, and one real generated station with its real train placement.

import {describe, expect, it} from 'vitest';
import {
  SCANNER, SCAN_CATEGORIES, SCAN_DEFAULT_MODE, SCAN_MODES, SCAN_MODE_LABEL, SweepClock, blipBrightness, blipScale, hasMode, isScanMode, itemModes,
  nextScanMode, scanBlips, scanCategory, secondsLeft, stackModes, sweepAngle, takeSnapshot, toScanFrame,
  type ScanBag, type ScanCart, type ScanFrame, type ScanHolder, type ScanMode, type ScanPickup, type ScanSnapshot, type ScanSources,
} from '../src/craft/scanner';
import * as scannerModule from '../src/craft/scanner';
import {ITEMS, isFoodOrDrink, type ItemDef} from '../src/items/items';
import {GEAR_IDS} from '../src/items/gear';
import {MATERIAL_IDS} from '../src/items/craftMaterials';
import {WEAPONS} from '../src/weapons/weapons';
import {FUEL} from '../src/fuel/fuel';
import {playerTrainPlacement, worldToTrain} from '../src/gen/playerTrain';
import {isLootHolderKind} from '../src/items/loot';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {readFileSync} from 'node:fs';

const HERE: ScanFrame = {x: 0, z: 0, front: 1};
const pickup = (itemId: string, x: number, z: number, owner?: string): ScanPickup & {y: number} => ({stack: {itemId}, x, y: 0, z, ...(owner ? {owner} : {})});
const holder = (x: number, z: number, lots: string[], y = 0): ScanHolder => ({prop: {x, y, z}, state: {lots: lots.map(itemId => ({itemId}))}});
const bag = (x: number, z: number, grounded = true, contents?: string[]): ScanBag =>
  ({pose: {x, z}, grounded, ...(contents ? {stack: {itemId: 'backpack', bag: contents.map(itemId => ({itemId}))}} : {})});
const cart = (x: number, z: number, units: number, owner = 'station'): ScanCart => ({x, z, units, owner});
/** The cell centre a position is quantised to. */
const cellOf = (v: number) => (Math.floor(v / SCANNER.cell) + 0.5) * SCANNER.cell;
/** A mode's dots of a snapshot. */
const dots = (s: ScanSnapshot, m: ScanMode) => scanBlips(s, m).blips;
/** Counts per mode, all seven (zeros included). */
const counts = (o: Partial<Record<ScanMode, number>>) => Object.fromEntries(SCAN_MODES.map(m => [m, o[m] ?? 0]));

describe('the scanner numbers (one place)', () => {
  it('about 100 m, a sweep every 30 active seconds, coarse 4 m cells, a bounded draw; X cycles the mode', () => {
    expect([SCANNER.range, SCANNER.period, SCANNER.warmup, SCANNER.cell]).toEqual([100, 30, 4, 4]);
    expect(SCANNER.rings).toEqual([25, 50, 75, 100]);
    expect(SCANNER.rings[SCANNER.rings.length - 1]).toBe(SCANNER.range);
    expect(SCANNER.maxBlips).toBeGreaterThanOrEqual(160);
    expect(SCANNER.maxBlips).toBeLessThanOrEqual(400);
    expect(SCANNER.dim).toBeCloseTo(0.4);
    expect(SCANNER.closeDist).toBeCloseTo(2.6);
    expect(SCANNER.canvas).toEqual({frac: 0.8, max: 720, min: 240, dpr: 2});
    expect(SCANNER.modeKey).toBe('KeyX');
  });
});

describe('the modes: exactly the user\'s cycle', () => {
  it('All → Food/Water → Ammo → Fuel → Weapon → Equipment → Material → All; ALL is the default', () => {
    expect(SCAN_MODES.map(m => SCAN_MODE_LABEL[m])).toEqual(['All', 'Food/Water', 'Ammo', 'Fuel', 'Weapon', 'Equipment', 'Material']);
    expect(SCAN_DEFAULT_MODE).toBe('all');
    const seen: ScanMode[] = [];
    let m: ScanMode = 'all';
    for (let i = 0; i < SCAN_MODES.length; i++) { seen.push(m); m = nextScanMode(m); }
    expect(seen).toEqual([...SCAN_MODES]);
    expect(m).toBe('all'); // round to ALL again
    expect(SCAN_CATEGORIES).toEqual(SCAN_MODES.slice(1));
    // an unknown mode starts the cycle over
    expect(nextScanMode('enemy' as ScanMode)).toBe('all');
    for (const v of [...SCAN_MODES]) expect(isScanMode(v)).toBe(true);
    for (const v of ['', 'enemy', 'gear', 'item', 'ALL', 'toString', null, 3]) expect(isScanMode(v)).toBe(false);
  });

  it('no enemy and no red / gold class is left in the scanner\'s rules', () => {
    const exported = Object.keys(scannerModule);
    for (const gone of ['SCAN_CLASSES', 'classifyItem', 'classifyItems']) expect(exported).not.toContain(gone);
    const src = readFileSync(new URL('../src/craft/scanner.ts', import.meta.url), 'utf8').split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    expect(src).not.toMatch(/enem|zombie|brain/i);
  });
});

describe('what an item is to the scanner: its traits', () => {
  /** The rule restated from the item's traits (the catalogue's own fields, never ids). */
  const byTraits = (d: ItemDef): string =>
    d.kind === 'weapon' || d.weaponId ? 'weapon' : d.kind === 'ammo' || d.caliber ? 'ammo' : d.id === FUEL.canItem ? 'fuel'
      : d.kind === 'gear' || d.gear ? 'equipment' : d.kind === 'material' ? 'material' : isFoodOrDrink(d) ? 'food' : '-';

  it('EVERY catalogue item (whatever is in it at run time) is in ALL and in the mode its traits say, and in no other', () => {
    const per = new Map<string, string[]>();
    for (const def of Object.values(ITEMS)) {
      const c = scanCategory(def) ?? '-';
      expect([def.id, c]).toEqual([def.id, byTraits(def)]);
      const m = itemModes(def.id);
      expect([def.id, hasMode(m, 'all')]).toEqual([def.id, true]);
      for (const k of SCAN_CATEGORIES) expect([def.id, k, hasMode(m, k)]).toEqual([def.id, k, k === c]);
      (per.get(c) ?? per.set(c, []).get(c)!).push(def.id);
    }
    // every mode has something in today's catalogue
    for (const k of SCAN_CATEGORIES) expect(per.get(k)?.length ?? 0, k).toBeGreaterThan(0);
    // every weapon (guns AND melee) is a Weapon; every gear piece Equipment; every material Material; every food / drink Food/Water
    const melee = Object.values(ITEMS).filter(d => d.kind === 'weapon' && WEAPONS[d.weaponId!]?.melee).map(d => d.id);
    expect(melee.length).toBeGreaterThan(1);
    for (const d of Object.values(ITEMS).filter(q => q.kind === 'weapon')) expect([d.id, scanCategory(d)]).toEqual([d.id, 'weapon']);
    for (const id of melee) expect(scanCategory(ITEMS[id])).toBe('weapon');
    expect(GEAR_IDS.length).toBeGreaterThan(3);
    for (const id of GEAR_IDS) expect([id, scanCategory(ITEMS[id])]).toEqual([id, 'equipment']);
    for (const id of MATERIAL_IDS) expect([id, scanCategory(ITEMS[id])]).toEqual([id, 'material']);
    for (const d of Object.values(ITEMS).filter(isFoodOrDrink)) expect([d.id, scanCategory(d)]).toEqual([d.id, 'food']);
    for (const d of Object.values(ITEMS).filter(q => q.kind === 'ammo')) expect([d.id, scanCategory(d)]).toEqual([d.id, 'ammo']);
    expect(per.get('fuel')).toEqual([FUEL.canItem]);
  });

  it('a NEW item joins by its traits, with no list to update: a new gun, round, armour piece, salvage, ration', () => {
    const def = (o: Partial<ItemDef>) => ({id: 'brand_new', name: 'New', kind: 'consumable', ...o}) as ItemDef;
    expect(scanCategory(def({kind: 'weapon', weaponId: 'brand_new'}))).toBe('weapon');
    expect(scanCategory(def({kind: 'ammo', caliber: '7.62x39mm' as ItemDef['caliber']}))).toBe('ammo'); // (a caliber the catalogue does not have yet)
    expect(scanCategory(def({kind: 'gear', gear: ITEMS.helmet.gear}))).toBe('equipment');
    expect(scanCategory(def({kind: 'material'}))).toBe('material');
    expect(scanCategory(def({verb: 'eat'}))).toBe('food');
    expect(scanCategory(def({verb: 'drink'}))).toBe('food');
    expect(scanCategory(def({verb: 'apply'}))).toBeNull(); // a new dressing: ALL only
    expect(scanCategory(def({kind: 'throwable'}))).toBeNull();
  });

  it('medical supplies, batteries, flares, grenades, filters, parts and currency are resources in ALL only', () => {
    for (const id of ['medkit', 'bandage', 'leg_splint', 'arm_sling', 'trauma_kit', 'battery', 'flare', 'acid_grenade', 'lure_grenade', 'gas_filter',
      'reactor_key', 'fuse_cartridge', 'rail_ties']) {
      if (!ITEMS[id]) continue; // (a catalogue without it: nothing to check)
      expect([id, scanCategory(ITEMS[id]), itemModes(id)]).toEqual([id, null, 1]);
    }
  });

  it('an id the catalogue does not know is nothing (never a dot): not even an Object.prototype name', () => {
    for (const id of ['', 'nope', 'RIFLE', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) expect([id, itemModes(id)]).toEqual([id, 0]);
    expect(itemModes(undefined as unknown as string)).toBe(0);
    expect(stackModes(null)).toBe(0);
  });

  it('a backpack is Equipment and also whatever is in it', () => {
    const m = stackModes({itemId: 'backpack', bag: [{itemId: 'beans'}, null, {itemId: 'ammo_9mm'}, {itemId: 'nope'}]});
    expect(SCAN_MODES.filter(k => hasMode(m, k))).toEqual(['all', 'food', 'ammo', 'equipment']);
  });
});

describe('a snapshot: resources only', () => {
  it('loose pickups by mode; a market stall\'s ware and the train\'s own cargo are never dots; an unknown id is ignored', () => {
    const cargo = pickup('rifle', 1, 1), ware = pickup('medkit', 30, 30, 'stall-3');
    const src: ScanSources = {
      pickups: [pickup('beans', 20, 0), pickup('ammo_9mm', -20, 0), pickup('knife', 0, 40), pickup('gas_mask', 0, -40), pickup('mystery_item', 8, 8),
        pickup('scrap_metal', 60, 0), pickup('fuel_can', -60, 0), pickup('medkit', 0, 60), ware, cargo],
      cargoPickup: p => p === cargo,
    };
    const s = takeSnapshot(src, HERE);
    expect(s.seen).toEqual(counts({all: 7, food: 1, ammo: 1, fuel: 1, weapon: 1, equipment: 1, material: 1}));
    expect(dots(s, 'food')).toEqual([{x: cellOf(20), z: cellOf(0), n: 1}]);
    expect(dots(s, 'ammo')).toEqual([{x: cellOf(-20), z: cellOf(0), n: 1}]);
    expect(dots(s, 'weapon')).toEqual([{x: cellOf(0), z: cellOf(40), n: 1}]);
    expect(dots(s, 'equipment')).toEqual([{x: cellOf(0), z: cellOf(-40), n: 1}]);
    expect(dots(s, 'material')).toEqual([{x: cellOf(60), z: cellOf(0), n: 1}]);
    expect(dots(s, 'fuel')).toEqual([{x: cellOf(-60), z: cellOf(0), n: 1}]);
    expect(dots(s, 'all')).toHaveLength(7); // the medkit is in ALL only
    // without the cargo rule the rifle in the car WOULD be a dot (the exclusion is the rule, not a missing source)
    expect(takeSnapshot({...src, cargoPickup: undefined}, HERE).seen.weapon).toBe(2);
    // a ware stays excluded whoever asks
    expect(takeSnapshot({pickups: [ware]}, HERE).seen).toEqual(counts({}));
  });

  it('no enemy is ever read: a source list of enemies is ignored, the result has no enemy part', () => {
    const living = [{brain: {alive: true, x: 10, z: 2}, ragdolled: false}];
    const s = takeSnapshot({enemies: living, zombies: living, pickups: [pickup('beans', 10, 2)]} as unknown as ScanSources, HERE);
    expect(Object.keys(s).sort()).toEqual(['cells', 'seen']);
    expect(Object.keys(s.seen)).toEqual([...SCAN_MODES]);
    expect(s.seen.all).toBe(1);
    expect(takeSnapshot({enemies: living} as unknown as ScanSources, HERE)).toEqual({cells: [], seen: counts({})});
  });

  it('holders: one thing per holder that still holds lots — counted once in ALL and once in each mode among its lots', () => {
    const s = takeSnapshot({holders: [holder(12, 0, []), holder(24, 0, ['beans', 'water', 'ammo_556']), holder(48, 0, ['beans', 'pistol']), holder(60, 0, ['backpack']), holder(72, 0, ['not_an_item'])]}, HERE);
    expect(s.seen).toEqual(counts({all: 3, food: 2, ammo: 1, weapon: 1, equipment: 1}));
    expect(dots(s, 'food')).toEqual([{x: cellOf(24), z: cellOf(0), n: 1}, {x: cellOf(48), z: cellOf(0), n: 1}]);
    expect(dots(s, 'ammo')).toEqual([{x: cellOf(24), z: cellOf(0), n: 1}]);
    expect(dots(s, 'weapon')).toEqual([{x: cellOf(48), z: cellOf(0), n: 1}]);
    expect(dots(s, 'equipment')).toEqual([{x: cellOf(60), z: cellOf(0), n: 1}]);
    expect(dots(s, 'material')).toEqual([]);
    // emptied before the sweep -> gone from the next snapshot
    const h = holder(24, 0, ['beans']);
    expect(dots(takeSnapshot({holders: [h]}, HERE), 'all')).toHaveLength(1);
    (h.state.lots as {itemId: string}[]).length = 0;
    expect(dots(takeSnapshot({holders: [h]}, HERE), 'all')).toHaveLength(0);
    // a holder standing in the parked car is the train's cargo
    expect(takeSnapshot({holders: [h, holder(2, 0, ['beans'])], cargoHolder: c => c.prop.x === 2}, HERE).seen.all).toBe(0);
  });

  it('grounded backpacks are Equipment and what is in them; one worn / carried away is not there; one in the car is cargo', () => {
    const inCar = bag(1, 0);
    const s = takeSnapshot({bags: [bag(16, 16), bag(40, 0, false), inCar, bag(-16, 16, true, ['water', 'ammo_12ga'])], cargoBag: b => b === inCar}, HERE);
    expect(dots(s, 'equipment')).toEqual([{x: cellOf(-16), z: cellOf(16), n: 1}, {x: cellOf(16), z: cellOf(16), n: 1}]); // (the nearer cell first)
    expect(dots(s, 'food')).toEqual([{x: cellOf(-16), z: cellOf(16), n: 1}]);
    expect(dots(s, 'ammo')).toEqual([{x: cellOf(-16), z: cellOf(16), n: 1}]);
    expect(s.seen).toEqual(counts({all: 2, equipment: 2, food: 1, ammo: 1}));
  });

  it('fuel carts: a station\'s cart with fuel in it is Fuel; an empty one and the train\'s own never are', () => {
    const s = takeSnapshot({carts: [cart(30, 0, 4), cart(-30, 0, 0), cart(0, 2, 8, 'train'), cart(0, 30, 0.5)]}, HERE);
    expect(dots(s, 'fuel')).toEqual([{x: cellOf(0), z: cellOf(30), n: 1}, {x: cellOf(30), z: cellOf(0), n: 1}]); // (equally near: the cell index)
    expect(s.seen).toEqual(counts({all: 2, fuel: 2}));
  });

  it('the range is 100 m, horizontal, from the car\'s centre', () => {
    const at = (d: number, a: number) => pickup('beans', Math.cos(a) * d, Math.sin(a) * d);
    for (const a of [0, 1, 2.5, 4, 5.5]) {
      expect(takeSnapshot({pickups: [at(99.9, a)]}, HERE).seen.all).toBe(1);
      expect(takeSnapshot({pickups: [at(100.1, a)]}, HERE).seen.all).toBe(0);
    }
    expect(takeSnapshot({pickups: [pickup('beans', 0, -100)], holders: [holder(-100, 0, ['knife'])], bags: [bag(0, 100)], carts: [cart(100, 0, 1)]}, HERE).seen)
      .toEqual(counts({all: 4, food: 1, weapon: 1, equipment: 1, fuel: 1}));
    expect(takeSnapshot({pickups: [pickup('beans', 0, -100.01)], holders: [holder(-100.01, 0, ['knife'])], bags: [bag(71, 71)], carts: [cart(100.01, 0, 1)]}, HERE).seen).toEqual(counts({}));
    // measured from the CAR, wherever it stands
    const f: ScanFrame = {x: 500, z: -300, front: -1};
    expect(takeSnapshot({pickups: [pickup('beans', 500 - 99, -300), pickup('beans', 500 - 101, -300), pickup('beans', 0, 0)]}, f).seen.all).toBe(1);
    // a broken position is no dot
    expect(takeSnapshot({pickups: [pickup('beans', NaN, 0), pickup('beans', 0, Infinity)]}, HERE).seen.all).toBe(0);
  });

  it('every storey is flattened onto one plane: height is not read, a thing ten floors up is one more thing in its cell', () => {
    const sunk = {...pickup('beans', 41.5, 42), y: -8};
    const s = takeSnapshot({holders: [holder(40, 40, ['beans'], 0), holder(41, 41, ['water'], 24)], pickups: [sunk]}, HERE);
    expect(dots(s, 'all')).toEqual([{x: cellOf(40), z: cellOf(40), n: 3}]);
    // a snapshot holds positions on the plane and counts only: no height, no storey, no id, no name
    for (const c of s.cells) {
      expect(Object.keys(c).sort()).toEqual(['n', 'x', 'z']);
      expect(Object.keys(c.n)).toEqual([...SCAN_MODES]);
    }
    for (const m of SCAN_MODES) for (const b of dots(s, m)) expect(Object.keys(b).sort()).toEqual(['n', 'x', 'z']);
  });
});

describe('a mode is a filter of the ONE snapshot', () => {
  it('each mode shows exactly the cells with things of it, with their counts; ALL is every resource cell; nothing is read again', () => {
    const src: ScanSources = {pickups: [pickup('beans', 9, 5), pickup('knife', 10, 6), pickup('ammo_9mm', 30, 30)], holders: [holder(9, 6, ['water', 'pistol'])]};
    const s = takeSnapshot(src, HERE);
    expect(dots(s, 'all')).toEqual([{x: 10, z: 6, n: 3}, {x: 30, z: 30, n: 1}]);
    expect(dots(s, 'food')).toEqual([{x: 10, z: 6, n: 2}]);
    expect(dots(s, 'weapon')).toEqual([{x: 10, z: 6, n: 2}]);
    expect(dots(s, 'ammo')).toEqual([{x: 30, z: 30, n: 1}]);
    for (const m of ['fuel', 'equipment', 'material'] as const) expect(scanBlips(s, m)).toEqual({blips: [], dropped: 0});
    // filtering reads only the snapshot: the sources can be gone and the snapshot is unchanged
    const frozen = JSON.stringify(s);
    (src.pickups as ScanPickup[]).length = 0;
    for (const m of SCAN_MODES) scanBlips(s, m);
    expect(JSON.stringify(s)).toBe(frozen);
    expect(dots(s, 'food')).toEqual([{x: 10, z: 6, n: 2}]);
  });

  it('every mode\'s dots are cells of the snapshot, never more things than ALL counts there', () => {
    const src = scatter(300);
    const s = takeSnapshot(src, HERE), all = new Map(s.cells.map(c => [`${c.x},${c.z}`, c.n.all]));
    let n = 0;
    for (const m of SCAN_CATEGORIES) for (const b of dots(s, m)) {
      expect(all.has(`${b.x},${b.z}`)).toBe(true);
      expect(b.n).toBeLessThanOrEqual(all.get(`${b.x},${b.z}`)!);
      n++;
    }
    expect(n).toBeGreaterThan(300);
    // ALL's own dots are the nearest cells (its cap is ALL's alone: a mode's far dots are not cut by it)
    expect(dots(s, 'all')).toEqual(s.cells.slice(0, SCANNER.maxBlips).map(c => ({x: c.x, z: c.z, n: c.n.all})));
  });
});

/** A deterministic scatter of resources in a ~160 m square. */
function scatter(n: number): {pickups: ScanPickup[]; holders: ScanHolder[]; bags: ScanBag[]; carts: ScanCart[]} {
  let a = 12345;
  const r = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5) * 160;
  const ids = ['beans', 'ammo_9mm', 'knife', 'water', 'backpack', 'scrap_metal', 'fuel_can', 'medkit'];
  return {
    pickups: Array.from({length: n}, (_, i) => pickup(ids[i % ids.length], r(), r())),
    holders: Array.from({length: n}, (_, i) => holder(r(), r(), i % 5 === 0 ? [] : [ids[i % ids.length], ids[(i * 3) % ids.length]])),
    bags: Array.from({length: Math.ceil(n / 20)}, () => bag(r(), r())),
    carts: Array.from({length: 6}, (_, i) => cart(r(), r(), i % 3)),
  };
}

describe('a snapshot is coarse and deterministic', () => {
  it('positions are quantised to 4 m cells; the things of one mode in one cell are ONE dot', () => {
    const s = takeSnapshot({pickups: [pickup('beans', 8.1, 4.1), pickup('water', 11.9, 7.9), pickup('cola', 9, 5), pickup('beans', 12.1, 4.1), pickup('knife', 10, 6)]}, HERE);
    expect(dots(s, 'food')).toEqual([{x: 10, z: 6, n: 3}, {x: 14, z: 6, n: 1}]);
    // another mode in the same cell is its own dot (on its own mode's picture)
    expect(dots(s, 'weapon')).toEqual([{x: 10, z: 6, n: 1}]);
    expect(dots(s, 'all')).toEqual([{x: 10, z: 6, n: 4}, {x: 14, z: 6, n: 1}]);
    // a dot is never nearer the truth than its cell: the centre, up to half a cell diagonal off
    for (const [x, z] of [[8.1, 4.1], [11.9, 7.9], [-0.1, -0.1], [-3.9, 3.9], [57.3, -41.2]]) {
      const [b] = dots(takeSnapshot({pickups: [pickup('beans', x, z)]}, HERE), 'all');
      expect([b.x, b.z]).toEqual([cellOf(x), cellOf(z)]);
      expect(Math.hypot(b.x - x, b.z - z)).toBeLessThanOrEqual(SCANNER.cell * Math.SQRT1_2 + 1e-9);
      expect((b.x / (SCANNER.cell / 2)) % 2).not.toBe(0); // a cell CENTRE, never a grid line
    }
  });

  it('a count only makes the mark a little larger, capped', () => {
    expect(blipScale(1)).toBe(1);
    expect(blipScale(SCANNER.countCap)).toBeCloseTo(SCANNER.countGrow);
    expect(blipScale(500)).toBeCloseTo(SCANNER.countGrow);
    expect(SCANNER.countGrow).toBeLessThanOrEqual(1.5);
    for (let n = 1; n < 12; n++) expect(blipScale(n + 1)).toBeGreaterThanOrEqual(blipScale(n));
  });

  it('the same things give the same dots, in the same order, whatever order the lists come in', () => {
    const src = scatter(300);
    const a = takeSnapshot(src, HERE), again = takeSnapshot(src, HERE);
    expect(again).toEqual(a);
    const rev = takeSnapshot({pickups: [...src.pickups].reverse(), holders: [...src.holders].reverse(), bags: [...src.bags].reverse(), carts: [...src.carts].reverse()}, HERE);
    expect(rev).toEqual(a);
    const rot = <T>(l: T[], k: number) => [...l.slice(k), ...l.slice(0, k)];
    expect(takeSnapshot({pickups: rot(src.pickups, 31), holders: rot(src.holders, 211), bags: rot(src.bags, 3), carts: rot(src.carts, 2)}, HERE)).toEqual(a);
    // sorted: the nearest first, no cell twice, every count accounted for
    const d = a.cells.map(b => b.x * b.x + b.z * b.z);
    expect(d).toEqual([...d].sort((u, v) => u - v));
    expect(new Set(a.cells.map(b => `${b.x},${b.z}`)).size).toBe(a.cells.length);
    for (const m of SCAN_MODES) {
      const r = scanBlips(a, m);
      if (!r.dropped) expect(r.blips.reduce((n, b) => n + b.n, 0)).toBe(a.seen[m]);
      expect(a.seen[m], m).toBeGreaterThan(0);
    }
    expect(a.seen.all).toBeGreaterThan(300);
    // taking a snapshot changes nothing it reads
    const before = JSON.stringify(src);
    takeSnapshot(src, HERE);
    expect(JSON.stringify(src)).toBe(before);
  });

  it('at most maxBlips dots per mode: the nearest cells are kept, the cut is counted', () => {
    // one tin of beans in every cell of a 100 m square: far more cells than the cap
    const pickups: ScanPickup[] = [];
    for (let x = -98; x < 100; x += 4) for (let z = -98; z < 100; z += 4) pickups.push(pickup('beans', x, z));
    pickups.push(pickup('ammo_9mm', 3, 3));
    const s = takeSnapshot({pickups}, HERE);
    const food = scanBlips(s, 'food'), all = scanBlips(s, 'all');
    expect(food.blips).toHaveLength(SCANNER.maxBlips);
    expect(all.blips).toHaveLength(SCANNER.maxBlips);
    expect(food.dropped).toBe(s.cells.length - SCANNER.maxBlips);
    expect(food.dropped).toBeGreaterThan(1000);
    const kept = new Set(food.blips.map(b => `${b.x},${b.z}`));
    const far = Math.max(...food.blips.map(b => Math.hypot(b.x, b.z)));
    let nearestCut = Infinity;
    for (const c of s.cells) if (!kept.has(`${c.x},${c.z}`)) nearestCut = Math.min(nearestCut, Math.hypot(c.x, c.z));
    expect(far).toBeLessThanOrEqual(nearestCut);
    // the cap is per mode: the one cell of ammo is untouched
    expect(scanBlips(s, 'ammo')).toEqual({blips: [{x: 2, z: 2, n: 1}], dropped: 0});
    // and it is the same cut in any order
    expect(takeSnapshot({pickups: [...pickups].reverse()}, HERE)).toEqual(s);
  });
});

describe('the scope is the TRAIN\'s frame: the car\'s front is +x whichever way it stands', () => {
  it('agrees with the train placement\'s own transform for both yaws', () => {
    for (const p of [{x: 37.5, z: -12, front: 1 as const, railTopY: 0.295}, {x: -80, z: 44, front: -1 as const, railTopY: -3.2}]) {
      for (const [wx, wz] of [[0, 0], [100, 30], [-12.5, 77], [p.x, p.z]]) {
        const t = worldToTrain(p, wx, 1.2, wz), s = toScanFrame(p, wx, wz);
        expect(s.x).toBeCloseTo(t.x, 9);
        expect(s.z).toBeCloseTo(t.z, 9);
      }
    }
  });

  it('a thing ahead of the car\'s front is ahead (+x) on the scope for a car facing +X and for one facing -X; its right stays its right', () => {
    const east: ScanFrame = {x: 200, z: 50, front: 1}, west: ScanFrame = {x: 200, z: 50, front: -1};
    // 40 m ahead of each car's own front
    const a = dots(takeSnapshot({pickups: [pickup('beans', 240, 50.5)]}, east), 'all')[0], b = dots(takeSnapshot({pickups: [pickup('beans', 160, 49.5)]}, west), 'all')[0];
    expect([a.x, a.z]).toEqual([42, 2]);
    expect([b.x, b.z]).toEqual([42, 2]);
    // the same world thing is ahead of one car and behind the other
    const c = dots(takeSnapshot({pickups: [pickup('beans', 241, 50.5)]}, west), 'all')[0];
    expect([c.x, c.z]).toEqual([cellOf(-41), cellOf(-0.5)]);
    expect(c.x).toBeLessThan(0);
    // a turned car is a half turn of the picture, never a mirror image: one metre ahead / one metre to the right are (1, 0) / (0, 1) in both
    for (const [f, ahead, right] of [[east, toScanFrame(east, 201, 50), toScanFrame(east, 200, 51)], [west, toScanFrame(west, 199, 50), toScanFrame(west, 200, 49)]] as const) {
      expect([f.front, ahead.x, ahead.z + 0, right.x + 0, right.z].map(v => Math.round(v * 1e9) / 1e9 + 0)).toEqual([f.front, 1, 0, 0, 1]);
      expect(ahead.x * right.z - ahead.z * right.x).toBe(1);
    }
  });

  it('a real generated station around its real parked train: bounded, in range, deterministic, the placement\'s frame', () => {
    const layout = LEVELS.subway.generate('main', {levelSeed: 4242, startWeapon: 'pistol'}) as StationLayout;
    const p = playerTrainPlacement(layout)!;
    expect(p).toBeTruthy();
    const src: ScanSources = {
      pickups: layout.pickups.map(q => ({stack: {itemId: q.itemId}, x: q.x, z: q.z})),
      holders: layout.props.filter(q => isLootHolderKind(q.kind)).map(q => ({prop: q, state: {lots: [{itemId: 'water'}]}})),
    };
    const s = takeSnapshot(src, p);
    expect(takeSnapshot(src, p)).toEqual(s);
    expect(s.seen.all).toBeGreaterThan(20);
    for (const m of SCAN_MODES) {
      const r = scanBlips(s, m);
      expect(r.blips.length).toBeLessThanOrEqual(SCANNER.maxBlips);
      for (const b of r.blips) expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(SCANNER.range + SCANNER.cell * Math.SQRT1_2);
      // with EVERY loot holder counted as holding something the cap still cuts nothing here (SCANNER.maxBlips: measured, not guessed)
      expect([m, r.dropped]).toEqual([m, 0]);
    }
    // every pickup dot is the cell of a real pickup in the placement's own frame
    const cells = new Set(layout.pickups.filter(q => itemModes(q.itemId)).map(q => worldToTrain(p, q.x, 0, q.z)).filter(q => Math.hypot(q.x, q.z) <= SCANNER.range).map(q => `${cellOf(q.x)},${cellOf(q.z)}`));
    const pickupOnly = takeSnapshot({pickups: src.pickups}, p);
    expect(new Set(dots(pickupOnly, 'all').map(b => `${b.x},${b.z}`))).toEqual(cells);
  });
});

describe('the sweep clock counts active seconds only', () => {
  it('the first sweep 4 s after arming, then one every 30 s; exactly one a tick', () => {
    const c = new SweepClock();
    const due: number[] = [];
    let t = 0;
    for (let i = 0; i < 400; i++) { t += 0.25; if (c.tick(0.25)) due.push(t); }
    expect(due).toEqual([4, 34, 64, 94]);
    expect(c.sweeps).toBe(4);
    // a new world arms the warm-up again
    c.arm();
    expect([c.left, c.sweeps, c.seconds]).toEqual([SCANNER.warmup, 0, 4]);
  });

  it('no time, no sweep: a zero / negative / broken dt moves nothing; a very long frame gives ONE sweep and queues none', () => {
    const c = new SweepClock();
    for (const dt of [0, -1, NaN]) expect(c.tick(dt)).toBe(false);
    expect(c.left).toBe(SCANNER.warmup);
    expect(c.tick(1000)).toBe(true);
    expect(c.left).toBe(SCANNER.period);
    expect(c.tick(0.5)).toBe(false);
    expect(c.sweeps).toBe(1);
    // a small overshoot is kept: the cadence does not drift with the frame length
    const d = new SweepClock();
    expect(d.tick(4.3)).toBe(true);
    expect(d.left).toBeCloseTo(29.7);
  });

  it('"next sweep in N s" counts whole seconds down to 1; the hand turns once a period and is up at the sweep; blips dim to 40 %, never less', () => {
    expect([secondsLeft(30), secondsLeft(29.2), secondsLeft(1.01), secondsLeft(1), secondsLeft(0.02), secondsLeft(4)]).toEqual([30, 30, 2, 1, 1, 4]);
    expect(sweepAngle(SCANNER.period)).toBeCloseTo(0); // just swept: up
    expect(sweepAngle(SCANNER.period * 0.75)).toBeCloseTo(Math.PI / 2); // a quarter turn clockwise
    expect(sweepAngle(SCANNER.period * 0.5)).toBeCloseTo(Math.PI);
    expect(sweepAngle(0.001)).toBeGreaterThan(Math.PI * 1.99); // about to come up again
    expect(sweepAngle(SCANNER.warmup)).toBeCloseTo(Math.PI * 2 * (1 - SCANNER.warmup / SCANNER.period)); // the warm-up is the last part of a turn
    expect(blipBrightness(SCANNER.period)).toBe(1);
    expect(blipBrightness(SCANNER.period / 2)).toBeCloseTo(0.7);
    expect(blipBrightness(0)).toBeCloseTo(SCANNER.dim);
    for (let left = 30; left >= 0; left -= 0.5) expect(blipBrightness(left)).toBeGreaterThanOrEqual(SCANNER.dim - 1e-9);
  });
});
