// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE CHECKPOINT'S PLANNING MAP — runtime (the model is
// world/surface/mapModel.ts, the drawing mapDraw.ts, the overlay mapView.ts, the exploration record mapExplore.ts). Installed once by
// world/surface/life.ts; INERT on every layout without `layout.surface`.
//  - sectionHooks.build (before the warm-up): the district's exploration record from its memory lane ('surface.life'), the map table
//    (mapTablePlacement: surface.checkpoint.mapTable.prop when it indexes lane KIT's srMapTable, else the srMapTable nearest the read pose,
//    else a reading box at the read pose), and the table-top copy
//    of the map as a RUNTIME CANVAS TEXTURE on a thin sheet laid on the table's top (dynamic content: the texture rule allows it);
//  - frameHooks (play only): exploration — the cells around the player (EXPLORE.revealM outdoors, interiorRevealM inside a building) and
//    the buildings entered, written to the lane on change (the record is current at any save); the aim at the table (prompt); the
//    table-top redraw (only near the table, at most every TABLE.redrawS, and only when what it shows changed);
//  - E at the table (aimed, within reach, not seated in the truck): the full-screen planning map (the game holds in the 'map' state —
//    nothing updates, spawns or moves behind it; Esc / E / Tab close and play resumes);
//  - sectionHooks.teardown: the record written, the table's GPU resources released, the overlay closed.
// Reports from other lanes: surfaceMapSources(game) (a registry like world/surface/crossing.ts) — AIR's live openings, CARGO's units at the
// depot / on the truck (world/surface/mapSources.ts, registered by life.ts) — each a MapReportInput at a real place (mapModel.ts drops one
// that stands on nothing).

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {PropPlacement} from '../../gen/props';
import {sectionId, type SectionKey} from '../../levels/types';
import type {SBox, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {EXPLORE, SURFACE_LIFE_LANE, markDisc, readLifeRecord, writeLifeRecord, type ExploreGrid} from './mapExplore';
import {buildPlanningMap, mapSignature, rectExplored, vehiclePoseOf, type BuildingStats, type MapReportInput, type PlanningMap} from './mapModel';
import {drawPlanningCanvas, type MapCtx} from './mapDraw';
import {PlanningMapView} from './mapView';

/** What the player knows of the district now (a source reports a building's interior state only once it is known). */
export interface MapReportContext {
  /** The building was entered, or any part of its footprint explored. */
  known(building: number): boolean;
  readonly entered: ReadonlySet<number>;
}

/**
 * A lane's live map reports (registered at install). `reports` returns null while the lane has no live state here (its defaults stay);
 * while live, its `keys` replace those default report families even when it reports nothing (world/surface/mapSources.ts: CARGO, AIR).
 */
export interface SurfaceMapReportSource {
  readonly name: string;
  readonly keys?: readonly string[];
  reports(surface: SurfaceInfo, ctx: MapReportContext): readonly MapReportInput[] | null;
}

const sourceRegistry = new WeakMap<object, SurfaceMapReportSource[]>();
/** The planning map's report sources of `game` (register at install, in order). */
export function surfaceMapSources(game: object): SurfaceMapReportSource[] {
  let list = sourceRegistry.get(game);
  if (!list) sourceRegistry.set(game, (list = []));
  return list;
}

/** Tuning (one place). */
export const TABLE = {
  /** Eye-to-table reach for [E] (m) and the aim box's padding (m). */
  reach: 2.6,
  pad: 0.12,
  /** A map table this near the read pose (m) is THE table when checkpoint.mapTable.prop does not index one. */
  findM: 4,
  /** The table-top canvas (px, square), its redraw cadence (s) and the distance it redraws within (m). */
  px: 1024,
  redrawS: 1.5,
  nearM: 14,
  /** Exploration sampling (s). */
  exploreS: 0.2,
} as const;

export const MAP_TEXT = {prompt: '<b>[E]</b> Read the planning map'} as const;

const runtimes = new WeakMap<object, SurfaceMapRuntime>();
/** The planning-map runtime installed into a game (QA / tests). */
export const surfaceMapOf = (game: object): SurfaceMapRuntime | undefined => runtimes.get(game);

/** The map table's prop kind (lane KIT, gen/surface/kinds.ts). */
export const MAP_TABLE_KIND = 'srMapTable';

/**
 * The checkpoint's map-table placement: `checkpoint.mapTable.prop` when that index IS a map table; else the map table nearest the read
 * pose (within TABLE.findM: a stale / not yet re-pointed index); else null (the runtime falls back to a reading box at the read pose).
 */
export function mapTablePlacement(layout: Pick<StationLayout, 'props'>, s: SurfaceInfo): PropPlacement | null {
  const mt = s.checkpoint.mapTable;
  const byIndex = mt.prop >= 0 ? layout.props[mt.prop] : undefined;
  if (byIndex && byIndex.kind === MAP_TABLE_KIND) return byIndex;
  const r = mt.read;
  let best: PropPlacement | null = null, bestD: number = TABLE.findM;
  for (const p of layout.props) {
    if (p.kind !== MAP_TABLE_KIND) continue;
    const d = Math.hypot(p.x - r.x, p.z - r.z);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Ray (o, unit d) vs box: the entry distance, or null. */
export function rayBox(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, b: SBox): number | null {
  let t0 = 0, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]] as const) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

const sameKey = (a: SectionKey, b: SectionKey): boolean => sectionId(a) === sectionId(b) && a.level === b.level;

interface TableView { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.Material; sig: string; t: number }

export class SurfaceMapRuntime {
  surface: SurfaceInfo | null = null;
  layout: StationLayout | null = null;
  key: SectionKey | null = null;
  grid: ExploreGrid | null = null;
  readonly entered = new Set<number>();
  /** The table's aim / trigger box (null: none). */
  box: SBox | null = null;
  aimed = false;
  prompt: string | null = null;
  view: PlanningMapView | null = null;
  table: TableView | null = null;
  private areaBuilding = new Map<number, number>();
  private outdoorAreas = new Set<number>();
  /**
   * (task studio-surface-tent-first-staging-20261120-225458-01) STAGED: the district is not built yet — the player reads this map in the
   * staged command tent (world/surface/tentShell.ts) while it is. Its record, key and table are the district's own (stage()); exploration
   * uses the district's collision levels given there; the building figures come from the district's memory (stagedStats). The district's
   * build (build(), the same layout) adopts it all: an open view stays open, the table stays where it lies.
   */
  staged = false;
  private stagedLevels: {areaAt?(x: number, z: number, y?: number): number} | null = null;
  private exploreT = 0;
  private dirty = false;
  readonly counts = {builds: 0, opens: 0, writes: 0, tableDraws: 0, restored: 0, staged: 0, adopted: 0};

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    runtimes.set(g, this);
    g.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    g.frameHooks.push(dt => this.frame(dt));
    g.interactHandlers.push(() => this.interact());
    g.promptProviders.push(() => this.prompt);
    g.stateListeners.push(s => { if (s !== 'map' && this.view?.isOpen) this.view.close(); }); // (a screen change behind it: error / loading)
    return this;
  }

  build(layout: StationLayout): void {
    if (this.staged && this.layout === layout && layout.surface && this.key && sameKey(this.key, this.game.run.current)) {
      // (task studio-surface-tent-first-staging-20261120-225458-01) the staged map's district, built: adopted as it stands (its record already
      // read and kept current, the view left open, the table where it lies — redrawn with the district's live figures)
      this.staged = false;
      this.stagedLevels = null;
      this.counts.builds++;
      this.counts.adopted++;
      this.explore();
      this.drawTable(true);
      return;
    }
    this.teardown();
    const s = layout.surface;
    if (!s) return;
    const g = this.game;
    this.counts.builds++;
    this.surface = s;
    this.layout = layout;
    this.key = {...g.run.current};
    const rec = readLifeRecord(g.run.laneStore(SURFACE_LIFE_LANE, this.key), s.extent, s.buildings.length);
    this.grid = rec.grid;
    for (const b of rec.entered) this.entered.add(b);
    if (rec.restored) this.counts.restored++;
    for (const b of s.buildings) for (const a of b.areas) this.areaBuilding.set(a, b.id);
    for (const a of s.outdoorAreas) this.outdoorAreas.add(a);
    this.box = this.tableBox(layout, s);
    this.exploreT = 0;
    this.explore(); // the arrival point is explored at once
    this.buildTable(layout, s);
  }

  /**
   * (task studio-surface-tent-first-staging-20261120-225458-01) The map of `layout`'s district (section `key`, not built yet: run.current is
   * still the section left) for the staged command tent: its record from the district's memory, its table box and table-top copy, the
   * arrival explored on `levels` (the district's collision levels). build() of the same layout adopts it.
   */
  stage(layout: StationLayout, key: SectionKey, levels: {areaAt?(x: number, z: number, y?: number): number}): boolean {
    this.teardown();
    const s = layout.surface;
    if (!s) return false;
    const g = this.game;
    this.counts.staged++;
    this.staged = true;
    this.stagedLevels = levels;
    this.surface = s;
    this.layout = layout;
    this.key = {...key};
    const rec = readLifeRecord(g.run.laneStore(SURFACE_LIFE_LANE, this.key), s.extent, s.buildings.length);
    this.grid = rec.grid;
    for (const b of rec.entered) this.entered.add(b);
    if (rec.restored) this.counts.restored++;
    for (const b of s.buildings) for (const a of b.areas) this.areaBuilding.set(a, b.id);
    for (const a of s.outdoorAreas) this.outdoorAreas.add(a);
    this.box = this.tableBox(layout, s);
    this.exploreT = 0;
    this.explore();
    this.buildTable(layout, s);
    return true;
  }

  /**
   * The staged tent's frame (no frame hook runs while the district is built): exploration, the aim at the table, the table-top copy — staged,
   * and adopted (the district built, its tent's first view still being prepared behind the staged one).
   */
  stagedFrame(dt: number): void {
    if (!this.surface) return;
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = TABLE.exploreS; this.explore(); }
    this.aimed = this.aimAt();
    this.prompt = this.aimed ? MAP_TEXT.prompt : null;
    this.redrawTable(dt);
  }

  /** [E] in the staged tent: the planning map opens when the table is aimed at (true). */
  stagedInteract(): boolean {
    return !!this.surface && this.interact();
  }

  /** The table-top sheet (the staged tent draws it with its own). */
  get tableMesh(): THREE.Mesh | null { return this.table?.mesh ?? null; }

  teardown(): void {
    if (this.surface) this.flush();
    this.staged = false;
    this.stagedLevels = null;
    this.view?.close();
    this.disposeTable();
    this.surface = this.layout = null;
    this.key = null;
    this.grid = null;
    this.entered.clear();
    this.areaBuilding.clear();
    this.outdoorAreas.clear();
    this.box = null;
    this.aimed = false;
    this.prompt = null;
  }

  /** The map table's [E] box: its placement's AABB (mapTablePlacement), else a reading surface in front of the read pose. */
  tableBox(layout: StationLayout, s: SurfaceInfo): SBox | null {
    const mt = s.checkpoint.mapTable, p = mapTablePlacement(layout, s);
    if (p) return {x0: p.x - p.hx, z0: p.z - p.hz, x1: p.x + p.hx, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h};
    const r = mt.read;
    if (!r) return null;
    const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw), cx = r.x + fx * 0.8, cz = r.z + fz * 0.8;
    return {x0: cx - 0.6, z0: cz - 0.6, x1: cx + 0.6, z1: cz + 0.6, y0: r.y, y1: r.y + 0.95};
  }

  private frame(dt: number): void {
    if (!this.surface || this.game.layout !== this.layout) return;
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = TABLE.exploreS; this.explore(); }
    this.aimed = this.aimAt();
    this.prompt = this.aimed ? MAP_TEXT.prompt : null;
    this.redrawTable(dt);
  }

  /** Mark the cells around the player and the building entered; write the lane on change. */
  explore(): void {
    const g = this.game, p = g.player, s = this.surface, grid = this.grid;
    if (!s || !grid) return;
    const area = (this.stagedLevels ?? g.levels)?.areaAt?.(p.x, p.z, p.y) ?? -1;
    const b = this.areaBuilding.get(area);
    let changed = markDisc(grid, p.x, p.z, b !== undefined ? EXPLORE.interiorRevealM : EXPLORE.revealM) > 0;
    if (b !== undefined && !this.entered.has(b)) { this.entered.add(b); changed = true; }
    if (changed) { this.dirty = true; this.flush(); }
  }

  /** Write the record into the district's memory (change-driven). */
  flush(): void {
    if (!this.dirty || !this.grid || !this.key) return;
    this.game.run.setLaneStore(SURFACE_LIFE_LANE, writeLifeRecord(this.grid, this.entered), this.key);
    this.dirty = false;
    this.counts.writes++;
  }

  private aimAt(): boolean {
    const g = this.game, b = this.box, p = g.player;
    if (!b || !p.alive || g.skywaysCar?.driving) return false;
    const cp = Math.cos(p.pitch), d = {x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp};
    const t = rayBox({x: p.x, y: p.eye, z: p.z}, d, {x0: b.x0 - TABLE.pad, z0: b.z0 - TABLE.pad, x1: b.x1 + TABLE.pad, z1: b.z1 + TABLE.pad, y0: b.y0, y1: b.y1 + TABLE.pad});
    return t !== null && t <= TABLE.reach;
  }

  private interact(): boolean {
    if (!this.surface || !this.aimed || this.game.state !== 'playing') return false;
    return this.open();
  }

  /** Per-building live figures: holders searched in its footprint, its own layout enemies down. */
  stats(): Map<number, BuildingStats> {
    if (this.staged) return this.stagedStats();
    const g = this.game, s = this.surface!, out = new Map<number, BuildingStats>();
    const alive = new Set<number>();
    for (const z of g.zombies) if (z.brain.alive) { const i = g.layoutIndexOf(z); if (i !== undefined) alive.add(i); }
    const zs = this.layout?.zombies ?? [];
    const holders = g.containers?.all ?? [];
    for (const b of s.buildings) {
      if (!b.enterable) continue;
      const areas = new Set(b.areas), f = b.footprint, levels = new Set(b.levels.length ? b.levels : [0]);
      let hostiles = 0, down = 0;
      zs.forEach((z, i) => { if (areas.has(z.area)) { hostiles++; if (!alive.has(i)) down++; } });
      let hn = 0, searched = 0;
      for (const h of holders) {
        const pr = h.prop;
        if (pr.x < f.x0 || pr.x > f.x1 || pr.z < f.z0 || pr.z > f.z1 || !levels.has(pr.level ?? 0)) continue;
        hn++;
        if (h.state.searched) searched++;
      }
      out.set(b.id, {holders: hn, searched, hostiles, down});
    }
    return out;
  }

  /**
   * (staged) The building figures from the district's MEMORY (it is not built yet): its layout enemies remembered killed, its holders as
   * remembered (every holder of a visited district is: run/worldMemory.ts captureHolders) — searched / all in the footprint. A district never
   * visited has neither (no building entered either: nothing shown).
   */
  private stagedStats(): Map<number, BuildingStats> {
    const s = this.surface!, out = new Map<number, BuildingStats>();
    const mem = this.key ? this.game.run.peekMemory(this.key) : null;
    const killed = new Set(mem?.killed ?? []);
    const zs = this.layout?.zombies ?? [];
    const recs: {level: number; x: number; z: number; searched: boolean}[] = [];
    for (const [k, r] of Object.entries(mem?.holders ?? {})) {
      const m = /@(-?\d+):(-?\d+),(-?\d+)$/.exec(k);
      if (m) recs.push({level: Number(m[1]), x: Number(m[2]) / 100, z: Number(m[3]) / 100, searched: !!r.searched});
    }
    for (const b of s.buildings) {
      if (!b.enterable) continue;
      const areas = new Set(b.areas), f = b.footprint, levels = new Set(b.levels.length ? b.levels : [0]);
      let hostiles = 0, down = 0, hn = 0, searched = 0;
      zs.forEach((z, i) => { if (areas.has(z.area)) { hostiles++; if (killed.has(i)) down++; } });
      for (const h of recs) {
        if (h.x < f.x0 || h.x > f.x1 || h.z < f.z0 || h.z > f.z1 || !levels.has(h.level)) continue;
        hn++;
        if (h.searched) searched++;
      }
      out.set(b.id, {holders: hn, searched, hostiles, down});
    }
    return out;
  }

  /** The planning map now (the district's record + its live state; never the campaign). */
  model(): PlanningMap | null {
    const s = this.surface, grid = this.grid;
    if (!s || !grid) return null;
    const g = this.game, p = g.player, car = g.skywaysCar, truck = this.staged ? null : vehiclePoseOf(car); // (lane TRUCK's truck: its transform)
    const reports: MapReportInput[] = [], replace: string[] = [];
    const ctx: MapReportContext = {entered: this.entered, known: b => {
      if (this.entered.has(b)) return true;
      const q = s.buildings.find(x => x.id === b);
      return !!q && rectExplored(grid, q.footprint);
    }};
    for (const src of surfaceMapSources(g)) {
      // (staged: the lanes have no live state of a district not built yet — their report families are left out, never their defaults
      // in place of what the district remembers; the truck likewise: no marker until it is built)
      if (this.staged) { replace.push(...(src.keys ?? [])); continue; }
      try {
        const got = src.reports(s, ctx);
        if (!got) continue;
        reports.push(...got);
        replace.push(...(src.keys ?? []));
      } catch (err) { console.warn(`planning map: report source ${src.name} failed`, err); }
    }
    return buildPlanningMap(s, {explore: grid, entered: this.entered, stats: this.stats(), reports, replace,
      player: {x: p.x, z: p.z, yaw: car?.driving && truck ? truck.yaw : p.yaw}, truck}); // (seated: the player faces the truck's way)
  }

  /** Open the full-screen planning map (as E at the table does). */
  open(): boolean {
    const g = this.game, m = this.model();
    if (!m || g.state !== 'playing') return false;
    const held = ['KeyE', 'Tab'].filter(c => g.input.down(c));
    this.view ??= new PlanningMapView();
    g.setState('map');
    this.view.open(m, {heldKeys: held, onClose: key => { if (key) g.input.suppressUntilRelease(key); if (g.state === 'map') void g.enterPlay(); }});
    this.counts.opens++;
    return true;
  }

  // --- the table-top copy ------------------------------------------------------------------------------------------------------

  private buildTable(layout: StationLayout, s: SurfaceInfo): void {
    const p = mapTablePlacement(layout, s);
    if (!p || typeof document === 'undefined') return;
    const side = Math.min(p.hx, p.hz) * 2 * 0.9;
    if (!(side > 0.2)) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TABLE.px;
    const ctx = canvas.getContext('2d') as unknown as MapCtx | null;
    if (!ctx) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({map: texture, roughness: 0.9, metalness: 0});
    material.name = 'surface-planning-map-sheet';
    const geo = new THREE.PlaneGeometry(side, side);
    geo.rotateX(-Math.PI / 2); // flat on the table, the canvas's top edge toward -z (north on the sheet = north in the world)
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'surface-planning-map-table';
    mesh.position.set(p.x, p.y + p.h + 0.004, p.z);
    mesh.receiveShadow = true;
    this.game.scene.add(mesh);
    this.table = {mesh, canvas, texture, material, sig: '', t: 0};
    this.drawTable(true);
  }

  private redrawTable(dt: number): void {
    const t = this.table;
    if (!t) return;
    t.t -= dt;
    if (t.t > 0) return;
    t.t = TABLE.redrawS;
    const p = this.game.player;
    if (Math.hypot(p.x - t.mesh.position.x, p.z - t.mesh.position.z) > TABLE.nearM) return;
    this.drawTable(false);
  }

  private drawTable(force: boolean): void {
    const t = this.table, m = t ? this.model() : null;
    if (!t || !m) return;
    const sig = mapSignature(m);
    if (!force && sig === t.sig) return;
    const ctx = t.canvas.getContext('2d') as unknown as MapCtx | null;
    if (!ctx) return;
    drawPlanningCanvas(ctx, m, TABLE.px);
    t.texture.needsUpdate = true;
    t.sig = sig;
    this.counts.tableDraws++;
  }

  private disposeTable(): void {
    const t = this.table;
    if (!t) return;
    t.mesh.removeFromParent();
    t.mesh.geometry.dispose();
    t.material.dispose();
    t.texture.dispose();
    this.table = null;
  }

  qa(): Record<string, unknown> {
    const m = this.surface ? this.model() : null;
    return {district: !!this.surface, staged: this.staged, box: this.box, aimed: this.aimed, entered: [...this.entered], explored: m?.explored ?? 0, table: !!this.table, counts: {...this.counts},
      markers: m?.markers.map(k => ({id: k.id, kind: k.kind, label: k.label, grid: k.grid, ref: k.ref})) ?? [], view: this.view?.qa() ?? null};
  }
}

export function installSurfaceMap(game: Game): SurfaceMapRuntime {
  return new SurfaceMapRuntime(game).install();
}
