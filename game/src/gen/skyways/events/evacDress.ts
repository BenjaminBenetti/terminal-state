// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE's dresser — the convention's venue carve
// (layout.skyways.addon.venue by role, relabelled by gen/skyways/events/eventVenue.ts) dressed as a whole-floor improvised shelter (user:
// "reuse cots/beds, medical/storage props, desks and partitions for a whole-floor improvised shelter with registration, sleeping areas,
// ration/medical sections and barricaded/abandoned spaces. Scatter short, readable discoverable notes that tell the outbreak story:
// ventilation has failed; people are becoming zombies; the main reactor is overrun. Environmental storytelling, not a new quest/ending/
// intel unlock or a gigantic loot jackpot."):
//  - REGISTRATION (the corridors in from the bridges, or the next area along the way in): intake desks (the convention's cloth-draped
//    tables) with staff chairs behind them and crowd barriers forming queue lanes, an "EVACUEE REGISTRATION" plate over them, the
//    shelter's NOTICE BOARD with notes pinned to it;
//  - the DORMITORY (the main hall): a clear central aisle from every door, blocks of camp cots (evacKinds.ts evacCot) in head-to-head row
//    pairs either side of it with cross aisles between the blocks, privacy screens round a few blocks, bedrolls of the overflow along the
//    walls, a few DISTURBED blocks (cots missing, turned, a bedroll left on the floor, trash bags), suitcases / boxes of belongings; the
//    carve's stage box at the back wall = the SUPPLY DROP (sealed carton pallets, a water cooler, a tote) — or the quarantine corner;
//  - the SHELTER COMMONS (the host's skyway court): the RATION line (tables, the stock behind them: crates of food / water, cartons, a
//    tote, a water cooler; a few rations on the tables as ordinary pickups), a MEDICAL TRIAGE corner (stretchers, a screen, an IV pole, a
//    wheelchair), a waiting row of chairs;
//  - the MEDICAL BAY (panel room A): beds head to the side walls with IV poles / screens between them, medical cabinets and a crash cart
//    on the back wall, the medic's desk;
//  - the QUARANTINE (panel room B, else the lounge, else a cordoned corner of the dormitory): BARRICADED — barriers / cartons / a cot
//    across the room with one squeeze gap (its far side stays reachable: a 1.2 m path), abandoned cots and stretchers behind it, an
//    "ISOLATION · NO ENTRY" plate and a hand-painted plywood warning (evacWarnBoard) outside the door;
//  - the FAMILY ROOM (the lounge, when it is not the quarantine): floor bedrolls, a cot, bean bags, a stroller, a toy plush;
//  - the shelter office / supply store (backstage / storage) keep the station's ordinary dressing (a note on the office table);
//  - NOTES (evacKinds.ts evacNote; texts gen/skyways/events/evacNotes.ts): 6-10 per shelter on desk / table tops, bedrolls, the floor
//    and the notice board, at least one per theme (ventilation, infection, the reactor). Read up close (world/skywaysNotes.ts).
// Circulation (the venue's rules, gen/skyways/venueDress.ts): every group is kept only if each opening its areas reached before is still
// reached by a 1.2 m path from the bridge mouths; the routes then become lanes. Loot: the holders are ordinary (crates themed by the
// stock room's rows, the first-aid room's cabinets, the crash cart / stretchers' own medical rows, a few totes / boxes) and the ration
// pickups few — no jackpot. Pure data; the rng is consumed only here (gen/skyways/addon.ts hands it its own fork).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, backed, mountProp, rowAlongWall, wallRange, wallXZ} from '../../placeKit';
import type {Area, Side, SignPlacement, StationLayout} from '../../stationTypes';
import {itemDims} from '../../../items/items';
import {PANTRY_ROWS} from '../../../items/lootTables';
import {normYaw, r3, toWorld, uvXZ, xzUV, type HallFrame} from '../addonFrame';
import {SKYWAYS_MERCH_TOP} from '../addonKinds';
import {VENUE_SIGN, bandCells, doorPlate, entryAreas, eventVenueContext, frameOf, group, markRoutes, markWalkRoutes, routeCell, type Portal, type VenueCtx} from '../venueDress';
import type {EventDressResult} from './eventResult';
import {EVAC_COT, EVAC_NOTE, EVAC_SCREEN, EVAC_WARN, EVAC_WARN_TEXTS, evacNoteVariant} from './evacKinds';
import {EVAC_NOTES, EVAC_NOTE_COUNT, EVAC_NOTE_THEMES, type EvacNoteSlot} from './evacNotes';
import type {SkywaysEvacNote, SkywaysEvacRecord, SkywaysEvacSectionRole} from './evacTypes';

/** The shelter's plates / hung signs (civil-emergency blue, white letters, a safety-yellow accent). */
export const EVAC_SIGN_STYLE = {bg: 0x1f4e79, fg: 0xf4f7fa, accent: 0xf2b705, font: 'sans'} as const;
/** The isolation plate (red, white letters). */
export const EVAC_ALERT_STYLE = {bg: 0xb3121b, fg: 0xffffff, accent: 0x1d1d1f, font: 'condensed'} as const;
/** The dormitory: the central aisle's half width, the cot pitch along a row, cots per block, the cross aisle, the foot aisle between
 *  row pairs (m; the pairs lie head to head on whole cells, 0.1 m apart), the most cots. */
export const EVAC_DORM = {spine: 0.9, pitch: 1.2, block: 5, cross: 1.6, feet: 1.4, maxCots: 72} as const;
/** The quarantine barricade's squeeze gap (m, on whole cells: a 1.2 m path still passes). */
export const EVAC_GAP = 1.5;
/** Ration pickups on the ration line (inclusive). */
export const EVAC_RATIONS = [2, 4] as const;
/** The ration crates' / medical holders' loot themes (gen/purposes.ts: the stock room's crate rows, the first-aid room's cabinet rows). */
export const EVAC_PURPOSE = {rations: 'stock-room', medical: 'first-aid-room'} as const;

const SIDES: Side[] = ['N', 'S', 'W', 'E'];
const MERCH = PROP_DEFS.skywaysConMerchTable;
const inside = (p: Portal, d: number): [number, number] => [p.x + p.nx * d, p.z + p.nz * d];
const sideLen = (a: Area, s: Side) => (s === 'N' || s === 'S' ? a.w : a.h) * CELL;
const snapC = (x: number) => Math.floor(x / CELL) * CELL + CELL / 2;
const flanks = (fr: HallFrame): Side[] => (fr.front === 'N' || fr.front === 'S' ? ['W', 'E'] : ['N', 'S']);
const minSide = (a: Area) => Math.min(a.w, a.h) * CELL;
interface Rect { x0: number; z0: number; x1: number; z1: number }

/** A spot a note may lie on (filled at the end: 6-10 of them get a note). */
interface NoteSite {
  slot: EvacNoteSlot;
  on: SkywaysEvacNote['on'];
  /** On a host (its local x / z and support height above its base), or on the floor of `area` at (x, z), or pinned to a board. */
  host?: PropPlacement; lx?: number; lz?: number; top?: number;
  area?: Area; x?: number; z?: number;
  rot: number;
  /** A host already placed by the station dresser (absolute y): placed after the lift. */
  late?: boolean;
}

interface Shelter {
  layout: StationLayout;
  vc: VenueCtx;
  rng: Rng;
  rec: SkywaysEvacRecord;
  sites: NoteSite[];
  /** Tables of the ration line (their rations are placed after the lift). */
  rationTables: PropPlacement[];
  /** Rects of the dormitory hall the cot field leaves alone (the quarantine corner / the supply drop). */
  exclude: Rect[];
  boards: PropPlacement[];
  roleOf: (id: number) => string | undefined;
}

const RESULTS = new WeakMap<StationLayout, {pickups: number[]; sites: Partial<Record<EvacNoteSlot, number>>}>();
/** QA / tests: the layout.pickups indices of the shelter's ration pickups. */
export const evacPickupsOf = (layout: StationLayout): readonly number[] => RESULTS.get(layout)?.pickups ?? [];
/** QA: how many note spots each kind of place offered (before 6-10 of them got a note). */
export const evacNoteSitesOf = (layout: StationLayout): Partial<Record<EvacNoteSlot, number>> => RESULTS.get(layout)?.sites ?? {};

