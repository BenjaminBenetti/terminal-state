// Task studio-mall-parking-glass-followup-20261117-043548-01: THE MALL's BREAKABLE EXTERIOR GLAZING — the parking-lot window walls'
// panes (gen/mall/windows.ts layout.mall.windows, layout version >= 2; their frames, lot and murk: world/mallWindows.ts) on the Office's
// window contracts. User: "The windows in the mall should be able to be shot out like the office levels letting the toxic gas in."
// A section runtime installed into Game like the Skyways glazing (world/skywaysWindows.ts), inert without window walls:
//  - plan (pure): one WindowPlan per wall and glazed storey (world/officeWindows.ts's shape; span index = the record's index in
//    layout.mall.windows, so pane ids `level:wall:column:row` are stable for a seed), panes = the curtain wall's own glazing grid
//    (world/mallWindows.ts paneGrid: the bays between the mullions, below / above the transom rail), the room-side face = the glazing plane
//    (the walkway's last open cell ends there: Levels.raycast reports a bullet on it as a 'wall' hit of that storey), the glass plane just
//    behind it, every pane generated INTACT (a parking-lot window wall is clean glass until it is shot: loading never gasses a Mall);
//  - build (sectionHooks, before GAS): world/officeWindows.ts buildWindows (frames off: the curtain wall draws its own) — the Office's
//    intact / cracked glass materials and every breakable pane's pre-built intact / cracked / broken looks (setPaneLook switches them: no
//    mesh, material or pipeline is made mid-play, so the loading-screen warm-up covers every look); one build per wall, its meshes tagged
//    like the wall's other meshes (its glazed storeys + aperture: world/levelCulling.ts draws them exactly when the wall may be seen),
//    static, registered with the storey culler and the warm-up; disposed on teardown. The window-glass texture (lane ASSETS' T6, the
//    Office's existing approved texture; the procedural cracked fallback until it arrives) is preloaded behind the loading screen;
//  - collision is the SOLID curtain-wall cells (gen/mall/windows.ts): bodies, bullets, sight and physics stop there, broken or not (no
//    way out, no outdoor traversal);
//  - gasSource(): GasSystem.windowSources — bullets are attributed / counted / broken by world/windowBreach.ts (PANE_MAX_HP = 3 pistol
//    bullets of real damage), a break starts the Office's breach gas on its storey (world/gas/field.ts: the walkway's pool, the spill
//    through the real openings), drawn as the visible green volumetric fog from the SAME field the exposure reads (mask / filter /
//    airtank protect the lungs only). The field covers each wall's neighbourhood (MALL_GAS.margin: beyond the pool + spill reach) on the
//    glazed storeys; the atrium VOID cells and the lift shafts are closed (storeys never exchange gas; a void never carries a storey's gas
//    the march would draw on another band). State per Mall station memory in the RUN lane store MALL_WINDOWS_LANE through the gas system's
//    own save / restore (WindowsRecord v 2: leave / re-entry, save / Continue, Retry's level-entry memories); a Mall without a record
//    (a new one, or one visited before this update) starts with every pane intact — never a free reset of a recorded pane.

import * as THREE from 'three';
import {CELL, VOID} from '../gen/grid';
import type {StationLayout} from '../gen/stationTypes';
import {loadOfficeTexture} from '../assets/officeAssets';
import type {WarmupRegistry} from '../render/warmup';
import type {WorldMaterials} from './materials';
import {buildWindows, type PanePlan, type WindowPlan, type WindowView} from './officeWindows';
import type {Rect2, WindowSpan} from './towerShared';
import {GasField, type GasDomain} from './gas/field';
import type {GasWindowSource} from './gas/system';
import {CURTAIN, paneGrid, windowApertureOf, windowWallSpecs, type WindowWallSpec} from './mallWindows';

/** RUN lane store key (per-station section memory) of the Mall panes' state (world/windowBreach.ts WindowsRecord v 2). */
export const MALL_WINDOWS_LANE = 'mall.windows';
/** Longest wait for the window-glass texture before the world is built (then: the procedural fallback + a late swap). */
export const MALL_GLASS_WAIT_MS = 4000;
/**
 * The gas field round each window wall (m): along the span each way and into the mall. The breach pool reaches GAS.POOL_RADIUS_M (10 m)
 * walking from the pane and the spill decays below the field's flush level within ~11 m more: nothing of a breach's gas reaches the
 * domain's closed ring.
 */
export const MALL_GAS = {margin: 26} as const;

