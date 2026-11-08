// Task studio-market-rework-20261108-074144-01 (lane TRADE): RAIL TIES AS A PHYSICAL ITEM (items/railTies.ts) — user: "rail ties should be a
// physical item that sits in your inventory, max stack size 1,000." Its own kind ('currency'): passive, pockets first, never loot / never
// generated / never stock / never traded for itself; every stack validator (inventory, Lockbox, saves: carry, Lockbox, train cargo) accepts
// 1000 to a stack and refuses 1001; the world / icon model is code-built from the track sleeper (TRACK_SLEEPER = the builder's sleeperGeo)
// on the sleeper's own timber surface set, grounded inside its ITEM_DIMS.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {ITEMS, ITEM_DIMS, itemDef} from '../src/items/items';
import {CURRENCY_NOTE, RAIL_TIES_ID, RAIL_TIES_STACK, isCurrencyItem} from '../src/items/railTies';
import {Inventory, type SlotRef} from '../src/items/inventory';
import {econCat, GEAR_WEIGHTS, GLOBAL_POOL, LEGACY_POOL, LIMB_ECONOMY} from '../src/items/lootTables';
import {devGrantBundle} from '../src/items/devGrant';
import {TrainLockbox} from '../src/run/trainLockbox';
import {TrainCargo, type CargoItemJSON} from '../src/run/trainCargo';
import {ITEM_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import {ICONS} from '../src/ui/icons';
import {surface} from '../src/world/canvasTextures';
import {RAIL_TIES_BUNDLE, RAIL_TIES_MODEL_SOURCE, TRACK_SLEEPER, railTiesModel} from '../src/world/railTiesModel';
import {itemModelSources, itemTemplate} from '../src/world/pickups';
import {makeSaveFile} from '../src/save/serialize';
import {validateSaveFile} from '../src/save/validate';
import {Harness} from './helpers/saveFixture';

installCanvasShim(false);

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const SRC = join(__dirname, '../src');
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });

