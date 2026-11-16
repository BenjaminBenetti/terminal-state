// Task studio-survivor-market-crevice-20261116-074419 (lane VIEW): THE CREVICE's look planned from the finished version-5 layout (pure,
// deterministic; nothing stored in the layout, no draw on any generator / game stream: every choice is a hash of the station seed and
// the container / line index). What world/marketCrevice.ts draws over the grid walls the arch paints:
//  - every SHIPPING CONTAINER of layout.market.crevice (closed ones too: they are seen from the walks): its steel frame on the front
//    (corner posts, top / bottom side rails, corner castings) and on every VISIBLE END (an end facing a stair bay, a pocket, the square:
//    not a neighbour's shared wall, not the rock) the CARGO-DOOR END (two leaves, four locking bars, cam keepers, handles); seeded per
//    container: windows on the front wall (dark / lit / mesh / boarded), door frames, a steel canopy over some home doors, roof vents;
//    the shopfronts' roll-up shutter boxes;
//  - the BRIDGES: the cooked bridge kit's pieces along each deck (End + Mid / MidPlain + mirrored End, one stretch within the kit's
//    limits, the deck surface at the bridge's storey floor; trestles only where their feet land on solid ground that is no walkway);
//  - LINES across the crevice between the two sides' terrace edges (laundry / cables) and laundry lines along the terraces hung off the
//    railings over the walk below — never through a deck, a slab or the rock, never lower than CREV_ART.line.clear over any walk;
//  - AWNINGS (the tarp: gen/market/art.ts MarketAwning, along z for the crevice's E / W fronts) over the shopfronts and some home doors,
//    never under a bridge; FANS only inside the kitchen and the big shops (no fan in the open crevice).
// All visual only: collision / navigation never need them (the bridges' walking surface is the grid's deck).

import {CELL, FLOOR, SOLID, type Grid} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import type {MarketCrevContainer, MarketCrevice} from '../marketTypes';
import type {MarketAwning, MarketFan} from '../art';
import type {MarketLine} from '../v2/art';

/** Dimensions (m). */
export const CREV_ART = {
  /** A container box's height: the storey pitch (its roof is the walk above). */
  pitch: 2.95,
  frame: {
    /** Corner posts (along the face, outward), side rails (height, outward), the bottom rail, castings (along, up, outward). */
    post: 0.16, postProud: 0.085, rail: 0.17, railProud: 0.065, bottom: 0.15, casting: [0.2, 0.13, 0.105] as const,
    /** How far a visible end's frame stands proud of the end wall; the dark slot between two neighbours' posts (half width). */
    endProud: 0.055, gap: 0.035,
  },
  /** Cargo doors: leaf proud, the locking bars (size, proud), the leaf's sill / header clearances. */
  cargo: {leaf: 0.03, bar: 0.045, barProud: 0.085, sill: 0.17, header: 0.22},
  /** Corrugation ribs on the front: pitch, base / face width, proud. */
  rib: {pitch: 0.3, base: 0.13, face: 0.075, proud: 0.028},
  door: {architrave: 0.11, proud: 0.045, header: 0.12, canopy: {depth: 0.6, wall: 2.62, drop: 0.16, over: 0.2}},
  window: {margin: 0.42, gap: 0.4, sill: [0.95, 1.15] as const, h: [0.7, 0.92] as const, w: [0.8, 1.35] as const, frame: 0.07, proud: 0.04, pane: 0.022},
  vent: {w: 0.3, h: 0.15, below: 0.42},
  shutter: {h: 0.24, proud: 0.24, over: 0.12},
  awning: {depth: 0.95, drop: 0.28, wall: 2.68, over: 0.22},
  /** Lines: clearance over any walk, sag, end heights over the terrace edge (across) / the railing (along), the along-line's offset out
   *  over the drop, the spacing down the chasm, the gap kept from a bridge deck's band, the laundry lines (across first, then all) and
   *  the market's garment budget (world/marketClothes.ts planLaundry `max`) — bounded: the hung garments are real models (~6k triangles
   *  each; versions 2-4 hang up to ~18). */
  line: {clear: 2.3, sag: [0.18, 0.38] as const, cross: [2.45, 2.75] as const, terrace: 1.15, out: 0.35, step: 2.7, bridgeGap: 1.25, laundry: [1, 3] as const, laundryRun: 11.5, garments: 18},
  fan: {r: 0.62, hubDrop: 0.32, spin: [0.9, 1.4] as const, minArea: 20},
} as const;

