// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-MUSIC): THE DRESSER of Northern Groove Records (layout version >= 3).
// One AnchorKit per anchor (destinations/skywaysShopsAKit.ts: frame u along the storefront, v deep; reserved door strips / lanes; every
// floor prop through the shared placement primitive). The store, front to back:
//  - the CASH DESK by the entry: an openable back counter against a flank wall (the Mall's till / back counter with hutch — five
//    drawers and a cupboard — else an openable sideboard), a 1 m staff aisle, the counter run facing the floor with the till and a crate
//    of new arrivals on it;
//  - the NEW ARRIVALS wall: a board with three ledges and its painted header on a solid wall near the front, twelve-inch LPs stood
//    face-out on every ledge (separate stock props);
//  - the BROWSING FLOOR: rows of double-sided record-bin racks (aisles from the front), EVERY bay of every rack stocked with a filed
//    block of ten-inch sleeves (user: "the record store needs actual records in the holders"), a genre card on each rack's front apron
//    (one genre per row), dig crates of records at the run ends, accessory shelving, a jukebox;
//  - the STAGE corner at the back (upright piano, half stack, drum kit, a road case) with the GUITAR WALL beside it, gig posters;
//  - the LISTENING BOOTHS (format multi-zone: anchor.zones off one flank; a hall gets a listening bar against a wall instead): an
//    openable console with a turntable and headphones on top, a counter stool, an armchair where it fits; a LISTENING BOOTHS sign;
//  - the BACK ROOMS (anchor.stock: stock room / office; the station dresser already stood its shelving / cartons there): staff
//    lockers, a supply cabinet, shelving of record crates, lidded crates, a staff desk and fridge where they fit. With no back room a
//    staff corner (supply cabinet + lockers) stands by the cash desk.
// Loot: existing holders only (stores/music.ts purposes; the hall's listening bar consoles and the stage road case carry per-holder
// purposes like the ramen precedent). Records are physical stock (no record item, no new inventory).

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, SHELF_TIER_Y, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../../props';
import {stockVariant} from '../../purposeShapes';
import {WALL_ROT, areaBase, backed, makePlaceCtx, placeAgainstWall, tryPlaceProp, wallRange, wallSpot, wallXZ} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {normYaw, toWorld, yawToward} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from '../destinations/skywaysShopsAKit';
import {DEST_POSTERS_OF} from '../destinations/art';
import {BIN_STYLES, COVER_WALL, COVER_WALL_BASE_Y, FACED_STYLES, binBlockFrame} from './musicStock';
import {COVER_WALL_DEPTH, MUSIC_DIMS, MUSIC_GENRES} from './musicShapes';

/** Per-holder loot purposes (existing ids, gen/purposes.ts): the hall's listening-bar consoles, the stage's road case. */
export const MUSIC_HOLDER_PURPOSE = {listening: 'office-listening', roadCase: 'office-studio'} as const;
/** The bin racks' genre card art per variant (signs atlas genre-<g>). */
export const MUSIC_LABEL_GENRES = MUSIC_GENRES;

/** QA / tests: one music store's dressing. */
export interface MusicDressResult {
  anchor: string;
  format: SkywaysAnchor['format'];
  props: number[];
  lanes: ShopsALane[];
  skipped: string[];
  /** Prop indices: the bin racks, their stock blocks (rack index -> blocks), the cover walls and their faced rows, the cash desk. */
  racks: number[];
  blocks: Map<number, number[]>;
  coverWalls: number[];
  faced: number[];
  cashDesk: {back: number | null; counters: number[]; aisle: [number, number, number, number] | null};
  booths: {zone: number | null; console: number; turntable: number | null; headphones: number | null; stools: number[]}[];
  backRooms: {area: number; added: number[]}[];
}
const RESULTS = new WeakMap<StationLayout, MusicDressResult[]>();
/** QA / tests: what dressMusicStore placed in a layout (the generator ignores it). */
export function skywaysMusicDressOf(layout: StationLayout): readonly MusicDressResult[] { return RESULTS.get(layout) ?? []; }

