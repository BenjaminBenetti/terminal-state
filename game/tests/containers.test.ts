import {describe, expect, it} from 'vitest';
import {Inventory, HOTBAR_SIZE, PACK_SIZE} from '../src/items/inventory';
import {
  createHolderState, holderPrompt, lotPrompt, nextHolderAction, rollHolderLots, takeAll, takeLot, transferMessage,
  type HolderKind,
} from '../src/items/loot';
import {DEFAULT_SHELF, cabinetInsert, holderSurfaces, placementBox, type Dims} from '../src/items/lootLayout';
import {PROP_DEFS, PURPOSE_HOLDER_KINDS, type PurposeHolderKind} from '../src/gen/props';
import {P7_HOLDER_KINDS, type P7HolderKind} from '../src/gen/props07';
import {OPENABLE_CONTAINER_KINDS, type OpenableContainerKind} from '../src/world/openablesSpec';

const DIMS: Record<HolderKind, Dims> = {
  desk: {w: 1.5, d: 0.75, h: 0.76},
  cabinetTall: PROP_DEFS.cabinetTall, cabinetLow: PROP_DEFS.cabinetLow, crate: PROP_DEFS.crate,
  shelf: {w: 1.2, d: 0.45, h: 1.85}, stall: {w: 2.4, d: 1.2, h: 2.4}, vending: {w: 0.95, d: 0.85, h: 1.85}, table: {w: 1.4, d: 1.6, h: 0.76},
  shopCounter: PROP_DEFS.shopCounter, shopDisplay: PROP_DEFS.shopDisplay, shopBackbar: PROP_DEFS.shopBackbar, shopCooler: PROP_DEFS.shopCooler,
  // Iteration 05 purpose holders (authored dims).
  ...Object.fromEntries(PURPOSE_HOLDER_KINDS.map(k => [k, PROP_DEFS[k]])) as unknown as Record<PurposeHolderKind, Dims>,
  // Iteration 07 (Lane P2) generated holders (measured model bounds).
  ...Object.fromEntries(P7_HOLDER_KINDS.map(k => [k, PROP_DEFS[k]])) as unknown as Record<P7HolderKind, Dims>,
  // Iteration 08 (Lane I) openable containers (tests/openables.test.ts covers them).
  ...Object.fromEntries(OPENABLE_CONTAINER_KINDS.map(k => [k, PROP_DEFS[k]])) as unknown as Record<OpenableContainerKind, Dims>,
};
const surfaces = (k: HolderKind) => holderSurfaces(k, DIMS[k]);
const ROOMS = ['storage', 'crew-room', 'utility', 'agent-office', 'supply-closet', 'stock-room', 'food-court', 'platform', 'something-new'];
const FOOD_DRINK = new Set(['water', 'cola', 'juice', 'chocolate', 'chips', 'beans', 'noodles']);