const PITCH = CREV_ART.pitch;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A deterministic [0, 1) hash of two ints (the look's own stream: never a generator draw). */
export function crevHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}
/** A small seeded stream (mulberry-style) for one container / line. */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The crevice record of a version-5 market layout (null: not one). */
export function crevOf(layout: StationLayout): MarketCrevice | null {
  return layout.market?.v === 5 && layout.market.crevice ? layout.market.crevice : null;
}

// --- Containers --------------------------------------------------------------------------------------------------------------------

export type CrevWindowKind = 'dark' | 'lit' | 'mesh' | 'boarded';
/** A window on the front wall: [s0, s1] along the front, heights absolute. */
export interface CrevWindow { s0: number; s1: number; y0: number; y1: number; kind: CrevWindowKind }
/** An opening in the front wall (from the record) and its dressing. */
export interface CrevDoorArt { s0: number; s1: number; h: number; wide: boolean; canopy: boolean; awning: boolean }
/** One end of a container: its plane (s), outward sign along s, visible (open space before it), shared (a neighbour's wall row). */
export interface CrevEnd { at: number; out: 1 | -1; visible: boolean; shared: boolean }

export interface CrevContainerArt {
  index: number;
  /** The front runs along world z (an E / W face: s = z) or along x (an N / S face: s = x). */
  axis: 'z' | 'x';
  /** The front plane (world x for axis z, z for axis x), outward sign along the front's normal, and the back wall's inner face. */
  front: number;
  out: 1 | -1;
  back: number;
  /** Own extent along the front (a shared end wall row is split at its middle), storey floor and the box top. */
  s0: number; s1: number;
  y: number; top: number;
  level: number;
  paint: number;
  closed: boolean;
  use: string;
  ends: [CrevEnd, CrevEnd];
  doors: CrevDoorArt[];
  windows: CrevWindow[];
  /** Roof vents (their centre along the front). */
  vents: number[];
}

const levelGrid = (layout: StationLayout, L: number): Grid | null => layout.levels[L]?.grid ?? (L === 0 ? layout.grid : null);
/** Storey L's cell value at a world point (SOLID outside). */
function cellAt(layout: StationLayout, L: number, x: number, z: number): number {
  const g = levelGrid(layout, L);
  if (!g) return SOLID;
  const [cx, cy] = g.cellOf(x, z);
  return g.get(cx, cy);
}

/** The front geometry of a container record. */
export function containerFront(c: MarketCrevContainer): {axis: 'z' | 'x'; front: number; out: 1 | -1; back: number; s0: number; s1: number; n0: number; n1: number} {
  if (c.face === 'E' || c.face === 'W') {
    const e = c.face === 'E';
    return {axis: 'z', front: e ? c.x1 : c.x0, out: e ? 1 : -1, back: e ? c.x0 + CELL : c.x1 - CELL, s0: c.z0, s1: c.z1, n0: c.x0, n1: c.x1};
  }
  const s = c.face === 'S';
  return {axis: 'x', front: s ? c.z1 : c.z0, out: s ? 1 : -1, back: s ? c.z0 + CELL : c.z1 - CELL, s0: c.x0, s1: c.x1, n0: c.z0, n1: c.z1};
}

const USE_WINDOWS: Readonly<Record<string, number>> = {home: 3, bunks: 2, 'clinic-store': 1, laundry: 1, tea: 1, repair: 1, kitchen: 1, workshop: 1, shop: 1};

