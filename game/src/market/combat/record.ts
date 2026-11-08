// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market station's HOSTILITY record — one lane store per market station
// (run memory 'market.hostility', so Continue / revisit / Retry follow the ordinary section-memory rules). Pure data (no three.js): the
// save validator (save/validate.ts) checks an imported record with marketHostilityProblem.
//
// Absent = the settlement was never provoked (everyone calm, alive, at home). Once written it is hostile for good (no reset, no bribe, no
// reputation): the cause, and per person (traders 'trader:<stall>', residents 'resident:<i>') alive / dead / fled, hp, the role it took
// (flee / fight), its gun, rounds in the magazine + spare rounds, its posture and where it stands / lies. Dead stay dead (their body lies
// where it fell), fled stay gone.
import {MARKET_STALLS, type MarketStallId} from '../../gen/market/marketTypes';

export const MARKET_HOSTILITY_LANE = 'market.hostility';

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
  /** Feet position / facing (absent for the fled). */
  x?: number; y?: number; z?: number; yaw?: number;
}

export interface MarketHostilityJSON {
  v: 1;
  hostile: true;
  cause: 'attack' | 'theft';
  /** The stall robbed (theft) / whose trader was hit (attack). */
  stall?: MarketStallId;
  people: Record<string, MarketPersonRecord>;
}

/** Person ids: one trader per stall, residents by index. */
export const traderId = (stall: MarketStallId): string => `trader:${stall}`;
export const residentId = (i: number): string => `resident:${i}`;
const PERSON_ID = new RegExp(`^(trader:(${MARKET_STALLS.join('|')})|resident:\\d{1,2})$`);
export const MARKET_PERSON_MAX = 64;
export const MARKET_PERSON_HP_MAX = 1000;
/** Generous caps on carried rounds (a shotgun / pistol / rifle magazine is <= 30; spares a few magazines). */
const MAG_MAX = 100, SPARE_MAX = 1000;

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const PERSON_KEYS = ['s', 'hp', 'role', 'gun', 'mag', 'spare', 'posture', 'x', 'y', 'z', 'yaw'];

/** One person record's problem, or null. */
function personProblem(p: unknown): string | null {
  if (!isObj(p)) return 'not an object';
  for (const k of Object.keys(p)) if (!PERSON_KEYS.includes(k)) return `unknown field ${k}`;
  if (p.s !== 'alive' && p.s !== 'dead' && p.s !== 'fled') return 'bad state';
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
  return null;
}

/** An (imported) hostility record's first problem, or null when it is well-formed. */
export function marketHostilityProblem(v: unknown): string | null {
  if (!isObj(v)) return 'not an object';
  for (const k of Object.keys(v)) if (!['v', 'hostile', 'cause', 'stall', 'people'].includes(k)) return `unknown field ${k}`;
  if (v.v !== 1) return 'unsupported market hostility version';
  if (v.hostile !== true) return 'a hostility record is always hostile';
  if (v.cause !== 'attack' && v.cause !== 'theft') return 'bad cause';
  if (v.stall !== undefined && !(MARKET_STALLS as readonly unknown[]).includes(v.stall)) return 'bad stall';
  if (v.cause === 'theft' && v.stall === undefined) return 'a theft names its stall';
  if (!isObj(v.people)) return 'bad people';
  const ids = Object.keys(v.people);
  if (ids.length > MARKET_PERSON_MAX) return 'too many people';
  for (const id of ids) {
    if (!PERSON_ID.test(id)) return `bad person id ${id.slice(0, 24)}`;
    const p = personProblem(v.people[id]);
    if (p) return `${id}: ${p}`;
  }
  return null;
}
