// Task studio-surface-host-ground-connectors-20261118-053602-01 (lane READY). User: "Own the remaining Subway transition concern as part of
// the same access system … Merely forcing a gate open on partial is NOT proof the seamless requirement is solved. Diagnose and address the
// first-visible exit/ready handoff and relevant preparation paths … A successful exit needs a built, playable first view that can actually
// be drawn; any noncritical background compile must be truthful and not strand the player."
//
// What was wrong: a crossing (the Surface Run cargo lift; the Office / Mall on-foot connectors share this) opened its exit once the
// destination's WHOLE journey compile (render/journeyCompile.ts) ended, or its bound ran out. That compile is renderer.compileAsync — on a
// software rasterizer it only links a program (llvmpipe JITs each variant at its FIRST DRAW) — and it leaves every covered object's own
// render objects to the first frame that draws it. While the car is sealed nothing of the destination is drawn (liftRuntime.ts
// drawSealed), so the door-open frame was the first real draw of the whole first view: Firefox on llvmpipe blocked ~160 s on that one
// frame (the parent task's spot check; an environment observation, not a hardware timing). On hardware the analogue is the first open
// frame creating whatever compileAsync had not finished (pipelines) or never does (render objects of the covered objects).
//
// The readiness is now the exit's FIRST VIEW, drawn before the exit opens:
//  - planFirstView: what a frame can draw from the exit — every renderable within FIRST_VIEW.radius of it (turning, walking out; culled
//    ones too), plus everything the level culler (world/levelCulling.ts) puts on the camera's layers for a stand-in camera at the exit at
//    FIRST_VIEW.yaws x pitches (any direction; within the camera's far plane), plus what is on them now — grouped like the warm-up's
//    representatives (render/warmup.ts warmKeys: one per program group; nearest the exit first) and the rest, and its flashlight-shadow
//    casters within the torch's reach. Planning reads the scene and the culler's decisions only: the sweep's layers are put back for the
//    game camera before each step returns (no frame ever sees them). planFirstViewSteps + inFrameStep give each sweep yaw its own frame;
//    the caller shows what the exit's first frame will show before planning (the loot batches near it: world/containers.ts showFrom).
//  - The journey compile's 'view' lane draws that set OFF-SCREEN in the scene pass's own render context, time-sliced (items per draw
//    adapted to the measured draw), ending with one hidden frame of the real view; its stats say where it is (firstView, view counts).
//  - waitForFirstView: the caller's bounded wait — 'ready', or 'partial' with the why (the active-time budget, or no first-view progress
//    for the stall period), or 'cancelled' (the job ended without it). Never indefinite, never a silent open: the caller reports a partial.
//  - The REST of the job (everything else the destination may draw later) goes on after the exit opens, in the journey's play pacing
//    (JourneyCompile.pace(null)), reported truthfully (firstViewRest: what is left).
// Without a scene pass target (the direct path: quality 'off' / no volumetric pass) nothing can be drawn off-screen — an off-screen draw
// would land on the canvas — so the first view is COMPILED only and says so (stats.viewDrawn false; the wait's why).

import * as THREE from 'three';
import {CULL_LAYER} from '../world/levelCulling';
import type {FrameScheduler} from '../core/frameBudget';
import {JOURNEY_COMPILE, type JourneyCompileStats} from './journeyCompile';
import {sharedInstancing} from './sharedInstancing';
import {isRenderable, warmKeys, type WarmItem} from './warmup';

/** Where the player comes out of a crossing: the eye (world m) and, optionally, the yaw they face (rad, the game's yaw). */
export interface CrossingExit { x: number; y: number; z: number; yaw?: number }

/** How a crossing's first-view wait ended ('ready': built and drawn; 'partial' / 'cancelled': `why`). */
export interface CrossingViewResult { end: 'ready' | 'partial' | 'cancelled'; why: string }

export const FIRST_VIEW = {
  /** Every eligible renderable within this distance (m) of the exit is in the first view (any yaw; the first steps out). */
  radius: 24,
  /** The culler sweep at the exit: yaws around (from the exit's yaw) and pitches (rad). */
  yaws: 8,
  pitches: [-0.9, 0, 0.9] as readonly number[],
  /** Flashlight-shadow casters within this distance (m) of the exit (render/warmup.ts TORCH_REACH: the torch's reach). */
  torchReach: 30,
} as const;

