// Task studio-surface-map-tent-cab-20261119-025201-01 (lead). User (the Surface follow-up on GAME153): "The loading area must BE THE
// TENT so the player can look at/read/use the map while the rest of Surface prepares … From Subway, Office and Mall, make the actual
// safe command tent available early as the playable preparation space. Do not keep the long wait in a closed lift/tube until the whole
// district is ready, then only offer the map afterwards. The map must work during the background build/compile … Keep look/movement/
// interaction responsive, an appropriate safe street-side gate until its real view is ready, and coherent return/refusal/failure recovery."
//
// Going UP into a version-2 district (the Subway cargo lift, the Office / Mall connector tube) the crossing waited, sealed, for the first
// view of the WHOLE street from its exit — the car's gate, the tube's mouth: both inside the command tent. On a software rasterizer that
// view was 162-316 s of a 214-401 s wait (the parent tasks' Firefox / llvmpipe spot checks; not hardware timing). The crossing is now
// STAGED in the tent (Game.rideSurfaceLift / walkSurfaceConnector):
//  1. built as before (paced; the sealed car / tube drawn), then the first view of the TENT only — render/firstView.ts `only`: the
//     renderables with geometry in the tent's box (tentStageBox; scanTent) and what every frame draws; no culler sweep; its hidden
//     real-view frame drawn sealed to the tent, as the door-open frame — with the tent flap HELD shut (world/surface/air.ts
//     holdTentFlap); then the car / tube opens INTO THE TENT and the crossing ends: the player walks, looks, reads the planning map at
//     its table, uses the radio and the crate;
//  2. meanwhile the street's first view — from just outside the flap (tentFlapExit), the normal plan (near radius + culler sweep; its
//     hidden real-view frame unsealed from the player's camera: the release frame's view) — is prepared while every frame draws the
//     tent's view only (drawSealed: everything else on CULL_LAYER for that draw, as the sealed car); with the planning map open its
//     steps still run (Game.frame: FrameBudget.run(only); the map state draws a frozen frame);
//  3. ready, the flap is released (one saved open opens again) and the frames draw the whole district; the rest of it is prepared in
//     play, as after every crossing.
// Aimed at the held flap the prompt says what is happening ("The tent flap stays shut — preparing the street N / M"); [E] is refused.
// A crossing back from the tent (the lift, the tube) or any teardown cancels the stage; the flap's saved state is the one from before
// the hold. Down into a host and version-1 districts are unchanged.
//
// Task studio-surface-tent-loading-finish-20261119-071019-01 (Main, on the user's tent request): "A warning is not a substitute for the
// requested gate until the actual first exit view is ready. Do not release an unprepared street on a timer/budget. On real failure/stall,
// keep the tent/map safe and usable and provide truthful retry/return/cancel recovery without trapping the player. Only real first-view
// readiness should allow normal exit." The street's wait (TENT_STREET_WAIT) has NO budget: the flap is released only on the street's real
// first view (Game.prepareTentStreet). Its state behind the held flap (`street`):
//  - 'preparing': its first view progressing;
//  - 'stalled': no first-view progress for TENT_STREET_WAIT.stallMs of active time — said at the flap and once in a toast; its job goes
//    on (progress again: 'preparing'), and [E] at the flap starts it again (a fresh job: what was compiled stays compiled);
//  - 'failed': its job ended without the view, twice (as every crossing retries once), or its planning threw — said likewise; [E] at the
//    flap tries again.
// Meanwhile the tent stays sealed and usable (the planning map, the radio, the crate) and the way back stays open: the lift down / the
// passage back is a normal crossing that ends the stage; so do the menu's Load / Quit (teardown) — never a trap. A first view that can
// only be COMPILED (the direct path: the atmosphere off, no off-screen scene pass — render/firstView.ts) is the most this path can prepare:
// the flap is released on it and the toast says the street could not be drawn ahead. The warm-up switched off (?warmup=off: nothing is
// prepared at all) releases at once and says so. A lost device ends the stage with the flap held (the error screen; nothing can draw).

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import {STAND_EYE} from '../../player/player';
import {firstViewProgress, type CrossingExit, type CrossingViewResult} from '../../render/firstView';
import type {JourneyCompileStats} from '../../render/journeyCompile';
import {CULL_LAYER} from '../levelCulling';
import {isTentBuilding} from './archPlan';
import {LIFT_RIDE_COMPILE, LIFT_RIDE_WAIT} from './liftRuntime';

