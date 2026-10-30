// Task office-overhaul-20261030 (lane TENANTS): company dressing of the office floors — pure data, hooked from gen/office/dress.ts
// (preDress: before the station dresser's dress(); postDress: after it). Everything goes through the shared placement primitive
// (gen/placeKit.ts: door zones, access strips, rings, room connectivity), so a piece that cannot fit is skipped, never forced.
//
//  pre   - the company RECEPTION off the elevator lobby: a free-standing logo wall (name + tagline plates in the company palette,
//          added in post), the reception desk facing the opening, the company's HERO signature prop, lounge seating, planters;
//        - every company room / open-plan style / office-run room by its recipe (gen/office/companies.ts Step lists): trading desks
//          in rows, lab benches in back-to-back pairs, arcade cabinets along the far wall, treadmills, archive stacks …;
//        - item 7 EXECUTIVE SUITES (every 'exec' area): executive desk facing the door, chesterfield, globe bar, bookcases, planter —
//          no generic desk / chair / monitor;
//        - item 9 SERVER ROOMS (every 'server' area): rows of racks with hot / cold aisles, server cabinets, a CRAC unit, >= 2 racks.
//  post  - pieces by the windows (telescopes), chairs pulled up to trading desks / consoles, the executive chair, the logo plates and
//          the company wayfinding plate in the elevator lobby, the signature guarantee (each signature kind >= 1 per tenant floor),
//        - item 8 PLANT / CORRIDOR CLEARANCE: in passages narrower than 4 m every cross-section keeps >= 1.5 m clear (deeper decor
//          that would narrow it is removed), only the small potted plant stands there (against a wall, outside door zones);
//        - the company prefix on every area label of a tenant floor ("Pixelforge · Game lounge");
//        - the lobby (floor 1, neutral): the TENANT DIRECTORY board (floor -> company plates in each company's colours).

import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {
  OPPOSITE, WALL_ROT, backed, cellsOfBox, doorSide, mainDoor, markCell, placeAgainstWall, rowAlongWall, tryPlaceProp, wallRange, wallXZ, type PlaceCtx,
} from '../placeKit';
import type {Area, Side, SignPlacement, SignStyle, StationLayout} from '../stationTypes';
import {MARGIN} from './frame';
import {BASE_ROOMS, COMPANIES, OPEN_STYLES, ROOMS, RUNS, roomSteps, type Company, type OpenStyle, type RoomInfo, type RoomKey, type Step} from './companies';
import {COMPANY_KIND_ASSET, ON_SIDEBOARD, SIDE_TO_WALL, isCompanyKind} from './companyKinds';
import {officeTenants} from './tenants';
import {COMPANY_ASSET_SPECS} from '../../assets/companyDims.generated';
import {cubicleFarm, hostDecor, landingStrip, wallSign, type OfficeDress} from './dress';
import {placeHostClutter} from './hostClutter'; // task office-props-physics-scale-20261030 (lane FURN)
import type {OfficeAreaMeta} from './tower';

const q4 = (v: number) => Math.round(v * 4) / 4;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SIDES: readonly Side[] = ['N', 'S', 'E', 'W'];

/** Company of a dressed storey (office floors 2..8). */
export const companyOf = (d: OfficeDress): Company | undefined => (d.tower.tenant ? COMPANIES[d.tower.tenant.company] : undefined);

/** Sign style of a company (plates: accent ground, sign-colour lettering, trim band, its typeface). */
export function companySignStyle(c: Company): SignStyle {
  return {bg: c.palette.accent, fg: c.palette.sign, accent: c.palette.trim, font: c.font};
}

