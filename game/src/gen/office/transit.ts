// Task office-overhaul-20261030 (lane STRUCT, feedback item 11): the HIGH-CAPACITY TRANSIT HALL between the office station
// (level 0) and the tower lobby (level 1) — after the crop (gen/office/street.ts carves it). Pure data.
//
// The run is three lanes side by side on ONE shared ~30 degree pitch line: escalator | broad fixed stair | escalator (each its
// own straight layStairRun; the escalators are STOPPED — the power is out — and walked as stairs). Here:
//  - links: one LevelLink 'stairs' per lane (the fixed stair first: link 0 of the level);
//  - rails: the glass balustrades (two per escalator) and the stair's centre handrail are COLLISION-ONLY railings
//    (RailRun.hidden; world/traversalBuilder.ts draws glass, decking, skirts, handrails, steps, comb and landing plates), so
//    nobody walks across a balustrade and the AI path graph (blockedEdges) keeps to the lanes;
//  - dressing: the clear arrival zones at both mouths are held empty while the station / office dressers run; the lobby-side
//    security gate line (securityTurnstile pedestals across the east wing, 1 m lanes + an open accessible gap — never closed);
//    an OUT OF SERVICE barricade pushed aside at the bottom of one escalator;
//  - signage (TO TRAINS over the lobby mouth, the tower lobby sign over the ticket-hall mouth, wayfinding), the TransitInfo
//    record (layout.office.transit) and validation (transitIssues: widths, walkable lanes, carved hand-over, clear mouths,
//    gate gaps).

import {CELL, FLOOR} from '../grid';
import type {LevelLink, RailRun} from '../levels';
import {makePlaceCtx, tryPlaceProp} from '../placeKit';
import type {StairFlight} from '../traversal';
import type {SignPlacement, StationLayout} from '../stationTypes';
import type {EscalatorInfo, TransitInfo} from './overhaulTypes';
import type {Rng} from '../../core/rng';
import {MARGIN, type TowerFrame} from './frame';
import type {StreetCarve, TransitCarve} from './street';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** World metres of a tower-local cell edge. */
const W = (t: number): number => (t + MARGIN) * CELL;
/** Escalator balustrade width (m: inner decking + glass + handrail), each side of the step band. */
export const BALUSTRADE = 0.22;
/** Balustrade newel ends: into the lobby box mouth / beyond the bottom comb plate into the ticket hall (m). */
export const NEWEL = {top: 0.1, bottom: 1.2};
/** Clear arrival zone kept empty in front of each mouth (m). */
export const MOUTH_CLEAR = 3.0;
/** Minimum clear widths (m): mouths, the fixed stair, escalator step band range. */
export const TRANSIT_MIN = {mouth: 6, stair: 4, stepMin: 1.0, stepMax: 1.2, gate: 1.5, lane: 0.9};

/** The run's world geometry (z north edge / flight top / flight bottom = south edge, lane x edges, heights). */
export function runGeometry(t: TransitCarve, hu: number) {
  const zN = W(t.y0), zS = W(t.y0 + t.len);
  return {zN, zT: r3(zN + t.lead), zS, hu, xs: t.lanes.map(l => [W(l.x0), W(l.x1)] as const)};
}

// ---------------------------------------------------------------------------------------------
// Links

