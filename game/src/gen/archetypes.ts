// Macro station archetypes (iteration 04). Each builds a recognisably different public skeleton
// — platforms/tracks, how they reach the paid halls, where the fare line(s), ticket halls, food
// court, retail arcades and exit halls are — from the carving kit. Storefronts, washrooms, the
// agent office, street exits and back-of-house are added afterwards by station.ts.
//
// Spatial relationships follow the photo research (research/REFERENCES.md): retail and food on
// the unpaid side between the street exits and the fare line; long low shopping concourses
// (PATH/RÉSO) with units in both walls; food courts as halls with counters on the perimeter;
// island stations reached from the platform ends; deep stations with long escalator halls.

import {Kit, LATERAL, OPPOSITE, TUN, UNDERPASS_REACH, type TrackBlock} from './stationKit';
import type {Archetype, Area, Rect, Side} from './stationTypes';
import type {Frontage} from './storefronts';

export interface ExitPlan { parent: Area; side: Side; frac: number }

export class Plan {
  P1!: Area;
  platforms: Area[] = [];
  blocks: TrackBlock[] = [];
  paidHalls: Area[] = [];
  ticketHalls: Area[] = [];
  foods: Area[] = [];
  arcades: Area[] = [];
  exitHalls: Area[] = [];
  exits: ExitPlan[] = [];
  lateExits: ExitPlan[] = [];
  washHosts: Area[] = [];
  frontages: Frontage[] = [];
  /** Platform back walls that may host a staff corridor (back-of-house). */
  staffWalls: [Area, Side][] = [];
  /** Platform ends without an underpass / end passage (staff corridor candidates). */
  openEnds: [Area, 'W' | 'E'][] = [];
  /** Metrics for tests/maps: walk structure summary. */
  notes: string[] = [];
}

type Pattern = 'row' | 'tee' | 'mall' | 'wing';
const r1 = (v: number) => Math.round(v * 10) / 10;
const awaySign = (s: Side) => (s === 'S' || s === 'E' ? 1 : -1);

export function buildSkeleton(k: Kit, arch: Archetype, terms: string[]): Plan | null {
  const plan = new Plan();
  const ok = (() => {
    switch (arch) {
      case 'side-mezzanine': return sideMezzanine(k, plan, terms);
      case 'island-ends': return islandEnds(k, plan, terms);
      case 'express': return express(k, plan, terms);
      case 'interchange': return interchange(k, plan, terms);
      case 'split': return split(k, plan, terms);
      case 'deep': return deep(k, plan, terms);
    }
  })();
  return ok && plan.foods.length ? plan : null;
}

// ---------------------------------------------------------------------------------------
// Shared pieces

function hall(k: Kit, parent: Area, side: Side, along: number, deep: number, off: number, type: 'fare-hall' | 'food-court' | 'retail-arcade' | 'concourse', ceil: number, opts: {role?: Area['role']; label?: string; paid?: boolean} = {}): Area | null {
  return k.attach(parent, side, along, deep, off, 'concourse', type, ceil, parent.id, opts);
}

function foodCourt(k: Kit, plan: Plan, parent: Area, side: Side, off: number): Area | null {
  const rng = k.rng;
  // Big station hall (high ceiling) or a basement food court under a low grid ceiling.
  const ceil = rng.chance(0.55) ? r1(rng.range(4.8, 5.4)) : r1(rng.range(3.8, 4.3));
  const FA = rng.int(52, 80), FD = rng.int(28, 38);
  const F = hall(k, parent, side, FA, FD, off, 'food-court', ceil, {role: 'food-hall'});
  if (!F) return null;
  if (!k.connect(parent, F, rng.int(12, 16), 4.0, {pick: 'mid', margin: 3})) return null;
  plan.foods.push(F);
  // Counters on the perimeter: the far wall first (shared service corridor behind it), then the
  // flanks; the entry wall gets units only where there is room beside the entrance.
  const lat = LATERAL[side];
  plan.frontages.unshift({hall: F, sides: [side, ...rng.shuffle(lat.slice()), OPPOSITE[side]], mix: 'food', max: rng.int(6, 9), service: side});
  // Low priority (used only if the station is short of exits): keeps the flanks for counters.
  plan.lateExits.push({parent: F, side: rng.pick(lat), frac: rng.range(0.3, 0.7)});
  return F;
}

