// Data-driven weapon definitions plus the fire/reload state machine shared by every gun.
// Adding a weapon = adding a WeaponDef (and an item + viewmodel binding), no new code paths.

import type {Inventory, ItemStack} from '../items/inventory';
import {ammoItemFor, CALIBERS, type Caliber} from '../items/calibers';
import type {OpticSpec} from './optic';
import {KNIFE_RAYS} from '../combat/melee'; // lane KNIFE
import {carryView, KNIFE_POSES} from './meleeView'; // lane FEEL: the knife's upright carry pose
import {RECOIL_SCALE, firingRecoil} from './recoil';
import {VARIETY_GUN_DEFS} from './varietyGuns'; // task studio-weapon-variety-production-20261109-224355-01: the six new guns
import {VARIETY_MELEE_DEFS} from './varietyMelee'; // task studio-weapon-variety-production-20261109-224355-01: the six new melee weapons
import {FLAMETHROWER_DEF} from './flamethrower'; // task studio-flamethrower-fire-20261114-031614-01: the flamethrower (a STREAM weapon)
import {FLAME_FUEL_CAN} from '../fire/flamethrowerSpec';
import {burnUnit, canPourCan, pourCan, tankFuel, wornFuelTank} from '../fire/fuelTank';

export interface MagazineReload { kind: 'magazine'; time: number; emptyTime: number }
export interface ShellReload { kind: 'shell'; start: number; each: number; end: number }
/**
 * Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): a BREAK action (the coach gun). R opens the action
 * (`start` s: the spent hulls are thrown out `eject` s in, once it is fully open) -> loads shells one at a time (`each` s,
 * up to `magazine`, fewer when the reserve runs out) -> closes (`end` s). Nothing fires while it is open; a trigger press
 * (with a shell loaded) stops the loading after the current shell and closes it; a weapon switch mid-reload keeps exactly
 * the shells already loaded (each was taken from the reserve as it went in). Same shape as ShellReload (start / each / end).
 */
export interface BreakReload {
  kind: 'break'; start: number; eject: number; each: number; end: number;
  /**
   * Task studio-turnstile-reload-visuals-20261112-063646-01: the gun keeps each fired hull in its chamber (ItemStack.spent) until a reload
   * opens it: `eject` s in, the spent hulls (only those: live rounds stay in) are thrown out ('eject' event). Absent = no hulls are
   * tracked (the Coach Gun, exactly as before).
   */
  spentHulls?: true;
}

/**
 * Lane GUNS: optional handling extensions (weapon variety). Absent on the baseline pistol / rifle / shotgun / knife, whose
 * behaviour is therefore exactly as before (tests/weapon-variety-guns.test.ts snapshots their defs).
 *  - AimSettle: aiming down sights steadies over `time` s — the aimed cone starts `extra` rad wider and eases to `spreadAim`;
 *    each shot sets the settle back by `shot` x `time` (a follow-up waits for the hold to steady again).
 *  - RecoilClimb: sustained fire climbs — shot n of a string (the next shot within the interval + 0.1 s) kicks the camera
 *    1 + `climb` x min(n, `cap`) times the def's pitch; `jitter` adds a further random sideways kick (rad) per shot.
 *  - Bloom: per-shot spread growth (`per` rad up to `max`) and its recovery (`decay` rad/s); absent = the shared rule
 *    (single-projectile guns +0.0035 up to 0.03, recovering 0.06 rad/s).
 */
export interface AimSettle { time: number; extra: number; shot: number }
export interface RecoilClimb { climb: number; cap: number; jitter: number }
export interface Bloom { per: number; max: number; decay: number }
/** Lane GUNS: the existing gun cue sets (audio/sfx.ts); a variety gun reuses one of them (no new audio). */
export type GunCue = 'rifle' | 'shotgun' | 'pistol';

export interface WeaponDef {
  id: string;
  itemId: string;
  /**
   * Lane AMMO (knife-melee-20261030): the caliber the weapon chambers (items/calibers.ts). Reload / reserve / dry-fire resolve the
   * ammo item through it (weaponAmmoItem), so every weapon of a caliber shares one pool. Absent = uses no ammo (melee).
   */
  caliber?: Caliber;
  magazine: number;
  auto: boolean;
  /** Seconds between shots. */
  interval: number;
  damage: number;
  pellets: number;
  /** Cone half-angle (radians) for hip fire, aiming, and the extra added while moving. */
  spreadHip: number;
  spreadAim: number;
  spreadMove: number;
  range: number;
  falloffStart: number;
  falloffMin: number;
  headMult: number;
  limbMult: number;
  /** Push applied to zombies per pellet (m/s). */
  knockback: number;
  reload: MagazineReload | ShellReload | BreakReload;
  recoil: {pitch: number; yaw: number; kick: number; recover: number};
  equipTime: number;
  aimFov: number;
  /**
   * Task studio-weapon-variety-production-20261109-224355-01: mouse-look multiplier while aiming (absent = the shared 0.65). A scoped gun
   * whose aim FOV zooms far in sets it so the scope turns at the same rate on screen as the rifle's 52 deg aim (0.65 x aimFov / 52).
   */
  aimLook?: number;
  moveMult: number;
  /** Loudness radius (m) for alerting zombies. */
  noise: number;
  sound: GunCue;
  // ---- lane GUNS (weapon variety): optional handling, all absent on the baseline guns (see AimSettle / RecoilClimb / Bloom) ----
  aimSettle?: AimSettle;
  recoilClimb?: RecoilClimb;
  bloom?: Bloom;
  /** The cue set of the reload sounds (default `sound`): e.g. a box-magazine shotgun uses the magazine cues. */
  reloadCue?: GunCue;
  /** The action cue after a shot: 'pump' = the pump-action rack, 'none' = semi-auto / break action. Default: a pump for 'shotgun'. */
  shotCycle?: 'pump' | 'none';
  /**
   * Viewmodel placement in camera space, pivoting at the model's Grip marker. Aim offsets come
   * from measured derivative geometry: shotgun rib ~0.07 m above the stock wrist (iron sights).
   * Hip pose (iteration 02): carried low-right with the stock running out of frame toward the
   * shoulder; the top of the gun sits ~62-64% down the screen at 16:9, the muzzle yawed in
   * (hipYaw) and pitched slightly up (hipPitch) toward the crosshair, small cant (hipRoll).
   * `optic` (iteration 04): when the loaded model has a see-through optic (rifle-optic.glb:
   * OpticGlassRear + OpticRear anchor) ADS is derived from it instead — the eye on the optic axis
   * `eyeRelief` behind the rear glass (weapons/optic.ts). `aim` stays the fallback for a model
   * without one (the original opaque rifle.glb: optic top ~0.28 m above the grip, sight over it).
   * `sightRelief` (user weapon models, 2026-10-28): when the loaded model has a `Sight` marker (and no see-through
   * optic) ADS puts that sight point on the camera axis `sightRelief` m in front of the eye:
   * aim = (0, 0, -sightRelief) - (Sight + (0, sightLift, 0) - Grip). `sightLift` (m) puts the eye line just OVER a solid
   * part: the user rifle's red dot has an opaque lens, so the optic sits just under the crosshair instead of filling the view.
   * `aim` stays the fallback for a model without a Sight marker.
   */
  view: {model: string; // the held model key: the baseline 'rifle' | 'shotgun' | 'pistol' | 'knife', or a weapon-variety id (weapons/varietyIds.ts)
    hip: [number, number, number]; aim: [number, number, number]; hipYaw: number; hipPitch: number; hipRoll: number; length: number; optic?: OpticSpec; sightRelief?: number; sightLift?: number;
    /** (weapon poses task) The visual kick's push toward the eye at HIP, x (default 1; ADS always 1): a gun held nearer than its kick was tuned at. */
    kickTravel?: number;
    /**
     * (task studio-turnstile-reload-visuals-20261112-063646-01) A BREAK action's own extra presentation while open: [pitch, yaw, roll] rad
     * added to the shared open-breech pose at full open (scaled with the opening like it), so every chamber of its rear face shows.
     */
    breakPresent?: [number, number, number]};
  /**
   * Lane KNIFE (knife-melee-20261030): a MELEE weapon. Its swing replaces the gun's fire / magazine / reload cycle in
   * WeaponController (no ammo is ever counted or taken, R does nothing, no ADS). The shared fields keep their meaning:
   * `range` = reach from the eye (m), `damage` / `headMult` / `limbMult` = the hit, `noise` = loudness of a blade hit
   * (gunshots 24-38 m), `knockback` 0. Lane FEEL (knife-windup-20261030): `interval` = the minimum swing-to-swing cadence,
   * which the melee phases enforce (= melee.windup + melee.sweep + melee.recovery); `auto` false (holding never repeats).
   */
  melee?: MeleeSpec;
  /**
   * Task studio-flamethrower-fire-20261114-031614-01: a STREAM weapon (the flamethrower). Its stream replaces the gun's fire / magazine /
   * reload cycle in WeaponController (updateStream): no caliber, no magazine, no bullets — the fuel is the WORN Fuel Tank's (fire/fuelTank.ts).
   */
  stream?: StreamSpec;
}

