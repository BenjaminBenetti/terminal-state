// Seamless Office Space (lane GEN): the WHOLE office level as ONE continuous StationLayout — `generateOfficeLevel(ctx)`.
//
// levels[0] = the compact subway stop (role 'main', y 0); levels[1] = the tower lobby (role 'upper', y = hu ≈ 5.4-5.9) joined to it
// by the station's straight stair run; levels[2..8] = office floors 2..8 (role 'office', y = hu + 4.4 (n - 1)). levelId === floor
// for every tower storey; every grid has the same size / origin; the tower footprint, the SOLID elevator shaft and the scissor
// stairwell are at the same X/Z on every storey. Storeys are joined by a scissor stair (one straight run per storey pair in
// alternating lanes, each one LevelLink 'stairs'); the elevator is lane LIFT's moving cab in the solid shaft (layout.office v2).
// Deterministic from (ctx.levelSeed, ctx.startWeapon). Gear is NOT placed here (the level registry appends ctx.gear once).
//
// Pipeline (the station's own machinery wherever it fits): carve (Kit with 9 level grids: station + lobby, floors 2..8, scissor
// runs) → crop → storeys / stair links / apertures / rails / rescue ladders → office pre-dressing (every storey) → ONE
// stationDress.dress() → office post-dressing (every storey) → start → whole-level enemies / loose supplies / weapon finds (storey
// by storey) → applyLighting → landing lights → finishTraversal → enemy archetypes → window spans + daylight per storey →
// layout.office (OfficeTowerInfo v2) → validation (retry on issues).
//
// Task office-overhaul-20261030 (lane STRUCT): + levels[9] = the ROOF (role 'roof', open sky, deck at floor 8 + 4.4; gen/office/roof.ts)
// reached by the caged access ladder from floor 8's roof access closet through a ceiling hatch (a player-only climb: the AI graph
// never uses it); the station <-> lobby connection is the broad TRANSIT HALL (fixed stair + two stopped escalators on one pitch,
// gen/office/street.ts + transit.ts) instead of the single narrow stair core. Kit: 10 level grids.

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {Kit} from '../stationKit';
import type {Level, LevelLink} from '../levels';
import {deriveRails, levelDistance, registerApertures} from '../levelGen';
import {applyLighting, dress} from '../stationDress';
import {finishTraversal, placeLadders} from '../traversal';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import {spawnProfile, type SpawnProfile} from '../../ai/spawnTables'; // Task enemy-spawn-tables-20261030 (lane SPAWN)
import type {SectionGenContext} from '../../levels/types';
import type {Door, OfficePose, OfficeTowerInfo, StationLayout} from '../stationTypes';
import {CEIL, FLOOR_HEIGHT, MARGIN, OFFICE_FLOORS, OFFICE_ROOF_LEVEL, OFFICE_TOP_FLOOR, landingRect, officeSeed, towerFrame, type TowerFrame} from './frame';
import {OFFICE_CANVAS, TOWER_CANVAS, cropKit} from './common';
import {carveOfficeFloor, carveScissor, storeyLabel, type CarvedTower, type ScissorRun} from './tower';
import {carveStreet, type StreetCarve} from './street';
import {landingStrip, postDress, preDress, type OfficeDress} from './dress';
import {officeWeaponPlan, placeOfficeEnemies, placeOfficeSupplies, placeOfficeWeapons, type SpawnField} from './spawns';
import {lootProfile, type LootProfile} from '../../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)
import {addDaylight, windowSpans, type StoreyWindow} from './windows';
import {officeIssues} from './validate';
import {officeTenants} from './tenants'; // Task office-overhaul-20261030 (lane TENANTS)
// Task office-overhaul-20261030 (lane STRUCT): the roof storey and the transit hall.
import {carveRoof, dressRoof, roofCoreCells, roofDaylight, roofHold, roofInfo, roofLadder, roofSky, roofStrip, type RoofCarve} from './roof';
import {placeRoofFind, placeRoofReward} from './roof'; // Task office-interactions-layout-20261030 (lane ROOF): the roof reward cache (+ the roof find: gas-mask-roof-feedback-20261030)
import {holdCells, mouthZones, transitInfo, transitLinks, transitPreDress, transitRails, transitSigns} from './transit';

