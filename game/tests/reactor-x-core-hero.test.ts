// Task reactor-expansion-20261101 (lane CORE): THE HERO REACTOR on REAL generated layouts — the assembled structure (the lead's hero
// models through the arch GLB-swap seam: steam generators, vertical coolant pumps, manifolds, the turbine; many pipes, the header ring,
// risers, gantries, the CRDM platform), nothing of it in a walkway (every hero instance over the ring / bridges / outer floor keeps the
// headroom, none in a deck's walk volume), bounded draw calls / triangles, the dynamic layer (goop over every pool cell, coolant sleeves,
// sight glasses, rotors, status lamps), the world build (no concrete drum hides the vessel: its grid column is not drawn; the ring and
// bridges are grating; the visuals carry the core) and the bounded boot-time glow lights (2 green + 1 blue, scatter / vfOpen).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {generateReactorLevel, CORE_LEVEL} from '../src/gen/reactor/index';
import {KitPlan, planReactorKit, type KitMat} from '../src/world/reactor/archKit';
import {buildKitMeshes} from '../src/world/reactor/archMeshes';
import {REACTOR_MODELS, REACTOR_PIECES} from '../src/world/reactor/archAssets';
import {CORE_HERO, coreHeroOf, planReactorCore} from '../src/world/reactor/coreHero';
import {buildCoreLiquids} from '../src/world/reactor/coreLiquids';
import {CoreVisuals, setActiveCoreVisuals} from '../src/world/reactor/coreVisuals';
import {CORE_LIGHTS, CoreLights} from '../src/world/reactor/coreLights';
import {CORE_LOOK} from '../src/world/reactor/coreStages';
import {emptyReactorState} from '../src/world/reactor/runState';
import {loadStripped, fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 9100];
const layouts = new Map<number, StationLayout>();
const L = (seed: number) => { let x = layouts.get(seed); if (!x) { x = generateReactorLevel({levelSeed: seed}); layouts.set(seed, x); } return x; };
const stubMats = (): ((k: Exclude<KitMat, 'marker'>) => THREE.Material) => {
  const cache = new Map<string, THREE.Material>();
  return k => { let m = cache.get(k); if (!m) { m = k === 'glow' || k === 'panelLamp' ? new MeshBasicNodeMaterial() : new THREE.MeshStandardMaterial(); m.name = k; cache.set(k, m); } return m; };
};

