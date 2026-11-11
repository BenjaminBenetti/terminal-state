// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER): THE ITEM / ENEMY SCANNER — [E] on the plugged console opens a
// black / green 360° scope around the train (~100 m); about every 30 active seconds a sweep refreshes SNAPSHOT blips (red enemies, green
// ordinary items, gold weapons / gear). No floor plan, no live tracking.
//
// LEAD STUB: lane SCANNER replaces the internals; `installItemScanner` and the class name stay.

import type {Game} from '../game';

export class ItemScannerSystem {
  constructor(readonly host: unknown) {}
  install(): this { return this; }
}

/** Installs the scanner (one call in the Game constructor, after the train equipment; registries only). */
export function installItemScanner(game: Game): ItemScannerSystem {
  return new ItemScannerSystem(game).install();
}
