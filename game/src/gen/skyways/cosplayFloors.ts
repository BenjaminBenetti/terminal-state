// Task studio-cosplay-general-20261108-225231-01 (lane UPPER): the convention's cosplay crowd on BOTH public floors of its building.
//
// User: "Convention cosplay zombies need upper-floor presence too, not just bottom."
// Diagnosis (version 5): the whole convention venue (gen/skyways/carve.ts carveVenue: main hall, exhibitors' floor, registration, panel
// rooms, photo lounge, back of house) is ONE storey — the host's skyway floor (addon.level 2, y 10). There is no storey above it, and the
// host stays a classic block without an atrium, gallery or mezzanine. Its street level (storey 1, y 5) is the building's ordinary lobby /
// galleria / court + entrance halls, joined to the venue by the host's public stair core ("the venue's second way in"). The version-5
// run (gen/skyways/cosplaySpawns.ts placeCosplaySpawns) only ever stands on the venue storey, so one of the building's two public floors
// had no cosplayers at all.
//
// Version 6 (SKYWAYS_COSPLAY_FLOORS_MIN_VERSION) appends ONE more run right after it, on every OTHER public storey of the host building
// joined to the venue storey by a stair inside the building (above OR below: written generically, so a venue on storey 1 would get its
// storey-2 floor), U{2..4} spawns (COSPLAY_FLOOR_BUDGET):
//  - the host's public concourse floor on that storey (its lobby / galleria / court pieces, entrance halls, arcades: kind + type
//    'concourse' / 'retail-arcade', publicSpace) — never a shop / anchor store, washroom, back room, stair core or another building;
//    every pick uniform over that storey's stand points (the lobby / court under the venue holds most of the crowd, the entrance halls
//    a share), up to the context's tries per spawn;
//  - the version-5 run's fairness on that storey: walkable FLOOR (props block), never a ramp, 3 x 3 clear, >= 36 walking cells from the
//    start, 5 m off every stair / escalator landing, >= 3 m from every door of a hosting area (shop fronts included) and from the
//    building's boarded street entrances, >= 2.5 m from a mascot statue / off the stage + 1 m where the storey has them, a 0.5 m disc
//    never splitting the storey, 2 m from every enemy already there; standing height = that storey's floor (grid.floorOf);
//  - ordinary zombies (the cosplay context's own zombie-only pool, via the ONE assignEnemyArchetypes), shamblers tagged ZombieSpawn.look
//    'cosplay' and the context 'cosplay' (the costume pick of ai/spawnLook.ts applies to them as to the venue's);
//  - APPENDED after the venue run (after every other spawn of the level): every earlier index — ambient, Siren roll, hordes, annex
//    'service', the venue's cosplayers — keeps its record; its own rng fork (skyways-cosplay-floors). Versions 1-5 never run it (the
//    caller's gate), so a version-5 station regenerates exactly (GAME87 pins).
// It does not report spawn candidates to the census hook (its floor is the street context's, already reported under that context).
// No leash / AI change: the ordinary zombie's behaviour; killed ones stay dead through the ordinary per-index kill memory.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {levelDistance} from '../levelGen';
import {clearAround} from '../stationDress';
import type {Area, StationLayout} from '../stationTypes';
import type {SkywaysRect} from './skywaysTypes';
import {doorPoint} from './addonFrame';
import {COSPLAY_SPAWN_LOOK, COSPLAY_SPAWN_RULES} from './cosplaySpawns';
import {markSpawnContext, sealsPassage, type SpawnProfile} from '../../ai/spawnTables';

/** Spawns of the second-floor run per convention: U{2..4} (one rng.int), additive to the venue run's U{4..6}. */
export const COSPLAY_FLOOR_BUDGET: readonly [number, number] = [2, 4];

/** The second-floor run's own rules (the venue run's keep-offs, COSPLAY_SPAWN_RULES, reused on that storey). */
export const COSPLAY_FLOOR_RULES = {
  /** Area kinds / types of the host's public floor that host cosplayers on the joined storey. */
  kinds: ['concourse'] as readonly Area['kind'][],
  types: ['concourse', 'retail-arcade'] as readonly Area['type'][],
  /** Straight-line keep-off (m) from every door of a hosting area and from the boarded street entrances. */
  doorKeepM: COSPLAY_SPAWN_RULES.doorKeepM,
  statueKeepM: COSPLAY_SPAWN_RULES.statueKeepM,
  stageMarginM: COSPLAY_SPAWN_RULES.stageMarginM,
  passageRadiusM: COSPLAY_SPAWN_RULES.passageRadiusM,
} as const;

