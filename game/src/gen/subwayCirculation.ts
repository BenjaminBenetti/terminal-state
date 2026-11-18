// Task studio-subway-vertical-layout-20261118-022131-01: THE SUBWAY'S LAYOUT-VERSION-4 CIRCULATION PLANS (pure data, no three.js).
//
// User: "Prioritize real differences in floorplans and vertical circulation between stations and within families: how platforms, exits,
// concourses and side spaces connect, not just how many rooms are stacked ... Keep some compact/current plans and let other stations gain
// different levels, loops, landings, overlook connections or branches where they fit. Make added areas reachable, legible and useful."
//
// Version 4 keeps version 3's family / identity / skeleton rolls exactly and adds, per seed on its own salt, a CIRCULATION PLAN that is
// carved right after the skeleton (before the exits, the agent office, washrooms, storefronts and back-of-house grow round it):
//  - COMPACT: nothing — the station is its version-3 layout byte for byte (no generator stream is drawn);
//  - GALLERY: a large main-level concourse or ticket hall (never the food court / an arcade / a version-3 great hall) becomes DOUBLE HEIGHT
//    (its ceiling at the upper concourse's ceiling) with an upper OVERLOOK GALLERY along one long wall at the deck level (the station's
//    upper level floor, so its open edge is an aperture: railed like the light wells). An open stair (capped open well + balustrades, the
//    Mall / Market rule) climbs to it from the hall floor: a GRAND STAIR straight down from the gallery's edge into a deep hall, or a BANK
//    along the gallery's edge in a long one. Where a platform's deck faces the gallery across rock, a GALLERY BRIDGE joins them through the
//    platform's back wall: platform -> passage -> hall -> gallery -> bridge -> deck -> core -> platform is a new loop. Doorway lanes into
//    the hall stay clear of the stair, and both its ends open onto the hall floor;
//  - UNDERPASS: a lit public PEDESTRIAN SUBWAY at the far end of the platforms from the stair cores — a stair down behind each platform's
//    back wall to one passage on the service level crossing beneath both platforms and the track bed: the platforms connect at both ends
//    (crossover bridges at the cores' end, the subway at the other). Plant rooms open off it (staff doors), and a service tunnel may join
//    it to the existing service gallery (a loop through the service level);
//  - GALLERY + UNDERPASS: both, where both fit.
// A plan that does not fit a station falls back (both -> one -> compact) deterministically; every check runs before anything is carved.
// Draws: the circulation fork only (rng.fork('circulation-v4') of the attempt's stream: the main stream is never drawn here).
// New areas are on the station's existing level grids (upper = the deck level `hu`, lower = the service level), so the stacked-level
// rules (gen/levelGen.ts levelIssues), the dresser (every area by type on its own level), spawns and the light field treat them like the
// decks and the service crossing. Their stair runs are LevelPlan.runs (one LevelLink each, appended after the cores').

import {Rng, hashString} from '../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from './grid';
import {Levels} from './levels';
import {CORE, LEVEL_LOWER, LEVEL_MAIN, LEVEL_UPPER, LOWER_CEIL, LOWER_FLOOR, SLAB, type LevelPlan} from './levelGen';
import {STAIR, layStairRun, planStairs, stairRunCells, type StairFlight, type StairSpec} from './traversal';
import type {Kit} from './stationKit';
import type {Plan} from './archetypes';
import type {Area, Door, RailRun, Rect, SignPlacement, StationLayout} from './stationTypes';

// ---------------------------------------------------------------------------------------------
// The roll

/** A version-4 station's circulation plan. */
export type CirculationPlan = 'compact' | 'gallery' | 'underpass' | 'gallery+underpass';
/** Version 4's weights (about a third stay compact). */
export const CIRCULATION_WEIGHTS: readonly (readonly [CirculationPlan, number])[] = [['compact', 0.32], ['gallery', 0.28], ['underpass', 0.24], ['gallery+underpass', 0.16]];

/** The circulation plan a seed rolls (its own salt: no family / identity / generation draw moves). */
export function circulationOf(seed: number): CirculationPlan {
  return new Rng(hashString('subway-circulation-v4', seed >>> 0)).weighted(CIRCULATION_WEIGHTS as [CirculationPlan, number][]);
}

/** What a carved plan records (LevelPlan.circ; area ids only, so the crop / the track extensions never need to move it). */
export interface CirculationRec {
  /** What was carved, and what the seed rolled. */
  plan: CirculationPlan;
  rolled: CirculationPlan;
  gallery?: {host: number; gallery: number; stair: number; bridge: number; deck: number};
  underpass?: {subway: number; lobbies: number[]; stairs: number[]; platforms: number[]; rooms: number[]; tunnel: number};
  notes: string[];
}

/** One stair run between two levels outside the stair cores (one LevelLink each; `open`: an open bank in a hall, railed). */
export interface PlanRun { lower: number; upper: number; area: number; flights: number[]; open?: boolean }

// ---------------------------------------------------------------------------------------------
// Dimensions (cells unless noted)

export const CIRC = {
  /** Gallery depth (cells) and the double-height floor a parallel bank must leave in front of it. */
  galleryDepth: [5, 7] as const, hallClear: 7,
  /** Gallery length as a share of the hall (min cells). */
  galleryShare: [0.45, 0.7] as const, galleryMin: 28,
  /** The open stair bank: width (cells), its flat top lead (m), doorway lanes kept clear in front of the hall's doors (cells). */
  bankW: 4, bankLead: 1.5, doorLane: 4,
  /** A grand stair's clear floor in front of its foot, a parallel bank's clear floor beyond each end (cells). */
  footClear: 8, bankEnd: 5,
  /** The gallery bridge: width (cells). */
  bridgeW: [6, 8] as const,
  /** Pedestrian subway: width (cells); its lobbies / runs use the stair core's dimensions (gen/levelGen.ts CORE). */
  subwayW: 8,
  /** Subway placement: kept this far (cells) from the platform ends and from the cores' footprint. */
  endInset: 6, coreGap: 10,
  /** Plant rooms off the subway (cells). */
  roomW: [9, 12] as const, roomD: [7, 10] as const,
} as const;
/** Open stair bank headroom: capped by the hall's ceiling (Ramp.capCeil), the Market / Skyways open-well rule. */
export const OPEN_HEADROOM = 40;

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------------------------
// The pass

/**
 * Carves a version-4 station's circulation plan into the kit right after its skeleton (null: the station has no level program, nothing
 * carved). Records it in `k.levelPlan.circ` (only when something was carved) and the extra stair runs in `k.levelPlan.runs`.
 */
