// Task office-overhaul-20261030 (lane INTERACT), user feedback #6: "you should be able to carry up to 10 flares in a stack. also
// introduce granade slot, flare can go in it. Throw grenade with 'G' key. Yes I know this is drop right now. Thats ok remove drop".
// Node tests over the real classes: items/inventory.ts (the grenade slot: fill-first pickup, validation, moves, counting, refill,
// snapshot v2 + the v1 migration), the G hold -> release -> exactly one flare thrown from the grenade slot (weapons/flareHold.ts
// + throwables.ts FlareSystem, as Game drives them), the bag transfer paths, the inventory screen's drop step (ui/inventoryUI.ts
// dropAt: drag in / drag out = drop), the HUD G slot (ui/hud.ts) and that the old G = drop binding / T hints are gone.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {INVENTORY_JSON_VERSION, Inventory, PACK_SIZE, THROW_REF, type InventoryJSON, type SlotRef} from '../src/items/inventory';
import {ITEMS, itemDef, throwHint} from '../src/items/items';
import {FlareHold, type FlareHoldInput} from '../src/weapons/flareHold';
import {FlareSystem, throwOneFlare} from '../src/weapons/throwables';
import {PhysicsSystem} from '../src/physics/world';
import {LightSources} from '../src/world/lightSources';
import {levelsOf} from '../src/gen/levels';
import {mulberry32} from '../src/core/rng';
import {FIX, levelFixture} from './helpers/levelFixture';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);

const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const flares = (inv: Inventory) => inv.count('flare');
const total = (inv: Inventory) => inv.allStacks(true).reduce((n, s) => n + (s.itemId === 'flare' ? s.count : 0), 0);

describe('flares stack to 10; the grenade slot fills first', () => {
  it('flare stackMax is 10 (the only throwable); the hint and description say G', () => {
    expect(itemDef('flare')).toMatchObject({kind: 'throwable', stackMax: 10});
    expect(Object.values(ITEMS).filter(d => d.kind === 'throwable').map(d => d.id)).toEqual(['flare']);
    expect(throwHint(itemDef('flare'))).toMatch(/G to ready/);
    expect(itemDef('flare').description).toMatch(/hold G/);
    expect(itemDef('flare').description).not.toMatch(/\bT\b/);
  });

  it('pickups merge into / fill the grenade slot first (same object when it fits whole), then the normal slots', () => {
    const inv = new Inventory();
    const a = inv.makeStack('flare', 4);
    expect(inv.add(a)).toBe(0);
    expect(inv.thrown).toBe(a); // same object, uid kept
    expect(inv.hotbar.every(s => !s) && inv.pack.every(s => !s)).toBe(true);
    expect(inv.add(inv.makeStack('flare', 5))).toBe(0); // merged
    expect(inv.thrown!.count).toBe(9);
    const c = inv.makeStack('flare', 3);
    expect(inv.add(c)).toBe(0); // 1 into the slot (10), 2 into a quick slot (throwables keep the hotbar-first order)
    expect(inv.thrown!.count).toBe(10);
    expect(inv.hotbar.find(s => s?.itemId === 'flare')?.count).toBe(2);
    expect([flares(inv), total(inv)]).toEqual([12, 12]);
    // 10 at once into an empty slot
    const inv2 = new Inventory();
    const ten = inv2.makeStack('flare', 10);
    expect(inv2.add(ten)).toBe(0);
    expect(inv2.thrown).toBe(ten);
    expect(inv2.invariants()).toEqual([]);
    expect(inv.invariants()).toEqual([]);
  });

  it('a different / full grenade slot leaves the normal order unchanged; non-throwables never go there', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('water', 2));
    inv.add(inv.makeStack('ammo_9mm', 30)); // lane AMMO: caliber id (the old ammo_pistol id still migrates)
    expect(inv.thrown).toBeNull();
    expect(inv.hasRoomFor('flare')).toBe(true);
    for (let i = 0; i < 5; i++) inv.set(H(i), inv.makeStack('bandage', 5));
    for (let i = 0; i < PACK_SIZE; i++) if (!inv.pack[i]) inv.set(P(i), inv.makeStack('chocolate', 6));
    expect(inv.hasRoomFor('water')).toBe(false);
    expect(inv.hasRoomFor('flare')).toBe(true); // the empty grenade slot
    expect(inv.add(inv.makeStack('flare', 10))).toBe(0);
    expect(inv.hasRoomFor('flare')).toBe(false);
    expect(inv.add(inv.makeStack('flare', 1))).toBe(1); // nowhere left: refused, nothing lost
    expect(inv.invariants()).toEqual([]);
  });
});

