// Task studio-refinement-batch-20261113-035659-01 (lane SAVE): WHERE the train's SAVE TERMINAL is — pure data from the car spec
// (world/playerTrainSpec.ts) and the reused CRT terminal model's catalogue dims (gen/props07.catalog.ts crtTerminal). No three.js, no
// Game: the parked colliders (world/playerTrain.ts trainColliders), the ride's car-local model (world/trainRideLocal.ts), the aim box
// and the view (world/trainSaveTerminal.ts) all read this one placement (the chipperPlace.ts / craft/trainFixtures.ts pattern).
//
// User: "small retro Fallout-esque CRT LEFT of the main drive terminal, labeled 'Save'". The operator at the driving desk faces the
// windshield (+X; the desk's yaw is 0), so LEFT is -Z: between the desk's -Z end and the -Z lining there is a dead strip (0.32 m, too
// narrow for a body). The terminal stands there at a reduced scale (0.68: 0.30 m across the car, so it fits the strip with ~1 cm to
// spare each side) on a small steel wall shelf, its screen turned to the operator (-X) and its glass face flush with the desk's
// operator edge, so it reads as one more instrument beside the desk. The shelf top (0.92 m over the car floor, the desk's sloped top
// runs 0.71 -> 1.11 m) keeps everything that lies in front of a cab window's x range — the shelf lip and the integrated keyboard —
// below the 0.98 m window sill; the monitor body itself stands in front of the solid lining pier between the two -Z cab windows
// (tests/train-save-terminal.test.ts checks both on the measured windows). The shelf's front lip reaches 0.2 m into the free floor
// beside the desk's left end, so the shelf + terminal is one solid box (player / enemy / hitscan, parked and riding) — like the
// bench, it is a fixed part of the car, never a layout prop kind, cargo or equipment.

import {P7_MODELS} from '../gen/props07.catalog';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {consoleLocalRect} from './trainConsole';

/** The reused CRT terminal model (the P7 prop library entry: gen/props07.ts p7ModelKey('crtTerminal')). */
export const SAVE_TERMINAL_MODEL_KEY = 'p7_crtTerminal';
/** Its catalogue entry (front +Z, bottom-centre origin; w along x, d along z). */
export const SAVE_TERMINAL_MODEL = P7_MODELS.crtTerminal;

/** Tuning (one place; the screen patch is measured on the GLB: model frame, metres at scale 1). */
export const SAVE_TERMINAL = {
  /** Uniform model scale (the small terminal: 0.439 x 0.45 x 0.5 m -> 0.30 x 0.31 x 0.34 m). */
  scale: 0.68,
  /** The shelf top over the car floor (m). */
  shelfY: 0.92,
  /** Shelf slab thickness (m). */
  shelfT: 0.03,
  /** The shelf reaches this far beyond the terminal's front / back (m, along the car). */
  lip: 0.012,
  /** The shelf stops this far short of the desk's -Z side (m). */
  deskGap: 0.004,
  /** The model's glass: its front-most point (model z, the face set flush with the desk's operator edge). */
  faceZ: -0.036,
  /** The dynamic screen patch (model frame): x0..x1 / y0..y1 on the curved glass z(x, y) = faceZ - bx (x/rx)^2 - by ((y-yc)/ry)^2,
   *  lifted `lift` off it (measured: the bulge falls to -0.061 at x +-0.16 and to -0.068 at y 0.10 / 0.38; the bottom bezel's lip
   *  starts at y 0.115, so the patch stops above it — tests/train-save-terminal.test.ts: no model vertex in front of the patch). */
  screen: {x0: -0.15, x1: 0.15, y0: 0.12, y1: 0.36, yc: 0.24, rx: 0.16, ry: 0.14, bx: 0.025, by: 0.032, lift: 0.005},
} as const;

/** Model z of the screen glass at (x, y) (model frame; see SAVE_TERMINAL.screen). */
export function screenGlassZ(x: number, y: number): number {
  const S = SAVE_TERMINAL.screen, u = x / S.rx, v = (y - S.yc) / S.ry;
  return SAVE_TERMINAL.faceZ - S.bx * u * u - S.by * v * v;
}