export function carveCirculation(k: Kit, plan: Plan, rolled: CirculationPlan, rng: Rng): CirculationRec | null {
  const lp = k.levelPlan;
  if (!lp) return null;
  const rec: CirculationRec = {plan: 'compact', rolled, notes: []};
  if (rolled === 'compact') return rec;
  const wantG = rolled === 'gallery' || rolled === 'gallery+underpass';
  const wantU = rolled === 'underpass' || rolled === 'gallery+underpass';
  // The gallery is planned and carved first, then the subway is planned on what is left (every check of a plan runs before it carves).
  const gf = rng.fork('gallery'), uf = rng.fork('underpass');
  let g = false, u = false;
  if (wantG) { const p = planGallery(k, plan, lp, gf); if (p) { applyGallery(k, lp, p, rec); g = true; } else rec.notes.push('gallery:no-fit'); }
  if (wantU || (wantG && !g)) { const p = planUnderpass(k, plan, lp); if (p) { applyUnderpass(k, lp, p, rec, uf); u = true; } else rec.notes.push('underpass:no-fit'); }
  // (a lone gallery roll that did not fit falls back to the subway: the station still gains its plan where one fits)
  rec.plan = g && u ? 'gallery+underpass' : g ? 'gallery' : u ? 'underpass' : 'compact';
  // (recorded only when something was carved: a station that keeps the compact plan is its version-3 layout byte for byte)
  if (rec.plan !== 'compact') lp.circ = rec;
  return rec;
}

// ---------------------------------------------------------------------------------------------
// GALLERY

type Wall = 'N' | 'S';
interface GalleryPlan {
  H: Area;
  /** The long wall the gallery runs along, the gallery strip (upper), the open stair bank (main + upper), its axis and top (lead) end. */
  side: Wall; gal: Rect; bank: Rect; axis: 'x' | 'z'; top: 'lo' | 'hi';
  /** The gallery bridge from a platform's deck (upper) — its platform, deck and the main-level rock kept under it — or null. */
  bridge: {r: Rect; P: Area; deck: Area; rock: number[]; wallRow: number} | null;
  hu: number; uc: number;
}

/** Doors touching an area's rect (on its own level), with the wall side they are on. */
function doorsOn(k: Kit, A: Area): {d: Door; side: 'N' | 'S' | 'W' | 'E'}[] {
  const out: {d: Door; side: 'N' | 'S' | 'W' | 'E'}[] = [];
  for (const d of k.doors) {
    if ((d.level ?? 0) !== (A.level ?? 0) || (d.a !== A.id && d.b !== A.id)) continue;
    const side = d.y === A.y - 1 ? 'N' : d.y === A.y + A.h ? 'S' : d.x === A.x - 1 ? 'W' : d.x === A.x + A.w ? 'E' : null;
    if (side) out.push({d, side});
  }
  return out;
}

/** Main-level halls that can take a gallery: concourses / ticket halls long along X, not a sectioned great hall or an extension. */
function galleryHosts(k: Kit, runL: number): Area[] {
  return k.areas.filter(a => !a.level && a.kind === 'concourse' && (a.type === 'concourse' || a.type === 'fare-hall') && a.publicSpace
    && !a.hallSection && !a.ext && a.role !== 'grotto' && a.w >= a.h && a.w >= Math.max(CIRC.galleryMin, CIRC.bankW + 2 * CIRC.doorLane + 6)
    && a.h >= CIRC.galleryDepth[0] + Math.min(CIRC.bankW + CIRC.hallClear, runL + CIRC.footClear) && a.w >= CIRC.bankW + 12);
}

