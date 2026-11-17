// Task studio-market-irregular-settlement-20261117-003819-01: THE SURVIVOR MARKET, layout version 7 — version 6's crevice settlement
// (gen/market/v5/ in the irregular envelope of gen/market/v6/envelope.ts) with an IRREGULAR SETTLEMENT FLOORPLAN. User, after version 6:
// "the market its self is still really square, it should have a more randomized shape, around that pit, you know some levels are offset
// more than others ... bring that non square ness in to the market its self."
//
// Version 5 / 6 build every storey's container row on one fixed column and step each band back exactly 3 m, so every terrace is a 3 m
// ribbon, the low walks a 2.5 m one and the pit one long rectangle. Version 7 keeps the settlement's architecture (converted containers
// terraced up both sides on four storeys, stairs, bridges, the square, the bar, the den, the weir) but plans its FLOORPLAN per side, per
// storey and per SECTION of the crevice:
//  - BANDS: each storey's container row (a band) runs in sections of 10-26 rows. Each section stands at its own setback toward or away
//    from the pit, so the row bends (a few sections stepping the same way), jogs and bulges. Every band has its own character: its mean
//    setback over the band below (per side a narrow, a middling and a wide terrace in a seeded storey order) and its own bends. The breaks
//    between sections are staggered from storey to storey, so no two levels share a line or a setback. Each terrace walk is what lies
//    between its band and the band below's roofs: 2.5-6.5 m wide, never the same ribbon twice.
//  - LANDINGS / PLAZAS: the band behind a bridge's mouth steps back, so the bridge lands on a widened landing; now and then a section
//    sets back further still, a small plaza on its terrace.
//  - THE PIT: each side's chasm edge (the low walk's railing) runs in its own sections: a lookout bastion jutting into the pit here, the
//    pit biting into the walk there. The pit's outline from above steps along both sides, its width changing down the crevice.
//  - Kept, by construction: the Arrival Square, the bar's deck, the gates, the den and the square's heavy shops on version 5's columns
//    (the flat carry route from the train is unchanged); the weir a rectangle (its side setback seeded); every unit (a container, a stair
//    bay, a nook) inside one section; every walk at least 2.5 m wide (3 m beside a stair's head: the run always climbs against its band's
//    rock or a walk, never under the next band's boxes); the low walks 2.5 m or more; the pit at least 3.5 m wide; each bridge's deck
//    between two straight walk edges.
// Pure data on its own stream (gen/market/v5/index.ts forks it: versions 5 and 6 never draw it). Canonical cells: each side in its own
// west-side columns (gen/market/v5/frame.ts; the east side mirrors them about the crevice's centre line, the stamp mirrors the station).

import type {Rng} from '../../../core/rng';
import {CREVICE, type CreviceFrame, type creviceRows} from '../v5/frame';

type Rows = ReturnType<typeof creviceRows>;
export type Side = 'W' | 'E';

/** Fixed numbers of the settlement plan (cells / rows unless noted). */
export const SETTLEMENT = {
  /** A version-7 kit's canvas columns, and how far every column moves east (room for the deeper setbacks and their back rooms). */
  canvasW: 108,
  shift: 10,
  /** Band offsets toward the pit (cells, against version 5's columns): every band, the ground band. */
  off: [-12, 1] as const,
  ground: [-3, 1] as const,
  /** A terrace walk's width: the least (2.5 m), beside a stair's head (3 m), the most a section aims for. */
  walk: [5, 13] as const,
  walkStair: 6,
  /** A band's mean walk width (its character), per side and storey. */
  character: [5, 11] as const,
  /** A section's length; how far one section's setback may jump from the last (a jog); a bend's reach either way. */
  piece: [10, 26] as const,
  jog: 3,
  bend: 2,
  /** The band behind a bridge's mouth steps back this far (a landing); a plaza's extra setback, its chance per side and storey. */
  landing: [2, 3] as const,
  plaza: {extra: [2, 4] as const, p: 0.55},
  /** Breaks of the storey above / the pit's edge kept this many rows off the band below's. */
  stagger: 3,
  /** The pit: each side's edge offset (cells toward the centre line) bounds, sections, the low walk's width, the narrowest pit (3.5 m). */
  edge: [-2, 3] as const,
  edgePiece: [6, 16] as const,
  low: [5, 9] as const,
  pitMin: 7,
  /** A lookout bastion's chance per edge section and its reach; the pit biting into the walk. */
  bastion: {p: 0.3, reach: [2, 3] as const},
  bite: 0.2,
  /** Rows kept unbroken around a stair bay on its own band (the flush section above breaks inside them, staggered off this band). */
  bayMargin: 4,
  /** The shortest container (cells: a 10 ft box, for the short runs between section breaks — every break, and the breaks around the
   *  stair bays, is a container end wall too) and the usual one, a little over version 5's so the boxes keep version 6's length on
   *  average: a home under ~5 m has no corner 1.25 m off its door once its bed and table are in (market/people/refuges.ts: no hide slot). */
  contMin: 6,
  contAvg: 13,
} as const;

