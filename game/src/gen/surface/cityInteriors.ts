// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's ENTERABLE BUILDINGS — the street doorways GEN plans in
// each destination's facade ring (exposed sides only: a party wall never gets a door), the interior planner call per building
// (gen/surface/rooms: lane ROOMS; building-id order, one forked stream each), the kept doorways carved into the street grid, and the merge
// of every plan into the district layout.
//
// Door states: the interior planner's (lane ROOMS: an intact building's doors shut, a damaged one's sometimes smashed / boarded, a gutted
// one's smashed); GEN only guarantees that every enterable building keeps at least one passable doorway (all boarded -> its main one
// becomes 'closed') and that a doorway's head stays under the storey's ceiling.

import type {Rng} from '../../core/rng';
import {FLOOR} from '../grid';
import type {Kit} from '../stationKit';
import type {LightPlacement, PickupPlacement, Side, SignPlacement, ZombieSpawn} from '../stationTypes';
import type {PropPlacement} from '../props';
import type {LevelLink} from '../levels';
import type {SurfaceBuilding, SurfaceDepotFeatures, SurfaceEntrance, SurfaceRecoverable, SurfaceWindowSpan} from './surfaceTypes';
import type {InteriorFloor, InteriorPlan, InteriorPlanner, PlannedEntrance} from './rooms/api';
import {crH, crW, type CR} from './cityFrame';
import {KERB, SLAB, type BuildingPlan} from './cityBlocks';
import {G, type GroundMap} from './cityCarve';

/** Street doorway widths (cells) per programme: [main, side] (lane ROOMS' programme table: door / service clear widths). */
const DOOR_W: Record<string, readonly [number, number]> = {
  grocery: [6, 3], hardware: [6, 3], 'strip-centre': [8, 4], arcade: [8, 4], 'office-block': [6, 3], police: [6, 3], 'fire-station': [6, 3],
  clinic: [6, 3], 'rail-depot': [12, 3],
};
const doorW = (programme: string): readonly [number, number] => DOOR_W[programme] ?? [4, 3];
/** Clear head height of a street doorway above its floor (m; the planner may lower it). */
const DOOR_H = {main: 2.6, side: 2.3, depot: 4.2} as const;
/** The depot's loading-bay door (cells). */
const LOADING_DOOR = 10;

/** The floors a building's interior planner carves (absolute y; ceilings below the next slab / the roof). */
export function floorsOf(b: BuildingPlan): InteriorFloor[] {
  const out: InteriorFloor[] = [];
  let y = KERB;
  for (let k = 0; k < b.walk; k++) {
    const h = b.storeys[k] ?? 3.6;
    out.push({level: k, y: Math.round(y * 1000) / 1000, ceil: Math.round((y + h - SLAB) * 1000) / 1000});
    y += h;
  }
  return out;
}

/** Height of the facade top (m above the street: every storey + the parapet). */
export const heightOf = (b: BuildingPlan): number => Math.round((KERB + b.storeys.reduce((s, h) => s + h, 0) + b.parapet) * 100) / 100;
/** Absolute y of the roof surface (the top of the last storey). */
export const roofOf = (b: BuildingPlan): number => Math.round((KERB + b.storeys.reduce((s, h) => s + h, 0)) * 100) / 100;

type RingCell = {x: number; y: number; ox: number; oy: number};

/** The ring cells of a side (corners excluded) and the outside neighbour of each. */
export function sideCells(r: CR, s: Side): RingCell[] {
  const out: RingCell[] = [];
  if (s === 'N' || s === 'S') {
    const y = s === 'N' ? r.y0 : r.y1 - 1, oy = s === 'N' ? r.y0 - 1 : r.y1;
    for (let x = r.x0 + 1; x < r.x1 - 1; x++) out.push({x, y, ox: x, oy});
  } else {
    const x = s === 'W' ? r.x0 : r.x1 - 1, ox = s === 'W' ? r.x0 - 1 : r.x1;
    for (let y = r.y0 + 1; y < r.y1 - 1; y++) out.push({x, y, ox, oy: y});
  }
  return out;
}

/** Open street-level ground a doorway may face: at least this deep (cells) straight out from the facade. */
const FRONT_DEPTH = 4;

/**
 * Runs of a side's ring cells whose outside is open street-level ground (an outdoor area at sidewalk / grade height) at least
 * FRONT_DEPTH cells deep straight out (no doorway onto a sliver behind the tent / a neighbour).
 */
