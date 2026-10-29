// Iteration 16 (WORLD-GEN): perimeter WINDOW spans of an office storey and the dim cool DAYLIGHT falling in through them.
//
// The tower's perimeter wall ring stays SOLID in the grid (collision, bullets, sight and the light field stop there); a window
// is a span of ring cells behind a room's facade wall run. The builder cuts the hole out of the wall faces and adds the reveals
// (world/officeProps.ts); lane TOWER fills it with glass / frames and the exterior. Spans skip interior wall junctions (a pane
// starts one cell off a partition wall), wall plates, wall-mounted props and anything tall standing against the facade, and are
// chunked into panes of at most 4 m with a 0.5 m pier between them. Rooms without windows: washrooms, closets, the server room.
// Daylight: one fixture-less light-field source (LightPlacement.virtual) per ~2.5 m of glass, 0.9 m inside the facade just under
// the window head, steady, low power, a cool overcast tint.

import {CELL, FLOOR} from '../grid';
import type {LightPlacement, OfficeWindowSpan, Side, StationLayout} from '../stationTypes';
import {MARGIN, WINDOW, type TowerFrame} from './frame';
import type {CarvedTower, OfficeAreaMeta} from './tower';

const NO_WINDOWS = new Set<OfficeAreaMeta['role']>(['wc', 'closet', 'cab', 'vestibule', 'server']);
/** Daylight tint (linear RGB, ~unit luminance): overcast sky through grimy glass. */
export const DAYLIGHT_TINT: readonly [number, number, number] = [0.74, 0.9, 1.2];
const PANE_MAX = 8;

export function windowSpans(layout: StationLayout, f: TowerFrame, tower: CarvedTower, level: number, lobby: {x0: number; x1: number} | null): OfficeWindowSpan[] {
  const g = layout.levels[level].grid;
  const {TW, TD} = f;
  const sill = lobby ? WINDOW.lobbySill : WINDOW.sill, head = lobby ? WINDOW.lobbyHead : WINDOW.head;
  const base = layout.levels[level].baseY;
  const out: OfficeWindowSpan[] = [];
  // Wall-plane obstacles: signs, mounted props and tall props within 0.35 m of the facade (world coordinates along the wall).
  const blockedAlong = (side: Side, t: number): boolean => {
    const plane = side === 'N' ? MARGIN * CELL : side === 'S' ? (MARGIN + TD) * CELL : side === 'W' ? MARGIN * CELL : (MARGIN + TW) * CELL;
    const alongX = side === 'N' || side === 'S';
    for (const s of layout.signs) {
      if ((s.level ?? 0) !== level) continue;
      const d = alongX ? Math.abs(s.z - plane) : Math.abs(s.x - plane), q = alongX ? s.x : s.z;
      if (d < 0.1 && Math.abs(q - t) < (s.w ?? 1.2) / 2 + 0.35) return true;
    }
    for (const p of layout.props) {
      if ((p.level ?? 0) !== level || p.host !== undefined) continue;
      const near = alongX ? Math.min(Math.abs(p.z - p.hz - plane), Math.abs(p.z + p.hz - plane)) : Math.min(Math.abs(p.x - p.hx - plane), Math.abs(p.x + p.hx - plane));
      if (near > 0.35) continue;
      const top = p.y - base + p.h;
      if (!p.mounted && top < sill + 0.02) continue;
      const lo = alongX ? p.x - p.hx : p.z - p.hz, hi = alongX ? p.x + p.hx : p.z + p.hz;
      if (t > lo - 0.15 && t < hi + 0.15) return true;
    }
    return false;
  };
  const sides: [Side, number][] = [['N', TW], ['S', TW], ['W', TD], ['E', TD]];
  for (const [side, len] of sides) {
    const cell = (s: number): [number, number] => side === 'N' ? [s, 0] : side === 'S' ? [s, TD - 1] : side === 'W' ? [0, s] : [TW - 1, s];
    const ok: boolean[] = [];
    for (let s = 0; s < len; s++) {
      const [tx, ty] = cell(s);
      const i = g.idx(tx + MARGIN, ty + MARGIN);
      const m = tower.meta.get(g.area[i]);
      let good = g.cells[i] === FLOOR && !!m && !NO_WINDOWS.has(m.role);
      if (good && lobby && side === 'N' && s >= lobby.x0 - 1 && s < lobby.x1 + 1) good = false;
      const t = (s + MARGIN + 0.5) * CELL;
      if (good && blockedAlong(side, t)) good = false;
      ok.push(good);
    }
    // Runs, inset one cell at partition junctions, chunked into panes.
    for (let s = 0; s < len;) {
      if (!ok[s]) { s++; continue; }
      let e = s;
      while (e < len && ok[e]) e++;
      const [tx0] = cell(s);
      const walled0 = s > 0 && !isOpenAt(g, cell(s - 1)), walled1 = e < len && !isOpenAt(g, cell(e));
      let a = s + (walled0 || s === 0 ? 1 : 0), b = e - (walled1 || e === len ? 1 : 0);
      void tx0;
      while (b - a >= 2) {
        const n = Math.min(PANE_MAX, b - a);
        out.push(span(side, a, a + n, f, sill, head, 'window'));
        a += n + 1;
      }
      s = e;
    }
  }
  if (lobby) out.push(span('N', lobby.x0, lobby.x1, f, 0, WINDOW.entranceHead, 'entrance'));
  return out;
  function isOpenAt(gg: typeof g, [tx, ty]: [number, number]): boolean {
    return gg.cells[gg.idx(tx + MARGIN, ty + MARGIN)] === FLOOR;
  }
}

