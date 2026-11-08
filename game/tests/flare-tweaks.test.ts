// Iteration 15 (primary): flare tweaks — grenade-style hold-to-ready / release-to-throw (weapons/flareHold.ts), the stronger
// red flare light occluded like its fog glow (world/flareLight.ts, FLARE.light). The fog half speed is in
// tests/fog-medium.test.ts (c). Deterministic, node only.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {GLSLNodeBuilder, MeshStandardNodeMaterial, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {mulberry32} from '../src/core/rng';
import {FLARE_HOLD, FlareHold, type FlareHoldEvent, type FlareHoldInput} from '../src/weapons/flareHold';
import {FLARE, FlareSystem, throwOneFlare} from '../src/weapons/throwables';
import {FlareLight, FlareLightNode, flareVisibilityCpu, installFlareLightNode, isFlareLight} from '../src/world/flareLight';
import {LightSources} from '../src/world/lightSources';
import {PhysicsSystem} from '../src/physics/world';
import {levelsOf} from '../src/gen/levels';
import {Inventory} from '../src/items/inventory';
import {FIX, levelFixture} from './helpers/levelFixture';
import {VIS_RES, VIS_TEXEL} from '../src/render/smoke';
import {CELL} from '../src/gen/grid';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {generateStation} from '../src/gen/station';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false); // the thrown-flare model draws its label on a canvas

const DT = 1 / 60;
const base = (o: Partial<FlareHoldInput> = {}): FlareHoldInput => ({
  keyDown: false, keyPressed: false, mouseDown: false, mousePressed: false, heldIsFlare: false, busy: false, flares: 3, refusal: null, clears: 0, ...o,
});