const sideWallsOf = (ds: Side): Side[] => (ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S']);
function doorSideOf(ctx: PlaceCtx, a: Area): Side {
  const d = mainDoor(ctx, a);
  return d ? doorSide(d, a) : a.w >= a.h ? 'S' : 'E';
}
function wallsFor(ctx: PlaceCtx, sel: string | undefined, ds: Side): Side[] {
  if (sel === 'far') return [OPPOSITE[ds]];
  if (sel === 'side') return ctx.rng.shuffle(sideWallsOf(ds));
  if (sel === 'near') return [ds];
  return ctx.rng.shuffle(SIDES.slice());
}
const count = (ctx: PlaceCtx, n: readonly [number, number]) => ctx.rng.int(n[0], n[1]);
const rotAlong = (kind: PropKind, alongX: boolean) => ((PROP_DEFS[kind].w >= PROP_DEFS[kind].d) === alongX ? 0 : Math.PI / 2);

// ---------------------------------------------------------------------------------------------
// Placement helpers (pre-dress frame: y local; post placements add the storey base)

/** Free-standing rows across the room's long axis (units side by side, cross aisles every 4); back-to-back pairs when `pair`. */
export function freeRows(ctx: PlaceCtx, a: Area, kind: PropKind, n: number, pair = false, aisle = 1.3): PropPlacement[] {
  const def = PROP_DEFS[kind];
  const alongX = a.w >= a.h;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const M = 0.9;
  // (lane LAYOUT: a back-to-back pair's two faces are FRONTS — doors / drawers / screens — so the outer lines keep a full service
  // aisle to the walls, not just the 0.9 m margin)
  const MV = pair ? Math.max(M, aisle) : M;
  const u0 = (alongX ? ax0 : az0) + M, u1 = (alongX ? ax1 : az1) - M;
  const v0 = (alongX ? az0 : ax0) + MV, v1 = (alongX ? az1 : ax1) - MV;
  // Task office-interactions-layout-20261030 (lane LAYOUT): CELL-ALIGNED pitches. Units used to stand 0.04 m apart side by side and
  // 0.02 m back to back, so two neighbours shared a grid cell and every other placement silently failed (rows of racks / desks /
  // benches came out half empty, depending on the room's alignment) — now neighbours never share a cell.
  const snap = (q: number) => Math.ceil(q / CELL - 1e-6) * CELL;
  const gap = def.w >= 1.0 ? 0.04 : 0.35;
  const pu = snap(def.w + gap), cx = snap(Math.max(0, 1.2 - (pu - def.w)));
  const half = def.d / 2 + 0.01;
  // a pair spans both lines (2 depths + the 0.02 m between the backs); rows of pairs keep `aisle` between one pair's fronts and the next's
  const block = pair ? 4 * half - 0.02 : def.d;
  const pitch = snap(block + aisle);
  if (v1 - v0 < block) return [];
  const rows = Math.max(1, Math.floor((v1 - v0 - block) / pitch) + 1);
  const vs = v0 + (v1 - v0 - ((rows - 1) * pitch + block)) / 2;
  const len = (k: number) => (k - 1) * pu + def.w + Math.floor((k - 1) / 4) * cx;
  let per = 0;
  while (len(per + 1) <= u1 - u0) per++;
  if (!per) return [];
  const us = Math.round((u0 + (u1 - u0 - len(per)) / 2) / CELL) * CELL;
  const out: PropPlacement[] = [];
  const flip = ctx.rng.chance(0.5);
  // (a pair's backs meet on a cell line: each line keeps its own cells; the snap never eats into the aisles to the walls)
  let vb0 = pair ? Math.round((vs + block / 2) / CELL) * CELL : vs;
  if (pair && vb0 - block / 2 < v0 - 1e-6) vb0 += CELL;
  for (let r = 0; r < rows && out.length < n; r++) {
    const vb = vb0 + r * pitch;
    if (pair && vb + block / 2 > v1 + 1e-6) break;
    const lines = pair ? [{v: vb - half, f: -1}, {v: vb + half, f: 1}] : [{v: vb + def.d / 2, f: flip ? -1 : 1}];
    for (const ln of lines) {
      for (let i = 0; i < per && out.length < n; i++) {
        const u = us + i * pu + Math.floor(i / 4) * cx + def.w / 2;
        const x = alongX ? u : ln.v, z = alongX ? ln.v : u;
        const rot = alongX ? (ln.f > 0 ? 0 : Math.PI) : (ln.f > 0 ? Math.PI / 2 : -Math.PI / 2);
        const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), rot);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/**
 * Task office-interactions-layout-20261030 (lane LAYOUT): bench-desk clusters down the middle of a long, shallow open area (the work
 * commons): each cluster two desks wide and two deep (back to back, 3 m x 1.5 m), 1.6 m cross aisles between clusters, walkways
 * along both long walls (door zones / openings stay clear: the placement primitive skips them). Returns the desks placed.
 */
export function benchRows(ctx: PlaceCtx, a: Area): number {
  const def = PROP_DEFS.desk;
  const alongX = a.w >= a.h;
  const u0 = (alongX ? a.x : a.y) * CELL + 1.2, u1 = (alongX ? a.x + a.w : a.y + a.h) * CELL - 1.2;
  // (cell-aligned: back-to-back desks one cell either side of a cell line, 0.25 m apart, never sharing a grid cell)
  const vc = Math.round((alongX ? a.y + a.h / 2 : a.x + a.w / 2)) * CELL;
  const block = 2 * def.w + 0.02, pitch = block + 1.6;
  const n = Math.floor((u1 - u0 + 1.6) / pitch);
  const us = u0 + (u1 - u0 - (n * pitch - 1.6)) / 2;
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const ub = Math.round((us + i * pitch) / CELL) * CELL;
    for (const du of [def.w / 2, def.w * 1.5 + 0.02]) for (const sv of [-1, 1]) {
      const u = r3(ub + du), v = r3(vc + sv * CELL);
      const rot = alongX ? (sv < 0 ? Math.PI : 0) : (sv < 0 ? -Math.PI / 2 : Math.PI / 2);
      if (tryPlaceProp(ctx, a, 'desk', alongX ? u : v, alongX ? v : u, rot, {variant: ctx.rng.int(0, 2)})) placed++;
    }
  }
  return placed;
}

/** Island near the room centre (walkway ring), long side along the room's long axis. */
export function island(ctx: PlaceCtx, a: Area, kind: PropKind, ring = 0.8): PropPlacement | null {
  const alongX = a.w >= a.h;
  const rot = rotAlong(kind, alongX) + (ctx.rng.chance(0.5) ? Math.PI : 0);
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const offs: [number, number][] = [];
  for (const oa of [0, 0.75, -0.75, 1.5, -1.5, 2.25, -2.25, 3, -3, 4, -4, 5, -5, 6.5, -6.5]) for (const ob of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) offs.push([oa, ob]);
  for (const [oa, ob] of offs) {
    const x = q4(cx + (alongX ? oa : ob)), z = q4(cz + (alongX ? ob : oa));
    const p = tryPlaceProp(ctx, a, kind, x, z, rot, {ring});
    if (p) return p;
  }
  return null;
}

/** A free-standing piece somewhere on open floor (walkway ring kept). */
export function scatter(ctx: PlaceCtx, a: Area, kind: PropKind, ring = 0.6, tries = 24): PropPlacement | null {
  const rng = ctx.rng;
  for (let t = 0; t < tries; t++) {
    const x = q4(rng.range((a.x + 2) * CELL, (a.x + a.w - 2) * CELL)), z = q4(rng.range((a.y + 2) * CELL, (a.y + a.h - 2) * CELL));
    const p = tryPlaceProp(ctx, a, kind, x, z, rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), {ring});
    if (p) return p;
  }
  return null;
}

/** Back to one of the room's corners (both walls solid; never in a door zone). */
function corner(ctx: PlaceCtx, a: Area, kind: PropKind): PropPlacement | null {
  const def = PROP_DEFS[kind];
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const e = Math.max(def.w, def.d) / 2 + 0.04;
  const cs: [number, number, number][] = [[ax0 + e, az0 + e, 0], [ax1 - e, az0 + e, 0], [ax0 + e, az1 - e, Math.PI], [ax1 - e, az1 - e, Math.PI]];
  for (const [x, z, rot] of ctx.rng.shuffle(cs)) {
    const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), rot);
    if (p) return p;
  }
  return null;
}

/** Sofa with its back to a wall (not the door wall), two armchairs facing it. */
function seating(ctx: PlaceCtx, a: Area, sofa: PropKind, chair: PropKind | undefined, ds: Side): void {
  const sides = ctx.rng.shuffle(SIDES.filter(s => s !== ds));
  const p = placeAgainstWall(ctx, a, sofa, {sides, front: 0.5, tries: 12});
  if (!p || !chair) return;
  const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), lx = fz, lz = -fx;
  const off = PROP_DEFS[sofa].d / 2 + 1.55 + PROP_DEFS[chair].d / 2;
  for (const s of [-1, 1]) tryPlaceProp(ctx, a, chair, r3(p.x + fx * off + lx * 0.6 * s), r3(p.z + fz * off + lz * 0.6 * s), p.rot + Math.PI);
}

/**
 * D30 kegerator (SIDE_TO_WALL): a room corner, back to one wall and its prop -X side against the other wall, never free-standing.
 * The texture artefact (a painted portrait) is on the runtime GLB's +X panel (CPU ortho render of office-kegerator.glb), which the
 * prop frame's 180-degree turn (world/officeProps.ts FLIP) puts at prop -X.
 */
function sideToWall(ctx: PlaceCtx, a: Area, kind: PropKind, front = 0.6): PropPlacement | null {
  const {w, d} = PROP_DEFS[kind], e = 0.04;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const cs: [number, number, number][] = [
    [ax0 + w / 2 + e, az0 + d / 2 + e, 0],              // back N, -X -> W wall
    [ax1 - w / 2 - e, az1 - d / 2 - e, Math.PI],        // back S, -X -> E wall
    [ax0 + d / 2 + e, az1 - w / 2 - e, Math.PI / 2],    // back W, -X -> S wall
    [ax1 - d / 2 - e, az0 + w / 2 + e, -Math.PI / 2],   // back E, -X -> N wall
  ];
  for (const [x, z, rot] of ctx.rng.shuffle(cs)) {
    const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), rot, {front});
    if (p) return p;
  }
  return null;
}

/**
 * D27 ship model / D35 aquarium (ON_SIDEBOARD, delivered without cabinets): a cabinetLow sideboard against a wall (a holder with the
 * room's loot table) with the piece standing on it, flush with its back (host decor). `post` = storey base for post-dress placements.
 */
