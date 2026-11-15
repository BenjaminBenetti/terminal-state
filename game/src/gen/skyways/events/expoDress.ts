// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO; user: "a substantial exhibition destination, not another
// little shop: demo booths / displays, a presentation area and staff / storage spaces"): the TECHNOLOGY EXPO's dresser — the convention's
// venue carve (layout.skyways.addon.venue by role, relabelled by gen/skyways/events/eventVenue.ts) dressed as a tech expo:
//  - the KEYNOTE HALL (main-hall): the convention's stage model at real size where the carve put the stage box (its deck edge on a cell
//    line and its two treads' collision exactly like gen/skyways/addonConvention.ts: gen/skyways/stageSupport.ts makes it walkable), a big
//    LED video wall laced into the stage's truss (the keynote's title slide), a lectern on the deck, display screens on stands either side
//    of the stage, a stanchion crowd barrier (rope chains: addon.queues) between the stage front and the audience rows of folding chairs
//    either side of a centre aisle, a front-of-house tech desk behind the audience and the day's schedule totem by the entry;
//  - the EXPO FLOOR (the exhibitors' court pieces): exhibitor BOOTHS — each a distinct fictional exhibitor (gen/skyways/events/
//    expoTypes.ts): wall booths (a shell-scheme back wall with the exhibitor's header against a solid wall, the theme's real fixtures —
//    the tech display / device wall with their split demo devices, the Mall's TV wall / flat-screen TV / glass cabinet and counter, the
//    office server racks / monitors, the P7 CRT terminals, the console station and an arcade cabinet — plus demo counters, demo tables
//    and display plinths with their LOOSE devices on top) and open island booths in a roomy piece (a demo counter, a screen on a stand,
//    plinths) under a hanging booth sign; the exhibitor directory totem;
//  - DEMO THEATRES (panel rooms): a presentation screen with the talk's title slide against the back wall, the presenter's table with a
//    monitor and keyboard (separate decor), audience rows facing it either side of an aisle from the door; the programme totem outside;
//  - the DEVELOPER LOUNGE (photo-lounge, when carved): a console station, armchairs and bean bags facing it, a charging table with demo
//    phones / tablets, a plant;
//  - REGISTRATION (the corridors in from the bridges): badge counters (a check-in monitor on each) with a stanchion queue line in front
//    (addon.queues ropes), the REGISTRATION plate over them, the welcome totem greeting the bridge mouth, a touch kiosk;
//  - back of house (backstage / storage keep the station's ordinary dressing): a couple of flight cases (the existing footlocker holder:
//    finite electronics-store supplies) where they fit;
//  - WAYFINDING on the sign system in the expo's own style: plates over the event doors (KEYNOTE HALL, DEMO THEATRE A / B, DEVELOPER
//    LOUNGE, WASHROOMS) and hanging direction signs where people come in, their arrows along the real route.
// Circulation (gen/skyways/venueDress.ts eventVenueContext / group): 1.5 m clear in front of every door; every furniture group is kept only
// if every opening a bridge / stair entry reached before is still reached by a 1.2 m wide path; the routes found are then reserved as
// lanes before the smaller pieces. No enemies are placed here (the lead's event crowd pass). Pure data; the rng is consumed only here.

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, areaConnected, backed, cellsOfBox, markCell, rowAlongWall, wallRange, wallXZ} from '../../placeKit';
import type {Area, Side, SignPlacement, StationLayout} from '../../stationTypes';
import {OPP, doorPoint, hallFrame, normYaw, r3, toWorld, uvXZ, xzUV, yawToward, type AddonDresser, type HallFrame} from '../addonFrame';
import {SKYWAYS_STAGE, SKYWAYS_STAGE_DECK_D, SKYWAYS_STAGE_MODEL_SHIFT} from '../addonKinds';
import {SKYWAYS_ROPE} from '../addonPrize';
import {SKYWAYS_STAGE_DECK_EDGE, SKYWAYS_STAGE_SURFACES, stageWorldXZ, type StageSurface} from '../stageSupport';
import type {SkywaysRect, SkywaysVenueRole} from '../skywaysTypes';
import {VENUE_SIGN, arrowFor, entryAreas, eventVenueContext, group, markRoutes, markWalkRoutes, portalsOf, routeTable, type Portal, type VenueCtx} from '../venueDress';
import type {EventDressResult} from './eventResult';
import {EXPO_DIMS, EXPO_LED_IN_TRUSS, EXPO_SIGN_CABLE} from './expoKinds';
import {EXPO_EXHIBITORS, EXPO_KEYNOTE_SLIDES, EXPO_NAMES, EXPO_TALKS, type ExpoBoothTheme, type SkywaysExpoRecord} from './expoTypes';

/** The expo's public venue roles (the washrooms / backstage / storage keep the station's ordinary dressing). */
export const EXPO_PUBLIC_ROLES: readonly SkywaysVenueRole[] = ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge'];
/** The expo's wayfinding plates (deep navy, white letters, an electric-blue accent). */
export const EXPO_SIGN_STYLE = {bg: 0x0b1f3a, fg: 0xffffff, accent: 0x3fa9ff, font: 'condensed'} as const;
/** Loot key of the booth holders (server racks, the glass cabinet / counter) and of the back-of-house flight cases (items/lootTables.ts). */
export const EXPO_HOLDER_PURPOSE = 'mall-electronics';
export const EXPO_CASE_PURPOSE = 'mall-electronics-back';
/** A wall booth's plot (m: along the wall x into the room) and the aisle kept in front of it. */
export const EXPO_BOOTH = {w: 3.0, d: 3.0, aisle: 2.0, max: 10} as const;
/** The compact wall booth of a shallow piece (the booth wall, a demo counter and a plinth: 1 m deep) and the aisle kept before it. */
export const EXPO_COMPACT = {d: 1.0, aisle: 1.6} as const;
/** Half width of the keynote hall's reserved lanes (entry -> aisle -> stage front -> the steps' foot; entry -> every hall door). */
export const EXPO_LANE_HALF = 0.9;
/** Audience: rows at most, chairs per side of the centre aisle at most, row pitch, chair pitch along a row, the side aisles (m). */
export const EXPO_AUDIENCE = {rows: 7, perSide: 9, pitch: 1.0, seat: 0.5, side: 1.3} as const;

const SIDES: readonly Side[] = ['N', 'S', 'W', 'E'];

/** What the expo placed (QA / tests: gen/skyways/addon.ts keeps it as the add-on's `event` result). */
export interface ExpoDressResult extends EventDressResult {
  stage: PropPlacement | null;
  treads: PropPlacement[];
  led: PropPlacement | null;
  lectern: PropPlacement | null;
  chairs: PropPlacement[];
  barrier: PropPlacement[];
  screens: PropPlacement[];
  foh: PropPlacement[];
  /** Per booth: its area, exhibitor, theme, wall / island, its placements (booth wall, fixtures, hosts and the decor on them). */
  booths: {area: number; exhibitor: number; theme: ExpoBoothTheme; island: boolean; compact: boolean; props: PropPlacement[]}[];
  theatres: {area: number; screen: PropPlacement | null; table: PropPlacement | null; chairs: PropPlacement[]; decor: PropPlacement[]}[];
  lounge: {area: number; props: PropPlacement[]} | null;
  desks: PropPlacement[];
  /** Stanchion chains (registration queues + the crowd barrier) in rope order (addon.queues). */
  queues: PropPlacement[][];
  totems: PropPlacement[];
  hangSigns: PropPlacement[];
  cases: PropPlacement[];
  signs: {sign: SignPlacement; to: string; target: {x: number; z: number} | null}[];
  lanes: {area: number; ax: number; az: number; bx: number; bz: number; half: number}[];
}

interface Ex {
  vc: VenueCtx;
  v: AddonDresser;
  layout: StationLayout;
  res: ExpoDressResult;
  nameIdx: number;
  exOrder: number[];
  next: number;
  rec: SkywaysExpoRecord;
}

const snapC = (x: number) => Math.floor(x / CELL) * CELL + CELL / 2;
const snapB = (x: number) => Math.round(x / CELL) * CELL;
const inside = (p: Portal, d: number): [number, number] => [p.x + p.nx * d, p.z + p.nz * d];
const quarterToward = (dx: number, dz: number) => normYaw(Math.round(yawToward(dx, dz) / (Math.PI / 2)) * (Math.PI / 2));
const xzToU = (fr: HallFrame, x: number, z: number) => (fr.front === 'N' || fr.front === 'S' ? x - fr.x0 : z - fr.z0);
const sideLen = (a: Area, s: Side) => (s === 'N' || s === 'S' ? a.w : a.h) * CELL;

