// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): RAIN + THE SURFACE's COST — user: "It should be raining! And
// the fog is now cleared!". Pins, on REAL Reactor layouts with lane ENDING's surface contract:
//  1. SHELTERED: the rain floor (world/reactor/surfaceRain.ts buildRainFloor, read per drop by the shader, CPU mirror rainFloorAt) gives
//     NO rain at any point in the pit (every deck of every storey, the rock rooms, the air under the slab), under the stair head
//     house's roof or inside a building; rain over the open plaza and the city ground; and through the aperture (the one natural
//     exception), never outside its disc;
//  2. BOUNDED: each rain layer is ONE mesh / ONE draw (forceSinglePass) of a fixed drop count; the near box is bounded round the eye;
//  3. THE RUNTIME (world/reactor/surface.ts, a fake Game host, the real kit models): nothing outside before the win; after it the
//     near rain only with the eye outside, the aperture column only from the pit near the opening; the olive FogExp2 swapped for the
//     light rain mist outside and restored exactly inside; the far plane likewise; STARTUP's state read, nothing persisted;
//  4. CULLING: ZERO surface draws from every pit pose (the reactor-cpu-submit poses — rim gallery, rim down to the core, mid-tier deck —
//     and every deck kind of every storey x 4 directions, the core ring) before the win, and at most the aperture column after it;
//     outside the city's draws / triangles are bounded (numbers in LL_SURFACE_RAIN_OUT);
//  5. SHADERS: every new material (city model, ground, parapet, film, sky, steel, rain) compiles on both backends (GLSL / WGSL) within
//     WebGPU's 12 uniform buffers per stage (three r186: each uniformArray is its own buffer — none here) and at most 2 textures.
import {appendFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLSLNodeBuilder, WGSLNodeBuilder, type WebGPURenderer} from 'three/webgpu';
import {describe, expect, it} from 'vitest';
import {surfaceEyeOpen, surfaceEyeOutside, surfaceSiteOf} from '../src/world/reactor/surfaceSite';
import {surfaceRainExposure} from '../src/world/reactor/audioRain';
import {CELL, SOLID} from '../src/gen/grid';
import {SURFACE_CITY, planSurfaceCity, footprintCorners} from '../src/world/reactor/surfacePlan';
import {SURFACE_RAIN, buildRainFloor, rainsAt} from '../src/world/reactor/surfaceRain';
import {SURFACE_LOOK, mistOpacity, surfaceModelMaterial} from '../src/world/reactor/surfaceLook';
import {buildSurfaceView, disposeSurfaceView} from '../src/world/reactor/surfaceCity';
import {ReactorSurface, SURFACE_RT, reactorSurfaceAmbience} from '../src/world/reactor/surface';
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import {setAttributeInstancing} from '../src/render/instancing';
import {rendererFor} from './helpers/fogCompile';
import {SURFACE_SEEDS, fakeSurfaceHost, inCatalogue, poseCamera, surfaceDraws, surfaceLayout, surfaceModels} from './reactor-surface-fixture';
import type {StationLayout} from '../src/gen/stationTypes';

