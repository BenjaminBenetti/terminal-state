// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): WHERE the train armour sits on the car and WHAT counts as touching it —
// the pure geometry of world/trainArmor.ts (no scene, no Game). User: "Train plating/blades: permanent ONE-TIME 10-scrap_metal upgrade, no
// durability. Deliver striking all-around Mad Max: Fury Road-inspired plating/blades. About 5 seconds of continuous contact kills a
// regular zombie; contact damage targets zombies ONLY. Preserve doors, windows, controls, Save and travel."
//
// THE KIT (the lead's cooked Meshy models, assets/trainArmor.generated.ts; frames: origin = bottom centre of the BACK face, +Y up, the
// blades / fins toward +Z, metres at the reference size):
//  - SIDE skirt segments — rusted welded plates with a row of downward / outward blades and two saw discs — along BOTH sides of the lower
//    body, as one continuous belt (the same height and depth everywhere) at TRAIN_ARMOR.side.y0, between the doors: every door's opening
//    AND its leaves' whole travel into the wall pockets (leafSpan at fully open) stays bare, plus `clear`. A free span gets
//    round(length / nominal) segments stretched / squeezed along X to fill it exactly (the measured spans give 0.80 .. 1.05 of the uniform
//    scale: no saw disc is visibly an oval); a span shorter than `minLen` (the 0.69 m rear corner behind the rear doors' pockets) stays bare.
//    Today: per side 2 + 1 + 1 segments (the saloon span between the rear and middle doors, the one between the middle and front doors, the
//    cab span), 8 in all; the belt is y 1.10 .. 1.50, 0.22 m deep.
//    Back face on the skin (measured on the cooked shell at y 1.1 .. 1.6: |z| 1.42 .. 1.45 on the platform side, 1.46 .. 1.49 on the far
//    side — the shell is not quite symmetric), the -Z side turned half round (never mirrored: no flipped pipeline).
//  - END ploughs across the front and rear ends: the back plate at |x| = TRAIN_ARMOR.end.x (just ahead of the end face's lamp-housing lip,
//    so the couplers, |x| <= 8.13, are inside the plough), from y0 (over the third rail's coverboard, top 0.18 above the rail top) to below
//    the head / tail lamps (y 1.28 .. 1.44) and the end windows (y >= 1.88).
// Clearances measured, not assumed (tests/train-armor.test.ts): the windows, lamps, door openings / pockets and the platform curbs' boarding
// path stay clear; everything stays inside the 0.507 m platform gap (|z| < 2.0) and inside the ride box (RIDE_BOX.half 1.95) clear of the
// open portal gate leaves (|z| > 1.743) and the transit tunnel's signal housings; nothing reaches a column of a two-track bed (faces
// 1.75 from the track) or any other layout prop at the corpora's placements.
//
// THE CONTACT RULE (zombies only; world/trainArmor.ts applies it while the car stands parked): a living enemy's body circle within
// ARMOR_CONTACT.reach of a piece's OUTER face — its centre outside the hull (beyond the piece's back face), along the piece (its x span +
// tolX for a side segment, its z span + tolX for a plough), its body's height range overlapping the piece's (+- tolY), and never within
// doorClear of a door opening on that side (a body in an open doorway or on its platform bridge is never "against the blades"). The reach
// is 0.4 m because the platform gap beside the car is closed by the curbs up to the car floor: a zombie pressing at the platform edge beside
// the plates stands 0.34 m from the blade line (its arms are in them); a body in the track bed walks right up to the plates (collision).

import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {leafSpan, wallSpans} from './playerTrainView';
import {TRAIN_ARMOR_MODELS} from '../assets/trainArmor.generated';

