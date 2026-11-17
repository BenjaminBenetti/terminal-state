// Task studio-survivor-market-crevice-20261116-074419: carving of THE SURVIVOR MARKET version 5 — THE CREVICE (gen/market/v5/frame.ts)
// into ONE Kit of four storeys (canvas = grid cells: the crop origin is fixed at 0, 0). Pure data; the index links, rails, dresses,
// records and validates it.
//
// What each column of the crevice is (absolute heights, CREVICE.bases / cont / topY / chasmY):
//   - the CHASM: a storey-0 VOID column from CREVICE.chasmY up to the crevice's top (a bridge overhead lowers it under its deck): the dark
//     depth below the settlement, railed off along both low walks, never walked;
//   - the LOW WALKS / the SQUARE / the WEIR: storey 0 open from the ground to the top (a bridge or the bar's deck overhead lowers it);
//   - a container BAND B_L: storey L [base, base + cont] (a container: a home, a shop, a service; or CLOSED — solid, a box nobody opens),
//     under it rock, over it the storey-(L+1) WALK (open to the top); a band's STAIR BAY instead holds the run up to storey L+1 against
//     the rock with the bay's foot beside it (storey L) and the storey-(L+1) catwalk over the foot; a POCKET is the storey-L walk widened
//     into the band (covered by the walk above);
//   - BACKROOMS: rock-cut rooms behind a band's container at its own storey (under the next band's container), joined to it by a door —
//     the ground shops are walk-in (the container and its backroom one room: the customer's front, the trader's back);
//   - the PLATFORM HALL: the bed and the platform under the low vault (CREVICE.hallY), the two gates through its south wall into the
//     square under the bar's deck (storey 1).
// So the crevice is open from the chasm to the top everywhere but under the bridges, the bar's deck and the catwalks beside the stairs,
// and every container is a separate box on its own ledge (the stacks step back, storey by storey, into the rock).
// Layout version 6 (task studio-market-irregular-envelope-20261116-210503-01) carves the same settlement and then breaks the box around
// it (gen/market/v6/envelope.ts: the overhead, the top terrace's alcoves, the end clefts, the chasm's bed); version 5 never reaches it.
// Layout version 7 (task studio-market-irregular-settlement-20261117-003819-01) carves the settlement itself on an irregular floorplan
// (gen/market/v7/settlement.ts): every band's columns, every walk's and low walk's width and the pit's edges per row, from the plan's
// sections (each walk / low walk several areas, one per run of rows with the same span); versions 5 / 6 never reach it.

import {CELL, FLOOR, SOLID, VOID, type Grid} from '../../grid';
import {Kit, TUN, type TrenchCells} from '../../stationKit';
import {STAIR, layStairRun, type StairFlight} from '../../traversal';
import {SINGLE_BED_CELLS, TRENCH_DEPTH, type Area, type Rect, type Side} from '../../stationTypes';
import type {Rng} from '../../../core/rng';
import type {MarketShopId} from '../marketTypes';
import {fillRun} from '../v2/carve';
import {stampEnvelope, type AlcovePlan, type CreviceEnvelope, type EnvelopeStamp} from '../v6/envelope';
import {SETTLEMENT, settlementColumns, type CreviceSettlement} from '../v7/settlement';
import {CREVICE, creviceRows, type CreviceFrame} from './frame';

/** Open stairs / the crevice: headroom capped by the cell ceiling (the crevice's top: Ramp.capCeil). */
export const OPEN_HEADROOM = 40;

/** What a container is used for (v2's uses + the bar's annex and the den's entry). */
export type CrevUse = 'shop' | 'kitchen' | 'bunks' | 'workshop' | 'water' | 'latrine' | 'generator' | 'storage' | 'tea' | 'repair' | 'home' | 'laundry' | 'clinic-store' | 'den' | 'bar-store';

/** One container box of the settlement (every container: lived in, a service, a shop, or closed). World cells unless noted. */
export interface CrevContainer {
  id: number;
  /** Its room (area index), or -1 for a CLOSED container (solid: nobody opens it). */
  area: number;
  level: number;
  /** The box incl. its walls (world cells): the front wall (on the walk), the back wall (the rock / the backroom), its two end walls. */
  box: Rect;
  /** Interior (world cells; a walk-in shop's room extends into its backroom). */
  rect: Rect;
  /** World side its front (walk side) faces. */
  face: Side;
  /** Its opening onto the walk (world cells, in the front wall column), and whether it is a wide shopfront / counter front. */
  door: Rect | null;
  wide: boolean;
  use: CrevUse;
  stall?: MarketShopId;
  /** Canonical side and band (= storey). */
  side: 'W' | 'E';
  /** The backroom behind it (area index), if any, and the door between them (world cells; null when merged into the room). */
  back?: number;
  backDoor?: Rect | null;
  /** Its paint (index into the container paints, seeded; world/marketArch.ts). */
  paint: number;
}

/** A stair bay (world): its run's area / rect, flights (k.flights ids), the foot (storey `from`) and the catwalk over it (storey from+1). */
export interface CrevStair { side: 'W' | 'E'; from: number; area: number; rect: Rect; foot: number; flights: number[] }
/** A bridge (world cells): its area, rect (the deck strip from walk edge to walk edge), storey. */
export interface CrevBridge { area: number; rect: Rect; level: number }
/** A pocket (world cells): its area, rect, storey (a terrace nook in a band, covered by the walk above). (Layout version 6: `deep` cells
 *  past the band into the rock — a top-terrace alcove, gen/market/v6/envelope.ts.) */
