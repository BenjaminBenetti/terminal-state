// Task studio-train-crafting-v1-20261111-225628-01: WHERE the crafting fixtures are in the player's train — pure data from the car spec
// (world/playerTrainSpec.ts) and the cooked models' measurements (assets/trainEquipment.generated.ts). No three.js, no Game: the parked
// colliders (world/playerTrain.ts trainColliders), the ride's car-local model (world/trainRideLocal.ts), the bench (world/craftBench.ts),
// the equipment system (world/trainEquipment.ts) and the sentry's roof turret (world/sentryTurret.ts) all read these placements.
//
// THE CAR'S FOUR EQUIPMENT AREAS (user: "The bench and three equipment plugs come installed; keep the existing woodchipper permanent in
// its own fourth equipment area"): the wall bays between the door pairs. The +Z bay between the middle and the front doors is the
// woodchipper's (world/chipperPlace.ts); the other three bays each carry ONE generic plug (a wall socket on the lining):
//   plug 0: +Z wall, rear saloon (between the rear and the middle doors);   plug 1: -Z wall, rear saloon (staggered along the car);
//   plug 2: -Z wall, front saloon (opposite the woodchipper).
// THE BENCH: cramped into the rear compartment on the side opposite the Lockbox (user: "a small, cramped-in crafting bench at the rear
// opposite the train chest"), its back against the lining, its front toward the aisle between the two.
// THE ROOF TURRET (the sentry's): on the roof's centre line, on the middle ventilation hatch (the roof's highest seat).

