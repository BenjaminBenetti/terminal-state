// Task reactor-build-20261101 (lane GEN): after the crop — THE REACTOR's level links, maintenance ladders, railings, the restart
// sites' machines / controls / screens, the gas zones / fans / cables, the set pieces and the layout.reactor record. Pure data.
//
// The Kit canvas is cropped at the origin (cropKit ox = oy = 0): canvas cells ARE grid cells; world metres = cells * CELL.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {Levels, type LevelLink, type RailRun} from '../levels';
import {deriveRails} from '../levelGen';
import {LADDER, type Ladder, type StairFlight} from '../traversal';
import type {PropPlacement} from '../props';
import type {LightPlacement, StationLayout} from '../stationTypes';
import type {
  ReactorArrival, ReactorControl, ReactorDeck, ReactorFan, ReactorGenerator, ReactorInfo, ReactorMachine, ReactorMarker, ReactorPipeBank,
  ReactorPose, ReactorRect, ReactorScreen, ReactorSite, ReactorTier, ReactorTierRole, ReactorZone,
} from './reactorTypes';
import {BANK_CELLS, CORE_LEVEL, GENSET, TIERS, VESSEL, reactorStoreyLabel} from './frame';
import type {CellRect, ReactorCarve, RoomRec, RunRec, WallId} from './carve';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const rectWorld = (r: CellRect): ReactorRect => ({x0: r3(r.x * CELL), z0: r3(r.y * CELL), x1: r3((r.x + r.w) * CELL), z1: r3((r.y + r.h) * CELL)});
/** Yaw (camera convention: forward = (-sin yaw, -cos yaw)) facing along (dx, dz). */
export const yawToward = (dx: number, dz: number) => r3(Math.atan2(-dx, -dz));

/** Tier marker band colours (rim, tiers 1..4, core). */
export const TIER_COLORS = [0xd8d4c8, 0xd9b23a, 0xd9792e, 0xb53a2e, 0x7a4ab0, 0x3aa6a0];
/** Uncleared depth-gas concentrations per zone (top / bottom) — lane AIR owns the final tuning. */
export const ZONE_GAS: readonly [number, number][] = [[0.10, 0.32], [0.45, 0.65], [0.8, 0.9]]; // (task reactor-expansion-20261101: zone 0 top 0.14 -> 0.10 — the first generator, now in the tier-1 bunker, stands in visible haze BELOW the 0.12 damage threshold even at crouch eye: the generator route never needs a mask)
/** Gas zone of a storey: -1 the rim, 0 = tiers 1-2, 1 = tiers 3-4, 2 = the core floor. */
export const zoneOfLevel = (lv: number): number => (lv === 0 ? -1 : lv === CORE_LEVEL ? 2 : lv <= 2 ? 0 : 1);

// ---------------------------------------------------------------------------------------------
// Links, ladders, rails

