// Task studio-weapon-variety-production-20261109-224355-01: the twelve user-approved weapon additions (six guns, two per existing ammo
// type, and six melee weapons). ONE source of truth for their ids, approved asset ids, ammo calibers and the existing weapon opportunity
// family each one shares. The pistol / rifle / shotgun / knife stay exactly as they are; these are ADDITIONS that diversify the identity
// of the EXISTING weapon finds (same find rate, same ammo supply), never new spawn rows.
import type {Caliber} from '../items/calibers';

/** The six new guns (item id = weapon id = model key). */
export const VARIETY_GUN_IDS = ['hornet', 'longslide', 'stub', 'overwatch', 'coach_gun', 'thresher'] as const;
/** The six new melee weapons (item id = weapon id = model key). */
export const VARIETY_MELEE_IDS = ['fire_axe', 'machete', 'sledgehammer', 'crowbar', 'slugger', 'track_shovel'] as const;
export const VARIETY_WEAPON_IDS = [...VARIETY_GUN_IDS, ...VARIETY_MELEE_IDS] as const;
export type VarietyGunId = (typeof VARIETY_GUN_IDS)[number];
export type VarietyMeleeId = (typeof VARIETY_MELEE_IDS)[number];
export type VarietyWeaponId = (typeof VARIETY_WEAPON_IDS)[number];

/** The baseline weapon whose existing find opportunities a family shares (pistol finds -> the 9mm family, and so on). */
export type WeaponFamily = 'pistol' | 'rifle' | 'shotgun' | 'knife';

export interface VarietyWeaponInfo {
  /** The user-approved concept / asset id (weapon-variety board revision 2). */
  asset: string;
  name: string;
  family: WeaponFamily;
  /** Guns: the caliber they chamber (one of the three existing ammo types). Melee: none. */
  caliber?: Caliber;
}

export const VARIETY_WEAPONS: Readonly<Record<VarietyWeaponId, VarietyWeaponInfo>> = {
  hornet: {asset: 'G01', name: 'Hornet', family: 'pistol', caliber: '9x19mm'},
  longslide: {asset: 'G02', name: 'Longslide', family: 'pistol', caliber: '9x19mm'},
  stub: {asset: 'G03', name: 'Stub', family: 'rifle', caliber: '5.56x45mm'},
  overwatch: {asset: 'G04', name: 'Overwatch', family: 'rifle', caliber: '5.56x45mm'},
  coach_gun: {asset: 'G05', name: 'Coach Gun', family: 'shotgun', caliber: '12ga'},
  thresher: {asset: 'G06', name: 'Thresher', family: 'shotgun', caliber: '12ga'},
  fire_axe: {asset: 'M01', name: 'Fire Axe', family: 'knife'},
  machete: {asset: 'M02', name: 'Machete', family: 'knife'},
  sledgehammer: {asset: 'M03', name: 'Sledgehammer', family: 'knife'},
  crowbar: {asset: 'M04', name: 'Crowbar', family: 'knife'},
  slugger: {asset: 'M05', name: 'Slugger', family: 'knife'},
  track_shovel: {asset: 'M06', name: 'Track Shovel', family: 'knife'},
};

export function isVarietyWeapon(id: string | null | undefined): id is VarietyWeaponId {
  return !!id && Object.prototype.hasOwnProperty.call(VARIETY_WEAPONS, id);
}
