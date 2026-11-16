// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's CITY FRAME — the 8 x 8-block street grid of a
// district, planned in grid cells (0.5 m) before anything is carved. Pure data.
//
// Structure (not a checkerboard):
//  - 9 x-lines (north-south carriageways) and 9 z-lines (east-west). Lines 0 and 8 are the PERIMETER roads (the playable boundary is the
//    cordon just outside their outer sidewalk); one line per axis through the core is an AVENUE (18-22 m kerb to kerb, 3.5-4 m sidewalks);
//    the rest are 2-lane STREETS (10-13 m, 2.5-3.5 m sidewalks).
//  - The two avenues split the district into four QUADRANTS with their own street grids: the north-south streets of the northern half
//    and those of the southern half may JOG at the east-west avenue (offset T-junctions), likewise the east-west streets at the north-south
//    avenue; the perimeter roads and the avenues run straight through.
//  - Blocks: kerb-to-kerb rects (their sidewalks included) of 45-51 m in the outer ring and 52-60 m in the core (cols / rows 2..5); a jog keeps every block within 45-65 m.
//  - The street network: carriageway STRIPS (a line's carriageway over its half / the full length), their crossings (JUNCTIONS, T or X)
//    and the SEGMENTS between consecutive junctions (SurfaceStreet records).

import type {Rng} from '../../core/rng';
import {streetNames} from './cityNames';

/** Half-open cell rect [x0, x1) x [y0, y1). */
export interface CR { x0: number; y0: number; x1: number; y1: number }

export const crW = (r: CR): number => r.x1 - r.x0;
export const crH = (r: CR): number => r.y1 - r.y0;
export const crArea = (r: CR): number => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
export const crIntersect = (a: CR, b: CR): CR | null => {
  const r = {x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1)};
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
};
export const crContains = (a: CR, x: number, y: number): boolean => x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1;

/** Frame tunables (cells = 0.5 m). */
export const FRAME_CELLS = {
  /** Cordon band (SOLID: the quarantine wall LOOK draws) beyond the perimeter roads' outer sidewalk. */
  band: 8,
  /** The cordon-side sidewalk of the perimeter roads. */
  outerSW: 5,
  perimeter: {cw: [20, 24] as const, sw: 6},
  avenue: {cw: [36, 44] as const, sw: [7, 8] as const},
  street: {cw: [20, 26] as const, sw: [5, 7] as const},
  /** Kerb-to-kerb block widths: core / outer ring. */
  coreBlock: [104, 120] as const,
  outerBlock: [90, 102] as const,
  /** Street jogs at the avenues: chance per inner line, offset range; every block stays within blockLimits (45-65 m kerb to kerb). */
  jog: {p: 0.45, d: [6, 16] as const},
  blockLimits: [90, 130] as const,
} as const;

export const CORE_FROM = 2;
export const CORE_TO = 5;
export const BLOCKS = 8;

export interface FrameLine {
  /** Line index 0..8 (line i lies before block column / row i). */
  idx: number;
  /** Carriageway start (cells) and width (kerb to kerb, cells); each side's sidewalk width (cells). */
  pos: number;
  cw: number;
  sw: number;
  rank: 'avenue' | 'street';
  perimeter: boolean;
  name: string;
}

export interface FrameBlock {
  id: number;
  col: number;
  row: number;
  core: boolean;
  /** Kerb rect (the raised block slab: sidewalks included). */
  kerb: CR;
  /** Property lines (kerb rect minus the sidewalks). */
  lot: CR;
  /** Sidewalk widths per side (cells). */
  sw: {N: number; S: number; W: number; E: number};
  /** The street line on each side. */
  lines: {N: FrameLine; S: FrameLine; W: FrameLine; E: FrameLine};
}

/** A carriageway strip: one line's carriageway over its half (or the full length for the fixed lines). */
export interface Strip {
  id: number;
  /** 'z' = runs north-south (an x-line), 'x' = runs east-west (a z-line). */
  run: 'x' | 'z';
  line: FrameLine;
  r: CR;
}

export interface FrameJunction {
  id: number;
  r: CR;
  /** The crossing strips (run 'z' strip, run 'x' strip). */
  zs: number;
  xs: number;
  /** T-junction (one strip ends here) or a full crossing. */
  t: boolean;
}

export interface FrameSegment {
  id: number;
  strip: number;
  r: CR;
  run: 'x' | 'z';
  line: FrameLine;
  /** Junction ids at each end (low / high end along the run). */
  a: number;
  b: number;
}