/** One LevelLink per stair run (stand points of its lowest / highest flight). Returns the link id per run (rc.runs order). */
export function reactorLinks(rc: ReactorCarve, flights: readonly StairFlight[], links: LevelLink[]): number[] {
  return rc.runs.map(run => {
    const fl = run.flights.map(i => flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    const id = links.length;
    links.push({id, kind: 'stairs', lower: run.lower + 1, upper: run.lower, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
    return id;
  });
}

/**
 * The maintenance ladders beside the organ bank: on the stepped pipe terraces at the organ wall's south corner, one per storey pair,
 * climbing the upper terrace's north edge (a z-face) from the lower terrace (which reaches 1.5 m further north). Rescue-ladder style
 * (traversal.ladders kind 'maintenance' + a LevelLink 'ladder' WITH its traversal id: the AI path graph uses it, crossLinks).
 */
export function maintenanceLadders(layout: StationLayout, rc: ReactorCarve): {ladders: Ladder[]; links: number[]} {
  const ladders: Ladder[] = [], links: number[] = [];
  const px = rc.PW - 4, x = r3((rc.cx(px) + 0.5) * CELL);
  for (let lv = 0; lv < CORE_LEVEL; lv++) {
    const gt = layout.levels[lv].grid, gb = layout.levels[lv + 1].grid;
    const faceZ = r3((rc.PZ0 + rc.PD - rc.terraces[lv]) * CELL), dir = 1 as const;
    const topY = rc.bases[lv], bottomY = rc.bases[lv + 1];
    const bottom = {x, y: bottomY, z: r3(faceZ - dir * LADDER.standOff)}, top = {x, y: topY, z: r3(faceZ + dir * LADDER.topIn)};
    const [bx, by] = gb.cellOf(bottom.x, bottom.z), [tx, ty] = gt.cellOf(top.x, top.z);
    if (gb.cells[gb.idx(bx, by)] !== FLOOR || gt.cells[gt.idx(tx, ty)] !== FLOOR) continue;
    const id = layout.traversal.ladders.length + ladders.length;
    ladders.push({id, trench: -1, platform: gt.area[gt.idx(tx, ty)], x, faceZ, dir, bottomY, topY, bottom, top, pair: -1, link: -1, kind: 'maintenance', level: lv + 1, topLevel: lv});
    const lid = layout.levelLinks.length;
    layout.levelLinks.push({id: lid, kind: 'ladder', lower: lv + 1, upper: lv, bottom: {...bottom}, top: {...top}, traversalId: id, cost: LADDER.cost});
    links.push(lid);
  }
  layout.traversal.ladders.push(...ladders);
  return {ladders, links};
}

/**
 * Every railing: the aperture edges (gen/levelGen.ts deriveRails — the keys levelIssues checks) plus every other drop edge the union of
 * bands derives (stair flight sides, a deck edge over a lower flight / deck), merged runs following the pitch (gen/levels.ts).
 */
export function reactorRails(layout: StationLayout): RailRun[] {
  const base = deriveRails(layout.levels);
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops();
  return [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))];
}

// ---------------------------------------------------------------------------------------------
// Rooms: local frame helpers

/** Room-local frame: origin (world, the front-left corner), along / inward unit vectors (world), the room's floor y. */
export interface RoomFrame { ox: number; oz: number; ax: number; az: number; ix: number; iz: number; y: number; w: number; d: number }

function roomCanon(rc: ReactorCarve, wall: WallId, a: number, d: number): [number, number] {
  switch (wall) {
    case 'stair': return [-2 - d, a];
    case 'organ': return [rc.PW + 1 + d, a];
    case 'N': return [a, -2 - d];
    default: return [a, rc.PD + 1 + d];
  }
}
/** Canvas cell of room-local (a, d) (a: absolute along cell, d: cells inward from the front wall). */
export function roomCell(rc: ReactorCarve, rr: RoomRec, a: number, d: number): [number, number] {
  const [px, pz] = roomCanon(rc, rr.wall, a, d);
  return [rc.cx(px), rc.PZ0 + pz];
}
export function roomFrame(rc: ReactorCarve, rr: RoomRec): RoomFrame {
  const [x0, z0] = roomCell(rc, rr, rr.a0, 0), [x1, z1] = roomCell(rc, rr, rr.a0 + 1, 0), [x2, z2] = roomCell(rc, rr, rr.a0, 1);
  const ax = x1 - x0, az = z1 - z0, ix = x2 - x0, iz = z2 - z0;
  const cxw = (x0 + 0.5) * CELL, czw = (z0 + 0.5) * CELL;
  return {ox: cxw - 0.5 * CELL * (ax + ix), oz: czw - 0.5 * CELL * (az + iz), ax, az, ix, iz, y: rc.bases[rr.level], w: rr.w, d: rr.d};
}
/** World point of room-local continuous (a, d) in CELLS from the front-left corner. */
export const roomPoint = (f: RoomFrame, a: number, d: number): {x: number; z: number} => ({x: r3(f.ox + (a * f.ax + d * f.ix) * CELL), z: r3(f.oz + (a * f.az + d * f.iz) * CELL)});

/** Adds a collision-only machine box ('annexMachine': anchored plant, never storage) and blocks its cells. Returns the prop index. */
// task reactor-expansion-20261101 (lane HOST): exported — the side complexes' generators use the same anchored collision prop
export function machineProp(layout: StationLayout, level: number, area: number, x: number, z: number, hx: number, hz: number, h: number, variant: number): number {
  // y: relative to the storey floor here — the dresser's liftLevels lifts every level-tagged prop onto its floor (finishTraversal the rim's)
  const p: PropPlacement = {kind: 'annexMachine', x: r3(x), z: r3(z), y: 0, rot: 0, area, hx: r3(hx), hz: r3(hz), h, blocksSight: h > 1.7, variant, ...(level ? {level} : {})};
  layout.props.push(p);
  const g = layout.levels[level].grid;
  for (let cy = Math.floor((z - hz + 0.01) / CELL); cy <= Math.floor((z + hz - 0.01) / CELL); cy++) for (let cx = Math.floor((x - hx + 0.01) / CELL); cx <= Math.floor((x + hx - 0.01) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    g.blocked[i] = 1;
    if (p.blocksSight) g.sightBlocked[i] = 1;
  }
  return layout.props.length - 1;
}

/** A machine whose footprint is (along a0..a1, inward d0..d1) cells in the room frame; its front faces -inward (`front` = -1) or +inward / ±along. */
function machine(layout: StationLayout, rr: RoomRec, f: RoomFrame, kind: ReactorMachine['kind'], a0: number, a1: number, d0: number, d1: number, h: number, front: [number, number], variant: number): ReactorMachine {
  const c = roomPoint(f, (a0 + a1) / 2, (d0 + d1) / 2);
  const wA = (a1 - a0) * CELL, wD = (d1 - d0) * CELL;
  const alongX = f.ax !== 0;
  const hx = (alongX ? wA : wD) / 2, hz = (alongX ? wD : wA) / 2;
  const prop = machineProp(layout, rr.level, rr.area, c.x, c.z, hx, hz, h, variant);
  const fx = front[0] * f.ax + front[1] * f.ix, fz = front[0] * f.az + front[1] * f.iz;
  return {kind, x: c.x, z: c.z, y: f.y, yaw: yawToward(fx, fz), w: r3(wA), d: r3(wD), h, prop};
}

export interface SiteBuild { sites: ReactorSite[]; screens: ReactorScreen[]; holds: {level: number; cells: number[]}[]; keep: {level: number; x: number; z: number}[] }

/** The four restart sites: machines (collision props), controls (+ walkable prop-free stand points, held through the dresser), screens. */
export function buildSites(layout: StationLayout, rc: ReactorCarve): SiteBuild {
  const sites: ReactorSite[] = [], screens: ReactorScreen[] = [], holds: SiteBuild['holds'] = [], keep: SiteBuild['keep'] = [];
  const room = (key: string) => rc.rooms.find(r => r.key === key)!;
  const hold = (level: number, x: number, z: number, r = 1) => {
    const g = layout.levels[level].grid, [cx, cy] = g.cellOf(x, z), cells: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (g.inBounds(cx + dx, cy + dy) && g.cells[g.idx(cx + dx, cy + dy)] === FLOOR) cells.push(g.idx(cx + dx, cy + dy));
    holds.push({level, cells});
    keep.push({level, x, z});
  };
  const control = (f: RoomFrame, level: number, id: string, a: number, dAt: number, dStand: number, y: number): ReactorControl => {
    const at = roomPoint(f, a, dAt), st = roomPoint(f, a, dStand);
    const toward = [at.x - st.x, at.z - st.z];
    hold(level, st.x, st.z);
    return {id, at: {x: at.x, y: r3(f.y + y), z: at.z}, stand: {x: st.x, z: st.z, yaw: yawToward(toward[0], toward[1]), level}, yaw: yawToward(-toward[0], -toward[1])};
  };
  const screen = (f: RoomFrame, level: number, id: ReactorScreen['id'], a: number, d: number, faceA: number, faceD: number, y: number, w: number, h: number): ReactorScreen => {
    const p = roomPoint(f, a, d);
    return {id, level, x: p.x, y: r3(f.y + y), z: p.z, yaw: yawToward(faceA * f.ax + faceD * f.ix, faceA * f.az + faceD * f.iz), w, h};
  };
  // Switchgear (tier 4): the bank (5 m) along the back wall, two fuse bays and the main breaker; the board on a side wall.
  {
    const rr = room('switchgear'), f = roomFrame(rc, rr), lv = rr.level;
    const b0 = Math.floor((f.w - 10) / 2);
    const bank = machine(layout, rr, f, 'switchgear', b0, b0 + 10, f.d - 2, f.d, 2.3, [0, -1], 3);
    const controls = [control(f, lv, 'fuse-0', b0 + 2, f.d - 2, f.d - 4.1, 1.3), control(f, lv, 'fuse-1', b0 + 5, f.d - 2, f.d - 4.1, 1.3), control(f, lv, 'breaker', b0 + 8.5, f.d - 2, f.d - 4.1, 1.4)];
    sites.push({id: 'switchgear', level: lv, area: rr.area, rect: rectWorld(rr.rect), controls, machines: [bank]});
    screens.push(screen(f, lv, 'switchgearBoard', 0, f.d / 2, 1, 0, 1.9, 1.6, 1.0));
  }
  // Pump hall (core floor): the circulation pump skid (3.5 x 1.5 m) mid-room, the main coolant valve stand in a back corner.
  {
    const rr = room('pumpHall'), f = roomFrame(rc, rr), lv = rr.level;
    const pa0 = Math.round(f.w / 2 - 3.5), pd0 = Math.round(f.d / 2 - 0.5);
    const pump = machine(layout, rr, f, 'pump', pa0, pa0 + 7, pd0, pd0 + 3, 1.6, [-1, 0], 1);
    const valve = machine(layout, rr, f, 'valve', f.w - 3, f.w - 1, f.d - 3, f.d - 1, 1.4, [0, -1], 1);
    const controls = [control(f, lv, 'valve', f.w - 2, f.d - 3, f.d - 5.1, 1.6), control(f, lv, 'pump', pa0 - 0.01, pd0 + 1.5, pd0 + 1.5, 1.2)];
    // the pump's stand point is beside its end face (along -a), not inside the skid
    const pc = controls[1], at = roomPoint(f, pa0, pd0 + 1.5), st = roomPoint(f, pa0 - 2.1, pd0 + 1.5);
    holds.pop(); keep.pop(); hold(lv, st.x, st.z);
    controls[1] = {...pc, at: {x: at.x, y: pc.at.y, z: at.z}, stand: {x: st.x, z: st.z, yaw: yawToward(at.x - st.x, at.z - st.z), level: lv}, yaw: yawToward(st.x - at.x, st.z - at.z)};
    sites.push({id: 'pumpHall', level: lv, area: rr.area, rect: rectWorld(rr.rect), controls, machines: [pump, valve]});
    screens.push(screen(f, lv, 'pumpBoard', f.w / 4, f.d, 0, -1, 1.9, 1.6, 1.0));
  }
  // Control room (core floor): the console (3 m) facing the wide opening onto the vessel; key switch + rod withdrawal at its back.
  {
    const rr = room('control'), f = roomFrame(rc, rr), lv = rr.level;
    const c0 = Math.round(f.w / 2 - 3);
    const console = machine(layout, rr, f, 'console', c0, c0 + 6, 3, 5, 1.1, [0, 1], 4);
    const controls = [control(f, lv, 'keyswitch', c0 + 1.5, 5, 7.1, 1.1), control(f, lv, 'rods', c0 + 4.5, 5, 7.1, 1.1)];
    sites.push({id: 'control', level: lv, area: rr.area, rect: rectWorld(rr.rect), controls, machines: [console]});
    // the monitor on the opening wall, in the wider wall segment beside the opening (facing into the room)
    const dA = rr.doorA0 - rr.a0, dB = dA + rr.doorW;
    const a = dA >= f.w - dB ? dA / 2 : (dB + f.w) / 2;
    screens.push(screen(f, lv, 'controlMonitor', a, 0, 0, 1, 2.0, Math.min(3, Math.max(1.2, (Math.max(dA, f.w - dB) - 1) * CELL)), 1.4));
  }
  // Rim control office: the pit status board on the back wall (the statusBoard control + the pitBoard screen).
  {
    const rr = room('rimOffice'), f = roomFrame(rc, rr), lv = rr.level;
    const board = machine(layout, rr, f, 'statusBoard', f.w / 2 - 3, f.w / 2 + 3, f.d - 1, f.d, 2.2, [0, -1], 3);
    const controls = [control(f, lv, 'statusBoard', f.w / 2, f.d - 1, f.d - 3.1, 1.4)];
    sites.push({id: 'rimOffice', level: lv, area: rr.area, rect: rectWorld(rr.rect), controls, machines: [board]});
    screens.push(screen(f, lv, 'pitBoard', f.w / 2, f.d - 1.05, 0, -1, 1.9, 2.4, 1.3));
  }
  // The control room's opening and every room door stay clear (2 m inside / outside).
  for (const rr of rc.rooms) {
    const f = roomFrame(rc, rr);
    for (let t = 0; t < rr.doorW; t += 2) for (const d of [-2.5, 1.5]) {
      const p = roomPoint(f, rr.doorA0 - rr.a0 + t + 0.5, d);
      const lv = rr.level, g = layout.levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z), cells: number[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.inBounds(cx + dx, cy + dy) && g.cells[g.idx(cx + dx, cy + dy)] === FLOOR) cells.push(g.idx(cx + dx, cy + dy));
      holds.push({level: lv, cells});
    }
  }
  return {sites, screens, holds, keep};
}

/** The generators: collision props (anchored gensets) on their landings + the records (cables are filled by reactorInfo). */
export function buildGenerators(layout: StationLayout, rc: ReactorCarve): {gens: ReactorGenerator[]; holds: {level: number; cells: number[]}[]; keep: {level: number; x: number; z: number}[]} {
  const gens: ReactorGenerator[] = [], holds: {level: number; cells: number[]}[] = [], keep: {level: number; x: number; z: number}[] = [];
  rc.gens.forEach((g, id) => {
    const lv = g.level, y = rc.bases[lv];
    const x = (g.foot.x + g.foot.w / 2) * CELL, z = (g.foot.y + g.foot.h / 2) * CELL;
    machineProp(layout, lv, g.area, x, z, g.foot.w * CELL / 2 - 0.1, g.foot.h * CELL / 2 - 0.1, GENSET.h, 1);
    const ux = (rc.cx(g.use.px) + 0.5) * CELL, uz = (rc.PZ0 + g.use.pz + 0.5) * CELL;
    const panelZ = g.use.yaw === 0 ? (g.foot.y + g.foot.h) * CELL : g.foot.y * CELL;
    gens.push({
      id, zone: g.zone, level: lv, area: g.area, x: r3(x), z: r3(z), y, yaw: r3(Math.PI / 2), size: {...GENSET},
      use: {x: r3(ux), z: r3(uz), yaw: r3(g.use.yaw), level: lv}, panel: {x: r3(x), y: r3(y + 1.2), z: r3(panelZ)}, cable: [],
    });
    const gr = layout.levels[lv].grid, [cx, cy] = gr.cellOf(ux, uz), cells: number[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (gr.inBounds(cx + dx, cy + dy) && gr.cells[gr.idx(cx + dx, cy + dy)] === FLOOR) cells.push(gr.idx(cx + dx, cy + dy));
    holds.push({level: lv, cells});
    keep.push({level: lv, x: ux, z: uz});
  });
  return {gens, holds, keep};
}

// ---------------------------------------------------------------------------------------------
// Fans, cables

interface WallFrame { id: WallId; len: number; cell: (u: number, v: number) => [number, number]; nx: number; nz: number }
function wallFrames(rc: ReactorCarve): WallFrame[] {
  const {PW, PD, PZ0} = rc, sx = rc.cx(1) - rc.cx(0); // +1 canonical px -> world x sign
  return [
    {id: 'stair', len: PD, cell: (u, v) => [rc.cx(v), PZ0 + PD - 1 - u], nx: sx, nz: 0},
    {id: 'organ', len: PD, cell: (u, v) => [rc.cx(PW - 1 - v), PZ0 + PD - 1 - u], nx: -sx, nz: 0},
    {id: 'N', len: PW, cell: (u, v) => [rc.cx(u), PZ0 + v], nx: 0, nz: 1},
    {id: 'S', len: PW, cell: (u, v) => [rc.cx(u), PZ0 + PD - 1 - v], nx: 0, nz: -1},
  ];
}

/** Wall extraction fans of every zone: 2-4 per zone on the pit walls between its storeys, clear of decks / stairs where possible. */
export function placeFans(layout: StationLayout, rc: ReactorCarve, rng: Rng): ReactorFan[] {
  const fans: ReactorFan[] = [];
  const walls = wallFrames(rc);
  const zoneLevels = [[1, 2], [3, 4], [CORE_LEVEL]];
  zoneLevels.forEach((lvs, zone) => {
    for (const strict of [true, false]) {
      const cands: {lv: number; w: WallFrame; u: number; x: number; z: number; y: number}[] = [];
      for (const lv of lvs) {
        const g = layout.levels[lv].grid;
        for (const w of walls) for (let u = 6; u < w.len - 6; u += 3) {
          let ok = true;
          for (let du = -3; du <= 3 && ok; du++) {
            const [x, z] = w.cell(u + du, 0);
            const i = g.idx(x, z);
            if (layout.levels.some(L => L.grid.cells[i] === SOLID && L.id === CORE_LEVEL)) ok = false; // bank / tower leg at the wall
            else if (g.rampIdx[i] >= 0 || (strict && g.cells[i] !== SOLID)) ok = false;
            // never over a stair run of any storey within the fan's height (+- 2 m)
            for (const L of layout.levels) if (L.grid.rampIdx[i] >= 0 && Math.abs(L.grid.floor[i] - (rc.bases[lv] + 3.2)) < 2.4) ok = false;
          }
          if (!ok) continue;
          const [x, z] = w.cell(u, 0);
          cands.push({lv, w, u, x: r3((x + 0.5) * CELL - w.nx * 0.5 * CELL), z: r3((z + 0.5) * CELL - w.nz * 0.5 * CELL), y: r3(rc.bases[lv] + 3.2)});
        }
      }
      if (cands.length < 2) continue;
      const want = rng.int(2, Math.min(4, cands.length));
      const picked = [cands[rng.int(0, cands.length - 1)]];
      while (picked.length < want) {
        let best = cands[0], bd = -1;
        for (const c of cands) {
          const d = Math.min(...picked.map(p => Math.hypot(p.x - c.x, p.z - c.z) + Math.abs(p.y - c.y) * 2));
          if (d > bd) { bd = d; best = c; }
        }
        if (bd < 4) break;
        picked.push(best);
      }
      for (const c of picked) fans.push({id: fans.length, zone, level: c.lv, x: c.x, y: c.y, z: c.z, nx: c.w.nx, nz: c.w.nz, radius: 1.2});
      break;
    }
  });
  return fans;
}

/** Which pit wall a world point lies on (nearest wall plane), and the pit corners (world, inset 0.3 m). */
function wallOf(rc: ReactorCarve, x: number, z: number): WallId {
  const x0 = rc.cx(0) < rc.cx(rc.PW - 1) ? rc.cx(0) * CELL : rc.cx(rc.PW - 1) * CELL, x1 = x0 + rc.PW * CELL;
  const z0 = rc.PZ0 * CELL, z1 = z0 + rc.PD * CELL;
  const d = {w: Math.abs(x - x0), e: Math.abs(x - x1), n: Math.abs(z - z0), s: Math.abs(z - z1)};
  const m = Math.min(d.w, d.e, d.n, d.s);
  const westIsStair = rc.cx(0) < rc.cx(1);
  if (m === d.n) return 'N';
  if (m === d.s) return 'S';
  if (m === d.w) return westIsStair ? 'stair' : 'organ';
  return westIsStair ? 'organ' : 'stair';
}

/**
 * Cable polyline from a generator's panel along the pit walls (round the corners) to each of its zone's fans in turn. (task
 * reactor-expansion-20261101, lane HOST) `from`: a side complex's generator — the run starts where its cable leaves the entrance,
 * projected onto that pit wall's plane, instead of at the panel on the stair wall.
 */
export function cableOf(rc: ReactorCarve, gen: ReactorGenerator, fans: readonly ReactorFan[], from?: {x: number; y: number; z: number; wall: WallId}): {x: number; y: number; z: number}[] {
  const x0 = Math.min(rc.cx(0), rc.cx(rc.PW - 1)) * CELL + 0.3, x1 = x0 + rc.PW * CELL - 0.6;
  const z0 = rc.PZ0 * CELL + 0.3, z1 = z0 + rc.PD * CELL - 0.6;
  const westIsStair = rc.cx(0) < rc.cx(1);
  const sx = (w: WallId): number | null => (w === 'stair' ? (westIsStair ? x0 : x1) : w === 'organ' ? (westIsStair ? x1 : x0) : null);
  const corner = (a: WallId, b: WallId): {x: number; z: number} | null => {
    const xs = sx(a) ?? sx(b), zs = a === 'N' || b === 'N' ? z0 : a === 'S' || b === 'S' ? z1 : null;
    return xs !== null && zs !== null ? {x: xs, z: zs} : null;
  };
  const pts: {x: number; y: number; z: number; w: WallId}[] = [];
  const wallX = sx('stair')!;
  if (from) pts.push({x: sx(from.wall) ?? from.x, y: from.y, z: from.wall === 'N' ? z0 : from.wall === 'S' ? z1 : from.z, w: from.wall}); // lane HOST
  else pts.push({x: gen.panel.x, y: gen.panel.y, z: gen.panel.z, w: 'stair'}, {x: wallX, y: gen.y + 2.6, z: gen.panel.z, w: 'stair'});
  let rest = fans.slice();
  while (rest.length) {
    const last = pts[pts.length - 1];
    rest.sort((a, b) => Math.hypot(a.x - last.x, a.z - last.z) - Math.hypot(b.x - last.x, b.z - last.z));
    const f = rest[0];
    rest = rest.slice(1);
    const fw = wallOf(rc, f.x, f.z);
    if (fw !== last.w) {
      const c = corner(last.w, fw);
      if (c) pts.push({x: c.x, y: (last.y + f.y) / 2, z: c.z, w: fw});
      else {
        // opposite walls: round the shorter way (stair <-> organ via the north or the south wall; north <-> south via a side wall)
        const ns = last.w === 'N' || last.w === 'S';
        const sxS = sx('stair')!, sxO = sx('organ')!;
        const via: WallId = ns
          ? (Math.abs(last.x - sxS) + Math.abs(f.x - sxS) < Math.abs(last.x - sxO) + Math.abs(f.x - sxO) ? 'stair' : 'organ')
          : (Math.abs(last.z - z0) + Math.abs(f.z - z0) < Math.abs(last.z - z1) + Math.abs(f.z - z1) ? 'N' : 'S');
        const c1 = corner(last.w, via)!, c2 = corner(via, fw)!;
        pts.push({x: c1.x, y: (2 * last.y + f.y) / 3, z: c1.z, w: via}, {x: c2.x, y: (last.y + 2 * f.y) / 3, z: c2.z, w: fw});
      }
    }
    pts.push({x: f.x, y: f.y, z: f.z, w: fw});
  }
  return pts.map(p => ({x: r3(p.x), y: r3(p.y), z: r3(p.z)}));
}

// ---------------------------------------------------------------------------------------------
// Lights

/** Emergency decks: lit from the start (steady fixtures) — the stair / generator / route-2 end landings; the rim runs on station power. */
const EMERGENCY = /^(Generator landing|Stair landing|South landing|Rim )/;

/** Every this-many-th powered deck lamp stays on (dim, steady) before the restart (task reactor-build-20261101 spot-check fix). */
export const POWERED_EMERGENCY_EVERY = 3;

/**
 * Deck fixtures: wall-side lamps along the galleries / landings / terraces every ~7 m (2.6 m up), lamps on the bridges and tower decks,
 * a ring of work lamps round the vessel. Lane RESTART's light contract: the pit's POWERED industrial fixtures (galleries, bridges,
 * towers, pipe terraces, the core ring) are `dying` (flicker circuit 2: held at 0 until the restart, ramped to 1 at the win); the
 * emergency lamps (the rim on station power, one steady low lamp per stair / generator / route-2 landing) are ordinary steady
 * fixtures. Nothing else on this level is `dying`. Every fixture has its storey set (`level`).
 */
export function deckLights(layout: StationLayout, rc: ReactorCarve, rng: Rng): number {
  const before = layout.lights.length;
  // task reactor-build-20261101 (primary, spot-check fix): with EVERY deck lamp on the dead circuit the pit read pitch black before the
  // restart (browser spot check: the rim vista showed nothing below). Every POWERED_EMERGENCY_EVERY-th powered deck lamp therefore
  // stays on as a dim steady emergency lamp (sodium pools down the pit, like B), the rest come up at the win.
  let poweredN = 0;
  const add = (lv: number, area: number, x: number, z: number, y: number, rot: number, mode0: 'rim' | 'emergency' | 'powered', deck = true) => {
    const mode = mode0 === 'powered' && deck && poweredN++ % POWERED_EMERGENCY_EVERY === 1 ? 'emergency' : mode0;
    const l: LightPlacement = mode === 'powered'
      ? {x: r3(x), y: r3(y), z: r3(z), rot, area, broken: false, flicker: false, warm: true, power: r3(rng.range(0.85, 1)), dying: true}
      : {x: r3(x), y: r3(y), z: r3(z), rot, area, broken: false, flicker: false, warm: true, power: mode === 'rim' ? r3(rng.range(0.85, 1)) : r3(rng.range(0.45, 0.6)), dying: false};
    if (lv) l.level = lv;
    layout.lights.push(l);
  };
  for (const d of rc.decks) {
    const mode = d.level === 0 ? 'rim' : EMERGENCY.test(d.label) ? 'emergency' : 'powered';
    let placed = 0;
    const r = d.rect, lv = d.level, alongX = r.w >= r.h;
    const len = (alongX ? r.w : r.h) * CELL, step = d.kind === 'bridge' ? 9 : 7;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      let x = (r.x + (alongX ? r.w * t : r.w / 2)) * CELL, z = (r.y + (alongX ? r.h / 2 : r.h * t)) * CELL;
      // wall-side decks: hang the lamp at the wall (first deck cell)
      if (d.wall) {
        const w = wallFrames(rc).find(q => q.id === d.wall)!;
        if (w.nx) x = (w.nx > 0 ? r.x : r.x + r.w) * CELL + w.nx * 0.3;
        else z = (w.nz > 0 ? r.y : r.y + r.h) * CELL + w.nz * 0.3;
      }
      const g = layout.levels[lv].grid, [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.area[g.idx(cx, cy)] !== d.area || g.ceil[g.idx(cx, cy)] < d.y + 2.9) continue;
      // an emergency landing gets one steady lamp; its other fixtures join the powered circuit
      add(lv, d.area, x, z, d.y + 2.6, alongX ? 0 : Math.PI / 2, mode === 'emergency' && placed > 0 ? 'powered' : mode);
      placed++;
    }
  }
  // the core floor: a ring of work lamps round the vessel plinth
  const ccx = (Math.min(rc.cx(0), rc.cx(rc.PW - 1)) + rc.PW / 2) * CELL, ccz = (rc.PZ0 + rc.PD / 2) * CELL;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, rr = VESSEL.r + 3;
    const x = ccx + Math.cos(a) * rr, z = ccz + Math.sin(a) * rr;
    const g = layout.levels[CORE_LEVEL].grid, [cx, cy] = g.cellOf(x, z);
    const i = g.idx(cx, cy), y = rc.bases[CORE_LEVEL] + 3.0;
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.blocked[i] || !rc.coreAreas.includes(g.area[i]) || g.ceil[i] < y + 0.3) continue;
    add(CORE_LEVEL, g.area[i], x, z, y, 0, 'powered', false);
  }
  return layout.lights.length - before;
}

