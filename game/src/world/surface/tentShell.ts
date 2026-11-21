// Task studio-surface-tent-first-staging-20261120-225458-01 (lead). User: "tackle it now. The tent has no windows so it should be possible to
// have that as the full loading area. Just like how the train is a loading area between levels."
//
// THE STAGED COMMAND TENT — the loading space of a version-2 up-crossing (the Subway cargo lift, the Office / Mall connector tube). Before,
// the car / tube stayed sealed for the WHOLE district build (its streets, facades, interiors, the light bake, the probes) and only then
// opened into the tent (world/surface/tentStage.ts). The tent is windowless and closed, so it can be the loading space the way the train is
// between stations: built first, on its own, from the district's own layout with the builders' own pieces — the same walls (the grid's
// faces in the tent's cells: levelGeometry.ts extractWallFacesSteps' `window`, SurfaceArch.remapFaces' canvas), floor (floorKey), door
// soffit and frame, the pitched roof, gables, guy lines and door flap (SurfaceArch.buildTentInto), the kit standing in it (kit.ts
// buildSurfaceKitProp: the map table, cots, radio, tripod lamps …) and its supply crate's closed body (the openables' own model), in the
// same materials — at the tent's own place in the district. Game.rideSurfaceLift / walkSurfaceConnector build it in the sealed car / tube
// (a few hundred ms of work), prepare its first view, and the car / tube opens INTO IT; the district is then built behind it while the
// player walks, looks and reads the real planning map at its table (world/surface/mapRuntime.ts stage(): the district's own record).
//
//  - Drawn ALONE (drawSealed: everything else in the scene on CULL_LAYER for the draw, as the sealed car) — the district being built
//    around it is never seen, and its real tent (the same geometry, at the same place) never fights with it.
//  - LIT on its own, as the train is (the user: "Tent-stage lighting may be isolated/staged as needed, like the train"): the district's
//    lighting does not exist yet (its bake is most of the build), so the tent's two ridge lamps are lit by the train's boot-time interior
//    PointLights (always in the scene: no light-set change — world/playerTrain.ts), lent while the shell is drawn. Its light set is
//    frozen at its first view: a light the district build adds (its field light) is left out of the shell's draws; the finished district
//    is lit exactly as before. (Measured, tests/crossing-first-view-game.test.ts 'shell': the shell's frames still meet a few programs —
//    the district's far / roof models and the volumetric pass as they are built, and the shell's shared materials once more after the
//    district's lighting is installed — about 23 node builds and 6 pipelines in ~800 frames; the door-open and swap frames meet none.)
//  - COLLISION: the district's own grid levels (gen/levels.ts levelsOf: the memoized object the build uses) with the props in the tent and
//    the closed flap's boxes (airDoors.ts) — the same walls, furniture and doorway the player meets in the built tent.
//  - Once the district is built and its real tent's first view is prepared (tentStage.ts), the shell is disposed in one frame: the player
//    is in the real tent at the same place; the street behind the held flap is prepared as before. A failure or a teardown disposes it and
//    gives the lights back.
// Nothing of it is saved or remembered: no holder, pickup, loot, memory or RNG draw is made or moved (the crate shown is its closed body
// only; it opens once the district is built — said by the prompt).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {StationLayout} from '../../gen/stationTypes';
import type {PropPlacement} from '../../gen/props';
import {CELL, FLOOR, VOID} from '../../gen/grid';
import {levelsOf, type Levels} from '../../gen/levels';
import {isSurfaceKind} from '../../gen/surface/kinds';
import {isContainerKind} from '../../items/loot';
import {PropIndex} from '../../core/physics';
import type {BuildSteps} from '../../core/pacedBuild';
import {Accum, chunkSpans, wallQuad, type Sink} from '../builder';
import {LevelColumns, cellCeil, extractWallFacesSteps, stationLevels, type BuiltFace} from '../levelGeometry';
import type {WorldMaterials} from '../materials';
import {CULL_LAYER} from '../levelCulling';
import {SurfaceArch} from './arch';
import {surfaceLookPlanSteps} from './archPlan';
import {buildSurfaceKitProp} from './kit';
import {doorBoxes, fitDoorBoxes, planSurfaceDoors, type SurfaceDoorPlan, type SurfaceDoorState} from './airDoors';
import {tentStageBox} from './tentStage';
import {buildDecayFieldSteps, decayWorldMaterials, primeDecayField, setDecayField} from '../decay';

