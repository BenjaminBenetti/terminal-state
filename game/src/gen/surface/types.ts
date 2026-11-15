/** Surface Run's local expedition plan. Coordinates are metres in the surface section, never campaign intel. */
import type {ZombieSpawn} from '../stationTypes';

export type SurfaceBaseLevel = 'subway' | 'office' | 'mall';
export interface SurfaceRect {x: number; z: number; w: number; d: number}
export interface SurfacePose {x: number; y: number; z: number; yaw: number; level: number}
export interface SurfaceBlock extends SurfaceRect {id: string; col: number; row: number; core: boolean}
export interface SurfaceRoad extends SurfaceRect {id: string; axis: 'x' | 'z'}
export type SurfaceDestinationKind = 'store' | 'shopping-centre' | 'office' | 'depot';
export interface SurfaceDestination extends SurfaceRect {
  id: string;
  label: string;
  kind: SurfaceDestinationKind;
  block: string;
  entrance: {x: number; z: number};
  areaIds: number[];
  /** Ceiling of the real ground-floor rooms. Upper facade dressing starts here. */
  height: number;
  facade: number;
  /** Reported local observation, deliberately no campaign discovery or quest state. */
  intel?: string;
}
export interface SurfaceShell extends SurfaceRect {block: string; height: number; variant: number}
export interface SurfaceDressing {
  kind: 'wreck' | 'bus' | 'barrier' | 'rubble' | 'lamp';
  x: number; z: number; yaw: number; variant: number;
  /** Exact collision footprint / height: runtime dressing must match this box. */
  w: number; d: number; h: number;
}
export interface SurfaceAccess extends SurfacePose {
  kind: 'stairwell' | 'exterior-exit';
  label: string;
  /** Start of the access route, useful for genuine preview navigation. */
  approach?: SurfacePose;
}
export interface SurfaceDepotCargo extends SurfacePose {id: string; kind: 'armor' | 'radar' | 'scanner' | 'sentry'}
export interface SurfaceInfo {
  version: 1;
  seed: number;
  baseLevel: SurfaceBaseLevel;
  bounds: SurfaceRect;
  coreBounds: SurfaceRect;
  blockSize: number;
  blocks: SurfaceBlock[];
  roads: SurfaceRoad[];
  destinations: SurfaceDestination[];
  shells: SurfaceShell[];
  dressing: SurfaceDressing[];
  checkpoint: SurfaceRect & {
    y: number;
    map: {x: number; y: number; z: number};
    return: SurfacePose;
    truck: SurfacePose & {area: number};
  };
  truck: SurfacePose & {area: number};
  depotCargo: SurfaceDepotCargo[];
  /** Runtime-recycled exterior slots. They are never part of the permanent layout.zombies list. */
  exteriorSpawns: ZombieSpawn[];
  /** Only these ordinary zombies contribute permanent kills to surface section memory. */
  interiorSpawnIndices: number[];
}
