// Task office-seamless-20261029 (lane LIFT): the office tower elevator — ONE cab that physically travels the shaft through
// every storey of the continuous Office Space world (no section travel, no loading, no fades).
// Task office-overhaul-20261030 (lane LIFT): the finish of a real full-size office-tower car and PHYSICAL buttons (no floor list).
//
//  - ElevatorLogic (pure): a continuous cab position y with a trapezoidal velocity profile (eases in / out at CAB_ACCEL up
//    to CAB_SPEED and stops EXACTLY at stop.y), a call queue (landing calls from every storey + cab panel selections) served
//    in collective (SCAN) order — keep going while requests lie ahead, then turn round; a stop requested on the way that the
//    cab can still brake for is taken. Door state machine per stop: the cab door and that landing's doors open together
//    ONLY when the cab is level at the stop and stopped; the cab moves ONLY with the doors fully closed; a body in the
//    doorway re-opens closing doors and holds a departure; a living enemy inside holds the doors open (enemies never ride);
//    doors close by themselves after a dwell. Hall calls remember their direction (the up / down button stays lit until the
//    cab arrives); "door close" shortens the dwell (an obstruction still re-opens / holds); the last travel direction feeds the
//    hall lantern.
//  - planElevator: the doorway gate (cab edge -> shaft outer face) and every button as a physical target (LiftButton: cap
//    position, facing normal, pick box) — the car operating panel (COP) on the front return beside the door (a numbered
//    button per stop in two columns, door open / close, alarm, digital indicator, capacity plate) and every landing's call
//    station (lobby: up only, top floor: down only, else both).
//  - buildElevatorView: the cab in ONE group that moves with y — brushed stainless and wood panels with shadow-gap reveals,
//    corner posts, a darkened mirror-glass rear panel (no real reflection), a round handrail on standoffs, a terrazzo floor with
//    a dark border and a steel sill, a suspended ceiling with emissive downlights (one dead, one tired and stuttering), the COP,
//    the indicator over the door, centre-opening doors — and per stop a landing group (stainless portal frame with a stepped
//    profile, jamb / head linings and sill through the shaft wall, landing doors, the hall lantern with the floor indicator,
//    the call station and a fire notice) tagged with its storey (`userData.level`) for culling. Landing pieces share geometry
//    and material instances; static geometry is merged per material. Buttons: ONE canvas-drawn glyph atlas (digits / symbols /
//    labels only) — every unlit cap of a panel is one merged mesh; a lit button is a small overlay sharing one self-lit
//    material (drawn only while lit). No lights: emissive + the baked field only. The cab uses face-UV (not world-mapped)
//    materials so nothing swims while it moves.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {surface, type SurfaceName} from './canvasTextures';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';
import {floorLabel, gateWorld, sideNormal, wallBox, type Box3Like, type DoorGate, type ElevatorInfo, type P3, type Rect2} from './towerShared';

// ---------------------------------------------------------------------------------------------
// Tuning

/** Cruise speed (m/s) and acceleration / braking (m/s^2) of the cab. */
export const CAB_SPEED = 1.6;
export const CAB_ACCEL = 0.8;
/** Full door stroke (s). */
export const DOOR_TIME = 1.35;
/** Doors stay open this long with nothing else to do / with requests waiting elsewhere / after a floor was chosen inside. */
export const DWELL = 5;
export const DWELL_BUSY = 3;
export const HURRY = 0.5;
/** After "door close" on the cab panel the open doors close this soon (an obstruction hold still wins). */
export const CLOSE_DWELL = 0.4;
/** After an obstruction re-open, wait at least this long before closing again. */
export const REOPEN_HOLD = 1.6;
/** Doors shut -> the motor starts after this (the closing clunk, then the cab moves). */
export const START_DELAY = 0.8;
/** Door fraction from which the doorway is passable (Levels gate open). */
export const GATE_OPEN = 0.7;
/** Standing at the shut doors inside an idle cab this long opens them (never trapped). */
export const PUSH_OPEN = 0.7;
/** Clear height of the doorway above a stop floor (m) — GEN cuts the landing wall face to this. */
export const LIFT_DOOR_H = 2.2;
/** Cab panelling depth (m): the front (door) wall panels end CAB_FRONT inside the cab plane, the others CAB_WALL. */
export const CAB_FRONT = 0.065;
export const CAB_WALL = 0.03;
/** Buttons: reach (m, eye to the button), cap radii of the cab panel / the landing call stations. */
export const BUTTON_REACH = 1.7;
export const CAR_BUTTON_R = 0.019;
export const HALL_BUTTON_R = 0.024;

// ---------------------------------------------------------------------------------------------
// State machine

export interface ElevatorStop { floor: number; y: number }

export interface ElevatorSense {
  /** The player stands inside the cab. */
  occupant: boolean;
  /** Some living body (player or enemy) is in the doorway at the cab's stop. */
  doorway: boolean;
  /** A living enemy is inside the cab (enemies never ride: the doors will not close on it). */
  enemyInside: boolean;
  /** The player stands at the shut doors inside an idle cab (opens them after PUSH_OPEN). */
  pushOpen?: boolean;
}

export type ElevatorEvent =
  | {type: 'opening'} | {type: 'opened'} | {type: 'closing'} | {type: 'closed'}
  | {type: 'reopen'; why: 'doorway' | 'enemy'}
  /** The dwell is over but the doors are held open (once per hold). */
  | {type: 'held'; why: 'doorway' | 'enemy'}
  | {type: 'called'; floor: number} | {type: 'selected'; floor: number}
  | {type: 'depart'; from: number; to: number; dir: 1 | -1}
  | {type: 'arrive'; floor: number}
  | {type: 'chime'; floor: number};

export type ElevatorPhase = 'idle' | 'moving';
export type DoorState = 'closed' | 'opening' | 'open' | 'closing';

/** Trapezoidal motion from y0 (speed v0 >= 0 toward y1) to a full stop at y1. */
export interface MotionProfile { y0: number; y1: number; dir: 1 | -1; v0: number; vp: number; a: number; t1: number; t2: number; t3: number; d1: number; d2: number; d: number }

export function planMotion(y0: number, v0: number, y1: number, vmax = CAB_SPEED, a = CAB_ACCEL): MotionProfile {
  const d = Math.abs(y1 - y0), dir: 1 | -1 = y1 >= y0 ? 1 : -1;
  const vp = Math.max(v0, Math.min(vmax, Math.sqrt(a * d + (v0 * v0) / 2)));
  const t1 = (vp - v0) / a, d1 = (vp * vp - v0 * v0) / (2 * a);
  const d3 = (vp * vp) / (2 * a), t3 = vp / a;
  const d2 = Math.max(0, d - d1 - d3), t2 = vp > 1e-9 ? d2 / vp : 0;
  return {y0, y1, dir, v0, vp, a, t1, t2, t3, d1, d2, d};
}

/** Position (absolute y) and signed velocity of a profile at time t; done at the end. */
export function sampleMotion(p: MotionProfile, t: number): {y: number; v: number; done: boolean} {
  const {v0, vp, a, t1, t2, t3, d1, d2, d} = p;
  let s: number, v: number;
  if (t >= t1 + t2 + t3) return {y: p.y1, v: 0, done: true};
  if (t <= t1) { s = v0 * t + 0.5 * a * t * t; v = v0 + a * t; }
  else if (t <= t1 + t2) { s = d1 + vp * (t - t1); v = vp; }
  else { const u = t - t1 - t2; s = d1 + d2 + vp * u - 0.5 * a * u * u; v = vp - a * u; }
  s = Math.min(d, Math.max(0, s));
  return {y: p.y0 + p.dir * s, v: p.dir * Math.max(0, v), done: false};
}

export class ElevatorLogic {
  readonly stops: readonly ElevatorStop[];
  /** Cab floor (absolute y) and signed velocity (m/s). */
  y: number;
  v = 0;
  /** Service direction (SCAN): +1 up, -1 down, 0 none. */
  dir: -1 | 0 | 1 = 0;
  /** Direction of the last departure (0 before the first trip). */
  lastDir: -1 | 0 | 1 = 0;
  /** The direction the cab serves from the stop it reached (the hall lantern): the answered hall call's, else its travel direction. */
  arrivalDir: -1 | 0 | 1 = 0;
  phase: ElevatorPhase = 'idle';
  /** Index of the stop the cab is level at (null while moving). */
  stop: number | null;
  /** Index of the stop it is travelling to (null when idle). */
  target: number | null = null;
  /** Door opening 0 (closed) … 1 (open) — the cab door and the current stop's landing doors move together. */
  door = 0;
  /** -1 closing, 0 still, +1 opening. */
  motion: -1 | 0 | 1 = 0;
  /** Requested stops (indices): landing calls + cab selections. */
  readonly requests = new Set<number>();
  /** Stops with a landing call (either direction) / with the up / down call button lit / selected on the cab panel (lit). */
  readonly hall = new Set<number>();
  readonly hallUp = new Set<number>();
  readonly hallDown = new Set<number>();
  readonly car = new Set<number>();
  /** Departures / arrivals so far (QA). */
  trips = 0;
  arrivals = 0;
  private profile: MotionProfile | null = null;
  private t = 0;
  private openT = 0;
  private minHold = 0;
  private sealedT = 0;
  private pushT = 0;
  private hurry = false;
  private closeReq = false;
  private heldWhy: 'doorway' | 'enemy' | null = null;

  constructor(stops: readonly ElevatorStop[], opts: {floor?: number; open?: boolean} = {}) {
    if (!stops.length) throw new Error('ElevatorLogic: no stops');
    this.stops = [...stops].sort((a, b) => a.y - b.y);
    const k = opts.floor !== undefined ? Math.max(0, this.indexOf(opts.floor)) : 0;
    this.stop = k;
    this.y = this.stops[k].y;
    if (opts.open) this.door = 1;
  }