/**
 * Task studio-flamethrower-fire-20261114-031614-01: a stream weapon's cycle. While the trigger is held (and a Fuel Tank with fuel is worn)
 * the controller TICKS every `unitSeconds`: each tick first takes ONE whole fuel unit from the worn tank and then gives one 'flame' tick
 * (the game applies exactly `unitSeconds` of flame for it), so fuel and flame can never drift: no tick without its unit, no unit without
 * its tick. The press pays its first tick at once; a release lets the paid tick run out (the stream ends <= unitSeconds later); ticks never
 * come faster than one per `unitSeconds`, however the trigger is tapped. R pours ONE ordinary fuel can into the worn tank over
 * `refillTime` s (only when the whole can fits): the can is taken and its units arrive in the same step at the end — a switch, sprint or
 * the tank coming off before that pours nothing and takes nothing.
 */
export interface StreamSpec {
  /** Seconds of flame one fuel unit pays for = the tick length. */
  unitSeconds: number;
  /** Seconds one fuel can takes to pour into the worn tank. */
  refillTime: number;
}

/**
 * Lane KNIFE: melee-only timing / sweep (combat/melee.ts resolves the contact).
 * Lane FEEL (knife-windup-20261030; user: "click, and that holds it up ... and when you let go it swings, but if you just tap
 * it quickly it still plays the whole animation ... this wind up mechanic will let us do heavier weapons like clubs and
 * crowbars"): HOLD TO WIND UP, RELEASE TO SWING, as a small phase spec — a slower club / crowbar only sets other numbers:
 *   press -> WINDUP (`windup` s: raised into the wound-up pose; also the MINIMUM — a release before it is queued and the
 *   swing follows the moment the windup completes, so a quick tap still plays windup -> swing -> recovery)
 *   -> READY (still held: the wound-up pose is kept and NOTHING attacks; after `holdMax` s, if set, the arm relaxes back to
 *   the carry with no attack) -> release -> SWING (the ONE blade contact `strike` s after the release; the sweep /
 *   follow-through ends at `sweep` s) -> RECOVERY (`recovery` s back to the carry).
 * A new windup needs a NEW press (holding never repeats) and starts only after the recovery (a press during the swing /
 * recovery is remembered and starts it then). A longer hold adds no damage or reach.
 */
export interface MeleeSpec {
  /** Seconds from the press to the wound-up pose; the minimum windup before a swing can be released. */
  windup: number;
  /** Seconds the wound-up pose may be held before the arm relaxes without attacking; absent = as long as the button is held. */
  holdMax?: number;
  /** Seconds from the release (swing start) to blade contact — the ONE moment the swing is resolved. */
  strike: number;
  /** Seconds from the release to the end of the sweep / follow-through (> strike). */
  sweep: number;
  /** Seconds from the end of the sweep back to the carry pose; the next windup cannot start before it ends. */
  recovery: number;
  /** Sweep rays: [yaw, pitch] offsets (radians) from the crosshair, tried centre first (combat/melee.ts KNIFE_RAYS). */
  rays: readonly (readonly [number, number])[];
  // ---- Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): generic, data-driven extensions. Every field is
  // optional; absent = the knife's behaviour exactly (one target, no knockback / stagger / stamina / charge, chips-only world hits).
  /** Distinct targets one swing may strike (the per-swing hit set: each at most once; combat/melee.ts resolveMeleeSweep). Default 1. */
  maxTargets?: number;
  /** Damage multiplier for the 2nd+ target of a sweep (the first, centre-most target takes the full hit). Default 1. */
  secondaryMult?: number;
  /** Push (m) given to a standard-mass target (an ordinary zombie) along the swing; scaled by the target's mass (combat/meleeImpact.ts). */
  knockback?: number;
  /** Share of the push turned sideways along a horizontal sweep (to the left: the swings run right -> left). Default 0. */
  knockSide?: number;
  /** Hit stagger (s) on a target the brain lets stagger (its own cooldown / attack / boss rules). Absent = never staggers (as the knife). */
  stagger?: number;
  /** Stamina meter % one swing costs (paid at the contact; a short meter = a winded swing: combat/meleeImpact.ts MELEE_WINDED). */
  stamina?: number;
  /** Held in both hands (two-handed carry / swing poses: weapons/meleeView.ts). */
  twoHanded?: boolean;
  /** A CHARGE swing: holding the wound-up (ready) pose charges it over `time` s; the release's charge 0..1 scales the hit. */
  charge?: MeleeCharge;
  /** Struck props / loose items take the normal hit interaction (per-instance damage, a shove of a movable prop); absent = chips only. */
  propHits?: boolean;
}