/** A span of ring cells [a, b) along a facade (tower-local cells) in world metres. */
function span(side: Side, a: number, b: number, f: TowerFrame, sill: number, head: number, kind: OfficeWindowSpan['kind']): OfficeWindowSpan {
  const M = MARGIN;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  if (side === 'N') return {x0: r((a + M) * CELL), x1: r((b + M) * CELL), z0: r((M - 1) * CELL), z1: r(M * CELL), side, sill, head, kind};
  if (side === 'S') return {x0: r((a + M) * CELL), x1: r((b + M) * CELL), z0: r((M + f.TD) * CELL), z1: r((M + f.TD + 1) * CELL), side, sill, head, kind};
  if (side === 'W') return {x0: r((M - 1) * CELL), x1: r(M * CELL), z0: r((a + M) * CELL), z1: r((b + M) * CELL), side, sill, head, kind};
  return {x0: r((M + f.TW) * CELL), x1: r((M + f.TW + 1) * CELL), z0: r((a + M) * CELL), z1: r((b + M) * CELL), side, sill, head, kind};
}

/** Fixture-less daylight sources inside the windows (after applyLighting: steady, never broken). */
export function addDaylight(layout: StationLayout, spans: readonly OfficeWindowSpan[], level: number, floor: number): number {
  const g = layout.levels[level].grid, base = layout.levels[level].baseY;
  let n = 0;
  for (const w of spans) {
    if (w.kind !== 'window') continue;
    const alongX = w.side === 'N' || w.side === 'S';
    const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
    const k = Math.max(1, Math.round(len / 2.5));
    const inward = w.side === 'N' ? 1 : w.side === 'S' ? -1 : w.side === 'W' ? 1 : -1;
    const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
    for (let i = 0; i < k; i++) {
      const t = (alongX ? w.x0 : w.z0) + len * (i + 0.5) / k;
      const x = alongX ? t : plane + inward * 0.9, z = alongX ? plane + inward * 0.9 : t;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      const ceil = g.ceil[g.idx(cx, cy)];
      const l: LightPlacement = {
        x: Math.round(x * 1000) / 1000, y: Math.round(Math.min(base + w.head - 0.12, ceil - 0.08) * 1000) / 1000, z: Math.round(z * 1000) / 1000,
        rot: alongX ? 0 : Math.PI / 2, area: g.area[g.idx(cx, cy)], broken: false, flicker: false, warm: false, power: Math.round((0.3 + 0.015 * floor) * 1000) / 1000,
        dying: false, virtual: true, tint: DAYLIGHT_TINT,
      };
      if (level) l.level = level;
      layout.lights.push(l);
      n++;
    }
  }
  return n;
}