describe('grenade slot validation and moves (the inventory screen drag engine)', () => {
  it('takes only throwables: set / move / swap refused with a reason, a flare moves in and out (same object)', () => {
    const inv = new Inventory();
    const w = inv.makeStack('water', 1), f = inv.makeStack('flare', 3);
    inv.set(P(0), w);
    inv.set(P(1), f);
    inv.set(THROW_REF, w);
    expect(inv.refusal?.code).toBe('wrong-slot');
    expect(inv.thrown).toBeNull();
    expect(inv.moveCount(P(0), THROW_REF)).toBe('refused');
    expect(inv.refusal?.text).toMatch(/grenade slot/);
    expect(inv.moveCount(P(1), THROW_REF)).toBe('moved');
    expect(inv.thrown).toBe(f);
    expect(inv.moveCount(P(0), THROW_REF)).toBe('refused'); // a swap would put water in it
    expect(inv.moveCount(THROW_REF, P(0))).toBe('refused'); // ... and the swap back too
    expect(inv.moveCount(THROW_REF, P(5), 1)).toBe('split'); // shift-drag out
    expect([inv.thrown!.count, inv.pack[5]!.count]).toEqual([2, 1]);
    expect(inv.moveCount(P(5), THROW_REF)).toBe('merged');
    expect(inv.moveCount(THROW_REF, H(2))).toBe('moved'); // out to a quick slot
    expect(inv.hotbar[2]).toBe(f);
    const bag = inv.makeStack('backpack', 1);
    inv.set(THROW_REF, bag);
    expect(inv.thrown).toBeNull();
    expect(inv.invariants()).toEqual([]);
  });

  it('count / take / find / holds / allStacks / consumeAt / detach include it', () => {
    const inv = new Inventory();
    const f = inv.makeStack('flare', 4);
    inv.add(f);
    expect(inv.find(f.uid)).toEqual({bar: 'throw', index: 0});
    expect(inv.holds(f)).toBe(true);
    expect(inv.allStacks()).toContain(f);
    expect(inv.consumeAt(THROW_REF)).toBe(true);
    expect(f.count).toBe(3);
    expect(inv.take('flare', 1)).toBe(1);
    expect(flares(inv)).toBe(2);
    const piece = inv.detach(THROW_REF, 1)!;
    expect([piece.count, flares(inv)]).toEqual([1, 1]);
    expect(inv.detach(THROW_REF)).toBe(f); // whole stack: same object
    expect(inv.thrown).toBeNull();
    expect(inv.invariants()).toEqual([]);
  });

  it('refillThrowSlot: an empty slot takes a carried throwable (pockets first, the held quick slot last); a full one is kept', () => {
    const inv = new Inventory();
    expect(inv.refillThrowSlot()).toBe(false);
    const held = inv.makeStack('flare', 2), pocket = inv.makeStack('flare', 3);
    inv.set(H(0), held);
    inv.select(0);
    inv.set(P(4), pocket);
    expect(inv.refillThrowSlot()).toBe(true);
    expect(inv.thrown).toBe(pocket);
    expect(inv.selectedStack()).toBe(held);
    inv.detach(THROW_REF);
    expect(inv.refillThrowSlot()).toBe(true);
    expect(inv.thrown).toBe(held); // only the held one was left
    expect(inv.selectedStack()).toBeNull();
    expect(inv.refillThrowSlot()).toBe(true); // already holds one: unchanged
    expect(inv.thrown).toBe(held);
  });

  it('bag transfers (grounded bag sessions) handle the grenade slot: into the bag, and back filling it first', () => {
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    inv.add(inv.makeStack('flare', 6));
    expect(inv.bagQuick(bag, THROW_REF)).toBe(6);
    expect(inv.thrown).toBeNull();
    expect(bag.bag!.find(s => s?.itemId === 'flare')?.count).toBe(6);
    inv.set(P(0), inv.makeStack('water', 1));
    expect(inv.bagMove(bag, P(0), THROW_REF)).toBe('refused'); // water is no throwable
    expect(inv.bagQuick(bag, {bar: 'bag', index: bag.bag!.findIndex(s => s?.itemId === 'flare')})).toBe(6);
    expect(inv.thrown?.count).toBe(6);
    expect(inv.invariants()).toEqual([]);
  });
});

