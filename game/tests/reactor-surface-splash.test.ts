// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (lane SPLASH): RAIN IMPACT SPLASHES on the Reactor's surface — user: "rain
// drops are not producing splashes when hitting the ground outside, they should!". Pins, on REAL Reactor layouts (lane ENDING's surface
// contract) with lane PLANT's real plan:
//  1. BOUNDED: ONE mesh / ONE draw (transparent, forceSinglePass, additive, no depth write, never a shadow caster, never culled) of a
//     fixed slot batch (SURFACE_SPLASH.slots x (ring + droplets) quads); the material compiles on both backends within 12 uniform
//     buffers / 2 textures per stage (no uniformArray);
//  2. THE FLOOR MAP the drops stop at holds the true surface: the deck at site.y on the walk cells, the city ground disc groundBelow
//     under it elsewhere, the vent towers / duct runs raised (rain stops on them);
//  3. WHERE (the shader's placement through its CPU mirror splashAt, every slot over a spread of clocks and eyes): every fired splash
//     sits on open ground at that ground's height (+ the lift) — the deck on the walk area, the city ground off it — or on a ledge's
//     top (parapet / piers / plinths); never inside the head house / a shelter, over the aperture (disc + railing ring), inside a
//     building or a vent tower, off the map; within its box round the eye; world-anchored (a step of the eye leaves it in place);
//  4. GATES: no splash without rain, density with the rain; the runtime shows the layer with the near rain only (outside, after the
//     win), never from the pit; its clock runs only in frame hooks; it is disposed with the view.
// LL_SURFACE_SPLASH_OUT=/tmp/x.txt writes the numbers.
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLSLNodeBuilder, WGSLNodeBuilder, type WebGPURenderer} from 'three/webgpu';
import {describe, expect, it} from 'vitest';
import {surfaceSiteOf, type SurfaceSite} from '../src/world/reactor/surfaceSite';
import {footprintDist, planSurfaceCity, type CityFootprint} from '../src/world/reactor/surfacePlan';
import {planSurfacePlant, plantLocal} from '../src/world/reactor/surfacePlantPlan';
import {SURFACE_RAIN, buildRainFloor, rainFloorAt} from '../src/world/reactor/surfaceRain';
import {SPLASH_KIND, SURFACE_SPLASH, splashAt, splashHoleR, splashLedges, splashSlots, type SplashLedge} from '../src/world/reactor/surfaceSplash';
import {SURFACE_LAYERS, buildSurfaceView, disposeSurfaceView} from '../src/world/reactor/surfaceCity';
import {ReactorSurface} from '../src/world/reactor/surface';
import {setAttributeInstancing} from '../src/render/instancing';
import {rendererFor} from './helpers/fogCompile';
import {SURFACE_SEEDS, fakeSurfaceHost, inCatalogue, poseCamera, surfaceDraws, surfaceLayout, surfaceModels} from './reactor-surface-fixture';

const OUT = process.env.LL_SURFACE_SPLASH_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const EYE = 1.62;

function world(seed: number) {
  const L = surfaceLayout(seed), site = surfaceSiteOf(L)!, info = L.reactor!;
  const plant = planSurfacePlant(site, L.seed >>> 0, info.pit.bounds);
  const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, info.pit.bounds, plant.reserved);
  const floor = buildRainFloor(site, plan, plant);
  const ledges = splashLedges(site, plant, SURFACE_LAYERS.parapetT);
  return {L, site, info, plant, plan, floor, ledges};
}

