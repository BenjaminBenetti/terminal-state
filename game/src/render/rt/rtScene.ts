// Task rt-flashlight-compute-20261115-233136 (lane BVH): what the traced flashlight bounce traces — the station's opaque lit meshes
// as a two-level BVH (per-geometry BLAS + a static and a dynamic TLAS of instances), the characters as capsules, packed into the
// GPU streams of render/rt/rtFormat.ts and kept current every frame for a bounded cost.
//
// INVENTORY (no per-item lists): every Mesh / InstancedMesh under the given roots that the flashlight's shadow treats as a caster —
// all its materials lit and opaque (render/volumetric.ts litOpaque), not skinned, not a BatchedMesh, a position attribute, no
// position morph targets, no vertex displacement (a node material's positionNode: the CPU positions are not what is drawn), no
// InstancedBufferGeometry on a plain Mesh. Visible = it and every ancestor up to a root visible; an InstancedMesh contributes its
// instances [0, count) whose matrix is not degenerate. Skinned characters are not meshes here: the per-frame bodies (FlashOccluders
// .bodies: x, z, radius, y0, y1 each) are dynamic capsule instances flagged PROXY. The walk never descends into an invisible object,
// a THREE.Bone (a skeleton and what is attached to it belong to a character) or a subtree the caller's `skip` names, so the whole
// THREE.Scene can be the root (groups added after the prepare are found by the next re-inventory).
//
// PER FRAME (sync): a cheap change check per traced object (its ancestors' visibility, matrixWorld, instanceMatrix.version, its
// geometry / material / draw range / attribute versions). A moved entry is DISABLED in the static TLAS and traced from the dynamic
// TLAS (rebuilt every frame: the moving entries + the capsules); an entry resting RT_SCENE.restSeconds returns to a rebuilt static
// TLAS (coalesced: at most one rebuild per RT_SCENE.staticInterval; built across frames, RT_SCENE.staticBudgetMs a frame, over a
// snapshot of the resting entries' boxes while the current static tree stays in use; at the commit an entry that moved or went
// since the snapshot is written DISABLED and stays dynamic). A full re-inventory runs every RT_SCENE.inventoryInterval: new
// meshes get their BLAS (cached per geometry for the session: render/rt/bvh.ts) built under the frame's ms budget, never blocking —
// they trace from the dynamic TLAS until they rest into the static one; meshes gone leave at the next static rebuild (DISABLED
// meanwhile). A changed geometry keeps its old BLAS until the new one is built (rebuilt at most every RT_SCENE.rebuildInterval).
// Hard caps (constructor): what does not fit is left out and COUNTED (stats().omitted), never silently.

import * as THREE from 'three';
import {litOpaque} from '../volumetric';
import type {BuildSteps} from '../../core/pacedBuild';
import {BLAS_TRI_FLOATS, BVH_NODE_FLOATS, BlasJob, BvhBuilder, BLAS_MAX_LEAF, TLAS_MAX_LEAF, attributeVersion, blasCached, blasStore, f32Down, f32Up, type BlasBuild} from './bvh';
import {RT_INSTANCE_VEC4, RT_INST_DISABLED, RT_INST_PROXY, RT_TYPE_CAPSULE, RT_TYPE_MESH, RtSceneBuffers} from './rtFormat';
import {rtBodyAlbedo, rtMaterialRecord} from './rtMaterials';

/** Timing defaults (seconds; sync's clock). */
export const RT_SCENE = {
  /** A moved entry this long at rest returns to the static TLAS. */
  restSeconds: 1,
  /** Static TLAS rebuilds at most this often. */
  staticInterval: 0.5,
  /** Full re-inventory period. */
  inventoryInterval: 0.5,
  /** A changed geometry's BLAS is rebuilt at most this often. */
  rebuildInterval: 0.5,
  /** BLAS build work per chunk (primitive visits; about 1 ms in V8) — the budget is checked between chunks. */
  chunkWork: 40_000,
  /** prepareSteps yields after about this much BLAS work (a few ms). */
  prepareWork: 160_000,
  /** Main-thread ms a frame a pending static TLAS rebuild may use (at least one chunk of staticWork a frame). */
  staticBudgetMs: 1,
  /** Static TLAS build work per chunk (BvhBuilder work units; ~0.2 ms). */
  staticWork: 4_000,
  /** A material whose texture had not decoded is asked again after 1, 2, 4 ... up to this many re-inventories. */
  provisionalMaxWait: 64,
} as const;

export interface RtSceneOptions {
  /** Most BLAS triangles packed (default 2.5 M). */
  maxTriangles?: number;
  /** Byte caps of the two BLAS streams (default 128 MiB each: WebGPU's default storage binding limit). */
  maxBlasNodeBytes?: number;
  maxBlasTriBytes?: number;
  /** Dynamic TLAS instances (moving entries + capsules) per frame (default 1024). */
  dynamicInstanceCap?: number;
  /** Linear albedo of the capsules (default rtBodyAlbedo(): world/flashOccluders.ts bodyAlbedo). */
  bodyAlbedo?: ArrayLike<number>;
  /** Main-thread ms a frame of a pending static TLAS rebuild (default RT_SCENE.staticBudgetMs; 0: one chunk a frame). */
  staticBudgetMs?: number;
  /**
   * Subtrees the inventory never walks (true: `o` and everything under it is pruned; counted as excluded 'skipped'): the camera,
   * the effects group ... Asked of every object an inventory walk reaches (keep it cheap).
   */
  skip?: (o: THREE.Object3D) => boolean;
}

/**
 * Why a candidate is not traced (by the contract). Per mesh: 'material' (not all lit + opaque), 'skinned', 'batched', 'noPosition',
 * 'morph', 'displaced', 'customInstanced'. Per pruned SUBTREE (its meshes are not walked, so not counted one by one): 'character'
 * (a THREE.Bone and all under it — a skeleton belongs to a character, and characters are the capsules) and 'skipped' (the
 * caller's `skip`).
 */
export type RtExcludeReason = 'material' | 'skinned' | 'batched' | 'noPosition' | 'morph' | 'displaced' | 'customInstanced' | 'character' | 'skipped';
/** Why a mesh that should be traced was left out (a cap). */
export type RtOmitReason = 'triangles' | 'blasNodeBytes' | 'blasTriBytes';

export interface RtSceneStats {
  /** Packed BLAS triangles / nodes / trees, and the packed triangles no instance uses any more (garbage until compaction). */
  triangles: number;
  blasNodes: number;
  blasCount: number;
  deadTriangles: number;
  /** Traced objects (Mesh / InstancedMesh), their entries, BLAS jobs waiting, a static TLAS rebuild under way. */
  meshes: number;
  entries: number;
  pendingBuilds: number;
  staticBuildPending: boolean;
  instances: {static: number; dynamic: number; capsules: number; moving: number; hidden: number};
  materials: number;
  /** Used bytes per stream (and the allocated ones). */
  bytes: {blasNodes: number; blasTris: number; tlas: number};
  allocatedBytes: {blasNodes: number; blasTris: number; tlas: number};
  /** The last sync's main-thread time (µs) and the peak since the scene was prepared. */
  lastSyncUs: number;
  peakSyncUs: number;
  /** Left out by a cap: meshes and their triangles by reason; dynamic instances that did not fit in the last frame. */
  omitted: {meshes: Record<RtOmitReason, number>; triangles: Record<RtOmitReason, number>; dynamic: number};
  /** Not traced by the contract (the last inventory's counts of meshes). */
  excluded: Record<RtExcludeReason, number>;
  /** BLAS built by this scene: count, main-thread ms, triangles dropped as degenerate; BLAS taken from the session cache. */
  blasBuilt: number;
  blasBuildMs: number;
  degenerateTriangles: number;
  blasReused: number;
  /** prepareSteps main-thread ms (all of it, and the BLAS part). */
  prepareMs: number;
  prepareBlasMs: number;
  staticRebuilds: number;
  inventories: number;
  /** The last inventory walk: main-thread µs and the objects it reached. */
  lastInventoryUs: number;
  lastInventoryObjects: number;
  compactions: number;
}

