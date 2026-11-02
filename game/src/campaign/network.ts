// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): the CAMPAIGN NETWORK generator — a seeded, subway-like
// branching network of 40 stations (contract: campaign/types.ts) laid out like a transit diagram — and its validator.
//
// Layout: stations stand on the points of an integer grid (GRID: 28 x 16 units, 3.5 map units each) and every track edge is ONE
// straight horizontal / vertical / 45-degree segment of 2..4 grid steps, so the drawing is octilinear by construction. An occupancy
// model keeps it planar and spaced:
//  - two stations are never 8-adjacent (Chebyshev distance >= 2);
//  - a grid point inside an edge (a track point) is never reused, never a station, and has no foreign station next to it;
//  - a unit link is used once; two diagonal unit links never cross inside one grid cell.
// Lines therefore only meet AT stations (interchanges): no track crosses another track or passes through a station dot.
//
// Construction (per attempt, every draw from a seeded Rng):
//  1. trunk lines — the first through the city centre (mostly horizontal: the paper is landscape), the second crossing it near the
//     centre, the third (and a fourth when there is no ring) on the remaining axes; each is two scored random walks out of its
//     anchor (straight preferred, 45-degree jogs, wider spacing in the suburbs, a pull towards stations of lines it has not met yet);
//  2. on about half of the seeds a RING (loop line) routed by A* through gate stations of the trunk lines around the centre;
//  3. one or two branches diverging at 45 degrees from a trunk line's outer part;
//  4. termini extend (or another branch grows) until exactly 39 + 1 stations stand.
// An attempt is accepted when it meets the quality floor (counts, >= 3 lines, >= 2 interchanges, a branch, a reactor depth >= 4,
// a cycle on the seeds that want one); otherwise the next attempt (a fresh sub-seed) runs; a fixed grid layout is the last resort.
// Then: the start (a non-interchange Subway station with a deep eccentricity), the ONE Reactor (graph distance 5..8 when the graph
// allows, >= 4 always; termini down-weighted so it is not always the end of a line), Office / Mall nodes (largest remainder of the
// ordinary weights), printed names (an original fictional pool; suffixes by role), ids `st-00` (the start) .. in BFS order, and
// every node's levelSeed = hashNodeSeed(network seed, id). Pure: no DOM, no clock, no Math.random.

import type {LevelId} from '../levels/types';
import {Rng, hashString} from '../core/rng';
import {NETWORK_SIZE, ORDINARY_WEIGHTS, type NetworkLine, type StationId, type StationNode, type SubwayNetwork} from './types';

/** The layout grid: points 0..w x 0..h; one grid unit = `unit` map units (so x spans 0..98, y 0..56). */
export const GRID = {w: 28, h: 16, unit: 3.5} as const;
/** The Reactor is never closer than this many hops to the start. */
export const MIN_REACTOR_DEPTH = 4;
/** The preferred Reactor depth window (used whenever the graph has stations that deep). */
export const REACTOR_DEPTH = {lo: 5, hi: 8} as const;

export type OrdinaryArchetype = Exclude<LevelId, 'reactor'>;
export type OrdinaryWeights = Readonly<Partial<Record<OrdinaryArchetype, number>>>;

export interface NetworkOptions {
  /** Ordinary archetype weights (default ORDINARY_WEIGHTS 80 / 10 / 10; a future archetype takes a share here). */
  weights?: OrdinaryWeights;
}

const ARCHETYPES: readonly LevelId[] = ['subway', 'office', 'mall', 'reactor'];

/** In-world wording of an archetype (map details, HUD). */
export function archetypeLabel(a: LevelId): string {
  switch (a) {
    case 'subway': return 'Subway station';
    case 'office': return 'Office tower';
    case 'mall': return 'Shopping mall';
    case 'reactor': return 'Reactor';
  }
  return 'Station';
}

/** A node's world seed: a dedicated hash of (network seed, station id) — never a level's internal PRNG. */
export function hashNodeSeed(networkSeed: number, id: StationId): number {
  let h = hashString(`terminal-state:station-seed:${id}`, (networkSeed ^ 0x85ebca6b) >>> 0);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Largest-remainder counts of `total` ordinary stations by weight (ties: the weights' key order). Subway must get >= 1 (the start). */
export function ordinaryCounts(weights: OrdinaryWeights = ORDINARY_WEIGHTS, total: number = NETWORK_SIZE.ordinary): Record<string, number> {
  const keys = Object.keys(weights).filter(k => (weights as Record<string, number>)[k] > 0);
  const sum = keys.reduce((s, k) => s + (weights as Record<string, number>)[k], 0);
  const out: Record<string, number> = {};
  if (!(sum > 0)) return out;
  const rem: {k: string; r: number; i: number}[] = [];
  let given = 0;
  keys.forEach((k, i) => {
    const exact = (total * (weights as Record<string, number>)[k]) / sum;
    out[k] = Math.floor(exact);
    given += out[k];
    rem.push({k, r: exact - out[k], i});
  });
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let i = 0; given < total; i++, given++) out[rem[i % rem.length].k]++;
  return out;
}

// --- the grid builder -----------------------------------------------------------------------------------------------------

const PW = GRID.w + 1, PH = GRID.h + 1, NP = PW * PH;
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1]; // 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (y down)
const EMPTY = -1, TRACK = -2;
const CX = GRID.w / 2, CY = GRID.h / 2;

const dirDist = (a: number, b: number) => { const d = Math.abs(a - b) % 8; return d > 4 ? 8 - d : d; };
const dirOf = (dx: number, dy: number) => DX.findIndex((x, i) => x === Math.sign(dx) && DY[i] === Math.sign(dy));
const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x <= GRID.w && y <= GRID.h;
/** Normalised elliptical radius from the centre (0 centre .. ~1 at the grid's edge midpoints). */
const radius = (x: number, y: number) => Math.hypot((x - CX) / CX, (y - CY) / CY);

type LineKind = 'trunk' | 'ring' | 'branch';
interface BLine { kind: LineKind; stations: number[]; loop: boolean; parent: number; anchor: number }
interface BStation { x: number; y: number }
interface Step { d: number; k: number; t: number; join: number }

class Board {
  cell = new Int16Array(NP).fill(EMPTY);
  links = new Set<number>();
  diag = new Uint8Array(GRID.w * GRID.h);
  st: BStation[] = [];
  adj: number[][] = [];
  lines: BLine[] = [];
  budget = 0;

