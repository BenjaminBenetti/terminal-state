// Task studio-sprinter-gait-20261112-063646-01: the SPRINTER's own sprint clip (ai/sprintGait.ts). User: "Give sprinter zombies a
// genuinely distinct sprint animation. The current regular-zombie run clip played faster is not sufficient: the player should clearly see
// a sprinting gait/pose rather than a sped-up shamble. ... Normal zombies must keep their current animation. Keep footstep/stride
// matching sensible across the existing body scales, without speeding attack animations or changing movement/collision behavior."
// Every shipped zombie body (and the legacy template) is checked: the clip builds on its own rig, the stance sole stays on the floor
// without sliding at the sprint pace, nothing sinks through the floor, and the gait differs measurably from the Run it replaces.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {ZOMBIE_BODIES} from '../src/ai/outfits';
import {MODEL_FILES} from '../src/assets/manifest';
import {SPRINT_CLIP, SPRINT_STEP_M, buildSprintClip, sprintClipFor, sprintRigOf} from '../src/ai/sprintGait';
import {CLIP_GROUND_SPEED, GAIT_TIME_SCALE, SPRINT_MIN_TIME_SCALE, ZombieActor, gaitTimeScale} from '../src/ai/zombieActor';
import {SPRINTER, isSprinter} from '../src/ai/sprinter';
import {ROSTER_VERSION} from '../src/ai/enemyRoster';
import {LEVELS} from '../src/levels/registry';
import {mulberry32} from '../src/core/rng';
import {SPRINTER_STATS, ZOMBIE_STATS} from '../src/ai/brain';
import {ZOMBIE_CUES} from '../src/ai/creatureArchetypes';
import type {Sfx} from '../src/audio/sfx';
import type {ZombieSpawn} from '../src/gen/stationTypes';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const fileOf = (model: string) => (MODEL_FILES as Record<string, {url: string} | undefined>)[model]?.url ?? (model === 'zombie' ? LEGACY : undefined);
/** The legacy single template (game.ts buildEnemyActor's fallback when no registry body loaded; not in the manifest). */
const LEGACY = 'assets/models/zombie-rigged.glb';
const MODELS = [...ZOMBIE_BODIES.map(b => b.model), 'zombie'];

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(here('../public/' + url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const spawn = (o: Partial<ZombieSpawn> = {}): ZombieSpawn => ({x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, ...o});

/** A posed clone of a body GLB at clip times: bone world positions, the body's lowest skinned vertex and each sole's lowest point. */
class Posed {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private readonly body: THREE.SkinnedMesh;
  private readonly footOf: Int8Array; // per vertex: 0 = left foot, 1 = right foot, -1 = other (heaviest weight)
  private readonly v = new THREE.Vector3();
  constructor(gltf: GLTF) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.body = this.root.getObjectByName('ZombieBody') as THREE.SkinnedMesh;
    const g = this.body.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), bones = this.body.skeleton.bones;
    this.footOf = new Int8Array(si.count).fill(-1);
    for (let i = 0; i < si.count; i++) {
      let best = 0, j = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > best) { best = sw.getComponent(i, k); j = si.getComponent(i, k); }
      const n = bones[j]?.name;
      this.footOf[i] = n === 'L_Foot' ? 0 : n === 'R_Foot' ? 1 : -1;
    }
  }
  /** Pose the clone at clip time t (s) of `clip` alone. */
  at(clip: THREE.AnimationClip, t: number): this {
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(clip);
    a.reset().play();
    a.time = t;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    return this;
  }
  bone(name: string): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(this.root.getObjectByName(name)!.matrixWorld);
  }
  /** Lowest skinned body vertex (m) and the lowest vertex of each sole. */
  floor(): {min: number; L: number; R: number} {
    let min = Infinity, L = Infinity, R = Infinity;
    const n = this.body.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      const y = this.body.getVertexPosition(i, this.v).applyMatrix4(this.body.matrixWorld).y;
      if (y < min) min = y;
      if (this.footOf[i] === 0 && y < L) L = y;
      if (this.footOf[i] === 1 && y < R) R = y;
    }
    return {min, L, R};
  }
}

