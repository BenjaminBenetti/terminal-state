// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane KIT): the Surface Run kit's prop kinds (gen/surface/kinds.ts) — the fixed
// names and boxes other lanes place, the prop-rule classification (physics class, openables, damage), the military crate's openable lid
// and its themed finite contents, the procedural geometry inside its boxes, the wreck models (measured, catalogued, admitted under the
// 'surface' family) and the renderer's instancing (RenderIndex-compatible names, the dynamic street-name atlas).

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {dynamicKind} from '../src/physics/merchOnHost';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, openableSpec} from '../src/world/openablesSpec';
import {CONTAINER_THEMED, HOLDER_ALLOW, HOLDER_SLOTS, MILITARY_SUPPLY_ROWS, OPENABLE_TABLES, econCat} from '../src/items/lootTables';
import {genericAmmo} from '../src/items/calibers';
import {holderTable, isContainerKind, isLootHolderKind, rollTableItems} from '../src/items/loot';
import {ITEMS} from '../src/items/items';
import {SKYWAYS_PROP_MODELS} from '../src/assets/skywaysProps.generated';
import {OFFICE_ASSETS, OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {
  SR_CRATE, SR_MAP_TABLE, SURFACE_KINDS, SURFACE_KIT_MODEL_FILES, SURFACE_PROP_DEFS, SURFACE_SCALE, SURFACE_SPECS, SURFACE_WRECK_KINDS, SURFACE_WRECK_MODEL,
  isSurfaceDrawnKind, srStreetSignStreets, srStreetSignVariant, surfaceKitModelKeysFor, type SurfaceDrawnKind,
} from '../src/gen/surface/kinds';
import {surfaceKitMesh, type KitMesh} from '../src/gen/surface/kitMesh';
import {SURFACE_KIT_BUILD, bladeName, buildSurfaceKitProp, signNames} from '../src/world/surface/kit';
import {RenderIndex} from '../src/damage/propDamage';
import {WorldMaterials} from '../src/world/materials';
import type {StationLayout} from '../src/gen/stationTypes';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';

const DRAWN = SURFACE_KINDS.filter(isSurfaceDrawnKind) as SurfaceDrawnKind[];
const DYNAMIC = ['srTrafficCone', 'srFieldRadio', 'srCot'];

function bounds(m: KitMesh): {min: number[]; max: number[]} {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of m.values()) for (let i = 0; i < q.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q.pos[i + k]); max[k] = Math.max(max[k], q.pos[i + k]); }
  return {min, max};
}

describe('the published kinds', () => {
  it('the fixed names (lanes GEN / ROOMS place them) are all PropKinds with their real-size boxes', () => {
    expect([...SURFACE_KINDS]).toEqual(['srSandbagWall', 'srJerseyBarrier', 'srTrafficCone', 'srFireHydrant', 'srStreetLamp', 'srTrafficSignal', 'srStreetSign', 'srChainFence',
      'srBollard', 'srMapTable', 'srFieldRadio', 'srCot', 'srMilitaryCrate', 'srWreckSedanStripped', 'srWreckSedanRust', 'srWreckSedanBurnt', 'srWreckSuv', 'srWreckArmyTruck',
      'srWreckCar', 'srWreckBus']);
    for (const k of SURFACE_KINDS) {
      expect(PROP_DEFS[k as PropKind], k).toBe(SURFACE_PROP_DEFS[k]);
      expect(SURFACE_SCALE[k], k).toMatch(/\d/);
    }
    const box = (k: PropKind) => [PROP_DEFS[k].w, PROP_DEFS[k].d, PROP_DEFS[k].h];
    expect(box('srSandbagWall')).toEqual([1.6, 0.6, 0.9]);
    expect(box('srJerseyBarrier')).toEqual([2.0, 0.6, 0.81]);
    expect(box('srTrafficCone')).toEqual([0.36, 0.36, 0.7]);
    expect(box('srMapTable')).toEqual([2.0, 1.2, 0.95]);
    expect(box('srMilitaryCrate')).toEqual([1.2, 0.6, 0.55]);
    expect(SR_MAP_TABLE.top.y).toBe(PROP_DEFS.srMapTable.h);
  });

  it('street-sign variants round-trip the two street ids', () => {
    for (const [a, b] of [[0, -1], [3, 7], [12, 0], [4095 - 2, 40]] as const) {
      const v = srStreetSignVariant(a, b < 0 ? undefined : b);
      expect(srStreetSignStreets(v)).toEqual({a, b});
    }
  });
});

