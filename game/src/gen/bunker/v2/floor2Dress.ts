// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 2 (HABITATION)'s own dressing, run once after the ONE station
// dresser (the carve: ./floor2.ts). World metres, this storey's grid; props in the storey's local height frame (the pipeline lifts
// them), decor / signs / lights absolute. A few strong compositions rather than clutter (storey budget ~110 props incl. the station
// dresser's, <= 150 decor boxes):
//
//  - THE COMMONS: THE LAMP RING (a 6 m square ring of eight lamps hung in the well at 6.4 m — the shelter's artificial sun, seen from
//    storey 1's gallery), the HEARTH under it (a raised bed round a planted tree, a bench on each side facing out), the STAGE against
//    the blind south wall (proscenium, a pale film screen, the motto plate), a row of chairs before it, trees flanking it;
//  - the MESS HALL: three long built-in refectory tables with fixed benches running north-south toward the commons (fixed galley
//    furniture: anchored, collision-only footprints under decor), the steel SERVERY along the kitchen wall with its pass-through hatch;
//  - the LANDING: the cargo lift's loading bay outlined in amber on the floor, the freight bay's pallet jack / hand truck / cartons,
//    the storey's wayfinding;
//  - the ARCADE: the residents' wall of notes (notice boards along the core's blind wall); the GREEN WALK: trees and plants along the
//    rock wall under a line of warm grow lamps, benches facing the commons through the arches, a planting trough;
//  - the SCHOOL (whiteboard, desk, rows of stacking chairs), the NURSERY (rocking horse, teddy, bean bags, a stroller, a play mat);
//  - the QUARTERS: a barracks dormitory (bunk rows, footlockers, lockers) and the family quarters (bunks in bays divided by locker units,
//    a family table), the latrines' shower booths, the laundry's wash troughs and drying racks;
//  - the GAMES HALL (ping-pong, table football, the jukebox, treadmills, a TV corner); the FREIGHT corridor's stock; the plant room's
//    hazard outline round the generator; door plates in the shelter's words, the streets' lamps; the aged dormitory's fallen panels.
// Every storage placed opens (footlockers, lockers: existing openables, loot by the room's purpose); loose things move (chairs,
// benches, plants, games tables are existing classified kinds); the built-in pieces (stage, hearth bed, refectory rows, servery,
// planting trough) are anchored fixtures: collision-only 'annexMachine' footprints under decor. No food holders are added here (the
// kitchen / pantry stock is the station dresser's by purpose). Every placement keeps the doorways, the held cells and the room
// connectivity (placeKit); the pocket sweep runs last.

import {CELL, FLOOR} from '../../grid';
import {NOTICE_BOARD_Y, PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Door, LightPlacement, Side} from '../../stationTypes';
import type {ShopMat} from '../../storefronts';
import {doorSide, propBlocksDoorway, strictWallOk, tryPlaceProp, wallRange, wallSpot, type PlaceOpts} from '../../placeKit';
import {NORMAL, coverCells, doorPlate, dropProps, face, pocketCells, rotFacing, sealOrDrop, solidProp, sweepPockets, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {isBunkerKind} from '../../reactor/complex/bunkerKinds';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** QA / tests: what the last dress placed (counts are this pass's own), and what it gave up on. */
export const F2_DRESS_STATS = {props: 0, decor: 0, lights: 0, signs: 0, removedLights: 0, built: [] as string[], skipped: [] as string[]};

interface F2 {
  ctx: FloorDressCtx;
  D: Dx;
  base: number;
  lv: number;
  A: (key: string) => Area | undefined;
}

type Box = {x0: number; z0: number; x1: number; z1: number};

/** Area rect in world metres. */
const W = (a: Area) => ({x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL});

/** A decor box (heights relative to the storey floor), kept out of every doorway's clear volume. */
function decor(F: F2, m: ShopMat, b: Box, y0: number, y1: number): boolean {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  if (y0 < 2.15 && propBlocksDoorway(F.ctx.layout, cx, cz, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, F.base + Math.max(y0, 0.021), y1 - Math.max(y0, 0.021))) return false;
  F.D.decor(m, {x0: r3(b.x0), z0: r3(b.z0), x1: r3(b.x1), z1: r3(b.z1)}, y0, y1);
  F2_DRESS_STATS.decor++;
  return true;
}

/** A fixture of this storey (absolute y = floor + yRel). */
function light(F: F2, a: Area, x: number, z: number, yRel: number, rot: number, warm = true): void {
  const l: LightPlacement = {x: r3(x), y: r3(F.base + yRel), z: r3(z), rot, area: a.id, broken: false, flicker: false, warm, power: 1, dying: false, level: F.lv};
  F.ctx.layout.lights.push(l);
  F2_DRESS_STATS.lights++;
}

/** Removes the station dresser's fixtures of an area (the composition re-lights it). */
function clearLights(F: F2, a: Area): void {
  const L = F.ctx.layout.lights;
  for (let i = L.length - 1; i >= 0; i--) if (L[i].area === a.id) { L.splice(i, 1); F2_DRESS_STATS.removedLights++; }
}

/** A loose / openable prop at a spot (bunker hero kinds sealed over their visible body); null when it does not fit. */
function put(F: F2, a: Area, kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts = {}): PropPlacement | null {
  const p = tryPlaceProp(F.D.ctx, a, kind, r3(x), r3(z), rot, o);
  if (!p) return null;
  if (isBunkerKind(kind) && !sealOrDrop(F.D, a, p)) return null;
  return p;
}

/** The first spot of a list that takes the prop. */
function putAny(F: F2, a: Area, kind: PropKind, spots: readonly (readonly [number, number, number])[], o: PlaceOpts = {}): PropPlacement | null {
  for (const [x, z, rot] of spots) { const p = put(F, a, kind, x, z, rot, o); if (p) return p; }
  return null;
}

/** A free-standing prop as near (cx, cz) as fits: a 0.25 m lattice within `r` m, nearest first (deterministic). */
function near(F: F2, a: Area, kind: PropKind, cx: number, cz: number, rot: number, o: PlaceOpts, r: number): PropPlacement | null {
  const spots: [number, number][] = [];
  for (let dx = -r; dx <= r + 1e-6; dx += 0.25) for (let dz = -r; dz <= r + 1e-6; dz += 0.25) spots.push([r3(cx + dx), r3(cz + dz)]);
  spots.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz) || p[0] - q[0] || p[1] - q[1]);
  for (const [x, z] of spots) { const p = put(F, a, kind, x, z, rot, o); if (p) return p; }
  return null;
}