/** Dresses one music anchor; returns the props placed. */
export function dressMusicStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (anchor.family !== 'music' || !layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const res: MusicDressResult = {anchor: anchor.id, format: anchor.format, props: [], lanes: kit.lanes, skipped: kit.skipped, racks: [], blocks: new Map(), coverWalls: [], faced: [],
    cashDesk: {back: null, counters: [], aisle: null}, booths: [], backRooms: []};
  const idx = (p: PropPlacement | null | undefined): number => (p ? layout.props.indexOf(p) : -1);
  kit.reserveDoors();
  // centrepieces first (the lanes route round them): the cash desk, the stage corner, the booths' / listening bar's furniture
  const desk = cashDesk(kit);
  res.cashDesk = {back: desk.back ? idx(desk.back) : null, counters: desk.counters.map(idx), aisle: desk.aisle};
  stageCorner(kit);
  for (const z of kit.zones) res.booths.push(booth(kit, z));
  kit.reserveLanes();
  if (!kit.zones.length) for (const b of listeningBar(kit)) res.booths.push(b);
  // the walls: new arrivals (board + faced rows), the guitar wall by the stage, accessory shelving, the booths' sign
  const cw = coverWall(kit, desk);
  if (cw) { res.coverWalls.push(idx(cw.wall)); res.faced.push(...cw.rows.map(idx)); } else kit.skipped.push('new arrivals wall');
  guitarWall(kit);
  kit.wallRun('stockShelf', {cluster: 2, gap: 0.6, max: rng.int(1, 2), front: 0.9, variant: () => stockVariant('devices')});
  if (kit.zones.length) boothSign(kit);
  // the browsing floor: double-sided rack runs (aisles from the front) packing the floor, then single racks backed to the free walls;
  // every bay stocked, a genre card per rack (one genre per run), dig crates at the island runs' ends
  const runs = fillRuns(kit, 'skyDRecordBins', {units: [2, 4], aisle: 1.2, max: rng.int(12, 20), orient: kit.fr.W >= kit.fr.D ? 'v' : 'u'});
  if (!runs.length) kit.skipped.push('record bins');
  const genres = rng.shuffle(MUSIC_LABEL_GENRES.map((_, i) => i));
  const stockRun = (run: PropPlacement[], k: number) => {
    for (const rack of run) {
      res.racks.push(idx(rack));
      res.blocks.set(idx(rack), stockRack(kit, rack).map(idx));
      binLabel(kit, rack, genres[k % genres.length]);
    }
  };
  runs.forEach((run, k) => { stockRun(run, k); digCrates(kit, run); });
  stockRun(kit.wallRun('skyDRecordBins', {cluster: 3, gap: 1.0, max: rng.int(3, 8), front: 1.2}), runs.length);
  // a jukebox near the booths (else mid-floor), a row of dig crates along a free wall
  const bz = kit.zones[0];
  const [jx, jz] = bz ? [(bz.x + bz.w / 2) * CELL, (bz.y + bz.h / 2) * CELL] : kit.inside(kit.fr.D * 0.6);
  kit.putNearWall('jukebox', jx, jz, {front: 0.9, tries: 80});
  kit.wallRun('skyDRecordCrate', {cluster: rng.int(3, 4), gap: 1.2, max: rng.int(3, 6)});
  // posters: the store's own gig posters (Codex) and the destinations' music posters
  wallArt(kit, 'skyMuGigPoster', 1.04, rng.int(3, 5), (i) => i % 4);
  kit.posters(2);
  // the back rooms (or the staff corner by the cash desk)
  const rooms = anchor.stock.map(s => layout.areas[s]).filter(a => a && kit.storeys.has(a.level ?? 0));
  for (const a of rooms) res.backRooms.push({area: a.id, added: backRoom(kit, a).map(idx)});
  if (anchor.stock.length > rooms.length) kit.skipped.push('a back room on another storey (not dressed)');
  if (!rooms.length) staffCorner(kit, desk);
  kit.lift();
  for (let i = kit.p0; i < layout.props.length; i++) res.props.push(i);
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  list.push(res);
  return layout.props.length - kit.p0;
}

// =================================================================================================================================
// The cash desk

/** The flank wall at u = 0 / u = W of the frame. */
function flankSide(kit: AnchorKit, end: 0 | 1): Side {
  const f = kit.fr.front;
  if (f === 'N' || f === 'S') return end ? 'E' : 'W';
  return end ? 'S' : 'N';
}

interface CashDesk { back: PropPlacement | null; counters: PropPlacement[]; aisle: [number, number, number, number] | null; end: 0 | 1 | null }

/**
 * The cash desk: an OPENABLE back counter against a flank wall near the front (the Mall's cash-wrap counter: five drawers + a
 * cupboard and its hutch; else the openable sideboard), a 1 m staff aisle in front of it, and the two-module counter run parallel to it
 * facing the floor (its customer side). All or nothing; the staff aisle is reserved. Fallback: an island counter by the entry with an
 * openable sideboard against the nearest wall.
 */
