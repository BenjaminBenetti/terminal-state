// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): validation of layout version 4 (generation retry guard + tests) —
// every version-3 rule (gen/market/v3/barValidate.ts barSettleIssues, record version 4, the den's sealed back room exempt from the
// "every walkable cell reachable" rule) plus THE DEN's own:
//  - the record: its areas (ground storey), its door (a real opening off the Back Lane into the den's passage), its two fixtures (the kinds
//    of gen/market/v4/denKinds.ts, where the record says, the chute's rim at its base + the kit's rim height);
//  - SEALED: every floor cell joining the back room to any other floor lies under the booth (blocked, inside its box), the booth spans
//    the whole opening between solid jambs, its front toward the customer room; no cell of the back room is reachable on foot (the
//    walking flood with prop footprints as blockers, stairs and ladders included);
//  - REACHABLE: the door, the customer's spot and the chute on foot from the start; and carrying a body (DEN_RULES.carry: a 1 m clear disc,
//    i.e. >= 1.5 m wide ways) to within DEN_RULES.reach of the door, the chute and the customer's spot;
//  - the dealing: the payout spot (tray) clear floor DEN_RULES.tray in front of the booth's face on its centre line, a DEN_RULES.trayClear
//    disc free of every prop / the chute / a doorway; the customer's spot clear floor in front of the booth within DEN_RULES.frontChute
//    of the chute; the buyer's post clear floor in the back room right behind the booth, facing the customer; clear floor all round the
//    chute (one cell);
//  - nothing overlaps (the den's props against every prop), its props on its own floor; headroom; the rock border; no resident spot /
//    stall in the den; holders carry the market's empty key;
//  - discoverable: the painted boards over the door on the Back Lane side (wall-backed: the name and the price), the booth's board; a red
//    lamp near the booth, an ordinary one in the passage, every den lamp dim.

import {CELL, FLOOR, SOLID} from '../../grid';
import {levelDistance} from '../../levelGen';
import {doorClearVolumes, signDims, wallBacked} from '../../doorways';
import {PROP_DEFS, type PropPlacement} from '../../props';
import type {StationLayout} from '../../stationTypes';
import {isLootHolderKind} from '../../../items/loot';
import {MARKET_EMPTY_KEY} from '../dress';
import {marketStandOk} from '../spots';
import {SETTLE} from '../v2/frame';
import {barSettleIssues} from '../v3/barValidate';
import {CORPSE_BOOTH_KIND, CORPSE_CHUTE_KIND, isCorpseDenKind} from './denKinds';
import {DEN_RIM_Y} from './denRecord';

export const DEN_RULES = {
  /** A body carrier's clear radius (m: a 1.5 m-wide way on the 0.5 m grid) and how near (m) it must get to the door / chute / spot. */
  carry: 0.5,
  reach: 1.2,
  /** The tray: its distance in front of the booth's face (m), off the booth's centre line at most (m), its clear radius (m). */
  tray: [0.35, 0.5] as const,
  trayAlong: 0.3,
  trayClear: 0.35,
  /** The customer's spot: in front of the booth's face (m), off its centre line at most (m), from the chute's centre at most (m). */
  front: [0.7, 1.4] as const,
  frontAlong: 0.6,
  frontChute: 2.0,
  /** The buyer: behind the booth's back face (m). */
  buyer: [0.4, 0.8] as const,
  /** The chute's near edge from the booth's front face at most (m). */
  chuteBooth: 2.6,
  /** Lane boards: within this of the door's centre (m). Den headroom (m). Den lamps at most this power; red = r over this x g / b. */
  signNear: 1.6,
  headroom: 2.4,
  dim: 0.6,
  red: 1.5,
} as const;

const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;

/** Every version-4 rule: version 3's (record version 4, the back room sealed) and the den's. */
export function denSettleIssues(layout: StationLayout): string[] {
  const den = layout.market?.den;
  return [...barSettleIssues(layout, {v: 4, sealed: den ? [den.back] : []}), ...denIssues(layout)];
}

