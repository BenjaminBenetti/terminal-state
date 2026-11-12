// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTED CHEST'S STORE VIEW (world/equipmentChestStore.ts) — what a
// tap of [E] on a storage chest does, driven through a FAKE equipment system (tests/helpers/craftBenchFakes.ts: the real one is another
// lane's) with a real Inventory: the registered use (prompt + tap, never the hold), the one shared Lockbox transfer view over the
// unit's own 50 slots, uid-keeping transfers, the lid calls and every close rule.
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';
import {fakeEquipment, fakeUnit, type FakeUnit} from './helpers/craftBenchFakes';
import {EQUIPMENT} from '../src/craft/equipment';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {Inventory, type ItemStack, type SlotRef, type StoreRef} from '../src/items/inventory';
import {LOCKBOX_GRID, LOCKBOX_SLOTS} from '../src/run/trainLockbox';
import {LOCKBOX_VIEW} from '../src/ui/lockboxView';
import {CHEST_STORE_RT, CHEST_STORE_TEXT, CHEST_VIEW, EquipmentChestStore, chestStoreQaApi, installEquipmentChestStore} from '../src/world/equipmentChestStore';

const P = (index: number): SlotRef => ({bar: 'pack', index});
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const S = (index: number): StoreRef => ({bar: 'store', index});

class FakeInput {
  locked = true;
  calls = {lock: 0, unlock: 0, lockChange: [] as boolean[]};
  onLockChange = (locked: boolean): void => { this.calls.lockChange.push(locked); };
  lock(): Promise<boolean> { this.calls.lock++; this.locked = true; return Promise.resolve(true); }
  unlock(): void { this.calls.unlock++; this.locked = false; }
}

function setup() {
  const eq = fakeEquipment();
  const toasts: string[] = [], cues: string[] = [];
  const input = new FakeInput();
  let held = 0;
  const host = {
    inv: new Inventory(),
    player: {x: 0, y: 0, z: 1, alive: true},
    state: 'playing', qa: false,
    hud: {toast: (t: string) => { toasts.push(t); }},
    sfx: {voice: () => ({}), play: (_v: unknown, cue: string) => { cues.push(cue); return true; }},
    trainEquipment: eq as ReturnType<typeof fakeEquipment> | null,
    trainRide: {riding: false},
    frameHooks: [] as ((dt: number) => void)[],
    stateListeners: [] as ((s: never, p: never) => void)[],
    sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    inputOwners: [] as (() => boolean)[],
    hitListeners: [] as ((hit: {amount: number}) => void)[],
    input, gear: {session: null as unknown, cancelReady: (_r: boolean) => {}, showResume: () => {}},
    syncHeld: () => { held++; },
  };
  const store = installEquipmentChestStore(host as never);
  // two chests standing in the world (one 1 m in front of the player) and a device
  const a = fakeUnit('chest', 'eq-1', {x: 0, y: 0, z: 0, yaw: 0, level: 0});
  const b = fakeUnit('chest', 'eq-2', {x: 1.2, y: 0, z: 0.4, yaw: 1, level: 0});
  const radar = fakeUnit('radar', 'eq-3', {x: -1, y: 0, z: 0, yaw: 0, level: 0});
  eq.list.push(a, b, radar);
  eq.seq = 3;
  const frame = () => { for (const f of host.frameHooks) f(1 / 60); };
  const setState = (st: string) => { const prev = host.state; host.state = st; for (const f of host.stateListeners) (f as (s: string, p: string) => void)(st, prev); };
  const key = (code: string, o: Partial<{repeat: boolean}> = {}) => {
    const e = {code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'} as never, prevented: 0, stopped: 0,
      preventDefault() { e.prevented++; }, stopPropagation() { e.stopped++; }, ...o};
    return e;
  };
  return {host, eq, store, a, b, radar, toasts, cues, input, frame, setState, key, syncs: () => held};
}

/** Every stack the player or a chest holds, by uid (bag contents included). */
function census(inv: Inventory, ...units: FakeUnit[]): Map<number, string> {
  const out = new Map<number, string>();
  const add = (s: ItemStack | null) => {
    if (!s) return;
    expect(out.has(s.uid), `uid ${s.uid} twice`).toBe(false);
    out.set(s.uid, `${s.itemId}×${s.count}`);
    for (const c of s.bag ?? []) add(c);
  };
  for (const s of inv.allStacks(false)) add(s);
  for (const u of units) for (const s of u.slots ?? []) add(s);
  return out;
}

