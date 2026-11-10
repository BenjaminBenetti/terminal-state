// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL): the LOOK of the ride portals.
//
// STATIC GATES — a headwall with a steel gate in each closed bed end of the parked car's track (world/ridePortal.ts 'gate' portals),
// built with the world (world/builder.ts) instead of that end's black plane and barricade (user: "the train visibly plows through real
// walls / black walls"). Per gated end, FOUR draws whatever the bed's width:
//   ride-gate-wall    the headwall: the whole bed end face except the ride-box openings, RIDE_GATE.proud in front of the end wall, in
//                     that wall's own material and texture mapping (read from the end wall's quad: every level kind's finish);
//   ride-gate-frame   the steel portal frame lining each opening's reveal (posts, lintel, hinges) + a dummy opening's lock bar;
//   ride-gate-leaves  the leaves (tube frame, plate, braces, a kick skirt notched over the rails): ONE InstancedMesh — two instances
//                     per opening; the second is the first turned half round (a leaf looks the same from both sides);
//   ride-gate-hazard  their hazard-striped bands: the same instances.
// The ride's own opening has the two leaves that MOVE (the runtime poses instances 0 / 1: world/ridePortalRuntime.ts); the other
// tracks of the same end face (RidePortal.dummies) get the same gate, barred shut, never posed. A leaf hinges just inside its post and
// swings INTO the tunnel until it lies along the ride box's side wall, clear of the car (0.30 m to its body).
// Procedural boxes from existing materials (the end wall's, 'steel', the traversal hazard stripes): no new art, no new material.
//
// BREACH HEADWALL — the wall that stands across a station tunnel at a 'breach' portal's plane ONLY while a ride uses it
// (buildBreachHeadwall; shown / hidden by the runtime, warmed as a pool): the tunnel's section around the ride-box opening in the
// shell's own lining + the same steel frame (no leaves).

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {playerTrainPlacement} from '../gen/playerTrain';
import type {WorldMaterials} from './materials';
import {hazardMaterial} from './traversalBuilder';
import {Acc} from './trackExt/mesh';
import {BOARD_SPAN, tunnelShellMaterial} from './trackExt/wallFinish';
import {RIDE_BOX, RIDE_GATE, gatedEnds, portalEndKey, ridePortals, type PlaneRect, type RidePortal} from './ridePortal';

/** Gate geometry (m). Leaf-local frame: origin on the hinge axis at the bed, +X along the leaf, +Y up, Z through its thickness. */
export const GATE = {
  /** The leaves' plane (hinge axes) before the end face: behind the headwall front, in front of the end wall's fittings. */
  plane: 0.12,
  /** Hinge axis inside the post's inner face; the stile behind the axis; the gap where the leaves meet / under the lintel. */
  hinge: 0.045, flange: 0.03, meet: 0.004, top: 0.015,
  /** Tube frame: width in the leaf plane, half depth; the plate's half thickness; mid rails (above the bed). */
  tube: 0.07, depth: 0.03, plate: 0.012, rails: [1.5, 3.05] as const,
  /** The kick skirt: plate from `foot` (over the sleepers) to `skirt`; notches over the running rail (`rail`: |z| span from the track
   *  centre, clear height) and the third rail + coverboard side (`third`: open to the skirt line), on both leaves alike. */
  foot: 0.16, skirt: 0.52, rail: [0.62, 0.82, 0.33] as const, third: [1.2, 1.6] as const,
  /** Hazard band (height range above the bed, half thickness: proud of the plate, inside the tubes). */
  band: [0.95, 1.2] as const, bandDepth: 0.017,
  /** The frame stands this far proud of the headwall front; hinge barrels (above the bed). */
  frameProud: 0.02, hinges: [0.7, 2.4, 4.1] as const,
  /** A dummy opening's lock bar (height range above the bed, half length). */
  bar: [1.28, 1.4, 0.95] as const,
} as const;

