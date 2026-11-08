// Task studio-skywalk-variety-20261107-231448-01 (lane FACADE): the Skyways buildings' FACADE RELIEF — so the exterior shells
// (world/skywaysExterior.ts: flat outward faces in the Office curtain-wall material) read as real, DIFFERENT buildings. Pure plan
// (deterministic per layout seed, data-driven from layout.skyways: every layout version, any footprint / height / role) + a small
// emitter; skywaysExterior.ts merges the result into its EXISTING meshes, so the detail adds no draw call:
//  - boxes (vertex-coloured, the exterior's stand-in prop material): plinths, base piers / colonnades, the +15 band, entrance
//    canopies (some on posts), the base course, shaft piers / full-bay masonry piers / fins, corner piers, spandrel bands and string
//    courses, projecting bays' cheeks, cornices, parapets + copings, a crown frame, setback cornices, rooftop plant, masts — merged
//    into the bridges + curbs mesh;
//  - panels (the curtain-wall material: its world-mapped glass lines up with the facade behind): the fronts of projecting bays and the
//    walls of setback / stepped tops — merged into the shells mesh.
// Styles (per building from its role, then a seeded rotation over the hubs so neighbours differ): civic (the station building: a
// limestone base colonnade, full-bay piers, heavy cornice), masonry (brick piers on every other bay = punched windows, stone
// courses, oriel bays), grid (a concrete frame of piers and spandrels), ribbon (continuous spandrel panels with sill lips, corner
// piers only) and fins (deep mullion fins, stepped crowns, masts). Crowns by height: parapet / penthouse on low buildings, penthouse /
// setback / stepped / frame on tall ones. Colours are flat per-element albedos (like the curbs / bridge steel), darkened toward the
// top like the curtain wall; no new texture. Runtime only: its own seeded stream (never a generation draw), no shadow casting (the
// exterior is unlit), the exterior's fog, visibility gate and warm-up pool unchanged.
// The relief is laid on the facade material's own grid (storey lines every 4.4 m from the street, bay lines on the world 1.5 m
// grid) so spandrels sit on its concrete bands and piers on its mullions.
// Keep-clear: nothing is placed in front of a window / entrance span (its outward prism, so the view out stays clear and no relief
// is seen from behind), across a bridge tube (its outer cross-section, slab to roof glass) or into an atrium vault, and nothing
// enters a footprint below its roof (parapets / rooftop plant stand on the roofs): the shells sit ON the outer wall faces, the
// relief outside them. Tested in tests/skyways-facade.test.ts.

import {mulberry32} from '../core/rng';
import type {Side} from '../gen/stationTypes';
import type {SkywaysBuilding, SkywaysInfo, SkywaysRect} from '../gen/skyways/skywaysTypes';
import type {PlaneRect} from './skywaysExterior';

type RGB = [number, number, number];

export const SKYWAYS_FACADE = {
  /** The Office curtain-wall pattern (world/exterior.ts facadeMaterial): storey lines every 4.4 m from the street, mullions every 1.5 m. */
  storey: 4.4, bay: 1.5,
  /** The pattern's concrete band round a storey line (m below / above the line). */
  bandLo: 0.65, bandHi: 0.92,
  /** Keep-clear margin round every window / entrance span, bridge tube and atrium vault (m). */
  clear: 0.15,
  /** Entrance canopy: projection, slab thickness, overhang past the doors, rise above the storey's highest head (m). */
  canopy: {d: 2.2, h: 0.2, over: 0.6, rise: 0.2},
  /** Parapet over a roof: height, thickness; coping height (m). */
  parapet: {h: 1.1, t: 0.3, cope: 0.1},
  /** Crown frame: height of the verticals over the roof, ring beam depth (m). */
  frame: {h: 3, beam: 0.5},
  /** Shortest pier / vertical piece kept (m). */
  minPier: 1.2,
  /** Most boxes per building (a bound: far above today's layouts). */
  maxBoxes: 900,
} as const;

export type FacadeStyle = 'civic' | 'masonry' | 'grid' | 'ribbon' | 'fins';
export type FacadeCrown = 'parapet' | 'penthouse' | 'setback' | 'stepped' | 'frame';
export type FacadePart = 'plinth' | 'base-pier' | 'band' | 'canopy' | 'course' | 'pier' | 'corner' | 'spandrel' | 'bay' | 'cornice' | 'parapet'
  | 'frame' | 'setback' | 'plant' | 'mast';

/** Faces NOT drawn (bitmask): 1 = -x, 2 = +x, 4 = -z, 8 = +z, 16 = -y, 32 = +y. */
export const FACE = {nx: 1, px: 2, nz: 4, pz: 8, ny: 16, py: 32} as const;

/** One relief box (world AABB) with its colour and the faces it does not draw (against a wall / a roof / a panel). */
export interface FacadeBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; color: RGB; open: number; part: FacadePart }