/**
 * Lane MELEE (weapon variety): a charge swing's scaling. `k` = seconds held in the ready pose / `time` (0 = a tap, 1 = full charge;
 * holding longer keeps 1). Each pair is [at a tap, at full charge], linear in between: damage and knockback MULTIPLY the def's
 * damage / `knockback`, `stagger` is the stagger in seconds (absent: the spec's `stagger`), `stamina` multiplies the spec's cost.
 */
export interface MeleeCharge {
  time: number;
  damage: readonly [number, number];
  knockback: readonly [number, number];
  stagger?: readonly [number, number];
  stamina?: readonly [number, number];
}

/** Lane FEEL: the stage of a melee weapon's cycle (null = the carry pose, nothing under way). */
export type MeleeStage = 'windup' | 'ready' | 'swing' | 'recover';

/** Lane FEEL: minimum seconds between two swing starts of a melee weapon (a tap every frame cannot beat it). */
export function meleeCadence(m: Pick<MeleeSpec, 'windup' | 'sweep' | 'recovery'>): number {
  return m.windup + m.sweep + m.recovery;
}

/** Lane MELEE (weapon variety): the charge 0..1 after holding a charge weapon's ready pose for `heldS` s (full at `time`, then kept). */
export function meleeChargeK(c: Pick<MeleeCharge, 'time'>, heldS: number): number {
  return Math.max(0, Math.min(1, heldS / c.time));
}

/**
 * Iteration 15 (user: "increase the recoil a little bit basically across the board ... fifty percent recoil to
 * everything"): every gun's FIRING recoil amplitudes x1.5, applied ONCE here at the definition — camera kick (pitch, yaw)
 * and the viewmodel's visual kick (kick); the application code (game.fire, Viewmodel.fire) is unchanged, so nothing is
 * scaled twice. Recovery rate, damage, spread, fire rate, ammo, knockback and every other motion are unchanged.
 * Base values (iteration 14) stay readable at each def.
 */
export {RECOIL_SCALE, firingRecoil}; // (task studio-weapon-variety-production-20261109-224355-01: defined in weapons/recoil.ts, a leaf module the variety defs share)

export const WEAPONS: Record<string, WeaponDef> = {
  rifle: {
    id: 'rifle', itemId: 'rifle', caliber: '5.56x45mm', magazine: 30, auto: true, interval: 0.1,
    damage: 24, pellets: 1, spreadHip: 0.028, spreadAim: 0.004, spreadMove: 0.03,
    range: 90, falloffStart: 40, falloffMin: 0.7, headMult: 2.5, limbMult: 0.7, knockback: 0.25,
    reload: {kind: 'magazine', time: 2.1, emptyTime: 2.55},
    recoil: firingRecoil({pitch: 0.012, yaw: 0.006, kick: 0.035, recover: 9}),
    equipTime: 0.55, aimFov: 52, moveMult: 0.95, noise: 30, sound: 'rifle',
    // Iteration 15 (user: "the scope doesn't work anymore after we replaced the model"): the iteration-04 see-through optic
    // is back (same eye relief 0.105 m) on the user's red-dot rifle via a runtime rear aperture (weapons/optic.ts), measured
    // from rifle-user.glb: the sight is a solid capped cylinder on axis (-0.0035, 0.1394), rear cap face r ~24 mm ending at
    // z 0.0833; the glass sits 2.2 mm eye-side of it, r 16 mm (an 8 mm housing rim stays). `sightRelief` / `sightLift`
    // remain the fallback for a rifle model without that sight.
    view: {model: 'rifle', hip: [0.245, -0.41, -0.7], aim: [0.0, -0.283, -0.42], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 0.92, sightRelief: 0.26, sightLift: 0.04,
      optic: {eyeRelief: 0.105, aperture: {x: -0.0035, y: 0.1394, z: 0.0855, radius: 0.016}}},
  },
  shotgun: {
    id: 'shotgun', itemId: 'shotgun', caliber: '12ga', magazine: 6, auto: false, interval: 0.82,
    damage: 15, pellets: 9, spreadHip: 0.075, spreadAim: 0.052, spreadMove: 0.02,
    range: 30, falloffStart: 7, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.55,
    reload: {kind: 'shell', start: 0.38, each: 0.48, end: 0.42},
    recoil: firingRecoil({pitch: 0.06, yaw: 0.015, kick: 0.09, recover: 6}),
    equipTime: 0.6, aimFov: 60, moveMult: 0.92, noise: 38, sound: 'shotgun',
    view: {model: 'shotgun', hip: [0.235, -0.27, -0.66], aim: [0.0, -0.095, -0.45], hipYaw: 0.12, hipPitch: 0.03, hipRoll: -0.05, length: 1.0, sightRelief: 0.30, sightLift: 0.022},
  },
  // Targeted pass 2026-10-28 (pistol lane): compact semi-auto sidearm, 9mm (9×19mm; lane AMMO: item ammo_9mm). The starting weapon now that
  // the user's pistol.glb is in (weapons/pistol.ts PISTOL_ART_READY); hip brings the 0.185 m pistol in close at the grip.
  pistol: {
    id: 'pistol', itemId: 'pistol', caliber: '9x19mm', magazine: 15, auto: false, interval: 0.16,
    damage: 17, pellets: 1, spreadHip: 0.022, spreadAim: 0.006, spreadMove: 0.025,
    range: 60, falloffStart: 22, falloffMin: 0.6, headMult: 2.4, limbMult: 0.7, knockback: 0.18,
    reload: {kind: 'magazine', time: 1.4, emptyTime: 1.65},
    recoil: firingRecoil({pitch: 0.016, yaw: 0.005, kick: 0.03, recover: 11}),
    equipTime: 0.35, aimFov: 58, moveMult: 1.0, noise: 24, sound: 'pistol',
    // Iteration 12 (LIGHT, user #6 "move the pistol lower and slightly more in towards the camera during ADS"): the sights now
    // sit 14 mm under the screen centre (~2.9 deg, the crosshair stays the aim point) and 40 mm closer (relief 0.32 -> 0.28).
    view: {model: 'pistol', hip: [0.16, -0.17, -0.36], aim: [0.0, -0.08, -0.36], hipYaw: 0.08, hipPitch: 0.03, hipRoll: -0.04, length: 0.2, sightRelief: 0.28, sightLift: 0.014},
  },
  // Lane KNIFE (knife-melee-20261030): the user's survival knife (knife-user.glb), the first MELEE weapon — in every NewGame
  // kit next to the pistol. No caliber (never counts / takes ammo). No knockback and no hit stagger (game.ts meleeContact).
  // Lane FEEL (knife-windup-20261030; user: "very overpowered, one hit to the head ... we're gonna go two hits to the head,
  // scale up the body hits as well ... take twenty five percent of the range away"): damage HALVED 60 -> 30 (head x2 = 60),
  // reach 1.5 -> 1.125 m (exactly -25 %; the model is not resized). Vs ai/brain.ts ZOMBIE_STATS / creatureActor RATDOG_STATS:
  // a standard zombie (shambler 100 hp) = 2 head / 4 body hits (torso and limbs alike, limbMult 1); the coated zombie (165 hp)
  // = 3 head / 6 body hits; rats / dogs (44 hp) = 1 head / 2 body hits. Hold to wind up, release to swing (MeleeSpec): a tap
  // = 0.15 s raise -> contact 0.08 s after it -> sweep 0.16 s -> 0.34 s back to the carry; swing-to-swing >= 0.65 s (the
  // previous cadence). A zombie starts its swipe at 1.35-1.4 m feet to feet: with the shorter reach a knife kill is a trade.
  knife: {
    id: 'knife', itemId: 'knife', magazine: 0, auto: false, interval: 0.65,
    damage: 30, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
    range: 1.125, falloffStart: 1.125, falloffMin: 1, headMult: 2, limbMult: 1, knockback: 0,
    reload: {kind: 'magazine', time: 0, emptyTime: 0}, // never used: a melee def returns before any reload logic
    recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8}, // no firing recoil (not a gun; RECOIL_SCALE does not apply)
    equipTime: 0.3, aimFov: 75, moveMult: 1.0, noise: 5,
    sound: 'pistol', // placeholder for the gun-only cue type: a knife never calls shot / dry / reload cues (swing: sfx.meleeSwing)
    melee: {windup: 0.15, strike: 0.08, sweep: 0.16, recovery: 0.34, rays: KNIFE_RAYS},
    // Lane FEEL: upright carry — grip (the hand) low right, blade standing up (tip up, leaning a little forward and in), edge
    // forward (was carried sideways: blade up-left, flat to the eye). Windup / ready / swing / recovery: weapons/meleeView.ts.
    view: {model: 'knife', ...carryView(KNIFE_POSES.carry), length: 0.32},
  },
  // task studio-weapon-variety-production-20261109-224355-01: the twelve user-approved additions (the baseline four above are unchanged)
  ...VARIETY_GUN_DEFS,
  ...VARIETY_MELEE_DEFS,
  [FLAMETHROWER_DEF.id]: FLAMETHROWER_DEF, // task studio-flamethrower-fire-20261114-031614-01 (bench / Market only: never a find)
};