/** Angle (deg) between a bone segment and straight down, signed + forward (+z) — thigh flexion when a = thigh, b = shin joint. */
const swingDeg = (a: THREE.Vector3, b: THREE.Vector3): number => Math.atan2(b.z - a.z, a.y - b.y) * 180 / Math.PI;
/** Interior angle (deg) of a joint b between a and c, 180 = straight. */
const jointDeg = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number => a.clone().sub(b).angleTo(c.clone().sub(b)) * 180 / Math.PI;
function corr(x: number[], y: number[]): number {
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

interface GaitStats {
  /** Hand z relative to the hips (m): min / max per hand, and their fore-aft correlation (L vs R) and with the same-side foot. */
  handMin: number; handMax: number; handsCorr: number; armLegCorr: number;
  /** Largest forward thigh swing (world, deg) and smallest knee angle (deg, 180 = straight) over the cycle. */
  thighMax: number; kneeMin: number;
  /** Largest hip flexion relative to the pelvis (deg). */
  hipFlexMax: number;
  /** Trunk lean (deg from vertical, hips -> neck), mean over the cycle. */
  lean: number;
}
function gaitStats(p: Posed, clip: THREE.AnimationClip, N = 48): GaitStats {
  const hl: number[] = [], hr: number[] = [], fl: number[] = [];
  let thighMax = -Infinity, kneeMin = Infinity, hipFlexMax = -Infinity, lean = 0;
  const inv = new THREE.Matrix4();
  for (let k = 0; k < N; k++) {
    p.at(clip, clip.duration * k / N);
    const hips = p.bone('Hips');
    hl.push(p.bone('L_Hand').z - hips.z); hr.push(p.bone('R_Hand').z - hips.z); fl.push(p.bone('L_Foot').z - hips.z);
    for (const s of ['L', 'R']) {
      const th = p.bone(`${s}_Thigh`), sh = p.bone(`${s}_Shin`), ft = p.bone(`${s}_Foot`);
      thighMax = Math.max(thighMax, swingDeg(th, sh));
      kneeMin = Math.min(kneeMin, jointDeg(th, sh, ft));
      inv.copy(p.root.getObjectByName('Hips')!.matrixWorld).invert();
      hipFlexMax = Math.max(hipFlexMax, swingDeg(th.clone().applyMatrix4(inv), sh.clone().applyMatrix4(inv)));
    }
    const neck = p.bone('Neck');
    lean += Math.atan2(neck.z - hips.z, neck.y - hips.y) * 180 / Math.PI / N;
  }
  return {handMin: Math.min(...hl, ...hr), handMax: Math.max(...hl, ...hr), handsCorr: corr(hl, hr), armLegCorr: corr(hl, fl), thighMax, kneeMin, hipFlexMax, lean};
}

describe('sprinter gait: the Sprint clip on every shipped body rig', () => {
  const models: Record<string, GLTF> = {};
  beforeAll(async () => {
    for (const m of MODELS) { const u = fileOf(m); if (u && existsSync(here('../public/' + u))) models[m] = await loadStripped(u); }
  }, 180_000);

  it('every body (+ the legacy template) has the shared rig: the clip builds (17 joint rotations + the hips), one seamless loop', () => {
    expect(Object.keys(models).sort()).toEqual([...MODELS].sort());
    for (const m of MODELS) {
      const rig = sprintRigOf(SkeletonUtils.clone(models[m].scene));
      expect(rig, m).not.toBeNull();
      expect(rig!.toeZ, `${m}: sole measured from the mesh`).toBeGreaterThan(rig!.bind.L_Foot[2] + 0.08);
      expect(rig!.heelZ, m).toBeLessThan(rig!.bind.L_Foot[2]);
      const clip = buildSprintClip(rig!);
      expect([clip.name, clip.duration]).toEqual([SPRINT_CLIP.name, SPRINT_CLIP.duration]);
      expect(clip.tracks.length).toBe(18);
      expect(clip.tracks.filter(t => t.name.endsWith('.quaternion')).length).toBe(17);
      expect(clip.tracks.map(t => t.name)).toContain('Hips.position');
      for (const t of clip.tracks) {
        const n = t.getValueSize(), last = t.values.length - n;
        expect(t.times.length, t.name).toBe(Math.round(SPRINT_CLIP.duration * SPRINT_CLIP.fps) + 1);
        for (let c = 0; c < n; c++) expect(t.values[last + c], `${m} ${t.name}: last frame = first`).toBeCloseTo(t.values[c], 6);
      }
      // one clip per body model, shared by its actors; a template without the rig gets none (the actor keeps the Run)
      const again = sprintClipFor(SkeletonUtils.clone(models[m].scene), models[m].animations);
      expect(sprintClipFor(SkeletonUtils.clone(models[m].scene), models[m].animations)).toBe(again);
    }
    expect(sprintClipFor(new THREE.Group(), [])).toBeNull();
  });

  it('floor: the stance sole stays on the floor and travels back at the sprint pace (no slide); nothing sinks through; a flight phase', () => {
    const T = SPRINT_CLIP.duration, D = SPRINT_CLIP.duty, N = 64;
    for (const m of MODELS) {
      const rig = sprintRigOf(SkeletonUtils.clone(models[m].scene))!, clip = buildSprintClip(rig), p = new Posed(models[m]);
      let lowest = Infinity, flight = 0, stanceHigh = 0;
      const slide: number[] = [];
      for (let k = 0; k < N; k++) {
        const ph = k / N, f = p.at(clip, ph * T).floor();
        lowest = Math.min(lowest, f.min);
        if (f.L > 0.03 && f.R > 0.03) flight++;
        // a foot in its flat mid-stance (stance 15-45 %): the sole on the floor, the ankle moving back at the ground speed
        for (const [side, off] of [['L', 0], ['R', 0.5]] as const) {
          const s = (((ph - off) % 1) + 1) % 1 / D;
          if (s < 0.15 || s > 0.45) continue;
          stanceHigh = Math.max(stanceHigh, Math.abs(f[side]));
          const z0 = p.at(clip, ph * T).bone(`${side}_Foot`).z, z1 = p.at(clip, ph * T + 0.01).bone(`${side}_Foot`).z;
          slide.push((z1 - z0) / 0.01);
        }
      }
      expect(lowest, `${m}: lowest skinned vertex`).toBeGreaterThan(-0.015);
      expect(stanceHigh, `${m}: mid-stance sole height`).toBeLessThan(0.02);
      for (const v of slide) expect(v, `${m}: stance foot speed`).toBeCloseTo(-SPRINT_CLIP.groundSpeed, 0);
      expect(flight / N, `${m}: share of the cycle with both feet off the floor`).toBeGreaterThan(0.3);
    }
  });

  it('distinct from the Run it replaces: pumping contralateral arms, knee drive + heel kick, a slower cadence for a longer stride', () => {
    for (const m of MODELS) {
      const run = models[m].animations.find(a => a.name === 'Run')!;
      const rig = sprintRigOf(SkeletonUtils.clone(models[m].scene))!, p = new Posed(models[m]);
      const S = gaitStats(p, buildSprintClip(rig)), R = gaitStats(p, run);
      console.log(`[sprint gait] ${m}: sprint ${JSON.stringify(S, (_k, v) => typeof v === 'number' ? +v.toFixed(2) : v)} | run ${JSON.stringify(R, (_k, v) => typeof v === 'number' ? +v.toFixed(2) : v)}`);
      // arms: the Run reaches both hands forward; the sprint swings each hand fore and aft past the hips, against the other hand and its own leg
      expect(R.handMin, `${m}: the Run's hands stay out in front`).toBeGreaterThan(0.25);
      expect(S.handMin, `${m}: a sprint hand swings back past the hips`).toBeLessThan(0.05);
      expect(S.handMax - S.handMin, `${m}: arm pump range`).toBeGreaterThan(0.35);
      expect(S.handsCorr, m).toBeLessThan(-0.9);
      expect(S.armLegCorr, `${m}: contralateral arm swing`).toBeLessThan(-0.7);
      // legs: the knee drives the thigh higher and the heel folds up further behind than in the Run
      expect(S.thighMax, `${m}: knee drive`).toBeGreaterThan(R.thighMax + 4);
      expect(S.thighMax).toBeGreaterThan(55);
      expect(S.kneeMin, `${m}: heel kick`).toBeLessThan(R.kneeMin - 4);
      expect(S.lean, `${m}: leans into the run`).toBeGreaterThan(15);
      // ... within the joint range the wardrobe's fitted garments were validated in (tools/asset-pipeline/zombie/lib/extreme-poses.mjs:
      // hip flexion ~80 deg, knee ~115 deg) plus a small margin, so trousers and coat skirts follow without new poke-through (the legacy
      // template wears no fitted garment: its own coat, a little more room)
      expect(S.hipFlexMax, `${m}: hip flexion vs the pelvis`).toBeLessThan(86);
      expect(180 - S.kneeMin, `${m}: knee flexion`).toBeLessThan(m === 'zombie' ? 130 : 126);
    }
    // cadence at the sprinter's pace on every body scale: ~3.1 steps/s (the old Run sped up: ~5); a stride ~1.6x the Run's
    for (const scale of [0.95, 1, 1.05]) {
      const sprint = 2 * gaitTimeScale('Sprint', SPRINTER.chaseSpeed, scale, SPRINTER_STATS.shambler) / SPRINT_CLIP.duration;
      const old = 2 * gaitTimeScale('Run', SPRINTER.chaseSpeed, scale, SPRINTER_STATS.shambler) / 0.75;
      expect(sprint).toBeGreaterThan(2.9);
      expect(sprint).toBeLessThan(3.4);
      expect(sprint / old).toBeLessThan(0.7);
      expect(SPRINTER.chaseSpeed / sprint, 'step length (m)').toBeCloseTo(SPRINT_STEP_M * scale, 6);
    }
  });
});

describe('sprinter gait: the actor', () => {
  let body: GLTF;
  beforeAll(async () => { body = await loadStripped(fileOf('zombieBody_lastshift')!); }, 60_000);

  it('gaitTimeScale: the Sprint covers the sprint pace at ~1 / scale (never a sped-up cycle); Walk / Run playback unchanged', () => {
    for (const scale of [0.95, 1, 1.05]) {
      const ts = gaitTimeScale('Sprint', SPRINTER.chaseSpeed, scale, SPRINTER_STATS.shambler);
      expect(ts * CLIP_GROUND_SPEED.Sprint * scale).toBeCloseTo(SPRINTER.chaseSpeed, 9);
      expect(ts).toBeCloseTo(1 / scale, 9);
      expect(gaitTimeScale('Sprint', 0.5, scale, SPRINTER_STATS.shambler)).toBe(SPRINT_MIN_TIME_SCALE); // braking in a sharp turn
      expect(gaitTimeScale('Sprint', 30, scale, SPRINTER_STATS.shambler)).toBe(GAIT_TIME_SCALE.max);
    }
    expect(CLIP_GROUND_SPEED.Sprint).toBe(SPRINTER.chaseSpeed);
    expect([CLIP_GROUND_SPEED.Walk, CLIP_GROUND_SPEED.Run]).toEqual([0.55, 2.3]);
    expect(GAIT_TIME_SCALE).toEqual({min: 0.35, max: 1.8});
  });

  it('only a sprinter spawn gets the Sprint, for its pursuit (Run) only; normal zombies, idle / roaming / attacks and RNG draws unchanged', () => {
    const draws = (s: ZombieSpawn) => { let n = 0; const rnd = () => { n++; return 0.37; }; const a = new ZombieActor(body, s, rnd); return {a, n}; };
    for (const type of ['shambler', 'coated'] as const) {
      const sp = draws(spawn({type, sprinter: true})), or = draws(spawn({type}));
      expect(sp.n, 'the caller\'s stream: the same draws').toBe(or.n);
      expect([sp.a.sprints, or.a.sprints]).toEqual([true, false]);
      expect(sp.a.authoredClip('Sprint')?.name).toBe('Sprint');
      expect(or.a.authoredClip('Sprint')).toBeNull(); // a normal zombie: exactly the body's own clips
      expect([sp.a.scale, sp.a.root.name, sp.a.hasRig]).toEqual([or.a.scale, or.a.root.name, or.a.hasRig]);
      for (const n of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) expect(sp.a.authoredClip(n), n).toBe(or.a.authoredClip(n));
    }
    // a special family's stand-in with a stale tag never sprints
    expect(draws(spawn({archetype: 'strainer', sprinter: true})).a.sprints).toBe(false);
    const a = new ZombieActor(body, spawn({sprinter: true}), () => 0.5), o = new ZombieActor(body, spawn(), () => 0.5);
    const mixer = (x: ZombieActor) => (x as unknown as {mixer: THREE.AnimationMixer}).mixer;
    const action = (x: ZombieActor, n: string) => { const c = x.authoredClip(n); return c ? mixer(x).existingAction(c) : null; };
    /** The clips playing at full weight. */
    const running = (x: ZombieActor) => ['Idle', 'Walk', 'Run', 'Sprint', 'Attack', 'Hit', 'Death'].filter(n => { const c = action(x, n); return !!c && c.isRunning() && c.getEffectiveWeight() > 0.99; });
    const hand = (x: ZombieActor) => { x.root.updateMatrixWorld(true); const h = new THREE.Vector3().setFromMatrixPosition(x.root.getObjectByName('R_Hand')!.matrixWorld), p = new THREE.Vector3().setFromMatrixPosition(x.root.getObjectByName('Hips')!.matrixWorld); return h.z - p.z; };
    const step = (x: ZombieActor, anim: 'Run' | 'Walk' | 'Attack', speed: number, n = 40) => { for (let i = 0; i < n; i++) x.animate(1 / 60, anim, speed); return x.updateVolumes(); };
    const vs = step(a, 'Run', SPRINTER.chaseSpeed), vo = step(o, 'Run', ZOMBIE_STATS.shambler.chaseSpeed);
    expect(running(a)).toEqual(['Sprint']);
    expect(running(o)).toEqual(['Run']);
    // hit volumes: while sprinting each bent arm is two capsules meeting at the elbow; the ordinary zombie keeps its six
    expect(vo.map(v => v.part)).toEqual(['head', 'torso', 'limb', 'limb', 'limb', 'limb']);
    expect(vs.map(v => v.part)).toEqual(['head', 'torso', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb']);
    expect(vs[2].b).toEqual(vs[3].a);
    expect(vs[4].b).toEqual(vs[5].a);
    let back = Infinity;
    for (let i = 0; i < 40; i++) { a.animate(1 / 60, 'Run', SPRINTER.chaseSpeed); back = Math.min(back, hand(a)); }
    expect(back, 'the sprinter\'s hand swings back past its hips').toBeLessThan(0.05);
    // the swing: the Attack clip at its authored rate (never sped up), the Sprint faded out beneath it; the ordinary zombie's swing
    // keeps its old blend with the Run (unchanged)
    a.brain.attackSeq++; o.brain.attackSeq++;
    const va = step(a, 'Attack', 0, 20);
    step(o, 'Attack', 0, 20);
    expect(running(a)).toEqual(['Attack']);
    expect(action(a, 'Sprint')!.getEffectiveWeight()).toBe(0);
    expect(running(o)).toEqual(['Run', 'Attack']);
    for (const x of [a, o]) {
      expect(action(x, 'Attack')!.getEffectiveTimeScale()).toBe(1);
      expect(action(x, 'Attack')!.time).toBeCloseTo(20 / 60, 6);
    }
    expect(va.length).toBe(6);
    // back to the pursuit: the Sprint again; wandering: the ordinary Walk, the ordinary footsteps
    step(a, 'Run', SPRINTER.chaseSpeed);
    expect(running(a)).toEqual(['Sprint']);
    expect(step(a, 'Walk', ZOMBIE_STATS.shambler.wanderSpeed).length).toBe(6);
    expect(running(a)).toEqual(['Walk']);
    expect(a.sprintFootfalls()).toBeNull();
  });

  it('a saved station\'s sprinters (regenerated on Continue / Retry / import) sprint; building the actors rerolls and mutates nothing', () => {
    const gen = () => LEVELS.subway.generate('main', {levelSeed: 2203, rosterVersion: ROSTER_VERSION});
    const layout = gen(), before = JSON.stringify(layout.zombies);
    expect(layout.zombies.filter(isSprinter).length, 'this seed holds sprinters').toBeGreaterThan(0);
    /** Every spawn's actor from one stream (as Game.spawnEnemy does), and the stream's next draw after the last actor. */
    const build = (zs: ZombieSpawn[]) => { const r = mulberry32(99); let n = 0; const rand = () => { n++; return r(); }; const actors = zs.map(z => new ZombieActor(body, z, rand)); return {actors, n, next: rand()}; };
    const tagged = build(layout.zombies), plain = build(layout.zombies.map(z => ({...z, sprinter: undefined})));
    expect([tagged.n, tagged.next]).toEqual([plain.n, plain.next]); // later actors, loot and every other draw: the same stream
    expect(tagged.actors.map(a => a.scale)).toEqual(plain.actors.map(a => a.scale));
    expect(tagged.actors.map(a => a.sprints)).toEqual(layout.zombies.map(z => isSprinter(z)));
    expect(plain.actors.some(a => a.sprints)).toBe(false);
    expect(JSON.stringify(layout.zombies)).toBe(before); // the spawns (tags, indices, kill memory keys) untouched
    expect(JSON.stringify(gen().zombies)).toBe(before); // a revisit regenerates the same sprinters
    for (const a of [...tagged.actors, ...plain.actors]) a.dispose();
  });

  it('footsteps follow the Sprint\'s foot strikes on every body scale: one per step of SPRINT_STEP_M x scale; the zombie cue plays them', () => {
    for (const r of [0, 0.5, 1]) { // body scale 0.95 / 1.0 / 1.05 (ZombieActor: 0.95 + rand * 0.1)
      const a = new ZombieActor(body, spawn({sprinter: true}), () => r), dt = 1 / 60;
      let steps = 0, dist = 0;
      for (let i = 0; i < 360; i++) { a.animate(dt, 'Run', SPRINTER.chaseSpeed); dist += SPRINTER.chaseSpeed * dt; steps += a.sprintFootfalls() ?? 0; }
      expect(Math.abs(steps - dist / (SPRINT_STEP_M * a.scale)), `scale ${a.scale}: ${steps} steps over ${dist.toFixed(1)} m`).toBeLessThanOrEqual(1);
      // large frame steps (three frames' time at once) strike the same steps
      const b = new ZombieActor(body, spawn({sprinter: true}), () => r);
      let steps3 = 0;
      for (let i = 0; i < 120; i++) { b.animate(dt * 3, 'Run', SPRINTER.chaseSpeed); steps3 += b.sprintFootfalls() ?? 0; }
      expect(Math.abs(steps3 - steps)).toBeLessThanOrEqual(1);
    }
    // ZOMBIE_CUES: a sprinting sprinter's footfalls are its strikes (never the stride accumulator); an ordinary zombie keeps the accumulator
    const log: string[] = [];
    const sfx = {zombieGait: () => log.push('gait'), zombieFootfall: () => log.push('strike'), groan: () => {}, zombieClimb: () => {}} as unknown as Sfx;
    const s = new ZombieActor(body, spawn({sprinter: true}), () => 0.5), o = new ZombieActor(body, spawn(), () => 0.5);
    s.groanT = o.groanT = 1e9;
    for (let i = 0; i < 120; i++) {
      ZOMBIE_CUES.tick(sfx, s, 1 / 60, SPRINTER.chaseSpeed, 5, () => 0.5);
      s.animate(1 / 60, 'Run', SPRINTER.chaseSpeed);
    }
    expect(log.filter(l => l === 'gait').length).toBeLessThanOrEqual(1); // (the first tick, before the Sprint started)
    expect(log.filter(l => l === 'strike').length).toBeGreaterThanOrEqual(5); // ~3.1 steps/s for 2 s, the first ~0.3 s after the start
    expect(log.filter(l => l === 'strike').length).toBeLessThanOrEqual(7);
    log.length = 0;
    for (let i = 0; i < 30; i++) { ZOMBIE_CUES.tick(sfx, o, 1 / 60, 2.55, 5, () => 0.5); o.animate(1 / 60, 'Run', 2.55); }
    expect(new Set(log)).toEqual(new Set(['gait']));
  });
});