describe('chest store: the registered use and the view\'s look', () => {
  it('registers prompt + tap for the chest on the equipment system — never the hold (holding E carries it)', () => {
    const s = setup();
    expect(s.eq.uses.chest).toBe(s.store.use);
    expect(typeof s.store.use.prompt).toBe('function');
    expect(typeof s.store.use.tap).toBe('function');
    expect('hold' in s.store.use).toBe(false);
    expect(Object.keys(s.eq.uses)).toEqual(['chest']); // the devices' uses are their own systems'
    // a replaced / late equipment system gets it on the next frame
    const eq2 = fakeEquipment();
    s.host.trainEquipment = eq2;
    s.frame();
    expect(eq2.uses.chest).toBe(s.store.use);
    s.host.trainEquipment = null; // none at all: nothing throws
    s.frame();
    expect(s.store.qa()).toMatchObject({open: false, registered: false});
  });

  it('is the Lockbox view again: "Chest", the Lockbox\'s 50 slots in its columns, its own DOM id', () => {
    expect(EQUIPMENT.chest.slots).toBe(LOCKBOX_SLOTS);
    expect(LOCKBOX_SLOTS).toBe(50);
    expect(CHEST_VIEW).toEqual({id: 'chestview', name: 'Chest', the: 'the chest', slots: 50, columns: LOCKBOX_GRID.columns, heading: 'Storage chest · carry it anywhere'});
    expect(CHEST_VIEW.id).not.toBe(LOCKBOX_VIEW.id);
    const s = setup();
    expect(s.store.view.opts).toBe(CHEST_VIEW);
    expect(s.a.slots!.length).toBe(50);
  });

  it('the prompt counts the used slots (the tap\'s line: the equipment system adds "hold [E] to carry it"); null hands it back to the equipment system', () => {
    const s = setup(), inv = s.host.inv;
    expect(s.store.use.prompt(s.a)).toBe('<b>[E]</b> Open the storage chest (0/50)');
    s.a.slots![0] = inv.makeStack(SCRAP_METAL, 5);
    s.a.slots![7] = inv.makeStack('bandage', 1);
    s.a.slots![49] = inv.makeStack('pistol', 1);
    expect(s.store.use.prompt(s.a)).toBe('<b>[E]</b> Open the storage chest (3/50)');
    expect(CHEST_STORE_TEXT.prompt(3, 50)).toBe(s.store.use.prompt(s.a));
    // not storage / carried / riding as cargo / the train moving: the system's own prompt
    expect(s.store.use.prompt(s.radar)).toBeNull();
    s.a.mode = 'held';
    expect(s.store.use.prompt(s.a)).toBeNull();
    s.a.mode = 'cargo';
    expect(s.store.use.prompt(s.a)).toBeNull();
    s.a.mode = 'world';
    s.host.trainRide.riding = true;
    expect(s.store.use.prompt(s.a)).toBeNull();
    s.host.trainRide.riding = false;
    // while its view is open
    expect(s.store.use.tap(s.a)).toBe(true);
    expect(s.store.use.prompt(s.a)).toBe('<b>[E]</b> Close the storage chest');
    expect(s.store.use.prompt(s.b)).toBe('<b>[E]</b> Open the storage chest (0/50)');
  });
});