function cashDesk(kit: AnchorKit): CashDesk {
  // (the counters' back edge on the cell line 2.0 m off the wall: a ~1.2 m staff aisle in front of the back counter, whose drawer /
  // door strip (0.6 m) never reaches the counters' cells)
  const fr = kit.fr, cd = PROP_DEFS.shopCounter, BACK_EDGE = 2.0;
  for (const backKind of ['mallCashwrapCounter', 'cabinetLow'] as PropKind[]) {
    const bk = PROP_DEFS[backKind];
    for (const end of kit.rng.shuffle([0, 1] as (0 | 1)[])) {
      const side = flankSide(kit, end), rot = end ? fr.minusU : fr.plusU;
      for (const v0 of [1.5, 2.0, 2.5, 3.0, 3.5, 4.5, 5.5]) {
        if (v0 + 2 * cd.w + 1.0 > fr.D) continue;
        const uB = end ? fr.W - (bk.d / 2 + 0.03) : bk.d / 2 + 0.03;
        const got: PropPlacement[] = [];
        let aisle: [number, number, number, number] | null = null;
        const ok = kit.cluster(() => {
          const [bx, bz] = kit.uv(uB, snapEdge(v0 + cd.w + 0.005, bk.w / 2));
          const a = kit.areaAt(bx, bz);
          if (!a || !kit.solidWall(a, side, side === 'N' || side === 'S' ? bx : bz, backKind)) return false;
          const b = kit.put(backKind, bx, bz, rot, {area: a, front: 0.6});
          if (!b) return false;
          got.push(b);
          // the counter run: two modules along the wall from v0, their back edge BACK_EDGE m off the wall
          const uC = end ? fr.W - BACK_EDGE - cd.d / 2 : BACK_EDGE + cd.d / 2;
          for (let k = 0; k < 2; k++) {
            const [cx, cz] = kit.uv(uC, v0 + cd.w / 2 + k * (cd.w + 0.01));
            const c = kit.put('shopCounter', cx, cz, rot, {front: 1.0});
            if (!c) return false;
            got.push(c);
          }
          // the staff aisle between them: free floor, reserved
          // (from the first cell line clear of the back counter to the counters' back edge)
          const face = 0.03 + bk.d, uA = end ? fr.W - Math.ceil(face / CELL) * CELL : Math.ceil(face / CELL) * CELL;
          const [ax, az] = kit.uv(uA, v0), [qx, qz] = kit.uv(end ? fr.W - BACK_EDGE : BACK_EDGE, v0 + 2 * cd.w);
          aisle = [r3(Math.min(ax, qx)), r3(Math.min(az, qz)), r3(Math.max(ax, qx)), r3(Math.max(az, qz))];
          if (!kit.boxFree(aisle[0], aisle[1], aisle[2], aisle[3], kit.level, true)) return false;
          kit.keepBox(aisle[0], aisle[1], aisle[2], aisle[3]);
          return true;
        });
        if (ok) { counterTop(kit, got[1], got[2]); return {back: got[0], counters: got.slice(1), aisle, end}; }
      }
    }
  }
  // fallback: an island counter facing the entry beside it, the sideboard on the nearest wall
  const counters: PropPlacement[] = [];
  for (const s of kit.rng.shuffle([1, -1])) for (const dv of [2.4, 3.0, 3.8]) for (const du of [kit.entry.half + 1.2, kit.entry.half + 2.2, kit.entry.half + 3.4]) {
    if (counters.length) break;
    const v = r3(Math.round((dv + cd.d) / CELL) * CELL - cd.d / 2);
    const [x, z] = kit.uv(snapEdge(kit.uE + s * (du + cd.w / 2), cd.w / 2), v);
    const c = kit.put('shopCounter', x, z, fr.toFront, {front: 1.0});
    if (c) counters.push(c);
  }
  if (!counters.length) { kit.skipped.push('cash desk'); return {back: null, counters, aisle: null, end: null}; }
  counterTop(kit, counters[0], null);
  const back = kit.putNearWall('cabinetLow', counters[0].x, counters[0].z, {front: 0.7, tries: 60});
  if (!back) kit.skipped.push('cash desk cabinet');
  return {back, counters, aisle: null, end: null};
}
/** The till on the counter nearest the door, a crate of new arrivals on the other (their spans cut out of the counters' loot tops). */
function counterTop(kit: AnchorKit, till: PropPlacement, other: PropPlacement | null): void {
  const reg = kit.onTop(till, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y);
  if (reg) (till.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: r3(0.25 - 0.26), x1: r3(0.25 + 0.26)});
  const host = other ?? till, lx = other ? -0.25 : -0.4, c = PROP_DEFS.skyDRecordCrate;
  if (kit.onTop(host, 'skyDRecordCrate', lx, 0, SHOP_COUNTER_TOP_Y)) (host.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: r3(lx - c.w / 2 - 0.02), x1: r3(lx + c.w / 2 + 0.02)});
}
/** No back room: a staff corner — a supply cabinet and lockers on the wall nearest the cash desk. */
function staffCorner(kit: AnchorKit, desk: CashDesk): void {
  const at = desk.back ?? desk.counters[0];
  const [x, z] = at ? [at.x, at.z] : kit.inside(3);
  if (!kit.putNearWall('cabinetTall', x, z, {front: 0.7, tries: 80})) kit.skipped.push('staff corner cabinet');
  if (!kit.putNearWall('staffLockers', x, z, {front: 0.7, tries: 80})) kit.skipped.push('staff corner lockers');
}

// =================================================================================================================================
// The stage corner, the guitar wall

