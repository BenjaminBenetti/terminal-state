// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL implements): the RIDE PORTALS in the live world —
// what the moving train (world/trainRide.ts) asks of the station it leaves / enters. Geometry and positions: world/ridePortal.ts.
//
// One instance per Game (installRidePortals), re-bound to each station by its section hooks. While a ride ENGAGES a portal:
//  - everything the station draws inside the portal's `box` is hidden (static meshes by draw range, instances, moving things), and
//    drawn again on release — no geometry is rebuilt, nothing is disposed, no material or pipeline changes;
//  - the station's baked light field (surfaces and haze) reads zero inside the box (world/rideMask.ts): a tunnel through rock;
//  - a 'gate' portal's gate can swing open / shut (the static headwall + gate stand in the bed end face at all times);
//  - a 'breach' portal's headwall stands across the station tunnel (only while engaged).
// The ride tunnel itself (the box, rails, signals) is the transit tunnel placed as a stub by the ride (world/trainTransitTunnel.ts).
//
// LEAD STUB: every method is a safe no-op until lane PORTAL fills it in; lane RIDE codes against this surface.

import type {RidePortal} from './ridePortal';

/** `front` = the departure portal (the cab's end), `rear` = the arrival portal (world/ridePortal.ts ridePortals). */
export type PortalWhich = 'front' | 'rear';

export interface PortalState {
  /** The portal of the current station (null: no car / no station). */
  portal: RidePortal | null;
  engaged: boolean;
  /** Gate swing 0 (shut) .. 1 (open); a breach reads 1 while engaged, 0 otherwise. */
  gate: number;
  /** What `engage` hid: static meshes cut, instances, moving objects (QA / tests). */
  hidden: {meshes: number; triangles: number; instances: number; objects: number};
}

/** What the runtime reads from Game (structural: tests drive it with a fake host). */
export interface RidePortalHost {
  scene: unknown;
  layout?: unknown;
  trainPlacement?: unknown;
  world?: unknown;
  sectionHooks?: {build?(layout: never): void; teardown?(): void}[];
}

export class RidePortalRuntime {
  constructor(readonly host: RidePortalHost) {}

  /** Section hooks (build: bind to the new station; teardown: release everything at once). Called once from the Game constructor. */
  install(): this { return this; }

  /** The portal `which` of the current station (null without a car). */
  portal(_which: PortalWhich): RidePortal | null { return null; }

  /**
   * A ride starts using portal `which`: hide the station's geometry in its box, set the light mask, stand a breach's headwall.
   * `gateOpen`: the gate's state at once (an arrival finds it open; a departure starts shut and calls setGate). Idempotent.
   */
  engage(_which: PortalWhich, _opts: {gateOpen: boolean}): void {}

  /** Swing the gate open / shut (animated by step). No-op on a breach. */
  setGate(_which: PortalWhich, _open: boolean): void {}

  /** Gate swing 0..1 (1 on an engaged breach). */
  gate(_which: PortalWhich): number { return 1; }

  /** Per frame while a portal is engaged or releasing (`eye`: the camera, for the unobserved test of a breach's release). */
  step(_dt: number, _eye?: {x: number; y: number; z: number}): void {}

  /**
   * The ride is done with portal `which`: a gate shuts first, a breach's headwall goes once it is out of sight; then the station's own
   * geometry is drawn again and the light mask is cleared. `now`: at once (reset / teardown).
   */
  release(_which: PortalWhich, _opts: {now?: boolean} = {}): void {}

  engaged(_which: PortalWhich): boolean { return false; }

  /** QA readout. */
  state(_which: PortalWhich): PortalState {
    return {portal: null, engaged: false, gate: 0, hidden: {meshes: 0, triangles: 0, instances: 0, objects: 0}};
  }
}

/** Installs the ride portals (one call in the Game constructor, before the ride). */
export function installRidePortals(host: RidePortalHost): RidePortalRuntime {
  return new RidePortalRuntime(host).install();
}
