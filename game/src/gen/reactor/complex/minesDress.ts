// Task reactor-expansion-20261101 (lane MINES): DRESSING of the old mine workings (the ComplexCarve `dress` hook; world metres, after the
// crop and the station dresser, before the populations) + the RAIL LINE geometry shared with the runtime visuals (world/reactor/
// minesVisuals.ts).
//
// The station dresser has already furnished the workings by their room types / purposes (drifts: the 'service' composition — work
// lights, maintenance bays, caches; rooms: their purpose rules — lockers in the lamp room, tool chests in the tool room, panels in the
// hoist room, shelving / cabinets / crates in the magazine, first-aid cabinets in the refuge). This pass adds what makes it a MINE:
//  - SET PIECES (collision-only 'annexMachine' boxes; the visuals draw the lead's Meshy models / timber on them, keyed by `variant`):
//    ore carts on the rail line, the hoist winch beside a fenced blind winze, a drill jumbo, timber cribs holding up the stope roof, the
//    rubble choking the collapsed drift. Classification (docs/prop-affordances.md "Reactor mines"): anchored set pieces of the workings
//    — a ~650 kg ore car chocked on its rails, a winch bolted to its concrete base, a ~10 t drill jumbo, cribs / rubble: no storage, a
//    body or a bullet does not move them (physics audit 'annexMachine' = machinery). Storage stays the existing openable holders.
//  - PROPS of existing kinds by real function (crates of the magazine, cable spools, gas cylinders, the sump pump, work lights, a
//    drum fan, a barricade before the bad ground, the lamp room's tag board / clock, mine phones, first-aid kits): placed through the
//    dresser's own primitives (door zones, access strips, connectivity, doorway clear volumes), kept off the rail line and the
//    generator's stand point.
//  - FIXTURES (cage lamps on the cavern walls, the hoist room) and STENCILLED SIGNS (adit name at the shaft gallery, magazine / winze /
//    flooded / bad-ground warnings, generator direction). Light state follows applyLighting (some dead / flickering).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, type Grid} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import {
  areaConnected, backed, cellsOfBox, makePlaceCtx, placeAgainstWall, propBlocksDoorway, WALL_ROT, wallXZ, type PlaceCtx,
} from '../../placeKit';
import type {Area, Door, LightPlacement, Rect, Side, SignPlacement, StationLayout} from '../../stationTypes';
import type {MineRoomPlan} from './minesPlan';

/** What the dress hook knows of the carve (canvas cells: shifted by the crop here). */
export interface MinesDressInfo {
  level: number;
  base: number;
  rooms: {key: string; area: number; part: MineRoomPlan['part']}[];
  /** Generator stand point (continuous canvas cells) and skid footprint (canvas cells). */
  use: {x: number; y: number};
  foot: Rect;
}

/** `variant` codes of the mines' collision-only set pieces ('annexMachine' props in the mine areas; the visuals key off them). */
export const MINE_PIECE = {cart: 7101, winch: 7102, winze: 7103, drill: 7104, crib: 7105, rubble: 7106} as const;
export type MinePieceId = keyof typeof MINE_PIECE;
export const MINE_PIECE_OF: Readonly<Record<number, MinePieceId>> = Object.fromEntries(Object.entries(MINE_PIECE).map(([k, v]) => [v, k as MinePieceId]));

/** Real sizes (m) of the set pieces: footprint along / across their long axis, height (the lead's REACTOR_X_KIT dims). */
export const MINE_PIECE_SIZE: Readonly<Record<MinePieceId, {l: number; w: number; h: number}>> = {
  cart: {l: 1.8, w: 0.8, h: 0.79}, winch: {l: 3.0, w: 1.71, h: 1.64}, winze: {l: 2.0, w: 2.0, h: 1.1}, drill: {l: 3.5, w: 1.0, h: 1.28},
  crib: {l: 1.4, w: 1.4, h: 0}, rubble: {l: 0, w: 0, h: 1.6},
};