describe('snapshots: v2 carries the grenade slot; v1 (older saves / carryover) migrates', () => {
  it('toJSON / fromJSON / loadJSON / clone keep the slot (deep, same uids, nextUid above it)', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('flare', 7));
    inv.set(P(3), inv.makeStack('flare', 2));
    const j = inv.toJSON();
    expect(j.v).toBe(INVENTORY_JSON_VERSION);
    expect(INVENTORY_JSON_VERSION).toBe(2);
    expect(j.throw).toEqual([{uid: inv.thrown!.uid, itemId: 'flare', count: 7}]);
    for (const x of [inv.clone(), Inventory.fromJSON(JSON.parse(JSON.stringify(j)))]) {
      expect(x.toJSON()).toEqual(j);
      expect(x.thrown).not.toBe(inv.thrown);
      expect(x.makeStack('water', 1).uid).toBeGreaterThan(inv.thrown!.uid);
      expect(x.invariants()).toEqual([]);
    }
    const live = new Inventory();
    const slot = live.throwSlot;
    live.loadJSON(j);
    expect(live.throwSlot).toBe(slot); // in place
    expect(live.thrown?.count).toBe(7);
  });

  it('a v1 snapshot loads with an empty grenade slot; its flares stay where they were (nothing lost)', () => {
    const v1 = {v: 1, hotbar: [null, {uid: 3, itemId: 'flare', count: 3}, null, null, null], pack: [{uid: 4, itemId: 'flare', count: 2}, ...new Array(PACK_SIZE - 1).fill(null)],
      gear: {helmet: null, chest: null, gloves: null, boots: null, backpack: null}, selected: 1, nextUid: 9} as unknown as InventoryJSON;
    const inv = Inventory.fromJSON(v1);
    expect(inv.thrown).toBeNull();
    expect(inv.hotbar[1]?.count).toBe(3);
    expect(inv.pack[0]?.count).toBe(2);
    expect(flares(inv)).toBe(5);
    expect(inv.selected).toBe(1);
    expect(inv.invariants()).toEqual([]);
    expect(inv.toJSON().v).toBe(2);
    // the next G press equips one from the pockets
    expect(inv.refillThrowSlot()).toBe(true);
    expect(inv.thrown?.uid).toBe(4);
  });

  it('a malformed slot (non-throwable in it) is never lost: it goes back in through add()', () => {
    const inv = new Inventory();
    const j = inv.toJSON();
    j.throw = [{uid: 5, itemId: 'water', count: 2}];
    j.nextUid = 2;
    const r = Inventory.fromJSON(j);
    expect(r.thrown).toBeNull();
    expect(r.count('water')).toBe(2);
    expect(r.makeStack('cola', 1).uid).toBeGreaterThan(5);
    expect(r.invariants()).toEqual([]);
  });
});

