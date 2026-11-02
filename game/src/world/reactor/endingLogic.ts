// Task studio-reactor-surface-ending-20261102 (lane ENDING): THE SURFACE EXIT's rules as pure data (no three.js / DOM; the tests step
// them). User: "when the gas is done clearing around the reactor a new objectives should pop up for the player, in the middle of the
// screen (stays in middle for about 10 seconds then moves to objective area on the left). Telling the player that "external doors
// open". There should be an external sealed door on the top level that now becomes open."
//  - THE TRIGGER: the core's air cleared after ONLINE — the reactor restarted AND every gas zone's fraction at 1 (the jammed core-floor
//    zone clears only through the win's clearAll, world/reactor/air.ts). Never at the rod press / power on: the clearing runs
//    REACTOR_AIR.CLEAR_ALL_S (20 s) from WIN.airAtS.
//  - THE PHASE (ReactorRunState.ending, persisted): sealed -> open. Opening is one event: the record is written at once (doors, openedAt,
//    announced), so a revisit / rebuild / reload starts open and docked — nothing replays.
//  - THE MESSAGE: centre for ENDING.centreS play seconds, then it moves to the left objective area over ENDING.moveS and IS the objective
//    line there (OBJECTIVE_TEXT.ending.doors). Play time only: a pause / the inventory holds it (and hides it).

import type {ReactorEndingState, ReactorRunState} from './runState';

/** Every ending tunable (s, m). */
export const ENDING = {
  /** The centre message's hold (play seconds), then its move to the objective area. */
  centreS: 10,
  moveS: 0.9,
  /** The door leaves' slide (s): the opening is walkable once they are fully open. */
  doorOpenS: 3.6,
  /** The sealed door's prompt range (eye to the door centre, m) and aim cone (cos). */
  promptM: 3.2,
  promptCos: 0.55,
} as const;

/** The core's air has cleared after ONLINE (the trigger): restarted and every zone fully clear. */
export function coreAirCleared(s: Readonly<Pick<ReactorRunState, 'restarted' | 'zoneClear'>>): boolean {
  return s.restarted && s.zoneClear.length > 0 && s.zoneClear.every(f => f >= 1 - 1e-6);
}

/** The ending record after the doors open at game clock `clock` (the one event: open + announced). */
export function openedEnding(was: Readonly<ReactorEndingState>, clock: number): ReactorEndingState {
  return was.doors ? {...was} : {doors: true, openedAt: clock, announced: true, surfaced: was.surfaced};
}

export type MessagePhase = 'none' | 'centre' | 'moving' | 'docked';

/**
 * The centre message at `t` play seconds after it appeared (null: never shown this world — a rebuilt open world starts docked). `k` is
 * the move's progress 0..1 while moving.
 */
export function messageAt(t: number | null): {phase: MessagePhase; k: number} {
  if (t === null || !Number.isFinite(t)) return {phase: 'none', k: 0};
  if (t < ENDING.centreS) return {phase: 'centre', k: 0};
  if (t < ENDING.centreS + ENDING.moveS) return {phase: 'moving', k: (t - ENDING.centreS) / ENDING.moveS};
  return {phase: 'docked', k: 1};
}

export type EndingStage = 'sealed' | 'announcing' | 'doors' | 'surfaced';

/** The ending's objective stage: sealed (no stage line), announcing (the centre message: the old line stays), doors, surfaced. */
export function endingStage(e: Readonly<ReactorEndingState>, msg: MessagePhase): EndingStage {
  if (!e.doors) return 'sealed';
  if (e.surfaced) return 'surfaced';
  return msg === 'centre' || msg === 'moving' ? 'announcing' : 'doors';
}

/** The door leaves' open fraction `t` s after the opening started (smooth: heavy leaves). */
export function doorOpenAt(t: number): number {
  const x = t <= 0 ? 0 : t >= ENDING.doorOpenS ? 1 : t / ENDING.doorOpenS;
  return x * x * (3 - 2 * x);
}
