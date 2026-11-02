// Task reactor-expansion-20261101 (lane HOST): THE SIDE-COMPLEX HOST of the Reactor generator — the slots beside the pit, the carver
// calls, the zone generator's move into its complex, its cable out through the entrance, the dress hook, layout.reactor.complexes and
// the complex validation. Contract: ./types.ts (ComplexSlot / ComplexCarveInput / ComplexCarve / ComplexCarver). Pure data.
//
// SLOTS (canvas cells; planned in carveReactor after the station / runs / decks, BEFORE the rooms — rooms of the slot's storey avoid
// its region; gen/reactor/carve.ts):
//  - zone 0 (bunker) on tier 1, zone 1 (mines) on tier 2, zone 2 (waste) on tier 4 (COMPLEX_LEVEL — the no-deadlock rule: zone k's
//    generator stands in air clean / cleared before zone k);
//  - ONE pit wall per complex: a seeded permutation of the stair / organ / south walls (never the north wall: the rim station),
//    each complex falling back to an unused wall when its slot does not fit on its own;
//  - REGION = COMPLEX_SLOT.along x COMPLEX_SLOT.deep cells (80 x 64: 40 x 32 m) behind that wall. Its pit-side row IS the pit wall
//    (the entrance span lies in it); a carver keeps one cell of wall inside every edge. When planned the region is solid rock on EVERY
//    storey (never under / over the rim station, the pit or another complex); rooms of OTHER storeys may later sit above / below it
//    in the same columns — `ceilMax` (the deck of the storey above minus a SLAB) keeps the union-of-bands world valid;
//  - ENTRANCE = COMPLEX_SLOT.door cells (3 m) of that wall row in front of flat deck cells of ONE deck area (`frontArea`) of the storey,
//    its corner cells deck too, clear of the organ terraces' maintenance ladders — a landing first (on the stair wall: the generator
//    landing, which becomes the complex's apron), else a gallery / terrace; the region is centred on it where the canvas allows.
// The canvas grows by COMPLEX_MARGIN cells beyond the stair / organ / south walls (gen/reactor/carve.ts reactorCanvas); the crop
// origin stays (0, 0): canvas cells ARE grid cells (the dress hook's crop is {ox: 0, oy: 0}).
//
// HOST HOOKS (gen/reactor/index.ts, in this order): carveComplexes (after carveReactor, before Track2 / the crop: every carver once,
// zone order, on rng.fork(`complex-carve-<id>`); a hosted zone's landing generator is dropped) → hostGenerators (after the crop: the
// complex generator = an anchored 'annexMachine' collision prop on its foot, use point / entrance holds + spawn keep points) → the ONE
// station dresser (dresses complex rooms by type / purpose like any room) → dressComplexes (each carve's dress(layout,
// rng.fork(`complex-<id>`), {ox: 0, oy: 0}) with the pit decks / stair mouths / stand points / entrances held clear) → populations
// (the storey's context runs cover the complex) → applyLighting → complexLights (the generator room lit, steady) → deck lamps out of
// the entrance → finishComplexes (the cable through the entrance to the zone's fans, layout.reactor.complexes).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../../grid';
import {SLAB, levelDistance} from '../../levelGen';
import type {Kit} from '../../stationKit';
import type {LightPlacement, Rect, StationLayout} from '../../stationTypes';
import type {ReactorComplexInfo, ReactorGenerator} from '../reactorTypes';
import {GENSET, ORG, TIERS} from '../frame';
import type {DeckRec, ReactorCarve, WallId} from '../carve';
import {buildGenerators, cableOf, machineProp, rectWorld} from '../structure';
import {carveBunker} from './bunker';
import {carveMines} from './mines';
import {carveWaste} from './waste';
import {COMPLEX_OF_ZONE, type ComplexCarve, type ComplexCarver, type ComplexSlot, type ReactorComplexId} from './types';

/** Slot sizes (cells): region along the wall x deep behind it (incl. the pit-wall row), entrance width, entrance margin to the region's along edges. */
export const COMPLEX_SLOT = {along: 80, deep: 64, door: 6, side: 3} as const;
/** Rock (cells) the canvas keeps beyond the stair / organ / south pit walls for the complexes: the region's depth + one rock cell. */
export const COMPLEX_MARGIN = COMPLEX_SLOT.deep + 1;
/** Storey (layout.levels index) of each zone's complex: the zone generator's storey. */
export const COMPLEX_LEVEL: Readonly<Record<number, number>> = {0: 1, 1: 2, 2: TIERS};
/** The shipped carvers (the lanes' complex/*.ts; a stub returns null and the zone keeps its landing generator). */
export const COMPLEX_CARVERS: Readonly<Record<ReactorComplexId, ComplexCarver>> = {bunker: carveBunker, mines: carveMines, waste: carveWaste};
/** Carver overrides (tests / QA): a missing key = the shipped carver, null = no complex. */
export type ComplexCarvers = Partial<Record<ReactorComplexId, ComplexCarver | null>>;