export const TENT_STAGE = {
  /** The tent's box: its footprint plus this margin (m: the canvas, poles, the flap), from `below` under its floor to `above` it. */
  margin: 0.6,
  below: 1.0,
  above: 6.5,
  /** A renderable this small (world bounding-sphere radius, m) belongs to the tent when its centre is in the box (loose props, pickups). */
  smallR: 3,
  /** The street's first view is planned from this far (m) outside the flap, the eye facing out. */
  flapOut: 0.7,
  /** The scan's real time per step (ms; scanTent yields after it). */
  scanSliceMs: 8,
} as const;

/**
 * The street stage's compile pacing: the ride's (LIFT_RIDE_COMPILE), its steps overdue after 100 ms instead of at once — the player plays.
 * (Measured, tests/crossing-first-view-game in Node: the tent's worst frame is one first-view draw of an expensive item, ~0.3-0.5 s on the
 * CPU; 8-item compile calls and 16-item draws made it no better — 515 ms, 43 frames over 50 ms vs 355 ms, 20 — and the street 14 s later.)
 */
export const TENT_STAGE_COMPILE = {...LIFT_RIDE_COMPILE, maxStaleMs: 100} as const;

/**
 * (task studio-surface-tent-loading-finish-20261119-071019-01) The street's first-view wait behind the held flap: NO budget — the flap
 * opens only on the real first view — and the stall period (active ms without first-view progress; LIFT_RIDE_WAIT's) after which the
 * player is told and offered a retry while the job goes on. (Read at each try: tests shorten the stall.)
 */
export const TENT_STREET_WAIT = {budgetMs: Infinity, stallMs: LIFT_RIDE_WAIT.stallMs, pollMs: LIFT_RIDE_WAIT.pollMs};

/** The scheduler keys the stage's work runs under (Game.frame: what runs while the planning map is open). */
export const tentStageKey = (key: string): boolean => key.startsWith('render.journey-compile') || key.startsWith('crossing.');

const SEAL_MASK = (1 << CULL_LAYER) >>> 0;

type Renderable = THREE.Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean};
const isRenderable = (o: THREE.Object3D): o is Renderable => {
  const r = o as Renderable;
  return !!(r.isMesh || r.isPoints || r.isLine || r.isSprite);
};

/** The command tent's box (world; null: no tent) — its footprint (GEN's tent building, else the checkpoint's rect) round `floorY`. */
export function tentStageBox(layout: Pick<StationLayout, 'surface'>, floorY: number): THREE.Box3 | null {
  const S = layout.surface;
  const t = S?.checkpoint?.tent;
  if (!S || !t) return null;
  const tb = S.buildings.find(isTentBuilding);
  const r = tb ? tb.footprint : t.rect;
  if (!(r.x1 - r.x0 > 1.5 && r.z1 - r.z0 > 1.5)) return null;
  const m = TENT_STAGE.margin;
  return new THREE.Box3(new THREE.Vector3(r.x0 - m, floorY - TENT_STAGE.below, r.z0 - m), new THREE.Vector3(r.x1 + m, floorY + TENT_STAGE.above, r.z1 + m));
}

/** The eye just outside the tent flap, facing out (the game's yaw: forward is -Z turned by yaw) — the street's first view. */
export function tentFlapExit(p: {x: number; z: number; n: readonly number[]; floor: number}): CrossingExit {
  const o = TENT_STAGE.flapOut;
  return {x: p.x + p.n[0] * o, y: p.floor + STAND_EYE, z: p.z + p.n[1] * o, yaw: Math.atan2(-p.n[0], -p.n[1])};
}

export interface TentScan {
  /** The renderables of the tent (geometry in its box). */
  set: Set<THREE.Object3D>;
  stats: {renderables: number; touching: number; small: number; triangleTested: number; triangles: number; instanced: number; inTent: number; steps: number; ms: number};
}

const _s = new THREE.Sphere(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _lb = new THREE.Box3();

/** A renderable's world bounding sphere into `out` (an instanced mesh: all its instances), or null (no geometry). */
function worldSphere(o: Renderable, out: THREE.Sphere): THREE.Sphere | null {
  if (o.isInstancedMesh) {
    const im = o as unknown as THREE.InstancedMesh;
    if (!im.boundingSphere) im.computeBoundingSphere();
    if (!im.boundingSphere) return null;
    return out.copy(im.boundingSphere).applyMatrix4(o.matrixWorld);
  }
  const g = o.geometry as THREE.BufferGeometry | undefined;
  if (!g?.attributes?.position) return null;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius)) return null;
  return out.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
}

