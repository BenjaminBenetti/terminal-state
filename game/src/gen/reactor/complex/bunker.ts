// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER — "Shelter 7", a civil-defence / reactor-security bunker cut into the rock
// off the Reactor's tier-1 gallery, housing zone 0's auxiliary generator (user: "The generators you need to startup to clear the fog
// on each level should be in substantial sub complexes coming off the main shaft. Think bunkers…"). Contract: ./types.ts.
//
// The program (./bunkerPlan.ts, a local frame along / into the wall) is mapped onto the slot's canvas region and carved into the
// shared Kit on the slot's storey: blast-door lock -> decontamination -> muster corridor, a guard post beside the lock (loop 1), two
// spine corridors to the GENERATOR HALL (loop 2), the mess hall between them (a third way through), dormitories, infirmary, radio
// room, air filtration plant, latrines, stores, workshop, warden's office …, the switch room and the dead-end ARMOURY off the hall.
// Pure: draws only from `inp.rng`; null when the region cannot hold the program (the host keeps the generator on its landing).
// The `dress` hook (./bunkerDress.ts) furnishes it after the crop.

import {SOLID} from '../../grid';
import type {Area, Rect} from '../../stationTypes';
import type {ComplexCarve, ComplexCarveInput, ComplexRoom} from './types';
import {BUNKER, planBunker, type BunkerPlan, type LRect} from './bunkerPlan';
import {dressBunker} from './bunkerDress';
import {BLAST} from './bunkerKinds';

/** Human name of the complex (HUD / map boards). */
export const BUNKER_NAME = 'Shelter 7 — civil-defence bunker';

/** Why the last carves failed (QA / tests). */
export const BUNKER_FAILS: Record<string, number> = {};
const fail = (why: string): null => { BUNKER_FAILS[why] = (BUNKER_FAILS[why] ?? 0) + 1; return null; };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The local frame of a slot: local (u, v) cells <-> canvas cells. */
export interface BunkerFrame {
  A: number;
  Vd: number;
  e0: number;
  e1: number;
  /** Canvas rect of a local rect, canvas cell of a local cell, canvas direction of local +u / +v. */
  rect(r: LRect): Rect;
  cell(u: number, v: number): [number, number];
  du: [number, number];
  dv: [number, number];
  /** Canvas point (continuous cells) of local (0, 0): local continuous (u, v) -> canvas = origin + u * du + v * dv. */
  origin: [number, number];
  /** Local u direction of the blast-door model's +x when its front (+z) faces -v (the lock), and that model yaw. */
  leafSign: 1 | -1;
  modelYaw: number;
}

/** The local frame of a complex slot (u along the pit wall, v into the rock from the row behind the entrance). */
export function bunkerFrame(inp: Pick<ComplexCarveInput, 'slot'>): BunkerFrame | null {
  const {region: R, entrance: E, inward} = inp.slot;
  const ns = inward === 'N' || inward === 'S';
  if (ns ? E.h !== 1 : E.w !== 1) return null;
  const A = ns ? R.w : R.h;
  const e0 = ns ? E.x - R.x : E.y - R.y, e1 = e0 + (ns ? E.w : E.h);
  const Vd = inward === 'S' ? R.y + R.h - E.y - 2 : inward === 'N' ? E.y - R.y - 1 : inward === 'E' ? R.x + R.w - E.x - 2 : E.x - R.x - 1;
  const rect = (r: LRect): Rect => {
    switch (inward) {
      case 'S': return {x: R.x + r.u, y: E.y + 1 + r.v, w: r.w, h: r.h};
      case 'N': return {x: R.x + r.u, y: E.y - r.v - r.h, w: r.w, h: r.h};
      case 'E': return {x: E.x + 1 + r.v, y: R.y + r.u, w: r.h, h: r.w};
      default: return {x: E.x - r.v - r.h, y: R.y + r.u, w: r.h, h: r.w};
    }
  };
  const cell = (u: number, v: number): [number, number] => {
    switch (inward) {
      case 'S': return [R.x + u, E.y + 1 + v];
      case 'N': return [R.x + u, E.y - 1 - v];
      case 'E': return [E.x + 1 + v, R.y + u];
      default: return [E.x - 1 - v, R.y + u];
    }
  };
  const du: [number, number] = ns ? [1, 0] : [0, 1];
  const dv: [number, number] = inward === 'S' ? [0, 1] : inward === 'N' ? [0, -1] : inward === 'E' ? [1, 0] : [-1, 0];
  const origin: [number, number] = inward === 'S' ? [R.x, E.y + 1] : inward === 'N' ? [R.x, E.y] : inward === 'E' ? [E.x + 1, R.y] : [E.x, R.y];
  // a model facing -v (front +z = F): yaw = atan2(F.x, F.z); its +x = (F.z, -F.x) (three.js Y rotation)
  const F = [-dv[0], -dv[1]];
  const X = [F[1], -F[0]];
  const leafSign: 1 | -1 = X[0] * du[0] + X[1] * du[1] > 0 ? 1 : -1;
  return {A, Vd, e0, e1, rect, cell, du, dv, origin, leafSign, modelYaw: Math.atan2(F[0], F[1])};
}

