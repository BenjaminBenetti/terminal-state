// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): the SERIALIZED RUN — the exact shape of SaveFileV1.run
// (campaign/types.ts), and capture / restore between it and the live run (run/runState.ts, run/snapshot.ts carry, participants).
//
// Saves are written ONLY at train transitions (the primary's orchestrator calls Game.captureSave): DEPARTURE (the departing
// station's world already torn down, so every station delta is flushed into run memory; campaign.transit set), ARRIVAL (the train
// stopped at the new station; transit null) and NEW GAME (the start station). The player is always inside the player train, so the
// pose is TRAIN-LOCAL.
//
// SerializedRunV1 (plain JSON data; never three.js objects / closures / DOM / audio):
//   v: 1
//   point: 'departure' | 'arrival' | 'new-game' | 'ending'   the transition this save was taken at ('ending': lane CREDITS' Main Menu)
//   campaign: CampaignState                             deep copy (network, current, known, visited, cheat, won, transit)
//   seeds: Record<LevelId, number>                      the run's archetype seeds (RunState.seeds; the legacy fallback)
//   section: string                                     run.current.section ('main'; the station is campaign.current)
//   arrival: 'start' | 'return'                         run.arrival.kind
//   entered: LevelId[]                                  run.entered (QA log; the last ENTERED_KEEP entries)
//   playtime: number                                    run.playtime (s)
//   clock: number                                       Game clock (s): reactor / window timestamps are relative to it
//   memories: Record<sectionId, MemoryV1>               run.exportMemories(): EVERY remembered section (all visited stations)
//   entry: EntryV1 | null                               run.entry — the Retry snapshot (inventory as InventoryJSON)
//   carry: {inventory: InventoryJSON (v3, nextUid), vitals {hp, stamina, damageTaken}, survival {hunger, thirst, time},
//           battery {charge, on, died}}
//   participants: Record<id, unknown>                   RunParticipant.save() per id ('player-train' = train record + 40-slot
//                                                       Lockbox with nested items; 'injuries'; 'gear'; 'gas.mask'; …)
//   stats: Record<string, number>                       Game.stats
//   player: {trainLocal: {x, z, yaw, pitch, crouched}}  the player's pose in the parked / moving train's local frame
//
// MemoryV1 is a SectionMemory (run/memory.ts) with its two big lists COMPACTED (a station has 250–600 loot holders; the full
// verbose records of 40 stations would not fit three slots in localStorage):
//   {visits, pickups: PickupTupleV1[] | null, holders: Record<holderKey, HolderTupleV1>, killed, cleared, lanes}
//   PickupTupleV1 = [stack, px, py, pz, qx, qy, qz, qw, ax, ay, az]            (11: a dropped / spilled item, no layout index)
//                 | [...11, layoutIndex]                                    (12: what is left of a generated pickup)
//                 | [...11, layoutIndex | -1, fromLot.holder, fromLot.lot]  (14: a lot that left its holder)
//     positions / anchors rounded to 0.1 mm, quaternions to 1e-6 (sub-visual; decode(encode(x)) is idempotent).
//   HolderTupleV1 = [flags, ...lots] (flags: 1 open, 2 searched) | [flags | 4, seen.length, seenMask, ...lots] (openables)
// Lane stores (`lanes`) stay opaque JSON (GEAR's bags, the Reactor record, office windows, sirens …) and are copied exactly.
// Untouched stations have no memory at all: they regenerate from their node seed (they cost nothing).
//
// Unique ids: the inventory keeps nextUid (InventoryJSON); restoring reserves every uid found anywhere in the save (Lockbox,
// grounded bags, bag contents of loose pickups, the Retry inventory) so a later stack never reuses one. Nothing is duplicated:
// each item exists exactly where it was saved (carry / Lockbox / a station's memory), and nothing heals or refills.
// Pure (no three.js / DOM).

