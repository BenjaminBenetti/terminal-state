// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf PUTTER's WeaponDef — an ordinary MELEE
// weapon (WeaponDef.melee: hold to wind up, release to swing; no ammo) swung like every other melee weapon (WeaponController), which ALSO
// putts golf balls: at the swing's contact moment game.ts meleeContact strikes the ball lying at the player's feet in front of them
// (combat/putterStrike.ts: its own low head sweep — the eye-height ray fan never reaches the floor) with a horizontal impulse along the
// facing; the CHARGE held in the wound-up pose (melee.charge) sets the putt's power (PUTT_POWER below). Enemies take the normal ray-fan hit
// of a LIGHT club: vs the knife (30 / 60 head, reach 1.125 m, 0.65 s) the putter hits lighter (20 body / 40 head: five body or three head
// hits on a shambler), reaches a little further (1.3 m: the club's length), swings at a similar 0.75 s cadence, costs a little stamina and
// only nudges / barely staggers (a short stagger only on a charged stroke). Placed only by the mini-golf dresser on the course's front desk
// (items/golfItems.ts GOLF_EVENT_ONLY): never a find, loot, market stock or a weapon-variety identity.
// A leaf module: import only TYPES from weapons.ts.
import type {MeleeSpec, WeaponDef} from './weapons';
import {PUTTER_POSES, carryView} from './meleeView';
import {PUTTER_MODEL} from '../assets/putterModel.generated';
import {PUTTER_ITEM} from '../gen/skyways/events/golfContract';

/** The putter's sweep rays (enemies): a short LOW level fan in front (the club swings below the eye line), centre first. */
export const PUTTER_RAYS: readonly (readonly [number, number])[] = [[0, 0], [0, -0.1], [0.1, -0.05], [-0.1, -0.05], [0, 0.07], [0, -0.2], [0.18, -0.08], [-0.18, -0.08]];

export const PUTTER_MELEE: MeleeSpec = {
  windup: 0.2, strike: 0.09, sweep: 0.2, recovery: 0.36, rays: PUTTER_RAYS,
  maxTargets: 1, knockback: 0.25, stamina: 5, propHits: true,
  // the hold sets the PUTT's power (PUTT_POWER: 0 = a tap's short roll .. 1 after `time` s = the longest putt); on an enemy it only scales
  // the light club a little (x0.9 .. x1.25 damage, a nudge .. a small push, a short stagger only near full charge)
  charge: {time: 2.0, damage: [0.9, 1.25], knockback: [0.6, 1.6], stagger: [0, 0.2], stamina: [0.6, 1.4]},
};

export const PUTTER_DEF: WeaponDef = {
  id: PUTTER_ITEM, itemId: PUTTER_ITEM, magazine: 0, auto: false,
  interval: PUTTER_MELEE.windup + PUTTER_MELEE.sweep + PUTTER_MELEE.recovery, // = weapons.ts meleeCadence (a tap's swing-to-swing)
  damage: 20, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
  range: 1.3, falloffStart: 1.3, falloffMin: 1, headMult: 2, limbMult: 1,
  knockback: 0, // the gun pellet push; a melee push is MeleeSpec.knockback (combat/meleeImpact.ts)
  reload: {kind: 'magazine', time: 0, emptyTime: 0}, // never used: a melee def returns before any reload logic
  recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8}, // not a gun
  equipTime: 0.35, aimFov: 75, moveMult: 1.0, noise: 4,
  sound: 'pistol', // placeholder for the gun-only cue type: a melee weapon never calls shot / dry / reload cues (swing: sfx.meleeSwing)
  melee: PUTTER_MELEE,
  view: {model: PUTTER_ITEM, ...carryView(PUTTER_POSES.carry), length: PUTTER_MODEL.length},
};

/**
 * The putt's power model (combat/putterStrike.ts): the ball's launch speed from the swing's charge k (0..1). Rolling distance on the turf is
 * ~ v^2 / (2 a) (physics/golfBall.ts GOLF_ROLL.decel), so the speed grows as sqrt so the DISTANCE grows linearly with the hold:
 * v(k) = sqrt(min^2 + (max^2 - min^2) k) — a tap rolls ~0.15 m, every further 0.1 s of hold adds ~0.8 m, the full 2 s hold ~16 m.
 */
export const PUTT_POWER = {minSpeed: 0.4, maxSpeed: 4.5} as const;
export function puttSpeed(charge: number): number {
  const k = Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0)), a = PUTT_POWER.minSpeed, b = PUTT_POWER.maxSpeed;
  return Math.sqrt(a * a + (b * b - a * a) * k);
}