/** Layout tuning (train-local m; rail top = y 0). */
export const TRAIN_ARMOR = {
  side: {
    /** Uniform Y / Z scale of a side segment (and its nominal X scale): 0.40 m tall, 0.22 m deep at the blade tips. */
    scale: 0.8,
    /** Bottom of the belt above the rail top: mid-panel between the car floor line (0.98) and the windows (>= 1.91). */
    y0: 1.1,
    /** |z| of the back face (the measured skin at the belt's height), platform side (-Z) / far side (+Z). */
    skinNeg: 1.44,
    skinPos: 1.475,
    /** Gap kept to every door's opening + leaf pocket ends (m). */
    clear: 0.04,
    /** |x| limit of the belt: the body's side turns into the rounded corner at |x| 7.40 (|z| 1.3 .. 1.5). */
    end: 7.36,
    /** A free span shorter than this stays bare (no squashed segment). */
    minLen: 1.2,
  },
  end: {
    /** Uniform scale of the plough: 2.86 m wide (the body is 2.99), 0.75 m tall, 0.61 m deep. */
    scale: 1.1,
    /** Bottom above the rail top (the coverboard's top is 0.18 above it at |z| 1.24 .. 1.56). */
    y0: 0.22,
    /** |x| of the back plate. */
    x: 7.74,
  },
} as const;

/** The contact rule (see the file header). */
export const ARMOR_CONTACT = {
  /** Damage per second of contact: a regular zombie (shambler, 100 hp) dies after 5.0 s; a coated one (165 hp) after 8.25 s; any other
   *  enemy after its own hp / dps. */
  dps: 20,
  /** Body circle -> a piece's outer face (m). */
  reach: 0.4,
  /** Along-the-piece overhang (m) and the vertical overlap tolerance (m). */
  tolX: 0.1,
  tolY: 0.1,
  /** No contact within this of a door opening's jambs on the same side (m). */
  doorClear: 0.5,
  /** Body height when an enemy has none in its stats (m). */
  height: 1.7,
  /** Seconds between two blood puffs on one body in contact; at most `maxFx` puffs per frame. */
  feedbackS: 0.6,
  maxFx: 4,
} as const;

/** A train-local axis-aligned box (m). */
export interface ArmorBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface ArmorPiece {
  kind: 'side' | 'end';
  /** side: the car side (-1 platform / +1 far); end: -1 rear / +1 front. */
  dir: -1 | 1;
  /** The model's origin in the car frame, its yaw about +Y, its scale along its own X / Y / Z. */
  pos: readonly [number, number, number];
  yaw: number;
  scale: readonly [number, number, number];
  /** The piece's train-local box (its model box through the transform). */
  box: ArmorBox;
  /** |z| (side) / |x| (end) of its back face (the hull side) and its outer face (the blade tips). */
  back: number;
  outer: number;
}

export interface ArmorLayout {
  pieces: readonly ArmorPiece[];
  /** Every piece's box (colliders: world/playerTrain.ts armorColliders, world/trainRideLocal.ts setRideArmorBoxes). */
  boxes: readonly ArmorBox[];
  /** The door openings per side ([x0, x1] train-local) the contact rule keeps clear. */
  doors: readonly {side: -1 | 1; x0: number; x1: number}[];
}

/** The models' reference dims [along X, height, depth along Z] (m). */
export interface ArmorDims { side: readonly [number, number, number]; end: readonly [number, number, number] }
export const ARMOR_DIMS: ArmorDims = {side: TRAIN_ARMOR_MODELS.side.dims, end: TRAIN_ARMOR_MODELS.end.dims};

