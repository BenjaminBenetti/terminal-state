// Task reactor-expansion-20261101 (lane CORE): THE CORE FLOOR round the reactor vessel — user: "It needs a pool of glowing green
// gooop around it, with bridges" + "a proper structure made up of 3d assets" (B "Industrial Service Cathedral": the vessel glowing
// green under circular gantries at the bottom of the pit). Pure data (no three.js). Four steps, each called from one tagged line:
//
//  1. carveCoreFloor (gen/reactor/carve.ts, canvas cells, before the column stack):
//     - THE VESSEL: its footprint stays blocked but is no longer a 12 m raised drum (the builder drew that drum as a jagged concrete
//       cylinder that hid the vessel model — the user's "basically a cylinder"): the body column (r <= 5.2 m) rises to the dome
//       profile, the hazard plinth ring (5.2 .. 6.6 m) to the plinth top (1.66 m: a riser no body steps over, bullets hit it where the
//       model is); cells beyond 6.6 m join the service ring. Its faces / tops are not drawn (world/reactor/arch.ts: the model is);
//     - the SERVICE RING: the walkable deck from the plinth (6.6 m) to 10 m (B's circular gantry deck; steel grating);
//     - THE GOOP POOL: the annulus 10 .. 16 m (3 m clear of every wall / stair run) plus the feet of the lattice towers standing in
//       it, its floor 1.5 m below the deck (> RAIL_DROP: every edge derives a railing; blocked: no body, spawn, loot or path enters
//       it; no fall-in mechanic, no damage);
//     - 3-4 radial BRIDGES (2.5 m clear) over the goop from the ring to the outer floor (compass directions clear of the towers,
//       aimed at the control room / pump hall / store doors and the stair landing; every walkable core cell stays connected);
//     - the COOLANT LOOP layout on the goop between the bridges (steam generator, coolant manifold, vertical reactor coolant pump).
//  2. finishCoreFloor (index.ts, after the crop + ladders, before the dresser): block the pool, the loops' collision props (round
//     'annexMachine' props: anchored plant, never storage — docs/prop-affordances.md exception class) and the TURBINE GENERATOR on a
//     free wall run of the outer floor (its collision box), every route kept clear.
//  3. coreFloorRecord (index.ts, after reactorInfo): the baked green light-field sources over the goop (virtual, tinted: half steady
//     = the dormant glow, half on the powered circuit 2 = the restart's boost), the smooth-railing seam (the pool's cell-edge collision
//     rails along the circles / bridges are hidden: world/reactor/coreHero.ts draws them round) and layout.reactor.coreFloor.
//  4. coreFloorIssues (validate.ts): the pool blocked + railed, bridges, the vessel solid, the loops on the goop.

import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import type {LightMount, LightPlacement, StationLayout} from '../stationTypes';
import type {PropPlacement} from '../props';
import type {ReactorCoreFloor} from './reactorTypes';
import {CORE_LEVEL} from './frame';

