// Task reactor-build-20261101 (lane ARCH): the Reactor's industrial kit from a hand-built B-like ReactorInfo (tests/reactor-arch-fixture.ts):
//  - every deck gets supports (stringers / cross beams; galleries knee braces to the wall; the bridge Warren trusses), towers, the
//    crane, the organ pipe bank, fans, generators, the vessel, site machines, screen frames, bands + labels, lamps are all present;
//  - BOUNDED cost: instance counts / draw calls / triangles (procedural and with the lead's delivered models swapped in — the real
//    GLBs, textures stripped), one InstancedMesh per (part, band), every mesh tagged for the level culler;
//  - the GLB swap seam: every REACTOR_KIT model in the lazy file map, Reactor-only (levelAssets + the CI packager agree), fits
//    (vessel 2 x radius, generator in its footprint, fan ring = fan radius, pipe modules capped, lamps capped, switchgear 4-6 sections);
//  - the visuals API (fans ease + spin only while turning, generator lamps / jitter, core glow, tier power), O(1) setters;
//  - atmosphereFor / fog runtime: the Reactor's haze only on a Reactor layout.
import {describe, expect, it, beforeAll} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {archFixtureInfo} from './reactor-arch-fixture';
import {loadStripped} from './helpers/openablesFixture';
import {KIT, deckEdges, planReactorKit, type KitMat, type KitPlan} from '../src/world/reactor/archKit';
import {buildKitMeshes, type KitBuilt} from '../src/world/reactor/archMeshes';
import {ReactorArchVisuals} from '../src/world/reactor/archVisuals';
import {REACTOR_MODELS, REACTOR_MODEL_FILES, REACTOR_PIECES, REACTOR_TEXTURES, reactorModelKeysFor, reactorTextureLoads, type ReactorPiece} from '../src/world/reactor/archAssets';
import {REACTOR_KIT, REACTOR_TEXTURES as KIT_TEXTURES} from '../src/assets/reactorKit.generated';
import {levelOfAsset, assetAllowedIn} from '../src/assets/levelAssets';
import {ATMOSPHERE, atmosphereFor} from '../src/render/atmosphere';
import {REACTOR_ATMOSPHERE} from '../src/world/reactor/archHaze';
import {REACTOR_FOG, ReactorArchRuntime, reactorFogTransmittance} from '../src/world/reactor/archInstall';
import {MOOD} from '../src/world/lights';
import {LAMP} from '../src/world/reactor/archMaterials';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report: Record<string, unknown> = {};
const out = (k: string, v: unknown) => { report[k] = v; fs.writeFileSync('/tmp/reactor-arch-kit-report.json', JSON.stringify(report, null, 1)); };

/** Stub materials (no canvas / textures): one per kit material, named. */
const stubMats = (): ((k: Exclude<KitMat, 'marker'>) => THREE.Material) => {
  const cache = new Map<string, THREE.Material>();
  return k => { let m = cache.get(k); if (!m) { m = k === 'glow' || k === 'panelLamp' ? new MeshBasicNodeMaterial() : new THREE.MeshStandardMaterial(); m.name = k; cache.set(k, m); } return m; };
};
const meshesOf = (g: THREE.Group) => g.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);

