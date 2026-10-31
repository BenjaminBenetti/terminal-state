// Seamless Office Space (lane GEN): validation of the ONE office layout (generation retry guard + tests). Pure data.
//
// - Storeys: 9 levels (station 'main' y 0, lobby 'upper' y hu, office floors 2..8 'office' at hu + 4.4 (n - 1)); same grid size.
// - Reachability: every walkable cell of every storey and every area reachable from the platform start by walking + stairs only
//   (levelDistance over all storeys; the elevator is not in the grids, so it is excluded by construction).
// - Scissor stair: one run per storey pair (lanes alternate), each a LevelLink 'stairs' carved into both grids; flights 24 x
//   4.4/24 m risers (≤ 0.19 m) on 0.28 m treads, ≤ 12 per flight; ≥ 2.5 m headroom over every run cell with no other storey's
//   band intruding (no ceiling / slab collision); landings walkable, ≥ 1.2 x 1.8 m, reachable, with a doorway to the storey.
// - No void falls: no walkable edge anywhere drops more than the rail height without a railing (gen/levels.ts unrailedDrops).
// - Elevator: the shaft is SOLID on every tower storey grid; every stop's landing strip is walkable floor without props; the stop
//   records match the storeys.
// - Nothing (props, pickups, enemies, signs below head height) inside the stairwell, on the landings' door fronts, in the shaft or
//   on the landing strips; windows lie on the perimeter wall ring of their storey only.
// - Populations: enemies 5-8 on the station + lobby, 3-6 per office floor, ≥ 18 m walking from the start; loot reachable; the
//   start weapon is never a pickup. Shared traversal / doorway / storey rules (gen/traversal.ts, gen/doorways.ts, gen/levelGen.ts).

import {CELL, FLOOR, SOLID} from '../grid';
import {doorwayIssues, signDims} from '../doorways';
import {levelArrays, levelDistance, levelIssues, SLAB} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import type {Area, StationLayout} from '../stationTypes';
import {FLOOR_HEIGHT, MARGIN, OFFICE_FLOORS, OFFICE_ROOF_LEVEL, OFFICE_TOP_FLOOR, SCISSOR_STAIR, landingRect, type TowerFrame} from './frame';
import {ROOM_MIN_CELLS} from './floorplan'; // Task office-interactions-layout-20261030 (lane LAYOUT)
import {roofIssues} from './roof'; // Task office-overhaul-20261030 (lane STRUCT): the roof storey
import {transitIssues} from './transit'; // Task office-overhaul-20261030 (lane STRUCT): the transit hall
import {landingStrip, signOverlaps} from './dress';
// Task enemy-spawn-tables-20261030 (lane SPAWN): enemy counts / keep-away are validated against the level's spawn profile.
import {acceptedPlaced, spawnContext, spawnProfile, type SpawnProfile} from '../../ai/spawnTables';
import {CORRIDOR_CLEAR_M, isNarrowPassage, isPlantKind, passageClear} from './companyDress';
import {COMPANIES} from './companies';
import {extensionIssues} from '../trackExt/index';

