// Task studio-skyways-rework-20261107-054512-01 (lane VENUE; user: "anime event must be substantial building floor / venue, not single
// room: bridge leads to event building floor with multiple event areas"): the dressing of the convention VENUE floor (layout version 3,
// layout.skyways.addon.venue — gen/skyways/carve.ts carveVenue) beyond the main stage hall (gen/skyways/addonConvention.ts):
//  - REGISTRATION (the corridors in from the bridges): a row of cloth-draped badge desks with a staff chair behind each, a stanchion
//    queue line in front of them (velvet ropes between neighbouring posts: world/skywaysAddonRuntime.ts, from addon.queues), the
//    REGISTRATION plate over them, the event's welcome sign and the `registration-wave` mascot statue greeting the bridge mouth;
//  - the EXHIBITORS' FLOOR (the host's skyway court pieces): artist-alley / vendor table rows (the merch table with its loose stock on
//    top — boxed figures, plushes, print cards — and a vendor's folding chair behind), and the pop-up exhibits: a retro game corner
//    (arcade cabinets, capsule-toy machines, the giant teddy) and a cosplay display of mannequins; poster boards, wall posters;
//  - PANEL ROOMS: the panel table (two cloth-draped tables) with the panelists' chairs behind it facing audience rows of folding
//    chairs either side of an aisle from the door, the panel's key art on the wall behind;
//  - the PHOTO LOUNGE: a photo-op wall with the `photo-pose` mascot statue in front of it, lounge seating, plants;
//  - the pre-function FOYER (approach 'foyer'): poster boards;
//  - event WAYFINDING on the layout's sign system: plates over the event doors (MAIN STAGE, PANEL ROOM A / B, PHOTO LOUNGE, and
//    WASHROOMS in the main hall) and hanging direction signs where people come in, their arrows along the real route (the next
//    opening toward each target).
// Circulation: 1.5 m stays clear in front of every door; every furniture group is placed only if each opening of its area that was
// reachable before is still reachable by a body needing a 1.2 m wide path (cells whose 0.6 m disc is clear), and the routes found
// are then reserved as lanes — so every bridge / stair entry keeps reaching every room door, the stage hall and the washrooms. The
// washrooms / backstage / storage keep the station's ordinary dressing. Pure data; the rng is consumed only here. Props: existing kinds
// (the prop rules' audits / scale records already cover them); the statues are static (never NPCs).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {WALL_ROT, backed, begin, commit, rollback, rowAlongWall, wallRange, wallXZ} from '../placeKit';
import type {Area, Door, Side, SignPlacement, StationLayout} from '../stationTypes';
import {AddonDresser, doorPoint, hallFrame, normYaw, r3, toWorld, uvXZ, yawToward, type HallFrame} from './addonFrame';
import {merchOn, statueAt, type ConventionResult} from './addonConvention';
import {SKYWAYS_POSTER_Y, SKYWAYS_TABLE_BANNER} from './addonKinds';
import {SKYWAYS_VENUE_BOOTHS, SKYWAYS_VENUE_SLIDES} from '../../assets/skywaysVenueArt.generated';
import {SKYWAYS_CON_POSTERS} from '../../assets/skywaysArt.generated';
import {SKYWAYS_ROPE} from './addonPrize';
import type {SkywaysAddon, SkywaysVenueRole} from './skywaysTypes';

/** Clearance radius of the routes kept between the openings of every venue area (m: a 1.2 m wide path). */
export const VENUE_ROUTE_R = 0.6;
/** Half width of the lanes reserved along those routes (m). */
export const VENUE_LANE_HALF = 0.8;
/** Clear floor in front of every door of a venue area (m). */
export const VENUE_DOOR_CLEAR = 1.5;
/** Wayfinding plate height above the floor and its least width (m). */
export const VENUE_SIGN = {y: 2.45, w: 1.5} as const;
/** The event's wayfinding plates (deep aurora violet, warm white letters, a gold accent). */
export const VENUE_SIGN_STYLE = {bg: 0x2a1f4a, fg: 0xf7f2ff, accent: 0xf2c14e, font: 'rounded'} as const;

export interface VenueSign { sign: SignPlacement; to: string; target: {x: number; z: number} | null }
export interface VenueLane { area: number; ax: number; az: number; bx: number; bz: number; half: number }
export interface VenueResult {
  /** Every prop placed per venue area id (floor + hosted). */
  byArea: Record<number, PropPlacement[]>;
  roles: Record<number, SkywaysVenueRole>;
  desks: PropPlacement[];
  /** Stanchion posts in rope order (chains: addon.queues). */
  queues: PropPlacement[][];
  welcome: PropPlacement[];
  tables: PropPlacement[];
  merch: PropPlacement[];
  exhibits: PropPlacement[];
  panels: {area: number; tables: PropPlacement[]; panelists: PropPlacement[]; chairs: PropPlacement[]; screen: PropPlacement | null}[];
  photo: {area: number; backdrop: PropPlacement[]; seats: PropPlacement[]} | null;
  /** The registration signs on the walls behind the desks, the artist-alley booth banners on the vendor tables' fronts. */
  regSigns: PropPlacement[];
  banners: PropPlacement[];
  statues: ConventionResult['statues'];
  signs: VenueSign[];
  lanes: VenueLane[];
  skipped: string[];
}

/** An opening of an area: its centre on the boundary, the unit normal into the area, half its width, what it leads to. */
export interface Portal { x: number; z: number; nx: number; nz: number; half: number; to: number; door: Door | null; side: Side }
const SIDES: Side[] = ['N', 'S', 'W', 'E'];

interface VenueCtx {
  v: AddonDresser;
  res: VenueResult;
  portals: ReadonlyMap<number, Portal[]>;
  hub: ReadonlyMap<number, Portal | null>;
  /** The openings reachable from the hub before the venue was dressed (per area: the reach key that must survive). */
  reach0: Map<number, string>;
  /** The whole walk (lane VENUE round 2): the public venue areas + the main hall, the cell window round them, the bridge mouths' bands
   *  (the sources) and what they reach before dressing (every opening of the public areas a 1.2 m path reaches from a bridge). */
  walk: {ids: ReadonlySet<number>; x0: number; y0: number; w: number; h: number; sources: number[]; key0: string; pub: readonly Area[]};
  roleOf: (id: number) => SkywaysVenueRole | undefined;
  bridges: ReadonlySet<number>;
}

