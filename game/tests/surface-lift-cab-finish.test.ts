// Task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: the Surface Run cargo car's PBR FINISH (world/surface/liftCabFinish.ts;
// user: "lift visuals are poor, bad material quality re-texture to make it look good. PBR."). No browser: the finish's files, materials and
// the finished car's geometry (world/elevator.ts CargoFinish).
//  1. FILES: every generated set / placard file is a checked-in public input of its recorded size; the sets' spans are the physical ones the
//     cook measured (tread lugs 0.36 m, hazard stripes 0.2 m apart across, panels ~1.08 m); the placard rects lie on the sheet.
//  2. MATERIALS: none before every map arrived (the car keeps its earlier lit finish); then PBR materials (colour sRGB, tangent normal +
//     ORM linear and repeating; roughness / metalness / AO all read the ORM map), ONE shared lamp emissive graph (values per material),
//     no light object, cached.
//  3. THE CAR: the finished view maps every surface at its set's real span (UVs per metre = 1 / span), the kick plates in tread, bumper
//     boards and placards inside the cab facing in; the Bunker's car (no finish) has none of it and keeps its own materials.
import fs from 'node:fs';
import path from 'node:path';
import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildElevatorView, cargoMaterials, planElevator, type CargoFinish} from '../src/world/elevator';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {LIFT_CAR} from '../src/gen/surface/accessLift';
import {liftElevatorInfo} from '../src/world/surface/liftInfo';
import {LIFT_CAB_PLACARDS, LIFT_CAB_TEXTURES} from '../src/assets/liftCabTextures.generated';
import {LIFT_CAB_LAMP, LiftCabMaterial, liftCabFinish, liftCabTexturesReady, loadLiftCabTextures} from '../src/world/surface/liftCabFinish';

installCanvasShim(false);
const PUB = path.resolve(__dirname, '../public');
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

const subwayLift = () => {
  for (let s = 1; s < 5000; s++) if (surfacePresent('subway', s, SURFACE_VERSION)) {
    const l = LEVELS.subway.generate('main', {levelSeed: s, surfaceVersion: SURFACE_VERSION}).surfaceAccess?.lift;
    if (l) return l;
  }
  throw new Error('no version-2 Subway lift');
};
const meshes = (root: THREE.Object3D) => { const out = new Map<string, THREE.Mesh[]>(); root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.set(o.name, [...(out.get(o.name) ?? []), o as THREE.Mesh]); }); return out; };
const one = (m: Map<string, THREE.Mesh[]>, name: string) => { const a = m.get(name); expect(a?.length, name).toBe(1); return a![0]; };

/** Max |dUV| / |dPos| over a mesh's triangle edges (UVs per metre; a face-UV box: 1 / span on every face). */
function uvPerMetre(g: THREE.BufferGeometry): {min: number; max: number} {
  const p = g.attributes.position, uv = g.attributes.uv, idx = g.index;
  let min = Infinity, max = 0;
  const n = idx ? idx.count : p.count;
  for (let t = 0; t < n; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx ? idx.getX(t + e) : t + e, b = idx ? idx.getX(t + (e + 1) % 3) : t + (e + 1) % 3;
    const d = Math.hypot(p.getX(a) - p.getX(b), p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b)), du = Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b));
    if (d < 0.05) continue; // (float32 world positions: millimetre edges carry ~0.3 % error)
    // (axis edges only: a diagonal's UV / metre is the same ratio on a uniform face map)
    min = Math.min(min, du / d); max = Math.max(max, du / d);
  }
  return {min, max};
}

describe('Surface lift cab finish: the generated files', () => {
  it('every set and the placard sheet are public inputs of their recorded size, at physical spans; the labels lie on the sheet', () => {
    const allow = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number}[]};
    const listed = new Map(allow.files.map(f => [f.path, f.bytes]));
    const files = [...Object.values(LIFT_CAB_TEXTURES).flatMap(s => [s.color, s.normal, s.orm]), LIFT_CAB_PLACARDS.color];
    expect(files.length).toBe(16);
    for (const f of files) {
      expect(fs.statSync(path.join(PUB, f.url)).size, f.url).toBe(f.bytes);
      expect(listed.get(f.url), `${f.url}: allowlisted`).toBe(f.bytes);
    }
    const T = LIFT_CAB_TEXTURES;
    expect(T.deck.span[0]).toBeCloseTo(0.36, 2); // three 120 mm lug pitches
    expect(T.hazard.span[0]).toBeCloseTo(0.2 * Math.SQRT2, 3); // stripes 100 mm wide, 45 degrees
    for (const k of ['wall', 'bumper'] as const) expect(T[k].span[0]).toBeGreaterThan(0.9);
    expect(T.liner.span[0]).toBeGreaterThan(1.5);
    for (const s of Object.values(T)) {
      expect(s.span[0]).toBeCloseTo(s.span[1], 3);
      expect(s.rough).toBeGreaterThan(0.3);
      expect(s.rough).toBeLessThan(0.95);
    }
    expect(T.deck.metal, 'bare tread steel').toBeGreaterThan(0.5);
    for (const k of ['wall', 'hazard', 'liner', 'bumper'] as const) expect(T[k].metal, k).toBeLessThan(0.05);
    for (const [k, l] of Object.entries(LIFT_CAB_PLACARDS.labels)) {
      const [u0, v0, u1, v1] = l.uv;
      expect(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1, k).toBe(true);
      expect((u1 - u0) / (v1 - v0), `${k}: the rect's aspect (a square sheet)`).toBeCloseTo(l.aspect, 1);
    }
  });
});

