// Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS (LevelId 'skyways') — the WHOLE level as ONE continuous
// StationLayout: `generateSkywaysLevel(ctx)`. A connected multi-building public pedestrian network loosely inspired by Alberta's
// pedway / "+15" systems: the train arrives in the station under the STATION building, the underground pedway concourse leads up the
// transit run into its street-level lobby, public stair cores climb to the "+15" skyway level, and glazed bridges cross the streets to
// the other buildings (branches and loops), with atrium courts, cafés / shops, a ramen restaurant, lobbies and service rooms — plus
// EXACTLY ONE localized add-on (gen/skyways/addon.ts: a convention hall or a prize-car atrium) on one building's skyway level.
//
// levels[0] = the station + pedway concourse (role 'main', y 0); levels[1] = street level (role 'ring', y 5); levels[2] = the skyway
// level (role 'ring', y 10). Deterministic from (ctx.levelSeed, ctx.startWeapon); gear is NOT placed here (the registry appends it).
//
// Pipeline (the station / mall machinery wherever it fits): frame (gen/skyways/frame.ts: blocks, buildings, bridge graph, add-on) →
// carve (gen/skyways/carve.ts) → Track2 plan (extendTracks on its own fork: nothing written into the Kit) → crop → storeys / links /
// apertures / rails / ladders → ONE stationDress.dress() (run mouths / bridge mouths / the add-on hall held clear) → start → the
// skyways record → the add-on / ramen dressing → whole-level enemies (contexts station / street / floor) / loose supplies / weapon
// finds → applyLighting → daylight behind the glazing → finishTraversal → Track2 attach → ONE enemy family roll → validation (retry).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {Kit} from '../stationKit';
import type {Level, LevelLink, RailRun} from '../levels';
import {deriveRails, levelDistance, registerApertures} from '../levelGen';
import {applyLighting, dress} from '../stationDress';
import {finishTraversal, placeLadders, type StairFlight} from '../traversal';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import {spawnProfile, type SpawnProfile} from '../../ai/spawnTables';
import {applyFamilySpacing} from '../../ai/familySpacing';
import {lootProfile, type LootProfile} from '../../items/lootTables';
import type {SectionGenContext} from '../../levels/types';
import type {LightPlacement, StationLayout} from '../stationTypes';
import {cropKit} from '../office/common';
import {holdCells} from '../office/transit';
import {placeOfficeEnemies, type SpawnField} from '../office/spawns';
import {placeWeaponFinds} from '../weaponFinds';
import {DAYLIGHT_TINT} from '../office/windows';
import {dropExtensions, extendTracks, finishExtensions, trackExtConfig, TRACK_EXT_STATS, type TrackExtConfig} from '../trackExt/index';
import {populateExtensions} from '../annexContent';
import type {TrackExtContext} from '../trackExt/types';
import {BASES, CLEAR, CROP_MARGIN, SKYWAYS_CANVAS, skywaysFrame, skywaysSeed, type SkywaysFrame} from './frame';
import {carveSkyways, lastSkywaysCarveFail, type SkywaysCarve} from './carve';
import {skywaysIssues} from './validate';
import {dressSkywaysAddon} from './addon';
import {SKYWAYS_LEVEL, type SkywaysInfo, type SkywaysRect, type SkywaysWindow} from './skywaysTypes';

export {skywaysFrame, skywaysAddonOf, setSkywaysAddonOverride, skywaysSeed} from './frame';
export {skywaysIssues} from './validate';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 14;
/** Validation issues of rejected attempts (QA / tests). */
export const SKYWAYS_REJECTS = new Map<string, number>();
/** Timing of the last generateSkywaysLevel call (ms), its attempts / carve failures and the last attempt's issues. */
export const SKYWAYS_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, lastFail: '', issues: [] as string[]};
/** Grid cell budget (W x H) of the layout with its track extensions (per-storey arrays scale with it). */
export const SKYWAYS_EXT_MAX_CELLS = 120_000;
/** Display name of the complex ("<name> +15"). */
export const SKYWAYS_GENERIC_NAME = 'Skyways';

