// Task studio-reactor-surface-ending-20261102 (lane REPAIRS, user: "some overlapping signs in the sub areas"): ONE clearance pass over the
// wall plates of the side complexes (bunker / mines / waste), run by the host right after the complexes' own dress hooks
// (complex/host.ts dressComplexes) and before the cables are routed (the cable router treats plates as obstacles).
//
// Root cause (measured over 16 real seeds: 147 overlaps, every seed): four placers stencil plates on the same walls and none saw the
// others — the shared station dresser's stock plates ('AUTHORIZED PERSONNEL ONLY' mid-wall in every service corridor, the purpose
// door plates 'FIRST AID' / 'ELECTRICAL' …), then each complex's own door / room / wayfinding plates (bunker wallSign, mines sign,
// waste plate). Plates landed on plates (the mines' 'REFUGE CHAMBER' exactly on the stock 'FIRST AID' of the same door, the
// bunker's 'DECONTAMINATION' door plate on its 'DECONTAMINATION · SHELTER 7' lock plate), inside the blast door's frame, behind
// the bunker's ceiling ducts, across the waste repository's heavy door frames, on wall fans, CCTV cameras, punch clocks and shelves.
//
// The rule, per complex (its areas + the deck in front of its entrance), deterministic (no rng), plates only (grid / props untouched):
//  - plates of any other area of the storey and the deck's own plates stay where they are (obstacles);
//  - the complex's OWN plates (placed by its dress hook) keep priority in their placement order, then the stock plates;
//  - a plate is clear when its box (wall face + PLATE_CLEAR.depth) keeps PLATE_CLEAR.gap from every kept plate and does not meet a
//    prop, a decor / waste box, a waste model / fan, a light fixture, the blast door's frame (its feet + the body between them) or
//    the reserved jam-board wall (WasteDecor.genSign);
//  - a plate that is not clear:
//    - an untouched stock door plate that meets one of the complex's own plates is dropped (the complex names its doors in its own
//      words, like the bunker's re-lettering);
//    - a plate meaning what a kept plate of the complex says (the one it meets, or one in the same room: 'DECONTAMINATION' /
//      'DECONTAMINATION · SHELTER 7') is merged into it: the kept plate takes the more specific wording;
//    - else it moves: along its own wall (0.25 m steps, small height changes), else round the nearer corner onto a return wall of its
//      room, else narrower (x 0.8 / x 0.65, >= 1 m) — wall-backed (gen/doorways.ts wallBacked: never across an opening, a plate over
//      a door stays above its lintel), 1.6 m+ over the floor, under the ceiling, within reach; the cheapest move wins. If none fits it
//      is dropped (counted, logged: PLATE_CLEAR_STATS).

import {CELL} from '../../grid';
import {signDims, wallBacked} from '../../doorways';
import type {SignPlacement, StationLayout} from '../../stationTypes';

/** Tunables (m). */
export const PLATE_CLEAR = {
  /** Plate box depth off the wall face (the plate sits 2 cm off it, ~6 cm thick incl. its standoff). */
  depth: 0.1,
  /** Clear gap kept between two plates along the wall / vertically. */
  gap: 0.06,
  /** Slide step and the reach of the complex's own plates (stock plates may use the whole wall). */
  step: 0.25,
  ownReach: 4,
  /** Height changes tried (m), and the plate's floor / ceiling margins. */
  heights: [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45, -0.6],
  minAbove: 1.6,
  ceilGap: 0.05,
} as const;

/** What the last pass did (QA / tests). */
export const PLATE_CLEAR_STATS = {plates: 0, moved: 0, redundant: 0, dropped: 0, log: [] as string[]};

export interface Box3 { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }
type Side = 'N' | 'S' | 'W' | 'E';

/** The wall a plate hangs on (layout.signs convention: rot 0 = on the N wall facing +z, PI = S, PI / 2 = W, -PI / 2 = E). */
export function plateSide(rot: number): Side {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Math.abs(c) >= Math.abs(s) ? (c > 0 ? 'N' : 'S') : (s > 0 ? 'W' : 'E');
}