  clone(): Board {
    const b = new Board();
    b.cell = this.cell.slice();
    b.links = new Set(this.links);
    b.diag = this.diag.slice();
    b.st = this.st.map(s => ({...s}));
    b.adj = this.adj.map(a => a.slice());
    b.lines = this.lines.map(l => ({...l, stations: l.stations.slice()}));
    b.budget = this.budget;
    return b;
  }

  restore(b: Board): void {
    this.cell = b.cell; this.links = b.links; this.diag = b.diag; this.st = b.st; this.adj = b.adj; this.lines = b.lines; this.budget = b.budget;
  }

  stationAt(x: number, y: number): number { const c = this.cell[y * PW + x]; return c >= 0 ? c : -1; }

  addStation(x: number, y: number): number {
    const i = this.st.length;
    this.st.push({x, y});
    this.adj.push([]);
    this.cell[y * PW + x] = i;
    this.budget--;
    return i;
  }

  linesOf(s: number): number[] { const out: number[] = []; this.lines.forEach((l, i) => { if (l.stations.includes(s)) out.push(i); }); return out; }

  /** Any station in the 8-neighbourhood of (x, y) other than `a` / `b`. */
  stationNear(x: number, y: number, a: number, b: number): boolean {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (!inGrid(nx, ny)) continue;
      const c = this.cell[ny * PW + nx];
      if (c >= 0 && c !== a && c !== b) return true;
    }
    return false;
  }

  /** Any station or track point in the 8-neighbourhood of (x, y). */
  occupiedNear(x: number, y: number): boolean {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox, ny = y + oy;
      if (inGrid(nx, ny) && this.cell[ny * PW + nx] !== EMPTY) return true;
    }
    return false;
  }

  /**
   * One edge from the point (x, y) (the station `s`, or -1 for a hypothetical one during a route search) in direction d over k grid
   * steps. The target is a new station (an empty, unhemmed point) or — with `join` — an existing station `j` (not `s`, not already
   * on the line unless `close` names it, no edge s-j yet). Null when the occupancy rules forbid it.
   */
  step(x: number, y: number, s: number, d: number, k: number, line: BLine | null, join: boolean, close = -1): Step | null {
    const tx = x + DX[d] * k, ty = y + DY[d] * k;
    if (!inGrid(tx, ty)) return null;
    const tc = this.cell[ty * PW + tx];
    if (tc === TRACK) return null;
    let cx = x, cy = y;
    for (let j = 1; j <= k; j++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      const a = cy * PW + cx, b = ny * PW + nx;
      if (this.links.has(a < b ? a * NP + b : b * NP + a)) return null;
      if (d & 1 && this.diag[Math.min(cy, ny) * GRID.w + Math.min(cx, nx)]) return null;
      if (j < k) {
        if (this.cell[b] !== EMPTY) return null;
        if (this.stationNear(nx, ny, s, tc >= 0 ? tc : -2)) return null;
      }
      cx = nx; cy = ny;
    }
    if (tc === EMPTY) {
      if (this.occupiedNear(tx, ty)) return null;
      return {d, k, t: ty * PW + tx, join: -1};
    }
    if (!join && tc !== close) return null;
    if (tc === s || (s >= 0 && this.adj[s].includes(tc))) return null;
    if (line && line.stations.includes(tc) && tc !== close) return null;
    return {d, k, t: ty * PW + tx, join: tc};
  }

  /** Commit an edge from station s (validated by step()); returns the station it reached. */
  commit(s: number, m: Step): number {
    const a0 = this.st[s];
    let cx = a0.x, cy = a0.y;
    for (let j = 1; j <= m.k; j++) {
      const nx = cx + DX[m.d], ny = cy + DY[m.d];
      const a = cy * PW + cx, b = ny * PW + nx;
      this.links.add(a < b ? a * NP + b : b * NP + a);
      if (m.d & 1) this.diag[Math.min(cy, ny) * GRID.w + Math.min(cx, nx)] = 1;
      if (j < m.k) this.cell[b] = TRACK;
      cx = nx; cy = ny;
    }
    const t = m.join >= 0 ? m.join : this.addStation(cx, cy);
    this.adj[s].push(t);
    this.adj[t].push(s);
    return t;
  }

  /** Outward heading at a line end (the direction of its last edge), or -1 for a one-station line. */
  endHeading(l: BLine, atHead: boolean): number {
    const n = l.stations.length;
    if (n < 2) return -1;
    const [a, b] = atHead ? [l.stations[1], l.stations[0]] : [l.stations[n - 2], l.stations[n - 1]];
    return dirOf(this.st[b].x - this.st[a].x, this.st[b].y - this.st[a].y);
  }

  /** Lines that share a station with line li. */
  metLines(li: number): Set<number> {
    const met = new Set<number>();
    for (const s of this.lines[li].stations) for (const o of this.linesOf(s)) if (o !== li) met.add(o);
    return met;
  }

  crowd(x: number, y: number, r: number, except: number): number {
    let n = 0;
    for (let i = 0; i < this.st.length; i++) if (i !== except && Math.max(Math.abs(this.st[i].x - x), Math.abs(this.st[i].y - y)) <= r) n++;
    return n;
  }
}

interface WalkCfg { join: boolean; noise: number; joinBonus: number }

/** Extend line li at one end by up to `count` steps with headings within 45 degrees of `main`. Returns the steps taken. */
function walk(b: Board, rng: Rng, li: number, atHead: boolean, main: number, count: number, cfg: WalkCfg): number {
  let steps = 0;
  for (let n = 0; n < count && b.budget > 0; n++) {
    const L = b.lines[li];
    const s = atHead ? L.stations[0] : L.stations[L.stations.length - 1];
    const h0 = b.endHeading(L, atHead);
    const h = h0 < 0 ? main : h0;
    const met = cfg.join ? b.metLines(li) : new Set<number>();
    const p = b.st[s];
    let best: Step | null = null, bestScore = -Infinity;
    for (const dh of [0, -1, 1]) {
      const d = (h + dh + 8) % 8;
      if (dirDist(d, main) > 1) continue;
      for (const k of [2, 3, 4]) {
        const m = b.step(p.x, p.y, s, d, k, L, cfg.join);
        if (!m) continue;
        const tx = m.t % PW, ty = (m.t - tx) / PW;
        let sc = dh === 0 ? 1 : -0.7;
        if (dh !== 0 && d === main) sc += 0.55;
        const rn = radius(tx, ty);
        const wantK = rn < 0.32 ? 2 : rn < 0.62 ? 2.5 : 3;
        sc -= 0.6 * Math.abs(k - wantK) + (k === 4 ? 0.5 : 0);
        if (m.join >= 0) {
          const theirs = b.linesOf(m.join);
          sc += theirs.some(o => met.has(o)) ? -3 : cfg.joinBonus;
        }
        sc -= 0.3 * b.crowd(tx, ty, 3, s);
        if (tx === 0 || ty === 0 || tx === GRID.w || ty === GRID.h) sc -= 1.2;
        else if (tx === 1 || ty === 1 || tx === GRID.w - 1 || ty === GRID.h - 1) sc -= 0.4;
        sc += rng.next() * cfg.noise;
        if (sc > bestScore) { bestScore = sc; best = m; }
      }
    }
    if (!best) break;
    const t = b.commit(s, best);
    if (atHead) L.stations.unshift(t);
    else L.stations.push(t);
    steps++;
  }
  return steps;
}