/** buildWindows insets every pane by half its 6 cm frame: the plan's rects reach that far under the curtain's members (glass meets frame). */
const INSET = 0.03;

const seedOf = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) % 1_000_000;
};

// ---------------------------------------------------------------------------------------------
// Plan (pure)

/** One window wall's plans (one per glazed storey, bottom-up). */
export function planWindowWall(s: WindowWallSpec): WindowPlan[] {
  const g = paneGrid(s), alongX = s.nz !== 0, out = s.nx + s.nz;
  // the wall's local u (world/mallStreetExit.ts exitFrame: along = (nz, 0, -nx), origin at the span centre) -> the world axis along it
  const c = (s.s0 + s.s1) / 2, sg = alongX ? s.nz : -s.nx;
  const toA = (u: number) => c + sg * u;
  const glass = s.plane + out * g.wg;
  const col = s.collider;
  const collider: Rect2 = {x0: col.x0, z0: col.z0, x1: col.x1, z1: col.z1};
  return g.bands.map(b => {
    const baseY = s.streetY + b.y0, y0 = baseY + CURTAIN.sill, y1 = s.streetY + b.y1 - CURTAIN.head;
    const span: WindowSpan = {...collider, side: s.side, sill: y0 - baseY, head: y1 - baseY, kind: 'window', level: b.level, baseY};
    const mullions = Array.from({length: g.bays - 1}, (_, i) => toA(-g.hs + (i + 1) * g.bw)).sort((p, q) => p - q);
    const panes: PanePlan[] = b.panes.map(p => {
      const a0 = Math.min(toA(p.u0), toA(p.u1)), a1 = Math.max(toA(p.u0), toA(p.u1));
      return {a0: a0 - INSET, a1: a1 + INSET, y0: s.streetY + p.y0 - INSET, y1: s.streetY + p.y1 + INSET, state: 'intact', seed: seedOf(s.seed, b.level, p.col * 7 + p.row), col: p.col, row: p.row};
    });
    return {index: s.index, span, level: b.level, baseY, n: [s.nx, s.nz] as [number, number], along: alongX ? 'x' as const : 'z' as const, a0: s.s0, a1: s.s1, glass, inner: s.plane, y0, y1,
      mullions, transom: s.streetY + b.rail, panes, collider};
  });
}

/** Every window wall's plans of a layout ([] without layout.mall.windows: every version-1 Mall, every other level). */
export function planMallWindows(layout: {mall?: unknown}): WindowPlan[] {
  return windowWallSpecs(layout).flatMap(planWindowWall);
}

/** The gas field's cells: each wall's neighbourhood (MALL_GAS.margin along and inward, its curtain cell outward), clipped to the grid. */
export function mallGasDomain(specs: readonly WindowWallSpec[], grid: {w: number; h: number}): GasDomain | null {
  if (!specs.length) return null;
  const M = MALL_GAS.margin;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const s of specs) {
    const alongX = s.nz !== 0, out = s.nx + s.nz;
    const c0 = Math.min(s.plane - out * M, s.plane + out * CELL), c1 = Math.max(s.plane - out * M, s.plane + out * CELL);
    const [ax0, ax1, az0, az1] = alongX ? [s.s0 - M, s.s1 + M, c0, c1] : [c0, c1, s.s0 - M, s.s1 + M];
    x0 = Math.min(x0, ax0); x1 = Math.max(x1, ax1); z0 = Math.min(z0, az0); z1 = Math.max(z1, az1);
  }
  const d = {x0: Math.max(0, Math.floor(x0 / CELL)), y0: Math.max(0, Math.floor(z0 / CELL)), x1: Math.min(grid.w, Math.ceil(x1 / CELL)), y1: Math.min(grid.h, Math.ceil(z1 / CELL))};
  return d.x1 > d.x0 && d.y1 > d.y0 ? d : null;
}

/** The Mall's extra closed gas cells: a storey's atrium VOID cells (no floor to hold its gas) and the lift shafts (closed doors). */
export function mallGasClosed(layout: StationLayout): (cx: number, cy: number, level: number) => boolean {
  const shafts = (layout.mall?.elevators ?? []).map(e => e.shaft);
  const grids = new Map(layout.levels.map(l => [l.id, l.grid] as const));
  return (cx, cy, level) => {
    const g = grids.get(level);
    if (g && g.cells[cy * g.w + cx] === VOID) return true;
    const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
    return shafts.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  };
}