/** QA / tests: the last generation's slot planning + carving (per attempt; walls tried, carve ms, what was hosted). */
export const COMPLEX_HOST_STATS = {slots: [] as string[], carved: [] as string[], ms: {} as Record<string, number>, misses: {} as Record<string, number>};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
type SlotWall = 'stair' | 'organ' | 'S';
const DIRS = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]} as const;

// ---------------------------------------------------------------------------------------------
// Slots

/** What the slot planner reads of the carve in progress (gen/reactor/carve.ts, canonical frame helpers included). */
export interface SlotPlanInput {
  k: Kit;
  rng: Rng;
  bases: readonly number[];
  PX0: number; PZ0: number; PW: number; PD: number;
  coreW: number; coreH: number;
  decks: readonly DeckRec[];
  /** Organ terrace length per storey (the maintenance ladders climb their north edges). */
  terraces: readonly number[];
  cx: (px: number) => number;
  rectC: (px: number, pz: number, w: number, h: number) => Rect;
}

/** Canonical (px, pz) of wall-local (a: along the wall, d: cells behind it — d = -1 the wall row, d = -2 the pit's first row). */
function canon(p: SlotPlanInput, w: SlotWall, a: number, d: number): [number, number] {
  return w === 'stair' ? [-2 - d, a] : w === 'organ' ? [p.PW + 1 + d, a] : [a, p.PD + 1 + d];
}
function wallRect(p: SlotPlanInput, w: SlotWall, a0: number, wa: number, d0: number, dd: number): Rect {
  const [pa, pb] = canon(p, w, a0, d0), [qa, qb] = canon(p, w, a0 + wa - 1, d0 + dd - 1);
  return p.rectC(Math.min(pa, qa), Math.min(pb, qb), Math.abs(pa - qa) + 1, Math.abs(pb - qb) + 1);
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The complexes' slots (one per zone that fits; canvas cells). Called by carveReactor once the station, runs and decks are carved and
 * before the rooms. Draws only from `p.rng` (a fork: the carve stream is untouched).
 */
export function planComplexSlots(p: SlotPlanInput): ComplexSlot[] {
  const {k, rng, coreW, coreH} = p;
  const KW = k.g.w, grids = k.levelGrids;
  // "open on any storey" prefix sums over the core canvas (a region must be untouched rock on every storey when planned)
  const PWd = coreW + 1, P = new Int32Array(PWd * (coreH + 1));
  for (let y = 0; y < coreH; y++) {
    let run = 0;
    for (let x = 0; x < coreW; x++) {
      const i = y * KW + x;
      let open = 0;
      for (let L = 0; L < grids.length && !open; L++) if (grids[L].cells[i] !== SOLID) open = 1;
      run += open;
      P[(y + 1) * PWd + x + 1] = P[y * PWd + x + 1] + run;
    }
  }
  const openIn = (r: Rect) => P[(r.y + r.h) * PWd + r.x + r.w] - P[r.y * PWd + r.x + r.w] - P[(r.y + r.h) * PWd + r.x] + P[r.y * PWd + r.x];
  const slots: (ComplexSlot & {wall: SlotWall})[] = [];
  const regionOk = (r: Rect) => r.x >= ORG && r.y >= ORG && r.x + r.w <= coreW - ORG && r.y + r.h <= coreH - ORG && openIn(r) === 0 && !slots.some(s => overlaps(s.region, r));
  const deckOf = new Map(p.decks.map(d => [d.area, d]));
  const KIND_RANK: Record<string, number> = {landing: 0, 'stair-landing': 1, gallery: 2};
  const mirror = p.cx(1) < p.cx(0);
  const inwardOf = (w: SlotWall): ComplexSlot['inward'] => (w === 'S' ? 'S' : (w === 'stair') !== mirror ? 'W' : 'E');
  const {along: A, deep: D, door: EW, side} = COMPLEX_SLOT;

  const tryWall = (zone: number, lv: number, w: SlotWall): (ComplexSlot & {wall: SlotWall}) | null => {
    const g = grids[lv], base = p.bases[lv], L = w === 'S' ? p.PW : p.PD;
    // maintenance ladders on the organ terraces of this storey (the one from the storey above lands here, the one below leaves here)
    const ladders: [number, number][] = [];
    for (const l of [lv - 1, lv]) if (l >= 0 && l < p.terraces.length) ladders.push([p.PW - 4, p.PD - p.terraces[l]]);
    const cands: {a: number; front: number; rank: number; off: number; tie: number}[] = [];
    for (let a = 1; a + EW <= L - 1; a++) {
      let ok = true, front = -1;
      for (let t = -1; t <= EW && ok; t++) {
        const [px, pz] = canon(p, w, a + t, -2);
        const x = p.cx(px), y = p.PZ0 + pz, i = y * KW + x;
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) { ok = false; break; }
        if (t >= 0 && t < EW) {
          const ar = g.area[i];
          if (Math.abs(g.floor[i] - base) > 0.01 || !deckOf.has(ar) || (front >= 0 && ar !== front)) { ok = false; break; }
          front = ar;
        }
        // never on a maintenance ladder's column / its stand cells (the ladder runs 3 cells off the organ wall)
        for (const [lx, lz] of ladders) if (Math.max(Math.abs(px - lx), Math.abs(pz - lz)) < 3) ok = false;
      }
      if (!ok || front < 0) continue;
      const d = deckOf.get(front)!, [mpx, mpz] = canon(p, w, a + EW / 2, -2);
      const off = w === 'S' ? Math.abs(p.cx(mpx) - (d.rect.x + d.rect.w / 2)) : Math.abs(p.PZ0 + mpz - (d.rect.y + d.rect.h / 2));
      cands.push({a, front, rank: KIND_RANK[d.kind] ?? 3, off, tie: rng.next()});
    }
    cands.sort((q, r) => q.rank - r.rank || q.off - r.off || q.tie - r.tie);
    for (const c of cands) {
      // region along span [a0, a0 + A) holding the entrance `side` cells in from its ends; the south wall's stays within the pit's
      // along range (the stair / organ regions may run past the pit's south corners: the regions never meet)
      let lo = c.a + EW + side - A, hi = c.a - side;
      if (w === 'S') { lo = Math.max(lo, 0); hi = Math.min(hi, p.PW - A); }
      if (hi < lo) continue;
      const mid = Math.round(c.a + EW / 2 - A / 2);
      const order: number[] = [];
      for (let a0 = lo; a0 <= hi; a0++) order.push(a0);
      order.sort((q, r) => Math.abs(q - mid) - Math.abs(r - mid) || q - r);
      for (const a0 of order) {
        const region = wallRect(p, w, a0, A, -1, D);
        if (!regionOk(region)) continue;
        return {
          id: COMPLEX_OF_ZONE[zone], zone, level: lv, baseY: base, region, entrance: wallRect(p, w, c.a, EW, -1, 1), frontArea: c.front,
          inward: inwardOf(w), ceilMax: Math.floor((p.bases[lv - 1] - SLAB) * 100) / 100, wall: w,
        };
      }
    }
    return null;
  };

  const walls = rng.shuffle<SlotWall>(['stair', 'organ', 'S']);
  for (let zone = 0; zone < 3; zone++) {
    // its own wall of the permutation, then the still-unused walls, then (a region may run past a pit corner) the used ones
    const lv = COMPLEX_LEVEL[zone], used = new Set(slots.map(s => s.wall));
    const order = [...walls.slice(zone), ...walls.slice(0, zone)].sort((p, q) => +used.has(p) - +used.has(q));
    let s: (ComplexSlot & {wall: SlotWall}) | null = null;
    for (const w of order) if ((s = tryWall(zone, lv, w))) break;
    if (s) slots.push(s);
    else COMPLEX_HOST_STATS.misses[`slot-${COMPLEX_OF_ZONE[zone]}`] = (COMPLEX_HOST_STATS.misses[`slot-${COMPLEX_OF_ZONE[zone]}`] ?? 0) + 1;
  }
  COMPLEX_HOST_STATS.slots = slots.map(s => `${s.id}@${s.wall}/T${s.level}`);
  return slots.map(({wall: _w, ...s}) => s);
}

