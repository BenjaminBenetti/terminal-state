// Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): an ORDINARY DISCOVERY ROUTE through a service annex, walked
// by the game's real Player (movement, prop collision, falls, ladder climb; W key along the game's PathFinder routes) while the
// annex's service enemies run the game's real ZombieBrain + moveZombie on a BrainWorld built like Game.brainWorld.
//
// The route is chosen from the layout's TOPOLOGY only (no loot / enemy ground truth): platform start -> tunnel mouth -> along the
// tunnel to the annex door (or the bed-wall hatch) -> through the door -> room by room, always the nearest not-yet-visited annex
// area by walking distance -> in each visited room the holders a player would try are opened in placement order through the real
// ContainerManager targeting / interact ([E]) -> back to a bed rescue ladder and up to the platform.
// It records: holders passed / opened (empty vs stocked), the first ordinary loot (route metres, rooms), inventory gains, and every
// enemy that becomes AWARE of the player (chase / attack) with the route metres / rooms at that moment.
// Approximation (stated in every report): enemies run as ZombieBrain(spawn.type) — rat-dog / Blightbelly / Siren use their own
// creature actors in the game; the player never shoots (no gunfire alerts); lights do not lure (no flashlight).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {LEVELS} from '../../src/levels/registry';
import {createRun} from '../../src/run/runState';
import {rollLevelGear} from '../../src/levels/gearAdapter';
import {levelsOf} from '../../src/gen/levels';
import {CELL, PathFinder} from '../../src/gen/grid';
import {Player, STAND_EYE, type MoveInput} from '../../src/player/player';
import {PropIndex} from '../../src/core/physics';
import {ladderTarget} from '../../src/gen/traversal';
import {Inventory} from '../../src/items/inventory';
import {ANNEX_CACHE_KEY, lootProfile} from '../../src/items/lootTables';
import {ITEMS} from '../../src/items/items';
import {WorldMaterials} from '../../src/world/materials';
import {ContainerManager, type Holder} from '../../src/world/containers';
import {ZombieBrain, type BrainWorld} from '../../src/ai/brain';
import {moveZombie} from '../../src/ai/motor';
import {searchExpand} from '../../src/ai/chaseShare';
import {lureWorld} from '../../src/ai/lightLure';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {ServiceAnnex} from '../../src/gen/trackExt/types';
import type {LevelId} from '../../src/levels/types';
import {fakeEnvTextures} from './openablesFixture';
import {doorOfMark, doorsOfArea, marksIn} from './cacheMarks'; // (round 3, lane HIDEOUT) the trail reader
import {doorSide} from '../../src/gen/placeKit'; // (round 3, lane HIDEOUT)

const DT = 1 / 30;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

export interface RouteEvent { t: number; metres: number; rooms: number; what: string; detail?: Record<string, unknown> }
export interface RouteReport {
  level: LevelId; seed: number; annex: number; entry: 'tunnel' | 'hatch'; areaM2: number;
  /** Round 2 (lane CACHE, R5): how the next room is chosen ('nearest' unvisited by walking distance; 'deeper': see walkAnnexRoute). */
  strategy: RouteStrategy;
  roomsVisited: number; roomsTotal: number; metres: number; seconds: number;
  holders: {opened: number; empty: number; stocked: number; takenItems: string[]};
  firstLoot: {metres: number; rooms: number; itemId: string; holder: string} | null;
  enemies: {total: number; aware: number; firstAware: {metres: number; rooms: number; dist: number} | null};
  /**
   * Round 2 (lane CACHE, R5): the survivor cache(s) met on the route — when the route first entered a cache room (route metres, rooms,
   * door-hop depth of that room vs the annex's deepest), the cache holders opened there (ids `<kind>#<serial>@x,z`), what was taken
   * from them (inventory delta) — null when the route never reached one. Ground truth is read only for this record, never to steer.
   */
  cache: {metres: number; rooms: number; depth: number; maxDepth: number; area: number; holdersOpened: number; holderIds: string[]; taken: Record<string, number>} | null;
  /** Deepest door-hop depth the route reached / the annex's deepest. */
  depthReached: number; maxDepth: number;
  /** Inventory delta of the whole route (item -> count taken). */
  inventory: Record<string, number>;
  returned: boolean; minY: number; maxDy: number; events: RouteEvent[];
  /** (round 3, strategy 'marks') areas entered by reading a mark, walked through as a corridor, chosen while lost. */
  trail?: {read: number; corridor: number; lost: number};
}
/**
 * Room choice of a route — 'nearest': the nearest unvisited annex area by walking distance (the playtest revision's ordinary route);
 * 'deeper' (round 2, lane CACHE): an explorer pushing on into the annex — among the unvisited areas that share a door with an area
 * already visited (the frontier: what the player can see the way to), the one deepest by door hops from the entry, ties by walking
 * distance; dead ends are entered and the route backtracks to the frontier. Topology only: never the loot / cache ground truth.
 * 'marks' (round 3, lane HIDEOUT): a player following ONLY the survivor's trail they can see — in each area the marks on its walls,
 * read by helpers/cacheMarks.ts doorOfMark (the mark's wall, place and arrow; never the record's door / next / step or the cache);
 * an unmarked area with a single way on is walked through; with no readable mark at a choice the player is LOST and explores (the
 * nearest unvisited neighbouring area, else the nearest unvisited area next to a visited one) until a mark is seen again. Holders
 * are opened only in the room where the route ends (its arrival is recognised like 'deeper' records it: the room's cache key, read
 * only to report / stop, never to choose).
 */