/** One LevelLink per lane (fixed stair first). Returns the link ids per lane (same order as t.lanes). */
export function transitLinks(t: TransitCarve, flights: readonly StairFlight[], links: LevelLink[]): number[] {
  const order = [...t.lanes.keys()].sort((a, b) => (t.lanes[a].kind === 'stair' ? 0 : 1) - (t.lanes[b].kind === 'stair' ? 0 : 1) || a - b);
  const ids: number[] = new Array(t.lanes.length).fill(-1);
  for (const li of order) {
    const fl = t.lanes[li].flights.map(i => flights[i]);
    // The run descends from the lobby (flight top) to the station (flight bottom).
    const first = fl[0], last = fl[fl.length - 1];
    const id = links.length;
    links.push({id, kind: 'stairs', lower: 0, upper: 1, ramp: first.ramp, bottom: {...last.bottom}, top: {...first.top}, traversalId: first.id});
    ids[li] = id;
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Collision-only balustrades / handrail

/** Rails along x = const from zA (height yA) to zB (height yB) on `level` (both normals: a line both sides respect). */
function railZ(out: RailRun[], level: number, x: number, zA: number, yA: number, zB: number, yB: number): void {
  if (zB - zA < 0.05) return;
  out.push({level, x0: r3(x), z0: r3(zA), x1: r3(x), z1: r3(zB), y0: r3(yA), y1: r3(yB), nx: 1, nz: 0, kind: 'railing', h: 1.0, hidden: true});
}

/**
 * Hidden railings: every escalator's two glass balustrades (the balustrade centre line, BALUSTRADE / 2 inside the lane edge)
 * along the newel-to-newel length (flat over the top landing, the pitch line, flat beyond the bottom comb plate into the
 * ticket hall), and the fixed stair's centre handrail along its flight.
 */
export function transitRails(t: TransitCarve, hu: number): RailRun[] {
  const out: RailRun[] = [];
  const {zN, zT, zS} = runGeometry(t, hu);
  const along = (x: number, z0: number, z1: number) => {
    railZ(out, 1, x, z0, hu, zT, hu);
    railZ(out, 0, x, zT, hu, zS, 0);
    railZ(out, 0, x, zS, 0, z1, 0);
  };
  for (const ln of t.lanes) {
    const x0 = W(ln.x0), x1 = W(ln.x1);
    if (ln.kind === 'escalator') {
      along(x0 + BALUSTRADE / 2, zN + NEWEL.top, zS + NEWEL.bottom);
      along(x1 - BALUSTRADE / 2, zN + NEWEL.top, zS + NEWEL.bottom);
    } else {
      // Wide public stairs carry an intermediate handrail: down the middle, along the flight (+0.3 m at each end).
      const xc = (x0 + x1) / 2;
      railZ(out, 1, xc, zT - 0.3, hu, zT, hu);
      railZ(out, 0, xc, zT, hu, zS, 0);
      railZ(out, 0, xc, zS, 0, zS + 0.3, 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dressing

/** Grid cells (per level) of the clear arrival zones in front of both mouths (and the lead / box cells of the run). */
export function mouthZones(layout: StationLayout, t: TransitCarve): {level: number; cells: number[]}[] {
  const g0 = layout.levels[0].grid, g1 = layout.levels[1].grid;
  const rows = Math.round(MOUTH_CLEAR / CELL);
  const top: number[] = [], bottom: number[] = [];
  for (let x = t.x0 - 1 + MARGIN; x <= t.x1 + MARGIN; x++) {
    for (let y = t.y0 + MARGIN - rows; y < t.y0 + MARGIN; y++) if (g1.inBounds(x, y) && g1.cells[g1.idx(x, y)] === FLOOR) top.push(g1.idx(x, y));
    for (let y = t.y0 + t.len + 1 + MARGIN; y < t.y0 + t.len + 1 + MARGIN + rows; y++) if (g0.inBounds(x, y) && g0.cells[g0.idx(x, y)] === FLOOR) bottom.push(g0.idx(x, y));
  }
  // The run itself (lead + flights + the mouth row) on both grids: never dressed.
  const run0: number[] = [], run1: number[] = [];
  for (let y = t.y0 + MARGIN; y <= t.y0 + t.len + MARGIN; y++) for (let x = t.x0 + MARGIN; x < t.x1 + MARGIN; x++) {
    const i = g0.idx(x, y);
    if (g0.cells[i] === FLOOR) run0.push(i);
    if (g1.cells[i] === FLOOR) run1.push(i);
  }
  return [{level: 1, cells: [...top, ...run1]}, {level: 0, cells: [...bottom, ...run0]}];
}

/** Holds cells blocked (returns a release function restoring only the cells this call blocked). */
export function holdCells(layout: StationLayout, zones: readonly {level: number; cells: readonly number[]}[]): () => void {
  const held: [Uint8Array, number][] = [];
  for (const z of zones) {
    const g = layout.levels[z.level].grid;
    for (const i of z.cells) if (!g.blocked[i]) { g.blocked[i] = 1; held.push([g.blocked, i]); }
  }
  return () => { for (const [b, i] of held) b[i] = 0; };
}

/**
 * Before the dressers run (so liftLevels / finishTraversal put them on their floors): the lobby security gate line across the
 * east wing (pedestals every 1.5 m: 1 m lanes, an open accessible gap of >= 2 m at the facade end and >= 1 m by the core) and the
 * OUT OF SERVICE barricade pushed aside at the bottom of the east escalator (against the ticket hall's north wall, clear of the
 * lane). Returns the gate line's row (grid) or -1.
 */
export function transitPreDress(layout: StationLayout, s: StreetCarve, rng: Rng): {gateRow: number; gateCells: [number, number]} {
  const t = s.hallRun;
  const ctx1 = makePlaceCtx(layout, rng.fork('transit-gates'), 1);
  const E = layout.areas[s.east.id];
  let gateRow = -1;
  const gateCells: [number, number] = [E.x, E.x + E.w];
  // The gate row: 1.5 m north of the concourse strip (the east wing's south end), pedestals 1.4 m long N-S (3 rows).
  const gy = E.y + E.h - 4;
  if (E.w >= 12) {
    const n = Math.floor((E.w - 2 - 5) / 3) + 1;
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const cx = E.x + 2 + 3 * k;
      const p = tryPlaceProp(ctx1, E, 'securityTurnstile', (cx + 0.5) * CELL, (gy + 0.5) * CELL, 0, {checkZone: false});
      if (p) placed++;
    }
    if (placed) gateRow = gy;
  }
  // The barricade: beside the east escalator's bottom mouth, against the ticket hall's north wall, parallel to it.
  const T = layout.areas[s.ticketHall.id];
  const ctx0 = makePlaceCtx(layout, rng.fork('transit-barricade'), 0);
  const east = t.lanes[t.lanes.length - 1];
  const zWall = W(t.y0 + t.len + 1);
  for (const dx of [0.95, 1.45, 1.95]) {
    if (tryPlaceProp(ctx0, T, 'foldingBarricade', W(east.x1) + dx, zWall + 0.32, 0, {checkZone: false, doorOk: true})) break;
  }
  return {gateRow, gateCells};
}

/** Signage after dressing (absolute heights): the tower lobby sign over the ticket-hall mouth, TO TRAINS over the lobby mouth. */
export function transitSigns(layout: StationLayout, s: StreetCarve, name: string): void {
  const t = s.hallRun, hu = s.hu;
  const {zN, zS} = runGeometry(t, hu);
  const stair = t.lanes.find(l => l.kind === 'stair')!;
  const xc = (W(stair.x0) + W(stair.x1)) / 2;
  const T = layout.areas[s.ticketHall.id], up = layout.areas[s.transit.id];
  const push = (q: SignPlacement) => layout.signs.push(q);
  // Ticket hall: the fascia over the run's mouth (its north wall, facing south into the hall).
  const zHall = zS + CELL + 0.02;
  push({x: r3(xc), y: 3.15, z: r3(zHall), rot: 0, kind: 'info', text: `OFFICE TOWER · ${name.toUpperCase()} LOBBY`, arrow: 'up', area: T.id, w: 3.8});
  for (const ln of t.lanes) {
    if (ln.kind !== 'escalator') continue;
    const x = (W(ln.x0) + W(ln.x1)) / 2;
    const dead = ln === t.lanes[t.lanes.length - 1];
    push({x: r3(x), y: 2.95, z: r3(zHall), rot: 0, kind: dead ? 'service' : 'info', text: dead ? 'OUT OF SERVICE' : 'ESCALATOR', area: T.id, w: 1.3});
  }
  // Lobby: the fascia over the box mouth (facing north onto the transit concourse).
  push({x: r3(xc), y: r3(hu + 3.15), z: r3(zN - 0.02), rot: Math.PI, kind: 'info', text: 'TO TRAINS · PLATFORMS 1 · 2', arrow: 'down', area: up.id, w: 3.4, level: 1});
  // Wayfinding over the concourse in front of the mouth: elevators and stairs are round the core's east side.
  const E = layout.areas[s.east.id];
  const xe = (E.x + 1.5) * CELL, ze = (up.y + up.h / 2) * CELL;
  push({x: r3(xe), y: r3(hu + 2.65), z: r3(ze), rot: 0, kind: 'info', text: 'ELEVATORS · STAIRS', arrow: xe > xc ? 'right' : 'left', area: up.id, hang: true, w: 2.2, level: 1});
}

/** The layout.office.transit record. */
export function transitInfo(layout: StationLayout, s: StreetCarve, linkIds: readonly number[]): TransitInfo {
  const t = s.hallRun;
  const escalators: EscalatorInfo[] = [];
  const stairLinks: number[] = [];
  t.lanes.forEach((ln, i) => {
    if (ln.kind === 'stair') { stairLinks.push(linkIds[i]); return; }
    const fl = ln.flights.map(id => layout.traversal.stairs[id]);
    const top = fl[0].top, bottom = fl[fl.length - 1].bottom;
    escalators.push({
      flights: [...ln.flights], lower: {...bottom}, upper: {...top},
      width: r3(W(ln.x1) - W(ln.x0) - 2 * BALUSTRADE),
      yaw: r3(Math.atan2(-(top.x - bottom.x), -(top.z - bottom.z))),
    });
  });
  return {stairLinks, escalators, lowerHall: s.ticketHall.id, upperHall: s.transit.id};
}

// ---------------------------------------------------------------------------------------------
// QA helper (the browser spot check: the primary wires it into qa.ts)

/**
 * A pose at the transit hall: 'bottom' = in the ticket hall 3 m in front of the run's mouth, on the axis of `lane` (0 = west
 * escalator, 1 = the fixed stair, 2 = east escalator; default the stair), looking up the run; 'top' = on the lobby's transit
 * concourse 2.5 m in front of the box mouth, looking down it.
 */
export function transitPose(layout: StationLayout, end: 'bottom' | 'top' = 'bottom', lane = 1): {x: number; y: number; z: number; yaw: number; pitch: number; level: number} | null {
  const t = layout.office?.transit;
  if (!t) return null;
  const flights = [t.escalators[0]?.flights[0], layout.levelLinks[t.stairLinks[0]]?.traversalId, t.escalators[1]?.flights[0]].map(i => (i === undefined ? undefined : layout.traversal.stairs[i]));
  const q = flights[Math.max(0, Math.min(2, lane))] ?? flights[1];
  if (!q) return null;
  const x = r3((q.a0 + q.a1) / 2 + (lane === 1 ? (q.a1 - q.a0) / 4 : 0));
  const zBottom = Math.max(q.s0, q.s1);
  const run = layout.areas[q.area];
  if (end === 'bottom') return {x, y: 0, z: r3(zBottom + CELL + 3), yaw: 0, pitch: 0.28, level: 0};
  return {x, y: layout.levels[1].baseY, z: r3(run.y * CELL - 2.5), yaw: Math.PI, pitch: -0.32, level: 1};
}

// ---------------------------------------------------------------------------------------------
// Validation

/** Transit hall invariants (generation retry guard + tests). */
export function transitIssues(layout: StationLayout, _f?: TowerFrame): string[] {
  const issues: string[] = [];
  const info = layout.office?.transit;
  if (!info) return ['no transit hall record'];
  const levels = layout.levels, g0 = levels[0].grid, g1 = levels[1].grid;
  const hu = levels[1].baseY;
  if (info.escalators.length !== 2) issues.push(`${info.escalators.length} escalators (want 2)`);
  if (!info.stairLinks.length) issues.push('no fixed transit stair');
  const lanes: {kind: string; flights: StairFlight[]}[] = [
    ...info.stairLinks.map(id => ({kind: 'stair', flights: layout.traversal.stairs.filter(q => q.id === layout.levelLinks[id]?.traversalId)})),
    ...info.escalators.map(e => ({kind: 'escalator', flights: e.flights.map(i => layout.traversal.stairs[i])})),
  ];
  for (const ln of lanes) {
    if (!ln.flights.length || ln.flights.some(q => !q)) { issues.push(`transit ${ln.kind}: no flights`); continue; }
    for (const q of ln.flights) {
      if (q.spec !== (ln.kind === 'stair' ? 'transit' : 'escalator')) issues.push(`transit ${ln.kind}: flight ${q.id} class ${q.spec}`);
      const R = g0.ramps[q.ramp];
      for (const L of levels) {
        const carved = L.grid.rampIdx[L.grid.idx(R.x, R.y)] === q.ramp;
        if (carved !== (L.id <= 1)) issues.push(`transit ${ln.kind}: flight ${q.id} carved on level ${L.id}: ${carved}`);
      }
      const width = q.a1 - q.a0;
      if (ln.kind === 'stair' && width < TRANSIT_MIN.stair - 1e-6) issues.push(`transit stair ${width.toFixed(2)} m wide`);
      for (const [nm, p, lv] of [['top', q.top, 1], ['bottom', q.bottom, 0]] as const) {
        const g = levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z);
        if (!g.passable(cx, cy) || Math.abs(g.floorAt(p.x, p.z) - p.y) > 0.05) issues.push(`transit ${ln.kind}: flight ${q.id} ${nm} not walkable on level ${lv}`);
      }
      if (Math.abs(q.h0 - hu) > 1e-3 && Math.abs(q.h1 - hu) > 1e-3) issues.push(`transit ${ln.kind}: flight ${q.id} does not reach the lobby`);
    }
  }
  for (const e of info.escalators) if (e.width < TRANSIT_MIN.stepMin - 1e-6 || e.width > TRANSIT_MIN.stepMax + 1e-6) issues.push(`escalator step width ${e.width}`);
  // One shared pitch: every lane's ramp has the same pitch line (no walls / drops between the lanes).
  const ramps = lanes.flatMap(l => l.flights.filter(Boolean).map(q => g0.ramps[q.ramp]));
  for (const R of ramps) if (Math.abs(R.s0 - ramps[0].s0) > 1e-6 || Math.abs(R.s1 - ramps[0].s1) > 1e-6 || Math.abs(R.h0 - ramps[0].h0) > 1e-6 || Math.abs(R.h1 - ramps[0].h1) > 1e-6) { issues.push('transit lanes do not share one pitch line'); break; }
  // Mouths: the full run width on both ends.
  const run = layout.areas[layout.traversal.stairs[info.escalators[0]?.flights[0] ?? -1]?.area ?? -1];
  if (!run) return [...issues, 'transit run area missing'];
  const mouth = layout.doors.find(d => (d.a === run.id || d.b === run.id) && !d.level);
  if (!mouth || mouth.w * CELL < TRANSIT_MIN.mouth - 1e-6) issues.push(`transit lower mouth ${mouth ? (mouth.w * CELL).toFixed(1) : 0} m wide`);
  let upper = 0;
  for (let x = run.x; x < run.x + run.w; x++) {
    const a = g1.idx(x, run.y), b = g1.idx(x, run.y - 1);
    if (g1.cells[a] === FLOOR && g1.area[a] === run.id && g1.cells[b] === FLOOR && Math.abs(g1.floorOf(b) - hu) < 1e-3 && Math.abs(g1.floorOf(a) - hu) < 1e-3) upper++;
  }
  if (upper * CELL < TRANSIT_MIN.mouth - 1e-6) issues.push(`transit upper mouth ${(upper * CELL).toFixed(1)} m wide`);
  // The run below the box: on the station grid only, its ceiling a slab under the lobby floor.
  for (let y = run.y; y < run.y + run.h; y++) for (let x = run.x; x < run.x + run.w; x++) {
    const i = g0.idx(x, y);
    if (g1.cells[i] !== FLOOR && g0.ceil[i] > hu - 0.35 + 1e-6) { issues.push('transit run ceiling into the lobby slab'); y = run.y + run.h; break; }
  }
  // Clear arrival zones: nothing standing within MOUTH_CLEAR of either mouth across the run width.
  const zN = run.y * CELL, zS = (run.y + run.h) * CELL, x0 = run.x * CELL, x1 = (run.x + run.w) * CELL;
  for (const p of layout.props) {
    const lv = p.level ?? 0;
    if (lv > 1 || p.mounted) continue;
    const zA = lv === 1 ? zN - MOUTH_CLEAR : zS + CELL, zB = lv === 1 ? zN : zS + CELL + MOUTH_CLEAR;
    if (p.x + p.hx > x0 + 0.05 && p.x - p.hx < x1 - 0.05 && p.z + p.hz > zA + 0.05 && p.z - p.hz < zB - 0.05) issues.push(`prop ${p.kind} in a transit mouth (level ${lv})`);
    if (lv === 0 && p.x + p.hx > x0 && p.x - p.hx < x1 && p.z + p.hz > zN && p.z - p.hz < zS) issues.push(`prop ${p.kind} on the transit run`);
  }
  // Every lane of the lobby gate line is >= 0.9 m and one open gap >= 1.5 m (never fully blocking).
  const gates = layout.props.filter(p => p.kind === 'securityTurnstile' && p.level === 1);
  if (gates.length) {
    const row = g1.cellOf(gates[0].x, gates[0].z)[1];
    let run1 = 0, best = 0, minGap = Infinity;
    const xs = [...new Set(gates.map(p => g1.cellOf(p.x, p.z)[0]))].sort((a, b) => a - b);
    for (let x = 0; x < g1.w; x++) {
      const i = g1.idx(x, row);
      if (g1.cells[i] === FLOOR && !g1.blocked[i]) { run1++; best = Math.max(best, run1); } else run1 = 0;
    }
    for (let k = 1; k < xs.length; k++) minGap = Math.min(minGap, (xs[k] - xs[k - 1] - 1) * CELL);
    if (best * CELL < TRANSIT_MIN.gate - 1e-6) issues.push(`security gate line: widest gap ${(best * CELL).toFixed(1)} m`);
    if (minGap < TRANSIT_MIN.lane - 1e-6) issues.push(`security gate lane ${minGap.toFixed(2)} m`);
  }
  return issues;
}
