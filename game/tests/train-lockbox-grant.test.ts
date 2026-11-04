// Task train-lockbox-windows-20261101-232156 (lane BOX): the 1337 developer gear drop — items/devGrant.ts (the registry-derived
// bundle, full stacks, the all-or-nothing placement, repeats, the sequence matcher) and ui/lockboxView.ts (the pure key scope, then
// LockboxSystem on a minimal Game shell with a fake TRAIN API and the REAL player/input.ts keydown listener on a stub window: digits
// are consumed only while the view is open — never reaching the quick slots — and every close path lowers the lid). Node only.

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {ITEMS, itemDef} from '../src/items/items';
import {WEAPONS} from '../src/weapons/weapons';
import {Inventory} from '../src/items/inventory';
import {DEV_GRANT_SEQUENCE, SequenceMatcher, devGrantBundle, digitOfCode, grantAllOrNothing, grantText, planGrant} from '../src/items/devGrant';
import {LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {starterInventory} from '../src/run/starter';
import {Input} from '../src/player/input';
import {LOCKBOX_VIEW_RANGE, LockboxSystem, lockboxKeyAction} from '../src/ui/lockboxView';
import type {Game} from '../src/game';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);

const EXPECTED = [
  {itemId: 'rifle', count: 1}, {itemId: 'shotgun', count: 1}, {itemId: 'pistol', count: 1},
  {itemId: 'armor_vest', count: 1}, {itemId: 'chest_rig', count: 1}, {itemId: 'backpack', count: 1}, {itemId: 'helmet', count: 1},
  {itemId: 'boots', count: 1}, {itemId: 'gloves', count: 1}, {itemId: 'gas_mask', count: 1},
  {itemId: 'ammo_9mm', count: 120}, {itemId: 'ammo_556', count: 120}, {itemId: 'ammo_12ga', count: 32},
];
const fillWith = (box: TrainLockbox, inv: Inventory, n: number) => { for (let i = 0; i < n; i++) box.slots[i] = inv.makeStack('water', 1); };

describe('the gear drop bundle (registry-derived)', () => {
  it('is exactly the 3 ranged guns, the 7 gear items and one full stack of each of the 3 calibers — 13 slots', () => {
    expect(devGrantBundle()).toEqual(EXPECTED);
    // derived, not listed: every weapon item that is not melee, every gear item, every caliber ammo item — nothing else
    for (const d of Object.values(ITEMS)) {
      // (task filter-tension-airtank-20261104-072836: the bundle stays exactly as it was — the new Airtank Backpack is not in it)
      const want = (d.kind === 'weapon' && !WEAPONS[d.weaponId!].melee) || (d.kind === 'gear' && !!d.gear && d.id !== 'airtank_backpack') || d.kind === 'ammo';
      expect([d.id, devGrantBundle().some(l => l.itemId === d.id)]).toEqual([d.id, want]);
    }
    expect(devGrantBundle().some(l => l.itemId === 'knife')).toBe(false); // melee: not a gun, not gear
    for (const l of devGrantBundle().filter(x => itemDef(x.itemId).kind === 'ammo')) expect(l.count).toBe(itemDef(l.itemId).stackMax);
    expect(planGrant(new TrainLockbox().slots)).toEqual({ok: true, need: 13, free: 40});
    expect(grantText()).toBe('Rifle, Shotgun, Pistol, Armor vest, Chest rig, Backpack, Hard hat, Work boots, Work gloves, Gas mask, 120 × 9mm, 120 × 5.56mm, 32 × 12-gauge');
  });

  it('success with room: factory stacks (full magazines, empty 12-slot bag, mask without charge), fresh unique uids from the run counter', () => {
    const inv = starterInventory('pistol'), box = new TrainLockbox();
    const next = inv.makeStack('water', 1).uid + 1;
    expect(grantAllOrNothing(box.slots, inv)).toEqual({ok: true, need: 13, free: 40});
    expect(box.used).toBe(13);
    expect(box.summary()).toEqual(['0:riflex1@30', '1:shotgunx1@6', '2:pistolx1@15', '3:armor_vestx1', '4:chest_rigx1', '5:backpackx1[0]', '6:helmetx1',
      '7:bootsx1', '8:glovesx1', '9:gas_maskx1', '10:ammo_9mmx120', '11:ammo_556x120', '12:ammo_12gax32']);
    expect(box.slots[5]!.bag).toEqual(new Array(12).fill(null));
    expect(box.slots[9]!.filter).toBeUndefined();
    expect(box.slots.slice(0, 13).map(s => s!.uid)).toEqual(Array.from({length: 13}, (_, i) => next + i));
    expect(box.invariants()).toEqual([]);
  });

  it('all or nothing: too little room grants NOTHING (slots and uid counter untouched); merges onto partial stacks count with the real rules', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    fillWith(box, inv, 28); // 12 free < 13
    const before = JSON.stringify(box.toJSON()), uid = inv.makeStack('water', 1).uid;
    expect(grantAllOrNothing(box.slots, inv)).toEqual({ok: false, need: 13, free: 12});
    expect(JSON.stringify(box.toJSON())).toBe(before);
    expect(inv.makeStack('water', 1).uid).toBe(uid + 1); // makeStack never ran
    box.slots[27] = null; // exactly 13 free
    box.slots[0] = inv.makeStack('ammo_9mm', 50); // a partial 9mm stack: 70 merge onto it, 50 need a new slot
    expect(grantAllOrNothing(box.slots, inv)).toEqual({ok: true, need: 13, free: 13});
    expect(box.used).toBe(40);
    const nine = box.slots.filter(s => s?.itemId === 'ammo_9mm').map(s => s!.count);
    expect(nine).toEqual([120, 50]); // exactly one full stack (120) added in total
    expect(box.invariants()).toEqual([]);
  });

  it('repeating is allowed while there is room: 3 drops fit 40 slots, the 4th is refused with nothing changed', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    for (const used of [13, 26, 39]) {
      expect(grantAllOrNothing(box.slots, inv).ok).toBe(true);
      expect(box.used).toBe(used);
    }
    const before = JSON.stringify(box.toJSON());
    expect(grantAllOrNothing(box.slots, inv)).toEqual({ok: false, need: 13, free: 1});
    expect(JSON.stringify(box.toJSON())).toBe(before);
  });
});

