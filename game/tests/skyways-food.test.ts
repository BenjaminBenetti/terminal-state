// Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant — its EDIBLE food (ramen bowls, sushi bento,
// bubble tea: ordinary consumables registered like bread) and its kit (gen/skyways/ramen.ts dressSkywaysRamen + the range / stock pot /
// saucepan / sushi mascot kinds), on a synthetic carved dining room + kitchen:
//  - registrations: ITEMS / FOOD_IDS / DRINK_IDS / ITEM_DIMS / boot MODEL_FILES item_<id> (shared) / icons / damage classes / bodies /
//    econ categories / consume-view style / survival effect; the new kinds in PROP_DEFS, PROP_DAMAGE, PROP_PHYSICS_AUDIT, OPENABLE_AUDIT,
//    the lazy level-only `skyways-*` model keys;
//  - the purposes: weight 0 presets, exact small RAMEN_* named tables, holder rolls themed;
//  - the dressing: counter + mascot on its top (cut), cooler, café seating, range with its pot / saucepan on the cooktop, kitchen
//    holders keyed to the restaurant; 2-4 loose pickups standing supported on a table / the counter (no floating, no overlap, finite),
//    counter lots never under the mascot / a pickup; heights in both frames on a raised storey; deterministic; rooms stay connected;
//  - the cookware / mascot go loose under fire on their static host's top (host slab), the range never moves.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {DRINK_IDS, FOOD_IDS, ITEMS, ITEM_DIMS, effectText, isFoodOrDrink, itemDef} from '../src/items/items';
import {BUBBLE_TEA, RAMEN, RAMEN_CHASHU, SKYWAYS_EDIBLE_IDS, SKYWAYS_FOOD_MODEL, SUSHI_BENTO} from '../src/items/skywaysFood';
import {SKYWAYS_FOOD_MODELS, SKYWAYS_RANGE_COOKTOP_Y} from '../src/assets/skywaysFoodModels';
import {MODEL_FILES} from '../src/assets/manifest';
import {ITEM_MODEL_KEYS} from '../src/world/pickups';
import {ICONS} from '../src/ui/icons';
import {RAMEN_COOLER, RAMEN_COUNTER, RAMEN_FRIDGE, RAMEN_KITCHEN, RAMEN_LOOSE_ROWS, econCat} from '../src/items/lootTables';
import {itemClass, itemPhysics, modelClass, propDamageSpec, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropPlacement} from '../src/gen/props';
import {SKYWAYS_KITCHEN_KINDS, SKYWAYS_KITCHEN_MODEL_FILES, skywaysKitchenModelKey, skywaysKitchenModelKeysFor} from '../src/gen/skyways/kitchenKinds';
import {SKYWAYS_RAMEN_PURPOSE} from '../src/gen/skyways/ramenPurposes';
import {RAMEN_LOOSE, dressSkywaysRamen, type RamenDressResult} from '../src/gen/skyways/ramen';
import {purposeById} from '../src/gen/purposes';
import {createHolderState, holderFinds, holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {cutSurfaces} from '../src/gen/props07';
import {areaConnected, makePlaceCtx} from '../src/gen/placeKit';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {Rng} from '../src/core/rng';
import {ConsumeView} from '../src/weapons/consumeView';
import {Survival} from '../src/player/survival';
import {PhysicsSystem} from '../src/physics/world';
import {dynamicKind} from '../src/physics/dynamicItems';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {levelOfAsset} from '../src/assets/levelAssets';
import {loadStripped} from './helpers/openablesFixture';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const DT = 1 / 60;
const PELLET = 15 * SHOT_IMPULSE_PER_DAMAGE;
const FILES: Record<string, string> = {
  [RAMEN]: 'assets/models/item-ramen-bowl.glb', [RAMEN_CHASHU]: 'assets/models/item-ramen-chashu.glb',
  [SUSHI_BENTO]: 'assets/models/item-sushi-bento.glb', [BUBBLE_TEA]: 'assets/models/item-bubble-tea.glb',
};

// ---------------------------------------------------------------------------------------------
// the edible items

describe('Skyways food: four ordinary consumables, registered like bread', () => {
  it('ramen / chashu ramen / bento are FOOD, bubble tea a DRINK, with the tuned effects, stacks, use times and icons', () => {
    const want = {
      [RAMEN]: {name: 'Shoyu ramen bowl', verb: 'eat', hunger: 40, thirst: 12, stackMax: 2, useTime: 2.5},
      [RAMEN_CHASHU]: {name: 'Chashu ramen bowl', verb: 'eat', hunger: 45, thirst: 10, stackMax: 2, useTime: 2.5},
      [SUSHI_BENTO]: {name: 'Sushi bento box', verb: 'eat', hunger: 32, stackMax: 3, useTime: 2.2},
      [BUBBLE_TEA]: {name: 'Bubble tea', verb: 'drink', thirst: 30, hunger: 8, stackMax: 3, useTime: 1.8},
    };
    for (const id of SKYWAYS_EDIBLE_IDS) {
      const d = ITEMS[id];
      expect(d, id).toMatchObject({id, kind: 'consumable', icon: id, ...want[id]});
      expect(isFoodOrDrink(d), id).toBe(true);
      expect(ICONS[d.icon], id).toMatch(/^<svg/);
      expect(d.description.length, id).toBeGreaterThan(40);
    }
    expect(FOOD_IDS).toEqual(expect.arrayContaining([RAMEN, RAMEN_CHASHU, SUSHI_BENTO]));
    expect(DRINK_IDS).toContain(BUBBLE_TEA);
    expect(SUSHI_BENTO in ITEMS && ITEMS.sushi_bento.thirst).toBeFalsy();
    expect(effectText(itemDef(RAMEN))).toBe('+40 food · +12 water');
    expect(effectText(itemDef(BUBBLE_TEA))).toBe('+8 food · +30 water');
    for (const id of [RAMEN, RAMEN_CHASHU, SUSHI_BENTO]) expect(econCat(id), id).toBe('food');
    expect(econCat(BUBBLE_TEA)).toBe('drink');
  });

  it('eating / drinking moves the existing survival bars only (no new meter)', () => {
    const s = new Survival();
    s.hunger = 40; s.thirst = 40;
    expect(s.consume(itemDef(RAMEN))).toEqual({hunger: 40, thirst: 12});
    expect(s.consume(itemDef(BUBBLE_TEA))).toEqual({hunger: 8, thirst: 30});
    expect(s.consume(itemDef(RAMEN_CHASHU))).toEqual({hunger: 12, thirst: 10}); // clamped at 100
    expect(Object.keys(s).filter(k => /meter|satiety|broth/i.test(k))).toEqual([]);
  });

  it('item models: shared boot files item_<id> (food travels), ITEM_DIMS = their real bounds, damage classes and rigid bodies', () => {
    for (const id of SKYWAYS_EDIBLE_IDS) {
      const key = `item_${id}`;
      expect(ITEM_MODEL_KEYS[id], id).toBe(key);
      const f = (MODEL_FILES as Record<string, {url: string; bytes: number}>)[key];
      expect(f.url, id).toBe(FILES[id]);
      expect(levelOfAsset(f.url), `${id} is not level-only`).toBeNull();
      expect(f.bytes, id).toBeGreaterThan(20_000);
      const m = SKYWAYS_FOOD_MODELS[SKYWAYS_FOOD_MODEL[id]];
      expect(m.url).toBe(f.url);
      expect(ITEM_DIMS[id], id).toMatchObject({w: m.w, h: m.h, d: m.d});
      expect(ITEM_DIMS[id].shape, id).toBe(id === BUBBLE_TEA ? 'cylinder' : 'flat');
      expect(modelClass(key), id).toBe(itemClass(id));
      expect(itemPhysics(id).mass, id).toBeGreaterThan(0.3);
      expect(itemPhysics(id).mass, id).toBeLessThan(1.5);
    }
    // ASSET-A targets: bowl rims 0.20 / 0.22 m, the bento 0.24 m long, the cup 0.24 m tall with its straw
    const near = (v: number, t: number) => expect(Math.abs(v - t), `${v} ~ ${t}`).toBeLessThan(0.01);
    near(Math.max(ITEM_DIMS[RAMEN].w, ITEM_DIMS[RAMEN].d), 0.2);
    near(Math.max(ITEM_DIMS[RAMEN_CHASHU].w, ITEM_DIMS[RAMEN_CHASHU].d), 0.22);
    near(Math.max(ITEM_DIMS[SUSHI_BENTO].w, ITEM_DIMS[SUSHI_BENTO].d), 0.24);
    near(ITEM_DIMS[BUBBLE_TEA].h, 0.24);
    expect([itemClass(RAMEN), itemClass(RAMEN_CHASHU), itemClass(SUSHI_BENTO), itemClass(BUBBLE_TEA)]).toEqual(['porcelain', 'porcelain', 'plastic', 'plastic']);
    expect(itemPhysics(RAMEN)).toMatchObject({shape: 'cylinder', mat: 'stone'});
  });

  // the cooked GLBs come from lane ASSET-A (merged by the lead): checked here once they are in the tree
  for (const id of SKYWAYS_EDIBLE_IDS) {
    const file = path.join(PUB, FILES[id]);
    it.skipIf(!fs.existsSync(file))(`${id}: the delivered model is at ITEM_DIMS size (+-1 cm), grounded, centred; its byte hint is close`, async () => {
      const g = await loadStripped(FILES[id]);
      g.scene.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(g.scene), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      expect(Math.abs(s.x - ITEM_DIMS[id].w), id).toBeLessThan(0.01);
      expect(Math.abs(s.y - ITEM_DIMS[id].h), id).toBeLessThan(0.01);
      expect(Math.abs(s.z - ITEM_DIMS[id].d), id).toBeLessThan(0.01);
      expect(Math.abs(b.min.y), id).toBeLessThan(0.005);
      expect(Math.hypot(c.x, c.z), id).toBeLessThan(0.01);
      const bytes = fs.statSync(file).size, hint = MODEL_FILES[`item_${id}` as keyof typeof MODEL_FILES].bytes;
      expect(Math.abs(bytes - hint) / bytes, id).toBeLessThan(0.6);
    });
  }

  it('first-person use: the bowl is lifted to the lips and tipped, the bento held lower and nibbled, the cup drunk like a bottle', () => {
    const make = (id: string) => () => {
      const D = ITEM_DIMS[id], g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(D.w, D.h, D.d));
      m.position.y = D.h / 2;
      g.add(m);
      return g;
    };
    const topAt = (cv: ConsumeView, id: string) => {
      const o = cv.group.children[0];
      return new THREE.Vector3(0, ITEM_DIMS[id].h, 0).applyQuaternion(o.quaternion).add(o.position);
    };
    const want: Record<string, THREE.Vector3> = {
      [RAMEN]: new THREE.Vector3(0.015, -0.06, -0.19), [RAMEN_CHASHU]: new THREE.Vector3(0.015, -0.06, -0.19),
      [SUSHI_BENTO]: new THREE.Vector3(0.01, -0.08, -0.22), [BUBBLE_TEA]: new THREE.Vector3(0.015, -0.045, -0.14),
    };
    for (const id of SKYWAYS_EDIBLE_IDS) {
      const cv = new ConsumeView({camera: new THREE.Object3D(), setHolstered() {}}, make(id));
      cv.start(id, itemDef(id).useTime!, 'empty');
      for (let t = 0; t < 0.35; t += DT) cv.update(DT);
      expect(cv.phase, id).toBe('use');
      expect(topAt(cv, id).distanceTo(want[id]), id).toBeLessThan(0.035);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// the kitchen kinds

describe('Skyways ramen kitchen kinds: classified, real size, level-only models', () => {
  it('range: anchored, collision to its cooktop; stock pot / saucepan / mascot: dynamic on-host decor with plausible masses', () => {
    for (const k of SKYWAYS_KITCHEN_KINDS) {
      expect(PROP_DEFS[k], k).toBeTruthy();
      const r = PROP_PHYSICS_AUDIT[k];
      expect(r, k).toMatchObject({kind: k, src: 'skyways'});
      expect(r.how.length, k).toBeGreaterThan(30);
      expect(propDamageSpec(k).breaks, k).toBe('never');
    }
    expect(PROP_PHYSICS_AUDIT.skywaysRange).toMatchObject({cls: 'static', why: 'anchored'});
    expect(dynamicKind('skywaysRange')).toBe(false);
    const m = (k: keyof typeof SKYWAYS_FOOD_MODELS) => SKYWAYS_FOOD_MODELS[k];
    expect(PROP_DEFS.skywaysRange.w).toBeCloseTo(m('skyways_commercial_range').w, 3);
    expect(PROP_DEFS.skywaysRange.d).toBeCloseTo(m('skyways_commercial_range').d, 3);
    expect(PROP_DEFS.skywaysRange.h).toBe(SKYWAYS_RANGE_COOKTOP_Y);
    expect(m('skyways_commercial_range').h, 'the model rises above the cooktop (backguard / shelf)').toBeGreaterThan(SKYWAYS_RANGE_COOKTOP_Y + 0.3);
    expect(SKYWAYS_RANGE_COOKTOP_Y).toBeGreaterThan(0.88);
    expect(SKYWAYS_RANGE_COOKTOP_Y).toBeLessThan(0.98);
    expect(m('skyways_commercial_range').w).toBeCloseTo(1.52, 2);
    for (const [k, mass] of [['skywaysStockPot', 3.5], ['skywaysSaucepan', 1.3], ['skywaysSushiMascot', 0.8]] as const) {
      expect(dynamicKind(k), k).toBe(true);
      expect(propPhysics(k), k).toMatchObject({dynamic: true, onHost: true, contact: true, mass});
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({cls: 'dynamic', onHost: true, contact: true, mass});
    }
    // real sizes (ASSET-A targets): stock pot 0.42 m wide with its handles, saucepan 0.46 m long with its handle, figurine 0.32 m tall
    expect(PROP_DEFS.skywaysStockPot.w).toBeCloseTo(0.42, 2);
    expect(PROP_DEFS.skywaysSaucepan.w).toBeCloseTo(0.46, 2);
    expect(PROP_DEFS.skywaysSushiMascot.h).toBeCloseTo(0.32, 2);
    expect(propDamageSpec('skywaysRange').cls).toBe('steel');
  });

  it('openables audit: the range\'s oven doors and the pot\'s lid are explicit exceptions with their reasons; the pan / figurine have nothing to open', () => {
    const row = (k: string) => OPENABLE_AUDIT.filter(e => e.kind === k);
    for (const k of SKYWAYS_KITCHEN_KINDS) expect(row(k).length, k).toBe(1);
    expect(row('skywaysRange')[0]).toMatchObject({cls: 'exception', role: 'equipment'});
    expect(row('skywaysRange')[0].how).toMatch(/oven doors/);
    expect(row('skywaysStockPot')[0]).toMatchObject({cls: 'exception'});
    expect(row('skywaysSaucepan')[0].cls).toBe('none');
    expect(row('skywaysSushiMascot')[0].cls).toBe('none');
  });

  it('models: lazy skyways-* keys / files (level-only by name), requested only for a layout that placed the kinds', () => {
    const want: Record<string, string> = {
      skywaysRange: 'skyways-commercial-range', skywaysStockPot: 'skyways-stock-pot', skywaysSaucepan: 'skyways-saucepan', skywaysSushiMascot: 'skyways-sushi-mascot',
    };
    for (const k of SKYWAYS_KITCHEN_KINDS) {
      expect(skywaysKitchenModelKey(k)).toBe(want[k]);
      expect(SKYWAYS_KITCHEN_MODEL_FILES[want[k]].url).toBe(`assets/models/${want[k]}.glb`);
      expect((MODEL_FILES as Record<string, unknown>)[want[k]], 'never a boot file').toBeUndefined();
    }
    expect(skywaysKitchenModelKeysFor({props: [{kind: 'shopCounter'}, {kind: 'skywaysRange'}, {kind: 'skywaysStockPot'}, {kind: 'skywaysRange'}]})).toEqual(['skyways-commercial-range', 'skyways-stock-pot']);
    expect(skywaysKitchenModelKeysFor({props: [{kind: 'bench'}]})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// the purposes / tables

const ROWS = new Map<string, Set<string>>([
  ['shopCounter', new Set(RAMEN_COUNTER.items.map(r => r[0]))], ['shopCooler', new Set(RAMEN_COOLER.items.map(r => r[0]))],
  ['fridge', new Set(RAMEN_FRIDGE.items.map(r => r[0]))], ['default', new Set(RAMEN_KITCHEN.items.map(r => r[0]))],
]);
const rowsFor = (kind: string) => ROWS.get(kind) ?? ROWS.get('default')!;

describe('Skyways ramen purposes: preset loot keys, exact small finite tables', () => {
  it('both purposes are weight-0 presets with the RAMEN_* named tables; the cooler holds drinks only', () => {
    for (const id of [SKYWAYS_RAMEN_PURPOSE.dining, SKYWAYS_RAMEN_PURPOSE.kitchen]) {
      const p = purposeById(id) as unknown as {weight: number; max: number; props: unknown[]; loot: Record<string, unknown>; theme: string};
      expect(p, id).toMatchObject({weight: 0, max: 0, theme: 'food'});
      expect(p.props).toEqual([]);
      expect(p.loot).toMatchObject({shopCounter: RAMEN_COUNTER, shopCooler: RAMEN_COOLER, fridge: RAMEN_FRIDGE, default: RAMEN_KITCHEN});
    }
    for (const t of [RAMEN_COUNTER, RAMEN_COOLER, RAMEN_FRIDGE, RAMEN_KITCHEN]) {
      expect(t.exact).toBe(true);
      expect(t.lots![1]).toBeLessThanOrEqual(2);
      expect(t.empty).toBeGreaterThanOrEqual(0.3);
    }
    for (const [id] of RAMEN_COOLER.items) expect(econCat(id), id).toBe('drink');
    expect(RAMEN_LOOSE_ROWS.map(r => r[0]).sort()).toEqual([...SKYWAYS_EDIBLE_IDS].sort());
  });

  it('a restaurant holder rolls only its table (exact: no scarcity re-theme), one or two lots at most', () => {
    for (const kind of ['shopCounter', 'shopCooler', 'fridge', 'shopBackbar', 'shelf', 'foodCourtTableSet'] as HolderKind[]) {
      const t = holderTable(kind, SKYWAYS_RAMEN_PURPOSE.dining);
      expect(t.exact, kind).toBe(true);
      let n = 0, full = 0;
      for (let i = 0; i < 160; i++) {
        const f = holderFinds(20261106, i, kind, SKYWAYS_RAMEN_PURPOSE.dining);
        expect(f.length, kind).toBeLessThanOrEqual(2);
        for (const e of f) { expect(rowsFor(kind).has(e.itemId), `${kind}: ${e.itemId}`).toBe(true); expect(e.count).toBe(1); }
        n += f.length; full += f.length ? 1 : 0;
      }
      expect(full, kind).toBeGreaterThan(20); // not always empty
      expect(n / 160, kind).toBeLessThan(1.6); // a treat, not a food fountain
    }
  });
});

// ---------------------------------------------------------------------------------------------
// the dressing on a synthetic carved restaurant

interface Rooms { layout: StationLayout; dining: Area; kitchen?: Area; floor: number }

/**
 * A corridor (north), the dining room (dW x dD m) south of it through a 2 m door, and (optional) a kitchen south of the dining room
 * through a 1.5 m door; 1-cell walls. `level` 1 = a raised storey (floor 5 m): layout.levels with an empty main level under it.
 */
function restaurant(o: {dW?: number; dD?: number; kitchen?: boolean; level?: 0 | 1; seed?: number} = {}): Rooms {
  const dW = Math.round((o.dW ?? 11) / CELL), dD = Math.round((o.dD ?? 9) / CELL), kD = 12, W = dW + 12, H = 9 + dD + 1 + kD + 4;
  const lv = o.level ?? 0, floor = lv ? 5 : 0;
  const g0 = new Grid(W, H), g = lv ? new Grid(W, H) : g0;
  for (let i = 0; i < W * H; i++) { g0.cells[i] = SOLID; g.cells[i] = SOLID; }
  const areas: Area[] = [];
  const area = (id: number, x: number, y: number, w: number, h: number, kind: string, type: string, label: string): Area => {
    const a = {id, x, y, w, h, kind, type, label, ceil: floor + 3.5, parent: id ? 0 : -1, depth: id ? 1 : 0, publicSpace: id === 0, lighting: 'lit',
      ...(lv ? {level: lv, floorY: floor} : {})} as unknown as Area;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = g.idx(xx, yy); g.cells[i] = FLOOR; g.area[i] = id; g.ceil[i] = floor + 3.5; g.floor[i] = floor; }
    areas.push(a);
    return a;
  };
  area(0, 2, 2, W - 4, 6, 'hall', 'concourse', 'Skyway');
  const dining = area(1, 6, 9, dW, dD, 'room', 'eatery', 'Ramen bar');
  const kitchen = o.kitchen === false ? undefined : area(2, 6, 9 + dD + 1, dW, kD, 'room', 'utility', 'Kitchen');
  const doors = [{id: 0, a: 0, b: 1, x: 6 + Math.floor(dW / 2) - 2, y: 8, w: 4, h: 1, height: 2.2, arch: false}];
  if (kitchen) doors.push({id: 1, a: 1, b: 2, x: 8, y: 9 + dD, w: 3, h: 1, height: 2.1, arch: false});
  for (const d of doors) for (let yy = d.y; yy < d.y + d.h; yy++) for (let xx = d.x; xx < d.x + d.w; xx++) { const i = g.idx(xx, yy); g.cells[i] = FLOOR; g.area[i] = d.b; g.ceil[i] = floor + 2.2; g.floor[i] = floor; }
  const layout = {
    seed: o.seed ?? 7, name: 'ramen test', props: [], grid: g0, areas, doors: doors.map(d => (lv ? {...d, level: lv} : d)),
    playerSpawn: {x: 4, z: 2, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [], trench: {floorY: -1.15}, trenches: [],
    ...(lv ? {levels: [{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role: 'upper', grid: g, baseY: 5}], levelLinks: []} : {}),
  } as unknown as StationLayout;
  return {layout, dining, kitchen, floor};
}

const inRect = (a: Area, x: number, z: number, m = 0) => x >= a.x * CELL + m - 1e-6 && x <= (a.x + a.w) * CELL - m + 1e-6 && z >= a.y * CELL + m - 1e-6 && z <= (a.y + a.h) * CELL - m + 1e-6;
/** World point -> host-local (x, z). */
function local(host: PropPlacement, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
const topOf = (p: PropPlacement) => (p.kind === 'shopCounter' ? SHOP_COUNTER_TOP_Y : PROP_DEFS[p.kind].h);

function dress(o: Parameters<typeof restaurant>[0] & {frame?: 'absolute' | 'local'} = {}): Rooms & {res: RamenDressResult} {
  const r = restaurant(o);
  const res = dressSkywaysRamen(r.layout, new Rng(o.seed ?? 7).fork('ramen'), {dining: r.dining, kitchen: r.kitchen, level: o.level ?? 0, frame: o.frame});
  return {...r, res};
}

describe('dressSkywaysRamen on a carved dining room + kitchen', () => {
  const SEEDS = Array.from({length: 24}, (_, i) => i + 1);

  it('every seed: a counter facing the entry with the sushi mascot on its top, a drinks cooler, café seating, the kitchen kit', () => {
    let coolers = 0, pans = 0, sets = 0;
    for (const seed of SEEDS) {
      const {layout, dining, kitchen, res} = dress({seed});
      const tag = `seed ${seed}`;
      expect(res.counter.length, tag).toBeGreaterThanOrEqual(2);
      for (const c of res.counter) {
        expect(c.kind).toBe('shopCounter');
        expect(c.purpose).toBe(SKYWAYS_RAMEN_PURPOSE.dining);
        expect(Math.abs(Math.sin(c.rot)) < 1e-6 && Math.cos(c.rot) < 0, `${tag}: faces the entry (north)`).toBe(true);
      }
      // the mascot stands on a counter's top, its span cut out of the counter's loot surface
      const m = res.mascot!;
      expect(m, tag).toBeTruthy();
      const host = layout.props[m.host!];
      expect(host.kind).toBe('shopCounter');
      expect(m.y).toBeCloseTo(host.y + SHOP_COUNTER_TOP_Y, 6);
      const [lx, lz] = local(host, m.x, m.z);
      expect(Math.abs(lx) + PROP_DEFS.skywaysSushiMascot.w / 2).toBeLessThanOrEqual(PROP_DEFS.shopCounter.w / 2 + 1e-6);
      expect(Math.abs(lz) + PROP_DEFS.skywaysSushiMascot.d / 2).toBeLessThanOrEqual(PROP_DEFS.shopCounter.d / 2 + 1e-6);
      expect(host.cut!.some(c => c.x0 <= lx - 0.12 && c.x1 >= lx + 0.12), tag).toBe(true);
      if (res.cooler) { coolers++; expect(res.cooler).toMatchObject({kind: 'shopCooler', purpose: SKYWAYS_RAMEN_PURPOSE.dining}); }
      expect(res.tables.length + res.sets.length, tag).toBeGreaterThanOrEqual(2);
      sets += res.sets.length;
      for (const t of res.tables) expect(t.kind).toBe('cafeBistroTable');
      for (const c of res.chairs) expect(c.kind).toBe('cafeChair');
      expect(res.chairs.length, tag).toBeGreaterThanOrEqual(res.tables.length);
      // kitchen: the range against a wall, the stock pot (and usually the saucepan) on its cooktop, the holders keyed to the restaurant
      const range = res.range!;
      expect(range, tag).toBeTruthy();
      expect(inRect(kitchen!, range.x, range.z), tag).toBe(true);
      expect(res.cookware.some(p => p.kind === 'skywaysStockPot'), tag).toBe(true);
      pans += res.cookware.filter(p => p.kind === 'skywaysSaucepan').length;
      for (const p of res.cookware) {
        expect(layout.props[p.host!], tag).toBe(range);
        expect(p.y).toBeCloseTo(range.y + range.h, 6);
        const [px, pz] = local(range, p.x, p.z);
        expect(Math.abs(px) + PROP_DEFS[p.kind].w / 2, `${tag} ${p.kind}`).toBeLessThanOrEqual(PROP_DEFS.skywaysRange.w / 2 + 1e-6);
        expect(Math.abs(pz) + PROP_DEFS[p.kind].d / 2, `${tag} ${p.kind}`).toBeLessThanOrEqual(PROP_DEFS.skywaysRange.d / 2 + 1e-6);
      }
      if (res.cookware.length === 2) {
        const [a, b] = res.cookware;
        expect(Math.abs(a.x - b.x) >= a.hx + b.hx - 1e-6 || Math.abs(a.z - b.z) >= a.hz + b.hz - 1e-6, `${tag}: pot / pan apart`).toBe(true);
      }
      expect(res.kitchen.map(p => p.kind), tag).toEqual(expect.arrayContaining(['shopBackbar', 'fridge']));
      for (const p of res.kitchen) expect(p.purpose).toBe(SKYWAYS_RAMEN_PURPOSE.kitchen);
      expect(dining.purpose).toBe(SKYWAYS_RAMEN_PURPOSE.dining);
      expect(kitchen!.purpose).toBe(SKYWAYS_RAMEN_PURPOSE.kitchen);
      expect(res.skipped.filter(s => !/stock pot|saucepan|shelf|cooler|table set/.test(s)), tag).toEqual([]);
    }
    expect(coolers).toBeGreaterThan(SEEDS.length * 0.8);
    expect(pans).toBeGreaterThan(SEEDS.length * 0.5);
    expect(sets).toBeGreaterThan(0);
  });

  it('floor props stand inside their room on free floor, never overlapping; both rooms stay connected (every door reached)', () => {
    for (const seed of SEEDS) {
      const {layout, dining, kitchen, res} = dress({seed});
      const floorProps = res.props.filter(p => p.host === undefined);
      for (const p of floorProps) {
        const a = layout.areas[p.area];
        expect(a === dining || a === kitchen, `seed ${seed} ${p.kind} area`).toBe(true);
        expect(inRect(a, p.x - p.hx, p.z - p.hz) && inRect(a, p.x + p.hx, p.z + p.hz), `seed ${seed} ${p.kind} inside its room`).toBe(true);
      }
      for (let i = 0; i < floorProps.length; i++) for (let j = i + 1; j < floorProps.length; j++) {
        const a = floorProps[i], b = floorProps[j];
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        expect(ox <= 0.02 || oz <= 0.02, `seed ${seed}: ${a.kind} / ${b.kind} overlap`).toBe(true);
      }
      const ctx = makePlaceCtx(layout, new Rng(1), 0);
      expect(areaConnected(ctx, dining), `seed ${seed} dining connected`).toBe(true);
      expect(areaConnected(ctx, kitchen!), `seed ${seed} kitchen connected`).toBe(true);
    }
  });

  it('2-4 loose edible pickups, each standing supported on a table / the counter, none overlapping another or the mascot', () => {
    const seen = new Map<string, number>();
    for (const seed of SEEDS) {
      const {layout, res} = dress({seed});
      expect(res.pickups.length, `seed ${seed}`).toBeGreaterThanOrEqual(RAMEN_LOOSE[0]);
      expect(res.pickups.length, `seed ${seed}`).toBeLessThanOrEqual(RAMEN_LOOSE[1]);
      expect(layout.pickups).toEqual(res.pickups);
      expect(res.pickupIndex).toEqual(res.pickups.map((_, i) => i));
      const r = (id: string) => Math.hypot(ITEM_DIMS[id].w, ITEM_DIMS[id].d) / 2;
      for (const pk of res.pickups) {
        seen.set(pk.itemId, (seen.get(pk.itemId) ?? 0) + 1);
        expect(SKYWAYS_EDIBLE_IDS, pk.itemId).toContain(pk.itemId);
        expect(pk.count).toBe(1);
        // supported: a table / counter whose top it stands on, wholly over that top
        const host = layout.props.find(q => (q.kind === 'cafeBistroTable' || q.kind === 'shopCounter') && Math.abs(pk.y - (q.y + topOf(q))) < 1e-6
          && Math.abs(pk.x - q.x) <= q.hx && Math.abs(pk.z - q.z) <= q.hz);
        expect(host, `seed ${seed}: ${pk.itemId} at y ${pk.y} rests on nothing`).toBeTruthy();
        const [lx, lz] = local(host!, pk.x, pk.z);
        const half = host!.kind === 'cafeBistroTable' ? PROP_DEFS.cafeBistroTable.w / 2 : Math.min(PROP_DEFS.shopCounter.w, PROP_DEFS.shopCounter.d) / 2;
        if (host!.kind === 'cafeBistroTable') expect(Math.hypot(lx, lz) + r(pk.itemId), `seed ${seed} ${pk.itemId} on the disc`).toBeLessThanOrEqual(half + 1e-6);
        else {
          expect(Math.abs(lx) + ITEM_DIMS[pk.itemId].w / 2).toBeLessThanOrEqual(PROP_DEFS.shopCounter.w / 2);
          expect(Math.abs(lz) + r(pk.itemId)).toBeLessThanOrEqual(half + 1e-6);
          // its span is cut out of the counter's loot surface (no lot is packed under it)
          expect(host!.cut!.some(c => c.x0 <= lx - ITEM_DIMS[pk.itemId].w / 2 && c.x1 >= lx + ITEM_DIMS[pk.itemId].w / 2), `seed ${seed}: cut`).toBe(true);
        }
        if (res.mascot && host === layout.props[res.mascot.host!]) {
          const [mx] = local(host!, res.mascot.x, res.mascot.z);
          expect(Math.abs(mx - lx), `seed ${seed}: clear of the mascot`).toBeGreaterThanOrEqual((PROP_DEFS.skywaysSushiMascot.w + ITEM_DIMS[pk.itemId].w) / 2);
        }
      }
      for (let i = 0; i < res.pickups.length; i++) for (let j = i + 1; j < res.pickups.length; j++) {
        const a = res.pickups[i], b = res.pickups[j];
        if (Math.abs(a.y - b.y) > 0.05) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `seed ${seed}: ${a.itemId} / ${b.itemId} overlap`).toBeGreaterThanOrEqual(r(a.itemId) + r(b.itemId) - 0.02);
      }
    }
    for (const id of SKYWAYS_EDIBLE_IDS) expect(seen.get(id) ?? 0, `${id} appears`).toBeGreaterThan(0);
  });

  it('the restaurant\'s holders roll the restaurant\'s tables; counter lots never lie under the mascot or a loose pickup', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const {layout, res} = dress({seed});
      let index = 0;
      for (const p of res.props) {
        if (!isLootHolderKind(p.kind)) continue;
        expect(p.purpose, `${p.kind} keyed`).toMatch(/^skyways-ramen/);
        for (const f of holderFinds(layout.seed, index++, p.kind as HolderKind, p.purpose!)) expect(rowsFor(p.kind).has(f.itemId), `${p.kind}: ${f.itemId}`).toBe(true);
      }
      for (const [i, c] of res.counter.entries()) {
        const st = createHolderState(layout.seed + i, i, 'shopCounter', c.purpose!, cutSurfaces(holderSurfaces('shopCounter', PROP_DEFS.shopCounter), c.cut));
        for (const lot of st.lots) {
          const hw = Math.min(ITEM_DIMS[lot.itemId].w, ITEM_DIMS[lot.itemId].d) / 2;
          for (const cut of c.cut ?? []) expect(lot.x + hw <= cut.x0 + 0.03 || lot.x - hw >= cut.x1 - 0.03, `seed ${seed}: lot under a cut span`).toBe(true);
        }
      }
    }
  });

  it('deterministic per seed; a different seed changes the room', () => {
    const a = dress({seed: 5}), b = dress({seed: 5}), c = dress({seed: 6});
    expect(JSON.stringify(a.layout.props)).toBe(JSON.stringify(b.layout.props));
    expect(JSON.stringify(a.layout.pickups)).toBe(JSON.stringify(b.layout.pickups));
    expect(JSON.stringify(a.layout.props) === JSON.stringify(c.layout.props) && JSON.stringify(a.layout.pickups) === JSON.stringify(c.layout.pickups)).toBe(false);
  });

  it('a raised storey: absolute frame lifts every prop onto the 5 m floor (decor with its host); local frame leaves them for liftLevels; pickups are absolute', () => {
    for (const seed of [3, 11]) {
      const abs = dress({seed, level: 1});
      expect(abs.res.props.length).toBeGreaterThan(8);
      for (const p of abs.res.props) {
        expect(p.level, p.kind).toBe(1);
        if (p.host === undefined) expect(p.y, p.kind).toBeCloseTo(5, 6);
        else { const h = abs.layout.props[p.host]; expect(p.y, p.kind).toBeCloseTo(h.y + topOf(h), 6); }
      }
      for (const pk of abs.res.pickups) { expect(pk.level).toBe(1); expect(pk.y).toBeGreaterThan(5.7); }
      const loc = dress({seed, level: 1, frame: 'local'});
      expect(loc.res.props.map(p => [p.kind, p.x, p.z])).toEqual(abs.res.props.map(p => [p.kind, p.x, p.z]));
      for (const p of loc.res.props) if (p.host === undefined) expect(p.y, p.kind).toBeCloseTo(0, 6);
      expect(loc.res.pickups).toEqual(abs.res.pickups);
    }
  });

  it('no kitchen: the dining kit alone; a cramped dining room: the counter backs onto the wall, what cannot fit is skipped (never forced)', () => {
    const solo = dress({seed: 4, kitchen: false});
    expect(solo.res.range).toBeNull();
    expect(solo.res.props.some(p => p.kind === 'skywaysRange' || p.kind === 'fridge')).toBe(false);
    expect(solo.res.counter.length).toBeGreaterThan(0);
    expect(solo.res.pickups.length).toBeGreaterThanOrEqual(RAMEN_LOOSE[0]);
    // a shallow room (no space for a staff aisle): the counter backs onto the far wall, its back 3 cm off the wall face
    const shallow = dress({seed: 4, dW: 6, dD: 4});
    expect(shallow.res.counter.length).toBeGreaterThan(0);
    const c = shallow.res.counter[0], back = (shallow.dining.y + shallow.dining.h) * CELL;
    expect(Math.abs(c.z + PROP_DEFS.shopCounter.d / 2 + 0.03 - back)).toBeLessThan(0.02);
    expect(shallow.res.pickups.length).toBeLessThanOrEqual(RAMEN_LOOSE[1]);
    for (const tiny of [shallow, dress({seed: 9, dW: 3.5, dD: 3.5})]) {
      const ctx = makePlaceCtx(tiny.layout, new Rng(1), 0);
      expect(areaConnected(ctx, tiny.dining)).toBe(true);
      expect(tiny.res.pickups.length).toBeLessThanOrEqual(RAMEN_LOOSE[1]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// physics: the cookware / figurine move, the range does not

describe('movable things move: cookware and the figurine go loose on their static host under fire', () => {
  const run = (ph: PhysicsSystem, s: number, each?: () => void) => { for (let t = 0; t < s - 1e-9; t += DT) { ph.update(DT); each?.(); } };
  for (const [hostKind, kind] of [['skywaysRange', 'skywaysStockPot'], ['skywaysRange', 'skywaysSaucepan'], ['shopCounter', 'skywaysSushiMascot']] as const) {
    it(`a ${kind} on a ${hostKind} is shot off its top (host-top slab), never sinks into it, and settles`, () => {
      const hd = PROP_DEFS[hostKind], top = hostKind === 'shopCounter' ? SHOP_COUNTER_TOP_Y : hd.h, d = PROP_DEFS[kind];
      const host: PropPlacement = {kind: hostKind, x: 6, z: 3, y: 0, rot: 0, area: 0, hx: hd.w / 2, hz: hd.d / 2, h: hd.h, blocksSight: false, variant: 0};
      const prop: PropPlacement = {kind, x: host.x + 0.3, z: host.z, y: top, rot: 0, area: 0, hx: d.w / 2, hz: d.d / 2, h: d.h, blocksSight: false, variant: 0, host: 0};
      const g = new Grid(48, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 1 || y < 2 || x >= 47 || y >= 31 ? SOLID : FLOOR);
      const ph = new PhysicsSystem(null);
      ph.build({grid: g, props: [host, prop], trench: {floorY: -1.15}} as never);
      ph.dynamicItems.contactWake = true;
      const meshes = new Map<PropPlacement, THREE.Mesh>();
      ph.dynamicItems.detacher = {detachForPhysics: (p: PropPlacement) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
        m.matrixAutoUpdate = false;
        m.matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        meshes.set(p, m);
        return [m];
      }} as never;
      expect(ph.dynamicItems.isDynamicProp(prop)).toBe(true);
      expect(ph.dynamicItems.isDynamicProp(host)).toBe(false);
      // a close buckshot blast (9 x 15 damage) on the cookware; two pellets on the light figurine
      const j = kind === 'skywaysSushiMascot' ? PELLET * 2 : PELLET * 9;
      const start = new THREE.Vector3(prop.x, top, prop.z); // (a loose prop's placement follows its body: keep the start pose)
      expect(ph.dynamicItems.shootProp(prop, 1, new THREE.Vector3(prop.x - d.w / 2, prop.y + d.h * 0.5, prop.z), new THREE.Vector3(1, -0.05, 0).normalize(), j)).toBe(true);
      expect(ph.dynamicItems.stats().counts.hostSlabs).toBe(1);
      let inside = false;
      run(ph, 8, () => {
        const at = new THREE.Vector3().setFromMatrixPosition(meshes.get(prop)!.matrix);
        if (Math.abs(at.x - host.x) < host.hx - 0.05 && Math.abs(at.z - host.z) < host.hz - 0.05 && at.y < top - 0.06 && at.y > 0.08) inside = true;
      });
      const end = new THREE.Vector3().setFromMatrixPosition(meshes.get(prop)!.matrix);
      expect(inside, 'sank into its host').toBe(false);
      expect(end.distanceTo(start), 'it moved').toBeGreaterThan(0.1);
      expect(end.y > top - 0.06 || end.y < 0.35, 'on the top or on the floor').toBe(true);
      expect(ph.dynamicItems.stats().propsAwake).toBe(0);
      expect(host.h, 'the host stays a static obstacle').toBe(hd.h);
    });
  }
});
