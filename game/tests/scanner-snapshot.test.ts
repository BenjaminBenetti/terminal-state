// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "About every 30 active seconds a sweep refreshes snapshot blips:
// red enemies, green ordinary items, gold weapons/gear. No floorplan/map or continuous live tracking; it should give broad awareness
// rather than precise navigation."): the scanner's PURE rules (craft/scanner.ts) —
//  - what counts as what: weapons (guns AND melee) and gear are gold, everything else in the catalogue green, an unknown id nothing;
//  - a snapshot: living non-ragdolled enemies; loose pickups (never a stall's ware, never the train's cargo); holders that still hold
//    lots (gold if any lot is gold); grounded bags; cut at 100 m from the car's centre; every storey flattened;
//  - coarse: 4 m cells in the TRAIN's frame (the car's front is +x for both ways the car can stand), one blip per class and cell, a
//    bounded count per class (the nearest first); the same things give the same blips whatever order they come in;
//  - the sweep clock: 4 active seconds to a world's first sweep, then 30; a long frame queues none.
// Node only: plain objects, and one real generated station with its real train placement.

import {describe, expect, it} from 'vitest';
import {
  SCANNER, SCAN_CLASSES, SweepClock, blipBrightness, blipScale, classifyItem, classifyItems, secondsLeft, sweepAngle, takeSnapshot, toScanFrame,
  type ScanBag, type ScanEnemy, type ScanFrame, type ScanHolder, type ScanPickup, type ScanSources,
} from '../src/craft/scanner';
import {ITEMS} from '../src/items/items';
import {GEAR_IDS} from '../src/items/gear';
import {MATERIAL_IDS} from '../src/items/craftMaterials';
import {WEAPONS} from '../src/weapons/weapons';
import {playerTrainPlacement, worldToTrain} from '../src/gen/playerTrain';
import {isLootHolderKind} from '../src/items/loot';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';

const HERE: ScanFrame = {x: 0, z: 0, front: 1};
const enemy = (x: number, z: number, o: {alive?: boolean; ragdolled?: boolean; y?: number} = {}): ScanEnemy & {brain: {y: number}} =>
  ({brain: {alive: o.alive ?? true, x, z, y: o.y ?? 0}, ragdolled: o.ragdolled ?? false});
const pickup = (itemId: string, x: number, z: number, owner?: string): ScanPickup & {y: number} => ({stack: {itemId}, x, y: 0, z, ...(owner ? {owner} : {})});
const holder = (x: number, z: number, lots: string[], y = 0): ScanHolder => ({prop: {x, y, z}, state: {lots: lots.map(itemId => ({itemId}))}});
const bag = (x: number, z: number, grounded = true): ScanBag => ({pose: {x, z}, grounded});
/** The cell centre a position is quantised to. */
const cellOf = (v: number) => (Math.floor(v / SCANNER.cell) + 0.5) * SCANNER.cell;

describe('the scanner numbers (one place)', () => {
  it('about 100 m, a sweep every 30 active seconds, coarse 4 m cells, a bounded draw', () => {
    expect([SCANNER.range, SCANNER.period, SCANNER.warmup, SCANNER.cell]).toEqual([100, 30, 4, 4]);
    expect(SCANNER.rings).toEqual([25, 50, 75, 100]);
    expect(SCANNER.rings[SCANNER.rings.length - 1]).toBe(SCANNER.range);
    expect(SCANNER.maxBlips).toBeGreaterThanOrEqual(160);
    expect(SCANNER.maxBlips).toBeLessThanOrEqual(400);
    expect(SCANNER.dim).toBeCloseTo(0.4);
    expect(SCANNER.closeDist).toBeCloseTo(2.6);
    expect(SCANNER.canvas).toEqual({frac: 0.8, max: 720, min: 240, dpr: 2});
  });
});

