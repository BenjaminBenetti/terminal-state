// Task studio-bunker-level-20261109-072224-01: carving of THE BUNKER into ONE Kit (6 level grids; canvas = grid cells: the crop
// origin is fixed at 0, 0). Pure data (gen/bunker/index.ts crops, links, dresses, records and validates). Canonical frame + mirror:
// gen/bunker/frame.ts.
//
//  1. STOREY 0 — the station: a one-track bed + side platform (the Market's / Reactor rim's station block: edge N, the player's train
//     parks on the bed), two openings into the ARRIVAL HALL, the guard booth (+ an optional station office) off the hall, the 1 m vault
//     BULKHEAD (its 3-cell lane over the raised threshold under the round blast door: gen/reactor/complex/bunkerKinds.ts BLAST), the
//     VAULT VESTIBULE behind it opening onto the main stair's storey-0 landing.
//  2. The two SCISSOR STAIR CORES (the Mall's service core on a 7 m storey: gen/mall/carve.ts carveCore): per storey a full-width
//     landing at alternating ends, one straight run per storey pair in alternating lanes (layStairRun into both grids, risers 7 / 41 m,
//     1.2 m landings), the divider rock between the lanes; core A (main) storeys 0-5, core B (service) storeys 1-5.
//  3. STOREYS 1-5 — each storey's footprint planned round the cores (./plan.ts: the Reactor shelter planner) and carved: lobbies,
//     spine, corridors, rooms (absolute floors at the storey's baseY, clear heights by room), every planned door, the landing doors.

import {CELL, VOID} from '../grid';
import {Kit, TUN, type TrenchCells} from '../stationKit';
import {STAIR, layStairRun, type StairFlight} from '../traversal';
import {SINGLE_BED_CELLS, TRENCH_DEPTH, type Area, type Rect} from '../stationTypes';
import type {Rng} from '../../core/rng';
import {BLAST} from '../reactor/complex/bunkerKinds';
import {BUNKER_STOREY_PROGRAMMES} from './programme';
import {planStorey, type StoreyPlan, type StoreySkeleton} from './plan';
import {BUNKER, BUNKER_BASES, BUNKER_LEVELS, BUNKER_STOREY_LABELS, type BunkerFrame} from './frame';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** One scissor core as carved (canvas = grid cells). */
export interface CoreCarve {
  id: 'A' | 'B';
  rect: Rect;
  from: number;
  to: number;
  /** Per storey: the landing's area id / rect and its end ('lo' = the low-y end). */
  landing: Record<number, {area: number; rect: Rect; end: 'lo' | 'hi'}>;
  /** Per storey pair (upper storey index): the run's area id and flight ids (k.flights). */
  runs: {upper: number; area: number; rect: Rect; flights: number[]}[];
  /** Per storey >= 1: the stair lobby's area id. */
  lobby: Record<number, number>;
}

/** The vault bulkhead (storey 0): the lane through it, the threshold rows and the blast door model's pose (world metres). */
export interface BulkheadCarve {
  lane: Rect;
  /** Bulkhead rows (the 2-cell wall band), the threshold rows with their riser count (floor = n * sill / 3). */
  rows: [number, number];
  steps: {y: number; n: number}[];
  /** Model origin (world x, z) and yaw (prop convention: front = (sin rot, cos rot) = toward the arrival hall). */
  ox: number; oz: number; rot: number;
}

export interface StoreyCarve {
  level: number;
  plan: StoreyPlan;
  footprint: Rect;
  /** Area id per plan room key. */
  area: Record<string, number>;
}

export interface BunkerCarve {
  f: BunkerFrame;
  W: number; H: number;
  bed: Rect;
  trench: TrenchCells;
  platform: Area;
  hall: Area;
  vest: Area;
  booth: Area;
  office: Area | null;
  openings: Rect[];
  bulkhead: BulkheadCarve;
  cores: CoreCarve[];
  storeys: StoreyCarve[];
  /** The storey-0 footprint (canvas cells) of the station rooms (wayfinding / QA). */
  stationRect: Rect;
}

/** Why the last carves failed (QA / tests). */
export const BUNKER_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { BUNKER_CARVE_FAILS[why] = (BUNKER_CARVE_FAILS[why] ?? 0) + 1; return null; };