/** Narrow-gauge track: gauge (m, rail centres), rail head height above the floor, sleeper pitch / length. */
export const MINE_RAIL = {gauge: 0.6, railTop: 0.14, pitch: 0.65, sleeper: 1.0} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Mask write (this pass opens no placement transaction). */
const setMask = (arr: Uint8Array, i: number, v: number) => { arr[i] = v; };

/** Stats of the last dress pass (QA / tests). */
export const MINES_DRESS_STATS = {pieces: {} as Partial<Record<MinePieceId, number>>, props: 0, lights: 0, signs: 0, ms: 0};

// ---------------------------------------------------------------------------------------------------------------------------------
// The rail line (pure geometry: cell units in any frame; shared with the visuals)

export interface RailPoint { x: number; z: number }

/** Centre of an opening, and whether its wall runs along z (a one-cell-wide opening in an x = const wall). */
function doorMid(d: Rect): {x: number; z: number; vert: boolean} {
  return {x: d.x + d.w / 2, z: d.y + d.h / 2, vert: d.w === 1 && d.h > 1};
}

/**
 * The haulage rail line (cell units): from just inside the adit mouth (`entry` = the entrance opening), through every opening of the
 * `chain` (adit -> junction -> haulage segments -> cavern; `doors[i]` joins chain[i] and chain[i + 1]) with right-angle bends (the old
 * line's turnplates), the jog of parallel openings at a segment's middle, ending 3 m into the cavern (the loading point).
 */
export function railPath(entry: Rect, chain: readonly Rect[], doors: readonly Rect[]): RailPoint[] {
  const pts: RailPoint[] = [];
  const push = (x: number, z: number) => {
    const l = pts[pts.length - 1];
    if (!l || Math.abs(l.x - x) > 0.01 || Math.abs(l.z - z) > 0.01) pts.push({x, z});
  };
  const e = doorMid(entry), first = chain[0];
  // 1.2 cells inside the adit from the entrance (never onto the deck)
  const into = (d: {x: number; z: number; vert: boolean}, r: Rect, k: number) => (d.vert
    ? {x: d.x + Math.sign(r.x + r.w / 2 - d.x) * k, z: d.z}
    : {x: d.x, z: d.z + Math.sign(r.y + r.h / 2 - d.z) * k});
  let cur = into(e, first, 1.2), curVert = e.vert;
  push(cur.x, cur.z);
  for (let i = 0; i < doors.length; i++) {
    const d = doorMid(doors[i]);
    if (d.vert === curVert) {
      // parallel walls: jog at the middle of the space between them
      if (d.vert) { const mx = (cur.x + d.x) / 2; push(mx, cur.z); push(mx, d.z); } else { const mz = (cur.z + d.z) / 2; push(cur.x, mz); push(d.x, mz); }
    } else push(d.vert ? cur.x : d.x, d.vert ? d.z : cur.z);
    push(d.x, d.z);
    cur = d; curVert = d.vert;
  }
  const last = chain[chain.length - 1], end = into({...cur, vert: curVert}, last, 6);
  push(end.x, end.z);
  return pts;
}

/** The rail line of a laid-out mines complex in WORLD metres (grid frame), or [] (no haulage chain / openings missing). */
export function minesRailWorld(layout: StationLayout, rooms: readonly {key: string; area: number}[]): RailPoint[] {
  const id = (k: string) => rooms.find(r => r.key === k)?.area;
  const keys = ['portal', 'junction', ...rooms.map(r => r.key).filter(k => k.startsWith('haulage-')).sort((a, b) => +a.slice(8) - +b.slice(8)), 'cavern'];
  const chainIds = keys.map(id);
  if (chainIds.some(x => x === undefined)) return [];
  const between = (a: number, b: number): Door | undefined => layout.doors.find(d => (d.a === a && d.b === b) || (d.a === b && d.b === a));
  const doors: Rect[] = [];
  for (let i = 0; i + 1 < chainIds.length; i++) { const d = between(chainIds[i]!, chainIds[i + 1]!); if (!d) return []; doors.push(d); }
  const portal = layout.areas[chainIds[0]!];
  const entry = layout.doors.find(d => d.b === portal.id && !chainIds.includes(d.a));
  if (!entry) return [];
  return railPath(entry, chainIds.map(i => layout.areas[i!]), doors).map(p => ({x: r3(p.x * CELL), z: r3(p.z * CELL)}));
}

