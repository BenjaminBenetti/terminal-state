// Task studio-screacher-reach-swing-20261116-053933-01: THE SCREACHER'S LONGER REACH (user: it "underuses its long arms and should
// reach a bit farther so it is more threatening"). The Attack clip of all four bodies was re-authored (a wider wind-up, the arm
// whipped round nearly straight, a stepping lunge, the hand at full length in front at the unchanged hit frame: 1.2 -> 1.45 m) and
// the swing's contact follows the visible motion (ai/screacher.ts SCREACHER_REACH):
//  - the brain: the full new reach straight ahead, tapering to the PREVIOUS reach off to the sides; one hit per swing on the impact
//    frame; never through a wall or across a storey; the body does not travel during the swing; every other number unchanged;
//  - the shipped GLBs (three's GLTFLoader / AnimationMixer / SkinnedMesh skinning): around the hit frame the swept right hand of
//    every body reaches at least what the swing is granted at each bearing (no invisible radial damage), and never further;
//  - the real actor + brain in the game's per-frame order: the frame that lands the claw SHOWS the hand at full reach in front.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {ATTACK_REACH_Y, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {SCREACHER_AGGRO, SCREACHER_ASSET, SCREACHER_REACH, SCREACHER_SENSE, SCREACHER_SPEED, SCREACHER_STATS, SCREACHER_VARIANTS, ScreacherBrain, screacherReachAt, type ScreacherVariantId} from '../src/ai/screacher';
import {ScreacherActor} from '../src/ai/screacherActor';

const DT = 1 / 60;
const VARIANTS = Object.keys(SCREACHER_VARIANTS) as ScreacherVariantId[];

interface Sim { px: number; pz: number; py?: number; los?: boolean }
function world(s: Sim): BrainWorld {
  return {px: s.px, pz: s.pz, py: s.py ?? 0, playerAlive: true, los: () => s.los ?? true, walkClear: () => true,
    findPath: (_ax, _az, bx, bz) => [[bx, bz, undefined, 0]], randomNear: () => null, rand: () => 0.5};
}
/** One frame: the brain, then the game's turn rule and a straight move (open floor). */
function step(b: ScreacherBrain, s: Sim): BrainOutput {
  const out = b.update(DT, world(s));
  if (out.face !== null) {
    const d = Math.atan2(Math.sin(out.face - b.yaw), Math.cos(out.face - b.yaw)), turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * DT;
    b.yaw += Math.max(-turn, Math.min(turn, d));
  }
  b.x += out.dirX * out.speed * DT;
  b.z += out.dirZ * out.speed * DT;
  return out;
}
/**
 * One swing: a Screacher at the origin facing +Z hears a sound `beliefM` m straight ahead (within its swing range: it swings at once)
 * while the silent player stands `d` m away at `bearing` (rad off its facing). Returns the hits, the swing / hit frames and how far
 * the body travelled during the swing.
 */
function swing(o: {d: number; bearing?: number; py?: number; los?: boolean; beliefM?: number}) {
  const b = new ScreacherBrain(0, 0, 0);
  b.echoT = 1e6;
  const a = o.bearing ?? 0, s: Sim = {px: Math.sin(a) * o.d, pz: Math.cos(a) * o.d, py: o.py, los: o.los};
  b.hearNoise(0, o.beliefM ?? 1.7, 11, 0, 'impact');
  let hits = 0, startF = -1, hitF = -1, travel = 0;
  for (let f = 0; f < Math.round(1.3 / DT); f++) {
    const out = step(b, s);
    if (b.attackSeq > 0 && startF < 0) startF = f;
    if (b.state === 'attack') travel = Math.max(travel, Math.hypot(b.x, b.z));
    if (out.attackHit) { hits++; if (hitF < 0) hitF = f; }
  }
  return {hits, swings: b.attackSeq, startF, hitF, travel, yaw: b.yaw};
}

