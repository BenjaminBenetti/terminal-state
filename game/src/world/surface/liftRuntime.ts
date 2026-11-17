// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the CARGO LIFT that IS the crossing.
// User: "Replace the Surface Run transition loading screen with the existing cargo-elevator presentation/ride, both directions. The ride
// IS the loading experience: an enclosed, continuously rendered ride while real preparation/build/warmup happens, doors opening only when
// ready."
//
//  - THE SITE (every section with a lift end: layout.surfaceAccess.lift / layout.surface.portal.lift): the cargo lift kit's view
//    (world/elevator.ts buildElevatorView, cargo look) of that end — the car standing at its stop with its gate and landing doors OPEN,
//    the COP, the landing frame, the shaft liner — plus the car's own lamp (an emissive panel under its roof: the kit's car has no lights;
//    "no lights: emissive + the baked field only"). Built at the section build's hooks step (before the warm-up: it compiles with it),
//    in the world group (disposed with it).
//  - THE RIDE (Game.crossSurface when both ends have a lift; world/surface/liftInfo.ts for the frames): [E] in the car -> the doors
//    close (DOOR_TIME) while the player is HELD in the car (Player.update on the car's own collision model in the car frame: look and
//    a few steps, never out through the gate) -> the car departs (the shaft liner and the landing slide past the barred gate) -> the
//    old world is left: the site's view is taken out of the world group first (kept, drawn) -> once the destination is generated its
//    end's view is built with the car at the SAME place in the shaft (identical car / COP / lamp: only the world placement differs),
//    the origin's view disposed, the player's car-local pose carried over -> the destination is built (paced: frames keep drawing) and
//    its site ADOPTS that view -> the destination compiles completely (Game.backgroundCompile(true): no cap) -> only then, in a playing
//    frame (paused: it waits), the car finishes its travel, stops and the doors open; the player is released.
//  - Sounds: the tower runtime's own one-shot cues (door motor, closing clunk, departure clank, motor rumble re-struck while moving,
//    the brake at the floor): nothing loops, nothing to stop.
//  - Bounded: at most two views exist (the held one and, for one call, the new one); reset() disposes a held view and releases the
//    player (failure / cancel). The runtime adds no frame hook per ride (one installed hook) and no lights.

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceLift} from '../../gen/surface/surfaceTypes';
import {LIFT_CAR} from '../../gen/surface/accessLift';
import {CAB_ACCEL, CAB_SPEED, DOOR_TIME, buildElevatorView, elevatorMaterials, planElevator, type ElevatorPlan, type ElevatorView} from '../elevator';
import {towerCue} from '../towerShared';
import type {MoveInput} from '../../player/player';
import {LIFT_LABELS, carFrame, carModel, carToWorldXZ, liftElevatorInfo, liftHome, liftStops, worldToCarXZ, type CarFrame, type CarModel} from './liftInfo';

/** Ride phases (QA / tests read them): idle -> closing -> travel -> (arrived, waiting for ready) -> opening -> idle. */
export type LiftPhase = 'idle' | 'closing' | 'travel' | 'waiting' | 'opening' | 'reopening';

export const LIFT_RIDE = {
  /** The creep speed (m/s) the car slows to near the end of its travel while the destination is not ready yet. */
  creep: 0.12,
  /** The motor rumble is re-struck this often (s) while the car moves. */
  humEvery: 6,
  /** The player's radius in the car (m) and the lamp panel (m: across / along / under the roof). */
  radius: 0.3,
  lamp: {w: 0.9, d: 0.5, gap: 0.02},
} as const;

/**
 * The destination's compile while the ride waits for it (Game.backgroundCompile(true); render/journeyCompile.ts options): only the sealed
 * car is drawn, so the job steps every frame (maxStaleMs 0: the scheduler's bounded overdue rule, never a held frame) with bigger scene
 * chunks and slices than a train journey's play-time pacing. Coverage is the journey's 'full' plan, uncapped.
 */
export const LIFT_RIDE_COMPILE = {chunk: 8, shadowChunk: 16, maxStaleMs: 0, sliceMs: 8, shadowTargetMs: 6} as const;