/** The free x spans of one side for the belt: [-end, end] minus every door's opening + leaf travel (+ clear); short spans dropped. */
export function sideFreeSpans(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, side: -1 | 1): [number, number][] {
  const A = TRAIN_ARMOR.side, lw = spec.doorLeaf.width;
  const cuts = spec.doors.filter(d => d.side === side).map(d => [leafSpan(d, 0, 1, lw)[0] - A.clear, leafSpan(d, 1, 1, lw)[1] + A.clear] as const);
  return wallSpans(-A.end, A.end, cuts).filter(([a, b]) => b - a >= A.minLen);
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The kit on the car (pure; the same for every station: the car frame). */
export function armorLayout(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, dims: ArmorDims = ARMOR_DIMS): ArmorLayout {
  const S = TRAIN_ARMOR.side, E = TRAIN_ARMOR.end;
  const [sL, sH, sD] = dims.side, [eW, eH, eD] = dims.end;
  const pieces: ArmorPiece[] = [];
  for (const dir of [-1, 1] as const) {
    const skin = dir < 0 ? S.skinNeg : S.skinPos, k = S.scale, depth = sD * k;
    for (const [a, b] of sideFreeSpans(spec, dir)) {
      const n = Math.max(1, Math.round((b - a) / (sL * k))), len = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const x0 = a + i * len, x1 = x0 + len;
        pieces.push({
          kind: 'side', dir, pos: [r6((x0 + x1) / 2), S.y0, dir * skin], yaw: dir > 0 ? 0 : Math.PI, scale: [r6(len / sL), k, k],
          box: {x0: r6(x0), x1: r6(x1), y0: S.y0, y1: r6(S.y0 + sH * k), z0: dir > 0 ? skin : r6(-skin - depth), z1: dir > 0 ? r6(skin + depth) : -skin},
          back: skin, outer: r6(skin + depth),
        });
      }
    }
  }
  for (const dir of [1, -1] as const) {
    const k = E.scale, depth = eD * k, half = (eW * k) / 2;
    pieces.push({
      kind: 'end', dir, pos: [dir * E.x, E.y0, 0], yaw: dir * Math.PI / 2, scale: [k, k, k],
      box: {x0: dir > 0 ? E.x : r6(-E.x - depth), x1: dir > 0 ? r6(E.x + depth) : -E.x, y0: E.y0, y1: r6(E.y0 + eH * k), z0: r6(-half), z1: r6(half)},
      back: E.x, outer: r6(E.x + depth),
    });
  }
  const doors = spec.doors.map(d => ({side: d.side, x0: d.x - d.width / 2, x1: d.x + d.width / 2}));
  return {pieces, boxes: pieces.map(p => p.box), doors};
}

let defaultLayout: ArmorLayout | null = null;
/** The default car's layout (memoized). */
export function trainArmorLayout(): ArmorLayout {
  return (defaultLayout ??= armorLayout());
}

/** A piece touched by a body (train-local): the piece, the outward normal (horizontal), the contact point on its outer face, the gap. */
export interface ArmorHit { piece: ArmorPiece; nx: number; nz: number; x: number; y: number; z: number; gap: number }

/**
 * The contact rule (file header) for one body: feet at (lx, ly, lz) train-local, circle radius r, standing `height` tall. The nearest
 * touched piece, or null.
 */
export function armorContact(layout: ArmorLayout, lx: number, ly: number, lz: number, r: number, height: number = ARMOR_CONTACT.height): ArmorHit | null {
  const C = ARMOR_CONTACT;
  let best: ArmorHit | null = null;
  for (const p of layout.pieces) {
    const b = p.box;
    if (ly >= b.y1 + C.tolY || ly + height <= b.y0 - C.tolY) continue;
    let gap: number, nx = 0, nz = 0, cx: number, cz: number;
    if (p.kind === 'side') {
      const s = p.dir, out = s * lz;
      if (out < p.back) continue; // inside the hull's skin line (in the car, in its wall)
      if (lx < b.x0 - C.tolX || lx > b.x1 + C.tolX) continue;
      if (layout.doors.some(d => d.side === s && lx > d.x0 - C.doorClear && lx < d.x1 + C.doorClear)) continue;
      gap = out - r - p.outer;
      nz = s; cx = Math.min(b.x1, Math.max(b.x0, lx)); cz = s * p.outer;
    } else {
      const e = p.dir, out = e * lx;
      if (out < p.back) continue;
      if (lz < b.z0 - C.tolX || lz > b.z1 + C.tolX) continue;
      gap = out - r - p.outer;
      nx = e; cx = e * p.outer; cz = Math.min(b.z1, Math.max(b.z0, lz));
    }
    if (gap > C.reach || (best && gap >= best.gap)) continue;
    const cy = Math.min(b.y1, Math.max(b.y0, ly + Math.min(height, 1.2)));
    best = {piece: p, nx, nz, x: cx, y: cy, z: cz, gap};
  }
  return best;
}
