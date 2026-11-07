// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): THE AURORA PICTURE HOUSE's layout-version-3 dresser — an old
// picture house in the multi-zone format (gen/skyways/carve.ts: a lobby band along the storefront, the AUDITORIUM behind it, back rooms
// beyond a flank or inset in a lobby corner). Placement through stores/cinemaKit.ts (regions: the lobby = the floor + its pieces).
//
//  LOBBY  - the entry spine and lanes to the auditorium doors and every staff door reserved first;
//         - the CONCESSION STAND on the roomier side of the auditorium doors: counter modules (a counter, the glass candy case, a counter)
//           facing the lobby with the popcorn machine and the till on top, behind them a staff aisle and the back units against the back
//           wall — the glass-door drinks cooler and the low cupboards (both open: openables), the back counter with its soda fountain —
//           the framed REFRESHMENTS board over them (Codex art), the snack rack at the run's end, the vintage popcorn cart out front;
//         - the BOX OFFICE: the art-deco ticket kiosk by the entry (its window toward the entry spine), a velvet-rope queue of movable
//           stanchions off its window and a hanging BOX OFFICE plate;
//         - NOW SHOWING poster cases (Codex posters) flanking the auditorium doors and on the side walls, freestanding poster stands, the
//           older coming-attractions bills (the destinations' cinema posters), lobby benches, a bin by the doors, the SCREEN 1 / STAFF
//           ONLY plates over the doors.
//  AUDITORIUM - the screen on the far wall (the door wall is the projection side), seat rows in blocks of up to three between a centre
//           aisle from the door, both side aisles and a back cross aisle (a few seats torn out), EXIT over the door, by the door the
//           fire-extinguisher cabinet / first-aid kit / a bin, an usher's cupboard (openable) by the screen.
//  BACK   - the stock room (the concession's dry stock: purpose mall-food-back) keeps the station dresser's shelving / cartons / crates and
//           gains flap-lid cartons and an ice-cream chest freezer; the staff side (an office when carved, else a corner of the stock room,
//           else behind the concession) gets the openable filing cabinet and staff lockers (office purpose on those holders).
//
// Loot (root CLAUDE.md rule 1, docs/loot-tables.md): EXISTING holder kinds only; rows from the store's purposes (stores/cinema.ts) plus
// per-holder keys (PropPlacement.purpose, the ramen precedent) where a holder belongs to another room's job. No floor piles.

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import {doorSide} from '../../placeKit';
import {hostTop} from '../../props07Dress';
import {stockVariant} from '../../purposeShapes';
import type {Area, SignPlacement, SignStyle, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {OPP, doorBetween} from '../addonFrame';
import {SKYD_SCREEN} from '../destinations/kindsShopsB';
import {DEST_POSTERS_OF} from '../destinations/art';
import {DEST_POSTER_BASE_Y} from '../destinations/kindsLandmarks';
import {CINEMA_CASE, CINEMA_MENU, CINEMA_POSTER_PIECES} from './cinemaArt';
import {CinemaKit, r3, type PutOpts, type Region, type RegionDoor, type Wall} from './cinemaKit';

/** The store's loot purposes (existing ids): concession lobby, auditorium (front of house / ushers), stock room, office. */
export const CINEMA_PURPOSES = {floor: 'mall-kiosk', zones: 'mall-customer-service', stock: 'mall-food-back', office: 'office-private'} as const;

/** The plates' house style: gold serif on deep red. */
export const CINEMA_SIGN_STYLE: SignStyle = {bg: 0x5a1520, fg: 0xe9c46a, accent: 0xc9a24a, font: 'serif'};

/** What one cinema got (tests / QA; rewritten by every generation, keyed by anchor id). */
export interface CinemaResult {
  props: PropPlacement[];
  skipped: string[];
  concession: PropPlacement[];
  booth: PropPlacement | null;
  queue: PropPlacement[];
  cases: PropPlacement[];
  staff: PropPlacement[];
  seats: number;
  signs: SignPlacement[];
  /** Region frames (tests: lanes / routes). */
  lobbyIds: number[];
}
export const CINEMA_LAST = new Map<string, CinemaResult>();

const snap = (v: number) => Math.round(v * 2) / 2;
const cellUp = (v: number) => Math.ceil(v / CELL - 1e-6) * CELL;
const cellDown = (v: number) => Math.floor(v / CELL + 1e-6) * CELL;
/** Wall to the back face of a counter run with `backD`-deep units against that wall: a >= 0.95 m staff aisle, cell-aligned. */
const counterBack = (backD: number): number => cellUp(0.03 + backD + 0.95);

/** Dresses one Aurora Picture House; returns the props placed. */
export function dressCinema(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const k = new CinemaKit(layout, rng, anchor);
  const res: CinemaResult = {props: [], skipped: k.skipped, concession: [], booth: null, queue: [], cases: [], staff: [], seats: 0, signs: [], lobbyIds: [...k.lobby.ids]};
  const s0 = layout.signs.length;
  const lobby = dressLobby(k, res);
  for (const z of anchor.zones) { const a = layout.areas[z]; if (a) dressAuditorium(k, a, res); }
  dressBackRooms(k, res, lobby);
  res.props = k.placed;
  res.signs = layout.signs.slice(s0);
  CINEMA_LAST.set(anchor.id, res);
  return k.count;
}

// ---------------------------------------------------------------------------------------------
// The lobby

interface LobbyPlan { concession: {side: -1 | 1; u0: number; u1: number; outer: number} | null }

function dressLobby(k: CinemaKit, res: CinemaResult): LobbyPlan {
  const L = k.lobby, an = k.anchor, W = L.fr.W, D = L.fr.D;
  k.settleDoors(L);
  const audDoors = L.doors.filter(d => an.zones.includes(d.to));
  const staffDoors = L.doors.filter(d => !an.zones.includes(d.to));
  const aud = audDoors[0] ?? null;
  const du = aud?.u ?? W / 2, dHalf = aud?.half ?? 1.0;
  const cd = PROP_DEFS.shopCounter.d;
  const cv = r3(D - counterBack(PROP_DEFS.cabinetLow.d) - cd / 2);
  const vMid = r3(Math.max(1.3, Math.min(2.2, cv - cd / 2 - 0.8)));
  // --- lanes: the entry spine, the walk to the auditorium doors (wide) and to every staff door
  const spine = Math.max(0.75, Math.min(1.1, k.entryHalf));
  k.keepUV(L, k.entryU, 0, k.entryU, vMid, spine);
  for (const d of audDoors) k.laneToDoor(L, k.entryU, 0, vMid, d, Math.min(1.0, d.half));
  for (const d of staffDoors) k.laneToDoor(L, k.entryU, 0, vMid, d, 0.75);
  // --- the concession stand (the roomier side of the auditorium doors first)
  const plan: LobbyPlan = {concession: null};
  const spans = ([-1, 1] as const).map(s => ({s, span: backSpan(k, L, du + s * (dHalf + 1.1), s)})).sort((p, q) => (q.span[1] - q.span[0]) - (p.span[1] - p.span[0]));
  for (const {s, span} of spans) { if ((plan.concession = concession(k, L, res, s, span, cv))) break; }
  if (!plan.concession) k.skipped.push('concession');
  // --- the box office by the entry, on the side away from the walk to the auditorium (its window toward the entry spine)
  const bDir: -1 | 1 = du >= k.entryU ? -1 : 1;
  res.booth = boxOffice(k, L, res, bDir, spine) ?? boxOffice(k, L, res, (-bDir) as -1 | 1, spine);
  if (!res.booth) k.skipped.push('box office');
  // --- NOW SHOWING poster cases: flanking the auditorium doors, then the side walls, then the back wall
  const first = k.rng.int(0, CINEMA_POSTER_PIECES.length - 1);
  const caseAt = (w: Wall, t: number) => {
    if (res.cases.length >= 6 || res.cases.some(p => Math.hypot(...xzDelta(k, L, p, w, t)) < 1.2)) return;
    const p = k.mount(L, w, r3(t), 'storeCinemaPosterCase', CINEMA_CASE.y, (first + res.cases.length) % CINEMA_POSTER_PIECES.length);
    if (p) res.cases.push(p);
  };
  for (const d of audDoors) for (const s of [-1, 1]) caseAt('B', d.u + s * (d.half + 0.75));
  for (const w of ['L', 'R'] as const) for (const t of [D / 2, D / 2 - 1.1, D / 2 + 1.1]) caseAt(w, t);
  for (let t = 0.8; t < W - 0.8; t += 1.0) caseAt('B', t);
  if (res.cases.length < 2) k.skipped.push(`poster cases (${res.cases.length})`);
  // --- poster stands: one inside the entry beside the spine, one by the auditorium doors (both facing the storefront)
  const stands = [[k.entryU + (bDir > 0 ? -1 : 1) * (spine + 0.75), 1.0], [du - (plan.concession?.side ?? 1) * (dHalf + 1.3), D - 1.4]] as const;
  let nStands = 0;
  for (const [u, v] of stands) if (nearest(k, L, 'storeCinemaPosterStand', u, v, 1.6, L.fr.toFront, {ring: 0.3, variant: (first + 2 + nStands) % CINEMA_POSTER_PIECES.length})) nStands++;
  if (!nStands) k.skipped.push('poster stand');
  // --- lobby benches against the side walls (else the back wall), facing in
  let benches = 0;
  for (const w of ['L', 'R', 'B'] as const) {
    if (benches >= 2) break;
    const len = w === 'B' ? W : D;
    for (let t = w === 'B' ? 1.0 : 1.2; t + PROP_DEFS.bench.w <= len - 0.6 && benches < 2; t += 0.5) {
      if (k.atWall(L, w, r3(t + PROP_DEFS.bench.w / 2), 'bench', {front: 0.6})) { benches++; break; }
    }
  }
  if (!benches) k.skipped.push('benches');
  // --- a bin by the auditorium doors; the coming-attractions bills on what wall is left
  if (aud) for (const s of [1, -1]) if (k.put(L, 'bin', r3(du + s * (dHalf + 0.45)), r3(D - PROP_DEFS.bin.d / 2 - 0.03), L.fr.toFront, {zoneOk: true})) break;
  const bills = DEST_POSTERS_OF.cinema;
  let nb = 0;
  for (const w of ['L', 'R', 'B'] as const) for (let t = 0.6; t < (w === 'B' ? W : D) - 0.6 && nb < 2; t += 0.75) {
    const [u, v] = w === 'B' ? [t, D] : [w === 'L' ? 0 : W, t];
    if ([...res.cases, ...k.placed.filter(p => p.kind === 'skyDPoster')].some(p => { const [pu, pv] = k.uv(L, p.x, p.z); return Math.hypot(pu - u, pv - v) < 1.6; })) continue;
    if (k.mount(L, w, r3(t), 'skyDPoster', DEST_POSTER_BASE_Y, bills[nb % bills.length])) nb++;
  }
  // --- plates: SCREEN 1 over the auditorium doors, STAFF ONLY over the staff doors (the lobby side)
  for (const d of audDoors) doorPlate(k, L, d, {kind: 'info', text: audDoors.length > 1 ? `SCREEN ${audDoors.indexOf(d) + 1}` : 'SCREEN 1', w: 1.6, style: CINEMA_SIGN_STYLE});
  for (const d of staffDoors) doorPlate(k, L, d, {kind: 'service', text: 'STAFF ONLY'});
  return plan;
}

/** World offset between a placed prop and a frame wall spot (spacing checks). */
function xzDelta(k: CinemaKit, rg: Region, p: PropPlacement, w: Wall, t: number): [number, number] {
  const fr = rg.fr, [u, v] = w === 'L' ? [0, t] : w === 'R' ? [fr.W, t] : w === 'B' ? [t, fr.D] : [t, 0];
  const [x, z] = k.xz(rg, u, v);
  return [p.x - x, p.z - z];
}

/** The free back-wall span (u0, u1) of the lobby from `from` outward in direction `s` (lobby cells against the back wall). */
function backSpan(k: CinemaKit, L: Region, from: number, s: -1 | 1): [number, number] {
  const W = L.fr.W, D = L.fr.D;
  let a = from, b = from;
  const ok = (u: number) => { const [x, z] = k.xz(L, u, D - 0.25); return !!k.areaAt(L, x, z); };
  if (!ok(from)) return [from, from];
  for (let u = from; u > 0 && u < W && ok(u); u += s * CELL) { if (s < 0) a = u; else b = u; }
  return s < 0 ? [cellDown(a - CELL / 2), from] : [from, cellUp(b + CELL / 2)];
}

/**
 * The concession run on side `s` of the auditorium doors within the back-wall span: counter modules facing the lobby at depth `cv`, the
 * back units against the back wall behind them (the drinks cooler and the cupboards required, the back counter when it fits), the till /
 * popcorn machine / soda fountain on top, the REFRESHMENTS board over the back units, the snack rack and the popcorn cart out front.
 */
function concession(k: CinemaKit, L: Region, res: CinemaResult, s: -1 | 1, span: [number, number], cv: number): LobbyPlan['concession'] {
  const runs: PropKind[][] = [['shopCounter', 'shopDisplay', 'shopCounter'], ['shopCounter', 'shopDisplay'], ['shopCounter', 'shopCounter'], ['shopCounter']];
  for (const mods of runs) {
    const runW = mods.reduce((t, m) => t + PROP_DEFS[m].w, 0);
    if (span[1] - span[0] < runW + 0.3) continue;
    // the run sits next to the auditorium doors (the near end of the span), cell-aligned
    const u0 = s < 0 ? cellDown(span[1] - runW) : cellUp(span[0]), u1 = u0 + runW;
    const outer = s < 0 ? u0 : u1;
    let got: LobbyPlan['concession'] = null;
    k.tx(() => {
      const out: PropPlacement[] = [];
      let u = u0;
      for (const m of mods) {
        const p = k.put(L, m, u + PROP_DEFS[m].w / 2, cv, L.fr.toFront, {front: 0.9});
        if (!p) return false;
        out.push(p);
        u += PROP_DEFS[m].w;
      }
      // back units behind the run (each once, outer end first): cooler + cupboards required, the back counter if it fits
      const back = (kind: PropKind, from: number, to: number) => { for (let t = from; t + PROP_DEFS[kind].w <= to + 1e-6; t += CELL) { const p = k.atWall(L, 'B', r3(t + PROP_DEFS[kind].w / 2), kind); if (p) return p; } return null; };
      const lo = Math.max(span[0], u0 - 0.9), hi = Math.min(span[1], u1 + 0.9);
      const units: PropPlacement[] = [];
      const order: PropKind[] = s < 0 ? ['shopCooler', 'cabinetLow', 'shopBackbar'] : ['shopBackbar', 'cabinetLow', 'shopCooler'];
      let cursor = lo;
      for (const kind of order) {
        const p = back(kind, cursor, hi);
        if (p) { units.push(p); cursor = k.uv(L, p.x, p.z)[0] + PROP_DEFS[kind].w / 2 + 0.04; }
      }
      if (!units.some(p => p.kind === 'shopCooler') || !units.some(p => p.kind === 'cabinetLow')) return false;
      out.push(...units);
      // on top: the till by the doors' end, the popcorn machine at the outer end; the soda fountain on the back counter, the hot-dog
      // roller on the cupboards
      // (counters sorted from the outer end to the doors' end)
      const counters = out.filter(p => p.kind === 'shopCounter').sort((p, q) => s * (k.uv(L, q.x, q.z)[0] - k.uv(L, p.x, p.z)[0]));
      const top = hostTop('shopCounter');
      if (top && counters.length) {
        const near = counters[counters.length - 1], far = counters[0];
        // host-local x of the end toward frame direction `du` (+1 = +u): the frames differ in handedness, so measure it
        const endX = (host: PropPlacement, dir: number, half: number) => {
          const [wx, wz] = [host.x + Math.cos(host.rot) * 1, host.z - Math.sin(host.rot) * 1], xs = Math.sign(k.uv(L, wx, wz)[0] - k.uv(L, host.x, host.z)[0]) || 1;
          return r3(dir * xs > 0 ? top.x1 - half : top.x0 + half);
        };
        const r = k.onTop(near, 'cashRegister', endX(near, -s, PROP_DEFS.cashRegister.w / 2 + 0.06), 0, top.y);
        if (r) out.push(r);
        const pm = k.onTop(far, 'popcornMachine', endX(far, s, PROP_DEFS.popcornMachine.w / 2 + 0.06), 0, top.y);
        if (pm) out.push(pm);
      }
      const bb = units.find(p => p.kind === 'shopBackbar'), bt = hostTop('shopBackbar');
      if (bb && bt) { const f = k.onTop(bb, 'sodaFountain', 0, 0, bt.y); if (f) out.push(f); }
      const cl = units.find(p => p.kind === 'cabinetLow');
      if (cl) { const h = k.onTop(cl, 'hotDogRoller', r3(-0.45), 0, PROP_DEFS.cabinetLow.h); if (h) out.push(h); }
      // the REFRESHMENTS board over the back units (centred on them, else slid along)
      const us = units.map(p => k.uv(L, p.x, p.z)[0]), mid = (Math.min(...us) + Math.max(...us)) / 2;
      for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) { const mb = k.mount(L, 'B', r3(snap(mid + off)), 'storeCinemaMenuBoard', CINEMA_MENU.y); if (mb) { out.push(mb); break; } }
      res.concession = out;
      got = {side: s, u0, u1, outer};
      return true;
    });
    if (got) {
      // the snack rack at the run's outer end (customer side), the vintage popcorn cart out on the lobby floor near it
      const sr = k.put(L, 'snackRack', r3(outer - s * (PROP_DEFS.snackRack.w / 2 + 0.15)), cv, L.fr.toFront);
      if (sr) res.concession.push(sr); else k.skipped.push('snack rack');
      const pc = nearest(k, L, 'skyDPopcornCart', outer - s * 1.4, cv - 1.5, 2.0, L.fr.toFront, {ring: 0.3});
      if (pc) res.concession.push(pc); else k.skipped.push('popcorn cart');
      return got;
    }
  }
  return null;
}

