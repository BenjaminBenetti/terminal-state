// Task studio-skywalk-encounters-20261108-074144-01 (user: "I want to have at least 1 random zombie hoard spawn on this map (just like the
// mall hoard)"): the Skyways PATROL GRAPH the Mall's roaming hordes walk (ai/hordePlace.ts placeHordes / ai/horde.ts HordeDirector read
// the same MallPatrolNode shape). Pure, deterministic, RNG-free; layout version 5 only (gen/skyways/index.ts).
//
// Nodes: on the PUBLIC walkways of the street and skyway storeys (areas of kind 'concourse' / 'passage' — the street concourses and
// lobbies, the skyway concourses, retail arcades and bridge decks; never a stair core, a shop, a room or the station storey with its
// platforms and the train), a lattice point every ~8 m of each walkway area, snapped to clear prop-free floor of THAT area at the
// storey height. Edges: a verified walk on the storey's flat floor (<= 1.6 x straight + 3 m round props / wells) to the nearest few
// neighbours, and the stair runs between the street and skyway storeys (a node beyond each end of a flight, edge 'stair'). Isolated
// nodes are dropped; the graph is re-indexed 0..n-1.

import {CELL, FLOOR, type Grid} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {MallPatrolNode} from '../mall/mallTypes';

/** The storeys a Skyways horde may roam (1 = street, 2 = skyway; never the station storey 0 with the train). */
export const SKYWAYS_PATROL_STOREYS: readonly number[] = [1, 2];
/** Lattice spacing of the walkway nodes (m). */
const STEP_M = 8;
/** Walkway area kinds (public circulation). */
const WALK_KINDS: ReadonlySet<string> = new Set(['concourse', 'passage']);
/** Walkway area types never patrolled (stair cores are vertical circulation, never a place to stand). */
const SKIP_TYPES: ReadonlySet<string> = new Set(['stair-core']);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

type N = {id: number; level: number; x: number; z: number; edges: {to: number; via?: 'stair' | 'gallery'}[]};

/** The storey's flat, prop-free walking floor at height `y`. */
function okCell(g: Grid, i: number, y: number): boolean {
  return g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && Math.abs(g.floorOf(i) - y) < 0.05;
}

/** Walking distance (cells) on one storey's flat floor from a point, up to `max` cells. */
function reach(g: Grid, x: number, z: number, y: number, max: number): Map<number, number> {
  const out = new Map<number, number>();
  const [sx, sy] = g.cellOf(x, z);
  if (!g.inBounds(sx, sy) || !okCell(g, g.idx(sx, sy), y)) return out;
  const s0 = g.idx(sx, sy);
  out.set(s0, 0);
  const q = [s0];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], d = out.get(c)!;
    if (d >= max) continue;
    const cx = c % g.w;
    for (const j of [cx > 0 ? c - 1 : -1, cx < g.w - 1 ? c + 1 : -1, c - g.w, c + g.w]) {
      if (j < 0 || j >= g.cells.length || out.has(j) || !okCell(g, j, y)) continue;
      out.set(j, d + 1);
      q.push(j);
    }
  }
  return out;
}

/** The nearest clear standing point (0.4 m disc) of `area` (or any walkway, area -1) to (x, z) within 8 cells; null: none. */
function snap(g: Grid, x: number, z: number, y: number, area: number): [number, number] | null {
  const [cx, cy] = g.cellOf(x, z);
  for (let r = 0; r <= 8; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
    const px = cx + ox, py = cy + oy;
    if (!g.inBounds(px, py)) continue;
    const i = g.idx(px, py);
    if (!okCell(g, i, y) || (area >= 0 && g.area[i] !== area)) continue;
    const [wx, wz] = g.center(px, py);
    if (g.circleClear(wx, wz, 0.4)) return [wx, wz];
  }
  return null;
}

