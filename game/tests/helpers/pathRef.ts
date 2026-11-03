// Task studio-performance-recorder-20261103-043629-01 (lane AI-CPU): an executable REFERENCE of the path search as it was before the
// lane's speedups (main dbfef67: gen/grid.ts PathFinder.search without chunking, gen/levels.ts walkLineClear / circleClear /
// railCrosses / segSegDist) — the same statements in the same order, written against the finder's / levels' data. Used only by
// tests/ai-cpu-mall.test.ts to pin that the optimized search returns exactly the same paths with exactly the same expansions.
// (No volume handling in the walk reference: callers compare it on levels without dynamic volumes.)

import {CELL, DROP_COST, FLOOR, MAX_DROP, NAV_STEP, STEP_UP, VOID, nearestPassable, type Grid, type PathFinder, type PathOpts, type Waypoint} from '../../src/gen/grid';
import {BODY_CLEAR, Levels, RAIL_H, RAIL_HALF, ceilNearCell, floorNearCell} from '../../src/gen/levels';

const isOpen = (g: Grid, i: number): boolean => { const c = g.cells[i]; return c === FLOOR || c === VOID; };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Pre-change segSegDist (closures per call). */
export function refSegSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const ptSeg = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const lx = x1 - x0, lz = z1 - z0, l2 = lx * lx + lz * lz;
    const t = l2 > 0 ? clamp(((px - x0) * lx + (pz - z0) * lz) / l2, 0, 1) : 0;
    return Math.hypot(px - (x0 + lx * t), pz - (z0 + lz * t));
  };
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  const o1 = o(ax, az, bx, bz, cx, cz), o2 = o(ax, az, bx, bz, dx, dz), o3 = o(cx, cz, dx, dz, ax, az), o4 = o(cx, cz, dx, dz, bx, bz);
  if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0 && (o1 || o2) && (o3 || o4)) return 0;
  return Math.min(ptSeg(ax, az, cx, cz, dx, dz), ptSeg(bx, bz, cx, cz, dx, dz), ptSeg(cx, cz, ax, az, bx, bz), ptSeg(dx, dz, ax, az, bx, bz));
}

/** Pre-change Levels.railCrosses (every rail of every column of the box, in list order; duplicates tested again). */
export function refRailCrosses(L: Levels, ax: number, az: number, bx: number, bz: number, r: number, feet: number): boolean {
  if (!L.rails.length) return false;
  const g0 = L.main;
  const x0 = Math.floor((Math.min(ax, bx) - r) / CELL), x1 = Math.floor((Math.max(ax, bx) + r) / CELL);
  const y0 = Math.floor((Math.min(az, bz) - r) / CELL), y1 = Math.floor((Math.max(az, bz) + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!g0.inBounds(cx, cy)) continue;
    const list = L.railsAt(cy * g0.w + cx);
    if (!list) continue;
    for (const rl of list) {
      const base = Levels.railBaseAt(rl, (ax + bx) / 2, (az + bz) / 2);
      if (feet > base + (rl.h ?? RAIL_H) - 0.3 || feet < base - 0.6) continue;
      if (refSegSegDist(ax, az, bx, bz, rl.x0, rl.z0, rl.x1, rl.z1) < r + RAIL_HALF) return true;
    }
  }
  return false;
}

