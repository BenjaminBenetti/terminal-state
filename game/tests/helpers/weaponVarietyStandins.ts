// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): TEST-ONLY stand-in WeaponDefs for the twelve variety weapons — a
// merge-order shim. The real defs are lanes GUNS / MELEE's (weapons/varietyGuns.ts, varietyMelee.ts); a test mocks those modules as
// `{...standins, ...real}` (vi.mock + importOriginal), so once the real defs are merged every test reads THEM and these numbers never
// matter. The loot tests read capacity / melee / caliber through WEAPONS only (never these literals). Type-only import of weapons.ts (the
// mock factories run while weapons.ts is being loaded: a value import would be a cycle).
import type {WeaponDef} from '../../src/weapons/weapons';
import type {Caliber} from '../../src/items/calibers';

type GunSpec = {caliber: Caliber; magazine: number; auto: boolean; interval: number; damage: number; pellets: number; sound: WeaponDef['sound']; length: number};
const GUNS: Record<string, GunSpec> = {
  hornet: {caliber: '9x19mm', magazine: 30, auto: true, interval: 0.075, damage: 13, pellets: 1, sound: 'pistol', length: 0.62},
  longslide: {caliber: '9x19mm', magazine: 10, auto: false, interval: 0.3, damage: 26, pellets: 1, sound: 'pistol', length: 0.27},
  stub: {caliber: '5.56x45mm', magazine: 30, auto: true, interval: 0.085, damage: 21, pellets: 1, sound: 'rifle', length: 0.7},
  overwatch: {caliber: '5.56x45mm', magazine: 10, auto: false, interval: 0.4, damage: 48, pellets: 1, sound: 'rifle', length: 1.05},
  coach_gun: {caliber: '12ga', magazine: 2, auto: false, interval: 0.22, damage: 17, pellets: 10, sound: 'shotgun', length: 0.95},
  thresher: {caliber: '12ga', magazine: 8, auto: false, interval: 0.32, damage: 13, pellets: 8, sound: 'shotgun', length: 1.0},
};
const MELEE: Record<string, {damage: number; range: number; length: number}> = {
  fire_axe: {damage: 55, range: 1.4, length: 0.9}, machete: {damage: 38, range: 1.3, length: 0.62}, sledgehammer: {damage: 70, range: 1.4, length: 0.92},
  crowbar: {damage: 40, range: 1.25, length: 0.76}, slugger: {damage: 45, range: 1.35, length: 0.84}, track_shovel: {damage: 42, range: 1.6, length: 1.25},
};

const view = (model: string, length: number): WeaponDef['view'] => ({model, hip: [0.2, -0.3, -0.6], aim: [0, -0.1, -0.4], hipYaw: 0.1, hipPitch: 0.03, hipRoll: -0.04, length});

export function gunStandins(): Record<string, WeaponDef> {
  return Object.fromEntries(Object.entries(GUNS).map(([id, g]) => [id, {
    id, itemId: id, caliber: g.caliber, magazine: g.magazine, auto: g.auto, interval: g.interval, damage: g.damage, pellets: g.pellets,
    spreadHip: 0.03, spreadAim: 0.006, spreadMove: 0.03, range: 60, falloffStart: 20, falloffMin: 0.5, headMult: 2, limbMult: 0.7, knockback: 0.2,
    reload: {kind: 'magazine', time: 1.8, emptyTime: 2.2}, recoil: {pitch: 0.02, yaw: 0.006, kick: 0.04, recover: 9},
    equipTime: 0.5, aimFov: 58, moveMult: 0.95, noise: 28, sound: g.sound, view: view(id, g.length),
  } satisfies WeaponDef]));
}

export function meleeStandins(): Record<string, WeaponDef> {
  return Object.fromEntries(Object.entries(MELEE).map(([id, m]) => [id, {
    id, itemId: id, magazine: 0, auto: false, interval: 0.9, damage: m.damage, pellets: 1, spreadHip: 0, spreadAim: 0, spreadMove: 0,
    range: m.range, falloffStart: m.range, falloffMin: 1, headMult: 2, limbMult: 1, knockback: 0,
    reload: {kind: 'magazine', time: 0, emptyTime: 0}, recoil: {pitch: 0, yaw: 0, kick: 0, recover: 8},
    equipTime: 0.4, aimFov: 75, moveMult: 0.97, noise: 6, sound: 'pistol', view: view(id, m.length),
    melee: {windup: 0.2, strike: 0.1, sweep: 0.2, recovery: 0.5, rays: [[0, 0]]},
  } satisfies WeaponDef]));
}
