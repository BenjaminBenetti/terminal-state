// Task studio-subway-platform-pillars-20261116-214939-01 (user: the platform pillars "just not look 'real' they are sorta shiny metal
// rectangles"): the STATION columns (gen/stationDress.ts on every level's station storey) are riveted built-up steel H-columns in the
// column paint (world/stationColumns.ts, WorldMaterials 'columnPaint'): one shared geometry per height, instanced per level / 48 m
// cohort, translation-only instances inside the unchanged 0.5 m footprint, the placements themselves untouched. A level's own colonnade
// (the Bunker vault hall) keeps the brushed-steel clad box ('pillar', task studio-graphics-gpu-materials-toggle-20261114-212239-01).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {COLUMN_PAINT, PILLAR_METALNESS, PILLAR_NORMAL, PILLAR_ROUGHNESS, WM_HOOK, WM_ROUGH_HOOK, WorldMaterials, columnPaintGradeCpu, isWorldMapped} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {F0_LABELS} from '../src/gen/bunker/v2/floor0Spec';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {reflectClass} from '../src/world/reflectionNode';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {STATION_COLUMN, isLevelOwnColumn, rivetHeights, stationColumnGeometry} from '../src/world/stationColumns';
import {surface} from '../src/world/canvasTextures';
import {CHUNK_M} from '../src/world/levelGeometry';
import {RenderIndex} from '../src/damage/propDamage';
import {DamageSystem} from '../src/damage/system';
import {rtMaterialRecord} from '../src/render/rt/rtMaterials';

installCanvasShim(false);
{
  // the no-op shim lacks clip() (the item label atlas the damage system's holders may build)
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
};

interface Built { layout: StationLayout; mats: WorldMaterials; world: ReturnType<typeof buildWorld>; meshes: THREE.InstancedMesh[]; cols: PropPlacement[] }
function build(layout: StationLayout): Built {
  const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const world = buildWorld(layout, mats, {});
  const meshes: THREE.InstancedMesh[] = [];
  world.group.traverse(o => { if (o.name === 'prop-column') meshes.push(o as THREE.InstancedMesh); });
  return {layout, mats, world, meshes, cols: layout.props.filter(p => p.kind === 'column')};
}

const cache = new Map<string, Built>();
const subway = () => cache.get('subway') ?? (cache.set('subway', build(generateStation(93))), cache.get('subway')!);
const office = () => cache.get('office') ?? (cache.set('office', build(generateOfficeLevel({levelSeed: 93, startWeapon: 'pistol'}))), cache.get('office')!);
const bunker = () => cache.get('bunker') ?? (cache.set('bunker', build(generateBunkerLevel({levelSeed: 93}))), cache.get('bunker')!);

/** Each instance of the station column meshes: its column, matrix and geometry. */
function instancesOf(b: Built): {p: PropPlacement; m: THREE.Matrix4; mesh: THREE.InstancedMesh}[] {
  const out: {p: PropPlacement; m: THREE.Matrix4; mesh: THREE.InstancedMesh}[] = [];
  const v = new THREE.Vector3();
  for (const mesh of b.meshes) {
    if (mesh.material !== b.mats.get('columnPaint')) continue;
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      const p = b.cols.find(q => Math.abs(q.x - v.x) < 1e-6 && Math.abs(q.y - v.y) < 1e-6 && Math.abs(q.z - v.z) < 1e-6);
      if (p) out.push({p, m, mesh});
    }
  }
  return out;
}