/**
 * A wall-backed prop: every 0.25 m along each wall of `sides` (in order), nearest `prefer` (world, along the wall) first — a REAL wall
 * behind its whole width (placeKit.strictWallOk: no opening / aperture behind), the placement primitive's door zones / access strip /
 * connectivity, bunker hero kinds sealed, and (`pockets`) no pocket left in the room. Notice boards hang at their mounting height.
 * Null when nothing fits.
 */
function wallPut(F: F2, a: Area, kind: PropKind, sides: readonly Side[], front: number, prefer?: number, pockets = false): PropPlacement | null {
  const w = PROP_DEFS[kind].w, y = kind === 'noticeBoard' ? NOTICE_BOARD_Y : 0;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.1; t <= hi - w / 2 - 0.1 + 1e-6; t += 0.25) ts.push(Math.round(t * 4) / 4);
    const c = prefer ?? (lo + hi) / 2;
    ts.sort((p, q) => Math.abs(p - c) - Math.abs(q - c) || p - q);
    for (const t of ts) {
      if (!strictWallOk(F.D.ctx, a, sd, t, kind, y)) continue;
      const sp = wallSpot(a, sd, t, kind);
      const n0 = F.ctx.layout.props.length;
      const p = tryPlaceProp(F.D.ctx, a, kind, sp.x, sp.z, sp.rot, y ? {y} : {front});
      if (!p || (isBunkerKind(kind) && !sealOrDrop(F.D, a, p))) continue;
      if (pockets && pocketCells(F.D, a).length) { dropProps(F.D, n0); continue; }
      return p;
    }
  }
  return null;
}

/**
 * A built-in (anchored) piece: a collision-only footprint over whole cells of `a` (free floor, no door cell, no held / kept cell)
 * that leaves no pocket; its decor is drawn by `draw` only once it stands. Null when the cells are not free.
 */
function builtIn(F: F2, a: Area, b: Box, h: number, name: string, draw: () => void, inner?: PropPlacement): PropPlacement | null {
  const {g, ctx} = F.D;
  const [c0, r0, c1, r1] = coverCells((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2);
  // `inner`: a prop standing inside the piece (the hearth's tree): its own (blocked) cells are part of the footprint
  const own = new Set<number>();
  if (inner) { const [i0, j0, i1, j1] = coverCells(inner.x, inner.z, inner.hx, inner.hz); for (let cy = j0; cy <= j1; cy++) for (let cx = i0; cx <= i1; cx++) own.add(g.idx(cx, cy)); }
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    if (i >= 0 && own.has(i)) continue;
    if (i < 0 || g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || ctx.doorCell[i] || ctx.keep[i] || ctx.edge[i]) { F2_DRESS_STATS.skipped.push(`${name}: cells`); return null; }
  }
  const p = solidProp(F.D, 'annexMachine', a, b, h, 0, 0, false);
  if (pocketCells(F.D, a).length) {
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const i = g.idx(cx, cy); if (own.has(i)) continue; g.blocked[i] = 0; g.sightBlocked[i] = 0; }
    F.ctx.layout.props.splice(F.ctx.layout.props.indexOf(p), 1);
    F2_DRESS_STATS.skipped.push(`${name}: pocket`);
    return null;
  }
  draw();
  F2_DRESS_STATS.built.push(name);
  return p;
}