export function dressEvacCentre(layout: StationLayout, rng: Rng): EventDressResult {
  const res: EventDressResult = {props: [], skipped: [], byArea: {}};
  const addon = layout.skyways?.addon;
  const venue = addon?.venue;
  if (!addon || !venue?.length) { res.skipped.push('no venue'); return res; }
  const vc = eventVenueContext(layout, rng, ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge']);
  if (!vc) { res.skipped.push('no venue context'); return res; }
  const v = vc.v, p0 = layout.props.length;
  const areasOf = (r: string) => venue.filter(q => q.role === r).map(q => layout.areas[q.area]).filter(Boolean);
  const hall = areasOf('main-hall')[0], regs = areasOf('registration'), panels = areasOf('panel'), lounge = areasOf('photo-lounge')[0];
  const pieces = areasOf('exhibitors').sort((p, q) => q.w * q.h - p.w * p.h);
  const building = /· (.*)$/.exec(pieces[0]?.label ?? regs[0]?.label ?? '')?.[1] ?? 'Civic';
  const rec: SkywaysEvacRecord = {name: `${building} ${rng.pick(['Emergency Shelter', 'Evacuation Centre', 'Reception Centre'])}`, sections: [], notes: [], quarantine: null, dorm: null};
  const S: Shelter = {layout, vc, rng, rec, sites: [], rationTables: [], exclude: [], boards: [], roleOf: id => venue.find(q => q.area === id)?.role};
  const section = (role: SkywaysEvacSectionRole, a: Area | undefined) => { if (a && !rec.sections.some(s => s.role === role && s.area === a.id)) rec.sections.push({role, area: a.id}); };

  // --- 0. the dormitory's aisles are reserved before anything else stands in the hall ------------------------------------------------
  if (hall) dormAisles(S, hall);
  // --- 1. the barricaded quarantine first (its barricade line and squeeze gap need the room's whole width) ------------------------------
  const qRoom = panels[1] ?? lounge ?? null;
  if (qRoom && quarantineRoom(S, qRoom)) {
    if (qRoom === lounge) qRoom.label = 'Quarantine room';
    section('barricaded', qRoom);
  } else if (hall && quarantineCorner(S, hall)) section('barricaded', hall);
  else res.skipped.push('evac: quarantine');
  // --- 2. registration: intake desks, queue barriers, the plate --------------------------------------------------------------------------
  for (const a of regs) {
    const mouth = vc.portals.get(a.id)!.find(p => vc.bridges.has(p.to)) ?? null;
    if (!mouth && a.kind === 'concourse' && a.type === 'concourse') continue; // (the main hall's foyer: a board at most)
    const at = intakeDesks(S, a);
    if (at) { section('registration', at); section('registration', a); } else res.skipped.push(`evac: registration ${a.id} desks`);
  }
  // --- 3. the medical bay (panel room A) ----------------------------------------------------------------------------------------------
  if (panels[0] && medicalBay(S, panels[0])) section('medical', panels[0]); else res.skipped.push('evac: medical bay');
  // --- 4. the family room (the lounge, unless it became the quarantine) ---------------------------------------------------------------
  if (lounge && lounge !== qRoom && familyRoom(S, lounge)) section('family', lounge);
  // --- 5. the commons: the ration line, the triage corner, the waiting row ------------------------------------------------------------
  const roomy = pieces.filter(a => minSide(a) >= 5.0);
  let rations: Area | null = null;
  for (const a of [...roomy, ...(hall ? [hall] : [])]) if (rationLine(S, a)) { rations = a; break; }
  if (rations) section('rations', rations); else res.skipped.push('evac: ration line');
  const triageAt = [...roomy, ...pieces.filter(a => minSide(a) >= 3.0 && !roomy.includes(a))];
  let triaged = false;
  for (const a of triageAt) if (triage(S, a)) { section('medical', a); triaged = true; break; }
  if (!triaged) res.skipped.push('evac: triage');
  for (const a of pieces.filter(q => minSide(q) >= 3.0 && q !== rations)) { waitingRow(S, a); break; }
  // the overflow: a block of cots in what floor of the big commons pieces is left
  for (const a of pieces.filter(q => minSide(q) >= 6.0)) if (overflowCots(S, a)) section('sleeping', a);
  // --- 6. the dormitory: the aisles, the supply drop, the cot blocks, the overflow bedrolls --------------------------------------------
  if (hall) {
    if (dormitory(S, hall)) section('sleeping', hall); else res.skipped.push('evac: dormitory');
    if (S.exclude.length && rec.quarantine?.corner === null) { /* the stage box is the supply drop (placed in dormitory) */ }
  }
  for (const id of venue.filter(q => q.role === 'backstage').map(q => q.area)) section('office', layout.areas[id]);
  for (const id of venue.filter(q => q.role === 'storage').map(q => q.area)) section('supplies', layout.areas[id]);
  // the big furniture's routes become lanes (the small pieces below keep off them)
  for (const a of vc.walk.pub) markRoutes(vc, a);
  markWalkRoutes(vc);
  // --- 7. the notice board (pinned notes), belongings, the office table's note ---------------------------------------------------------
  noticeBoard(S, [...regs, ...pieces, ...(hall ? [hall] : [])]);
  officeSites(S, venue.filter(q => q.role === 'backstage').map(q => layout.areas[q.area]));
  // --- 8. wayfinding plates ------------------------------------------------------------------------------------------------------------
  plates(S);
  // --- 9. the notes, then lift; the rations and the late notes on absolute hosts --------------------------------------------------------
  const chosen = chooseNotes(S);
  const placed: {site: NoteSite; text: number; p: PropPlacement}[] = [];
  for (const [site, text] of chosen) if (!site.late) { const p = placeNote(S, site, text); if (p) placed.push({site, text, p}); }
  v.lift();
  for (const [site, text] of chosen) if (site.late) { const p = placeNote(S, site, text); if (p) placed.push({site, text, p}); }
  for (const {site, text, p} of placed) {
    rec.notes.push({id: EVAC_NOTES[text].id, text, x: p.x, y: p.y, z: p.z, area: p.host !== undefined ? layout.props[p.host].area : p.area, on: site.on, prop: layout.props.indexOf(p)});
  }
  const pickups = placeRations(S);
  const sites: Partial<Record<EvacNoteSlot, number>> = {};
  for (const s of S.sites) sites[s.slot] = (sites[s.slot] ?? 0) + 1;
  RESULTS.set(layout, {pickups, sites});
  addon.evac = rec;

  res.props = layout.props.slice(p0);
  for (const p of res.props) { const id = p.host !== undefined ? layout.props[p.host].area : p.area; (res.byArea[id] ??= []).push(p); }
  res.skipped.push(...v.skipped);
  if (rec.notes.length < EVAC_NOTE_COUNT[0]) res.skipped.push(`evac: ${rec.notes.length} notes`);
  return res;
}

// ---------------------------------------------------------------------------------------------
// Registration

/** The intake desks along the way in from a registration corridor (the corridor, else the next area on): returns the area they went in. */
function intakeDesks(S: Shelter, reg: Area): Area | null {
  for (const {area: a, at: mouth} of entryAreas(S.vc, reg)) if (deskRow(S, a, mouth)) return a;
  return null;
}

function deskRow(S: Shelter, a: Area, mouth: Portal | null): boolean {
  const {vc} = S, v = vc.v;
  const sides = SIDES.filter(s => !mouth || s !== mouth.side).sort((p, q) => sideLen(a, q) - sideLen(a, p));
  const off = 1.0 + MERCH.d / 2; // (a whole 1 m behind the desks: two cells for the clerks' chairs)
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    const most = Math.min(2, Math.floor((hi - lo - 1.2) / (MERCH.w + 0.05)));
    for (let want = most; want >= 1; want--) {
      const span = want * (MERCH.w + 0.05) - 0.05, mid = (lo + hi) / 2, starts: number[] = [];
      for (let t0 = Math.ceil((lo + 0.6) * 2) / 2; t0 + span <= hi - 0.6; t0 += 0.5) starts.push(t0);
      starts.sort((p, q) => Math.abs(p + span / 2 - mid) - Math.abs(q + span / 2 - mid));
      for (const t0 of starts) {
        if (!backed(v.ctx, a, side, t0, t0 + span, v.base + 1.0)) continue;
        const row = group(vc, [a], () => {
          const out: PropPlacement[] = [];
          for (let k = 0; k < want; k++) {
            const [x, z] = wallXZ(a, side, t0 + MERCH.w / 2 + k * (MERCH.w + 0.05), off);
            const p = v.put('skywaysConMerchTable', x, z, WALL_ROT[side], {area: a, front: 1.2});
            if (!p) return null;
            out.push(p);
          }
          return out;
        });
        if (!row) continue;
        for (const t of row) {
          // the clerk's chair behind the desk (facing it, like the venue's badge desks); a note on the desk top
          const [cx, cz] = toWorld(t, S.rng.range(-0.35, 0.35), -(MERCH.d / 2 + 0.5));
          group(vc, [a], () => v.put('foldingChair', cx, cz, t.rot, {area: a}));
          S.sites.push({slot: 'desk', on: 'table', host: t, lx: S.rng.pick([-0.55, 0.55]), lz: -0.12, top: SKYWAYS_MERCH_TOP.y, rot: t.rot});
        }
        // the queue rails (crowd barriers) out from the row's two ends toward the arrivals
        for (const [t, sgn] of [[row[0], -1], [row[row.length - 1], 1]] as const) {
          for (const gap of [0.3, 0.55, 0.8]) {
            const [bx, bz] = toWorld(t, sgn * (MERCH.w / 2 + gap + PROP_DEFS.crowdBarrier.d / 2), MERCH.d / 2 + 0.3 + PROP_DEFS.crowdBarrier.w / 2);
            if (group(vc, [a], () => v.put('crowdBarrier', bx, bz, normYaw(t.rot + Math.PI / 2), {area: a}))) break;
          }
        }
        // the registration plate hung over the desks, facing the queue
        const c0 = row[0], c1 = row[row.length - 1], fx = Math.sin(c0.rot), fz = Math.cos(c0.rot);
        if (a.ceil - v.base >= VENUE_SIGN.y + 0.6) {
          const sign: SignPlacement = {x: r3((c0.x + c1.x) / 2 + fx * 0.2), y: r3(v.base + VENUE_SIGN.y + 0.15), z: r3((c0.z + c1.z) / 2 + fz * 0.2), rot: r3(c0.rot), kind: 'info',
            text: 'EVACUEE REGISTRATION · ALL ARRIVALS CHECK IN', area: a.id, hang: true, w: 3.2, level: v.level, style: EVAC_SIGN_STYLE};
          v.layout.signs.push(sign);
        }
        return true;
      }
    }
  }
  return false;
}

