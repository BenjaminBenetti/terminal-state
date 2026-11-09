// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): the per-shot handling maths of Game.fire / currentSpread /
// the bloom recovery as pure functions, so each gun's recoil, spread and recovery follow its WeaponDef (weapons/varietyGuns.ts) and
// can be tested without a Game. For a def WITHOUT the optional handling fields (the baseline pistol / rifle / shotgun) every result is
// the former inline expression, evaluated in the same order with the same RNG draws — bit-identical behaviour.
import type {WeaponDef} from './weapons';

/** The shared single-projectile bloom (the former inline rule): +0.0035 rad per shot up to 0.03, recovering 0.06 rad/s. */
export const SHARED_BLOOM = {per: 0.0035, max: 0.03, decay: 0.06} as const;

/**
 * One shot's recoil: camera `pitch` / `yaw` kicks (recovering at def.recoil.recover) and the permanent `view` pitch the player
 * keeps (the climb you pull back down). `kickMul` = ADS x stance; `streak` = WeaponController.streak (shots so far in this
 * string). RecoilClimb multiplies the pitch by 1 + climb x min(streak, cap) and adds a second random sideways kick.
 */
export function shotRecoil(def: WeaponDef, kickMul: number, streak: number, rand: () => number): {pitch: number; yaw: number; view: number} {
  const c = def.recoilClimb;
  if (!c) return {pitch: def.recoil.pitch * kickMul, yaw: (rand() - 0.5) * 2 * def.recoil.yaw * kickMul, view: def.recoil.pitch * 0.3 * kickMul};
  const m = 1 + c.climb * Math.min(Math.max(0, streak), c.cap);
  const yaw = (rand() - 0.5) * 2 * def.recoil.yaw * kickMul + (rand() - 0.5) * 2 * c.jitter * kickMul;
  return {pitch: def.recoil.pitch * kickMul * m, yaw, view: def.recoil.pitch * 0.3 * kickMul * m};
}

/** Bloom after one shot of `def` (Bloom, else the shared rule: single-projectile guns only). */
export function shotBloom(def: WeaponDef, bloom: number): number {
  if (def.bloom) return Math.min(def.bloom.max, bloom + def.bloom.per);
  return def.pellets === 1 ? Math.min(SHARED_BLOOM.max, bloom + SHARED_BLOOM.per) : bloom;
}

/** Bloom recovery rate (rad/s) while `def` is held (null: nothing held -> the shared rate). */
export function bloomDecay(def: WeaponDef | null | undefined): number {
  return def?.bloom ? def.bloom.decay : SHARED_BLOOM.decay;
}

/** The base cone before movement / bloom / stance: hip, or aimed + what an AimSettle still adds (`settle`, rad). */
export function baseSpread(def: WeaponDef, aiming: boolean, settle: number): number {
  return aiming ? (def.aimSettle ? def.spreadAim + settle : def.spreadAim) : def.spreadHip;
}

/** Seconds of a reload's sound timing (audio/sfx.ts reloadStart): the def's magazine time (empty / tactical), or undefined. */
export function reloadCueTime(def: WeaponDef, empty: boolean): number | undefined {
  return def.reload.kind === 'magazine' ? (empty ? def.reload.emptyTime : def.reload.time) : undefined;
}
