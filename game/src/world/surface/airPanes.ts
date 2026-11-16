// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's LIVE WINDOW PANES — the district's glazing in GEN's
// window spans (`surface.windows`, gen/surface/surfaceTypes.ts SurfaceWindowSpan: the Office tower's span model with GEN's per-column pane
// states). Lane LOOK cuts the openings and draws the frames / reveals; the panes are drawn here, through the EXISTING glass path
// (world/officeWindows.ts buildWindows: the office glass / cracked glass materials, pre-built intact / cracked / broken looks switched by
// setPaneLook — no new mesh, material or pipeline mid-play; frames / sills off: LOOK's), and broken through the existing breach rules
// (world/windowBreach.ts: PANE_MAX_HP = 3 pistol bullets of real damage, from the room side AND — `outer` — from the street).
//
// Plan (pure, deterministic per district): one WindowPlan per span (index = its index in surface.windows, so pane ids
// `level:span:column:row` are stable), GEN's columns as the pane columns (mullions between them), a transom on tall spans (the tower rule),
// the glass plane / collider as world/officeWindows.ts planWindows. The district rule (the Skyways rule): NO inert broken glass —
//  - 'intact' / 'cracked' columns: breakable panes (bullets crack and break them; a break is a gas source into the room behind);
//  - 'broken' columns: breakable panes PRE-BREACHED — broken at the FIRST build of the district through the gas system's restore path at
//    age AGE_CAP_S, so the room behind is already gassed on arrival (an intact building stays clean only while all its panes hold);
//  - 'boarded' columns: boards (not glass, no gas: a boarded window protects).
// The pane state (damage of unbroken panes, breach ages) persists per district memory in the RUN lane store SURFACE_WINDOWS_LANE
// (the GasSystem's own save / restore of WindowsRecord v 2: a revisit restores it, never re-seeds the pre-breached panes).

import {CELL} from '../../gen/grid';
import type {SurfaceInfo, SurfaceWindowSpan} from '../../gen/surface/surfaceTypes';
import {paneBreakable, paneId, type PanePlan, type PaneState, type WindowPlan} from '../officeWindows';
import {sideNormal, windowYs, type WindowSpan} from '../towerShared';

/** RUN lane store (per district memory) of the panes' state (world/windowBreach.ts WindowsRecord v 2). */
export const SURFACE_WINDOWS_LANE = 'surface.windows';

/** A district span in the tower runtime's WindowSpan shape (its storey's floor from surface.storeys). */
export function surfaceSpan(w: SurfaceWindowSpan, baseY: number): WindowSpan {
  return {x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, side: w.side, sill: w.sill, head: w.head, kind: 'window', level: w.level, baseY};
}

/** The district pane rule: 'broken' -> a breakable pane (pre-breached), the rest as generated. */
export function surfacePaneState(s: SurfaceWindowSpan['panes'][number]): PaneState {
  return s === 'broken' ? 'intact' : s;
}

/** The floor height of a layout level in the district (surface.storeys; level 0 = the street). */
export function storeyFloor(info: Pick<SurfaceInfo, 'storeys'>, level: number, levels?: readonly {id: number; baseY: number}[]): number {
  return info.storeys.find(s => s.level === level)?.y ?? levels?.find(l => l.id === level)?.baseY ?? 0;
}

const seedOf = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) % 1_000_000;
};

/** Plans every district span (deterministic): GEN's columns and states, the district pane rule, the street-side face (`outer`). */
export function planSurfaceWindows(info: Pick<SurfaceInfo, 'windows' | 'storeys' | 'seed'>, levels?: readonly {id: number; baseY: number}[]): WindowPlan[] {
  return info.windows.map((w, si) => {
    const span = surfaceSpan(w, storeyFloor(info, w.level, levels));
    const n = sideNormal(span.side);
    const along: 'x' | 'z' = n[0] === 0 ? 'x' : 'z';
    const a0 = along === 'x' ? span.x0 : span.z0, a1 = along === 'x' ? span.x1 : span.z1;
    const c0 = along === 'x' ? span.z0 : span.x0, c1 = along === 'x' ? span.z1 : span.x1;
    const out = n[0] + n[1]; // +1: exterior toward +cross
    const inner = out > 0 ? c0 : c1, outer = out > 0 ? c1 : c0;
    const thick = Math.max(0.05, c1 - c0);
    const glass = inner + out * Math.min(thick * 0.55, thick - 0.03);
    const [y0, y1] = windowYs(span);
    const len = a1 - a0;
    const count = Math.max(1, w.panes.length);
    const mullions = Array.from({length: count - 1}, (_, i) => a0 + len * (i + 1) / count);
    const transom = y1 - y0 > 2.1 ? y0 + (y1 - y0) * 0.74 : null;
    const panes: PanePlan[] = [];
    for (let i = 0; i < count; i++) {
      const pa0 = a0 + len * i / count, pa1 = a0 + len * (i + 1) / count;
      const state = surfacePaneState(w.panes[i] ?? 'intact');
      const rows: [number, number][] = transom === null ? [[y0, y1]] : [[y0, transom], [transom, y1]];
      rows.forEach(([py0, py1], j) => panes.push({a0: pa0, a1: pa1, y0: py0, y1: py1, state, seed: seedOf(info.seed, si, i * 7 + j), col: i, row: j}));
    }
    const cMin = out > 0 ? inner : Math.min(c0, inner - 0.35), cMax = out > 0 ? Math.max(c1, inner + 0.35) : inner;
    const collider = along === 'x' ? {x0: a0, x1: a1, z0: cMin, z1: cMax} : {x0: cMin, x1: cMax, z0: a0, z1: a1};
    return {index: si, span, level: span.level, baseY: span.baseY, n, along, a0, a1, glass, inner, outer, y0, y1, mullions, transom, panes, collider};
  });
}

/** The pane ids of GEN's 'broken' columns (broken at the first build of the district: pre-breached). */
export function surfacePrebreached(plans: readonly WindowPlan[], info: Pick<SurfaceInfo, 'windows'>): string[] {
  const out: string[] = [];
  for (const p of plans) {
    const cols = info.windows[p.index]?.panes ?? [];
    for (const pane of p.panes) if (cols[pane.col] === 'broken' && paneBreakable(p, pane)) out.push(paneId(p, pane));
  }
  return out;
}

/** The building a span belongs to and its room (the gas pools there): QA / tests. */
export function spanRoom(info: Pick<SurfaceInfo, 'windows'>, p: WindowPlan): {building: number; room: number} | null {
  const w = info.windows[p.index];
  return w ? {building: w.building, room: w.room} : null;
}

/** World centre of a pane (on the glass plane) — QA / tests. */
export function paneWorldCentre(p: WindowPlan, pane: PanePlan): {x: number; y: number; z: number} {
  const a = (pane.a0 + pane.a1) / 2, y = (pane.y0 + pane.y1) / 2;
  return p.along === 'x' ? {x: a, y, z: p.glass} : {x: p.glass, y, z: a};
}

/** Cell of a world point (grid index on a w-wide grid). */
export const cellIndex = (x: number, z: number, w: number): number => Math.floor(z / CELL) * w + Math.floor(x / CELL);