export interface SaveTerminalPlacement {
  /** The terminal's footprint centre (train-local x / z) and the interior floor (train-local y). */
  x: number; z: number; floorY: number;
  /** Train-local y of the shelf top (the terminal stands on it). */
  shelfY: number;
  /** Rotation about +Y: -PI/2 turns the model's +Z front to -X (the operator side). */
  yaw: number;
  scale: number;
  /** Runtime size (m): across the car (z) / height / along the car (x). */
  width: number; height: number; depth: number;
  /** Train-local x of the screen glass's front-most point (= the desk's operator edge). */
  screenX: number;
  /** The monitor body's x span (the parts that rise above the keyboard: model z -0.25 .. faceZ). */
  monitor: {x0: number; x1: number};
  /** The terminal's own box (train-local; the aim box). */
  aim: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  /** The shelf slab (train-local). */
  shelf: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  /** The solid footprint (shelf + terminal, lining to desk side) and its top (train-local y). */
  box: {x0: number; x1: number; z0: number; z1: number};
  top: number;
  /** The car side it is on (-1: the platform side, -Z = the operator's left). */
  side: -1;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const cache = new WeakMap<PlayerTrainSpec, SaveTerminalPlacement | null>();

/**
 * The save terminal's placement in a car (null: no desk facing +X, or no strip beside its -Z end wide enough for the terminal).
 * Uses the desk's catalogue box around spec.console (deterministic: the parked colliders, the ride model and the view agree).
 */
export function saveTerminalPlacement(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): SaveTerminalPlacement | null {
  if (cache.has(spec)) return cache.get(spec)!;
  let p: SaveTerminalPlacement | null = null;
  const T = SAVE_TERMINAL, M = SAVE_TERMINAL_MODEL, s = T.scale, hw = spec.interior.halfWidth;
  if (Math.abs(spec.console.yaw) < 1e-6) { // (the operator faces +X: left = -Z)
    const cr = consoleLocalRect(spec, null);
    const width = M.w * s, height = M.h * s, depth = M.d * s;
    const z0 = -hw, z1 = cr.z0 - T.deskGap;
    if (z1 - z0 >= width + 2 * 0.008) {
      const z = (z0 + z1) / 2, x = cr.x0 + T.faceZ * s; // (train x = x - modelZ * s: the face lands on the desk's operator edge)
      const floorY = spec.floorY, shelfY = floorY + T.shelfY, top = shelfY + height;
      const fx0 = x - depth / 2, fx1 = x + depth / 2;
      if (fx0 - T.lip > spec.cab.x0 + 0.3 && fx1 + T.lip < spec.interior.x1) {
        p = Object.freeze({
          x: r4(x), z: r4(z), floorY, shelfY: r4(shelfY), yaw: -Math.PI / 2, scale: s,
          width: r4(width), height: r4(height), depth: r4(depth), screenX: r4(cr.x0),
          monitor: Object.freeze({x0: r4(x - T.faceZ * s), x1: r4(x + (M.d / 2) * s)}),
          aim: Object.freeze({x0: r4(fx0), x1: r4(fx1), y0: r4(shelfY), y1: r4(top), z0: r4(z - width / 2), z1: r4(z + width / 2)}),
          shelf: Object.freeze({x0: r4(fx0 - T.lip), x1: r4(fx1 + T.lip), y0: r4(shelfY - T.shelfT), y1: r4(shelfY), z0: r4(z0), z1: r4(z1)}),
          box: Object.freeze({x0: r4(fx0 - T.lip), x1: r4(fx1 + T.lip), z0: r4(z0), z1: r4(z1)}),
          top: r4(top), side: -1 as const,
        });
      }
    }
  }
  cache.set(spec, p);
  return p;
}

/** A point of the terminal's model frame (bottom-centre origin, +Z front, metres at scale 1) -> train-local. */
export function saveTerminalToLocal(p: SaveTerminalPlacement, mx: number, my: number, mz: number, out: {x: number; y: number; z: number} = {x: 0, y: 0, z: 0}): {x: number; y: number; z: number} {
  // R_y(-PI/2): (x, y, z) -> (-z, y, x)
  out.x = p.x - mz * p.scale;
  out.y = p.shelfY + my * p.scale;
  out.z = p.z + mx * p.scale;
  return out;
}
