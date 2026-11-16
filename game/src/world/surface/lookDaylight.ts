// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE DISTRICT'S BAKED DAYLIGHT — an overcast sky term added into
// the station light field's direct light (FieldSource.extraDirect, like the mall's glass-roof skylight: world/mallSkylight.ts), so the
// streets, sidewalks and facades are lit by the sky and the building interiors stay dim, lit only through their doorways, broken /
// glazed window spans and (the tent) its canvas. PURE (no three.js / DOM).
//
// Outdoors (every level-0 outdoor cell, one evaluation per REP x REP block and layer): the sky above the local horizon. A 2.5-D
// height field of the district (building roof lines incl. ruin profiles, the cordon wall, the tent, debris) is marched along NA
// azimuths — fine cells near the receiver, coarse max-height texels beyond — and the open elevation band [horizon, zenith] of every
// azimuth integrates analytically (the mall's formulas):
//   fluence   += L dphi (1 - sin th)               direction += L dphi [ (pi/4 - th/2 - sin 2th / 4) (cos phi, sin phi), cos^2 th / 2 ]
// so a street between tall blocks is darker than a plaza, a facade's foot darker than its top, a kerb under a wall half-lit.
// Indoors: each opening (an entrance that is open / smashed, AIR's window spans per pane state, the tent canvas) is an area source of
// the outdoor radiance seen through it, sampled every ~1 m; receivers within DAYLIGHT.reach on the room side with a clear 2-D line
// of sight through open cells get dA cos / d^2 of it (toward the opening).
// Never green: the overcast is a warm grey with a faint yellow cast (DAYLIGHT.tint); the toxic gas is AIR's own visible term.

import {CELL, FLOOR} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import type {BuildSteps} from '../../core/pacedBuild';
import type {ExtraDirectContext} from '../lightField';
import {GROUND, LOOK_TUNE, OWNER, SIDE_NORMAL, entranceFloor, surfaceLookPlan, topAt, type SurfaceLookPlan} from './archPlan';

/** Daylight tunables (field units: FIELD_EMAX 12 = the encode ceiling; a fixture pool is ~2-4). */
export const DAYLIGHT = {
  /** Overcast sky radiance per steradian (open-sky fluence = 2 pi L). */
  radiance: 0.62,
  /** Overcast tint (linear RGB, ~unit luminance): warm grey, a faint yellow cast. Never green. */
  tint: [1.02, 0.99, 0.86] as readonly [number, number, number],
  /** Azimuth samples, longest march (m), the fine (cell) and mid (coarse-texel) ranges (m), the coarse texel (cells; far = 2x). */
  azimuths: 8, march: 90, fine: 6, mid: 40, coarse: 4,
  /** Receivers are evaluated once per REP x REP cells (the field is downsampled to ~1 m texels anyway). */
  rep: 2,
  /** Outdoor block rows per bake step (the term yields between them). */
  rowsPerStep: 24,
  /** Indoors: reach of an opening (m), the radiance seen through an opening (x the sky), pane / door / canvas transmittance. */
  reach: 11, through: 0.5, glass: 0.62, cracked: 0.45, boarded: 0.04, closedDoor: 0.18, canvas: 0.16,
  /** The ground's bounce under the sky is the bake's own bounce pass (not added here). */
} as const;

export interface DaylightStats {
  ms: number; receivers: number; marches: number; openings: number; openingSamples: number; indoorCells: number; maxE: number; outdoorMeanE: number;
}

type Ctx = ExtraDirectContext;

let last: DaylightStats | null = null;
/** The last district daylight bake's stats (QA / the report). */
export const daylightStats = (): DaylightStats | null => last;

/** The FieldSource hook of a district layout ({} for every other layout: nothing changes there). */
export function surfaceSkyField(layout: StationLayout): {extraDirectSteps?: (ctx: Ctx) => BuildSteps<Record<string, number>>} {
  const plan = layout.surface ? surfaceLookPlan(layout) : null;
  if (!plan) return {};
  return {extraDirectSteps: function* (ctx) { const st = yield* bakeDaylight(layout, plan, ctx); last = st; return {...st}; }};
}

