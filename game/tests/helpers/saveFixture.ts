// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): shared fixtures of the save tests — a valid 40-station
// network, a populated campaign run on a small Game-like harness (real RunState / Inventory / Survival / PlayerTrainRecord +
// Lockbox / InjurySystem participants), realistic station memories, and a fake Storage with a UTF-16 quota. Node only.

import {Inventory, type ItemStack, type StackJSON} from '../../src/items/inventory';
import {ITEMS, type ItemDef} from '../../src/items/items';
import {WEAPONS} from '../../src/weapons/weapons';
import {GEAR_SLOTS, isBagItem, isFilterMask} from '../../src/items/gear';
import {mulberry32} from '../../src/core/rng';
import {createRun, type RunState} from '../../src/run/runState';
import type {CampaignState, NetworkLine, StationNode, SubwayNetwork} from '../../src/campaign/types';
import type {LevelId, SectionKey} from '../../src/levels/types';
import {PlayerTrainRecord} from '../../src/run/playerTrain';
import {InjurySystem} from '../../src/player/injuries';
import {Survival} from '../../src/player/survival';
import {takeSnapshot, type RunParticipant} from '../../src/run/snapshot';
import {holderKey, type HolderRecord, type PickupRecord} from '../../src/run/memory';
import {stackRecord} from '../../src/run/worldMemory';
import {BAG_LANE} from '../../src/run/bagStore';
import {captureRun, deriveMeta, makeSaveFile, type RunFactory, type RunSource, type RunTarget, type SaveFileV1Like, type SavePoint, type TrainLocalPose} from '../../src/save/serialize';
import type {SaveStorage} from '../../src/save/slots';

export const LEVELS_STUB = {subway: {sections: () => ['main']}, office: {sections: () => ['main']}, mall: {sections: () => ['main']}, reactor: {sections: () => ['main']}} as Record<LevelId, {sections(s: number): string[]}>;
export const SEEDS = {subway: 11, office: 22, mall: 33, reactor: 44};

const PREFIX = ['Calder', 'Wexford', 'Harrow', 'Bellmere', 'Ashgrove', 'Kingsway', 'Marlow', 'Tidewater'];
const SUFFIX = ['Park', 'Street', 'Junction', 'Cross', 'Gardens'];

/** Archetypes of st-00 .. st-39: 31 Subway (incl. the start), 4 Office, 4 Mall, 1 Reactor. */
export function archetypeOf(i: number): LevelId {
  if (i === 39) return 'reactor';
  if ([5, 12, 20, 28].includes(i)) return 'office';
  if ([8, 16, 24, 33].includes(i)) return 'mall';
  return 'subway';
}

export const sid = (i: number): string => `st-${String(i).padStart(2, '0')}`;

/** A valid connected 40-node network: red st-00..st-19, blue st-19..st-39, green st-10..st-25 (interchanges). */
export function fixtureNetwork(count = 40): SubwayNetwork {
  const r = mulberry32(99);
  const red = Array.from({length: 20}, (_, i) => sid(i)), blue = Array.from({length: count - 19}, (_, i) => sid(i + 19));
  const lines: NetworkLine[] = [
    {id: 'red', name: 'Red Line', color: '#b3262e', stations: red},
    {id: 'blue', name: 'Blue Line', color: '#2a5db0', stations: blue},
    {id: 'green', name: 'Green Line', color: '#2f8f4e', stations: [sid(10), sid(25)]},
  ];
  const nodes: StationNode[] = Array.from({length: count}, (_, i) => ({
    id: sid(i), name: `${PREFIX[i % 8]} ${SUFFIX[Math.floor(i / 8) % 5]}`, archetype: archetypeOf(i), levelSeed: (Math.imul(i + 1, 2654435761) >>> 0),
    x: Math.round(r() * 1e6) / 1e4, y: Math.round(r() * 1e6) / 1e4, lines: lines.filter(l => l.stations.includes(sid(i))).map(l => l.id),
  }));
  const pairs = new Set<string>();
  for (const l of lines) for (let i = 1; i < l.stations.length; i++) { const [a, b] = [l.stations[i - 1], l.stations[i]].sort(); pairs.add(`${a} ${b}`); }
  const edges = [...pairs].sort().map(p => p.split(' ') as [string, string]);
  return {v: 1, seed: 424242, nodes, edges, lines, start: sid(0), reactor: sid(count - 1)};
}

