// Iteration 14 (primary): the rendering warm-up — a reusable step of the loading pipeline (user: "it feels like shader
// compilation stutter ... it becomes silky smooth after a little bit ... we need to have a warm up step as part of loading
// screen"; then: "make sure that this will cover our future assets too ... a proper pipeline"; and "when I load a new
// station the stutters come back"). The contract for new content is in docs/rendering-warmup.md.
//
// What is cold without it (three r186 WebGPURenderer):
//  - every new material / geometry-layout combination builds its TSL node graph in JS on first draw, and every
//    InstancedMesh (and instanced Sprite) gets its OWN node build (the object uuid is part of three's cache key);
//  - the backend then creates the GPU pipeline synchronously (WebGPU createRenderPipeline / a WebGL2 program link);
//  - the flashlight shadow pass compiles a shadow variant per caster the first time the lit torch sees it;
//  - textures upload (and mip) on first use; the fog march / temporal / composite, the output transform and the
//    viewmodel overlay compile on the first real frame;
//  - three's caches are reference-counted: disposing the last user of a node build / pipeline / program frees it, so a
//    station rebuild that disposes the old zombies' materials, glow and instanced meshes before the new station draws
//    makes the new station compile them all again (Game.newStation now retires those after the new warm-up).
// The station renders behind the title only for the spawn view, and the level / fog culler (world/levelCulling.ts)
// keeps everything out of sight off the camera layers, so all of that landed in the first minute of every station.
//
// The warm-up (Game.prepareGraphics, before control returns: first load, New station, Retry, a quality change):
//  1. materials: `renderer.compileAsync` (three's async node build + async pipeline creation, yields between objects)
//     over ONE representative per three cache-key group (material, geometry layout, instancing, skinning, shadow
//     flags) DISCOVERED from the real scene graph — whatever the loaders / builders put there, so ordinary new assets
//     need no change here — with the real camera, into the SAME render target the game draws the station into (the
//     atmosphere scene pass, or the direct path's framebuffer target): three keys node builds and pipelines by that
//     render context, so compiling anywhere else would leave the real pipelines cold. Culled / off-frustum
//     representatives go on the camera layers, unculled, for the call only; registered pools (effects hidden until
//     first use, runtime prototypes) are made visible for the call only (compileAsync draws nothing).
//  2. passes: every registered WarmupPass (e.g. the viewmodel overlay: its own scene / camera / target) the same way,
//     with its hidden-until-used roots visible for the call.
//  3. shadows: a few REAL frames through the game's own render path (scene pass + flashlight shadow pass + fog passes +
//     output + overlay composite) with the canvas hidden and the torch lit, each showing one chunk of casters
//     (unculled), so every caster's shadow variant compiles.
//     Task studio-performance-recorder-20261103 (lane RENDER-CPU): pooled casters too, a shadow receiver in every chunk (three
//     draws a shadow map only when a receiver draws), and in 'full' every other renderable once (its own render objects); stage 1
//     compiles at the scene pass's render-context CALL DEPTH (host.sceneDepth, render/renderContextDepth.ts).
//  4. view: everything is restored exactly (layers, visibility, frustum flags, render target, MRT, torch), the culler
//     re-runs, the fog history is dropped and one normal frame renders the real view; then the canvas shows.
// Bounded: chunks, a wall-time budget (checked between chunks; a running chunk always finishes so the renderer state is
// never left mid-compile) and cancellation (station replaced / device lost). Partial / failed / cancelled results are
// reported as such, never as ready. Nothing here touches gameplay: no update tick, no AI / physics / loot / battery /
// flare timers, no sounds; the game loop does not render while it runs (Game.warming).
//
// On a software rasterizer (llvmpipe & co. JIT every program into system RAM: the iteration-13 QA saw Firefox pass
// 6 GiB walking into new views) only the camera's neighbourhood is warmed ('view'); hardware GPUs get everything
// ('full'). `?warmup=off|view|full` overrides.

import * as THREE from 'three';
import {CULL_LAYER} from '../world/levelCulling';
import {compileAtDepth} from './renderContextDepth';

export type WarmupMode = 'full' | 'view' | 'off';
export type WarmupStatus = 'complete' | 'partial' | 'cancelled' | 'failed' | 'skipped';
export type WarmupStage = 'materials' | 'passes' | 'shadows' | 'view';

type Renderable = THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;