/**
 * The tent's renderables, in steps (each about TENT_STAGE.scanSliceMs of real time; a caller gives each its own frame). The world's
 * chunked meshes are large (render/arch: 96 m chunks, 192 m facades), so a bounding volume says little: a large mesh belongs to the
 * tent when one of its triangles' boxes meets the tent's box (tested in its own space, conservatively); an instanced pool when one
 * of its instances does; a small one (TENT_STAGE.smallR) by its centre. Hidden ones too (shown later: drawn without a seal change).
 */
export function* scanTent(scene: THREE.Object3D, box: THREE.Box3, now: () => number = () => performance.now()): Generator<void, TentScan, void> {
  const set = new Set<THREE.Object3D>();
  const st: TentScan['stats'] = {renderables: 0, touching: 0, small: 0, triangleTested: 0, triangles: 0, instanced: 0, inTent: 0, steps: 1, ms: 0};
  let t0 = now();
  const tick = function* (): Generator<void, void, void> {
    if (now() - t0 < TENT_STAGE.scanSliceMs) return;
    st.ms += now() - t0;
    st.steps++;
    yield;
    t0 = now();
  };
  scene.updateMatrixWorld(true);
  const list: Renderable[] = [];
  scene.traverse(o => { if (isRenderable(o)) list.push(o); });
  st.renderables = list.length;
  for (const o of list) {
    yield* tick();
    const s = worldSphere(o, _s);
    if (!s || !s.intersectsBox(box)) continue;
    st.touching++;
    if (s.radius <= TENT_STAGE.smallR) { if (box.containsPoint(s.center)) { set.add(o); st.small++; } continue; }
    if (o.isInstancedMesh) {
      st.instanced++;
      const im = o as unknown as THREE.InstancedMesh, g = im.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r0 = g.boundingSphere?.radius ?? 0;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _m);
        _m.premultiply(im.matrixWorld);
        _p.setFromMatrixPosition(_m);
        const r = r0 * Math.max(_m.getMaxScaleOnAxis(), 1e-6);
        if (box.distanceToPoint(_p) <= r) { set.add(o); break; }
        if ((i & 255) === 255) yield* tick();
      }
      continue;
    }
    const g = o.geometry as THREE.BufferGeometry | undefined, pos = g?.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!o.isMesh || o.isSkinnedMesh || !g || !pos) { set.add(o); continue; } // (lines, points, a skinned body: by their sphere)
    // the tent's box in the mesh's own space (the box of its corners: conservative under a rotation)
    _inv.copy(o.matrixWorld).invert();
    _lb.makeEmpty();
    for (let k = 0; k < 8; k++) _lb.expandByPoint(_p.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(_inv));
    st.triangleTested++;
    const idx = g.index, n = idx ? idx.count : pos.count;
    const lx0 = _lb.min.x, ly0 = _lb.min.y, lz0 = _lb.min.z, lx1 = _lb.max.x, ly1 = _lb.max.y, lz1 = _lb.max.z;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const ax = pos.getX(a), bx = pos.getX(b), cx = pos.getX(c);
      st.triangles++;
      if ((t & 4095) === 4095) yield* tick();
      if (Math.max(ax, bx, cx) < lx0 || Math.min(ax, bx, cx) > lx1) continue;
      const az = pos.getZ(a), bz = pos.getZ(b), cz = pos.getZ(c);
      if (Math.max(az, bz, cz) < lz0 || Math.min(az, bz, cz) > lz1) continue;
      const ay = pos.getY(a), by = pos.getY(b), cy = pos.getY(c);
      if (Math.max(ay, by, cy) < ly0 || Math.min(ay, by, cy) > ly1) continue;
      set.add(o);
      break;
    }
  }
  st.inTent = set.size;
  st.ms += now() - t0;
  return {set, stats: st};
}