describe('prop rules: classification', () => {
  it('every kind has a physics row (own audit source), a damage spec and exactly one openables-audit row', () => {
    expect(unclassifiedPhysicsKinds()).toEqual([]);
    for (const k of SURFACE_KINDS) {
      const r = PROP_PHYSICS_AUDIT[k];
      expect(r?.src, k).toBe('surface');
      expect(r.how.length, k).toBeGreaterThan(20);
      expect(PROP_DAMAGE[k as PropKind], k).toBeTruthy();
      expect(OPENABLE_AUDIT.filter(e => e.kind === k), k).toHaveLength(1);
    }
  });

  it('the light loose kinds are dynamic contact bodies with plausible masses; the rest static with an honest reason', () => {
    for (const k of SURFACE_KINDS) {
      const r = PROP_PHYSICS_AUDIT[k], ph = propPhysics(k);
      if (DYNAMIC.includes(k)) {
        expect(r.cls, k).toBe('dynamic');
        expect(dynamicKind(k), k).toBe(true);
        expect(ph.mass, k).toBeGreaterThanOrEqual(0.5);
        expect(ph.mass, k).toBeLessThanOrEqual(50);
        expect(r.contact, k).toBe(true);
        expect(['pad', 'castor']).toContain(ph.mat);
      } else {
        expect(r.cls, k).toBe('static');
        expect(dynamicKind(k), k).toBe(false);
        expect(r.why, k).toBeTruthy();
      }
    }
    expect(propPhysics('srFieldRadio').onHost).toBe(true); // goes loose on its table / crate top
    expect(PROP_PHYSICS_AUDIT.srMilitaryCrate.why).toBe('holder');
    for (const k of SURFACE_WRECK_KINDS) expect(PROP_PHYSICS_AUDIT[k].why, k).toBe('too heavy'); // wrecks are not pushable
    for (const k of ['srFireHydrant', 'srStreetLamp', 'srTrafficSignal', 'srStreetSign', 'srBollard']) expect(PROP_PHYSICS_AUDIT[k].why, k).toBe('anchored');
  });

  it('nothing but the crate reads as storage; the crate is a real openable container', () => {
    for (const k of SURFACE_KINDS) {
      const e = OPENABLE_AUDIT.find(q => q.kind === k)!;
      if (k === 'srMilitaryCrate') expect(e.cls).toBe('openable');
      else { expect(['none', 'exception']).toContain(e.cls); expect(SURFACE_SPECS[k].open.role, k).not.toBe('storage'); }
    }
    expect(OPENABLE_CONTAINER_KINDS).toContain('srMilitaryCrate');
    expect(isContainerKind('srMilitaryCrate')).toBe(true);
    expect(isLootHolderKind('srMilitaryCrate')).toBe(true);
    expect(HOLDER_SLOTS.srMilitaryCrate).toBe('container');
  });
});