/** Dresses the venue's public areas (no-op without addon.venue). Run after the main hall's dresser lifted its props. */
export function dressSkywaysVenue(layout: StationLayout, rng: Rng): VenueResult | null {
  const addon = layout.skyways?.addon;
  const venue = addon?.venue;
  if (!addon || addon.id !== 'convention' || !venue?.length) return null;
  const pub = venue.filter(q => q.role !== 'washrooms' && q.role !== 'backstage' && q.role !== 'storage' && q.role !== 'main-hall');
  const areas = pub.map(q => layout.areas[q.area]).filter(Boolean);
  if (!areas.length) return null;
  const v = new AddonDresser(layout, rng, {...addon, areas: pub.map(q => q.area)} as SkywaysAddon, areas[0]);
  const res: VenueResult = {byArea: {}, roles: Object.fromEntries(pub.map(q => [q.area, q.role] as const)), desks: [], queues: [], welcome: [], tables: [], merch: [], exhibits: [],
    panels: [], photo: null, regSigns: [], banners: [], statues: [], signs: [], lanes: [], skipped: v.skipped};
  const roleOf = (id: number) => venue.find(q => q.area === id)?.role;
  const bridges = new Set((layout.skyways?.bridges ?? []).map(b => b.area));
  const portals = new Map(areas.map(a => [a.id, portalsOf(layout, v.g, a)] as const));
  const hub = new Map(areas.map(a => [a.id, hubPortal(portals.get(a.id)!, bridges, roleOf)] as const));
  const hallArea = layout.areas[venue.find(q => q.role === 'main-hall')?.area ?? -1];
  const walkAreas = hallArea ? [...areas, hallArea] : areas;
  const wx0 = Math.min(...walkAreas.map(a => a.x)) - 1, wy0 = Math.min(...walkAreas.map(a => a.y)) - 1;
  const walk = {ids: new Set(walkAreas.map(a => a.id)), x0: wx0, y0: wy0, w: Math.max(...walkAreas.map(a => a.x + a.w)) + 1 - wx0, h: Math.max(...walkAreas.map(a => a.y + a.h)) + 1 - wy0,
    sources: areas.flatMap(a => portals.get(a.id)!.filter(p => bridges.has(p.to)).flatMap(p => bandCells(v.g, a, p))), key0: '', pub: areas};
  const vc: VenueCtx = {v, res, portals, hub, reach0: new Map(), roleOf, bridges, walk};
  // --- 0. door strips; the reach every area must keep ------------------------------------------------------------------------
  for (const a of areas) for (const p of portals.get(a.id)!) if (p.door) v.keepDoor(p.door, a, VENUE_DOOR_CLEAR, 0.3);
  for (const a of areas) vc.reach0.set(a.id, reachKey(vc, a));
  walk.key0 = walkKey(vc);
  const n0 = layout.props.length;

  // --- 1. the big furniture of every area (each group kept only if the area's routes survive), then its routes become lanes ----
  const order = (r: SkywaysVenueRole) => areas.filter(q => roleOf(q.id) === r);
  // the greeter / welcome sign first (a small registration keeps them at its bridge mouth; the desks may then go one area on)
  for (const a of order('registration')) greet(vc, a);
  for (const a of order('registration')) {
    const mouth = portals.get(a.id)!.find(p => bridges.has(p.to)) ?? null;
    if (!mouth && a.kind === 'concourse' && a.type === 'concourse') continue; // the main stage foyer: boards only (below)
    registrationDesks(vc, a);
  }
  order('panel').forEach((a, k) => dressPanel(vc, a, panelLetter(a, k)));
  for (const a of order('photo-lounge')) dressPhotoLounge(vc, a);
  const pieces = order('exhibitors').sort((p, q) => q.w * q.h - p.w * p.h);
  const corner = gameCorner(vc, pieces); // (the arcade pair claims its wall first: the vendor rows fill around it)
  pieces.forEach((a, k) => exhibitorRows(vc, a, k));
  exhibits(vc, pieces, corner);
  for (const a of areas) markRoutes(vc, a);
  markWalkRoutes(vc);
  // --- 2. the smaller pieces: greeters / welcome signs at the bridge mouths, exhibits, boards, posters -----------------------------
  for (const a of areas) boards(vc, a, roleOf(a.id) === 'exhibitors' ? (a === pieces[0] ? 2 : 1) : roleOf(a.id) === 'registration' ? 2 : roleOf(a.id) === 'panel' ? 0 : 1);
  {
    const order2 = rng.shuffle(SKYWAYS_CON_POSTERS.map((_, i) => i));
    let k = 0;
    for (const a of areas) {
      const want = roleOf(a.id) === 'exhibitors' ? 3 : 2;
      for (const s of posterSlots(v, a).slice(0, want)) {
        v.push({kind: 'skywaysConPoster', x: s.x, z: s.z, y: SKYWAYS_POSTER_Y, rot: WALL_ROT[s.side], area: a.id, hx: s.hx, hz: s.hz, h: PROP_DEFS.skywaysConPoster.h,
          blocksSight: false, variant: order2[k++ % order2.length], mounted: true});
      }
    }
  }
  // --- 3. wayfinding -------------------------------------------------------------------------------------------------------------
  wayfinding(vc, areas);

  v.lift();
  for (let k = n0; k < layout.props.length; k++) {
    const p = layout.props[k], id = p.host !== undefined ? layout.props[p.host].area : p.area;
    (res.byArea[id] ??= []).push(p);
  }
  for (const a of areas) if (!res.byArea[a.id]?.some(p => !p.mounted)) res.skipped.push(`venue: ${roleOf(a.id)} ${a.id} bare`);
  // the queue ropes' chains (prop indices; world/skywaysAddonRuntime.ts draws a velvet rope between neighbours of a chain)
  addon.queues = res.queues.filter(c => c.length >= 2).map(c => c.map(p => layout.props.indexOf(p)));
  return res;
}

// ---------------------------------------------------------------------------------------------
// Openings and routes

/** Every opening of an area on its storey: doors (centre, normal into the area) and open joins with a neighbouring area's floor. */
export function portalsOf(layout: StationLayout, g: AddonDresser['g'], a: Area): Portal[] {
  const out: Portal[] = [];
  const lv = a.level ?? 0;
  const doorCells = new Set<number>();
  for (const d of layout.doors) {
    if (d.a !== a.id && d.b !== a.id) continue;
    const other = d.a === a.id ? d.b : d.a;
    if ((layout.areas[other]?.level ?? 0) !== lv) continue;
    const p = doorPoint(d, a);
    out.push({x: p.x, z: p.z, nx: p.nx, nz: p.nz, half: p.half, to: other, door: d, side: p.side});
    for (let y = d.y - 1; y <= d.y + d.h; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y)) doorCells.add(g.idx(x, y));
  }
  for (const side of SIDES) {
    const along = side === 'N' || side === 'S', len = along ? a.w : a.h;
    let run: {t0: number; t1: number; to: number} | null = null;
    const flush = () => {
      if (!run) return;
      const n = run.t1 - run.t0 + 1, mid = (run.t0 + run.t1 + 1) / 2;
      const x = along ? (a.x + mid) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
      const z = along ? (side === 'N' ? a.y * CELL : (a.y + a.h) * CELL) : (a.y + mid) * CELL;
      const nrm = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]}[side];
      if (n >= 2) out.push({x, z, nx: nrm[0], nz: nrm[1], half: n * CELL / 2, to: run.to, door: null, side});
      run = null;
    };
    for (let t = 0; t < len; t++) {
      const cx = along ? a.x + t : side === 'W' ? a.x : a.x + a.w - 1, cy = along ? (side === 'N' ? a.y : a.y + a.h - 1) : a.y + t;
      const ox = cx + (side === 'W' ? -1 : side === 'E' ? 1 : 0), oy = cy + (side === 'N' ? -1 : side === 'S' ? 1 : 0);
      let to = -1;
      if (g.inBounds(ox, oy)) {
        const i = g.idx(cx, cy), o = g.idx(ox, oy);
        if (g.cells[i] === FLOOR && g.area[i] === a.id && g.cells[o] === FLOOR && g.area[o] >= 0 && g.area[o] !== a.id && !doorCells.has(o) && !doorCells.has(i)
          && Math.abs(g.floorOf(o) - g.floorOf(i)) < 0.5) to = g.area[o];
      }
      if (run && (to < 0 || to !== run.to)) flush();
      if (to >= 0) { if (run) run.t1 = t; else run = {t0: t, t1: t, to}; }
    }
    flush();
  }
  return out;
}
/** A point `d` m into the area from an opening. */
const inside = (p: Portal, d: number): [number, number] => [p.x + p.nx * d, p.z + p.nz * d];
/** The opening the area's routes radiate from: a bridge mouth, else the way toward registration, else the widest. */
function hubPortal(ps: readonly Portal[], bridges: ReadonlySet<number>, roleOf: (id: number) => SkywaysVenueRole | undefined): Portal | null {
  if (!ps.length) return null;
  return ps.find(p => bridges.has(p.to)) ?? ps.find(p => roleOf(p.to) === 'registration') ?? ps.slice().sort((p, q) => q.half - p.half)[0];
}
/** Cells of `a` within 1 m of an opening's line, along its span. */
export function bandCells(g: AddonDresser['g'], a: Area, p: Portal): number[] {
  const out: number[] = [], along = p.side === 'N' || p.side === 'S';
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
    const depth = along ? Math.abs(cz - p.z) : Math.abs(cx - p.x), off = along ? Math.abs(cx - p.x) : Math.abs(cz - p.z);
    if (depth <= 1.05 && off <= p.half - 0.2) out.push(g.idx(x, y));
  }
  return out;
}
/** A cell of `a` a 1.2 m wide body stands in (its disc clear of walls and props). */
export function routeCell(g: AddonDresser['g'], a: Area, i: number, r = VENUE_ROUTE_R): boolean {
  return g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i] && g.circleClear((i % g.w + 0.5) * CELL, (Math.floor(i / g.w) + 0.5) * CELL, r);
}
/** BFS over the route cells of `a` from the hub's band: parent per cell of the area's rect (-1 = a source, -2 = unreached), or null. */
function routeField(vc: VenueCtx, a: Area): Int32Array | null {
  const g = vc.v.g, hub = vc.hub.get(a.id);
  if (!hub) return null;
  const W = a.w, parent = new Int32Array(a.w * a.h).fill(-2);
  const loc = (i: number) => (Math.floor(i / g.w) - a.y) * W + (i % g.w - a.x);
  const glob = (l: number) => (a.y + Math.floor(l / W)) * g.w + a.x + (l % W);
  const q: number[] = [];
  for (const i of bandCells(g, a, hub)) if (routeCell(g, a, i)) { parent[loc(i)] = -1; q.push(loc(i)); }
  for (let k = 0; k < q.length; k++) {
    const l = q[k], x = l % W, y = Math.floor(l / W);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= a.h) continue;
      const m = ny * W + nx;
      if (parent[m] === -2 && routeCell(g, a, glob(m))) { parent[m] = l; q.push(m); }
    }
  }
  return parent;
}
/** The local (area-rect) index of a grid cell index. */
const locOf = (g: AddonDresser['g'], a: Area, i: number) => (Math.floor(i / g.w) - a.y) * a.w + (i % g.w - a.x);
/** Which openings of `a` the hub reaches by a 1.2 m path (their indices). */
function reachKey(vc: VenueCtx, a: Area): string {
  const f = routeField(vc, a), g = vc.v.g;
  if (!f) return '';
  const ps = vc.portals.get(a.id)!;
  return ps.map((p, k) => (bandCells(g, a, p).some(i => f[locOf(g, a, i)] !== -2) ? k : -1)).filter(k => k >= 0).join(',');
}
/**
 * (lane VENUE round 2) The whole walk: a BFS over the route cells of the public venue areas and the main hall from every bridge mouth's
 * band (local per-area routes do not compose across areas: two areas may each keep their own hub routes yet meet only at cells the
 * other cannot reach). Parent per cell of the walk window (-1 = a source, -2 = unreached).
 */
