// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): THE RECORD STOCK of Northern Groove Records — pure data /
// geometry shared by the dresser (gen/skyways/stores/musicDress.ts: where each block of sleeves stands, its box, its support) and the
// renderer (world/skywaysStoreMusic.ts: the same sleeves drawn with the Codex cover atlas). User: "the record store needs actual records
// in the holders".
//
// The holders are the existing measured record-bin racks (skyDRecordBins: lane SHOPS-A's empty Meshy rack, front +Z, drawn as authored,
// k = 1). Each rack has two sloped tray ROWS of six compartments; the measurements below are ray probes of
// assets/models/skyways-d-mu-bins.glb in the rack's own frame (origin bottom centre, front +Z, metres):
//  - compartment walls (inner faces) at x = ±0.888 / [-0.579 | -0.572] / [-0.291 | -0.281] / [0.003 | 0.013] / [0.294 | 0.307] /
//    [0.582 | 0.592]: six bays 0.275-0.309 m wide (dividers ~0.1 m above the tray floor);
//  - the FRONT row's tray floor falls from the cross bar (front face z 0.068, top 0.735) at 29° to a valley at z 0.28 (y 0.467), then
//    rises to the front lip (top 0.512 at z 0.38);
//  - the BACK row's tray floor falls at 31° from the back wall (front face z -0.333, top 0.991) to the bar's back face (z 0.045).
// A 12-inch LP sleeve (31.5 cm) does not fit a 27.5 cm bay, so the bins hold 10-INCH records (26.5 cm sleeves, a real LP format);
// the faced-out wall and the crates show 12-inch LPs.
//
// A BLOCK = the sleeves standing in one compartment, filed front to back and leaning back: the rearmost leans on its row's support
// (the cross bar's top edge / the back wall), each next one stands on the tray floor in front of it, a hair more upright (the
// front of a part-filled bin fans open), bottom edges on the measured floor, never touching (plane spacing >= the sleeve thickness).
// The two rows step up toward the back, so behind each front cover a staircase of sleeve tops shows — a browsing bin.
// One placement (kind skyMuBinRecords) per compartment; its variant = a BLOCK STYLE (row, count, covers, lean) from a small fixed set,
// so the renderer instances one geometry per style.

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/** The bins' 10-inch record sleeve: side (m) and thickness (sleeve + disc). */
export const BIN_SLEEVE = {s: 0.265, t: 0.0032} as const;
/** The wall's / crates' 12-inch LP sleeve. */
export const LP_SLEEVE = {s: 0.315, t: 0.0035} as const;
/** Cover art cells in the atlas (world/skywaysStoreMusic.ts: 8 x 8 cells; Codex sheets 1-4, sixteen covers each). */
export const MUSIC_COVER_COUNT = 64;

/** The six compartments' inner x ranges (rack frame; the same for both rows within 1 cm — the narrower one is kept). */
export const BIN_BAYS: readonly (readonly [number, number])[] = [[-0.888, -0.579], [-0.572, -0.291], [-0.281, 0.003], [0.013, 0.294], [0.307, 0.582], [0.592, 0.888]];
/** Half the narrowest bay minus half a sleeve: the sideways play a sleeve may take (m, a millimetre kept clear). */
export const BIN_PLAY = r4(Math.min(...BIN_BAYS.map(([a, b]) => b - a)) / 2 - BIN_SLEEVE.s / 2 - 0.001);

/** Tray floor profiles (z, y) of the rows, front first (piecewise linear between the measured points). */
const FRONT_FLOOR: readonly (readonly [number, number])[] = [[0.38, 0.512], [0.35, 0.498], [0.30, 0.475], [0.28, 0.467], [0.20, 0.512], [0.10, 0.568], [0.07, 0.585]];
const BACK_FLOOR: readonly (readonly [number, number])[] = [[0.045, 0.598], [0.0, 0.625], [-0.10, 0.685], [-0.20, 0.745], [-0.30, 0.805], [-0.333, 0.825]];

export interface BinRow {
  /** 0 = the front row, 1 = the back row. */
  row: 0 | 1;
  /** The floor profile (z falling = toward the back). */
  floor: readonly (readonly [number, number])[];
  /** The support the rearmost sleeve leans on: its front face z and its top y (the bar / the back wall). */
  support: {z: number; top: number};
  /** The frontmost a sleeve's bottom edge may stand (z): the front valley / just behind the bar. */
  zFront: number;
  /** Divider top above the tray floor (m, the lowest measured). */
  wall: number;
}
export const BIN_ROWS: readonly [BinRow, BinRow] = [
  {row: 0, floor: FRONT_FLOOR, support: {z: 0.068, top: 0.735}, zFront: 0.278, wall: 0.085},
  {row: 1, floor: BACK_FLOOR, support: {z: -0.333, top: 0.991}, zFront: 0.038, wall: 0.097},
];

