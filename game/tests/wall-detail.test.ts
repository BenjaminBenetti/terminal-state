// Iteration 08 (Lane W): wall identity + deterioration (world/wallDetail*.ts). Node tests (no WebGL):
// zone -> treatment mapping over every family and the hand-made multi-level fixture, openings /
// storefronts / signs stay clear, every feature stays inside its face and in open space of its own
// level, breaches only where the wall is solid behind, determinism, per-station budgets, watertight
// base-wall cuts (exact hole + inset prism on the same outline), atlas packing, shared materials,
// layering below the damage craters.
// WALL_PREVIEW=1 additionally CPU-renders treated walls into qa-artifacts/iter08-walls/.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture} from './helpers/levelFixture';
import {ARCHETYPES, generateStation, type Archetype, type StationLayout} from '../src/gen/station';
import {Levels} from '../src/gen/levels';
import {doorClearVolumes} from '../src/gen/doorways';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {stationLevels} from '../src/world/levelGeometry';
import type {WallZone} from '../src/world/wallFaces';
import {normalizeFaces, stationWallFaces, faceFrame} from '../src/world/wallDetailFaces';
import {
  FEATURE_LAYER, RECIPES, WALL_DETAIL_CAPS, ZONE_TREATMENT, extWallDetailCaps, finishFamily, perFaceCutCap, planWallDetail, solidBehind, subwayCourse, treatmentOf,
  type Feature, type PlannedFace, type WallDetailPlan,
} from '../src/world/wallDetailPlan';
import {ATLAS_CELLS, ATLAS_SIZE, atlasCells, type AtlasCell} from '../src/world/wallDetailAtlas';
import {LAYER_OFFSET, MAX_SPAN, cutBaseWalls, ccw, type CutSpec} from '../src/world/wallDetailGeometry';
import {codeToSeed} from '../src/core/rng';
import {buildWallDetail, wallDetailMaterials} from '../src/world/wallDetail';
import {CRATER_HOOK} from '../src/damage/craters';
import {CraterField} from '../src/damage/craters';

installCanvasShim(false);