import type {CampaignState, SaveMeta, StationId} from '../campaign/types';
import type {Arrival, ArrivalKind, LevelId, SectionKey} from '../levels/types';
import {Inventory, type InventoryJSON} from '../items/inventory';
import type {HolderRecord, PickupRecord, SectionMemory, StackRecord} from '../run/memory';
import type {LevelSeeds, RunState} from '../run/runState';
import type {BatterySnapshot, RunParticipant, RunSnapshot, SurvivalSnapshot, VitalsSnapshot} from '../run/snapshot';
import {checksumOf} from './checksum';

export const SERIALIZED_RUN_V = 1 as const;
export const SAVE_FORMAT = 'terminal-state-save' as const;
/** run.entered entries kept (a QA log; everything else is kept whole). */
export const ENTERED_KEEP = 64;

/**
 * The transition a save was taken at (SaveMeta.reason adds 'import'). Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01
 * (lane CREDITS): + 'ending' — the Reactor credits' "Main Menu" saves the run before it returns to the menu (Game.commitEndingSave; no
 * journey: transit null; the pose is the parked train's spawn point). Older saves (the first three points) load unchanged.
 */
export type SavePoint = 'departure' | 'arrival' | 'new-game' | 'ending';
export type SaveReason = SavePoint | 'import';
export const SAVE_POINTS: readonly SavePoint[] = ['departure', 'arrival', 'new-game', 'ending'];
export const SAVE_REASONS: readonly SaveReason[] = [...SAVE_POINTS, 'import'];

/** The player's pose in the player train's local frame (gen/playerTrain.ts worldToTrain; yaw relative to the car's yaw). */
export interface TrainLocalPose { x: number; z: number; yaw: number; pitch: number; crouched: boolean }

/** A loose item (PickupRecord) as a compact tuple (see the header). */
export type PickupTupleV1 = [StackRecord, ...number[]];
/** A holder record (HolderRecord) as a compact tuple (see the header). */
export type HolderTupleV1 = number[];

export interface MemoryV1 {
  visits: number;
  pickups: PickupTupleV1[] | null;
  holders: Record<string, HolderTupleV1>;
  killed: number[];
  cleared: boolean;
  lanes: Record<string, unknown>;
}

export interface CarryV1 {
  inventory: InventoryJSON;
  vitals: VitalsSnapshot;
  survival: SurvivalSnapshot;
  battery: BatterySnapshot;
}

/** The Retry snapshot (RunSnapshot with its live Inventory as InventoryJSON and its memories compacted). */
export interface EntryV1 {
  level: LevelId;
  section: string;
  station?: StationId;
  arrival: Arrival;
  vitals: VitalsSnapshot;
  survival: SurvivalSnapshot;
  battery: BatterySnapshot;
  inventory: InventoryJSON;
  lanes: Record<string, unknown>;
  memories: Record<string, MemoryV1>;
  stats: Record<string, number>;
}

export interface SerializedRunV1 {
  v: 1;
  point: SavePoint;
  campaign: CampaignState;
  seeds: LevelSeeds;
  section: string;
  arrival: ArrivalKind;
  entered: LevelId[];
  playtime: number;
  clock: number;
  memories: Record<string, MemoryV1>;
  entry: EntryV1 | null;
  carry: CarryV1;
  participants: Record<string, unknown>;
  stats: Record<string, number>;
  player: {trainLocal: TrainLocalPose};
}

/** A capture that cannot produce a trustworthy save (nothing is written). */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** The game build that writes a save: the package version + Vite's mode ('production' / 'development'; vitest: 'test'). */
export const SAVE_BUILD: string = (() => {
  const env = (import.meta as unknown as {env?: Record<string, unknown>}).env;
  const mode = typeof env?.MODE === 'string' ? env.MODE : 'web';
  return `terminal-state 0.0.0 (${mode})`;
})();