/** The den's own rules (gen/market/v4/denValidate.ts header). */
export function denIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const m = layout.market, den = m?.den;
  if (!m || !den) return ['no den'];
  if (m.v !== 4) issues.push('a den on a record that is not version 4');
  const g = layout.grid, W = g.w, H = g.h, A = layout.areas;
  const room = A[den.area], back = A[den.back];
  if (!room || !back || (room.level ?? 0) || (back.level ?? 0) || room === back) return [...issues, 'den areas'];
  // --- the door: a real opening off the Back Lane into the den's passage --------------------------------------------------------
  const door = layout.doors.find(d => (d.level ?? 0) === 0 && near(d.x * CELL, den.door.x0) && near(d.y * CELL, den.door.z0) && near((d.x + d.w) * CELL, den.door.x1) && near((d.y + d.h) * CELL, den.door.z1));
  if (!door) return [...issues, 'den door record'];
  const lane = A[door.a], passage = A[door.b];
  if (!lane || lane.label !== 'Back Lane' || !passage || passage.id === room.id || passage.id === back.id) issues.push('den door not off the Back Lane into its passage');
  if (!near(den.door.x, (den.door.x0 + den.door.x1) / 2) || !near(den.door.z, (den.door.z0 + den.door.z1) / 2) || den.door.y !== 0 || den.door.level !== 0) issues.push('den door point');
  const mine = new Set([room.id, back.id, passage?.id ?? -1]);
  // --- the cells: ground storey only (rock above), headroom, the rock border ---------------------------------------------------
  let low = 0, border = 0, stacked = 0;
  const doorCell = (x: number, y: number) => x >= door.x && x < door.x + door.w && y >= door.y && y < door.y + door.h;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== FLOOR || !mine.has(g.area[i])) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) border++;
    if (!g.blocked[i] && !doorCell(x, y) && g.ceil[i] - g.floorOf(i) < DEN_RULES.headroom - 1e-6) low++;
    if (g.ceil[i] > SETTLE.cont + 1e-6) low++;
    for (const L of layout.levels) if (L.id !== 0 && L.grid.cells[i] !== SOLID) stacked++;
  }
  if (low) issues.push(`${low} den cells without container headroom`);
  if (border) issues.push(`${border} den cells on the canvas border`);
  if (stacked) issues.push(`${stacked} den cells under another storey's floor`);

  // --- the fixtures ----------------------------------------------------------------------------------------------------------------
  const chute = layout.props[den.chute.prop], booth = layout.props[den.booth.prop];
  if (chute?.kind !== CORPSE_CHUTE_KIND || booth?.kind !== CORPSE_BOOTH_KIND) return [...issues, 'den fixtures'];
  if (layout.props.filter(p => p.kind === CORPSE_CHUTE_KIND).length !== 1 || layout.props.filter(p => p.kind === CORPSE_BOOTH_KIND).length !== 1) issues.push('not exactly one chute and one booth');
  if (!near(chute.x, den.chute.x) || !near(chute.z, den.chute.z) || chute.rot !== den.chute.yaw || (chute.level ?? 0) || chute.y !== 0 || chute.area !== room.id) issues.push('den chute record');
  if (!near(den.chute.rimY, chute.y + DEN_RIM_Y)) issues.push('den chute rim height');
  if (!near(booth.x, den.booth.x) || !near(booth.z, den.booth.z) || booth.rot !== den.booth.yaw || (booth.level ?? 0) || booth.y !== 0 || booth.area !== room.id) issues.push('den booth record');
  for (const p of [den.chute, den.booth, den.buyer, den.front, den.booth.tray]) if (p.y !== 0 || p.level !== 0) issues.push('den point off the ground floor');
  const bd = PROP_DEFS[CORPSE_BOOTH_KIND].d, dx = Math.sin(booth.rot), dz = Math.cos(booth.rot); // the booth's front (+Z) direction
  const out = (x: number, z: number) => (x - booth.x) * dx + (z - booth.z) * dz - bd / 2; // in front of its front face (m)
  const along = (x: number, z: number) => Math.abs((x - booth.x) * dz - (z - booth.z) * dx);
  const inBox = (p: PropPlacement, x: number, z: number, pad = 0) => Math.abs(x - p.x) <= p.hx + pad && Math.abs(z - p.z) <= p.hz + pad;
  const boxDist = (p: PropPlacement, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - p.x) - p.hx), Math.max(0, Math.abs(z - p.z) - p.hz));

  // --- sealed: the booth closes the only way into the back room ----------------------------------------------------------------
  const opening = new Set<number>();
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== FLOOR || g.area[i] !== back.id) continue;
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= g.cells.length || g.cells[j] === SOLID || g.area[j] === back.id) continue;
      const [jx, jz] = g.center(j % W, (j / W) | 0);
      if (g.cells[j] !== FLOOR || !g.blocked[j] || !inBox(booth, jx, jz)) { issues.push(`back room open at cell ${j % W},${(j / W) | 0}`); continue; }
      opening.add(j);
    }
  }
  if (!opening.size) issues.push('the booth stands in no opening of the back room');
  else {
    const cs = [...opening].map(j => [j % W, (j / W) | 0] as const);
    const xs = new Set(cs.map(c => c[0])), ys = new Set(cs.map(c => c[1]));
    const alongZ = xs.size === 1; // the opening runs along z (the booth wall is a column)
    const [lo, hi] = alongZ ? [Math.min(...ys), Math.max(...ys)] : [Math.min(...xs), Math.max(...xs)];
    if (!(alongZ || ys.size === 1) || hi - lo + 1 !== opening.size) issues.push('the booth opening is not one straight run');
    const fixed = alongZ ? [...xs][0] : [...ys][0];
    const jamb = (k: number) => g.get(alongZ ? fixed : k, alongZ ? k : fixed) === SOLID;
    if (!jamb(lo - 1) || !jamb(hi + 1)) issues.push('the booth opening has no solid jambs');
    const s0 = lo * CELL, s1 = (hi + 1) * CELL, c = alongZ ? booth.z : booth.x, half = alongZ ? booth.hz : booth.hx;
    if (c - half > s0 + 1e-3 || c + half < s1 - 1e-3) issues.push('the booth does not span its opening');
    if ((alongZ ? Math.abs(dz) : Math.abs(dx)) > 1e-6) issues.push('the booth does not face across its opening');
  }
  if (!(out(den.front.x, den.front.z) > 0)) issues.push('the booth faces away from the customer');
  // the back room on foot: never (the start's flood, prop footprints blocking, stairs and ladders included)
  const sp = layout.playerSpawn, [sx, sy] = g.cellOf(sp.x, sp.z);
  const walk = levelDistance(layout.levels, sx, sy, 0, layout.levelLinks)[0];
  let open = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.area[i] === back.id && walk[i] >= 0) open++;
  if (open) issues.push(`${open} back-room cells reachable on foot`);

  // --- reachable: on foot, and carrying a body ------------------------------------------------------------------------------------
  const onFoot = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && walk[g.idx(cx, cy)] >= 0; };
  if (![...Array(door.h * door.w).keys()].every(k => walk[g.idx(door.x + (k % door.w), door.y + Math.floor(k / door.w))] >= 0)) issues.push('den door unreachable on foot');
  if (!onFoot(den.front.x, den.front.z)) issues.push('den front unreachable on foot');
  const carry = carryField(layout, sx, sy);
  const carryNear = (d: (x: number, z: number) => number) => {
    for (let i = 0; i < carry.length; i++) if (carry[i]) { const [x, z] = g.center(i % W, (i / W) | 0); if (d(x, z) <= DEN_RULES.reach) return true; }
    return false;
  };
  if (!carryNear((x, z) => Math.hypot(x - den.door.x, z - den.door.z))) issues.push('den door out of reach carrying a body');
  if (!carryNear((x, z) => boxDist(chute, x, z))) issues.push('den chute out of reach carrying a body');
  if (!carryNear((x, z) => Math.hypot(x - den.front.x, z - den.front.z))) issues.push('den front out of reach carrying a body');
  {
    let reach = false;
    for (let i = 0; i < walk.length && !reach; i++) if (walk[i] >= 0) { const [x, z] = g.center(i % W, (i / W) | 0); if (boxDist(chute, x, z) <= 0.75) reach = true; }
    if (!reach) issues.push('den chute unreachable on foot');
  }

  // --- the dealing: the tray, the customer, the buyer, the chute's floor ----------------------------------------------------------
  const t = den.booth.tray, to = out(t.x, t.z);
  if (to < DEN_RULES.tray[0] - 1e-3 || to > DEN_RULES.tray[1] + 1e-3 || along(t.x, t.z) > DEN_RULES.trayAlong) issues.push(`den tray ${to.toFixed(2)} m in front of the booth`);
  if (!g.circleClear(t.x, t.z, DEN_RULES.trayClear) || g.area[g.idx(...g.cellOf(t.x, t.z))] !== room.id) issues.push('den tray not on clear floor');
  for (const [k, p] of layout.props.entries()) if (p.y < 1.0 && !p.mounted && boxDist(p, t.x, t.z) < DEN_RULES.trayClear - 1e-6) issues.push(`den tray under ${p.kind}#${k}`);
  for (const v of doorClearVolumes(layout)) if (t.x > v.x0 - DEN_RULES.trayClear && t.x < v.x1 + DEN_RULES.trayClear && t.z > v.z0 - DEN_RULES.trayClear && t.z < v.z1 + DEN_RULES.trayClear) issues.push('den tray in a doorway');
  if (Math.hypot(t.x - den.front.x, t.z - den.front.z) > 1.2) issues.push('den tray out of the customer\'s reach');
  const fo = out(den.front.x, den.front.z);
  if (!marketStandOk(g, den.front.x, den.front.z) || g.area[g.idx(...g.cellOf(den.front.x, den.front.z))] !== room.id) issues.push('den front not on clear floor');
  if (fo < DEN_RULES.front[0] - 1e-3 || fo > DEN_RULES.front[1] + 1e-3 || along(den.front.x, den.front.z) > DEN_RULES.frontAlong) issues.push(`den front ${fo.toFixed(2)} m in front of the booth`);
  if (Math.hypot(den.front.x - chute.x, den.front.z - chute.z) > DEN_RULES.frontChute) issues.push('den front too far from the chute');
  const bu = den.buyer, bo = -out(bu.x, bu.z) - bd;
  if (!marketStandOk(g, bu.x, bu.z) || g.area[g.idx(...g.cellOf(bu.x, bu.z))] !== back.id) issues.push('den buyer not on clear floor in the back room');
  if (bo < DEN_RULES.buyer[0] - 1e-3 || bo > DEN_RULES.buyer[1] + 1e-3 || along(bu.x, bu.z) > 0.3) issues.push(`den buyer ${bo.toFixed(2)} m behind the booth`);
  if (-Math.sin(bu.yaw) * dx - Math.cos(bu.yaw) * dz < 0.99) issues.push('den buyer does not face the customer');
  const ce = out(chute.x, chute.z) - (Math.abs(dx) * chute.hx + Math.abs(dz) * chute.hz); // the chute's near edge in front of the booth
  if (ce < 0.5 || ce > DEN_RULES.chuteBooth) issues.push(`den chute ${ce.toFixed(2)} m in front of the booth`);
  {
    const [x0, y0] = g.cellOf(chute.x - chute.hx + 0.04, chute.z - chute.hz + 0.04), [x1, y1] = g.cellOf(chute.x + chute.hx - 0.04, chute.z + chute.hz - 0.04);
    let ring = 0;
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if ((x < x0 || x > x1 || y < y0 || y > y1) && !g.walkable(x, y)) ring++;
    if (ring) issues.push(`den chute: ${ring} cells round it not clear floor`);
  }

  // --- the den's props: on its floor, overlapping nothing; holders empty ------------------------------------------------------------
  const own = layout.props.map((p, k) => [p, k] as const).filter(([p]) => mine.has(p.area) || isCorpseDenKind(p.kind));
  for (const [p, k] of own) {
    if (!mine.has(p.area) || (p.level ?? 0)) issues.push(`den prop ${p.kind}#${k} off the den`);
    if (isLootHolderKind(p.kind) && p.purpose !== MARKET_EMPTY_KEY) issues.push(`den ${p.kind}#${k} with loot key ${p.purpose}`);
    if (p.host !== undefined) continue;
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (!mine.has(g.area[g.idx(cx, cy)])) issues.push(`den prop ${p.kind}#${k} not on the den's floor`);
    for (const [q, j] of layout.props.entries()) {
      if (j === k || q.host === k || p.host === j || (q.level ?? 0) !== (p.level ?? 0)) continue;
      const ox = Math.min(p.x + p.hx, q.x + q.hx) - Math.max(p.x - p.hx, q.x - q.hx), oz = Math.min(p.z + p.hz, q.z + q.hz) - Math.max(p.z - p.hz, q.z - q.hz);
      const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (ox > 0.005 && oz > 0.005 && oy > 0.005) issues.push(`den prop ${p.kind}#${k} overlaps ${q.kind}#${j}`);
    }
  }
  if (m.spots.some(s => mine.has(s.area))) issues.push('a resident spot in the den');
  if (m.stalls.some(s => mine.has(s.area))) issues.push('a stall in the den');

  // --- discoverable: the boards, the lamps ---------------------------------------------------------------------------------------
  const laneSigns = layout.signs.filter(s => s.area === lane?.id && !s.hang && Math.hypot(s.x - den.door.x, s.z - den.door.z) <= DEN_RULES.signNear);
  const backed = (s: (typeof layout.signs)[number]) => {
    if (!lane) return false;
    const side = Math.sin(s.rot) > 0.5 ? 'W' : Math.sin(s.rot) < -0.5 ? 'E' : Math.cos(s.rot) > 0.5 ? 'N' : 'S';
    const {w, h} = signDims(s), alongX = side === 'N' || side === 'S', c = alongX ? s.x : s.z;
    return wallBacked(g, lane, side, c - w / 2, c + w / 2, s.y - h / 2);
  };
  if (!laneSigns.some(s => /BODIES/i.test(s.text) && backed(s))) issues.push('no wall-backed board naming the den over its door');
  if (!laneSigns.some(s => /\bTIES\b/i.test(s.text) && backed(s))) issues.push('no price board over the den door');
  if (!layout.signs.some(s => s.area === room.id && /\bTIES\b/i.test(s.text))) issues.push('no board at the booth');
  const lamps = layout.lights.filter(l => mine.has(l.area));
  const red = (l: (typeof lamps)[number]) => !!l.tint && l.tint[0] > DEN_RULES.red * Math.max(l.tint[1], l.tint[2]);
  if (!lamps.some(l => l.area === room.id && red(l) && Math.hypot(l.x - booth.x, l.z - booth.z) <= 2.5)) issues.push('no red lamp near the booth');
  if (passage && !lamps.some(l => l.area === passage.id && !l.tint)) issues.push('no lamp in the den passage');
  for (const l of lamps) if (l.power > DEN_RULES.dim || l.broken || (l.level ?? 0) || l.y > room.ceil) issues.push('a den lamp not dim / hung under its ceiling');
  return issues;
}