describe('kit plan from a hand-built Reactor', () => {
  const info = archFixtureInfo();
  const plan = planReactorKit(info);

  it('every deck gets supports; galleries brace back to the wall, the bridge hangs Warren trusses, open edges get fascia + toe plates', () => {
    const s = plan.stats;
    expect(s.decks).toBe(info.decks.length);
    expect(s.decksSupported).toBe(info.decks.length);
    expect(s.deckBeams).toBeGreaterThan(info.decks.length * 3);
    expect(s.braces).toBeGreaterThan(20);
    expect(s.trusses).toBe(2); // one bridge, two sides
    expect(s.toePlates).toBeGreaterThan(5);
    expect(s.stripes).toBeGreaterThan(50);
    expect(s.stripes).toBeLessThanOrEqual(KIT.maxStripes);
    // the west galleries stand against the wall: their west edge is 'wall', the east edge open
    const g = info.decks[0], e = deckEdges(info, g);
    expect(e.find(x => x.nx === -1)!.kind).toBe('wall');
    expect(e.find(x => x.nx === 1)!.kind).toBe('open');
    // the bridge's long sides are open; its west end meets the gallery (joined), its east end the wall
    const b = deckEdges(info, info.decks.find(d => d.kind === 'bridge')!);
    expect(b.filter(x => x.nz !== 0).every(x => x.kind === 'open')).toBe(true);
    expect(b.find(x => x.nx === -1)!.kind).toBe('joined');
    expect(b.find(x => x.nx === 1)!.kind).toBe('wall');
  });

  it('towers, crane, pipe bank, fans, generators, vessel, machines, screens, bands, labels, ribs, lamps, roof beams are present', () => {
    const s = plan.stats;
    expect(s.towers).toBe(2);
    expect(s.towerMembers).toBeGreaterThan(100);
    expect(s.craneParts).toBeGreaterThan(15);
    expect(s.pipes).toBeGreaterThan(20);
    expect(s.flanges).toBeGreaterThan(200);
    expect(s.catwalks).toBeGreaterThanOrEqual(3);
    expect(s.fans).toBe(4);
    expect(plan.fans.map(f => f.id).sort()).toEqual([0, 1, 2, 3]);
    expect(s.generators).toBe(3);
    for (const g of plan.generators) { expect(g.body.length).toBeGreaterThanOrEqual(4); expect(g.lamps.length).toBe(2); }
    expect(s.cables).toBe(6);
    expect(s.vesselParts).toBeGreaterThan(0);
    expect(s.crdm).toBeGreaterThan(10);
    expect(s.gantries).toBeGreaterThanOrEqual(1);
    expect(plan.merged.map(m => m.name)).toEqual(expect.arrayContaining(['reactor-vessel-body', 'reactor-vessel-glow', 'reactor-vessel-steel', 'reactor-crane-hook']));
    expect(s.machines).toBeGreaterThanOrEqual(4 + 3); // switchgear bank (>= 4 sections) + valve + pump + console
    expect(s.screens).toBe(2);
    expect(s.bands).toBe(4 * 4); // 4 markers x 4 pit walls
    expect(s.markerLabels).toBe(4 * 4);
    expect(s.ribs).toBeGreaterThan(20);
    expect(s.lamps).toBeGreaterThan(40);
    expect(s.lamps).toBeLessThanOrEqual(KIT.maxLamps);
    expect(s.roofBeams).toBeGreaterThan(3);
    out('planStats', s);
  });

  it('bands follow the tiers: placements chunk by the tier they stand on / hang under; every band sees itself and the tier above', () => {
    expect(plan.bandOf(5)).toBe(0);
    expect(plan.bandOf(-10)).toBe(1);
    expect(plan.bandOf(-10.6)).toBe(2); // steel under the tier-1 deck is seen from tier 2 (and tier 1: bandLevels)
    expect(plan.bandLevels(2)).toEqual([2, 1]);
    expect(plan.bandOf(-60)).toBe(4);
  });

  it('is deterministic (same layout -> same kit)', () => {
    const a = planReactorKit(info), b = planReactorKit(info);
    expect([...a.parts.keys()]).toEqual([...b.parts.keys()]);
    for (const [k, p] of a.parts) expect(p.list.map(x => x.m.elements.join(','))).toEqual(b.parts.get(k)!.list.map(x => x.m.elements.join(',')));
  });
});

