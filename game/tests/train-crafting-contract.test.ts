// Task studio-train-crafting-v1-20261111-225628-01: the crafting CONTRACT — the equipment kinds / records / validators and the run-side
// store (craft/equipment.ts), the approved recipes (craft/recipes.ts), the fixtures' placements in the car (craft/trainFixtures.ts), the
// route radar's reveal radius (campaign/discovery.ts) and the fuel dolly controller's per-body mass / radius (world/fuelCartPhysics.ts).
import {describe, expect, it} from 'vitest';
import {
  EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, SENTRY_FEED_SLOTS, STATION_EQUIPMENT_LANE, TrainEquipment, copyEquipment, equipmentDisplay, equipmentProblem,
  equipmentRounds, equipmentSeqOf, freshEquipment, stationEquipmentOf, stationEquipmentProblem, trainEquipmentProblem, type EquipmentJSON,
} from '../src/craft/equipment';
import {SCAN_DEFAULT_MODE, SCAN_MODES} from '../src/craft/scanner';
import {RECIPES, RECIPE_MATERIALS, recipeFor} from '../src/craft/recipes';
import {
  BENCH_AISLE_MIN, PLUG, TRAIN_ROOF, TRAIN_ROOF_SKIN_Y, benchFootprint, benchPlacement, benchToLocal, craftSpots, equipmentPlugs,
  plugInReach, roofTopAt, roofTopAtPoint, turretMount,
} from '../src/craft/trainFixtures';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {ITEMS} from '../src/items/items';
import {LOCKBOX_SLOTS} from '../src/run/trainLockbox';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {chipperFootprint, chipperPlacement} from '../src/world/chipperPlace';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {lockboxFootprint} from '../src/world/trainLockbox';
import {CART, bodyMass, bodyPushTop, bodyRadius, cartMass, pushTop, type CartBody} from '../src/world/fuelCartPhysics';
import {FUEL} from '../src/fuel/fuel';
import {newCampaign, neighbors, revealAround} from '../src/campaign/discovery';
import {generateNetwork} from '../src/campaign/network';

const S = PLAYER_TRAIN_SPEC;

describe('train crafting: recipes', () => {
  it('lists the four approved outputs at the approved costs (scrap metal / electrical parts), in order', () => {
    expect(RECIPES.map(r => [r.kind, r.cost[SCRAP_METAL], r.cost[ELECTRICAL_PARTS]])).toEqual([['chest', 2, 0], ['radar', 4, 3], ['sentry', 8, 6], ['scanner', 5, 5]]);
    expect([...RECIPE_MATERIALS]).toEqual([SCRAP_METAL, ELECTRICAL_PARTS, BIO_MATER]); // (re-pin, task studio-refinement-batch-20261113-035659-01: bio mater makes the crafted grenades; the four units cost none of it)
    for (const r of RECIPES) expect(r.cost[BIO_MATER]).toBe(0);
    for (const r of RECIPES) {
      expect(Object.keys(r.cost).sort()).toEqual([...RECIPE_MATERIALS].sort());
      expect(r.blurb.length).toBeGreaterThan(40);
      expect(recipeFor(r.kind)).toBe(r);
    }
    // every equipment kind has exactly one recipe; the materials are real items
    expect(RECIPES.map(r => r.kind).sort()).toEqual([...EQUIPMENT_KINDS].sort());
    for (const m of RECIPE_MATERIALS) expect(ITEMS[m]?.kind).toBe('material');
  });
});

