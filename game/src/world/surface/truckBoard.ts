// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE PLANNING MAP ON THE TRUCK'S SIDE — user: "Put the usable
// planning map on the SIDE OF THE TRUCK, physically visible and accessible on foot during exploration. Keep real roads/destinations,
// explored blocks and player/truck markers tied to actual state. It must not remain usable only at the tent table."
//  - THE BOARD: simple handmade geometry bolted to the RIGHT side of the canvas-covered bed (truck frame x ≈ 1.27, over the rear tandem,
//    eye height): a dark backing panel on two steel rails and the map SHEET — the same table-top drawing of the planning map
//    (world/surface/mapDraw.ts drawPlanningCanvas over the map runtime's live model: the district's real streets / destinations, the
//    explored blocks, the YOU and TRUCK markers where they really are) on a runtime canvas texture (dynamic content: the texture rule's
//    exemption; a 1 x 1 data texture without a DOM, so the material is the same either way), redrawn near it (TRUCK_BOARD.nearM) at most
//    every TRUCK_BOARD.redrawS and only when what it shows changed (mapSignature). It moves with the truck (a part of its view).
//  - READ IT: [E] with the crosshair on the board (within TRUCK_BOARD.reach, nothing structural in between) standing on foot beside the
//    truck's right side near it, the truck's storey, not seated, playing, alive — through the vehicle controller's [E] handler and prompt
//    (SkywaysCar.access, after the compartments), so one press does one thing — opens the SAME full-screen planning map as the tent's
//    table (world/surface/mapRuntime.ts SurfaceMapRuntime.open: the game holds in the 'map' state while it is open). The table keeps
//    working; the board makes the map usable wherever the truck is parked.
//  - Classified with the truck's parts (world/surface/truckAudit.ts): not storage (nothing to open), a static part of the vehicle.
// Shared materials / geometry / the sheet's canvas live for the truck model's lifetime (releaseTruckBoard: with the model, at the next build
// of a world without the truck). Inert in every world without the truck.

import * as THREE from 'three';
import type {Levels} from '../../gen/levels';
import {rayBox, type Box3Like} from '../towerShared';
import type {SkywaysCar} from '../skywaysCar';
import {carToWorld, worldToCar} from '../skywaysCarSpec';
import {drawPlanningCanvas, type MapCtx} from './mapDraw';
import {mapSignature, type PlanningMap} from './mapModel';
import {truckCabMaterials} from './truckCab';
import {TRUCK_RT} from './truckSpec';
import type {TruckView} from './truckModel';

/** The board (truck frame, m): measured clear of the right side's canvas bulge (x <= 1.25 at y 1.4 .. 2.3 over z 1.2 .. 2.6). */
export const TRUCK_BOARD = {
  /** The backing panel's outer face (x), its thickness, its extent along the body (z) and up (y). */
  face: 1.288,
  thick: 0.024,
  z0: 1.3,
  z1: 2.4,
  y0: 1.42,
  y1: 2.3,
  /** The square map sheet (m) centred on the panel, just proud of it. */
  sheet: 0.8,
  /** The rails it hangs on (x from the bed side to the panel; z half-width). */
  railX0: 1.19,
  railHalf: 0.022,
  /** Aim reach (eye -> the board, m), the aim box padding (m); standing within `stand` m (horizontal) of its centre, outside the body. */
  reach: 2.6,
  pad: 0.06,
  stand: 2.4,
  inside: 0.15,
  /** The sheet canvas (px), its redraw cadence (s) and the distance it redraws within (m) — the tent table's numbers. */
  px: 1024,
  redrawS: 1.5,
  nearM: 14,
} as const;

export const TRUCK_BOARD_TEXT = {read: '<b>[E]</b> Read the planning map'} as const;

export interface TruckBoardView {
  group: THREE.Group;
  sheet: THREE.Mesh;
}

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

let shared: {canvas: HTMLCanvasElement | null; texture: THREE.Texture; sheet: THREE.MeshStandardMaterial; box: THREE.BufferGeometry; plane: THREE.BufferGeometry; sig: string} | null = null;

