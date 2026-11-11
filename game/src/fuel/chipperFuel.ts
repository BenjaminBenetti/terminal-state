// Task studio-corpse-chipper-fuel-20261110-235304-01 (user: "1 corpse = 0.1 standard tank … 10 corpses = one hop, 20 = a full empty
// train"): the train CHIPPER'S FUEL — an emergency source, deliberately slow. The player carries one real dead undead body at a time to
// the woodchipper fixed in the train (world/chipper.ts) and feeds it; about 20 active seconds later it is ground and its blood is fuel.
//
// UNITS. Every existing fuel quantity stays in whole QUARTERS (fuel/fuel.ts FUEL: a can 1, the train tank 8, a hop 4, a cart 8). The
// chipper keeps its own credit in integer TICKS of 1/5 quarter (a standard 4-quarter tank = 20 ticks), so one body = 0.1 standard tank =
// 0.4 quarter = EXACTLY 2 ticks: 10 bodies = 20 ticks = 4 quarters (one hop), 20 bodies = 40 ticks = 8 quarters (a full empty train).
// No fractional quarter ever exists in the tank, a cart, a can, a debit or a save; the machine's remainder (0..4 ticks below a whole
// quarter, or more while the tank is full) waits in the machine, persistent, and is never floored away, clamped off or counted twice.
//
// FLOW (all integer, all in place on one ChipperJSON):
//  - feed:     startJob — the body record moves into the machine's job (one body at a time; refused while busy or when its credit
//              would not fit the buffer: the player keeps the body). The job gets a stable processing uid (seq).
//  - grind:    grind(dtMs) — active milliseconds while the machine runs (the train parked); at the completion instant, in the SAME call,
//              the body is consumed (the job, and with it the only copy of the body, is gone) and its 2 ticks are credited (ticks, done,
//              last). One synchronous mutation: no save can see one without the other.
//  - transfer: transferToTank — whole quarters (5 ticks each) move into the train's tank while it has room. The caller does this only
//              while the train is parked with no journey pending (the fare is the tank / carts / cans of fuel/fuel.ts planDebit; a
//              refund never meets a transferred quarter). The machine's ticks and an unfinished job are never fare.
// Saved with the 'player-train' participant (`chipper`, run/playerTrain.ts; strict: save/validate.ts chipperProblem). An older save has
// no chipper record: an idle, empty machine (every train has one — a fixed component, not cargo). NewGame: empty; Travel keeps it; Retry
// restores the level-entry record together with the station memory that still holds the enemy alive (never a credit AND the body).

import {FUEL} from './fuel';
import {copyBody, bodyProblem, type BodyRecordJSON} from '../corpse/bodyRecord';

export const CHIPPER = {
  /** Ticks per existing quarter unit (fuel/fuel.ts FUEL.tankUnits quarters = one standard tank). */
  ticksPerQuarter: 5,
  /** One body = 0.1 standard tank = 0.4 quarter. */
  bodyTicks: 2,
  /** Finite credit the machine can hold (ticks): two standard tanks waiting while the train's tank is full. */
  bufferMaxTicks: 40,
  /** Active grinding per body (ms; the train parked). */
  grindMs: 20000,
  /** Processing uid bound (input safety). */
  maxSeq: 1e9,
  /** Bodies credited bound (input safety). */
  maxDone: 1e9,
} as const;

/** 1 standard tank in ticks (= 20). */
export const TANK_TICKS = FUEL.tankUnits * CHIPPER.ticksPerQuarter;

export interface ChipperJobJSON {
  /** Stable processing uid (seq - 1 when issued). */
  uid: number;
  /** The body being ground (its only copy: it exists nowhere else). Train-local record. */
  body: BodyRecordJSON;
  /** Active grinding done (integer ms, 0 .. CHIPPER.grindMs - 1: a job at grindMs has been credited and is gone). */
  ms: number;
}

export interface ChipperJSON {
  v: 1;
  /** Credit waiting in the machine (ticks, 0 .. CHIPPER.bufferMaxTicks). */
  ticks: number;
  /** The next processing uid. */
  seq: number;
  /** Bodies credited in this run (each exactly once). */
  done: number;
  /** The uid of the last credited job (0 = none): a job's uid is always above it. */
  last: number;
  job: ChipperJobJSON | null;
}

export const freshChipper = (): ChipperJSON => ({v: 1, ticks: 0, seq: 1, done: 0, last: 0, job: null});

const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const KEYS = ['v', 'ticks', 'seq', 'done', 'last', 'job'];
const JOB_KEYS = ['uid', 'body', 'ms'];

