// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's HANDMADE CAB — the source model is one closed shell with a
// hollow cab (no seats, dash or steering wheel) and a hollow canvas cover, so the first-person driving position is finished here with
// simple handmade geometry (no new art, no textures: flat-colour materials): the cab floor, the dash (a toe board, the upper dash, an
// instrument binnacle with two gauges and their needles, a centre stack, a gear lever), the steering column and a steering wheel on its
// pivot (it turns with the steering), two seats (pedestal, cushion, back, headrest), door cards under the side windows, a back panel and
// a roof liner; and the bed's floor under the canvas. Everything is placed from the cook's measured anchors (truck frame) and kept clear
// of the glazing: the dash and the binnacle stay under the eye's sight line to the windscreen's base, the door cards under the side
// windows' sills (tests/surface-truck-cab.test.ts). Pure layout data (truckCabLayout) + one builder (buildTruckCab) that merges the
// boxes per material (a handful of meshes) — the steering wheel is its own small group.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

export type CabMat = 'dash' | 'panel' | 'floor' | 'seat' | 'metal' | 'gauge' | 'needle' | 'bed';
export interface CabBox { name: string; mat: CabMat; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
export interface CabDisc { name: string; mat: CabMat; x: number; y: number; z: number; r: number }
export interface TruckCabLayout {
  boxes: CabBox[];
  discs: CabDisc[];
  /** The steering wheel: hub (truck frame), rim radius, the wheel plane's normal (toward the driver), the column's far end. */
  wheel: {x: number; y: number; z: number; r: number; tilt: number; normal: [number, number, number]; column: {x: number; y: number; z: number}};
  /** The cab floor's top, the dash top, the windscreen's middle x (the passenger seat mirrors the driver's about it). */
  floorY: number;
  dashTop: number;
  cabCx: number;
}

const A = TRUCK_ANCHORS;

/** The handmade bed floor's top (truck frame, m): 1.5 cm over the model's own measured load floor — what secured cargo stands on. */
export const TRUCK_BED_FLOOR_Y = A.bed.y0 + 0.015;

/** The cab's handmade parts (truck frame; deterministic from the anchors). */
export function truckCabLayout(): TruckCabLayout {
  const I = A.interior, E = A.eye, H = A.seat, W = A.wheelCentre, ws = A.glass.filter(g => g.name.startsWith('windscreen'));
  const cabCx = (Math.min(...ws.map(g => g.x0)) + Math.max(...ws.map(g => g.x1))) / 2;
  const sill = Math.min(...A.glass.filter(g => !g.name.startsWith('windscreen')).map(g => g.y0));
  const floorY = H.y - 0.36, dashTop = A.cowl.y - 0.05, dashFront = I.z0 + 0.02, dashBack = W.z - 0.16;
  const x0 = I.x0 + 0.03, x1 = I.x1 - 0.03;
  const boxes: CabBox[] = [
    {name: 'floor', mat: 'floor', x0, x1, y0: floorY - 0.06, y1: floorY, z0: I.z0 + 0.06, z1: I.z1 - 0.03},
    {name: 'toe-board', mat: 'dash', x0, x1, y0: floorY, y1: dashTop - 0.27, z0: dashFront, z1: dashFront + 0.06},
    {name: 'dash', mat: 'dash', x0, x1, y0: dashTop - 0.27, y1: dashTop, z0: dashFront, z1: dashBack},
    {name: 'binnacle', mat: 'dash', x0: E.x - 0.2, x1: E.x + 0.2, y0: dashTop, y1: dashTop + 0.09, z0: dashFront + 0.08, z1: dashBack - 0.03},
    {name: 'centre-stack', mat: 'dash', x0: cabCx - 0.16, x1: cabCx + 0.16, y0: floorY, y1: dashTop - 0.27, z0: dashFront + 0.06, z1: dashBack + 0.22},
    {name: 'gear-lever', mat: 'metal', x0: cabCx - 0.012, x1: cabCx + 0.012, y0: dashTop - 0.27, y1: dashTop - 0.03, z0: dashBack + 0.16, z1: dashBack + 0.185},
    {name: 'gear-knob', mat: 'needle', x0: cabCx - 0.025, x1: cabCx + 0.025, y0: dashTop - 0.05, y1: dashTop, z0: dashBack + 0.148, z1: dashBack + 0.198},
    {name: 'door-card-left', mat: 'panel', x0: I.x0 + 0.01, x1: I.x0 + 0.05, y0: floorY, y1: sill - 0.06, z0: I.z0 + 0.06, z1: I.z1 - 0.05},
    {name: 'door-card-right', mat: 'panel', x0: I.x1 - 0.05, x1: I.x1 - 0.01, y0: floorY, y1: sill - 0.06, z0: I.z0 + 0.06, z1: I.z1 - 0.05},
    {name: 'back-panel', mat: 'panel', x0, x1, y0: floorY, y1: I.y1 - 0.05, z0: I.z1 - 0.05, z1: I.z1 - 0.02},
    {name: 'roof-liner', mat: 'panel', x0, x1, y0: I.y1 - 0.05, y1: I.y1 - 0.02, z0: I.z0 + 0.03, z1: I.z1 - 0.02},
  ];
  for (const [side, sx] of [['driver', E.x], ['passenger', 2 * cabCx - E.x]] as const) {
    boxes.push(
      {name: `seat-${side}-pedestal`, mat: 'metal', x0: sx - 0.17, x1: sx + 0.17, y0: floorY, y1: H.y - 0.08, z0: H.z - 0.2, z1: H.z + 0.14},
      {name: `seat-${side}-cushion`, mat: 'seat', x0: sx - 0.25, x1: sx + 0.25, y0: H.y - 0.08, y1: H.y + 0.04, z0: H.z - 0.27, z1: H.z + 0.17},
      {name: `seat-${side}-back`, mat: 'seat', x0: sx - 0.25, x1: sx + 0.25, y0: H.y + 0.04, y1: H.y + 0.66, z0: H.z + 0.15, z1: H.z + 0.26},
      {name: `seat-${side}-headrest`, mat: 'seat', x0: sx - 0.14, x1: sx + 0.14, y0: H.y + 0.68, y1: H.y + 0.88, z0: H.z + 0.17, z1: H.z + 0.25},
    );
  }
  // the bed's floor under the canvas: the opened rear's sill level, wall to wall
  const B = A.bed;
  boxes.push({name: 'bed-floor', mat: 'bed', x0: B.x0 + 0.02, x1: B.x1 - 0.02, y0: B.y0 - 0.03, y1: TRUCK_BED_FLOOR_Y, z0: B.z0 + 0.02, z1: B.opening.z - 0.03});
  // two gauges on the binnacle's face (toward the driver) + their needles
  const gz = dashBack - 0.03 + 0.003, gy = dashTop + 0.045;
  const discs: CabDisc[] = [{name: 'gauge-speed', mat: 'gauge', x: E.x - 0.085, y: gy, z: gz, r: 0.038}, {name: 'gauge-rev', mat: 'gauge', x: E.x + 0.085, y: gy, z: gz, r: 0.038}];
  for (const d of discs.slice()) boxes.push({name: `${d.name}-needle`, mat: 'needle', x0: d.x - 0.003, x1: d.x + 0.003, y0: d.y - 0.004, y1: d.y + 0.03, z0: d.z + 0.001, z1: d.z + 0.004});
  const t = A.steering.tilt, normal: [number, number, number] = [0, Math.cos(t), Math.sin(t)];
  const colLen = 0.3;
  return {boxes, discs, floorY, dashTop, cabCx,
    wheel: {x: W.x, y: W.y, z: W.z, r: A.steering.radius, tilt: t, normal, column: {x: W.x, y: W.y - normal[1] * colLen, z: W.z - normal[2] * colLen}}};
}

const COLORS: Record<CabMat, number> = {dash: 0x23261f, panel: 0x3a3d33, floor: 0x1c1d19, seat: 0x2e3127, metal: 0x2a2b2a, gauge: 0xc5cbbb, needle: 0xb3381f, bed: 0x433b2e};

let mats: Record<CabMat, THREE.MeshStandardMaterial> | null = null;
/** The cab's shared flat-colour materials (one instance each: one program each). */
export function truckCabMaterials(): Record<CabMat, THREE.MeshStandardMaterial> {
  if (mats) return mats;
  const m = {} as Record<CabMat, THREE.MeshStandardMaterial>;
  for (const k of Object.keys(COLORS) as CabMat[]) {
    const x = new THREE.MeshStandardMaterial({color: COLORS[k], roughness: k === 'metal' || k === 'needle' ? 0.55 : 0.9, metalness: k === 'metal' ? 0.4 : 0.02});
    x.name = `surface-truck-cab-${k}`;
    m[k] = x;
  }
  return (mats = m);
}

let geoCache: Map<CabMat, THREE.BufferGeometry> | null = null;
/** The merged box / disc geometry per material (built once: one truck at a time; a few hundred triangles). */
function cabGeometries(lay: TruckCabLayout): Map<CabMat, THREE.BufferGeometry> {
  if (geoCache) return geoCache;
  const per = new Map<CabMat, THREE.BufferGeometry[]>();
  const add = (k: CabMat, g: THREE.BufferGeometry) => { let l = per.get(k); if (!l) per.set(k, (l = [])); l.push(g); };
  for (const b of lay.boxes) {
    const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    add(b.mat, g);
  }
  for (const d of lay.discs) {
    const g = new THREE.CircleGeometry(d.r, 20);
    g.translate(d.x, d.y, d.z);
    add(d.mat, g);
  }
  geoCache = new Map();
  for (const [k, list] of per) {
    const merged = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)), false);
    merged.name = `surface-truck-cab-${k}`;
    merged.computeBoundingSphere();
    geoCache.set(k, merged);
    for (const g of list) g.dispose();
  }
  return geoCache;
}