export type RouteStrategy = 'nearest' | 'deeper' | 'marks';

/** A fresh New Game layout exactly as Game.newGame / prepareSection generate it. */
export function freshLayout(level: LevelId, seed: number): StationLayout {
  const key = {level, section: 'main'};
  const run = createRun({seeds: {subway: seed, office: seed, mall: seed} as never, start: key as never, levels: LEVELS, rollGear: rollLevelGear});
  return LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: run.gearFor(key as never)} as never);
}

/** Walks one annex's ordinary discovery route. `maxRooms` bounds the exploration (rooms in the strategy's order). */
export function walkAnnexRoute(level: LevelId, seed: number, annexId: number, models: Record<string, GLTF>, o: {maxRooms?: number; openPerRoom?: number; strategy?: RouteStrategy} = {}): RouteReport {
  const strategy = o.strategy ?? 'nearest';
  const layout = freshLayout(level, seed);
  const ext = layout.extensions!;
  const A: ServiceAnnex = ext.annexes.find(a => a.id === annexId)!;
  const L = levelsOf(layout), pf = new PathFinder(L), props = new PropIndex(L, layout.props);
  const inv = new Inventory();
  const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => inv);
  cm.build(layout, {}, lootProfile(level));
  const annexAreas = new Set(A.areas);
  const p = new Player(), sp = layout.playerSpawn;
  p.spawn(sp.x, sp.z, sp.yaw, layout.grid.floorAt(sp.x, sp.z));
  const keys = new Keys();
  let t = 0, metres = 0, rooms = 0, maxDy = 0, minY = Infinity;
  const events: RouteEvent[] = [];
  const ev = (what: string, detail?: Record<string, unknown>) => events.push({t: +t.toFixed(1), metres: +metres.toFixed(1), rooms, what, ...(detail ? {detail} : {})});
  // the annex's service enemies (layout.zombies in its areas), real brains + motor
  let rs = 0x9e3779b9 ^ seed;
  const rand = () => { rs = (rs + 0x6d2b79f5) | 0; let x = Math.imul(rs ^ (rs >>> 15), 1 | rs); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const enemies = layout.zombies.map((s, i) => ({s, i})).filter(q => annexAreas.has(q.s.area)).map(q => {
    const b = new ZombieBrain(q.s.type, q.s.x, q.s.z, q.s.yaw);
    b.y = q.s.y ?? L.grid(q.s.level ?? 0).floorAt(q.s.x, q.s.z);
    return {i: q.i, b, aware: false};
  });
  let firstAware: RouteReport['enemies']['firstAware'] = null;
  const lights = {attracting: () => []};
  const world = (): BrainWorld => ({
    px: p.x, pz: p.z, py: p.y, playerAlive: true,
    los: (ax, az, bx, bz, ay, by) => ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : layout.grid.lineOfSight(ax, az, bx, bz),
    walkClear: (ax, az, bx, bz, r, ay, by) => ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : layout.grid.walkLineClearH(ax, az, bx, bz, r),
    findPath: (ax, az, bx, bz, op) => pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op),
    ladder: id => layout.traversal.ladders[id],
    randomNear: (x, z, r, y) => {
      const lv = y !== undefined ? L.levelAt(x, z, y + 0.05) : 0, G = lv > 0 ? L.grid(lv) : layout.grid;
      for (let k = 0; k < 14; k++) {
        const [cx, cy] = G.cellOf(x + (rand() * 2 - 1) * r, z + (rand() * 2 - 1) * r);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand,
    ...lureWorld(L, lights),
  });
  const stepWorld = () => {
    const w = world();
    for (const e of enemies) {
      const out = e.b.update(DT, w);
      moveZombie(e.b, out, DT, L, props);
      if (!e.aware && (e.b.state === 'chase' || e.b.state === 'attack')) {
        e.aware = true;
        const d = Math.hypot(e.b.x - p.x, e.b.z - p.z);
        ev('enemy aware', {i: e.i, state: e.b.state, dist: +d.toFixed(1), y: +e.b.y.toFixed(2)});
        firstAware ??= {metres: +metres.toFixed(1), rooms, dist: +d.toFixed(1)};
      }
    }
  };
  const walkTo = (x: number, z: number, y: number, capS = 90): boolean => {
    const route = pf.find(p.x, p.z, x, z, 0.3, 400000, {ay: p.y, by: y});
    if (!route) return false;
    keys.held.add('KeyW');
    let i = 0;
    for (let f = 0; f < capS / DT; f++) {
      while (i < route.length && Math.hypot(route[i][0] - p.x, route[i][1] - p.z) < 0.35 && (route[i][3] === undefined || Math.abs(route[i][3]! - p.y) < 0.9)) i++;
      if (i >= route.length) { keys.held.clear(); return true; }
      p.yaw = Math.atan2(-(route[i][0] - p.x), -(route[i][1] - p.z));
      const x0 = p.x, z0 = p.z, y0 = p.y;
      p.update(DT, keys, L, props, OPTS);
      metres += Math.hypot(p.x - x0, p.z - z0); maxDy = Math.max(maxDy, Math.abs(p.y - y0)); minY = Math.min(minY, p.y); t += DT;
      stepWorld();
    }
    keys.held.clear();
    return false;
  };
  const areaCentre = (id: number) => { const a = layout.areas[id]; return {x: (a.x + a.w / 2) * CELL, z: (a.y + a.h / 2) * CELL}; };
  // 1. platform -> tunnel / bed -> annex door
  const entry: 'tunnel' | 'hatch' = A.tunnel >= 0 ? 'tunnel' : 'hatch';
  if (A.tunnel >= 0) {
    const T = ext.tunnels[A.tunnel];
    const at = (s: number) => { let acc = 0; for (let k = 1; k < T.path.length; k++) { const a = T.path[k - 1], b = T.path[k], d = Math.hypot(b.x - a.x, b.z - a.z); if (acc + d >= s) { const f = (s - acc) / d; return {x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f}; } acc += d; } return T.path[T.path.length - 1]; };
    const m = at(4);
    ev('tunnel mouth', {ok: walkTo(m.x, m.z, T.floorY)});
  }
  ev('annex door', {ok: walkTo(A.exit.x, A.exit.z, A.floorY)});
  // 2. room by room (topology only): 'nearest' — the nearest not-yet-visited annex area by walking distance; 'deeper' — the deepest
  // area of the frontier (unvisited, sharing a door with a visited area or the way in), ties by walking distance
  const unvisited = new Set(A.areas);
  const maxRooms = o.maxRooms ?? A.areas.length, openPerRoom = o.openPerRoom ?? 6;
  let opened = 0, empty = 0, stocked = 0;
  const taken: string[] = [];
  let firstLoot: RouteReport['firstLoot'] = null;
  const ids = new Set(A.areas), adj = new Map<number, number[]>();
  for (const d of layout.doors) if (ids.has(d.a) && ids.has(d.b) && d.a !== d.b) { (adj.get(d.a) ?? adj.set(d.a, []).get(d.a)!).push(d.b); (adj.get(d.b) ?? adj.set(d.b, []).get(d.b)!).push(d.a); }
  const seen = new Set<number>([layout.doors[A.door].a, layout.doors[A.door].b].filter(id => ids.has(id))); // the way in
  const maxDepth = Math.max(...A.areas.map(id => layout.areas[id].depth));
  let depthReached = 0, cache: RouteReport['cache'] = null;
  const inv0 = new Map<string, number>(Object.keys(ITEMS).map(id => [id, inv.count(id)]));
  const walkDist = (id: number) => {
    const c = areaCentre(id), r = pf.find(p.x, p.z, c.x, c.z, 0.3, 400000, {ay: p.y, by: A.floorY});
    if (!r) return Infinity;
    let d = 0; for (let k = 1; k < r.length; k++) d += Math.hypot(r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1]);
    return d;
  };
  // (round 3, lane HIDEOUT) 'marks': follow the survivor's trail (see RouteStrategy)
  const throughDoor = (door: number, next: number): [number, number] => {
    const na = layout.areas[next], g = layout.grid;
    let tx = (na.x + na.w / 2) * CELL, tz = (na.y + na.h / 2) * CELL;
    if (door >= 0) {
      const d = layout.doors[door], sd = doorSide(d, na), cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL;
      tx = cx + (sd === 'W' ? 1.2 : sd === 'E' ? -1.2 : 0); tz = cz + (sd === 'N' ? 1.2 : sd === 'S' ? -1.2 : 0);
    }
    let best: [number, number] = [tx, tz], bd = Infinity;
    for (let y = na.y; y < na.y + na.h; y++) for (let x = na.x; x < na.x + na.w; x++) {
      if (!g.walkable(x, y) || g.area[g.idx(x, y)] !== next || !g.circleClear((x + 0.5) * CELL, (y + 0.5) * CELL, 0.36)) continue;
      const dd = Math.hypot((x + 0.5) * CELL - tx, (y + 0.5) * CELL - tz);
      if (dd < bd) { bd = dd; best = [(x + 0.5) * CELL, (y + 0.5) * CELL]; }
    }
    return best;
  };
  const trail = {read: 0, corridor: 0, lost: 0};
  let cur = [layout.doors[A.door].a, layout.doors[A.door].b].find(id => ids.has(id))!, came = A.door;
  if (strategy === 'marks') { unvisited.delete(cur); rooms++; ev('room', {area: cur, how: 'entry', purpose: layout.areas[cur].purpose}); }
  while (strategy === 'marks' && rooms < maxRooms && !cache) {
    const a = layout.areas[cur];
    // the cache room is recognised on arrival (record / stop only): open its holders, done
    if (cm.all.some(h => h.prop.area === cur && h.prop.purpose === ANNEX_CACHE_KEY)) {
      cache = {metres: +metres.toFixed(1), rooms, depth: a.depth, maxDepth, area: cur, holdersOpened: 0, holderIds: [], taken: {}};
      ev('cache room', {...cache});
      for (const h of cm.all.filter(q => q.prop.area === cur && q.prop.purpose === ANNEX_CACHE_KEY)) {
        const {aim, stand} = cm.aimPoint(h);
        if (!walkTo(stand.x, stand.z, A.floorY, 20)) continue;
        const eye = new THREE.Vector3(p.x, p.y + STAND_EYE, p.z), dir = new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize();
        if (cm.target(eye, dir, L)?.container !== h) continue;
        opened++;
        const got = openAndTake(cm, h, inv);
        cache.holdersOpened++;
        cache.holderIds.push(`${h.kind}#${h.serial}@${h.prop.x.toFixed(2)},${h.prop.z.toFixed(2)}`);
        for (const id of got) cache.taken[id] = (cache.taken[id] ?? 0) + 1;
        if (got.length) { stocked++; taken.push(...got); } else empty++;
      }
      break;
    }
    let door = -1, how = '';
    for (const m of marksIn(layout, cur)) { const d = doorOfMark(layout, a, m); if (d >= 0 && d !== came) { door = d; how = `read ${m.kind}`; break; } }
    if (door < 0) {
      const others = doorsOfArea(layout, a).filter(i => i !== came && layout.doors[i].a !== layout.doors[i].b && ids.has(layout.doors[i].a) && ids.has(layout.doors[i].b));
      if (others.length === 1) { door = others[0]; how = 'corridor'; }
    }
    let next = -1;
    if (door >= 0) {
      const d = layout.doors[door];
      next = d.a === cur ? d.b : d.a;
      if (how === 'corridor') trail.corridor++; else trail.read++;
    } else {
      // lost: the nearest unvisited neighbour, else the nearest unvisited area next to a visited one
      trail.lost++;
      let bd = Infinity;
      const near = (adj.get(cur) ?? []).filter(q => unvisited.has(q));
      const pool = near.length ? near : [...unvisited].filter(id => (adj.get(id) ?? []).some(q => !unvisited.has(q)));
      for (const id of pool) { const dd = walkDist(id); if (dd < bd) { bd = dd; next = id; } }
      how = 'lost';
      came = -1;
    }
    if (next < 0) break;
    if (door >= 0) came = door;
    // through the doorway: a walkable cell just inside the next area (a metre past the opening), else its centre / any free cell
    if (!walkTo(...throughDoor(door, next), A.floorY) && !walkTo(areaCentre(next).x, areaCentre(next).z, A.floorY)) { ev('room unreachable', {area: next}); unvisited.delete(next); continue; }
    unvisited.delete(next);
    cur = next;
    rooms++;
    depthReached = Math.max(depthReached, layout.areas[cur].depth);
    ev('room', {area: cur, how, purpose: layout.areas[cur].purpose, depth: layout.areas[cur].depth});
  }
  while (strategy !== 'marks' && unvisited.size && rooms < maxRooms) {
    let best = -1, bestD = Infinity, bestDepth = -1;
    const cands = strategy === 'deeper' ? [...unvisited].filter(id => seen.has(id) || (adj.get(id) ?? []).some(q => !unvisited.has(q))) : [...unvisited];
    for (const id of cands) {
      const dep = layout.areas[id].depth;
      if (strategy === 'deeper' && dep < bestDepth) continue;
      const d = walkDist(id);
      if (d === Infinity) continue;
      if (strategy === 'deeper' ? dep > bestDepth || d < bestD : d < bestD) { bestD = d; best = id; bestDepth = dep; }
    }
    if (best < 0) break;
    unvisited.delete(best);
    for (const q of adj.get(best) ?? []) seen.add(q);
    const c = areaCentre(best);
    if (!walkTo(c.x, c.z, A.floorY)) { ev('room unreachable', {area: best}); continue; }
    rooms++;
    depthReached = Math.max(depthReached, layout.areas[best].depth);
    ev('room', {area: best, purpose: layout.areas[best].purpose, type: layout.areas[best].type, depth: layout.areas[best].depth, holders: cm.all.filter(h => h.prop.area === best).length});
    // try the room's holders a player would open / look at, in placement order (no stocked-first knowledge)
    const here = cm.all.filter(h => h.prop.area === best).slice(0, openPerRoom);
    // (record only) a survivor cache room: the cache key is read to REPORT what the route met there, never to choose rooms / holders
    const cacheHere = here.some(h => h.prop.purpose === ANNEX_CACHE_KEY);
    if (cacheHere && !cache) { cache = {metres: +metres.toFixed(1), rooms, depth: layout.areas[best].depth, maxDepth, area: best, holdersOpened: 0, holderIds: [], taken: {}}; ev('cache room', {...cache}); }
    for (const h of here) {
      const {aim, stand} = cm.aimPoint(h);
      if (!walkTo(stand.x, stand.z, A.floorY, 20)) { ev('holder unreachable', {kind: h.kind, purpose: h.prop.purpose}); continue; }
      const eye = new THREE.Vector3(p.x, p.y + STAND_EYE, p.z), dir = new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize();
      const tg = cm.target(eye, dir, L);
      if (tg?.container !== h) { ev('holder not targeted', {kind: h.kind, purpose: h.prop.purpose, hit: tg?.container?.kind ?? null, d: +Math.hypot(aim.x - p.x, aim.z - p.z).toFixed(2)}); continue; }
      opened++;
      const got = openAndTake(cm, h, inv);
      if (h.prop.purpose === ANNEX_CACHE_KEY && cache?.area === best) {
        cache.holdersOpened++;
        cache.holderIds.push(`${h.kind}#${h.serial}@${h.prop.x.toFixed(2)},${h.prop.z.toFixed(2)}`);
        for (const id of got) cache.taken[id] = (cache.taken[id] ?? 0) + 1;
        ev('cache holder', {kind: h.kind, serial: h.serial, got});
      }
      if (got.length) {
        stocked++; taken.push(...got);
        if (!firstLoot) { firstLoot = {metres: +metres.toFixed(1), rooms, itemId: got[0], holder: h.kind}; ev('first loot', {...firstLoot}); }
      } else empty++;
    }
  }
  const inventory: Record<string, number> = {};
  for (const [id, n0] of inv0) { const dn = inv.count(id) - n0; if (dn) inventory[id] = dn; }
  // 3. back: the nearest rescue ladder of the bed the annex hangs off, climbed up
  const trench = A.tunnel >= 0 ? ext.tunnels[A.tunnel].trench : A.bed!.trench;
  const lad = layout.traversal.ladders.filter(l => l.trench === trench && (l.kind ?? 'rescue') === 'rescue')
    .sort((a, b) => Math.hypot(a.bottom.x - A.exit.x, a.bottom.z - A.exit.z) - Math.hypot(b.bottom.x - A.exit.x, b.bottom.z - A.exit.z))[0];
  let returned = false;
  if (lad && walkTo(lad.bottom.x, lad.bottom.z - lad.dir * 0.3, lad.bottomY, 180)) {
    p.yaw = lad.dir > 0 ? Math.PI : 0;
    const look = new THREE.Vector3(-Math.sin(p.yaw), Math.sin(-0.3), -Math.cos(p.yaw)).normalize();
    const aim = ladderTarget(layout.traversal.ladders, {x: p.x, y: p.y + STAND_EYE, z: p.z}, look, p.y);
    if (aim?.ladder.id === lad.id) {
      p.startClimb(lad, true);
      for (let f = 0; p.climbing && f < 600; f++) { const y0 = p.y; p.update(DT, keys, L, props, OPTS); maxDy = Math.max(maxDy, Math.abs(p.y - y0)); t += DT; }
      returned = Math.abs(p.y - lad.topY) < 0.05;
    }
  }
  ev('returned', {ok: returned});
  return {
    level, seed, annex: A.id, entry, areaM2: A.areaM2, strategy, roomsVisited: rooms, roomsTotal: A.areas.length, metres: +metres.toFixed(1), seconds: +t.toFixed(1),
    holders: {opened, empty, stocked, takenItems: taken}, firstLoot,
    enemies: {total: enemies.length, aware: enemies.filter(e => e.aware).length, firstAware},
    cache, depthReached, maxDepth, inventory,
    returned, minY: +minY.toFixed(2), maxDy: +maxDy.toFixed(3), events,
    ...(strategy === 'marks' ? {trail} : {}),
  };
}

/** [E] on the holder (opens a closed holder / compartment), then [E] on each visible lot; returns the item ids taken. */
function openAndTake(cm: ContainerManager, h: Holder, inv: Inventory): string[] {
  const before = new Map<string, number>();
  const ids = () => h.state.lots.map(l => l.itemId);
  for (const id of ids()) before.set(id, inv.count(id));
  if (h.open || !h.state.open) cm.interact({container: h, t: 1, lot: null, part: h.open ? 0 : undefined} as never);
  for (let tt = 0; tt < 1.5; tt += DT) cm.update(DT, tt);
  const got: string[] = [];
  for (let k = 0; k < 4 && h.state.lots.length; k++) {
    const lot = h.state.lots.find(l => !h.open || l.part === undefined || (h.open.parts[l.part]?.t ?? 0) > 0.5);
    if (!lot) break;
    const n0 = inv.count(lot.itemId);
    cm.interact({container: h, t: 1, lot, part: lot.part} as never);
    if (inv.count(lot.itemId) > n0) got.push(lot.itemId); else break;
  }
  void before;
  return got;
}
