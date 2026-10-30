// Task office-props-physics-scale-20261030 (lane FURN): user feedback 6-9 — the miniature lab bench (its beakers baked in), the bakery
// case whose bread could not be taken (and that sometimes stood backwards), the toy-sized bean bag and the curved monitor desk (too
// small, monitors baked in).
//  - furniture-only real size: the lab bench / trading desk / bakery case / bean bag footprints are their furniture at human scale;
//  - the separated loose clutter stands on its furniture's top as dynamic on-host props (seeded, supported, non-overlapping), reacts to
//    a shot and never sinks into its host;
//  - the bakery case is a holder of finite `bread` FOOD lots on pull-out trays (taken lots stay taken), placed with its operable
//    staff side open (a staff aisle behind it) and its customer glass to the room;
//  - lab drawers hold bio mater now and then (finite, modest).
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {Grid, FLOOR, SOLID, CELL} from '../src/gen/grid';
import {Rng} from '../src/core/rng';
import {CLUTTER_KINDS, clutterHost, isClutterKind} from '../src/gen/office/clutterKinds';
import {placeHostClutter} from '../src/gen/office/hostClutter';
import {OFFICE_PHYS} from '../src/gen/office/physics';
import {SERVE_BEHIND} from '../src/gen/office/companyDress';
import {generateOfficeLevel} from '../src/gen/office/index';
import {officeTenants} from '../src/gen/office/tenants';
import {propPhysics} from '../src/damage/materials';
import {PhysicsSystem} from '../src/physics/world';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {BAKERY_LEVELS, openableSpec, partFace} from '../src/world/openablesSpec';
import {COMPANY_ASSETS, COMPANY_PART_ASSETS} from '../src/assets/companyAssets';
import {COMPANY_PART_DIMS} from '../src/assets/companyDims.generated';
import {MODEL_FILES} from '../src/assets/manifest';
import {FOOD_IDS, ITEMS, ITEM_DIMS, isFoodOrDrink} from '../src/items/items';
import {BAKERY_ROWS, HOLDER_ALLOW, LAB_DRAWER_ROWS, OPENABLE_TABLES, econCat, lootProfile} from '../src/items/lootTables';
import {BIO_MATER} from '../src/items/craftMaterials';
import {ITEM_MODEL_KEYS} from '../src/world/pickups';
import {ICONS} from '../src/ui/icons';
import {ContainerManager, type Holder} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {Inventory} from '../src/items/inventory';
import {fakeEnvTextures, openableModels, rowLayout} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {applyHolders, captureHolders} from '../src/run/worldMemory';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const DT = 1 / 60;
const run = (ph: PhysicsSystem, s: number, each?: () => void) => { for (let t = 0; t < s - 1e-9; t += DT) { ph.update(DT); each?.(); } };
const PELLET = 15 * SHOT_IMPULSE_PER_DAMAGE;

/** Host-local AABB of a decor prop on a host (both quarter-turn or any yaw: corners of its footprint in the host frame). */
function localBox(host: PropPlacement, p: PropPlacement): [number, number, number, number] {
  const def = PROP_DEFS[p.kind];
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  const dx = p.x - host.x, dz = p.z - host.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz; // world -> host frame (inverse of x' = c x + s z, z' = -s x + c z)
  const yaw = p.rot - host.rot, cy = Math.abs(Math.cos(yaw)), sy = Math.abs(Math.sin(yaw));
  const hx = (def.w * cy + def.d * sy) / 2, hz = (def.w * sy + def.d * cy) / 2;
  return [lx - hx, lz - hz, lx + hx, lz + hz];
}