/** Points every `step` m along a polyline with the local unit direction (axis-aligned runs only when `axial`). */
export function alongPolyline(pts: readonly RailPoint[], step: number, offset = 0): {x: number; z: number; dx: number; dz: number}[] {
  const out: {x: number; z: number; dx: number; dz: number}[] = [];
  let carry = offset;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    let s = carry;
    for (; s <= L; s += step) out.push({x: a.x + dx * s, z: a.z + dz * s, dx, dz});
    carry = s - L;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The dress hook

export function dressMines(layout: StationLayout, rng: Rng, crop: {ox: number; oy: number}, info: MinesDressInfo): void {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const lv = info.level, base = info.base, g = layout.levels?.[lv]?.grid ?? layout.grid;
  const area = (key: string): Area | undefined => { const r = info.rooms.find(q => q.key === key); return r ? layout.areas[r.area] : undefined; };
  const of = (part: MineRoomPlan['part']): Area[] => info.rooms.filter(r => r.part === part).map(r => layout.areas[r.area]);
  const mine = info.rooms.map(r => layout.areas[r.area]);
  const p0 = layout.props.length, l0 = layout.lights.length, s0 = layout.signs.length;
  MINES_DRESS_STATS.pieces = {};
  // one placement context on the storey, over the workings' bounding box (+ margin)
  const bb = mine.reduce((m, a) => ({x0: Math.min(m.x0, a.x - 3), y0: Math.min(m.y0, a.y - 3), x1: Math.max(m.x1, a.x + a.w + 3), y1: Math.max(m.y1, a.y + a.h + 3)}), {x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9});
  const ctx = makePlaceCtx(layout, rng.fork('mines-place'), lv, bb);
  // keep: the generator's stand point (5 x 5 cells), its skid ring, the rail line (lane: floor props never stand on it)
  const ux = info.use.x - crop.ox, uy = info.use.y - crop.oy;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = Math.floor(ux) + dx, y = Math.floor(uy) + dy; if (g.inBounds(x, y)) setMask(ctx.keep, g.idx(x, y), 1); }
  const F = {x: info.foot.x - crop.ox, y: info.foot.y - crop.oy, w: info.foot.w, h: info.foot.h};
  for (let y = F.y - 1; y < F.y + F.h + 1; y++) for (let x = F.x - 1; x < F.x + F.w + 1; x++) if (g.inBounds(x, y)) setMask(ctx.keep, g.idx(x, y), 1);
  const rail = minesRailWorld(layout, info.rooms);
  for (const p of alongPolyline(rail, 0.25)) {
    const [cx, cy] = g.cellOf(p.x, p.z);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inBounds(cx + dx, cy + dy) && Math.hypot((cx + dx + 0.5) * CELL - p.x, (cy + dy + 0.5) * CELL - p.z) < 0.75) setMask(ctx.lane, g.idx(cx + dx, cy + dy), 1);
  }
  const lift = (from: number) => { for (let i = from; i < layout.props.length; i++) { const p = layout.props[i]; p.y = r2(p.y + base); } };

  // --- set pieces -------------------------------------------------------------------------------------------------------------
  const piece = (a: Area, id: MinePieceId, x: number, z: number, hx: number, hz: number, h: number, o: {lane?: boolean; ring?: number} = {}): PropPlacement | null => {
    const p = placeMachine(ctx, a, x, z, hx, hz, h, MINE_PIECE[id], base, o);
    if (p) MINES_DRESS_STATS.pieces[id] = (MINES_DRESS_STATS.pieces[id] ?? 0) + 1;
    return p;
  };
  // the hoist first (the hero piece): a fenced blind winze and its winch (drum toward the winze) in the hoist room; where the room's
  // fittings leave no space, by the junction's or the cavern's wall (an old winze broken through there)
  {
    const tryRoom = (H: Area): boolean => {
      const alongX = H.w >= H.h, ax0 = H.x * CELL, az0 = H.y * CELL, ax1 = (H.x + H.w) * CELL, az1 = (H.y + H.h) * CELL;
      for (const f of [0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6]) for (const q of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        // winze 2.0 m square (fenced collar), the winch 3.0 x 1.7 beside it along the long axis, 0.5 m between them (cell-aligned)
        const wx = alongX ? ax0 + (ax1 - ax0) * f : ax0 + (ax1 - ax0) * q, wz = alongX ? az0 + (az1 - az0) * q : az0 + (az1 - az0) * f;
        const sx = Math.round(wx * 2) / 2, sz = Math.round(wz * 2) / 2;
        const before = layout.props.length;
        if (!piece(H, 'winze', sx, sz, 1.0, 1.0, 1.1, {ring: 1})) continue;
        const sgn = f < 0.5 ? 1 : -1;
        const cx = alongX ? sx + sgn * 3.0 : sx, cz = alongX ? sz : sz + sgn * 3.0;
        if (piece(H, 'winch', cx, cz, alongX ? 1.5 : 0.86, alongX ? 0.86 : 1.5, 1.64, {ring: 1})) return true;
        unplace(ctx, layout, before); // no room for the winch beside it: the winze comes back out
        MINES_DRESS_STATS.pieces.winze = (MINES_DRESS_STATS.pieces.winze ?? 1) - 1;
      }
      return false;
    };
    for (const a of [area('hoist'), area('junction'), area('cavern')]) if (a && tryRoom(a)) break;
  }
  // ore carts on the haulage line: one on the drift, one by the loading point in the cavern, one more by the junction now and then
  {
    const haul = new Set([...of('haulage'), ...of('junction'), ...of('cavern')].map(a => a.id));
    const spots = alongPolyline(rail, 0.5).filter(s => Math.abs(s.dx) < 1e-3 || Math.abs(s.dz) < 1e-3);
    const want = [0.42, 0.93, ...(rng.chance(0.5) ? [0.2] : [])];
    let placed = 0;
    for (const f of want) {
      for (let k = 0; k < spots.length && placed < 3; k++) {
        const s = spots[(Math.round(f * (spots.length - 1)) + (k % 2 ? k : -k) + spots.length * 4) % spots.length];
        const [cx, cy] = g.cellOf(s.x, s.z);
        const a = layout.areas[g.area[g.idx(cx, cy)]];
        if (!a || !haul.has(a.id)) continue;
        const along = Math.abs(s.dx) > 0.5;
        if (piece(a, 'cart', s.x, s.z, along ? 0.9 : 0.4, along ? 0.4 : 0.9, 0.8, {lane: true})) { placed++; break; }
      }
    }
  }
  // the drill jumbo parked against a cavern wall (else the junction), timber cribs in the stope, rubble choking the collapsed drift
  {
    const C = area('cavern'), J = area('junction');
    for (const a of [C, J]) {
      if (!a) continue;
      let ok = false;
      for (const side of rng.shuffle(['N', 'S', 'E', 'W'] as Side[])) {
        const alongX = side === 'N' || side === 'S';
        const [lo, hi] = alongX ? [a.x * CELL, (a.x + a.w) * CELL] : [a.y * CELL, (a.y + a.h) * CELL];
        for (let t = lo + 2.5; t <= hi - 2.5 && !ok; t += 1.0) {
          const [x, z] = wallXZ(a, side, t, 0.62);
          if (piece(a, 'drill', x, z, alongX ? 1.75 : 0.5, alongX ? 0.5 : 1.75, 1.28, {ring: 1})) ok = true;
        }
        if (ok) break;
      }
      if (ok) break;
    }
    if (C) {
      const n = rng.int(2, 3);
      let placed = 0;
      for (let k = 0; k < 40 && placed < n; k++) {
        const x = (C.x + 2 + rng.next() * (C.w - 4)) * CELL, z = (C.y + 2 + rng.next() * (C.h - 4)) * CELL;
        if (Math.hypot(x - ux * CELL, z - uy * CELL) < 3.5) continue;
        if (piece(C, 'crib', Math.round(x * 2) / 2, Math.round(z * 2) / 2, 0.7, 0.7, r2(C.ceil - base), {ring: 2})) placed++;
      }
    }
    for (const X of of('collapse')) {
      // the far end (away from its opening) under a rubble slope, 2.5 m deep, full width
      const d = layout.doors.find(q => q.a === X.id || q.b === X.id);
      if (!d) continue;
      const alongX = X.w >= X.h, m = doorMid(d);
      const farHi = alongX ? m.x < X.x + X.w / 2 : m.z < X.y + X.h / 2;
      const depth = 2.5, ax0 = X.x * CELL, az0 = X.y * CELL, ax1 = (X.x + X.w) * CELL, az1 = (X.y + X.h) * CELL;
      const cx = alongX ? (farHi ? ax1 - depth / 2 : ax0 + depth / 2) : (ax0 + ax1) / 2, cz = alongX ? (az0 + az1) / 2 : (farHi ? az1 - depth / 2 : az0 + depth / 2);
      piece(X, 'rubble', cx, cz, alongX ? depth / 2 - 0.02 : (ax1 - ax0) / 2 - 0.02, alongX ? (az1 - az0) / 2 - 0.02 : depth / 2 - 0.02, 1.6);
    }
  }

  // --- props of existing kinds by function ---------------------------------------------------------------------------------------
  const pFrom = layout.props.length;
  const put = (a: Area | undefined, kind: PropKind, n: number, o: {sides?: Side[]; front?: number; purpose?: string} = {}) => {
    if (!a) return 0;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = placeAgainstWall(ctx, a, kind, {sides: o.sides, front: o.front ?? (PROP_DEFS[kind].d > 0.6 ? 0.7 : 0), tries: 18});
      if (p) { k++; if (o.purpose) p.purpose = o.purpose; }
    }
    return k;
  };
  const M = area('magazine'), C = area('cavern'), T = area('tools'), Lr = area('lamp'), J = area('junction');
  put(M, 'crate', rng.int(3, 5), {purpose: 'storage'});
  put(C, 'crate', rng.int(2, 3), {purpose: 'storage'});
  put(C, 'palletJack', 1);
  put(C, 'gasCylinderCart', 1);
  put(C, 'airCompressor', 1);
  put(C, 'tripodWorkLight', 2);
  put(J, 'crate', 1, {purpose: 'storage'});
  put(J, 'handTruck', 1);
  put(T, 'gasCylinderCart', 1);
  put(T, 'stepLadder', 1);
  for (const S of of('sump')) { put(S, 'waterPumpSkid', 1); put(S, 'wetDryVac', rng.chance(0.4) ? 1 : 0); }
  for (const X of of('collapse')) put(X, 'foldingBarricade', 1);
  {
    const drifts = [...of('haulage'), ...of('manway'), ...of('crosscut')];
    rng.shuffle(drifts);
    put(drifts[0], 'drumFan', 1);
    put(drifts[1], 'crate', 1, {purpose: 'storage'});
    put(drifts[2], 'gasCylinderCart', 1);
  }
  // wall mounts: the lamp room's tag board + check-in clock, mine phones at the junction / cavern, first-aid kits
  mount(ctx, Lr, 'keyCabinet', 1.3, base);
  mount(ctx, Lr, 'punchClock', 1.2, base);
  mount(ctx, J, 'fieldPhoneBox', 1.2, base);
  mount(ctx, C, 'fieldPhoneBox', 1.2, base);
  mount(ctx, C, 'firstAidWallKit', 1.3, base);
  mount(ctx, area('hoist'), 'disconnectSwitch', 1.2, base);
  lift(pFrom);
  MINES_DRESS_STATS.props = layout.props.length - pFrom;

  // --- fixtures: cage lamps on the cavern walls (high), one over the winze -----------------------------------------------------
  const light = (a: Area, x: number, z: number, y: number) => {
    const l: LightPlacement = {x: r3(x), y: r2(y), z: r3(z), rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 1, dying: false, ...(lv ? {level: lv} : {})};
    layout.lights.push(l);
  };
  if (C) {
    const y = base + Math.min(C.ceil - base - 0.5, 4.6);
    const ax0 = C.x * CELL, az0 = C.y * CELL, ax1 = (C.x + C.w) * CELL, az1 = (C.y + C.h) * CELL, inset = 0.9;
    for (const [x, z] of [[ax0 + inset, (az0 + az1) / 2], [ax1 - inset, (az0 + az1) / 2], [(ax0 + ax1) / 2 - (ax1 - ax0) / 4, az0 + inset], [(ax0 + ax1) / 2 + (ax1 - ax0) / 4, az0 + inset], [(ax0 + ax1) / 2 - (ax1 - ax0) / 4, az1 - inset], [(ax0 + ax1) / 2 + (ax1 - ax0) / 4, az1 - inset]]) light(C, x, z, y);
  }
  const hoistWinze = layout.props.slice(p0).find(p => p.variant === MINE_PIECE.winze);
  if (hoistWinze) { const H = layout.areas[hoistWinze.area]; light(H, hoistWinze.x, hoistWinze.z, base + Math.min(H.ceil - base - 0.3, 4.2)); }
  MINES_DRESS_STATS.lights = layout.lights.length - l0;

  // --- signs ------------------------------------------------------------------------------------------------------------------
  const P = area('portal');
  const entry = P ? layout.doors.find(d => d.b === P.id && !info.rooms.some(r => r.area === d.a)) : undefined;
  if (P && entry) {
    const deck = layout.areas[entry.a];
    sign(layout, g, deck, entry, 'NO. 2 ADIT · OLD WORKINGS · GENERATOR G2', base, 2.6);
    sign(layout, g, P, entry, 'MIND YOUR HEAD · TIMBERED GROUND', base, 1.9);
  }
  const doorOf = (a: Area | undefined) => (a ? layout.doors.find(d => d.b === a.id || d.a === a.id) : undefined);
  const outside = (a: Area, d: Door) => layout.areas[d.a === a.id ? d.b : d.a];
  const signOut = (a: Area | undefined, text: string, w = 1.6) => { const d = doorOf(a); if (a && d) sign(layout, g, outside(a, d), d, text, base, w); };
  signOut(M, 'POWDER MAGAZINE · NO NAKED LIGHTS');
  signOut(Lr, 'LAMP ROOM · CHECK IN / CHECK OUT');
  signOut(area('hoist'), 'HOIST ROOM · KEEP CLEAR OF WINZE');
  signOut(area('refuge'), 'REFUGE CHAMBER');
  for (const S of of('sump')) signOut(S, 'DANGER · FLOODED WORKINGS');
  for (const X of of('collapse')) signOut(X, 'DANGER · BAD GROUND · NO ENTRY');
  // the way to the generator: at the junction's haulage mouth, the cavern's openings
  {
    const h0 = info.rooms.find(r => r.key === 'haulage-0');
    const d = J && h0 ? layout.doors.find(q => (q.a === J.id && q.b === h0.area) || (q.b === J.id && q.a === h0.area)) : undefined;
    if (J && d) sign(layout, g, J, d, 'GENERATOR G2 · No. 2 STOPE', base, 1.6);
    for (const a of [...of('haulage'), ...of('manway')]) {
      const dc = C ? layout.doors.find(q => (q.a === a.id && q.b === C.id) || (q.b === a.id && q.a === C.id)) : undefined;
      if (C && dc) sign(layout, g, C, dc, 'AUX GENERATOR G2 · STOPE No. 2', base, 1.6);
    }
  }
  MINES_DRESS_STATS.signs = layout.signs.length - s0;
  MINES_DRESS_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Primitives