describe('the military crate', () => {
  const spec = openableSpec('srMilitaryCrate')!;
  const {w, d, h} = PROP_DEFS.srMilitaryCrate;
  const inside = (b: readonly number[], tol = 1e-9) => b[0] >= -w / 2 - tol && b[3] <= w / 2 + tol && b[2] >= -d / 2 - tol && b[5] <= d / 2 + tol && b[1] >= -tol && b[4] <= h + tol;

  it('an authored lid on its back hinge over a lined compartment, everything inside the footprint', () => {
    expect(spec).toMatchObject({body: 'authored', group: 'container', model: null, sound: {open: 'crate', close: 'crate'}});
    expect(spec.parts).toHaveLength(1);
    const lid = spec.parts[0];
    expect(lid.move).toMatchObject({type: 'hinge', axis: 'x'});
    if (lid.move.type !== 'hinge') throw new Error('hinge');
    expect(lid.move.pivot[2]).toBeCloseTo(-SR_CRATE.bodyD / 2, 6); // back edge
    expect(lid.move.pivot[1]).toBeCloseTo(h - SR_CRATE.lidT, 6);
    expect(lid.move.angle).toBeLessThan(-Math.PI / 2); // opens up and back past upright
    for (const b of [...spec.bodyBoxes!, ...lid.boxes!]) expect(inside(b.b), JSON.stringify(b)).toBe(true);
    // the lid's top is the crate's top; the compartment lies inside the carcass walls, its loot surface on the floor with headroom
    expect(Math.max(...lid.boxes!.map(b => b.b[4]))).toBeCloseTo(h, 6);
    const c = lid.cavity!;
    expect(inside(c)).toBe(true);
    const s = lid.surfaces[0];
    expect(s.y).toBeGreaterThanOrEqual(c[1]);
    expect(s.x0).toBeGreaterThan(c[0]); expect(s.x1).toBeLessThan(c[3]); expect(s.z0).toBeGreaterThan(c[2]); expect(s.z1).toBeLessThan(c[5]);
    expect(s.y + s.clear).toBeLessThanOrEqual(c[4]);
    expect(s.clear).toBeGreaterThan(0.3);
  });

  it('its contents come from the loot foundation: an additive themed table, finite lots, ammo only through the generic supply rule', () => {
    expect(spec.loot).toBe(OPENABLE_TABLES.srMilitaryCrate);
    expect(OPENABLE_TABLES.srMilitaryCrate.items).toBe(MILITARY_SUPPLY_ROWS);
    expect(CONTAINER_THEMED.has('srMilitaryCrate')).toBe(true); // the crate decides, not the room
    expect(HOLDER_ALLOW.srMilitaryCrate).toBeUndefined(); // (a category filter would drop the filters / masks: no economy category)
    for (const [id] of MILITARY_SUPPLY_ROWS) expect(ITEMS[id], id).toBeTruthy();
    const ammo = MILITARY_SUPPLY_ROWS.filter(([id]) => econCat(id) === 'ammo');
    expect(ammo).toEqual(genericAmmo(0.6));
    const ids = new Set(MILITARY_SUPPLY_ROWS.map(r => r[0]));
    for (const id of ['gas_filter', 'gas_mask', 'bandage', 'beans', 'water']) expect(ids.has(id), id).toBe(true);
    expect(MILITARY_SUPPLY_ROWS.some(([id]) => econCat(id) === 'material')).toBe(false);
  });

  it('rolled in any compound / room: its own table whatever the room, finite 0-3 lots of checkpoint supplies', () => {
    for (const room of ['default', 'checkpoint', 'storage']) {
      const t = holderTable('srMilitaryCrate', room);
      expect(t.source, room).toBe('own');
      expect(t.slot, room).toBe('container');
      expect(t.rows, room).toEqual(MILITARY_SUPPLY_ROWS);
    }
    const rows = new Set(MILITARY_SUPPLY_ROWS.map(r => r[0]));
    const seen = new Map<string, number>();
    let lots = 0, empty = 0;
    const N = 400;
    for (let s = 1; s <= N; s++) {
      const entries = rollTableItems(s * 7919, s % 13, 'srMilitaryCrate', s % 2 ? 'checkpoint' : 'default');
      expect(entries.length).toBeLessThanOrEqual(3);
      if (!entries.length) empty++;
      lots += entries.length;
      for (const e of entries) {
        seen.set(e.itemId, (seen.get(e.itemId) ?? 0) + 1);
        expect(rows.has(e.itemId), e.itemId).toBe(true);
        expect(e.count, e.itemId).toBeGreaterThan(0);
      }
    }
    expect(empty / N).toBeGreaterThan(0.1); // the table's 25 % empty chance
    expect(empty / N).toBeLessThan(0.45);
    expect(lots / N).toBeGreaterThan(0.8);
    for (const id of ['gas_filter', 'bandage', 'water', 'beans']) expect(seen.get(id) ?? 0, id).toBeGreaterThan(0);
  });
});