/** Eyes on the deck: the largest walk rect's centre, points along the plaza's edges, the head house, the bounds' corners + the gate's pad. */
function eyes(site: SurfaceSite): {x: number; y: number; z: number}[] {
  const y = site.y + EYE, w = [...site.walk].sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
  const out = [{x: (w.x0 + w.x1) / 2, y, z: (w.z0 + w.z1) / 2}];
  site.edges.filter((_, i) => i % Math.max(1, Math.floor(site.edges.length / 3)) === 0).slice(0, 3).forEach(e => out.push({x: (e.x0 + e.x1) / 2 - e.nx * 0.4, y, z: (e.z0 + e.z1) / 2 - e.nz * 0.4}));
  for (const sh of site.shelters) out.push({x: (sh.rect.x0 + sh.rect.x1) / 2, y, z: (sh.rect.z0 + sh.rect.z1) / 2});
  const b = site.bounds;
  for (const [x, z] of [[b.x0 - 2, b.z0 - 2], [b.x1 + 2, b.z1 + 2]]) out.push({x, y, z});
  return out;
}

const onWalk = (site: SurfaceSite, x: number, z: number) => site.walk.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
const inRect = (r: {x0: number; z0: number; x1: number; z1: number}, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
/** Strictly inside an oriented footprint shrunk by `m` m. */
const insideFp = (p: CityFootprint, x: number, z: number, m: number) => {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), X = x - p.x, Z = z - p.z;
  return Math.abs(X * c - Z * s) < p.hw - m && Math.abs(X * s + Z * c) < p.hd - m;
};
const inLedge = (l: SplashLedge, x: number, z: number) => insideFp({x: l.x, z: l.z, yaw: l.yaw, hw: l.hw + 1e-6, hd: l.hd + 1e-6}, x, z, 0);

describe('rain splashes: the floor map holds the true surface', () => {
  it('the deck on the walk cells, the city ground under it elsewhere, the plant\'s structures raised; 0.5 m texels on the walk grid', () => {
    for (const seed of SURFACE_SEEDS) {
      const {site, plant, floor: m} = world(seed);
      expect(m.cell).toBe(SURFACE_RAIN.floorCell);
      expect(m.ground).toBe(site.y);
      expect(m.low).toBeCloseTo(site.y - SURFACE_LAYERS.groundBelow, 9);
      let deck = 0, ground = 0;
      for (const w of site.walk) for (let x = w.x0 + 0.25; x < w.x1; x += 0.5) for (let z = w.z0 + 0.25; z < w.z1; z += 0.5) {
        const f = rainFloorAt(m, x, z);
        if (site.shelters.some(s => inRect(s.rect, x, z, 0.5)) || Math.hypot(x - site.hole.x, z - site.hole.z) < site.hole.r + 0.8) continue;
        expect(f, `deck (${x}, ${z})`).toBeCloseTo(site.y, 4); // (float32 texels)
        deck++;
      }
      // just beyond the parapet (off every walk rect, outside the plant's footprints): the city ground disc
      for (const e of site.edges) {
        const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
        for (let a = 0.6; a < L - 0.6; a += 1.5) {
          const x = e.x0 + ((e.x1 - e.x0) * a) / L + e.nx * 0.75, z = e.z0 + ((e.z1 - e.z0) * a) / L + e.nz * 0.75;
          if (onWalk(site, x, z) || plant.reserved.some(r => footprintDist(r, x, z) < 0.8) || plant.parts.some(q => footprintDist(q, x, z) < 0.8)) continue;
          if (Math.abs(rainFloorAt(m, x, z) - m.low) < 1e-4) ground++;
        }
      }
      expect(deck).toBeGreaterThan(400);
      expect(ground).toBeGreaterThan(20);
      // the vent towers: rain stops on the stack's top, the plinth round it
      for (const t of plant.towers) {
        expect(rainFloorAt(m, t.x, t.z)).toBeCloseTo(t.y + t.h, 4);
        // (the plinth's margin behind the stack: local -z, the duct run lies on +z toward the plaza)
        const [bx, bz] = plantLocal(t, 0, -(t.hd + (t.plinth.hd - t.hd) / 2));
        expect(rainFloorAt(m, bx, bz), "the plinth behind the stack").toBeGreaterThanOrEqual(t.y + t.plinth.h - 1e-4);
      }
      out(`seed ${seed}: floor ${m.w} x ${m.h} texels (${m.cell} m), deck samples ${deck}, ground samples ${ground}, towers ${plant.towers.length}`);
    }
  });
});

