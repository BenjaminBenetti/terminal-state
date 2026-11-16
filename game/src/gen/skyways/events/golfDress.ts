// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the MINI-GOLF course's dresser — the convention's
// venue carve (layout.skyways.addon.venue by role, relabelled by gen/skyways/events/eventVenue.ts) dressed as an indoor mini-golf course.
// Pure data; the rng is consumed only here (gen/skyways/addon.ts hands it its own fork).
//
//  - the MAIN HALL holds the COURSE: 6-9 holes in rows of bays along the hall's long axis with walking aisles round them (a promenade
//    past every tee end, end aisles at the hall's doors, a gap in a row in front of a long-wall opening, 1.2 m between bays). Each hole
//    (gen/skyways/events/golfCourse.ts) is one of the designs — straight, dogleg, zigzag, a gate (tunnel arch), a centre obstacle, a split
//    route round an island, a raised tee tier stepping down, a hairpin, a plateau with scattered blocks — built of turf deck pieces in its
//    own tint, ONE cup piece (the real gap in the deck's collision: golfContract.ts), bumper rails round its playing area, a tee mat with
//    a golf ball (a layout pickup) on it, the hole's number / par sign at the tee and a short flag beside the cup (outside the rail);
//  - the FRONT DESK (in a registration piece near a bridge mouth, else further in): one or two counter modules against a wall with a
//    staff chair behind, the course's ONE putter (a layout pickup) lying on the top, three spare balls and the scorecard caddy beside it
//    (their spans cut from the counter's loot surface), the FRONT DESK plate hung over it;
//  - the CLUBHOUSE (the exhibitors' court pieces): benches, the wall putter rack (empty: the one putter is at the desk), waiting chairs;
//  - PARTY ROOMS (the panel rooms): party tables with chairs round them, a birthday banner on the wall; the SNACK BAR (photo lounge): a
//    counter, a drinks cooler, a snack rack, a café table with chairs;
//  - wayfinding: the course's welcome plate at each bridge mouth (its arrow toward the course), plates over the course / room doors and
//    the WASHROOMS / STAFF ONLY doors off the hall. The staff room, storage and washrooms keep their ordinary dressing.
// Circulation: the venue kit's door strips, reach keys and whole-walk check (gen/skyways/venueDress.ts eventVenueContext / group): every
// furniture group stays only if every opening reached before is still reached by a 1.2 m path. The course pieces are pushed without grid
// masks (walkers cross them: PropPlacement.walkOver) inside the bays only — never on a door strip, an aisle, a wall cell or a ramp. The
// course hall takes no floor finds (Area.noFloorLoot: a weapon find would lie under the turf). No enemy spawns here (gen/skyways/events/
// eventCrowd.ts places the event's crowd).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, backed, cellsOfBox, rowAlongWall, wallRange, wallXZ} from '../../placeKit';
import type {Area, PickupPlacement, Side, SignPlacement, StationLayout} from '../../stationTypes';
import {normYaw, quarter, r3, toWorld, uvXZ, yawToward} from '../addonFrame';
import {VENUE_DOOR_CLEAR, VENUE_SIGN, arrowFor, doorPlate, entryAreas, eventVenueContext, frameOf, group, markRoutes, markWalkRoutes, routeTable, wallRow, type Portal, type VenueCtx} from '../venueDress';
import type {SkywaysVenueRole} from '../skywaysTypes';
import type {EventDressResult} from './eventResult';
import {GOLF_BALL_ITEM, GOLF_CUP_R, GOLF_GREEN_H, GOLF_RAIL, GOLF_TIER_H, PUTTER_ITEM} from './golfContract';
import {GOLF_TEE_MARGIN, bayFrame, bayOrder, buildHole, planHall, planHole, splitPiece, type BayFrame, type BuiltHole, type GolfBay, type GPt, type GRect, type HallOpening} from './golfCourse';
import {GOLF_ARCH_MATS, GOLF_BANNER, GOLF_BLOCK_MATS, GOLF_CARD, GOLF_FLAG, GOLF_RACK, GOLF_RAIL_MATS, GOLF_TEE_MAT, GOLF_TEE_SIGN, GOLF_TINTS, golfCardVariant, golfSignVariant, type GolfKind} from './golfKinds';
import {GOLF_COURSE_NAMES, GOLF_PARTY_NAMES, type GolfDesign, type SkywaysGolfHole, type SkywaysGolfRecord} from './golfTypes';

/** The course's plates (deep fairway green, warm white letters, a gold accent). */
export const GOLF_SIGN_STYLE = {bg: 0x1d5a33, fg: 0xfdfbef, accent: 0xf5c542, font: 'rounded'} as const;
/** The front desk: its counter's distance off the wall (staff room behind it), its customer strip; the on-top spots (counter-local m). */
export const GOLF_DESK = {offs: [0.75, 0.5], front: 1.2, putter: {len: 0.9, lz: 0.12}, balls: 3, ballPitch: 0.06, ballLz: 0.2, cardLz: -0.18} as const;