describe('visible loot holders', () => {
  it('most containers, shelves and vending machines hold something; empties are rare', () => {
    for (const kind of ['cabinetTall', 'cabinetLow', 'crate', 'shelf', 'stall', 'vending'] as HolderKind[]) {
      let nonEmpty = 0, lots = 0;
      const N = 300;
      for (let i = 0; i < N; i++) {
        const l = rollHolderLots(4242, i, kind, ROOMS[i % ROOMS.length], surfaces(kind));
        if (l.length) nonEmpty++;
        lots += l.length;
      }
      expect(nonEmpty / N, kind).toBeGreaterThan(0.8);
      expect(lots / N, kind).toBeGreaterThanOrEqual(kind === 'crate' ? 1.4 : 1.8); // crates: one small 0.55 m floor
    }
  });

  it('room type shapes the loot: food courts are food/drink, vending sells no tins or ammo', () => {
    const items = (kind: HolderKind, room: string) => Array.from({length: 200}, (_, i) => rollHolderLots(9, i, kind, room, surfaces(kind))).flat().map(l => l.itemId);
    const court = items('shelf', 'food-court');
    expect(court.filter(id => FOOD_DRINK.has(id)).length / court.length).toBeGreaterThan(0.9);
    const vend = items('vending', 'concourse');
    expect(vend.every(id => FOOD_DRINK.has(id) && id !== 'beans')).toBe(true);
    const util = items('cabinetTall', 'utility');
    expect(util.some(id => id.startsWith('ammo'))).toBe(true);
    expect(util.some(id => FOOD_DRINK.has(id))).toBe(true);
  });

  it('every item is placed visibly ON a real surface, inside the holder, without overlaps', () => {
    for (const kind of ['cabinetTall', 'cabinetLow', 'crate', 'shelf', 'stall', 'vending', 'table'] as HolderKind[]) {
      const S = surfaces(kind);
      expect(S.length, kind).toBeGreaterThan(0);
      for (let i = 0; i < 120; i++) {
        const lots = rollHolderLots(31337, i, kind, ROOMS[i % ROOMS.length], S);
        for (const l of lots) {
          const s = S[l.surface];
          const b = placementBox(l.itemId, l);
          expect(l.y).toBe(s.y);
          expect(b.min[0]).toBeGreaterThanOrEqual(s.x0 - 1e-6);
          expect(b.max[0]).toBeLessThanOrEqual(s.x1 + 1e-6);
          expect(b.min[2]).toBeGreaterThanOrEqual(s.z0 - 1e-6);
          expect(b.max[2]).toBeLessThanOrEqual(s.z1 + 1e-6);
          expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(s.clear);
          if (kind !== 'vending') {
            // Inside the holder footprint/height (vending stock spills out in front by design).
            expect(Math.abs(b.min[0]) <= DIMS[kind].w / 2 && Math.abs(b.max[0]) <= DIMS[kind].w / 2).toBe(true);
            if (kind === 'table') expect(b.min[1]).toBeGreaterThanOrEqual(DIMS.table.h);
            else expect(b.max[1]).toBeLessThanOrEqual(DIMS[kind].h + 1e-6);
          } else expect(b.min[2]).toBeGreaterThan(DIMS.vending.d / 2);
        }
        for (const a of lots) for (const c of lots) {
          if (a === c || a.surface !== c.surface) continue;
          const A = placementBox(a.itemId, a), C = placementBox(c.itemId, c);
          expect(A.max[0] <= C.min[0] + 1e-6 || C.max[0] <= A.min[0] + 1e-6, `${kind} overlap`).toBe(true);
        }
      }
    }
  });

  it('cabinet interiors use the shelving unit tiers (data-driven), low cupboard gets a cut section ×2', () => {
    const tall = cabinetInsert('cabinetTall', DIMS.cabinetTall, DEFAULT_SHELF);
    expect(tall.sections.length).toBe(1);
    expect(tall.tiers.length).toBe(DEFAULT_SHELF.tierY.length);
    const low = cabinetInsert('cabinetLow', DIMS.cabinetLow, DEFAULT_SHELF);
    expect(low.sections.length).toBe(2);
    expect(low.tiers.length).toBe(2);
    expect(low.sections[0].cutY).toBeLessThan(DEFAULT_SHELF.h);
    const custom = cabinetInsert('cabinetTall', DIMS.cabinetTall, {...DEFAULT_SHELF, tierY: [0.2, 0.9, 1.5]});
    expect(custom.tiers.length).toBe(3);
  });

  it('finite and stable: same seed → same lots; reopening never rerolls; taking never adds', () => {
    const a = rollHolderLots(777, 3, 'cabinetTall', 'storage', surfaces('cabinetTall'));
    expect(rollHolderLots(777, 3, 'cabinetTall', 'storage', surfaces('cabinetTall'))).toEqual(a);
    const other = Array.from({length: 20}, (_, i) => rollHolderLots(778, i, 'shelf', 'storage', surfaces('shelf')));
    const same = Array.from({length: 20}, (_, i) => rollHolderLots(777, i, 'shelf', 'storage', surfaces('shelf')));
    expect(other).not.toEqual(same);

    const inv = new Inventory();
    const s = createHolderState(1, 0, 'cabinetLow', 'storage', surfaces('cabinetLow'), [
      {id: 0, itemId: 'water', count: 1, surface: 0, x: -0.2, y: 0.2, z: 0, yaw: 0, orient: 'up'},
      {id: 1, itemId: 'ammo_rifle', count: 9, surface: 0, x: 0.2, y: 0.2, z: 0, yaw: 0, orient: 'up'},
    ]);
    expect(nextHolderAction(s)).toBe('open');
    s.open = true; s.searched = true; // [E] opens: contents become visible, nothing is auto-taken
    expect(inv.count('water')).toBe(0);
    expect(nextHolderAction(s)).toBe('take');
    expect(holderPrompt(s, {roomForAny: true}).text).toMatch(/Take all \(2\)/);
    expect(lotPrompt(s.lots[0], true).text).toMatch(/Bottled water · \+35 water/);
    const r = takeLot(s, 0, inv);
    expect(r.taken).toEqual([{itemId: 'water', count: 1}]);
    expect(s.lots.map(l => l.id)).toEqual([1]);
    takeAll(s, inv);
    expect(inv.count('ammo_rifle')).toBe(9);
    expect(nextHolderAction(s)).toBe('close');
    s.open = false; // close + reopen: still empty, clearly labelled
    expect(holderPrompt(s, {roomForAny: true}).text).toMatch(/searched — empty/);
    s.open = true;
    expect(takeAll(s, inv).taken).toEqual([]);
    expect(inv.count('ammo_rifle') + inv.count('water')).toBe(10);
    expect(inv.invariants()).toEqual([]);
  });

  it('a full inventory leaves items visible in place; a later take gets them', () => {
    const inv = new Inventory();
    for (let i = 0; i < HOTBAR_SIZE + PACK_SIZE; i++) inv.add(inv.makeStack(i % 2 ? 'rifle' : 'shotgun', 1));
    const s = createHolderState(1, 3, 'shelf', 'stock-room', surfaces('shelf'), [
      {id: 7, itemId: 'beans', count: 1, surface: 1, x: 0, y: 0.55, z: 0, yaw: 0, orient: 'up'},
      {id: 8, itemId: 'ammo_shells', count: 6, surface: 2, x: 0.1, y: 1.0, z: 0, yaw: 0, orient: 'up'},
    ]);
    expect(s.open).toBe(true); // shelves are open surfaces
    const r = takeAll(s, inv);
    expect(r.taken).toEqual([]);
    expect(r.blocked).toEqual([{itemId: 'beans', count: 1}, {itemId: 'ammo_shells', count: 6}]);
    expect(transferMessage(s, r).warn).toBe(true);
    expect(s.lots.map(l => [l.id, l.x, l.y])).toEqual([[7, 0, 0.55], [8, 0.1, 1.0]]); // same spots, still visible
    const one = takeLot(s, 7, inv);
    expect(one.taken).toEqual([]);
    expect(holderPrompt(s, {roomForAny: false}).text).toMatch(/no room/);
    inv.remove({bar: 'pack', index: 0});
    inv.remove({bar: 'pack', index: 1});
    expect(takeLot(s, 7, inv).taken).toEqual([{itemId: 'beans', count: 1}]);
    expect(takeAll(s, inv).taken).toEqual([{itemId: 'ammo_shells', count: 6}]);
    expect(s.lots).toEqual([]);
    expect(inv.invariants()).toEqual([]);
  });

  it('vending machines must be pried open before their stock is visible/takeable', () => {
    const s = createHolderState(5, 0, 'vending', 'concourse', surfaces('vending'));
    expect(s.open).toBe(false);
    expect(nextHolderAction(s)).toBe('pry');
    expect(holderPrompt(s, {roomForAny: true}).text).toMatch(/Pry open vending machine/);
    s.open = true; s.searched = true;
    expect(nextHolderAction(s)).toBe(s.lots.length ? 'take' : 'none');
  });
});
