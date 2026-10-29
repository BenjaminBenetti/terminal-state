// Task office-seamless-20261029 (lane LIFT): the office tower elevator — ONE cab that physically travels the shaft through
// every storey of the continuous Office Space world (no section travel, no loading, no fades).
//
//  - ElevatorLogic (pure): a continuous cab position y with a trapezoidal velocity profile (eases in / out at CAB_ACCEL up
//    to CAB_SPEED and stops EXACTLY at stop.y), a call queue (landing calls from every storey + cab panel selections) served
//    in collective (SCAN) order — keep going while requests lie ahead, then turn round; a stop requested on the way that the
//    cab can still brake for is taken. Door state machine per stop: the cab door and that landing's doors open together
//    ONLY when the cab is level at the stop and stopped; the cab moves ONLY with the doors fully closed; a body in the
//    doorway re-opens closing doors and holds a departure; a living enemy inside holds the doors open (enemies never ride);
//    doors close by themselves after a dwell.
//  - planElevator: the doorway gate (cab edge -> shaft outer face), panel mounts and E boxes from the v2 contract.
//  - buildElevatorView: the cab (walls, floor, ceiling with an emissive light panel, handrail, cab doors, inside indicator,
//    floor panel with lit buttons) in ONE group that moves with y, and per stop a landing group (landing doors, jamb
//    linings / head / threshold through the shaft wall, steel architrave, outside indicator, call panel with a lit button)
//    tagged with its storey (`userData.level`) for culling. Landing pieces share geometry and material instances. No lights:
//    emissive + the baked field only. The cab uses face-UV (not world-mapped) materials so nothing swims while it moves.

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
  phase: ElevatorPhase = 'idle';
  /** Index of the stop the cab is level at (null while moving). */
  stop: number | null;
  /** Index of the stop it is travelling to (null when idle). */
  target: number | null = null;
  /** Door opening 0 (closed) … 1 (open) — the cab door and the current stop's landing doors move together. */
  door = 0;
  /** -1 closing, 0 still, +1 opening. */
  motion: -1 | 0 | 1 = 0;
  /** Requested stops (indices): landing calls + cab selections; the lit buttons. */
  readonly requests = new Set<number>();
  readonly hall = new Set<number>();
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

  /** Landing door opening of stop i (only the stop the cab stands at can open). */
  landingDoor(i: number): number { return this.phase === 'idle' && this.stop === i ? this.door : 0; }

  /** Stop nearest the cab (indicator / reported storey). */
  get nearest(): number {
    let best = 0, bd = Infinity;
    this.stops.forEach((s, i) => { const d = Math.abs(s.y - this.y); if (d < bd) { bd = d; best = i; } });
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
    ev.push({type: 'closing'});
  }

  /** Landing call button on `floor`: the cab comes; at that floor already it opens (re-opens closing doors, holds open ones). */
  call(floor: number): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    const k = this.indexOf(floor);
    if (k < 0) return ev;
    if (this.phase === 'idle' && this.stop === k) {
      if (this.motion === -1) { this.motion = 1; this.minHold = REOPEN_HOLD; ev.push({type: 'opening'}); }
      else if (this.door >= 1) this.openT = 0;
      else if (this.motion === 0) { ev.push({type: 'chime', floor}); this.open(ev); }
      return ev;
    }
    if (!this.requests.has(k)) ev.push({type: 'called', floor});
    this.requests.add(k); this.hall.add(k);
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

  /** "Open doors" (cab panel): only while standing at a stop. */
  requestOpen(): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    if (this.phase !== 'idle') return ev;
    if (this.motion === -1) { this.motion = 1; this.minHold = REOPEN_HOLD; ev.push({type: 'opening'}); }
    else this.open(ev);
    this.openT = 0;
    this.hurry = false;
    return ev;
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
    this.requests.delete(k); this.hall.delete(k); this.car.delete(k);
    this.arrivals++;
    this.openT = 0; this.minHold = 0; this.hurry = false; this.sealedT = 0;
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
      this.requests.delete(here); this.hall.delete(here); this.car.delete(here);
      if (this.motion !== 1 && this.door < 1) { if (this.motion === -1) { this.motion = 1; ev.push({type: 'opening'}); } else this.open(ev); }
      this.openT = 0;
    }
    const next = this.choose(this.y, here);
    if (this.door >= 1 && this.motion === 0) {
      const dwell = Math.max(next !== null ? (this.hurry ? HURRY : DWELL_BUSY) : DWELL, this.minHold);
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
          ev.push({type: 'depart', from, to: this.stops[next].floor, dir: this.dir >= 0 ? 1 : -1});
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

export interface CallMount { at: P3; n: [number, number]; box: Box3Like; eye: P3 }

export interface ElevatorPlan {
  info: ElevatorInfo;
  /** Doorway: cab plane s = 0, landing plane s = depth (the shaft wall). */
  gate: DoorGate;
  /** Doorway clear height and cab interior height above the cab floor (m). */
  doorH: number;
  cabH: number;
  /** The doorway through the shaft wall (world x / z). */
  passage: Rect2;
  /** Inside floor panel: mount (y RELATIVE to the cab floor), room-facing normal, E box (relative), sight target (relative). */
  panelLocal: P3;
  panelN: [number, number];
  panelBox: Box3Like;
  panelEye: P3;
  /** Per stop: the landing call panel (absolute). */
  calls: CallMount[];
}

/** Plans the doorway gate, the panel mounts and the E boxes from the v2 contract. */
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
  // inside panel: on the door wall's inner panelling beside the opening
  const lp = clampBeside((info.panel.x - cx) * tx + (info.panel.z - cz) * tz, hw, sideLen / 2 - Math.abs((nx !== 0 ? (cab.z0 + cab.z1) / 2 - cz : (cab.x0 + cab.x1) / 2 - cx)), 0.22);
  const [px, pz] = gateWorld(gate, -CAB_FRONT, lp);
  const panelN: [number, number] = [-nx || 0, -nz || 0];
  const panelLocal: P3 = {x: px, y: info.panel.dy, z: pz};
  const panelBox = wallBox(panelLocal, panelN, 0.34, 0.62, 0.12);
  const panelEye: P3 = {x: px + panelN[0] * 0.12, y: info.panel.dy, z: pz + panelN[1] * 0.12};
  // landing call panels: flat on the corridor face of the shaft wall beside the doorway
  const calls = info.stops.map(st => {
    const l = clampBeside((st.callPanel.x - cx) * tx + (st.callPanel.z - cz) * tz, hw, Infinity, 0.3);
    const [x, z] = gateWorld(gate, depth, l);
    const at: P3 = {x, y: st.callPanel.y, z};
    const n: [number, number] = [nx, nz];
    return {at, n, box: wallBox(at, n, 0.26, 0.4, 0.12), eye: {x: x + nx * 0.12, y: at.y, z: z + nz * 0.12}};
  });
  return {info, gate, doorH, cabH, passage, panelLocal, panelN, panelBox, panelEye, calls};
}