export function exposedRuns(kit: Kit, gm: GroundMap, outdoor: ReadonlySet<number>, r: CR, s: Side): RingCell[][] {
  const g = kit.g;
  const runs: RingCell[][] = [];
  let cur: RingCell[] = [];
  const dx = s === 'W' ? -1 : s === 'E' ? 1 : 0, dy = s === 'N' ? -1 : s === 'S' ? 1 : 0;
  for (const c of sideCells(r, s)) {
    let ok = true;
    for (let k = 0; k < FRONT_DEPTH && ok; k++) {
      const x = c.ox + dx * k, y = c.oy + dy * k;
      if (!g.inBounds(x, y)) { ok = false; break; }
      const i = g.idx(x, y);
      ok = g.cells[i] === FLOOR && outdoor.has(g.area[i]) && gm.cls[i] !== G.none && g.rampIdx[i] < 0 && g.floor[i] > -0.01 && g.floor[i] < KERB + 0.01;
    }
    if (ok) cur.push(c);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Facade sides with any exposure (LOOK: party walls are the others). */
export function exposedSides(kit: Kit, gm: GroundMap, outdoor: ReadonlySet<number>, r: CR): Side[] {
  return (['N', 'S', 'W', 'E'] as const).filter(s => exposedRuns(kit, gm, outdoor, r, s).some(q => q.length >= 3));
}

interface DoorPlan { pe: PlannedEntrance; height: number }

/** The depot's doorway plan: the track door on the spur side at the track, the loading door on the loading yard's side. */
export interface DepotDoors { id: number; trackSide: Side; trackV: number; loadSide: Side }

/** Plans a building's street doorways (main on the frontage when exposed, side / service doors on other exposed sides). */
function planDoors(kit: Kit, gm: GroundMap, outdoor: ReadonlySet<number>, b: BuildingPlan, rng: Rng, depot?: DepotDoors): DoorPlan[] {
  const g = kit.g;
  const out: DoorPlan[] = [];
  const taken: {s: Side; a: number; b: number}[] = [];
  const [mainW, sideW] = doorW(b.programme);
  const along = (s: Side, c: {x: number; y: number}) => (s === 'N' || s === 'S' ? c.x : c.y);
  const tryDoor = (s: Side, w: number, main: boolean, where: number | 'centre' | 'rand', height: number): boolean => {
    const runs = exposedRuns(kit, gm, outdoor, b.r, s).filter(q => q.length >= w + 2);
    if (!runs.length) return false;
    const run = runs.reduce((m, q) => (q.length > m.length ? q : m));
    const n = run.length;
    let k0: number;
    if (typeof where === 'number') {
      k0 = run.findIndex(c => along(s, c) >= where - Math.floor(w / 2));
      if (k0 < 0) k0 = n - 1 - w;
    } else if (where === 'centre') k0 = Math.floor((n - w) / 2) + rng.int(-Math.floor(n * 0.12), Math.floor(n * 0.12));
    else k0 = rng.int(1, Math.max(1, n - w - 1));
    k0 = Math.max(1, Math.min(n - w - 1, k0));
    const cells = run.slice(k0, k0 + w);
    const a = along(s, cells[0]), z = along(s, cells[cells.length - 1]);
    if (taken.some(t => t.s === s && a <= t.b + 4 && t.a <= z + 4)) return false;
    // the outside is one surface (no doorway half onto a kerb edge)
    const os = cells.map(c => g.idx(c.ox, c.oy));
    const f0 = g.floor[os[0]];
    if (os.some(i => Math.abs(g.floor[i] - f0) > 0.01)) return false;
    taken.push({s, a, b: z});
    const mid = os[Math.floor(os.length / 2)];
    out.push({pe: {side: s, cells: cells.map(c => ({x: c.x, y: c.y})), main, outer: g.area[mid]}, height});
    return true;
  };
  const sides = (['N', 'S', 'W', 'E'] as const).filter(s => exposedRuns(kit, gm, outdoor, b.r, s).some(q => q.length >= 5));
  if (depot) {
    tryDoor(depot.trackSide, mainW, true, depot.trackV, DOOR_H.depot);
    tryDoor(depot.loadSide, LOADING_DOOR, false, 'centre', DOOR_H.depot);
    for (const s of rng.shuffle(sides.filter(q => q !== depot.trackSide && q !== depot.loadSide))) if (tryDoor(s, sideW, false, 'rand', DOOR_H.side)) break;
    if (!out.length) for (const s of sides) if (tryDoor(s, sideW, true, 'centre', DOOR_H.side)) break;
    return out;
  }
  const front = sides.includes(b.frontage) ? b.frontage : sides[0];
  if (front && !tryDoor(front, mainW, true, 'centre', DOOR_H.main)) tryDoor(front, sideW, true, 'centre', DOOR_H.main);
  // a wide centre gets a second main door on its frontage
  if (front && b.kind === 'centre' && crW(b.r) * crH(b.r) > 2400) tryDoor(front, mainW, true, 'rand', DOOR_H.main);
  const pSide = b.kind === 'centre' ? 0.8 : b.kind === 'office' || b.kind === 'civic' ? 0.6 : 0.55;
  let extra = 0;
  for (const s of rng.shuffle(sides.filter(q => q !== front))) {
    if (extra >= 2) break;
    if (rng.chance(pSide) && tryDoor(s, sideW, false, 'rand', DOOR_H.side)) extra++;
  }
  if (!out.length) for (const s of sides) if (tryDoor(s, sideW, true, 'centre', DOOR_H.main)) break;
  return out;
}

export interface InteriorsOut {
  lights: LightPlacement[];
  signs: SignPlacement[];
  pickups: PickupPlacement[];
  zombies: ZombieSpawn[];
  windows: SurfaceWindowSpan[];
  links: LevelLink[];
  recoverables: SurfaceRecoverable[] | null;
  /** (lane ROOMS) the depot plan's `features.depot` (its shed's tracks / pit / crane / dolly lanes), null when it gave none. */
  depotFeatures: SurfaceDepotFeatures | null;
  /** Interior enemies per building id (the map notes). */
  enemies: Map<number, number>;
  /** Planner time (ms; QA). */
  ms: number;
}

const VALID_DOORS: ReadonlySet<string> = new Set(['closed', 'open', 'smashed', 'boarded']);

/**
 * Runs the interior planner for every enterable building (building-id order) and writes its results into `rec` (the SurfaceBuilding
 * records, by id), `props` (the district's prop list: a plan's plan-local `host` indices are rebased onto it) and the returned lists.
 * `outdoor`: every outdoor area id. Host buildings / the tent / the headhouse are GEN's own. Kept doorways go into kit.doors.
 */
export function planInteriors(kit: Kit, gm: GroundMap, outdoor: ReadonlySet<number>, plans: BuildingPlan[], rec: SurfaceBuilding[], rng: Rng, planner: InteriorPlanner,
  depot: DepotDoors, props: PropPlacement[]): InteriorsOut {
  const out: InteriorsOut = {lights: [], signs: [], pickups: [], zombies: [], windows: [], links: [], recoverables: null, depotFeatures: null, enemies: new Map(), ms: 0};
  const g = kit.g;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  for (const b of plans) {
    if (!b.destination || b.walk <= 0 || b.host) continue;
    const brng = rng.fork(`interior-${b.id}`);
    const doors = planDoors(kit, gm, outdoor, b, rng.fork(`doors-${b.id}`), b.id === depot.id ? depot : undefined);
    if (!doors.length) { rec[b.id].enterable = false; rec[b.id].destination = false; continue; }
    const t0 = now();
    const plan: InteriorPlan = planner({kit, building: rec[b.id], rect: {x: b.r.x0, y: b.r.y0, w: crW(b.r), h: crH(b.r)}, floors: floorsOf(b), entrances: doors.map(d => d.pe), rng: brng,
      firstArea: kit.areas.length});
    out.ms += now() - t0;
    // entrances: the planner's door state (GEN: >= 1 passable); kept ones carved into the street grid (a boarded doorway stays SOLID)
    const ents: {e: SurfaceEntrance; dp: DoorPlan}[] = [];
    for (const e of plan.entrances) {
      const dp = doors.find(d => d.pe.cells.some(c => e.cells.includes(g.idx(c.x, c.y))));
      if (!dp) continue; // not one of GEN's doorways (the planner cuts no other facade cell)
      const height = Math.max(2.0, Math.min(e.height > 0 ? e.height : dp.height, dp.height));
      ents.push({e: {...e, building: b.id, level: 0, height, door: VALID_DOORS.has(e.door) ? e.door : 'closed'}, dp});
    }
    if (ents.length && ents.every(q => q.e.door === 'boarded')) (ents.find(q => q.dp.pe.main) ?? ents[0]).e.door = 'closed';
    for (const {e, dp} of ents) {
      if (e.door === 'boarded') continue;
      const cs = dp.pe.cells;
      for (const c of cs) {
        const i = g.idx(c.x, c.y);
        g.cells[i] = FLOOR; g.area[i] = e.inner; g.floor[i] = KERB; g.ceil[i] = KERB + e.height;
      }
      const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      e.doorIndex = kit.doors.length;
      kit.doors.push({x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1, id: kit.doors.length, a: e.outer, b: e.inner, height: e.height, arch: false});
    }
    // the plan's records (prop host indices are plan-local: rebased onto the district's prop list)
    const base = props.length;
    for (const p of plan.props) props.push(p.host !== undefined ? {...p, host: p.host + base} : p);
    out.lights.push(...plan.lights);
    out.signs.push(...plan.signs);
    out.pickups.push(...plan.pickups);
    out.zombies.push(...plan.zombies);
    out.enemies.set(b.id, plan.zombies.length);
    for (const w of plan.windows) out.windows.push({...w, building: b.id});
    out.links.push(...plan.links);
    const r = rec[b.id];
    r.areas = [...plan.areas];
    r.levels = [...new Set(plan.areas.map(a => kit.areas[a]?.level ?? 0))].sort((p, q) => p - q);
    r.entrances = ents.map(q => q.e);
    r.windows = plan.windows.map(w => w.id);
    r.enterable = r.entrances.some(e => e.door !== 'boarded') && plan.areas.length > 0;
    if (!r.enterable) r.destination = false;
    if (b.id === depot.id) out.recoverables = plan.recoverables?.length ? plan.recoverables : null;
    // (lane ROOMS) the depot's shed gear for LOOK (InteriorPlan.features.depot: pure data, world metres, this layout's ids)
    if (b.id === depot.id) out.depotFeatures = (plan.features?.depot as SurfaceDepotFeatures | undefined) ?? null;
  }
  return out;
}