export function dressTechExpo(layout: StationLayout, rng: Rng): EventDressResult {
  const res: ExpoDressResult = {props: [], skipped: [], byArea: {}, stage: null, treads: [], led: null, lectern: null, chairs: [], barrier: [], screens: [], foh: [],
    booths: [], theatres: [], lounge: null, desks: [], queues: [], totems: [], hangSigns: [], cases: [], signs: [], lanes: []};
  const addon = layout.skyways?.addon, venue = addon?.venue;
  if (!addon || !venue?.length) { res.skipped.push('no venue'); return res; }
  // the seed's fictional expo, its exhibitors' order, the theatres' first talk (the dresser's first draws)
  const nameIdx = rng.int(0, EXPO_NAMES.length - 1);
  const exOrder = rng.shuffle(EXPO_EXHIBITORS.map((_, i) => i));
  const talk0 = rng.int(0, EXPO_TALKS.length - 1);
  const vc = eventVenueContext(layout, rng, EXPO_PUBLIC_ROLES);
  if (!vc) { res.skipped.push('no public venue area'); return res; }
  const n0 = layout.props.length;
  const rec: SkywaysExpoRecord = {name: EXPO_NAMES[nameIdx].name, nameIdx, booths: [], keynote: null, theatres: []};
  const ex: Ex = {vc, v: vc.v, layout, res, nameIdx, exOrder, next: 0, rec};
  const areasOf = (r: SkywaysVenueRole) => venue.filter(q => q.role === r).map(q => layout.areas[q.area]).filter(Boolean);

  // --- 1. the big pieces of every area (each group kept only if the routes survive) -----------------------------------------
  const hall = areasOf('main-hall')[0];
  if (hall) keynote(ex, hall); else res.skipped.push('expo: no keynote hall');
  for (const a of areasOf('registration')) welcome(ex, a);
  for (const a of areasOf('registration')) {
    const mouth = vc.portals.get(a.id)!.find(p => vc.bridges.has(p.to)) ?? null;
    if (!mouth && a.kind === 'concourse' && a.type === 'concourse') continue; // the keynote foyer: its totem only (below)
    registration(ex, a);
  }
  areasOf('panel').forEach((a, k) => theatre(ex, a, k, (talk0 + k) % EXPO_TALKS.length));
  for (const a of areasOf('photo-lounge')) lounge(ex, a);
  const pieces = areasOf('exhibitors').sort((p, q) => q.w * q.h - p.w * p.h);
  booths(ex, pieces);
  // --- 2. the routes become lanes; then the smaller pieces ----------------------------------------------------------------------
  for (const a of vc.walk.pub) {
    const l0 = vc.res.lanes.length;
    markRoutes(vc, a);
    res.lanes.push(...vc.res.lanes.slice(l0));
  }
  markWalkRoutes(vc);
  totems(ex, pieces, areasOf('registration'));
  backOfHouse(ex, [...areasOf('storage'), ...areasOf('backstage')]);
  // --- 3. wayfinding --------------------------------------------------------------------------------------------------------
  wayfinding(ex, vc.walk.pub.filter(a => vc.roleOf(a.id) !== 'main-hall'));

  vc.v.lift();
  for (let k = n0; k < layout.props.length; k++) {
    const p = layout.props[k], id = p.host !== undefined ? layout.props[p.host].area : p.area;
    (res.byArea[id] ??= []).push(p);
  }
  res.props = layout.props.slice(n0);
  for (const a of vc.walk.pub) if (!res.byArea[a.id]?.some(p => !p.mounted)) res.skipped.push(`expo: ${vc.roleOf(a.id)} ${a.id} bare`);
  // the rope chains (prop indices: world/skywaysAddonRuntime.ts draws a velvet rope between neighbours of a chain)
  addon.queues = res.queues.filter(c => c.length >= 2).map(c => c.map(p => layout.props.indexOf(p)));
  rec.booths = res.booths.map(b => {
    const ps = b.props.filter(p => p.host === undefined);
    return {area: b.area, name: EXPO_EXHIBITORS[b.exhibitor].name, exhibitor: b.exhibitor, theme: b.theme,
      x: r3(ps.reduce((t, p) => t + p.x, 0) / Math.max(1, ps.length)), z: r3(ps.reduce((t, p) => t + p.z, 0) / Math.max(1, ps.length))};
  });
  if (res.stage) rec.keynote = {area: res.stage.area, x: res.stage.x, z: res.stage.z};
  rec.theatres = res.theatres.map(t => t.area);
  addon.expo = rec;
  return res;
}

// ---------------------------------------------------------------------------------------------
// The keynote hall

/** The hall wall nearest the carve's stage box (the stage's back). */
function stageWall(a: Area, b: SkywaysRect): Side {
  const X0 = a.x * CELL, Z0 = a.y * CELL, X1 = (a.x + a.w) * CELL, Z1 = (a.y + a.h) * CELL;
  const d: [Side, number][] = [['N', b.z0 - Z0], ['S', Z1 - b.z1], ['W', b.x0 - X0], ['E', X1 - b.x1]];
  return d.sort((p, q) => p[1] - q[1])[0][0];
}