// --- compact memory codec ----------------------------------------------------------------------------------------------------

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function encodePickup(p: PickupRecord): PickupTupleV1 {
  const [px, py, pz] = p.pose.p, [qx, qy, qz, qw] = p.pose.q, [ax, ay, az] = p.anchor;
  const t: PickupTupleV1 = [jsonSafe(p.stack, 'pickup.stack') as StackRecord, r4(px), r4(py), r4(pz), r6(qx), r6(qy), r6(qz), r6(qw), r4(ax), r4(ay), r4(az)];
  if (p.fromLot) t.push(p.layoutIndex ?? -1, p.fromLot.holder, p.fromLot.lot);
  else if (p.layoutIndex !== undefined) t.push(p.layoutIndex);
  return t;
}

export function decodePickup(t: PickupTupleV1): PickupRecord {
  const n = t as unknown as [StackRecord, number, number, number, number, number, number, number, number, number, number, number?, number?, number?];
  const rec: PickupRecord = {stack: structuredClone(n[0]), pose: {p: [n[1], n[2], n[3]], q: [n[4], n[5], n[6], n[7]]}, anchor: [n[8], n[9], n[10]]};
  if (t.length >= 12 && (n[11] as number) >= 0) rec.layoutIndex = n[11];
  if (t.length >= 14) rec.fromLot = {holder: n[12] as number, lot: n[13] as number};
  return rec;
}

export function encodeHolder(h: HolderRecord): HolderTupleV1 {
  const f = (h.open ? 1 : 0) | (h.searched ? 2 : 0);
  if (!h.seen) return [f, ...h.lots];
  let mask = 0;
  h.seen.forEach((v, i) => { if (v) mask |= 1 << i; });
  return [f | 4, h.seen.length, mask, ...h.lots];
}

export function decodeHolder(t: HolderTupleV1): HolderRecord {
  const f = t[0];
  if (f & 4) {
    const len = t[1], mask = t[2];
    return {lots: t.slice(3), open: !!(f & 1), searched: !!(f & 2), seen: Array.from({length: len}, (_, i) => !!((mask >>> i) & 1))};
  }
  return {lots: t.slice(1), open: !!(f & 1), searched: !!(f & 2)};
}

export function encodeMemory(m: SectionMemory): MemoryV1 {
  const holders: Record<string, HolderTupleV1> = {};
  for (const [k, h] of Object.entries(m.holders)) holders[k] = encodeHolder(h);
  return {visits: m.visits, pickups: m.pickups ? m.pickups.map(encodePickup) : null, holders, killed: [...m.killed], cleared: m.cleared,
    lanes: jsonSafe(m.lanes, `memory ${m.id} lanes`) as Record<string, unknown>};
}

export function decodeMemory(id: string, m: MemoryV1): SectionMemory {
  const holders: Record<string, HolderRecord> = {};
  for (const [k, h] of Object.entries(m.holders)) holders[k] = decodeHolder(h);
  return {id, visits: m.visits, pickups: m.pickups ? m.pickups.map(decodePickup) : null, holders, killed: [...m.killed], cleared: m.cleared,
    lanes: structuredClone(m.lanes)};
}

const encodeMemories = (mems: Record<string, SectionMemory>): Record<string, MemoryV1> =>
  Object.fromEntries(Object.entries(mems).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, m]) => [id, encodeMemory(m)]));
const decodeMemories = (mems: Record<string, MemoryV1>): Record<string, SectionMemory> =>
  Object.fromEntries(Object.entries(mems).map(([id, m]) => [id, decodeMemory(id, m)]));

/**
 * A strict JSON-data copy: plain objects / arrays / finite numbers / strings / booleans / null. Object members that are undefined
 * are dropped and undefined array entries become null (JSON semantics); anything else (NaN / Infinity, functions, class instances,
 * Map / Set / Date, cycles) throws a SaveError instead of being silently mangled.
 */
export function jsonSafe(v: unknown, path: string, depth = 0): unknown {
  if (depth > 40) throw new SaveError(`${path}: nested too deeply`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new SaveError(`${path}: not a finite number`);
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => (x === undefined ? null : jsonSafe(x, `${path}[${i}]`, depth + 1)));
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new SaveError(`${path}: not plain data`);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = jsonSafe(x, `${path}.${k}`, depth + 1);
    return out;
  }
  throw new SaveError(`${path}: ${typeof v} is not data`);
}

