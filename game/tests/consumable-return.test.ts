// Task studio-beta-mouse-axis-invert-20261105-005156-01 — authorized user follow-up: "when switching from an item (eg gun) to a consumable
// item (eg chocolate bar), after consuming it, auto switch back to original item that you came from". Task studio-beta-consumable-stack-
// return-20261105-045347-01 — the user's correction (it SUPERSEDES "return even with units left"): "it should only apply if you consume the
// last item in the stack. If there are more items in the stack, i.e. bandages, it should stay selected so the player may consume multiple".
//
// The REAL Game methods (slotKeys / selectSlot / selectMelee / equipRef / startUse / completeUse / cancelUse / syncHeld) on a minimal shell
// with the real Inventory, WeaponController, Survival and FlashlightBattery: gun -> a stack -> it stays selected while units are left (the
// remembered item unchanged across uses) -> the use that EMPTIES that stack brings the same gun back; every held consumable kind (food,
// drink, bandage / med kit, battery); the knife; consumable -> consumable; never another stack of the same item; the source moved / gone
// (a safe fallback, never another item now in the old slot); a newer manual choice / cancel / refused use (no return, nothing applied
// twice); quick heal / an inventory use of another stack (no return); the held button never fires the restored weapon, and a stack that
// stays selected is never left latched (the next use is an ordinary fresh press).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {Inventory, MELEE_REF, type ItemStack, type SlotRef} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import {starterInventory} from '../src/run/starter';
import {Survival} from '../src/player/survival';
import {FlashlightBattery} from '../src/player/flashlight';

const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const {Game} = await import('../src/game');

type Shell = {
  inv: Inventory; weapon: InstanceType<typeof WeaponController>; input: {mouse: boolean[]}; lmbLatch: boolean; use: {t: number; total: number; held?: {index: number}} | null;
  toasts: string[]; views: string[]; survival: Survival; torch: {battery: FlashlightBattery}; player: {hp: number; maxHp: number; heal(n: number): number};
  slotKeys(i: {hit(c: string): boolean; wheel: number}): void; selectMelee(): boolean; equipRef(r: SlotRef): void; startUse(r: SlotRef): void; completeUse(): void;
  cancelUse(reason: string): void; quickHeal(): void; syncHeld(): void; consumeReturn: unknown;
};

function shell(inv: Inventory = starterInventory('pistol')): Shell {
  const views: string[] = [], toasts: string[] = [];
  const s = {
    inv, weapon: new WeaponController(), input: {mouse: [false, false, false]}, lmbLatch: false, use: null, consumeReturn: null, toasts, views, state: 'playing',
    survival: new Survival(), torch: {battery: new FlashlightBattery(() => 0.5)}, mods: {handlingMult: 1},
    player: {hp: 50, maxHp: 100, heal(n: number) { const h = Math.min(n, this.maxHp - this.hp); this.hp += h; return h; }},
    stats: {itemsUsed: 0, healed: 0}, gasMask: {transitioning: false}, flareHold: {active: false}, gear: null, invUI: {selected: null as SlotRef | null},
    injuries: {refuseReason: () => null, healNote: () => '', completeTreatment: (_d: unknown, take: () => boolean) => (take() ? {ok: true, text: 'Treated'} : {ok: false, text: 'Nothing to treat'})},
    consumeView: {start: (id: string, _t: number, mode: string) => views.push(`start:${id}:${mode}`), complete: (keep: boolean) => views.push(`complete:${keep}`), cancel: (r: string) => views.push(`cancel:${r}`)},
    sfx: {equip() {}, denied() {}, heal() {}, eat() {}, drink() {}, batteryInsert() {}},
    viewmodel: {setItem: (_id: string | null) => {}},
    hud: {toast: (t: string) => { toasts.push(t); }},
  };
  Object.setPrototypeOf(s, Game.prototype);
  const g = s as unknown as Shell;
  g.survival.hunger = 40;
  g.survival.thirst = 40;
  g.syncHeld();
  return g;
}
const press = (g: Shell, code: string) => g.slotKeys({hit: c => c === code, wheel: 0});
/** Left click with the held consumable (Game.update: startUse(selectedRef)), then the use runs to its end (completeUse). */
function consumeHeld(g: Shell, holdButton = false): void {
  g.input.mouse[0] = holdButton;
  g.startUse(g.inv.selectedRef());
  expect(g.use).not.toBeNull();
  g.use!.t = g.use!.total;
  g.completeUse();
}
const heldId = (g: Shell) => (g.inv.meleeSelected ? `melee:${g.inv.melee?.itemId}` : `${g.inv.selected}:${g.inv.selectedStack()?.itemId ?? 'empty'}`);