/** A tiny binary heap keyed by (f, seq) — deterministic tie order. */
class Heap {
  private a: {f: number; seq: number; v: number}[] = [];
  private seq = 0;
  get size(): number { return this.a.length; }
  push(f: number, v: number): void {
    const a = this.a, e = {f, seq: this.seq++, v};
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f < e.f || (a[p].f === e.f && a[p].seq < e.seq)) break;
      a[i] = a[p]; i = p;
    }
    a[i] = e;
  }
  pop(): number {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const lt = (x: typeof last, y: typeof last) => x.f < y.f || (x.f === y.f && x.seq < y.seq);
        if (l < a.length && lt(a[l], m === i ? last : a[m])) m = l;
        if (r < a.length && lt(a[r], m === i ? last : a[m])) m = r;
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top.v;
  }
}

interface RouteCfg { line: BLine; rn: number; cx: number; cy: number; a0: number; a1: number }

/** A* from station `from` to station `to` along the ring (radius cfg.rn, angular sector a0..a1); null when no route exists. */
function routeRing(b: Board, from: number, to: number, cfg: RouteCfg): Step[] | null {
  const goal = b.st[to];
  const key = (p: number, h: number) => p * 9 + h + 1;
  const best = new Map<number, number>();
  const prev = new Map<number, {k: number; m: Step}>();
  const heap = new Heap();
  const start = key(b.st[from].y * PW + b.st[from].x, -1);
  best.set(start, 0);
  heap.push(0, start);
  const angle = (x: number, y: number) => Math.atan2((y - cfg.cy) / CY, (x - cfg.cx) / CX);
  const inSector = (a: number) => { let d = a - cfg.a0; while (d < 0) d += 2 * Math.PI; let span = cfg.a1 - cfg.a0; while (span <= 0) span += 2 * Math.PI; return d <= span + 0.05; };
  let expanded = 0;
  while (heap.size && expanded++ < 6000) {
    const cur = heap.pop();
    const p = Math.floor(cur / 9), h = (cur % 9) - 1;
    const px = p % PW, py = (p - px) / PW;
    const g = best.get(cur)!;
    if (px === goal.x && py === goal.y) {
      const path: Step[] = [];
      for (let c = cur; prev.has(c); c = prev.get(c)!.k) path.unshift(prev.get(c)!.m);
      return path;
    }
    const s = p === b.st[from].y * PW + b.st[from].x ? from : b.stationAt(px, py);
    for (let d = 0; d < 8; d++) {
      const turn = h < 0 ? 0 : dirDist(d, h);
      if (turn > 2) continue;
      for (const k of [2, 3, 4]) {
        const m = b.step(px, py, s, d, k, cfg.line, true, to);
        if (!m) continue;
        const tx = m.t % PW, ty = (m.t - tx) / PW;
        if (m.join >= 0 && m.join !== to && cfg.line.stations.includes(m.join)) continue;
        let c = 1 + 0.12 * k + [0, 0.6, 1.8][turn];
        c += 3 * Math.abs(ringRadius(tx, ty, cfg.cx, cfg.cy) - cfg.rn);
        if (!inSector(angle(tx, ty))) c += 2.5;
        if (m.join >= 0 && m.join !== to) c += 0.4;
        const nk = key(m.t, d), ng = g + c;
        if (ng >= (best.get(nk) ?? Infinity)) continue;
        best.set(nk, ng);
        prev.set(nk, {k: cur, m});
        const hx = Math.abs(goal.x - tx), hy = Math.abs(goal.y - ty);
        heap.push(ng + 0.35 * Math.max(hx, hy), nk);
      }
    }
  }
  return null;
}

/** Hops from `from` to every station (BFS over adjacency lists). */
function bfs(adj: readonly (readonly number[])[], from: number): number[] {
  const dist = new Array<number>(adj.length).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) for (const n of adj[q[i]]) if (dist[n] < 0) { dist[n] = dist[q[i]] + 1; q.push(n); }
  return dist;
}

function trunk(b: Board, rng: Rng, anchor: number, main: number, halves: [number, number], noise: number): number {
  b.lines.push({kind: 'trunk', stations: [anchor], loop: false, parent: -1, anchor});
  const li = b.lines.length - 1;
  const cfg = {join: true, noise, joinBonus: 2.2};
  walk(b, rng, li, false, main, halves[0], cfg);
  walk(b, rng, li, true, (main + 4) % 8, halves[1], cfg);
  return li;
}

/** Hop index of station s on line l from the line's anchor (positive towards the tail). */
const hopFromAnchor = (l: BLine, s: number) => l.stations.indexOf(s) - l.stations.indexOf(l.anchor);