function walkField(vc: VenueCtx): Int32Array {
  const g = vc.v.g, W = vc.walk;
  const parent = new Int32Array(W.w * W.h).fill(-2);
  const ok = (cx: number, cy: number) => {
    if (cx < W.x0 || cy < W.y0 || cx >= W.x0 + W.w || cy >= W.y0 + W.h) return false;
    const i = g.idx(cx, cy);
    return g.cells[i] === FLOOR && W.ids.has(g.area[i]) && !g.blocked[i] && g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, VENUE_ROUTE_R);
  };
  const q: number[] = [];
  for (const i of W.sources) {
    const cx = i % g.w, cy = Math.floor(i / g.w), l = (cy - W.y0) * W.w + (cx - W.x0);
    if (parent[l] === -2 && ok(cx, cy)) { parent[l] = -1; q.push(l); }
  }
  for (let k = 0; k < q.length; k++) {
    const l = q[k], x = l % W.w, y = Math.floor(l / W.w);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W.w || ny >= W.h) continue;
      const m = ny * W.w + nx;
      if (parent[m] === -2 && ok(W.x0 + nx, W.y0 + ny)) { parent[m] = l; q.push(m); }
    }
  }
  return parent;
}
const walkLoc = (vc: VenueCtx, i: number) => (Math.floor(i / vc.v.g.w) - vc.walk.y0) * vc.walk.w + (i % vc.v.g.w - vc.walk.x0);
/** Which openings of the public venue areas a bridge mouth reaches by a 1.2 m path. */
function walkKey(vc: VenueCtx): string {
  const f = walkField(vc), g = vc.v.g;
  return vc.walk.pub.map(a => vc.portals.get(a.id)!.map((p, k) => (bandCells(g, a, p).some(i => f[walkLoc(vc, i)] !== -2) ? k : '')).join('.')).join('|');
}
/** The whole walk's routes from the bridge mouths to every opening of the public areas become reserved lanes too. */
function markWalkRoutes(vc: VenueCtx): void {
  const f = walkField(vc), g = vc.v.g, W = vc.walk;
  const at = (l: number): [number, number] => [(W.x0 + l % W.w + 0.5) * CELL, (W.y0 + Math.floor(l / W.w) + 0.5) * CELL];
  for (const a of W.pub) for (const p of vc.portals.get(a.id)!) {
    if (vc.bridges.has(p.to)) continue;
    const band = bandCells(g, a, p).map(i => walkLoc(vc, i)).filter(l => f[l] !== -2);
    if (!band.length) continue;
    const [px, pz] = inside(p, 0.5);
    let l = band.sort((m, n) => Math.hypot(at(m)[0] - px, at(m)[1] - pz) - Math.hypot(at(n)[0] - px, at(n)[1] - pz))[0];
    const path: number[] = [l];
    while (f[l] >= 0) { l = f[l]; path.push(l); }
    let s = 0;
    for (let k = 1; k <= path.length; k++) {
      const turn = k === path.length || (k >= 2 && path[k] - path[k - 1] !== path[k - 1] - path[k - 2]);
      if (!turn) continue;
      const A = at(path[s]), B = at(path[k - 1]);
      vc.v.keepSegment(A[0], A[1], B[0], B[1], VENUE_LANE_HALF);
      s = k - 1;
    }
  }
}
/** Places a group of props; keeps it only if every opening of the given areas the hub reached before is still reached. */
function group<T>(vc: VenueCtx, check: readonly Area[], place: () => T | null): T | null {
  const v = vc.v;
  begin(v.ctx);
  const np = v.placed.length;
  const out = place();
  if (out !== null && check.every(a => reachKey(vc, a) === vc.reach0.get(a.id)) && walkKey(vc) === vc.walk.key0) { commit(v.ctx); return out; }
  rollback(v.ctx);
  v.placed.length = np;
  return null;
}
/** The routes from the hub to each opening become reserved lanes (recorded as straight runs). */
function markRoutes(vc: VenueCtx, a: Area): void {
  const f = routeField(vc, a), g = vc.v.g, hub = vc.hub.get(a.id);
  if (!f || !hub) return;
  const at = (l: number): [number, number] => [(a.x + l % a.w + 0.5) * CELL, (a.y + Math.floor(l / a.w) + 0.5) * CELL];
  for (const p of vc.portals.get(a.id)!) {
    if (p === hub) continue;
    const band = bandCells(g, a, p).map(i => locOf(g, a, i)).filter(l => f[l] !== -2);
    if (!band.length) continue;
    const [px, pz] = inside(p, 0.5);
    let l = band.sort((m, n) => Math.hypot(at(m)[0] - px, at(m)[1] - pz) - Math.hypot(at(n)[0] - px, at(n)[1] - pz))[0];
    const path: number[] = [l];
    while (f[l] >= 0) { l = f[l]; path.push(l); }
    // straight runs of the path
    let s = 0;
    for (let k = 1; k <= path.length; k++) {
      const turn = k === path.length || (k >= 2 && path[k] - path[k - 1] !== path[k - 1] - path[k - 2]);
      if (!turn) continue;
      const A = at(path[s]), B = at(path[k - 1]);
      vc.v.keepSegment(A[0], A[1], B[0], B[1], VENUE_LANE_HALF);
      vc.res.lanes.push({area: a.id, ax: r3(A[0]), az: r3(A[1]), bx: r3(B[0]), bz: r3(B[1]), half: VENUE_LANE_HALF});
      s = k - 1;
    }
  }
}