/** carveReactor's room placement hook: a room rect of storey `lv` may not intersect a complex region of that storey. */
export function slotBlocks(slots: readonly ComplexSlot[], r: Rect, lv: number): boolean {
  return slots.some(s => s.level === lv && overlaps(s.region, r));
}

/** The pit wall a slot opens through (from its inward direction and the variant's mirror). */
export function slotWall(rc: ReactorCarve, s: ComplexSlot): WallId {
  if (s.inward === 'S' || s.inward === 'N') return s.inward;
  const westIsStair = rc.cx(0) < rc.cx(1);
  return (s.inward === 'W') === westIsStair ? 'stair' : 'organ';
}

// ---------------------------------------------------------------------------------------------
// Carving

/**
 * Calls every slot's carver once (zone order) on the shared Kit, BEFORE Track2 and the crop. A hosted zone's landing generator is
 * removed from rc.gens (the complex houses it). Returns the carves (null = that zone keeps its landing generator).
 */
export function carveComplexes(k: Kit, rng: Rng, rc: ReactorCarve, carvers: ComplexCarvers = {}): ComplexCarve[] {
  const out: ComplexCarve[] = [];
  COMPLEX_HOST_STATS.carved = [];
  for (const slot of rc.slots) {
    const fn = slot.id in carvers ? carvers[slot.id] : COMPLEX_CARVERS[slot.id];
    if (!fn) continue;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const res = fn({k, rng: rng.fork(`complex-carve-${slot.id}`), slot, levelOpt: slot.level ? {level: slot.level, floorY: slot.baseY} : {}});
    COMPLEX_HOST_STATS.ms[slot.id] = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    if (!res) { COMPLEX_HOST_STATS.misses[`carve-${slot.id}`] = (COMPLEX_HOST_STATS.misses[`carve-${slot.id}`] ?? 0) + 1; continue; }
    // the host's slot / id are authoritative (the carve object is kept as returned: its dress hook may be a method)
    res.slot = slot;
    res.id = slot.id;
    out.push(res);
    COMPLEX_HOST_STATS.carved.push(slot.id);
  }
  if (out.length) rc.gens = rc.gens.filter(g => !out.some(c => c.slot.zone === g.zone));
  return out;
}