  indexOf(floor: number): number {
    return this.stops.findIndex(s => s.floor === floor);
  }

  get state(): DoorState {
    return this.motion > 0 ? 'opening' : this.motion < 0 ? 'closing' : this.door >= 1 ? 'open' : this.door <= 0 ? 'closed' : 'opening';
  }

  /** Doors fully closed and still (the only state the cab moves from). */
  get sealed(): boolean { return this.door <= 0 && this.motion === 0; }

  get moving(): boolean { return this.phase === 'moving'; }

  /** The doorway is passable (cab level at a stop, stopped, doors open enough). */
  get gateOpen(): boolean { return this.phase === 'idle' && this.stop !== null && this.door >= GATE_OPEN; }

  /** "Door close" was pressed and the doors have not started closing yet (QA). */
  get closeRequested(): boolean { return this.closeReq; }

  /** Landing door opening of stop i (only the stop the cab stands at can open). */
  landingDoor(i: number): number { return this.phase === 'idle' && this.stop === i ? this.door : 0; }

  /** Stop nearest the cab (indicator / reported storey). */
  get nearest(): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.stops.length; i++) { const d = Math.abs(this.stops[i].y - this.y); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  /** Floor the indicator shows. */
  get floor(): number { return this.stops[this.nearest].floor; }

  private open(ev: ElevatorEvent[]): void {
    if (this.phase !== 'idle' || this.motion === 1 || (this.door >= 1 && this.motion === 0)) return;
    this.motion = 1;
    ev.push({type: 'opening'});
  }

  private close(ev: ElevatorEvent[]): void {
    if (this.motion === -1 || this.door <= 0) return;
    this.motion = -1;
    this.minHold = 0;
    this.heldWhy = null;
    this.closeReq = false;
    ev.push({type: 'closing'});
  }

  /** Every request of stop k is served (its buttons go dark); the lantern takes the answered call's direction. */
  private served(k: number): void {
    const up = this.hallUp.has(k), dn = this.hallDown.has(k);
    this.arrivalDir = up && !dn ? 1 : dn && !up ? -1 : this.lastDir;
    this.requests.delete(k); this.hall.delete(k); this.hallUp.delete(k); this.hallDown.delete(k); this.car.delete(k);
  }

  /**
   * Landing call button on `floor` (dir: the up / down button, 0 = either): the cab comes and that button stays lit until it
   * arrives; at that floor already it opens (re-opens closing doors, holds open ones).
   */
  call(floor: number, dir: -1 | 0 | 1 = 0): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    const k = this.indexOf(floor);
    if (k < 0) return ev;
    if (this.phase === 'idle' && this.stop === k) {
      if (this.motion === -1) { this.motion = 1; this.minHold = REOPEN_HOLD; ev.push({type: 'opening'}); }
      else if (this.door >= 1) this.openT = 0;
      else if (this.motion === 0) { ev.push({type: 'chime', floor}); this.open(ev); }
      this.closeReq = false;
      if (dir) this.arrivalDir = dir;
      return ev;
    }
    if (!this.requests.has(k)) ev.push({type: 'called', floor});
    this.requests.add(k); this.hall.add(k);
    if (dir > 0) this.hallUp.add(k);
    else if (dir < 0) this.hallDown.add(k);
    return ev;
  }

  /** Cab panel floor button. The floor the cab stands at opens the doors. */
  select(floor: number): {ok: boolean; reason?: 'invalid'; events: ElevatorEvent[]} {
    const k = this.indexOf(floor);
    if (k < 0) return {ok: false, reason: 'invalid', events: []};
    if (this.phase === 'idle' && this.stop === k) return {ok: true, events: this.requestOpen()};
    const ev: ElevatorEvent[] = [];
    if (!this.car.has(k)) ev.push({type: 'selected', floor});
    this.requests.add(k); this.car.add(k);
    if (this.phase === 'idle') this.hurry = true;
    return {ok: true, events: ev};
  }

  /** "Open doors" (cab panel): only while standing at a stop (re-opens closing doors, restarts the dwell of open ones). */
  requestOpen(): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    if (this.phase !== 'idle') return ev;
    if (this.motion === -1) { this.motion = 1; this.minHold = REOPEN_HOLD; ev.push({type: 'opening'}); }
    else this.open(ev);
    this.openT = 0;
    this.hurry = false;
    this.closeReq = false;
    return ev;
  }

  /**
   * "Close doors" (cab panel): open / opening doors close CLOSE_DWELL after they are fully open instead of the full dwell. The
   * interlocks stay: a body in the doorway or an enemy inside still re-opens / holds them, and an obstruction hold (REOPEN_HOLD)
   * runs out first. False when there is nothing to close (moving, shut, already closing).
   */
  requestClose(): boolean {
    if (this.phase !== 'idle' || this.door <= 0 || this.motion === -1) return false;
    this.closeReq = true;
    return true;
  }

  /** The next stop to serve from height y (SCAN: requests ahead first, else turn round); sets dir. */
  private choose(y: number, here: number | null): number | null {
    let up = -1, dn = -1;
    for (const k of this.requests) {
      if (k === here) continue;
      const sy = this.stops[k].y;
      if (sy > y + 1e-6 && (up < 0 || sy < this.stops[up].y)) up = k;
      if (sy < y - 1e-6 && (dn < 0 || sy > this.stops[dn].y)) dn = k;
    }
    if (up < 0 && dn < 0) { this.dir = 0; return null; }
    if ((this.dir >= 0 && up >= 0) || dn < 0) { this.dir = 1; return up; }
    this.dir = -1;
    return dn;
  }

  /** A requested stop between the cab and its target that it can still brake for (nearest). */
  private onTheWay(): number | null {
    if (this.target === null) return null;
    const ty = this.stops[this.target].y, dir = this.dir, sp = Math.abs(this.v);
    const brake = (sp * sp) / (2 * CAB_ACCEL);
    let best: number | null = null, bd = Infinity;
    for (const k of this.requests) {
      if (k === this.target) continue;
      const sy = this.stops[k].y, d = (sy - this.y) * dir;
      if (d <= 1e-3 || (ty - sy) * dir <= 1e-3) continue;
      if (brake > d - 1e-3) continue;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  private arrive(k: number, ev: ElevatorEvent[]): void {
    this.y = this.stops[k].y; this.v = 0;
    this.phase = 'idle'; this.stop = k; this.target = null; this.profile = null;
    this.served(k);
    this.arrivals++;
    this.openT = 0; this.minHold = 0; this.hurry = false; this.sealedT = 0; this.closeReq = false;
    ev.push({type: 'arrive', floor: this.stops[k].floor}, {type: 'chime', floor: this.stops[k].floor});
    this.open(ev);
  }

  update(dt: number, sense: ElevatorSense): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    if (this.phase === 'moving') {
      // doors stay shut while moving (never opened between stops)
      const alt = this.onTheWay();
      if (alt !== null) { this.target = alt; this.profile = planMotion(this.y, Math.abs(this.v), this.stops[alt].y); this.t = 0; }
      this.t += dt;
      const s = sampleMotion(this.profile!, this.t);
      this.y = s.y; this.v = s.v;
      if (s.done) this.arrive(this.target!, ev);
      return ev;
    }
    // --- standing level at a stop: doors ---
    const here = this.stop!;
    if (this.motion === 1) {
      this.door = Math.min(1, this.door + dt / DOOR_TIME);
      if (this.door >= 1) { this.motion = 0; this.openT = 0; ev.push({type: 'opened'}); }
    } else if (this.motion === -1) {
      if (sense.doorway || sense.enemyInside) {
        // never crush / trap: a body in the doorway (or an enemy inside) re-opens the doors
        this.motion = 1; this.minHold = REOPEN_HOLD; this.openT = 0;
        ev.push({type: 'reopen', why: sense.doorway ? 'doorway' : 'enemy'});
      } else {
        this.door = Math.max(0, this.door - dt / DOOR_TIME);
        if (this.door <= 0) { this.motion = 0; this.sealedT = 0; this.hurry = false; ev.push({type: 'closed'}); }
      }
    }
    if (this.door >= 1 && this.motion === 0) this.openT += dt;
    // a call / selection for the floor it stands at is served right here
    if (this.requests.has(here)) {
      this.served(here);
      if (this.motion !== 1 && this.door < 1) { if (this.motion === -1) { this.motion = 1; ev.push({type: 'opening'}); } else this.open(ev); }
      this.openT = 0;
    }
    const next = this.choose(this.y, here);
    if (this.door >= 1 && this.motion === 0) {
      const base = next !== null ? (this.hurry ? HURRY : DWELL_BUSY) : DWELL;
      const dwell = Math.max(this.closeReq ? Math.min(base, CLOSE_DWELL) : base, this.minHold);
      if (this.openT >= dwell) {
        const why = sense.enemyInside ? 'enemy' : sense.doorway ? 'doorway' : null;
        if (!why) this.close(ev);
        else if (why !== this.heldWhy) ev.push({type: 'held', why});
        this.heldWhy = why;
      }
    }
    if (this.sealed) {
      this.sealedT += dt;
      if (next !== null) {
        this.pushT = 0;
        if (sense.enemyInside) { ev.push({type: 'reopen', why: 'enemy'}); this.open(ev); }
        else if (!sense.doorway && this.sealedT >= START_DELAY) {
          const from = this.stops[here].floor;
          this.phase = 'moving'; this.stop = null; this.target = next; this.t = 0;
          this.profile = planMotion(this.y, 0, this.stops[next].y);
          this.trips++;
          this.lastDir = this.dir >= 0 ? 1 : -1;
          ev.push({type: 'depart', from, to: this.stops[next].floor, dir: this.lastDir});
        }
      } else if (sense.pushOpen) {
        this.pushT += dt;
        if (this.pushT >= PUSH_OPEN) { this.pushT = 0; this.open(ev); }
      } else this.pushT = 0;
    } else this.pushT = 0;
    return ev;
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry plan (pure)

export interface CallMount { at: P3; n: [number, number]; box: Box3Like; eye: P3; /** Station centre along the door wall (gate l). */ l: number }

export type LiftButtonKind = 'floor' | 'open' | 'close' | 'alarm' | 'up' | 'down';

/** One physical button: an in-world target (aim within reach + left click / E). */
export interface LiftButton {
  /** 'car-5', 'car-L', 'car-open', 'car-close', 'car-alarm'; 'hall-3-up', 'hall-L-up', 'hall-8-down'. */
  id: string;
  where: 'car' | 'hall';
  kind: LiftButtonKind;
  /** Stop index of a floor / hall button (-1: open / close / alarm). */
  stop: number;
  /** Floor of that stop (0: open / close / alarm). */
  floor: number;
  /** Glyph on the cap ('L', '2' … for floors; the kind for the rest). */
  glyph: string;
  /** In the car's local frame (CabFrame: l along the door wall, w into the cab): y above the cab floor (car) / the stop floor (hall). */
  local: {l: number; y: number; w: number};
  /** Centre of the cap face: car buttons RELATIVE to the cab floor (y), hall buttons absolute. */
  at: P3;
  /** Facing normal (x, z): into the cab (car) / into the corridor (hall). */
  n: [number, number];
  r: number;
  /** Pick box (car: relative to the cab floor — lift it by the cab's y). */
  box: Box3Like;
}

/**
 * The car's local frame: l along the door wall (the gate tangent, 0 = door centre), y up from the cab floor, w INTO the cab from
 * the door plane (w = -s; the shaft's corridor face is w = -gate.depth). lMin..lMax / 0..depth bound the cab interior.
 */
export interface CabFrame { lMin: number; lMax: number; depth: number }

/** The car operating panel on the front return (local frame; y above the cab floor). */
export interface CopLayout { l: number; halfW: number; y0: number; y1: number; screenY: number; labelY: number; key: [number, number] }

export interface ElevatorPlan {
  info: ElevatorInfo;
  /** Doorway: cab plane s = 0, landing plane s = depth (the shaft wall). */
  gate: DoorGate;
  /** Doorway clear height and cab interior height above the cab floor (m). */
  doorH: number;
  cabH: number;
  /** The doorway through the shaft wall (world x / z). */
  passage: Rect2;
  /** Inside floor panel (COP): mount (y RELATIVE to the cab floor), room-facing normal, plate box (relative), sight target (relative). */
  panelLocal: P3;
  panelN: [number, number];
  panelBox: Box3Like;
  panelEye: P3;
  /** Per stop: the landing call station (absolute). */
  calls: CallMount[];
  frame: CabFrame;
  cop: CopLayout;
  /** Every button: the cab panel's, then every landing's. */
  buttons: LiftButton[];
  carButtons: LiftButton[];
  /** Per stop index: that landing's call buttons (lobby: up only; top floor: down only; else up + down). */
  hallButtons: LiftButton[][];
}

/** COP / call station dimensions (m): plate thickness, cap height, column / row pitch of the floor buttons. */
const PLATE_T = 0.012, CAR_BTN_D = 0.006, HALL_PLATE_T = 0.012, HALL_BTN_D = 0.007;
const COP_DX = 0.045, COP_DY = 0.11;
/** The cab's jamb returns (door pockets), wall shell, panel thickness, corner posts proud of the panels, reveals (m). */
const JAMB = 0.04, SHELL = 0.02, PANEL = 0.014, POST = 0.012, REVEAL = 0.012;

/** Plans the doorway gate, the cab panel and every landing's call station (each button a target) from the v2 contract. */
export function planElevator(info: ElevatorInfo): ElevatorPlan {
  const {cab, door, shaft} = info;
  const [nx, nz] = sideNormal(info.doorSide);
  const tx = -nz, tz = nx;
  const cx = nx > 0 ? cab.x1 : nx < 0 ? cab.x0 : Math.max(cab.x0 + 0.3, Math.min(cab.x1 - 0.3, door.x));
  const cz = nz > 0 ? cab.z1 : nz < 0 ? cab.z0 : Math.max(cab.z0 + 0.3, Math.min(cab.z1 - 0.3, door.z));
  const sideLen = Math.abs(nx) > 0 ? cab.z1 - cab.z0 : cab.x1 - cab.x0;
  const hw = Math.max(0.35, Math.min(door.width / 2, sideLen / 2 - 0.08));
  let depth = nx > 0 ? shaft.x1 - cab.x1 : nx < 0 ? cab.x0 - shaft.x0 : nz > 0 ? shaft.z1 - cab.z1 : cab.z0 - shaft.z0;
  if (!(depth > 0.05)) depth = 0.5;
  const gate: DoorGate = {cx, cz, nx, nz, tx, tz, hw, depth};
  const cabH = info.cabHeight;
  const doorH = Math.min(LIFT_DOOR_H, cabH - 0.15);
  const [pa, pb] = [gateWorld(gate, 0, -hw), gateWorld(gate, depth, hw)];
  const passage: Rect2 = {x0: Math.min(pa[0], pb[0]), z0: Math.min(pa[1], pb[1]), x1: Math.max(pa[0], pb[0]), z1: Math.max(pa[1], pb[1])};
  // the car's local frame (l along the door wall from the door centre, w into the cab)
  const lc = Math.abs(nx) > 0.5 ? (cz - (cab.z0 + cab.z1) / 2) * tz : (cx - (cab.x0 + cab.x1) / 2) * tx;
  const frame: CabFrame = {lMin: -sideLen / 2 - lc, lMax: sideLen / 2 - lc, depth: Math.abs(nx) > 0.5 ? cab.x1 - cab.x0 : cab.z1 - cab.z0};
  const toW = (l: number, w: number) => gateWorld(gate, -w, l);
  // --- the car operating panel: on the front return beside the opening (side from the contract's panel mount) ---
  const raw = (info.panel.x - cx) * tx + (info.panel.z - cz) * tz;
  const sgn = raw < 0 ? -1 : 1;
  const sideMax = sgn > 0 ? frame.lMax : -frame.lMin;
  const inner = hw + JAMB + 0.012, outer = sideMax - (SHELL + PANEL + POST) - 0.012;
  const halfW = Math.max(0.06, Math.min(0.11, (outer - inner) / 2));
  const lo = inner + halfW, hi = outer - halfW;
  const lp = sgn * (lo <= hi ? Math.min(hi, Math.max(lo, Math.abs(raw))) : (inner + outer) / 2);
  const dy = info.panel.dy;
  const n = info.stops.length, rows = Math.ceil(n / 2);
  const yFloor0 = dy - 0.2, yDoor = yFloor0 - 0.12, yAlarm = yDoor - 0.12;
  const labelY = yFloor0 + (rows - 1) * COP_DY + 0.17, screenY = labelY + 0.12;
  const cop: CopLayout = {l: lp, halfW, y0: yAlarm - 0.07, y1: screenY + 0.07, screenY, labelY, key: [lp + COP_DX, yAlarm]};
  const panelN: [number, number] = [-nx || 0, -nz || 0];
  const [px, pz] = toW(lp, CAB_FRONT);
  const panelLocal: P3 = {x: px, y: dy, z: pz};
  const panelBox = wallBox({x: px, y: (cop.y0 + cop.y1) / 2, z: pz}, panelN, halfW * 2, cop.y1 - cop.y0, 0.12);
  const panelEye: P3 = {x: px + panelN[0] * 0.12, y: dy, z: pz + panelN[1] * 0.12};
  const carButtons: LiftButton[] = [];
  const carFace = CAB_FRONT + PLATE_T, carSize = CAR_BUTTON_R * 2 + 0.014;
  const carBtn = (kind: LiftButtonKind, stop: number, floor: number, glyph: string, id: string, l: number, y: number): void => {
    const [x, z] = toW(l, carFace + CAR_BTN_D), [bx, bz] = toW(l, carFace);
    carButtons.push({id, where: 'car', kind, stop, floor, glyph, local: {l, y, w: carFace + CAR_BTN_D}, at: {x, y, z}, n: panelN, r: CAR_BUTTON_R,
      box: wallBox({x: bx, y, z: bz}, panelN, carSize, carSize, 0.03)});
  };
  // floors bottom-up in two columns (L 2 / 3 4 / 5 6 / 7 8), as seen facing the panel: left column = smaller l
  info.stops.forEach((st, i) => carBtn('floor', i, st.floor, floorLabel(st.floor), `car-${floorLabel(st.floor)}`, lp + (i % 2 ? COP_DX : -COP_DX), yFloor0 + Math.floor(i / 2) * COP_DY));
  carBtn('open', -1, 0, 'open', 'car-open', lp - COP_DX, yDoor);
  carBtn('close', -1, 0, 'close', 'car-close', lp + COP_DX, yDoor);
  carBtn('alarm', -1, 0, 'alarm', 'car-alarm', lp - COP_DX, yAlarm);
  // --- landing call stations: flat on the corridor face of the shaft wall beside the doorway ---
  const calls: CallMount[] = [], hallButtons: LiftButton[][] = [];
  const hallFace = depth + HALL_PLATE_T, hallSize = HALL_BUTTON_R * 2 + 0.016;
  info.stops.forEach((st, i) => {
    const l = clampBeside((st.callPanel.x - cx) * tx + (st.callPanel.z - cz) * tz, hw, Infinity, 0.3);
    const [x, z] = gateWorld(gate, depth, l);
    const at: P3 = {x, y: st.callPanel.y, z};
    const nn: [number, number] = [nx, nz];
    calls.push({at, n: nn, box: wallBox(at, nn, 0.26, 0.4, 0.12), eye: {x: x + nx * 0.12, y: at.y, z: z + nz * 0.12}, l});
    const dirs: ('up' | 'down')[] = n < 2 ? [] : i === 0 ? ['up'] : i === n - 1 ? ['down'] : ['up', 'down'];
    const label = floorLabel(st.floor);
    hallButtons.push(dirs.map((k): LiftButton => {
      const y = st.callPanel.y + (dirs.length > 1 ? (k === 'up' ? 0.055 : -0.055) : 0);
      const [hx, hz] = gateWorld(gate, hallFace + HALL_BTN_D, l), [bx, bz] = gateWorld(gate, hallFace, l);
      return {id: `hall-${label}-${k}`, where: 'hall', kind: k, stop: i, floor: st.floor, glyph: k, local: {l, y: y - st.y, w: -(hallFace + HALL_BTN_D)},
        at: {x: hx, y, z: hz}, n: nn, r: HALL_BUTTON_R, box: wallBox({x: bx, y, z: bz}, nn, hallSize, hallSize, 0.035)};
    }));
  });
  return {info, gate, doorH, cabH, passage, panelLocal, panelN, panelBox, panelEye, calls, frame, cop, buttons: [...carButtons, ...hallButtons.flat()], carButtons, hallButtons};
}

/** Keep a wall mount beside the opening (|l| >= hw + margin) and within `max` of the side centre. */
function clampBeside(l: number, hw: number, max: number, margin: number): number {
  let v = l;
  if (Math.abs(v) < hw + margin) v = (v < 0 ? -1 : 1) * (hw + margin);
  if (Number.isFinite(max) && Math.abs(v) > max - 0.12) v = Math.sign(v) * Math.max(hw + 0.12, max - 0.12);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Live floor indicator and the button glyph atlas (canvas-drawn digits / symbols / labels only)

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

/** Live floor indicator: one canvas texture for every indicator of the elevator (in the cab, on its panel, at every landing). */
class Indicator {
  readonly canvas: HTMLCanvasElement | null;
  readonly texture: THREE.Texture;
  readonly material: MeshBasicNodeMaterial;
  last = '';
  constructor() {
    this.canvas = hasCanvas() ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.width = 128; this.canvas.height = 64; }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.DataTexture(new Uint8Array([20, 8, 4, 255]), 1, 1);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new MeshBasicNodeMaterial({map: this.texture, color: 0xffffff});
    this.material.name = 'tower-indicator';
    this.draw('L', 0);
  }
  /** dir: +1 up, -1 down, 0 none. */
  draw(text: string, dir: number): void {
    const key = `${text}|${dir}`;
    if (key === this.last) return;
    this.last = key;
    const ctx = this.canvas?.getContext('2d');
    if (!ctx) return;
    // dark smoked glass, a dim unlit arrow pair, the lit floor in amber
    ctx.fillStyle = '#0d0706'; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#1d0f0a'; ctx.fillRect(3, 3, 122, 58);
    const arrow = (up: boolean, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      if (up) { ctx.moveTo(26, 9); ctx.lineTo(41, 29); ctx.lineTo(11, 29); }
      else { ctx.moveTo(26, 55); ctx.lineTo(41, 35); ctx.lineTo(11, 35); }
      ctx.closePath(); ctx.fill();
    };
    arrow(true, dir > 0 ? '#ff8a2a' : '#3a1a10');
    arrow(false, dir < 0 ? '#ff8a2a' : '#3a1a10');
    ctx.fillStyle = '#ff8a2a';
    ctx.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 84, 34);
    this.texture.needsUpdate = true;
  }
}
let indicator: Indicator | null = null;
const getIndicator = (): Indicator => (indicator ??= new Indicator());

/** Atlas layout: 8 x 8 cells of 64 px; glyphs unlit in cells 0.., lit at LIT_CELL + i; labels / flat cells in the last two rows. */
const ATLAS_PX = 512, ATLAS_N = 8, CELL_PX = ATLAS_PX / ATLAS_N;
const FLOOR_GLYPHS = Array.from({length: 15}, (_, i) => floorLabel(i + 1));
const GLYPHS = [...FLOOR_GLYPHS, 'open', 'close', 'alarm', 'up', 'down', 'key', 'lantern-up', 'lantern-down'];
const LIT_CELL = 24;
const CELL_CAPACITY = 48, CELL_STEEL = 52, CELL_BLACK = 53, CELL_FIRE = 56;
/** Fraction of a cell's half-size the cap disc fills (4 px of steel margin keep mipmaps from bleeding into the neighbours). */
const DISC_K = 28 / 32;

interface UVRect { u0: number; v0: number; u1: number; v1: number }
/** UV rect of atlas cell `index` (spanning `w` cells to the right). The canvas texture is flipped: canvas row 0 is the top (v = 1). */
function cellUV(index: number, w = 1): UVRect {
  const cx = index % ATLAS_N, cy = Math.floor(index / ATLAS_N);
  return {u0: cx / ATLAS_N, u1: (cx + w) / ATLAS_N, v0: 1 - (cy + 1) / ATLAS_N, v1: 1 - cy / ATLAS_N};
}
const glyphCell = (glyph: string, lit = false): number => {
  const i = GLYPHS.indexOf(glyph);
  return (i < 0 ? 0 : i) + (lit ? LIT_CELL : 0);
};
const cellCentre = (index: number): [number, number] => { const r = cellUV(index); return [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2]; };

/** Braille dots (1 2 3 down the left, 4 5 6 down the right) beside the floor / door buttons (a tactile hint, not a reading aid). */
const BRAILLE: Record<string, number[]> = {
  L: [1, 2, 3], 2: [1, 2], 3: [1, 4], 4: [1, 4, 5], 5: [1, 5], 6: [1, 2, 4], 7: [1, 2, 4, 5], 8: [1, 2, 5], 9: [2, 4], 10: [1], 11: [1], 12: [1, 2],
  13: [1, 4], 14: [1, 4, 5], 15: [1, 5], open: [1, 3, 5], close: [1, 4],
};

type Ctx2D = CanvasRenderingContext2D;
function drawGlyph(ctx: Ctx2D, glyph: string, cx: number, cy: number, ink: string): void {
  ctx.fillStyle = ink;
  const tri = (pts: number[]) => { ctx.beginPath(); ctx.moveTo(cx + pts[0], cy + pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cx + pts[i], cy + pts[i + 1]); ctx.closePath(); ctx.fill(); };
  switch (glyph) {
    case 'up': tri([0, -12, 12, 8, -12, 8]); return;
    case 'down': tri([0, 12, 12, -8, -12, -8]); return;
    case 'open': ctx.fillRect(cx - 1.5, cy - 11, 3, 22); tri([-4, -8, -4, 8, -15, 0]); tri([4, -8, 4, 8, 15, 0]); return;
    case 'close': ctx.fillRect(cx - 1.5, cy - 11, 3, 22); tri([-15, -8, -15, 8, -5, 0]); tri([15, -8, 15, 8, 5, 0]); return;
    case 'alarm':
      ctx.beginPath(); ctx.arc(cx, cy - 1, 10, Math.PI, 0); ctx.lineTo(cx + 11, cy + 7); ctx.lineTo(cx - 11, cy + 7); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - 13, cy + 6, 26, 3);
      ctx.beginPath(); ctx.arc(cx, cy + 12, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - 12, 2.2, 0, Math.PI * 2); ctx.fill();
      return;
    case 'key':
      ctx.beginPath(); ctx.arc(cx, cy - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 2.5, cy - 2, 5, 12);
      return;
    default:
      ctx.font = `bold ${glyph.length > 1 ? 24 : 30}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(glyph, cx, cy + 1);
  }
}

function drawCell(ctx: Ctx2D, index: number, glyph: string, lit: boolean): void {
  const x0 = (index % ATLAS_N) * CELL_PX, y0 = Math.floor(index / ATLAS_N) * CELL_PX, cx = x0 + 32, cy = y0 + 32;
  const disc = (r: number, fill: string | CanvasGradient) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); };
  if (glyph.startsWith('lantern')) {
    // hall lantern lens: a big arrow behind dark amber acrylic (lit: glowing)
    ctx.fillStyle = '#17110e'; ctx.fillRect(x0, y0, CELL_PX, CELL_PX);
    if (lit) { const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34); g.addColorStop(0, 'rgba(255,170,70,0.75)'); g.addColorStop(1, 'rgba(255,140,40,0)'); ctx.fillStyle = g; ctx.fillRect(x0, y0, CELL_PX, CELL_PX); }
    ctx.fillStyle = lit ? '#ffc061' : '#4b2e18';
    ctx.beginPath();
    if (glyph === 'lantern-up') { ctx.moveTo(cx, cy - 22); ctx.lineTo(cx + 22, cy + 15); ctx.lineTo(cx - 22, cy + 15); }
    else { ctx.moveTo(cx, cy + 22); ctx.lineTo(cx + 22, cy - 15); ctx.lineTo(cx - 22, cy - 15); }
    ctx.closePath(); ctx.fill();
    return;
  }
  const alarm = glyph === 'alarm', key = glyph === 'key';
  ctx.fillStyle = '#8c9093'; ctx.fillRect(x0, y0, CELL_PX, CELL_PX);
  disc(28, '#2d3032'); // the gap around the cap
  const g = ctx.createRadialGradient(cx - 7, cy - 9, 2, cx, cy, 27);
  g.addColorStop(0, alarm ? '#f2d270' : key ? '#c4c7c8' : '#e0e3e3'); g.addColorStop(1, alarm ? '#a27a20' : key ? '#6e7275' : '#878b8e');
  disc(26.5, g);
  if (!key) {
    // the LED halo ring (dark when unlit)
    ctx.strokeStyle = lit ? (alarm ? '#ff6d3a' : '#ffb84a') : '#5e5b54';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(cx, cy, 22.5, 0, Math.PI * 2); ctx.stroke();
  }
  if (lit) {
    const h = ctx.createRadialGradient(cx, cy, 4, cx, cy, 27);
    h.addColorStop(0, 'rgba(255,190,90,0.55)'); h.addColorStop(1, 'rgba(255,160,60,0.05)');
    disc(26.5, h);
  }
  // the tactile glyph: raised (a light edge below-right) when unlit, glowing amber when lit
  if (!lit && !key) drawGlyph(ctx, glyph, cx + 0.8, cy + 0.8, 'rgba(240,242,242,0.55)');
  drawGlyph(ctx, glyph, cx, cy, key ? '#121314' : lit ? '#ffd98a' : alarm ? '#3a2a0c' : '#26282a');
}

function drawLabel(ctx: Ctx2D, index: number, w: number, kind: 'capacity' | 'fire'): void {
  const x0 = (index % ATLAS_N) * CELL_PX, y0 = Math.floor(index / ATLAS_N) * CELL_PX, W = w * CELL_PX;
  const fire = kind === 'fire';
  ctx.fillStyle = fire ? '#8a2a1f' : '#2a2c2d'; ctx.fillRect(x0, y0, W, CELL_PX);
  ctx.strokeStyle = fire ? '#c9b8a6' : '#56595b'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 3, y0 + 3, W - 6, CELL_PX - 6);
  ctx.fillStyle = fire ? '#f2ece2' : '#c9cccd';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${fire ? 18 : 20}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(fire ? 'IN CASE OF FIRE' : '1600 kg · 21 PERSONS', x0 + W / 2, y0 + 23);
  ctx.font = `${fire ? 13 : 14}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(fire ? 'DO NOT USE ELEVATOR · USE STAIRS' : 'PASSENGER ELEVATOR · CAR 1', x0 + W / 2, y0 + 45);
}

/** One texture for every button / lens / plate of the elevator; two materials share it (unlit caps, self-lit overlays). */
class ButtonAtlas {
  readonly texture: THREE.Texture;
  /** Caps / plates / lenses as lit by the scene (+ a faint glow so they read in the dark). */
  readonly face: SurfaceNodeMaterial;
  /** Lit buttons / lantern arrows: self-lit (emissive look; no light). */
  readonly lit: MeshBasicNodeMaterial;
  constructor() {
    const canvas = hasCanvas() ? document.createElement('canvas') : null;
    if (canvas) {
      canvas.width = canvas.height = ATLAS_PX;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#8c9093'; ctx.fillRect(0, 0, ATLAS_PX, ATLAS_PX);
        GLYPHS.forEach((g, i) => { drawCell(ctx, i, g, false); drawCell(ctx, LIT_CELL + i, g, true); });
        drawLabel(ctx, CELL_CAPACITY, 4, 'capacity');
        drawLabel(ctx, CELL_FIRE, 4, 'fire');
        const flat = (i: number, c: string) => { ctx.fillStyle = c; ctx.fillRect((i % ATLAS_N) * CELL_PX, Math.floor(i / ATLAS_N) * CELL_PX, CELL_PX, CELL_PX); };
        flat(CELL_STEEL, '#9a9ea1'); flat(CELL_BLACK, '#141516');
      }
    }
    this.texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.DataTexture(new Uint8Array([150, 154, 156, 255]), 1, 1);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
    this.face = new SurfaceNodeMaterial({map: this.texture, roughness: 0.42, metalness: 0.3, color: 0xffffff});
    this.face.emissive.setRGB(1, 0.95, 0.88); this.face.emissiveMap = this.texture; this.face.emissiveIntensity = 0.16;
    this.face.name = 'tower-button-face';
    this.lit = new MeshBasicNodeMaterial({map: this.texture, color: 0xffffff});
    this.lit.name = 'tower-button-lit';
  }
}
let atlas: ButtonAtlas | null = null;
const getAtlas = (): ButtonAtlas => (atlas ??= new ButtonAtlas());

