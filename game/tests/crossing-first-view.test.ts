// Task studio-surface-host-ground-connectors-20261118-053602-01 (lane READY). User: "Diagnose and address the first-visible exit/ready
// handoff … A successful exit needs a built, playable first view that can actually be drawn; any noncritical background compile must be
// truthful and not strand the player … Do not restore unbounded silent waiting."
// The crossing's readiness (render/firstView.ts + the journey compile's 'view' lane, render/journeyCompile.ts) through the REAL frame-budget
// scheduler (core/frameBudget.ts) with a fake renderer that records every draw (its target, its camera's layers, what it drew) and charges
// a fake clock per PROGRAM drawn the first time (a software rasterizer's JIT at first draw; a pipeline created in a draw on hardware):
//  1. the first view is drawn OFF-SCREEN (the scene pass's target, its items alone on the prep layer) BEFORE the job reports it ready, a
//     representative only after its compile settled, spread over many frames (items per draw adapted: one per frame while each draw is a
//     new program, growing for cache hits), then ONE hidden frame of the real view; the canvas is never drawn into; the "door-open frame"
//     afterwards — every renderable the camera can see from the exit, ANY yaw, incl. a culled one near the exit and a far one only the
//     culler sweep shows — draws no program that was not drawn before;
//  2. the rest of the job goes on after ready, in the journey's play pacing (pace(null): one item per call), and is reported (firstViewRest);
//  3. adaptive: an expensive draw stays at one item; a long gap between draws (work left to the GPU / driver) halves the next one;
//  4. the direct path (no scene pass target): nothing is drawn at all (an off-screen draw would land on the canvas) — ready once compiled,
//     and says so;
//  5. the wait (waitForFirstView) is BOUNDED and truthful: ready / 'partial' at the active-time budget / 'partial' after a stall of
//     first-view progress (progress resets the stall clock) / 'cancelled' with the job's reason; a paused crossing (no active time) waits;
//  6. planFirstView: what a frame can draw from the exit (near radius incl. culled; the culler's stand-in sweep beyond it; nothing hidden,
//     nothing past the far plane), one representative per program group nearest first, casters within the torch's reach, and the culler's
//     decisions put back for the game camera — after every sweep yaw (planFirstViewSteps: one step each; inFrameStep: a frame each);
//  7. until the first view is ready the frames are its own: the scene lane compiles only its lead, the shadow lane draws only its casters,
//     the two-pass lane waits; then the rest of the job (all of it) follows.
import * as THREE from 'three';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {FrameBudget} from '../src/core/frameBudget';
import {CASTER_LAYER, FIRST_VIEW_DRAW, JOURNEY_COMPILE, JourneyCompile, PREP_LAYER} from '../src/render/journeyCompile';
import {FIRST_VIEW, firstViewCoverage, firstViewProgress, firstViewRest, firstViewStatus, inFrameStep, planFirstView, planFirstViewSteps, waitForFirstView, type FirstViewSweep} from '../src/render/firstView';
import type {WarmItem} from '../src/render/warmup';
import {CULL_LAYER} from '../src/world/levelCulling';
import {LIFT_RIDE_COMPILE, LIFT_RIDE_WAIT} from '../src/world/surface/liftRuntime';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const flush = () => new Promise<void>(r => setImmediate(r));
const PREP = (1 << PREP_LAYER) >>> 0, CULLED = (1 << CULL_LAYER) >>> 0;

interface Draw { target: unknown; mask: number; objects: THREE.Mesh[]; frame: number; tone: number; casterPass: boolean }

/**
 * A station-like scene round an exit at the origin: `reps` program groups near it (each its own material), `copies` more meshes per group
 * (the same material: cache hits), `far` scene-lane items outside the first view (other materials), a culled mesh 10 m away (own
 * material), a far one 45 m east only the culler sweep shows (own material), one past the far plane and one hidden (pool-like).
 */
