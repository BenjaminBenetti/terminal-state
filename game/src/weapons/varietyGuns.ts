// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): the six new guns' data-driven WeaponDefs (ids: weapons/varietyIds.ts
// VARIETY_GUN_IDS). weapons.ts spreads them into WEAPONS after the baseline four, which stay exactly as they were.
// A leaf module: import only TYPES from weapons.ts (runtime helpers: weapons/recoil.ts), never weapons.ts values (import cycle).
//
// User: "the different guns should have different handling! ofc this is obvious!" — every gun differs from its family's baseline in
// fire mode / cadence, recoil (camera kick, string climb, sideways jitter, recovery), spread and its recovery (bloom), ADS settle,
// mobility / equip, magazine, reload style + timing and range; none is a strict upgrade (tests/weapon-variety-guns.test.ts has the
// table). Baseline references: pistol semi 0.16 s / 17 dmg / 15 rds; rifle auto 0.1 s / 24 / 30; pump shotgun 0.82 s / 15 x 9 / 6.
// Calibers come from varietyIds.ts (the three existing ammo pools); sound cues are the existing 'pistol' | 'rifle' | 'shotgun' sets.
//
// HELD VIEW (weapons/viewmodel.ts pivots a model at its `Grip` marker). Task studio-weapon-poses-slot-hierarchy-20261110-064835-01, the
// USER (2026-11-10): the Overwatch "looks too small", the Coach Gun shows "too much stock" and its "holding position not aligned"; "Use
// starter pistol holding pose as best reference". So every new gun's hip pose is ANCHORED to the starter pistol's (weapons.ts `pistol`
// view, unchanged): its firing hand (`Grip`) at the pistol hand's depth and its `Sight` in the pistol sight's on-screen direction, the
// gun turned by its kind's hip rotation (HOLD_RULES; the baseline long guns' / the pistol's). Before, the long guns followed the rifle
// and shotgun (Sight 0.19 m under the eye, butt 0.405 m out) and so sat about twice as far from the eye as the pistol. The pose is
// computed from the cooked model's registry markers (assets/weaponVarietyModels.generated.ts): it moves only where the model is held —
// no scale or mesh change. The baseline rifle / shotgun / pistol keep their poses. ADS always comes from the model's `Sight` marker
// (sightRelief / sightLift, or the scope / red-dot runtime lens on it); `aim` is only the fallback for a model without one. Until the
// model is delivered, the fallback numbers below (the anchored hips, rounded) are used; the gun is simply not shown without a model.
import type {WeaponDef} from './weapons';
import {firingRecoil} from './recoil';
import {VARIETY_WEAPONS, type VarietyGunId} from './varietyIds';
import {WEAPON_VARIETY_MODELS, type WeaponVarietyModel} from '../assets/weaponVarietyModels.generated';

/** Real overall lengths (m) of the approved guns (the cook lane scales the models to them; the registry's own length wins). */
export const VARIETY_GUN_LENGTHS: Readonly<Record<VarietyGunId, number>> = {
  hornet: 0.62, longslide: 0.27, stub: 0.7, overwatch: 1.05, coach_gun: 0.95, thresher: 1.0,
};

/**
 * The starter pistol's hip pose (weapons.ts `pistol` view: Grip pivot at hip [0.16, -0.17, -0.36], yaw 0.08 / pitch 0.03 / roll -0.04)
 * with its `Sight` marker in camera space (m), measured on pistol.glb (tests/weapon-variety-guns.test.ts re-measures both).
 */
export const PISTOL_HOLD = {grip: [0.16, -0.17, -0.36], sight: [0.1649, -0.0834, -0.3398]} as const;

/**
 * Each kind's hip rules: the Grip's depth (m ahead of the eye: the pistol hand's), the hip rotation (the baseline long guns' / the
 * pistol's) and the visual kick's push at hip (view.kickTravel). The long guns' kicks were tuned with the Grip ~0.7 m out (the rifle's
 * hold, which they followed): at 0.36 m the same push would look about twice as big, so it is scaled by the depth ratio — the kick looks
 * as before (its muzzle rise is an angle and needs nothing); ADS keeps the full push. The longslide is at the pistol's own depth (1).
 */
