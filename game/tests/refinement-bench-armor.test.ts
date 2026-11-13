// Task studio-refinement-batch-20261113-035659-01: the bench's "Train armor" recipe against the REAL armour runtime — craft/crafting.ts
// craftMade / madeBlock (the lead's made-recipe transaction) with world/trainArmor.ts TrainArmorSystem as the upgrades target (what
// Game.trainUpgrades is and what the bench passes: world/craftBench.ts madeContext), on a real generated station with the parked car.
// 10 scrap metal debited exactly once, the armour fitted at once (record, parked colliders); a second craft and a craft with no parked
// car are refused BEFORE anything is taken; a failing install refunds exactly.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {benchRecipeFor, isMadeRecipe, type MadeRecipe} from '../src/craft/recipes';
import {craftMade, craftSources, madeBlock} from '../src/craft/crafting';
import {SCRAP_METAL} from '../src/items/craftMaterials';
import {Inventory} from '../src/items/inventory';
import {ARMOR_TEXT, TrainArmorSystem} from '../src/world/trainArmor';
import {build, stationHost, teardown, type CartTestHost} from './helpers/fuelCartsHost';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));

const live: {armor: TrainArmorSystem; h: CartTestHost; rt: PlayerTrainRuntime}[] = [];
afterEach(() => {
  for (const w of live.splice(0)) {
    w.armor.dispose();
    if (w.rt.train) { w.rt.ride = null; teardown(w.h); }
  }
});

function world(o: {build?: boolean} = {}) {
  const {h, rt} = stationHost(SUBWAY(), {build: false}) as unknown as {h: CartTestHost; rt: PlayerTrainRuntime};
  Object.assign(h, {blastKill: () => {}, fx: {impact: () => {}}});
  const armor = new TrainArmorSystem(h as never, {model: () => null, refreshIcons: () => {}, rendererReady: () => true}).install();
  live.push({armor, h, rt});
  if (o.build !== false) build(h, SUBWAY());
  const inv = new Inventory();
  inv.add(inv.makeStack(SCRAP_METAL, 12));
  return {h, rt, armor, inv, sources: () => craftSources({inv})};
}

const recipe = (): MadeRecipe => {
  const r = benchRecipeFor('armor');
  if (!r || !isMadeRecipe(r)) throw new Error('no armour recipe');
  return r;
};

describe('the bench\'s train-armour recipe with the real armour runtime (Game.trainUpgrades)', () => {
  it('10 scrap metal fit the armour for good, at once: the record, the parked colliders; a second craft is refused with nothing taken', () => {
    const w = world();
    const r = recipe();
    expect(r.cost[SCRAP_METAL]).toBe(10);
    expect([madeBlock(r, {items: {inv: w.inv}, upgrades: w.armor}), w.armor.installed('armor'), w.rt.armorFitted()]).toEqual([null, false, false]);
    const res = craftMade(r, {sources: w.sources(), items: {inv: w.inv}, upgrades: w.armor});
    expect(res.ok).toBe(true);
    expect([w.inv.count(SCRAP_METAL), w.armor.installed('armor'), w.rt.armorFitted()]).toEqual([2, true, true]);
    w.inv.add(w.inv.makeStack(SCRAP_METAL, 10));
    expect(madeBlock(r, {items: {inv: w.inv}, upgrades: w.armor})).toBe(ARMOR_TEXT.fitted);
    const again = craftMade(r, {sources: w.sources(), items: {inv: w.inv}, upgrades: w.armor});
    expect(again.ok).toBe(false);
    expect(w.inv.count(SCRAP_METAL)).toBe(12); // never a second debit: there is no durability, nothing to re-fit
  });

  it('no parked car: refused with the reason before anything is taken; an install that fails refunds the scrap exactly', () => {
    const w = world({build: false});
    const r = recipe();
    expect(madeBlock(r, {items: {inv: w.inv}, upgrades: w.armor})).toBe(ARMOR_TEXT.noTrain);
    const res = craftMade(r, {sources: w.sources(), items: {inv: w.inv}, upgrades: w.armor});
    expect([res.ok, w.inv.count(SCRAP_METAL), w.armor.installed('armor')]).toEqual([false, 12, false]);
    // the debit happens, then the install says no (the upgrade target's own last-moment refusal): the transaction gives it all back
    const w2 = world();
    const flaky = {block: (id: 'armor') => w2.armor.block(id), install: () => false};
    const r2 = craftMade(r, {sources: w2.sources(), items: {inv: w2.inv}, upgrades: flaky});
    expect([r2.ok, w2.inv.count(SCRAP_METAL), w2.armor.installed('armor'), w2.inv.invariants()]).toEqual([false, 12, false, []]);
  });
});