// ---------------------------------------------------------------------------------------------
// Materials (module singletons: shared by every stop / world, never disposed)

const basicMats = new Map<string, MeshBasicNodeMaterial>();
function basicMat(name: string, rgb: [number, number, number]): MeshBasicNodeMaterial {
  let m = basicMats.get(name);
  if (!m) { m = new MeshBasicNodeMaterial({color: new THREE.Color(...rgb)}); m.name = name; basicMats.set(name, m); }
  return m;
}

const faceMats = new Map<string, SurfaceNodeMaterial>();
/**
 * A face-UV surface material (geometry UVs in metres / span: the texture moves WITH the cab, never swims) with an optional
 * warm self-glow (emissive x the albedo map) — the cab's own downlights light it; no scene light is added.
 */
function faceMat(name: string, surf: SurfaceName, p: {color?: number; metalness?: number; glow?: number}): SurfaceNodeMaterial {
  let m = faceMats.get(name);
  if (!m) {
    const s = surface(surf);
    m = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: p.metalness ?? 0, color: p.color ?? 0xffffff});
    if (p.glow) { m.emissive.setRGB(1, 0.93, 0.82); m.emissiveMap = s.map; m.emissiveIntensity = p.glow; }
    m.name = name;
    faceMats.set(name, m);
  }
  return m;
}

