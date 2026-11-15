// Task studio-reactor-glowing-zombies-20261115-013245-01: the irradiated zombies' radiation dose, Geiger counter and glow lights
// (world/irradiation.ts, world/glowLights.ts) — distances, bounds, lifecycle and the light pool's budget.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {GLSLNodeBuilder, MeshStandardNodeMaterial, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {mulberry32} from '../src/core/rng';
import {
  GEIGER, GeigerCounter, Irradiation, RADIATION, RADIATION_TOAST, clickRate, clusterShare, combinedClicks, combinedDose, doseRate,
  installIrradiation, type IrradiatedActor,
} from '../src/world/irradiation';
import {GLOW_LIGHT, GlowLight, GlowLightNode, GlowLightPool, installGlowLightNode, isGlowLight} from '../src/world/glowLights';
import {FlareLight, isFlareLight} from '../src/world/flareLight';
import {SMOKE_LIMITS, isGlowScatter} from '../src/render/smoke';

const actor = (x: number, y: number, z: number, scale = 1): IrradiatedActor & {brain: {alive: boolean}} => {
  const root = new THREE.Object3D();
  root.position.set(x, y, z);
  return {root, scale, brain: {alive: true}};
};

const player = (x = 0, y = 0, z = 0) => ({x, y, z, alive: true, hp: 100, takeDamage(a: number) { if (!this.alive) return; this.hp = Math.max(0, this.hp - a); if (this.hp <= 0) this.alive = false; }});

function rig(opts: {rand?: () => number} = {}) {
  const parent = new THREE.Scene();
  const clicks: {k: number; cluster: boolean}[] = [];
  const pains: number[] = [], toasts: string[] = [], glows = new Map<object, number>();
  const p = player();
  const scatter = {added: [] as THREE.PointLight[], removed: [] as THREE.PointLight[], addScatterLight(l: THREE.PointLight) { this.added.push(l); return true; }, removeScatterLight(l: THREE.PointLight) { this.removed.push(l); return true; }};
  const irr = new Irradiation(parent, {geigerClick: (k, cluster = false) => clicks.push({k, cluster})}, {
    player: () => p, eye: out => out.set(p.x, p.y + 1.6, p.z), pain: a => pains.push(a), toast: t => toasts.push(t), glow: (a, g) => glows.set(a, g),
  }, opts.rand ?? mulberry32(7));
  irr.smoke = scatter;
  return {irr, parent, clicks, pains, toasts, glows, p, scatter};
}

const run = (irr: Irradiation, seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) irr.frame(dt); };