function keynote(ex: Ex, hall: Area): void {
  const {v, vc, layout, res} = ex, rng = v.rng;
  const box = layout.skyways!.addon.stage ?? null;
  const ps = vc.portals.get(hall.id) ?? [];
  const pubIn = ps.filter(p => { const r = vc.roleOf(p.to); return r === 'registration' || r === 'exhibitors'; }).sort((p, q) => q.half - p.half);
  const E = pubIn[0] ?? vc.hub.get(hall.id) ?? null;
  if (!E) { res.skipped.push('expo: keynote hall without an entry'); return; }
  const fr = hallFrame(hall, OPP[box ? stageWall(hall, box) : OPP[E.side]]);
  const ein = inside(E, 0.75);
  const lane = (a: readonly [number, number], b: readonly [number, number], half = EXPO_LANE_HALF) => {
    v.keepSegment(a[0], a[1], b[0], b[1], half);
    res.lanes.push({area: hall.id, ax: r3(a[0]), az: r3(a[1]), bx: r3(b[0]), bz: r3(b[1]), half});
  };

  // --- the stage (the convention's placement: deck edge on a cell line, its treads' collision boxes), back to the stage wall ----
  const halfW = PROP_DEFS.skywaysConStage.w / 2;
  const sc = box ? xzUV(fr, (box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2) : [fr.W / 2, fr.D - 2];
  const us0 = snapB(Math.max(halfW + 0.5, Math.min(fr.W - halfW - 0.5, sc[0])));
  const edgeToFront = SKYWAYS_STAGE.deckZ1 - SKYWAYS_STAGE_DECK_EDGE, deckDepth = SKYWAYS_STAGE_DECK_EDGE - SKYWAYS_STAGE.deckZ0;
  const vDeckFront = snapB(fr.D - 0.03 - deckDepth - 0.24) - edgeToFront, vDeck = vDeckFront + SKYWAYS_STAGE_DECK_D / 2;
  let us = us0;
  if (fr.W >= 2 * halfW + 0.8 && fr.D >= SKYWAYS_STAGE_DECK_D + 7) {
    for (const du of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
      const u = us0 + du;
      if (u < halfW + 0.3 || u > fr.W - halfW - 0.3) continue;
      const [x, z] = uvXZ(fr, u, vDeck);
      const got = group(vc, [hall], () => {
        const st = v.put('skywaysConStage', x, z, fr.toFront, {area: hall});
        if (!st) return null;
        const treads: PropPlacement[] = [];
        for (const surf of SKYWAYS_STAGE_SURFACES.slice(1)) { const t = treadBox(v, hall, st, surf); if (!t) return null; treads.push(t); }
        return {st, treads};
      });
      if (got) { res.stage = got.st; res.treads = got.treads; us = u; break; }
    }
  }
  if (!res.stage) res.skipped.push('expo: no room for the keynote stage');
  const st = res.stage;
  if (st) {
    const sti = layout.props.indexOf(st);
    // the LED video wall laced into the truss (behind the uprights, in front of the deck's back edge), its base just above the deck
    const [bx, bz] = toWorld(st, 0, SKYWAYS_STAGE.trussBackZ - EXPO_LED_IN_TRUSS.dz + SKYWAYS_STAGE_MODEL_SHIFT), lf = footprint('skyExpoLedWall', st.rot);
    const slide = rng.weighted<number>([[0, 0.6], [1, 0.2], [2, 0.2]]);
    res.led = v.push({kind: 'skyExpoLedWall', x: r3(bx), z: r3(bz), y: r3(SKYWAYS_STAGE.deckY + EXPO_LED_IN_TRUSS.y0), rot: st.rot, area: hall.id, hx: r3(lf.hx), hz: r3(lf.hz),
      h: PROP_DEFS.skyExpoLedWall.h, blocksSight: false, variant: ex.nameIdx * EXPO_KEYNOTE_SLIDES + slide, mounted: true, host: sti});
    // the lectern on the deck, stage left (the steps are stage right), a metre back from the deck edge, facing the audience
    const [lx, lz] = stageWorldXZ(st, -2.1, SKYWAYS_STAGE_DECK_EDGE - 1.0), cf = footprint('skyExpoLectern', st.rot);
    res.lectern = v.push({kind: 'skyExpoLectern', x: r3(lx), z: r3(lz), y: r3(st.y + st.h), rot: st.rot, area: hall.id, hx: r3(cf.hx), hz: r3(cf.hz), h: PROP_DEFS.skyExpoLectern.h,
      blocksSight: false, variant: ex.nameIdx, host: sti});
  }

  // --- lanes: entry -> the centre aisle -> the stage front -> the foot of its steps; entry -> every other door of the hall ---------
  const stepsD = SKYWAYS_STAGE.steps.z1 - SKYWAYS_STAGE.steps.z0;
  const vS = vDeckFront - stepsD - 0.35, vBar = vDeckFront - stepsD - 1.9, vMin = 3.0, P = EXPO_AUDIENCE;
  const rowsFrom = (vf: number) => Math.max(0, Math.min(P.rows, Math.floor((vf - vMin) / P.pitch) + 1));
  const withBarrier = !!st && rowsFrom(vBar - 0.85) >= 3;
  const vFirst = withBarrier ? vBar - 0.85 : vDeckFront - stepsD - 1.25;
  const nRows = rowsFrom(vFirst), vLast = vFirst - Math.max(0, nRows - 1) * P.pitch;
  const A = uvXZ(fr, us, Math.max(1.6, vLast - 1.4)), S = uvXZ(fr, us, vS);
  lane(ein, A); lane(A, S);
  if (st) {
    const sf = SKYWAYS_STAGE_SURFACES[2], foot = stageWorldXZ(st, (sf.x0 + sf.x1) / 2, sf.z1 + 0.7);
    lane(S, foot);
  }
  for (const d of layout.doors) {
    if (d.a !== hall.id && d.b !== hall.id) continue;
    const p = doorPoint(d, hall);
    if (Math.hypot(p.x - E.x, p.z - E.z) < 0.6) continue;
    lane(ein, [p.x + p.nx * 0.8, p.z + p.nz * 0.8]);
  }

  // --- the crowd barrier: stanchions either side of the aisle between the stage front and the first row ---------------------------
  if (withBarrier) {
    for (const s of [-1, 1]) {
      const u0 = us + s * 1.0, u1 = us + s * (halfW + 0.2), n = Math.max(2, Math.ceil(Math.abs(u1 - u0) / 2.2) + 1);
      const chain = group(vc, [hall], () => {
        const posts: PropPlacement[] = [];
        for (let k = 0; k < n; k++) {
          const [x, z] = uvXZ(fr, u0 + (u1 - u0) * k / (n - 1), vBar);
          const p = v.putRound('skywaysPrizeStanchion', x, z, fr.toBack, {area: hall, checkZone: false});
          if (!p) continue;
          const last = posts[posts.length - 1];
          if (last && Math.hypot(p.x - last.x, p.z - last.z) > SKYWAYS_ROPE.maxSpan) return null;
          posts.push(p);
        }
        return posts.length >= 2 ? posts : null;
      });
      if (chain) { res.barrier.push(...chain); res.queues.push(chain); }
    }
  }

  // --- the audience: rows of folding chairs facing the stage either side of the centre aisle ----------------------------------
  if (st && nRows) {
    const seat = (perSide: number, rows: number) => group(vc, [hall], () => {
      const out: PropPlacement[] = [];
      for (let r = 0; r < rows; r++) {
        const vv = vFirst - r * P.pitch;
        for (const s of [-1, 1]) for (let k = 0; k < perSide; k++) {
          const u = us + s * (1.2 + k * P.seat);
          if (u < P.side || u > fr.W - P.side) break;
          if (rng.chance(0.06)) continue; // a missing chair now and then
          const [x, z] = uvXZ(fr, u, vv);
          const turned = rng.chance(0.05) ? (rng.chance(0.5) ? 1 : -1) * Math.PI / 2 : 0;
          const p = v.put('foldingChair', snapC(x), snapC(z), normYaw(fr.toBack + turned), {area: hall});
          if (p) out.push(p);
        }
      }
      return out.length ? out : null;
    });
    res.chairs = seat(P.perSide, nRows) ?? (DBG(`seat1 fail W=${fr.W} D=${fr.D} rows=${nRows} vFirst=${vFirst}`), seat(5, Math.min(5, nRows))) ?? [];
    DBG(`seat W=${fr.W} D=${fr.D} rows=${nRows} chairs=${res.chairs.length} us=${us} vFirst=${vFirst}`);
    if (res.chairs.length < 12) res.skipped.push(`expo: keynote audience (${res.chairs.length})`);
  }

  // --- display screens on stands either side of the stage, facing the audience ----------------------------------------------------
  if (st) for (const s of [-1, 1]) {
    const u = us + s * (halfW + 1.3);
    if (u < 1.0 || u > fr.W - 1.0) continue;
    const [x, z] = uvXZ(fr, u, vDeckFront - 0.45);
    const p = group(vc, [hall], () => v.put('skyExpoScreenStand', x, z, fr.toFront, {area: hall, variant: 200 + ex.nameIdx}));
    if (p) res.screens.push(p);
  }

  // --- the front-of-house tech desk behind the audience (monitors facing its operator, who faces the stage) ---------------------------
  if (st) {
    const s0 = rng.chance(0.5) ? 1 : -1;
    for (const s of [s0, -s0]) {
      const uu = us + s * 2.4, vv = vLast - 2.1;
      if (vv < 2.6 || uu < 1.6 || uu > fr.W - 1.6) continue;
      const [x, z] = uvXZ(fr, uu, vv);
      const got = group(vc, [hall], () => {
        const t = v.put('skyExpoDemoTable', x, z, fr.toBack, {area: hall, variant: 10});
        if (!t) return null;
        const [cx, cz] = toWorld(t, 0, -(EXPO_DIMS.table.d / 2 + 0.38));
        const c = v.put('foldingChair', snapC(cx), snapC(cz), t.rot, {area: hall});
        return c ? [t, c] : [t];
      });
      if (!got) continue;
      const t = got[0], back = normYaw(t.rot + Math.PI);
      res.foh.push(...got);
      for (const lx of [-0.36, 0.36]) { const m = v.onTop(t, 'officeMonitor', lx, 0.12, t.h, back); if (m) res.foh.push(m); }
      const kb = v.onTop(t, 'tradingKeyboard', 0, -0.2, t.h, back);
      if (kb) res.foh.push(kb);
      break;
    }
  }

  // --- the day's schedule totem beside the entry lane, facing the entry ------------------------------------------------------------
  {
    const tx = -E.nz, tz = E.nx;
    let done: PropPlacement | null = null;
    for (const s of [1, -1]) for (const dv of [2.2, 2.8, 3.6, 1.6]) for (const lat of [E.half + 0.8, E.half + 1.5, E.half + 2.4]) {
      if (done) break;
      const x = E.x + E.nx * dv + tx * lat * s, z = E.z + E.nz * dv + tz * lat * s;
      done = group(vc, [hall], () => v.put('skyExpoSignStand', snapC(x), snapC(z), quarterToward(E.x - x, E.z - z), {area: hall, variant: 16 + ex.nameIdx, front: 0.5}));
    }
    if (done) res.totems.push(done); else res.skipped.push('expo: keynote schedule totem');
  }
}

/** A drawn tread's collision box (variant 1 of the stage kind; the convention's rule): its cells free floor of the hall or the stage's own. */
function treadBox(v: AddonDresser, hall: Area, st: PropPlacement, surf: StageSurface): PropPlacement | null {
  const g = v.g, corners = [[surf.x0, surf.z0], [surf.x1, surf.z0], [surf.x0, surf.z1], [surf.x1, surf.z1]].map(([mx, mz]) => stageWorldXZ(st, mx, mz));
  const x0 = Math.min(...corners.map(c => c[0])), x1 = Math.max(...corners.map(c => c[0])), z0 = Math.min(...corners.map(c => c[1])), z1 = Math.max(...corners.map(c => c[1]));
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, hx = r3((x1 - x0) / 2), hz = r3((z1 - z0) / 2);
  const own = (cx: number, cy: number) => (cx + 1) * CELL > st.x - st.hx + 0.04 && cx * CELL < st.x + st.hx - 0.04 && (cy + 1) * CELL > st.z - st.hz + 0.04 && cy * CELL < st.z + st.hz - 0.04;
  const cells: number[] = [];
  for (let cy = Math.floor((z - hz + 0.04) / CELL); cy <= Math.floor((z + hz - 0.04) / CELL); cy++) for (let cx = Math.floor((x - hx + 0.04) / CELL); cx <= Math.floor((x + hx - 0.04) / CELL); cx++) {
    if (own(cx, cy) && g.area[g.idx(cx, cy)] === hall.id) continue;
    if (!v.freeAt((cx + 0.5) * CELL, (cy + 0.5) * CELL, hall)) return null;
    cells.push(g.idx(cx, cy));
  }
  for (const i of cells) markCell(v.ctx, g.blocked, i);
  if (!areaConnected(v.ctx, hall)) return null; // (the caller's group rolls the marks back)
  return v.push({kind: 'skywaysConStage', x: r3(x), z: r3(z), y: 0, rot: st.rot, area: hall.id, hx, hz, h: surf.top, blocksSight: false, variant: 1});
}

// ---------------------------------------------------------------------------------------------
// Registration

/** The welcome totem at a bridge mouth, facing the people coming in (a corridor too narrow: just inside the next area along the way in). */
function welcome(ex: Ex, a: Area): void {
  const {v, vc, res} = ex;
  if (!vc.portals.get(a.id)!.some(p => vc.bridges.has(p.to))) return;
  let sign: PropPlacement | null = null;
  for (const sp of entryAreas(vc, a)) {
    const m = sp.at, tx = -m.nz, tz = m.nx;
    for (const side of [1, -1]) for (const lat of [m.half + 0.9, m.half + 1.6, 1.6, m.half + 2.4, 0.9]) for (const dv of [1.6, 2.2, 2.8, 3.6, 1.25]) {
      if (sign) break;
      const x = m.x + m.nx * dv + tx * lat * side, z = m.z + m.nz * dv + tz * lat * side;
      sign = group(vc, [sp.area], () => v.put('skyExpoSignStand', snapC(x), snapC(z), quarterToward(m.x - x, m.z - z), {area: sp.area, variant: ex.nameIdx, front: 0.5}));
    }
    if (sign) break;
  }
  if (sign) res.totems.push(sign); else res.skipped.push(`expo: registration ${a.id} welcome totem`);
}

function registration(ex: Ex, reg: Area): void {
  for (const {area: a, at: mouth} of entryAreas(ex.vc, reg)) if (deskRow(ex, a, mouth)) return;
  ex.res.skipped.push(`expo: registration ${reg.id} desks`);
}

/** 1-3 badge counters 0.75 m off a solid wall (a check-in monitor on each), a stanchion queue line in front, the REGISTRATION plate. */
function deskRow(ex: Ex, a: Area, mouth: Portal | null): boolean {
  const {v, vc, res} = ex;
  const sides = SIDES.filter(s => !mouth || s !== mouth.side).sort((p, q) => sideLen(a, q) - sideLen(a, p));
  const def = PROP_DEFS.skyExpoDemoCounter, off = 0.75 + def.d / 2;
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
            // (a 1.0 m clear strip: the queue posts 1.5 m out stand in the next cell row)
            const p = v.put('skyExpoDemoCounter', x, z, WALL_ROT[side], {area: a, front: 1.0, variant: 100 + ex.nameIdx});
            if (!p) return null;
            row.push(p);
          }
          // the queue line 1.5 m in front of the counters (posts that do not fit are left out; a rope never crosses a lane)
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
        // a check-in monitor on each counter facing its staff (behind the counter)
        for (const t of got.row) { const m = v.onTop(t, 'officeMonitor', 0.35, -0.08, t.h, normYaw(t.rot + Math.PI)); if (m) res.desks.push(m); }
        res.desks.push(...got.row);
        res.queues.push(...got.chains);
        // the REGISTRATION plate hung over the middle of the counter row, facing the queue
        const c0 = got.row[0], c1 = got.row[got.row.length - 1], fx = Math.sin(c0.rot), fz = Math.cos(c0.rot);
        if (a.ceil - v.base >= VENUE_SIGN.y + 0.6) {
          const sign: SignPlacement = {x: r3((c0.x + c1.x) / 2 + fx * 0.2), y: r3(v.base + VENUE_SIGN.y + 0.15), z: r3((c0.z + c1.z) / 2 + fz * 0.2), rot: r3(c0.rot), kind: 'info',
            text: 'REGISTRATION · BADGE PICKUP', area: a.id, hang: true, w: 2.6, level: v.level, style: EXPO_SIGN_STYLE};
          v.layout.signs.push(sign);
          res.signs.push({sign, to: 'REGISTRATION', target: null});
        }
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Demo theatres

/** A demo theatre: the talk's title slide on a presentation screen at the back wall, the presenter's table beside it, audience rows. */
function theatre(ex: Ex, a: Area, k: number, talk: number): void {
  const {v, vc, res} = ex, ps = vc.portals.get(a.id)!, rng = v.rng;
  const door = ps.find(p => p.door) ?? ps[0] ?? null;
  const fr = hallFrame(a, door?.side ?? 'S');
  const out: ExpoDressResult['theatres'][number] = {area: a.id, screen: null, table: null, chairs: [], decor: []};
  const sd = EXPO_DIMS.screenStand, td = EXPO_DIMS.table;
  const du = door ? xzToU(fr, door.x, door.z) : fr.W / 2;
  const uc = Math.round(fr.W / 2 * 2) / 2;
  // the screen: centred on the back wall (else a little to either side)
  let us = uc;
  for (const off of [0, -0.5, 0.5, -1, 1]) {
    const [x, z] = uvXZ(fr, uc + off, fr.D - sd.d / 2 - 0.08);
    out.screen = group(vc, [a], () => v.put('skyExpoScreenStand', x, z, fr.toFront, {area: a, variant: 100 + talk}));
    if (out.screen) { us = uc + off; break; }
  }
  // the presenter's table beside the screen, facing the audience (the presenter's chair behind it), its monitor / keyboard facing them
  const tv = fr.D - 0.9 - td.d / 2;
  for (const s of rng.shuffle([1, -1])) {
    const tu = us + s * (sd.w / 2 + 0.35 + td.w / 2);
    if (tu - td.w / 2 < 0.3 || tu + td.w / 2 > fr.W - 0.3) continue;
    const [x, z] = uvXZ(fr, tu, tv);
    const got = group(vc, [a], () => {
      const t = v.put('skyExpoDemoTable', x, z, fr.toFront, {area: a, variant: 12});
      if (!t) return null;
      const [cx, cz] = toWorld(t, 0, -(td.d / 2 + 0.4));
      const c = v.put('foldingChair', snapC(cx), snapC(cz), t.rot, {area: a});
      return {t, c};
    });
    if (!got) continue;
    out.table = got.t;
    if (got.c) out.decor.push(got.c);
    const back = normYaw(got.t.rot + Math.PI);
    const m = v.onTop(got.t, 'officeMonitor', -0.3, 0.12, got.t.h, back), kb = v.onTop(got.t, 'tradingKeyboard', -0.3, -0.2, got.t.h, back);
    const pc = v.onTop(got.t, 'skyExpoTowerPc', 0.55, 0.05, got.t.h, back);
    for (const q of [m, kb, pc]) if (q) out.decor.push(q);
    break;
  }
  if (!out.screen) res.skipped.push(`expo: theatre ${a.id} screen`);
  if (!out.table) res.skipped.push(`expo: theatre ${a.id} presenter table`);
  // the aisle: the door -> the front of the audience
  const front = Math.min(fr.D - sd.d - 0.1, out.table ? tv - td.d / 2 : fr.D);
  const A = uvXZ(fr, du, 0.9), B = uvXZ(fr, us, Math.max(1.2, front - 1.3));
  v.keepSegment(A[0], A[1], B[0], B[1], 0.7);
  res.lanes.push({area: a.id, ax: r3(A[0]), az: r3(A[1]), bx: r3(B[0]), bz: r3(B[1]), half: 0.7});
  // audience rows facing the screen either side of the aisle
  const deep = fr.D >= 7.2;
  for (let vr = front - (deep ? 1.5 : 1.25); vr >= (deep ? 1.4 : 1.0); vr -= 0.95) {
    for (let u = 0.6; u <= fr.W - 0.6; u += 0.55) {
      if (rng.chance(0.05)) continue;
      const [x, z] = uvXZ(fr, u, vr);
      const c = v.put('foldingChair', snapC(x), snapC(z), normYaw(fr.toBack + (rng.chance(0.05) ? (rng.chance(0.5) ? 0.5 : -0.5) * Math.PI : 0)), {area: a});
      if (c) out.chairs.push(c);
    }
  }
  if (out.chairs.length < 4) res.skipped.push(`expo: theatre ${a.id} audience (${out.chairs.length})`);
  void k;
  res.theatres.push(out);
}

// ---------------------------------------------------------------------------------------------
// The developer lounge

function lounge(ex: Ex, a: Area): void {
  const {v, vc, res} = ex, ps = vc.portals.get(a.id)!, rng = v.rng;
  const door = ps.find(p => p.door) ?? ps[0] ?? null;
  const fr = hallFrame(a, door?.side ?? 'S');
  const n0 = v.layout.props.length, uc = Math.round(fr.W / 2 * 2) / 2;
  const du = door ? xzToU(fr, door.x, door.z) : uc;
  // the console station against the back wall facing the door, the lane from the door to its front
  const cd = PROP_DEFS.consoleStation;
  let con: PropPlacement | null = null;
  for (const off of [0, -0.5, 0.5, -1, 1, -1.5, 1.5]) {
    const [x, z] = uvXZ(fr, uc + off, fr.D - cd.d / 2 - 0.05);
    con = group(vc, [a], () => v.put('consoleStation', x, z, fr.toFront, {area: a, front: 1.2}));
    if (con) break;
  }
  const A = uvXZ(fr, du, 0.9), B = uvXZ(fr, con ? xzToU(fr, con.x, con.z) : uc, Math.max(1.2, fr.D - cd.d - 1.5));
  v.keepSegment(A[0], A[1], B[0], B[1], 0.6);
  res.lanes.push({area: a.id, ax: r3(A[0]), az: r3(A[1]), bx: r3(B[0]), bz: r3(B[1]), half: 0.6});
  // armchairs / bean bags facing it
  if (con) {
    const cu = xzToU(fr, con.x, con.z);
    for (const [kind, du2, dv2] of [['loungeArmchair', -1.0, 2.4], ['loungeArmchair', 1.0, 2.4], ['beanBag', -1.7, 1.7], ['beanBag', 1.7, 1.7], ['beanBag', 0, 3.2]] as [PropKind, number, number][]) {
      const [x, z] = uvXZ(fr, cu + du2, fr.D - dv2);
      group(vc, [a], () => v.put(kind, snapC(x), snapC(z), quarterToward(con!.x - x, con!.z - z), {area: a}));
    }
  }
  // the charging table along a side wall: demo phones and a tablet on its top
  const flanks: Side[] = fr.front === 'N' || fr.front === 'S' ? ['W', 'E'] : ['N', 'S'];
  for (const side of rng.shuffle(flanks.slice())) {
    const got = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'skyExpoDemoTable', {max: 1, front: 0.9}); return r.length ? r[0] : null; });
    if (!got) continue;
    got.variant = 13;
    for (const [kind, lx] of [['skyMerchDemoPhone', -0.55], ['skyMerchDemoPhone', -0.3], ['skyMerchDemoTablet', 0.05], ['skyMerchDemoPhone', 0.4]] as [PropKind, number][]) v.onTop(got, kind, lx, 0.05, got.h);
    break;
  }
  for (const side of SIDES) rowAlongWall(v.ctx, a, side, 'pottedPlantSmall', {max: 1, front: 0.3});
  const props = v.layout.props.slice(n0);
  for (const p of props) if (p.host === undefined && !v.placed.includes(p)) v.placed.push(p);
  res.lounge = {area: a.id, props};
  if (!con) res.skipped.push(`expo: lounge ${a.id} console`);
}