function planGallery(k: Kit, plan: Plan, lp: LevelPlan, rng: Rng): GalleryPlan | null {
  const blk = plan.blocks[0];
  if (!blk || blk.kind !== 'side') return null;
  const G0 = k.grid(LEVEL_MAIN), GU = k.grid(LEVEL_UPPER);
  const hu = lp.hu, uc = lp.upperCeil, slabTop = r2(hu - SLAB);
  const spec: StairSpec = {...STAIR, headroom: OPEN_HEADROOM};
  const runL = Math.ceil((planStairs(hu, spec).length + CIRC.bankLead) / CELL - 1e-6);
  const lead = Math.ceil(CIRC.bankLead / CELL);
  const deckOf = (P: Area) => lp.decks.map(id => k.areas[id]).find(D => D.parent === P.id) ?? null;
  // Hosts: halls facing a platform across rock first (a bridge from its deck can land on the gallery), then the largest.
  const facing = (H: Area): {P: Area; wall: Wall; band: [number, number]} | null => {
    for (const P of blk.platforms) {
      if (Math.min(P.x + P.w, H.x + H.w) - Math.max(P.x, H.x) < 12) continue;
      if (P.edge === 'N' && H.y > P.y + P.h) { const band: [number, number] = [P.y + P.h + 1, H.y - 1]; if (band[1] - band[0] >= 3 && band[1] - band[0] <= 40) return {P, wall: 'N', band}; }
      if (P.edge === 'S' && H.y + H.h < P.y) { const band: [number, number] = [H.y + H.h + 1, P.y - 1]; if (band[1] - band[0] >= 3 && band[1] - band[0] <= 40) return {P, wall: 'S', band}; }
    }
    return null;
  };
  const hosts = galleryHosts(k, runL).map(H => ({H, f: facing(H)}))
    .sort((a, b) => Number(!!b.f) - Number(!!a.f) || b.H.w * b.H.h - a.H.w * a.H.h || a.H.id - b.H.id);
  for (const {H, f} of hosts) {
    // Every cell of the hall is its own (nothing carved inside it yet) and nothing stands on the upper grid over it (or round it).
    let clean = true;
    for (let y = H.y - 1; y <= H.y + H.h && clean; y++) for (let x = H.x - 1; x <= H.x + H.w; x++) {
      const i = G0.idx(x, y);
      const inside = x >= H.x && x < H.x + H.w && y >= H.y && y < H.y + H.h;
      if (GU.cells[i] !== SOLID || (inside && (G0.area[i] !== H.id || G0.rampIdx[i] >= 0))) { clean = false; break; }
    }
    if (!clean) continue;
    const doors = doorsOn(k, H);
    const wallDoors = (w: Wall) => doors.filter(e => e.side === w).length;
    // The gallery's wall: the one facing the platform (bridge), else the one with fewer doorways.
    const walls: Wall[] = f ? [f.wall, f.wall === 'N' ? 'S' : 'N'] : wallDoors('N') <= wallDoors('S') ? ['N', 'S'] : ['S', 'N'];
    for (const side of walls) {
      const gd = rng.int(CIRC.galleryDepth[0], CIRC.galleryDepth[1]);
      // rows measured from the gallery wall: [0, gd) gallery, then the bank
      const row = (u: number) => (side === 'N' ? H.y + u : H.y + H.h - 1 - u);
      const rowsOf = (u0: number, u1: number): [number, number] => (side === 'N' ? [row(u0), row(u1 - 1) + 1] : [row(u1 - 1), row(u0) + 1]);
      // Doorways on the gallery wall: their lanes stay clear of the bank (people come in under the gallery and walk on into the hall).
      const laneBlocked = (x0: number, x1: number) => doors.some(({d, side: s}) => s === side && x0 < d.x + d.w + CIRC.doorLane && x1 > d.x - CIRC.doorLane);
      // End-wall doorways in the rows the bank occupies: keep a lane along that wall.
      const endBlocked = (x0: number, x1: number, y0: number, y1: number) => doors.some(({d, side: s}) => (s === 'W' || s === 'E') && d.y < y1 + 2 && d.y + d.h > y0 - 2
        && (s === 'W' ? x0 < H.x + CIRC.doorLane + 2 : x1 > H.x + H.w - CIRC.doorLane - 2));
      const banks: {bank: Rect; axis: 'x' | 'z'; top: 'lo' | 'hi'; leadX: [number, number]}[] = [];
      // (a) a GRAND STAIR down from the gallery's edge into the hall (perpendicular), where the hall is deep enough
      if (H.h >= gd + runL + CIRC.footClear) {
        const [y0, y1] = rowsOf(gd, gd + runL);
        for (let x = H.x + CIRC.doorLane + 2; x + CIRC.bankW <= H.x + H.w - CIRC.doorLane - 2; x++) {
          if (laneBlocked(x, x + CIRC.bankW) || endBlocked(x, x + CIRC.bankW, y0, y1)) continue;
          banks.push({bank: {x, y: y0, w: CIRC.bankW, h: y1 - y0}, axis: 'z', top: side === 'N' ? 'lo' : 'hi', leadX: [x, x + CIRC.bankW]});
        }
      }
      // (b) a bank along the gallery's edge (parallel), where the hall is long enough
      if (H.h >= gd + CIRC.bankW + CIRC.hallClear) {
        const [y0, y1] = rowsOf(gd, gd + CIRC.bankW);
        // (a landing at each end: the foot opens onto the hall floor, never against an end wall)
        for (let x = H.x + CIRC.bankEnd; x + runL <= H.x + H.w - CIRC.bankEnd; x++) {
          if (laneBlocked(x, x + runL) || endBlocked(x, x + runL, Math.min(y0, row(0)), Math.max(y1, row(0) + 1))) continue;
          for (const top of ['lo', 'hi'] as const) banks.push({bank: {x, y: y0, w: runL, h: y1 - y0}, axis: 'x', top, leadX: top === 'lo' ? [x, x + lead] : [x + runL - lead, x + runL]});
        }
      }
      if (!banks.length) continue;
      // The bridge: through the rock between the facing platform's back wall and the gallery wall, inside the deck's span.
      const deck = f && f.wall === side ? deckOf(f.P) : null;
      const bw = rng.int(CIRC.bridgeW[0], CIRC.bridgeW[1]);
      const bridgeAt = (bx: number): GalleryPlan['bridge'] => {
        if (!f || !deck || f.wall !== side) return null;
        if (bx < deck.x + 2 || bx + bw > deck.x + deck.w - 2 || bx < H.x + 2 || bx + bw > H.x + H.w - 2) return null;
        const r: Rect = {x: bx, y: f.band[0], w: bw, h: f.band[1] - f.band[0]};
        if (!k.rectFree(r, LEVEL_UPPER)) return null;
        const rock: number[] = [];
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
          const i = G0.idx(x, y);
          if (G0.cells[i] === SOLID) { rock.push(i); continue; }
          // a space under it (a stair passage) must sit a slab below the deck level, never a flight
          if (G0.cells[i] !== FLOOR || G0.rampIdx[i] >= 0 || G0.ceil[i] > slabTop + 1e-6) return null;
        }
        const platWall = f.P.edge === 'N' ? f.P.y + f.P.h : f.P.y - 1, hallWall = side === 'N' ? H.y - 1 : H.y + H.h;
        for (const wr of [platWall, hallWall]) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if (GU.cells[GU.idx(x, wr)] !== SOLID) return null;
        return {r, P: f.P, deck, rock, wallRow: platWall};
      };
      // Score: a bridge (the loop) first, then a grand stair, then a bank near the hall's middle; ties by the gallery fork.
      const mid = H.x + H.w / 2;
      let best: {b: typeof banks[number]; br: GalleryPlan['bridge']; score: number} | null = null;
      for (const b of banks) {
        let br: GalleryPlan['bridge'] = null;
        if (deck) for (const dx of [CIRC.bankW + 3, -bw - 3, CIRC.bankW + 8, -bw - 8, 16, -bw - 16]) { br = bridgeAt((dx > 0 ? b.leadX[1] : b.leadX[0]) + dx - (dx > 0 ? CIRC.bankW : 0)); if (br) break; }
        const score = (br ? 0 : 1000) + (b.axis === 'z' ? 0 : 300) + Math.abs((b.bank.x + b.bank.w / 2) - mid) + rng.next();
        if (!best || score < best.score) best = {b, br, score};
      }
      if (!best) continue;
      // The gallery: a share of the hall's length round the bank's lead and the bridge, within the hall.
      const need0 = Math.min(best.b.leadX[0], best.br ? best.br.r.x - 1 : Infinity), need1 = Math.max(best.b.leadX[1], best.br ? best.br.r.x + best.br.r.w + 1 : -Infinity);
      const len = Math.min(H.w, Math.max(CIRC.galleryMin, Math.round(H.w * rng.range(CIRC.galleryShare[0], CIRC.galleryShare[1])), need1 - need0 + 6));
      const gx0 = Math.max(H.x, Math.min(H.x + H.w - len, Math.round((need0 + need1) / 2 - len / 2)));
      if (gx0 > need0 || gx0 + len < need1) continue;
      const [gy0, gy1] = rowsOf(0, gd);
      return {H, side, gal: {x: gx0, y: gy0, w: len, h: gy1 - gy0}, bank: best.b.bank, axis: best.b.axis, top: best.b.top, bridge: best.br, hu, uc};
    }
  }
  return null;
}