describe('Surface lift cab finish: materials and the finished car', () => {
  afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('no finish before the maps arrive; then PBR materials sharing one lamp graph, no light object', async () => {
    expect(liftCabTexturesReady()).toBe(false);
    expect(liftCabFinish(), 'not loaded: the car keeps its earlier lit finish').toBe(null);
    const urls: string[] = [];
    const doc = (globalThis as {document?: object}).document;
    if (doc) Object.defineProperty(doc, 'baseURI', {value: 'http://qa.local/game/', configurable: true});
    else vi.stubGlobal('document', {baseURI: 'http://qa.local/game/'});
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async (url: string) => { urls.push(url); return new THREE.Texture(); });
    await expect(loadLiftCabTextures()).resolves.toBe(true);
    expect(urls.length).toBe(16);
    const F = liftCabFinish()!;
    expect(F).not.toBe(null);
    expect(liftCabFinish(), 'cached').toBe(F);
    const T = LIFT_CAB_TEXTURES, node = (F.mats.wall as LiftCabMaterial).emissiveNode;
    expect(node).toBeTruthy();
    for (const [k, d] of Object.entries(LIFT_CAB_LAMP.mats)) {
      const m = F.mats[k as keyof CargoFinish['mats']] as LiftCabMaterial;
      expect(m, k).toBeInstanceOf(LiftCabMaterial);
      expect(m.name).toBe(`cargo-cab-${k}@pbr`);
      expect(m.emissiveNode, `${k}: the shared lamp graph`).toBe(node);
      expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(m.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(m.roughnessMap, `${k}: roughness from the ORM`).toBe(m.metalnessMap);
      expect(m.aoMap).toBe(m.roughnessMap);
      expect(m.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
      for (const t of [m.map!, m.normalMap!, m.roughnessMap!]) expect([t.wrapS, t.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
      expect([m.roughness, m.metalness], 'the ORM values as they are').toEqual([1, 1]);
      expect(m.color.getHex()).toBe(d.color);
      expect(m.normalScale.toArray()).toEqual([d.normal, d.normal]);
      expect(m.lampA.toArray()).toEqual([d.lamp.glow, d.lamp.wall0, d.lamp.wall1, d.lamp.floor]);
      expect(m.lampB.x).toBe(d.lamp.ceil);
      expect(m.lampB.z, k).toBeCloseTo(d.lamp.inCar ? 1 / LIFT_CAR.cabH : 0, 9);
      expect(m).not.toBeInstanceOf(THREE.Light);
    }
    const p = F.mats.placard as LiftCabMaterial;
    expect(p.emissiveNode).toBe(node);
    expect(p.map!.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(p.normalMap).toBe(null);
    expect(F.spans).toEqual({wall: T.wall.span[0], deck: T.deck.span[0], hazard: T.hazard.span[0], liner: T.liner.span[0], bumper: T.bumper.span[0]});
  });

  it('the finished car: real-span surfaces, tread kick plates, bumper boards and placards facing in; the Bunker car unchanged', () => {
    const F = liftCabFinish()!;
    expect(F, 'loaded by the test above').not.toBe(null);
    const plan = planElevator(liftElevatorInfo(subwayLift()));
    const fin = buildElevatorView(plan, mats, {cargo: true, cargoLit: true, cargoFinish: F});
    const lit = buildElevatorView(plan, mats, {cargo: true, cargoLit: true});
    const bunker = buildElevatorView(plan, mats, {cargo: true});
    const M = meshes(fin.root), L = meshes(lit.root), B = meshes(bunker.root);
    // (no light objects anywhere)
    for (const v of [fin, lit, bunker]) v.root.traverse(o => expect((o as THREE.Light).isLight, o.name).toBeFalsy());
    // the earlier finishes: no trim, their own materials
    for (const m of [L, B]) for (const n of ['tower-cab-kick', 'tower-cab-bumpers', 'tower-cab-placards']) expect(m.has(n), n).toBe(false);
    const CL = cargoMaterials(true), CB = cargoMaterials(false);
    expect(one(L, 'tower-cab-walls').material).toBe(CL.paint);
    expect(one(B, 'tower-cab-walls').material).toBe(CB.paint);
    expect(one(B, 'tower-cab-floor').material).toBe(CB.deck);
    expect(one(B, 'tower-shaft-liner').material).toBe(CB.liner);
    expect([...B.keys()].sort(), 'the Bunker car: the same meshes as the earlier lit car').toEqual([...L.keys()].sort());
    // the finish: each surface its material at its set's span
    const span: [string, THREE.Material, number][] = [
      ['tower-cab-walls', F.mats.wall, F.spans.wall], ['tower-cab-ceiling', F.mats.ceil, F.spans.wall], ['tower-cab-floor', F.mats.deck, F.spans.deck],
      ['tower-cab-kick', F.mats.deck, F.spans.deck], ['tower-cab-floor-border', F.mats.hazard, F.spans.hazard], ['tower-cab-bumpers', F.mats.bumper, F.spans.bumper],
      ['tower-shaft-liner', F.mats.liner, F.spans.liner], ['tower-door-cab-l', F.mats.bars, F.spans.wall],
    ];
    for (const [name, mat, s] of span) {
      const m = one(M, name);
      expect(m.material, name).toBe(mat);
      const r = uvPerMetre(m.geometry);
      expect(r.max, `${name}: UVs per metre`).toBeCloseTo(1 / s, 3);
    }
    for (const m of M.get('tower-door-landing-l')!) expect(m.material).toBe(F.mats.door);
    for (const m of M.get('tower-landing-frame')!) { expect(m.material).toBe(F.mats.hazard); expect(uvPerMetre(m.geometry).max).toBeCloseTo(1 / F.spans.hazard, 3); }
    // the trim inside the car frame (world -> car-local through the plan's gate: l along the gate, w into the cab)
    const G = plan.gate, toLocal = (x: number, z: number) => [(x - G.cx) * G.tx + (z - G.cz) * G.tz, -((x - G.cx) * G.nx + (z - G.cz) * G.nz)] as const;
    const {lMin, lMax, depth: D} = plan.frame;
    const inCab = (g: THREE.BufferGeometry, y0: number, y1: number) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const [l, w] = toLocal(p.getX(i), p.getZ(i));
        expect(l, 'across').toBeGreaterThan(lMin - 1e-6); expect(l).toBeLessThan(lMax + 1e-6);
        expect(w, 'into the cab').toBeGreaterThan(0); expect(w).toBeLessThan(D + 1e-6);
        expect(p.getY(i)).toBeGreaterThanOrEqual(y0 - 1e-6); expect(p.getY(i)).toBeLessThanOrEqual(y1 + 1e-6);
      }
    };
    const bump = one(M, 'tower-cab-bumpers').geometry, plac = one(M, 'tower-cab-placards').geometry;
    inCab(bump, 0.3, 0.96);
    inCab(plac, 1.1, 2.0);
    expect(plac.attributes.position.count, 'four quads').toBe(16);
    // the placards face into the cab (their normals toward the car's centre) and show their sheet rects
    const c = plan.gate, mid = {x: c.cx - c.nx * D / 2, z: c.cz - c.nz * D / 2}, pn = plac.attributes.normal, pp = plac.attributes.position, pu = plac.attributes.uv;
    for (let i = 0; i < pp.count; i++) expect(pn.getX(i) * (mid.x - pp.getX(i)) + pn.getZ(i) * (mid.z - pp.getZ(i)), 'faces in').toBeGreaterThan(0.3);
    const rects = Object.values(F.placards).map(l => l.uv);
    for (let q = 0; q < 4; q++) {
      const us = [0, 1, 2, 3].map(k => [pu.getX(q * 4 + k), pu.getY(q * 4 + k)]);
      expect(rects.some(r => us.every(([u, v]) => Math.abs(u - r[0]) < 1e-6 || Math.abs(u - r[2]) < 1e-6) && us.every(([, v]) => Math.abs(v - r[1]) < 1e-6 || Math.abs(v - r[3]) < 1e-6)), `placard ${q}`).toBe(true);
    }
    for (const v of [fin, lit, bunker]) for (const g of v.geometries) g.dispose();
  });
});