/** The level culler as the sweep uses it. */
export interface FirstViewSweep {
  /** Decide for `camera` (a stand-in at the exit): the scene's layers then show what a frame from it would draw. */
  update(camera: THREE.Camera): void;
  /** The game camera's decisions back (called once after the sweep, also when it threw). */
  restore(): void;
}

export interface FirstViewPlanOptions {
  exit: CrossingExit;
  /** Layers the game camera renders. */
  cameraMask: number;
  /** The game camera: the sweep's stand-in copies its lens; its far plane bounds what a frame can draw. */
  camera: THREE.PerspectiveCamera;
  /** The near radius (default FIRST_VIEW.radius). */
  radius?: number;
  /** The level culler (null: none — the near radius and what is on the camera's layers now). */
  sweep?: FirstViewSweep | null;
  /** Plan the first view's flashlight-shadow casters too (the torch casts a shadow at this quality). */
  casters?: boolean;
  /** Group instanced pools as three builds them (default: render/sharedInstancing.ts sharedInstancing()). */
  shareInstanced?: boolean;
  /** Clock (ms; default performance.now). */
  now?: () => number;
}

export interface FirstViewPlan {
  /** One per program group of the first view, nearest the exit first. */
  reps: WarmItem[];
  /** The rest of the first view (their programs are the representatives'), nearest first. */
  others: WarmItem[];
  /** The first view's shadow casters within the torch's reach, nearest first (empty without `casters`). */
  casters: WarmItem[];
  stats: {
    /** Eligible renderables (shown, with geometry, on the camera's layers or culled); within the far plane of the exit. */
    candidates: number; inRange: number;
    /** In the first view: by the near radius, by the culler sweep (beyond the radius), on the camera's layers now (neither). */
    near: number; swept: number; current: number;
    items: number; reps: number; casters: number;
    /** Sweep poses decided, the sweep's ms, the whole plan's ms. */
    poses: number; sweepMs: number; ms: number;
  };
}

const CULLED_MASK = (1 << CULL_LAYER) >>> 0;
const _sphere = new THREE.Sphere();

/** Distance (m) from `p` to a renderable's world bounding sphere (0 inside; Infinity without one) — render/warmup.ts's rule. */
function sphereDistance(o: THREE.Object3D, p: THREE.Vector3): number {
  const im = o as THREE.InstancedMesh;
  if (im.isInstancedMesh) { im.computeBoundingSphere(); if (!im.boundingSphere) return Infinity; _sphere.copy(im.boundingSphere).applyMatrix4(o.matrixWorld); }
  else {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g) return Infinity;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere) return Infinity;
    _sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
  }
  return Math.max(0, _sphere.center.distanceTo(p) - _sphere.radius);
}

/**
 * The exit's first view (see the file comment). Reads the scene graph (bounding volumes, world matrices) and — with `sweep` — the
 * culler's decisions for stand-in cameras at the exit, restored for the game camera before returning.
 */