function onSideboard(ctx: PlaceCtx, a: Area, kind: PropKind, sides?: Side[], post = 0, checkZone = true): PropPlacement | null {
  const base = placeAgainstWall(ctx, a, 'cabinetLow', {sides, front: 0.7, tries: 14, checkZone});
  if (!base) return null;
  base.y += post;
  const host = ctx.layout.props.length - 1;
  const cab = PROP_DEFS.cabinetLow, def = PROP_DEFS[kind];
  const fx = Math.round(Math.sin(base.rot)), fz = Math.round(Math.cos(base.rot)), back = -(cab.d - def.d) / 2;
  const {hx, hz} = footprint(kind, base.rot);
  const p: PropPlacement = {kind, x: r3(base.x + fx * back), z: r3(base.z + fz * back), y: r3(base.y + cab.h), rot: base.rot, area: a.id, hx, hz, h: def.h,
    blocksSight: false, variant: 0, host, ...(ctx.level ? {level: ctx.level} : {})};
  ctx.layout.props.push(p);
  return p;
}

/**
 * Task office-props-physics-scale-20261030 (lane FURN, user: "some times these displays are placed backwards"): SERVE-OVER displays —
 * kinds operable from their BACK (the bakery case's display trays pull out of its open staff side, prop -Z; its customer glass is the
 * prop front +Z) — and the staff aisle (m) they keep behind them. They used to be wall / row pieces (back flush to the wall: the trays
 * trapped against it) or turned at random (reception hero / islands / scatter: the open staff side to the room).
 */
export const SERVE_BEHIND: ReadonlyMap<string, number> = new Map([['bakeryCase', 1.0]]);

/**
 * A serve-over display like a shop counter: its back toward a wall with the staff aisle between them (open floor of the room, reserved
 * so nothing is placed in it), its customer front to the room (+ a front strip); else free-standing with a walkway ring all round.
 */
function serveCounter(ctx: PlaceCtx, a: Area, kind: PropKind, sides?: Side[], post = 0): PropPlacement | null {
  const def = PROP_DEFS[kind], aisle = SERVE_BEHIND.get(kind) ?? 1.0, g = ctx.g;
  for (const side of sides ?? ctx.rng.shuffle(SIDES.slice())) {
    const [lo, hi] = wallRange(a, side);
    if (hi - lo < def.w + 0.3) continue;
    const alongX = side === 'N' || side === 'S';
    for (let t = 0; t < 10; t++) {
      const along = q4(ctx.rng.range(lo + def.w / 2 + 0.1, hi - def.w / 2 - 0.1));
      const [x, z] = wallXZ(a, side, along, aisle + def.d / 2 + 0.03);
      const [sx, sz] = wallXZ(a, side, along, (aisle + 0.03) / 2);
      const [x0, y0, x1, y1] = cellsOfBox(sx, sz, alongX ? def.w / 2 - 0.05 : aisle / 2 - 0.02, alongX ? aisle / 2 - 0.02 : def.w / 2 - 0.05);
      let free = true;
      for (let cy = y0; cy <= y1 && free; cy++) for (let cx = x0; cx <= x1; cx++) {
        if (!g.inBounds(cx, cy) || !g.walkable(cx, cy) || g.area[g.idx(cx, cy)] !== a.id || ctx.keep[g.idx(cx, cy)]) { free = false; break; }
      }
      if (!free) continue;
      const p = tryPlaceProp(ctx, a, kind, r3(x), r3(z), WALL_ROT[side], {front: 0.8});
      if (!p) continue;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) markCell(ctx, ctx.keep, g.idx(cx, cy));
      p.y += post;
      return p;
    }
  }
  const p = island(ctx, a, kind, Math.max(0.9, aisle));
  if (p) p.y += post;
  return p;
}

/** Placement of a kind with a placement rule of its own (sideboard pieces, the kegerator, serve-over displays), else null = not special. */
function special(ctx: PlaceCtx, a: Area, kind: PropKind, sides?: Side[], post = 0): PropPlacement | null | undefined {
  if (SERVE_BEHIND.has(kind)) return serveCounter(ctx, a, kind, sides, post); // lane FURN
  if (ON_SIDEBOARD.has(kind)) return onSideboard(ctx, a, kind, sides, post) ?? (sides ? onSideboard(ctx, a, kind, undefined, post) : null);
  if (SIDE_TO_WALL.has(kind)) { const p = sideToWall(ctx, a, kind); if (p) p.y += post; return p; }
  return undefined;
}

/** Runs one recipe step in a room (pre-dress); window steps are deferred to post. */
function runStep(d: OfficeDress, ctx: PlaceCtx, a: Area, s: Step, ds: Side): void {
  if (s.chance !== undefined && !ctx.rng.chance(s.chance)) return;
  if ((s.at === 'wall' || s.at === 'row' || s.at === 'island' || s.at === 'scatter') && (ON_SIDEBOARD.has(s.kind) || SIDE_TO_WALL.has(s.kind) || SERVE_BEHIND.has(s.kind))) {
    const n = count(ctx, s.n), wall = 'wall' in s ? s.wall : undefined;
    for (let i = 0; i < n; i++) special(ctx, a, s.kind, wall ? wallsFor(ctx, wall, ds) : undefined);
    return;
  }
  switch (s.at) {
    case 'wall': {
      const n = count(ctx, s.n);
      for (let i = 0; i < n; i++) {
        const o = {sides: wallsFor(ctx, s.wall, ds), front: s.front, tries: 16};
        if (!placeAgainstWall(ctx, a, s.kind, o) && s.wall && s.wall !== 'any') placeAgainstWall(ctx, a, s.kind, {...o, sides: SIDES.slice()});
      }
      return;
    }
    case 'row': {
      // The preferred wall first, then any other (item 9's root cause: a 'far' row on a held facade wall placed nothing).
      let left = count(ctx, s.n);
      const pref = wallsFor(ctx, s.wall, ds);
      for (const side of [...pref, ...ctx.rng.shuffle(SIDES.filter(q => !pref.includes(q)))]) {
        if (left <= 0) break;
        const [lo, hi] = wallRange(a, side);
        const got = rowAlongWall(ctx, a, side, s.kind, {from: lo + 0.45, to: hi - 0.45, max: left, front: s.front}).length;
        left -= got;
        if (got) break;
      }
      return;
    }
    case 'rows': freeRows(ctx, a, s.kind, count(ctx, s.n), s.pair, s.aisle); return;
    case 'island': { const n = count(ctx, s.n); for (let i = 0; i < n; i++) island(ctx, a, s.kind, s.ring); return; }
    case 'scatter': { const n = count(ctx, s.n); for (let i = 0; i < n; i++) scatter(ctx, a, s.kind, s.ring); return; }
    case 'seating': seating(ctx, a, s.sofa, s.chair, ds); return;
    case 'corners': { const n = count(ctx, s.n); for (let i = 0; i < n; i++) corner(ctx, a, s.kind); return; }
    case 'window': (d.deferred ??= []).push({area: a.id, step: s}); return;
    case 'facing': {
      const host = ctx.layout.props.find(p => p.area === a.id && p.kind === s.host && (p.level ?? 0) === ctx.level);
      if (!host) return;
      const n = count(ctx, s.n);
      const fx = Math.round(Math.sin(host.rot)), fz = Math.round(Math.cos(host.rot)), lx = fz, lz = -fx;
      const span = PROP_DEFS[s.kind].w + 0.6;
      // In front of the host (its +Z face); the far side only when nothing fits in front.
      for (const side of [1, -1]) {
        let got = 0;
        for (let i = 0; i < n; i++) {
          const t = (i - (n - 1) / 2) * span;
          for (const dd of [0, 0.4, -0.3, 0.8]) {
            const dist = (PROP_DEFS[s.host].d / 2 + s.dist + dd) * side;
            if (tryPlaceProp(ctx, a, s.kind, q4(host.x + fx * dist + lx * t), q4(host.z + fz * dist + lz * t), side > 0 ? host.rot + Math.PI : host.rot)) { got++; break; }
          }
        }
        if (got) break;
      }
      return;
    }
  }
}
const runSteps = (d: OfficeDress, ctx: PlaceCtx, a: Area, steps: readonly Step[]) => { const ds = doorSideOf(ctx, a); for (const s of steps) runStep(d, ctx, a, s, ds); };

