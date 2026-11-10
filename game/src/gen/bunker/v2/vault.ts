// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2's VAULT ENTRY — the bulkhead opening cut to the blast door's real round
// aperture (fix 2 of the user's feedback). Pure data.
//
// The Reactor's round blast door (REACTOR_X_KIT.blastDoor; gen/reactor/complex/bunkerKinds.ts BLAST) is a square steel frame 1.57 m deep
// round a ~2.64 m round opening (centre ~1.88 m above the base; at the threshold height 0.84 m the free chord is ~1.6 m, at the 1.5 m
// lane's edges the ring's crown is 2.97 m). Version 1 cut a 1.5 m x 3.1 m slot through the 1 m bulkhead: through the round frame the
// player saw a narrow rectangular slot (flat jamb walls and a flat soffit inside the ring), and the builder's door trim stood across the
// lane (fixed for every version in world/builder.ts). Version 2 cuts the bulkhead WIDER and TALLER than the ring (7 cells = 3.5 m,
// clear to 3.25 m), so every grid face of the cut lies behind the frame's steel and the frame's own round bore is the visible tunnel:
//  - the walkable lane is the middle 3 cells (1.5 m) at the threshold height over the same three-riser steps each side;
//  - the two cells each side of it are the ring's curved cheeks: collision boxes from the threshold to the cut's top (the curved steel
//    rises from the lane's edge: a foot meets it there), drawn by the model itself (variant-1 blastDoor parts are never drawn);
//  - the leaf, the frame's feet (hall side) and plinth (vestibule side) are collision as in version 1; the lane is never locked.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import type {Kit} from '../../stationKit';
import type {Area, Rect, StationLayout} from '../../stationTypes';
import {BLAST} from '../../reactor/complex/bunkerKinds';
import {solidProp} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import type {BunkerSpine} from './spine';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The cut's clear top (absolute; above the ring's crown 3.2 m). */
export const VAULT_CUT_TOP = 3.25;
/** Cells each side of the 3-cell lane inside the cut (the ring's cheeks). */
export const VAULT_CHEEK_CELLS = 2;

export interface VaultCarve {
  /** The walkable lane (3 cells, through the bulkhead rows) and the whole cut (lane + cheeks). */
  lane: Rect;
  cut: Rect;
  /** Threshold rows with their riser count (floor = n * sill / 3). */
  steps: {y: number; n: number}[];
  /** Model origin (world x, z) and yaw (front = toward the arrival hall: rot PI). */
  ox: number; oz: number; rot: number;
  /** The lane's centre (world; layout.bunker.vaultDoor x / z). */
  laneX: number; laneZ: number;
}

/** Cuts the bulkhead between the floor's arrival area (`hall`, north) and the spine's vestibule (south); lays the threshold steps. */
export function carveVaultLane(k: Kit, sp: BunkerSpine, hall: Area, vest: Area): VaultCarve {
  const g0 = k.grid(0), L = sp.station.lane, by = L.y;
  const cut: Rect = {x: L.x - VAULT_CHEEK_CELLS, y: by, w: L.w + 2 * VAULT_CHEEK_CELLS, h: L.h};
  // the lane is the doorway (framed by the model: no trim); the cheek cells beside it are opened with it (the vestibule's floor at the
  // threshold, the cut's top) but are not part of the doorway — the ring's cheek collision stands on them
  k.carveDoor(L, hall, vest, VAULT_CUT_TOP, false, {noFrame: true});
  for (let y = by; y < by + L.h; y++) for (let x = cut.x; x < cut.x + cut.w; x++) {
    if (x >= L.x && x < L.x + L.w) continue;
    const i = g0.idx(x, y);
    g0.cells[i] = FLOOR; g0.area[i] = vest.id; g0.ceil[i] = VAULT_CUT_TOP;
  }
  const steps = [{y: by - 3, n: 1}, {y: by - 2, n: 2}, {y: by - 1, n: 3}, {y: by, n: 3}, {y: by + 1, n: 3}, {y: by + 2, n: 3}, {y: by + 3, n: 2}, {y: by + 4, n: 1}];
  const riser = r2(BLAST.sill / 3);
  for (const s of steps) for (let x = L.x; x < L.x + L.w; x++) g0.floor[g0.idx(x, s.y)] = r2(s.n * riser);
  // the cheek cells inside the bulkhead sit at the threshold too (no pit beside the lane; collision boxes cover them)
  for (let y = by; y < by + L.h; y++) for (let x = cut.x; x < cut.x + cut.w; x++) if (x < L.x || x >= L.x + L.w) g0.floor[g0.idx(x, y)] = r2(3 * riser);
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2, zb = (by + L.h / 2) * CELL;
  const laneX = r3((L.x + L.w / 2) * CELL);
  return {lane: {...L}, cut, steps, ox: r3(laneX + BLAST.openX), oz: r3(zb + zc), rot: Math.PI, laneX, laneZ: r3(zb)};
}