describe('Rail Ties: the item', () => {
  it('is its own kind (currency), stacks to 1000, has an icon / damage class / physics, and a passive detail line', () => {
    const d = itemDef(RAIL_TIES_ID);
    expect([d.kind, d.stackMax, d.name, d.short, RAIL_TIES_STACK]).toEqual(['currency', 1000, 'Rail Ties', 'Ties', 1000]);
    expect(Object.values(ITEMS).filter(x => x.kind === 'currency').map(x => x.id)).toEqual([RAIL_TIES_ID]);
    expect(isCurrencyItem(RAIL_TIES_ID) && !isCurrencyItem('scrap_metal')).toBe(true);
    expect(d.description).toMatch(/railroad track ties/);
    expect(d.description).not.toMatch(/coin|scrip|chit/i);
    expect(ICONS[d.icon]).toMatch(/^<svg/);
    expect([ITEM_CLASS[RAIL_TIES_ID], ITEM_PHYSICS[RAIL_TIES_ID].mat, ITEM_PHYSICS[RAIL_TIES_ID].mass > 1]).toEqual(['wood', 'wood', true]);
    expect(CURRENCY_NOTE).toMatch(/quick slots and pockets/);
  });

  it('is never a loot / salvage category, in no loot pool, generator or dev drop (only trades and the old-balance migration make it)', () => {
    expect(econCat(RAIL_TIES_ID)).toBeNull();
    const rows = [...Object.values(GLOBAL_POOL).flat(), ...Object.values(LEGACY_POOL).flat(), ...LIMB_ECONOMY.pool, ...Object.entries(GEAR_WEIGHTS)];
    expect(rows.some(r => r[0] === RAIL_TIES_ID)).toBe(false);
    expect(devGrantBundle().some(l => l.itemId === RAIL_TIES_ID)).toBe(false);
    // no generator / loot module names it at all
    const offenders = walk(SRC).filter(f => /[\\/](gen|items[\\/]loot)/.test(f) && /rail_ties|RAIL_TIES|railTies/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('goes to the pockets first; stacks hold 1000 (make / add / merge split at 1000); 1001 is never a stack', () => {
    const inv = new Inventory();
    expect(inv.makeStack(RAIL_TIES_ID, 5000).count).toBe(1000);
    expect(inv.add({uid: inv.allocUid(), itemId: RAIL_TIES_ID, count: 2300})).toBe(0);
    expect(inv.pack.slice(0, 3).map(s => s?.count)).toEqual([1000, 1000, 300]);
    expect(inv.hotbar.every(s => s === null)).toBe(true);
    inv.set(H(0), inv.makeStack(RAIL_TIES_ID, 800));
    expect(inv.moveCount(H(0), P(2))).toBe('merged'); // 300 + 800: 1000 there, 100 left behind
    expect([inv.get(P(2))!.count, inv.get(H(0))!.count]).toEqual([1000, 100]);
    expect(inv.invariants()).toEqual([]);
    inv.get(P(0))!.count = 1001;
    expect(inv.invariants()).toContain(`bad count ${RAIL_TIES_ID}:1001`);
  });

  it('every store keeps it: a backpack, the Lockbox (1000 kept, 1001 dropped by the sanitising loader), the train cargo', () => {
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack(RAIL_TIES_ID, 1000);
    expect(inv.wearBag(bag)).toBe(true);
    expect(inv.invariants()).toEqual([]);
    const box = new TrainLockbox();
    box.load({v: 1, slots: [{uid: 7, itemId: RAIL_TIES_ID, count: 1000}, {uid: 8, itemId: RAIL_TIES_ID, count: 1001}]});
    expect([box.slots[0]?.count, box.slots[1]]).toEqual([1000, null]);
    expect(box.invariants()).toEqual([]);
    // the cargo's add path: the stored records without a live system, the live pending path with one
    const rec: CargoItemJSON = {kind: 'item', stack: {uid: 9, itemId: RAIL_TIES_ID, count: 1000}, x: 1, y: 0.2, z: 0, q: [0, 0, 0, 1]};
    const cargo = new TrainCargo();
    cargo.add(rec);
    expect(cargo.records()).toEqual([rec]);
    const got: CargoItemJSON[] = [];
    cargo.live = {cargo: () => got, restore: () => {}, add: r => { got.push(r); }};
    cargo.add({...rec, stack: {...rec.stack, uid: 10}});
    expect(got.map(r => r.stack.uid)).toEqual([10]);
  });

  it('save validation: 1000 to a stack is legal carried, in the Lockbox and in the train cargo; 1001 is refused', () => {
    const h = new Harness();
    h.inv.set(P(0), h.inv.makeStack(RAIL_TIES_ID, 1000));
    h.train.lockbox.slots[0] = h.inv.makeStack(RAIL_TIES_ID, 1000);
    h.train.cargo.add({kind: 'item', stack: {uid: h.inv.allocUid(), itemId: RAIL_TIES_ID, count: 1000}, x: 1, y: 0.2, z: 0, q: [0, 0, 0, 1]});
    const file = h.file('arrival');
    expect(validateSaveFile(file).ok).toBe(true);
    const mutate = (f: (run: {carry: {inventory: {pack: {count: number}[]}}; participants: Record<string, {lockbox: {slots: {count: number}[]}; cargo: {items: {stack: {count: number}}[]}}>}) => void) => {
      const run = structuredClone(file.run) as never;
      f(run);
      return validateSaveFile(makeSaveFile(run, file.meta));
    };
    for (const f of [
      (r: Parameters<Parameters<typeof mutate>[0]>[0]) => { r.carry.inventory.pack[0].count = 1001; },
      (r: Parameters<Parameters<typeof mutate>[0]>[0]) => { r.participants['player-train'].lockbox.slots[0].count = 1001; },
      (r: Parameters<Parameters<typeof mutate>[0]>[0]) => { r.participants['player-train'].cargo.items[0].stack.count = 1001; },
    ]) {
      const v = mutate(f);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(/out of range/);
    }
  });
});

describe('Rail Ties: the world / icon model, code-built from the track sleeper', () => {
  it('four offcuts of the sleeper\'s section, strapped: grounded, centred, its ITEM_DIMS; pickups and icons use it', () => {
    const o = railTiesModel();
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const d = ITEM_DIMS[RAIL_TIES_ID];
    expect(Math.abs(b.min.y)).toBeLessThan(0.001);
    expect([Math.abs(c.x) < 0.005, Math.abs(c.z) < 0.005]).toEqual([true, true]);
    for (const [k, v] of [['w', size.x], ['h', size.y], ['d', size.z]] as const) {
      expect(v, k).toBeLessThanOrEqual(d[k] + 0.002);
      expect(v, k).toBeGreaterThan(d[k] - 0.004);
    }
    // the timber alone: exactly one sleeper's section (2 x 2 offcuts of half the section each, a hair apart)
    const timber = o.children.find(m => m.name === 'rail-ties-offcuts') as THREE.Mesh;
    const tb = new THREE.Box3().setFromObject(timber), ts = tb.getSize(new THREE.Vector3());
    expect([ts.z, ts.y].map(v => Math.round(v * 1000) / 1000)).toEqual([TRACK_SLEEPER.w, TRACK_SLEEPER.h]);
    expect(timber.geometry.attributes.position.count).toBe(4 * 36); // four boxes (merged non-indexed: 12 triangles each)
    expect(RAIL_TIES_BUNDLE.len).toBeLessThan(TRACK_SLEEPER.len / 6);
    // the sleeper's own surface set (the 'sleeper' material's maps), on the model's UVs (metres / span: never world-mapped on a pickup)
    const tm = timber.material as THREE.MeshStandardMaterial, s = surface('timberTie');
    expect([tm.map === s.map, tm.normalMap === s.normalMap]).toEqual([true, true]);
    const uv = timber.geometry.attributes.uv;
    let umax = 0;
    for (let i = 0; i < uv.count; i++) umax = Math.max(umax, uv.getX(i));
    expect(umax).toBeCloseTo(RAIL_TIES_BUNDLE.len / s.span[0], 3); // the long faces: u = metres along the offcut
    expect(itemTemplate(RAIL_TIES_ID).children.length).toBe(2);
    expect(itemModelSources()[RAIL_TIES_ID]).toBe(RAIL_TIES_MODEL_SOURCE);
  });

  it('the station builder\'s sleepers read the same TRACK_SLEEPER (one source for the sleeper and the ties bundle)', () => {
    const builder = readFileSync(join(SRC, 'world/builder.ts'), 'utf8');
    expect(builder).toMatch(/const sleeperGeo = new THREE\.BoxGeometry\(TRACK_SLEEPER\.w, TRACK_SLEEPER\.h, TRACK_SLEEPER\.len\)/);
    expect(TRACK_SLEEPER).toEqual({w: 0.24, h: 0.14, len: 2.5});
    expect(builder).toMatch(/mats\.get\('sleeper'\)/);
  });
});