describe('chest store: a tap opens the shared view over the unit\'s slots', () => {
  it('opens without pausing: the lid goes up with the cabinet cue, the pointer is released, the mouse is the view\'s', () => {
    const s = setup();
    expect(s.store.use.tap(s.a)).toBe(true);
    expect(s.store.isOpen).toBe(true);
    expect(s.store.unit).toBe(s.a);
    expect(s.host.state).toBe('playing');
    expect(s.a.lidCalls).toEqual([true]);
    expect(s.a.open).toBe(true);
    expect(s.cues).toEqual(['cabinetOpen']);
    expect(s.input.calls.unlock).toBe(1);
    expect(s.host.inputOwners.some(f => f())).toBe(true);
    expect(s.toasts).toEqual([]);
    s.frame();
    expect(s.store.isOpen).toBe(true);
    expect(s.store.qa()).toMatchObject({open: true, unit: 'eq-1', used: 0, slots: 50, registered: true});
    // while it is open, losing pointer lock does not reach the game's handler (no pause)
    s.input.onLockChange(false);
    expect(s.input.calls.lockChange).toEqual([]);
  });

  it('a device (no slots) is not ours: the default action; while the train moves a tap only says so', () => {
    const s = setup();
    expect(s.store.use.tap(s.radar)).toBe(false);
    expect(s.store.isOpen).toBe(false);
    s.host.trainRide.riding = true;
    expect(s.store.use.tap(s.a)).toBe(true); // handled: never the default pick-up instead
    expect(s.store.isOpen).toBe(false);
    expect(s.toasts).toEqual(['Not while the train is moving']);
    s.host.trainRide.riding = false;
    s.a.mode = 'cargo';
    expect(s.store.use.tap(s.a)).toBe(true);
    expect(s.store.isOpen).toBe(false);
    expect(s.toasts).toEqual(['Not while the train is moving', 'Not while the train is moving']);
    expect(s.a.lidCalls).toEqual([]);
    expect(s.store.counts).toMatchObject({opens: 0, moving: 2});
  });

  it('refused outside play, dead, with a bag view open, or without a world pose: nothing opens', () => {
    const s = setup();
    s.host.state = 'paused';
    expect(s.store.open(s.a)).toBe(false);
    s.host.state = 'playing';
    s.host.player.alive = false;
    expect(s.store.open(s.a)).toBe(false);
    s.host.player.alive = true;
    s.host.gear.session = {};
    expect(s.store.open(s.a)).toBe(false);
    s.host.gear.session = null;
    s.a.pose = null;
    expect(s.store.open(s.a)).toBe(false);
    s.a.mode = 'held';
    expect(s.store.open(s.a)).toBe(false);
    expect(s.store.isOpen).toBe(false);
    expect(s.a.lidCalls).toEqual([]);
    expect(s.input.calls.unlock).toBe(0);
    expect(s.store.counts.refused).toBe(5);
  });

  it('ONE view for every chest: tapping another chest closes the first (its lid down) and opens the second', () => {
    const s = setup();
    s.host.player.x = 0.6; s.host.player.z = 0.6;
    s.a.slots![0] = s.host.inv.makeStack(SCRAP_METAL, 4);
    s.b.slots![0] = s.host.inv.makeStack(ELECTRICAL_PARTS, 2);
    expect(s.store.use.tap(s.a)).toBe(true);
    const view = s.store.view;
    expect(s.store.use.tap(s.b)).toBe(true);
    expect(s.store.view).toBe(view);
    expect(s.store.unit).toBe(s.b);
    expect(s.a.lidCalls).toEqual([true, false]);
    expect(s.b.lidCalls).toEqual([true]);
    expect(s.cues).toEqual(['cabinetOpen', 'cabinetClose', 'cabinetOpen']);
    // the view now moves things out of the SECOND chest
    expect(view.quick(S(0))).toBe(2);
    expect(s.host.inv.count(ELECTRICAL_PARTS)).toBe(2);
    expect(s.a.slots![0]!.count).toBe(4);
    expect(s.store.counts).toMatchObject({opens: 2, closes: 1});
  });
});

