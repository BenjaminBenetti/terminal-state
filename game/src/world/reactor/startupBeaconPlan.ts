// Task reactor-playtest-round2-20261102 (lane STARTUP): WHERE THE ORANGE ROTATING BEACONS GO — user: "spinning orange lights as the
// building comes to life!". Pure (no three.js): world/reactor/startupBeacons.ts draws them, world/reactor/pathsAudit.ts audits their
// solids, the tests check their support.
//
// Every beacon is MOUNTED on real structure: on a pit WALL of a storey (the rim and every tier down to the core floor), on its own
// bracket (a wall plate bolted to the face, an arm out to a round pedestal the beacon head sits on), above one of the storey's mounted
// wall lamps (gen/reactor/gaslightLamps.ts: those wall points are already clear of openings, pipe banks, fans and walkways at lamp
// height). The beacon stands higher (BEACONS.aboveDeck over the deck, under the ceiling / the deck above with a clearance), so its spot
// is re-checked there: solid wall behind the plate at that height on every storey (no doorway / room / passage behind it), no walkway
// or flight floor passing at the head (any storey), clear of the fans and pipe banks, inside its storey's open band. At most
// BEACONS.perStorey per storey, spread round the pit (evenly by angle about the vessel, at least minGap apart). Deterministic: a pure
// function of the layout.

import type {Grid} from '../../gen/grid';
import {FLOOR, SOLID} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import {PIT_LAMPS} from '../../gen/reactor/gaslightLamps';

/** Beacon tunables (m). */
export const BEACONS = {
  /** Beacons per pit storey (rim, tiers, core floor) and their minimum spacing on a storey. */
  perStorey: 4, minGap: 7,
  /** Pedestal top (the head's base) above the storey's deck: over the wall lamp (2.55) and the painted tier band (~3.0). */
  aboveDeck: 4.1, minAboveLamp: 1.1,
  /** Head top + this stays under the storey's ceiling. */
  ceilClear: 0.35,
  /** Head centre out of the wall face. */
  out: 0.34,
  /** Body (local frame: origin on the wall face at the pedestal top, +Z out of the wall, +Y up). */
  plate: {w: 0.22, h: 0.34, d: 0.016, y: -0.1},
  arm: {w: 0.07, h: 0.06},
  brace: {w: 0.05},
  pedestal: {r: 0.13, h: 0.05},
  /** The rotating head: a lens of radius r over a collar, total height h above the pedestal top. */
  head: {r: 0.115, collar: 0.04, h: 0.3},
  /** Walkway / flight clearance at the head (any storey): no floor within (y - below, y + above). */
  clearBelow: 2.2, clearAbove: 0.7,
} as const;

/**
 * One mounted beacon. `x / y / z` = the wall face point at the pedestal top; n = out of the wall; head = the lens centre. `tier` = the
 * layout level of the storey it marks (the deck it stands over: its power follows that tier); `level` = the level whose open band
 * holds the head (culling: both).
 */