describe('furniture-only real size (lane FURN)', () => {
  it('the lab bench, trading desk, bakery case and bean bag are human-scale furniture, measured without their loose clutter', () => {
    // a standard standing lab bench: worktop 0.9 m; a desk 0.74 m; a bakery display ~1.35 m with its deck at counter-ish height
    expect(PROP_DEFS.labBench.h).toBeCloseTo(0.9, 3);
    expect(PROP_DEFS.labBench.d).toBeGreaterThan(0.75);
    expect(PROP_DEFS.tradingDesk.h).toBeCloseTo(0.74, 3);
    expect(PROP_DEFS.bakeryCase.h).toBeCloseTo(1.35, 3);
    expect(BAKERY_LEVELS[0]).toBeGreaterThan(0.55);
    // an adult bean bag (it was 0.86 x 0.39 x 0.90 m: knee-high on a zombie)
    expect(Math.max(PROP_DEFS.beanBag.w, PROP_DEFS.beanBag.d)).toBeCloseTo(1.3, 2);
    expect(PROP_DEFS.beanBag.h).toBeGreaterThan(0.5);
    // the lab bench's 15 drawers scaled with the body: fronts ~0.22 m tall over 0.2..0.85 m, full-depth trays
    const lab = openableSpec('labBench')!;
    const ys = lab.parts.flatMap(p => p.region!.flatMap(b => [b[1], b[4]]));
    expect(Math.min(...ys)).toBeGreaterThan(0.18);
    expect(Math.max(...ys)).toBeLessThan(0.86);
    for (const p of lab.parts) expect(p.surfaces[0].z1 - p.surfaces[0].z0, p.name).toBeGreaterThan(0.45);
    // the registry records the furniture-only size; the measured dims are the body (no beakers / monitors above the top)
    expect(COMPANY_ASSETS['lab-bench'].dims![1]).toBeCloseTo(0.9, 3);
    expect(COMPANY_ASSETS['trading-desk'].dims![1]).toBeCloseTo(0.74, 3);
  });

  it('every separated part is its own small real-size model; every prop part is a dynamic on-host clutter kind of its furniture', () => {
    const props = Object.entries(COMPANY_PART_ASSETS).filter(([, p]) => p.kind === 'prop').map(([id]) => id).sort();
    expect(CLUTTER_KINDS.map(k => PROP_DEFS[k] && (openableSpec(k) === null) && k).length).toBe(props.length);
    for (const k of CLUTTER_KINDS) {
      const ph = OFFICE_PHYS[k];
      expect(ph.dynamic, k).toBe(true);
      expect(propPhysics(k), k).toMatchObject({dynamic: true, onHost: true, contact: true});
      expect(PROP_DEFS[k].h, k).toBeGreaterThan(0.04);
      expect(PROP_DEFS[k].h, k).toBeLessThan(0.55);
    }
    // real sizes: a 500 ml flask ~0.18 m tall, a microscope 0.4 m, a 27-inch monitor 0.62 m wide
    expect(PROP_DEFS.labFlask.h).toBeCloseTo(0.18, 2);
    expect(PROP_DEFS.labMicroscope.h).toBeCloseTo(0.4, 2);
    expect(PROP_DEFS.tradingMonitor.w).toBeCloseTo(0.62, 2);
  });
});

