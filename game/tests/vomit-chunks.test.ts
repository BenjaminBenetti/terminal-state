// Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "... physical chunks like bullet casings."): THE FOOD CHUNKS
// (player/vomitChunks.ts) — a bounded pool (the oldest recycled), a lifetime (shrink-away, then gone), real physics against a generated
// market's statics (the casings' integrator rules: they fall, bounce low, slide, and REST on the floor / a counter top — lowest point on
// the surface, never floating or sunk), walls stop them, the station clear empties the pool; a physics BodySource; never items.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {VOMIT_CHUNKS, VomitChunks} from '../src/player/vomitChunks';
import {VomitAction, type VomitHost} from '../src/player/vomit';
import {StaticQuery} from '../src/physics/staticQuery';
import {PhysicsSystem} from '../src/physics/world';
import {generateMarketLevel} from '../src/gen/market/index';

const DT = 1 / 60;
const L = generateMarketLevel({levelSeed: 4242, layoutVersion: 1});
const Q = new StaticQuery(L);
const stall = L.market!.stalls.find(s => s.id === 'general')!;

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 0x100000000);
}

describe('vomit chunks: the pool', () => {
  it('bounded: never more than VOMIT_CHUNKS.max live (the oldest recycled), one draw call', () => {
    const c = new VomitChunks(() => Q);
    c.rand = seeded();
    for (let i = 0; i < VOMIT_CHUNKS.max + 25; i++) c.spawn(new THREE.Vector3(stall.front.x, 1.5, stall.front.z), new THREE.Vector3(0, -0.6, -0.8), 2);
    expect(c.live).toBe(VOMIT_CHUNKS.max);
    expect(c.counts).toMatchObject({spawned: VOMIT_CHUNKS.max + 25, recycled: 25});
    c.update(DT);
    expect(c.mesh.count).toBe(VOMIT_CHUNKS.max);
    expect(c.group.children).toEqual([c.mesh]);
    expect(c.mesh.instanceColor).not.toBeNull(); // (each chunk its own runtime colour)
  });

  it('lifetime: they shrink away over the last seconds and are gone after VOMIT_CHUNKS.life; clear() empties the pool at once', () => {
    const c = new VomitChunks(() => Q);
    c.rand = seeded(3);
    for (let i = 0; i < 10; i++) c.spawn(new THREE.Vector3(stall.front.x, 1.5, stall.front.z), new THREE.Vector3(0, -0.6, -0.8), 2);
    for (let t = 0; t < VOMIT_CHUNKS.life - 1; t += 0.1) c.update(0.1);
    expect(c.live).toBe(10);
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    c.mesh.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.length()).toBeLessThan(VOMIT_CHUNKS.size[1] * 2 * 0.6); // (shrinking)
    for (let t = 0; t < 1.5; t += 0.1) c.update(0.1);
    expect([c.live, c.mesh.count, c.counts.expired]).toEqual([0, 0, 10]);
    for (let i = 0; i < 5; i++) c.spawn(new THREE.Vector3(stall.front.x, 1.5, stall.front.z), new THREE.Vector3(0, -0.6, -0.8), 2);
    c.clear();
    expect([c.live, c.mesh.count]).toEqual([0, 0]);
  });

  it('a spawn point inside solid geometry spawns nothing', () => {
    const c = new VomitChunks(() => Q);
    const p = L.props.find(x => x.kind === 'shopCounter')!;
    expect(c.spawn(new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z), new THREE.Vector3(0, -1, 0), 2)).toBe(false);
    expect(c.live).toBe(0);
  });
});

