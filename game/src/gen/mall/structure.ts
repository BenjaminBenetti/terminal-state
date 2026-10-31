// Task track3-eaton-centre-20261031 (lane GEN): after the crop — the mall's level links, run railings, the patrol graph (lane HORDE),
// the subway root report (Track2), the void outline and the layout.mall record (MallInfo). Pure data.
// Task mall-playtest-revision-20261031 (lane GEN): station + three retail floors — per-floor atrium openings (nested outlines),
// the glass-roof polygon, walkways = court galleries + corridor wings (patrol nodes on every walkway piece), lot families on the
// shop records, per-storey wayfinding (directories / station return), MallInfo version 2.

import {CELL, FLOOR, type Grid} from '../grid';
import type {LevelLink, RailRun} from '../levels';
import type {StairFlight} from '../traversal';
import type {StationLayout} from '../stationTypes';
import type {
  MallElevator, MallInfo, MallOpening, MallPatrolNode, MallProgram, MallRect, MallShop, MallStorey, MallVerticalLink, MallWayfinding,
  SubwayRootAnchor,
} from './mallTypes';
import {CLEAR, FLOORS, ROOF, mallStoreyLabel} from './frame';
import type {CellRect, MallCarve, RunCarve} from './carve';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Canvas -> cropped-grid world metres. */
export interface Crop { ox: number; oy: number }
export const wxOf = (c: Crop, cx: number) => r3((cx - c.ox) * CELL);
export const wzOf = (c: Crop, cy: number) => r3((cy - c.oy) * CELL);
export const rectWorld = (c: Crop, r: CellRect): MallRect => ({x0: wxOf(c, r.x), z0: wzOf(c, r.y), x1: wxOf(c, r.x + r.w), z1: wzOf(c, r.y + r.h)});

// ---------------------------------------------------------------------------------------------
// Links