/** The ring's gates at normalised radius rn around (cx, cy): per trunk half-line the station nearest that radius, angle-sorted, thinned. */
function ringGates(b: Board, cx: number, cy: number, rn: number): {s: number; a: number}[] {
  const gates: {s: number; a: number}[] = [];
  for (const l of b.lines) {
    if (l.kind !== 'trunk') continue;
    const ai = l.stations.indexOf(l.anchor);
    for (const side of [1, -1]) {
      let pick = -1, err = Infinity;
      for (let i = ai + side; i >= 0 && i < l.stations.length; i += side) {
        const p = b.st[l.stations[i]];
        const e = Math.abs(ringRadius(p.x, p.y, cx, cy) - rn);
        if (e < err && b.adj[l.stations[i]].length <= 2) { err = e; pick = l.stations[i]; }
      }
      if (pick >= 0 && err < 0.2 && !gates.some(g => g.s === pick)) {
        const p = b.st[pick];
        gates.push({s: pick, a: Math.atan2((p.y - cy) / CY, (p.x - cx) / CX)});
      }
    }
  }
  gates.sort((x, y) => x.a - y.a);
  const kept: typeof gates = [];
  for (const g of gates) if (!kept.length || g.a - kept[kept.length - 1].a > 0.38) kept.push(g);
  if (kept.length > 2 && kept[0].a + 2 * Math.PI - kept[kept.length - 1].a < 0.38) kept.pop();
  return kept;
}

const ringRadius = (x: number, y: number, cx: number, cy: number) => Math.hypot((x - cx) / CX, (y - cy) / CY);

/** Route and commit a ring through `kept` (angle-sorted gates); false (board untouched) when a leg cannot be routed. */
function tryRing(b: Board, kept: readonly {s: number; a: number}[], rn: number, cx: number, cy: number): boolean {
  const snap = b.clone();
  const ring: BLine = {kind: 'ring', stations: [kept[0].s], loop: true, parent: -1, anchor: kept[0].s};
  b.lines.push(ring);
  const fail = () => { b.restore(snap); return false; };
  for (let i = 0; i < kept.length; i++) {
    const last = i === kept.length - 1, from = kept[i], to = kept[(i + 1) % kept.length];
    const path = routeRing(b, ring.stations[ring.stations.length - 1], to.s, {line: ring, rn, cx, cy, a0: from.a, a1: to.a});
    if (!path) return fail();
    let cur = ring.stations[ring.stations.length - 1];
    for (const m of path) {
      const p = b.st[cur];
      const ok = b.step(p.x, p.y, cur, m.d, m.k, ring, true, last ? kept[0].s : -1);
      if (!ok || (b.budget <= 0 && ok.join < 0)) return fail();
      cur = b.commit(cur, ok);
      if (last && cur === kept[0].s) break;
      ring.stations.push(cur);
    }
    if (cur !== to.s) return fail();
  }
  return ring.stations.length >= 6 || fail();
}

function addRing(b: Board, rng: Rng): boolean {
  // centred on the interchanges of the core; radii tried by gate count (>= 4 gates), the first that closes wins
  const core = b.st.map((_, i) => i).filter(i => b.linesOf(i).length > 1);
  const cx = core.reduce((s, i) => s + b.st[i].x, 0) / core.length, cy = core.reduce((s, i) => s + b.st[i].y, 0) / core.length;
  const options = rng.shuffle([0.32, 0.36, 0.4, 0.44, 0.48, 0.52]).map(rn => ({rn, kept: ringGates(b, cx, cy, rn)})).filter(o => o.kept.length >= 4);
  options.sort((x, y) => y.kept.length - x.kept.length || y.rn - x.rn);
  for (const o of options.slice(0, 4)) if (tryRing(b, o.kept, o.rn, cx, cy)) return true;
  return false;
}

/**
 * A branch from a trunk station 1..3 hops before a terminus, diverging 45 degrees (else 90) from the line's outward heading; it keeps
 * at least `minStations` stations including the junction.
 */
function addBranch(b: Board, rng: Rng, len: number, noise: number, minStations = 3): boolean {
  const cands: {s: number; out: number; parent: number}[] = [];
  b.lines.forEach((l, li) => {
    if (l.kind !== 'trunk') return;
    const n = l.stations.length;
    for (const [i, dir] of [[1, -1], [2, -1], [3, -1], [n - 2, 1], [n - 3, 1], [n - 4, 1]] as const) {
      if (i <= 0 || i >= n - 1) continue;
      const s = l.stations[i];
      if (b.adj[s].length !== 2 || b.linesOf(s).length !== 1) continue;
      const nb = l.stations[i + dir];
      const out = dirOf(b.st[nb].x - b.st[s].x, b.st[nb].y - b.st[s].y);
      cands.push({s, out, parent: li});
    }
  });
  rng.shuffle(cands);
  for (const c of cands) {
    for (const turn of [...rng.shuffle([1, -1]), ...rng.shuffle([2, -2])]) {
      const main = (c.out + turn + 8) % 8;
      const snap = b.clone();
      b.lines.push({kind: 'branch', stations: [c.s], loop: false, parent: c.parent, anchor: c.s});
      const li = b.lines.length - 1;
      const first = b.step(b.st[c.s].x, b.st[c.s].y, c.s, main, 3, b.lines[li], false) ?? b.step(b.st[c.s].x, b.st[c.s].y, c.s, main, 2, b.lines[li], false);
      if (!first) { b.restore(snap); continue; }
      b.lines[li].stations.push(b.commit(c.s, first));
      walk(b, rng, li, false, main, len - 1, {join: false, noise, joinBonus: 0});
      if (b.lines[li].stations.length >= minStations) return true;
      b.restore(snap);
    }
  }
  return false;
}

/** Grow termini (shortest lines first) or new branches until the budget is spent. */
function fill(b: Board, rng: Rng, noise: number): boolean {
  const blocked = new Set<string>();
  while (b.budget > 0) {
    const ends: {li: number; head: boolean; n: number}[] = [];
    b.lines.forEach((l, li) => {
      if (l.kind === 'ring') return;
      for (const head of l.kind === 'branch' ? [false] : [true, false]) if (!blocked.has(`${li}:${head}`)) ends.push({li, head, n: l.stations.length + rng.next() * 3});
    });
    ends.sort((x, y) => x.n - y.n);
    let grown = false;
    for (const e of ends) {
      const l = b.lines[e.li];
      const h = b.endHeading(l, e.head);
      if (h < 0) { blocked.add(`${e.li}:${e.head}`); continue; }
      const before = b.budget;
      walk(b, rng, e.li, e.head, h, 1, {join: false, noise, joinBonus: 0});
      if (b.budget < before) { grown = true; break; }
      blocked.add(`${e.li}:${e.head}`);
    }
    if (grown) continue;
    if (!addBranch(b, rng, Math.min(6, b.budget + 1), noise, Math.min(3, b.budget + 1))) return false;
  }
  return true;
}

interface Built { b: Board; cycle: boolean }

