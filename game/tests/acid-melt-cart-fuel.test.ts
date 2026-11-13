// Task studio-refinement-scope-finish-20261113-080904-01: "A melted fuel cart must preserve ALL its fuel, including the sub-can remainder,
// as recoverable physical contents. No rounding loss, free rounding up, hidden inventory deletion or silent exemption from melting ...
// keep the exact amount through pickup/use, Save/Continue/Retry/import-export."
//
// The representation is the game's own: fuel is whole quarter units, a fuel can holds exactly one (fuel/fuel.ts cansForUnits — it stops
// type-checking if a can is ever made bigger), and fuel lying in the world lies as SINGLE cans (one visible can = one can: Game.dropRef,
// the riding drop, the station's loot cans). So a melted cart of n units leaves n single cans — its odd last unit too, never a part can
// left over, never one added — which are ordinary fuel-can pickups from then on:
//  - every amount 0..FUEL.cartUnits melts (a cart is never exempt) to exactly that many single cans on real floor, plus its one salvage;
//  - the station's loose items (capturePickups, as Game.leaveSection) through a save file: export (text) -> import (parse + validate) ->
//    Continue (restoreRun) -> the station rebuilt (restorePickup): every can, uid and count exact; Retry (the level-entry snapshot of
//    the station) gives back exactly what lay there at entry;
//  - picked up (Inventory.add) and drawn for a journey (planDebit / applyDebit over the train chest): every unit used, none more.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {SCRAP_METAL} from '../src/items/craftMaterials';
import {FUEL, applyDebit, canUnitsIn, cansForUnits, debitUnits, planDebit} from '../src/fuel/fuel';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {MELT} from '../src/world/acidMelt';
import {PickupManager} from '../src/world/pickups';
import {capturePickups, restorePickup} from '../src/run/worldMemory';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import {enterStation, meltStation, pickupsOf, step} from './helpers/acidMeltHost';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const SUB = (): StationLayout => LEVELS.subway.generate('main', {levelSeed: 4242});
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const unitsOf = (stacks: readonly {itemId: string; count: number}[]): number =>
  stacks.reduce((n, s) => n + (s.itemId === FUEL.canItem ? s.count * FUEL.canUnits : 0), 0);