// ---------------------------------------------------------------------------------------------
// The expo floor: exhibitor booths

interface Plot { a: Area; x: number; z: number; rot: number; island: boolean; side: Side | null; t0: number }
type Put = (kind: PropKind, lx: number, lz: number, turn?: number, o?: {front?: number; variant?: number; purpose?: string}) => PropPlacement | null;

function booths(ex: Ex, pieces: readonly Area[]): void {
  const {v, vc, res} = ex;
  const taken: {x0: number; z0: number; x1: number; z1: number}[] = [];
  const rectOf = (p: Plot, w: number, d: number) => {
    const c = [toWorld(p, -w / 2, 0), toWorld(p, w / 2, 0), toWorld(p, -w / 2, d), toWorld(p, w / 2, d)];
    return {x0: Math.min(...c.map(q => q[0])), z0: Math.min(...c.map(q => q[1])), x1: Math.max(...c.map(q => q[0])), z1: Math.max(...c.map(q => q[1]))};
  };
  const clash = (r: {x0: number; z0: number; x1: number; z1: number}, pad = 0) => taken.some(q => q.x0 < r.x1 + pad && q.x1 > r.x0 - pad && q.z0 < r.z1 + pad && q.z1 > r.z0 - pad);
  const nextEx = () => (ex.next < ex.exOrder.length ? ex.exOrder[ex.next++] : null);
  // wall booths first (every piece deep enough: the full booth, else the compact one), then island booths in the roomiest
  for (const a of pieces) {
    if (Math.min(a.w, a.h) * CELL < EXPO_COMPACT.d + EXPO_COMPACT.aisle) continue;
    for (const plot of wallPlots(ex, a)) {
      if (ex.next >= EXPO_BOOTH.max) break;
      const deep = (plot.side === 'N' || plot.side === 'S' ? a.h : a.w) * CELL;
      for (const compact of deep >= EXPO_BOOTH.d + EXPO_BOOTH.aisle ? [false, true] : [true]) {
        // the plot with its aisle (booths side by side may touch; never one booth in another's aisle)
        const r = rectOf(plot, EXPO_BOOTH.w, compact ? EXPO_COMPACT.d + EXPO_COMPACT.aisle : EXPO_BOOTH.d + EXPO_BOOTH.aisle);
        if (clash(r, -0.02)) { DBG(`plot ${a.id} ${plot.side} ${plot.t0}: clash`); continue; }
        const e = ex.exOrder[ex.next];
        WHY = 'route';
        const got = group(vc, [a], () => wallBooth(ex, plot, e, compact));
        DBG(`plot ${a.id} ${plot.side} ${plot.t0} ${EXPO_EXHIBITORS[e].theme}${compact ? '/c' : ''}: ${got ? 'OK' : WHY}`);
        if (!got) continue;
        nextEx();
        taken.push(r);
        res.booths.push({area: a.id, exhibitor: e, theme: EXPO_EXHIBITORS[e].theme, island: false, compact, props: got});
        break;
      }
    }
  }
  for (const a of pieces) {
    if (Math.min(a.w, a.h) * CELL < 9.5) continue;
    const want = Math.max(1, Math.min(3, Math.floor(a.w * a.h * CELL * CELL / 60)));
    const hub = vc.hub.get(a.id);
    const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
    // (the island faces the piece's way in; its across axis on a cell line so its pieces fill whole cells)
    const rot = hub ? quarterToward(hub.x - cx, hub.z - cz) : 0, ns = Math.abs(Math.cos(rot)) > 0.5;
    const cands: [number, number][] = [];
    for (let y = a.y + 3; y < a.y + a.h - 3; y++) for (let x = a.x + 3; x < a.x + a.w - 3; x++) cands.push(ns ? [(x + 1) * CELL, (y + 0.5) * CELL] : [(x + 0.5) * CELL, (y + 1) * CELL]);
    cands.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
    let n = 0;
    for (const [x, z] of cands) {
      if (n >= want || ex.next >= EXPO_BOOTH.max) break;
      const plot: Plot = {a, x, z, rot, island: true, side: null, t0: 0};
      // (the island's plot, 3.2 x 2.4 m, with a 1 m ring kept off every other booth and its aisle)
      const b = rectOf({...plot, ...(() => { const [bx, bz] = toWorld(plot, 0, -1.2); return {x: bx, z: bz}; })()}, 3.2, 2.4);
      const r = {x0: b.x0 - 1, z0: b.z0 - 1, x1: b.x1 + 1, z1: b.z1 + 1};
      if (clash(r, -0.02)) continue;
      if (!clearRect(v, a, b, 1.4)) continue;
      const e = ex.exOrder[ex.next];
      const got = group(vc, [a], () => islandBooth(ex, plot, e));
      if (!got) continue;
      nextEx();
      taken.push(r);
      n++;
      const props = [...got];
      const sign = hangSign(ex, a, x, z, rot, e);
      if (sign) props.push(sign);
      res.booths.push({area: a.id, exhibitor: e, theme: EXPO_EXHIBITORS[e].theme, island: true, compact: false, props});
    }
  }
  if (res.booths.length < 3) res.skipped.push(`expo: ${res.booths.length} booths`);
  // the narrow pieces (no booth): display plinths with a demo device along a long wall
  for (const a of pieces) if (!res.booths.some(b => b.area === a.id)) sliver(ex, a);
}