/** The look of every container of a version-5 layout (index order = layout.market.crevice.containers). */
export function creviceContainerArt(layout: StationLayout): CrevContainerArt[] {
  const cr = crevOf(layout);
  if (!cr) return [];
  const C = cr.containers, F = CREV_ART;
  const fronts = C.map(containerFront);
  return C.map((c, i) => {
    const f = fronts[i];
    const rnd = stream(Math.imul(layout.seed >>> 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b));
    // --- ends: shared with a neighbour (its box overlaps our end wall row), visible (open floor / void before it, no other box) ---
    const inOther = (x: number, z: number) => C.some((q, k) => k !== i && q.level === c.level && x > q.x0 + 1e-3 && x < q.x1 - 1e-3 && z > q.z0 + 1e-3 && z < q.z1 - 1e-3);
    const ends = ([0, 1] as const).map(e => {
      const at = e ? f.s1 : f.s0, out: 1 | -1 = e ? 1 : -1;
      let own = at, shared = false;
      for (let k = 0; k < C.length; k++) {
        if (k === i || C[k].level !== c.level) continue;
        const g = fronts[k];
        if (g.axis !== f.axis || Math.min(g.n1, f.n1) - Math.max(g.n0, f.n0) < CELL) continue;
        const far = e ? g.s0 : g.s1; // the neighbour's edge inside / at our end row
        const d = (far - at) * -out; // > 0: it reaches into our end row
        if (d > -0.01 && d <= CELL + 0.01) { shared = true; own = d > 0.01 ? (at + far) / 2 : at; }
      }
      let open = 0, n = 0;
      const nLo = Math.min(f.back, f.front), nHi = Math.max(f.back, f.front);
      for (let u = nLo + CELL / 2; u < nHi; u += CELL) {
        const s = at + out * CELL / 2, x = f.axis === 'z' ? u : s, z = f.axis === 'z' ? s : u;
        n++;
        if (cellAt(layout, c.level, x, z) !== SOLID && !inOther(x, z)) open++;
      }
      return {at: r3(own), out, visible: !shared && n > 0 && open * 2 >= n, shared};
    }) as [CrevEnd, CrevEnd];
    const s0 = ends[0].at, s1 = ends[1].at;
    const closed = c.area < 0;
    // --- openings: door frames, canopies / awnings (none where a bridge or a slab hangs low over the walk in front) ---
    const g = levelGrid(layout, c.level);
    const roomy = (a: number, b: number, depth: number, h: number) => {
      if (!g) return false;
      for (let s = a + 0.1; s < b; s += 0.4) for (const u of [0.15, depth - 0.1]) {
        const n = f.front + f.out * u, x = f.axis === 'z' ? n : s, z = f.axis === 'z' ? s : n;
        if (g.ceilAt(x, z) < c.y + h + 0.12) return false;
      }
      return true;
    };
    const doors: CrevDoorArt[] = c.openings.map(o => {
      const t = rnd();
      const homey = !closed && (c.use === 'home' || c.use === 'bunks');
      const awning = o.wide ? t < 0.85 : homey && t >= 0.32 && t < 0.58;
      const canopy = !o.wide && homey && t < 0.32;
      return {s0: o.s0, s1: o.s1, h: o.h, wide: o.wide,
        canopy: canopy && roomy(o.s0 - F.door.canopy.over, o.s1 + F.door.canopy.over, F.door.canopy.depth, F.door.canopy.wall),
        awning: awning && roomy(o.s0 - F.awning.over, o.s1 + F.awning.over, F.awning.depth, F.awning.wall)};
    });
    // --- windows: free runs of the front (clear of the posts and every opening's frame), seeded count / size / kind ---
    let free: [number, number][] = [[s0 + F.window.margin, s1 - F.window.margin]];
    const cut = (a: number, b: number) => { free = free.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : [[p, a], [b, q]].filter(([u, v]) => v - u > 0.05)) as [number, number][]); };
    for (const o of c.openings) cut(o.s0 - F.door.architrave - 0.3, o.s1 + F.door.architrave + 0.3);
    const windows: CrevWindow[] = [];
    const want = closed ? (rnd() < 0.5 ? 1 : 0) : Math.round((USE_WINDOWS[c.use] ?? 0) * (0.5 + 0.5 * rnd()) * Math.min(1, (s1 - s0) / 7));
    for (let k = 0; k < want; k++) {
      const w = F.window.w[0] + (F.window.w[1] - F.window.w[0]) * rnd();
      const runs = free.filter(([p, q]) => q - p >= w);
      if (!runs.length) break;
      const [p, q] = runs[Math.floor(rnd() * runs.length)];
      const a = p + (q - p - w) * rnd();
      const sill = F.window.sill[0] + (F.window.sill[1] - F.window.sill[0]) * rnd(), h = F.window.h[0] + (F.window.h[1] - F.window.h[0]) * rnd();
      const t = rnd();
      const kind: CrevWindowKind = closed ? (t < 0.6 ? 'boarded' : 'dark') : t < 0.42 ? 'lit' : t < 0.66 ? 'dark' : t < 0.83 ? 'mesh' : 'boarded';
      windows.push({s0: r3(a), s1: r3(a + w), y0: r3(c.y + sill), y1: r3(c.y + sill + h), kind});
      cut(a - F.window.gap, a + w + F.window.gap);
    }
    windows.sort((p, q) => p.s0 - q.s0);
    // --- roof vents: near one or both ends, high on the front, clear of openings and windows ---
    const vents: number[] = [];
    const nv = rnd() < 0.35 ? 0 : rnd() < 0.6 ? 1 : 2;
    const vy0 = c.y + PITCH - F.frame.rail - F.vent.below, vy1 = vy0 + F.vent.h;
    for (const sv of [s0 + 0.5, s1 - 0.5].slice(0, nv)) {
      const a = sv - F.vent.w / 2 - 0.08, b = sv + F.vent.w / 2 + 0.08;
      if (c.openings.some(o => b > o.s0 - F.door.architrave && a < o.s1 + F.door.architrave && vy0 < c.y + o.h + F.door.header + 0.05)) continue;
      if (windows.some(wd => b > wd.s0 - 0.1 && a < wd.s1 + 0.1 && vy0 < wd.y1 + 0.1 && vy1 > wd.y0 - 0.1)) continue;
      vents.push(r3(sv));
    }
    return {index: i, axis: f.axis, front: f.front, out: f.out, back: f.back, s0, s1, y: c.y, top: r3(c.y + PITCH), level: c.level, paint: c.paint, closed, use: c.use, ends, doors, windows, vents};
  });
}