describe('geometry and scale (rule 5 numbers; the renders are viewed in the scale check)', () => {
  it('every drawn kind stands on the ground inside its box (only above-head overhangs: lamp / signal arms, sign blades)', () => {
    const OVERHANG: Readonly<Record<string, number>> = {srStreetLamp: 2.4, srTrafficSignal: 2.4, srStreetSign: 2.4};
    for (const k of DRAWN) {
      const variants = k === 'srStreetSign' ? [srStreetSignVariant(0), srStreetSignVariant(0, 1)] : [0];
      for (const v of variants) {
        const m = surfaceKitMesh(k, v), b = bounds(m), def = PROP_DEFS[k];
        expect(b.min[1], k).toBeCloseTo(0, 6);
        expect(b.max[1], k).toBeLessThanOrEqual(def.h + 1e-6);
        expect(b.max[1], k).toBeGreaterThan(def.h * 0.93);
        // geometry outside the footprint only above OVERHANG metres
        for (const q of m.values()) for (let i = 0; i < q.pos.length; i += 3) {
          const out = Math.abs(q.pos[i]) > def.w / 2 + 1e-6 || Math.abs(q.pos[i + 2]) > def.d / 2 + 1e-6;
          if (out) expect(q.pos[i + 1], `${k} vertex outside its footprint`).toBeGreaterThan(OVERHANG[k] ?? Infinity);
        }
        for (const q of m.values()) {
          expect(q.idx.length % 3).toBe(0);
          expect(Math.max(...q.idx)).toBeLessThan(q.pos.length / 3);
          expect(q.nor.length).toBe(q.pos.length);
        }
      }
    }
  });

  it('the sandbag wall is rounded bags in staggered courses, not a box; the fence real diagonal wire', () => {
    const bags = surfaceKitMesh('srSandbagWall');
    const tris = [...bags.values()].reduce((a, q) => a + q.idx.length / 3, 0);
    expect(tris).toBeGreaterThan(2000);
    expect(tris).toBeLessThan(6000);
    expect([...bags.keys()].sort()).toEqual(['bagOlive', 'bagTan']);
    const wire = surfaceKitMesh('srChainFence').get('wire')!;
    expect(wire.idx.length / 3).toBeGreaterThan(500);
  });

  it('the wreck boxes are the models\' measured bounds (x k), catalogued at their cooked sizes and admitted under the surface family', () => {
    const sky: Record<string, keyof typeof SKYWAYS_PROP_MODELS> = {srWreckSedanStripped: 'skyways_wreck_sedan_stripped', srWreckSedanRust: 'skyways_wreck_sedan_rust',
      srWreckSedanBurnt: 'skyways_wreck_sedan_burnt', srWreckSuv: 'skyways_wreck_suv', srWreckArmyTruck: 'skyways_wreck_army_truck'};
    const office: Record<string, 'car-wreck' | 'bus-wreck'> = {srWreckCar: 'car-wreck', srWreckBus: 'bus-wreck'};
    for (const k of SURFACE_WRECK_KINDS) {
      const m = SURFACE_WRECK_MODEL[k], def = PROP_DEFS[k];
      const src = sky[k] ? SKYWAYS_PROP_MODELS[sky[k]] : null, o = office[k] ? OFFICE_ASSETS[office[k]] : null;
      const dims = src ? [src.w, src.h, src.d] : [...o!.dims!];
      expect(src?.url ?? o!.url, k).toBe(m.url);
      [def.w, def.h, def.d].forEach((v, i) => expect(Math.abs(v - dims[i] * m.k), `${k} axis ${i}`).toBeLessThan(6e-4));
      expect(fs.statSync(new URL(`../public/${m.url}`, import.meta.url)).size, k).toBe(m.bytes);
      expect(def.w, k).toBeGreaterThan(4.4); // cars ~4.6-4.9 m, the truck 7.6, the bus 9.4 (real size beside the zombie)
      expect(def.h, k).toBeLessThan(3.5);
    }
    const catalogue = {...OFFICE_MODEL_FILES, ...SURFACE_KIT_MODEL_FILES};
    const keys = surfaceKitModelKeysFor({props: SURFACE_WRECK_KINDS.map(kind => ({kind}))});
    expect(keys).toHaveLength(SURFACE_WRECK_KINDS.length);
    for (const key of keys) expect(catalogue[key], key).toBeTruthy();
    expect(selectLevelKeys('surface', keys, catalogue).foreign).toEqual([]);
    expect(selectLevelKeys('subway', keys, catalogue).foreign.length).toBe(5); // the Skyways files stay level-only elsewhere
    expect(surfaceKitModelKeysFor({props: [{kind: 'bench'}, {kind: 'srCot'}]})).toEqual([]);
  });
});

