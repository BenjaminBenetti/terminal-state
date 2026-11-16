// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the Surface Run military truck's ANCHORS and TUNING as the vehicle
// controller reads them (three-free; save/validate.ts imports the compartment list through truckStore.ts).
//
// Frame (every value): the truck frame of world/skywaysCarSpec.ts — origin = the footprint's centre on the floor, +Y up, NOSE toward -Z,
// +X = the truck's RIGHT (the driver's LEFT seat has x < 0). The anchors are measured on the cooked model by
// tools/asset-pipeline/props/build-surface-truck.mjs (world/surface/truckAnchors.generated.ts).
//
// Tuning (user: reuse the existing controls / behaviour, heavy-truck tuned; no fuel or maintenance simulation): slower to speed up
// (accel 3.4 m/s² vs the car's 7), a lower top speed (12.5 m/s ≈ 45 km/h), longer braking, a slow heavy steering rack with a tighter
// low-speed lock than the wheelbase alone would give a real eight-wheeler (arcade: 6.4 m turn radius at standstill), small yaw sub-steps
// (the ends sweep 3.8 m from the centre). A heavy body: zombies die from a lower closing speed (3.5 m/s) and slow it less; loose props
// are shoved harder. It never takes a stair flight (stairs: false).

import type {CarSpec} from '../skywaysCarSpec';
import type {CarGeom, CarPhys} from '../skywaysCarPhysics';
import type {VehicleRt, VehicleText} from '../skywaysCarVehicle';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

export type TruckAnchors = typeof TRUCK_ANCHORS;

/** The truck's spec (CarSpec: the controller's anchors; the generated literal: the url is a literal the CI packager resolves). */
export const TRUCK_SPEC: CarSpec = TRUCK_ANCHORS;

export const TRUCK_PHYS: CarPhys = {
  accel: 3.4,
  accelTaper: 0.5,
  brake: 9,
  reverseAccel: 2.6,
  reverseMax: 3.5,
  forwardMax: 12.5,
  roll: 0.7,
  drag: 0.01,
  handbrake: 7,
  handbrakeYaw: 1.15,
  handbrakeYawMin: 3,
  stopSpeed: 0.3,
  steerLow: 0.6,
  steerHigh: 0.13,
  steerRate: 1.5,
  steerReturn: 2.6,
  floorTol: 0.25,
  rim: 0.9,
  clearPad: 0.06,
  subStep: 0.2,
  subYaw: 0.035,
  maxDt: 0.1,
  bounce: 0.08,
  bounceMin: 5,
  bounceMax: 1,
  glanceCos: 0.64,
  glanceLoss: 0.1,
  alignRate: 2.2,
};

/** What the physics steps: the anchors + the truck's tuning; no stair flights. */
export const TRUCK_GEOM: CarGeom = {...TRUCK_SPEC, phys: TRUCK_PHYS, stairs: false};

export const TRUCK_RT: VehicleRt = {
  enterReach: 2.6,
  doorReach: 2.2,
  exitSpeed: 1.2,
  lookYaw: (150 * Math.PI) / 180,
  killSpeed: 3.5,
  killSlow: 0.04,
  pushDecel: 3,
  crushDps: 140,
  pinned: 0.06,
  storeyY: 0.9,
  glassSpeed: 5,
  paneReach: 1.5,
  paneDepth: 1.0,
  maxPanes: 3,
  glassDamage: 40,
  glassPerMs: 8,
  glassCooldown: 0.6,
  kick: {gain: 1.4, perFrame: 4, cooldown: 0.15, rayAbove: 2},
  impactSfx: 1.5,
  holsterTime: 0.3,
  noteEvery: 2.5,
  modelWaitMs: 12000,
  skidSpeed: 6,
  skidEvery: 1.2,
  /** (the engine sits under the cab, behind the front axle) */
  engineAt: {x: 0, y: 1.1, z: -2.0},
};

export const TRUCK_TEXT: VehicleText = {
  getIn: '<b>[E]</b> Get in',
  driving: '<b>[W]</b> drive · <b>[S]</b> brake / reverse · <b>[A]</b> <b>[D]</b> steer · <b>[Space]</b> handbrake · <b>[E]</b> get out · <b>[F]</b> lights',
  noRoom: 'No room to get out',
  slowDown: 'Stop the truck to get out',
  hands: 'Hands on the wheel — get out first',
  placeRule: 'Not from the driver seat',
};

type Poly = readonly (readonly [number, number])[];

/**
 * The headlamps: the lens outlines in the front projection (x, y), measured by the cook (the bright lamp grilles low on the bumper);
 * zMax / facing pick the body's own lamp triangles (world/skywaysCarLights.ts lampTriangles). The beam: one wide unshadowed SpotLight
 * between the lamps just ahead of the bumper (the cab is behind and above it, never lit by it), aimed down the road.
 */
export const TRUCK_LAMPS = {
  zMax: TRUCK_ANCHORS.lamps.zMax,
  facing: TRUCK_ANCHORS.lamps.facing,
  right: TRUCK_ANCHORS.lamps.right as Poly,
  left: TRUCK_ANCHORS.lamps.left as Poly,
  lens: {color: 0xfff1d6, on: 5},
  beam: {color: 0xfff1d6, intensity: 420, distance: 40, angle: 0.62, penumbra: 0.55, decay: 1.4, at: TRUCK_ANCHORS.lamps.beam.at, aim: TRUCK_ANCHORS.lamps.beam.aim},
} as const;

/** The road wheels: index = the GLB node `wheel-<i>` (axle 1 left, axle 1 right, axle 2 left, …); steer = the share of tan(front angle). */
export const TRUCK_WHEELS: readonly {x: number; y: number; z: number; r: number; axle: number; steer: number}[] = TRUCK_ANCHORS.wheels;

/** Steering-wheel turn per front-wheel radian (a slow truck box: full lock 0.6 rad turns the wheel ~200°). */
export const TRUCK_WHEEL_RATIO = 5.8;