/** Pre-change Levels.circleClear (band test of every column of the box, then the distance test; levels in index order). */
export function refCircleClear(L: Levels, wx: number, wz: number, r: number, feet: number): boolean {
  const g0 = L.main;
  const x0 = Math.floor((wx - r) / CELL), x1 = Math.floor((wx + r) / CELL);
  const y0 = Math.floor((wz - r) / CELL), y1 = Math.floor((wz + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      let ok = false;
      if (g0.inBounds(cx, cy)) {
        const i = cy * g0.w + cx;
        for (let k = 0; k < L.count; k++) {
          const g = L.grid(k);
          if (!isOpen(g, i) || g.blocked[i]) continue;
          const f = floorNearCell(g, i, cx, cy, wx, wz);
          if (Math.abs(f - feet) > NAV_STEP) continue;
          if (ceilNearCell(g, i, cx, cy, wx, wz) < Math.max(f, feet) + BODY_CLEAR) continue;
          ok = true;
          break;
        }
      }
      if (ok) continue;
      const nx = Math.max(cx * CELL, Math.min(wx, (cx + 1) * CELL));
      const nz = Math.max(cy * CELL, Math.min(wz, (cy + 1) * CELL));
      if ((wx - nx) ** 2 + (wz - nz) ** 2 < r * r) return false;
    }
  }
  return !refRailCrosses(L, wx, wz, wx, wz, r, feet);
}

/** Pre-change supportFloorIn = supportIn(…)?.floor (its documented equivalent), -Infinity when unsupported. */
const refSupportFloor = (L: Levels, x: number, z: number, y: number, tol: number) => L.supportIn(x, z, y, tol)?.floor ?? -Infinity;

/** Pre-change Levels.walkLineClear (samples in order: support step, circle; then the segment's rails, the end height). */
export function refWalkLineClear(L: Levels, ax: number, ay: number, az: number, bx: number, bz: number, r: number, by?: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
  const f0 = refSupportFloor(L, ax, az, ay + 0.05, NAV_STEP);
  let feet = f0 === -Infinity ? ay : f0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    const s = refSupportFloor(L, px, pz, feet, NAV_STEP);
    if (s === -Infinity || Math.abs(s - feet) > 0.3) return false;
    feet = s;
    if (!refCircleClear(L, px, pz, r, feet)) return false;
  }
  if (refRailCrosses(L, ax, az, bx, bz, r * 0.5, feet)) return false;
  return by === undefined || Math.abs(feet - by) <= 0.35;
}

/** Counters of one refFind call. */
export interface RefStats { expanded: number; probes: number }

/**
 * Pre-change PathFinder.search(…, chunk = Infinity) — A* (the same heap, heuristic and neighbour order) + string pulling with the
 * reference walk — on `pf`'s navigation data and search buffers (use a finder of its own: its buffers are overwritten).
 */