// --- Bridges -----------------------------------------------------------------------------------------------------------------------

export type BridgePieceName = 'End' | 'Mid' | 'MidPlain' | 'Trestle';
/** The bridge kit's contract (assets/marketBridgeKit.generated.ts MARKET_BRIDGE_KIT, the BRIDGE lane), metres, the deck along +X, its
 *  walking surface at y = deckY: an End's joint plane at x = 0, its abutment toward -x (length); a Mid / MidPlain bay x 0 .. length
 *  (tiles at x += length * k, k the stretch); the girders' bottom flanges at -girderDepth (MidPlain: nothing lower), the Mid's cable
 *  festoon down to -cableDrop; a Trestle leg frame from y 0 down to -height (under an End at End-local endTrestleX, its top at
 *  -legCutDepth; under a bay joint at -girderDepth). A span of n bays at stretch k measures 2 * End.length + n * Mid.length * k. */
export interface BridgeKitSpec {
  pieces: {End: {length?: number}; Mid: {length?: number}; MidPlain: {length?: number}; Trestle?: {height?: number}};
  deckY: number;
  girderDepth: number;
  cableDrop: number;
  legCutDepth?: number;
  endTrestleX?: number;
  stretch: {min: number; max: number};
}

/** One placed piece: its frame origin (an End's joint plane / a bay's start; the deck surface at y; a Trestle's top), stretch along X,
 *  yaw (0 or PI: the far End is TURNED about Y so its abutment faces +x — a proper rotation, never a mirror: no flipped winding). */
export interface CrevBridgePiece { bridge: number; piece: BridgePieceName; x: number; y: number; z: number; sx: number; yaw: number; x0: number; x1: number }

/** The bays (count, stretch) spanning `inner` metres between the two Ends: the stretch closest to 1 within the kit's limits (null: none). */
export function bridgeBays(inner: number, bay: number, stretch: {min: number; max: number}): {n: number; k: number} | null {
  let best: {n: number; k: number} | null = null;
  for (let n = 1; n <= 128; n++) {
    const k = inner / (n * bay);
    if (k < stretch.min - 1e-9) break;
    if (k <= stretch.max + 1e-9 && (!best || Math.abs(k - 1) < Math.abs(best.k - 1))) best = {n, k};
  }
  return best;
}

/**
 * The kit's pieces along every bridge deck of a version-5 layout: an End at each walk edge (the far one turned), n bays between them at
 * one stretch (the closest to 1 within the kit's limits; a deck no stretch fits takes the nearest count, out of range), the cabled Mid
 * only where its whole bay lies over the chasm (its festoon hangs into nothing but the depth), the plain bay over the walks; the deck
 * surface at the bridge's floor, centred on its z band. Trestles only where their feet land on solid ground that is no walkway (the
 * crevice's decks stand over walks or the deep chasm: usually none).
 */