/** Work surfaces / tables a refurnish pass may repeat as islands. */
const REPEAT_ISLANDS: ReadonlySet<PropKind> = new Set(['table', 'conferenceTable', 'labBench', 'coffeeRoaster', 'mixingConsole', 'foosballTable', 'pingPongTable']);
/**
 * Task office-interactions-layout-20261030 (lane LAYOUT, item 5): a SECOND pass of a company room's own recipe to furnish a large room
 * the first pass left nearly empty — only its multi-unit furniture (rows of desks / benches / racks / shelving / machines, its table
 * islands, wall pieces it places several of), never another statue / hero or sideboard piece. Pre-dress frame (local y); the caller
 * lifts. Returns the number of props placed.
 */
export function refurnish(d: OfficeDress, ctx: PlaceCtx, a: Area, m: OfficeAreaMeta): number {
  const c = companyOf(d);
  if (!c || !m.program) return 0;
  const n0 = ctx.layout.props.length;
  const steps = roomSteps(c, m.program).filter(s => s.at !== 'window' && s.at !== 'facing' && s.at !== 'seating' && s.at !== 'corners' && s.at !== 'scatter'
    && !ON_SIDEBOARD.has(s.kind) && !SIDE_TO_WALL.has(s.kind)
    && (s.at === 'rows' || s.at === 'row' || (s.at === 'island' && REPEAT_ISLANDS.has(s.kind)) || (s.at === 'wall' && s.n[1] >= 2)));
  runSteps(d, ctx, a, steps.map(s => ({...s, chance: undefined})));
  return ctx.layout.props.length - n0;
}

// ---------------------------------------------------------------------------------------------
// Pre-dress

/**
 * Company / executive / server pre-dressing of one area. Returns true when the area is fully dressed here (dress.ts skips its
 * default program), false to let the iteration-16 default run (base rooms, cubicle farms); companyExtras then adds the company's
 * own pieces to those.
 */
export function companyPre(d: OfficeDress, ctx: PlaceCtx, a: Area, m: OfficeAreaMeta): boolean {
  if (m.role === 'server') { serverRoom(ctx, a); return true; }
  if (m.role === 'exec') { execSuite(d, ctx, a); return true; }
  const c = companyOf(d);
  if (!c || !m.program) return false;
  const key = m.program;
  if (key === 'reception') { reception(d, ctx, a, c); return true; }
  if (m.role === 'open') {
    // Lane LAYOUT: the work commons (too shallow for cubicle pods) gets bench-desk clusters down its middle, then its own pieces.
    if (m.commons && (key === 'cubicles' || key === 'pods' || key === 'newsroom')) { benchRows(ctx, a); runSteps(d, ctx, a, roomSteps(c, key)); return true; }
    if (key === 'cubicles') return false;
    if (key === 'pods' || key === 'newsroom') cubicleFarm(d, ctx, a, 'open', true);
    runSteps(d, ctx, a, roomSteps(c, key));
    return true;
  }
  if (key === 'private' || key === 'partner') return false;
  if (BASE_ROOMS.has(key as RoomKey)) return false;
  runSteps(d, ctx, a, roomSteps(c, key));
  return true;
}

/** The company's own pieces in rooms the default program dressed (meeting rooms, cubicle farms, private offices …). */
export function companyExtras(d: OfficeDress, ctx: PlaceCtx, a: Area, m: OfficeAreaMeta): void {
  const c = companyOf(d);
  if (c && m.role === 'bay') {
    // The strip between the office run and the corridor (paralegal bay, nurses' station): filing at its ends, a pot plant.
    const ends: Side[] = a.w >= a.h ? ['W', 'E'] : ['N', 'S'];
    for (let i = 0, n = ctx.rng.int(1, 2); i < n; i++) placeAgainstWall(ctx, a, 'officeFiling', {sides: ends, front: 0.6, tries: 6});
    placeAgainstWall(ctx, a, 'pottedPlantSmall', {sides: ends, front: 0.3, tries: 6});
    return;
  }
  if (!c || !m.program || m.role === 'server' || m.role === 'exec') return;
  const key = m.program;
  if (!(key === 'cubicles' || key === 'private' || key === 'partner' || BASE_ROOMS.has(key as RoomKey))) return;
  const steps = c.program.steps[key];
  if (steps?.length) runSteps(d, ctx, a, steps);
}

const isWallKind = (kind: PropKind): boolean => {
  const asset = isCompanyKind(kind) ? COMPANY_KIND_ASSET[kind] : undefined;
  return !!asset && COMPANY_ASSET_SPECS[asset]?.placement === 'wall';
};

/**
 * The company reception (N band, opening on the corridor side = S): logo wall in front of the windows, the reception desk facing
 * the opening (receptionist between them), the hero signature prop, lounge seating, planters flanking the opening, extras.
 */
