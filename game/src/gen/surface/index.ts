// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's DISTRICT GENERATOR, `LEVELS[host].generate('surface',
// ctx)` (levels/registry.ts). Deterministic from the host station's level seed through surfaceSeed (gen/surface/surfaceRun.ts), never
// the host's streams; every stage draws from its own fork, each enterable building from its own (RNG-neutral across buildings).
//
// Stages (one Kit for the whole district: SURFACE_LEVELS = 2 level grids = the street + one upper storey):
//   1. frame     gen/surface/cityFrame.ts   the 8 x 8-block street grid: perimeter roads, two avenues through the core, quadrant
//                                           streets that jog at the avenues, named streets, junctions / segments
//   2. blocks    gen/surface/cityBlocks.ts  what stands on each block: the portal block's corner plaza (the checkpoint), the rail
//                                           depot (shed, yards, the spur to the cordon), core destination briefs (>= 2 centres,
//                                           >= 3 offices, >= 8 stores of >= 6 kinds, 0-2 civic), rows / parcels / lots, a sparse outer ring
//   3. ground    gen/surface/cityCarve.ts   junctions, segments, sidewalks (kerb 0.15 m), lots, driveways, the rail corridor
//   4. portal    gen/surface/checkpoint.ts  the host's portal (subway headhouse stair / host tower / host mall doors) and the tent
//   5. interiors gen/surface/cityInteriors.ts + rooms/ (lane ROOMS): street doorways, planInterior per building, door carving
//   6. outdoors  gen/surface/checkpoint.ts + outdoorDress.ts: the compound, blocked spans, ruin, roadblock, bus, wrecks, furniture
//   7. records   gen/surface/cityData.ts    streets / junctions / lots / spawn zones / map notes; levels, apertures, rails, stairs
//
// Outdoor placements of kinds lane KIT has not defined yet are planned but PENDING (gen/surface/outdoorKinds.ts): they hold their cells
// so the layout is the same either way, and are emitted unchanged once KIT's union line + defs are merged.

import {Rng} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import {Kit} from '../stationKit';
import type {Side, StationLayout} from '../stationTypes';
import type {PropPlacement} from '../props';
import type {Level, LevelLink} from '../levels';
import {deriveRails, registerApertures} from '../levelGen';
import type {StairFlight} from '../traversal';
import type {SectionGenContext} from '../../levels/types';
import {districtVersionOf, surfaceSeed, type SurfaceHost} from './surfaceRun';
import type {SRect, SurfaceBlock, SurfaceBuilding, SurfaceInfo, SurfaceRecoverable} from './surfaceTypes';
import type {InteriorPlanner} from './rooms/api';
import {planInterior} from './rooms/index';
import {BLOCKS, CORE_FROM, CORE_TO, FRAME_CELLS, planFrame, type CR, type CityFrame} from './cityFrame';
import {districtName} from './cityNames';
import {KERB, SLAB, SURFACE_LEVELS, guaranteeCounts, planBlocks, repairGuarantees, type BlockPlans, type BuildingPlan} from './cityBlocks';
import {SKY_CEIL, carveGround, type GroundMap} from './cityCarve';
import {PORTAL, carvePortal, dressCheckpoint, reserveCheckpoint} from './checkpoint';
import {exposedSides, floorsOf, heightOf, planInteriors, roofOf, type DepotDoors} from './cityInteriors';
import {OutdoorProps, type PlannedProp} from './outdoorKinds';
import {dressOutdoors, reserveFronts} from './outdoorDress';
import {districtNotes, junctionRecords, lotRecords, spawnZones, streetRecords} from './cityData';

/**
 * The district frame's numbers (metres unless noted). The original contract keys keep their meaning as NOMINAL values (the real frame is
 * seeded: read `layout.surface` for exact positions): `pitch` = the mean block pitch (block + one carriageway), `street` = a typical
 * street carriageway (kerb to kerb), `margin` = cordon wall band + the perimeter road's outer sidewalk, `sidewalk` = a typical sidewalk.
 * The ranges below are what the generator actually draws.
 */