const SIDES: Side[] = ['N', 'S', 'W', 'E'];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A placed hole (QA / tests: skywaysGolfDressOf). */
export interface GolfHoleDress {
  n: number;
  bay: GolfBay;
  frame: BayFrame;
  built: BuiltHole;
  tint: number;
  deck: PropPlacement[];
  cup: PropPlacement;
  rails: PropPlacement[];
  blocks: PropPlacement[];
  arches: PropPlacement[];
  mat: PropPlacement;
  sign: PropPlacement | null;
  flag: PropPlacement | null;
  /** World points of the tee, the cup and the ball's line. */
  tee: GPt;
  cupAt: GPt;
  path: GPt[];
}
export interface GolfDressInfo {
  holes: GolfHoleDress[];
  aisles: GRect[];
  desk: {counters: PropPlacement[]; card: PropPlacement | null; chair: PropPlacement | null} | null;
  rooms: {area: number; role: SkywaysVenueRole; props: PropPlacement[]}[];
}
const INFO = new WeakMap<StationLayout, GolfDressInfo>();
/** QA / tests: the course a layout's mini-golf dresser built (undefined: none). */
export const skywaysGolfDressOf = (layout: StationLayout): GolfDressInfo | undefined => INFO.get(layout);

export function dressMiniGolf(layout: StationLayout, rng: Rng): EventDressResult {
  const res: EventDressResult = {props: [], skipped: [], byArea: {}};
  const addon = layout.skyways?.addon;
  const venue = addon?.venue;
  if (!addon || !venue?.length) { res.skipped.push('no venue'); return res; }
  const vc = eventVenueContext(layout, rng, ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge']);
  if (!vc) { res.skipped.push('no venue areas'); return res; }
  const v = vc.v;
  const hall = layout.areas[venue.find(q => q.role === 'main-hall')?.area ?? -1];
  const name = rng.int(0, GOLF_COURSE_NAMES.length - 1);
  const info: GolfDressInfo = {holes: [], aisles: [], desk: null, rooms: []};

  // --- 1. the course (the main hall) ------------------------------------------------------------------------------------------
  if (hall) {
    hall.noFloorLoot = true;
    placeCourse(vc, hall, name, info);
  }
  if (!info.holes.length) v.skipped.push('golf: no course');
  // --- 2. the front desk, the rooms (route-checked groups), then their routes become lanes ----------------------------------------
  const pars = info.holes.map(h => h.built.plan.par);
  const desk = frontDesk(vc, name, pars);
  if (desk) info.desk = {counters: desk.counters, card: desk.card, chair: desk.chair}; else v.skipped.push('golf: front desk');
  const byRole = (r: SkywaysVenueRole) => vc.walk.pub.filter(a => vc.roleOf(a.id) === r);
  byRole('panel').forEach((a, k) => info.rooms.push({area: a.id, role: 'panel', props: partyRoom(vc, a, k)}));
  for (const a of byRole('photo-lounge')) info.rooms.push({area: a.id, role: 'photo-lounge', props: snackBar(vc, a)});
  clubhouse(vc, byRole('exhibitors'), info);
  for (const a of vc.walk.pub) if (a !== hall) markRoutes(vc, a);
  markWalkRoutes(vc);
  // --- 3. wayfinding --------------------------------------------------------------------------------------------------------------
  wayfinding(vc, hall ?? null, info.holes.length, name);

  v.lift();
  // --- 4. the pickups (absolute heights: after the lift) and the record ------------------------------------------------------------
  const lv = v.level ? {level: v.level} : {};
  const pick = (p: Omit<PickupPlacement, 'level'>): number => { layout.pickups.push({...p, ...lv}); return layout.pickups.length - 1; };
  const holes: SkywaysGolfHole[] = info.holes.map(h => {
    // the ball's origin is its bottom (golfContract.ts): it stands on the turf top under the tee mat
    const ball = pick({itemId: GOLF_BALL_ITEM, count: 1, x: h.tee.x, y: r4(h.mat.y), z: h.tee.z, area: hall!.id});
    return {n: h.n, area: hall!.id, par: h.built.plan.par, tee: {x: h.tee.x, y: r4(h.mat.y), z: h.tee.z}, cup: {x: h.cup.x, y: r4(h.cup.y + GOLF_GREEN_H), z: h.cup.z, r: GOLF_CUP_R},
      design: h.built.plan.design, tint: h.tint, path: h.path.map(p => ({x: p.x, z: p.z})), ball,
      ...(h.sign ? {sign: layout.props.indexOf(h.sign)} : {}), ...(h.flag ? {flag: layout.props.indexOf(h.flag)} : {})};
  });
  let deskRec: SkywaysGolfRecord['desk'] = null;
  if (desk) {
    const at = (s: {host: PropPlacement; lx: number; lz: number}) => { const [x, z] = toWorld(s.host, s.lx, s.lz); return {x: r4(x), z: r4(z), y: r4(s.host.y + SHOP_COUNTER_TOP_Y)}; };
    const pu = at(desk.putter);
    const putter = pick({itemId: PUTTER_ITEM, count: 1, x: pu.x, y: pu.y, z: pu.z, area: desk.area.id, yaw: r3(desk.putter.host.rot)});
    const balls = desk.balls.map(b => { const q = at(b); return pick({itemId: GOLF_BALL_ITEM, count: 1, x: q.x, y: q.y, z: q.z, area: desk.area.id}); });
    const c0 = desk.counters[0], c1 = desk.counters[desk.counters.length - 1];
    deskRec = {area: desk.area.id, x: r4((c0.x + c1.x) / 2), z: r4((c0.z + c1.z) / 2), putter, balls};
  }
  addon.golf = {name: GOLF_COURSE_NAMES[name], holes, desk: deskRec};
  for (let k = v.p0; k < layout.props.length; k++) {
    const p = layout.props[k], id = p.host !== undefined ? layout.props[p.host].area : p.area;
    (res.byArea[id] ??= []).push(p);
  }
  res.props = layout.props.slice(v.p0);
  res.skipped.push(...v.skipped);
  INFO.set(layout, info);
  return res;
}

// ---------------------------------------------------------------------------------------------
// The course

/** The deck top (over the floor) at a hole-local point: a tier's, the green's, or 0 (off the deck). */
const deckTopAt = (b: BuiltHole, p: GPt): number => {
  const inside = (r: GRect) => p.x > r.x0 - 1e-6 && p.x < r.x1 + 1e-6 && p.z > r.z0 - 1e-6 && p.z < r.z1 + 1e-6;
  if (b.plan.tier.some(inside)) return GOLF_TIER_H;
  return b.deck.some(d => inside(d.r)) || inside(b.cup) ? GOLF_GREEN_H : 0;
};

function placeCourse(vc: VenueCtx, hall: Area, name: number, info: GolfDressInfo): void {
  const v = vc.v, g = v.g, rng = v.rng, ctx = v.ctx;
  const rect: GRect = {x0: hall.x * CELL, z0: hall.y * CELL, x1: (hall.x + hall.w) * CELL, z1: (hall.y + hall.h) * CELL};
  const openings: HallOpening[] = (vc.portals.get(hall.id) ?? []).map(p => ({x: p.x, z: p.z, side: p.side, half: p.half}));
  const hp = planHall(rect, openings);
  info.aisles = hp.aisles;
  // a course cell: plain flat floor of the hall, clear of walls, door strips / zones, ramps, edges and anything already standing
  const cellWhy = (cx: number, cy: number): string => {
    if (!g.inBounds(cx, cy)) return 'bounds';
    const i = g.idx(cx, cy);
    return g.cells[i] !== FLOOR ? 'wall' : g.area[i] !== hall.id ? 'area' : g.blocked[i] ? 'blocked' : ctx.keep[i] ? 'keep' : ctx.edge[i] ? 'edge' : ctx.doorCell[i] || ctx.zone[i] ? 'door'
      : g.rampIdx[i] >= 0 || Math.abs(g.floorOf(i) - v.base) >= 0.01 ? 'floor' : '';
  };
  const cellsOf = (r: GRect): [number, number][] => {
    const [x0, y0, x1, y1] = cellsOfBox((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, (r.z1 - r.z0) / 2), out: [number, number][] = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) out.push([cx, cy]);
    return out;
  };
  const rectWhy = (r: GRect) => { for (const [cx, cy] of cellsOf(r)) { const w = cellWhy(cx, cy); if (w) return w; } return ''; };
  const hub = vc.hub.get(hall.id);
  const bays = bayOrder(hp, hub ? {x: hub.x, z: hub.z} : {x: (rect.x0 + rect.x1) / 2, z: rect.z0});
  const used = new Map<GolfDesign, number>();
  const tint0 = rng.int(0, GOLF_TINTS.length - 1), railOrder = rng.shuffle(GOLF_RAIL_MATS.map((_, i) => i)), block0 = rng.int(0, GOLF_BLOCK_MATS.length - 1);
  let n = 0;
  for (const bay of bays) {
    if (n >= 9) break;
    const fr = bayFrame(bay, rng.chance(0.5));
    const plan = planHole(fr.bw, fr.bd, used, rng);
    if (!plan) { v.skipped.push(`golf: bay ${r3(bay.rect.x0)},${r3(bay.rect.z0)} fits no design`); continue; }
    const built = buildHole(plan);
    const W = (r: GRect) => fr.rect(r);
    const pieces = [...built.deck.map(d => W(d.r)), W(built.cup), ...built.rails.map(q => W(q.r))];
    const why = pieces.map(rectWhy).find(w => w);
    if (why) { v.skipped.push(`golf: bay ${r3(bay.rect.x0)},${r3(bay.rect.z0)} not clear (${why})`); continue; }
    used.set(plan.design, (used.get(plan.design) ?? 0) + 1);
    const k = n++, tint = (tint0 + k) % GOLF_TINTS.length, rail = railOrder[k % railOrder.length];
    const push = (kind: GolfKind, r: GRect, y: number, h: number, variant: number, rot = 0, walkOver = true): PropPlacement => v.push({
      kind: kind as PropKind, x: r4((r.x0 + r.x1) / 2), z: r4((r.z0 + r.z1) / 2), y: r4(y), rot, area: hall.id, hx: r4((r.x1 - r.x0) / 2), hz: r4((r.z1 - r.z0) / 2), h,
      blocksSight: false, variant, ...(walkOver ? {walkOver: true} : {})});
    const along = (r: GRect) => (r.x1 - r.x0 >= r.z1 - r.z0 ? 0 : Math.PI / 2);
    const deck = built.deck.map(d => push(d.tier ? 'golfTier' : 'golfGreen', W(d.r), 0, d.tier ? GOLF_TIER_H : GOLF_GREEN_H, tint));
    const cupW = W(built.cup);
    const cup = push('golfCup', cupW, 0, GOLF_GREEN_H, tint);
    const rails = built.rails.map(q => { const r = W(q.r); return push('golfRail', r, q.tier ? GOLF_TIER_H : GOLF_GREEN_H, GOLF_RAIL.h, rail, along(r)); });
    // (a long block — the island — in pieces under the collider size rule, like the deck)
    const blocks = plan.blocks.flatMap((b, j) => splitPiece(b).map(q => push('golfBlock', W(q), deckTopAt(built, {x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2}), PROP_DEFS.golfBlock.h,
      (block0 + k + j) % GOLF_BLOCK_MATS.length)));
    const archRot = fr.sAlongX ? 0 : Math.PI / 2, archF = footprint('golfArch', archRot);
    const arches = plan.arches.map(a => { const c = fr.toWorld(a); return push('golfArch', {x0: c.x - archF.hx, z0: c.z - archF.hz, x1: c.x + archF.hx, z1: c.z + archF.hz}, deckTopAt(built, a), PROP_DEFS.golfArch.h, k % GOLF_ARCH_MATS.length, archRot); });
    const tee = fr.toWorld(plan.tee), matF = footprint('golfTeeMat', archRot);
    const mat = push('golfTeeMat', {x0: tee.x - matF.hx, z0: tee.z - matF.hz, x1: tee.x + matF.hx, z1: tee.z + matF.hz}, deckTopAt(built, plan.tee), GOLF_TEE_MAT.h, 0, archRot);
    for (const r of pieces) for (const [cx, cy] of cellsOf(r)) v.keepCell(cx, cy);
    // the hole's sign in the tee strip (between the promenade and the tee rail), facing the promenade
    let sign: PropPlacement | null = null;
    {
      const rot = quarter(yawToward(-fr.tDir.x, -fr.tDir.z)), f = footprint('golfTeeSign', rot);
      for (const ds of [0.62, -0.62, 0.9, -0.9]) {
        const sl = plan.tee.x + ds;
        if (sl - GOLF_TEE_SIGN.w / 2 < 0.05 || sl + GOLF_TEE_SIGN.w / 2 > fr.bw - 0.05) continue;
        const c = fr.toWorld({x: sl, z: 0.03 + GOLF_TEE_SIGN.d / 2}), r: GRect = {x0: c.x - f.hx, z0: c.z - f.hz, x1: c.x + f.hx, z1: c.z + f.hz};
        if (!cellsOf(r).every(([cx, cy]) => g.inBounds(cx, cy) && g.area[g.idx(cx, cy)] === hall.id && g.cells[g.idx(cx, cy)] === FLOOR && !ctx.doorCell[g.idx(cx, cy)])) continue;
        sign = v.push({kind: 'golfTeeSign' as PropKind, x: r4(c.x), z: r4(c.z), y: 0, rot: r3(rot), area: hall.id, hx: r4(f.hx), hz: r4(f.hz), h: GOLF_TEE_SIGN.h, blocksSight: false,
          variant: golfSignVariant(k + 1, plan.par, name)});
        for (const [cx, cy] of cellsOf(r)) v.keepCell(cx, cy);
        break;
      }
      if (!sign) v.skipped.push(`golf: hole ${k + 1} sign`);
    }
    const flag = flagFor(vc, hall, built, fr, k + 1, cellsOf);
    if (!flag) v.skipped.push(`golf: hole ${k + 1} flag`);
    info.holes.push({n: k + 1, bay, frame: fr, built, tint, deck, cup, rails, blocks, arches, mat, sign, flag, tee, cupAt: fr.toWorld(plan.cup), path: plan.path.map(fr.toWorld)});
  }
  // the aisles stay clear of everything placed after the course (after it: an aisle's edge cell may be shared with a bay's)
  for (const a of hp.aisles) for (const [cx, cy] of cellsOf(a)) v.keepCell(cx, cy);
  if (n < 6) v.skipped.push(`golf: only ${n} holes`);
}

/** The short flag beside the cup: outside the rail of the outline edge nearest the cup, its pennant along the edge, facing the cup. */
function flagFor(vc: VenueCtx, hall: Area, b: BuiltHole, fr: BayFrame, n: number, cellsOf: (r: GRect) => [number, number][]): PropPlacement | null {
  const v = vc.v, g = v.g, c = b.plan.cup, F = GOLF_FLAG, off = GOLF_RAIL.t + 0.035 + F.d / 2;
  const dist = (e: BuiltHole['edges'][number]) => {
    const along = e.side === 'N' || e.side === 'S', u = along ? c.x : c.z, w = along ? c.z : c.x;
    return Math.hypot(Math.max(e.a - u, 0, u - e.b), w - e.c);
  };
  const solid = [...b.plan.play, ...b.rails.map(q => q.r), ...b.plan.blocks];
  for (const e of b.edges.slice().sort((p, q) => dist(p) - dist(q))) {
    if (e.b - e.a < F.w + 0.1 || (e.side === 'N' && e.c <= GOLF_TEE_MARGIN + 1e-6)) continue; // (never at the tee end: the sign stands there)
    const along = e.side === 'N' || e.side === 'S', sgn = e.side === 'N' || e.side === 'W' ? -1 : 1;
    const u = Math.max(e.a + F.w / 2 + 0.04, Math.min(e.b - F.w / 2 - 0.04, along ? c.x : c.z));
    const lp: GPt = along ? {x: u, z: e.c + sgn * off} : {x: e.c + sgn * off, z: u};
    const lr: GRect = along ? {x0: lp.x - F.w / 2, z0: lp.z - F.d / 2, x1: lp.x + F.w / 2, z1: lp.z + F.d / 2} : {x0: lp.x - F.d / 2, z0: lp.z - F.w / 2, x1: lp.x + F.d / 2, z1: lp.z + F.w / 2};
    if (lr.x0 < 0.01 || lr.z0 < 0.01 || lr.x1 > fr.bw - 0.01 || lr.z1 > fr.bd - 0.01) continue;
    if (solid.some(r => r.x0 < lr.x1 - 1e-6 && r.x1 > lr.x0 + 1e-6 && r.z0 < lr.z1 - 1e-6 && r.z1 > lr.z0 + 1e-6)) continue;
    const wp = fr.toWorld(lp), wc = fr.toWorld(c), rot = quarter(yawToward(wc.x - wp.x, wc.z - wp.z)), f = footprint('golfFlag', rot);
    const wr: GRect = {x0: wp.x - f.hx, z0: wp.z - f.hz, x1: wp.x + f.hx, z1: wp.z + f.hz};
    if (!cellsOf(wr).every(([cx, cy]) => g.inBounds(cx, cy) && g.area[g.idx(cx, cy)] === hall.id && g.cells[g.idx(cx, cy)] === FLOOR)) continue;
    const y = deckTopAt(b, lp);
    return v.push({kind: 'golfFlag' as PropKind, x: r4(wp.x), z: r4(wp.z), y: r4(y), rot: r3(rot), area: hall.id, hx: r4(f.hx), hz: r4(f.hz), h: F.h, blocksSight: false, variant: n, mounted: true});
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The front desk

interface DeskSpot { host: PropPlacement; lx: number; lz: number }
interface DeskOut { area: Area; counters: PropPlacement[]; chair: PropPlacement | null; card: PropPlacement | null; putter: DeskSpot; balls: DeskSpot[] }

const sideLen = (a: Area, s: Side) => (s === 'N' || s === 'S' ? a.w : a.h) * CELL;
const snapC = (x: number) => Math.floor(x / CELL) * CELL + CELL / 2;

function frontDesk(vc: VenueCtx, name: number, pars: readonly number[]): DeskOut | null {
  const regs = vc.walk.pub.filter(a => vc.roleOf(a.id) === 'registration');
  const mouthed = regs.filter(a => (vc.portals.get(a.id) ?? []).some(p => vc.bridges.has(p.to)));
  const tried = new Set<number>();
  const spots: {area: Area; at: Portal | null}[] = [];
  for (const a of mouthed) for (const s of entryAreas(vc, a)) if (!tried.has(s.area.id)) { tried.add(s.area.id); spots.push(s); }
  for (const a of [...regs, ...vc.walk.pub.filter(q => vc.roleOf(q.id) === 'exhibitors')]) if (!tried.has(a.id)) { tried.add(a.id); spots.push({area: a, at: vc.hub.get(a.id) ?? null}); }
  for (const s of spots) {
    const got = deskIn(vc, s.area, s.at);
    if (got) return dressDesk(vc, got.area, got.counters, got.chair, name, pars);
  }
  return null;
}

function deskIn(vc: VenueCtx, a: Area, mouth: Portal | null): {area: Area; counters: PropPlacement[]; chair: PropPlacement | null} | null {
  const v = vc.v, def = PROP_DEFS.shopCounter;
  const sides = SIDES.filter(s => !mouth || s !== mouth.side).sort((p, q) => sideLen(a, q) - sideLen(a, p));
  for (const offW of GOLF_DESK.offs) for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    for (const want of [2, 1]) {
      const span = want * def.w, mid = (lo + hi) / 2;
      const starts: number[] = [];
      for (let t0 = Math.ceil((lo + 0.5) * 2) / 2; t0 + span <= hi - 0.5; t0 += 0.5) starts.push(t0);
      starts.sort((p, q) => Math.abs(p + span / 2 - mid) - Math.abs(q + span / 2 - mid));
      for (const t0 of starts) {
        if (!backed(v.ctx, a, side, t0, t0 + span, v.base + 1.0)) continue;
        const row = group(vc, [a], () => {
          const out: PropPlacement[] = [];
          for (let k = 0; k < want; k++) {
            const [x, z] = wallXZ(a, side, t0 + def.w / 2 + k * def.w, offW + def.d / 2);
            const p = v.put('shopCounter', x, z, WALL_ROT[side], {area: a, front: GOLF_DESK.front});
            if (!p) return null;
            out.push(p);
          }
          return out;
        });
        if (!row) continue;
        // the staff chair behind the desk (facing the customers), where it fits
        const c = row[0], back = def.d / 2 + 0.36;
        const chair = offW >= 0.7 ? group(vc, [a], () => v.put('foldingChair', snapC(c.x - Math.sin(c.rot) * back), snapC(c.z - Math.cos(c.rot) * back), c.rot, {area: a})) : null;
        return {area: a, counters: row, chair};
      }
    }
  }
  return null;
}

/** The putter, the spare balls and the scorecard caddy on the desk's top (their spans cut from its loot surface); the FRONT DESK plate. */
function dressDesk(vc: VenueCtx, a: Area, counters: PropPlacement[], chair: PropPlacement | null, name: number, pars: readonly number[]): DeskOut {
  const v = vc.v, D = GOLF_DESK, top = SHOP_COUNTER_TOP_Y, hw = PROP_DEFS.shopCounter.w / 2;
  const cut = (c: PropPlacement, x0: number, x1: number) => (c.cut ??= []).push({y: top, x0: r3(x0), x1: r3(x1)});
  const m0 = counters[0], m1 = counters[counters.length - 1];
  // one module: the putter left of centre, the balls / caddy at the right end; two: the putter on the first, the rest on the second
  const two = counters.length > 1;
  const plx = two ? 0 : -hw + D.putter.len / 2 + 0.06;
  cut(m0, plx - D.putter.len / 2 - 0.03, plx + D.putter.len / 2 + 0.03);
  const putter: DeskSpot = {host: m0, lx: plx, lz: D.putter.lz};
  const blx = two ? -0.25 : hw - 0.22, balls: DeskSpot[] = [];
  for (let k = 0; k < D.balls; k++) balls.push({host: m1, lx: r3(blx + (k - (D.balls - 1) / 2) * D.ballPitch), lz: D.ballLz});
  cut(m1, blx - D.ballPitch * (D.balls - 1) / 2 - 0.04, blx + D.ballPitch * (D.balls - 1) / 2 + 0.04);
  const clx = two ? 0.3 : hw - 0.2;
  const card = v.onTop(m1, 'golfScorecardStand' as PropKind, clx, D.cardLz, top);
  if (card) { card.variant = golfCardVariant(name, pars); cut(m1, clx - GOLF_CARD.w / 2 - 0.02, clx + GOLF_CARD.w / 2 + 0.02); }
  // the FRONT DESK plate hung over the desk, facing the customers
  if (a.ceil - v.base >= VENUE_SIGN.y + 0.6) {
    const fx = Math.sin(m0.rot), fz = Math.cos(m0.rot);
    const sign: SignPlacement = {x: r3((m0.x + m1.x) / 2 + fx * 0.2), y: r3(v.base + VENUE_SIGN.y + 0.15), z: r3((m0.z + m1.z) / 2 + fz * 0.2), rot: r3(m0.rot), kind: 'info',
      text: 'FRONT DESK · PUTTER & BALLS', area: a.id, hang: true, w: 2.6, level: v.level, style: GOLF_SIGN_STYLE};
    v.layout.signs.push(sign);
  }
  return {area: a, counters, chair, card, putter, balls};
}

// ---------------------------------------------------------------------------------------------
// The rooms

/** A mounted board on a solid wall of `a` (centre height y over the floor), clear of glazing, other mounts and anything in front. */
function wallMount(v: VenueCtx['v'], a: Area, kind: GolfKind, y: number, w: number, d: number, h: number, variant: number, pref?: Side): PropPlacement | null {
  const {layout} = v, wins = (layout.skyways?.windows ?? []).filter(q => q.level === v.level);
  const props = layout.props.filter(p => (p.level ?? 0) === v.level);
  const sides = pref ? [pref, ...SIDES.filter(s => s !== pref)] : v.rng.shuffle(SIDES.slice());
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side), along = side === 'N' || side === 'S', mid = (lo + hi) / 2;
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.3; t <= hi - w / 2 - 0.3; t += 0.25) ts.push(t);
    ts.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
    for (const t of ts) {
      if (!backed(v.ctx, a, side, t - w / 2, t + w / 2, v.base + y + 0.05) || !backed(v.ctx, a, side, t - w / 2, t + w / 2, v.base + y + h - 0.05)) continue;
      const [wx, wz] = wallXZ(a, side, t, -CELL / 2);
      const sx0 = along ? t - w / 2 : wx - CELL / 2, sx1 = along ? t + w / 2 : wx + CELL / 2, sz0 = along ? wz - CELL / 2 : t - w / 2, sz1 = along ? wz + CELL / 2 : t + w / 2;
      if (wins.some(q => q.x0 < sx1 + 0.05 && q.x1 > sx0 - 0.05 && q.z0 < sz1 + 0.05 && q.z1 > sz0 - 0.05 && q.sill < y + h + 0.1 && q.head > y - 0.1)) continue;
      const [fx, fz] = wallXZ(a, side, t, 0.35), fhx = along ? w / 2 + 0.2 : 0.35, fhz = along ? 0.35 : w / 2 + 0.2;
      if (props.some(p => Math.abs(p.x - fx) < p.hx + fhx && Math.abs(p.z - fz) < p.hz + fhz && (p.mounted ? Math.abs(p.y - y) < Math.max(p.h, h) + 0.2 : p.y + p.h > y - 0.05))) continue;
      if (layout.signs.some(s => (s.level ?? 0) === v.level && Math.hypot(s.x - fx, s.z - fz) < w / 2 + 0.8 && Math.abs(s.y - (v.base + y)) < 1.0)) continue;
      const [x, z] = wallXZ(a, side, t, d / 2 + 0.004);
      return v.push({kind: kind as PropKind, x: r3(x), z: r3(z), y, rot: WALL_ROT[side], area: a.id, hx: r3(along ? w / 2 : d / 2), hz: r3(along ? d / 2 : w / 2), h, blocksSight: false, variant, mounted: true});
    }
  }
  return null;
}