/** Keep a wall mount beside the opening (|l| >= hw + margin) and within `max` of the side centre. */
function clampBeside(l: number, hw: number, max: number, margin: number): number {
  let v = l;
  if (Math.abs(v) < hw + margin) v = (v < 0 ? -1 : 1) * (hw + margin);
  if (Number.isFinite(max) && Math.abs(v) > max - 0.12) v = Math.sign(v) * Math.max(hw + 0.12, max - 0.12);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Materials (module singletons: shared by every stop / world, never disposed)

/** Live floor indicator: one canvas texture for every indicator of the elevator (inside + every landing). */
class Indicator {
  readonly canvas: HTMLCanvasElement | null;
  readonly texture: THREE.Texture;
  readonly material: MeshBasicNodeMaterial;
  last = '';
  constructor() {
    this.canvas = typeof document !== 'undefined' && typeof document.createElement === 'function' ? document.createElement('canvas') : null;
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
    ctx.fillStyle = '#120806'; ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ff8a2a';
    ctx.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 78, 34);
    if (dir) {
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(26, 14); ctx.lineTo(42, 34); ctx.lineTo(10, 34); }
      else { ctx.moveTo(26, 52); ctx.lineTo(42, 32); ctx.lineTo(10, 32); }
      ctx.closePath(); ctx.fill();
    }
    this.texture.needsUpdate = true;
  }
}
let indicator: Indicator | null = null;
const getIndicator = (): Indicator => (indicator ??= new Indicator());

