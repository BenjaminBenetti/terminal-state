// Iteration 16 (lane RUN) / 17: the rules for starting a travel (pure; Game.travel and the tests use the same function).
// Iteration 17 (seamless): a travel only ever changes the LOGICAL level — moving inside a level (its storeys, stairs, the
// elevator) is never a travel, so a request for the level you are in is refused ('same-level').

import type {LevelId, TravelRequest} from '../levels/types';

export type TravelRefusal = 'busy' | 'dead' | 'not-ready' | 'unknown-section' | 'same-level';
export type TravelResult = {ok: true} | {ok: false; reason: TravelRefusal | 'cancelled' | 'failed'};

/** Game states a travel may start from (gameplay, the pause menu, the clear screen; never dead / title / loading). */
export const TRAVEL_FROM_STATES: readonly string[] = ['playing', 'paused', 'inventory', 'won'];

export interface TravelGateState {
  /** A travel / new game / retry is already running (single flight). */
  busy: boolean;
  alive: boolean;
  state: string;
  /** A world is built and the renderer is ready. */
  ready: boolean;
  /** Sections of a logical level for this run (null = unknown level). */
  sections(level: LevelId): readonly string[] | null;
  /** The logical level being played (a travel must go to ANOTHER level). */
  current: LevelId;
}

/** Why a travel may not start now (null = it may). Dead players never travel; one travel at a time. */
export function travelRefusal(req: TravelRequest, s: TravelGateState): TravelRefusal | null {
  if (s.busy) return 'busy';
  if (!s.alive || s.state === 'dead') return 'dead';
  if (!s.ready || !TRAVEL_FROM_STATES.includes(s.state)) return 'not-ready';
  const secs = s.sections(req.to.level);
  if (!secs || !secs.includes(req.to.section)) return 'unknown-section';
  if (req.to.level === s.current) return 'same-level';
  return null;
}

/** One async lifecycle operation at a time (travel, new game, retry): `run` returns null while one is in flight. */
export class SingleFlight {
  private current: Promise<unknown> | null = null;
  get busy(): boolean { return this.current !== null; }
  run<T>(fn: () => Promise<T>): Promise<T> | null {
    if (this.current) return null;
    const p = (async () => { try { return await fn(); } finally { this.current = null; } })();
    this.current = p;
    return p;
  }
}
