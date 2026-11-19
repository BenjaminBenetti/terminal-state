// Task studio-surface-map-tent-cab-20261119-025201-01 (lane MAP): THE PLANNING MAP'S LABEL PLACER — pure and deterministic (no DOM, no
// three.js, no measuring). User, on the planning map: "the diagonal lines and overlapping text make it hard to read" — "I like the vibe! a
// lot!". The placer keeps the vibe and only moves TEXT:
//  - text extents are ESTIMATED from the font size and the characters with Helvetica / Arial advance widths (what the user's sheet renders
//    with: its bold names measure 0.55 em a character, as Arial Bold does) and per-style factors (the cursive notes, letter-spaced caps);
//    the SVG drawing pins every placed line to that width (textLength), so the estimate is the drawn extent on any font;
//  - a label is a block of lines around its ANCHOR — the symbol drawn at the real place (a destination frame, a note's tone glyph, YOU /
//    TRUCK, the way back, the checkpoint compound). The symbol never moves; the text takes the cheapest free candidate box around the
//    anchor box: below / above / right / left / the diagonals (a few slides each) at growing gaps (rings), scored by ring, the label's own
//    direction preference and covering the spot a street name wants (soft). A displaced label gets a thin LEADER to its symbol;
//  - callers pass requests in priority order (highest first); a placed box, its leader and every symbol are taken for all later labels;
//    obstacles carry a tag a request may be allowed to cover (YOU / TRUCK / the way back inside the checkpoint compound);
//  - a STREET name slides along its own carriageway, then along the other segments of the same street nearby; one that still finds no
//    room is skipped only when the same name is printed near it (stats.streetSkipped);
//  - nothing is dropped silently: a label out of candidates goes to the nearest free spot further out, with a leader (stats.fallback) —
//    where no leader can reach it clear of other text / symbols, the leader may pass under other text, then under symbols too
//    (stats.crossed: the text itself never overlaps); one with no free spot at all (none on the real districts: the tests pin stats.overlap = 0) is still printed, at its first
//    candidate.

export interface LBox { x0: number; z0: number; x1: number; z1: number }

export type LabelDir = 'S' | 'N' | 'E' | 'W' | 'SE' | 'NE' | 'SW' | 'NW';

/** A text style as the estimate needs it (size in sheet units = metres). `track` = letter-spacing; `cursive` = the grease-pencil hand. */
export interface FontSpec { size: number; bold?: boolean; cursive?: boolean; track?: number }

// Helvetica / Arial advance widths (1/1000 em) for ' ' .. '~' (the standard AFM metrics; Arial is metric-compatible).
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const W_EXTRA: Record<string, number> = {'—': 1000, '–': 556, '·': 278, '’': 222, '‘': 222, '“': 333, '”': 333, '…': 1000, '°': 400, '×': 584};
/** The cursive note hand vs Arial regular (the user's sheet: 0.43 em a character where Arial measures 0.47). */
const CURSIVE = 0.92;

/** Estimated advance width of `text` in `f` (sheet units). */
export function textWidth(text: string, f: FontSpec): number {
  const tab = f.bold ? W_BOLD : W_REG;
  let em = 0;
  for (const ch of text) {
    const base = ch.normalize('NFD')[0];
    const c = base.charCodeAt(0);
    em += (W_EXTRA[ch] ?? (c >= 32 && c <= 126 ? tab[c - 32] : 556)) / 1000;
  }
  return em * f.size * (f.cursive ? CURSIVE : 1) + [...text].length * (f.track ?? 0);
}

/** Vertical metrics (em): a line box runs from ascent above the baseline to descent below; lines advance by `lead`. */
export const LINE = {ascent: 0.78, descent: 0.24, lead: 1.08} as const;