function applyGallery(k: Kit, lp: LevelPlan, p: GalleryPlan, rec: CirculationRec): void {
  const G0 = k.grid(LEVEL_MAIN), GU = k.grid(LEVEL_UPPER);
  const {H, gal, bank, hu, uc} = p;
  const slabTop = r2(hu - SLAB);
  // The hall rises to the upper concourse's ceiling; under the gallery strip its ceiling drops a slab below the gallery's floor.
  for (let y = H.y; y < H.y + H.h; y++) for (let x = H.x; x < H.x + H.w; x++) {
    const i = G0.idx(x, y);
    if (G0.area[i] !== H.id) continue;
    const under = y >= gal.y && y < gal.y + gal.h && x >= gal.x && x < gal.x + gal.w;
    G0.ceil[i] = under ? Math.min(G0.ceil[i], slabTop) : Math.max(G0.ceil[i], uc);
  }
  H.ceil = Math.max(H.ceil, uc);
  H.galleried = true;
  // Later doors (exits, storefronts, washrooms) keep off the walls beside the bank.
  if (p.axis === 'x') for (const wx of [H.x - 1, H.x + H.w]) k.reserve({x: wx, y: bank.y - 1, w: 1, h: bank.h + 2});
  else k.reserve({x: bank.x - CIRC.doorLane, y: p.side === 'N' ? H.y - 1 : H.y + H.h, w: bank.w + 2 * CIRC.doorLane, h: 1});
  // The open stair bank (an area of its own on the main and upper grids: the hall's dresser leaves it alone), its well capped at the
  // hall ceiling: from the hall floor up to its flat top lead at the gallery.
  const spec: StairSpec = {...STAIR, headroom: OPEN_HEADROOM};
  const S = k.addArea(bank, 'passage', 'stair-core', uc, H.id, {also: [LEVEL_UPPER], role: 'stair', paid: H.paid, publicSpace: true, label: 'Gallery stairs'});
  const fl = layStairRun([G0, GU], bank, S.id, p.axis, p.top, hu, 0, spec);
  const flights = runFlights(k, fl, true);
  for (const g of [G0, GU]) for (let y = bank.y; y < bank.y + bank.h; y++) for (let x = bank.x; x < bank.x + bank.w; x++) g.ceil[g.idx(x, y)] = uc;
  (lp.runs ??= []).push({lower: LEVEL_MAIN, upper: LEVEL_UPPER, area: S.id, flights, open: true});
  // The gallery over the strip (the upper level: its open edge over the hall is an aperture, railed by deriveRails).
  const A = k.addArea(gal, 'concourse', 'concourse', uc, H.id, {level: LEVEL_UPPER, floorY: hu, paid: H.paid, role: 'overlook', label: `Gallery · ${H.label}`});
  let bridge = -1;
  const b = p.bridge;
  if (b) {
    const B = k.addArea(b.r, 'passage', 'passage', uc, b.deck.id, {level: LEVEL_UPPER, floorY: hu, paid: true, role: 'crossover', label: 'Gallery bridge'});
    for (const i of b.rock) k.keepRock[i] = 1;
    k.carveDoor({x: b.r.x + 1, y: b.wallRow, w: b.r.w - 2, h: 1}, b.deck, B, CORE.landingDoorH + 0.2, true);
    k.carveDoor({x: b.r.x + 1, y: p.side === 'N' ? H.y - 1 : H.y + H.h, w: b.r.w - 2, h: 1}, B, A, CORE.landingDoorH + 0.2, true);
    bridge = B.id;
  }
  rec.gallery = {host: H.id, gallery: A.id, stair: S.id, bridge, deck: b?.deck.id ?? -1};
  rec.notes.push(`gallery:${H.role ?? H.type}:${p.side}:${p.axis === 'z' ? 'grand-stair' : 'bank'}:${(gal.w * CELL).toFixed(1)}x${(gal.h * CELL).toFixed(1)}m${bridge >= 0 ? '+bridge' : ''}`);
}

/** Registers a run's flights (kit order) and caps open wells. */
function runFlights(k: Kit, fl: StairFlight[], open: boolean): number[] {
  return fl.map(f => {
    f.id = k.flights.length;
    k.flights.push(f);
    if (open) k.g.ramps[f.ramp].capCeil = true;
    return f.id;
  });
}

// ---------------------------------------------------------------------------------------------
// UNDERPASS

interface UnderpassPlan {
  P1: Area; P2: Area;
  /** Subway (lower), the two runs' and lobbies' x-ranges, the end of the runs at the lobby (their flat top lead: 'hi' = toward +x). */
  sub: Rect; run: [number, number]; lob: [number, number]; from: 'lo' | 'hi';
  rows1: [number, number]; rows2: [number, number];
}

function planUnderpass(k: Kit, plan: Plan, lp: LevelPlan): UnderpassPlan | null {
  const blk = plan.blocks[0];
  if (!blk || blk.kind !== 'side') return null;
  const [P1, P2] = blk.platforms;
  if (P1.edge !== 'N' || P2.edge !== 'S') return null;
  const CW = CORE.width, LB = CORE.lobby, UW = CIRC.subwayW, DL = stairRunCells(-LOWER_FLOOR);
  const w1 = P1.y + P1.h, w2 = P2.y - 1;
  const rows1: [number, number] = [w1 + 1, w1 + 1 + CW], rows2: [number, number] = [w2 - CW, w2];
  // The cores' footprint along x (lobbies, runs, the service crossing / gallery) — the subway keeps its distance.
  const coreX: [number, number][] = [];
  for (const c of lp.cores) for (const id of [c.lobby, c.up, c.down, c.landing]) if (id >= 0) { const a = k.areas[id]; coreX.push([a.x, a.x + a.w]); }
  for (const id of [lp.crossing, lp.gallery, ...lp.lowerRooms]) if (id >= 0) { const a = k.areas[id]; coreX.push([a.x, a.x + a.w]); }
  const x0 = Math.max(P1.x, P2.x) + CIRC.endInset, x1 = Math.min(P1.x + P1.w, P2.x + P2.w) - CIRC.endInset;
  const G0 = k.grid(LEVEL_MAIN);
  // every main-level floor over the subway sits a slab above its ceiling (the platforms, the beds; never a flight down)
  const under = (r: Rect): boolean => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = G0.idx(x, y);
      if (G0.cells[i] !== SOLID && (G0.rampIdx[i] >= 0 || G0.floorOf(i) < LOWER_CEIL + SLAB - 1e-6)) return false;
    }
    return true;
  };
  const cands: {ux: number; dir: 1 | -1; d: number}[] = [];
  for (const dir of [1, -1] as const) {
    for (let ux = x0; ux + UW <= x1; ux++) {
      // [subway][run][lobby] toward +x (dir 1) or [lobby][run][subway] (dir -1); every piece inside both platforms' spans
      const [s0, s1] = dir > 0 ? [ux, ux + UW + DL + LB] : [ux - DL - LB, ux + UW];
      if (s0 < x0 || s1 > x1) continue;
      const gap = Math.min(...coreX.map(([a, b]) => (s1 <= a ? a - s1 : b <= s0 ? s0 - b : -1)));
      if (gap < CIRC.coreGap) continue;
      cands.push({ux, dir, d: gap});
    }
  }
  // Farthest from the cores first (the other end of the platforms), then a fixed order.
  cands.sort((a, b) => b.d - a.d || a.ux - b.ux || a.dir - b.dir);
  for (const {ux, dir} of cands.slice(0, 400)) {
    const run: [number, number] = dir > 0 ? [ux + UW, ux + UW + DL] : [ux - DL, ux];
    const lob: [number, number] = dir > 0 ? [run[1], run[1] + LB] : [run[0] - LB, run[0]];
    const sub: Rect = {x: ux, y: rows2[0], w: UW, h: rows1[1] - rows2[0]};
    const mainRect = (rows: [number, number]): Rect => ({x: Math.min(run[0], lob[0]), y: rows[0], w: DL + LB, h: rows[1] - rows[0]});
    if (!k.rectFree(mainRect(rows1)) || !k.rectFree(mainRect(rows2))) continue;
    // the lobbies' doorways through each platform's back wall (rock there: no passage / core door in the way)
    if (!k.solid({x: lob[0], y: w1, w: LB, h: 1}) || !k.solid({x: lob[0], y: w2, w: LB, h: 1})) continue;
    // the runs and the subway on the service level (with a wall margin round the subway)
    const runR = (rows: [number, number]): Rect => ({x: run[0], y: rows[0], w: DL, h: rows[1] - rows[0]});
    if (!k.rectFree(runR(rows1), LEVEL_LOWER) || !k.rectFree(runR(rows2), LEVEL_LOWER) || !k.rectFree(sub, LEVEL_LOWER) || !under(sub)) continue;
    return {P1, P2, sub, run, lob, from: dir > 0 ? 'hi' : 'lo', rows1, rows2};
  }
  return null;
}

