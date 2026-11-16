// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the new events' CROWD — the people who were at the tech expo,
// the mini-golf or the evacuation centre when it turned, standing on its public floor the way the convention's cosplay crowd stands on
// the convention's (gen/skyways/cosplaySpawns.ts, whose placement rules this pass follows). Only for a version-7 layout whose ONE add-on
// is a new event (the caller's version gate; isSkywaysEventAddon), on the venue areas of roles main-hall / exhibitors / photo-lounge /
// panel, never registration, the back of house, storage or washrooms:
//  - walkable FLOOR only (props block), never a ramp, clear round, reachable and >= the floor context's start distance from the start,
//    off every stair / escalator landing, >= 3 m from every door of the hosting areas and from the add-on's entry point, 2 m (the
//    context's spacing) from every enemy on the storey, and a 0.5 m disc never splits the storey (spawnTables sealsPassage);
//  - ordinary enemies of the skyway floor (tagged the 'floor' context: the generator's ONE assignEnemyArchetypes rolls their family
//    and wardrobe like any other floor spawn), the event's own count: an evacuation centre that fell from the inside holds the most;
//  - APPENDED right after the hordes, BEFORE the annex's 'service' spawns (the hordes' rule), on its own rng fork, drawn from only when a
//    new event exists: every ambient / horde spawn index, family roll, look and kill memory is unchanged, a convention / prize-car layout
//    is byte-identical without it, and the crowd's own indices — so its family rolls (ai/creatureSpawn.ts: a hash of seed and INDEX) —
//    are the same whether the level has an annex or not (tests/bts-area.test.ts core-view invariance).
// The AI is the ordinary zombie's (no leash, despawn or teleport). Killed ones stay dead through the ordinary per-index kill memory.

import type {Rng} from '../../../core/rng';
import {FLOOR} from '../../grid';
import {levelDistance} from '../../levelGen';
import {clearAround} from '../../stationDress';
import type {StationLayout} from '../../stationTypes';
import {isSkywaysEventAddon, type SkywaysEventAddonId, type SkywaysVenueRole} from '../skywaysTypes';
import {doorPoint} from '../addonFrame';
import {markSpawnContext, rollZombieTypes, sealsPassage, spawnContext, type SpawnProfile} from '../../../ai/spawnTables';

export const EVENT_CROWD_RULES = {
  /** Venue roles that host the crowd (the public event floor), main hall first. */
  roles: ['main-hall', 'exhibitors', 'photo-lounge', 'panel'] as readonly SkywaysVenueRole[],
  /** U{lo..hi} enemies per event. */
  count: {'tech-expo': [3, 5], 'mini-golf': [2, 4], 'evac-centre': [4, 6]} as Readonly<Record<SkywaysEventAddonId, readonly [number, number]>>,
  /** Straight-line keep-off (m) from every door of a hosting area and from the add-on's entry point. */
  doorKeepM: 3,
  /** Fair passage (m): a disc of this radius around a spawn never splits the storey's walkable floor. */
  passageRadiusM: 0.5,
} as const;

/** One event crowd run (QA / tests). */
export interface EventCrowdReport {
  level: number;
  areas: number[];
  candidates: number[];
  count: number;
  placed: number;
  /** Index of the first spawn of this run in layout.zombies (-1 = none placed). */
  first: number;
}

/** The crowd's spawn range per layout: layout.zombies[first .. first + n). */
const CROWD = new WeakMap<object, {first: number; n: number}>();

/** A layout's event crowd as a range of layout.zombies (null: none; QA / tests). */
export const eventCrowdOf = (layout: object): {first: number; n: number} | null => CROWD.get(layout) ?? null;

/** A layout's event-crowd hosting areas (empty: no new event). */
export function eventCrowdAreas(layout: Pick<StationLayout, 'skyways' | 'areas'>): number[] {
  const a = layout.skyways?.addon;
  if (!a || !isSkywaysEventAddon(a.id) || !a.venue?.length) return [];
  return EVENT_CROWD_RULES.roles.flatMap(role => a.venue!.filter(v => v.role === role).map(v => v.area)).filter(id => !!layout.areas[id]);
}