/** One end's drawn lift. */
interface LiftEnd {
  lift: SurfaceLift;
  plan: ElevatorPlan;
  view: ElevatorView;
  frame: CarFrame;
  stops: [number, number];
  home: 0 | 1;
  lamp: THREE.Mesh;
  /** Owned by the section's world group (true) or held by the ride (false). */
  inWorld: boolean;
}

/** The lift end of a layout (null: none — a version-1 section). */
export function liftOfLayout(layout: Pick<StationLayout, 'surfaceAccess' | 'surface'> | null | undefined): SurfaceLift | null {
  return layout?.surfaceAccess?.lift ?? layout?.surface?.portal.lift ?? null;
}

const sameLift = (a: SurfaceLift, b: SurfaceLift) => JSON.stringify(a) === JSON.stringify(b);
const runtimes = new WeakMap<object, SurfaceLiftRuntime>();
/** The lift runtime of a game (QA / tests). */
export const surfaceLiftOf = (game: object): SurfaceLiftRuntime | undefined => runtimes.get(game);

export class SurfaceLiftRuntime {
  /** The current section's lift end (null: none). */
  site: LiftEnd | null = null;
  /** The ride's held end (out of any world group) while the old world is left / the new one built; adopted by the destination's site. */
  private held: LiftEnd | null = null;
  phase: LiftPhase = 'idle';
  /** The player is held in the car (Game.update / updateTransitGap step them through stepPlayer). */
  holding = false;
  /** Door open fraction (gate + landing), the car's travel progress (m, 0 .. rise), its speed. */
  door = 1;
  travel = 0;
  speed = 0;
  /** The ride goes up (station -> street). */
  up = true;
  /** The destination is ready (built, compiled): the car may stop and open. Set by the Game. */
  ready = false;
  /** The destination end was placed (the view swapped). */
  reposed = false;
  private local = {x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0};
  private model: CarModel | null = null;
  private humT = 0;
  private waiters: {phase: 'shut' | 'open'; resolve: (ok: boolean) => void}[] = [];
  readonly counts = {sites: 0, adopted: 0, views: 0, disposed: 0, rides: 0, reposes: 0, opened: 0, resets: 0, heldFrames: 0};

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    runtimes.set(g, this);
    (g as unknown as {surfaceLiftRide: SurfaceLiftRuntime | null}).surfaceLiftRide = this;
    g.sectionHooks.push({build: layout => this.build(layout as StationLayout), teardown: () => this.teardown()});
    g.frameHooks.push(dt => this.tick(dt));
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // The site

  private makeEnd(l: SurfaceLift): LiftEnd | null {
    const mats = (this.game as unknown as {mats?: unknown}).mats;
    if (!mats) return null;
    const info = liftElevatorInfo(l), plan = planElevator(info);
    const view = buildElevatorView(plan, mats as Parameters<typeof buildElevatorView>[1], {cargo: true});
    view.root.name = 'cargo-lift-surface';
    view.root.userData.surfaceLift = true;
    const frame = carFrame(l), stops = liftStops(l), home = liftHome(l);
    // the car's own lamp: an emissive panel under its roof (the kit's lamp finish; part of the car: it rides with it)
    const lampGeo = new THREE.BoxGeometry(LIFT_RIDE.lamp.w, 0.03, LIFT_RIDE.lamp.d);
    view.geometries.push(lampGeo); // (disposed with the view's own)
    const lamp = new THREE.Mesh(lampGeo, elevatorMaterials().light as THREE.Material);
    lamp.name = 'cargo-lift-lamp';
    const [lx, lz] = carToWorldXZ(frame, 0, 0.2);
    lamp.position.set(lx, LIFT_CAR.cabH - 0.015 - LIFT_RIDE.lamp.gap, lz);
    lamp.rotation.y = frame.yaw;
    lamp.userData.level = l.level;
    view.cab.add(lamp); // (cab space: y relative to the cab floor)
    this.game.atmosphere?.markShadows(view.root, false);
    this.counts.views++;
    return {lift: l, plan, view, frame, stops, home, lamp, inWorld: false};
  }