/** The bake input digest of the district's daylight (world/lights.ts stationBakeInput `extra`): what the term depends on. */
export function surfaceDaylightDigest(layout: StationLayout): string {
  const plan = layout.surface ? surfaceLookPlan(layout) : null;
  if (!plan) return '';
  return JSON.stringify(['surface-daylight-1', DAYLIGHT, LOOK_TUNE.cordonH, plan.seed, plan.buildings.map(b => [b.id, b.top, b.minTop, b.sides.map(s => s.tops.length)])]);
}

/** Per-cell obstruction top (absolute y) of the district: roofs (ruin profiles), the cordon, the tent, debris; open ground = its floor. */
export function obstructionTops(layout: StationLayout, plan: SurfaceLookPlan): Float32Array {
  const g = layout.grid, W = g.w, H = g.h, out = new Float32Array(W * H);
  const tent = plan.tent;
  for (let i = 0; i < W * H; i++) {
    const o = plan.owner[i];
    const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
    if (o >= 0) {
      const b = plan.buildings[o];
      if (!b) continue;
      const fp = b.b.footprint;
      // the nearest facade side's roof line at this point (ruin notches / jagged tops read from the street)
      const dN = z - fp.z0, dS = fp.z1 - z, dW = x - fp.x0, dE = fp.x1 - x, m = Math.min(dN, dS, dW, dE);
      const side = m === dN ? 'N' : m === dS ? 'S' : m === dW ? 'W' : 'E';
      const sd = b.sides.find(s => s.side === side)!;
      out[i] = topAt(sd, SIDE_NORMAL[side].alongX ? x : z, b.top);
    } else if (o === OWNER.cordon) out[i] = LOOK_TUNE.cordonH + 0.2;
    else if (o === OWNER.tent) out[i] = tent ? tent.eave : LOOK_TUNE.tentEave;
    else if (o === OWNER.debris) out[i] = LOOK_TUNE.debrisH;
    else if (tent && plan.ground[i] === GROUND.tent) out[i] = tent.ridge;
    else out[i] = g.cells[i] === FLOOR ? g.floor[i] : 0;
  }
  return out;
}

const OUTDOOR = new Set<number>([GROUND.road, GROUND.walk, GROUND.lot, GROUND.plaza, GROUND.yard, GROUND.check, GROUND.verge]);