export function fixtureCampaign(o: Partial<CampaignState> = {}): CampaignState {
  const network = fixtureNetwork();
  return {v: 1, network, current: sid(0), known: [sid(0), sid(1)], visited: [sid(0)], cheat: false, won: null, transit: null, ...o};
}

const items = (pred: (d: ItemDef) => boolean): ItemDef[] => Object.values(ITEMS).filter(pred);
/** Ordinary (non-bag, non-gear) items. */
export const LOOSE = items(d => !d.gear);

/** A legal live stack of an item (random count / magazine / filter). */
export function stackOf(inv: Inventory, def: ItemDef, r: () => number): ItemStack {
  const st = inv.makeStack(def.id, 1);
  st.count = 1 + Math.floor(r() * def.stackMax);
  if (def.kind === 'weapon') st.mag = Math.floor(r() * (WEAPONS[def.weaponId!].magazine + 1));
  if (isFilterMask(def.id)) st.filter = Math.round(r() * 150 * 1000) / 1000;
  return st;
}

/** A backpack with every slot filled. */
export function fullBag(inv: Inventory, r: () => number): ItemStack {
  const bag = inv.makeStack('backpack', 1);
  bag.bag = bag.bag!.map(() => stackOf(inv, LOOSE[Math.floor(r() * LOOSE.length)], r));
  return bag;
}

const gearFor = (slot: string): string => Object.values(ITEMS).find(d => d.gear?.slot === slot && (slot !== 'chest' || d.id === 'chest_rig'))!.id;

/** A Game-like harness: the live objects a capture reads / a restore writes. */
export class Harness {
  run: RunState;
  inv = new Inventory();
  readonly player = {hp: 73.5, stamina: 61.25, damageTaken: 26.5, alive: true};
  readonly survival = new Survival();
  readonly battery = {charge: 0.4375, on: true, died: false};
  readonly train = new PlayerTrainRecord();
  readonly injuries = new InjurySystem(() => 0.5);
  mask = {on: false};
  readonly participants: RunParticipant[];
  stats: Record<string, number> = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
  clock = 0;
  batteryResets: number[] = [];

  constructor(campaign: CampaignState | null = fixtureCampaign()) {
    const cur = campaign?.network.nodes.find(n => n.id === campaign.current);
    this.run = createRun({seeds: SEEDS, start: cur ? {level: cur.archetype, section: 'main', station: cur.id} : {level: 'subway', section: 'main'}, levels: LEVELS_STUB, campaign});
    this.participants = [
      {id: 'injuries', save: () => this.injuries.snapshot(), load: d => this.injuries.restore(d as never), reset: () => this.injuries.reset()},
      {id: 'gear', save: () => null, load: () => {}, reset: () => {}},
      this.train.participant(),
      {id: 'gas.mask', save: () => ({v: 1, on: this.mask.on}), load: d => { this.mask = {on: !!(d as {on?: unknown} | null)?.on}; }, reset: () => { this.mask = {on: false}; }},
    ];
  }

  source(point: SavePoint, pose: TrainLocalPose = {x: 1.25, z: -0.15, yaw: 0.5, pitch: -0.1, crouched: false}): RunSource {
    return {run: this.run, inv: this.inv, player: this.player, survival: this.survival, battery: this.battery, participants: this.participants,
      stats: this.stats, clock: this.clock, pose, point};
  }

  readonly makeRun: RunFactory = o => createRun({seeds: o.seeds, start: o.start, levels: LEVELS_STUB, campaign: o.campaign});

  target(): RunTarget & {makeRun: RunFactory} {
    return {
      makeRun: this.makeRun,
      setRun: run => { this.run = run; },
      installInventory: inv => this.inv.loadJSON(inv.toJSON()),
      reserveUids: max => { this.inv.reserveUids(max); this.inv.reserveUids(this.train.lockbox.maxUid()); },
      player: this.player, survival: this.survival, battery: this.battery,
      resetBattery: c => { this.batteryResets.push(c); this.battery.charge = c; this.battery.on = c > 0; this.battery.died = c <= 0; },
      participants: this.participants, stats: this.stats,
      setClock: t => { this.clock = t; },
    };
  }