describe('gun -> a consumable stack: it stays selected while units are left; the use that empties it brings the gun back', () => {
  it('pistol -> bandages (3): stays after use 1 and 2 (the pistol still remembered, unchanged), use 3 empties it -> the same pistol', () => {
    const g = shell();
    const pistol = g.inv.get(H(0))!;
    g.player.hp = 20;
    const band = g.inv.makeStack('bandage', 3);
    g.inv.set(H(2), band);
    press(g, 'Digit3');
    const pending = structuredClone(g.consumeReturn);
    expect(pending).toEqual({melee: false, uid: pistol.uid, consumableUid: band.uid});
    consumeHeld(g);
    expect([band.count, heldId(g), g.weapon.stack]).toEqual([2, '2:bandage', null]);
    expect(g.consumeReturn).toEqual(pending); // never overwritten by the consumable itself between uses
    expect(g.views.slice(-2)).toEqual(['start:bandage:hand', 'complete:true']); // back into the hand, ready for the next one
    consumeHeld(g);
    expect([band.count, heldId(g)]).toEqual([1, '2:bandage']);
    expect(g.consumeReturn).toEqual(pending);
    consumeHeld(g);
    expect([g.inv.get(H(2)), heldId(g), g.weapon.stack]).toEqual([null, '0:pistol', pistol]);
    expect(g.views.at(-1)).toBe('complete:false'); // the last one lowers away, the pistol comes back
    expect(g.toasts.filter(t => /^Bandage used/.test(t))).toHaveLength(3); // each exactly once
    expect(g.consumeReturn).toBeNull();
    expect(g.player.hp).toBe(80);
  });

  it('every held consumable kind: a 1-unit stack returns at once; a 2-unit stack stays once, then returns', () => {
    for (const id of ['chocolate', 'water', 'cola', 'bandage', 'medkit', 'battery']) {
      for (const n of [1, 2]) {
        const g = shell();
        g.torch.battery.charge = 0.3;
        g.player.hp = 10;
        g.inv.set(H(3), g.inv.makeStack(id, n));
        press(g, 'Digit4');
        consumeHeld(g);
        if (n === 2) {
          expect([id, heldId(g), g.inv.get(H(3))?.count]).toEqual([id, `3:${id}`, 1]);
          if (id === 'battery') g.torch.battery.charge = 0.3; // (the first one charged it: a full light refuses a battery)
          consumeHeld(g);
        }
        expect([id, n, heldId(g), g.inv.get(H(3))]).toEqual([id, n, '0:pistol', null]);
      }
    }
  });

  it('never another stack of the same item: the last unit of the SELECTED stack returns the pistol; the pocket stack stays untouched', () => {
    const g = shell();
    g.player.hp = 10;
    const pocket = g.inv.makeStack('bandage', 5);
    g.inv.set(P(6), pocket);
    g.inv.set(H(2), g.inv.makeStack('bandage', 1));
    press(g, 'Digit3');
    consumeHeld(g);
    expect([heldId(g), pocket.count, g.inv.find(pocket.uid)]).toEqual(['0:pistol', 5, P(6)]);
  });

  it('the knife (melee slot) -> food -> back to the drawn knife; consumable -> consumable keeps the item first switched from', () => {
    const g = shell();
    g.inv.set(H(2), g.inv.makeStack('chocolate', 2));
    g.inv.set(H(3), g.inv.makeStack('water', 1));
    press(g, 'Backquote');
    expect(heldId(g)).toBe('melee:knife');
    press(g, 'Digit3');
    consumeHeld(g);
    expect(heldId(g)).toBe('2:chocolate'); // one bar left: stays
    consumeHeld(g);
    expect([heldId(g), g.weapon.def?.id]).toEqual(['melee:knife', 'knife']);
    press(g, 'Digit1'); // the pistol
    g.inv.set(H(2), g.inv.makeStack('chocolate', 2));
    press(g, 'Digit3'); // chocolate ...
    press(g, 'Digit4'); // ... then the last water: back to the pistol
    consumeHeld(g);
    expect(heldId(g)).toBe('0:pistol');
  });

  it('the held button: the LAST use never fires / swings the restored weapon (latched until released); a stack that stays is not latched', () => {
    const g = shell();
    const choc = g.inv.makeStack('chocolate', 2);
    g.inv.set(H(2), choc);
    press(g, 'Digit3');
    consumeHeld(g, true); // the button still down when the first bar is done
    expect([heldId(g), g.lmbLatch]).toEqual(['2:chocolate', false]); // stays selected, nothing latched
    g.input.mouse[0] = false;
    g.startUse(g.inv.selectedRef()); // the next fresh press starts the next bar as usual (no auto-repeat: Game.update needs mousePressed)
    expect(g.use).not.toBeNull();
    g.input.mouse[0] = true;
    g.use!.t = g.use!.total;
    g.completeUse(); // the last bar, button held
    expect([heldId(g), g.lmbLatch]).toEqual(['0:pistol', true]);
    // Game.update: a latched button is not the gun's (flareOwns includes lmbLatch -> weapon held / pressed false) until released
    const gsrc = src('../src/game.ts');
    expect(gsrc).toMatch(/const flareOwns = this\.flareHold\.active \|\| this\.lmbLatch \|\| laneOwns;/);
    expect(gsrc).toMatch(/held: inp\.mouse\[0\] && !flareOwns && !rideHolster, pressed: inp\.mousePressed\[0\] && !flareOwns/);
    expect(gsrc).toMatch(/if \(this\.lmbLatch && !inp\.mouse\[0\]\) this\.lmbLatch = false;/);
    expect(gsrc).toMatch(/\} else if \(heldDef\?\.kind === 'consumable' && inp\.mousePressed\[0\] && !this\.use && !flareOwns\) \{/); // uses start on a press edge only
    const g2 = shell();
    g2.inv.set(H(2), g2.inv.makeStack('chocolate', 1));
    press(g2, 'Digit3');
    consumeHeld(g2, false);
    expect([heldId(g2), g2.lmbLatch]).toEqual(['0:pistol', false]); // released already: no latch needed
  });
});