/** Lane KNIFE: the weapon def of an item id when it is a melee weapon (knife), else null. */
export function meleeDefOf(itemId: string | null | undefined, defs: Record<string, WeaponDef> = WEAPONS): WeaponDef | null {
  const d = itemId ? Object.values(defs).find(w => w.itemId === itemId) : undefined;
  return d?.melee ? d : null;
}

/** The weapon def of an item id when it is a STREAM weapon (the flamethrower: no magazine — its fuel is the worn tank's), else null. */
export function streamDefOf(itemId: string | null | undefined, defs: Record<string, WeaponDef> = WEAPONS): WeaponDef | null {
  const d = itemId ? Object.values(defs).find(w => w.itemId === itemId) : undefined;
  return d?.stream ? d : null;
}

// ---- Lane AMMO (knife-melee-20261030): caliber-based ammo -----------------------------------------------------------------

/** The ammo item a weapon loads from (resolved through its caliber), or null for a weapon that uses no ammo (melee). */
export function weaponAmmoItem(def: WeaponDef): string | null {
  return def.caliber ? ammoItemFor(def.caliber) : null;
}

/** Rounds of the weapon's caliber in the inventory (quick slots + pockets; shared by every weapon of that caliber). */
export function reserveFor(def: WeaponDef, inv: Pick<Inventory, 'count'>): number {
  const id = weaponAmmoItem(def);
  return id ? inv.count(id) : 0;
}

/** Player-facing caliber label of a weapon ('9mm', '5.56mm', '12-gauge'), or '' without ammo. */
export function caliberLabel(def: WeaponDef): string {
  return def.caliber ? CALIBERS[def.caliber].label : '';
}

/** Weapons that chamber a caliber (inventory tooltips: what an ammo item loads). */
export function weaponsForCaliber(c: Caliber, defs: Record<string, WeaponDef> = WEAPONS): WeaponDef[] {
  return Object.values(defs).filter(d => d.caliber === c);
}

/** Lane KNIFE / FEEL: 'swinging' = a melee cycle under way (windup / ready hold / swing / recovery: WeaponController.meleeStage). */
export type WeaponPhase = 'none' | 'equipping' | 'idle' | 'reloading' | 'swinging';

export type WeaponEvent =
  | {type: 'fire'; def: WeaponDef}
  | {type: 'dry'; def: WeaponDef}
  | {type: 'reloadStart'; def: WeaponDef; empty: boolean}
  | {type: 'shellIn'; def: WeaponDef}
  // (task studio-turnstile-reload-visuals-20261112-063646-01) a BreakReload with spentHulls, fully open: its `hulls` spent hulls leave the gun
  | {type: 'eject'; def: WeaponDef; hulls: number}
  | {type: 'reloadEnd'; def: WeaponDef}
  | {type: 'equipped'; def: WeaponDef}
  // Lane FEEL (melee only): a press started the windup (the raise; silent, nothing can be hit yet)
  | {type: 'windup'; def: WeaponDef}
  // Lane KNIFE / FEEL (melee only): the release committed ONE swing (whoosh / sweep) and — exactly once per swing,
  // `melee.strike` s later unless cancelled first — the blade's contact moment, when the game resolves the hit
  // (game.ts meleeContact). `swing` numbers them.
  // (lane MELEE, weapon variety: a CHARGE weapon's swing / contact also carry the release's `charge` 0..1; absent for the others)
  | {type: 'swing'; def: WeaponDef; swing: number; charge?: number}
  | {type: 'contact'; def: WeaponDef; swing: number; charge?: number}
  // Task studio-flamethrower-fire-20261114-031614-01 (stream weapons only; StreamSpec): the stream lit / `ticks` PAID ticks of flame are due
  // now (each took one fuel unit) / the stream went out (`dry`: the tank ran empty under the trigger) / a fuel can started pouring into the
  // worn tank / the pour ended (`poured`: the can went in; false = cancelled, nothing taken).
  | {type: 'streamStart'; def: WeaponDef}
  | {type: 'flame'; def: WeaponDef; ticks: number}
  | {type: 'streamEnd'; def: WeaponDef; dry: boolean}
  | {type: 'refuelStart'; def: WeaponDef}
  | {type: 'refuelEnd'; def: WeaponDef; poured: boolean};