/** The cab floor: the world's terrazzo (field + a darker border band), face-UV; one pair per WorldMaterials. */
const floorMats = new WeakMap<WorldMaterials, {field: SurfaceNodeMaterial; border: SurfaceNodeMaterial}>();
function cabFloorMats(mats: WorldMaterials): {field: SurfaceNodeMaterial; border: SurfaceNodeMaterial} {
  let f = floorMats.get(mats);
  if (!f) {
    const src = mats.get('terrazzo') as THREE.MeshStandardMaterial | undefined;
    const map = src?.map ?? surface('quarryTile').map;
    const make = (name: string, color: number, glow: number): SurfaceNodeMaterial => {
      const m = new SurfaceNodeMaterial({map, roughness: 0.55, metalness: 0, color});
      m.emissive.setRGB(1, 0.93, 0.82); m.emissiveMap = map; m.emissiveIntensity = glow;
      m.name = name;
      return m;
    };
    f = {field: make('tower-cab-floor', 0xe4dfd4, 0.12), border: make('tower-cab-floor-border', 0x6a645b, 0.08)};
    floorMats.set(mats, f);
  }
  return f;
}

/** The cab / door / button materials (QA / tests: names). */
export function elevatorMaterials() {
  const a = getAtlas();
  return {
    cabSteel: faceMat('tower-cab-steel', 'brushedSteel', {metalness: 0.45, glow: 0.2, color: 0xe4e2dc}),
    cabWood: faceMat('tower-cab-wood', 'woodVeneer', {color: 0xd4c0a8, glow: 0.18}),
    cabMirror: faceMat('tower-cab-mirror', 'mirror', {color: 0x5b6569, metalness: 0.6, glow: 0.07}),
    cabDark: faceMat('tower-cab-dark', 'black', {glow: 0.03}),
    cabCeil: faceMat('tower-cab-ceiling', 'brushedSteel', {color: 0x9d9b96, metalness: 0.4, glow: 0.2}),
    cabRail: faceMat('tower-cab-rail', 'brushedSteel', {metalness: 0.6, color: 0xf4f4f4, glow: 0.22}),
    door: faceMat('tower-door-steel', 'brushedSteel', {metalness: 0.5, color: 0xdedcd6}),
    light: basicMat('tower-cab-light', [0.95, 0.91, 0.82]),
    lightFlicker: basicMat('tower-cab-light-flicker', [0.95, 0.91, 0.82]),
    hover: basicMat('tower-button-hover', [0.85, 0.95, 1.0]),
    face: a.face,
    lit: a.lit,
    indicator: getIndicator().material,
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** Box centred at (x, y, z) with half sizes; UVs in metres / span per face (face-UV materials tile at real scale). */
function boxAt(x: number, y: number, z: number, hx: number, hy: number, hz: number, span = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry faces: +x, -x (u: depth, v: height), +y, -y (u: width, v: depth), +z, -z (u: width, v: height); 4 verts each
  const dims: [number, number][] = [[hz * 2, hy * 2], [hz * 2, hy * 2], [hx * 2, hz * 2], [hx * 2, hz * 2], [hx * 2, hy * 2], [hx * 2, hy * 2]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / span, uv.getY(i) * dims[f][1] / span);
  }
  g.translate(x, y, z);
  return g;
}

function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Remap a geometry's 0..1 UVs into an atlas rect. */
function mapUV(g: THREE.BufferGeometry, r: UVRect): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
  return g;
}