/** The blast door's collision pieces (the drawn leaf = variant 0), the ring's cheeks, the threshold's tread plates; the lane held clear. */
export function placeVaultDoor(layout: StationLayout, v: VaultCarve, hall: Area, vest: Area, rng: Rng, holds: {level: number; cells: number[]}[]): number {
  const D = shelterDx(layout, 0, rng, [hall, vest]);
  const {ox, oz, lane, steps, cut} = v;
  // rot PI: model (x, z) -> world (ox - x, oz - z)
  const mbox = (x0: number, x1: number, z0: number, z1: number) => ({x0: ox - Math.max(x0, x1), x1: ox - Math.min(x0, x1), z0: oz - Math.max(z0, z1), z1: oz - Math.min(z0, z1)});
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2, half = lane.h / 2 * CELL;
  const frontFace = zc + half, backFace = zc - half;
  const lx0 = BLAST.openX - BLAST.laneHalf, lx1 = BLAST.openX + BLAST.laneHalf;
  const hFront = Math.min(BLAST.bodyH, hall.ceil) - 0.05, hBack = Math.min(BLAST.bodyH, vest.ceil) - 0.05;
  const leaf = solidProp(D, 'blastDoor', hall, mbox(BLAST.leaf.x[0], BLAST.leaf.x[1], BLAST.leaf.z[0], BLAST.leaf.z[1]), BLAST.leaf.h, Math.PI, 0, true);
  const idx = layout.props.indexOf(leaf);
  solidProp(D, 'blastDoor', hall, mbox(-BLAST.halfW, lx0, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', hall, mbox(lx1, BLAST.halfW, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', vest, mbox(-BLAST.halfW, lx0, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  solidProp(D, 'blastDoor', vest, mbox(lx1, BLAST.halfW, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  // the ring's cheeks inside the bulkhead: the cut's cells beside the lane (no sight block: the bore is open above the curve)
  const z0 = lane.y * CELL, z1 = (lane.y + lane.h) * CELL;
  const xl0 = cut.x * CELL, xl1 = lane.x * CELL, xr0 = (lane.x + lane.w) * CELL, xr1 = (cut.x + cut.w) * CELL;
  solidProp(D, 'blastDoor', vest, {x0: xl0, x1: xl1, z0, z1}, VAULT_CUT_TOP, 0, 1, false);
  solidProp(D, 'blastDoor', vest, {x0: xr0, x1: xr1, z0, z1}, VAULT_CUT_TOP, 0, 1, false);
  // tread plates on the risers, amber nosings at the first / last step
  const sill = BLAST.sill, x0 = lane.x * CELL, x1 = (lane.x + lane.w) * CELL;
  for (const s of steps) {
    const y = r3(s.n * sill / 3);
    D.decor('steelDark', {x0, x1, z0: s.y * CELL, z1: (s.y + 1) * CELL}, y, y + 0.012);
  }
  D.decor('plasticSeat', {x0, x1, z0: steps[0].y * CELL, z1: steps[0].y * CELL + 0.05}, r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  D.decor('plasticSeat', {x0, x1, z0: (steps[steps.length - 1].y + 1) * CELL - 0.05, z1: (steps[steps.length - 1].y + 1) * CELL}, r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  // the lane + one row beyond each end held clear through the dresser
  const g = layout.levels[0].grid, cells: number[] = [];
  for (const s of [{y: steps[0].y - 1}, ...steps, {y: steps[steps.length - 1].y + 1}]) for (let x = lane.x - 1; x <= lane.x + lane.w; x++) if (g.inBounds(x, s.y)) cells.push(g.idx(x, s.y));
  holds.push({level: 0, cells: cells.filter(i => g.cells[i] === FLOOR && !g.blocked[i])});
  return idx;
}