describe('radiation dose: conservative radius, quadratic falloff, a bounded group', () => {
  it('one zombie: full dose touching, quadratic to 0 at the radius, nothing beyond', () => {
    expect(RADIATION.radiusM).toBe(4);
    expect(doseRate(0)).toBe(RADIATION.peakHpS);
    expect(doseRate(RADIATION.fullAtM)).toBe(RADIATION.peakHpS);
    expect(doseRate(2)).toBeCloseTo(((4 - 2) / 2.8) ** 2, 9);
    expect(doseRate(2.5)).toBeCloseTo(0.287, 3);
    expect(doseRate(3.99)).toBeLessThan(0.001);
    for (const d of [4, 4.01, 10, Infinity, Number.NaN]) expect(doseRate(d)).toBe(0);
    for (let d = 0; d < 4.5; d += 0.05) expect(doseRate(d + 0.05)).toBeLessThanOrEqual(doseRate(d));
  });

  it('a group: exact sum up to one peak, soft-capped above (continuous, never past the cap)', () => {
    expect(combinedDose(0.4)).toBe(0.4);
    expect(combinedDose(RADIATION.peakHpS)).toBe(RADIATION.peakHpS);
    expect(combinedDose(RADIATION.peakHpS + 1e-6)).toBeCloseTo(RADIATION.peakHpS, 5);
    let prev = 0;
    for (let s = 0; s <= 200; s += 0.25) {
      const c = combinedDose(s);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeLessThan(RADIATION.capHpS + 1e-9);
      prev = c;
    }
    expect(combinedDose(1000)).toBeCloseTo(RADIATION.capHpS, 6);
  });

  it('no accidental instant kill: twelve zombies on top of the player take >= 40 s to kill a 100 hp player by radiation alone', () => {
    const {irr, p} = rig();
    for (let k = 0; k < 12; k++) irr.adopt(actor(0.1 * k, 0, 0));
    run(irr, 10);
    expect(100 - p.hp).toBeLessThanOrEqual(RADIATION.capHpS * 10);
    expect(100 - p.hp).toBeGreaterThanOrEqual(RADIATION.capHpS * 10 - 2);
    run(irr, 29);
    expect(p.alive).toBe(true);
    run(irr, 12);
    expect(p.alive).toBe(false);
  });

  it('applied in whole hit points as it accrues; the pain vignette at most every painEveryS; one toast per exposure episode', () => {
    const {irr, p, pains, toasts} = rig();
    irr.adopt(actor(0, 0, 2)); // 2 m: 0.653 hp / s
    const seen: number[] = [];
    const take = p.takeDamage.bind(p);
    p.takeDamage = (a: number) => { seen.push(a); take(a); };
    run(irr, 10);
    expect(seen.every(a => a === 1)).toBe(true);
    expect(100 - p.hp).toBe(Math.floor(doseRate(2) * 10 + 1e-6));
    expect(pains.length).toBeGreaterThan(0);
    expect(pains.length).toBeLessThanOrEqual(Math.ceil(10 / RADIATION.painEveryS) + 1);
    expect(pains.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100 - p.hp);
    expect(toasts).toEqual([RADIATION_TOAST]);
    expect(irr.exposure.dosing).toBe(1);
    expect(irr.exposure.dps).toBeCloseTo(doseRate(2), 6);
  });

  it('same storey only, living zombies only, nothing beyond the radius', () => {
    const {irr, p} = rig();
    const below = actor(0, -RADIATION.storeyM - 0.1, 0), far = actor(4.05, 0, 0), dead = actor(0.5, 0, 0);
    dead.brain.alive = false;
    for (const a of [below, far, dead]) irr.adopt(a);
    run(irr, 20);
    expect(p.hp).toBe(100);
    expect(irr.exposure.dps).toBe(0);
    expect(irr.dealt).toBe(0);
  });

  it('a dead player takes nothing and hears nothing', () => {
    const {irr, p, clicks} = rig();
    irr.adopt(actor(0, 0, 0));
    p.alive = false;
    run(irr, 5);
    expect(p.hp).toBe(100);
    expect(clicks.length).toBe(0);
  });
});

describe('Geiger counter: distance-ramped random count rate', () => {
  it('one zombie: inverse square inside the audible range, faded at the edge, silent from 7 m', () => {
    expect(GEIGER.audibleM).toBe(7);
    expect(clickRate(0)).toBe(GEIGER.maxRate);
    expect(clickRate(2)).toBeCloseTo(GEIGER.maxRate * (1.2 / 2) ** 2, 9);
    expect(clickRate(4)).toBeCloseTo(GEIGER.maxRate * (1.2 / 4) ** 2, 9);
    for (const d of [7, 8, Infinity, Number.NaN]) expect(clickRate(d)).toBe(0);
    for (let d = 0; d < 7.5; d += 0.05) expect(clickRate(d + 0.05)).toBeLessThanOrEqual(clickRate(d) + 1e-12);
    // ticking starts before the dose does: audible at the dose radius
    expect(clickRate(RADIATION.radiusM)).toBeGreaterThan(1);
    expect(combinedClicks(1000)).toBeLessThanOrEqual(GEIGER.capRate);
    expect(combinedClicks(GEIGER.maxRate)).toBe(GEIGER.maxRate);
    expect(clusterShare(GEIGER.clusterFrom)).toBe(0);
    expect(clusterShare(GEIGER.capRate)).toBe(1);
  });

  it('the scheduled count matches the rate (Poisson: within 4 sigma over 200 s), bursts only at high rates, never more than maxPerFrame a frame', () => {
    for (const rate of [1, 4, 10]) {
      const got: boolean[] = [];
      const g = new GeigerCounter({geigerClick: (_k, c = false) => got.push(c)}, mulberry32(rate));
      for (let f = 0; f < 200 * 60; f++) g.update(1 / 60, rate);
      const want = rate * 200;
      expect(Math.abs(got.length - want)).toBeLessThan(4 * Math.sqrt(want));
      expect(got.some(c => c)).toBe(false);
    }
    const got: boolean[] = [];
    const g = new GeigerCounter({geigerClick: (_k, c = false) => got.push(c)}, mulberry32(3));
    let maxFrame = 0;
    for (let t = 0; t < 10; t += 0.25) { const before = got.length; g.update(0.25, GEIGER.capRate); maxFrame = Math.max(maxFrame, got.length - before); }
    expect(maxFrame).toBeLessThanOrEqual(GEIGER.maxPerFrame);
    expect(got.filter(c => c).length).toBeGreaterThan(0);
  });

  it('nearer = more ticks and louder ones (k ramps with the reading)', () => {
    const near = rig(), far = rig();
    near.irr.adopt(actor(0, 0, 1.5));
    far.irr.adopt(actor(0, 0, 5));
    run(near.irr, 20);
    run(far.irr, 20);
    expect(near.clicks.length).toBeGreaterThan(far.clicks.length * 4);
    const mean = (c: {k: number}[]) => c.reduce((a, b) => a + b.k, 0) / Math.max(1, c.length);
    expect(mean(near.clicks)).toBeGreaterThan(mean(far.clicks));
    expect(far.clicks.length).toBeGreaterThan(0);
  });
});