/** A party room: one or two cloth-draped party tables with folding chairs round them, the birthday banner on the wall, plants. */
function partyRoom(vc: VenueCtx, a: Area, k: number): PropPlacement[] {
  const v = vc.v, n0 = v.layout.props.length, ps = vc.portals.get(a.id) ?? [];
  const door = ps.find(p => p.door) ?? ps[0] ?? null, fr = frameOf(a, door);
  const def = PROP_DEFS.skywaysConMerchTable, tk: PropKind = 'skywaysConMerchTable';
  const nT = fr.W >= 2 * def.w + 2.6 && fr.D >= 4.0 ? 2 : 1;
  const vMid = Math.round(Math.max(VENUE_DOOR_CLEAR + 1.4, fr.D / 2 + 0.3) * 2) / 2;
  const tables: PropPlacement[] = [];
  for (let j = 0; j < nT; j++) {
    const u = nT === 2 ? (j === 0 ? fr.W / 2 - def.w / 2 - 0.7 : fr.W / 2 + def.w / 2 + 0.7) : fr.W / 2;
    const [x, z] = uvXZ(fr, Math.round(u * 2) / 2, vMid);
    const t = group(vc, [a], () => v.put(tk, x, z, fr.toFront, {area: a}));
    if (t) tables.push(t);
  }
  if (!tables.length) v.skipped.push(`golf: party room ${a.id} table`);
  for (const t of tables) for (const s of [1, -1]) for (const lx of [-0.55, 0.55]) {
    if (v.rng.chance(0.12)) continue;
    const [x, z] = toWorld(t, lx, s * (def.d / 2 + 0.4));
    group(vc, [a], () => v.put('foldingChair', x, z, normYaw(t.rot + (s > 0 ? Math.PI : 0)), {area: a}));
  }
  const banner = wallMount(v, a, 'golfPartyBanner', GOLF_BANNER.y, GOLF_BANNER.w, GOLF_BANNER.d, GOLF_BANNER.h, (k + v.rng.int(0, GOLF_PARTY_NAMES.length - 1)) % GOLF_PARTY_NAMES.length, fr.back);
  if (!banner) v.skipped.push(`golf: party room ${a.id} banner`);
  for (const side of SIDES) group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'pottedPlantSmall', {max: 1, front: 0.3}); return r.length ? r : null; });
  return v.layout.props.slice(n0);
}