// --- capture -------------------------------------------------------------------------------------------------------------------

/** What a capture reads (Game fills it from its fields). */
export interface RunSource {
  run: RunState;
  inv: Inventory;
  player: VitalsSnapshot;
  survival: SurvivalSnapshot;
  battery: BatterySnapshot;
  participants: readonly RunParticipant[];
  stats: Record<string, number>;
  /** Game clock (s). */
  clock: number;
  pose: TrainLocalPose;
  point: SavePoint;
}

const vitals = (v: VitalsSnapshot): VitalsSnapshot => ({hp: v.hp, stamina: v.stamina, damageTaken: v.damageTaken});
const survival = (s: SurvivalSnapshot): SurvivalSnapshot => ({hunger: s.hunger, thirst: s.thirst, time: s.time});
const battery = (b: BatterySnapshot): BatterySnapshot => ({charge: b.charge, on: b.on, died: b.died});
const numbers = (o: Record<string, number>, path: string): Record<string, number> => jsonSafe({...o}, path) as Record<string, number>;

/** The Retry snapshot as data. */
export function encodeEntry(snap: RunSnapshot): EntryV1 {
  const lanes: Record<string, unknown> = {};
  for (const [id, d] of Object.entries(snap.lanes)) if (d !== undefined) lanes[id] = jsonSafe(d, `entry lane ${id}`);
  return {
    level: snap.level, section: snap.section, ...(snap.station ? {station: snap.station} : {}), arrival: {kind: snap.arrival.kind},
    vitals: vitals(snap.vitals), survival: survival(snap.survival), battery: battery(snap.battery),
    inventory: snap.inventory.toJSON(), lanes, memories: encodeMemories(snap.memories), stats: numbers(snap.stats, 'entry stats'),
  };
}

/** The live run as SerializedRunV1 (throws SaveError when it cannot be saved faithfully: no campaign, a participant failed …). */
export function captureRun(src: RunSource): SerializedRunV1 {
  const run = src.run;
  if (!run.campaign) throw new SaveError('only a campaign run can be saved');
  const participants: Record<string, unknown> = {};
  for (const p of src.participants) {
    let d: unknown;
    try { d = p.save(); } catch (err) { throw new SaveError(`run participant '${p.id}' could not be saved (${String((err as Error)?.message ?? err)})`); }
    participants[p.id] = d === undefined ? null : jsonSafe(d, `participant ${p.id}`);
  }
  const pose = src.pose;
  return {
    v: SERIALIZED_RUN_V,
    point: src.point,
    campaign: jsonSafe(run.campaign, 'campaign') as CampaignState,
    seeds: {...run.seeds},
    section: run.current.section,
    arrival: run.arrival.kind,
    entered: run.entered.slice(-ENTERED_KEEP),
    playtime: run.playtime,
    clock: src.clock,
    memories: encodeMemories(run.exportMemories()),
    entry: run.entry ? encodeEntry(run.entry) : null,
    carry: {inventory: src.inv.toJSON(), vitals: vitals(src.player), survival: survival(src.survival), battery: battery(src.battery)},
    participants,
    stats: numbers(src.stats, 'stats'),
    player: {trainLocal: {x: pose.x, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, crouched: !!pose.crouched}},
  };
}

/** Human-readable slot metadata derived from the run (never trusted from a file: imports re-derive it). */
export function deriveMeta(run: SerializedRunV1, o: {slot: number; revision: number; savedAt: string; reason: SaveReason | string; build?: string}): SaveMeta {
  const c = run.campaign, node = c.network.nodes.find(n => n.id === c.current);
  return {
    slot: o.slot, savedAt: o.savedAt, revision: o.revision, playtime: Math.round(run.playtime),
    station: node?.name ?? c.current, archetype: node?.archetype ?? 'subway', stationsVisited: c.visited.length,
    networkSeed: c.network.seed, won: c.won !== null, reason: o.reason, build: o.build ?? SAVE_BUILD,
  };
}

