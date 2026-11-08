// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): carving of THE SURVIVOR MARKET version 2 — the dense container settlement
// (gen/market/v2/frame.ts) into ONE Kit of three storeys (canvas = grid cells: the crop origin is fixed at 0, 0). Pure data; the index
// links, rails, dresses, records and validates it.
//
// Every column of the settlement is one of (absolute heights, SETTLE.bases / cont / roofY):
//   - a LANE / ALLEY / the YARD: storey 0 open from the ground to the shed roof (a bridge overhead lowers it to a container's height);
//   - a ground CONTAINER: storey 0 [0, 2.6] (a shop, the kitchen, the bunk room, the workshop, a service, a home), then either the
//     CATWALK above it (storey 1, [2.95, roof]: the ring round a block's upper container, the front / back row catwalks) or an UPPER
//     CONTAINER (storey 1 [2.95, 5.5]: a home, or a closed container left solid) with its ROOFTOP (storey 2, [5.85, roof]) above;
//   - a BRIDGE (storey 1) over a lane, a STAIR run (storeys 0 + 1) beside a block end.
// So no solid column ever rises from a container top to the roof (version 1's "one big box"): every stack steps back (ground shops,
// the catwalk, the upper containers, the rooftop rails) and the lanes between them stay open to the roof.

import {CELL, SOLID, VOID, type Grid} from '../../grid';
import {Kit, TUN, type TrenchCells} from '../../stationKit';
import {STAIR, layStairRun, type StairFlight} from '../../traversal';
import {SINGLE_BED_CELLS, TRENCH_DEPTH, type Area, type Rect, type Side} from '../../stationTypes';
import type {Rng} from '../../../core/rng';
import type {MarketStallId} from '../marketTypes';
import {SETTLE, settleRows, type SettleFrame} from './frame';

/** Open stair: a large headroom capped by the cell ceiling (the shed roof): the version-1 stair's rule, capped (Ramp.capCeil). */
export const OPEN_HEADROOM = 40;

/** What a container is used for. */
export type ContainerUse = 'shop' | 'kitchen' | 'bunks' | 'workshop' | 'water' | 'latrine' | 'generator' | 'storage' | 'tea' | 'repair' | 'home';

/** One carved container (its interior, the opening onto its lane / catwalk). */
export interface ContainerCarve {
  id: number;
  area: number;
  level: 0 | 1;
  /** Interior rect (world cells). */
  rect: Rect;
  /** World side of the interior its opening is on. */
  face: Side;
  /** The opening's cells (world; the wall row) and whether it is a wide shopfront / counter front / roll-up. */
  door: Rect;
  wide: boolean;
  use: ContainerUse;
  stall?: MarketStallId;
  /** Where it stands: the front / back row, a middle block, or an upper container (homes) and the block index. */
  row: 'front' | 'back' | 'block' | 'upper';
  block?: number;
}

/** A middle block: its x span (world cells), the ring catwalk (storey 1), the upper container footprint (incl. walls), the rooftop. */
export interface BlockCarve { x0: number; x1: number; ring: number; upper: Rect; roof: number }

export interface SettleCarve {
  f: SettleFrame;
  rows: ReturnType<typeof settleRows>;
  bases: readonly [number, number, number];
  bed: Rect;
  trench: TrenchCells;
  platform: Area;
  gates: {area: number; rect: Rect; platformDoor: Rect; laneDoor: Rect}[];
  lanes: {market: Area; back: Area; west: Area; cross: Area; yard: Area; east: Area};
  blocks: BlockCarve[];
  /** Front / back row catwalks (storey 1) and rooftops (storey 2). */
  frontDeck: {catwalk: Area; roof: Area};
  backDeck: {catwalk: Area; roof: Area};
  bridges: number[];
  containers: ContainerCarve[];
  /** Stair runs (storeys 0 + 1): their area, rect, flights (k.flights ids) and the block they climb to. */
  stairs: {area: number; rect: Rect; flights: number[]; block: number}[];
  /** The upper containers left SOLID (closed): their footprints incl. walls (world cells), storey 1 (ladders climb these walls). */
  closed: Rect[];
  /** World x toward the canonical east: +1, or -1 when mirrored. */
  eastSign: 1 | -1;
}

/** Why the last attempts failed (QA / tests). */
export const SETTLE_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { SETTLE_CARVE_FAILS[why] = (SETTLE_CARVE_FAILS[why] ?? 0) + 1; return null; };