function reception(d: OfficeDress, ctx: PlaceCtx, a: Area, c: Company): void {
  const ax0 = a.x * CELL, ax1 = (a.x + a.w) * CELL, az0 = a.y * CELL;
  const f = d.frame;
  const dc = (f.door.x + f.door.w / 2 + MARGIN) * CELL;
  const cx0 = q4(Math.max(ax0 + 2.6, Math.min(ax1 - 2.6, dc)));
  const lw = PROP_DEFS.logoWall, desk = PROP_DEFS.receptionDesk;
  const logoZ = r3(az0 + CELL + 0.06 + lw.d / 2);
  let logo: PropPlacement | null = null;
  for (const dx of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) { logo = tryPlaceProp(ctx, a, 'logoWall', cx0 + dx, logoZ, 0); if (logo) break; }
  const cx = logo ? logo.x : cx0;
  const deskZ = r3(logoZ + lw.d / 2 + 1.05 + desk.d / 2);
  let rd: PropPlacement | null = null;
  for (const dx of [0, 0.5, -0.5, 1, -1]) { rd = tryPlaceProp(ctx, a, 'receptionDesk', cx + dx, deskZ, 0, {front: 1.2}); if (rd) break; }
  // The hero: wall pieces against a side wall facing in, floor pieces on a plinth spot front-left / front-right of the desk.
  const sides: Side[] = ctx.rng.shuffle(['W', 'E'] as Side[]);
  const meta = d.tower.meta.get(a.id);
  const free = sides.filter(s => !meta?.facade.includes(s));
  const heroSide = free[0] ?? sides[0];
  const hero = c.hero;
  const tries: (() => PropPlacement | null)[] = [];
  // Sideboard pieces / the kegerator: their own placement rule (side walls first). The kegerator may take a corner by the glass:
  // the window strip is released for that one placement (and the cells it covers leave the held list).
  if (SIDE_TO_WALL.has(hero)) tries.push(() => besideGlass(d, a, () => sideToWall(ctx, a, hero)));
  if (ON_SIDEBOARD.has(hero) || SIDE_TO_WALL.has(hero) || SERVE_BEHIND.has(hero)) tries.push(() => special(ctx, a, hero, [heroSide, ...free.filter(q => q !== heroSide)]) ?? null, () => special(ctx, a, hero) ?? null);
  else {
  if (isWallKind(hero)) tries.push(() => placeAgainstWall(ctx, a, hero, {sides: [heroSide], front: 0.8, tries: 10}), () => placeAgainstWall(ctx, a, hero, {sides: ['W', 'E', 'S'], front: 0.6, tries: 16}));
  const dz = rd ? rd.z + desk.d / 2 + 0.4 + PROP_DEFS[hero].d / 2 + 0.6 : deskZ + 2.2;
  for (const ring of [0.6, 0.3]) for (const sx of heroSide === 'W' ? [-1, 1] : [1, -1]) for (const dx of [2.1, 2.6, 3.1, 3.6, 1.6]) {
    tries.push(() => tryPlaceProp(ctx, a, hero, q4(cx + sx * (dx + Math.max(0, PROP_DEFS[hero].w - 1) / 2)), q4(dz), ctx.rng.chance(0.5) ? 0 : Math.PI, {ring}));
  }
  // Bulky heroes (Ironclad's 3.1 m wide portal) end against a wall with no access strip, or anywhere on open floor.
  tries.push(() => scatter(ctx, a, hero, 0.4, 40), () => placeAgainstWall(ctx, a, hero, {front: 0.5, tries: 24}), () => island(ctx, a, hero, 0.3),
    () => placeAgainstWall(ctx, a, hero, {tries: 32}), () => scatter(ctx, a, hero, 0, 60));
  }
  if (!tries.some(t => t()) && SIDE_TO_WALL.has(hero)) (d.deferred ??= []).push({area: a.id, step: {at: 'corners', kind: hero, n: [1, 1]}});
  // Lounge seating on the other side, planters flanking the opening and in a corner.
  const seatSide = free[1] ?? (heroSide === 'W' ? 'E' : 'W');
  const sofa = placeAgainstWall(ctx, a, 'lobbySofa', {sides: [seatSide], front: 0.5, tries: 10});
  if (sofa) {
    const fx = Math.round(Math.sin(sofa.rot)), fz = Math.round(Math.cos(sofa.rot));
    const lx = fz, lz = -fx, off = PROP_DEFS.lobbySofa.d / 2 + 1.5 + PROP_DEFS.loungeArmchair.d / 2;
    for (const s of [-1, 1]) tryPlaceProp(ctx, a, 'loungeArmchair', r3(sofa.x + fx * off + lx * 0.6 * s), r3(sofa.z + fz * off + lz * 0.6 * s), sofa.rot + Math.PI);
  }
  for (let i = 0; i < 2; i++) placeAgainstWall(ctx, a, 'planterTree', {sides: ['S'], front: 0.4, tries: 8});
  corner(ctx, a, 'planterTree');
  runSteps(d, ctx, a, roomSteps(c, 'reception'));
}

/** Runs a pre-dress placement with the room's window strip released; the cells the placed prop covers stay blocked (not held). */
function besideGlass(d: OfficeDress, a: Area, fn: () => PropPlacement | null): PropPlacement | null {
  const g = d.layout.levels[d.level].grid;
  const mine = d.held.filter(i => g.area[i] === a.id);
  for (const i of mine) g.blocked[i] = 0;
  const p = fn();
  const under = new Set<number>();
  if (p) {
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) under.add(g.idx(cx, cy));
  }
  for (const i of mine) g.blocked[i] = 1;
  if (under.size) d.held = d.held.filter(i => !under.has(i));
  return p;
}

/**
 * Item 7: the executive suite — executive desk on the room's far half facing the door (chair behind it: post), a chesterfield
 * against a side wall, a globe bar, bookcases (the company's law bookcases where it has them), a planter. The purpose rules then
 * add the credenza (cabinetLow, a holder) / safe; no generic desk, office chair or monitor.
 */
function execSuite(d: OfficeDress, ctx: PlaceCtx, a: Area): void {
  const ds = doorSideOf(ctx, a), far = OPPOSITE[ds];
  const def = PROP_DEFS.executiveDesk;
  const alongDoorX = ds === 'N' || ds === 'S';
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const cx = (ax0 + ax1) / 2, cz = (az0 + az1) / 2;
  // Desk 1.9 m off the far wall (room for the chair), facing the door.
  const off = def.d / 2 + 1.9;
  const fx = far === 'W' ? ax0 + off : far === 'E' ? ax1 - off : cx, fz = far === 'N' ? az0 + off : far === 'S' ? az1 - off : cz;
  const rot = WALL_ROT[far];
  let desk: PropPlacement | null = null;
  for (const o of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    for (const back of [0, 0.5, 1]) {
      const x = q4(alongDoorX ? fx + o : fx + (far === 'W' ? back : -back)), z = q4(alongDoorX ? fz + (far === 'N' ? back : -back) : fz + o);
      desk = tryPlaceProp(ctx, a, 'executiveDesk', x, z, rot, {ring: 0.5});
      if (desk) break;
    }
    if (desk) break;
  }
  const c = companyOf(d);
  const sides = sideWallsOf(ds);
  if (!placeAgainstWall(ctx, a, 'chesterfieldSofa', {sides, front: 0.8, tries: 12})) placeAgainstWall(ctx, a, 'chesterfieldSofa', {front: 0.6, tries: 20});
  const shelf: PropKind = c?.signature.includes('lawBookcase') ? 'lawBookcase' : 'officeShelf';
  for (const side of [far, ...ctx.rng.shuffle(sides.slice())]) {
    const [lo, hi] = wallRange(a, side);
    if (rowAlongWall(ctx, a, side, shelf, {from: lo + 0.45, to: hi - 0.45, max: 2, front: 0.6}).length) break;
  }
  corner(ctx, a, 'globeBar') ?? placeAgainstWall(ctx, a, 'globeBar', {front: 0.4, tries: 20}) ?? scatter(ctx, a, 'globeBar', 0.4, 20);
  corner(ctx, a, 'planterTree');
  if (ctx.rng.chance(0.6)) placeAgainstWall(ctx, a, 'loungeArmchair', {sides, front: 0.5});
}