export interface SkywaysGenOptions {
  loot?: LootProfile;
  spawns?: SpawnProfile;
  trackExt?: TrackExtConfig | 'none';
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The ONE continuous Skyways layout. */
export function generateSkywaysLevel(ctx: SectionGenContext, opts: SkywaysGenOptions = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loot = opts.loot ?? lootProfile('skyways');
  const spawns = opts.spawns ?? spawnProfile('skyways');
  const trackExt = opts.trackExt ?? trackExtConfig('skyways');
  const seed = skywaysSeed(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  SKYWAYS_GEN_STATS.carveFails = 0;
  let salt = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const f = skywaysFrame(ctx.levelSeed, salt);
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns, trackExt);
    SKYWAYS_GEN_STATS.attempts = attempt + 1;
    if (!layout) { SKYWAYS_GEN_STATS.carveFails++; SKYWAYS_GEN_STATS.lastFail = lastSkywaysCarveFail(); salt++; continue; }
    let issues = skywaysIssues(layout, {startCells: startCells(spawns)});
    if (issues.length && (layout.extensions?.tunnels.length || layout.extensions?.annexes.length)) {
      dropExtensions(layout);
      issues = skywaysIssues(layout, {startCells: startCells(spawns)});
      if (!issues.length) TRACK_EXT_STATS.rescued++;
    }
    SKYWAYS_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) SKYWAYS_REJECTS.set(i, (SKYWAYS_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
    salt++;
  }
  SKYWAYS_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error(`skyways level generation failed (${SKYWAYS_GEN_STATS.lastFail})`);
}

const startCells = (p: SpawnProfile): number => {
  const c = p.contexts.floor ?? p.contexts.street ?? p.contexts.station;
  return c?.placement.startCells ?? 36;
};

/** QA / tests: one attempt of a frame salt (null when the program does not fit). */
export function skywaysAttempt(ctx: SectionGenContext, salt = 0, opts: SkywaysGenOptions = {}): StationLayout | null {
  const seed = skywaysSeed(ctx.levelSeed);
  return tryLevel(skywaysFrame(ctx.levelSeed, salt), seed, seed, 0, ctx, opts.loot ?? lootProfile('skyways'), opts.spawns ?? spawnProfile('skyways'), opts.trackExt ?? trackExtConfig('skyways'));
}

/** The Skyways extendTracks context: east / south growth only from the fixed crop origin; only the station storey must be rock. */
export function skywaysTrackExtContext(levelSeed: number, ox: number, oy: number, coreCrop?: {w: number; h: number}): TrackExtContext {
  return {levelId: 'skyways', levelSeed, canvasGrow: 'east-south', origin: {x: ox, y: oy}, maxCells: SKYWAYS_EXT_MAX_CELLS, rockLevels: [0], ...(coreCrop ? {coreCrop} : {})};
}

// ---------------------------------------------------------------------------------------------
// One attempt

function tryLevel(f: SkywaysFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile, trackExt: TrackExtConfig | 'none'): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: SKYWAYS_CANVAS.levels, w: SKYWAYS_CANVAS.w, h: SKYWAYS_CANVAS.h});
  const sc = carveSkyways(k, rng.fork('carve'), f);
  if (!sc) return null;

  // --- Crop (fixed origin) + the Track2 plan (before the crop; nothing written into the Kit) ------------------------------------
  const ox = sc.X0 - CROP_MARGIN, oy = sc.Z0 - CROP_MARGIN;
  const cw = sc.X1 - ox + CROP_MARGIN, ch = sc.Z1 - oy + CROP_MARGIN;
  const ext = trackExt === 'none' ? null : extendTracks(k, rng.fork('track-ext'), trackExt, skywaysTrackExtContext(ctx.levelSeed, ox, oy, {w: cw, h: ch}));
  const c = cropKit(k, [0, 1, 2], ox, oy, cw, ch, sc.storefronts);

  // --- Storeys, links, apertures, rails, ladders ------------------------------------------------------------------------------
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: BASES[id]}));
  const links: LevelLink[] = [];
  for (const run of sc.runs) for (const ln of run.lanes) {
    const fl = ln.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: links.length, kind: 'stairs', lower: run.lower, upper: run.lower + 1, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const [P1, P2] = sc.block.platforms;
  const towards: [string, string] = ['Riverfront Loop', 'Midfield Junction'];
  const layout: StationLayout = {
    seed, attempt, name: SKYWAYS_GENERIC_NAME, archetype: 'side-mezzanine', towards, grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: sc.storefronts, decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: P2.id, platforms: [P2.id, P1.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  P1.towardsN = towards[0]; P2.towardsS = towards[1];
  registerApertures(layout.levels);
  layout.rails = [...deriveRails(layout.levels), ...runRails(sc, ox, oy, c.flights)];
  layout.traversal.ladders = placeLadders(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';

  // --- Dressing (run mouths, bridge decks' middle lane, the add-on hall held clear) -----------------------------------------------
  const release = holdCells(layout, holds(layout, sc, ox, oy));
  dress(layout, rng.fork('dress'));
  release();

  // --- Start: on the north platform (the train parks at its edge), facing along it toward the concourse openings -----------------
  const start = startOf(layout, sc, ox, oy);
  layout.skyways = skywaysInfo(layout, sc, ox, oy, start, ctx.levelSeed);
  // the ONE add-on's dressing (stage / tables / banners / mascot statues, or the prize display) + the ramen restaurant
  dressSkywaysAddon(layout, rng.fork('skyways-addon'));

  // --- Whole-level populations ------------------------------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep: keepPoints(layout)};
  const ctxOf: [number, 'station' | 'street' | 'floor'][] = [[0, 'station'], [1, 'street'], [2, 'floor']];
  for (const [lv, context] of ctxOf) if (spawns.contexts[context]) placeOfficeEnemies(layout, rng.fork(`skyways-enemies-${lv}`), field, [lv], spawns, context);
  // (no loose floor supplies: user 2026-11-06 — ordinary small loot sits on shelves / counters / in containers; the floor is reserved
  // for key items such as the weapon finds below)
  placeWeaponFinds(layout, rng.fork('skyways-weapons'), layout.startWeapon ?? 'rifle');

  // --- Lighting, daylight, traversal ------------------------------------------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  addSkywaysDaylight(layout);
  finishTraversal(layout);
  dropFloatingFixtures(layout);

  // --- Track2 attach + the one family roll ------------------------------------------------------------------------------------
  if (ext) {
    finishExtensions(layout, ext, {ox, oy, grow: 'east-south'});
    populateExtensions(layout, rng, {loot, spawns, dressRng: rng.fork('dress')});
  }
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  return layout;
}

// ---------------------------------------------------------------------------------------------
// Records

function startOf(layout: StationLayout, sc: SkywaysCarve, ox: number, oy: number): {x: number; z: number; yaw: number; level: number} {
  const P = sc.block.platforms[1], g = layout.grid; // P2 (north), cropped coordinates
  const cxMid = Math.round(sc.concourse.x + sc.concourse.w / 2);
  const y = P.y + Math.floor(P.h / 2) - 1;
  let spawn: [number, number] | null = null;
  for (let r = 0; r < 40 && !spawn; r++) for (const dx of [r, -r]) {
    const x = cxMid + dx;
    let ok = g.inBounds(x, y) && g.area[g.idx(x, y)] === P.id;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spawn = [x, y]; break; }
  }
  const [wx, wz] = g.center(...(spawn ?? [P.x + Math.floor(P.w / 2), y]));
  // facing north (toward the concourse arches): forward = (-sin yaw, -cos yaw) -> yaw 0 looks toward -z
  const yaw = 0;
  layout.playerSpawn = {x: wx, z: wz, yaw};
  void ox; void oy;
  return {x: wx, z: wz, yaw, level: 0};
}

function skywaysInfo(layout: StationLayout, sc: SkywaysCarve, ox: number, oy: number, start: {x: number; z: number; yaw: number; level: number}, levelSeed: number): SkywaysInfo {
  const W = (cx: number) => r3((cx - ox) * CELL), Z = (cy: number) => r3((cy - oy) * CELL);
  const rectW = (r: {x: number; y: number; w: number; h: number}): SkywaysRect => ({x0: W(r.x), z0: Z(r.y), x1: W(r.x + r.w), z1: Z(r.y + r.h)});
  const f = sc.f;
  const groundY = BASES[1];
  const buildings = sc.buildings.map(bc => ({
    id: bc.b.id, name: bc.b.name, role: bc.b.role, rect: rectW(bc.b), top: r3(groundY + bc.b.height),
    levels: [1, 2], ...(bc.atrium ? {atrium: {rect: rectW(bc.atrium), roofY: sc.roofY}} : {}),
  }));
  if (buildings.find(b => b.id === f.station)) buildings.find(b => b.id === f.station)!.levels = [0, 1, 2];
  const bridges = sc.bridges.map(b => ({id: b.id, level: SKYWAYS_LEVEL.skyway, area: b.area, a: b.a, b: b.b, rect: rectW(b.rect), axis: b.axis, width: r3(b.width * CELL),
    length: r3((b.axis === 'x' ? b.rect.w : b.rect.h) * CELL), breached: b.breached}));
  // streets: the gaps between neighbouring footprints (scenery records)
  const streets: SkywaysInfo['streets'] = [];
  const all = sc.buildings.map(bc => bc.b);
  const xs = all.map(b => b.x), zs = all.map(b => b.y), xe = all.map(b => b.x + b.w), ze = all.map(b => b.y + b.h);
  const minX = Math.min(...xs), minZ = Math.min(...zs), maxX = Math.max(...xe), maxZ = Math.max(...ze);
  for (let c = 0; c < f.cols - 1; c++) {
    const left = all.filter(b => b.col === c), right = all.filter(b => b.col === c + 1);
    if (!left.length || !right.length) continue;
    const x0 = Math.max(...left.map(b => b.x + b.w)), x1 = Math.min(...right.map(b => b.x));
    if (x1 > x0) streets.push({rect: rectW({x: x0, y: minZ - 30, w: x1 - x0, h: maxZ - minZ + 60}), axis: 'z'});
  }
  for (let r = 0; r < f.rows - 1; r++) {
    const top = all.filter(b => b.row === r), bot = all.filter(b => b.row === r + 1);
    if (!top.length || !bot.length) continue;
    const z0 = Math.max(...top.map(b => b.y + b.h)), z1 = Math.min(...bot.map(b => b.y));
    if (z1 > z0) streets.push({rect: rectW({x: minX - 30, y: z0, w: maxX - minX + 60, h: z1 - z0}), axis: 'x'});
  }
  const windows: SkywaysWindow[] = sc.windows.map(w => ({...rectW(w.rect), side: w.side, sill: w.sill, head: w.head, kind: w.kind, level: w.level, baseY: BASES[w.level], host: w.host,
    ...(w.breached ? {breached: true} : {})})) as SkywaysWindow[];
  const a = sc.addon;
  const host = sc.buildings.find(b => b.b.id === a.building)!;
  const g2 = layout.levels[2].grid;
  const car = a.car ? (() => {
    const x = r3((a.car.cx - ox) * CELL), z = r3((a.car.cy - oy) * CELL);
    const [cx, cy] = g2.cellOf(x, z);
    return {x, y: BASES[2], z, yaw: r3(a.car.yaw), level: 2, area: g2.area[g2.idx(cx, cy)]};
  })() : undefined;
  const entryCell = a.entry;
  const name = `${host.b.name.split(' ')[0]} +15`;
  void levelSeed;
  return {
    version: 1, name, groundY, storeys: [
      {level: 0, role: 'station', label: 'Concourse', baseY: BASES[0], clear: CLEAR.concourse},
      {level: 1, role: 'street', label: 'Street level', baseY: BASES[1], clear: CLEAR.lobby},
      {level: 2, role: 'skyway', label: '+15 Skyway', baseY: BASES[2], clear: CLEAR.skyway},
    ],
    buildings, bridges, streets, windows,
    addon: {
      id: a.id, building: a.building, level: 2, hall: rectW(a.hall), areas: a.areas.slice(),
      entry: {x: r3((entryCell.x + entryCell.w / 2 - ox) * CELL), z: r3((entryCell.y + entryCell.h / 2 - oy) * CELL), level: 2},
      ...(car ? {car} : {}),
      ...(a.id === 'convention' ? {convention: {stage: a.stage ? rectW(a.stage) : rectW(a.hall), statues: []}} : {}),
    },
    restaurant: sc.ramen ? {area: sc.ramen.dining, kitchen: sc.ramen.kitchen, building: sc.ramen.building, level: sc.ramen.level, name: layout.areas[sc.ramen.dining].label} : null,
    start: {x: start.x, z: start.z, yaw: start.yaw, level: 0},
    exterior: rectW({x: minX, y: minZ, w: maxX - minX, h: maxZ - minZ}),
  };
}

/**
 * Railings of every OPEN run (the mall rule, gen/mall/structure.ts runRails): the balustrades along both long edges of the bank and
 * between its lanes — on the lower storey following the pitch from the bottom edge to the top of the flight, on the upper storey a flat
 * run over the whole length (the upper floor's well guard) — and the WELL END: a flat rail on the upper storey across the bottom edge.
 */
function runRails(sc: SkywaysCarve, ox: number, oy: number, flights: readonly StairFlight[]): RailRun[] {
  const out: RailRun[] = [];
  const W = (cx: number) => r3((cx - ox) * CELL), Z = (cy: number) => r3((cy - oy) * CELL);
  for (const rc of sc.runs) {
    if (rc.enclosed) continue;
    const lo = rc.lower, hi = lo + 1, yLo = BASES[lo], yHi = BASES[hi];
    const q = flights[rc.lanes[0].flights[0]];
    const sTop = q.h0 >= q.h1 ? q.s0 : q.s1;
    const r = rc.rect;
    const a0 = rc.axis === 'x' ? Z(r.y) : W(r.x), a1 = rc.axis === 'x' ? Z(r.y + r.h) : W(r.x + r.w);
    const e0 = rc.axis === 'x' ? W(r.x) : Z(r.y), e1 = rc.axis === 'x' ? W(r.x + r.w) : Z(r.y + r.h);
    const topEdge = rc.from === 'hi' ? e1 : e0, botEdge = rc.from === 'hi' ? e0 : e1;
    const lines: number[] = [a0, a1];
    for (let i = 1; i < rc.lanes.length; i++) lines.push(rc.axis === 'x' ? Z(rc.lanes[i].rect.y) : W(rc.lanes[i].rect.x));
    const seg = (level: number, along: number, sA: number, yA: number, sB: number, yB: number, normal: number, hidden: boolean) => {
      if (Math.abs(sB - sA) < 0.05) return;
      const [s0, y0, s1, y1] = sA <= sB ? [sA, yA, sB, yB] : [sB, yB, sA, yA];
      out.push(rc.axis === 'x'
        ? {level, x0: r3(s0), z0: along, x1: r3(s1), z1: along, y0: r3(y0), y1: r3(y1), nx: 0, nz: normal, kind: 'railing', h: 1.0, ...(hidden ? {hidden: true} : {})}
        : {level, x0: along, z0: r3(s0), x1: along, z1: r3(s1), y0: r3(y0), y1: r3(y1), nx: normal, nz: 0, kind: 'railing', h: 1.0, ...(hidden ? {hidden: true} : {})});
    };
    lines.forEach((along, i) => {
      const inner = i >= 2, normal = i === 1 ? 1 : -1;
      seg(lo, along, botEdge, yLo, sTop, yHi, normal, inner);
      seg(hi, along, inner ? sTop : botEdge, yHi, topEdge, yHi, normal, inner);
    });
    out.push(rc.axis === 'x'
      ? {level: hi, x0: botEdge, z0: a0, x1: botEdge, z1: a1, y0: yHi, y1: yHi, nx: rc.from === 'hi' ? -1 : 1, nz: 0, kind: 'railing', h: 1.0}
      : {level: hi, x0: a0, z0: botEdge, x1: a1, z1: botEdge, y0: yHi, y1: yHi, nx: 0, nz: rc.from === 'hi' ? -1 : 1, kind: 'railing', h: 1.0});
  }
  return out;
}

/** Cells the dressers keep clear: run mouths, every bridge deck's middle lane, the add-on hall, the car's spot. */
function holds(layout: StationLayout, sc: SkywaysCarve, ox: number, oy: number): {level: number; cells: number[]}[] {
  const out: {level: number; cells: number[]}[] = [];
  const add = (level: number, r: {x: number; y: number; w: number; h: number}, pad = 0) => {
    const g = layout.levels[level].grid, cells: number[] = [];
    for (let y = r.y - oy - pad; y < r.y - oy + r.h + pad; y++) for (let x = r.x - ox - pad; x < r.x - ox + r.w + pad; x++) if (g.inBounds(x, y)) cells.push(g.idx(x, y));
    out.push({level, cells});
  };
  for (const rc of sc.runs) {
    const r = rc.rect;
    const mouthLo = rc.axis === 'x' ? {x: rc.from === 'lo' ? r.x + r.w : r.x - 4, y: r.y, w: 4, h: r.h} : {x: r.x, y: rc.from === 'lo' ? r.y + r.h : r.y - 4, w: r.w, h: 4};
    const mouthHi = rc.axis === 'x' ? {x: rc.from === 'lo' ? r.x - 4 : r.x + r.w, y: r.y, w: 4, h: r.h} : {x: r.x, y: rc.from === 'lo' ? r.y - 4 : r.y + r.h, w: r.w, h: 4};
    add(rc.lower, mouthLo); add(rc.lower + 1, mouthHi);
  }
  for (const b of sc.bridges) {
    const lane = b.axis === 'x' ? {x: b.rect.x - 6, y: b.rect.y + 2, w: b.rect.w + 12, h: b.rect.h - 4} : {x: b.rect.x + 2, y: b.rect.y - 6, w: b.rect.w - 4, h: b.rect.h + 12};
    add(2, lane);
  }
  add(2, sc.addon.hall);
  add(2, sc.addon.entry, 3);
  return out;
}

/** Points enemies / loot keep off: every run's mouths. */
function keepPoints(layout: StationLayout): SpawnField['keep'] {
  const out: SpawnField['keep'] = [];
  for (const k of layout.levelLinks) out.push({level: k.lower, x: k.bottom.x, z: k.bottom.z}, {level: k.upper, x: k.top.x, z: k.top.z});
  return out;
}

/** Dim green-grey daylight behind every glazed span (the Office rule) and under every atrium roof. */
function addSkywaysDaylight(layout: StationLayout): number {
  const info = layout.skyways!;
  let n = 0;
  for (const w of info.windows) {
    if (w.kind !== 'window') continue;
    const g = layout.levels[w.level].grid, base = layout.levels[w.level].baseY;
    const alongX = w.side === 'N' || w.side === 'S';
    const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
    const k = Math.max(1, Math.round(len / 3));
    const inward = w.side === 'N' || w.side === 'W' ? -1 : 1; // the span box is the wall: the room lies opposite the outward side
    const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
    const into = w.side === 'N' || w.side === 'W' ? 1 : -1;
    void inward;
    for (let i = 0; i < k; i++) {
      const t = (alongX ? w.x0 : w.z0) + len * (i + 0.5) / k;
      const x = alongX ? t : plane + into * 0.9, z = alongX ? plane + into * 0.9 : t;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      const ceil = g.ceil[g.idx(cx, cy)];
      const l: LightPlacement = {
        x: r3(x), y: r3(Math.min(base + w.head - 0.12, ceil - 0.08)), z: r3(z), rot: alongX ? 0 : Math.PI / 2, area: g.area[g.idx(cx, cy)],
        broken: false, flicker: false, warm: false, power: 0.36, dying: false, virtual: true, tint: DAYLIGHT_TINT,
      };
      if (w.level) l.level = w.level;
      layout.lights.push(l);
      n++;
    }
  }
  // atrium roofs: a grid of soft sources just under the glass over the court
  for (const b of info.buildings) {
    if (!b.atrium) continue;
    const g = layout.levels[1].grid, r = b.atrium.rect;
    for (let x = r.x0 + 2.5; x < r.x1 - 1; x += 5) for (let z = r.z0 + 2.5; z < r.z1 - 1; z += 5) {
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      layout.lights.push({x: r3(x), y: r3(b.atrium.roofY - 0.4), z: r3(z), rot: 0, area: g.area[g.idx(cx, cy)], broken: false, flicker: false, warm: false, power: 0.5, dying: false, virtual: true, tint: DAYLIGHT_TINT, level: 1});
      n++;
    }
  }
  return n;
}

/** Ceiling fixtures more than 1 m under their cell's ceiling (they would hang in the atrium air) are dropped (the mall rule). */
function dropFloatingFixtures(layout: StationLayout): number {
  const before = layout.lights.length;
  layout.lights = layout.lights.filter(l => {
    if (l.virtual) return true;
    const lv = l.level ?? layout.areas[l.area]?.level ?? 0, g = layout.levels[lv]?.grid;
    if (!g) return true;
    const [cx, cy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(cx, cy)) return true;
    const c = g.ceilAt(l.x, l.z);
    return !(Number.isFinite(c) && l.y < c - 1.0);
  });
  return before - layout.lights.length;
}