export function planFirstView(scene: THREE.Object3D, o: FirstViewPlanOptions): FirstViewPlan {
  const g = planFirstViewSteps(scene, o);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/**
 * planFirstView in steps: it yields after each sweep yaw (its pitches decided, the culler restored for the game camera first: a frame
 * between two steps sees the game camera's decisions), so a caller can give each its own frame (inFrameStep). stats.ms: the steps'
 * own time.
 */
export function* planFirstViewSteps(scene: THREE.Object3D, o: FirstViewPlanOptions): Generator<void, FirstViewPlan, void> {
  const now = o.now ?? (() => performance.now());
  let t0 = now(), own = 0;
  const radius = o.radius ?? FIRST_VIEW.radius, far = o.camera.far, mask = o.cameraMask;
  const exit = new THREE.Vector3(o.exit.x, o.exit.y, o.exit.z);
  scene.updateMatrixWorld(true);
  // eligible: shown (no hidden ancestor — pools wait for their first use, the scene lane compiles them), with geometry, on the camera's
  // layers or culled (the level culler shows it from somewhere else)
  const cand: {o: THREE.Mesh; d: number}[] = [];
  let candidates = 0;
  const walk = (x: THREE.Object3D): void => {
    if (!x.visible) return;
    if (isRenderable(x)) {
      const geo = x.geometry as THREE.BufferGeometry | undefined;
      const hasGeo = !!geo && (!!geo.attributes.position || (x as THREE.Sprite).isSprite);
      if (hasGeo && ((x.layers.mask & mask) !== 0 || x.layers.mask === CULLED_MASK)) {
        candidates++;
        const d = sphereDistance(x, exit);
        if (d <= far) cand.push({o: x as THREE.Mesh, d});
      }
    }
    for (const c of x.children) walk(c);
  };
  walk(scene);
  const pick = new Uint8Array(cand.length); // 1 near, 2 swept, 3 on the layers now
  let near = 0, swept = 0, current = 0;
  for (let k = 0; k < cand.length; k++) {
    if (cand[k].d <= radius) { pick[k] = 1; near++; }
    else if ((cand[k].o.layers.mask & mask) !== 0) pick[k] = 3;
  }
  // the culler sweep: what it shows from the exit in every direction (beyond the radius) — one yaw per step
  let poses = 0, sweepMs = 0;
  if (o.sweep) {
    const c = o.camera, stand = new THREE.PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
    stand.rotation.order = 'YXZ';
    stand.position.copy(exit);
    const yaw0 = o.exit.yaw ?? 0;
    for (let i = 0; i < FIRST_VIEW.yaws; i++) {
      const ts = now();
      try {
        for (const pitch of FIRST_VIEW.pitches) {
          stand.rotation.set(pitch, yaw0 + (i * 2 * Math.PI) / FIRST_VIEW.yaws, 0);
          stand.updateMatrixWorld(true);
          o.sweep.update(stand);
          poses++;
          for (let k = 0; k < cand.length; k++) if (pick[k] !== 1 && pick[k] !== 2 && (cand[k].o.layers.mask & mask) !== 0) { pick[k] = 2; swept++; }
        }
      } finally {
        o.sweep.restore();
      }
      sweepMs += now() - ts;
      if (i < FIRST_VIEW.yaws - 1) { own += now() - t0; yield; t0 = now(); }
    }
  }
  for (let k = 0; k < cand.length; k++) if (pick[k] === 3) current++;
  const chosen = cand.filter((_, k) => pick[k] !== 0).sort((a, b) => a.d - b.d);
  const share = o.shareInstanced ?? sharedInstancing();
  const seen = new Set<string>();
  const reps: WarmItem[] = [], others: WarmItem[] = [], dist = new Map<WarmItem, number>();
  for (const {o: x, d} of chosen) {
    const fresh = warmKeys(x as never, share).filter(k => !seen.has(k));
    const item: WarmItem = {object: x as never, flips: [], caster: x.castShadow};
    dist.set(item, d);
    if (fresh.length) { for (const k of fresh) seen.add(k); reps.push(item); } else others.push(item);
  }
  const casters = o.casters ? [...reps, ...others].filter(i => i.caster && dist.get(i)! <= FIRST_VIEW.torchReach).sort((a, b) => dist.get(a)! - dist.get(b)!) : [];
  return {reps, others, casters, stats: {candidates, inRange: cand.length, near, swept, current, items: reps.length + others.length, reps: reps.length, casters: casters.length, poses, sweepMs, ms: own + now() - t0}};
}

/**
 * Run `fn` as ONE step of the frame-budget scheduler — the next playing frame's (overdue at once: maxStaleMs 0), after its render — so
 * a crossing's planning phases each get a frame of their own instead of one long frame. Rejects when the step was refused or cancelled
 * (a world change: the generation; a full queue) and when `fn` throws.
 */
export function inFrameStep<T>(s: FrameScheduler, key: string, fn: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const r = s.request({key, kind: key, priority: JOURNEY_COMPILE.priority + 1, maxStaleMs: 0, initialEstimateMs: 4, generation: s.generation,
      step: () => { try { resolve(fn()); } catch (err) { reject(err); } return true; },
      onCancel: reason => reject(new Error(`crossing step ${key}: ${reason}`))});
    if (r === 'stale' || r === 'dropped') reject(new Error(`crossing step ${key}: ${r}`));
  });
}

