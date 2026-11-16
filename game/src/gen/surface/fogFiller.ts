// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): a VERSION-2 district's FOG-PRESSURE BOUNDARY on the generator side
// (gen/surface/surfaceRun.ts surfaceFeatures(v).fogBoundary). User: "Replace the visible perimeter wall with thickening outer fog and
// enough bounded filler blocks to hide the finite edge; the user authorizes extra outer padding if needed. Keep the meaningful core, not a
// content / draw-distance cut." Pure data (no three.js); draws NOTHING from any stream (a v2 district's frame / blocks / interiors come
// from the same forks as v1; a v1 district never reaches this file).
//
//  - CLEAR: the meaningful district — the core, the inner ring of blocks and every street up to and including the second ring road
//    (frame lines 1 and 7, both their sidewalks): every enterable destination, the checkpoint / tent / truck, the depot with its yards
//    and the spur's inner run, the park. Pressure 0 inside (world/surface/fogPressure.ts).
//  - RAMP: FOG_BOUNDARY.ramp metres beyond `clear` the pressure reaches 1 (across the outermost ring of sparse shells / lots and the
//    perimeter road — they stay, in the thickening fog: nothing of the district is cut).
//  - EDGE: the finite walkable ground, FOG_BOUNDARY.margin metres beyond the pressure-1 line on every side. Where the v1 frame ends
//    sooner the grid is PADDED (bounded: padFrame) with an open rubble APRON in place of the old cordon band (carveFogApron); a thin
//    SOLID ring (FOG_BOUNDARY.band cells) round it is the last-resort collider — never drawn as a wall (world/surface/arch.ts), hidden
//    behind the surroundings pulled in to it (world/surface/lookCity.ts: berms at its foot, collapsed blocks and the far city behind).

import type {Kit} from '../stationKit';
import {CELL} from '../grid';
import type {SRect, SurfaceLot} from './surfaceTypes';
import {BLOCKS, type CR, type CityFrame, type FrameLine} from './cityFrame';
import {G, SKY_CEIL, type GroundMap} from './cityCarve';

/** The boundary's distances (m; cells where noted). */
export const FOG_BOUNDARY = {
  /** Metres from `clear` to pressure 1 (SurfaceBoundary.ramp). */
  ramp: 42,
  /** Metres from the pressure-1 line to the edge of the walkable ground (the truck's worst-case stop + the walk's death run fit in it). */
  margin: 28,
  /** The last-resort SOLID ring beyond the edge (cells). */
  band: 2,
} as const;

/** The planned boundary of a frame (cells; before / after padFrame alike — `pad` is what padFrame adds per side). */
export interface FogPlan {
  clear: CR;
  /** Walkable ground (the apron's outer edge). */
  edge: CR;
  /** Cells added per side (W = low x, N = low y). */
  pad: {W: number; N: number; E: number; S: number};
}

const reach = () => Math.round((FOG_BOUNDARY.ramp + FOG_BOUNDARY.margin) / CELL);

/** The clear rect of a frame: the outer property lines of the ring-0 blocks along lines 1 and 7 (both halves of a jogged line). */
export function fogClearCells(f: CityFrame): CR {
  const lo = (ls: readonly FrameLine[][]) => Math.min(...ls.map(h => h[1].pos - h[1].sw));
  const hi = (ls: readonly FrameLine[][]) => Math.max(...ls.map(h => h[BLOCKS - 1].pos + h[BLOCKS - 1].cw + h[BLOCKS - 1].sw));
  return {x0: lo(f.xl), x1: hi(f.xl), y0: lo(f.zl), y1: hi(f.zl)};
}

/** The boundary of an UNPADDED (v1-shaped) frame: its clear rect, the edge `reach` beyond it and the padding that edge needs. */
export function planFogBoundary(f: CityFrame): FogPlan {
  const c = fogClearCells(f), r = reach(), b = FOG_BOUNDARY.band;
  const pad = {W: Math.max(0, r + b - c.x0), N: Math.max(0, r + b - c.y0), E: Math.max(0, c.x1 + r + b - f.W), S: Math.max(0, c.y1 + r + b - f.H)};
  const W = f.W + pad.W + pad.E, H = f.H + pad.N + pad.S;
  const clear = {x0: c.x0 + pad.W, x1: c.x1 + pad.W, y0: c.y0 + pad.N, y1: c.y1 + pad.N};
  // the edge: the padded grid minus the band — exactly `reach` beyond clear where the side was padded, further where the v1 frame was
  // already wider (a longer margin there: never a SOLID strip of its own)
  return {clear, edge: {x0: b, y0: b, x1: W - b, y1: H - b}, pad};
}

