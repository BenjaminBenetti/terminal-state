// Task track3-eaton-centre-20261031 (lane HORDE): generation-time placement of the roaming hordes — pure data (no three.js).
//
// Called ONCE per generated layout by the level generator (gen/mall/index.ts, lane GEN), LAST among the enemy passes:
//   ambient spawns -> assignEnemyArchetypes(layout, profile) -> placeHordes(layout, profile.horde, rng.fork('mall-hordes'), …)
// so the ambient family roll never touches a horde member (and assignEnemyArchetypes skips `horde` members anyway).
//
// What it does (all draws on the given rng, in this order — deterministic per layout seed):
//  1. groups = rng.int(rules.groups) (the level tries to place that many);
//  2. per group: a start storey among the eligible ones that still have room in the horde budget (perStorey members,
//     groupsPerStorey groups) and an eligible start node there — a patrol node (layout.mall.patrol) on a walkable, clear,
//     non-stair cell, at least placement.startM walking metres (and placement.startClearM straight 3D metres: lane PROFILES, mall
//     revision) from the player start, groupSpacingM from every other group's
//     start on that storey; size = rng.int(rules.size) clipped to the remaining total / storey budget and (task
//     mall-playtest-revision-20261031, lane PROFILES) to the storey's ROUTE CAPACITY (placement.routeMPerMember: patrol-route metres
//     per member) (a group that cannot get HORDE_GROUP_SIZE.min members is not placed: never a horde of fewer than five);
//  3. members on that storey's walkable, clear, non-stair cells reachable from the start node within placement.clusterM
//     (a loose crowd, memberSpacingM apart, ambientSpacingM from the ambient enemies), types by rules.zombieTypes, families by the
//     horde's OWN pool (hordeFamilyRoll: never the ambient roll), facing the group's first patrol direction.
// Members are appended to layout.zombies with `horde: groupId` (+ level / y as every multi-storey spawn); the group record goes to
// layout.hordes. Nothing here ever runs again for the layout: kills persist by layout.zombies index (run/memory.ts), so a dead
// member is never replaced and an all-dead group stays dead.

import type {Rng} from '../core/rng';
import {FLOOR, CELL} from '../gen/grid';
import {levelDistance} from '../gen/levelGen';
import type {MallPatrolNode} from '../gen/mall/mallTypes';
import type {StationLayout, ZombieSpawn} from '../gen/stationTypes';
import type {EnemyArchetypeId} from './creatureSpawn';
import {HORDE_CONTEXT, markSpawnContext, rollZombieTypes} from './spawnTables';
import {HORDE_GROUP_SIZE, hordeFamilyRoll, pickHordeFamily, type HordeGroupSpec, type HordeRules} from './hordeSpec';

export interface HordePlacementReport {
  /** Groups the rng asked for / groups placed. */
  asked: number;
  placed: number;
  /** Members placed (all groups). */
  members: number;
  /** Members / groups starting per storey. */
  perStorey: Record<number, {groups: number; members: number}>;
  /** Why a group was not placed (budget / no eligible node / too few member cells), per attempt. */
  skipped: string[];
  /** Patrol nodes eligible as a start per storey (QA). */
  eligibleNodes: Record<number, number>;
  /** Task mall-playtest-revision-20261031 (lane PROFILES): members the storey's patrol route holds (placement.routeMPerMember; absent = no bound). */
  routeCapacity: Record<number, number>;
}

/**
 * Task mall-playtest-revision-20261031 (lane PROFILES, D07): the walkable patrol ROUTE of one storey (m) — the summed straight
 * length of its same-storey patrol edges, each undirected edge once (vertical links are not route on any one storey).
 */
export function patrolRouteM(patrol: readonly MallPatrolNode[], level: number): number {
  const byId = new Map(patrol.map(n => [n.id, n]));
  let m = 0;
  for (const n of patrol) {
    if (n.level !== level) continue;
    for (const e of n.edges) {
      const t = byId.get(e.to);
      if (t && t.level === level && t.id > n.id) m += Math.hypot(t.x - n.x, t.z - n.z);
    }
  }
  return m;
}