export interface TriggerInput {
  /** Trigger currently held. */
  held: boolean;
  /** Trigger went down this frame (latched by Input until the frame ends, so a down + up inside one frame still counts). */
  pressed: boolean;
  reload: boolean;
  /** Sprinting/using items keeps the gun lowered. */
  lowered: boolean;
  /**
   * Lane FEEL: Input.clears (bumped whenever held input is wiped: menus / blur / pointer unlock / state changes). A change
   * while a melee windup / ready hold is under way cancels it (the wiped button must not read as a release that swings).
   */
  clears?: number;
  /** Lane GUNS: aiming down sights this frame (game.aiming) — drives a def's AimSettle; absent = not aiming. */
  aiming?: boolean;
}

/** Lane FEEL: frame-sum tolerance for the melee stage timers (60 fps steps hit the stage lengths exactly). */
const MELEE_EPS = 1e-6;
/** Lane GUNS: a shot within the def's interval + this gap (s) of the previous one continues a string (RecoilClimb). */
export const STREAK_GAP = 0.1;
/** Task flamethrower-fire: stream ticks one frame may catch up (a 0.3 s hitch burns 3 units of flame, not a burst of 30). */
export const STREAM_CATCHUP = 3;

export class WeaponController {
  def: WeaponDef | null = null;
  stack: ItemStack | null = null;
  phase: WeaponPhase = 'none';
  phaseT = 0;
  cooldown = 0;
  /** Reload sub-state for shell-by-shell loading. */
  private shellStage: 'start' | 'load' | 'end' = 'start';
  private interruptReload = false;
  /** (task turnstile-reload-visuals) this break reload has thrown out the spent hulls (at its `eject` time). */
  private ejected = false;
  /** 0..1 progress for HUD/viewmodel. */
  progress = 0;
  /** Iteration 16 (lane GEAR): reload time multiplier — gloves x0.92, an arm injury slower (Game.mods.handlingMult, set every frame). */
  handling = 1;
  /** Lane FEEL: the melee cycle's stage (null = carry pose / nothing under way) and seconds into it. */
  meleeStage: MeleeStage | null = null;
  stageT = 0;
  /** Lane KNIFE: swings committed by this controller (the id carried by its 'swing' / 'contact' events). */
  swingId = 0;
  /** Lane KNIFE: this swing's contact has not happened yet (cleared at contact or by cancelSwing). */
  private contactPending = false;
  /** Lane FEEL: the button came up during the windup (a tap): the swing follows as soon as the minimum windup is done. */
  private releaseQueued = false;
  /** Lane FEEL: a NEW press arrived while a swing / recovery / queued tap was under way: it starts the next windup when allowed. */
  private pressQueued = false;
  /** Lane FEEL: TriggerInput.clears seen last frame (a change = the held input was wiped: a windup cancels, never swings). */
  private seenClears: number | undefined;
  /** Lane GUNS: shots so far in the current string (0 = the first shot of a string; RecoilClimb) and seconds since the last shot. */
  streak = 0;
  private sinceShot = Infinity;
  /** Lane GUNS: seconds of steady aiming counted toward the def's AimSettle (0 when not aiming; shots set it back). */
  aimT = 0;
  /** Task flamethrower-fire: a stream weapon's flame is on (from its first paid tick until the last paid tick has run out). */
  streaming = false;
  /** Task flamethrower-fire: seconds left of the tick already paid for (the next tick is due at 0). */
  private tickT = 0;

  equip(stack: ItemStack | null, defs = WEAPONS): void {
    if (stack === this.stack && stack) return;
    this.stack = stack;
    this.def = stack ? defs[stack.itemId] ?? null : null;
    this.phase = this.def ? 'equipping' : 'none';
    this.phaseT = this.def ? this.def.equipTime : 0;
    this.cooldown = 0;
    this.progress = 0;
    this.streak = 0; this.sinceShot = Infinity; this.aimT = 0; // lane GUNS: a new weapon starts a fresh string, unsettled
    this.resetMelee(); // lane KNIFE / FEEL: a windup, ready hold or swing never survives a weapon change (no stale contact)
    this.streaming = false; this.tickT = 0; // task flamethrower-fire: the flame goes out with the weapon (its paid ticks were already given)
  }

  /**
   * Lane GUNS: the extra aimed cone (rad) the def's AimSettle still adds now — `extra` at the start of ADS, eased to 0 after
   * `time` s of steady aim. 0 for a def without one (the baseline guns) or while not aiming.
   */
  get settleSpread(): number {
    const a = this.def?.aimSettle;
    if (!a) return 0;
    const k = Math.min(1, this.aimT / Math.max(1e-6, a.time));
    return a.extra * (1 - k * k * (3 - 2 * k));
  }

  /**
   * Lane GUNS: how far a BREAK action is open (0 closed .. 1 fully open): opening over the first `eject` s of the reload,
   * open while shells go in, closing over `end`. 0 for every other weapon / phase (the viewmodel turns the model's Barrels).
   */
  get actionOpen(): number {
    const d = this.def;
    if (!d || d.reload.kind !== 'break' || this.phase !== 'reloading') return 0;
    const r = d.reload, clamp = (x: number) => Math.min(1, Math.max(0, x));
    if (this.shellStage === 'start') return clamp((r.start - this.phaseT) / Math.max(1e-6, r.eject));
    if (this.shellStage === 'load') return 1;
    return clamp(this.phaseT / Math.max(1e-6, r.end));
  }

  get reloading(): boolean {
    return this.phase === 'reloading';
  }

  /**
   * (task studio-turnstile-reload-visuals-20261112-063646-01) Seconds (real time) until the shell now going in is in ('shellIn': it is taken
   * from the reserve then) while a shell / break reload loads one, else null. The held view slides it home over its last moments.
   */
  get shellDue(): number | null {
    const k = this.def?.reload.kind;
    return this.phase === 'reloading' && (k === 'shell' || k === 'break') && this.shellStage === 'load' ? Math.max(0, this.phaseT) * Math.max(0.25, this.handling) : null;
  }

  /** Lane KNIFE / FEEL: a melee cycle is under way (windup, ready hold, swing or recovery). */
  get swinging(): boolean {
    return this.phase === 'swinging';
  }