/** The snack bar: a counter against the back wall, a drinks cooler and a snack rack, a café table with two chairs. */
function snackBar(vc: VenueCtx, a: Area): PropPlacement[] {
  const v = vc.v, n0 = v.layout.props.length, ps = vc.portals.get(a.id) ?? [];
  const door = ps.find(p => p.door) ?? ps[0] ?? null, fr = frameOf(a, door);
  const def = PROP_DEFS.shopCounter;
  let counter: PropPlacement | null = null;
  for (const du of [0, -0.5, 0.5, -1.0, 1.0]) {
    const [x, z] = uvXZ(fr, fr.W / 2 + du, fr.D - def.d / 2 - 0.05);
    counter = group(vc, [a], () => v.put('shopCounter', x, z, fr.toFront, {area: a, front: 1.0}));
    if (counter) break;
  }
  if (!counter) v.skipped.push(`golf: snack bar ${a.id} counter`);
  // (a vending machine would count against the storey's strict-wall vending cap: the drinks cooler and a snack rack instead)
  if (!wallRow(vc, a, 'shopCooler', {max: 1, front: 0.9}, 1)) v.skipped.push(`golf: snack bar ${a.id} cooler`);
  if (!wallRow(vc, a, 'snackRack', {max: 1, front: 0.8}, 1)) v.skipped.push(`golf: snack bar ${a.id} snack rack`);
  let set = false;
  for (let t = 0; t < 24 && !set; t++) {
    const [x, z] = uvXZ(fr, v.rng.range(0.8, Math.max(0.85, fr.W - 0.8)), v.rng.range(1.0, Math.max(1.05, fr.D - 0.9)));
    set = !!group(vc, [a], () => {
      // (the table centred on a cell corner covers 2 x 2 cells: its chairs stand in the next cells, just clear of its top)
      const tb = v.putRound('cafeBistroTable', Math.round(x * 2) / 2, Math.round(z * 2) / 2, 0, {area: a});
      if (!tb) return null;
      const across = fr.front === 'N' || fr.front === 'S', off = CELL + PROP_DEFS.cafeChair.d / 2 + 0.02;
      for (const s of [1, -1]) {
        const cx = tb.x + (across ? s * off : 0), cz = tb.z + (across ? 0 : s * off);
        if (!v.put('cafeChair', cx, cz, quarter(yawToward(tb.x - cx, tb.z - cz)), {area: a})) return null;
      }
      return tb;
    });
  }
  if (!set) v.skipped.push(`golf: snack bar ${a.id} table`);
  return v.layout.props.slice(n0);
}