function arcade(k: Kit, plan: Plan, parent: Area, side: Side, len: number, off: number, label?: string): Area | null {
  const rng = k.rng;
  const RD = rng.int(12, 16);
  const R = hall(k, parent, side, RD, len, off, 'retail-arcade', r1(rng.range(3.4, 3.8)), {role: 'mall', label: label ?? (len > 70 ? 'Underground concourse' : 'Retail arcade')});
  if (!R) return null;
  if (!k.connect(parent, R, RD - 2, 3.4, {pick: 'mid'})) return null;
  plan.arcades.push(R);
  plan.washHosts.push(R);
  plan.frontages.push({hall: R, sides: rng.shuffle(LATERAL[side].slice()), mix: 'retail', max: Math.max(4, Math.round(len / 7))});
  return R;
}

function exitHall(k: Kit, plan: Plan, parent: Area, side: Side, off: number): Area | null {
  const rng = k.rng;
  const E = hall(k, parent, side, rng.int(26, 34), rng.int(26, 38), off, 'concourse', r1(rng.range(4.2, 4.8)), {role: 'exit-hall', label: 'Exit concourse'});
  if (!E) return null;
  const w = k.sharedWall(parent, E);
  if (!w || !k.connect(parent, E, Math.min(14, w.s1 - w.s0 - 4), 3.6, {pick: 'mid'})) return null;
  plan.exitHalls.push(E);
  plan.washHosts.push(E);
  plan.exits.push({parent: E, side, frac: rng.range(0.3, 0.7)});
  plan.exits.push({parent: E, side: rng.pick(LATERAL[side]), frac: rng.range(0.25, 0.75)});
  if (rng.chance(0.5)) plan.frontages.push({hall: E, sides: [...LATERAL[side], side], mix: 'kiosk', max: rng.int(1, 2)});
  return E;
}

function ticketHall(k: Kit, plan: Plan, paid: Area, side: Side, along: number, deep: number, off: number, gates: number, label?: string): Area | null {
  const rng = k.rng;
  const T = hall(k, paid, side, along, deep, off, 'fare-hall', r1(rng.range(5.0, 6.0)), {role: 'ticket-hall', label});
  if (!T) return null;
  if (!k.fareLine(paid, T, gates)) return null;
  plan.ticketHalls.push(T);
  plan.washHosts.push(T);
  return T;
}

/** Unpaid district beyond a ticket hall: food court, retail arcade, exit hall in one of four patterns. */
function district(k: Kit, plan: Plan, T: Area, away: Side, laterals: Side[], pattern: Pattern): boolean {
  const rng = k.rng;
  const sgn = awaySign(away);
  const lats = rng.shuffle(laterals.slice());
  const [l0, l1] = [lats[0], lats[1]];
  if (pattern === 'row' && !l1) pattern = 'tee';
  let F: Area | null = null;
  switch (pattern) {
    case 'row': {
      // Food court on one flank of the ticket hall, arcade to the exit hall on the other.
      F = foodCourt(k, plan, T, l0, sgn * rng.int(4, 14));
      const R = arcade(k, plan, T, l1!, rng.int(36, 64), sgn * rng.int(-2, 8));
      if (R) exitHall(k, plan, R, l1!, rng.int(-6, 6));
      break;
    }
    case 'tee': {
      // Food court straight ahead (away from the trains), arcade off to one side.
      F = foodCourt(k, plan, T, away, rng.int(-10, 10));
      const R = arcade(k, plan, T, l0, rng.int(36, 72), sgn * rng.int(-2, 8));
      if (R) exitHall(k, plan, R, l0, rng.int(-6, 6));
      break;
    }
    case 'mall': {
      // Long shopping concourse straight out to a food court at its far end (PATH / RÉSO).
      const R = arcade(k, plan, T, away, rng.int(56, 104), rng.int(-12, 12), 'Underground concourse');
      if (R) F = foodCourt(k, plan, R, away, rng.int(-16, 16));
      exitHall(k, plan, T, l0, sgn * rng.int(0, 8));
      break;
    }
    case 'wing': {
      // Arcade along the station, food hall opening off its far side.
      const R = arcade(k, plan, T, l0, rng.int(60, 104), sgn * rng.int(-2, 8));
      if (R) {
        F = foodCourt(k, plan, R, away, awaySign(l0) * rng.int(4, 24));
        exitHall(k, plan, R, l0, rng.int(-6, 6));
      }
      break;
    }
  }
  if (!F) for (const s of [away, ...lats]) { F = foodCourt(k, plan, T, s, 0); if (F) break; }
  if (!F) return false;
  plan.exits.push({parent: T, side: away, frac: rng.chance(0.5) ? rng.range(0.25, 0.4) : rng.range(0.6, 0.75)});
  for (const l of lats) plan.exits.push({parent: T, side: l, frac: rng.range(0.3, 0.7)});
  plan.frontages.push({hall: T, sides: rng.shuffle([...lats, away]), mix: 'kiosk', max: rng.int(1, 3)});
  plan.notes.push(`district:${pattern}`);
  return true;
}