/**
 * Splits the run [a, b) (b = the wall cell after the last interior) into container interiors with one wall cell between neighbours,
 * widths within [lo, hi], near `avg`; null when no split fits.
 */
export function fillRun(a: number, b: number, lo: number, hi: number, avg: number, rng: Rng): number[] | null {
  const L = b - a;
  if (L < lo) return null;
  const k0 = Math.max(1, Math.round((L + 1) / (avg + 1)));
  for (const k of [k0, k0 + 1, k0 - 1, k0 + 2]) {
    if (k < 1) continue;
    const inner = L - (k - 1);
    if (inner < k * lo || inner > k * hi) continue;
    const w = new Array<number>(k).fill(Math.floor(inner / k));
    for (let i = 0; i < inner % k; i++) w[i]++;
    // a little seeded unevenness between neighbours (sums kept)
    for (let i = 0; i + 1 < k; i++) {
      const d = rng.int(-1, 1);
      if (w[i] + d >= lo && w[i] + d <= hi && w[i + 1] - d >= lo && w[i + 1] - d <= hi) { w[i] += d; w[i + 1] -= d; }
    }
    return rng.chance(0.5) ? w.reverse() : w;
  }
  return null;
}

/** Sets a rect of one storey's grid back to rock (a container's walls inside a catwalk deck). */
function solidify(g: Grid, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = g.idx(x, y);
    g.cells[i] = SOLID; g.area[i] = -1; g.ceil[i] = 0; g.floor[i] = 0;
  }
}

