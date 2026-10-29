// Iteration 16 (lane RUN): the level-wide gear roll / placement of lane GEAR (gen/gearLoot.ts), as the registry and Game
// use it: `rollLevelGear(levelSeed, level, sections)` once per logical level at NewGame (section -> gear items), and
// `placeSectionGear(layout, items)` once per generated section (appends the items to layout.pickups; no items => untouched).

export {placeSectionGear, rollLevelGear} from '../gen/gearLoot';