/** Every UV at one atlas point (a flat-coloured piece of the button mesh: grooves, the key switch body). */
function flatUV(g: THREE.BufferGeometry, p: [number, number]): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p[0], p[1]);
  return g;
}

/**
 * A round push button facing +Z: its base at z = 0, the cap face at z = depth; the cap shows atlas cell `face` (upright and
 * unmirrored for a viewer looking at it along -Z: right = +X), the rim samples one flat atlas point.
 */
function capGeometry(r: number, depth: number, face: UVRect, rim: [number, number], segs = 20): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const cu = (face.u0 + face.u1) / 2, cv = (face.v0 + face.v1) / 2, hu = (face.u1 - face.u0) / 2 * DISC_K, hv = (face.v1 - face.v0) / 2 * DISC_K;
  pos.push(0, 0, depth); nor.push(0, 0, 1); uv.push(cu, cv);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r, s * r, depth); nor.push(0, 0, 1); uv.push(cu + c * hu, cv + s * hv);
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 2 + i);
  if (depth > 0) {
    const b = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, s * r, depth, c * r, s * r, 0); nor.push(c, s, 0, c, s, 0); uv.push(rim[0], rim[1], rim[0], rim[1]);
    }
    for (let i = 0; i < segs; i++) { const p = b + i * 2; idx.push(p, p + 1, p + 2, p + 2, p + 1, p + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A flat quad facing +Z (centred) showing an atlas rect. */
const quadGeometry = (w: number, h: number, r: UVRect): THREE.BufferGeometry => mapUV(new THREE.PlaneGeometry(w, h), r);

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const m = mergeGeometries(parts, false) ?? parts[0];
  for (const p of parts) if (p !== m) p.dispose();
  return m;
}

/**
 * Local -> world of the car frame (CabFrame): x = l along the gate tangent, y up, z = w into the cab (= -gate normal), origin at
 * the door centre on the cab plane. A proper rotation about y (no mirroring: triangle winding / culling stay intact).
 */
function frameMatrix(G: DoorGate, translate = true): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    G.tx, 0, -G.nx, translate ? G.cx : 0,
    0, 1, 0, 0,
    G.tz, 0, -G.nz, translate ? G.cz : 0,
    0, 0, 0, 1);
}