describe('hero plan on real layouts', () => {
  let models: Record<string, GLTF> = {};
  beforeAll(async () => {
    for (const p of REACTOR_PIECES) models[REACTOR_MODELS[p].key] = await loadStripped(REACTOR_MODELS[p].url);
  }, 180_000);

  for (const seed of SEEDS) {
    it(`seed ${seed}: the lead's hero models placed per loop (real size, on the goop), the turbine on its wall run`, () => {
      const R = L(seed).reactor!, cf = R.coreFloor!;
      const plan = planReactorKit(R, {models: new Set(REACTOR_PIECES), fixtures: true});
      const hero = coreHeroOf(plan)!;
      expect(hero).toBeTruthy();
      const count = (p: string) => plan.modelPlacements.get(p as never)?.length ?? 0;
      expect(count('steamGenerator')).toBe(cf.loops.filter(l => l.sg).length);
      expect(count('rcpVertical')).toBe(cf.loops.filter(l => l.rcp).length);
      expect(count('coolantManifold')).toBe(cf.loops.filter(l => l.manifold).length);
      expect(count('turbineGenerator')).toBe(cf.turbine ? 1 : 0);
      expect(hero.stats.procedural).toBe(0);
      // real size (scale 1) at the record's points: steam generators stand on the pool floor
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      plan.modelPlacements.get('steamGenerator')!.forEach((pl, i) => {
        pl.m.decompose(p, q, s);
        const sg = cf.loops.filter(l => l.sg)[i].sg!;
        expect(s.x).toBeCloseTo(1); expect(s.y).toBeCloseTo(1);
        expect(p.x).toBeCloseTo(sg.x); expect(p.z).toBeCloseTo(sg.z); expect(p.y).toBeCloseTo(cf.pool.floorY);
      });
      // many pipes: per loop hot / cold / crossover legs + feeds, the header ring, risers, the CRDM housings
      expect(hero.flows.filter(f => f.kind === 'hot').length).toBeGreaterThanOrEqual(3);
      expect(hero.flows.filter(f => f.kind === 'cold').length).toBeGreaterThanOrEqual(3);
      expect(hero.flows.filter(f => f.kind === 'cross').length).toBeGreaterThanOrEqual(2);
      expect(hero.stats.pipes).toBeGreaterThan(80);
      expect(hero.stats.risers).toBeGreaterThan(10);
      // (follow-up) the lead's CRDM service platform on the dome, pipe elbows at the square bends, sight-glass spools inline
      expect(count('crdmPlatform')).toBe(1);
      expect(hero.stats.crdm).toBe(0); // its procedural stand-in is not drawn
      expect(count('pipeElbow')).toBeGreaterThanOrEqual(4);
      expect(count('pipeElbow')).toBeLessThanOrEqual(REACTOR_MODELS.pipeElbow.cap);
      expect(count('sightGlassSpool')).toBeGreaterThanOrEqual(3);
      expect(hero.windows.length).toBe(count('sightGlassSpool'));
      // the CRDM platform's skirt sits on the dome: base at the dome height at its skirt radius, centred on the vessel axis
      plan.modelPlacements.get('crdmPlatform')![0].m.decompose(p, q, s);
      expect(p.x).toBeCloseTo(cf.x); expect(p.z).toBeCloseTo(cf.z);
      expect(p.y - cf.y).toBeGreaterThan(9.3); expect(p.y - cf.y).toBeLessThan(9.6);
      // every elbow's two ports land on the ends of drawn straight pipes (2 cm), every spool's ends on a cut in a coolant run
      const ends = hero.flows.flatMap(f => (f.segs ?? []).flatMap(g => [g.a, g.b]));
      const near = (v: THREE.Vector3) => ends.some(e => Math.hypot(e.x - v.x, e.y - v.y, e.z - v.z) < 0.02);
      const EA = REACTOR_MODELS.pipeElbow.anchors as unknown as {down: number[]; side: number[]};
      for (const pl of plan.modelPlacements.get('pipeElbow')!) {
        const dn = new THREE.Vector3(...(EA.down as [number, number, number])).applyMatrix4(pl.m), sd = new THREE.Vector3(...(EA.side as [number, number, number])).applyMatrix4(pl.m);
        expect(near(dn), `elbow down port ${dn.toArray().map(v => v.toFixed(2))}`).toBe(true);
        expect(near(sd), `elbow side port ${sd.toArray().map(v => v.toFixed(2))}`).toBe(true);
      }
      const SA = REACTOR_MODELS.sightGlassSpool.anchors as unknown as {axisY: number; len: number};
      for (const pl of plan.modelPlacements.get('sightGlassSpool')!) {
        for (const x of [-SA.len / 2, SA.len / 2]) expect(near(new THREE.Vector3(x, SA.axisY, 0).applyMatrix4(pl.m)), 'spool end on a cut pipe').toBe(true);
      }
      expect(hero.stats.gantries).toBeGreaterThanOrEqual(1);
      expect(hero.wheels.filter(w => w.kind === 'rcp').length).toBe(count('rcpVertical'));
      expect(hero.lights.green.length).toBe(2);
      expect(hero.lights.blue.length).toBe(1);
      // status lamps at the core only. Task reactor-playtest-round2-20261102 (lane PROPS, intent change from the user's "strange floating
      // disks with lights on top over some objects (remove)"): the restart sites' disc + bulb "on top of the machine" lamps floated over
      // the valve wheel / switchgear / pump / console and are gone; each site's state is on its mounted panel lamps (restartViews.ts)
      expect(hero.lamps.filter(l => l.site)).toEqual([]);
      expect(new Set(hero.lamps.map(l => l.group))).toEqual(new Set(['power', 'valve', 'pump', 'key', 'rods']));
      expect(hero.lamps.length).toBeGreaterThan(20);
    }, 60_000);

    it(`seed ${seed}: nothing of the hero in a walkway (ring / bridges / outer floor keep the headroom) or a deck's walk volume`, () => {
      const lay = L(seed), R = lay.reactor!, cf = R.coreFloor!, g = lay.levels[CORE_LEVEL].grid;
      const plan = new KitPlan(R, {models: new Set(REACTOR_PIECES), fixtures: true});
      planReactorCore(plan, R);
      const walk = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.walkable(cx, cy) && Math.abs(g.floor[g.idx(cx, cy)] - cf.y) < 1e-3; };
      const bad: string[] = [];
      const e = new THREE.Vector3(), b = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (const [key, part] of plan.parts) {
        for (const inst of part.list) {
          inst.m.extractBasis(b[0], b[1], b[2]);
          const len = b.map(v => v.length());
          const ax = len.indexOf(Math.max(...len)), half = Math.max(...len.filter((_, i) => i !== ax)) / 2;
          if (half <= 0.035 || part.geo === 'stripe') continue; // railings / toe boards on the railing line, fascia stripes
          const c = e.setFromMatrixPosition(inst.m), dir = b[ax].clone().normalize(), L2 = len[ax] / 2;
          for (let t = -L2; t <= L2 + 1e-6; t += 0.25) {
            const x = c.x + dir.x * t, y = c.y + dir.y * t, z = c.z + dir.z * t;
            if (Math.hypot(x - cf.x, z - cf.z) > cf.pool.r1 + 8) continue;
            if (walk(x, z) && y + half > cf.y + 0.12 && y - half < cf.y + 2.3) { bad.push(`${key} at ${x.toFixed(1)},${y.toFixed(2)},${z.toFixed(1)}`); break; }
            for (const d of R.decks) if (x > d.rect.x0 && x < d.rect.x1 && z > d.rect.z0 && z < d.rect.z1 && y + half > d.y + 0.05 && y - half < d.y + 2.3) { bad.push(`${key} in deck ${d.kind} L${d.level}`); break; }
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
      // the coolant runs over a walkway keep CORE_HERO.headroom
      for (const f of coreHeroOf(plan)!.flows) for (const p of f.pts) if (walk(p.x, p.z)) expect(p.y - f.d / 2, `${f.kind} over a walkway`).toBeGreaterThanOrEqual(cf.y + CORE_HERO.headroom - 1e-6);
    }, 60_000);

    it(`seed ${seed}: bounded — kit draw calls / triangles with the hero and every model, the dynamic layer`, () => {
      const lay = L(seed), R = lay.reactor!;
      const plan = planReactorKit(R, {models: new Set(REACTOR_PIECES), fixtures: true});
      const group = new THREE.Group();
      const built = buildKitMeshes(group, plan, stubMats(), models);
      const meshes = group.children.filter(o => (o as THREE.Mesh).isMesh).length;
      process.stdout.write(`[reactor-x-core] seed ${seed}: kit meshes ${meshes}, instances ${plan.instanceCount}, triangles ${Math.round(built.stats.triangles)} (models ${Math.round(built.stats.modelTriangles)})\n`);
      expect(meshes).toBeLessThanOrEqual(220);
      expect(built.stats.triangles).toBeLessThan(2_600_000);
      const hero = coreHeroOf(plan)!;
      const core = buildCoreLiquids(hero, lay.levels[CORE_LEVEL].grid, new THREE.MeshStandardMaterial(), [CORE_LEVEL, CORE_LEVEL - 1]);
      expect(core.group.children.length).toBeLessThanOrEqual(5);
      expect(core.stats.goopCells).toBe(R.coreFloor!.pool.cells); // the goop covers every pool cell
      expect(core.stats.flowSegments).toBeGreaterThan(20);
      expect(core.stats.glasses).toBe(hero.glasses.length);
      expect(core.stats.windows).toBe(hero.windows.length); // the coolant glows in every spool's window
      // without the models: the procedural CRDM stand-in, collars instead of elbows, no spools
      const bare = coreHeroOf(planReactorKit(R, {fixtures: true}))!;
      expect(bare.stats.crdm).toBeGreaterThan(30);
      expect(bare.stats.elbows).toBe(0);
      expect(bare.windows.length).toBe(0);
      expect(core.stats.lamps).toBe(hero.lamps.length);
      expect(core.stats.triangles).toBeLessThan(60_000);
      // the goop surface sits on the pool (its surface height) and never above the deck
      const pos = core.goop!.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 37) expect(pos.getY(i)).toBeCloseTo(R.coreFloor!.pool.surfaceY);
    }, 60_000);
  }
});

describe('the world build carries the hero (real layout)', () => {
  installCanvasShim(false);
  it('no concrete drum: the vessel column / pool floor are not drawn, the ring + bridges are grating, the dynamic layer + core visuals exist', () => {
    const lay = L(9100);
    const w = buildWorld(lay, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const arch = w.reactorArch!;
    expect(arch).toBeDefined();
    const cf = lay.reactor!.coreFloor!;
    // the builder's meshes: the hidden key carries the vessel column / pool floor (never drawn), rusted plate lines the goop walls
    const byName = new Map<string, THREE.Mesh>();
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) byName.set(o.name, o as THREE.Mesh); });
    const hidden = [...byName.values()].filter(m => m.name.startsWith('reactor-arch-core-hidden') || m.name.startsWith('reactor-arch-core-goop'));
    expect(hidden.length).toBeGreaterThan(0);
    for (const m of hidden) expect((m.material as THREE.Material).visible).toBe(false);
    expect(arch.stats.faces['reactor-deck-under']).toBeGreaterThan(50);
    // no drawn wall face reaches up past the plinth round the vessel: the model shows
    const g = lay.levels[CORE_LEVEL].grid, [cx, cy] = g.cellOf(cf.x, cf.z);
    expect(arch.floorKey(lay.levels.findIndex(l => l.id === CORE_LEVEL), g.idx(cx, cy))).toBe('reactor-core-hidden');
    const ringCell = g.cellOf(cf.x + 8.2, cf.z), ri = g.idx(ringCell[0], ringCell[1]);
    if (g.walkable(ringCell[0], ringCell[1])) expect(arch.floorKey(lay.levels.findIndex(l => l.id === CORE_LEVEL), ri)).toBe('reactor-grating');
    // the dynamic layer is in the world and the visuals carry the core
    expect(arch.core).toBeTruthy();
    expect(w.group.getObjectByName('core-goop')).toBeTruthy();
    expect(w.group.getObjectByName('core-coolant-flow')).toBeTruthy();
    expect(arch.visuals.core).toBeInstanceOf(CoreVisuals);
    arch.visuals.setRestartState(emptyReactorState(3, 3), true);
    expect(arch.visuals.core!.level.core).toBe(0);
    arch.dispose();
  }, 120_000);
});