import {TRAIN_BENCH_MEASURED} from '../assets/trainEquipment.generated';
import {TRAIN_ROOF_MEASURED} from '../assets/trainRoof.generated';
import {chipperFootprint, chipperPlacement} from '../world/chipperPlace';
import {LOCKBOX_CLEAR, PARTITION_HALF, PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';

const r4 = (v: number) => Math.round(v * 10000) / 10000;

// ---------------------------------------------------------------------------------------------------------------------------------
// The crafting bench

/** The bench stands this far off the lining / the rear bulkhead / the partition (m; the Lockbox's clearance). */
export const BENCH_CLEAR = LOCKBOX_CLEAR;
/** The aisle left between the bench's front and the Lockbox's front must be at least this wide (m). */
export const BENCH_AISLE_MIN = 0.9;

export interface BenchPlacement {
  /** Footprint centre (train-local x / z), the interior floor it stands on (train-local y). */
  x: number; z: number; floorY: number;
  /** Rotation about +Y: the model's +Z front faces the aisle (0 on the -Z side, PI on the +Z side). */
  yaw: number;
  /** Runtime size (m): along the car (x), height (to the top of its fixtures), across the car (z); the worktop's height over the floor. */
  length: number; height: number; depth: number; worktopY: number;
  /** The side of the car it stands on (-1: the platform side, -Z). */
  side: -1 | 1;
}

const benchCache = new WeakMap<PlayerTrainSpec, BenchPlacement | null>();

/** The bench's placement in a car (null: the spec has no rear compartment it fits into). */
export function benchPlacement(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): BenchPlacement | null {
  if (benchCache.has(spec)) return benchCache.get(spec)!;
  const rear = spec.rear, S = TRAIN_BENCH_MEASURED.size, hw = spec.interior.halfWidth;
  let p: BenchPlacement | null = null;
  if (rear) {
    const x0 = rear.x0, x1 = rear.x1 - PARTITION_HALF;
    // opposite the Lockbox (the Lockbox stands on +Z in the level-one car: the bench on -Z)
    const side: -1 | 1 = (spec.lockbox?.z ?? 1) >= 0 ? -1 : 1;
    const lockFront = spec.lockbox ? Math.abs(spec.lockbox.z) - spec.lockbox.depth / 2 : hw;
    const benchFront = hw - BENCH_CLEAR - S.d;
    if (x1 - x0 >= S.l + 2 * BENCH_CLEAR - 1e-9 && benchFront + lockFront >= BENCH_AISLE_MIN) {
      p = Object.freeze({
        x: r4((x0 + x1) / 2), z: r4(side * (hw - BENCH_CLEAR - S.d / 2)), floorY: spec.floorY, yaw: side < 0 ? 0 : Math.PI,
        length: S.l, height: S.h, depth: S.d, worktopY: TRAIN_BENCH_MEASURED.worktopY, side,
      });
    }
  }
  benchCache.set(spec, p);
  return p;
}

/** Train-local footprint of the bench (x0 < x1, z0 < z1). */
export function benchFootprint(b: BenchPlacement): {x0: number; x1: number; z0: number; z1: number} {
  return {x0: b.x - b.length / 2, x1: b.x + b.length / 2, z0: b.z - b.depth / 2, z1: b.z + b.depth / 2};
}

/** A point of the bench's model frame (bottom centre origin, +Z front) -> train-local. */
export function benchToLocal(b: BenchPlacement, mx: number, my: number, mz: number, out: {x: number; y: number; z: number} = {x: 0, y: 0, z: 0}): {x: number; y: number; z: number} {
  const c = b.yaw === 0 ? 1 : -1; // (yaw 0 or PI)
  out.x = b.x + mx * c;
  out.y = b.floorY + my;
  out.z = b.z + mz * c;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The three generic plugs

export const PLUG = {
  /** A device's footprint centre within this distance (m, horizontal) of a free plug's socket connects to it. */
  reach: 1.1,
  /** The socket's height over the car floor (m). */
  socketY: 0.42,
  /** Where along its wall bay each plug's socket is (fraction of the bay's length from its rear end), by plug index. */
  along: [0.42, 0.73, 0.5],
} as const;

export interface EquipmentPlug {
  /** 0..2 (EquipmentJSON.plug). */
  index: number;
  /** The wall it is on: -1 = the platform side (-Z), +1 = the far side (+Z). */
  side: -1 | 1;
  /** The socket on the lining (train-local). */
  x: number; y: number; z: number;
  /** The wall bay it serves (train-local x): between two door pairs' jambs. */
  bay: {x0: number; x1: number};
}

const plugCache = new WeakMap<PlayerTrainSpec, readonly EquipmentPlug[]>();

/**
 * The car's generic plugs: one per wall bay between consecutive door pairs on each side, the woodchipper's bay excluded, far side first
 * then the platform side, rear to front — the first three (the level-one car has exactly three such bays).
 */
export function equipmentPlugs(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): readonly EquipmentPlug[] {
  const hit = plugCache.get(spec);
  if (hit) return hit;
  const chip = chipperPlacement(spec), hw = spec.interior.halfWidth;
  const out: EquipmentPlug[] = [];
  for (const side of [1, -1] as const) {
    const doors = spec.doors.filter(d => d.side === side).sort((a, b) => a.x - b.x);
    for (let i = 0; i + 1 < doors.length; i++) {
      const x0 = doors[i].x + doors[i].width / 2, x1 = Math.min(doors[i + 1].x - doors[i + 1].width / 2, spec.cab.x0);
      if (x1 - x0 < 1.2) continue;
      // (the woodchipper's own equipment area: its bay on its side of the car)
      if (chip && Math.sign(chip.z) === side && chip.x > x0 && chip.x < x1) continue;
      if (out.length >= PLUG.along.length) break;
      const index = out.length;
      out.push(Object.freeze({index, side, x: r4(x0 + (x1 - x0) * PLUG.along[index]), y: r4(spec.floorY + PLUG.socketY), z: r4(side * hw), bay: Object.freeze({x0: r4(x0), x1: r4(x1)})}));
    }
  }
  const frozen = Object.freeze(out);
  plugCache.set(spec, frozen);
  return frozen;
}

/** The free plug (not in `taken`) whose socket is nearest a device's train-local footprint centre, within PLUG.reach (null: none). */
export function plugInReach(x: number, z: number, taken: ReadonlySet<number> | readonly number[] = [], spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): EquipmentPlug | null {
  const used = taken instanceof Set ? taken : new Set(taken as readonly number[]);
  let best: EquipmentPlug | null = null, bd: number = PLUG.reach;
  for (const p of equipmentPlugs(spec)) {
    if (used.has(p.index)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Where a crafted unit is put down

/** A circle (x, z, r) overlaps an axis-aligned footprint. */
export function circleHitsBox(x: number, z: number, r: number, b: {x0: number; x1: number; z0: number; z1: number}): boolean {
  const dx = x - Math.max(b.x0, Math.min(b.x1, x)), dz = z - Math.max(b.z0, Math.min(b.z1, z));
  return dx * dx + dz * dz < r * r;
}

/**
 * Floor spots (train-local footprint centres) a freshly crafted unit may be put on, nearest the bench's compartment first: along the
 * saloons' walls (clear of every doorway and out of every plug's reach — a new device never plugs itself in: the player rolls it to a
 * plug), then, only when every wall spot is taken, down the aisle (never in front of the rear compartment's doorway or across a pair of
 * doors). The equipment system takes the first one that is physically free (world/trainEquipment.ts).
 */
export function craftSpots(radius: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): {x: number; z: number}[] {
  const I = spec.interior, hw = I.halfWidth, plugs = equipmentPlugs(spec), chip = chipperPlacement(spec);
  const xa = (spec.rear?.x1 ?? I.x0) + PARTITION_HALF + radius + 0.05, xb = spec.cab.x0 - radius - 0.05;
  const wallZ = r4(hw - radius - 0.08);
  const wall: {x: number; z: number}[] = [], aisle: {x: number; z: number}[] = [];
  for (let x = xa; x <= xb + 1e-9; x += 0.4) {
    const atDoor = spec.doors.some(d => Math.abs(x - d.x) < d.width / 2 + radius + 0.05);
    for (const z of [-wallZ, wallZ]) {
      // not on a doorway's threshold strip (the doors must close; nothing blocks the way in)
      if (spec.doors.some(d => Math.sign(z) === d.side && Math.abs(x - d.x) < d.width / 2 + radius + 0.05)) continue;
      if (plugs.some(p => Math.hypot(p.x - x, p.z - z) <= PLUG.reach + 0.05)) continue;
      if (chip && circleHitsBox(x, z, radius + 0.03, chipperFootprint(chip))) continue;
      wall.push({x: r4(x), z});
    }
    if (!atDoor && x - xa >= 1.2) aisle.push({x: r4(x), z: 0});
  }
  const near = (a: {x: number; z: number}, b: {x: number; z: number}) => Math.hypot(a.x - xa, a.z) - Math.hypot(b.x - xa, b.z) || a.x - b.x || a.z - b.z;
  return [...wall.sort(near), ...aisle.sort(near)];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The roof (the sentry's turret)

/**
 * The car's roof as measured on the cooked shell (assets/trainRoof.generated.ts, tools/asset-pipeline/train/measure-train-roof.mjs;
 * tests/train-roof-profile.test.ts checks it against the shell's triangles): outlines across the car in bands of |z|, each the
 * highest roof point at or beyond that |z| — for the body between the end caps, for the whole length, and for each of the three low
 * ventilation hatches on the centre line inside its plan box. The turret's own-hull rule (craft/sentry.ts): a shot may only leave
 * over this outline, never through the roof.
 */
export const TRAIN_ROOF = TRAIN_ROOF_MEASURED;

/** The roof skin's height on the centre line between the hatches (train-local y, m; measured on the cooked shell). */
export const TRAIN_ROOF_SKIN_Y: number = TRAIN_ROOF.skinY;

/** The band of an |z| (clamped into the tables). */
function roofBand(absZ: number): number {
  const k = Math.floor(absZ / TRAIN_ROOF.step + 1e-9);
  return k < 0 ? 0 : k >= TRAIN_ROOF.body.length ? TRAIN_ROOF.body.length - 1 : k;
}

/**
 * The highest roof point at or beyond |z| at the station x along the car (train-local): the hatch's own outline inside a hatch's
 * plan box, the end caps' beyond TRAIN_ROOF.endX, the body's elsewhere. Beyond the body's half width: -Infinity. Never below the
 * real roof at (x, z) — and never below it at any point farther out across the car, so a line that clears this outline all the
 * way to the car's side has cleared the roof.
 */
export function roofTopAtPoint(x: number, z: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): number {
  const a = Math.abs(z);
  if (a > spec.width / 2 + 0.02) return -Infinity;
  const R = TRAIN_ROOF, k = roofBand(a);
  if (a <= R.hatchZ) for (const h of R.hatches) if (x >= h.x0 && x <= h.x1) return h.top[k < h.top.length ? k : h.top.length - 1];
  return Math.abs(x) > R.endX ? R.ends[k] : R.body[k];
}

/** The highest roof point at or beyond |z| over the WHOLE car length, hatches included (beyond the body's half width: -Infinity). */
export function roofTopAt(absZ: number, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): number {
  const a = Math.abs(absZ);
  if (a > spec.width / 2 + 0.02) return -Infinity;
  const R = TRAIN_ROOF, k = roofBand(a);
  let y: number = R.ends[k];
  if (a <= R.hatchZ) for (const h of R.hatches) y = Math.max(y, h.top[k < h.top.length ? k : h.top.length - 1]);
  return y;
}

export interface TurretMount {
  /** The turret's base centre on the roof (train-local): the model's origin when deployed. */
  x: number; y: number; z: number;
}

/**
 * The roof turret's mount: on the MIDDLE roof hatch, the highest seat the roof offers (the higher the gun, the closer to the car's
 * side it can still shoot down over the roof's edge). y = the lowest roof point under its base ring, so the ring beds a few
 * millimetres into the hatch's slightly crowned top instead of floating over it.
 */
export function turretMount(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): TurretMount {
  void spec;
  return TURRET_MOUNT;
}
const TURRET_MOUNT: TurretMount = Object.freeze({x: TRAIN_ROOF.seat.x, y: TRAIN_ROOF.seat.lo, z: 0});
