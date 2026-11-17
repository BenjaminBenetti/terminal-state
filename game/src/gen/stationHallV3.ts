// Task studio-subway-architecture-materials-rework-20261117-072826-01: the layout-version-3 GRAND HALL — a sectioned "basilica concourse"
// (pure data, no three.js).
//
// User: the version-2 great hall "is a huge empty room with about 50 hanging lights, unrealistic and bad"; it wants architecture: hierarchy,
// circulation zones, structural bays, ticketing / retail / service / wayfinding, waiting pockets, furnished subdivisions. Version 3 keeps the
// grand-hall family's whole macro sequence — platforms, the run of stair passages, the paid gate gallery, its gate banks, the great hall,
// the street exits in its far wall, the waiting hall off one end, the district off the other — drawn on the SAME stream in the same order as
// version 2 (gen/stationPlans.ts grandHall, untouched), and gives the great hall a SECTION on its own fork ('grand-hall-v3'):
//  - a central NAVE (40-55 % of the hall depth, >= 12 m) at the full hall ceiling, raised to 8.4-9.6 m;
//  - two side AISLES (5.5-8 m deep each) whose cells' grid.ceil drops to 4.2-4.6 m — the world builder then draws the clerestory wall
//    between nave and aisle from the cell ceiling bands by itself (world/levelGeometry.ts extractWallFacesSteps subtracts the neighbour
//    cell's open band from each cell edge's band, so a nave cell beside an aisle cell shows the face from the aisle ceiling up to the nave
//    ceiling). The gate banks open into the north (gallery-side) aisle, the exits and kiosk frontages sit in the south aisle wall;
//  - ARCADES: a column line exactly on each nave / aisle boundary (the aisle's cell row next to the nave), 8-9 m spacing, centred; the bay
//    lines of gen/subwayBays.ts hallBays come from them (no columns in the nave);
//  - three variants (the same fork): 'basilica' (nave + two aisles), 'transept' (the same with a full-height crossing at the centre: the
//    aisle cells of the central bays keep the nave ceiling, the crossing's inner arcade columns are left out), 'gate-aisle' (one aisle on
//    the gate side and a wider nave whose south wall carries the exits and frontages at full height);
//  - the clear circulation SPINE: a 6 m band down the nave, end to end (gen/stationHallV3Dress.ts keeps it and the lanes to every opening
//    free, then furnishes the bays around it).

import type {Rng} from '../core/rng';
import {CELL} from './grid';
import {Kit} from './stationKit';
import {levelProgram} from './levelGen';
import {Plan, PATTERNS, district, hall, r1, setP1, type Pattern} from './archetypes';
import type {Area, HallSection, Side} from './stationTypes';

/** Section limits (cells: CELL = 0.5 m). */
const NAVE_MIN = 24, AISLE_MIN = 11, AISLE_MAX = 16, SPINE = 12;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Version 3's grand hall plan (the version-2 sequence and draws, the great hall sectioned). */
export function grandHallV3(k: Kit, plan: Plan, terms: string[]): boolean {
  const rng = k.rng;
  // The section's own draws: never on the shared stream (every draw below the fork line is version 2's, in its order).
  const f = rng.fork('grand-hall-v3');
  const ceil = r1(rng.range(4.6, 5.2));
  const Lp = rng.int(250, 296);
  const blk = k.sideBlock(84, 56, Lp, ceil);
  plan.blocks.push(blk);
  const [P1, P2] = blk.platforms;
  P1.platformNo = 1; P2.platformNo = 2; P1.towardsN = terms[1]; P2.towardsS = terms[0];
  setP1(plan, P1, [P2]);
  if (!levelProgram(k, blk)) return false;
  for (const s of ['W', 'E'] as const) plan.openEnds.push([P1, s], [P2, s]);
  plan.staffWalls.push([P2, 'N']);
  const pass = k.stairPassages(P1, 'S', rng.int(4, 5), 0.07, 0.93, rng.int(8, 11));
  if (pass.length < 3) return false;
  const G = k.mezzanine(pass, 'S', rng.int(10, 13), [rng.int(4, 12), rng.int(4, 12)], r1(rng.range(4.2, 4.6)), {label: 'Gate gallery', paid: true, role: 'gate-gallery'});
  if (!G) return false;
  plan.paidHalls.push(G);
  const along = Math.max(110, G.w - rng.int(0, 24)), deep = rng.int(46, 62);
  const off = rng.int(-8, 8);
  rng.range(7.2, 8.6); // (version 2's hall ceiling draw: kept so the rest of the stream is version 2's)
  const naveCeil = r1(f.range(8.4, 9.6));
  const T = hall(k, G, 'S', along, deep, off, 'fare-hall', naveCeil, {role: 'grand-ticket-hall', label: 'Grand ticket hall'});
  if (!T) return false;
  const banks = T.w >= 150 && rng.chance(0.5) ? [0.06, 0.5, 0.94] : [rng.range(0.04, 0.2), rng.range(0.8, 0.96)];
  let lines = 0;
  for (const p of banks) if (k.fareLine(G, T, rng.int(4, 6), p)) lines++;
  if (lines < 2) return false;
  // The section: stamped into the hall's cells before anything else opens into it (doors keep their own opening heights).
  sectionHall(k, T, f);
  plan.ticketHalls.push(T);
  plan.washHosts.push(T);
  plan.exits.push({parent: T, side: 'S', frac: rng.range(0.18, 0.3)}, {parent: T, side: 'S', frac: rng.range(0.7, 0.82)});
  const [wEnd, dEnd] = rng.shuffle(['W', 'E'] as Side[]);
  const W = hall(k, T, wEnd, rng.int(26, 36), rng.int(22, 30), rng.int(-6, 6), 'concourse', r1(rng.range(4.4, 5.0)), {role: 'waiting-hall', label: 'Waiting hall'});
  if (W) {
    if (k.connect(T, W, rng.int(10, 14), 4.0, {pick: 'mid', margin: 3})) { plan.washHosts.push(W); plan.frontages.push({hall: W, sides: [wEnd], mix: 'kiosk', max: 1}); }
    else k.undoLast(W);
  }
  if (!district(k, plan, T, 'S', [dEnd], rng.weighted(PATTERNS.filter(([p]) => p !== 'row') as [Pattern, number][]))) return false;
  const tf = plan.frontages.find(q => q.hall === T);
  if (tf) { tf.sides = ['S', ...tf.sides.filter(s => s !== 'S')]; tf.max = rng.int(3, 5); }
  plan.notes.push(`grand:${T.w}x${T.h}`, `banks:${lines}`, `hall-v3:${T.hallSection!.variant}`);
  return true;
}