/** The Skyways patrol graph (version 5): walkway lattice nodes of the street / skyway storeys + their stair runs. */
export function skywaysPatrolGraph(layout: StationLayout): MallPatrolNode[] {
  const nodes: N[] = [];
  const perLevel = new Map<number, N[]>();
  const link = (a: N, b: N, via: 'stair' | 'gallery') => {
    if (a === b || a.edges.some(e => e.to === b.id)) return;
    a.edges.push({to: b.id, via}); b.edges.push({to: a.id, via});
  };
  const put = (lv: number, x: number, z: number): N => {
    const n: N = {id: nodes.length, level: lv, x: r3(x), z: r3(z), edges: []};
    nodes.push(n);
    const l = perLevel.get(lv) ?? [];
    l.push(n); perLevel.set(lv, l);
    return n;
  };
  // walkway lattice
  for (const lv of SKYWAYS_PATROL_STOREYS) {
    const L = layout.levels[lv];
    if (!L) continue;
    const g = L.grid, y = L.baseY, step = Math.max(1, Math.round(STEP_M / CELL));
    for (const a of layout.areas) {
      if ((a.level ?? 0) !== lv || !WALK_KINDS.has(a.kind) || SKIP_TYPES.has(a.type)) continue;
      const nx = Math.max(1, Math.round(a.w / step)), ny = Math.max(1, Math.round(a.h / step));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [wx, wz] = g.center(a.x + Math.floor((i + 0.5) * a.w / nx), a.y + Math.floor((j + 0.5) * a.h / ny));
        const p = snap(g, wx, wz, y, a.id);
        if (!p) continue;
        const list = perLevel.get(lv) ?? [];
        if (list.some(o => Math.hypot(o.x - p[0], o.z - p[1]) < STEP_M * 0.45)) continue;
        put(lv, p[0], p[1]);
      }
    }
  }
  // same-storey edges: the nearest neighbours a real walk reaches (round props / wells: <= 1.6 x straight + 3 m)
  for (const [lv, list] of perLevel) {
    const L = layout.levels[lv], g = L.grid, y = L.baseY;
    for (const n of list) {
      const rr = reach(g, n.x, n.z, y, Math.ceil(STEP_M * 2.2 / CELL));
      const cands = list.filter(o => o !== n).map(o => {
        const d = rr.get(g.idx(...g.cellOf(o.x, o.z)));
        const straight = Math.hypot(o.x - n.x, o.z - n.z);
        return {o, d: d === undefined || d * CELL > straight * 1.6 + 3 ? Infinity : d};
      }).filter(e => e.d < Infinity).sort((p, q) => p.d - q.d || p.o.id - q.o.id);
      for (const e of cands.slice(0, 3)) link(n, e.o, 'gallery');
    }
  }
  // stair runs between the patrolled storeys: a node 1.5 m beyond each end of a flight, joined to its storey's nearest nodes
  const attach = (n: N) => {
    const L = layout.levels[n.level], g = L.grid, rr = reach(g, n.x, n.z, L.baseY, 60);
    const cands = (perLevel.get(n.level) ?? []).filter(o => o !== n).map(o => ({o, d: rr.get(g.idx(...g.cellOf(o.x, o.z))) ?? Infinity}))
      .filter(e => e.d < Infinity).sort((p, q) => p.d - q.d || p.o.id - q.o.id);
    for (const e of cands.slice(0, 2)) link(n, e.o, 'gallery');
  };
  for (const k of layout.levelLinks) {
    if (k.kind !== 'stairs' || !SKYWAYS_PATROL_STOREYS.includes(k.lower) || !SKYWAYS_PATROL_STOREYS.includes(k.upper)) continue;
    const lo = layout.levels[k.lower], hi = layout.levels[k.upper];
    const dx = k.top.x - k.bottom.x, dz = k.top.z - k.bottom.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const pb = snap(lo.grid, k.bottom.x - ux * 1.5, k.bottom.z - uz * 1.5, lo.baseY, -1);
    const pt = snap(hi.grid, k.top.x + ux * 1.5, k.top.z + uz * 1.5, hi.baseY, -1);
    if (!pb || !pt) continue;
    const nb = put(k.lower, pb[0], pb[1]), nt = put(k.upper, pt[0], pt[1]);
    link(nb, nt, 'stair');
    attach(nb); attach(nt);
  }
  const keep = nodes.filter(n => n.edges.length > 0);
  const remap = new Map(keep.map((n, i) => [n.id, i]));
  return keep.map((n, i) => ({id: i, level: n.level, x: n.x, z: n.z, edges: n.edges.filter(e => remap.has(e.to)).map(e => ({to: remap.get(e.to)!, via: e.via}))}));
}
