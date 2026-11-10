// Iteration 15 (user: "increase the recoil a little bit basically across the board ... fifty percent recoil to everything"): every gun's
// FIRING recoil amplitudes x1.5, applied ONCE at the definition — camera kick (pitch, yaw) and the viewmodel's visual kick (kick).
// (Task studio-weapon-variety-production-20261109-224355-01: moved verbatim from weapons/weapons.ts into this leaf module so the
// weapon-variety defs can share it without an import cycle; weapons.ts re-exports both.)
import type {WeaponDef} from './weapons';

export const RECOIL_SCALE = 1.5;
export function firingRecoil(base: WeaponDef['recoil']): WeaponDef['recoil'] {
  return {pitch: base.pitch * RECOIL_SCALE, yaw: base.yaw * RECOIL_SCALE, kick: base.kick * RECOIL_SCALE, recover: base.recover};
}
