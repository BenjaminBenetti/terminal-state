// Task studio-bunker-level-20261109-072224-01: THE BUNKER LOOK — the finish mapper of a Bunker layout (the builder's arch chain asks
// BunkerArch exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch / MarketArch on their levels; null on every other level —
// gated on layout.bunker, never layout.reactor). It REUSES the Reactor's architecture materials (world/reactor/archMaterials.ts: the
// Codex pit concrete / rusted steel sets behind the reactor-* surface keys; assets/levelAssets.ts lets the Bunker load the Reactor kit's
// files) so the shelter reads as one civil-defence build, varied by programme — not every room a rusty shed:
//  - the station's platform and track bed keep their Subway finishes; the ARRIVAL HALL and VAULT VESTIBULE are stained cast concrete
//    (the vault face), the guard booth / station office painted block (the builder's back-of-house rule);
//  - corridors, stair lobbies, landings and stair runs of the shelter: cast concrete walls and ceilings, concrete floors;
//  - the MAINTENANCE storey (damp, worked) and every generator / pump / boiler / filtration plant room: rusted steel plate walls over
//    concrete floors;
//  - quarters, mess, wards, offices, stores, the core hall: the builder's painted block + concrete (washrooms keep their tile);
//  - door frames: rusted steel trim on the shelter storeys.
// It also draws the shelter's hero props (the Reactor bunker's REACTOR_X_KIT models: bunk beds, radio consoles, air filtration units,
// the blast door) through world/reactor/bunkerModels.ts — the same instanced build the Reactor's arch uses. The keys are arch-owned for
// bullet impacts (world/finishAt.ts) like the Reactor's.

import {bunkerTowerRecord} from '../gen/bunker/v2/liftPlan'; // task studio-bunker-rework-20261109-205115-01
import {cutOfficeShaftDoors} from './officeProps';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {BuiltFace} from './levelGeometry';
import type {WorldMaterials} from './materials';
import {isReactorKey, reactorSurfaceMaterial, reactorSurfaceScale, type ReactorSurfaceKey} from './reactor/archMaterials';
import {buildBunkerModels, type BunkerModelStats} from './reactor/bunkerModels';

/** What a Bunker area is, for its finishes. */
export type BunkerClass = 'station' | 'vault' | 'circulation' | 'plant' | 'room';

const PLANT = new Set(['generator-room', 'pump-room', 'boiler-room', 'ventilation-plant', 'electrical-room']);

/** The finish class of an area of a Bunker layout (undefined: rock / the track bed). */
export function bunkerAreaClass(layout: StationLayout, a: Area | undefined): BunkerClass {
  if (!a) return 'station';
  const lv = a.level ?? 0;
  if (lv === 0) {
    if (a.kind === 'platform') return 'station';
    if (a.type === 'concourse') return 'vault';
    if (a.type === 'stair-core') return 'circulation';
    return 'room';
  }
  if (a.type === 'stair-core' || a.kind === 'service') return 'circulation';
  // (task studio-bunker-rework-20261109-205115-01: a version-2 shelter's passages are circulation too — cast concrete)
  if (layout.bunker?.version === 2 && a.kind === 'passage') return 'circulation';
  if (lv === 4 && a.kind === 'room' && a.type !== 'washroom') return 'plant';
  if (PLANT.has(a.purpose ?? '')) return 'plant';
  return 'room';
}

export class BunkerArch {
  private readonly cls = new Map<number, BunkerClass>();
  stats: {faces: Record<string, number>; models: BunkerModelStats | null} = {faces: {}, models: null};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): BunkerArch | null {
    return layout.bunker && levels.length ? new BunkerArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {}

  private classOf(id: number): BunkerClass {
    let c = this.cls.get(id);
    if (!c) this.cls.set(id, (c = bunkerAreaClass(this.layout, id >= 0 ? this.layout.areas[id] : undefined)));
    return c;
  }
  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }

  /** Wall finishes: cast concrete (vault side, circulation), rusted plate (plant), the builder's rule elsewhere. */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    // (task studio-bunker-rework-20261109-205115-01: a version-2 Bunker's cargo-lift gates cut out of the shaft's landing faces, as the
    // Office / mall cut their elevator doorways: the open gate is a real aperture, the shut landing doors fill it)
    const rec = bunkerTowerRecord(this.layout);
    if (rec?.elevator) faces = cutOfficeShaftDoors(faces, {office: rec} as unknown as Parameters<typeof cutOfficeShaftDoors>[1]);
    return faces.map(f => {
      const c = this.classOf(f.area);
      const key: ReactorSurfaceKey | null = c === 'vault' || c === 'circulation' ? 'reactor-wall' : c === 'plant' ? 'reactor-room-wall' : null;
      if (!key) return f;
      this.count(key);
      return {...f, finish: key};
    });
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const c = this.classOf(lvl.grid.area[i]);
    return c === 'vault' || c === 'circulation' || c === 'plant' ? 'reactor-floor' : null;
  }

  /** Ceiling key of a run (null: the builder's rule). */
  ceilKey(_L: number, areaId: number): string | null {
    const c = this.classOf(areaId);
    return c === 'vault' || c === 'circulation' || c === 'plant' ? 'reactor-ceil' : null;
  }

  /** Door opening soffit: concrete where either side is (null: the builder's rule). */
  doorCeilKey(_L: number, a: Area | undefined, b: Area | undefined): string | null {
    const ca = a ? this.classOf(a.id) : 'station', cb = b ? this.classOf(b.id) : 'station';
    return ca === 'station' && cb === 'station' ? null : 'reactor-ceil';
  }

  /** Door frame trim: rusted steel on the shelter storeys and the vault side (the station keeps its steel). */
  doorTrimKey(level: number, a: Area | undefined): string | null {
    return level > 0 || (a && this.classOf(a.id) !== 'station') ? 'reactor-trim' : null;
  }

  scale(key: string): {u: number; v: number} | undefined {
    return isReactorKey(key) ? reactorSurfaceScale(this.mats, key) : undefined;
  }
  material(key: string): THREE.Material | undefined {
    return isReactorKey(key) ? reactorSurfaceMaterial(this.mats, key) : undefined;
  }

  /** The shelter's hero props (REACTOR_X_KIT models on their placements; a model not loaded draws nothing, collision stays). */
  build(group: THREE.Group, models: Readonly<Record<string, GLTF | undefined>>): void {
    try { this.stats.models = buildBunkerModels(group, this.layout, models); } catch (e) { console.warn('bunker arch: hero models skipped', e); }
  }
}
