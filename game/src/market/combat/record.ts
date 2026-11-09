// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market station's HOSTILITY record — one lane store per market station
// (run memory 'market.hostility', so Continue / revisit / Retry follow the ordinary section-memory rules). Pure data (no three.js): the
// save validator (save/validate.ts) checks an imported record with marketHostilityProblem.
//
// Absent = the settlement was never provoked (everyone calm, alive, at home). Once written it is hostile for good (no reset, no bribe, no
// reputation): the cause, and per person (traders 'trader:<stall>', residents 'resident:<i>') alive / dead, hp, the role it took
// (flee / fight), its gun, rounds in the magazine + spare rounds, its posture and where it stands / lies. Dead stay dead (their body lies
// where it fell).
//
// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): VERSION 2 — nobody leaves any more (user: "Fleeing survivors must hide in
// homes, not disappear/despawn"): a fleer runs to its refuge (market/people/refuges.ts) and hides there, so a person is alive or dead,
// always with a position, and an alive fleer names its `refuge` (its posture 'hide' once there, 'flee' while still on its way). Version 1
// records (written before) stay valid: their 'fled' people (alive, gone, no position) come back on load as hiders in a refuge with their
// hp / gun / rounds / role (market/combat/marketCombat.ts restore), and the next write is version 2. The bar's bartender ('trader:bar',
// layout v3) is a person like any trader.
import {MARKET_STALLS_ALL, type MarketStallId} from '../../gen/market/marketTypes'; // (+ the bar's bartender: task studio-market-bar-20261108-225231-01)

export const MARKET_HOSTILITY_LANE = 'market.hostility';
/** A refuge id (market/people/refuges.ts): its kind and its layout area. */
export const REFUGE_ID = /^(home|bunks|store|room):\d{1,4}$/;
/** The record version written now (1 = the first form, with 'fled' people; still read). */
export const MARKET_HOSTILITY_VERSION = 2;

/** 'fled' only in version-1 records (gone for good then; migrated on load). */
export type MarketPersonState = 'alive' | 'dead' | 'fled';
export type MarketRole = 'flee' | 'fight';
export type MarketGunId = 'pistol' | 'rifle' | 'shotgun';
export const MARKET_GUNS: readonly MarketGunId[] = ['pistol', 'rifle', 'shotgun'];
/** What a hostile person was doing when recorded (a revisit resumes from it). */
export type MarketPosture = 'flee' | 'hide' | 'fight' | 'down';
export const MARKET_POSTURES: readonly MarketPosture[] = ['flee', 'hide', 'fight', 'down'];

export interface MarketPersonRecord {
  s: MarketPersonState;
  /** Hit points left (0 when dead). */
  hp: number;
  role: MarketRole;
  /** The gun it carries (every person has one seeded; only fighters draw it). */
  gun: MarketGunId;
  /** Rounds in the magazine / spare rounds. */
  mag: number;
  spare: number;
  posture: MarketPosture;
  /** Feet position / facing (absent only for a version-1 record's fled). */
  x?: number; y?: number; z?: number; yaw?: number;
  /** (version 2) An alive fleer's refuge id (market/people/refuges.ts REFUGE_ID: 'home:12' ...). */
  refuge?: string;
}

export interface MarketHostilityJSON {
  v: 1 | 2;
  hostile: true;
  cause: 'attack' | 'theft';
  /** The stall robbed (theft) / whose trader was hit (attack). */
  stall?: MarketStallId;
  people: Record<string, MarketPersonRecord>;
}


/** Person ids: one trader per stall, residents by index. */
export const traderId = (stall: MarketStallId): string => `trader:${stall}`;
export const residentId = (i: number): string => `resident:${i}`;
const PERSON_ID = new RegExp(`^(trader:(${MARKET_STALLS_ALL.join('|')})|resident:\\d{1,2})$`);
export const MARKET_PERSON_MAX = 64;
export const MARKET_PERSON_HP_MAX = 1000;
/** Generous caps on carried rounds (a shotgun / pistol / rifle magazine is <= 30; spares a few magazines). */
const MAG_MAX = 100, SPARE_MAX = 1000;

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const PERSON_KEYS_V1 = ['s', 'hp', 'role', 'gun', 'mag', 'spare', 'posture', 'x', 'y', 'z', 'yaw'];
const PERSON_KEYS_V2 = [...PERSON_KEYS_V1, 'refuge'];

/** One person record's problem (of a record of version `v`), or null. */
function personProblem(p: unknown, v: 1 | 2): string | null {
  if (!isObj(p)) return 'not an object';
  const keys = v === 1 ? PERSON_KEYS_V1 : PERSON_KEYS_V2;
  for (const k of Object.keys(p)) if (!keys.includes(k)) return `unknown field ${k}`;
  if (p.s !== 'alive' && p.s !== 'dead' && (v !== 1 || p.s !== 'fled')) return 'bad state';
  if (!isNum(p.hp, 0, MARKET_PERSON_HP_MAX)) return 'bad hp';
  if (p.s === 'dead' && p.hp !== 0) return 'a dead person with hp';
  if (p.s === 'alive' && !(p.hp > 0)) return 'an alive person without hp';
  if (p.role !== 'flee' && p.role !== 'fight') return 'bad role';
  if (!MARKET_GUNS.includes(p.gun as MarketGunId)) return 'bad gun';
  if (!isInt(p.mag, 0, MAG_MAX) || !isInt(p.spare, 0, SPARE_MAX)) return 'bad ammunition';
  if (!MARKET_POSTURES.includes(p.posture as MarketPosture)) return 'bad posture';
  const pos = ['x', 'y', 'z', 'yaw'].filter(k => p[k] !== undefined);
  if (pos.length && pos.length !== 4) return 'a partial position';
  for (const k of pos) if (!isNum(p[k], -1e5, 1e5)) return `bad ${k}`;
  if (p.s !== 'fled' && pos.length !== 4) return 'no position';
  if (p.refuge !== undefined) {
    if (typeof p.refuge !== 'string' || !REFUGE_ID.test(p.refuge)) return 'bad refuge';
    if (p.s !== 'alive') return 'a refuge for the dead';
  }
  return null;
}

/** An (imported) hostility record's first problem, or null when it is well-formed (version 1 or 2). */
export function marketHostilityProblem(v: unknown): string | null {
  if (!isObj(v)) return 'not an object';
  for (const k of Object.keys(v)) if (!['v', 'hostile', 'cause', 'stall', 'people'].includes(k)) return `unknown field ${k}`;
  if (v.v !== 1 && v.v !== 2) return 'unsupported market hostility version';
  if (v.hostile !== true) return 'a hostility record is always hostile';
  if (v.cause !== 'attack' && v.cause !== 'theft') return 'bad cause';
  if (v.stall !== undefined && !(MARKET_STALLS_ALL as readonly unknown[]).includes(v.stall)) return 'bad stall';
  if (v.cause === 'theft' && v.stall === undefined) return 'a theft names its stall';
  if (!isObj(v.people)) return 'bad people';
  const ids = Object.keys(v.people);
  if (ids.length > MARKET_PERSON_MAX) return 'too many people';
  for (const id of ids) {
    if (!PERSON_ID.test(id)) return `bad person id ${id.slice(0, 24)}`;
    const p = personProblem(v.people[id], v.v);
    if (p) return `${id}: ${p}`;
  }
  return null;
}