describe('the reactor glow lights (boot-time, bounded, intensity-only)', () => {
  it('3 PointLights added once; placed on a Reactor build (2 scatter lights, vfOpen); dormant green / no blue; pump + core drive them; teardown dark', () => {
    const scene = new THREE.Scene();
    const sectionHooks: {build?(l: StationLayout): void; teardown?(): void}[] = [], frameHooks: ((dt: number) => void)[] = [];
    const scat: THREE.PointLight[] = [];
    const lay = L(1);
    const plan = planReactorKit(lay.reactor!, {fixtures: true});
    const host = {scene, sectionHooks, frameHooks, atmosphere: {addScatterLight: (l: THREE.PointLight) => { scat.push(l); return true; }, removeScatterLight: (l: THREE.PointLight) => { scat.splice(scat.indexOf(l), 1); return true; }}, world: {reactorArch: {plan}}};
    const cl = new CoreLights(host).install();
    const lights = () => scene.children.filter(o => (o as THREE.PointLight).isPointLight) as THREE.PointLight[];
    expect(lights().length).toBe(CORE_LIGHTS.green.count + CORE_LIGHTS.blue.count);
    expect(lights().length).toBe(3);
    expect(lights().every(l => l.intensity === 0 && !l.castShadow && l.userData.vfOpen === true)).toBe(true);
    setActiveCoreVisuals(null);
    sectionHooks[0].build!(lay);
    expect(scat.length).toBe(2);
    const hero = coreHeroOf(plan)!;
    expect(cl.green[0].position.y).toBeCloseTo(hero.lights.green[0].y);
    for (const f of frameHooks) f(0.016);
    expect(cl.green[0].intensity).toBeCloseTo(CORE_LOOK.greenDormant); // the dormant green glow before anything is done
    expect(cl.blue[0].intensity).toBe(0);
    const v = new CoreVisuals(null, hero);
    setActiveCoreVisuals(v);
    const s = emptyReactorState(3, 3);
    s.fuses = [true, true]; s.breaker = true; s.valve = true; s.pump = true;
    v.setRestartState(s, true);
    for (const f of frameHooks) f(0.016);
    expect(cl.blue[0].intensity).toBeGreaterThan(100);
    s.keyInserted = true; s.rods = true; s.restarted = true;
    v.setRestartState(s, true);
    for (const f of frameHooks) f(0.016);
    expect(cl.green[0].intensity).toBeGreaterThan(CORE_LOOK.greenDormant * 3.5);
    // leaving the level: dark, scatter released; the light set never changes
    sectionHooks[0].teardown!();
    expect(scat.length).toBe(0);
    expect(lights().every(l => l.intensity === 0)).toBe(true);
    sectionHooks[0].build!({} as StationLayout); // any other level
    for (const f of frameHooks) f(0.016);
    expect(lights().every(l => l.intensity === 0)).toBe(true);
    expect(lights().length).toBe(3);
    setActiveCoreVisuals(null);
  });
});