const basicMats = new Map<string, MeshBasicNodeMaterial>();
function basicMat(name: string, rgb: [number, number, number]): MeshBasicNodeMaterial {
  let m = basicMats.get(name);
  if (!m) { m = new MeshBasicNodeMaterial({color: new THREE.Color(...rgb)}); m.name = name; basicMats.set(name, m); }
  return m;
}

const faceMats = new Map<string, SurfaceNodeMaterial>();
/**
 * A face-UV surface material (geometry UVs in metres / span: the texture moves WITH the cab, never swims) with an optional
 * warm self-glow (emissive x the albedo map) — the cab's own ceiling panel lights it; no scene light is added.
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

/** The cab / door materials (QA / tests: names). */
export function elevatorMaterials() {
  return {
    cabWall: faceMat('tower-cab-wall', 'brushedSteel', {metalness: 0.45, glow: 0.2}),
    cabTrim: faceMat('tower-cab-trim', 'paintedSteel', {metalness: 0.3, glow: 0.12}),
    cabFloor: faceMat('tower-cab-floor', 'black', {glow: 0.1}),
    cabCeil: faceMat('tower-cab-ceiling', 'paintedPanel', {color: 0xb9b4aa, glow: 0.24}),
    cabRail: faceMat('tower-cab-rail', 'brushedSteel', {metalness: 0.6, color: 0xf4f4f4, glow: 0.2}),
    door: faceMat('tower-door-steel', 'brushedSteel', {metalness: 0.5}),
    light: basicMat('tower-cab-light', [0.92, 0.88, 0.78]),
    button: basicMat('tower-button', [0.3, 0.17, 0.06]),
    lit: basicMat('tower-button-lit', [1.0, 0.62, 0.2]),
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

/** Axis box from gate-local coordinates: s range, l range, y range. */
function gateBox(G: DoorGate, s0: number, s1: number, l0: number, l1: number, y0: number, y1: number, span = 1): THREE.BufferGeometry {
  const sc = (s0 + s1) / 2, lc = (l0 + l1) / 2;
  const [x, z] = gateWorld(G, sc, lc);
  const hs = Math.abs(s1 - s0) / 2, hl = Math.abs(l1 - l0) / 2;
  const alongX = Math.abs(G.nx) > 0.5; // normal along x: s maps to x, l to z
  return boxAt(x, (y0 + y1) / 2, z, alongX ? hs : hl, Math.abs(y1 - y0) / 2, alongX ? hl : hs, span);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const m = mergeGeometries(parts, false) ?? parts[0];
  for (const p of parts) if (p !== m) p.dispose();
  return m;
}

// ---------------------------------------------------------------------------------------------
// three.js view

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
  /** Lit buttons: landing calls / cab selections (stop indices). */
  setLit(hall: ReadonlySet<number>, car: ReadonlySet<number>): void;
  /** Geometries owned by this view (disposed with the world; materials are shared singletons). */
  geometries: THREE.BufferGeometry[];
}

/** Builds the moving cab and every stop's landing (doors, linings, frame, indicator, call panel). */
export function buildElevatorView(plan: ElevatorPlan, mats: WorldMaterials): ElevatorView {
  const {info, gate: G, doorH, cabH} = plan;
  const M = elevatorMaterials();
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
  const {cab} = info;
  const T = CAB_WALL;
  const cx0 = cab.x0, cx1 = cab.x1, cz0 = cab.z0, cz1 = cab.z1;
  // ===== the cab (local y: 0 = cab floor) =====
  const walls: THREE.BufferGeometry[] = [], kicks: THREE.BufferGeometry[] = [];
  const ym = cabH / 2, hy = cabH / 2;
  const sides: ['N' | 'S' | 'E' | 'W', number, number, number, number][] = [
    ['N', (cx0 + cx1) / 2, cz0 + T / 2, (cx1 - cx0) / 2, T / 2], ['S', (cx0 + cx1) / 2, cz1 - T / 2, (cx1 - cx0) / 2, T / 2],
    ['W', cx0 + T / 2, (cz0 + cz1) / 2, T / 2, (cz1 - cz0) / 2], ['E', cx1 - T / 2, (cz0 + cz1) / 2, T / 2, (cz1 - cz0) / 2],
  ];
  for (const [side, x, z, hx, hz] of sides) {
    if (side === info.doorSide) continue;
    walls.push(boxAt(x, ym, z, hx, hy, hz));
    const [snx, snz] = sideNormal(side);
    kicks.push(boxAt(x - snx * 0.004, 0.09, z - snz * 0.004, hx, 0.09, hz));
  }
  // front (door) wall inside the cab: pieces from the corners to the opening + the header over it
  const sideLen = Math.abs(G.nx) > 0.5 ? cz1 - cz0 : cx1 - cx0;
  const lc = Math.abs(G.nx) > 0.5 ? (G.cz - (cz0 + cz1) / 2) * G.tz : (G.cx - (cx0 + cx1) / 2) * G.tx;
  const lMin = -sideLen / 2 - lc, lMax = sideLen / 2 - lc;
  const f0 = -CAB_FRONT, f1 = -CAB_FRONT + T;
  if (lMin < -G.hw - 0.01) walls.push(gateBox(G, f0, f1, lMin, -G.hw, 0, cabH));
  if (lMax > G.hw + 0.01) walls.push(gateBox(G, f0, f1, G.hw, lMax, 0, cabH));
  walls.push(gateBox(G, f0, f1, -G.hw, G.hw, doorH, cabH));
  // returns: the front panelling meets the cab doors (no see-through slot at the panelling's edge)
  walls.push(gateBox(G, f0, 0.004, -G.hw - 0.04, -G.hw, 0, doorH), gateBox(G, f0, 0.004, G.hw, G.hw + 0.04, 0, doorH));
  mesh(cabG, own(merged(walls)), M.cabWall, 'tower-cab-walls');
  mesh(cabG, own(merged(kicks)), M.cabTrim, 'tower-cab-kick');
  mesh(cabG, own(boxAt((cx0 + cx1) / 2, -0.04, (cz0 + cz1) / 2, (cx1 - cx0) / 2, 0.04, (cz1 - cz0) / 2)), M.cabFloor, 'tower-cab-floor');
  mesh(cabG, own(boxAt((cx0 + cx1) / 2, cabH + 0.03, (cz0 + cz1) / 2, (cx1 - cx0) / 2, 0.03, (cz1 - cz0) / 2)), M.cabCeil, 'tower-cab-ceiling');
  const lightW = Math.min(cx1 - cx0, cz1 - cz0) * 0.32;
  mesh(cabG, own(boxAt((cx0 + cx1) / 2, cabH - 0.004, (cz0 + cz1) / 2, lightW, 0.004, lightW * 0.7)), M.light, 'tower-cab-light');
  const rails: THREE.BufferGeometry[] = [];
  const ry = 0.9, inset = T + 0.06, rr = 0.018;
  for (const [side] of sides) {
    if (side === info.doorSide) continue;
    const [snx, snz] = sideNormal(side);
    if (snx !== 0) rails.push(boxAt(snx > 0 ? cx1 - inset : cx0 + inset, ry, (cz0 + cz1) / 2, rr, rr, (cz1 - cz0) / 2 - 0.2));
    else rails.push(boxAt((cx0 + cx1) / 2, ry, snz > 0 ? cz1 - inset : cz0 + inset, (cx1 - cx0) / 2 - 0.2, rr, rr));
  }
  mesh(cabG, own(merged(rails)), M.cabRail, 'tower-cab-handrail');
  // inside indicator over the door
  mesh(cabG, own(gateBox(G, f0 - 0.012, f0 - 0.002, -0.16, 0.16, doorH + 0.06, doorH + 0.2)), M.indicator, 'tower-indicator-in');
  // floor panel: plate + a button per stop (two columns, bottom-up) + lit overlays
  const pn = plan.panelN, pp = plan.panelLocal;
  const alongZ = Math.abs(pn[0]) > 0.5; // panel faces x: its width runs along z
  mesh(cabG, own(boxAt(pp.x + pn[0] * 0.012, pp.y, pp.z + pn[1] * 0.012, alongZ ? 0.012 : 0.13, 0.28, alongZ ? 0.13 : 0.012)), M.cabTrim, 'tower-floor-panel-plate');
  const nStops = info.stops.length, rows = Math.ceil(nStops / 2);
  const buttonAt = (i: number, out: number): P3 => {
    const u = ((i % 2) - 0.5) * 0.09, v = -0.2 + Math.floor(i / 2) * (0.38 / Math.max(1, rows - 1));
    return {x: pp.x + pn[0] * out + (alongZ ? 0 : u), y: pp.y + v, z: pp.z + pn[1] * out + (alongZ ? u : 0)};
  };
  const btn = own(boxAt(0, 0, 0, alongZ ? 0.006 : 0.022, 0.022, alongZ ? 0.022 : 0.006));
  const btnLit = own(boxAt(0, 0, 0, alongZ ? 0.004 : 0.02, 0.02, alongZ ? 0.02 : 0.004));
  const carLit: THREE.Mesh[] = [];
  const unlit: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nStops; i++) {
    const b = buttonAt(i, 0.03);
    unlit.push(btn.clone().translate(b.x, b.y, b.z));
    const l = buttonAt(i, 0.037);
    const m = mesh(cabG, btnLit, M.lit, `tower-floor-button-lit-${info.stops[i].floor}`);
    m.position.set(l.x, l.y, l.z);
    m.visible = false;
    carLit.push(m);
  }
  mesh(cabG, own(merged(unlit)), M.button, 'tower-floor-panel-buttons');
  // cab doors (just outside the cab plane): each leaf covers half the opening + overlap, slides along the tangent
  const leafW = G.hw + 0.02;
  const leafGeo = own(gateBox(G, -0.018, 0.018, -leafW / 2, leafW / 2, 0.004, doorH - 0.004).translate(-G.cx, 0, -G.cz));
  const leaf = (parent: THREE.Object3D, s: number, sign: number, mat: THREE.Material, name: string, level?: number): {m: THREE.Mesh; s: number; sign: number} => {
    const m = mesh(parent, leafGeo, mat, name, level);
    return {m, s, sign};
  };
  const place = (lf: {m: THREE.Mesh; s: number; sign: number}, open: number) => {
    const o = Math.max(0, Math.min(1, open));
    const l = lf.sign * (leafW / 2 + o * (G.hw - 0.02));
    const [x, z] = gateWorld(G, lf.s, l);
    lf.m.position.set(x, lf.m.position.y, z);
  };
  const cabLeaves = [leaf(cabG, 0.022, -1, M.cabWall, 'tower-door-cab-l'), leaf(cabG, 0.022, 1, M.cabWall, 'tower-door-cab-r')];
  for (const lf of cabLeaves) place(lf, 0);
  // ===== landings (local y: 0 = the stop floor), shared geometry =====
  const fr: THREE.BufferGeometry[] = [];
  const fw = 0.09, fd = 0.025, d = G.depth;
  fr.push(gateBox(G, d, d + fd, -G.hw - fw, -G.hw, 0, doorH + fw), gateBox(G, d, d + fd, G.hw, G.hw + fw, 0, doorH + fw), gateBox(G, d, d + fd, -G.hw - fw, G.hw + fw, doorH, doorH + fw));
  const frameGeo = own(merged(fr));
  // jamb linings / head / threshold through the shaft wall (the doorway cells stay solid in the grid: GEN cuts the face)
  const lin: THREE.BufferGeometry[] = [
    gateBox(G, 0, d, -G.hw - 0.02, -G.hw, 0, doorH), gateBox(G, 0, d, G.hw, G.hw + 0.02, 0, doorH),
    gateBox(G, 0, d, -G.hw - 0.02, G.hw + 0.02, doorH, doorH + 0.02), gateBox(G, 0, d, -G.hw, G.hw, -0.03, 0.006),
  ];
  const liningGeo = own(merged(lin));
  const indOutGeo = own(gateBox(G, d + fd, d + fd + 0.01, -0.16, 0.16, doorH + fw + 0.06, doorH + fw + 0.2));
  const frameMat = shapeMaterial(mats, 'shopFrame'), liningMat = shapeMaterial(mats, 'steelDark');
  const callPlate = new Map<string, {plate: THREE.BufferGeometry; btn: THREE.BufferGeometry; lit: THREE.BufferGeometry}>();
  const landings: THREE.Group[] = [];
  const landingLeaves: {m: THREE.Mesh; s: number; sign: number}[][] = [];
  const hallLit: THREE.Mesh[] = [];
  info.stops.forEach((st, i) => {
    const g = new THREE.Group();
    g.name = `tower-landing-${st.floor}`;
    g.position.y = st.y;
    g.userData.level = st.levelId;
    const lvl = st.levelId;
    mesh(g, frameGeo, frameMat, 'tower-landing-frame', lvl);
    mesh(g, liningGeo, liningMat, 'tower-landing-lining', lvl);
    mesh(g, indOutGeo, M.indicator, 'tower-indicator-out', lvl);
    const ls = [leaf(g, d - 0.022, -1, M.door, 'tower-door-landing-l', lvl), leaf(g, d - 0.022, 1, M.door, 'tower-door-landing-r', lvl)];
    for (const lf of ls) place(lf, 0);
    landingLeaves.push(ls);
    // call panel (its own mount per stop; geometry shared between stops at the same x / z)
    const c = plan.calls[i], n = c.n, ax = Math.abs(n[0]) > 0.5;
    const key = `${c.at.x.toFixed(3)},${c.at.z.toFixed(3)},${(c.at.y - st.y).toFixed(3)}`;
    let cp = callPlate.get(key);
    if (!cp) {
      const y = c.at.y - st.y;
      cp = {
        plate: own(boxAt(c.at.x + n[0] * 0.012, y, c.at.z + n[1] * 0.012, ax ? 0.012 : 0.07, 0.13, ax ? 0.07 : 0.012)),
        btn: own(boxAt(c.at.x + n[0] * 0.03, y, c.at.z + n[1] * 0.03, ax ? 0.006 : 0.026, 0.026, ax ? 0.026 : 0.006)),
        lit: own(boxAt(c.at.x + n[0] * 0.037, y, c.at.z + n[1] * 0.037, ax ? 0.004 : 0.024, 0.024, ax ? 0.024 : 0.004)),
      };
      callPlate.set(key, cp);
    }
    mesh(g, cp.plate, M.cabTrim, 'tower-call-panel-plate', lvl);
    mesh(g, cp.btn, M.button, 'tower-call-panel-button', lvl);
    const lit = mesh(g, cp.lit, M.lit, 'tower-call-panel-lit', lvl);
    lit.visible = false;
    hallLit.push(lit);
    root.add(g);
    landings.push(g);
  });
  const ind = getIndicator();
  return {
    root, cab: cabG, landings, geometries,
    setCab: (y, door) => { cabG.position.y = y; for (const lf of cabLeaves) place(lf, door); },
    setLanding: (i, door) => { const ls = landingLeaves[i]; if (ls) for (const lf of ls) place(lf, door); },
    setIndicator: (text, dir) => ind.draw(text, dir),
    setLit: (hall, car) => {
      hallLit.forEach((m, i) => { m.visible = hall.has(i); });
      carLit.forEach((m, i) => { m.visible = car.has(i); });
    },
  };
}

/** Exposed for tests: the singleton indicator's texture and last drawn key. */
export function indicatorState(): {texture: THREE.Texture; last: string} { const i = getIndicator(); return {texture: i.texture, last: i.last}; }

/** Indicator text for a floor. */
export const indicatorText = floorLabel;