describe('train crafting: equipment kinds are traits, not lists', () => {
  it('the chest is the Lockbox store again and needs no plug; the three devices ride the fuel dolly and need a plug', () => {
    expect(EQUIPMENT.chest).toMatchObject({move: 'carry', plug: false, slots: LOCKBOX_SLOTS, slotItem: null, legacyAmmoCap: 0});
    expect(LOCKBOX_SLOTS).toBe(50);
    for (const k of ['radar', 'sentry', 'scanner'] as const) {
      expect(EQUIPMENT[k]).toMatchObject({move: 'dolly', plug: true, radius: CART.radius, height: CART.height});
      expect(EQUIPMENT[k].kg).toBeGreaterThan(CART.emptyKg);
      expect(EQUIPMENT[k].kg).toBeLessThanOrEqual(cartMass(FUEL.cartUnits));
    }
    // (task train-interaction-ux: the sentry's ammunition is a real FOUR-slot inventory that takes only 5.56 mm rounds)
    expect(SENTRY_FEED_SLOTS).toBe(4);
    expect(EQUIPMENT.sentry).toMatchObject({slots: 4, slotItem: 'ammo_556', legacyAmmoCap: 300});
    expect(ITEMS[EQUIPMENT.sentry.slotItem!]?.kind).toBe('ammo');
    for (const k of ['radar', 'scanner'] as const) expect(EQUIPMENT[k]).toMatchObject({slots: 0, slotItem: null, legacyAmmoCap: 0});
    // a feed is storage with one item; only a kind that once had a round counter accepts a legacy one
    for (const k of EQUIPMENT_KINDS) {
      const d = EQUIPMENT[k];
      expect(d.kind).toBe(k);
      if (d.slotItem) expect(d.slots).toBeGreaterThan(0);
      if (d.legacyAmmoCap) expect(d.slotItem).not.toBeNull();
    }
  });

  it('a fresh unit is EMPTY: no stacks, no rounds, no plug', () => {
    const pose = {x: 1, y: 0.98, z: 0.5, yaw: 0};
    expect(freshEquipment('chest', 'eq-1', pose)).toEqual({uid: 'eq-1', kind: 'chest', ...pose, slots: new Array(50).fill(null)});
    expect(freshEquipment('sentry', 'eq-2', pose)).toEqual({uid: 'eq-2', kind: 'sentry', ...pose, slots: [null, null, null, null]});
    expect(freshEquipment('radar', 'eq-3', pose)).toEqual({uid: 'eq-3', kind: 'radar', ...pose});
    for (const k of EQUIPMENT_KINDS) {
      expect(equipmentProblem(freshEquipment(k, 'eq-9', pose), false)).toBeNull();
      expect(equipmentRounds(freshEquipment(k, 'eq-9', pose))).toBe(0);
    }
  });
});