describe('loose clutter on the lab bench / trading desk tops (lane FURN)', () => {
  it('seeded, finite, supported by the host top, inside its footprint, never overlapping (lab)', () => {
    let lab = 0, mon = 0, kb = 0, benches = 0, desks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const layout = rowLayout(['labBench', 'tradingDesk', 'labBench', 'tradingDesk'], {back: 3.5, seed});
      layout.props[2].rot = Math.PI / 2; layout.props[3].rot = Math.PI; // turned hosts too
      const n0 = layout.props.length;
      const n = placeHostClutter(layout.props, 0, new Rng(seed * 7919));
      expect(layout.props.length - n0).toBe(n);
      // same seed -> same clutter; a second pass adds nothing (finite, never respawned)
      const again = rowLayout(['labBench', 'tradingDesk', 'labBench', 'tradingDesk'], {back: 3.5, seed});
      again.props[2].rot = Math.PI / 2; again.props[3].rot = Math.PI;
      placeHostClutter(again.props, 0, new Rng(seed * 7919));
      expect(again.props.map(p => [p.kind, p.x, p.z, p.rot])).toEqual(layout.props.map(p => [p.kind, p.x, p.z, p.rot]));
      expect(placeHostClutter(layout.props, 0, new Rng(seed))).toBe(0);
      for (let h = 0; h < n0; h++) {
        const host = layout.props[h];
        if (host.kind === 'labBench') benches++; else desks++;
        const mine = layout.props.filter(q => q.host === h);
        for (const q of mine) {
          expect(isClutterKind(q.kind), q.kind).toBe(true);
          expect(clutterHost(q.kind as never)).toBe(host.kind);
          expect(q.y).toBeCloseTo(host.y + host.h, 3); // on the host's top face (DynamicItems.restsOnStaticHost)
          const [x0, z0, x1, z1] = localBox(host, q), def = PROP_DEFS[host.kind];
          expect(x0 >= -def.w / 2 - 1e-3 && x1 <= def.w / 2 + 1e-3 && z0 >= -def.d / 2 - 1e-3 && z1 <= def.d / 2 + 1e-3, `${q.kind} on ${host.kind} footprint`).toBe(true);
        }
        if (host.kind === 'labBench') {
          lab += mine.length;
          const boxes = mine.map(q => localBox(host, q));
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1], 'lab clutter overlaps').toBe(false);
          }
        } else {
          mon += mine.filter(q => q.kind === 'tradingMonitor').length;
          kb += mine.filter(q => q.kind === 'tradingKeyboard').length;
          expect(mine.filter(q => q.kind === 'tradingMonitor').length).toBeLessThanOrEqual(5);
        }
      }
    }
    console.info(`[clutter] lab ${(lab / benches).toFixed(2)} pieces / bench, ${(mon / desks).toFixed(2)} monitors + ${(kb / desks).toFixed(2)} keyboards / desk`);
    expect(lab / benches).toBeGreaterThan(2);
    expect(mon / desks).toBeGreaterThan(3.5);
    expect(kb / desks).toBeGreaterThan(0.6);
  });

  it('on the generated Office: every lab bench / trading desk of the lab / trading tenants carries its clutter; monitors face the operator', () => {
    // level seed 8: Verdant (labs), Crestmark (trading floor) and Goldencrust (bakery) are all tenants (gen/office/tenants.ts)
    expect(officeTenants(8).map(t => t.company)).toEqual(expect.arrayContaining(['verdant', 'crestmark', 'goldencrust']));
    const layout = level8();
    const hosts = layout.props.map((p, i) => ({p, i})).filter(({p}) => p.kind === 'labBench' || p.kind === 'tradingDesk');
    expect(hosts.filter(h => h.p.kind === 'labBench').length).toBeGreaterThan(2);
    expect(hosts.filter(h => h.p.kind === 'tradingDesk').length).toBeGreaterThan(2);
    let bare = 0;
    for (const {p, i} of hosts) {
      const mine = layout.props.filter(q => q.host === i && isClutterKind(q.kind));
      if (!mine.length) bare++;
      for (const q of mine) {
        expect(q.y).toBeCloseTo(p.y + p.h, 3);
        expect(q.level ?? 0).toBe(p.level ?? 0);
        if (q.kind === 'tradingMonitor') {
          // its front (+Z turned by rot) points toward the desk's operator side (+Z of the desk)
          const f = new THREE.Vector2(Math.sin(q.rot), Math.cos(q.rot)), dfront = new THREE.Vector2(Math.sin(p.rot), Math.cos(p.rot));
          expect(f.dot(dfront), 'monitor faces the operator').toBeGreaterThan(0.2);
        }
      }
    }
    expect(bare / hosts.length).toBeLessThan(0.15);
  });

  it('a lab flask goes loose on the bench top under fire (host-top slab), never sinks into the bench, and settles', () => {
    const bench = rowLayout(['labBench'], {back: 3.5}).props[0];
    const flask: PropPlacement = {kind: 'labFlask', x: bench.x + 0.3, z: bench.z, y: bench.y + bench.h, rot: 0, area: 0, hx: PROP_DEFS.labFlask.w / 2, hz: PROP_DEFS.labFlask.d / 2,
      h: PROP_DEFS.labFlask.h, blocksSight: false, variant: 0, host: 0};
    const g = new Grid(48, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 1 || y < 2 || x >= 47 || y >= 31 ? SOLID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [bench, flask], trench: {floorY: -1.15}} as never);
    ph.dynamicItems.contactWake = true;
    const meshes = new Map<PropPlacement, THREE.Mesh>();
    ph.dynamicItems.detacher = {detachForPhysics: (p: PropPlacement) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
      m.matrixAutoUpdate = false;
      m.matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      meshes.set(p, m);
      return [m];
    }} as never;
    expect(ph.dynamicItems.isDynamicProp(flask)).toBe(true);
    expect(ph.dynamicItems.isDynamicProp(bench)).toBe(false); // the bench (a holder, built in) never moves
    expect(ph.dynamicItems.shootProp(flask, 1, new THREE.Vector3(flask.x - 0.06, flask.y + 0.1, flask.z), new THREE.Vector3(1, -0.05, 0).normalize(), PELLET)).toBe(true);
    expect(ph.dynamicItems.stats().counts.hostSlabs).toBe(1);
    let inside = false;
    run(ph, 8, () => {
      const at = new THREE.Vector3().setFromMatrixPosition(meshes.get(flask)!.matrix);
      if (Math.abs(at.x - bench.x) < bench.hx - 0.05 && Math.abs(at.z - bench.z) < bench.hz - 0.05 && at.y < bench.h - 0.06 && at.y > 0.08) inside = true;
    });
    const end = new THREE.Vector3().setFromMatrixPosition(meshes.get(flask)!.matrix);
    expect(inside).toBe(false);
    expect(end.distanceTo(new THREE.Vector3(flask.x, bench.h, flask.z)), 'it moved').toBeGreaterThan(0.02);
    expect(end.y > bench.h - 0.06 || end.y < 0.3, 'on the bench top or on the floor').toBe(true);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0);
  });
});