/** Line `text` into at most `max` lines of about `limit` characters, breaking at spaces near even lengths (after ':' / ',' preferred). */
export function wrapText(text: string, limit: number, max = 2): string[] {
  if (text.length <= limit || max < 2) return [text];
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best = -1, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const score = Math.max(a.length, b.length) - (/[:,;]$/.test(a) ? 4 : 0) + (b.length > a.length + 6 ? 2 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  const head = words.slice(0, best).join(' '), tail = words.slice(best).join(' ');
  return [head, ...wrapText(tail, limit, max - 1)];
}

export const overlaps = (a: LBox, b: LBox, pad = 0): boolean => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.z0 < b.z1 + pad && b.z0 < a.z1 + pad;
const inside = (a: LBox, b: LBox): boolean => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;
export const boxAt = (cx: number, cz: number, w: number, h: number): LBox => ({x0: cx - w / 2, z0: cz - h / 2, x1: cx + w / 2, z1: cz + h / 2});

/** Does segment (x0,z0)-(x1,z1) cross box b? (Liang–Barsky) */
export function segmentHitsBox(x0: number, z0: number, x1: number, z1: number, b: LBox): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q] of [[-dx, x0 - b.x0], [dx, b.x1 - x0], [-dz, z0 - b.z0], [dz, b.z1 - z0]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/** The closest points of two boxes (a leader's ends): [ax, az, bx, bz] with (ax, az) on `a`. */
export function closestPoints(a: LBox, b: LBox): [number, number, number, number] {
  const axis = (a0: number, a1: number, b0: number, b1: number): [number, number] => {
    if (a1 < b0) return [a1, b0];
    if (b1 < a0) return [a0, b1];
    const m = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    return [m, m];
  };
  const [ax, bx] = axis(a.x0, a.x1, b.x0, b.x1), [az, bz] = axis(a.z0, a.z1, b.z0, b.z1);
  return [ax, az, bx, bz];
}

/** A street name's room: its centre slides along a horizontal (z fixed) or vertical (x fixed) carriageway between lo and hi. */
export interface StreetRun { x: number; z: number; vertical: boolean; lo: number; hi: number }

export interface LabelReq {
  id: string;
  /** The real point (a leader with no symbol ends here). */
  ax: number; az: number;
  /** The symbol drawn at the real place (the text never covers it); a point label passes a tiny box at (ax, az). */
  anchor: LBox;
  /** Text block size (sheet units). */
  w: number; h: number;
  /** Candidate directions, preferred first. */
  dirs: readonly LabelDir[];
  /** Obstacle tags this label may cover (YOU / TRUCK / the way back: the checkpoint compound they stand in). */
  ignore?: readonly string[];
  /** A street name: its own run first, then the same street's other segments nearby (no ring search; `name` for the duplicate rule). */
  street?: {name: string; runs: readonly StreetRun[]};
}

export interface Obstacle { box: LBox; tag: string }

export interface PlacedLabel {
  id: string;
  box: LBox;
  dir: LabelDir | 'along' | 'free';
  /** 0 = touching its symbol; the gap grows by LABEL_RINGS.step a ring. */
  ring: number;
  /** A thin line from the text block to its symbol (x0, z0 on the text) when the text stands off it. */
  leader: [number, number, number, number] | null;
  /** Out of candidates: at the nearest free spot further out (with a leader). */
  fallback: boolean;
  /** Its fallback leader passes under other text or symbols (no clear line reached a free spot). */
  crossed: boolean;
  /** No free spot at all: printed at its first candidate over something else (never on the real districts). */
  overlap: boolean;
}

export interface LabelStats { labels: number; displaced: number; leaders: number; fallback: number; crossed: number; overlap: number; streetSkipped: number }

/**
 * Candidate rings (metres): the first gap, the step, the count; the fallback search reaches out to `far` in `farStep` steps; a leader is
 * drawn from `leaderMin`; boxes keep `pad` apart. Street names slide in `slide` steps, keep `nameGap` clear of the same name, and one
 * without room is skipped when the same name is printed within `sameName`.
 */
export const LABEL_RINGS = {gap0: 0.8, step: 3.2, count: 10, far: 160, farStep: 3, leaderMin: 2.2, pad: 0.35, slide: 3, nameGap: 24, sameName: 180} as const;
type Rings = {-readonly [K in keyof typeof LABEL_RINGS]: number};
const ringsAt = (unit: number): Rings => ({...LABEL_RINGS, gap0: LABEL_RINGS.gap0 * unit, step: LABEL_RINGS.step * unit, far: LABEL_RINGS.far * unit, farStep: LABEL_RINGS.farStep * unit,
  leaderMin: LABEL_RINGS.leaderMin * unit, pad: LABEL_RINGS.pad * unit, slide: LABEL_RINGS.slide * unit, nameGap: LABEL_RINGS.nameGap * unit, sameName: LABEL_RINGS.sameName * unit});
/** The gap between two boxes (0 when they touch or overlap). */
export const boxGap = (a: LBox, b: LBox): number => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));