/**
 * After carving (complexes included), before Track2 and the crop: the core crop's east / south extent shrinks to what was carved
 * (+ ORG rock + 1) — unused complex rock (a null carver, a shallow program) stays out of every storey grid. The origin stays (0, 0).
 */
export function trimCoreCrop(k: Kit, rc: ReactorCarve): void {
  let w = 0, h = 0;
  for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h);
  }
  rc.coreW = Math.min(rc.coreW, w + ORG + 1);
  rc.coreH = Math.min(rc.coreH, h + ORG + 1);
}

// ---------------------------------------------------------------------------------------------
// Generators (after the crop: canvas cells = grid cells)

/** Middle cell of the entrance span, the cell inside it (complex side) and in front of it (deck side). */
function entranceCells(s: ComplexSlot): {mid: [number, number]; inner: [number, number]; outer: [number, number]} {
  const E = s.entrance, [dx, dy] = DIRS[s.inward];
  const mid: [number, number] = [E.x + (E.w > 1 ? Math.floor(E.w / 2) : 0), E.y + (E.h > 1 ? Math.floor(E.h / 2) : 0)];
  return {mid, inner: [mid[0] + dx, mid[1] + dy], outer: [mid[0] - dx, mid[1] - dy]};
}

/** FLOOR cells of a (2r+1)^2 block round a cell. */
function block(g: Grid, x: number, y: number, rx: number, ry = rx): number[] {
  const out: number[] = [];
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) if (g.inBounds(x + dx, y + dy) && g.cells[g.idx(x + dx, y + dy)] === FLOOR) out.push(g.idx(x + dx, y + dy));
  return out;
}

export interface HostedGenerators {
  gens: ReactorGenerator[];
  holds: {level: number; cells: number[]}[];
  keep: {level: number; x: number; z: number}[];
}

/**
 * Every zone generator: the landing ones (structure.ts buildGenerators over rc.gens) + the complex ones — an anchored 'annexMachine'
 * collision prop on the carver's foot, size from the foot (long / short side − 0.4 m, GENSET height), its use point (the carver's
 * cell centre), the panel on the foot edge nearest the use point (1.2 m up). Ids = zone order. Holds (5 x 5 round the use point, the
 * entrance's both sides) and spawn keep points (use point, entrance both sides).
 */