/** The shelter's notice board on a solid wall (registration first), three pinned-note spots on it. */
function noticeBoard(S: Shelter, areas: readonly Area[]): void {
  const {vc} = S, v = vc.v, def = PROP_DEFS.noticeBoard;
  for (const a of areas) {
    for (const side of S.rng.shuffle(SIDES.slice())) {
      const [lo, hi] = wallRange(a, side);
      for (let t = lo + 1.0; t <= hi - 1.0; t += 0.5) {
        if (!backed(v.ctx, a, side, t - def.w / 2, t + def.w / 2, v.base + 1.15) || !backed(v.ctx, a, side, t - def.w / 2, t + def.w / 2, v.base + 1.95)) continue;
        if (v.layout.signs.some(s => (s.level ?? 0) === v.level && Math.hypot(s.x - wallXZ(a, side, t, 0)[0], s.z - wallXZ(a, side, t, 0)[1]) < 1.6)) continue;
        // open floor in front of it (the notes are read standing there): nothing standing 0.25-1.25 m out across its width
        const g = v.g;
        const open = [0.4, 0.8, 1.2].every(d => [-0.45, 0, 0.45].every(o => {
          const [cx, cy] = g.cellOf(...wallXZ(a, side, t + o, d));
          if (!g.inBounds(cx, cy)) return false;
          const i = g.idx(cx, cy);
          return g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i];
        }));
        if (!open) continue;
        const b = group(vc, [a], () => mountProp(v.ctx, a, side, t, 'noticeBoard', 1.1, v.base));
        if (!b) continue;
        v.placed.push(b);
        S.boards.push(b);
        for (const lx of [-0.36, 0, 0.36]) S.sites.push({slot: 'board', on: 'board', host: b, lx, lz: def.d / 2, top: r3(0.28 + S.rng.range(0, 0.25)), rot: b.rot});
        return;
      }
    }
  }
  S.vc.v.skipped.push('evac: notice board');
}

// ---------------------------------------------------------------------------------------------
// Medical bay, triage

function medicalBay(S: Shelter, a: Area): boolean {
  const {vc, rng} = S, v = vc.v, ps = vc.portals.get(a.id)!;
  const door = ps.find(p => p.door) ?? ps[0] ?? null;
  const fr = frameOf(a, door);
  const du = door ? xzUV(fr, door.x, door.z)[0] : fr.W / 2;
  { const A = uvXZ(fr, du, 0.9), B = uvXZ(fr, du, Math.max(1.0, fr.D - 1.6)); v.keepSegment(A[0], A[1], B[0], B[1], 0.65); }
  let beds = 0;
  // the back wall: the medical cabinets (the first-aid room's stock) and the crash cart
  const cabs = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, fr.back, 'medCabinet', {max: 2, front: 0.9, cluster: 2, gap: 0.6}); return r.length ? r : null; }) ?? [];
  for (const c of cabs) { c.purpose = EVAC_PURPOSE.medical; v.placed.push(c); }
  for (const side of [fr.back, ...flanks(fr)]) if (group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'crashCart', {max: 1, front: 0.8}); return r.length ? r : null; })) break;
  // the beds: head to the side walls, an IV pole or a screen between neighbours
  for (const side of flanks(fr)) {
    const [lo, hi] = wallRange(a, side);
    let k = 0;
    for (let t = lo + 0.75; t + 0.4 <= hi - 0.4; t += 1.5) {
      const kind: PropKind = k % 3 === 2 ? 'wheeledStretcher' : 'evacCot';
      const d = PROP_DEFS[kind].d, [x, z] = wallXZ(a, side, t, 0.08 + d / 2);
      const bed = group(vc, [a], () => v.put(kind, x, z, WALL_ROT[side], {area: a, variant: kind === 'evacCot' ? rng.pick([1, 2]) : 0}));
      if (!bed) continue;
      beds++; k++;
      if (k % 2 === 1) { const [ix, iz] = wallXZ(a, side, t + 0.75, 0.35); group(vc, [a], () => v.put('ivPole', ix, iz, WALL_ROT[side], {area: a})); }
      else { const [sx, sz] = wallXZ(a, side, t + 0.75, 0.12 + EVAC_SCREEN.w / 2); group(vc, [a], () => v.put('evacScreen', sx, sz, normYaw(WALL_ROT[side] + Math.PI / 2), {area: a})); }
    }
  }
  // the medic's desk (the door wall, else a side wall) with its chair; the medic's log on it
  for (const side of [fr.front, ...flanks(fr), fr.back]) {
    const desk = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'desk', {max: 1, front: 1.0}); return r[0] ?? null; });
    if (!desk) continue;
    desk.purpose = EVAC_PURPOSE.medical;
    v.placed.push(desk);
    const fx = Math.sin(desk.rot), fz = Math.cos(desk.rot);
    group(vc, [a], () => v.put('foldingChair', snapC(desk.x + fx * (PROP_DEFS.desk.d / 2 + 0.35)), snapC(desk.z + fz * (PROP_DEFS.desk.d / 2 + 0.35)), normYaw(desk.rot + Math.PI), {area: a}));
    S.sites.push({slot: 'medical', on: 'desk', host: desk, lx: rng.pick([-0.4, 0.35]), lz: 0.06, top: PROP_DEFS.desk.h, rot: desk.rot});
    break;
  }
  // a vitals monitor and a wheelchair in what floor is left
  for (const kind of ['vitalsMonitor', 'wheelchair'] as PropKind[]) {
    for (let tr = 0; tr < 24; tr++) {
      const [x, z] = uvXZ(fr, rng.range(0.8, fr.W - 0.8), rng.range(1.8, Math.max(1.9, fr.D - 0.8)));
      if (group(vc, [a], () => v.put(kind, snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: a}))) break;
    }
  }
  // a dropped note on the floor
  floorSite(S, a, 'medical');
  return beds >= 2;
}

/** The commons' triage corner: stretchers head to a wall with a screen / IV pole beside them, a wheelchair. */
function triage(S: Shelter, a: Area): boolean {
  const {vc, rng} = S, v = vc.v;
  for (const side of rng.shuffle(SIDES.slice())) {
    // (its own corner: no stretcher within 3 m of the ration line)
    const got = group(vc, [a], () => {
      const r = rowAlongWall(v.ctx, a, side, 'wheeledStretcher', {max: 2, cluster: 1, gap: 1.0, front: 1.0});
      return r.length >= 2 && !r.some(s => S.rationTables.some(t => Math.hypot(t.x - s.x, t.z - s.z) < 3.0 + MERCH.w / 2)) ? r : null;
    });
    if (!got) continue;
    for (const s of got) {
      const ux = Math.cos(s.rot), uz = -Math.sin(s.rot); // along the wall
      const [x, z] = [s.x + ux * (PROP_DEFS.wheeledStretcher.w / 2 + 0.35), s.z + uz * (PROP_DEFS.wheeledStretcher.w / 2 + 0.35)];
      if (!group(vc, [a], () => v.put('evacScreen', x, z, normYaw(s.rot + Math.PI / 2), {area: a}))) {
        const [ix, iz] = toWorld(s, -(PROP_DEFS.wheeledStretcher.w / 2 + 0.35), -0.5);
        group(vc, [a], () => v.put('ivPole', ix, iz, s.rot, {area: a}));
      }
    }
    for (let tr = 0; tr < 20; tr++) {
      const s = got[0], [x, z] = toWorld(s, rng.range(-2.5, 2.5), PROP_DEFS.wheeledStretcher.d / 2 + rng.range(1.2, 2.4));
      if (group(vc, [a], () => v.put('wheelchair', snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: a}))) break;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Rations, waiting row

/** The ration line: 1-2 cloth tables 1.5 m off a solid wall, the stock between them and the wall, a water cooler at its end, its plate. */
function rationLine(S: Shelter, a: Area): boolean {
  const {vc, rng} = S, v = vc.v;
  const off = 1.45 + MERCH.d / 2;
  const sides = SIDES.slice().sort((p, q) => sideLen(a, q) - sideLen(a, p));
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    for (let want = 2; want >= 1; want--) {
      const span = want * (MERCH.w + 0.05) - 0.05, mid = (lo + hi) / 2, starts: number[] = [];
      for (let t0 = Math.ceil((lo + 1.0) * 2) / 2; t0 + span <= hi - 1.0; t0 += 0.5) starts.push(t0);
      starts.sort((p, q) => Math.abs(p + span / 2 - mid) - Math.abs(q + span / 2 - mid));
      for (const t0 of starts.slice(0, 8)) {
        if (!backed(v.ctx, a, side, t0 - 0.6, t0 + span + 0.6, v.base + 1.0)) continue;
        const row = group(vc, [a], () => {
          const out: PropPlacement[] = [];
          for (let k = 0; k < want; k++) {
            const [x, z] = wallXZ(a, side, t0 + MERCH.w / 2 + k * (MERCH.w + 0.05), off);
            const p = v.put('skywaysConMerchTable', x, z, normYaw(WALL_ROT[side]), {area: a, front: 1.4});
            if (!p) return null;
            out.push(p);
          }
          return out;
        });
        if (!row) continue;
        S.rationTables.push(...row);
        // the stock against the wall behind the tables: crates of food / water (the stock room's rows), a carton pallet, a tote
        const stock: PropKind[] = rng.shuffle(['crate', 'crate', 'cartonStack', 'storageTote'] as PropKind[]).slice(0, want === 2 ? 4 : 3);
        let t = t0 + 0.1;
        for (const kind of stock) {
          const def = PROP_DEFS[kind];
          if (t + def.w > t0 + span) break;
          const [x, z] = wallXZ(a, side, t + def.w / 2, 0.06 + def.d / 2);
          const p = group(vc, [a], () => v.put(kind, x, z, WALL_ROT[side], {area: a}));
          if (p) { if (kind === 'crate') p.purpose = EVAC_PURPOSE.rations; t += def.w + 0.2; } else t += 0.5;
        }
        // the water cooler at the line's end (against the wall)
        for (const tt of [t0 + span + 0.55, t0 - 0.55]) {
          const [x, z] = wallXZ(a, side, tt, 0.06 + PROP_DEFS.waterCooler.d / 2);
          if (group(vc, [a], () => v.put('waterCooler', x, z, WALL_ROT[side], {area: a, front: 0.6}))) break;
        }
        // its plate, hung over the tables (facing the queue); a ration memo on a table
        const c0 = row[0], c1 = row[row.length - 1], fx = Math.sin(c0.rot), fz = Math.cos(c0.rot);
        if (a.ceil - v.base >= VENUE_SIGN.y + 0.6) {
          v.layout.signs.push({x: r3((c0.x + c1.x) / 2 + fx * 0.2), y: r3(v.base + VENUE_SIGN.y + 0.15), z: r3((c0.z + c1.z) / 2 + fz * 0.2), rot: r3(c0.rot), kind: 'info',
            text: 'RATIONS · WATER · ONE PER PERSON', area: a.id, hang: true, w: 2.8, level: v.level, style: EVAC_SIGN_STYLE});
        }
        S.sites.push({slot: 'rations', on: 'table', host: c0, lx: -0.7, lz: -0.2, top: SKYWAYS_MERCH_TOP.y, rot: c0.rot});
        return true;
      }
    }
  }
  return false;
}

/** A waiting row of chairs along a wall of a commons piece, a bin and a trash bag pile. */
function waitingRow(S: Shelter, a: Area): void {
  const {vc, rng} = S, v = vc.v;
  for (const side of rng.shuffle(SIDES.slice())) {
    const got = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, rng.chance(0.5) ? 'foldingChair' : 'plasticStackChair', {max: rng.int(3, 5), front: 0.7}); return r.length >= 3 ? r : null; });
    if (got) break;
  }
  for (const kind of ['bin', 'trashBagPile'] as PropKind[]) for (const side of rng.shuffle(SIDES.slice())) if (group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, kind, {max: 1, front: 0.5}); return r.length ? r : null; })) break;
}