  /** The Retry snapshot of the current station (as Game.levelEntrySnapshot takes it). */
  takeEntry(): void {
    const k = this.run.current;
    this.run.entry = takeSnapshot({level: k.level, section: k.section, station: k.station, arrival: this.run.arrival},
      {inv: this.inv, player: this.player, survival: this.survival, battery: this.battery, participants: this.participants, stats: this.stats}, this.run.scopeMemories(k));
  }

  /** A save envelope of the current state. */
  file(point: SavePoint = 'arrival', slot = 1, pose?: TrainLocalPose): SaveFileV1Like {
    const run = captureRun(this.source(point, pose));
    return makeSaveFile(run, deriveMeta(run, {slot, revision: 0, savedAt: '2026-11-02T23:30:00.000Z', reason: point}));
  }
}

/** A full carried inventory: every quick slot, the 16 pockets (chest rig), every gear slot (a full backpack, a gas mask), flare, knife. */
export function fillInventory(h: Harness, seed = 7): void {
  const r = mulberry32(seed), inv = h.inv;
  for (const slot of GEAR_SLOTS) {
    const id = gearFor(slot);
    const st = isBagItem(id) ? fullBag(inv, r) : inv.makeStack(id, 1);
    if (isFilterMask(id)) st.filter = 88.25;
    inv.gearSlots[GEAR_SLOTS.indexOf(slot)] = st;
  }
  inv.pack.length = 0;
  for (let i = 0; i < inv.capacity; i++) inv.pack.push(stackOf(inv, LOOSE[(i * 5 + 3) % LOOSE.length], r));
  const hot = ['rifle', 'pistol', 'shotgun', 'medkit', 'water'];
  hot.forEach((id, i) => { inv.hotbar[i] = stackOf(inv, ITEMS[id], r); });
  inv.throwSlot[0] = inv.makeStack('flare', 3);
  inv.meleeSlot[0] = inv.makeStack('knife', 1);
}

/** A full 40-slot Lockbox: `bags` backpacks with every slot filled, the rest assorted stacks. Uids come from the inventory. */
export function fillLockbox(h: Harness, bags = 8, seed = 8): void {
  const r = mulberry32(seed);
  for (let i = 0; i < h.train.lockbox.slots.length; i++) {
    h.train.lockbox.slots[i] = i < bags ? fullBag(h.inv, r) : stackOf(h.inv, LOOSE[Math.floor(r() * LOOSE.length)], r);
  }
}

export interface PopulateOptions {
  /** Holder keys (captureHolders keys of the layout); default: `holders` synthetic ones. */
  holderKeys?: string[];
  holders?: number;
  /** Generated pickups still lying there (layoutIndex), dropped / spilled ones (fromLot for half). */
  layoutPickups?: number;
  dropped?: number;
  zombies?: number;
  /** Grounded backpacks (full). */
  bags?: number;
  lanes?: Record<string, unknown>;
  seed?: number;
}

const f = (r: () => number, s: number): number => (r() * 2 - 1) * s;