describe('render cost (bounded): procedural kit and with the delivered models', () => {
  let models: Record<string, GLTF> = {};
  beforeAll(async () => {
    for (const p of REACTOR_PIECES) models[REACTOR_MODELS[p].key] = await loadStripped(REACTOR_MODELS[p].url);
  }, 120000);

  const build = (withModels: boolean): {plan: KitPlan; built: KitBuilt; group: THREE.Group} => {
    const info = archFixtureInfo();
    const plan = planReactorKit(info, {models: withModels ? new Set(REACTOR_PIECES) : undefined});
    const group = new THREE.Group();
    const built = buildKitMeshes(group, plan, stubMats(), withModels ? models : {});
    return {plan, built, group};
  };

  it('procedural: <= 150 draw calls, bounded instances / triangles, one InstancedMesh per (part, band), every mesh tagged', () => {
    const {plan, built, group} = build(false);
    const ms = meshesOf(group);
    expect(ms.length).toBe(built.stats.meshes);
    expect(ms.length).toBeLessThanOrEqual(150);
    expect(plan.instanceCount).toBeLessThan(20000);
    expect(built.stats.triangles).toBeLessThan(900_000);
    const names = new Set(ms.map(m => m.name));
    expect(names.size).toBe(ms.length - 0); // unique per (part, band)
    for (const m of ms) if (m.name !== 'reactor-fan-rotors') expect(Array.isArray(m.userData.levels) && m.userData.levels.length > 0, m.name).toBe(true);
    expect(built.stats.modelMeshes).toBe(0);
    out('procedural', {draws: ms.length, instances: plan.instanceCount, triangles: Math.round(built.stats.triangles), byPart: built.stats.byPart});
  });

  it('with the delivered models: procedural pieces swapped, caps hold, still bounded (draws, triangles)', () => {
    const {plan, built, group} = build(true);
    const ms = meshesOf(group);
    expect(ms.length).toBeLessThanOrEqual(150);
    for (const p of ['vessel', 'generator', 'craneTrolley', 'craneHook', 'fanHousing', 'switchgear', 'coolantPump', 'controlConsole', 'pipeBank', 'coolantValve', 'floodLamp'] as ReactorPiece[]) {
      expect(plan.modelPlacements.get(p)?.length ?? 0, p).toBeGreaterThan(0);
      expect(plan.modelPlacements.get(p)!.length, p).toBeLessThanOrEqual(REACTOR_MODELS[p].cap);
      expect(built.modelSlots.get(p)?.length, p).toBe(plan.modelPlacements.get(p)!.length);
    }
    // swapped: no procedural vessel body, no procedural crane hook, fewer cages (model lamps carry a lens glow instead)
    expect(plan.merged.some(m => m.name === 'reactor-vessel-body')).toBe(false);
    expect(plan.merged.some(m => m.name === 'reactor-crane-hook')).toBe(false);
    expect(plan.lamps.filter(l => l.model).length).toBe(plan.modelPlacements.get('floodLamp')!.length);
    const total = built.stats.triangles;
    expect(total).toBeLessThan(2_000_000);
    out('withModels', {draws: ms.length, triangles: Math.round(total), modelTriangles: Math.round(built.stats.modelTriangles), modelInstances: built.stats.modelInstances,
      procTriangles: Math.round(total - built.stats.modelTriangles)});
  });

  it('fits: vessel spans 2 x radius, generator inside its footprint facing its panel, fan ring = fan radius, real-size machines, switchgear 4-6 sections', () => {
    const {plan} = build(true);
    const info = archFixtureInfo();
    const s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
    plan.modelPlacements.get('vessel')![0].m.decompose(p, q, s);
    expect(s.x * REACTOR_MODELS.vessel.dims[0]).toBeCloseTo(2 * info.core.radius, 5);
    expect(p.y).toBeCloseTo(info.core.y0, 6);
    for (const [i, g] of plan.modelPlacements.get('generator')!.entries()) {
      g.m.decompose(p, q, s);
      const rec = info.generators[i];
      expect(s.x * REACTOR_MODELS.generator.dims[0]).toBeLessThanOrEqual(rec.size.w + 1e-6);
      expect(s.x * REACTOR_MODELS.generator.dims[2]).toBeLessThanOrEqual(rec.size.d + 1e-6);
      // the model's control-box side (+Z local) faces the panel
      const side = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(side.x * (rec.panel.x - rec.x) + side.z * (rec.panel.z - rec.z)).toBeGreaterThan(0);
    }
    for (const [i, f] of plan.modelPlacements.get('fanHousing')!.entries()) {
      f.m.decompose(p, q, s);
      expect(s.x * (REACTOR_MODELS.fanHousing.anchors!.ringR as number)).toBeCloseTo(info.fans[i].radius, 5);
      // back plate on the wall plane (z = 56), front toward the pit (-z)
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(front.z).toBeLessThan(-0.99);
      expect(p.z).toBeCloseTo(info.fans[i].z + (REACTOR_MODELS.fanHousing.anchors!.back as number) * s.x, 5); // back plate (local z = back < 0) on the wall
    }
    for (const piece of ['craneTrolley', 'craneHook', 'coolantPump', 'controlConsole', 'coolantValve', 'switchgear', 'floodLamp'] as ReactorPiece[]) {
      for (const pl of plan.modelPlacements.get(piece)!) { pl.m.decompose(p, q, s); expect(s.x, piece).toBeCloseTo(1, 6); expect(s.y, piece).toBeCloseTo(1, 6); }
    }
    const sw = plan.modelPlacements.get('switchgear')!.length;
    expect(sw).toBeGreaterThanOrEqual(4);
    expect(sw).toBeLessThanOrEqual(6);
    // pipe modules: from the top down, flat-cut 4 m modules (real height), at most the cap
    const pb = plan.modelPlacements.get('pipeBank')!;
    const ys = [...new Set(pb.map(x => +x.m.elements[13].toFixed(3)))].sort((a, b) => b - a);
    expect(ys[0]).toBeCloseTo(info.pipeBanks[0].y1 - 4, 5);
    for (let i = 1; i < ys.length; i++) expect(ys[i - 1] - ys[i]).toBeCloseTo(4, 5);
    expect(pb.length).toBeLessThanOrEqual(REACTOR_MODELS.pipeBank.cap);
    expect(plan.stats.pipes).toBeGreaterThan(0); // the gassed depths below keep procedural pipes
  });
});