/** The stage corner: the piano and the half stack backed to the back wall in the corner away from the cash desk, the kit before them, a road case. */
function stageCorner(kit: AnchorKit): void {
  const fr = kit.fr, piano = PROP_DEFS.skyDPiano, amp = PROP_DEFS.skyDAmpStack, drums = PROP_DEFS.skyDDrumKit, back = fr.back;
  const counter = kit.placed.find(p => p.kind === 'shopCounter');
  const cu = counter ? kit.toUV(counter.x, counter.z)[0] : kit.uE;
  for (const end of cu < fr.W / 2 ? [1, 0] : [0, 1]) for (const inset of [0.6, 1.2, 2.0, 3.0, 4.2]) {
    const uP = end ? fr.W - inset - piano.w / 2 : inset + piano.w / 2, dir = end ? -1 : 1;
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      const [px, pz] = kit.uv(uP, fr.D - 0.03 - piano.d / 2);
      const a = kit.areaAt(px, pz);
      if (!a || !kit.solidWall(a, back, back === 'N' || back === 'S' ? px : pz, 'skyDPiano')) return false;
      const p = kit.put('skyDPiano', px, pz, fr.toFront, {area: a, front: 0.6});
      if (!p) return false;
      got.push(p);
      let uA = NaN;
      for (const [s, gap] of [[dir, 0.35], [dir, 0.7], [-dir, 0.35], [-dir, 0.7]] as [number, number][]) {
        const u = uP + s * (piano.w / 2 + gap + amp.w / 2), [ax, az] = kit.uv(u, fr.D - 0.03 - amp.d / 2);
        const pa = kit.put('skyDAmpStack', ax, az, fr.toFront, {front: 0.5});
        if (pa) { got.push(pa); uA = u; break; }
      }
      if (!Number.isFinite(uA)) return false;
      const sA = Math.sign(uA - uP);
      drum: for (const dv of [0.9, 1.3, 1.8, 2.4]) for (const du of [sA * (drums.w / 2 - 0.3), sA * 0.3, 0, sA * (drums.w / 2 + 0.3), -sA * 0.6]) {
        const [dx, dz] = kit.uv(uA + du, fr.D - 0.03 - Math.max(amp.d, piano.d) - dv - drums.d / 2);
        const pd = kit.put('skyDDrumKit', dx, dz, fr.toFront);
        if (pd) { got.push(pd); break drum; }
      }
      return got.length === 3;
    });
    if (ok) {
      // the band's road case beside the amp (an openable trunk: spare cells, a flare, a dressing — per-holder purpose)
      const [ux] = kit.toUV(got[1].x, got[1].z), sA = Math.sign(ux - uP) || 1;
      for (const off of [amp.w / 2 + 0.25 + PROP_DEFS.footlocker.w / 2, amp.w / 2 + 0.6 + PROP_DEFS.footlocker.w / 2]) {
        const [fx, fz] = kit.uv(ux + sA * off, fr.D - 0.03 - PROP_DEFS.footlocker.d / 2);
        const rc = kit.put('footlocker', fx, fz, fr.toFront, {front: 0.5});
        if (rc) { rc.purpose = MUSIC_HOLDER_PURPOSE.roadCase; got.push(rc); break; }
      }
      reserveAround(kit, got, kit.level, 0.6);
      return;
    }
  }
  kit.skipped.push('stage corner');
}
/** The guitar wall: guitars on their stands along the back wall by the stage, else a flank / any free wall. */
function guitarWall(kit: AnchorKit): void {
  const want = kit.rng.int(6, 10), fr = kit.fr;
  const g = kit.wallRun('skyDGuitar', {sides: [fr.back], cluster: 1, gap: 0.22, max: want});
  if (g.length < 4) g.push(...kit.wallRun('skyDGuitar', {cluster: 1, gap: 0.22, max: want - g.length}));
  if (g.length < 4) kit.skipped.push(`guitar wall: ${g.length}`);
}

// =================================================================================================================================
// Listening booths / the listening bar