const PATTERNS: [Pattern, number][] = [['row', 1], ['tee', 1], ['mall', 1.1], ['wing', 1]];

/** Arcade joining two halls that sit side by side (west hall's east wall to east hall's west wall). */
function linkArcade(k: Kit, plan: Plan, west: Area, east: Area, label: string, minY = 0): Area | null {
  const rng = k.rng;
  const h = rng.int(12, 16);
  const lo = Math.max(west.y, east.y) + 1, hi = Math.min(west.y + west.h, east.y + east.h) - 1 - h;
  if (hi < lo) return null;
  // Leave rock above the arcade for a row of units when the track block is close (minY).
  const r: Rect = {x: west.x + west.w + 1, y: rng.int(Math.min(hi, Math.max(lo, minY)), hi), w: east.x - 1 - (west.x + west.w + 1), h};
  if (r.w < 24 || !k.rectFree(r)) return null;
  const R = k.addArea(r, 'concourse', 'retail-arcade', r1(rng.range(3.4, 3.8)), west.id, {role: 'mall', label});
  k.connect(west, R, h - 2, 3.4, {pick: 'mid'});
  k.connect(east, R, h - 2, 3.4, {pick: 'mid'});
  plan.arcades.push(R);
  plan.washHosts.push(R);
  plan.frontages.push({hall: R, sides: rng.shuffle(['S', 'N'] as Side[]), mix: 'retail', max: Math.max(6, Math.round(r.w / 7))});
  return R;
}

function setP1(plan: Plan, P1: Area, others: Area[]): void {
  plan.P1 = P1;
  plan.platforms = [P1, ...others];
}

// ---------------------------------------------------------------------------------------
// Archetypes

/** Side platforms; stair passages up to one long paid mezzanine, or twin end mezzanines. */
function sideMezzanine(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(4.3, 4.7));
  const Lp = rng.int(236, 290);
  const blk = k.sideBlock(70, 60, Lp, ceil);
  plan.blocks.push(blk);
  const [P1, P2] = blk.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  setP1(plan, P1, [P2]);
  const under: ('W' | 'E')[] = rng.chance(0.7) ? ['W', 'E'] : [rng.pick(['W', 'E'] as const)];
  for (const s of under) if (!k.underpass(blk, s)) return false;
  for (const s of ['W', 'E'] as const) if (!under.includes(s)) plan.openEnds.push([P1, s], [P2, s]);
  plan.staffWalls.push([P2, 'N']);
  const PL = rng.int(10, 14);
  if (rng.chance(0.6)) {
    const pass = k.stairPassages(P1, 'S', Lp >= 266 ? rng.int(3, 4) : rng.int(2, 3), 0.1, 0.9, PL);
    if (pass.length < 2) return false;
    const M = k.mezzanine(pass, 'S', rng.int(14, 20), [rng.int(6, 18), rng.int(6, 18)], r1(rng.range(4.4, 5.0)), {label: 'Paid concourse', paid: true, role: 'mezzanine'});
    if (!M) return false;
    plan.paidHalls.push(M);
    const T = ticketHall(k, plan, M, 'S', rng.int(48, 68), rng.int(28, 40), Math.round(rng.range(-0.25, 0.25) * M.w), rng.int(5, 7));
    if (!T) return false;
    if (!district(k, plan, T, 'S', ['W', 'E'], rng.weighted(PATTERNS))) return false;
    for (const E of plan.exitHalls) if (k.sharedWall(M, E) && rng.chance(0.6)) k.fareLine(M, E, rng.int(3, 4));
    if (rng.chance(0.35)) plan.frontages.push({hall: M, sides: ['S'], mix: 'kiosk', max: 1});
    plan.notes.push('mezzanine:long');
  } else {
    const pw = k.stairPassages(P1, 'S', rng.int(1, 2), 0.05, 0.3, PL);
    const pe = k.stairPassages(P1, 'S', rng.int(1, 2), 0.7, 0.95, PL);
    if (!pw.length || !pe.length) return false;
    const MW = k.mezzanine(pw, 'S', rng.int(14, 18), [rng.int(6, 12), rng.int(6, 12)], r1(rng.range(4.2, 4.8)), {label: 'Paid concourse (west)', paid: true, role: 'mezzanine'});
    const ME = k.mezzanine(pe, 'S', rng.int(14, 18), [rng.int(6, 12), rng.int(6, 12)], r1(rng.range(4.2, 4.8)), {label: 'Paid concourse (east)', paid: true, role: 'mezzanine'});
    if (!MW || !ME) return false;
    plan.paidHalls.push(MW, ME);
    const TW = ticketHall(k, plan, MW, 'S', rng.int(40, 52), rng.int(28, 36), 0, rng.int(4, 5), 'Ticket hall (west)');
    const TE = ticketHall(k, plan, ME, 'S', rng.int(40, 52), rng.int(28, 36), 0, rng.int(4, 5), 'Ticket hall (east)');
    if (!TW || !TE) return false;
    const R = linkArcade(k, plan, TW, TE, 'Shopping concourse');
    if (!R) return false;
    if (!foodCourt(k, plan, R, 'S', Math.round(rng.range(-0.25, 0.25) * R.w))) return false;
    plan.exits.push({parent: TW, side: 'W', frac: rng.range(0.3, 0.7)}, {parent: TE, side: 'E', frac: rng.range(0.3, 0.7)}, {parent: TW, side: 'S', frac: 0.5}, {parent: TE, side: 'S', frac: 0.5});
    plan.frontages.push({hall: TW, sides: ['W', 'S'], mix: 'kiosk', max: rng.int(1, 2)}, {hall: TE, sides: ['E', 'S'], mix: 'kiosk', max: rng.int(1, 2)});
    plan.notes.push('mezzanine:twin');
  }
  return true;
}