/** The canvas (cells) and canonical anchor columns / rows of a frame. */
export function bunkerCanvas(f: BunkerFrame): {W: number; H: number; ax: number; bx: number; cy0: number; hy0: number; vy0: number; by: number; px0: number; hall: Rect; vest: Rect} {
  const S = BUNKER.station, Cr = BUNKER.core;
  const mwMax = Math.max(...f.storeys.slice(1).map(s => s.mw)), meMax = Math.max(...f.storeys.slice(1).map(s => s.me));
  const msMax = Math.max(...f.storeys.slice(1).map(s => s.ms));
  const hy0 = S.bedY + SINGLE_BED_CELLS + f.Pd + 1, by = hy0 + f.hallD, vy0 = by + BUNKER.bulkhead, cy0 = vy0 + f.vestD + 1;
  // core A's column: the storeys' west margins and the station (the hall stays inside the canvas)
  const hallOff = Math.round(f.vestW / 2 - f.hallW * f.hallSlide) - f.vestOver; // hall.x - ax
  // (the booth / station office stand beside the hall's short walls: >= 14 cells of canvas west of the hall)
  const ax = Math.max(mwMax + 3, 16 - hallOff, 6);
  const bx = ax + Cr.laneA * 2 + 1 + 1 + BUNKER.lobby + 1 + f.gap + 1 + BUNKER.lobby + 1;
  const vest: Rect = {x: ax - f.vestOver, y: vy0, w: f.vestW, h: f.vestD};
  const hall: Rect = {x: ax + hallOff, y: hy0, w: f.hallW, h: f.hallD};
  const hc = hall.x + hall.w / 2;
  const px0 = Math.max(TUN + 3, Math.round(hc - f.Lp / 2));
  const W = Math.max(px0 + f.Lp + TUN + 3, bx + Cr.laneB * 2 + 1 + meMax + 3, hall.x + hall.w + 16);
  const H = Math.max(cy0, cy0 + f.dyB) + Cr.len + msMax + 3;
  return {W, H, ax, bx, cy0, hy0, vy0, by, px0, hall, vest};
}