export interface CityFrame {
  W: number;
  H: number;
  /** Playable boundary (cells): inside the cordon band. */
  ext: CR;
  /** The avenues' line indices: avX = the north-south avenue (an x-line), avZ = the east-west avenue (a z-line). */
  avX: number;
  avZ: number;
  /** x-lines per half: [north half (rows < avZ), south half]; z-lines per half: [west half (cols < avX), east half]. */
  xl: [FrameLine[], FrameLine[]];
  zl: [FrameLine[], FrameLine[]];
  blocks: FrameBlock[];
  strips: Strip[];
  junctions: FrameJunction[];
  segments: FrameSegment[];
  /** The outer sidewalks between the perimeter roads and the cordon (N, S, W, E). */
  outer: CR[];
}

const isCore = (i: number) => i >= CORE_FROM && i <= CORE_TO;

/** One axis: line widths, block widths, line positions for both halves (half 1 jogs the inner lines). */
function axisLines(rng: Rng, av: number, names: string[]): [FrameLine[], FrameLine[]] {
  const F = FRAME_CELLS;
  const lines: FrameLine[] = [];
  for (let i = 0; i <= BLOCKS; i++) {
    const perimeter = i === 0 || i === BLOCKS;
    const rank = i === av ? 'avenue' : 'street';
    const cw = perimeter ? rng.int(F.perimeter.cw[0], F.perimeter.cw[1]) : rank === 'avenue' ? rng.int(F.avenue.cw[0], F.avenue.cw[1]) : rng.int(F.street.cw[0], F.street.cw[1]);
    const sw = perimeter ? F.perimeter.sw : rank === 'avenue' ? rng.int(F.avenue.sw[0], F.avenue.sw[1]) : rng.int(F.street.sw[0], F.street.sw[1]);
    lines.push({idx: i, pos: 0, cw, sw, rank, perimeter, name: names[i]});
  }
  const bw: number[] = [];
  for (let k = 0; k < BLOCKS; k++) bw.push(isCore(k) ? rng.int(F.coreBlock[0], F.coreBlock[1]) : rng.int(F.outerBlock[0], F.outerBlock[1]));
  let x = F.band + F.outerSW;
  for (let i = 0; i <= BLOCKS; i++) {
    lines[i].pos = x;
    x += lines[i].cw;
    if (i < BLOCKS) x += bw[i];
  }
  const half1 = lines.map(l => ({...l}));
  const [lo, hi] = F.blockLimits;
  for (let i = 1; i < BLOCKS; i++) {
    if (i === av || !rng.chance(F.jog.p)) continue;
    const d = (rng.chance(0.5) ? 1 : -1) * rng.int(F.jog.d[0], F.jog.d[1]);
    const prev = half1[i - 1], next = half1[i + 1], p = half1[i].pos + d;
    const left = p - (prev.pos + prev.cw), right = next.pos - (p + half1[i].cw);
    if (left >= lo && left <= hi && right >= lo && right <= hi) half1[i].pos = p;
  }
  return [lines, half1];
}

