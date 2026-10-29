// Iteration 16 (WORLD-GEN): OFFICE SPACE section generator — `generateOfficeSection(section, ctx)`.
//
// Sections: 'street' (a compact subway stop whose upper storey is the office tower's lobby, joined by a real stair run) and
// 'floor-2' … 'floor-8' (one office storey each). Deterministic from (ctx.levelSeed, section, ctx.startWeapon): the tower frame
// comes from the level seed alone (gen/office/frame.ts), each section from its own section seed, so sections are generated
// independently and agree on the footprint / core / elevator / stairwell (identical world X/Z everywhere). Gear is NOT placed
// here (the level registry appends ctx.gear once, lane GEAR's placeSectionGear).
//
// Pipeline (the station's own machinery wherever it fits): carve (Kit, archetype pieces, storefronts, stair-core pattern) →
// crop → storeys / stair link / apertures / rails / rescue ladders → office pre-dressing → stationDress.dress() (purposes,
// room rules, composition, generated props, washrooms, plates) → office post-dressing → enemies / loose supplies / weapon finds
// → applyLighting → finishTraversal → enemy archetypes → window spans + daylight → layout.office → validation (retry on issues).

import {Rng, hashString} from '../../core/rng';
import {CELL, type Grid} from '../grid';
import {Kit} from '../stationKit';
import type {Level, LevelLink} from '../levels';
import {deriveRails, registerApertures} from '../levelGen';
import {applyLighting, dress} from '../stationDress';
import {finishTraversal, placeLadders} from '../traversal';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import type {SectionGenContext} from '../../levels/types';
import type {OfficePose, OfficeSectionInfo, OfficeStairDoor, StationLayout} from '../stationTypes';
import {MARGIN, OFFICE_FLOORS, OFFICE_TOP_FLOOR, floorOf, sectionSeed, towerFrame, type TowerFrame} from './frame';
import {TOWER_CANVAS, cropKit, dummyTrench} from './common';
import {carveOfficeFloor, type CarvedTower} from './tower';
import {carveStreet, type StreetCarve} from './street';
import {postDress, preDress, wallSign, type OfficeDress} from './dress';
import {makePlaceCtx} from '../placeKit';
import {OFFICE_ENEMIES, officeWeaponPlan, placeOfficeEnemies, placeOfficeSupplies, placeOfficeWeapons, type SpawnSources} from './spawns';
import {addDaylight, windowSpans} from './windows';
import {officeIssues} from './validate';

export {OFFICE_FLOORS, OFFICE_SECTIONS, OFFICE_TOP_FLOOR, towerFrame, sectionSeed, floorOf} from './frame';
export {officeIssues} from './validate';
export {officeModelKeysFor} from './kinds';

/** Generation attempts per section before the last generated layout is returned with its issues. */
const ATTEMPTS = 24;
/** Validation issues of rejected attempts (QA / tests: what the retry loop is absorbing). */
export const OFFICE_REJECTS = new Map<string, number>();