export interface SkywaysFacadePlan {
  building: string;
  style: FacadeStyle;
  crown: FacadeCrown;
  boxes: FacadeBox[];
  /** Curtain-wall faces (projecting bay fronts, setback walls). */
  panels: PlaneRect[];
  /** Flat roofs of setbacks (vertex-coloured). */
  roofs: {q: PlaneRect; color: RGB}[];
  /** Highest point of the building with its crown (m). */
  peak: number;
}

/** What the facade planner needs from the exterior plan: the shells' boxes and every bridge tube (outer rect, slab underside to roof). */
export interface FacadeContext {
  shells: readonly {building: string; podiumTop: number; tower: SkywaysRect | null; top: number}[];
  tubes: readonly {id: string; rect: SkywaysRect; y0: number; y1: number}[];
}

interface StyleSpec {
  /** Shaft verticals: every `pitch` bays, width, depth; `full` = a whole bay wide (centred on the bay; masonry). */
  piers: {pitch: number; w: number; d: number; full?: boolean} | null;
  /** Spandrel bands on the storey lines (every n storeys; band lo / hi about the line; an optional sill lip on its top edge). */
  spandrel: {every: number; d: number; lo: number; hi: number; lip?: {d: number; h: number}} | null;
  /** Deeper string courses every n storeys. */
  course: {every: number; d: number; h: number} | null;
  corner: {w: number; d: number};
  base: {plinth: number; pitch: number; w: number; d: number; band: number; posts: boolean};
  cornice: {h: number; d: number};
  /** Chance of projecting bays on the wide faces. */
  bays: number;
  crowns: readonly FacadeCrown[];
  palette: {trim: readonly RGB[]; base: readonly RGB[]; accent: readonly RGB[]};
}

const LIMESTONE: RGB = [0.44, 0.4, 0.33], SANDSTONE: RGB = [0.4, 0.33, 0.24], BRICK: RGB = [0.27, 0.13, 0.09], BRICK_TAN: RGB = [0.3, 0.2, 0.13];
const CONCRETE: RGB = [0.4, 0.39, 0.37], CONCRETE_WARM: RGB = [0.36, 0.33, 0.29], PANEL_LIGHT: RGB = [0.5, 0.5, 0.48], BRONZE: RGB = [0.1, 0.08, 0.06];
const STEEL: RGB = [0.07, 0.075, 0.08], ALU: RGB = [0.36, 0.37, 0.38], SLATE: RGB = [0.15, 0.17, 0.19], GRANITE: RGB = [0.14, 0.13, 0.125], GRANITE_RED: RGB = [0.17, 0.11, 0.09];
const ROOF: RGB = [0.08, 0.075, 0.07], PLANT: RGB = [0.2, 0.2, 0.19], PLANT_DARK: RGB = [0.11, 0.11, 0.115];

export const FACADE_STYLES: Record<FacadeStyle, StyleSpec> = {
  civic: {
    piers: {pitch: 2, w: 1.6, d: 0.22, full: true}, spandrel: {every: 1, d: 0.13, lo: 0.65, hi: 0.92}, course: {every: 3, d: 0.34, h: 0.36},
    corner: {w: 1.9, d: 0.4}, base: {plinth: 0.6, pitch: 4, w: 0.95, d: 0.55, band: 0.45, posts: true}, cornice: {h: 1.0, d: 0.9}, bays: 0,
    crowns: ['parapet', 'penthouse'], palette: {trim: [LIMESTONE, SANDSTONE], base: [GRANITE, GRANITE_RED], accent: [BRONZE, STEEL]},
  },
  masonry: {
    piers: {pitch: 2, w: 1.6, d: 0.2, full: true}, spandrel: {every: 1, d: 0.11, lo: 0.65, hi: 0.92}, course: {every: 4, d: 0.3, h: 0.3},
    corner: {w: 1.6, d: 0.32}, base: {plinth: 0.45, pitch: 4, w: 0.8, d: 0.42, band: 0.36, posts: true}, cornice: {h: 0.8, d: 0.7}, bays: 0.65,
    crowns: ['parapet', 'penthouse', 'setback'], palette: {trim: [BRICK, BRICK_TAN], base: [GRANITE, GRANITE_RED], accent: [LIMESTONE, SANDSTONE]},
  },
  grid: {
    piers: {pitch: 3, w: 0.5, d: 0.32}, spandrel: {every: 1, d: 0.16, lo: 0.65, hi: 0.92}, course: null,
    corner: {w: 0.9, d: 0.38}, base: {plinth: 0.4, pitch: 3, w: 0.7, d: 0.44, band: 0.4, posts: false}, cornice: {h: 0.6, d: 0.5}, bays: 0.5,
    crowns: ['frame', 'parapet', 'setback'], palette: {trim: [CONCRETE, CONCRETE_WARM], base: [GRANITE, CONCRETE_WARM], accent: [STEEL, BRONZE]},
  },
  ribbon: {
    piers: null, spandrel: {every: 1, d: 0.26, lo: 1.1, hi: 1.25, lip: {d: 0.42, h: 0.12}}, course: null,
    corner: {w: 1.2, d: 0.32}, base: {plinth: 0.35, pitch: 5, w: 0.6, d: 0.4, band: 0.44, posts: false}, cornice: {h: 0.5, d: 0.5}, bays: 0,
    crowns: ['setback', 'penthouse', 'parapet'], palette: {trim: [BRONZE, PANEL_LIGHT, SLATE], base: [GRANITE, STEEL], accent: [STEEL, ALU]},
  },
  fins: {
    piers: {pitch: 1, w: 0.22, d: 0.75}, spandrel: null, course: {every: 5, d: 0.3, h: 0.25},
    corner: {w: 0.7, d: 0.82}, base: {plinth: 0.35, pitch: 4, w: 0.6, d: 0.66, band: 0.46, posts: false}, cornice: {h: 0.6, d: 0.88}, bays: 0,
    crowns: ['stepped', 'setback', 'frame'], palette: {trim: [ALU, BRONZE], base: [GRANITE, STEEL], accent: [STEEL, ALU]},
  },
};