/** The Mall's breach field: the glazed storeys over the walls' domain, VOID / shaft cells closed (null without window walls). */
export function mallGasField(layout: StationLayout, plans: readonly WindowPlan[], domain: GasDomain): GasField {
  const storeys = new Set(plans.map(p => p.level));
  return new GasField(layout.levels.filter(l => storeys.has(l.id)).map(l => ({id: l.id, grid: l.grid})), {domain, closed: mallGasClosed(layout)});
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface MallWindowsHost {
  scene: THREE.Scene;
  mats: WorldMaterials;
  warmRegistry: Pick<WarmupRegistry, 'addPool'>;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  /** The built world: its storey culler (the pane meshes are registered with it). */
  world?: {culler?: unknown} | null;
}

/** The built breakable glazing of the current Mall world. */
export interface MallGlazing {
  layout: StationLayout;
  specs: WindowWallSpec[];
  plans: WindowPlan[];
  /** Every wall's panes in ONE view (the breach system's setPaneLook target); root = the walls' roots. */
  view: WindowView;
  root: THREE.Group;
  domain: GasDomain;
}

export class MallWindowRuntime {
  /** The current world's glazing (null without window walls / between worlds). */
  glazing: MallGlazing | null = null;
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, teardowns: 0};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private loading: Promise<void> | null = null;

  constructor(readonly host: MallWindowsHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.warmRegistry.addPool('mall-windows', () => (this.glazing ? [this.glazing.root] : []));
    h.sectionPreloads?.push(layout => (layout.mall?.windows?.length ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, MALL_GLASS_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** The window-glass texture once (cached by officeAssets; null = not delivered). Never rejects. */
  preload(): Promise<void> {
    return (this.loading ??= loadOfficeTexture('window-glass').then(t => {
      this.glassTex = t;
      const cracked = this.glazing?.view.cracked;
      if (t && cracked && cracked.map !== t) cracked.map = t;
    }, () => { this.glassTex = null; }));
  }

  build(layout: StationLayout): void {
    if (this.glazing) this.teardown();
    const specs = layout.mall?.windows?.length ? windowWallSpecs(layout) : [];
    const domain = mallGasDomain(specs, layout.levels[0]?.grid ?? layout.grid);
    if (!specs.length || !domain) return;
    void this.preload();
    const h = this.host, root = new THREE.Group();
    root.name = 'mall-window-panes';
    const plans: WindowPlan[] = [];
    const view: WindowView = {root, glass: [], geometries: [], cracked: null, panes: new Map()};
    for (const s of specs) {
      const mine = planWindowWall(s);
      if (!mine.length) continue;
      const v = buildWindows(mine, h.mats, this.glassTex ?? null, {frames: false});
      const levels = s.bands.map(b => b.level), aperture = windowApertureOf(s);
      v.root.name = `mall-window-${s.id}-panes`;
      v.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.name = `mall-window-${s.id}-${m.name.replace(/^tower-window-/, '')}-L${m.userData.level}`;
        m.userData.levels = levels; // (the wall's glazed storeys + aperture, exactly like the glass it replaces: the culler's gate)
        m.userData.aperture = aperture;
        m.userData.windowWall = s.id;
        m.castShadow = m.receiveShadow = false;
      });
      root.add(v.root);
      plans.push(...mine);
      view.glass.push(...v.glass);
      view.geometries.push(...v.geometries);
      view.cracked ??= v.cracked;
      for (const [id, p] of v.panes) view.panes.set(id, p);
    }
    // static (world-space geometry, identity transforms): no per-frame matrix compose
    root.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    h.scene.add(root);
    root.updateMatrixWorld(true);
    this.glazing = {layout, specs, plans, view, root, domain};
    this.counts.builds++;
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
  }

  teardown(): void {
    const g = this.glazing;
    this.glazing = null;
    if (!g) return;
    this.counts.teardowns++;
    this.host.scene.remove(g.root);
    for (const geo of g.view.geometries) geo.dispose();
  }

  /** GasSystem.windowSources: this world's panes and its bounded field (null without window walls). */
  gasSource(): GasWindowSource | null {
    const g = this.glazing;
    if (!g) return null;
    const d = g.domain;
    return {
      plans: g.plans, view: g.view, lane: MALL_WINDOWS_LANE,
      exterior: {x0: d.x0 * CELL, z0: d.y0 * CELL, x1: d.x1 * CELL, z1: d.y1 * CELL},
      field: () => mallGasField(g.layout, g.plans, g.domain),
    };
  }
}

/** Installs the Mall glazing runtime into a Game (one call in the Game constructor, BEFORE installGas). */
export function installMallWindows(host: MallWindowsHost): MallWindowRuntime {
  return new MallWindowRuntime(host).install();
}