  /** Lane KNIFE / FEEL: seconds since the release of the running swing (swing + recovery), or -1 (QA / HUD). */
  get swingTime(): number {
    const m = this.def?.melee;
    if (!m || this.phase !== 'swinging') return -1;
    return this.meleeStage === 'swing' ? this.stageT : this.meleeStage === 'recover' ? m.sweep + this.stageT : -1;
  }

  /** Lane FEEL: the button is being held in the windup / wound-up pose (no attack yet; the release swings). */
  get winding(): boolean {
    return this.phase === 'swinging' && (this.meleeStage === 'windup' || this.meleeStage === 'ready') && !this.releaseQueued;
  }

  /**
   * Lane FEEL: the viewmodel's melee pose input (weapons/meleeView.ts meleePoseOffset). Lane MELEE (weapon variety): + `charge` 0..1 —
   * the live charge while a CHARGE weapon's ready pose is held, the committed swing's charge during its swing / recovery (0 otherwise).
   */
  get meleePose(): {stage: MeleeStage | null; t: number; charge: number} {
    const stage = this.phase === 'swinging' ? this.meleeStage : null;
    return {stage, t: this.stageT, charge: stage === 'ready' ? this.chargeLevel : stage === 'swing' || stage === 'recover' ? this.swingCharge : 0};
  }

  /**
   * Lane MELEE (weapon variety): the CHARGE built so far (0..1) while a charge weapon's wound-up pose is held (the HUD cue, the pose);
   * 0 for a weapon without `melee.charge`, before the windup is complete and once released.
   */
  get chargeLevel(): number {
    const c = this.def?.melee?.charge;
    return c && this.phase === 'swinging' && this.meleeStage === 'ready' && !this.releaseQueued ? meleeChargeK(c, this.stageT) : 0;
  }

  /** Lane MELEE (weapon variety): the charge 0..1 the running / last committed swing was released with (0 without `melee.charge`). */
  swingCharge = 0;

  /**
   * Lane KNIFE / FEEL: abort the melee cycle (menus / pause / focus or pointer-lock loss / death / travel / restart, and
   * through `lowered` sprint / item use / climbing / a lane UI): a windup or ready hold drops WITHOUT attacking (a later
   * release does nothing), a swing before its contact never makes it, a remembered press is forgotten. After a release the
   * remaining swing + recovery time stays as cooldown (re-opening a menu never skips the recovery).
   * Returns true when an attack was still pending (windup / ready hold / swing before contact).
   */
  cancelSwing(): boolean {
    if (this.phase !== 'swinging') { this.pressQueued = false; return false; }
    const pending = this.contactPending || this.meleeStage === 'windup' || this.meleeStage === 'ready';
    this.phase = 'idle';
    this.progress = 0;
    this.resetMelee();
    return pending;
  }

  private resetMelee(): void {
    this.meleeStage = null;
    this.stageT = 0;
    this.swingCharge = 0; // lane MELEE: a cancelled / finished swing leaves no charge behind
    this.contactPending = false;
    this.releaseQueued = false;
    this.pressQueued = false;
  }

  canReload(inv: Inventory): boolean {
    const d = this.def, s = this.stack;
    if (d?.melee) return false; // lane KNIFE: nothing to reload
    if (d?.stream) return canPourCan(wornFuelTank(inv)) && inv.count(FLAME_FUEL_CAN) > 0; // task flamethrower-fire: a whole can fits the worn tank
    return !!d && !!s && (s.mag ?? 0) < d.magazine && reserveFor(d, inv) > 0;
  }

  update(dt: number, input: TriggerInput, inv: Inventory): WeaponEvent[] {
    const ev: WeaponEvent[] = [];
    const d = this.def, s = this.stack;
    if (!d || !s) return ev;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt; // lane GUNS: string timing (RecoilClimb)
    if (d.aimSettle) this.aimT = input.aiming ? this.aimT + dt : 0; // lane GUNS: the hold steadies while aiming
    if (this.phase === 'equipping') {
      this.phaseT -= dt;
      this.progress = 1 - Math.max(0, this.phaseT) / d.equipTime;
      if (this.phaseT <= 0) {
        this.phase = 'idle';
        ev.push({type: 'equipped', def: d});
      }
      return ev;
    }
    if (d.melee) return this.updateMelee(dt, input, ev); // lane KNIFE: swing cycle instead of fire / magazine / reload
    if (d.stream) return this.updateStream(dt, input, inv, ev); // task flamethrower-fire: fuel ticks instead of fire / magazine / reload
    if (this.phase === 'reloading') {
      if (input.pressed && (d.reload.kind === 'shell' || d.reload.kind === 'break') && (s.mag ?? 0) > 0) this.interruptReload = true; // (lane GUNS: + break)
      this.phaseT -= dt / Math.max(0.25, this.handling); // Iteration 16: handling scales the whole reload (magazine and shell by shell)
      if (d.reload.kind === 'magazine') {
        const total = (s.mag ?? 0) === 0 ? d.reload.emptyTime : d.reload.time;
        this.progress = 1 - Math.max(0, this.phaseT) / total;
        if (this.phaseT <= 0) {
          const need = d.magazine - (s.mag ?? 0), ammo = weaponAmmoItem(d);
          s.mag = (s.mag ?? 0) + (ammo ? inv.take(ammo, need) : 0);
          inv.version++;
          this.phase = 'idle';
          ev.push({type: 'reloadEnd', def: d});
        }
      } else if (d.reload.kind === 'break') {
        this.updateBreak(d, d.reload, s, inv, ev); // lane GUNS: open -> load up to `magazine` -> close
      } else {
        const r = d.reload;
        while (this.phaseT <= 0 && this.phase === 'reloading') {
          if (this.shellStage === 'start') {
            this.shellStage = 'load';
            this.phaseT += r.each;
          } else if (this.shellStage === 'load') {
            const ammo = weaponAmmoItem(d);
            if (ammo && inv.take(ammo, 1) === 1) {
              s.mag = (s.mag ?? 0) + 1;
              inv.version++;
              ev.push({type: 'shellIn', def: d});
            }
            if ((s.mag ?? 0) >= d.magazine || reserveFor(d, inv) === 0 || this.interruptReload) {
              this.shellStage = 'end';
              this.phaseT += r.end;
            } else this.phaseT += r.each;
          } else {
            this.phase = 'idle';
            ev.push({type: 'reloadEnd', def: d});
          }
        }
        this.progress = (s.mag ?? 0) / d.magazine;
      }
      return ev;
    }
    // idle
    if (input.reload && this.canReload(inv)) {
      this.startReload(ev);
      return ev;
    }
    if (input.lowered) return ev;
    const wants = d.auto ? input.held : input.pressed;
    if (wants && this.cooldown <= 0) {
      if ((s.mag ?? 0) > 0) {
        s.mag = (s.mag ?? 0) - 1;
        if (d.reload.kind === 'break' && d.reload.spentHulls) s.spent = (s.spent ?? 0) + 1; // (task turnstile-reload-visuals) the hull stays in its chamber
        inv.version++;
        this.cooldown = d.interval;
        // lane GUNS: string count for RecoilClimb; a shot sets an AimSettle hold back (both unused by the baseline guns)
        this.streak = this.sinceShot <= d.interval + STREAK_GAP ? this.streak + 1 : 0;
        this.sinceShot = 0;
        if (d.aimSettle) this.aimT = Math.max(0, this.aimT - d.aimSettle.shot * d.aimSettle.time);
        ev.push({type: 'fire', def: d});
      } else if (input.pressed) {
        this.cooldown = 0.25;
        ev.push({type: 'dry', def: d});
        if (this.canReload(inv)) this.startReload(ev);
      }
    }
    return ev;
  }