/** Service rooms of the subway's plant (existing back-of-house purposes). */
const SUBWAY_ROOMS: readonly [Area['type'], string, string][] = [
  ['utility', 'pump-room', 'Sump pump room'], ['utility', 'electrical-room', 'Subway switch room'],
  ['storage', 'storage', 'Subway store'], ['utility', 'signal-room', 'Cable vault'],
];

function applyUnderpass(k: Kit, lp: LevelPlan, p: UnderpassPlan, rec: CirculationRec, rng: Rng): void {
  const G0 = k.grid(LEVEL_MAIN), GLo = k.grid(LEVEL_LOWER);
  const CW = CORE.width, LB = CORE.lobby;
  const lower = {level: LEVEL_LOWER, floorY: LOWER_FLOOR};
  const sub = k.addArea(p.sub, 'passage', 'underpass', LOWER_CEIL, p.P1.id, {...lower, paid: true, publicSpace: true, role: 'crossunder', label: 'Pedestrian subway'});
  const lobbies: number[] = [], stairs: number[] = [];
  for (const [P, rows, wall] of [[p.P1, p.rows1, p.P1.y + p.P1.h], [p.P2, p.rows2, p.P2.y - 1]] as const) {
    const no = P.platformNo ?? (P === p.P1 ? 1 : 2);
    const L = k.addArea({x: p.lob[0], y: rows[0], w: LB, h: CW}, 'passage', 'stair-core', CORE.lobbyCeil, P.id, {paid: true, role: 'stair-core', label: `Subway stairs · Platform ${no}`});
    k.carveDoor({x: p.lob[0] + 1, y: wall, w: LB - 2, h: 1}, P, L, CORE.doorH, true);
    const R = k.addArea({x: p.run[0], y: rows[0], w: p.run[1] - p.run[0], h: CW}, 'passage', 'stair-core', STAIR.headroom, L.id, {paid: true, role: 'stair', label: 'Stairs · Pedestrian subway', also: [LEVEL_LOWER]});
    const fl = layStairRun([G0, GLo], {x: R.x, y: R.y, w: R.w, h: R.h}, R.id, 'x', p.from, 0, LOWER_FLOOR);
    (lp.runs ??= []).push({lower: LEVEL_LOWER, upper: LEVEL_MAIN, area: R.id, flights: runFlights(k, fl, false)});
    lobbies.push(L.id); stairs.push(R.id);
  }
  // Plant rooms off the subway's long walls (the side away from the runs first), staff doors.
  const rooms: number[] = [];
  const kinds = rng.shuffle(SUBWAY_ROOMS.slice());
  const away: 'W' | 'E' = p.from === 'hi' ? 'W' : 'E';
  const want = rng.int(1, 2);
  for (const side of [away, away === 'W' ? 'E' : 'W'] as const) {
    for (let t = 0; t < 6 && rooms.length < want; t++) {
      const rw = rng.int(CIRC.roomW[0], CIRC.roomW[1]), rd = rng.int(CIRC.roomD[0], CIRC.roomD[1]);
      // between the two runs' rows (under the platforms and the bed), clear of the subway's ends
      const y = rng.int(p.rows2[1] + 2, Math.max(p.rows2[1] + 2, p.rows1[0] - 2 - rw));
      const r: Rect = side === 'W' ? {x: p.sub.x - 1 - rd, y, w: rd, h: rw} : {x: p.sub.x + p.sub.w + 1, y, w: rd, h: rw};
      if (!k.rectFree(r, LEVEL_LOWER)) continue;
      const [type, purpose, label] = kinds[rooms.length % kinds.length];
      const R = k.addArea(r, 'room', type, LOWER_CEIL, sub.id, {...lower, publicSpace: false, label});
      R.purpose = purpose;
      const dy = r.y + Math.floor(r.h / 2) - 1;
      k.carveDoor({x: side === 'W' ? p.sub.x - 1 : p.sub.x + p.sub.w, y: dy, w: 1, h: 3}, sub, R, 2.3, false, {staff: true});
      rooms.push(R.id);
    }
  }
  lp.lowerRooms.push(...rooms);
  // A service tunnel joining the subway to the existing service gallery along its own rows (a loop through the service level).
  let tunnel = -1;
  if (lp.gallery >= 0 && rng.chance(0.6)) {
    const Gy = k.areas[lp.gallery];
    const toEast = p.sub.x > Gy.x;
    const tx0 = toEast ? Gy.x + Gy.w + 1 : p.sub.x + p.sub.w + 1, tx1 = toEast ? p.sub.x - 1 : Gy.x - 1;
    const r: Rect = {x: tx0, y: Gy.y + 1, w: tx1 - tx0, h: Math.max(3, Gy.h - 2)};
    if (r.w >= 6 && r.y >= p.sub.y + 1 && r.y + r.h <= p.sub.y + p.sub.h - 1 && freeRun(GLo, r)) {
      const T = k.addArea(r, 'service', 'service-corridor', LOWER_CEIL, lp.gallery, {...lower, publicSpace: false, role: 'service-gallery', label: 'Service tunnel'});
      k.carveDoor({x: toEast ? r.x - 1 : r.x + r.w, y: r.y, w: 1, h: r.h}, Gy, T, 2.3, true);
      k.carveDoor({x: toEast ? r.x + r.w : r.x - 1, y: r.y, w: 1, h: r.h}, sub, T, 2.3, false, {staff: true});
      tunnel = T.id;
    }
  }
  rec.underpass = {subway: sub.id, lobbies, stairs, platforms: [p.P1.id, p.P2.id], rooms, tunnel};
  rec.notes.push(`underpass:${(p.sub.h * CELL).toFixed(1)}m${rooms.length ? `+${rooms.length}rooms` : ''}${tunnel >= 0 ? '+tunnel' : ''}`);
}