/** Half span of the opening between the leaves' hinge axes. */
const hingeZ = (): number => RIDE_BOX.half - RIDE_GATE.post - GATE.hinge;
/** A leaf's length from its hinge axis to its meeting edge, and its top above the bed. */
const leafLen = (): number => hingeZ() - GATE.meet;
const leafTop = (): number => RIDE_BOX.ceil - RIDE_GATE.lintel - GATE.top;

interface Part { c: [number, number, number]; h: [number, number, number]; mat: 'steel' | 'hazard'; /** Turned in the leaf plane (rad): a brace. */ rot?: number }

/** One leaf's boxes in its local frame (see GATE): front / back alike, so the other leaf is this one turned half round. */
export function leafParts(): Part[] {
  const G = GATE, w = leafLen(), top = leafTop(), xa = -G.flange, t2 = G.tube / 2;
  const out: Part[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, hz: number, mat: Part['mat'] = 'steel') => out.push({c: [(x0 + x1) / 2, (y0 + y1) / 2, 0], h: [(x1 - x0) / 2, (y1 - y0) / 2, hz], mat});
  // stiles (hinge side, meeting side), top / bottom rails, mid rails
  box(xa, xa + G.tube, G.foot, top, G.depth);
  box(w - G.tube, w, G.foot, top, G.depth);
  box(xa + G.tube, w - G.tube, top - G.tube, top, G.depth);
  box(xa + G.tube, w - G.tube, G.skirt, G.skirt + G.tube, G.depth);
  for (const y of G.rails) box(xa + G.tube, w - G.tube, y - 0.025, y + 0.025, G.depth * 0.8);
  // the plate (opaque: the end wall stands right behind a shut gate)
  box(xa + t2, w - t2, G.skirt, top - t2, G.plate);
  // the kick skirt under it, notched where the leaf (shut) stands over the rails: local x = hinge span - |z|
  const hz = hingeZ(), cuts: [number, number, number][] = [[hz - G.third[1], hz - G.third[0], G.skirt], [hz - G.rail[1], hz - G.rail[0], G.rail[2]]];
  let x = xa + G.tube;
  for (const [c0, c1, clear] of cuts) {
    if (c0 > x) box(x, c0, G.foot, G.skirt, G.plate);
    if (clear < G.skirt) box(c0, c1, clear, G.skirt, G.plate);
    x = c1;
  }
  if (w - G.tube > x) box(x, w - G.tube, G.foot, G.skirt, G.plate);
  // a flat brace on each face, hinge foot to meeting head
  const x0 = xa + G.tube, x1 = w - G.tube, y0 = G.skirt + G.tube, y1 = top - G.tube, len = Math.hypot(x1 - x0, y1 - y0) - 0.06;
  for (const s of [-1, 1]) out.push({c: [(x0 + x1) / 2, (y0 + y1) / 2, s * (G.plate + 0.008)], h: [len / 2, 0.03, 0.008], mat: 'steel', rot: Math.atan2(y1 - y0, x1 - x0)});
  // the hazard band, proud of the plate on both faces
  box(xa + G.tube, w - G.tube, G.band[0], G.band[1], G.bandDepth, 'hazard');
  return out;
}

const X: [number, number, number] = [1, 0, 0], Y: [number, number, number] = [0, 1, 0], Z: [number, number, number] = [0, 0, 1];

function leafGeometry(mat: Part['mat']): THREE.BufferGeometry {
  const a = new Acc();
  for (const p of leafParts()) {
    if (p.mat !== mat) continue;
    if (p.rot) { const c = Math.cos(p.rot), s = Math.sin(p.rot); a.box(p.c, p.h, [c, s, 0], [-s, c, 0], Z); }
    // (the stripes repeat along the band: caps.ts' hazard scale)
    else a.box(p.c, p.h, X, Y, Z, mat === 'hazard' ? {u: 0.6, v: 0.3} : undefined);
  }
  return a.geometry()!;
}

