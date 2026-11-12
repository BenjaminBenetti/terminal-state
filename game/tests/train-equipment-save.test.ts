// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the train equipment's PERSISTENCE (world/trainEquipment.ts) over the
// save fixtures' Game-like harness (helpers/saveFixture.ts: a real RunState on the 40-station campaign, a real Inventory, the real
// 'player-train' participant) and the real train runtime + ride + Player (helpers/trainEquipmentHost.ts):
//  - THE STATION LANE: the units left in a station are written to its lane (STATION_EQUIPMENT_LANE = {v: 1, here}) at the teardown and
//    stand there again at the next build — pose, storey, rounds, stacks; flush() writes it without a teardown (the ending save); an
//    emptied station clears its lane; every station keeps its own list;
//  - THE SAVE: a file with a filled chest aboard AND filled chests left in two stations passes validateSaveFile (the run and its Retry
//    snapshot); one unit in two places, a counter behind a living unit, one item uid twice, too many rounds do not; serialize -> text ->
//    parse -> validate -> restoreRun into a FRESH game -> a world: identities, poses, plugs, rounds and stacks are the saved ones, the
//    inventory's uid counter is above every chest's stacks; a load over a live game replaces what the train carries;
//  - RETRY (Game.retryLevel's order: teardown, the station's memories, the participants, the build): the car and the station are
//    exactly as they were at the entry — a unit crafted since is gone, a chest carried out / in / died with is back in its place with
//    its entry contents, the rounds loaded since are back in the pockets; twice gives the same;
//  - the live system as TrainEquipment.live: restore() is idempotent, the train's records win a uid clash with a station unit, a chest
//    in the hands is replaced; the unit counter is never behind a living unit (a new unit never takes a living unit's id).
// No kind is named here: the kinds come from the registry by their traits (a hopper, a store, a plug).
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SectionKey} from '../src/levels/types';
import {
  EQUIPMENT, EQUIPMENT_KINDS, STATION_EQUIPMENT_LANE as LANE, equipmentRounds, stationEquipmentProblem, trainEquipmentProblem,
  type EquipmentJSON, type EquipmentKind, type StationEquipmentJSON,
} from '../src/craft/equipment';
import type {ItemStack, StackJSON} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIPMENT_TEXT, type LiveUnit, type TrainEquipmentSystem} from '../src/world/trainEquipment';
import {run, teardown} from './helpers/fuelCartsHost';
import {
  aboardRec, buildWorld, equipStation, localOf, platformWorld, plugSpot, putLocal, stand, stationRec, type EquipTestHost,
} from './helpers/trainEquipmentHost';
import {Harness, fillInventory, fillLockbox, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

// the kinds by their traits (the registry at run time)
// (HOPPER: the kind fed from its own slots — its rounds are real stacks of AMMO there; a save from before the slots has a count)
const HOPPER = EQUIPMENT_KINDS.find(k => EQUIPMENT[k].slotItem !== null)!;
const STORE = EQUIPMENT_KINDS.find(k => EQUIPMENT[k].slots > 0 && EQUIPMENT[k].slotItem === null)!;
const PLUGS = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].plug && EQUIPMENT[k].slots === 0);
const PLAIN = PLUGS[0], OTHER = PLUGS[PLUGS.length - 1];
const AMMO = EQUIPMENT[HOPPER].slotItem!, CAP = EQUIPMENT[HOPPER].legacyAmmoCap, FEED = EQUIPMENT[HOPPER].slots;
const STACK = itemDef(AMMO).stackMax;

const HERE: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const ELSEWHERE: SectionKey = {level: 'subway', section: 'main', station: sid(2)};
const memId = (k: SectionKey) => `${k.station}:${k.section}`;

/** The save fixtures' harness standing at st-01 (a Subway station), st-02 visited before. */
function harness(): Harness {
  const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1), sid(2)]}));
  hs.run.current = {...HERE};
  hs.run.memory().visits = 1;
  hs.run.memory(ELSEWHERE).visits = 1;
  return hs;
}

/** The equipment system on a generated station over the harness's run, inventory and train record (not built yet). */
function game(hs = harness()) {
  const s = equipStation(SUBWAY(), {record: hs.train, run: hs.run, inv: hs.inv, build: false});
  live.push(s.rt);
  return {...s, hs};
}
type G = ReturnType<typeof game>;

const plain = (s: ItemStack): StackJSON => JSON.parse(JSON.stringify(s)) as StackJSON;
const uids = (xs: readonly {uid: string}[]) => xs.map(x => x.uid);
const laneOf = (hs: Harness, key: SectionKey = hs.run.current) => hs.run.laneStore<StationEquipmentJSON>(LANE, key);

/** A store's slots with real stacks (uids from the run's inventory): rounds, a weapon with rounds in it, a backpack with things in it. */
function filled(hs: Harness, tag: number): (StackJSON | null)[] {
  const inv = hs.inv, out = new Array<StackJSON | null>(EQUIPMENT[STORE].slots).fill(null);
  const bag = inv.makeStack('backpack', 1);
  bag.bag![0] = inv.makeStack('bandage', 2);
  bag.bag![3] = inv.makeStack('ammo_9mm', 40 + tag);
  out[0] = plain(inv.makeStack(AMMO, 60 + tag));
  out[7] = plain(inv.makeStack('pistol', 1, 5));
  out[21] = plain(bag);
  out[out.length - 1] = plain(inv.makeStack('beans', 1 + (tag % 2)));
  return out;
}

/** A feed's slots holding `n` rounds as real stacks (uids from the run's inventory), full stacks first. */
function feed(hs: Harness, n: number): (StackJSON | null)[] {
  const out = new Array<StackJSON | null>(FEED).fill(null);
  for (let i = 0; i < FEED && n > 0; i++) { out[i] = plain(hs.inv.makeStack(AMMO, Math.min(n, STACK))); n -= out[i]!.count; }
  expect(n).toBe(0);
  return out;
}

/** Every item uid in a list of unit records (bag contents too). */
function stackUids(recs: readonly EquipmentJSON[]): number[] {
  const out: number[] = [];
  for (const r of recs) for (const s of r.slots ?? []) if (s) { out.push(s.uid); for (const c of s.bag ?? []) if (c) out.push(c.uid); }
  return out;
}

/** A station record on the platform beside the car, at train-local (lx, lz). */
function platformRec(h: EquipTestHost, kind: EquipmentKind, n: number, lx: number, lz: number, yaw = 0, extra: Partial<EquipmentJSON> = {}): EquipmentJSON {
  const w = platformWorld(h, lx, lz);
  return stationRec(kind, n, Math.round(w.x * 1e4) / 1e4, Math.round(w.y * 1e4) / 1e4, Math.round(w.z * 1e4) / 1e4, yaw, h.trainPlacement!.level, extra);
}

/** A live world unit onto the platform at train-local (lx, lz) (a test's hand). */
function toPlatform(h: EquipTestHost, u: LiveUnit, lx: number, lz: number, yaw = 0): void {
  const w = platformWorld(h, lx, lz), b = u.body;
  b.x = w.x; b.y = w.y; b.z = w.z; b.vx = b.vz = 0; b.yaw = yaw; b.level = h.trainPlacement!.level;
  u.awake = false; u.plugCheck = true;
}