describe('G: hold to ready, release to throw — exactly one flare from the grenade slot (FlareHold + FlareSystem, as Game drives them)', () => {
  const fx = levelFixture();
  const L = levelsOf(fx);
  const DT = 1 / 60;
  function setup(n = 10) {
    const ph = new PhysicsSystem(null);
    ph.build(fx);
    const fl = new FlareSystem(new THREE.Group(), ph, new LightSources(), mulberry32(7));
    fl.env = {levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b)};
    const inv = new Inventory();
    inv.add(inv.makeStack('flare', n));
    inv.set(H(0), inv.makeStack('pistol', 1, 15));
    inv.select(0);
    const eye = {x: 21, y: FIX.upperY + 1.62, z: 4}, dir = {x: 0, y: -0.1, z: 1};
    const l = Math.hypot(dir.x, dir.y, dir.z); dir.x /= l; dir.y /= l; dir.z /= l;
    const h = new FlareHold();
    let clears = 0;
    const keys = {g: false};
    /** One frame of Game.update's flare part: a G press refills an empty grenade slot, G hold -> release throws from it. */
    const frame = (o: {press?: boolean; down?: boolean; busy?: boolean} = {}) => {
      keys.g = o.down ?? false;
      if (o.press && !inv.thrown) inv.refillThrowSlot();
      const input: FlareHoldInput = {keyDown: keys.g, keyPressed: !!o.press, mouseDown: false, mousePressed: false, heldIsFlare: false, busy: !!o.busy, flares: inv.count('flare'), refusal: fl.refusal(), clears};
      for (const e of h.update(DT, input)) {
        if (e.type === 'release') throwOneFlare(fl, () => (inv.thrown?.itemId === 'flare' ? inv.consumeAt(THROW_REF) : inv.take('flare', 1) === 1), () => inv.count('flare') > 0, eye, dir);
      }
      ph.update(DT); fl.tick(DT);
    };
    return {fl, inv, h, frame, clear: () => { clears++; }};
  }

  it('a G hold spends nothing until the release, then exactly one from the grenade slot; the held gun is untouched', () => {
    const {fl, inv, frame} = setup(10);
    const gun = inv.selectedStack();
    frame({press: true, down: true});
    for (let i = 0; i < 40; i++) frame({down: true});
    expect([inv.thrown!.count, fl.flares.length]).toEqual([10, 0]);
    frame({down: false});
    expect([inv.thrown!.count, fl.flares.length, fl.counts.thrown]).toEqual([9, 1, 1]);
    expect(inv.selectedStack()).toBe(gun);
    for (let i = 0; i < 60; i++) frame();
    frame({press: true, down: false}); // a quick tap throws on its release
    expect([inv.thrown!.count, fl.flares.length]).toEqual([8, 2]);
    expect(inv.invariants()).toEqual([]);
  });

  it('cancelled (input cleared) or busy (bag readied / using) spends nothing; at the cap nothing is removed', () => {
    const {fl, inv, frame, clear} = setup(10);
    frame({press: true, down: true});
    clear();
    frame({down: true});
    frame({down: false});
    expect([inv.thrown!.count, fl.flares.length]).toEqual([10, 0]);
    frame({press: true, down: true, busy: true}); // e.g. the backpack is readied (gear owns the input)
    frame({down: false, busy: true});
    expect([inv.thrown!.count, fl.flares.length]).toEqual([10, 0]);
    for (let k = 0; k < 3; k++) { for (let i = 0; i < 50; i++) frame(); frame({press: true}); }
    expect([inv.thrown!.count, fl.burningCount]).toEqual([7, 3]);
    for (let i = 0; i < 50; i++) frame();
    frame({press: true}); // the 4th burning flare is refused
    expect([inv.thrown!.count, fl.burningCount]).toEqual([7, 3]);
  });

  it('an empty grenade slot is refilled from the pockets on the G press; the last flare empties it', () => {
    const {fl, inv, frame} = setup(1);
    const pocket = inv.makeStack('flare', 2);
    inv.set(P(6), pocket);
    frame({press: true});
    expect([inv.thrown?.count, fl.flares.length]).toEqual([undefined, 1]); // the slot's last flare thrown
    for (let i = 0; i < 60; i++) frame();
    frame({press: true});
    expect(inv.pack[6]).toBeNull(); // moved into the slot, then one thrown
    expect([inv.thrown?.count, fl.flares.length]).toEqual([1, 2]);
  });
});