/**
 * Item 9: the server room — rows of racks with hot / cold aisles across the room (a server cabinet closes some rows), a CRAC unit
 * against a wall, at least two racks (a wall row is the fallback). Root cause of the empty rooms: see TENANTS.notes / the purpose.
 */
function serverRoom(storey: PlaceCtx, a: Area): void {
  // Task office-props-physics-scale-20261030 (lane RACK): the room dresses on its OWN stream (forked per area, the storey's stream
  // is not drawn from), so the rack footprint / count never shifts the rooms dressed after it (the rebuilt 0.6 m rack fits more per
  // row than B10's 1.23 m cabinet did; the CRAC unit's placement tries then drew a different number of times).
  const ctx: PlaceCtx = {...storey, rng: storey.rng.fork(`server-room:${a.id}`)};
  const racks = freeRows(ctx, a, 'serverRack', ctx.rng.int(6, 12), true, 1.2);
  if (racks.length < 2) {
    for (const side of ctx.rng.shuffle(SIDES.slice())) {
      const [lo, hi] = wallRange(a, side);
      // (lane LAYOUT: a 1.2 m service aisle in front, as between the free-standing rows; lane RACK: the rebuilt 42U rack's perforated door is 0.6 m wide)
      racks.push(...rowAlongWall(ctx, a, side, 'serverRack', {from: lo + 0.45, to: hi - 0.45, max: 4 - racks.length, front: 1.2}));
      if (racks.length >= 2) break;
    }
  }
  // E05 is a 2.9 m three-bay run of cabinets: one per wall, sometimes a second on another wall.
  let runs = ctx.rng.chance(0.4) ? 2 : 1;
  for (const side of ctx.rng.shuffle(SIDES.slice())) {
    if (runs <= 0) break;
    const [lo, hi] = wallRange(a, side);
    runs -= rowAlongWall(ctx, a, side, 'serverCabinet', {from: lo + 0.45, to: hi - 0.45, max: 1, front: 0.9}).length;
  }
  placeAgainstWall(ctx, a, 'cracUnit', {front: 1.0, tries: 20});
}

// ---------------------------------------------------------------------------------------------
// Post-dress

/** Chairs / stools pulled up to company work surfaces (sitter side +Z unless noted): host decor, collides, never blocks. */
const SEAT_AT: Partial<Record<PropKind, {kind: PropKind; behind?: boolean; n?: number}>> = {
  tradingDesk: {kind: 'officeChair'}, mixingConsole: {kind: 'officeChair'}, cctvConsole: {kind: 'officeChair'}, monitorDesk: {kind: 'officeChair'},
  // (lane LAYOUT, per OPEN: no chair at the lab benches — their 15 drawers open on the sitter side and would pass through it)
  newsDesk: {kind: 'officeChair', behind: true, n: 2}, executiveDesk: {kind: 'executiveChair', behind: true},
};

export function companyPost(d: OfficeDress, ctx: PlaceCtx): void {
  const {layout} = d;
  const c = companyOf(d);
  const lv = d.level ? {level: d.level} : {};
  const mine = (a: Area | undefined) => !!a && d.tower.meta.has(a.id);
  // Deferred window pieces (telescopes by the glass), now that the window strip is released.
  for (const {area, step} of d.deferred ?? []) {
    const a = layout.areas[area], m = d.tower.meta.get(area);
    if (!a || !m) continue;
    // A kegerator hero that found no free corner before the window strip was released: a corner by the glass now.
    if (step.at === 'corners' && SIDE_TO_WALL.has(step.kind)) { special(ctx, a, step.kind, undefined, d.base); continue; }
    if (step.at !== 'window') continue;
    const n = count(ctx, step.n);
    for (let i = 0; i < n; i++) {
      const p = placeAgainstWall(ctx, a, step.kind, {sides: m.facade.length ? m.facade : undefined, front: 0.6, tries: 16});
      if (p) p.y += d.base;
    }
  }
  d.deferred = [];
  // Seats at company work surfaces (and the executive chair behind the executive desk).
  const n0 = layout.props.length;
  for (let pi = 0; pi < n0; pi++) {
    const p = layout.props[pi];
    const seat = SEAT_AT[p.kind];
    if (!seat || (p.level ?? 0) !== d.level || !mine(layout.areas[p.area]) || layout.props.some(q => q.host === pi)) continue;
    const def = PROP_DEFS[p.kind];
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot), lx = Math.cos(p.rot), lz = -Math.sin(p.rot);
    const back = seat.behind ? -1 : 1;
    const off = def.d / 2 + 0.32;
    const k = seat.n ?? 1;
    for (let i = 0; i < k; i++) {
      const t = k > 1 ? (i - (k - 1) / 2) * def.w * 0.4 : 0;
      hostDecor(d, p, pi, seat.kind, p.x + fx * off * back + lx * t, p.z + fz * off * back + lz * t, back > 0 ? p.rot + Math.PI : p.rot, p.y, lv);
    }
  }
  // Task office-props-physics-scale-20261030 (lane FURN): the lab benches' glassware / the trading desks' monitors and keyboards are
  // separate props on their tops now (gen/office/hostClutter.ts; after the seats: a seat is host decor of the same desk)
  placeHostClutter(layout.props, d.level, d.rng.fork('host-clutter'));
  if (c) {
    const style = companySignStyle(c);
    const t = d.tower.tenant!;
    // Logo plates on the reception's logo wall.
    for (const p of layout.props) {
      if (p.kind !== 'logoWall' || (p.level ?? 0) !== d.level || !mine(layout.areas[p.area])) continue;
      const z = r3(p.z + p.hz + 0.012), w = Math.min(3.6, PROP_DEFS.logoWall.w - 0.3);
      layout.signs.push({kind: 'station', text: c.name.toUpperCase(), x: p.x, y: r3(d.base + 1.95), z, rot: 0, area: p.area, w, style, ...lv});
      layout.signs.push({kind: 'info', text: c.tagline.toUpperCase(), x: p.x, y: r3(d.base + 1.42), z, rot: 0, area: p.area, w: Math.min(2.8, w), style: {...style, bg: c.palette.trim, fg: c.palette.accent}, ...lv});
    }
    // Wayfinding in the elevator lobby (the core wall beside the elevator).
    const N = d.tower.north, f = d.frame;
    const dc = (f.door.x + f.door.w / 2 + MARGIN) * CELL;
    const text = t.part === 0 ? `${c.name.toUpperCase()} · RECEPTION` : `${c.name.toUpperCase()} · RECEPTION ${t.floor - 1}`;
    for (let k = 0; k < 18; k++) {
      const dx = (3 + Math.floor(k / 2) * 0.75) * (k % 2 ? -1 : 1);
      if (wallSign(ctx, layout, N, 'S', dc + dx, d.base + 2.05, {kind: 'info', text, w: 2.4, style, ...(t.part ? {arrow: 'down' as const} : {}), ...lv})) break;
    }
    signatureGuarantee(d, ctx, c);
  }
  corridorClearance(d, ctx);
  sealPockets(d);
  if (c) {
    for (const id of d.tower.meta.keys()) {
      const a = layout.areas[id], m = d.tower.meta.get(id)!;
      if (m.role === 'landing' || a.label.startsWith(`${c.short} · `)) continue;
      a.label = `${c.short} · ${a.label}`;
    }
  }
  if (d.floor === 1) directory(d, ctx);
}