function buildAttempt(seed: number, attempt: number, total: number): Built | null {
  const rng = new Rng(hashString(`terminal-state:network:${attempt}`, seed >>> 0));
  const b = new Board();
  b.budget = total;
  const noise = rng.range(0.8, 1.3);
  const wantRing = rng.chance(0.5);
  const a1 = rng.weighted<number>([[0, 0.6], [1, 0.2], [7, 0.2]]);
  const ax = Math.round(CX + rng.range(-3, 3)), ay = Math.round(CY + rng.range(-1, 1));
  const half = (lo: number, hi: number) => rng.int(lo, hi);
  const l1 = trunk(b, rng, b.addStation(ax, ay), a1, wantRing ? [half(4, 5), half(4, 5)] : [half(5, 6), half(5, 6)], noise);
  if (b.lines[l1].stations.length < 7) return null;
  // the second line crosses the first near the centre
  const near1 = b.lines[l1].stations.filter(s => Math.abs(hopFromAnchor(b.lines[l1], s)) <= 2);
  const a2 = (a1 + rng.weighted<number>([[2, 0.5], [1, 0.25], [3, 0.25]])) % 8;
  let l2 = -1;
  for (const anchor of rng.shuffle(near1.slice())) {
    const snap = b.clone();
    const li = trunk(b, rng, anchor, a2, wantRing ? [half(3, 4), half(3, 4)] : [half(4, 5), half(3, 5)], noise);
    if (b.lines[li].stations.length >= 6) { l2 = li; break; }
    b.restore(snap);
  }
  if (l2 < 0) return null;
  // the third line on a remaining axis, anchored off the first interchange
  const used = new Set([a1 % 4, a2 % 4]);
  const axes = [0, 1, 2, 3].filter(a => !used.has(a));
  const near2 = [l1, l2].flatMap(li => b.lines[li].stations.filter(s => b.linesOf(s).length === 1 && Math.abs(hopFromAnchor(b.lines[li], s)) <= 3));
  const addTrunk = (t: number): boolean => {
    const pool = t === 3 ? near2 : b.st.map((_, i) => i).filter(s => b.linesOf(s).length === 1 && b.adj[s].length === 2 && radius(b.st[s].x, b.st[s].y) < 0.75);
    for (const anchor of rng.shuffle(pool.slice()).slice(0, 8)) {
      const axis = axes.length ? rng.pick(axes) : rng.int(0, 3);
      const dir = rng.chance(0.5) ? axis : axis + 4;
      const snap = b.clone();
      const li = trunk(b, rng, anchor, dir, t === 3 ? [half(3, 5), half(3, 5)] : [half(3, 4), half(3, 4)], noise);
      if (b.lines[li].stations.length >= 5) { const k = axes.indexOf(axis); if (k >= 0) axes.splice(k, 1); return true; }
      b.restore(snap);
    }
    return false;
  };
  if (!addTrunk(3)) return null;
  // a ring around the centre on about half of the seeds; else (or when it cannot close) a fourth trunk line
  if (!(wantRing && addRing(b, rng)) && !addTrunk(4)) return null;
  const branches = rng.chance(0.3) ? 2 : 1;
  let made = 0;
  for (let i = 0; i < branches && b.budget >= 2; i++) if (addBranch(b, rng, Math.min(rng.int(3, 4), b.budget), noise)) made++;
  if (!made) return null;
  if (b.budget < 0 || !fill(b, rng, noise)) return null;
  if (b.st.length !== total) return null;
  const edges = b.adj.reduce((s, a) => s + a.length, 0) / 2;
  return {b, cycle: edges > b.st.length - 1};
}

/** The last-resort layout (never needed on the sampled seeds; kept valid by the tests): one long line crossed by three. */
function fallbackBoard(total: number): Board {
  const b = new Board();
  b.budget = total;
  const line = (pts: [number, number][]) => {
    const l: BLine = {kind: 'trunk', stations: [], loop: false, parent: -1, anchor: -1};
    for (const [x, y] of pts) {
      let s = b.stationAt(x, y);
      if (s < 0) s = b.addStation(x, y);
      const prev = l.stations[l.stations.length - 1];
      if (prev !== undefined) { b.adj[prev].push(s); b.adj[s].push(prev); }
      l.stations.push(s);
    }
    l.anchor = l.stations[0];
    b.lines.push(l);
    return l;
  };
  const range = (n: number, f: (i: number) => [number, number]) => Array.from({length: n}, (_, i) => f(i));
  line(range(15, i => [i * 2, 8]));
  line(range(9, i => [14, i * 2]));
  line(range(9, i => [6, i * 2]));
  line(range(9, i => [22, i * 2]));
  const br = line([[26, 8], [26, 10]]);
  br.kind = 'branch';
  br.parent = 0;
  return b;
}

// --- names --------------------------------------------------------------------------------------------------------------

/** Original fictional place-name stems (each used at most once per network). */
const STEMS: readonly string[] = [
  'Calder', 'Brennock', 'Quillan', 'Larkmoor', 'Tessaly', 'Fenwright', 'Corvane', 'Dunmarrow', 'Vellacott', 'Marrick', 'Pellow',
  'Orrindale', 'Saltmere', 'Gorrin', 'Ivelton', 'Kestermoor', 'Morrowfield', 'Nethercote', 'Oakhallow', 'Pruett', 'Selwick',
  'Thistlecombe', 'Ulverby', 'Wexmoor', 'Yarrowby', 'Ambry', 'Bellhaven', 'Carrowmere', 'Elderwick', 'Farrowgate', 'Glimmerton',
  'Hallowmere', 'Inchbrook', 'Kilnworth', 'Lanterly', 'Mirecroft', 'Nettleby', 'Quarrystone', 'Sallowby', 'Tannerley', 'Vexford',
  'Wrenhollow', 'Yewbridge', 'Brackenholt', 'Cindervale', 'Draymoor', 'Embervale', 'Foxmere', 'Haverleigh', 'Ironmere',
  'Kettlecombe', 'Lowmarsh', 'Millbrace', 'Norrowby', 'Ottermill', 'Penmorrow', 'Quenwick', 'Rillmoor', 'Stonereach', 'Tollbrook',
  'Undermere', 'Varrow', 'Wickmere', 'Aldermoss', 'Barrowmead', 'Corbel', 'Dunholt', 'Fallowmere', 'Greywater', 'Hartsmoor',
  'Ingleworth', 'Jessamy', 'Kinmorrow', 'Larchway', 'Marlwick', 'Nightfold', 'Osgrave', 'Pellmoor', 'Quayholt', 'Redmarrow',
  'Sablewood', 'Tindermoor', 'Umbervale', 'Vanehollow', 'Wolverleigh', 'Yarnwick', 'Ashenford', 'Bellwick', 'Copperholt',
  'Drifton', 'Eastermoor', 'Fernhallow', 'Gilderby', 'Hollinmoor', 'Ivymead', 'Juniperhill', 'Kestle', 'Lorrimer', 'Mossgrave',
];
const SUFFIX = {
  plain: ['Park', 'Road', 'Street', 'Hill', 'Lane', 'Green', 'Common', 'Heights', 'Terrace', 'Bridge', 'Gardens', 'Row', 'Place', 'Avenue', 'Quay', 'Grove'],
  terminus: ['Yards', 'End', 'Depot', 'Gate', 'Wharf', 'Fields', 'Halt'],
  interchange: ['Junction', 'Cross', 'Square', 'Central', 'Circus'],
  office: ['Plaza', 'Exchange', 'Chambers', 'Commerce', 'Tower'],
  mall: ['Arcade', 'Galleria', 'Market', 'Promenade', 'Centre'],
  reactor: ['Works', 'Power', 'Powerhouse'],
} as const;