/** Leaf swing: instance matrix of the leaf hinged on side `s` (-1: low z, +1: high z) of `opening`, `open` 0 (shut) .. 1 (against the tunnel wall). */
export function leafMatrix(q: Pick<RidePortal, 'faceX' | 'out'>, opening: PlaneRect, s: 1 | -1, open: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const zc = (opening.z0 + opening.z1) / 2;
  // three's R_y(a) turns +X to (cos a, 0, -sin a): shut = toward the opening's centre, open = along the track into the tunnel
  return out.makeRotationY(s * (Math.PI / 2) * (1 - q.out * open)).setPosition(q.faceX - q.out * GATE.plane, opening.y0, zc + s * hingeZ());
}

/** World bounds of one leaf (all its parts) at swing `open` (tests / QA: the folded leaves clear the car, the shut ones close the opening). */
export function leafBounds(q: Pick<RidePortal, 'faceX' | 'out'>, opening: PlaneRect, s: 1 | -1, open: number): THREE.Box3 {
  const m = leafMatrix(q, opening, s, open), b = new THREE.Box3(), v = new THREE.Vector3();
  for (const p of leafParts()) {
    const c = p.rot ? Math.cos(p.rot) : 1, sn = p.rot ? Math.sin(p.rot) : 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * p.h[0], ly = sy * p.h[1];
      b.expandByPoint(v.set(p.c[0] + lx * c - ly * sn, p.c[1] + lx * sn + ly * c, p.c[2] + sz * p.h[2]).applyMatrix4(m));
    }
  }
  return b;
}

/** One gated bed end: its portal and the four meshes (see the file header). */
export interface RideGateView {
  portal: RidePortal;
  /** `${trench}:${end}`. */
  key: string;
  wall: THREE.Mesh;
  frame: THREE.Mesh;
  /** Instances 0 / 1: the ride's leaves (hinge at low / high z); 2.. : the dummy openings' leaves (never posed). */
  leaves: THREE.InstancedMesh;
  hazard: THREE.InstancedMesh;
  /** The pose the moving leaves have now (0 shut .. 1 open). */
  open: number;
  /** Pose the moving leaves (instance matrices only: no geometry, material or pipeline change). */
  setOpen(open: number): void;
}

export interface RideGatesBuilt {
  /** By `${trench}:${end}` (world/ridePortal.ts portalEndKey). */
  gates: Map<string, RideGateView>;
  /** Draws and triangles the gates add (instances counted). */
  stats: {meshes: number; triangles: number};
}

/**
 * `${trench}:${end}` of the bed ends whose black plane / barricade the builders leave out because a ride gate stands there: the
 * closed ends of the parked car's track (none on a level without a car).
 */
export function staticGateEnds(layout: StationLayout): Set<string> {
  return gatedEnds(layout, playerTrainPlacement(layout));
}

type UvOf = (z: number, y: number) => [number, number];

/**
 * The end wall a gate's headwall stands in front of: the material and texture mapping of the largest wall triangle the builder drew
 * in the end face plane, facing the bed (so the headwall is that level kind's own bed-end finish at the same texel density), or null
 * (no wall there: rooms directly behind the face).
 */