/** One LevelLink per public run lane (stand points of its flight) and per service-stair run. Returns ids per run lane / core run. */
export function mallLinks(mc: MallCarve, flights: readonly StairFlight[], links: LevelLink[]): {runs: number[][]; cores: number[][]} {
  const runs = mc.runs.map(rc => rc.lanes.map(ln => {
    const fl = ln.flights.map(i => flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    const id = links.length;
    links.push({id, kind: 'stairs', lower: rc.lower, upper: rc.lower + 1, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
    return id;
  }));
  const cores = mc.cores.map(cc => cc.runs.map(r => {
    const fl = r.flights.map(i => flights[i]);
    const first = fl[0], last = fl[fl.length - 1];
    const id = links.length;
    links.push({id, kind: 'stairs', lower: r.lower, upper: r.lower + 1, ramp: first.ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: first.id});
    return id;
  }));
  return {runs, cores};
}

// ---------------------------------------------------------------------------------------------
// Railings of the public runs

/**
 * Railings of every public run (world, after the crop):
 *  - the BALUSTRADES along both long edges of the bank (and between escalator lanes): on the lower storey a run following the pitch
 *    from the bottom edge to the top of the flight, on the upper storey a flat run at its floor over the whole length (the stair-
 *    well guard of the upper gallery + the top landing's balustrade);
 *  - the WELL END: a flat rail on the upper storey across the bank's bottom edge (the upper gallery looks down the well there).
 */
export function runRails(mc: MallCarve, c: Crop, flights: readonly StairFlight[]): RailRun[] {
  const out: RailRun[] = [];
  for (const rc of mc.runs) {
    const lo = rc.lower, hi = lo + 1, yLo = mc.bases[lo], yHi = mc.bases[hi];
    const q = flights[rc.lanes[0].flights[0]];
    // Pitch line along the axis: top of the flight at sTop (yHi), bottom flush with the bottom edge (yLo).
    const sTop = q.h0 >= q.h1 ? q.s0 : q.s1, sBot = q.h0 >= q.h1 ? q.s1 : q.s0;
    const r = rc.rect;
    const a0 = rc.axis === 'x' ? wzOf(c, r.y) : wxOf(c, r.x), a1 = rc.axis === 'x' ? wzOf(c, r.y + r.h) : wxOf(c, r.x + r.w);
    const e0 = rc.axis === 'x' ? wxOf(c, r.x) : wzOf(c, r.y), e1 = rc.axis === 'x' ? wxOf(c, r.x + r.w) : wzOf(c, r.y + r.h);
    const topEdge = rc.from === 'hi' ? e1 : e0, botEdge = rc.from === 'hi' ? e0 : e1;
    const lines: number[] = [a0, a1];
    if (rc.lanes.length > 1) for (let i = 1; i < rc.lanes.length; i++) lines.push(rc.axis === 'x' ? wzOf(c, rc.lanes[i].rect.y) : wxOf(c, rc.lanes[i].rect.x));
    const seg = (level: number, along: number, sA: number, yA: number, sB: number, yB: number, normal: number, hidden = false) => {
      if (Math.abs(sB - sA) < 0.05) return;
      const [s0, y0, s1, y1] = sA <= sB ? [sA, yA, sB, yB] : [sB, yB, sA, yA];
      out.push(rc.axis === 'x'
        ? {level, x0: r3(s0), z0: r3(along), x1: r3(s1), z1: r3(along), y0: r3(y0), y1: r3(y1), nx: 0, nz: normal, kind: 'railing', h: 1.0, ...(hidden ? {hidden: true} : {})}
        : {level, x0: r3(along), z0: r3(s0), x1: r3(along), z1: r3(s1), y0: r3(y0), y1: r3(y1), nx: normal, nz: 0, kind: 'railing', h: 1.0, ...(hidden ? {hidden: true} : {})});
    };
    lines.forEach((along, i) => {
      const inner = i >= 2;
      const normal = i === 1 ? 1 : -1;
      // Pitch (lower storey): bottom edge -> top of the flight; then flat to the top edge on the upper storey.
      seg(lo, along, botEdge, yLo, sTop, yHi, normal, inner);
      void sBot;
      if (inner) seg(hi, along, sTop, yHi, topEdge, yHi, normal, true);
      else seg(hi, along, botEdge, yHi, topEdge, yHi, normal);
    });
    // Well end on the upper storey (across the bottom edge).
    out.push(rc.axis === 'x'
      ? {level: hi, x0: r3(botEdge), z0: r3(a0), x1: r3(botEdge), z1: r3(a1), y0: yHi, y1: yHi, nx: rc.from === 'hi' ? -1 : 1, nz: 0, kind: 'railing', h: 1.0}
      : {level: hi, x0: r3(a0), z0: r3(botEdge), x1: r3(a1), z1: r3(botEdge), y0: yHi, y1: yHi, nx: 0, nz: rc.from === 'hi' ? -1 : 1, kind: 'railing', h: 1.0});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Void outline

/** The void cell mask's outer boundary as a closed clockwise rectilinear polygon (world metres). */
export function voidOutline(mc: MallCarve, c: Crop, W: number): {x: number; z: number}[] {
  return maskOutline(mc.voidMask, {x0: mc.vx0, y0: mc.vz0, x1: mc.vx1, y1: mc.vz1}, c, W);
}

/** A cell mask's outer boundary (inside the bbox, exclusive ends) as a closed clockwise rectilinear polygon (world metres). */
export function maskOutline(m: Uint8Array, b: {x0: number; y0: number; x1: number; y1: number}, c: Crop, W: number): {x: number; z: number}[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && m[y * W + x] === 1;
  // Start at the top-left void cell's NW corner; walk the boundary keeping the void on the right (clockwise in screen x/z).
  let sx = -1, sy = -1;
  outer: for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (at(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  const pts: {x: number; z: number}[] = [];
  // Directions: 0 = +x, 1 = +z, 2 = -x, 3 = -z (corner coordinates).
  let x = sx, y = sy, d = 0;
  const cellRight = (cx: number, cy: number, dir: number): boolean => {
    // The cell to the right of the edge leaving corner (cx, cy) in direction dir.
    if (dir === 0) return at(cx, cy);
    if (dir === 1) return at(cx - 1, cy);
    if (dir === 2) return at(cx - 1, cy - 1);
    return at(cx, cy - 1);
  };
  const cellLeft = (cx: number, cy: number, dir: number): boolean => {
    if (dir === 0) return at(cx, cy - 1);
    if (dir === 1) return at(cx, cy);
    if (dir === 2) return at(cx - 1, cy);
    return at(cx - 1, cy - 1);
  };
  const step = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let guard = 0; guard < 100000; guard++) {
    // Prefer turning left (outer boundary, void on the right), then straight, then right.
    let nd = d;
    for (const t of [3, 0, 1, 2]) {
      const q = (d + t) % 4;
      if (cellRight(x, y, q) && !cellLeft(x, y, q)) { nd = q; break; }
    }
    if (nd !== d || !pts.length) pts.push({x: wxOf(c, x), z: wzOf(c, y)});
    d = nd;
    x += step[d][0]; y += step[d][1];
    if (x === sx && y === sy) break;
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Patrol graph (lane HORDE)

const walkableAt = (g: Grid, x: number, z: number, y: number): boolean => {
  const [cx, cy] = g.cellOf(x, z);
  if (!g.inBounds(cx, cy)) return false;
  const i = g.idx(cx, cy);
  return g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && Math.abs(g.floorOf(i) - y) < 0.05;
};
/** A straight walk on one storey's flat floor (every 0.25 m: a walkable, prop-free flat cell at the storey height). */
export function walkLine(g: Grid, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
  for (let k = 0; k <= n; k++) if (!walkableAt(g, ax + (bx - ax) * k / n, az + (bz - az) * k / n, y)) return false;
  return true;
}

/**
 * Walking distance (cells) on ONE storey's flat floor (FLOOR, prop-free, no ramp, at the storey height) from a point, up to
 * `max` cells: the patrol graph's edge test (a gallery leg must really be walkable around props / wells, not just in sight).
 */
function storeyReach(g: Grid, x: number, z: number, y: number, max: number): Map<number, number> {
  const out = new Map<number, number>();
  const [sx, sy] = g.cellOf(x, z);
  if (!g.inBounds(sx, sy)) return out;
  const ok = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && Math.abs(g.floorOf(i) - y) < 0.05;
  const s0 = g.idx(sx, sy);
  if (!ok(s0)) return out;
  out.set(s0, 0);
  const q = [s0];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], d = out.get(c)!;
    if (d >= max) continue;
    const cx = c % g.w;
    for (const j of [cx > 0 ? c - 1 : -1, cx < g.w - 1 ? c + 1 : -1, c - g.w, c + g.w]) {
      if (j < 0 || j >= g.cells.length || out.has(j) || !ok(j)) continue;
      out.set(j, d + 1);
      q.push(j);
    }
  }
  return out;
}

/**
 * Patrol nodes on EVERY public walkway of every storey — the court galleries around the openings, the corridor wings / branches /
 * loops / second courts (a node every ~8 m along each walkway piece's centre line, snapped to clear floor), the Fountain court on
 * the station storey, and both mouths of every public run; edges are verified walks on one storey (the walk around props / wells
 * stays short: <= 1.6x straight + 3 m) or the run itself (escalator / stair between its mouth nodes).
 */
export function patrolGraph(layout: StationLayout, mc: MallCarve, c: Crop, flights: readonly StairFlight[]): MallPatrolNode[] {
  type N = {id: number; level: number; x: number; z: number; edges: {to: number; via?: 'escalator' | 'stair' | 'bridge' | 'gallery' | 'service'}[]};
  const nodes: N[] = [];
  const add = (level: number, x: number, z: number): N => { const n: N = {id: nodes.length, level, x: r3(x), z: r3(z), edges: []}; nodes.push(n); return n; };
  const link = (a: N, b: N, via: N['edges'][number]['via']) => {
    if (a === b || a.edges.some(e => e.to === b.id)) return;
    a.edges.push({to: b.id, via}); b.edges.push({to: a.id, via});
  };
  const near = (g: Grid, x: number, z: number, y: number): [number, number] | null => {
    for (let r = 0; r <= 8; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const px = x + ox * CELL, pz = z + oy * CELL;
      if (walkableAt(g, px, pz, y) && g.circleClear(px, pz, 0.4)) return [px, pz];
    }
    return null;
  };
  const perLevel = new Map<number, N[]>();
  const put = (lv: number, x: number, z: number): N | null => {
    const g = layout.levels[lv].grid, y = mc.bases[lv];
    const p = near(g, x, z, y);
    if (!p) return null;
    const list = perLevel.get(lv) ?? [];
    const dup = list.find(o => Math.hypot(o.x - p[0], o.z - p[1]) < 3);
    if (dup) return dup;
    const n = add(lv, p[0], p[1]);
    list.push(n); perLevel.set(lv, list);
    return n;
  };
  // Sample lines: per walkway piece a centre line along its long axis (the court: two lines beside the opening + two across).
  const lines: {lv: number; pts: [number, number][]}[] = [];
  const span = (a: number, b: number, n: number) => Array.from({length: n + 1}, (_, i) => a + (b - a) * i / n);
  const lineOf = (lv: number, ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 8));
    lines.push({lv, pts: span(0, 1, n).map(t => [ax + (bx - ax) * t, az + (bz - az) * t] as [number, number])});
  };
  for (let lv = 1; lv <= FLOORS; lv++) {
    for (const w of mc.sk.walks) {
      if (!w.floors.includes(lv)) continue;
      const r = w.rect, x0 = wxOf(c, r.x) + 1.2, x1 = wxOf(c, r.x + r.w) - 1.2, z0 = wzOf(c, r.y) + 1.2, z1 = wzOf(c, r.y + r.h) - 1.2;
      if (w.zone === 'court') {
        // a loop around the court (inside its rim walkways)
        lineOf(lv, x0 + 1, z0 + 1, x1 - 1, z0 + 1); lineOf(lv, x1 - 1, z0 + 1, x1 - 1, z1 - 1);
        lineOf(lv, x1 - 1, z1 - 1, x0 + 1, z1 - 1); lineOf(lv, x0 + 1, z1 - 1, x0 + 1, z0 + 1);
      } else if (r.w >= r.h) lineOf(lv, x0, (z0 + z1) / 2, x1, (z0 + z1) / 2);
      else lineOf(lv, (x0 + x1) / 2, z0, (x0 + x1) / 2, z1);
    }
  }
  {
    const r = mc.sk.court0;
    lineOf(0, wxOf(c, r.x) + 1.5, wzOf(c, r.y) + 2.0, wxOf(c, r.x + r.w) - 1.5, wzOf(c, r.y) + 2.0);
  }
  for (const L of lines) {
    const g = layout.levels[L.lv].grid, y = mc.bases[L.lv];
    let prev: N | null = null;
    for (const [px, pz] of L.pts) {
      const n = put(L.lv, px, pz);
      if (!n) { prev = null; continue; }
      if (prev && prev !== n) {
        const straight = Math.hypot(prev.x - n.x, prev.z - n.z) / CELL;
        const reach = storeyReach(g, prev.x, prev.z, y, Math.ceil(straight * 1.6 + 6));
        const [bx, by] = g.cellOf(n.x, n.z);
        if (reach.has(g.idx(bx, by))) link(prev, n, 'gallery');
      }
      prev = n;
    }
  }
  // Join every node to its nearest walkable neighbours on the storey (walkway pieces meeting at a corner / a wing mouth).
  for (const [lv, list] of perLevel) {
    const g = layout.levels[lv].grid, y = mc.bases[lv];
    for (const n of list) {
      const reach = storeyReach(g, n.x, n.z, y, 30);
      const cands = list.filter(o => o !== n && !n.edges.some(e => e.to === o.id)).map(o => ({o, d: reach.get(g.idx(...g.cellOf(o.x, o.z))) ?? Infinity}))
        .filter(e => e.d < Infinity).sort((p, q) => p.d - q.d);
      for (const e of cands.slice(0, 2)) link(n, e.o, 'gallery');
    }
  }
  const attach = (n: N, via: N['edges'][number]['via']) => {
    const g = layout.levels[n.level].grid, y = mc.bases[n.level];
    const reach = storeyReach(g, n.x, n.z, y, 80);
    const cands = (perLevel.get(n.level) ?? []).filter(o => o !== n).map(o => ({o, d: reach.get(g.idx(...g.cellOf(o.x, o.z))) ?? Infinity}))
      .filter(e => e.d < Infinity).sort((p, q) => p.d - q.d);
    for (const e of cands.slice(0, 2)) link(n, e.o, via);
  };
  // Public runs: a node 1.5 m beyond each mouth; the run edge between them.
  for (const rc of mc.runs) {
    const lanes = rc.lanes.map(ln => flights[ln.flights[0]]);
    const q = lanes[0];
    const bot = q.bottom, top = q.top;
    const dir = Math.sign((rc.axis === 'x' ? top.x - bot.x : top.z - bot.z)) || 1;
    const ac = lanes.reduce((sum, f) => sum + (f.a0 + f.a1) / 2, 0) / lanes.length;
    const P = (v: number) => (rc.axis === 'x' ? [v, ac] : [ac, v]) as [number, number];
    const sb = (rc.axis === 'x' ? bot.x : bot.z) - dir * 1.5, st = (rc.axis === 'x' ? top.x : top.z) + dir * 1.5;
    const gb = layout.levels[rc.lower].grid, gt = layout.levels[rc.lower + 1].grid;
    const pb = near(gb, ...P(sb), mc.bases[rc.lower]), pt = near(gt, ...P(st), mc.bases[rc.lower + 1]);
    if (!pb || !pt) continue;
    const nb = add(rc.lower, pb[0], pb[1]), nt = add(rc.lower + 1, pt[0], pt[1]);
    link(nb, nt, rc.kind === 'escalator' ? 'escalator' : 'stair');
    attach(nb, 'gallery'); attach(nt, 'gallery');
  }
  // Drop isolated nodes and re-index.
  const keep = nodes.filter(n => n.edges.length > 0);
  const remap = new Map(keep.map((n, i) => [n.id, i]));
  return keep.map((n, i) => ({id: i, level: n.level, x: n.x, z: n.z, edges: n.edges.filter(e => remap.has(e.to)).map(e => ({to: remap.get(e.to)!, via: e.via}))}));
}

// ---------------------------------------------------------------------------------------------
// The record

/** Placeholder program mix (lane SHOPS assigns the final mix / brands / purposes over layout.mall.shops). */
const PLACEHOLDER_PROGRAMS: readonly MallProgram[] = [
  'clothing', 'electronics', 'pharmacy', 'shoes', 'hardware', 'cafe', 'books', 'sports', 'phone', 'outdoors', 'toys', 'jewelry',
  'home', 'beauty', 'music', 'grocery', 'guns', 'optical', 'pet', 'luggage', 'clinic', 'arcade', 'florist',
];

const areaCells = (layout: StationLayout, id: number, level: number): number => {
  const a = layout.areas[id], g = layout.levels[level].grid;
  let n = 0;
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] === a.id && g.cells[g.idx(x, y)] === FLOOR) n++;
  return n;
};

export function mallInfo(layout: StationLayout, mc: MallCarve, c: Crop, _flights: readonly StairFlight[], linkIds: {runs: number[][]; cores: number[][]},
  start: {x: number; z: number; yaw: number; level: number}): MallInfo {
  const storeys: MallStorey[] = mc.bases.map((y, level) => ({level, label: mallStoreyLabel(level), baseY: y, clear: level ? CLEAR.gallery : CLEAR.court, role: level ? 'ring' : 'station'}));
  const shops: MallShop[] = mc.shops.map((s, i) => {
    const alongX = s.side === 'N' || s.side === 'S';
    const along = alongX ? s.rect.w : s.rect.h, deep = alongX ? s.rect.h : s.rect.w;
    const program: MallProgram = s.kind === 'anchor' ? 'department' : s.kind === 'food' ? 'food-court' : s.kind === 'kiosk' ? 'kiosk' : PLACEHOLDER_PROGRAMS[(i * 7 + s.level * 3) % PLACEHOLDER_PROGRAMS.length];
    const fronts = s.fronts.map(q => ({...rectWorld(c, q.rect), side: q.side}));
    return {
      id: s.id, area: s.sales, ...(s.back !== undefined ? {backroom: s.back} : {}), level: s.level, program, kind: s.kind, brand: `Unit ${s.id}`,
      frontage: fronts[0], salesArea: areaCells(layout, s.sales, s.level) * CELL * CELL, depth: deep * CELL, width: along * CELL,
      lot: s.lot, zone: s.zone, frontages: fronts, stock: s.stock, stockArea: s.back !== undefined ? areaCells(layout, s.back, s.level) * CELL * CELL : 0,
      serviceDoor: false, ...(s.recess !== undefined ? {recess: s.recess} : {}),
    };
  });
  const verticals: MallVerticalLink[] = [];
  mc.runs.forEach((rc, ri) => rc.lanes.forEach((_, li) => {
    const k = layout.levelLinks[linkIds.runs[ri][li]];
    verticals.push({kind: rc.kind, lower: rc.lower, upper: rc.lower + 1, link: k.id, foot: {...k.bottom}, head: {...k.top}});
  }));
  mc.cores.forEach((cc, ci) => cc.runs.forEach((_, ri) => {
    const k = layout.levelLinks[linkIds.cores[ci][ri]];
    verticals.push({kind: 'service-stair', lower: k.lower, upper: k.upper, link: k.id, foot: {...k.bottom}, head: {...k.top}});
  }));
  const elevators: MallElevator[] = mc.elevators.map((e, i) => {
    const stops = mc.bases.map((y, level) => ({level, y}));
    const land = rectWorld(c, e.landing);
    const lx = (land.x0 + land.x1) / 2, lz = (land.z0 + land.z1) / 2;
    verticals.push({kind: 'elevator', lower: 0, upper: FLOORS, link: i, foot: {x: lx, y: 0, z: lz}, head: {x: lx, y: mc.bases[FLOORS], z: lz}});
    return {cab: rectWorld(c, e.cab), shaft: rectWorld(c, e.shaft), stops, glass: true};
  });
  const vb: MallRect = {x0: wxOf(c, mc.vx0), z0: wzOf(c, mc.vz0), x1: wxOf(c, mc.vx1), z1: wzOf(c, mc.vz1)};
  const outline = voidOutline(mc, c, mc.cw);
  const openings: MallOpening[] = [];
  for (let lv = 1; lv <= FLOORS; lv++) {
    const b = mc.sk.openBox[lv];
    let cells = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (mc.sk.open[lv][y * mc.cw + x]) cells++;
    openings.push({level: lv, outline: maskOutline(mc.sk.open[lv], b, c, mc.cw), bounds: {x0: wxOf(c, b.x0), z0: wzOf(c, b.y0), x1: wxOf(c, b.x1), z1: wzOf(c, b.y1)}, area: cells * CELL * CELL});
  }
  const top = openings[openings.length - 1];
  const per = (m: Map<number, number[]>) => [...m].map(([level, areas]) => ({level, areas: [...areas]}));
  const info: MallInfo = {
    version: 2, variant: mc.f.variant, name: mc.f.name, storeys,
    void: {
      outline, bounds: vb, openings, openLevels: Array.from({length: FLOORS}, (_, i) => i + 1), floorLevel: 0, roofSpringY: mc.roof.springY, roofApexY: mc.roof.apexY,
    },
    galleries: per(mc.galleries), courts: per(mc.courts), corridors: per(mc.corridors), service: [{level: 0, areas: mc.stationBoh.filter(id => layout.areas[id]?.type === 'service-corridor')}],
    shops, bridges: [], verticals, elevators,
    roof: {outline: {...top.bounds}, polygon: top.outline, springY: mc.roof.springY, apexY: mc.roof.apexY, archSpacing: ROOF.archSpacing},
    patrol: [],
    subwayRoot: subwayRoot(layout, mc, c),
    start: {...start},
  };
  info.wayfinding = mallWayfinding(info);
  return info;
}

/**
 * Directory / level-sign data per storey: the shops on it, every vertical link leaving it (stand point on this storey) and the public
 * way back down to the station from its atrium court — one step per storey (an escalator going down when there is one, else a
 * public stair, else the elevator).
 */
export function mallWayfinding(info: Pick<MallInfo, 'storeys' | 'shops' | 'verticals'>): MallWayfinding[] {
  const out: MallWayfinding[] = [];
  const at = (v: MallVerticalLink, lv: number) => (v.lower === lv ? {x: v.foot.x, z: v.foot.z} : {x: v.head.x, z: v.head.z});
  for (const st of info.storeys) {
    const lv = st.level;
    const links = info.verticals.map((v, i) => ({v, i})).filter(({v}) => v.lower === lv || v.upper === lv || (v.kind === 'elevator' && v.lower <= lv && v.upper >= lv))
      .map(({v, i}) => ({kind: v.kind, to: v.kind === 'elevator' ? (lv === v.lower ? v.upper : v.lower) : v.lower === lv ? v.upper : v.lower, at: v.kind === 'elevator' ? {x: v.foot.x, z: v.foot.z} : at(v, lv), vertical: i}));
    const ret: MallWayfinding['stationReturn'][number][] = [];
    for (let from = lv; from > 0; from--) {
      const cands = info.verticals.map((v, i) => ({v, i})).filter(({v}) => v.upper === from && v.lower === from - 1 && (v.kind === 'escalator' || v.kind === 'stair'));
      const pick = cands.find(q => q.v.kind === 'escalator') ?? cands[0];
      if (pick) ret.push({kind: pick.v.kind, from, to: from - 1, at: {x: pick.v.head.x, z: pick.v.head.z}, vertical: pick.i});
      else {
        const e = info.verticals.findIndex(v => v.kind === 'elevator');
        if (e >= 0) ret.push({kind: 'elevator', from, to: 0, at: {x: info.verticals[e].foot.x, z: info.verticals[e].foot.z}, vertical: e});
        break;
      }
    }
    out.push({level: lv, label: st.label, shops: info.shops.filter(s => s.level === lv).map(s => s.id), links, stationReturn: ret});
  }
  return out;
}

/** Track2 report (DERIVED, read-only): the pit station's trench ends as tunnel mouths, its platforms, the keep-clear volumes. */
export function subwayRoot(layout: StationLayout, mc: MallCarve, c: Crop): SubwayRootAnchor {
  const mouths: SubwayRootAnchor['tunnelMouths'][number][] = [];
  layout.trenches.forEach((t, i) => {
    const z = r3((t.z0 + t.z1) / 2), width = r3(t.z1 - t.z0), height = r3(t.ceil - t.floorY);
    mouths.push({id: `bed${i}-x0`, x: t.x0, z, width, height, axis: 'x-', trackBed: i});
    mouths.push({id: `bed${i}-x1`, x: t.x1, z, width, height, axis: 'x+', trackBed: i});
  });
  const b3 = mc.sk.openBox[FLOORS];
  const keep: MallRect[] = [{x0: wxOf(c, b3.x0), z0: wzOf(c, b3.y0), x1: wxOf(c, b3.x1), z1: wzOf(c, b3.y1)}, rectWorld(c, mc.sk.court0)];
  for (const rc of mc.runs.filter(r => r.lower === 0)) keep.push(rectWorld(c, rc.rect));
  for (const e of mc.elevators) keep.push(rectWorld(c, e.shaft));
  return {level: 'mall', storey: 0, platformY: 0, trackBedY: layout.trench.floorY, platforms: [...layout.platforms], tunnelMouths: mouths, keepClear: keep};
}

/** Clear arrival zones (grid cells per level) in front of every run mouth and elevator landing — held empty while dressing. */
export function mouthHolds(layout: StationLayout, mc: MallCarve, c: Crop): {level: number; cells: number[]}[] {
  const out: {level: number; cells: number[]}[] = [];
  const hold = (level: number, r: CellRect) => {
    const g = layout.levels[level].grid, cells: number[] = [];
    for (let y = r.y - c.oy; y < r.y + r.h - c.oy; y++) for (let x = r.x - c.ox; x < r.x + r.w - c.ox; x++) if (g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR) cells.push(g.idx(x, y));
    out.push({level, cells});
  };
  const D = 6; // 3 m in front of a mouth
  const mouthRect = (rc: RunCarve, end: 'lo' | 'hi'): CellRect => rc.axis === 'x'
    ? (end === 'lo' ? {x: rc.rect.x - D, y: rc.rect.y - 1, w: D, h: rc.rect.h + 2} : {x: rc.rect.x + rc.rect.w, y: rc.rect.y - 1, w: D, h: rc.rect.h + 2})
    : (end === 'lo' ? {x: rc.rect.x - 1, y: rc.rect.y - D, w: rc.rect.w + 2, h: D} : {x: rc.rect.x - 1, y: rc.rect.y + rc.rect.h, w: rc.rect.w + 2, h: D});
  for (const rc of mc.runs) {
    const topEnd = rc.from, botEnd = rc.from === 'hi' ? 'lo' : 'hi';
    hold(rc.lower, mouthRect(rc, botEnd));
    hold(rc.lower + 1, mouthRect(rc, topEnd));
    // The run itself on both storeys (never dressed).
    hold(rc.lower, rc.rect); hold(rc.lower + 1, rc.rect);
    // The rest of the strip beside the run on the upper storey (the well's rim).
  }
  for (const e of mc.elevators) for (let lv = 0; lv <= FLOORS; lv++) hold(lv, e.landing);
  // the service-stair landings' doors (3 m in front, every storey)
  for (const cc of mc.cores) {
    const north = cc.well.y < mc.sk.court.y;
    for (let lv = 0; lv <= FLOORS; lv++) for (const lx of [cc.well.x, cc.well.x + cc.well.w - 3]) {
      hold(lv, north ? {x: lx - 1, y: cc.well.y + cc.well.h + 1, w: 5, h: 5} : {x: lx - 1, y: cc.well.y - 6, w: 5, h: 5});
    }
  }
  return out;
}
