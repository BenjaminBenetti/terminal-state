/** Surface Run's real grid architecture: local ruins, shops and offices, independent of the Subway finish rules. */
import * as THREE from 'three';
import {CELL, FLOOR} from '../../gen/grid';
import type {Level} from '../../gen/levels';
import type {Area, StationLayout} from '../../gen/stationTypes';
import type {SurfaceDestination} from '../../gen/surface/types';
import {applyDecay, DECAY_PROFILES} from '../decay';
import type {BuiltFace} from '../levelGeometry';
import {finishRoughness, surfaceMaterial, type WorldMaterials} from '../materials';
import {ceilingMaterial, floorMaterial, LOWER, officeStyle, preloadOfficeArch, wallMaterial, WET_WALL, type CeilingKind, type FloorKind} from '../officeArch';
import {tagReflect} from '../../render/reflectTag';

const PALETTES = [
  {wall: 0xc0bbae, accent: 0x627367, floor: 0x59645e, trim: 0x3c443e, sign: 0xe4dfcd},
  {wall: 0xc6b9a4, accent: 0x796a56, floor: 0x65584c, trim: 0x4e4338, sign: 0xe3d7c0},
  {wall: 0xb5bfba, accent: 0x5b6c77, floor: 0x525b65, trim: 0x373f46, sign: 0xdde2df},
  {wall: 0xbab6bd, accent: 0x765f68, floor: 0x63585c, trim: 0x42383e, sign: 0xe1d8d9},
] as const;
const MASONRY = [0x88877a, 0x846953, 0x68716a, 0x6d6564] as const;
type WallKind = 'masonry' | 'concrete' | 'paint' | 'plaster' | 'wet' | 'wood';
type SurfaceFloor = 'asphalt' | 'concrete' | 'carpet' | 'vinyl' | 'tile' | 'stone' | 'wood' | 'server';
interface Look {wall: WallKind; floor: SurfaceFloor; ceil: CeilingKind; palette: number}
const caches = new WeakMap<WorldMaterials, Map<string, THREE.Material>>();

/** The same reviewed Office textures, fetched only while preparing a real surface section. */
export async function preloadSurfaceArch(layout: StationLayout): Promise<void> {
  if (layout.surface) await preloadOfficeArch();
}

/** A ceiling omitted by the actual sky mask, also recorded as open in DrawnSurfaces for the enhanced bake. */
export interface SurfaceOpenCeilingRect {level: number; x0: number; z0: number; x1: number; z1: number; y: number}