const LINE_NAMES: readonly string[] = ['Meridian', 'Foundry', 'Harbour', 'Lantern', 'Quarry', 'Canal', 'Tidewater', 'Granary', 'Kestrel', 'Heron', 'Ember', 'Larch', 'Beacon', 'Thistle'];
const RING_NAMES: readonly string[] = ['Orbital', 'Belt', 'Ring'];
/**
 * Printed ink colours (legible under a multiply blend on aged paper): five clearly distinct primaries (red, blue, green, amber,
 * purple) are dealt first, in a seeded order; teal / brown / magenta only for a sixth line or more.
 */
export const LINE_INKS: readonly string[] = ['#c63a2f', '#23599e', '#2f8541', '#e08a1a', '#75429b', '#12817f', '#8a5730', '#b8407a'];
const PRIMARY_INKS = 5;
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

// --- finishing --------------------------------------------------------------------------------------------------------------

function finish(seed: number, b: Board, weights: OrdinaryWeights): SubwayNetwork | null {
  const rng = new Rng(hashString('terminal-state:network:finish', seed >>> 0));
  const n = b.st.length;
  const lineSets = b.st.map((_, i) => b.linesOf(i));
  const colourOf: number[] = [];
  const order = [...rng.shuffle(LINE_INKS.slice(0, PRIMARY_INKS).map((_, i) => i)), ...rng.shuffle(LINE_INKS.slice(PRIMARY_INKS).map((_, i) => i + PRIMARY_INKS))];
  let ci = 0;
  b.lines.forEach((l, li) => { colourOf[li] = l.kind === 'branch' ? -1 : order[ci++ % order.length]; });
  b.lines.forEach((l, li) => { if (l.kind === 'branch') colourOf[li] = colourOf[l.parent]; });
  const inks = b.st.map((_, i) => new Set(lineSets[i].map(li => colourOf[li])).size);
  // the start: a non-interchange station, deep eccentricity; termini favoured
  const ecc = b.st.map((_, i) => Math.max(...bfs(b.adj, i)));
  const startCands = b.st.map((_, i) => i).filter(i => inks[i] === 1 && b.adj[i].length <= 2 && ecc[i] >= REACTOR_DEPTH.lo + 1);
  if (!startCands.length) return null;
  const start = rng.weighted(startCands.map(i => [i, b.adj[i].length === 1 ? 2 : 1] as const));
  const dist = bfs(b.adj, start);
  if (dist.some(d => d < 0)) return null;
  const maxD = Math.max(...dist);
  const lo = maxD >= REACTOR_DEPTH.lo ? REACTOR_DEPTH.lo : MIN_REACTOR_DEPTH;
  const hi = Math.max(lo, Math.min(REACTOR_DEPTH.hi, maxD));
  const reactorCands = b.st.map((_, i) => i).filter(i => dist[i] >= lo && dist[i] <= hi);
  if (!reactorCands.length) return null;
  const reactor = rng.weighted(reactorCands.map(i => [i, (b.adj[i].length === 1 ? 0.55 : 1) * (1 + 0.15 * (dist[i] - lo))] as const));
  // ordinary archetypes (largest remainder); Office / Mall spread out (not next to the start or each other when avoidable)
  const counts = ordinaryCounts(weights, n - 1);
  if (!((counts.subway ?? 0) >= 1)) throw new Error('network: the Subway weight must leave room for the start station');
  const arch: LevelId[] = new Array(n).fill('subway');
  arch[reactor] = 'reactor';
  const free = rng.shuffle(b.st.map((_, i) => i).filter(i => i !== start && i !== reactor));
  const special = Object.keys(counts).filter(k => k !== 'subway').flatMap(k => new Array<string>(counts[k]).fill(k));
  const taken = new Set<number>();
  for (const kind of special) {
    const ok = (i: number, strict: boolean) => !taken.has(i) && (!strict || (!b.adj[i].includes(start) && !b.adj[i].some(j => taken.has(j))));
    const pick = free.find(i => ok(i, true)) ?? free.find(i => ok(i, false));
    if (pick === undefined) return null;
    taken.add(pick);
    arch[pick] = kind as LevelId;
  }
  // ids: st-00 = the start, then BFS order (neighbours by grid position)
  const idOf = new Array<number>(n).fill(-1);
  const q = [start];
  idOf[start] = 0;
  for (let i = 0, next = 1; i < q.length; i++) {
    const nb = b.adj[q[i]].slice().sort((x, y) => b.st[x].y - b.st[y].y || b.st[x].x - b.st[y].x);
    for (const j of nb) if (idOf[j] < 0) { idOf[j] = next++; q.push(j); }
  }
  const pad = String(n - 1).length < 2 ? 2 : String(n - 1).length;
  const sid = (i: number): StationId => `st-${String(idOf[i]).padStart(pad, '0')}`;
  // names: unique stems; suffix by role / archetype (no suffix used more than three times)
  const stems = rng.shuffle(STEMS.slice());
  const used = new Map<string, number>();
  const names = b.st.map((_, i) => {
    const stem = stems[i % stems.length];
    const role = arch[i] === 'reactor' ? 'reactor' : arch[i] === 'office' && rng.chance(0.6) ? 'office' : arch[i] === 'mall' && rng.chance(0.6) ? 'mall'
      : inks[i] > 1 && rng.chance(0.55) ? 'interchange' : b.adj[i].length === 1 && rng.chance(0.5) ? 'terminus' : rng.chance(0.68) ? 'plain' : '';
    if (!role) return stem;
    const pool = SUFFIX[role as keyof typeof SUFFIX].filter(s => (used.get(s) ?? 0) < 3);
    if (!pool.length) return stem;
    const suf = rng.pick(pool);
    used.set(suf, (used.get(suf) ?? 0) + 1);
    return `${stem} ${suf}`;
  });
  // lines: printed names / inks; a branch keeps its parent's ink
  const trunkNames = rng.shuffle(LINE_NAMES.slice());
  let tn = 0;
  const lineIds = b.lines.map((_, li) => `ln-${li + 1}`);
  const lineName: string[] = [];
  b.lines.forEach((l, li) => {
    if (l.kind === 'ring') lineName[li] = `${rng.pick(RING_NAMES)} Line`;
    else if (l.kind === 'trunk') lineName[li] = `${trunkNames[tn++ % trunkNames.length]} Line`;
  });
  b.lines.forEach((l, li) => {
    if (l.kind !== 'branch') return;
    const s0 = b.st[l.stations[0]], s1 = b.st[l.stations[l.stations.length - 1]];
    lineName[li] = `${lineName[l.parent]} (${COMPASS[dirOf(s1.x - s0.x, s1.y - s0.y)]} branch)`;
  });
  const nodes: StationNode[] = b.st.map((p, i) => ({
    id: sid(i), name: names[i], archetype: arch[i], levelSeed: 0, x: p.x * GRID.unit, y: p.y * GRID.unit,
    lines: lineSets[i].map(li => lineIds[li]),
  }));
  for (const nd of nodes) nd.levelSeed = hashNodeSeed(seed, nd.id);
  nodes.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const edges: [StationId, StationId][] = [];
  b.adj.forEach((a, i) => { for (const j of a) if (i < j) { const [x, y] = [sid(i), sid(j)]; edges.push(x < y ? [x, y] : [y, x]); } });
  edges.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  const lines: NetworkLine[] = b.lines.map((l, li) => {
    const out: NetworkLine = {id: lineIds[li], name: lineName[li], color: LINE_INKS[colourOf[li]], stations: l.stations.map(sid)};
    if (l.loop) out.loop = true;
    return out;
  });
  return {v: 1, seed: seed >>> 0, nodes, edges, lines, start: sid(start), reactor: sid(reactor)};
}