function boardShared(): NonNullable<typeof shared> {
  if (shared) return shared;
  const canvas = hasCanvas() ? document.createElement('canvas') : null;
  if (canvas) canvas.width = canvas.height = TRUCK_BOARD.px;
  let texture: THREE.Texture;
  if (canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = 8;
    texture = t;
  } else {
    texture = new THREE.DataTexture(new Uint8Array([232, 223, 198, 255]), 1, 1); // (the sheet's paper colour)
    texture.needsUpdate = true;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = 'surface-truck-map-board';
  const sheet = new THREE.MeshStandardMaterial({map: texture, roughness: 0.9, metalness: 0});
  sheet.name = 'surface-truck-map-board-sheet';
  shared = {canvas, texture, sheet, box: new THREE.BoxGeometry(1, 1, 1), plane: new THREE.PlaneGeometry(1, 1), sig: ''};
  return shared;
}

/** The board's meshes (truck frame; added to the truck's view group: it moves with the body). */
export function buildTruckBoard(): TruckBoardView {
  const B = TRUCK_BOARD, S = boardShared(), M = truckCabMaterials(), g = new THREE.Group();
  g.name = 'surface-truck-map-board';
  const zc = (B.z0 + B.z1) / 2, yc = (B.y0 + B.y1) / 2;
  const part = (m: THREE.Material, name: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(S.box, m);
    b.name = name;
    b.scale.set(w, h, d);
    b.position.set(x, y, z);
    b.userData.carPart = 'paint';
    g.add(b);
    return b;
  };
  part(M.panel, 'surface-truck-map-board-panel', B.thick, B.y1 - B.y0, B.z1 - B.z0, B.face - B.thick / 2, yc, zc);
  for (const z of [B.z0 + B.railHalf, B.z1 - B.railHalf]) part(M.metal, 'surface-truck-map-board-rail', B.face - B.thick - B.railX0, B.y1 - B.y0 + 0.06, B.railHalf * 2, (B.railX0 + B.face - B.thick) / 2, yc, z);
  const sheet = new THREE.Mesh(S.plane, S.sheet);
  sheet.name = 'surface-truck-map-board-sheet';
  sheet.scale.set(B.sheet, B.sheet, 1);
  sheet.rotation.y = Math.PI / 2; // (facing +X, out from the truck's right side; the canvas's right edge toward the nose: not mirrored)
  sheet.position.set(B.face + 0.003, yc, zc);
  sheet.userData.carPart = 'paint';
  sheet.castShadow = false;
  g.add(sheet);
  return {group: g, sheet};
}

/** Draw the planning map on the sheet (only when it changed, unless forced). True: drawn. */
export function drawTruckBoard(m: PlanningMap, force = false): boolean {
  const S = boardShared();
  const sig = mapSignature(m);
  if (!force && sig === S.sig) return false;
  const ctx = S.canvas?.getContext('2d') as unknown as MapCtx | null;
  if (!ctx) return false;
  drawPlanningCanvas(ctx, m, TRUCK_BOARD.px);
  S.texture.needsUpdate = true;
  S.sig = sig;
  return true;
}

/** Drop the shared materials / geometry / sheet (with the truck model: a world without the truck). True: something released. */
export function releaseTruckBoard(): boolean {
  const s = shared;
  if (!s) return false;
  s.sheet.dispose(); s.texture.dispose(); s.box.dispose(); s.plane.dispose();
  shared = null;
  return true;
}

/** What the board needs from Game (structural: tests drive it with the controller's Node host). */
export interface TruckBoardHost {
  player: {x: number; y: number; z: number; alive: boolean; climbing?: boolean};
  camera: THREE.Camera;
  levels: Levels | null;
  state: string;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();

export class TruckBoardSystem {
  /** QA / tests. */
  readonly counts = {opens: 0, refused: 0, draws: 0};
  private redrawT = 0;
  private force = true;
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};

  /**
   * @param model the planning map now (the map runtime's live model; null: no district map here)
   * @param openMap opens the full-screen planning map (the map runtime's open(); false: refused)
   */
  constructor(readonly host: TruckBoardHost, readonly car: SkywaysCar, private readonly model: () => PlanningMap | null, private readonly openMap: () => boolean) {}

  readonly prompt: string = TRUCK_BOARD_TEXT.read;

  install(): this {
    this.car.access.push(this);
    this.host.frameHooks.push(dt => this.frame(dt));
    this.host.sectionHooks.push({build: () => { this.force = true; this.redrawT = 0; }});
    return this;
  }

  /** The board's centre in the world (follows the truck), null without the truck. */
  anchor(): {x: number; y: number; z: number} | null {
    const b = this.car.body, B = TRUCK_BOARD;
    if (!b || this.car.vehicle !== 'truck') return null;
    const p = carToWorld(b.x, b.z, b.yaw, B.face, (B.z0 + B.z1) / 2);
    return {x: p.x, y: b.y + (B.y0 + B.y1) / 2, z: p.z};
  }

  /** On foot beside the truck's right side near the board, the truck's storey. */
  standingBy(): boolean {
    const b = this.car.body, P = this.host.player, B = TRUCK_BOARD, S = this.car.spec;
    if (!b || this.car.vehicle !== 'truck' || Math.abs(P.y - b.y) > TRUCK_RT.storeyY) return false;
    const lp = worldToCar(b.x, b.z, b.yaw, P.x, P.z);
    if (lp.x < S.width / 2 - B.inside) return false;
    return Math.hypot(lp.x - B.face, lp.z - (B.z0 + B.z1) / 2) <= B.stand;
  }

  /** The crosshair's hit on the board within reach with nothing structural in between, else null. */
  aimHit(): {t: number} | null {
    const h = this.host, b = this.car.body, L = h.levels, B = TRUCK_BOARD;
    if (!b || !L) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), co = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: tv2.x * co - tv2.z * s, y: tv2.y, z: tv2.x * s + tv2.z * co};
    const X = this.box;
    X.min.x = B.railX0 - B.pad; X.min.y = B.y0 - B.pad; X.min.z = B.z0 - B.pad;
    X.max.x = B.face + B.pad; X.max.y = B.y1 + B.pad; X.max.z = B.z1 + B.pad;
    const t = rayBox({x: lo.x, y: tv.y - b.y, z: lo.z}, ld, X, B.reach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t};
  }

  /** SkywaysCar.access: the crosshair on the board from beside the truck, on foot, and the map may open now. */
  aimed(): boolean {
    const h = this.host, car = this.car;
    if (car.vehicle !== 'truck' || !car.body || car.driving || h.state !== 'playing' || !h.player.alive || h.player.climbing) return false;
    if (!car.canEnter()) return false; // (not climbing / riding / using an item, no other lane's hands)
    return this.standingBy() && this.aimHit() !== null;
  }

  /** SkywaysCar.access: [E] on the board -> the planning map. */
  interact(): boolean {
    return this.open();
  }

  /** Open the planning map from the board ([E] through the controller; QA). Refused seated / outside play / without the truck or a map. */
  open(): boolean {
    const car = this.car;
    if (car.vehicle !== 'truck' || !car.body || car.driving || this.host.state !== 'playing' || !this.host.player.alive) { this.counts.refused++; return false; }
    if (!this.openMap()) { this.counts.refused++; return false; }
    this.counts.opens++;
    return true;
  }

  /** Per frame: the sheet redrawn near the board when what it shows changed. */
  private frame(dt: number): void {
    const v = this.car.view as TruckView | null;
    if (this.car.vehicle !== 'truck' || !v?.board) return;
    this.redrawT -= dt;
    if (this.redrawT > 0 && !this.force) return;
    this.redrawT = TRUCK_BOARD.redrawS;
    const a = this.anchor(), P = this.host.player;
    if (!a || (!this.force && Math.hypot(P.x - a.x, P.z - a.z) > TRUCK_BOARD.nearM)) return;
    const m = this.model();
    if (!m) return;
    if (drawTruckBoard(m, this.force)) this.counts.draws++;
    this.force = false;
  }

  /** QA: a compact state report. */
  qa() {
    return {anchor: this.anchor(), by: this.standingBy(), aimed: this.aimed(), counts: {...this.counts}};
  }
}