/** Arcade column positions along a hall: `spacing` m apart, centred, on cell centres (the dresser's columnRow rule). */
export function arcadeLines(a0: number, len: number, spacing: number): number[] {
  const n = Math.max(2, Math.floor((len - 6) / spacing));
  const start = a0 + (len - (n - 1) * spacing) / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((Math.round((start + i * spacing) / CELL - 0.5) + 0.5) * CELL);
  return out;
}

/** Draws the great hall's section on its fork and stamps the aisles' low ceilings (the hall runs along X: the grand hall always does). */
function sectionHall(k: Kit, T: Area, f: Rng): void {
  const g = k.g;
  const variant = f.weighted([['basilica', 0.45], ['transept', 0.35], ['gate-aisle', 0.2]] as const) as HallSection['variant'];
  const aisleCeil = r1(f.range(4.2, 4.6));
  const spacing = r2(f.range(8, 9));
  const D = T.h;
  let aN: number, aS: number;
  if (variant === 'gate-aisle') { aN = f.int(12, AISLE_MAX); aS = 0; }
  else {
    // both aisles within 5.5-8 m, the nave 40-55 % of the depth (and >= 12 m)
    const lo = Math.max(AISLE_MIN, Math.ceil((D - 0.55 * D) / 2)), hi = Math.min(AISLE_MAX, Math.floor((D - Math.max(NAVE_MIN, Math.ceil(0.4 * D))) / 2));
    aN = Math.max(AISLE_MIN, Math.min(hi, f.int(lo, Math.max(lo, hi))));
    aS = Math.max(lo, Math.min(hi, aN + f.int(-1, 1)));
  }
  const nave = D - aN - aS;
  const x0 = T.x * CELL, len = T.w * CELL;
  const naveZ: [number, number] = [r2(aN * CELL), r2((aN + nave) * CELL)];
  const arcades = [r2((aN - 1 + 0.5) * CELL), ...(aS ? [r2((aN + nave + 0.5) * CELL)] : [])];
  let lines = arcadeLines(x0, len, spacing);
  let transept: [number, number] | undefined;
  if (variant === 'transept') {
    // the crossing: the two bays round the line nearest the hall's centre (one bay in a short hall), its inner line left out
    const mid = x0 + len / 2;
    let j = 0;
    for (let i = 1; i < lines.length; i++) if (Math.abs(lines[i] - mid) < Math.abs(lines[j] - mid)) j = i;
    if (len >= 80 && j > 0 && j < lines.length - 1) { transept = [lines[j - 1], lines[j + 1]]; lines = lines.filter((_, i) => i !== j); }
    else { const i = lines[j] <= mid && j < lines.length - 1 ? j : Math.max(0, j - 1); transept = [lines[i], lines[i + 1]]; }
  }
  // the spine: 6 m down the nave — centred in a wide nave (>= 16 m, or no south aisle: islands either side), else along its south edge
  // (islands on the gate side)
  const sp0 = nave >= SPINE + 20 || !aS ? T.y + aN + Math.floor((nave - SPINE) / 2) : T.y + aN + nave - SPINE - 1;
  const spine: [number, number] = [r2((sp0 - T.y) * CELL), r2((sp0 - T.y + SPINE) * CELL)];
  // stamp the aisles' ceilings (cells of the hall only; the crossing's keep the nave ceiling)
  const rows: number[] = [];
  for (let y = T.y; y < T.y + aN; y++) rows.push(y);
  for (let y = T.y + aN + nave; y < T.y + D; y++) rows.push(y);
  for (const y of rows) for (let x = T.x; x < T.x + T.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] !== T.id) continue;
    const cx = (x + 0.5) * CELL;
    if (transept && cx > transept[0] && cx < transept[1]) continue;
    g.ceil[i] = Math.min(g.ceil[i], aisleCeil);
  }
  // (stored relative to the hall's corner: the crop and the track extensions translate the area, not this record)
  const rel = (v: number) => r2(v - x0);
  T.hallSection = {
    variant, alongX: true, nave: naveZ, naveCeil: T.ceil,
    aisles: [[0, naveZ[0]], ...(aS ? [[naveZ[1], r2(D * CELL)] as [number, number]] : [])],
    aisleCeil, arcades, lines: lines.map(rel), ...(transept ? {transept: [rel(transept[0]), rel(transept[1])] as [number, number]} : {}), spine,
  };
}