/** The rotation over the hub buildings (seeded start): neighbours get different characters. */
const HUB_STYLES: readonly FacadeStyle[] = ['grid', 'ribbon', 'masonry', 'fins'];

// ---------------------------------------------------------------------------------------------
// Walls and keep-clear

interface Wall {
  side: Side; axis: 'x' | 'z'; c: number; n: 1 | -1; s0: number; s1: number; t0: number; t1: number;
  /** N / S walls wrap the corners (their end boxes are extended by their depth). */
  wraps: boolean;
}

interface KC { s0: number; s1: number; t0: number; t1: number; kind: 'window' | 'tube' }

function wallsOf(r: SkywaysRect, t0: number, t1: number): Wall[] {
  return (['N', 'S', 'W', 'E'] as const).map(side => {
    const axis = side === 'N' || side === 'S' ? 'z' : 'x';
    const c = side === 'N' ? r.z0 : side === 'S' ? r.z1 : side === 'W' ? r.x0 : r.x1;
    const n: 1 | -1 = side === 'S' || side === 'E' ? 1 : -1;
    const [s0, s1] = axis === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
    return {side, axis, c, n, s0, s1, t0, t1, wraps: axis === 'z'};
  });
}

/** The building's windows / entrances on a wall plane (their wall cells' outer face on it, facing the same way). */
function windowsOn(w: Wall, b: SkywaysBuilding, info: SkywaysInfo): SkywaysInfo['windows'] {
  return info.windows.filter(win => {
    if (!('building' in win.host) || win.host.building !== b.id || win.side !== w.side) return false;
    const plane = win.side === 'N' ? win.z0 : win.side === 'S' ? win.z1 : win.side === 'W' ? win.x0 : win.x1;
    return Math.abs(plane - w.c) < 0.05;
  });
}

/** Keep-clear rects on a wall plane: every window / entrance span on it and every bridge tube meeting it (+ margin). */
function keepClear(w: Wall, b: SkywaysBuilding, info: SkywaysInfo, tubes: FacadeContext['tubes']): KC[] {
  const m = SKYWAYS_FACADE.clear, out: KC[] = [];
  for (const win of windowsOn(w, b, info)) {
    const [s0, s1] = w.axis === 'z' ? [win.x0, win.x1] : [win.z0, win.z1];
    out.push({s0: s0 - m, s1: s1 + m, t0: win.baseY + win.sill - m, t1: win.baseY + win.head + m, kind: 'window'});
  }
  for (const t of tubes) {
    const r = t.rect;
    // the tube meets this plane (one of its along-ends lies on it) and overlaps the wall laterally
    const [a0, a1, l0, l1] = w.axis === 'z' ? [r.z0, r.z1, r.x0, r.x1] : [r.x0, r.x1, r.z0, r.z1];
    const meets = (w.n < 0 ? Math.abs(a1 - w.c) : Math.abs(a0 - w.c)) < 0.1;
    if (!meets || l1 <= w.s0 || l0 >= w.s1) continue;
    out.push({s0: l0 - m, s1: l1 + m, t0: t.y0 - m, t1: t.y1 + m, kind: 'tube'});
  }
  return out;
}

const overlaps = (a: {s0: number; s1: number; t0: number; t1: number}, b: {s0: number; s1: number; t0: number; t1: number}) =>
  a.s0 < b.s1 - 1e-6 && b.s0 < a.s1 - 1e-6 && a.t0 < b.t1 - 1e-6 && b.t0 < a.t1 - 1e-6;

/** [a, b] minus the intervals (sorted, merged). */
function minus(a: number, b: number, cut: readonly [number, number][]): [number, number][] {
  const cs = cut.map(([p, q]) => [Math.max(a, p), Math.min(b, q)] as [number, number]).filter(([p, q]) => q > p).sort((u, v) => u[0] - v[0]);
  const out: [number, number][] = [];
  let cur = a;
  for (const [p, q] of cs) { if (p > cur + 1e-6) out.push([cur, p]); cur = Math.max(cur, q); }
  if (b > cur + 1e-6) out.push([cur, b]);
  return out;
}