/** Island platform reached from its ends: end halls, ticket halls and (both ends) a ring concourse. */
function islandEnds(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(4.6, 5.2));
  const Lp = rng.int(220, 276);
  const blk = k.islandBlock(120, 70, Lp, ceil, 'Platforms 1 · 2');
  plan.blocks.push(blk);
  const I = blk.platforms[0];
  I.platformNo = 1; I.towardsN = terms[0]; I.towardsS = terms[1];
  setP1(plan, I, []);
  const ends: ('W' | 'E')[] = rng.chance(0.6) ? ['W', 'E'] : [rng.pick(['W', 'E'] as const)];
  for (const s of ['W', 'E'] as const) if (!ends.includes(s)) plan.openEnds.push([I, s]);
  const blockH = blk.y1 - blk.y0 + 1;
  const halls: {s: 'W' | 'E'; MH: Area; T: Area}[] = [];
  for (const s of ends) {
    const EP = k.endPassage(blk, I, s, rng.int(3, 8));
    if (!EP) return false;
    const along = blockH + rng.int(12, 26);
    const off = Math.round((blk.y0 + blk.y1) / 2 - (EP.y + EP.h / 2)) + rng.int(4, 10);
    const MH = k.attach(EP, s, along, rng.int(22, 28), off, 'concourse', 'concourse', r1(rng.range(4.6, 5.2)), EP.id, {label: 'Paid concourse', paid: true, role: 'end-hall'}, false);
    if (!MH || !k.connect(EP, MH, EP.h - 2, 3.2, {pick: 'mid'})) return false;
    plan.paidHalls.push(MH);
    const TWd = rng.int(40, 56);
    const shift = Math.max(0, Math.min(rng.int(4, 14), Math.floor((TWd - MH.w) / 2) - 1));
    const T = ticketHall(k, plan, MH, 'S', TWd, rng.int(28, 38), s === 'W' ? shift : -shift, rng.int(4, 6));
    if (!T) return false;
    halls.push({s, MH, T});
    if (rng.chance(0.3)) plan.frontages.push({hall: MH, sides: [s], mix: 'kiosk', max: 1});
  }
  if (halls.length === 2) {
    const [w, e] = halls[0].s === 'W' ? halls : [halls[1], halls[0]];
    const R = linkArcade(k, plan, w.T, e.T, 'Underground concourse', blk.y1 + 13);
    if (!R) return false;
    if (!foodCourt(k, plan, R, 'S', Math.round(rng.range(-0.3, 0.3) * R.w))) return false;
    plan.exits.push({parent: w.T, side: 'W', frac: rng.range(0.3, 0.7)}, {parent: e.T, side: 'E', frac: rng.range(0.3, 0.7)}, {parent: w.T, side: 'S', frac: 0.5}, {parent: e.T, side: 'S', frac: 0.5});
    plan.frontages.push({hall: w.T, sides: ['W', 'S'], mix: 'kiosk', max: rng.int(1, 2)}, {hall: e.T, sides: ['E', 'S'], mix: 'kiosk', max: rng.int(1, 2)});
    plan.notes.push('ring');
  } else {
    const {s, T} = halls[0];
    if (!district(k, plan, T, 'S', [s, OPPOSITE[s]], rng.weighted(PATTERNS))) return false;
  }
  return true;
}

