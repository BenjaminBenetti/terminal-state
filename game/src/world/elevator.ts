// Iteration 16 (lane TOWER): the office tower elevator — a pure door / ride state machine (ElevatorLogic), the cab
// geometry plan derived from layout.office.elevator + the storey grid (planElevator), and the three.js cab (walls,
// floor, ceiling light panel, handrail, floor indicators, sliding cab AND landing doors, call panel, floor panel).
//
// Ride (user: "an elevator in there that you can take to different floors"): choose a floor inside -> the doors close
// (a body in the doorway re-opens them; an enemy inside holds them open: enemies never ride) -> a short departure hum
// -> ONE `ride` event -> the runtime calls game.travel(...) (lane RUN rebuilds + warms the next floor behind the
// closed doors) -> the cab is rebuilt there with its doors CLOSED around the player (`arrive()`) -> chime -> open.
// Each floor is its own section, so there is no shaft to fall into: the cab floor is the storey floor (walkable grid
// cells) and the shaft walls are the solid cells around it; the doors are the only opening and they collide while
// not open (world/towerShared.ts constrainGate, side memory = no tunnelling at sprint speed).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {CELL, type Grid} from '../gen/grid';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {shapeMaterial} from './shapeMaterials';
import type {WorldMaterials} from './materials';
import {floorLabel, insideRect, sideNormal, solidAt, wallBox, wallNormalAt, type Box3Like, type DoorGate, type ElevatorInfo, type P3} from './towerShared';

// ---------------------------------------------------------------------------------------------
// State machine

/** Full door stroke (s). */
export const DOOR_TIME = 1.35;
/** Doors stay open this long before closing by themselves (empty cab). */
export const HOLD_OPEN = 6;
/** After an obstruction re-open, wait this long before trying to close again. */
export const REOPEN_HOLD = 1.6;
/** Doors closed with the passenger inside -> ride request after this (departure hum). */
export const DEPART_DELAY = 0.9;
/** Arrival: closed doors, chime after ARRIVE_CHIME, doors start opening at ARRIVE_OPEN. */
export const ARRIVE_CHIME = 0.35;
export const ARRIVE_OPEN = 0.8;
/** Call button outside: the cab "arrives" (chime) and opens after this. */
export const CALL_DELAY = 1.1;

export interface ElevatorSense {
  /** The player stands inside the cab (behind the cab door plane, on the cab's storey). */
  occupant: boolean;
  /** Some living body (player or enemy) overlaps the doorway band. */
  doorway: boolean;
  /** A living enemy is inside the cab (enemies never ride: the doors will not close on it). */
  enemyInside: boolean;
}

export type ElevatorEvent =
  | {type: 'opening'} | {type: 'opened'} | {type: 'closing'} | {type: 'closed'}
  | {type: 'reopen'; why: 'doorway' | 'enemy'}
  | {type: 'chime'}
  | {type: 'depart'; floor: number}
  | {type: 'ride'; floor: number}
  | {type: 'cancelled'; why: 'empty' | 'opened' | 'failed'};

export type ElevatorPhase = 'idle' | 'called' | 'arriving' | 'departing' | 'riding';
export type DoorState = 'closed' | 'opening' | 'open' | 'closing';

export class ElevatorLogic {
  /** Door opening 0 (closed) … 1 (open). */
  door = 0;
  /** -1 closing, 0 still, +1 opening. */
  motion: -1 | 0 | 1 = 0;
  phase: ElevatorPhase = 'idle';
  phaseT = 0;
  /** Requested floor (null = none). */
  target: number | null = null;
  /** Ride requests issued (exactly one per departure). */
  rides = 0;
  private openT = 0;
  private minHold = 0;

  constructor(readonly floor: number, readonly floors: readonly number[], opts: {open?: boolean} = {}) {
    if (opts.open) this.door = 1;
  }

  get state(): DoorState {
    return this.motion > 0 ? 'opening' : this.motion < 0 ? 'closing' : this.door >= 1 ? 'open' : this.door <= 0 ? 'closed' : 'opening';
  }

  /** Doors fully closed and still (collision is total; the only state a ride starts from). */
  get sealed(): boolean { return this.door <= 0 && this.motion === 0; }

  /** Busy riding / about to ride (input ignored except "open" while departing). */
  get busy(): boolean { return this.phase === 'riding'; }