export function officeIssues(layout: StationLayout, f: TowerFrame, spawns: SpawnProfile = spawnProfile('office')): string[] {
  const issues: string[] = [];
  const info = layout.office;
  if (!info || info.version !== 2) return ['no office info (v2)'];
  const levels = layout.levels, g0 = layout.grid;
  // --- Storeys and elevations ---------------------------------------------------------------------------------------------
  // (lane STRUCT: + the roof, level OFFICE_ROOF_LEVEL, checked by roofIssues)
  if (levels.length !== 2 + OFFICE_FLOORS.length) return [`${levels.length} levels (want ${2 + OFFICE_FLOORS.length})`];
  if (levels[0].grid !== g0 || levels[0].role !== 'main' || levels[0].baseY !== 0) issues.push('level 0 is not the station main level');
  if (levels[1].role !== 'upper') issues.push('level 1 (lobby) role');
  const hu = levels[1].baseY;
  if (hu < 5.4 - 1e-6 || hu > 5.9 + 1e-6) issues.push(`lobby height ${hu}`);
  for (const L of levels) {
    if (L.id !== levels.indexOf(L)) issues.push(`level ${L.id} id mismatch`);
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id >= 2 && L.id !== OFFICE_ROOF_LEVEL && (L.role !== 'office' || Math.abs(L.baseY - (hu + FLOOR_HEIGHT * (L.id - 1))) > 1e-3)) issues.push(`level ${L.id} role ${L.role} / baseY ${L.baseY} not contiguous`);
  }
  for (const s of info.storeys) if (s.levelId !== s.floor || Math.abs(levels[s.levelId].baseY - s.baseY) > 1e-6) issues.push(`storey ${s.floor} record`);
  if (Math.abs(info.groundY - hu) > 1e-6) issues.push('groundY is not the lobby floor');

  // --- Reachability from the platform start (walking + stairs) ---------------------------------------------------------------
  const st = info.start;
  const [sx, sy] = g0.cellOf(st.x, st.z);
  // (lane STRUCT: + the player-only roof ladder link)
  const dist = levelDistance(levels, sx, sy, st.level, layout.levelLinks);
  if (st.level !== 0 || Math.abs(st.x - layout.playerSpawn.x) > 1e-6 || Math.abs(st.z - layout.playerSpawn.z) > 1e-6) issues.push('start is not the platform spawn');
  if (!g0.circleClear(st.x, st.z, 0.34)) issues.push('start not clear');
  for (const L of levels) {
    const g = L.grid;
    let bad = 0;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.blocked[i] || dist[L.id][i] >= 0) continue;
      // A stair-run cell may be reached through its twin on the other storey.
      if (g.rampIdx[i] >= 0 && levels.some(M => M.id !== L.id && dist[M.id][i] >= 0)) continue;
      bad++;
    }
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
  }
  for (const a of layout.areas) {
    const lv = a.level ?? 0;
    const seen = (M: number) => { const gm = levels[M].grid; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (dist[M][gm.idx(x, y)] >= 0) return true; return false; };
    if (!seen(lv) && !(a.role === 'stair' && levels.some(M => M.id !== lv && seen(M.id)))) issues.push(`area ${a.id} (${a.type} ${a.label}) unreachable`);
  }

  // --- Scissor stair -------------------------------------------------------------------------------------------------------
  const scissorFlights = new Set<number>();
  const {open, fl, cl} = levelArrays(levels);
  const wantRuns = OFFICE_FLOORS.slice(0, -1).map(n => `${n}-${n + 1}`).join(',');
  if (info.stairs.runs.map(r => `${r.lower}-${r.upper}`).join(',') !== wantRuns) issues.push('scissor runs do not join every storey pair');
  for (const r of info.stairs.runs) {
    const k = layout.levelLinks[r.link];
    if (!k || k.kind !== 'stairs' || k.lower !== r.lower || k.upper !== r.upper || k.ramp === undefined) { issues.push(`run ${r.lower}-${r.upper}: link`); continue; }
    if (r.lane !== (r.lower % 2 === 1 ? 'A' : 'B')) issues.push(`run ${r.lower}-${r.upper}: lane ${r.lane}`);
    const flights = layout.traversal.stairs.filter(q => layout.areas[q.area]?.level === r.lower && layout.areas[q.area]?.role === 'stair' && q.h0 >= levels[r.lower].baseY - 1e-3 && q.h1 <= levels[r.upper].baseY + 1e-3);
    for (const q of flights) scissorFlights.add(q.id);
    const risers = flights.reduce((s, q) => s + q.risers, 0);
    if (risers !== 24) issues.push(`run ${r.lower}-${r.upper}: ${risers} risers`);
    for (const q of flights) {
      if (q.riser > 0.19 + 1e-6 || q.riser < 0.15 || Math.abs(q.tread - SCISSOR_STAIR.tread) > 1e-6 || q.risers > SCISSOR_STAIR.maxRisers) issues.push(`run ${r.lower}-${r.upper}: flight ${q.id} off spec`);
      if (q.a1 - q.a0 < 1.5 - 1e-6) issues.push(`run ${r.lower}-${r.upper}: flight ${q.id} narrower than 1.5 m`);
    }
    // Headroom over every run cell on both grids, and no other storey's band inside it (slab collision).
    const a = layout.areas[flights[0]?.area ?? -1];
    if (!a) { issues.push(`run ${r.lower}-${r.upper}: no flights`); continue; }
    let headBad = 0, slabBad = 0;
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g0.idx(x, y);
      for (const lv of [r.lower, r.upper]) {
        const g = levels[lv].grid;
        if (g.cells[i] !== FLOOR) { headBad++; continue; }
        const ri = g.rampIdx[i];
        if (ri >= 0 ? g.ramps[ri].headroom < SCISSOR_STAIR.headroom - 1e-6 : g.ceil[i] - g.floor[i] < SCISSOR_STAIR.headroom - 1e-3) headBad++;
      }
      const lo = levels[r.lower].grid.floor[i], hi = levels[r.lower].grid.ceil[i];
      for (const M of levels) {
        if (M.id === r.lower || M.id === r.upper || !open[M.id][i]) continue;
        if (!(fl[M.id][i] >= hi + SLAB - 1e-3 || cl[M.id][i] <= lo - SLAB + 1e-3)) slabBad++;
      }
    }
    if (headBad) issues.push(`run ${r.lower}-${r.upper}: ${headBad} cells without 2.5 m headroom`);
    if (slabBad) issues.push(`run ${r.lower}-${r.upper}: ${slabBad} cells with another storey inside the headroom`);
  }
  // Landings: one per storey, walkable, reachable, a doorway to the storey.
  for (const n of OFFICE_FLOORS) {
    const p = info.stairs.landings.find(q => q.floor === n);
    const g = levels[n].grid;
    if (!p) { issues.push(`storey ${n}: no stair landing`); continue; }
    const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
    if (!g.walkable(cx, cy) || dist[n][i] < 0) issues.push(`storey ${n}: stair landing not walkable / reachable`);
    const lr = landingRect(f, n), a = layout.areas[g.area[i]];
    if (!a || a.x !== lr.x + MARGIN || a.y !== lr.y + MARGIN || a.w !== lr.w || a.h !== lr.h) { issues.push(`storey ${n}: landing area`); continue; }
    if (!layout.doors.some(d => (d.a === a.id || d.b === a.id) && (d.level ?? 0) === n)) issues.push(`storey ${n}: landing has no doorway`);
  }

  // --- No void falls ---------------------------------------------------------------------------------------------------------
  const drops = levelsOf(layout).unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first: level ${drops[0].level} at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)})`);

  // --- Elevator shaft + stops -------------------------------------------------------------------------------------------------
  const e = info.elevator;
  const cellsIn = (r: {x0: number; z0: number; x1: number; z1: number}): number[] => {
    const out: number[] = [];
    for (let y = Math.round(r.z0 / CELL); y < Math.round(r.z1 / CELL); y++) for (let x = Math.round(r.x0 / CELL); x < Math.round(r.x1 / CELL); x++) out.push(g0.idx(x, y));
    return out;
  };
  const shaftCells = cellsIn(e.shaft);
  if (shaftCells.length !== (f.cab.w + 2) * (f.cab.h + 2)) issues.push('shaft rect');
  for (const n of OFFICE_FLOORS) {
    const g = levels[n].grid;
    if (shaftCells.some(i => g.cells[i] !== SOLID)) issues.push(`storey ${n}: shaft not solid`);
  }
  if (e.stops.map(s => s.floor).join(',') !== OFFICE_FLOORS.join(',')) issues.push('elevator stops');
  const strip = landingStrip(f);
  const stripBox = {x0: (strip.x + MARGIN) * CELL, z0: (strip.y + MARGIN) * CELL, x1: (strip.x + strip.w + MARGIN) * CELL, z1: (strip.y + strip.h + MARGIN) * CELL};
  for (const s of e.stops) {
    const g = levels[s.levelId]?.grid;
    if (!g || s.levelId !== s.floor || Math.abs(s.y - levels[s.levelId].baseY) > 1e-6) { issues.push(`stop ${s.floor} record`); continue; }
    for (const i of cellsIn(stripBox)) if (g.cells[i] !== FLOOR || g.blocked[i] || dist[s.levelId][i] < 0 || Math.abs(g.floor[i] - s.y) > 1e-3) { issues.push(`stop ${s.floor}: landing strip not clear walkable floor`); break; }
    const [lx, ly] = g.cellOf(s.landing.x, s.landing.z);
    if (g.area[g.idx(lx, ly)] !== s.area) issues.push(`stop ${s.floor}: landing area`);
    if (Math.abs(s.callPanel.z - (e.shaft.z0 - 0.03)) > 1e-6 || s.callPanel.x < e.shaft.x0 || s.callPanel.x > e.shaft.x1) issues.push(`stop ${s.floor}: call panel off the shaft face`);
  }
  if (Math.abs(e.door.z - e.cab.z0) > 1e-9 || e.door.x - e.door.width / 2 < e.cab.x0 || e.door.x + e.door.width / 2 > e.cab.x1) issues.push('elevator door record');

  // --- Keep-clear zones: stairwell, landing door fronts, shaft, landing strips ------------------------------------------------
  const well = info.stairs.well;
  const inBox = (b: {x0: number; z0: number; x1: number; z1: number}, x0: number, z0: number, x1: number, z1: number, pad = 0) =>
    x1 > b.x0 - pad && x0 < b.x1 + pad && z1 > b.z0 - pad && z0 < b.z1 + pad;
  const fronts = layout.doors.filter(d => (d.level ?? 0) >= 1 && layout.areas[d.b]?.type === 'office-stair').map(d => ({lv: d.level ?? 0, box: {x0: d.x * CELL, z0: (d.y - 2) * CELL, x1: (d.x + d.w) * CELL, z1: (d.y + d.h) * CELL}}));
  const shaftFace = {x0: e.shaft.x0, z0: e.shaft.z0 - 0.4, x1: e.shaft.x1, z1: e.shaft.z1};
  for (const p of layout.props) {
    const lv = p.level ?? 0;
    if (lv < 1) continue;
    const x0 = p.x - p.hx, x1 = p.x + p.hx, z0 = p.z - p.hz, z1 = p.z + p.hz;
    if (inBox(well, x0, z0, x1, z1)) issues.push(`prop ${p.kind} in the stairwell (level ${lv})`);
    // The strip is walking space: a prop counts when it intrudes > 0.1 m; high wall mounts on the corridor's far wall do not.
    const high = p.mounted && p.y - levels[lv].baseY >= 2.0 && Math.abs(p.z - e.shaft.z0) > 0.6;
    if (!high && inBox(stripBox, x0, z0, x1, z1, -0.1)) issues.push(`prop ${p.kind} on the elevator landing (level ${lv})`);
    if (inBox(shaftFace, x0, z0, x1, z1) && (p.mounted || inBox(e.shaft, x0, z0, x1, z1) || Math.abs(p.x - e.door.x) < e.door.width / 2 + 0.3)) issues.push(`prop ${p.kind} on the elevator shaft / door (level ${lv})`);
    for (const fr of fronts) if (fr.lv === lv && inBox(fr.box, x0, z0, x1, z1)) issues.push(`prop ${p.kind} in front of a stairwell doorway (level ${lv})`);
  }
  for (const s of layout.signs) {
    const lv = s.level ?? 0;
    if (lv < 1) continue;
    const base = levels[lv].baseY, hw = (s.w ?? 1.2) / 2;
    // Plates on the shaft face beside the door are fine; nothing may cover the opening below its head.
    if (Math.abs(s.z - e.shaft.z0) < 0.1 && Math.abs(s.x - e.door.x) < e.door.width / 2 + hw && s.y - base < 2.45) issues.push(`sign '${s.text}' over the elevator door (level ${lv})`);
    if (inBox(well, s.x, s.z, s.x, s.z, -0.05) && s.hang) issues.push(`hanging sign in the stairwell (level ${lv})`);
  }
  for (const p of layout.pickups) if ((p.level ?? 0) >= 1 && (inBox(well, p.x, p.z, p.x, p.z) || inBox(stripBox, p.x, p.z, p.x, p.z) || inBox(e.shaft, p.x, p.z, p.x, p.z))) issues.push(`pickup ${p.itemId} in the stairwell / elevator landing`);
  for (const z of layout.zombies) if ((z.level ?? 0) >= 1 && (inBox(well, z.x, z.z, z.x, z.z) || inBox(e.shaft, z.x, z.z, z.x, z.z))) issues.push('enemy in the stairwell / shaft');

  // --- Windows: perimeter ring of their own storey only -----------------------------------------------------------------------
  const {TW, TD} = f;
  const ring = (x: number, y: number) => (x === MARGIN - 1 || x === MARGIN + TW || y === MARGIN - 1 || y === MARGIN + TD) && x >= MARGIN - 1 && x <= MARGIN + TW && y >= MARGIN - 1 && y <= MARGIN + TD;
  for (const w of info.windows) {
    const L = levels[w.level];
    if (!L || w.level < 1 || Math.abs(L.baseY - w.baseY) > 1e-6) { issues.push(`window on level ${w.level}: record`); continue; }
    const gO = L.grid;
    const [c0x, c0y] = gO.cellOf(w.x0 + 0.01, w.z0 + 0.01), [c1x, c1y] = gO.cellOf(w.x1 - 0.01, w.z1 - 0.01);
    for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) {
      if (!ring(x, y)) { issues.push(`window cell ${x},${y} (level ${w.level}) not on the exterior wall`); continue; }
      if (gO.cells[gO.idx(x, y)] !== SOLID) issues.push(`window cell ${x},${y} (level ${w.level}) not solid`);
      const ix = x === MARGIN - 1 ? x + 1 : x === MARGIN + TW ? x - 1 : x, iy = y === MARGIN - 1 ? y + 1 : y === MARGIN + TD ? y - 1 : y;
      if (w.kind === 'window' && gO.cells[gO.idx(ix, iy)] !== FLOOR) issues.push(`window cell ${x},${y} (level ${w.level}) has no room behind it`);
    }
  }
  if (info.windows.filter(w => w.kind === 'entrance').some(w => w.level !== 1)) issues.push('entrance span off the lobby');

  // --- Populations ----------------------------------------------------------------------------------------------------------
  const count = (lvs: number[]) => layout.zombies.filter(z => lvs.includes(z.level ?? 0)).length;
  const outside = (n: number, c: {min: number | null; max: number | null}) => (c.min !== null && n < c.min) || (c.max !== null && n > c.max);
  const street = count([0, 1]), streetCtx = spawnContext(spawns, 'street'), floorCtx = spawnContext(spawns, 'floor');
  if (outside(street, acceptedPlaced(streetCtx))) issues.push(`station + lobby enemy count ${street}`);
  for (let n = 2; n <= OFFICE_FLOORS.length; n++) {
    const c = count([n]);
    if (outside(c, acceptedPlaced(floorCtx))) issues.push(`floor ${n} enemy count ${c}`);
  }
  const keepCells = (lv: number) => spawnContext(spawns, lv <= 1 ? 'street' : lv === OFFICE_ROOF_LEVEL ? 'roof' : 'floor').placement.startCells;
  for (const z of layout.zombies) {
    const lv = z.level ?? 0, g = levels[lv].grid, [x, y] = g.cellOf(z.x, z.z), i = g.idx(x, y);
    if (dist[lv][i] < 0) issues.push('enemy on unreachable cell');
    else if (dist[lv][i] < keepCells(lv)) issues.push('enemy too close to the start');
    if (!g.circleClear(z.x, z.z, 0.35)) issues.push('enemy spawn intersects geometry');
  }
  for (const p of layout.pickups) {
    const lv = p.level ?? 0, g = levels[lv].grid, [x, y] = g.cellOf(p.x, p.z);
    if (!g.inBounds(x, y) || dist[lv][g.idx(x, y)] < 0) issues.push(`pickup ${p.itemId} unreachable`);
  }
  if (layout.pickups.some(p => p.itemId === (layout.startWeapon ?? 'rifle'))) issues.push('start weapon placed as a pickup');

  // --- Task office-overhaul-20261030 (lane TENANTS): tenants, server rooms, corridor clearance ---------------------------------
  issues.push(...tenantIssues(layout));
  // --- Task office-interactions-layout-20261030 (lane LAYOUT): room sizes, washrooms, plates, the roof access room's one plate -------
  issues.push(...layoutIssues(layout));
  // --- Task office-overhaul-20261030 (lane STRUCT): the roof (reachable by the ladder, parapet closed, hatch zone clear) and the
  // transit hall (widths, walkable stair + escalators, carved hand-over, clear mouths, gate gaps) -------------------------------
  issues.push(...roofIssues(layout, f, dist, acceptedPlaced(spawnContext(spawns, 'roof')).max), ...transitIssues(layout, f));

  // --- Shared rules -----------------------------------------------------------------------------------------------------------
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  issues.push(...levelIssues(layout, dist).filter(s => {
    if (/^only \d+ levels$|overlaps the main level by only|walkable cells unreachable/.test(s)) return false;
    // The scissor flights are 4.4/24 m risers by design (design.md "Stairs"), checked above.
    const m = /^flight (\d+) off spec$/.exec(s);
    return !(m && scissorFlights.has(Number(m[1])));
  }));
  // Track 2 (lane GEN): the station's tunnels / annexes (reachability both ways, clearance, caps, doors, clues).
  issues.push(...extensionIssues(layout));
  return issues;
}

/** Areas of the tower storeys that are ROOMS (not corridors, halls, stair landings / runs). */
const isTowerRoom = (a: Area): boolean => {
  const lv = a.level ?? 0;
  return lv >= 1 && lv <= OFFICE_TOP_FLOOR && a.kind !== 'passage' && a.type !== 'office-corridor' && a.type !== 'office-stair' && a.type !== 'office-lobby' && a.role !== 'stair';
};

/**
 * Task office-interactions-layout-20261030 (lane LAYOUT): floor-plan invariants — every room of the tower storeys is at least
 * ROOM_MIN_CELLS (2.5 m) on its short side; a men's and a women's washroom on every storey; no two plates overlap on one wall face
 * of an office storey; floor 8 has exactly one roof access room, exactly one ROOF ACCESS plate, and no ELECTRICAL plate at the roof
 * access room's door (item 4).
 */
export function layoutIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  for (const a of layout.areas) if (isTowerRoom(a) && Math.min(a.w, a.h) < ROOM_MIN_CELLS) issues.push(`room ${a.id} (${a.label}, level ${a.level}) ${a.w * CELL} x ${a.h * CELL} m: narrower than 2.5 m`);
  for (const n of OFFICE_FLOORS) {
    const wc = layout.areas.filter(a => a.level === n && a.type === 'washroom');
    if (!wc.some(a => a.label.includes("Men's")) || !wc.some(a => a.label.includes("Women's"))) issues.push(`storey ${n}: no men's + women's washroom`);
  }
  for (const s of layout.signs) {
    const lv = s.level ?? 0;
    if (lv >= 1 && signOverlaps(layout, lv, s, s.y, signDims(s), s, {w: -0.01, h: -0.01})) issues.push(`sign '${s.text}' (level ${lv}) overlaps another plate`);
  }
  const roof = layout.areas.filter(a => a.level === OFFICE_TOP_FLOOR && a.purpose === 'office-roof-access');
  if (roof.length !== 1) return [...issues, `${roof.length} roof access rooms on floor ${OFFICE_TOP_FLOOR}`];
  const plates = layout.signs.filter(s => s.level === OFFICE_TOP_FLOOR && s.text === 'ROOF ACCESS');
  if (plates.length !== 1) issues.push(`${plates.length} ROOF ACCESS plates`);
  for (const d of layout.doors.filter(q => (q.a === roof[0].id || q.b === roof[0].id) && q.level === OFFICE_TOP_FLOOR)) {
    const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
    if (layout.signs.some(s => s.level === OFFICE_TOP_FLOOR && /ELECTRICAL/.test(s.text) && Math.hypot(s.x - cx, s.z - cz) < 2.5)) issues.push('ELECTRICAL plate at the roof access door');
    if (!plates.some(s => Math.hypot(s.x - cx, s.z - cz) < 3.5)) issues.push('ROOF ACCESS plate not at the roof access door');
  }
  return issues;
}

/**
 * Task office-overhaul-20261030 (lane TENANTS): the lobby has no tenant; every office floor 2..8 has its company (areas tagged, both
 * signature kinds standing on it); every server room holds >= 2 racks (item 9); every narrow office corridor keeps a clear width
 * >= 1.5 m at every cross-section and no dead plant / planter tree (item 8).
 */
export function tenantIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const tenants = layout.office?.tenants;
  if (!tenants || tenants.map(t => t.floor).join(',') !== '2,3,4,5,6,7,8') return ['tenants: floors 2..8 not all assigned'];
  if (layout.areas.some(a => (a.level ?? 0) <= 1 && a.tenant)) issues.push('tenant area on the lobby / station');
  for (const t of tenants) {
    const c = COMPANIES[t.company];
    if (!layout.areas.some(a => a.level === t.floor && a.tenant === t.company)) issues.push(`floor ${t.floor}: no ${t.company} areas`);
    for (const k of c.signature) if (!layout.props.some(p => p.kind === k && p.level === t.floor)) issues.push(`floor ${t.floor}: ${t.company} signature ${k} missing`);
  }
  for (const a of layout.areas) {
    if (a.purpose === 'office-server' && layout.props.filter(p => p.area === a.id && p.kind === 'serverRack').length < 2) issues.push(`server room ${a.id} (level ${a.level}) has < 2 racks`);
    if (!isNarrowPassage(a)) continue;
    const {clear} = passageClear(layout, a);
    if (clear < CORRIDOR_CLEAR_M - 1e-6) issues.push(`corridor ${a.id} (level ${a.level}) clear width ${clear.toFixed(2)} m`);
    if (layout.props.some(p => p.area === a.id && isPlantKind(p.kind) && p.kind !== 'pottedPlantSmall')) issues.push(`corridor ${a.id} (level ${a.level}): a large plant`);
  }
  return issues;
}