const ST_STATIC = 0, ST_MOVING = 1, ST_HIDDEN = 2;
/** matrixWorld elements that carry an affine transform (column-major). */
const AFF = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14] as const;
const zeroOmit = (): Record<RtOmitReason, number> => ({triangles: 0, blasNodeBytes: 0, blasTriBytes: 0});
const zeroExcluded = (): Record<RtExcludeReason, number> => ({material: 0, skinned: 0, batched: 0, noPosition: 0, morph: 0, displaced: 0, customInstanced: 0, character: 0, skipped: 0});

/** A packed BLAS (global bases in the scene's streams) and how many traced objects use it. */
interface Packed { build: BlasBuild; nodeBase: number; triBase: number; refs: number; dead: boolean }

/** One traced Mesh / InstancedMesh. */
class Rec {
  readonly inst: THREE.InstancedMesh | null;
  material: THREE.Material | THREE.Material[];
  geometry: THREE.BufferGeometry;
  matCount = 1;
  useGroups = false;
  matBase = 0;
  packed: Packed | null = null;
  omitted: RtOmitReason | null = null;
  /** No triangles drawn: nothing to trace. */
  empty = false;
  entries: Entry[] = [];
  /** matrixWorld snapshot (AFF elements). */
  readonly world = new Float64Array(12);
  imVersion = -1;
  icVersion = -1;
  count = 1;
  // geometry key snapshot (cheap per-frame change check)
  posAttr: unknown = null;
  posVersion = -1;
  index: THREE.BufferAttribute | null = null;
  indexVersion = -1;
  drawStart = 0;
  drawCount = Infinity;
  /** The geometry changed since its BLAS; a job for it is queued; not before this time again. */
  geoDirty = false;
  jobQueued = false;
  nextBuildAt = -Infinity;
  hidden = false;
  forceMove = false;
  seen = 0;
  alive = true;
  /** Index in RtScene.recs. */
  slot = -1;
  constructor(readonly obj: THREE.Mesh) {
    this.inst = (obj as THREE.InstancedMesh).isInstancedMesh ? obj as THREE.InstancedMesh : null;
    this.material = obj.material;
    this.geometry = obj.geometry;
  }
}

/** One traced instance: a Mesh, or one instance of an InstancedMesh. */
class Entry {
  /** The instance matrix snapshot (column-major AFF elements of instanceMatrix), InstancedMesh only. */
  readonly local: Float64Array | null;
  /** Object -> world and world -> object, row-major 3 x 4; the world box (padded). */
  readonly m = new Float64Array(12);
  readonly w = new Float64Array(12);
  readonly box = new Float64Array(6);
  state = ST_STATIC;
  staticSlot = -1;
  movingIndex = -1;
  lastMove = -Infinity;
  tr = 1; tg = 1; tb = 1;
  constructor(readonly rec: Rec, readonly inst: number) {
    this.local = inst >= 0 ? new Float64Array(12) : null;
  }
}

/** A BLAS build in progress and the objects waiting for it. */
interface Job { geometry: THREE.BufferGeometry; matCount: number; useGroups: boolean; job: BlasJob; waiters: Rec[] }

const materialsOf = (m: THREE.Material | THREE.Material[]): number => (Array.isArray(m) ? m.length : 1);