export const SURFACE_FRAME = {
  blocks: BLOCKS, pitch: 64, street: 11.5, margin: (FRAME_CELLS.band + FRAME_CELLS.outerSW) * CELL, sidewalk: 3, coreFrom: CORE_FROM, coreTo: CORE_TO,
  cell: CELL,
  /** Kerb height of sidewalks / raised lots, slab between storeys, open-sky band top over outdoor cells. */
  kerb: KERB, slab: SLAB, skyCeil: SKY_CEIL,
  /** Walkable layout levels (the street + one upper storey; drawn storeys above them are closed). */
  levels: SURFACE_LEVELS,
  /** Carriageway kerb to kerb / each sidewalk. */
  avenue: {width: [18, 22], sidewalk: [3.5, 4]},
  streets: {width: [10, 13], sidewalk: [2.5, 3.5]},
  perimeter: {width: [10, 12], sidewalk: 3, outerSidewalk: FRAME_CELLS.outerSW * CELL},
  lane: {width: [5, 7]},
  /** Kerb-to-kerb block sizes: core / outer ring; the street jogs at the avenues. */
  coreBlock: [52, 60], outerBlock: [45, 51], jog: [3, 8],
  /** The cordon wall band (SOLID) outside the playable extent. */
  cordon: FRAME_CELLS.band * CELL,
  /**
   * Storey floor-to-floor heights: shop ground floors / other ground floors / upper storeys (district buildings: 1-6 drawn storeys). The
   * portal's host building is the exception: the Office host tower keeps its 12 storeys, the host mall its 5 m storeys.
   */
  storey: {shopGround: [4.3, 5.0], ground: [3.5, 5.0], upper: [3.5, 4.0]},
} as const;

/** The last generation's numbers (QA / the lane report). */
export const SURFACE_GEN_STATS = {
  ms: 0, interiorMs: 0, w: 0, h: 0, levels: 0, bytesPerStorey: 0, gridBytes: 0, props: 0, planned: 0, pending: {} as Record<string, number>,
  counts: {} as Record<string, number>, buildings: 0, enterable: 0, areas: 0,
};

/** Test / QA seam: keep each layout's generation records (the frame, plans, every planned outdoor prop incl. pending ones). Off by default. */
export interface SurfaceGenDebug {
  frame: CityFrame;
  plans: BlockPlans;
  ground: GroundMap;
  planned: PlannedProp[];
  /** Street-level cells held by a placed / pending prop or a mound. */
  taken: Uint8Array;
  compoundArea: number;
  /** Checkpoint placements that did not fit (kind, position, reason). */
  misses: {kind: string; x: number; z: number; role: string; why: string}[];
}
const DEBUG = new WeakMap<StationLayout, SurfaceGenDebug>();
let keepDebug = false;
export function setSurfaceGenDebug(on: boolean): void { keepDebug = on; }
export const surfaceGenDebug = (layout: StationLayout): SurfaceGenDebug | undefined => DEBUG.get(layout);

const toM = (r: CR): SRect => ({x0: r.x0 * CELL, z0: r.y0 * CELL, x1: r.x1 * CELL, z1: r.y1 * CELL});
const RECOVERABLE_KINDS = ['radar', 'sentry', 'scanner', 'chest', 'armor'] as const;
const YAW: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};

function buildingRecord(b: BuildingPlan, kit: Kit, gm: GroundMap, outdoor: ReadonlySet<number>): SurfaceBuilding {
  return {
    id: b.id, block: b.block, kind: b.kind, programme: b.programme, name: b.name, footprint: toM(b.r), storeys: b.storeys.length, height: heightOf(b), facade: b.facade,
    condition: b.condition, enterable: false, destination: b.destination, levels: [], areas: [], entrances: [], windows: [],
    storeyHeights: [...b.storeys], parapet: b.parapet, roofY: roofOf(b), frontage: b.frontage, exposed: exposedSides(kit, gm, outdoor, b.r),
    ...(b.host ? {host: b.host} : {}),
  };
}