/** The ticket kiosk on side `dir` of the entry spine, its window toward it, and the rope queue off the window. */
function boxOffice(k: CinemaKit, L: Region, res: CinemaResult, dir: -1 | 1, spine: number): PropPlacement | null {
  const bk = PROP_DEFS.skyDTicketBooth, yaw = dir < 0 ? L.fr.plusU : L.fr.minusU;
  const bv = r3(0.5 + bk.w / 2);
  for (let off = 1.6; off <= 4.6; off += 0.5) {
    const bu = r3(snap(k.entryU + dir * (spine + off + bk.d / 2)));
    if (bu - bk.d / 2 < 0.4 || bu + bk.d / 2 > L.fr.W - 0.4) break;
    const booth = k.put(L, 'skyDTicketBooth', bu, bv, yaw);
    if (!booth) continue;
    // the queue: two rows of rope posts from the window toward the spine (only on free floor: the spine stays open)
    const face = bu - dir * bk.d / 2;
    for (const dv of [-0.6, 0.6]) for (let q = 0; q < 3; q++) {
      const pu = r3(face - dir * (0.45 + q * 0.8));
      if (Math.abs(pu - k.entryU) < spine + 0.2) break;
      const p = k.putRound(L, 'skywaysPrizeStanchion', pu, r3(bv + dv), 0);
      if (p) res.queue.push(p);
    }
    // the hanging plate over the kiosk
    const [x, z] = k.xz(L, bu, bv), a = k.areaAt(L, x, z);
    if (a) k.layout.signs.push({x, y: r3(L.base + Math.min(bk.h + 0.45, (a.ceil - L.base) - 0.5)), z, rot: L.fr.toFront, kind: 'info', text: 'BOX OFFICE', area: a.id, hang: true, w: 1.5,
      style: CINEMA_SIGN_STYLE, ...(k.level ? {level: k.level} : {})});
    return booth;
  }
  return null;
}

