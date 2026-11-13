// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR) + task studio-train-armor-makeover-20261113-183146-01 (the makeover): WHERE
// the train armour sits on the car and WHAT counts as touching it — the pure geometry of world/trainArmor.ts (no scene, no Game). User:
// "Train plating/blades: permanent ONE-TIME 10-scrap_metal upgrade, no durability. Deliver striking all-around Mad Max: Fury Road-inspired
// plating/blades. About 5 seconds of continuous contact kills a regular zombie; contact damage targets zombies ONLY. Preserve doors,
// windows, controls, Save and travel." The makeover (user: the first kit was lackluster — "really bulk up the armor… add more… make the
// train look really cool"): a heavy armoured car — larger overlapping plates, heavier lower-body skirts, reinforced corners, bigger end
// ploughs and blades all round — from the SAME record flag (run/trainUpgrades.ts: an armoured save shows the new kit, nothing to craft
// again) under the SAME recipe and contact rule.
//
// THE KIT (cooked Meshy models; frames: origin = bottom centre of the BACK face, +Y up, the blades / fins toward +Z, metres at the
// reference size — assets/trainArmor.generated.ts: the first kit's blade strip and fin grille, reused; assets/trainArmorKit.generated.ts:
// the makeover's body plate, buttress post, plough wing and roof-line rail). Every piece is one instance of a model:
// T(pos) . R_y(yaw) . S(scale), some drawn MIRRORED in the model's own X (a second, opposite-handed look of the same model: the mirror is
// in the geometry, never a negative scale — no flipped pipeline).
//  SIDES (both, -Z platform / +Z far; the -Z side turned half round):
//  - SKIRT: the lower body from just over the third rail's coverboard to the floor line, end to end and UNDER the doors (it hangs below
//    the sills: nothing of it stands in a doorway) — the blade strip between the bogies, the fin grille as a deeper GUARD over each bogie.
//  - PLATES: the belt between the floor line and the window sills — body plates side by side between the doors (door openings + doorGap
//    stay bare; on the platform side also the fuel cap's bay), alternately mirrored, every second one standing a little prouder, a little
//    lower and lapping over its neighbours' edges (the door leaves slide INSIDE the skin: a plate over a leaf pocket touches nothing).
//  - PILLARS: a buttress post up every solid pillar of the window band wide enough for one (never over glass, a door or the fuel cap).
//  - RAIL: the roof-line rail end to end along the cant rail, over the windows' and the doors' heads (above head height: nothing of it
//    stands in a doorway), its fins raked toward the rear on both sides (the platform side's rails are the mirrored copies).
//  ENDS (both):
//  - PLOUGH: a wedge of two plough WINGS from the body's corners to a tip ahead of the coupler, a corner TOWER (a buttress post in the
//    wing's line) at the outer end of each wing up to the window sills — the reinforced corner — and a PROW post over the tip. The wings
//    stay under the head / tail lamps; the towers stand outboard of them; the prow is on the centre line between them.
//  - BROW: one roof-line rail across the end face above the windscreen between the marker lamps (inside the car's own end box).
// Clearances measured, not assumed (tests/train-armor.test.ts, tests/train-armor-clearance.test.ts): the windows, lamps, door openings,
// the fuel cap and the platform curbs' boarding path stay clear; everything stays inside the 0.507 m platform gap (|z| < 2.0) and inside
// the ride box (RIDE_BOX.half 1.95) clear of the open portal gate leaves (|z| > 1.743), under the transit tunnel's signal housings
// (|z| >= 1.72 from y 2.10: the kit is <= 1.64 up there) and the sentry turret's lines of fire; nothing reaches a column of a two-track bed
// (faces 1.75 from the track), a bed's spawn / pickup clearance (0.6 beyond the body: the prow ends 0.45 beyond it) or any other layout
// prop at the corpora's placements.
//
// SOLIDS: what collides and what a body can touch. Every bladed piece is one axis-aligned box, except the slanted plough wings / towers:
// slices along the wing (a staircase that contains the slab, at most 7 cm proud of it). The skirt's box is cut at every door opening
// (+ doorGap): the stretch under a door's sill keeps a LOW movement column (`colTop`: it stops a body in the bed, never one stepping
// from a platform — which may lie up to gen/playerTrain.ts TRAIN_CLEAR.maxStep under the car floor — onto the door's bridge). The
// pillars and the rails are `overhead`: shots stop on them (one box per pillar, one per side for the rail's run), no movement column
// (they stand over the plates / over head height) and no contact (the rule's blades are the ones a body walks into). The brow has no
// box: it lies inside the car's own end box.
//
// THE CONTACT RULE (zombies only; world/trainArmor.ts applies it while the car stands parked; UNCHANGED by the makeover — only the
// geometry it reads): a living enemy's body circle within ARMOR_CONTACT.reach of a solid's OUTER face — its centre outside the hull
// (beyond the solid's back face), along the solid (its x span + tolX for a side face, its z span + tolX for an end face), its body's
// height range overlapping the solid's (+- tolY), and never within doorClear of a door opening on that side (a body in an open doorway
// or on its platform bridge is never "against the blades"). The reach is 0.4 m because the platform gap beside the car is closed by the
// curbs up to the car floor: a zombie pressing at the platform edge beside the plates stands about 0.3 m from the blade line (its arms
// are in them); a body in the track bed walks right up to the plates (collision).