/** A collision-only set piece ('annexMachine'): free, unblocked cells of its area, off door zones / keep / edge (and the rail lane unless
 *  `lane`), an optional walkway ring; never splits the area (areaConnected) nor enters a doorway's clear volume. y = the storey floor. */
function placeMachine(ctx: PlaceCtx, a: Area, x: number, z: number, hx: number, hz: number, h: number, variant: number, base: number, o: {lane?: boolean; ring?: number}): PropPlacement | null {
  const g = ctx.g;
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!g.inBounds(cx, cy)) return null;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || g.rampIdx[i] >= 0 || ctx.keep[i] || ctx.doorCell[i] || ctx.zone[i] || ctx.edge[i]) return null;
    if (ctx.lane[i] && !o.lane) return null;
  }
  if (o.ring) {
    const rc = o.ring;
    for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) {
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      // the ring is open floor of the area or rock (a piece may stand against a wall), never another prop
      if (g.cells[i] === FLOOR && (g.blocked[i] || g.area[i] !== a.id)) return null;
    }
  }
  if (propBlocksDoorway(ctx.layout, x, z, hx, hz, base, h)) return null;
  if (base + h > a.ceil + 0.05) return null;
  const blocksSight = h > 1.7;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(g.blocked, i, 1); if (blocksSight) setMask(g.sightBlocked, i, 1); }
  if (!areaConnected(ctx, a)) {
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(g.blocked, i, 0); setMask(g.sightBlocked, i, 0); }
    return null;
  }
  const p: PropPlacement = {kind: 'annexMachine', x: r3(x), z: r3(z), y: r2(base), rot: 0, area: a.id, hx: r3(hx), hz: r3(hz), h: r2(h), blocksSight, variant, ...(ctx.level ? {level: ctx.level} : {})};
  ctx.layout.props.push(p);
  return p;
}