// ---------------------------------------------------------------------------------------------
// Quarantine

/** Is any cell of `a` beyond the barricade (frame depth >= vMin) reached from the door band by a 1.2 m path? */
function interiorReached(S: Shelter, a: Area, door: Portal, beyond: (x: number, z: number) => boolean): boolean {
  const g = S.vc.v.g, seen = new Uint8Array(g.w * g.h), q: number[] = [];
  for (const i of bandCells(g, a, door)) if (routeCell(g, a, i)) { seen[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (beyond((i % g.w + 0.5) * CELL, (Math.floor(i / g.w) + 0.5) * CELL)) return true;
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (!seen[j] && routeCell(g, a, j)) { seen[j] = 1; q.push(j); }
  }
  return false;
}
/** Cells of `a` a player (0.3 m radius) reaches from an opening's band (the notes behind a barricade lie only there). */
function reachIn(S: Shelter, a: Area, door: Portal): Uint8Array {
  const g = S.vc.v.g, seen = new Uint8Array(g.w * g.h), q: number[] = [];
  for (const i of bandCells(g, a, door)) if (routeCell(g, a, i, 0.3)) { seen[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (!seen[j] && routeCell(g, a, j, 0.3)) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
const reachedAt = (S: Shelter, seen: Uint8Array) => (x: number, z: number): boolean => {
  const g = S.vc.v.g, [cx, cy] = g.cellOf(x, z);
  return g.inBounds(cx, cy) && !!seen[g.idx(cx, cy)];
};

/**
 * The squeeze gap of a barricade line whose u runs from world `lo` (along x or z), centred near `mid` (u): [u0, u1] on whole cells, so
 * the pieces either side claim no cell of it (EVAC_GAP = three free cells: a 1.2 m body passes).
 */
function gapCells(lo: number, mid: number): [number, number] {
  const a = Math.round((lo + mid - EVAC_GAP / 2) / CELL) * CELL;
  return [a - lo, a - lo + EVAC_GAP];
}

/** Barricade pieces along a line (u0 -> u1 in a frame at depth vv) as long as they fit: crowd barriers, folding barricades, cartons, a cot. */
function barricadeRun(S: Shelter, a: Area, fr: HallFrame, u0: number, u1: number, vv: number, out: PropPlacement[]): void {
  const {rng} = S, v = S.vc.v;
  let u = u0;
  while (u < u1 - 0.45) {
    const rem = u1 - u;
    // the long pieces first (a random one of those that fit), then the shorter ones, a trash bag pile / a chair to close the end
    const long: PropKind[] = rem >= 2.05 ? ['crowdBarrier', 'foldingBarricade', 'evacCot', 'cartonStack'] : rem >= 1.95 ? ['foldingBarricade', 'evacCot', 'cartonStack'] : rem >= 1.25 ? ['foldingBarricade', 'cartonStack'] : rem >= 1.05 ? ['cartonStack'] : [];
    const tries: PropKind[] = [...rng.shuffle(long.slice()), ...(rem >= 1.05 ? ['trashBagPile' as PropKind] : []), 'foldingChair'];
    let placed = false;
    for (const kind of tries) {
      const cot = kind === 'evacCot', len = cot ? EVAC_COT.d : PROP_DEFS[kind].w;
      if (len > rem + 0.02) continue;
      const [x, z] = uvXZ(fr, u + len / 2, vv);
      const p = v.put(kind, x, z, cot ? normYaw(fr.plusU) : fr.toFront, {area: a, variant: cot ? 2 : 0});
      if (p) { out.push(p); u += len + 0.04; placed = true; break; }
    }
    if (!placed) u += 0.25;
  }
}

/** A quarantine ROOM (panel room B / the lounge): the barricade across it with one squeeze gap, abandoned beds behind it, the warnings. */
function quarantineRoom(S: Shelter, a: Area): boolean {
  const {vc, rng} = S, v = vc.v, ps = vc.portals.get(a.id)!;
  const door = ps.find(p => p.door) ?? null;
  if (!door) return false;
  const fr = frameOf(a, door);
  const du = xzUV(fr, door.x, door.z)[0];
  if (fr.W < 3.2 || fr.D < 4.0) return false;
  let line: {vv: number; gap: number; items: PropPlacement[]} | null = null;
  for (const vv of [2.2, 2.7, 1.9]) {
    if (vv > fr.D - 1.6) continue;
    // the gap away from the door's axis (a squeeze, not a straight walk-in): the far side of the room from the door first
    const gaps = [du < fr.W / 2 ? fr.W - 0.25 - EVAC_GAP / 2 : 0.25 + EVAC_GAP / 2, du < fr.W / 2 ? 0.25 + EVAC_GAP / 2 : fr.W - 0.25 - EVAC_GAP / 2, fr.W / 2];
    const uLo = fr.front === 'N' || fr.front === 'S' ? fr.x0 : fr.z0; // (the frame's u is world x / z from the area's edge)
    for (const gm of gaps) {
      const [g0, g1] = gapCells(uLo, gm);
      const items = group(vc, [a], () => {
        const out: PropPlacement[] = [];
        barricadeRun(S, a, fr, 0.1, g0, vv, out);
        barricadeRun(S, a, fr, g1, fr.W - 0.1, vv, out);
        if (out.length < 2) return null;
        return interiorReached(S, a, door, (x, z) => xzUV(fr, x, z)[1] > vv + 1.0) ? out : null;
      });
      if (items) { line = {vv, gap: (g0 + g1) / 2, items}; break; }
    }
    if (line) break;
  }
  if (!line) return false;
  const beyond = (x: number, z: number) => xzUV(fr, x, z)[1] > line!.vv + 1.0;
  // behind it: abandoned beds and stretchers, a knocked chair, trash bags (each kept only if the far side stays reachable)
  const want = rng.int(3, 5);
  let n = 0;
  for (let tr = 0; tr < 40 && n < want; tr++) {
    const kind: PropKind = rng.weighted([['evacCot', 3], ['wheeledStretcher', 1], ['foldingChair', 1], ['trashBagPile', 1], ['bin', 0.5]] as [PropKind, number][]);
    const [x, z] = uvXZ(fr, rng.range(0.6, fr.W - 0.6), rng.range(line.vv + 1.2, fr.D - 0.6));
    const p = group(vc, [a], () => { const q = v.put(kind, snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: a, variant: kind === 'evacCot' ? rng.pick([0, 2]) : 0}); return q && interiorReached(S, a, door, beyond) ? q : null; });
    if (p) n++;
  }
  const [gx, gz] = uvXZ(fr, line.gap, line.vv);
  // note spots: a cell clear of the line's far face (half a lying cot + half a cell), not in the gap's mouth, reached through the gap
  { const at = reachedAt(S, reachIn(S, a, door)); floorSitesIn(S, a, 'quarantine', (x, z) => xzUV(fr, x, z)[1] > line!.vv + 0.75 && Math.hypot(x - gx, z - gz) > 1.0 && at(x, z), 3); }
  S.rec.quarantine = {area: a.id, corner: null, gap: {x: r3(gx), z: r3(gz)}};
  // the warnings outside the door: the isolation plate over it, the painted plywood beside it
  const other = door.to, op = vc.portals.get(other)?.find(q => q.to === a.id && q.door);
  if (op) {
    doorPlate(v, v.layout.areas[other], op, 'ISOLATION · NO ENTRY', EVAC_ALERT_STYLE);
    warnBoard(S, v.layout.areas[other], op);
  } else warnBoardInside(S, a, door);
  return true;
}

/** The painted warning beside a door on `a`'s side (either side of the opening; mounted at EVAC_WARN.y). */
function warnBoard(S: Shelter, a: Area, p: Portal): boolean {
  const v = S.vc.v, t0 = p.side === 'N' || p.side === 'S' ? p.x : p.z, variant = S.rng.int(0, EVAC_WARN_TEXTS.length - 1);
  for (const s of S.rng.shuffle([1, -1])) for (const d of [p.half + 0.35 + EVAC_WARN.w / 2, p.half + 0.9 + EVAC_WARN.w / 2]) {
    const b = group(S.vc, [a], () => mountProp(v.ctx, a, p.side, t0 + s * d, 'evacWarnBoard', EVAC_WARN.y, v.base));
    if (b) { b.variant = variant; v.placed.push(b); return true; }
  }
  return false;
}
function warnBoardInside(S: Shelter, a: Area, door: Portal): boolean {
  return warnBoard(S, a, door);
}

/**
 * The quarantine CORNER (no room for it): an end of the carve's stage box along the dormitory's back wall (else a hall corner) cordoned
 * off with barriers along its open sides, one squeeze gap, abandoned cots inside; the painted warning on the wall inside it.
 */
function quarantineCorner(S: Shelter, hall: Area): boolean {
  const {vc, rng, layout} = S, v = vc.v, hub = vc.hub.get(hall.id);
  if (!hub) return false;
  const hx0 = hall.x * CELL, hz0 = hall.y * CELL, hx1 = (hall.x + hall.w) * CELL, hz1 = (hall.y + hall.h) * CELL;
  const cands: Rect[] = [];
  const st = layout.skyways?.addon.stage;
  const L = 7.0, D = 4.5;
  if (st) {
    const alongX = st.x1 - st.x0 >= st.z1 - st.z0;
    // the stage box lies along a hall wall: grow it to D deep from that wall, take an L long end of it
    const wallZ = Math.abs(st.z0 - hz0) < Math.abs(st.z1 - hz1) ? 'lo' : 'hi', wallX = Math.abs(st.x0 - hx0) < Math.abs(st.x1 - hx1) ? 'lo' : 'hi';
    if (alongX) {
      const z0 = wallZ === 'lo' ? hz0 : hz1 - D, z1 = z0 + D;
      cands.push({x0: st.x0, z0, x1: Math.min(st.x1, st.x0 + L), z1}, {x0: Math.max(st.x0, st.x1 - L), z0, x1: st.x1, z1});
    } else {
      const x0 = wallX === 'lo' ? hx0 : hx1 - D, x1 = x0 + D;
      cands.push({x0, z0: st.z0, x1, z1: Math.min(st.z1, st.z0 + L)}, {x0, z0: Math.max(st.z0, st.z1 - L), x1, z1: st.z1});
    }
  }
  for (const [cx, cz] of [[hx0, hz0], [hx1, hz0], [hx0, hz1], [hx1, hz1]]) cands.push({x0: cx === hx0 ? hx0 : hx1 - L, z0: cz === hz0 ? hz0 : hz1 - D, x1: cx === hx0 ? hx0 + L : hx1, z1: cz === hz0 ? hz0 + D : hz1});
  const portals = vc.portals.get(hall.id)!;
  for (const R0 of cands) {
    const R = {x0: Math.max(R0.x0, hx0), z0: Math.max(R0.z0, hz0), x1: Math.min(R0.x1, hx1), z1: Math.min(R0.z1, hz1)};
    if (R.x1 - R.x0 < 4.0 || R.z1 - R.z0 < 3.5) continue;
    if (portals.some(p => p.x > R.x0 - 1.6 && p.x < R.x1 + 1.6 && p.z > R.z0 - 1.6 && p.z < R.z1 + 1.6)) continue;
    // the open sides (not on the hall's walls) get a barrier line 0.35 m inside the rect
    const open = {N: R.z0 > hz0 + 0.1, S: R.z1 < hz1 - 0.1, W: R.x0 > hx0 + 0.1, E: R.x1 < hx1 - 0.1};
    const sides = (Object.keys(open) as Side[]).filter(s => open[s]);
    if (!sides.length) continue;
    const gapSide = sides.slice().sort((p, q) => ((q === 'N' || q === 'S') ? R.x1 - R.x0 : R.z1 - R.z0) - ((p === 'N' || p === 'S') ? R.x1 - R.x0 : R.z1 - R.z0))[0];
    const inner = (x: number, z: number) => x > R.x0 + 0.9 && x < R.x1 - 0.9 && z > R.z0 + 0.9 && z < R.z1 - 0.9;
    let gapAt = {x: 0, z: 0};
    const items = group(vc, [hall], () => {
      const out: PropPlacement[] = [];
      for (const s of sides) {
        // a frame whose u runs along this side: a hall frame of the rect itself
        const ax = s === 'N' || s === 'S';
        // (a line along z stops short of an open N / S side: that side's line runs through the corner)
        const lo = ax ? R.x0 : R.z0 + (open.N ? 0.7 : 0), hi = ax ? R.x1 : R.z1 - (open.S ? 0.7 : 0), at = s === 'N' ? R.z0 + 0.35 : s === 'S' ? R.z1 - 0.35 : s === 'W' ? R.x0 + 0.35 : R.x1 - 0.35;
        const fr = lineFrame(hall, ax, lo, at);
        const len = hi - lo;
        if (s === gapSide) {
          const [g0, g1] = gapCells(lo, len / 2);
          barricadeRun(S, hall, fr, 0.1, g0, 0, out);
          barricadeRun(S, hall, fr, g1, len - 0.1, 0, out);
          gapAt = ax ? {x: lo + (g0 + g1) / 2, z: at} : {x: at, z: lo + (g0 + g1) / 2};
        } else barricadeRun(S, hall, fr, 0.1, len - 0.1, 0, out);
      }
      if (out.length < 3) return null;
      return interiorFromHub(S, hall, hub, inner) ? out : null;
    });
    if (!items) continue;
    S.exclude.push(R);
    // abandoned cots inside, a trash bag pile; a dropped note
    for (let tr = 0, n = 0; tr < 30 && n < 3; tr++) {
      const kind: PropKind = rng.weighted([['evacCot', 3], ['trashBagPile', 1], ['foldingChair', 1]] as [PropKind, number][]);
      const x = rng.range(R.x0 + 0.9, R.x1 - 0.9), z = rng.range(R.z0 + 0.9, R.z1 - 0.9);
      if (group(vc, [hall], () => { const q = v.put(kind, snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: hall, variant: kind === 'evacCot' ? rng.pick([0, 2]) : 0}); return q && interiorFromHub(S, hall, hub, inner) ? q : null; })) n++;
    }
    { const at = reachedAt(S, reachIn(S, hall, hub)); for (let k = 0; k < 3; k++) floorSite(S, hall, 'quarantine', (x, z) => inner(x, z) && at(x, z), R); }
    // the painted warning on a hall wall inside the corner
    const wallSides = (Object.keys(open) as Side[]).filter(s => !open[s]);
    for (const s of wallSides) {
      const ax = s === 'N' || s === 'S', mid = ax ? (R.x0 + R.x1) / 2 : (R.z0 + R.z1) / 2;
      const b = group(vc, [hall], () => mountProp(v.ctx, hall, s, mid, 'evacWarnBoard', EVAC_WARN.y, v.base));
      if (b) { b.variant = rng.int(0, EVAC_WARN_TEXTS.length - 1); v.placed.push(b); break; }
    }
    // a lane from the squeeze gap out to the dormitory's central aisle (the cot field never walls the gap off)
    const out = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]}[gapSide], sp = S.rec.dorm?.spine;
    const ox = gapAt.x + out[0] * 1.5, oz = gapAt.z + out[1] * 1.5;
    v.keepSegment(gapAt.x, gapAt.z, ox, oz, 0.8);
    if (sp) v.keepSegment(ox, oz, Math.abs(sp.bx - sp.ax) >= Math.abs(sp.bz - sp.az) ? ox : sp.ax, Math.abs(sp.bx - sp.ax) >= Math.abs(sp.bz - sp.az) ? sp.az : oz, 0.8);
    // nothing else of the shelter goes inside the cordon or right up against it (the ration line / supply drop / belongings keep 1.2 m off)
    const K = {x0: R.x0 - (open.W ? 1.2 : 0), z0: R.z0 - (open.N ? 1.2 : 0), x1: R.x1 + (open.E ? 1.2 : 0), z1: R.z1 + (open.S ? 1.2 : 0)};
    for (let cy = Math.floor(K.z0 / CELL); cy < Math.ceil(K.z1 / CELL); cy++) for (let cx = Math.floor(K.x0 / CELL); cx < Math.ceil(K.x1 / CELL); cx++) v.keepCell(cx, cy);
    S.rec.quarantine = {area: hall.id, corner: {x0: r3(R.x0), z0: r3(R.z0), x1: r3(R.x1), z1: r3(R.z1)}, gap: {x: r3(gapAt.x), z: r3(gapAt.z)}};
    return true;
  }
  return false;
}

