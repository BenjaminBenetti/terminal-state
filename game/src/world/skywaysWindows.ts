// Task studio-skyways-level-20261106-054448 (lane GAS): THE SKYWAYS GLAZING — the breakable glazed spans of layout.skyways.windows
// (bridge side walls, building facades on the street and +15 storeys; gen/skyways/skywaysTypes.ts SkywaysWindow, the Office's
// StoreyWindow shape) as a section runtime installed into Game like the tower runtime (world/towerRuntime.ts), inert without
// layout.skyways:
//  - plan: world/officeWindows.ts planWindows over the spans (deterministic per level seed; pane id `level:span:column:row`, span =
//    the index in layout.skyways.windows), then the Skyways rule — NO inert broken glass: a pane is intact / cracked (breakable by
//    bullets, world/windowBreach.ts health) or broken because it is BREACHED (a gas source). The generic plan's broken columns
//    become cracked; boarded columns stay (boards are not glass). A `breached` span has only breakable panes; they are listed as
//    pre-breached and the gas system breaks them at the FIRST build of the station world (no lane record yet) as breaches of age
//    AGE_CAP_S through the restore / fast-forward path (world/gas/system.ts) — the bridge is already gassed at arrival; a revisit
//    restores the saved record (lane store SKYWAYS_WINDOWS_LANE 'skyways.windows', per-station memory) and never seeds twice;
//  - build (sectionHooks, before GAS): buildWindows' merged per-storey meshes (pre-built intact / cracked / broken looks of every
//    breakable pane, switched by setPaneLook), the reveals over the wall thickness (head soffit, sill, jambs in the wall paint),
//    shadows marked, registered with the storey culler (userData.level) and the warm-up; disposed on teardown. The window-glass
//    texture (lane ASSETS' T6, an existing approved texture; the procedural cracked fallback until it arrives) is preloaded;
//  - the wall holes: cutSkywaysWindows (world/builder.ts, beside cutOfficeWindows; no-op without layout.skyways) cuts the spans out
//    of the room-side wall faces of their storey — faces holding a doorway elsewhere along the run keep it (shifted into their piece);
//    a doorway across a span is never cut (the face stays whole). The wall cells stay SOLID (collision, bullets, sight, light);
//  - per frame: every span keeps its collider (the player and enemies of its storey are pushed back to the room side: nothing
//    leaves through the glass, broken or not);
//  - gasSource(): {plans, view, exterior: layout.skyways.exterior, lane, prebreached} for GasSystem.windowSources — the gas field
//    covers the complex (exterior ± 1 cell) over the storeys with windows; exposure and the green fog read that one field.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {SkywaysInfo, SkywaysWindow} from '../gen/skyways/skywaysTypes';
import {loadOfficeTexture} from '../assets/officeAssets';
import type {WarmupRegistry} from '../render/warmup';
import type {WorldMaterials} from './materials';
import {buildWindows, paneBreakable, paneId, planWindows, type PaneState, type WindowPlan, type WindowView} from './officeWindows';
import {pushOutRect, type WindowSpan} from './towerShared';
import type {GasWindowSource} from './gas/system';

/** RUN lane store key (per-station section memory) of the Skyways panes' state (world/windowBreach.ts WindowsRecord v 2). */
export const SKYWAYS_WINDOWS_LANE = 'skyways.windows';
/** Longest wait for the window-glass texture before the world is built (then: the procedural fallback + late swap). */
export const SKYWAYS_GLASS_WAIT_MS = 4000;

// ---------------------------------------------------------------------------------------------
// Plan (pure)

/** The spans in the tower runtime's WindowSpan shape (1:1 with layout.skyways.windows: the span index is part of the pane id). */
export function skywaysSpans(windows: readonly SkywaysWindow[]): WindowSpan[] {
  return windows.map(w => ({x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, side: w.side, sill: w.sill, head: w.head, kind: 'window', level: w.level, baseY: w.baseY}));
}

