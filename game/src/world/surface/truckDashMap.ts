// Task studio-surface-map-tent-cab-20261119-025201-01 (lane CAB): THE PLANNING MAP ON THE TRUCK'S PASSENGER-SIDE DASHBOARD — user: "Move
// the truck's existing map INTO THE CAB, on the PASSENGER-SIDE DASHBOARD (not outside on the right). Looking at it and pressing E opens a
// closer readable view; closing returns naturally to the cab/seat and normal controls. Keep its map content/knowledge consistent with the
// tent map. Ensure cab glass/geometry and competing truck interactions do not block the intended prompt or view; no accidental
// exit/repair/action." (It replaces the field follow-up's board on the bed's right side: task
// studio-surface-run-field-followup-20261116-211729-01, lane TRUCK — that panel, its rails and its outer sheet are gone.)
//  - THE SHEET: a square map sheet (TRUCK_DASH_MAP.sheet) in a low wedge HOLDER (the cab's dash material, simple handmade geometry) on the
//    dash top in front of the passenger seat, placed from the cab's own layout and the cook's measured anchors (world/surface/truckCab.ts
//    truckCabLayout: the dash box, the passenger seat's x; TRUCK_ANCHORS: the passenger windscreen pane, the seated eye). The holder lifts
//    the sheet's passenger-side edge (TRUCK_DASH_MAP.lean) so the sheet faces the driver's seated eye; it stays low (the driver's own
//    windscreen pane and the forward view stay clear), behind the passenger pane's inner face, clear of the binnacle, the FOG PRESSURE
//    readout, the centre stack, the gear lever and the steering wheel (tests/surface-truck-dash-map.test.ts). It draws the SAME table-top
//    drawing of the planning map as the tent's table (world/surface/mapDraw.ts drawPlanningCanvas over the map runtime's live model: the
//    district's real streets / destinations, the explored blocks, the YOU and TRUCK markers where they really are) on a runtime canvas
//    texture (dynamic content: the texture rule's exemption; a 1 x 1 data texture without a DOM, so the material is the same either way),
//    redrawn while seated or near the truck (TRUCK_DASH_MAP.nearM) at most every TRUCK_DASH_MAP.redrawS and only when what it shows changed
//    (mapSignature). A cockpit part (userData.carPart 'cockpit', no shadow), a child of the cab group: it moves with the truck.
//  - READ IT: seated in the truck (SkywaysCar.driving), the crosshair on the sheet within TRUCK_DASH_MAP.reach of the seated eye (a ray
//    from the player's view against the sheet's box in the truck frame; the sheet is nearer the eye than any glass and no cab part lies
//    between) -> the controller's seated prompt reads TRUCK_DASH_MAP_TEXT.read instead of the controls line, and [E] opens the SAME
//    full-screen planning map as the tent's table (world/surface/mapRuntime.ts SurfaceMapRuntime.open: the game holds in the 'map' state
//    while it is open; the controller keeps the driver seated through it). An aimed press is the sheet's even when the map refuses: it
//    never gets out, repairs, opens a compartment or touches cargo (SkywaysCar.seated). Not aimed, [E] gets out exactly as before (its
//    speed gate). Allowed at any speed: the 'map' state freezes the world like a pause, and play resumes at the speed it held.
//    Closing (Esc / E / Tab) returns to the seat with the driving controls; the closing E is kept from the game until released.
//  - Classified with the truck's parts (world/surface/truckAudit.ts): not storage (nothing to open), a static part of the vehicle.
// Shared materials / geometry / the sheet's canvas live for the truck model's lifetime (releaseTruckDashMap: with the model, at the next
// build of a world without the truck). Inert in every world without the truck.

import * as THREE from 'three';
import {rayBox, type Box3Like} from '../towerShared';
import type {SkywaysCar} from '../skywaysCar';
import {carToWorld, worldToCar} from '../skywaysCarSpec';
import {drawPlanningCanvas, type MapCtx} from './mapDraw';
import {mapSignature, type PlanningMap} from './mapModel';
import {truckCabLayout, truckCabMaterials} from './truckCab';
import {TRUCK_ANCHORS} from './truckAnchors.generated';
import type {TruckView} from './truckModel';