// ---------------------------------------------------------------------------------------------
// The record

export interface InfoInput {
  linkIds: number[];
  ladderLinks: number[];
  gens: ReactorGenerator[];
  fans: ReactorFan[];
  sites: ReactorSite[];
  screens: ReactorScreen[];
  components: ReactorInfo['components'];
  start: ReactorPose;
  flights: readonly StairFlight[];
}

export function reactorInfo(layout: StationLayout, rc: ReactorCarve, rng: Rng, inp: InfoInput): ReactorInfo {
  const {bases, PW, PD} = rc;
  const xA = Math.min(rc.cx(0), rc.cx(PW - 1)), pitRect: CellRect = {x: xA, y: rc.PZ0, w: PW, h: PD};
  const b = rectWorld(pitRect);
  const pit = {
    outline: [{x: b.x0, z: b.z0}, {x: b.x1, z: b.z0}, {x: b.x1, z: b.z1}, {x: b.x0, z: b.z1}], bounds: b, cx: r3((b.x0 + b.x1) / 2), cz: r3((b.z0 + b.z1) / 2),
    rimY: 0, floorY: bases[CORE_LEVEL], roofY: rc.f.roofY, variant: rc.f.variant,
  };
  const roleOf = (lv: number): ReactorTierRole => (lv === 0 ? 'rim' : lv === CORE_LEVEL ? 'core' : lv <= 2 ? 'upper' : lv === 3 ? 'middle' : 'deep');
  const tiers: ReactorTier[] = bases.map((y, lv) => ({level: lv, index: lv, role: roleOf(lv), label: reactorStoreyLabel(lv), baseY: y, zone: zoneOfLevel(lv), color: TIER_COLORS[lv]}));
  const mid = (a: number, c: number) => r3((bases[a] + bases[c]) / 2);
  const bands: [number, number][] = [[mid(0, 1), mid(2, 3)], [mid(2, 3), mid(4, 5)], [mid(4, 5), bases[CORE_LEVEL]]];
  const zones: ReactorZone[] = bands.map(([yTop, yBottom], id) => ({
    id, yTop, yBottom, cTop: ZONE_GAS[id][0], cBottom: ZONE_GAS[id][1], levels: tiers.filter(t => t.zone === id).map(t => t.level),
    generator: inp.gens.find(g => g.zone === id)?.id ?? -1, fans: inp.fans.filter(f => f.zone === id).map(f => f.id),
  }));
  for (const g of inp.gens) g.cable = cableOf(rc, g, inp.fans.filter(f => f.zone === g.zone));
  // decks: every carved deck + the inline landings between the flights of each run
  const decks: ReactorDeck[] = rc.decks.map(d => ({kind: d.kind, level: d.level, rect: rectWorld(d.rect), y: d.y}));
  for (const run of rc.runs) {
    const fl = run.flights.map(i => inp.flights[i]);
    for (let i = 0; i + 1 < fl.length; i++) {
      const a = fl[i], c = fl[i + 1];
      const s0 = Math.min(a.s1, c.s0), s1 = Math.max(a.s1, c.s0);
      const rect: ReactorRect = run.axis === 'x' ? {x0: r3(s0), z0: r3(a.a0), x1: r3(s1), z1: r3(a.a1)} : {x0: r3(a.a0), z0: r3(s0), x1: r3(a.a1), z1: r3(s1)};
      decks.push({kind: 'stair-landing', level: run.lower, rect, y: r3(a.h1)});
    }
  }
  const towers = rc.towers.map(t => {
    const r = rc.rectC(t.px, t.pz, 10, 10);
    return {x: r3((r.x + 5) * CELL), z: r3((r.y + 5) * CELL), hx: 2.5, hz: 2.5, y0: bases[CORE_LEVEL], y1: r3(rc.f.roofY - 2)};
  });
  // crane: runway along the frame's axis near the roof, the bridge over the open pit, the hook hanging into the pit
  const crane = (() => {
    const axis = rc.f.craneAxis;
    const a0 = axis === 'x' ? b.x0 + 1 : b.z0 + 1, a1 = axis === 'x' ? b.x1 - 1 : b.z1 - 1;
    const c0 = axis === 'x' ? b.z0 + 1.2 : b.x0 + 1.2, c1 = axis === 'x' ? b.z1 - 1.2 : b.x1 - 1.2;
    const gC = layout.levels[CORE_LEVEL].grid;
    const open = (x: number, z: number) => { const [cx, cy] = gC.cellOf(x, z); const i = gC.idx(cx, cy); return gC.cells[i] === FLOOR && !gC.blocked[i] && gC.ceil[i] >= rc.f.roofY - 0.01; };
    let bridgeAt = r3(a0 + (a1 - a0) * rng.range(0.3, 0.7)), trolleyAt = r3(c0 + (c1 - c0) * rng.range(0.3, 0.7));
    search: for (let t = 0; t < 40; t++) {
      const ba = a0 + (a1 - a0) * rng.range(0.25, 0.75), tc = c0 + (c1 - c0) * rng.range(0.25, 0.75);
      const [x, z] = axis === 'x' ? [ba, tc] : [tc, ba];
      for (let dx = -1.5; dx <= 1.5; dx += 0.5) for (let dz = -1.5; dz <= 1.5; dz += 0.5) if (!open(x + dx, z + dz)) continue search;
      bridgeAt = r3(ba); trolleyAt = r3(tc);
      break;
    }
    return {axis, railY: r3(rc.f.roofY - 3), a0: r3(a0), a1: r3(a1), b0: r3(c0), b1: r3(c1), bridgeAt, trolleyAt, hookY: r3(rng.range(-9, -3))};
  })();
  const westIsStair = rc.cx(0) < rc.cx(1);
  const organX = westIsStair ? b.x1 : b.x0, onx = westIsStair ? -1 : 1;
  const pipeBanks: ReactorPipeBank[] = rc.f.banks.map(([p0, p1]) => ({
    x0: organX, z0: r3((rc.PZ0 + p0) * CELL), x1: organX, z1: r3((rc.PZ0 + p1) * CELL), nx: onx, nz: 0, y0: bases[CORE_LEVEL], y1: r3(rc.f.roofY - 1), depth: BANK_CELLS * CELL,
  }));
  const core = {x: pit.cx, z: pit.cz, radius: VESSEL.r, y0: bases[CORE_LEVEL], y1: r3(bases[CORE_LEVEL] + VESSEL.h)};
  const markers: ReactorMarker[] = [];
  for (let lv = 1; lv <= CORE_LEVEL; lv++) markers.push({level: lv, y0: r3(bases[lv] + 3.0), y1: r3(bases[lv] + 3.6), color: TIER_COLORS[lv], text: lv === CORE_LEVEL ? 'CORE' : `T${lv}`});
  const tr = layout.trenches[0];
  const P = layout.areas[layout.platform];
  const arrival: ReactorArrival = {
    platform: P.id, trench: 0, track: tr.tracks.length - 1, axis: 'x', stop0: r3(P.x * CELL + 2), stop1: r3((P.x + P.w) * CELL - 2), doorSide: 'S',
    maxLength: r3((P.w * CELL) - 4),
  };
  const route = (kind: RunRec['route']) => rc.runs.map((r, i) => ({r, i})).filter(q => q.r.route === kind).sort((p, q) => p.r.lower - q.r.lower).map(q => inp.linkIds[q.i]);
  return {
    version: 1, name: 'Reactor', pit, tiers, zones, generators: inp.gens, fans: inp.fans, sites: inp.sites, components: inp.components, screens: inp.screens,
    decks, towers, crane, pipeBanks, core, markers, start: inp.start, arrival,
    routes: [{kind: 'stairs', links: route('stairs')}, {kind: 'bridge', links: route('bridge')}, {kind: 'ladder', links: inp.ladderLinks.slice()}],
  };
}

