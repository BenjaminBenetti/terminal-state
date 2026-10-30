// Iteration 16 (lane RUN): the level-wide gear roll / placement of lane GEAR (gen/gearLoot.ts), as the registry and Game
// use it: `rollLevelGear(levelSeed, level, sections)` once per logical level at NewGame (section -> gear items), and
// `placeSectionGear(layout, items)` once per generated section (appends the items to layout.pickups; no items => untouched).
//
// Task gasmask-breach-20261030 (mask lane): the run's roll also carries the level's gas-mask / filter loot (gen/maskLoot.ts,
// its own rng keys), APPENDED after the gear items of each section: lane GEAR's roll itself is unchanged (gen/gearLoot.ts
// rollLevelGear, which tests use directly). levels/registry.ts places the gear first, then the mask loot.

import {rollLevelGear as rollGear, type GearAssignment} from '../gen/gearLoot';
import {rollMaskLoot} from '../gen/maskLoot';
import type {LevelId} from './types';

export {placeSectionGear} from '../gen/gearLoot';
export {isMaskLootItem, placeMaskLoot} from '../gen/maskLoot';

/** The run's level-wide roll: lane GEAR's gear, then (mask lane) the level's masks and filters, per section. */
export function rollLevelGear(levelSeed: number, levelId: LevelId, sections: readonly string[]): Record<string, GearAssignment[]> {
  const gear = rollGear(levelSeed, levelId, sections);
  const masks = rollMaskLoot(levelSeed, levelId, sections);
  for (const s of sections) gear[s] = [...(gear[s] ?? []), ...(masks[s] ?? [])];
  return gear;
}