describe('the bakery case: finite bread on pull-out trays, operable side open (lane FURN)', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let models: Record<string, GLTF> = {};
  beforeAll(async () => { models = await openableModels(); }, 120000);

  it('bread is a FOOD item with its own pickup model (cut out of the case), dims and icon; the case only ever holds it', () => {
    const b = ITEMS.bread;
    expect(b).toMatchObject({kind: 'consumable', verb: 'eat', icon: 'bread'});
    expect(isFoodOrDrink(b)).toBe(true);
    expect(b.hunger!).toBeGreaterThan(15);
    expect(FOOD_IDS).toContain('bread');
    expect(econCat('bread')).toBe('food');
    expect(ICONS.bread).toMatch(/^<svg/);
    expect(ITEM_MODEL_KEYS.bread).toBe('item_bread');
    const file = MODEL_FILES.item_bread;
    expect(file.url).toBe(COMPANY_PART_ASSETS.bread.url);
    expect(Math.abs(fs.statSync(path.join(PUB, file.url)).size - file.bytes)).toBeLessThan(2_000);
    const [x, y, z] = COMPANY_PART_DIMS.bread;
    expect(ITEM_DIMS.bread).toMatchObject({w: x, h: y, d: z});
    expect(BAKERY_ROWS).toEqual([['bread', 1]]);
    expect(OPENABLE_TABLES.bakeryCase.items).toBe(BAKERY_ROWS);
    expect(HOLDER_ALLOW.bakeryCase).toEqual(['food']);
  });

  it('bread lots on the trays (seen through, taken once a tray is pulled out the staff side), finite, remembered, never refilled', () => {
    const spec = openableSpec('bakeryCase')!;
    expect(spec.turn).toBe(true);
    for (const p of spec.parts) { expect(p.glass, p.name).toBe(true); expect(partFace(p), `${p.name} opens on the staff side (prop -Z)`).toBe(-1); }
    let cases = 0, loaves = 0, got = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const layout = rowLayout(['bakeryCase'], {back: 3.5, seed});
      (layout.areas[0] as {type: string}).type = 'food-court'; // a food-themed room (the bakery)
      const inv = new Inventory();
      const cm = new ContainerManager(models, mats, () => inv);
      cm.build(layout, {}, lootProfile('office'));
      const h = cm.openList.find(x => x.kind === 'bakeryCase') as Holder;
      expect(h, `seed ${seed}`).toBeTruthy();
      cases++;
      for (const l of h.state.lots) expect(l.itemId, `seed ${seed}`).toBe('bread');
      const total = h.state.lots.reduce((n, l) => n + l.count, 0);
      loaves += total;
      if (!total) continue;
      // [E] on a tray pulls it out (staff side), [E] again takes its loaves; again and again: nothing more (finite, never refilled)
      let taken = 0;
      cm.onEvent = e => { for (const t of e.result?.taken ?? []) { expect(t.itemId).toBe('bread'); taken += t.count; } };
      const takeAll = () => { for (let i = 0; i < h.open!.parts.length; i++) for (let k = 0; k < 3; k++) { cm.interact({container: h, t: 1, lot: null, part: i}); for (let t = 0; t < 0.05; t += DT) cm.update(DT, t); } };
      takeAll();
      const once = taken;
      expect(once, `seed ${seed}`).toBe(total);
      takeAll();
      expect(taken, 'never refilled').toBe(once);
      expect(inv.hotbar.concat(inv.pack).filter(st => st?.itemId === 'bread').reduce((n, st) => n + st!.count, 0)).toBe(total);
      got += once;
      // run memory: the rebuilt section drops what was taken (the loaves never come back)
      const mem = captureHolders(cm);
      const cm2 = new ContainerManager(models, mats, () => new Inventory());
      cm2.build(layout, {}, lootProfile('office'));
      applyHolders(cm2, mem);
      expect(cm2.openList.find(x => x.kind === 'bakeryCase')!.state.lots.length, `seed ${seed}: remembered`).toBe(0);
    }
    console.info(`[bakery] ${(loaves / cases).toFixed(2)} loaves / case`);
    expect(loaves / cases).toBeGreaterThan(0.5);
    expect(loaves / cases).toBeLessThan(3);
    expect(got).toBe(loaves);
  });

  it('generated Office: every bakery case keeps its staff side open (aisle behind it) and its customer glass toward the room', () => {
    const layout = level8();
    const cases = layout.props.filter(p => p.kind === 'bakeryCase');
    expect(cases.length).toBeGreaterThan(0);
    const aisle = SERVE_BEHIND.get('bakeryCase')!;
    for (const p of cases) {
      const g = layout.levels![p.level ?? 0].grid as Grid;
      const def = PROP_DEFS.bakeryCase;
      const fx = Math.sin(p.rot), fz = Math.cos(p.rot), lx = Math.cos(p.rot), lz = -Math.sin(p.rot);
      // samples across the case's width, 0.25 .. 0.75 m behind its back (staff side) and in front of its glass
      const open = (dist: number) => {
        let ok = 0, n = 0;
        for (const t of [-0.35, 0, 0.35]) {
          const x = p.x + fx * dist + lx * t * def.w, z = p.z + fz * dist + lz * t * def.w;
          const [cx, cy] = g.cellOf(x, z);
          n++;
          if (g.walkable(cx, cy)) ok++;
        }
        return ok / n;
      };
      for (const dd of [0.25, 0.5, Math.min(0.75, aisle - 0.2)]) expect(open(-(def.d / 2 + dd)), `case at ${p.x},${p.z} staff side ${dd}`).toBe(1);
      expect(open(def.d / 2 + 0.3), `case at ${p.x},${p.z} customer side`).toBeGreaterThan(0.6);
      void CELL;
    }
  });
});

describe('bio mater in lab drawers (lane FURN)', () => {
  it('lab bench drawers list bio mater as a modest row; the bench may hold materials', () => {
    const w = Object.fromEntries(LAB_DRAWER_ROWS);
    expect(w[BIO_MATER]).toBeGreaterThan(0);
    expect(w[BIO_MATER] / LAB_DRAWER_ROWS.reduce((s, r) => s + r[1], 0)).toBeLessThan(0.25);
    expect(HOLDER_ALLOW.labBench).toContain('material');
  });
});

let L8: StationLayout | null = null;
function level8(): StationLayout {
  return (L8 ??= generateOfficeLevel({levelSeed: 8, startWeapon: 'pistol'} as never));
}
void ({} as PropKind);