describe('train crafting: records', () => {
  const pose = {x: -2, y: 0.98, z: 0.9, yaw: 1.5};
  const chest = (): EquipmentJSON => ({...freshEquipment('chest', 'eq-1', pose), slots: [{uid: 7, itemId: 'ammo_556', count: 30}, ...new Array(49).fill(null)]});

  it('accepts exact records and refuses malformed ones (never a free round, slot or plug)', () => {
    expect(equipmentProblem(chest(), false)).toBeNull();
    const feed = (...counts: (number | null)[]) => counts.map((c, i) => (c === null ? null : {uid: 20 + i, itemId: 'ammo_556', count: c}));
    const sentry = (extra: Record<string, unknown> = {}): EquipmentJSON => ({...freshEquipment('sentry', 'eq-2', pose), ...extra} as EquipmentJSON);
    expect(equipmentProblem(sentry({slots: feed(120, null, 30, null), plug: 1}), false)).toBeNull();
    expect(equipmentProblem(sentry({level: 2}), true)).toBeNull();
    expect(equipmentRounds(sentry({slots: feed(120, null, 30, null)}))).toBe(150);
    // LEGACY: a record from before the feed slots carries `ammo` (0..300), with no slots at all or beside (empty) slots — both stay valid
    const legacy = {uid: 'eq-2', kind: 'sentry', ...pose, ammo: 300} as EquipmentJSON;
    expect(equipmentProblem(legacy, false)).toBeNull();
    expect(equipmentProblem({...legacy, ammo: 0, plug: 2}, false)).toBeNull();
    expect(equipmentProblem(sentry({ammo: 120, plug: 1}), false)).toBeNull();
    expect(equipmentRounds(legacy)).toBe(300);
    expect(equipmentRounds(sentry({ammo: 77, slots: feed(null, 5, null, null)}))).toBe(82);
    expect(equipmentRounds(chest())).toBe(0); // (a chest's 5.56 are stored items, not a feed's rounds)
    const bad: [unknown, boolean][] = [
      [null, false], [[], false], [{...chest(), kind: 'tank'}, false], [{...chest(), uid: 'x'}, false], [{...chest(), uid: 'eq-0'}, false],
      [{...chest(), slots: new Array(49).fill(null)}, false], [{...chest(), slots: undefined}, false], [{...chest(), ammo: 3}, false],
      [{...chest(), plug: 0}, false], [{...chest(), x: Infinity}, false], [{...chest(), x: 41}, false], [{...chest(), extra: 1}, false],
      [sentry({ammo: EQUIPMENT.sentry.legacyAmmoCap + 1}), false], [sentry({ammo: 1.5}), false], [sentry({ammo: -1}), false],
      [{...legacy, ammo: 301}, false], [{...legacy, ammo: undefined}, false], // (neither slots nor a legacy count: not a sentry record)
      [sentry({slots: feed(1, 2, 3)}), false], [sentry({slots: feed(1, 2, 3, 4, 5)}), false], [sentry({slots: 'none'}), false],
      // a feed's slots take only its own rounds: no other caliber, no other item, nothing that is not a stack
      [sentry({slots: [{uid: 20, itemId: 'ammo_9mm', count: 30}, null, null, null]}), false],
      [sentry({slots: [null, {uid: 20, itemId: 'bandage', count: 1}, null, null]}), false], [sentry({slots: [7, null, null, null]}), false],
      [{...freshEquipment('radar', 'eq-3', pose), ammo: 0}, false], [{...freshEquipment('radar', 'eq-3', pose), slots: []}, false],
      [{...freshEquipment('radar', 'eq-3', pose), plug: 3}, false],
      [{...freshEquipment('radar', 'eq-3', pose), plug: 0, level: 0}, true], // a station unit is never plugged
      [freshEquipment('radar', 'eq-3', pose), true], // a station unit needs its storey
      [{...freshEquipment('radar', 'eq-3', pose), level: 0}, false], // a unit aboard has none
    ];
    for (const [r, station] of bad) expect(equipmentProblem(r, station), JSON.stringify(r)?.slice(0, 80)).not.toBeNull();
    expect(equipmentProblem({...chest(), x: 4000, level: 0}, true)).toBeNull(); // world poses are wide
  });

  it('train / station lists: bounded, one uid once, one unit per plug, no unit newer than the counter', () => {
    const a = {...freshEquipment('radar', 'eq-1', pose), plug: 0}, b = {...freshEquipment('scanner', 'eq-2', pose), plug: 1};
    expect(trainEquipmentProblem({v: 1, seq: 2, aboard: [a, b]})).toBeNull();
    expect(trainEquipmentProblem({v: 1, seq: 0, aboard: []})).toBeNull();
    expect(trainEquipmentProblem({v: 1, seq: 1, aboard: [a, b]})).toMatch(/newer/);
    expect(trainEquipmentProblem({v: 1, seq: 2, aboard: [a, {...b, uid: 'eq-1'}]})).toMatch(/duplicate/);
    expect(trainEquipmentProblem({v: 1, seq: 2, aboard: [a, {...b, plug: 0}]})).toMatch(/plug/);
    expect(trainEquipmentProblem({v: 2, seq: 2, aboard: []})).toMatch(/version/);
    expect(trainEquipmentProblem({v: 1, seq: 2, aboard: [], held: null})).toMatch(/unexpected/);
    expect(trainEquipmentProblem({v: 1, seq: 99, aboard: Array.from({length: EQUIPMENT_LIMITS.aboard + 1}, (_, i) => freshEquipment('radar', `eq-${i + 1}`, pose))})).toMatch(/at most/);
    const here = {...freshEquipment('chest', 'eq-5', {x: 100, y: 0, z: 200, yaw: 0}), level: 1};
    expect(stationEquipmentProblem({v: 1, here: [here]})).toBeNull();
    expect(stationEquipmentProblem({v: 1, here: [here, here]})).toMatch(/duplicate/);
    expect(stationEquipmentOf({v: 1, here: [here]})).toEqual([here]);
    expect(stationEquipmentOf(undefined)).toEqual([]);
    expect(stationEquipmentOf({v: 1, here: [{...here, level: undefined}]})).toEqual([]);
    expect(STATION_EQUIPMENT_LANE).toMatch(/^[a-z][a-z0-9._-]{0,47}$/);
    expect(equipmentSeqOf('eq-12')).toBe(12);
    expect(equipmentSeqOf('cart-1')).toBe(0);
  });

  // Task studio-scanner-console-refinements-20261114-031614-01 (user: "Handle old scanner records safely with an All default; persist the
  // selected mode appropriately"): a kind's DISPLAY MODES are a trait (the scanner's: SCAN_MODES, ALL first); the record holds the mode as
  // `display` only when it is not the first
  it('display modes: a trait of the kind; a record keeps a mode only when it is not the default; old records load on ALL; a bad one is refused', () => {
    expect(EQUIPMENT.scanner.displayModes).toEqual([...SCAN_MODES]);
    expect(EQUIPMENT.scanner.displayModes[0]).toBe(SCAN_DEFAULT_MODE);
    for (const k of EQUIPMENT_KINDS) if (k !== 'scanner') expect([k, EQUIPMENT[k].displayModes]).toEqual([k, []]);
    const scanner = (extra: Record<string, unknown> = {}): EquipmentJSON => ({...freshEquipment('scanner', 'eq-4', pose), plug: 1, ...extra} as EquipmentJSON);
    // a fresh / old scanner record has no display field at all — and that is ALL
    expect(freshEquipment('scanner', 'eq-4', pose)).toEqual({uid: 'eq-4', kind: 'scanner', ...pose});
    expect(equipmentDisplay(EQUIPMENT.scanner, scanner().display)).toBe('all');
    // every mode but the default is a valid field, aboard and in a station, and reads back as itself; copies keep it
    for (const m of SCAN_MODES) {
      expect(equipmentProblem(scanner({display: m}), false)).toBeNull();
      expect(equipmentProblem({...freshEquipment('scanner', 'eq-4', pose), level: 0, display: m}, true)).toBeNull();
      expect(equipmentDisplay(EQUIPMENT.scanner, m)).toBe(m);
      expect(copyEquipment(scanner({display: m})).display).toBe(m);
    }
    expect(trainEquipmentProblem({v: 1, seq: 4, aboard: [scanner({display: 'fuel'})]})).toBeNull();
    // task studio-scanner-medical-20261114-054010-01: Medical was APPENDED — the field is the mode's name, so a record saved before it
    // ('material', the old last mode) still loads as that, and a Medical scanner saves and loads as 'medical'
    expect(trainEquipmentProblem({v: 1, seq: 5, aboard: [scanner({display: 'material'}), scanner({uid: 'eq-5', plug: 2, display: 'medical'})]})).toBeNull();
    expect([equipmentDisplay(EQUIPMENT.scanner, 'material'), equipmentDisplay(EQUIPMENT.scanner, 'medical')]).toEqual(['material', 'medical']);
    // a mode the kind does not have, a kind without modes, a non-string: malformed (the save is refused like any bad field)
    for (const bad of [scanner({display: 'enemy'}), scanner({display: 'ALL'}), scanner({display: ''}), scanner({display: 3}), scanner({display: null}),
      {...freshEquipment('radar', 'eq-3', pose), display: 'all'}, {...freshEquipment('sentry', 'eq-2', pose), display: 'ammo'}, {...chest(), display: 'all'}]) {
      expect(equipmentProblem(bad, false), JSON.stringify(bad).slice(0, 80)).not.toBeNull();
    }
    expect(equipmentProblem(scanner({display: 'enemy'}), false)).toMatch(/display mode/);
    // the live default for anything unknown is the kind's first (none for a kind without modes)
    expect([equipmentDisplay(EQUIPMENT.scanner, 'enemy'), equipmentDisplay(EQUIPMENT.scanner, undefined), equipmentDisplay(EQUIPMENT.radar, 'all')]).toEqual(['all', 'all', '']);
  });

  it('copies deeply (a chest keeps its stacks: uid, count, bag contents)', () => {
    const c = chest();
    c.slots![1] = {uid: 9, itemId: 'backpack', count: 1, bag: [{uid: 10, itemId: 'ammo_556', count: 5}, null]};
    const d = copyEquipment(c);
    expect(d).toEqual(c);
    d.slots![0]!.count = 1;
    d.slots![1]!.bag![0]!.count = 1;
    expect(c.slots![0]!.count).toBe(30);
    expect(c.slots![1]!.bag![0]!.count).toBe(5);
  });
});