/** The listening console (an openable sideboard) against a wall, a turntable and headphones on top, a counter stool before it. */
function listeningStation(kit: AnchorKit, at: {a: Area; side: Side; x: number; z: number; rot: number}, purpose?: string): MusicDressResult['booths'][number] | null {
  const cab = PROP_DEFS.cabinetLow, st = MUSIC_DIMS.stool;
  let out: MusicDressResult['booths'][number] | null = null;
  const ok = kit.cluster(() => {
    const c = kit.put('cabinetLow', at.x, at.z, at.rot, {area: at.a, front: 0.6});
    if (!c) return false;
    if (purpose) c.purpose = purpose;
    const tt = kit.onTop(c, 'skyMuTurntable', -0.45, 0.0, cab.h);
    const hp = kit.onTop(c, 'skyMuHeadphones', 0.32, 0.05, cab.h, normYaw(c.rot + 0.4));
    if (tt) (c.cut ??= []).push({y: cab.h, x0: r3(-0.45 - MUSIC_DIMS.turntable.w / 2 - 0.02), x1: r3(-0.45 + MUSIC_DIMS.turntable.w / 2 + 0.02)});
    if (hp) (c.cut ??= []).push({y: cab.h, x0: r3(0.32 - 0.14), x1: r3(0.32 + 0.14)});
    // the stool just beyond the doors' swing, facing the console (a second one where it fits)
    const stools: PropPlacement[] = [];
    // (in front beyond the doors' swing, else at the console's end against the wall; a booth door's reserved strip may take the middle)
    const spots: [number, number][] = [];
    for (const lx of [-0.45, 0.45, -0.8, 0.8]) for (const gap of [0.62, 0.85]) spots.push([lx, cab.d / 2 + gap + st.d / 2]);
    for (const sx of [-1, 1]) spots.push([sx * (cab.w / 2 + 0.08 + st.w / 2), -cab.d / 2 + st.d / 2 + 0.02]);
    for (const [lx, lz] of spots) {
      if (stools.length >= 2 || (stools.length && kit.rng.chance(0.5))) break;
      const [sx, sz] = toWorld(c, lx, lz);
      if (stools.some(s => Math.hypot(sx - s.x, sz - s.z) < st.w + 0.1)) continue;
      const s = kit.putRound('skyMuStool', sx, sz, c.rot + Math.PI, {area: at.a});
      if (s) stools.push(s);
    }
    if (!stools.length) return false;
    out = {zone: kit.zones.includes(at.a) ? at.a.id : null, console: kit.layout.props.indexOf(c), turntable: tt ? kit.layout.props.indexOf(tt) : null, headphones: hp ? kit.layout.props.indexOf(hp) : null,
      stools: stools.map(s => kit.layout.props.indexOf(s))};
    return true;
  });
  return ok ? out : null;
}
/** A booth (zone): the listening station on the wall opposite its door (else any wall of it), an armchair where it fits. */
function booth(kit: AnchorKit, z: Area): MusicDressResult['booths'][number] {
  const door = kit.st().doors.find(d => d.a === z.id || d.b === z.id);
  const p = door ? kit.doorIn(door, kit.level, 0, z.id) : null;
  const cx = (z.x + z.w / 2) * CELL, cz = (z.y + z.h / 2) * CELL;
  const far: Side | null = p ? (Math.abs(p.x - cx) > Math.abs(p.z - cz) ? (p.x < cx ? 'E' : 'W') : (p.z < cz ? 'S' : 'N')) : null;
  const sides = (['N', 'S', 'E', 'W'] as Side[]).sort((s, q) => (s === far ? -1 : 0) - (q === far ? -1 : 0));
  let res: MusicDressResult['booths'][number] | null = null;
  for (const side of sides) {
    const [lo, hi] = wallRange(z, side), w = PROP_DEFS.cabinetLow.w;
    for (const t of [(lo + hi) / 2, (lo + hi) / 2 - 0.4, (lo + hi) / 2 + 0.4]) {
      if (t - w / 2 < lo + 0.1 || t + w / 2 > hi - 0.1 || !kit.solidWall(z, side, t, 'cabinetLow')) continue;
      const [x, zz] = wallXZ(z, side, t, PROP_DEFS.cabinetLow.d / 2 + 0.03);
      res = listeningStation(kit, {a: z, side, x, z: zz, rot: WALL_ROT[side]});
      if (res) break;
    }
    if (res) break;
  }
  if (!res) { kit.skipped.push(`booth ${z.id} station`); return {zone: z.id, console: -1, turntable: null, headphones: null, stools: []}; }
  // an armchair in a free corner of the booth, facing its middle
  for (const [fx, fz] of kit.rng.shuffle([[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as [number, number][])) {
    const x = (z.x + z.w * fx) * CELL, zz = (z.y + z.h * fz) * CELL;
    if (kit.put('loungeArmchair', x, zz, yawToward(cx - x, cz - zz), {area: z})) break;
  }
  return res;
}
/** A hall store's LISTENING BAR: two stations side by side on a solid wall (back first, then a flank), consoles rolling the listening lounge's purpose. */
function listeningBar(kit: AnchorKit): MusicDressResult['booths'] {
  const out: MusicDressResult['booths'] = [];
  const fr = kit.fr;
  for (const sides of [[fr.back], undefined] as (Side[] | undefined)[]) {
    if (out.length >= 2) break;
    const [ox, oz] = kit.uv(fr.W / 2, fr.D * 0.7);
    for (const sp of kit.wallSpots('cabinetLow', ox, oz, kit.level, sides).filter((_, i) => i % 2 === 0).slice(0, 40)) {
      if (out.length >= 2) break;
      if (kit.onLane(sp.x, sp.z, kit.level, 0.9)) continue;
      const b = listeningStation(kit, sp, MUSIC_HOLDER_PURPOSE.listening);
      if (b) out.push(b);
    }
  }
  if (!out.length) kit.skipped.push('listening bar');
  return out;
}
/** The LISTENING BOOTHS board above head height on the sales-floor wall the booths open from (else any solid wall near them). */
function boothSign(kit: AnchorKit): void {
  const z = kit.zones[0];
  if (!z) return;
  const n = wallArt(kit, 'skyMuSign', 2.2, 1, () => 0, [(z.x + z.w / 2) * CELL, (z.y + z.h / 2) * CELL]);
  if (!n) kit.skipped.push('booth sign');
}

// =================================================================================================================================
// The new arrivals wall

/**
 * The new-arrivals board on a solid wall of the sales floor (no window / door / glazing behind its full height, nothing standing in
 * front of it within 1.2 m — that strip is reserved), on the side away from the cash desk and toward the front first; three rows of
 * twelve-inch LPs face out on its ledges. Wall-mounted from 0.92 m (the floor under it stays walkable).
 */
function coverWall(kit: AnchorKit, desk: CashDesk): {wall: PropPlacement; rows: PropPlacement[]} | null {
  const fr = kit.fr, def = PROP_DEFS.skyMuCoverWall, s = kit.st(), y0 = COVER_WALL_BASE_Y, y1 = y0 + def.h;
  const pref: Side[] = desk.end === null ? [flankSide(kit, 0), flankSide(kit, 1), fr.back] : [flankSide(kit, desk.end ? 0 : 1), fr.back, flankSide(kit, desk.end)];
  const [ex, ez] = kit.inside(3);
  const cands: {a: Area; side: Side; t: number; x: number; z: number; d: number}[] = [];
  for (const a of s.areas.filter(q => !kit.zones.includes(q))) for (const side of pref) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.5 + def.w / 2; t <= hi - 0.5 - def.w / 2; t += 0.25) {
      const t0 = t - def.w / 2, t1 = t + def.w / 2;
      if (!backed(s.ctx, a, side, t0, t1, s.base + 0.3) || !backed(s.ctx, a, side, t0, t1, s.base + y1 - 0.05) || !backed(s.ctx, a, side, t0, t1, s.base + y0 + 0.4)) continue;
      if (kit.windowAt(a, side, t0, t1, y1 + 0.1)) continue;
      const [x, z] = wallXZ(a, side, t, def.d / 2 + 0.005);
      cands.push({a, side, t, x, z, d: pref.indexOf(side) * 40 + Math.hypot(x - ex, z - ez)});
    }
  }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands.slice(0, 60)) {
    const rot = WALL_ROT[c.side], along = c.side === 'N' || c.side === 'S';
    // the browsing strip in front: free floor of the area, not on a door strip
    const [fx, fz] = wallXZ(c.a, c.side, c.t, def.d + 0.6);
    const hx = along ? def.w / 2 : 0.6, hz = along ? 0.6 : def.w / 2;
    if (!kit.boxFree(fx - hx, fz - hz, fx + hx, fz + hz, kit.level, true)) continue;
    let wall: PropPlacement | null = null;
    const ok = kit.cluster(() => {
      wall = kit.put('skyMuCoverWall', c.x, c.z, rot, {area: c.a, y: y0});
      return !!wall;
    });
    if (!ok || !wall) continue;
    const w = wall as PropPlacement;
    w.mounted = true;
    kit.keepBox(fx - hx, fz - hz, fx + hx, fz + hz);
    const rows: PropPlacement[] = [];
    const used = new Set<number>();
    for (const ly of COVER_WALL.ledges) {
      let v = kit.rng.int(0, FACED_STYLES - 1);
      while (used.has(v) && used.size < FACED_STYLES) v = (v + 1) % FACED_STYLES;
      used.add(v);
      // the row stands on the ledge, between the board face and the lip (prop frame: board back at -d/2)
      const lz = r3(-COVER_WALL_DEPTH / 2 + COVER_WALL.t + COVER_WALL.ledgeD / 2);
      const p = kit.onTop(w, 'skyMuFacedRecords', 0, lz, ly);
      if (p) { p.variant = v; rows.push(p); }
    }
    return {wall: w, rows};
  }
  return null;
}