export function creviceBridgePieces(layout: StationLayout, kit: BridgeKitSpec): CrevBridgePiece[] {
  const cr = crevOf(layout);
  if (!cr) return [];
  const out: CrevBridgePiece[] = [];
  const E = kit.pieces.End.length ?? 0, bay = kit.pieces.Mid.length ?? kit.pieces.MidPlain.length ?? 1;
  cr.bridges.forEach((b, bi) => {
    const D = b.x1 - b.x0, z = r3((b.z0 + b.z1) / 2), y = r3(b.y - kit.deckY), inner = D - 2 * E;
    const fit = bridgeBays(inner, bay, kit.stretch);
    const n = fit?.n ?? Math.max(1, Math.round(inner / bay)), k = fit?.k ?? inner / (n * bay);
    out.push({bridge: bi, piece: 'End', x: r3(b.x0 + E), y, z, sx: 1, yaw: 0, x0: b.x0, x1: r3(b.x0 + E)});
    const joints: number[] = [];
    for (let j = 0; j < n; j++) {
      const xa = b.x0 + E + j * bay * k, xb = xa + bay * k;
      const piece: BridgePieceName = xa >= cr.chasm.x0 - 1e-6 && xb <= cr.chasm.x1 + 1e-6 ? 'Mid' : 'MidPlain';
      out.push({bridge: bi, piece, x: r3(xa), y, z, sx: r3(k), yaw: 0, x0: r3(xa), x1: r3(xb)});
      if (j) joints.push(xa);
    }
    out.push({bridge: bi, piece: 'End', x: r3(b.x1 - E), y, z, sx: 1, yaw: Math.PI, x0: r3(b.x1 - E), x1: b.x1});
    const H = kit.pieces.Trestle?.height;
    if (!H) return;
    const legs: [number, number][] = joints.map(x => [x, b.y - kit.girderDepth]);
    if (kit.endTrestleX !== undefined && kit.legCutDepth !== undefined) legs.push([b.x0 + E + kit.endTrestleX, b.y - kit.legCutDepth], [b.x1 - E - kit.endTrestleX, b.y - kit.legCutDepth]);
    for (const [x, top] of legs) if (trestleLands(layout, x, z, top, top - H)) out.push({bridge: bi, piece: 'Trestle', x: r3(x), y: r3(top), z, sx: 1, yaw: 0, x0: r3(x), x1: r3(x)});
  });
  return out;
}

/** A trestle at (x, z) from `top` to `feet`: every foot sample stands on solid ground within 8 cm that is no walkway, and its body
 *  crosses no walkable floor (no walk, no deck). */
function trestleLands(layout: StationLayout, x: number, z: number, top: number, feet: number): boolean {
  for (const dz of [-1.0, 0, 1.0]) for (const dx of [-0.2, 0.2]) {
    const b = crevBandAt(layout, x + dx, feet + 0.05, z + dz);
    if (!b || b.walk || Math.abs(b.floor - feet) > 0.08) return false;
    for (let yy = feet + 0.3; yy < top; yy += 0.4) { const q = crevBandAt(layout, x + dx, yy, z + dz); if (!q || q.walk) return false; }
  }
  return true;
}

// --- Free space (lines, laundry) ---------------------------------------------------------------------------------------------------

/** The storey band holding (x, y, z): a carved cell of some storey whose floor .. ceiling holds y (null: rock / a slab / a box). */
export function crevBandAt(layout: StationLayout, x: number, y: number, z: number): {level: number; floor: number; ceil: number; walk: boolean} | null {
  for (let L = 0; L < layout.levels.length; L++) {
    const g = levelGrid(layout, L);
    if (!g) continue;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy), c = g.cells[i];
    if (c === SOLID) continue;
    const f = g.floorAt(x, z), ceil = g.ceilAt(x, z);
    if (y >= f - 0.01 && y < ceil) return {level: L, floor: f, ceil, walk: c === FLOOR};
  }
  return null;
}

/** May a wire pass through (x, y, z)? Free space, at least `clear` over a walkable floor, clear of the slab / deck above. */
export function crevWireOk(layout: StationLayout, x: number, y: number, z: number, clear: number = CREV_ART.line.clear): boolean {
  const b = crevBandAt(layout, x, y, z);
  if (!b) return false;
  if (y > b.ceil - 0.12) return false;
  return !b.walk || y >= b.floor + clear;
}

/** A line of the crevice (gen/market/v2/art.ts MarketLine) + the poles it is tied to: at (x, z) from y0 up to the line's end (+ an arm
 *  to the end when the pole stands off it). */