/** One storey of the second-floor run (QA / tests). */
export interface CosplayFloorReport {
  level: number;
  /** Hosting areas (layout.areas ids, ascending) and their stand-point candidates. */
  areas: number[];
  candidates: number[];
  placed: number;
}
export interface CosplayFloorsReport {
  /** The venue storey and the storeys the run covers (joined to it by a stair inside the host building). */
  venueLevel: number;
  floors: CosplayFloorReport[];
  count: number;
  placed: number;
  /** Index of the first spawn of this run in layout.zombies (-1 = none placed). */
  first: number;
}
/** The last generated layout's second-floor run (QA / tests; null = no convention / not run). */
export const COSPLAY_FLOOR_STATS: {run: CosplayFloorsReport | null} = {run: null};

const inRect = (r: SkywaysRect, x: number, z: number, pad = 0): boolean => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const rectDist = (r: SkywaysRect, x: number, z: number): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The convention building's OTHER public storeys: every storey joined to the venue storey by a stair link whose both ends lie inside the
 * host building, with that stair's landing there (empty: no convention / no such link).
 */
export function cosplayFloorLevels(layout: Pick<StationLayout, 'skyways' | 'levelLinks'>): {level: number; landings: {x: number; z: number}[]}[] {
  const a = layout.skyways?.addon, b = a ? layout.skyways!.buildings.find(q => q.id === a.building) : undefined;
  if (!a || a.id !== 'convention' || !b) return [];
  const out = new Map<number, {x: number; z: number}[]>();
  for (const k of layout.levelLinks) {
    if (k.lower !== a.level && k.upper !== a.level) continue;
    if (!inRect(b.rect, k.bottom.x, k.bottom.z, 0.01) || !inRect(b.rect, k.top.x, k.top.z, 0.01)) continue;
    const [lv, p] = k.lower === a.level ? [k.upper, k.top] : [k.lower, k.bottom];
    if (!b.levels.includes(lv)) continue;
    (out.get(lv) ?? out.set(lv, []).get(lv)!).push({x: p.x, z: p.z});
  }
  return [...out].sort((p, q) => Math.abs(p[0] - a.level) - Math.abs(q[0] - a.level) || p[0] - q[0]).map(([level, landings]) => ({level, landings}));
}

/** The hosting areas of one joined storey: the host building's public concourse floor there (layout.areas ids, ascending). */
export function cosplayFloorAreas(layout: Pick<StationLayout, 'skyways' | 'areas'>, level: number): number[] {
  const a = layout.skyways?.addon, b = a ? layout.skyways!.buildings.find(q => q.id === a.building) : undefined;
  if (!a || a.id !== 'convention' || !b || level === a.level) return [];
  const own = new Set([...a.areas, ...(a.venue ?? []).map(v => v.area)]);
  const R = COSPLAY_FLOOR_RULES;
  return layout.areas.filter(q => (q.level ?? 0) === level && q.publicSpace && !q.ext && !own.has(q.id) && R.kinds.includes(q.kind) && R.types.includes(q.type)
    && inRect(b.rect, (q.x + q.w / 2) * CELL, (q.y + q.h / 2) * CELL)).map(q => q.id);
}

/**
 * The second-floor cosplay run (call it right after placeCosplaySpawns, before assignEnemyArchetypes; version 6+). `keep` = the storeys'
 * keep points (world metres; the run mouths). Needs the profile's 'cosplay' context (absent = none); draws from `rng` only when the
 * layout has the convention and a joined storey.
 */