/** A frame whose u runs along x (ax) or z from `lo`, v = 0 on the line at `at` (only uvXZ / plusU / toFront are used). */
function lineFrame(a: Area, ax: boolean, lo: number, at: number): HallFrame {
  return {a, front: ax ? 'N' : 'W', back: ax ? 'S' : 'E', x0: ax ? lo : at, z0: ax ? at : lo, x1: ax ? lo + 99 : at, z1: ax ? at : lo + 99, W: 99, D: 0,
    toFront: ax ? Math.PI : -Math.PI / 2, toBack: ax ? 0 : Math.PI / 2, plusU: ax ? Math.PI / 2 : 0, minusU: ax ? -Math.PI / 2 : Math.PI};
}

/** Is an `inner` cell of the hall reached by a 1.2 m path from the hall's hub? */
function interiorFromHub(S: Shelter, hall: Area, hub: Portal, inner: (x: number, z: number) => boolean): boolean {
  return interiorReached(S, hall, hub, inner);
}

// ---------------------------------------------------------------------------------------------
// Family room

function familyRoom(S: Shelter, a: Area): boolean {
  const {vc, rng} = S, v = vc.v;
  let n = 0;
  for (const side of rng.shuffle(SIDES.slice())) {
    const got = group(vc, [a], () => { const r = rowAlongWall(v.ctx, a, side, 'bedroll', {max: 2, front: 0.6, cluster: 1, gap: 0.3, variant: () => rng.int(0, 3)}); return r.length ? r : null; });
    if (!got) continue;
    n += got.length;
    for (const b of got) S.sites.push({slot: 'family', on: 'bedroll', host: b, lx: 0.2, lz: rng.range(-0.1, 0.1), top: 0.106, rot: b.rot});
    if (n >= 3) break;
  }
  for (const kind of ['evacCot', 'beanBag', 'beanBag', 'ottoman', 'babyStroller', 'skywaysConPlush', 'skywaysConPlush', 'cardboardBoxFlaps'] as PropKind[]) {
    for (let tr = 0; tr < 20; tr++) {
      const x = rng.range(a.x * CELL + 0.8, (a.x + a.w) * CELL - 0.8), z = rng.range(a.y * CELL + 0.8, (a.y + a.h) * CELL - 0.8);
      if (group(vc, [a], () => v.put(kind, snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: a, variant: kind === 'evacCot' ? 1 : kind === 'skywaysConPlush' ? rng.int(0, 3) : 0}))) { n++; break; }
    }
  }
  return n >= 3;
}