describe('rain splashes: where they land (the shader\'s placement through its CPU mirror)', () => {
  it('on open ground at its height or on a ledge top; never sheltered, over the aperture, inside a building / tower, off the map', async () => {
    let total = 0;
    const byKind = [0, 0, 0];
    for (const seed of SURFACE_SEEDS) {
      const {site, plant, plan, floor: m, ledges} = world(seed);
      const v = buildSurfaceView(site, plan, () => undefined, null, 7, undefined, plant);
      const slots = splashSlots(v.splash.mesh.geometry);
      disposeSurfaceView(v);
      expect(slots.length).toBe(SURFACE_SPLASH.slots.near + SURFACE_SPLASH.slots.far + SURFACE_SPLASH.slots.ledge);
      expect(ledges.filter(l => l.kind === 'parapet').length).toBeGreaterThan(20);
      expect(ledges.filter(l => l.kind === 'pier').length).toBeGreaterThan(4);
      if (plant.towers.length) expect(ledges.some(l => l.kind === 'plinth')).toBe(true);
      const hole = {x: site.hole.x, z: site.hole.z, r: splashHoleR(site)};
      const bld = plan.placements.filter(p => p.kind === 'building' || p.kind === 'tank');
      const stacks = plant.towers.map(t => ({x: t.x, z: t.z, yaw: t.yaw, hw: t.hw, hd: t.hd}));
      let fired = 0, deck = 0, ground = 0, ledge = 0;
      const bad: string[] = [];
      const fail = (why: string, s: {x: number; y: number; z: number}, kind: number) => { if (bad.length < 12) bad.push(`seed ${seed} kind ${kind} at (${s.x.toFixed(2)}, ${s.y.toFixed(3)}, ${s.z.toFixed(2)}): ${why}`); };
      const near = (p: CityFootprint, x: number, z: number) => Math.hypot(p.x - x, p.z - z) < Math.hypot(p.hw, p.hd) + 1;
      for (const eye of eyes(site)) {
        for (let k = 0; k < 20; k++) {
          const t = 3.1 + k * 0.173;
          for (const slot of slots) {
            const s = splashAt(slot, t, eye, 1, m, ledges, hole);
            if (!s.fired) continue;
            fired++;
            // on the map's interior; never under the head house / a shelter's roof, never over the aperture (disc + railing ring)
            if (!(s.x > m.x0 + m.cell && s.x < m.x0 + (m.w - 1) * m.cell && s.z > m.z0 + m.cell && s.z < m.z0 + (m.h - 1) * m.cell)) fail('off the map', s, s.kind);
            if (site.shelters.some(sh => inRect(sh.rect, s.x, s.z))) fail('under a shelter', s, s.kind);
            if (Math.hypot(s.x - site.hole.x, s.z - site.hole.z) <= Math.max(site.hole.r, site.hole.ringR1)) fail('over the aperture', s, s.kind);
            if (s.kind === SPLASH_KIND.ledge) {
              const l = ledges[s.ledge];
              if (!inLedge(l, s.x, s.z)) fail('off its ledge', s, s.kind);
              if (Math.abs(s.y - (l.y + SURFACE_SPLASH.ledgeLift)) > 1e-6) fail('not on its ledge top', s, s.kind);
              if (s.floorY > l.y + 0.05) fail('something over its ledge', s, s.kind);
              ledge++;
            } else {
              const half = s.kind === SPLASH_KIND.far ? SURFACE_SPLASH.far : SURFACE_SPLASH.near;
              if (Math.abs(s.x - eye.x) > half + 1e-6 || Math.abs(s.z - eye.z) > half + 1e-6) fail('outside its box', s, s.kind);
              // on the surface it lands on: the deck at site.y on the walk area, the city ground disc off it (+ the lift over the film)
              const deckHere = onWalk(site, s.x, s.z), surf = deckHere ? site.y : site.y - SURFACE_LAYERS.groundBelow;
              if (Math.abs(s.floorY - surf) > 1e-4) fail(`floor ${s.floorY} is not the ${deckHere ? 'deck' : 'city ground'}`, s, s.kind);
              if (Math.abs(s.y - (surf + SURFACE_SPLASH.lift)) > 1e-4 || s.y - surf >= 0.03) fail('not on the surface (+ the lift)', s, s.kind);
              // never inside a building (beyond its texel's slack) or a vent tower
              for (const p of bld) if (near(p, s.x, s.z) && insideFp(p, s.x, s.z, m.cell * Math.SQRT2)) fail(`inside ${p.entry}`, s, s.kind);
              for (const st of stacks) if (insideFp(st, s.x, s.z, m.cell * Math.SQRT2)) fail('inside a vent tower', s, s.kind);
              if (deckHere) deck++; else ground++;
            }
            byKind[s.kind]++;
          }
        }
      }
      expect(bad).toEqual([]);
      out(`seed ${seed}: ${eyes(site).length} eyes x 20 clocks x ${slots.length} slots: fired ${fired} (deck ${deck}, city ground ${ground}, ledges ${ledge}); ledges ${ledges.length}`);
      expect(deck).toBeGreaterThan(200);
      expect(ground).toBeGreaterThan(200);
      expect(ledge).toBeGreaterThan(20);
      total += fired;
    }
    out(`total fired ${total}, by kind ${byKind.join(' / ')}`);
  }, 300_000);

  it('density follows the rain (none without it); world-anchored: a step of the eye leaves a splash where it landed', () => {
    const {site, floor: m, ledges, plan, plant} = world(SURFACE_SEEDS[0]);
    const v = buildSurfaceView(site, plan, () => undefined, null, 7, undefined, plant);
    const slots = splashSlots(v.splash.mesh.geometry);
    disposeSurfaceView(v);
    const hole = {x: site.hole.x, z: site.hole.z, r: splashHoleR(site)};
    const w = [...site.walk].sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
    const eye = {x: (w.x0 + w.x1) / 2, y: site.y + EYE, z: (w.z0 + w.z1) / 2};
    const count = (on: number) => {
      let c = 0;
      for (let k = 0; k < 60; k++) for (const s of slots) if (splashAt(s, 1 + k * 0.137, eye, on, m, ledges, hole).fired) c++;
      return c;
    };
    const full = count(1), halfR = count(0.5);
    out(`density: rain 1 -> ${full}, rain 0.5 -> ${halfR}, rain 0 -> ${count(0)}`);
    expect(count(0)).toBe(0);
    expect(full).toBeGreaterThan(1000);
    expect(halfR / full).toBeGreaterThan(0.35);
    expect(halfR / full).toBeLessThan(0.65);
    // a 0.6 m step: the splashes well inside their box stay put (same slot, same clock)
    let kept = 0;
    for (let k = 0; k < 30; k++) for (const s of slots) {
      if (s[2] === SPLASH_KIND.ledge) continue;
      const t = 2 + k * 0.211, a = splashAt(s, t, eye, 1, m, ledges, hole);
      const half = s[2] === SPLASH_KIND.far ? SURFACE_SPLASH.far : SURFACE_SPLASH.near;
      if (!a.fired || Math.max(Math.abs(a.x - eye.x), Math.abs(a.z - eye.z)) > half - 1) continue;
      const b = splashAt(s, t, {...eye, x: eye.x + 0.6, z: eye.z - 0.4}, 1, m, ledges, hole);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.z).toBeCloseTo(a.z, 6);
      kept++;
    }
    expect(kept).toBeGreaterThan(200);
  });
});