export const TENT_SHELL = {
  /** Cells round the tent's box the wall faces are taken from (the canvas ring and its door reveal). */
  marginCells: 1,
  /** The lent lamps (world/playerTrain.ts TRAIN_LIGHTS.interior: candela / m / decay) and how far under the lamp's mount they hang (m). */
  lamp: {intensity: 22, distance: 9, decay: 2, color: 0xffd6a0, drop: 0.1},
  /** A face this close to the tent's box (m) is the tent's. */
  faceSlack: 0.05,
} as const;

/** What the shell is made of, and when (QA / tests). */
export interface TentShellStats {
  faces: number; floors: number; ceilings: number; trims: number; kit: number; crate: number; skipped: string[];
  meshes: number; triangles: number; lamps: number; props: number; ms: number;
  /** Its first view (Game: render/firstView.ts end / why / ms) and the frames it was drawn in. */
  view: {end: string; why: string; ms: number; activeMs: number; items: number; reps: number; tries: number} | null;
  frames: number; sealedMax: number;
}

type Renderable = THREE.Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
const isRenderable = (o: THREE.Object3D): o is Renderable => { const r = o as Renderable; return !!(r.isMesh || r.isPoints || r.isLine || r.isSprite); };
const SEAL_MASK = (1 << CULL_LAYER) >>> 0;
const UP = new THREE.Vector3(0, 1, 0);

/** The supply crate's closed parts (world/openables.ts OpenableSet.model: its body and its closed lid, holder-local). */
export interface CrateModelSource {
  model(kind: string): {body: {geo: THREE.BufferGeometry; mat: THREE.Material}[]; closed: {geo: THREE.BufferGeometry; mat: THREE.Material}[]};
}

export interface TentShellDeps {
  mats: WorldMaterials;
  /** The openables (Game.containers.openables): the crate's closed body; null: no crate shown. */
  crates: CrateModelSource | null;
  /** atmosphere.markShadows (the flashlight's shadow: cast / received as the built tent's). */
  markShadows?: (root: THREE.Object3D, casts: boolean) => void;
  now?: () => number;
}

export class TentShell {
  /** The lights the shell's draws keep (frozen at begin(): the light set its programs were compiled for). */
  private lightSet: Set<THREE.Light> | null = null;
  private lent: {light: THREE.PointLight; at: THREE.Vector3; color: THREE.Color; intensity: number; distance: number; decay: number}[] = [];
  private readonly sealObjs: THREE.Object3D[] = [];
  private readonly sealMasks: number[] = [];
  private readonly sealStack: THREE.Object3D[] = [];
  disposed = false;

  constructor(
    readonly layout: StationLayout,
    readonly root: THREE.Group,
    readonly box: THREE.Box3,
    /** The district's collision levels (memoized per layout: the build's own) and the tent's props + the closed flap. */
    readonly levels: Levels,
    readonly props: PropIndex,
    readonly flapPlan: SurfaceDoorPlan | null,
    readonly flapBoxes: readonly PropPlacement[],
    readonly lamps: readonly {x: number; y: number; z: number}[],
    readonly stats: TentShellStats,
    private readonly owned: THREE.BufferGeometry[],
  ) {}

  /** The tent's floor (the flap's threshold: the floor the player walks). */
  get floorY(): number { return this.flapPlan?.floor ?? this.box.min.y + 1; }

  /** A point in the tent's box (with a slack, m). */
  contains(x: number, y: number, z: number, slack = 0): boolean {
    const b = this.box;
    return x >= b.min.x - slack && x <= b.max.x + slack && z >= b.min.z - slack && z <= b.max.z + slack && y >= b.min.y - slack && y <= b.max.y + slack;
  }

  /**
   * The shell begins to be drawn: `lights` (the train's interior PointLights, always in the scene) lent to its lamps, the scene's light
   * set frozen for its draws (what is in the scene now, those included).
   */
  begin(scene: THREE.Scene, lights: readonly THREE.PointLight[]): void {
    this.lent = lights.slice(0, this.lamps.length).map(l => ({light: l, at: l.position.clone(), color: l.color.clone(), intensity: l.intensity, distance: l.distance, decay: l.decay}));
    this.applyLights();
    const set = new Set<THREE.Light>();
    scene.traverse(o => { if ((o as THREE.Light).isLight) set.add(o as THREE.Light); });
    this.lightSet = set;
    this.stats.lamps = this.lent.length;
  }