/** A narrow expo floor piece: one or two display plinths (a demo phone / tablet on each) against its long walls, the route kept. */
function sliver(ex: Ex, a: Area): void {
  const {v, vc} = ex;
  const long: Side[] = a.w >= a.h ? ['N', 'S'] : ['W', 'E'];
  if (Math.min(a.w, a.h) * CELL < 1.9) return;
  const [lo, hi] = wallRange(a, long[0]), L = hi - lo;
  const spots = L >= 8 ? [lo + L * 0.3, lo + L * 0.7] : L >= 3 ? [lo + L / 2] : [];
  spots.forEach((t, k) => {
    for (const side of v.rng.shuffle(long.slice())) {
      const got = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'skyExpoPlinth', {from: t - 0.75, to: t + 0.75, max: 1, front: 0.6}); return r.length ? r[0] : null; });
      if (!got) continue;
      got.variant = k % 2;
      v.placed.push(got);
      v.onTop(got, k % 2 ? 'skyMerchDemoTablet' : 'skyMerchDemoPhone', 0, 0.02, got.h);
      break;
    }
  });
}

/** Every free floor cell of `a` within `pad` m of the rect (and none outside the area). */
function clearRect(v: AddonDresser, a: Area, r: {x0: number; z0: number; x1: number; z1: number}, pad: number): boolean {
  const g = v.g;
  for (let cy = Math.floor((r.z0 - pad) / CELL); cy <= Math.floor((r.z1 + pad - 1e-6) / CELL); cy++) for (let cx = Math.floor((r.x0 - pad) / CELL); cx <= Math.floor((r.x1 + pad - 1e-6) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (g.area[i] !== a.id || g.blocked[i] || v.ctx.edge[i]) return false;
  }
  return true;
}

/** Wall booth plots of a piece: a solid wall span of the booth's width (no glazing below the header), the room deep enough before it. */
function wallPlots(ex: Ex, a: Area): Plot[] {
  const {v, layout} = ex, out: Plot[] = [];
  const wins = (layout.skyways?.windows ?? []).filter(w => w.level === v.level);
  for (const side of v.rng.shuffle(SIDES.slice())) {
    const deep = (side === 'N' || side === 'S' ? a.h : a.w) * CELL;
    if (deep < EXPO_COMPACT.d + EXPO_COMPACT.aisle) continue;
    const [lo, hi] = wallRange(a, side), along = side === 'N' || side === 'S';
    for (let t0 = Math.ceil((lo + 0.25) * 2) / 2; t0 + EXPO_BOOTH.w <= hi - 0.25; t0 += 0.5) {
      if (!backed(v.ctx, a, side, t0, t0 + EXPO_BOOTH.w, v.base + 2.45)) continue;
      const [wx, wz] = wallXZ(a, side, t0, -CELL / 2);
      const sx0 = along ? t0 : wx - CELL / 2, sx1 = along ? t0 + EXPO_BOOTH.w : wx + CELL / 2, sz0 = along ? wz - CELL / 2 : t0, sz1 = along ? wz + CELL / 2 : t0 + EXPO_BOOTH.w;
      if (wins.some(w => w.x0 < sx1 + 0.05 && w.x1 > sx0 - 0.05 && w.z0 < sz1 + 0.05 && w.z1 > sz0 - 0.05 && w.sill < 2.6)) continue;
      const [x, z] = wallXZ(a, side, t0 + EXPO_BOOTH.w / 2, 0);
      out.push({a, x, z, rot: WALL_ROT[side], island: false, side, t0});
    }
  }
  return out;
}

const putter = (ex: Ex, plot: Plot, list: PropPlacement[]): Put => (kind, lx, lz, turn = 0, o = {}) => {
  const [x, z] = toWorld(plot, lx, lz);
  const p = ex.v.put(kind, r3(x), r3(z), normYaw(plot.rot + turn), {area: plot.a, ...(o.front ? {front: o.front} : {}), ...(o.variant !== undefined ? {variant: o.variant} : {})});
  if (p && o.purpose) p.purpose = o.purpose;
  if (p) list.push(p);
  return p;
};
/** Decor on a host's top at host-local (lx, lz), turned `turn` from the host. */
const decor = (ex: Ex, host: PropPlacement | null, list: PropPlacement[], kind: PropKind, lx: number, lz: number, turn = 0, variant = 0): PropPlacement | null => {
  if (!host) return null;
  const p = ex.v.onTop(host, kind, lx, lz, host.h, normYaw(host.rot + turn));
  if (p) { p.variant = variant; list.push(p); }
  return p;
};
/** A theme's loose device for a plinth / counter top. */
const DEVICE: Readonly<Record<ExpoBoothTheme, PropKind>> = {mobile: 'skyMerchDemoPhone', display: 'skyMerchDemoTablet', data: 'skyExpoTowerPc', retro: 'crtTerminal', games: 'skyMerchDemoTablet',
  workstation: 'officeMonitor', showcase: 'skyMerchDemoPhone'};

/**
 * A booth fixture (booth frame: lx across the booth, -1.5..1.5; lz from the booth wall into the aisle, 0..3; laid out on the 0.5 m
 * placement cells so neighbours never share one): lz 'back' = against the booth wall's face; `req` = the booth is not kept without it;
 * `top` = loose decor on its top (host-local lx, lz, turn: 0 = facing the aisle like the host).
 */
interface BoothItem { k: PropKind; lx: number; lz: number | 'back'; turn?: number; front?: number; variant?: number | 'e'; purpose?: string; req?: boolean; top?: readonly (readonly [PropKind, number, number, number?])[] }
const BACK = 'back' as const, PI = Math.PI;
/** Each theme's booth (the reused fixtures of the theme first; the expo's own tables / counters / plinths carry the loose devices). */
const BOOTH_PLANS: Readonly<Record<ExpoBoothTheme, readonly BoothItem[]>> = {
  mobile: [
    {k: 'deviceWall', lx: -0.9, lz: BACK, req: true},
    {k: 'techDisplay', lx: 0.3, lz: 2.0, variant: 0, req: true}, // (variant 0: the merch split turns its devices into loose demo props)
    {k: 'skyExpoPlinth', lx: 0.75, lz: BACK, variant: 1, top: [['skyMerchDemoTablet', 0, 0.02]]},
  ],
  display: [
    {k: 'tvWall', lx: 0, lz: BACK, req: true},
    {k: 'skyExpoScreenStand', lx: -0.75, lz: 2.2, variant: 'e', req: true},
    {k: 'skyExpoPlinth', lx: 0.75, lz: 2.2, variant: 0, top: [['skyMerchDemoTablet', 0, 0.02]]},
  ],
  data: [
    {k: 'serverRack', lx: -1.2, lz: BACK, front: 1.0, purpose: EXPO_HOLDER_PURPOSE, req: true},
    {k: 'skyExpoDemoTable', lx: 0.5, lz: BACK, variant: 'e', req: true, top: [['officeMonitor', -0.3, -0.15], ['tradingKeyboard', -0.3, 0.22], ['skyExpoTowerPc', 0.5, -0.1]]},
    {k: 'foldingChair', lx: 0.2, lz: 1.4, turn: PI},
  ],
  retro: [
    {k: 'skyExpoDemoTable', lx: -0.5, lz: BACK, variant: 'e', req: true,
      top: [['crtTerminal', -0.4, -0.1], ['crtTerminal', 0.4, -0.1], ['tradingKeyboard', -0.4, 0.27], ['tradingKeyboard', 0.4, 0.27]]},
    {k: 'foldingChair', lx: -0.9, lz: 1.4, turn: PI}, {k: 'foldingChair', lx: -0.1, lz: 1.4, turn: PI},
    {k: 'skyExpoDemoCounter', lx: 0.6, lz: 2.5, variant: 'e', req: true, top: [['crtTerminal', 0, -0.04]]},
  ],
  games: [
    {k: 'consoleStation', lx: -0.75, lz: BACK, req: true},
    {k: 'arcadeCabinet', lx: 0.95, lz: BACK, front: 0.9, req: true},
    {k: 'beanBag', lx: -0.75, lz: 2.1, turn: PI},
  ],
  workstation: [
    {k: 'skyExpoDemoTable', lx: -0.5, lz: BACK, variant: 'e', req: true, top: [['officeMonitor', -0.35, -0.15], ['officeMonitor', 0.35, -0.15], ['tradingKeyboard', 0, 0.22]]},
    {k: 'skyExpoTowerPc', lx: 0.65, lz: BACK},
    {k: 'foldingChair', lx: -0.5, lz: 1.4, turn: PI},
    {k: 'skyExpoDemoTable', lx: 0.6, lz: 2.45, variant: 'e', req: true, top: [['officeMonitor', 0, -0.15], ['tradingKeyboard', 0, 0.22], ['skyExpoTowerPc', 0.6, -0.1]]},
  ],
  showcase: [
    {k: 'glassDisplayCabinet', lx: -0.95, lz: BACK, front: 0.6, purpose: EXPO_HOLDER_PURPOSE, req: true},
    {k: 'glassDisplayCabinet', lx: 0.95, lz: BACK, front: 0.6, purpose: EXPO_HOLDER_PURPOSE},
    {k: 'glassCounter', lx: 0, lz: 2.35, purpose: EXPO_HOLDER_PURPOSE, req: true},
  ],
};

/**
 * A wall booth: the theme's fixtures (the reused kinds first), then the shell-scheme booth wall behind them — pushed last so the
 * fixtures can stand against its face (it shares the wall-side cell row with them; its other cells of that row are blocked here) —
 * and a plinth with a device in a free front corner. Null (the group rolls everything back) if a required fixture does not fit.
 */
function wallBooth(ex: Ex, plot: Plot, e: number): PropPlacement[] | null {
  const {v} = ex, list: PropPlacement[] = [], put = putter(ex, plot, list), theme = EXPO_EXHIBITORS[e].theme, rng = v.rng, g = v.g;
  const bwD = EXPO_DIMS.boothWall.d, W0 = bwD + 0.02; // the booth wall's face
  const [bx, bz] = toWorld(plot, 0, bwD / 2 + 0.005), bf = footprint('skyExpoBoothWall', plot.rot), [c0, r0, c1, r1] = cellsOfBox(bx, bz, bf.hx, bf.hz);
  const wallCells: number[] = [];
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    if (!g.inBounds(cx, cy)) return null;
    const i = g.idx(cx, cy);
    if (!v.freeAt((cx + 0.5) * CELL, (cy + 0.5) * CELL, plot.a) || v.ctx.lane[i] || v.ctx.doorCell[i] || v.ctx.zone[i] || v.ctx.edge[i]) { WHY = `cell free=${v.freeAt((cx + 0.5) * CELL, (cy + 0.5) * CELL, plot.a)} blk=${g.blocked[i]} keep=${v.ctx.keep[i]} lane=${v.ctx.lane[i]} door=${v.ctx.doorCell[i]} zone=${v.ctx.zone[i]} edge=${v.ctx.edge[i]}`; return null; }
    wallCells.push(i);
  }
  for (const it of BOOTH_PLANS[theme]) {
    const def = PROP_DEFS[it.k], turned = Math.abs(Math.sin(it.turn ?? 0)) > 0.5;
    const lz = it.lz === BACK ? W0 + (turned ? def.w : def.d) / 2 : it.lz;
    const p = put(it.k, it.lx, lz, it.turn ?? 0, {front: it.front, variant: it.variant === 'e' ? e : it.variant, purpose: it.purpose});
    if (!p) { if (it.req) { WHY = 'req ' + it.k; return null; } continue; }
    for (const [k, lx, tz, turn] of it.top ?? []) decor(ex, p, list, k, lx, tz, turn ?? 0);
  }
  // the booth wall (its row's cells not under a fixture blocked now; the area must stay connected)
  for (const i of wallCells) if (!g.blocked[i]) markCell(v.ctx, g.blocked, i);
  if (!areaConnected(v.ctx, plot.a)) { WHY = 'conn'; return null; }
  list.unshift(v.push({kind: 'skyExpoBoothWall', x: r3(bx), z: r3(bz), y: 0, rot: r3(plot.rot), area: plot.a.id, hx: r3(bf.hx), hz: r3(bf.hz), h: EXPO_DIMS.boothWall.h,
    blocksSight: false, variant: e}));
  // the front corner's plinth with a demo device (where it fits)
  const s = rng.chance(0.5) ? 1 : -1;
  for (const side of [s, -s]) {
    const pl = put('skyExpoPlinth', side * 1.2, 2.7, 0, {variant: rng.int(0, 1)});
    if (!pl) continue;
    decor(ex, pl, list, theme === 'mobile' || theme === 'showcase' ? 'skyMerchDemoPhone' : 'skyMerchDemoTablet', 0, 0.02);
    break;
  }
  return list;
}