/** Carves the whole settlement into a fresh 3-storey kit; null when the program does not fit (the caller re-rolls). */
export function carveSettlement(k: Kit, f: SettleFrame, rng: Rng): SettleCarve | null {
  const W = k.g.w, H = k.g.h;
  const M = (r: Rect): Rect => (f.mirror ? {x: W - r.x - r.w, y: r.y, w: r.w, h: r.h} : r);
  const g0 = k.grid(0), g1 = k.grid(1);
  const S = SETTLE, roof = S.roofY, [B0, B1] = S.bases;
  const c0 = B0 + S.cont, c1 = B1 + S.cont; // ground / upper container ceilings
  const R = settleRows(f);
  if (R.end + 2 > H) return fail('rows beyond the canvas');
  const X0 = S.x0, X1 = S.x1;
  const lvl = (L: 1 | 2, label: string, extra: Record<string, unknown> = {}) => ({level: L, floorY: S.bases[L], label, publicSpace: false, ...extra});

  // --- 1. Track bed + side platform (edge N: the track 2.0 m north of the platform edge): version 1's, unchanged -----------------
  const bed = M({x: S.bedX, y: S.bedY, w: f.Lp + 2 * TUN, h: SINGLE_BED_CELLS});
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) {
    const i = g0.idx(x, y);
    g0.cells[i] = VOID; g0.ceil[i] = roof; g0.floor[i] = -TRENCH_DEPTH;
  }
  g0.voidFloor = -TRENCH_DEPTH;
  const pRect = M({x: S.bedX + TUN, y: R.p0, w: f.Lp, h: f.Pd});
  const trench: TrenchCells = {x0: bed.x, x1: bed.x + bed.w, y0: bed.y, y1: R.p0, px0: pRect.x, px1: pRect.x + pRect.w, tracks: [R.p0 * CELL - 2.0], third: [-1], columns: false, ceil: roof};
  k.trenches.push(trench);
  const platform = k.addArea(pRect, 'platform', 'platform', roof, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;
  const pxc0 = S.bedX + TUN, pxc1 = pxc0 + f.Lp; // canonical platform span

  // --- 2. Lanes, alleys and the yard (storey 0, open to the roof) ----------------------------------------------------------------
  const md = f.mid;
  const ax0 = X0 + md.west, ax1 = ax0 + md.a, bx0 = ax1 + md.cross, bx1 = bx0 + md.b, yx0 = bx1, yx1 = yx0 + md.yard, cx0 = yx1, cx1 = cx0 + md.c;
  if (cx1 + md.east !== X1) return fail('middle row does not close');
  const lane = (r: Rect, label: string) => k.addArea(M(r), 'concourse', 'concourse', roof, -1, {label, publicSpace: true});
  const market = lane({x: X0, y: R.lf0, w: X1 - X0, h: f.laneF}, 'Market Lane');
  const back = lane({x: X0, y: R.lb0, w: X1 - X0, h: f.laneB}, 'Back Lane');
  const west = lane({x: X0, y: R.m0, w: md.west, h: S.blockD}, 'Ladder Alley');
  const cross = lane({x: ax1, y: R.m0, w: md.cross, h: S.blockD}, 'Lantern Alley');
  const yard = lane({x: yx0, y: R.m0, w: md.yard, h: S.blockD}, 'The Yard');
  const east = lane({x: cx1, y: R.m0, w: md.east, h: S.blockD}, 'Rail Alley');

  const containers: ContainerCarve[] = [];
  const pendingDoors: (() => void)[] = [];
  /** A container interior (canonical rect) on storey L, its opening on `face` (canonical side) of `width` cells (centred + `shift`). */
  const container = (cr: Rect, L: 0 | 1, face: 'N' | 'S', width: number, use: ContainerUse, row: ContainerCarve['row'], onto: Area, opts: {stall?: MarketStallId; block?: number; wide?: boolean; shift?: number; label?: string} = {}): ContainerCarve => {
    const r = M(cr);
    const type = use === 'shop' ? 'shop' : use === 'workshop' ? 'utility' : use === 'kitchen' || use === 'bunks' || use === 'home' ? 'crew-room' : 'storage';
    const a = k.addArea(r, 'room', type, L ? c1 : c0, onto.id, L ? lvl(L, opts.label ?? 'Home') : {label: opts.label ?? 'Container', publicSpace: false});
    if (use === 'workshop') a.purpose = 'workshop';
    const w = Math.max(2, Math.min(width, cr.w - 2));
    const dx = Math.max(cr.x + 1, Math.min(cr.x + cr.w - 1 - w, cr.x + Math.floor((cr.w - w) / 2) + (opts.shift ?? 0)));
    const door = M({x: dx, y: face === 'N' ? cr.y - 1 : cr.y + cr.h, w, h: 1});
    const c: ContainerCarve = {id: containers.length, area: a.id, level: L, rect: r, face, door, wide: opts.wide ?? false, use, row, ...(opts.stall ? {stall: opts.stall} : {}), ...(opts.block !== undefined ? {block: opts.block} : {})};
    containers.push(c);
    pendingDoors.push(() => { k.carveDoor(door, onto, a, S.doorH, false); });
    return c;
  };

  // --- 3. The front row: deep containers between two gates (storey 0), facing the Market Lane --------------------------------------
  const fy0 = R.pw + 1, fh = S.rowD - 2; // interior rows
  const gates: SettleCarve['gates'] = [];
  const g = [...f.gates].sort((p, q) => p.x - q.x);
  for (const gt of g) if (gt.x < pxc0 + 1 || gt.x + gt.w > pxc1 - 1) return fail('a gate off the platform');
  const frontRuns: [number, number][] = [[X0, g[0].x - 1], [g[0].x + g[0].w + 1, g[1].x - 1], [g[1].x + g[1].w + 1, X1]];
  const frontSlots: Rect[] = [];
  for (const [a, b] of frontRuns) {
    const ws = fillRun(a, b, 7, 16, 11, rng);
    if (!ws) return fail('front row run does not split');
    let x = a;
    for (const w of ws) { frontSlots.push({x, y: fy0, w, h: fh}); x += w + 1; }
  }
  for (const gt of g) {
    const rect = M({x: gt.x, y: fy0, w: gt.w, h: fh});
    const a = k.addArea(rect, 'passage', 'passage', c0, platform.id, {label: 'Market gate'});
    const platformDoor = M({x: gt.x, y: R.pw, w: gt.w, h: 1}), laneDoor = M({x: gt.x, y: R.pw + S.rowD - 1, w: gt.w, h: 1});
    gates.push({area: a.id, rect, platformDoor, laneDoor});
    pendingDoors.push(() => { k.carveDoor(platformDoor, platform, a, S.gateH, false); k.carveDoor(laneDoor, market, a, S.gateH, false); });
  }
  // the walk-in shops: the widest front containers (>= 9 cells: a 3 m counter + the trader's 1.2 m way in), seeded among equals
  const shopSlots = frontSlots.map((r, i) => ({r, i, key: r.w + rng.next() * 0.5})).filter(s => s.r.w >= 9).sort((p, q) => q.key - p.key).slice(0, f.front.length).sort((p, q) => p.r.x - q.r.x);
  const backStalls = [...f.back, ...f.front.slice(shopSlots.length)];
  const frontOther: ContainerUse[] = rng.shuffle(['tea', 'storage', 'home', 'repair'] as ContainerUse[]);
  frontSlots.forEach((r, i) => {
    const si = shopSlots.findIndex(s => s.i === i);
    if (si >= 0) container(r, 0, 'S', rng.int(4, 5), 'shop', 'front', market, {stall: f.front[si], wide: true, shift: rng.int(-1, 1)});
    else {
      const use = frontOther.shift() ?? 'storage';
      container(r, 0, 'S', use === 'tea' || use === 'repair' ? r.w - 2 : 2, use, 'front', market, {wide: use === 'tea' || use === 'repair'});
    }
  });

  // --- 4. The middle blocks: back-to-back containers (storey 0) -------------------------------------------------------------------
  const blockXs: [number, number][] = [[ax0, ax1], [bx0, bx1], [cx0, cx1]];
  const midUses: ContainerUse[] = rng.shuffle(['water', 'latrine', 'generator', 'storage', 'storage', 'home', 'home', 'tea', 'repair', 'storage', 'home', 'storage'] as ContainerUse[]);
  const blockN = R.m0 + 1, blockS = R.m0 + 7;
  blockXs.forEach(([x0, x1], bi) => {
    for (const [y, face, onto] of [[blockN, 'N', market], [blockS, 'S', back]] as const) {
      const ws = fillRun(x0 + 1, x1 - 1, S.blockCont, 12, 7, rng) ?? [x1 - x0 - 2];
      let x = x0 + 1;
      for (const w of ws) {
        const use = midUses.shift() ?? 'storage';
        container({x, y, w, h: 5}, 0, face, use === 'tea' || use === 'repair' ? w - 2 : 2, use, 'block', onto, {block: bi, wide: use === 'tea' || use === 'repair'});
        x += w + 1;
      }
    }
  });

  // --- 5. The back row: the communal kitchen opposite the yard, the bunk room, the workshop, two counter-fronted shops --------------
  const by0 = R.b0 + 1;
  const yc = Math.round((yx0 + yx1) / 2), kx0 = yc - 7, kx1 = yc + 7;
  // the workshop: a wide fixed slot at the outer end of the longer run (its clear middle floor stores the station's common fuel plan)
  const WS = 13, wsLeft = kx0 - 1 - X0 >= X1 - kx1 - 1;
  const wsSlot: Rect = {x: wsLeft ? X0 : X1 - WS, y: by0, w: WS, h: fh};
  const left = fillRun(wsLeft ? X0 + WS + 1 : X0, kx0 - 1, 8, 14, 11, rng), right = fillRun(kx1 + 1, wsLeft ? X1 : X1 - WS - 1, 8, 14, 11, rng);
  if (!left || !right) return fail('back row run does not split');
  const backSlots: Rect[] = [];
  { let x = wsLeft ? X0 + WS + 1 : X0; for (const w of left) { backSlots.push({x, y: by0, w, h: fh}); x += w + 1; } }
  const kitchenSlot = {x: kx0, y: by0, w: kx1 - kx0, h: fh};
  { let x = kx1 + 1; for (const w of right) { backSlots.push({x, y: by0, w, h: fh}); x += w + 1; } }
  if (backSlots.filter(r => r.w >= 9).length < backStalls.length) return fail('back row too narrow for its shops');
  container(kitchenSlot, 0, 'N', kitchenSlot.w - 2, 'kitchen', 'back', back, {wide: true, label: 'Communal kitchen'});
  container(wsSlot, 0, 'N', 6, 'workshop', 'back', back, {wide: true, label: 'Workshop'});
  // shops on the widest slots, the bunk room next, the rest storage / homes
  const order = backSlots.map((r, i) => ({r, i, key: r.w + rng.next() * 0.5})).sort((p, q) => q.key - p.key);
  const backUse = new Map<number, {use: ContainerUse; stall?: MarketStallId}>();
  backStalls.forEach((id, j) => backUse.set(order[j].i, {use: 'shop', stall: id}));
  for (const use of ['bunks', 'storage', 'home', 'storage', 'home'] as ContainerUse[]) {
    const s = order.find(o => !backUse.has(o.i));
    if (s) backUse.set(s.i, {use});
  }
  backSlots.forEach((r, i) => {
    const u = backUse.get(i) ?? {use: 'storage' as ContainerUse};
    const wide = u.use === 'shop' || u.use === 'workshop';
    // (a shop's wide shopfront leaves a cell of wall at each side inside: its side shelving stands there)
    container(r, 0, 'N', wide ? (u.use === 'shop' ? r.w - 4 : Math.min(6, r.w - 2)) : u.use === 'bunks' ? 3 : 2, u.use, 'back', back, {wide, ...(u.stall ? {stall: u.stall} : {}), label: u.use === 'workshop' ? 'Workshop' : u.use === 'bunks' ? 'Bunk room' : undefined});
  });

  // --- 6. Storey 1: catwalks, upper containers (homes / closed), bridges ------------------------------------------------------------
  const closed: Rect[] = [];
  const frontCat = k.addArea(M({x: X0, y: R.pw + S.rowD - S.cat, w: X1 - X0, h: S.cat}), 'concourse', 'concourse', roof, -1, lvl(1, 'Front catwalk', {role: 'catwalk'}));
  const backCat = k.addArea(M({x: X0, y: R.b0, w: X1 - X0, h: S.cat}), 'concourse', 'concourse', roof, -1, lvl(1, 'Back catwalk', {role: 'catwalk'}));
  /** The upper containers over a row: homes (a door onto the catwalk) or closed (left solid), interior rows [y0, y0 + 5). */
  const uppers = (x0: number, x1: number, y0: number, face: 'N' | 'S', cat: Area, row: 'upper', block?: number) => {
    const ws = fillRun(x0, x1, SETTLE.homeCont[0], SETTLE.homeCont[1] + 4, 10, rng);
    if (!ws) return false;
    let x = x0;
    ws.forEach((w, i) => {
      // about two in three are lived in (the rest stay closed containers: storage nobody opens)
      if (rng.chance(0.68) || (block !== undefined && i === 0)) container({x, y: y0, w, h: 5}, 1, face, 2, 'home', row, cat, {...(block !== undefined ? {block} : {}), shift: rng.int(-2, 2)});
      else closed.push(M({x: x - 1, y: y0 - 1, w: w + 2, h: 7}));
      x += w + 1;
    });
    return true;
  };
  if (!uppers(X0, X1, R.pw + 1, 'S', frontCat, 'upper')) return fail('front uppers');
  if (!uppers(X0, X1, R.b0 + S.cat + 1, 'N', backCat, 'upper')) return fail('back uppers');
  const blocks: BlockCarve[] = [];
  for (const [bi, [x0, x1]] of blockXs.entries()) {
    const ring = k.addArea(M({x: x0, y: R.m0, w: x1 - x0, h: S.blockD}), 'concourse', 'concourse', roof, -1, lvl(1, 'Catwalk', {role: 'catwalk'}));
    const up: Rect = {x: x0 + S.cat, y: R.m0 + S.cat, w: x1 - x0 - 2 * S.cat, h: 7};
    if (up.w < 9) return fail('block too narrow for an upper container');
    solidify(g1, M(up));
    // one or two homes in it (doors onto the north or south catwalk), never closed (the block's rooftop ladder needs a wall anyway)
    const inner = up.w - 2, two = inner >= 13;
    const ws = two ? [Math.floor((inner - 1) / 2), inner - 1 - Math.floor((inner - 1) / 2)] : [inner];
    let x = up.x + 1;
    ws.forEach((w, i) => {
      const face: 'N' | 'S' = two ? (i === 0 ? 'N' : 'S') : rng.chance(0.5) ? 'N' : 'S';
      container({x, y: up.y + 1, w, h: 5}, 1, face, 2, 'home', 'upper', k.areas[ring.id], {block: bi, shift: rng.int(-1, 1)});
      x += w + 1;
    });
    blocks.push({x0: M({x: x0, y: 0, w: x1 - x0, h: 1}).x, x1: M({x: x0, y: 0, w: x1 - x0, h: 1}).x + (x1 - x0), ring: ring.id, upper: M(up), roof: -1});
  }

  // bridges over the lanes (storey 1, 3 cells wide): the Market Lane to blocks A and C (and B when it is wide), the Back Lane to blocks
  // B and C, the cross alley between blocks A and B; the lane under a bridge is covered at a container's height
  const bridges: number[] = [];
  const bridge = (cr: Rect, label: string) => {
    const r = M(cr);
    const a = k.addArea(r, 'concourse', 'concourse', roof, -1, lvl(1, label, {role: 'crossover'}));
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g0.ceil[g0.idx(x, y)] = c0;
    bridges.push(a.id);
  };
  const midX = (x0: number, x1: number, j: number) => Math.round((x0 + x1) / 2 - 1.5 + j);
  bridge({x: midX(ax0, ax1, rng.int(-2, 2)), y: R.lf0, w: 3, h: f.laneF}, 'Bridge');
  bridge({x: midX(cx0, cx1, rng.int(-2, 2)), y: R.lf0, w: 3, h: f.laneF}, 'Bridge');
  bridge({x: midX(bx0, bx1, rng.int(-3, -1)), y: R.lb0, w: 3, h: f.laneB}, 'Bridge');
  bridge({x: midX(cx0, cx1, rng.int(-2, 2)), y: R.lb0, w: 3, h: f.laneB}, 'Bridge');
  bridge({x: ax1, y: R.m0 + 5, w: md.cross, h: 3}, 'Bridge');

  // --- 7. Storey 2: the rooftops over the upper containers ------------------------------------------------------------------------
  const frontRoof = k.addArea(M({x: X0, y: R.pw, w: X1 - X0, h: S.rowD - S.cat}), 'concourse', 'concourse', roof, -1, lvl(2, 'Rooftops', {role: 'overlook'}));
  const backRoof = k.addArea(M({x: X0, y: R.b0 + S.cat, w: X1 - X0, h: S.rowD - S.cat}), 'concourse', 'concourse', roof, -1, lvl(2, 'Rooftops', {role: 'overlook'}));
  for (const b of blocks) b.roof = k.addArea(b.upper, 'concourse', 'concourse', roof, -1, lvl(2, 'Rooftop', {role: 'overlook'})).id;

  // --- 8. The stairs (storeys 0 + 1): the yard's main stair beside block B's east end (rising south to its ring), the west alley's
  // beside block A's west end (rising north). Each run has a 1.5 m top landing beside the ring (the 1.2 x 1.8 m landing rule).
  const spec = {...STAIR, headroom: OPEN_HEADROOM};
  const stairs: SettleCarve['stairs'] = [];
  const run = (cr: Rect, top: 'lo' | 'hi', block: number, label: string): boolean => {
    const r = M(cr);
    const a = k.addArea(r, 'passage', 'stair-core', roof, -1, {also: [1], role: 'stair', publicSpace: true, label});
    let fl: StairFlight[];
    try { fl = layStairRun([g0, g1], r, a.id, 'z', top, B1, B0, spec); } catch { return false; }
    const flights: number[] = [];
    for (const q of fl) { q.id = k.flights.length; flights.push(q.id); k.flights.push(q); g0.ramps[q.ramp].capCeil = true; }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = g0.idx(x, y); g0.ceil[i] = roof; g1.ceil[i] = roof; }
    stairs.push({area: a.id, rect: r, flights, block});
    return true;
  };
  const len = Math.ceil((planLen(B1 - B0) + STAIR.topLanding) / CELL - 1e-6) + 1;
  if (!run({x: bx1, y: R.m0 + S.blockD - len, w: 3, h: len}, 'hi', 1, 'Yard stairs')) return fail('yard stair');
  if (!run({x: ax0 - 3, y: R.m0, w: 3, h: len}, 'lo', 0, 'Alley stairs')) return fail('alley stair');

  // --- 9. Openings ---------------------------------------------------------------------------------------------------------------
  for (const d of pendingDoors) d();

  return {
    f, rows: R, bases: S.bases, bed, trench, platform, gates, lanes: {market, back, west, cross, yard, east}, blocks,
    frontDeck: {catwalk: frontCat, roof: frontRoof}, backDeck: {catwalk: backCat, roof: backRoof}, bridges, containers, stairs, closed,
    eastSign: f.mirror ? -1 : 1,
  };
}

/** Length (m) of the flights for a rise (gen/traversal.ts planStairs). */
function planLen(rise: number): number {
  const n = Math.max(1, Math.round(Math.abs(rise) / STAIR.riser));
  const flights = Math.ceil(n / STAIR.maxRisers);
  return n * STAIR.tread + (flights - 1) * STAIR.landing;
}