/** A plate over a door on the region's side (above the opening when there is room, else beside it). */
function doorPlate(k: CinemaKit, rg: Region, d: RegionDoor, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>): void {
  const a = k.layout.areas[[...rg.ids][0]];
  const top = d.d.height + 0.32, ceil = (a?.ceil ?? rg.base + 4) - rg.base;
  if (ceil - top >= 0.22) k.doorSign(rg, d, r3(top), s);
}

/** The free spot of the region nearest frame point (cu, cv) (within `reach` m) that takes `kind`; null when none. */
function nearest(k: CinemaKit, rg: Region, kind: PropKind, cu: number, cv: number, reach: number, yaw: number, o: PutOpts = {}): PropPlacement | null {
  const spots: [number, number][] = [];
  for (let du = -reach; du <= reach + 1e-6; du += 0.5) for (let dv = -reach; dv <= reach + 1e-6; dv += 0.5) spots.push([snap(cu) + du, snap(cv) + dv]);
  spots.sort((a, b) => Math.hypot(a[0] - cu, a[1] - cv) - Math.hypot(b[0] - cu, b[1] - cv));
  for (const [u, v] of spots) { if (u < 0.3 || v < 0.3 || u > rg.fr.W - 0.3 || v > rg.fr.D - 0.3) continue; const p = k.put(rg, kind, u, v, yaw, o); if (p) return p; }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The auditorium

/** How many `w` blocks fit a span in groups of <= 3 with 1.2 m aisles between groups; the group sizes. */
function seatGroups(span: number, w: number): number[] {
  for (let n = Math.floor(span / w); n > 0; n--) {
    const g = Math.ceil(n / 3);
    if (n * w + (g - 1) * 1.2 <= span + 1e-6) return Array.from({length: g}, (_, i) => (i < g - 1 ? 3 : n - 3 * (g - 1)));
  }
  return [];
}

function dressAuditorium(k: CinemaKit, aud: Area, res: CinemaResult): void {
  const door = doorBetween(k.layout, k.anchor.floor, aud.id) ?? k.layout.doors.find(d => (d.a === aud.id || d.b === aud.id) && k.lobby.ids.has(d.a === aud.id ? d.b : d.a));
  if (!door) { k.skipped.push('auditorium door'); return; }
  // the screen on the FAR wall, facing the lobby door (the door wall is the projection side)
  const A = k.region('auditorium', [aud.id], OPP[doorSide(door, aud)]);
  k.settleDoors(A);
  const W = A.fr.W, D = A.fr.D, clear = aud.ceil - A.base;
  const sy = Math.max(SKYD_SCREEN.minY, Math.min(SKYD_SCREEN.y, clear - (SKYD_SCREEN.h + 2 * SKYD_SCREEN.border) - SKYD_SCREEN.ceilGap));
  let screen: PropPlacement | null = null;
  for (let i = 0; i < 25 && !screen; i++) screen = k.mount(A, 'F', r3(W / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5), 'skyDCinemaScreen', r3(sy));
  if (!screen) k.skipped.push('screen');
  const dr = A.doors.find(d => k.lobby.ids.has(d.to)) ?? A.doors[0];
  const du = dr?.u ?? W / 2, dh = dr?.half ?? 1;
  // by the door (the back wall, before the aisles are reserved): a bin, the fire-extinguisher cabinet (low wall cabinet: from the floor,
  // drawn `lift` up like the generated kit's low mounts), the first-aid kit; the usher's cupboard by the screen
  for (const s of [-1, 1]) if (k.atWall(A, 'B', r3(du + s * (dh + 0.45)), 'bin', {zoneOk: true})) break;
  for (const s of [1, -1]) {
    const fe = k.atWall(A, 'B', r3(du + s * (dh + 1.2)), 'fireExtinguisherCabinet', {front: 0.6, zoneOk: true});
    if (fe) { fe.lift = 0.6; fe.h = r3(0.6 + PROP_DEFS.fireExtinguisherCabinet.h); break; }
  }
  for (const s of [-1, 1]) if (k.mount(A, 'B', r3(du + s * (dh + 1.3)), 'firstAidWallKit', 1.3)) break;
  for (const w of ['L', 'R'] as const) if (k.atWall(A, w, r3(0.4 + PROP_DEFS.cabinetLow.w / 2), 'cabinetLow', {front: 0.6})) break;
  // the aisles: both side aisles, a centre aisle from the door to the front, a back cross aisle
  const SIDE = 1.1, BACK = 1.4;
  k.keepUV(A, SIDE / 2, 2.4, SIDE / 2, D - 0.4, SIDE / 2);
  k.keepUV(A, W - SIDE / 2, 2.4, W - SIDE / 2, D - 0.4, SIDE / 2);
  k.keepUV(A, du, D, du, 2.4, 0.7);
  k.keepUV(A, 0, D - BACK / 2, W, D - BACK / 2, BACK / 2);
  // seat rows: from 3 m off the screen to the back aisle, groups of up to three 4-seat blocks between the aisles; a few torn out
  const sd = PROP_DEFS.skyDCinemaSeats.d, swd = PROP_DEFS.skyDCinemaSeats.w;
  for (let v = 3.0; v + sd <= D - BACK + 1e-6; v += 1.05) {
    for (const [a, b] of [[SIDE, du - 0.75], [du + 0.75, W - SIDE]] as const) {
      const groups = seatGroups(b - a, swd);
      const total = groups.reduce((t, q) => t + q, 0) * swd + Math.max(0, groups.length - 1) * 1.2;
      let u = a + (b - a - total) / 2;
      for (const n of groups) {
        let items: {kind: PropKind; x: number; z: number; rot: number}[] = [];
        for (let i = 0; i < n; i++) {
          if (k.rng.chance(0.06)) { res.seats += k.putRow(A, items).length; items = []; continue; } // torn out
          const [x, z] = k.xz(A, u + swd / 2 + i * swd, v + sd / 2);
          items.push({kind: 'skyDCinemaSeats', x, z, rot: A.fr.toFront});
        }
        res.seats += k.putRow(A, items).length;
        u += n * swd + 1.2;
      }
    }
  }
  if (!res.seats) k.skipped.push('seat rows');
  // EXIT over the door, inside
  if (dr) doorPlate(k, A, dr, {kind: 'exit', text: 'EXIT'});
}

// ---------------------------------------------------------------------------------------------
// Back of house

/**
 * The back rooms: the stock room gains flap-lid cartons and an ice-cream chest freezer; the staff side (the office when carved, else the
 * stock room, else a corner behind the concession) gets the openable filing cabinet and staff lockers on the office purpose.
 */
function dressBackRooms(k: CinemaKit, res: CinemaResult, plan: LobbyPlan): void {
  const an = k.anchor;
  const rooms = an.stock.map(id => k.layout.areas[id]).filter((a): a is Area => !!a);
  const regions = rooms.map(a => {
    const d = k.layout.doors.find(q => (q.a === a.id || q.b === a.id) && q.staff);
    const rg = k.region(a.type, [a.id], d ? doorSide(d, a) : 'N');
    k.settleDoors(rg);
    return {a, rg};
  });
  const office = regions.find(r => r.a.type !== 'stock-room'), stock = regions.find(r => r.a.type === 'stock-room');
  const walls: Wall[] = ['B', 'L', 'R', 'F'];
  /** Along any wall of a back room (the door wall last). */
  const anyWall = (rg: Region, kind: PropKind, o: PutOpts = {}): PropPlacement | null => {
    for (const w of walls) {
      const len = w === 'L' || w === 'R' ? rg.fr.D : rg.fr.W;
      for (let t = 0.1; t + PROP_DEFS[kind].w <= len - 0.1 + 1e-6; t += CELL) { const p = k.atWall(rg, w, r3(t + PROP_DEFS[kind].w / 2), kind, o); if (p) return p; }
    }
    return null;
  };
  if (stock) {
    const fz = anyWall(stock.rg, 'chestFreezer');
    if (!fz) k.skipped.push('stock chest freezer');
    for (let i = 0; i < 2; i++) anyWall(stock.rg, 'cardboardBoxFlaps');
  }
  // the staff side: the office first, else the stock room (office purpose on these holders there)
  const staffIn = (r: {a: Area; rg: Region} | undefined, purpose?: string) => {
    if (!r) return;
    const o = purpose ? {purpose} : {};
    for (const kind of ['filingCabinet', 'staffLockers'] as PropKind[]) {
      if (res.staff.some(p => p.kind === kind)) continue;
      const p = anyWall(r.rg, kind, o);
      if (p) res.staff.push(p);
    }
  };
  staffIn(office);
  staffIn(stock, CINEMA_PURPOSES.office);
  // still missing: a staff corner behind the concession (the back wall beyond the run's outer end)
  if (plan.concession && res.staff.length < 2) {
    const L = k.lobby, c = plan.concession;
    for (const kind of ['filingCabinet', 'staffLockers'] as PropKind[]) {
      if (res.staff.some(p => p.kind === kind)) continue;
      for (let t = 0; t < 3.5; t += CELL) {
        const u = c.outer - c.side * (t + PROP_DEFS[kind].w / 2 + 0.1);
        const p = k.atWall(L, 'B', r3(u), kind, {purpose: CINEMA_PURPOSES.office});
        if (p) { res.staff.push(p); break; }
      }
    }
  }
  if (!res.staff.some(p => p.kind === 'filingCabinet')) k.skipped.push('filing cabinet');
  if (!res.staff.some(p => p.kind === 'staffLockers')) k.skipped.push('staff lockers');
  void stockVariant;
}