/** A wall rect minus keep-clear rects (vertical slabs at the cut boundaries, each minus the t ranges covering it). */
function cutRect(r: {s0: number; s1: number; t0: number; t1: number}, kc: readonly KC[]): {s0: number; s1: number; t0: number; t1: number}[] {
  const hs = kc.filter(h => overlaps(r, h));
  if (!hs.length) return [r];
  const xs = [...new Set([r.s0, r.s1, ...hs.flatMap(h => [Math.max(r.s0, h.s0), Math.min(r.s1, h.s1)])])].sort((a, b) => a - b);
  const out: {s0: number; s1: number; t0: number; t1: number}[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    for (const [p, q] of minus(r.t0, r.t1, hs.filter(h => h.s0 <= mid && h.s1 >= mid).map(h => [h.t0, h.t1] as [number, number]))) {
      const last = out.find(o => Math.abs(o.s1 - a) < 1e-6 && Math.abs(o.t0 - p) < 1e-6 && Math.abs(o.t1 - q) < 1e-6);
      if (last) last.s1 = b; else out.push({s0: a, s1: b, t0: p, t1: q});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Plan

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const tint = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Plans the facade relief of every Skyways building (deterministic per layout seed; runtime only: never touches generation). */
export function planSkywaysFacades(info: SkywaysInfo, seed: number, ctx: FacadeContext): SkywaysFacadePlan[] {
  const rnd0 = mulberry32((seed ^ 0xfacade5) >>> 0);
  const ROLE: Partial<Record<SkywaysBuilding['role'], FacadeStyle>> = {station: 'civic', tower: 'fins', hotel: 'masonry'};
  // the hubs rotate through the characters no role building has taken (all four when that leaves fewer than two)
  const taken = new Set(info.buildings.map(b => ROLE[b.role]).filter(Boolean));
  const free = HUB_STYLES.filter(s => !taken.has(s));
  const pool = free.length >= 2 ? free : HUB_STYLES;
  const hubs = info.buildings.filter(b => !ROLE[b.role]).map(b => b.id).sort();
  const hubStart = Math.floor(rnd0() * pool.length);
  return info.buildings.map((b, i) => {
    const shell = ctx.shells.find(s => s.building === b.id);
    const rnd = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1) ^ 0x5eedfa) >>> 0);
    const style: FacadeStyle = ROLE[b.role] ?? pool[(hubStart + Math.max(0, hubs.indexOf(b.id))) % pool.length];
    return planBuilding(info, b, shell ?? {building: b.id, podiumTop: b.top, tower: null, top: b.top}, ctx.tubes, style, rnd);
  });
}

