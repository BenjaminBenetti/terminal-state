// Task studio-skywalk-loot-performance-20261116-022934-01: the user's Skyways recording lost its frames to a main-thread pause every
// ~6 frames that runs between frames when there is idle time and inside the frame when there is none, and comes sooner when a frame
// does more (the mirror views) — allocation-paced garbage collection. The per-frame hot paths that made the most garbage of the
// game's own code at that station now allocate nothing; these checks pin that they still compute exactly what they computed:
//  - the zombie body separation (ai/motor.ts shoveApart) against the loop it replaced, bit for bit, on random crowds;
//  - the pooled zombie hit volumes (ZombieActor.updateVolumes) against the pose's own bone positions, frame after frame, with the
//    Sprint's elbow split and back.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {sameLevel, shoveApart, type ShoveBody} from '../src/ai/motor';
import {ZombieActor, type HitVolume} from '../src/ai/zombieActor';
import {mulberry32} from '../src/core/rng';
import type {ZombieSpawn} from '../src/gen/stationTypes';

type Body = ShoveBody & {brain: {x: number; y: number; z: number; alive: boolean; climbing: boolean; stats: {radius: number}}};

/** The separation loop as Game.updateZombies ran it before (reference). */
function shoveReference(z: Body, b: Body['brain'], zombies: readonly Body[], ease: number): void {
  for (const o of zombies) {
    if (o === z || !o.brain.alive || !sameLevel(b.y, o.brain.y) || (o.placesRoot && o.brain.climbing)) continue;
    const dx = b.x - o.brain.x, dz = b.z - o.brain.z, d = Math.hypot(dx, dz), min = b.stats.radius + o.brain.stats.radius;
    if (d > 1e-4 && d < min) { const push = Math.min((min - d) * 0.5, ease); b.x += dx / d * push; b.z += dz / d * push; }
  }
}

function crowd(seed: number, n: number): Body[] {
  const r = mulberry32(seed), out: Body[] = [];
  for (let i = 0; i < n; i++) {
    const bb = r() < 0.15;
    out.push({placesRoot: bb ? true : undefined, brain: {x: r() * 5, z: r() * 5, y: [0, 0.4, 4][Math.floor(r() * 3)], alive: r() > 0.1, climbing: bb && r() < 0.5, stats: {radius: 0.2 + r() * 0.25}}});
  }
  // two bodies on the very same spot (d ~ 0: never pushed), one exactly touching another (|dx| = min: never pushed)
  out[1].brain.x = out[0].brain.x; out[1].brain.z = out[0].brain.z; out[1].brain.y = out[0].brain.y;
  out[3].brain.x = out[2].brain.x + out[2].brain.stats.radius + out[3].brain.stats.radius; out[3].brain.z = out[2].brain.z; out[3].brain.y = out[2].brain.y;
  // (just inside along a diagonal: |dx|, |dz| < min, hypot < min — pushed)
  out[5].brain.x = out[4].brain.x + 0.3; out[5].brain.z = out[4].brain.z - 0.3; out[5].brain.y = out[4].brain.y; out[5].brain.alive = out[4].brain.alive = true;
  return out;
}

const copy = (c: readonly Body[]): Body[] => c.map(o => ({placesRoot: o.placesRoot, brain: {...o.brain, stats: {...o.brain.stats}}}));