describe('station columns: riveted built-up steel H-columns', () => {
  it('a Subway station and the Office\'s station storey draw every column once, in the column paint, at its placement and height', () => {
    for (const [name, b] of [['subway', subway()], ['office', office()]] as const) {
      expect(b.cols.length, `${name}: the station has columns`).toBeGreaterThan(3);
      expect(b.meshes.length, name).toBeGreaterThan(0);
      for (const m of b.meshes) {
        expect(m.isInstancedMesh, name).toBe(true);
        expect(m.material, name).toBe(b.mats.get('columnPaint'));
      }
      expect(b.meshes.reduce((n, m) => n + m.count, 0), `${name}: one instance per column prop`).toBe(b.cols.length);
      const inst = instancesOf(b);
      expect(new Set(inst.map(i => i.p)).size, `${name}: every column, once`).toBe(b.cols.length);
      const s = new THREE.Vector3(), q = new THREE.Quaternion(), t = new THREE.Vector3();
      for (const {p, m, mesh} of inst) {
        // translation only (nothing stretched: rivets and plates keep their size), the geometry made for this column's height
        m.decompose(t, q, s);
        expect(s.toArray().map(x => +x.toFixed(6)), name).toEqual([1, 1, 1]);
        const bb = mesh.geometry.boundingBox!;
        expect(bb.max.y, `${name}: a ${p.h} m column`).toBeCloseTo(p.h, 3);
        expect(bb.min.y, name).toBeCloseTo(0, 6);
        // inside the placement's footprint (collision, cover and clearances are the box's: unchanged)
        expect(Math.max(-bb.min.x, bb.max.x), name).toBeLessThanOrEqual(p.hx + 1e-6);
        expect(Math.max(-bb.min.z, bb.max.z), name).toBeLessThanOrEqual(p.hz + 1e-6);
      }
    }
  });

  it('batched: one geometry per height shared by its cohorts, one mesh per level / 48 m cohort / height, none spans two', () => {
    const b = subway();
    const heights = new Set(b.cols.map(p => Math.round(p.h * 1000)));
    const geos = new Set(b.meshes.map(m => m.geometry));
    expect(geos.size).toBe(heights.size);
    for (const m of b.meshes) {
      const keys = new Set<string>(), hs = new Set<number>();
      for (const {p, mesh} of instancesOf(b)) if (mesh === m) { keys.add(`${p.level ?? 0}:${Math.floor(p.x / CHUNK_M)},${Math.floor(p.z / CHUNK_M)}`); hs.add(Math.round(p.h * 1000)); }
      expect(keys.size).toBe(1);
      expect(hs.size).toBe(1);
      expect(m.boundingSphere).toBeTruthy();
      expect(m.boundingBox).toBeTruthy();
    }
    // a few draws (not one per column): fewer meshes than columns, and only the height groups' few geometries to upload / trace
    expect(b.meshes.length).toBeLessThan(b.cols.length / 2);
  });

  it('the construction: H section, rivet rows, base, splice and head, outward faces, a bounded triangle count, deterministic', () => {
    const C = STATION_COLUMN;
    expect(C.bf).toBeLessThanOrEqual(0.5);
    expect(C.d).toBeLessThanOrEqual(0.5);
    expect(C.base.plate).toBe(0.5);
    for (const h of [3.2, 5, 6.15, 9.7]) {
      const g = stationColumnGeometry(h);
      expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      expect(g.index).toBeTruthy();
      const tris = g.index!.count / 3;
      expect(tris, `${h} m`).toBeLessThan(1200 + 520 * h);
      // every triangle's winding agrees with its normals (front faces outward)
      const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index!;
      const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), vn = new THREE.Vector3(), w = new THREE.Vector3();
      let bad = 0;
      for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(pos, idx.getX(i)); b2.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
        n.subVectors(b2, a).cross(w.subVectors(c, a));
        if (n.lengthSq() < 1e-14) continue;
        vn.fromBufferAttribute(nor, idx.getX(i)).add(w.fromBufferAttribute(nor, idx.getX(i + 1))).add(w.fromBufferAttribute(nor, idx.getX(i + 2)));
        if (n.normalize().dot(vn.normalize()) < 0.2) bad++;
      }
      expect(bad, `${h} m`).toBe(0);
      // the H: open channels on ±x (nothing between the flange tips at mid-height off the web line), flanges closing ±z
      const mid = h * 0.55;
      let inChannel = 0, flangeFace = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (Math.abs(y - mid) > 0.6) continue;
        if (Math.abs(x) > 0.06 && Math.abs(x) < C.bf / 2 - 0.01 && Math.abs(z) < 0.08) inChannel++;
        if (Math.abs(Math.abs(z) - C.d / 2) < 1e-6) flangeFace++;
      }
      expect(inChannel, `${h} m: open channels`).toBe(0);
      expect(flangeFace, `${h} m: flange faces`).toBeGreaterThan(0);
      // deterministic
      const g2 = stationColumnGeometry(h);
      expect(Array.from(g2.attributes.position.array)).toEqual(Array.from(pos.array));
    }
    // rivet rows: the 0.3 m pitch from the base to under the head, none across the eye-height splice
    const ys = rivetHeights(5);
    expect(ys[0]).toBeCloseTo(C.rivet.from, 6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(5 - C.rivet.headClear + 1e-6);
    expect(ys.some(y => y > C.splice.y - 0.05 && y < C.splice.y + C.splice.h + 0.05)).toBe(false);
    expect(ys.length).toBeGreaterThan(9);
  });

  it('the column paint: the existing charcoal painted-steel set graded to a lit slate-teal enamel, world-mapped, a metal candidate', () => {
    const b = subway();
    const m = b.mats.get('columnPaint') as THREE.MeshStandardMaterial;
    const set = surface('paintedSteel');
    // the set's own maps (thin-trim clones of the same images: no new texture), world-mapped, the grade before the mapping's grime
    for (const k of ['map', 'roughnessMap', 'normalMap'] as const) expect(m[k]!.image, k).toBe(set[k]!.image);
    expect(isWorldMapped(m)).toBe(true);
    expect(nodeHookKeys(m as never)).toEqual(['column-paint-grade', WM_HOOK, WM_ROUGH_HOOK]);
    expect(m.metalness).toBe(COLUMN_PAINT.metalness);
    expect(m.transparent).toBe(false);
    expect(reflectClass(m)).toBe('metal');
    // the grade (CPU mirror): the paint lifted from the charcoal ~0.035 into a readable enamel; chips stay under 0.5, streaks darker
    const lin = (hex: string) => [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const grade = (hex: string) => lin(hex).map((c, i) => columnPaintGradeCpu(c, i as 0 | 1 | 2));
    const paint = grade('#30363a'), chip = grade('#7a7871'), streak = grade('#1d2124'), rust = grade('#6b4a2e');
    for (const c of paint) { expect(c).toBeGreaterThan(0.1); expect(c).toBeLessThan(0.2); }
    expect(paint[1]).toBeGreaterThan(paint[0]); // a desaturated teal: green / blue over red
    for (const c of [...chip, ...rust]) expect(c).toBeLessThan(0.5);
    for (let i = 0; i < 3; i++) { expect(streak[i]).toBeLessThan(paint[i]); expect(chip[i]).toBeGreaterThan(paint[i]); }
    // the traced flashlight bounce takes the graded paint, not colour x the charcoal map
    expect(m.userData.lightAlbedo).toEqual(COLUMN_PAINT.base.map((c, i) => columnPaintGradeCpu(c, i as 0 | 1 | 2)));
    const rec = rtMaterialRecord(m);
    expect(rec[1]).toBeCloseTo(paint[1] * ((1 - m.metalness) + m.metalness * m.roughness), 3);
    // the brushed-steel cladding and the trim paint are unchanged
    const pillar = b.mats.get('pillar') as THREE.MeshStandardMaterial, steel = b.mats.get('steel') as THREE.MeshStandardMaterial;
    expect([pillar.metalness, pillar.roughness]).toEqual([PILLAR_METALNESS, PILLAR_ROUGHNESS]);
    expect(pillar.normalScale.toArray()).toEqual([PILLAR_NORMAL, PILLAR_NORMAL]);
    expect(reflectClass(pillar)).toBe('metal');
    expect([steel.metalness, steel.roughness]).toEqual([0.3, 1]);
    const src = readFileSync(new URL('../src/world/materials.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/this\.mats\.set\('pillar', surfaceMaterial\('brushedSteel', \{metalness: PILLAR_METALNESS, roughness: PILLAR_ROUGHNESS\}/);
    expect(src).toMatch(/surfaceMaterial\('paintedSteel', \{metalness: cp\.metalness\}/);
  });

  it('the column paint builds clean WGSL and GLSL (an instanced column, the station\'s lights)', () => {
    const b = subway();
    const mesh = b.meshes[0];
    for (const sh of buildBoth(mesh, {lights: [new THREE.SpotLight(0xffffff, 1), new THREE.HemisphereLight()]})) {
      expect(sh.errors, sh.backend).toEqual([]);
      expect(sh.fragment.length, sh.backend).toBeGreaterThan(1000);
      expect(sh.fragment, sh.backend).toMatch(/pow/);
    }
  });

  it('the Bunker vault hall\'s colonnade keeps its clad box; the Bunker platform\'s columns are station columns', () => {
    const b = bunker();
    const own = b.cols.filter(p => isLevelOwnColumn(b.layout, p));
    expect(own.length).toBeGreaterThan(0);
    for (const p of own) expect(b.layout.areas[p.area].label).toBe(F0_LABELS.vaultHall);
    const clad = b.meshes.filter(m => m.material === b.mats.get('pillar'));
    expect(clad.length).toBe(1);
    expect(clad[0].count).toBe(own.length);
    expect(clad[0].geometry.type).toBe('BoxGeometry');
    const v = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < own.length; i++) {
      const m = new THREE.Matrix4();
      clad[0].getMatrixAt(i, m);
      m.decompose(v, q, s);
      expect([v.x, v.y, v.z]).toEqual([own[i].x, own[i].y, own[i].z]);
      expect(s.y).toBeCloseTo(own[i].h, 6);
    }
    const station = b.meshes.filter(m => m.material === b.mats.get('columnPaint'));
    expect(station.reduce((n, m) => n + m.count, 0)).toBe(b.cols.length - own.length);
    // only the Bunker's vault hall: no other level's column is its own
    expect(subway().cols.some(p => isLevelOwnColumn(subway().layout, p))).toBe(false);
    expect(office().cols.some(p => isLevelOwnColumn(office().layout, p))).toBe(false);
  });

  it('damage finds every column\'s instance, and a shot into a channel marks the drawn web (not the air at the box face)', () => {
    const b = subway();
    const index = new RenderIndex();
    index.build([b.world.group], b.layout.props, new Set());
    for (const p of b.cols) expect(index.inst.get(p)?.length, `column at ${p.x}, ${p.z}`).toBe(1);
    const sys = new DamageSystem(null, null);
    sys.build(b.layout, b.mats, [b.world.group], {ownMeshes: () => [], onBreak: () => {}});
    const i = b.layout.props.findIndex(p => p.kind === 'column' && p.variant !== 1 && p.h > 4);
    const p = b.layout.props[i], y = p.y + 2.6;
    // from +x into the channel at z = 0 (the box face is at x + 0.25): the web is at x + tw / 2
    const r = sys.hitWorld({t: 1, kind: 'prop', nx: 1, ny: 0, nz: 0, prop: i}, new THREE.Vector3(p.x + p.hx, y, p.z), new THREE.Vector3(-1, 0, 0), {damage: 24, pellet: false, weapon: 'rifle'});
    expect(r.object).toBe('prop');
    expect(r.point.x - p.x).toBeLessThan(0.05);
    expect(r.point.x - p.x).toBeGreaterThan(0);
    // from +z onto a flange face (z + d / 2)
    const r2 = sys.hitWorld({t: 1, kind: 'prop', nx: 0, ny: 0, nz: 1, prop: i}, new THREE.Vector3(p.x + 0.1, y + 0.4, p.z + p.hz), new THREE.Vector3(0, 0, -1), {damage: 24, pellet: false, weapon: 'rifle'});
    expect(r2.point.z - p.z).toBeCloseTo(STATION_COLUMN.d / 2, 2);
  });
});