function rig(o: {reps?: number; copies?: number; far?: number; target?: boolean; newMs?: number; cheapMs?: number} = {}) {
  let clock = 1000;
  const now = () => clock;
  const fb = new FrameBudget({now});
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  cam.position.set(0, 1.6, 0);
  scene.add(cam);
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const at = (m: THREE.Mesh, x: number, z: number) => { m.position.set(x, 1, z); scene.add(m); return m; };
  const groups: THREE.Mesh[][] = [];
  const nR = o.reps ?? 10, nC = o.copies ?? 6;
  for (let g = 0; g < nR; g++) {
    const mat = new THREE.MeshStandardMaterial();
    const list: THREE.Mesh[] = [];
    for (let k = 0; k <= nC; k++) { const m = at(new THREE.Mesh(geo, mat), -6 + g, -3 - k * 1.5); m.castShadow = k === 0; m.receiveShadow = true; list.push(m); }
    groups.push(list);
  }
  const farItems: THREE.Mesh[] = [];
  for (let k = 0; k < (o.far ?? 20); k++) farItems.push(at(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()), 30 + (k % 5), -30 - Math.floor(k / 5)));
  for (const m of farItems) m.layers.mask = CULLED; // (beyond the fog: culled from the exit)
  const culledNear = at(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()), 0, 10);
  culledNear.layers.mask = CULLED; // (behind the camera: the culler hides it until the player turns)
  const sweptFar = at(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()), 45, 0);
  sweptFar.layers.mask = CULLED;
  const pastFar = at(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()), 0, -90);
  const hidden = new THREE.Group();
  hidden.visible = false;
  scene.add(hidden);
  const pooled = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  hidden.add(pooled);
  // the culler: from a stand-in looking east (yaw -PI/2) the far mesh 45 m east is shown; the game camera (looking north) keeps its state
  const decide = (c: THREE.Camera) => {
    const d = new THREE.Vector3();
    c.getWorldDirection(d);
    sweptFar.layers.mask = d.x > 0.7 ? 1 : CULLED;
  };
  const sweep: FirstViewSweep & {updates: number; restores: number} = {updates: 0, restores: 0,
    update(c) { this.updates++; decide(c); }, restore() { this.restores++; decide(cam); }};
  // the renderer: draws recorded; the clock charged per program (material) drawn the first time
  const target = o.target === false ? null : {isRenderTarget: true, name: 'scene-pass'};
  let rt: unknown = null, mrt: unknown = null;
  const programs = new Set<string>();
  const draws: Draw[] = [];
  const compiled = new Map<THREE.Object3D, number>(); // object -> frame its compile settled
  const pending: {objs: THREE.Object3D[]; resolve(): void}[] = [];
  const shadowLight = new THREE.SpotLight();
  shadowLight.castShadow = true;
  scene.add(shadowLight);
  const R = {
    toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping, outputColorSpace: THREE.SRGBColorSpace as THREE.ColorSpace,
    getRenderTarget: () => rt, setRenderTarget: (t: unknown) => { rt = t; }, getMRT: () => mrt, setMRT: (m: unknown) => { mrt = m; },
    render(s: THREE.Object3D, view: THREE.Camera) {
      const objects: THREE.Mesh[] = [];
      let casterPass = false; // (a shadow-lane draw: casters on the caster layer, which only the light's shadow camera renders)
      s.traverse(x => { if ((x.layers.mask & ((1 << CASTER_LAYER) >>> 0)) !== 0) casterPass = true; });
      s.traverseVisible(x => { if ((x as THREE.Mesh).isMesh && x.layers.test(view.layers)) objects.push(x as THREE.Mesh); });
      for (const m of objects) {
        const id = (m.material as THREE.Material).uuid;
        clock += programs.has(id) ? (o.cheapMs ?? 0.05) : (o.newMs ?? 4);
        programs.add(id);
      }
      draws.push({target: rt, mask: view.layers.mask, objects, frame: fb.frame, tone: this.toneMapping, casterPass});
    },
    compileAsync(s: THREE.Object3D, view: THREE.Camera): Promise<void> {
      const objs: THREE.Object3D[] = [];
      s.traverse(x => { if ((x as THREE.Mesh).isMesh && x.visible && x.layers.test(view.layers)) objs.push(x); });
      return new Promise<void>(resolve => pending.push({objs, resolve}));
    },
  };
  const fvPlan = () => planFirstView(scene, {exit: {x: 0, y: 1.6, z: 0, yaw: 0}, cameraMask: cam.layers.mask, camera: cam, sweep, casters: true});
  const make = (plan = fvPlan(), extra: Partial<ConstructorParameters<typeof JourneyCompile>[0]> = {}) => {
    const lead = new Set(plan.reps.map(i => i.object));
    const rest: WarmItem[] = farItems.map(m => ({object: m as never, flips: [], caster: false}));
    const items = [...plan.reps, ...rest.filter(i => !lead.has(i.object))];
    const receiver = plan.reps.find(i => i.object.receiveShadow) ?? null;
    return new JourneyCompile({renderer: R as never, scheduler: fb, scene, camera: cam, target, depth: 0, items, casters: plan.casters, receiver,
      frameNo: () => fb.frame, now, post: null, ...LIFT_RIDE_COMPILE, firstView: {items: [...plan.reps, ...plan.others], reps: plan.reps.length, casters: plan.casters.length}, ...extra});
  };
  /** One game frame: the compiles started in earlier frames settle (a new build's yielded stages ran past its frame), then the steps. */
  const frame = async (dt = 16.7, held: 'paused' | null = null) => {
    const ready = pending.splice(0);
    for (const p of ready) { for (const x of p.objs) compiled.set(x, fb.frame); p.resolve(); }
    await flush();
    clock += dt;
    fb.hold(held);
    fb.beginFrame(clock, clock);
    fb.run();
    await flush();
  };
  /** What a real frame from the camera would draw (visible, on the camera's layers): its programs. */
  const frameSet = (c: THREE.Camera) => { const out: THREE.Mesh[] = []; scene.traverseVisible(x => { if ((x as THREE.Mesh).isMesh && x.layers.test(c.layers)) out.push(x as THREE.Mesh); }); return out; };
  return {fb, scene, cam, R, target, draws, programs, compiled, pending, groups, farItems, culledNear, sweptFar, pastFar, pooled, sweep, fvPlan, make, frame, frameSet, now: () => clock, advance: (ms: number) => { clock += ms; }};
}