/** Four-track express station: two islands (cross-platform), end mezzanine(s) over the tracks. */
function express(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(4.8, 5.4));
  const Lp = rng.int(220, 268);
  const blk = k.expressBlock(130, 60, Lp, ceil);
  plan.blocks.push(blk);
  const [B, A] = blk.platforms;
  B.label = 'Platforms 1 · 2'; A.label = 'Platforms 3 · 4';
  B.platformNo = 1; A.platformNo = 3;
  B.towardsN = `${terms[1]} express`; B.towardsS = `${terms[1]} local`;
  A.towardsN = `${terms[0]} local`; A.towardsS = `${terms[0]} express`;
  setP1(plan, B, [A]);
  const ends: ('W' | 'E')[] = rng.chance(0.45) ? ['W', 'E'] : [rng.pick(['W', 'E'] as const)];
  for (const s of ['W', 'E'] as const) if (!ends.includes(s)) plan.openEnds.push([A, s], [B, s]);
  let first = true;
  for (const s of ends) {
    const beyond = rng.int(3, 7);
    const EPa = k.endPassage(blk, A, s, beyond, rng.int(9, 12));
    const EPb = k.endPassage(blk, B, s, beyond, rng.int(9, 12));
    if (!EPa || !EPb) return false;
    const along = (blk.y1 - blk.y0 + 1) + rng.int(10, 22);
    const deep = rng.int(20, 28);
    const cy = (blk.y0 + blk.y1) / 2 + rng.int(0, 8);
    const r: Rect = {x: s === 'E' ? EPa.x + EPa.w + 1 : EPa.x - 1 - deep, y: Math.round(cy - along / 2), w: deep, h: along};
    if (!k.rectFree(r)) return false;
    const MH = k.addArea(r, 'concourse', 'concourse', r1(rng.range(4.6, 5.2)), EPb.id, {label: 'Paid concourse', paid: true, role: 'end-hall'});
    if (!k.connect(EPa, MH, EPa.h - 2, 3.2, {pick: 'mid'}) || !k.connect(EPb, MH, EPb.h - 2, 3.2, {pick: 'mid'})) return false;
    plan.paidHalls.push(MH);
    if (first) {
      const T = ticketHall(k, plan, MH, s, rng.int(38, 54), rng.int(32, 46), rng.int(-4, 12), rng.int(5, 6));
      if (!T) return false;
      if (!district(k, plan, T, s, ['N', 'S'], rng.weighted(PATTERNS))) return false;
    } else {
      const T = ticketHall(k, plan, MH, s, rng.int(30, 40), rng.int(22, 30), rng.int(-4, 8), rng.int(3, 4), 'Ticket hall (far end)');
      if (!T) return false;
      plan.exits.push({parent: T, side: s, frac: rng.range(0.3, 0.7)}, {parent: T, side: rng.pick(['N', 'S'] as const), frac: 0.5});
      plan.frontages.push({hall: T, sides: ['N', 'S', s], mix: 'kiosk', max: rng.int(1, 2)});
    }
    first = false;
  }
  plan.notes.push(`ends:${ends.length}`);
  return true;
}