/** Why `o` is not traced, or null when it is (the inventory contract; see the file comment). Allocation-free. */
export function rtExcludeReason(o: THREE.Object3D): RtExcludeReason | null {
  const m = o as THREE.Mesh;
  if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return 'skinned';
  if ((m as unknown as {isBatchedMesh?: boolean}).isBatchedMesh) return 'batched';
  const mat = m.material;
  if (Array.isArray(mat)) {
    if (!mat.length) return 'material';
    for (let i = 0; i < mat.length; i++) if (!litOpaque(mat[i])) return 'material';
    for (let i = 0; i < mat.length; i++) if ((mat[i] as {positionNode?: unknown}).positionNode) return 'displaced';
  } else {
    if (!litOpaque(mat)) return 'material';
    if ((mat as {positionNode?: unknown}).positionNode) return 'displaced';
  }
  const g = m.geometry;
  if (!g || !g.attributes || !g.attributes.position) return 'noPosition';
  const morph = g.morphAttributes?.position;
  if (morph && morph.length) return 'morph';
  if ((g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry && !(m as THREE.InstancedMesh).isInstancedMesh) return 'customInstanced';
  return null;
}

/** Row-major 3x4 inverse of a row-major 3x4 affine `m` into `w`; false when degenerate. */
function invertAffine(m: Float64Array, w: Float64Array): boolean {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const n0 = Math.hypot(a, d, g), n1 = Math.hypot(b, e, h), n2 = Math.hypot(c, f, i);
  if (!(Math.abs(det) > 1e-12 * n0 * n1 * n2) || !Number.isFinite(det) || det === 0) return false;
  const k = 1 / det;
  w[0] = A * k; w[1] = (c * h - b * i) * k; w[2] = (b * f - c * e) * k;
  w[4] = B * k; w[5] = (a * i - c * g) * k; w[6] = (c * d - a * f) * k;
  w[8] = C * k; w[9] = (b * g - a * h) * k; w[10] = (a * e - b * d) * k;
  const tx = m[3], ty = m[7], tz = m[11];
  w[3] = -(w[0] * tx + w[1] * ty + w[2] * tz);
  w[7] = -(w[4] * tx + w[5] * ty + w[6] * tz);
  w[11] = -(w[8] * tx + w[9] * ty + w[10] * tz);
  return true;
}

/**
 * The traced scene of one station (see the file comment). prepareSteps(roots) once (paced build steps), then sync() every frame;
 * clear() before the next station. `buffers` is what the GPU uploads (render/rt/rtFormat.ts protocol).
 */
export class RtScene {
  readonly buffers = new RtSceneBuffers();
  readonly maxTriangles: number;
  readonly maxBlasNodeBytes: number;
  readonly maxBlasTriBytes: number;
  readonly dynamicInstanceCap: number;
  readonly staticBudgetMs: number;
  private readonly bodyAlbedo: Float32Array;
  private readonly skip: ((o: THREE.Object3D) => boolean) | null;
  private roots: THREE.Object3D[] = [];
  private readonly recs: Rec[] = [];
  private readonly recOf = new Map<THREE.Object3D, Rec>();
  private readonly packedOf = new Map<BlasBuild, Packed>();
  private readonly moving: Entry[] = [];
  private readonly jobs: Job[] = [];
  private readonly blasBuilder = new BvhBuilder(BLAS_MAX_LEAF);
  private readonly staticBuilder = new BvhBuilder(TLAS_MAX_LEAF);
  private readonly dynBuilder = new BvhBuilder(TLAS_MAX_LEAF);
  private staticBounds = new Float32Array(0);
  private readonly dynBounds: Float32Array;
  /** Which body each of this frame's capsules is. */
  private readonly capsuleSrc: Int32Array;
  private staticList: Entry[] = [];
  private readonly dynList: Entry[] = [];
  private readonly walk: THREE.Object3D[] = [];
  // materials: one slot per material / per material array (slot 0 = the capsules)
  private readonly matSlot = new Map<THREE.Material, number>();
  private readonly matRun = new Map<string, number>();
  private readonly provisional: {m: THREE.Material; slot: number; at: number; wait: number}[] = [];
  private matRecords = new Float32Array(16);
  // state
  private prepared = false;
  private lastInventory = -Infinity;
  private lastStatic = -Infinity;
  /** A static rebuild under way (staticBuilder over staticList's boxes snapshotted at staticAt). */
  private staticPending = false;
  private staticAt = 0;
  private seenStamp = 0;
  /** Static slots disabled for entries hidden / removed (a rebuild drops them). */
  private staticGarbage = 0;
  private deadTris = 0;
  private dynamicStale = true;
  private lastDynamicCount = 0;
  // stats
  private st = {
    lastSyncUs: 0, peakSyncUs: 0, omitDyn: 0, blasBuilt: 0, blasBuildMs: 0, degenerate: 0, blasReused: 0, prepareMs: 0, prepareBlasMs: 0,
    staticRebuilds: 0, inventories: 0, compactions: 0, inventoryUs: 0, inventoryObjects: 0,
  };
  private omitMeshes = zeroOmit();
  private omitTris = zeroOmit();
  private excluded = zeroExcluded();

  constructor(o: RtSceneOptions = {}) {
    this.maxTriangles = o.maxTriangles ?? 2_500_000;
    this.maxBlasNodeBytes = o.maxBlasNodeBytes ?? 128 * 1024 * 1024;
    this.maxBlasTriBytes = o.maxBlasTriBytes ?? 128 * 1024 * 1024;
    this.dynamicInstanceCap = Math.max(1, o.dynamicInstanceCap ?? 1024);
    this.staticBudgetMs = Math.max(0, o.staticBudgetMs ?? RT_SCENE.staticBudgetMs);
    this.skip = o.skip ?? null;
    this.bodyAlbedo = new Float32Array(3);
    const ba = o.bodyAlbedo ?? rtBodyAlbedo();
    this.bodyAlbedo[0] = ba[0]; this.bodyAlbedo[1] = ba[1]; this.bodyAlbedo[2] = ba[2];
    this.dynBounds = new Float32Array(this.dynamicInstanceCap * 6);
    this.capsuleSrc = new Int32Array(this.dynamicInstanceCap);
    this.resetTables();
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // lifecycle

  /** Forgets the station (the session's BLAS cache stays): empty buffers, bumped versions, everything dirty. */
  clear(): void {
    for (const j of this.jobs) for (const r of j.waiters) r.jobQueued = false;
    this.jobs.length = 0;
    for (const r of this.recs) r.alive = false;
    this.recs.length = 0;
    this.recOf.clear();
    this.packedOf.clear();
    this.moving.length = 0;
    this.staticList.length = 0;
    this.dynList.length = 0;
    this.roots = [];
    this.prepared = false;
    this.lastInventory = this.lastStatic = -Infinity;
    this.staticPending = false;
    this.staticGarbage = 0;
    this.deadTris = 0;
    this.lastDynamicCount = 0;
    this.st = {lastSyncUs: 0, peakSyncUs: 0, omitDyn: 0, blasBuilt: 0, blasBuildMs: 0, degenerate: 0, blasReused: 0, prepareMs: 0, prepareBlasMs: 0, staticRebuilds: 0, inventories: 0, compactions: 0, inventoryUs: 0, inventoryObjects: 0};
    this.omitMeshes = zeroOmit();
    this.omitTris = zeroOmit();
    this.excluded = zeroExcluded();
    this.resetTables();
  }

  /** Drops the scene and its storage (the object may be prepared again). */
  dispose(): void {
    this.clear();
    const B = this.buffers;
    B.blasNodes = new Float32Array(0); B.blasNodesU32 = new Uint32Array(0);
    B.blasTris = new Float32Array(0); B.blasTrisU32 = new Uint32Array(0);
    B.blasArrayVersion++;
    this.resetTables();
  }

  private resetTables(): void {
    const B = this.buffers, L = B.layout;
    B.blasNodeCount = 0;
    B.blasTriCount = 0;
    this.matSlot.clear();
    this.matRun.clear();
    this.provisional.length = 0;
    this.matRecords = new Float32Array(16);
    this.matRecords[0] = this.bodyAlbedo[0]; this.matRecords[1] = this.bodyAlbedo[1]; this.matRecords[2] = this.bodyAlbedo[2];
    L.materialCount = 1;
    L.bodyMaterial = 0;
    L.staticNodeCount = L.staticInstanceCount = L.dynamicNodeCount = L.dynamicInstanceCount = 0;
    L.staticNodeCap = L.staticInstanceCap = L.materialCap = 0;
    L.dynamicInstanceCap = this.dynamicInstanceCap;
    L.dynamicNodeCap = 2 * this.dynamicInstanceCap;
    this.relayout(64, 64, 64);
    B.blasVersion++;
    B.dirtyBlas(0, 0, 0, 0);
    this.dynamicStale = true;
  }

  /**
   * The scene under `roots` (their matrices are brought up to date first), as paced build steps (core/pacedBuild.ts: every yield
   * may pause; labelled stages 'rt-inventory' / 'rt-blas' / 'rt-tlas'). Clears the previous station. Returns the stats.
   */
  *prepareSteps(roots: readonly THREE.Object3D[]): BuildSteps<RtSceneStats> {
    // (main-thread time of this build: the segments between its yields)
    let seg = performance.now(), total = 0;
    const pause = (): void => { total += performance.now() - seg; };
    const resume = (): void => { seg = performance.now(); };
    this.clear();
    this.roots = roots.slice();
    for (const r of this.roots) r.updateMatrixWorld();
    pause(); yield 'rt-inventory'; resume();
    yield* this.inventorySteps(-Infinity, true, pause, resume);
    const built0 = this.st.blasBuildMs;
    pause(); yield 'rt-blas'; resume();
    while (this.jobs.length) {
      const j = this.jobs[0];
      while (!j.job.run(RT_SCENE.prepareWork)) { pause(); yield; resume(); }
      this.jobs.shift();
      this.finishJob(j, -Infinity, true);
      pause(); yield; resume();
    }
    pause(); yield 'rt-tlas'; resume();
    this.rebuildStatic(-Infinity);
    this.writeDynamic(null, 0);
    this.lastInventory = -Infinity;
    this.prepared = true;
    pause();
    this.st.prepareMs = total;
    this.st.prepareBlasMs = this.st.blasBuildMs - built0;
    return this.stats();
  }

  /** prepareSteps to the end now (tests / tools). */
  prepare(roots: readonly THREE.Object3D[]): RtSceneStats {
    const g = this.prepareSteps(roots);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  /**
   * One frame: `now` (seconds, any monotonic clock), this frame's capsules (`bodies`: x, z, radius, y0, y1 each, `bodyCount` of
   * them: FlashOccluders.bodies), and the main-thread ms BLAS builds may use this frame. Bounded otherwise (see the file comment).
   */
  sync(now: number, bodies: ArrayLike<number> | null, bodyCount: number, budgetMs: number): void {
    if (!this.prepared) return;
    const t0 = performance.now();
    if (now - this.lastInventory >= RT_SCENE.inventoryInterval) {
      const g = this.inventorySteps(now, false, null, null);
      while (!g.next().done) { /* (synchronous) */ }
      this.lastInventory = now;
    }
    this.detect(now);
    // BLAS builds within the budget
    const tb = performance.now();
    while (this.jobs.length && performance.now() - tb < budgetMs) {
      const j = this.jobs[0];
      if (j.job.run(RT_SCENE.chunkWork)) { this.jobs.shift(); this.finishJob(j, now, false); }
    }
    // rested entries back into the static tree (built across frames)
    if (!this.staticPending && now - this.lastStatic >= RT_SCENE.staticInterval && (this.staticGarbage > 0 || this.anyRested(now))) this.beginStatic(now);
    if (this.staticPending) this.runStatic(now, this.staticBudgetMs);
    this.writeDynamic(bodies, bodyCount);
    const us = (performance.now() - t0) * 1000;
    this.st.lastSyncUs = us;
    if (us > this.st.peakSyncUs) this.st.peakSyncUs = us;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // inventory

  private isRoot(o: THREE.Object3D): boolean {
    const R = this.roots;
    for (let i = 0; i < R.length; i++) if (R[i] === o) return true;
    return false;
  }

  /** It and every ancestor up to a root visible (false: hidden or no longer under a root). */
  private visibleChain(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (!p.visible) return false;
      if (this.isRoot(p)) return true;
    }
    return false;
  }

  /**
   * The full walk: new meshes are taken in (their BLAS from the cache or queued), meshes no longer found (or failing the contract)
   * leave. `initial`: the prepare's entries are static at once. pause / resume: prepareSteps' timing around its yields.
   */
  private *inventorySteps(now: number, initial: boolean, pause: (() => void) | null, resume: (() => void) | null): Generator<void, void, void> {
    const stamp = ++this.seenStamp, W = this.walk, ex = zeroExcluded(), skip = this.skip;
    let t0 = performance.now(), ms = 0, objects = 0;
    W.length = 0;
    for (const r of this.roots) if (r.visible) W.push(r);
    let n = 0;
    while (W.length) {
      const o = W.pop()!;
      objects++;
      if ((o as THREE.Bone).isBone) { ex.character++; continue; } // (a skeleton: a character's, and characters are the capsules)
      if (skip !== null && skip(o)) { ex.skipped++; continue; }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) if (ch[i].visible) W.push(ch[i]);
      if (!(o as THREE.Mesh).isMesh) continue;
      const why = rtExcludeReason(o);
      const rec = this.recOf.get(o);
      if (why) {
        ex[why]++;
        if (rec) this.removeRec(rec);
        continue;
      }
      if (rec) { rec.seen = stamp; continue; }
      const r = this.addRec(o as THREE.Mesh, now, initial);
      r.seen = stamp;
      if (pause && ++n % 128 === 0) { ms += performance.now() - t0; pause(); yield; resume?.(); t0 = performance.now(); }
    }
    // gone (not found under a visible root)
    for (let i = this.recs.length - 1; i >= 0; i--) if (this.recs[i].seen !== stamp) this.removeRec(this.recs[i]);
    // provisional material colours (an image decoded since; asked again after 1, 2, 4 ... re-inventories)
    const inv = this.st.inventories;
    for (let i = this.provisional.length - 1; i >= 0; i--) {
      const p = this.provisional[i];
      if (inv < p.at) continue;
      const ok = {ok: false};
      const rec = rtMaterialRecord(p.m, ok);
      if (ok.ok) { this.writeMaterial(p.slot, rec); this.provisional.splice(i, 1); }
      else { p.wait = Math.min(p.wait * 2, RT_SCENE.provisionalMaxWait); p.at = inv + p.wait; }
    }
    this.excluded = ex;
    this.st.inventories++;
    this.st.inventoryUs = (ms + performance.now() - t0) * 1000; // (the walk's own time, without the paused gaps)
    this.st.inventoryObjects = objects;
  }

  private addRec(o: THREE.Mesh, now: number, initial: boolean): Rec {
    const rec = new Rec(o);
    rec.slot = this.recs.length;
    this.recs.push(rec);
    this.recOf.set(o, rec);
    this.snapshotKey(rec);
    rec.matCount = materialsOf(o.material);
    rec.useGroups = Array.isArray(o.material);
    rec.matBase = this.materialBase(o.material);
    rec.count = rec.inst ? rec.inst.count : 1;
    this.requestBlas(rec, now, initial);
    return rec;
  }

  private removeRec(rec: Rec): void {
    if (!rec.alive) return;
    rec.alive = false;
    for (const e of rec.entries) this.hide(e);
    rec.entries.length = 0;
    this.release(rec);
    const last = this.recs.pop()!;
    if (last !== rec) { this.recs[rec.slot] = last; last.slot = rec.slot; }
    this.recOf.delete(rec.obj);
  }

  private snapshotKey(rec: Rec): void {
    const g = rec.obj.geometry, pos = g.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    rec.geometry = g;
    rec.posAttr = pos ?? null;
    rec.posVersion = attributeVersion(pos);
    rec.index = g.index;
    rec.indexVersion = g.index ? g.index.version : -1;
    rec.drawStart = g.drawRange.start;
    rec.drawCount = g.drawRange.count;
  }

  /** The traced object's BLAS: the session cache's (attached now) or a queued build (the current one, if any, stays meanwhile). */
  private requestBlas(rec: Rec, now: number, initial: boolean): void {
    rec.geoDirty = false;
    const g = rec.geometry;
    const hit = blasCached(g, rec.matCount, rec.useGroups);
    if (hit) { this.st.blasReused++; this.attach(rec, hit, now, initial); return; }
    if (rec.jobQueued) { rec.geoDirty = true; return; }
    rec.nextBuildAt = now + RT_SCENE.rebuildInterval;
    rec.jobQueued = true;
    for (const j of this.jobs) {
      if (j.geometry === g && j.matCount === rec.matCount && j.useGroups === rec.useGroups) { j.waiters.push(rec); return; }
    }
    this.jobs.push({geometry: g, matCount: rec.matCount, useGroups: rec.useGroups, job: new BlasJob(g, rec.matCount, rec.useGroups, this.blasBuilder), waiters: [rec]});
  }

  private finishJob(j: Job, now: number, initial: boolean): void {
    const b = j.job.result!;
    blasStore(j.geometry, b);
    this.st.blasBuilt++;
    this.st.blasBuildMs += b.buildMs;
    this.st.degenerate += b.dropped;
    for (const r of j.waiters) {
      r.jobQueued = false;
      if (!r.alive || r.geometry !== j.geometry) continue;
      this.attach(r, b, now, initial);
    }
  }

  /** Traces `rec` with `build` (packed now; a cap that does not fit leaves it out, counted). */
  private attach(rec: Rec, build: BlasBuild, now: number, initial: boolean): void {
    if (rec.packed && rec.packed.build === build) return;
    const p = this.pack(build);
    if (!p.packed) {
      // a cap: the object is left out (its old BLAS too: what is traced must be what is drawn)
      const why = p.reason!;
      if (rec.omitted !== why) { this.omitMeshes[why]++; this.omitTris[why] += build.triCount; }
      rec.omitted = why;
      for (const e of rec.entries) this.hide(e);
      rec.entries.length = 0;
      this.release(rec);
      return;
    }
    this.release(rec);
    rec.omitted = null;
    rec.packed = p.packed;
    if (p.packed.refs++ === 0 && p.packed.dead) { p.packed.dead = false; this.deadTris -= build.triCount; } // (used again before a compaction)
    rec.empty = build.triCount === 0;
    if (rec.empty) {
      for (const e of rec.entries) this.hide(e);
      rec.entries.length = 0;
      return;
    }
    this.captureWorld(rec);
    if (rec.entries.length === 0) {
      if (!initial && !this.visibleChain(rec.obj)) rec.hidden = true; // (hidden since it was found: its entries wait)
      this.makeEntries(rec, initial);
    } else if (!rec.hidden) for (const e of rec.entries) this.moved(e, now); // (a new shape: its box changed; hidden: when shown)
  }

  private release(rec: Rec): void {
    const p = rec.packed;
    if (!p) return;
    rec.packed = null;
    if (--p.refs === 0) { p.dead = true; this.deadTris += p.build.triCount; }
  }

  private captureWorld(rec: Rec): void {
    const e = rec.obj.matrixWorld.elements, w = rec.world;
    for (let k = 0; k < 12; k++) w[k] = e[AFF[k]];
    if (rec.inst) {
      rec.imVersion = rec.inst.instanceMatrix.version;
      rec.icVersion = rec.inst.instanceColor ? rec.inst.instanceColor.version : -1;
    }
  }

  private makeEntries(rec: Rec, initial: boolean): void {
    const n = rec.inst ? rec.inst.count : 1;
    rec.count = n;
    for (let i = 0; i < n; i++) this.addEntry(rec, rec.inst ? i : -1, initial);
  }

  private addEntry(rec: Rec, inst: number, initial: boolean): void {
    const e = new Entry(rec, inst);
    rec.entries.push(e);
    if (e.local) this.captureLocal(e);
    this.readTint(e);
    e.state = ST_HIDDEN;
    if (rec.hidden || !this.compose(e)) return; // (a degenerate instance: hidden until it moves; a hidden object: until shown)
    e.state = initial ? ST_STATIC : ST_MOVING;
    // (a new entry has not moved: it is traced from the dynamic tree only until the next static rebuild takes it)
    e.lastMove = -Infinity;
    if (!initial) this.pushMoving(e);
  }

  private captureLocal(e: Entry): void {
    const a = e.rec.inst!.instanceMatrix.array, o = e.inst * 16, l = e.local!;
    for (let k = 0; k < 12; k++) l[k] = a[o + AFF[k]];
  }

  private readTint(e: Entry): void {
    const ic = e.rec.inst?.instanceColor;
    if (ic && e.inst >= 0) { const a = ic.array, o = e.inst * 3; e.tr = a[o]; e.tg = a[o + 1]; e.tb = a[o + 2]; }
    else { e.tr = e.tg = e.tb = 1; }
  }

  /** The entry's object -> world (world snapshot x instance snapshot), world -> object and padded world box; false: degenerate. */
  private compose(e: Entry): boolean {
    const W = e.rec.world, M = e.m;
    // world snapshot is column-major AFF: W[0..2] = column 0, W[3..5] = column 1, W[6..8] = column 2, W[9..11] = translation
    if (e.local) {
      const L = e.local;
      for (let r = 0; r < 3; r++) {
        const w0 = W[r], w1 = W[3 + r], w2 = W[6 + r];
        M[r * 4] = w0 * L[0] + w1 * L[1] + w2 * L[2];
        M[r * 4 + 1] = w0 * L[3] + w1 * L[4] + w2 * L[5];
        M[r * 4 + 2] = w0 * L[6] + w1 * L[7] + w2 * L[8];
        M[r * 4 + 3] = w0 * L[9] + w1 * L[10] + w2 * L[11] + W[9 + r];
      }
    } else {
      for (let r = 0; r < 3; r++) { M[r * 4] = W[r]; M[r * 4 + 1] = W[3 + r]; M[r * 4 + 2] = W[6 + r]; M[r * 4 + 3] = W[9 + r]; }
    }
    if (!invertAffine(M, e.w)) return false;
    // world box of the BLAS root box (centre / half extent through |M|), padded for the f32 W round trip
    const N = e.rec.packed!.build.nodes, B = e.box;
    const cx = (N[0] + N[4]) * 0.5, cy = (N[1] + N[5]) * 0.5, cz = (N[2] + N[6]) * 0.5;
    const hx = (N[4] - N[0]) * 0.5, hy = (N[5] - N[1]) * 0.5, hz = (N[6] - N[2]) * 0.5;
    for (let r = 0; r < 3; r++) {
      const m0 = M[r * 4], m1 = M[r * 4 + 1], m2 = M[r * 4 + 2];
      const c = m0 * cx + m1 * cy + m2 * cz + M[r * 4 + 3];
      const h = Math.abs(m0) * hx + Math.abs(m1) * hy + Math.abs(m2) * hz;
      const pad = 1e-6 * (Math.abs(c) + h) + 1e-6;
      B[r] = c - h - pad; B[r + 3] = c + h + pad;
    }
    return Number.isFinite(B[0] + B[1] + B[2] + B[3] + B[4] + B[5]);
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // per frame

  private detect(now: number): void {
    const R = this.recs;
    // (siblings are mostly adjacent in recs: the last parent's chain visibility is reused)
    let lastParent: THREE.Object3D | null | undefined, lastParentOk = false;
    for (let i = 0; i < R.length; i++) {
      const rec = R[i], o = rec.obj;
      if (!rec.packed || rec.empty) {
        // (waiting for its BLAS or left out by a cap: nothing to do; nothing drawn: only a new geometry matters)
        if (rec.omitted !== null || rec.jobQueued) continue;
        if (rec.empty && this.keyChanged(rec)) { this.snapshotKey(rec); rec.geoDirty = true; }
        if (rec.geoDirty && now >= rec.nextBuildAt) this.requestBlas(rec, now, false);
        continue;
      }
      let vis: boolean;
      if (!o.visible) vis = false;
      else if (this.isRoot(o)) vis = true;
      else {
        const p = o.parent;
        if (p !== lastParent) { lastParent = p; lastParentOk = p !== null && this.visibleChain(p); }
        vis = lastParentOk;
      }
      if (!vis) {
        if (!rec.hidden) { rec.hidden = true; for (let k = 0; k < rec.entries.length; k++) this.hide(rec.entries[k]); }
        continue;
      }
      if (rec.hidden) { rec.hidden = false; rec.forceMove = true; }
      const keyChanged = this.keyChanged(rec);
      if (keyChanged || o.material !== rec.material || (rec.inst !== null && rec.inst.count !== rec.count)) {
        if (keyChanged) { this.snapshotKey(rec); rec.geoDirty = true; }
        this.revalidate(rec, now);
        if (!rec.alive) { i--; continue; }
      }
      if (rec.geoDirty && !rec.jobQueued && now >= rec.nextBuildAt) this.requestBlas(rec, now, false);
      // matrices
      const me = o.matrixWorld.elements, ws = rec.world;
      let wc = rec.forceMove;
      if (!wc) for (let k = 0; k < 12; k++) if (me[AFF[k]] !== ws[k]) { wc = true; break; }
      if (wc) for (let k = 0; k < 12; k++) ws[k] = me[AFF[k]];
      const im = rec.inst;
      if (im) {
        const vc = im.instanceMatrix.version !== rec.imVersion || rec.forceMove;
        if (wc || vc) {
          rec.imVersion = im.instanceMatrix.version;
          const a = im.instanceMatrix.array, E = rec.entries;
          for (let k = 0; k < E.length; k++) {
            const e = E[k], l = e.local!, off = e.inst * 16;
            let ch = wc;
            for (let q = 0; q < 12; q++) { const v = a[off + AFF[q]]; if (v !== l[q]) { l[q] = v; ch = true; } }
            if (ch) this.moved(e, now);
          }
        }
        const ic = im.instanceColor;
        if (ic && ic.version !== rec.icVersion) {
          rec.icVersion = ic.version;
          for (let k = 0; k < rec.entries.length; k++) {
            const e = rec.entries[k];
            this.readTint(e);
            if (e.state === ST_STATIC && e.staticSlot >= 0) this.writeTint(e);
          }
        }
      } else if (wc && rec.entries.length) this.moved(rec.entries[0], now);
      rec.forceMove = false;
    }
  }

  private keyChanged(rec: Rec): boolean {
    const g = rec.obj.geometry;
    if (g !== rec.geometry) return true;
    const pos = g.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (pos !== rec.posAttr || attributeVersion(pos) !== rec.posVersion) return true;
    if (g.index !== rec.index || (g.index !== null && g.index.version !== rec.indexVersion)) return true;
    return g.drawRange.start !== rec.drawStart || g.drawRange.count !== rec.drawCount;
  }

  /** A traced object whose material / geometry / instance count changed: still traced? new material slots, a new BLAS, entries. */
  private revalidate(rec: Rec, now: number): void {
    const o = rec.obj;
    if (rtExcludeReason(o)) { this.removeRec(rec); return; }
    if (o.material !== rec.material) {
      const groups = Array.isArray(o.material), count = materialsOf(o.material);
      rec.material = o.material;
      rec.matBase = this.materialBase(o.material);
      if (groups !== rec.useGroups || count !== rec.matCount) { rec.useGroups = groups; rec.matCount = count; rec.geoDirty = true; }
      for (const e of rec.entries) if (e.state === ST_STATIC && e.staticSlot >= 0) this.writeStaticInstance(e, e.staticSlot);
    }
    if (rec.geoDirty && !rec.jobQueued && now >= rec.nextBuildAt) this.requestBlas(rec, now, false);
    if (rec.inst && rec.packed && !rec.empty && rec.inst.count !== rec.count) {
      const n = rec.inst.count;
      while (rec.entries.length > n) this.hide(rec.entries.pop()!);
      this.captureWorld(rec);
      for (let i = rec.entries.length; i < n; i++) this.addEntry(rec, i, false);
      rec.count = n;
    }
  }

  private pushMoving(e: Entry): void {
    if (e.movingIndex >= 0) return;
    e.movingIndex = this.moving.length;
    this.moving.push(e);
  }

  private dropMoving(e: Entry): void {
    const i = e.movingIndex;
    if (i < 0) return;
    const last = this.moving.pop()!;
    if (last !== e) { this.moving[i] = last; last.movingIndex = i; }
    e.movingIndex = -1;
  }

  private moved(e: Entry, now: number): void {
    if (!this.compose(e)) { this.hide(e); return; }
    if (e.state === ST_STATIC && e.staticSlot >= 0) this.disableSlot(e.staticSlot);
    if (e.state !== ST_MOVING) { e.state = ST_MOVING; this.pushMoving(e); }
    e.lastMove = now;
  }

  private hide(e: Entry): void {
    if (e.state === ST_HIDDEN) return;
    if (e.staticSlot >= 0) {
      if (e.state === ST_STATIC) this.disableSlot(e.staticSlot);
      this.staticGarbage++;
    }
    if (e.state === ST_MOVING) this.dropMoving(e);
    e.state = ST_HIDDEN;
  }

  private anyRested(now: number): boolean {
    const M = this.moving, rest = RT_SCENE.restSeconds;
    for (let i = 0; i < M.length; i++) if (now - M[i].lastMove >= rest) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // packing

  /** The scene's copy of `build` (appended now), or the cap it does not fit. */
  private pack(build: BlasBuild): {packed: Packed | null; reason: RtOmitReason | null} {
    const have = this.packedOf.get(build);
    if (have) return {packed: have, reason: null};
    const B = this.buffers;
    const nodes = B.blasNodeCount + build.nodeCount, tris = B.blasTriCount + build.triCount;
    if (tris > this.maxTriangles) return {packed: null, reason: 'triangles'};
    if (nodes * BVH_NODE_FLOATS * 4 > this.maxBlasNodeBytes) return {packed: null, reason: 'blasNodeBytes'};
    if (tris * BLAS_TRI_FLOATS * 4 > this.maxBlasTriBytes) return {packed: null, reason: 'blasTriBytes'};
    this.ensureBlas(nodes, tris);
    const nodeBase = B.blasNodeCount, triBase = B.blasTriCount;
    this.copyBlas(build, nodeBase, triBase);
    B.blasNodeCount = nodes;
    B.blasTriCount = tris;
    B.dirtyBlas(nodeBase, nodes, triBase, tris);
    const p: Packed = {build, nodeBase, triBase, refs: 0, dead: false};
    this.packedOf.set(build, p);
    return {packed: p, reason: null};
  }

  private copyBlas(build: BlasBuild, nodeBase: number, triBase: number): void {
    const B = this.buffers, N = B.blasNodes, NU = B.blasNodesU32, src = build.nodes, srcU = new Uint32Array(src.buffer, src.byteOffset, src.length);
    N.set(src, nodeBase * BVH_NODE_FLOATS);
    for (let k = 0; k < build.nodeCount; k++) {
      const f = (nodeBase + k) * BVH_NODE_FLOATS, s = k * BVH_NODE_FLOATS;
      NU[f + 3] = srcU[s + 3] + (srcU[s + 7] === 0 ? nodeBase : triBase);
    }
    B.blasTris.set(build.tris, triBase * BLAS_TRI_FLOATS);
  }

  private ensureBlas(nodes: number, tris: number): void {
    const B = this.buffers;
    if (B.blasNodes.length < nodes * BVH_NODE_FLOATS) {
      const cap = Math.min(Math.floor(this.maxBlasNodeBytes / 4 / BVH_NODE_FLOATS), Math.max(nodes, Math.ceil(B.blasNodes.length / BVH_NODE_FLOATS * 1.5), 4096));
      const a = new Float32Array(cap * BVH_NODE_FLOATS);
      a.set(B.blasNodes.subarray(0, B.blasNodeCount * BVH_NODE_FLOATS));
      B.blasNodes = a; B.blasNodesU32 = new Uint32Array(a.buffer);
      B.blasArrayVersion++;
      B.dirtyBlas(0, B.blasNodeCount, 0, 0);
    }
    if (B.blasTris.length < tris * BLAS_TRI_FLOATS) {
      const cap = Math.min(Math.floor(this.maxBlasTriBytes / 4 / BLAS_TRI_FLOATS), Math.max(tris, Math.ceil(B.blasTris.length / BLAS_TRI_FLOATS * 1.5), 4096));
      const a = new Float32Array(cap * BLAS_TRI_FLOATS);
      a.set(B.blasTris.subarray(0, B.blasTriCount * BLAS_TRI_FLOATS));
      B.blasTris = a; B.blasTrisU32 = new Uint32Array(a.buffer);
      B.blasArrayVersion++;
      B.dirtyBlas(0, 0, 0, B.blasTriCount);
    }
  }

  /** Re-packs only the BLAS still used (when the dead ones waste a quarter and more): every base moves, everything is dirty. */
  private compactIfWasteful(): void {
    const B = this.buffers;
    if (this.deadTris < 65536 || this.deadTris < B.blasTriCount * 0.25) return;
    const live: Packed[] = [];
    for (const p of this.packedOf.values()) if (p.refs > 0) live.push(p);
    this.packedOf.clear();
    let nodes = 0, tris = 0;
    for (const p of live) { p.nodeBase = nodes; p.triBase = tris; nodes += p.build.nodeCount; tris += p.build.triCount; this.packedOf.set(p.build, p); }
    B.blasNodeCount = B.blasTriCount = 0;
    for (const p of live) this.copyBlas(p.build, p.nodeBase, p.triBase);
    B.blasNodeCount = nodes;
    B.blasTriCount = tris;
    B.dirtyBlas(0, nodes, 0, tris);
    this.deadTris = 0;
    this.st.compactions++;
    this.dynamicStale = true;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // materials

  /** The first material slot of a material / material array (one run per distinct array; slot 0 is the capsules'). */
  private materialBase(m: THREE.Material | THREE.Material[]): number {
    if (!Array.isArray(m)) return this.materialSlotOf(m);
    if (m.length === 1) return this.materialSlotOf(m[0]);
    let key = '';
    for (let i = 0; i < m.length; i++) key += (i ? ',' : '') + m[i].uuid;
    const have = this.matRun.get(key);
    if (have !== undefined) return have;
    const base = this.buffers.layout.materialCount;
    for (let i = 0; i < m.length; i++) this.newMaterial(m[i]);
    this.matRun.set(key, base);
    return base;
  }

  private materialSlotOf(m: THREE.Material): number {
    const have = this.matSlot.get(m);
    if (have !== undefined) return have;
    const s = this.newMaterial(m);
    this.matSlot.set(m, s);
    return s;
  }

  private newMaterial(m: THREE.Material): number {
    const L = this.buffers.layout, slot = L.materialCount;
    if (slot >= L.materialCap) this.relayout(L.staticInstanceCap, L.staticNodeCap, Math.ceil((slot + 1) * 1.5 / 64) * 64);
    L.materialCount = slot + 1;
    const ok = {ok: false};
    const rec = rtMaterialRecord(m, ok);
    if (!ok.ok) this.provisional.push({m, slot, at: 0, wait: 1});
    this.writeMaterial(slot, rec);
    return slot;
  }

  private writeMaterial(slot: number, rec: readonly number[]): void {
    const B = this.buffers, L = B.layout;
    if (this.matRecords.length < (slot + 1) * 4) { const a = new Float32Array(Math.max((slot + 1) * 4, this.matRecords.length * 2)); a.set(this.matRecords); this.matRecords = a; }
    const MR = this.matRecords;
    MR[slot * 4] = rec[0]; MR[slot * 4 + 1] = rec[1]; MR[slot * 4 + 2] = rec[2];
    new Uint32Array(MR.buffer, slot * 16 + 12, 1)[0] = rec[3] >>> 0;
    const f = (L.materials + slot) * 4;
    B.tlas[f] = rec[0]; B.tlas[f + 1] = rec[1]; B.tlas[f + 2] = rec[2]; B.tlasU32[f + 3] = rec[3] >>> 0;
    B.dirtyTlas(L.materials + slot, L.materials + slot + 1);
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // the tlas stream

  /** Sets the region capacities (grow only) and re-lays the tlas stream out (copying what is in it; everything dirty). */
  private relayout(staticInstanceCap: number, staticNodeCap: number, materialCap: number): void {
    const B = this.buffers, L = B.layout;
    const old = {...L}, oldT = B.tlas;
    L.staticInstanceCap = Math.max(L.staticInstanceCap, staticInstanceCap);
    L.staticNodeCap = Math.max(L.staticNodeCap, staticNodeCap, 2 * L.staticInstanceCap);
    L.materialCap = Math.max(L.materialCap, materialCap);
    L.staticNodes = 0;
    L.dynamicNodes = L.staticNodes + 2 * L.staticNodeCap;
    L.instances = L.dynamicNodes + 2 * L.dynamicNodeCap;
    L.dynamicInstances = L.instances + RT_INSTANCE_VEC4 * L.staticInstanceCap;
    L.materials = L.dynamicInstances + RT_INSTANCE_VEC4 * L.dynamicInstanceCap;
    L.vec4Count = L.materials + L.materialCap;
    const T = new Float32Array(L.vec4Count * 4);
    if (oldT.length) {
      T.set(oldT.subarray(old.staticNodes * 4, (old.staticNodes + 2 * old.staticNodeCount) * 4), L.staticNodes * 4);
      T.set(oldT.subarray(old.instances * 4, (old.instances + RT_INSTANCE_VEC4 * old.staticInstanceCount) * 4), L.instances * 4);
    }
    T.set(this.matRecords.subarray(0, L.materialCount * 4), L.materials * 4);
    B.tlas = T;
    B.tlasU32 = new Uint32Array(T.buffer);
    B.layoutVersion++;
    B.tlasDirtyCount = 0;
    B.dirtyTlas(0, L.vec4Count);
    this.dynamicStale = true; // (its leaves address the moved instance region)
  }

  private disableSlot(slot: number): void {
    const B = this.buffers, v = B.layout.instances + RT_INSTANCE_VEC4 * slot + 3;
    B.tlasU32[v * 4 + 2] |= RT_INST_DISABLED;
    B.dirtyTlas(v, v + 1);
  }

  private writeTint(e: Entry): void {
    const B = this.buffers, v = B.layout.instances + RT_INSTANCE_VEC4 * e.staticSlot + 4, f = v * 4;
    B.tlas[f] = e.tr; B.tlas[f + 1] = e.tg; B.tlas[f + 2] = e.tb;
    B.dirtyTlas(v, v + 1);
  }

  /** A mesh instance record at vec4 `v` (see rtFormat.ts). */
  private writeMeshRecord(e: Entry, v: number): void {
    const B = this.buffers, T = B.tlas, TU = B.tlasU32, f = v * 4, W = e.w;
    for (let k = 0; k < 12; k++) T[f + k] = W[k];
    TU[f + 12] = e.rec.packed!.nodeBase; TU[f + 13] = e.rec.matBase; TU[f + 14] = 0; TU[f + 15] = RT_TYPE_MESH;
    T[f + 16] = e.tr; T[f + 17] = e.tg; T[f + 18] = e.tb; T[f + 19] = 0;
    T[f + 20] = T[f + 21] = T[f + 22] = T[f + 23] = 0;
  }

  private writeStaticInstance(e: Entry, slot: number): void {
    const v = this.buffers.layout.instances + RT_INSTANCE_VEC4 * slot;
    this.writeMeshRecord(e, v);
    this.buffers.dirtyTlas(v, v + RT_INSTANCE_VEC4);
  }

  /** Writes a built TLAS's nodes at vec4 `base` (leaf A + `instBase`: the region's first global instance index). */
  private writeTree(b: BvhBuilder, base: number, instBase: number): void {
    const B = this.buffers, T = B.tlas, TU = B.tlasU32, N = b.nodes, NU = b.nodesU32;
    const f0 = base * 4, n = b.nodeCount * BVH_NODE_FLOATS;
    T.set(N.subarray(0, n), f0);
    if (instBase !== 0) for (let k = 0; k < b.nodeCount; k++) { const s = k * BVH_NODE_FLOATS; if (NU[s + 7] !== 0) TU[f0 + s + 3] = NU[s + 3] + instBase; }
  }

  /** A whole static TLAS rebuild now (the prepare). */
  private rebuildStatic(now: number): void {
    this.beginStatic(now);
    this.staticBuilder.run(Infinity);
    this.commitStatic(now);
  }

  /**
   * Starts a static TLAS rebuild over every static entry and every moving one at rest (their boxes snapshotted now). The current
   * static tree stays in use (and its slots current) until commitStatic.
   */
  private beginStatic(now: number): void {
    const rest = RT_SCENE.restSeconds, R = this.recs, list = this.staticList;
    list.length = 0;
    for (let i = 0; i < R.length; i++) {
      const E = R[i].entries;
      for (let k = 0; k < E.length; k++) {
        const e = E[k];
        if (e.state === ST_HIDDEN || (e.state === ST_MOVING && now - e.lastMove < rest)) continue;
        list.push(e);
      }
    }
    const n = list.length;
    if (this.staticBounds.length < n * 6) this.staticBounds = new Float32Array(Math.max(n * 6, this.staticBounds.length * 2));
    const SB = this.staticBounds;
    for (let i = 0; i < n; i++) {
      const b = list[i].box, o = i * 6;
      SB[o] = f32Down(b[0]); SB[o + 1] = f32Down(b[1]); SB[o + 2] = f32Down(b[2]);
      SB[o + 3] = f32Up(b[3]); SB[o + 4] = f32Up(b[4]); SB[o + 5] = f32Up(b[5]);
    }
    this.staticBuilder.begin(SB, n);
    this.staticPending = true;
    this.staticAt = now;
  }

  /** Continues the pending static build for about `budgetMs` (at least one chunk); commits it when it finishes. */
  private runStatic(now: number, budgetMs: number): void {
    const tb = this.staticBuilder, t0 = performance.now();
    do {
      if (tb.run(RT_SCENE.staticWork)) { this.commitStatic(now); return; }
    } while (performance.now() - t0 < budgetMs);
  }

  /**
   * The finished static build replaces the static TLAS: a snapshotted entry still unmoved since the snapshot is written (a resting
   * moving one becomes static); one that moved, hid or went since is written DISABLED (it stays dynamic / gone; counted as garbage
   * for the next rebuild). Compaction (when wasteful) happens here, as every static record is rewritten.
   */
  private commitStatic(now: number): void {
    this.staticPending = false;
    this.compactIfWasteful();
    const tb = this.staticBuilder, list = this.staticList, n = list.length, at = this.staticAt, R = this.recs;
    const B = this.buffers, L = B.layout;
    if (n > L.staticInstanceCap || tb.nodeCount > L.staticNodeCap) {
      const cap = Math.ceil(Math.max(n, 1) * 1.25 / 64) * 64;
      L.staticNodeCount = L.staticInstanceCount = 0; // (nothing to keep: rewritten below)
      this.relayout(cap, 2 * cap, L.materialCap);
    }
    // (the old tree's slots end here)
    for (let i = 0; i < R.length; i++) { const E = R[i].entries; for (let k = 0; k < E.length; k++) E[k].staticSlot = -1; }
    this.writeTree(tb, L.staticNodes, 0);
    const O = tb.order, T = B.tlas, TU = B.tlasU32;
    let garbage = 0;
    for (let k = 0; k < n; k++) {
      const e = list[O[k]], v = L.instances + RT_INSTANCE_VEC4 * k;
      if (e.state === ST_MOVING && e.lastMove <= at && e.rec.alive) { this.dropMoving(e); e.state = ST_STATIC; }
      if (e.state === ST_STATIC && e.rec.alive) {
        e.staticSlot = k;
        this.writeMeshRecord(e, v);
      } else {
        e.staticSlot = -1;
        const f = v * 4;
        for (let q = 0; q < RT_INSTANCE_VEC4 * 4; q++) T[f + q] = 0;
        TU[f + 14] = RT_INST_DISABLED; TU[f + 15] = RT_TYPE_MESH;
        garbage++;
      }
    }
    L.staticNodeCount = tb.nodeCount;
    L.staticInstanceCount = n;
    B.dirtyTlas(L.staticNodes, L.staticNodes + 2 * tb.nodeCount);
    B.dirtyTlas(L.instances, L.instances + RT_INSTANCE_VEC4 * n);
    this.staticGarbage = garbage;
    this.lastStatic = now;
    this.st.staticRebuilds++;
    list.length = 0; // (drop the references)
  }

  /** This frame's dynamic TLAS: the capsules, then the moving entries (up to the cap; the rest counted as omitted). */
  private writeDynamic(bodies: ArrayLike<number> | null, bodyCount: number): void {
    const B = this.buffers, L = B.layout, cap = this.dynamicInstanceCap, DB = this.dynBounds, D = this.dynList;
    let nb = 0, omitted = 0;
    // capsules: x, z, radius, y0, y1 (kept: radius > 0, y1 > y0, finite)
    const caps = bodies ? Math.max(0, bodyCount | 0) : 0;
    D.length = 0;
    for (let i = 0; i < caps; i++) {
      const x = bodies![i * 5], z = bodies![i * 5 + 1], r = bodies![i * 5 + 2], y0 = bodies![i * 5 + 3], y1 = bodies![i * 5 + 4];
      if (!(r > 0) || !(y1 > y0) || !Number.isFinite(x + z + r + y0 + y1)) continue;
      if (nb >= cap) { omitted++; continue; }
      const o = nb * 6;
      DB[o] = f32Down(x - r); DB[o + 1] = f32Down(y0); DB[o + 2] = f32Down(z - r);
      DB[o + 3] = f32Up(x + r); DB[o + 4] = f32Up(y1); DB[o + 5] = f32Up(z + r);
      this.capsuleSrc[nb] = i;
      nb++;
    }
    const M = this.moving;
    let n = nb;
    for (let i = 0; i < M.length; i++) {
      if (n >= cap) { omitted += M.length - i; break; }
      const b = M[i].box, o = n * 6;
      DB[o] = f32Down(b[0]); DB[o + 1] = f32Down(b[1]); DB[o + 2] = f32Down(b[2]);
      DB[o + 3] = f32Up(b[3]); DB[o + 4] = f32Up(b[4]); DB[o + 5] = f32Up(b[5]);
      D.push(M[i]);
      n++;
    }
    this.st.omitDyn = omitted;
    if (n === 0) {
      if (this.lastDynamicCount !== 0 || this.dynamicStale) { L.dynamicNodeCount = 0; L.dynamicInstanceCount = 0; B.tlasVersion++; }
      this.lastDynamicCount = 0;
      this.dynamicStale = false;
      return;
    }
    const db = this.dynBuilder;
    db.begin(DB, n);
    db.run(Infinity);
    const instBase = (L.dynamicInstances - L.instances) / RT_INSTANCE_VEC4;
    this.writeTree(db, L.dynamicNodes, instBase);
    const O = db.order, T = B.tlas, TU = B.tlasU32;
    for (let k = 0; k < n; k++) {
      const p = O[k], v = L.dynamicInstances + RT_INSTANCE_VEC4 * k;
      if (p < nb) {
        const i = this.capsuleSrc[p], f = v * 4;
        T[f] = 1; T[f + 1] = 0; T[f + 2] = 0; T[f + 3] = 0;
        T[f + 4] = 0; T[f + 5] = 1; T[f + 6] = 0; T[f + 7] = 0;
        T[f + 8] = 0; T[f + 9] = 0; T[f + 10] = 1; T[f + 11] = 0;
        TU[f + 12] = 0; TU[f + 13] = L.bodyMaterial; TU[f + 14] = RT_INST_PROXY; TU[f + 15] = RT_TYPE_CAPSULE;
        T[f + 16] = bodies![i * 5]; T[f + 17] = bodies![i * 5 + 1]; T[f + 18] = bodies![i * 5 + 2]; T[f + 19] = bodies![i * 5 + 3];
        T[f + 20] = bodies![i * 5 + 4]; T[f + 21] = T[f + 22] = T[f + 23] = 0;
      } else this.writeMeshRecord(D[p - nb], v);
    }
    L.dynamicNodeCount = db.nodeCount;
    L.dynamicInstanceCount = n;
    B.dirtyTlas(L.dynamicNodes, L.dynamicNodes + 2 * db.nodeCount);
    B.dirtyTlas(L.dynamicInstances, L.dynamicInstances + RT_INSTANCE_VEC4 * n);
    this.lastDynamicCount = n;
    this.dynamicStale = false;
    D.length = 0;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // stats

  stats(): RtSceneStats {
    const B = this.buffers, L = B.layout;
    let entries = 0, hidden = 0;
    for (const r of this.recs) for (const e of r.entries) { entries++; if (e.state === ST_HIDDEN) hidden++; }
    let capsules = 0;
    const instBase = (L.dynamicInstances - L.instances) / RT_INSTANCE_VEC4;
    for (let k = 0; k < L.dynamicInstanceCount; k++) if (B.tlasU32[(L.instances + RT_INSTANCE_VEC4 * (instBase + k)) * 4 + 15] === RT_TYPE_CAPSULE) capsules++;
    let packedBlas = 0;
    for (const p of this.packedOf.values()) if (p.refs > 0) packedBlas++;
    return {
      triangles: B.blasTriCount, blasNodes: B.blasNodeCount, blasCount: packedBlas, deadTriangles: this.deadTris,
      meshes: this.recs.filter(r => r.packed && !r.empty).length, entries, pendingBuilds: this.jobs.length, staticBuildPending: this.staticPending,
      instances: {static: L.staticInstanceCount, dynamic: L.dynamicInstanceCount, capsules, moving: this.moving.length, hidden},
      materials: L.materialCount,
      bytes: {blasNodes: B.blasNodeCount * BVH_NODE_FLOATS * 4, blasTris: B.blasTriCount * BLAS_TRI_FLOATS * 4, tlas: L.vec4Count * 16},
      allocatedBytes: {blasNodes: B.blasNodes.byteLength, blasTris: B.blasTris.byteLength, tlas: B.tlas.byteLength},
      lastSyncUs: this.st.lastSyncUs, peakSyncUs: this.st.peakSyncUs,
      omitted: {meshes: {...this.omitMeshes}, triangles: {...this.omitTris}, dynamic: this.st.omitDyn},
      excluded: {...this.excluded},
      blasBuilt: this.st.blasBuilt, blasBuildMs: this.st.blasBuildMs, degenerateTriangles: this.st.degenerate, blasReused: this.st.blasReused,
      prepareMs: this.st.prepareMs, prepareBlasMs: this.st.prepareBlasMs,
      staticRebuilds: this.st.staticRebuilds, inventories: this.st.inventories, compactions: this.st.compactions,
      lastInventoryUs: this.st.inventoryUs, lastInventoryObjects: this.st.inventoryObjects,
    };
  }

  /** The traced object of a Mesh / InstancedMesh (tests / QA): its entries' states and static slots. */
  debugEntries(o: THREE.Object3D): {state: 'static' | 'moving' | 'hidden'; staticSlot: number; inst: number}[] | null {
    const r = this.recOf.get(o);
    if (!r) return null;
    return r.entries.map(e => ({state: e.state === ST_STATIC ? 'static' : e.state === ST_MOVING ? 'moving' : 'hidden', staticSlot: e.staticSlot, inst: e.inst}));
  }
}