describe('what an item is to the scanner', () => {
  it('every weapon (guns and melee) and every piece of gear is gold; everything else in the catalogue is green', () => {
    const kinds = new Map<string, Set<string>>();
    for (const def of Object.values(ITEMS)) {
      const c = classifyItem(def.id);
      expect([def.id, c]).toEqual([def.id, def.kind === 'weapon' || def.kind === 'gear' ? 'gear' : 'item']);
      (kinds.get(c!) ?? kinds.set(c!, new Set()).get(c!)!).add(def.kind);
    }
    expect([...kinds.get('gear')!].sort()).toEqual(['gear', 'weapon']);
    // every other kind the catalogue has is an ordinary item
    expect([...kinds.get('item')!].sort()).toEqual(['ammo', 'consumable', 'currency', 'material', 'part', 'supply', 'throwable']);
    // melee weapons are weapons too
    const melee = Object.values(ITEMS).filter(d => d.kind === 'weapon' && WEAPONS[d.weaponId!]?.melee).map(d => d.id);
    expect(melee).toContain('knife');
    expect(melee.length).toBeGreaterThan(1);
    for (const id of melee) expect(classifyItem(id)).toBe('gear');
    for (const id of ['rifle', 'shotgun', 'pistol']) expect(classifyItem(id)).toBe('gear');
    expect(GEAR_IDS.length).toBeGreaterThan(3);
    for (const id of GEAR_IDS) expect(classifyItem(id)).toBe('gear');
  });

  it('ammo, food, drink, medical supplies, materials and parts are ordinary (green)', () => {
    for (const id of ['ammo_9mm', 'ammo_556', 'ammo_12ga', 'beans', 'chips', 'bread', 'water', 'cola', 'medkit', 'bandage', 'leg_splint', 'arm_sling',
      'battery', 'flare', 'gas_filter', 'fuel_can', ...MATERIAL_IDS, 'reactor_key', 'fuse_cartridge', 'rail_ties']) {
      expect([id, classifyItem(id)]).toEqual([id, 'item']);
    }
  });

  it('an id the catalogue does not know is nothing (never a blip): not even an Object.prototype name', () => {
    for (const id of ['', 'nope', 'RIFLE', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) expect([id, classifyItem(id)]).toEqual([id, null]);
    expect(classifyItem(undefined as unknown as string)).toBeNull();
  });

  it('things lying together: gold when any is gold, green when any is known, nothing otherwise', () => {
    const lots = (...ids: string[]) => ids.map(itemId => ({itemId}));
    expect(classifyItems(lots())).toBeNull();
    expect(classifyItems(lots('beans', 'ammo_9mm'))).toBe('item');
    expect(classifyItems(lots('beans', 'knife', 'water'))).toBe('gear');
    expect(classifyItems(lots('nope', 'water'))).toBe('item');
    expect(classifyItems(lots('nope', 'whatever'))).toBeNull();
  });
});

describe('a snapshot: what is in it', () => {
  it('enemies: the living, non-ragdolled ones only', () => {
    const s = takeSnapshot({enemies: [enemy(10, 2), enemy(30, 2, {alive: false}), enemy(50, 2, {ragdolled: true}), enemy(70, 2, {alive: false, ragdolled: true})]}, HERE);
    expect(s.enemy).toEqual([{x: cellOf(10), z: cellOf(2), n: 1}]);
    expect(s.seen).toEqual({enemy: 1, item: 0, gear: 0});
    expect([s.item, s.gear]).toEqual([[], []]);
  });

  it('loose pickups by class; a market stall\'s ware and the train\'s own cargo are never blips; an unknown id is ignored', () => {
    const cargo = pickup('rifle', 1, 1), ware = pickup('medkit', 30, 30, 'stall-3');
    const src: ScanSources = {
      pickups: [pickup('beans', 20, 0), pickup('ammo_9mm', -20, 0), pickup('knife', 0, 40), pickup('gas_mask', 0, -40), pickup('mystery_item', 8, 8), ware, cargo],
      cargoPickup: p => p === cargo,
    };
    const s = takeSnapshot(src, HERE);
    expect(s.item).toEqual([{x: cellOf(20), z: cellOf(0), n: 1}, {x: cellOf(-20), z: cellOf(0), n: 1}].sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z) || a.x - b.x));
    expect(s.gear.map(b => [b.x, b.z])).toEqual([[cellOf(0), cellOf(-40)], [cellOf(0), cellOf(40)]]);
    expect(s.seen).toEqual({enemy: 0, item: 2, gear: 2});
    // without the cargo rule the rifle in the car WOULD be a blip (the exclusion is the rule, not a missing source)
    expect(takeSnapshot({...src, cargoPickup: undefined}, HERE).seen.gear).toBe(3);
    // a ware stays excluded whoever asks
    expect(takeSnapshot({pickups: [ware]}, HERE).seen).toEqual({enemy: 0, item: 0, gear: 0});
  });

  it('holders: one blip per holder that still holds lots — empty none, ordinary lots green, any weapon / gear among them gold', () => {
    const s = takeSnapshot({holders: [holder(12, 0, []), holder(24, 0, ['beans', 'water', 'ammo_556']), holder(48, 0, ['beans', 'pistol']), holder(60, 0, ['backpack']), holder(72, 0, ['not_an_item'])]}, HERE);
    expect(s.item).toEqual([{x: cellOf(24), z: cellOf(0), n: 1}]);
    expect(s.gear).toEqual([{x: cellOf(48), z: cellOf(0), n: 1}, {x: cellOf(60), z: cellOf(0), n: 1}]);
    expect(s.seen).toEqual({enemy: 0, item: 1, gear: 2}); // three lots in one holder are ONE thing; the emptied holder is none
    // emptied before the sweep -> gone from the next snapshot
    const h = holder(24, 0, ['beans']);
    expect(takeSnapshot({holders: [h]}, HERE).item).toHaveLength(1);
    (h.state.lots as {itemId: string}[]).length = 0;
    expect(takeSnapshot({holders: [h]}, HERE).item).toHaveLength(0);
    // a holder standing in the parked car is the train's cargo
    expect(takeSnapshot({holders: [h, holder(2, 0, ['beans'])], cargoHolder: c => c.prop.x === 2}, HERE).seen.item).toBe(0);
  });

  it('grounded backpacks are gold; one being worn / carried away is not there; one in the car is cargo', () => {
    const inCar = bag(1, 0);
    const s = takeSnapshot({bags: [bag(16, 16), bag(40, 0, false), inCar], cargoBag: b => b === inCar}, HERE);
    expect(s.gear).toEqual([{x: cellOf(16), z: cellOf(16), n: 1}]);
    expect(s.item).toEqual([]);
  });

  it('the range is 100 m, horizontal, from the car\'s centre', () => {
    const at = (d: number, a: number) => enemy(Math.cos(a) * d, Math.sin(a) * d);
    for (const a of [0, 1, 2.5, 4, 5.5]) {
      expect(takeSnapshot({enemies: [at(99.9, a)]}, HERE).enemy).toHaveLength(1);
      expect(takeSnapshot({enemies: [at(100.1, a)]}, HERE).enemy).toHaveLength(0);
    }
    expect(takeSnapshot({enemies: [enemy(100, 0)], pickups: [pickup('beans', 0, -100)], holders: [holder(-100, 0, ['knife'])], bags: [bag(0, 100)]}, HERE).seen).toEqual({enemy: 1, item: 1, gear: 2});
    expect(takeSnapshot({enemies: [enemy(100.01, 0)], pickups: [pickup('beans', 0, -100.01)], holders: [holder(-100.01, 0, ['knife'])], bags: [bag(71, 71)]}, HERE).seen).toEqual({enemy: 0, item: 0, gear: 0});
    // measured from the CAR, wherever it stands
    const f: ScanFrame = {x: 500, z: -300, front: -1};
    expect(takeSnapshot({enemies: [enemy(500 - 99, -300), enemy(500 - 101, -300), enemy(0, 0)]}, f).enemy).toHaveLength(1);
    // a broken position is no blip
    expect(takeSnapshot({enemies: [enemy(NaN, 0), enemy(0, Infinity)]}, HERE).seen.enemy).toBe(0);
  });

  it('every storey is flattened onto one plane: height is not read, a thing ten floors up is one more thing in its cell', () => {
    const low = enemy(21, 9, {y: 0}), high = enemy(22, 10, {y: 36});
    const sunk = {...pickup('beans', 41.5, 42), y: -8};
    const s = takeSnapshot({enemies: [low, high], holders: [holder(40, 40, ['beans'], 0), holder(41, 41, ['water'], 24)], pickups: [sunk]}, HERE);
    expect(s.enemy).toEqual([{x: cellOf(21), z: cellOf(9), n: 2}]);
    expect(s.item).toEqual([{x: cellOf(40), z: cellOf(40), n: 3}]);
    // a snapshot holds positions on the plane and counts only: no height, no storey, no id, no name
    for (const cls of SCAN_CLASSES) for (const b of s[cls]) expect(Object.keys(b).sort()).toEqual(['n', 'x', 'z']);
    expect(Object.keys(s).sort()).toEqual(['dropped', 'enemy', 'gear', 'item', 'seen']);
  });
});

