// Task static-batching-warmup-20261105: world/staticCohorts.ts — repeated static geometry grouped into fewer draws, per level, without
// losing an instance, a holder slot, a damage index entry or a culling level. Procedural worlds (no models: fast) for the builders that
// batch it (holders, purpose fixtures), a fitted two-part model for the builder's instanced props.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {describe, expect, it} from 'vitest';
import {STATIC_COHORTS, planCohorts, trianglesOf} from '../src/world/staticCohorts';
import {addInstancedModel, buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {Inventory} from '../src/items/inventory';
import {DamageSystem} from '../src/damage/system';
import {generateStation} from '../src/gen/station';
import {LEVELS} from '../src/levels/registry';
import {lootProfile} from '../src/items/lootTables';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {ShimContext, installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

const ims = (root: THREE.Object3D, re: RegExp) => { const out: THREE.InstancedMesh[] = []; root.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && re.test(m.name)) out.push(m); }); return out; };

describe('planCohorts (the shared rule)', () => {
  const pts = (n: number, level: number, step: number) => Array.from({length: n}, (_, i) => ({x: i * step, z: 3, level}));
  it('per level always; a cheap model takes 48 m cohorts only where `coarse`; heavy ones keep the builder chunk; deterministic order', () => {
    const items = [...pts(10, 0, 10), ...pts(4, 1, 10)];
    const fine = planCohorts(items, p => p, 18, 100, false);
    expect([...fine.keys()]).toEqual(['0:0,0', '0:1,0', '0:2,0', '0:3,0', '0:4,0', '0:5,0', '1:0,0', '1:1,0']); // (x 0..90 / 0..30 by 18 m)
    const coarse = planCohorts(items, p => p, 18, 100, true); // 10 x 100 tris <= 20k: cheap
    expect([...coarse.keys()]).toEqual(['0:c0,0', '0:c1,0', '1:c0,0']);
    expect([...coarse.values()].map(c => c.list.length)).toEqual([5, 5, 4]);
    const heavy = planCohorts(items, p => p, 18, STATIC_COHORTS.levelTriangles, true); // 10 x 20k on level 0: heavy; 4 x 20k on level 1: heavy
    expect([...heavy.keys()]).toEqual([...fine.keys()]);
    for (const c of coarse.values()) expect(new Set(c.list.map(i => i.level)).size).toBe(1); // never spans levels
    expect([...planCohorts(items, p => p, 18, 100, true).keys()]).toEqual([...coarse.keys()]);
  });
});

describe('builder instanced props (addInstancedModel)', () => {
  it('every instance of every part once, at placement x part matrix; one level per batch; fewer batches where coarse', () => {
    const scene = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()), b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshStandardMaterial());
    b.position.y = 1;
    scene.add(a, b);
    const gltf = {scene} as unknown as GLTF;
    const placements = Array.from({length: 24}, (_, i) => new THREE.Matrix4().makeTranslation(i * 5, i % 2 ? 6 : 0, 2));
    const levelAt = (_x: number, y: number) => (y > 3 ? 1 : 0);
    const run = (coarse: boolean) => {
      const g = new THREE.Group();
      const n = addInstancedModel(g, gltf, placements, {w: 1, h: 1.2, d: 1, anchor: 'bottom'}, 'cohortProbe', levelAt, coarse);
      return {g, n, list: ims(g, /^prop-cohortProbe$/)};
    };
    const fine = run(false), coarse = run(true);
    expect(fine.n).toBe(48);
    expect(coarse.n).toBe(48);
    for (const r of [fine, coarse]) {
      // per part: 24 instances in total, every placement exactly once (by translation)
      for (const mat of [a.material, b.material]) {
        const parts = r.list.filter(m => m.material === mat);
        expect(parts.reduce((s, m) => s + m.count, 0)).toBe(24);
        const xs = new Set<number>();
        const tmp = new THREE.Matrix4(), pos = new THREE.Vector3();
        for (const m of parts) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, tmp); xs.add(Math.round(pos.setFromMatrixPosition(tmp).x * 100)); }
        expect(xs.size).toBe(24);
      }
      // one level per batch, matching userData.level
      for (const m of r.list) {
        const tmp = new THREE.Matrix4(), pos = new THREE.Vector3();
        for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, tmp); pos.setFromMatrixPosition(tmp); expect(levelAt(pos.x, pos.y)).toBe(m.userData.level); }
      }
    }
    expect(coarse.list.length).toBeLessThan(fine.list.length);
    expect(trianglesOf(a.geometry)).toBe(12);
  });
});