/** An open island booth (frame origin = its centre, front toward the piece's way in): a demo counter, a screen behind it, two plinths. */
function islandBooth(ex: Ex, plot: Plot, e: number): PropPlacement[] | null {
  const list: PropPlacement[] = [], put = putter(ex, plot, list), theme = EXPO_EXHIBITORS[e].theme;
  const c = put('skyExpoDemoCounter', 0, 0.35, 0, {variant: e});
  if (!c) return null;
  const scr = put('skyExpoScreenStand', 0, -0.6, 0, {variant: e});
  if (!scr) return null;
  const dev = DEVICE[theme];
  if (dev === 'officeMonitor') { decor(ex, c, list, 'officeMonitor', -0.35, -0.05); decor(ex, c, list, 'tradingKeyboard', 0.3, 0.1); }
  else if (dev === 'crtTerminal') decor(ex, c, list, 'crtTerminal', 0, -0.04);
  else if (dev === 'skyExpoTowerPc') { decor(ex, c, list, 'skyExpoTowerPc', -0.5, 0); decor(ex, c, list, 'skyMerchDemoTablet', 0.3, 0.05); }
  else for (const lx of [-0.45, 0, 0.45]) decor(ex, c, list, dev, lx, 0.05);
  for (const s of [-1, 1]) {
    const pl = put('skyExpoPlinth', s * 1.35, 0.1, 0, {variant: s > 0 ? 1 : 0});
    decor(ex, pl, list, dev === 'skyMerchDemoPhone' ? 'skyMerchDemoTablet' : 'skyMerchDemoPhone', 0, 0.02);
  }
  return list;
}