export {OFFICE_FLOORS, OFFICE_ROOF_LEVEL, OFFICE_SECTIONS, OFFICE_TOP_FLOOR, towerFrame, officeSeed} from './frame';
export {roofLadderPose} from './roof';
export {floorPlanPose} from './floorplan'; // Task office-interactions-layout-20261030 (lane LAYOUT): QA pose into a floor's arrangement
export {roofRewardPose} from './roof'; // Task office-interactions-layout-20261030 (lane ROOF): QA pose in front of the roof cache
export {transitPose} from './transit';
export {officeIssues} from './validate';
export {officeModelKeysFor} from './kinds';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 16;
/** Validation issues of rejected attempts (QA / tests: what the retry loop is absorbing). */
export const OFFICE_REJECTS = new Map<string, number>();
/** Timing of the last generateOfficeLevel call (ms) and its attempts (QA / tests). */
export const OFFICE_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The ONE continuous Office Space layout (station, lobby, office floors 2..8, the roof). Task loot-tables-20261030 (lane LOOT):
 * `loot` = the logical level's loot profile (default: the Office's) — one profile for every storey. Task enemy-spawn-tables-20261030
 * (lane SPAWN): `spawns` = the logical level's enemy spawn profile (default: the Office's; contexts street / floor / roof, ONE
 * profile and one generation for the whole level — no per-floor reroll); validation reads the same profile.
 */