/** Cells (level 0) a body carrier reaches from the start: walkable with a DEN_RULES.carry clear disc round the cell's centre. */
function carryField(layout: StationLayout, sx: number, sy: number): Uint8Array {
  const g = layout.grid, W = g.w, n = g.cells.length, seen = new Uint8Array(n), ok = new Int8Array(n).fill(-1);
  const pass = (i: number) => {
    if (ok[i] < 0) { const x = i % W, y = (i / W) | 0, [cx, cz] = g.center(x, y); ok[i] = g.walkable(x, y) && g.rampIdx[i] < 0 && g.circleClear(cx, cz, DEN_RULES.carry) ? 1 : 0; }
    return ok[i] === 1;
  };
  // (the start itself: the nearest carry-clear cell to it)
  let s = -1;
  for (let r = 0; r <= 3 && s < 0; r++) for (let dy = -r; dy <= r && s < 0; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = sx + dx, y = sy + dy;
    if (g.inBounds(x, y) && pass(g.idx(x, y))) { s = g.idx(x, y); break; }
  }
  if (s < 0) return seen;
  const q = [s];
  seen[s] = 1;
  while (q.length) {
    const c = q.pop()!, x = c % W;
    for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (j < 0 || j >= n || seen[j] || !pass(j)) continue;
      if (Math.abs(g.floorOf(j) - g.floorOf(c)) > 0.2) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