function endWallOf(group: THREE.Group, q: RidePortal): {material: THREE.Material; uv: UvOf} | null {
  const f = q.face, nx = -q.out;
  let best: {material: THREE.Material; uv: UvOf} | null = null, bestArea = 0.02;
  for (const o of group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || o.userData.ridePortal) continue;
    const g = m.geometry, idx = g.index, P = g.attributes.position as THREE.BufferAttribute | undefined, N = g.attributes.normal as THREE.BufferAttribute | undefined, U = g.attributes.uv as THREE.BufferAttribute | undefined;
    if (!idx || !P || !N || !U) continue;
    const bs = g.boundingSphere;
    if (bs && (Math.abs(bs.center.x - q.x) > bs.radius + 1e-3 || bs.center.z + bs.radius < f.z0 || bs.center.z - bs.radius > f.z1)) continue;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (Math.abs(P.getX(a) - q.x) > 1e-4 || Math.abs(P.getX(b) - q.x) > 1e-4 || Math.abs(P.getX(c) - q.x) > 1e-4 || N.getX(a) * nx < 0.9) continue;
      const z0 = P.getZ(a), y0 = P.getY(a), z1 = P.getZ(b) - z0, y1 = P.getY(b) - y0, z2 = P.getZ(c) - z0, y2 = P.getY(c) - y0;
      const det = z1 * y2 - z2 * y1, area = Math.abs(det) / 2;
      const zc = z0 + (z1 + z2) / 3, yc = y0 + (y1 + y2) / 3;
      if (area <= bestArea || zc < f.z0 || zc > f.z1 || yc < f.y0 || yc > f.y1) continue;
      // the wall's planar mapping (u, v) = A (z, y) + b from this triangle
      const u0 = U.getX(a), v0 = U.getY(a), du1 = U.getX(b) - u0, dv1 = U.getY(b) - v0, du2 = U.getX(c) - u0, dv2 = U.getY(c) - v0;
      const uz = (du1 * y2 - du2 * y1) / det, uy = (du2 * z1 - du1 * z2) / det, vz = (dv1 * y2 - dv2 * y1) / det, vy = (dv2 * z1 - dv1 * z2) / det;
      if (![uz, uy, vz, vy].every(Number.isFinite)) continue;
      bestArea = area;
      best = {material: m.material, uv: (z, y) => [u0 + uz * (z - z0) + uy * (y - y0), v0 + vz * (z - z0) + vy * (y - y0)]};
    }
  }
  return best;
}