/** Camera-convention yaw facing canvas direction (dx, dy) (forward = (-sin yaw, -cos yaw); canvas y = world z). */
export const yawOf = (dx: number, dy: number): number => r2(Math.atan2(-dx, -dy));

/** What the dress hook needs from the carve (canvas cells; the hook subtracts the crop). */
export interface BunkerCarveRec {
  plan: BunkerPlan;
  frame: BunkerFrame;
  /** Area id per plan room key. */
  area: Record<string, number>;
  level: number;
  baseY: number;
  /** Entrance span (canvas), the deck area in front of it, inward direction. */
  entrance: Rect;
  frontArea: number;
  inward: 'N' | 'S' | 'E' | 'W';
}

export function carveBunker(inp: ComplexCarveInput): ComplexCarve | null {
  const {k, rng, slot, levelOpt} = inp;
  const f = bunkerFrame(inp);
  if (!f) return fail('entrance-shape');
  const plan = planBunker(f.A, f.Vd, f.e0, f.e1, f.leafSign, rng);
  if (!plan) return fail('plan');
  const lv = slot.level, g = k.grid(lv), R = slot.region;
  const front = k.areas[slot.frontArea];
  if (!front || (front.level ?? 0) !== lv) return fail('front-area');
  // every planned cell + its wall margin is untouched rock of this storey inside the region (the entrance row may be the margin)
  const inRegion = (r: Rect) => r.x >= R.x && r.y >= R.y && r.x + r.w <= R.x + R.w && r.y + r.h <= R.y + R.h;
  for (const p of plan.rooms) {
    const r = f.rect(p.r);
    if (!inRegion(r)) return fail(`outside-${p.key}`);
    if (!k.rectFree(r, lv)) return fail(`not-free-${p.key}`);
  }
  {
    const E = slot.entrance;
    for (let y = E.y; y < E.y + E.h; y++) for (let x = E.x; x < E.x + E.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) return fail('entrance-open');
  }
  // carve: rooms (parents first: the plan lists them in that order), then the openings
  const ceilCap = slot.ceilMax;
  const area: Record<string, number> = {};
  const areaOf = (key: string): Area => (key ? k.areas[area[key]] : front);
  for (const p of plan.rooms) {
    const parent = p.parent ? area[p.parent] : slot.frontArea;
    if (parent === undefined) return fail(`parent-${p.key}`);
    const ceil = r2(Math.min(slot.baseY + p.clear, ceilCap));
    if (ceil - slot.baseY < 2.6) return fail('ceil-max');
    const a = k.addArea(f.rect(p.r), p.kind, p.type, ceil, parent, {...levelOpt, floorY: slot.baseY, label: p.label, publicSpace: false, role: 'reactor-room'});
    a.purpose = p.purpose;
    area[p.key] = a.id;
  }
  for (const d of plan.doors) {
    const gap = d.kind === 'blast' ? slot.entrance : f.rect(d.gap);
    k.carveDoor(gap, areaOf(d.a), areaOf(d.b), d.height, d.arch);
  }
  // the blast door's raised threshold: three risers up to the sill across the bulkhead lane, three down (cell floors, <= STEP_UP)
  {
    const riser = r2(BLAST.sill / 3);
    for (const [v, n] of plan.blast.steps) for (let u = plan.blast.uo; u < plan.blast.uo + 3; u++) {
      const [x, y] = f.cell(u, v);
      g.floor[g.idx(x, y)] = r2(slot.baseY + n * riser);
    }
  }
  const keys = plan.rooms.map(p => p.key);
  const rooms: ComplexRoom[] = plan.rooms.map(p => ({area: area[p.key], key: p.key, label: p.label, role: p.role}));
  // the generator: skid footprint, long axis along local u; use point beside the panel end, facing it
  const foot = f.rect(plan.gen.foot);
  const [ux, uy] = f.cell(plan.gen.use.u, plan.gen.use.v);
  const s = plan.gen.end === 'hi' ? -1 : 1; // from the use cell toward the skid along u
  const yawAlongU = f.du[0] !== 0 ? 0 : r2(Math.PI / 2);
  const rec: BunkerCarveRec = {plan, frame: f, area, level: lv, baseY: slot.baseY, entrance: {...slot.entrance}, frontArea: slot.frontArea, inward: slot.inward};
  return {
    id: 'bunker', slot, name: BUNKER_NAME,
    areas: keys.map(q => area[q]), entryArea: area.lock, rooms,
    generator: {area: area.hall, foot, yaw: yawAlongU, use: {x: ux, y: uy, yaw: yawOf(s * f.du[0], s * f.du[1])}},
    dress: (layout, drng, crop) => dressBunker(layout, drng, crop, rec),
  };
}

export {BUNKER};