export interface CrevPocket { area: number; rect: Rect; level: number; side: 'W' | 'E'; deep?: number }

export interface CreviceCarve {
  f: CreviceFrame;
  rows: ReturnType<typeof creviceRows>;
  bases: readonly number[];
  bed: Rect;
  trench: TrenchCells;
  platform: Area;
  gates: {rect: Rect}[];
  square: Area;
  weir: Area;
  low: {W: Area; E: Area};
  /** Storey-L walks per side (index L - 1 for L = 1..3). */
  walks: {W: Area[]; E: Area[]};
  bar: Area;
  /** The chasm's cells (world rect, storey 0 VOID). */
  chasm: Rect;
  containers: CrevContainer[];
  stairs: CrevStair[];
  bridges: CrevBridge[];
  pockets: CrevPocket[];
  /** The den's planned slot (the B0 container its entry is; the den's own carve: gen/market/v5/den.ts). */
  denSlot: number;
  /** World x toward the canonical east: +1, or -1 when mirrored. */
  eastSign: 1 | -1;
  /** Canonical column -> world column, a canonical rect -> world. */
  mx: (x: number) => number;
  M: (r: Rect) => Rect;
  /** (layout version 6, task studio-market-irregular-envelope-20261116-210503-01) The irregular envelope stamped on this carve. */
  envelope?: {plan: CreviceEnvelope; stamp: EnvelopeStamp};
  /** (layout version 7, task studio-market-irregular-settlement-20261117-003819-01) The irregular settlement floorplan this carve follows. */
  settle?: CreviceSettle;
}

/** A version-7 carve's floorplan (gen/market/v7/settlement.ts): per row, world columns. Canonical sides ('W' / 'E': the frame's). */
export interface CreviceSettle {
  plan: CreviceSettlement;
  /** Every walk / low walk's areas: per canonical side, storey 0 (the low walk's runs) and storeys 1-3 (the terrace's runs). */
  parts: {W: Area[][]; E: Area[][]};
  /** The pit's runs of rows with the same span (world cells): the chasm is their union (`chasm` their bounding rect). */
  pit: Rect[];
  /** World columns of side s's walk in front of band L on row y: [first, last] (first: the column against the band's fronts; the walk
   *  runs from it away from the rock to `last`). Storey 0: the low walk / the square's / weir's side lane (its first 5 columns). */
  walkCols: (s: 'W' | 'E', L: number, y: number) => [number, number];
}

/** Why the last attempts failed (QA / tests). */
export const CREVICE_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { CREVICE_CARVE_FAILS[why] = (CREVICE_CARVE_FAILS[why] ?? 0) + 1; return null; };

/** The container paints (world/marketArch.ts MARKET_PAINTS indices) a container may take. */
export const CREVICE_PAINTS = 8;

/**
 * Carves the whole crevice into a fresh 4-storey kit; null when the program does not fit (the caller re-rolls). `env` (layout version
 * 6, task studio-market-irregular-envelope-20261116-210503-01): the irregular envelope (gen/market/v6/envelope.ts) — the top terrace's
 * alcoves reserved before the container fill, every top-storey nook under its soffit, the envelope stamped last. Absent: version 5,
 * exactly as shipped. `plan` (layout version 7, task studio-market-irregular-settlement-20261117-003819-01): the irregular settlement
 * floorplan (gen/market/v7/settlement.ts) — every band's, walk's and the pit's columns per row; absent: version 5's columns, as shipped.
 */