export interface BeaconSpot {
  tier: number;
  level: number;
  x: number; y: number; z: number;
  nx: number; nz: number;
  head: {x: number; y: number; z: number};
  /** The deck height of its storey (QA). */
  deckY: number;
  /** A deterministic phase (rad) so the beacons never turn in lockstep. */
  phase: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function cellIdx(g: Grid, x: number, z: number): number {
  const [cx, cy] = g.cellOf(x, z);
  return g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
}

/** Something open behind the wall at height y on ANY storey (a doorway, a room, a passage): no wall to bolt onto. */
export function openBehind(layout: StationLayout, x: number, y: number, z: number, below = 0.25, above = 0.45): boolean {
  for (const L of layout.levels) {
    const g = L.grid, i = cellIdx(g, x, z);
    if (i < 0 || g.cells[i] === SOLID) continue;
    const f = g.floorOf(i), c = g.hasCeil(i) ? g.ceil[i] : Infinity;
    if (f <= y + above && c >= y - below) return true;
  }
  return false;
}

/** A walkway / flight floor passes at height y at (x, z) on any storey: within (y - below, y + above). */
export function walkwayAt(layout: StationLayout, x: number, y: number, z: number, below: number = BEACONS.clearBelow, above: number = BEACONS.clearAbove): boolean {
  for (const L of layout.levels) {
    const g = L.grid, i = cellIdx(g, x, z);
    if (i < 0 || g.cells[i] !== FLOOR) continue;
    const f = g.floorAt(x, z);
    if (f > y - below && f < y + above) return true;
  }
  return false;
}

/** The beacons of a Reactor layout (empty elsewhere). */
export function planBeacons(layout: StationLayout): BeaconSpot[] {
  const info = layout.reactor;
  if (!info) return [];
  const B = BEACONS, cx = info.pit.cx, cz = info.pit.cz;
  const byLevel = new Map<number, {spot: BeaconSpot; ang: number}[]>();
  for (const l of layout.lights ?? []) {
    const m = l.mount;
    if (!m || m.kind !== 'wall' || l.virtual) continue;
    // the storey the lamp was planned for (its deck = the bracket height - PIT_LAMPS.wallY; a lamp's `level` is the band that holds
    // its head, which over the open pit can be another storey's)
    const deckY = m.y - PIT_LAMPS.wallY;
    let tier = info.tiers[0];
    for (const t of info.tiers) if (Math.abs(t.baseY - deckY) < Math.abs(tier.baseY - deckY)) tier = t;
    if (!tier || Math.abs(tier.baseY - deckY) > 0.6) continue;
    const nl = Math.hypot(m.nx, m.nz) || 1, nx = m.nx / nl, nz = m.nz / nl;
    const hx = m.x + nx * B.out, hz = m.z + nz * B.out;
    // the storey band that holds the head (the tier's own first, then the lamp's, then any): open, floor below, ceiling above
    let lv = -1, y = deckY + B.aboveDeck;
    for (const id of [tier.level, l.level ?? 0, ...layout.levels.map(q => q.id)]) {
      const g = layout.levels[id]?.grid;
      if (!g) continue;
      const hi = cellIdx(g, hx, hz);
      if (hi < 0 || g.cells[hi] === SOLID) continue;
      const ceil = g.ceilAt(hx, hz), yy = Math.min(deckY + B.aboveDeck, ceil - B.head.h - B.ceilClear);
      if (yy < m.y + B.minAboveLamp || g.floorOf(hi) > yy - 0.3) continue; // no room above the lamp under this band's ceiling
      lv = id; y = yy;
      break;
    }
    if (lv < 0) continue;
    // solid wall behind the plate over its whole height; no walkway / flight at the head or just out from it; clear of fans / banks
    const bx = m.x - nx * 0.25, bz = m.z - nz * 0.25;
    if (openBehind(layout, bx, y + B.plate.y, bz, B.plate.h / 2, B.plate.h / 2 + B.head.h)) continue;
    if (walkwayAt(layout, hx, y, hz) || walkwayAt(layout, m.x + nx * 0.8, y, m.z + nz * 0.8)) continue;
    if (info.fans.some(f => Math.hypot(f.x - m.x, f.y - y, f.z - m.z) < PIT_LAMPS.fanClear + f.radius * 0.5)) continue;
    if (info.pipeBanks.some(b => {
      if (y < b.y0 - 0.5 || y > b.y1 + 0.5) return false;
      const ex = b.x1 - b.x0, ez = b.z1 - b.z0, L2 = ex * ex + ez * ez;
      const t = L2 > 1e-6 ? Math.max(0, Math.min(1, ((m.x - b.x0) * ex + (m.z - b.z0) * ez) / L2)) : 0;
      return Math.hypot(b.x0 + ex * t - m.x, b.z0 + ez * t - m.z) < PIT_LAMPS.bankClear + b.depth;
    })) continue;
    const ang = Math.atan2(m.z - cz, m.x - cx);
    const spot: BeaconSpot = {tier: tier.level, level: lv, x: r3(m.x), y: r3(y), z: r3(m.z), nx: r3(nx), nz: r3(nz),
      head: {x: r3(hx), y: r3(y + B.head.h / 2), z: r3(hz)}, deckY: r3(deckY), phase: r3(((ang + Math.PI) * 2.3 + tier.level * 1.7) % (Math.PI * 2))};
    let list = byLevel.get(tier.level);
    if (!list) byLevel.set(tier.level, (list = []));
    list.push({spot, ang});
  }
  const out: BeaconSpot[] = [];
  for (const lv of [...byLevel.keys()].sort((a, b) => a - b)) {
    const list = byLevel.get(lv)!.sort((a, b) => a.ang - b.ang || a.spot.x - b.spot.x || a.spot.z - b.spot.z);
    const n = list.length, want = Math.min(B.perStorey, n), picked: BeaconSpot[] = [];
    // evenly by angle round the pit, then any remaining candidate far enough from the picked ones
    const order = Array.from({length: want}, (_, k) => Math.floor(((k + 0.5) * n) / want)).concat(list.map((_, i) => i));
    for (const i of order) {
      if (picked.length >= want) break;
      const s = list[i].spot;
      if (picked.includes(s) || picked.some(p => Math.hypot(p.x - s.x, p.z - s.z) < B.minGap)) continue;
      picked.push(s);
    }
    out.push(...picked);
  }
  return out;
}
