// Task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: the Surface Run cargo car's PBR FINISH. User: "lift visuals are
// poor, bad material quality re-texture to make it look good. PBR."
//
//  - The sets (assets/liftCabTextures.generated.ts, tools/asset-pipeline/props/build-lift-cab-textures.mjs): Codex-generated ORIGINAL colour
//    sources — painted steel lining, diamond tread plate, hazard striping, cast shaft concrete, hardwood bumper boards — each with a derived
//    tangent-space normal map and an ORM map (R ambient occlusion, G roughness, B metalness), tiled at their real span (m per repeat) on
//    the kit's face UVs (world/elevator.ts CargoFinish: nothing swims on the moving car), and a placard sheet for its four labels.
//  - The car rides through rock and between storeys where no level light reaches, and while it travels only the car is drawn (the ride's
//    sealed frames): the finish carries THE CAB LAMP's light itself, as before (cargoLitMaterials) but shaped by it — the emissive is the
//    surface's own albedo x warm white x the AO map x the lamp's fall-off over the car (the deck brightest, the walls brighter toward the
//    roof, the roof dim round the lamp) plus the normal map's tilt toward / away from the lamp, so rivets, lap seams, tread lugs and wood
//    grain read lit from above. No scene light, no light-set or exposure change; one emissive graph for every material (values per
//    material: one program per map set).
//  - Loaded once (a section preload of any section with a lift end: before its build, so the warm-up compiles the finished car) and kept
//    for the session like the player train's interior textures (shared files: no level owns them; the car rides between levels). Until
//    every map has arrived the car keeps the earlier lit finish (liftCabFinish() null), and a ride keeps its origin's choice to the end.

import * as THREE from 'three';
import {Fn, materialAO, materialColor, normalWorld, normalWorldGeometry, positionLocal, vec3} from 'three/tsl';
import {assetUrl} from '../../assets/loader';
import {LIFT_CAB_PLACARDS, LIFT_CAB_TEXTURES, type LiftCabTexKey} from '../../assets/liftCabTextures.generated';
import {LIFT_CAR} from '../../gen/surface/accessLift';
import {requestSurfaceAnisotropy, type SurfaceRole} from '../../render/anisotropy';
import type {CargoFinish} from '../elevator';
import {SurfaceNodeMaterial} from '../materials';
import {matRef} from '../surfaceNodes';

/** One material's share of the cab lamp (see LIFT_CAB_LAMP). */
export interface CabLamp {
  /** Emissive gain over the albedo. */
  glow: number;
  /** Walls (vertical faces): the lamp's light at the deck and under the roof (a vertical fall-off over the car's height). */
  wall0: number;
  wall1: number;
  /** Faces turned up (the deck) / down (the roof). */
  floor: number;
  ceil: number;
  /** The normal map's tilt toward the lamp (+ up) x this: relief lit from above. */
  relief: number;
  /** false: no fall-off over the height (the shaft liner: its y is the shaft's, not the car's). */
  inCar: boolean;
}

/**
 * The car's finish: per material its set, tint (x the set's colour map), normal-map strength (the paint's scuffs and chips stay shallow:
 * only rivets and lap seams stand out) and lamp share. Matched in the private lean harness (WebGPU on lavapipe and the WebGL2 fallback:
 * the car alone in the game's renderer and tone mapping, the earlier lit finish beside it).
 */
export const LIFT_CAB_LAMP = {
  /** The lamp's warm white (the kit's cab light colour). */
  warm: [1, 0.93, 0.82] as const,
  mats: {
    wall: {set: 'wall', color: 0xffffff, normal: 0.4, lamp: {glow: 1.9, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.45, relief: 0.5, inCar: true}},
    ceil: {set: 'wall', color: 0xc4c8be, normal: 0.4, lamp: {glow: 1.9, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.62, relief: 0.5, inCar: true}},
    deck: {set: 'deck', color: 0xffffff, normal: 1, lamp: {glow: 1.5, wall0: 0.6, wall1: 1, floor: 1, ceil: 0.45, relief: 2.2, inCar: true}},
    hazard: {set: 'hazard', color: 0xffffff, normal: 1, lamp: {glow: 0.85, wall0: 0.6, wall1: 1, floor: 1, ceil: 0.45, relief: 1.2, inCar: true}},
    bars: {set: 'wall', color: 0x868c84, normal: 0.4, lamp: {glow: 2, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.45, relief: 0, inCar: true}},
    door: {set: 'wall', color: 0xd4d8ce, normal: 0.4, lamp: {glow: 1.4, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.45, relief: 0.5, inCar: true}},
    liner: {set: 'liner', color: 0xffffff, normal: 1, lamp: {glow: 0.55, wall0: 1, wall1: 1, floor: 1, ceil: 0.6, relief: 1.2, inCar: false}},
    bumper: {set: 'bumper', color: 0xffffff, normal: 0.7, lamp: {glow: 1.9, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.45, relief: 1, inCar: true}},
  } satisfies Record<Exclude<keyof CargoFinish['mats'], 'placard'>, {set: LiftCabTexKey; color: number; normal: number; lamp: CabLamp}>,
  placard: {glow: 1.3, wall0: 0.6, wall1: 1, floor: 1.1, ceil: 0.45, relief: 0, inCar: true} satisfies CabLamp,
  /** A section with a lift waits at most this long (ms) for the maps before it builds (then the earlier finish). */
  waitMs: 8000,
} as const;