/** World box of a wall plate (from its wall face out to PLATE_CLEAR.depth, its rendered size; signDims). */
export function plateBox(s: Pick<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'kind' | 'w'>): Box3 {
  const {w, h} = signDims(s), side = plateSide(s.rot), D = PLATE_CLEAR.depth;
  const y0 = s.y - h / 2, y1 = s.y + h / 2;
  if (side === 'N') return {x0: s.x - w / 2, x1: s.x + w / 2, z0: s.z - 0.02, z1: s.z - 0.02 + D, y0, y1};
  if (side === 'S') return {x0: s.x - w / 2, x1: s.x + w / 2, z0: s.z + 0.02 - D, z1: s.z + 0.02, y0, y1};
  if (side === 'W') return {x0: s.x - 0.02, x1: s.x - 0.02 + D, z0: s.z - w / 2, z1: s.z + w / 2, y0, y1};
  return {x0: s.x + 0.02 - D, x1: s.x + 0.02, z0: s.z - w / 2, z1: s.z + w / 2, y0, y1};
}

const meets = (a: Box3, b: Box3, e = 0.005) => a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e;
/** Two plate boxes closer than the clear gap (along the wall / vertically; their depth ranges overlapping). */
export function platesClash(a: Box3, b: Box3, gap: number = PLATE_CLEAR.gap): boolean {
  const g = gap / 2;
  return meets({x0: a.x0 - g, x1: a.x1 + g, z0: a.z0 - g, z1: a.z1 + g, y0: a.y0 - g, y1: a.y1 + g}, b, 0);
}

const norm = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** `a` says nothing `b` does not (same words, b more specific): 'DECONTAMINATION' vs 'DECONTAMINATION · SHELTER 7'. */
const saidBy = (a: string, b: string) => { const A = norm(a), B = norm(b); return !!A && (B === A || B.startsWith(`${A} `) || B.includes(` ${A} `) || B.endsWith(` ${A}`)); };

/** Every solid a plate must not meet on `level` near (cx, cz) (props, decor, the waste record, fixtures, the blast door's frame). */
export function plateObstacles(layout: StationLayout, level: number, near: (x: number, z: number, r: number) => boolean): Box3[] {
  const out: Box3[] = [];
  const lv = layout.levels[level], top = lv ? lv.baseY + 12 : Infinity, bot = lv ? lv.baseY - 2 : -Infinity;
  const frames = new Map<number, Box3>();
  for (const p of layout.props) {
    if ((p.level ?? 0) !== level || !near(p.x, p.z, Math.hypot(p.hx, p.hz))) continue;
    out.push({x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h});
    // the blast door's frame body spans between its feet over the lane (the feet are its collision; the body is not): one box
    // round the feet of each face (variant 1), as tall as they are
    if (p.kind === 'blastDoor' && p.variant === 1) {
      const f = frames.get(p.area);
      const b = {x0: p.x - p.hx, x1: p.x + p.hx, z0: p.z - p.hz, z1: p.z + p.hz, y0: p.y, y1: p.y + p.h};
      frames.set(p.area, f ? {x0: Math.min(f.x0, b.x0), x1: Math.max(f.x1, b.x1), z0: Math.min(f.z0, b.z0), z1: Math.max(f.z1, b.z1), y0: Math.min(f.y0, b.y0), y1: Math.max(f.y1, b.y1)} : b);
    }
  }
  out.push(...frames.values());
  for (const b of layout.decor) {
    if (b.y1 < bot || b.y0 > top || !near((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2)) continue;
    out.push({x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), z0: Math.min(b.z0, b.z1), z1: Math.max(b.z0, b.z1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1)});
  }
  for (const l of layout.lights) {
    if (l.virtual || (l.level ?? 0) !== level || !near(l.x, l.z, 1)) continue;
    // a hung fixture (1.2 x 0.18 m, 0.22 m deep under its point) or a caged lamp; a mounted lamp's bracket too
    const c = Math.abs(Math.cos(l.rot)), s = Math.abs(Math.sin(l.rot)), hx = Math.max(0.2, c * 0.62 + s * 0.12), hz = Math.max(0.2, s * 0.62 + c * 0.12);
    out.push({x0: l.x - hx, x1: l.x + hx, z0: l.z - hz, z1: l.z + hz, y0: l.y - 0.42, y1: l.y + 0.1});
    if (l.mount) out.push({x0: l.mount.x - 0.25, x1: l.mount.x + 0.25, z0: l.mount.z - 0.25, z1: l.mount.z + 0.25, y0: l.mount.y - 0.25, y1: l.mount.y + 0.3});
  }
  const W = layout.reactorWaste;
  if (W && W.level === level) {
    for (const b of W.boxes) if (near((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2)) out.push({x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), z0: Math.min(b.z0, b.z1), z1: Math.max(b.z0, b.z1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1)});
    for (const c of W.cyls) {
      if (!near(c.x, c.z, c.h + c.r)) continue;
      if (c.ax === 'x') out.push({x0: c.x - c.h / 2, x1: c.x + c.h / 2, z0: c.z - c.r, z1: c.z + c.r, y0: c.y - c.r, y1: c.y + c.r});
      else if (c.ax === 'z') out.push({x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.h / 2, z1: c.z + c.h / 2, y0: c.y - c.r, y1: c.y + c.r});
      else out.push({x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r, y0: c.y, y1: c.y + c.h});
    }
    for (const m of W.models) {
      if (!near(m.x, m.z, Math.hypot(m.w, m.d))) continue;
      const c = Math.abs(Math.cos(m.yaw)), s = Math.abs(Math.sin(m.yaw)), hx = c * m.w / 2 + s * m.d / 2, hz = s * m.w / 2 + c * m.d / 2;
      out.push({x0: m.x - hx, x1: m.x + hx, z0: m.z - hz, z1: m.z + hz, y0: m.y, y1: m.y + m.h});
    }
    for (const f of W.fans) if (near(f.x, f.z, f.r + 1)) out.push({x0: f.x - f.r - 0.4, x1: f.x + f.r + 0.4, z0: f.z - f.r - 0.4, z1: f.z + f.r + 0.4, y0: f.y - f.r - 0.1, y1: f.y + f.r + 0.1});
    // the zone-2 generator's sign wall (lane GAS's status / jam board spot): kept free of plates
    const gs = W.genSign;
    if (gs && near(gs.x, gs.z, gs.w)) {
      const side = plateSide(gs.rot), alongX = side === 'N' || side === 'S';
      out.push(alongX ? {x0: gs.x - gs.w / 2, x1: gs.x + gs.w / 2, z0: gs.z - 0.12, z1: gs.z + 0.12, y0: gs.y - 0.6, y1: gs.y + 0.6}
        : {x0: gs.x - 0.12, x1: gs.x + 0.12, z0: gs.z - gs.w / 2, z1: gs.z + gs.w / 2, y0: gs.y - 0.6, y1: gs.y + 0.6});
    }
  }
  return out;
}