  /** The lent lamps at the tent's lamps (each drawn frame: the district's build switches the train's lights off for its own world). */
  applyLights(): void {
    const L = TENT_SHELL.lamp;
    this.lent.forEach((e, i) => {
      const p = this.lamps[i], l = e.light;
      l.position.set(p.x, p.y - L.drop, p.z);
      l.color.setHex(L.color);
      l.intensity = L.intensity;
      l.distance = L.distance;
      l.decay = L.decay;
      l.updateMatrixWorld();
    });
  }

  /** The lent lights back as they were (`on`: their owner lights them now — else off, as a world without the train has them). */
  returnLights(on: boolean): void {
    for (const e of this.lent) {
      const l = e.light;
      l.position.copy(e.at);
      l.color.copy(e.color);
      l.distance = e.distance;
      l.decay = e.decay;
      l.intensity = on ? e.intensity : 0;
      l.updateMatrixWorld();
    }
    this.lent = [];
  }

  /** What the shell's first view prepares: its own renderables and the `keep` roots' (the car / tube, the map sheet). */
  admits(o: THREE.Object3D, keep: readonly THREE.Object3D[]): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === this.root || keep.includes(p)) return true;
    return false;
  }

  /**
   * One frame drawn with the shell alone (`draw`: Game.drawFrame): every renderable outside the shell and the `keep` roots on CULL_LAYER for
   * the call, and every light the district build added since begin() likewise (the shell's light set never changes); all given back right
   * after. No program, material or culler state is touched.
   */
  drawSealed(scene: THREE.Object3D, keep: readonly THREE.Object3D[], draw: () => void): void {
    const objs = this.sealObjs, masks = this.sealMasks, stack = this.sealStack, lights = this.lightSet;
    objs.length = masks.length = stack.length = 0;
    this.applyLights();
    for (const c of scene.children) stack.push(c);
    while (stack.length) {
      const o = stack.pop()!;
      if (o === this.root || keep.includes(o)) continue;
      if (o.layers.mask !== SEAL_MASK && (isRenderable(o) || ((o as THREE.Light).isLight && lights && !lights.has(o as THREE.Light)))) { objs.push(o); masks.push(o.layers.mask); o.layers.mask = SEAL_MASK; }
      for (const c of o.children) stack.push(c);
    }
    this.stats.frames++;
    if (objs.length > this.stats.sealedMax) this.stats.sealedMax = objs.length;
    try { draw(); } finally {
      for (let i = 0; i < objs.length; i++) objs[i].layers.mask = masks[i];
      objs.length = masks.length = 0;
    }
  }

  /** The eye's ray (origin, unit direction) meets the held flap's doorway within `reach` (m). */
  aimsAtFlap(o: THREE.Vector3, d: THREE.Vector3, reach: number): boolean {
    const p = this.flapPlan;
    if (!p) return false;
    const along = p.n[0] === 0, hw = p.width / 2 + 0.1;
    const b = new THREE.Box3(new THREE.Vector3(along ? p.x - hw : p.x - 0.25, p.floor, along ? p.z - 0.25 : p.z - hw), new THREE.Vector3(along ? p.x + hw : p.x + 0.25, p.floor + p.height, along ? p.z + 0.25 : p.z + hw));
    const hit = new THREE.Ray(o, d).intersectBox(b, new THREE.Vector3());
    return !!hit && hit.distanceTo(o) <= reach;
  }

  /** The eye's ray meets the closed body of a holder standing in the tent (its supply crate) within `reach` (m). */
  aimsAtCrate(o: THREE.Vector3, d: THREE.Vector3, reach: number): boolean {
    const ray = new THREE.Ray(o, d), hit = new THREE.Vector3(), b = new THREE.Box3();
    for (const p of this.crates) {
      b.min.set(p.x - p.hx, p.y, p.z - p.hz);
      b.max.set(p.x + p.hx, p.y + p.h, p.z + p.hz);
      if (ray.intersectBox(b, hit) && hit.distanceTo(o) <= reach) return true;
    }
    return false;
  }

  /** The holders standing in the tent (their closed bodies are drawn; they open once the district is built). */
  get crates(): readonly PropPlacement[] { return this.cratesIn ??= tentProps(this.layout, this.box).filter(p => isContainerKind(p.kind)); }
  private cratesIn: PropPlacement[] | null = null;

  /** Out of the scene, its own geometry released (the materials are the world's: shared, kept). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    for (const g of this.owned.splice(0)) g.dispose();
    this.lightSet = null;
  }
}

/** The tent's props: those standing in its box (level 0). */
export function tentProps(layout: Pick<StationLayout, 'props'>, box: THREE.Box3): PropPlacement[] {
  return layout.props.filter(p => (p.level ?? 0) === 0 && p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z);
}