/** The dash map (truck frame, m / rad). */
export const TRUCK_DASH_MAP = {
  /** The square map sheet (m) and its lean toward the driver (rad: the passenger-side edge raised; the normal leans toward -X). */
  sheet: 0.3,
  lean: (24 * Math.PI) / 180,
  /**
   * The holder: the thickness under the sheet's low (driver-side) edge (m), its gap behind the passenger windscreen pane's inner face (m),
   * the sheet's centre this far inboard (toward the driver) of the passenger seat's centre line (m); the sheet proud of the holder (m).
   */
  lip: 0.012,
  glassGap: 0.015,
  inboard: 0.15,
  proud: 0.002,
  /** Aim: the reach from the seated eye to the sheet (m) and the aim box's padding round the sheet (m). */
  reach: 1.3,
  pad: 0.02,
  /** The sheet canvas (px), its redraw cadence (s) and the distance it redraws within when not seated (m) — the tent table's numbers. */
  px: 1024,
  redrawS: 1.5,
  nearM: 14,
} as const;

export const TRUCK_DASH_MAP_TEXT = {read: '<b>[E]</b> Read the map'} as const;

type V3 = {x: number; y: number; z: number};

export interface TruckDashMapLayout {
  /** The sheet's centre (truck frame) and edge (m). */
  centre: V3;
  size: number;
  /** The sheet's axes: `right` = the canvas's +x (toward the tail), `up` = the canvas's top (up the slope, toward the passenger door), `normal` = its face (toward the driver's side and up). */
  right: V3;
  up: V3;
  normal: V3;
  /** The holder: a wedge across x0..x1 and along z0..z1, its base at y0 on the dash top, its sloped top from yLo (driver side) to yHi. */
  holder: {x0: number; x1: number; z0: number; z1: number; y0: number; yLo: number; yHi: number};
  /** The seated eye (truck frame). */
  eye: V3;
}

/** The sheet and its holder (truck frame; deterministic from the cab layout and the anchors). */
export function truckDashMapLayout(): TruckDashMapLayout {
  const lay = truckCabLayout(), A = TRUCK_ANCHORS, M = TRUCK_DASH_MAP, E = A.eye;
  const dash = lay.boxes.find(b => b.name === 'dash');
  const pane = A.glass.find(g => g.name === 'windscreen-right'); // (the passenger's windscreen pane; its inner face is z1)
  if (!dash || !pane) throw new Error('truck dash map: the cab layout has no dash / the anchors no passenger windscreen pane');
  const c = Math.cos(M.lean), s = Math.sin(M.lean), cx = 2 * lay.cabCx - E.x - M.inboard; // (the passenger seat mirrors the driver's)
  const x0 = cx - (M.sheet / 2) * c, x1 = cx + (M.sheet / 2) * c;
  const z0 = Math.max(dash.z0, pane.z1) + M.glassGap, z1 = z0 + M.sheet;
  const y0 = dash.y1 + 0.001, yLo = y0 + M.lip, yHi = yLo + M.sheet * s;
  const normal = {x: -s, y: c, z: 0};
  return {
    centre: {x: cx + normal.x * M.proud, y: (yLo + yHi) / 2 + normal.y * M.proud, z: (z0 + z1) / 2}, size: M.sheet,
    right: {x: 0, y: 0, z: 1}, up: {x: c, y: s, z: 0}, normal,
    holder: {x0, x1, z0, z1, y0, yLo, yHi}, eye: {x: E.x, y: E.y, z: E.z},
  };
}

export interface TruckDashMapView {
  group: THREE.Group;
  sheet: THREE.Mesh;
  holder: THREE.Mesh;
}

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

let shared: {canvas: HTMLCanvasElement | null; texture: THREE.Texture; sheet: THREE.MeshStandardMaterial; plane: THREE.BufferGeometry; holder: THREE.BufferGeometry; sig: string} | null = null;

/** The holder's wedge: a unit box's corners moved onto the layout (its top sloped; flat faces, the box's own attributes). */
function holderGeometry(L: TruckDashMapLayout): THREE.BufferGeometry {
  const H = L.holder, g = new THREE.BoxGeometry(1, 1, 1), p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const hi = p.getX(i) > 0;
    p.setXYZ(i, hi ? H.x1 : H.x0, p.getY(i) < 0 ? H.y0 : hi ? H.yHi : H.yLo, p.getZ(i) < 0 ? H.z0 : H.z1);
  }
  p.needsUpdate = true;
  g.computeVertexNormals(); // (each face its own four vertices: flat)
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'surface-truck-dash-map-holder';
  return g;
}