// ---------------------------------------------------------------------------------------------
// Dormitory

/**
 * The dormitory hall: a central aisle along its long axis (and from every door to it) held clear, the supply drop in the stage box, then
 * cot blocks either side of the aisle — row pairs head to head (the inner row's feet at the aisle), a foot aisle between pairs, a cross
 * aisle every EVAC_DORM.block cots; a few blocks DISTURBED; screens at some block ends; overflow bedrolls and belongings along the walls.
 */
/** The dormitory's aisles, reserved first: the central aisle along the hall's long axis, and from every opening in to it. */
function dormAisles(S: Shelter, hall: Area): void {
  const {vc} = S, v = vc.v;
  const x0 = hall.x * CELL, z0 = hall.y * CELL, x1 = (hall.x + hall.w) * CELL, z1 = (hall.y + hall.h) * CELL;
  const alongX = x1 - x0 >= z1 - z0, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  const [ax, az] = alongX ? [x0 + 0.5, mid] : [mid, z0 + 0.5], [bx, bz] = alongX ? [x1 - 0.5, mid] : [mid, z1 - 0.5];
  v.keepSegment(ax, az, bx, bz, EVAC_DORM.spine);
  S.rec.dorm = {spine: {ax: r3(ax), az: r3(az), bx: r3(bx), bz: r3(bz)}, cots: 0};
  for (const p of vc.portals.get(hall.id)!) {
    const [px, pz] = inside(p, 0.3), [qx, qz] = inside(p, 2.6);
    v.keepSegment(px, pz, qx, qz, 0.8);
    const [cx, cz] = alongX ? [qx, mid] : [mid, qz];
    v.keepSegment(qx, qz, cx, cz, 0.8);
  }
}

function dormitory(S: Shelter, hall: Area): boolean {
  const {vc, rng, layout} = S, v = vc.v;
  const x0 = hall.x * CELL, z0 = hall.y * CELL, x1 = (hall.x + hall.w) * CELL, z1 = (hall.y + hall.h) * CELL;
  const alongX = x1 - x0 >= z1 - z0;
  const Lo = alongX ? x0 : z0, Hi = alongX ? x1 : z1, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  const cLo = alongX ? z0 : x0, cHi = alongX ? z1 : x1;
  /** World (x, z) of a point `u` along the hall's long axis and `c` across it (absolute). */
  const P = (u: number, c: number): [number, number] => (alongX ? [u, c] : [c, u]);
  // (the aisles are reserved before anything else of the shelter: dormAisles)
  // the supply drop in the stage box (what of it the quarantine cordon left: the cordon's cells are reserved)
  const st = layout.skyways?.addon.stage;
  if (st) supplyDrop(S, hall, st);
  // the cot rows, on whole cells (two cots 0.1 m head to head never share a cell: placeKit claims every cell a box enters by > 4 cm):
  // per side of the aisle, row pairs head to head — the inner row's feet toward the aisle — with a foot aisle between pairs
  const rows: {c: number; side: 1 | -1; face: 1 | -1}[] = []; // c = the cots' centre line across the hall; face +1 = feet toward the aisle
  const span = Math.ceil(EVAC_COT.d / CELL) * CELL;
  for (const side of [1, -1] as const) {
    const snap = (x: number) => (side > 0 ? Math.ceil(x / CELL - 1e-6) : Math.floor(x / CELL + 1e-6)) * CELL;
    const fits = (edge: number) => (side > 0 ? edge <= cHi - 0.3 : edge >= cLo + 0.3);
    for (let e = snap(mid + side * (EVAC_DORM.spine + 0.1)); ;) {
      if (!fits(e + side * EVAC_COT.d)) break;
      rows.push({c: e + side * EVAC_COT.d / 2, side, face: 1});
      const eB = e + side * span;
      if (!fits(eB + side * EVAC_COT.d)) break;
      rows.push({c: eB + side * EVAC_COT.d / 2, side, face: -1});
      e = snap(eB + side * (EVAC_COT.d + EVAC_DORM.feet));
    }
  }
  let cots = 0;
  const blockLen = EVAC_DORM.block * EVAC_DORM.pitch;
  // (block by block along the hall, both sides of the aisle: a hall bigger than the most cots leaves its far end open)
  for (let u = Lo + 0.9; u + EVAC_COT.w <= Hi - 0.6; u += blockLen + EVAC_DORM.cross - (EVAC_DORM.pitch - EVAC_COT.w)) {
    for (const side of [1, -1] as const) {
      const mine = rows.filter(r => r.side === side);
      if (!mine.length) continue;
      // the cot's front (+Z, its foot) toward the aisle (inner rows) or the wall (outer rows)
      const toAisle = alongX ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const disturbed = rng.chance(0.18);
      for (const row of mine) {
        for (let k = 0; k < EVAC_DORM.block; k++) {
          if (cots >= EVAC_DORM.maxCots) break;
          const uc = u + EVAC_COT.w / 2 + k * EVAC_DORM.pitch;
          if (uc + EVAC_COT.w / 2 > Hi - 0.5) break;
          const [x, z] = P(uc, row.c);
          if (S.exclude.some(R => x > R.x0 - 1.0 && x < R.x1 + 1.0 && z > R.z0 - 1.0 && z < R.z1 + 1.0)) continue;
          let rot = row.face > 0 ? toAisle : normYaw(toAisle + Math.PI);
          if (disturbed) {
            const r = rng.next();
            if (r < 0.25) { // gone: a bedroll left on the floor in its place, or nothing
              if (rng.chance(0.5)) {
                const br = group(vc, [hall], () => v.put('bedroll', x, z, normYaw(rot + Math.PI / 2), {area: hall, variant: rng.int(0, 3)}));
                if (br) S.sites.push({slot: 'bed', on: 'bedroll', host: br, lx: 0.2, lz: 0, top: 0.106, rot: br.rot});
              }
              continue;
            }
            if (r < 0.45) rot = normYaw(rot + Math.PI / 2); // pushed askew across its neighbours' gap (kept only if every route survives)
          }
          const variant = disturbed ? rng.pick([0, 2, 2]) : rng.weighted([[0, 0.25], [1, 0.45], [2, 0.3]] as [number, number][]);
          const c = group(vc, [hall], () => v.put('evacCot', x, z, rot, {area: hall, variant}));
          if (c) cots++;
        }
      }
      // a screen in the cross aisle at the block's far end now and then (a family pod), trash at a disturbed one
      const uEnd = u + blockLen - (EVAC_DORM.pitch - EVAC_COT.w) + EVAC_DORM.cross / 2;
      if (rng.chance(0.3)) {
        const [x, z] = P(uEnd, mine.length > 1 ? (mine[0].c + mine[1].c) / 2 : mine[0].c);
        group(vc, [hall], () => v.put('evacScreen', x, z, alongX ? Math.PI / 2 : 0, {area: hall}));
      }
      if (disturbed) {
        const [x, z] = P(u + rng.range(0, blockLen), mine[mine.length - 1].c + side * (EVAC_COT.d / 2 + 0.6));
        group(vc, [hall], () => v.put(rng.pick(['trashBagPile', 'rollingSuitcase'] as PropKind[]), snapC(x), snapC(z), WALL_ROT[rng.pick(SIDES)], {area: hall}));
        floorSiteAt(S, hall, x + rng.range(-0.6, 0.6), z + rng.range(-0.6, 0.6), 'bed');
      }
    }
  }
  if (S.rec.dorm) S.rec.dorm.cots = cots;
  // the overflow along the walls: bedrolls (notes on some), belongings (suitcases, flap boxes)
  let rolls = 0;
  for (const side of rng.shuffle(SIDES.slice())) {
    if (rolls >= 4) break;
    const got = group(vc, [hall], () => { const r = rowAlongWall(v.ctx, hall, side, 'bedroll', {max: 2, front: 0.6, cluster: 1, gap: 0.4, variant: () => rng.int(0, 3)}); return r.length ? r : null; });
    if (!got) continue;
    rolls += got.length;
    for (const b of got) S.sites.push({slot: 'bed', on: 'bedroll', host: b, lx: 0.2, lz: rng.range(-0.1, 0.1), top: 0.106, rot: b.rot});
  }
  let goods = 0;
  for (const kind of ['rollingSuitcase', 'rollingSuitcase', 'cardboardBoxFlaps', 'cardboardBoxFlaps', 'trashBagPile', 'babyStroller'] as PropKind[]) {
    for (const side of rng.shuffle(SIDES.slice())) if (group(vc, [hall], () => { const r = rowAlongWall(v.ctx, hall, side, kind, {max: 1, front: 0.5, from: rng.range(...wallRange(hall, side))}); return r.length ? r : null; })) { goods++; break; }
  }
  void goods;
  floorSite(S, hall, 'bed');
  return cots >= 8;
}