// =================================================================================================================================
// Record bins and their stock

/**
 * Double-sided island RUNS of `kind` (two rows back to back, `units` long) scanned over the floor (0.5 m grid, the deep floor first) so
 * they pack into aisles `aisle` m wide; a run along u faces +/-v, along v faces +/-u. Same scheme as the destinations pass (shopsA).
 */
function fillRuns(kit: AnchorKit, kind: PropKind, o: {units: [number, number]; aisle: number; max: number; orient: 'u' | 'v'}): PropPlacement[][] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[][] = [];
  if (o.max <= 0) return out;
  const along = o.orient === 'u';
  const pitch = Math.max(def.w + 0.02, (Math.floor((def.w - 0.04) / CELL) + 1) * CELL);
  const us: number[] = [], vs: number[] = [];
  for (let u = CELL; u <= fr.W - CELL; u += CELL) us.push(u);
  for (let v = 2.5; v <= fr.D - CELL; v += CELL) vs.push(v);
  if (kit.rng.chance(0.5)) us.reverse();
  vs.reverse();
  for (const v of vs) for (const u of us) {
    if (out.length >= o.max) return out;
    const n = kit.rng.int(o.units[0], o.units[1]);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (let k = 0; k < n; k++) {
        const side: PropPlacement[] = [];
        for (const s of [-1, 1]) {
          const t = k * pitch + def.w / 2;
          const [pu, pv] = along ? [u + t, v + s * def.d / 2] : [u + s * def.d / 2, v + t];
          const rot = along ? (s < 0 ? fr.toFront : fr.toBack) : (s < 0 ? fr.minusU : fr.plusU);
          const [x, z] = kit.uv(pu, pv);
          const p = kit.put(kind, x, z, rot, {front: o.aisle});
          if (p) side.push(p);
        }
        got.push(...side);
        if (side.length < 2) return k > 0;
      }
      return true;
    });
    if (ok) out.push(got);
  }
  return out;
}

/**
 * Stocks a rack: one skyMuBinRecords block in EVERY bay of both rows (variant = a filed block style of that row; neighbours differ),
 * hosted on the rack, standing on its measured tray floor (gen/skyways/stores/musicStock.ts). Returns the blocks.
 */
export function stockRack(kit: AnchorKit, rack: PropPlacement): PropPlacement[] {
  const out: PropPlacement[] = [];
  const q = Math.abs(Math.sin(rack.rot)) > 0.7;
  for (const row of [0, 1]) {
    let prev = -1;
    for (let col = 0; col < 6; col++) {
      let style = kit.rng.int(0, BIN_STYLES - 1);
      if (style === prev) style = (style + 1 + kit.rng.int(0, BIN_STYLES - 2)) % BIN_STYLES;
      prev = style;
      const variant = row * BIN_STYLES + style, f = binBlockFrame(variant, col);
      const p = kit.onTop(rack, 'skyMuBinRecords', f.x, f.z, f.y);
      if (!p) continue;
      p.variant = variant;
      p.hx = r3(q ? f.hz : f.hx);
      p.hz = r3(q ? f.hx : f.hz);
      p.h = f.h;
      out.push(p);
    }
  }
  return out;
}
/** The genre card on a rack's front apron (the apron's face at z 0.390, 0.33-0.51 m: measured). */
function binLabel(kit: AnchorKit, rack: PropPlacement, genre: number): void {
  const d = MUSIC_DIMS.binLabel;
  const p = kit.onTop(rack, 'skyMuBinLabel', 0, r3(0.39 + d.d / 2 + 0.001), 0.36);
  if (p) { p.variant = genre; p.mounted = true; }
}
/** Dig crates of records on the floor at a run's two ends (the racks' slopes have no flat top to stand a crate on). */
function digCrates(kit: AnchorKit, run: PropPlacement[]): void {
  const crate = PROP_DEFS.skyDRecordCrate;
  const x0 = Math.min(...run.map(p => p.x - p.hx)), x1 = Math.max(...run.map(p => p.x + p.hx));
  const z0 = Math.min(...run.map(p => p.z - p.hz)), z1 = Math.max(...run.map(p => p.z + p.hz));
  const alongX = x1 - x0 >= z1 - z0, mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
  for (const end of kit.rng.shuffle([-1, 1])) {
    const e = alongX ? (end < 0 ? x0 : x1) : (end < 0 ? z0 : z1);
    const c = end < 0 ? Math.floor((e - 0.04) / CELL) * CELL - crate.w / 2 - 0.02 : Math.ceil((e + 0.04) / CELL) * CELL + crate.w / 2 + 0.02;
    const rot = alongX ? (end < 0 ? -Math.PI / 2 : Math.PI / 2) : (end < 0 ? Math.PI : 0);
    for (const off of kit.rng.shuffle([-0.25, 0.25]).slice(0, kit.rng.int(1, 2))) {
      const [x, z] = alongX ? [c, mid + off] : [mid + off, c];
      kit.put('skyDRecordCrate', x, z, rot);
    }
  }
}