describe('chest store: transfers go through the inventory\'s store moves and keep every uid', () => {
  it('click-transfer in and out, drag / split / merge, the worn backpack whole — counts conserved, uids kept', () => {
    const s = setup(), inv = s.host.inv, view = s.store.view;
    const scrap = inv.makeStack(SCRAP_METAL, 12), pistol = inv.makeStack('pistol', 1, 5), band = inv.makeStack('bandage', 3);
    inv.set(P(0), scrap);
    inv.set(H(0), pistol);
    inv.set(P(1), band);
    const bag = inv.makeStack('backpack', 1);
    expect(inv.wearBag(bag)).toBe(true);
    const inBag = inv.makeStack(ELECTRICAL_PARTS, 6);
    bag.bag![0] = inBag;
    const before = census(inv, s.a, s.b);
    expect(s.store.use.tap(s.a)).toBe(true);
    // click: the scrap stack goes into the chest as the SAME object
    expect(view.quick(P(0))).toBe(12);
    expect(s.a.slots![0]).toBe(scrap);
    expect(inv.pack[0]).toBeNull();
    expect(view.note).toBe('12 × Scrap → Chest');
    // the weapon too (its magazine with it)
    expect(view.quick(H(0))).toBe(1);
    expect(s.a.slots![1]).toBe(pistol);
    expect(pistol.mag).toBe(5);
    // drag a split of 5 scrap back out to a pocket: a new stack for the split, the rest keeps its uid
    expect(view.move(S(0), P(4), 5)).toBe('split');
    expect(scrap.count).toBe(7);
    expect(inv.pack[4]!.count).toBe(5);
    expect(inv.pack[4]!.uid).not.toBe(scrap.uid);
    // ... and merge it back in by a click
    expect(view.quick(P(4))).toBe(5);
    expect(scrap.count).toBe(12);
    // drag within the chest
    expect(view.move(S(1), S(30))).toBe('moved');
    expect(s.a.slots![30]).toBe(pistol);
    // the worn backpack, whole (its contents stay inside)
    expect(view.stow()).toBe(true);
    expect(s.a.slots![1]).toBe(bag);
    expect(bag.bag![0]).toBe(inBag);
    expect(inv.wornBag()).toBeNull();
    expect(view.note).toBe('Backpack stowed in the chest (its contents stay inside)');
    // take it back: worn again, the same stack
    expect(view.quick(S(1))).toBe(1);
    expect(inv.wornBag()).toBe(bag);
    // every uid is where it was or moved — none lost, none duplicated; counts conserved
    const after = census(inv, s.a, s.b);
    expect([...after.keys()].sort((x, y) => x - y)).toEqual([...before.keys()].sort((x, y) => x - y));
    for (const [uid, what] of before) expect(after.get(uid), `uid ${uid}`).toBe(what);
    expect(inv.invariants()).toEqual([]);
    expect(s.syncs()).toBeGreaterThanOrEqual(6); // the held item is re-synced after every transfer
    expect(s.b.slots!.every(x => x === null)).toBe(true); // the other chest is untouched
  });

  it('refusals name the chest and change nothing; a closed view refuses everything', () => {
    const s = setup(), inv = s.host.inv, view = s.store.view;
    for (let i = 0; i < 50; i++) s.a.slots![i] = inv.makeStack('pistol', 1);
    inv.set(P(0), inv.makeStack(SCRAP_METAL, 3));
    expect(view.quick(P(0))).toBe(0); // closed
    expect([view.note, view.noteBad]).toEqual(['Open the chest (E) to reach into it.', true]);
    expect(view.move(P(0), S(0))).toBe('closed');
    expect(view.stow()).toBe(false);
    s.store.use.tap(s.a);
    expect(view.quick(P(0))).toBe(0);
    expect([view.note, view.noteBad]).toEqual(['The chest is full.', true]);
    expect(inv.pack[0]!.count).toBe(3);
    expect(view.stow()).toBe(false);
    expect(view.note).toBe('You are not wearing a backpack.');
    const bag = inv.makeStack('backpack', 1);
    inv.wearBag(bag);
    expect(view.stow()).toBe(false);
    expect(view.note).toBe('The chest is full.');
    expect(inv.wornBag()).toBe(bag);
  });
});

