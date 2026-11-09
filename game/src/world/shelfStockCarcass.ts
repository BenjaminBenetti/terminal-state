// Iteration 08 (Lane S): the DISPLAY TREATMENT of stocked shelving, derived at runtime — the old
// product-picture facades are removed and the carcass (boards, uprights, supports, a plain back) is
// kept, so genuinely separate 3D filler stock (world/shelfStock.ts) can stand on the real boards.
// Pure data (no three.js): world/storefrontBuilder.ts renders the parts, world/shelfStock.ts dresses
// the boards, physics/fillerStock.ts collides with the colliders. Original GLB / texture files are
// never touched.
//
// Where the pictures came from (and what replaces them), per holder kind:
//  - stockShelf: the generated shelf.glb is a plain open steel unit; the "stock" was three authored
//    boxes per unit (gen/purposeShapes.ts stockShelfStock) face-mapped with canvas pictures of goods
//    (world/purposeTextures.ts stock* rows). Derived: those boxes are dropped; a plain painted back
//    board stands just behind the unit (the authored fallback frame keeps its own back panel).
//  - magazineRack: magazine-rack.glb has the magazines / newspapers BAKED into one mesh (blurred AI
//    covers on the tiers and in the bin). Derived: an authored carcass of the same footprint (side
//    panels, back, slanted backing boards with ledges + lips, newspaper bin, header) replaces the
//    model at runtime; the GLB stays on disk unchanged.
//  - flowerStand: authored boxes carrying a canvas picture of blooms (and fixed buckets). Derived:
//    the stepped wooden stand only; the buckets with flowers are filler.
//  - breadRack: authored trays carrying canvas pictures of loaves / donuts. Derived: frame + trays.
//  - repairBench: picture strips (key-shop parts box, phone-shop accessory rail). Derived: the parts
//    box is dropped (filler boxes take its place), the rail becomes a plain pegboard strip.
//  - deviceWall: tech-display.glb keeps its baked display phones on stands, accessory cards and
//    screen (fixed 3D dummies, not a flat sheet); its cabinet deck behind the display phones was bare —
//    boxed device stock now stands there. The authored fallback's picture rows are dropped.
//  - snackRack / shopCooler (iteration-05 open cooler) carry no picture: unchanged, stocked.
//  - repairBench (key cutting, variant 0): the key wall was one canvas picture of blanks on hooks
//    (world/purposeTextures.ts keyBlanks). Derived: that texture now draws only the bare pegboard and
//    its sign; authored hook rods stand out of it (KEY_HOOKS) and 3D key blanks hang on them.
//  - blenderBar (juice bar): two solid crates under a canvas picture of fruit. Derived: open crates
//    (floor + four walls) filled with whole 3D fruit.

import {KITCHEN_LINE, PROP_DEFS, PURPOSE_SURFACES, SHELF_TIER_Y, SHOP_COOLER_SURFACES} from '../gen/props';
import {purposePropShape, type PurposePart, type PartMat} from '../gen/purposeShapes';
import type {Board, Box3Like, V3} from './shelfStockLayout';
import {MERCH_BARE_VARIANT} from '../gen/skyways/stores/kinds/merch'; // lane MERCH: a bare device wall (its devices are props)

/** Picture-carrying purpose materials (gen/purposeShapes.ts PURPOSE_MAT_KEYS) removed by the derivation. */
export const PICTURE_MATS: ReadonlySet<string> = new Set(['stockSnacks', 'stockGrocery', 'stockPharmacy', 'stockCleaning', 'stockDevices', 'stockCartons', 'stockParts', 'magazines', 'flowers', 'bread', 'donuts', 'fruit']);

/**
 * Key-cutting wall (repairBench variant 0): the pegboard (gen/purposeShapes.ts repairBench, x ±0.76,
 * y 1.0..1.94, face at z -0.26) and its hook rods — 10 columns x 6 rows, 4 mm square, 55 mm long.
 */