/** A wall in plane x facing the station (normal -out): `face` except the `openings`, as quads. */
function headwall(a: Acc, x: number, out: 1 | -1, face: PlaneRect, openings: readonly PlaneRect[], uv: UvOf): void {
  const n = [-out, 0, 0];
  const quad = (z0: number, z1: number, y0: number, y1: number) => {
    if (z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return;
    const v = (z: number, y: number) => { const [u, w] = uv(z, y); return a.v([x, y, z], n, u, w); };
    a.quad(v(z0, y0), v(z1, y0), v(z1, y1), v(z0, y1));
  };
  const ops = [...openings].sort((p, q) => p.z0 - q.z0);
  let z = face.z0;
  for (const o of ops) {
    quad(z, o.z0, face.y0, face.y1); // the pier beside it
    quad(o.z0, o.z1, o.y1, face.y1); // over it
    quad(o.z0, o.z1, face.y0, o.y0); // (under it: none on a bed, the opening starts at the bed)
    z = o.z1;
  }
  quad(z, face.z1, face.y0, face.y1);
}

/** The steel frame lining an opening from x0 to x1 (posts and lintel inside its edge). */
function portalFrame(a: Acc, x0: number, x1: number, o: PlaneRect): void {
  const xc = (x0 + x1) / 2, hx = Math.abs(x1 - x0) / 2, P = RIDE_GATE.post, L = RIDE_GATE.lintel;
  for (const zc of [o.z0 + P / 2, o.z1 - P / 2]) a.box([xc, (o.y0 + o.y1) / 2, zc], [hx, (o.y1 - o.y0) / 2, P / 2], X, Y, Z);
  a.box([xc, o.y1 - L / 2, (o.z0 + o.z1) / 2], [hx, L / 2, (o.z1 - o.z0) / 2 - P], X, Y, Z);
}

function mesh(g: THREE.BufferGeometry, mat: THREE.Material, name: string, level: number): THREE.Mesh {
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.userData.level = level;
  m.userData.ridePortal = true; // (the portal's own: never cut by a ride, world/ridePortalRuntime.ts)
  m.matrixAutoUpdate = false;
  return m;
}

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * The leaves' InstancedMesh: its bounds are always the whole swing (shut .. folded open), whoever asks to recompute them — the level
 * culler's register() recomputes every InstancedMesh's box from its current (shut) matrices, which would cull the open leaves lying
 * 1.8 m inside the tunnel while they are in view. An ordinary InstancedMesh otherwise (same program, same draws).
 */
class GateLeaves extends THREE.InstancedMesh {
  constructor(g: THREE.BufferGeometry, m: THREE.Material, n: number, readonly swing: THREE.Box3) { super(g, m, n); }
  override computeBoundingBox(): void { (this.boundingBox ??= new THREE.Box3()).copy(this.swing); }
  override computeBoundingSphere(): void { this.boundingSphere = this.swing.getBoundingSphere(this.boundingSphere ?? new THREE.Sphere()); }
}

/** Build the static gates of `layout` into `group` (null: the level has none — no car, or a station tunnel continues both ends). */
export function buildRideGates(group: THREE.Group, layout: StationLayout, mats: WorldMaterials): RideGatesBuilt | null {
  const p = playerTrainPlacement(layout);
  if (!p) return null;
  const r = ridePortals(layout, p), list = [r.front, r.rear].filter(q => q.kind === 'gate');
  if (!list.length) return null;
  const gates = new Map<string, RideGateView>();
  const stats = {meshes: 0, triangles: 0};
  const steel = mats.get('steel'), hazard = hazardMaterial(mats), ts = mats.scale.tunnel;
  for (const q of list) {
    const key = portalEndKey(q), openings = [q.opening, ...q.dummies], G = GATE;
    const front = q.faceX - q.out * RIDE_GATE.proud;
    // 1. the headwall, in the end wall's own finish
    const ref = endWallOf(group, q);
    const wa = new Acc();
    headwall(wa, front, q.out, q.face, openings, ref?.uv ?? ((z, y) => [q.out * z / ts.u, (y - q.face.y0) / ts.v]));
    const wall = mesh(wa.geometry()!, ref?.material ?? mats.get('tunnel'), `ride-gate-wall-${key}`, p.level);
    // 2. the frames (the reveal from just proud of the headwall back to the end face), hinges, a dummy's lock bar
    const fa = new Acc();
    for (const [i, o] of openings.entries()) {
      portalFrame(fa, front - q.out * G.frameProud, q.faceX, o);
      const zc = (o.z0 + o.z1) / 2, xh = q.faceX - q.out * G.plane;
      for (const s of [-1, 1]) for (const y of G.hinges) fa.box([xh, o.y0 + y, zc + s * (RIDE_BOX.half - RIDE_GATE.post - 0.02)], [0.03, 0.08, 0.02], X, Y, Z);
      if (i > 0) {
        // a dummy never opens: a bar across both leaves on the station side, in keeps on the posts, and its lock
        const xb = xh - q.out * (G.depth + 0.02);
        fa.box([xb, o.y0 + (G.bar[0] + G.bar[1]) / 2, zc], [0.02, (G.bar[1] - G.bar[0]) / 2, G.bar[2]], X, Y, Z);
        for (const s of [-1, 1]) fa.box([xb, o.y0 + (G.bar[0] + G.bar[1]) / 2, zc + s * G.bar[2]], [0.035, 0.11, 0.04], X, Y, Z);
        fa.box([xb - q.out * 0.02, o.y0 + G.bar[0] - 0.07, zc], [0.015, 0.06, 0.045], X, Y, Z);
      }
    }
    const frame = mesh(fa.geometry()!, steel, `ride-gate-frame-${key}`, p.level);
    // 3. / 4. the leaves and their hazard bands: two instances per opening
    const n = openings.length * 2, mx = new THREE.Matrix4();
    // bounds over the whole swing (the open leaves lie 1.8 m inside the tunnel: the shut pose's would cull them in view); the moving
    // pair sampled finely (a leaf's corners sweep arcs: their box over the swing is not that of a few poses)
    const swing = new THREE.Box3();
    openings.forEach((o, i) => { for (const s of [-1, 1] as const) for (let k = 0; k <= (i ? 0 : 16); k++) swing.union(leafBounds(q, o, s, k / 16)); });
    swing.expandByScalar(0.02);
    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.InstancedMesh => {
      const im = new GateLeaves(g, mat, n, swing);
      im.name = name;
      im.userData.level = p.level;
      im.userData.ridePortal = true;
      im.matrixAutoUpdate = false;
      openings.forEach((o, i) => { im.setMatrixAt(2 * i, leafMatrix(q, o, -1, 0, mx)); im.setMatrixAt(2 * i + 1, leafMatrix(q, o, 1, 0, mx)); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      return im;
    };
    const leaves = inst(leafGeometry('steel'), steel, `ride-gate-leaves-${key}`);
    const haz = inst(leafGeometry('hazard'), hazard, `ride-gate-hazard-${key}`);
    const view: RideGateView = {
      portal: q, key, wall, frame, leaves, hazard: haz, open: 0,
      setOpen(open: number): void {
        const e = Math.min(1, Math.max(0, open));
        if (e === this.open) return;
        this.open = e;
        for (const im of [leaves, haz]) {
          im.setMatrixAt(0, leafMatrix(q, q.opening, -1, e, mx));
          im.setMatrixAt(1, leafMatrix(q, q.opening, 1, e, mx));
          im.instanceMatrix.needsUpdate = true;
        }
      },
    };
    for (const m of [wall, frame, leaves, haz]) {
      group.add(m);
      stats.meshes++;
      stats.triangles += tris(m.geometry) * ((m as THREE.InstancedMesh).isInstancedMesh ? n : 1);
    }
    gates.set(key, view);
  }
  return {gates, stats};
}

/** A breach's headwall (see the file header): hidden until a ride uses the portal. */
export interface BreachHeadwall { root: THREE.Group; wall: THREE.Mesh; frame: THREE.Mesh; triangles: number }

/** How far the breach frame stands proud of the headwall toward the station / runs into the ride tunnel (m). */
export const BREACH_FRAME = {proud: 0.06, depth: 0.1} as const;

/**
 * The headwall of breach portal `q`: the station tunnel's section at the plane except the ride-box opening, in the shell's own
 * lining (same board span as the tunnel walls), facing the station, + the steel frame in the opening. Two meshes under one hidden
 * group; `level` = the car's level (the tunnel's). Existing materials, the station structure's shadow flags.
 */
export function buildBreachHeadwall(q: RidePortal, mats: WorldMaterials, level = 0): BreachHeadwall {
  const root = new THREE.Group();
  root.name = `ride-breach-${portalEndKey(q)}`;
  root.userData.ridePortal = true;
  root.visible = false;
  const wa = new Acc();
  headwall(wa, q.x, q.out, q.face, [q.opening], (z, y) => [q.out * z / BOARD_SPAN, (y - q.face.y0) / BOARD_SPAN]);
  const fa = new Acc();
  portalFrame(fa, q.x - q.out * BREACH_FRAME.proud, q.x + q.out * BREACH_FRAME.depth, q.opening);
  const wall = mesh(wa.geometry()!, tunnelShellMaterial(mats), `${root.name}-wall`, level);
  const frame = mesh(fa.geometry()!, mats.get('steel'), `${root.name}-frame`, level);
  for (const m of [wall, frame]) { m.castShadow = m.receiveShadow = true; root.add(m); }
  root.matrixAutoUpdate = false;
  root.updateMatrixWorld(true);
  return {root, wall, frame, triangles: tris(wall.geometry) + tris(frame.geometry)};
}