/** Each signature kind of the floor's company stands at least once on the floor (company rooms first, then any room of it). */
function signatureGuarantee(d: OfficeDress, ctx: PlaceCtx, c: Company): void {
  const {layout} = d;
  const areas = [...d.tower.meta.entries()].map(([id, m]) => ({a: layout.areas[id], m}))
    .filter(({m}) => m.role !== 'corridor' && m.role !== 'landing' && m.role !== 'wc' && m.role !== 'closet' && m.role !== 'server');
  const rank = ({m}: {m: OfficeAreaMeta}) => (m.program && !BASE_ROOMS.has(m.program as RoomKey) && m.role !== 'open' ? 0 : m.role === 'open' || m.role === 'reception' ? 1 : 2);
  areas.sort((p, q) => rank(p) - rank(q) || q.a.w * q.a.h - p.a.w * p.a.h);
  for (const kind of c.signature) {
    if (layout.props.some(p => p.kind === kind && (p.level ?? 0) === d.level)) continue;
    let placed: PropPlacement | null | undefined = null;
    if (ON_SIDEBOARD.has(kind) || SIDE_TO_WALL.has(kind) || SERVE_BEHIND.has(kind)) {
      for (const {a} of areas) { if (special(ctx, a, kind, undefined, d.base)) { placed = undefined; break; } }
      if (placed !== null) continue;
      for (const {a} of areas) if (ON_SIDEBOARD.has(kind) ? onSideboard(ctx, a, kind, undefined, d.base, false) : null) break;
      continue;
    }
    for (const {a} of areas) {
      placed = placeAgainstWall(ctx, a, kind, {front: 0.5, tries: 12}) ?? scatter(ctx, a, kind, 0.4, 12);
      if (placed) break;
    }
    if (!placed) for (const {a} of areas) { placed = placeAgainstWall(ctx, a, kind, {front: 0.3, tries: 24, checkZone: false}); if (placed) break; }
    if (placed) placed.y += d.base;
  }
}

// ---------------------------------------------------------------------------------------------
// Item 8: corridor clearance + small plants

/** Clear width (m) every cross-section of a passage narrower than NARROW_M keeps. */
export const CORRIDOR_CLEAR_M = 1.5;
export const NARROW_M = 4;
/** Props at or above this height over the floor are overhead (not in the walking width). */
const OVERHEAD_M = 2.0;
const PLANT_KINDS: ReadonlySet<string> = new Set(['deadPlant', 'planterTree', 'pottedPlantSmall']);
export const isPlantKind = (kind: string): boolean => PLANT_KINDS.has(kind);

/** Passages whose clear width is policed: office corridors (any storey) narrower than NARROW_M. */
export function isNarrowPassage(a: Area): boolean {
  return a.type === 'office-corridor' && Math.min(a.w, a.h) * CELL < NARROW_M - 1e-6;
}

/**
 * Worst cross-section of a passage: the largest clear interval across it, minimised over every cross-section (cell centres along
 * its long axis), with every prop box of its storey below head height that overlaps it subtracted. Returns [metres, worst index].
 */
export function passageClear(layout: StationLayout, a: Area, skip?: ReadonlySet<PropPlacement>): {clear: number; at: number} {
  const lv = a.level ?? 0, base = layout.levels?.[lv]?.baseY ?? 0;
  const alongX = a.w >= a.h;
  const s0 = (alongX ? a.y : a.x) * CELL, s1 = (alongX ? a.y + a.h : a.x + a.w) * CELL;
  const props = layout.props.filter(p => (p.level ?? 0) === lv && !skip?.has(p) && p.y - base < OVERHEAD_M
    && p.x + p.hx > a.x * CELL && p.x - p.hx < (a.x + a.w) * CELL && p.z + p.hz > a.y * CELL && p.z - p.hz < (a.y + a.h) * CELL);
  let worst = Infinity, at = -1;
  const n = alongX ? a.w : a.h;
  for (let i = 0; i < n; i++) {
    const u = ((alongX ? a.x : a.y) + i + 0.5) * CELL;
    const cuts: [number, number][] = [];
    for (const p of props) {
      const pu0 = alongX ? p.x - p.hx : p.z - p.hz, pu1 = alongX ? p.x + p.hx : p.z + p.hz;
      if (u < pu0 || u > pu1) continue;
      cuts.push(alongX ? [p.z - p.hz, p.z + p.hz] : [p.x - p.hx, p.x + p.hx]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let best = 0, cur = s0;
    for (const [c0, c1] of cuts) { if (c0 > cur) best = Math.max(best, Math.min(c0, s1) - cur); cur = Math.max(cur, c1); }
    best = Math.max(best, s1 - cur);
    if (best < worst) { worst = best; at = i; }
  }
  return {clear: worst, at};
}

/** Removes props from the layout (host indices remapped, their host decor too; grid cells of removed blocking props released). */
function removeProps(d: OfficeDress, drop: ReadonlySet<PropPlacement>): void {
  if (!drop.size) return;
  const {layout} = d;
  const old = layout.props;
  const gone = new Set<PropPlacement>();
  for (const p of old) if (drop.has(p) || (p.host !== undefined && drop.has(old[p.host]))) gone.add(p);
  const idx = new Map<number, number>();
  const keep: PropPlacement[] = [];
  old.forEach((p, i) => { if (!gone.has(p)) { idx.set(i, keep.length); keep.push(p); } });
  for (const p of keep) if (p.host !== undefined) p.host = idx.get(p.host);
  for (const p of gone) {
    if (p.host !== undefined || p.mounted) continue;
    const lv = p.level ?? 0, g = layout.levels[lv].grid;
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
    const covered = keep.filter(q => (q.level ?? 0) === lv && q.host === undefined && !q.mounted
      && q.x + q.hx > x0 * CELL && q.x - q.hx < (x1 + 1) * CELL && q.z + q.hz > y0 * CELL && q.z - q.hz < (y1 + 1) * CELL).map(q => cellsOfBox(q.x, q.z, q.hx, q.hz));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy) || covered.some(b => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3])) continue;
      const i = g.idx(cx, cy);
      g.blocked[i] = 0;
      g.sightBlocked[i] = 0;
    }
  }
  layout.props.length = 0;
  for (const p of keep) layout.props.push(p);
}

/**
 * Item 8: in every narrow office passage of the storey, decor that narrows a cross-section below CORRIDOR_CLEAR_M is removed
 * (deepest first), then 0-2 small potted plants stand against its walls where the clear width allows (outside door zones and the
 * landing strip; never the dead plant / planter tree).
 */