export function refFind(pf: PathFinder, L: Levels, ax: number, az: number, bx: number, bz: number, radius: number, maxExpand: number, opts: PathOpts, stats?: RefStats): Waypoint[] | null {
  const P = pf as unknown as {
    src: Levels | null; grids: Grid[]; NC: number; cur: number; walk: Uint8Array; g: Float32Array; stamp: Uint32Array; closed: Uint32Array; came: Int32Array; cameLink: Int32Array;
    wallCost: Float32Array; fl: Float32Array; linkFlag: Uint8Array; twinFlag: Uint8Array; edgeBlock: Uint8Array | null; twins: Map<number, number[]>;
    links: {a: number; b: number; cost: number; id: number; pa: {x: number; y: number; z: number}; pb: {x: number; y: number; z: number}}[]; linkMap: Map<number, number[]>;
    levelDist: Float32Array[] | null; levelNode: Int32Array | null; levelEntries: Int32Array[] | null;
  };
  const multi = P.src !== null;
  const levelOf = (x: number, z: number, y: number | undefined) => {
    if (!P.src || y === undefined) return 0;
    const s = P.src.supportIn(x, z, y + 0.05, STEP_UP);
    if (!s) return 0;
    const k = P.src.list.findIndex(l => l.id === s.level);
    return k < 0 ? 0 : k;
  };
  const la = levelOf(ax, az, opts.ay), lb = levelOf(bx, bz, opts.by);
  const ga = P.grids[la], gb = P.grids[lb];
  let [sx, sy] = ga.cellOf(ax, az);
  let [tx, ty] = gb.cellOf(bx, bz);
  if (!ga.passable(sx, sy)) { const n = nearestPassable(ga, sx, sy, 3, multi && opts.ay !== undefined ? opts.ay : ga.floorAt(ax, az)); if (!n) return null; [sx, sy] = n; }
  if (!gb.passable(tx, ty)) { const n = nearestPassable(gb, tx, ty, 3, multi && opts.by !== undefined ? opts.by : gb.floorAt(bx, bz)); if (!n) return null; [tx, ty] = n; }
  const W = ga.w, H = ga.h, NC = P.NC;
  const start = la * NC + sx + sy * W, goal = lb * NC + tx + ty * W;
  P.cur++;
  if (P.cur === 0xffffffff) { P.stamp.fill(0); P.closed.fill(0); P.cur = 1; }
  const cur = P.cur;
  const walk = P.walk, gArr = P.g, stamp = P.stamp, closed = P.closed, came = P.came, cameLink = P.cameLink, wallCost = P.wallCost, fl = P.fl, linkFlag = P.linkFlag, twinFlag = P.twinFlag, eb = P.edgeBlock;
  const drops = !!opts.drops, links = P.links, useLinks = !opts.noLinks;
  // the binary heap (push / pop verbatim)
  let heap = new Int32Array(Math.max(16, NC)), heapF = new Float32Array(Math.max(16, NC)), size = 0;
  const push = (i: number, f: number) => {
    if (size >= heap.length) { const h = new Int32Array(heap.length * 2), hf = new Float32Array(heap.length * 2); h.set(heap); hf.set(heapF); heap = h; heapF = hf; }
    let k = size++;
    while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heap[k] = heap[p]; heapF[k] = heapF[p]; k = p; }
    heap[k] = i; heapF[k] = f;
  };
  const pop = (): number => {
    const top = heap[0], lastI = heap[--size], lastF = heapF[size];
    let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= size) break; if (c + 1 < size && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lastF) break; heap[k] = heap[c]; heapF[k] = heapF[c]; k = c; }
    heap[k] = lastI; heapF[k] = lastF;
    return top;
  };
  gArr[start] = 0; stamp[start] = cur; came[start] = -1; cameLink[start] = 0;
  const h2 = (x: number, y: number) => { const dx = x > tx ? x - tx : tx - x, dy = y > ty ? y - ty : ty - y; return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx; };
  const LD = P.levelDist ? P.levelDist[lb] : null, LN = P.levelNode!;
  let entry = 0;
  if (LD) {
    entry = Infinity;
    for (const ci of P.levelEntries![lb]) { const v = h2(ci % W, (ci - ci % W) / W); if (v < entry) entry = v; }
    if (entry === Infinity) entry = 0;
  }
  const lo = lb * NC, hi = lo + NC;
  const h = LD ? (node: number, x: number, y: number) => { const o = h2(x, y); if (node >= lo && node < hi) return o; const d = LD[LN[node]] + entry; return d > o ? d : o; } : (_n: number, x: number, y: number) => h2(x, y);
  push(start, h(start, sx, sy));
  let expanded = 0, found = false;
  while (size > 0) {
    const c = pop();
    if (closed[c] === cur) continue;
    closed[c] = cur;
    if (c === goal) { found = true; break; }
    if (++expanded > maxExpand) break;
    const lv = Math.floor(c / NC), ci = c - lv * NC, cx = ci % W, cy = (ci - cx) / W, gc = gArr[c], fc = fl[c];
    for (let oy = -1; oy <= 1; oy++) {
      if (cy + oy < 0 || cy + oy >= H) continue;
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (cx + ox < 0 || cx + ox >= W) continue;
        const n = c + ox + oy * W;
        if (!walk[n] || closed[n] === cur) continue;
        const diag = ox !== 0 && oy !== 0, dh = fl[n] - fc;
        let extra = 0;
        if (dh > NAV_STEP || dh < -NAV_STEP) { if (dh > 0 || !drops || diag || dh < -MAX_DROP) continue; extra = DROP_COST; }
        if (diag) { const a1 = c + ox, a2 = c + oy * W; if (!walk[a1] || !walk[a2] || Math.abs(fl[a1] - fc) > NAV_STEP || Math.abs(fl[a2] - fc) > NAV_STEP) continue; }
        if (eb) { const bxx = ox > 0 ? 1 : 2, byy = oy > 0 ? 4 : 8; if (!diag ? eb[c] & (ox ? bxx : byy) : (eb[c] & (bxx | byy)) || (eb[c + ox] & byy) || (eb[c + oy * W] & bxx)) continue; }
        const ng = gc + (diag ? 1.4142 : 1) + wallCost[n] + extra;
        if (stamp[n] !== cur || ng < gArr[n]) { const hn = h(n, cx + ox, cy + oy); if (hn === Infinity) continue; stamp[n] = cur; gArr[n] = ng; came[n] = c; cameLink[n] = 0; push(n, ng + hn); }
      }
    }
    if (twinFlag[c]) for (const n of P.twins.get(c)!) {
      if (closed[n] === cur) continue;
      const ng = gc + 0.01;
      if (stamp[n] !== cur || ng < gArr[n]) { const hn = h(n, cx, cy); if (hn === Infinity) continue; stamp[n] = cur; gArr[n] = ng; came[n] = c; cameLink[n] = 0; push(n, ng + hn); }
    }
    if (useLinks && linkFlag[c]) for (const li of P.linkMap.get(c)!) {
      const l = links[li], n = l.a === c ? l.b : l.a;
      if (!walk[n] || closed[n] === cur) continue;
      const ng = gc + l.cost;
      if (stamp[n] !== cur || ng < gArr[n]) { const nc = n - Math.floor(n / NC) * NC, nx = nc % W; const hn = h(n, nx, (nc - nx) / W); if (hn === Infinity) continue; stamp[n] = cur; gArr[n] = ng; came[n] = c; cameLink[n] = li + 1; push(n, ng + hn); }
    }
  }
  if (stats) stats.expanded = expanded;
  if (!found) return null;
  const cells: number[] = [], via: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) { cells.push(c); via.push(cameLink[c] - 1); }
  cells.reverse(); via.reverse();
  const out: Waypoint[] = [];
  let anchor: [number, number, number] = [ax, az, multi && opts.ay !== undefined ? opts.ay : fl[start]];
  const clear = (a: [number, number, number], b: [number, number, number]) => { if (stats) stats.probes++; return multi ? refWalkLineClear(L, a[0], a[2], a[1], b[0], b[1], radius, b[2]) : ga.walkLineClearH(a[0], a[1], b[0], b[1], radius); };
  const emit = (p: [number, number, number], link?: number) => { out.push(multi ? [p[0], p[1], link, p[2]] : link === undefined ? [p[0], p[1]] : [p[0], p[1], link]); };
  const segment = (from: number, to: number, end: [number, number, number]) => {
    const pts: [number, number, number][] = [];
    for (let k = from; k <= to; k++) { const ci = cells[k] % NC; const [x, z] = ga.center(ci % W, Math.floor(ci / W)); pts.push([x, z, fl[cells[k]]]); }
    pts[pts.length - 1] = end;
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 48);
      while (j > i && !clear(anchor, pts[j])) j--;
      emit(pts[j]); anchor = pts[j]; i = j + 1;
    }
  };
  let segStart = 0;
  for (let k = 1; k < cells.length; k++) {
    if (via[k] < 0) continue;
    const l = links[via[k]], fromA = l.a === cells[k - 1], ps = fromA ? l.pa : l.pb, pe = fromA ? l.pb : l.pa;
    segment(segStart, k - 1, [ps.x, ps.z, ps.y]);
    emit([pe.x, pe.z, pe.y], l.id);
    anchor = [pe.x, pe.z, pe.y];
    segStart = k;
  }
  segment(segStart, cells.length - 1, [bx, bz, fl[goal]]);
  return out;
}
