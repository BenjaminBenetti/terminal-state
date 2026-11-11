// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTING BENCH in the player's train — the fixture in the rear
// compartment opposite the Lockbox (craft/trainFixtures.ts benchPlacement), its look-at prompt, [E] -> the recipe list (ui/craftView.ts)
// and the atomic craft (craft/crafting.ts) that puts a real unit on the car floor (Game.trainEquipment.craft).
//
// LEAD STUB: lane BENCH replaces the internals; `installCraftBench` and the class name stay.

import type {Game} from '../game';

export class CraftBenchSystem {
  constructor(readonly host: unknown) {}
  install(): this { return this; }
}

/** Installs the crafting bench (one call in the Game constructor, after the train, the ride and the train equipment; registries only). */
export function installCraftBench(game: Game): CraftBenchSystem {
  return new CraftBenchSystem(game).install();
}