/** Core floor dimensions (m). */
export const CORE_FLOOR = {
  /** Blocked vessel footprint (walking stops at the model's hazard plinth, r 6.4) and its body column. */
  vesselR: 6.6,
  bodyR: 5.2,
  /** The vessel model's plinth top / dome (REACTOR_KIT.vessel at scale 1: dome from 6.6 m to 9.97 m over a 5 m body radius). */
  plinthH: 1.66,
  domeBase: 6.6,
  domeH: 3.3,
  domeR: 5.0,
  /** Service ring outer radius; goop pool outer radius (cap / floor) and its clearance from every wall / stair run. */
  ringR1: 10,
  poolR1: 16,
  poolR1Min: 14,
  wallClear: 3,
  /** Pool floor below the deck (> RAIL_DROP 1.3: derived railings on every edge) and the goop surface above that floor. */
  depth: 1.5,
  surface: 0.06,
  /** Bridge clear width; bridges wanted (min 3). */
  bridgeW: 2.5,
  bridges: 4,
  minBridges: 3,
  /** Coolant loops wanted, their centre circle, piece sizes along the circle (m: steam generator / manifold / pump), gaps. */
  loops: 4,
  sgHalf: 2.4,
  sgH: 11,
  rcpHalf: 1.45,
  rcpH: 7,
  /** The vertical pump stands on a plinth this far above the pool floor (its nozzles clear the goop); the manifold's stand top
   *  (above the deck: the header sits clear of the goop, under a walker's eye line). */
  rcpLift: 0.6,
  manifoldBase: -0.2,
  manifoldH: 2.06,
  rcpAlong: 2.15,
  manifoldHalf: 0.8,
  pieceGap: 0.5,
  bridgeClear: 0.7,
  /** Turbine generator (REACTOR_X_KIT.turbineGenerator 10 x 3.83 x 2.86): footprint cells along / across, height. */
  turbine: {len: 20, dep: 6, h: 3.84},
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Height above the deck of the vessel's body column at radius r (the dome profile; the plinth beyond the body). */
export function vesselTopAt(r: number): number {
  const F = CORE_FLOOR;
  if (r > F.bodyR) return F.plinthH;
  const q = Math.min(1, r / F.domeR);
  return r2(F.domeBase + F.domeH * Math.sqrt(Math.max(0, 1 - q * q)));
}

// ---------------------------------------------------------------------------------------------
// 1. Carve (canvas cells)

export interface CoreLoopPlan {
  angle: number;
  sg: {x: number; z: number; yaw: number} | null;
  rcp: {x: number; z: number; yaw: number} | null;
  manifold: {x: number; z: number; yaw: number} | null;
}

export interface CoreFloorCarve {
  /** Canvas indices of the goop cells (canvas width `W`; blocked after the crop: see poolCells). */
  pool: number[];
  W: number;
  /** The pit rect (canvas cells = grid cells after the origin-0 crop). */
  pit: {x: number; y: number; w: number; h: number};
  cx: number;
  cz: number;
  base: number;
  poolR1: number;
  bridges: {angle: number; width: number; along0: number; along1: number}[];
  /** rc.towers indices whose feet stand in the goop. */
  towers: number[];
  loops: CoreLoopPlan[];
}

export interface CoreFloorInput {
  g: Grid;
  base: number;
  /** The pit rect in canvas cells. */
  pit: {x: number; y: number; w: number; h: number};
  coreAreas: readonly number[];
  /** The vessel cells the carve raised (canvas; filtered in place: cells beyond the plinth join the ring). */
  vessel: [number, number][];
  /** Tower footprints (canvas cell rects). */
  towers: readonly {x: number; y: number; w: number; h: number}[];
  /** Decks of the storeys above (world rect + deck height): no loop piece rises into one. */
  overhead: readonly {x0: number; z0: number; x1: number; z1: number; y: number}[];
  /** World points the bridges aim at (door centres, the stair landing), weighted. */
  targets: readonly {x: number; z: number; w: number}[];
}

/** Why the last core-floor carves failed (QA / tests). */
export const CORE_FLOOR_FAILS: Record<string, number> = {};
/** Time (ms) of the last carve / finish (QA / tests: generation stays fast). */
export const CORE_FLOOR_STATS = {carveMs: 0, finishMs: 0, floods: 0, sections: {} as Record<string, number>};
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Carves the vessel / ring / goop / bridges into the core grid; null when no bridge set keeps the floor connected. */
export function carveCoreFloor(o: CoreFloorInput): CoreFloorCarve | null {
  const t0 = now();
  try { return carveCore(o); } finally { CORE_FLOOR_STATS.carveMs = now() - t0; }
}

function carveCore(o: CoreFloorInput): CoreFloorCarve | null {
  let tl = now();
  const lap = (k: string) => { const t = now(); CORE_FLOOR_STATS.sections[k] = t - tl; tl = t; };
  const F = CORE_FLOOR, g = o.g, W = g.w;
  const cx = (o.pit.x + o.pit.w / 2) * CELL, cz = (o.pit.y + o.pit.h / 2) * CELL;
  const rad = (x: number, y: number) => Math.hypot((x + 0.5) * CELL - cx, (y + 0.5) * CELL - cz);
  const areas = new Set(o.coreAreas);
  const X0 = o.pit.x, Y0 = o.pit.y, X1 = o.pit.x + o.pit.w, Y1 = o.pit.y + o.pit.h;
  lap('vessel0');
  // --- the vessel: blocked footprint r <= vesselR, body column to the dome profile, plinth ring to the plinth top -------------
  const vessel = new Uint8Array(g.cells.length);
  let kept = 0;
  for (let k = 0; k < o.vessel.length; k++) {
    const [x, y] = o.vessel[k], i = g.idx(x, y), r = rad(x, y);
    if (r > F.vesselR) { g.floor[i] = o.base; continue; }
    g.floor[i] = r2(o.base + vesselTopAt(r));
    vessel[i] = 1;
    o.vessel[kept++] = o.vessel[k];
  }
  o.vessel.length = kept;
  lap('masks');
  // --- masks over the pit rect (local indices): core deck cells, tower footprints (+1 cell); walls = everything else ---------------
  const PWc = o.pit.w, PHc = o.pit.h, NL = PWc * PHc;
  const loc = (x: number, y: number) => (y - Y0) * PWc + (x - X0);
  const core = new Uint8Array(NL), tower = new Int16Array(g.cells.length).fill(-1);
  o.towers.forEach((t, ti) => {
    for (let y = t.y - 1; y < t.y + t.h + 1; y++) for (let x = t.x - 1; x < t.x + t.w + 1; x++) if (g.inBounds(x, y)) tower[g.idx(x, y)] = ti;
  });
  // the inscribed radius: the nearest wall cell (rock, rooms, stair runs, the organ bank) from the vessel axis
  let inscribed = Infinity;
  for (let y = Y0 - 1; y <= Y1; y++) for (let x = X0 - 1; x <= X1; x++) {
    const inside = x >= X0 && y >= Y0 && x < X1 && y < Y1;
    const i = g.idx(x, y);
    const deck = g.cells[i] === FLOOR && g.rampIdx[i] < 0 && areas.has(g.area[i]);
    if (inside && deck) core[loc(x, y)] = 1;
    if (!deck && !vessel[i] && tower[i] < 0) { const dx = (x + 0.5) * CELL - cx, dz = (y + 0.5) * CELL - cz; inscribed = Math.min(inscribed, dx * dx + dz * dz); }
  }
  inscribed = Math.sqrt(inscribed) - CELL * 0.71;
  // pool outer radius: 16 m, or less where the nearest wall / stair run is closer (3 m clear); tower feet stay inside that circle too
  const poolR1 = Math.max(F.poolR1Min, Math.min(F.poolR1, Math.floor((inscribed - F.wallClear) * 2) / 2));
  const footR = inscribed - F.wallClear;
  lap('goop');
  // --- the goop: the annulus + the tower feet ------------------------------------------------------------------------------------
  const goop = new Uint8Array(g.cells.length);
  const towerGoop: number[][] = o.towers.map(() => []);
  const rad2Max = (poolR1 + 6.5) ** 2;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = g.idx(x, y);
    if (!core[loc(x, y)] || vessel[i]) continue;
    const dx = (x + 0.5) * CELL - cx, dz = (y + 0.5) * CELL - cz, d2 = dx * dx + dz * dz;
    if (d2 > rad2Max) continue;
    const r = Math.sqrt(d2);
    const inAnnulus = r >= F.ringR1 && r < poolR1;
    if (inAnnulus || (tower[i] >= 0 && r < footR)) {
      goop[i] = 1;
      if (!inAnnulus) towerGoop[tower[i]].push(i);
    }
  }
  lap('flood');
  // --- the walkable flood (4-connected over the pit rect: core deck cells off the goop / vessel) -----------------------------------
  const queue = new Int32Array(NL + 8), seen = new Uint8Array(NL);
  const walkL = (l: number, i: number) => core[l] === 1 && !vessel[i] && !goop[i];
  const connected = (): boolean => {
    CORE_FLOOR_STATS.floods++;
    seen.fill(0);
    let start = -1, total = 0;
    for (let l = 0; l < NL; l++) {
      if (!core[l]) continue;
      const lx = l % PWc, ly = (l - lx) / PWc, i = g.idx(X0 + lx, Y0 + ly);
      if (vessel[i] || goop[i]) continue;
      total++;
      if (start < 0) { const dx = (X0 + lx + 0.5) * CELL - cx, dz = (Y0 + ly + 0.5) * CELL - cz; if (dx * dx + dz * dz > poolR1 * poolR1) start = l; }
    }
    if (start < 0) return false;
    let h = 0, t = 0, n = 0;
    queue[t++] = start; seen[start] = 1;
    while (h < t) {
      const l = queue[h++]; n++;
      const lx = l % PWc, ly = (l - lx) / PWc;
      if (lx > 0) { const j = l - 1; if (!seen[j] && walkL(j, g.idx(X0 + lx - 1, Y0 + ly))) { seen[j] = 1; queue[t++] = j; } }
      if (lx < PWc - 1) { const j = l + 1; if (!seen[j] && walkL(j, g.idx(X0 + lx + 1, Y0 + ly))) { seen[j] = 1; queue[t++] = j; } }
      if (ly > 0) { const j = l - PWc; if (!seen[j] && walkL(j, g.idx(X0 + lx, Y0 + ly - 1))) { seen[j] = 1; queue[t++] = j; } }
      if (ly < PHc - 1) { const j = l + PWc; if (!seen[j] && walkL(j, g.idx(X0 + lx, Y0 + ly + 1))) { seen[j] = 1; queue[t++] = j; } }
    }
    return n === total;
  };
  lap('dirs');
  // --- bridges: compass directions whose 2.5 m strip over the goop misses every tower foot --------------------------------------
  const dirs: {a: number; cells: number[]; along0: number; along1: number}[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, ux = Math.cos(a), uz = Math.sin(a);
    const cells: number[] = [];
    let ok = true, along0 = Infinity, along1 = -Infinity;
    // the strip's bounding box (along 0 .. poolR1 + 6 m, +-width / 2) in cells
    const L = poolR1 + 6, hw = F.bridgeW / 2 + CELL;
    const xs = [0, L].flatMap(t => [-hw, hw].map(q => cx + ux * t - uz * q)), zs = [0, L].flatMap(t => [-hw, hw].map(q => cz + uz * t + ux * q));
    const bx0 = Math.max(X0, Math.floor(Math.min(...xs) / CELL)), bx1 = Math.min(X1 - 1, Math.floor(Math.max(...xs) / CELL));
    const by0 = Math.max(Y0, Math.floor(Math.min(...zs) / CELL)), by1 = Math.min(Y1 - 1, Math.floor(Math.max(...zs) / CELL));
    for (let y = by0; y <= by1 && ok; y++) for (let x = bx0; x <= bx1; x++) {
      const px = (x + 0.5) * CELL - cx, pz = (y + 0.5) * CELL - cz;
      const along = px * ux + pz * uz, perp = -px * uz + pz * ux;
      if (along <= 0 || Math.abs(perp) > F.bridgeW / 2 + 1e-6) continue;
      const i = g.idx(x, y);
      if (along > F.vesselR && along < poolR1 + 0.5 && (tower[i] >= 0 || g.cells[i] === SOLID)) { ok = false; break; }
      if (!goop[i]) continue;
      cells.push(i);
      along0 = Math.min(along0, along); along1 = Math.max(along1, along);
    }
    if (ok && cells.length) dirs.push({a, cells, along0, along1});
  }
  if (dirs.length < F.minBridges) { CORE_FLOOR_FAILS['bridge-dirs'] = (CORE_FLOOR_FAILS['bridge-dirs'] ?? 0) + 1; return null; }
  const tAngles = o.targets.map(t => ({a: Math.atan2(t.z - cz, t.x - cx), w: t.w}));
  lap('sets');
  const sets: {idx: number[]; score: number}[] = [];
  const pick = (n: number, from: number, cur: number[]) => {
    if (cur.length === n) {
      const as = cur.map(i => dirs[i].a).sort((p, q) => p - q);
      let gap = Infinity;
      for (let i = 0; i < as.length; i++) gap = Math.min(gap, ((as[(i + 1) % as.length] - as[i] + 2 * Math.PI) % (2 * Math.PI)) || 2 * Math.PI);
      let s = (n === F.bridges ? 2000 : 1000) + (gap >= Math.PI / 2 - 1e-6 ? 300 : (gap * 180) / Math.PI);
      for (const t of tAngles) s += t.w * Math.max(...cur.map(i => Math.cos(t.a - dirs[i].a))) * 10;
      sets.push({idx: [...cur], score: s});
      return;
    }
    for (let i = from; i < dirs.length; i++) { cur.push(i); pick(n, i + 1, cur); cur.pop(); }
  };
  for (let n = Math.min(F.bridges, dirs.length); n >= F.minBridges; n--) pick(n, 0, []);
  lap('sort');
  sets.sort((p, q) => q.score - p.score || (p.idx.join() < q.idx.join() ? -1 : p.idx.join() > q.idx.join() ? 1 : 0));
  const tryTowers = [true, false];
  let chosen: number[] | null = null;
  for (const withTowerFeet of tryTowers) {
    if (!withTowerFeet) for (const list of towerGoop) for (const i of list) goop[i] = 0; // the outer floor got cut: towers' outer feet stay deck
    for (const s of sets) {
      for (const di of s.idx) for (const i of dirs[di].cells) goop[i] = 0;
      if (connected()) { chosen = s.idx; break; }
      for (const di of s.idx) for (const i of dirs[di].cells) goop[i] = 1;
    }
    if (chosen) break;
    // everything open (all valid bridges) as the last resort of this pass
    for (const d of dirs) for (const i of d.cells) goop[i] = 0;
    if (connected()) { chosen = dirs.map((_, i) => i); break; }
    for (const d of dirs) for (const i of d.cells) goop[i] = 1;
  }
  if (!chosen) { CORE_FLOOR_FAILS['bridge-connect'] = (CORE_FLOOR_FAILS['bridge-connect'] ?? 0) + 1; return null; }
  lap('apply');
  // --- apply: the pool floor --------------------------------------------------------------------------------------------------------
  const pool: number[] = [];
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = g.idx(x, y);
    if (!goop[i]) continue;
    g.floor[i] = r2(o.base - F.depth);
    pool.push(i);
  }
  const towersIn = o.towers.map((t, ti) => ({t, ti})).filter(({ti}) => pool.some(i => tower[i] === ti)).map(q => q.ti);
  const bridges = chosen.map(di => ({angle: dirs[di].a, width: F.bridgeW, along0: dirs[di].along0, along1: dirs[di].along1})).sort((p, q) => p.angle - q.angle);
  lap('loops');
  const loops = planLoops(cx, cz, poolR1, bridges.map(b => b.angle), o.towers.map(t => ({x0: t.x * CELL, z0: t.y * CELL, x1: (t.x + t.w) * CELL, z1: (t.y + t.h) * CELL})),
    o.overhead.map(d => ({...d, y: d.y - o.base})));
  lap('end');
  return {pool, W, pit: {...o.pit}, cx, cz, base: o.base, poolR1, bridges, towers: towersIn, loops};
}