export const KEY_WALL = {
  face: -0.26, tip: -0.205, rod: 0.002,
  xs: [-0.675, -0.525, -0.375, -0.225, -0.075, 0.075, 0.225, 0.375, 0.525, 0.675] as const,
  ys: [1.86, 1.73, 1.6, 1.47, 1.34, 1.21] as const,
};

/** The juice bar's fruit crates: the solid 'wood' boxes of gen/purposeShapes.ts blenderBar (holder-local). */
function fruitCrates(): PurposePart[] {
  return (purposePropShape('blenderBar', 0) ?? []).filter(p => p.m === 'wood');
}
/** Open crate walls / floor thickness. */
const CRATE_WALL = 0.012, CRATE_FLOOR = 0.015;
/** An open crate (floor + four walls) of a solid crate box. */
function openCrate(c: PurposePart): PurposePart[] {
  const x0 = c.p[0] - c.s[0] / 2, x1 = c.p[0] + c.s[0] / 2, y0 = c.p[1] - c.s[1] / 2, y1 = c.p[1] + c.s[1] / 2, z0 = c.p[2] - c.s[2] / 2, z1 = c.p[2] + c.s[2] / 2;
  const t = CRATE_WALL;
  return [
    bb('wood', x0, y0, z0, x1, y0 + CRATE_FLOOR, z1),
    bb('wood', x0, y0 + CRATE_FLOOR, z0, x0 + t, y1, z1), bb('wood', x1 - t, y0 + CRATE_FLOOR, z0, x1, y1, z1),
    bb('wood', x0 + t, y0 + CRATE_FLOOR, z0, x1 - t, y1, z0 + t), bb('wood', x0 + t, y0 + CRATE_FLOOR, z1 - t, x1 - t, y1, z1),
  ];
}

/** Kinds whose generated model is replaced at runtime by the authored carcass below (no baked pictures). */
export const AUTHORED_CARCASS: ReadonlySet<string> = new Set(['magazineRack']);

const bb = (m: PartMat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PurposePart =>
  ({m, s: [x1 - x0, y1 - y0, z1 - z0], p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]});
const tilted = (m: PartMat, s: [number, number, number], p: [number, number, number], rx: number): PurposePart => ({m, s, p, rx});

// ---------------------------------------------------------------------------------------
// Magazine rack (authored carcass, 0.99 x 1.40 x 0.45 m like magazine-rack.glb)

/** Slanted tiers of the authored magazine rack: ledge top y, lean (rad, top toward -Z), backing front face z at the ledge. */
export const MAG_RACK = {
  ledges: [0.36, 0.66, 0.96] as const,
  lean: 0.3,
  backZ: -0.12,
  /** Ledge depth range and the front lip (z0..z1, height). */
  ledgeZ: [-0.205, -0.04] as [number, number],
  lipZ: [-0.054, -0.042] as [number, number],
  lipH: 0.035,
  binFloor: 0.06,
  binZ: [-0.19, 0.188] as [number, number],
  binFront: [0.19, 0.205] as [number, number],
  binLipTop: 0.27,
  /** Backing board length along its slope. */
  backingLen: 0.25,
  inner: 0.462,
};

