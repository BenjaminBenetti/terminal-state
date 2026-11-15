// Task studio-flamethrower-vfx-20261115-001305-01 (the user: the flamethrower "does not look like a proper flamethrower: it feels like an
// orange gas thrower"; a forceful burning jet from the actual muzzle, hot core, rolling tongues, smoke — VISUAL ONLY, inside the existing
// reach): fire/fireFx.ts's stream look over the REAL FireSystem stream state (a stub world: open air, or a wall ahead):
//  - layers: hot core streaks and rolling body gouts leave the bell; the clinging-fire look (patches) keeps its own shapes;
//  - reach: no stream sprite is drawn past where the rules' aim ray stops (open air: the range; a wall: the wall), and the body stays in
//    the rules' widening cone; the front travels at FLAME.speed, so the head shows only once the flame has got there;
//  - release: the head burns on for the last flame's flight time, then nothing more is spawned;
//  - the stream light (game.ts's pooled muzzle light): placed half way as before, mean level kept, dimmed near a close surface;
//  - the flame material: a premultiplied ONE / ONE_MINUS_SRC_ALPHA blend (both backends), the target's alpha kept.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {FLAME, FLAME_FUEL} from '../src/fire/flamethrowerSpec';
import {FireSystem, streamRadius, type FireRayHit, type V3} from '../src/fire/fireSystem';
import {FIRE_FX, FLAME_SHAPES, FireFx, streamFlicker, streamLightAt, streamLightLevel} from '../src/fire/fireFx';

const EYE: V3 = {x: 0, y: 1.6, z: 0};
const FWD: V3 = {x: 0, y: 0, z: 1};
/** The drawn burner bell: right of, below and ahead of the eye (Viewmodel.muzzleDrawnWorld's kind of point). */
const BELL: V3 = {x: 0.2, y: 1.43, z: 0.72};
const DT = 1 / 60;

function rig(wallZ?: number) {
  const sys = new FireSystem();
  sys.env = {
    enemies: () => [], player: () => null, los: () => true, floorAt: () => 0, rand: () => 0.5,
    ray: (a, d, max): FireRayHit => {
      if (wallZ !== undefined && d.z > 1e-6) { const t = (wallZ - a.z) / d.z; if (t > 0 && t < max) return {t, kind: 'wall', nx: 0, ny: 0, nz: -1}; }
      return {t: max, kind: 'none', nx: 0, ny: 1, nz: 0};
    },
  };
  const scene = new THREE.Scene();
  const fx = new FireFx(scene);
  let acc = 0;
  /** `seconds` of frames at 60 Hz; the stream paid in FLAME_FUEL.unitSeconds ticks while `on` (as WeaponController does). */
  const run = (seconds: number, on: boolean, each?: () => void, held = true) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
      if (on) { acc += DT; while (acc >= FLAME_FUEL.unitSeconds - 1e-9) { acc -= FLAME_FUEL.unitSeconds; sys.flame(EYE, FWD, FLAME_FUEL.unitSeconds); } }
      sys.tick(DT);
      fx.frame(DT, sys, {muzzle: held ? BELL : null, pilot: held, eye: EYE});
      each?.();
    }
  };
  const start = () => { acc = FLAME_FUEL.unitSeconds; sys.streamStart(BELL); };
  const stop = () => { sys.streamEnd(false); };
  return {sys, fx, scene, run, start, stop};
}

const streamShapes = new Set<number>([FLAME_SHAPES.roll, FLAME_SHAPES.streak]);