/**
 * The coolant loops on the goop: per loop a steam generator, its manifold and its vertical pump, side by side along the loop circle
 * in the free arcs between the bridges (clear of the bridges, the tower feet and each other). Pass 1 packs each gap's loops in order
 * (forward or backward, whichever places more); pass 2 puts a loop's missing piece in the nearest free arc anywhere round the
 * circle (a tower foot can split a gap). Pieces that find no room at all are null.
 */
export function planLoops(cx: number, cz: number, poolR1: number, bridgeAngles: readonly number[], towers: readonly {x0: number; z0: number; x1: number; z1: number}[],
  overhead: readonly {x0: number; z0: number; x1: number; z1: number; y: number}[] = []): CoreLoopPlan[] {
  const F = CORE_FLOOR, R = (F.ringR1 + poolR1) / 2, TAU = 2 * Math.PI;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  const sorted = [...bridgeAngles].map(norm).sort((p, q) => p - q);
  const arc = (a: number, b: number) => Math.abs(norm(a - b + Math.PI) - Math.PI) * R;
  const placed: {a: number; half: number}[] = [];
  /** Top of a piece above the deck (the pool floor is `depth` below it). */
  const topOf = (half: number) => (half === F.sgHalf ? F.sgH - F.depth : half === F.rcpHalf ? F.rcpH + F.rcpLift - F.depth : F.manifoldBase + F.manifoldH);
  const free = (a: number, half: number): boolean => {
    for (const b of sorted) if (arc(a, b) < half + F.bridgeW / 2 + F.bridgeClear) return false;
    for (const p of placed) if (arc(a, p.a) < half + p.half + F.pieceGap) return false;
    const px = cx + Math.cos(a) * R, pz = cz + Math.sin(a) * R, m = half + 0.35;
    for (const t of towers) if (px > t.x0 - m && px < t.x1 + m && pz > t.z0 - m && pz < t.z1 + m) return false;
    // never under a deck above (its steel hangs ~1.2 m under the deck plate)
    const top = topOf(half);
    for (const d of overhead) if (d.y - 1.3 < top && px > d.x0 - m && px < d.x1 + m && pz > d.z0 - m && pz < d.z1 + m) return false;
    return true;
  };
  const gaps = sorted.length ? sorted.map((a, i) => ({a0: a, a1: i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU})) : [{a0: 0, a1: TAU}];
  const share = gaps.map(() => 0);
  for (let k = 0; k < F.loops; k++) {
    let best = 0, bv = -Infinity;
    gaps.forEach((gp, i) => { const v = (gp.a1 - gp.a0) / (share[i] + 1); if (v > bv + 1e-9) { bv = v; best = i; } });
    share[best]++;
  }
  const HALF = [F.sgHalf, F.manifoldHalf, F.rcpHalf] as const;
  const step = 0.25 / R;
  type Slots = [number | null, number | null, number | null];
  /** First-fit of pieces `order` scanning [a0, a1] forward (dir 1) or backward (-1); returns the angles found. */
  const pack = (a0: number, a1: number, order: readonly number[], dir: 1 | -1): (number | null)[] => {
    const got: (number | null)[] = order.map(() => null);
    let cur = dir > 0 ? a0 : a1;
    order.forEach((k, j) => {
      const h = HALF[k] / R;
      for (let t = cur; dir > 0 ? t + 2 * h <= a1 : t - 2 * h >= a0; t += dir * step) {
        const c = t + dir * h;
        if (free(c, HALF[k])) { got[j] = c; placed.push({a: c, half: HALF[k]}); cur = c + dir * (h + F.pieceGap / R); break; }
      }
    });
    return got;
  };
  const loops: Slots[] = [];
  gaps.forEach((gp, gi) => {
    if (!share[gi]) return;
    const order: number[] = [];
    for (let n = 0; n < share[gi]; n++) order.push(0, 1, 2);
    const mark = placed.length;
    const fwd = pack(gp.a0, gp.a1, order, 1);
    const nf = fwd.filter(v => v !== null).length;
    const keepF = placed.splice(mark);
    const bwd = pack(gp.a0, gp.a1, order, -1);
    const nb = bwd.filter(v => v !== null).length;
    let use = bwd;
    if (nf >= nb) { placed.splice(mark); placed.push(...keepF); use = fwd; }
    for (let n = 0; n < share[gi]; n++) loops.push([use[3 * n], use[3 * n + 1], use[3 * n + 2]]);
  });
  // pass 2: a loop's missing piece in the nearest free arc anywhere
  for (const sl of loops) {
    const have = sl.filter((v): v is number => v !== null);
    const home = have.length ? have[0] : 0;
    for (let k = 0; k < 3; k++) {
      if (sl[k] !== null) continue;
      for (let d = 0; d <= Math.PI; d += step) {
        const hit = [home + d, home - d].find(c => free(c, HALF[k]));
        if (hit !== undefined) { sl[k] = hit; placed.push({a: hit, half: HALF[k]}); break; }
      }
    }
  }
  const pose = (c: number, xAlong: 'tangent' | 'radial') => {
    const ux = Math.cos(c), uz = Math.sin(c);
    // model +X goes along (cos yaw, -sin yaw), +Z along (sin yaw, cos yaw): 'tangent' = +X along the counter-clockwise tangent
    // (= front +Z facing the vessel), 'radial' = +X pointing away from the vessel
    const yaw = xAlong === 'tangent' ? Math.atan2(-ux, -uz) : Math.atan2(-uz, ux);
    return {x: r3(cx + ux * R), z: r3(cz + uz * R), yaw: r3(Math.atan2(Math.sin(yaw), Math.cos(yaw)))};
  };
  const out: CoreLoopPlan[] = [];
  for (const [sgA, mA, pA] of loops) {
    const used = [sgA, mA, pA].filter((v): v is number => v !== null);
    if (!used.length) continue;
    out.push({
      angle: r3(norm(Math.atan2(used.reduce((s, v) => s + Math.sin(v), 0), used.reduce((s, v) => s + Math.cos(v), 0)))),
      sg: sgA !== null ? pose(sgA, 'tangent') : null,
      manifold: mA !== null ? pose(mA, 'radial') : null,
      rcp: pA !== null ? pose(pA, 'radial') : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 2. After the crop: block the pool, the loops' collision, the turbine generator

/** The goop cells as indices of a (cropped, origin 0) grid. */
export function poolCells(cf: CoreFloorCarve, g: Grid): number[] {
  return cf.pool.map(i => { const x = i % cf.W, y = (i - x) / cf.W; return g.idx(x, y); });
}

/** A round anchored-plant collision prop ('annexMachine', round: the player / bullets meet its cylinder), cells blocked + sight-blocked. */
function roundProp(layout: StationLayout, area: number, x: number, z: number, r: number, h: number): number {
  const p: PropPlacement = {kind: 'annexMachine', x: r3(x), z: r3(z), y: 0, rot: 0, area, hx: r3(r), hz: r3(r), h, blocksSight: true, variant: 2, level: CORE_LEVEL, round: true};
  layout.props.push(p);
  const g = layout.levels[CORE_LEVEL].grid;
  for (let cy = Math.floor((z - r) / CELL); cy <= Math.floor((z + r) / CELL); cy++) for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
    if (!g.inBounds(cx, cy) || Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - z) > r) continue;
    const i = g.idx(cx, cy);
    g.blocked[i] = 1; g.sightBlocked[i] = 1;
  }
  return layout.props.length - 1;
}

export interface CoreFloorFinish {
  loops: ReactorCoreFloor['loops'];
  turbine: ReactorCoreFloor['turbine'];
}

/**
 * After the crop (canvas = grid cells): the goop cells blocked, the loop pieces' collision props, the turbine generator on the outer
 * floor. `keep` = points that stay clear (link landings, ladder feet, room doors): the turbine keeps 4 m from each.
 */
export function finishCoreFloor(layout: StationLayout, cf: CoreFloorCarve, coreAreas: readonly number[], keep: readonly {x: number; z: number}[]): CoreFloorFinish {
  const F = CORE_FLOOR, g = layout.levels[CORE_LEVEL].grid;
  for (const i of poolCells(cf, g)) g.blocked[i] = 1;
  const areaAt = (x: number, z: number) => { const [a, b] = g.cellOf(x, z); return g.inBounds(a, b) ? g.area[g.idx(a, b)] : coreAreas[0] ?? 0; };
  const loops: ReactorCoreFloor['loops'][number][] = cf.loops.map(l => ({
    angle: l.angle,
    sg: l.sg ? {...l.sg, prop: roundProp(layout, areaAt(l.sg.x, l.sg.z), l.sg.x, l.sg.z, F.sgHalf - 0.1, F.sgH)} : null,
    rcp: l.rcp ? {...l.rcp, prop: roundProp(layout, areaAt(l.rcp.x, l.rcp.z), l.rcp.x, l.rcp.z, F.rcpHalf, F.rcpH + F.rcpLift)} : null,
    manifold: l.manifold ? {...l.manifold} : null,
  }));
  const t0 = now();
  const turbine = placeTurbine(layout, cf, coreAreas, keep);
  CORE_FLOOR_STATS.finishMs = now() - t0;
  return {loops, turbine};
}

/** The turbine generator against a wall of the outer core floor: nearest the vessel, 4 m from every keep point / door, routes intact. */
function placeTurbine(layout: StationLayout, cf: CoreFloorCarve, coreAreas: readonly number[], keep: readonly {x: number; z: number}[]): ReactorCoreFloor['turbine'] {
  const T = CORE_FLOOR.turbine, g = layout.levels[CORE_LEVEL].grid, W = g.w, H = g.h;
  const areas = new Set(coreAreas);
  // deck mask + its summed-area table over the pit rect + 1 (a rect is all deck / has no deck in O(1))
  const PX = cf.pit.x - 1, PY = cf.pit.y - 1, PW = cf.pit.w + 2, PH = cf.pit.h + 2;
  const sat = new Int32Array((PW + 1) * (PH + 1));
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let ly = 0; ly < PH; ly++) {
    let row = 0;
    const y = PY + ly;
    for (let lx = 0; lx < PW; lx++) {
      const x = PX + lx;
      let d = 0;
      if (x >= 0 && y >= 0 && x < W && y < H) { const i = y * W + x; d = g.cells[i] === FLOOR && g.rampIdx[i] < 0 && !g.blocked[i] && areas.has(g.area[i]) ? 1 : 0; }
      if (d) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      row += d;
      sat[(ly + 1) * (PW + 1) + lx + 1] = sat[ly * (PW + 1) + lx + 1] + row;
    }
  }
  const decks = (x0: number, y0: number, w: number, h: number): number => {
    const xa = Math.max(0, x0 - PX), ya = Math.max(0, y0 - PY), xb = Math.min(PW, x0 + w - PX), yb = Math.min(PH, y0 + h - PY);
    if (xb <= xa || yb <= ya) return 0;
    return sat[yb * (PW + 1) + xb] - sat[ya * (PW + 1) + xb] - sat[yb * (PW + 1) + xa] + sat[ya * (PW + 1) + xa];
  };
  const doors = layout.doors.filter(d => areas.has(d.a) || areas.has(d.b)).map(d => ({x: (d.x + d.w / 2) * CELL, z: (d.y + d.h / 2) * CELL}));
  const avoid = [...keep, ...doors];
  type Cand = {x0: number; y0: number; w: number; h: number; axis: 'x' | 'z'; out: [number, number]; score: number};
  const cands: Cand[] = [];
  // candidate corners along the deck's outline only: per column its first / last deck row, per row its first / last deck column
  const isDeck = (x: number, y: number) => decks(x, y, 1, 1) === 1;
  const starts: [number, number][] = [];
  for (let x = bx0; x <= bx1; x++) {
    let a = -1, b = -1;
    for (let y = by0; y <= by1; y++) if (isDeck(x, y)) { if (a < 0) a = y; b = y; }
    if (a >= 0) starts.push([x, a], [x, b - T.dep + 1], [x, b - T.len + 1]);
  }
  for (let y = by0; y <= by1; y++) {
    let a = -1, b = -1;
    for (let x = bx0; x <= bx1; x++) if (isDeck(x, y)) { if (a < 0) a = x; b = x; }
    if (a >= 0) starts.push([a, y], [b - T.len + 1, y], [b - T.dep + 1, y]);
  }
  const tried = new Set<number>();
  for (const [x, y] of starts) {
    if (tried.has(y * W + x)) continue;
    tried.add(y * W + x);
    for (const [axis, w, h] of [['x', T.len, T.dep], ['z', T.dep, T.len]] as const) {
      if (decks(x, y, w, h) !== w * h) continue;
      // backed by a wall: the row / column just beyond one long side holds no deck
      const sides: [number, number][] = axis === 'x' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      for (const [ox, oy] of sides) {
        const beyond = axis === 'x' ? decks(x, oy < 0 ? y - 1 : y + h, w, 1) : decks(ox < 0 ? x - 1 : x + w, y, 1, h);
        if (beyond) continue;
        const mx = (x + w / 2) * CELL, mz = (y + h / 2) * CELL, hw = (w * CELL) / 2, hh = (h * CELL) / 2;
        // the corridor between it and the goop rail: >= 3 m
        if (Math.hypot(Math.max(Math.abs(cf.cx - mx) - hw, 0), Math.max(Math.abs(cf.cz - mz) - hh, 0)) < cf.poolR1 + 3) continue;
        if (avoid.some(p => Math.hypot(Math.max(0, Math.abs(p.x - mx) - hw), Math.max(0, Math.abs(p.z - mz) - hh)) < 4)) continue;
        cands.push({x0: x, y0: y, w, h, axis, out: [-ox, -oy], score: Math.hypot(mx - cf.cx, mz - cf.cz)});
      }
    }
  }
  if (!cands.length) return null;
  // nearest the vessel (in view of it), deterministic tie-break
  cands.sort((p, q) => p.score - q.score || p.y0 - q.y0 || p.x0 - q.x0);
  for (const c of cands.slice(0, 12)) {
    const saved: number[] = [];
    for (let y = c.y0; y < c.y0 + c.h; y++) for (let x = c.x0; x < c.x0 + c.w; x++) { const i = g.idx(x, y); saved.push(i); g.blocked[i] = 1; }
    CORE_FLOOR_STATS.floods++;
    if (deckConnected(g, areas, cf.pit)) {
      const x = (c.x0 + c.w / 2) * CELL, z = (c.y0 + c.h / 2) * CELL;
      const hx = (c.w * CELL) / 2 - 0.05, hz = (c.h * CELL) / 2 - 0.05;
      const p: PropPlacement = {kind: 'annexMachine', x: r3(x), z: r3(z), y: 0, rot: 0, area: g.area[g.idx(c.x0, c.y0)], hx: r3(hx), hz: r3(hz), h: T.h, blocksSight: true, variant: 3, level: CORE_LEVEL};
      layout.props.push(p);
      for (const i of saved) g.sightBlocked[i] = 1;
      // model +X along the run, front (+Z) facing out of the wall
      const [fx, fz] = c.out;
      const yaw = c.axis === 'x' ? (fz > 0 ? 0 : Math.PI) : (fx > 0 ? Math.PI / 2 : -Math.PI / 2);
      return {x: r3(x), z: r3(z), axis: c.axis, yaw: r3(yaw), prop: layout.props.length - 1};
    }
    for (const i of saved) g.blocked[i] = 0;
  }
  return null;
}

/** Every unblocked core-area deck cell of the pit rect in one 4-connected piece. */
function deckConnected(g: Grid, areas: ReadonlySet<number>, pit: {x: number; y: number; w: number; h: number}): boolean {
  const W = g.w, n = pit.w * pit.h;
  const ok = new Uint8Array(n);
  let start = -1, total = 0;
  for (let ly = 0; ly < pit.h; ly++) for (let lx = 0; lx < pit.w; lx++) {
    const i = (pit.y + ly) * W + pit.x + lx;
    if (g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && areas.has(g.area[i])) { const l = ly * pit.w + lx; ok[l] = 1; total++; if (start < 0) start = l; }
  }
  if (start < 0) return true;
  const q = new Int32Array(total + 4);
  let h = 0, t = 0, c = 0;
  q[t++] = start; ok[start] = 2;
  while (h < t) {
    const l = q[h++]; c++;
    const lx = l % pit.w;
    if (lx > 0 && ok[l - 1] === 1) { ok[l - 1] = 2; q[t++] = l - 1; }
    if (lx < pit.w - 1 && ok[l + 1] === 1) { ok[l + 1] = 2; q[t++] = l + 1; }
    if (l >= pit.w && ok[l - pit.w] === 1) { ok[l - pit.w] = 2; q[t++] = l - pit.w; }
    if (l + pit.w < n && ok[l + pit.w] === 1) { ok[l + pit.w] = 2; q[t++] = l + pit.w; }
  }
  return c === total;
}

// ---------------------------------------------------------------------------------------------
// 3. The record, the baked green sources, the smooth-railing seam

/**
 * The core floor's own lamps (GASLIGHT's mounted-lamp contract, gen/reactor/gaslightLamps.ts: a post on the railing line, its head over
 * the walkway): one per bridge side pair, four round the service ring between the bridges (clear of the coolant legs overhead).
 * Head height / arm reach; the first lamp of each set is a steady emergency lamp, the rest join the powered circuit 2.
 */
export const CORE_POST_LAMPS = {headY: 2.5, arm: 0.5, emergency: 0.55, powered: 0.9} as const;

/** The baked goop glow: virtual green sources round the loop circle (half steady, half on the powered circuit 2). */
export const CORE_GLOW_SOURCES = {count: 12, lift: 3.4, tint: [0.32, 1.0, 0.42] as const, power: 1.0} as const;

export function coreFloorRecord(layout: StationLayout, cf: CoreFloorCarve, fin: CoreFloorFinish): ReactorCoreFloor {
  const F = CORE_FLOOR, g = layout.levels[CORE_LEVEL].grid, base = cf.base;
  const poolSet = new Set(poolCells(cf, g));
  // the pool's cell-edge collision rails along the ring / outer circles and the bridges are hidden (drawn round by the hero kit);
  // the tower-foot notches keep their (straight) drawn railings; the vessel's own derived rails (its raised top) are never drawn
  let ringRail: number = F.ringR1, outerRail = cf.poolR1;
  let ringMax = 0, outerMin = Infinity;
  const bridgeHalf = cf.bridges.map(b => b.width / 2);
  const near = (r: number, R: number) => Math.abs(r - R) < 0.75;
  for (const rl of layout.rails) {
    if ((rl.level ?? 0) !== CORE_LEVEL) continue;
    const mx = (rl.x0 + rl.x1) / 2, mz = (rl.z0 + rl.z1) / 2;
    const [wx, wz] = g.cellOf(mx + rl.nx * 0.25, mz + rl.nz * 0.25), [bx, bz] = g.cellOf(mx - rl.nx * 0.25, mz - rl.nz * 0.25);
    if (!g.inBounds(wx, wz) || !g.inBounds(bx, bz)) continue;
    const wi = g.idx(wx, wz), bi = g.idx(bx, bz);
    const vesselSide = g.blocked[wi] && !poolSet.has(wi) && Math.hypot(mx - cf.cx, mz - cf.cz) <= F.vesselR + 0.5;
    if (vesselSide) { (rl as {hidden?: boolean}).hidden = true; continue; }
    if (!poolSet.has(bi) || poolSet.has(wi)) continue;
    const r = Math.hypot(mx - cf.cx, mz - cf.cz), rMax = Math.max(Math.hypot(rl.x0 - cf.cx, rl.z0 - cf.cz), Math.hypot(rl.x1 - cf.cx, rl.z1 - cf.cz));
    const rMin = Math.min(Math.hypot(rl.x0 - cf.cx, rl.z0 - cf.cz), Math.hypot(rl.x1 - cf.cx, rl.z1 - cf.cz));
    const onBridge = cf.bridges.some((b, bi) => {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), px = mx - cf.cx, pz = mz - cf.cz;
      const along = px * ux + pz * uz, perp = Math.abs(-px * uz + pz * ux);
      if (!(along > F.ringR1 - 0.6 && along < b.along1 + 0.8 && perp < b.width / 2 + 0.9)) return false;
      for (const [ex, ez] of [[rl.x0, rl.z0], [rl.x1, rl.z1]]) bridgeHalf[bi] = Math.max(bridgeHalf[bi], Math.abs(-(ex - cf.cx) * uz + (ez - cf.cz) * ux));
      return true;
    });
    if (onBridge) { (rl as {hidden?: boolean}).hidden = true; continue; }
    if (near(r, F.ringR1)) { (rl as {hidden?: boolean}).hidden = true; ringMax = Math.max(ringMax, rMax); continue; }
    if (near(r, cf.poolR1)) { (rl as {hidden?: boolean}).hidden = true; outerMin = Math.min(outerMin, rMin); }
  }
  if (ringMax > 0) ringRail = r3(ringMax);
  if (Number.isFinite(outerMin)) outerRail = r3(outerMin);
  // the baked goop glow (fixture-less, tinted; steady = dormant glow, dying = the powered circuit the restart brings up)
  const n = CORE_GLOW_SOURCES.count, R = (F.ringR1 + cf.poolR1) / 2;
  const a0 = cf.bridges.length ? cf.bridges[0].angle + Math.PI / n : 0;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k * 2 * Math.PI) / n, x = cf.cx + Math.cos(a) * R, z = cf.cz + Math.sin(a) * R;
    const [ix, iz] = g.cellOf(x, z);
    if (!g.inBounds(ix, iz) || g.cells[g.idx(ix, iz)] !== FLOOR) continue;
    const l: LightPlacement = {
      x: r3(x), y: r3(base + CORE_GLOW_SOURCES.lift), z: r3(z), rot: 0, area: g.area[g.idx(ix, iz)], broken: false, flicker: false, warm: false,
      power: CORE_GLOW_SOURCES.power, dying: k % 2 === 1, level: CORE_LEVEL, virtual: true, tint: CORE_GLOW_SOURCES.tint,
    };
    layout.lights.push(l);
  }
  // the mounted post lamps of the bridges and the service ring (real fixtures: the core floor's own light besides the glow)
  const PL = CORE_POST_LAMPS;
  const post = (foot: {x: number; z: number}, nx: number, nz: number, emergency: boolean) => {
    const hx = foot.x + nx * PL.arm, hz = foot.z + nz * PL.arm;
    const [ix, iz] = g.cellOf(hx, hz);
    if (!g.inBounds(ix, iz) || g.cells[g.idx(ix, iz)] !== FLOOR || g.blocked[g.idx(ix, iz)]) return;
    const mount: LightMount = {kind: 'post', x: r3(foot.x), y: base, z: r3(foot.z), nx: r3(nx), nz: r3(nz)};
    layout.lights.push({
      x: r3(hx), y: r3(base + PL.headY), z: r3(hz), rot: Math.abs(nx) > Math.abs(nz) ? Math.PI / 2 : 0, area: g.area[g.idx(ix, iz)], broken: false, flicker: false,
      warm: true, power: emergency ? PL.emergency : PL.powered, dying: !emergency, level: CORE_LEVEL, mount,
    });
  };
  cf.bridges.forEach((b, bi) => {
    const ux = Math.cos(b.angle), uz = Math.sin(b.angle), nx = -uz, nz = ux, half = bridgeHalf[bi];
    const mid = (F.ringR1 + cf.poolR1) / 2;
    [[-1, mid - 1.4], [1, mid + 1.4]].forEach(([side, along], k) => {
      post({x: cf.cx + ux * along + nx * side * half, z: cf.cz + uz * along + nz * side * half}, -nx * side, -nz * side, k === 0);
    });
  });
  {
    const legs = fin.loops.flatMap(l => [l.sg, l.rcp].filter((p): p is NonNullable<typeof p> => !!p).map(p => Math.atan2(p.z - cf.cz, p.x - cf.cx)));
    const dAng = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    const bs = cf.bridges.map(b => b.angle).sort((p, q) => p - q);
    const mids = bs.length ? bs.map((a, i) => (a + (i + 1 < bs.length ? bs[i + 1] : bs[0] + 2 * Math.PI)) / 2) : [0, Math.PI / 2, Math.PI, 1.5 * Math.PI];
    mids.forEach((m, k) => {
      const a = [0, 0.14, -0.14, 0.28, -0.28, 0.42, -0.42].map(o => m + o).find(c => legs.every(l => dAng(c, l) > 0.2) && cf.bridges.every(b => dAng(c, b.angle) > 0.3));
      if (a === undefined) return;
      const ux = Math.cos(a), uz = Math.sin(a), r = Math.max(F.ringR1, ringRail);
      post({x: cf.cx + ux * r, z: cf.cz + uz * r}, -ux, -uz, k % 2 === 0);
    });
  }
  const axis = (b: CoreFloorCarve['bridges'][number], bi: number) => {
    const ux = Math.cos(b.angle), uz = Math.sin(b.angle), a = Math.max(F.ringR1 - 0.6, b.along0 - 0.35), e = b.along1 + 0.35;
    return {angle: r3(b.angle), width: b.width, rail: r3(bridgeHalf[bi]), x0: r3(cf.cx + ux * a), z0: r3(cf.cz + uz * a), x1: r3(cf.cx + ux * e), z1: r3(cf.cz + uz * e)};
  };
  return {
    version: 1, x: r3(cf.cx), z: r3(cf.cz), y: base, vesselR: F.vesselR,
    ring: {r0: F.vesselR, r1: F.ringR1},
    pool: {r0: F.ringR1, r1: cf.poolR1, surfaceY: r3(base - F.depth + F.surface), floorY: r3(base - F.depth), cells: cf.pool.length},
    bridges: cf.bridges.map(axis), towers: cf.towers.slice(), loops: fin.loops, turbine: fin.turbine,
    rails: {ring: ringRail, outer: outerRail},
  };
}