function mapShared(): NonNullable<typeof shared> {
  if (shared) return shared;
  const canvas = hasCanvas() ? document.createElement('canvas') : null;
  if (canvas) canvas.width = canvas.height = TRUCK_DASH_MAP.px;
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
  texture.name = 'surface-truck-dash-map';
  const sheet = new THREE.MeshStandardMaterial({map: texture, roughness: 0.9, metalness: 0});
  sheet.name = 'surface-truck-dash-map-sheet';
  shared = {canvas, texture, sheet, plane: new THREE.PlaneGeometry(1, 1), holder: holderGeometry(truckDashMapLayout()), sig: ''};
  return shared;
}

const v3 = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);

/** The holder and the sheet (truck frame; a child of the cab group: it moves with the body). */
export function buildTruckDashMap(): TruckDashMapView {
  const L = truckDashMapLayout(), S = mapShared(), M = truckCabMaterials(), g = new THREE.Group();
  g.name = 'surface-truck-dash-map';
  const holder = new THREE.Mesh(S.holder, M.dash);
  holder.name = 'surface-truck-dash-map-holder';
  const sheet = new THREE.Mesh(S.plane, S.sheet);
  sheet.name = 'surface-truck-dash-map-sheet';
  sheet.scale.set(L.size, L.size, 1);
  // the plane's +X / +Y / +Z -> right / up / normal: the canvas upright to the driver looking across (its top away, not mirrored)
  sheet.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(L.right), v3(L.up), v3(L.normal)));
  sheet.position.set(L.centre.x, L.centre.y, L.centre.z);
  for (const m of [holder, sheet]) { m.userData.carPart = 'cockpit'; m.castShadow = false; g.add(m); }
  return {group: g, sheet, holder};
}

/** Draw the planning map on the sheet (only when it changed, unless forced). True: drawn. */
export function drawTruckDashMap(m: PlanningMap, force = false): boolean {
  const S = mapShared();
  const sig = mapSignature(m);
  if (!force && sig === S.sig) return false;
  const ctx = S.canvas?.getContext('2d') as unknown as MapCtx | null;
  if (!ctx) return false;
  drawPlanningCanvas(ctx, m, TRUCK_DASH_MAP.px);
  S.texture.needsUpdate = true;
  S.sig = sig;
  return true;
}

/** The signature of what the sheet shows now ('' = not drawn yet; QA / tests). */
export const truckDashMapSignature = (): string => shared?.sig ?? '';

/** Drop the shared materials / geometry / sheet (with the truck model: a world without the truck). True: something released. */
export function releaseTruckDashMap(): boolean {
  const s = shared;
  if (!s) return false;
  s.sheet.dispose(); s.texture.dispose(); s.plane.dispose(); s.holder.dispose();
  shared = null;
  return true;
}

/** What the dash map needs from Game (structural: tests drive it with the controller's Node host). */
export interface TruckDashMapHost {
  player: {x: number; z: number; eye: number; yaw: number; pitch: number; alive: boolean};
  state: string;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
}