export function hostGenerators(layout: StationLayout, rc: ReactorCarve, carves: readonly ComplexCarve[]): HostedGenerators {
  const base = buildGenerators(layout, rc);
  const gens = base.gens.slice(), holds = base.holds.slice(), keep = base.keep.slice();
  for (const c of carves) {
    const s = c.slot, lv = s.level, y = rc.bases[lv], g = layout.levels[lv].grid, f = c.generator.foot;
    const x0 = f.x * CELL, z0 = f.y * CELL, x1 = (f.x + f.w) * CELL, z1 = (f.y + f.h) * CELL, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    machineProp(layout, lv, c.generator.area, x, z, f.w * CELL / 2 - 0.1, f.h * CELL / 2 - 0.1, GENSET.h, 1);
    const uc = [Math.floor(c.generator.use.x), Math.floor(c.generator.use.y)] as const;
    const ux = (uc[0] + 0.5) * CELL, uz = (uc[1] + 0.5) * CELL;
    const long = Math.max(f.w, f.h) * CELL, short = Math.min(f.w, f.h) * CELL;
    gens.push({
      id: -1, zone: s.zone, level: lv, area: c.generator.area, x: r3(x), z: r3(z), y, yaw: r3(c.generator.yaw),
      size: {w: r3(Math.max(0.6, long - 0.4)), d: r3(Math.max(0.4, short - 0.4)), h: GENSET.h},
      use: {x: r3(ux), z: r3(uz), yaw: r3(c.generator.use.yaw), level: lv},
      panel: {x: r3(Math.min(x1, Math.max(x0, ux))), y: r3(y + 1.2), z: r3(Math.min(z1, Math.max(z0, uz)))}, cable: [],
    });
    holds.push({level: lv, cells: block(g, uc[0], uc[1], 2)});
    keep.push({level: lv, x: ux, z: uz});
    // the entrance: 3 cells either side of the doorway across its span (+1) held clear, keep points on both sides
    holds.push({level: lv, cells: apron(s).filter(i => g.cells[i] === FLOOR)});
    const {inner, outer} = entranceCells(s);
    keep.push({level: lv, x: (inner[0] + 0.5) * CELL, z: (inner[1] + 0.5) * CELL}, {level: lv, x: (outer[0] + 0.5) * CELL, z: (outer[1] + 0.5) * CELL});
  }
  gens.sort((p, q) => p.zone - q.zone);
  gens.forEach((q, i) => { q.id = i; });
  return {gens, holds, keep};

  function apron(s: ComplexSlot): number[] {
    const g = layout.levels[s.level].grid, E = s.entrance, [dx, dy] = DIRS[s.inward], cells: number[] = [];
    const along = E.w > 1 ? [1, 0] : [0, 1], n = Math.max(E.w, E.h);
    for (let t = -1; t <= n; t++) for (let d = -3; d <= 3; d++) {
      const x = E.x + along[0] * t + dx * d, y = E.y + along[1] * t + dy * d;
      if (g.inBounds(x, y)) cells.push(g.idx(x, y));
    }
    return cells;
  }
}

// ---------------------------------------------------------------------------------------------
// Dressing, lights

/** Each carve's dress hook (after the station dresser, before the populations) with `holds` (decks, mouths, stand points, entrances) held clear. */
export function dressComplexes(layout: StationLayout, rng: Rng, carves: readonly ComplexCarve[], holds: readonly {level: number; cells: readonly number[]}[]): void {
  if (!carves.some(c => c.dress)) return;
  const held: [Uint8Array, number][] = [];
  for (const z of holds) {
    const g = layout.levels[z.level].grid;
    for (const i of z.cells) if (!g.blocked[i]) { g.blocked[i] = 1; held.push([g.blocked, i]); }
  }
  try {
    for (const c of carves) c.dress?.(layout, rng.fork(`complex-${c.id}`), {ox: 0, oy: 0});
  } finally {
    for (const [b, i] of held) b[i] = 0;
  }
}

/** After applyLighting: a complex generator's room is lit steadily (emergency power, like the restart sites) so the player can work there. */
export function complexLights(layout: StationLayout, carves: readonly ComplexCarve[]): void {
  for (const c of carves) {
    const a = layout.areas[c.generator.area], own = layout.lights.filter(l => l.area === a.id);
    for (const l of own) { l.broken = false; l.flicker = false; l.dying = false; l.power = 0.8; }
    a.lighting = 'lit';
    if (!own.length) {
      const l: LightPlacement = {x: r3((a.x + a.w / 2) * CELL), y: r3(a.ceil - 0.05), z: r3((a.y + a.h / 2) * CELL), rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 0.8, dying: false};
      if (a.level) l.level = a.level;
      layout.lights.push(l);
    }
  }
}