export function placeCosplayFloorSpawns(layout: StationLayout, rng: Rng, keep: readonly {level: number; x: number; z: number}[], profile: SpawnProfile): CosplayFloorsReport | null {
  COSPLAY_FLOOR_STATS.run = null;
  const ctx = profile.contexts.cosplay, addon = layout.skyways?.addon;
  const floors = cosplayFloorLevels(layout);
  if (!ctx || ctx.count[1] <= 0 || !addon || addon.id !== 'convention' || !floors.length) return null;
  const R = COSPLAY_FLOOR_RULES, pl = ctx.placement;
  const b = layout.skyways!.buildings.find(q => q.id === addon.building)!;
  const st = layout.skyways?.start ?? {...layout.playerSpawn, level: 0};
  const [sx, sy] = layout.levels[st.level].grid.cellOf(st.x, st.z);
  const dist = levelDistance(layout.levels, sx, sy, st.level, layout.levelLinks);
  type Cand = {i: number; x: number; z: number; area: number};
  type Floor = {level: number; areas: number[]; candidates: number[]; cells: Cand[]};
  const perFloor: Floor[] = [];
  for (const {level: lv} of floors) {
    const g = layout.levels[lv].grid, d = dist[lv];
    const hosts = cosplayFloorAreas(layout, lv), hostSet = new Set(hosts);
    const doors = layout.doors.filter(dr => hostSet.has(dr.a) || hostSet.has(dr.b)).map(dr => doorPoint(dr, layout.areas[hostSet.has(dr.a) ? dr.a : dr.b]));
    const entrances = (layout.skyways!.windows ?? []).filter(w => w.kind === 'entrance' && w.level === lv && 'building' in w.host && w.host.building === b.id);
    const statues = (addon.convention?.statues ?? []).filter(s => s.level === lv);
    const stage = lv === addon.level ? addon.convention?.stage : undefined;
    const pointOk = (x: number, z: number): boolean =>
      !keep.some(k => k.level === lv && Math.hypot(k.x - x, k.z - z) < (pl.landingKeepM ?? 0))
      && !doors.some(p => Math.hypot(p.x - x, p.z - z) < R.doorKeepM)
      && !entrances.some(w => rectDist(w, x, z) < R.doorKeepM)
      && !statues.some(s => Math.hypot(s.x - x, s.z - z) < R.statueKeepM)
      && !(stage && x > stage.x0 - R.stageMarginM && x < stage.x1 + R.stageMarginM && z > stage.z0 - R.stageMarginM && z < stage.z1 + R.stageMarginM);
    const cells: Cand[] = [], candidates: number[] = [];
    for (const id of hosts) {
      const a = layout.areas[id], n0 = cells.length;
      for (let y = Math.max(1, a.y); y < Math.min(g.h - 1, a.y + a.h); y++) for (let x = Math.max(1, a.x); x < Math.min(g.w - 1, a.x + a.w); x++) {
        const i = g.idx(x, y);
        if (g.area[i] !== id || g.cells[i] !== FLOOR || !g.walkable(x, y) || g.rampIdx[i] >= 0 || d[i] < pl.startCells || !clearAround(g, x, y, pl.clearCells)) continue;
        const [px, pz] = g.center(x, y);
        if (pointOk(px, pz)) cells.push({i, x: px, z: pz, area: id});
      }
      candidates.push(cells.length - n0);
    }
    perFloor.push({level: lv, areas: hosts, candidates, cells});
  }
  // --- the run: one count; every pick uniform over its storey's stand points (the crowd follows the floor: the lobby / court under the
  // venue holds most of it, the entrance halls a share); the storeys round-robin
  const count = rng.int(COSPLAY_FLOOR_BUDGET[0], COSPLAY_FLOOR_BUDGET[1]);
  const order = perFloor.filter(f => f.cells.length > 0);
  const first = layout.zombies.length;
  const placedOn = new Map<number, number>();
  const tryPlace = (f: Floor): boolean => {
    const g = layout.levels[f.level].grid;
    for (let t = 0; t < pl.tries; t++) {
      const c = rng.pick(f.cells);
      if (layout.zombies.some(z => (z.level ?? 0) === f.level && Math.hypot(z.x - c.x, z.z - c.z) < pl.spacingM)) continue;
      if (sealsPassage(g, c.x, c.z, R.passageRadiusM)) continue;
      layout.zombies.push({x: c.x, z: c.z, yaw: rng.range(-Math.PI, Math.PI), type: 'shambler', area: c.area, ...(f.level ? {level: f.level, y: g.floorOf(c.i)} : {}), look: COSPLAY_SPAWN_LOOK});
      placedOn.set(f.level, (placedOn.get(f.level) ?? 0) + 1);
      return true;
    }
    return false;
  };
  let placed = 0, progress = true;
  while (placed < count && progress) {
    progress = false;
    for (const f of order) {
      if (placed >= count) break;
      if (tryPlace(f)) { placed++; progress = true; }
    }
  }
  if (placed) markSpawnContext(layout, first, 'cosplay');
  const run: CosplayFloorsReport = {
    venueLevel: addon.level, count, placed, first: placed ? first : -1,
    floors: perFloor.map(f => ({level: f.level, areas: f.areas, candidates: f.candidates, placed: placedOn.get(f.level) ?? 0})),
  };
  COSPLAY_FLOOR_STATS.run = run;
  return run;
}
