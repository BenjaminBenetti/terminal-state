// Task office-props-physics-scale-20261030 (lane FURN): LOOSE CLUTTER ON FURNITURE TOPS — pure data / layout (no three.js).
//
// User (2026-10-30): the lab bench's beakers "must be cut out in to there own assets. And placed randomly on top. This way they will
// have phsyics and be interactable!" and the curved monitor desk's "monitors are baked in to desk model instead of being placed on top".
// The lab bench / trading desk models are furniture only now (tools/asset-pipeline/props/build-office-overhaul.mjs FURNITURE); this pass
// puts their separated objects (gen/office/clutterKinds.ts) back on top as HOST DECOR props (`host` = the furniture's index, absolute
// y = its top), seeded per storey (rng fork 'host-clutter': the station's other streams are untouched), finite (placed once with the
// level, never respawned) and supported:
//  - lab bench: a random assortment (a microscope, racks, flasks, bottles) packed at random spots of the 0.9 m worktop, each footprint
//    fully on the top with a 5 cm edge margin and 3 cm between pieces;
//  - trading desk: the monitors on the five stands' spots of the original model along the desk's outer arc (some missing), each
//    turned to face the operator, and the keyboard + mouse at the operator's place (jittered a little).
// Physics (gen/office/physics.ts rows, `onHost`): they rest on the host's top, go loose on bullets / knock-on and fall to the floor.

import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import type {Rng} from '../../core/rng';
import type {ClutterKind} from './clutterKinds';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Prop-frame spots of the trading desk's monitors in the original model (screen centres along the outer arc), as fractions of the
 *  desk's footprint (x / (w/2), z / (d/2)): measured on the D07 manifest-frame components, flipped to the prop frame. */
const MONITOR_SPOTS: readonly (readonly [number, number])[] = [[0.778, -0.048], [0.424, -0.648], [-0.003, -0.869], [-0.428, -0.648], [-0.781, -0.047]];
/** The operator's keyboard spot (prop frame, fractions of the half footprint). */
const KEYBOARD_SPOT = [0.044, -0.2] as const;

/** Lab-bench assortment: [kind, chance, min, max] (count = chance roll, then an int in [min, max]). */
const LAB_SET: readonly (readonly [ClutterKind, number, number, number])[] = [
  ['labMicroscope', 0.45, 1, 1], ['labBottleRack', 0.4, 1, 1], ['labTubeRack', 0.5, 1, 1], ['labFlaskLarge', 0.4, 1, 1],
  ['labFlask', 0.9, 1, 4], ['labBottle', 0.55, 1, 2],
];

/** World AABB half extents of a footprint w x d turned by yaw. */
function halfExtents(kind: PropKind, yaw: number): {hx: number; hz: number} {
  const {w, d} = PROP_DEFS[kind];
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  return {hx: r3((w * c + d * s) / 2), hz: r3((w * s + d * c) / 2)};
}

function decor(props: PropPlacement[], host: PropPlacement, hostIndex: number, kind: ClutterKind, x: number, z: number, yaw: number): PropPlacement {
  const {hx, hz} = halfExtents(kind, yaw);
  const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r3(host.y + host.h), rot: Math.round(yaw * 10000) / 10000, area: host.area, hx, hz, h: PROP_DEFS[kind].h,
    blocksSight: false, variant: 0, host: hostIndex, ...(host.level !== undefined ? {level: host.level} : {})};
  props.push(p);
  return p;
}

/** Host-local (prop frame) -> world. */
function toWorld(host: PropPlacement, lx: number, lz: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  return [host.x + c * lx + s * lz, host.z - s * lx + c * lz];
}

