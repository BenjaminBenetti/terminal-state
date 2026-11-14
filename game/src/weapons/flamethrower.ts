// Task studio-flamethrower-fire-20261114-031614-01: the FLAMETHROWER's WeaponDef — a STREAM weapon (WeaponDef.stream): no caliber, no
// magazine, no bullets. Holding the trigger burns the WORN Fuel Tank's fuel one whole unit a tick (weapons.ts updateStream) and each
// paid tick is one tick of flame (fire/fireSystem.ts); R pours one ordinary fuel can into the worn tank. Numbers: fire/flamethrowerSpec.ts.
// Crafted at the train's bench or bought from a Market gun stall — never loot, never in a weapon find pool (items/weaponVariety.ts).
// A leaf module: import only TYPES from weapons.ts.
import type {WeaponDef} from './weapons';
import {FLAME, FLAME_FUEL, FLAMETHROWER_ID} from '../fire/flamethrowerSpec';
import {FLAMETHROWER_MODEL} from '../assets/flamethrowerModels.generated';

export const FLAMETHROWER_DEF: WeaponDef = {
  id: FLAMETHROWER_ID, itemId: FLAMETHROWER_ID, magazine: 0, auto: true, interval: FLAME_FUEL.unitSeconds,
  // the shared fields keep their meaning for the code that reads every def (prices, tooltips): `damage` = one tick's damage at the muzzle
  damage: FLAME.dps * FLAME_FUEL.unitSeconds, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
  range: FLAME.range, falloffStart: 0, falloffMin: FLAME.farMult, headMult: 1, limbMult: 1, knockback: 0,
  reload: {kind: 'magazine', time: 0, emptyTime: 0}, // never used: a stream def returns before any magazine logic
  recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8}, // no shot recoil (a steady stream; the view shakes a little: Game.flameTick)
  equipTime: FLAME.equipTime, aimFov: 75, moveMult: FLAME.moveMult, noise: FLAME.noise,
  sound: 'rifle', // placeholder for the gun-only cue type: a stream never calls shot / reload cues (audio/flameAudio.ts)
  stream: {unitSeconds: FLAME_FUEL.unitSeconds, refillTime: FLAME_FUEL.refillSeconds},
  // carried low at the right hip, the lance running forward to the crosshair (pivot: the model's Grip marker); no ADS (Game.aiming)
  view: {model: FLAMETHROWER_ID, hip: [0.2, -0.3, -0.36], aim: [0.2, -0.3, -0.36], hipYaw: 0.1, hipPitch: 0.02, hipRoll: -0.04, length: FLAMETHROWER_MODEL.length},
};