/**
 * The areas along the way in from a registration corridor (itself first, then the registration / exhibitors' pieces one and two
 * openings on), each with the opening it is entered by: a corridor too narrow for the desks or the greeter hands them on.
 */
function entryAreas(vc: VenueCtx, a: Area): {area: Area; at: Portal}[] {
  const mouth = vc.portals.get(a.id)!.find(p => vc.bridges.has(p.to)) ?? vc.hub.get(a.id);
  if (!mouth) return [];
  const out: {area: Area; at: Portal; d: number}[] = [{area: a, at: mouth, d: 0}], seen = new Set([a.id]);
  for (let k = 0; k < out.length; k++) {
    const cur = out[k];
    if (cur.d >= 2) continue;
    for (const p of vc.portals.get(cur.area.id) ?? []) {
      const r = vc.roleOf(p.to);
      if (seen.has(p.to) || (r !== 'registration' && r !== 'exhibitors') || !vc.portals.has(p.to)) continue;
      const back = (vc.portals.get(p.to) ?? []).find(q => q.to === cur.area.id);
      if (!back) continue;
      seen.add(p.to);
      out.push({area: vc.v.layout.areas[p.to], at: back, d: cur.d + 1});
    }
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------------------------------------
// Areas

const frameOf = (a: Area, p: Portal | null): HallFrame => hallFrame(a, p?.side ?? 'S');
/** A panel room's letter index (0 = A): from the carve's label ("Panel room B"), else its order. */
const panelLetter = (a: Area, k: number): number => { const m = / ([A-Z])$/.exec(a.label ?? ''); return m ? m[1].charCodeAt(0) - 65 : k; };
const snapC = (x: number) => Math.floor(x / CELL) * CELL + CELL / 2;
const propsSince = (v: AddonDresser, n: number) => v.layout.props.slice(n);

/** The badge desks: 1-3 cloth-draped tables 0.75 m off a solid wall (a staff chair behind each), a stanchion queue line in front. */
function registrationDesks(vc: VenueCtx, reg: Area): void {
  const {res} = vc;
  for (const {area: a, at: mouth} of entryAreas(vc, reg)) if (deskRow(vc, a, mouth)) return;
  res.skipped.push(`venue: registration ${reg.id} desks`);
}
function deskRow(vc: VenueCtx, a: Area, mouth: Portal | null): boolean {
  const {v, res} = vc;
  const sides = SIDES.filter(s => !mouth || s !== mouth.side).sort((p, q) => sideLen(a, q) - sideLen(a, p));
  const def = PROP_DEFS.skywaysConMerchTable, off = 0.75 + def.d / 2;
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    const most = Math.min(3, Math.floor((hi - lo - 1.2) / (def.w + 0.05)));
    for (let want = most; want >= 1; want--) {
      const span = want * (def.w + 0.05) - 0.05, mid = (lo + hi) / 2;
      const starts: number[] = [];
      for (let t0 = Math.ceil((lo + 0.6) * 2) / 2; t0 + span <= hi - 0.6; t0 += 0.5) starts.push(t0);
      starts.sort((p, q) => Math.abs(p + span / 2 - mid) - Math.abs(q + span / 2 - mid));
      for (const t0 of starts) {
        if (!backed(v.ctx, a, side, t0, t0 + span, v.base + 1.0)) continue;
        const got = group(vc, [a], () => {
          const row: PropPlacement[] = [];
          for (let k = 0; k < want; k++) {
            const [x, z] = wallXZ(a, side, t0 + def.w / 2 + k * (def.w + 0.05), off);
            const p = v.put('skywaysConMerchTable', x, z, WALL_ROT[side], {area: a, front: 1.2});
            if (!p) return null;
            row.push(p);
          }
          // the queue line 1.5 m in front of the desks (posts that do not fit are left out; a rope never crosses a lane)
          const c0 = row[0], c1 = row[row.length - 1], ux = side === 'N' || side === 'S' ? 1 : 0, uz = 1 - ux, fx = Math.sin(c0.rot), fz = Math.cos(c0.rot);
          const ext = def.w / 2 + 0.4, qd = def.d / 2 + 1.5;
          const ax = c0.x - ux * ext + fx * qd, az = c0.z - uz * ext + fz * qd, bx = c1.x + ux * ext + fx * qd, bz = c1.z + uz * ext + fz * qd;
          const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.2) + 1);
          const chains: PropPlacement[][] = [];
          let chain: PropPlacement[] = [];
          for (let k = 0; k < n; k++) {
            const t = k / (n - 1);
            const p = v.putRound('skywaysPrizeStanchion', ax + (bx - ax) * t, az + (bz - az) * t, c0.rot, {area: a, checkZone: false});
            if (!p) { if (chain.length) chains.push(chain); chain = []; continue; }
            const last = chain[chain.length - 1];
            if (last && Math.hypot(p.x - last.x, p.z - last.z) > SKYWAYS_ROPE.maxSpan) { chains.push(chain); chain = []; }
            chain.push(p);
          }
          if (chain.length) chains.push(chain);
          return {row, chains: chains.filter(c => c.length >= 2)};
        });
        if (!got) continue;
        // staff chairs behind the desks (facing them)
        for (const t of got.row) {
          const ch = group(vc, [a], () => v.put('foldingChair', snapC(t.x - Math.sin(t.rot) * (def.d / 2 + 0.38)), snapC(t.z - Math.cos(t.rot) * (def.d / 2 + 0.38)), t.rot, {area: a}));
          void ch;
        }
        res.desks.push(...got.row);
        res.queues.push(...got.chains);
        // the registration sign on the wall behind the desks (above the staff's heads), centred on the row
        {
          const k = PROP_DEFS.skywaysVenueRegSign, c0 = got.row[0], c1 = got.row[got.row.length - 1], along = side === 'N' || side === 'S';
          const t = along ? (c0.x + c1.x) / 2 : (c0.z + c1.z) / 2, y = 1.3;
          if (backed(v.ctx, a, side, t - k.w / 2, t + k.w / 2, v.base + y + 0.05) && backed(v.ctx, a, side, t - k.w / 2, t + k.w / 2, v.base + y + k.h - 0.05)) {
            const [x, z] = wallXZ(a, side, t, k.d / 2 + 0.004), f = footprint('skywaysVenueRegSign', WALL_ROT[side]);
            res.regSigns.push(v.push({kind: 'skywaysVenueRegSign', x: r3(x), z: r3(z), y, rot: WALL_ROT[side], area: a.id, hx: r3(f.hx), hz: r3(f.hz), h: k.h, blocksSight: false, variant: 0, mounted: true}));
          }
        }
        // the REGISTRATION plate hung over the middle of the desk row, facing the queue
        const c0 = got.row[0], c1 = got.row[got.row.length - 1], fx = Math.sin(c0.rot), fz = Math.cos(c0.rot);
        if (a.ceil - v.base >= VENUE_SIGN.y + 0.6) {
          const sign: SignPlacement = {x: r3((c0.x + c1.x) / 2 + fx * 0.2), y: r3(v.base + VENUE_SIGN.y + 0.15), z: r3((c0.z + c1.z) / 2 + fz * 0.2), rot: r3(c0.rot), kind: 'info',
            text: 'REGISTRATION · BADGE PICKUP', area: a.id, hang: true, w: 2.6, level: v.level, style: VENUE_SIGN_STYLE};
          v.layout.signs.push(sign);
          res.signs.push({sign, to: 'REGISTRATION', target: null});
        }
        return true;
      }
    }
  }
  return false;
}