/** Plans the frame of a district (its own fork of the district seed). */
export function planFrame(rng: Rng): CityFrame {
  const F = FRAME_CELLS;
  const avX = rng.int(3, 5), avZ = rng.int(3, 5);
  const names = streetNames(rng.fork('street-names'), avX, avZ);
  const xl = axisLines(rng.fork('x-lines'), avX, names.x);
  const zl = axisLines(rng.fork('z-lines'), avZ, names.z);
  const last = (ls: FrameLine[]) => ls[BLOCKS].pos + ls[BLOCKS].cw;
  const W = last(xl[0]) + F.outerSW + F.band, H = last(zl[0]) + F.outerSW + F.band;
  const ext: CR = {x0: F.band, y0: F.band, x1: W - F.band, y1: H - F.band};

  // --- Blocks -------------------------------------------------------------------------------------------------------------------
  const blocks: FrameBlock[] = [];
  for (let row = 0; row < BLOCKS; row++) for (let col = 0; col < BLOCKS; col++) {
    const X = xl[row < avZ ? 0 : 1], Z = zl[col < avX ? 0 : 1];
    const lines = {W: X[col], E: X[col + 1], N: Z[row], S: Z[row + 1]};
    const kerb: CR = {x0: lines.W.pos + lines.W.cw, x1: lines.E.pos, y0: lines.N.pos + lines.N.cw, y1: lines.S.pos};
    const sw = {W: lines.W.sw, E: lines.E.sw, N: lines.N.sw, S: lines.S.sw};
    const lot: CR = {x0: kerb.x0 + sw.W, x1: kerb.x1 - sw.E, y0: kerb.y0 + sw.N, y1: kerb.y1 - sw.S};
    blocks.push({id: blocks.length, col, row, core: isCore(col) && isCore(row), kerb, lot, sw, lines});
  }

  // --- Carriageway strips (a line that does not jog is ONE strip over the full length) ----------------------------------------------
  const strips: Strip[] = [];
  const zTop = zl[0][0].pos, zAv = zl[0][avZ], zBot = last(zl[0]);
  const xLeft = xl[0][0].pos, xAv = xl[0][avX], xRight = last(xl[0]);
  for (let i = 0; i <= BLOCKS; i++) {
    const a = xl[0][i], b = xl[1][i];
    if (a.pos === b.pos) strips.push({id: strips.length, run: 'z', line: a, r: {x0: a.pos, x1: a.pos + a.cw, y0: zTop, y1: zBot}});
    else {
      strips.push({id: strips.length, run: 'z', line: a, r: {x0: a.pos, x1: a.pos + a.cw, y0: zTop, y1: zAv.pos + zAv.cw}});
      strips.push({id: strips.length, run: 'z', line: b, r: {x0: b.pos, x1: b.pos + b.cw, y0: zAv.pos, y1: zBot}});
    }
  }
  for (let j = 0; j <= BLOCKS; j++) {
    const a = zl[0][j], b = zl[1][j];
    if (a.pos === b.pos) strips.push({id: strips.length, run: 'x', line: a, r: {x0: xLeft, x1: xRight, y0: a.pos, y1: a.pos + a.cw}});
    else {
      strips.push({id: strips.length, run: 'x', line: a, r: {x0: xLeft, x1: xAv.pos + xAv.cw, y0: a.pos, y1: a.pos + a.cw}});
      strips.push({id: strips.length, run: 'x', line: b, r: {x0: xAv.pos, x1: xRight, y0: b.pos, y1: b.pos + b.cw}});
    }
  }

  // --- Junctions: every crossing of a north-south strip with an east-west strip ----------------------------------------------------
  const junctions: FrameJunction[] = [];
  const zStrips = strips.filter(s => s.run === 'z'), xStrips = strips.filter(s => s.run === 'x');
  for (const zs of zStrips) for (const xs of xStrips) {
    const r = crIntersect(zs.r, xs.r);
    if (!r) continue;
    // a T: one of the two strips ends inside the other's carriageway
    const t = zs.r.y0 === r.y0 || zs.r.y1 === r.y1 || xs.r.x0 === r.x0 || xs.r.x1 === r.x1;
    junctions.push({id: junctions.length, r, zs: zs.id, xs: xs.id, t: t && !(zs.line.perimeter && xs.line.perimeter)});
  }

  // --- Segments: each strip cut by its junctions ---------------------------------------------------------------------------------
  const segments: FrameSegment[] = [];
  for (const s of strips) {
    const js = junctions.filter(j => (s.run === 'z' ? j.zs : j.xs) === s.id).sort((p, q) => (s.run === 'z' ? p.r.y0 - q.r.y0 : p.r.x0 - q.r.x0));
    for (let k = 0; k + 1 < js.length; k++) {
      const p = js[k], q = js[k + 1];
      const r: CR = s.run === 'z' ? {x0: s.r.x0, x1: s.r.x1, y0: p.r.y1, y1: q.r.y0} : {x0: p.r.x1, x1: q.r.x0, y0: s.r.y0, y1: s.r.y1};
      if (crArea(r) > 0) segments.push({id: segments.length, strip: s.id, r, run: s.run, line: s.line, a: p.id, b: q.id});
    }
  }

  // --- The cordon-side sidewalks of the perimeter roads (N / S span the full width; W / E between them) --------------------------
  const outer: CR[] = [
    {x0: ext.x0, x1: ext.x1, y0: ext.y0, y1: zTop},
    {x0: ext.x0, x1: ext.x1, y0: zBot, y1: ext.y1},
    {x0: ext.x0, x1: xLeft, y0: zTop, y1: zBot},
    {x0: xRight, x1: ext.x1, y0: zTop, y1: zBot},
  ];
  return {W, H, ext, avX, avZ, xl, zl, blocks, strips, junctions, segments, outer};
}

/** The block at (col, row). */
export const blockAt = (f: CityFrame, col: number, row: number): FrameBlock => f.blocks[row * BLOCKS + col];