/** Box geometry for a frame trim piece (centre, size), as the builder's addBox. */
function trimBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const b = new THREE.BoxGeometry(sx, sy, sz);
  b.translate(cx, cy, cz);
  return b;
}

/**
 * The staged tent of `layout`'s district, as BUILD STEPS (core/pacedBuild.ts; run in the sealed car / tube). Null: the district has no tent
 * (or no look plan). The look plan, the collision levels and the decay field it computes are the district's own (memoized / primed: the
 * district's build reuses them, no work twice).
 */
export function* buildTentShellSteps(layout: StationLayout, deps: TentShellDeps): BuildSteps<TentShell | null> {
  const now = deps.now ?? (() => performance.now()), t0 = now();
  const S = layout.surface;
  if (!S) return null;
  yield 'tent.plan';
  const lp = yield* surfaceLookPlanSteps(layout);
  const T = lp?.tent;
  if (!lp || !T) return null;
  const box = tentStageBox(layout, T.base);
  if (!box) return null;
  const mats = deps.mats;
  const levels = stationLevels(layout), g0 = layout.grid, W = g0.w;
  const cols = new LevelColumns(levels);
  const surf = SurfaceArch.for(layout, mats, levels);
  if (!surf) return null;
  const stats: TentShellStats = {faces: 0, floors: 0, ceilings: 0, trims: 0, kit: 0, crate: 0, skipped: [], meshes: 0, triangles: 0, lamps: 0, props: 0, ms: 0, view: null, frames: 0, sealedMax: 0};
  const root = new THREE.Group();
  root.name = 'surface-tent-shell';
  const owned: THREE.BufferGeometry[] = [];
  const acc = new Map<string, Accum>();
  const A = (k: string): Accum => { let a = acc.get(k); if (!a) acc.set(k, (a = new Accum())); return a; };
  const scaleOf = (k: string) => surf.scale(k) ?? mats.scale[k as keyof typeof mats.scale] ?? {u: 1, v: 1};
  const matOf = (k: string): THREE.Material => surf.material(k) ?? mats.get(k as Parameters<WorldMaterials['get']>[0]);

  // the district's decay field (grime, wear: the shared materials read it): made now and handed to the build (world/decay.ts primeDecayField)
  yield 'tent.decay';
  decayWorldMaterials(mats);
  const field = yield* buildDecayFieldSteps(layout, levels);
  setDecayField(field);
  primeDecayField(layout, field);

  yield 'tent.walls';
  const c0 = TENT_SHELL.marginCells;
  const win = {x0: Math.max(0, Math.floor(box.min.x / CELL) - c0), y0: Math.max(0, Math.floor(box.min.z / CELL) - c0), x1: Math.min(W, Math.ceil(box.max.x / CELL) + c0), y1: Math.min(g0.h, Math.ceil(box.max.z / CELL) + c0)};
  const extracted = yield* extractWallFacesSteps(layout, levels, cols, {tileLowerHeight: mats.tileLowerHeight, window: win});
  const slack = TENT_SHELL.faceSlack;
  const near = (f: BuiltFace) => Math.max(f.x0, f.x1) >= box.min.x - slack && Math.min(f.x0, f.x1) <= box.max.x + slack && Math.max(f.z0, f.z1) >= box.min.z - slack && Math.min(f.z0, f.z1) <= box.max.z + slack
    && f.y1 >= box.min.y && f.y0 <= box.max.y;
  const faces = surf.remapFaces(extracted.filter(near)).filter(near);
  for (const f of faces) {
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const plane = alongX ? f.z0 : f.x0;
    const s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
    const nSign = alongX ? f.nz : f.nx;
    const m = scaleOf(f.finish), sink: Sink = A(f.finish);
    stats.faces++;
    if (f.slope) { wallQuad(sink, m, alongX, plane, nSign, s0, s1, f.slope.b0, f.slope.b1, f.slope.t0, f.slope.t1, f.vb0, f.vb1); continue; }
    // (as the builder: the solid parts between the openings, full height, and over them, the lintels)
    const parts: [number, number, number][] = [];
    let pos = 0;
    for (const o of [...f.openings].sort((p, q) => p.s0 - q.s0)) {
      if (o.s0 > pos + 1e-6) parts.push([pos, o.s0, f.y0]);
      if (o.top < f.y1 - 1e-4) parts.push([o.s0, o.s1, Math.max(f.y0, o.top)]);
      pos = Math.max(pos, o.s1);
    }
    if (s1 - s0 > pos + 1e-6) parts.push([pos, s1 - s0, f.y0]);
    for (const [p0, p1, yb] of parts) for (const [a, b] of chunkSpans(s0 + p0, s0 + p1)) wallQuad(sink, m, alongX, plane, nSign, a, b, yb, yb, f.y1, f.y1, f.vb0, f.vb1);
  }

  yield 'tent.floors';
  // the floor of the tent's cells (and its doorway's), by the builder's rule: the arch's floor key, at the cell's own floor, merged per row
  const tentDoors = layout.doors.filter(d => lp.tentAreas.has(d.a) || lp.tentAreas.has(d.b));
  const doorCells = new Set<number>();
  for (const d of tentDoors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCells.add(y * W + x);
  const L0 = levels.findIndex(l => l.id === 0), g = levels[Math.max(0, L0)].grid;
  const floorKey = (i: number): string | null => {
    if (!lp.tentAreas.has(g.area[i]) && !doorCells.has(i)) return null;
    if (g.rampIdx[i] >= 0 || !cols.has(i, Math.max(0, L0))) return null;
    const c = g.cells[i];
    if (c !== FLOOR && c !== VOID) return null;
    const f = g.floorOf(i);
    for (let k = 0; k < cols.count(i); k++) { const M = cols.level(i, k); if (M !== Math.max(0, L0) && Math.abs(cellCeil(levels[M].grid, i) - f) < 0.02) return null; }
    return surf.floorKey(Math.max(0, L0), i);
  };
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1;) {
      const i = y * W + x, key = floorKey(i);
      if (!key) { x++; continue; }
      const f = g.floorOf(i);
      let e = x + 1;
      while (e < win.x1 && floorKey(y * W + e) === key && Math.abs(g.floorOf(y * W + e) - f) < 1e-4) e++;
      const m = scaleOf(key), a = A(key), x0 = x * CELL, x1 = e * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
      for (const [xa, xb] of chunkSpans(x0, x1)) a.quad([[xa, f, z0], [xa, f, z1], [xb, f, z1], [xb, f, z0]], [0, 1, 0], [[xa / m.u, -z0 / m.v], [xa / m.u, -z1 / m.v], [xb / m.u, -z1 / m.v], [xb / m.u, -z0 / m.v]]);
      stats.floors++;
      x = e;
    }
  }
  // the doorway's soffit (the builder's door rects: the arch's door ceiling key at the opening head) and its frame (the trim boxes)
  const trims: THREE.BufferGeometry[] = [];
  let trimKey: string | null = null;
  for (const d of tentDoors) {
    const a = layout.areas[d.a], b = layout.areas[d.b], i = d.y * W + d.x, df = g.floorOf(i);
    const dk = surf.doorCeilKey(0, a, b);
    if (dk) {
      const dy = df === 0 ? df + d.height : g.ceil[i];
      const m = scaleOf(dk), x0 = d.x * CELL, z0 = d.y * CELL, x1 = (d.x + d.w) * CELL, z1 = (d.y + d.h) * CELL;
      A(dk).quad([[x0, dy, z0], [x1, dy, z0], [x1, dy, z1], [x0, dy, z1]], [0, -1, 0], [[x0 / m.u, z0 / m.v], [x1 / m.u, z0 / m.v], [x1 / m.u, z1 / m.v], [x0 / m.u, z1 / m.v]]);
      stats.ceilings++;
    }
    if (d.shopfront || (d as {noFrame?: boolean}).noFrame || d.w > 1 && d.h > 1) continue;
    trimKey ??= surf.doorTrimKey(0, a);
    const h = df === 0 ? d.height : Math.min(d.height, (g.hasCeil(i) ? g.ceil[i] : df + d.height) - df), ft = 0.09, fd = CELL + 0.06;
    if (d.h === 1) {
      const z = (d.y + 0.5) * CELL, xa = d.x * CELL, xb = (d.x + d.w) * CELL;
      trims.push(trimBox(xa + ft / 2, df + h / 2, z, ft, h, fd), trimBox(xb - ft / 2, df + h / 2, z, ft, h, fd), trimBox((xa + xb) / 2, df + h - 0.05, z, xb - xa, 0.1, fd));
    } else {
      const x = (d.x + 0.5) * CELL, za = d.y * CELL, zb = (d.y + d.h) * CELL;
      trims.push(trimBox(x, df + h / 2, za + ft / 2, fd, h, ft), trimBox(x, df + h / 2, zb - ft / 2, fd, h, ft), trimBox(x, df + h - 0.05, (za + zb) / 2, fd, 0.1, zb - za));
    }
  }
  yield 'tent.meshes';
  for (const [k, a] of acc) {
    const geo = a.geometry();
    if (!geo) continue;
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, matOf(k));
    mesh.name = `surface-tent-shell-${k}`;
    mesh.userData.level = 0;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  if (trims.length && trimKey) {
    const geo = mergeGeometries(trims, false);
    for (const t of trims) t.dispose();
    if (geo) {
      owned.push(geo);
      const mesh = new THREE.Mesh(geo, matOf(trimKey));
      mesh.name = `surface-tent-shell-trim`;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      stats.trims = trims.length;
    }
  }

  yield 'tent.roof';
  const flapPivot = surf.buildTentInto(root); // (the roof, gables, guy lines, poles and the flap: the arch's own meshes, closed)
  for (const m of surf.meshes) owned.push(m.geometry as THREE.BufferGeometry);
  if (flapPivot) { flapPivot.updateMatrix(); flapPivot.updateMatrixWorld(true); }

  yield 'tent.kit';
  // the kit standing in the tent (its own procedural meshes, instanced) and the crate's closed body; anything else in it is left out (listed)
  const props = tentProps(layout, box);
  stats.props = props.length;
  const byKind = new Map<string, PropPlacement[]>();
  for (const p of props) { const l = byKind.get(p.kind); if (l) l.push(p); else byKind.set(p.kind, [p]); }
  const noModel = () => 0;
  for (const [kind, list] of byKind) {
    if (isContainerKind(kind as PropPlacement['kind'])) {
      const src = deps.crates;
      let made = false;
      try {
        const m = src?.model(kind);
        if (m) for (const part of [...m.body, ...m.closed]) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          list.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + (p.lift ?? 0), p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1))));
          im.name = `surface-tent-shell-${kind}`;
          im.computeBoundingSphere();
          root.add(im);
          made = true;
        }
      } catch (err) { console.warn(`tent shell: the ${kind} could not be shown`, err); }
      if (made) stats.crate += list.length; else stats.skipped.push(kind);
      continue;
    }
    if (isSurfaceKind(kind as PropPlacement['kind'])) {
      const before = root.children.length;
      stats.kit += buildSurfaceKitProp(root, kind as never, list, mats, noModel as never, {}, layout);
      // (the kit's instanced meshes keep their geometry with the shell: released with it)
      for (const o of root.children.slice(before)) { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) owned.push(im.geometry); }
      continue;
    }
    stats.skipped.push(kind);
  }

  yield 'tent.collision';
  const L = levelsOf(layout);
  const flapPlan = planSurfaceDoors(S, layout.levels?.find(l => l.id === 0)?.grid ?? g0, layout.levels).find(p => p.tent && p.leaves.length > 0) ?? null;
  let flapBoxes: PropPlacement[] = [];
  if (flapPlan) {
    const d: SurfaceDoorState = {plan: flapPlan, t: 0, target: 0, auto: false, openedAt: NaN, clear: 0, push: 0, blocked: false, boxes: doorBoxes(flapPlan), gas: false};
    fitDoorBoxes(d);
    flapBoxes = d.boxes;
  }
  const index = new PropIndex(L, [...props, ...flapBoxes]);
  // the lamps: the district's virtual ridge lamps over the map table and the landing, brightest first
  const lamps = layout.lights.filter(l => l.virtual && box.containsPoint(new THREE.Vector3(l.x, l.y, l.z))).sort((a, b) => b.power - a.power).map(l => ({x: l.x, y: l.y, z: l.z}));
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    stats.meshes++;
    const geo = m.geometry as THREE.BufferGeometry;
    stats.triangles += ((geo.index?.count ?? geo.attributes.position?.count ?? 0) / 3) * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
  });
  deps.markShadows?.(root, true);
  root.updateMatrixWorld(true);
  stats.ms = now() - t0;
  return new TentShell(layout, root, box, L, index, flapPlan, flapBoxes, lamps, stats, owned);
}