/** The Skyways pane rule: a breached span's panes are all breakable (broken by the breach), else generated broken -> cracked. */
export function skywaysPaneState(s: PaneState, breached: boolean): PaneState {
  return breached ? 'intact' : s === 'broken' ? 'cracked' : s;
}

/** Plans every Skyways span (deterministic per level seed): no inert broken panes (skywaysPaneState). */
export function planSkywaysWindows(info: Pick<SkywaysInfo, 'windows'>, seed: number): WindowPlan[] {
  const plans = planWindows({windows: skywaysSpans(info.windows), seed: seed >>> 0});
  for (const p of plans) {
    const breached = info.windows[p.index]?.breached === true;
    for (const pane of p.panes) pane.state = skywaysPaneState(pane.state, breached);
  }
  return plans;
}

/** The breakable panes of the breached spans (broken at the first build of the world). */
export function prebreachedPanes(plans: readonly WindowPlan[], info: Pick<SkywaysInfo, 'windows'>): string[] {
  const out: string[] = [];
  for (const p of plans) {
    if (info.windows[p.index]?.breached !== true) continue;
    for (const pane of p.panes) if (paneBreakable(p, pane)) out.push(paneId(p, pane));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Builder hook: the holes in the wall faces (pure)

/** The parts of a built wall face the cut reads / writes (world/levelGeometry.ts BuiltFace satisfies it). */
export interface CutFace {
  level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  /** Openings along the face from its lower end (s0 / s1 in m from min(x0, x1) or min(z0, z1)), `top` absolute. */
  openings: {s0: number; s1: number; top: number}[];
  slope?: unknown;
  nx?: number; nz?: number;
}

/** A span to cut: the wall cells' box, outward side, sill / head above baseY, storey. */
export type CutSpan = Pick<SkywaysWindow, 'x0' | 'z0' | 'x1' | 'z1' | 'side' | 'sill' | 'head' | 'level' | 'baseY'>;

/**
 * Cuts the spans out of the room-side wall faces of their storey (left / right / below-sill / above-head pieces; the pieces keep
 * the face's finish and seed). A face's own doorway openings stay in the left / right piece that holds them (shifted); a face whose
 * opening crosses a span is left whole (a door is never cut). Faces of other planes / storeys / directions are untouched.
 */
export function cutWindowSpans<F extends CutFace>(faces: F[], spans: readonly CutSpan[]): F[] {
  let out = faces;
  for (const w of spans) {
    const alongX = w.side === 'N' || w.side === 'S';
    const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
    const inward = w.side === 'N' || w.side === 'W' ? 1 : -1; // the room-side face's normal sign
    const s0 = alongX ? w.x0 : w.z0, s1 = alongX ? w.x1 : w.z1;
    const ya = w.baseY + w.sill, yb = w.baseY + w.head;
    const next: F[] = [];
    for (const f of out) {
      const fAlongX = Math.abs(f.z0 - f.z1) < 1e-9;
      const fPlane = fAlongX ? f.z0 : f.x0, fn = fAlongX ? f.nz : f.nx;
      const fs0 = Math.min(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1), fs1 = Math.max(fAlongX ? f.x0 : f.z0, fAlongX ? f.x1 : f.z1);
      if (f.level !== w.level || fAlongX !== alongX || Math.abs(fPlane - plane) > 1e-6 || f.slope || (fn !== undefined && fn !== 0 && Math.sign(fn) !== inward)
        || fs1 <= s0 + 1e-6 || fs0 >= s1 - 1e-6 || f.y1 <= ya + 1e-6 || f.y0 >= yb - 1e-6) { next.push(f); continue; }
      const c0 = Math.max(fs0, s0), c1 = Math.min(fs1, s1);
      if (f.openings.some(o => fs0 + o.s1 > c0 + 1e-6 && fs0 + o.s0 < c1 - 1e-6)) { next.push(f); continue; }
      const piece = (a: number, b: number, y0: number, y1: number, keep: boolean) => {
        if (b - a < 1e-4 || y1 - y0 < 1e-4) return;
        const openings = keep ? f.openings.filter(o => fs0 + o.s0 >= a - 1e-6 && fs0 + o.s1 <= b + 1e-6).map(o => ({...o, s0: o.s0 + fs0 - a, s1: o.s1 + fs0 - a})) : [];
        next.push({...f, ...(fAlongX ? {x0: a, x1: b} : {z0: a, z1: b}), y0, y1, openings});
      };
      piece(fs0, c0, f.y0, f.y1, true);
      piece(c1, fs1, f.y0, f.y1, true);
      piece(c0, c1, f.y0, Math.min(f.y1, ya), false);
      piece(c0, c1, Math.max(f.y0, yb), f.y1, false);
    }
    out = next;
  }
  return out;
}

/** world/builder.ts hook: the Skyways spans cut out of the wall faces (no-op without layout.skyways). */
export function cutSkywaysWindows<F extends CutFace>(faces: F[], layout: {skyways?: Pick<SkywaysInfo, 'windows'>}): F[] {
  const ws = layout.skyways?.windows;
  return ws?.length ? cutWindowSpans(faces, ws) : faces;
}

// ---------------------------------------------------------------------------------------------
// three.js: reveals

/** Quads merged into one mesh (wound counter-clockwise toward the normal). */
class RevealQuads {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  quad(p: number[][], n: readonly number[], uv: number[][]): void {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    if ((ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0) { p = [p[0], p[3], p[2], p[1]]; uv = [uv[0], uv[3], uv[2], uv[1]]; }
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uv[i]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** The reveals of every span over its wall thickness (head soffit, sill top, jambs): one mesh per storey in `mat`. */
export function buildSkywaysReveals(spans: readonly CutSpan[], mat: THREE.Material, scale: {u: number; v: number}): THREE.Mesh[] {
  const byLevel = new Map<number, RevealQuads>();
  for (const w of spans) {
    let q = byLevel.get(w.level);
    if (!q) byLevel.set(w.level, (q = new RevealQuads()));
    const ya = w.baseY + w.sill, yb = w.baseY + w.head;
    const alongX = w.side === 'N' || w.side === 'S';
    const [i0, i1] = alongX ? [w.z0, w.z1] : [w.x0, w.x1];
    const [s0, s1] = alongX ? [w.x0, w.x1] : [w.z0, w.z1];
    const P = (s: number, y: number, d: number): number[] => (alongX ? [s, y, d] : [d, y, s]);
    const uvs = (a: number, b: number, c: number, d: number) => [[a / scale.u, b / scale.v], [c / scale.u, b / scale.v], [c / scale.u, d / scale.v], [a / scale.u, d / scale.v]];
    q.quad([P(s0, yb, i0), P(s1, yb, i0), P(s1, yb, i1), P(s0, yb, i1)], [0, -1, 0], uvs(s0, i0, s1, i1));
    q.quad([P(s0, ya, i1), P(s1, ya, i1), P(s1, ya, i0), P(s0, ya, i0)], [0, 1, 0], uvs(s0, i0, s1, i1));
    for (const [s, sgn] of [[s0, 1], [s1, -1]] as const) {
      q.quad([P(s, ya, i0), P(s, ya, i1), P(s, yb, i1), P(s, yb, i0)], alongX ? [sgn, 0, 0] : [0, 0, sgn], uvs(i0, ya, i1, yb));
    }
  }
  const out: THREE.Mesh[] = [];
  for (const [lv, q] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const g = q.geometry();
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.name = 'skyways-window-reveals';
    m.userData.level = lv;
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface SkywaysWindowsHost {
  scene: THREE.Scene;
  layout: StationLayout;
  mats: WorldMaterials;
  player: {x: number; z: number; y: number; radius: number; alive: boolean};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[];
  warmRegistry: Pick<WarmupRegistry, 'addPool'>;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  /** The built world: its storey culler (the window meshes are registered per storey). */
  world?: {culler?: unknown} | null;
}

/** The built glazing of the current Skyways world. */
export interface SkywaysGlazing {
  info: SkywaysInfo;
  plans: WindowPlan[];
  view: WindowView;
  root: THREE.Group;
  reveals: THREE.Mesh[];
  /** Pane ids broken at the first build of the world (the breached spans' panes). */
  prebreached: string[];
}

export class SkywaysWindowRuntime {
  /** The current world's glazing (null without layout.skyways / between worlds). */
  glazing: SkywaysGlazing | null = null;
  /** Counters (QA / tests): builds, collider push-outs. */
  readonly counts = {builds: 0, pushes: 0};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private loading: Promise<void> | null = null;

  constructor(readonly host: SkywaysWindowsHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    h.warmRegistry.addPool('skyways-windows', () => (this.glazing ? [this.glazing.root] : []));
    h.sectionPreloads?.push(layout => (layout.skyways?.windows.length ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, SKYWAYS_GLASS_WAIT_MS))]) : Promise.resolve()));
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
    const info = layout.skyways;
    if (!info?.windows?.length) return;
    void this.preload();
    const h = this.host;
    const plans = planSkywaysWindows(info, layout.seed);
    const view = buildWindows(plans, h.mats, this.glassTex ?? null);
    view.root.name = 'skyways-windows';
    const reveals = buildSkywaysReveals(info.windows, h.mats.get('paint'), h.mats.scale.paint);
    const root = new THREE.Group();
    root.name = 'skyways-glazing';
    root.add(view.root);
    for (const m of reveals) root.add(m);
    h.atmosphere?.markShadows(view.root, false); // frames / sills / boards block the torch like the walls (glass is skipped: not opaque)
    for (const m of reveals) h.atmosphere?.markShadows(m, true);
    // static (world-space geometry, identity transforms): no per-frame matrix compose
    root.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    h.scene.add(root);
    root.updateMatrixWorld(true);
    this.glazing = {info, plans, view, root, reveals, prebreached: prebreachedPanes(plans, info)};
    this.counts.builds++;
    // storey culling (meshes tagged userData.level by buildWindows / the reveals)
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
  }

  teardown(): void {
    const g = this.glazing;
    this.glazing = null;
    if (!g) return;
    this.host.scene.remove(g.root);
    for (const geo of g.view.geometries) geo.dispose();
    for (const m of g.reveals) m.geometry.dispose();
  }

  /** GasSystem.windowSources: this world's panes (null without a Skyways glazing). */
  gasSource(): GasWindowSource | null {
    const g = this.glazing;
    return g ? {plans: g.plans, view: g.view, exterior: g.info.exterior, lane: SKYWAYS_WINDOWS_LANE, prebreached: g.prebreached} : null;
  }

  /** Per frame: the span colliders on their own storey (bodies pushed back to the room side). */
  frame(): void {
    const g = this.glazing;
    if (!g) return;
    const h = this.host, plans = g.plans;
    const fix = (b: {x: number; z: number; y: number}, r: number): void => {
      for (const p of plans) {
        if (Math.abs(b.y - p.baseY) > 2.6) continue; // that span's own storey only
        const c = p.collider;
        if (b.x < c.x0 - r - 0.5 || b.x > c.x1 + r + 0.5 || b.z < c.z0 - r - 0.5 || b.z > c.z1 + r + 0.5) continue;
        const q = pushOutRect(b.x, b.z, r, c, [-p.n[0], -p.n[1]]);
        if (q) { b.x = q[0]; b.z = q[1]; this.counts.pushes++; }
      }
    };
    if (h.player.alive) fix(h.player, h.player.radius);
    for (const z of h.zombies) if (z.brain.alive && !z.ragdolled) fix(z.brain, z.brain.stats.radius);
  }
}

/** Installs the Skyways glazing runtime into a Game (one call in the Game constructor, BEFORE installGas). */
export function installSkywaysWindows(host: SkywaysWindowsHost): SkywaysWindowRuntime {
  return new SkywaysWindowRuntime(host).install();
}
