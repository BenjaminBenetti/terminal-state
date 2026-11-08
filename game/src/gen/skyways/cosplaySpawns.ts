// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the COSPLAY ZOMBIES of the Skyways anime convention.
//
// User: "the animie convention "event" should have special "cosplay zombies" spawned, which are just zombies wearing special clothing."
// Only when a version-5+ Skyways layout's ONE add-on is the convention (gen/skyways/addon.ts; the alternative is the prize display, which
// gets none) this pass adds ONE run of the spawn profile's 'cosplay' zone context (ai/cosplayContext.ts COSPLAY_CONTEXT, U{4..6}) on the
// convention venue's public EVENT FLOOR and nowhere else:
//  - the venue areas of roles main-hall / exhibitors / photo-lounge / panel (never registration, the back of house, storage, washrooms);
//    the main hall first, then the others in a seeded order, round-robin (the run spreads over the venue);
//  - only walkable FLOOR (props block: gen/grid.ts walkable; the stage and its treads / the merch tables / the chairs are props), never a
//    ramp, 3 x 3 clear, reachable and >= 36 walking cells from the start (the validator's rule), 5 m off every stair / escalator landing;
//    >= 3 m from every door of the venue's areas (no point-blank zombie at a doorway) and from the add-on's entry point, >= 2.5 m from every
//    mascot statue (never crowding the greeter), off the stage box + 1 m; a 0.5 m disc never splits the storey (spawnTables sealsPassage);
//    2 m from every enemy already on the storey;
//  - every spawn an ordinary zombie (the context's own pool: zombie only, via the ONE assignEnemyArchetypes of the generator), type
//    'shambler' (no coat roll: the look is the costume), tagged ZombieSpawn.look 'cosplay' and the context 'cosplay';
//  - APPENDED after every other spawn of the level (ambient, hordes, annex 'service'): every existing spawn index — its family roll,
//    wardrobe look, kill memory — is unchanged; on its own rng fork (drawn from only when the convention exists), so a layout without it is
//    byte-identical to one generated without this pass. Versions 1-4 never run it (the caller's version gate).
// The AI is the ordinary zombie's: no leash, despawn or teleport. Killed ones stay dead through the ordinary per-index kill memory.

import type {Rng} from '../../core/rng';
import {FLOOR} from '../grid';
import {levelDistance} from '../levelGen';
import {clearAround} from '../stationDress';
import type {StationLayout} from '../stationTypes';
import type {SkywaysVenueRole} from './skywaysTypes';
import {doorPoint} from './addonFrame';
import {markSpawnContext, reportSpawnCandidates, sealsPassage, type SpawnProfile} from '../../ai/spawnTables';

/** The spawn-context / look tag of the convention's cosplay zombies (ZombieSpawn.look, SpawnContextId). */
export const COSPLAY_SPAWN_LOOK = 'cosplay' as const;
/** Conventions per level at most (one add-on per level) = the zone context's runs per level. */
export const COSPLAY_CONVENTIONS_MAX = 1;

/** The convention-specific placement rules on top of the context's PlacementRules (COSPLAY_PLACEMENT). */
export const COSPLAY_SPAWN_RULES = {
  /** Venue roles that host cosplayers (the public event floor), main hall first. */
  roles: ['main-hall', 'exhibitors', 'photo-lounge', 'panel'] as readonly SkywaysVenueRole[],
  /** Straight-line keep-off (m) from every door of a hosting area and from the add-on's entry point. */
  doorKeepM: 3,
  /** Keep-off (m) from every mascot statue (the entrance greeter, the washroom pointer, ...). */
  statueKeepM: 2.5,
  /** Margin (m) round the stage box (deck + treads). */
  stageMarginM: 1,
  /** Fair passage (m): a disc of this radius around a spawn never splits the storey's walkable floor. */
  passageRadiusM: 0.5,
} as const;

/** One convention run (QA / tests). */
export interface CosplayRunReport {
  level: number;
  /** Hosting areas (layout.areas ids) in placement order, and the stand-point candidates per area. */
  areas: number[];
  candidates: number[];
  /** Drawn count (U{context count}) and the spawns placed. */
  count: number;
  placed: number;
  /** Index of the first spawn of this run in layout.zombies (-1 = none placed). */
  first: number;
}
/** The last generated layout's convention run (QA / tests; null = no convention / not run). */
export const COSPLAY_SPAWN_STATS: {run: CosplayRunReport | null} = {run: null};

/** The convention venue's hosting areas of a layout (empty: no convention add-on). */
export function cosplayVenueAreas(layout: Pick<StationLayout, 'skyways' | 'areas'>): number[] {
  const a = layout.skyways?.addon;
  if (!a || a.id !== 'convention') return [];
  const R = COSPLAY_SPAWN_RULES.roles;
  if (a.venue?.length) return R.flatMap(role => a.venue!.filter(v => v.role === role).map(v => v.area)).filter(id => !!layout.areas[id]);
  return a.areas.length ? [a.areas[0]] : [];
}

/**
 * The convention's cosplay run, after every other spawn of the level (call it right before assignEnemyArchetypes). `keep` = the storeys'
 * keep points (world metres; the run mouths). Reads the profile's 'cosplay' context on every call (absent = none); draws from `rng` only
 * when the layout has the convention.
 */