function magazineRackCarcass(): PurposePart[] {
  const {w, h, d} = PROP_DEFS.magazineRack;
  const M = MAG_RACK;
  const out: PurposePart[] = [
    // side panels, back, base / bin floor, bin front, header
    bb('steelDark', -w / 2, 0, -d / 2, -M.inner, h, d / 2 - 0.02),
    bb('steelDark', M.inner, 0, -d / 2, w / 2, h, d / 2 - 0.02),
    bb('steelDark', -M.inner, 0.03, -d / 2, M.inner, h - 0.1, -0.205),
    bb('black', -M.inner, 0, -0.205, M.inner, M.binFloor, M.binFront[1]),
    bb('steelDark', -M.inner, M.binFloor, M.binFront[0], M.inner, M.binLipTop, M.binFront[1]),
    bb('accent', -M.inner, h - 0.1, -d / 2, M.inner, h, -0.1),
  ];
  for (const y of M.ledges) {
    out.push(bb('steelDark', -M.inner, y - 0.012, M.ledgeZ[0], M.inner, y, M.ledgeZ[1]));
    out.push(bb('steelBright', -M.inner, y, M.lipZ[0], M.inner, y + M.lipH, M.lipZ[1]));
    // backing board leaning back from the ledge (its front face passes through (y, backZ))
    const L = M.backingLen, t = 0.012, s = Math.sin(M.lean), c = Math.cos(M.lean);
    // centre: from the front-face line point at the ledge, up the slope L/2 and t/2 behind the face
    const cy = y + c * L / 2 - s * t / 2, cz = M.backZ - s * L / 2 - c * t / 2;
    out.push(tilted('panel', [2 * M.inner - 0.004, L, t], [0, cy, cz], -M.lean));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Display treatment for the purpose-prop builder

/**
 * The parts the storefront builder renders for a stocked purpose prop, derived from its original
 * part list (`parts`: purposePropShape, or the stock-shelf picture boxes when `model` = the shelf is
 * the generated shelf.glb). Picture parts are removed; a plain back board stands behind a model shelf.
 */
export function displayTreatment(kind: string, _variant: number, parts: readonly PurposePart[], o: {model: boolean}): PurposePart[] {
  switch (kind) {
    case 'stockShelf': {
      if (o.model) {
        // shelf.glb is an open steel unit; behind it (outside its 0.45 m depth by 1–4 mm, clear of the
        // diagonal brace and posts) a plain painted board replaces the old picture boxes.
        const {w, d, h} = PROP_DEFS.stockShelf;
        return [bb('panel', -w / 2 + 0.045, SHELF_TIER_Y[0] - 0.06, -d / 2 - 0.0042, w / 2 - 0.045, h - 0.04, -d / 2 - 0.0008)];
      }
      return parts.filter(p => !PICTURE_MATS.has(p.m));
    }
    case 'magazineRack': return magazineRackCarcass();
    case 'flowerStand': return parts.filter(p => p.m !== 'flowers' && p.m !== 'steelBright');
    case 'breadRack': return parts.filter(p => !PICTURE_MATS.has(p.m));
    case 'deviceWall': return parts.filter(p => !PICTURE_MATS.has(p.m)); // authored fallback only (the generated model is used when loaded)
    case 'repairBench': {
      const out: PurposePart[] = [];
      for (const p of parts) {
        if (p.m === 'stockParts') continue; // the key shop's parts box: filler boxes stand there now
        if (p.m === 'stockDevices') { out.push({...p, m: 'panel'}); continue; } // accessory rail -> plain pegboard strip
        out.push(p);
        if (p.m === 'keyBlanks') {
          // the bare pegboard (its texture no longer paints keys) + the hook rods the 3D blanks hang on
          const K = KEY_WALL;
          for (const y of K.ys) for (const x of K.xs) out.push(bb('steelBright', x - K.rod, y - K.rod, K.face, x + K.rod, y + K.rod, K.tip));
        }
      }
      return out;
    }
    case 'blenderBar': {
      const crates = new Set(fruitCrates().map(c => c.p.join(',')));
      const out: PurposePart[] = [];
      for (const p of parts) {
        if (p.m === 'fruit') continue; // the fruit picture: whole 3D fruit fills the crates now
        if (p.m === 'wood' && crates.has(p.p.join(','))) { out.push(...openCrate(p)); continue; }
        out.push(p);
      }
      return out;
    }
    default: return [...parts];
  }
}

// ---------------------------------------------------------------------------------------
// Boards (what filler stands on) and colliders (what knocked filler hits)

/** Measured decks of a generated shelf model: deck(tier, x0, z0, x1, z1) max height or NaN, nominal y. */
export interface DeckSampler {
  tiers: number[];
  deck: (tier: number, x0: number, z0: number, x1: number, z1: number) => number;
  /** Holder-local stockable rect of a tier (inside posts / brace / front lips). */
  rect: (tier: number) => {x0: number; x1: number; z0: number; z1: number};
  /** Underside of the deck above tier i (or top of the unit for the last). */
  under: (tier: number) => number;
}

/** Height filler may use on the open top deck of a shelf / rack. */
export const TOP_DECK_CLEAR = 0.3;

/**
 * Stockable rect inside the generated shelf.glb (measured on the fitted derivative): the decks span
 * about x ±0.50 / z ±0.17, the posts' inner faces stand at x ±0.477, the diagonal brace runs across
 * the back at z ≈ -0.19..-0.16 and the decks' front lips at z ≈ 0.15..0.19 (the top deck's lip rises
 * from z 0.149).
 * Task food-shelf-production (lane SHELF): the live Meshy T2.5 shelf (shelf-t25.glb) measures flat to z 0.185 on every tier, its
 * lip rising at z ≈ 0.19..0.2 (ray-cast deck profile, 2026-11-09): stock may use the deck to z 0.18 (0.332 m deep), so the
 * modelled crate, tray and binder stack (0.29..0.31 m deep at real size) fit. tests/shelfStock.test.ts checks no piece meets the model.
 */
export const SHELF_MODEL_RECT = {x0: -0.462, x1: 0.462, z0: -0.152, z1: 0.18};

/**
 * Stockable deck of tech-display-t25.glb (deviceWall, fitted 1.1 x 2.0 x 0.58; Meshy T2.5, ray-cast 2026-10-29): flat cabinet
 * top at 0.849 m; the display phones lean back on their stands to z -0.10, the pegboard face is at z -0.223 and accessory
 * cards hang off it down to 1.085 m, so stock fills the clear strip between them (z -0.22..-0.105, up to 1.08 m) under the
 * accessory shelf (underside 1.256 m). (Iteration 05 tech-display.glb: deck 0.863, rect z -0.2..0.05, top 1.16.)
 */
export const DEVICE_WALL_DECK = {y: 0.849, rect: {x0: -0.465, x1: 0.465, z0: -0.22, z1: -0.105}, top: 1.08};

/**
 * Deck heightmaps of a generated shelf model from its fitted triangles (holder-local, metres; 9
 * floats per triangle): per tier, the highest up-facing surface over a 1.5 cm grid (the AI decks
 * are uneven by several cm) and the underside of the deck above. Pure; world/shelfStock.ts feeds
 * the real shelf.glb, tests feed the same file.
 */
export function measureDecks(tris: Float32Array, tiers: readonly number[], w: number, d: number, h: number, rect = SHELF_MODEL_RECT): DeckSampler {
  const S = 0.015;
  const nx = Math.ceil(w / S) + 1, nz = Math.ceil(d / S) + 1;
  const sx = (i: number) => -w / 2 + i * S, sz = (k: number) => -d / 2 + k * S;
  const maps = tiers.map(() => new Float32Array(nx * nz).fill(NaN));
  const unders = tiers.map((_, i) => (i < tiers.length - 1 ? Infinity : h));
  const n = tris.length / 9;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2], bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5], cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx;
    const len = Math.hypot(nX, nY, nZ) || 1;
    const ny = nY / len;
    const ylo = Math.min(ay, by, cy), yhi = Math.max(ay, by, cy);
    const mx0 = Math.min(ax, bx, cx), mx1 = Math.max(ax, bx, cx), mz0 = Math.min(az, bz, cz), mz1 = Math.max(az, bz, cz);
    for (let i = 0; i < tiers.length; i++) {
      const T = tiers[i];
      // underside of the deck above tier i: lowest geometry of tier i+1's slab inside the stockable rect
      if (i < tiers.length - 1) {
        const N = tiers[i + 1];
        if (yhi > N - 0.09 && ylo < N + 0.02 && mx1 > rect.x0 && mx0 < rect.x1 && mz1 > rect.z0 && mz0 < rect.z1) unders[i] = Math.min(unders[i], Math.max(ylo, N - 0.09));
      }
      if (Math.abs(ny) < 0.6 || ylo > T + 0.08 || yhi < T - 0.06) continue;
      // rasterise the triangle's top height into the grid (any facing: a deck seen from above)
      const den = ux * vz - uz * vx;
      if (Math.abs(den) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil((mx0 + w / 2) / S)), i1 = Math.min(nx - 1, Math.floor((mx1 + w / 2) / S));
      const k0 = Math.max(0, Math.ceil((mz0 + d / 2) / S)), k1 = Math.min(nz - 1, Math.floor((mz1 + d / 2) / S));
      const m = maps[i];
      for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) {
        const px = sx(j) - ax, pz = sz(k) - az;
        const l1 = (px * vz - pz * vx) / den, l2 = (ux * pz - uz * px) / den;
        if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue;
        const y = ay + l1 * uy + l2 * vy;
        if (y < T - 0.06 || y > T + 0.08) continue;
        const q = k * nx + j;
        if (!(m[q] >= y)) m[q] = y;
      }
    }
  }
  const deck = (tier: number, x0: number, z0: number, x1: number, z1: number): number => {
    const m = maps[tier];
    if (!m) return NaN;
    // samples within half a grid step of the rect (at least the nearest one per axis)
    let j0 = Math.ceil((x0 + w / 2) / S - 0.5), j1 = Math.floor((x1 + w / 2) / S + 0.5);
    let k0 = Math.ceil((z0 + d / 2) / S - 0.5), k1 = Math.floor((z1 + d / 2) / S + 0.5);
    if (j0 > j1) j0 = j1 = Math.round(((x0 + x1) / 2 + w / 2) / S);
    if (k0 > k1) k0 = k1 = Math.round(((z0 + z1) / 2 + d / 2) / S);
    j0 = Math.max(0, j0); k0 = Math.max(0, k0); j1 = Math.min(nx - 1, j1); k1 = Math.min(nz - 1, k1);
    let best = -Infinity, miss = 0, all = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
      all++;
      const v = m[k * nx + j];
      if (Number.isNaN(v)) miss++; else if (v > best) best = v;
    }
    return all && miss <= all * 0.2 && best > -Infinity ? best : NaN;
  };
  return {
    tiers: [...tiers], deck,
    rect: () => ({...rect}),
    under: i => (Number.isFinite(unders[i]) ? unders[i] : (tiers[i + 1] ?? h) - 0.05),
  };
}