/** Tray floor height of a row at rack-local z (clamped to the measured span). */
export function binFloorY(row: BinRow, z: number): number {
  const f = row.floor;
  for (let i = 1; i < f.length; i++) {
    const [z0, y0] = f[i - 1], [z1, y1] = f[i];
    if ((z <= z0 && z >= z1) || i === f.length - 1) {
      const t = z0 === z1 ? 0 : Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
      return y0 + (y1 - y0) * t;
    }
  }
  return f[0][1];
}

/** One sleeve of a block (rack frame): bottom edge centre (x offset in its bay, z, y), lean back from vertical (rad), its covers. */
export interface BinSleeve { dx: number; z: number; y: number; lean: number; cover: number; back: number }
export interface BinBlock {
  row: 0 | 1;
  style: number;
  sleeves: BinSleeve[];
  /** The block's box in the rack frame (x half width about the bay centre; z / y extents of every sleeve corner). */
  hx: number; z0: number; z1: number; y0: number; y1: number;
}

/** Block styles per row (variant = row * BIN_STYLES + style). */
export const BIN_STYLES = 10;

/** Deterministic hash -> [0, 1). */
function h01(a: number, b: number, c = 0): number {
  let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Signed distance (along the sleeve's forward normal) from the plane of a sleeve standing at (z, y) with `lean` to a point (pz, py). */
const planeDist = (z: number, y: number, lean: number, pz: number, py: number): number => Math.cos(lean) * (pz - z) + Math.sin(lean) * (py - y);

/**
 * The rearmost sleeve's bottom edge z: its back face just touches the support (the support's top front corner, or — when the sleeve
 * top stays below it — the support's face), its bottom on the tray floor. Bisection over the row's floor span.
 */
function restZ(row: BinRow, lean: number): number {
  const {s, t} = BIN_SLEEVE, sp = row.support;
  const lo = sp.z + 0.005, hi = row.zFront;
  // the corner contact: plane distance from the sleeve's mid plane to the support corner = -(t/2 + clearance)
  const f = (z: number) => {
    const y = binFloorY(row, z);
    const topY = y + s * Math.cos(lean);
    if (topY < sp.top) return (z - s * Math.sin(lean)) - (sp.z + t / 2 + 0.0005); // face contact: the top corner at the face
    return -planeDist(z, y, lean, sp.z, sp.top) - (t / 2 + 0.0005);
  };
  let a = lo, b = hi;
  // f rises with z (the sleeve moves away from the support)
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; }
  return b;
}

/** Most sleeves a row's bay takes at a lean / pitch (for the styles' counts). */
function capacity(row: BinRow, lean: number, pitch: number): number {
  let z = restZ(row, lean), n = 1;
  for (;;) {
    const nz = nextZ(row, z, lean, pitch);
    if (nz > row.zFront) return n;
    z = nz; n++;
  }
}
/**
 * The next sleeve's bottom edge z: on the floor `pitch` in front of the previous sleeve's mid plane (it stands a hair more upright, so
 * the two planes only part going up — they never cross).
 */
function nextZ(row: BinRow, z: number, leanPrev: number, pitch: number): number {
  const y = binFloorY(row, z);
  let a = z, b = z + 0.05;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (planeDist(z, y, leanPrev, m, binFloorY(row, m)) < pitch) a = m; else b = m; }
  return b;
}