describe('train crafting: the run-side store', () => {
  const pose = {x: -2, y: 0.98, z: 0.9, yaw: 0};

  it('hands out ids that are never reused, keeps the records exactly without a live system', () => {
    const e = new TrainEquipment();
    expect([e.nextUid(), e.nextUid()]).toEqual(['eq-1', 'eq-2']);
    const recs = [
      {...freshEquipment('sentry', 'eq-1', pose), slots: [{uid: 44, itemId: 'ammo_556', count: 40}, null, null, null], plug: 2},
      {...freshEquipment('chest', 'eq-2', pose), slots: [{uid: 31, itemId: 'ammo_556', count: 3, }, ...new Array(49).fill(null)]},
      {uid: 'eq-3', kind: 'sentry' as const, ...pose, ammo: 40}, // (a legacy record is kept exactly as it is: nothing converts it here)
    ];
    e.nextUid();
    e.setAboard(recs);
    const j = JSON.parse(JSON.stringify(e.toJSON()));
    expect(j).toEqual({v: 1, seq: 3, aboard: recs});
    expect(trainEquipmentProblem(j)).toBeNull();
    expect(e.maxUid()).toBe(44); // (the feed's stacks count for the inventory's uid counter too)
    const f = new TrainEquipment();
    f.load(j);
    expect(f.toJSON()).toEqual(j);
    expect(f.nextUid()).toBe('eq-4');
    f.reset();
    expect(f.toJSON()).toEqual({v: 1, seq: 0, aboard: []});
  });

  it('a malformed or absent record loads as NO equipment (never an invented unit)', () => {
    const e = new TrainEquipment();
    e.setAboard([freshEquipment('radar', 'eq-1', pose)]);
    e.seq = 1;
    e.load({v: 1, seq: 0, aboard: [freshEquipment('radar', 'eq-1', pose)]}); // newer than the counter
    expect(e.toJSON()).toEqual({v: 1, seq: 0, aboard: []});
    e.load(undefined);
    expect(e.toJSON()).toEqual({v: 1, seq: 0, aboard: []});
  });

  it('a live system is the truth while attached and is restored on load / reset', () => {
    const e = new TrainEquipment();
    let live: EquipmentJSON[] = [{...freshEquipment('sentry', 'eq-1', pose), slots: [null, {uid: 5, itemId: 'ammo_556', count: 12}, null, null]}];
    const restored: EquipmentJSON[][] = [];
    e.live = {aboard: () => live, restore: a => { restored.push(a); live = a; }};
    e.seq = 1;
    expect(e.toJSON().aboard).toEqual(live);
    e.load({v: 1, seq: 4, aboard: [freshEquipment('radar', 'eq-4', pose)]});
    expect(restored.at(-1)).toEqual([freshEquipment('radar', 'eq-4', pose)]);
    e.reset();
    expect(restored.at(-1)).toEqual([]);
    expect(e.seq).toBe(0);
  });

  it("is saved with the 'player-train' participant; an old save without it loads none; NewGame clears it", () => {
    const t = new PlayerTrainRecord(), p = t.participant();
    const feed = [{uid: 9, itemId: 'ammo_556', count: 77}, null, null, null];
    t.equipment.setAboard([{...freshEquipment('sentry', t.equipment.nextUid(), pose), slots: feed, plug: 0}]);
    const saved = JSON.parse(JSON.stringify(p.save())) as Record<string, unknown>;
    expect(saved.equipment).toEqual({v: 1, seq: 1, aboard: [{uid: 'eq-1', kind: 'sentry', ...pose, slots: feed, plug: 0}]});
    const u = new PlayerTrainRecord();
    u.participant().load(saved);
    expect(u.equipment.toJSON()).toEqual(saved.equipment);
    const old = {...saved};
    delete old.equipment;
    u.participant().load(old);
    expect(u.equipment.toJSON()).toEqual({v: 1, seq: 0, aboard: []});
    u.participant().load(saved);
    u.participant().reset();
    expect(u.equipment.toJSON()).toEqual({v: 1, seq: 0, aboard: []});
  });
});