// ---------------------------------------------------------------------------------------------
// Registration (the extension point for new render passes / effects; see docs/rendering-warmup.md)

/**
 * A render pass with its OWN scene / camera / render target (the station scene pass is built in). Register one for
 * every new pass that draws objects (e.g. the viewmodel overlay) — compiling its objects in any other context would
 * leave its real pipelines cold.
 */
export interface WarmupPass {
  /** Unique name (registering the same name again replaces it); shown in the progress text. */
  name: string;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The render target this pass draws its scene into, read at warm-up time (null = the canvas / framebuffer path). */
  target(): unknown;
  /** Roots hidden until used (held items, flashes): made visible for the compile only. */
  hidden?(): readonly THREE.Object3D[];
}

/**
 * The warm-up's registry. Ordinary assets need nothing here (they are discovered in the scene). Register:
 *  - `addPass`: a new render pass with its own scene / camera / target;
 *  - `addPool`: roots IN THE STATION SCENE holding things hidden until first use (effect pools) or runtime
 *    prototypes of things created on use (a hidden instance built by the same factory, kept in the scene).
 */
export class WarmupRegistry {
  private readonly passMap = new Map<string, WarmupPass>();
  private readonly poolMap = new Map<string, () => readonly THREE.Object3D[]>();

  addPass(pass: WarmupPass): void {
    if (!pass.name) throw new Error('WarmupRegistry.addPass: a pass needs a name');
    this.passMap.set(pass.name, pass);
  }

  addPool(name: string, roots: () => readonly THREE.Object3D[]): void {
    if (!name) throw new Error('WarmupRegistry.addPool: a pool needs a name');
    this.poolMap.set(name, roots);
  }

  get passes(): readonly WarmupPass[] {
    return [...this.passMap.values()];
  }

  /** Every registered pool root right now. */
  poolRoots(): THREE.Object3D[] {
    return [...this.poolMap.values()].flatMap(f => [...f()]);
  }

  get names(): {passes: string[]; pools: string[]} {
    return {passes: [...this.passMap.keys()], pools: [...this.poolMap.keys()]};
  }
}

// ---------------------------------------------------------------------------------------------
// Discovery

export interface WarmItem {
  object: Renderable;
  /** Hidden objects (the renderable and / or its ancestors inside a pool) made visible for the compile only. */
  flips: THREE.Object3D[];
  /**
   * Casts the flashlight shadow: gets a hidden shadow frame (task studio-performance-recorder-20261103, lane RENDER-CPU: pooled ones too,
   * their hidden chain flipped for that frame — an InstancedMesh's shadow variant is its own node build, like its scene one).
   */
  caster: boolean;
}

export interface WarmupPlan {
  mode: 'full' | 'view';
  /** One representative per cache-key group. */
  items: WarmItem[];
  /** Every renderable under the root (their layers / visibility / frustum flags are snapshotted and restored). */
  renderables: Renderable[];
  /** Distinct groups seen. */
  groups: number;
  /** Renderables not needed: covered by a representative, hidden outside a pool, other layer, no geometry, out of range. */
  skipped: number;
  /**
   * Lane RENDER-CPU: the eligible renderables a representative already covers (same cache-key group). Their node builds are shared,
   * but three still creates each one's OWN render objects (material cache key, bindings, uniform buffers, its geometry's GPU buffers)
   * the first time it draws, in every pass; 'full' mode draws them once through the real hidden frames too.
   */
  others: WarmItem[];
}

export const isRenderable = (o: THREE.Object3D): o is Renderable =>
  !!((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite);

/** three r186 RenderObject.getGeometryCacheKey, structurally (attribute layout, morph targets, index). */
export function geometryKey(g: THREE.BufferGeometry | undefined): string {
  if (!g) return 'nogeo';
  let k = '';
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name] as THREE.BufferAttribute & THREE.InterleavedBufferAttribute;
    k += `${name}:${a.data ? a.data.stride : ''}:${a.offset ?? ''}:${a.itemSize}:${a.normalized ? 'n' : ''},`;
  }
  const morph = g.morphAttributes as Record<string, Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>>;
  for (const name of Object.keys(morph).sort()) k += `morph-${name}:${morph[name].map(a => (a as THREE.BufferAttribute).id).join('.')},`;
  return g.index ? `${k}index` : k;
}