describe('the renderer', () => {
  // (the world materials and the sign atlas draw on canvases: the 2D shim stands in for the DOM)
  let restore: () => void, mats: WorldMaterials;
  beforeAll(() => { restore = installCanvasShim(false); mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });
  afterAll(() => restore());
  const place = (kind: PropKind, x: number, z: number, variant = 0, level = 0): PropPlacement => {
    const def = PROP_DEFS[kind];
    return {kind, x, z, y: 0, rot: 0, area: 0, hx: def.w / 2, hz: def.d / 2, h: def.h, blocksSight: def.blocksSight, variant, level};
  };
  const noModel = () => { throw new Error('no model expected'); };

  it('drawn kinds: prop-<kind>-<material> instanced cohorts the damage RenderIndex maps back to every placement', () => {
    const group = new THREE.Group(), props: PropPlacement[] = [];
    DRAWN.forEach((k, i) => { props.push(place(k, i * 5, 0), place(k, i * 5, 90)); }); // two chunks apart
    const byKind = new Map<string, PropPlacement[]>();
    for (const p of props) { const l = byKind.get(p.kind) ?? []; l.push(p); byKind.set(p.kind, l); }
    for (const [k, list] of byKind) expect(buildSurfaceKitProp(group, k as never, list, mats, noModel, {})).toBe(2);
    const ri = new RenderIndex();
    ri.build([group], props, new Set());
    for (const p of props) {
      const inst = ri.inst.get(p) ?? [];
      const parts = surfaceKitMesh(p.kind as SurfaceDrawnKind, p.variant).size;
      // a movable kind must map EVERY part (they detach together); the anchored street furniture maps at least its pole / body (the
      // lamp head / signal heads hang outside the box: no damage marks there, nothing detaches)
      if (DYNAMIC.includes(p.kind)) expect(inst.length, `${p.kind} instances`).toBe(parts);
      else { expect(inst.length, `${p.kind} instances`).toBeGreaterThan(0); expect(inst.length).toBeLessThanOrEqual(parts); }
      expect(new Set(inst.map(e => e.mesh)).size, p.kind).toBe(inst.length);
    }
    group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) expect(o.userData.level).toBe(0); });
  });

  it('wrecks: the lazy model at their box through instanceModel; a missing model draws an honest stand-in', () => {
    const group = new THREE.Group(), list = [place('srWreckBus', 0, 0), place('srWreckBus', 20, 0)];
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(12, 4.3417, 3.7612), new THREE.MeshStandardMaterial()));
    const calls: {fit: unknown; name: string; n: number}[] = [];
    const n = buildSurfaceKitProp(group, 'srWreckBus', list, mats, (_g, _gltf, ps, fit, name) => { calls.push({fit, name, n: ps.length}); return ps.length; }, {'office-bus-wreck': {scene} as unknown as GLTF});
    expect(n).toBe(2);
    expect(calls).toEqual([{fit: {w: 9.36, h: 3.3865, d: 2.9337, anchor: 'bottom'}, name: 'srWreckBus', n: 2}]);
    const before = SURFACE_KIT_BUILD.standIns;
    expect(buildSurfaceKitProp(group, 'srWreckSuv', [place('srWreckSuv', 0, 0)], mats, noModel, {})).toBe(1);
    expect(SURFACE_KIT_BUILD.standIns).toBe(before + 1);
    expect(group.children.some(o => o.name === 'prop-srWreckSuv-standin')).toBe(true);
  });

  it('street signs: the names are drawn at runtime from layout.surface (one atlas row per distinct name), released with the world', () => {
    expect(bladeName('Calder Street')).toBe('CALDER ST');
    expect(bladeName('North Halsey Avenue')).toBe('NORTH HALSEY AVE');
    expect(bladeName('Mill Lane')).toBe('MILL LN');
    const layout = {surface: {streets: [{id: 0, name: 'Calder Street'}, {id: 1, name: 'Fifth Avenue'}]}} as unknown as StationLayout;
    expect(signNames(layout, srStreetSignVariant(0, 1))).toEqual({a: 'CALDER ST', b: 'FIFTH AVE'});
    expect(signNames(layout, srStreetSignVariant(1))).toEqual({a: 'FIFTH AVE', b: null});
    {
      const group = new THREE.Group();
      const list = [place('srStreetSign', 0, 0, srStreetSignVariant(0, 1)), place('srStreetSign', 30, 0, srStreetSignVariant(1)), place('srStreetSign', 30, 30, srStreetSignVariant(0, 1), 1)];
      const f0 = SURFACE_KIT_BUILD.signFaces;
      buildSurfaceKitProp(group, 'srStreetSign', list, mats, noModel, {}, layout);
      expect(SURFACE_KIT_BUILD.signFaces - f0).toBe(2 * (2 + 1 + 2)); // both sides of every blade
      const faces = group.children.filter(o => o.name.startsWith('surface-sign-names-L')) as THREE.Mesh[];
      expect(faces.map(m => m.userData.level).sort()).toEqual([0, 1]);
      const tex = (faces[0].material as THREE.Material & {map?: THREE.Texture}).map!;
      expect((tex.image as {height: number}).height).toBe(2 * 128); // two distinct names
      let disposed = 0;
      tex.addEventListener('dispose', () => disposed++);
      group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
      expect(disposed).toBe(1);
      expect(group.children.some(o => o.name === 'prop-srStreetSign-b2-paintGreen')).toBe(true);
      expect(group.children.some(o => o.name === 'prop-srStreetSign-b1-paintGreen')).toBe(true);
    }
  });
});
