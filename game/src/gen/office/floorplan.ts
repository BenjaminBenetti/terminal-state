// Task office-interactions-layout-20261030 (lane LAYOUT): seeded FLOOR-PLAN ARRANGEMENTS of the office floors 2..8 — pure data.
//
// User (item 5): "the layout of the floors feels too cookie cutter … there's always all the same room spots, and the small little
// rooms always show up, supplies, electrical, janitor … The small rooms feel just too small." Before this pass every office floor
// shared ONE skeleton: the same full corridor ring, the same two end-zone rooms beside the core and the same core south strip
// (two washrooms + three 2 x 3 m closets). Now every floor 2..8 draws a PLAN from the level seed (deterministic, independent of
// the generation retry): a corridor TOPOLOGY, a core SUPPORT-ROOM program and END-ZONE splits.
//
// What never moves (gen/office/frame.ts): the footprint, the scissor stairwell + its landings, the elevator shaft + door + landing
// strip (identical X/Z on every storey), the N corridor in front of them (the elevator lobby), two washrooms on every floor.
//
// Topologies (tower-local rows / cols of the frame):
//   ring     N + S corridors full width, both side corridors beside the core (the iteration-16 ring)
//   loopW/E  one side corridor only (the W one for loopW): the other side's end zone widens to the core wall and is split
//            into two rooms; the S corridor is reached round one side only (a C-shaped racetrack)
//   commons  no S corridor: an open WORK COMMONS (10-12 rows deep, full width) south of the core — the side corridors run
//            into it, the core's support rooms open onto it, and a shallower FACADE BAND of rooms / offices lines the south
//            windows behind it (rooms open off the commons, each on one normal door; leftover length = a row of window offices)
// Core support programs (the S strip, cx0..cx1 = 32 cells, 7 rows = 3.5 m deep; every room >= 2.5 m wide): see STRIPS.
// End-zone splits: single room / stacked (two rooms N + S, each on its own corridor) / paired (facade room + inner room).

import {Rng, hashString} from '../../core/rng';
import {CELL} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {CoreUnit, CoreUnitKind} from './frame';

export type Topology = 'ring' | 'loopW' | 'loopE' | 'commons';
export type EndSplit = 'single' | 'stack' | 'pair';
export type StripId = 'closets' | 'utility' | 'pantry' | 'print' | 'lockers' | 'split';

export interface FloorPlan {
  floor: number;
  topology: Topology;
  /** Core south strip program and its units (tower-local columns, 1-cell walls between). */
  strip: StripId;
  units: CoreUnit[];
  /** End-zone splits (W / E of the core). */
  ends: {W: EndSplit; E: EndSplit};
  /** commons: depth (rows) of the open work commons south of the core (0 otherwise). */
  commons: number;
}

/** Smallest enclosed room side (cells): 2.5 m clear inside (item 5: usable entry / turning space). */
export const ROOM_MIN_CELLS = 5;

/** Core south-strip programs: [unit kind, width cells] (sum + walls = the core width, 32 cells). */
export const STRIPS: Readonly<Record<StripId, readonly (readonly [CoreUnitKind, number])[]>> = {
  /** The classic trio reduced to two proper closets (3 m and 3.5 m wide, 3.5 m deep, instead of three 2 x 3 m ones). */
  closets: [['wc-m', 8], ['wc-w', 8], ['janitor', 6], ['riser', 7]],
  /** One utility room (janitor + electrical + supplies merged, 7 m x 3.5 m). */
  utility: [['wc-m', 8], ['wc-w', 8], ['utility', 14]],
  /** A kitchenette / coffee point and an IT closet. */
  pantry: [['wc-m', 7], ['wc-w', 7], ['kitchenette', 9], ['it', 6]],
  /** A print room and a supply room. */
  print: [['wc-m', 7], ['wc-w', 7], ['print', 8], ['storage', 7]],
  /** Staff lockers / showers and a janitor's room. */
  lockers: [['wc-m', 7], ['wc-w', 7], ['lockers', 7], ['janitor', 8]],
  /** Washrooms at both ends of the strip, a utility room between them. */
  split: [['wc-m', 7], ['utility', 16], ['wc-w', 7]],
};

/** Floor 8: the roof access room replaces one support room of its program (the ladder + hatch, gen/office/roof.ts). */
const ROOF_SWAP: Readonly<Record<StripId, readonly (readonly [CoreUnitKind, number])[]>> = {
  closets: [['wc-m', 8], ['wc-w', 8], ['janitor', 6], ['roof', 7]],
  utility: [['wc-m', 7], ['wc-w', 7], ['utility', 9], ['roof', 6]],
  pantry: [['wc-m', 7], ['wc-w', 7], ['kitchenette', 9], ['roof', 6]],
  print: [['wc-m', 7], ['wc-w', 7], ['print', 9], ['roof', 6]],
  lockers: [['wc-m', 7], ['wc-w', 7], ['lockers', 7], ['roof', 8]],
  split: [['wc-m', 7], ['utility', 8], ['roof', 7], ['wc-w', 7]],
};

const STRIP_IDS = Object.keys(STRIPS) as StripId[];

/** Lays a strip program out from column x0 (seeded order), `w` = core width. */
function layStrip(rng: Rng, prog: readonly (readonly [CoreUnitKind, number])[], strip: StripId, x0: number, w: number): CoreUnit[] {
  // ('split' keeps its washrooms at both ends, in either order; the others are shuffled)
  const order = strip === 'split' ? (rng.chance(0.5) ? prog.slice().reverse() : prog.slice()) : rng.shuffle(prog.slice());
  const out: CoreUnit[] = [];
  let x = x0;
  for (const [kind, uw] of order) { out.push({kind, x0: x, x1: x + uw}); x += uw + 1; }
  // Any slack / deficit against the core width (none at the 32-cell core) goes to the last unit.
  out[out.length - 1].x1 = x0 + w;
  return out;
}