describe('visuals API (fans, generators, core glow, tier power)', () => {
  const info = archFixtureInfo();
  const plan = planReactorKit(info);
  const group = new THREE.Group();
  const glow = new MeshBasicNodeMaterial();
  const built = buildKitMeshes(group, plan, k => (k === 'glow' ? glow : stubMats()(k)), {});
  const v = new ReactorArchVisuals(built, plan, glow);

  it('fans: setFanSpeed is a target; tick eases toward it and spins ONLY turning fans; unknown ids are ignored', () => {
    v.tick(0.016);
    expect(v.lastTickWrites).toBe(0); // nothing turns, nothing runs: no instance writes
    const before = new THREE.Matrix4(); built.fanRotors!.getMatrixAt(1, before);
    v.setFanSpeed(1, 1);
    v.setFanSpeed(99, 1);
    v.setFanSpeed(2, Number.NaN);
    v.tick(0.5);
    const st = v.state();
    expect(st.fans.find(f => f.id === 1)!.speed).toBeGreaterThan(0.2);
    expect(st.fans.find(f => f.id === 1)!.speed).toBeLessThan(1);
    expect(st.fans.find(f => f.id === 0)!.speed).toBe(0);
    expect(st.fans.find(f => f.id === 2)!.target).toBe(0);
    const after = new THREE.Matrix4(); built.fanRotors!.getMatrixAt(1, after);
    expect(after.equals(before)).toBe(false);
    expect(v.lastTickWrites).toBe(1);
    for (let i = 0; i < 200; i++) v.tick(0.05);
    expect(v.state().fans.find(f => f.id === 1)!.speed).toBe(1);
    v.setFanSpeed(1, 0);
    for (let i = 0; i < 300; i++) v.tick(0.05);
    expect(v.state().fans.find(f => f.id === 1)!.speed).toBe(0);
  });

  it('generators: lamps switch red -> green at once, the body jitters only while running and comes back to rest exactly', () => {
    const g = plan.generators[0];
    const red = built.slot(g.lamps[0])!, green = built.slot(g.lamps[1])!;
    const c = new THREE.Color();
    red.mesh.getColorAt(red.index, c); expect(c.r).toBeGreaterThan(0.8);
    green.mesh.getColorAt(green.index, c); expect(c.g).toBeLessThan(0.2);
    v.setGeneratorRunning(0, 1);
    red.mesh.getColorAt(red.index, c); expect(c.r).toBeLessThan(0.4);
    green.mesh.getColorAt(green.index, c); expect(c.g).toBeGreaterThan(0.9);
    v.tick(0.016);
    expect(v.lastTickWrites).toBe(g.body.length);
    const body = built.slot(g.body[0])!, m = new THREE.Matrix4();
    const near = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((x, i) => Math.abs(x - b.elements[i]) < 1e-4);
    body.mesh.getMatrixAt(body.index, m);
    expect(near(m, body.base)).toBe(false);
    v.setGeneratorRunning(0, 0);
    v.tick(0.016);
    body.mesh.getMatrixAt(body.index, m);
    expect(near(m, body.base)).toBe(true); // float32 instance storage
    v.tick(0.016);
    expect(v.lastTickWrites).toBe(0);
    v.setGeneratorRunning(42, 1); // unknown: ignored
  });

  it('core glow eases from the faint cold dormant colour to alive; tier power drives one tier material (emergency floor at 0)', () => {
    const cold = glow.color.clone();
    expect(cold.g).toBeLessThan(0.1);
    v.setCoreGlow(1);
    for (let i = 0; i < 300; i++) v.tick(0.05);
    expect(glow.color.g).toBeGreaterThan(0.85);
    expect(v.state().glow).toBe(1);
    const t2 = built.tierLamps.get(2)!.mat, t1 = built.tierLamps.get(1)!.mat;
    const base = new THREE.Color(LAMP.color);
    expect(t2.color.r).toBeCloseTo(base.r * LAMP.emergency, 5);
    v.setTierPower(2, 1);
    expect(t2.color.r).toBeCloseTo(base.r, 5);
    expect(t1.color.r).toBeCloseTo(base.r * LAMP.emergency, 5);
    v.setTierPower(77, 1); // unknown tier: ignored
  });
});

