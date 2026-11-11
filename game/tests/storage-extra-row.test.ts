// Task gameplay-feedback-20261111 (lane STORAGE; user: "Add one extra row to the player inventory, backpack inventory and train chest.
// Keep their existing column counts unchanged. Make this real usable storage, not just a visual resize."):
//  - the shapes: pockets POCKET_GRID 6 × 3 (12 -> 18; a chest rig still adds 4: 16 -> 22), a backpack's own slots BACKPACK_GRID 6 × 3
//    (12 -> 18), the Lockbox LOCKBOX_GRID 10 × 5 (40 -> 50); another store on the Lockbox class keeps its own size; quick / gear / grenade / melee slots unchanged;
//  - REAL storage: every inventory path reaches the new slots (add / pick up, take-all from a holder, set, drag-move / split / merge /
//    swap, 1-5 assign, bag click / drag, Lockbox click / drag / stow, the 1337 drop's room check) and the capacity checks use the
//    constants (full exactly at the new sizes);
//  - the views on the repo's Node fake DOM (tests/helpers/fakeDom.ts): the inventory screen, the grounded-bag view and the Lockbox view
//    render the new slot counts in the same columns, label them, and their REAL click listeners move items into the new row;
//  - the layout: the bag / Lockbox views (no scroll) still fit a 1280 × 720 viewport with the extra row (CSS arithmetic from the
//    injected rules), the inventory screen keeps its scroll-from-top rule.
// Save compatibility (old 12 / 16 / 40 saves) is tests/storage-extra-row-save.test.ts.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom, type FakeEl} from './helpers/fakeDom';
import {HOTBAR_SIZE, Inventory, LEGACY_PACK_SIZE, MELEE_SLOTS, PACK_SIZE, POCKET_GRID, THROW_SLOTS, type AnyRef, type SlotRef, type StoreSideRef} from '../src/items/inventory';
import {BACKPACK_GRID, BACKPACK_SLOTS, GEAR_SLOTS, LEGACY_BACKPACK_SLOTS, gearSpec, gearStatText} from '../src/items/gear';
import {itemDef} from '../src/items/items';
import {LOCKBOX_GRID, LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {TRUNK_SLOTS} from '../src/world/skywaysCarStore';
import {BagSession} from '../src/gear/bagSession';
import {BagView} from '../src/ui/bagView';
import {LOCKBOX_VIEW, LockboxView} from '../src/ui/lockboxView';
import {InventoryUI} from '../src/ui/inventoryUI';
import {ensureGearStyles, gridRules} from '../src/ui/gearStyles';
import {grantAllOrNothing, planGrant} from '../src/items/devGrant';
import {takeAll, type HolderState, type Lot} from '../src/items/loot';
import {buyPrice} from '../src/market/trade/stalls';

installCanvasShim(false);

const P = (index: number): SlotRef => ({bar: 'pack', index});
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const G = (slot: (typeof GEAR_SLOTS)[number]): SlotRef => ({bar: 'gear', index: GEAR_SLOTS.indexOf(slot)});
const B = (index: number): AnyRef => ({bar: 'bag', index});
const S = (index: number): StoreSideRef => ({bar: 'store', index});
const SRC = (p: string) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
/** A rig worn, every pocket empty. */
const rigged = () => { const inv = new Inventory(); expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0); return inv; };