/** Stair flights: the Kit's (the planner registers its own) plus any stray ramp rebuilt from its record. */
function flightsOf(kit: Kit, grids: readonly Grid[]): StairFlight[] {
  const out = kit.flights;
  const have = new Set(out.map(f => f.ramp));
  kit.g.ramps.forEach((R, k) => {
    if (have.has(k)) return;
    const g = grids.find(q => q.rampIdx[q.idx(R.x, R.y)] === k) ?? kit.g;
    const a0 = (R.axis === 'x' ? R.y : R.x) * CELL, a1 = a0 + (R.axis === 'x' ? R.h : R.w) * CELL, ac = (a0 + a1) / 2;
    const sgn = Math.sign(R.s1 - R.s0) || 1;
    const at = (s: number, y: number) => (R.axis === 'x' ? {x: s, y, z: ac} : {x: ac, y, z: s});
    const start = at(R.s0 - sgn * 0.45, R.h0), end = at(R.s1 + sgn * 0.45, R.h1);
    const [top, bottom] = R.h0 >= R.h1 ? [start, end] : [end, start];
    out.push({id: out.length, area: g.area[g.idx(R.x, R.y)], ramp: k, axis: R.axis, s0: R.s0, s1: R.s1, h0: R.h0, h1: R.h1, a0, a1, risers: R.risers,
      riser: Math.abs(R.h1 - R.h0) / Math.max(1, R.risers), tread: Math.abs(R.s1 - R.s0) / Math.max(1, R.risers), headroom: R.headroom, top, bottom});
  });
  out.forEach((f, i) => { f.id = i; });
  return out;
}