type V3 = [number, number, number];

/** Geometry accumulated per material key in the car frame, merged + mapped to the world at the end. */
class Parts {
  private readonly by = new Map<string, THREE.BufferGeometry[]>();
  constructor(private readonly spans: Readonly<Record<string, number>> = {}) {}
  add(key: string, g: THREE.BufferGeometry): THREE.BufferGeometry {
    let a = this.by.get(key);
    if (!a) this.by.set(key, (a = []));
    a.push(g);
    return g;
  }
  /** Axis box l0..l1 x y0..y1 x w0..w1 (UVs metres / the key's span). */
  box(key: string, l0: number, l1: number, y0: number, y1: number, w0: number, w1: number): THREE.BufferGeometry | null {
    if (l1 - l0 < 1e-5 || y1 - y0 < 1e-5 || w1 - w0 < 1e-5) return null;
    return this.add(key, boxAt((l0 + l1) / 2, (y0 + y1) / 2, (w0 + w1) / 2, (l1 - l0) / 2, (y1 - y0) / 2, (w1 - w0) / 2, this.spans[key] ?? 1));
  }
  /** Round bar a -> b (open-ended tube when `open`, else a closed puck; UVs metres / span). */
  rod(key: string, a: V3, b: V3, r: number, open = true, segs = 12): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const span = this.spans[key] ?? 1;
    const g = new THREE.CylinderGeometry(r, r, len, segs, 1, open);
    scaleUV(g, (2 * Math.PI * r) / span, len / span);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len)));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.add(key, g);
  }
  ball(key: string, c: V3, r: number): void {
    const span = this.spans[key] ?? 1;
    const g = new THREE.SphereGeometry(r, 10, 6);
    scaleUV(g, (2 * Math.PI * r) / span, (Math.PI * r) / span);
    g.translate(c[0], c[1], c[2]);
    this.add(key, g);
  }
  /** A flat disc / ring facing down (ceiling fittings). */
  ceilingDisc(key: string, l: number, y: number, w: number, r0: number, r1: number): void {
    const g = r0 > 0 ? new THREE.RingGeometry(r0, r1, 20) : new THREE.CircleGeometry(r1, 20);
    g.rotateX(Math.PI / 2);
    g.translate(l, y, w);
    this.add(key, g);
  }
  /** Merged geometry of a key mapped by m (null: none). */
  take(key: string, m: THREE.Matrix4): THREE.BufferGeometry | null {
    const a = this.by.get(key);
    if (!a?.length) return null;
    this.by.delete(key);
    return merged(a).applyMatrix4(m);
  }
}

// ---------------------------------------------------------------------------------------------
// three.js view

/** What the panels light (the runtime fills one reused object per frame). */
export interface LampState {
  car: ReadonlySet<number>;
  hallUp: ReadonlySet<number>;
  hallDown: ReadonlySet<number>;
  /** The cab panel's door open / close / alarm buttons are lit (pressed recently / ringing). */
  open: boolean;
  close: boolean;
  alarm: boolean;
  /** Hall lantern: the stop whose lantern is lit (-1 none) and its arrow (+1 up / -1 down). */
  lanternStop: number;
  lanternDir: number;
}

export interface ElevatorView {
  root: THREE.Group;
  /** The moving cab (position.y = cab floor). */
  cab: THREE.Group;
  /** Per stop (static, at stop.y; meshes tagged userData.level = the storey). */
  landings: THREE.Group[];
  /** Cab floor y and the cab door opening. */
  setCab(y: number, door: number): void;
  /** Landing door opening of stop i. */
  setLanding(i: number, door: number): void;
  setIndicator(text: string, dir: number): void;
  /** Lit buttons / lanterns (cheap: visibility flags only; call every frame). */
  setLamps(s: LampState): void;
  /** The hover ring around the targeted button (null: none). */
  setHover(b: LiftButton | null): void;
  /** Animated emissives (a tired cab downlight, the hover pulse): uniform values only. */
  tick(t: number): void;
  /** Lit overlays by button id ('car-5', 'hall-3-up', also 'lantern-3-up'): QA / tests. */
  lit: ReadonlyMap<string, THREE.Mesh>;
  /** Geometries owned by this view (disposed with the world; materials are shared singletons). */
  geometries: THREE.BufferGeometry[];
}

/** A tired downlight: steady, with a short stutter every few seconds (deterministic in t). */
export function flickerLevel(t: number): number {
  const s = Math.sin(t * 1.7) + Math.sin(t * 4.3 + 1.2) * 0.6;
  return s > 1.3 ? (Math.sin(t * 57) > 0.2 ? 0.22 : 0.85) : 0.93;
}