/** Attempts per seed before the fallback layout. */
const MAX_ATTEMPTS = 48;

/** Generate the campaign network of `seed` (identical output for identical seed + options). */
export function generateNetwork(seed: number, opts: NetworkOptions = {}): SubwayNetwork {
  return generateNetworkInfo(seed, opts).network;
}

/** generateNetwork plus how it was reached (tests / tuning): the accepted attempt index, or the fallback layout. */
export function generateNetworkInfo(seed: number, opts: NetworkOptions = {}): {network: SubwayNetwork; attempt: number; fallback: boolean} {
  const weights = opts.weights ?? ORDINARY_WEIGHTS;
  const total = NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor;
  const s = seed >>> 0;
  // about 70 % of the seeds insist on a cycle for their first attempts (the rest take whatever shape the walks give)
  const wantCycle = new Rng(hashString('terminal-state:network:cycle', s)).chance(0.7);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const got = buildAttempt(s, attempt, total);
    if (!got || (wantCycle && !got.cycle && attempt < MAX_ATTEMPTS / 2)) continue;
    const network = finish(s, got.b, weights);
    if (network && validateNetwork(network, {weights}).length === 0) return {network, attempt, fallback: false};
  }
  const network = finish(s, fallbackBoard(total), weights);
  if (!network) throw new Error(`network: no layout for seed ${s}`);
  return {network, attempt: MAX_ATTEMPTS, fallback: true};
}

/** Exposed for the tests: the fallback layout as a network (always valid). */
export function fallbackNetwork(seed: number, opts: NetworkOptions = {}): SubwayNetwork {
  const net = finish(seed >>> 0, fallbackBoard(NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor), opts.weights ?? ORDINARY_WEIGHTS);
  if (!net) throw new Error('network: fallback layout failed');
  return net;
}

// --- graph helpers ------------------------------------------------------------------------------------------------------------

/** Adjacency (sorted neighbour ids) of a network. */
export function adjacency(net: SubwayNetwork): Map<StationId, StationId[]> {
  const m = new Map<StationId, StationId[]>();
  for (const nd of net.nodes) m.set(nd.id, []);
  for (const [a, b] of net.edges) { m.get(a)?.push(b); m.get(b)?.push(a); }
  for (const v of m.values()) v.sort();
  return m;
}

/** Hops from `from` to every reachable station. */
export function graphDistances(net: SubwayNetwork, from: StationId): Map<StationId, number> {
  const adj = adjacency(net);
  const d = new Map<StationId, number>([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i]) ?? []) if (!d.has(n)) { d.set(n, d.get(q[i])! + 1); q.push(n); }
  return d;
}

// --- validation ---------------------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural + design checks of a network (generator tests AND the save importer). Never throws; returns the problems found
 * (empty = valid). Accepts untrusted parsed JSON.
 */