/** Removes the props pushed since `from` (set pieces only: their cells are unblocked again). */
function unplace(ctx: PlaceCtx, layout: StationLayout, from: number): void {
  const g = ctx.g;
  while (layout.props.length > from) {
    const p = layout.props.pop()!;
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const i = g.idx(cx, cy); setMask(g.blocked, i, 0); setMask(g.sightBlocked, i, 0); }
  }
}

/**
 * A wall-mounted prop at `y` above the floor (local), wall-backed, inside the area, clear of every prop box (ABSOLUTE heights: this pass
 * runs after the station dresser lifted its props), of door cells and of doorway clear volumes. Tries a few spots along each wall.
 */
function mount(ctx: PlaceCtx, a: Area | undefined, kind: PropKind, y: number, base: number): PropPlacement | null {
  if (!a) return null;
  const def = PROP_DEFS[kind], g = ctx.g;
  for (const side of ctx.rng.shuffle(['N', 'S', 'E', 'W'] as Side[])) {
    const alongX = side === 'N' || side === 'S';
    const lo = (alongX ? a.x : a.y) * CELL + def.w / 2 + 0.3, hi = (alongX ? a.x + a.w : a.y + a.h) * CELL - def.w / 2 - 0.3;
    for (let k = 0; k < 6; k++) {
      if (hi < lo) break;
      const t = Math.round(ctx.rng.range(lo, hi) * 4) / 4;
      const rot = WALL_ROT[side], quarter = Math.round(rot / (Math.PI / 2)) & 1;
      const hx = quarter ? def.d / 2 : def.w / 2, hz = quarter ? def.w / 2 : def.d / 2;
      const [x, z] = wallXZ(a, side, t, def.d / 2 + 0.03);
      if (!backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + y)) continue;
      const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
      let ok = true;
      for (let cy = y0; cy <= y1 && ok; cy++) for (let cx = x0; cx <= x1; cx++) {
        const i = g.idx(cx, cy);
        if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR || g.area[i] !== a.id || ctx.doorCell[i] || ctx.edge[i]) { ok = false; break; }
      }
      if (!ok || base + y + def.h + 0.05 > a.ceil) continue;
      if (ctx.layout.props.some(p => (p.level ?? 0) === ctx.level && p.x + p.hx > x - hx && p.x - p.hx < x + hx && p.z + p.hz > z - hz && p.z - p.hz < z + hz && p.y + p.h > base + y && p.y < base + y + def.h)) continue;
      if (propBlocksDoorway(ctx.layout, x, z, hx, hz, base + y, def.h)) continue;
      const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: r2(y), rot, area: a.id, hx, hz, h: def.h, blocksSight: false, variant: 0, mounted: true, ...(ctx.level ? {level: ctx.level} : {})};
      if (y < 2) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) setMask(ctx.keep, g.idx(cx, cy), 1);
      ctx.layout.props.push(p);
      return p;
    }
  }
  return null;
}