export function generateOfficeSection(section: string, ctx: SectionGenContext): StationLayout {
  const floor = floorOf(section);
  const f = towerFrame(ctx.levelSeed);
  const seed = sectionSeed(ctx.levelSeed, section);
  let fallback: StationLayout | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = floor === 1 ? tryStreet(f, s, seed, attempt, ctx) : tryFloor(f, s, seed, attempt, floor, ctx);
    if (!layout) continue;
    const issues = officeIssues(layout, f);
    if (!issues.length) return layout;
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) OFFICE_REJECTS.set(i, (OFFICE_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  if (fallback) return fallback;
  throw new Error(`office section ${section} generation failed`);
}

// ---------------------------------------------------------------------------------------------
// Sections

function baseLayout(seed: number, attempt: number, name: string, k: Kit, grids: Grid[], extra: Partial<StationLayout>): StationLayout {
  return {
    seed, attempt, name, archetype: 'express', towards: ['Northgate', 'Harbourfront'], grid: grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: dummyTrench(), trenches: [], platform: 0, platforms: [],
    traversal: {stairs: [], ladders: [], underpasses: []}, levels: [], levelLinks: [], rails: [],
    ...extra,
  };
}

function tryFloor(f: TowerFrame, genSeed: number, seed: number, attempt: number, floor: number, ctx: SectionGenContext): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng);
  const TX = TOWER_CANVAS.x, TY = TOWER_CANVAS.y;
  const tower = carveOfficeFloor(k, f, {ox: TX, oy: TY, level: 0, base: 0}, floor, floor === OFFICE_TOP_FLOOR, rng.fork('program'));
  const c = cropKit(k, [0], TX - MARGIN, TY - MARGIN, f.TW + 2 * MARGIN, f.TD + 2 * MARGIN);
  tower.at = {ox: MARGIN, oy: MARGIN, level: 0, base: 0};
  const layout = baseLayout(seed, attempt, `${f.name} · Floor ${floor}`, k, c.grids, {platform: tower.north.id});
  layout.levels = [{id: 0, role: 'main', grid: c.grids[0], baseY: 0}];
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  const arr = arrivalsOf(f, tower, floor, 0, 0);
  layout.playerSpawn = {x: arr.elevator!.x, z: arr.elevator!.z, yaw: arr.elevator!.yaw};
  finish(layout, f, tower, floor, 0, 0, rng, ctx, arr, null);
  return layout;
}