export class SurfaceArch {
  private readonly destinations = new Map<number, SurfaceDestination>();
  private readonly looks = new Map<number, Look>();
  private readonly roads: Uint8Array;
  readonly stats = {faces: {} as Record<string, number>};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): SurfaceArch | null {
    return layout.surface && levels.length ? new SurfaceArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    for (const destination of layout.surface!.destinations) for (const id of destination.areaIds) this.destinations.set(id, destination);
    const g = levels[0].grid;
    this.roads = new Uint8Array(g.cells.length);
    for (const r of layout.surface!.roads) {
      const x0 = Math.max(0, Math.floor(r.x / CELL)), x1 = Math.min(g.w, Math.ceil((r.x + r.w) / CELL));
      const z0 = Math.max(0, Math.floor(r.z / CELL)), z1 = Math.min(g.h, Math.ceil((r.z + r.d) / CELL));
      for (let z = z0; z < z1; z++) this.roads.fill(1, z * g.w + x0, z * g.w + x1);
    }
  }

  private look(id: number): Look {
    const cached = this.looks.get(id); if (cached) return cached;
    const area = this.layout.areas[id], destination = this.destinations.get(id), purpose = area?.purpose ?? '';
    const palette = (destination?.facade ?? 0) % PALETTES.length;
    let look: Look;
    if (!area || id === 0) look = {wall: 'masonry', floor: 'concrete', ceil: 'raw', palette};
    else if (area.type === 'exit-stair' || purpose === 'workshop') look = {wall: 'concrete', floor: 'concrete', ceil: 'raw', palette};
    else if (purpose === 'stock-room' || purpose === 'keys') look = {wall: 'paint', floor: 'concrete', ceil: 'raw', palette};
    else if (purpose === 'office-server') look = {wall: 'plaster', floor: 'server', ceil: 'grid', palette};
    else if (purpose === 'office-break') look = {wall: 'wet', floor: 'tile', ceil: 'plain', palette};
    else if (purpose.startsWith('office-')) look = {wall: 'plaster', floor: 'carpet', ceil: 'grid', palette};
    else if (purpose === 'pharmacy') look = {wall: 'wet', floor: 'vinyl', ceil: 'grid', palette};
    else if (purpose === 'coffee') look = {wall: 'wood', floor: 'wood', ceil: 'plain', palette};
    else if (destination?.kind === 'shopping-centre' && purpose === 'service-corridor') look = {wall: 'plaster', floor: 'stone', ceil: 'plain', palette};
    else look = {wall: 'plaster', floor: purpose === 'tech' || purpose === 'phone' ? 'vinyl' : 'tile', ceil: 'grid', palette};
    this.looks.set(id, look); return look;
  }

  /** Every structural face gets a Surface finish, including both sides of the old station's split lower/upper faces. */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    return faces.map(face => {
      const look = this.look(face.area);
      let palette = look.palette;
      if (face.area === 0) {
        const x = (face.x0 + face.x1) / 2, z = (face.z0 + face.z1) / 2;
        const destination = this.layout.surface!.destinations.find(d => x >= d.x - CELL && x <= d.x + d.w + CELL && z >= d.z - CELL && z <= d.z + d.d + CELL);
        palette = (destination?.facade ?? 0) % PALETTES.length;
      }
      const finish = `surface-wall-${look.wall}@${palette}`;
      this.stats.faces[finish] = (this.stats.faces[finish] ?? 0) + 1;
      return {...face, finish};
    });
  }

  floorKey(L: number, i: number): string | null {
    const level = this.levels[L]; if (!level || level.grid.cells[i] !== FLOOR) return null;
    const area = level.grid.area[i], look = this.look(area);
    return area === 0 ? (this.roads[i] ? 'surface-floor-asphalt' : 'surface-floor-concrete') : `surface-floor-${look.floor}@${look.palette}`;
  }

  ceilKey(L: number, areaId: number, i?: number): string | false | null {
    const level = this.levels[L]; if (!level) return null;
    if (i !== undefined ? this.openSky(L, i) : areaId === 0) return false;
    return `surface-ceil-${this.look(areaId).ceil}`;
  }

  doorCeilKey(_L: number, a: Area | undefined, b: Area | undefined): string {
    const inside = b && b.id !== 0 ? b : a;
    return `surface-ceil-${this.look(inside?.id ?? 0).ceil}`;
  }

  doorTrimKey(): string { return 'surface-trim-steel'; }

  private openSky(L: number, i: number): boolean {
    const level = this.levels[L], sky = level?.sky;
    return !!sky && level.grid.cells[i] === FLOOR && (!sky.open || sky.open[i] === 1) && level.grid.ceil[i] >= sky.ceil - 0.01;
  }

  /** Row runs match ceilingRuns' sky omission; no ceiling mesh or reflected ceiling albedo is invented above the streets. */
  openCeilingRects(): SurfaceOpenCeilingRect[] {
    const out: SurfaceOpenCeilingRect[] = [];
    for (let L = 0; L < this.levels.length; L++) {
      const level = this.levels[L], g = level.grid;
      for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w;) {
        const i = z * g.w + x;
        if (!this.openSky(L, i)) { x++; continue; }
        let end = x + 1;
        while (end < g.w && this.openSky(L, z * g.w + end)) end++;
        out.push({level: level.id, x0: x * CELL, z0: z * CELL, x1: end * CELL, z1: (z + 1) * CELL, y: g.ceil[i]});
        x = end;
      }
    }
    return out;
  }

  scale(key: string): {u: number; v: number} | undefined { return key.startsWith('surface-') ? {u: 1, v: 1} : undefined; }

  material(key: string): THREE.Material | undefined {
    if (!key.startsWith('surface-')) return undefined;
    let cache = caches.get(this.mats); if (!cache) caches.set(this.mats, (cache = new Map()));
    const previous = cache.get(key); if (previous) return previous;
    const match = /^surface-(wall|floor|ceil)-([a-z]+)(?:@([0-3]))?$/.exec(key);
    const palette = Number(match?.[3] ?? 0), colors = PALETTES[palette];
    let material: THREE.Material | undefined;
    if (key === 'surface-trim-steel') {
      const trim = surfaceMaterial('paintedSteel', {color: 0x4a5048, metalness: 0.4}, {grime: [0.25, 0.5], macro: 0.15});
      trim.roughness = finishRoughness(trim, 0.85); material = tagReflect(trim, 'metal');
    } else if (match?.[1] === 'wall') {
      const kind = match[2] as WallKind;
      if (kind === 'plaster' || kind === 'wet' || kind === 'wood') {
        const style = officeStyle(colors, kind === 'wood' ? 'warm-wood' : 'corporate');
        const spec = kind === 'wet' ? {...WET_WALL, paint: colors.wall, lowerTop: 1.3} : kind === 'wood' ? style.wall : {...style.wall, kind: LOWER.none, lowerTop: 0, rail: 0, skirt: 0.1};
        material = wallMaterial(this.mats, key, spec);
      } else if (kind === 'masonry' || kind === 'concrete' || kind === 'paint') {
        const map = (this.mats.get(kind === 'concrete' ? 'concrete' : 'paint') as THREE.MeshStandardMaterial).map;
        const wall = surfaceMaterial('paintedPanel', {map, color: kind === 'masonry' ? MASONRY[palette] : kind === 'paint' ? colors.wall : 0x959488}, {grime: [0.4, 1.0], macro: 0.2, normal: 0.5});
        wall.roughness = finishRoughness(wall, 0.95); applyDecay(wall, kind === 'paint' ? DECAY_PROFILES.paint : DECAY_PROFILES.tunnel); material = wall;
      }
    } else if (match?.[1] === 'floor') {
      const kind = match[2] as SurfaceFloor;
      if (kind === 'asphalt' || kind === 'concrete') {
        const map = (this.mats.get('concrete') as THREE.MeshStandardMaterial).map;
        const floor = surfaceMaterial('paintedPanel', {map, color: kind === 'asphalt' ? 0x444d46 : 0xa19d8e}, {macro: 0.18, normal: 0.6});
        floor.roughness = finishRoughness(floor, 0.97); applyDecay(floor, DECAY_PROFILES.concrete); material = floor;
      } else if (['carpet', 'vinyl', 'tile', 'stone', 'wood', 'server'].includes(kind)) {
        const tint = kind === 'carpet' ? colors.floor : kind === 'vinyl' ? 0xb9bcb1 : kind === 'tile' ? [0xa59c85, 0xb2a48e, 0x96a49d, 0xa49a9c][palette] : undefined;
        material = floorMaterial(this.mats, key, kind as FloorKind, tint);
      }
    } else if (match?.[1] === 'ceil' && ['grid', 'plain', 'raw'].includes(match[2])) material = ceilingMaterial(this.mats, key, match[2] as CeilingKind);
    if (material) { material.name = key; cache.set(key, material); }
    return material;
  }
}