describe('the source is gone or moved: a safe fallback, never a stale or different item', () => {
  it('the pistol moved to the pockets: the last bar leaves the (empty) food slot selected; another item now in slot 1 is NOT drawn', () => {
    const g = shell();
    g.inv.set(H(2), g.inv.makeStack('chocolate', 2));
    press(g, 'Digit3');
    const pistol = g.inv.get(H(0))!;
    g.inv.move(H(0), P(10)); // the pistol into the pockets (inventory drag)
    g.inv.set(H(0), g.inv.makeStack('rifle', 1, 30)); // and a rifle into slot 1
    consumeHeld(g);
    expect(heldId(g)).toBe('2:chocolate');
    consumeHeld(g);
    expect([heldId(g), g.weapon.stack]).toEqual(['2:empty', null]);
    expect(g.inv.find(pistol.uid)).toEqual(P(10));
    expect(g.consumeReturn).toBeNull();
  });

  it('the pistol moved to another QUICK slot: the same pistol is drawn there; dropped entirely: nothing stale, the empty food slot stays', () => {
    const g = shell();
    g.inv.set(H(2), g.inv.makeStack('chocolate', 1));
    press(g, 'Digit3');
    const pistol = g.inv.get(H(0))!;
    g.inv.move(H(0), H(4)); // swaps with the bandage
    consumeHeld(g);
    expect([heldId(g), g.weapon.stack]).toEqual(['4:pistol', pistol]);
    const g2 = shell();
    g2.inv.set(H(2), g2.inv.makeStack('chocolate', 1));
    press(g2, 'Digit3');
    g2.inv.detach(H(0)); // dropped
    consumeHeld(g2);
    expect([heldId(g2), g2.weapon.stack]).toEqual(['2:empty', null]);
    expect(g2.consumeReturn).toBeNull(); // nothing left pending
  });
});

