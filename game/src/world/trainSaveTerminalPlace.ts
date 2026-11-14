// Task studio-refinement-batch-20261113-035659-01 (lane SAVE): WHERE the train's SAVE TERMINAL is — pure data from the car spec
// (world/playerTrainSpec.ts) and the reused CRT terminal model's catalogue dims (gen/props07.catalog.ts crtTerminal). No three.js, no
// Game: the parked colliders (world/playerTrain.ts trainColliders), the ride's car-local model (world/trainRideLocal.ts), the aim box
// and the view (world/trainSaveTerminal.ts) all read this one placement (the chipperPlace.ts / craft/trainFixtures.ts pattern).
//
// User: "small retro Fallout-esque CRT LEFT of the main drive terminal, labeled 'Save'". The operator at the driving desk faces the
// windshield (+X; the desk's yaw is 0), so LEFT is -Z: between the desk's -Z end and the -Z lining there is a dead strip (0.32 m, too
// narrow for a body). The terminal stands there at a reduced scale (0.68: 0.30 x 0.31 x 0.34 m) on a small steel wall shelf whose top
// is 0.92 m over the car floor, in front of the solid lining pier between the two -Z cab windows.
//
// Task studio-scanner-console-refinements-20261114-031614-01: user: "Turn the train's existing Save terminal so the screen faces
// INWARD toward the cab/player at the drive controls. Keep its position/height". It used to show its screen to -X (along the car, so
// the operator at the desk saw its side); now its front is +Z, straight across the cab: from the drive controls' standing spot
// (behind the desk's middle) the screen is ~27 deg off its axis (it was ~66 deg). The same wall, shelf height, scale and model; the
// monitor is centred on the same lining pier (yaw 0 puts the model's 0.30 m width along the car: it overhangs the 0.26 m pier by
// ~2 cm into each window's edge, the shelf and the keyboard stay below the 0.98 m sill), its back against the lining. Its 0.34 m depth
// is more than the 0.32 m strip, so the keyboard's front edge reaches ~2.3 cm (the shelf's lip ~3.5 cm) over the desk's -Z end, which
// is low there (under 0.75 m over the floor; the shelf's underside is at 0.89 m: tests/train-save-terminal.test.ts measures the desk
// model). The SOLID box (shelf + terminal, player / enemy / hitscan, parked and riding) is the whole fixture, lining to the shelf's
// lip: it overlaps the desk's own solid box by that much (two solids, no gap). The AIM box is the terminal's own box, and it is tested
// before the desk's coarse box (world/playerTrain.ts pickAim): that box covers the terminal's front corner, so a ray on the terminal
// takes it. Like the bench, it is a fixed part of the car, never a layout prop kind, cargo or equipment.

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
  /** The shelf reaches this far beyond the terminal's sides and front (m). */
  lip: 0.012,
  /** The monitor's glass stays at least this far short of the desk's -Z side (m). */
  deskGap: 0.004,
  /** The terminal's back stands this far off the -Z lining (m). */
  wallGap: 0.006,
  /** The most the terminal (its keyboard's front edge) may reach over the desk's -Z side (m; it measures ~2.3 cm). */
  maxOverDesk: 0.04,
  /** The drive controls' standing spot the screen is turned to: this far behind the desk's operator edge, on its centreline (m). */
  driverBack: 0.5,
  /** The model's glass: its front-most point (model z). */
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
  /** Rotation about +Y: 0 keeps the model's +Z front on +Z (inward, across the cab from the -Z wall). */
  yaw: number;
  scale: number;
  /** Runtime size (m): along the car (x) / height / across the car (z). */
  width: number; height: number; depth: number;
  /** The screen's centre on the glass (train-local) and the way it faces (unit, horizontal: +Z). */
  screen: {x: number; y: number; z: number};
  facing: {x: number; z: number};
  /** The drive controls' standing spot (train-local floor point) the screen is turned to. */
  driver: {x: number; z: number};
  /** The monitor body (the parts that rise above the keyboard: model z -0.25 .. faceZ): its x span and z span (back -> glass). */
  monitor: {x0: number; x1: number; z0: number; z1: number};
  /** The terminal's own box (train-local; the aim box). Its front (z1) may reach over the desk's -Z side (overDesk). */
  aim: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  /** How far the terminal's front reaches over the desk's -Z side (m, >= 0). */
  overDesk: number;
  /** The shelf slab (train-local). */
  shelf: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  /** The solid footprint (shelf + terminal: lining to the shelf's lip, over the desk's -Z side by `overDesk` + lip) and its top (train-local y). */
  box: {x0: number; x1: number; z0: number; z1: number};
  top: number;
  /** The car side it is on (-1: the platform side, -Z = the operator's left). */
  side: -1;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const cache = new WeakMap<PlayerTrainSpec, SaveTerminalPlacement | null>();