/** Every live unit exactly once across the train's records and the station's. */
function onceEach(eq: TrainEquipmentSystem): void {
  const all = uids(eq.all()).sort();
  expect([...uids(eq.aboard()), ...uids(eq.stationRecords())].sort()).toEqual(all);
  expect(new Set(all).size).toBe(all.length);
}

/**
 * The world of the whole file: st-02 holds a filled store and a loaded hopper left there earlier; st-01 (here) a filled store and a
 * plug kind on the platform; the car a filled store, a loaded hopper on plug 0, a plug kind on plug 1 and one unplugged. Counter 8.
 */
function populated(o: {carry?: boolean} = {}) {
  const g = game(), {h, hs} = g;
  if (o.carry) { fillInventory(hs); fillLockbox(hs, 2); }
  const far = [stationRec(STORE, 1, 14.5, 0.125, 6.25, 0.5, 0, {slots: filled(hs, 1)}), stationRec(HOPPER, 2, 20, 0.125, 6, -1, 0, {slots: feed(hs, 7)})];
  hs.run.setLaneStore(LANE, {v: 1, here: far}, ELSEWHERE);
  const here = [platformRec(h, STORE, 3, 1, -3, 0.3, {slots: filled(hs, 2)}), platformRec(h, PLAIN, 4, -2, -3.3, 2)];
  hs.run.setLaneStore(LANE, {v: 1, here});
  const s0 = plugSpot(0), s1 = plugSpot(1);
  const aboard = [
    aboardRec(STORE, 5, 1, 0.2, 0.6, {slots: filled(hs, 3)}),
    aboardRec(HOPPER, 6, s0.x, s0.z, 0, {slots: feed(hs, 222), plug: 0}),
    aboardRec(PLAIN, 7, s1.x, s1.z, 1.2, {plug: 1}),
    aboardRec(OTHER, 8, 3.4, 0.2, -0.4),
  ];
  hs.train.equipment.load({v: 1, seq: 8, aboard});
  buildWorld(h, SUBWAY());
  run(h, 0.3);
  return {...g, far, here, aboard};
}

/** Game.retryLevel's order on the harness: the world goes, the station's memories and the carry state of the entry, the build. */
function retry(g: G): void {
  const {h, hs} = g, snap = hs.run.entry!;
  const key: SectionKey = {level: snap.level, section: snap.section, station: snap.station};
  teardown(h); // Game.leaveSection(false)
  hs.run.restoreScopeMemories(key, snap.memories);
  const inv = restoreCarry(snap, {player: hs.player, survival: hs.survival, battery: hs.battery, stats: hs.stats});
  hs.inv.loadJSON(inv.toJSON()); // Game.installInventory
  restoreParticipants(snap, hs.participants);
  hs.inv.reserveUids(hs.train.lockbox.maxUid());
  hs.inv.reserveUids(hs.train.equipment.maxUid());
  h.player.alive = true;
  h.state = 'playing';
  buildWorld(h, SUBWAY());
  run(h, 0.3);
}