/** After deckLights: a wall lamp of the apron deck hanging inside an entrance doorway moves along the wall past the door jamb (or goes). */
export function clearEntranceLamps(layout: StationLayout, carves: readonly ComplexCarve[]): void {
  const drop = new Set<LightPlacement>();
  for (const c of carves) {
    const s = c.slot, E = s.entrance, g = layout.levels[s.level].grid, alongX = E.w > 1;
    const a0 = (alongX ? E.x : E.y) * CELL - 0.6, a1 = (alongX ? E.x + E.w : E.y + E.h) * CELL + 0.6;
    const wallC = ((alongX ? E.y : E.x) + 0.5) * CELL;
    for (const l of layout.lights) {
      // (lead merge fix: lane GASLIGHT's MOUNTED pit lamps carry a bracket record — never slide one along the wall: drop it instead)
      const mounted = !!(l as {mount?: unknown}).mount;
      if ((l.level ?? 0) !== s.level || (!mounted && l.area !== s.frontArea)) continue;
      const u = alongX ? l.x : l.z, v = alongX ? l.z : l.x;
      if (u <= a0 || u >= a1 || Math.abs(v - wallC) > 1.0) continue;
      if (mounted) { drop.add(l); continue; }
      // the nearer jamb side, 0.75 m past the doorway, on the same deck
      const to = u - a0 < a1 - u ? a0 - 0.15 : a1 + 0.15;
      const nx = alongX ? to : l.x, nz = alongX ? l.z : to, [cx, cy] = g.cellOf(nx, nz);
      if (g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR && g.area[g.idx(cx, cy)] === s.frontArea) { l.x = r3(nx); l.z = r3(nz); } else drop.add(l);
    }
  }
  if (drop.size) layout.lights = layout.lights.filter(l => !drop.has(l));
  // (lead merge fix) keep lane GASLIGHT's pit-lamp stats true to the lamps left (gen/reactor/gaslightLamps.ts pitLampStats)
  const st = (layout as unknown as {pitLamps?: {wall: number; post: number; steady: number; dying: number}}).pitLamps;
  if (st) for (const l of drop) {
    const m = l.mount;
    if (!m) continue;
    if (m.kind === 'wall') st.wall--; else st.post--;
    if (l.dying) st.dying--; else st.steady--;
  }
}

// ---------------------------------------------------------------------------------------------
// The record: cables, layout.reactor.complexes

/**
 * A complex generator's cable: up from the panel to the cable height (2.6 m or under the lowest ceiling / door head on the way), along
 * the shortest walk through the complex (string-pulled across open floor) to the entrance's middle, out through the doorway onto
 * the pit wall, then along the pit walls to the zone's fans (structure.ts cableOf).
 */
function complexCable(layout: StationLayout, rc: ReactorCarve, c: ComplexCarve, gen: ReactorGenerator): {x: number; y: number; z: number}[] {
  const s = c.slot, g = layout.levels[s.level].grid, ids = new Set(c.areas), E = s.entrance;
  const inE = (x: number, y: number) => x >= E.x && y >= E.y && x < E.x + E.w && y < E.y + E.h;
  // task reactor-expansion-20261101 (lane BUNKER): only cells at the storey floor — the one cable height never runs low over a raised
  // threshold (the bunker's blast-door lane, 0.84 m up: the cable goes round through the guard post)
  const ok = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && (ids.has(g.area[g.idx(x, y)]) || inE(x, y)) && g.floor[g.idx(x, y)] <= s.baseY + 0.01;
  const [sx, sy] = g.cellOf(gen.use.x, gen.use.z), {mid} = entranceCells(s);
  // BFS (4-neighbour) from the use cell to the entrance's middle cell
  const prev = new Map<number, number>(), start = g.idx(sx, sy), goal = g.idx(mid[0], mid[1]);
  const q = [start];
  prev.set(start, -1);
  for (let h = 0; h < q.length && !prev.has(goal); h++) {
    const i = q[h], x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * g.w + nx;
      if (!prev.has(j) && ok(nx, ny)) { prev.set(j, i); q.push(j); }
    }
  }
  const pathCells: number[] = [];
  if (prev.has(goal)) for (let i = goal; i >= 0; i = prev.get(i)!) pathCells.push(i);
  else pathCells.push(start, goal);
  pathCells.reverse();
  const yc = Math.min(gen.y + 2.6, Math.min(...pathCells.map(i => g.ceil[i])) - 0.25);
  const ctr = (i: number): [number, number] => [((i % g.w) + 0.5) * CELL, (((i / g.w) | 0) + 0.5) * CELL];
  const clear = (a: number, b: number): boolean => {
    const [ax, az] = ctr(a), [bx, bz] = ctr(b), n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.2));
    for (let t = 1; t < n; t++) { const [cx, cy] = g.cellOf(ax + (bx - ax) * t / n, az + (bz - az) * t / n); if (!ok(cx, cy)) return false; }
    return true;
  };
  // string pulling: from each kept point, the farthest point still in a clear straight line
  const kept = [pathCells[0]];
  for (let i = 0; i < pathCells.length - 1;) {
    let j = i + 1;
    while (j + 1 < pathCells.length && clear(pathCells[i], pathCells[j + 1])) j++;
    kept.push(pathCells[j]);
    i = j;
  }
  const pts: {x: number; y: number; z: number}[] = [{...gen.panel}, {x: gen.panel.x, y: r3(yc), z: gen.panel.z}];
  for (const i of kept) { const [x, z] = ctr(i); pts.push({x: r3(x), y: r3(yc), z: r3(z)}); }
  const [ex, ez] = ctr(goal);
  const rest = cableOf(rc, gen, (layout.reactor?.fans ?? []).filter(f => f.zone === gen.zone), {x: ex, y: r3(yc), z: ez, wall: slotWall(rc, s)});
  return [...pts, ...rest].map(p => ({x: r3(p.x), y: r3(p.y), z: r3(p.z)}));
}

