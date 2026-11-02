// Task reactor-build-20261101 (lane ARCH): THE REACTOR's architecture — the B "Industrial Service Cathedral" look over GEN's layout
// (reference/tasks/reactor-concepts-20261101-203831/concepts/B-service-cathedral-attempt2.png). Installed from world/builder.ts
// exactly like MallArch (`ReactorArch.for(layout, …)`: null for every other level, so the Subway / Office / Mall never reach it):
//  1. SURFACES: the builder asks for the finish of every wall / floor / ceiling / door trim / stair flight; on a Reactor layout the
//     pit walls (any face whose open side is inside the pit outline) are stained pit concrete, the deck / gallery / bridge / stair
//     floors in the pit steel grating with rusted plate under them, the pit roof dark concrete, rooms cut into the rock rusted plate
//     walls + concrete floors. The rim station (level 0 outside the pit, non-'reactor-*' areas) keeps its Subway finishes.
//  2. KIT (build): the industrial steel from layout.reactor (world/reactor/archKit.ts plan -> archMeshes.ts instancing) — deck
//     steel, lattice towers, the gantry crane, organ pipe banks, extraction fans, generators, the vessel, site machines, screen
//     frames, cable runs, tier bands + stencilled labels, wall pilasters, lamps, rusted railings (the collision rails, ownsRail) —
//     with the lead's Meshy models swapped in where loaded (archAssets.ts registry).
//  3. SIGHT: `pitMask` (cells inside the pit outline) is the level culler's ATRIUM mask (world/levelCulling.ts): every tier stays
//     visible through the open pit while closed rooms behind the rock cull.
//  4. VISUALS: `visuals` implements ReactorVisuals (archVisuals.ts); the builder registers it (registerReactorArchVisuals).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {CELL} from '../../gen/grid';
import type {Level, RailRun} from '../../gen/levels';
import type {Area, StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import type {MatKey, WorldMaterials} from '../materials';
import {cellCeil, type BuiltFace} from '../levelGeometry';
import {inPoly, planReactorKit, type KitPlan, type KitStats} from './archKit';
import {buildKitMeshes, kitGeometry, type KitBuildStats, type KitBuilt} from './archMeshes';
import {isReactorKey, reactorDress, reactorSurfaceMaterial, reactorSurfaceScale, type ReactorSurfaceKey} from './archMaterials';
import {REACTOR_MODELS, REACTOR_PIECES, type ReactorPiece} from './archAssets';
import {ReactorArchVisuals} from './archVisuals';
import {WalkVolume, kitWalkRegions} from './pathsAudit'; // task reactor-expansion-20261101 (lane PATHS)
import {applyMountedLenses, isMounted, planMountedLamps, type MountedLampRec} from './gaslightFixtures'; // task reactor-expansion-20261101 (lane GASLIGHT)
import {buildPitSky, type PitSkyStats} from './gaslightSky'; // task reactor-expansion-20261101 (lane GASLIGHT): the open pit top's sky + outside gas
import {buildRoofSlab} from './roofKit'; // task reactor-submit-roof-fog-20261102 (lane ROOF): the roof slab with the opening's hole
import {MeshBasicNodeMaterial} from 'three/webgpu';
// task reactor-expansion-20261101 (lane CORE): the hero reactor (the vessel's hidden grid column, the goop pool, the grating ring /
// bridges; the dynamic goop / coolant / rotors / lamps layer and its staged visuals)
import {CORE_CELL, coreCellKinds, coreHeroOf} from './coreHero';
import {buildCoreLiquids, type CoreBuilt} from './coreLiquids';
import {CoreVisuals, setActiveCoreVisuals} from './coreVisuals';
import {buildMinesVisuals, minesRecord, type MinesBuildStats} from './minesVisuals'; // task reactor-expansion-20261101 (lane MINES): the old mine workings' look
import {buildBunkerModels} from './bunkerModels'; // task reactor-expansion-20261101 (lane BUNKER): the bunker's hero props

export interface ReactorArchStats {
  kit: KitStats | null;
  meshes: KitBuildStats | null;
  /** Pieces drawn from a delivered model. */
  models: ReactorPiece[];
  /** Faces / floors / ceilings remapped to reactor finishes (by key). */
  faces: Record<string, number>;
  pitCells: number;
  /** GEN's light fixtures in the pit drawn as caged lamps (buildLamps). */
  lamps: number;
  ms: number;
  /** task reactor-expansion-20261101 (lane MINES): the old mine workings' visuals (world/reactor/minesVisuals.ts). */
  mines?: MinesBuildStats;
}

/** Areas of the Reactor proper (GEN's 'reactor-*' room types, or any area below the rim). */
export function isReactorArea(a: Area | undefined, level: number): boolean {
  if (!a) return level > 0;
  if (typeof a.type === 'string' && (a.type as string).startsWith('reactor')) return true;
  return (a.level ?? 0) > 0 || level > 0;
}

export class ReactorArch {
  readonly info: ReactorInfo;
  /** Per cell of the level grids: 1 = inside the pit outline (the culler's atrium mask; the pit finishes). */
  readonly pitMask: Uint8Array;
  /** task reactor-expansion-20261101 (lane MINES): areas of the old mine workings (rock walls, caged lamps, timber / rails / models). */
  readonly mineAreas: ReadonlySet<number>;
  private readonly W: number;
  private readonly H: number;
  /** The core floor's level (the last tier). */
  private readonly coreLevel: number;
  plan: KitPlan | null = null;
  built: KitBuilt | null = null;
  /** Task reactor-expansion-20261101 (lane GASLIGHT): the mounted pit lamps planned with the kit (model or cage, lens matrix). */
  mountedLamps: MountedLampRec[] = [];
  /** Task reactor-expansion-20261101 (lane GASLIGHT): the roof opening's sky dome + outside gas (null: no opening). */
  pitSky: PitSkyStats | null = null;
  /** Task reactor-submit-roof-fog-20261102 (lane ROOF): the arch draws the pit's roof slab (one mesh, the opening's hole). */
  readonly roofSlab: boolean;
  visuals: ReactorArchVisuals = new ReactorArchVisuals(null, null, null);
  /** Task reactor-expansion-20261101 (lane CORE): per core-grid cell — vessel (not drawn: the model is), goop pool, grating deck. */
  readonly coreKinds: Uint8Array;
  /** Task reactor-expansion-20261101 (lane CORE): the dynamic hero layer (goop, coolant flow, rotors, status lamps). */
  core: CoreBuilt | null = null;
  readonly stats: ReactorArchStats = {kit: null, meshes: null, models: [], faces: {}, pitCells: 0, lamps: 0, ms: 0};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): ReactorArch | null {
    const r = (layout as {reactor?: ReactorInfo}).reactor;
    return r && levels.length && r.pit?.outline?.length >= 3 ? new ReactorArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    this.info = (layout as {reactor?: ReactorInfo}).reactor!;
    const g0 = levels[0].grid;
    this.W = g0.w; this.H = g0.h;
    this.pitMask = new Uint8Array(this.W * this.H);
    this.mineAreas = new Set(minesRecord(layout)?.areas ?? []); // (lane MINES)
    const b = this.info.pit.bounds, P = this.info.pit.outline;
    for (let cy = Math.max(0, Math.floor(b.z0 / CELL)); cy < Math.min(this.H, Math.ceil(b.z1 / CELL)); cy++) {
      for (let cx = Math.max(0, Math.floor(b.x0 / CELL)); cx < Math.min(this.W, Math.ceil(b.x1 / CELL)); cx++) {
        if (inPoly(P, (cx + 0.5) * CELL, (cy + 0.5) * CELL)) { this.pitMask[cy * this.W + cx] = 1; this.stats.pitCells++; }
      }
    }
    this.roofSlab = this.info.pit.roofY > this.info.pit.rimY + 1.5; // (lane ROOF: roofKit.ts buildRoofSlab's condition)
    const tiers = [...this.info.tiers].sort((p, q) => p.baseY - q.baseY);
    this.coreLevel = tiers[0]?.level ?? -1;
    const cg = levels[this.levelIndex(this.coreLevel)]?.grid; // task reactor-expansion-20261101 (lane CORE)
    this.coreKinds = cg && this.coreLevel > 0 ? coreCellKinds(this.info, cg, CELL) : new Uint8Array(0);
  }

  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }
  private inPit(x: number, z: number): boolean {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H && this.pitMask[cy * this.W + cx] === 1;
  }
  private levelIndex(id: number): number { const i = this.levels.findIndex(l => l.id === id); return i < 0 ? 0 : i; }

  // -------------------------------------------------------------------------------------------------------------------------
  // Surfaces (builder hooks)

  /** Reactor finishes for the builder's wall faces (pit concrete facing the pit; rusted plate in the rooms; the rim station kept). */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    const out: F[] = [];
    for (const f of faces) {
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const mx = alongX ? (f.x0 + f.x1) / 2 : f.x0 + f.nx * CELL / 2, mz = alongX ? f.z0 + f.nz * CELL / 2 : (f.z0 + f.z1) / 2;
      // task reactor-expansion-20261101 (lane CORE): the vessel's grid column is not drawn (the hero model is); the goop pool's walls
      // under the deck (bridge sides, ring / outer edges) are rusted steel plate
      if (f.level === this.coreLevel && this.coreKinds.length) {
        const open = this.coreKind(mx, mz), solid = this.coreKind(alongX ? mx : f.x0 - f.nx * CELL / 2, alongX ? f.z0 - f.nz * CELL / 2 : mz);
        if (open === CORE_CELL.vessel || solid === CORE_CELL.vessel) continue;
        if (open === CORE_CELL.pool && f.y1 <= (this.info.coreFloor?.y ?? -Infinity) + 0.05) { this.count('reactor-deck-under'); out.push({...f, finish: 'reactor-deck-under'}); continue; }
      }
      let key: ReactorSurfaceKey | null = null;
      if (this.inPit(mx, mz)) key = 'reactor-wall';
      else if (isReactorArea(f.area >= 0 ? this.layout.areas[f.area] : undefined, f.level)) key = this.mineAreas.has(f.area) ? 'reactor-wall' : 'reactor-room-wall'; // (lane MINES: the drifts are rock-cut, not plate)
      if (!key) { out.push(f); continue; }
      this.count(key);
      out.push({...f, finish: key});
    }
    return out;
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule — the rim station). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    // task reactor-expansion-20261101 (lane CORE): the vessel column / goop pool floors are not drawn; the ring + bridges are grating
    if (lvl.id === this.coreLevel && this.coreKinds[i]) return this.coreKinds[i] === CORE_CELL.deck ? 'reactor-grating' : this.coreKinds[i] === CORE_CELL.pool ? CORE_GOOP : CORE_HIDDEN;
    if (this.pitMask[i]) return lvl.id === this.coreLevel ? 'reactor-floor' : 'reactor-grating';
    const a = this.layout.areas[lvl.grid.area[i]];
    return isReactorArea(a, lvl.id) ? 'reactor-floor' : null;
  }

  /**
   * Ceiling key of a run (null: builder rule). In the pit: the roof at the top, the deck undersides below. Task reactor-submit-roof-
   * fog-20261102 (lane ROOF): false (none) AT the roof line — the roof slab is one mesh with the opening's round hole (build:
   * roofKit.ts buildRoofSlab), not the builder's per-level / per-chunk runs.
   */
  ceilKey(L: number, areaId: number, i?: number, y?: number): string | false | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    if (i !== undefined && this.pitMask[i]) {
      const top = y ?? cellCeil(lvl.grid, i);
      if (this.roofSlab && Math.abs(top - this.info.pit.roofY) < 0.01) return false; // (lane ROOF)
      return top >= this.info.pit.roofY - 0.6 ? 'reactor-roof' : 'reactor-deck-under';
    }
    return isReactorArea(areaId >= 0 ? this.layout.areas[areaId] : undefined, lvl.id) ? 'reactor-ceil' : null;
  }

  /** Door opening soffit (null: station rule). */
  doorCeilKey(L: number, a: Area | undefined, b: Area | undefined): string | null {
    const id = this.levels[L]?.id ?? 0;
    return isReactorArea(a, id) || isReactorArea(b, id) ? 'reactor-ceil' : null;
  }

  /** Door frame trim (null: the station's steel). */
  doorTrimKey(level: number, a: Area | undefined): string | null {
    return isReactorArea(a, level) ? 'reactor-trim' : null;
  }

  /** Stair flight finishes (traversalBuilder MatKeys) in the pit / below the rim: steel grating treads, rusted plate soffits. */
  stairKey(k: MatKey | string, x: number, z: number, level: number): string {
    if (!this.inPit(x, z) && level <= 0) {
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      const a = cx >= 0 && cy >= 0 && cx < this.W && cy < this.H ? this.layout.areas[this.levels[this.levelIndex(level)].grid.area[cy * this.W + cx]] : undefined;
      if (!isReactorArea(a, level)) return k;
    }
    if (k === 'concrete' || k === 'terrazzo') return 'reactor-grating';
    if (k === 'ceiling' || k === 'ceilingService') return 'reactor-deck-under';
    return k;
  }

  scale(key: string): {u: number; v: number} | undefined {
    if (key === CORE_HIDDEN || key === CORE_GOOP) return {u: 1, v: 1}; // task reactor-expansion-20261101 (lane CORE)
    return isReactorKey(key) ? reactorSurfaceScale(this.mats, key) : undefined;
  }
  material(key: string): THREE.Material | undefined {
    if (key === CORE_HIDDEN || key === CORE_GOOP) return coreHiddenMaterial(); // task reactor-expansion-20261101 (lane CORE)
    return isReactorKey(key) ? reactorSurfaceMaterial(this.mats, key) : undefined;
  }
  meshName(key: string): string | undefined {
    if (key === CORE_HIDDEN || key === CORE_GOOP) return `reactor-arch-${key.slice(8)}`; // task reactor-expansion-20261101 (lane CORE)
    return isReactorKey(key) ? `reactor-arch-${key.slice(8)}` : undefined;
  }

  /** Task reactor-expansion-20261101 (lane CORE): the core-floor cell kind at a world point (0 = none). */
  private coreKind(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return cx >= 0 && cy >= 0 && cx < this.W && cy < this.H ? this.coreKinds[cy * this.W + cx] ?? 0 : 0;
  }

  /** Rail runs ARCH draws (rusted steel, instanced): every railing of the Reactor proper; the rim station's own rails stay. */
  ownsRail(r: RailRun): boolean {
    if (r.kind === 'parapet') return false;
    return r.level > 0 || this.inPit((r.x0 + r.x1) / 2 + r.nx * 0.3, (r.z0 + r.z1) / 2 + r.nz * 0.3) || this.inPit((r.x0 + r.x1) / 2 - r.nx * 0.3, (r.z0 + r.z1) / 2 - r.nz * 0.3);
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // GEN's light fixtures in the pit: caged industrial lamps (the lighting system's tube instance becomes the cage's lens)

  /** A real (non-virtual) layout light inside the pit: drawn as a caged lamp, not a Subway tube fixture (rooms keep tubes). */
  isLamp(l: {x: number; z: number; virtual?: boolean; area?: number}): boolean {
    return !l.virtual && (this.inPit(l.x, l.z) || (l.area !== undefined && this.mineAreas.has(l.area))); // (lane MINES: + the mine's caged lamps)
  }

  /** The tube instance of a pit lamp as its lens: a 0.2 m glowing square under the cage (0.36 m below the light point). */
  lampLensMatrix(m: THREE.Matrix4, fixture: {w: number; h: number; d: number}): THREE.Matrix4 {
    const sx = 0.2 / (fixture.w * 0.82), sz = 0.2 / (fixture.d * 0.42);
    return m.clone().multiply(new THREE.Matrix4().makeTranslation(0, fixture.h + 0.004 - 0.36, 0)).multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
  }

  /** Cages + hangers of the pit lamps (instanced per tier; the light points are the layout's): returns the instance count. */
  buildLamps(group: THREE.Group, lightMats: readonly THREE.Matrix4[], lights: readonly {x: number; y: number; z: number; level?: number; virtual?: boolean}[]): number {
    const byLevel = new Map<number, THREE.Matrix4[][]>();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    lights.forEach((l, i) => {
      if (!this.isLamp(l)) return;
      if (isMounted(l as never)) return; // (lane GASLIGHT) a mounted lamp's bracket / post / cage is planned with the kit (gaslightFixtures.ts)
      lightMats[i].decompose(p, q, s);
      const cage = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - 0.19, p.z), q, new THREE.Vector3(0.26, 0.34, 0.26));
      const hanger = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.22, p.z), q, new THREE.Vector3(0.05, 0.44, 0.05));
      const lv = l.level ?? 0;
      let e = byLevel.get(lv);
      if (!e) byLevel.set(lv, (e = [[], []]));
      e[0].push(cage); e[1].push(hanger);
    });
    if (!byLevel.size) return 0;
    const dress = reactorDress(this.mats);
    const cageGeo = kitGeometry('cage'), rodGeo = kitGeometry('tube');
    let n = 0;
    for (const [lv, [cages, rods]] of byLevel) {
      const above = this.info.tiers.filter(t => t.baseY > (this.info.tiers.find(u => u.level === lv)?.baseY ?? 0)).sort((a, b) => a.baseY - b.baseY)[0]?.level;
      for (const [geo, list, name] of [[cageGeo, cages, 'cage'], [rodGeo, rods, 'hanger']] as const) {
        const im = new THREE.InstancedMesh(geo, dress.steelDark, list.length);
        list.forEach((m, k) => im.setMatrixAt(k, m));
        im.name = `reactor-lamp-${name}-L${lv}`;
        im.userData.levels = above === undefined ? [lv] : [lv, above];
        im.computeBoundingSphere();
        group.add(im);
      }
      n += cages.length;
    }
    this.stats.lamps = n;
    return n;
  }

  // -------------------------------------------------------------------------------------------------------------------------
  // The kit

  /** The industrial kit into `group` (before the warm-up): plan -> instanced meshes; registers nothing (the builder does). */
  build(group: THREE.Group, rails: readonly RailRun[], models: Readonly<Record<string, GLTF | undefined>>): ReactorArchStats {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const loaded = new Set<ReactorPiece>(REACTOR_PIECES.filter(p => REACTOR_MODELS[p].delivered && !!models[REACTOR_MODELS[p].key]));
    try {
      // task reactor-expansion-20261101 (lane GASLIGHT): mounted pit fixtures -> their bodies in the kit (no decorative lamps), lenses = tubes
      const fixtures = this.layout.lights.some(l => isMounted(l));
      // task reactor-expansion-20261101 (lane PATHS): + the walkable body volume — the kit keeps its steel out of every walkway
      this.plan = planReactorKit(this.info, {models: loaded, rails: rails.filter(r => !(r as {hidden?: boolean}).hidden && this.ownsRail(r)), fixtures, walk: new WalkVolume(this.layout, {regions: kitWalkRegions(this.info)})});
      this.mountedLamps = fixtures ? planMountedLamps(this.plan, this.layout.lights, this.mats.fixture) : [];
      const dress = reactorDress(this.mats);
      this.built = buildKitMeshes(group, this.plan, k => dress[k], models);
      if (fixtures) this.stats.lamps = applyMountedLenses(group.getObjectByName('light-tubes') as THREE.InstancedMesh | null ?? null, this.mountedLamps);
      this.visuals = new ReactorArchVisuals(this.built, this.plan, dress.glow as MeshBasicNodeMaterial);
      // task reactor-expansion-20261101 (lane CORE): the hero's dynamic layer + its staged visuals (setRestartState lands there)
      const hero = coreHeroOf(this.plan);
      if (hero) {
        try {
          const cg = this.levels[this.levelIndex(this.coreLevel)]?.grid ?? null;
          this.core = buildCoreLiquids(hero, cg, dress.steelDark, [this.coreLevel, ...this.info.tiers.filter(t => t.level !== this.coreLevel).sort((a, b) => a.baseY - b.baseY).slice(0, 1).map(t => t.level)]);
          group.add(this.core.group);
        } catch (e) { console.warn('reactor arch: core layer skipped', e); this.core = null; }
        this.visuals.core = new CoreVisuals(this.core, hero);
      }
      setActiveCoreVisuals(this.visuals.core);
      this.stats.kit = this.plan.stats;
      this.stats.meshes = this.built.stats;
      this.stats.models = [...this.plan.modelPlacements.keys()].filter(p => !!this.built!.modelSlots.get(p));
    } catch (e) {
      console.warn('reactor arch: kit skipped', e);
    }
    // task reactor-submit-roof-fog-20261102 (lane ROOF): the roof slab — one mesh over the pit, the opening's round hole (ceilKey skips
    // the builder's roof-line runs)
    try {
      const slab = this.roofSlab ? buildRoofSlab(this.info, reactorSurfaceMaterial(this.mats, 'reactor-roof'), reactorSurfaceScale(this.mats, 'reactor-roof'), this.levels.map(l => l.id)) : null;
      if (slab) { group.add(slab); this.count('reactor-roof'); }
    } catch (e) { console.warn('reactor arch: roof slab skipped', e); }
    // (lane GASLIGHT) the toxic sky + the outside gas sheets above the roof line, seen through the opening (lane ROOF: only through it)
    try { this.pitSky = buildPitSky(group, this.info, this.levels.map(l => l.id)); } catch (e) { console.warn('reactor arch: pit sky skipped', e); }
    // task reactor-expansion-20261101 (lane MINES): timber sets, rail line, carts / winch / drill, winze headframe, cribs, rubble, water
    try { if (this.mineAreas.size) this.stats.mines = buildMinesVisuals(group, this.layout, this.mats, models); } catch (e) { console.warn('reactor arch: mines skipped', e); }
    // task reactor-expansion-20261101 (lane BUNKER): the bunker's hero props (REACTOR_X_KIT models on their prop placements)
    try { buildBunkerModels(group, this.layout, models); } catch (e) { console.warn('reactor arch: bunker models skipped', e); }
    this.stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return this.stats;
  }

  /** Teardown (archInstall.ts): the per-build textures (label atlas). Geometries go with the world group; shared materials stay cached. */
  dispose(): void {
    for (const t of this.built?.textures ?? []) t.dispose();
    if (this.built) this.built.textures.length = 0;
    // task reactor-expansion-20261101 (lane CORE): the dynamic layer's per-build materials (geometries go with the world group)
    if (this.core) for (const o of this.core.group.children) { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && m !== reactorDress(this.mats).steelDark) m.dispose(); }
    this.core = null;
    setActiveCoreVisuals(null);
  }

  /** Summary (QA / tests). */
  summary(): {stats: ReactorArchStats; visuals: ReturnType<ReactorArchVisuals['state']>} {
    return {stats: this.stats, visuals: this.visuals.state()};
  }
}

/** Task reactor-expansion-20261101 (lane CORE): the surface key of grid geometry the hero replaces (the vessel column, the pool floor). */
export const CORE_HIDDEN = 'reactor-core-hidden';
/** The goop pool's floor (under the goop mesh): not drawn either; its own key so a bullet into the goop is not a concrete hit. */
export const CORE_GOOP = 'reactor-core-goop';
let hidden: MeshBasicNodeMaterial | null = null;
/** Never drawn (material.visible = false): shared, made once. */
function coreHiddenMaterial(): MeshBasicNodeMaterial {
  if (!hidden) { hidden = new MeshBasicNodeMaterial(); hidden.name = CORE_HIDDEN; hidden.visible = false; }
  return hidden;
}