/** One staged crossing's record (QA / tests): how each stage ended and when (ms since the stage began; active ms of its bound). */
export interface TentStageRecord {
  /** 'tent': preparing the tent's view (the player held in the car / tube); 'street': the player in the tent; 'done' / 'cancelled'. */
  phase: 'tent' | 'street' | 'done' | 'cancelled';
  why: string;
  scan: TentScan['stats'] | null;
  /** The tent's first view and the street's (Game.crossingView of each). */
  tent: {end: string; why: string; ms: number; activeMs: number; items: number; reps: number} | null;
  street: {end: string; why: string; ms: number; activeMs: number; items: number; reps: number} | null;
  /** ms from the stage's start: the tent open to the player, the flap released. */
  tentOpenMs: number;
  releasedMs: number;
  /** Frames drawn sealed to the tent; the most renderables sealed in one; renderables let in by the centre rule after the scan. */
  sealedFrames: number;
  sealedMax: number;
  /** Frames of the open planning map (the stage's steps run in them): their count, the steps' ms and the steps run. */
  mapFrames: number;
  mapMs: number;
  mapSteps: number;
  /** The flap was held (the district has one) and was open before the hold. */
  flapHeld: boolean;
  /**
   * (task studio-surface-tent-loading-finish-20261119-071019-01) The street's tries (its first-view jobs: a job that ended early is tried
   * once more, as every crossing; a retry is a new try), its stalls, failures (a try that ended without the view, twice) and the
   * player's retries ([E] at the stalled / failed flap); the last stall / failure's why.
   */
  tries: number;
  stalls: number;
  failures: number;
  retries: number;
  lastWhy: string;
}

/** (task studio-surface-tent-loading-finish-20261119-071019-01) The street's preparation behind the held flap (see the file comment). */
export type TentStreetState = 'preparing' | 'stalled' | 'failed';

/**
 * The command tent as the crossing's preparation space (see the file comment). Game drives it: begin() after the build, scan steps,
 * the tent's first view (`only`), enterStreet() before the car / tube opens, then the street's first view, release(). teardown()
 * (a section hook) cancels it.
 */