/**
 * The new event's crowd, right after the hordes and before the track extensions attach (their annex 'service' spawns come after it).
 * `keep` = the storeys' keep points (world metres; the run mouths). Draws from `rng` only when the layout holds a new event.
 */
export function placeEventCrowdSpawns(layout: StationLayout, rng: Rng, keep: readonly {level: number; x: number; z: number}[], profile: SpawnProfile): EventCrowdReport | null {
  const addon = layout.skyways?.addon;
  const hosts = eventCrowdAreas(layout);
  if (!addon || !isSkywaysEventAddon(addon.id) || !hosts.length || !profile.contexts.floor) return null;
  const R = EVENT_CROWD_RULES, pl = spawnContext(profile, 'floor').placement;
  const lv = addon.level, g = layout.levels[lv].grid;
  const st = layout.skyways?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = layout.levels[st.level].grid.cellOf(st.x, st.z);
  const d = levelDistance(layout.levels, sx, sy, st.level, layout.levelLinks)[lv];
  const hostSet = new Set(hosts);
  const doors = layout.doors.filter(dr => hostSet.has(dr.a) || hostSet.has(dr.b)).map(dr => doorPoint(dr, layout.areas[hostSet.has(dr.a) ? dr.a : dr.b]));
  const pointOk = (x: number, z: number): boolean =>
    !keep.some(k => k.level === lv && Math.hypot(k.x - x, k.z - z) < (pl.landingKeepM ?? 0))
    && !doors.some(p => Math.hypot(p.x - x, p.z - z) < R.doorKeepM)
    && Math.hypot(addon.entry.x - x, addon.entry.z - z) >= R.doorKeepM;
  const cands: {i: number; x: number; z: number}[][] = hosts.map(() => []);
  hosts.forEach((id, k) => {
    const a = layout.areas[id];
    if ((a.level ?? 0) !== lv) return;
    for (let y = Math.max(1, a.y); y < Math.min(g.h - 1, a.y + a.h); y++) for (let x = Math.max(1, a.x); x < Math.min(g.w - 1, a.x + a.w); x++) {
      const i = g.idx(x, y);
      if (g.area[i] !== id || g.cells[i] !== FLOOR || !g.walkable(x, y) || g.rampIdx[i] >= 0 || d[i] < pl.startCells || !clearAround(g, x, y, pl.clearCells)) continue;
      const [px, pz] = g.center(x, y);
      if (pointOk(px, pz)) cands[k].push({i, x: px, z: pz});
    }
  });
  const [lo, hi] = R.count[addon.id];
  const count = rng.int(lo, hi);
  const types = rollZombieTypes(rng, count, profile.zombieTypes);
  const order = [0, ...rng.shuffle(hosts.map((_, k) => k).slice(1))].filter(k => cands[k].length > 0);
  const first = layout.zombies.length;
  let placed = 0, progress = true;
  const tryPlace = (cells: readonly {i: number; x: number; z: number}[]): boolean => {
    for (let t = 0; t < pl.tries; t++) {
      const c = rng.pick(cells);
      if (layout.zombies.some(z => (z.level ?? 0) === lv && Math.hypot(z.x - c.x, z.z - c.z) < pl.spacingM)) continue;
      if (sealsPassage(g, c.x, c.z, R.passageRadiusM)) continue;
      layout.zombies.push({x: c.x, z: c.z, yaw: rng.range(-Math.PI, Math.PI), type: types[placed], area: g.area[c.i], ...(lv ? {level: lv, y: g.floorOf(c.i)} : {})});
      return true;
    }
    return false;
  };
  while (placed < count && progress) {
    progress = false;
    for (const k of order) {
      if (placed >= count) break;
      if (tryPlace(cands[k])) { placed++; progress = true; }
    }
  }
  if (placed) { markSpawnContext(layout, first, 'floor'); CROWD.set(layout, {first, n: placed}); }
  return {level: lv, areas: hosts, candidates: cands.map(c => c.length), count, placed, first: placed ? first : -1};
}