  /** Poses an end's view: the car at its travel progress `s` from the ride's origin stop, the doors at `door`. */
  private pose(e: LiftEnd, door: number): void {
    const cabY = this.cabY(e);
    e.view.setCab(cabY, door);
    for (let i = 0; i < 2; i++) e.view.setLanding(i, Math.abs(e.stops[i] - cabY) < 0.02 ? door : 0);
    e.view.setIndicator(LIFT_LABELS[this.nearestStop(e, cabY)], this.phase === 'travel' ? (this.up ? 1 : -1) : 0);
    e.view.root.updateMatrixWorld(true);
  }

  /** The car's floor (absolute y) in an end's frame at the ride's progress (idle: its home stop). */
  cabY(e: LiftEnd): number {
    if (this.phase === 'idle') return e.stops[e.home];
    const rise = e.stops[1] - e.stops[0];
    // in the origin's frame the car leaves its home; in the destination's it approaches its home
    const fromLower = this.up;
    const s = this.travel;
    return fromLower ? e.stops[0] + Math.min(rise, s) : e.stops[1] - Math.min(rise, s);
  }

  private nearestStop(e: LiftEnd, y: number): 0 | 1 { return Math.abs(y - e.stops[0]) <= Math.abs(y - e.stops[1]) ? 0 : 1; }

  build(layout: StationLayout): void {
    const g = this.game, l = liftOfLayout(layout);
    if (this.site && this.site.inWorld) this.site = null; // (stale: its world group is gone)
    if (!l || !g.world) return;
    const h = this.held;
    if (h && sameLift(h.lift, l)) {
      // the ride's destination end: adopted by this world (drawn on; disposed with it)
      h.view.root.removeFromParent();
      g.world.group.add(h.view.root);
      h.inWorld = true;
      this.site = h;
      this.held = null;
      this.counts.adopted++;
      return;
    }
    const e = this.makeEnd(l);
    if (!e) return;
    g.world.group.add(e.view.root);
    e.inWorld = true;
    this.site = e;
    this.pose(e, this.phase === 'idle' ? 1 : this.door);
    this.counts.sites++;
  }

  teardown(): void {
    // (a held end is the ride's: holdForLeave took it out of the site before Game.leaveSection)
    if (this.site?.inWorld) this.disposeEnd(this.site);
    this.site = null;
  }

  // -------------------------------------------------------------------------------------------
  // The ride (driven by Game.crossSurface)

  /** The current section can start a ride (its lift is drawn, nothing in flight). */
  canRide(): boolean {
    return !!this.site && this.phase === 'idle' && !this.held;
  }

  /** The player stands inside the current section's car. */
  inCar(): boolean {
    const s = this.site, p = this.game.player;
    if (!s) return false;
    const [lx, lz] = worldToCarXZ(s.frame, p.x, p.z);
    return Math.abs(lx) < s.frame.hx && Math.abs(lz) < s.frame.hz && Math.abs(p.y - s.lift.y) < 1.2;
  }

  /** [E] in the car: hold the player, close the doors. Resolves true when they are shut (false: the ride was reset meanwhile). */
  begin(up: boolean): Promise<boolean> {
    const s = this.site!;
    this.up = up;
    this.ready = false;
    this.reposed = false;
    this.travel = 0;
    this.speed = 0;
    this.door = 1;
    this.phase = 'closing';
    this.counts.rides++;
    this.takePlayer(s);
    towerCue(this.game.sfx, 'cabinetOpen', this.cuePoint(s), {rate: 0.62, gain: 0.55}); // the door motor
    return this.until('shut');
  }

  /** The doors could not stay shut (a failure before the old world was left): they open again, the player is released. */
  reopen(): Promise<boolean> {
    if (!this.site) { this.release(); this.phase = 'idle'; return Promise.resolve(true); }
    this.phase = 'reopening';
    return this.until('open');
  }

  /** Before Game.leaveSection: the site's view leaves the world group (kept, drawn: the ride's). */
  holdForLeave(): void {
    const s = this.site;
    if (!s) return;
    s.view.root.removeFromParent();
    this.game.scene.add(s.view.root);
    s.inWorld = false;
    this.held = s;
    this.site = null;
  }