/**
 * Cache-key groups an object's draws fall into: a SUPERSET of three's key (material identity instead of its property
 * hash, so two equal materials are two groups — the second compiles as a cache hit).
 */
export function warmKeys(o: Renderable): string[] {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
  const mats = (Array.isArray(m) ? m : [m]).filter(x => x && x.visible !== false);
  const kind = (o as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : (o as THREE.InstancedMesh).isInstancedMesh ? 'inst'
    : (o as THREE.Sprite).isSprite ? 'sprite' : (o as THREE.Points).isPoints ? 'points' : (o as THREE.LineSegments).isLineSegments ? 'segs'
      : (o as THREE.Line).isLine ? 'line' : 'mesh';
  // three keys every InstancedMesh (and anything drawn with count > 1) by its own uuid
  const own = (o as THREE.InstancedMesh).isInstancedMesh || ((o as {count?: number}).count ?? 1) > 1 ? o.uuid : '';
  const bones = (o as THREE.SkinnedMesh).skeleton?.bones.length ?? 0;
  const g = geometryKey(o.geometry as THREE.BufferGeometry);
  return mats.map(x => `${kind}|${x.uuid}|${g}|${own}|${bones}|${o.receiveShadow ? 1 : 0}|${o.castShadow ? 1 : 0}`);
}

export interface PlanOptions {
  mode: 'full' | 'view';
  /** Layers the camera renders (three Layers.mask). */
  cameraMask: number;
  /** Pool roots: their hidden renderables (and hidden objects between the root and them) are planned as flips. */
  pools?: readonly THREE.Object3D[];
  /** 'view' mode: only renderables whose world bounds come within `radius` of `center` (pools are always included). */
  near?: {center: THREE.Vector3; radius: number};
  /** Off-layer objects hidden by the level / fog culler count as candidates (default: 'full' mode only). */
  includeCulled?: boolean;
}

const CULLED_MASK = new THREE.Layers();
CULLED_MASK.set(CULL_LAYER);

const _sphere = new THREE.Sphere();
function worldSphere(o: Renderable): THREE.Sphere | null {
  const im = o as THREE.InstancedMesh;
  if (im.isInstancedMesh) { im.computeBoundingSphere(); return im.boundingSphere ? _sphere.copy(im.boundingSphere).applyMatrix4(o.matrixWorld) : null; }
  const g = o.geometry as THREE.BufferGeometry | undefined;
  if (!g) return null;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g.boundingSphere ? _sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld) : null;
}

/**
 * Task static-batching-warmup-20261105: distance (m) from `eye` to a renderable's world bounding sphere (0 inside it; Infinity when it
 * has none) — the warm-up's first-use order. An InstancedMesh's existing instance sphere is used as is (never recomputed here).
 */
function itemDistance(o: Renderable, eye: THREE.Vector3): number {
  const im = o as THREE.InstancedMesh;
  const s = im.isInstancedMesh && im.boundingSphere ? _sphere.copy(im.boundingSphere).applyMatrix4(o.matrixWorld) : worldSphere(o);
  return s ? Math.max(0, s.center.distanceTo(eye) - s.radius) : Infinity;
}

/** Pick the representatives (reads the scene graph; changes nothing but bounding volumes / world matrices). */
export function planWarmup(root: THREE.Object3D, opts: PlanOptions): WarmupPlan {
  const pools = new Set(opts.pools ?? []);
  const includeCulled = opts.includeCulled ?? opts.mode === 'full';
  const seen = new Set<string>();
  const items: WarmItem[] = [], renderables: Renderable[] = [], others: WarmItem[] = [];
  let skipped = 0;
  root.updateMatrixWorld(true);
  // `flips` = hidden objects on the way down inside a pool; null = blocked (hidden outside any pool)
  const walk = (o: THREE.Object3D, flips: THREE.Object3D[] | null, inPool: boolean): void => {
    const pool = inPool || pools.has(o);
    let here = flips;
    if (here && o.visible === false) here = pool ? [...here, o] : null;
    if (isRenderable(o)) {
      renderables.push(o);
      const onLayers = (o.layers.mask & opts.cameraMask) !== 0;
      const culled = o.layers.mask === CULLED_MASK.mask;
      const geo = o.geometry as THREE.BufferGeometry | undefined;
      const hasGeo = !!geo && (!!geo.attributes.position || (o as THREE.Sprite).isSprite);
      let ok = here !== null && hasGeo && (onLayers || (culled && includeCulled));
      if (ok && opts.mode === 'view' && opts.near && !pool) {
        const s = worldSphere(o);
        ok = !!s && s.center.distanceTo(opts.near.center) - s.radius <= opts.near.radius;
      }
      const fresh = ok ? warmKeys(o).filter(k => !seen.has(k)) : [];
      if (fresh.length) {
        for (const k of fresh) seen.add(k);
        items.push({object: o, flips: here ?? [], caster: o.castShadow});
      } else {
        skipped++;
        if (ok) others.push({object: o, flips: here ?? [], caster: o.castShadow});
      }
    }
    for (const c of o.children) walk(c, here, pool);
  };
  walk(root, [], false);
  return {mode: opts.mode, items, renderables, groups: seen.size, skipped, others};
}