describe('the shapes: one more row each, the same columns; nothing else resized', () => {
  it('pockets 6 × 3 = 18 (+ the chest rig\'s 4 = 22), backpack 6 × 3 = 18, Lockbox 10 × 5 = 50; the other slots and stores unchanged', () => {
    expect([POCKET_GRID.columns, POCKET_GRID.rows, PACK_SIZE]).toEqual([6, 3, 18]);
    expect([BACKPACK_GRID.columns, BACKPACK_GRID.rows, BACKPACK_SLOTS]).toEqual([6, 3, 18]);
    expect([LOCKBOX_GRID.columns, LOCKBOX_GRID.rows, LOCKBOX_SLOTS]).toEqual([10, 5, 50]);
    // exactly one row more than before, in the old column counts (12 = 6 × 2, 12 = 6 × 2, 40 = 10 × 4)
    expect([PACK_SIZE - LEGACY_PACK_SIZE, BACKPACK_SLOTS - LEGACY_BACKPACK_SLOTS, LOCKBOX_SLOTS - 40]).toEqual([POCKET_GRID.columns, BACKPACK_GRID.columns, LOCKBOX_GRID.columns]);
    expect([LEGACY_PACK_SIZE % POCKET_GRID.columns, LEGACY_BACKPACK_SLOTS % BACKPACK_GRID.columns, 40 % LOCKBOX_GRID.columns]).toEqual([0, 0, 0]);
    expect(gearSpec('chest_rig')!.pockets).toBe(4);
    expect(gearSpec('backpack')!.bagSlots).toBe(BACKPACK_SLOTS);
    expect(TRUNK_SLOTS).toBe(16); // (a store sharing the class keeps its own size)
    expect([HOTBAR_SIZE, THROW_SLOTS, MELEE_SLOTS, GEAR_SLOTS.length]).toEqual([5, 1, 1, 6]);
    expect(LOCKBOX_VIEW).toMatchObject({slots: LOCKBOX_SLOTS, columns: 10});
    const inv = new Inventory();
    expect([inv.pack.length, inv.capacity, inv.hotbar.length, inv.gearSlots.length, inv.throwSlot.length, inv.meleeSlot.length]).toEqual([18, 18, 5, 6, 1, 1]);
    expect([rigged().pack.length, rigged().capacity, rigged().extraPockets]).toEqual([22, 22, 4]);
    expect(inv.makeStack('backpack', 1).bag).toEqual(new Array(18).fill(null));
    expect([new TrainLockbox().slots.length, new TrainLockbox(TRUNK_SLOTS).slots.length]).toEqual([50, 16]);
  });

  it('the copy states the new counts: the backpack description / stat line, the rig refusal names pockets 19–22', () => {
    expect(itemDef('backpack').description).toContain('with 18 slots of its own');
    expect(gearStatText(gearSpec('backpack')!)).toBe('18-slot bag (open it on the ground)');
    expect(gearStatText(gearSpec('chest_rig')!)).toBe('+4 pockets');
    expect(itemDef('chest_rig').description).toContain('Four extra pockets');
    const inv = rigged();
    inv.set(P(PACK_SIZE), inv.makeStack('water', 1));
    expect(inv.takeOff('chest')).toBe('refused');
    expect(inv.refusal?.text).toBe('Empty the chest rig\'s extra pockets (19–22) first — nothing is dropped.');
  });

  it('the backpack keeps its trade price (the user\'s 78 ties were set for 12 slots; the extra row is not repriced)', () => {
    const inv = new Inventory();
    expect(buyPrice(inv.makeStack('backpack', 1), 1)).toBe(78);
  });
});

