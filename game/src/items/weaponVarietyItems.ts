// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve new weapons' ItemDefs (ids: weapons/varietyIds.ts).
// items.ts spreads them into ITEMS after every existing item (catalogue order of the old items unchanged). Item id = weapon id = model key
// = icon key. Ordinary weapon items in every common path: kind 'weapon', one per slot, `weaponId` the WeaponDef (weapons/varietyGuns.ts /
// varietyMelee.ts) — the inventory / quick slots / melee slot (Inventory: isMeleeItem through the def's `melee`), bags, the Lockbox, train
// cargo, the car trunk, trades (market/trade/value.ts prices them from their WeaponDef), save validation and uid cloning all classify
// them by kind + WeaponDef, never by id. Magazine sizes, calibers and handling are the defs' (the tooltip reads them: ui/itemTip.ts), so
// the descriptions name what each weapon IS and how it handles, never a number another lane owns.
// They appear in the world only by identity diversification of the existing weapon finds (items/weaponVariety.ts). HUD glyphs:
// ui/weaponVarietyIcons.ts; 3D icons / pickups / held models: world/weaponVarietyModels.ts.
// A leaf module: import only TYPES from items.ts.
import type {ItemDef} from './items';
import type {VarietyWeaponId} from '../weapons/varietyIds';

/** HUD icon keys of the twelve (ui/weaponVarietyIcons.ts): the item ids themselves. */
export type WeaponVarietyIconKey = VarietyWeaponId;

const W = (id: VarietyWeaponId, name: string, short: string, description: string): ItemDef =>
  ({id, name, short, kind: 'weapon', stackMax: 1, weaponId: id, icon: id, description});

const MELEE = 'Melee: hold the button to wind up, release to swing — no ammo, never runs out.';

export const VARIETY_WEAPON_ITEMS: Readonly<Record<VarietyWeaponId, ItemDef>> = {
  // --- 9mm (9×19mm): the service pistol's rounds ---
  hornet: W('hornet', 'Hornet — "Close-quarters spray"', 'Hornet',
    'Compact 9mm (9×19mm) submachine gun with a folding wire stock. Fully automatic: it empties a magazine in a blink and climbs if you hold it down — at its best up close. Loads the same 9mm rounds as the service pistol.'),
  longslide: W('longslide', 'Longslide — "Patient shot"', 'Longslide',
    'Long-slide 9mm (9×19mm) target pistol with a weighted barrel. Semi-automatic and steady in the hand: slower to raise than the service pistol, but each round goes where it is aimed. Loads the same 9mm rounds.'),
  // --- 5.56×45mm: the automatic rifle's rounds ---
  stub: W('stub', 'Stub — "Corridor carbine"', 'Stub',
    'Short bullpup 5.56×45mm carbine, magazine behind the grip. Fully automatic and quick to swing round corners; you move almost as freely as with a sidearm, at the cost of a looser group at range.'),
  overwatch: W('overwatch', 'Overwatch — "One clean shot"', 'Overwatch',
    'Scoped 5.56×45mm designated marksman rifle. Semi-automatic: settle the sights for a precise, hard-hitting shot at long range — heavy to carry and slow to bring up close.'),
  // --- 12-gauge: the pump shotgun's shells ---
  coach_gun: W('coach_gun', 'Coach Gun — "Both barrels"', 'Coach gun',
    'Side-by-side 12-gauge break-action with outside hammers. Two barrels, two quick shots — then break it open and drop in two fresh shells.'),
  thresher: W('thresher', 'Thresher — "Clears the room"', 'Thresher',
    'Semi-automatic 12-gauge shotgun fed from a box magazine. Fires as fast as you pull and reloads a whole magazine at once; heavy, and it kicks hard.'),
  // --- melee ---
  fire_axe: W('fire_axe', 'Fire Axe — "Break glass"', 'Fire axe',
    `Red-headed fire axe from an emergency cabinet: a heavy two-handed chop with a pick on the back. ${MELEE}`),
  machete: W('machete', 'Machete — "Cuts a path"', 'Machete',
    `Long, light machete with a riveted grip. Fast one-handed slashes with more reach than the knife. ${MELEE}`),
  sledgehammer: W('sledgehammer', 'Sledgehammer — "Demolition"', 'Sledgehammer',
    `Long-handled sledgehammer. Slow to wind up and recover, but nothing hits harder or knocks the infected back further. ${MELEE}`),
  crowbar: W('crowbar', 'Crowbar — "Hooked end"', 'Crowbar',
    `Forged steel crowbar with a hooked end. Quick, solid one-handed blows. ${MELEE}`),
  slugger: W('slugger', 'Slugger — "Swing for the fences"', 'Slugger',
    'Dented aluminium baseball bat. Melee: hold the button to charge the swing — the longer the windup, the harder it lands — and release to swing. No ammo, never runs out.'),
  track_shovel: W('track_shovel', 'Track Shovel — "Long reach"', 'Track shovel',
    `Long-handled track ballast shovel with a steel blade. Two-handed, with the longest reach of any melee weapon: wide, sweeping strikes. ${MELEE}`),
};