import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {wallSpans} from './playerTrainView';
import {fuelPortLocal} from '../fuel/trainPort';
import {TRAIN_CLEAR} from '../gen/playerTrain';
import {TRAIN_ARMOR_MODELS} from '../assets/trainArmor.generated';
import {TRAIN_ARMOR_KIT_MODELS} from '../assets/trainArmorKit.generated';

/** The kit's cooked models (the prop library's keys / urls; dims = [along X, height, depth along Z] at the reference size). */
export const ARMOR_MODELS = {
  strip: TRAIN_ARMOR_MODELS.side,
  grille: TRAIN_ARMOR_MODELS.end,
  plate: TRAIN_ARMOR_KIT_MODELS.plate,
  post: TRAIN_ARMOR_KIT_MODELS.post,
  wing: TRAIN_ARMOR_KIT_MODELS.wing,
  rail: TRAIN_ARMOR_KIT_MODELS.rail,
} as const;
export type ArmorModelId = keyof typeof ARMOR_MODELS;
export const ARMOR_MODEL_IDS = Object.keys(ARMOR_MODELS) as ArmorModelId[];

/** Layout tuning (train-local m; rail top = y 0; the body: |x| <= 8.10, skin |z| 1.43 .. 1.49, end faces |x| 7.73 .. 7.77). */
export const TRAIN_ARMOR = {
  /** |z| of the side pieces' back face (the measured skin of the belt / window band), platform side (-Z) / far side (+Z). */
  skinNeg: 1.44,
  skinPos: 1.475,
  /** |x| limit of the side kit: the body's side turns into the rounded corner (|z| 1.39 at |x| 7.3, 1.27 at 7.45). */
  sideEnd: 7.42,
  /** Gap kept to every door opening's jambs by the plates and the pillars (m). */
  doorGap: 0.15,
  skirt: {
    /** Bottom over the rail top (the coverboard's top is 0.18 above it at |z| 1.24 .. 1.56) .. top just under the floor line (0.98). */
    y0: 0.24,
    y1: 0.92,
    /** |z| of the back face (the underframe's equipment reaches |z| 1.30 .. 1.38) and the strips' depth at the blade tips. */
    back: 1.4,
    depth: 0.225,
    /** Blade strips between the bogie guards. */
    strips: 3,
    /** A bogie guard: from this far inboard of sideEnd (the wheels span |x| 4.2 .. 7.0) to sideEnd; a little deeper than the strips. */
    guardLen: 3.35,
    guardDepth: 0.25,
    /** Under a door (+ doorGap) the skirt's movement column ends this far under the lowest platform a door can open onto. */
    doorColumn: 0.03,
  },
  plate: {
    /** The belt: over the skirt's top edge .. under the window sills (>= 1.91). */
    y0: 0.9,
    y1: 1.86,
    /** Nominal plate length (the model's); a free span takes round(length / nominal) plates. */
    nominal: 1.2,
    /** Depth at the fin tips: flush plates / the prouder (odd) ones, which also hang `drop` lower and lap `lap` over each neighbour. */
    depth: 0.19,
    proud: 0.215,
    drop: 0.03,
    lap: 0.03,
    /** The fuel cap's bay on the platform side: this far either side of the cap stays bare (the cap, its aim box, the pour, the hose). */
    fuelBay: 0.3,
  },
  pillar: {
    /** The window band: over the plates .. under the sentry turret's lowest lines of fire beside the car (3.147 at |z| 1.64: measured,
     *  tests/train-armor.test.ts). */
    y0: 1.88,
    y1: 3.12,
    /** A post's width on the car: a solid span of the band (glass + winGap, door + doorGap, fuel bay apart) at least minSpan wide takes
     *  one, centred, min(width, span - 2 * edge) wide. */
    width: 0.48,
    minSpan: 0.46,
    edge: 0.02,
    winGap: 0.04,
    /** Depth: |z| <= 1.64 up here (the transit tunnel's signal housings start at |z| 1.72). */
    depth: 0.165,
    /** |x| limit: beyond it the corner's wrap-round glass. */
    end: 7.15,
  },
  rail: {
    /** The cant rail: over the doors' heads (2.981) and the windows .. under the sentry turret's lowest lines of fire beside the car
     *  (3.168 at |z| 1.605). */
    y0: 2.99,
    y1: 3.15,
    /** Nominal length (the model's), depth at the fin tips (|z| <= 1.61 up here: the tunnel's cable tray starts at 1.71) and the |x|
     *  limit (beyond it the roof turns down into the end cap). */
    nominal: 1.6,
    depth: 0.13,
    end: 7.15,
  },
  plough: {
    /** Bottom above the rail top (as the skirt: over the coverboard) and the wings' height: their top stays under the lamps (lens bottom 1.29). */
    y0: 0.22,
    wingH: 1.0,
    /** The wedge in plan, per end and side: the BACK face runs from the corner (|x|, |z|) to the tip on the centre line; the slab is
     *  `depth` thick along its normal. The bumper (|x| <= 8.07) and the coupler (<= 8.13) are inside the wedge. */
    cornerX: 7.45,
    cornerZ: 1.56,
    tipX: 8.33,
    depth: 0.25,
    /** The corner tower: the first `towerLen` of the wing's line, up to the window sills. */
    towerLen: 0.5,
    towerH: 1.64,
    /** The prow post over the tip: its back face |x|, width, height, depth (ends 0.45 m beyond the body's end). */
    prowX: 8.29,
    prowW: 0.5,
    prowH: 1.4,
    prowDepth: 0.26,
    /** Collision / contact slices along the tower / the wing (boxes that contain the slanted slab: at most 7 cm proud of its face). */
    towerSlices: 3,
    wingSlices: 8,
  },
  brow: {
    /** The end face's |x|, the bottom (over the windscreens, tops <= 3.07), and the rail's length (between the marker lamps, |z| 0.76),
     *  height and depth there. */
    x: 7.74,
    y0: 3.12,
    length: 1.4,
    height: 0.21,
    depth: 0.2,
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

/** A train-local axis-aligned box (m). `overhead`: no movement column under it (shots only). `colTop`: its movement column ends at
 *  this height (below y1: the skirt under a door's sill); shots meet the whole box. */
export interface ArmorBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; overhead?: boolean; colTop?: number }

/** What a piece is on the car. */
export type ArmorPart = 'skirt' | 'guard' | 'plate' | 'pillar' | 'rail' | 'tower' | 'wing' | 'prow' | 'brow';

export interface ArmorPiece {
  part: ArmorPart;
  model: ArmorModelId;
  /** Drawn mirrored in the model's own X (see the file header). */
  mirror: boolean;
  /** 'side': on a body side, dir = the side (-1 platform / +1 far); 'end': on an end, dir = -1 rear / +1 front. */
  kind: 'side' | 'end';
  dir: -1 | 1;
  /** The model's origin in the car frame, its yaw about +Y, its scale along its own X / Y / Z. */
  pos: readonly [number, number, number];
  yaw: number;
  scale: readonly [number, number, number];
  /** The piece's train-local bounds (its model box through the transform). */
  box: ArmorBox;
}

/** A face a body can touch (the contact rule): a box, the way its blades face, its back (hull side) and outer (blade tips) planes. */
export interface ArmorSolid {
  part: ArmorPart;
  /** 'side': the blades face +-Z (dir = the side), back / outer are |z|; 'end': they face +-X (dir = the end), back / outer are |x|. */
  kind: 'side' | 'end';
  dir: -1 | 1;
  box: ArmorBox;
  back: number;
  outer: number;
}

export interface ArmorLayout {
  pieces: readonly ArmorPiece[];
  /** The contact rule's faces. */
  solids: readonly ArmorSolid[];
  /** The colliders' boxes (world/playerTrain.ts armorColliders, world/trainRideLocal.ts setRideArmorBoxes). */
  boxes: readonly ArmorBox[];
  /** The door openings per side ([x0, x1] train-local) the contact rule keeps clear. */
  doors: readonly {side: -1 | 1; x0: number; x1: number}[];
}

/** The models' reference dims [along X, height, depth along Z] (m). */
export type ArmorDims = Record<ArmorModelId, readonly [number, number, number]>;
export const ARMOR_DIMS: ArmorDims = Object.fromEntries(ARMOR_MODEL_IDS.map(id => [id, ARMOR_MODELS[id].dims])) as ArmorDims;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The train-local bounds of a model box [-L/2, L/2] x [0, H] x [0, D] through T(pos) . R_y(yaw) . S(scale). */
export function pieceBounds(pos: readonly [number, number, number], yaw: number, scale: readonly [number, number, number], dims: readonly [number, number, number]): ArmorBox {
  const c = Math.cos(yaw), s = Math.sin(yaw), hx = (dims[0] * scale[0]) / 2, d = dims[2] * scale[2];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const lx of [-hx, hx]) for (const lz of [0, d]) {
    const x = pos[0] + lx * c + lz * s, z = pos[2] - lx * s + lz * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return {x0: r6(x0), x1: r6(x1), y0: r6(pos[1]), y1: r6(pos[1] + dims[1] * scale[1]), z0: r6(z0), z1: r6(z1)};
}

/** The door openings of one side (+ gap either side), ascending. */
function doorCuts(spec: PlayerTrainSpec, side: -1 | 1, gap: number): [number, number][] {
  return spec.doors.filter(d => d.side === side).map(d => [d.x - d.width / 2 - gap, d.x + d.width / 2 + gap] as [number, number]);
}

/** The fuel cap's bay ([x0, x1] on the platform side; none on the far side). */
export function fuelBay(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, side: -1 | 1): [number, number] | null {
  if (side !== -1) return null;
  const x = fuelPortLocal(spec).x, h = TRAIN_ARMOR.plate.fuelBay;
  return [x - h, x + h];
}

/** The free x spans of one side for the belt's plates: [-sideEnd, sideEnd] minus every door opening (+ doorGap) and the fuel cap's bay. */
export function plateSpans(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, side: -1 | 1): [number, number][] {
  const A = TRAIN_ARMOR, bay = fuelBay(spec, side);
  return wallSpans(-A.sideEnd, A.sideEnd, [...doorCuts(spec, side, A.doorGap), ...(bay ? [bay] : [])]).filter(([a, b]) => b - a >= A.plate.nominal * 0.6);
}

/** The solid x spans of one side's window band wide enough for a pillar: no glass (+ winGap), door (+ doorGap) or fuel bay. */
export function pillarSpans(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, side: -1 | 1): [number, number][] {
  const A = TRAIN_ARMOR, P = A.pillar, bay = fuelBay(spec, side);
  const glass = spec.windows.side.filter(w => w.side === side && w.y1 > P.y0 && w.y0 < P.y1).map(w => [w.x0 - P.winGap, w.x1 + P.winGap] as [number, number]);
  return wallSpans(-P.end, P.end, [...doorCuts(spec, side, A.doorGap), ...glass, ...(bay ? [bay] : [])]).filter(([a, b]) => b - a >= P.minSpan);
}

/** The kit on the car (pure; the same for every station: the car frame). */
export function armorLayout(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, dims: ArmorDims = ARMOR_DIMS): ArmorLayout {
  const A = TRAIN_ARMOR;
  const pieces: ArmorPiece[] = [], solids: ArmorSolid[] = [], boxes: ArmorBox[] = [];
  const piece = (part: ArmorPart, model: ArmorModelId, kind: 'side' | 'end', dir: -1 | 1, pos: [number, number, number], yaw: number, size: [number, number, number], mirror = false): ArmorPiece => {
    const d = dims[model], scale: [number, number, number] = [r6(size[0] / d[0]), r6(size[1] / d[1]), r6(size[2] / d[2])];
    const p: ArmorPiece = {part, model, mirror, kind, dir, pos: [r6(pos[0]), r6(pos[1]), r6(pos[2])], yaw, scale, box: pieceBounds(pos, yaw, scale, d)};
    pieces.push(p);
    return p;
  };
  /** A piece standing square on a side: [x0, x1] along the car, y0 up `h`, from |z| = back out `depth`; its box is its solid. */
  const onSide = (part: ArmorPart, model: ArmorModelId, side: -1 | 1, x0: number, x1: number, y0: number, h: number, back: number, depth: number, o: {mirror?: boolean; overhead?: boolean; noBox?: boolean; underDoors?: boolean} = {}): ArmorPiece => {
    const p = piece(part, model, 'side', side, [(x0 + x1) / 2, y0, side * back], side > 0 ? 0 : Math.PI, [x1 - x0, h, depth], o.mirror);
    if (o.noBox) return p;
    if (o.overhead) { boxes.push({...p.box, overhead: true}); return p; }
    if (o.underDoors) {
      // the skirt: its box cut at the doors — a low column under each door's sill (see the file header)
      const cuts = doorCuts(spec, side, A.doorGap), colTop = r6(spec.floorY - TRAIN_CLEAR.maxStep - A.skirt.doorColumn);
      for (const [a, b] of wallSpans(p.box.x0, p.box.x1, cuts)) boxes.push({...p.box, x0: r6(a), x1: r6(b)});
      for (const [a, b] of cuts) if (b > p.box.x0 && a < p.box.x1) boxes.push({...p.box, x0: r6(Math.max(a, p.box.x0)), x1: r6(Math.min(b, p.box.x1)), colTop});
    } else boxes.push(p.box);
    solids.push({part, kind: 'side', dir: side, box: p.box, back: r6(back), outer: r6(back + depth)});
    return p;
  };

  for (const side of [-1, 1] as const) {
    const skin = side < 0 ? A.skinNeg : A.skinPos;
    // the skirt: a guard over each bogie, blade strips between them
    const K = A.skirt, h = K.y1 - K.y0, g0 = A.sideEnd - K.guardLen;
    onSide('guard', 'grille', side, -A.sideEnd, -g0, K.y0, h, K.back, K.guardDepth, {underDoors: true});
    for (let i = 0; i < K.strips; i++) {
      const len = (2 * g0) / K.strips;
      onSide('skirt', 'strip', side, -g0 + i * len, -g0 + (i + 1) * len, K.y0, h, K.back, K.depth, {underDoors: true});
    }
    onSide('guard', 'grille', side, g0, A.sideEnd, K.y0, h, K.back, K.guardDepth, {underDoors: true});
    // the belt's plates
    const P = A.plate;
    let k = 0;
    for (const [a, b] of plateSpans(spec, side)) {
      const n = Math.max(1, Math.round((b - a) / P.nominal)), len = (b - a) / n;
      for (let i = 0; i < n; i++, k++) {
        const odd = k % 2 === 1, lapA = odd && i > 0 ? P.lap : 0, lapB = odd && i < n - 1 ? P.lap : 0;
        onSide('plate', 'plate', side, a + i * len - lapA, a + (i + 1) * len + lapB, P.y0 - (odd ? P.drop : 0), P.y1 - P.y0, skin, odd ? P.proud : P.depth, {mirror: odd});
      }
    }
    // the window band's pillars
    const Q = A.pillar;
    for (const [a, b] of pillarSpans(spec, side)) {
      const w = Math.min(Q.width, b - a - 2 * Q.edge), c = (a + b) / 2;
      onSide('pillar', 'post', side, c - w / 2, c + w / 2, Q.y0, Q.y1 - Q.y0, skin, Q.depth, {overhead: true});
    }
    // the roof-line rail: one run end to end (one box for the run)
    const R = A.rail, rn = Math.max(1, Math.round((2 * R.end) / R.nominal)), rl = (2 * R.end) / rn;
    for (let i = 0; i < rn; i++) onSide('rail', 'rail', side, -R.end + i * rl, -R.end + (i + 1) * rl, R.y0, R.y1 - R.y0, skin, R.depth, {mirror: side < 0, noBox: true});
    boxes.push({x0: -R.end, x1: R.end, y0: R.y0, y1: R.y1, z0: r6(side > 0 ? skin : -skin - R.depth), z1: r6(side > 0 ? skin + R.depth : -skin), overhead: true});
  }

  const G = A.plough, L = Math.hypot(G.tipX - G.cornerX, G.cornerZ);
  /** Along the wing's back line (corner -> tip) and its outward normal, for the +X end's +Z wing (others by symmetry). */
  const ux = (G.tipX - G.cornerX) / L, uz = -G.cornerZ / L, nx = -uz, nz = ux;
  for (const end of [1, -1] as const) {
    for (const side of [-1, 1] as const) {
      /** The back line's point `d` along it, and the slab's slice [d0, d1] as a box up to `top`. */
      const at = (d: number): [number, number] => [end * (G.cornerX + d * ux), side * (G.cornerZ + d * uz)];
      const slice = (part: ArmorPart, d0: number, d1: number, top: number): void => {
        const xa = G.cornerX + d0 * ux, xb = G.cornerX + d1 * ux + G.depth * nx, za = G.cornerZ + d1 * uz, zb = G.cornerZ + d0 * uz + G.depth * nz;
        const box: ArmorBox = {x0: r6(end > 0 ? xa : -xb), x1: r6(end > 0 ? xb : -xa), y0: G.y0, y1: r6(G.y0 + top), z0: r6(side > 0 ? za : -zb), z1: r6(side > 0 ? zb : -za)};
        boxes.push(box);
        solids.push({part, kind: 'end', dir: end, box, back: r6(xa), outer: r6(xb)});
      };
      // (the wing's own outer end is at the corner on all four: two of them are the mirrored copies; a post is the same either way)
      const yaw = Math.atan2(end * nx, side * nz);
      const [tx, tz] = at(G.towerLen / 2), [wx, wz] = at((G.towerLen + L) / 2);
      const tower = piece('tower', 'post', 'end', end, [tx, G.y0, tz], yaw, [G.towerLen, G.towerH, G.depth]);
      piece('wing', 'wing', 'end', end, [wx, G.y0, wz], yaw, [L - G.towerLen, G.wingH, G.depth], end !== side);
      for (let i = 0; i < G.towerSlices; i++) slice('tower', (i * G.towerLen) / G.towerSlices, ((i + 1) * G.towerLen) / G.towerSlices, G.towerH);
      for (let i = 0; i < G.wingSlices; i++) slice('wing', G.towerLen + (i * (L - G.towerLen)) / G.wingSlices, G.towerLen + ((i + 1) * (L - G.towerLen)) / G.wingSlices, G.wingH);
      // the tower's outboard face: a body beside the corner (on the platform, in the bed) is against its fins too
      const tb = tower.box;
      solids.push({part: 'tower', kind: 'side', dir: side, box: tb, back: r6(Math.min(Math.abs(tb.z0), Math.abs(tb.z1))), outer: r6(Math.max(Math.abs(tb.z0), Math.abs(tb.z1)))});
    }
    const prow = piece('prow', 'post', 'end', end, [end * G.prowX, G.y0, 0], (end * Math.PI) / 2, [G.prowW, G.prowH, G.prowDepth]);
    boxes.push(prow.box);
    solids.push({part: 'prow', kind: 'end', dir: end, box: prow.box, back: G.prowX, outer: r6(G.prowX + G.prowDepth)});
    const B = A.brow;
    piece('brow', 'rail', 'end', end, [end * B.x, B.y0, 0], (end * Math.PI) / 2, [B.length, B.height, B.depth]);
    // (no box: the brow lies inside the car's own end box — a shot at it already stops on the car)
  }
  const doors = spec.doors.map(d => ({side: d.side, x0: d.x - d.width / 2, x1: d.x + d.width / 2}));
  return {pieces, solids, boxes, doors};
}

let defaultLayout: ArmorLayout | null = null;
/** The default car's layout (memoized). */
export function trainArmorLayout(): ArmorLayout {
  return (defaultLayout ??= armorLayout());
}

/** A solid touched by a body (train-local): the solid, the outward normal (horizontal), the contact point on its outer face, the gap. */
export interface ArmorHit { solid: ArmorSolid; nx: number; nz: number; x: number; y: number; z: number; gap: number }

/**
 * The contact rule (file header) for one body: feet at (lx, ly, lz) train-local, circle radius r, standing `height` tall. The nearest
 * touched solid, or null.
 */
export function armorContact(layout: ArmorLayout, lx: number, ly: number, lz: number, r: number, height: number = ARMOR_CONTACT.height): ArmorHit | null {
  const C = ARMOR_CONTACT;
  let best: ArmorHit | null = null;
  for (const p of layout.solids) {
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
    best = {solid: p, nx, nz, x: cx, y: cy, z: cz, gap};
  }
  return best;
}
