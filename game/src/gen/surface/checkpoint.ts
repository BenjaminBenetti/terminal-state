// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's PORTAL and MILITARY CHECKPOINT — the district side of
// the host station's access and the compound in front of it (the corner plaza of the portal block, gen/surface/cityBlocks.ts).
//
//  - Subway host: a subway-entrance HEADHOUSE in the plaza's inner corner: a walled canopy over a real stair (two flights, a landing) down
//    to a grille at its foot — the grille is the portal's trigger (the way back down); the player arrives at the stair head outside.
//  - Office host: the host TOWER's lobby doors on the plaza (the tower is a closed shell: its doors are the trigger).
//  - Mall host: the host MALL's street entrance on the plaza (likewise).
//  - The compound fills the plaza: a barrier line of jersey barriers / sandbag walls along both street edges (an 8 m vehicle gate on one,
//    a 2 m foot gap on the other), the COMMAND TENT (a small enclosed room: canvas walls = SOLID ring, a flap door) with the planning-map
//    table and the field radio inside, military crates (openable: loot-table contents, finite), cots, work lights on the generator, and
//    the TRUCK's parking box facing out through the gate (kept clear).
// Plaza-local frame: u (m) from the plaza's inner west/east edge toward its street side, v (m) from its inner north/south edge toward its
// street side (the portal stands at u, v ~ 0).

import {CELL, FLOOR, SOLID} from '../grid';
import type {Kit} from '../stationKit';
import type {Door, LightPlacement, Side} from '../stationTypes';
import {layStairRun, type StairFlight} from '../traversal';
import type {SBox, SPose, SRect, SurfaceCheckpoint, SurfacePortal} from './surfaceTypes';
import type {SurfaceHost} from './surfaceRun';
import {crH, crW, type CR, type CityFrame} from './cityFrame';
import {KERB, addBuildingPlan, type BlockPlans, type BuildingPlan} from './cityBlocks';
import type {GroundMap} from './cityCarve';
import {FACE_ROT, OutdoorProps} from './outdoorKinds';
import type {Rng} from '../../core/rng';

/** Headhouse / tent tunables (cells unless noted). */
export const PORTAL = {
  head: {len: 23, wid: 10, landing: 3, bottom: -3.0, canopy: 3.2},
  tent: {len: 14, wid: 10, door: 3, clear: 2.6, doorH: 2.1, ridge: 3.1},
  /** The vehicle gate (m) and the truck's parked box (m, centre-line lengths). */
  gate: 8,
  truck: {len: 7.2, wid: 2.6, margin: 1.0},
} as const;

export interface PlazaFrame {
  r: CR;
  ns: 'N' | 'S';
  we: 'W' | 'E';
  /** Plaza size (m). */
  U: number;
  V: number;
}

export const plazaFrame = (plans: BlockPlans): PlazaFrame => ({r: plans.plaza, ns: plans.plazaCorner[0] as 'N' | 'S', we: plans.plazaCorner[1] as 'W' | 'E',
  U: crW(plans.plaza) * CELL, V: crH(plans.plaza) * CELL});

/** Plaza-local (u, v) metres -> world (x, z). */
export function pw(p: PlazaFrame, u: number, v: number): {x: number; z: number} {
  return {x: p.we === 'E' ? p.r.x0 * CELL + u : p.r.x1 * CELL - u, z: p.ns === 'S' ? p.r.y0 * CELL + v : p.r.y1 * CELL - v};
}
/** Plaza-local cell rect (u0..u1, v0..v1 in cells) -> world cell rect. */
export function pcr(p: PlazaFrame, u0: number, u1: number, v0: number, v1: number): CR {
  const x0 = p.we === 'E' ? p.r.x0 + u0 : p.r.x1 - u1, x1 = p.we === 'E' ? p.r.x0 + u1 : p.r.x1 - u0;
  const y0 = p.ns === 'S' ? p.r.y0 + v0 : p.r.y1 - v1, y1 = p.ns === 'S' ? p.r.y0 + v1 : p.r.y1 - v0;
  return {x0, y0, x1, y1};
}
/** World side of +u / +v. */
const sideU = (p: PlazaFrame): Side => p.we;
const sideV = (p: PlazaFrame): Side => p.ns;
/** Camera yaw facing world side s (forward = (-sin yaw, -cos yaw)). */
export const YAW: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
const srect = (r: CR): SRect => ({x0: r.x0 * CELL, z0: r.y0 * CELL, x1: r.x1 * CELL, z1: r.y1 * CELL});