/** Every cell of `r` and its two long-side margins is rock on `g` (the end columns are the doorways). */
function freeRun(g: Grid, r: Rect): boolean {
  for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== SOLID) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// After the crop: railings and wayfinding

/**
 * The railings of a station with circulation runs (world, after the crop): the derived rails, the open stair banks' balustrades and every
 * drop the circulation opened. An open bank (the Mall / Market rule) is railed along both long edges on the main level following its
 * walking surface — the flat top lead, each flight, the landing after it, down to the hall floor — except the lead's mouth onto the
 * gallery's floor; on the upper level a flat rail at the gallery's floor wherever the gallery's edge runs beside the lower part of the bank
 * (a parallel bank). Where a derived rail already stands on such an edge at its height (the landings' and the lead's short flat pieces
 * over apertures: levelIssues requires each derived rail as it is) the bank's own rail leaves that part to it. Last, any drop edge still
 * open (Levels' own drop rule: a gallery's end over the double-height hall where the stacked box stops short of it) is railed, one rail per
 * edge (gen/market marketRails, the shared rule).
 */
export function circulationRails(layout: StationLayout): RailRun[] {
  const lp = layout.levelPlan, GU = layout.levels[LEVEL_UPPER]?.grid;
  if (!lp?.runs || !GU) return layout.rails;
  const own: RailRun[] = [];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const hiEnd = (f: StairFlight): [number, number] => (f.h0 >= f.h1 ? [f.s0, f.h0] : [f.s1, f.h1]);
  const loEnd = (f: StairFlight): [number, number] => (f.h0 >= f.h1 ? [f.s1, f.h1] : [f.s0, f.h0]);
  for (const run of lp.runs) {
    if (!run.open) continue;
    const a = layout.areas[run.area];
    const fl = run.flights.map(id => layout.traversal.stairs[id]).sort((f, g) => hiEnd(g)[1] - hiEnd(f)[1]);
    if (!a || !fl.length) continue;
    const alongX = fl[0].axis === 'x';
    const [sTop, yHi] = hiEnd(fl[0]), [sLo, yLo] = loEnd(fl[fl.length - 1]);
    const e0 = (alongX ? a.x : a.y) * CELL, e1 = (alongX ? a.x + a.w : a.y + a.h) * CELL;
    const botEdge = Math.abs(sLo - e0) < Math.abs(sLo - e1) ? e0 : e1, topEdge = botEdge === e0 ? e1 : e0;
    // the walking surface from the top edge down: [the lead], then per flight its top and foot (a landing between two), the hall floor
    const prof: [number, number][] = [[topEdge, yHi]];
    for (const f of fl) prof.push(hiEnd(f), loEnd(f));
    prof.push([botEdge, yLo]);
    const seg = (level: number, q: number, sA: number, yA: number, sB: number, yB: number, n: number) => {
      if (Math.abs(sB - sA) < 0.05) return;
      const [s0, y0, s1, y1] = sA <= sB ? [sA, yA, sB, yB] : [sB, yB, sA, yA];
      own.push(alongX
        ? {level, x0: r3(s0), z0: r3(q), x1: r3(s1), z1: r3(q), y0: r3(y0), y1: r3(y1), nx: 0, nz: n, kind: 'railing', h: 1.0}
        : {level, x0: r3(q), z0: r3(s0), x1: r3(q), z1: r3(s1), y0: r3(y0), y1: r3(y1), nx: n, nz: 0, kind: 'railing', h: 1.0});
    };
    // the two flanks: [the edge line, the outward normal, the cell index just outside it at a position along the run]
    const flanks: [number, number, (s: number) => number][] = alongX
      ? [[a.y * CELL, -1, s => GU.idx(Math.floor(s / CELL), a.y - 1)], [(a.y + a.h) * CELL, 1, s => GU.idx(Math.floor(s / CELL), a.y + a.h)]]
      : [[a.x * CELL, -1, s => GU.idx(a.x - 1, Math.floor(s / CELL))], [(a.x + a.w) * CELL, 1, s => GU.idx(a.x + a.w, Math.floor(s / CELL))]];
    const gallery = (i: number) => GU.cells[i] === FLOOR && GU.rampIdx[i] < 0 && Math.abs(GU.floor[i] - yHi) < 0.05;
    const [p0, p1] = botEdge < sTop ? [botEdge, sTop] : [sTop, botEdge];
    const [l0, l1] = topEdge < sTop ? [topEdge, sTop] : [sTop, topEdge];
    for (const [q, n, outside] of flanks) {
      // main level (normal toward the stair): the lead in cell pieces, open where the gallery's floor is beside it (its mouth)
      let start = -1;
      for (let s = l0; s < l1 - 1e-6;) {
        const t = Math.min(l1, (Math.floor(s / CELL + 1e-6) + 1) * CELL), open = gallery(outside((s + t) / 2));
        if (!open && start < 0) start = s;
        if (open && start >= 0) { seg(LEVEL_MAIN, q, start, yHi, s, yHi, -n); start = -1; }
        s = t;
      }
      if (start >= 0) seg(LEVEL_MAIN, q, start, yHi, l1, yHi, -n);
      for (let k = 2; k < prof.length; k++) seg(LEVEL_MAIN, q, prof[k - 1][0], prof[k - 1][1], prof[k][0], prof[k][1], -n);
      // upper level: the gallery's floor beside the lower part (cell runs of walkable upper floor at the gallery's height)
      start = -1;
      for (let s = p0 + CELL / 2; s < p1 + CELL / 2; s += CELL) {
        const inside = s < p1;
        const on = inside && gallery(outside(s));
        if (on && start < 0) start = s - CELL / 2;
        if (!on && start >= 0) { seg(LEVEL_UPPER, q, start, yHi, s - CELL / 2, yHi, n); start = -1; }
      }
    }
  }
  const list = [...layout.rails];
  for (const r of own) list.push(...layout.rails.reduce<RailRun[]>((ps, d) => ps.flatMap(p => cutRail(p, d)), [r]));
  const seen = new Set<string>();
  for (const e of new Levels(layout.levels, layout.levelLinks, list).unrailedDrops()) {
    const key = `${e.x0},${e.z0},${e.x1},${e.z1},${Math.round(e.y0 * 100)}`;
    if (!seen.has(key)) { seen.add(key); list.push({...e, h: 1.0}); }
  }
  return list;
}