/**
 * The welcome sign and the `registration-wave` greeter at a bridge mouth, facing the people coming in (a corridor too narrow for them:
 * just inside the next area along the way in, still greeting the arrivals).
 */
function greet(vc: VenueCtx, a: Area): void {
  const {v, res} = vc;
  if (!vc.portals.get(a.id)!.some(p => vc.bridges.has(p.to))) return;
  const spots = entryAreas(vc, a);
  let sign: PropPlacement | null = null, statue: VenueResult['statues'][number] | null = null;
  // the greeter first (nearest the way in), then the welcome sign beside it
  for (const pass of ['statue', 'sign'] as const) for (const sp of spots) {
    if (pass === 'statue' ? statue : sign) break;
    const m = sp.at, tx = -m.nz, tz = m.nx;
    for (const side of [1, -1]) for (const lat of [m.half + 0.9, m.half + 1.6, m.half + 2.4, 1.6, 2.6, 0.9, m.half + 3.4, m.half + 4.6]) for (const dv of [1.6, 2.0, 2.8, 3.6, 4.6, 1.25, 0.75]) {
      if (pass === 'statue' ? statue : sign) break;
      const x = m.x + m.nx * dv + tx * lat * side, z = m.z + m.nz * dv + tz * lat * side;
      if (pass === 'statue') statue = group(vc, [sp.area], () => statueAt(v, 'registration-wave', x, z, yawToward(m.x - x, m.z - z), sp.area));
      else sign = group(vc, [sp.area], () => v.put('skywaysConWelcome', x, z, quarterToward(m.x - x, m.z - z), {area: sp.area, front: 0.6}));
    }
  }
  if (statue) res.statues.push(statue); else res.skipped.push(`venue: registration ${a.id} greeter`);
  if (sign) res.welcome.push(sign); else res.skipped.push(`venue: registration ${a.id} welcome sign`);
}

/**
 * A panel room: the panel table (two cloth-draped tables, one in a narrow room) with its panelists behind it facing audience rows of
 * folding chairs either side of an aisle from the door, and the panel's title slide (each room its own): on a tripod screen centred
 * against the back wall of a deep room, else beside the table; a compact room: on a screen fixed to the wall behind the panel.
 */
function dressPanel(vc: VenueCtx, a: Area, letter: number): void {
  const {v, res} = vc, ps = vc.portals.get(a.id)!;
  const door = ps.find(p => p.door) ?? ps[0] ?? null;
  const fr = frameOf(a, door);
  const def = PROP_DEFS.skywaysConMerchTable;
  const out: VenueResult['panels'][number] = {area: a.id, tables: [], panelists: [], chairs: [], screen: null};
  const du = door ? xzToU(fr, door.x, door.z) : fr.W / 2;
  const nT = fr.W >= 2 * def.w + 1.6 ? 2 : 1, half = nT * (def.w + 0.03) / 2;
  let uc = Math.round(Math.max(half + 0.8, Math.min(fr.W - half - 0.8, fr.W / 2)) * 2) / 2;
  const sd = PROP_DEFS.skywaysVenueScreen, deep = fr.D >= 7.2, slide = letter % SKYWAYS_VENUE_SLIDES.length;
  if (deep) {
    const [x, z] = uvXZ(fr, uc, fr.D - sd.d / 2 - 0.04);
    out.screen = group(vc, [a], () => v.put('skywaysVenueScreen', x, z, fr.toFront, {area: a, variant: slide}));
  } else {
    for (const s of [1, -1]) {
      const us = Math.round((s > 0 ? fr.W - 0.45 - sd.w / 2 : 0.45 + sd.w / 2) * 2) / 2, ut = us - s * (sd.w / 2 + 0.3 + half);
      if (ut - half - 0.4 < 0 || ut + half + 0.4 > fr.W) continue;
      const [x, z] = uvXZ(fr, us, fr.D - sd.d / 2 - 0.04);
      out.screen = group(vc, [a], () => v.put('skywaysVenueScreen', x, z, fr.toFront, {area: a, variant: slide}));
      if (out.screen) { uc = ut; break; }
    }
  }
  // the panel table facing the door, 1.3 m off the back wall (in front of a centred screen: a free cell row stays between the panelists'
  // chairs and it, the floor behind the table one connected space); the panelists behind it
  const back = out.screen && deep ? sd.d + 1.75 : 1.3, vt = fr.D - back - def.d / 2;
  for (const s of nT === 2 ? [-1, 1] : [0]) {
    const [x, z] = uvXZ(fr, uc + s * (def.w / 2 + 0.03), vt);
    const t = v.put('skywaysConMerchTable', x, z, fr.toFront, {area: a});
    if (t) out.tables.push(t);
  }
  if (!out.tables.length) { res.skipped.push(`venue: panel ${a.id} table`); res.panels.push(out); return; }
  for (const k of nT === 2 ? [-1.5, -0.5, 0.5, 1.5] : [-0.5, 0.5]) {
    const [x, z] = uvXZ(fr, uc + k * 0.95, vt + def.d / 2 + 0.45);
    const c = v.put('foldingChair', snapC(x), snapC(z), fr.toFront, {area: a});
    if (c) out.panelists.push(c);
  }
  // the aisle: the door -> the panel table's front
  const A = uvXZ(fr, du, 0.9), B = uvXZ(fr, uc, vt - def.d / 2 - 0.9);
  v.keepSegment(A[0], A[1], B[0], B[1], 0.7);
  res.lanes.push({area: a.id, ax: r3(A[0]), az: r3(A[1]), bx: r3(B[0]), bz: r3(B[1]), half: 0.7});
  // audience rows facing the panel, either side of the aisle (a compact room: closer rows, down to the door's clear strip)
  const gap = deep ? 1.5 : 1.2, last = deep ? 1.4 : 1.0;
  for (let vr = vt - def.d / 2 - gap; vr >= last; vr -= 0.95) {
    for (let u = 0.6; u <= fr.W - 0.6; u += 0.55) {
      if (v.rng.chance(deep ? 0.06 : 0.03)) continue;
      const [x, z] = uvXZ(fr, u, vr);
      const c = v.put('foldingChair', snapC(x), snapC(z), normYaw(fr.toBack + (v.rng.chance(0.06) ? (v.rng.chance(0.5) ? 0.5 : -0.5) * Math.PI : 0)), {area: a});
      if (c) out.chairs.push(c);
    }
  }
  // no room for a tripod: the title slide on a screen fixed to the wall behind the panelists (above their heads); else the key-art poster
  const side = fr.back, t = (fr.front === 'N' || fr.front === 'S' ? fr.x0 : fr.z0) + uc, along = side === 'N' || side === 'S';
  for (const kind of out.screen ? [] : ['skywaysVenueWallScreen', 'skywaysConPoster'] as const) {
    const pd = PROP_DEFS[kind], y = kind === 'skywaysVenueWallScreen' ? 1.15 : 1.35;
    if (!backed(v.ctx, a, side, t - pd.w / 2, t + pd.w / 2, v.base + y + 0.05) || !backed(v.ctx, a, side, t - pd.w / 2, t + pd.w / 2, v.base + y + pd.h - 0.05)) continue;
    const [x, z] = wallXZ(a, side, t, pd.d / 2 + 0.004);
    out.screen = v.push({kind, x: r3(x), z: r3(z), y, rot: WALL_ROT[side], area: a.id, hx: r3(along ? pd.w / 2 : pd.d / 2), hz: r3(along ? pd.d / 2 : pd.w / 2),
      h: pd.h, blocksSight: false, variant: kind === 'skywaysVenueWallScreen' ? slide : v.rng.int(0, SKYWAYS_CON_POSTERS.length - 1), mounted: true});
    break;
  }
  if (out.chairs.length < 4) res.skipped.push(`venue: panel ${a.id} audience (${out.chairs.length})`);
  res.panels.push(out);
}