describe('vomit chunks: physics', () => {
  it('thrown from a standing player\'s mouth they fall, bounce, slide and REST flat on the floor — never floating, never sunk', () => {
    const c = new VomitChunks(() => Q);
    c.rand = seeded(11);
    // the customer spot of a stall, facing away from the counter (open floor ahead)
    const mouth = new THREE.Vector3(stall.front.x, stall.front.y + 1.49, stall.front.z + 0.15);
    for (let i = 0; i < 20; i++) c.spawn(mouth, new THREE.Vector3(0, -0.58, 0.81), 2.3);
    const ys: number[] = [];
    for (let i = 0; i < 6 * 60; i++) { c.update(DT); ys.push(c.list()[0].y); }
    const list = c.list();
    expect(list.length).toBe(20);
    expect(Math.min(...ys)).toBeGreaterThan(stall.front.y - 1e-6); // (never under the floor)
    for (const k of list) {
      expect(k.mode, 'resting').toBe(2);
      expect(k.speed).toBe(0);
      expect(k.bounces).toBeGreaterThanOrEqual(1);
      const ground = Q.surfaceBelow(k.x, k.z, k.y + 0.05);
      expect(k.y - k.restH - ground).toBeCloseTo(0, 6); // (its lowest point on the surface)
      expect(k.restH).toBeGreaterThan(0.002);
      expect(Math.hypot(k.x - mouth.x, k.z - mouth.z)).toBeGreaterThan(0.2); // (thrown forward)
      expect(Math.hypot(k.x - mouth.x, k.z - mouth.z)).toBeLessThan(3);
    }
  });

  it('they land on a counter top too (a prop box is a surface), and a wall / prop side stops them', () => {
    const c = new VomitChunks(() => Q);
    c.rand = seeded(5);
    const p = L.props.find(x => x.kind === 'shopCounter' && x.area === stall.area)!;
    const top = p.y + p.h;
    for (let i = 0; i < 8; i++) c.spawn(new THREE.Vector3(p.x, top + 0.45, p.z), new THREE.Vector3(0, -1, 0), 0.6);
    for (let i = 0; i < 6 * 60; i++) c.update(DT);
    for (const k of c.list()) {
      expect(k.mode).toBe(2);
      const ground = Q.surfaceBelow(k.x, k.z, k.y + 0.05);
      expect(k.y - k.restH - ground).toBeCloseTo(0, 6);
    }
    expect(c.list().some(k => Math.abs(k.y - k.restH - top) < 1e-6)).toBe(true);
    // thrown hard at the counter's front from the customer side: never through it
    const d = new VomitChunks(() => Q);
    d.rand = seeded(9);
    for (let i = 0; i < 10; i++) d.spawn(new THREE.Vector3(p.x, p.y + 0.5, p.z + p.hz + 0.25), new THREE.Vector3(0, 0, -1), 4);
    for (let i = 0; i < 6 * 60; i++) d.update(DT);
    for (const k of d.list()) expect(k.z, 'stayed on the customer side').toBeGreaterThan(p.z + p.hz - 1e-6);
  });

  it('a physics BodySource: stepped by PhysicsSystem.update (no cannon body ever), cleared with the station', () => {
    const ph = new PhysicsSystem(null);
    ph.build(L);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
    const player = {alive: true, pitch: 0, eye: stall.front.y + 1.6, yaw: Math.PI, vx: 0, vz: 0};
    const h = {state: 'playing', player, camera, scene, physics: ph, frameHooks: [] as ((dt: number) => void)[], sectionHooks: [],
      modifierSources: [], inputOwners: []} as unknown as VomitHost;
    const sys = new VomitAction(h).install();
    sys.chunks.rand = seeded(2);
    camera.position.set(stall.front.x, player.eye, stall.front.z);
    camera.rotation.set(0, Math.PI, 0, 'YXZ');
    expect(sys.start()).toBe(true);
    const bodies = ph.world!.bodies.length;
    for (let i = 0; i < 8 * 60; i++) {
      player.eye = stall.front.y + 1.6;
      for (const f of h.frameHooks) f(DT);
      camera.position.set(stall.front.x, player.eye, stall.front.z);
      camera.updateMatrixWorld(true);
      ph.update(DT);
    }
    expect(sys.active).toBe(false);
    expect(sys.chunks.live).toBe(sys.counts.chunks);
    expect(ph.world!.bodies.length).toBe(bodies);
    for (const k of sys.chunks.list()) {
      expect(k.mode).toBe(2);
      expect(k.y - k.restH - Q.surfaceBelow(k.x, k.z, k.y + 0.05)).toBeCloseTo(0, 6);
    }
    ph.build(L); // (a new station: the old one's chunks go)
    expect(sys.chunks.live).toBe(0);
  });
});