/** Why a chipper record is malformed (null = fine). `feedable`: ai/creatureArchetypes.ts corpseFeedable. */
export function chipperProblem(v: unknown, feedable: (arch: string) => boolean): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the chipper record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) return `unexpected chipper field '${k}'`;
  if (o.v !== 1) return 'unsupported chipper record version';
  if (!int(o.ticks, 0, CHIPPER.bufferMaxTicks)) return `chipper credit must be whole ticks 0..${CHIPPER.bufferMaxTicks}`;
  if (!int(o.seq, 1, CHIPPER.maxSeq)) return 'chipper processing uid out of range';
  if (!int(o.done, 0, CHIPPER.maxDone)) return 'chipper body count out of range';
  if (!int(o.last, 0, o.seq - 1)) return 'chipper last credited uid out of range';
  if (o.done > o.seq - 1) return 'the chipper credited more bodies than it took';
  if (o.job !== null) {
    if (!o.job || typeof o.job !== 'object' || Array.isArray(o.job)) return 'a chipper job must be an object';
    const j = o.job as Record<string, unknown>;
    for (const k of Object.keys(j)) if (!JOB_KEYS.includes(k)) return `unexpected chipper job field '${k}'`;
    if (j.uid !== o.seq - 1 || !int(j.uid, 1, CHIPPER.maxSeq) || j.uid <= o.last) return 'the chipper job uid is not its newest uncredited one';
    if (!int(j.ms, 0, CHIPPER.grindMs - 1)) return 'chipper job progress out of range';
    const bp = bodyProblem(j.body, {world: false, feedable});
    if (bp) return bp;
    if (o.ticks + CHIPPER.bodyTicks > CHIPPER.bufferMaxTicks) return 'the chipper job would overflow its credit';
  }
  return null;
}

export const copyChipper = (c: ChipperJSON): ChipperJSON =>
  ({v: 1, ticks: c.ticks, seq: c.seq, done: c.done, last: c.last, job: c.job ? {uid: c.job.uid, body: copyBody(c.job.body), ms: c.job.ms} : null});

export const CHIPPER_REFUSAL = {
  busy: 'The chipper is still grinding — wait for it to finish',
  full: 'The chipper\'s fuel tank is full — make room in the train\'s tank first',
} as const;

/** Why the machine cannot take a body now (null = it can). The body is never taken on a refusal. */
export function chipperRefusal(c: ChipperJSON): string | null {
  if (c.job) return CHIPPER_REFUSAL.busy;
  if (c.ticks + CHIPPER.bodyTicks > CHIPPER.bufferMaxTicks || c.seq >= CHIPPER.maxSeq) return CHIPPER_REFUSAL.full;
  return null;
}

/** Feed: the body record becomes the machine's job (its only copy). Throws on a refusal (callers check chipperRefusal first). */
export function startJob(c: ChipperJSON, body: BodyRecordJSON): ChipperJobJSON {
  const r = chipperRefusal(c);
  if (r) throw new Error(r);
  const job = {uid: c.seq, body: copyBody(body), ms: 0};
  c.seq += 1;
  c.job = job;
  return job;
}

/** A credited job: its uid, the body's identity, the ticks credited. */
export interface ChipperCredit { uid: number; id: string; ticks: number }

/**
 * Grind `dtMs` active milliseconds (integer, >= 0; the caller only calls it while the machine runs). At the completion instant the body
 * is consumed and credited in this same mutation; returns the credit then (else null).
 */
export function grind(c: ChipperJSON, dtMs: number): ChipperCredit | null {
  if (!c.job || !(dtMs > 0)) return null;
  const ms = c.job.ms + Math.floor(dtMs);
  if (ms < CHIPPER.grindMs) { c.job.ms = ms; return null; }
  const job = c.job;
  c.job = null;
  c.ticks += CHIPPER.bodyTicks;
  c.done += 1;
  c.last = job.uid;
  return {uid: job.uid, id: job.body.id, ticks: CHIPPER.bodyTicks};
}

/**
 * Frame time -> whole grind milliseconds for grind(), carrying the sub-millisecond remainder (frames add up to real time: 60 fps frames of
 * 16.67 ms grind 20 s in 1200 frames, never 1177 by rounding). Runtime only (the remainder is not saved: at most 1 ms per load).
 */
export class GrindClock {
  private carry = 0;
  take(dtS: number): number {
    const t = this.carry + Math.max(0, dtS) * 1000, ms = Math.floor(t);
    this.carry = t - ms;
    return ms;
  }
  reset(): void { this.carry = 0; }
}

/** Progress of the job (0..1; 0 when idle) — the machine's honest gauge. */
export const jobProgress = (c: ChipperJSON): number => c.job ? c.job.ms / CHIPPER.grindMs : 0;

/**
 * Move whole quarters (5 ticks each) of the machine's credit into the train's tank while it has room (FUEL.trainTankUnits). Returns the
 * quarters moved. The caller calls it only while the train is parked with no journey pending.
 */
export function transferToTank(c: ChipperJSON, fuel: {tank: number}): number {
  const room = Math.max(0, FUEL.trainTankUnits - fuel.tank);
  const n = Math.min(Math.floor(c.ticks / CHIPPER.ticksPerQuarter), room);
  if (n <= 0) return 0;
  c.ticks -= n * CHIPPER.ticksPerQuarter;
  fuel.tank += n;
  return n;
}

/** The machine's credit as tenths of a standard tank (2 ticks = 0.1 tank): exact display, e.g. 6 ticks -> '0.3'. */
export function creditTankText(ticks: number): string {
  return (ticks / TANK_TICKS).toFixed(ticks % 2 === 0 ? 1 : 2);
}