function planBuilding(info: SkywaysInfo, b: SkywaysBuilding, shell: FacadeContext['shells'][number], tubes: FacadeContext['tubes'], style: FacadeStyle, rnd: () => number): SkywaysFacadePlan {
  const F = SKYWAYS_FACADE, S = FACADE_STYLES[style];
  const gy = info.groundY;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];
  const tone = 0.92 + rnd() * 0.16;
  const trim = tint(pick(S.palette.trim), tone), baseC = tint(pick(S.palette.base), 0.95 + rnd() * 0.1), accent = tint(pick(S.palette.accent), 0.95 + rnd() * 0.1);
  const boxes: FacadeBox[] = [], panels: PlaneRect[] = [], roofs: {q: PlaneRect; color: RGB}[] = [];
  const line = (k: number) => gy + F.storey * k;
  const lineAtOrAbove = (y: number) => Math.ceil((y - gy) / F.storey - 1e-6);

  // --- zones: the base (street + skyway storeys, the bridge joins) under the base course, the shaft, the crown ---
  const sky = info.storeys.find(s => s.role === 'skyway') ?? info.storeys[info.storeys.length - 1];
  const tower = shell.tower, top = shell.top;
  const podium = tower ? shell.podiumTop : null;
  const lowWalls = wallsOf(b.rect, gy, podium ?? top);
  const kcOf = new Map<Wall, KC[]>();
  const kc = (w: Wall) => { let k = kcOf.get(w); if (!k) kcOf.set(w, (k = keepClear(w, b, info, tubes))); return k; };
  let baseTop: number; // the base course's storey line (non-podium buildings)
  {
    let need = sky.baseY + sky.clear + 0.4;
    for (const w of lowWalls) for (const k of kc(w)) need = Math.max(need, k.t1 + F.bandLo + 0.05);
    baseTop = line(lineAtOrAbove(need));
  }
  const tallEnough = !podium && top - baseTop >= F.storey * 1.5;
  const lowTop = podium ?? (tallEnough ? baseTop : top);
  const upper: {rect: SkywaysRect; walls: Wall[]; t0: number} | null = podium !== null && tower
    ? {rect: tower, walls: wallsOf(tower, podium, top), t0: podium}
    : tallEnough ? {rect: b.rect, walls: wallsOf(b.rect, baseTop, top), t0: baseTop} : null;
  // crowns by height: a tall building never ends in a plain parapet, a low one never in a setback / stepped top
  const height = top - gy;
  const crowns = S.crowns.filter(c => (height > 45 ? c !== 'parapet' : height < 30 ? c === 'parapet' || c === 'penthouse' : true));
  let crown: FacadeCrown = upper && crowns.length ? pick(crowns) : (rnd() < 0.5 ? 'parapet' : 'penthouse');

  // wall-local box (s, t, depth out of the wall) -> a world box; `open` faces: the back face when it sits on the wall (a box rising
  // above the wall's top — a crown frame — keeps it: seen from behind over the roof)
  const put = (w: Wall, part: FacadePart, color: RGB, s0: number, s1: number, t0: number, t1: number, d0: number, d1: number, open = 0): void => {
    if (s1 - s0 < 0.02 || t1 - t0 < 0.02 || d1 - d0 < 0.02) return;
    const a = w.c + w.n * d0, c = w.c + w.n * d1;
    const [n0, n1] = [Math.min(a, c), Math.max(a, c)];
    let o = open;
    if (Math.abs(d0) < 1e-9 && t1 <= w.t1 + 1e-6) o |= w.axis === 'z' ? (w.n < 0 ? FACE.pz : FACE.nz) : (w.n < 0 ? FACE.px : FACE.nx);
    boxes.push(w.axis === 'z'
      ? {x0: s0, x1: s1, y0: t0, y1: t1, z0: n0, z1: n1, color, open: o, part}
      : {x0: n0, x1: n1, y0: t0, y1: t1, z0: s0, z1: s1, color, open: o, part});
  };
  /** A horizontal run along a wall (wrapping its corners on N / S), cut round the keep-clear rects. */
  const run = (w: Wall, part: FacadePart, color: RGB, t0: number, t1: number, d: number, open = 0, minLen = 0.6): void => {
    const e = w.wraps ? d : 0;
    for (const q of cutRect({s0: w.s0 - e, s1: w.s1 + e, t0, t1}, kc(w))) if (q.s1 - q.s0 >= minLen) put(w, part, color, q.s0, q.s1, q.t0, q.t1, 0, d, open);
  };
  /** A vertical (pier / fin) cut round the keep-clear rects: whole-width pieces at least minPier tall. */
  const vertical = (w: Wall, part: FacadePart, color: RGB, s0: number, s1: number, t0: number, t1: number, d: number): void => {
    for (const q of cutRect({s0, s1, t0, t1}, kc(w))) if (q.s1 - q.s0 >= s1 - s0 - 1e-6 && q.t1 - q.t0 >= F.minPier) put(w, part, color, q.s0, q.s1, q.t0, q.t1, 0, d);
  };
  /** Pier centres on the 1.5 m grid every `pitch` bays (bay centres for full-bay piers), clear of the corner piers. */
  const pierCentres = (w: Wall, pitch: number, full: boolean, halfW: number): number[] => {
    const out: number[] = [];
    const lo = w.s0 + S.corner.w + halfW + 0.15, hi = w.s1 - S.corner.w - halfW - 0.15;
    const off = full ? F.bay / 2 : 0, step = F.bay * pitch;
    for (let s = Math.ceil((lo - off) / step) * step + off; s <= hi + 1e-6; s += step) out.push(s);
    return out;
  };
  /** Whether a vertical strip meets a window span (piers move off windows rather than float over them). */
  const hitsWindow = (w: Wall, s0: number, s1: number, t0: number, t1: number) => kc(w).some(k => k.kind === 'window' && overlaps({s0, s1, t0, t1}, k));

  // --- the base: plinth, +15 band, base piers, corners, canopies, the base course / podium cornice ---
  for (const w of lowWalls) {
    const ks = kc(w);
    // plinth: under the lowest sill on this wall (never cut under a window)
    let ph = S.base.plinth;
    for (const k of ks) if (k.kind === 'window' && k.t0 > gy + 0.05) ph = Math.min(ph, k.t0 - gy - 0.04);
    if (ph >= 0.18) run(w, 'plinth', baseC, gy, gy + ph, S.base.d * 0.5, FACE.ny);
    // the +15 band: the slab line between the street and skyway storeys (cut at the bridge joins)
    const bandLo = sky.baseY - 0.9, bandHi = sky.baseY + 0.3;
    if (bandHi < lowTop - 0.5) run(w, 'band', accent, bandLo, bandHi, S.base.band);
    // base piers: a colonnade rhythm (moved off windows / entrances; split round bridge tubes)
    const bt0 = gy + Math.max(ph, 0), bt1 = podium !== null ? podium - S.cornice.h : lowTop - F.bandLo;
    const half = S.base.w / 2;
    for (const c of pierCentres(w, S.base.pitch, false, half)) {
      let s = c;
      for (const dv of [0, F.bay, -F.bay, 2 * F.bay, -2 * F.bay]) { if (!hitsWindow(w, c + dv - half, c + dv + half, bt0, bt1)) { s = c + dv; break; } s = NaN; }
      if (Number.isNaN(s) || s - half < w.s0 + S.corner.w + 0.1 || s + half > w.s1 - S.corner.w - 0.1) continue;
      vertical(w, 'base-pier', trim, s - half, s + half, bt0, bt1, S.base.d);
    }
    // corner piers (the base part; wrapping on N / S)
    const ct1 = podium !== null ? podium - S.cornice.h : upper ? lowTop - F.bandLo : lowTop - S.cornice.h;
    const cw = S.corner.w, cd = S.corner.d, e = w.wraps ? cd : 0;
    vertical(w, 'corner', trim, w.s0 - e, w.s0 + cw, bt0, ct1, cd);
    vertical(w, 'corner', trim, w.s1 - cw, w.s1 + e, bt0, ct1, cd);
    // the base course (a deep band on the base's top storey line) or, on a podium / low building, its cornice
    if (podium !== null || !upper) run(w, 'cornice', trim, lowTop - S.cornice.h, lowTop, S.cornice.d);
    else run(w, 'course', trim, baseTop - F.bandLo, baseTop + F.bandHi, S.base.band + 0.06);
    // entrance canopies over the street doors (above every head on this storey; some on posts)
    for (const win of windowsOn(w, b, info)) {
      if (win.kind !== 'entrance') continue;
      const [e0, e1] = w.axis === 'z' ? [win.x0, win.x1] : [win.z0, win.z1];
      const s0 = Math.max(w.s0 + 0.2, e0 - F.canopy.over), s1 = Math.min(w.s1 - 0.2, e1 + F.canopy.over);
      let head = win.baseY + win.head;
      for (const k of ks) if (k.kind === 'window' && k.s1 > s0 && k.s0 < s1 && k.t0 < win.baseY + 4) head = Math.max(head, k.t1 - F.clear);
      const ct = head + F.clear + F.canopy.rise;
      const piece = {s0, s1, t0: ct - 0.14, t1: ct + F.canopy.h + 0.14};
      if (ks.some(k => overlaps(piece, k))) continue;
      const cd2 = F.canopy.d;
      put(w, 'canopy', accent, s0, s1, ct, ct + F.canopy.h, 0, cd2);
      put(w, 'canopy', accent, s0, s1, ct - 0.14, ct + F.canopy.h + 0.14, cd2, cd2 + 0.08); // fascia
      // posts (civic / masonry) only where they stand clear of every window / door prism (else the canopy is cantilevered)
      if (S.base.posts) for (const s of [s0 + 0.15, s1 - 0.27]) if (!ks.some(k => overlaps({s0: s, s1: s + 0.12, t0: gy, t1: ct}, k))) put(w, 'canopy', accent, s, s + 0.12, gy, ct, cd2 - 0.2, cd2 - 0.08, FACE.ny | FACE.py);
    }
  }

  // --- the shaft: verticals, corners, spandrels, courses, projecting bays ---
  if (upper) {
    const cornB = top - S.cornice.h;
    const frameTop = crown === 'frame' ? top + F.frame.h : 0;
    const vt0 = upper.t0 + (podium !== null ? 0.02 : F.bandHi);
    for (const w of upper.walls) {
      const vt1 = crown === 'frame' ? frameTop - F.frame.beam : cornB;
      if (S.piers) {
        const half = S.piers.w / 2;
        for (const c of pierCentres(w, S.piers.pitch, !!S.piers.full, half)) vertical(w, 'pier', trim, c - half, c + half, vt0, vt1, S.piers.d);
      }
      const cw = S.corner.w, cd = S.corner.d, e = w.wraps ? cd : 0;
      vertical(w, 'corner', trim, w.s0 - e, w.s0 + cw, vt0, vt1, cd);
      vertical(w, 'corner', trim, w.s1 - cw, w.s1 + e, vt0, vt1, cd);
      const k0 = lineAtOrAbove(vt0 + 1.2), k1 = Math.floor((cornB - 1.2 - gy) / F.storey);
      if (S.spandrel) for (let k = k0; k <= k1; k++) if ((k - k0) % S.spandrel.every === 0) {
        const sp = S.spandrel;
        run(w, 'spandrel', trim, line(k) - sp.lo, line(k) + sp.hi - (sp.lip ? sp.lip.h : 0), sp.d);
        if (sp.lip) run(w, 'spandrel', accent, line(k) + sp.hi - sp.lip.h, line(k) + sp.hi, sp.lip.d);
      }
      if (S.course) for (let k = k0 + S.course.every - 1; k <= k1; k += S.course.every) run(w, 'course', accent, line(k) + 0.13 - S.course.h / 2, line(k) + 0.13 + S.course.h / 2, S.course.d);
      // projecting bays (oriels): their cheeks / soffits in the trim, their fronts in the curtain wall
      const wide = w.s1 - w.s0;
      if (S.bays > 0 && wide >= 18 && k1 - k0 >= 4 && rnd() < S.bays) {
        const nb = wide >= 32 ? 2 : 1, bw = F.bay * (wide >= 26 ? 4 : 3), bd = 0.75;
        const bt0 = line(k0 + 1) + 0.13, bt1 = line(k1 - 1) + 0.13;
        for (let j = 1; j <= nb; j++) {
          const mid = Math.round(lerp(w.s0, w.s1, j / (nb + 1)) / F.bay) * F.bay;
          const s0 = mid - bw / 2 - 0.12, s1 = mid + bw / 2 + 0.12;
          if (kc(w).some(k => overlaps({s0, s1, t0: bt0, t1: bt1}, k))) continue;
          put(w, 'bay', trim, s0, s1, bt0, bt1, 0, bd, w.axis === 'z' ? (w.n < 0 ? FACE.nz : FACE.pz) : (w.n < 0 ? FACE.nx : FACE.px));
          panels.push({axis: w.axis, c: w.c + w.n * bd, n: w.n, s0, s1, t0: bt0, t1: bt1});
        }
      }
      run(w, 'cornice', trim, cornB, top, S.cornice.d);
      if (crown === 'frame') run(w, 'frame', trim, frameTop - F.frame.beam, frameTop, Math.max(S.piers?.d ?? 0.3, S.corner.d) + 0.04, 0);
    }
  }

  // --- roofs: parapets (where no taller box stands flush), setbacks / steps, plant, masts ---
  const parapet = (r: SkywaysRect, y: number, color: RGB, flush: SkywaysRect | null): void => {
    const P = F.parapet;
    for (const w of wallsOf(r, y, y + P.h)) {
      let cuts: [number, number][] = [];
      if (flush) {
        const fw = wallsOf(flush, 0, 0).find(q => q.side === w.side)!;
        if (Math.abs(fw.c - w.c) < 1e-6) cuts = [[fw.s0 - P.t, fw.s1 + P.t]];
      }
      const [s0, s1] = w.wraps ? [w.s0, w.s1] : [w.s0 + P.t, w.s1 - P.t];
      for (const [a, c] of minus(s0, s1, cuts)) {
        if (c - a < 0.5) continue;
        put(w, 'parapet', color, a, c, y, y + P.h, -P.t, 0, FACE.ny);
        put(w, 'parapet', accent, a, c, y + P.h, y + P.h + P.cope, -P.t - 0.04, 0.06, FACE.ny);
      }
    }
  };
  const inset = (r: SkywaysRect, ix: number, iz: number): SkywaysRect => ({x0: r.x0 + ix, z0: r.z0 + iz, x1: r.x1 - ix, z1: r.z1 - iz});
  const keepOut: SkywaysRect[] = [];
  if (b.atrium) keepOut.push({x0: b.atrium.rect.x0 - 2, z0: b.atrium.rect.z0 - 2, x1: b.atrium.rect.x1 + 2, z1: b.atrium.rect.z1 + 2});
  // skylight wells under the roofs (layout v3+): plant never stands over one
  for (const s of info.skylights ?? []) {
    const r = s.rect;
    if (r.x1 > b.rect.x0 && r.x0 < b.rect.x1 && r.z1 > b.rect.z0 && r.z0 < b.rect.z1) keepOut.push({x0: r.x0 - 1, z0: r.z0 - 1, x1: r.x1 + 1, z1: r.z1 + 1});
  }
  /** Rooftop plant: n boxes inside the roof (clear of its parapet, each other and the keep-outs). */
  const plant = (r: SkywaysRect, y: number, n: number, big = false): void => {
    const R = inset(r, F.parapet.t + 1.2, F.parapet.t + 1.2), W = R.x1 - R.x0, D = R.z1 - R.z0;
    if (W < 3 || D < 3) return;
    const placed: SkywaysRect[] = [];
    for (let tries = 0; placed.length < n && tries < n * 14; tries++) {
      const first = big && placed.length === 0;
      const w = Math.min(W, first ? lerp(0.4, 0.6, rnd()) * W : Math.max(2.4, Math.min(9, lerp(0.12, 0.3, rnd()) * W)));
      const d = Math.min(D, first ? lerp(0.4, 0.6, rnd()) * D : Math.max(2.4, Math.min(9, lerp(0.12, 0.3, rnd()) * D)));
      const x0 = R.x0 + rnd() * (W - w), z0 = R.z0 + rnd() * (D - d);
      const q = {x0, z0, x1: x0 + w, z1: z0 + d};
      const near = (o: SkywaysRect, g: number) => q.x0 < o.x1 + g && o.x0 < q.x1 + g && q.z0 < o.z1 + g && o.z0 < q.z1 + g;
      if (placed.some(o => near(o, 1)) || keepOut.some(o => near(o, 0)) || (tower && y < top - 1 && near(tower, 1.2))) continue;
      placed.push(q);
      const h = first ? lerp(3.8, 5.2, rnd()) : lerp(2.2, 4, rnd());
      boxes.push({...q, y0: y, y1: y + h, color: first ? accent : (rnd() < 0.5 ? PLANT : PLANT_DARK), open: FACE.ny, part: 'plant'});
    }
  };
  /** A setback block on a roof: curtain-wall walls, a cornice and parapet; returns its roof rect. */
  const setback = (r: SkywaysRect, y: number, h: number, ix: number, iz: number): SkywaysRect | null => {
    const s = inset(r, ix, iz);
    if (s.x1 - s.x0 < 8 || s.z1 - s.z0 < 8) return null;
    for (const w of wallsOf(s, y, y + h)) {
      panels.push({axis: w.axis, c: w.c, n: w.n, s0: w.s0, s1: w.s1, t0: y, t1: y + h - 0.5});
      put(w, 'setback', trim, w.wraps ? w.s0 - 0.35 : w.s0, w.wraps ? w.s1 + 0.35 : w.s1, y + h - 0.5, y + h, 0, 0.35);
      if (S.piers && !S.piers.full) for (const c of [w.s0 + 0.2, w.s1 - 0.2]) put(w, 'setback', trim, c - 0.2, c + 0.2, y, y + h - 0.5, 0, 0.3, FACE.py);
    }
    roofs.push({q: {axis: 'y', c: y + h, n: 1, s0: s.x0, s1: s.x1, t0: s.z0, t1: s.z1}, color: ROOF});
    parapet(s, y + h, trim, null);
    return s;
  };

  const topRect = upper ? upper.rect : b.rect;
  let peak = top + F.parapet.h + F.parapet.cope;
  if (podium !== null && tower) {
    parapet(b.rect, podium, trim, tower);
    plant(b.rect, podium, 1 + Math.floor(rnd() * 2));
  }
  parapet(topRect, top, trim, null);
  let roof = topRect, roofY = top;
  if (crown === 'setback' || crown === 'stepped') {
    const W = topRect.x1 - topRect.x0, D = topRect.z1 - topRect.z0;
    const steps = crown === 'stepped' ? 2 : 1;
    for (let k = 0; k < steps; k++) {
      const h = F.storey * (k === 0 && rnd() < 0.5 ? 2 : 1);
      const ix = Math.max(2.4, Math.min(W * 0.2, lerp(2.4, 5.5, rnd()))), iz = Math.max(2.4, Math.min(D * 0.2, lerp(2.4, 5.5, rnd())));
      const s = setback(roof, roofY, h, ix, iz);
      if (!s) break;
      roof = s; roofY += h;
      peak = roofY + F.parapet.h + F.parapet.cope;
    }
    // a roof too narrow for a setback (a slim atrium tower) takes a penthouse instead
    if (roofY === top) crown = 'penthouse';
  }
  plant(roof, roofY, crown === 'penthouse' ? 2 : 1 + Math.floor(rnd() * 2), crown === 'penthouse');
  if ((crown === 'stepped' || (crown === 'setback' && top - gy > 45)) && (style === 'fins' || rnd() < 0.5)) {
    const cx = (roof.x0 + roof.x1) / 2, cz = (roof.z0 + roof.z1) / 2, mh = Math.max(6, Math.min(14, (top - gy) * 0.16));
    boxes.push({x0: cx - 0.22, x1: cx + 0.22, z0: cz - 0.22, z1: cz + 0.22, y0: roofY, y1: roofY + mh, color: STEEL, open: FACE.ny, part: 'mast'});
    for (const f of [0.45, 0.75]) boxes.push({x0: cx - 0.7, x1: cx + 0.7, z0: cz - 0.7, z1: cz + 0.7, y0: roofY + mh * f, y1: roofY + mh * f + 0.18, color: STEEL, open: 0, part: 'mast'});
    peak = Math.max(peak, roofY + mh);
  }
  if (crown === 'frame') peak = Math.max(peak, top + F.frame.h);
  if (boxes.length > F.maxBoxes) boxes.length = F.maxBoxes;
  return {building: b.id, style, crown, boxes, panels, roofs, peak: Math.round(peak * 1000) / 1000};
}