  private open(ev: ElevatorEvent[]): void {
    if (this.motion === 1 || (this.door >= 1 && this.motion === 0)) return;
    this.motion = 1;
    ev.push({type: 'opening'});
  }

  private close(ev: ElevatorEvent[]): void {
    if (this.motion === -1 || this.door <= 0) return;
    this.motion = -1;
    this.minHold = 0;
    ev.push({type: 'closing'});
  }

  /** Call button (outside): the cab comes (chime) and opens; re-opens closing doors; holds open doors. */
  call(): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    if (this.phase === 'riding' || this.phase === 'departing' || this.phase === 'arriving') return ev;
    if (this.motion === -1) { this.open(ev); return ev; }
    if (this.door > 0) { this.openT = 0; return ev; }
    if (this.phase !== 'called') { this.phase = 'called'; this.phaseT = 0; }
    return ev;
  }

  /** "Open doors" (inside panel, or pushing against the closed doors from inside): cancels a departure. */
  requestOpen(): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    if (this.phase === 'riding') return ev;
    if (this.phase === 'departing') { this.phase = 'idle'; this.target = null; ev.push({type: 'cancelled', why: 'opened'}); }
    if (this.phase === 'called' || this.phase === 'arriving') this.phase = 'idle';
    this.target = null;
    this.open(ev);
    this.openT = 0;
    return ev;
  }

  /** Floor button (inside). The current floor opens the doors. */
  select(floor: number): {ok: boolean; reason?: 'busy' | 'invalid'; events: ElevatorEvent[]} {
    if (this.phase === 'riding') return {ok: false, reason: 'busy', events: []};
    if (!this.floors.includes(floor)) return {ok: false, reason: 'invalid', events: []};
    if (floor === this.floor) return {ok: true, events: this.requestOpen()};
    this.target = floor;
    const ev: ElevatorEvent[] = [];
    if (this.phase === 'called' || this.phase === 'arriving') this.phase = 'idle';
    if (this.door > 0 && this.motion !== -1) this.close(ev);
    return {ok: true, events: ev};
  }

  /** The cab was (re)built around an arriving passenger: doors closed, chime, then open. */
  arrive(): void {
    this.door = 0; this.motion = 0; this.target = null;
    this.phase = 'arriving'; this.phaseT = 0;
  }

  /** The travel request was refused (busy / dead / not ready): back to idle, doors open. */
  rideFailed(): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [{type: 'cancelled', why: 'failed'}];
    this.phase = 'idle'; this.target = null;
    this.open(ev);
    return ev;
  }

  update(dt: number, sense: ElevatorSense): ElevatorEvent[] {
    const ev: ElevatorEvent[] = [];
    this.phaseT += dt;
    // --- doors ---
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
        if (this.door <= 0) { this.motion = 0; ev.push({type: 'closed'}); }
      }
    }
    if (this.door >= 1 && this.motion === 0) this.openT += dt;
    // --- phases ---
    switch (this.phase) {
      case 'called':
        if (this.phaseT >= CALL_DELAY) { ev.push({type: 'chime'}); this.phase = 'idle'; this.open(ev); }
        break;
      case 'arriving':
        if (this.phaseT >= ARRIVE_CHIME && this.phaseT - dt < ARRIVE_CHIME) ev.push({type: 'chime'});
        if (this.phaseT >= ARRIVE_OPEN) { this.phase = 'idle'; this.open(ev); }
        break;
      case 'idle':
        if (this.target !== null) {
          if (this.sealed) {
            if (sense.occupant && !sense.enemyInside) { this.phase = 'departing'; this.phaseT = 0; ev.push({type: 'depart', floor: this.target}); }
            else { this.target = null; ev.push({type: 'cancelled', why: 'empty'}); }
          } else if (this.motion === 0 && this.door >= 1 && this.openT >= this.minHold && !sense.doorway && !sense.enemyInside) this.close(ev);
          else if (this.motion === 1 && !sense.doorway && !sense.enemyInside && this.minHold === 0) this.close(ev);
        } else if (this.motion === 0 && this.door >= 1 && !sense.occupant && !sense.doorway && this.openT >= Math.max(HOLD_OPEN, this.minHold)) this.close(ev);
        break;
      case 'departing':
        if (!this.sealed) { this.phase = 'idle'; this.target = null; ev.push({type: 'cancelled', why: 'opened'}); break; }
        if (this.phaseT >= DEPART_DELAY) {
          if (sense.occupant && !sense.enemyInside && this.target !== null) {
            this.phase = 'riding'; this.rides++;
            ev.push({type: 'ride', floor: this.target});
          } else { this.phase = 'idle'; this.target = null; ev.push({type: 'cancelled', why: 'empty'}); }
        }
        break;
      case 'riding':
        break;
    }
    return ev;
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry plan (pure)