describe('real storage: every inventory path reaches the new slots; capacity checks use the new sizes', () => {
  it('pick-ups fill all 5 quick slots + 18 pockets (23 stacks), then the next is refused; hasRoomFor agrees', () => {
    const inv = new Inventory();
    for (let i = 0; i < HOTBAR_SIZE + PACK_SIZE; i++) {
      expect(inv.hasRoomFor('rifle')).toBe(true);
      expect(inv.add(inv.makeStack('rifle', 1))).toBe(0);
    }
    expect(inv.pack.every(Boolean)).toBe(true);
    expect(inv.get(P(17))!.itemId).toBe('rifle'); // the new row's last pocket holds one
    expect(inv.hasRoomFor('rifle')).toBe(false);
    expect(inv.add(inv.makeStack('rifle', 1))).toBe(1);
    // with a chest rig: 4 more (22 pockets)
    const r = rigged();
    for (let i = 0; i < HOTBAR_SIZE + PACK_SIZE + 4; i++) expect(r.add(r.makeStack('rifle', 1))).toBe(0);
    expect([r.hasRoomFor('rifle'), r.add(r.makeStack('rifle', 1)), r.pack.filter(Boolean).length]).toEqual([false, 1, 22]);
    expect([inv.invariants(), r.invariants()]).toEqual([[], []]);
  });

  it('take-all from a loot holder lands in the new pockets too (pockets first for ammo / supplies)', () => {
    const inv = new Inventory();
    for (let i = 0; i < LEGACY_PACK_SIZE; i++) inv.set(P(i), inv.makeStack('rifle', 1)); // the old 12 pockets full
    const lot = (id: number, itemId: string, count: number) => ({id, itemId, count, x: 0, y: 0, z: 0}) as unknown as Lot;
    const s = {index: 0, kind: 'crate', areaType: 'storage', open: true, searched: false, lots: [lot(1, 'ammo_9mm', 30), lot(2, 'gas_filter', 2), lot(3, 'scrap_metal', 5)], rolled: 3} as unknown as HolderState;
    const r = takeAll(s, inv);
    expect(r.remaining).toEqual([]);
    expect([12, 13, 14].map(i => inv.get(P(i))?.itemId)).toEqual(['ammo_9mm', 'gas_filter', 'scrap_metal']);
    expect(inv.invariants()).toEqual([]);
  });

  it('set / drag-move / split / merge / swap / 1-5 assign into and out of the new row (base pockets 12-17, rig pockets 18-21)', () => {
    const inv = rigged();
    const water = inv.makeStack('water', 4), beans = inv.makeStack('beans', 1);
    inv.set(P(0), water);
    expect(inv.moveCount(P(0), P(17))).toBe('moved'); // the new base row
    expect(inv.get(P(17))).toBe(water);
    expect(inv.moveCount(P(17), P(12), 1)).toBe('split');
    expect([inv.get(P(12))!.count, water.count]).toEqual([1, 3]);
    expect(inv.moveCount(P(17), P(12))).toBe('merged');
    expect([inv.get(P(12))!.count, inv.get(P(17))]).toEqual([4, null]);
    const piece = inv.get(P(12))!; // (the split piece: the merged-in rest is gone)
    inv.set(P(21), beans); // the rig's last pocket
    expect(inv.moveCount(P(12), P(21))).toBe('swapped');
    expect([inv.get(P(21))!.itemId, inv.get(P(12))]).toEqual(['water', beans]);
    expect(inv.moveCount(P(21), H(2))).toBe('moved');
    expect(inv.moveCount(H(2), P(18))).toBe('moved');
    expect(inv.get(P(18))!.itemId).toBe('water');
    expect(inv.find(piece.uid)).toEqual(P(18));
    // out of range stays refused (the slot after the last one)
    expect(inv.moveCount(P(18), P(22))).toBe('refused');
    expect(rigged().moveCount(P(0), P(0))).toBe('none');
    expect(new Inventory().moveCount(P(17), P(18))).toBe('refused'); // without a rig there is no pocket 18
    inv.set(P(3), inv.makeStack('cola', 2));
    expect(inv.moveCount(P(3), P(18))).toBe('swapped'); // the rig's pocket swaps like any other
    expect(inv.invariants()).toEqual([]);
  });

  it('the chest rig\'s pockets follow the new base pockets: refused off while 18-21 hold items, never shuffled into 12-17', () => {
    const inv = rigged(), rig = inv.worn('chest')!;
    const ammo = inv.makeStack('ammo_9mm', 30);
    inv.set(P(19), ammo);
    expect(inv.takeOff('chest')).toBe('refused');
    expect(inv.moveCount(G('chest'), P(12))).toBe('refused');
    expect([inv.worn('chest'), inv.get(P(19)), inv.pack.length]).toEqual([rig, ammo, 22]);
    expect(inv.moveCount(P(19), P(13))).toBe('moved'); // into the new base row: now the rig comes off
    expect(inv.takeOff('chest')).toBe('moved');
    expect([inv.pack.length, inv.get(P(13)), inv.find(rig.uid)]).toEqual([18, ammo, P(0)]);
    expect(inv.invariants()).toEqual([]);
  });

  it('backpack: click / drag reach the bag\'s new row (12-17); the bag is full at exactly 18', () => {
    const inv = new Inventory(), bag = inv.makeStack('backpack', 1);
    const s = new BagSession(() => inv, {stack: bag, grounded: true});
    expect(s.fill()).toEqual({used: 0, slots: 18});
    inv.set(P(0), inv.makeStack('water', 2));
    expect(s.move(P(0), B(17))).toBe('moved');
    expect(bag.bag![17]!.itemId).toBe('water');
    for (let i = 0; i < 17; i++) { inv.set(P(1), inv.makeStack('rifle', 1)); expect(s.quick(P(1))).toBe(1); }
    expect(s.fill()).toEqual({used: 18, slots: 18});
    expect(bag.bag!.slice(12).map(x => x?.itemId)).toEqual(['rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'water']);
    inv.set(P(1), inv.makeStack('rifle', 1));
    expect(s.quick(P(1))).toBe(0);
    expect(s.refusal?.text).toBe('The backpack is full.');
    expect(s.move(B(16), P(15))).toBe('moved'); // and back out into a new pocket
    expect(inv.get(P(15))!.itemId).toBe('rifle');
    expect(s.move(B(0), B(18))).toBe('refused'); // there is no 19th bag slot
    expect(inv.invariants()).toEqual([]);
  });

  it('Lockbox: click / drag / stow reach the new row (40-49); full at exactly 50; the 1337 drop counts 50 free slots', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    expect(planGrant(box.slots).free).toBe(50);
    for (let i = 0; i < 40; i++) box.slots[i] = inv.makeStack('battery', 1); // the old 40 slots full
    inv.set(P(0), inv.makeStack('ammo_9mm', 30));
    expect(inv.storeQuick(box.slots, P(0))).toBe(30);
    expect(box.slots[40]!.itemId).toBe('ammo_9mm');
    inv.set(P(1), inv.makeStack('water', 3));
    expect(inv.storeMove(box.slots, P(1), S(49))).toBe('moved');
    expect(inv.storeMove(box.slots, S(49), S(45))).toBe('moved');
    const bag = inv.makeStack('backpack', 1);
    inv.add(bag);
    expect(inv.storeWornBag(box.slots)).toBe(true);
    expect(box.slots[41]).toBe(bag);
    expect(inv.storeMove(box.slots, S(45), S(50))).toBe('refused'); // no 51st slot
    for (let i = 42; i < 50; i++) if (!box.slots[i]) box.slots[i] = inv.makeStack('battery', 1);
    expect(box.free).toBe(0);
    inv.set(P(2), inv.makeStack('cola', 1));
    expect([inv.storeQuick(box.slots, P(2)), inv.refusal?.text]).toEqual([0, 'The Lockbox is full.']);
    expect(grantAllOrNothing(box.slots, inv).ok).toBe(false);
    expect([inv.invariants(), box.invariants()]).toEqual([[], []]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The views (Node fake DOM: no layout; the REAL listeners are fired with a target whose closest() is the slot cell)

type Ev = {button: number; target: unknown; preventDefault(): void};
// ONE fake DOM for the file: the gear styles / a view's styles are injected once per module (the registry is shared, so each
// check reads a view's elements right after that view rendered).
const winListeners = new Map<string, ((e: unknown) => void)[]>();
const gw = globalThis as unknown as {window?: unknown};
let prevWindow: unknown;
let dom: FakeDom;
beforeAll(() => {
  prevWindow = gw.window;
  gw.window = {addEventListener: (t: string, f: (e: unknown) => void) => { const l = winListeners.get(t) ?? []; l.push(f); winListeners.set(t, l); }, removeEventListener() {}, innerHeight: 720, innerWidth: 1280};
  dom = installFakeDom();
});
afterAll(() => { dom.uninstall(); gw.window = prevWindow; });

const cellsOf = (box: FakeEl) => box.children.map(c => `${c.dataset.bar}:${c.dataset.index}`);
/** Fire a root element's real 'click' listener on a slot cell (the target's closest() finds the cell for slot selectors only). */
const clickCell = (root: FakeEl, cell: FakeEl | undefined) => {
  expect(cell, 'slot cell').toBeTruthy();
  const e: Ev = {button: 0, target: {closest: (sel: string) => (sel.endsWith('.slot') ? cell : null)}, preventDefault() {}};
  for (const f of root.listeners.get('click') ?? []) f(e);
};
/** The view's CSS for its grid columns: `repeat(N, 1fr)` of a rule. */
const colsOf = (css: string, sel: string) => {
  const m = new RegExp(`${sel.replace(/[.#[\]"=]/g, x => `\\${x}`)} \\{ grid-template-columns: repeat\\((\\d+), 1fr\\); \\}`).exec(css);
  return m ? Number(m[1]) : null;
};
const px = (css: string, sel: string, prop: string) => {
  const r = new RegExp(`${sel.replace(/[.#[\]"=]/g, x => `\\${x}`)} \\{[^}]*\\b${prop}: (\\d+)px`).exec(css);
  expect(r, `${sel} ${prop}`).toBeTruthy();
  return Number(r![1]);
};
/** Height of `n` slots laid out in `cols` columns (rows of `h` px, `gap` px between rows). */
const gridH = (n: number, cols: number, h: number, gap: number) => { const rows = Math.ceil(n / cols); return rows * h + (rows - 1) * gap; };

describe('the inventory screen (ui/inventoryUI.ts): 18 / 22 pockets in 6 columns; drops reach the new row', () => {

  it('renders 18 pocket cells (22 with a rig, the last 4 dashed), the live heading, and its grid takes POCKET_GRID\'s 6 columns', () => {
    const inv = new Inventory();
    const heading = {tagName: 'H3', textContent: ''};
    Object.defineProperty(dom.el('#inv-pack'), 'previousElementSibling', {get: () => heading});
    const ui = new InventoryUI(() => inv, {use() {}, drop() {}, equip() {}, close() {}, changed() {}});
    ui.render();
    const pack = dom.el('#inv-pack');
    expect(cellsOf(pack)).toEqual(Array.from({length: 18}, (_, i) => `pack:${i}`));
    expect(pack.children.some(c => c.classList.contains('gear-extra'))).toBe(false);
    expect(heading.textContent).toBe('Pockets · 18');
    expect(dom.el('#inv-hotbar').children).toHaveLength(HOTBAR_SIZE + THROW_SLOTS + MELEE_SLOTS); // quick / grenade / melee: unchanged
    expect(dom.el('#inv-gear').children).toHaveLength(GEAR_SLOTS.length);
    expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0);
    ui.render();
    expect(cellsOf(pack)).toHaveLength(22);
    expect(pack.children.map(c => c.classList.contains('gear-extra'))).toEqual(Array.from({length: 22}, (_, i) => i >= 18));
    expect(heading.textContent).toBe('Pockets · 22 (18 + 4 from the chest rig)');
    // CSS: the screen's pockets grid is POCKET_GRID's columns (styles.css default + the injected rule), 22 = 3 full rows + 4
    ensureGearStyles();
    const css = dom.doc.head.children.find(c => c.id === 'gear-styles')!.textContent;
    expect(colsOf(css, '#inv-pack')).toBe(6);
    expect(gridRules()).toBe('#inv-pack { grid-template-columns: repeat(6, 1fr); }\n');
    expect(SRC('styles.css')).toMatch(/\.slots\.pack \{ grid-template-columns: repeat\(6, 1fr\); \}/);
  });

  it('a drop (the drag\'s drop step), Drop-free 1-5 assign and a split all reach pockets 12-17 and the rig\'s 18-21', () => {
    const inv = rigged();
    const ui = new InventoryUI(() => inv, {use() {}, drop() {}, equip() {}, close() {}, changed() {}});
    inv.set(H(0), inv.makeStack('pistol', 1, 15));
    inv.set(P(0), inv.makeStack('ammo_9mm', 40));
    expect(ui.dropAt(H(0), P(17))).toBe('moved');
    expect(inv.get(P(17))!.itemId).toBe('pistol');
    expect(dom.el('#inv-pack').children[17].classList.contains('filled')).toBe(true);
    expect(ui.dropAt(P(0), P(21), 10)).toBe('split');
    expect([inv.get(P(21))!.count, inv.get(P(0))!.count]).toEqual([10, 30]);
    expect(dom.el('#inv-pack').children[21].classList.contains('filled')).toBe(true);
    ui.click(P(17));
    ui.assign(3); // 1-5 while the inventory is open: the selected pocket stack into quick slot 4
    expect([inv.get(H(3))!.itemId, inv.get(P(17))]).toEqual(['pistol', null]);
    expect(ui.dropAt(H(3), P(12))).toBe('moved');
    expect(inv.get(P(12))!.itemId).toBe('pistol');
    expect(inv.invariants()).toEqual([]);
  });
});

describe('the grounded-bag view (ui/bagView.ts): 18 pockets + 18 bag slots, each in 6 columns; clicks reach the new rows', () => {

  it('renders and labels the new counts; the real click listener moves items into bag slot 17 / out into a new pocket; drag-move too', () => {
    const inv = new Inventory(), bag = inv.makeStack('backpack', 1);
    for (let i = 0; i < 12; i++) bag.bag![i] = inv.makeStack('rifle', 1); // the old two rows full
    const session = new BagSession(() => inv, {stack: bag, grounded: true});
    const view = new BagView({inv: () => inv, session: () => session, close() {}, wear() {}, changed() {}});
    view.show();
    const root = dom.el('#app').children.find(c => c.id === 'bagview')!;
    expect(root.innerHTML).toContain('<div class="slots bv-g6" data-side="pack">');
    expect(root.innerHTML).toContain('<div class="slots bv-g6" data-side="bag">');
    const pack = dom.el('[data-side="pack"]'), bagSide = dom.el('[data-side="bag"]');
    expect([pack.children.length, bagSide.children.length]).toEqual([18, 18]);
    expect(dom.el('.bv-pockets').textContent).toBe('Pockets · 18');
    expect(dom.el('.bv-bagtitle').textContent).toBe('Faded red daypack · 12/18 slots used');
    inv.set(P(5), inv.makeStack('medkit', 2));
    view.render();
    clickCell(root, pack.children[5]); // pocket -> bag: the first empty bag slot is in the new row
    expect([bag.bag![12]?.itemId, inv.get(P(5))]).toEqual(['medkit', null]);
    expect(dom.el('.bv-bagtitle').textContent).toBe('Faded red daypack · 13/18 slots used');
    expect(view.move(B(12), B(17))).toBe('moved'); // the drag QA hook: within the bag's new row
    clickCell(root, dom.el('[data-side="bag"]').children[17]); // bag -> you
    expect([bag.bag![17], inv.get(H(0))?.itemId]).toEqual([null, 'medkit']); // (a consumable: quick slots first)
    for (let i = 0; i < 17; i++) inv.set(P(i), inv.makeStack('rifle', 1)); // fill pockets 0-16: the bag's next item goes to pocket 17
    inv.set(H(0), inv.makeStack('rifle', 1)); inv.set(H(1), inv.makeStack('rifle', 1)); inv.set(H(2), inv.makeStack('rifle', 1)); inv.set(H(3), inv.makeStack('rifle', 1)); inv.set(H(4), inv.makeStack('rifle', 1));
    view.render();
    clickCell(root, dom.el('[data-side="bag"]').children[0]);
    expect(inv.get(P(17))?.itemId).toBe('rifle');
    expect(dom.el('[data-side="pack"]').children[17].classList.contains('filled')).toBe(true);
    // with a rig: 22 pockets in the same grid, the 4 extra dashed; the heading says so
    inv.set(P(17), null);
    expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0);
    view.render();
    expect(dom.el('[data-side="pack"]').children.map(c => c.classList.contains('gear-extra'))).toEqual(Array.from({length: 22}, (_, i) => i >= 18));
    expect(dom.el('.bv-pockets').textContent).toBe('Pockets · 22 (18 + 4 chest rig)');
    expect([inv.invariants(), view.last?.result]).toEqual([[], '1']);
  });
});

describe('the Lockbox view (ui/lockboxView.ts): 50 slots in 10 columns, pockets in 6; clicks / drags / stow reach the new row', () => {

  it('renders "Lockbox · n/50 slots used", 50 store cells + 18 / 22 pockets; the real click listener stores into slot 40+; CSS unchanged in shape', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    for (let i = 0; i < 40; i++) box.slots[i] = inv.makeStack('battery', 1);
    const view = new LockboxView({inv: () => inv, slots: () => box.slots, close() {}, changed() {}});
    view.show();
    const root = dom.el('#app').children.find(c => c.id === 'lockboxview')!;
    expect(root.innerHTML).toContain('<div class="slots lb-g6" data-side="pack">');
    expect(root.innerHTML).toContain('<div class="slots lb-g10" data-side="store">');
    const store = dom.el('[data-side="store"]'), pack = dom.el('[data-side="pack"]');
    expect([store.children.length, pack.children.length]).toEqual([50, 18]);
    expect(dom.el('.lb-title').textContent).toBe('Lockbox · 40/50 slots used');
    expect(dom.el('.lb-pockets').textContent).toBe('Pockets · 18');
    inv.set(P(16), inv.makeStack('ammo_12ga', 20));
    view.render();
    clickCell(root, dom.el('[data-side="pack"]').children[16]); // pocket 16 (new row) -> the Lockbox's first free slot (the new row)
    expect([box.slots[40]?.itemId, inv.get(P(16))]).toEqual(['ammo_12ga', null]);
    expect(dom.el('.lb-title').textContent).toBe('Lockbox · 41/50 slots used');
    expect(view.move(S(40), S(49))).toBe('moved'); // the drag QA hook: within the new row
    expect(view.move(S(49), P(13))).toBe('moved'); // out into a new pocket
    expect(inv.get(P(13))!.itemId).toBe('ammo_12ga');
    inv.add(inv.makeStack('backpack', 1));
    expect(view.stow()).toBe(true);
    expect(box.slots[40]!.itemId).toBe('backpack');
    clickCell(root, dom.el('[data-side="store"]').children[40]); // a backpack taken out is worn
    expect([inv.worn('backpack')?.itemId, box.slots[40]]).toEqual(['backpack', null]);
    expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0);
    view.render();
    expect(dom.el('[data-side="pack"]').children).toHaveLength(22);
    expect(dom.el('.lb-pockets').textContent).toBe('Pockets · 22 (18 + 4 chest rig)');
    // CSS: the store grid keeps 10 columns (50 = 5 full rows), the pockets 6; the panel width formula is unchanged (1240 px)
    const css = dom.doc.head.children.find(c => c.id === 'lockbox-styles')!.textContent;
    expect(colsOf(css, '#lockboxview .lb-g10')).toBe(10);
    expect(colsOf(css, '#lockboxview .lb-g6')).toBe(6);
    expect(css).toContain('#lockboxview .lb-panel { width: min(1240px, calc(100vw - 24px));');
    expect(css).toContain('#lockboxview .lb-cols { display: grid; grid-template-columns: 7fr 26px 10fr;');
    expect(css).not.toMatch(/\.lb-g(?!6|7|10)\d+ \{/); // no generated rule needed for today's shapes
    expect([inv.invariants(), box.invariants()]).toEqual([[], []]);
  });
});

describe('layout: the extra row still fits 1280 × 720 (CSS arithmetic from the real rules; no browser)', () => {
  // Fixed chrome around the grids (px, generous): panel padding 10 + 10, borders 4, the head line 24, the note 22, the action
  // buttons 35, the help line 18; each h4 grid heading 21. Both views stand on padding-bottom 92 px (above the HUD hotbar).
  const CHROME = 10 + 10 + 4 + 24 + 22 + 35 + 18, HEADING = 21;

  it('Lockbox view: max(left: quick row + 22 pockets, right: 50 slots) + chrome + the bottom inset <= 720 px', () => {
    const view = new LockboxView({inv: () => new Inventory(), slots: () => new TrainLockbox().slots, close() {}, changed() {}});
    view.show();
    const css = dom.doc.head.children.find(c => c.id === 'lockbox-styles')!.textContent;
    const h = px(css, '#lockboxview .slot', 'height'), gap = px(css, '#lockboxview .slots', 'gap'), bottom = px(css, '#lockboxview', 'padding-bottom');
    expect([h, gap, bottom]).toEqual([54, 6, 92]);
    const left = HEADING + gridH(7, 7, h, gap) + HEADING + gridH(PACK_SIZE + 4, POCKET_GRID.columns, h, gap);
    const right = HEADING + gridH(LOCKBOX_SLOTS, LOCKBOX_GRID.columns, h, gap);
    expect([left, right]).toEqual([330, 315]);
    expect(CHROME + Math.max(left, right) + bottom).toBeLessThanOrEqual(720 - 24); // 545 px: a wide margin
  });

  it('bag view: max(left: quick row + 22 pockets, right: 18 bag slots) + chrome + the bottom inset <= 720 px', () => {
    ensureGearStyles();
    const css = dom.doc.head.children.find(c => c.id === 'gear-styles')!.textContent;
    const h = px(css, '#bagview .slot', 'height'), gap = px(css, '#bagview .slots', 'gap'), bottom = px(css, '#bagview', 'padding-bottom');
    expect([h, gap, bottom]).toEqual([58, 6, 92]);
    expect([colsOf(css, '#bagview .bv-g6'), colsOf(css, '#bagview .bv-g7')]).toEqual([6, 7]);
    const left = HEADING + gridH(7, 7, h, gap) + HEADING + gridH(PACK_SIZE + 4, POCKET_GRID.columns, h, gap);
    const right = HEADING + gridH(BACKPACK_SLOTS, BACKPACK_GRID.columns, h, gap);
    expect([left, right]).toEqual([350, 207]);
    expect(CHROME + Math.max(left, right) + bottom).toBeLessThanOrEqual(720 - 24); // 565 px
  });

  it('the inventory screen keeps its scroll-from-the-top rule for short viewports (it was already taller than 720 px with 12 pockets)', () => {
    ensureGearStyles();
    const css = dom.doc.head.children.find(c => c.id === 'gear-styles')!.textContent;
    expect(css).toContain('#inventory.screen { align-items: safe center; }');
    expect(SRC('styles.css')).toMatch(/\.screen \{[^}]*overflow: auto;/);
  });
});
