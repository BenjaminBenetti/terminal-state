// Task studio-flamethrower-fire-20261114-031614-01: the FLAMETHROWER and its WEARABLE FUEL TANK — one source of truth for their ids
// and numbers. A leaf module (no imports): items, the inventory, the weapon controller, the fire system, crafting and the market read
// these, so the fuel a recipe pays, a can pours, a tank holds and a second of flame burns can never drift apart.
//
// FUEL IS COUNTED IN WHOLE UNITS (the project's fuel convention: fuel/fuel.ts — integers, no float drift). The tank's fuel lives on its
// OWN ItemStack (`fuel`, like an Airtank Backpack's `air`), so it travels with that very tank through every copy / store / save.
//   one ordinary fuel can (item `fuel_can`)  = FLAME_FUEL.unitsPerCan units
//   one unit                                 = FLAME_FUEL.unitSeconds seconds of flame
//   a tank holds                             = FLAME_FUEL.capacity units (capacityCans whole cans)
//   a NEW tank (crafted, bought)             = FLAME_FUEL.newUnits units: exactly the ONE can its recipe consumes
// The stream pays one unit BEFORE each unitSeconds of flame it gives (WeaponController.updateStream): no free flame, and a unit is
// never taken without its flame. A can is poured whole, only into a tank with room for all of it (never a part-poured or lost can).

/** Item id = weapon id = held-model key of the flamethrower. */
export const FLAMETHROWER_ID = 'flamethrower';
/** Item id of the wearable fuel tank (gear, the back slot: instead of a backpack / an Airtank Backpack). */
export const FUEL_TANK_ID = 'fuel_tank';
/** The ordinary fuel can a tank is refilled from (items/items.ts; fuel/fuel.ts FUEL.canItem). */
export const FLAME_FUEL_CAN = 'fuel_can';

const UNITS_PER_CAN = 200, CAPACITY_CANS = 3, NEW_CANS = 1;

export const FLAME_FUEL = Object.freeze({
  /** Units one fuel can pours into a tank. */
  unitsPerCan: UNITS_PER_CAN,
  /** Whole cans a tank holds. */
  capacityCans: CAPACITY_CANS,
  /** Units a full tank holds. */
  capacity: UNITS_PER_CAN * CAPACITY_CANS,
  /** Seconds of flame one unit pays for: 10 units a second, 20 s a can, 60 s a full tank. */
  unitSeconds: 0.1,
  /** Fuel cans the tank's crafting recipe consumes = cans in a NEW tank. */
  newCans: NEW_CANS,
  /** Units in a NEW tank (crafted or bought): exactly its recipe's fuel. */
  newUnits: UNITS_PER_CAN * NEW_CANS,
  /** Seconds one can takes to pour into the worn tank (R with the flamethrower in the hands). */
  refillSeconds: 2.6,
});

/**
 * The flame itself (fire/fireSystem.ts). Reference HP: shambler 100, coated 165, rat / dog 44, BB 55, Siren 200, Screacher 600,
 * Strainer 1200; the rifle's sustained body DPS is 240, the pump shotgun's 165, the pistol's ~106.
 */
export const FLAME = Object.freeze({
  /** Reach of the stream from the muzzle (m). */
  range: 8.5,
  /** Stream radius (m) at the muzzle and at full range (a widening cone). */
  radius0: 0.2, radius1: 0.85,
  /** Damage a second to EVERY enemy inside the stream with a clear line from the muzzle (at the muzzle; eased to `farMult` at full range). */
  dps: 90, farMult: 0.6,
  /** A body the stream touched keeps burning: damage a second for `burnSeconds` after the last touch (re-touching refreshes, never stacks). */
  burnDps: 15, burnSeconds: 5,
  /** Flame speed along the stream (m/s): the visual's travel and the delay before a far surface catches. */
  speed: 15,
  /** Loudness radius (m) of the roar while the stream runs (gunshots 24-38). */
  noise: 26,
  /** Movement while it is in the hands (a heavy two-handed lance). */
  moveMult: 0.88,
  equipTime: 0.7,
  /** Fire damage lands in batches this often (s): burning bodies, bodies standing in fire, the player. */
  burnEvery: 0.25,
  /** The player's pain cue at most this often (s) while burning. */
  painEvery: 0.9,
  /** The shove (N s) that crumples a body the fire killed (a rifle kill: ~9; the acid: 12). */
  killImpulse: 5,
});

/** Fire clinging to a surface (floor, wall, a prop's face) where the stream lands. */
export const FIRE_PATCH = Object.freeze({
  /** Active seconds one patch burns after the stream last fed it. */
  life: 7,
  /** Seconds of stream on one spot for a patch to reach full strength (a brief lick leaves a small, short fire). */
  feed: 0.6,
  /** Radius (m) of a full-strength patch; a new deposit within `merge` of one feeds it instead of starting another. */
  radius: 0.75, merge: 0.6,
  /** Patches alive at once (the oldest is put out when a new one needs the slot). */
  max: 24,
  /** Damage a second to an enemy / the player touching a full-strength patch. */
  enemyDps: 20, playerDps: 10,
  /** How far above a floor patch (m) the flames still burn a body. */
  height: 1.3,
  /** A patch dies down over its last `fade` active seconds (strength and size follow). */
  fade: 2,
  /** Seconds the stream's flame takes to drop onto the floor where it ends in open air, and the share of its flame that lands there. */
  fall: 0.25, airFeed: 0.5,
  /** While the stream runs, a burning drip falls under it every `dripEvery` s (a small fire worth `dripFeed` s of stream). */
  dripEvery: 0.45, dripFeed: 0.1,
  /** What a burnt-out prop leaves: a low fire for `emberSeconds` (it sets nothing else alight). */
  emberSeconds: 2.5,
});

/** A PROP on fire (world/acidMelt.ts runs the burn-out as a `fire` melt: no salvage, contents spilled, the same protection rules). */
export const PROP_FIRE = Object.freeze({
  /** Seconds of flame (stream or a touching patch) an eligible prop takes before it catches. Heat fades at `cool` a second without flame. */
  catchSeconds: 1.4, cool: 0.5,
  /** Seconds a burning prop burns before it collapses (its contents spill then). */
  burnSeconds: 4.5,
  /** Damage a second to an enemy / the player touching a burning prop, and the reach (m) beyond its footprint. */
  enemyDps: 20, playerDps: 10, reach: 0.35,
});