function dressPhotoLounge(vc: VenueCtx, a: Area): void {
  const {v, res} = vc, ps = vc.portals.get(a.id)!;
  const door = ps.find(p => p.door) ?? ps[0] ?? null;
  const fr = frameOf(a, door);
  const out = {area: a.id, backdrop: [] as PropPlacement[], seats: [] as PropPlacement[]};
  // the photo-op wall against the back wall, facing the door (a narrow room: two poster boards instead)
  const uc = Math.round(fr.W / 2 * 2) / 2;
  {
    const pd = PROP_DEFS.skywaysVenuePhotoWall, [x, z] = uvXZ(fr, uc, fr.D - pd.d / 2 - 0.05);
    const w = v.put('skywaysVenuePhotoWall', x, z, fr.toFront, {area: a});
    if (w) out.backdrop.push(w);
  }
  for (const s of out.backdrop.length ? [] : [-1, 1]) {
    const [x, z] = uvXZ(fr, uc + s * 0.5, fr.D - 0.55);
    const b = v.put('skywaysConPosterBoard', x, z, fr.toFront, {area: a, variant: v.rng.int(0, SKYWAYS_CON_POSTERS.length - 1)});
    if (b) out.backdrop.push(b);
  }
  // the posed statue in front of it, facing the door; the photographer's lane from the door
  const [sx, sz] = uvXZ(fr, uc, fr.D - 2.0);
  const du = door ? xzToU(fr, door.x, door.z) : uc;
  const A = uvXZ(fr, du, 0.9), B = uvXZ(fr, uc, Math.max(1.2, fr.D - 4.0));
  v.keepSegment(A[0], A[1], B[0], B[1], 0.7);
  res.lanes.push({area: a.id, ax: r3(A[0]), az: r3(A[1]), bx: r3(B[0]), bz: r3(B[1]), half: 0.7});
  const [dx, dz] = door ? [door.x, door.z] : uvXZ(fr, uc, 0);
  // (a compact lounge: closer to the wall or to one side; the statue only where it fits)
  for (const [du2, dv2] of [[0, 2.0], [0, 1.6], [-1.0, 1.6], [1.0, 1.6], [-1.2, 2.0], [1.2, 2.0]]) {
    const [qx, qz] = uvXZ(fr, uc + du2, fr.D - dv2);
    const st = group(vc, [a], () => statueAt(v, 'photo-pose', qx, qz, yawToward(dx - qx, dz - qz), a));
    if (st) { res.statues.push(st); break; }
  }
  void sx; void sz;
  // lounge seating along the side walls (armchairs facing in), bean bags, an ottoman, plants
  const n0 = v.layout.props.length;
  const flanks: Side[] = fr.front === 'N' || fr.front === 'S' ? ['W', 'E'] : ['N', 'S'];
  for (const side of [...flanks, fr.front]) {
    if (v.layout.props.length - n0 >= 4) break;
    rowAlongWall(v.ctx, a, side, 'loungeArmchair', {max: 2, front: 0.9, cluster: 2, gap: 1.2});
  }
  // (a compact lounge: anywhere clear of the photo spot, its lane and the door strip; the photo spot's lane / door keep their cells)
  const seats = () => propsSince(v, n0).filter(p => p.kind !== 'pottedPlantSmall').length;
  for (const k of ['beanBag', 'beanBag', 'ottoman', 'beanBag', 'ottoman'] as PropKind[]) {
    if (seats() >= 5) break;
    for (let t = 0; t < 30; t++) {
      const [x, z] = uvXZ(fr, v.rng.range(0.8, fr.W - 0.8), v.rng.range(1.0, Math.max(1.1, fr.D - 1.0)));
      if (group(vc, [a], () => v.put(k, snapC(x), snapC(z), quarterToward(sx - x, sz - z), {area: a}))) break;
    }
  }
  for (const side of SIDES) rowAlongWall(v.ctx, a, side, 'pottedPlantSmall', {max: 1, front: 0.3});
  out.seats.push(...propsSince(v, n0));
  res.photo = out;
}

/** Artist alley / vendor rows across one court piece: alternate rows face each other across 2 m aisles, vendors back to back. */
function exhibitorRows(vc: VenueCtx, a: Area, rank: number): void {
  const {v, res} = vc;
  const W = a.w * CELL, H = a.h * CELL;
  if (Math.min(W, H) < 3.0) return;
  const fr = hallFrame(a, W >= H ? 'N' : 'W');
  const def = PROP_DEFS.skywaysConMerchTable;
  const rows: {v: number; rot: number}[] = [];
  let vv = 0.85 + def.d / 2, face = 1;
  while (vv + def.d / 2 + 0.5 <= fr.D) {
    rows.push({v: vv, rot: face > 0 ? fr.toBack : fr.toFront});
    vv += face > 0 ? def.d + 2.0 : def.d + 1.25;
    face = -face;
  }
  const rng = v.rng;
  for (const r of rows) {
    let run = 0;
    for (let u = 1.0 + def.w / 2; u + def.w / 2 <= fr.W - 0.8; u += def.w + 0.12) {
      if (run >= 3) { u += 1.4; run = 0; continue; } // a cross aisle every three tables
      const [x, z] = uvXZ(fr, u, r.v);
      const got = group(vc, [a], () => {
        const t = v.put('skywaysConMerchTable', Math.round(x * 2) / 2, Math.round(z * 2) / 2, r.rot, {area: a, front: 1.0});
        if (!t) return null;
        // the vendor's chair behind the table (part of the group: it must not cut a route either)
        const chair = rng.chance(0.6) ? v.put('foldingChair', snapC(t.x - Math.sin(t.rot) * (def.d / 2 + 0.4)), snapC(t.z - Math.cos(t.rot) * (def.d / 2 + 0.4)), t.rot, {area: a}) : null;
        return {t, chair};
      });
      if (!got) { run = 0; continue; }
      run++;
      res.tables.push(got.t);
      res.merch.push(...merchOn(v, got.t));
      // the studio's booth banner along the table's front (its cloth faces the aisle)
      if (rng.chance(0.75)) {
        const t = got.t, [bx, bz] = toWorld(t, 0, SKYWAYS_TABLE_BANNER.z), f = footprint('skywaysVenueTableBanner', t.rot);
        res.banners.push(v.push({kind: 'skywaysVenueTableBanner', x: r3(bx), z: r3(bz), y: r3(t.y + SKYWAYS_TABLE_BANNER.y0), rot: t.rot, area: a.id, hx: r3(f.hx), hz: r3(f.hz),
          h: PROP_DEFS.skywaysVenueTableBanner.h, blocksSight: false, variant: rng.int(0, SKYWAYS_VENUE_BOOTHS.length - 1), mounted: true, host: v.layout.props.indexOf(t)}));
      }
    }
  }
  void rank;
}

/** A row of `kind` against some solid wall of `a` (a route-checked group), or null. */
function wallRow(vc: VenueCtx, a: Area, kind: PropKind, o: Parameters<typeof rowAlongWall>[4], least: number): PropPlacement[] | null {
  const v = vc.v;
  for (const side of v.rng.shuffle(SIDES.slice())) {
    const got = group(vc, [a], () => { const n = v.layout.props.length; return rowAlongWall(v.ctx, a, side, kind, o).length >= least ? propsSince(v, n) : null; });
    if (got) return got;
  }
  return null;
}
const roomyPieces = (pieces: readonly Area[]) => pieces.filter(a => Math.min(a.w, a.h) * CELL >= 3.0);
/** The retro game corner's two arcade cabinets, in the roomiest piece that takes them (placed before the vendor rows). */
function gameCorner(vc: VenueCtx, pieces: readonly Area[]): Area | null {
  for (const a of roomyPieces(pieces)) {
    const got = wallRow(vc, a, 'arcadeCabinet', {max: 2, front: 1.0}, 2);
    if (got) { vc.res.exhibits.push(...got); return a; }
  }
  return null;
}
/** The rest of the pop-up exhibits (after the vendor rows): the capsule-toy row and the giant teddy by the game corner, a cosplay display
 *  of mannequins preferably in another piece. */