export interface PlateComplex {
  /** The storey (layout.levels index), its areas and the deck area in front of its entrance. */
  level: number;
  areas: readonly number[];
  frontArea?: number;
}

/**
 * The clearance pass over the complexes' plates (see the header). `stockTexts` = the texts of layout.signs before the complexes' own
 * dress hooks ran: plates from there on are the complexes' own, the ones before it the shared station dresser's stock plates (a stock
 * plate whose text a complex changed — the bunker re-letters them — counts as named by the complex).
 */
export function clearComplexPlates(layout: StationLayout, complexes: readonly PlateComplex[], stockTexts: readonly string[]): void {
  const ownFrom = stockTexts.length;
  const st = PLATE_CLEAR_STATS;
  st.plates = 0; st.moved = 0; st.redundant = 0; st.dropped = 0; st.log = [];
  const drop = new Set<SignPlacement>();
  for (const cx of complexes) {
    const g = layout.levels[cx.level]?.grid;
    if (!g) continue;
    const mine = new Set(cx.areas);
    const handled = (s: SignPlacement, i: number) => (s.level ?? 0) === cx.level && !s.hang && (mine.has(s.area) || (s.area === cx.frontArea && i >= ownFrom));
    const order: {s: SignPlacement; own: boolean; stock: boolean}[] = [];
    layout.signs.forEach((s, i) => { if (handled(s, i)) order.push({s, own: i >= ownFrom, stock: i < ownFrom && s.text === stockTexts[i]}); });
    if (!order.length) continue;
    st.plates += order.length;
    // the window of interest: the complex's plates + 8 m
    let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
    for (const {s} of order) { wx0 = Math.min(wx0, s.x); wz0 = Math.min(wz0, s.z); wx1 = Math.max(wx1, s.x); wz1 = Math.max(wz1, s.z); }
    const near = (x: number, z: number, r: number) => x + r > wx0 - 8 && x - r < wx1 + 8 && z + r > wz0 - 8 && z - r < wz1 + 8;
    const solids = plateObstacles(layout, cx.level, near);
    // kept plates: every other plate of the storey in the window first (they stay put), then the complex's in priority order
    const kept: {s: SignPlacement; b: Box3; own: boolean; mine: boolean}[] = [];
    layout.signs.forEach((s, i) => { if ((s.level ?? 0) === cx.level && !handled(s, i) && !drop.has(s) && near(s.x, s.z, 3)) kept.push({s, b: plateBox(s), own: false, mine: false}); });
    const queue = [...order.filter(q => q.own), ...order.filter(q => !q.own)];
    const blockedBy = (b: Box3, self: SignPlacement): {plate?: typeof kept[number]; solid: boolean} => {
      for (const k of kept) if (k.s !== self && platesClash(b, k.b)) return {plate: k, solid: false};
      for (const o of solids) if (meets(b, o)) return {solid: true};
      return {solid: false};
    };
    for (const q of queue) {
      const s = q.s, b = plateBox(s);
      const hit = blockedBy(b, s);
      if (!hit.plate && !hit.solid) { kept.push({s, b, own: q.own, mine: true}); continue; }
      // redundant: an untouched stock door plate on one of the complex's own plates, or a plate meaning what a kept plate of the
      // complex (the one it clashes with, or one in the same room) already says — the more specific wording stays, on the kept plate
      const related = (k: typeof kept[number]) => k.mine && (saidBy(s.text, k.s.text) || saidBy(k.s.text, s.text));
      const twin = hit.plate && related(hit.plate) ? hit.plate : kept.find(k => k.s.area === s.area && related(k));
      if ((hit.plate && q.stock && hit.plate.own && !/AUTHORI[SZ]ED PERSONNEL/.test(s.text)) || twin) {
        if (twin && saidBy(twin.s.text, s.text) && twin.s.text !== s.text) { st.log.push(`re-lettered "${twin.s.text}" -> "${s.text}"`); twin.s.text = s.text; }
        drop.add(s); st.redundant++; st.log.push(`redundant "${s.text}" (on "${(twin ?? hit.plate)!.s.text}")`); continue;
      }
      const spot = relocate(layout, g, s, q.own ? PLATE_CLEAR.ownReach : Infinity, bb => { const h = blockedBy(bb, s); return !h.plate && !h.solid; });
      if (!spot) { drop.add(s); st.dropped++; st.log.push(`dropped "${s.text}" (${hit.plate ? `on "${hit.plate.s.text}"` : 'in a solid'})`); continue; }
      st.log.push(`moved "${s.text}" ${Math.hypot(spot.x - s.x, spot.z - s.z).toFixed(2)} m, ${(spot.y - s.y).toFixed(2)} m up${spot.rot !== s.rot ? ', round the corner' : ''}`);
      s.x = spot.x; s.z = spot.z; s.y = spot.y; s.rot = spot.rot;
      if (spot.w !== undefined) { st.log.push(`  narrowed to ${spot.w} m`); s.w = spot.w; }
      kept.push({s, b: plateBox(s), own: q.own, mine: true});
      st.moved++;
    }
  }
  if (drop.size) layout.signs = layout.signs.filter(s => !drop.has(s));
}