  private startReload(ev: WeaponEvent[]): void {
    const d = this.def!, s = this.stack!;
    this.phase = 'reloading';
    this.interruptReload = false;
    this.ejected = false;
    this.progress = 0;
    if (d.reload.kind === 'magazine') this.phaseT = (s.mag ?? 0) === 0 ? d.reload.emptyTime : d.reload.time;
    else { this.shellStage = 'start'; this.phaseT = d.reload.start; }
    ev.push({type: 'reloadStart', def: d, empty: (s.mag ?? 0) === 0});
  }

  /**
   * Lane GUNS: the BREAK action's reload stages (BreakReload), carried across frame boundaries like the shell reload:
   * 'start' = opening (the hulls leave at `eject` s) -> 'load' one shell per `each` s (taken from the reserve as it goes
   * in; never past `magazine`) -> 'end' = closing, then idle. A trigger press (interruptReload, with a shell loaded)
   * closes it after the current shell — or straight after opening. Firing is only possible once it is closed (idle).
   */
  private updateBreak(d: WeaponDef, r: BreakReload, s: ItemStack, inv: Inventory, ev: WeaponEvent[]): void {
    const full = () => (s.mag ?? 0) >= d.magazine || reserveFor(d, inv) === 0 || this.interruptReload;
    // (task studio-turnstile-reload-visuals-20261112-063646-01) fully open (`eject` s in, before any shell of this frame): the spent hulls
    // leave — exactly the stack's own count, once per reload; the live rounds stay. A switch before this moment keeps them in the gun.
    if (this.shellStage === 'start' && !this.ejected && r.start - this.phaseT >= r.eject - 1e-9) {
      this.ejected = true;
      const hulls = r.spentHulls ? s.spent ?? 0 : 0;
      if (hulls > 0) {
        delete s.spent;
        inv.version++;
        ev.push({type: 'eject', def: d, hulls});
      }
    }
    while (this.phaseT <= 0 && this.phase === 'reloading') {
      if (this.shellStage === 'start') {
        if (full()) { this.shellStage = 'end'; this.phaseT += r.end; } else { this.shellStage = 'load'; this.phaseT += r.each; }
      } else if (this.shellStage === 'load') {
        const ammo = weaponAmmoItem(d);
        if (ammo && (s.mag ?? 0) < d.magazine && inv.take(ammo, 1) === 1) {
          s.mag = (s.mag ?? 0) + 1;
          inv.version++;
          ev.push({type: 'shellIn', def: d});
        }
        if (full()) { this.shellStage = 'end'; this.phaseT += r.end; } else this.phaseT += r.each;
      } else {
        this.phase = 'idle';
        ev.push({type: 'reloadEnd', def: d});
      }
    }
    this.progress = (s.mag ?? 0) / d.magazine;
  }

  /**
   * Lane KNIFE / FEEL: the melee cycle (MeleeSpec): press -> windup -> (held: ready, no attack) -> release -> swing (ONE
   * 'contact' `strike` s after the release) -> recovery -> carry. A release during the windup (a quick tap, even a down + up
   * inside one frame: `pressed` without `held`) is queued and the swing follows the moment the minimum windup is done.
   * Holding never repeats; a new press during the swing / recovery is remembered and starts the next windup once the
   * recovery (or a cancelled swing's cooldown) is over. Lowered (sprint / item use / climbing / a lane UI owning the
   * buttons) or wiped input (`clears`) cancels a windup / ready hold with no attack, and a swing before its contact.
   * Nothing here reads, counts or takes ammo; reload input is ignored. Stage times carry across frame boundaries.
   */
  private updateMelee(dt: number, input: TriggerInput, ev: WeaponEvent[]): WeaponEvent[] {
    const d = this.def!, m = d.melee!;
    const winding = () => this.meleeStage === 'windup' || this.meleeStage === 'ready';
    const wiped = input.clears !== undefined && this.seenClears !== undefined && input.clears !== this.seenClears;
    this.seenClears = input.clears;
    if (wiped) { // held input wiped (menu / blur / pointer unlock): the hold is gone, so it must not read as a release that swings
      if (winding()) this.cancelSwing();
      this.pressQueued = false;
    }
    const fresh = this.phase !== 'swinging'; // nothing under way at the start of this frame
    if (input.lowered) {
      if (winding() || (this.meleeStage === 'swing' && this.contactPending)) this.cancelSwing();
      this.pressQueued = false; // a press made while lowered is forgotten (the recovery after a contact just runs out)
    }
    let press = input.pressed && !input.lowered;
    if (this.phase === 'swinging' && press) {
      // a new press during the windup implies a release in between (both inside one frame): the swing is due, the press waits
      if (winding()) this.releaseQueued = true;
      this.pressQueued = true;
      press = false;
    }
    if (winding() && !input.held) this.releaseQueued = true;
    let rem = dt;
    for (let guard = 0; guard < 8 && this.phase === 'swinging'; guard++) {
      const st = this.meleeStage;
      if (st === 'windup') {
        const need = m.windup - this.stageT;
        if (rem + MELEE_EPS < need) { this.stageT += rem; rem = 0; break; }
        rem = Math.max(0, rem - need);
        this.meleeStage = 'ready';
        this.stageT = 0;
      } else if (st === 'ready') {
        if (this.releaseQueued) { this.startSwing(ev); continue; } // the swing gets the rest of this frame
        if (m.holdMax !== undefined && this.stageT + rem + MELEE_EPS >= m.holdMax) { this.cancelSwing(); break; } // the arm relaxes: no attack
        this.stageT += rem; rem = 0; break;
      } else if (st === 'swing') {
        if (this.contactPending && this.stageT + rem + MELEE_EPS >= m.strike) {
          this.contactPending = false;
          ev.push(m.charge ? {type: 'contact', def: d, swing: this.swingId, charge: this.swingCharge} : {type: 'contact', def: d, swing: this.swingId});
        }
        const need = m.sweep - this.stageT;
        if (rem + MELEE_EPS < need) { this.stageT += rem; rem = 0; break; }
        rem = Math.max(0, rem - need);
        this.meleeStage = 'recover';
        this.stageT = 0;
      } else {
        const need = m.recovery - this.stageT;
        if (rem + MELEE_EPS < need) { this.stageT += rem; rem = 0; break; }
        rem = Math.max(0, rem - need);
        this.phase = 'idle';
        this.cooldown = 0;
        this.resetMelee0();
      }
    }
    this.progress = this.phase === 'swinging' && this.swingTime >= 0 ? Math.min(1, this.swingTime / (m.sweep + m.recovery)) : 0;
    if (this.phase !== 'idle' || input.lowered) return ev;
    if ((press || this.pressQueued) && this.cooldown <= MELEE_EPS) {
      // the windup starts (from a press now, or one remembered during the last swing / recovery); a button already up = a tap
      this.pressQueued = false;
      this.phase = 'swinging';
      this.meleeStage = 'windup';
      this.stageT = fresh ? 0 : Math.min(rem, m.windup); // straight after a recovery that ended mid-frame: keep the leftover
      this.releaseQueued = !input.held;
      ev.push({type: 'windup', def: d});
    } else if (press) this.pressQueued = true; // during a cancelled swing's leftover cooldown: starts the windup when it ends
    return ev;
  }