describe('holders and purpose fixtures on real procedural worlds', () => {
  const build = (layout: Parameters<typeof buildWorld>[0]) => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const world = buildWorld(layout, mats, {});
    const cm = new ContainerManager({}, mats, () => new Inventory());
    cm.build(layout, {}, lootProfile('subway'));
    return {world, cm, mats};
  };
  for (const [name, make] of [
    ['Subway station', () => generateStation(9001)],
    ['Office tower (stacked storeys)', () => LEVELS.office.generate(LEVELS.office.entry, {levelSeed: 4242} as never)],
  ] as const) {
    it(`${name}: every holder batch is one level (userData.level = its holders' level); slots intact; the culler keeps the level`, () => {
      const layout = make();
      const {world, cm} = build(layout);
      const holders = (cm as unknown as {all: {prop: {level?: number; x: number; z: number}; open?: {slots: {mesh: THREE.InstancedMesh; index: number}[]; matrix: THREE.Matrix4; model: {closed: unknown[]}}}[]}).all;
      const levelOf = new Map<THREE.InstancedMesh, Set<number>>();
      let slots = 0, hiddenSlots = 0;
      for (const h of holders) {
        if (!h.open) continue;
        expect(h.open.slots.length).toBe(h.open.model.closed.length); // one slot per closed part
        for (const sl of h.open.slots) {
          slots++;
          const m = new THREE.Matrix4();
          sl.mesh.getMatrixAt(sl.index, m);
          // the slot draws this holder — or is hidden (zero matrix: a holder taken over at build, e.g. ajar parts, by design)
          const hidden = m.elements.slice(0, 15).every(v => v === 0);
          const same = m.elements.every((v, j) => Math.abs(v - h.open!.matrix.elements[j]) < 1e-4); // (instance matrices are float32)
          expect(hidden || same, `slot of ${(h as unknown as {kind: string}).kind}`).toBe(true);
          if (hidden) hiddenSlots++;
          let set = levelOf.get(sl.mesh);
          if (!set) levelOf.set(sl.mesh, (set = new Set()));
          set.add(h.prop.level ?? 0);
        }
      }
      for (const [im, set] of levelOf) { expect(set.size, im.name).toBe(1); expect(im.userData.level).toBe([...set][0]); }
      for (const im of ims(cm.group, /^container-body-/)) expect(typeof im.userData.level, im.name).toBe('number');
      // purpose fixtures: per level ('purpose-<level>:<cohort>|<key>'), the level recorded for the culler
      const purpose: THREE.Mesh[] = [];
      world.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('purpose-') && !o.name.startsWith('purpose-menu-')) purpose.push(o as THREE.Mesh); });
      for (const m of purpose) { expect(m.name, m.name).toMatch(/^purpose-\d+:(c?-?\d+,-?\d+|\*)\|/); expect(m.userData.level).toBe(Number(m.name.slice(8, m.name.indexOf(':')))); }
      // the culler registers each batch on its level (never NaN = fog-only, never a multi-level span)
      world.culler.register(cm.group);
      const entries = (world.culler as unknown as {entries: {obj: THREE.Object3D; level: number; levels?: number[]}[]}).entries;
      for (const e of entries) {
        if (!/^(container-body|openable-closed|purpose)-/.test(e.obj.name) || e.obj.name.startsWith('purpose-menu-')) continue;
        expect(e.levels, e.obj.name).toBeUndefined();
        expect(e.level, e.obj.name).toBe(e.obj.userData.level);
      }
      expect(slots).toBeGreaterThan(0);
      expect(hiddenSlots).toBeLessThan(slots);
    });
  }

  it('the damage index still finds every purpose fixture and holder prop (by triangles / instances)', () => {
    const layout = generateStation(9001);
    const {world, cm, mats} = build(layout);
    const sys = new DamageSystem(null, null);
    sys.build(layout, mats, [world.group, cm.group], {ownMeshes: p => cm.ownMeshes(p)});
    const merged = sys.props.index.merged.filter(m => m.mesh.name.startsWith('purpose-'));
    expect(merged.length).toBeGreaterThan(0);
    for (const m of merged) expect(m.key).toBe(m.mesh.name.slice(m.mesh.name.indexOf('|') + 1)); // the part class key after '|'
  });
});