describe('the 1337 key sequence and the Lockbox key scope (pure)', () => {
  it('matcher: ordered 1 3 3 7; a wrong key resets unless it is 1; one completion per full sequence', () => {
    const run = (keys: string) => { const m = new SequenceMatcher(); return [...keys].map(k => m.push(k)).filter(Boolean).length; };
    expect(DEV_GRANT_SEQUENCE).toEqual(['1', '3', '3', '7']);
    expect(run('1337')).toBe(1);
    expect(run('13371337')).toBe(2);
    expect(run('131337')).toBe(1); // the wrong '1' starts a new attempt
    expect(run('11337')).toBe(1);
    expect(run('13337')).toBe(0);
    expect(run('1373')).toBe(0);
    expect(run('7331')).toBe(0);
    const m = new SequenceMatcher();
    m.push('1'); m.push('3'); m.push('3');
    expect(m.progress).toBe(3);
    m.reset();
    expect(m.push('7')).toBe(false);
    expect([digitOfCode('Digit1'), digitOfCode('Numpad7'), digitOfCode('Digit0'), digitOfCode('KeyD'), digitOfCode('NumpadAdd')]).toEqual(['1', '7', '0', null, null]);
  });

  it('scope: nothing is taken while closed or typing in a field; open: digits consumed, E / 6 close, Tab / Esc / I close and pass, other keys reset', () => {
    const k = (code: string, o: Record<string, unknown> = {}, open = true) => lockboxKeyAction({code, ...o}, open);
    for (const c of ['Digit1', 'Digit6', 'KeyE', 'Tab', 'KeyW', 'Numpad3']) expect(k(c, {}, false)).toEqual({kind: 'pass'});
    expect(k('Digit1', {target: {tagName: 'INPUT'}})).toEqual({kind: 'pass'});
    expect(k('Digit3', {target: {tagName: 'TEXTAREA'}})).toEqual({kind: 'pass'});
    expect(k('Digit1')).toEqual({kind: 'digit', digit: '1'});
    expect(k('Numpad7')).toEqual({kind: 'digit', digit: '7'});
    expect(k('Digit2')).toEqual({kind: 'digit', digit: '2'}); // a quick-slot key: consumed (a wrong key for the code)
    expect(k('Digit3', {repeat: true})).toEqual({kind: 'swallow'});
    expect(k('KeyE')).toEqual({kind: 'close'});
    expect(k('Digit6')).toEqual({kind: 'close'});
    expect(k('KeyE', {repeat: true})).toEqual({kind: 'swallow'});
    for (const c of ['Tab', 'Escape', 'KeyI']) expect(k(c)).toEqual({kind: 'close-pass'});
    expect(k('KeyW')).toEqual({kind: 'reset'});
    expect(k('Digit1', {ctrlKey: true})).toEqual({kind: 'reset'}); // Ctrl+1 stays the browser's (not consumed)
    expect(k('ShiftLeft')).toEqual({kind: 'pass'});
    expect(k('KeyW', {repeat: true})).toEqual({kind: 'pass'});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('LockboxSystem: open / close rules, digits never leak, the drop from the open view', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = {window: g.window, document: g.document};
  let dom: FakeDom;
  const listeners: {type: string; fn: (e: unknown) => void; capture: boolean}[] = [];
  beforeAll(() => {
    dom = installFakeDom();
    g.window = {addEventListener: (type: string, fn: (e: unknown) => void, o?: boolean | {capture?: boolean}) => { listeners.push({type, fn, capture: typeof o === 'boolean' ? o : !!o?.capture}); },
      removeEventListener() {}, innerWidth: 1280, innerHeight: 720};
  });
  afterAll(() => { dom.uninstall(); g.window = saved.window; g.document = saved.document; });

  /** A keydown on the page: window capture listeners first, then (unless stopped) the bubble ones — the browser's order. */
  const key = (code: string, o: Record<string, unknown> = {}) => {
    let stopped = false, prevented = false;
    const e = {code, key: code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'}, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }, ...o};
    for (const l of listeners.filter(x => x.type === 'keydown' && x.capture)) l.fn(e);
    if (!stopped) for (const l of listeners.filter(x => x.type === 'keydown' && !x.capture)) l.fn(e);
    return {stopped, prevented};
  };
  const type = (keys: string) => { for (const c of keys) key(/[0-9]/.test(c) ? `Digit${c}` : `Key${c}`); };

  function setup() {
    listeners.length = 0;
    const input = new Input({addEventListener() {}} as unknown as HTMLCanvasElement, true);
    input.active = true;
    const keysSeen: string[] = [];
    input.onKey = c => keysSeen.push(c);
    const train = {onLockboxInteract: null as null | (() => void), lid: [] as boolean[], at: {x: 0, y: 0.55, z: 0} as {x: number; y: number; z: number} | null, lockboxAimed: true,
      setLockboxOpen(open: boolean) { this.lid.push(open); }, lockboxWorld() { return this.at; }};
    const toasts: string[] = [];
    const shell = {
      inv: starterInventory('pistol'), playerTrain: new PlayerTrainRecord(), trainRuntime: train, player: {x: 0.6, y: 0, z: -0.7, alive: true}, state: 'playing', qa: true, input,
      hud: {toast: (t: string) => toasts.push(t)}, sfx: {pickup() {}, denied() {}}, gear: {session: null as unknown, cancelReady() {}, showResume() {}},
      frameHooks: [] as ((dt: number) => void)[], hitListeners: [] as ((h: {amount: number}) => void)[], stateListeners: [] as ((s: string, p: string) => void)[],
      sectionHooks: [] as {teardown?(): void}[], inputOwners: [] as (() => boolean)[], syncHeld() {},
    };
    const sys = new LockboxSystem(shell as unknown as Game).install();
    const frame = () => { for (const f of shell.frameHooks) f(0.016); input.endFrame(); };
    return {sys, shell, train, input, keysSeen, toasts, frame, box: shell.playerTrain.lockbox};
  }

  it('[E] on the box (TRAIN callback) opens it and raises the lid; 1-5 never reach the quick slots; 1337 drops the gear; E closes and lowers the lid', () => {
    const {sys, shell, train, input, keysSeen, box} = setup();
    expect(typeof train.onLockboxInteract).toBe('function');
    train.onLockboxInteract!();
    expect([sys.isOpen, train.lid, shell.inputOwners.some(f => f())]).toEqual([true, [true], true]);
    expect(dom.el('.lb-title').textContent).toBe(`Lockbox · 0/${LOCKBOX_SLOTS} slots used`);
    for (const c of ['Digit2', 'Digit5', 'Digit1', 'Numpad3']) expect(key(c)).toEqual({stopped: true, prevented: true});
    expect([input.hit('Digit2'), input.hit('Digit5'), input.hit('Digit1'), keysSeen, shell.inv.selected]).toEqual([false, false, false, [], 0]);
    sys.matcher.reset();
    type('1337');
    expect([box.used, sys.lastGrant, sys.view.noteBad]).toEqual([13, {ok: true, need: 13, free: 40}, false]);
    expect(sys.view.note).toMatch(/^Gear drop added to the Lockbox: Rifle, Shotgun, Pistol/);
    expect(dom.el('.lb-title').textContent).toBe('Lockbox · 13/40 slots used');
    expect([input.pressed.size, keysSeen]).toEqual([0, []]); // not one digit reached player/input.ts
    expect(key('KeyW').stopped).toBe(false); // WASD still walks
    expect(input.hit('KeyW')).toBe(true);
    expect(key('KeyE')).toEqual({stopped: true, prevented: true});
    expect([sys.isOpen, train.lid, input.hit('KeyE')]).toEqual([false, [true, false], false]); // E closed it, no [E] interact leaked
    // closed: digits are the game's again (quick slots) and 1337 does nothing
    input.endFrame();
    expect(key('Digit2').stopped).toBe(false);
    expect(input.hit('Digit2')).toBe(true);
    type('1337');
    expect(box.used).toBe(13);
  });

  it('the code resets on close, blur, a hidden tab and a wrong key; a typing target is ignored; repeats need the whole code; no room = nothing', () => {
    const {sys, train, box} = setup();
    const open = () => { expect(sys.open()).toBe(true); };
    open();
    type('13');
    key('Escape'); // closes (then goes on to the pause menu)
    expect([sys.isOpen, train.lid.at(-1)]).toEqual([false, false]);
    open();
    type('37');
    expect(box.used).toBe(0);
    type('13');
    for (const l of listeners.filter(x => x.type === 'blur')) l.fn({});
    type('37');
    type('13');
    for (const fn of dom.doc.listeners.get('visibilitychange') ?? []) fn({});
    type('37');
    type('13W37');
    key('Digit3', {repeat: true}); // an auto-repeated digit is swallowed, not counted
    expect([box.used, sys.matcher.progress]).toEqual([0, 0]);
    type('1');
    key('Digit3', {target: {tagName: 'INPUT'}}); // typing in a field: not the view's
    expect(sys.matcher.progress).toBe(1);
    type('337');
    expect(box.used).toBe(13);
    type('1313371337'); // the second '1' restarts the attempt: two drops
    expect(box.used).toBe(39);
    const before = JSON.stringify(box.toJSON());
    type('1337');
    expect([JSON.stringify(box.toJSON()) === before, sys.lastGrant, sys.view.noteBad]).toEqual([true, {ok: false, need: 13, free: 1}, true]);
    expect(sys.view.note).toBe('Not enough space in the Lockbox for the gear drop (needs 13 free slots, 1 free) — nothing was added');
  });

  it('closes (lid down) on a hit, pause / any state, travel teardown, walking out of reach, death and the train unloading; refuses to open without a box', () => {
    const {sys, shell, train, frame, toasts} = setup();
    const reopen = () => { expect(sys.open()).toBe(true); };
    reopen();
    shell.hitListeners[0]({amount: 0}); // a zero-damage graze keeps it open
    expect(sys.isOpen).toBe(true);
    shell.hitListeners[0]({amount: 6});
    expect([sys.isOpen, toasts.at(-1)]).toEqual([false, 'Hit! You let go of the Lockbox']);
    reopen();
    shell.stateListeners[0]('paused', 'playing');
    expect(sys.isOpen).toBe(false);
    reopen();
    shell.sectionHooks[0].teardown!();
    expect(sys.isOpen).toBe(false);
    reopen();
    shell.player.x = LOCKBOX_VIEW_RANGE - 0.05;
    shell.player.z = 0;
    frame();
    expect(sys.isOpen).toBe(true); // still within reach
    shell.player.x = LOCKBOX_VIEW_RANGE + 0.05;
    frame();
    expect([sys.isOpen, toasts.at(-1)]).toEqual([false, 'Too far from the Lockbox — it closed']);
    shell.player.x = 0.6;
    reopen();
    shell.player.alive = false;
    frame();
    expect(sys.isOpen).toBe(false);
    expect(sys.open()).toBe(false); // dead
    shell.player.alive = true;
    reopen();
    train.at = null; // the train unloaded / no Lockbox built
    frame();
    expect(sys.isOpen).toBe(false);
    expect(sys.open()).toBe(false);
    train.at = {x: 0, y: 0.55, z: 0};
    shell.gear.session = {}; // a grounded-bag view is open
    expect(sys.open()).toBe(false);
    shell.gear.session = null;
    shell.state = 'inventory';
    expect(sys.open()).toBe(false);
    // every open raised the lid and every close lowered it again
    expect(train.lid.filter(Boolean).length).toBe(train.lid.filter(x => !x).length);
    expect(train.lid.at(-1)).toBe(false);
  });

  it('transfers through the open view (click / drag), refused while closed', () => {
    const {sys, shell, box} = setup();
    expect(sys.view.quick({bar: 'pack', index: 0})).toBe(0); // closed
    expect(box.used).toBe(0);
    sys.open();
    expect(sys.view.quick({bar: 'pack', index: 0})).toBe(45); // the starter 9mm
    expect(box.summary()).toEqual(['0:ammo_9mmx45']);
    expect(sys.view.move({bar: 'store', index: 0}, {bar: 'pack', index: 3}, 5)).toBe('split');
    expect([box.slots[0]!.count, shell.inv.get({bar: 'pack', index: 3})!.count]).toEqual([40, 5]);
    expect(sys.view.stow()).toBe(false); // no backpack worn
    expect(sys.view.noteBad).toBe(true);
  });
});