describe('chest store: the view closes', () => {
  it('E / 6 / Close (the player), and a second tap on the same chest: the lid comes down, the mouse comes back', () => {
    const s = setup();
    s.store.use.tap(s.a);
    const e = s.key('KeyE');
    s.store.onKeyCapture(e);
    expect([e.prevented, e.stopped]).toEqual([1, 1]);
    expect([s.store.isOpen, s.store.lastClose]).toEqual([false, 'user']);
    expect(s.a.lidCalls).toEqual([true, false]);
    expect(s.a.open).toBe(false);
    expect(s.cues).toEqual(['cabinetOpen', 'cabinetClose']);
    expect(s.input.calls.lock).toBe(1);
    expect(s.host.inputOwners.some(f => f())).toBe(false);
    s.store.use.tap(s.a);
    s.store.onKeyCapture(s.key('Digit6'));
    expect([s.store.isOpen, s.store.lastClose]).toEqual([false, 'user']);
    s.store.use.tap(s.a);
    expect(s.store.use.tap(s.a)).toBe(true); // (the fallback path: normally the capture listener takes the key)
    expect([s.store.isOpen, s.store.lastClose]).toEqual([false, 'user']);
    expect(s.a.lidCalls).toEqual([true, false, true, false, true, false]);
    expect(s.toasts).toEqual([]);
  });

  it('digits are consumed (never a quick slot); Esc / Tab / I close and go on; other keys pass', () => {
    const s = setup();
    s.host.inv.set(H(0), s.host.inv.makeStack('pistol', 1));
    s.host.inv.set(H(2), s.host.inv.makeStack('bandage', 1));
    s.store.use.tap(s.a);
    const sel = s.host.inv.selected;
    for (const code of ['Digit1', 'Digit3', 'Digit5', 'Digit0']) { const k = s.key(code); s.store.onKeyCapture(k); expect([k.prevented, k.stopped], code).toEqual([1, 1]); }
    expect(s.host.inv.selected).toBe(sel);
    expect(s.store.isOpen).toBe(true);
    const w = s.key('KeyW');
    s.store.onKeyCapture(w);
    expect([w.prevented, w.stopped]).toEqual([0, 0]);
    for (const code of ['Escape', 'Tab', 'KeyI']) {
      if (!s.store.isOpen) s.store.use.tap(s.a);
      const locks = s.input.calls.lock, k = s.key(code);
      s.store.onKeyCapture(k);
      expect([k.prevented, k.stopped], code).toEqual([0, 0]);
      expect([s.store.isOpen, s.store.lastClose], code).toEqual([false, 'state']);
      expect(s.input.calls.lock).toBe(locks);
    }
    // closed: every key is the game's
    const d = s.key('Digit1');
    s.store.onKeyCapture(d);
    expect([d.prevented, d.stopped]).toEqual([0, 0]);
  });

  it('a hit, walking away, the chest moved or picked up, the ride, another state, death, teardown, the unit gone', () => {
    const s = setup();
    const open = () => { expect(s.store.use.tap(s.a)).toBe(true); s.frame(); expect(s.store.isOpen).toBe(true); };
    const closed = (why: string) => { expect([s.store.isOpen, s.store.lastClose]).toEqual([false, why]); expect(s.a.open).toBe(false); expect(s.a.lidCalls[s.a.lidCalls.length - 1]).toBe(false); };
    // a hit (zero damage does not)
    open();
    for (const f of s.host.hitListeners) f({amount: 0});
    expect(s.store.isOpen).toBe(true);
    for (const f of s.host.hitListeners) f({amount: 8});
    closed('hit');
    expect(s.toasts.pop()).toBe(CHEST_STORE_TEXT.hit);
    // walking away
    open();
    s.host.player.z = CHEST_STORE_RT.closeRange - 0.1;
    s.frame();
    expect(s.store.isOpen).toBe(true);
    s.host.player.z = CHEST_STORE_RT.closeRange + 0.1;
    s.frame();
    closed('distance');
    expect(s.toasts.pop()).toBe(CHEST_STORE_TEXT.far);
    s.host.player.z = 1;
    // ... or a storey apart
    open();
    s.host.player.y = CHEST_STORE_RT.closeRise + 0.1;
    s.frame();
    closed('distance');
    s.toasts.pop();
    s.host.player.y = 0;
    // the chest moved (pushed, the floor under it changed) or turned
    open();
    s.a.pose = {...s.a.pose!, x: s.a.pose!.x + 0.05};
    s.frame();
    closed('moved');
    expect(s.toasts.pop()).toBe(CHEST_STORE_TEXT.moved);
    open();
    s.a.pose = {...s.a.pose!, yaw: s.a.pose!.yaw + 0.1};
    s.frame();
    closed('moved');
    s.toasts.pop();
    // picked up (hold E) / taken as cargo
    open();
    s.a.mode = 'held';
    s.frame();
    closed('moved');
    s.toasts.pop();
    s.a.mode = 'world';
    open();
    s.a.mode = 'cargo';
    s.frame();
    closed('moved');
    s.toasts.pop();
    s.a.mode = 'world';
    // the train starting to move
    open();
    s.host.trainRide.riding = true;
    s.frame();
    closed('travel');
    s.host.trainRide.riding = false;
    // any state but playing
    open();
    s.setState('paused');
    closed('state');
    s.setState('playing');
    // death
    open();
    s.host.player.alive = false;
    s.frame();
    closed('state');
    s.host.player.alive = true;
    // teardown
    open();
    for (const h of s.host.sectionHooks) h.teardown?.();
    closed('travel');
    // the unit gone from the system
    open();
    s.eq.list.splice(s.eq.list.indexOf(s.a), 1);
    s.frame();
    closed('gone');
    // only the hit / distance / moved closes say something; the silent ones play no lid cue either
    expect(s.toasts).toEqual([]);
    expect(s.cues.filter(c => c === 'cabinetOpen').length).toBe(12);
    expect(s.cues.filter(c => c === 'cabinetClose').length).toBe(7);
    expect(s.store.counts).toMatchObject({opens: 12, closes: 12});
  });

  it('redraws when the inventory or the chest changes, and only then', () => {
    const s = setup();
    s.store.use.tap(s.a);
    const render = vi.spyOn(s.store.view, 'render');
    s.frame(); s.frame();
    expect(render).not.toHaveBeenCalled();
    s.host.inv.add(s.host.inv.makeStack(SCRAP_METAL, 1)); // (a pickup, a reload: the inventory's version)
    s.frame();
    expect(render).toHaveBeenCalledTimes(1);
    s.a.slots![9] = s.host.inv.makeStack(SCRAP_METAL, 2); // (the bench drew from / a load wrote the chest: touchStore)
    s.a.touchStore();
    s.frame();
    expect(render).toHaveBeenCalledTimes(2);
    s.frame();
    expect(render).toHaveBeenCalledTimes(2);
    render.mockRestore();
  });

  it('the QA hooks drive the same paths', () => {
    const s = setup();
    s.host.inv.set(P(0), s.host.inv.makeStack(SCRAP_METAL, 3));
    const api = chestStoreQaApi({craftBench: {chestStore: s.store}, trainEquipment: s.eq});
    expect(api.chestTap('eq-2')).toBe(true);
    expect(api.chestStore()).toMatchObject({open: true, unit: 'eq-2'});
    expect(api.chestQuick('pack:0')).toBe(3);
    expect(api.chestMove('store:0', 'store:5')).toBe('moved');
    expect(s.b.slots![5]!.count).toBe(3);
    expect(api.chestStow()).toBe(false);
    api.chestClose();
    expect(api.chestStore()).toMatchObject({open: false, lastClose: 'user'});
    expect(api.chestTap()).toBe(true); // (default: the first chest standing in the world)
    expect(s.store.unit).toBe(s.a);
  });
});