describe('Screacher swing: the longer reach in front, the previous reach to the sides', () => {
  it('only the reach changed: 1.45 m hand reach in front (was 1.2) -> swing range 1.8 / contact 2.2 m (were 1.55 / 1.95); the rest as before', () => {
    expect(SCREACHER_ASSET.reachM).toBe(1.45);
    expect(SCREACHER_REACH.previousM).toBe(1.2);
    expect(SCREACHER_STATS.attackRange).toBeCloseTo(1.8, 6);
    expect(SCREACHER_STATS.hitRange).toBeCloseTo(2.2, 6);
    expect(SCREACHER_REACH.previousM + 0.3 + SCREACHER_REACH.slackM).toBeCloseTo(1.95, 6); // the previous contact distance
    // a modest increase: +0.25 m of hand reach (about a fifth), well short of the Strainer-style doubling
    expect(SCREACHER_REACH.frontM - SCREACHER_REACH.previousM).toBeCloseTo(0.25, 6);
    // damage, health, cadence, paces, senses and the swing's cone: unchanged
    expect(SCREACHER_STATS).toMatchObject({hp: 600, attackDamage: 16, attackDuration: 1.0, attackImpact: 0.42, attackCooldown: 0.6, wanderSpeed: 0.5,
      chaseSpeed: SCREACHER_SPEED.frenzy, sightRange: 0, radius: 0.34, turnRate: 5.0});
    expect(SCREACHER_STATS.lunge).toBeUndefined(); // no lunge travel: the body stays where it stands
    expect(SCREACHER_SPEED).toEqual({investigate: 1.25, hunt: 2.4, frenzy: 3.9});
    expect(SCREACHER_SENSE.touchM).toBe(0.94);
    expect(SCREACHER_REACH.coneA).toBe(1.2);
    // the profile: full straight ahead, tapering to the previous reach at taperA, the previous reach out to the cone's edge
    expect(screacherReachAt(0)).toBeCloseTo(1.45, 6);
    expect(screacherReachAt(SCREACHER_REACH.taperA / 2)).toBeCloseTo(1.325, 6);
    expect(screacherReachAt(-SCREACHER_REACH.taperA / 2)).toBeCloseTo(1.325, 6);
    for (const a of [SCREACHER_REACH.taperA, 0.9, SCREACHER_REACH.coneA]) expect(screacherReachAt(a)).toBeCloseTo(1.2, 6);
  });

  it('straight ahead the claw lands from up to 2.2 m (it did not past 1.95 m); not beyond', () => {
    for (const d of [1.2, 1.9, 2.1, 2.18]) expect(swing({d}).hits, `${d} m ahead`).toBe(1);
    for (const d of [2.25, 2.6]) expect(swing({d}).hits, `${d} m ahead`).toBe(0);
  });

  it('off to the side the extra reach tapers away: from +-0.6 rad to the cone edge the previous 1.95 m holds; the cone is unchanged', () => {
    for (const sg of [1, -1]) {
      expect(swing({d: 2.05, bearing: sg * 0.3}).hits, `${sg}: half way into the taper, inside`).toBe(1);
      expect(swing({d: 2.12, bearing: sg * 0.3}).hits, `${sg}: half way into the taper, outside`).toBe(0);
      for (const a of [0.7, 1.0, 1.15]) {
        expect(swing({d: 1.9, bearing: sg * a}).hits, `${sg * a} rad 1.9 m`).toBe(1);
        expect(swing({d: 2.0, bearing: sg * a}).hits, `${sg * a} rad 2.0 m: no new reach at the side`).toBe(0);
      }
      expect(swing({d: 1.2, bearing: sg * 1.3}).hits, `${sg}: outside the swing's cone`).toBe(0);
    }
  });

  it('never through a wall, never across a storey (the unchanged line and height rules)', () => {
    expect(swing({d: 2.1, los: false}).hits).toBe(0);
    expect(swing({d: 2.1, py: ATTACK_REACH_Y + 0.3}).hits).toBe(0);
    expect(swing({d: 2.1, py: -(ATTACK_REACH_Y + 0.3)}).hits).toBe(0);
    expect(swing({d: 2.1, py: 0.8}).hits).toBe(1); // (a step / ramp within reach height)
  });

  it('one hit per swing, on the impact frame; the body does not travel during the swing (no lunge, no teleport)', () => {
    const r = swing({d: 2.1});
    expect([r.swings, r.hits]).toEqual([1, 1]);
    expect(r.startF).toBe(0);
    const late = (r.hitF - r.startF) * DT - SCREACHER_STATS.attackImpact;
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThan(DT + 1e-9);
    expect(r.travel).toBe(0);
    expect(r.yaw).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ the shipped GLBs
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
async function loadStripped(path: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const skinnedOf = (root: THREE.Object3D) => { let m: THREE.SkinnedMesh | null = null; root.traverse(o => { if (!m && (o as THREE.SkinnedMesh).isSkinnedMesh) m = o as THREE.SkinnedMesh; }); return m! as THREE.SkinnedMesh; };
/** Vertices whose dominant bone is one of `bones`. */
function dominantOf(body: THREE.SkinnedMesh, bones: string[]): number[] {
  const idx = bones.map(n => body.skeleton.bones.findIndex(b => b.name === n)), ji = body.geometry.getAttribute('skinIndex'), jw = body.geometry.getAttribute('skinWeight'), out: number[] = [];
  for (let i = 0; i < ji.count; i++) { let k0 = 0; for (let k = 1; k < 4; k++) if (jw.getComponent(i, k) > jw.getComponent(i, k0)) k0 = k; if (idx.includes(ji.getComponent(i, k0))) out.push(i); }
  return out;
}
/** Horizontal reach / bearing (rad off +Z) of each listed vertex, world space. */
function* reachOf(body: THREE.SkinnedMesh, verts: number[], ox = 0, oz = 0, yaw = 0): Generator<{r: number; a: number; y: number}> {
  const v = new THREE.Vector3();
  for (const i of verts) {
    body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld);
    const dx = v.x - ox, dz = v.z - oz, a = Math.atan2(dx, dz) - yaw;
    yield {r: Math.hypot(dx, dz), a: Math.atan2(Math.sin(a), Math.cos(a)), y: v.y};
  }
}

describe('Screacher swing vs the visible Attack of all four bodies (the shipped GLBs)', () => {
  const G = {} as Record<ScreacherVariantId, GLTF>;
  beforeAll(async () => {
    for (const v of VARIANTS) G[v] = await loadStripped(pub(ENEMY_MODEL_FILES[SCREACHER_VARIANTS[v].model].url));
  }, 120_000);

  it('around the hit frame the swept right arm reaches at least the granted reach at every bearing it extends, and never past the front reach', () => {
    const T = SCREACHER_ASSET.attackHitTime, binDeg = 2.5;
    for (const v of VARIANTS) {
      const root = G[v].scene, body = skinnedOf(root), mixer = new THREE.AnimationMixer(root);
      const act = mixer.clipAction(G[v].animations.find(c => c.name === 'Attack')!);
      const arm = dominantOf(body, ['R_Hand', 'R_Forearm']), hand = dominantOf(body, ['R_Hand']);
      expect(arm.length, v).toBeGreaterThan(100);
      const pose = (t: number) => { act.reset().play(); mixer.setTime(t); root.updateMatrixWorld(true); };
      // the swept envelope: farthest arm vertex per 2.5-degree bearing over the hit frame +- 0.1 s (600 samples a second)
      const env = new Map<number, number>();
      for (let t = T - 0.1; t <= T + 0.1 + 1e-9; t += 1 / 600) {
        pose(t);
        for (const p of reachOf(body, arm)) { const k = Math.round(p.a * 180 / Math.PI / binDeg); if (!(env.get(k)! >= p.r)) env.set(k, p.r); }
      }
      const kMax = Math.floor(SCREACHER_REACH.taperA * 180 / Math.PI / binDeg);
      for (let k = -kMax; k <= kMax; k++) {
        const need = screacherReachAt(k * binDeg * Math.PI / 180);
        expect(env.get(k) ?? 0, `${v}: the arm at ${k * binDeg} deg vs the granted ${need.toFixed(3)} m`).toBeGreaterThanOrEqual(need - 0.02);
      }
      // ... and the hand never reaches further than the swing is granted in front (no visible claw passing through a player unhurt)
      let most = 0, mostT = 0;
      const atFull: number[] = [];
      for (let f = 0; f <= 60; f++) {
        pose(f / 60);
        let r = 0; for (const p of reachOf(body, hand)) r = Math.max(r, p.r);
        if (r > most) { most = r; mostT = f / 60; }
        if (r >= SCREACHER_REACH.frontM - 0.02) atFull.push(f / 60);
      }
      expect(most, v).toBeLessThan(SCREACHER_REACH.frontM + 0.03);
      expect(Math.abs(most - SCREACHER_REACH.frontM), v).toBeLessThan(0.02);
      // the full reach is shown around the hit frame only (0.40-0.467 s: the frame the game lands it on at 30-60 fps), not before / after
      expect(atFull.length, v).toBeGreaterThan(0);
      for (const t of atFull) { expect(t, `${v}: full reach at ${t}`).toBeGreaterThan(T - 0.035); expect(t, `${v}: full reach at ${t}`).toBeLessThan(T + 0.06); }
      expect(Math.abs(mostT - T), v).toBeLessThan(0.06);
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
  });

  it('the lunge is a step in place: the pelvis travels a modest way forward and comes back; the clip never moves the root', () => {
    for (const v of VARIANTS) {
      const clip = G[v].animations.find(c => c.name === 'Attack')!, hips = clip.tracks.find(t => t.name === 'Hips.position')!;
      expect(clip.tracks.filter(t => t.name.endsWith('.position')).map(t => t.name)).toEqual(['Hips.position']);
      const z = Array.from({length: hips.times.length}, (_, f) => hips.values[f * 3 + 2]), n = z.length - 1;
      const zMax = Math.max(...z);
      expect(zMax - z[0], `${v}: the step forward`).toBeGreaterThan(0.12);
      expect(zMax - z[0], `${v}: a step, not a slide across the room`).toBeLessThan(0.4);
      for (let k = 0; k < 3; k++) expect(Math.abs(hips.values[n * 3 + k] - hips.values[k]), `${v}: back where it started`).toBeLessThan(0.01);
    }
  });

  it('the real actor + brain in the game\'s frame order: the frame that lands the claw shows the hand at full reach in front of it', async () => {
    /**
     * A fresh actor (from a fresh load: the other tests pose the shared scenes) hears a sound `soundM` m ahead where the silent player
     * stands; standing right there it swings at once, from further away it runs up first (frenzied). Each frame: the brain, the turn
     * and the move, the claw (out.attackHit), THEN the animation (game.ts updateZombies) — the pose the frame shows.
     */
    const strike = (g: GLTF, v: ScreacherVariantId, soundM: number) => {
      const a = new ScreacherActor(g, {x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, archetype: 'screacher', variant: v}, () => 0.5);
      const b = a.brain, body = a.meshes[0], hand = dominantOf(body, ['R_Hand']), s: Sim = {px: 0, pz: soundM};
      b.echoT = 1e6;
      b.hearNoise(s.px, s.pz, 30, 0, 'impact');
      if (soundM > 3) b.heat = SCREACHER_AGGRO.frenzyAt + 0.5;
      let hits = 0, shown = {r: 0, a: 0, y: 0};
      const before = new Set<string>([a.clip ?? '']); // (the clip it stood in: the standing one swings on the first frame)
      for (let f = 0; f < 150 && !hits; f++) {
        const out = step(b, s);
        a.animate(DT, out.anim, out.speed);
        a.syncTransform();
        a.root.position.y = b.y;
        a.root.updateMatrixWorld(true);
        if (b.attackSeq === 0) before.add(a.clip ?? '');
        if (!out.attackHit) continue;
        hits++;
        for (const p of reachOf(body, hand, b.x, b.z, b.yaw)) if (p.r > shown.r) shown = p;
      }
      const clip = a.clip, scale = a.scale;
      a.dispose();
      return {hits, shown, before: [...before], clip, scale};
    };
    for (const v of VARIANTS) {
      const g = await loadStripped(pub(ENEMY_MODEL_FILES[SCREACHER_VARIANTS[v].model].url));
      for (const [label, soundM, from] of [['standing', SCREACHER_REACH.frontM + 0.3, 'Idle'], ['after a run-up', 6, 'Run']] as const) {
        const r = strike(g, v, soundM);
        expect(r.scale).toBeCloseTo(1, 6);
        expect(r.before, `${v} ${label}`).toContain(from);
        expect([r.hits, r.clip], `${v} ${label}`).toEqual([1, 'Attack']);
        expect(r.shown.r, `${v} ${label}: the hand's reach on the hit frame`).toBeGreaterThan(SCREACHER_REACH.frontM - 0.04);
        expect(Math.abs(r.shown.a), `${v} ${label}: in front`).toBeLessThan(0.25);
        expect(r.shown.y, `${v} ${label}: at chest height`).toBeGreaterThan(1.15);
        expect(r.shown.y).toBeLessThan(1.6);
      }
    }
  }, 120_000);
});
