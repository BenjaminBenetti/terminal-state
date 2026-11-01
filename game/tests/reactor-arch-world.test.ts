// Task reactor-build-20261101 (lane ARCH): the builder path — a multi-level world carrying layout.reactor gets the Reactor's finishes
// (pit concrete / grating / deck undersides inside the pit; the rim station outside it keeps its Subway finishes), the industrial
// kit, ARCH-drawn railings, the pit as the level culler's atrium, the registered ReactorVisuals; the SAME world without
// layout.reactor (and a generated Subway station / the Office) never reaches any Reactor path. (lane GEN's real generator lands in
// parallel: the lead adds real-layout checks.)
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {levelFixture, type FixtureLayout} from './helpers/levelFixture';
import {archFixtureInfo} from './reactor-arch-fixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {generateStation} from '../src/gen/station';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';
import {reactorVisuals} from '../src/world/reactor/visuals';
import {activeReactorArchVisuals} from '../src/world/reactor/archVisuals';
import {releaseReactorMaterials, reactorDress, reactorSurfaceMaterial, reactorSurfaceScale, REACTOR_SURFACE_KEYS} from '../src/world/reactor/archMaterials';
import {reactorTexture, reactorTextureLoads, setReactorTexture} from '../src/world/reactor/archAssets';

installCanvasShim(false);

const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** A small Reactor over the hand-made three-level station: the pit spans platform A / the bed / platform B west of the deck. */
function reactorOn(layout: FixtureLayout): FixtureLayout & {reactor: ReactorInfo} {
  const base = archFixtureInfo();
  const info: ReactorInfo = {
    ...base,
    pit: {outline: [{x: 8, z: 2}, {x: 19, z: 2}, {x: 19, z: 22}, {x: 8, z: 22}], bounds: {x0: 8, z0: 2, x1: 19, z1: 22}, cx: 13.5, cz: 12, rimY: 0, floorY: -5, roofY: 8.4, variant: 'world-fixture'},
    tiers: [
      {level: 0, index: 0, role: 'rim', label: 'Rim', baseY: 0, zone: -1, color: 0xc8a030},
      {level: 2, index: 1, role: 'core', label: 'Core floor', baseY: -5, zone: 0, color: 0xb83a3a},
    ],
    zones: [], generators: [{...base.generators[0], level: 0, x: 12, z: 5, y: 0, yaw: 0, size: {w: 3, d: 1.4, h: 2}, use: {x: 12, z: 7, yaw: 0, level: 0}, panel: {x: 12, y: 1.2, z: 5.9}, cable: [{x: 12, y: 2.2, z: 5}, {x: 9, y: 2.2, z: 5}]}],
    fans: [{id: 0, zone: 0, level: 0, x: 8.05, y: 4, z: 16, nx: 1, nz: 0, radius: 0.9}],
    sites: [], screens: [],
    decks: [{kind: 'gallery', level: 1, rect: {x0: 20, z0: 2, x1: 26, z1: 22}, y: 4.75}],
    towers: [{x: 15, z: 12, hx: 0.5, hz: 0.5, y0: -1.15, y1: 8}],
    crane: {axis: 'x', railY: 7.6, a0: 9, a1: 18, b0: 3, b1: 21, bridgeAt: 14, trolleyAt: 12, hookY: 2},
    pipeBanks: [{x0: 8, z0: 3, x1: 8, z1: 9, nx: 1, nz: 0, y0: 0, y1: 8, depth: 1}],
    core: {x: 15, z: 18, radius: 1.5, y0: -1.15, y1: 3},
    markers: [{level: 0, y0: 2.4, y1: 3, color: 0xc8a030, text: 'RIM  0 M'}],
  };
  return {...layout, reactor: info};
}

const names = (w: BuiltWorld) => { const out: string[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o.name); }); return out; };
const materialNames = (w: BuiltWorld) => { const s = new Set<string>(); w.group.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m)) s.add(m.name); }); return s; };