const shift = (r: CR, dx: number, dy: number): CR => ({x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy});

/**
 * The frame moved by the plan's W / N padding on a grid grown by all four (a COPY: lines, blocks, strips, junctions, segments, the outer
 * sidewalks and the old playable rect `ext` move with it; nothing else changes — the same streets, blocks and names).
 */
export function padFrame(f: CityFrame, p: FogPlan): CityFrame {
  const dx = p.pad.W, dy = p.pad.N;
  if (!dx && !dy && !p.pad.E && !p.pad.S) return f;
  const lines = new Map<FrameLine, FrameLine>();
  const mv = (l: FrameLine, d: number): FrameLine => { let m = lines.get(l); if (!m) lines.set(l, (m = {...l, pos: l.pos + d})); return m; };
  const xl = f.xl.map(h => h.map(l => mv(l, dx))) as CityFrame['xl'];
  const zl = f.zl.map(h => h.map(l => mv(l, dy))) as CityFrame['zl'];
  const line = (l: FrameLine) => lines.get(l)!;
  return {
    W: f.W + dx + p.pad.E, H: f.H + dy + p.pad.S, ext: shift(f.ext, dx, dy), avX: f.avX, avZ: f.avZ, xl, zl,
    blocks: f.blocks.map(b => ({...b, kerb: shift(b.kerb, dx, dy), lot: shift(b.lot, dx, dy), sw: {...b.sw},
      lines: {N: line(b.lines.N), S: line(b.lines.S), W: line(b.lines.W), E: line(b.lines.E)}})),
    strips: f.strips.map(s => ({...s, line: line(s.line), r: shift(s.r, dx, dy)})),
    junctions: f.junctions.map(j => ({...j, r: shift(j.r, dx, dy)})),
    segments: f.segments.map(s => ({...s, line: line(s.line), r: shift(s.r, dx, dy)})),
    outer: f.outer.map(r => shift(r, dx, dy)),
  };
}

const toM = (r: CR): SRect => ({x0: r.x0 * CELL, z0: r.y0 * CELL, x1: r.x1 * CELL, z1: r.y1 * CELL});

/** What the apron added: its outdoor area ids and the lot records the look grounds it with (rubble verge). */
export interface FogApron { areas: number[]; lots: SurfaceLot[] }

/**
 * The open APRON between the old playable rect (`f.ext`: the perimeter roads' outer sidewalks) and the edge: four disjoint rects (N / S
 * full width, W / E between them) at road grade, street areas with the open sky like every outdoor area (GEN's rule: outdoor = toxic
 * outdoor air, world/surface/airMask.ts). Carved AFTER the outdoor dressing (nothing is placed on it). `lotId0` = the next lot id.
 */
export function carveFogApron(kit: Kit, f: CityFrame, p: FogPlan, gm: GroundMap, lotId0: number): FogApron {
  const e = p.edge, x = f.ext;
  const rects: CR[] = [
    {x0: e.x0, x1: e.x1, y0: e.y0, y1: x.y0}, {x0: e.x0, x1: e.x1, y0: x.y1, y1: e.y1},
    {x0: e.x0, x1: x.x0, y0: x.y0, y1: x.y1}, {x0: x.x1, x1: e.x1, y0: x.y0, y1: x.y1},
  ];
  const out: FogApron = {areas: [], lots: []};
  const g = kit.g;
  for (const r of rects) {
    if (r.x1 <= r.x0 || r.y1 <= r.y0) continue;
    const a = kit.addArea({x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0}, 'concourse', 'street', SKY_CEIL, -1, {label: 'Rubble verge', publicSpace: true});
    for (let y = r.y0; y < r.y1; y++) for (let xx = r.x0; xx < r.x1; xx++) { const i = g.idx(xx, y); g.floor[i] = 0; gm.cls[i] = G.lot; }
    gm.outdoor.push(a.id);
    out.areas.push(a.id);
    out.lots.push({id: lotId0 + out.lots.length, block: -1, rect: toM(r), use: 'rubble', grade: 0, area: a.id, label: 'Rubble verge', driveways: []});
  }
  return out;
}

/** The boundary record (world m) of a planned frame. */
export const fogBoundaryRecord = (p: FogPlan) => ({clear: toM(p.clear), ramp: FOG_BOUNDARY.ramp, edge: toM(p.edge)});