/** The versioned envelope of a serialized run (checksum over the run). */
export function makeSaveFile(run: SerializedRunV1, meta: SaveMeta): SaveFileV1Like {
  return {format: SAVE_FORMAT, v: 1, meta, run, checksum: checksumOf(run)};
}

/** SaveFileV1 with its run typed (campaign/types.ts keeps `run: unknown`). */
export interface SaveFileV1Like { format: typeof SAVE_FORMAT; v: 1; meta: SaveMeta; run: SerializedRunV1; checksum: string }

/** The file / localStorage text of an envelope (compact: no pretty-printing). */
export function saveFileText(file: SaveFileV1Like): string {
  return JSON.stringify(file);
}

// --- restore ---------------------------------------------------------------------------------------------------------------------

/** Highest item uid anywhere in a value (any object with a string itemId and an integer uid: stacks, bag contents, lane stores). */
export function maxUidIn(v: unknown, depth = 0): number {
  if (!v || typeof v !== 'object' || depth > 40) return 0;
  let m = 0;
  if (Array.isArray(v)) { for (const x of v) m = Math.max(m, maxUidIn(x, depth + 1)); return m; }
  const o = v as Record<string, unknown>;
  if (typeof o.itemId === 'string' && Number.isInteger(o.uid)) m = o.uid as number;
  for (const x of Object.values(o)) if (x && typeof x === 'object') m = Math.max(m, maxUidIn(x, depth + 1));
  return m;
}

/** Highest uid saved anywhere in a run (carry, Lockbox / participants, every station's memory, the Retry snapshot). */
export function maxUidOfRun(data: SerializedRunV1): number {
  return Math.max(maxUidIn(data.carry.inventory), maxUidIn(data.participants), maxUidIn(data.memories), maxUidIn(data.entry), 0);
}

/** Builds the RunState (Game: createRun with LEVELS + rollLevelGear). */
export type RunFactory = (o: {seeds: LevelSeeds; start: SectionKey; campaign: CampaignState}) => RunState;

/** A decoded save, built but NOT installed (no game state touched yet). */
export interface PreparedRestore {
  data: SerializedRunV1;
  /** The restored run: campaign, every station memory, the Retry snapshot, playtime, current / arrival / entered. */
  run: RunState;
  /** The section to build / resume at: campaign.current's archetype + station. */
  key: SectionKey;
  inventory: Inventory;
  pose: TrainLocalPose;
  transit: CampaignState['transit'];
  point: SavePoint;
  /** Highest uid in the save (the live inventory's counter is reserved above it). */
  maxUid: number;
}

/** Decode a VALIDATED run and build its RunState (pure: nothing of the live game is touched). */
export function prepareRestore(data: SerializedRunV1, makeRun: RunFactory): PreparedRestore {
  const campaign = structuredClone(data.campaign);
  const node = campaign.network.nodes.find(n => n.id === campaign.current);
  if (!node) throw new SaveError(`the current station ${campaign.current} is not in the network`);
  const key: SectionKey = {level: node.archetype, section: data.section, station: node.id};
  const run = makeRun({seeds: {...data.seeds}, start: key, campaign});
  run.importMemories(decodeMemories(data.memories));
  run.current = {...key};
  run.arrival = {kind: data.arrival};
  run.playtime = data.playtime;
  run.entered.length = 0;
  run.entered.push(...data.entered);
  const maxUid = maxUidOfRun(data);
  run.entry = data.entry ? decodeEntry(data.entry, maxUid) : null;
  const inventory = Inventory.fromJSON(structuredClone(data.carry.inventory));
  inventory.reserveUids(maxUid);
  return {data, run, key, inventory, pose: {...data.player.trainLocal}, transit: campaign.transit ? {...campaign.transit} : null, point: data.point, maxUid};
}