/** Carves the whole Bunker into a fresh kit (BUNKER_LEVELS grids of the frame's canvas); null when it does not fit. */
export function carveBunker(k: Kit, f: BunkerFrame, rng: Rng): BunkerCarve | null {
  const cv = bunkerCanvas(f);
  const {W, H, ax, bx, cy0} = cv;
  if (k.g.w !== W || k.g.h !== H) return fail('canvas');
  const M = (r: Rect): Rect => (f.mirror ? {x: W - r.x - r.w, y: r.y, w: r.w, h: r.h} : {...r});
  const bases = BUNKER_BASES, C = BUNKER.clear, Cr = BUNKER.core, S = BUNKER.station;
  const g0 = k.grid(0);
  const lvOpt = (L: number) => (L ? {level: L, floorY: bases[L]} : {});

  // --- 1. Storey 0: the station -------------------------------------------------------------------------------------------------
  const bedY = S.bedY;
  const bed = M({x: cv.px0 - TUN, y: bedY, w: f.Lp + 2 * TUN, h: SINGLE_BED_CELLS});
  const roof = C.platform;
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) {
    const i = g0.idx(x, y);
    g0.cells[i] = VOID; g0.ceil[i] = roof; g0.floor[i] = -TRENCH_DEPTH;
  }
  g0.voidFloor = -TRENCH_DEPTH;
  const pY = bedY + SINGLE_BED_CELLS;
  const pRect = M({x: cv.px0, y: pY, w: f.Lp, h: f.Pd});
  const trench: TrenchCells = {x0: bed.x, x1: bed.x + bed.w, y0: bed.y, y1: pY, px0: pRect.x, px1: pRect.x + pRect.w, tracks: [pY * CELL - 2.0], third: [-1], columns: false, ceil: roof};
  k.trenches.push(trench);
  const platform = k.addArea(pRect, 'platform', 'platform', roof, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;
  const hallC = cv.hall;
  if (hallC.x < 3 || hallC.x + hallC.w > W - 3) return fail('hall-canvas');
  const hall = k.addArea(M(hallC), 'concourse', 'concourse', C.hall, platform.id, {label: 'Arrival hall', publicSpace: true});
  // two openings platform -> hall through the platform wall (inside both spans)
  const openings: Rect[] = [];
  {
    const lo = Math.max(cv.px0 + 2, hallC.x + 2), hi = Math.min(cv.px0 + f.Lp - 2, hallC.x + hallC.w - 2);
    if (hi - lo < 18) return fail('openings');
    const ow = 6;
    for (const t of [0.22, 0.78]) {
      const x = Math.round(lo + (hi - lo - ow) * t);
      const gap = M({x, y: pY + f.Pd, w: ow, h: 1});
      k.carveDoor(gap, platform, hall, BUNKER.door.platform, false);
      openings.push(gap);
    }
  }
  const vestC = cv.vest;
  const vest = k.addArea(M(vestC), 'concourse', 'concourse', C.vest, hall.id, {label: 'Vault vestibule', publicSpace: true});
  // the booth (and the station office) off the hall's short walls
  const [b0, b1] = S.booth;
  const bw = rng.int(b0, b1), bh = Math.min(f.hallD - 2, rng.int(b0, b1 + 1));
  const sideRect = (east: boolean, w: number, h: number): Rect => ({x: east ? hallC.x + hallC.w + 1 : hallC.x - 1 - w, y: hallC.y + Math.floor((f.hallD - h) / 2), w, h});
  const boothC = sideRect(f.boothEast, bw, bh);
  if (!k.rectFree(M(boothC))) return fail('booth');
  const booth = k.addArea(M(boothC), 'room', 'agent-office', C.booth, hall.id, {label: 'Guard booth', publicSpace: false});
  booth.purpose = 'security-office';
  k.carveDoor(M({x: f.boothEast ? boothC.x - 1 : boothC.x + boothC.w, y: boothC.y + Math.floor(bh / 2) - 1, w: 1, h: 3}), hall, booth, BUNKER.door.room, false);
  let office: Area | null = null;
  if (f.office) {
    const oc = sideRect(!f.boothEast, rng.int(9, 12), Math.min(f.hallD - 2, rng.int(9, 12)));
    if (k.rectFree(M(oc))) {
      office = k.addArea(M(oc), 'room', 'agent-office', C.booth, hall.id, {label: 'Station office', publicSpace: false});
      office.purpose = 'agent-office';
      k.carveDoor(M({x: !f.boothEast ? oc.x - 1 : oc.x + oc.w, y: oc.y + Math.floor(oc.h / 2) - 1, w: 1, h: 3}), hall, office, BUNKER.door.room, false);
    }
  }
  // the bulkhead lane: 3 cells, the frame (+-BLAST.halfW about the opening) inside both rooms' spans (world columns after the mirror)
  const vw = M(vestC), hw = M(hallC);
  const half = Math.ceil(BLAST.halfW / CELL) + 1;
  const lo = Math.max(vw.x, hw.x) + half - 1, hi = Math.min(vw.x + vw.w, hw.x + hw.w) - half - 2;
  if (hi < lo) return fail('bulkhead-span');
  const coreAx = M({x: ax, y: cy0, w: Cr.laneA * 2 + 1, h: Cr.len});
  const want = Math.round(coreAx.x + coreAx.w / 2 - 1.5);
  const ux = Math.max(lo, Math.min(hi, want + rng.int(-2, 2)));
  const by = cv.by;
  const lane: Rect = {x: ux, y: by, w: 3, h: BUNKER.bulkhead};
  k.carveDoor(lane, hall, vest, 3.1, false);
  const steps = [{y: by - 3, n: 1}, {y: by - 2, n: 2}, {y: by - 1, n: 3}, {y: by, n: 3}, {y: by + 1, n: 3}, {y: by + 2, n: 3}, {y: by + 3, n: 2}, {y: by + 4, n: 1}];
  const riser = r2(BLAST.sill / 3);
  for (const s of steps) for (let x = ux; x < ux + 3; x++) g0.floor[g0.idx(x, s.y)] = r2(s.n * riser);
  // the model: front (+z, the open leaf) toward the hall (north): rot PI; its body centred in the bulkhead, the opening over the lane
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2, zb = (by + BUNKER.bulkhead / 2) * CELL;
  const bulkhead: BulkheadCarve = {lane, rows: [by, by + 1], steps, ox: r3((ux + 1.5) * CELL - BLAST.openX * -1), oz: r3(zb + zc), rot: Math.PI};
  // (rot PI: model (x, z) -> world (-x, -z) about the origin: the opening's world x = ox - openX; the body centre z = oz - zc = zb)
  bulkhead.ox = r3((ux + 1.5) * CELL + BLAST.openX);

  // --- 2. The scissor cores -----------------------------------------------------------------------------------------------------
  const cores: CoreCarve[] = [];
  const coreA = carveCore(k, 'A', M({x: ax, y: cy0, w: Cr.laneA * 2 + 1, h: Cr.len}), Cr.laneA, 0, BUNKER_LEVELS - 1, 'lo', f.mirror);
  const coreB = carveCore(k, 'B', M({x: bx, y: cy0 + f.dyB, w: Cr.laneB * 2 + 1, h: Cr.len}), Cr.laneB, 1, BUNKER_LEVELS - 1, f.endB1, f.mirror);
  cores.push(coreA, coreB);
  // storey 0: the vestibule opens onto core A's north landing through the core's end wall
  {
    const L0 = coreA.landing[0];
    k.carveDoor({x: L0.rect.x + 1, y: L0.rect.y - 1, w: L0.rect.w - 2, h: 1}, vest, k.areas[L0.area], BUNKER.door.junction, false);
  }

  // --- 3. Storeys 1-5 -------------------------------------------------------------------------------------------------------------
  const storeys: StoreyCarve[] = [];
  const lobbyAx = ax + Cr.laneA * 2 + 1 + 1, lobbyBx = bx - 1 - BUNKER.lobby;
  const yA = cy0, yB = cy0 + f.dyB, sy0 = Math.max(yA, yB) + 2, sy1 = Math.min(yA, yB) + Cr.len - 2 - BUNKER.spine;
  if (sy1 < sy0) return fail('spine-span');
  for (let L = 1; L < BUNKER_LEVELS; L++) {
    const sf = f.storeys[L];
    const spineY = Math.round(sy0 + (sy1 - sy0) * sf.spine);
    const fp: Rect = {x: ax - sf.mw, y: Math.min(yA, yB) - sf.mn, w: 0, h: 0};
    fp.w = bx + Cr.laneB * 2 + 1 + sf.me - fp.x;
    fp.h = Math.max(yA, yB) + Cr.len + sf.ms - fp.y;
    if (fp.x < 1 || fp.y < 1 || fp.x + fp.w > W - 1 || fp.y + fp.h > H - 1) return fail(`footprint-${L}`);
    const landDoor = (c: CoreCarve, lobbyX: number, canonCoreX: number, wallX: number): Rect => {
      const l = c.landing[L], y = l.end === 'lo' ? l.rect.y + 1 : l.rect.y;
      void lobbyX; void canonCoreX;
      return {x: wallX, y, w: 1, h: 3};
    };
    // canonical skeleton (the planner works unmirrored; its rects are mirrored when carved)
    const sk: StoreySkeleton = {
      footprint: fp,
      coreA: {x: ax, y: yA, w: Cr.laneA * 2 + 1, h: Cr.len},
      lobbyA: {x: lobbyAx, y: yA, w: BUNKER.lobby, h: Cr.len},
      coreB: {x: bx, y: yB, w: Cr.laneB * 2 + 1, h: Cr.len},
      lobbyB: {x: lobbyBx, y: yB, w: BUNKER.lobby, h: Cr.len},
      spine: {x: lobbyAx + BUNKER.lobby + 1, y: spineY, w: lobbyBx - 1 - (lobbyAx + BUNKER.lobby + 1), h: BUNKER.spine},
      landingDoors: [landDoor(coreA, lobbyAx, ax, ax + Cr.laneA * 2 + 1), landDoor(coreB, lobbyBx, bx, bx - 1)],
    };
    // the landing rows are canvas rows (unmirrored in y): the doors' y already right; x canonical as built above
    const plan = planStorey(L, sk, BUNKER_STOREY_PROGRAMMES[L], rng.fork(`plan-${L}`));
    if (!plan) return fail(`plan-${L}`);
    // carve: rooms (parents first: the plan lists the skeleton, then rooms in placement order), then the doors
    const area: Record<string, number> = {};
    const base = bases[L];
    for (const p of plan.rooms) {
      const rect = M(p.rect);
      if (!k.rectFree(rect, L)) return fail(`not-free-${L}-${p.key}`);
      const isLobby = p.key === 'muster' || p.key === 'lobbyB';
      const parent = p.key === 'muster' ? coreA.landing[L].area : p.key === 'lobbyB' ? coreB.landing[L].area : p.parent ? area[p.parent] : -1;
      if (parent === undefined) return fail(`parent-${L}-${p.key}`);
      const clear = isLobby ? C.lobby : p.clear;
      const label = isLobby ? `${p.key === 'muster' ? 'Main' : 'Service'} stair lobby · Level ${L}` : p.label;
      const a = k.addArea(rect, p.kind, p.type, r2(base + clear), parent, {...lvOpt(L), label, publicSpace: false});
      if (p.purpose) a.purpose = p.purpose;
      area[p.key] = a.id;
    }
    for (const d of plan.doors) {
      const A = k.areas[area[d.a]], B = k.areas[area[d.b]];
      if (!A || !B) return fail(`door-areas-${L}`);
      k.carveDoor(M(d.gap), A, B, d.height, d.arch);
    }
    // the landing doors: lobby -> landing (cells join the landing)
    for (const [c, key, gap] of [[coreA, 'muster', sk.landingDoors[0]], [coreB, 'lobbyB', sk.landingDoors[1]]] as const) {
      k.carveDoor(M(gap), k.areas[area[key]], k.areas[c.landing[L].area], BUNKER.door.landing, false);
      c.lobby[L] = area[key];
    }
    storeys.push({level: L, plan, footprint: M(fp), area});
  }
  const stationRect = M({x: Math.min(hallC.x, vestC.x, cv.px0) - 1, y: bedY, w: Math.max(hallC.x + hallC.w, vestC.x + vestC.w, cv.px0 + f.Lp) - Math.min(hallC.x, vestC.x, cv.px0) + 2, h: cy0 - bedY});
  return {f, W, H, bed, trench, platform, hall, vest, booth, office, openings, bulkhead, cores, storeys, stationRect};
}