const SIDE_ROT: Readonly<Record<Side, number>> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
const alongX = (sd: Side) => sd === 'N' || sd === 'S';

/**
 * The cheapest clear spot of plate `s`, or null: along its own wall (cost |shift| + 1.5 |height change|), else on a return wall of its
 * room round the nearer corner (cost: the way round the corner + 0.5). Wall-backed, PLATE_CLEAR.minAbove over the floor in front of it,
 * under the ceiling, within `reach` of where it was.
 */
function relocateAt(layout: StationLayout, g: NonNullable<StationLayout['levels'][number]>['grid'], s: SignPlacement, reach: number, clear: (b: Box3) => boolean): {x: number; y: number; z: number; rot: number} | null {
  const a = layout.areas[s.area];
  if (!a) return null;
  const side0 = plateSide(s.rot);
  const {w, h} = signDims(s);
  const X0 = a.x * CELL, Z0 = a.y * CELL, X1 = (a.x + a.w) * CELL, Z1 = (a.y + a.h) * CELL;
  /** A plate centred at t on wall sd: its position (the wall face + 2 cm) and the floor of the cell just inside the wall. */
  const at = (sd: Side, t: number) => {
    const pos = sd === 'N' ? {x: t, z: Z0 + 0.02} : sd === 'S' ? {x: t, z: Z1 - 0.02} : sd === 'W' ? {x: X0 + 0.02, z: t} : {x: X1 - 0.02, z: t};
    const fx = alongX(sd) ? Math.floor(t / CELL) : sd === 'W' ? a.x : a.x + a.w - 1, fy = alongX(sd) ? (sd === 'N' ? a.y : a.y + a.h - 1) : Math.floor(t / CELL);
    return {pos, floor: g.inBounds(fx, fy) ? g.floorOf(g.idx(fx, fy)) : (a.floorY ?? 0)};
  };
  const t0 = alongX(side0) ? s.x : s.z;
  const cands: {sd: Side; t: number; dy: number; c: number}[] = [];
  /** Positions every PLATE_CLEAR.step within [lo, hi] counted from `from`, each with every height change. */
  const run = (sd: Side, lo: number, hi: number, from: number, cost: (t: number) => number) => {
    for (let k = -Math.ceil((from - lo) / PLATE_CLEAR.step); from + k * PLATE_CLEAR.step <= hi + 1e-6; k++) {
      const t = from + k * PLATE_CLEAR.step;
      if (t < lo - 1e-6) continue;
      for (const dy of PLATE_CLEAR.heights) cands.push({sd, t, dy, c: cost(t) + 1.5 * Math.abs(dy)});
    }
  };
  // its own wall
  {
    const lo = (alongX(side0) ? X0 : Z0) + w / 2 + 0.05, hi = (alongX(side0) ? X1 : Z1) - w / 2 - 0.05;
    run(side0, Math.max(lo, t0 - reach), Math.min(hi, t0 + reach), t0, t => Math.abs(t - t0));
  }
  // the return walls: the corner's position along this wall, the run along the return wall away from this wall's line
  for (const sd of (alongX(side0) ? ['W', 'E'] : ['N', 'S']) as Side[]) {
    const toCorner = Math.abs(t0 - (sd === 'W' ? X0 : sd === 'E' ? X1 : sd === 'N' ? Z0 : Z1));
    if (toCorner > reach) continue;
    const base = side0 === 'N' ? Z0 : side0 === 'S' ? Z1 : side0 === 'W' ? X0 : X1, dir = side0 === 'N' || side0 === 'W' ? 1 : -1;
    const lo = (alongX(sd) ? X0 : Z0) + w / 2 + 0.05, hi = (alongX(sd) ? X1 : Z1) - w / 2 - 0.05;
    const near = base + dir * (w / 2 + 0.15), far = base + dir * (reach - toCorner);
    run(sd, Math.max(lo, Math.min(near, far)), Math.min(hi, Math.max(near, far)), near, t => toCorner + Math.abs(t - base) + 0.5);
  }
  cands.sort((p, q) => p.c - q.c || p.t - q.t || p.dy - q.dy);
  for (const {sd, t: tr, dy} of cands) {
    const t = Math.round(tr * 1000) / 1000, y = Math.round((s.y + dy) * 1000) / 1000;
    if (sd === side0 && Math.abs(t - t0) < 1e-6 && !dy) continue;
    const {pos, floor} = at(sd, t);
    if (y - h / 2 < floor + PLATE_CLEAR.minAbove || y + h / 2 > a.ceil - PLATE_CLEAR.ceilGap) continue;
    if (!wallBacked(g, a, sd, t - w / 2, t + w / 2, y - h / 2)) continue;
    const rot = sd === side0 ? s.rot : SIDE_ROT[sd];
    if (!clear(plateBox({...s, ...pos, y, rot}))) continue;
    return {...pos, y, rot};
  }
  return null;
}

/** relocateAt at the plate's width, else narrower (x 0.8, x 0.65, never under 1 m: the station dresser's rule for tight walls). */
function relocate(layout: StationLayout, g: NonNullable<StationLayout['levels'][number]>['grid'], s: SignPlacement, reach: number, clear: (b: Box3) => boolean): {x: number; y: number; z: number; rot: number; w?: number} | null {
  const w0 = signDims(s).w;
  for (const f of [1, 0.8, 0.65]) {
    const w = Math.round(Math.max(1, w0 * f) * 100) / 100;
    if (f < 1 && w >= w0 - 1e-6) break;
    const spot = relocateAt(layout, g, f === 1 ? s : {...s, w}, reach, clear);
    if (spot) return f === 1 ? spot : {...spot, w};
  }
  return null;
}