const DIR_OFFSET: Record<LabelDir, [number, number]> = {S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0], SE: [1, 1], NE: [1, -1], SW: [-1, 1], NW: [-1, -1]};

/** The candidate box for `dir` at gap g around anchor box A (slide s = -1 / 0 / 1: shifted along the side by a third of the text). */
function candidate(A: LBox, ax: number, az: number, w: number, h: number, dir: LabelDir, g: number, slide: number): LBox {
  const [dx, dz] = DIR_OFFSET[dir];
  let cx: number, cz: number;
  if (dx === 0) cx = ax + slide * w / 3;
  else cx = dx > 0 ? A.x1 + g + w / 2 : A.x0 - g - w / 2;
  if (dz === 0) cz = az + slide * h / 2;
  else cz = dz > 0 ? A.z1 + g + h / 2 : A.z0 - g - h / 2;
  if (dx !== 0 && dz !== 0 && slide !== 0) { // (a diagonal's slides tuck the text half under / over the symbol's corner)
    if (slide < 0) cx -= dx * Math.min(w / 2, A.x1 - A.x0 + g); else cz -= dz * Math.min(h / 2, A.z1 - A.z0 + g);
  }
  return boxAt(cx, cz, w, h);
}

/**
 * Place every request, in the given (priority) order. `soft`: boxes a label should rather not cover (the spots the street names want).
 * `unit`: sheet units per metre (LABEL_RINGS are metres: the table-top canvas places in pixels). Returns one PlacedLabel per printed
 * request (a street name skipped by the duplicate rule is listed in `skipped`, never silently).
 */