describe('glow lifetime and cleanup', () => {
  it('a dead zombie stops dosing and ticking at once; its glow fades to 0 over glowFadeS and its light goes dark', () => {
    const {irr, clicks, glows, p} = rig();
    const z = actor(0, 0, 1);
    irr.adopt(z);
    run(irr, 1);
    expect(irr.lights.active).toBe(1);
    expect(glows.get(z)).toBe(1);
    z.brain.alive = false;
    const hp = p.hp, n = clicks.length;
    run(irr, RADIATION.glowFadeS / 2);
    expect(glows.get(z)!).toBeGreaterThan(0.3);
    expect(glows.get(z)!).toBeLessThan(0.7);
    run(irr, RADIATION.glowFadeS / 2 + GLOW_LIGHT.fadeS + 0.1);
    expect(glows.get(z)).toBe(0);
    expect(irr.lights.active).toBe(0);
    expect(p.hp).toBe(hp);
    expect(clicks.length).toBe(n);
  });

  it('forget (a body picked up) and clear (station teardown) release everything; the light set never changes', () => {
    const {irr, parent, glows, scatter} = rig();
    const lightsBefore = parent.children.filter(isGlowLight).length;
    expect(lightsBefore).toBe(GLOW_LIGHT.count);
    const a = actor(0, 0, 2), b = actor(0, 0, 3);
    irr.adopt(a); irr.adopt(b); irr.adopt(a);
    expect(irr.count).toBe(2);
    run(irr, 1);
    expect(irr.lights.active).toBe(2);
    irr.forget(a);
    expect(glows.get(a)).toBe(0);
    run(irr, 1);
    expect(irr.lights.active).toBe(1);
    irr.clear();
    expect(irr.count).toBe(0);
    expect(irr.lights.active).toBe(0);
    expect(glows.get(b)).toBe(0);
    expect(irr.lights.lights.every(l => l.intensity === 0 && l.window.w === -1)).toBe(true);
    expect(scatter.removed.length).toBe(scatter.added.length);
    expect(parent.children.filter(isGlowLight).length).toBe(lightsBefore);
  });

  it('installed: dose, ticks and lights only while playing; leaving play resets; a section teardown clears', () => {
    const p = player();
    const clicks: unknown[] = [];
    const host = {
      state: 'playing', scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), player: p,
      sfx: {geigerClick: () => { clicks.push(1); }}, hud: {pain() {}, toast() {}},
      frameHooks: [] as ((dt: number) => void)[], stateListeners: [] as ((s: never, prev: never) => void)[], sectionHooks: [] as {teardown?(): void}[],
    };
    const irr = installIrradiation(host);
    irr.adopt(actor(0, 0, 1));
    const tick = (s: number) => { for (let t = 0; t < s; t += 1 / 60) for (const f of host.frameHooks) f(1 / 60); };
    tick(3);
    expect(p.hp).toBeLessThan(100);
    expect(clicks.length).toBeGreaterThan(10);
    host.state = 'paused';
    for (const l of host.stateListeners) (l as (s: string) => void)('paused');
    expect(irr.exposure.dps).toBe(0);
    const hp = p.hp, n = clicks.length;
    tick(3);
    expect(p.hp).toBe(hp);
    expect(clicks.length).toBe(n);
    for (const h of host.sectionHooks) h.teardown?.();
    expect(irr.count).toBe(0);
    expect(irr.lights.active).toBe(0);
  });
});