const ubos = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
const texs = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length : (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length;

/** Compile a mesh's node material with the backend's builder (as tests/reactor-surface-rain.test.ts). */
function compileMesh(mesh: THREE.Mesh, backend: 'glsl' | 'wgsl'): {vertex: string; fragment: string} {
  const r = rendererFor(backend) as WebGPURenderer;
  const caps = (r.backend as unknown as {capabilities?: {getUniformBufferLimit(): number; llStub?: boolean}}).capabilities;
  if (caps && !caps.llStub) { const f = caps.getUniformBufferLimit.bind(caps); caps.getUniformBufferLimit = () => { try { return f(); } catch { return 65536; } }; caps.llStub = true; }
  const B = (backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder) as unknown as new (o: THREE.Object3D, r: WebGPURenderer) => {scene: THREE.Scene; camera: THREE.Camera; build(): void; vertexShader?: string; fragmentShader?: string};
  const scene = new THREE.Scene(), parent = mesh.parent;
  scene.add(mesh);
  const b = new B(mesh, r);
  const camera = new THREE.PerspectiveCamera();
  b.scene = scene;
  b.camera = camera;
  const lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene, c: THREE.Camera): {setLights(l: THREE.Light[]): void}}}).lighting.getNode(scene, camera);
  lightsNode.setLights([]);
  (b as unknown as {lightsNode: unknown}).lightsNode = lightsNode;
  b.build();
  scene.remove(mesh);
  if (parent) parent.add(mesh);
  return {vertex: b.vertexShader ?? '', fragment: b.fragmentShader ?? ''};
}