/** Two lines (side platforms + an offset island line) joined by a long paid transfer passage. */
function interchange(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceilA = r1(rng.range(4.2, 4.6));
  const LpA = rng.int(200, 236);
  const blkA = k.sideBlock(70, 50, LpA, ceilA);
  plan.blocks.push(blkA);
  const [P1, P2] = blkA.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  const underSide = rng.pick(['W', 'E'] as const);
  if (!k.underpass(blkA, underSide)) return false;
  const other: 'W' | 'E' = underSide === 'W' ? 'E' : 'W';
  plan.openEnds.push([P1, other], [P2, other]);
  plan.staffWalls.push([P2, 'N']);
  const pass = k.stairPassages(P1, 'S', rng.int(2, 3), 0.12, 0.88, rng.int(10, 13));
  if (pass.length < 2) return false;
  const MA = k.mezzanine(pass, 'S', rng.int(16, 20), [rng.int(6, 12), rng.int(10, 24)], r1(rng.range(4.4, 4.8)), {label: 'Paid concourse · Line 1', paid: true, role: 'mezzanine'});
  if (!MA) return false;
  plan.paidHalls.push(MA);
  // Line 2: island platform to the east, offset south, reached from its west end hall.
  const ceilB = r1(rng.range(4.6, 5.2));
  const LpB = rng.int(190, 228);
  const beyond = rng.int(3, 6);
  const deepB = rng.int(20, 26);
  const tpLen = rng.int(18, 44);
  const aEnd = Math.max(MA.x + MA.w, blkA.tx1 + (underSide === 'E' ? UNDERPASS_REACH : 0)) + 1;
  const mhbX = aEnd + 1 + tpLen + 1;
  const bpx0 = mhbX + deepB + 1 + TUN + beyond + 1;
  const by0 = MA.y - rng.int(6, 18);
  const blkB = k.islandBlock(bpx0, by0, LpB, ceilB, 'Platforms 3 · 4 (Line 2)');
  plan.blocks.push(blkB);
  const IB = blkB.platforms[0];
  IB.platformNo = 3; IB.towardsN = terms[2]; IB.towardsS = terms[3];
  const EPB = k.endPassage(blkB, IB, 'W', beyond);
  if (!EPB) return false;
  const tpH = rng.int(10, 12);
  const tpY = MA.y + rng.int(2, Math.max(2, MA.h - tpH - 2));
  const y0 = Math.min(blkB.y0 - rng.int(4, 10), tpY - 3), y1 = Math.max(blkB.y1 + rng.int(4, 12), tpY + tpH + 3);
  const mhb: Rect = {x: EPB.x - 1 - deepB, y: y0, w: deepB, h: y1 - y0};
  if (mhb.x !== mhbX || !k.rectFree(mhb)) return false;
  const MHB = k.addArea(mhb, 'concourse', 'concourse', r1(rng.range(4.6, 5.0)), EPB.id, {label: 'Paid concourse · Line 2', paid: true, role: 'end-hall'});
  if (!k.connect(EPB, MHB, EPB.h - 2, 3.2, {pick: 'mid'})) return false;
  plan.paidHalls.push(MHB);
  const tp: Rect = {x: MA.x + MA.w + 1, y: tpY, w: MHB.x - 1 - (MA.x + MA.w + 1), h: tpH};
  if (tp.w < 8 || !k.rectFree(tp)) return false;
  const TP = k.addArea(tp, 'passage', 'passage', 3.2, MA.id, {label: 'Transfer passage · Line 2', paid: true, role: 'transfer'});
  if (!k.connect(MA, TP, tpH - 2, 3.0, {pick: 'mid'}) || !k.connect(TP, MHB, tpH - 2, 3.0, {pick: 'mid'})) return false;
  if (rng.chance(0.5) && tp.w > 16) plan.frontages.push({hall: TP, sides: ['N', 'S'], mix: 'kiosk', max: rng.int(1, 2)});
  // Far end of line 2: a small exit-only ticket hall, or a staff end.
  if (rng.chance(0.5)) {
    const EP2 = k.endPassage(blkB, IB, 'E', rng.int(3, 6));
    const MH2 = EP2 && k.attach(EP2, 'E', (blkB.y1 - blkB.y0) + rng.int(8, 16), rng.int(20, 24), Math.round((blkB.y0 + blkB.y1) / 2 - (EP2.y + EP2.h / 2)), 'concourse', 'concourse', 4.6, EP2.id, {label: 'Paid concourse · Line 2 east', paid: true, role: 'end-hall'}, false);
    if (EP2 && MH2 && k.connect(EP2, MH2, EP2.h - 2, 3.2, {pick: 'mid'})) {
      plan.paidHalls.push(MH2);
      const T2 = ticketHall(k, plan, MH2, 'E', rng.int(30, 40), rng.int(22, 30), 0, rng.int(3, 4), 'Ticket hall · Line 2');
      if (T2) plan.exits.push({parent: T2, side: 'E', frac: 0.5}, {parent: T2, side: rng.pick(['N', 'S'] as const), frac: 0.5});
    } else plan.openEnds.push([IB, 'E']);
  } else plan.openEnds.push([IB, 'E']);
  setP1(plan, P1, [P2, IB]);
  const T = ticketHall(k, plan, MA, 'S', rng.int(48, 64), rng.int(28, 38), Math.round(rng.range(-0.3, 0.1) * MA.w), rng.int(5, 7));
  if (!T) return false;
  if (!district(k, plan, T, 'S', ['W', 'E'], rng.weighted(PATTERNS))) return false;
  plan.notes.push(`transfer:${tp.w}`);
  return true;
}