export function generateOfficeLevel(ctx: SectionGenContext, loot: LootProfile = lootProfile('office'), spawns: SpawnProfile = spawnProfile('office')): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const f = towerFrame(ctx.levelSeed);
  const seed = officeSeed(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  OFFICE_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns);
    OFFICE_GEN_STATS.attempts = attempt + 1;
    if (!layout) { OFFICE_GEN_STATS.carveFails++; continue; }
    const issues = officeIssues(layout, f, spawns);
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) OFFICE_REJECTS.set(i, (OFFICE_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  OFFICE_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('office level generation failed');
}

/** One generation attempt (QA / tests: what the retry loop sees); null when the station program does not fit. */
export function officeAttempt(ctx: SectionGenContext, attempt: number, loot: LootProfile = lootProfile('office'), spawns: SpawnProfile = spawnProfile('office')): StationLayout | null {
  const seed = officeSeed(ctx.levelSeed);
  return tryLevel(towerFrame(ctx.levelSeed), attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, loot, spawns);
}

/** @deprecated The office is ONE section ('main'): use generateOfficeLevel. Kept while callers migrate. */
export function generateOfficeSection(_section: string, ctx: SectionGenContext): StationLayout {
  return generateOfficeLevel(ctx);
}

// ---------------------------------------------------------------------------------------------
// One attempt

function tryLevel(f: TowerFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: OFFICE_CANVAS.levels, w: OFFICE_CANVAS.w, h: OFFICE_CANVAS.h});
  const s = carveStreet(k, rng, f);
  if (!s) return null;
  const hu = s.hu;
  const TX = TOWER_CANVAS.x, TY = TOWER_CANVAS.y;
  /** Absolute floor of storey n (0 = the station's main level); [OFFICE_ROOF_LEVEL] = the roof deck. */
  const bases = [0, ...OFFICE_FLOORS.map(n => r3(hu + FLOOR_HEIGHT * (n - 1)))];
  const towers: CarvedTower[] = [s.tower];
  for (let n = 2; n <= OFFICE_TOP_FLOOR; n++) towers.push(carveOfficeFloor(k, f, {ox: TX, oy: TY, level: n, base: bases[n]}, n, n === OFFICE_TOP_FLOOR, rng.fork(`program-${n}`)));
  const landings = [towers[0].core.landing, ...towers.map(t => t.core.landing)];
  const runs = carveScissor(k, f, TX, TY, bases, landings);
  // Task office-overhaul-20261030 (lane STRUCT): the roof deck over the whole tower, the hatch, the roof access closet on floor 8.
  bases[OFFICE_ROOF_LEVEL] = r3(bases[OFFICE_TOP_FLOOR] + FLOOR_HEIGHT);
  const rc: RoofCarve = carveRoof(k, f, TX, TY, bases[OFFICE_TOP_FLOOR], bases[OFFICE_ROOF_LEVEL]);

  // --- Crop: tower interior NW corner at grid cell (MARGIN, MARGIN) on every storey ----------------------------------------
  let x1 = TX + f.TW, y1 = TY + f.TD;
  for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    x1 = Math.max(x1, r.x + r.w - 1); y1 = Math.max(y1, r.y + r.h - 1);
  }
  const ox = TX - MARGIN, oy = TY - MARGIN;
  const c = cropKit(k, [0, ...OFFICE_FLOORS, OFFICE_ROOF_LEVEL], ox, oy, x1 - ox + 3, y1 - oy + 3, s.storefronts);
  for (const t of towers) t.at = {ox: MARGIN, oy: MARGIN, level: t.at.level, base: t.at.base};

  // --- Storeys, stair links (the transit hall's lanes first — its fixed stair is link 0 —, then the scissor runs 1→2 … 7→8, then
  // the roof ladder: a player-only 'ladder' link) -------------------------------------------------------------------------------
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : id === 1 ? 'upper' : id === OFFICE_ROOF_LEVEL ? 'roof' : 'office', grid, baseY: bases[id]}));
  const links: LevelLink[] = [];
  const transitLinkIds = transitLinks(s.hallRun, c.flights, links);
  const runLinks = runs.map(r => {
    const l = linkOf(links.length, r.lower, r.upper, r.flights.map(i => c.flights[i]));
    links.push(l);
    return l.id;
  });
  const layout: StationLayout = {
    seed, attempt, name: s.name, archetype: 'island-ends', towards: s.towards, grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: s.storefronts, decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: s.platform.id, platforms: [s.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  levels[OFFICE_ROOF_LEVEL].sky = roofSky(layout, f, rc);
  registerApertures(layout.levels);
  layout.rails = [...deriveRails(layout.levels), ...transitRails(s.hallRun, hu)];
  layout.traversal.ladders = placeLadders(layout);
  const roof = roofLadder(layout, rc);
  layout.traversal.ladders.push(roof.ladder);
  links.push(roof.link);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';

  // --- Dressing: office pre-dressing per storey → ONE dresser pass → office post-dressing per storey ------------------------
  const dresses: OfficeDress[] = towers.map(t => ({
    layout, frame: f, tower: t, floor: t.floor, top: t.floor === OFFICE_TOP_FLOOR, level: t.floor, base: bases[t.floor],
    rng: rng.fork(`office-dress-${t.floor}`), entrance: t.floor === 1 ? s.entrance : undefined, held: [],
  }));
  // Lane STRUCT: the lobby gate line and the escalator barricade first (lifted with the dressing); then the transit mouths, the
  // run, the roof deck and the roof access closet are held empty while the dressers run.
  transitPreDress(layout, s, rng.fork('transit'));
  const release = holdCells(layout, [...mouthZones(layout, s.hallRun), ...roofHold(layout, rc)]);
  withShaftOpenings(layout, f, towers, () => {
    for (const d of dresses) preDress(d);
    dress(layout, rng.fork('dress'));
    for (const d of dresses) postDress(d);
  });
  release();
  roofStrip(layout, rc);
  const roofDress = dressRoof(layout, f, rc, rng.fork('roof'));
  layout.rails = [...layout.rails, ...roofDress.rails];
  // Task office-interactions-layout-20261030 (lane ROOF): the roof payoff — ONE curated reward cache tucked against the roof plant
  // (its own fork: the dressing above is untouched; holders before it keep their indices — it is the last loot holder placed).
  const roofReward = placeRoofReward(layout, f, rc, roofDress.structures, rng.fork('roof-reward'), loot);

  // --- Player start (after dressing, like placeSpawns): the platform's east end, far from the exit passage, looking west -----
  const start = startOf(layout, s);

  // --- Whole-level populations, storey by storey ---------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep: keepPoints(f, towers)};
  // Lane STRUCT: nobody waits at the roof hatch or at the foot of the ladder.
  field.keep.push({level: OFFICE_ROOF_LEVEL, x: roof.ladder.top.x, z: roof.ladder.top.z}, {level: OFFICE_TOP_FLOOR, x: roof.ladder.bottom.x, z: roof.ladder.bottom.z});
  const storeyLevels = (floor: number): number[] => (floor === 1 ? [0, 1] : [floor]);
  const plan = officeWeaponPlan(ctx.levelSeed, layout.startWeapon);
  // Lane SPAWN: each storey run reads its context of the level's ONE spawn profile (street = station + lobby, floor = each office floor).
  for (const t of towers) {
    const n = t.floor;
    placeOfficeEnemies(layout, rng.fork(`office-enemies-${n}`), field, storeyLevels(n), spawns, n === 1 ? 'street' : 'floor');
  }
  // Lane STRUCT: 0-2 enemies already on the roof (they never climb the ladder: no AI link). Lane SPAWN: the profile's 'roof' context.
  {
    const free = holdCells(layout, roofCoreCells(layout, f));
    placeOfficeEnemies(layout, rng.fork('office-enemies-roof'), field, [OFFICE_ROOF_LEVEL], spawns, 'roof');
    free();
  }
  for (const t of towers) placeOfficeSupplies(layout, rng.fork(`office-supplies-${t.floor}`), field, storeyLevels(t.floor), t.floor === 1, loot);
  for (const t of towers) placeOfficeWeapons(layout, rng.fork(`office-weapons-${t.floor}`), plan[t.floor] ?? [], field, storeyLevels(t.floor), 30);
  // Task gas-mask-roof-feedback-20261030 (item 10): the roof FIND beside the cache — a non-starter gun + its own ammo or a gear piece,
  // verified on the reachable deck; LAST (every earlier pickup keeps its index; its own fork and roll stream: nothing else moves).
  const roofFind = placeRoofFind(layout, f, rc, roofDress.structures, field.dist, rng.fork('roof-find'), loot);

  // --- Lighting, traversal finishing, archetypes, windows + daylight, the tower record -------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  // Lane STRUCT: the open-sky roof has no fixtures (its daylight is fixture-less, added below).
  layout.lights = layout.lights.filter(l => (l.level ?? layout.areas[l.area]?.level ?? 0) !== OFFICE_ROOF_LEVEL);
  landingLights(layout, f, towers, bases);
  finishTraversal(layout);
  assignEnemyArchetypes(layout, spawns); // lane SPAWN: the Office's pool, per the spawn's room
  const windows: StoreyWindow[] = [];
  for (const t of towers) {
    const spans = windowSpans(layout, f, t, t.floor, t.floor === 1 ? s.entrance : null);
    addDaylight(layout, spans, t.floor, t.floor);
    windows.push(...spans);
  }
  roofDaylight(layout, f, rc);
  layout.office = officeInfo(layout, f, towers, bases, runs, runLinks, windows, start);
  layout.office.roof = roofInfo(layout, rc, roof.ladder, roofDress.structures, roofReward, roofFind); // (lane ROOF: + the reward record; + the roof find)
  layout.office.transit = transitInfo(layout, s, transitLinkIds);
  streetSigns(layout, s, f, rc);
  return layout;
}

function linkOf(id: number, lower: number, upper: number, flights: readonly {ramp: number; id: number; bottom: {x: number; y: number; z: number}; top: {x: number; y: number; z: number}}[]): LevelLink {
  const first = flights[0], last = flights[flights.length - 1];
  return {id, kind: 'stairs', lower, upper, ramp: first.ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: first.id};
}

function clearCells(g: Grid, x: number, y: number, r: number): boolean {
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (!g.walkable(x + ox, y + oy)) return false;
  return true;
}

function startOf(layout: StationLayout, s: StreetCarve): OfficePose {
  const P = s.platform, g = layout.grid;
  const sx = P.x + P.w - 1 - Math.round(P.w * 0.16), sy = P.y + Math.floor(P.h / 2);
  let spawn: [number, number] = [sx, sy];
  search: for (let r = 0; r < 14; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    const x = sx + ox, y = sy + oy;
    if (g.area[g.idx(x, y)] === P.id && clearCells(g, x, y, 2)) { spawn = [x, y]; break search; }
  }
  const [wx, wz] = g.center(spawn[0], spawn[1]);
  layout.playerSpawn = {x: wx, z: wz, yaw: Math.PI / 2 - 0.25};
  return {x: wx, z: wz, yaw: layout.playerSpawn.yaw, level: 0};
}

// ---------------------------------------------------------------------------------------------
// The elevator shaft during dressing

/**
 * While the office dressing runs, every storey's shaft door is a real (temporary) opening: its three wall cells are open floor
 * with a door-height lintel and a door record onto the landing area, so the dressers' door zones keep the landing strip clear and
 * no plate / mounted prop covers the opening. Afterwards the cells return to SOLID shaft wall and the records are removed.
 */
function withShaftOpenings(layout: StationLayout, f: TowerFrame, towers: readonly CarvedTower[], fn: () => void): void {
  const tmp: Door[] = [];
  const cells: [Grid, number][] = [];
  for (const t of towers) {
    const g = layout.levels[t.floor].grid, base = t.at.base, N = t.north;
    const y = f.cab.y - 1 + MARGIN;
    for (let x = f.door.x + MARGIN; x < f.door.x + f.door.w + MARGIN; x++) {
      const i = g.idx(x, y);
      g.cells[i] = FLOOR; g.area[i] = N.id; g.floor[i] = base; g.ceil[i] = r3(base + CEIL.door);
      cells.push([g, i]);
    }
    const d: Door = {x: f.door.x + MARGIN, y, w: f.door.w, h: 1, id: layout.doors.length, a: N.id, b: N.id, height: CEIL.door, arch: false, level: t.floor};
    layout.doors.push(d);
    tmp.push(d);
  }
  try { fn(); } finally {
    for (const [g, i] of cells) { g.cells[i] = SOLID; g.area[i] = -1; g.floor[i] = 0; g.ceil[i] = 0; g.blocked[i] = 0; g.sightBlocked[i] = 0; }
    const drop = new Set(tmp);
    for (let i = layout.doors.length - 1; i >= 0; i--) if (drop.has(layout.doors[i])) layout.doors.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Landings, lights, the tower record

const W = (t: number): number => (t + MARGIN) * CELL;
/** Elevator door centre / landing stand point (world m). */
const doorCentre = (f: TowerFrame) => ({x: r3(W(f.door.x + f.door.w / 2)), z: r3(W(f.cab.y))});
const elevatorLanding = (f: TowerFrame) => ({x: doorCentre(f).x, z: r3(W(f.shaft.y) - 0.75)});
const landingPoint = (f: TowerFrame, floor: number) => { const r = landingRect(f, floor); return {x: r3(W(r.x + r.w / 2)), z: r3(W(r.y + r.h / 2))}; };
const panelSide = (f: TowerFrame): 1 | -1 => (f.well.x < f.cab.x ? 1 : -1);

/** Points enemies / loot keep off: every storey's stair landing and elevator landing. */
function keepPoints(f: TowerFrame, towers: readonly CarvedTower[]): SpawnField['keep'] {
  const out: SpawnField['keep'] = [];
  for (const t of towers) {
    out.push({level: t.floor, ...landingPoint(f, t.floor)});
    out.push({level: t.floor, ...elevatorLanding(f)});
  }
  return out;
}

/** Every elevator landing has a working, steady fixture (the cab itself shows lane LIFT's emissive panel). */
function landingLights(layout: StationLayout, f: TowerFrame, towers: readonly CarvedTower[], bases: readonly number[]): void {
  const p = elevatorLanding(f);
  for (const t of towers) {
    const lv = t.floor, g = layout.levels[lv].grid;
    const near = layout.lights.filter(l => (l.level ?? layout.areas[l.area]?.level ?? 0) === lv && !l.virtual && Math.hypot(l.x - p.x, l.z - p.z) < 3.2);
    for (const l of near) { l.broken = false; l.dying = false; l.flicker = false; l.power = Math.max(l.power, 0.9); }
    if (near.length) continue;
    const [cx, cy] = g.cellOf(p.x, p.z);
    const ceil = g.ceil[g.idx(cx, cy)] || bases[lv] + CEIL.corridor;
    layout.lights.push({x: p.x, y: r3(ceil - 0.02), z: p.z, rot: 0, area: t.north.id, broken: false, flicker: false, warm: false, power: 1, dying: false, level: lv});
  }
}

function officeInfo(layout: StationLayout, f: TowerFrame, towers: readonly CarvedTower[], bases: readonly number[], runs: readonly ScissorRun[],
  runLinks: readonly number[], windows: StoreyWindow[], start: OfficePose): OfficeTowerInfo {
  const rect = (r: {x: number; y: number; w: number; h: number}) => ({x0: W(r.x), z0: W(r.y), x1: W(r.x + r.w), z1: W(r.y + r.h)});
  const dc = doorCentre(f), el = elevatorLanding(f), side = panelSide(f);
  const doorEdge = side > 0 ? W(f.door.x + f.door.w) : W(f.door.x);
  return {
    version: 2,
    floors: [...OFFICE_FLOORS],
    floorHeight: f.floorHeight,
    groundY: bases[1],
    storeys: towers.map(t => ({floor: t.floor, levelId: t.floor, baseY: bases[t.floor], label: storeyLabel(t.floor), clear: t.floor === 1 ? CEIL.lobby : CEIL.office})),
    elevator: {
      cab: rect(f.cab),
      shaft: rect(f.shaft),
      doorSide: 'N',
      door: {x: dc.x, z: dc.z, width: f.door.w * CELL},
      cabHeight: CEIL.cab,
      panel: {x: r3(doorEdge + side * 0.25), dy: 1.2, z: r3(W(f.cab.y) + 0.03)},
      stops: towers.map(t => ({
        floor: t.floor, levelId: t.floor, y: bases[t.floor], area: layout.levels[t.floor].grid.area[layout.grid.idx(...layout.grid.cellOf(el.x, el.z))],
        callPanel: {x: r3(doorEdge + side * 0.3), y: r3(bases[t.floor] + 1.2), z: r3(W(f.shaft.y) - 0.03)},
        landing: {x: el.x, z: el.z},
      })),
    },
    stairs: {
      well: rect(f.well),
      runs: runs.map((r, i) => ({lower: r.lower, upper: r.upper, link: runLinks[i], lane: r.lane})),
      landings: towers.map(t => ({floor: t.floor, levelId: t.floor, ...landingPoint(f, t.floor)})),
    },
    windows,
    exterior: {x0: (MARGIN - 1) * CELL, z0: (MARGIN - 1) * CELL, x1: (MARGIN + f.TW + 1) * CELL, z1: (MARGIN + f.TD + 1) * CELL},
    start,
    name: f.name,
    gearSpots: towers.flatMap(t => gearSpots(layout, t)),
    // Task office-overhaul-20261030 (lane TENANTS): the company of each office floor 2..8 (palette / finish for lane ARCH).
    tenants: officeTenants(f.levelSeed).map(t => ({...t, palette: {...t.palette}})),
  };
}

const GEAR_ROLES = new Set(['storage', 'security', 'exec', 'private', 'copy', 'break', 'server', 'closet']);
function gearSpots(layout: StationLayout, tower: CarvedTower): NonNullable<OfficeTowerInfo['gearSpots']> {
  const out: NonNullable<OfficeTowerInfo['gearSpots']> = [];
  const level = tower.floor, g = layout.levels[level].grid;
  for (const a of layout.areas) {
    const m = tower.meta.get(a.id);
    if (!m || !GEAR_ROLES.has(m.role)) continue;
    for (let y = a.y + 1; y < a.y + a.h - 1 && out.length < 24; y += 2) for (let x = a.x + 1; x < a.x + a.w - 1; x += 2) {
      if (!clearCells(g, x, y, 1)) continue;
      const [wx, wz] = g.center(x, y);
      out.push({x: wx, y: layout.levels[level].baseY, z: wz, level, area: a.id});
      break;
    }
  }
  return out;
}

/**
 * Station / lobby wayfinding (task office-overhaul-20261030, lane STRUCT: the transit hall's signs, gen/office/transit.ts) and the
 * ROOF ACCESS plates of the roof access closet on floor 8 (over its door on the corridor side; beside the ladder inside).
 */
function streetSigns(layout: StationLayout, s: StreetCarve, f: TowerFrame, rc: RoofCarve): void {
  transitSigns(layout, s, layout.office!.name);
  const lad = layout.traversal.ladders.find(l => l.kind === 'roof');
  if (!lad) return;
  const b8 = rc.base8, c = layout.areas[rc.closet.id];
  const door = layout.doors.find(d => (d.a === c.id || d.b === c.id) && d.level === OFFICE_TOP_FLOOR);
  // Task office-interactions-layout-20261030 (lane LAYOUT, item 4): the roof access room is assigned when floor 8 is carved, so the
  // office dresser's signage already plated its door (ROOF ACCESS, overlap-free, never ELECTRICAL); this over-door plate is only the
  // fallback for a room without one — exactly one ROOF ACCESS plate either way.
  const plated = layout.signs.some(s => s.level === OFFICE_TOP_FLOOR && s.text === 'ROOF ACCESS');
  if (door && !plated) layout.signs.push({x: r3((door.x + door.w / 2) * CELL), y: r3(b8 + 2.4), z: r3(W(f.cy1 + 1) + 0.02), rot: 0, kind: 'service', text: 'ROOF ACCESS', area: door.a === c.id ? door.b : door.a, w: 1.2, level: OFFICE_TOP_FLOOR});
  layout.signs.push({x: r3(lad.x + 0.64), y: r3(b8 + 1.55), z: r3(lad.faceZ + 0.02), rot: 0, kind: 'service', text: 'ROOF', area: c.id, w: 0.56, level: OFFICE_TOP_FLOOR});
}

/** The elevator landing strip in front of the shaft door (world m), kept walkable and prop-free on every storey — QA / tests. */
export function elevatorLandingStrip(f: TowerFrame): {x0: number; z0: number; x1: number; z1: number} {
  const r = landingStrip(f);
  return {x0: W(r.x), z0: W(r.y), x1: W(r.x + r.w), z1: W(r.y + r.h)};
}