  /**
   * The destination end (from its generated layout): its view built with the car at the same place in the shaft, the held origin view
   * disposed, the player carried over in the car frame. After this the destination's site adopts the held view.
   */
  repose(dest: SurfaceLift): boolean {
    const from = this.held, e = this.makeEnd(dest);
    if (!e) return false;
    this.game.scene.add(e.view.root);
    this.held = e;
    this.pose(e, 0);
    if (from) this.disposeEnd(from);
    this.model = carModel(e.frame);
    this.reposed = true;
    this.counts.reposes++;
    this.writePlayer(e);
    return true;
  }

  /** The destination is ready (built and compiled): the car may finish its travel and open. */
  markReady(): Promise<boolean> {
    this.ready = true;
    return this.until('open');
  }

  /** Failure / cancel: a held view disposed, the player released, idle (the site, if any, open). */
  reset(): void {
    if (this.held) this.disposeEnd(this.held);
    this.held = null;
    this.release();
    this.phase = 'idle';
    this.door = 1;
    this.travel = 0;
    this.speed = 0;
    this.ready = false;
    if (this.site) this.pose(this.site, 1);
    this.counts.resets++;
    this.flush(false);
  }

  private disposeEnd(e: LiftEnd): void {
    e.view.root.removeFromParent();
    for (const g of e.view.geometries) g.dispose();
    this.counts.disposed++;
  }

  /** The end the ride draws now (held or adopted). */
  private current(): LiftEnd | null {
    return this.held ?? this.site;
  }