describe('train crafting: the fixtures in the car', () => {
  it('the bench stands in the rear compartment opposite the Lockbox, inside the walls, leaving an aisle', () => {
    const b = benchPlacement(S)!, lb = S.lockbox!, rear = S.rear!;
    expect(b).not.toBeNull();
    expect(Math.sign(b.z)).toBe(-Math.sign(lb.z));
    const fp = benchFootprint(b), lf = lockboxFootprint(lb);
    expect(fp.x0).toBeGreaterThanOrEqual(rear.x0);
    expect(fp.x1).toBeLessThanOrEqual(rear.x1);
    expect(Math.abs(b.z) + b.depth / 2).toBeLessThan(S.interior.halfWidth);
    // the aisle between the bench's front and the Lockbox's front
    const aisle = b.z < 0 ? lf.z0 - fp.z1 : fp.z0 - lf.z1;
    expect(aisle).toBeGreaterThanOrEqual(BENCH_AISLE_MIN);
    // a real workbench: the worktop at a standing work height, the whole thing below the ceiling
    expect(b.worktopY).toBeGreaterThan(0.78);
    expect(b.worktopY).toBeLessThan(0.95);
    expect(b.height).toBeLessThan(1.4);
    // its front faces the aisle
    const front = benchToLocal(b, 0, 0, b.depth / 2);
    expect(Math.abs(front.z)).toBeLessThan(Math.abs(b.z));
    expect(benchToLocal(b, 0.2, 0.5, 0)).toEqual({x: b.x + (b.yaw === 0 ? 0.2 : -0.2), y: b.floorY + 0.5, z: b.z});
  });

  it('three generic plugs in the three wall bays the woodchipper does not use (its bay is the fourth equipment area)', () => {
    const plugs = equipmentPlugs(S), ch = chipperPlacement(S)!, cf = chipperFootprint(ch);
    expect(plugs.map(p => p.index)).toEqual([0, 1, 2]);
    expect(plugs.length).toBe(EQUIPMENT_LIMITS.plugs);
    expect(plugs.map(p => p.side)).toEqual([1, -1, -1]);
    for (const p of plugs) {
      expect(Math.abs(p.z)).toBeCloseTo(S.interior.halfWidth, 6);
      expect(p.x).toBeGreaterThan(p.bay.x0 + 0.5);
      expect(p.x).toBeLessThan(p.bay.x1 - 0.5);
      expect(p.y - S.floorY).toBeCloseTo(PLUG.socketY, 6);
      // no doorway inside its bay; not the chipper's bay
      for (const d of S.doors.filter(q => q.side === p.side)) expect(d.x > p.bay.x0 && d.x < p.bay.x1).toBe(false);
      expect(Math.sign(ch.z) === p.side && ch.x > p.bay.x0 && ch.x < p.bay.x1).toBe(false);
      // a device standing at the wall by the socket is in reach, and stands clear of the chipper
      const dock = {x: p.x, z: p.side * (S.interior.halfWidth - EQUIPMENT.radar.radius - 0.05)};
      expect(plugInReach(dock.x, dock.z, [], S)).toBe(p);
      expect(dock.x + EQUIPMENT.radar.radius < cf.x0 || dock.x - EQUIPMENT.radar.radius > cf.x1 || Math.sign(dock.z) !== Math.sign(ch.z)).toBe(true);
    }
    // the plugs' reach zones never overlap (a device is in reach of at most one)
    for (const a of plugs) for (const b of plugs) if (a.index < b.index) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * PLUG.reach);
    expect(plugInReach(plugs[0].x, plugs[0].z - 0.5, [0], S)).toBeNull(); // taken
    expect(plugInReach(S.cab.x0 + 1, 0, [], S)).toBeNull(); // the cab has none
    expect(equipmentPlugs(S)).toBe(plugs);
  });

  it('crafted units are put down on free saloon floor: by a wall first, never in a doorway, at a plug or in front of the bench room', () => {
    for (const k of EQUIPMENT_KINDS) {
      const r = EQUIPMENT[k].radius, spots = craftSpots(r, S), cf = chipperFootprint(chipperPlacement(S)!);
      expect(spots.length).toBeGreaterThan(6);
      expect(Math.abs(spots[0].z)).toBeGreaterThan(0.5); // a wall spot first
      for (const q of spots) {
        expect(q.x - r).toBeGreaterThan(S.rear!.x1);
        expect(q.x + r).toBeLessThan(S.cab.x0);
        expect(Math.abs(q.z) + r).toBeLessThan(S.interior.halfWidth);
        expect(plugInReach(q.x, q.z, [], S)).toBeNull();
        if (q.z !== 0) for (const d of S.doors.filter(x => x.side === Math.sign(q.z))) expect(Math.abs(q.x - d.x)).toBeGreaterThan(d.width / 2 + r);
        else {
          expect(q.x - S.rear!.x1).toBeGreaterThan(1.2);
          for (const d of S.doors) expect(Math.abs(q.x - d.x)).toBeGreaterThan(d.width / 2 + r);
        }
        const dx = q.x - Math.max(cf.x0, Math.min(cf.x1, q.x)), dz = q.z - Math.max(cf.z0, Math.min(cf.z1, q.z));
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(r);
      }
      // distinct
      expect(new Set(spots.map(q => `${q.x}:${q.z}`)).size).toBe(spots.length);
    }
  });

  it('the roof turret mounts on the middle roof hatch; every roof outline falls away to the eaves', () => {
    const m = turretMount(S), R = TRAIN_ROOF, mid = R.hatches[1];
    expect(m.z).toBe(0);
    expect(m.x).toBeGreaterThan(mid.x0 + 0.215);
    expect(m.x).toBeLessThan(mid.x1 - 0.215);
    // bedded on the hatch's top: at the lowest roof point under its base ring, within 2 cm of the highest
    expect(m.y).toBe(R.seat.lo);
    expect(R.seat.hi - m.y).toBeGreaterThanOrEqual(0);
    expect(R.seat.hi - m.y).toBeLessThan(0.02);
    expect(m.y).toBeGreaterThan(TRAIN_ROOF_SKIN_Y + 0.1);
    expect(m.y).toBeLessThanOrEqual(S.roofY);
    expect(m.y).toBeGreaterThan(S.ceilingY);
    expect(roofTopAt(0, S)).toBeGreaterThanOrEqual(S.roofY);
    expect(roofTopAt(0, S)).toBeLessThan(S.roofY + 0.005);
    expect(R.hatches).toHaveLength(3);
    for (const T of [R.body, R.ends, ...R.hatches.map(h => h.top)]) {
      let prev = Infinity;
      for (const y of T) { expect(y).toBeLessThanOrEqual(prev); prev = y; }
    }
    for (let k = 0; k < R.body.length; k++) {
      const z = (k + 0.5) * R.step;
      if (z > S.width / 2) break;
      expect(R.ends[k]).toBeGreaterThanOrEqual(R.body[k]);
      // the body between the hatches, the end caps, a hatch box, the whole-length outline; both sides alike
      expect(roofTopAtPoint(-3, z, S)).toBe(R.body[k]);
      expect(roofTopAtPoint(-3, -z, S)).toBe(R.body[k]);
      expect(roofTopAtPoint(R.endX + 0.2, z, S)).toBe(R.ends[k]);
      const inHatch = z <= R.hatchZ;
      expect(roofTopAtPoint(m.x, z, S)).toBe(inHatch ? mid.top[k] : R.body[k]);
      if (inHatch) expect(mid.top[k]).toBeGreaterThanOrEqual(R.body[k]);
      expect(roofTopAt(z, S)).toBe(Math.max(R.ends[k], ...(inHatch ? R.hatches.map(h => h.top[k]) : [])));
      expect(roofTopAt(z, S)).toBeGreaterThanOrEqual(roofTopAtPoint(m.x, z, S));
    }
    expect(roofTopAt(S.width / 2 + 0.5, S)).toBe(-Infinity);
    expect(roofTopAtPoint(0, S.width / 2 + 0.5, S)).toBe(-Infinity);
  });
});