/** After reactorInfo: the complex generators' cables and layout.reactor.complexes (always set: [] = every generator on its landing). */
export function finishComplexes(layout: StationLayout, rc: ReactorCarve, carves: readonly ComplexCarve[]): void {
  const info = layout.reactor;
  if (!info) return;
  const out: ReactorComplexInfo[] = [];
  for (const c of carves) {
    const s = c.slot, gen = info.generators.find(g => g.zone === s.zone);
    if (!gen) continue;
    gen.cable = complexCable(layout, rc, c, gen);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of c.areas) { const a = layout.areas[id]; x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h); }
    const {outer} = entranceCells(s);
    // the apron deck that used to hold the generator is now the complex's entrance landing (HUD label)
    const front = layout.areas[s.frontArea];
    if (front && /^Generator landing/.test(front.label)) front.label = front.label.replace(/^Generator landing/, 'Entrance landing');
    out.push({
      id: s.id, name: c.name, level: s.level, zone: s.zone, generator: gen.id, areas: c.areas.slice(),
      rooms: c.rooms.map(r => ({area: r.area, key: r.key, label: r.label, role: r.role})),
      entrance: {x: r3((outer[0] + 0.5) * CELL), z: r3((outer[1] + 0.5) * CELL), level: s.level},
      bounds: rectWorld({x: x0, y: y0, w: x1 - x0, h: y1 - y0}),
      slot: {region: rectWorld(s.region), entrance: rectWorld(s.entrance), frontArea: s.frontArea, inward: s.inward, ceilMax: s.ceilMax},
    });
  }
  info.complexes = out;
}

// ---------------------------------------------------------------------------------------------
// Validation

/** Minimal "substantial" floor of a complex (the lanes own their programs): areas and walkable floor (m²). */
export const COMPLEX_MIN = {areas: 6, walkM2: 500, doorM: 2.6, doorCells: 4} as const;

/**
 * Complex validation (gen/reactor/validate.ts reactorIssues): record ↔ generator ↔ zone, every complex cell inside its region on its
 * storey, the entrance door (frontArea ↔ entry, >= 4 cells, >= 2.6 m), the entrance and the generator use point reachable from the
 * start by STAIRS only (no ladders), no overlap with the pit / the rim station / other areas / Track2 extensions, the substantial
 * floor (>= 6 areas, >= 500 m² walkable).
 */