const BLOCKS = new Map<number, BinBlock>();
/** The block of a variant (row * BIN_STYLES + style). Cached; pure. */
export function binBlock(variant: number): BinBlock {
  const v = ((Math.trunc(variant) % (2 * BIN_STYLES)) + 2 * BIN_STYLES) % (2 * BIN_STYLES);
  let b = BLOCKS.get(v);
  if (b) return b;
  const rowIx = v < BIN_STYLES ? 0 : 1, style = v % BIN_STYLES, row = BIN_ROWS[rowIx];
  const {s, t} = BIN_SLEEVE;
  const deg = Math.PI / 180;
  const lean0 = (16 + 8 * h01(rowIx, style, 1)) * deg;
  const pitch = t + 0.0004 + 0.0008 * h01(rowIx, style, 2);
  const cap = capacity(row, lean0, pitch);
  // counts: a well-stocked shop — 55-95 % full (never empty)
  const n = Math.max(6, Math.min(cap, Math.round(cap * (0.55 + 0.4 * h01(rowIx, style, 3)))));
  const sleeves: BinSleeve[] = [];
  let z = restZ(row, lean0), lean = lean0;
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const nz = nextZ(row, z, lean, pitch);
      if (nz > row.zFront) break;
      z = nz;
      lean = Math.max(9 * deg, lean - h01(rowIx, style, 100 + k) * 0.45 * deg);
    }
    // covers: a fixed shuffle per style; the back face shows another cover (the record's back sleeve)
    const cover = Math.floor(h01(rowIx * 31 + style, k, 7) * MUSIC_COVER_COUNT);
    const back = (cover + 17 + Math.floor(h01(rowIx, style, 300 + k) * 29)) % MUSIC_COVER_COUNT;
    const dx = (h01(rowIx, style, 500 + k) * 2 - 1) * BIN_PLAY;
    sleeves.push({dx: r4(dx), z: r4(z), y: r4(binFloorY(row, z)), lean: r4(lean), cover, back});
  }
  // box: every corner of every sleeve (a sleeve is a thin slab: bottom edge (z, y), top edge back by s sin(lean))
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of sleeves) {
    const c = Math.cos(q.lean), sn = Math.sin(q.lean);
    for (const [u, w] of [[0, -t / 2], [0, t / 2], [s, -t / 2], [s, t / 2]]) {
      const pz = q.z - u * sn + w * c, py = q.y + u * c + w * sn;
      z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  }
  b = {row: rowIx as 0 | 1, style, sleeves, hx: r4(s / 2 + BIN_PLAY), z0: r4(z0), z1: r4(z1), y0: r4(y0), y1: r4(y1)};
  BLOCKS.set(v, b);
  return b;
}

/** The bay centre x of a compartment (0..5, rack frame). */
export const binBayX = (col: number): number => r4((BIN_BAYS[col][0] + BIN_BAYS[col][1]) / 2);

/**
 * A block's placement frame in the rack frame: the box centre (x = the bay centre, z), its base y and its half sizes — the prop stands
 * there (its origin = the box's bottom centre); the renderer draws the sleeves relative to it.
 */
export function binBlockFrame(variant: number, col: number): {x: number; z: number; y: number; hx: number; hz: number; h: number} {
  const b = binBlock(variant);
  return {x: binBayX(col), z: r4((b.z0 + b.z1) / 2), y: b.y0, hx: b.hx, hz: r4((b.z1 - b.z0) / 2), h: r4(b.y1 - b.y0)};
}

// =================================================================================================================================
// The faced-out NEW ARRIVALS wall (skyMuCoverWall board with three ledges; one skyMuFacedRecords row of 12-inch LPs per ledge).

/** The cover wall board (m): width, height, the board's thickness, the ledges' heights above the board's base, depth and lip. */
export const COVER_WALL = {w: 2.0, h: 1.62, t: 0.03, ledges: [0.06, 0.56, 1.06], ledgeD: 0.09, lip: 0.025, header: {w: 1.5, h: 0.37}} as const;
/** The board's base above the floor (m): it is wall-mounted (the floor in front stays walkable). */
export const COVER_WALL_BASE_Y = 0.92;
/** Faced sleeves per ledge and their pitch along it. */
export const FACED_PER_LEDGE = 5;
export const FACED_PITCH = 0.385;
/** Faced-row styles (variant). */
export const FACED_STYLES = 12;
export interface FacedSleeve { x: number; lean: number; cover: number }
/** A ledge row's sleeves (x along the ledge from its centre, lean back from vertical, cover): each stands on the ledge, leaning on the board. */
export function facedRow(variant: number): FacedSleeve[] {
  const v = ((Math.trunc(variant) % FACED_STYLES) + FACED_STYLES) % FACED_STYLES;
  const out: FacedSleeve[] = [];
  for (let k = 0; k < FACED_PER_LEDGE; k++) {
    const x = (k - (FACED_PER_LEDGE - 1) / 2) * FACED_PITCH + (h01(v, k, 41) * 2 - 1) * 0.02;
    // the lean that puts the sleeve's back on the board: its bottom edge at the ledge's lip side, its top on the board face
    out.push({x: r4(x), lean: facedLean(), cover: Math.floor(h01(v + 101, k, 43) * MUSIC_COVER_COUNT)});
  }
  return out;
}
/** The faced sleeve's lean (rad): bottom edge just inside the ledge lip, the sleeve's top resting on the board face. */
export function facedLean(): number {
  const {s, t} = LP_SLEEVE, run = COVER_WALL.ledgeD - COVER_WALL.lip * 0.4 - t; // horizontal room between the lip and the board face
  return r4(Math.asin(Math.min(0.5, run / s)));
}