describe('per-frame hot paths without garbage keep their results', () => {
  it('shoveApart moves every body exactly as the loop it replaced (random crowds, eased and free pushes, several frames)', () => {
    for (const seed of [1, 7, 42, 2026, 31337]) {
      const a = crowd(seed, 43), b = copy(a);
      for (let frame = 0; frame < 4; frame++) {
        for (let i = 0; i < a.length; i++) {
          const ease = a[i].placesRoot ? 0.04 : Infinity;
          if (!a[i].brain.alive || a[i].brain.climbing) continue;
          shoveApart(a[i], a[i].brain, a, ease);
          shoveReference(b[i], b[i].brain, b, ease);
        }
        for (let i = 0; i < a.length; i++) {
          expect(a[i].brain.x, `seed ${seed} frame ${frame} body ${i} x`).toBe(b[i].brain.x);
          expect(a[i].brain.z, `seed ${seed} frame ${frame} body ${i} z`).toBe(b[i].brain.z);
        }
      }
      // (the crowd really overlaps: the pass moved bodies)
      expect(a.some((o, i) => o.brain.x !== crowd(seed, 43)[i].brain.x)).toBe(true);
    }
  });

  const BONES: Record<string, [number, number, number]> = {
    Hips: [0, 1, 0], Neck: [0, 1.5, 0.02], Head: [0.01, 1.66, 0.06],
    L_UpperArm: [0.2, 1.45, 0], L_Forearm: [0.32, 1.2, 0.1], L_Hand: [0.3, 0.98, 0.25],
    R_UpperArm: [-0.2, 1.45, 0], R_Forearm: [-0.3, 1.22, -0.08], R_Hand: [-0.28, 1.0, -0.22],
    L_Thigh: [0.1, 0.95, 0], L_Foot: [0.12, 0.05, 0.08], R_Thigh: [-0.1, 0.95, 0], R_Foot: [-0.11, 0.05, -0.04],
  };
  const template = () => {
    const scene = new THREE.Group();
    for (const [name, p] of Object.entries(BONES)) { const b = new THREE.Bone(); b.name = name; b.position.set(...p); scene.add(b); }
    return {scene, animations: [] as THREE.AnimationClip[]} as never;
  };
  const spawn: ZombieSpawn = {x: 3, z: 4, yaw: 0.3, type: 'shambler', area: 0};
  /** The volumes the pose's bones give (the formulas of ZombieActor.updateVolumes, from fresh positions). */
  const expected = (z: ZombieActor, sprint: boolean) => {
    z.root.updateMatrixWorld(true);
    const at = (n: string) => { const v = new THREE.Vector3().setFromMatrixPosition(z.root.getObjectByName(n)!.matrixWorld); return {x: v.x, y: v.y, z: v.z}; };
    const s = z.scale, H = (z as unknown as {hit: {head: number; torso: number; arm: number; leg: number}}).hit;
    const head = at('Head'), neck = at('Neck');
    const up = {x: head.x + (head.x - neck.x) * 0.6, y: head.y + 0.09 * s, z: head.z + (head.z - neck.z) * 0.6};
    const arms = sprint
      ? [[at('L_UpperArm'), at('L_Forearm')], [at('L_Forearm'), at('L_Hand')], [at('R_UpperArm'), at('R_Forearm')], [at('R_Forearm'), at('R_Hand')]]
      : [[at('L_UpperArm'), at('L_Hand')], [at('R_UpperArm'), at('R_Hand')]];
    return [
      {part: 'head', a: up, b: null, r: H.head * s},
      {part: 'torso', a: at('Hips'), b: neck, r: H.torso * s},
      ...arms.map(([a, b]) => ({part: 'limb', a, b, r: H.arm * s})),
      {part: 'limb', a: at('L_Thigh'), b: at('L_Foot'), r: H.leg * s},
      {part: 'limb', a: at('R_Thigh'), b: at('R_Foot'), r: H.leg * s},
    ];
  };
  const plain = (v: readonly HitVolume[]) => v.map(x => ({part: x.part, a: {...x.a}, b: x.b ? {...x.b} : null, r: x.r}));

  it('ZombieActor.updateVolumes refreshes its own volumes in place, always with the current pose (chord, Sprint split, back, death)', () => {
    const z = new ZombieActor(template(), spawn, mulberry32(5));
    const setClip = (c: string) => { (z as unknown as {current: string}).current = c; };
    setClip('Walk');
    const v1 = z.updateVolumes();
    expect(plain(v1)).toEqual(expected(z, false));
    expect(z.hitVolumes).toBe(v1);
    // the next frame: a new pose — the same list and objects, the new positions (nothing stale)
    z.root.position.set(5, 0.2, -1); z.root.rotation.y = 1.1;
    const v2 = z.updateVolumes();
    expect(v2).toBe(v1);
    expect(plain(v2)).toEqual(expected(z, false));
    // the Sprint: one capsule per arm segment, meeting at the elbow
    setClip('Sprint');
    z.root.position.set(-2, 0, 7);
    const s = z.updateVolumes();
    expect(plain(s)).toEqual(expected(z, true));
    expect(s.map(v => v.part)).toEqual(['head', 'torso', 'limb', 'limb', 'limb', 'limb', 'limb', 'limb']);
    expect(s[2].b).toBe(s[3].a);
    expect(s[4].b).toBe(s[5].a);
    // back to the chord (the Sprint's list is not reused for it)
    setClip('Run');
    const c = z.updateVolumes();
    expect(c.length).toBe(6);
    expect(plain(c)).toEqual(expected(z, false));
    // dead: no volumes
    (z.brain as unknown as {state: string}).state = 'dead';
    expect(z.updateVolumes()).toEqual([]);
    expect(z.hitVolumes.length).toBe(0);
  });

  it('two actors never share volume objects', () => {
    const a = new ZombieActor(template(), spawn, mulberry32(1)), b = new ZombieActor(template(), {...spawn, x: 9}, mulberry32(2));
    const va = a.updateVolumes(), vb = b.updateVolumes();
    for (const v of va) { expect(vb).not.toContain(v); for (const w of vb) { expect(w.a).not.toBe(v.a); } }
    expect(plain(va)).toEqual(expected(a, false));
    expect(plain(vb)).toEqual(expected(b, false));
  });
});