/** Shallow station with separate fare controls and ticket halls on both sides of the tracks. */
function split(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(4.0, 4.4));
  const Lp = rng.int(230, 280);
  const blk = k.sideBlock(80, 130, Lp, ceil);
  plan.blocks.push(blk);
  const [P1, P2] = blk.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  setP1(plan, P1, [P2]);
  const endSide = rng.pick(['W', 'E'] as const);
  const [f0, f1] = endSide === 'W' ? [0.05, 0.42] : [0.58, 0.95];
  const PL = rng.int(8, 12);
  const passS = k.stairPassages(P1, 'S', rng.int(1, 2), f0, f1, PL);
  const passN = k.stairPassages(P2, 'N', rng.int(1, 2), f0, f1, PL);
  if (!passS.length || !passN.length) return false;
  const MS = k.mezzanine(passS, 'S', rng.int(12, 16), [rng.int(4, 10), rng.int(4, 10)], r1(rng.range(3.4, 3.9)), {label: 'Fare concourse · Platform 1', paid: true, role: 'mezzanine'});
  const MN = k.mezzanine(passN, 'N', rng.int(12, 16), [rng.int(4, 10), rng.int(4, 10)], r1(rng.range(3.4, 3.9)), {label: 'Fare concourse · Platform 2', paid: true, role: 'mezzanine'});
  if (!MS || !MN) return false;
  plan.paidHalls.push(MS, MN);
  const TS = ticketHall(k, plan, MS, 'S', rng.int(40, 56), rng.int(26, 34), rng.int(-8, 8), rng.int(4, 5), 'Ticket hall · Platform 1');
  const TN = ticketHall(k, plan, MN, 'N', rng.int(36, 50), rng.int(22, 30), rng.int(-8, 8), rng.int(3, 4), 'Ticket hall · Platform 2');
  if (!TS || !TN) return false;
  const paidCross = rng.chance(0.4);
  if (paidCross) {
    if (!k.underpass(blk, rng.pick(['W', 'E'] as const))) return false;
  }
  for (const s of ['W', 'E'] as const) if (!k.areas.some(a => a.type === 'underpass' && (s === 'W' ? a.x < blk.px0 : a.x > blk.px1))) plan.openEnds.push([P1, s], [P2, s]);
  let laterals: Side[] = ['W', 'E'];
  if (!paidCross) {
    // Unpaid crossunder around the near track end: south leg, cross passage, north leg.
    const e = endSide === 'E';
    const extent = (a: Area) => (e ? a.x + a.w : -a.x);
    const far = Math.max(extent(TS), extent(TN), extent(MS), extent(MN), e ? blk.tx1 : -blk.tx0) + rng.int(6, 12);
    const vw = rng.int(10, 12);
    const vx = e ? far : -far - vw;
    const legH = rng.int(10, 12);
    const sy = TS.y + rng.int(2, Math.max(2, TS.h - legH - 2)), ny = TN.y + rng.int(2, Math.max(2, TN.h - legH - 2));
    const V: Rect = {x: vx, y: ny - 2, w: vw, h: sy + legH + 2 - (ny - 2)};
    const C1: Rect = e ? {x: TS.x + TS.w + 1, y: sy, w: vx - 1 - (TS.x + TS.w + 1), h: legH} : {x: vx + vw + 1, y: sy, w: TS.x - 1 - (vx + vw + 1), h: legH};
    const C2: Rect = e ? {x: TN.x + TN.w + 1, y: ny, w: vx - 1 - (TN.x + TN.w + 1), h: legH} : {x: vx + vw + 1, y: ny, w: TN.x - 1 - (vx + vw + 1), h: legH};
    if (C1.w < 3 || C2.w < 3 || !k.rectFree(V) || !k.rectFree(C1) || !k.rectFree(C2)) return false;
    const Va = k.addArea(V, 'concourse', 'concourse', 3.2, TS.id, {label: 'Crossunder', role: 'crossunder'});
    const C1a = k.addArea(C1, 'concourse', 'retail-arcade', r1(rng.range(3.2, 3.6)), TS.id, {label: 'Pedestrian concourse', role: 'mall'});
    const C2a = k.addArea(C2, 'concourse', 'retail-arcade', r1(rng.range(3.2, 3.6)), TN.id, {label: 'Pedestrian concourse', role: 'mall'});
    for (const [a, b] of [[TS, C1a], [C1a, Va], [Va, C2a], [C2a, TN]] as const) if (!k.connect(a, b, legH - 2, 3.2, {pick: 'mid'})) return false;
    plan.arcades.push(C1a, C2a);
    plan.washHosts.push(C1a, C2a);
    plan.frontages.push({hall: C1a, sides: ['N', 'S'], mix: 'retail', max: rng.int(2, 5)}, {hall: C2a, sides: ['N', 'S'], mix: 'retail', max: rng.int(2, 5)});
    laterals = [e ? 'W' : 'E'];
    plan.notes.push('crossunder:unpaid');
  } else plan.notes.push('crossunder:paid');
  if (!district(k, plan, TS, 'S', laterals, rng.weighted(PATTERNS))) return false;
  // North side: a smaller arcade toward the middle of the station, exits off the north hall.
  const inward: Side = endSide === 'E' ? 'W' : 'E';
  const RN = arcade(k, plan, TN, inward, rng.int(36, 70), rng.int(-4, 4), 'North concourse');
  if (RN) plan.exits.push({parent: RN, side: inward, frac: 0.5});
  plan.exits.push({parent: TN, side: 'N', frac: rng.range(0.3, 0.7)});
  plan.frontages.push({hall: TN, sides: ['N', endSide], mix: 'kiosk', max: rng.int(1, 2)});
  plan.staffWalls.push([P2, 'N'], [P1, 'S']);
  return true;
}