function* bakeDaylight(layout: StationLayout, plan: SurfaceLookPlan, ctx: Ctx): BuildSteps<DaylightStats> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const {W, H} = ctx;
  const stats: DaylightStats = {ms: 0, receivers: 0, marches: 0, openings: 0, openingSamples: 0, indoorCells: 0, maxE: 0, outdoorMeanE: 0};
  const L = DAYLIGHT.radiance, [tr, tg, tb] = DAYLIGHT.tint, tl = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
  const tops = obstructionTops(layout, plan);
  let hmax = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] > hmax) hmax = tops[i];
  // max-height texels: MID (C cells) and FAR (2C cells) for the march's middle and far reaches
  const C = DAYLIGHT.coarse, Wc = Math.ceil(W / C), Hc = Math.ceil(H / C), mid = new Float32Array(Wc * Hc);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = Math.floor(y / C) * Wc + Math.floor(x / C); const v = tops[y * W + x]; if (v > mid[j]) mid[j] = v; }
  const C2 = C * 2, Wf = Math.ceil(W / C2), Hf = Math.ceil(H / C2), far = new Float32Array(Wf * Hf);
  for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) { const j = (y >> 1) * Wf + (x >> 1); const v = mid[y * Wc + x]; if (v > far[j]) far[j] = v; }
  const NA = Math.max(4, DAYLIGHT.azimuths), dphi = Math.PI * 2 / NA;
  const ux = new Float64Array(NA), uz = new Float64Array(NA);
  for (let j = 0; j < NA; j++) { const a = (j + 0.5) * dphi; ux[j] = Math.cos(a); uz[j] = Math.sin(a); }
  // the march's samples: FINE cells to DAYLIGHT.fine, MID texels to DAYLIGHT.mid, FAR texels to DAYLIGHT.march. Distances and the
  // integer cell offsets per azimuth are the same for every receiver of one origin kind (a block corner, frac 0; a cell centre,
  // frac 0.5): precomputed, so a sample is a table read, one load and a slope per layer.
  const dists: number[] = [], tier: number[] = [];
  for (let d = CELL; d <= DAYLIGHT.fine + 1e-9; d += CELL) { dists.push(d); tier.push(0); }
  for (let d = DAYLIGHT.fine + C * CELL; d <= DAYLIGHT.mid + 1e-9; d += C * CELL) { dists.push(d); tier.push(1); }
  for (let d = DAYLIGHT.mid + C2 * CELL; d <= DAYLIGHT.march + 1e-9; d += C2 * CELL) { dists.push(d); tier.push(2); }
  const NS = dists.length, invD = Float64Array.from(dists, d => 1 / d), TIER = Uint8Array.from(tier);
  const offs = [0, 0.5].map(f => {
    const ox = new Int32Array(NA * NS), oz = new Int32Array(NA * NS);
    for (let j = 0; j < NA; j++) for (let q = 0; q < NS; q++) { ox[j * NS + q] = Math.floor(f + ux[j] * dists[q] / CELL); oz[j * NS + q] = Math.floor(f + uz[j] * dists[q] / CELL); }
    return {ox, oz};
  });
  const s0 = 0, geo = ctx.geos[s0], Ls = ctx.layers[s0], E = ctx.E[s0], Dv = ctx.D[s0], EL = ctx.EL[s0];
  const R = Math.max(1, DAYLIGHT.rep);
  const ys = new Float64Array(Ls), slope = new Float64Array(Ls), res = new Float64Array(Ls * 4);
  let sumE = 0, nE = 0;
  const group: number[] = [];
  // --- outdoors (a step every few block rows) ---
  for (let by = 0; by < H; by += R) {
    if ((by / R) % DAYLIGHT.rowsPerStep === 0) yield;
    for (let bx = 0; bx < W; bx += R) {
      group.length = 0;
      for (let yy = by; yy < Math.min(H, by + R); yy++) for (let xx = bx; xx < Math.min(W, bx + R); xx++) {
        const i = yy * W + xx;
        if (geo.open[i] && OUTDOOR.has(plan.ground[i])) group.push(i);
      }
      if (!group.length) continue;
      stats.receivers += group.length;
      // the origin: the block's centre (a cell corner) when the block is whole, else its first receiver's centre
      const rep = group[0], whole = group.length === R * R && R % 2 === 0;
      const mx = whole ? bx + R / 2 : rep % W, mz = whole ? by + R / 2 : Math.floor(rep / W), {ox, oz} = offs[whole ? 0 : 1];
      for (let k = 0; k < Ls; k++) ys[k] = geo.layerY[rep * Ls + k];
      res.fill(0);
      for (let j = 0; j < NA; j++) {
        stats.marches++;
        slope.fill(0);
        for (let q = 0, o = j * NS; q < NS; q++, o++) {
          const x = mx + ox[o], z = mz + oz[o];
          if (x < 0 || z < 0 || x >= W || z >= H) break;
          const t = TIER[q], h = t === 0 ? tops[z * W + x] : t === 1 ? mid[Math.floor(z / C) * Wc + Math.floor(x / C)] : far[Math.floor(z / C2) * Wf + Math.floor(x / C2)];
          const id = invD[q];
          let done = true;
          for (let k = 0; k < Ls; k++) {
            const sl = (h - ys[k]) * id;
            if (sl > slope[k]) slope[k] = sl;
            // nothing further out can rise above this layer's horizon (the district's tallest top at this distance)
            if ((hmax - ys[k]) * id > slope[k]) done = false;
          }
          if (done) break;
        }
        for (let k = 0; k < Ls; k++) {
          const th = Math.atan(slope[k]), st = Math.sin(th);
          const om = dphi * (1 - st);
          const hor = dphi * (Math.PI / 4 - (th / 2 + Math.sin(2 * th) / 4));
          res[k * 4] += L * om; res[k * 4 + 1] += L * hor * ux[j]; res[k * 4 + 3] += L * hor * uz[j]; res[k * 4 + 2] += L * dphi * (1 - st * st) / 2;
        }
      }
      for (let k = 0; k < Ls; k++) {
        const e = res[k * 4];
        if (e <= 0) continue;
        for (const i of group) {
          const vi = (i * Ls + k) * 3;
          E[vi] += e * tr; E[vi + 1] += e * tg; E[vi + 2] += e * tb;
          Dv[vi] += res[k * 4 + 1] * tl; Dv[vi + 1] += res[k * 4 + 2] * tl; Dv[vi + 2] += res[k * 4 + 3] * tl;
          EL[i * Ls + k] += e * tl;
        }
        if (k === 0) { sumE += e * tl; nE++; }
        if (e * tl > stats.maxE) stats.maxE = e * tl;
      }
    }
  }
  stats.outdoorMeanE = nE ? sumE / nE : 0;
  // --- indoors: the openings as area sources of the outdoor radiance ---
  const S = layout.surface!;
  // field slots are the layout's levels in order (stationLevels; the bake may keep fewer)
  const slotOf = (level: number): number => level >= 0 && level < ctx.geos.length ? level : -1;
  const baseOf = (level: number): number => layout.levels[level]?.baseY ?? 0;
  const Lout = L * DAYLIGHT.through;
  type Opening = {slot: number; x: number; z: number; y0: number; y1: number; nx: number; nz: number; w: number; trans: number};
  const openings: Opening[] = [];
  for (const b of S.buildings) {
    for (const e of b.entrances) {
      const trans = e.door === 'boarded' ? 0 : e.door === 'closed' ? DAYLIGHT.closedDoor : 1;
      if (trans <= 0) continue;
      const {alongX, n} = SIDE_NORMAL[e.side];
      const base = entranceFloor(layout, e);
      // the opening's inner face: half a cell inside the facade line, facing into the building (-n)
      openings.push({slot: slotOf(e.level), x: alongX ? e.x : e.x - n * CELL, z: alongX ? e.z - n * CELL : e.z, y0: base, y1: base + e.height, nx: alongX ? 0 : -n, nz: alongX ? -n : 0, w: e.width, trans});
    }
  }
  for (const sp of S.windows) {
    const {alongX, n} = SIDE_NORMAL[sp.side];
    const base = baseOf(sp.level);
    const inner = alongX ? (n > 0 ? sp.z0 : sp.z1) : (n > 0 ? sp.x0 : sp.x1);
    const a0 = alongX ? sp.x0 : sp.z0, a1 = alongX ? sp.x1 : sp.z1, np = Math.max(1, sp.panes.length), pw = (a1 - a0) / np;
    sp.panes.forEach((st, k) => {
      const trans = st === 'broken' ? 1 : st === 'boarded' ? DAYLIGHT.boarded : st === 'cracked' ? DAYLIGHT.cracked : DAYLIGHT.glass;
      const c = a0 + (k + 0.5) * pw;
      openings.push({slot: slotOf(sp.level), x: alongX ? c : inner - n * CELL / 2, z: alongX ? inner - n * CELL / 2 : c, y0: base + sp.sill, y1: base + sp.head, nx: alongX ? 0 : -n, nz: alongX ? -n : 0, w: pw, trans});
    });
  }
  stats.openings = openings.length;
  const reach = DAYLIGHT.reach, reachC = Math.ceil(reach / CELL);
  yield;
  for (let oi = 0; oi < openings.length; oi++) {
    const op = openings[oi];
    if (oi % 16 === 15) yield;
    if (op.slot < 0 || op.slot >= ctx.geos.length) continue;
    const g = ctx.geos[op.slot], Lsl = ctx.layers[op.slot], Es = ctx.E[op.slot], Ds = ctx.D[op.slot], ELs = ctx.EL[op.slot];
    // sample points across the opening (~1 m apart), each an area dA of the opening
    const ns = Math.max(1, Math.round(op.w)), nh = Math.max(1, Math.round(op.y1 - op.y0));
    const dA = (op.w / ns) * ((op.y1 - op.y0) / nh);
    const ocx = Math.floor(op.x / CELL), ocz = Math.floor(op.z / CELL);
    if (ocx < 0 || ocz < 0 || ocx >= W || ocz >= H || !g.open[ocz * W + ocx]) continue;
    for (let dz = -reachC; dz <= reachC; dz++) for (let dx = -reachC; dx <= reachC; dx++) {
      const x = ocx + dx, z = ocz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const i = z * W + x;
      if (!g.open[i] || OUTDOOR.has(plan.ground[i])) continue;
      const qx = (x + 0.5) * CELL - op.x, qz = (z + 0.5) * CELL - op.z;
      const fwd = qx * op.nx + qz * op.nz;
      if (fwd < -0.05) continue;
      const d2h = qx * qx + qz * qz;
      if (d2h > reach * reach) continue;
      if (!lineClear(g.open, W, ocx, ocz, x, z)) continue;
      stats.indoorCells++;
      for (let k = 0; k < Lsl; k++) {
        const py = g.layerY[i * Lsl + k];
        let e = 0, ddx = 0, ddy = 0, ddz = 0;
        for (let a = 0; a < ns; a++) for (let hh = 0; hh < nh; hh++) {
          stats.openingSamples++;
          const sAlong = (a + 0.5) / ns - 0.5;
          const sx = op.x + (op.nz !== 0 ? sAlong * op.w : 0), sz = op.z + (op.nx !== 0 ? sAlong * op.w : 0);
          const sy = op.y0 + (hh + 0.5) * (op.y1 - op.y0) / nh;
          const vx = (x + 0.5) * CELL - sx, vy = py - sy, vz = (z + 0.5) * CELL - sz;
          const d2 = Math.max(0.36, vx * vx + vy * vy + vz * vz), d = Math.sqrt(d2);
          const cosO = Math.max(0, (vx * op.nx + vz * op.nz) / d);
          if (cosO <= 0) continue;
          const de = Lout * op.trans * dA * cosO / d2;
          e += de; ddx -= de * vx / d; ddy -= de * vy / d; ddz -= de * vz / d;
        }
        if (e <= 0) continue;
        const vi = (i * Lsl + k) * 3;
        Es[vi] += e * tr; Es[vi + 1] += e * tg; Es[vi + 2] += e * tb;
        Ds[vi] += ddx * tl; Ds[vi + 1] += ddy * tl; Ds[vi + 2] += ddz * tl;
        ELs[i * Lsl + k] += e * tl;
      }
    }
  }
  // --- the tent: diffuse daylight through the canvas over its whole floor ---
  if (plan.tent) for (let i = 0; i < W * H; i++) {
    if (plan.ground[i] !== GROUND.tent || !geo.open[i]) continue;
    const e = 2 * Math.PI * L * DAYLIGHT.canvas;
    for (let k = 0; k < Ls; k++) {
      const vi = (i * Ls + k) * 3;
      E[vi] += e * tr * 0.92; E[vi + 1] += e * tg; E[vi + 2] += e * tb * 0.8;
      Dv[vi + 1] += e * 0.4 * tl;
      EL[i * Ls + k] += e * tl;
    }
  }
  stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return stats;
}

/** 2-D line of sight between two cells through open cells (Bresenham, endpoints included). */
function lineClear(open: Uint8Array, W: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let guard = 0; guard < 4096; guard++) {
    if (!open[y * W + x]) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return false;
}