export class SurfaceTentStage {
  phase: 'idle' | 'tent' | 'street' = 'idle';
  box: THREE.Box3 | null = null;
  /** The street's first view: just outside the flap (null: idle). */
  flap: CrossingExit | null = null;
  /** The last staged crossing (QA / tests; null: none yet). */
  record: TentStageRecord | null = null;
  readonly counts = {stages: 0, streets: 0, released: 0, cancelled: 0, refusedFlap: 0, stalls: 0, failures: 0, retries: 0};
  /** (task studio-surface-tent-loading-finish-20261119-071019-01) The street's preparation in the 'street' phase, and why it stalled / failed. */
  street: TentStreetState = 'preparing';
  streetWhy = '';
  /** How the player goes back the way they came (the toasts: "ride the lift back down" / "walk back through the passage"). */
  back = 'go back the way you came';
  private retryAsked = false;
  private set: Set<THREE.Object3D> = new Set();
  private big = new WeakSet<THREE.Object3D>();
  private t0 = 0;
  private readonly sealObjs: THREE.Object3D[] = [];
  private readonly sealMasks: number[] = [];
  private readonly sealStack: THREE.Object3D[] = [];

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    (g as unknown as {surfaceTentStage: SurfaceTentStage | null}).surfaceTentStage = this;
    g.sectionHooks.push({teardown: () => this.cancel('teardown')});
    return this;
  }

  /** Frames are drawn sealed to the tent (the player in it while the street is prepared; also the car / tube opening into it). */
  get sealing(): boolean { return this.phase !== 'idle'; }

  /** The street's preparation runs (Game.frame: its steps run with the planning map open). */
  get compiling(): boolean { return this.phase !== 'idle'; }

  /**
   * After the build of the district being entered: stage it in its tent from `exit` (the car's gate / the tube's mouth) — its box (round
   * the exit's floor; the exit must be in it), the flap's exit, the flap held (via `hold`: world/surface/air.ts holdTentFlap). False: not
   * staged (no tent, the exit not in it, no flap): the crossing waits for the street as before.
   */
  begin(layout: Pick<StationLayout, 'surface'>, exit: CrossingExit, flapPlan: {x: number; z: number; n: readonly number[]; floor: number} | null, hold: (why: () => string, o: TentFlapHoldOptions) => boolean): boolean {
    this.reset();
    const box = flapPlan ? tentStageBox(layout, exit.y - STAND_EYE) : null;
    if (!box || !flapPlan || !box.containsPoint(_p.set(exit.x, exit.y, exit.z))) return false;
    if (!hold(() => this.flapLine(), {prompt: this.flapPrompt, press: this.pressFlap})) return false;
    this.box = box;
    this.flap = tentFlapExit(flapPlan);
    this.phase = 'tent';
    this.t0 = performance.now();
    this.counts.stages++;
    this.record = {phase: 'tent', why: '', scan: null, tent: null, street: null, tentOpenMs: -1, releasedMs: -1, sealedFrames: 0, sealedMax: 0, mapFrames: 0, mapMs: 0, mapSteps: 0, flapHeld: true,
      tries: 0, stalls: 0, failures: 0, retries: 0, lastWhy: ''};
    return true;
  }

  /** The scan's result adopted (Game runs scanTent in frame steps). */
  adopt(scan: TentScan): void {
    this.set = scan.set;
    if (this.record) this.record.scan = scan.stats;
  }

  /** What may be drawn while sealed / planned in the tent's first view: the tent's renderables, what every frame draws, a small one inside. */
  admits = (o: THREE.Object3D): boolean => {
    if (this.set.has(o) || o.frustumCulled === false) return true;
    if (this.big.has(o) || !this.box || !isRenderable(o)) return false;
    const s = worldSphere(o, _s);
    if (!s || s.radius > TENT_STAGE.smallR) { this.big.add(o); return false; }
    return this.box.containsPoint(s.center);
  };

  /**
   * Draw one frame (`draw`: Game.drawFrame) sealed to the tent: every renderable outside `keep` the tent does not admit goes to
   * CULL_LAYER for that call only and gets its layers back right after (as liftRuntime.ts drawSealed: no program, light-set or culling
   * change; one already culled stays as it was).
   */
  drawSealed(scene: THREE.Object3D, keep: readonly THREE.Object3D[], draw: () => void): void {
    const objs = this.sealObjs, masks = this.sealMasks, stack = this.sealStack;
    objs.length = masks.length = stack.length = 0;
    for (const c of scene.children) stack.push(c);
    while (stack.length) {
      const o = stack.pop()!;
      if (keep.includes(o)) continue;
      if (isRenderable(o) && o.layers.mask !== SEAL_MASK && !this.admits(o)) { objs.push(o); masks.push(o.layers.mask); o.layers.mask = SEAL_MASK; }
      for (const c of o.children) stack.push(c);
    }
    const r = this.record;
    if (r) { r.sealedFrames++; if (objs.length > r.sealedMax) r.sealedMax = objs.length; }
    try { draw(); } finally {
      for (let i = 0; i < objs.length; i++) objs[i].layers.mask = masks[i];
      objs.length = masks.length = 0;
    }
  }

  /** The tent's first view ended (Game.crossingView of it); `open`: the car / tube opens into the tent now — the street stage begins. */
  tentDone(view: StageView, open: boolean): void {
    if (this.record) this.record.tent = view;
    if (!open || this.phase !== 'tent') return;
    this.phase = 'street';
    this.counts.streets++;
    if (this.record) { this.record.phase = 'street'; this.record.tentOpenMs = performance.now() - this.t0; }
  }

  /** (Game.frame) a frame of the open planning map ran `steps` of the stage's steps for `ms`. */
  mapFrame(ms: number, steps: number): void {
    if (this.record) { this.record.mapFrames++; this.record.mapMs += ms; this.record.mapSteps += steps; }
  }

  /** (Game.prepareTentStreet) A try of the street's first view begins (its job being planned / run). */
  streetTry(): void {
    if (this.phase !== 'street') return;
    this.street = 'preparing';
    this.streetWhy = '';
    this.retryAsked = false;
    if (this.record) this.record.tries++;
  }

  /** (Game.prepareTentStreet) The street's preparation stalled / is progressing again / failed (`why`: the wait's or the job's). */
  streetState(s: TentStreetState, why = ''): void {
    if (this.phase !== 'street' || (s === this.street && why === this.streetWhy)) return;
    const r = this.record;
    if (s === 'stalled') { this.counts.stalls++; if (r) r.stalls++; }
    else if (s === 'failed') { this.counts.failures++; if (r) r.failures++; }
    if (r && s !== 'preparing') r.lastWhy = why;
    this.street = s;
    this.streetWhy = why;
  }

  /**
   * [E] at the held flap (air.ts holdTentFlap's press): with the street stalled or failed, a RETRY — the next try starts (Game.
   * prepareTentStreet takes it) and the toast says so; while it is preparing, null (refused: the flap's line).
   */
  pressFlap = (): string | null => {
    if (this.phase !== 'street' || this.street === 'preparing') return null;
    this.retryAsked = true;
    this.counts.retries++;
    if (this.record) this.record.retries++;
    this.street = 'preparing';
    this.streetWhy = '';
    return 'Trying again to prepare the street — the tent flap opens once it is ready.';
  };

  /** (Game.prepareTentStreet) The player asked for a retry since the last try began (taken: false until asked again). */
  takeRetry(): boolean {
    const r = this.retryAsked;
    this.retryAsked = false;
    return r;
  }

  /** The street's first view ended: the flap is let go (`release`: air.ts releaseTentFlap) and the frames draw the whole district. */
  streetDone(view: StageView | null, release: () => void): void {
    if (this.phase === 'idle') return;
    if (this.record) { this.record.street = view; this.record.phase = 'done'; this.record.why = view ? view.end : 'no view'; this.record.releasedMs = performance.now() - this.t0; }
    this.counts.released++;
    try { release(); } finally { this.reset(); }
  }

  /** Ends a stage without its street (a teardown: the world it staged is gone; a failure: `release` lets the flap go). */
  cancel(why: string, release?: () => void): void {
    if (this.phase === 'idle') return;
    if (this.record) { this.record.phase = 'cancelled'; this.record.why = why; }
    this.counts.cancelled++;
    try { release?.(); } finally { this.reset(); }
  }

  /** The street's first view's progress now ('N / M'; null: no job of it yet). */
  private progress(): string | null {
    // (the street's job: Game.prepareTentStreet replaced the tent's synchronously when the street stage began)
    const st: JourneyCompileStats | null = this.phase === 'street' ? this.game.journeyCompileStats : null;
    if (!st || st.firstView === 'none') return null;
    const p = firstViewProgress(st);
    return `${Math.min(p.done, p.total)} / ${p.total}`;
  }

  /** The held flap's refusal (a toast) and its plain prompt: the street's real progress — stalled / failed: the retry first (the HUD's
   * prompt is one centred line: kept short enough to show its key in a small window), then what happened. */
  flapLine(): string {
    const at = this.progress();
    if (this.phase === 'street' && this.street === 'stalled') return `[E] Try again — preparing the street is stuck${at ? ` at ${at}` : ''}`;
    if (this.phase === 'street' && this.street === 'failed') return `[E] Try again — the street could not be prepared${this.streetWhy ? ` (${this.streetWhy})` : ''}`;
    return at ? `The tent flap stays shut — preparing the street ${at}` : 'The tent flap stays shut — preparing the street…';
  }

  /** The held flap's HUD prompt (HTML): flapLine with its key in bold. */
  flapPrompt = (): string => this.flapLine().replace('[E]', '<b>[E]</b>');

  /** (Game.prepareTentStreet) The toast when the street stalls / fails: what happened, that the tent is safe, the retry and the way back. */
  troubleLine(): string {
    const at = this.progress();
    if (this.street === 'stalled') {
      return `Preparing the street has made no progress for ${Math.round(TENT_STREET_WAIT.stallMs / 1000)} s${at ? ` (${at})` : ''}. The tent flap stays shut; it keeps trying — [E] at the flap starts it again, or ${this.back}.`;
    }
    return `The street could not be prepared${this.streetWhy ? ` (${this.streetWhy})` : ''}. The tent flap stays shut — [E] at the flap tries again, or ${this.back}.`;
  }

  private reset(): void {
    this.phase = 'idle';
    this.box = null;
    this.flap = null;
    this.set = new Set();
    this.big = new WeakSet();
    this.street = 'preparing';
    this.streetWhy = '';
    this.retryAsked = false;
  }
}

/** (task studio-surface-tent-loading-finish-20261119-071019-01) The held flap's HUD prompt and its [E] (air.ts holdTentFlap). */
export interface TentFlapHoldOptions {
  /** The HUD prompt (HTML; default: the refusal line). */
  prompt?: (() => string) | null;
  /** [E] on the held flap: a toast line when it did something (a retry), null: refused (the line). */
  press?: (() => string | null) | null;
}

/** A stage's first view as recorded (Game.crossingView's end, times and plan size). */
export type StageView = NonNullable<TentStageRecord['tent']>;

/** A StageView from a crossing's result and its Game.crossingView (null: none). */
export function stageView(c: CrossingViewResult, cv: {ms: number; activeMs: number; plan: {items: number; reps: number}} | null): StageView {
  return {end: c.end, why: c.why, ms: cv?.ms ?? 0, activeMs: cv?.activeMs ?? 0, items: cv?.plan.items ?? 0, reps: cv?.plan.reps ?? 0};
}

export function installSurfaceTentStage(game: Game): SurfaceTentStage {
  return new SurfaceTentStage(game).install();
}