// ---------------------------------------------------------------------------------------------
// Runner

/** The part of three's WebGPURenderer the warm-up drives (public API only). */
export interface WarmupRenderer {
  compileAsync(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null, onProgress?: ((e: {loaded: number; total: number}) => void) | null): Promise<void>;
  getRenderTarget(): unknown;
  setRenderTarget(target: unknown): void;
  getMRT(): unknown;
  setMRT(mrt: unknown): void;
}

export interface WarmupHost {
  renderer: WarmupRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  mode: 'full' | 'view';
  registry: WarmupRegistry;
  /** 'view' mode neighbourhood. */
  near?: {center: THREE.Vector3; radius: number};
  /** The render target the game draws the station into right now (atmosphere scene pass), or null (direct path). */
  sceneTarget(): unknown;
  /** The flashlight (shadow frames light it; restored after). */
  torch: THREE.SpotLight | null;
  /** Lit intensity used for the shadow frames. */
  torchIntensity: number;
  /** One real frame through the game's render path (no culler update, no gameplay). */
  frame(): void;
  /** After the restore: re-run the culler, drop the fog history, render the real view once. */
  finish(): void;
  /** Hide / show the canvas (hidden frames never flash). */
  hide(hidden: boolean): void;
  /** False once the station was replaced or the device was lost. */
  alive(): boolean;
  /**
   * Task studio-performance-recorder-20261103 (lane RENDER-CPU): the render-context CALL DEPTH the station's scene pass draws at
   * (render/renderContextDepth.ts: three keys contexts by it; the atmosphere draws the station inside its RenderPipeline = 1). The
   * station compile runs at that depth. Omitted: 0 (a top-level render: the direct path, tests).
   */
  sceneDepth?(): number;
}

export interface WarmupProgress {
  stage: WarmupStage;
  /** Units done / total across all stages (representatives + passes + shadow frames + the view frame). */
  done: number;
  total: number;
  /** Within the stage. */
  stageDone: number;
  stageTotal: number;
  /** Pass name in the 'passes' stage. */
  detail?: string;
}

export interface WarmupStageReport { done: number; total: number; ms: number }

export interface WarmupResult {
  status: WarmupStatus;
  reason: string | null;
  mode: WarmupMode;
  ms: number;
  plan: {items: number; groups: number; renderables: number; skipped: number; flipped: number; casters: number;
    /** Lane RENDER-CPU: non-representative renderables drawn once in the hidden frames ('full'; 0 otherwise). */
    others: number};
  /** The render-context call depth the station scene was compiled at (lane RENDER-CPU; 0: top level). */
  sceneDepth: number;
  /** Task static-batching-warmup-20261105: the wall-time budget it ran under (ms; a maximum, not a wait) and the stage the budget cut
   * ('partial'; null otherwise). */
  budgetMs: number;
  cutStage: WarmupStage | null;
  stages: Record<WarmupStage, WarmupStageReport>;
  passes: string[];
  pools: string[];
}

export interface WarmupOptions {
  /** Wall-time budget (ms), checked between chunks. */
  budgetMs?: number;
  /** Representatives per compileAsync call. */
  compileChunk?: number;
  /** Shadow casters per hidden frame. */
  frameChunk?: number;
  onProgress?: (p: WarmupProgress) => void;
  now?: () => number;
  /** Lets the page paint between hidden frames (rAF, or a short timeout in a background tab). */
  yieldFrame?: () => Promise<void>;
}