/** The Retry snapshot back as a RunSnapshot (its inventory a live Inventory; its uid counter above every saved uid). */
export function decodeEntry(e: EntryV1, maxUid = 0): RunSnapshot {
  const inventory = Inventory.fromJSON(structuredClone(e.inventory));
  inventory.reserveUids(maxUid);
  return {
    level: e.level, section: e.section, ...(e.station ? {station: e.station} : {}), arrival: {kind: e.arrival.kind},
    vitals: vitals(e.vitals), survival: survival(e.survival), battery: battery(e.battery), inventory,
    lanes: structuredClone(e.lanes), memories: decodeMemories(e.memories), stats: {...e.stats},
  };
}

/** What installing a restore writes (Game fills it from its fields). */
export interface RunTarget {
  /** Game.run = run. */
  setRun(run: RunState): void;
  /** Install the carried inventory (Game.installInventory: in place, keeping the object the UI holds). */
  installInventory(inv: Inventory): void;
  /** Keep the LIVE inventory's uid counter above `maxUid` (after installInventory). */
  reserveUids(maxUid: number): void;
  player: {hp: number; stamina: number; damageTaken: number; alive: boolean};
  survival: {hunger: number; thirst: number; time: number; reset(): void};
  /** PlayerLight.reset(charge) (re-registers the light); the exact on / died flags are written to `battery` after it. */
  resetBattery(charge: number): void;
  battery: {charge: number; on: boolean; died: boolean};
  participants: readonly RunParticipant[];
  stats: Record<string, number>;
  setClock(t: number): void;
}

/** Install a prepared restore into the live game. Returns the participants whose load threw (they keep / reset their state). */
export function installRestore(p: PreparedRestore, dst: RunTarget): {failed: string[]} {
  const d = p.data, c = d.carry;
  dst.setRun(p.run);
  dst.resetBattery(c.battery.charge);
  dst.battery.charge = c.battery.charge;
  dst.battery.on = c.battery.on && c.battery.charge > 0;
  dst.battery.died = c.battery.died;
  dst.survival.reset();
  dst.survival.hunger = c.survival.hunger;
  dst.survival.thirst = c.survival.thirst;
  dst.survival.time = c.survival.time;
  dst.player.hp = c.vitals.hp;
  dst.player.stamina = c.vitals.stamina;
  dst.player.damageTaken = c.vitals.damageTaken;
  dst.player.alive = dst.player.hp > 0;
  for (const k of Object.keys(dst.stats)) delete dst.stats[k];
  Object.assign(dst.stats, d.stats);
  dst.installInventory(p.inventory);
  const failed: string[] = [];
  for (const part of dst.participants) {
    try {
      if (Object.prototype.hasOwnProperty.call(d.participants, part.id)) part.load(structuredClone(d.participants[part.id]));
      else part.reset();
    } catch (err) { failed.push(part.id); console.warn(`save: run participant '${part.id}' restore failed`, err); }
  }
  dst.reserveUids(p.maxUid);
  dst.setClock(d.clock);
  return {failed};
}

/** What the travel orchestrator gets after a load: build `key` with the player at `pose` (no transit), or resume `transit` once. */
export interface RestoreHandoff {
  key: SectionKey;
  pose: TrainLocalPose;
  transit: CampaignState['transit'];
  point: SavePoint;
  /** Run participants whose load threw (their state was kept / reset; logged). */
  failed: string[];
}

/** A saved train-local pose kept inside the car's interior (`margin` m from its walls), yaw wrapped to (-PI, PI]. */
export function clampTrainLocal(p: TrainLocalPose, interior: {x0: number; x1: number; halfWidth: number}, margin = 0.35): TrainLocalPose {
  const cl = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    x: cl(p.x, interior.x0 + margin, interior.x1 - margin), z: cl(p.z, -interior.halfWidth + margin, interior.halfWidth - margin),
    yaw: Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)), pitch: cl(p.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01), crouched: !!p.crouched,
  };
}

/** captureRun's inverse in one call (prepare + install): for callers that already tore the old world down. */
export function restoreRun(data: SerializedRunV1, dst: RunTarget & {makeRun: RunFactory}): PreparedRestore & {failed: string[]} {
  const p = prepareRestore(data, dst.makeRun);
  return {...p, ...installRestore(p, dst)};
}