/** The commons' overflow sleeping: one block of 2 x 3-4 cots head to head (on whole cells) somewhere in the piece, kept whole or not at all. */
function overflowCots(S: Shelter, a: Area): number {
  const {vc, rng} = S, v = vc.v;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const span = Math.ceil(EVAC_COT.d / CELL) * CELL, deep = span + EVAC_COT.d;
  for (let tr = 0; tr < 12; tr++) {
    const alongX = rng.chance(0.5), n = rng.int(3, 4), len = (n - 1) * EVAC_DORM.pitch + EVAC_COT.w;
    const uLo = alongX ? ax0 : az0, uHi = alongX ? ax1 : az1, cLo = alongX ? az0 : ax0, cHi = alongX ? az1 : ax1;
    if (uHi - uLo < len + 2.4 || cHi - cLo < deep + 2.4) continue;
    const u0 = rng.range(uLo + 1.2, uHi - 1.2 - len), c0 = Math.ceil(rng.range(cLo + 1.2, cHi - 1.2 - deep) / CELL) * CELL;
    const variants = Array.from({length: 2 * n}, () => rng.weighted([[0, 0.3], [1, 0.4], [2, 0.3]] as [number, number][]));
    const got = group(vc, [a], () => {
      const out: PropPlacement[] = [];
      for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
        const u = u0 + EVAC_COT.w / 2 + i * EVAC_DORM.pitch, c = row === 0 ? c0 + EVAC_COT.d / 2 : c0 + span + EVAC_COT.d / 2;
        // row 0: heads toward +c (feet / front toward -c); row 1: heads toward -c
        const rot = alongX ? (row === 0 ? Math.PI : 0) : (row === 0 ? -Math.PI / 2 : Math.PI / 2);
        const p = v.put('evacCot', alongX ? u : c, alongX ? c : u, rot, {area: a, variant: variants[row * n + i]});
        if (!p) return null;
        out.push(p);
      }
      return out;
    });
    if (got) return got.length;
  }
  return 0;
}


/** The supply drop in the stage box: sealed carton pallets, a water cooler and a supply tote against the back wall. */
function supplyDrop(S: Shelter, hall: Area, st: Rect): void {
  const {vc, rng} = S, v = vc.v;
  const hx0 = hall.x * CELL, hz0 = hall.y * CELL, hx1 = (hall.x + hall.w) * CELL, hz1 = (hall.y + hall.h) * CELL;
  const alongX = st.x1 - st.x0 >= st.z1 - st.z0;
  const side: Side = alongX ? (Math.abs(st.z0 - hz0) < Math.abs(st.z1 - hz1) ? 'N' : 'S') : (Math.abs(st.x0 - hx0) < Math.abs(st.x1 - hx1) ? 'W' : 'E');
  const lo = alongX ? st.x0 : st.z0, hi = alongX ? st.x1 : st.z1;
  const kinds = rng.shuffle(['cartonStack', 'cartonStack', 'cartonStack', 'storageTote', 'waterCooler'] as PropKind[]);
  const items: PropPlacement[] = [];
  const got = group(vc, [hall], () => { const r = rowAlongWall(v.ctx, hall, side, kinds[0], {from: lo + 0.3, to: hi - 0.3, max: 1, front: 0.6}); return r.length ? r : null; });
  if (got) items.push(...got);
  for (const kind of kinds.slice(1)) {
    const r = group(vc, [hall], () => { const q = rowAlongWall(v.ctx, hall, side, kind, {from: lo + 0.3 + rng.range(0, Math.max(0, hi - lo - 2)), to: hi - 0.3, max: 1, front: 0.6}); return q.length ? q : null; });
    if (r) items.push(...r);
  }
  // the cot field keeps 1.2 m off the drop itself (the rest of the stage box sleeps people too)
  if (items.length) S.exclude.push({x0: Math.min(...items.map(p => p.x - p.hx)) - 1.2, z0: Math.min(...items.map(p => p.z - p.hz)) - 1.2, x1: Math.max(...items.map(p => p.x + p.hx)) + 1.2, z1: Math.max(...items.map(p => p.z + p.hz)) + 1.2});
}

// ---------------------------------------------------------------------------------------------
// Notes

/** A floor spot for a note in `a` (a free cell a body stands in, clear of every prop box), optionally only where `ok` / inside `within`. */
function floorSite(S: Shelter, a: Area, slot: EvacNoteSlot, ok?: (x: number, z: number) => boolean, within?: Rect): void {
  const R = within ?? {x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL};
  for (let tr = 0; tr < 40; tr++) {
    const x = S.rng.range(R.x0 + 0.6, R.x1 - 0.6), z = S.rng.range(R.z0 + 0.6, R.z1 - 0.6);
    if (ok && !ok(x, z)) continue;
    if (floorSiteAt(S, a, x, z, slot)) return;
  }
}
/** Up to `n` floor sites on cells of `a` that pass `ok` (every cell considered: for a small region a random probe would miss). */
function floorSitesIn(S: Shelter, a: Area, slot: EvacNoteSlot, ok: (x: number, z: number) => boolean, n: number): void {
  const cells: [number, number][] = [];
  for (let cy = a.y; cy < a.y + a.h; cy++) for (let cx = a.x; cx < a.x + a.w; cx++) if (ok((cx + 0.5) * CELL, (cy + 0.5) * CELL)) cells.push([cx, cy]);
  let k = 0;
  for (const [cx, cy] of S.rng.shuffle(cells)) if (k < n && floorSiteAt(S, a, (cx + 0.5) * CELL, (cy + 0.5) * CELL, slot)) k++;
}
function floorSiteAt(S: Shelter, a: Area, x: number, z: number, slot: EvacNoteSlot): boolean {
  const g = S.vc.v.g, [cx, cy] = g.cellOf(x, z);
  if (!g.inBounds(cx, cy)) return false;
  const i = g.idx(cx, cy);
  if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || g.rampIdx[i] >= 0 || !g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.3)) return false;
  if (S.sites.some(s => s.on === 'floor' && Math.hypot((s.x ?? 0) - x, (s.z ?? 0) - z) < 1.5)) return false;
  // (on the cell's centre: the sheet stays inside its own free cell)
  S.sites.push({slot, on: 'floor', area: a, x: r3((cx + 0.5) * CELL), z: r3((cy + 0.5) * CELL), rot: r3(normYaw(S.rng.range(-Math.PI, Math.PI)))});
  return true;
}

/** Office table sites (the backstage room's existing table / desk tops: placed after the lift, absolute). */
function officeSites(S: Shelter, rooms: readonly Area[]): void {
  for (const a of rooms) {
    const t = S.layout.props.find(p => p.area === a.id && (p.kind === 'table' || p.kind === 'desk') && p.host === undefined);
    if (t) S.sites.push({slot: 'office', on: t.kind === 'desk' ? 'desk' : 'table', host: t, lx: S.rng.range(-0.3, 0.3), lz: S.rng.range(-0.2, 0.2), top: PROP_DEFS[t.kind].h, rot: t.rot, late: true});
  }
}