/** A booth sign hung from the ceiling over (x, z): >= 2.5 m clear under it, nothing of the venue's furniture reaching up into it. */
function hangSign(ex: Ex, a: Area, x: number, z: number, rot: number, e: number): PropPlacement | null {
  const {v, res} = ex, def = PROP_DEFS.skyExpoHangSign, {hx, hz} = footprint('skyExpoHangSign', rot);
  let ceil = Infinity;
  for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x, z]]) {
    const [cx, cy] = v.g.cellOf(px, pz);
    if (!v.g.inBounds(cx, cy) || v.g.area[v.g.idx(cx, cy)] !== a.id) return null;
    ceil = Math.min(ceil, v.g.ceilAt(px, pz));
  }
  const y = Math.round((Math.min(ceil, a.ceil) - v.base - def.h - 0.02) * 100) / 100;
  if (!Number.isFinite(y) || y < 2.5) return null;
  if (v.placed.some(p => !p.mounted && Math.abs(p.x - x) < p.hx + hx && Math.abs(p.z - z) < p.hz + hz && p.y + p.h > y - 0.1)) return null;
  const p = v.push({kind: 'skyExpoHangSign', x: r3(x), z: r3(z), y, rot: r3(rot), area: a.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: false, variant: e, mounted: true});
  res.hangSigns.push(p);
  return p;
}
void EXPO_SIGN_CABLE;

// ---------------------------------------------------------------------------------------------
// Totems, back of house