/** The clubhouse (the exhibitors' court pieces): benches, the wall putter rack, a row of waiting chairs, plants. */
function clubhouse(vc: VenueCtx, pieces: readonly Area[], info: GolfDressInfo): void {
  const v = vc.v, big = pieces.filter(a => Math.min(a.w, a.h) * CELL >= 2.5).sort((p, q) => q.w * q.h - p.w * p.h);
  for (const a of big) {
    const n0 = v.layout.props.length;
    wallRow(vc, a, 'bench', {max: 2, front: 0.9, cluster: 2, gap: 0.8}, 1);
    info.rooms.push({area: a.id, role: 'exhibitors', props: v.layout.props.slice(n0)});
  }
  let rack: PropPlacement | null = null;
  for (const a of big) if (!rack) rack = wallMount(v, a, 'golfPutterRack', GOLF_RACK.y, GOLF_RACK.w, GOLF_RACK.d, GOLF_RACK.h, 0);
  if (!rack) v.skipped.push('golf: putter rack');
  else info.rooms.find(r => r.area === rack!.area)?.props.push(rack);
  for (const a of big.slice(0, 2)) {
    const got = wallRow(vc, a, 'plasticStackChair', {max: 4, cluster: 4, gap: 0.6, front: 0.8}, 2);
    if (got) info.rooms.find(r => r.area === a.id)?.props.push(...got);
  }
  for (const a of big.slice(0, 2)) for (const side of v.rng.shuffle(SIDES.slice()).slice(0, 2)) {
    group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'pottedPlantSmall', {max: 1, front: 0.3}); return r.length ? r : null; });
  }
  if (!big.length) v.skipped.push('golf: clubhouse');
}