function exhibits(vc: VenueCtx, pieces: readonly Area[], corner: Area | null): void {
  const {res} = vc, rng = vc.v.rng, roomy = roomyPieces(pieces);
  const near = corner ? [corner, ...roomy.filter(q => q !== corner)] : roomy;
  for (const a of near) { const got = wallRow(vc, a, 'capsuleToyMachine', {max: 3, front: 0.9}, 2); if (got) { res.exhibits.push(...got); break; } }
  for (const a of near) { const got = wallRow(vc, a, 'giantTeddy', {max: 1, front: 0.6}, 1); if (got) { res.exhibits.push(...got); break; } }
  const kind: PropKind = rng.chance(0.5) ? 'mannequinFull' : 'mannequinFemale';
  for (const a of [...roomy.filter(q => q !== corner), ...(corner ? [corner] : [])]) {
    const got = wallRow(vc, a, kind, {max: 3, cluster: 1, gap: 0.5, front: 0.8}, 2);
    if (got) { res.exhibits.push(...got); break; }
  }
}

/** Freestanding poster boards against solid walls (facing the room). */
function boards(vc: VenueCtx, a: Area, n: number): void {
  const v = vc.v;
  let got = 0;
  for (const side of v.rng.shuffle(SIDES.slice())) {
    if (got >= n) break;
    const p = group(vc, [a], () => {
      const r = rowAlongWall(v.ctx, a, side, 'skywaysConPosterBoard', {max: 1, front: 0.9, variant: () => v.rng.int(0, SKYWAYS_CON_POSTERS.length - 1)});
      return r.length ? r : null;
    });
    if (p) got++;
  }
}