/** The middle of the solid lining pier between two -Z cab windows nearest the desk's operator edge (null: no such pier). */
function pierX(spec: PlayerTrainSpec, x: number): number | null {
  const w = spec.windows.side.filter(q => q.side === -1 && q.zone === 'cab').sort((a, b) => a.x0 - b.x0);
  let best: number | null = null;
  for (let i = 1; i < w.length; i++) {
    const m = (w[i - 1].x1 + w[i].x0) / 2;
    if (w[i].x0 > w[i - 1].x1 && (best === null || Math.abs(m - x) < Math.abs(best - x))) best = m;
  }
  return best;
}

/**
 * The save terminal's placement in a car (null: no desk facing +X, or no strip beside its -Z end deep enough for the monitor with at
 * most SAVE_TERMINAL.maxOverDesk of keyboard over the desk). Uses the desk's catalogue box around spec.console and the spec's -Z cab
 * windows (deterministic: the parked colliders, the ride model and the view agree).
 */
export function saveTerminalPlacement(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): SaveTerminalPlacement | null {
  if (cache.has(spec)) return cache.get(spec)!;
  let p: SaveTerminalPlacement | null = null;
  const T = SAVE_TERMINAL, M = SAVE_TERMINAL_MODEL, s = T.scale, hw = spec.interior.halfWidth;
  if (Math.abs(spec.console.yaw) < 1e-6) { // (the operator faces +X: left = -Z)
    const cr = consoleLocalRect(spec, null);
    const width = M.w * s, height = M.h * s, depth = M.d * s;
    const z0 = -hw, z1 = cr.z0 - T.deskGap; // (the strip: lining -> the desk's side, less the gap)
    const back = z0 + T.wallGap, z = back + depth / 2, front = z + depth / 2, overDesk = Math.max(0, front - cr.z0);
    if (overDesk <= T.maxOverDesk && z + T.faceZ * s < z1) { // (the monitor stands in the strip; only the keyboard may reach over the desk)
      const x = pierX(spec, cr.x0) ?? cr.x0; // (on the pier between the -Z cab windows; no pier: centred on the desk's operator edge)
      const floorY = spec.floorY, shelfY = floorY + T.shelfY, top = shelfY + height;
      const fx0 = x - width / 2, fx1 = x + width / 2;
      if (fx0 - T.lip > spec.cab.x0 + 0.3 && fx1 + T.lip < spec.interior.x1) {
        const sc = T.screen, gz = z + (screenGlassZ(0, sc.yc) + sc.lift) * s;
        p = Object.freeze({
          x: r4(x), z: r4(z), floorY, shelfY: r4(shelfY), yaw: 0, scale: s,
          width: r4(width), height: r4(height), depth: r4(depth),
          screen: Object.freeze({x: r4(x), y: r4(shelfY + sc.yc * s), z: r4(gz)}),
          facing: Object.freeze({x: 0, z: 1}),
          driver: Object.freeze({x: r4(cr.x0 - T.driverBack), z: r4((cr.z0 + cr.z1) / 2)}),
          monitor: Object.freeze({x0: r4(fx0), x1: r4(fx1), z0: r4(back), z1: r4(z + T.faceZ * s)}),
          aim: Object.freeze({x0: r4(fx0), x1: r4(fx1), y0: r4(shelfY), y1: r4(top), z0: r4(back), z1: r4(front)}),
          overDesk: r4(overDesk),
          shelf: Object.freeze({x0: r4(fx0 - T.lip), x1: r4(fx1 + T.lip), y0: r4(shelfY - T.shelfT), y1: r4(shelfY), z0: r4(z0), z1: r4(front + T.lip)}),
          box: Object.freeze({x0: r4(fx0 - T.lip), x1: r4(fx1 + T.lip), z0: r4(z0), z1: r4(front + T.lip)}),
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
  // yaw 0: the model's axes are the car's
  out.x = p.x + mx * p.scale;
  out.y = p.shelfY + my * p.scale;
  out.z = p.z + mz * p.scale;
  return out;
}