/** Lab bench: a random assortment packed on the worktop (host-local rectangles, no overlap). Returns the pieces placed. */
function labBench(props: PropPlacement[], host: PropPlacement, hostIndex: number, rng: Rng): number {
  const def = PROP_DEFS[host.kind], M = 0.05, GAP = 0.03;
  const taken: [number, number, number, number][] = [];
  let n = 0;
  for (const [kind, chance, lo, hi] of LAB_SET) {
    if (!rng.chance(chance)) continue;
    const count = rng.int(lo, hi);
    for (let i = 0; i < count; i++) {
      // racks / microscope face the front or the back (quarter turns), round glassware any way round
      const yawL = kind === 'labFlask' || kind === 'labFlaskLarge' || kind === 'labBottle' ? rng.range(-Math.PI, Math.PI) : rng.pick([0, Math.PI, Math.PI / 2, -Math.PI / 2]);
      const {hx, hz} = halfExtents(kind, yawL);
      const ax = def.w / 2 - M - hx, az = def.d / 2 - M - hz;
      if (ax <= 0 || az <= 0) continue;
      for (let t = 0; t < 24; t++) {
        const lx = rng.range(-ax, ax), lz = rng.range(-az, az);
        const box: [number, number, number, number] = [lx - hx, lz - hz, lx + hx, lz + hz];
        if (taken.some(b => box[0] < b[2] + GAP && box[2] > b[0] - GAP && box[1] < b[3] + GAP && box[3] > b[1] - GAP)) continue;
        taken.push(box);
        const [x, z] = toWorld(host, lx, lz);
        decor(props, host, hostIndex, kind, x, z, host.rot + yawL);
        n++;
        break;
      }
    }
  }
  return n;
}

/** Trading desk: monitors on the original stands' spots facing the operator (some missing), keyboard + mouse at the operator's place. */
function tradingDesk(props: PropPlacement[], host: PropPlacement, hostIndex: number, rng: Rng): number {
  const def = PROP_DEFS[host.kind];
  const focus: [number, number] = [0, def.d * 0.45]; // the operator, in front of the desk's concave side (prop +Z)
  let n = 0;
  for (const [fx, fz] of MONITOR_SPOTS) {
    if (!rng.chance(0.85)) continue;
    const sx = fx * def.w / 2 + rng.range(-0.03, 0.03), sz = fz * def.d / 2 + rng.range(-0.02, 0.02);
    const yawL = Math.atan2(focus[0] - sx, focus[1] - sz) + rng.range(-0.06, 0.06);
    // the spot is the screen; the monitor's footprint centre is 6 cm in front of it (its foot reaches toward the operator)
    const lx = sx + 0.06 * Math.sin(yawL), lz = sz + 0.06 * Math.cos(yawL);
    const [x, z] = toWorld(host, lx, lz);
    decor(props, host, hostIndex, 'tradingMonitor', x, z, host.rot + yawL);
    n++;
  }
  if (rng.chance(0.8)) {
    const lx = KEYBOARD_SPOT[0] * def.w / 2 + rng.range(-0.06, 0.06), lz = KEYBOARD_SPOT[1] * def.d / 2 + rng.range(-0.03, 0.03);
    const [x, z] = toWorld(host, lx, lz);
    decor(props, host, hostIndex, 'tradingKeyboard', x, z, host.rot + rng.range(-0.15, 0.15));
    n++;
  }
  return n;
}

/**
 * Puts the loose clutter on every lab bench / trading desk of `level` that carries no host decor yet (index order; `rng` = the
 * storey's 'host-clutter' fork). Returns the number of pieces placed.
 */
export function placeHostClutter(props: PropPlacement[], level: number, rng: Rng): number {
  const n0 = props.length;
  let n = 0;
  for (let i = 0; i < n0; i++) {
    const p = props[i];
    if ((p.level ?? 0) !== level || (p.kind !== 'labBench' && p.kind !== 'tradingDesk') || p.h <= 0.02) continue;
    if (props.some(q => q.host === i && q.y > p.y + 0.01)) continue;
    n += p.kind === 'labBench' ? labBench(props, p, i, rng) : tradingDesk(props, p, i, rng);
  }
  return n;
}