export function complexIssues(layout: StationLayout): string[] {
  const info = layout.reactor, list = info?.complexes ?? [];
  if (!info || !list.length) return [];
  const issues: string[] = [];
  const levels = layout.levels, g0 = layout.grid, [sx, sy] = g0.cellOf(info.start.x, info.start.z);
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks.filter(k => k.kind === 'stairs'));
  const seen = new Set<string>();
  const cellsOf = (r: {x0: number; z0: number; x1: number; z1: number}): Rect => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});
  const pit = cellsOf(info.pit.bounds);
  for (const c of list) {
    const tag = `complex ${c.id}`;
    if (seen.has(c.id)) issues.push(`${tag} twice`);
    seen.add(c.id);
    if (COMPLEX_OF_ZONE[c.zone] !== c.id || c.level !== COMPLEX_LEVEL[c.zone]) issues.push(`${tag}: zone ${c.zone} / level ${c.level}`);
    const gen = info.generators[c.generator];
    if (!gen || gen.zone !== c.zone || gen.level !== c.level || !c.areas.includes(gen.area)) issues.push(`${tag}: generator record`);
    if (!c.slot) { issues.push(`${tag}: no slot`); continue; }
    const g = levels[c.level]?.grid;
    if (!g) { issues.push(`${tag}: level missing`); continue; }
    const ids = new Set(c.areas), region = cellsOf(c.slot.region), ent = cellsOf(c.slot.entrance);
    if (c.areas.length < COMPLEX_MIN.areas) issues.push(`${tag}: ${c.areas.length} areas (< ${COMPLEX_MIN.areas})`);
    for (const id of c.areas) { const a = layout.areas[id]; if (!a || (a.level ?? 0) !== c.level) issues.push(`${tag}: area ${id} not on level ${c.level}`); }
    // carved cells (the Kit stamps area rects + door gaps): inside the region, one cell of wall kept inside its edges (the entrance
    // span excepted); walkable floor + stairs-only reach scanned over the region
    const inner: Rect = {x: region.x + 1, y: region.y + 1, w: region.w - 2, h: region.h - 2};
    const within = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
    let outside = 0;
    for (const id of c.areas) { const a = layout.areas[id]; if (a && !within(a, inner)) outside++; }
    for (const d of layout.doors) if ((ids.has(d.a) || ids.has(d.b)) && !within(d, inner) && !within(d, ent)) outside++;
    let walk = 0, reach = false;
    for (let y = Math.max(0, region.y); y < Math.min(g.h, region.y + region.h); y++) for (let x = Math.max(0, region.x); x < Math.min(g.w, region.x + region.w); x++) {
      const i = y * g.w + x;
      if (!ids.has(g.area[i]) || g.cells[i] === SOLID) continue;
      if (g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0) walk++;
      if (dist[c.level][i] >= 0) reach = true;
    }
    if (outside) issues.push(`${tag}: ${outside} areas / doors outside its region`);
    if (walk * CELL * CELL < COMPLEX_MIN.walkM2) issues.push(`${tag}: ${(walk * CELL * CELL).toFixed(0)} m² walkable (< ${COMPLEX_MIN.walkM2})`);
    if (!reach) issues.push(`${tag} unreachable by stairs`);
    // the entrance door: deck <-> the complex, through the slot's entrance span
    const door = layout.doors.find(d => (d.level ?? 0) === c.level && ((d.a === c.slot!.frontArea && ids.has(d.b)) || (d.b === c.slot!.frontArea && ids.has(d.a))));
    if (!door) issues.push(`${tag}: no entrance door from the deck`);
    else {
      if (door.x < ent.x || door.y < ent.y || door.x + door.w > ent.x + ent.w || door.y + door.h > ent.y + ent.h) issues.push(`${tag}: entrance door outside the entrance span`);
      if (Math.max(door.w, door.h) < COMPLEX_MIN.doorCells || door.height < COMPLEX_MIN.doorM - 1e-6) issues.push(`${tag}: entrance ${Math.max(door.w, door.h) * CELL} m wide, ${door.height} m clear`);
    }
    // the generator: its skid (the anchored collision prop) on complex floor, its panel within reach of the use point
    if (gen) {
      const p = layout.props.find(q => q.kind === 'annexMachine' && q.area === gen.area && Math.abs(q.x - gen.x) < 1e-3 && Math.abs(q.z - gen.z) < 1e-3);
      if (!p) issues.push(`${tag}: generator skid prop missing`);
      else {
        let bad = 0;
        for (let cy = Math.floor((p.z - p.hz + 0.01) / CELL); cy <= Math.floor((p.z + p.hz - 0.01) / CELL); cy++) for (let cx = Math.floor((p.x - p.hx + 0.01) / CELL); cx <= Math.floor((p.x + p.hx - 0.01) / CELL); cx++) {
          const i = g.idx(cx, cy);
          if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR || !ids.has(g.area[i]) || g.rampIdx[i] >= 0) bad++;
        }
        if (bad) issues.push(`${tag}: generator skid over ${bad} cells off the complex floor`);
      }
      if (Math.hypot(gen.panel.x - gen.use.x, gen.panel.z - gen.use.z) > 2.0) issues.push(`${tag}: generator panel out of reach of its use point`);
    }
    const at = (x: number, z: number, what: string) => {
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || dist[c.level][g.idx(cx, cy)] < 0) issues.push(`${tag}: ${what} unreachable by stairs`);
    };
    at(c.entrance.x, c.entrance.z, 'entrance');
    if (gen) at(gen.use.x, gen.use.z, 'generator use point');
    // no overlap: the pit, the rim station (level 0, outside the pit), any other area of the storey, Track2 extension areas
    for (const id of c.areas) {
      const a = layout.areas[id];
      if (!a) continue;
      if (overlaps(a, pit)) issues.push(`${tag}: area ${id} over the pit`);
      for (const b of layout.areas) {
        if (ids.has(b.id) || !overlaps(a, b)) continue;
        const lvB = b.level ?? 0;
        if (b.ext) issues.push(`${tag}: area ${id} under Track2 area ${b.id}`);
        else if (lvB === c.level) issues.push(`${tag}: area ${id} overlaps area ${b.id}`);
        else if (lvB === 0 && b.role !== 'reactor-room' && !overlaps(b, pit)) issues.push(`${tag}: area ${id} under the rim station (${b.label})`);
      }
      for (const t of layout.trenches) {
        const tr: Rect = {x: Math.floor(t.x0 / CELL), y: Math.floor(t.z0 / CELL), w: Math.ceil((t.x1 - t.x0) / CELL), h: Math.ceil((t.z1 - t.z0) / CELL)};
        if (overlaps(a, tr)) issues.push(`${tag}: area ${id} under a track bed`);
      }
    }
  }
  return issues;
}