export interface HordePlaceOptions {
  /** Walking distance (cells) from the player start per level (gen/levelGen.ts levelDistance); computed when absent. */
  dist?: Int32Array[];
  /** The patrol graph (default layout.mall.patrol). */
  patrol?: readonly MallPatrolNode[];
  /** Eligible start storeys when rules.placement.storeys is 'rings' and the layout has no mall record (tests). */
  ringStoreys?: readonly number[];
}

/** Storeys a group may start on. */
export function hordeStartStoreys(layout: StationLayout, rules: HordeRules, ringStoreys?: readonly number[]): number[] {
  const s = rules.placement.storeys;
  if (s !== 'rings') return s.filter(l => l >= 0 && l < layout.levels.length);
  const rings = layout.mall?.storeys.filter(t => t.role === 'ring').map(t => t.level) ?? ringStoreys ?? [];
  return rings.filter(l => l >= 0 && l < layout.levels.length);
}

/** The node's cell on its storey grid is a valid place to stand (walkable FLOOR, no stair ramp, 3 x 3 clear). */
function standable(layout: StationLayout, lv: number, x: number, z: number): boolean {
  const g = layout.levels[lv]?.grid;
  if (!g) return false;
  const [cx, cy] = g.cellOf(x, z);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!g.walkable(cx + ox, cy + oy) || g.rampIdx[g.idx(cx + ox, cy + oy)] >= 0 || onStair(layout, g, g.idx(cx + ox, cy + oy))) return false;
  }
  return g.circleClear(x, z, 0.4);
}

/** A cell of a stair-role area (a run's flat top landing has no ramp index): never a horde start / member cell. */
function onStair(layout: StationLayout, g: StationLayout['grid'], i: number): boolean {
  return layout.areas[g.area[i]]?.role === 'stair';
}

/**
 * Places the level's hordes (see the file comment). Mutates layout.zombies (appends) and sets layout.hordes. Returns a report.
 */