describe('GLB swap registry, texture slots, level ownership', () => {
  it('every REACTOR_KIT model is in the lazy file map (urls referenced from runtime code); the pieces map to kit keys', () => {
    for (const m of Object.values(REACTOR_KIT)) expect(REACTOR_MODEL_FILES[m.key]).toEqual({url: m.url, bytes: m.bytes});
    for (const p of REACTOR_PIECES) {
      const s = REACTOR_MODELS[p];
      expect(s.delivered).toBe(true);
      expect((REACTOR_KIT as Record<string, {key: string}>)[p].key).toBe(s.key);
      expect(fs.statSync(path.join(GAME, 'public', s.url)).size).toBe(s.bytes);
      expect(s.cap).toBeGreaterThan(0);
    }
    expect(reactorModelKeysFor({reactor: {}})).toEqual(REACTOR_PIECES.map(p => REACTOR_MODELS[p].key));
    expect(reactorModelKeysFor({})).toEqual([]);
  });

  it('textures: the three Codex sets (colour / normal / ORM) are the slots; nine preload files', () => {
    const loads = reactorTextureLoads();
    expect(loads.length).toBe(9);
    expect(REACTOR_TEXTURES.pitConcrete.color).toBe(KIT_TEXTURES['pit-concrete'].color);
    for (const l of loads) expect(fs.existsSync(path.join(GAME, 'public', l.url)), l.url).toBe(true);
    expect(loads.filter(l => l.srgb).every(l => l.map === 'color')).toBe(true);
  });

  it('Reactor-only: levelAssets owns reactor-*.glb + textures/reactor/** for the reactor; the CI packager families agree', async () => {
    const urls = [...Object.values(REACTOR_KIT).map(m => m.url), ...reactorTextureLoads().map(l => l.url)];
    for (const u of urls) { expect(levelOfAsset(u), u).toBe('reactor'); expect(assetAllowedIn('subway', u)).toBe(false); expect(assetAllowedIn('reactor', u)).toBe(true); }
    expect(levelOfAsset('assets/models/mall-fountain.glb')).toBe('mall');
    expect(levelOfAsset('assets/audio/reactor-hum-loop.mp3')).toBeNull();
    type Fam = Record<string, {files: number}>;
    const {sizeReport} = await import(pathToFileURL(path.resolve(GAME, '../tools/release/package-ci.mjs')).href) as
      {sizeReport: (e: {path: string; bytes: number; sha256: string}[]) => {levelFamilies: {models: Fam; textures: Fam}}};
    for (const p of [...urls, 'assets/models/mall-fountain.glb', 'assets/textures/office/office-carpet.jpg']) {
      const r = sizeReport([{path: p, bytes: 7, sha256: ''}]);
      const fam = p.startsWith('assets/models/') ? r.levelFamilies.models : r.levelFamilies.textures;
      expect(fam.reactor.files === 1, p).toBe(levelOfAsset(p) === 'reactor');
    }
  });
});