export const HOLD_RULES = {
  long: {gripZ: -0.36, yaw: 0.12, pitch: 0.03, roll: -0.05, kickTravel: 0.36 / 0.7},
  handgun: {gripZ: -0.36, yaw: 0.08, pitch: 0.03, roll: -0.04, kickTravel: 1},
} as const;

type Vec3 = [number, number, number];

/** `v` turned by the Viewmodel's hip rotation (three.js Euler order 'XYZ': R = Rx · Ry · Rz). */
function rotXYZ([x, y, z]: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let c = Math.cos(rz), s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ry); s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rx); s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

/**
 * The hip position of a gun's Grip pivot from its cooked model's markers (`m` = its registry entry), else `fallback`: the Grip at its
 * kind's depth (HOLD_RULES.gripZ, the pistol hand's) and the Sight, turned by the kind's hip rotation, on the line from the eye through
 * the pistol's Sight (PISTOL_HOLD) — so every gun's sight shows where the pistol's does, at the pistol's hand distance.
 */
export function anchoredHip(m: WeaponVarietyModel | undefined, kind: 'long' | 'handgun', fallback: Vec3): Vec3 {
  const G = m?.markers.Grip, S = m?.markers.Sight;
  if (!m || !G || !S) return fallback;
  const r = HOLD_RULES[kind], [ax, ay, az] = PISTOL_HOLD.sight;
  const [sx, sy, sz] = rotXYZ([S[0] - G[0], S[1] - G[1], S[2] - G[2]], r.pitch, r.yaw, r.roll);
  const depth = -(r.gripZ + sz); // the Sight's distance ahead of the eye
  return [ax / -az * depth - sx, ay / -az * depth - sy, r.gripZ];
}

/** The view config of a variety gun (model key = its id; length from the registry when delivered). */
function gunView(id: VarietyGunId, kind: 'long' | 'handgun', fallbackHip: Vec3, ads: {sightRelief: number; sightLift: number; aim: Vec3; optic?: WeaponDef['view']['optic']}): WeaponDef['view'] {
  const r = HOLD_RULES[kind];
  return {
    model: id, hip: anchoredHip(WEAPON_VARIETY_MODELS[id], kind, fallbackHip), aim: ads.aim, hipYaw: r.yaw, hipPitch: r.pitch, hipRoll: r.roll,
    length: WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_GUN_LENGTHS[id], sightRelief: ads.sightRelief, sightLift: ads.sightLift,
    ...(ads.optic ? {optic: ads.optic} : {}), ...(r.kickTravel !== 1 ? {kickTravel: r.kickTravel} : {}),
  };
}

const base = (id: VarietyGunId) => ({id, itemId: id, caliber: VARIETY_WEAPONS[id].caliber!});