/** The exhibitor directory in the roomiest piece by its way in, the theatres' programme by a theatre door, a touch kiosk in registration. */
function totems(ex: Ex, pieces: readonly Area[], regs: readonly Area[]): void {
  const {v, vc, res} = ex;
  const near = (a: Area, p: Portal, variant: number): PropPlacement | null => {
    const tx = -p.nz, tz = p.nx;
    for (const s of [1, -1]) for (const dv of [1.8, 2.4, 3.0, 3.8]) for (const lat of [p.half + 0.8, p.half + 1.4, p.half + 2.2]) {
      const x = p.x + p.nx * dv + tx * lat * s, z = p.z + p.nz * dv + tz * lat * s;
      const got = group(vc, [a], () => v.put('skyExpoSignStand', snapC(x), snapC(z), quarterToward(p.x - x, p.z - z), {area: a, variant, front: 0.5}));
      if (got) return got;
    }
    return null;
  };
  // (the roomiest piece's way in first, then its other openings, then the next piece's)
  let dir: PropPlacement | null = null;
  for (const a of pieces.slice(0, 2)) {
    for (const p of [vc.hub.get(a.id), ...(vc.portals.get(a.id) ?? [])]) if (p && !dir) dir = near(a, p, 32 + ex.nameIdx);
    if (dir) break;
  }
  if (dir) res.totems.push(dir); else res.skipped.push('expo: directory totem');
  // the demo theatre programme outside the first theatre's door (on the expo floor's side)
  for (const a of pieces) {
    const p = (vc.portals.get(a.id) ?? []).find(q => q.door && vc.roleOf(q.to) === 'panel');
    if (!p) continue;
    const t = near(a, p, 48 + ex.nameIdx);
    if (t) { res.totems.push(t); break; }
  }
  // a touch kiosk ("find an exhibitor") against a solid wall of a registration corridor
  for (const a of regs) {
    const got = (() => { for (const side of v.rng.shuffle(SIDES.slice())) { const r = group(vc, [a], () => { const q = rowAlongWall(v.ctx, a, side, 'infoTouchKiosk', {max: 1, front: 0.9}); return q.length ? q[0] : null; }); if (r) return r; } return null; })();
    if (got) { v.placed.push(got); res.totems.push(got); break; }
  }
}

/** A couple of flight cases (footlockers: openable, finite electronics supplies) in the expo storage / staff room, where they fit. */
function backOfHouse(ex: Ex, rooms: readonly Area[]): void {
  const {v, res} = ex;
  for (const a of rooms) {
    for (const side of v.rng.shuffle(SIDES.slice())) {
      const got = rowAlongWall(v.ctx, a, side, 'footlocker', {max: 2, front: 0.6});
      for (const p of got) { p.purpose = EXPO_CASE_PURPOSE; res.cases.push(p); }
      if (got.length) return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Wayfinding

const SIGN_NAMES: Partial<Record<SkywaysVenueRole, string>> = {'main-hall': 'KEYNOTE HALL', 'photo-lounge': 'DEVELOPER LOUNGE', registration: 'REGISTRATION', exhibitors: 'EXPO FLOOR'};

/** A plate over (or beside) a door on `a`'s side of the wall, in the expo's style. */
function plate(v: AddonDresser, a: Area, p: Portal, text: string): SignPlacement | null {
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
  const s: SignPlacement = {x: r3(pos.x), y: r3(v.base + y), z: r3(pos.z), rot: r3(pos.rot), kind: 'info', text, area: a.id, w: r3(w), level: v.level, style: EXPO_SIGN_STYLE};
  v.layout.signs.push(s);
  return s;
}

function wayfinding(ex: Ex, areas: readonly Area[]): void {
  const {v, vc, res} = ex, layout = v.layout, lv = v.level, base = v.base, {roleOf, portals} = vc;
  const letter = (a: Area, k: number) => { const m = / ([A-Z])$/.exec(a.label ?? ''); return m ? m[1] : String.fromCharCode(65 + k); };
  const letters = new Map(areas.filter(a => roleOf(a.id) === 'panel').map((a, k) => [a.id, letter(a, k)] as const));
  const nameOf = (id: number) => roleOf(id) === 'panel' ? `DEMO THEATRE ${letters.get(id) ?? ''}`.trim() : SIGN_NAMES[roleOf(id)!] ?? '';
  // 0. the WASHROOMS plate over the washrooms' door on the keynote hall's side
  for (const d of layout.doors) {
    const [h, w] = roleOf(d.a) === 'main-hall' && roleOf(d.b) === 'washrooms' ? [d.a, d.b] : roleOf(d.b) === 'main-hall' && roleOf(d.a) === 'washrooms' ? [d.b, d.a] : [-1, -1];
    if (h < 0) continue;
    const hall = layout.areas[h], dp = doorPoint(d, hall);
    const s = plate(v, hall, {x: dp.x, z: dp.z, nx: dp.nx, nz: dp.nz, half: dp.half, to: w, door: d, side: dp.side}, 'WASHROOMS');
    if (s) res.signs.push({sign: s, to: 'WASHROOMS', target: {x: dp.x, z: dp.z}});
  }
  // 1. plates over the event doors, on the side people come from (KEYNOTE HALL, DEMO THEATRE A / B, DEVELOPER LOUNGE)
  for (const a of areas) for (const p of portals.get(a.id) ?? []) {
    const r = roleOf(p.to);
    if (!p.door || !r || (r !== 'main-hall' && r !== 'panel' && r !== 'photo-lounge')) continue;
    const s = plate(v, a, p, r === 'main-hall' ? 'KEYNOTE HALL · WASHROOMS' : nameOf(p.to));
    if (s) res.signs.push({sign: s, to: nameOf(p.to), target: {x: p.x, z: p.z}});
  }
  // ... and the rooms carved off the keynote hall: their plates on the hall's side of the door
  for (const d of layout.doors) {
    const [h, r] = roleOf(d.a) === 'main-hall' ? [d.a, d.b] : roleOf(d.b) === 'main-hall' ? [d.b, d.a] : [-1, -1];
    const rr = r >= 0 ? roleOf(r) : undefined;
    if (h < 0 || (rr !== 'panel' && rr !== 'photo-lounge')) continue;
    const hall = layout.areas[h], dp = doorPoint(d, hall);
    const s = plate(v, hall, {x: dp.x, z: dp.z, nx: dp.nx, nz: dp.nz, half: dp.half, to: r, door: d, side: dp.side}, nameOf(r));
    if (s) res.signs.push({sign: s, to: nameOf(r), target: {x: dp.x, z: dp.z}});
  }
  // 2. hanging direction signs where people come in: in each registration corridor (facing the bridge mouth) and at each expo floor
  //    piece's way in from registration — one plate per arrow, the arrow along the route (the next opening toward each target)
  const hallId = layout.skyways!.addon.venue!.find(q => q.role === 'main-hall')?.area;
  const route = routeTable(hallId !== undefined && !portals.has(hallId) ? new Map([...portals, [hallId, portalsOf(layout, v.g, layout.areas[hallId])]]) : portals);
  const targets: {name: string; area: number}[] = [];
  for (const a of areas) for (const p of portals.get(a.id) ?? []) if (roleOf(p.to) === 'main-hall') targets.push({name: 'KEYNOTE HALL · WASHROOMS', area: p.to});
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
    const want = role === 'registration' ? [{name: 'EXPO FLOOR · KEYNOTE · DEMO THEATRES', area: -1}] : uniq;
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
      const tx = -from.nz, tz = from.nx, off = (k++ - (groups.size - 1) / 2) * 2.0;
      const x = signAt[0] + tx * off, z = signAt[1] + tz * off;
      const text = [...new Set(gr.names.flatMap(n => n.split(' · ')))].join(' · ');
      const w = Math.min(3.2, Math.max(VENUE_SIGN.w, text.length * 0.085 + 0.5));
      const [cx, cy] = v.g.cellOf(x, z);
      if (!v.g.inBounds(cx, cy) || v.g.area[v.g.idx(cx, cy)] !== a.id) continue;
      const sign: SignPlacement = {x: r3(x), y: r3(base + VENUE_SIGN.y), z: r3(z), rot: r3(normYaw(Math.atan2(from.nx, from.nz) + Math.PI)), kind: 'info', text, area: a.id,
        arrow: arrow as SignPlacement['arrow'], hang: true, w: r3(w), level: lv, style: EXPO_SIGN_STYLE};
      layout.signs.push(sign);
      res.signs.push({sign, to: text, target: {x: gr.at.x, z: gr.at.z}});
    }
  }
}
let WHY = '';
const DBG = (s: string) => { (globalThis as {__expoDbg?: string[]}).__expoDbg?.push(s); };