const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export class TruckDashMapSystem {
  /** QA / tests. */
  readonly counts = {opens: 0, refused: 0, draws: 0};
  readonly layout = truckDashMapLayout();
  readonly prompt: string = TRUCK_DASH_MAP_TEXT.read;
  private redrawT = 0;
  private force = true;
  private readonly box: Box3Like;
  private readonly o: V3 = {x: 0, y: 0, z: 0};
  private readonly d: V3 = {x: 0, y: 0, z: 0};

  /**
   * @param model the planning map now (the map runtime's live model — the tent table's; null: no district map here)
   * @param openMap opens the full-screen planning map (the map runtime's open(); false: refused)
   */
  constructor(readonly host: TruckDashMapHost, readonly car: SkywaysCar, private readonly model: () => PlanningMap | null, private readonly openMap: () => boolean) {
    const h = this.layout.size / 2 + TRUCK_DASH_MAP.pad;
    // (the sheet's own frame: across / up the sheet, out of its face; the holder under it)
    this.box = {min: {x: -h, y: -h, z: -0.03}, max: {x: h, y: h, z: TRUCK_DASH_MAP.pad}};
  }

  install(): this {
    this.car.seated.push(this);
    this.host.frameHooks.push(dt => this.frame(dt));
    this.host.sectionHooks.push({build: () => { this.force = true; this.redrawT = 0; }});
    return this;
  }

  /** The sheet's centre in the world (follows the truck), null without the truck. (The truck never takes a flight: its pitch is 0.) */
  anchor(): V3 | null {
    const b = this.car.body, C = this.layout.centre;
    if (!b || this.car.vehicle !== 'truck') return null;
    const p = carToWorld(b.x, b.z, b.yaw, C.x, C.z);
    return {x: p.x, y: b.y + C.y, z: p.z};
  }

  /**
   * The view's hit on the sheet within reach, else null: the ray from the player's eye along the view (yaw / pitch) in the truck frame,
   * against the sheet's box in the sheet's own frame. `t` = the distance from the eye (m); `u` / `v` = the hit across / up the sheet (m).
   */
  aimHit(): {t: number; u: number; v: number} | null {
    const b = this.car.body, P = this.host.player, L = this.layout;
    if (!b || this.car.vehicle !== 'truck') return null;
    const lo = worldToCar(b.x, b.z, b.yaw, P.x, P.z), co = Math.cos(b.yaw), s = Math.sin(b.yaw), cp = Math.cos(P.pitch);
    const wx = -Math.sin(P.yaw) * cp, wz = -Math.cos(P.yaw) * cp;
    const q = {x: lo.x - L.centre.x, y: P.eye - b.y - L.centre.y, z: lo.z - L.centre.z}, ld = {x: wx * co - wz * s, y: Math.sin(P.pitch), z: wx * s + wz * co};
    const o = this.o, d = this.d;
    o.x = dot(q, L.right); o.y = dot(q, L.up); o.z = dot(q, L.normal);
    d.x = dot(ld, L.right); d.y = dot(ld, L.up); d.z = dot(ld, L.normal);
    const t = rayBox(o, d, this.box, TRUCK_DASH_MAP.reach);
    return t === null ? null : {t, u: o.x + d.x * t, v: o.y + d.y * t};
  }

  /** SkywaysCar.seated: seated in the truck, playing, alive, and the crosshair on the sheet within reach. */
  aimed(): boolean {
    const car = this.car;
    if (car.vehicle !== 'truck' || !car.body || !car.driving || this.host.state !== 'playing' || !this.host.player.alive) return false;
    return this.aimHit() !== null;
  }

  /** SkywaysCar.seated: [E] on the sheet -> the planning map (the controller consumes the press either way: never the exit). */
  interact(): boolean {
    return this.open();
  }

  /** Open the planning map from the dash ([E] through the controller; QA). Refused unless seated in the truck, playing and alive, or without a map. */
  open(): boolean {
    const car = this.car;
    if (car.vehicle !== 'truck' || !car.body || !car.driving || this.host.state !== 'playing' || !this.host.player.alive) { this.counts.refused++; return false; }
    if (!this.openMap()) { this.counts.refused++; return false; }
    this.counts.opens++;
    return true;
  }

  /** QA: turn the seated view onto the sheet's centre (the look stays relative to the truck, as the mouse would leave it). False: not seated. */
  lookAtSheet(): boolean {
    const a = this.anchor(), P = this.host.player;
    if (!a || !this.car.driving) return false;
    const dx = a.x - P.x, dy = a.y - P.eye, dz = a.z - P.z;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  }

  /** Per frame: the sheet redrawn while seated or near the truck when what it shows changed. */
  private frame(dt: number): void {
    const v = this.car.view as TruckView | null;
    if (this.car.vehicle !== 'truck' || !v?.dashMap) return;
    this.redrawT -= dt;
    if (this.redrawT > 0 && !this.force) return;
    this.redrawT = TRUCK_DASH_MAP.redrawS;
    const a = this.anchor(), P = this.host.player;
    if (!a || (!this.force && !this.car.driving && Math.hypot(P.x - a.x, P.z - a.z) > TRUCK_DASH_MAP.nearM)) return;
    const m = this.model();
    if (!m) return;
    if (drawTruckDashMap(m, this.force)) this.counts.draws++;
    this.force = false;
  }

  /** QA: a compact state report. */
  qa() {
    const hit = this.car.driving ? this.aimHit() : null;
    return {anchor: this.anchor(), seated: this.car.driving, aimed: this.aimed(), hit: hit && {t: +hit.t.toFixed(3), u: +hit.u.toFixed(3), v: +hit.v.toFixed(3)},
      prompt: this.car.prompt, sig: truckDashMapSignature().length > 0, counts: {...this.counts}};
  }
}