/** Builds the moving cab and every stop's landing (doors, linings, frame, lantern, indicator, call station). */
export function buildElevatorView(plan: ElevatorPlan, mats: WorldMaterials): ElevatorView {
  const {info, gate: G, doorH: dH, cabH: H, frame: F, cop} = plan;
  const M = elevatorMaterials();
  const floor = cabFloorMats(mats);
  const steelBright = shapeMaterial(mats, 'steelBright');
  const root = new THREE.Group(); root.name = 'tower-elevator';
  const cabG = new THREE.Group(); cabG.name = 'tower-cab';
  root.add(cabG);
  const geometries: THREE.BufferGeometry[] = [];
  const own = (g: THREE.BufferGeometry): THREE.BufferGeometry => { geometries.push(g); return g; };
  const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, name: string, level?: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat); m.name = name;
    if (level !== undefined) m.userData.level = level;
    parent.add(m);
    return m;
  };
  const MW = frameMatrix(G), MR = frameMatrix(G, false);
  const toW = (l: number, w: number) => gateWorld(G, -w, l);
  const hw = G.hw, d = G.depth, {lMin, lMax, depth: D} = F;
  const steelPt = cellCentre(CELL_STEEL), blackPt = cellCentre(CELL_BLACK);
  const lit = new Map<string, THREE.Mesh>();

  // ===== the cab (local y: 0 = cab floor) =====
  const P = new Parts({steel: 1, wood: 1.2, mirror: 1, dark: 0.5, ceil: 1, rail: 1, field: 2, border: 2});
  const FL = lMin + SHELL + PANEL, FR = lMax - SHELL - PANEL, FW = D - SHELL - PANEL; // panel face planes (left, right, rear)
  const W0 = CAB_FRONT;                                                              // the front panelling's face
  const KICK = 0.14, LOW0 = 0.152, LOW1 = 0.86, UP0 = 0.874, UP1 = Math.min(2.29, H - 0.31), FRZ = UP1 + REVEAL;
  const PS = PANEL + POST;                                                           // corner post size
  // shell behind the panels: dark, seen only through the reveals
  P.box('dark', lMin, lMin + SHELL, 0, H, 0, D);
  P.box('dark', lMax - SHELL, lMax, 0, H, 0, D);
  P.box('dark', lMin + SHELL, lMax - SHELL, 0, H, D - SHELL, D);
  // corner posts (steel angle in every vertical corner)
  P.box('steel', lMin + SHELL, lMin + SHELL + PS, 0, H, D - SHELL - PS, D - SHELL);
  P.box('steel', lMax - SHELL - PS, lMax - SHELL, 0, H, D - SHELL - PS, D - SHELL);
  P.box('steel', lMin + SHELL, lMin + SHELL + PS, 0, H, W0, W0 + PS);
  P.box('steel', lMax - SHELL - PS, lMax - SHELL, 0, H, W0, W0 + PS);
  // side walls: two bays each — stainless wainscot below the handrail, wood veneer above, a steel frieze under the ceiling
  for (const left of [true, false]) {
    const a = left ? lMin + SHELL : FR, b = left ? FL : lMax - SHELL;
    const wa = W0 + PS + REVEAL, wb = FW - POST - REVEAL, mid = (wa + wb) / 2;
    for (const [w0, w1] of [[wa, mid - REVEAL / 2], [mid + REVEAL / 2, wb]]) {
      P.box('steel', a, b, LOW0, LOW1, w0, w1);
      P.box('wood', a, b, UP0, UP1, w0, w1);
    }
    P.box('steel', left ? a : a - 0.004, left ? b + 0.004 : b, 0, KICK, W0 + PS, FW - POST); // kick plate, 4 mm proud
    P.box('steel', a, b, FRZ, H, W0 + PS, FW - POST);
  }
  // rear wall: three bays — wood flanks, the darkened mirror-glass centre above the rail, stainless below
  {
    const la = FL + POST + REVEAL, lb = FR - POST - REVEAL, cm = (la + lb) / 2, cw = Math.min(1.0, (lb - la) * 0.42);
    const bays: [number, number, 'wood' | 'mirror'][] = [[la, cm - cw / 2 - REVEAL / 2, 'wood'], [cm - cw / 2 + REVEAL / 2, cm + cw / 2 - REVEAL / 2, 'mirror'], [cm + cw / 2 + REVEAL / 2, lb, 'wood']];
    for (const [l0, l1, upper] of bays) {
      P.box('steel', l0, l1, LOW0, LOW1, FW, D - SHELL);
      P.box(upper, l0, l1, UP0, UP1, FW, D - SHELL);
    }
    P.box('steel', FL + POST, FR - POST, 0, KICK, FW - 0.004, D - SHELL);
    P.box('steel', FL + POST, FR - POST, FRZ, H, FW, D - SHELL);
  }
  // front (door) wall inside the cab: returns from the side walls to the jamb returns, the transom, the door header
  P.box('steel', lMin + SHELL, -hw - JAMB, 0, H, 0.035, W0);
  P.box('steel', hw + JAMB, lMax - SHELL, 0, H, 0.035, W0);
  P.box('steel', -hw - JAMB, -hw, 0, dH, -0.004, W0); // jamb returns: the cab door pockets (no see-through slot at the leaves)
  P.box('steel', hw, hw + JAMB, 0, dH, -0.004, W0);
  P.box('steel', -hw - JAMB, hw + JAMB, dH, dH + 0.06, -0.045, W0); // door hanger / track housing over the opening
  P.box('steel', -hw - JAMB, hw + JAMB, dH + 0.06, H, 0.035, W0);
  // floor: terrazzo field in a dark border band; a steel sill with the door guide groove at the opening
  const BW = 0.12;
  P.box('border', lMin, lMax, -0.05, 0, 0, BW);
  P.box('border', lMin, lMax, -0.05, 0, D - BW, D);
  P.box('border', lMin, lMin + BW, -0.05, 0, BW, D - BW);
  P.box('border', lMax - BW, lMax, -0.05, 0, BW, D - BW);
  P.box('field', lMin + BW, lMax - BW, -0.05, 0, BW, D - BW);
  const SL = hw + 0.05;
  P.box('steel', -SL, SL, -0.05, 0.003, -0.016, 0.08);
  P.box('steel', -SL, SL, -0.05, 0.003, -0.045, -0.028);
  P.box('dark', -SL, SL, -0.05, -0.006, -0.028, -0.016);
  // suspended ceiling: brushed panel, six round downlights in steel trims (one dead, one tired), a return-air slot
  P.box('ceil', lMin + SHELL, lMax - SHELL, H, H + 0.03, W0, D - SHELL);
  const lmid = (lMin + lMax) / 2, dl = Math.min(0.72, (lMax - lMin) / 2 - 0.35);
  let k = 0;
  for (const w of [W0 + (D - W0) * 0.3, W0 + (D - W0) * 0.72]) {
    for (const l of [lmid - dl, lmid, lmid + dl]) {
      P.ceilingDisc(k === 1 ? 'flicker' : k === 5 ? 'dark' : 'light', l, H - 0.002, w, 0, 0.046);
      P.ceilingDisc('steel', l, H - 0.0025, w, 0.046, 0.064);
      k++;
    }
  }
  {
    const g = new THREE.PlaneGeometry(Math.min(1.0, (lMax - lMin) * 0.4), 0.07);
    g.rotateX(Math.PI / 2); g.translate(lmid, H - 0.002, D - 0.2);
    P.add('dark', g);
  }
  // handrail: a round bar on standoffs with rosettes, returned to the wall at both ends (side walls + rear)
  {
    const RY = 0.9, RO = 0.055, RR = 0.019, SR = 0.009;
    const run = (a: V3, b: V3, wallOff: V3, stands: number): void => {
      P.rod('rail', a, b, RR);
      for (const e of [a, b]) {
        const wpt: V3 = [e[0] + wallOff[0], e[1], e[2] + wallOff[2]];
        P.rod('rail', e, wpt, RR);
        P.ball('rail', e, RR);
        P.rod('rail', wpt, [wpt[0] - wallOff[0] * 0.1, wpt[1], wpt[2] - wallOff[2] * 0.1], 0.026, false, 16);
      }
      for (let i = 1; i <= stands; i++) {
        const f = i / (stands + 1), p: V3 = [a[0] + (b[0] - a[0]) * f, RY, a[2] + (b[2] - a[2]) * f];
        const wpt: V3 = [p[0] + wallOff[0], RY, p[2] + wallOff[2]];
        P.rod('rail', p, wpt, SR);
        P.rod('rail', wpt, [wpt[0] - wallOff[0] * 0.1, RY, wpt[2] - wallOff[2] * 0.1], 0.022, false, 16);
      }
    };
    run([FL + RO, RY, W0 + 0.32], [FL + RO, RY, FW - 0.24], [-RO, 0, 0], 1);
    run([FR - RO, RY, W0 + 0.32], [FR - RO, RY, FW - 0.24], [RO, 0, 0], 1);
    run([FL + 0.24, RY, FW - RO], [FR - 0.24, RY, FW - RO], [0, 0, RO], 2);
  }
  // the car operating panel: a shadow-gap outline, the brushed plate, its indicator, capacity plate, buttons, braille, key switch
  const btnParts = new Parts();
  const indParts = new Parts();
  const PF = W0 + PLATE_T;
  P.box('dark', cop.l - cop.halfW - 0.004, cop.l + cop.halfW + 0.004, cop.y0 - 0.004, cop.y1 + 0.004, W0, W0 + 0.002);
  P.box('steel', cop.l - cop.halfW, cop.l + cop.halfW, cop.y0, cop.y1, W0, PF);
  P.box('dark', cop.l - 0.07, cop.l + 0.07, cop.screenY - 0.042, cop.screenY + 0.042, PF, PF + 0.003);
  indParts.add('ind', quadGeometry(0.12, 0.065, {u0: 0, v0: 0, u1: 1, v1: 1}).translate(cop.l, cop.screenY, PF + 0.004));
  btnParts.add('face', quadGeometry(0.16, 0.04, cellUV(CELL_CAPACITY, 4)).translate(cop.l, cop.labelY, PF + 0.001));
  for (const b of plan.carButtons) {
    const {l, y} = b.local;
    btnParts.add('face', capGeometry(b.r, CAR_BTN_D, cellUV(glyphCell(b.glyph)), steelPt).translate(l, y, PF));
    const dots = BRAILLE[b.glyph];
    if (dots) for (const dot of dots) {
      const col = dot > 3 ? 1 : 0, row = (dot - 1) % 3;
      const bl = l - 0.034 + col * 0.0042, by = y + 0.0042 - row * 0.0042;
      P.box('steel', bl - 0.0012, bl + 0.0012, by - 0.0012, by + 0.0012, PF, PF + 0.0016);
    }
    const ov = mesh(cabG, own(capGeometry(b.r * 0.985, 0, cellUV(glyphCell(b.glyph, true)), steelPt).translate(l, y, PF + CAR_BTN_D + 0.001).applyMatrix4(MW)), M.lit,
      b.kind === 'floor' ? `tower-floor-button-lit-${b.floor}` : `tower-button-lit-${b.kind}`);
    ov.visible = false;
    lit.set(b.id, ov);
  }
  btnParts.add('face', capGeometry(0.016, 0.008, cellUV(glyphCell('key')), steelPt).translate(cop.key[0], cop.key[1], PF));
  // the floor indicator over the door (on the transom)
  P.box('dark', -0.18, 0.18, dH + 0.08, dH + 0.25, W0, W0 + 0.004);
  indParts.add('ind', quadGeometry(0.32, 0.14, {u0: 0, v0: 0, u1: 1, v1: 1}).translate(0, dH + 0.165, W0 + 0.005));
  const cabMat: Record<string, THREE.Material> = {
    steel: M.cabSteel, wood: M.cabWood, mirror: M.cabMirror, dark: M.cabDark, ceil: M.cabCeil, rail: M.cabRail, field: floor.field, border: floor.border,
    light: M.light, flicker: M.lightFlicker,
  };
  const cabNames: Record<string, string> = {
    steel: 'tower-cab-walls', wood: 'tower-cab-wood', mirror: 'tower-cab-mirror', dark: 'tower-cab-dark', ceil: 'tower-cab-ceiling', rail: 'tower-cab-handrail',
    field: 'tower-cab-floor', border: 'tower-cab-floor-border', light: 'tower-cab-light', flicker: 'tower-cab-light-flicker',
  };
  for (const key of Object.keys(cabMat)) { const g = P.take(key, MW); if (g) mesh(cabG, own(g), cabMat[key], cabNames[key]); }
  mesh(cabG, own(indParts.take('ind', MW)!), M.indicator, 'tower-indicator-in');
  mesh(cabG, own(btnParts.take('face', MW)!), M.face, 'tower-floor-panel-buttons');
  // cab doors (just outside the cab plane): each leaf covers half the opening + overlap, slides along the tangent into its pocket
  const leafW = hw + 0.02;
  const leafGeo = own(boxAt(0, (0.006 + dH - 0.004) / 2, 0, leafW / 2, (dH - 0.01) / 2, 0.018).applyMatrix4(MR));
  type Leaf = {m: THREE.Mesh; w: number; sign: number};
  const leaf = (parent: THREE.Object3D, w: number, sign: number, mat: THREE.Material, name: string, level?: number): Leaf => ({m: mesh(parent, leafGeo, mat, name, level), w, sign});
  const place = (lf: Leaf, open: number) => {
    const o = Math.max(0, Math.min(1, open));
    // open: the leaf's edge just inside its pocket (3 mm behind the jamb face: never coplanar with the linings / jamb returns)
    const [x, z] = toW(lf.sign * (leafW / 2 + o * (hw + 0.003)), lf.w);
    lf.m.position.set(x, lf.m.position.y, z);
  };
  const cabLeaves = [leaf(cabG, -0.022, -1, M.cabSteel, 'tower-door-cab-l'), leaf(cabG, -0.022, 1, M.cabSteel, 'tower-door-cab-r')];
  for (const lf of cabLeaves) place(lf, 0);
  // hover rings (one in the cab for its panel, one for the landing stations)
  const ringGeo = own(new THREE.RingGeometry(1.08, 1.3, 28)); // x the button radius: clear of the neighbouring caps
  const hoverCar = mesh(cabG, ringGeo, M.hover, 'tower-button-hover-car');
  const hoverHall = mesh(root, ringGeo, M.hover, 'tower-button-hover-hall');
  hoverCar.visible = hoverHall.visible = false;

  // ===== landings (local y: 0 = the stop floor; w < -depth: the corridor), shared geometry =====
  const FWD = 0.1, FH = 0.12, FD = 0.03, BD = 0.008;               // architrave face width, head height, depth, bead
  const LY0 = dH + FH + 0.05, LY1 = LY0 + 0.14, LHW = 0.34;         // hall lantern / indicator fixture
  const staticGeo = new Map<string, THREE.BufferGeometry>();
  const buttonsGeo = new Map<string, THREE.BufferGeometry>();
  const overlayGeo = new Map<string, THREE.BufferGeometry>();
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);           // +Z-facing pieces -> facing the corridor (-w)
  const corridor = (g: THREE.BufferGeometry, l: number, y: number, w: number) => g.applyMatrix4(flip).translate(l, y, w);
  const landingStatic = (cl: number, cy: number): THREE.BufferGeometry => {
    const key = `${cl.toFixed(3)}|${cy.toFixed(3)}`;
    let g = staticGeo.get(key);
    if (g) return g;
    const S = new Parts();
    // linings through the shaft wall (jambs, head) and the landing sill (cab side + corridor nosing; the guide groove is black in
    // the button mesh). They stop short of the cab plane: the cab's own jamb returns / header / sill meet them at its stop.
    S.box('s', -hw - 0.02, -hw, 0, dH, -d, -0.006);
    S.box('s', hw, hw + 0.02, 0, dH, -d, -0.006);
    S.box('s', -hw - 0.02, hw + 0.02, dH, dH + 0.02, -d, -0.05);
    const SLL = hw + 0.03;
    S.box('s', -SLL, SLL, -0.03, 0.004, -d - 0.05, -d + 0.016);
    S.box('s', -SLL, SLL, -0.03, 0.004, -d + 0.028, -0.055);
    // stainless portal: jambs + head proud of the wall, a stepped inner bead
    S.box('s', -hw - FWD, -hw, 0, dH, -d - FD, -d);
    S.box('s', hw, hw + FWD, 0, dH, -d - FD, -d);
    S.box('s', -hw - FWD, hw + FWD, dH, dH + FH, -d - FD, -d);
    S.box('s', -hw - 0.025, -hw, 0, dH, -d - FD - BD, -d - FD);
    S.box('s', hw, hw + 0.025, 0, dH, -d - FD - BD, -d - FD);
    S.box('s', -hw - 0.025, hw + 0.025, dH, dH + 0.025, -d - FD - BD, -d - FD);
    // hall lantern housing, call station plate, fire notice backing
    S.box('s', -LHW, LHW, LY0, LY1, -d - 0.024, -d);
    S.box('s', cl - 0.06, cl + 0.06, cy - 0.15, cy + 0.15, -d - HALL_PLATE_T, -d);
    S.box('s', cl - 0.066, cl + 0.066, cy - 0.3, cy - 0.21, -d - 0.003, -d);
    g = own(S.take('s', MW)!);
    staticGeo.set(key, g);
    return g;
  };
  const landingButtons = (cl: number, cy: number, list: readonly LiftButton[]): THREE.BufferGeometry => {
    const key = `${cl.toFixed(3)}|${cy.toFixed(3)}|${list.map(b => `${b.kind}${b.local.y.toFixed(3)}`).join(',')}`;
    let g = buttonsGeo.get(key);
    if (g) return g;
    const B = new Parts();
    for (const b of list) B.add('b', corridor(capGeometry(b.r, HALL_BTN_D, cellUV(glyphCell(b.glyph)), steelPt), b.local.l, b.local.y, -d - HALL_PLATE_T));
    B.add('b', corridor(quadGeometry(0.075, 0.095, cellUV(glyphCell('lantern-up'))), 0.24, (LY0 + LY1) / 2, -d - 0.025));
    B.add('b', corridor(quadGeometry(0.075, 0.095, cellUV(glyphCell('lantern-down'))), -0.24, (LY0 + LY1) / 2, -d - 0.025));
    B.add('b', corridor(quadGeometry(0.12, 0.07, cellUV(CELL_FIRE, 4)), cl, cy - 0.255, -d - 0.004));
    const SLL = hw + 0.03;
    B.add('b', flatUV(boxAt(0, -0.019, -d + 0.022, SLL, 0.011, 0.006), blackPt));
    g = own(B.take('b', MW)!);
    buttonsGeo.set(key, g);
    return g;
  };
  const overlay = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => {
    let g = overlayGeo.get(key);
    if (!g) { g = own(make().applyMatrix4(MW)); overlayGeo.set(key, g); }
    return g;
  };
  const indOutGeo = own(corridor(quadGeometry(0.16, 0.075, {u0: 0, v0: 0, u1: 1, v1: 1}), 0, (LY0 + LY1) / 2, -d - 0.025).applyMatrix4(MW));
  const landings: THREE.Group[] = [];
  const landingLeaves: Leaf[][] = [];
  const hallLamps: {up?: THREE.Mesh; down?: THREE.Mesh; lUp: THREE.Mesh; lDown: THREE.Mesh}[] = [];
  info.stops.forEach((st, i) => {
    const g = new THREE.Group();
    g.name = `tower-landing-${st.floor}`;
    g.position.y = st.y;
    g.userData.level = st.levelId;
    const lvl = st.levelId, call = plan.calls[i], cl = call.l, cy = call.at.y - st.y, list = plan.hallButtons[i];
    mesh(g, landingStatic(cl, cy), steelBright, 'tower-landing-frame', lvl);
    mesh(g, landingButtons(cl, cy, list), M.face, 'tower-landing-buttons', lvl);
    mesh(g, indOutGeo, M.indicator, 'tower-indicator-out', lvl);
    const ls = [leaf(g, -(d - 0.022), -1, M.door, 'tower-door-landing-l', lvl), leaf(g, -(d - 0.022), 1, M.door, 'tower-door-landing-r', lvl)];
    for (const lf of ls) place(lf, 0);
    landingLeaves.push(ls);
    const lamps: (typeof hallLamps)[number] = {
      lUp: mesh(g, overlay('lantern-up', () => corridor(quadGeometry(0.075, 0.095, cellUV(glyphCell('lantern-up', true))), 0.24, (LY0 + LY1) / 2, -d - 0.026)), M.lit, 'tower-lantern-lit-up', lvl),
      lDown: mesh(g, overlay('lantern-down', () => corridor(quadGeometry(0.075, 0.095, cellUV(glyphCell('lantern-down', true))), -0.24, (LY0 + LY1) / 2, -d - 0.026)), M.lit, 'tower-lantern-lit-down', lvl),
    };
    lit.set(`lantern-${floorLabel(st.floor)}-up`, lamps.lUp);
    lit.set(`lantern-${floorLabel(st.floor)}-down`, lamps.lDown);
    for (const b of list) {
      const geo = overlay(`${b.kind}|${b.local.l.toFixed(3)}|${b.local.y.toFixed(3)}`,
        () => corridor(capGeometry(b.r * 0.985, 0, cellUV(glyphCell(b.glyph, true)), steelPt), b.local.l, b.local.y, -d - HALL_PLATE_T - HALL_BTN_D - 0.001));
      const m = mesh(g, geo, M.lit, `tower-call-button-lit-${b.kind}`, lvl);
      if (b.kind === 'up') lamps.up = m; else lamps.down = m;
      lit.set(b.id, m);
    }
    for (const m of [lamps.lUp, lamps.lDown, lamps.up, lamps.down]) if (m) m.visible = false;
    hallLamps.push(lamps);
    root.add(g);
    landings.push(g);
  });
  const carLamps = plan.carButtons.map(b => ({b, m: lit.get(b.id)!}));
  let hoverId = '';
  const ind = getIndicator();
  return {
    root, cab: cabG, landings, geometries, lit,
    setCab: (y, door) => { cabG.position.y = y; for (const lf of cabLeaves) place(lf, door); },
    setLanding: (i, door) => { const ls = landingLeaves[i]; if (ls) for (const lf of ls) place(lf, door); },
    setIndicator: (text, dir) => ind.draw(text, dir),
    setLamps: s => {
      for (const {b, m} of carLamps) m.visible = b.kind === 'floor' ? s.car.has(b.stop) : b.kind === 'open' ? s.open : b.kind === 'close' ? s.close : s.alarm;
      for (let i = 0; i < hallLamps.length; i++) {
        const h = hallLamps[i];
        if (h.up) h.up.visible = s.hallUp.has(i);
        if (h.down) h.down.visible = s.hallDown.has(i);
        h.lUp.visible = s.lanternStop === i && s.lanternDir > 0;
        h.lDown.visible = s.lanternStop === i && s.lanternDir < 0;
      }
    },
    setHover: b => {
      const id = b?.id ?? '';
      if (id === hoverId) return;
      hoverId = id;
      hoverCar.visible = hoverHall.visible = false;
      if (!b) return;
      const m = b.where === 'car' ? hoverCar : hoverHall;
      m.position.set(b.at.x + b.n[0] * 0.0015, b.at.y, b.at.z + b.n[1] * 0.0015);
      m.rotation.set(0, Math.atan2(b.n[0], b.n[1]), 0);
      m.scale.setScalar(b.r);
      m.visible = true;
    },
    tick: t => {
      const f = flickerLevel(t);
      M.lightFlicker.color.setRGB(0.95 * f, 0.91 * f, 0.82 * f);
      const p = 0.78 + 0.22 * Math.sin(t * 7);
      M.hover.color.setRGB(0.85 * p, 0.95 * p, p);
    },
  };
}

/** Exposed for tests: the singleton indicator's texture and last drawn key. */
export function indicatorState(): {texture: THREE.Texture; last: string} { const i = getIndicator(); return {texture: i.texture, last: i.last}; }

/** Indicator text for a floor. */
export const indicatorText = floorLabel;