export function placeLabels(reqs: readonly LabelReq[], obstacles: readonly Obstacle[], bounds: LBox, soft: readonly LBox[] = [], unit = 1): {placed: PlacedLabel[]; skipped: string[]; stats: LabelStats} {
  const R = ringsAt(unit), pad = R.pad;
  const taken: LBox[] = [];
  const leaders: [number, number, number, number][] = [];
  const placed: PlacedLabel[] = [], skipped: string[] = [];
  const stats: LabelStats = {labels: 0, displaced: 0, leaders: 0, fallback: 0, crossed: 0, overlap: 0, streetSkipped: 0};
  const streetsDone: {name: string; x: number; z: number; box: LBox}[] = [];

  /** Is box b free for q (with its leader)? `relax` 1: the leader may pass under other text; 2: under symbols too. */
  const free = (q: LabelReq, b: LBox, leader: [number, number, number, number] | null, relax = 0): boolean => {
    if (!inside(b, bounds)) return false;
    for (const o of obstacles) if (overlaps(b, o.box, pad) && !(q.ignore?.includes(o.tag))) return false;
    for (const t of taken) if (overlaps(b, t, pad)) return false;
    for (const l of leaders) if (segmentHitsBox(l[0], l[1], l[2], l[3], b)) return false;
    if (leader && relax < 2) {
      // a leader crosses no other text and no other symbol (its own symbol is where it ends)
      if (relax < 1) for (const t of taken) if (segmentHitsBox(leader[0], leader[1], leader[2], leader[3], t)) return false;
      for (const o of obstacles) if (o.box !== q.anchor && !overlaps(o.box, q.anchor) && !(q.ignore?.includes(o.tag)) && segmentHitsBox(leader[0], leader[1], leader[2], leader[3], o.box)) return false;
    }
    return true;
  };
  const leaderFor = (q: LabelReq, b: LBox): [number, number, number, number] | null => {
    const [lx, lz, ax, az] = closestPoints(b, q.anchor);
    return Math.hypot(lx - ax, lz - az) >= R.leaderMin ? [lx, lz, ax, az] : null;
  };
  const softCost = (b: LBox) => { let c = 0; for (const s of soft) if (overlaps(b, s)) c++; return c; };
  const commit = (q: LabelReq, p: PlacedLabel) => {
    placed.push(p);
    taken.push(p.box);
    if (p.leader) { leaders.push(p.leader); stats.leaders++; }
    stats.labels++;
    if (p.ring > 0 || p.fallback) stats.displaced++;
    if (p.fallback) stats.fallback++;
    if (p.crossed) stats.crossed++;
    if (p.overlap) stats.overlap++;
    if (q.street) streetsDone.push({name: q.street.name, x: q.ax, z: q.az, box: p.box});
  };

  for (const q of reqs) {
    if (q.street) {
      // slide along the carriageway(s): the centre steps out from each run's own point, nearest first, never up against the same name
      let got: LBox | null = null;
      const name = q.street.name, apart = (b: LBox) => !streetsDone.some(s => s.name === name && boxGap(s.box, b) < R.nameGap);
      // (on the carriageway's centre line first, then just off it along the kerb, either side: still reading along its own street)
      runs: for (const run of q.street.runs) for (const side of [0, 1, -1]) {
        const at = run.vertical ? run.z : run.x, lo = Math.min(run.lo, at), hi = Math.max(run.hi, at), off = side * q.h * 0.9;
        const box = (c: number) => (run.vertical ? boxAt(run.x + off, c, q.h, q.w) : boxAt(c, run.z + off, q.w, q.h));
        for (let k = 0; k <= 40 && !got; k++) {
          const d = Math.ceil(k / 2) * R.slide * (k % 2 ? 1 : -1), c = at + d;
          if (c < lo - 1e-6 || c > hi + 1e-6) { if (Math.ceil(k / 2) * R.slide > hi - lo) break; continue; }
          const b = box(c);
          if (apart(b) && free(q, b, null)) got = b;
        }
        if (got) break runs;
      }
      if (got) { commit(q, {id: q.id, box: got, dir: 'along', ring: 0, leader: null, fallback: false, crossed: false, overlap: false}); continue; }
      if (streetsDone.some(s => s.name === q.street!.name && Math.hypot(s.x - q.ax, s.z - q.az) < R.sameName)) { skipped.push(q.id); stats.streetSkipped++; continue; }
    } else {
      let best: {b: LBox; cost: number; dir: LabelDir; ring: number; leader: [number, number, number, number] | null} | null = null;
      for (let ring = 0; ring < R.count; ring++) {
        if (best && ring * 10 > best.cost) break;
        const g = R.gap0 + ring * R.step;
        for (let di = 0; di < q.dirs.length; di++) {
          const dir = q.dirs[di];
          for (const slide of [0, -1, 1]) {
            const b = candidate(q.anchor, q.ax, q.az, q.w, q.h, dir, g, slide);
            const cost = ring * 10 + di * 1.5 + Math.abs(slide) * 0.8 + softCost(b) * 6;
            if (best && cost >= best.cost) continue;
            const leader = leaderFor(q, b);
            if (free(q, b, leader)) best = {b, cost, dir, ring, leader};
          }
        }
      }
      if (best) { commit(q, {id: q.id, box: best.b, dir: best.dir, ring: best.ring, leader: best.leader, fallback: false, crossed: false, overlap: false}); continue; }
    }
    // fallback: the nearest free spot further out (square rings of centres around the anchor), with a leader — a street name's leader
    // ends on an uncovered point of its own carriageway
    let fq = q;
    if (q.street) {
      const run = q.street.runs[0], at = run.vertical ? run.z : run.x, lo = Math.min(run.lo, at), hi = Math.max(run.hi, at);
      for (let k = 0; k <= 60; k++) {
        const c = at + Math.ceil(k / 2) * R.slide * (k % 2 ? 1 : -1);
        if (c < lo || c > hi) continue;
        const pt = run.vertical ? boxAt(run.x, c, 0.5 * unit, 0.5 * unit) : boxAt(c, run.z, 0.5 * unit, 0.5 * unit);
        if (!taken.some(t => overlaps(pt, t)) && !obstacles.some(o => overlaps(pt, o.box))) { fq = {...q, ax: (pt.x0 + pt.x1) / 2, az: (pt.z0 + pt.z1) / 2, anchor: pt}; break; }
      }
    }
    const f = fallbackSpot(fq, R, free, leaderFor, 0) ?? fallbackSpot(fq, R, free, leaderFor, 1) ?? fallbackSpot(fq, R, free, leaderFor, 2);
    if (f) { commit(q, {id: q.id, box: f.b, dir: 'free', ring: R.count, leader: f.leader ?? leaderFor(fq, f.b), fallback: true, crossed: f.relax > 0, overlap: false}); continue; }
    const b0 = q.street ? (q.street.runs[0].vertical ? boxAt(q.ax, q.az, q.h, q.w) : boxAt(q.ax, q.az, q.w, q.h)) : candidate(q.anchor, q.ax, q.az, q.w, q.h, q.dirs[0] ?? 'S', R.gap0, 0);
    commit(q, {id: q.id, box: b0, dir: q.street ? 'along' : q.dirs[0] ?? 'S', ring: 0, leader: null, fallback: true, crossed: false, overlap: true});
  }
  return {placed, skipped, stats};
}