/** The door between two of the storey's areas. */
function doorOf(F: F2, a: Area, b: Area): Door | undefined {
  return F.D.doors(a).find(d => (d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The commons

function commons(F: F2, a: Area): void {
  const R = W(a);
  // the hearth sits on the nave's axis a little north of centre (the stage needs its audience floor), the lamp ring hangs over it
  const hx = r3((R.x0 + R.x1) / 2), hz = r3(R.z0 + 5.0);
  clearLights(F, a);
  // THE LAMP RING: a 6 m square steel ring, eight lamps under it (warm), 6.4 m up the well
  const rr = 3.0, ry = 6.4;
  for (const [x0, z0, x1, z1] of [[hx - rr, hz - rr - 0.07, hx + rr, hz - rr + 0.07], [hx - rr, hz + rr - 0.07, hx + rr, hz + rr + 0.07], [hx - rr - 0.07, hz - rr, hx - rr + 0.07, hz + rr], [hx + rr - 0.07, hz - rr, hx + rr + 0.07, hz + rr]]) {
    decor(F, 'steelDark', {x0, z0, x1, z1}, ry, ry + 0.22);
  }
  // a brighter inner lip (the lamps' reflector band)
  for (const [x0, z0, x1, z1] of [[hx - rr + 0.07, hz - rr + 0.07, hx + rr - 0.07, hz - rr + 0.12], [hx - rr + 0.07, hz + rr - 0.12, hx + rr - 0.07, hz + rr - 0.07]]) decor(F, 'steelBright', {x0, z0, x1, z1}, ry + 0.02, ry + 0.2);
  for (const s of [-1, 1]) {
    light(F, a, hx - 1.5, hz + s * rr, ry - 0.02, 0);
    light(F, a, hx + 1.5, hz + s * rr, ry - 0.02, 0);
    light(F, a, hx + s * rr, hz - 1.5, ry - 0.02, Math.PI / 2);
    light(F, a, hx + s * rr, hz + 1.5, ry - 0.02, Math.PI / 2);
  }
  // THE HEARTH: a planted tree in the middle of a 3 m raised bed (a sit-on curb), a bench on each side facing out
  const tree = put(F, a, 'planterTree', hx, hz, 0, {laneOk: true, plazaOk: true});
  if (tree) {
    const bed = {x0: hx - 1.5, z0: hz - 1.5, x1: hx + 1.5, z1: hz + 1.5};
    builtIn(F, a, bed, 0.45, 'hearth bed', () => {
      const t = 0.14;
      decor(F, 'quarryTile', {x0: bed.x0, z0: bed.z0, x1: bed.x1, z1: bed.z0 + t}, 0, 0.45);
      decor(F, 'quarryTile', {x0: bed.x0, z0: bed.z1 - t, x1: bed.x1, z1: bed.z1}, 0, 0.45);
      decor(F, 'quarryTile', {x0: bed.x0, z0: bed.z0 + t, x1: bed.x0 + t, z1: bed.z1 - t}, 0, 0.45);
      decor(F, 'quarryTile', {x0: bed.x1 - t, z0: bed.z0 + t, x1: bed.x1, z1: bed.z1 - t}, 0, 0.45);
      // the soil (round the tree's own planter)
      decor(F, 'black', {x0: bed.x0 + t, z0: bed.z0 + t, x1: bed.x1 - t, z1: hz - 0.55}, 0.3, 0.38);
      decor(F, 'black', {x0: bed.x0 + t, z0: hz + 0.55, x1: bed.x1 - t, z1: bed.z1 - t}, 0.3, 0.38);
      decor(F, 'black', {x0: bed.x0 + t, z0: hz - 0.55, x1: hx - 0.55, z1: hz + 0.55}, 0.3, 0.38);
      decor(F, 'black', {x0: hx + 0.55, z0: hz - 0.55, x1: bed.x1 - t, z1: hz + 0.55}, 0.3, 0.38);
    }, tree);
    const bo = 1.5 + 0.06 + PROP_DEFS.bench.d / 2;
    put(F, a, 'bench', hx, hz - bo, Math.PI, {laneOk: true, plazaOk: true});
    put(F, a, 'bench', hx, hz + bo, 0, {laneOk: true, plazaOk: true});
    put(F, a, 'bench', hx - bo, hz, -Math.PI / 2, {laneOk: true, plazaOk: true});
    put(F, a, 'bench', hx + bo, hz, Math.PI / 2, {laneOk: true, plazaOk: true});
  } else F2_DRESS_STATS.skipped.push('hearth tree');
  // THE STAGE against the blind south wall: an 8 m dais, 2 m deep, its proscenium, the film screen, the motto
  const sx0 = hx - 4, sx1 = hx + 4, sz1 = R.z1, sz0 = sz1 - 2.0, sh = 0.5;
  builtIn(F, a, {x0: sx0, z0: sz0, x1: sx1, z1: sz1}, sh, 'stage', () => {
    decor(F, 'panel', {x0: sx0, z0: sz0, x1: sx1, z1: sz1}, 0, sh - 0.06);
    decor(F, 'woodVeneer', {x0: sx0, z0: sz0, x1: sx1, z1: sz1}, sh - 0.06, sh);
    decor(F, 'plasticSeat', {x0: sx0, z0: sz0 - 0.01, x1: sx1, z1: sz0 + 0.05}, sh - 0.05, sh + 0.005);
    // the proscenium: two posts on the dais front corners and a header with the lit name band
    decor(F, 'steelDark', {x0: sx0, z0: sz0, x1: sx0 + 0.3, z1: sz0 + 0.3}, sh, 4.9);
    decor(F, 'steelDark', {x0: sx1 - 0.3, z0: sz0, x1: sx1, z1: sz0 + 0.3}, sh, 4.9);
    decor(F, 'steelDark', {x0: sx0, z0: sz0, x1: sx1, z1: sz0 + 0.3}, 4.55, 4.9);
    decor(F, 'signBand', {x0: sx0 + 0.6, z0: sz0 - 0.02, x1: sx1 - 0.6, z1: sz0}, 4.6, 4.85);
    // the pale film screen on the back wall
    decor(F, 'accent', {x0: hx - 2.6, z0: sz1 - 0.04, x1: hx + 2.6, z1: sz1}, 1.35, 4.0);
    decor(F, 'black', {x0: hx - 2.7, z0: sz1 - 0.03, x1: hx + 2.7, z1: sz1 - 0.005}, 1.25, 4.1);
  });
  if (wallSign(F.D, a, 'S', hx, 4.3, {kind: 'info', text: 'WE KEEP THE LIGHT', w: 3.4})) F2_DRESS_STATS.signs++;
  // the audience: a row of folding chairs before the dais, the middle left free (the hearth's south bench faces the stage)
  const cz = sz0 - 1.35;
  for (const dx of [-2.8, 2.8]) put(F, a, 'foldingChair', hx + dx, cz, 0, {laneOk: true, plazaOk: true});
  // trees flanking the dais
  const tz = sz1 - PROP_DEFS.planterTree.d / 2 - 0.05;
  putAny(F, a, 'planterTree', [[sx0 - 1.0, tz, 0], [sx0 - 1.25, tz, 0], [sx0 - 0.75, tz, 0]]);
  putAny(F, a, 'planterTree', [[sx1 + 1.0, tz, 0], [sx1 + 1.25, tz, 0], [sx1 + 0.75, tz, 0]]);
  // the shelter notices beside the mess opening
  wallPut(F, a, 'noticeBoard', ['N'], 0, R.x0 + 1.2);
  // THE BANNERS: tall cloth hangings up the nave's walls (amber on the end walls flanking the opening and the dais, charcoal on the
  // aisle piers), each from a steel rod — the hall's height made legible from the floor and from the gallery above
  const banner = (side: Side, t: number, w: number, y0: number, y1: number, m: ShopMat): void => {
    const fc = face(a, side), [nx, nz] = NORMAL[side];
    const along = side === 'N' || side === 'S';
    const b = (d0: number, d1: number, u0: number, u1: number): Box => along
      ? {x0: u0, x1: u1, z0: Math.min(fc - nz * d0, fc - nz * d1), z1: Math.max(fc - nz * d0, fc - nz * d1)}
      : {x0: Math.min(fc - nx * d0, fc - nx * d1), x1: Math.max(fc - nx * d0, fc - nx * d1), z0: u0, z1: u1};
    decor(F, m, b(0.01, 0.04, t - w / 2, t + w / 2), y0, y1);
    decor(F, 'steelDark', b(0.0, 0.08, t - w / 2 - 0.12, t + w / 2 + 0.12), y1, y1 + 0.06);
  };
  for (const s of ['N', 'S'] as const) for (const t of [hx - 5.4, hx + 5.4]) banner(s, t, 1.2, s === 'N' ? 4.8 : 5.4, 10.6, 'plasticSeat');
  for (const s of ['W', 'E'] as const) for (const t of [R.z0 + 4.0, R.z0 + 8.0]) banner(s, t, 0.8, 3.8, 9.8, 'steelDark');
  if (wallSign(F.D, a, 'N', hx, 6.2, {kind: 'service', text: 'THE COMMONS', w: 4.2})) F2_DRESS_STATS.signs++;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The mess hall

function messHall(F: F2, a: Area, kitchen: Area | undefined): void {
  const R = W(a);
  clearLights(F, a);
  // THE SERVERY: a 6.5 m steel serving line along the kitchen wall east of the kitchen door, a pass-through hatch over it
  const kd = kitchen ? doorOf(F, a, kitchen) : undefined;
  const k1 = kd ? (kd.x + kd.w) * CELL + 1.0 : R.x0 + 4;
  const s0 = Math.ceil(k1 / CELL) * CELL, s1 = Math.min(R.x1 - 4.5, s0 + 6.5);
  if (s1 - s0 >= 3) {
    builtIn(F, a, {x0: s0, z0: R.z0, x1: s1, z1: R.z0 + 0.8}, 0.95, 'servery', () => {
      decor(F, 'kitchenSteel', {x0: s0 + 0.02, z0: R.z0, x1: s1 - 0.02, z1: R.z0 + 0.78}, 0, 0.88);
      decor(F, 'laminate', {x0: s0, z0: R.z0, x1: s1, z1: R.z0 + 0.8}, 0.88, 0.95);
      decor(F, 'glassShopfront', {x0: s0 + 0.1, z0: R.z0 + 0.62, x1: s1 - 0.1, z1: R.z0 + 0.65}, 1.05, 1.45);
      decor(F, 'steelBright', {x0: s0 + 0.1, z0: R.z0 + 0.6, x1: s1 - 0.1, z1: R.z0 + 0.67}, 1.45, 1.5);
      // the hatch in the kitchen wall: a dark opening, its roller shutter half down, a steel frame
      decor(F, 'black', {x0: s0 + 0.4, z0: R.z0, x1: s1 - 0.4, z1: R.z0 + 0.02}, 1.1, 2.0);
      decor(F, 'shutterSteel', {x0: s0 + 0.4, z0: R.z0 + 0.01, x1: s1 - 0.4, z1: R.z0 + 0.04}, 1.6, 2.0);
      decor(F, 'steelDark', {x0: s0 + 0.3, z0: R.z0, x1: s1 - 0.3, z1: R.z0 + 0.06}, 2.0, 2.1);
    });
    if (wallSign(F.D, a, 'N', (s0 + s1) / 2, 2.55, {kind: 'info', text: 'SERVERY · 0700 · 1200 · 1800', w: 3.0})) F2_DRESS_STATS.signs++;
  } else F2_DRESS_STATS.skipped.push('servery: no wall');
  // THE REFECTORY: three long rows running north-south toward the commons opening — each three mess tables pushed end to end (the
  // shelter's food surfaces: staff-room purpose, as the first Bunker's mess tables) between two fixed galley benches (anchored
  // built-ins: collision-only strips under the seats)
  // (a 1.6 m table covers four 0.5 m cells: on a 2.0 m pitch the row's tables tile the grid with no free cell between them)
  const tbl = PROP_DEFS.table, nT = 3, pitch = 2.0, zA = R.z0 + 2.5, zB = zA + nT * pitch;
  const xs = [R.x0 + 3.75, R.x0 + 8.25, R.x0 + 12.75];
  let tables = 0;
  for (const c of xs) {
    const row: PropPlacement[] = [];
    for (let k = 0; k < nT; k++) {
      const p = put(F, a, 'table', c, zA + pitch / 2 + k * pitch, 0, {laneOk: true});
      if (p) { p.purpose = 'staff-room'; row.push(p); }
    }
    tables += row.length;
    if (!row.length) continue;
    // the benches: one cell each side of the tables' cells, the rows' length
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? Math.floor((c - tbl.w / 2) / CELL) * CELL - CELL : Math.ceil((c + tbl.w / 2) / CELL) * CELL;
      const z0 = Math.floor(zA / CELL) * CELL, z1 = Math.ceil(zB / CELL) * CELL;
      builtIn(F, a, {x0, z0, x1: x0 + CELL, z1}, 0.46, `refectory bench ${c} ${s}`, () => {
        const sx0 = s < 0 ? x0 + 0.05 : x0 + 0.03, sx1 = s < 0 ? x0 + CELL - 0.03 : x0 + CELL - 0.05;
        decor(F, 'woodVeneer', {x0: sx0, z0: z0 + 0.1, x1: sx1, z1: z1 - 0.1}, 0.42, 0.46);
        for (const z of [z0 + 0.5, (z0 + z1) / 2, z1 - 0.5]) decor(F, 'steelDark', {x0: sx0 + 0.08, z0: z - 0.04, x1: sx1 - 0.08, z1: z + 0.04}, 0, 0.42);
      });
    }
    light(F, a, c, zA + 1.2, 4.5, Math.PI / 2);
    light(F, a, c, zB - 1.2, 4.5, Math.PI / 2);
  }
  if (tables < nT * xs.length) F2_DRESS_STATS.skipped.push(`refectory: ${tables} tables`);
  // a loose folding chair pulled up at a row's end, a bin by the servery
  put(F, a, 'foldingChair', xs[0], zB + 0.6, Math.PI, {laneOk: true});
  wallPut(F, a, 'bin', ['N'], 0, s1 + 0.6);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The landing (main stair + cargo lift), the freight corridor

function landing(F: F2, a: Area, freight: Area | undefined): void {
  const R = W(a), sp = F.ctx.spine;
  // the cargo lift's loading bay: an amber outline on the floor round its apron (floor finish: under the door clear volumes)
  const lift = F.ctx.frame.anchors.find(q => q.id === 'lift');
  if (lift) {
    const x0 = lift.apron.x * CELL, x1 = (lift.apron.x + lift.apron.w) * CELL, z0 = lift.apron.y * CELL, z1 = (lift.apron.y + lift.apron.h) * CELL;
    decor(F, 'plasticSeat', {x0, z0, x1, z1: z0 + 0.12}, 0, 0.012);
    decor(F, 'plasticSeat', {x0, z0: z0 + 0.12, x1: x0 + 0.12, z1}, 0, 0.012);
    decor(F, 'plasticSeat', {x0: x1 - 0.12, z0: z0 + 0.12, x1, z1}, 0, 0.012);
    if (wallSign(F.D, a, 'N', (x0 + x1) / 2, 2.6, {kind: 'service', text: 'CARGO LIFT · KEEP THE BAY CLEAR', w: 2.6})) F2_DRESS_STATS.signs++;
  }
  void sp;
  // the freight bay at the east end: pallet jack, hand truck, carton stacks, crates
  const east: Side[] = ['E', 'N'];
  wallPut(F, a, 'palletJack', east, 0, R.z0 + 2);
  wallPut(F, a, 'cartonStack', ['E'], 0, R.z0 + 4.5);
  wallPut(F, a, 'crate', ['N'], 0, R.x1 - 1.0);
  // arrivals: a bench and the roll-call board on the north wall facing the stair, the duty warden's desk and its records
  wallPut(F, a, 'bench', ['N'], 0.6, R.x0 + 4.5);
  wallPut(F, a, 'noticeBoard', ['N'], 0, R.x0 + 2.0);
  wallPut(F, a, 'desk', ['N', 'W'], 0.8, R.x0 + 11.5, true);
  wallPut(F, a, 'filingCabinet', ['N', 'W'], 0.7, R.x0 + 13.2, true);
  // more of the freight bay's stock (crates of supplies waiting for the lift)
  for (let i = 0; i < 2; i++) wallPut(F, a, 'crate', ['E', 'N'], 0, R.z0 + 1.0 + i * 0.7, true);
  if (wallSign(F.D, a, 'N', R.x0 + 7.5, 2.75, {kind: 'service', text: 'LEVEL 2 · HABITATION', w: 2.4})) F2_DRESS_STATS.signs++;
  if (freight) {
    const d = doorOf(F, a, freight);
    if (d && doorPlate(F.D, d, a, 'FREIGHT · GAMES HALL · SERVICE STAIR', 2.6)) F2_DRESS_STATS.signs++;
  }
}

function freightCorridor(F: F2, a: Area): void {
  const R = W(a);
  clearLights(F, a);
  for (let z = R.z0 + 2.5; z < R.z1 - 1.0; z += 5.5) light(F, a, (R.x0 + R.x1) / 2, z, a.ceil - F.base - 0.02, Math.PI / 2, false);
  wallPut(F, a, 'cartonStack', ['W'], 0, R.z0 + 9);
  wallPut(F, a, 'crate', ['E'], 0, R.z0 + 6);
  wallPut(F, a, 'crate', ['W'], 0, R.z1 - 6);
  // the corridor's supply shelving and a tool cupboard
  wallPut(F, a, 'shelf', ['E', 'W'], 0.8, R.z0 + 13, true);
  wallPut(F, a, 'cabinetTall', ['W', 'E'], 0.8, R.z1 - 10, true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The aisles: the arcade's wall of notes, the green walk

function arcade(F: F2, a: Area): void {
  const R = W(a);
  clearLights(F, a);
  for (let z = R.z0 + 3.0; z < R.z1 - 0.5; z += 6.0) light(F, a, (R.x0 + R.x1) / 2, z, a.ceil - F.base - 0.02, Math.PI / 2);
  // the wall of notes: boards along the core's blind wall
  let n = 0;
  for (const t of [R.z0 + 3.0, R.z0 + 9.0, R.z0 + 15.0]) if (n < 3 && wallPut(F, a, 'noticeBoard', ['E'], 0, t)) n++;
  if (wallSign(F.D, a, 'E', R.z0 + 9.3, 2.45, {kind: 'service', text: 'MESSAGES · MISSING · FOUND', w: 2.2})) F2_DRESS_STATS.signs++;
}

function greenWalk(F: F2, a: Area, commonsA: Area | undefined): void {
  const R = W(a);
  clearLights(F, a);
  // the grow lamps: a warm line over the planting along the rock wall
  for (let z = R.z0 + 2.2; z < R.z1 - 0.5; z += 5.6) light(F, a, R.x0 + 0.9, z, a.ceil - F.base - 0.02, Math.PI / 2);
  // benches against the rock wall facing each arch into the commons, trees between them (opposite the piers)
  const arches = commonsA ? F.D.doors(a).filter(d => d.a === commonsA.id || d.b === commonsA.id).sort((p, q) => p.y - q.y) : [];
  const bx = R.x0 + 0.03 + PROP_DEFS.bench.d / 2;
  for (const d of arches) put(F, a, 'bench', bx, (d.y + d.h / 2) * CELL, Math.PI / 2, {laneOk: true});
  const tx = R.x0 + 0.03 + PROP_DEFS.planterTree.d / 2;
  for (let i = 0; i + 1 < arches.length; i++) {
    const z = ((arches[i].y + arches[i].h) * CELL + arches[i + 1].y * CELL) / 2;
    putAny(F, a, 'planterTree', [[tx, z, Math.PI / 2], [tx, z - 0.25, Math.PI / 2], [tx, z + 0.25, Math.PI / 2]]);
  }
  // north of the arches (by the mess): a tree and a dying one; south (by the school): the planting trough and pots
  putAny(F, a, 'planterTree', [[tx, R.z0 + 1.2, Math.PI / 2], [tx, R.z0 + 1.6, Math.PI / 2]]);
  putAny(F, a, 'deadPlant', [[R.x0 + 0.5, R.z0 + 2.6, Math.PI / 2], [R.x0 + 0.5, R.z0 + 2.9, Math.PI / 2]]);
  const t0 = R.z1 - 6.2, t1 = R.z1 - 1.6, tw = 0.75;
  builtIn(F, a, {x0: R.x0, z0: t0, x1: R.x0 + tw + 0.25, z1: t1}, 0.6, 'planting trough', () => {
    decor(F, 'woodVeneer', {x0: R.x0 + 0.02, z0: t0, x1: R.x0 + tw + 0.23, z1: t1}, 0, 0.6);
    decor(F, 'black', {x0: R.x0 + 0.08, z0: t0 + 0.08, x1: R.x0 + tw + 0.17, z1: t1 - 0.08}, 0.6, 0.62);
  });
  putAny(F, a, 'pottedPlantSmall', [[R.x0 + 0.3, t0 - 0.45, 0], [R.x0 + 0.3, t0 - 0.7, 0]]);
  if (wallSign(F.D, a, 'W', R.z0 + 4.4, 2.5, {kind: 'service', text: 'GROW LAMPS ON 0600 – 2000', w: 2.0})) F2_DRESS_STATS.signs++;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The children

function schoolroom(F: F2, a: Area): void {
  const R = W(a);
  // the front is the commons wall (north): the whiteboard, the teacher's desk in the corner, two rows of pupils' desks facing it
  // (each a desk for two with its stacking chairs behind)
  wallPut(F, a, 'mobileWhiteboard', ['N'], 0.8, (R.x0 + R.x1) / 2);
  wallPut(F, a, 'desk', ['N', 'W'], 0.7, R.x0 + 1.0);
  const mx = (R.x0 + R.x1) / 2 - 0.25, dk = PROP_DEFS.desk;
  for (const dz of [2.15, 3.85]) for (const dx of [-1.6, 1.6]) {
    const x = mx + dx, z = R.z0 + dz;
    if (!put(F, a, 'desk', x, z, 0, {laneOk: true})) continue;
    for (const s of [-0.38, 0.38]) put(F, a, 'plasticStackChair', x + s, z + dk.d / 2 + 0.33, Math.PI, {laneOk: true});
  }
  wallPut(F, a, 'noticeBoard', ['W', 'E'], 0, (R.z0 + R.z1) / 2);
  // the teacher's supply cupboard, the book shelf, the class records
  wallPut(F, a, 'cabinetLow', ['W', 'S', 'E'], 0.7, R.z0 + 1.2, true);
  wallPut(F, a, 'shelf', ['W', 'E', 'S'], 0.8, R.z1 - 1.5, true);
  wallPut(F, a, 'filingCabinet', ['E', 'W', 'S'], 0.7, R.z0 + 1.0, true);
}

function nursery(F: F2, a: Area): void {
  const R = W(a), mx = (R.x0 + R.x1) / 2, mz = (R.z0 + R.z1) / 2;
  // a soft play mat in the middle (floor finish)
  decor(F, 'plasticSeat', {x0: mx - 1.3, z0: mz - 1.1, x1: mx + 1.3, z1: mz + 1.1}, 0, 0.015);
  put(F, a, 'rockingHorse', mx - 0.6, mz, Math.PI / 2, {laneOk: true}) ?? put(F, a, 'rockingHorse', mx, mz + 0.4, 0, {laneOk: true});
  wallPut(F, a, 'giantTeddy', ['N', 'S'], 0, R.x1 - 1.0);
  wallPut(F, a, 'beanBag', ['N', 'S'], 0, R.x0 + 1.2);
  wallPut(F, a, 'babyStroller', ['S', 'N', 'W'], 0, R.x1 - 2.4);
  wallPut(F, a, 'lobbySofa', ['S', 'N'], 0.6, mx);
  // the nursery's changing / supplies cupboard, the linen press, the toy shelf and the toy box
  wallPut(F, a, 'cabinetLow', ['N', 'S', 'E'], 0.7, R.x0 + 1.5, true);
  wallPut(F, a, 'cabinetTall', ['E', 'N', 'S'], 0.8, R.z1 - 1.2, true);
  wallPut(F, a, 'shelf', ['N', 'S', 'W'], 0.8, R.x1 - 1.5, true);
  wallPut(F, a, 'crate', ['S', 'N', 'W', 'E'], 0, R.x0 + 2.5, true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The quarters

/**
 * A row of bunks head to wall `sd` (the Reactor shelter's dormitory row, capped): bunks on the cell grid, centres on cell boundaries
 * >= `pitch` apart, each sealed over its visible body; a footlocker at the foot of the first `lockers` of them. Returns the bunks.
 */
function bunkRow(F: F2, a: Area, sd: Side, max: number, lockers: number, pitch = 1.6, from?: number, to?: number): PropPlacement[] {
  const bed = PROP_DEFS.bunkBed, fl = PROP_DEFS.footlocker;
  const [lo0, hi0] = wallRange(a, sd), [nx, nz] = NORMAL[sd], fc = face(a, sd);
  const lo = Math.max(lo0, from ?? lo0), hi = Math.min(hi0, to ?? hi0);
  const along = sd === 'N' || sd === 'S';
  const bedRot = along ? Math.PI / 2 : 0, flRot = rotFacing(-nx, -nz);
  const off = bed.w / 2, foff = bed.w + 0.05 + fl.d / 2;
  const out: PropPlacement[] = [];
  let last = -Infinity, fls = 0;
  for (let t = Math.ceil((lo + 0.3 + bed.d / 2) / CELL) * CELL; t + bed.d / 2 <= hi - 0.3 + 1e-6 && out.length < max; t += CELL) {
    if (Math.abs(t - last) < pitch - 1e-6) continue;
    const p = put(F, a, 'bunkBed', along ? t : fc - nx * off, along ? fc - nz * off : t, bedRot);
    if (!p) continue;
    last = t;
    out.push(p);
    if (fls < lockers && put(F, a, 'footlocker', along ? t : fc - nx * foff, along ? fc - nz * foff : t, flRot)) fls++;
  }
  return out;
}

/** The barracks dormitory: bunk rows on both long walls with a footlocker at every foot, banks of lockers on the short walls. */
function dormitory(F: F2, a: Area): void {
  const door = F.D.doors(a)[0], ds = door ? doorSide(door, a) : 'N';
  const far: Side = ds === 'N' ? 'S' : ds === 'S' ? 'N' : ds === 'W' ? 'E' : 'W';
  const shorts: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  bunkRow(F, a, far, 5, 5, 1.7);
  bunkRow(F, a, ds, 4, 4, 1.7);
  for (let i = 0; i < 4; i++) if (!wallPut(F, a, 'staffLockers', [shorts[i % 2], shorts[(i + 1) % 2]], 1.0, undefined, true)) break;
  // two wardrobes, and the sleepers' table down the aisle (cards, letters) with its chairs
  for (let i = 0; i < 2; i++) wallPut(F, a, 'cabinetTall', [shorts[(i + 1) % 2], shorts[i % 2]], 0.8, undefined, true);
  const R = W(a), mx = (R.x0 + R.x1) / 2, mz = (R.z0 + R.z1) / 2;
  const t = near(F, a, 'table', mx, mz, Math.PI / 2, {ring: 0.5, laneOk: true}, 1.5);
  if (t) for (const s of [-1, 1]) put(F, a, 'foldingChair', t.x + s * 1.2, t.z, s < 0 ? Math.PI / 2 : -Math.PI / 2, {laneOk: true});
}

/**
 * The family quarters: bays along the far wall — each a bunk with its footlocker, the family's locker unit against the wall between
 * two bays —, the near wall's bunks, a family table with folding chairs in the middle, a wardrobe and a coat rack.
 */
function familyQuarters(F: F2, a: Area): void {
  const R = W(a);
  const door = F.D.doors(a)[0], ds = door ? doorSide(door, a) : 'N';
  const far: Side = ds === 'N' ? 'S' : 'N';
  const bunks = bunkRow(F, a, far, 4, 4, 2.3);
  // a locker unit against the wall between each two bays (each family's wardrobe)
  for (let i = 0; i + 1 < bunks.length; i++) {
    const t = (bunks[i].x + bunks[i + 1].x) / 2, sp = wallSpot(a, far, t, 'staffLockers');
    if (strictWallOk(F.D.ctx, a, far, t, 'staffLockers')) put(F, a, 'staffLockers', sp.x, sp.z, sp.rot);
  }
  const [, nz] = NORMAL[far];
  // the family table with folding chairs, and the near wall's bunks
  const mx = (R.x0 + R.x1) / 2, mz = (R.z0 + R.z1) / 2 + nz * 0.2;
  if (put(F, a, 'table', mx, mz, Math.PI / 2, {ring: 0.6})) {
    put(F, a, 'foldingChair', mx - 0.35, mz - 1.15, 0, {laneOk: true});
    put(F, a, 'foldingChair', mx + 0.35, mz + 1.15, Math.PI, {laneOk: true});
  }
  bunkRow(F, a, ds, 3, 3, 2.3);
  wallPut(F, a, 'cabinetTall', ['W', 'E'], 0.8, undefined, true);
  // the families' chests of drawers on the end walls, a writing desk for letters and lessons
  for (let i = 0; i < 2; i++) wallPut(F, a, 'cabinetLow', [i ? 'W' : 'E', i ? 'E' : 'W'], 0.7, undefined, true);
  wallPut(F, a, 'desk', ['E', 'W', ds], 0.7, undefined, true);
}

function latrines(F: F2, a: Area): void {
  // the shower booths (the shelter's decontamination booth model) on the wall the station dresser left free
  const door = F.D.doors(a)[0], ds = door ? doorSide(door, a) : 'N';
  const sides: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  for (let i = 0; i < 2; i++) if (!wallPut(F, a, 'bunkerDeconShower', [...sides, ds], 0.9, undefined, true)) break;
}

function laundry(F: F2, a: Area): void {
  const door = F.D.doors(a)[0], ds = door ? doorSide(door, a) : 'N';
  const far: Side = ds === 'N' ? 'S' : ds === 'S' ? 'N' : ds === 'W' ? 'E' : 'W';
  // wash troughs along the far wall, drying racks in the room
  const sides: Side[] = ds === 'N' || ds === 'S' ? ['W', 'E'] : ['N', 'S'];
  let troughs = 0;
  for (let i = 0; i < 2; i++) if (wallPut(F, a, 'washCounter', [far, ...sides, ds], 0.7, undefined, true)) troughs++;
  if (!troughs) F2_DRESS_STATS.skipped.push('laundry troughs');
  const R = W(a), mx = (R.x0 + R.x1) / 2, mz = (R.z0 + R.z1) / 2;
  // two drying racks down the middle, the laundry bins and the linen cupboard on the side walls, a mop sink's bucket
  near(F, a, 'clothingRack', mx, mz - 0.6, 0, {ring: 0.5}, 1.0);
  near(F, a, 'clothingRack', mx, mz + 1.2, 0, {ring: 0.5}, 1.0);
  wallPut(F, a, 'cabinetTall', [...sides, ds], 0.8, undefined, true);
  for (let i = 0; i < 2; i++) wallPut(F, a, 'wheelieBin', [...sides, ds], 0.3, undefined, true);
  // the folded-linen shelf and the soap / iron cupboard
  wallPut(F, a, 'shelf', [...sides, far, ds], 0.8, undefined, true);
  wallPut(F, a, 'cabinetLow', [...sides, ds, far], 0.7, undefined, true);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The games hall, the utility wing

function gamesHall(F: F2, a: Area): void {
  const R = W(a), mx = (R.x0 + R.x1) / 2, mz = (R.z0 + R.z1) / 2;
  // the ping-pong table in the middle, the table football beside it
  if (!near(F, a, 'pingPongTable', mx, mz, 0, {ring: 1.0, laneOk: true}, 2.5)) F2_DRESS_STATS.skipped.push('ping-pong table');
  near(F, a, 'foosballTable', mx - 3.0, mz + 2.6, 0, {ring: 0.8, laneOk: true}, 2.0);
  // the jukebox on the north wall, the treadmills along the core's wall (east), the TV corner
  wallPut(F, a, 'jukebox', ['N'], 0.8, mx);
  wallPut(F, a, 'treadmill', ['E'], 0.8, R.z0 + 2.0);
  wallPut(F, a, 'lobbySofa', ['W', 'S'], 0.8, R.z0 + 2.4);
  wallPut(F, a, 'crtTvCart', ['N', 'W'], 0.6, R.x0 + 1.0);
  // the players' lockers by the freight door, a notice board of fixtures and scores
  for (let i = 0; i < 3; i++) wallPut(F, a, 'staffLockers', ['W', 'S'], 1.0, R.z1 - 2.0 - i * 1.25, true);
  wallPut(F, a, 'noticeBoard', ['W', 'N'], 0, R.z0 + 2.0);
  // the equipment store: a cupboard, a shelf of games and kit, crates of sports gear; a card table with its chairs
  wallPut(F, a, 'cabinetTall', ['N', 'E'], 0.8, R.x1 - 1.0, true);
  wallPut(F, a, 'shelf', ['N', 'E', 'S'], 0.8, R.x0 + 2.5, true);
  for (let i = 0; i < 2; i++) wallPut(F, a, 'crate', ['S', 'E', 'N'], 0, R.x1 - 1.0 - i * 0.8, true);
  const ct = near(F, a, 'table', mx + 3.0, mz + 3.2, Math.PI / 2, {ring: 0.6, laneOk: true}, 1.5);
  if (ct) for (const s of [-1, 1]) put(F, a, 'foldingChair', ct.x, ct.z + s * 1.15, s < 0 ? 0 : Math.PI, {laneOk: true});
  // two more lamps over the play floor
  light(F, a, mx - 2.5, mz, 4.5, 0);
  light(F, a, mx + 2.5, mz, 4.5, 0);
}

/** The service landing (the service stair's lobby): a bench by the stair, the maintenance notices, spare crates by the plant door. */
function serviceLanding(F: F2, a: Area): void {
  const R = W(a);
  wallPut(F, a, 'bench', ['S'], 0.6, R.x0 + 6.0);
  wallPut(F, a, 'noticeBoard', ['S'], 0, R.x0 + 9.0);
  wallPut(F, a, 'fireExtinguisher', ['S', 'N'], 0.4, R.x0 + 13.0);
  for (let i = 0; i < 2; i++) wallPut(F, a, 'crate', ['E', 'S'], 0, R.z0 + 2.0 + i * 0.8);
  // the maintenance crew's cupboard and parts shelf by the plant door
  wallPut(F, a, 'cabinetTall', ['S', 'E'], 0.8, R.x1 - 4.0, true);
  wallPut(F, a, 'shelf', ['S'], 0.8, R.x1 - 6.5, true);
}

function plantRoom(F: F2, a: Area): void {
  // the hazard outline round the generator skid (floor finish), the cable trench to the nearest wall
  const gen = F.ctx.layout.props.find(p => p.kind === 'bunkerGenerator' && p.area === a.id);
  if (!gen) return;
  const m = 0.6, w = 0.15;
  const x0 = gen.x - gen.hx - m, x1 = gen.x + gen.hx + m, z0 = gen.z - gen.hz - m, z1 = gen.z + gen.hz + m;
  for (const b of [{x0, z0, x1, z1: z0 + w}, {x0, z0: z1 - w, x1, z1}, {x0, z0: z0 + w, x1: x0 + w, z1: z1 - w}, {x0: x1 - w, z0: z0 + w, x1, z1: z1 - w}]) decor(F, 'plasticSeat', b, 0, 0.01);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Streets, plates, the aged wing

function street(F: F2, a: Area): void {
  const R = W(a);
  clearLights(F, a);
  const alongX = a.w >= a.h;
  const len = alongX ? R.x1 - R.x0 : R.z1 - R.z0;
  const n = Math.max(2, Math.round(len / 6.0));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    light(F, a, alongX ? R.x0 + len * t : (R.x0 + R.x1) / 2, alongX ? (R.z0 + R.z1) / 2 : R.z0 + len * t, a.ceil - F.base - 0.02, alongX ? 0 : Math.PI / 2);
  }
  // the residents' corridor lockers: a few single units along the street's walls (the 2 m street keeps a 1.4 m way past them)
  const sides: Side[] = alongX ? ['N', 'S'] : ['W', 'E'];
  for (const f of [0.3, 0.7]) wallPut(F, a, 'staffLockers', sides, 0.6, (alongX ? R.x0 : R.z0) + len * f, true);
}

/** Fallen ceiling panels and a sagging duct in an aged room (decor only, never in a doorway, never over a prop). */
function agedRoom(F: F2, a: Area): void {
  const rng = F.D.rng, R = W(a);
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const w = rng.range(0.9, 1.5), d = rng.range(0.6, 1.1);
    const x = R.x0 + 0.6 + rng.next() * Math.max(0.1, R.x1 - R.x0 - 1.2 - w), z = R.z0 + 0.6 + rng.next() * Math.max(0.1, R.z1 - R.z0 - 1.2 - d);
    const [c0, r0, c1, r1] = coverCells(x + w / 2, z + d / 2, w / 2, d / 2);
    let ok = true;
    // (never under a prop: this pass's props are still in the local height frame, so the grid's blocked cells decide, not boxClear)
    for (let cy = r0; cy <= r1 && ok; cy++) for (let cx = c0; cx <= c1; cx++) { const k = F.D.g.idx(cx, cy); if (F.D.ctx.doorCell[k] || F.D.g.area[k] !== a.id || F.D.g.blocked[k]) { ok = false; break; } }
    if (!ok) continue;
    decor(F, 'panel', {x0: x, z0: z, x1: x + w, z1: z + d}, 0, 0.012);
  }
  const rel = a.ceil - F.base;
  const t = R.x0 + (R.x1 - R.x0) * rng.range(0.3, 0.6);
  decor(F, 'steelBright', {x0: t - 1.0, z0: R.z0 + 0.1, x1: t + 1.0, z1: R.z0 + 0.5}, rel - 0.9, rel - 0.55);
}

/** The shelter's plates on the corridor / hall side of each room's door (the station dresser's stock plates there give way). */
function plates(F: F2): void {
  const L = F.ctx.layout;
  const rows: [string, string, string, number][] = [
    ['kitchen', 'mess', 'KITCHEN', 1.4], ['pantry', 'kitchen', 'PANTRY', 1.2], ['school', 'westSt', 'SCHOOLROOM', 1.6], ['nursery', 'arcade', 'NURSERY', 1.4],
    ['latrines', 'westSt', 'LATRINES · SHOWERS', 2.0], ['laundry', 'southSt', 'LAUNDRY', 1.4], ['games', 'southSt', 'GAMES HALL', 1.6],
    ['plant', 'lobby', 'AUX GENERATOR 1 · DANGER', 2.4], ['lobby', 'southSt', 'SERVICE STAIR · PLANT ROOM', 2.4],
    ['commons', 'mess', 'THE COMMONS', 2.0],
  ];
  for (const k of ['dormA', 'dormB']) {
    const a = F.A(k);
    if (a) rows.push([k, k === 'dormA' ? 'westSt' : 'southSt', a.label === 'Family quarters' ? 'FAMILY QUARTERS' : 'DORMITORY', 1.8]);
  }
  for (const [rk, ok, text, w] of rows) {
    const a = F.A(rk), o = F.A(ok);
    if (!a || !o) continue;
    const d = doorOf(F, a, o);
    if (!d) continue;
    const near = new Set(L.signs.filter(s => s.area === o.id && s.kind === 'service' && Math.hypot(s.x - (d.x + d.w / 2) * CELL, s.z - (d.y + d.h / 2) * CELL) < 3.0));
    if (near.size) L.signs = L.signs.filter(s => !near.has(s));
    if (doorPlate(F.D, d, o, text, w) || doorPlate(F.D, d, o, text, Math.min(w, 1.4))) F2_DRESS_STATS.signs++;
  }
  // the street's house rule at the fire-door portal
  const w = F.A('westSt');
  if (w && wallSign(F.D, w, 'N', (w.x + w.w) * CELL - 3.2, 2.15, {kind: 'service', text: 'QUIET HOURS 2200 – 0600', w: 1.9})) F2_DRESS_STATS.signs++;
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor2(ctx: FloorDressCtx): void {
  const S = F2_DRESS_STATS;
  S.props = S.decor = S.lights = S.signs = S.removedLights = 0;
  S.built = [];
  S.skipped = [];
  const {layout} = ctx;
  const areas = Object.values(ctx.carved.areas).map(id => layout.areas[id]).filter(Boolean);
  const D = shelterDx(layout, ctx.level, ctx.rng, areas);
  for (const i of ctx.held) D.held.add(i);
  const F: F2 = {ctx, D, base: ctx.base, lv: ctx.level, A: k => (ctx.carved.areas[k] !== undefined ? layout.areas[ctx.carved.areas[k]] : undefined)};
  const p0 = layout.props.length, s0 = layout.signs.length;
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  const A = F.A;
  const run = (k: string, fn: (a: Area) => void) => { const a = A(k); if (a) step(k, () => fn(a)); };
  run('commons', a => commons(F, a));
  run('mess', a => messHall(F, a, A('kitchen')));
  run('landing', a => landing(F, a, A('freight')));
  run('freight', a => freightCorridor(F, a));
  run('arcade', a => arcade(F, a));
  run('green', a => greenWalk(F, a, A('commons')));
  run('school', a => schoolroom(F, a));
  run('nursery', a => nursery(F, a));
  for (const k of ['dormA', 'dormB']) run(k, a => (a.label === 'Family quarters' ? familyQuarters(F, a) : dormitory(F, a)));
  run('latrines', a => latrines(F, a));
  run('laundry', a => laundry(F, a));
  run('games', a => gamesHall(F, a));
  run('lobby', a => serviceLanding(F, a));
  run('plant', a => plantRoom(F, a));
  for (const k of ['westSt', 'southSt']) run(k, a => street(F, a));
  for (const id of ctx.carved.aged ?? []) { const a = layout.areas[id]; if (a) step(`aged ${a.label}`, () => agedRoom(F, a)); }
  step('plates', () => plates(F));
  // the guarantee: no floor pocket in any of the storey's areas (a prop of this pass that closes one off goes again)
  sweepPockets(D, areas, p0);
  S.props = layout.props.length - p0;
  S.signs = Math.max(S.signs, layout.signs.length - s0);
}