const OUT = process.env.LL_SURFACE_RAIN_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const EYE = 1.62;
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** Pit poses: reactor-cpu-submit.test.ts keyPoses (rim gallery, rim down at the core, mid-tier deck) + every deck kind / storey x 4. */
function pitPoses(layout: StationLayout): {name: string; x: number; y: number; z: number; yaw: number; pitch: number}[] {
  const r = layout.reactor!, core = r.core, poses: {name: string; x: number; y: number; z: number; yaw: number; pitch: number}[] = [];
  const rimDecks = r.decks.filter(d => d.kind === 'gallery' && d.level === 0);
  const span = (d: (typeof rimDecks)[number]) => Math.max(d.rect.x1 - d.rect.x0, d.rect.z1 - d.rect.z0);
  const long = [...rimDecks].sort((a, b) => span(b) - span(a))[0];
  const g = long.rect, alongX = g.x1 - g.x0 >= g.z1 - g.z0;
  const gx = alongX ? g.x0 + 1.5 : (g.x0 + g.x1) / 2, gz = alongX ? (g.z0 + g.z1) / 2 : g.z0 + 1.5;
  poses.push({name: 'rim-gallery', x: gx, y: long.y + EYE, z: gz, yaw: alongX ? yawTo(gx, gz, g.x1, gz) : yawTo(gx, gz, gx, g.z1), pitch: -0.1});
  const cx = alongX ? (g.x0 + g.x1) / 2 : core.x < (g.x0 + g.x1) / 2 ? g.x0 + 0.6 : g.x1 - 0.6;
  const cz = alongX ? (core.z < (g.z0 + g.z1) / 2 ? g.z0 + 0.6 : g.z1 - 0.6) : (g.z0 + g.z1) / 2, d = Math.hypot(core.x - cx, core.z - cz);
  poses.push({name: 'rim-down', x: cx, y: long.y + EYE, z: cz, yaw: yawTo(cx, cz, core.x, core.z), pitch: Math.atan2(core.y0 + 3 - (long.y + EYE), d)});
  // rim looking UP through the opening (the sky / the column)
  poses.push({name: 'rim-up', x: cx, y: long.y + EYE, z: cz, yaw: yawTo(cx, cz, core.x, core.z), pitch: 0.75});
  const seen = new Set<string>();
  for (const dk of r.decks) {
    if (dk.kind === 'stair-landing' || seen.has(`${dk.kind}${dk.level}`)) continue;
    seen.add(`${dk.kind}${dk.level}`);
    const x = (dk.rect.x0 + dk.rect.x1) / 2, z = (dk.rect.z0 + dk.rect.z1) / 2;
    for (const [yaw, pitch] of [[0, -0.3], [Math.PI / 2, 0.4], [Math.PI, -0.6], [-Math.PI / 2, 0.9]]) poses.push({name: `${dk.kind}-L${dk.level}`, x, y: dk.y + EYE, z, yaw, pitch});
  }
  const cf = r.coreFloor;
  if (cf) for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, rr = (cf.ring.r0 + cf.ring.r1) / 2, x = cf.x + Math.cos(a) * rr, z = cf.z + Math.sin(a) * rr;
    poses.push({name: 'core-ring', x, y: cf.y + EYE, z, yaw: yawTo(x, z, cf.x, cf.z), pitch: k % 2 ? 1.1 : -0.1});
  }
  return poses;
}

describe('the rain floor: sheltered indoors, open outdoors, through the aperture only inside its disc', () => {
  it('no rain anywhere in the pit, under the head house or inside a building; rain over the plaza / the city ground', () => {
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), site = surfaceSiteOf(L)!, info = L.reactor!, s = info.surface!;
      const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, info.pit.bounds);
      const m = buildRainFloor(site, plan);
      const o = site.hole;
      const inHole = (x: number, z: number) => Math.hypot(x - o.x, z - o.z) < o.r - 0.75; // (+ a texel's diagonal of slack)
      const nearHole = (x: number, z: number) => Math.hypot(x - o.x, z - o.z) < o.r + 0.75;
      let pit = 0, open = 0, hole = 0;
      // every walkable cell of every pit storey at head height, and the air just under the roof slab
      for (const lv of L.levels) {
        if (lv.id >= info.tiers.length) continue;
        const g = lv.grid;
        for (let cy = 0; cy < g.h; cy += 2) for (let cx = 0; cx < g.w; cx += 2) {
          const i = g.idx(cx, cy);
          if (g.cells[i] === SOLID) continue;
          const [x, z] = [(cx + 0.5) * CELL, (cy + 0.5) * CELL];
          if (nearHole(x, z)) continue;
          expect(rainsAt(m, x, g.floor[i] + 1.8, z), `pit L${lv.id} (${x}, ${z})`).toBe(false);
          expect(rainsAt(m, x, info.pit.roofY - 0.2, z), `under the slab (${x}, ${z})`).toBe(false);
          pit++;
        }
      }
      // the head house: everywhere under its roof
      const hr = s.head.rect;
      for (let x = hr.x0 + 0.3; x < hr.x1; x += 0.7) for (let z = hr.z0 + 0.3; z < hr.z1; z += 0.7) for (const y of [s.y + 0.3, s.y + 1.7, s.head.top - 0.1]) expect(rainsAt(m, x, y, z), `head house (${x}, ${z}, ${y})`).toBe(false);
      // inside the city's buildings (below their tops)
      for (const p of plan.placements.filter(q => q.kind === 'building')) {
        const [cx, cz] = [p.x, p.z];
        if (cx < m.x0 + m.cell || cz < m.z0 + m.cell || cx > m.x0 + (m.w - 1) * m.cell || cz > m.z0 + (m.h - 1) * m.cell) continue; // beyond the map (the near box never reaches it from the plaza)
        expect(rainsAt(m, cx, p.y + p.h * 0.5, cz), `inside ${p.entry}`).toBe(false);
        expect(rainsAt(m, cx, p.y + p.h + 0.5, cz), `over ${p.entry}`).toBe(true);
      }
      // the open plaza (outside the head house) and the ground beyond the parapet: rain
      for (const w of s.walk) for (let x = w.x0 + 0.25; x < w.x1; x += 1.3) for (let z = w.z0 + 0.25; z < w.z1; z += 1.3) {
        if (nearHole(x, z) || (x >= hr.x0 - 0.75 && x <= hr.x1 + 0.75 && z >= hr.z0 - 0.75 && z <= hr.z1 + 0.75)) continue;
        expect(rainsAt(m, x, s.y + 0.05, z), `plaza (${x}, ${z})`).toBe(true);
        open++;
      }
      // the aperture: rain falls into the pit inside the disc, never outside it below the deck
      for (let x = o.x - o.r - 3; x <= o.x + o.r + 3; x += 0.6) for (let z = o.z - o.r - 3; z <= o.z + o.r + 3; z += 0.6) {
        const r = rainsAt(m, x, info.pit.roofY - 6, z);
        if (inHole(x, z)) { expect(r, `aperture (${x}, ${z})`).toBe(true); hole++; } else if (!nearHole(x, z)) expect(r, `beside the aperture (${x}, ${z})`).toBe(false);
      }
      out(`seed ${seed}: rain floor ${m.w} x ${m.h} cells; pit points ${pit} dry, plaza points ${open} wet, aperture points ${hole}`);
      expect(pit).toBeGreaterThan(500);
      expect(open).toBeGreaterThan(300);
      expect(hole).toBeGreaterThan(50);
    }
  }, 300_000);
});

