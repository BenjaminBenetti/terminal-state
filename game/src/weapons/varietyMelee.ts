// Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): the six new melee weapons' WeaponDefs (ids: weapons/varietyIds.ts
// VARIETY_MELEE_IDS). weapons.ts spreads them into WEAPONS after the baseline four; the knife is untouched.
// A leaf module: import only TYPES from weapons.ts, never weapons.ts values (import cycle).
//
// HANDLING — every one REALLY different, none a flat upgrade on the knife (windup 0.15 / strike 0.08 / sweep 0.16 / recovery 0.34 s =
// 0.65 s a swing, 30 body / 60 head, reach 1.125 m, one target, no push / stagger / stamina). Vs the real enemy numbers (ai/brain.ts
// ZOMBIE_STATS: shambler 100 hp, swipe from 1.35 m feet to feet, 1.8 m centre to centre at its impact; coated 165; rat / dog 44; the
// Strainer 1200 and the Siren 200 resist knockdown: combat/meleeImpact.ts) and the stamina meter (0-100 %, refills 14.4 %/s after a
// 0.9 s pause that every paid swing restarts; Player.spendStamina; short = a WINDED swing: x0.7 damage, x0.4 push, no stagger):
//  - FIRE AXE (two-handed heavy chop): 0.45 s committed raise, 1.33 s a swing, 55 body / 110 head = ONE head or TWO body hits on a
//    shambler, 1.6 m reach (outreaches a zombie's swipe), one target, a small push, standard stagger, 18 % stamina a swing.
//  - MACHETE (fast wide slash): 0.12 s raise, 0.60 s a swing, 24 body / 50 head (5 body / 2 head: weaker than the knife on the body),
//    1.35 m, a WIDE +-0.48 rad arc striking up to TWO targets (the second x0.85), no push / stagger, 6 % stamina.
//  - SLEDGEHAMMER (slowest, heaviest): 0.60 s raise, 1.77 s a swing, 70 body / 112 head (limbs x0.85), 1.7 m, one target, the
//    STRONGEST push (1.1 m on a shambler, by mass) and a 0.7 s stagger (cooldown 1.25 s: no stun-lock), 24 % stamina.
//  - CROWBAR (balanced middle): 0.25 s raise, 0.87 s a swing, 38 body / 76 head (3 body / 2 head), 1.35 m, one target, a short
//    0.25 s stagger and a nudge, 9 % stamina. NO prying / door utility (it is only a weapon).
//  - SLUGGER (aluminium bat, a REAL CHARGE swing): 0.22 s raise, then holding the wound-up pose charges over 1.0 s: damage x0.8 (a tap:
//    29 body, 4 body hits) .. x1.9 (full: 68 body / 137 head = one head or two body hits), push 0.15 .. 1.0 m, stagger 0 .. 0.5 s,
//    stamina x0.6 .. x1.6 of 10 %; 1.45 m, one target. The charge cancels with every windup cancel (menus, switch, death, pointer
//    loss, item use, a lane owning the buttons: fuel pour / turnkey / cart grab) — never an attack on a later release.
//  - TRACK SHOVEL (longest reach): 0.32 s raise, a slow committed 0.62 s recovery (1.20 s a swing), 34 body / 61 head (3 body / 2
//    head), 2.0 m reach, a wide flat sweep striking up to TWO (the second x0.85), a 0.6 m SHOVE, 0.3 s stagger, 14 % stamina. NO digging.
// All are swung exactly like the knife (hold to wind up, release to swing; no auto-repeat; one contact per swing) and never use ammo.
import type {MeleeSpec, WeaponDef} from './weapons';
import {VARIETY_MELEE_POSES, carryView, varietyLength} from './meleeView';
import type {VarietyMeleeId} from './varietyIds';

type Rays = readonly (readonly [number, number])[];

/** OVERHEAD CHOP: a narrow vertical fan (the head comes down the crosshair's column), a little side tolerance, reaching low targets. */
export const CHOP_RAYS: Rays = [[0, 0], [0, -0.09], [0, 0.09], [0.08, 0], [-0.08, 0], [0, -0.18], [0, 0.16], [0, -0.28]];
/** The sledgehammer's broader head: the same chop fan, a little wider. */
export const SLEDGE_RAYS: Rays = [[0, 0], [0, -0.1], [0, 0.1], [0.1, 0], [-0.1, 0], [0, -0.2], [0, 0.18], [0, -0.3]];
/** WIDE horizontal slash (+-0.48 rad ~ +-27 deg, every ray inside the forward view), centre first, then outward both ways. */
export const MACHETE_RAYS: Rays = [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.07], [0, -0.07], [0.24, 0], [-0.24, 0], [0.36, 0], [-0.36, 0], [0.48, 0], [-0.48, 0]];
/** MID diagonal strike (upper right -> lower left), the knife's fan along the diagonal. */
export const CROWBAR_RAYS: Rays = [[0, 0], [0.08, 0.04], [-0.08, -0.04], [0, 0.08], [0, -0.08], [0.16, 0.08], [-0.16, -0.08], [0.12, 0], [-0.12, 0]];
/** The bat's level swing: a moderate horizontal fan (one target: the centre-most). */
export const BAT_RAYS: Rays = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.07], [0, -0.07], [0.2, 0], [-0.2, 0], [0.3, 0], [-0.3, 0]];
/** The shovel's flat sweep at 2 m: a wide fan (+-0.42 rad), plus a low ray for short targets. */
export const SHOVEL_RAYS: Rays = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.06], [0, -0.06], [0.2, 0], [-0.2, 0], [0.3, 0], [-0.3, 0], [0.42, 0], [-0.42, 0], [0, -0.14]];