function corridorClearance(d: OfficeDress, ctx: PlaceCtx): void {
  const {layout} = d;
  const drop = new Set<PropPlacement>();
  const passages = [...d.tower.meta.keys()].map(id => layout.areas[id]).filter(a => a && isNarrowPassage(a));
  for (const a of passages) {
    for (let guard = 0; guard < 24; guard++) {
      const {clear, at} = passageClear(layout, a, drop);
      if (clear >= CORRIDOR_CLEAR_M - 1e-6 || at < 0) break;
      const alongX = a.w >= a.h;
      const u = ((alongX ? a.x : a.y) + at + 0.5) * CELL;
      const lv = a.level ?? 0, base = layout.levels[lv].baseY;
      const hit = layout.props.filter(p => !drop.has(p) && (p.level ?? 0) === lv && p.y - base < OVERHEAD_M
        && (alongX ? Math.abs(p.x - u) <= p.hx : Math.abs(p.z - u) <= p.hz)
        && p.x + p.hx > a.x * CELL && p.x - p.hx < (a.x + a.w) * CELL && p.z + p.hz > a.y * CELL && p.z - p.hz < (a.y + a.h) * CELL);
      if (!hit.length) break;
      hit.sort((p, q) => (alongX ? q.hz - p.hz : q.hx - p.hx));
      drop.add(hit[0]);
    }
  }
  removeProps(d, drop);
  // Small plants against corridor walls (keep the clear width; the elevator landing strip stays empty).
  const ls = landingStrip(d.frame);
  const strip = {x0: (ls.x + MARGIN) * CELL - 0.3, z0: (ls.y + MARGIN) * CELL - 0.3, x1: (ls.x + ls.w + MARGIN) * CELL + 0.3, z1: (ls.y + ls.h + MARGIN) * CELL + 0.3};
  for (const a of passages) {
    const n = ctx.rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const p = placeAgainstWall(ctx, a, 'pottedPlantSmall', {front: 0.3, tries: 10});
      if (!p) continue;
      p.y += d.base;
      const onStrip = p.x + p.hx > strip.x0 && p.x - p.hx < strip.x1 && p.z + p.hz > strip.z0 && p.z - p.hz < strip.z1;
      if (onStrip || passageClear(layout, a).clear < CORRIDOR_CLEAR_M - 1e-6) removeProps(d, new Set([p]));
    }
  }
}

/**
 * Pockets (company floors): once the window strip is released, a row of furniture placed while it was held (a logo wall + a portal
 * + turnstiles across a reception, say) can wall off strip cells behind it. One flood over the storey's free floor from its elevator
 * lobby; free cells of the storey's areas it cannot reach are blocked (behind furniture: nobody walks, spawns or drops loot there).
 */
function sealPockets(d: OfficeDress): void {
  if (!d.tower.tenant) return;
  const {layout} = d;
  const g = layout.levels[d.level].grid;
  const free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i];
  const seen = new Uint8Array(g.w * g.h);
  const stack: number[] = [];
  const N = d.tower.north;
  for (let y = N.y; y < N.y + N.h; y++) for (let x = N.x; x < N.x + N.w; x++) { const i = g.idx(x, y); if (free(i) && g.area[i] === N.id) { seen[i] = 1; stack.push(i); } }
  if (!stack.length) return;
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (j >= 0 && j < seen.length && !seen[j] && free(j)) { seen[j] = 1; stack.push(j); }
  }
  for (const id of d.tower.meta.keys()) {
    const a = layout.areas[id];
    if (!a) continue;
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (g.area[i] === id && free(i) && !seen[i] && g.rampIdx[i] < 0) g.blocked[i] = 1;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Lobby: the tenant directory

/** Directory lines (top floor first; a company on two floors is one line "4–5 · NAME"). */
export function directoryLines(levelSeed: number): {floors: number[]; text: string; style: SignStyle}[] {
  const out: {floors: number[]; text: string; style: SignStyle}[] = [];
  for (const t of officeTenants(levelSeed)) {
    const last = out[out.length - 1];
    if (last && t.part > 0) { last.floors.push(t.floor); continue; }
    out.push({floors: [t.floor], text: '', style: companySignStyle(COMPANIES[t.company])});
  }
  for (const l of out) {
    const t = officeTenants(levelSeed).find(q => q.floor === l.floors[0])!;
    l.text = `${l.floors.length > 1 ? `${l.floors[0]}–${l.floors[l.floors.length - 1]}` : l.floors[0]} · ${t.name.toUpperCase()}`;
  }
  return out.reverse();
}

/** The TENANT DIRECTORY on the lobby hall's core wall beside the elevators: a header plate and one company plate per line. */
function directory(d: OfficeDress, ctx: PlaceCtx): void {
  const {layout, frame: f} = d;
  const hall = d.tower.north;
  const lines = directoryLines(f.levelSeed);
  const W = 1.8, HW = 2.2, step = 0.29;
  const top = d.base + 2.75;
  const ys = [top, ...lines.map((_, i) => top - 0.4 - i * step)];
  const dc = (f.door.x + f.door.w / 2 + MARGIN) * CELL;
  const z = (hall.y + hall.h) * CELL - 0.02;
  const lv = d.level ? {level: d.level} : {};
  for (let k = 0; k < 48; k++) {
    const t = q4(dc + (3.2 + Math.floor(k / 2) * 0.5) * (k % 2 ? -1 : 1));
    if (t - HW / 2 < hall.x * CELL + 0.3 || t + HW / 2 > (hall.x + hall.w) * CELL - 0.3) continue;
    // Solid wall behind the whole column (no opening under any plate), no other plate in the way.
    if (!backed(ctx, hall, 'S', t - HW / 2, t + HW / 2, d.base + 0.1)) continue;
    const y0 = ys[ys.length - 1] - 0.2, y1 = top + 0.2;
    if (layout.signs.some(s => (s.level ?? 0) === d.level && Math.abs(s.z - z) < 0.3 && Math.abs(s.x - t) < HW / 2 + (s.w ?? 1.2) / 2 && s.y > y0 && s.y < y1)) continue;
    const base: Omit<SignPlacement, 'kind' | 'text' | 'y' | 'w'> = {x: t, z, rot: Math.PI, area: hall.id, ...lv};
    layout.signs.push({...base, kind: 'info', w: HW, text: 'TENANT DIRECTORY', y: r3(ys[0]), style: {bg: 0x1f2225, fg: 0xe8e2d0, accent: 0xb89b5e, font: 'sans'}});
    lines.forEach((l, i) => layout.signs.push({...base, kind: 'service', w: W, text: l.text, y: r3(ys[i + 1]), style: l.style}));
    return;
  }
}

/** Kinds a company floor shows that no other company uses (QA / tests). */
export const companySignatureKinds = (c: Company): readonly PropKind[] => c.signature;
/** Plate text of a company room / open style (door plates on tenant floors). */
export function roomPlate(c: Company, key: string, fallback: string): string {
  if (key in ROOMS) {
    const info: RoomInfo = ROOMS[key as RoomKey];
    return (info.plate ?? c.program.labels?.[key as RoomKey] ?? info.label).toUpperCase();
  }
  if (key in OPEN_STYLES) return (c.program.labels?.[key as OpenStyle] ?? OPEN_STYLES[key as OpenStyle].label).toUpperCase();
  if (key in RUNS) return RUNS[key as keyof typeof RUNS].label.toUpperCase();
  return fallback;
}