function tryStreet(f: TowerFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext): StationLayout | null {
  const rng = new Rng(genSeed);
  const s = carveStreet(rng, f);
  if (!s) return null;
  const {kit: k, cropped: c, hu} = s;
  const levels: Level[] = [{id: 0, role: 'main', grid: c.grids[0], baseY: 0}, {id: 1, role: 'upper', grid: c.grids[1], baseY: hu}];
  const first = c.flights[0], last = c.flights[c.flights.length - 1];
  const links: LevelLink[] = [{id: 0, kind: 'stairs', lower: 0, upper: 1, ramp: first.ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: first.id}];
  const layout = baseLayout(seed, attempt, s.name, k, c.grids, {
    archetype: 'island-ends', towards: s.towards, storefronts: s.storefronts, trench: c.trenches[0], trenches: c.trenches,
    platform: s.platform.id, platforms: [s.platform.id], traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links,
  });
  registerApertures(layout.levels);
  layout.rails = deriveRails(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  const arr = arrivalsOf(f, s.tower, 1, 1, hu);
  // Player start (after dressing, like placeSpawns): the platform's east end, far from the exit passage, looking west.
  const P = s.platform, g = layout.grid;
  const startOf = (): OfficePose => {
    const sx = P.x + P.w - 1 - Math.round(P.w * 0.16), sy = P.y + Math.floor(P.h / 2);
    let spawn: [number, number] = [sx, sy];
    search: for (let r = 0; r < 14; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const x = sx + ox, y = sy + oy;
      if (g.area[g.idx(x, y)] === P.id && clearCells(g, x, y, 2)) { spawn = [x, y]; break search; }
    }
    const [wx, wz] = g.center(spawn[0], spawn[1]);
    layout.playerSpawn = {x: wx, z: wz, yaw: Math.PI / 2 - 0.25};
    return {x: wx, z: wz, yaw: layout.playerSpawn.yaw, level: 0};
  };
  finish(layout, f, s.tower, 1, 1, hu, rng, ctx, arr, s.entrance, startOf);
  // Wayfinding between the station and the tower (the run's two ends).
  if (layout.office) streetSigns(layout, s, hu);
  return layout;
}

function clearCells(g: Grid, x: number, y: number, r: number): boolean {
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (!g.walkable(x + ox, y + oy)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Shared finishing pipeline

function finish(layout: StationLayout, f: TowerFrame, tower: CarvedTower, floor: number, level: number, base: number, rng: Rng, ctx: SectionGenContext,
  arr: Partial<Record<'start' | 'elevator' | 'stairs-up' | 'stairs-down', OfficePose>>, entrance: {x0: number; x1: number} | null, startOf?: () => OfficePose): void {
  const d: OfficeDress = {layout, frame: f, tower, floor, top: floor === OFFICE_TOP_FLOOR, level, base, rng: rng.fork('office-dress'), entrance: entrance ?? undefined, held: []};
  preDress(d);
  dress(layout, rng.fork('dress'));
  postDress(d);
  if (startOf) arr.start = startOf();
  // Spawns: away from every arrival (the platform start keeps the station's 18 m rule).
  const g = (lv: number) => layout.levels[lv].grid;
  const src: SpawnSources = {cells: Object.entries(arr).map(([k, p]) => { const [x, y] = g(p!.level).cellOf(p!.x, p!.z); return {level: p!.level, x, y, min: k === 'start' ? 36 : 20}; })};
  placeOfficeEnemies(layout, rng.fork('office-enemies'), src, floor === 1 ? OFFICE_ENEMIES.street : OFFICE_ENEMIES.floor);
  placeOfficeSupplies(layout, rng.fork('office-supplies'), src, floor === 1);
  const sw = layout.startWeapon ?? 'rifle';
  const section = floor === 1 ? 'street' : `floor-${floor}`;
  placeOfficeWeapons(layout, rng.fork('office-weapons'), officeWeaponPlan(ctx.levelSeed, sw)[section] ?? [], src, 30, tower);
  applyLighting(layout, rng.fork('lighting'));
  // The cab light always works (TOWER adds the emissive panel; the baked field lights the cab).
  for (const l of layout.lights) if (l.area === tower.core.cab.id) { l.broken = false; l.dying = false; l.flicker = false; l.power = 1; }
  if (!layout.lights.some(l => l.area === tower.core.cab.id)) {
    const c = tower.core.cab;
    layout.lights.push({x: (c.x + c.w / 2) * CELL, y: c.ceil - 0.02, z: (c.y + c.h / 2) * CELL, rot: 0, area: c.id, broken: false, flicker: false, warm: false, power: 1, dying: false, ...(level ? {level} : {})});
  }
  finishTraversal(layout);
  assignEnemyArchetypes(layout);
  const windows = windowSpans(layout, f, tower, level, entrance);
  addDaylight(layout, windows, level, floor);
  layout.office = officeInfo(layout, f, tower, floor, level, base, windows, arr);
}

/** Arrival poses of the tower storey (elevator cab centre facing the door; in front of the stair door facing away from it). */
function arrivalsOf(f: TowerFrame, tower: CarvedTower, floor: number, level: number, _base: number): Partial<Record<'start' | 'elevator' | 'stairs-up' | 'stairs-down', OfficePose>> {
  const cab = tower.core.cab, v = tower.core.vest;
  const out: Partial<Record<'start' | 'elevator' | 'stairs-up' | 'stairs-down', OfficePose>> = {};
  out.elevator = {x: (cab.x + cab.w / 2) * CELL, z: (cab.y + cab.h / 2) * CELL, yaw: 0, level};
  const sd = {x: (v.x + v.w / 2) * CELL, z: (v.y + v.h) * CELL - 1.0, yaw: 0, level};
  if (floor > 1) out['stairs-up'] = {...sd};
  if (floor < OFFICE_TOP_FLOOR) out['stairs-down'] = {...sd};
  void f;
  return out;
}

function officeInfo(layout: StationLayout, f: TowerFrame, tower: CarvedTower, floor: number, level: number, base: number,
  windows: OfficeSectionInfo['windows'], arrivals: OfficeSectionInfo['arrivals']): OfficeSectionInfo {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const cab = tower.core.cab, d = tower.core.cabDoor, v = tower.core.vest;
  const stairX = r3((v.x + v.w / 2) * CELL), stairZ = r3((v.y + v.h) * CELL - 0.02);
  const stairDoors: OfficeStairDoor[] = [];
  if (floor < OFFICE_TOP_FLOOR) stairDoors.push({dir: 'up', x: stairX, z: stairZ, yaw: Math.PI, toFloor: floor + 1});
  if (floor > 1) stairDoors.push({dir: 'down', x: stairX, z: stairZ, yaw: Math.PI, toFloor: floor - 1});
  return {
    floor, floors: [...OFFICE_FLOORS], floorHeight: f.floorHeight, levelId: level, baseY: base,
    elevator: {
      cab: {x0: cab.x * CELL, z0: cab.y * CELL, x1: (cab.x + cab.w) * CELL, z1: (cab.y + cab.h) * CELL},
      doorSide: 'N',
      door: {x: r3((d.x + d.w / 2) * CELL), z: cab.y * CELL, width: d.w * CELL},
      panel: {x: r3((d.x + d.w) * CELL + 0.25), y: r3(base + 1.2), z: r3(cab.y * CELL + 0.03)},
      callPanel: {x: r3((d.x + d.w) * CELL + 0.3), y: r3(base + 1.2), z: r3(d.y * CELL - 0.03)},
      floorY: base, area: cab.id,
      shaft: {x0: (cab.x - 1) * CELL, z0: (cab.y - 1) * CELL, x1: (cab.x + cab.w + 1) * CELL, z1: (cab.y + cab.h + 1) * CELL},
    },
    stairDoors,
    windows,
    exterior: {x0: (MARGIN - 1) * CELL, z0: (MARGIN - 1) * CELL, x1: (MARGIN + f.TW + 1) * CELL, z1: (MARGIN + f.TD + 1) * CELL},
    arrivals,
    name: f.name,
    sectionSeed: layout.seed,
    gearSpots: gearSpots(layout, tower, level),
  };
}

const GEAR_ROLES = new Set(['storage', 'security', 'exec', 'private', 'copy', 'break', 'server', 'closet']);
function gearSpots(layout: StationLayout, tower: CarvedTower, level: number): NonNullable<OfficeSectionInfo['gearSpots']> {
  const out: NonNullable<OfficeSectionInfo['gearSpots']> = [];
  const g = layout.levels[level].grid;
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

function streetSigns(layout: StationLayout, s: StreetCarve, hu: number): void {
  const lobby = layout.areas[s.coreLobby.id], landing = layout.areas[s.landing.id], T = layout.areas[s.ticketHall.id], transit = layout.areas[s.transit.id];
  const name = layout.office!.name.toUpperCase();
  // Over the core door in the ticket hall (its north wall), hanging in the core lobby, over the landing door in the lobby.
  const c0 = makePlaceCtx(layout, new Rng(1), 0), c1 = makePlaceCtx(layout, new Rng(2), 1);
  const doorT = layout.doors.find(q => (q.a === T.id && q.b === lobby.id) || (q.b === T.id && q.a === lobby.id));
  if (doorT) wallSign(c0, layout, T, 'N', (doorT.x + doorT.w / 2) * CELL, 3.0, {kind: 'info', text: `${name} · LOBBY`, arrow: 'up', w: 2.6});
  layout.signs.push({x: lobby.x * CELL + 0.7, y: 2.55, z: (lobby.y + lobby.h / 2) * CELL, rot: Math.PI / 2, kind: 'info', text: 'OFFICE TOWER', arrow: 'up', area: lobby.id, hang: true, w: 1.6});
  const doorL = layout.doors.find(q => q.b === landing.id || q.a === landing.id);
  if (doorL) wallSign(c1, layout, transit, 'S', (doorL.x + doorL.w / 2) * CELL, hu + 2.75, {kind: 'info', text: 'TO TRAINS', arrow: 'down', w: 1.6, level: 1});
}