// =================================================================================================================================
// Wall art (posters / signs), shared helpers

/**
 * `n` wall-mounted pieces of `kind` (gig posters, the booths' sign) on solid sales-floor wall (never over glazing / windows / a door,
 * nothing standing in front), spread >= 2.4 m apart; `near`: nearest that point first (else shuffled). Returns the count placed.
 */
function wallArt(kit: AnchorKit, kind: 'skyMuGigPoster' | 'skyMuSign', y0: number, n: number, variant: (i: number) => number, near?: [number, number]): number {
  const s = kit.st(), def = PROP_DEFS[kind], y1 = y0 + def.h;
  const props = kit.layout.props.filter(p => (p.level ?? 0) === kit.level);
  const cands: {a: Area; side: Side; t: number; x: number; z: number}[] = [];
  for (const a of s.areas.filter(q => !kit.zones.includes(q))) for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.3 + def.w / 2; t <= hi - 0.3 - def.w / 2; t += 0.5) {
      if (!backed(s.ctx, a, side, t - def.w / 2, t + def.w / 2, s.base + y0 + 0.05) || !backed(s.ctx, a, side, t - def.w / 2, t + def.w / 2, s.base + y1 - 0.05)) continue;
      if (kit.windowAt(a, side, t - def.w / 2, t + def.w / 2, y1 + 0.1)) continue;
      const along = side === 'N' || side === 'S';
      const [fx, fz] = wallXZ(a, side, t, 0.4);
      const fhx = along ? def.w / 2 + 0.2 : 0.4, fhz = along ? 0.4 : def.w / 2 + 0.2;
      if (props.some(p => (p.y < y1 && p.y + p.h > y0 - 0.9) && Math.abs(p.x - fx) < p.hx + fhx && Math.abs(p.z - fz) < p.hz + fhz)) continue;
      const [cx, cy] = s.g.cellOf(...wallXZ(a, side, t, 0.25));
      if (!s.g.inBounds(cx, cy) || s.ctx.doorCell[s.g.idx(cx, cy)]) continue;
      const [x, z] = wallXZ(a, side, t, def.d / 2 + 0.004);
      cands.push({a, side, t, x, z});
    }
  }
  const order = near ? cands.sort((p, q) => Math.hypot(p.x - near[0], p.z - near[1]) - Math.hypot(q.x - near[0], q.z - near[1])) : kit.rng.shuffle(cands);
  let placed = 0;
  const at: [number, number][] = [];
  for (const c of order) {
    if (placed >= n) break;
    if (at.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 2.4) || kit.layout.props.some(p => p.mounted && (p.level ?? 0) === kit.level && Math.hypot(p.x - c.x, p.z - c.z) < 1.2 && p.y < y1 && p.y + p.h > y0)) continue;
    const rot = WALL_ROT[c.side], along = c.side === 'N' || c.side === 'S';
    kit.push({kind, x: r3(c.x), z: r3(c.z), y: r3(y0), rot, area: c.a.id, hx: r3(along ? def.w / 2 : def.d / 2), hz: r3(along ? def.d / 2 : def.w / 2), h: def.h, blocksSight: false, variant: variant(placed), mounted: true}, kit.level);
    at.push([c.x, c.z]);
    placed++;
  }
  return placed;
}
void DEST_POSTERS_OF;

/** Reserves the free floor round a group (its bounding box + margin). */
function reserveAround(kit: AnchorKit, ps: PropPlacement[], level: number, margin: number): void {
  if (!ps.length) return;
  const x0 = Math.min(...ps.map(p => p.x - p.hx)) - margin, x1 = Math.max(...ps.map(p => p.x + p.hx)) + margin;
  const z0 = Math.min(...ps.map(p => p.z - p.hz)) - margin, z1 = Math.max(...ps.map(p => p.z + p.hz)) + margin;
  kit.keepBox(x0, z0, x1, z1, level);
}

// =================================================================================================================================
// Back rooms