/** Clear cells round the stair-run mouths (3 m in front of both ends of every run, both storeys) — held prop-free while dressing. */
export function mouthHolds(layout: StationLayout, rc: ReactorCarve, links: readonly LevelLink[]): {level: number; cells: number[]}[] {
  const out: {level: number; cells: number[]}[] = [];
  for (const k of links) {
    for (const [lv, p] of [[k.lower, k.bottom], [k.upper, k.top]] as const) {
      const g = layout.levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z), cells: number[] = [];
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (g.inBounds(cx + dx, cy + dy) && g.cells[g.idx(cx + dx, cy + dy)] === FLOOR) cells.push(g.idx(cx + dx, cy + dy));
      out.push({level: lv, cells});
    }
  }
  void rc;
  return out;
}

/** Every pit deck cell (and the core floor) of every storey: held through the station dresser (the decks get their own fixtures). */
export function deckHolds(layout: StationLayout, rc: ReactorCarve): {level: number; cells: number[]}[] {
  const ids = new Set([...rc.decks.map(d => d.area), ...rc.coreAreas]);
  return layout.levels.map((L: {id: number; grid: Grid}) => {
    const g = L.grid, cells: number[] = [];
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && ids.has(g.area[i])) cells.push(i);
    return {level: L.id, cells};
  });
}

export {TIERS};