/** Shuffles `deck` so that consecutive entries differ (the first of up to 40 shuffles without equal neighbours). */
function spread<T>(rng: Rng, deck: readonly T[]): T[] {
  let d = deck.slice();
  for (let t = 0; t < 40; t++) {
    d = rng.shuffle(deck.slice());
    if (d.every((q, i) => i === 0 || q !== d[i - 1])) break;
  }
  return d;
}

/**
 * The plans of office floors 2..8 of a level seed (index = floor; [0], [1] unused). `dims` = the frame's corridor width, S band
 * depth and core columns. At least three different topologies per level (ring, a loop, the commons), every strip program at most
 * twice, consecutive floors differ in topology and strip; floor 8 carries the roof access room.
 */
/** Largest enclosed room (cells, 76 m2 — the old end-zone maximum): a bigger single end-zone room is split instead. */
export const ROOM_MAX_CELLS = 304;

export function floorPlans(levelSeed: number, dims: {K: number; sB: number; cx0: number; cx1: number; top: number; eW?: number; eE?: number; rows?: number}): FloorPlan[] {
  const rng = new Rng(hashString('office-floor-plans-v1', levelSeed >>> 0));
  const floors: number[] = [];
  for (let n = 2; n <= dims.top; n++) floors.push(n);
  const extra = rng.pick<Topology>(['ring', 'loopW', 'loopE', 'commons']);
  const topoDeck: Topology[] = ([...['ring', 'ring', 'loopW', 'loopE', 'commons', 'commons'] as Topology[], extra]).slice(0, Math.max(3, floors.length));
  while (topoDeck.length < floors.length) topoDeck.push(rng.pick<Topology>(['ring', 'loopW', 'loopE', 'commons']));
  const topos = spread(rng, topoDeck);
  const stripDeck: StripId[] = [...rng.shuffle(STRIP_IDS.slice()), rng.pick(STRIP_IDS)].slice(0, floors.length);
  while (stripDeck.length < floors.length) stripDeck.push(rng.pick(STRIP_IDS));
  const strips = spread(rng, stripDeck);
  const plans: FloorPlan[] = [];
  floors.forEach((floor, i) => {
    const topology = topos[i], strip = strips[i];
    const prog = floor === dims.top ? ROOF_SWAP[strip] : STRIPS[strip];
    const units = layStrip(rng.fork(`strip-${floor}`), prog, strip, dims.cx0, dims.cx1 - dims.cx0);
    // End zones: the widened side of a loop is always split; a ring floor never keeps both zones whole.
    // (a widened loop zone is always PAIRED — two compact 5-6 m rooms; stacked it gave 11-12 m x 4 m tubes the window-breach gas
    // never filled, nor furniture)
    // (and a zone too big for one room — over ROOM_MAX_CELLS — is never kept single)
    const pickSplit = (wide: boolean, w = 0): EndSplit => (wide ? 'pair' : w * (dims.rows ?? 0) > ROOM_MAX_CELLS ? (rng.chance(0.55) ? 'stack' : 'pair')
      : rng.weighted<EndSplit>([['single', 0.34], ['stack', 0.36], ['pair', 0.3]]));
    const ends = {W: pickSplit(topology === 'loopE', dims.eW), E: pickSplit(topology === 'loopW', dims.eE)};
    if (topology === 'ring' && ends.W === 'single' && ends.E === 'single') ends[rng.chance(0.5) ? 'W' : 'E'] = rng.chance(0.5) ? 'stack' : 'pair';
    // Commons depth: 10-12 rows, leaving a facade band of >= 8 rows (4 m) behind it.
    const room = dims.sB + dims.K - 8;
    const commons = topology === 'commons' ? Math.max(10, Math.min(12, room - rng.int(0, 1))) : 0;
    plans[floor] = {floor, topology, strip, units, ends, commons};
  });
  return plans;
}

/** Short structural key of a plan (QA / tests: what the floor's skeleton is). */
export const planKey = (p: FloorPlan): string => `${p.topology}/${p.strip}/${p.ends.W}-${p.ends.E}${p.commons ? `/c${p.commons}` : ''}`;

/**
 * QA (the primary's browser spot check): a pose on office floor `floor` at the head of a side corridor (the elevator-lobby end),
 * looking south down it — the end-zone rooms beside it and, ahead, the S corridor (ring / loop) or the open work commons. `kind`
 * reads the arrangement from the geometry: 'ring' (2 side corridors + S corridor), 'loop' (1 side corridor), 'commons'.
 */
export function floorPlanPose(layout: StationLayout, floor: number): {x: number; y: number; z: number; yaw: number; pitch: number; level: number; kind: string} | null {
  const L = layout.levels[floor];
  if (!L) return null;
  const corr = layout.areas.filter(a => a.level === floor && a.type === 'office-corridor');
  const sides = corr.filter(a => a.h > a.w * 2).sort((a, b) => a.x - b.x);
  const wide = corr.filter(a => a.w > a.h * 4).sort((a, b) => a.y - b.y);
  const commons = layout.areas.some(a => a.level === floor && a.type === 'office-open' && sides.length && a.y === sides[0].y + sides[0].h);
  const s = sides[0];
  if (!s) return null;
  const kind = commons ? 'commons' : sides.length === 1 ? 'loop' : wide.length >= 2 ? 'ring' : 'other';
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {x: r3((s.x + s.w / 2) * CELL), y: L.baseY, z: r3(s.y * CELL + 0.8), yaw: Math.PI, pitch: -0.05, level: floor, kind};
}