describe('builder: a world carrying layout.reactor', () => {
  it('pit finishes, the kit, ARCH railings, the pit atrium for the culler, the visuals registered; the rim station keeps its finishes', () => {
    const L = reactorOn(levelFixture());
    const w = buildWorld(L, mats(), {});
    const arch = w.reactorArch!;
    expect(arch).toBeDefined();
    expect(arch.stats.pitCells).toBeGreaterThan(500);
    // finishes: pit walls / grating / deck undersides by key, mesh names, materials
    expect(arch.stats.faces['reactor-wall']).toBeGreaterThan(0);
    const n = names(w);
    expect(n.some(x => x.startsWith('reactor-arch-wall'))).toBe(true);
    expect(n.some(x => x.startsWith('reactor-arch-grating'))).toBe(true);
    // the rim station outside the pit keeps the Subway finishes (platform slab / tiles)
    expect(n.some(x => /^arch-(platformSlab|tileUpper|tileLower|terrazzo|concrete)@/.test(x))).toBe(true);
    // the kit
    expect(arch.stats.kit!.decksSupported).toBe(1);
    expect(arch.stats.kit!.towers).toBe(1);
    expect(arch.stats.kit!.fans).toBe(1);
    expect(arch.stats.kit!.generators).toBe(1);
    expect(arch.stats.kit!.railRuns).toBeGreaterThan(0); // the pit's collision rails, drawn rusted by ARCH
    expect(n.filter(x => x.startsWith('reactor-')).length).toBe(arch.stats.meshes!.meshes + n.filter(x => x.startsWith('reactor-arch-')).length);
    expect(n).toContain('reactor-fan-rotors');
    // culling: the pit is the atrium (tiers stay visible through it)
    expect(w.culler.atriumTileCount).toBeGreaterThan(0);
    // the visuals seam: AIR / RESTART reach ARCH's implementation
    expect(activeReactorArchVisuals()).toBe(arch.visuals);
    expect(reactorVisuals()).toBe(arch.visuals);
    reactorVisuals().setFanSpeed(0, 1);
    expect(arch.visuals.state().fans[0].target).toBe(1);
    // materials: reactor surfaces + dress resolved (fallback sets here: no Codex textures in Node)
    const ms = materialNames(w);
    expect(ms.has('reactor-wall')).toBe(true);
    expect(ms.has('reactor-steel')).toBe(true);
  });

  it('GEN light fixtures inside the pit render as caged lamps (no tube fixture, the tube instance is the lens); outside: tubes', () => {
    const base = reactorOn(levelFixture());
    const light = (x: number, z: number) => ({x, y: 3.2, z, rot: 0, area: 0, broken: false, flicker: false, warm: true, power: 1, dying: false, level: 0});
    const L = {...base, lights: [light(12, 6), light(14, 18), light(28, 6)]};
    const w = buildWorld(L, mats(), {});
    expect(w.reactorArch!.isLamp(L.lights[0])).toBe(true);
    expect(w.reactorArch!.isLamp(L.lights[2])).toBe(false);
    expect(w.reactorArch!.stats.lamps).toBe(2);
    const n = names(w);
    expect(n.some(x => x.startsWith('reactor-lamp-cage-'))).toBe(true);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    w.tubes!.getMatrixAt(0, m); m.decompose(p, q, s);
    expect(s.x).toBeLessThan(0.5); // shrunk into the cage's lens
    w.tubes!.getMatrixAt(2, m); m.decompose(p, q, s);
    expect(s.x).toBeCloseTo(1, 5); // a tube fixture outside the pit
  });

  it('the same world WITHOUT layout.reactor never reaches a Reactor path (no kit, no finishes, no atrium, no visuals)', () => {
    const before = buildWorld(reactorOn(levelFixture()), mats(), {});
    expect(activeReactorArchVisuals()).toBe(before.reactorArch!.visuals);
    const plain = buildWorld(levelFixture(), mats(), {});
    expect(plain.reactorArch).toBeUndefined();
    expect(names(plain).some(x => x.includes('reactor'))).toBe(false);
    expect([...materialNames(plain)].some(x => x.includes('reactor'))).toBe(false);
    expect(plain.culler.atriumTileCount).toBe(0);
    expect(activeReactorArchVisuals()).toBeNull(); // a new non-Reactor world unregisters the previous one
    // deterministic + identical to a second plain build
    const again = buildWorld(levelFixture(), mats(), {});
    expect(names(again)).toEqual(names(plain));
    expect(again.stats).toEqual(plain.stats);
  });

  it('a generated Subway station builds exactly as without the Reactor seam (no reactor meshes / materials / atrium)', () => {
    const L = generateStation(20261101);
    const w = buildWorld(L, mats(), {});
    expect(w.reactorArch).toBeUndefined();
    expect(names(w).some(x => x.includes('reactor'))).toBe(false);
    expect(w.culler.atriumTileCount).toBe(0);
  });

  it('materials: every reactor surface key resolves (fallback = existing approved sets, decayed); the dress set is shared', () => {
    const m = mats();
    for (const k of REACTOR_SURFACE_KEYS) expect(reactorSurfaceMaterial(m, k).name).toBe(k);
    expect(reactorDress(m)).toBe(reactorDress(m));
    expect(reactorSurfaceMaterial(m, 'reactor-wall').userData.decay).toBeDefined();
  });

  it('with the Codex sets resolved: world-mapped PBR over colour / normal / ORM (Meshy / Codex maps untouched); leaving releases the clones', () => {
    const m = mats();
    const tex = (n: string) => { const t = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement); t.name = n; t.anisotropy = 8; return t; };
    for (const l of reactorTextureLoads()) setReactorTexture(l.slot, l.map, tex(`${l.slot}:${l.map}`));
    const wall = reactorSurfaceMaterial(m, 'reactor-wall') as THREE.MeshStandardMaterial;
    expect(wall.map!.name).toBe('pitConcrete:color');
    expect(wall.normalMap!.name).toBe('pitConcrete:normal');
    expect(wall.roughnessMap!.name).toBe('pitConcrete:orm');
    expect(wall.metalnessMap).toBe(wall.roughnessMap);
    expect(reactorSurfaceScale(m, 'reactor-wall')).toEqual({u: 1, v: 1}); // world-mapped: the builder's UVs are not used
    expect((reactorSurfaceMaterial(m, 'reactor-grating') as THREE.MeshStandardMaterial).map!.name).toBe('grating:color');
    const steel = reactorDress(m).steel as THREE.MeshStandardMaterial;
    expect(steel.map!.name).toBe('rustedSteel:color');
    expect(steel.map!.anisotropy).toBe(1); // thin-trim clone
    expect(releaseReactorMaterials()).toBeGreaterThan(0);
    expect(reactorTexture('pitConcrete', 'color')).toBeUndefined();
    // back to the fallback sets on the next build (the cache follows the store version)
    expect((reactorSurfaceMaterial(m, 'reactor-wall') as THREE.MeshStandardMaterial).map?.name ?? '').not.toBe('pitConcrete:color');
  });
});