describe('atmosphere: the Reactor haze / fog only on a Reactor layout', () => {
  it('atmosphereFor: Reactor overrides on layout.reactor; every other layout exactly as before', () => {
    const r = atmosphereFor({archetype: 'deep', reactor: {}} as never);
    expect(r.density).toBe(REACTOR_ATMOSPHERE.density);
    expect(r.heightFalloff).toBe(REACTOR_ATMOSPHERE.heightFalloff);
    expect(r.areaDensity.platform).toBe(ATMOSPHERE.areaDensity.platform);
    for (const a of ['deep', 'express', 'side-mezzanine'] as const) {
      const plain = atmosphereFor({archetype: a} as never);
      expect(plain.density).not.toBe(REACTOR_ATMOSPHERE.density);
      expect(plain.heightFalloff).toBe(ATMOSPHERE.heightFalloff);
      expect(JSON.stringify(plain.areaDensity)).toBe(JSON.stringify(ATMOSPHERE.areaDensity));
    }
    expect(atmosphereFor(null)).toEqual(atmosphereFor(null, ATMOSPHERE));
  });

  it('fog runtime: a Reactor build applies the deep olive haze / far plane / culler distance; teardown + other levels restore MOOD', () => {
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
    const host = {scene, camera, sectionHooks: [] as {build?(l: never): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[], world: {culler: {maxDistance: 50}}};
    const rt = new ReactorArchRuntime(host as never);
    expect(host.sectionHooks.length).toBe(1);
    expect(host.frameHooks.length).toBe(1);
    host.sectionHooks[0].build!({reactor: archFixtureInfo()} as never);
    const fog = scene.fog as THREE.FogExp2;
    expect(fog.density).toBe(REACTOR_FOG.density);
    expect(fog.color.getHex()).toBe(REACTOR_FOG.color);
    expect(camera.far).toBe(REACTOR_FOG.far);
    expect(host.world.culler.maxDistance).toBeGreaterThan(150);
    expect(reactorFogTransmittance(40)).toBeGreaterThan(0.7);
    expect(reactorFogTransmittance(120)).toBeLessThan(0.1);
    host.sectionHooks[0].teardown!();
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(camera.far).toBe(120);
    host.sectionHooks[0].build!({} as never);
    expect(fog.density).toBe(MOOD.fogDensity);
    expect(rt.active).toBe(false);
    host.frameHooks[0](0.016); // no Reactor world: inert
  });
});