/**
 * One scissor core over storeys from..to (landing of storey `from` at end `end0`, alternating): landings (full core width, the storey's
 * floor), one run per storey pair in alternating lanes (lane 0 = the low-x lane of the CANONICAL frame: mirrored, the high-x one).
 */
function carveCore(k: Kit, id: 'A' | 'B', rect: Rect, laneW: number, from: number, to: number, end0: 'lo' | 'hi', mirror: boolean): CoreCarve {
  const Cr = BUNKER.core, bases = BUNKER_BASES;
  const out: CoreCarve = {id, rect, from, to, landing: {}, runs: [], lobby: {}};
  const endOf = (L: number): 'lo' | 'hi' => (((L - from) % 2 === 0) === (end0 === 'lo') ? 'lo' : 'hi');
  const name = id === 'A' ? 'Main stair' : 'Service stair';
  for (let L = from; L <= to; L++) {
    const end = endOf(L);
    const lr: Rect = {x: rect.x, y: end === 'lo' ? rect.y : rect.y + rect.h - Cr.landing, w: rect.w, h: Cr.landing};
    const a = k.addArea(lr, 'room', 'stair-core', r2(bases[L] + 3.2), -1, {...(L ? {level: L, floorY: bases[L]} : {}), role: 'landing', publicSpace: false, label: `${name} · ${BUNKER_STOREY_LABELS[L].replace(/ — .*$/, '')}`});
    out.landing[L] = {area: a.id, rect: lr, end};
  }
  for (let L = from; L < to; L++) {
    const lane = (L - from) % 2;
    const li = mirror ? 1 - lane : lane;
    const rr: Rect = {x: rect.x + li * (laneW + 1), y: rect.y + Cr.landing, w: laneW, h: rect.h - 2 * Cr.landing};
    const area = k.addArea(rr, 'room', 'stair-core', r2(bases[L] + STAIR.headroom), out.landing[L].area, {
      ...(L ? {level: L, floorY: bases[L]} : {}), also: [L + 1], role: 'stair', publicSpace: false, label: `${name} · ${BUNKER_STOREY_LABELS[L].replace(/ — .*$/, '')} – ${BUNKER_STOREY_LABELS[L + 1].replace(/ — .*$/, '')}`,
    });
    const fl: StairFlight[] = layStairRun([k.grid(L), k.grid(L + 1)], rr, area.id, 'z', endOf(L), bases[L], bases[L + 1], STAIR);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
    out.runs.push({upper: L, area: area.id, rect: rr, flights: ids});
  }
  return out;
}