export interface CrevLine extends MarketLine {
  /** (a wire between two storeys) the far (x1, z1) end's height; absent = y (a level line: the only ones that carry laundry). */
  y1?: number;
  poles: {x: number; z: number; y0: number; y1: number}[];
}

/** A crevice line's height at t (0..1 from its x0 / z0 end): the straight run between its ends, less its sag. */
export const crevLineY = (l: MarketLine & {y1?: number}, t: number): number => l.y + ((l.y1 ?? l.y) - l.y) * t - l.sag * 4 * t * (1 - t);

/** The awnings / canopies' footprints (obstacles for the laundry): axis-aligned boxes. */
export interface CrevBox { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

/** The awnings of a version-5 layout (the tarp: shopfronts and some home doors), the wall along z for the E / W fronts. */
export function creviceAwnings(layout: StationLayout, art = creviceContainerArt(layout)): MarketAwning[] {
  const A = CREV_ART.awning, out: MarketAwning[] = [];
  for (const c of art) for (const d of c.doors) {
    if (!d.awning) continue;
    const yWall = r3(c.y + A.wall);
    out.push({x0: r3(d.s0 - A.over), x1: r3(d.s1 + A.over), z: r3(c.front + c.out * (CREV_ART.rib.proud + 0.004)), depth: A.depth, yWall, yEdge: r3(yWall - A.drop), stall: c.use, dir: c.out, ...(c.axis === 'z' ? {axis: 'z' as const} : {})});
  }
  return out;
}

/** The boxes hanging things keep above: awnings, door canopies, shutter boxes. */
export function creviceObstacles(layout: StationLayout, art = creviceContainerArt(layout)): CrevBox[] {
  const out: CrevBox[] = [];
  const add = (c: CrevContainerArt, s0: number, s1: number, depth: number, y0: number, y1: number) => {
    const n0 = c.front, n1 = c.front + c.out * depth;
    if (c.axis === 'z') out.push({x0: Math.min(n0, n1), x1: Math.max(n0, n1), z0: s0, z1: s1, y0, y1});
    else out.push({x0: s0, x1: s1, z0: Math.min(n0, n1), z1: Math.max(n0, n1), y0, y1});
  };
  const A = CREV_ART.awning, Cn = CREV_ART.door.canopy, S = CREV_ART.shutter;
  for (const c of art) for (const d of c.doors) {
    if (d.awning) add(c, d.s0 - A.over, d.s1 + A.over, A.depth, c.y + A.wall - A.drop, c.y + A.wall);
    if (d.canopy) add(c, d.s0 - Cn.over, d.s1 + Cn.over, Cn.depth, c.y + Cn.wall - Cn.drop, c.y + Cn.wall);
    if (d.wide) add(c, d.s0 - S.over, d.s1 + S.over, S.proud, c.y + d.h, c.y + d.h + S.h);
  }
  return out;
}

/** The terrace edges per storey (the walk's outer edge = the front plane of the band below; storey 0: the chasm's edges). */
function terraceEdges(cr: MarketCrevice): {W: number; E: number}[] {
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const out: {W: number; E: number}[] = [{W: cr.chasm.x0, E: cr.chasm.x1}];
  for (let L = 1; L < cr.bases.length; L++) {
    out.push({W: med(cr.containers.filter(c => c.level === L - 1 && c.face === 'E').map(c => c.x1)), E: med(cr.containers.filter(c => c.level === L - 1 && c.face === 'W').map(c => c.x0))});
  }
  return out;
}

/** Every sample of a line (and its sag) passes crevWireOk; it keeps CREV_ART.line.bridgeGap from every bridge deck's band. */
function lineOk(layout: StationLayout, cr: MarketCrevice, l: CrevLine): boolean {
  const run = Math.hypot(l.x1 - l.x0, l.z1 - l.z0), n = Math.max(2, Math.ceil(run / 0.2));
  for (const b of cr.bridges) if (Math.max(l.z0, l.z1) > b.z0 - CREV_ART.line.bridgeGap && Math.min(l.z0, l.z1) < b.z1 + CREV_ART.line.bridgeGap && Math.max(l.x0, l.x1) > b.x0 - 0.5 && Math.min(l.x0, l.x1) < b.x1 + 0.5) return false;
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = l.x0 + (l.x1 - l.x0) * t, z = l.z0 + (l.z1 - l.z0) * t, y = crevLineY(l, t);
    if (!crevWireOk(layout, x, y, z)) return false;
  }
  return true;
}

