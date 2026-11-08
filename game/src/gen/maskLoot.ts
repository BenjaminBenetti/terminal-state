// Task gasmask-breach-20261030 (mask lane): level-wide GAS MASK and FILTER loot, modelled on gen/gearLoot.ts.
//
// rollMaskLoot: ONE roll per logical level with its OWN rng keys (`mask-roll:<level>` / `filter-roll:<level>`), so the
// existing gear roll (gen/gearLoot.ts rollLevelGear) and every other generated pickup / zombie stay exactly as they were. Each
// found mask carries a partly used filter: MASK_LOOT.foundFilter (35-75 %) of FILTER_LIFE_S, seeded per mask. Counts:
//   office  masks 1-2,            filters 2-5
//   subway  masks 0-1 (p = 0.5),  filters 0-2
// No starter mask or filters (NewGame's kit is unchanged).
//
// The roll rides along with the level's gear roll (levels/gearAdapter.ts appends it AFTER the gear items, so the run's gear
// list for a section is [gear..., masks..., filters...]); levels/registry.ts splits it again and places the gear first
// (unchanged placement) and then these with their own placement rng (`mask-place`) through the same rules as gear: back-of-
// house / storage / staff / office rooms, beside an anchor prop when there is one, a flat floor cell reachable from the spawn,
// >= GEAR_MIN_SPAWN_M (6 m) from it, away from doorways / stairs / other pickups, never in passages / concourses / platforms /
// stair cores or the elevator shaft. Filters use the same spots and anchors. Pure data, deterministic.

import {Rng, hashString} from '../core/rng';
import {FILTER_LIFE_S} from '../items/gear';
import type {LevelId} from '../levels/types';
import type {PickupPlacement, StationLayout} from './stationTypes';
import {placeGear, type GearAssignment} from './gearLoot';
import {reactorJam} from './reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)

export const GAS_MASK_ID = 'gas_mask';
export const GAS_FILTER_ID = 'gas_filter';

/** Per-level mask / filter loot: inclusive count ranges, each count drawn uniformly (subway masks 0-1 = a 50 % chance of one). */
export interface MaskLootSpec { masks: readonly [number, number]; filters: readonly [number, number] }

/** All mask-loot tuning in one place (first pass). */
export const MASK_LOOT = {
  levels: {
    office: {masks: [1, 2], filters: [2, 5]},
    subway: {masks: [0, 1], filters: [0, 2]},
    // Task track3-eaton-centre-20261031: the mall keeps the Office's mask / filter roll (lane PROFILES decision, PROFILES.done).
    mall: {masks: [1, 2], filters: [2, 5]},
    // Task reactor-build-20261101 (primary): the Reactor ALWAYS holds one mask and a real but tight filter supply — the mask + filter
    // route can bypass the generators, but never so many filters that it becomes the default (the generator route needs no mask).
    // Task reactor-playtest-round2-20261102 (lane GAS): the final generator JAMS (gen/reactor/gasJam.ts), so the core floor NEEDS the
    // mask until the reactor is online. The same finite supply (>= 52.5 s fitted + 3 x 150 s spare) is now placed only UPSTREAM of the
    // jammed zone (placeMaskLoot), budgeted in tests/reactor-gas-jam.test.ts against the real core-floor travel / work time.
    // Task filter-tension-airtank-20261104-072836: the COUNTS stay exactly as they are, but a filter now lasts 37.5 s (>= 13.1 s fitted
    // + 3 x 37.5 s spare): by the user's design the on-site supply alone no longer has to cover the core floor — the player is meant to
    // arrive prepared with scavenged filters / an Airtank Backpack (no Reactor-specific supply was added).
    reactor: {masks: [1, 1], filters: [3, 5]},
    // Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS keeps the Office's / mall's roll — its glazed bridges start
    // partly breached (gas across some routes) and every pane can be shot out, exactly the Office's window rule; no extra supply.
    skyways: {masks: [1, 2], filters: [2, 5]},
    // Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET — clean air and no free loot: no masks, no filters.
    market: {masks: [0, 0], filters: [0, 0]},
  } as Readonly<Record<LevelId, MaskLootSpec>>,
  /** A found mask's fitted filter: this fraction range of FILTER_LIFE_S (uniform, seeded per mask). */
  foundFilter: [0.35, 0.75] as const,
} as const;

/** Item ids that belong to the mask loot (levels/registry.ts splits them from the gear roll by this). */
export function isMaskLootItem(itemId: string): boolean {
  return itemId === GAS_MASK_ID || itemId === GAS_FILTER_ID;
}

/**
 * The level-wide mask / filter roll: section -> assignments (masks first, each with its seeded `filter` seconds, then filters).
 * Every section key is present (possibly []). Deterministic in (levelSeed, levelId, sections order).
 */
export function rollMaskLoot(levelSeed: number, levelId: LevelId, sections: readonly string[]): Record<string, GearAssignment[]> {
  const out: Record<string, GearAssignment[]> = {};
  for (const s of sections) out[s] = [];
  const spec = MASK_LOOT.levels[levelId];
  if (!sections.length || !spec) return out;
  const deal = (rng: Rng) => sections[Math.min(sections.length - 1, Math.floor(rng.next() * sections.length))];
  const mr = new Rng(hashString(`mask-roll:${levelId}`, (levelSeed >>> 0) ^ 0x510e527f));
  const masks = mr.int(spec.masks[0], spec.masks[1]);
  const [f0, f1] = MASK_LOOT.foundFilter;
  for (let k = 0; k < masks; k++) {
    const filter = Math.round(FILTER_LIFE_S * (f0 + (f1 - f0) * mr.next()) * 10) / 10; // 0.1 s steps (plain JSON)
    out[deal(mr)].push({itemId: GAS_MASK_ID, filter});
  }
  const fr = new Rng(hashString(`filter-roll:${levelId}`, (levelSeed >>> 0) ^ 0x9b05688c));
  const filters = fr.int(spec.filters[0], spec.filters[1]);
  for (let k = 0; k < filters; k++) out[deal(fr)].push({itemId: GAS_FILTER_ID});
  return out;
}

/**
 * Places a section's mask / filter assignments as ordinary layout pickups (appended to layout.pickups, count 1 each; a mask's
 * `filter` is copied onto its placement) with the gear placement rules and this lane's own rng. Call AFTER the gear placement.
 * Task reactor-playtest-round2-20261102 (lane GAS): on the Reactor never on a storey of the jammed gas zone (the core floor): the mask
 * the deep tasks need lies upstream, reachable mask-free through the working generators (no gear lock).
 */
export function placeMaskLoot(layout: StationLayout, items: readonly GearAssignment[] | undefined): PickupPlacement[] {
  if (!items?.length) return [];
  const jam = layout.reactor ? reactorJam(layout.reactor) : null;
  const opts = jam ? {areaOk: (a: {level?: number}) => !jam.levels.includes(a.level ?? 0)} : undefined;
  return placeGear(layout, items, new Rng(hashString('mask-place', (layout.seed >>> 0) ^ 0x1f83d9ab)), undefined, opts);
}