describe('flamethrower stream look', () => {
  it('a burning jet from the bell: a hot core of streaks and a rolling body, plus smoke; the clinging fire keeps its own shapes', () => {
    const r = rig();
    r.start();
    r.run(1.2, true);
    const live = r.fx.qaFlames();
    const n = (s: number) => live.filter(f => f.shape === s).length;
    expect(n(FLAME_SHAPES.streak)).toBeGreaterThan(15);
    expect(n(FLAME_SHAPES.roll)).toBeGreaterThan(40);
    expect(r.fx.live.smoke).toBeGreaterThan(0);
    // the jet is attached to the bell: sprites within 0.3 m of it every frame of a running stream
    expect(live.some(f => Math.hypot(f.x - BELL.x, f.y - BELL.y, f.z - BELL.z) < 0.3)).toBe(true);
    // narrow near the bell, blooming toward its end: body gouts in the first two metres are far smaller than in the last two
    const along = (f: {z: number}) => f.z - BELL.z;
    const body = live.filter(f => f.shape === FLAME_SHAPES.roll);
    const mean = (a: {size: number}[]) => a.reduce((s, f) => s + f.size, 0) / Math.max(1, a.length);
    const near = body.filter(f => along(f) < 2), far = body.filter(f => along(f) > FLAME.range - 2.5);
    expect(near.length).toBeGreaterThan(3);
    expect(far.length).toBeGreaterThan(3);
    expect(mean(far)).toBeGreaterThan(mean(near) * 3);
    // the clinging fire it left (patches, no stream) draws only the standing tongues / gouts / sparks it always drew
    r.stop();
    r.run(1.5, false);
    expect(r.sys.patches.length).toBeGreaterThan(0);
    r.run(0.5, false);
    expect(r.fx.qaFlames().filter(f => streamShapes.has(f.shape))).toEqual([]);
  });

  it('respects the reach: nothing of the stream is drawn past where the aim ray stops, the body stays in the widening cone', () => {
    for (const wallZ of [undefined, 4, 1.6]) {
      const r = rig(wallZ);
      const reach = wallZ === undefined ? FLAME.range : wallZ;
      let worstPast = -Infinity, outside = 0, total = 0;
      r.start();
      r.run(1.5, true, () => {
        for (const f of r.fx.qaFlames()) {
          if (!streamShapes.has(f.shape)) continue;
          // (from the eye, as the rules measure the cone)
          worstPast = Math.max(worstPast, f.z - reach);
          total++;
          const rad = Math.hypot(f.x - EYE.x, f.y - EYE.y);
          if (rad > streamRadius(Math.max(0, f.z)) + 0.35) outside++;
        }
      });
      // (a head billow's centre rolls at most a few decimetres on; a splash runs along the wall, never through it)
      expect(worstPast, `reach ${reach}`).toBeLessThan(wallZ === undefined ? 0.5 : 0.12);
      // (rising tongues and billows lift off the top of the cone: the jet itself does not leave it)
      expect(outside / total, `reach ${reach}`).toBeLessThan(0.12);
    }
  });

  it('the front travels at FLAME.speed: the head appears only when the flame has arrived; after a release it burns on for the flight, then stops', () => {
    const wallZ = 6;
    const r = rig(wallZ);
    const atWall = () => r.fx.qaFlames().filter(f => streamShapes.has(f.shape) && f.z > wallZ - 0.6).length;
    r.start();
    r.run(0.15, true); // (front ~2.3 m out of a ~5.3 m flight)
    expect(atWall()).toBe(0);
    expect(Math.max(...r.fx.qaFlames().map(f => f.z))).toBeLessThan(BELL.z + FLAME.speed * 0.15 * 1.25 + 0.3);
    r.run(0.4, true); // (arrived at ~0.36 s)
    expect(atWall()).toBeGreaterThan(5);
    // released: the last flame is still in flight — the splash goes on for that flight, then dies
    r.stop();
    const flight = (wallZ - BELL.z) / FLAME.speed;
    const spawned = () => r.fx.counts.flames;
    let before = spawned();
    r.run(flight * 0.6, false);
    expect(spawned()).toBeGreaterThan(before);
    r.run(flight * 0.4 + 0.3, false);
    // with nothing burning there any more (patches put out) and the lance put away (no pilot flame), nothing more is spawned
    r.sys.patches.length = 0;
    r.run(0.1, false, undefined, false);
    before = spawned();
    r.run(0.6, false, undefined, false);
    expect(spawned()).toBe(before);
    r.fx.clear();
    expect(r.fx.live).toEqual({flames: 0, smoke: 0});
    expect(r.fx.qaFlames()).toEqual([]);
  });

  it('the stream light: half way along as before, its mean level kept, dimmed only when the surface it hits is close', () => {
    for (const reach of [0.5, 1.6, 3, 4.8, 8.5]) expect(streamLightAt(reach)).toBeCloseTo(Math.min(2.4, Math.max(0.8, reach * 0.5)), 9);
    let sum = 0, lo = Infinity, hi = -Infinity;
    const N = 20000;
    for (let i = 0; i < N; i++) { const v = streamFlicker(i * 0.0137); sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(sum / N).toBeCloseTo(1, 1);
    expect(lo).toBeGreaterThan(0.7);
    expect(hi).toBeLessThan(1.3);
    // (smooth: no frame-to-frame strobe at 60 Hz)
    for (let t = 0; t < 5; t += 0.05) expect(Math.abs(streamFlicker(t + DT) - streamFlicker(t))).toBeLessThan(0.08);
    const t0 = 1.234, f0 = streamFlicker(t0);
    expect(streamLightLevel(FLAME.range, t0)).toBeCloseTo(f0, 9); // open air / far: full
    expect(streamLightLevel(2.5, t0)).toBeLessThan(f0 * 0.6); // a wall 2.5 m ahead: dimmed
    expect(streamLightLevel(0.3, t0)).toBeCloseTo(f0 * FIRE_FX.streamLight.min, 9); // never dark
    const c = new THREE.Color(FIRE_FX.streamLight.color);
    expect(c.r).toBeGreaterThan(c.g);
    expect(c.g).toBeGreaterThan(c.b);
  });

  it('the flame material blends premultiplied light + occlusion (ONE, ONE_MINUS_SRC_ALPHA) and keeps the target alpha; smoke blends normally', () => {
    const r = rig();
    const flames = r.scene.getObjectByName('fire-flames') as THREE.Sprite, smoke = r.scene.getObjectByName('fire-smoke') as THREE.Sprite;
    const m = flames.material as THREE.Material;
    expect([m.blending, m.blendSrc, m.blendDst, m.blendEquation, m.blendSrcAlpha, m.blendDstAlpha]).toEqual(
      [THREE.CustomBlending, THREE.OneFactor, THREE.OneMinusSrcAlphaFactor, THREE.AddEquation, THREE.ZeroFactor, THREE.OneFactor]);
    expect([m.transparent, m.depthWrite, m.premultipliedAlpha]).toEqual([true, false, false]);
    expect((smoke.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    // the rings are pooled: the sprite counts never change with what burns
    const counts = () => [flames.count, smoke.count];
    const was = counts();
    r.start();
    r.run(1, true);
    expect(counts()).toEqual(was);
    expect(was).toEqual([FIRE_FX.flames, FIRE_FX.smoke]);
  });
});