/** Deep-level station: lower concourse, long escalator hall up to the upper concourse and fare line. */
function deep(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  const ceil = r1(rng.range(5.4, 6.2));
  const Lp = rng.int(220, 270);
  let LC: Area | null;
  let dir: Side;
  if (rng.chance(0.5)) {
    const blk = k.islandBlock(120, 60, Lp, ceil, 'Platforms 1 · 2');
    plan.blocks.push(blk);
    const I = blk.platforms[0];
    I.platformNo = 1; I.towardsN = terms[0]; I.towardsS = terms[1];
    setP1(plan, I, []);
    const s = rng.pick(['W', 'E'] as const);
    plan.openEnds.push([I, s === 'W' ? 'E' : 'W']);
    const EP = k.endPassage(blk, I, s, rng.int(3, 6));
    if (!EP) return false;
    const along = (blk.y1 - blk.y0 + 1) + rng.int(4, 12);
    LC = k.attach(EP, s, along, rng.int(18, 24), Math.round((blk.y0 + blk.y1) / 2 - (EP.y + EP.h / 2)) + rng.int(0, 6), 'concourse', 'concourse', r1(rng.range(4.4, 4.8)), EP.id, {label: 'Lower concourse', paid: true, role: 'end-hall'}, false);
    if (!LC || !k.connect(EP, LC, EP.h - 2, 3.2, {pick: 'mid'})) return false;
    dir = rng.chance(0.5) ? 'S' : s;
    plan.notes.push('deep:island');
  } else {
    const blk = k.sideBlock(70, 60, Lp, ceil);
    plan.blocks.push(blk);
    const [P1, P2] = blk.platforms;
    P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
    setP1(plan, P1, [P2]);
    for (const s of ['W', 'E'] as const) if (!k.underpass(blk, s)) return false;
    plan.staffWalls.push([P2, 'N']);
    const pass = k.stairPassages(P1, 'S', rng.int(1, 2), 0.35, 0.65, rng.int(8, 10));
    if (!pass.length) return false;
    LC = k.mezzanine(pass, 'S', rng.int(12, 16), [rng.int(6, 14), rng.int(6, 14)], r1(rng.range(4.2, 4.6)), {label: 'Lower concourse', paid: true, role: 'mezzanine'});
    if (!LC) return false;
    dir = 'S';
    plan.notes.push('deep:side');
  }
  plan.paidHalls.push(LC);
  const ew = rng.int(10, 12);
  const ES = k.attach(LC, dir, ew, rng.int(48, 76), rng.int(-6, 6), 'passage', 'passage', r1(rng.range(4.6, 5.0)), LC.id, {label: 'Escalator hall', paid: true, role: 'escalator'});
  if (!ES || !k.connect(LC, ES, ew - 2, 4.0, {pick: 'mid'})) return false;
  const UM = k.attach(ES, dir, rng.int(36, 56), rng.int(14, 20), rng.int(-10, 10), 'concourse', 'concourse', r1(rng.range(4.4, 5.0)), ES.id, {label: 'Upper concourse', paid: true, role: 'mezzanine'});
  if (!UM || !k.connect(ES, UM, ew - 2, 4.0, {pick: 'mid'})) return false;
  plan.paidHalls.push(UM);
  const T = ticketHall(k, plan, UM, dir, rng.int(44, 60), rng.int(26, 36), rng.int(-8, 8), rng.int(4, 6));
  if (!T) return false;
  if (!district(k, plan, T, dir, LATERAL[dir].slice(), rng.weighted([['mall', 1.4], ['wing', 1.2], ['tee', 0.8]] as [Pattern, number][]))) return false;
  plan.notes.push(`escalator:${ES.w > ES.h ? ES.w : ES.h}`);
  return true;
}