export interface PortalCarve {
  portal: SurfacePortal;
  plaza: PlazaFrame;
  /** The command tent: its building plan, outer rect, area, door. */
  tent: {plan: BuildingPlan; rect: CR; area: number; door: {x: number; z: number; side: Side}; doorCells: number[]};
  /** The subway headhouse (subway host only): its plan, stair area, flights. */
  head: {plan: BuildingPlan; area: number; flights: StairFlight[]} | null;
  /** The portal building (headhouse / host tower / host mall). */
  portalBuilding: number;
  doors: Door[];
}

function solidRing(kit: Kit, r: CR): void {
  const g = kit.g;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = g.idx(x, y);
    g.cells[i] = SOLID; g.area[i] = -1; g.ceil[i] = 0; g.floor[i] = 0;
  }
}

/** Carves the portal (headhouse stair / the host building's doors) and the command tent into the plaza (before the interiors). */
export function carvePortal(kit: Kit, f: CityFrame, plans: BlockPlans, ground: GroundMap, host: SurfaceHost, rng: Rng, districtRoot: string): PortalCarve {
  const g = kit.g;
  const p = plazaFrame(plans);
  const compoundArea = g.area[g.idx(p.r.x0 + 2, p.r.y0 + 2)];
  const block = f.blocks[plans.portal];
  const ctx = {rng, buildings: plans.buildings, names: new Set(plans.buildings.map(b => b.name).filter(Boolean)), districtRoot};
  const doors: Door[] = [];
  const U = sideU(p);
  let portal: SurfacePortal, head: PortalCarve['head'] = null, portalBuilding: number;

  if (host === 'subway') {
    const H = PORTAL.head;
    const fr = pcr(p, 0, H.len, 0, H.wid);
    const plan = addBuildingPlan(ctx, block, fr, 'civic', 'subway-entrance', false, U, {host: 'headhouse', condition: 'damaged', storeys: [H.canopy], walk: 0, parapet: 0.3,
      facade: 'transit-headhouse', name: 'Subway entrance'});
    solidRing(kit, fr);
    // interior: the stair (mouth at the +u end, descending toward u = 0), the landing and the grille at the -u end
    const inner = pcr(p, 1, H.len - 1, 1, H.wid - 1);
    const area = kit.addArea({x: inner.x0, y: inner.y0, w: crW(inner), h: crH(inner)}, 'passage', 'exit-stair', KERB + 2.6, -1, {label: 'Subway entrance stairs', publicSpace: true});
    const stair = pcr(p, 1 + H.landing, H.len - 1, 1, H.wid - 1);
    const land = pcr(p, 1, 1 + H.landing, 1, H.wid - 1);
    const flights = layStairRun(g, {x: stair.x0, y: stair.y0, w: crW(stair), h: crH(stair)}, area.id, 'x', p.we === 'E' ? 'hi' : 'lo', KERB, H.bottom);
    for (let y = land.y0; y < land.y1; y++) for (let x = land.x0; x < land.x1; x++) { const i = g.idx(x, y); g.floor[i] = H.bottom; g.ceil[i] = H.bottom + 2.6; }
    // the mouth: the ring at the +u end opens over the stair's width
    const mouth = pcr(p, H.len - 1, H.len, 1, H.wid - 1);
    for (let y = mouth.y0; y < mouth.y1; y++) for (let x = mouth.x0; x < mouth.x1; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.area[i] = area.id; g.floor[i] = KERB; g.ceil[i] = KERB + 2.6;
    }
    doors.push({x: mouth.x0, y: mouth.y0, w: crW(mouth), h: crH(mouth), id: -1, a: compoundArea, b: area.id, height: 2.45, arch: false, noFrame: true});
    const g0 = pw(p, 1 * CELL, 1 * CELL), g1 = pw(p, (1 + H.landing) * CELL, (H.wid - 1) * CELL);
    const trigger: SBox = {x0: Math.min(g0.x, g1.x), x1: Math.max(g0.x, g1.x), z0: Math.min(g0.z, g1.z), z1: Math.max(g0.z, g1.z), y0: H.bottom, y1: H.bottom + 2.2};
    const at = pw(p, H.len * CELL + 2.2, H.wid * CELL / 2);
    const look = pw(p, 8, 12);
    portal = {kind: 'stair', pose: {x: at.x, z: at.z, yaw: yawTo(at.x, at.z, look.x, look.z), level: 0, y: KERB}, trigger, building: plan.id, label: 'Back down to the station'};
    head = {plan, area: area.id, flights};
    plan.name = 'Subway entrance';
    portalBuilding = plan.id;
  } else {
    // the host tower / mall facade on the plaza's inner v edge: its doors at the plaza's u-middle
    const hb = plans.buildings.find(b => b.host === host)!;
    portalBuilding = hb.id;
    const doorW = host === 'mall' ? 6 : 3.2;
    const uc = Math.min(p.U - 6, Math.max(doorW / 2 + 9, p.U * 0.5));
    const a = pw(p, uc - doorW / 2, 0), b = pw(p, uc + doorW / 2, 0.9);
    const trigger: SBox = {x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y0: KERB, y1: KERB + 2.6};
    const at = pw(p, uc, 2.4);
    const look = pw(p, uc - 4, 10);
    portal = {kind: 'door', pose: {x: at.x, z: at.z, yaw: yawTo(at.x, at.z, look.x, look.z), level: 0, y: KERB}, trigger, building: hb.id, label: 'Back inside'};
  }

  // --- the command tent (canvas walls = SOLID ring, a flap door on its +u end) --------------------------------------------------
  const T = PORTAL.tent;
  const tv0 = host === 'subway' ? 16 : 8;
  const tr = pcr(p, 2, 2 + T.len, tv0, tv0 + T.wid);
  const tplan = addBuildingPlan(ctx, block, tr, 'civic', 'tent', false, U, {host: 'tent', condition: 'intact', storeys: [T.ridge], walk: 1, parapet: 0, facade: 'tent-canvas', name: 'Command tent'});
  solidRing(kit, tr);
  const ti = pcr(p, 3, 2 + T.len - 1, tv0 + 1, tv0 + T.wid - 1);
  const tarea = kit.addArea({x: ti.x0, y: ti.y0, w: crW(ti), h: crH(ti)}, 'room', 'crew-room', KERB + T.clear, -1, {label: 'Command tent', publicSpace: false});
  for (let y = ti.y0; y < ti.y1; y++) for (let x = ti.x0; x < ti.x1; x++) g.floor[g.idx(x, y)] = KERB;
  tarea.floorY = KERB;
  const dv0 = tv0 + Math.floor((T.wid - T.door) / 2);
  const dr = pcr(p, 2 + T.len - 1, 2 + T.len, dv0, dv0 + T.door);
  const doorCells: number[] = [];
  for (let y = dr.y0; y < dr.y1; y++) for (let x = dr.x0; x < dr.x1; x++) {
    const i = g.idx(x, y);
    g.cells[i] = FLOOR; g.area[i] = tarea.id; g.floor[i] = KERB; g.ceil[i] = KERB + T.doorH;
    doorCells.push(i);
  }
  doors.push({x: dr.x0, y: dr.y0, w: crW(dr), h: crH(dr), id: -1, a: compoundArea, b: tarea.id, height: T.doorH, arch: false, noFrame: true});
  const dc = pw(p, (2 + T.len - 0.5) * CELL, (dv0 + T.door / 2) * CELL);
  void ground;
  return {portal, plaza: p, tent: {plan: tplan, rect: tr, area: tarea.id, door: {x: dc.x, z: dc.z, side: U}, doorCells}, head, portalBuilding, doors};
}