/** The nearest free spot beyond the rings (square rings of centres round the anchor); `relax`: how far its leader may pass under things. */
function fallbackSpot(q: LabelReq, R: Rings, free: (q: LabelReq, b: LBox, l: [number, number, number, number] | null, relax: number) => boolean,
  leaderFor: (q: LabelReq, b: LBox) => [number, number, number, number] | null, relax: number): {b: LBox; leader: [number, number, number, number] | null; relax: number} | null {
  const cx = (q.anchor.x0 + q.anchor.x1) / 2, cz = (q.anchor.z0 + q.anchor.z1) / 2;
  const w = q.street?.runs[0].vertical ? q.h : q.w, h = q.street?.runs[0].vertical ? q.w : q.h;
  const r0 = R.gap0 + R.count * R.step;
  for (let r = r0; r <= R.far; r += R.farStep) {
    let best: {b: LBox; d: number; leader: [number, number, number, number] | null} | null = null;
    const n = Math.max(4, Math.ceil((8 * r) / R.farStep));
    for (let i = 0; i < n; i++) {
      // the perimeter of the square of half-size r, walked from the top-left corner
      const t = (i / n) * 8 * r, side = Math.floor(t / (2 * r)), u = t - side * 2 * r - r;
      const [ox, oz] = side === 0 ? [u, -r] : side === 1 ? [r, u] : side === 2 ? [-u, r] : [-r, -u];
      const b = boxAt(cx + ox + Math.sign(ox) * w / 2, cz + oz + Math.sign(oz) * h / 2, w, h);
      const [lx, lz, ax, az] = closestPoints(b, q.anchor), d = Math.hypot(lx - ax, lz - az);
      if (best && d >= best.d) continue;
      const leader = leaderFor(q, b);
      if (free(q, b, leader, relax)) best = {b, d, leader};
    }
    if (best) return {...best, relax};
  }
  return null;
}