// ---------------------------------------------------------------------------------------------
// Emitter (into skywaysExterior.ts's merged geometry: positions / normals / colours / indices)

/** The merged-geometry arrays a facade box is written into (skywaysExterior.ts Geo). */
export interface FacadeSink { pos: number[]; nor: number[]; col: number[]; uv: number[]; idx: number[] }

/** Soot toward the top like the curtain-wall material (its albedo x (1 - 0.25 smoothstep(10, 40, h))). */
export function facadeSoot(h: number): number {
  const t = Math.min(1, Math.max(0, (h - 10) / 30));
  return 1 - 0.25 * t * t * (3 - 2 * t);
}

/** One quad (four corners counter-clockwise toward n) with per-vertex colours darkened by height. */
function quad(g: FacadeSink, p: number[][], n: number[], color: RGB, gy: number): void {
  const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2], bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
  const order = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const base = g.pos.length / 3;
  for (const i of order) {
    const k = facadeSoot(p[i][1] - gy);
    g.pos.push(p[i][0], p[i][1], p[i][2]); g.nor.push(n[0], n[1], n[2]); g.col.push(color[0] * k, color[1] * k, color[2] * k); g.uv.push(0, 0);
  }
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Writes a facade box (its drawn faces) into the sink; returns the triangles written. */
export function emitFacadeBox(g: FacadeSink, b: FacadeBox, gy: number): number {
  const {x0, y0, z0, x1, y1, z1} = b;
  let n = 0;
  const f = (bit: number, p: number[][], nn: number[]) => { if (!(b.open & bit)) { quad(g, p, nn, b.color, gy); n += 2; } };
  f(FACE.nx, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
  f(FACE.px, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
  f(FACE.nz, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
  f(FACE.pz, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  f(FACE.ny, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  f(FACE.py, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
  return n;
}