/**
 * Boards of a stocked holder (holder-local). `deck`: measured decks of the generated shelf model (stockShelf, and the plain storage
 * 'shelf' kind, which renders the same shelf.glb at the same footprint: world/builder.ts MODEL_FOR).
 */
export function stockBoards(kind: string, variant: number, o: {deck?: DeckSampler | null} = {}): Board[] {
  switch (kind) {
    // task food-shelf-production (lane SHELF): storage shelving takes the measured decks of its model only (its procedural fallback
    // box has no boards to stand stock on)
    case 'shelf': return o.deck ? stockBoards('stockShelf', variant, o) : [];
    case 'stockShelf': {
      const T = SHELF_TIER_Y;
      if (o.deck) {
        const D = o.deck;
        return T.map((y, i) => {
          const r = D.rect(i);
          return {...r, y, top: i < T.length - 1 ? D.under(i) - 0.012 : y + TOP_DECK_CLEAR, deck: (x0, z0, x1, z1) => D.deck(i, x0, z0, x1, z1), mode: 'rows' as const};
        });
      }
      // authored frame (gen/purposeShapes.ts shelfFrame): posts 35 mm at the corners, 25 mm boards, a front
      // lip 55 mm below each board's front edge, back panel at z -0.215.
      const {w, d} = PROP_DEFS.stockShelf;
      const x = w / 2 - 0.04;
      return T.map((y, i) => ({x0: -x, x1: x, z0: -d / 2 + 0.014, z1: d / 2 - 0.02, y, top: i < T.length - 1 ? T[i + 1] - 0.058 : y + TOP_DECK_CLEAR, mode: 'rows' as const}));
    }
    case 'snackRack':
      return PURPOSE_SURFACES.snackRack.map(s => ({x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, y: s.y, top: s.y + s.clear, mode: 'rows' as const}));
    case 'shopCooler':
      return SHOP_COOLER_SURFACES.map(s => ({x0: s.x0 + 0.004, x1: s.x1 - 0.004, z0: s.z0 + 0.006, z1: s.z1 - 0.006, y: s.y, top: s.y + s.clear - 0.01, mode: 'rows' as const}));
    case 'breadRack': {
      const trays = [0.18, 0.52, 0.86, 1.2, 1.54];
      const {w, d, h} = PROP_DEFS.breadRack;
      return trays.map((y, i) => ({x0: -w / 2 + 0.04, x1: w / 2 - 0.04, z0: -d / 2 + 0.035, z1: d / 2 - 0.035, y, top: (trays[i + 1] ?? h) - 0.026, mode: 'rows' as const}));
    }
    case 'flowerStand':
      return [
        {x0: -0.7, x1: 0.7, z0: 0.08, z1: 0.35, y: 0.3, top: 1.4, mode: 'spots', spots: [[-0.48, 0.215], [-0.16, 0.215], [0.16, 0.215], [0.48, 0.215]]},
        {x0: -0.7, x1: 0.7, z0: -0.14, z1: 0.08, y: 0.6, top: 1.6, mode: 'spots', spots: [[-0.48, -0.03], [-0.16, -0.03], [0.16, -0.03], [0.48, -0.03]]},
        {x0: -0.7, x1: 0.7, z0: -0.35, z1: -0.14, y: 0.85, top: 1.8, mode: 'spots', spots: [[-0.45, -0.25], [0, -0.25], [0.45, -0.25]]},
      ];
    case 'magazineRack': {
      const M = MAG_RACK;
      const boards: Board[] = M.ledges.map(y => ({x0: -M.inner + 0.01, x1: M.inner - 0.01, z0: M.backZ, z1: M.lipZ[0] - 0.003, y, top: y + 0.29, mode: 'lean' as const, lean: M.lean, back: M.backZ}));
      boards.push({x0: -M.inner + 0.012, x1: M.inner - 0.012, z0: M.binZ[0], z1: M.binZ[1], y: M.binFloor, top: M.ledges[0] - 0.02, mode: 'flat'});
      return boards;
    }
    case 'repairBench': {
      if (((variant % 2) + 2) % 2 === 1) return [{x0: 0.46, x1: 0.78, z0: -0.005, z1: 0.27, y: 0.9, top: 1.25, mode: 'rows'}];
      const K = KEY_WALL;
      return [
        {x0: 0.42, x1: 0.78, z0: -0.02, z1: 0.27, y: 0.9, top: 1.3, mode: 'rows'},
        // the key wall: blanks on the hooks (holder category 'parts' is the bench's boxes)
        {x0: -0.76, x1: 0.76, z0: K.face, z1: K.tip, y: K.ys[K.ys.length - 1] - 0.08, top: K.ys[0] + 0.01, mode: 'hang', rod: K.rod,
          hooks: K.ys.flatMap(y => K.xs.map(x => [x, y] as [number, number])), category: 'keys'},
      ];
    }
    case 'blenderBar':
      // inside each open crate, fruit heaped a little over the rim; one fruit per crate (Board.variant)
      return fruitCrates().map((c, i) => {
        const x0 = c.p[0] - c.s[0] / 2, z0 = c.p[2] - c.s[2] / 2, y0 = c.p[1] - c.s[1] / 2;
        return {x0: x0 + CRATE_WALL + 0.002, x1: x0 + c.s[0] - CRATE_WALL - 0.002, z0: z0 + CRATE_WALL + 0.002, z1: z0 + c.s[2] - CRATE_WALL - 0.002,
          y: y0 + CRATE_FLOOR, top: y0 + c.s[1] + 0.05, mode: 'rows' as const, variant: i, full: true};
      });
    case 'deviceWall': {
      if (o.deck) {
        const D = o.deck, r = D.rect(0);
        return [{...r, y: D.tiers[0], top: DEVICE_WALL_DECK.top, deck: (x0, z0, x1, z1) => D.deck(0, x0, z0, x1, z1), mode: 'rows'}];
      }
      // authored fallback (gen/purposeShapes.ts deviceWall, scaled to the footprint): the base cabinet top
      const {w, d, h} = PROP_DEFS.deviceWall;
      const kx = w / 1.5, ky = h / 2.2, kz = d / 0.35;
      return [{x0: -0.72 * kx, x1: 0.72 * kx, z0: -0.135 * kz, z1: 0.165 * kz, y: 0.45 * ky, top: 0.62 * ky - 0.01, mode: 'rows'}];
    }
    default:
      return [];
  }
}