/**
 * The lines of a version-5 layout: across the crevice between the two sides' terrace edges (same storey or one apart; the low walks'
 * chasm edges too), laundry or bare cables, every ~CREV_ART.line.step m down the chasm (seeded heights / sag / skew), and laundry lines
 * along the terraces hung off a railing over the walk below. Each one passes lineOk (no deck, slab or rock; >= clear over every walk).
 */
export function creviceLines(layout: StationLayout): CrevLine[] {
  const cr = crevOf(layout);
  if (!cr) return [];
  const Ln = CREV_ART.line, B = cr.bases, edges = terraceEdges(cr), out: CrevLine[] = [];
  const seed = layout.seed >>> 0;
  // across: down the chasm rows
  let k = 0;
  for (let z = cr.chasm.z0 + 1.2; z < cr.chasm.z1 - 1.0; z += Ln.step) {
    const h = (j: number) => crevHash(seed + j * 7919, k * 31 + 5);
    const zz = r3(z + (h(1) - 0.5) * 1.2);
    k++;
    // a storey per slot: lower ones more often (laundry), the top ones cables
    const pick = h(2);
    const La = pick < 0.22 ? 0 : pick < 0.55 ? 1 : pick < 0.82 ? 2 : 3;
    const Lb = Math.min(B.length - 1, Math.max(0, La + (h(3) < 0.25 ? (h(4) < 0.5 ? -1 : 1) : 0)));
    const west = h(5) < 0.5;
    const [Lw, Le] = west ? [La, Lb] : [Lb, La];
    const ew = edges[Lw]?.W, ee = edges[Le]?.E;
    if (!Number.isFinite(ew) || !Number.isFinite(ee)) continue;
    const skew = (h(8) - 0.5) * 1.4;
    const sag = Ln.sag[0] + (Ln.sag[1] - Ln.sag[0]) * h(9);
    const laundry = Lw === Le && Math.abs(ee - ew) <= Ln.laundryRun && h(10) < 0.72 && out.filter(q => q.laundry).length < Ln.laundry[0];
    // (a laundry line is LEVEL: world/marketClothes.ts planLaundry hangs from y less the sag, the far end's y1 unread)
    const yw = B[Lw] + Ln.cross[0] + (Ln.cross[1] - Ln.cross[0]) * h(6), ye = laundry ? yw : B[Le] + Ln.cross[0] + (Ln.cross[1] - Ln.cross[0]) * h(7);
    const x0 = r3(ew + 0.02), x1 = r3(ee - 0.02), z0 = r3(zz - skew / 2), z1 = r3(zz + skew / 2);
    // (a line between two storeys: y at the west end, the east end's height in y1 — sloped wire, MarketLine's sag on top)
    const line: CrevLine = {x0, z0, x1, z1, y: r3(yw), sag: r3(sag), laundry, seed: 1000 + out.length, poles: [
      {x: x0, z: z0, y0: B[Lw] + 1.0, y1: r3(yw + 0.06)}, {x: x1, z: z1, y0: B[Le] + 1.0, y1: r3(ye + 0.06)}]};
    if (Math.abs(ye - yw) > 1e-6) line.y1 = r3(ye);
    if (lineOk(layout, cr, line)) out.push(line);
  }
  // along the terraces: off the railing of storey L (L >= 1) over the walk below, a short run between two ties
  for (const side of ['W', 'E'] as const) for (let L = 1; L < B.length; L++) {
    const edge = edges[L]?.[side];
    if (!Number.isFinite(edge)) continue;
    const o = side === 'W' ? 1 : -1, x = r3(edge + o * Ln.out), y = r3(B[L] + Ln.terrace);
    for (let t = 0; t < 2; t++) {
      if (out.filter(q => q.laundry).length >= Ln.laundry[1]) break;
      const h = (j: number) => crevHash(seed ^ (side === 'W' ? 0x3c6ef372 : 0x1b873593), L * 977 + t * 131 + j);
      const len = 3.5 + 3 * h(1);
      const za = r3(cr.chasm.z0 + 1 + (cr.chasm.z1 - cr.chasm.z0 - 2 - len) * h(2)), zb = r3(za + len);
      const line: CrevLine = {x0: x, z0: za, x1: x, z1: zb, y, sag: r3(0.1 + 0.08 * h(3)), laundry: true, seed: 2000 + out.length, poles: [
        {x: r3(edge + o * 0.03), z: za, y0: B[L] + 0.95, y1: r3(y + 0.08)}, {x: r3(edge + o * 0.03), z: zb, y0: B[L] + 0.95, y1: r3(y + 0.08)}]};
      if (out.some(q => q.x0 === x && q.x1 === x && Math.max(q.z0, q.z1) > za - 1 && Math.min(q.z0, q.z1) < zb + 1)) continue;
      if (lineOk(layout, cr, line)) out.push(line);
    }
  }
  return out;
}