interface WallSlot { side: Side; t: number; x: number; z: number; hx: number; hz: number }
/** Solid-wall poster slots of an area (never over glazing / openings / signs, nothing standing in front), spread out. */
function posterSlots(v: AddonDresser, a: Area): WallSlot[] {
  const {layout} = v, def = PROP_DEFS.skywaysConPoster, y0 = SKYWAYS_POSTER_Y, y1 = y0 + def.h;
  const wins = (layout.skyways?.windows ?? []).filter(w => w.level === v.level);
  const props = layout.props.filter(p => (p.level ?? 0) === v.level);
  const cands: WallSlot[] = [];
  for (const side of SIDES) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.75; t <= hi - 0.75; t += 0.5) {
      if (!backed(v.ctx, a, side, t - def.w / 2, t + def.w / 2, v.base + y0 + 0.05) || !backed(v.ctx, a, side, t - def.w / 2, t + def.w / 2, v.base + y1 - 0.05)) continue;
      const [wx, wz] = wallXZ(a, side, t, -CELL / 2);
      const along = side === 'N' || side === 'S';
      const sx0 = along ? t - def.w / 2 : wx - CELL / 2, sx1 = along ? t + def.w / 2 : wx + CELL / 2, sz0 = along ? wz - CELL / 2 : t - def.w / 2, sz1 = along ? wz + CELL / 2 : t + def.w / 2;
      if (wins.some(w => w.x0 < sx1 + 0.05 && w.x1 > sx0 - 0.05 && w.z0 < sz1 + 0.05 && w.z1 > sz0 - 0.05 && w.sill < y1 + 0.1 && w.head > y0 - 0.1)) continue;
      const [fx, fz] = wallXZ(a, side, t, 0.4);
      const fhx = along ? def.w / 2 + 0.3 : 0.4, fhz = along ? 0.4 : def.w / 2 + 0.3;
      if (props.some(p => Math.abs(p.x - fx) < p.hx + fhx && Math.abs(p.z - fz) < p.hz + fhz)) continue;
      if (layout.signs.some(s => (s.level ?? 0) === v.level && Math.hypot(s.x - fx, s.z - fz) < 1.2)) continue;
      const [x, z] = wallXZ(a, side, t, def.d / 2 + 0.004);
      cands.push({side, t, x: r3(x), z: r3(z), hx: r3(along ? def.w / 2 : def.d / 2), hz: r3(along ? def.d / 2 : def.w / 2)});
    }
  }
  const out: WallSlot[] = [];
  for (const c of v.rng.shuffle(cands)) if (out.every(o => o.side !== c.side || Math.abs(o.t - c.t) >= 2.4)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wayfinding

const SIGN_NAMES: Partial<Record<SkywaysVenueRole, string>> = {'main-hall': 'MAIN STAGE', 'photo-lounge': 'PHOTO LOUNGE', registration: 'REGISTRATION', exhibitors: 'ARTIST ALLEY'};

function wayfinding(vc: VenueCtx, areas: readonly Area[]): void {
  const {v, res, roleOf, portals} = vc, layout = v.layout, lv = v.level, base = v.base;
  // 0. the WASHROOMS plate over the washrooms' door on the main hall's side (the main hall's dresser points its statue there)
  for (const d of layout.doors) {
    const [h, w] = roleOf(d.a) === 'main-hall' && roleOf(d.b) === 'washrooms' ? [d.a, d.b] : roleOf(d.b) === 'main-hall' && roleOf(d.a) === 'washrooms' ? [d.b, d.a] : [-1, -1];
    if (h < 0) continue;
    const hall = layout.areas[h], dp = doorPoint(d, hall);
    const s = doorPlate(v, hall, {x: dp.x, z: dp.z, nx: dp.nx, nz: dp.nz, half: dp.half, to: w, door: d, side: dp.side}, 'WASHROOMS');
    if (s) res.signs.push({sign: s, to: 'WASHROOMS', target: {x: dp.x, z: dp.z}});
  }
  const letters = new Map(areas.filter(a => roleOf(a.id) === 'panel').map((a, k) => [a.id, String.fromCharCode(65 + panelLetter(a, k))] as const));
  const nameOf = (id: number) => roleOf(id) === 'panel' ? `PANEL ROOM ${letters.get(id) ?? ''}`.trim() : SIGN_NAMES[roleOf(id)!] ?? '';
  // 1. plates over the event doors, on the side people come from (MAIN STAGE, PANEL ROOM A / B, PHOTO LOUNGE)
  for (const a of areas) {
    for (const p of portals.get(a.id) ?? []) {
      const r = roleOf(p.to);
      if (!p.door || !r || (r !== 'main-hall' && r !== 'panel' && r !== 'photo-lounge')) continue;
      const s = doorPlate(v, a, p, r === 'main-hall' ? 'MAIN STAGE · WASHROOMS' : nameOf(p.to));
      if (s) res.signs.push({sign: s, to: nameOf(p.to), target: {x: p.x, z: p.z}});
    }
  }
  // ... and the rooms carved off the main hall: their plates on the hall's side of the door
  for (const d of layout.doors) {
    const [h, r] = roleOf(d.a) === 'main-hall' ? [d.a, d.b] : roleOf(d.b) === 'main-hall' ? [d.b, d.a] : [-1, -1];
    const rr = r >= 0 ? roleOf(r) : undefined;
    if (h < 0 || (rr !== 'panel' && rr !== 'photo-lounge')) continue;
    const hall = layout.areas[h], dp = doorPoint(d, hall);
    const s = doorPlate(v, hall, {x: dp.x, z: dp.z, nx: dp.nx, nz: dp.nz, half: dp.half, to: r, door: d, side: dp.side}, nameOf(r));
    if (s) res.signs.push({sign: s, to: nameOf(r), target: {x: dp.x, z: dp.z}});
  }
  // 2. hanging direction signs where people come in: in each registration corridor (facing the bridge mouth) and at each exhibitors'
  //    piece's way in from registration — one plate per arrow, the arrow along the route (the next opening toward each target)
  // (routes may cross the main hall: rooms carved off it are reached through its entry)
  const hallId = layout.skyways!.addon.venue!.find(q => q.role === 'main-hall')?.area;
  const route = routeTable(hallId !== undefined ? new Map([...portals, [hallId, portalsOf(layout, v.g, layout.areas[hallId])]]) : portals);
  const targets: {name: string; area: number}[] = [];
  for (const a of areas) for (const p of portals.get(a.id) ?? []) if (roleOf(p.to) === 'main-hall') targets.push({name: 'MAIN STAGE · WASHROOMS', area: p.to});
  for (const a of areas) if (roleOf(a.id) === 'panel' || roleOf(a.id) === 'photo-lounge') targets.push({name: nameOf(a.id), area: a.id});
  const uniq = [...new Map(targets.map(t => [t.area, t] as const)).values()];
  for (const a of areas) {
    const role = roleOf(a.id);
    if (role !== 'registration' && role !== 'exhibitors') continue;
    if (a.w * a.h * CELL * CELL < 12 || a.ceil - base < VENUE_SIGN.y + 0.45) continue;
    const ps = portals.get(a.id) ?? [];
    const from = role === 'registration' ? ps.find(p => vc.bridges.has(p.to)) : ps.find(p => roleOf(p.to) === 'registration');
    if (!from) continue;
    const signAt = inside(from, role === 'registration' ? 3.0 : 2.4);
    const groups = new Map<string, {names: string[]; at: Portal}>();
    const want = role === 'registration' ? [{name: 'ARTIST ALLEY · MAIN STAGE · PANELS', area: -1}] : uniq;
    for (const t of want) {
      const next: Portal | null = t.area < 0 ? ps.find(p => p !== from && (roleOf(p.to) === 'exhibitors' || roleOf(p.to) === 'main-hall')) ?? null : route(a.id, t.area);
      if (!next || next === from) continue;
      const dx = next.x - signAt[0], dz = next.z - signAt[1], L = Math.hypot(dx, dz) || 1;
      const arrow = arrowFor(from.nx, from.nz, dx / L, dz / L);
      const gr = groups.get(arrow);
      if (gr) gr.names.push(t.name); else groups.set(arrow, {names: [t.name], at: next});
    }
    let k = 0;
    for (const [arrow, gr] of groups) {
      // the plates side by side across the way in, each facing the people coming in (its front +Z against their walking direction)
      const tx = -from.nz, tz = from.nx, off = (k++ - (groups.size - 1) / 2) * 2.0;
      const x = signAt[0] + tx * off, z = signAt[1] + tz * off;
      const text = [...new Set(gr.names.flatMap(n => n.split(' · ')))].join(' · ');
      const w = Math.min(3.2, Math.max(VENUE_SIGN.w, text.length * 0.085 + 0.5));
      const [cx, cy] = v.g.cellOf(x, z);
      if (!v.g.inBounds(cx, cy) || v.g.area[v.g.idx(cx, cy)] !== a.id) continue;
      const sign: SignPlacement = {x: r3(x), y: r3(base + VENUE_SIGN.y), z: r3(z), rot: r3(normYaw(Math.atan2(from.nx, from.nz) + Math.PI)), kind: 'info', text, area: a.id,
        arrow: arrow as SignPlacement['arrow'], hang: true, w: r3(w), level: lv, style: VENUE_SIGN_STYLE};
      layout.signs.push(sign);
      res.signs.push({sign, to: text, target: {x: gr.at.x, z: gr.at.z}});
    }
  }
}

/** The arrow a viewer walking along (fx, fz) reads for the direction (dx, dz). */
export function arrowFor(fx: number, fz: number, dx: number, dz: number): 'up' | 'left' | 'right' {
  const ahead = fx * dx + fz * dz, right = -fz * dx + fx * dz;
  if (ahead >= Math.cos(50 * Math.PI / 180)) return 'up';
  return right > 0 ? 'right' : 'left';
}
/** The world direction an arrow of a plate (rot) points: 'up' = away from the reader, 'left' / 'right' = the reader's. */
export function arrowDir(rot: number, arrow: 'up' | 'left' | 'right' | 'down'): [number, number] {
  const fx = -Math.sin(rot), fz = -Math.cos(rot); // the reader faces the plate: its walking direction is -front
  if (arrow === 'up' || arrow === 'down') return [fx, fz];
  return arrow === 'right' ? [-fz, fx] : [fz, -fx];
}

/** For an area and a target area: the opening of the area its route leaves by (BFS over the venue's openings). */
function routeTable(portals: ReadonlyMap<number, Portal[]>): (from: number, target: number) => Portal | null {
  return (from: number, target: number): Portal | null => {
    const prev = new Map<number, {area: number; via: Portal}>();
    const q = [from], seen = new Set([from]);
    while (q.length) {
      const id = q.shift()!;
      if (id === target) break;
      for (const p of portals.get(id) ?? []) {
        if (seen.has(p.to)) continue;
        seen.add(p.to);
        prev.set(p.to, {area: id, via: p});
        if (p.to === target || portals.has(p.to)) q.push(p.to);
      }
    }
    if (!prev.has(target)) return null;
    let step = prev.get(target)!;
    while (step.area !== from) step = prev.get(step.area)!;
    return step.via;
  };
}

/** A plate over (or beside) a door on `a`'s side of the wall. */
function doorPlate(v: AddonDresser, a: Area, p: Portal, text: string): SignPlacement | null {
  const d = p.door!;
  const room = a.ceil - v.base - d.height;
  const w = Math.min(2.6, Math.max(1.2, text.length * 0.085 + 0.4));
  let t = p.side === 'N' || p.side === 'S' ? p.x : p.z;
  const y = room >= 0.5 ? Math.min(d.height + 0.32, a.ceil - v.base - 0.24) : 1.9;
  if (room < 0.5) t += p.half + 0.2 + w / 2;
  const [lo, hi] = wallRange(a, p.side);
  if (t - w / 2 < lo || t + w / 2 > hi) return null;
  if (room < 0.5 && !backed(v.ctx, a, p.side, t - w / 2, t + w / 2, v.base + y - 0.1)) return null;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const pos = p.side === 'N' ? {x: t, z: az0 + 0.02, rot: 0} : p.side === 'S' ? {x: t, z: az1 - 0.02, rot: Math.PI} : p.side === 'W' ? {x: ax0 + 0.02, z: t, rot: Math.PI / 2} : {x: ax1 - 0.02, z: t, rot: -Math.PI / 2};
  const s: SignPlacement = {x: r3(pos.x), y: r3(v.base + y), z: r3(pos.z), rot: r3(pos.rot), kind: 'info', text, area: a.id, w: r3(w), level: v.level, style: VENUE_SIGN_STYLE};
  v.layout.signs.push(s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

const sideLen = (a: Area, s: Side) => (s === 'N' || s === 'S' ? a.w : a.h) * CELL;
/** The quarter turn whose front (+Z) faces most nearly along (dx, dz). */
function quarterToward(dx: number, dz: number): number {
  return normYaw(Math.round(yawToward(dx, dz) / (Math.PI / 2)) * (Math.PI / 2));
}
/** u of a world point in a frame. */
function xzToU(fr: HallFrame, x: number, z: number): number {
  return fr.front === 'N' || fr.front === 'S' ? x - fr.x0 : z - fr.z0;
}