const ZONES: WallZone[] = ['platform', 'trackbed', 'concourse', 'shop', 'service', 'stair', 'upper', 'lower'];
const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: Archetype): StationLayout => {
  const k = `${seed}:${archetype ?? ''}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
const PER_ARCH = () => ARCHETYPES.map((a, i) => gen(7001 + i * 31, a));
const plans = new Map<StationLayout, WallDetailPlan>();
const planOf = (l: StationLayout) => { let p = plans.get(l); if (!p) plans.set(l, (p = planWallDetail(l))); return p; };
// Track 2: extension walls (track tunnels / service annexes, Area.ext) are planned after the core's on their own budget
// (extWallDetailCaps: WALL_DETAIL_EXT_CAPS per annex); the per-station caps below are the core's.
const extFeature = (l: StationLayout, p: WallDetailPlan, f: Feature) => !!(l.areas[p.faces[f.face].face.area] as {ext?: string} | undefined)?.ext;

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

const overlaps = (a: {s0: number; s1: number; y0: number; y1: number}, b: {s0: number; s1: number; y0: number; y1: number}) => a.s0 < b.s1 - 1e-6 && a.s1 > b.s0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6;

describe('wall treatment: zones -> treatments', () => {
  it('every zone has a treatment and every treatment a recipe; finish families resolve', () => {
    for (const z of ZONES) expect(RECIPES[ZONE_TREATMENT[z]], z).toBeDefined();
    expect(treatmentOf({zone: 'trackbed', finish: 'platformFace'})).toBe('trackFace');
    expect(treatmentOf({zone: 'trackbed', finish: 'tunnel'})).toBe('trackTunnel');
    expect(finishFamily('tileLower')).toBe('tile');
    expect(finishFamily('tileUpper')).toBe('tile');
    expect(finishFamily('tileShop')).toBe('shopTile');
    expect(finishFamily('paint')).toBe('paint');
    expect(finishFamily('tunnel')).toBe('concrete');
    expect(finishFamily('platformFace')).toBe('concrete');
    // Distinct identities: the recipes are not one shared random decal.
    const sigs = new Set(Object.values(RECIPES).map(r => JSON.stringify([r.bay, r.band, r.frieze, r.formwork, r.recess > 0, r.wear, r.cables, r.conduit > 0])));
    expect(sigs.size).toBeGreaterThanOrEqual(7);
  });

  it('tiled walls split at the tile line are merged back into one face per wall', () => {
    const base = {level: 0, area: 3, areaType: 'concourse', zone: 'concourse' as WallZone, x0: 0, z0: 5, x1: 6, z1: 5, nx: 0, nz: 1, seed: 1};
    const faces = normalizeFaces([
      {...base, y0: 0, y1: 1.8, finish: 'tileLower', openings: [{s0: 2, s1: 3.5, top: 1.8}], vb0: 0, vb1: 0} as never,
      {...base, y0: 1.8, y1: 4, finish: 'tileUpper', openings: [{s0: 2, s1: 3.5, top: 2.3}], vb0: 1.8, vb1: 1.8} as never,
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({y0: 0, y1: 4, finish: 'tileLower', base: 0});
    expect(faces[0].openings).toEqual([{s0: 2, s1: 3.5, top: 2.3}]);
  });

  it('generated stations of every family map each face zone to its treatment, with identity features where expected', () => {
    const seen = new Set<string>();
    for (const l of PER_ARCH()) {
      const p = planOf(l);
      expect(p.faces.length).toBeGreaterThan(50);
      for (const pf of p.faces) {
        expect(pf.treatment).toBe(treatmentOf(pf.face));
        seen.add(pf.face.zone);
      }
      // Platform walls carry the station accent band; tunnels carry cable runs; service walls conduits.
      const kindsBy = (t: string) => new Set(p.features.filter(f => p.faces[f.face].treatment === t).map(f => f.kind));
      if (p.faces.some(f => f.treatment === 'platformTile' && f.face.y1 - f.face.y0 > 3)) expect(kindsBy('platformTile').has('band')).toBe(true);
      if (p.faces.some(f => f.treatment === 'trackTunnel' && f.len > 10)) expect(kindsBy('trackTunnel').has('cables')).toBe(true);
      if (p.faces.filter(f => f.treatment === 'servicePaint').length > 20) expect(kindsBy('servicePaint').has('conduit')).toBe(true);
    }
    for (const z of ['platform', 'trackbed', 'concourse', 'service', 'shop', 'stair']) expect(seen.has(z), z).toBe(true);
  });

  it('variation within a zone is seeded, not uniform: faces differ in condition and some walls stay clean', () => {
    const p = planOf(gen(424242));
    const svc = p.faces.filter(f => f.treatment === 'servicePaint' && f.len > 3);
    const conds = new Set(svc.map(f => f.condition.toFixed(2)));
    expect(conds.size).toBeGreaterThan(5);
    const dmg = svc.map((pf) => p.features.filter(f => p.faces[f.face] === pf && f.layer === 'cut').length / pf.len);
    expect(dmg.some(d => d === 0)).toBe(true);
    expect(dmg.some(d => d > 0)).toBe(true);
  });
});

describe('wall treatment: placement invariants', () => {
  const sample = () => [...PER_ARCH(), gen(12345), gen(99)];

  it('every feature lies inside its face; cuts inside one finish band, clear of openings and face ends', () => {
    for (const l of sample()) {
      const p = planOf(l);
      for (const f of p.features) {
        const pf = p.faces[f.face], face = pf.face;
        expect(f.s0, f.kind).toBeGreaterThanOrEqual(-1e-6);
        expect(f.s1, f.kind).toBeLessThanOrEqual(pf.len + 1e-6);
        expect(f.y0, f.kind).toBeGreaterThanOrEqual(face.y0 - 1e-6);
        expect(f.y1, f.kind).toBeLessThanOrEqual(face.y1 + 1e-6);
        expect(f.s1).toBeGreaterThan(f.s0);
        expect(f.y1).toBeGreaterThan(f.y0);
        expect(FEATURE_LAYER[f.kind]).toBe(f.layer);
        if (f.layer !== 'cut') continue;
        expect(f.s0).toBeGreaterThanOrEqual(0.3 - 1e-6);
        expect(f.s1).toBeLessThanOrEqual(pf.len - 0.3 + 1e-6);
        const edges = [face.y0, ...pf.splits, face.y1];
        expect(edges.some((e, i) => i + 1 < edges.length && f.y0 >= e + 0.03 - 1e-6 && f.y1 <= edges[i + 1] - 0.03 + 1e-6), `${f.kind} straddles a finish band`).toBe(true);
        expect(pf.sloped).toBe(false);
        // Outline inside its bounds.
        for (const [s, y] of f.outline!) { expect(s).toBeGreaterThanOrEqual(f.s0 - 1e-9); expect(s).toBeLessThanOrEqual(f.s1 + 1e-9); expect(y).toBeGreaterThanOrEqual(f.y0 - 1e-9); expect(y).toBeLessThanOrEqual(f.y1 + 1e-9); }
      }
    }
  });

  it('openings stay clean: no cosmetic damage or finish over a doorway / storefront span (cuts keep 0.35 m, breaches 1 m)', () => {
    for (const l of sample()) {
      const p = planOf(l);
      for (const f of p.features) {
        const pf = p.faces[f.face];
        for (const o of pf.face.openings) {
          const m = f.kind === 'breach' ? 1.0 : f.layer === 'cut' ? 0.35 : f.layer === 'proud' ? 0.18 : f.layer === 'flush' ? 0 : 0.1;
          const r = {s0: o.s0 - m, s1: o.s1 + m, y0: pf.face.y0 - 1, y1: o.top + (f.layer === 'flush' ? 0 : m)};
          expect(overlaps(f, r), `${f.kind} over an opening`).toBe(false);
        }
        for (const k of pf.keepouts) {
          if (k.why === 'storefront' || k.why === 'ladder') expect(overlaps(f, k), `${f.kind} over a ${k.why}`).toBe(false);
        }
      }
    }
  });

  it('cut features never overlap each other or flush finishes; decals never float over a cut', () => {
    for (const l of sample()) {
      const p = planOf(l);
      const byFace = new Map<number, Feature[]>();
      for (const f of p.features) { let a = byFace.get(f.face); if (!a) byFace.set(f.face, (a = [])); a.push(f); }
      for (const list of byFace.values()) {
        const cuts = list.filter(f => f.layer === 'cut');
        for (const c of cuts) for (const o of list) {
          if (o === c) continue;
          if (o.layer === 'proud' && o.kind !== 'conduit') continue;
          if (o.layer === 'cut' || o.layer === 'flush' || o.layer === 'decal' || o.layer === 'soft' || o.layer === 'proud') expect(overlaps(c, o), `${o.kind} over ${c.kind}`).toBe(false);
        }
      }
    }
  });

  it('breaches: only where the wall volume behind is solid on every level, small, raised off the floor and not on stairs', () => {
    let total = 0;
    for (const l of [...sample(), levelFixture()]) {
      const p = planOf(l);
      const levels = new Levels(stationLevels(l));
      const br = p.features.filter(f => f.kind === 'breach');
      expect(br.filter(f => !extFeature(l, p, f)).length).toBeLessThanOrEqual(WALL_DETAIL_CAPS.breach);
      expect(br.filter(f => extFeature(l, p, f)).length).toBeLessThanOrEqual(extWallDetailCaps(l).breach);
      total += br.length;
      for (const b of br) {
        const pf = p.faces[b.face];
        expect(solidBehind(levels, pf, b, (b.depth ?? 0) + 0.1)).toBe(true);
        expect(b.s1 - b.s0).toBeLessThanOrEqual(0.95);
        expect(b.y1 - b.y0).toBeLessThanOrEqual(0.85);
        expect(b.y0 - pf.face.y0).toBeGreaterThanOrEqual(0.35 - 1e-6);
        expect(b.depth!).toBeLessThanOrEqual(0.28);
        expect(pf.face.zone).not.toBe('stair');
        // Faces may end at a doorway: breaches keep 1 m from both ends as well as from openings.
        expect(b.s0).toBeGreaterThanOrEqual(1.0 - 1e-6);
        expect(b.s1).toBeLessThanOrEqual(pf.len - 1.0 + 1e-6);
      }
    }
    expect(total).toBeGreaterThan(5); // occasional, but present across the sample
  });

  it('structural recesses are raised, shallow equipment niches on solid wall, away from openings', () => {
    let n = 0;
    for (const l of [...sample(), levelFixture()]) {
      const p = planOf(l);
      const levels = new Levels(stationLevels(l));
      for (const r of p.features.filter(f => f.kind === 'recess')) {
        const pf = p.faces[r.face];
        n++;
        expect(r.y0 - pf.face.y0).toBeGreaterThanOrEqual(0.8);
        expect(r.y1 - r.y0).toBeLessThanOrEqual(1.1);
        expect(r.s1 - r.s0).toBeLessThanOrEqual(0.85);
        expect(r.depth!).toBeLessThanOrEqual(0.15);
        expect(solidBehind(levels, pf, r, r.depth! + 0.1)).toBe(true);
        for (const o of pf.face.openings) expect(r.s1 <= o.s0 - 0.6 + 1e-6 || r.s0 >= o.s1 + 0.6 - 1e-6).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  for (const which of ['fixture', 'generated'] as const) it(`multi-level (${which}): detail on every level stays in its own level band and in open space`, () => {
    for (const l of which === 'fixture' ? [levelFixture() as StationLayout] : [gen(7001, 'interchange'), gen(7063, 'deep')]) {
    const p = planOf(l);
    const levels = new Levels(stationLevels(l));
    const lv = new Set(p.faces.map(f => f.face.level));
    expect(lv.size).toBeGreaterThanOrEqual(which === 'fixture' ? 3 : 1);
    if (which === 'fixture') {
      expect(p.faces.some(f => f.treatment === 'upperFinish')).toBe(true);
      expect(p.faces.some(f => f.treatment === 'lowerConcrete')).toBe(true);
    }
    for (const f of p.features) {
      const pf = p.faces[f.face], face = pf.face;
      const {tx, tz} = faceFrame(face);
      const s = (f.s0 + f.s1) / 2, y = Math.min(face.y1 - 0.05, Math.max(face.y0 + 0.05, (f.y0 + f.y1) / 2));
      const x = face.x0 + tx * s + face.nx * 0.1, z = face.z0 + tz * s + face.nz * 0.1;
      expect(levels.isFree(x, y, z), `${f.kind} on level ${face.level} not facing open space`).toBe(true);
      // The open band in front of it belongs to the face's own level (never another storey).
      const bands = levels.bands(x, z).filter(b => y >= b.floor - 1e-3 && y <= b.ceil + 1e-3);
      expect(bands.some(b => b.level === face.level), `${f.kind} level ${face.level}`).toBe(true);
    }
    }
  });
});

describe('wall treatment: determinism and budgets', () => {
  it('is deterministic per station and differs between stations', () => {
    const a = planWallDetail(gen(31337)), b = planWallDetail(gen(31337));
    expect(a.features).toEqual(b.features);
    expect(a.accent).toBe(b.accent);
    const c = planWallDetail(gen(31338));
    expect(JSON.stringify(c.features.slice(0, 40))).not.toBe(JSON.stringify(a.features.slice(0, 40)));
  });

  it('stays within per-station budgets', () => {
    for (const l of PER_ARCH()) {
      const p = planOf(l);
      const per = {flush: 0, decal: 0, soft: 0, cut: 0, proud: 0}, ext = {...per};
      for (const f of p.features) (extFeature(l, p, f) ? ext : per)[f.layer]++;
      for (const k of Object.keys(per) as (keyof typeof per)[]) {
        expect(per[k], k).toBeLessThanOrEqual(WALL_DETAIL_CAPS[k]);
        expect(ext[k], `ext ${k}`).toBeLessThanOrEqual(extWallDetailCaps(l)[k]);
      }
      const cutsPerFace = new Map<number, number>();
      for (const f of p.features) if (f.layer === 'cut' && f.kind !== 'breach') cutsPerFace.set(f.face, (cutsPerFace.get(f.face) ?? 0) + 1);
      for (const [i, n] of cutsPerFace) expect(n).toBeLessThanOrEqual(perFaceCutCap(p.faces[i].len));
    }
  });

  it('builds into a bounded number of draw calls, triangles and texture memory; cuts apply to the real builder walls', () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    for (const l of [gen(2024, 'side-mezzanine'), gen(77, 'island-ends'), levelFixture() as StationLayout]) {
      const w = buildWorld(l, mats, {});
      const r = buildWallDetail(w.group, l, mats, w.wallFaces);
      expect(r.stats.drawCalls).toBeLessThanOrEqual(8);
      expect(r.stats.triangles).toBeLessThan(90_000);
      expect(r.stats.textureBytes).toBeLessThan(16 * 1024 * 1024);
      expect(r.stats.cuts.applied).toBeGreaterThanOrEqual(Math.floor(r.stats.cuts.planned * 0.9));
      expect(w.group.getObjectByName('wall-detail')).toBe(r.group);
      expect(w.group.children.filter(c => c.name === 'wall-detail')).toHaveLength(1); // the builder hook runs once
      for (const n of ['wall-detail-flush', 'wall-detail-decal', 'wall-detail-frieze']) {
        const m = r.group.getObjectByName(n);
        if (m) { expect(m.renderOrder, n).toBe(1); expect(m.castShadow, n).toBe(false); expect(m.receiveShadow, n).toBe(true); }
      }
      // No wall-detail triangle (inset, decal, fitting, rubble) intrudes a doorway's walk-through volume.
      const vols = doorClearVolumes(l);
      const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), tri = new THREE.Triangle();
      const boxes = vols.map(v => new THREE.Box3(new THREE.Vector3(v.x0, v.y0, v.z0), new THREE.Vector3(v.x1, v.y1, v.z1)));
      for (const c of r.group.children) {
        const g = (c as THREE.Mesh).geometry, P = g.attributes.position, I = g.index!;
        for (let t = 0; t < I.count; t += 3) {
          A.fromBufferAttribute(P, I.getX(t)); Bv.fromBufferAttribute(P, I.getX(t + 1)); C.fromBufferAttribute(P, I.getX(t + 2));
          tri.set(A, Bv, C);
          for (let k = 0; k < boxes.length; k++) if (boxes[k].intersectsTriangle(tri)) throw new Error(`${c.name} intrudes door ${vols[k].door}`);
        }
      }
      // Every detail mesh uses one of the shared materials.
      const dm = wallDetailMaterials(mats);
      const allowed = new Set<THREE.Material>([dm.flush, dm.decal, dm.soft, dm.cavity, mats.get('steel'), mats.get('rail')]);
      for (const c of r.group.children) {
        const m = (c as THREE.Mesh).material as THREE.Material;
        if (c.name === 'wall-detail-frieze' || c.name === 'wall-detail-cable') continue;
        expect(allowed.has(m), c.name).toBe(true);
      }
    }
    // Shared materials across stations.
    expect(wallDetailMaterials(mats)).toBe(wallDetailMaterials(mats));
  });
});

describe('wall treatment: geometry', () => {
  /** One builder-style wall quad (Accum layout) on z = 2 facing +Z, x 0..6, y 0..3, uv = world / 2. */
  function wallMesh(nz = 1): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    const z = 2;
    const P = nz > 0 ? [[0, 0, z], [6, 0, z], [6, 3, z], [0, 3, z]] : [[6, 0, z], [0, 0, z], [0, 3, z], [6, 3, z]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, nz, 0, 0, nz, 0, 0, nz, 0, 0, nz], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(P.flatMap(p => [p[0] / 2 * nz, p[1] / 2]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  }
  const area = (g: THREE.BufferGeometry) => {
    let a = 0; const P = g.attributes.position, I = g.index!;
    for (let i = 0; i < I.count; i += 3) {
      const p = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(P, I.getX(i + k)));
      a += new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0])).length() / 2;
    }
    return a;
  };
  const polyArea = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x1, y1] = p[(i + 1) % p.length]; return s + x * y1 - x1 * y; }, 0)) / 2;

  for (const nz of [1, -1]) it(`cuts an exact hole (both facings: nz=${nz}), keeps facing and interpolates UVs`, () => {
    const mesh = wallMesh(nz);
    const hole: [number, number][] = [];
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; hole.push([3 + Math.cos(a) * 0.4 * (1 + 0.2 * Math.sin(3 * a)), 1.2 + Math.sin(a) * 0.3]); }
    const step: [number, number][] = [[0.6, 0.3], [1.32, 0.3], [1.32, 0.45], [1.5, 0.45], [1.5, 0.6], [0.78, 0.6], [0.78, 0.45], [0.6, 0.45]];
    const specs: CutSpec[] = [{axis: 'z', plane: 2, nSign: nz, poly: ccw(hole)}, {axis: 'z', plane: 2, nSign: nz, poly: ccw(step)}, {axis: 'z', plane: 2, nSign: nz, poly: [[5.99, 1], [6.5, 1], [6.5, 1.5], [5.99, 1.5]]}];
    const res = cutBaseWalls([mesh], specs);
    expect(res.applied).toBe(2);
    expect(specs[2].applied).toBe(false); // crosses the quad edge: rejected, wall untouched there
    expect(area(mesh.geometry)).toBeCloseTo(18 - polyArea(hole) - polyArea(step), 4);
    // Facing preserved: every triangle's normal points along +nz.
    const g = mesh.geometry, P = g.attributes.position, I = g.index!, UV = g.attributes.uv;
    for (let i = 0; i < I.count; i += 3) {
      const p = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(P, I.getX(i + k)));
      const n = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]));
      expect(Math.sign(n.z)).toBe(nz);
    }
    // UVs stay the affine world mapping (u = x/2 * nz, v = y/2).
    for (let i = 0; i < P.count; i++) {
      expect(UV.getX(i)).toBeCloseTo(P.getX(i) / 2 * nz, 5);
      expect(UV.getY(i)).toBeCloseTo(P.getY(i) / 2, 5);
    }
    // Hole boundary vertices are exactly the outline (shared bit-for-bit with the inset prism).
    const f32 = (v: number) => Math.fround(v);
    for (const [c, y] of specs[0].poly) {
      let found = false;
      for (let i = 0; i < P.count && !found; i++) found = P.getX(i) === f32(c) && P.getY(i) === f32(y) && P.getZ(i) === 2;
      expect(found).toBe(true);
    }
  });

  it('tile grid helper follows the base texture courses (0.15 m to the tile line, cropped period above)', () => {
    expect(subwayCourse(0.05)).toMatchObject({y0: 0, offset: true, idx: 0});
    expect(subwayCourse(0.2)).toMatchObject({offset: false, idx: 1});
    expect(subwayCourse(1.85).y0).toBeCloseTo(1.8, 6);
    expect(subwayCourse(1.85).offset).toBe(true);
    expect(subwayCourse(1.8 + 0.2).offset).toBe(false);
  });

  it('atlas cells pack without overlap inside their atlases', () => {
    const cells = atlasCells();
    for (const atlas of ['detail', 'soft'] as const) {
      const list = (Object.keys(ATLAS_CELLS) as AtlasCell[]).filter(n => ATLAS_CELLS[n].atlas === atlas).map(n => cells[n]);
      const [W, H] = ATLAS_SIZE[atlas];
      for (const r of list) {
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(W); expect(r.y + r.h).toBeLessThanOrEqual(H);
        expect(r.u0).toBeGreaterThanOrEqual(0); expect(r.u1).toBeLessThanOrEqual(1); expect(r.v0).toBeGreaterThanOrEqual(0); expect(r.v1).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
      }
    }
  });

  it('layers sit below the damage craters (stand-off and polygon offset), so craters still show on treated walls', () => {
    const craters = new CraterField(4);
    const cm = craters.mesh.material as THREE.MeshStandardMaterial;
    expect(craters.mesh.material).toBeDefined();
    void CRATER_HOOK;
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const dm = wallDetailMaterials(mats);
    for (const off of Object.values(LAYER_OFFSET)) expect(off).toBeLessThan(0.004);
    for (const m of [dm.flush, dm.decal, dm.soft]) {
      expect(m.polygonOffset).toBe(true);
      expect(Math.abs(m.polygonOffsetUnits)).toBeLessThan(Math.abs(cm.polygonOffsetUnits));
      expect(Math.abs(m.polygonOffsetFactor)).toBeLessThan(Math.abs(cm.polygonOffsetFactor));
    }
    expect(dm.soft.transparent && !dm.soft.depthWrite).toBe(true);
    // Wall-hugging cut-out layers never write depth (no z-fight, no self-shadowing) and draw after the walls.
    expect(dm.flush.depthWrite || dm.decal.depthWrite).toBe(false);
    expect(craters.mesh.renderOrder).toBeGreaterThan(0); // drawn after the soft stains (renderOrder 0)
    expect(dm.flush.alphaTest).toBeGreaterThan(0);
    expect(dm.cavity.polygonOffset).toBe(false);
  });
});

describe('wall treatment: built triangles stay bounded (browser-QA regression, seed 1A2B3C)', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const built = new Map<StationLayout, {w: ReturnType<typeof buildWorld>; r: ReturnType<typeof buildWallDetail>}>();
  const build = (l: StationLayout) => { let b = built.get(l); if (!b) { const w = buildWorld(l, mats, {}); b = {w, r: buildWallDetail(w.group, l, mats, w.wallFaces)}; built.set(l, b); } return b; };
  const QA = () => [gen(codeToSeed('1A2B3C')!), gen(7001, 'interchange'), levelFixture() as StationLayout];

  it('no NaN, no long slivers; flat layers lie on a face at their stand-off, everything else hugs a face', () => {
    for (const l of QA()) {
      const {r} = build(l);
      const faces = r.plan.faces;
      // Face boxes bucketed on a 2 m grid.
      const buckets = new Map<string, number[]>();
      const key = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
      faces.forEach((pf, i) => {
        const f = pf.face;
        for (let x = Math.floor((Math.min(f.x0, f.x1) - 0.5) / 2); x <= Math.floor((Math.max(f.x0, f.x1) + 0.5) / 2); x++)
          for (let z = Math.floor((Math.min(f.z0, f.z1) - 0.5) / 2); z <= Math.floor((Math.max(f.z0, f.z1) + 0.5) / 2); z++) {
            const k = `${x},${z}`; let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(i);
          }
      });
      const hug = (p: THREE.Vector3, off: number | null): boolean => (buckets.get(key(p.x, p.z)) ?? []).some(i => {
        const f = faces[i].face;
        const plane = f.nx !== 0 ? f.x0 : f.z0, d = (f.nx !== 0 ? p.x - plane : p.z - plane) * (f.nx + f.nz);
        const a = f.nx !== 0 ? p.z : p.x, a0 = Math.min(f.nx !== 0 ? f.z0 : f.x0, f.nx !== 0 ? f.z1 : f.x1), a1 = Math.max(f.nx !== 0 ? f.z0 : f.x0, f.nx !== 0 ? f.z1 : f.x1);
        if (off !== null) return Math.abs(d - off) < 1e-4 && a >= a0 - 1e-4 && a <= a1 + 1e-4 && p.y >= f.y0 - 1e-4 && p.y <= f.y1 + 1e-4;
        return d >= -0.32 && d <= 0.36 && a >= a0 - 0.2 && a <= a1 + 0.2 && p.y >= f.y0 - 0.05 && p.y <= f.y1 + 0.05;
      });
      const OFF: Record<string, number> = {'wall-detail-flush': LAYER_OFFSET.flush, 'wall-detail-frieze': LAYER_OFFSET.flush, 'wall-detail-decal': LAYER_OFFSET.decal, 'wall-detail-soft': LAYER_OFFSET.soft};
      const v = new THREE.Vector3(), q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (const c of r.group.children) {
        const g = (c as THREE.Mesh).geometry, P = g.attributes.position, I = g.index!;
        for (const a of Object.values(g.attributes)) for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i] as number), c.name).toBe(true);
        for (let t = 0; t < I.count; t += 3) {
          for (let k = 0; k < 3; k++) q[k].fromBufferAttribute(P, I.getX(t + k));
          const e = Math.max(q[0].distanceTo(q[1]), q[1].distanceTo(q[2]), q[2].distanceTo(q[0]));
          if (e > MAX_SPAN + 1e-3) throw new Error(`${c.name}: ${e.toFixed(2)} m triangle edge`);
        }
        const off = OFF[c.name] ?? null;
        // Decal rims sit on the wall around cuts (stand-off of the decal layer) like every other decal.
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i);
          if (!hug(v, off)) throw new Error(`${c.name} vertex ${i} (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}) is not on / at a wall face`);
        }
      }
    }
  });

  it('screen coverage of the wall detail from close stair / wall poses stays far below 6x the screen', () => {
    const W = 1280, H = 720;
    const coverage = (meshes: THREE.Mesh[], eye: THREE.Vector3, yaw: number, pitch: number): number => {
      const cam = new THREE.PerspectiveCamera(75, W / H, 0.05, 70);
      cam.position.copy(eye); cam.rotation.order = 'YXZ'; cam.rotation.set(pitch, yaw, 0); cam.updateMatrixWorld(true);
      const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const planes: ((q: THREE.Vector4) => number)[] = [q => q.w - 0.05, q => q.w + q.x, q => q.w - q.x, q => q.w + q.y, q => q.w - q.y];
      let area = 0;
      const p = new THREE.Vector3();
      for (const m of meshes) {
        const P = m.geometry.attributes.position, I = m.geometry.index!;
        for (let t = 0; t < I.count; t += 3) {
          let poly: THREE.Vector4[] = [0, 1, 2].map(k => { p.fromBufferAttribute(P, I.getX(t + k)); return new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(vp); });
          for (const f of planes) {
            const out: THREE.Vector4[] = [];
            for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], da = f(a), db = f(b); if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) out.push(a.clone().lerp(b, da / (da - db))); }
            poly = out;
            if (poly.length < 3) break;
          }
          if (poly.length < 3) continue;
          let a2 = 0;
          for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; a2 += (a.x / a.w) * (b.y / b.w) - (b.x / b.w) * (a.y / a.w); }
          area += Math.abs(a2) / 2 * (W / 2) * (H / 2);
        }
      }
      return area / (W * H);
    };
    let worst = 0, poses = 0;
    for (const l of QA()) {
      const {w, r} = build(l);
      const meshes = r.group.children as THREE.Mesh[];
      const levels = new Levels(stationLevels(l));
      const tests: [THREE.Vector3, number, number][] = [];
      if (l === QA()[0]) tests.push([new THREE.Vector3(72.47, 1.6, 24), -Math.PI / 2, 0.15]); // the reported browser pose
      for (const k of (l as {levelLinks?: {bottom: {x: number; y: number; z: number}; top: {x: number; y: number; z: number}}[]}).levelLinks ?? []) {
        for (const [s, o, pitch] of [[k.bottom, k.top, 0.15], [k.top, k.bottom, -0.25]] as const) {
          const fl = levels.supportAt(s.x, s.z, s.y + 0.05)?.floor ?? s.y;
          tests.push([new THREE.Vector3(s.x, fl + 1.6, s.z), Math.atan2(-(o.x - s.x), -(o.z - s.z)), pitch]);
        }
      }
      // Nose to the most damaged walls (0.6 m away, looking at them).
      const score = new Map<number, number>();
      for (const f of r.plan.features) score.set(f.face, (score.get(f.face) ?? 0) + 1);
      for (const [i] of [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        const f = r.plan.faces[i].face, {len, tx, tz} = faceFrame(f);
        const e = new THREE.Vector3(f.x0 + tx * len / 2 + f.nx * 0.6, Math.min(f.y1 - 0.1, f.y0 + 1.6), f.z0 + tz * len / 2 + f.nz * 0.6);
        tests.push([e, Math.atan2(f.nx, f.nz), 0]);
      }
      void w;
      for (const [e, yaw, pitch] of tests) { worst = Math.max(worst, coverage(meshes, e, yaw, pitch)); poses++; }
    }
    expect(poses).toBeGreaterThan(20);
    expect(worst).toBeLessThan(6);
  });

  it('uses two shader programs at most (cut-out family + soft) besides the existing steel / rail / black materials', () => {
    const {r} = build(QA()[0]);
    const sig = (m: THREE.MeshStandardMaterial) => JSON.stringify([!!m.map, !!m.normalMap, !!m.roughnessMap, !!m.vertexColors, m.alphaTest > 0, m.transparent]);
    const own = r.group.children.map(c => (c as THREE.Mesh).material as THREE.MeshStandardMaterial).filter(m => /wall-detail/.test(m.name));
    expect(new Set(own.map(sig)).size).toBeLessThanOrEqual(2);
    for (const m of own) {
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t?.image) expect(Math.max((t.image as {width: number}).width, (t.image as {height: number}).height)).toBeLessThanOrEqual(1024);
      if (m.map) expect(m.map.generateMipmaps || (m.map.image as {width: number}).width === 1).toBe(true);
    }
  });
});

// Unused-import guard for helper types used only in type positions.
export type _T = PlannedFace;
void stationWallFaces;