describe('a snapshot is coarse and deterministic', () => {
  it('positions are quantised to 4 m cells; the things of one class in one cell are ONE blip', () => {
    const s = takeSnapshot({enemies: [enemy(8.1, 4.1), enemy(11.9, 7.9), enemy(9, 5), enemy(12.1, 4.1)], pickups: [pickup('beans', 9, 5), pickup('knife', 10, 6)]}, HERE);
    expect(s.enemy).toEqual([{x: 10, z: 6, n: 3}, {x: 14, z: 6, n: 1}]);
    // another class in the same cell is its own blip
    expect(s.item).toEqual([{x: 10, z: 6, n: 1}]);
    expect(s.gear).toEqual([{x: 10, z: 6, n: 1}]);
    // a blip is never nearer the truth than its cell: the centre, up to half a cell diagonal off
    for (const [x, z] of [[8.1, 4.1], [11.9, 7.9], [-0.1, -0.1], [-3.9, 3.9], [57.3, -41.2]]) {
      const [b] = takeSnapshot({enemies: [enemy(x, z)]}, HERE).enemy;
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

  /** A deterministic scatter of things in a ~160 m square. */
  function scatter(n: number): {enemies: ScanEnemy[]; pickups: ScanPickup[]; holders: ScanHolder[]; bags: ScanBag[]} {
    let a = 12345;
    const r = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5) * 160;
    const ids = ['beans', 'ammo_9mm', 'knife', 'water', 'backpack', 'scrap_metal'];
    return {
      enemies: Array.from({length: n}, () => enemy(r(), r())),
      pickups: Array.from({length: n}, (_, i) => pickup(ids[i % ids.length], r(), r())),
      holders: Array.from({length: n}, (_, i) => holder(r(), r(), i % 5 === 0 ? [] : [ids[i % ids.length], ids[(i * 3) % ids.length]])),
      bags: Array.from({length: Math.ceil(n / 20)}, () => bag(r(), r())),
    };
  }

  it('the same things give the same blips, in the same order, whatever order the lists come in', () => {
    const src = scatter(300);
    const a = takeSnapshot(src, HERE), again = takeSnapshot(src, HERE);
    expect(again).toEqual(a);
    const rev = takeSnapshot({enemies: [...src.enemies].reverse(), pickups: [...src.pickups].reverse(), holders: [...src.holders].reverse(), bags: [...src.bags].reverse()}, HERE);
    expect(rev).toEqual(a);
    const rot = <T>(l: T[], k: number) => [...l.slice(k), ...l.slice(0, k)];
    expect(takeSnapshot({enemies: rot(src.enemies, 97), pickups: rot(src.pickups, 31), holders: rot(src.holders, 211), bags: rot(src.bags, 3)}, HERE)).toEqual(a);
    // sorted: the nearest first, no cell twice, every count accounted for
    for (const cls of SCAN_CLASSES) {
      const d = a[cls].map(b => b.x * b.x + b.z * b.z);
      expect(d).toEqual([...d].sort((u, v) => u - v));
      expect(new Set(a[cls].map(b => `${b.x},${b.z}`)).size).toBe(a[cls].length);
      if (!a.dropped[cls]) expect(a[cls].reduce((n, b) => n + b.n, 0)).toBe(a.seen[cls]);
    }
    expect(a.seen.enemy).toBeGreaterThan(100);
    // taking a snapshot changes nothing it reads
    const before = JSON.stringify(src);
    takeSnapshot(src, HERE);
    expect(JSON.stringify(src)).toBe(before);
  });

  it('at most maxBlips per class: the nearest cells are kept, the cut is counted', () => {
    // one enemy in every cell of a 100 m square: far more cells than the cap
    const enemies: ScanEnemy[] = [];
    for (let x = -98; x < 100; x += 4) for (let z = -98; z < 100; z += 4) enemies.push(enemy(x, z));
    const s = takeSnapshot({enemies, pickups: [pickup('beans', 3, 3)]}, HERE);
    expect(s.enemy).toHaveLength(SCANNER.maxBlips);
    expect(s.dropped.enemy).toBe(s.seen.enemy - SCANNER.maxBlips);
    expect(s.dropped.enemy).toBeGreaterThan(1000);
    const kept = new Set(s.enemy.map(b => `${b.x},${b.z}`));
    const far = Math.max(...s.enemy.map(b => Math.hypot(b.x, b.z)));
    let nearestCut = Infinity;
    for (const e of enemies) {
      const x = cellOf(e.brain.x), z = cellOf(e.brain.z), d = Math.hypot(x, z);
      if (d <= SCANNER.range + 3 && !kept.has(`${x},${z}`) && Math.hypot(e.brain.x, e.brain.z) <= SCANNER.range) nearestCut = Math.min(nearestCut, d);
    }
    expect(far).toBeLessThanOrEqual(nearestCut);
    // the cap is per class: the one item is untouched
    expect([s.item.length, s.dropped.item, s.dropped.gear]).toEqual([1, 0, 0]);
    // and it is the same cut in any order
    expect(takeSnapshot({enemies: [...enemies].reverse(), pickups: [pickup('beans', 3, 3)]}, HERE)).toEqual(s);
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
    const a = takeSnapshot({enemies: [enemy(240, 50.5)]}, east).enemy[0], b = takeSnapshot({enemies: [enemy(160, 49.5)]}, west).enemy[0];
    expect([a.x, a.z]).toEqual([42, 2]);
    expect([b.x, b.z]).toEqual([42, 2]);
    // the same world thing is ahead of one car and behind the other
    const c = takeSnapshot({enemies: [enemy(241, 50.5)]}, west).enemy[0];
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
      enemies: layout.zombies.map(z => ({brain: {alive: true, x: z.x, z: z.z}})),
      pickups: layout.pickups.map(q => ({stack: {itemId: q.itemId}, x: q.x, z: q.z})),
      holders: layout.props.filter(q => isLootHolderKind(q.kind)).map(q => ({prop: q, state: {lots: [{itemId: 'water'}]}})),
    };
    const s = takeSnapshot(src, p);
    expect(takeSnapshot(src, p)).toEqual(s);
    expect(s.seen.enemy).toBeGreaterThan(0);
    expect(s.seen.item).toBeGreaterThan(20);
    for (const cls of SCAN_CLASSES) {
      expect(s[cls].length).toBeLessThanOrEqual(SCANNER.maxBlips);
      for (const b of s[cls]) expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(SCANNER.range + SCANNER.cell * Math.SQRT1_2);
    }
    // every enemy blip is the cell of a real spawn in the placement's own frame
    const cells = new Set(layout.zombies.map(z => worldToTrain(p, z.x, 0, z.z)).filter(q => Math.hypot(q.x, q.z) <= SCANNER.range).map(q => `${cellOf(q.x)},${cellOf(q.z)}`));
    expect(new Set(s.enemy.map(b => `${b.x},${b.z}`))).toEqual(cells);
    // with EVERY loot holder counted as holding something the cap still cuts nothing here (SCANNER.maxBlips: measured, not guessed)
    expect(s.dropped).toEqual({enemy: 0, item: 0, gear: 0});
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