/** Floor cells of the storey a player (0.3 m radius, the grid's conservative reading) reaches from the bridge mouths. */
function reachedCells(S: Shelter): Uint8Array {
  const g = S.vc.v.g, seen = new Uint8Array(g.w * g.h), q: number[] = [];
  const ok = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && g.circleClear((i % g.w + 0.5) * CELL, (Math.floor(i / g.w) + 0.5) * CELL, 0.3);
  for (const i of S.vc.walk.sources) if (!seen[i] && ok(i)) { seen[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % g.w;
    for (const j of [x > 0 ? i - 1 : -1, x < g.w - 1 ? i + 1 : -1, i - g.w, i + g.w]) if (j >= 0 && j < seen.length && !seen[j] && ok(j)) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
/** Is a note at (x, z) read from a reached cell (within 1.3 m, nothing solid between; `front`: from in front of its board)? */
function readableFrom(S: Shelter, seen: Uint8Array, x: number, z: number, front?: {fx: number; fz: number}): boolean {
  const g = S.vc.v.g, [cx, cy] = g.cellOf(x, z);
  for (let y = cy - 3; y <= cy + 3; y++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
    if (!g.inBounds(xx, y) || !seen[g.idx(xx, y)]) continue;
    const px = (xx + 0.5) * CELL, pz = (y + 0.5) * CELL, d = Math.hypot(px - x, pz - z);
    if (d > 1.3 || (front && (px - x) * front.fx + (pz - z) * front.fz < 0.2)) continue;
    let clear = true;
    for (let k = 0, n = Math.max(1, Math.ceil(d / 0.1)); k <= n && clear; k++) {
      const [qx, qy] = g.cellOf(px + (x - px) * k / n, pz + (z - pz) * k / n);
      clear = g.inBounds(qx, qy) && g.cells[g.idx(qx, qy)] === FLOOR;
    }
    if (clear) return true;
  }
  return false;
}

/** 6-10 notes over the sites: one per theme first (each to a site its text suits), then the rest; every slot at most twice. */
function chooseNotes(S: Shelter): [NoteSite, number][] {
  const {rng} = S, g = S.vc.v.g, seen = reachedCells(S);
  // (a floor spot something was placed over since it was found is no spot any more; every note is read from floor a player reaches)
  const valid = (s: NoteSite) => {
    if (s.on !== 'floor') {
      if (!s.host || !S.layout.props.includes(s.host)) return false;
      const [x, z] = toWorld(s.host, s.lx ?? 0, s.lz ?? 0);
      return readableFrom(S, seen, x, z, s.on === 'board' ? {fx: Math.sin(s.host.rot), fz: Math.cos(s.host.rot)} : undefined);
    }
    const [cx, cy] = g.cellOf(s.x!, s.z!), i = g.idx(cx, cy);
    return !g.blocked[i] && g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.3) && readableFrom(S, seen, s.x!, s.z!);
  };
  const sites = rng.shuffle(S.sites.filter(valid));
  const want = Math.min(sites.length, rng.int(EVAC_NOTE_COUNT[0], EVAC_NOTE_COUNT[1]));
  const free = new Set(sites), used = new Set<number>(), out: [NoteSite, number][] = [];
  const perSlot = new Map<string, number>();
  const take = (site: NoteSite, text: number) => { out.push([site, text]); free.delete(site); used.add(text); perSlot.set(site.slot, (perSlot.get(site.slot) ?? 0) + 1); };
  const fits = (text: number, site: NoteSite) => EVAC_NOTES[text].at.includes(site.slot);
  const order = rng.shuffle(EVAC_NOTES.map((_, i) => i));
  // one note per theme (a site its text suits; failing that, any site)
  for (const theme of rng.shuffle(EVAC_NOTE_THEMES.slice())) {
    if (out.some(([, t]) => EVAC_NOTES[t].themes.includes(theme))) continue;
    let done = false;
    for (const text of order) {
      if (used.has(text) || !EVAC_NOTES[text].themes.includes(theme)) continue;
      const site = sites.find(s => free.has(s) && fits(text, s) && (perSlot.get(s.slot) ?? 0) < 2);
      if (site) { take(site, text); done = true; break; }
    }
    if (!done) {
      const text = order.find(t => !used.has(t) && EVAC_NOTES[t].themes.includes(theme)), site = sites.find(s => free.has(s));
      if (text !== undefined && site) take(site, text);
    }
  }
  // then one note per kind of place (the quarantine and the medical bay first): the story spreads over the whole shelter
  for (const slot of ['quarantine', 'medical', 'board', 'bed', 'desk', 'rations', 'family', 'office'] as EvacNoteSlot[]) {
    if (out.length >= want || out.some(([s]) => s.slot === slot)) continue;
    for (const site of sites) {
      if (!free.has(site) || site.slot !== slot) continue;
      const text = order.find(t => !used.has(t) && fits(t, site));
      if (text !== undefined) { take(site, text); break; }
    }
  }
  // the rest: the first site each remaining text suits, spreading over the slots
  for (const site of sites) {
    if (out.length >= want) break;
    if (!free.has(site) || (perSlot.get(site.slot) ?? 0) >= (site.slot === 'board' ? 3 : 2)) continue;
    const text = order.find(t => !used.has(t) && fits(t, site));
    if (text !== undefined) take(site, text);
  }
  return out;
}

/** The host-local x range a note's centre may take on a support's top (the sheet whole on the top; on a bedroll, on the bag's flat
 *  run between the folded pad at its head end and the bundle at its foot: gen/purposeShapes.ts bedroll). */
export function noteRange(host: PropPlacement): [number, number] {
  const half = EVAC_NOTE.w / 2 + 0.02;
  if (host.kind === 'bedroll') return [-0.3 + half, 0.58 - half];
  if (host.kind === 'skywaysConMerchTable') return [-SKYWAYS_MERCH_TOP.x + half, SKYWAYS_MERCH_TOP.x - half];
  if (host.kind === 'noticeBoard') return [-PROP_DEFS.noticeBoard.w / 2 + half, PROP_DEFS.noticeBoard.w / 2 - half];
  const w = PROP_DEFS[host.kind].w;
  return [-w / 2 + 0.06 + half, w / 2 - 0.06 - half];
}

/** Places one note prop on its site (on-host decor on a table / desk / bedroll / board; or flat on the floor). */
function placeNote(S: Shelter, site: NoteSite, text: number): PropPlacement | null {
  const {layout} = S, v = S.vc.v;
  const pinned = site.on === 'board';
  const variant = evacNoteVariant(text, pinned);
  if (site.host) {
    const host = site.host, hi = layout.props.indexOf(host);
    if (hi < 0) return null;
    const along = Math.abs(Math.sin(site.rot)) < 0.5;
    const f = pinned ? {hx: along ? EVAC_NOTE.w / 2 : 0.002, hz: along ? 0.002 : EVAC_NOTE.w / 2} : footprint('evacNote', site.rot);
    // the spot on the support's top (host-local x), shifted along it clear of any other decor on the same top
    const [xLo, xHi] = noteRange(host);
    let at: [number, number] | null = null, lx = site.lx ?? 0;
    for (const dx of [0, 0.25, -0.25, 0.5, -0.5]) {
      const cx = (site.lx ?? 0) + dx;
      if (cx < xLo || cx > xHi) continue;
      const [x, z] = toWorld(host, cx, site.lz ?? 0);
      if (layout.props.some(q => q.host === hi && Math.abs(q.x - x) < q.hx + f.hx + 0.02 && Math.abs(q.z - z) < q.hz + f.hz + 0.02)) continue;
      at = [x, z]; lx = cx;
      break;
    }
    if (!at) return null;
    const [x, z] = at;
    const p: PropPlacement = {kind: 'evacNote', x: r3(x), z: r3(z), y: r3(host.y + (site.top ?? 0)), rot: r3(site.rot), area: host.area, hx: r3(f.hx), hz: r3(f.hz),
      h: pinned ? EVAC_NOTE.d : EVAC_NOTE.h, blocksSight: false, variant, host: hi, ...(pinned ? {mounted: true} : {}), ...(host.level ? {level: host.level} : {})};
    // a holder's loot surface skips the sheet (PropPlacement.cut)
    if (!pinned && (host.kind === 'desk' || host.kind === 'table')) (host.cut ??= []).push({y: site.top ?? host.h, x0: r3(lx - 0.16), x1: r3(lx + 0.16)});
    layout.props.push(p);
    if (!site.late) v.placed.push(p);
    return p;
  }
  if (!site.area || site.x === undefined || site.z === undefined) return null;
  const rot = Math.round(site.rot / (Math.PI / 2)) * (Math.PI / 2);
  const f = footprint('evacNote', rot);
  return v.push({kind: 'evacNote', x: site.x, z: site.z, y: 0, rot: r3(normYaw(rot)), area: site.area.id, hx: r3(f.hx), hz: r3(f.hz), h: EVAC_NOTE.h, blocksSight: false, variant});
}

// ---------------------------------------------------------------------------------------------
// Rations (after the lift: absolute heights)

/** A few rations on the ration line's tables (the pantry rows): ordinary layout pickups on the real table top, never overlapping. */
function placeRations(S: Shelter): number[] {
  const {layout, rng} = S, out: number[] = [];
  const tables = S.rationTables;
  if (!tables.length) return out;
  const n = rng.int(EVAC_RATIONS[0], EVAC_RATIONS[1]);
  const top = SKYWAYS_MERCH_TOP;
  for (let tr = 0; tr < 30 && out.length < n; tr++) {
    const t = rng.pick(tables), itemId = rng.weighted(PANTRY_ROWS);
    const d = itemDims(itemId), r = Math.hypot(d.w, d.d) / 2;
    const lx = rng.range(-top.x + r + 0.05, top.x - r - 0.05), lz = rng.range(0.0, top.z - r - 0.03);
    const [x, z] = toWorld(t, lx, lz), y = r3(t.y + top.y);
    const ti = layout.props.indexOf(t);
    if (layout.props.some(p => p.host === ti && Math.abs(p.x - x) < p.hx + r + 0.03 && Math.abs(p.z - z) < p.hz + r + 0.03)) continue;
    if (layout.pickups.some(q => (q.level ?? 0) === (t.level ?? 0) && Math.abs(q.y - y) < 0.3 && Math.hypot(q.x - x, q.z - z) < r + Math.hypot(itemDims(q.itemId).w, itemDims(q.itemId).d) / 2 + 0.03)) continue;
    out.push(layout.pickups.length);
    layout.pickups.push({itemId, count: 1, x: r3(x), y, z: r3(z), area: t.area, ...(t.level ? {level: t.level} : {}), yaw: r3(normYaw(t.rot + rng.range(-0.4, 0.4)))});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wayfinding

/** Plates over the shelter's doors (on the side people come from): DORMITORY, MEDICAL BAY, FAMILY ROOM, WASHROOMS. */
function plates(S: Shelter): void {
  const {vc, roleOf, layout} = S, v = vc.v, q = S.rec.quarantine;
  const name = (id: number): string | null => {
    const r = roleOf(id);
    if (q && !q.corner && id === q.area) return null; // (its isolation plate is already up)
    if (r === 'main-hall') return 'DORMITORY · WASHROOMS';
    if (r === 'panel') return 'MEDICAL BAY';
    if (r === 'photo-lounge') return 'FAMILY ROOM';
    if (r === 'washrooms') return 'WASHROOMS';
    return null;
  };
  for (const a of vc.walk.pub) for (const p of vc.portals.get(a.id) ?? []) {
    if (!p.door) continue;
    const text = name(p.to);
    if (!text || (roleOf(a.id) === 'main-hall' && text.startsWith('DORMITORY'))) continue;
    doorPlate(v, a, p, text, EVAC_SIGN_STYLE);
  }
  void layout;
}