  /** Lane FEEL: the release commits ONE swing (whoosh / sweep now, contact `strike` s later); the cooldown covers sweep + recovery. */
  private startSwing(ev: WeaponEvent[]): void {
    const d = this.def!, m = d.melee!;
    // lane MELEE (weapon variety): a CHARGE weapon's release keeps the charge built in the ready pose (startSwing runs from 'ready')
    this.swingCharge = m.charge && this.meleeStage === 'ready' ? meleeChargeK(m.charge, this.stageT) : 0;
    this.meleeStage = 'swing';
    this.stageT = 0;
    this.releaseQueued = false;
    this.contactPending = true;
    this.cooldown = m.sweep + m.recovery;
    this.swingId++;
    ev.push(m.charge ? {type: 'swing', def: d, swing: this.swingId, charge: this.swingCharge} : {type: 'swing', def: d, swing: this.swingId});
  }

  /** Lane FEEL: back to the carry at the natural end of a recovery (keeps a press remembered meanwhile). */
  private resetMelee0(): void {
    const queued = this.pressQueued;
    this.resetMelee();
    this.pressQueued = queued;
  }

  /**
   * Task studio-flamethrower-fire-20261114-031614-01: the STREAM cycle (StreamSpec). One whole fuel unit of the WORN tank per tick, taken
   * in the same step its 'flame' tick is emitted; at most one tick per `unitSeconds` (a frame longer than that catches up, bounded). The
   * magazine / reserve / caliber code is never reached: `mag` stays 0 and no ammo item is ever counted or taken.
   */
  private updateStream(dt: number, input: TriggerInput, inv: Inventory, ev: WeaponEvent[]): WeaponEvent[] {
    const d = this.def!, sp = d.stream!;
    const tank = wornFuelTank(inv);
    const out = (dry: boolean) => { if (this.streaming) { this.streaming = false; ev.push({type: 'streamEnd', def: d, dry}); } };
    if (this.phase === 'reloading') { // a can is being poured into the worn tank
      // the tank came off, the can left the pockets or the gun was lowered (sprint / item use / climbing): nothing poured, nothing taken
      if (!this.canReload(inv) || input.lowered) {
        this.phase = 'idle'; this.progress = 0;
        ev.push({type: 'refuelEnd', def: d, poured: false});
        return ev;
      }
      this.phaseT -= dt / Math.max(0.25, this.handling);
      this.progress = 1 - Math.max(0, this.phaseT) / sp.refillTime;
      if (this.phaseT <= 0) {
        const poured = pourCan(tank!, inv); // the can leaves the pockets and its units arrive together
        this.phase = 'idle'; this.progress = 0;
        ev.push({type: 'refuelEnd', def: d, poured});
      }
      return ev;
    }
    const fresh = this.tickT <= 0 && !this.streaming; // no paid tick is running: a press now starts a full tick
    this.tickT -= dt; // the paid tick runs out in real time, held or not
    if (input.reload && !input.lowered && this.canReload(inv)) {
      out(false);
      this.tickT = 0;
      this.phase = 'reloading'; this.phaseT = sp.refillTime; this.progress = 0;
      ev.push({type: 'refuelStart', def: d});
      return ev;
    }
    const wants = input.held && !input.lowered;
    if (wants && tank && tankFuel(tank) > 0) {
      // every tick due this frame: take ONE unit, then give its tick. A held stream keeps the frame's overshoot (an exact tick rate);
      // a long frame catches up at most STREAM_CATCHUP ticks and drops the rest of the backlog — time lost, never fuel.
      let ticks = 0;
      while (this.tickT <= 0 && ticks < STREAM_CATCHUP && burnUnit(tank)) {
        ticks++;
        this.tickT = fresh && ticks === 1 ? sp.unitSeconds : this.tickT + sp.unitSeconds;
      }
      if (ticks >= STREAM_CATCHUP && this.tickT <= 0) this.tickT = sp.unitSeconds;
      if (ticks > 0) {
        inv.version++;
        if (!this.streaming) { this.streaming = true; ev.push({type: 'streamStart', def: d}); }
        ev.push({type: 'flame', def: d, ticks});
      }
    } else if (input.pressed && !input.lowered && this.cooldown <= 0 && !this.streaming) {
      this.cooldown = 0.25; // no tank on the back / an empty tank: a dry click (the game says which)
      ev.push({type: 'dry', def: d});
    }
    // the flame goes out once the last paid tick has run out and no new one was paid (released, lowered, the tank empty or taken off)
    if (this.streaming && this.tickT <= 0) out(wants && tankFuel(tank) === 0);
    if (!this.streaming) this.tickT = Math.max(0, this.tickT);
    return ev;
  }

  /** Damage multiplier by distance. */
  static falloff(d: WeaponDef, dist: number): number {
    if (dist <= d.falloffStart) return 1;
    if (dist >= d.range) return d.falloffMin;
    const t = (dist - d.falloffStart) / (d.range - d.falloffStart);
    return 1 + (d.falloffMin - 1) * t;
  }
}