// ---------------------------------------------------------------------------------------------
describe('hold to ready, release to throw (FlareHold)', () => {
  it('T: press readies (pull-back eases in), holding never throws, release throws exactly once', () => {
    const h = new FlareHold();
    const all: FlareHoldEvent[] = [];
    all.push(...h.update(DT, base({keyDown: true, keyPressed: true})));
    expect(all).toEqual([{type: 'ready', source: 'key'}]);
    expect(h.active).toBe(true);
    let prev = h.ready01;
    for (let i = 0; i < 120; i++) { // 2 s held
      all.push(...h.update(DT, base({keyDown: true})));
      expect(h.ready01).toBeGreaterThanOrEqual(prev);
      prev = h.ready01;
    }
    expect(all.filter(e => e.type === 'release')).toEqual([]);
    expect(h.ready01).toBe(1);
    const rel = h.update(DT, base({keyDown: false}));
    expect(rel).toEqual([{type: 'release', source: 'key', heldFor: expect.closeTo(121 * DT, 6)}]);
    expect(h.active).toBe(false);
    for (let i = 0; i < 30; i++) expect(h.update(DT, base())).toEqual([]); // nothing after
    expect(FLARE_HOLD.readyTime).toBeLessThan(0.5);
  });

  it('quick tap (pressed and released between two frames) throws on that release, once', () => {
    const h = new FlareHold();
    expect(h.update(DT, base({keyPressed: true, keyDown: false}))).toEqual([{type: 'ready', source: 'key'}, {type: 'release', source: 'key', heldFor: 0}]);
    expect(h.update(DT, base())).toEqual([]);
    const m = new FlareHold();
    expect(m.update(DT, base({mousePressed: true, mouseDown: true, heldIsFlare: true}))).toEqual([{type: 'ready', source: 'mouse'}]);
    expect(m.update(DT, base({mouseDown: false, heldIsFlare: true}))).toEqual([{type: 'release', source: 'mouse', heldFor: expect.closeTo(DT, 9)}]);
  });

  it('left click readies only with a flare in hand; a second source during a hold is ignored', () => {
    const h = new FlareHold();
    expect(h.update(DT, base({mousePressed: true, mouseDown: true, heldIsFlare: false}))).toEqual([]); // the gun's click
    expect(h.update(DT, base({keyPressed: true, keyDown: true}))).toEqual([{type: 'ready', source: 'key'}]);
    expect(h.update(DT, base({keyDown: true, mousePressed: true, mouseDown: true, heldIsFlare: true}))).toEqual([]); // no second hold
    expect(h.update(DT, base({keyDown: false, mouseDown: true, heldIsFlare: true}))).toEqual([{type: 'release', source: 'key', heldFor: expect.any(Number)}]);
    // the still-held mouse button does not start another hold (no new press edge)
    expect(h.update(DT, base({mouseDown: true, heldIsFlare: true}))).toEqual([]);
  });

  it('cancels with nothing thrown: input cleared (pause / inventory / unlock / blur / death / loading), busy, slot switch, no flares left', () => {
    const cases: [string, Partial<FlareHoldInput>, FlareHoldInput['heldIsFlare']][] = [
      ['input-cleared', {clears: 1}, true], ['busy', {busy: true}, true], ['slot', {heldIsFlare: false}, true], ['no-flare', {flares: 0}, true],
    ];
    for (const [reason, change] of cases) {
      const h = new FlareHold();
      h.update(DT, base({mousePressed: true, mouseDown: true, heldIsFlare: true}));
      h.update(DT, base({mouseDown: true, heldIsFlare: true}));
      expect(h.update(DT, base({mouseDown: true, heldIsFlare: true, ...change})), reason).toEqual([{type: 'cancel', source: 'mouse', reason}]);
      // releasing afterwards (or resuming with the button up) never throws a stale flare
      expect(h.update(DT, base({heldIsFlare: true}))).toEqual([]);
      expect(h.active).toBe(false);
      expect(h.ready01).toBe(0);
    }
    const k = new FlareHold();
    k.update(DT, base({keyPressed: true, keyDown: true}));
    expect(k.cancel()).toBe('key');
    expect(k.update(DT, base())).toEqual([]);
  });

  it('refusals once per press (no flare / at the cap); cooldown / no physics are silent; busy hands never start', () => {
    const h = new FlareHold();
    expect(h.update(DT, base({keyPressed: true, keyDown: true, flares: 0}))).toEqual([{type: 'refuse', source: 'key', reason: 'none'}]);
    for (let i = 0; i < 20; i++) expect(h.update(DT, base({keyDown: true, flares: 0}))).toEqual([]); // held: no per-frame spam
    expect(h.update(DT, base({keyPressed: true, keyDown: true, refusal: 'cap'}))).toEqual([{type: 'refuse', source: 'key', reason: 'cap'}]);
    expect(h.update(DT, base({keyPressed: true, keyDown: true, refusal: 'cooldown'}))).toEqual([]);
    expect(h.update(DT, base({keyPressed: true, keyDown: true, refusal: 'unavailable'}))).toEqual([]);
    expect(h.update(DT, base({keyPressed: true, keyDown: true, busy: true}))).toEqual([]);
    expect(h.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('hold -> release consumes exactly one flare on the release (real FlareSystem + Inventory)', () => {
  const fx = levelFixture();
  const L = levelsOf(fx);
  function setup() {
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const fl = new FlareSystem(new THREE.Group(), ph, new LightSources(), mulberry32(5));
    const audio = {ignite: 0, loops: 0};
    fl.env = {levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b),
      audio: {flareIgnite: () => { audio.ignite++; }, flareBurnStart: () => { audio.loops++; return {setPos: () => {}, stop: () => {}}; }}};
    const inv = new Inventory();
    inv.add(inv.makeStack('flare', 3));
    const eye = {x: 21, y: FIX.upperY + 1.62, z: 4}, dir = {x: 0, y: -0.1, z: 1};
    const l = Math.hypot(dir.x, dir.y, dir.z); dir.x /= l; dir.y /= l; dir.z /= l;
    let clears = 0;
    const h = new FlareHold();
    /** One frame of the game loop's flare part: hold events -> exactly what Game does on 'release'. */
    const frame = (o: Partial<FlareHoldInput>) => {
      for (const e of h.update(DT, {...base(), flares: inv.count('flare'), refusal: fl.refusal(), clears, ...o})) {
        if (e.type === 'release') throwOneFlare(fl, () => inv.take('flare', 1) === 1, () => inv.count('flare') > 0, eye, dir);
      }
      ph.update(DT); fl.tick(DT);
    };
    return {fl, inv, audio, h, frame, clear: () => { clears++; }};
  }

  it('nothing is struck, consumed, lit or heard while held; one on release; long holds and taps never double', () => {
    const {fl, inv, audio, frame} = setup();
    frame({keyPressed: true, keyDown: true});
    for (let i = 0; i < 90; i++) frame({keyDown: true});
    expect([inv.count('flare'), fl.flares.length, audio.ignite, audio.loops]).toEqual([3, 0, 0, 0]);
    frame({keyDown: false});
    expect([inv.count('flare'), fl.flares.length, fl.burningCount, audio.ignite]).toEqual([2, 1, 1, 1]);
    expect(fl.flares[0].light?.intensity).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) frame({}); // past the cooldown
    frame({keyPressed: true, keyDown: false}); // a tap
    expect([inv.count('flare'), fl.flares.length]).toEqual([1, 2]);
  });

  it('a cancelled hold spends nothing and the later release / resume does not throw', () => {
    const {fl, inv, audio, frame, clear} = setup();
    frame({mousePressed: true, mouseDown: true, heldIsFlare: true});
    for (let i = 0; i < 20; i++) frame({mouseDown: true, heldIsFlare: true});
    clear(); // e.g. Esc -> pause (Input.clear) while the button is down
    frame({mouseDown: true, heldIsFlare: true});
    frame({mouseDown: false, heldIsFlare: true}); // released after resuming
    expect([inv.count('flare'), fl.flares.length, audio.ignite]).toEqual([3, 0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the flare light: much stronger red, occluded like its fog glow', () => {
  // (task studio-general-armor-20261107-231448-01, user: "increase flair light distance 4x"): the reach 11.5 -> 46 m, the same candela / red / decay; the flare's
  // occlusion window grew with it (render/smoke.ts: 192 x 0.5 m texels, +-48 m) so the longer light is never clipped by it
  it('light contract: 6x the candela, the reach x4 inside its occlusion window, same red, physical decay; pooled FlareLights, no shadow', () => {
    expect(FLARE.light).toMatchObject({color: 0xff2a12, intensity: 42, distance: 46, decay: 2});
    expect(FLARE.light.distance).toBe(4 * 11.5);
    expect(FLARE.light.intensity / 7).toBe(6); // iteration 12/13: 7 cd, 10 m
    expect(FLARE.light.distance).toBeLessThanOrEqual((VIS_RES / 2 - 0.5) * VIS_TEXEL.scatter); // lit only where the window can say "visible"
    const fl = new FlareSystem(new THREE.Group(), new PhysicsSystem(null), new LightSources());
    expect(fl.lights).toHaveLength(FLARE.maxActive);
    for (const l of fl.lights) {
      expect(isFlareLight(l)).toBe(true);
      expect([l.castShadow, l.intensity, l.distance, l.decay]).toEqual([false, 0, 46, 2]);
    }
    // incident light at 2 / 5 / 8 m (physical inverse square inside the cutoff): 6x everywhere it reached before
    const at = (d: number, I: number) => I / (d * d);
    expect([at(2, 42), at(5, 42), at(8, 42)].map(v => +v.toFixed(2))).toEqual([10.5, 1.68, 0.66]);
  });

  it('visibility semantics = the fog march window: no window -> lit; seen cell -> lit; wall cell / outside / other storey -> dark', () => {
    const win = new THREE.Vector4(10, 20, 1 / 24, 0), band = new THREE.Vector2(0, 3.2);
    const vis = (u: number) => (u < 0.5 ? 1 : 0); // west half visible, east half behind a wall
    expect(flareVisibilityCpu([15, 1, 25], new THREE.Vector4(0, 0, 1, -1), band, vis)).toBe(1);
    expect(flareVisibilityCpu([15, 1, 25], win, band, vis)).toBe(1);
    expect(flareVisibilityCpu([30, 1, 25], win, band, vis)).toBe(0); // behind the wall
    expect(flareVisibilityCpu([40, 1, 25], win, band, vis)).toBe(0); // outside the window
    expect(flareVisibilityCpu([15, 5.5, 25], win, band, vis)).toBe(0); // the storey above
    expect(flareVisibilityCpu([15, 0.0, 25], win, band, vis)).toBeGreaterThan(0.5); // its own floor stays lit
  });

  it('the atmosphere hands each burning flare its window (and clears it once out)', () => {
    const l = generateStation(0x1a2b3c);
    const flashlight = new THREE.SpotLight(0xffffff, 0), muzzle = new THREE.PointLight(0xffffff, 0);
    const a = new VolumetricAtmosphere(null, {flashlight, muzzle}, 'high');
    a.setSize(640, 360);
    a.setStation(l, null);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
    scene.add(camera, flashlight, muzzle);
    const sp = l.playerSpawn;
    camera.position.set(sp.x, 1.6, sp.z); camera.updateMatrixWorld(true);
    const f = new FlareLight(FLARE.light.color, FLARE.light.intensity, FLARE.light.distance, FLARE.light.decay);
    f.position.set(sp.x, 0.3, sp.z);
    scene.add(f);
    expect(f.window.w).toBe(-1);
    expect(a.addScatterLight(f)).toBe(true);
    a.sync(scene, camera, 1);
    expect(f.window.w).toBeGreaterThanOrEqual(0); // a texture layer
    expect(f.window.z).toBeCloseTo(1 / (VIS_RES * CELL), 9);
    expect(f.band.y).toBeGreaterThan(f.band.x);
    const u = (sp.x - f.window.x) * f.window.z, v = (sp.z - f.window.y) * f.window.z;
    expect(u > 0 && u < 1 && v > 0 && v < 1).toBe(true); // the flare sits inside its own window
    f.clearWindow();
    expect(f.window.w).toBe(-1);
    a.dispose();
  });

  it('FlareLightNode builds into lit node materials on both backends (registered for FlareLight; the window lookup is in the shader)', () => {
    for (const backend of ['glsl', 'wgsl'] as const) {
      const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
      const r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
      (r as unknown as {hasFeature: () => boolean; hasCompatibility: () => boolean}).hasFeature = () => false;
      (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
      (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
      expect(installFlareLightNode(r)).toBe(true);
      expect(installFlareLightNode(r)).toBe(true); // idempotent
      expect((r as unknown as {library: {getLightNodeClass(l: unknown): unknown}}).library.getLightNodeClass(FlareLight)).toBe(FlareLightNode);
      const light = new FlareLight(0xff2a12, 42, 11.5, 2);
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
      // one 2D-array texture binding (the shared window texture) sampled at an explicit level
      expect(backend === 'glsl' ? /sampler2DArray/.test(f) : /texture_2d_array<f32>/.test(f), backend).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('iteration 15: firing recoil x1.5 across the board (user: "fifty percent recoil to everything"), applied once', async () => {
  const {WEAPONS, RECOIL_SCALE, firingRecoil} = await import('../src/weapons/weapons');
  // iteration 14 values (before)
  const BASE = {
    rifle: {pitch: 0.012, yaw: 0.006, kick: 0.035, recover: 9},
    shotgun: {pitch: 0.06, yaw: 0.015, kick: 0.09, recover: 6},
    pistol: {pitch: 0.016, yaw: 0.005, kick: 0.03, recover: 11},
  } as const;
  it('camera kick (pitch, yaw) and the viewmodel kick are exactly 1.5x (not 2.25x); recovery unchanged; handling order kept', () => {
    expect(RECOIL_SCALE).toBe(1.5);
    for (const id of ['rifle', 'shotgun', 'pistol'] as const) {
      const r = WEAPONS[id].recoil, b = BASE[id];
      for (const k of ['pitch', 'yaw', 'kick'] as const) expect(r[k] / b[k], `${id} ${k}`).toBeCloseTo(1.5, 12);
      expect(r.recover, id).toBe(b.recover);
      expect(firingRecoil(b)).toEqual(r); // the one place it is scaled
    }
    // relative handling is preserved: the shotgun still kicks hardest, the pistol pitches more than the rifle
    expect(WEAPONS.shotgun.recoil.pitch).toBeGreaterThan(WEAPONS.pistol.recoil.pitch);
    expect(WEAPONS.pistol.recoil.pitch).toBeGreaterThan(WEAPONS.rifle.recoil.pitch);
  });
  it('nothing else about the guns changed (damage, spread, cadence, ammo, knockback, reload, handling, sound)', () => {
    const pick = (id: string) => { const w = WEAPONS[id]; return [w.damage, w.pellets, w.spreadHip, w.spreadAim, w.spreadMove, w.interval, w.magazine, w.auto, w.range, w.falloffStart, w.falloffMin, w.headMult, w.limbMult, w.knockback, JSON.stringify(w.reload), w.equipTime, w.aimFov, w.moveMult, w.noise, w.sound]; };
    expect(pick('rifle')).toEqual([24, 1, 0.028, 0.004, 0.03, 0.1, 30, true, 90, 40, 0.7, 2.5, 0.7, 0.25, '{"kind":"magazine","time":2.1,"emptyTime":2.55}', 0.55, 52, 0.95, 30, 'rifle']);
    expect(pick('shotgun')).toEqual([15, 9, 0.075, 0.052, 0.02, 0.82, 6, false, 30, 7, 0.25, 1.8, 0.75, 0.55, '{"kind":"shell","start":0.38,"each":0.48,"end":0.42}', 0.6, 60, 0.92, 38, 'shotgun']);
    expect(pick('pistol')).toEqual([17, 1, 0.022, 0.006, 0.025, 0.16, 15, false, 60, 22, 0.6, 2.4, 0.7, 0.18, '{"kind":"magazine","time":1.4,"emptyTime":1.65}', 0.35, 58, 1.0, 24, 'pistol']);
  });
});

// Task studio-general-armor-20261107-231448-01 (user: flare light distance x4, duration x2): the flare's occlusion window covers the new
// reach as a ray fan (render/smoke.ts computeVisWindowFan) that agrees with the exact per-texel line of sight, and walls still block it.
describe('the x4 flare reach: a +-48 m occlusion window that still stops at walls', () => {
  it('covers the reach; the fan matches the exact line of sight (walls block, the open hall is lit to the window edge)', async () => {
    const {computeVisWindow, computeVisWindowFan, VIS_EMITTER_SPAN} = await import('../src/render/smoke');
    const {Grid, FLOOR, SOLID} = await import('../src/gen/grid');
    expect(VIS_RES * VIS_TEXEL.scatter).toBeGreaterThanOrEqual(2 * FLARE.light.distance);
    expect(VIS_EMITTER_SPAN * VIS_TEXEL.emitter).toBe(24); // smoke windows: +-12 m, as before
    // a 120 m x 60 m hall (x x z) split by a solid wall at x = 70 m (a door gap at z 28-31 m)
    const g = new Grid(240, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 240; x++) { const i = g.idx(x, y); g.cells[i] = x === 140 && !(y >= 56 && y < 62) ? SOLID : FLOOR; }
    const look = {grid: () => ({grid: g, floor: 0, ceil: 4})};
    const fan = new Uint8Array(VIS_RES * VIS_RES), exact = new Uint8Array(VIS_RES * VIS_RES);
    const src = {x: 50.25, y: 0.3, z: 20.25};
    const w = computeVisWindowFan(src, look, fan, VIS_TEXEL.scatter)!;
    computeVisWindow(src, look, exact, {texel: VIS_TEXEL.scatter});
    const at = (buf: Uint8Array, x: number, z: number) => buf[Math.floor((z - w.z0) / w.texel) * VIS_RES + Math.floor((x - w.x0) / w.texel)];
    expect(at(fan, 50, 55)).toBe(255); // 35 m away in the open: lit (the old +-12 m window said dark)
    expect(at(fan, 20, 50)).toBe(255); // ~42 m away diagonally: lit
    expect(at(fan, 90, 20)).toBe(0); // behind the wall, out of the door's line: dark
    expect(at(exact, 90, 20)).toBe(0);
    let diff = 0, lit = 0;
    for (let i = 0; i < fan.length; i++) { if (exact[i]) lit++; if (fan[i] !== exact[i]) diff++; }
    expect(diff / lit).toBeLessThan(0.05); // the fan agrees with the exact per-texel line of sight
  });
});