/** What the wait reads of the job (render/journeyCompile.ts JourneyCompile). */
export interface FirstViewJob {
  readonly stats: Pick<JourneyCompileStats, 'phase' | 'firstView' | 'viewRepsCompiled' | 'viewDone' | 'shadowDone' | 'viewCasters' | 'viewFrame' | 'viewDrawn' | 'cancelReason'>;
  readonly viewReady: Promise<void>;
}

/** The first view's units done / in all (representatives compiled + renderables drawn + its casters + the hidden frame). */
export function firstViewProgress(st: Pick<JourneyCompileStats, 'viewReps' | 'viewItems' | 'viewCasters' | 'viewRepsCompiled' | 'viewDone' | 'shadowDone' | 'viewFrame' | 'viewDrawn'>): {done: number; total: number} {
  const drawn = st.viewDrawn ? st.viewItems + 1 : 0;
  return {done: st.viewRepsCompiled + (st.viewDrawn ? st.viewDone + (st.viewFrame ? 1 : 0) : 0) + Math.min(st.shadowDone, st.viewCasters), total: st.viewReps + drawn + st.viewCasters};
}

/** What is left of the whole job (items not prepared yet: scene, shadow, two-pass). */
export function firstViewRest(st: Pick<JourneyCompileStats, 'sceneItems' | 'sceneDone' | 'casters' | 'shadowDone' | 'twoPass' | 'twoPassDone'>): {left: number; total: number} {
  const total = st.sceneItems + st.casters + st.twoPass;
  return {left: Math.max(0, total - st.sceneDone - st.shadowDone - st.twoPassDone), total};
}

/**
 * The bounded wait for a job's first view: 'ready' (stats.firstView); 'partial' once `W.budgetMs` of ACTIVE time (core/frameBudget.ts
 * activeMs: playing frames only — a paused crossing waits) passed since `since` ('budget'), or the first view made no progress — a
 * representative compiled, a renderable drawn, a caster drawn — for `W.stallMs` of active time ('stalled'); 'cancelled' (the job ended
 * without it: its cancel reason). Checked every `W.pollMs` and when the job settles; never rejects. `why` of a ready first view that
 * could not be drawn (the direct path) says so.
 */
export function waitForFirstView(job: FirstViewJob, activeMs: () => number, since: number, W: {budgetMs: number; stallMs: number; pollMs: number}): Promise<CrossingViewResult> {
  const units = () => { const s = job.stats; return s.viewRepsCompiled + s.viewDone + Math.min(s.shadowDone, s.viewCasters) + (s.viewFrame ? 1 : 0); };
  let seen = -1, seenAt = activeMs();
  return new Promise(resolve => {
    let open = true;
    const finish = (r: CrossingViewResult) => { if (!open) return; open = false; clearInterval(timer); resolve(r); };
    const ready = (): boolean => {
      if (job.stats.firstView !== 'ready') return false;
      finish({end: 'ready', why: job.stats.viewDrawn ? '' : 'compiled, not drawn (no off-screen scene pass)'});
      return true;
    };
    const timer = setInterval(() => {
      if (ready()) return;
      const n = units(), now = activeMs();
      if (n !== seen) { seen = n; seenAt = now; }
      if (now - since >= W.budgetMs) finish({end: 'partial', why: 'budget'});
      else if (now - seenAt >= W.stallMs) finish({end: 'partial', why: 'stalled'});
    }, W.pollMs);
    void job.viewReady.then(() => { if (!ready() && job.stats.phase === 'cancelled') finish({end: 'cancelled', why: job.stats.cancelReason ?? 'cancelled'}); });
  });
}

/**
 * The held rider's / walker's status line for a job's first view: "<go> — preparing the view N / M"; no job yet (null: being planned)
 * "<go> — preparing the view…"; null: nothing to say (no first view, or it is ready).
 */
export function firstViewStatus(go: string, st: (Parameters<typeof firstViewProgress>[0] & Pick<JourneyCompileStats, 'firstView'>) | null): string | null {
  if (!st) return `${go} — preparing the view…`;
  if (st.firstView === 'none' || st.firstView === 'ready') return null;
  const p = firstViewProgress(st);
  return `${go} — preparing the view ${Math.min(p.done, p.total)} / ${p.total}`;
}
