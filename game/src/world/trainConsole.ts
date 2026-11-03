// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the DRIVING CONSOLE of the player's train — the cooked Meshy
// desk in the front cab (playerTrainView.ts 'train-console', spec.console) becomes an [E] interactable that opens the campaign map
// (the primary wires PlayerTrainRuntime.onConsoleInteract to it). Pure data + maths here; world/playerTrain.ts owns the aim / prompt /
// highlight / [E] plumbing (the 'lockbox' precedent with a 'console' owner). The rear compartment has NO console (spec.rear has none).
//
// Aim box: the desk's train-local footprint + height. With the model placed it is the model's own box (PlayerTrainRuntime.build measures
// it: `consoleRect`); without the model (tests, a failed fetch) the cooked model's measured dims around spec.console stand in, so the
// travel UI never depends on a texture / model fetch. Reach and occlusion are the doors' / Lockbox's (TRAIN_DOOR.reach; nothing
// structural in between: the partitions block an aim through the wall, the cab doorway does not).

import {PLAYER_TRAIN_MODELS} from '../assets/playerTrain.generated';
import type {PlayerTrainSpec} from './playerTrainSpec';

/** A train-local desk footprint (x0 < x1, z0 < z1) and its top (local y above the rail top). */
export interface ConsoleRect { x0: number; x1: number; z0: number; z1: number; top: number }

/** [E] prompt over the aimed console (the HUD's prompt line; the primary's map opens on [E]). */
export const CONSOLE_PROMPT = '<b>[E]</b> Driving console — open the map';

/** Seconds between "the map is not available" notes when no map is wired (the callback is null). */
export const CONSOLE_NOTE_EVERY = 2.5;

/** The cooked console model's measured size [x, y, z] (m; assets/playerTrain.generated.ts), else a 0.8 x 1.16 x 1.95 m desk. */
export const CONSOLE_DIMS: readonly [number, number, number] =
  (PLAYER_TRAIN_MODELS as unknown as Record<string, {dims?: readonly [number, number, number]}>)['player-train-console']?.dims ?? [0.8028, 1.1641, 1.9549];

/**
 * The console's train-local box: the measured model box when the desk is placed (`measured`), else the cooked model's dims centred on
 * spec.console (yaw 0 / PI keep x / z; any other yaw swaps them), standing on the interior floor. Clamped inside the cab.
 */
export function consoleLocalRect(spec: PlayerTrainSpec, measured: ConsoleRect | null = null): ConsoleRect {
  if (measured) return {...measured};
  const c = spec.console, s = c.scale || 1;
  const quarter = Math.abs(Math.sin(c.yaw)) > 0.7;
  const hx = ((quarter ? CONSOLE_DIMS[2] : CONSOLE_DIMS[0]) * s) / 2, hz = ((quarter ? CONSOLE_DIMS[0] : CONSOLE_DIMS[2]) * s) / 2;
  const x0 = Math.max(spec.cab.x0, c.x - hx), x1 = Math.min(spec.interior.x1, c.x + hx);
  const hw = spec.interior.halfWidth;
  return {x0, x1, z0: Math.max(-hw, c.z - hz), z1: Math.min(hw, c.z + hz), top: spec.floorY + CONSOLE_DIMS[1] * s};
}

/** True when a train-local point lies in the front cab (the console's compartment). */
export function inCab(spec: PlayerTrainSpec, lx: number, lz: number): boolean {
  return lx > spec.cab.x0 && lx < spec.cab.x1 && Math.abs(lz) < spec.interior.halfWidth;
}