// ---------------------------------------------------------------------------------------------
// Wayfinding

const ROOM_PLATES: Partial<Record<SkywaysVenueRole, string>> = {'photo-lounge': 'SNACK BAR', backstage: 'STAFF ONLY', washrooms: 'WASHROOMS', storage: 'STAFF ONLY'};

function wayfinding(vc: VenueCtx, hall: Area | null, holes: number, name: number): void {
  const v = vc.v, layout = v.layout, {portals, roleOf} = vc;
  const courseText = holes ? `MINI-GOLF · HOLES 1-${holes}` : 'MINI-GOLF';
  const plateOf = (id: number): string | null => {
    const r = roleOf(id);
    if (r === 'main-hall') return courseText;
    if (r === 'panel') return (layout.areas[id]?.label ?? 'Party room').toUpperCase();
    return r ? ROOM_PLATES[r] ?? null : null;
  };
  // plates over the doors of the course hall and the rooms, on the side people come from
  for (const a of vc.walk.pub) for (const p of portals.get(a.id) ?? []) {
    if (!p.door) continue;
    const r = roleOf(p.to), text = plateOf(p.to);
    if (!text || (a !== hall && r !== 'main-hall' && r !== 'panel' && r !== 'photo-lounge')) continue;
    doorPlate(v, a, p, text, GOLF_SIGN_STYLE);
  }
  // the welcome plate where people come in from each bridge, its arrow toward the course
  const route = routeTable(portals);
  for (const a of vc.walk.pub) {
    const from = (portals.get(a.id) ?? []).find(p => vc.bridges.has(p.to));
    if (!from || a.ceil - v.base < VENUE_SIGN.y + 0.45) continue;
    const at: [number, number] = [from.x + from.nx * 2.6, from.z + from.nz * 2.6];
    const [cx, cy] = v.g.cellOf(at[0], at[1]);
    if (!v.g.inBounds(cx, cy) || v.g.area[v.g.idx(cx, cy)] !== a.id) continue;
    const next = hall && a !== hall ? route(a.id, hall.id) : null;
    const text = `${GOLF_COURSE_NAMES[name].toUpperCase()} · MINI-GOLF`;
    const w = Math.min(3.2, Math.max(VENUE_SIGN.w, text.length * 0.085 + 0.5));
    const L = next ? Math.hypot(next.x - at[0], next.z - at[1]) || 1 : 1;
    const arrow = next ? arrowFor(from.nx, from.nz, (next.x - at[0]) / L, (next.z - at[1]) / L) : undefined;
    layout.signs.push({x: r3(at[0]), y: r3(v.base + VENUE_SIGN.y), z: r3(at[1]), rot: r3(normYaw(Math.atan2(from.nx, from.nz) + Math.PI)), kind: 'info', text, area: a.id,
      ...(arrow ? {arrow} : {}), hang: true, w: r3(w), level: v.level, style: GOLF_SIGN_STYLE});
  }
}