describe('chest store: the view in a (fake) DOM', () => {
  let dom: FakeDom, undoCanvas: () => void;
  beforeAll(() => { undoCanvas = installCanvasShim(false); dom = installFakeDom(); });
  afterAll(() => { dom.uninstall(); undoCanvas(); });

  it('mounts its own element and CSS scope: "Chest · n/50 slots used", the Lockbox\'s columns, the chest\'s heading and help text', () => {
    const s = setup();
    s.a.slots![0] = s.host.inv.makeStack(SCRAP_METAL, 4);
    s.a.slots![1] = s.host.inv.makeStack('bandage', 2);
    expect(s.store.use.tap(s.a)).toBe(true);
    const root = dom.el('#app').children.find(c => c.id === 'chestview')!;
    expect(root).toBeTruthy();
    expect(root.classList.contains('hidden')).toBe(false);
    expect(s.store.view.visible).toBe(true);
    expect(root.innerHTML).toContain('Storage chest · carry it anywhere');
    expect(root.innerHTML).toContain(`lb-g${LOCKBOX_GRID.columns}" data-side="store"`);
    expect(root.innerHTML).toContain('walking away or getting hit closes the chest');
    expect(dom.el('.lb-title').textContent).toBe('Chest · 2/50 slots used');
    expect(dom.el('[data-side="store"]').children.length).toBe(50);
    const style = dom.doc.head.children.find(c => c.id === 'chestview-styles');
    expect(style?.textContent).toContain('#chestview .lb-panel');
    expect(style?.textContent).not.toContain('#lockboxview');
    s.store.close('user');
    expect(root.classList.contains('hidden')).toBe(true);
    expect(s.store.view.visible).toBe(false);
  });
});

describe('chest store: built by the class alone', () => {
  it('a store without registries that are optional still installs (structural host)', () => {
    const eq = fakeEquipment();
    const host = {inv: new Inventory(), player: {x: 0, y: 0, z: 0, alive: true}, state: 'playing', hud: {toast: () => {}}, sfx: null, trainEquipment: eq,
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {teardown?(): void}[]};
    const store = new EquipmentChestStore(host as never).install();
    expect(eq.uses.chest).toBe(store.use);
    const u = fakeUnit('chest', 'eq-1');
    eq.list.push(u);
    expect(store.use.tap(u)).toBe(true);
    for (const f of host.frameHooks) f(1 / 60);
    expect(store.isOpen).toBe(true);
    for (const h of host.sectionHooks) h.teardown?.();
    expect(store.isOpen).toBe(false);
  });
});