export function placeHordes(layout: StationLayout, rules: HordeRules | undefined, rng: Rng, opts: HordePlaceOptions = {}): HordePlacementReport {
  const first = layout.zombies.length; // lane INTEG (Track1 integration): the members appended below are tagged HORDE_CONTEXT
  const report: HordePlacementReport = {asked: 0, placed: 0, members: 0, perStorey: {}, skipped: [], eligibleNodes: {}, routeCapacity: {}};
  layout.hordes = [];
  if (!rules) return report;
  const patrol = opts.patrol ?? layout.mall?.patrol ?? [];
  const storeys = hordeStartStoreys(layout, rules, opts.ringStoreys);
  const P = rules.placement, B = rules.budget;
  report.asked = rng.int(rules.groups[0], rules.groups[1]);
  if (!report.asked) return report;
  if (!patrol.length || !storeys.length) { report.skipped.push(patrol.length ? 'no eligible storey' : 'no patrol graph'); return report; }
  let dist = opts.dist;
  if (!dist) {
    const [sx, sy] = layout.grid.cellOf(layout.playerSpawn.x, layout.playerSpawn.z);
    dist = levelDistance(layout.levels, sx, sy, layout.mall?.start.level ?? 0, layout.levelLinks);
  }
  const startCells = Math.ceil(P.startM / CELL);
  // (lane PROFILES, mall revision) the player start in 3D: a start node within startClearM (straight) is in plain view on arrival
  const st = layout.mall?.start ?? {x: layout.playerSpawn.x, z: layout.playerSpawn.z, level: 0};
  const stG = layout.levels[st.level ?? 0]?.grid ?? layout.grid, stY = stG.cellFloor(...stG.cellOf(st.x, st.z));
  const byStorey = new Map<number, MallPatrolNode[]>();
  for (const n of patrol) {
    if (!storeys.includes(n.level) || !n.edges.length) continue;
    const g = layout.levels[n.level].grid, [cx, cy] = g.cellOf(n.x, n.z);
    const d = dist[n.level]?.[g.idx(cx, cy)] ?? -1;
    if (d < startCells || !standable(layout, n.level, n.x, n.z)) continue;
    if (P.startClearM !== undefined && Math.hypot(n.x - st.x, g.cellFloor(cx, cy) - stY, n.z - st.z) < P.startClearM) continue;
    let l = byStorey.get(n.level);
    if (!l) byStorey.set(n.level, (l = []));
    l.push(n);
  }
  for (const s of storeys) report.eligibleNodes[s] = byStorey.get(s)?.length ?? 0;
  // (lane PROFILES, mall revision) route capacity per storey: members its patrol route holds (no draw; absent knob = the budget alone)
  const routeCap = new Map<number, number>();
  if (P.routeMPerMember !== undefined && P.routeMPerMember > 0) for (const s of storeys) routeCap.set(s, Math.floor(patrolRouteM(patrol, s) / P.routeMPerMember));
  for (const [s, c] of routeCap) report.routeCapacity[s] = c;
  const groupsOn = new Map<number, number>(), membersOn = new Map<number, number>();
  const starts: {level: number; x: number; z: number}[] = [];
  let total = 0;
  for (let gi = 0; gi < report.asked; gi++) {
    const left = B.total - total;
    if (left < HORDE_GROUP_SIZE.min || left < rules.size[0]) { report.skipped.push(`group ${gi}: horde budget total ${B.total} exhausted`); break; }
    // storeys with room for one more group (budget) and an eligible, spaced start node
    const options = storeys.map(s => {
      if ((groupsOn.get(s) ?? 0) >= B.groupsPerStorey) return null;
      const room = Math.min(B.perStorey, routeCap.get(s) ?? Infinity) - (membersOn.get(s) ?? 0);
      if (room < Math.max(HORDE_GROUP_SIZE.min, rules.size[0])) return null;
      const nodes = (byStorey.get(s) ?? []).filter(n => starts.every(q => q.level !== s || Math.hypot(q.x - n.x, q.z - n.z) >= P.groupSpacingM));
      return nodes.length ? {s, nodes, room} : null;
    }).filter((o): o is {s: number; nodes: MallPatrolNode[]; room: number} => o !== null);
    if (!options.length) { report.skipped.push(`group ${gi}: no storey with horde budget and a spaced eligible start node`); break; }
    const opt = rng.pick(options);
    const node = rng.pick(opt.nodes);
    const want = Math.min(rng.int(rules.size[0], rules.size[1]), left, opt.room);
    if (want < Math.max(HORDE_GROUP_SIZE.min, rules.size[0])) { report.skipped.push(`group ${gi}: only ${want} members left in the budget`); continue; }
    const cells = memberCells(layout, node, P, rng);
    // greedy spaced pick in jittered distance order
    const lv = node.level, g = layout.levels[lv].grid;
    const others = layout.zombies.filter(z => (z.level ?? 0) === lv);
    const picked: [number, number, number][] = [];
    for (const c of cells) {
      if (picked.length >= want) break;
      const [x, z] = g.center(c % g.w, (c / g.w) | 0);
      if (picked.some(p => Math.hypot(p[0] - x, p[1] - z) < P.memberSpacingM)) continue;
      if (others.some(o => Math.hypot(o.x - x, o.z - z) < P.ambientSpacingM)) continue;
      picked.push([x, z, c]);
    }
    if (picked.length < Math.max(HORDE_GROUP_SIZE.min, rules.size[0])) { report.skipped.push(`group ${gi}: only ${picked.length} member cells near node ${node.id} (L${lv})`); continue; }
    const id = layout.hordes.length;
    const types = rollZombieTypes(rng, picked.length, rules.zombieTypes);
    // face the first patrol direction (a neighbour on the same storey when there is one)
    const nb = node.edges.map(e => patrol.find(n => n.id === e.to)).find(n => n && n.level === lv) ?? node.edges.map(e => patrol.find(n => n.id === e.to)).find(n => n);
    const yaw0 = nb ? Math.atan2(nb.x - node.x, nb.z - node.z) : rng.range(-Math.PI, Math.PI);
    const members: number[] = [];
    const seed = (Math.imul(layout.seed >>> 0, 0x9e3779b1) ^ Math.imul(id + 1, 0x85ebca6b) ^ (rng.int(0, 0x7fffffff) | 0)) >>> 0;
    picked.forEach(([x, z, c], k) => {
      const archetype = pickHordeFamily(rules.families, hordeFamilyRoll(layout.seed, id, k)) as EnemyArchetypeId;
      const s: ZombieSpawn = {x, z, yaw: yaw0 + rng.range(-0.5, 0.5), type: types[k], area: g.area[c], archetype, horde: id};
      if (lv) { s.level = lv; s.y = g.floorOf(c); }
      members.push(layout.zombies.length);
      layout.zombies.push(s);
    });
    const spec: HordeGroupSpec = {id, level: lv, members, startNode: node.id, start: {x: node.x, y: layout.levels[lv].grid.cellFloor(...g.cellOf(node.x, node.z)), z: node.z}, seed};
    layout.hordes.push(spec);
    starts.push({level: lv, x: node.x, z: node.z});
    groupsOn.set(lv, (groupsOn.get(lv) ?? 0) + 1);
    membersOn.set(lv, (membersOn.get(lv) ?? 0) + picked.length);
    total += picked.length;
    report.placed++;
    report.members += picked.length;
  }
  for (const [s, n] of groupsOn) report.perStorey[s] = {groups: n, members: membersOn.get(s) ?? 0};
  // Lane INTEG (Track1 integration): every member carries the horde pool's own declared context (spawnTables declaredSpawnContexts),
  // never an ambient one — no ambient family rule (eligibility) can name it. Generation-time side table: layout data unchanged.
  markSpawnContext(layout, first, HORDE_CONTEXT);
  return report;
}