/** The floor an open stair bank's mouth keeps clear on its gallery (m; the dresser's own stair approach, gen/placeKit STAIR_APPROACH). */
export const MOUTH_CLEAR = 1.5;

/**
 * The mouths of the open stair banks (world cells, after the crop): beside each side of a bank's flat top lead that opens onto floor of
 * the upper level at its height, a band MOUTH_CLEAR deep and a cell wider at both ends. The dresser keeps it clear (gen/placeKit edge
 * mask): a lead is longer than the stair approach the dresser keeps beyond a flight's end, so a prop could otherwise stand on the gallery
 * across the top of the stair. Empty on a station without an open bank (every earlier version, compact and underpass plans).
 */
export function circulationMouths(layout: StationLayout): {level: number; x: number; y: number; w: number; h: number}[] {
  const out: {level: number; x: number; y: number; w: number; h: number}[] = [];
  const lp = layout.levelPlan, GU = layout.levels?.[LEVEL_UPPER]?.grid;
  if (!lp?.runs || !GU) return out;
  const d = Math.ceil(MOUTH_CLEAR / CELL - 1e-6);
  for (const run of lp.runs) {
    const S = layout.areas[run.area], fl = run.flights.map(id => layout.traversal.stairs[id]);
    if (!run.open || !S || !fl.length) continue;
    const yHi = Math.max(...fl.map(f => Math.max(f.h0, f.h1)));
    const atTop = (x: number, y: number, own: boolean) => {
      if (!GU.inBounds(x, y)) return false;
      const i = GU.idx(x, y);
      return GU.cells[i] === FLOOR && GU.rampIdx[i] < 0 && Math.abs(GU.floor[i] - yHi) < 0.05 && (GU.area[i] === S.id) === own;
    };
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + S.w; x++) if (atTop(x, y, true)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 < 0) continue;
    const opens = (cells: [number, number][]) => cells.filter(([x, y]) => atTop(x, y, false)).length >= 2;
    const row = (y: number): [number, number][] => Array.from({length: x1 - x0 + 1}, (_, k) => [x0 + k, y]);
    const col = (x: number): [number, number][] => Array.from({length: y1 - y0 + 1}, (_, k) => [x, y0 + k]);
    if (opens(row(y0 - 1))) out.push({level: LEVEL_UPPER, x: x0 - 1, y: y0 - d, w: x1 - x0 + 3, h: d});
    if (opens(row(y1 + 1))) out.push({level: LEVEL_UPPER, x: x0 - 1, y: y1 + 1, w: x1 - x0 + 3, h: d});
    if (opens(col(x0 - 1))) out.push({level: LEVEL_UPPER, x: x0 - d, y: y0 - 1, w: d, h: y1 - y0 + 3});
    if (opens(col(x1 + 1))) out.push({level: LEVEL_UPPER, x: x1 + 1, y: y0 - 1, w: d, h: y1 - y0 + 3});
  }
  return out;
}

/** A bank rail less the part a derived rail `d` already covers (on its line, at its height). */
function cutRail(r: RailRun, d: RailRun): RailRun[] {
  if (d.kind === 'parapet') return [r];
  const alongX = Math.abs(r.z0 - r.z1) < 1e-6;
  const q = alongX ? r.z0 : r.x0;
  const on = alongX ? Math.abs(d.z0 - q) < 1e-3 && Math.abs(d.z1 - q) < 1e-3 : Math.abs(d.x0 - q) < 1e-3 && Math.abs(d.x1 - q) < 1e-3;
  const s0 = alongX ? r.x0 : r.z0, s1 = alongX ? r.x1 : r.z1, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const d0 = alongX ? d.x0 : d.z0, d1 = alongX ? d.x1 : d.z1, a = Math.max(lo, Math.min(d0, d1)), b = Math.min(hi, Math.max(d0, d1));
  if (!on || b - a < 1e-6) return [r];
  const yAt = (s: number) => (hi - lo < 1e-9 ? r.y0 : r.y0 + ((r.y1 - r.y0) * (s - s0)) / (s1 - s0));
  const mid = (a + b) / 2, [mx, mz] = alongX ? [mid, q] : [q, mid];
  if (Math.abs(Levels.railBaseAt(d, mx, mz) - yAt(mid)) > 0.05) return [r];
  const piece = (u: number, v: number): RailRun => (alongX ? {...r, x0: u, x1: v, y0: yAt(u), y1: yAt(v)} : {...r, z0: u, z1: v, y0: yAt(u), y1: yAt(v)});
  const out: RailRun[] = [], up = s1 >= s0;
  if (a - lo >= 0.05) out.push(up ? piece(lo, a) : piece(a, lo));
  if (hi - b >= 0.05) out.push(up ? piece(b, hi) : piece(hi, b));
  return out;
}

/**
 * The hall's own main-level dressing hung over its open stair bank (the dresser places the hall's pendants and hung signs by the hall's
 * rect, before the bank's cells are told apart): a pendant there is dropped (the bank's own and the hall's other fixtures light it), a hung
 * sign moves off the bank onto the hall floor beside it (dropped when no hall cell is there). Deterministic, before the lighting pass.
 */
function clearBank(layout: StationLayout, S: Area, H: Area, galleryId: number): void {
  const g = layout.grid, m = 0.3;
  const x0 = S.x * CELL - m, x1 = (S.x + S.w) * CELL + m, z0 = S.y * CELL - m, z1 = (S.y + S.h) * CELL + m;
  const over = (x: number, z: number) => x > x0 && x < x1 && z > z0 && z < z1;
  const hallAt = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return g.inBounds(cx, cz) && g.area[g.idx(cx, cz)] === H.id; };
  keepOnly(layout.lights, l => !!l.level || l.area === S.id || !over(l.x, l.z));
  const G = layout.areas[galleryId];
  const alongX = S.w >= S.h;
  keepOnly(layout.signs, sg => {
    if (sg.level || !sg.hang || !over(sg.x, sg.z)) return true;
    // across the bank's axis, away from the gallery first
    const away = alongX ? (G.y < S.y ? 1 : -1) : 1;
    for (const d of [away, -away]) {
      const [nx, nz] = alongX ? [sg.x, d > 0 ? z1 + 0.9 : z0 - 0.9] : [d > 0 ? x1 + 0.9 : x0 - 0.9, sg.z];
      if (hallAt(nx, nz) && !over(nx, nz)) { sg.x = Math.round(nx * 100) / 100; sg.z = Math.round(nz * 100) / 100; return true; }
    }
    return false;
  });
}