const ubos = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
const texs = (src: string, backend: 'glsl' | 'wgsl') => backend === 'wgsl' ? (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length : (src.match(/^uniform\s+(highp\s+|mediump\s+|lowp\s+)?\w*sampler\w*\s+\w+;/gm) ?? []).length;

/** Compile a mesh's node material with the backend's builder (helpers/fogCompile.ts renderers; reactor-x-coolant-near.test.ts). */
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

describe('the surface view: bounded rain, every material inside WebGPU\'s binding budget', () => {
  it('rain layers are one draw each of a fixed drop count; every new material compiles within 12 uniform buffers per stage', async () => {
    const L = surfaceLayout(SURFACE_SEEDS[0]), site = surfaceSiteOf(L)!, info = L.reactor!;
    const lib = await surfaceModels();
    const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, info.pit.bounds);
    const concrete = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    concrete.needsUpdate = true;
    const v = buildSurfaceView(site, plan, k => lib[k], concrete, 7);
    try {
      for (const [layer, n] of [[v.near, SURFACE_RAIN.near.count], [v.column, SURFACE_RAIN.column.count]] as const) {
        expect(layer.count).toBe(n);
        expect(layer.mesh.geometry.index!.count).toBe(n * 6);
        expect(layer.mesh.geometry.getAttribute('position').count).toBe(n * 4);
        const mt = layer.mesh.material as THREE.Material;
        expect(mt.transparent && mt.forceSinglePass).toBe(true); // ONE draw (never split into back / front passes)
        expect(layer.mesh.castShadow).toBe(false);
      }
      const N = SURFACE_RAIN.near;
      expect(N.half * 2 * (N.below + N.above) * N.half * 2).toBeLessThan(40 * 40 * 25); // the near box is bounded
      // the materials: a city model (a mapped Meshy part, instanced, attribute instancing on / off), ground, parapet, film, sky, steel, rain
      const mapped = new THREE.MeshStandardMaterial({map: concrete});
      const meshes: [string, THREE.Mesh][] = [
        ['model', new THREE.InstancedMesh(new THREE.BoxGeometry(), surfaceModelMaterial(mapped), 3)],
        ['ground', new THREE.Mesh(v.ground.geometry, v.ground.material)], ['film', new THREE.Mesh(v.film!.geometry, v.film!.material)],
        ['parapet', new THREE.Mesh(v.parapet!.geometry, v.parapet!.material)], ['sky', new THREE.Mesh(v.sky.geometry, v.sky.material)],
        ['near-rain', new THREE.Mesh(v.near.mesh.geometry, v.near.mesh.material)], ['column-rain', new THREE.Mesh(v.column.mesh.geometry, v.column.mesh.material)],
        ...v.instanced.filter(im => /stand/.test(im.name)).slice(0, 1).map(im => ['steel', new THREE.InstancedMesh(im.geometry, im.material, 2)] as [string, THREE.Mesh]),
      ];
      for (const backend of ['glsl', 'wgsl'] as const) for (const attr of [true, false]) {
        setAttributeInstancing(attr);
        try {
          for (const [name, mesh] of meshes) {
            const c = compileMesh(mesh, backend);
            expect(c.fragment.length, name).toBeGreaterThan(400);
            for (const [stage, src] of [['vertex', c.vertex], ['fragment', c.fragment]] as const) {
              const u = ubos(src, backend), t = texs(src, backend);
              out(`${name} ${backend} attr=${attr} ${stage}: uniform buffers ${u}, textures ${t}`);
              expect(u, `${name} ${backend} ${stage} uniform buffers`).toBeLessThanOrEqual(12);
              expect(t, `${name} ${backend} ${stage} textures`).toBeLessThanOrEqual(2);
            }
          }
        } finally {
          setAttributeInstancing(false);
        }
      }
      // no shadow casters anywhere in the surface
      v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).castShadow, o.name).toBe(false); });
      out(`view: ${v.instanced.length} instanced city meshes, ${v.tris} triangles at full, drawn ${JSON.stringify(v.drawn)}`);
    } finally {
      disposeSurfaceView(v);
    }
  }, 300_000);
});