export interface CheckpointDress {
  checkpoint: SurfaceCheckpoint;
  truck: SPose;
  lights: LightPlacement[];
  safe: SRect;
}

/** Reserves the truck box, the gate and the portal approach (before any outdoor dressing). */
export function reserveCheckpoint(op: OutdoorProps, pc: PortalCarve, host: SurfaceHost): void {
  const p = pc.plaza, U = p.U, V = p.V;
  const box = (u0: number, u1: number, v0: number, v1: number) => {
    const a = pw(p, u0, v0), b = pw(p, u1, v1);
    op.reserveBox(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  };
  const gu = U - 6 - PORTAL.gate / 2;
  // the truck box and its way out through the gate, over the sidewalk to the kerb
  box(gu - 2.6, gu + 2.6, V - 12.5, V + 4);
  if (host === 'subway') box(PORTAL.head.len * CELL, PORTAL.head.len * CELL + 4.5, 0, PORTAL.head.wid * CELL + 0.5);
  else { const uc = Math.min(U - 6, Math.max(9 + 1.6, U * 0.5)); box(uc - 3.5, uc + 3.5, 0, 4.5); }
  // the tent door's approach
  const tv0 = host === 'subway' ? 16 : 8;
  box((2 + PORTAL.tent.len) * CELL, (2 + PORTAL.tent.len) * CELL + 2.2, tv0 * CELL + 1, (tv0 + PORTAL.tent.wid) * CELL - 1);
}

/** The compound's props, the truck pose, the work lights, the safe box. */
export function dressCheckpoint(op: OutdoorProps, kit: Kit, pc: PortalCarve, host: SurfaceHost, compoundArea: number): CheckpointDress {
  const p = pc.plaza, U = p.U, V = p.V;
  const su = sideU(p), sv = sideV(p);
  const at = (u: number, v: number) => pw(p, u, v);
  const rotAlongU = 0, rotAlongV = Math.PI / 2; // a piece's long axis along u (world X) / along v (world Z)
  // (inside the tent the outdoor reserve does not apply: a neighbour's doorway front reaching past the canvas is not the tent's floor)
  const put = (kind: string, u: number, v: number, rot: number, role = 'checkpoint', area?: number) => {
    const w = at(u, v);
    return op.place(kind, w.x, w.z, rot, {role, ...(area !== undefined ? {area, ignoreReserve: area === pc.tent.area} : {})});
  };
  // --- the barrier line along the v street edge (an 8 m vehicle gate) and the u street edge (a 2 m foot gap) --------------------
  const gu = U - 6 - PORTAL.gate / 2;
  const lineV = V - 0.9, lineU = U - 0.9;
  // 2 m slots on the 0.5 m cell lattice (u / v = 0 is a cell line): jersey barriers butt end to end, every fourth slot a sandbag wall
  const SLOT = 2.0;
  const pieceAt = (k: number) => (k % 4 === 3 ? 'srSandbagWall' : 'srJerseyBarrier');
  for (let k = 0, u = 1.0; u + SLOT <= U - 1.5; k++, u += SLOT) {
    if (u + SLOT > gu - PORTAL.gate / 2 && u < gu + PORTAL.gate / 2) continue;
    put(pieceAt(k), u + SLOT / 2, lineV, rotAlongU + (sv === 'N' ? Math.PI : 0), 'checkpoint-barrier');
  }
  const gapV = V * 0.55;
  for (let k = 0, v = 1.0; v + SLOT <= V - 1.5; k++, v += SLOT) {
    if (v + SLOT > gapV - 1.1 && v < gapV + 1.1) continue;
    put(pieceAt(k), lineU, v + SLOT / 2, rotAlongV + (su === 'W' ? Math.PI : 0), 'checkpoint-barrier');
  }
  // corner sandbag nest
  put('srSandbagWall', U - 2.6, V - 2.2, rotAlongU, 'checkpoint-barrier');
  put('srSandbagWall', U - 2.2, V - 3.9, rotAlongV, 'checkpoint-barrier');
  // traffic cones funnelling to the gate (outside the barrier line, on the plaza edge)
  for (const du of [-PORTAL.gate / 2 - 0.6, PORTAL.gate / 2 + 0.6]) put('srTrafficCone', gu + du, V - 2.2, 0, 'checkpoint-cone');

  // --- inside the tent: the planning-map table, the field radio, a crate -----------------------------------------------------------
  const T = PORTAL.tent, tv0 = host === 'subway' ? 16 : 8;
  const tu0 = 3 * CELL, tu1 = (2 + T.len - 1) * CELL, tvA = (tv0 + 1) * CELL, tvB = (tv0 + T.wid - 1) * CELL;
  const tableU = tu0 + 2.2, tableV = (tvA + tvB) / 2;
  // (long side along v; its FRONT — where lane KIT's table expects the reader — faces +u, toward the reader and the flap)
  const table = put('srMapTable', tableU, tableV, FACE_ROT[su], 'checkpoint-map', pc.tent.area);
  put('srFieldRadio', tu0 + 0.45, tvA + 0.4, FACE_ROT[su], 'checkpoint-radio', pc.tent.area);
  put('srMilitaryCrate', tu0 + 0.7, tvB - 0.45, rotAlongU + (sv === 'N' ? 0 : Math.PI), 'checkpoint-crate', pc.tent.area);
  const readW = at(tableU + 0.6 + 0.85, tableV);
  const tw = at(tableU, tableV);
  const read: SPose = {x: readW.x, z: readW.z, yaw: yawTo(readW.x, readW.z, tw.x, tw.z), level: 0, y: KERB};
  void tu1;

  // --- crates along the inner u edge (else the inner v edge), cots beside the tent, the generator and work lights -----------------
  // (each tries its spots in order: a neighbour's side door onto the compound keeps its front clear)
  const some = (kind: string, n: number, spots: readonly (readonly [number, number, number])[], role: string): number => {
    let k = 0;
    for (const [u, v, rot] of spots) { if (k >= n) break; if (put(kind, u, v, rot, role)) k++; }
    return k;
  };
  const crateV0 = (tv0 + T.wid) * CELL + 1.2;
  const crateRotV = rotAlongV + (su === 'E' ? 0 : Math.PI), crateRotU = rotAlongU + (sv === 'S' ? 0 : Math.PI);
  const crateSpots: [number, number, number][] = [];
  for (let v = crateV0; v < V - 4; v += 1.5) crateSpots.push([0.75, v, crateRotV]);
  for (let u = (2 + T.len) * CELL + 2.5; u < gu - PORTAL.gate / 2 - 3; u += 1.5) crateSpots.push([u, V - 2.1, crateRotU]);
  for (let v = crateV0; v < V - 4; v += 1.5) crateSpots.push([1.95, v, crateRotV]);
  some('srMilitaryCrate', 4, crateSpots, 'checkpoint-crate');
  const cotU = (2 + T.len) * CELL + 3.2;
  const cotSpots: [number, number, number][] = [];
  for (let n = 0; n < 6; n++) cotSpots.push([cotU + n * 1.3, tv0 * CELL + 2.4, rotAlongV]);
  for (let n = 0; n < 6; n++) cotSpots.push([cotU + n * 1.3, (tv0 + T.wid) * CELL - 2.4, rotAlongV]);
  some('srCot', 2, cotSpots, 'checkpoint-cot');
  put('portableGenerator', 1.0, tv0 * CELL - 1.2, FACE_ROT[su], 'checkpoint-generator');
  const lights: LightPlacement[] = [];
  // three work lights (by the tent, the far corner, the gate-side corner): each takes the first of its spots that is clear of the
  // approaches / a neighbour's doorway front
  const lamp = (spots: readonly (readonly [number, number])[]) => {
    for (const [u, v] of spots) {
      const pp = put('tripodWorkLight', u, v, FACE_ROT[sv === 'N' ? 'S' : 'N'], 'checkpoint-light');
      if (!pp) continue;
      lights.push({x: pp.x, y: pp.y + 1.75, z: pp.z, rot: 0, area: compoundArea, broken: false, flicker: false, warm: true, power: 1.1, dying: false, level: 0, virtual: true,
        tint: [1.0, 0.86, 0.66]});
      return;
    }
  };
  lamp([[cotU + 3.6, tv0 * CELL - 1.0], [cotU + 6.2, tv0 * CELL - 1.0], [cotU + 3.6, (tv0 + T.wid) * CELL + 1.0], [cotU + 6.2, (tv0 + T.wid) * CELL + 1.0]]);
  lamp([[U - 3.0, 3.0], [U - 3.0, 6.0], [U - 7.5, 3.0], [U - 3.0, V * 0.4], [U * 0.6, 3.0]]);
  lamp([[3.0, V - 3.0], [5.5, V - 3.0], [3.0, V - 5.5], [8.0, V - 3.0]]);
  // a hanging work lamp under the tent's ridge, over the map table
  const tl = at(tableU, tableV);
  lights.push({x: tl.x, y: KERB + PORTAL.tent.clear - 0.25, z: tl.z, rot: 0, area: pc.tent.area, broken: false, flicker: false, warm: true, power: 0.8, dying: false, level: 0, virtual: true,
    tint: [1.0, 0.84, 0.62]});
  // the truck: in its box behind the gate, facing out through it
  const tc = at(gu, V - 0.9 - 1.6 - PORTAL.truck.len / 2);
  const truck: SPose = {x: tc.x, z: tc.z, yaw: YAW[sv], level: 0, y: KERB};
  const rect = srect(p.r);
  const pad = 22;
  const safe: SRect = {x0: rect.x0 - pad, z0: rect.z0 - pad, x1: rect.x1 + pad, z1: rect.z1 + pad};
  const tentRect = srect(pc.tent.rect);
  void kit;
  return {
    checkpoint: {area: compoundArea, rect, tent: {rect: tentRect, area: pc.tent.area, door: pc.tent.door}, mapTable: {prop: table?.index ?? -1, read}},
    truck, lights, safe,
  };
}