/** Collision boxes (holder-local) knocked filler / items / chunks hit on a stocked holder, besides its loot-surface slabs. */
export function stockColliders(kind: string, variant: number, boards: readonly Board[]): Box3Like[] {
  const out: Box3Like[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => out.push({min: [x0, y0, z0], max: [x1, y1, z1]});
  switch (kind) {
    case 'shelf':
    case 'stockShelf': {
      const {w, d, h} = PROP_DEFS.stockShelf;
      // Full-depth boards (the loot surfaces only cover the front band) at the measured deck height,
      // split into strips so an uneven generated deck is followed; plus the back board. 3 cm thick:
      // the stock on the board below stays clear of it (Board.top), fast pieces are caught by the
      // swept test in physics/fillerStock.ts.
      for (const b of boards) {
        const n = 6;
        for (let k = 0; k < n; k++) {
          const xa = -w / 2 + 0.03 + (w - 0.06) * k / n, xb = -w / 2 + 0.03 + (w - 0.06) * (k + 1) / n;
          let top = b.y;
          if (b.deck) { const v = b.deck(Math.max(xa, b.x0), b.z0, Math.min(xb, b.x1), b.z1); if (Number.isFinite(v)) top = v; }
          box(xa, top - 0.03, -d / 2 + 0.01, xb, top, d / 2 - 0.01);
        }
      }
      // the plain back board stands behind a stock shelf only (displayTreatment); storage shelving is the open unit against its wall
      if (kind === 'stockShelf') box(-w / 2 + 0.045, SHELF_TIER_Y[0] - 0.06, -d / 2 - 0.0042, w / 2 - 0.045, h - 0.04, -d / 2 + 0.02);
      break;
    }
    case 'snackRack': {
      const {w, d, h} = PROP_DEFS.snackRack;
      for (const b of boards) box(-w / 2 + 0.02, b.y - 0.012, -d / 2 + 0.012, w / 2 - 0.02, b.y, d / 2 - 0.006);
      box(-w / 2 + 0.02, 0.2, -d / 2, w / 2 - 0.02, h, -d / 2 + 0.012);
      break;
    }
    case 'breadRack': {
      const {w, d} = PROP_DEFS.breadRack;
      for (const b of boards) box(-w / 2 + 0.03, b.y - 0.02, -d / 2 + 0.03, w / 2 - 0.03, b.y, d / 2 - 0.03);
      break;
    }
    case 'flowerStand':
      box(-0.7, 0, -0.35, 0.7, 0.3, 0.35);
      box(-0.7, 0.3, -0.35, 0.7, 0.6, 0.08);
      box(-0.7, 0.6, -0.35, 0.7, 0.85, -0.14);
      break;
    case 'magazineRack': {
      const {w, h, d} = PROP_DEFS.magazineRack;
      const M = MAG_RACK;
      box(-w / 2, 0, -d / 2, -M.inner, h, d / 2 - 0.02);
      box(M.inner, 0, -d / 2, w / 2, h, d / 2 - 0.02);
      box(-M.inner, 0.03, -d / 2, M.inner, h - 0.1, -0.205);
      box(-M.inner, 0, -0.205, M.inner, M.binFloor, M.binFront[1]);
      box(-M.inner, M.binFloor, M.binFront[0], M.inner, M.binLipTop, M.binFront[1]);
      for (const y of M.ledges) {
        box(-M.inner, y - 0.012, M.ledgeZ[0], M.inner, y, M.ledgeZ[1]);
        box(-M.inner, y, M.lipZ[0], M.inner, y + M.lipH, M.lipZ[1]);
        // slanted backing as three steps behind its front face
        for (let k = 0; k < 3; k++) {
          const s0 = (k / 3) * M.backingLen, s1 = ((k + 1) / 3) * M.backingLen;
          const zf = M.backZ - Math.sin(M.lean) * s1;
          box(-M.inner, y + Math.cos(M.lean) * s0, -0.205, M.inner, y + Math.cos(M.lean) * s1, zf);
        }
      }
      break;
    }
    case 'repairBench':
      box(-0.8, 0, -0.3, 0.8, 0.9, 0.3);
      box(-0.8, 0.9, -0.3, 0.8, 2.0, -0.28);
      if (((variant % 2) + 2) % 2 === 0) box(-0.76, 1.0, -0.28, 0.76, 1.94, KEY_WALL.face); // key wall pegboard
      break;
    case 'blenderBar': {
      const {w, d} = PROP_DEFS.blenderBar;
      const {top: t, shelfY} = KITCHEN_LINE;
      box(-w / 2, 0, -d / 2, w / 2, t, d / 2); // counter
      box(-w / 2, t, -d / 2, w / 2, shelfY - 0.03, -d / 2 + 0.01); // splash back
      box(-w / 2, shelfY - 0.03, -d / 2, w / 2, shelfY, 0.01); // over-shelf
      for (const x of [-0.72, -0.48, -0.24]) box(x - 0.08, t, -0.1, x + 0.08, t + 0.39, 0.06); // blenders
      for (const c of fruitCrates()) for (const p of openCrate(c)) box(p.p[0] - p.s[0] / 2, p.p[1] - p.s[1] / 2, p.p[2] - p.s[2] / 2, p.p[0] + p.s[0] / 2, p.p[1] + p.s[1] / 2, p.p[2] + p.s[2] / 2);
      break;
    }
    case 'deviceWall': {
      const {w, d, h} = PROP_DEFS.deviceWall;
      const top = boards[0]?.y ?? DEVICE_WALL_DECK.y;
      box(-w / 2, 0, -d / 2 + 0.03, w / 2, top, d / 2 - 0.03); // cabinet
      box(-w / 2, 0, -d / 2, w / 2, h, -0.235); // back panel / pegboard
      // the display phones on their stands (T2.5 model: z -0.07..0.11) — not on a bare unit (task studio-skywalk-variety-20261107-231448-01,
      // lane MERCH: Skyways version 4 stands them on the deck as separate loose props, gen/skyways/skywaysMerchSplit.ts)
      if (variant !== MERCH_BARE_VARIANT) box(-w / 2 + 0.03, top, -0.075, w / 2 - 0.03, top + 0.21, 0.12);
      box(-w / 2 + 0.03, 1.25, -0.235, w / 2 - 0.03, 1.28, -0.045); // accessory shelf (T2.5 model: 1.256..1.278, z -0.17..-0.05)
      break;
    }
    default:
      break;
  }
  return out;
}

/** World AABBs of holder-local boxes for a placement (quarter-turn yaw only). */
export function toWorldBoxes(p: {x: number; y: number; z: number; rot: number}, boxes: readonly Box3Like[]): {min: V3; max: V3}[] {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return boxes.map(b => {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const lx of [b.min[0], b.max[0]]) for (const lz of [b.min[2], b.max[2]]) {
      const X = p.x + lx * c + lz * s, Z = p.z - lx * s + lz * c;
      min[0] = Math.min(min[0], X); max[0] = Math.max(max[0], X);
      min[2] = Math.min(min[2], Z); max[2] = Math.max(max[2], Z);
    }
    min[1] = p.y + b.min[1]; max[1] = p.y + b.max[1];
    return {min, max};
  });
}