// Task static-batching-warmup-20261105 (user: "You mentiona a 60 limit. Lets double that to 120s"): the MAXIMUM work budget — the warm-up
// still ends as soon as its work is done; a slow CPU (a GAME72 laptop capture: 'partial' at 60 s, 37 builds left for play) gets twice
// the time before the long tail is cut.
export const WARMUP_DEFAULTS = {budgetMs: 120_000, compileChunk: 48, frameChunk: 96} as const;
/** Torch reach (m; game.ts flashlight distance): casters within it are the torch shadow's first uses. */
const TORCH_REACH = 30;

const defaultYield = (): Promise<void> => new Promise(res => {
  let done = false;
  const go = () => { if (!done) { done = true; res(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  setTimeout(go, 50);
});

function chunks<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  const k = Math.max(1, Math.floor(n));
  for (let i = 0; i < list.length; i += k) out.push(list.slice(i, i + k));
  return out;
}

interface Snap { o: THREE.Object3D; mask: number; visible: boolean; frustumCulled: boolean }
const snapshot = (objs: Iterable<THREE.Object3D>): Snap[] => [...new Set(objs)].map(o => ({o, mask: o.layers.mask, visible: o.visible, frustumCulled: o.frustumCulled}));
const restore = (s: readonly Snap[]): void => { for (const x of s) { x.o.layers.mask = x.mask; x.o.visible = x.visible; x.o.frustumCulled = x.frustumCulled; } };

/** Show exactly `chunk` (camera layers, unculled, visible incl. its flips); every other snapshotted renderable is off the camera layers. */
function only(s: readonly Snap[], chunk: readonly WarmItem[], cameraMask: number): void {
  const show = new Set<THREE.Object3D>(chunk.map(i => i.object));
  for (const x of s) {
    x.o.visible = x.visible;
    x.o.frustumCulled = show.has(x.o) ? false : x.frustumCulled;
    x.o.layers.mask = isRenderable(x.o) ? (show.has(x.o) ? cameraMask : CULLED_MASK.mask) : x.mask;
  }
  for (const i of chunk) { i.object.visible = true; for (const f of i.flips) f.visible = true; }
}

/**
 * Lane RENDER-CPU (journey follow-up): run `fn` synchronously with exactly `chunk` of `renderables` on the camera layers (unculled, its
 * hidden chain visible), then restore every snapshotted state at once (a frame drawn later sees nothing changed).
 */
export function withOnly<T>(renderables: readonly Renderable[], chunk: readonly WarmItem[], cameraMask: number, fn: () => T): T {
  const snap = snapshot([...renderables, ...chunk.flatMap(i => i.flips)]);
  try {
    only(snap, chunk, cameraMask);
    return fn();
  } finally {
    restore(snap);
  }
}

const emptyStages = (): Record<WarmupStage, WarmupStageReport> => ({
  materials: {done: 0, total: 0, ms: 0}, passes: {done: 0, total: 0, ms: 0}, shadows: {done: 0, total: 0, ms: 0}, view: {done: 0, total: 0, ms: 0},
});

export const skippedWarmup = (reason: string): WarmupResult => ({
  status: 'skipped', reason, mode: 'off', ms: 0, plan: {items: 0, groups: 0, renderables: 0, skipped: 0, flipped: 0, casters: 0, others: 0}, sceneDepth: 0,
  budgetMs: 0, cutStage: null, stages: emptyStages(), passes: [], pools: [],
});

const message = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

/**
 * Run the warm-up. Resolves (never rejects) once everything is restored; `status` says what actually happened.
 * The caller must keep the game loop from rendering until this resolves (the renderer state is in use).
 */
export async function runWarmup(host: WarmupHost, opts: WarmupOptions = {}): Promise<WarmupResult> {
  const now = opts.now ?? (() => performance.now());
  const yieldFrame = opts.yieldFrame ?? defaultYield;
  const budget = opts.budgetMs ?? WARMUP_DEFAULTS.budgetMs;
  const t0 = now();
  const r = host.renderer;
  // (lane RENDER-CPU) the context the real frame draws the station in: measured by the host before anything is changed here
  let sceneDepth = 0;
  try { sceneDepth = Math.max(0, Math.floor(host.sceneDepth?.() ?? 0)); } catch { /* unknown: top level (the previous behaviour) */ }
  const cameraMask = host.camera.layers.mask;
  const plan = planWarmup(host.scene, {mode: host.mode, cameraMask, pools: host.registry.poolRoots(), near: host.near});
  const passes = host.registry.passes;
  const torch = host.torch;
  // Task static-batching-warmup-20261105: the likely FIRST USES go first, so a budget cut drops the long tail instead — representatives:
  // the hidden pooled ones (effects, the runtime-variant pool, unshown loot batches: prepared for first use) then nearest the camera;
  // shadow casters: within torch reach first (what the first torch-lit frame draws), then pooled ones, then by distance.
  const eye = host.camera.getWorldPosition(new THREE.Vector3());
  const distOf = new Map<WarmItem, number>();
  const dist = (i: WarmItem) => { let d = distOf.get(i); if (d === undefined) distOf.set(i, (d = itemDistance(i.object, eye))); return d; };
  const items = [...plan.items].sort((a, b) => (a.flips.length ? 0 : 1) - (b.flips.length ? 0 : 1) || dist(a) - dist(b));
  const casterTier = (i: WarmItem) => (!i.flips.length && dist(i) <= TORCH_REACH ? 0 : i.flips.length ? 1 : 2);
  const casters = torch?.castShadow ? items.filter(i => i.caster).sort((a, b) => casterTier(a) - casterTier(b) || dist(a) - dist(b)) : [];
  // (lane RENDER-CPU) 'full': every other eligible renderable is drawn once in the hidden frames as well (its own render objects in the
  // real scene / shadow pass contexts; node builds are cache hits by then) — a first view in play then creates nothing
  const rest = plan.mode === 'full' ? [...plan.others].sort((a, b) => dist(a) - dist(b)) : [];
  const compileChunks = chunks(items, opts.compileChunk ?? WARMUP_DEFAULTS.compileChunk);
  const frameItems = [...casters, ...rest];
  // (lane RENDER-CPU) three draws a light's shadow map only when a RECEIVER draws (the shadow node lives in receivers' lit materials):
  // a chunk of casters that receive nothing (enemies, pickups, loot batches) never drew its shadow variants. Every chunk holds one
  // receiver (the first non-pooled one), so each chunk's casters really go through the shadow pass.
  const anchor = torch?.castShadow ? plan.items.find(i => i.object.receiveShadow && !i.flips.length) : undefined;
  const receives = (c: readonly WarmItem[]) => c.some(i => i.object.receiveShadow && !i.flips.length);
  const frameChunks = (frameItems.length ? chunks(frameItems, opts.frameChunk ?? WARMUP_DEFAULTS.frameChunk) : torch?.castShadow ? [[]] : [])
    .map(c => (anchor && c.length && !receives(c) ? [...c, anchor] : c));
  const stages = emptyStages();
  stages.materials.total = plan.items.length;
  stages.passes.total = passes.length;
  stages.shadows.total = frameChunks.length;
  stages.view.total = 1;
  const total = plan.items.length + passes.length + frameChunks.length + 1;
  let done = 0;
  const report = (stage: WarmupStage, stageDone: number, detail?: string) =>
    opts.onProgress?.({stage, done: Math.min(done, total), total, stageDone, stageTotal: stages[stage].total, detail});

  const snap = snapshot([...plan.renderables, ...plan.items.flatMap(i => i.flips), ...rest.flatMap(i => i.flips)]);
  const prevTarget = r.getRenderTarget(), prevMRT = r.getMRT();
  const torchIntensity = torch?.intensity ?? 0;
  const torchNeeds = torch?.shadow?.needsUpdate ?? false;
  let status = 'complete' as WarmupStatus; // (mutated by stop(); no control-flow narrowing)
  let reason: string | null = null;
  let stageNow: WarmupStage = 'materials', cutStage: WarmupStage | null = null;
  const stop = (): boolean => {
    if (status !== 'complete') return true;
    if (!host.alive()) { status = 'cancelled'; reason = 'station replaced or graphics device lost'; return true; }
    if (now() - t0 > budget) { status = 'partial'; cutStage = stageNow; reason = `time budget (${Math.round(budget / 1000)} s) reached in ${stageNow}`; return true; }
    return false;
  };
  const compileIn = async (target: unknown, scene: THREE.Object3D, camera: THREE.Camera, onP: ((e: {loaded: number; total: number}) => void) | null, depth = 0) => {
    r.setRenderTarget(target);
    r.setMRT(null);
    try {
      await compileAtDepth(r, depth, () => r.compileAsync(scene, camera, null, onP));
    } finally {
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMRT);
    }
  };
  try {
    // 1. station materials: async node builds + pipelines in the station's real render context
    let ts = now();
    for (const chunk of compileChunks) {
      if (stop()) break;
      only(snap, chunk, cameraMask);
      const base = stages.materials.done, n = chunk.length;
      await compileIn(host.sceneTarget(), host.scene, host.camera, e => {
        const k = e.total > 0 ? Math.floor(n * Math.min(1, e.loaded / e.total)) : 0;
        done = base + k;
        report('materials', base + k);
      }, sceneDepth);
      stages.materials.done = base + n;
      done = stages.materials.done;
      report('materials', stages.materials.done);
    }
    restore(snap);
    stages.materials.ms = now() - ts;

    // 2. registered passes (viewmodel overlay, ...) in their own render contexts, hidden roots visible for the call. Task
    //    static-batching-warmup-20261105: also after a budget cut in the materials stage (the held items are a first use within seconds
    //    of control; one call per registered pass) — only a cancelled / failed run skips them
    ts = now();
    stageNow = 'passes';
    for (const p of passes) {
      if (status === 'cancelled' || status === 'failed') break;
      if (!host.alive()) { status = 'cancelled'; reason = 'station replaced or graphics device lost'; break; }
      const own: THREE.Object3D[] = [];
      p.scene.traverse(o => { if (isRenderable(o)) own.push(o); });
      const hidden = p.hidden?.() ?? [];
      const ps = snapshot([...own, ...hidden]);
      try {
        for (const o of hidden) o.visible = true;
        for (const o of own) { o.visible = true; o.frustumCulled = false; }
        await compileIn(p.target(), p.scene, p.camera, null);
      } finally {
        restore(ps);
      }
      stages.passes.done++;
      done = stages.materials.done + stages.passes.done;
      report('passes', stages.passes.done, p.name);
    }
    stages.passes.ms = now() - ts;

    // 3. shadow casters (+ fog passes, output, overlay composite) through real hidden frames, torch lit; 'full': then every other
    //    renderable once (lane RENDER-CPU)
    stageNow = 'shadows';
    if (frameChunks.length && !stop()) {
      ts = now();
      host.hide(true);
      for (const chunk of frameChunks) {
        if (stop()) break;
        // a hidden frame compiles synchronously: announce it and let the page paint first
        report('shadows', stages.shadows.done + 1);
        await yieldFrame();
        if (stop()) break;
        only(snap, chunk, cameraMask);
        if (torch) { torch.intensity = host.torchIntensity; torch.shadow.needsUpdate = true; }
        host.frame();
        stages.shadows.done++;
        done = stages.materials.done + stages.passes.done + stages.shadows.done;
      }
      stages.shadows.ms = now() - ts;
    }
  } catch (err) {
    status = 'failed';
    reason = message(err);
  } finally {
    restore(snap);
    r.setRenderTarget(prevTarget);
    r.setMRT(prevMRT);
    if (torch) { torch.intensity = torchIntensity; torch.shadow.needsUpdate = torchNeeds; }
  }
  // 4. the real view (culler re-run, fog history dropped), then the canvas shows again
  const tv = now();
  if (host.alive()) { report('view', 1); await yieldFrame(); } // the real view frame is synchronous too
  try {
    if (host.alive()) {
      host.finish();
      stages.view.done = 1;
      done = stages.materials.done + stages.passes.done + stages.shadows.done + 1;
      report('view', 1); // (done === total only now)
    } else if (status === 'complete') { status = 'cancelled'; reason = 'station replaced or graphics device lost'; }
  } catch (err) {
    if (status === 'complete' || status === 'partial') { status = 'failed'; reason = message(err); }
  } finally {
    host.hide(false); // always (also when the shadow stage never hid it)
  }
  stages.view.ms = now() - tv;
  const names = host.registry.names;
  return {
    status, reason, mode: plan.mode, ms: now() - t0,
    plan: {items: plan.items.length, groups: plan.groups, renderables: plan.renderables.length, skipped: plan.skipped,
      flipped: plan.items.filter(i => i.flips.length).length, casters: casters.length, others: rest.length},
    sceneDepth, budgetMs: budget, cutStage, stages, passes: names.passes, pools: names.pools,
  };
}

// ---------------------------------------------------------------------------------------------
// Readiness for content added after the loading screen

/**
 * Task studio-performance-recorder-20261103 (lane RENDER-CPU): compile `items` (planWarmup representatives / others) of `scene` in
 * the station's render context WITHOUT holding frames — for preparation while the game keeps drawing (the campaign journey's next
 * station, prepared while the player rides through the tunnel). The scene is projected synchronously inside each compileAsync call
 * with exactly that chunk on the camera layers (unculled, its hidden chain visible), then restored at once, so a frame in between
 * never draws anything differently; three finishes the node builds / pipelines asynchronously. Chunks run in the given order (callers
 * put what is seen first first) until `deadline` (performance.now() ms) passes or `alive()` turns false; resolves with the items
 * compiled. Not covered here (it needs real frames): shadow-map variants.
 */
export async function compileItemsLive(renderer: WarmupRenderer, scene: THREE.Scene, camera: THREE.Camera, items: readonly WarmItem[], renderables: readonly Renderable[],
  target: unknown, depth: number, o: {chunk?: number; deadline?: number; alive?: () => boolean} = {}): Promise<number> {
  const cameraMask = camera.layers.mask;
  let done = 0;
  for (const chunk of chunks(items, o.chunk ?? WARMUP_DEFAULTS.compileChunk)) {
    if ((o.deadline !== undefined && performance.now() > o.deadline) || (o.alive && !o.alive())) break;
    const prevTarget = renderer.getRenderTarget(), prevMRT = renderer.getMRT();
    // (snapshotted per chunk: the frames in between change layers / visibility — the culler, the loot display)
    const snap = snapshot([...renderables, ...chunk.flatMap(i => i.flips)]);
    let p: Promise<void>;
    try {
      only(snap, chunk, cameraMask);
      renderer.setRenderTarget(target);
      renderer.setMRT(null);
      p = compileAtDepth(renderer, depth, () => renderer.compileAsync(scene, camera, null, null)); // (projected synchronously in here)
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setMRT(prevMRT);
      restore(snap);
    }
    await p;
    done += chunk.length;
  }
  return done;
}

/**
 * Prepare `root` (already in `scene`, HIDDEN: `root.visible = false`) in the station's render context before the
 * caller shows it. The subtree is projected synchronously inside this call (made visible + unculled only for that
 * synchronous part, then restored, so a frame in between never draws it); three then finishes the node builds /
 * pipelines asynchronously between frames (compileAsync yields per object). Resolves when ready; rejects only if three
 * does. For anything added mid-play that no registered pool / prototype covers.
 */
export function prepareObjects(renderer: WarmupRenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D, target: unknown, depth = 0): Promise<void> {
  const objs: THREE.Object3D[] = [];
  root.traverse(o => { objs.push(o); });
  const s = snapshot(objs);
  const prevTarget = renderer.getRenderTarget(), prevMRT = renderer.getMRT();
  let p: Promise<void>;
  try {
    for (const o of objs) { o.visible = true; if (isRenderable(o)) o.frustumCulled = false; }
    renderer.setRenderTarget(target);
    renderer.setMRT(null);
    p = compileAtDepth(renderer, depth, () => renderer.compileAsync(root, camera, scene, null)); // the projection runs synchronously in here (lane RENDER-CPU: at the station pass's call depth)
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setMRT(prevMRT);
    restore(s);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Loading-screen text

/** Progress text (truthful stage + counts, no GPU percentage). */
export function warmupLabel(p: WarmupProgress): string {
  const what: Record<WarmupStage, string> = {materials: 'compiling materials', passes: p.detail ?? 'render passes', shadows: 'shadows, fog and objects', view: 'first view'};
  return `Preparing graphics · ${what[p.stage]} ${p.stageDone}/${p.stageTotal}`;
}

/** Final note for a result (null when nothing needs saying). */
export function warmupNote(w: WarmupResult): string | null {
  const s = (w.ms / 1000).toFixed(1);
  switch (w.status) {
    case 'complete': return `graphics prepared in ${s} s`;
    case 'partial': return `graphics partly prepared (${w.reason}) — some first views may still hitch`;
    case 'failed': return `graphics preparation failed (${w.reason}) — first views may hitch`;
    case 'cancelled': return null;
    case 'skipped': return w.reason === 'disabled by ?warmup=off' ? 'graphics warm-up off (?warmup=off)' : null;
  }
}