/**
 * Candidate member cells around a start node, nearest first with a little seeded jitter: walkable FLOOR (no track bed), no stair
 * ramp, 3 x 3 clear, at the node's floor height (a flood over the node's storey grid that never steps more than 0.3 m), within
 * clusterM metres (straight) of the node.
 */
function memberCells(layout: StationLayout, node: MallPatrolNode, P: HordeRules['placement'], rng: Rng): number[] {
  const g = layout.levels[node.level].grid, W = g.w;
  const [sx, sy] = g.cellOf(node.x, node.z);
  if (!g.walkable(sx, sy)) return [];
  const R = Math.ceil(P.clusterM / CELL) + 1;
  const seen = new Set<number>([g.idx(sx, sy)]);
  const q = [g.idx(sx, sy)];
  const out: {c: number; k: number}[] = [];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % W, cy = (c / W) | 0, f = g.floorOf(c);
    const [wx, wz] = g.center(cx, cy);
    const d = Math.hypot(wx - node.x, wz - node.z);
    if (d <= P.clusterM && g.rampIdx[c] < 0 && !onStair(layout, g, c) && clear3(g, cx, cy) && g.circleClear(wx, wz, 0.4)) out.push({c, k: d + rng.next() * 1.5});
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + ox, ny = cy + oy;
      if (Math.abs(nx - sx) > R || Math.abs(ny - sy) > R || !g.inBounds(nx, ny)) continue;
      const n = g.idx(nx, ny);
      if (seen.has(n) || g.cells[n] !== FLOOR || g.blocked[n] || Math.abs(g.floorOf(n) - f) > 0.3) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return out.sort((a, b) => a.k - b.k).map(o => o.c);
}

function clear3(g: StationLayout['grid'], x: number, y: number): boolean {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy)) return false;
  return true;
}