export const VARIETY_GUN_DEFS: Readonly<Record<VarietyGunId, WeaponDef>> = {
  // G01 HORNET — 9mm compact SMG. AUTO at the fastest cadence (0.07 s, ~860 rpm) with light rounds (13: 186 dps vs the rifle's 240, and
  // 24 % less damage per 9mm round than the pistol, so it EATS ammo); a 30-round magazine. Tight hip cone (better than the rifle) and a
  // small move penalty, but a short effective range (falloff from 12 m to 45 % at 45 m) and a mediocre aimed cone. Recoil CLIMBS over a
  // string (x2.2 by the 10th shot) with sideways jitter, recovering quickly between bursts. Light: the quickest equip, full speed.
  hornet: {
    ...base('hornet'), magazine: 30, auto: true, interval: 0.07,
    damage: 13, pellets: 1, spreadHip: 0.022, spreadAim: 0.009, spreadMove: 0.016,
    range: 45, falloffStart: 12, falloffMin: 0.45, headMult: 2.2, limbMult: 0.7, knockback: 0.12,
    reload: {kind: 'magazine', time: 1.7, emptyTime: 2.05},
    recoil: firingRecoil({pitch: 0.007, yaw: 0.004, kick: 0.022, recover: 11}),
    recoilClimb: {climb: 0.12, cap: 10, jitter: 0.006},
    bloom: {per: 0.0025, max: 0.03, decay: 0.09},
    equipTime: 0.3, aimFov: 60, moveMult: 1.0, noise: 26, sound: 'pistol',
    view: gunView('hornet', 'long', [0.171, -0.243, -0.36], {sightRelief: 0.3, sightLift: 0.012, aim: [0, -0.13, -0.3]}),
  },
  // G02 LONGSLIDE — 9mm long-slide target pistol (one-handed, no stock). SEMI at a deliberate 0.28 s with heavy single shots (27; head
  // x2.6 = a two-headshot zombie where the pistol needs three) from a 10-round magazine. A loose hip cone, but a very tight aimed cone that
  // SETTLES over 0.3 s of steady aim (each shot sets it back); a longer effective range than the pistol, a sharper single kick that
  // recovers fast, a narrower aim FOV (52 vs 58). Lower sustained dps than the pistol (96 vs 106), a slightly slower magazine change.
  longslide: {
    ...base('longslide'), magazine: 10, auto: false, interval: 0.28,
    damage: 27, pellets: 1, spreadHip: 0.03, spreadAim: 0.0025, spreadMove: 0.028,
    range: 80, falloffStart: 35, falloffMin: 0.7, headMult: 2.6, limbMult: 0.7, knockback: 0.22,
    reload: {kind: 'magazine', time: 1.55, emptyTime: 1.85},
    recoil: firingRecoil({pitch: 0.03, yaw: 0.004, kick: 0.05, recover: 13}),
    aimSettle: {time: 0.3, extra: 0.008, shot: 0.6},
    equipTime: 0.4, aimFov: 52, moveMult: 1.0, noise: 26, sound: 'pistol',
    view: gunView('longslide', 'handgun', [0.159, -0.154, -0.36], {sightRelief: 0.33, sightLift: 0.012, aim: [0, -0.1, -0.33]}),
  },
  // G03 STUB — 5.56 bullpup carbine for corridors. AUTO a touch faster than the rifle (0.09 s) at slightly less per round (22: ~244 dps,
  // 8 % less per 5.56 round); a BETTER hip cone and quicker handling (equip 0.42 s, moveMult 0.98) but a WORSE aimed cone (0.008 vs 0.004)
  // through its small red dot, more sideways recoil jitter, a shorter barrel (falloff 30 -> 75 m) and a slow magazine change (2.6 / 3.0 s:
  // the magazine sits behind the grip). ADS looks THROUGH the open red-dot window like the rifle's optic (no magnification: aimFov 56):
  // weapon-stub.glb's `Sight` is the window centre; the hoop's clear opening is >= 13.7 mm from that axis (down; 16.8 up, 18.8 to
  // the sides) and spans 12.8 mm ahead of it to 9.5 mm behind it, so the runtime glass (optic.ts sightAperture, searched only that
  // deep) sits 11.7 mm eye-side of the marker with a 12 mm radius — inside the opening, so its depth mask hides none of the frame —
  // and the eye 0.248 m behind it (the former 0.26 m sight relief). The lens draws the red dot on the aim line; the HUD crosshair hides.
  stub: {
    ...base('stub'), magazine: 30, auto: true, interval: 0.09,
    damage: 22, pellets: 1, spreadHip: 0.02, spreadAim: 0.008, spreadMove: 0.024,
    range: 75, falloffStart: 30, falloffMin: 0.65, headMult: 2.5, limbMult: 0.7, knockback: 0.22,
    reload: {kind: 'magazine', time: 2.6, emptyTime: 3.0},
    recoil: firingRecoil({pitch: 0.011, yaw: 0.009, kick: 0.032, recover: 9}),
    recoilClimb: {climb: 0.04, cap: 8, jitter: 0.008},
    equipTime: 0.42, aimFov: 56, moveMult: 0.98, noise: 30, sound: 'rifle',
    view: gunView('stub', 'long', [0.221, -0.278, -0.36], {sightRelief: 0.26, sightLift: 0, aim: [0, -0.145, -0.26],
      optic: {eyeRelief: 0.248, sightAperture: {radius: 0.012, depth: 0.015}}}),
  },
  // G04 OVERWATCH — 5.56 designated marksman rifle, SCOPED. SEMI at a slow 0.36 s with heavy rounds (46, head x3 = one head shot drops
  // a standard zombie; ~128 dps) from a 12-round magazine. A poor hip cone, a very tight aimed cone after a LONGER settle (0.6 s; a shot
  // sets it back 80 %), the longest range (falloff 70 -> 120 m), a strong kick. A real magnified aim: the main camera narrows to 30 deg
  // and the eye goes to the scope's rear lens (the model's `Sight` marker) where a runtime see-through lens draws the reticle (weapons/
  // optic.ts sightAperture). Heavy: equip 0.75 s, moveMult 0.9. (No bipod / attachment system: the bipod is part of the model only.)
  overwatch: {
    ...base('overwatch'), magazine: 12, auto: false, interval: 0.36,
    damage: 46, pellets: 1, spreadHip: 0.05, spreadAim: 0.0012, spreadMove: 0.035,
    range: 120, falloffStart: 70, falloffMin: 0.8, headMult: 3.0, limbMult: 0.7, knockback: 0.35,
    reload: {kind: 'magazine', time: 2.4, emptyTime: 2.9},
    recoil: firingRecoil({pitch: 0.035, yaw: 0.008, kick: 0.06, recover: 7}),
    aimSettle: {time: 0.6, extra: 0.02, shot: 0.8},
    bloom: {per: 0.006, max: 0.03, decay: 0.05},
    equipTime: 0.75, aimFov: 30, aimLook: 0.65 * 30 / 52, moveMult: 0.9, noise: 34, sound: 'rifle', // aimLook: the scope turns like the rifle's aim on screen
    view: gunView('overwatch', 'long', [0.149, -0.223, -0.36], {sightRelief: 0.09, sightLift: 0, aim: [0, -0.16, -0.09],
      optic: {eyeRelief: 0.085, sightAperture: {radius: 0.016}}}),
  },
  // G05 COACH GUN — 12-gauge side-by-side, a break action. EXACTLY TWO shots (one per barrel) with a fast follow-up between them (0.2 s),
  // each a little heavier than the pump's (10 x 16 = 160 vs 9 x 15 = 135) with a heavier kick and knockback; the short barrels throw
  // a wider cone with a shorter reach (falloff to 26 m). Then the BREAK reload:
  // open + eject 0.55 s, a shell 0.42 s each (two at most; one when only one is in reserve), close 0.35 s — ~1.7 s for both barrels vs
  // the pump's 6 shells one by one. Nothing fires while it is open; a trigger press closes it after the current shell.
  coach_gun: {
    ...base('coach_gun'), magazine: 2, auto: false, interval: 0.2,
    damage: 16, pellets: 10, spreadHip: 0.08, spreadAim: 0.056, spreadMove: 0.02,
    range: 26, falloffStart: 7, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.65,
    reload: {kind: 'break', start: 0.55, eject: 0.4, each: 0.42, end: 0.35},
    recoil: firingRecoil({pitch: 0.075, yaw: 0.02, kick: 0.11, recover: 6}),
    equipTime: 0.55, aimFov: 62, moveMult: 0.93, noise: 40, sound: 'shotgun', shotCycle: 'none',
    view: gunView('coach_gun', 'long', [0.272, -0.204, -0.36], {sightRelief: 0.3, sightLift: 0.02, aim: [0, -0.09, -0.3]}),
  },
  // G06 THRESHER — 12-gauge semi-auto with a box magazine. SEMI with a much faster repeat than the pump (0.45 s vs 0.82 s) from an
  // 8-round MAGAZINE (a magazine change 2.7 / 3.2 s, not shell by shell), but fewer pellets / less per pellet (8 x 14 = 112 vs 135: 17 %
  // less per shell), a wider cone that blooms with fast follow-ups, heavy recoil with a slow recovery, a slightly shorter reach, and the
  // heaviest gun of all (equip 0.8 s, moveMult 0.88).
  thresher: {
    ...base('thresher'), magazine: 8, auto: false, interval: 0.45,
    damage: 14, pellets: 8, spreadHip: 0.08, spreadAim: 0.058, spreadMove: 0.022,
    range: 28, falloffStart: 6, falloffMin: 0.25, headMult: 1.8, limbMult: 0.75, knockback: 0.5,
    reload: {kind: 'magazine', time: 2.7, emptyTime: 3.2},
    recoil: firingRecoil({pitch: 0.07, yaw: 0.025, kick: 0.1, recover: 5}),
    bloom: {per: 0.008, max: 0.024, decay: 0.04},
    equipTime: 0.8, aimFov: 62, moveMult: 0.88, noise: 40, sound: 'shotgun', shotCycle: 'none', reloadCue: 'rifle',
    view: gunView('thresher', 'long', [0.192, -0.255, -0.36], {sightRelief: 0.28, sightLift: 0.015, aim: [0, -0.185, -0.28]}),
  },
};