export function placeCosplaySpawns(layout: StationLayout, rng: Rng, keep: readonly {level: number; x: number; z: number}[], profile: SpawnProfile): CosplayRunReport | null {
  COSPLAY_SPAWN_STATS.run = null;
  const ctx = profile.contexts.cosplay;
  const hosts = cosplayVenueAreas(layout);
  const addon = layout.skyways?.addon;
  if (!ctx || ctx.count[1] <= 0 || !hosts.length || !addon) return null;
  const R = COSPLAY_SPAWN_RULES, pl = ctx.placement;
  const lv = addon.level, g = layout.levels[lv].grid;
  // walking distance from the player start over the FINAL grids (the extensions may have re-framed them since the core populations)
  const st = layout.skyways?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = layout.levels[st.level].grid.cellOf(st.x, st.z);
  const d = levelDistance(layout.levels, sx, sy, st.level, layout.levelLinks)[lv];
  const hostSet = new Set(hosts);
  const doors = layout.doors.filter(dr => hostSet.has(dr.a) || hostSet.has(dr.b)).map(dr => doorPoint(dr, layout.areas[hostSet.has(dr.a) ? dr.a : dr.b]));
  const statues = (addon.convention?.statues ?? []).filter(s => s.level === lv);
  const stage = addon.convention?.stage;
  const pointOk = (x: number, z: number): boolean =>
    !keep.some(k => k.level === lv && Math.hypot(k.x - x, k.z - z) < (pl.landingKeepM ?? 0))
    && !doors.some(p => Math.hypot(p.x - x, p.z - z) < R.doorKeepM)
    && Math.hypot(addon.entry.x - x, addon.entry.z - z) >= R.doorKeepM
    && !statues.some(s => Math.hypot(s.x - x, s.z - z) < R.statueKeepM)
    && !(stage && x > stage.x0 - R.stageMarginM && x < stage.x1 + R.stageMarginM && z > stage.z0 - R.stageMarginM && z < stage.z1 + R.stageMarginM);
  // --- candidates per hosting area (cell centres)
  const cands: {i: number; x: number; z: number}[][] = hosts.map(() => []);
  const index = new Map(hosts.map((id, k) => [id, k] as const));
  for (const id of hosts) {
    const a = layout.areas[id];
    if ((a.level ?? 0) !== lv) continue;
    for (let y = Math.max(1, a.y); y < Math.min(g.h - 1, a.y + a.h); y++) for (let x = Math.max(1, a.x); x < Math.min(g.w - 1, a.x + a.w); x++) {
      const i = g.idx(x, y);
      if (g.area[i] !== id || g.cells[i] !== FLOOR || !g.walkable(x, y) || g.rampIdx[i] >= 0 || d[i] < pl.startCells || !clearAround(g, x, y, pl.clearCells)) continue;
      const [px, pz] = g.center(x, y);
      if (pointOk(px, pz)) cands[index.get(id)!].push({i, x: px, z: pz});
    }
  }
  reportSpawnCandidates(layout, 'cosplay', new Map(hosts.map((id, k) => [id, cands[k]] as const)));
  // --- the run: count, then round-robin over the hosting areas (the main hall first, the rest in a seeded order)
  const count = rng.int(ctx.count[0], ctx.count[1]);
  const order = [0, ...rng.shuffle(hosts.map((_, k) => k).slice(1))].filter(k => cands[k].length > 0);
  const first = layout.zombies.length;
  const tryPlace = (cells: readonly {i: number; x: number; z: number}[]): boolean => {
    for (let t = 0; t < pl.tries; t++) {
      const c = rng.pick(cells);
      if (layout.zombies.some(z => (z.level ?? 0) === lv && Math.hypot(z.x - c.x, z.z - c.z) < pl.spacingM)) continue;
      if (sealsPassage(g, c.x, c.z, R.passageRadiusM)) continue;
      layout.zombies.push({x: c.x, z: c.z, yaw: rng.range(-Math.PI, Math.PI), type: 'shambler', area: g.area[c.i], ...(lv ? {level: lv, y: g.floorOf(c.i)} : {}), look: COSPLAY_SPAWN_LOOK});
      return true;
    }
    return false;
  };
  let placed = 0, progress = true;
  while (placed < count && progress) {
    progress = false;
    for (const k of order) {
      if (placed >= count) break;
      if (tryPlace(cands[k])) { placed++; progress = true; }
    }
  }
  if (placed) markSpawnContext(layout, first, 'cosplay');
  const run: CosplayRunReport = {level: lv, areas: hosts, candidates: cands.map(c => c.length), count, placed, first: placed ? first : -1};
  COSPLAY_SPAWN_STATS.run = run;
  return run;
}

/**
 * Re-tags the convention's spawns after records before them were removed (gen/trackExt dropExtensions drops the annex 'service' spawns:
 * the context side table is per index). They are always the last spawns of the level.
 */
export function retagCosplaySpawns(layout: StationLayout): void {
  const first = layout.zombies.findIndex(z => z.look === COSPLAY_SPAWN_LOOK);
  if (first >= 0) markSpawnContext(layout, first, 'cosplay');
}