describe('train crafting: the route radar reveals two stops', () => {
  it('radius 1 is the console alone (unchanged); radius 2 adds the neighbours of the neighbours; nothing is forgotten', () => {
    for (const seed of [1, 7, 20261111]) {
      const net = generateNetwork(seed), s0 = newCampaign(net);
      const one = revealAround(s0, net.start), same = revealAround(s0, net.start, 1);
      expect(same.known).toEqual(one.known);
      expect(one.known).toEqual([net.start, ...neighbors(net, net.start)]);
      const two = revealAround(s0, net.start, 2);
      const ring2 = new Set<string>([net.start, ...neighbors(net, net.start), ...neighbors(net, net.start).flatMap(n => neighbors(net, n))]);
      expect(new Set(two.known)).toEqual(ring2);
      expect(two.known.slice(0, one.known.length)).toEqual(one.known);
      expect(two.known.length).toBeGreaterThan(one.known.length);
      // unplugged again: what the radar showed stays known
      expect(revealAround(two, net.start, 1)).toBe(two);
      expect(revealAround(two, net.start, 2)).toBe(two);
      expect(s0.known).toEqual([net.start]); // never mutated
    }
  });
});

describe('train crafting: the fuel dolly controller carries other bodies', () => {
  const body = (o: Partial<CartBody> = {}): CartBody => ({x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, level: 0, units: 0, ...o});

  it('a fuel cart is unchanged; a body with its own kg / r uses them', () => {
    for (const u of [0, 3, FUEL.cartUnits]) {
      expect(bodyMass(body({units: u}))).toBe(cartMass(u));
      expect(bodyPushTop(body({units: u}))).toBe(pushTop(u));
      expect(bodyRadius(body({units: u}))).toBe(CART.radius);
    }
    expect(bodyMass(body({kg: 92}))).toBe(92);
    expect(bodyRadius(body({r: 0.4}))).toBe(0.4);
    expect(bodyPushTop(body({kg: CART.emptyKg}))).toBeCloseTo(CART.push.maxEmpty, 9);
    expect(bodyPushTop(body({kg: cartMass(FUEL.cartUnits)}))).toBeCloseTo(CART.push.maxFull, 9);
    expect(bodyPushTop(body({kg: 92}))).toBeLessThan(CART.push.maxEmpty);
    expect(bodyPushTop(body({kg: 92}))).toBeGreaterThan(CART.push.maxFull);
    expect(bodyPushTop(body({kg: 10}))).toBe(CART.push.maxEmpty);
    expect(bodyPushTop(body({kg: 900}))).toBe(CART.push.maxFull);
  });
});