/** A realistic remembered station: holders (lots, flags, compartments seen), loose items with full-precision poses, kills, bags. */
export function populateStation(h: Harness, key: SectionKey, o: PopulateOptions = {}): void {
  const r = mulberry32(o.seed ?? 1), mem = h.run.memory(key);
  mem.visits = 1 + Math.floor(r() * 3);
  const keys = o.holderKeys ?? Array.from({length: o.holders ?? 40}, (_, i) => holderKey(['shelf', 'cabinetTall', 'crate', 'desk', 'stockShelf'][i % 5], 0, f(r, 60), f(r, 20)));
  for (const k of keys) {
    const rec: HolderRecord = {lots: Array.from({length: Math.floor(r() * 6)}, (_, j) => j * 2 + Math.floor(r() * 2)), open: r() < 0.6, searched: r() < 0.5};
    if (r() < 0.2) rec.seen = Array.from({length: 2 + Math.floor(r() * 3)}, () => r() < 0.5);
    mem.holders[k] = rec;
  }
  const pickups: PickupRecord[] = [];
  const rec = (layoutIndex?: number, lot?: boolean): PickupRecord => {
    const p: PickupRecord = {
      stack: stackRecord(stackOf(h.inv, LOOSE[Math.floor(r() * LOOSE.length)], r)),
      pose: {p: [f(r, 60), 0.2 + r() * 3, f(r, 20)], q: [f(r, 0.3), f(r, 0.9), f(r, 0.3), 0.3 + r() * 0.7]},
      anchor: [f(r, 60), 0.2 + r() * 3, f(r, 20)],
    };
    if (layoutIndex !== undefined) p.layoutIndex = layoutIndex;
    if (lot) p.fromLot = {holder: Math.floor(r() * 200), lot: Math.floor(r() * 12)};
    return p;
  };
  for (let i = 0; i < (o.layoutPickups ?? 10); i++) if (r() < 0.8) pickups.push(rec(i));
  for (let i = 0; i < (o.dropped ?? 12); i++) pickups.push(rec(undefined, i % 2 === 0));
  mem.pickups = pickups;
  const z = o.zombies ?? 25;
  mem.killed = Array.from({length: z}, (_, i) => i).filter(() => r() < 0.85);
  mem.cleared = mem.killed.length === z;
  const bags = Array.from({length: o.bags ?? 1}, (_, i) => {
    const st = fullBag(h.inv, r);
    return {id: i === 0 ? `bag:${st.uid}` : `found:${i}`, stack: stackToPlain(st), x: f(r, 60), y: r() * 3, z: f(r, 20), yaw: f(r, 3.14), level: 0};
  });
  if (bags.length) mem.lanes[BAG_LANE] = {v: 1, seed: h.run.seedFor(key), init: true, bags};
  mem.lanes.siren = {awake: [1, 4]};
  for (const [lane, d] of Object.entries(o.lanes ?? {})) mem.lanes[lane] = structuredClone(d);
}

const stackToPlain = (s: ItemStack): StackJSON => JSON.parse(JSON.stringify(s)) as StackJSON;

/** Every item instance in a run's state (itemId -> total count): carry, Lockbox, every memory's loose items and grounded bags. */
export function itemCensus(h: Harness): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (s: {itemId: string; count: number; bag?: unknown} | null | undefined): void => {
    if (!s) return;
    out[s.itemId] = (out[s.itemId] ?? 0) + s.count;
    for (const c of (s.bag ?? []) as ({itemId: string; count: number} | null)[]) add(c);
  };
  h.inv.allStacks(false).forEach(add);
  h.train.lockbox.slots.forEach(add);
  for (const m of Object.values(h.run.exportMemories())) {
    for (const p of m.pickups ?? []) add(p.stack);
    const bags = (m.lanes[BAG_LANE] as {bags?: {stack: StackJSON}[]} | undefined)?.bags ?? [];
    for (const b of bags) add(b.stack);
  }
  return out;
}

/** A fake Web Storage with a quota in UTF-16 code units of keys + values (QuotaExceededError like Chrome; the old value kept). */
export class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  disabled = false;
  writes = 0;
  constructor(public quota = 5 * 1024 * 1024) {}
  get length(): number { this.guard(); return this.map.size; }
  key(i: number): string | null { this.guard(); return [...this.map.keys()][i] ?? null; }
  used(): number { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
  private guard(): void { if (this.disabled) throw new DOMException('The operation is insecure.', 'SecurityError'); }
  getItem(k: string): string | null { this.guard(); return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void {
    this.guard();
    const old = this.map.get(k);
    const next = this.used() - (old === undefined ? 0 : k.length + old.length) + k.length + v.length;
    if (next > this.quota) throw new DOMException(`Setting the value of '${k}' exceeded the quota.`, 'QuotaExceededError');
    this.map.set(k, String(v));
    this.writes++;
  }
  removeItem(k: string): void { this.guard(); this.map.delete(k); }
}