/** Fallback recoverables when the planner returned none: spread along the depot's largest street-level room (walkable cells). */
function fallbackRecoverables(kit: Kit, rec: SurfaceBuilding): SurfaceRecoverable[] {
  const g = kit.g;
  const a = rec.areas.map(id => kit.areas[id]).filter(q => q && (q.level ?? 0) === 0).sort((p, q) => q.w * q.h - p.w * p.h)[0];
  if (!a) return [];
  const out: SurfaceRecoverable[] = [];
  const alongX = a.w >= a.h;
  for (let k = 0; k < RECOVERABLE_KINDS.length; k++) {
    const t = (k + 1) / (RECOVERABLE_KINDS.length + 1);
    let best: {x: number; y: number} | null = null;
    for (let d = 0; d < 12 && !best; d++) for (const s of [1, -1]) {
      const cx = alongX ? a.x + Math.floor(a.w * t) : a.x + Math.floor(a.w / 2) + s * d;
      const cy = alongX ? a.y + Math.floor(a.h / 2) + s * d : a.y + Math.floor(a.h * t);
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i] && g.rampIdx[i] < 0) { best = {x: cx, y: cy}; break; }
    }
    if (best) out.push({kind: RECOVERABLE_KINDS[k], pose: {x: (best.x + 0.5) * CELL, z: (best.y + 0.5) * CELL, yaw: alongX ? YAW.S : YAW.E, level: 0, y: g.floor[g.idx(best.x, best.y)]}});
  }
  return out;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export function generateSurfaceDistrict(host: SurfaceHost, ctx: SectionGenContext, planner: InteriorPlanner = planInterior): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = surfaceSeed(ctx.levelSeed);
  const rng = new Rng(seed);
  // (task studio-surface-run-field-followup-20261116-211729-01) the district's version = its host's record (1 when absent): every v2 stage
  // is gated on surfaceFeatures(version) and a v1 district stays byte-identical (tests/surface-v1-compat.test.ts)
  const version = districtVersionOf(ctx.surfaceVersion);

  // --- 1-2. frame and block plans ---------------------------------------------------------------------------------------------
  const f = planFrame(rng.fork('frame'));
  const dn = districtName(rng.fork('district-name'));
  const plans = planBlocks(rng.fork('blocks'), f, host, dn.root);
  repairGuarantees(rng.fork('repair'), f, plans, dn.root);

  // --- 3-4. the ground, the portal and the tent -------------------------------------------------------------------------------
  const kit = new Kit(rng.fork('kit'), {w: f.W, h: f.H, levels: SURFACE_LEVELS});
  const gm = carveGround(kit, f, plans);
  const outdoor = new Set(gm.outdoor);
  const compoundLot = plans.lots.find(l => l.use === 'compound')!;
  const compoundArea = [...gm.lotOfArea].find(([, l]) => l === compoundLot)![0];
  const pc = carvePortal(kit, f, plans, gm, host, rng.fork('portal'), dn.root);
  const portalDoor: number[] = [];
  for (const d of pc.doors) { d.id = kit.doors.length; portalDoor.push(d.id); kit.doors.push(d); }
  if (pc.head) for (const fl of pc.head.flights) { fl.id = kit.flights.length; kit.flights.push(fl); }

  // --- 5. building records, the interiors ---------------------------------------------------------------------------------------
  const rec = plans.buildings.map(b => buildingRecord(b, kit, gm, outdoor));
  const D = f.blocks[plans.depot];
  const depotPlan = plans.buildings.find(b => b.block === D.id && b.kind === 'depot')!;
  const loadLot = plans.lots.find(l => l.block === D.id && l.use === 'loading')!;
  const s = depotPlan.r, L = loadLot.r;
  const loadSide: Side = L.y0 >= s.y1 ? 'S' : L.y1 <= s.y0 ? 'N' : L.x0 >= s.x1 ? 'E' : 'W';
  const depotDoors: DepotDoors = {id: depotPlan.id, trackSide: plans.spur.dir, trackV: plans.spur.v, loadSide};
  const props: PropPlacement[] = [];
  const inner = planInteriors(kit, gm, outdoor, plans.buildings, rec, rng.fork('interiors'), planner, depotDoors, props);
  // the command tent and the headhouse: GEN's own small interiors
  const tentRec = rec[pc.tent.plan.id];
  const tentDoor = kit.doors[portalDoor[portalDoor.length - 1]];
  tentRec.areas = [pc.tent.area]; tentRec.levels = [0]; tentRec.enterable = true;
  tentRec.entrances = [{id: `b${tentRec.id}-e0`, building: tentRec.id, level: 0, x: pc.tent.door.x, z: pc.tent.door.z, side: pc.tent.door.side, width: PORTAL.tent.door * CELL,
    height: PORTAL.tent.doorH, inner: pc.tent.area, outer: compoundArea, door: 'open', cells: pc.tent.doorCells, doorIndex: tentDoor.id}];
  if (pc.head) {
    const hr = rec[pc.head.plan.id], md = kit.doors[portalDoor[0]];
    const cells: number[] = [];
    for (let y = md.y; y < md.y + md.h; y++) for (let x = md.x; x < md.x + md.w; x++) cells.push(kit.g.idx(x, y));
    const side: Side = md.w === 1 ? (md.x === pc.head.plan.r.x0 ? 'W' : 'E') : (md.y === pc.head.plan.r.y0 ? 'N' : 'S');
    hr.areas = [pc.head.area]; hr.levels = [0]; hr.enterable = true;
    hr.entrances = [{id: `b${hr.id}-e0`, building: hr.id, level: 0, x: (md.x + md.w / 2) * CELL, z: (md.y + md.h / 2) * CELL, side, width: Math.max(md.w, md.h) * CELL, height: md.height,
      inner: pc.head.area, outer: compoundArea, door: 'smashed', cells, doorIndex: md.id}];
  }
  const depotRec = rec[depotPlan.id];
  const recoverables = inner.recoverables ?? fallbackRecoverables(kit, depotRec);

  // --- 6. outdoors: reserves, the compound, the deliberate ruin and the street dressing ------------------------------------------
  const op = new OutdoorProps(kit.g, props, outdoor);
  reserveCheckpoint(op, pc, host);
  const doorways: {cells: readonly number[]; side: Side}[] = rec.flatMap(r => r.entrances.filter(e => e.door !== 'boarded').map(e => ({cells: e.cells, side: e.side})));
  reserveFronts({kit, gm, plans, op}, doorways);
  const cd = dressCheckpoint(op, kit, pc, host, compoundArea, rng.fork('checkpoint-supply'));
  const streets = streetRecords(f, plans);
  const dress = dressOutdoors({kit, f, gm, plans, op, rng: rng.fork('outdoors'), safe: cd.safe, streetOfSegment: f.segments.map(q => q.id)});
  for (const [seg, rs] of dress.blocked) streets[seg].blocked = rs;
  for (const [id, c] of dress.collapse) {
    const b = plans.buildings[id];
    const x0 = c.corner[1] === 'W' ? b.r.x0 : b.r.x1 - c.w, y0 = c.corner[0] === 'N' ? b.r.y0 : b.r.y1 - c.d;
    rec[id].collapse = {corner: c.corner, rect: toM({x0, y0, x1: x0 + c.w, y1: y0 + c.d})};
  }

  // --- 7. levels, apertures, rails, stairs, links -------------------------------------------------------------------------------
  const grids = kit.levelGrids;
  let nLevels = grids.length;
  while (nLevels > 1 && !grids[nLevels - 1].cells.some(c => c !== 0)) nLevels--;
  const baseY = (k: number): number => {
    if (k === 0) return 0;
    const ys: number[] = [];
    for (const b of plans.buildings) if (rec[b.id].levels.includes(k)) { const fl = floorsOf(b)[k]; if (fl) ys.push(fl.y); }
    const m = median(ys);
    return Number.isFinite(m) ? m : Math.round((KERB + 4.6 * k) * 100) / 100;
  };
  const levels: Level[] = grids.slice(0, nLevels).map((grid, id) => ({id, role: id === 0 ? 'main' : 'office', grid, baseY: baseY(id)}));
  registerApertures(levels);
  const rails = deriveRails(levels);
  const flights = flightsOf(kit, grids.slice(0, nLevels));
  const links: LevelLink[] = inner.links.filter(l => l.lower < nLevels && l.upper < nLevels);
  links.forEach((l, i) => { l.id = i; });

  // --- area moods: outdoors in daylight (LOOK's sky), the tent lit, the headhouse stair dim (interiors: the planner's own) ----------
  for (const id of gm.outdoor) kit.areas[id].lighting = 'lit';
  kit.areas[pc.tent.area].lighting = 'lit';
  if (pc.head) kit.areas[pc.head.area].lighting = 'dim';

  // --- the surface record ------------------------------------------------------------------------------------------------------
  const blocks: SurfaceBlock[] = f.blocks.map(b => ({id: b.id, col: b.col, row: b.row, rect: toM(b.kerb), core: b.core, buildings: plans.buildings.filter(q => q.block === b.id).map(q => q.id), lot: toM(b.lot)}));
  const coreBlocks = f.blocks.filter(b => b.core);
  const core: SRect = {x0: Math.min(...coreBlocks.map(b => b.kerb.x0)) * CELL, z0: Math.min(...coreBlocks.map(b => b.kerb.y0)) * CELL,
    x1: Math.max(...coreBlocks.map(b => b.kerb.x1)) * CELL, z1: Math.max(...coreBlocks.map(b => b.kerb.y1)) * CELL};
  const windows = inner.windows;
  const yard = plans.lots.find(l => l.block === D.id && l.use === 'loading') ?? plans.lots.find(l => l.block === D.id && l.use === 'yard');
  const tentM = toM(pc.tent.rect);
  const notes = districtNotes(rng.fork('notes'), {buildings: rec, depot: depotPlan.id, tent: tentM, yard: yard ? toM(yard.r) : null, rubble: dress.rubble, streets,
    roadblock: dress.roadblock?.rect ?? null, enemies: inner.enemies, checkpoint: {x: (tentM.x0 + tentM.x1) / 2, z: (tentM.z0 + tentM.z1) / 2}});
  const storeys = levels.map(L => ({level: L.id, label: L.id === 0 ? 'Street' : L.id === 1 ? 'Upper floor' : 'Top floor', y: L.baseY}));
  const surface: SurfaceInfo = {
    v: version as SurfaceInfo['v'], name: dn.name, host, seed, extent: toM(f.ext), core, cols: BLOCKS, rows: BLOCKS, blocks, streets, buildings: rec, windows, outdoorAreas: [...gm.outdoor],
    portal: pc.portal, checkpoint: cd.checkpoint, truck: cd.truck,
    depot: {building: depotPlan.id, recoverables, ...(inner.depotFeatures ? {features: inner.depotFeatures} : {})}, // (+ features: lane ROOMS, for LOOK)
    outdoor: {areas: [...gm.outdoor], spawnZones: spawnZones(f, plans, cd.safe), safe: cd.safe}, notes, storeys,
    lots: lotRecords(plans, gm), junctions: junctionRecords(f, gm), rubble: dress.rubble, rail: {rects: gm.rail.map(toM), dir: plans.spur.dir, centre: (plans.spur.v + 0.5) * CELL},
    ...(dress.roadblock ? {roadblock: dress.roadblock.rect} : {}), cordon: {x0: 0, z0: 0, x1: f.W * CELL, z1: f.H * CELL},
  };

  const g0 = kit.g;
  const layout: StationLayout = {
    seed, attempt: 0, name: dn.name, archetype: 'side-mezzanine', towards: ['', ''], grid: g0, areas: kit.areas, doors: kit.doors, props,
    // (the checkpoint's guaranteed mask + spare filter first: their pickup indices never move with the interiors)
    lights: [...inner.lights, ...cd.lights], signs: inner.signs, pickups: [...cd.pickups, ...inner.pickups], zombies: inner.zombies, storefronts: [], decor: [],
    playerSpawn: {x: pc.portal.pose.x, z: pc.portal.pose.z, yaw: pc.portal.pose.yaw},
    trench: {x0: 0, x1: 0, z0: 0, z1: 0, floorY: 0, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0}, trenches: [],
    platform: compoundArea, platforms: [compoundArea], traversal: {stairs: flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails,
    surface,
  };

  // --- stats / debug -----------------------------------------------------------------------------------------------------------
  const bytes = (g: Grid) => g.cells.byteLength + g.area.byteLength + g.blocked.byteLength + g.sightBlocked.byteLength + g.ceil.byteLength + g.floor.byteLength + g.rampIdx.byteLength;
  const pending: Record<string, number> = {};
  for (const p of op.planned) if (p.index < 0) pending[p.kind] = (pending[p.kind] ?? 0) + 1;
  const counts = {...dress.counts, ...guaranteeCounts(rec)} as Record<string, number>;
  Object.assign(SURFACE_GEN_STATS, {
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10, interiorMs: Math.round(inner.ms * 10) / 10, w: f.W, h: f.H,
    levels: nLevels, bytesPerStorey: bytes(g0), gridBytes: levels.reduce((sum, L) => sum + bytes(L.grid), 0), props: props.length, planned: op.planned.length, pending, counts,
    buildings: rec.length, enterable: rec.filter(r => r.enterable).length, areas: kit.areas.length,
  });
  if (keepDebug) DEBUG.set(layout, {frame: f, plans, ground: gm, planned: op.planned, taken: op.taken, compoundArea, misses: op.missLog});
  return layout;
}

/** The district's walkable area ids on the street level that are outdoors (re-exported for the runtime lanes' convenience). */
export const outdoorAreaSet = (layout: StationLayout): ReadonlySet<number> => new Set(layout.surface?.outdoorAreas ?? []);