export function carveCrevice(k: Kit, f: CreviceFrame, rng: Rng, env?: CreviceEnvelope, plan?: CreviceSettlement): CreviceCarve | null {
  const W = k.g.w, H = k.g.h;
  const M = (r: Rect): Rect => (f.mirror ? {x: W - r.x - r.w, y: r.y, w: r.w, h: r.h} : {...r});
  const mx = (x: number) => (f.mirror ? W - 1 - x : x);
  const S = CREVICE, top = S.topY, B = S.bases;
  const g = [0, 1, 2, 3].map(L => k.grid(L));
  const R = creviceRows(f);
  if (R.end + 2 > H) return fail('rows beyond the canvas');
  if (R.x0 - S.pitch < 1 || R.x1 + S.pitch > W - 1) return fail('columns beyond the canvas');
  const lvl = (L: number, label: string, extra: Record<string, unknown> = {}) => (L ? {level: L, floorY: B[L], label, publicSpace: false, ...extra} : {label, publicSpace: false, ...extra});
  const cont = (L: number) => B[L] + S.cont;
  /** A canonical column of side s (the west side's own columns; the east side mirrors them about the crevice's centre line). */
  const sx = (s: 'W' | 'E', x: number) => (s === 'W' ? x : R.x0 + R.x1 - 1 - x);
  /** A canonical column range [a, b) of side s as a canonical rect's x / w. */
  const span = (s: 'W' | 'E', a: number, b: number) => (s === 'W' ? {x: a, w: b - a} : {x: sx(s, b - 1), w: b - a});
  /** Band L's back wall column (west side, canonical). */
  const xb = (L: number) => R.x0 + S.pitch * (S.bands - 1 - L);
  const faceOf = (s: 'W' | 'E'): Side => ((s === 'W') !== f.mirror ? 'E' : 'W');
  // (layout version 7: the floorplan's columns per row — band L's back wall on row y; versions 5 / 6: version 5's fixed columns)
  const P = plan ? settlementColumns(R, plan) : null;
  const xbAt = (s: 'W' | 'E', L: number, y: number) => (P ? P.back(s, L, y) : xb(L));
  /** Runs of rows [y0, y1) with the same side-canonical column span [a, b) (`at`). */
  const runsOf = (y0: number, y1: number, at: (y: number) => [number, number]) => {
    const out: {y0: number; y1: number; a: number; b: number}[] = [];
    for (let y = y0; y < y1; y++) {
      const [a, b] = at(y), q = out[out.length - 1];
      if (q && q.a === a && q.b === b) q.y1 = y + 1; else out.push({y0: y, y1: y + 1, a, b});
    }
    return out;
  };
  const longest = (as: Area[]) => as.reduce((p, q) => (q.w * q.h > p.w * p.h ? q : p));

  // --- 1. Track bed + side platform under the hall's vault (edge N, the track 2.0 m north of the edge): the earlier versions' docking ---
  const bed = M({x: S.bedX + (f.shift ?? 0), y: S.bedY, w: f.Lp + 2 * TUN, h: SINGLE_BED_CELLS});
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) {
    const i = g[0].idx(x, y);
    g[0].cells[i] = VOID; g[0].ceil[i] = S.hallY; g[0].floor[i] = -TRENCH_DEPTH;
  }
  g[0].voidFloor = -TRENCH_DEPTH;
  const pRect = M({x: R.pc0, y: R.p0, w: f.Lp, h: f.Pd});
  const trench: TrenchCells = {x0: bed.x, x1: bed.x + bed.w, y0: bed.y, y1: R.p0, px0: pRect.x, px1: pRect.x + pRect.w, tracks: [R.p0 * CELL - 2.0], third: [-1], columns: false, ceil: S.hallY};
  k.trenches.push(trench);
  const platform = k.addArea(pRect, 'platform', 'platform', S.hallY, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;

  // --- 2. The crevice floor: the square, the weir, the low walks (storey 0, open to the top), the chasm (VOID, the dark depth) ---------
  const wL = R.xc0 - S.lowWalk, wR = R.xc1 + S.lowWalk; // the floor's columns [wL, wR) (canonical)
  const pub = (r: Rect, label: string, L = 0, role?: string) => k.addArea(M(r), 'concourse', 'concourse', top, -1, {...lvl(L, label, role ? {role} : {}), publicSpace: true});
  const square = pub({x: wL, y: R.z0, w: wR - wL, h: f.square}, 'Arrival Square');
  let weir: Area, chasm: Rect, low: {W: Area; E: Area};
  const parts: {W: Area[][]; E: Area[][]} = {W: [[], [], [], []], E: [[], [], [], []]};
  const pit: Rect[] = [];
  const pitCell = (x: number, y: number) => { const i = g[0].idx(x, y); g[0].cells[i] = VOID; g[0].area[i] = -1; g[0].ceil[i] = top; g[0].floor[i] = S.chasmY; };
  if (!P) {
    weir = pub({x: wL, y: R.chasm1, w: wR - wL, h: f.weir}, 'The Weir');
    const lowW = pub({x: wL, y: R.chasm0, w: S.lowWalk, h: R.chasm1 - R.chasm0}, 'Low walk');
    const lowE = pub({x: R.xc1, y: R.chasm0, w: S.lowWalk, h: R.chasm1 - R.chasm0}, 'Low walk');
    chasm = M({x: R.xc0, y: R.chasm0, w: f.chasmW, h: R.chasm1 - R.chasm0});
    for (let y = chasm.y; y < chasm.y + chasm.h; y++) for (let x = chasm.x; x < chasm.x + chasm.w; x++) pitCell(x, y);
    low = {W: f.mirror ? lowE : lowW, E: f.mirror ? lowW : lowE};
  } else {
    // (layout version 7) the weir between the two ground bands' fronts on its rows (the ground band's last section: one span); each low
    // walk from its band's fronts to the pit's edge, one area per run of rows with the same span; the pit between the two edges
    weir = pub({x: P.front('W', 0, R.chasm1) + 1, y: R.chasm1, w: sx('E', P.front('E', 0, R.chasm1)) - P.front('W', 0, R.chasm1) - 1, h: f.weir}, 'The Weir');
    for (const s of ['W', 'E'] as const) {
      for (const q of runsOf(R.chasm0, R.chasm1, y => [P.front(s, 0, y) + 1, P.pit(s, y)])) parts[s][0].push(pub({...span(s, q.a, q.b), y: q.y0, h: q.y1 - q.y0}, 'Low walk'));
    }
    let bx0 = Infinity, bx1 = -Infinity;
    for (const q of runsOf(R.chasm0, R.chasm1, y => [P.pit('W', y), sx('E', P.pit('E', y)) + 1])) {
      pit.push(M({x: q.a, y: q.y0, w: q.b - q.a, h: q.y1 - q.y0}));
      for (let y = q.y0; y < q.y1; y++) for (let x = q.a; x < q.b; x++) pitCell(mx(x), y);
      bx0 = Math.min(bx0, q.a); bx1 = Math.max(bx1, q.b);
    }
    chasm = M({x: bx0, y: R.chasm0, w: bx1 - bx0, h: R.chasm1 - R.chasm0});
    low = {W: longest(parts.W[0]), E: longest(parts.E[0])};
  }

  // --- 3. The terrace walks (storeys 1-3): per side, on the roofs of the band below (B_(L-1)'s columns), the whole crevice length -----
  const walks: {W: Area[]; E: Area[]} = {W: [], E: []};
  for (const s of ['W', 'E'] as const) for (let L = 1; L < S.bands; L++) {
    const label = L === 1 ? 'Lower terrace' : L === 2 ? 'Middle terrace' : 'Upper terrace';
    if (P) {
      // (layout version 7) the walk between this band's fronts and the band below's: one area per run of rows with the same span
      for (const q of runsOf(R.z0, R.z1, y => [P.front(s, L, y) + 1, P.front(s, L - 1, y) + 1])) parts[s][L].push(pub({...span(s, q.a, q.b), y: q.y0, h: q.y1 - q.y0}, label, L, 'catwalk'));
      walks[s].push(longest(parts[s][L]));
      continue;
    }
    const a = xb(L - 1) + 1;
    walks[s].push(pub({...span(s, a, a + S.pitch), y: R.z0, h: f.Lc}, label, L, 'catwalk'));
  }

  // --- 4. The bar's deck (storey 1) over the square's north part, from the west lower terrace to the east one ------------------------
  const barRect = M({x: wL, y: R.z0, w: wR - wL, h: f.barD});
  const bar = k.addArea(barRect, 'concourse', 'concourse', top, -1, {level: 1, floorY: B[1], label: 'Bar', publicSpace: true});
  for (let y = barRect.y; y < barRect.y + barRect.h; y++) for (let x = barRect.x; x < barRect.x + barRect.w; x++) g[0].ceil[g[0].idx(x, y)] = cont(0);

  // --- 5. The gates: two wide openings through the hall's south wall into the square (under the bar's deck) -------------------------
  const gw = Math.floor((wR - wL - 4) / 2);
  const gates = [{rect: M({x: wL + 1, y: R.pw, w: gw, h: 1})}, {rect: M({x: wR - 1 - gw, y: R.pw, w: gw, h: 1})}];
  for (const gt of gates) k.carveDoor(gt.rect, platform, square, S.gateH, false);
  // (the platform's span must hold both: the train docks along it, the gates open off it)
  for (const gt of gates) if (gt.rect.x < pRect.x + 1 || gt.rect.x + gt.rect.w > pRect.x + pRect.w - 1) return fail('a gate off the platform');

  // --- 6. Stair bays (cells reserved in the bands first: the containers fill around them) -------------------------------------------
  /** Per side and band: reserved canonical row runs [y0, y1) and what reserved them. */
  const reserved: Record<'W' | 'E', [number, number, string][][]> = {W: [[], [], [], []], E: [[], [], [], []]};
  const bayLen = S.stairFoot + S.stairRun;
  for (const st of f.stairs) {
    const y0 = R.z0 + st.y;
    if (y0 < R.z0 + 1 || y0 + bayLen > R.z1 - 1) return fail('stair bay beyond the crevice');
    reserved[st.side][st.from].push([y0, y0 + bayLen, 'stair']);
  }
  // the bar's annex (the bartender's store) and the two upper shops: band B1 by the bar, on both sides; the den's entry and the square's
  // shops: band B0 by the square; the kitchen and the workshop: band B0 at the weir
  const den: 'W' | 'E' = f.denSide;

  // --- 7. The container bands ----------------------------------------------------------------------------------------------------
  const containers: CrevContainer[] = [];
  const pockets: CrevPocket[] = [];
  const pendingDoors: (() => void)[] = [];
  let prevPaint = -1;
  const paintOf = () => { let p = rng.int(0, CREVICE_PAINTS - 1); if (p === prevPaint) p = (p + 3) % CREVICE_PAINTS; prevPaint = p; return p; };
  /** The walk (area) in front of band L of side s: the low walk / square / weir (L = 0, by row) or the storey-L walk. */
  const walkOf = (s: 'W' | 'E', L: number, y: number): Area => {
    // (layout version 7: the walk area just in front of the band's fronts on that row — several per walk; versions 5 / 6 as shipped)
    if (P) return k.areas[g[L].area[g[L].idx(mx(sx(s, P.front(s, L, y) + 1)), y)]];
    return L === 0 ? (y < R.chasm0 ? square : y >= R.chasm1 ? weir : low[s]) : walks[s][L - 1];
  };
  /** Band L's rows where the walk in front of its fronts is a stair run (band L-1's bays: the run lies along band L's front walls), +- a
   *  row (the run's rails): no door opens there. */
  const runRows = (s: 'W' | 'E', L: number) => f.stairs.filter(st => st.side === s && st.from === L - 1).map(st => [R.z0 + st.y + S.stairFoot - 1, R.z0 + st.y + bayLen + 1] as const);
  /**
   * The front opening of a box of band L, side s, rows [y0, y1): `want` cells (2 at least) centred (+ shift), clear of the end walls and
   * of the stair runs in front of the band (narrowed / moved off them: the nearest fitting rows first); null when none fits.
   */
  const doorFit = (s: 'W' | 'E', L: number, y0: number, y1: number, want: number, shift: number): {dy: number; w: number} | null => {
    const len = y1 - y0, runs = runRows(s, L);
    for (let w = Math.max(2, Math.min(want, len - 2)); w >= 2; w--) {
      const ideal = Math.max(y0 + 1, Math.min(y1 - 1 - w, y0 + Math.floor((len - w) / 2) + shift));
      const cands: number[] = [];
      for (let dy = y0 + 1; dy <= y1 - 1 - w; dy++) cands.push(dy);
      cands.sort((p, q) => Math.abs(p - ideal) - Math.abs(q - ideal) || p - q);
      const dy = cands.find(d => !runs.some(([a, b]) => d < b && d + w > a));
      if (dy !== undefined) return {dy, w};
      if (!runs.length) break;
    }
    return null;
  };
  /**
   * A container of band L, side s, rows [y0, y1) (its interior; the end walls at y0 - 1 and y1). `open`: a room (else CLOSED: solid);
   * `back`: a backroom behind it ('merge': one room with it — the walk-in shops); its door in the front wall: `width` cells (centred +
   * shift), `wide` a shopfront.
   */
  const container = (s: 'W' | 'E', L: number, y0: number, y1: number, use: CrevUse, opts: {open?: boolean; back?: 'room' | 'merge' | null; width?: number; wide?: boolean; shift?: number; label?: string; stall?: MarketShopId} = {}): CrevContainer => {
    const b = xbAt(s, L, y0);
    const boxC: Rect = {...span(s, b, b + S.pitch + 1), y: y0 - 1, h: y1 - y0 + 2};
    const inner: Rect = {...span(s, b + 1, b + 1 + S.inner), y: y0, h: y1 - y0};
    const fit = doorFit(s, L, y0, y1, opts.width ?? 2, opts.shift ?? 0);
    const open = opts.open !== false && fit !== null; // (a box whose whole front stands over a stair run below stays closed)
    const c: CrevContainer = {id: containers.length, area: -1, level: L, box: M(boxC), rect: M(inner), face: faceOf(s), door: null, wide: opts.wide ?? false, use, side: s, paint: paintOf(), ...(opts.stall ? {stall: opts.stall} : {})};
    containers.push(c);
    if (!open) return c;
    const merge = opts.back === 'merge';
    const roomC: Rect = merge ? {...span(s, b - S.inner, b + 1 + S.inner), y: y0, h: y1 - y0} : inner;
    const type = use === 'shop' ? 'shop' : use === 'workshop' ? 'utility' : use === 'kitchen' || use === 'bunks' || use === 'home' ? 'crew-room' : 'storage';
    const onto = walkOf(s, L, P ? fit!.dy + (fit!.w >> 1) : Math.floor((y0 + y1) / 2));
    const a = k.addArea(M(roomC), 'room', type, cont(L), onto.id, lvl(L, opts.label ?? (use === 'home' ? 'Home' : 'Container')));
    if (use === 'workshop') a.purpose = 'workshop';
    c.area = a.id;
    c.rect = M(roomC);
    // the opening in the front wall (column b + 6): doorFit's rows
    const len = y1 - y0, {dy, w} = fit!;
    c.door = M({...span(s, b + S.pitch, b + S.pitch + 1), y: dy, h: w});
    const door = c.door;
    pendingDoors.push(() => { k.carveDoor(door, onto, a, S.doorH, false); });
    // (layout version 7: a back room the canvas has no rock for — a deep setback near its edge — is left out)
    const backFits = !P || (() => { const r = M({...span(s, b - S.inner - 1, b), y: y0, h: 1}); return r.x >= 1 && r.x + r.w <= W - 1; })();
    if (opts.back === 'room' && backFits) {
      // the backroom: the rock-cut room behind the back wall (under the next band's container), joined by a 2-cell door
      const bk = k.addArea(M({...span(s, b - S.inner, b), y: y0, h: y1 - y0}), 'room', type, cont(L), a.id, lvl(L, use === 'home' || use === 'bunks' ? 'Back room' : 'Store'));
      const by = y0 + Math.max(1, Math.min(len - 3, Math.floor(len / 2) - 1 + rng.int(-2, 2)));
      const bd = M({...span(s, b, b + 1), y: by, h: 2});
      c.back = bk.id; c.backDoor = bd;
      pendingDoors.push(() => { k.carveDoor(bd, a, bk, S.doorH, false); });
    } else if (merge) c.backDoor = null;
    return c;
  };

  // the special slots (canonical rows; fixed first so the fill works round them)
  type Slot = {s: 'W' | 'E'; L: number; y0: number; y1: number; make: () => CrevContainer | null};
  const special: Slot[] = [];
  const otherSide: 'W' | 'E' = den === 'W' ? 'E' : 'W';
  // B0 by the square: the den's entry (den side, first slot: 10 rows), then that side's square shop(s); the other side's square shops
  {
    let y = R.z0 + 1;
    special.push({s: den, L: 0, y0: y, y1: y + 10, make: () => container(den, 0, R.z0 + 1, R.z0 + 11, 'den', {width: 3, label: 'Den entry'})});
    y += 11;
    for (const id of f.ground[den]) {
      const y0 = y; special.push({s: den, L: 0, y0, y1: y0 + 12, make: () => container(den, 0, y0, y0 + 12, 'shop', {back: 'merge', width: 6, wide: true, stall: id})});
      y += 13;
    }
    y = R.z0 + 1;
    for (const id of f.ground[otherSide]) {
      const y0 = y; special.push({s: otherSide, L: 0, y0, y1: y0 + 12, make: () => container(otherSide, 0, y0, y0 + 12, 'shop', {back: 'merge', width: 6, wide: true, stall: id})});
      y += 13;
    }
  }
  // B1 by the bar: the bartender's store on each side's first slot, then the upper shops (one per side)
  for (const [k2, s] of (['W', 'E'] as const).entries()) {
    special.push({s, L: 1, y0: R.z0 + 1, y1: R.z0 + 9, make: () => container(s, 1, R.z0 + 1, R.z0 + 9, 'bar-store', {width: 2, label: k2 ? 'Bar store' : 'Cellar'})});
    const id = f.upper[k2];
    if (id) special.push({s, L: 1, y0: R.z0 + 10, y1: R.z0 + 22, make: () => container(s, 1, R.z0 + 10, R.z0 + 22, 'shop', {back: 'merge', width: 6, wide: true, stall: id})});
  }
  // B0 at the weir: the communal kitchen (one side, with its pantry behind), the workshop (the other, with its store)
  {
    const ks: 'W' | 'E' = rng.chance(0.5) ? 'W' : 'E', ws: 'W' | 'E' = ks === 'W' ? 'E' : 'W';
    const y1 = R.z1 - 1, y0 = y1 - 16;
    special.push({s: ks, L: 0, y0, y1, make: () => container(ks, 0, y0, y1, 'kitchen', {back: 'room', width: 12, wide: true, label: 'Communal kitchen'})});
    special.push({s: ws, L: 0, y0: y1 - 14, y1, make: () => container(ws, 0, y1 - 14, y1, 'workshop', {back: 'room', width: 6, wide: true, label: 'Workshop'})});
  }
  for (const sp of special) reserved[sp.s][sp.L].push([sp.y0, sp.y1, 'special']);
  // (layout version 6) the top terrace's alcoves: the container row gives way to a deep rock-cut setback (the first candidate row clear
  // of everything reserved, of the stair runs in front of the band and of the top bridges' mouths)
  const alcoveAt = new Map<string, AlcovePlan>();
  /** (layout version 7) Does a section break of band L fall inside rows [y0, y1)? (a unit stands in one section) */
  const broken = (s: 'W' | 'E', L: number, y0: number, y1: number) => !!plan && plan.bands[s][L].breaks.some(b => b >= y0 && b < y1);
  if (env) for (const al of env.alcoves) {
    const L = S.bands - 1, s = al.side;
    for (const y0 of al.rows) {
      const y1 = y0 + al.len;
      if (reserved[s][L].some(([a, b]) => y0 < b + 3 && y1 > a - 3)) continue;
      if (runRows(s, L).some(([a, b]) => y0 < b + 2 && y1 > a - 2)) continue;
      if (f.bridges.some(br => br.level === L && y0 < R.z0 + br.y + S.bridgeW + 3 && y1 > R.z0 + br.y - 3)) continue;
      if (broken(s, L, y0, y1)) continue;
      reserved[s][L].push([y0, y1, 'alcove']);
      alcoveAt.set(`${s}:${y0}`, al);
      break;
    }
  }
  // a seeded pocket per side on storeys 0..2 (a terrace nook), clear of everything reserved, 6-8 rows
  for (const s of ['W', 'E'] as const) for (let L = 0; L < 3; L++) {
    const n = rng.int(6, 8);
    for (let t = 0; t < 10; t++) {
      const y0 = rng.int(R.chasm0 + 2, R.chasm1 - n - 2);
      if (reserved[s][L].some(([a, b]) => y0 < b + 3 && y0 + n > a - 3)) continue;
      if (runRows(s, L).some(([a, b]) => y0 < b && y0 + n > a)) continue; // (its mouth would open onto a stair run below)
      if (broken(s, L, y0, y0 + n)) continue;
      reserved[s][L].push([y0, y0 + n, 'pocket']);
      break;
    }
  }
  // make the special containers (fixed order: their ids / areas are stable)
  for (const sp of special) if (!sp.make()) return fail('special slot');
  // fill each band's free runs: containers (lengths near a 20 ft box, some 40 ft), separated by one wall row; a run too short for a box
  // stays a pocket. Uses are assigned after (gen/market/v5/uses.ts rules here, inline)
  const fillers: {s: 'W' | 'E'; L: number; y0: number; y1: number}[] = [];
  for (const s of ['W', 'E'] as const) for (let L = 0; L < S.bands; L++) {
    // (layout version 7: a section break is a container end wall row — the runs split there, like at a special's wall)
    const res = [...reserved[s][L], ...(plan ? plan.bands[s][L].breaks.map(b => [b + 1, b, 'special'] as [number, number, string]) : [])].sort((p, q) => p[0] - q[0]);
    let y = R.z0 + 1;
    const runs: [number, number][] = [];
    for (const [a, b, why] of res) {
      // a stair bay / pocket / special: its own rows are not a container's; the walls between: a container's end wall row each side
      if (a - 1 > y) runs.push([y, a - 1]);
      y = Math.max(y, why === 'special' ? b + 1 : b);
      if (why !== 'special') y = Math.max(y, b + 1); // (the row after a bay / pocket is the next container's end wall)
    }
    if (R.z1 - 1 > y) runs.push([y, R.z1 - 1]);
    for (const [a, b] of runs) {
      const cMin = plan ? SETTLEMENT.contMin : S.contLen[0], ws = b - a >= cMin ? fillRun(a, b, cMin, S.contLen[1], plan ? SETTLEMENT.contAvg : S.contAvg, rng) : null;
      if (!ws) {
        // too short for a box: a pocket, when enough of its mouth (2 rows) opens onto the walk clear of the stair runs below
        let mouth = 0;
        for (let y = a; y < b; y++) if (!runRows(s, L).some(([p, q]) => y >= p && y < q)) mouth++;
        if (b - a >= 3 && mouth >= 2) reserved[s][L].push([a, b, 'pocket']);
        continue;
      }
      let yy = a;
      for (const w of ws) { fillers.push({s, L, y0: yy, y1: yy + w}); yy += w + 1; }
    }
  }
  // uses of the fill: the ground boxes along the low walks are the services (in priority order over a seeded slot order: every station
  // gets the essentials), then homes; the lower terrace holds the bunk room, the services left over and a second store; the terraces are
  // homes, about a third of them closed (boxes nobody opens), more of them up top
  const uses = new Map<typeof fillers[number], CrevUse>();
  const canOpen = (q: typeof fillers[number]) => doorFit(q.s, q.L, q.y0, q.y1, 2, 0) !== null;
  const ground = rng.shuffle(fillers.filter(q => q.L === 0));
  const services: CrevUse[] = ['water', 'latrine', 'storage', 'generator', 'tea', 'repair', 'laundry'];
  services.forEach((u, i) => { if (ground[i]) uses.set(ground[i], u); });
  // the lower terrace: the bunk room, the services the ground had no box for, a second store
  const lower = rng.shuffle(fillers.filter(q => q.L === 1 && canOpen(q)));
  (['bunks', ...services.slice(ground.length), 'storage'] as CrevUse[]).forEach((u, i) => { if (lower[i]) uses.set(lower[i], u); });
  for (const fl of fillers) {
    const len = fl.y1 - fl.y0, use = uses.get(fl) ?? 'home';
    const open = use !== 'home' || fl.L === 0 || rng.chance(fl.L === 3 ? 0.62 : 0.72);
    const wide = use === 'tea' || use === 'repair' || use === 'laundry';
    const back = use === 'home' && open && rng.chance(0.45) ? 'room' as const : use === 'bunks' ? 'room' as const : null;
    container(fl.s, fl.L, fl.y0, fl.y1, use, {open, back, width: wide ? Math.min(len - 2, 8) : use === 'bunks' ? 3 : 2, wide, shift: rng.int(-2, 2), label: use === 'home' ? undefined : labelOf(use)});
  }

  // --- 8. Pockets: the storey-L walk widened into the band (its floor; covered by the walk above unless the top storey) ---------------
  // (layout version 6: a top-storey nook is a sheltered alcove under its own soffit; an alcove runs `deep` cells on into the rock)
  let topNook = 0;
  for (const s of ['W', 'E'] as const) for (let L = 0; L < S.bands; L++) for (const [a, b, why] of reserved[s][L]) {
    if (why !== 'pocket' && why !== 'alcove') continue;
    const al = why === 'alcove' ? alcoveAt.get(`${s}:${a}`) : undefined, deep = al?.deep ?? 0;
    const xp = xbAt(s, L, a);
    const r = M({...span(s, xp + 1 - deep, xp + S.pitch + 1), y: a, h: b - a});
    const ceil = L < S.bands - 1 ? cont(L) : env ? al?.soffit ?? env.nooks[topNook++ % env.nooks.length] : top;
    const ar = k.addArea(r, 'concourse', 'concourse', ceil, walkOf(s, L, a).id, {...lvl(L, 'Terrace nook'), publicSpace: true});
    pockets.push({area: ar.id, rect: r, level: L, side: s, ...(deep ? {deep} : {})});
  }

  // --- 9. The stair bays (storeys L + L+1): the run against the rock (3 cells), the foot / catwalk strip beside it ---------------------
  const spec = {...STAIR, headroom: OPEN_HEADROOM};
  const stairs: CrevStair[] = [];
  for (const st of f.stairs) {
    const L = st.from, y0 = R.z0 + st.y, b = xbAt(st.side, L, y0);
    // the foot (storey L): the bay's first rows across the band, then the strip beside the run (its ceiling the catwalk's slab)
    const footR = M({...span(st.side, b + 1, b + S.pitch + 1), y: y0, h: bayLen});
    const foot = k.addArea(footR, 'passage', 'passage', cont(L), -1, {...lvl(L, 'Stair foot'), publicSpace: true});
    const runC: Rect = {...span(st.side, b + 1, b + 4), y: y0 + S.stairFoot, h: S.stairRun};
    const r = M(runC);
    const a = k.addArea(r, 'passage', 'stair-core', top, -1, {...(L ? {level: L, floorY: B[L]} : {}), also: [L + 1], role: 'stair', publicSpace: true, label: 'Stairs'});
    let fl: StairFlight[];
    try { fl = layStairRun([g[L], g[L + 1]], r, a.id, 'z', 'hi', B[L + 1], B[L], spec); } catch { return fail('stair run'); }
    const flights: number[] = [];
    for (const q of fl) { q.id = k.flights.length; flights.push(q.id); k.flights.push(q); g[L].ramps[q.ramp].capCeil = true; }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = g[L].idx(x, y); g[L].ceil[i] = top; g[L + 1].ceil[i] = top; }
    // the storey above over the bay: the walk's cells stay (the catwalk over the strip, the deck over the foot's first rows)
    stairs.push({side: st.side, from: L, area: a.id, rect: r, foot: foot.id, flights});
  }

  // --- 10. Bridges (storey L): the deck strip from the west storey-L walk's edge to the east one's; under it every open band lowered ----
  const bridges: CrevBridge[] = [];
  for (const br of f.bridges) {
    // the deck spans [a, the east storey-L walk's first column = sx('E', a - 1)) (symmetric about the centre line: mirror-invariant)
    const L = br.level, a = (P ? P.front('W', L - 1, R.z0 + br.y) : xb(L - 1) + S.pitch) + 1; // one past the west storey-L walk
    // (layout version 7: to the east storey-L walk's own edge — the two sides' edges differ; straight over the deck's rows)
    const e = P ? sx('E', P.front('E', L - 1, R.z0 + br.y)) : sx('E', a - 1);
    const rw = M({x: a, y: R.z0 + br.y, w: e - a, h: S.bridgeW});
    if (rw.y < R.chasm0 || rw.y + rw.h > R.chasm1) return fail('bridge off the chasm');
    for (let y = rw.y; y < rw.y + rw.h; y++) for (let x = rw.x; x < rw.x + rw.w; x++) {
      for (let lo = 0; lo < L; lo++) {
        const i = g[lo].idx(x, y);
        if ((g[lo].cells[i] === FLOOR || g[lo].cells[i] === VOID) && g[lo].ceil[i] > B[L] - S.deckDepth) g[lo].ceil[i] = B[L] - S.deckDepth;
      }
      if (g[L].cells[g[L].idx(x, y)] !== SOLID) return fail('bridge over a storey-L floor');
    }
    const ar = k.addArea(rw, 'concourse', 'concourse', top, -1, {level: L, floorY: B[L], label: 'Bridge', role: 'crossover', publicSpace: true});
    bridges.push({area: ar.id, rect: rw, level: L});
  }

  // --- 11. Openings ---------------------------------------------------------------------------------------------------------------
  for (const d of pendingDoors) d();

  // --- 12. (layout version 6) The irregular envelope: the overhead, the chasm's bed, the end clefts (gen/market/v6/envelope.ts) -----
  const envelope = env ? {plan: env, stamp: stampEnvelope(env, g, top, f.mirror, chasm)} : undefined;

  const denSlot = containers.findIndex(c => c.use === 'den');
  // (layout version 7) the floorplan's record: every walk's areas, the pit's runs, the walk columns per row
  const settle: CreviceSettle | undefined = P && plan ? {
    plan, parts, pit,
    walkCols: (s, L, y) => {
      const first = (L ? P.front(s, L, y) : P.front(s, 0, y)) + 1;
      const last = L ? P.front(s, L - 1, y) : y >= R.chasm0 && y < R.chasm1 ? P.pit(s, y) - 1 : first + S.lowWalk - 1;
      return [mx(sx(s, first)), mx(sx(s, last))];
    },
  } : undefined;
  return {
    f, rows: R, bases: B, bed, trench, platform, gates, square, weir, low, walks, bar, chasm, containers, stairs, bridges, pockets, denSlot,
    eastSign: f.mirror ? -1 : 1, mx, M, ...(envelope ? {envelope} : {}), ...(settle ? {settle} : {}),
  };
}

function labelOf(use: CrevUse): string {
  switch (use) {
    case 'water': return 'Water point';
    case 'latrine': return 'Latrine';
    case 'generator': return 'Generator shed';
    case 'storage': return 'Storage';
    case 'tea': return 'Tea counter';
    case 'repair': return 'Repair counter';
    case 'laundry': return 'Laundry';
    case 'bunks': return 'Bunk room';
    case 'clinic-store': return 'Sick bay';
    default: return 'Container';
  }
}

/** Grid helper for the index / tests: whether a storey-L cell is open floor (not rock, not a ramp). */
export function openFloor(gr: Grid, x: number, y: number): boolean {
  return gr.inBounds(x, y) && gr.cells[gr.idx(x, y)] === FLOOR && gr.rampIdx[gr.idx(x, y)] < 0;
}