/**
 * A stencilled service plate on `a`'s side of opening `d`: above it where the wall over the head has room, else beside it (0.2 m clear
 * of the opening, at 1.9 m), wall-backed (rock behind the whole plate) — never across the opening. Absolute height, storey-tagged.
 */
function sign(layout: StationLayout, g: Grid, a: Area, d: Door, text: string, base: number, w: number): SignPlacement | null {
  const vert = d.w === 1 && d.h > 1;
  const side: Side = vert ? (d.x < a.x ? 'W' : 'E') : (d.y < a.y ? 'N' : 'S');
  const mid = vert ? (d.y + d.h / 2) * CELL : (d.x + d.w / 2) * CELL, half = (vert ? d.h : d.w) * CELL / 2;
  const doorFloor = base, head = doorFloor + d.height, aCeil = a.ceil;
  const h = 0.26;
  const tries: {t: number; y: number; w: number}[] = [];
  if (aCeil - head >= 0.55) tries.push({t: mid, y: Math.min(head + 0.32, aCeil - 0.24), w: Math.min(w, half * 2 + 0.6)});
  for (const ww of [w, w * 0.75, 1.0]) for (const s of [1, -1]) tries.push({t: mid + s * (half + 0.2 + ww / 2), y: base + 1.9, w: ww});
  const behind = side === 'N' ? a.y - 1 : side === 'S' ? a.y + a.h : side === 'W' ? a.x - 1 : a.x + a.w;
  for (const tr of tries) {
    const lo = Math.floor((tr.t - tr.w / 2) / CELL + 1e-6), hi = Math.ceil((tr.t + tr.w / 2) / CELL - 1e-6) - 1;
    let ok = true;
    for (let c = lo; c <= hi && ok; c++) {
      const [x, y] = vert ? [behind, c] : [c, behind];
      const [ix, iy] = vert ? [side === 'W' ? a.x : a.x + a.w - 1, c] : [c, side === 'N' ? a.y : a.y + a.h - 1];
      if (!g.inBounds(x, y) || !g.inBounds(ix, iy)) { ok = false; break; }
      const i = g.idx(x, y), inner = g.idx(ix, iy);
      // rock behind (or the opening's lintel above its head for a plate over it), the room's own floor in front
      const overHead = tr.y - h / 2 >= head && c * CELL >= mid - half - 1e-6 && (c + 1) * CELL <= mid + half + 1e-6;
      if (!(g.cells[i] !== FLOOR || overHead) || g.area[inner] !== a.id) ok = false;
    }
    if (!ok) continue;
    const x = vert ? (side === 'W' ? a.x * CELL + 0.02 : (a.x + a.w) * CELL - 0.02) : tr.t;
    const z = vert ? tr.t : (side === 'N' ? a.y * CELL + 0.02 : (a.y + a.h) * CELL - 0.02);
    const s: SignPlacement = {x: r3(x), y: r2(tr.y), z: r3(z), rot: side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2, kind: 'service', text, area: a.id, w: r2(tr.w), ...(a.level ? {level: a.level} : {})};
    layout.signs.push(s);
    return s;
  }
  return null;
}