let wheelGeo: {ring: THREE.BufferGeometry; spoke: THREE.BufferGeometry; hub: THREE.BufferGeometry; column: THREE.BufferGeometry} | null = null;

/**
 * The cab (truck frame): the merged parts and the steering wheel (tilt group at the hub -> `spin`, rotation.z = the wheel's turn about
 * its axis). Nothing here casts a shadow (the controller's decorateView: the cockpit group).
 */
export function buildTruckCab(): {group: THREE.Group; wheel: THREE.Object3D; layout: TruckCabLayout} {
  const lay = truckCabLayout(), M = truckCabMaterials(), g = new THREE.Group();
  g.name = 'surface-truck-cab';
  for (const [k, geo] of cabGeometries(lay)) {
    const m = new THREE.Mesh(geo, M[k]);
    m.name = `surface-truck-cab-${k}`;
    m.userData.carPart = 'cockpit';
    m.castShadow = false;
    g.add(m);
  }
  wheelGeo ??= {
    ring: new THREE.TorusGeometry(lay.wheel.r, 0.017, 8, 32),
    spoke: new THREE.BoxGeometry(lay.wheel.r * 2 - 0.02, 0.03, 0.016),
    hub: new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16),
    column: new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12),
  };
  const Wl = lay.wheel, tilt = new THREE.Group();
  tilt.name = 'surface-truck-steering';
  tilt.position.set(Wl.x, Wl.y, Wl.z);
  tilt.rotation.x = Wl.tilt - Math.PI / 2; // (the torus' +Z normal -> (0, cos tilt, sin tilt): up and back toward the driver)
  g.add(tilt);
  const spin = new THREE.Group();
  spin.name = 'surface-truck-steering-spin';
  tilt.add(spin);
  const ring = new THREE.Mesh(wheelGeo.ring, M.metal);
  ring.name = 'surface-truck-steering-rim';
  const spoke = new THREE.Mesh(wheelGeo.spoke, M.metal);
  spoke.name = 'surface-truck-steering-spoke';
  const hub = new THREE.Mesh(wheelGeo.hub, M.dash);
  hub.rotation.x = Math.PI / 2;
  spin.add(ring, spoke, hub);
  const col = new THREE.Mesh(wheelGeo.column, M.metal);
  col.name = 'surface-truck-steering-column';
  col.rotation.x = Math.PI / 2;
  col.position.set(0, 0, -0.15); // (along the wheel's axis into the dash)
  tilt.add(col);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.userData.carPart = 'cockpit'; (o as THREE.Mesh).castShadow = false; } });
  return {group: g, wheel: spin, layout: lay};
}