export interface ElevatorPlan {
  info: ElevatorInfo;
  gate: DoorGate;
  /** Cab interior height (visual ceiling, absolute y) and the door opening height (absolute y). */
  ceilY: number;
  doorTop: number;
  /** Room-facing normals of the inside panel and the call panel. */
  panelN: [number, number];
  callN: [number, number];
  /** Interaction boxes (E): inside floor panel, outside call panel. */
  /** Where the panels actually mount: on the cab's own wall panelling (inside) / the corridor wall face (outside). */
  panelAt: P3;
  callAt: P3;
  panelBox: Box3Like;
  callBox: Box3Like;
  /** Points just in front of the panels (line-of-sight targets). */
  panelEye: P3;
  callEye: P3;
}

/** Plans the cab / doors / panels from the contract fields and the storey grid. */
export function planElevator(info: ElevatorInfo, g: Grid): ElevatorPlan {
  const {cab, door, floorY} = info;
  const [nx, nz] = sideNormal(info.doorSide);
  const tx = -nz, tz = nx;
  // snap the door centre onto the cab edge; keep it inside the cab side
  const cx = nx > 0 ? cab.x1 : nx < 0 ? cab.x0 : Math.max(cab.x0 + 0.3, Math.min(cab.x1 - 0.3, door.x));
  const cz = nz > 0 ? cab.z1 : nz < 0 ? cab.z0 : Math.max(cab.z0 + 0.3, Math.min(cab.z1 - 0.3, door.z));
  const sideLen = Math.abs(nx) > 0 ? cab.z1 - cab.z0 : cab.x1 - cab.x0;
  const hw = Math.max(0.35, Math.min(door.width / 2, sideLen / 2 - 0.08));
  // wall thickness: solid jamb cells beside the opening, stepping outward from the cab edge
  let depth = 0;
  for (let k = 0; k < 6; k++) {
    const s = (k + 0.5) * CELL;
    const a = solidAt(g, cx + nx * s + tx * (hw + 0.2), cz + nz * s + tz * (hw + 0.2));
    const b = solidAt(g, cx + nx * s - tx * (hw + 0.2), cz + nz * s - tz * (hw + 0.2));
    if (!a && !b) break;
    depth = (k + 1) * CELL;
  }
  if (depth <= 0) depth = 0.16; // no wall drawn around the opening: the landing doors sit just outside the cab doors
  // heights: the cab ceiling (visual) under the storey ceiling; the opening's lintel
  const ci = g.idx(Math.floor((cab.x0 + cab.x1) / 2 / CELL), Math.floor((cab.z0 + cab.z1) / 2 / CELL));
  const gridCeil = g.hasCeil(ci) && g.ceil[ci] > floorY + 2 ? g.ceil[ci] : floorY + 2.8;
  // the cab's own ceiling sits just under the storey ceiling (WORLD-GEN hangs the cab's light fixture there)
  const ceilY = Math.min(gridCeil - 0.045, floorY + 2.9);
  const di = g.idx(Math.floor((cx + nx * depth * 0.5) / CELL), Math.floor((cz + nz * depth * 0.5) / CELL));
  const lintel = g.inBounds(Math.floor((cx + nx * depth * 0.5) / CELL), Math.floor((cz + nz * depth * 0.5) / CELL)) && g.hasCeil(di) && g.ceil[di] > floorY + 1.9 ? g.ceil[di] : floorY + 2.2;
  // the doors fill the opening up to its lintel (no slot above them)
  const doorTop = Math.min(lintel - 0.005, ceilY - 0.1, floorY + 2.45);
  // inside panel: on a cab wall (normal toward the cab interior)
  let panelN = wallNormalAt(g, info.panel.x, info.panel.z);
  if (!panelN || !insideRect(cab, info.panel.x + panelN[0] * 0.3, info.panel.z + panelN[1] * 0.3, -0.05)) {
    // nearest cab edge
    const d = [info.panel.x - cab.x0, cab.x1 - info.panel.x, info.panel.z - cab.z0, cab.z1 - info.panel.z];
    const m = Math.min(...d), i = d.indexOf(m);
    panelN = i === 0 ? [1, 0] : i === 1 ? [-1, 0] : i === 2 ? [0, 1] : [0, -1];
  }
  // call panel: on the landing-side wall face (normal away from the shaft, i.e. along the door normal by default)
  let callN = wallNormalAt(g, info.callPanel.x, info.callPanel.z) ?? [nx, nz];
  if (insideRect(cab, info.callPanel.x + callN[0] * 0.3, info.callPanel.z + callN[1] * 0.3)) callN = [nx, nz];
  // mounting surfaces: the cab's front panelling sits CAB_FRONT inside the cab plane, its other walls CAB_WALL inside the
  // shaft faces; the call panel goes flat on the corridor face of the shaft wall
  const onDoorWall = panelN[0] === -nx && panelN[1] === -nz;
  const panelAt = onFace(g, info.panel, panelN, onDoorWall ? CAB_FRONT : CAB_WALL);
  const callAt = onFace(g, info.callPanel, callN, 0);
  const panelBox = wallBox(panelAt, panelN, 0.34, 0.62, 0.12);
  const callBox = wallBox(callAt, callN, 0.26, 0.36, 0.12);
  return {
    info, gate: {cx, cz, nx, nz, tx, tz, hw, depth}, ceilY, doorTop, panelN, callN, panelAt, callAt, panelBox, callBox,
    panelEye: {x: panelAt.x + panelN[0] * 0.12, y: panelAt.y, z: panelAt.z + panelN[1] * 0.12},
    callEye: {x: callAt.x + callN[0] * 0.12, y: callAt.y, z: callAt.z + callN[1] * 0.12},
  };
}