describe('train equipment: the station lane', () => {
  it('units left in the station go to its lane at the teardown and stand there again at the next build: pose, storey, rounds, stacks', () => {
    const {h, eq, hs} = game();
    const slots = filled(hs, 0), rounds = feed(hs, 123), s0 = plugSpot(0);
    hs.train.equipment.load({v: 1, seq: 3, aboard: [aboardRec(HOPPER, 1, -2.2, 0.3, 0.4, {slots: rounds}), aboardRec(STORE, 2, 1, 0.2, -1.1, {slots}), aboardRec(PLAIN, 3, s0.x, s0.z)]});
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    expect(uids(eq.aboard())).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(laneOf(hs)).toBeUndefined();
    // rolled / carried out onto the platform
    toPlatform(h, eq.unit('eq-1')!, 2, -3, 0.7);
    toPlatform(h, eq.unit('eq-2')!, -1.5, -3.4, -2.2);
    run(h, 0.2);
    const here = eq.stationRecords();
    expect(uids(here)).toEqual(['eq-1', 'eq-2']);
    expect(here[0]).toMatchObject({kind: HOPPER, slots: rounds, yaw: 0.7, level: h.trainPlacement!.level});
    expect(equipmentRounds(here[0])).toBe(123);
    expect(here[0].ammo).toBeUndefined(); // (the rounds are the stacks: no count beside them)
    expect(here[0].plug).toBeUndefined();
    expect(here[1]).toMatchObject({kind: STORE, yaw: -2.2, level: h.trainPlacement!.level});
    expect(here[1].slots).toEqual(slots);
    expect(stationEquipmentProblem({v: 1, here})).toBeNull();
    onceEach(eq);
    // (the lane is the station's record of a world that is gone: nothing is written while it is live)
    expect(laneOf(hs)).toBeUndefined();
    teardown(h);
    expect(laneOf(hs)).toEqual({v: 1, here});
    expect(eq.units().length).toBe(0);
    expect(uids(hs.train.equipment.records())).toEqual(['eq-3']);
    // the next build of this station
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    expect(uids(eq.units())).toEqual(['eq-1', 'eq-2', 'eq-3']);
    const a = eq.unit('eq-1')!, b = eq.unit('eq-2')!;
    expect([a.mode, a.ammo, a.plug, a.body.level]).toEqual(['world', 123, null, here[0].level]);
    expect(a.slots!.map(s => s && plain(s))).toEqual(rounds);
    expect([a.body.x, a.body.y, a.body.z, a.body.yaw]).toEqual([here[0].x, here[0].y, here[0].z, here[0].yaw].map(v => expect.closeTo(v, 3)));
    expect([b.body.x, b.body.y, b.body.z, b.body.yaw]).toEqual([here[1].x, here[1].y, here[1].z, here[1].yaw].map(v => expect.closeTo(v, 3)));
    expect(b.slots!.map(s => s && plain(s))).toEqual(slots);
    expect(eq.stationRecords()).toEqual(here); // (written twice, the same record)
    expect(eq.all().map(x => [x.uid, x.owner])).toEqual([['eq-1', 'station'], ['eq-2', 'station'], ['eq-3', 'train']]);
    expect(eq.unit('eq-3')!.plug).toBe(0);
    // the inventory never hands out a uid a chest's stack has
    expect(hs.inv.makeStack('beans', 1).uid).toBeGreaterThan(Math.max(...stackUids(here)));
    teardown(h);
    expect(laneOf(hs)).toEqual({v: 1, here});
  });

  it('flush() writes the live station\'s lane without a teardown; an emptied station clears it; every station keeps its own list', () => {
    const {h, eq, hs} = game();
    const far = [stationRec(STORE, 1, 12, 0.125, 3, 0.5, 0, {slots: filled(hs, 1)})];
    hs.run.setLaneStore(LANE, {v: 1, here: far}, ELSEWHERE);
    hs.run.setLaneStore(LANE, {v: 1, here: [platformRec(h, HOPPER, 2, 1, -3, 0.3, {slots: feed(hs, 9)})]});
    hs.train.equipment.load({v: 1, seq: 4, aboard: [aboardRec(PLAIN, 3, -2.2, 0.3), aboardRec(STORE, 4, 1, 0.2)]});
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    expect(uids(eq.units())).toEqual(['eq-2', 'eq-3', 'eq-4']); // (never another station's unit)
    const before = structuredClone(laneOf(hs));
    // one carried out, the station's one rolled in
    toPlatform(h, eq.unit('eq-4')!, -2, -3.2);
    putLocal(h, eq.unit('eq-2')!, 3.4, 0.2);
    run(h, 0.2);
    expect(laneOf(hs)).toEqual(before);
    const units = [...eq.units()];
    eq.flush();
    expect(laneOf(hs)).toEqual({v: 1, here: eq.stationRecords()});
    expect(uids(laneOf(hs)!.here)).toEqual(['eq-4']);
    expect(uids(hs.train.equipment.records())).toEqual(['eq-2', 'eq-3']);
    expect(equipmentRounds(hs.train.equipment.records().find(r => r.uid === 'eq-2')!)).toBe(9);
    // (the world stays live: the same unit objects, nothing rebuilt)
    expect(eq.worldLive).toBe(true);
    expect(eq.units().every((u, i) => u === units[i])).toBe(true);
    eq.flush();
    expect(uids(laneOf(hs)!.here)).toEqual(['eq-4']);
    // everything aboard: the lane is gone (no empty list kept)
    putLocal(h, eq.unit('eq-4')!, 1, 0.2);
    run(h, 0.2);
    eq.flush();
    expect(laneOf(hs)).toBeUndefined();
    expect(uids(hs.train.equipment.records())).toEqual(['eq-2', 'eq-3', 'eq-4']);
    expect(laneOf(hs, ELSEWHERE)).toEqual({v: 1, here: far});
    // without a world there is nothing to write (the lane a teardown wrote stays)
    toPlatform(h, eq.unit('eq-3')!, 0.5, -3.1);
    run(h, 0.2);
    teardown(h);
    const kept = structuredClone(laneOf(hs));
    expect(uids(kept!.here)).toEqual(['eq-3']);
    eq.flush();
    expect(laneOf(hs)).toEqual(kept);
    expect(laneOf(hs, ELSEWHERE)).toEqual({v: 1, here: far});
  });

  it('a lane that names a unit the train carries, or one the car now parks over, is put right at the build (never one unit in two places)', () => {
    const {h, eq, hs} = game();
    // the lane still lists eq-1 (a save from before it was rolled aboard) and holds eq-2 lying where the car stands
    const p = h.trainPlacement!, inCar = platformRec(h, STORE, 2, 0, 0);
    Object.assign(inCar, {x: Math.round((p.x - p.front * 3.4) * 1e4) / 1e4, y: p.floorY, z: Math.round((p.z + p.front * 0.2) * 1e4) / 1e4});
    hs.run.setLaneStore(LANE, {v: 1, here: [platformRec(h, HOPPER, 1, 1, -3, 0, {slots: feed(hs, 5)}), inCar, platformRec(h, PLAIN, 3, -2, -3.2)]});
    hs.train.equipment.load({v: 1, seq: 3, aboard: [aboardRec(HOPPER, 1, -2.2, 0.3, 0, {slots: feed(hs, 80)})]});
    buildWorld(h, SUBWAY());
    run(h, 0.2);
    expect(uids(eq.units())).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(eq.unit('eq-1')!.ammo).toBe(80); // the train's record is the truth
    expect(eq.all().map(x => x.owner)).toEqual(['train', 'train', 'station']);
    expect(uids(laneOf(hs)!.here)).toEqual(['eq-3']); // written again at once
    onceEach(eq);
    const file = hs.file('arrival', 1);
    const ok = validateSaveFile(structuredClone(file));
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
  });
});