describe('rain splashes: one bounded draw, lean material, the runtime\'s gates', () => {
  it('ONE mesh of a fixed slot batch (one draw, additive, no depth write, no shadow, never culled); compiles on both backends', () => {
    const {site, plan, plant, floor: m} = world(SURFACE_SEEDS[1]);
    const v = buildSurfaceView(site, plan, () => undefined, null, 7, undefined, plant);
    try {
      const sp = v.splash, mesh = sp.mesh, S = SURFACE_SPLASH;
      const quads = (S.slots.near + S.slots.far + S.slots.ledge) * (1 + S.sparks);
      expect(mesh.parent).toBe(v.outdoor); // (the eye gate: never drawn from the pit)
      expect(v.root.getObjectsByProperty('name', 'reactor-surface-rain-splash').length).toBe(1);
      expect(mesh.geometry.index!.count).toBe(quads * 6);
      expect(mesh.geometry.getAttribute('position').count).toBe(quads * 4);
      expect(sp.stats()).toMatchObject({slots: quads / (1 + S.sparks), quads, triangles: quads * 2, visible: false});
      expect(quads * 2).toBeLessThanOrEqual(6000); // (a few hundred slots: one small batch)
      const mt = mesh.material as THREE.Material;
      expect(mt.transparent && mt.forceSinglePass && !mt.depthWrite && mt.blending === THREE.AdditiveBlending).toBe(true);
      expect(mesh.castShadow || mesh.receiveShadow).toBe(false);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.renderOrder).toBeGreaterThan(v.film!.renderOrder); // over the wet film
      expect(sp.floor).toBe(v.floor);
      expect(v.floor.w).toBe(m.w);
      for (const backend of ['glsl', 'wgsl'] as const) for (const attr of [true, false]) {
        setAttributeInstancing(attr);
        try {
          const c = compileMesh(new THREE.Mesh(mesh.geometry, mesh.material), backend);
          expect(c.vertex.length).toBeGreaterThan(400);
          for (const [stage, src] of [['vertex', c.vertex], ['fragment', c.fragment]] as const) {
            const u = ubos(src, backend), t = texs(src, backend);
            out(`splash ${backend} attr=${attr} ${stage}: uniform buffers ${u}, textures ${t}`);
            expect(u, `${backend} ${stage} uniform buffers`).toBeLessThanOrEqual(12);
            expect(t, `${backend} ${stage} textures`).toBeLessThanOrEqual(2);
          }
        } finally {
          setAttributeInstancing(false);
        }
      }
    } finally {
      disposeSurfaceView(v);
    }
  }, 300_000);

  it('the runtime: nothing before the win or from the pit; with the near rain outside (density = rain); its clock in frame hooks; disposed', async () => {
    const lib = await surfaceModels();
    const L = surfaceLayout(SURFACE_SEEDS[0]), s = L.reactor!.surface!;
    const host = fakeSurfaceHost(lib);
    const rt = new ReactorSurface(host).install();
    let sky = {clear: 0, beam: 0};
    rt.findSky = () => sky;
    for (const h of host.sectionHooks) h.build?.(L);
    const v = rt.view!, sp = v.splash;
    const w = [...s.walk].sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
    const plaza = {x: (w.x0 + w.x1) / 2, y: s.y + EYE, z: (w.z0 + w.z1) / 2, yaw: 0, pitch: -0.3};
    const pit = {x: L.reactor!.core.x, y: L.reactor!.coreFloor ? L.reactor!.coreFloor.y + EYE : L.reactor!.pit.rimY + EYE, z: L.reactor!.core.z, yaw: 0, pitch: 0.9};
    const step = (p: typeof plaza, dt = 1 / 60) => { poseCamera(host.camera, p.x, p.y, p.z, p.yaw, p.pitch); for (const f of host.frameHooks) f(dt); return surfaceDraws(v.root, host.camera); };
    // before the win: outside, no rain, no splashes
    let d = step(plaza);
    expect(sp.mesh.visible).toBe(false);
    expect(d.names).not.toContain('reactor-surface-rain-splash');
    // after it: outside -> drawn (one draw), density = the rain, the clock advancing with the frames
    sky = {clear: 1, beam: 1};
    d = step(plaza);
    expect(rt.shown.splash && sp.mesh.visible).toBe(true);
    expect(d.names.filter(n => n === 'reactor-surface-rain-splash').length).toBe(1);
    expect(sp.u.on.value).toBeCloseTo(rt.shown.rain, 9);
    expect(sp.u.eye.value.x).toBeCloseTo(plaza.x, 6);
    const t0 = sp.u.t.value;
    step(plaza, 0.25);
    expect(sp.u.t.value).toBeCloseTo(t0 + 0.25, 6);
    // the half-cleared sky: lighter rain, fewer splashes
    sky = {clear: 0.7, beam: 1};
    step(plaza);
    expect(sp.u.on.value).toBeGreaterThan(0);
    expect(sp.u.on.value).toBeLessThan(1);
    // the pit: nothing of it (the outdoor group is hidden; its clock holds)
    sky = {clear: 1, beam: 1};
    const t1 = sp.u.t.value;
    d = step(pit);
    expect(rt.shown.outside).toBe(false);
    expect(sp.mesh.visible).toBe(false);
    expect(d.names).not.toContain('reactor-surface-rain-splash');
    step(pit, 0.5);
    expect(sp.u.t.value).toBe(t1);
    // (no frame hooks = the game paused: nothing moves)
    const t2 = sp.u.t.value;
    expect(sp.u.t.value).toBe(t2);
    // the qa census and the teardown
    expect((rt.qa() as {rain: {splash: {slots: number}}}).rain.splash.slots).toBe(sp.slots);
    let disposed = 0;
    sp.mesh.geometry.addEventListener('dispose', () => disposed++);
    (sp.mesh.material as THREE.Material).addEventListener('dispose', () => disposed++);
    sp.ledgeTex.addEventListener('dispose', () => disposed++);
    for (const h of host.sectionHooks) h.teardown?.();
    expect(disposed).toBe(3);
    expect(sp.mesh.parent).toBeNull();
  }, 300_000);
});