/** Filters an array in place (the layout's arrays keep their identity for every later pass). */
function keepOnly<T>(arr: T[], keep: (v: T) => boolean): void {
  let n = 0;
  for (const v of arr) if (keep(v)) arr[n++] = v;
  arr.length = n;
}

/** Wayfinding of the circulation plan (after the dressing and the level program's own signs; RNG-free, appended). */
export function dressCirculation(layout: StationLayout): void {
  const c = layout.levelPlan?.circ;
  if (!c || c.plan === 'compact') return;
  const A = layout.areas, lp = layout.levelPlan!;
  const sign = (s: SignPlacement) => layout.signs.push(s);
  const platNo = (P: Area) => String(P.platformNo ?? (P.label.match(/\d+/)?.[0] ?? '1'));
  const clampTo = (a: Area, x: number, z: number, m = 0.6): [number, number] =>
    [Math.min((a.x + a.w) * CELL - m, Math.max(a.x * CELL + m, x)), Math.min((a.y + a.h) * CELL - m, Math.max(a.y * CELL + m, z))];
  if (c.gallery) {
    const H = A[c.gallery.host], G = A[c.gallery.gallery], S = A[c.gallery.stair];
    const hall = H.label.toUpperCase();
    clearBank(layout, S, H, c.gallery.gallery);
    const run = lp.runs!.find(r => r.area === S.id)!;
    const fl = run.flights.map(id => layout.traversal.stairs[id]);
    const alongX = fl[0].axis === 'x', rot = alongX ? Math.PI / 2 : 0;
    const bottom = fl.reduce((a, f) => (f.bottom.y < a.y ? f.bottom : a), fl[0].bottom);
    const top = fl.reduce((a, f) => (f.top.y > a.y ? f.top : a), fl[0].top);
    const dir = Math.sign(alongX ? top.x - bottom.x : top.z - bottom.z) || 1;
    const off = (p: {x: number; z: number}, d: number): [number, number] => (alongX ? [p.x + d, p.z] : [p.x, p.z + d]);
    // the foot of the bank (in the hall, facing the way up) and its head (on the gallery)
    const [fx, fz] = off(bottom, -dir * 1.4);
    sign({x: fx, y: 3.0, z: fz, rot, kind: 'info', text: c.gallery.bridge >= 0 ? 'GALLERY · UPPER CONCOURSE · PLATFORMS' : 'UPPER GALLERY', arrow: 'up', area: H.id, hang: true, w: 2.6});
    const [hx, hz] = clampTo(G, ...(alongX ? [top.x, (G.y + G.h / 2) * CELL] as [number, number] : off(top, dir * 0.9)));
    sign({x: hx, y: lp.hu + 2.6, z: hz, rot, kind: 'info', text: `STAIRS DOWN · ${hall}`, arrow: 'down', area: G.id, hang: true, w: 2.4, level: LEVEL_UPPER});
    if (c.gallery.bridge >= 0) {
      const B = A[c.gallery.bridge], D = A[c.gallery.deck], P = D ? A[D.parent] : undefined;
      const bx = (B.x + B.w / 2) * CELL;
      sign({x: bx, y: lp.hu + 2.6, z: (B.y + B.h / 2) * CELL, rot: 0, kind: 'info', text: `GALLERY · ${hall}`, area: B.id, hang: true, w: Math.min(2.6, B.w * CELL - 0.4), level: LEVEL_UPPER});
      // on the deck at the bridge's doorway (the platform's back wall), and on the gallery at its far end
      if (D && P) sign({x: bx, y: lp.hu + 2.6, z: P.edge === 'S' ? P.y * CELL + 1.6 : (P.y + P.h) * CELL - 1.6, rot: 0, kind: 'info', text: `GALLERY · ${hall}`, arrow: 'down', area: D.id, hang: true, w: 2.4, level: LEVEL_UPPER});
      const galWallN = B.y < G.y;
      sign({x: bx, y: lp.hu + 2.6, z: galWallN ? G.y * CELL + 1.2 : (G.y + G.h) * CELL - 1.2, rot: 0, kind: 'info', text: 'UPPER CONCOURSE · PLATFORMS', arrow: 'up', area: G.id, hang: true, w: 2.6, level: LEVEL_UPPER});
    }
  }
  if (c.underpass) {
    const u = c.underpass, X = A[u.subway];
    const [P1, P2] = u.platforms.map(id => A[id]);
    u.lobbies.forEach((id, k) => {
      const L = A[id], P = k === 0 ? P1 : P2, Q = k === 0 ? P2 : P1;
      const north = P.edge === 'S'; // the lobby lies behind the platform's back wall (north of a platform whose track edge faces south)
      const x = (L.x + L.w / 2) * CELL;
      // on the platform in front of the lobby's doorway, in the lobby, and at the foot of its run in the subway
      sign({x, y: Math.min(P.ceil - 0.6, 2.95), z: north ? P.y * CELL + 3.0 : (P.y + P.h) * CELL - 3.0, rot: Math.PI / 2, kind: 'info', text: `PEDESTRIAN SUBWAY · PLATFORM ${platNo(Q)}`, arrow: 'down', area: P.id, hang: true, w: 2.6});
      sign({x, y: 2.55, z: (L.y + L.h / 2) * CELL, rot: Math.PI / 2, kind: 'info', text: `SUBWAY · PLATFORM ${platNo(Q)}`, arrow: 'down', area: L.id, hang: true, w: 1.8});
      const R = A[u.stairs[k]];
      sign({x: (X.x + X.w / 2) * CELL, y: lp.lowerFloor + 2.15, z: (R.y + R.h / 2) * CELL, rot: Math.PI / 2, kind: 'info', text: `PLATFORM ${platNo(P)} · STAIRS UP`, arrow: 'up', area: X.id, hang: true, w: 2.2, level: LEVEL_LOWER});
    });
  }
}

/** Layout view of the record (tests / QA): null for a compact or pre-version-4 station. */
export function circulationOfLayout(layout: Pick<StationLayout, 'levelPlan'>): CirculationRec | null {
  const c = layout.levelPlan?.circ;
  return c ?? null;
}