describe('train equipment: the save file', () => {
  it('a filled chest aboard AND filled chests left in two stations validate (the run and its Retry snapshot); impossible states do not', () => {
    const {h, eq, hs, far, here, aboard} = populated({carry: true});
    expect(eq.aboard()).toEqual(aboard);
    expect(eq.stationRecords()).toEqual(here);
    expect([eq.unit('eq-6')!.plug, eq.unit('eq-7')!.plug, eq.unit('eq-8')!.plug]).toEqual([0, 1, null]);
    expect(h.toasts).toEqual([]); // (a record's unit finds its plug again without a note)
    hs.takeEntry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const part = (f: typeof base) => f.run.participants['player-train'].equipment;
    const lane = (f: typeof base, k = HERE) => f.run.memories[memId(k)].lanes[LANE];
    expect(part(base)).toEqual({v: 1, seq: 8, aboard});
    expect(trainEquipmentProblem(part(base))).toBeNull();
    expect(lane(base)).toEqual({v: 1, here});
    expect(lane(base, ELSEWHERE)).toEqual({v: 1, here: far});
    // the Retry snapshot is its own world with the same units
    expect(base.run.entry.lanes['player-train'].equipment).toEqual(part(base));
    expect(base.run.entry.memories[memId(HERE)].lanes[LANE]).toEqual(lane(base));
    // every item in any chest or feed has its own uid, apart from everything carried and in the Lockbox
    const inChests = stackUids([...aboard, ...here, ...far]);
    expect(new Set(inChests).size).toBe(inChests.length);
    expect(inChests.length).toBe(3 * 6 + Math.ceil(222 / STACK) + 1); // (three chests of six; the feeds' 222 and 7 rounds)
    const carried = new Set([...base.run.carry.inventory.pack, ...base.run.carry.inventory.hotbar].filter(Boolean).map((x: StackJSON) => x.uid));
    expect(inChests.filter(u => carried.has(u))).toEqual([]);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    // one unit, one place
    refuse(f => { lane(f).here[0].uid = 'eq-5'; }, /equipment unit eq-5 is in two places/); // lying in this station AND aboard
    refuse(f => { lane(f, ELSEWHERE).here[0].uid = 'eq-3'; }, /equipment unit eq-3 is in two places/); // in two stations
    refuse(f => { part(f).aboard[1].uid = 'eq-5'; }, /duplicate equipment unit eq-5/);
    refuse(f => { f.run.entry.memories[memId(HERE)].lanes[LANE].here[1].uid = 'eq-7'; }, /equipment unit eq-7 is in two places/); // (the snapshot's own scope)
    // the counter is never behind a living unit — aboard, here, or left in another station
    refuse(f => { part(f).seq = 7; }, /eq-8 is newer than the train's counter/);
    refuse(f => { part(f).aboard = []; part(f).seq = 3; }, /eq-4 is newer than the train's counter/);
    refuse(f => { part(f).aboard = []; part(f).seq = 1; lane(f).here = []; }, /eq-2 is newer than the train's counter/);
    refuse(f => { f.run.entry.lanes['player-train'].equipment.seq = 5; }, /newer than the train's counter/);
    // one item, one uid: a chest's stack against another chest's, the pockets', a bag's contents
    refuse(f => { lane(f).here[0].slots[0].uid = part(f).aboard[0].slots[0].uid; }, /duplicate item uid/);
    refuse(f => { lane(f, ELSEWHERE).here[0].slots[7].uid = lane(f).here[0].slots[7].uid; }, /duplicate item uid/);
    refuse(f => { part(f).aboard[0].slots[0].uid = f.run.carry.inventory.pack[0].uid; }, /duplicate item uid/);
    refuse(f => { part(f).aboard[0].slots[21].bag[3].uid = part(f).aboard[0].slots[0].uid; }, /duplicate item uid/);
    // never a free round, slot or plug
    refuse(f => { part(f).aboard[1].ammo = CAP + 1; }, /ammo .* out of range/); // (an older save's count beside the slots: in its old range only)
    refuse(f => { lane(f, ELSEWHERE).here[1].ammo = -1; }, /ammo .* out of range/);
    refuse(f => { part(f).aboard[2].ammo = 1; }, /unexpected .* field 'ammo'/); // (a kind that never had a hopper)
    refuse(f => { part(f).aboard[0].ammo = 1; }, /unexpected .* field 'ammo'/);
    // a feed holds its one item, in legal stacks with their own uids, in exactly its slots
    refuse(f => { part(f).aboard[1].slots[0].itemId = 'ammo_9mm'; }, /slots take only/);
    refuse(f => { lane(f, ELSEWHERE).here[1].slots[0].itemId = 'beans'; }, /slots take only/);
    refuse(f => { part(f).aboard[1].slots[1].count = STACK + 1; }, /./);
    refuse(f => { part(f).aboard[1].slots.push(null); }, /needs its \d+ slots/);
    refuse(f => { part(f).aboard[1].slots.pop(); }, /needs its \d+ slots/);
    refuse(f => { delete part(f).aboard[1].slots; }, /needs its \d+ slots/);
    refuse(f => { part(f).aboard[1].slots[1].uid = part(f).aboard[1].slots[0].uid; }, /duplicate item uid/);
    refuse(f => { part(f).aboard[1].slots[0].uid = part(f).aboard[0].slots[0].uid; }, /duplicate item uid/);
    refuse(f => { part(f).aboard[1].slots[0].uid = f.run.carry.inventory.pack[0].uid; }, /duplicate item uid/);
    refuse(f => { part(f).aboard[0].slots.push(null); }, /needs its \d+ slots/);
    refuse(f => { part(f).aboard[2].plug = 0; }, /two units on train plug 0/);
    refuse(f => { lane(f).here[1].plug = 2; }, /unexpected .* field 'plug'/); // (a station unit is never plugged)
    refuse(f => { part(f).aboard[0].slots[0].count = 9999; }, /./);
    refuse(f => { part(f).aboard[0].slots[0].itemId = 'no_such_item'; }, /unknown item/);
    // an older save without any equipment: still valid, and loads none
    const old = structuredClone(base);
    delete old.run.participants['player-train'].equipment;
    delete old.run.entry.lanes['player-train'].equipment;
    for (const m of [old.run.memories, old.run.entry.memories]) for (const k of Object.keys(m)) delete m[k].lanes[LANE];
    old.checksum = checksumOf(old.run);
    expect(validateSaveFile(old).ok).toBe(true);
  });

  it('serialize -> text -> parse -> validate -> restore into a fresh game -> a world: identities, poses, plugs, rounds, stacks', () => {
    const {h, eq, hs, far, here, aboard} = populated({carry: true});
    // played on a little before the save: rounds fired, a stack taken out of the chest aboard, one unit rolled to the platform
    const chest = eq.unit('eq-5')!, hopper = eq.unit('eq-6')!;
    expect(hopper.takeAmmo(42)).toBe(42);
    expect(hopper.ammo).toBe(180);
    const taken = chest.slots![0]!;
    chest.slots![0] = null;
    chest.slots![1] = hs.inv.makeStack('bandage', 3);
    chest.touchStore();
    toPlatform(h, eq.unit('eq-8')!, 3, -3.5, 1);
    run(h, 0.2);
    eq.flush(); // (Game writes the live station before a save taken without a teardown)
    const aboard1 = eq.aboard(), here1 = eq.stationRecords();
    expect(uids(aboard1)).toEqual(['eq-5', 'eq-6', 'eq-7']);
    expect(uids(here1)).toEqual(['eq-3', 'eq-4', 'eq-8']);
    // (fired from the last stack: the same stacks, the same uids, 42 rounds fewer)
    expect(aboard1[1]).toEqual({...aboard[1], slots: [aboard[1].slots![0], {...aboard[1].slots![1]!, count: 222 - STACK - 42}, ...aboard[1].slots!.slice(2)]});
    expect(equipmentRounds(aboard1[1])).toBe(180);
    expect(aboard1[0].slots![0]).toBeNull();
    expect(aboard1[0].slots![1]).toMatchObject({itemId: 'bandage', count: 3});
    expect(here1.slice(0, 2)).toEqual(here);
    hs.takeEntry();
    const text = saveFileText(hs.file('arrival', 2));
    const parsed = parseSaveText(text);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;

    // A FRESH GAME (another page): nothing but the file
    const hs2 = new Harness(fixtureCampaign());
    const res = restoreRun(parsed.value.run, hs2.target());
    expect(res.failed).toEqual([]);
    expect(hs2.run.current).toMatchObject(HERE);
    // between worlds the record keeps the saved units exactly
    expect(hs2.train.equipment.toJSON()).toEqual({v: 1, seq: 8, aboard: aboard1});
    expect(laneOf(hs2)).toEqual({v: 1, here: here1});
    expect(laneOf(hs2, ELSEWHERE)).toEqual({v: 1, here: far});
    // the new inventory's counter is above every stack in any chest (aboard, here, left elsewhere)
    const top = Math.max(...stackUids([...aboard1, ...here1, ...far]), taken.uid);
    expect(hs2.inv.makeStack('beans', 1).uid).toBeGreaterThan(top);
    // the world over it
    const g2 = game(hs2);
    buildWorld(g2.h, SUBWAY());
    run(g2.h, 0.3);
    expect(g2.eq.aboard()).toEqual(aboard1);
    expect(g2.eq.stationRecords()).toEqual(here1);
    expect(uids(g2.eq.units())).toEqual(['eq-3', 'eq-4', 'eq-5', 'eq-6', 'eq-7', 'eq-8']); // (never st-02's units)
    expect(g2.eq.units().map(u => [u.mode, u.plug, u.ammo])).toEqual([
      ['world', null, 0], ['world', null, 0], ['world', null, 0], ['world', 0, 180], ['world', 1, 0], ['world', null, 0],
    ]);
    expect(g2.h.toasts).toEqual([]);
    expect(g2.eq.active(HOPPER)?.uid).toBe('eq-6');
    expect(g2.eq.plugged(PLAIN)?.uid).toBe('eq-7');
    // a chest's stacks are live stacks again, with their uids (the weapon's rounds, the bag's contents)
    const c2 = g2.eq.unit('eq-5')!;
    expect(c2.slots!.map(s => s && plain(s))).toEqual(aboard1[0].slots);
    expect(c2.slots![7]).toMatchObject({itemId: 'pistol', mag: 5});
    expect(c2.slots![21]!.bag![3]).toMatchObject({itemId: 'ammo_9mm', count: 43});
    expect(g2.eq.storesAboard().map(s => s.uid)).toEqual(['eq-5']); // (a feed is never a crafting source)
    // the feed's stacks are live stacks again too, with their uids
    expect(g2.eq.unit('eq-6')!.slots!.map(s => s && plain(s))).toEqual(aboard1[1].slots);
    onceEach(g2.eq);
    // the next unit takes the next number
    expect(g2.eq.craft(PLAIN)!.uid).toBe('eq-9');
    // and the file of THAT game is the same game again (nothing drifts through a round trip)
    const again = new Harness(fixtureCampaign());
    const f2 = parseSaveText(saveFileText(hs2.file('arrival', 2)));
    expect(f2.ok).toBe(true);
    if (!f2.ok) return;
    restoreRun(f2.value.run, again.target());
    expect(again.train.equipment.toJSON().aboard.slice(0, 3)).toEqual(aboard1);
    expect(again.train.equipment.seq).toBe(9);
    expect(laneOf(again)).toEqual({v: 1, here: here1});
  });

  it('a load over a live game: the world goes, the file\'s units come (aboard and in the station), whatever happened since', () => {
    const g = populated(), {h, eq, hs, here, aboard} = g;
    const file = parseSaveText(saveFileText(hs.file('arrival', 1)));
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    // since the save: a unit crafted, rounds loaded, units swapped between the car and the platform, a chest in the hands
    expect(eq.craft(OTHER)!.uid).toBe('eq-9');
    const more = hs.inv.makeStack(AMMO, 100);
    eq.unit('eq-6')!.slots![FEED - 1] = more;
    eq.unit('eq-6')!.touchStore();
    expect(eq.unit('eq-6')!.ammo).toBe(322);
    toPlatform(h, eq.unit('eq-7')!, 2.5, -3.4);
    putLocal(h, eq.unit('eq-4')!, 3.4, -0.4);
    run(h, 0.2);
    expect(eq.pickUp(eq.unit('eq-5')!)).toBe(true);
    expect(eq.held?.uid).toBe('eq-5');
    // Game's load: the old world torn down, the restore installed, the new world built
    teardown(h);
    const res = restoreRun(file.value.run, hs.target());
    expect(res.failed).toEqual([]);
    h.run = hs.run; // (Game.setRun)
    expect(eq.held).toBeNull(); // the hands are empty: the chest is where the file has it
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    expect(eq.aboard()).toEqual(aboard);
    expect(eq.stationRecords()).toEqual(here);
    expect(hs.train.equipment.seq).toBe(8);
    expect(eq.unit('eq-9')).toBeNull();
    expect(eq.unit('eq-6')!.ammo).toBe(222);
    expect([eq.unit('eq-6')!.plug, eq.unit('eq-7')!.plug]).toEqual([0, 1]);
    onceEach(eq);
    expect(eq.craft(OTHER)!.uid).toBe('eq-9');
  });
});

describe('train equipment: Retry', () => {
  it('Retry puts the car and the station back exactly as they were at the entry — crafted, loaded, carried, died with: all undone', () => {
    const g = populated(), {h, eq, hs, here, aboard, far} = g;
    hs.inv.add(hs.inv.makeStack(AMMO, 50));
    hs.takeEntry();
    const inv0 = JSON.stringify(hs.inv.toJSON());
    const play = () => {
      // a unit crafted
      const made = eq.craft(PLAIN)!;
      expect(made.uid).toBe('eq-9');
      // 50 rounds from the pockets into the feed (the store view's quick move), 30 fired
      const hopper = eq.unit('eq-6')!;
      expect(hs.inv.count(AMMO)).toBe(50);
      const from = hs.inv.find(hs.inv.allStacks(false).find(s => s.itemId === AMMO)!.uid)!;
      expect(hs.inv.storeQuick(hopper.slots!, from)).toBe(50);
      hopper.touchStore();
      expect([hs.inv.count(AMMO), hopper.ammo]).toEqual([0, 272]);
      expect(hopper.takeAmmo(30)).toBe(30);
      // a stack out of the chest aboard into the pockets
      const chest = eq.unit('eq-5')!, st = chest.slots![7]!;
      chest.slots![7] = null;
      chest.touchStore();
      hs.inv.add(st);
      // the hopper rolled out to the platform (unplugged), the station's chest carried into the car
      toPlatform(h, hopper, 2.6, -3.4);
      putLocal(h, eq.unit('eq-3')!, 3.4, -0.4);
      run(h, 0.3);
      expect(eq.all().filter(x => x.owner === 'station').map(x => x.uid)).toEqual(['eq-4', 'eq-6']);
      expect(uids(eq.aboard())).toEqual(['eq-3', 'eq-5', 'eq-7', 'eq-8', 'eq-9']);
      // the chest aboard picked up and carried out onto the platform; the carrier dies there
      const pw = platformWorld(h, -0.5, -3.2);
      expect(eq.pickUp(chest)).toBe(true);
      stand(h, pw.x, pw.z, 0, pw.y);
      run(h, 0.1);
      h.player.alive = false;
      h.state = 'dead';
      for (const f of h.stateListeners) f('dead' as never, 'playing' as never);
      expect(eq.held).toBeNull();
      expect(chest.mode).toBe('world');
      expect(Math.hypot(chest.body.x - pw.x, chest.body.z - pw.z)).toBeLessThan(1.4); // at the feet
      expect(eq.all().find(x => x.uid === 'eq-5')!.owner).toBe('station');
      onceEach(eq);
    };
    for (let round = 0; round < 2; round++) {
      play();
      retry(g);
      expect(eq.aboard(), `round ${round}`).toEqual(aboard);
      expect(eq.stationRecords(), `round ${round}`).toEqual(here);
      expect(laneOf(hs)).toEqual({v: 1, here});
      expect(laneOf(hs, ELSEWHERE)).toEqual({v: 1, here: far}); // (another station is never touched)
      expect(hs.train.equipment.seq).toBe(8);
      expect(eq.unit('eq-9')).toBeNull();
      expect(eq.held).toBeNull();
      expect(uids(eq.units())).toEqual(['eq-3', 'eq-4', 'eq-5', 'eq-6', 'eq-7', 'eq-8']);
      expect([eq.unit('eq-6')!.ammo, eq.unit('eq-6')!.plug, eq.unit('eq-7')!.plug]).toEqual([222, 0, 1]);
      expect(JSON.stringify(hs.inv.toJSON())).toBe(inv0); // the rounds and the stack are where they were
      expect(hs.inv.count(AMMO)).toBe(50);
      expect(eq.unit('eq-5')!.slots![7]).toMatchObject({itemId: 'pistol', mag: 5});
      onceEach(eq);
      // nothing exists twice: every item uid in the chests is not in the pockets
      const carried = new Set(hs.inv.allStacks(false).map(s => s.uid));
      expect(stackUids([...eq.aboard(), ...eq.stationRecords()]).filter(u => carried.has(u))).toEqual([]);
      expect(hs.inv.invariants()).toEqual([]);
      // and the inventory's counter is above all of them
      expect(hs.inv.makeStack('beans', 1).uid).toBeGreaterThan(Math.max(...stackUids([...aboard, ...here])));
    }
    // the save of the retried game is valid
    const ok = validateSaveFile(structuredClone(hs.file('arrival', 1)));
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
  });

  it('the entry snapshot of a chest in the hands (arrived carrying it): Retry stands it in the car at the recorded spot', () => {
    const g = populated(), {h, eq, hs, aboard} = g;
    const chest = eq.unit('eq-5')!;
    const at = localOf(h, eq.unit('eq-8')!);
    stand(h, h.player.x, h.player.z, 0);
    expect(eq.pickUp(chest)).toBe(true);
    run(h, 0.1);
    // in the hands it is the train's, recorded at the carrier's place in the car (clamped into the interior)
    const rec = eq.aboard().find(r => r.uid === 'eq-5')!;
    expect(rec.slots).toEqual(aboard[0].slots);
    expect(Math.abs(rec.z)).toBeLessThanOrEqual(1.3 - EQUIPMENT[STORE].radius);
    hs.takeEntry();
    const ok = validateSaveFile(structuredClone(hs.file('arrival', 1)));
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    // carried off and put down far away; then Retry
    const pw = platformWorld(h, -0.5, -4.1);
    stand(h, pw.x, pw.z, 0, pw.y);
    run(h, 0.1);
    expect(eq.putDown()).toBe(true);
    expect(eq.all().find(x => x.uid === 'eq-5')!.owner).toBe('station');
    retry(g);
    const back = eq.unit('eq-5')!;
    expect(eq.held).toBeNull();
    expect(back.mode).toBe('world');
    expect(eq.all().find(x => x.uid === 'eq-5')!.owner).toBe('train');
    const q = localOf(h, back);
    expect(Math.hypot(q.x - rec.x, q.z - rec.z)).toBeLessThan(1.2); // (nudged off anything standing on the recorded spot)
    expect(back.slots!.map(s => s && plain(s))).toEqual(aboard[0].slots);
    expect(uids(eq.aboard())).toEqual(uids(aboard));
    expect(localOf(h, eq.unit('eq-8')!)).toMatchObject({x: expect.closeTo(at.x, 3), z: expect.closeTo(at.z, 3)});
    onceEach(eq);
  });
});

describe('train equipment: the live system as the record\'s truth (TrainEquipment.live)', () => {
  it('restore() is idempotent; the train\'s records win a uid clash with a station unit; a chest in the hands is replaced', () => {
    const g = populated(), {h, eq, hs, here, aboard} = g;
    const before = eq.units().map(u => u.uid);
    // the same records again: the same state (new unit objects, nothing doubled, no note)
    hs.train.equipment.load({v: 1, seq: 8, aboard});
    run(h, 0.2);
    hs.train.equipment.load({v: 1, seq: 8, aboard});
    run(h, 0.2);
    expect(eq.units().map(u => u.uid)).toEqual(before);
    expect(eq.aboard()).toEqual(aboard);
    expect(eq.stationRecords()).toEqual(here);
    expect(h.toasts).toEqual([]);
    onceEach(eq);
    // eq-5 carried out to the platform (the station's now), eq-6 in the hands... is not a carry kind: the chest eq-3 is
    toPlatform(h, eq.unit('eq-5')!, 2.8, -3.6);
    run(h, 0.2);
    expect(eq.all().find(x => x.uid === 'eq-5')!.owner).toBe('station');
    expect(eq.pickUp(eq.unit('eq-3')!)).toBe(true);
    // an older record that still has eq-5 aboard and knows eq-3 as the train's too
    const older = [...aboard, aboardRec(STORE, 3, -3.6, -0.4, 0, {slots: here[0].slots})].sort((a, b) => Number(a.uid.slice(3)) - Number(b.uid.slice(3)));
    hs.train.equipment.load({v: 1, seq: 8, aboard: older});
    run(h, 0.2);
    expect(eq.held).toBeNull();
    expect(uids(eq.units())).toEqual(['eq-3', 'eq-4', 'eq-5', 'eq-6', 'eq-7', 'eq-8']); // each once
    expect(eq.aboard()).toEqual(older);
    expect(uids(eq.stationRecords())).toEqual(['eq-4']);
    onceEach(eq);
    // New Game (TrainEquipment.reset): nothing aboard, the counter at 0; the station's units are the station's
    hs.train.equipment.reset();
    run(h, 0.2);
    expect(eq.aboard()).toEqual([]);
    expect(uids(eq.units())).toEqual(['eq-4']);
    expect(hs.train.equipment.toJSON()).toEqual({v: 1, seq: 4, aboard: []}); // (never behind the unit still standing here)
  });

  it('the unit counter is never behind a living unit: a new unit never takes the id of one aboard, here, or in the hands', () => {
    const {h, eq, hs} = game();
    // (a hand-made state no valid save has: the lane holds a unit newer than the counter)
    hs.run.setLaneStore(LANE, {v: 1, here: [platformRec(h, PLAIN, 9, 1, -3)]});
    hs.train.equipment.load({v: 1, seq: 2, aboard: [aboardRec(STORE, 2, 1, 0.2)]});
    expect(hs.train.equipment.seq).toBe(2);
    buildWorld(h, SUBWAY());
    run(h, 0.2);
    expect(hs.train.equipment.seq).toBe(9);
    expect(eq.craft(PLAIN)!.uid).toBe('eq-10');
    expect(eq.craft(STORE)!.uid).toBe('eq-11');
    expect(new Set(uids(eq.units())).size).toBe(4);
    // through a teardown and a build the counter stays
    teardown(h);
    expect(hs.train.equipment.toJSON().seq).toBe(11);
    buildWorld(h, SUBWAY());
    run(h, 0.2);
    expect(eq.craft(PLAIN)!.uid).toBe('eq-12');
    // a refused craft takes no number
    void h.trainRide!.depart();
    run(h, 0.2);
    expect(eq.craftBlock(PLAIN)).toBe(EQUIPMENT_TEXT.moving);
    expect(eq.craft(PLAIN)).toBeNull();
    expect(hs.train.equipment.seq).toBe(12);
    h.trainRide!.reset();
  });
});

describe('train equipment: an older save\'s round counter becomes real stacks (nothing lost, nothing free)', () => {
  /** The record as an older build wrote it: a count of rounds and no slots. */
  const old = (rec: EquipmentJSON, ammo: number): EquipmentJSON => {
    const r: EquipmentJSON = {...rec, ammo};
    delete r.slots;
    return r;
  };
  const shape = (u: LiveUnit) => u.slots!.map(s => s && [s.itemId, s.count]);
  const full = (n: number) => Array.from({length: FEED}, (_, i) => (n - i * STACK > 0 ? [AMMO, Math.min(STACK, n - i * STACK)] : null));
  /** The inventory without its uid counter (a stack made since moves only the counter). */
  const pockets = (hs: Harness) => JSON.stringify({...hs.inv.toJSON(), nextUid: 0});

  /**
   * An older save's game, no world built yet: a full hopper left at st-02, one with 7 rounds on the platform here, one with 222 on
   * plug 0 aboard beside a filled chest. Counter 4.
   */
  function legacy(o: {carry?: boolean} = {}) {
    const g = game(), {h, hs} = g;
    if (o.carry) { fillInventory(hs); fillLockbox(hs, 2); }
    const s0 = plugSpot(0);
    const far = [old(stationRec(HOPPER, 1, 20, 0.125, 6, -1, 0), CAP)];
    hs.run.setLaneStore(LANE, {v: 1, here: far}, ELSEWHERE);
    const here = [old(platformRec(h, HOPPER, 2, 1, -3, 0.3), 7)];
    hs.run.setLaneStore(LANE, {v: 1, here});
    const aboard = [aboardRec(STORE, 3, 1, 0.2, 0.6, {slots: filled(hs, 3)}), old(aboardRec(HOPPER, 4, s0.x, s0.z, 0, {plug: 0}), 222)];
    hs.train.equipment.load({v: 1, seq: 4, aboard});
    return {...g, far, here, aboard};
  }

  it('the old form is a valid save and stays as written between worlds; the first played frame makes the rounds stacks with new uids', () => {
    const {h, eq, hs, far, here, aboard} = legacy({carry: true});
    expect(FEED * STACK).toBeGreaterThanOrEqual(CAP); // (every round an older hopper could hold has a place)
    hs.takeEntry();
    const ok0 = validateSaveFile(structuredClone(hs.file('arrival', 1)));
    expect(ok0.ok, ok0.ok ? '' : ok0.error).toBe(true);
    expect(hs.train.equipment.toJSON()).toEqual({v: 1, seq: 4, aboard});
    expect([aboard[1], here[0], far[0]].map(equipmentRounds)).toEqual([222, 7, CAP]);
    const carried = hs.inv.count(AMMO), carry0 = pockets(hs), top0 = hs.inv.makeStack('beans', 1).uid;
    // the world built, no frame played: the units hold exactly the counts, and a save taken now still has them (once, never also as stacks)
    buildWorld(h, SUBWAY());
    const u = eq.unit('eq-4')!, p = eq.unit('eq-2')!;
    expect([u.ammo, p.ammo]).toEqual([222, 7]);
    expect([...u.slots!, ...p.slots!].every(s => s === null)).toBe(true);
    expect(eq.aboard()[1]).toEqual({...aboard[1], slots: new Array(FEED).fill(null)});
    expect(eq.stationRecords()[0]).toEqual({...here[0], slots: new Array(FEED).fill(null)});
    expect([eq.aboard()[1], eq.stationRecords()[0]].map(equipmentRounds)).toEqual([222, 7]);
    const mid = validateSaveFile(structuredClone(hs.file('arrival', 1)));
    expect(mid.ok, mid.ok ? '' : mid.error).toBe(true);
    expect(eq.counts.adopted).toBe(0);
    // the first played frame
    run(h, 1 / 60);
    expect(eq.counts.adopted).toBe(229);
    expect([u.ammo, p.ammo]).toEqual([222, 7]);
    expect(shape(u)).toEqual(full(222));
    expect(shape(p)).toEqual(full(7));
    const rec = eq.aboard()[1];
    expect(rec.ammo).toBeUndefined();
    expect(rec).toEqual({...old(aboard[1], 0), ammo: undefined, slots: u.slots!.map(s => s && plain(s))});
    expect(eq.stationRecords()[0].ammo).toBeUndefined();
    expect([rec, eq.stationRecords()[0]].map(equipmentRounds)).toEqual([222, 7]);
    // new uids: above everything there was, each its own; the inventory goes on above them; nothing reached the pockets
    const made = [...u.slots!, ...p.slots!].filter(s => s !== null).map(s => s.uid);
    expect(made).toHaveLength(Math.ceil(222 / STACK) + 1);
    expect(new Set(made).size).toBe(made.length);
    expect(Math.min(...made)).toBeGreaterThan(top0);
    expect(hs.inv.makeStack('beans', 1).uid).toBeGreaterThan(Math.max(...made));
    expect([hs.inv.count(AMMO), pockets(hs)]).toEqual([carried, carry0]);
    // the unit is the same unit: its number, its plug, its place; nothing is said
    expect([u.uid, u.plug, eq.active(HOPPER)?.uid]).toEqual(['eq-4', 0, 'eq-4']);
    expect(h.toasts).toEqual([]);
    // once only: more frames, a ride's capture and release change nothing
    run(h, 0.3);
    eq.captureCargo();
    eq.releaseCargo();
    run(h, 0.1);
    expect(eq.counts.adopted).toBe(229);
    expect(eq.aboard()[1]).toEqual(rec);
    // the save of the migrated game is valid (its Retry snapshot still has the old form); the station never visited keeps its count
    eq.flush();
    const f1 = hs.file('arrival', 1);
    const ok1 = validateSaveFile(structuredClone(f1));
    expect(ok1.ok, ok1.ok ? '' : ok1.error).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (reading the untyped file)
    const run1 = f1.run as any;
    expect(run1.participants['player-train'].equipment.aboard[1]).toEqual(rec);
    expect(run1.entry.lanes['player-train'].equipment.aboard[1]).toEqual(aboard[1]);
    expect(laneOf(hs, ELSEWHERE)).toEqual({v: 1, here: far});
    onceEach(eq);
  });

  it('a count beside part-filled slots (a hand-made record): topped up in place, the rest stays a count and is used first', () => {
    const {h, eq, hs} = game();
    const slots = feed(hs, 2 * STACK + 100);
    slots[FEED - 1] = plain(hs.inv.makeStack(AMMO, STACK));
    hs.train.equipment.load({v: 1, seq: 1, aboard: [aboardRec(HOPPER, 1, -2.2, 0.3, 0, {slots, ammo: 50})]});
    buildWorld(h, SUBWAY());
    run(h, 0.1);
    const u = eq.unit('eq-1')!;
    expect(u.ammo).toBe(3 * STACK + 150);
    expect(shape(u)).toEqual(full(FEED * STACK)); // the 20 that fit
    expect(u.slots!.map(s => s!.uid)).toEqual(slots.map(s => s!.uid)); // (no new stack)
    expect(eq.counts.adopted).toBe(20);
    expect(eq.aboard()[0].ammo).toBe(30);
    expect(equipmentRounds(eq.aboard()[0])).toBe(3 * STACK + 150);
    expect(trainEquipmentProblem(hs.train.equipment.toJSON())).toBeNull();
    // fired: the count first, and the room it leaves is never refilled from nowhere
    expect(u.takeAmmo(30)).toBe(30);
    expect(eq.aboard()[0].ammo).toBeUndefined();
    expect(u.takeAmmo(5)).toBe(5);
    run(h, 0.1);
    expect(u.ammo).toBe(FEED * STACK - 5);
    expect(eq.counts.adopted).toBe(20);
  });

  it('exported and imported: file -> text -> a fresh game -> a world keeps every round; saved again it is the slot form and loads the same', () => {
    const {hs, far, here, aboard} = legacy({carry: true});
    hs.takeEntry();
    const parsed = parseSaveText(saveFileText(hs.file('arrival', 1)));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const hs2 = new Harness(fixtureCampaign());
    expect(restoreRun(parsed.value.run, hs2.target()).failed).toEqual([]);
    // between worlds: the old records exactly
    expect(hs2.train.equipment.toJSON()).toEqual({v: 1, seq: 4, aboard});
    expect(laneOf(hs2)).toEqual({v: 1, here});
    const carried = hs2.inv.count(AMMO), carry0 = pockets(hs2);
    const g2 = game(hs2);
    buildWorld(g2.h, SUBWAY());
    run(g2.h, 0.3);
    expect(g2.eq.units().map(u => [u.uid, u.ammo, u.plug])).toEqual([['eq-2', 7, null], ['eq-3', 0, null], ['eq-4', 222, 0]]);
    expect(shape(g2.eq.unit('eq-4')!)).toEqual(full(222));
    expect(g2.eq.counts.adopted).toBe(229);
    expect([hs2.inv.count(AMMO), pockets(hs2)]).toEqual([carried, carry0]);
    expect(g2.eq.craft(PLAIN)!.uid).toBe('eq-5'); // (the counter was never moved by it)
    // saved again: valid, the slot form, one uid per stack against everything carried, in the Lockbox and in the chest
    g2.eq.flush();
    hs2.takeEntry();
    const f2 = hs2.file('arrival', 2);
    const ok2 = validateSaveFile(structuredClone(f2));
    expect(ok2.ok, ok2.ok ? '' : ok2.error).toBe(true);
    const aboard2 = g2.eq.aboard(), here2 = g2.eq.stationRecords();
    expect(aboard2.concat(here2).filter(r => r.kind === HOPPER).map(r => [r.uid, r.ammo, equipmentRounds(r)])).toEqual([['eq-4', undefined, 222], ['eq-2', undefined, 7]]);
    // and that file in another fresh game: the same stacks with the same uids, nothing adopted twice
    const again = parseSaveText(saveFileText(f2));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const hs3 = new Harness(fixtureCampaign());
    expect(restoreRun(again.value.run, hs3.target()).failed).toEqual([]);
    const g3 = game(hs3);
    buildWorld(g3.h, SUBWAY());
    run(g3.h, 0.3);
    expect(g3.eq.counts.adopted).toBe(0);
    expect(g3.eq.aboard()).toEqual(aboard2);
    expect(g3.eq.stationRecords()).toEqual(here2);
    expect(hs3.inv.makeStack('beans', 1).uid).toBeGreaterThan(Math.max(...stackUids([...aboard2, ...here2])));
    expect(hs3.inv.count(AMMO)).toBe(carried);
    // the station nobody went back to still has its full old hopper, to the round
    expect(laneOf(hs3, ELSEWHERE)).toEqual({v: 1, here: far});
    expect(equipmentRounds(laneOf(hs3, ELSEWHERE)!.here[0])).toBe(CAP);
  });

  it('Retry to an entry taken in the old form: the count comes back and becomes stacks again — the same rounds, the pockets as they were', () => {
    const g = legacy(), {h, eq, hs, far} = g;
    hs.inv.add(hs.inv.makeStack(AMMO, 50));
    hs.takeEntry(); // (the arrival of an older save: the snapshot has the count)
    const carry0 = pockets(hs);
    buildWorld(h, SUBWAY());
    run(h, 0.3);
    for (let round = 0; round < 2; round++) {
      const u = eq.unit('eq-4')!, p = eq.unit('eq-2')!;
      expect([u.ammo, p.ammo, hs.inv.count(AMMO)], `round ${round}`).toEqual([222, 7, 50]);
      expect(shape(u)).toEqual(full(222));
      // a migrated stack taken into the pockets, rounds fired, the other unit emptied by hand
      expect(hs.inv.storeQuick(u.slots!, {bar: 'store', index: 1})).toBe(222 - STACK);
      u.touchStore();
      expect(u.takeAmmo(20)).toBe(20);
      expect(hs.inv.storeQuick(p.slots!, {bar: 'store', index: 0})).toBe(7);
      p.touchStore();
      expect([u.ammo, p.ammo, hs.inv.count(AMMO)]).toEqual([STACK - 20, 0, 50 + 222 - STACK + 7]);
      run(h, 0.2);
      retry(g);
      const u2 = eq.unit('eq-4')!, p2 = eq.unit('eq-2')!;
      expect([u2.ammo, p2.ammo, hs.inv.count(AMMO)], `round ${round}`).toEqual([222, 7, 50]);
      expect(shape(u2)).toEqual(full(222));
      expect(u2.plug).toBe(0);
      expect(pockets(hs)).toBe(carry0);
      expect(hs.inv.invariants()).toEqual([]);
      // nothing exists twice
      const carried = new Set(hs.inv.allStacks(false).map(s => s.uid));
      const stored = stackUids([...eq.aboard(), ...eq.stationRecords()]);
      expect(stored.filter(x => carried.has(x))).toEqual([]);
      expect(new Set(stored).size).toBe(stored.length);
      expect(hs.inv.makeStack('beans', 1).uid).toBeGreaterThan(Math.max(...stored));
      expect(laneOf(hs, ELSEWHERE)).toEqual({v: 1, here: far});
      eq.flush();
      const ok = validateSaveFile(structuredClone(hs.file('arrival', 1)));
      expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    }
  });

  it('a count out of the old range is no free ammunition: the record is refused, and what loads is no equipment', () => {
    const bad = {v: 1, seq: 1, aboard: [old(aboardRec(HOPPER, 1, -2.2, 0.3), CAP + 1)]};
    expect(trainEquipmentProblem(bad)).toMatch(/ammo .* out of range/);
    expect(trainEquipmentProblem({v: 1, seq: 1, aboard: [old(aboardRec(HOPPER, 1, -2.2, 0.3), 1.5)]})).toMatch(/ammo .* out of range/);
    expect(trainEquipmentProblem({v: 1, seq: 1, aboard: [old(aboardRec(HOPPER, 1, -2.2, 0.3), CAP)]})).toBeNull();
    expect(trainEquipmentProblem({v: 1, seq: 1, aboard: [old(aboardRec(HOPPER, 1, -2.2, 0.3), 0)]})).toBeNull();
    const {h, eq, hs} = game();
    hs.train.equipment.load(bad as never);
    buildWorld(h, SUBWAY());
    run(h, 0.2);
    expect(eq.units()).toEqual([]);
    expect(eq.counts.adopted).toBe(0);
  });
});