/**
 * A back room (stock room / office, already shelved by the station dresser): staff lockers, a supply cabinet (openable), open shelving
 * with crates of records on its tiers, lidded crates, a staff desk with its chair and a fridge where they fit; record crates stacked on
 * the floor along a wall. Placed through the shared primitive on the room's own context (door zones, swing strips, connectivity).
 * Returns what it added.
 */
function backRoom(kit: AnchorKit, a: Area): PropPlacement[] {
  const layout = kit.layout, level = a.level ?? 0, rng = kit.rng;
  const ctx = makePlaceCtx(layout, rng, level, {x0: a.x - 3, y0: a.y - 3, x1: a.x + a.w + 3, y1: a.y + a.h + 3});
  const added: PropPlacement[] = [];
  const add = (p: PropPlacement | null) => { if (p) { added.push(p); kit.placed.push(p); } return p; };
  const big = a.w * a.h * CELL * CELL >= 14;
  const office = a.type === 'agent-office';
  const storage = () => layout.props.filter(p => p.area === a.id && OPENABLE_STORAGE.has(p.kind)).length;
  if (!layout.props.some(p => p.area === a.id && p.kind === 'staffLockers')) add(againstWall(ctx, a, 'staffLockers', 0.6));
  add(againstWall(ctx, a, 'cabinetTall', 0.6));
  if (!office) {
    const sh = add(againstWall(ctx, a, 'shelf', 0.9));
    if (sh) for (const p of cratesOnShelf(kit, sh)) added.push(p);
    for (let i = 0, n = rng.int(1, 2); i < n; i++) add(againstWall(ctx, a, 'crate', 0));
    for (let i = 0, n = rng.int(2, 4); i < n; i++) add(placeAgainstWall(ctx, a, 'skyDRecordCrate', {tries: 16}));
  }
  if ((big || office) && !layout.props.some(p => p.area === a.id && (p.kind === 'desk' || p.kind === 'executiveDesk'))) {
    const d = add(againstWall(ctx, a, 'desk', 0.9));
    if (d) { const [cx, cz] = toWorld(d, 0, PROP_DEFS.desk.d / 2 + 0.3); add(tryPlaceProp(ctx, a, 'officeSwivelChair', cx, cz, normYaw(d.rot + Math.PI))); }
  }
  if (big && rng.chance(0.6) && !layout.props.some(p => p.area === a.id && p.kind === 'fridge')) add(againstWall(ctx, a, 'fridge', 0.6));
  // at least two pieces of openable storage in every back room: smaller lidded / door pieces where the tall ones did not fit
  for (const k of ['crate', 'footlocker', 'cabinetLow', 'crate'] as PropKind[]) if (storage() < 2) add(againstWall(ctx, a, k, k === 'cabinetLow' ? 0.6 : 0));
  if (storage() < 2) kit.skipped.push(`back room ${a.id}: ${storage()} openable storage`);
  if (!added.length) kit.skipped.push(`back room ${a.id}: nothing fits`);
  return added;
}
/** Openable storage kinds counted for a back room (existing openables / holders with moving parts). */
const OPENABLE_STORAGE: ReadonlySet<string> = new Set(['staffLockers', 'cabinetTall', 'cabinetLow', 'crate', 'footlocker', 'safe', 'filingCabinet', 'officeFiling', 'fridge', 'desk', 'executiveDesk', 'mallCashwrapCounter', 'storageTote', 'dresserDrawers']);
/** A prop with its back to a wall of the room: every wall position (0.25 m steps, shuffled) through the shared primitive. */
function againstWall(ctx: ReturnType<typeof makePlaceCtx>, a: Area, kind: PropKind, front: number): PropPlacement | null {
  const def = PROP_DEFS[kind], spots: {side: Side; t: number}[] = [], base = areaBase(ctx.layout, a);
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + 0.1 + def.w / 2; t <= hi - 0.1 - def.w / 2; t += 0.25) spots.push({side, t});
  }
  for (const {side, t} of ctx.rng.shuffle(spots)) {
    if (!backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + 0.05) || !backed(ctx, a, side, t - def.w / 2, t + def.w / 2, base + Math.min(def.h, 2.2) - 0.05)) continue;
    const s = wallSpot(a, side, t, kind);
    const p = tryPlaceProp(ctx, a, kind, s.x, s.z, s.rot, front ? {front} : {});
    if (p) return p;
  }
  return null;
}
/** Crates of records on an open shelving unit's tiers (two per tier; the shelf's loot surfaces give up their spans). */
function cratesOnShelf(kit: AnchorKit, sh: PropPlacement): PropPlacement[] {
  const def = PROP_DEFS.shelf, c = PROP_DEFS.skyDRecordCrate, out: PropPlacement[] = [];
  if (c.d > def.d - 0.02) return out;
  for (const i of [0, 1, 2]) {
    const y = SHELF_TIER_Y[i];
    if ((SHELF_TIER_Y[i + 1] ?? def.h) - y - 0.03 < c.h) continue;
    for (const lx of kit.rng.shuffle([-0.38, 0, 0.38]).slice(0, kit.rng.int(1, 2))) {
      const p = kit.onTop(sh, 'skyDRecordCrate', lx, r3(-def.d / 2 + 0.01 + c.d / 2), y);
      if (!p) continue;
      out.push(p);
      (sh.cut ??= []).push({y, x0: r3(lx - c.w / 2 - 0.02), x1: r3(lx + c.w / 2 + 0.02)});
    }
  }
  return out;
}