/** Cab panelling depth (m): the front (door) wall panels end CAB_FRONT inside the cab plane, the others CAB_WALL. */
export const CAB_FRONT = 0.065;
export const CAB_WALL = 0.03;

/** The wall face behind a wall-mounted point (snapped to the solid cell's boundary along -n), plus `off` along n. */
export function onFace(g: Grid, p: P3, n: [number, number], off: number): P3 {
  for (let k = 0; k <= 30; k++) {
    const x = p.x - n[0] * k * 0.02, z = p.z - n[1] * k * 0.02;
    if (!solidAt(g, x, z)) continue;
    let fx = p.x, fz = p.z;
    if (n[0] > 0) fx = (Math.floor(x / CELL) + 1) * CELL; else if (n[0] < 0) fx = Math.floor(x / CELL) * CELL;
    if (n[1] > 0) fz = (Math.floor(z / CELL) + 1) * CELL; else if (n[1] < 0) fz = Math.floor(z / CELL) * CELL;
    return {x: fx + n[0] * off, y: p.y, z: fz + n[1] * off};
  }
  return {x: p.x + n[0] * off, y: p.y, z: p.z + n[1] * off};
}

// ---------------------------------------------------------------------------------------------
// three.js cab

/** Live floor indicator (one per running elevator; module singleton reused across floors — no per-floor programs). */
class Indicator {
  readonly canvas: HTMLCanvasElement | null;
  readonly texture: THREE.Texture;
  readonly material: MeshBasicNodeMaterial;
  private last = '';
  constructor() {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
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
    if (key === this.last || !this.canvas) return;
    this.last = key;
    const ctx = this.canvas.getContext('2d');
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

let lightPanelMat: MeshBasicNodeMaterial | null = null;
/** Cab ceiling light diffuser (emissive look; the baked field lights the cab from the WORLD-GEN fixture). */
function cabLightMaterial(): MeshBasicNodeMaterial {
  if (!lightPanelMat) { lightPanelMat = new MeshBasicNodeMaterial({color: new THREE.Color(0.92, 0.88, 0.78)}); lightPanelMat.name = 'tower-cab-light'; }
  return lightPanelMat;
}
let buttonMat: MeshBasicNodeMaterial | null = null;
function buttonMaterial(): MeshBasicNodeMaterial {
  if (!buttonMat) { buttonMat = new MeshBasicNodeMaterial({color: new THREE.Color(0.95, 0.55, 0.16)}); buttonMat.name = 'tower-button'; }
  return buttonMat;
}

export interface ElevatorView {
  root: THREE.Group;
  /** Static meshes (cab shell, frames, panels): shadow casters. */
  shell: THREE.Group;
  /** The four door leaves (cab pair + landing pair). */
  doors: THREE.Group;
  setDoor(open: number): void;
  setIndicator(floor: number, dir: number): void;
  /** Per-section geometries (disposed at teardown; materials are shared). */
  geometries: THREE.BufferGeometry[];
}

/** Box geometry centred at (x, y, z) with half sizes, in world coordinates (merged per material). */
function boxAt(x: number, y: number, z: number, hx: number, hy: number, hz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  g.translate(x, y, z);
  return g;
}

/** Axis box from gate-local coordinates: s range, l range, y range. */
function gateBox(G: DoorGate, s0: number, s1: number, l0: number, l1: number, y0: number, y1: number): THREE.BufferGeometry {
  const sc = (s0 + s1) / 2, lc = (l0 + l1) / 2;
  const x = G.cx + G.nx * sc + G.tx * lc, z = G.cz + G.nz * sc + G.tz * lc;
  const hs = Math.abs(s1 - s0) / 2, hl = Math.abs(l1 - l0) / 2;
  const alongX = Math.abs(G.nx) > 0.5; // normal along x: s maps to x, l to z
  return boxAt(x, (y0 + y1) / 2, z, alongX ? hs : hl, Math.abs(y1 - y0) / 2, alongX ? hl : hs);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false) ?? parts[0];
  for (const p of parts) if (p !== m) p.dispose();
  return m;
}

/** Builds the cab, doors, frames, indicators and panels for a plan (materials: shared station shape materials). */
export function buildElevatorView(plan: ElevatorPlan, mats: WorldMaterials, floor: number, floors: readonly number[], opts: {fixture?: boolean; builderFrame?: boolean} = {}): ElevatorView {
  const {info, gate: G, ceilY, doorTop} = plan;
  const {cab, floorY} = info;
  const root = new THREE.Group(); root.name = 'tower-elevator';
  const shell = new THREE.Group(); shell.name = 'tower-elevator-shell';
  const doors = new THREE.Group(); doors.name = 'tower-elevator-doors';
  root.add(shell, doors);
  const geometries: THREE.BufferGeometry[] = [];
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat); m.name = name; geometries.push(geo); parent.add(m); return m;
  };
  const steel = shapeMaterial(mats, 'steelBright'), dark = shapeMaterial(mats, 'steelDark'), frame = shapeMaterial(mats, 'shopFrame');
  const floorMat = shapeMaterial(mats, 'black'), rail = shapeMaterial(mats, 'kitchenSteel'), panel = shapeMaterial(mats, 'panel');
  const T = CAB_WALL; // wall panel thickness
  const wallH0 = floorY + 0.002, wallH1 = ceilY;
  // --- cab shell: back + side walls (inset into the cab), front wall pieces beside the opening, header ---
  const walls: THREE.BufferGeometry[] = [], kicks: THREE.BufferGeometry[] = [];
  const cx0 = cab.x0, cx1 = cab.x1, cz0 = cab.z0, cz1 = cab.z1;
  const ym = (wallH0 + wallH1) / 2, hy = (wallH1 - wallH0) / 2;
  const sides: ['N' | 'S' | 'E' | 'W', number, number, number, number][] = [
    ['N', (cx0 + cx1) / 2, cz0 + T / 2, (cx1 - cx0) / 2, T / 2], ['S', (cx0 + cx1) / 2, cz1 - T / 2, (cx1 - cx0) / 2, T / 2],
    ['W', cx0 + T / 2, (cz0 + cz1) / 2, T / 2, (cz1 - cz0) / 2], ['E', cx1 - T / 2, (cz0 + cz1) / 2, T / 2, (cz1 - cz0) / 2],
  ];
  for (const [side, x, z, hx, hz] of sides) {
    if (side === info.doorSide) continue;
    walls.push(boxAt(x, ym, z, hx, hy, hz));
    const [snx, snz] = sideNormal(side); // outward: the kick plate sits 4 mm toward the cab interior
    kicks.push(boxAt(x - snx * 0.004, floorY + 0.09, z - snz * 0.004, hx, 0.09, hz));
  }
  // front wall (door side), inside the cab: pieces from the cab corners to the opening, and the header over it
  const sideLen = Math.abs(G.nx) > 0.5 ? cz1 - cz0 : cx1 - cx0;
  const lc = Math.abs(G.nx) > 0.5 ? (G.cz - (cz0 + cz1) / 2) * G.tz : (G.cx - (cx0 + cx1) / 2) * G.tx; // opening centre along l, relative to the side centre
  const lMin = -sideLen / 2 - lc, lMax = sideLen / 2 - lc;
  // (5 mm inside the cab plane: the station builder's door frame reaches 3 cm into the cab, its faces stay behind these)
  const f0 = -CAB_FRONT, f1 = -CAB_FRONT + T;
  if (lMin < -G.hw - 0.01) walls.push(gateBox(G, f0, f1, lMin, -G.hw, wallH0, wallH1));
  if (lMax > G.hw + 0.01) walls.push(gateBox(G, f0, f1, G.hw, lMax, wallH0, wallH1));
  walls.push(gateBox(G, f0, f1, -G.hw, G.hw, doorTop, wallH1));
  add(shell, merged(walls), steel, 'tower-cab-walls');
  add(shell, merged(kicks), dark, 'tower-cab-kick');
  // floor (rubber, slightly proud of the storey floor) and ceiling with a light diffuser
  add(shell, boxAt((cx0 + cx1) / 2, floorY + 0.006, (cz0 + cz1) / 2, (cx1 - cx0) / 2 - 0.005, 0.006, (cz1 - cz0) / 2 - 0.005), floorMat, 'tower-cab-floor');
  add(shell, boxAt((cx0 + cx1) / 2, ceilY + 0.02, (cz0 + cz1) / 2, (cx1 - cx0) / 2, 0.02, (cz1 - cz0) / 2), panel, 'tower-cab-ceiling');
  // a light diffuser only where no station fixture hangs in the cab (WORLD-GEN places one: its baked light + model)
  if (!opts.fixture) {
    const lightW = Math.min(cx1 - cx0, cz1 - cz0) * 0.32;
    add(root, boxAt((cx0 + cx1) / 2, ceilY - 0.004, (cz0 + cz1) / 2, lightW, 0.004, lightW * 0.7), cabLightMaterial(), 'tower-cab-light');
  }
  // handrail: back and side walls at 0.9 m
  const rails: THREE.BufferGeometry[] = [];
  const ry = floorY + 0.9, inset = T + 0.06, rr = 0.018;
  for (const [side] of sides) {
    if (side === info.doorSide) continue;
    const [snx, snz] = sideNormal(side);
    if (snx !== 0) rails.push(boxAt(snx > 0 ? cx1 - inset : cx0 + inset, ry, (cz0 + cz1) / 2, rr, rr, (cz1 - cz0) / 2 - 0.2));
    else rails.push(boxAt((cx0 + cx1) / 2, ry, snz > 0 ? cz1 - inset : cz0 + inset, (cx1 - cx0) / 2 - 0.2, rr, rr));
  }
  add(shell, merged(rails), rail, 'tower-cab-handrail');
  // landing frame (architrave) on the corridor face, and the jamb linings through the wall
  const fr: THREE.BufferGeometry[] = [];
  const fw = 0.09, fd = 0.025;
  fr.push(gateBox(G, G.depth, G.depth + fd, -G.hw - fw, -G.hw, floorY, doorTop + fw));
  fr.push(gateBox(G, G.depth, G.depth + fd, G.hw, G.hw + fw, floorY, doorTop + fw));
  fr.push(gateBox(G, G.depth, G.depth + fd, -G.hw - fw, G.hw + fw, doorTop, doorTop + fw));
  // jamb linings through the wall, unless the opening is a station Door record (the builder frames those: steel jambs + head)
  if (G.depth > 0.1 && !opts.builderFrame) {
    fr.push(gateBox(G, 0, G.depth, -G.hw - 0.01, -G.hw + 0.005, floorY, doorTop));
    fr.push(gateBox(G, 0, G.depth, G.hw - 0.005, G.hw + 0.01, floorY, doorTop));
    fr.push(gateBox(G, 0, G.depth, -G.hw, G.hw, doorTop - 0.005, doorTop + 0.01));
    fr.push(gateBox(G, 0, G.depth, -G.hw, G.hw, floorY, floorY + 0.012)); // threshold
  }
  add(shell, merged(fr), frame, 'tower-landing-frame');
  // indicators: inside over the door, outside over the landing frame (one live texture)
  const ind = getIndicator();
  ind.draw(floorLabel(floor), 0);
  add(root, gateBox(G, f0 - 0.012, f0 - 0.002, -0.16, 0.16, doorTop + 0.06, doorTop + 0.2), ind.material, 'tower-indicator-in');
  add(root, gateBox(G, G.depth + fd, G.depth + fd + 0.01, -0.16, 0.16, doorTop + fw + 0.06, doorTop + fw + 0.2), ind.material, 'tower-indicator-out');
  // floor panel (inside) and call panel (outside): plates + lit buttons
  const plate = (p: P3, n: [number, number], w: number, h: number, name: string, buttons: [number, number][]): void => {
    const bx = Math.abs(n[0]) > 0.5 ? 0.012 : w / 2, bz = Math.abs(n[0]) > 0.5 ? w / 2 : 0.012;
    add(shell, boxAt(p.x + n[0] * 0.012, p.y, p.z + n[1] * 0.012, bx, h / 2, bz), dark, `${name}-plate`);
    const bs: THREE.BufferGeometry[] = [];
    for (const [u, v] of buttons) {
      const x = p.x + n[0] * 0.026 + (Math.abs(n[0]) > 0.5 ? 0 : u), z = p.z + n[1] * 0.026 + (Math.abs(n[0]) > 0.5 ? u : 0);
      bs.push(boxAt(x, p.y + v, z, Math.abs(n[0]) > 0.5 ? 0.006 : 0.02, 0.02, Math.abs(n[0]) > 0.5 ? 0.02 : 0.006));
    }
    if (bs.length) add(root, merged(bs), buttonMaterial(), `${name}-buttons`);
  };
  const rows = Math.ceil(floors.length / 2);
  const grid: [number, number][] = floors.map((_, i) => [((i % 2) - 0.5) * 0.08, -0.2 + Math.floor(i / 2) * (0.38 / Math.max(1, rows - 1 || 1))]);
  plate(plan.panelAt, plan.panelN, 0.26, 0.56, 'tower-floor-panel', grid);
  plate(plan.callAt, plan.callN, 0.14, 0.26, 'tower-call-panel', [[0, 0.05], [0, -0.05]]);
  // doors: cab pair (just outside the cab plane) and landing pair (just inside the landing plane); each leaf covers
  // half the opening + overlap and slides into the wall
  const doorMeshes: {mesh: THREE.Mesh; sign: number}[] = [];
  const leaf = (s0: number, s1: number, sign: number, name: string) => {
    const geo = gateBox(G, s0, s1, 0, G.hw + 0.02, floorY + 0.004, doorTop - 0.004);
    // re-centre the leaf on its own origin so it can slide along the tangent
    const c = new THREE.Vector3(G.cx + G.nx * (s0 + s1) / 2, 0, G.cz + G.nz * (s0 + s1) / 2);
    geo.translate(-c.x - G.tx * (G.hw + 0.02) / 2, 0, -c.z - G.tz * (G.hw + 0.02) / 2);
    const m = add(doors, geo, steel, name);
    m.position.copy(c);
    m.userData.sign = sign;
    doorMeshes.push({mesh: m, sign});
  };
  const cabS0 = 0.004, cabS1 = 0.04, landS1 = G.depth - 0.004, landS0 = Math.max(cabS1 + 0.01, G.depth - 0.04);
  leaf(cabS0, cabS1, -1, 'tower-door-cab-l'); leaf(cabS0, cabS1, 1, 'tower-door-cab-r');
  leaf(landS0, landS1, -1, 'tower-door-landing-l'); leaf(landS0, landS1, 1, 'tower-door-landing-r');
  const base = new Map(doorMeshes.map(d => [d.mesh, d.mesh.position.clone()]));
  const setDoor = (open: number) => {
    const o = Math.max(0, Math.min(1, open));
    for (const {mesh, sign} of doorMeshes) {
      // closed: leaf centre at sign * (hw + 0.02) / 2 (meeting in the middle); open: slid by ~ its width into the wall
      const l = sign * ((G.hw + 0.02) / 2 + o * (G.hw - 0.02));
      const b = base.get(mesh)!;
      mesh.position.set(b.x + G.tx * l, b.y, b.z + G.tz * l);
      mesh.visible = true;
    }
  };
  setDoor(0);
  return {
    root, shell, doors, geometries, setDoor,
    setIndicator: (f: number, dir: number) => ind.draw(floorLabel(f), dir),
  };
}

/** Exposed for tests: the singleton indicator texture's last drawn key. */
export function indicatorState(): {texture: THREE.Texture} { return {texture: getIndicator().texture}; }
