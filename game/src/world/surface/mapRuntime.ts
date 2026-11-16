// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE CHECKPOINT'S PLANNING MAP — runtime (the model is
// world/surface/mapModel.ts, the drawing mapDraw.ts, the overlay mapView.ts, the exploration record mapExplore.ts). Installed once by
// world/surface/life.ts; INERT on every layout without `layout.surface`.
//  - sectionHooks.build (before the warm-up): the district's exploration record from its memory lane ('surface.life'), the map table
//    (surface.checkpoint.mapTable.prop: lane KIT's srMapTable placement; its read pose when there is no placement), and the table-top copy
//    of the map as a RUNTIME CANVAS TEXTURE on a thin sheet laid on the table's top (dynamic content: the texture rule allows it);
//  - frameHooks (play only): exploration — the cells around the player (EXPLORE.revealM outdoors, interiorRevealM inside a building) and
//    the buildings entered, written to the lane on change (the record is current at any save); the aim at the table (prompt); the
//    table-top redraw (only near the table, at most every TABLE.redrawS, and only when what it shows changed);
//  - E at the table (aimed, within reach, not seated in the truck): the full-screen planning map (the game holds in the 'map' state —
//    nothing updates, spawns or moves behind it; Esc / E / Tab close and play resumes);
//  - sectionHooks.teardown: the record written, the table's GPU resources released, the overlay closed.
// Reports from other lanes: surfaceMapSources(game) (a registry like world/surface/crossing.ts) — e.g. AIR's live gas breaches, CARGO's
// recoverables at the depot / on the truck — each a MapReportInput at a real place (mapModel.ts drops one that stands on nothing).

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {SectionKey} from '../../levels/types';
import type {SBox, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {EXPLORE, SURFACE_LIFE_LANE, markDisc, readLifeRecord, writeLifeRecord, type ExploreGrid} from './mapExplore';
import {buildPlanningMap, mapSignature, type BuildingStats, type MapReportInput, type PlanningMap} from './mapModel';
import {drawPlanningCanvas, type MapCtx} from './mapDraw';
import {PlanningMapView} from './mapView';

/** A lane's live map reports (registered at install). */
export interface SurfaceMapReportSource { readonly name: string; reports(surface: SurfaceInfo): readonly MapReportInput[] }

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
  private exploreT = 0;
  private dirty = false;
  readonly counts = {builds: 0, opens: 0, writes: 0, tableDraws: 0, restored: 0};

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

  teardown(): void {
    if (this.surface) this.flush();
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

  /** The map table's [E] box: its placement's AABB, else a reading surface in front of the read pose. */
  tableBox(layout: StationLayout, s: SurfaceInfo): SBox | null {
    const mt = s.checkpoint.mapTable, p = mt.prop >= 0 ? layout.props[mt.prop] : undefined;
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
    const area = g.levels?.areaAt?.(p.x, p.z, p.y) ?? -1;
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

  /** The planning map now (the district's record + its live state; never the campaign). */
  model(): PlanningMap | null {
    const s = this.surface, grid = this.grid;
    if (!s || !grid) return null;
    const g = this.game, p = g.player, car = g.skywaysCar, body = car?.worldLive ? car.body : null;
    const reports: MapReportInput[] = [];
    for (const src of surfaceMapSources(g)) { try { reports.push(...src.reports(s)); } catch (err) { console.warn(`planning map: report source ${src.name} failed`, err); } }
    return buildPlanningMap(s, {explore: grid, entered: this.entered, stats: this.stats(), reports,
      player: {x: p.x, z: p.z, yaw: car?.driving && body ? body.yaw : p.yaw}, truck: body ? {x: body.x, z: body.z, yaw: body.yaw} : null});
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
    const mt = s.checkpoint.mapTable, p = mt.prop >= 0 ? layout.props[mt.prop] : undefined;
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
    return {district: !!this.surface, box: this.box, aimed: this.aimed, entered: [...this.entered], explored: m?.explored ?? 0, table: !!this.table, counts: {...this.counts},
      markers: m?.markers.map(k => ({id: k.id, kind: k.kind, label: k.label, grid: k.grid, ref: k.ref})) ?? [], view: this.view?.qa() ?? null};
  }
}

export function installSurfaceMap(game: Game): SurfaceMapRuntime {
  return new SurfaceMapRuntime(game).install();
}