// ---------------------------------------------------------------------------------------------
// 4. Validation

/** The core floor's own rules (reactorIssues adds them): pool blocked + below the deck, bridges, the vessel, the loops on the goop. */
export function coreFloorIssues(layout: StationLayout): string[] {
  const out: string[] = [];
  const cf = layout.reactor?.coreFloor;
  if (!cf) return ['core floor: no record'];
  const g = layout.levels[CORE_LEVEL]?.grid;
  if (!g) return ['core floor: no core grid'];
  let n = 0, bad = 0;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== FLOOR || Math.abs(g.floor[i] - cf.pool.floorY) > 1e-3) continue;
    n++;
    if (!g.blocked[i]) bad++;
  }
  if (n !== cf.pool.cells) out.push(`core floor: ${n} pool cells, record ${cf.pool.cells}`);
  if (bad) out.push(`core floor: ${bad} pool cells walkable`);
  if (cf.y - cf.pool.floorY <= 1.3) out.push('core floor: the pool is too shallow to derive its railings');
  if (cf.bridges.length < CORE_FLOOR.minBridges) out.push(`core floor: ${cf.bridges.length} bridges`);
  for (const b of cf.bridges) if (b.width < 2) out.push('core floor: a bridge narrower than 2 m');
  if (!cf.loops.length || cf.loops.filter(l => l.sg && l.rcp).length < 2) out.push('core floor: fewer than 2 complete coolant loops');
  for (const l of cf.loops) for (const p of [l.sg, l.rcp]) if (p && layout.props[p.prop]?.kind !== 'annexMachine') out.push('core floor: a loop prop record');
  return out;
}