describe('the runtime: the eye gate, the win, the mist / far-plane swap, ZERO surface draws from the pit', () => {
  it('pit poses draw nothing of the surface (before the win: nothing at all; after: at most the aperture column); outside it is bounded', async () => {
    const lib = await surfaceModels();
    let worstOut = 0, worstTris = 0;
    for (const seed of SURFACE_SEEDS.slice(0, 3)) {
      const L = surfaceLayout(seed), info = L.reactor!, s = info.surface!;
      const host = fakeSurfaceHost(lib);
      const rt = new ReactorSurface(host).install();
      let sky = {clear: 0, beam: 0};
      rt.findSky = () => sky;
      expect(host.sectionModelKeys[0](L).length).toBeGreaterThanOrEqual(10);
      expect(host.pools.map(p => p[0])).toContain('reactor-surface');
      for (const h of host.sectionHooks) h.build?.(L);
      const v = rt.view!;
      expect(v.root.parent).toBe(host.scene);
      const fog = host.scene.fog as THREE.FogExp2, far0 = host.camera.far;
      const step = (p: {x: number; y: number; z: number; yaw: number; pitch: number}) => { poseCamera(host.camera, p.x, p.y, p.z, p.yaw, p.pitch); for (const f of host.frameHooks) f(1 / 60); return surfaceDraws(v.root, host.camera); };
      for (const won of [false, true]) {
        sky = won ? {clear: 1, beam: 1} : {clear: 0, beam: 0};
        let columnDraws = 0, poses = 0;
        for (const p of pitPoses(L)) {
          const d = step(p);
          poses++;
          if (!won) expect(d.draws, `${seed} ${p.name} before the win: ${d.names.join(', ')}`).toBe(0);
          else {
            expect(d.names.every(n => n === 'reactor-surface-rain-aperture'), `${seed} ${p.name}: ${d.names.join(', ')}`).toBe(true);
            columnDraws += d.draws;
          }
          expect(rt.shown.outside).toBe(false);
          expect(v.outdoor.visible).toBe(false);
          expect(fog.density).toBe(REACTOR_FOG.density); // the pit keeps its olive haze
          expect(host.camera.far).toBe(far0);
        }
        out(`seed ${seed} ${won ? 'won' : 'dormant'}: ${poses} pit poses, surface draws ${won ? columnDraws + ' (the aperture column only)' : 0}`);
        if (won) expect(columnDraws).toBeGreaterThan(0); // seen looking up through the opening
      }
      // outside after the win: the plaza, looking out over the parapet in 8 directions
      const w = [...s.walk].sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
      const ex = (w.x0 + w.x1) / 2 + (w.x1 - w.x0) * 0.3, ez = (w.z0 + w.z1) / 2;
      for (let k = 0; k < 8; k++) {
        const d = step({x: ex, y: s.y + EYE, z: ez, yaw: (k * Math.PI) / 4, pitch: k % 2 ? 0.12 : -0.05});
        expect(rt.shown.outside && rt.shown.open && rt.shown.near && !rt.shown.column).toBe(true);
        expect(reactorSurfaceAmbience()).toEqual({outside: true, open: true, rain: 1});
        worstOut = Math.max(worstOut, d.draws);
        worstTris = Math.max(worstTris, d.tris);
        out(`seed ${seed} outside yaw ${k * 45}: ${d.draws} draws, ${Math.round(d.tris / 1000)} k triangles`);
      }
      // the light rain mist (non-toxic, not green) and the far plane outside; exact restore inside
      for (let i = 0; i < 900; i++) step({x: ex, y: s.y + EYE, z: ez, yaw: 0, pitch: 0});
      expect(fog.density).toBeCloseTo(SURFACE_LOOK.mist, 4);
      expect(fog.color.g).toBeLessThanOrEqual(Math.max(fog.color.r, fog.color.b) * 1.05);
      expect(host.camera.far).toBe(SURFACE_RT.far);
      expect(mistOpacity(100)).toBeLessThan(0.25); // clear air: ~20 % at 100 m
      step(pitPoses(L)[0]);
      expect(fog.density).toBe(REACTOR_FOG.density);
      expect(fog.color.getHex()).toBe(REACTOR_FOG.color);
      expect(host.camera.far).toBe(far0);
      // the head house: outside (the exit is in view) but sheltered (no open-air bed); before the win nothing at all outside
      const hr = s.head.rect;
      step({x: (hr.x0 + hr.x1) / 2, y: s.y + EYE, z: (hr.z0 + hr.z1) / 2, yaw: 0, pitch: 0});
      expect(rt.shown.outside && !rt.shown.open).toBe(true);
      sky = {clear: 0, beam: 0};
      step({x: ex, y: s.y + EYE, z: ez, yaw: 0, pitch: 0});
      expect(rt.shown.near || rt.shown.column).toBe(false);
      expect(rt.shown.rain).toBe(0);
      for (const h of host.sectionHooks) h.teardown?.();
      expect(v.root.parent).toBeNull();
      expect(fog.density).toBe(REACTOR_FOG.density);
    }
    out(`outside worst ${worstOut} draws, ${Math.round(worstTris / 1000)} k triangles`);
    expect(worstOut).toBeLessThanOrEqual(60);
  }, 600_000);

  it('what you see is what you hear: the visual gate agrees with lane AUDIO\'s rain exposure (audioRain.ts surfaceRainExposure)', () => {
    let n = 0;
    for (const seed of SURFACE_SEEDS) {
      const L = surfaceLayout(seed), info = L.reactor!, s = info.surface!, site = surfaceSiteOf(L)!;
      const hr = s.head.rect, inHead = (x: number, z: number) => x >= hr.x0 && x <= hr.x1 && z >= hr.z0 && z <= hr.z1;
      // the open plaza: near rain drawn round the eye + open air <-> the full open rain bed
      for (const w of s.walk) for (let x = w.x0 + 0.5; x < w.x1; x += 3) for (let z = w.z0 + 0.5; z < w.z1; z += 3) {
        if (inHead(x, z)) continue;
        const e = {x, y: s.y + EYE, z};
        expect(surfaceEyeOpen(site, e)).toBe(true);
        expect(surfaceRainExposure(s, L.levels, e)).toEqual({level: 1, muffle: 0});
        n++;
      }
      // the head house: outside (the exit's rain in view) but sheltered <-> a muffled bed
      const he = {x: (hr.x0 + hr.x1) / 2, y: s.y + EYE, z: (hr.z0 + hr.z1) / 2};
      expect(surfaceEyeOutside(site, he) && !surfaceEyeOpen(site, he)).toBe(true);
      expect(surfaceRainExposure(s, L.levels, he).muffle).toBeGreaterThan(0.3);
      // the pit (every deck): nothing drawn round the eye <-> silence
      for (const d of info.decks) {
        const e = {x: (d.rect.x0 + d.rect.x1) / 2, y: d.y + EYE, z: (d.rect.z0 + d.rect.z1) / 2};
        expect(surfaceEyeOutside(site, e)).toBe(false);
        if (!(e.x >= s.stairs.rect.x0 - 0.5 && e.x <= s.stairs.rect.x1 + 0.5 && e.z >= s.stairs.rect.z0 - 0.5 && e.z <= s.stairs.rect.z1 + 0.5)) expect(surfaceRainExposure(s, L.levels, e).level).toBe(0);
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it('the plan stays bounded round the opening and its buildings stand on the ground (grounded at the deck height)', () => {
    const L = surfaceLayout(SURFACE_SEEDS[2]), site = surfaceSiteOf(L)!;
    const plan = planSurfaceCity(site, L.seed >>> 0, inCatalogue, L.reactor!.pit.bounds);
    for (const p of plan.placements) {
      expect(p.y).toBe(site.y);
      for (const [x, z] of footprintCorners(p)) expect(Math.hypot(x - site.hole.x, z - site.hole.z)).toBeLessThanOrEqual(SURFACE_CITY.maxR + 1e-6); // (lane CITY: the outskirts belt reaches out to maxR)
    }
  });
});