/** Every new melee weapon shares the knife's non-gun fields (no caliber, magazine 0, no recoil / ADS / reload) — one place for them. */
function meleeDef(id: VarietyMeleeId, o: {damage: number; headMult: number; limbMult: number; range: number; equipTime: number; moveMult: number; noise: number; melee: MeleeSpec}): WeaponDef {
  const m = o.melee;
  return {
    id, itemId: id, magazine: 0, auto: false, interval: m.windup + m.sweep + m.recovery, // = weapons.ts meleeCadence (a tap's swing-to-swing)
    damage: o.damage, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
    range: o.range, falloffStart: o.range, falloffMin: 1, headMult: o.headMult, limbMult: o.limbMult,
    knockback: 0, // the gun pellet push; a melee push is MeleeSpec.knockback (combat/meleeImpact.ts)
    reload: {kind: 'magazine', time: 0, emptyTime: 0}, // never used: a melee def returns before any reload logic
    recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8}, // not a gun
    equipTime: o.equipTime, aimFov: 75, moveMult: o.moveMult, noise: o.noise,
    sound: 'pistol', // placeholder for the gun-only cue type: a melee weapon never calls shot / dry / reload cues (swing: sfx.meleeSwing)
    melee: m,
    view: {model: id, ...carryView(VARIETY_MELEE_POSES[id].carry), length: varietyLength(id)},
  };
}

export const VARIETY_MELEE_DEFS: Readonly<Record<string, WeaponDef>> = {
  fire_axe: meleeDef('fire_axe', {damage: 55, headMult: 2, limbMult: 1, range: 1.6, equipTime: 0.6, moveMult: 0.93, noise: 7,
    melee: {windup: 0.45, strike: 0.12, sweep: 0.26, recovery: 0.62, rays: CHOP_RAYS,
      maxTargets: 1, knockback: 0.35, stagger: 0.35, stamina: 18, twoHanded: true, propHits: true}}),
  machete: meleeDef('machete', {damage: 24, headMult: 2.1, limbMult: 1, range: 1.35, equipTime: 0.4, moveMult: 1.0, noise: 5,
    melee: {windup: 0.12, strike: 0.07, sweep: 0.18, recovery: 0.30, rays: MACHETE_RAYS,
      maxTargets: 2, secondaryMult: 0.85, stamina: 6, propHits: true}}),
  sledgehammer: meleeDef('sledgehammer', {damage: 70, headMult: 1.6, limbMult: 0.85, range: 1.7, equipTime: 0.75, moveMult: 0.88, noise: 9,
    melee: {windup: 0.60, strike: 0.16, sweep: 0.32, recovery: 0.85, rays: SLEDGE_RAYS,
      maxTargets: 1, knockback: 1.1, stagger: 0.7, stamina: 24, twoHanded: true, propHits: true}}),
  crowbar: meleeDef('crowbar', {damage: 38, headMult: 2, limbMult: 1, range: 1.35, equipTime: 0.45, moveMult: 0.97, noise: 6,
    melee: {windup: 0.25, strike: 0.10, sweep: 0.20, recovery: 0.42, rays: CROWBAR_RAYS,
      maxTargets: 1, knockback: 0.2, stagger: 0.25, stamina: 9, propHits: true}}),
  slugger: meleeDef('slugger', {damage: 36, headMult: 2, limbMult: 1, range: 1.45, equipTime: 0.5, moveMult: 0.95, noise: 7,
    melee: {windup: 0.22, strike: 0.10, sweep: 0.22, recovery: 0.45, rays: BAT_RAYS,
      maxTargets: 1, knockback: 1.0, knockSide: 0.35, stamina: 10, twoHanded: true, propHits: true,
      charge: {time: 1.0, damage: [0.8, 1.9], knockback: [0.15, 1.0], stagger: [0, 0.5], stamina: [0.6, 1.6]}}}),
  track_shovel: meleeDef('track_shovel', {damage: 34, headMult: 1.8, limbMult: 1, range: 2.0, equipTime: 0.65, moveMult: 0.9, noise: 7,
    melee: {windup: 0.32, strike: 0.13, sweep: 0.26, recovery: 0.62, rays: SHOVEL_RAYS,
      maxTargets: 2, secondaryMult: 0.85, knockback: 0.6, knockSide: 0.2, stagger: 0.3, stamina: 14, twoHanded: true, propHits: true}}),
};