describe('the player\'s newer choice wins; failed / cancelled / other uses return nothing and apply nothing twice', () => {
  it('a manual switch during the use cancels it (nothing eaten) and clears the return; a later use from a fresh pick has none', () => {
    const g = shell();
    const choc = g.inv.makeStack('chocolate', 3);
    g.inv.set(H(2), choc);
    g.inv.set(H(1), g.inv.makeStack('rifle', 1, 30));
    press(g, 'Digit3');
    g.startUse(g.inv.selectedRef());
    press(g, 'Digit2'); // the rifle, mid-bite
    expect([g.use, choc.count, heldId(g)]).toEqual([null, 3, '1:rifle']);
    expect(g.views.at(-1)).toBe('cancel:slot');
    expect(g.consumeReturn).toBeNull();
    // from an EMPTY slot to the food: nothing was held, nothing to return to — even after the last bar
    press(g, 'Digit4'); // (slot 4 empty)
    press(g, 'Digit3');
    for (let i = 0; i < 3; i++) consumeHeld(g);
    expect([g.inv.get(H(2)), heldId(g)]).toEqual([null, '2:empty']);
  });

  it('a manual pick BETWEEN uses is the newer choice: pistol -> bandages, one used, then the rifle, then the bandages again -> the rifle', () => {
    const g = shell();
    g.player.hp = 10;
    const rifle = g.inv.makeStack('rifle', 1, 30);
    g.inv.set(H(1), rifle);
    g.inv.set(H(2), g.inv.makeStack('bandage', 2));
    press(g, 'Digit3');
    consumeHeld(g);
    expect(heldId(g)).toBe('2:bandage');
    press(g, 'Digit2');
    expect(g.consumeReturn).toBeNull(); // a non-consumable picked: nothing pending
    press(g, 'Digit3');
    expect(g.consumeReturn).toMatchObject({uid: rifle.uid});
    consumeHeld(g);
    expect([heldId(g), g.weapon.stack]).toEqual(['1:rifle', rifle]);
  });

  it('cancelled (a hit) or refused (not hungry): nothing consumed, no return; then the stack is used up and returns once, at the last bar', () => {
    const g = shell();
    const choc = g.inv.makeStack('chocolate', 3);
    g.inv.set(H(2), choc);
    press(g, 'Digit3');
    g.startUse(g.inv.selectedRef());
    g.cancelUse('hit');
    expect([choc.count, heldId(g)]).toEqual([3, '2:chocolate']);
    g.survival.hunger = 100;
    g.startUse(g.inv.selectedRef());
    expect(g.use).toBeNull(); // "You're not hungry": refused at the start
    expect([choc.count, heldId(g), g.toasts.at(-1)]).toEqual([3, '2:chocolate', "You're not hungry"]);
    g.survival.hunger = 40;
    consumeHeld(g);
    consumeHeld(g);
    expect([choc.count, heldId(g)]).toEqual([1, '2:chocolate']);
    consumeHeld(g);
    expect(heldId(g)).toBe('0:pistol');
    expect(g.toasts.filter(t => /^Ate chocolate bar/.test(t))).toHaveLength(3);
    g.startUse(g.inv.selectedRef()); // (the pistol: not a consumable — no use)
    expect(g.use).toBeNull();
  });

  it('a battery refused at the END (already charged meanwhile): nothing used, no return; quick heal / an inventory use of another stack: no return', () => {
    const g = shell();
    g.inv.set(H(3), g.inv.makeStack('battery', 1));
    g.torch.battery.charge = 0.4;
    press(g, 'Digit4');
    g.startUse(g.inv.selectedRef());
    g.torch.battery.charge = 1; // e.g. another battery went in
    g.use!.t = g.use!.total;
    g.completeUse();
    expect([g.inv.get(H(3))?.count, heldId(g)]).toEqual([1, '3:battery']);
    // the food held (return pending), a bandage used from the INVENTORY (not the held stack): the food stays held, still pending
    const g2 = shell();
    g2.inv.set(H(2), g2.inv.makeStack('chocolate', 1));
    press(g2, 'Digit3');
    g2.startUse(H(4)); // the starter bandage, via the inventory's Use
    expect(g2.use!.held).toBeUndefined();
    g2.use!.t = g2.use!.total;
    g2.completeUse();
    expect([heldId(g2), g2.inv.get(H(4))]).toEqual(['2:chocolate', null]);
    consumeHeld(g2);
    expect(heldId(g2)).toBe('0:pistol');
  });

  it('an inventory Equip of food into the held slot is a deliberate pick too; the swapped-out pistol went to the pockets: no stale return', () => {
    const g = shell();
    const choc = g.inv.makeStack('chocolate', 2);
    g.inv.set(P(5), choc);
    g.equipRef(P(5));
    expect(heldId(g)).toBe('0:chocolate');
    consumeHeld(g);
    expect([choc.count, heldId(g)]).toEqual([1, '0:chocolate']);
    consumeHeld(g);
    expect([g.inv.get(H(0)), heldId(g), g.weapon.stack]).toEqual([null, '0:empty', null]);
  });
});

describe('scope', () => {
  it('a new station / Retry clears a pending return; the grenade slot and G are untouched', () => {
    const gsrc = src('../src/game.ts');
    expect(gsrc).toMatch(/this\.consumeReturn = null; \/\/ \(consumable return: a new station \/ Retry starts with nothing pending\)/);
    expect(gsrc.split('\n').filter(l => /consumeReturn/.test(l) && /throw|flareHold|KeyG/.test(l))).toEqual([]);
    const inv = new Inventory();
    expect(inv.get(MELEE_REF)).toBeNull();
  });

  it('(stack identity: the return is by uid — the object in a slot, never its position)', () => {
    const g = shell();
    const a: ItemStack = g.inv.get(H(0))!;
    g.inv.set(H(2), g.inv.makeStack('chocolate', 1));
    press(g, 'Digit3');
    expect(g.consumeReturn).toEqual({melee: false, uid: a.uid, consumableUid: g.inv.get(H(2))!.uid});
  });
});