/** A finish material: the lamp's values as properties (read per draw: one program for every material with the same maps). */
export class LiftCabMaterial extends SurfaceNodeMaterial {
  /** (glow, wall at the deck, wall under the roof, up-facing). */
  readonly lampA = new THREE.Vector4();
  /** (down-facing, relief, 1 / the car's height — 0: no fall-off, unused). */
  readonly lampB = new THREE.Vector4();
}

const lampA = matRef('lampA', 'vec4'), lampB = matRef('lampB', 'vec4');
/** The cab lamp's light on a finish surface (module singleton: every finish material shares the graph). */
const LAMP_EMISSIVE = Fn(() => {
  const ny = normalWorld.y, h = positionLocal.y.mul(lampB.z).clamp(0, 1);
  const wall = lampA.y.add(lampA.z.sub(lampA.y).mul(h));
  const shape = wall.add(lampA.w.sub(wall).mul(ny.max(0))).add(lampB.x.sub(wall).mul(ny.negate().max(0)))
    .add(ny.sub(normalWorldGeometry.y).mul(lampB.y)).max(0);
  return materialColor.rgb.mul(vec3(...LIFT_CAB_LAMP.warm)).mul(lampA.x).mul(materialAO).mul(shape);
})();

type SetMaps = {color: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture};
let maps: {sets: Record<LiftCabTexKey, SetMaps>; placards: THREE.Texture} | null = null;
let loading: Promise<boolean> | null = null;
let finish: CargoFinish | null = null;

const ROLE: Record<LiftCabTexKey, SurfaceRole> = {wall: 'wall', deck: 'floor', hazard: 'floor', liner: 'wall', bumper: 'wall'};

/** Fetches every map once (never rejects): true when all arrived (the finish is available), false when one failed (the earlier finish). */
export function loadLiftCabTextures(): Promise<boolean> {
  loading ??= (async () => {
    const one = async (url: string, srgb: boolean, repeat: boolean, role: SurfaceRole): Promise<THREE.Texture | null> => {
      try {
        const t = await new THREE.TextureLoader().loadAsync(assetUrl(url));
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.anisotropy = 4;
        requestSurfaceAnisotropy(t, role);
        t.name = url.split('/').pop() ?? url;
        return t;
      } catch (err) {
        console.warn(`cargo lift: cab texture ${url} failed`, err);
        return null;
      }
    };
    const keys = Object.keys(LIFT_CAB_TEXTURES) as LiftCabTexKey[];
    const [sets, placards] = await Promise.all([
      Promise.all(keys.map(async k => {
        const s = LIFT_CAB_TEXTURES[k];
        const [color, normal, orm] = await Promise.all([one(s.color.url, true, true, ROLE[k]), one(s.normal.url, false, true, ROLE[k]), one(s.orm.url, false, true, ROLE[k])]);
        return color && normal && orm ? [k, {color, normal, orm}] as const : null;
      })),
      one(LIFT_CAB_PLACARDS.color.url, true, false, 'wall'),
    ]);
    if (!placards || sets.some(s => !s)) return false;
    maps = {sets: Object.fromEntries(sets as (readonly [LiftCabTexKey, SetMaps])[]) as Record<LiftCabTexKey, SetMaps>, placards};
    return true;
  })();
  return loading;
}

function lampOn(m: LiftCabMaterial, l: CabLamp): LiftCabMaterial {
  m.lampA.set(l.glow, l.wall0, l.wall1, l.floor);
  m.lampB.set(l.ceil, l.relief, l.inCar ? 1 / LIFT_CAR.cabH : 0, 0);
  m.emissiveNode = LAMP_EMISSIVE;
  return m;
}

/** The finish (module singletons, never disposed) once every map arrived; null before (the car keeps world/elevator.ts cargoLitMaterials). */
export function liftCabFinish(): CargoFinish | null {
  if (finish || !maps) return finish;
  const M = maps, mats = {} as Record<keyof CargoFinish['mats'], THREE.Material>;
  for (const [name, d] of Object.entries(LIFT_CAB_LAMP.mats) as [Exclude<keyof CargoFinish['mats'], 'placard'>, (typeof LIFT_CAB_LAMP.mats)[keyof typeof LIFT_CAB_LAMP.mats]][]) {
    const s = M.sets[d.set];
    const m = new LiftCabMaterial({map: s.color, normalMap: s.normal, roughnessMap: s.orm, metalnessMap: s.orm, aoMap: s.orm, roughness: 1, metalness: 1, color: d.color,
      normalScale: new THREE.Vector2(d.normal, d.normal)});
    m.name = `cargo-cab-${name}@pbr`;
    mats[name] = lampOn(m, d.lamp);
  }
  const p = new LiftCabMaterial({map: M.placards, roughness: 0.55, metalness: 0});
  p.name = 'cargo-cab-placard@pbr';
  mats.placard = lampOn(p, LIFT_CAB_LAMP.placard);
  const T = LIFT_CAB_TEXTURES;
  finish = {mats, spans: {wall: T.wall.span[0], deck: T.deck.span[0], hazard: T.hazard.span[0], liner: T.liner.span[0], bumper: T.bumper.span[0]}, placards: LIFT_CAB_PLACARDS.labels};
  return finish;
}

/** (QA / tests) the maps arrived. */
export const liftCabTexturesReady = (): boolean => maps !== null;