describe('a melted fuel cart keeps all its fuel', () => {
  it('a can is exactly one unit: every whole amount is that many cans — nothing rounded away, nothing rounded up', () => {
    expect(FUEL.canUnits).toBe(1);
    for (let u = 0; u <= FUEL.cartUnits; u++) {
      expect(cansForUnits(u)).toBe(u);
      expect(Number.isInteger(cansForUnits(u))).toBe(true);
      expect(cansForUnits(u) * FUEL.canUnits).toBe(u);
    }
  });

  it('carts of every amount 0..8 melt (none exempt) to exactly that many SINGLE cans on real floor, one scrap salvage each; then saves, Continue, Retry, pickup and a journey keep every unit', () => {
    const L0 = SUB(), p = playerTrainPlacement(L0)!;
    const c = meltStation(L0);
    live.push(c.rt);
    enterStation(c, SUB());
    const L = c.h.levels!;
    const at = trainToWorld(p, -3.5, SPEC.floorY, -2.8), floor = L.floorAt(at.x, at.z, p.floorY + 0.3);
    const seen = new Set<number>();
    let melted = 0;
    for (let units = 0; units <= FUEL.cartUnits; units++) {
      const uid = `cart:melt-${units}`;
      c.carts.spawn({uid, units, x: at.x, y: floor, z: at.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
      const cart = c.carts.bodies().find(x => x.uid === uid)!;
      const ref = c.melt.inDisc(cart.body.x, cart.body.y, cart.body.z, 0.2).find(x => x.key === `cart:${uid}`);
      expect(ref?.label, `${units}: a cart is never exempt from melting`).toBe('fuel cart');
      const salvage0 = pickupsOf(c).filter(q => q.itemId === SCRAP_METAL).length;
      expect(c.melt.start(ref!)).toBe(true);
      step(c, MELT.seconds + 0.1);
      melted++;
      expect(c.carts.all().some(x => x.uid === uid)).toBe(false);
      const cans = pickupsOf(c).filter(q => q.itemId === FUEL.canItem && !seen.has(q.uid));
      for (const q of cans) seen.add(q.uid);
      // exactly its units, each a single can (one visible can = one can), on the floor round where it stood
      expect(cans.map(q => q.count), `${units}-unit cart`).toEqual(new Array(units).fill(1));
      expect(unitsOf(cans)).toBe(units);
      for (const q of cans) {
        expect(Math.hypot(q.x - cart.body.x, q.z - cart.body.z)).toBeLessThanOrEqual((cart.body.r ?? 0.36) + 0.01);
        expect(Math.abs(q.y - floor)).toBeLessThan(0.05);
      }
      expect(pickupsOf(c).filter(q => q.itemId === SCRAP_METAL).length).toBe(salvage0 + 1);
    }
    expect(melted).toBe(FUEL.cartUnits + 1);
    const total = (FUEL.cartUnits * (FUEL.cartUnits + 1)) / 2; // 36 units: 0 + 1 + ... + 8
    const lying = c.pickups.list.filter(q => q.stack.itemId === FUEL.canItem);
    expect(unitsOf(lying.map(q => q.stack))).toBe(total);
    expect(c.melt.counts.salvage).toBe(FUEL.cartUnits + 1);

    // ---- the station's loose items as Game.leaveSection keeps them, through a save file
    const recs = capturePickups(c.pickups.list.filter(q => !c.items.ownsPickup(q)), () => undefined);
    const fuelRecs = recs.filter(r => r.stack.itemId === FUEL.canItem);
    expect(unitsOf(fuelRecs.map(r => r.stack))).toBe(total);
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
    h.run.current = {level: 'subway', section: 'main', station: sid(1)};
    const mem = h.run.memory(h.run.current);
    mem.visits = 1;
    mem.pickups = recs;
    h.takeEntry(); // Retry's level-entry snapshot: the cans already lay there when the player came back
    const text = saveFileText(h.file('manual', 1)); // export
    const parsed = parseSaveText(text); // import: parsed and validated
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    const b = new Harness(null);
    if (!parsed.ok) return;
    const r = restoreRun(parsed.value.run, b.target()); // Continue
    expect(r.failed).toEqual([]);
    const key = {level: 'subway' as const, section: 'main', station: sid(1)};
    const back = b.run.peekMemory(key)!.pickups!;
    const backFuel = back.filter(q => q.stack.itemId === FUEL.canItem);
    expect(backFuel.map(q => [q.stack.uid, q.stack.count])).toEqual(fuelRecs.map(q => [q.stack.uid, q.stack.count]));
    expect(unitsOf(backFuel.map(q => q.stack))).toBe(total);
    // Retry: whatever was taken since entry comes back exactly as it lay at entry — no more, no less
    b.run.peekMemory(key)!.pickups = back.filter(q => q.stack.itemId !== FUEL.canItem).concat(backFuel.slice(10));
    b.run.restoreScopeMemories(key, b.run.entry!.memories);
    const retried = b.run.peekMemory(key)!.pickups!.filter(q => q.stack.itemId === FUEL.canItem);
    expect(retried.map(q => [q.stack.uid, q.stack.count])).toEqual(fuelRecs.map(q => [q.stack.uid, q.stack.count]));

    // ---- the station rebuilt from the loaded memory: the same single cans lie there
    const pm = new PickupManager({});
    for (const rec of b.run.peekMemory(key)!.pickups!) restorePickup(pm, b.inv, rec);
    const rebuilt = pm.list.filter(q => q.stack.itemId === FUEL.canItem);
    expect(rebuilt.map(q => q.stack.count)).toEqual(new Array(total).fill(1));
    expect(unitsOf(rebuilt.map(q => q.stack))).toBe(total);

    // ---- picked up (the pickup's Inventory.add) and stowed in the train chest a pocketful at a time; then a journey draws every unit
    const inv = new Inventory(), chest: (ItemStack | null)[] = new Array(64).fill(null);
    let picked = 0;
    for (const q of rebuilt) {
      if (inv.add(q.stack) !== 0) throw new Error('pockets full');
      picked++;
      if (picked % 8 === 0 || picked === rebuilt.length) {
        expect(inv.count(FUEL.canItem)).toBe(picked % 8 === 0 ? 8 : picked % 8);
        for (const [i, s] of inv.pack.entries()) if (s?.itemId === FUEL.canItem) { chest[chest.indexOf(null)] = s; inv.pack[i] = null; }
        expect(inv.count(FUEL.canItem)).toBe(0);
      }
    }
    expect(canUnitsIn(chest)).toBe(total);
    expect(planDebit(total + 1, 0, [], chest)).toBeNull(); // not one unit more than it held
    const d = planDebit(total, 0, [], chest)!;
    expect(debitUnits(d)).toBe(total);
    applyDebit(d, 0, [], chest);
    expect(canUnitsIn(chest)).toBe(0);
  }, 120000);
});