describe('crossing readiness: the exit\'s first view (render/firstView.ts, the journey compile\'s view lane)', () => {
  it('draws the first view off-screen before ready, spread over frames, then one hidden real-view frame; the door-open frame draws nothing new', async () => {
    const k = rig({reps: 10, copies: 6, far: 40, newMs: 4, cheapMs: 0.05});
    const plan = k.fvPlan();
    const job = k.make(plan, {chunk: 1}).start(); // (one scene item per call: the far items are still compiling when the first view is ready)
    let ready = -1;
    void job.viewReady.then(() => { ready = k.fb.frame; });
    const perFrame: number[] = [];
    for (let f = 0; f < 400 && job.stats.firstView !== 'ready'; f++) {
      const d0 = k.draws.length;
      await k.frame();
      perFrame.push(k.draws.slice(d0).filter(d => d.mask === PREP && !d.casterPass).length);
    }
    expect(job.stats.firstView).toBe('ready');
    expect(ready).toBeGreaterThan(0);
    const st = job.stats, fvItems = new Set<THREE.Object3D>([...plan.reps, ...plan.others].map(i => i.object));
    const viewDraws = k.draws.filter(d => d.mask === PREP && d.objects.every(x => fvItems.has(x)) && !d.casterPass);
    // off-screen, isolated, under the scene pass's renderer state; never the canvas
    expect(k.draws.every(d => d.target === k.target), 'every draw into the scene pass\'s target').toBe(true);
    expect(k.draws.every(d => d.tone === THREE.NoToneMapping), 'the scene pass\'s renderer state').toBe(true);
    expect(viewDraws.length).toBe(st.viewDraws);
    expect(viewDraws.reduce((n, d) => n + d.objects.length, 0)).toBe(plan.reps.length + plan.others.length);
    // a representative only after its compile settled (in an earlier frame)
    for (const d of viewDraws) for (const x of d.objects) if (plan.reps.some(r => r.object === x)) expect(k.compiled.get(x), 'compiled before its draw').toBeLessThan(d.frame);
    // spread over frames: one new program per draw while they are new; cache hits batch
    expect(perFrame.filter(n => n > 0).length, 'frames with first-view draws').toBeGreaterThanOrEqual(plan.reps.length / 2);
    expect(Math.max(...perFrame), 'one draw per frame').toBe(1);
    expect(st.viewMaxPerDraw).toBeGreaterThan(1);
    expect(st.viewMaxPerDraw).toBeLessThanOrEqual(FIRST_VIEW_DRAW.maxPerDraw);
    // the first view's casters went through the shadow lane (a receiver with them) before ready
    expect(Math.min(st.shadowDone, st.viewCasters)).toBe(plan.casters.length);
    expect(plan.casters.length).toBe(10);
    // the LAST draw before ready: the real view (the camera's own layers, nothing isolated)
    const last = k.draws.filter(d => d.frame <= ready).at(-1)!;
    expect(last.mask).toBe(k.cam.layers.mask);
    expect(st.viewFrame).toBe(true);
    expect(firstViewProgress(st)).toEqual({done: plan.reps.length + plan.reps.length + plan.others.length + 1 + plan.casters.length, total: plan.reps.length + plan.reps.length + plan.others.length + 1 + plan.casters.length});
    expect(firstViewStatus('Going up', st)).toBeNull();
    // the "door-open frame", any yaw: the near culled mesh revealed, the far one the sweep showed — no program drawn for the first time
    k.culledNear.layers.mask = 1;
    k.sweptFar.layers.mask = 1;
    const seen = k.frameSet(k.cam);
    expect(seen).toEqual(expect.arrayContaining([k.culledNear, k.sweptFar, ...k.groups.flat()]));
    expect(seen.filter(m => !k.programs.has((m.material as THREE.Material).uuid)).map(m => m.uuid), 'programs first drawn by the door-open frame').toEqual([]);
    // the far scene-lane items (not in the first view) were not needed for it: some are still not compiled when the first view is ready
    expect(st.sceneDone).toBeLessThan(st.sceneItems);
    job.cancel();
  });

  it('the rest goes on after ready, in the journey\'s play pacing (one item per call), and is reported', async () => {
    const k = rig({reps: 4, copies: 2, far: 60, newMs: 1});
    const job = k.make(undefined, {chunk: 1}).start();
    for (let f = 0; f < 300 && job.stats.firstView !== 'ready'; f++) await k.frame();
    expect(job.stats.firstView).toBe('ready');
    expect(job.running).toBe(true);
    const r0 = firstViewRest(job.stats);
    expect(r0.left).toBeGreaterThan(0);
    // whenScene: at once for what is compiled; the rest's count once the lane reaches it
    let at = -1;
    await job.whenScene(job.stats.sceneDone);
    void job.whenScene(job.stats.sceneDone + 5).then(() => { at = job.stats.sceneDone; });
    job.pace(null);
    const sizes: number[] = [];
    const ca = k.R.compileAsync.bind(k.R);
    k.R.compileAsync = (s: THREE.Object3D, v: THREE.Camera) => { let n = 0; s.traverse(x => { if ((x as THREE.Mesh).isMesh && x.layers.test(v.layers)) n++; }); sizes.push(n); return ca(s, v); };
    for (let f = 0; f < 400 && job.running; f++) await k.frame();
    expect(job.stats.phase).toBe('done');
    expect(at, 'whenScene resolved as the lane reached its count').toBeGreaterThanOrEqual(0);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every(n => n === JOURNEY_COMPILE.chunk), 'play pacing: one item per call').toBe(true);
    expect(firstViewRest(job.stats)).toEqual({left: 0, total: r0.total});
  });

  it('adaptive: an expensive draw stays at one item; a long gap between draws halves the next one', async () => {
    const a = rig({reps: 6, copies: 4, newMs: 30, cheapMs: 30}); // every draw > 3 x the target
    const ja = a.make().start();
    for (let f = 0; f < 400 && ja.stats.firstView !== 'ready'; f++) await a.frame();
    expect(ja.stats.firstView).toBe('ready');
    expect(ja.stats.viewMaxPerDraw).toBe(1);
    const b = rig({reps: 2, copies: 40, newMs: 0.01, cheapMs: 0.01});
    const jb = b.make().start();
    const per: number[] = [];
    for (let f = 0; f < 400 && jb.stats.firstView !== 'ready'; f++) {
      const n0 = jb.stats.viewDone;
      await b.frame(f === 6 ? 1000 : 16.7); // (one frame of 1 s: a draw's work landed after it)
      per.push(jb.stats.viewDone - n0);
    }
    const grow = per.slice(0, 6).filter(n => n > 0);
    expect(grow.at(-1)!).toBeGreaterThan(grow[0]); // (doubling while each draw stays under its target)
    expect(per[6], 'halved after the long gap (it would have doubled)').toBe(grow.at(-1));
    expect(per[7], 'and not grown in that step').toBe(per[6]);
  });

  it('the direct path (no scene pass target): nothing is drawn — ready once the representatives are compiled, and it says so', async () => {
    const k = rig({target: false});
    const job = k.make().start();
    let active = 0;
    const w = waitForFirstView(job, () => active, 0, {budgetMs: 60_000, stallMs: 10_000, pollMs: 5});
    for (let f = 0; f < 200 && job.stats.firstView !== 'ready'; f++) { await k.frame(); active += 16.7; }
    expect(job.stats.firstView).toBe('ready');
    expect(k.draws.length, 'no draw at all (it would land on the canvas)').toBe(0);
    expect(job.stats.viewDrawn).toBe(false);
    expect(job.stats.viewRepsCompiled).toBe(job.stats.viewReps);
    expect(await w).toEqual({end: 'ready', why: 'compiled, not drawn (no off-screen scene pass)'});
    job.cancel();
  });

  it('the wait is bounded and truthful: ready / budget / stalled / cancelled; progress resets the stall clock; a paused crossing waits', async () => {
    vi.useFakeTimers();
    const W = {budgetMs: 10_000, stallMs: 2_000, pollMs: 100};
    type S = Parameters<typeof waitForFirstView>[0]['stats'];
    const fake = () => {
      let end!: () => void;
      const stats: {-readonly [K in keyof S]: S[K]} = {phase: 'scene', firstView: 'drawing', viewRepsCompiled: 0, viewDone: 0, shadowDone: 0, viewCasters: 0, viewFrame: false, viewDrawn: true, cancelReason: null};
      return {stats, viewReady: new Promise<void>(r => { end = r; }), end: () => end()};
    };
    let t = 0;
    const tick = async (ms: number) => { for (let i = 0; i < ms / 100; i++) { t += 100; await vi.advanceTimersByTimeAsync(100); } };
    // ready
    const a = fake();
    let ra: unknown = null;
    void waitForFirstView(a, () => t, t, W).then(r => { ra = r; });
    await tick(500);
    a.stats.firstView = 'ready';
    a.end();
    await tick(100);
    expect(ra).toEqual({end: 'ready', why: ''});
    // progress keeps it waiting; then no progress: stalled
    const b = fake();
    let rb: unknown = null;
    void waitForFirstView(b, () => t, t, W).then(r => { rb = r; });
    for (let i = 0; i < 6; i++) { await tick(1000); b.stats.viewDone++; }
    expect(rb).toBeNull();
    await tick(2100);
    expect(rb).toEqual({end: 'partial', why: 'stalled'});
    // the budget (progress all along)
    const c = fake();
    let rc: unknown = null;
    const since = t;
    void waitForFirstView(c, () => t, since, W).then(r => { rc = r; });
    for (let i = 0; i < 9; i++) { await tick(1000); c.stats.viewRepsCompiled++; }
    expect(rc).toBeNull();
    await tick(1100);
    expect(rc).toEqual({end: 'partial', why: 'budget'});
    // paused: no active time -> it waits (no bound passes)
    const d = fake();
    let rd: unknown = null;
    const frozen = t;
    void waitForFirstView(d, () => frozen, frozen, W).then(r => { rd = r; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rd).toBeNull();
    // cancelled (the job ended without its first view): its reason
    d.stats.phase = 'cancelled';
    d.stats.cancelReason = 'generation';
    d.end();
    await vi.advanceTimersByTimeAsync(100);
    expect(rd).toEqual({end: 'cancelled', why: 'generation'});
  });

  it('a stalled job (its compile never settles) ends the real wait bounded; the job reports where it got', async () => {
    const k = rig({reps: 4});
    const job = k.make().start();
    let active = 0;
    const w = waitForFirstView(job, () => active, 0, {budgetMs: 60_000, stallMs: 1_000, pollMs: 5});
    k.pending.length = 0; // (nothing ever settles)
    let res: unknown = null;
    void w.then(r => { res = r; });
    for (let f = 0; f < 400 && !res; f++) {
      k.pending.length = 0;
      await k.frame();
      active += 16.7;
      await new Promise(r => setTimeout(r, 6));
    }
    expect(res).toEqual({end: 'partial', why: 'stalled'});
    expect(job.stats.firstView).toBe('pending');
    expect([job.stats.viewRepsCompiled, job.stats.viewDone]).toEqual([0, 0]);
    const p = firstViewProgress(job.stats);
    expect(p.done).toBe(Math.min(job.stats.shadowDone, job.stats.viewCasters)); // (only its casters: they need no compile)
    expect(firstViewStatus('Going up', job.stats)).toBe(`Going up — preparing the view ${p.done} / ${p.total}`);
    job.cancel();
  });

  it('planFirstView: what a frame can draw from the exit (any yaw), one representative per program group, casters in reach, the culler put back', () => {
    const k = rig({reps: 5, copies: 3});
    // drawn by every frame wherever it is (no frustum test; an effect pool with no instance yet): in, past the far plane too
    const fx = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial(), 16);
    fx.count = 0;
    fx.frustumCulled = false;
    k.scene.add(fx);
    fx.position.set(0, 0, -200);
    const before = new Map<THREE.Object3D, number>();
    k.scene.traverse(x => before.set(x, x.layers.mask));
    const plan = k.fvPlan();
    const all = new Set([...plan.reps, ...plan.others].map(i => i.object));
    expect(all.has(fx), 'an always-drawn renderable on the camera\'s layers, past the far plane').toBe(true);
    expect(plan.stats.always).toBe(1);
    expect(plan.reps.at(-1)!.object, 'the farthest (sorted at the far plane)').toBe(fx);
    expect(all.has(k.culledNear), 'culled within the radius').toBe(true);
    expect(all.has(k.sweptFar), 'beyond the radius, shown by the culler from the exit').toBe(true);
    expect(all.has(k.pastFar), 'past the far plane').toBe(false);
    expect(all.has(k.pooled), 'hidden (a pool: its first use)').toBe(false);
    for (const m of k.farItems) expect(all.has(m), 'culled beyond the radius, shown from nowhere').toBe(false);
    // a group's caster is its own program group (the shadow flags are part of the key): 5 x 2 + the culled near + the swept far + fx
    expect(plan.reps.length).toBe(5 * 2 + 3);
    expect(plan.others.length).toBe(5 * 2);
    // the destination plan's items by the first view's program groups: a group's other copy is covered, a far item's own material is new
    const copy: WarmItem = {object: new THREE.Mesh(k.groups[0][1].geometry, k.groups[0][1].material) as never, flips: [], caster: false};
    copy.object.position.set(500, 0, 500);
    copy.object.receiveShadow = true; // (as the group's: the shadow flags are part of the program group)
    const far: WarmItem = {object: k.farItems[0] as never, flips: [], caster: false};
    expect(firstViewCoverage([far, copy], plan, false)).toEqual({fresh: [far], covered: [copy]});
    const d = (o: THREE.Object3D) => o.position.length();
    for (let i = 1; i < plan.reps.length; i++) expect(d(plan.reps[i].object)).toBeGreaterThanOrEqual(d(plan.reps[i - 1].object) - 1);
    expect(plan.casters.map(i => i.object)).toEqual(k.groups.map(g => g[0]).sort((a, b) => d(a) - d(b)));
    expect(plan.stats.poses).toBe(FIRST_VIEW.yaws * FIRST_VIEW.pitches.length);
    expect([k.sweep.updates, k.sweep.restores], 'the culler put back after each yaw').toEqual([plan.stats.poses, FIRST_VIEW.yaws]);
    const after = new Map<THREE.Object3D, number>();
    k.scene.traverse(x => after.set(x, x.layers.mask));
    expect(after, 'every layer as the game camera\'s culler left it').toEqual(before);
    // the restore runs also when a sweep decision throws
    const bad = {update: () => { throw new Error('culler'); }, restore: vi.fn()};
    expect(() => planFirstView(k.scene, {exit: {x: 0, y: 1.6, z: 0}, cameraMask: 1, camera: k.cam, sweep: bad})).toThrow('culler');
    expect(bad.restore).toHaveBeenCalledTimes(1);
    expect(LIFT_RIDE_WAIT.stallMs).toBeLessThan(LIFT_RIDE_WAIT.budgetMs);
  });

  it('planFirstViewSteps: one step per sweep yaw, the culler put back before each (a frame between two sees the game camera\'s), the same plan', async () => {
    const k = rig({reps: 5, copies: 3});
    const whole = k.fvPlan();
    k.sweep.updates = k.sweep.restores = 0;
    const g = planFirstViewSteps(k.scene, {exit: {x: 0, y: 1.6, z: 0, yaw: 0}, cameraMask: k.cam.layers.mask, camera: k.cam, sweep: k.sweep, casters: true});
    let steps = 0, r = g.next();
    while (!r.done) {
      steps++;
      expect(k.sweep.restores, 'restored before the step returned').toBe(steps);
      expect(k.sweptFar.layers.mask, 'the game camera\'s decision between steps').toBe(CULLED);
      r = g.next();
    }
    expect(steps + 1).toBe(FIRST_VIEW.yaws);
    const plan = r.value;
    expect(plan.reps.map(i => i.object)).toEqual(whole.reps.map(i => i.object));
    expect(plan.others.map(i => i.object)).toEqual(whole.others.map(i => i.object));
    expect(plan.casters.map(i => i.object)).toEqual(whole.casters.map(i => i.object));
    // inFrameStep: each in a frame of its own (the next frame's scheduler run), its value or its error; a world change cancels it
    const frames: number[] = [];
    const a = inFrameStep(k.fb, 'crossing.plan', () => { frames.push(k.fb.frame); return 7; });
    expect(frames).toEqual([]);
    await k.frame();
    expect(await a).toBe(7);
    const b = expect(inFrameStep(k.fb, 'crossing.plan', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await k.frame();
    await b;
    const c = expect(inFrameStep(k.fb, 'crossing.plan', () => 1)).rejects.toThrow(/crossing step/);
    k.fb.bumpGeneration();
    await c;
    expect(firstViewStatus('The passage', null), 'no job yet: being planned').toBe('The passage — preparing the view…');
  });

  it('until the first view is ready its lanes have the frames: the scene lane\'s lead only, its casters only, no two-pass draw; then all the rest', async () => {
    const k = rig({reps: 6, copies: 2, far: 30, newMs: 1});
    const plan = k.fvPlan();
    // more casters (outside the first view) and a two-pass scene item outside it
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({transparent: true, side: THREE.DoubleSide}));
    glass.position.set(40, 1, -40);
    glass.layers.mask = CULLED;
    k.scene.add(glass);
    const glassItem: WarmItem = {object: glass as never, flips: [], caster: false};
    const farCasters: WarmItem[] = k.farItems.map(m => ({object: m as never, flips: [], caster: true}));
    const lead = new Set(plan.reps.map(i => i.object));
    const items = [...plan.reps, glassItem, ...k.farItems.map(m => ({object: m as never, flips: [], caster: false})).filter(i => !lead.has(i.object))];
    const job = k.make(plan, {chunk: 4, items, casters: [...plan.casters, ...farCasters]}).start();
    expect(job.stats.twoPass).toBe(1);
    const compiledObjs = new Set<THREE.Object3D>();
    const ca = k.R.compileAsync.bind(k.R);
    k.R.compileAsync = (s: THREE.Object3D, v: THREE.Camera) => { s.traverse(x => { if ((x as THREE.Mesh).isMesh && x.visible && x.layers.test(v.layers)) compiledObjs.add(x); }); return ca(s, v); };
    for (let f = 0; f < 600 && job.stats.firstView !== 'ready'; f++) {
      await k.frame();
      if ((job.stats.firstView as string) === 'ready') break; // (set by the frame)
      expect(job.stats.sceneDone, 'the scene lane: its lead only').toBeLessThanOrEqual(plan.reps.length);
      expect(job.stats.shadowDone, 'the shadow lane: the first view\'s casters only').toBeLessThanOrEqual(plan.casters.length);
      expect(job.stats.twoPassDone).toBe(0);
    }
    expect(job.stats.firstView).toBe('ready');
    expect(compiledObjs.has(glass), 'the two-pass item (outside the first view) not compiled yet').toBe(false);
    for (const m of k.farItems) expect(compiledObjs.has(m)).toBe(false);
    expect(k.draws.some(d => d.objects.includes(glass))).toBe(false);
    job.pace(null);
    for (let f = 0; f < 2000 && job.running; f++) await k.frame();
    expect(job.stats.phase).toBe('done');
    expect([job.stats.sceneDone, job.stats.shadowDone, job.stats.twoPassDone]).toEqual([job.stats.sceneItems, job.stats.casters, 1]);
    expect(firstViewRest(job.stats).left).toBe(0);
  });
});