export function validateNetwork(net: unknown, opts: NetworkOptions = {}): string[] {
  const errs: string[] = [];
  if (!isObj(net)) return ['network: not an object'];
  if (net.v !== 1) errs.push('network: v must be 1');
  if (typeof net.seed !== 'number' || !Number.isInteger(net.seed) || net.seed < 0 || net.seed > 0xffffffff) errs.push('network: seed must be a uint32');
  const nodes = net.nodes, edges = net.edges, lines = net.lines;
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(lines)) return [...errs, 'network: nodes / edges / lines must be arrays'];
  if (nodes.length > 400 || edges.length > 2000 || lines.length > 64) return [...errs, 'network: too large'];
  const total = NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor;
  if (nodes.length !== total) errs.push(`network: ${nodes.length} nodes, expected ${total}`);
  const ids = new Set<string>(), names = new Set<string>(), byId = new Map<string, Record<string, unknown>>();
  const count: Record<string, number> = {};
  for (const nd of nodes) {
    if (!isObj(nd)) { errs.push('node: not an object'); continue; }
    const id = nd.id;
    if (typeof id !== 'string' || !/^st-\d{2,3}$/.test(id)) { errs.push(`node: bad id ${String(id)}`); continue; }
    if (ids.has(id)) errs.push(`node ${id}: duplicate id`);
    ids.add(id);
    byId.set(id, nd);
    if (typeof nd.name !== 'string' || !nd.name.trim() || nd.name.length > 48) errs.push(`node ${id}: bad name`);
    else if (names.has(nd.name)) errs.push(`node ${id}: duplicate name ${nd.name}`);
    else names.add(nd.name);
    if (typeof nd.archetype !== 'string' || !ARCHETYPES.includes(nd.archetype as LevelId)) errs.push(`node ${id}: bad archetype`);
    else count[nd.archetype] = (count[nd.archetype] ?? 0) + 1;
    if (typeof net.seed === 'number' && nd.levelSeed !== hashNodeSeed(net.seed, id)) errs.push(`node ${id}: levelSeed is not hashNodeSeed(seed, id)`);
    for (const k of ['x', 'y'] as const) if (typeof nd[k] !== 'number' || !Number.isFinite(nd[k] as number) || Math.abs(nd[k] as number) > 1000) errs.push(`node ${id}: bad ${k}`);
    if (!Array.isArray(nd.lines) || !nd.lines.length || nd.lines.some(l => typeof l !== 'string')) errs.push(`node ${id}: lines must be a non-empty id list`);
  }
  if ((count.reactor ?? 0) !== 1) errs.push(`network: ${count.reactor ?? 0} Reactor nodes, expected exactly 1`);
  const want = ordinaryCounts(opts.weights ?? ORDINARY_WEIGHTS, NETWORK_SIZE.ordinary);
  for (const k of new Set([...Object.keys(want), ...Object.keys(count).filter(c => c !== 'reactor')])) {
    if ((count[k] ?? 0) !== (want[k] ?? 0)) errs.push(`network: ${count[k] ?? 0} ${k} nodes, expected ${want[k] ?? 0}`);
  }
  const start = net.start, reactor = net.reactor;
  if (typeof start !== 'string' || !byId.has(start)) errs.push('network: start is not a node');
  else {
    if (byId.get(start)!.archetype !== 'subway') errs.push('network: the start must be a Subway station');
    if (start !== `st-${'0'.repeat(Math.max(2, String(nodes.length - 1).length))}`) errs.push('network: the start must be the first id');
  }
  if (typeof reactor !== 'string' || !byId.has(reactor)) errs.push('network: reactor is not a node');
  else if (byId.get(reactor)!.archetype !== 'reactor') errs.push('network: reactor node archetype is not reactor');
  // edges
  const adj = new Map<string, Set<string>>([...ids].map(i => [i, new Set<string>()]));
  const keys: string[] = [];
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || typeof e[1] !== 'string') { errs.push('edge: not an id pair'); continue; }
    const [a, b] = e as [string, string];
    if (!ids.has(a) || !ids.has(b)) { errs.push(`edge ${a}-${b}: unknown station`); continue; }
    if (a === b) { errs.push(`edge ${a}-${b}: self edge`); continue; }
    if (!(a < b)) errs.push(`edge ${a}-${b}: ids not sorted`);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (adj.get(a)!.has(b)) errs.push(`edge ${a}-${b}: duplicate`);
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    keys.push(k);
  }
  for (let i = 1; i < keys.length; i++) if (keys[i - 1] >= keys[i]) { errs.push('edges: not sorted / unique'); break; }
  // lines
  const lineIds = new Set<string>(), covered = new Set<string>(), serving = new Map<string, string[]>();
  for (const l of lines) {
    if (!isObj(l) || typeof l.id !== 'string') { errs.push('line: bad'); continue; }
    if (lineIds.has(l.id)) errs.push(`line ${l.id}: duplicate id`);
    lineIds.add(l.id);
    if (typeof l.name !== 'string' || !l.name.trim()) errs.push(`line ${l.id}: bad name`);
    if (typeof l.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(l.color)) errs.push(`line ${l.id}: bad colour`);
    const st = l.stations;
    if (!Array.isArray(st) || st.length < 2 || st.some(s => typeof s !== 'string' || !ids.has(s))) { errs.push(`line ${l.id}: bad station list`); continue; }
    if (new Set(st).size !== st.length) errs.push(`line ${l.id}: repeats a station`);
    if (l.loop !== undefined && typeof l.loop !== 'boolean') errs.push(`line ${l.id}: bad loop flag`);
    const pairs = st.slice(1).map((s, i) => [st[i] as string, s as string]);
    if (l.loop === true) { if (st.length < 3) errs.push(`line ${l.id}: loop too short`); pairs.push([st[st.length - 1] as string, st[0] as string]); }
    for (const [a, b] of pairs) {
      if (!adj.get(a)?.has(b)) errs.push(`line ${l.id}: ${a}-${b} is not an edge`);
      covered.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    for (const s of st as string[]) { const v = serving.get(s) ?? []; v.push(l.id); serving.set(s, v); }
  }
  if (lineIds.size < 1) errs.push('network: no lines');
  for (const k of keys) if (!covered.has(k)) errs.push(`edge ${k.replace('|', '-')}: on no line`);
  for (const [id, nd] of byId) {
    const want = serving.get(id) ?? [];
    const got = Array.isArray(nd.lines) ? nd.lines : [];
    if (want.length !== got.length || want.some((l, i) => got[i] !== l)) errs.push(`node ${id}: lines do not match the line station lists`);
  }
  // connectivity + Reactor depth
  if (typeof start === 'string' && adj.has(start)) {
    const d = new Map<string, number>([[start, 0]]);
    const q = [start];
    for (let i = 0; i < q.length; i++) for (const nb of adj.get(q[i])!) if (!d.has(nb)) { d.set(nb, d.get(q[i])! + 1); q.push(nb); }
    if (d.size !== ids.size) errs.push(`network: ${ids.size - d.size} stations unreachable from the start`);
    if (typeof reactor === 'string' && d.has(reactor) && d.get(reactor)! < MIN_REACTOR_DEPTH) errs.push(`network: Reactor only ${d.get(reactor)} hops from the start`);
  }
  return errs;
}