describe('glow light pool: real, occluded, fog-scattering point lights within a fixed budget', () => {
  it('the pool is the fog march\'s reserved glow slots: same count, glow-tagged FlareLights (occlusion window)', () => {
    expect(GLOW_LIGHT.count).toBe(SMOKE_LIMITS.glowLights);
    const l = new GlowLight();
    expect(isGlowLight(l) && isFlareLight(l) && l instanceof FlareLight && l instanceof THREE.PointLight).toBe(true);
    expect(isGlowScatter(l)).toBe(true);
    expect(l.castShadow).toBe(false);
    expect(l.intensity).toBe(0);
    const c = new THREE.Color(GLOW_LIGHT.color);
    expect(c.g).toBeGreaterThan(c.r * 1.5);
    expect(c.g).toBeGreaterThan(c.b * 1.5);
  });

  it('follows the nearest sources within range, with hysteresis; fades in / out; registers each lit light as a scatter light', () => {
    const parent = new THREE.Object3D();
    const pool = new GlowLightPool(parent);
    const added: THREE.PointLight[] = [], removed: THREE.PointLight[] = [];
    pool.smoke = {addScatterLight: l => { added.push(l); return true; }, removeScatterLight: l => { removed.push(l); return true; }};
    const keys = Array.from({length: 7}, () => ({}));
    const src = keys.map((key, i) => ({key, x: 3 + i * 3, y: 1.2, z: 0, strength: 1}));
    const eye = {x: 0, y: 1.6, z: 0};
    for (let k = 0; k < 30; k++) pool.frame(1 / 60, src, eye);
    expect(pool.active).toBe(GLOW_LIGHT.count);
    const owners = new Set(Array.from({length: GLOW_LIGHT.count}, (_, i) => pool.ownerOf(i)));
    expect(owners).toEqual(new Set(keys.slice(0, 4)));
    expect(pool.lights.every(l => l.intensity > 0 && l.intensity <= GLOW_LIGHT.intensity + 1e-9)).toBe(true);
    expect(added.length).toBe(4);
    // a source just nearer than an owned one does not steal its light (hysteresis) ...
    src[4].x = src[3].x - GLOW_LIGHT.hysteresisM * 0.5;
    for (let k = 0; k < 30; k++) pool.frame(1 / 60, src, eye);
    expect(new Set(Array.from({length: 4}, (_, i) => pool.ownerOf(i)))).toEqual(new Set(keys.slice(0, 4)));
    // ... a clearly nearer one does, after the old owner fades out
    src[5].x = 1;
    for (let k = 0; k < 60; k++) pool.frame(1 / 60, src, eye);
    expect(new Set(Array.from({length: 4}, (_, i) => pool.ownerOf(i))).has(keys[5])).toBe(true);
    expect(pool.active).toBeLessThanOrEqual(GLOW_LIGHT.count);
    // out of range: dark and released
    for (const s of src) s.x += 100;
    for (let k = 0; k < 60; k++) pool.frame(1 / 60, src, eye);
    expect(pool.active).toBe(0);
    expect(removed.length).toBe(added.length);
    expect(parent.children.length).toBe(GLOW_LIGHT.count);
  });

  it('GlowLightNode builds into lit node materials on both backends (registered for GlowLight; gated, window lookup in the shader)', () => {
    for (const backend of ['glsl', 'wgsl'] as const) {
      const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
      const r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
      (r as unknown as {hasFeature: () => boolean; hasCompatibility: () => boolean}).hasFeature = () => false;
      (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
      (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
      expect(installGlowLightNode(r)).toBe(true);
      expect(installGlowLightNode(r)).toBe(true);
      expect((r as unknown as {library: {getLightNodeClass(l: unknown): unknown}}).library.getLightNodeClass(GlowLight)).toBe(GlowLightNode);
      const light = new GlowLight();
      light.intensity = 5;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new MeshStandardNodeMaterial({color: 0x808080}));
      const scene = new THREE.Scene();
      scene.add(mesh, light);
      const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
      const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
      b.scene = scene;
      b.camera = new THREE.PerspectiveCamera();
      b.material = mesh.material;
      b.context.material = b.material;
      b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights([light]);
      b.build();
      const f = b.fragmentShader;
      expect(f.length).toBeGreaterThan(500);
      expect(backend === 'glsl' ? /sampler2DArray/.test(f) : /texture_2d_array<f32>/.test(f), backend).toBe(true);
      expect(/\bif\s*\(/.test(f), `${backend}: the gate`).toBe(true);
    }
  });
});