describe('inventory screen + HUD (ui/inventoryUI.ts drop step, ui/hud.ts G slot) and the removed G = drop binding', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('drag a flare into the grenade slot, drag it out of the panel = drop (dropping still works), water is refused there', async () => {
    const {InventoryUI} = await import('../src/ui/inventoryUI');
    const inv = new Inventory();
    const drops: {ref: SlotRef; count?: number}[] = [];
    const ui = new InventoryUI(() => inv, {use() {}, drop: (ref, count) => { drops.push({ref, count}); inv.detach(ref, count); }, equip() {}, close() {}, changed() {}});
    inv.set(P(0), inv.makeStack('flare', 4));
    inv.set(P(1), inv.makeStack('water', 1));
    expect(ui.dropAt(P(0), THROW_REF)).toBe('moved');
    expect(inv.thrown?.count).toBe(4);
    expect(ui.dropAt(P(1), THROW_REF)).toBe('refused');
    expect(inv.thrown?.itemId).toBe('flare');
    expect(ui.dropAt(THROW_REF, 'out', 1)).toBe('dropped');
    expect(drops.at(-1)).toEqual({ref: THROW_REF, count: 1});
    expect(inv.thrown?.count).toBe(3);
    expect(ui.dropAt(H(4), 'out')).toBe('empty');
    inv.set(H(2), inv.makeStack('cola', 2));
    expect(ui.dropAt(H(2), 'out')).toBe('dropped'); // any slot still drops by dragging it out
    expect(inv.hotbar[2]).toBeNull();
    // the quick-slot row renders the grenade slot as its 6th cell
    ui.render();
    const row = dom.el('#inv-hotbar');
    expect(row.children.map(c => c.dataset.bar)).toEqual(['hotbar', 'hotbar', 'hotbar', 'hotbar', 'hotbar', 'throw']);
    expect(row.children[5].innerHTML).toMatch(/<span class="key">G<\/span>/);
  });

  it('the HUD bar ends with the G slot (throwable icon + count; dim when empty)', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const inv = new Inventory();
    const state = {hp: 100, maxHp: 100, stamina: 100, weaponName: '', mag: null, reserve: 0, hint: '', prompt: '', remaining: 0, total: 0, area: '', spreadPx: 4, aiming: false, flashlight: false, use: null};
    hud.update(state, inv);
    const bar = dom.el('#hotbar');
    expect(bar.children).toHaveLength(7);
    const g = bar.children[6];
    expect(g.dataset.bar).toBe('throw');
    expect(g.classList.contains('vacant')).toBe(true);
    expect(g.innerHTML).toMatch(/<span class="key">G<\/span>/);
    inv.add(inv.makeStack('flare', 10));
    hud.update(state, inv);
    expect(g.classList.contains('vacant')).toBe(false);
    expect(g.innerHTML).toMatch(/Flare/);
    expect(g.innerHTML).toMatch(/<span class="count">10<\/span>/);
  });

  it('G no longer drops: game.ts binds KeyG to the grenade slot only; the controls list says Hold G and has no drop key', async () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/hit\('KeyG'\)\)\s*this\.dropRef/);
    expect(src).toMatch(/keyDown: inp\.down\('KeyG'\)/);
    const {CONTROLS} = await import('../src/ui/hud');
    expect(CONTROLS.some(([a, k]) => /drop held item/i.test(a) || k === 'G')).toBe(false);
    expect(CONTROLS.some(([a, k]) => /flare/i.test(a) && k.startsWith('Hold G'))).toBe(true);
    expect(CONTROLS.some(([, k]) => /\bT\b/.test(k))).toBe(false);
  });
});