/** The settlement plan of one version-7 crevice. Offsets in cells toward the pit against version 5's columns (side-canonical). */
export interface CreviceSettlement {
  H: number;
  /** Per side, per band (storey): its section breaks (rows: each a container end wall row) and the sections' offsets (breaks + 1). */
  bands: Record<Side, {breaks: number[]; o: number[]}[]>;
  /** Per side: the pit edge's section breaks over the chasm's rows and their offsets. */
  edges: Record<Side, {breaks: number[]; o: number[]}>;
  /** Per side, per band: the band's offset on every canvas row (a break row: the larger of its two sections' — the wall row stands as far
   *  out as the box reaching furthest). */
  rows: Record<Side, Int8Array[]>;
  /** Per side: the pit edge's offset on every canvas row (chasm rows; 0 elsewhere). */
  pit: Record<Side, Int8Array>;
  /** Per side, per band: the rows of the band below's stair bays (+- their mouths) where this band keeps a 3 m walk (QA). */
  stairRows: Record<Side, Uint8Array[]>;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Every unit (a container, a stair bay, a nook) of a band stands in one section: the rows of the frame's fixed units per side / band. */
function frameUnits(R: Rows, f: CreviceFrame): Record<Side, [number, number][][]> {
  const S = CREVICE, bayLen = S.stairFoot + S.stairRun;
  const u: Record<Side, [number, number][][]> = {W: [[], [], [], []], E: [[], [], [], []]};
  // (a stair bay with a margin: the band above stands flush with its run, its section breaks just outside — still staggered off these)
  for (const st of f.stairs) u[st.side][st.from].push([R.z0 + st.y - SETTLEMENT.bayMargin, R.z0 + st.y + bayLen + SETTLEMENT.bayMargin + 1]);
  // (gen/market/v5/carve.ts specials: the den's entry and the square's shops on band 0, the bar's stores and the upper shops on band 1,
  // the weir's kitchen / workshop on band 0 — either side: its draw is the carve's)
  const den = f.denSide, other: Side = den === 'W' ? 'E' : 'W';
  u[den][0].push([R.z0 + 1, R.z0 + 11]);
  let y = R.z0 + 12;
  for (let k = 0; k < f.ground[den].length; k++) { u[den][0].push([y, y + 12]); y += 13; }
  y = R.z0 + 1;
  for (let k = 0; k < f.ground[other].length; k++) { u[other][0].push([y, y + 12]); y += 13; }
  (['W', 'E'] as const).forEach((s, k) => {
    u[s][1].push([R.z0 + 1, R.z0 + 9]);
    if (f.upper[k]) u[s][1].push([R.z0 + 10, R.z0 + 22]);
    u[s][0].push([R.z1 - 17, R.z1 - 1]);
  });
  return u;
}

/** Section breaks over rows [lo, hi): seeded lengths, each break the nearest allowed row to its target (`nb`: rows no break may take). */
function pickBreaks(r: Rng, nb: Uint8Array, lo: number, hi: number, len: readonly [number, number]): number[] {
  const out: number[] = [];
  let y = lo;
  for (;;) {
    const t = y + r.int(len[0], len[1]);
    if (t > hi - len[0]) break;
    let b = -1;
    for (let d = 0; d <= 8 && b < 0; d++) for (const c of d ? [t + d, t - d] : [t]) if (c >= y + len[0] && c <= hi - len[0] && !nb[c]) { b = c; break; }
    for (let c = t + 9; b < 0 && c <= hi - len[0]; c++) if (!nb[c]) b = c;
    if (b < 0) break;
    out.push(b);
    y = b;
  }
  return out;
}

/** Sections [y0, y1) of a break list over [lo, hi). */
const sections = (b: readonly number[], lo: number, hi: number): [number, number][] => [lo, ...b].map((y, k) => [y, k < b.length ? b[k] : hi]);

/** Per-row offsets of a section list (a break row takes the larger of its two sections' offsets when `wall`). */
function rowsOf(H: number, b: readonly number[], o: readonly number[], lo: number, hi: number, wall: boolean): Int8Array {
  const out = new Int8Array(H);
  sections(b, lo, hi).forEach(([a, c], k) => { for (let y = a; y < c; y++) out[y] = o[k]; });
  if (wall) b.forEach((y, k) => { out[y] = Math.max(o[k], o[k + 1]); });
  return out;
}

/** The settlement plan of a version-7 crevice: its frame's rows / columns `R`, the frame, the canvas rows, the plan's own stream. */
export function creviceSettlement(R: Rows, f: CreviceFrame, H: number, r: Rng): CreviceSettlement {
  const Z = SETTLEMENT, S = CREVICE, z0 = R.z0, z1 = R.z1;
  const units = frameUnits(R, f);
  const bands: CreviceSettlement['bands'] = {W: [], E: []};
  const rows: CreviceSettlement['rows'] = {W: [], E: []};
  const stairRows: CreviceSettlement['stairRows'] = {W: [], E: []};
  const bayLen = S.stairFoot + S.stairRun;
  for (const s of ['W', 'E'] as const) {
    // each storey's character: its mean walk width over the band below — a narrow, a middling and a wide terrace in a seeded order, each
    // nudged a cell either way (so some levels stand clearly further back than others, differently on the two sides)
    const [c0, c1] = Z.character, spread = r.shuffle([c0, (c0 + c1) >> 1, c1]);
    const character = [0, ...spread.map(c => clamp(c + r.int(-1, 1), c0, c1))];
    const bias0 = r.int(-2, 0);
    for (let L = 0; L < S.bands; L++) {
      // --- where this band may not break: inside its units, near its ends, under a bridge's deck / mouth one storey up (the bridge's
      // walk edge is this band's front: straight), the square's / weir's rows on the ground band, near the band below's breaks ------
      const nb = new Uint8Array(H);
      const mark = (a: number, c: number) => { for (let y = Math.max(0, a); y < Math.min(H, c); y++) nb[y] = 1; };
      for (const [a, c] of units[s][L]) mark(a, c);
      mark(z0, z0 + Z.piece[0]); mark(z1 - Z.piece[0], z1);
      for (const br of f.bridges) if (br.level === L + 1) mark(z0 + br.y - 2, z0 + br.y + S.bridgeW + 2);
      if (L === 0) { mark(z0, R.chasm0 + 2); mark(R.chasm1 - 2, z1); }
      const hard = nb.slice(); // (the rows no break may ever take: the stagger below comes on top)
      const below = L ? bands[s][L - 1].breaks : [];
      for (const b of below) mark(b - Z.stagger, b + Z.stagger + 1);
      let breaks = pickBreaks(r, nb, z0, z1, Z.piece);
      // --- the hard bounds per row: this band never overhangs the walk below it by more than 0.5 m (a 2.5 m walk), and beside the band
      // below's stair runs (their foot, run and head) stands exactly on the run's rock line, as on version 5 (a 3 m walk: the run climbs
      // beside a wall or a walk, never under a box; and over the run's wall only the band's own back wall column, no wider walk — residents'
      // routes smoothed across a wider one up there hug the run's wall and stall) -------------------------------------------------------
      const hiRow = new Int8Array(H), loRow = new Int8Array(H), bay = new Uint8Array(H);
      for (let y = 0; y < H; y++) {
        if (L === 0) { hiRow[y] = Z.ground[1]; loRow[y] = Z.ground[0]; continue; }
        const ob = rows[s][L - 1][y];
        hiRow[y] = ob + 6 - Z.walk[0];
        loRow[y] = Math.max(Z.off[0], ob + 6 - Z.walk[1]);
      }
      if (L) for (const st of f.stairs) {
        if (st.side !== s || st.from !== L - 1) continue;
        const a = z0 + st.y, c = a + bayLen, ob = rows[s][L - 1][a];
        for (let y = a - 1; y < c + 2; y++) { hiRow[y] = Math.min(hiRow[y], ob + 6 - Z.walkStair); loRow[y] = Math.max(loRow[y], ob + 6 - Z.walkStair); bay[y] = 1; }
      }
      // (only the bay itself stands flush: the band breaks just outside it — inside the band below's unbroken margin there, so the breaks
      // stay staggered and the flush section never reaches rows where the band below steps elsewhere — unless a break already stands
      // there; never on a row no break may take)
      if (L) for (const st of f.stairs) {
        if (st.side !== s || st.from !== L - 1) continue;
        const p = z0 + st.y - 1, q = z0 + st.y + bayLen + 2, m = Z.bayMargin - 1;
        const free = (y: number) => !hard[y];
        if (!breaks.some(b => b >= p - m && b < p)) for (let b = p - 1; b >= p - m; b--) if (free(b)) { breaks.push(b); break; }
        if (!breaks.some(b => b >= q && b < q + m)) for (let b = q; b < q + m; b++) if (free(b)) { breaks.push(b); break; }
        breaks = [...new Set(breaks)].sort((u, v) => u - v);
      }
      stairRows[s].push(bay);
      // --- the sections' offsets: the storey's character, a bend (a bounded drift that turns now and then), landings behind the bridges'
      // mouths on this storey, a plaza now and then; clamped into the bounds over each section's rows (its end wall row included) -------
      const secs = sections(breaks, z0, z1);
      const plaza = L > 0 && r.chance(Z.plaza.p) ? r.int(0, secs.length - 1) : -1;
      const o: number[] = [];
      let bend = r.int(-1, 1), turn = r.chance(0.5) ? 1 : -1;
      secs.forEach(([a, c], k) => {
        let hi: number = Z.off[1], lo: number = Z.off[0];
        for (let y = a; y <= Math.min(c, z1 - 1); y++) { hi = Math.min(hi, hiRow[y]); lo = Math.max(lo, loRow[y]); }
        if (r.chance(0.35)) turn = -turn;
        bend = clamp(bend + (r.chance(0.7) ? turn : 0), -Z.bend, Z.bend);
        let want: number;
        if (L === 0) want = a < R.chasm0 + 2 ? 0 : bias0 + bend;
        else {
          // the band below's most common offset over the section, less (character - 3 m)
          const tally = new Map<number, number>();
          for (let y = a; y < c; y++) tally.set(rows[s][L - 1][y], (tally.get(rows[s][L - 1][y]) ?? 0) + 1);
          const ref = [...tally].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
          want = ref + 6 - character[L] + bend;
          if (f.bridges.some(br => br.level === L && z0 + br.y < c && z0 + br.y + S.bridgeW > a)) want -= r.int(Z.landing[0], Z.landing[1]);
          if (k === plaza) want -= r.int(Z.plaza.extra[0], Z.plaza.extra[1]);
        }
        if (k > 0) want = clamp(want, o[k - 1] - Z.jog, o[k - 1] + Z.jog);
        // (the square's / the den's rows keep version 5's ground columns: the flat carry route, the bar's deck, the gates)
        if (L === 0 && a < R.chasm0 + 2) { o.push(0); return; }
        o.push(lo > hi ? hi : clamp(want, lo, hi));
      });
      bands[s].push({breaks, o});
      rows[s].push(rowsOf(H, breaks, o, z0, z1, true));
    }
  }
  // --- the pit: each side's edge in its own sections (staggered off the ground band's breaks); the low walk 2.5-4.5 m (a bastion
  // reaching further), the pit at least 3.5 m wide (the west side leaves the east side its least walk) --------------------------------
  const edges = {} as CreviceSettlement['edges'];
  const pit = {} as CreviceSettlement['pit'];
  const cw = R.xc1 - R.xc0;
  for (const s of ['W', 'E'] as const) {
    const nb = new Uint8Array(H), g0 = rows[s][0], other = rows[s === 'W' ? 'E' : 'W'][0];
    for (const b of bands[s][0].breaks) for (let y = b - Z.stagger; y <= b + Z.stagger; y++) if (y >= 0 && y < H) nb[y] = 1;
    const breaks = pickBreaks(r, nb, R.chasm0, R.chasm1, Z.edgePiece);
    const lowChar = r.int(0, 2), o: number[] = [];
    sections(breaks, R.chasm0, R.chasm1).forEach(([a, c], k) => {
      let lo: number = Z.edge[0], hi: number = Z.edge[1];
      for (let y = a; y < c; y++) {
        lo = Math.max(lo, g0[y]);
        hi = Math.min(hi, g0[y] + Z.low[1] - Z.low[0]);
        hi = Math.min(hi, s === 'W' ? cw - Z.pitMin - Math.max(Z.edge[0], other[y]) : cw - Z.pitMin - pit.W[y]);
      }
      const t = r.next();
      let want = g0[a] + lowChar + (t < Z.bastion.p ? r.int(Z.bastion.reach[0], Z.bastion.reach[1]) : t < Z.bastion.p + Z.bite ? -1 : r.int(-1, 1));
      if (k > 0) want = clamp(want, o[k - 1] - Z.jog, o[k - 1] + Z.jog);
      o.push(lo > hi ? lo : clamp(want, lo, hi));
    });
    edges[s] = {breaks, o};
    pit[s] = rowsOf(H, breaks, o, R.chasm0, R.chasm1, false);
  }
  return {H, bands, edges, rows, pit, stairRows};
}

/** The plan's columns (side-canonical, gen/market/v5/frame.ts): band L's front wall column on row y, the pit's first column on row y. */
export function settlementColumns(R: Rows, plan: CreviceSettlement) {
  const S = CREVICE;
  /** Band L's back wall column with no offset (version 5's). */
  const xb = (L: number) => R.x0 + S.pitch * (S.bands - 1 - L);
  return {
    xb,
    /** Band L's back wall column on row y. */
    back: (s: Side, L: number, y: number) => xb(L) + plan.rows[s][L][y],
    /** Band L's front wall column on row y (the walk above it runs on its roof up to here). */
    front: (s: Side, L: number, y: number) => xb(L) + S.pitch + plan.rows[s][L][y],
    /** The pit's first column on row y (the low walk ends one column before it). */
    pit: (s: Side, y: number) => R.xc0 + plan.pit[s][y],
  };
}