  private cuePoint(e: LiftEnd): {x: number; y: number; z: number} {
    return {x: e.lift.door.x, y: this.cabY(e) + 1.6, z: e.lift.door.z};
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (a frame hook in play; Game.updateTransitGap in the transit gap)

  tick(dt: number): void {
    if (this.phase === 'idle') return;
    const e = this.current();
    if (!e) return;
    const D = 1 / DOOR_TIME, rise = e.stops[1] - e.stops[0];
    if (this.phase === 'closing') {
      this.door = Math.max(0, this.door - dt * D);
      if (this.door <= 0) {
        this.phase = 'travel';
        towerCue(this.game.sfx, 'cabinetClose', this.cuePoint(e), {rate: 0.7, gain: 0.8});
        towerCue(this.game.sfx, 'clank', this.cuePoint(e), {rate: 0.8, gain: 0.5});
        towerCue(this.game.sfx, 'trainDistant', this.cuePoint(e), {rate: 1.35, gain: 0.4});
        this.humT = 0;
        this.flush(true);
      }
    } else if (this.phase === 'travel') {
      // full speed; near the end, while the destination is not ready, a creep; the brake to the stop only once it is ready and placed
      const left = rise - this.travel, brake = (this.speed * this.speed) / (2 * CAB_ACCEL) + 0.02;
      const go = this.ready && this.reposed;
      const target = left <= brake ? (go ? 0 : Math.min(LIFT_RIDE.creep, this.speed)) : go || left > brake + 1.2 ? CAB_SPEED : LIFT_RIDE.creep;
      this.speed = target > this.speed ? Math.min(target, this.speed + CAB_ACCEL * dt) : Math.max(target, this.speed - CAB_ACCEL * dt);
      if (go && left <= brake) this.speed = Math.max(0.05, Math.min(this.speed, Math.sqrt(2 * CAB_ACCEL * Math.max(0, left))));
      this.travel = Math.min(rise - (go ? 0 : 0.08), this.travel + this.speed * dt);
      this.humT += dt;
      if (this.humT >= LIFT_RIDE.humEvery) { this.humT = 0; towerCue(this.game.sfx, 'trainDistant', this.cuePoint(e), {rate: 1.35, gain: 0.32}); }
      if (go && this.travel >= rise - 1e-3) {
        this.travel = rise;
        this.speed = 0;
        this.phase = 'opening';
        towerCue(this.game.sfx, 'clank', this.cuePoint(e), {rate: 0.95, gain: 0.3}); // the brake at the floor
        towerCue(this.game.sfx, 'cabinetOpen', this.cuePoint(e), {rate: 0.72, gain: 0.8});
      } else if (!go && this.travel >= rise - 0.08 - 1e-3) this.phase = 'waiting';
    } else if (this.phase === 'waiting') {
      if (this.ready && this.reposed) this.phase = 'travel';
    } else if (this.phase === 'opening' || this.phase === 'reopening') {
      this.door = Math.min(1, this.door + dt * D);
      if (this.door >= 1) {
        const re = this.phase === 'reopening';
        this.phase = 'idle';
        this.travel = 0;
        this.release();
        if (!re) this.counts.opened++;
        this.flush(true);
      }
    }
    this.pose(e, this.door);
    if (this.holding) this.writePlayer(e);
  }

  // -------------------------------------------------------------------------------------------
  // The held player (car frame)

  private takePlayer(e: LiftEnd): void {
    const p = this.game.player;
    this.model = carModel(e.frame);
    const [lx, lz] = worldToCarXZ(e.frame, p.x, p.z), r = LIFT_RIDE.radius + 0.02;
    this.local = {x: Math.max(-e.frame.hx + r, Math.min(e.frame.hx - r, lx)), y: 0, z: Math.max(-e.frame.hz + r, Math.min(e.frame.hz - r, lz)), yaw: p.yaw - e.frame.yaw, vx: 0, vz: 0};
    this.holding = true;
  }

  private release(): void {
    this.holding = false;
    this.model = null;
  }

  /** Game.update / updateTransitGap instead of Player.update while held: Player.update on the car's own model, then the world pose. */
  stepPlayer(dt: number, input: MoveInput, opts: {aiming: boolean; speedMult: number; canSprint: boolean}): boolean {
    const e = this.current(), P = this.game.player, M = this.model;
    if (!e || !M) return false;
    this.counts.heldFrames++;
    const L = this.local;
    L.yaw = P.yaw - e.frame.yaw; // (the mouse look was applied to the world yaw)
    P.x = L.x + M.ox; P.z = L.z + M.oz; P.y = L.y; P.yaw = L.yaw;
    P.vx = L.vx; P.vz = L.vz; // (car-local velocity)
    let step = false;
    try {
      step = P.update(Math.min(dt, 0.05), input, M.levels, null, {...opts, canSprint: false});
    } finally {
      L.x = P.x - M.ox; L.z = P.z - M.oz;
      L.y = P.grounded && Math.abs(P.y) < 1e-4 ? 0 : P.y;
      L.yaw = P.yaw; L.vx = P.vx; L.vz = P.vz;
      this.writePlayer(e);
    }
    return step;
  }

  private writePlayer(e: LiftEnd): void {
    const P = this.game.player, L = this.local;
    const [x, z] = carToWorldXZ(e.frame, L.x, L.z);
    P.x = x; P.z = z; P.y = this.cabY(e) + L.y;
    P.yaw = L.yaw + e.frame.yaw;
    const c = Math.cos(e.frame.yaw), s = Math.sin(e.frame.yaw);
    const vx = L.vx, vz = L.vz;
    P.vx = vx * c + vz * s; P.vz = -vx * s + vz * c;
    P.eye = P.stanceEye + P.y - P.landDip;
  }

  // -------------------------------------------------------------------------------------------
  // Waiting (the Game awaits the doors)

  private until(what: 'shut' | 'open'): Promise<boolean> {
    return new Promise(resolve => this.waiters.push({phase: what, resolve}));
  }

  /** Wakes the waiters of what just happened (`happened`: the doors reached their target: true), or every waiter with a reset (false). */
  private flush(happened: boolean): void {
    const keep: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (!happened) { w.resolve(false); continue; }
      if ((w.phase === 'shut' && this.phase === 'travel') || (w.phase === 'open' && this.phase === 'idle')) w.resolve(true); else keep.push(w);
    }
    this.waiters = keep;
  }

  /** QA: the ride's state. */
  qa() {
    const e = this.current();
    return {phase: this.phase, holding: this.holding, door: this.door, travel: this.travel, speed: this.speed, up: this.up, ready: this.ready, reposed: this.reposed,
      site: this.site ? {lift: structuredClone(this.site.lift), inWorld: this.site.inWorld} : null, held: !!this.held,
      cabY: e ? this.cabY(e) : null, counts: {...this.counts}};
  }
}

export function installSurfaceLift(game: Game): void {
  new SurfaceLiftRuntime(game).install();
}