/**
 * The laundry rule of a version-5 layout (world/marketClothes.ts planLaundry): the lowest a garment hanging from `top` may reach at
 * (x, z) — CREV_ART.line.clear over the walk under it, over every awning / canopy / shutter box there; Infinity where it may not hang
 * (rock, a slab or deck right above, under a bridge).
 */
export function creviceLaundryFloor(layout: StationLayout, obstacles = creviceObstacles(layout)): (x: number, z: number, top: number) => number {
  const cr = crevOf(layout);
  return (x, z, top) => {
    if (!cr) return Infinity;
    for (const b of cr.bridges) if (z > b.z0 - CREV_ART.line.bridgeGap && z < b.z1 + CREV_ART.line.bridgeGap && x > b.x0 - 0.5 && x < b.x1 + 0.5) return Infinity;
    const band = crevBandAt(layout, x, top, z);
    if (!band || top > band.ceil - 0.1) return Infinity;
    let m = band.walk ? band.floor + CREV_ART.line.clear : band.floor + 0.5;
    for (const o of obstacles) if (x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05 && o.y1 < top) m = Math.max(m, o.y1 + 0.05);
    return m;
  };
}

// --- Fans --------------------------------------------------------------------------------------------------------------------------

/** The fans of a version-5 layout: one inside the communal kitchen and each big shop (a covered room: never the open crevice). */
export function creviceFans(layout: StationLayout): MarketFan[] {
  const cr = crevOf(layout);
  if (!cr) return [];
  const F = CREV_ART.fan, out: MarketFan[] = [];
  const shopAreas = new Set((layout.market?.stalls ?? []).map(s => s.area));
  for (const a of layout.areas) {
    if (a.kind !== 'room') continue;
    const big = (a.type === 'shop' || shopAreas.has(a.id)) && a.w * a.h * CELL * CELL >= F.minArea;
    if (!(a.label === 'Communal kitchen' || big)) continue;
    const L = a.level ?? 0, g = levelGrid(layout, L);
    if (!g) continue;
    const base = cr.bases[L] ?? 0;
    // the room's middle, nudged off the hanging lamps and tall props
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    const spots: [number, number][] = [[cx, cz], [cx, cz - 0.9], [cx, cz + 0.9], [cx - 0.6, cz], [cx + 0.6, cz]];
    for (const [x, z] of spots) {
      const ceil = g.ceilAt(x, z);
      if (!Number.isFinite(ceil) || ceil > base + 4) continue;
      const y = ceil - F.hubDrop;
      let ok = true;
      for (const [dx, dz] of [[0, 0], [F.r + 0.2, 0], [-F.r - 0.2, 0], [0, F.r + 0.2], [0, -F.r - 0.2]]) {
        const [qx, qy] = g.cellOf(x + dx, z + dz);
        if (!g.inBounds(qx, qy) || g.area[g.idx(qx, qy)] !== a.id || g.cells[g.idx(qx, qy)] !== FLOOR || Math.abs(g.ceilAt(x + dx, z + dz) - ceil) > 0.05) { ok = false; break; }
      }
      if (ok && layout.lights.some(l => (l.level ?? 0) === L && Math.hypot(l.x - x, l.z - z) < F.r + 0.25)) ok = false;
      if (ok && layout.props.some(p => (p.level ?? 0) === L && Math.max(Math.abs(p.x - x) - p.hx, Math.abs(p.z - z) - p.hz) < F.r + 0.3 && p.y + p.h > y - 0.2)) ok = false;
      if (!ok) continue;
      const k = out.length;
      out.push({x: r3(x), y: r3(y), z: r3(z), r: F.r, rod: r3(ceil - y), level: L, speed: r3(F.spin[0] + (F.spin[1] - F.spin[0]) * crevHash(layout.seed, k)), phase: r3(crevHash(k, layout.seed) * Math.PI * 2)});
      break;
    }
  }
  return out;
}
