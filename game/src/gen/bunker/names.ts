// Task studio-bunker-level-20261109-072224-01: THE BUNKER's names — the shelter's own seeded name (the HUD / wayfinding plates / level
// display name; a campaign node's printed name replaces it on the signs) and the generic level name. ORIGINAL civil-defence wording:
// no franchise names, numbering schemes or characters. Pure.

import {Rng, hashString} from '../../core/rng';

/** The generic level name (menus without a level seed). */
export const BUNKER_GENERIC_NAME = 'Bunker';

const STEMS = ['Greystone', 'Harrow Hill', 'Ashford Moor', 'Kestrel Ridge', 'Blackmere', 'Deepcroft', 'Ironbridge', 'Stillwater', 'Fernhollow', 'Cold Fell', 'Thornbury', 'Millbrook'];
const TAILS = ['Deep Shelter', 'Civil Defence Shelter', 'Regional Shelter', 'Emergency Shelter', 'Hardened Shelter'];

/** The shelter's own name for a level seed (stable per seed). */
export function bunkerNameOf(levelSeed: number): string {
  const r = new Rng(hashString('terminal-state:bunker-name', levelSeed >>> 0));
  return `${r.pick(STEMS)} ${r.pick(TAILS)}`;
}

/** The short plate name ("Greystone Shelter"): the stem + "Shelter" (wayfinding plates are narrow). */
export function bunkerShortName(full: string): string {
  const stem = STEMS.find(s => full.startsWith(s));
  return stem ? `${stem} Shelter` : full;
}
