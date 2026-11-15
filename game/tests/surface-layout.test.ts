import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel} from '../src/gen/mall/index';
import {ARCHETYPES, type StationLayout} from '../src/gen/stationTypes';
import {CELL, PathFinder, SOLID} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {Player, type MoveInput} from '../src/player/player';
import {PropIndex, resolveCircle} from '../src/core/physics';
import {ITEMS} from '../src/items/items';
import {PROP_DEFS} from '../src/gen/props';
import {appendSurfaceAccess, generateSurfaceLevel, surfaceEligible} from '../src/gen/surface/index';
import {generateNetwork} from '../src/campaign/network';
import {seedToCode} from '../src/core/rng';

class Keys implements MoveInput { down(code: string) { return code === 'KeyW'; } hit() { return false; } }
const keys = new Keys(), DT = 1 / 60, opts = {aiming: false, speedMult: 1, canSprint: false};

function walker(layout: StationLayout, at = {...layout.playerSpawn, y: 0}) {
  const levels = levelsOf(layout), player = new Player();
  player.spawn(at.x, at.z, at.yaw, at.y);
  return {layout, levels, player, props: new PropIndex(levels, layout.props), paths: new PathFinder(levels), maxDy: 0};
}
type Walker = ReturnType<typeof walker>;
function walk(w: Walker, to: {x: number; y: number; z: number}, cap = 180): void {
  const p = w.player, path = w.paths.find(p.x, p.z, to.x, to.z, p.radius, 400000, {ay: p.y, by: to.y});
  expect(path, `route from${p.x.toFixed(1)},${p.z.toFixed(1)} to${to.x.toFixed(1)},${to.z.toFixed(1)} @${to.y}`).not.toBeNull();
  let index = 0;
  for (let frame = 0; frame < cap / DT; frame++) {
    while (index < path!.length && Math.hypot(path![index][0] - p.x, path![index][1] - p.z) < 0.22 &&
      (path![index][3] === undefined || Math.abs(path![index][3]! - p.y) < 0.3)) index++;
    if (index === path!.length) break;
    const oldY = p.y;
    p.yaw = Math.atan2(-(path![index][0] - p.x), -(path![index][1] - p.z));
    p.update(DT, keys, w.levels, w.props, opts);
    w.maxDy = Math.max(w.maxDy, Math.abs(p.y - oldY));
  }
  expect(Math.hypot(p.x - to.x, p.z - to.z), 'actual Player reached the route destination').toBeLessThan(0.35);
  expect(p.y, 'actual Player reached the right height').toBeCloseTo(to.y, 1);
}

describe('Surface Run deterministic layout and access', () => {
  it('quarter roll is explicit, independent and only on the three eligible archetypes; a legitimate preview starts at a rolled station', () => {
    const counts = {subway: 0, office: 0, mall: 0};
    for (let seed = 0; seed < 10000; seed++) for (const level of ['subway', 'office', 'mall'] as const) {
      expect(surfaceEligible(level, seed)).toBe(false);
      if (surfaceEligible(level, seed, 1)) counts[level]++;
    }
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(2400);
    for (const n of Object.values(counts)) expect(n).toBeLessThan(2600);
    for (const level of ['market', 'bunker', 'skyways', 'reactor']) expect(surfaceEligible(level, 1, 1)).toBe(false);
    let route: unknown = null;
    for (let seed = 1; seed < 100 && !route; seed++) {
      const net = generateNetwork(seed), node = net.nodes.find(n => n.id === net.start)!;
      if (surfaceEligible(node.archetype, node.levelSeed, 1)) route = {networkSeed: seed, station: node.id, name: node.name, levelSeed: node.levelSeed, code: seedToCode(node.levelSeed)};
    }
    expect(route).not.toBeNull();
    process.stdout.write(`SURFACE_LEGITIMATE_PREVIEW ${JSON.stringify(route)}\n`);
  });

  it('real destination rooms, outer streets, finite content and depot cargo are connected and use registered inputs', () => {
    const l = generateSurfaceLevel({levelSeed: 4242}, 'subway'), info = l.surface!;
    expect(info.blocks).toHaveLength(64); expect(info.blocks.filter(b => b.core)).toHaveLength(16);
    expect(info.destinations).toHaveLength(16); expect(new Set(info.destinations.map(d => d.kind))).toEqual(new Set(['store', 'office', 'shopping-centre', 'depot']));
    expect(info.roads).toHaveLength(18); expect(info.bounds.w).toBe(232); expect(info.bounds.d).toBe(232);
    expect(l.areas.some(a => a.label === 'Checkpoint stair head')).toBe(true);
    expect(l.props.some(p => p.kind === 'annexMachine' && p.x === 44 && p.z === 195.1 && p.h === 2.55)).toBe(true);
    expect(info.interiorSpawnIndices).toEqual(l.zombies.map((_, i) => i));
    expect(l.zombies.every(z => z.area > 0)).toBe(true);
    expect(info.exteriorSpawns.every(z => z.area === 0 && Math.hypot(z.x - info.truck.x, z.z - info.truck.z) >= 32)).toBe(true);
    for (const p of l.pickups) expect(ITEMS[p.itemId], `pickup${p.itemId}`).toBeDefined();
    expect(l.pickups.find(p => p.itemId === 'gas_mask' && p.area === 0)).toMatchObject({count: 1, filter: 18.75});
    for (const p of l.props) expect(PROP_DEFS[p.kind], `prop${p.kind}`).toBeDefined();
    const w = walker(l), start = {x: l.playerSpawn.x, y: 0, z: l.playerSpawn.z};
    walk(w, {x: 44, y: 0, z: 188.3}); // the finite partly-used mask is reached through the tent's open front
    walk(w, {x: 45, y: 0, z: 188}); // the planning map's normal reading side
    walk(w, start);
    for (const d of info.destinations) for (const areaId of d.areaIds) {
      const a = l.areas[areaId], x = (a.x + a.w / 2) * CELL, z = (a.y + a.h / 2) * CELL;
      expect(w.paths.find(start.x, start.z, x, z, 0.3, 400000, {ay: 0, by: 0}), `${d.id}/${a.label} is enterable`).not.toBeNull();
    }
    // Real movement through one of every destination type, including the depot's narrow dispatch-office door.
    for (const kind of ['store', 'office', 'shopping-centre', 'depot']) {
      const d = info.destinations.find(d => d.kind === kind)!, a = l.areas[d.areaIds[d.areaIds.length - 1]];
      walk(w, {x: (a.x + a.w / 2) * CELL, y: 0, z: (a.y + a.h / 2) * CELL});
    }
    walk(w, start);
    // At every outer edge the actual streets are still reachable with truck-width clearance, past the core.
    for (const [x, z] of [[8, 8], [232, 8], [8, 232], [232, 232]]) {
      expect(w.paths.find(36, 204, x, z, 1.2, 400000, {ay: 0, by: 0}), `driveable perimeter${x},${z}`).not.toBeNull();
    }
    for (const c of info.depotCargo) {
      expect(l.grid.circleClear(c.x, c.z, 0.85), `${c.kind} clear`).toBe(true);
      expect(resolveCircle(w.levels, w.props, c.x, c.z, 0.85, c.y), `${c.kind} no fixture overlap`).toEqual([c.x, c.z]);
      expect(w.paths.find(start.x, start.z, c.x, c.z, 0.3, 400000, {ay: 0, by: 0}), `${c.kind} reachable`).not.toBeNull();
    }
    const again = generateSurfaceLevel({levelSeed: 4242}, 'subway');
    expect(JSON.stringify(again.surface)).toBe(JSON.stringify(info));
    expect(again.pickups).toEqual(l.pickups); expect(again.zombies).toEqual(l.zombies);
  });

  it('every rolled subway in a varied seed window has a physical, unblocked stair entrance and upper landing', () => {
    let built = 0;
    for (let seed = 1; seed <= 64; seed++) {
      if (!surfaceEligible('subway', seed, 1)) continue;
      const l = generateStation(seed), access = appendSurfaceAccess(l, 'subway'), levels = levelsOf(l);
      expect(levels.circleClear(access.x, access.z, 0.28, access.y), `seed${seed} top`).toBe(true);
      expect(levels.circleClear(access.approach!.x, access.approach!.z, 0.28, access.approach!.y), `seed${seed} bottom`).toBe(true);
      built++;
    }
    expect(built).toBeGreaterThan(10);
  });

  it.each(ARCHETYPES)('a real Player walks the %s subway switchback up eight metres and back; no upper room is touched', archetype => {
    const l = generateStation(4242, {archetype}), originalProps = l.props.length, originalPickups = structuredClone(l.pickups), originalZombies = structuredClone(l.zombies);
    const upper = l.levels.slice(1).map(v => ({cells: v.grid.cells.slice(), floor: v.grid.floor.slice(), ceil: v.grid.ceil.slice()}));
    const access = appendSurfaceAccess(l, 'subway'), approach = access.approach!;
    expect(access.y - approach.y).toBe(8); expect(l.props.length).toBe(originalProps + 1);
    expect(l.pickups.length).toBe(originalPickups.length); expect(l.zombies).toEqual(originalZombies);
    for (let k = 1; k < l.levels.length; k++) {
      expect(l.levels[k].grid.cells).toEqual(upper[k - 1].cells); expect(l.levels[k].grid.floor).toEqual(upper[k - 1].floor); expect(l.levels[k].grid.ceil).toEqual(upper[k - 1].ceil);
    }
    const [cx, cz] = l.grid.cellOf(access.x, access.z), a = l.areas[l.grid.area[l.grid.idx(cx, cz)]];
    for (const level of l.levels.slice(1)) for (let z = a.y; z < a.y + a.h; z++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = level.grid.idx(x, z);
      expect(level.grid.cells[i] === SOLID || level.grid.ceil[i] <= approach.y || level.grid.floor[i] >= access.y + 2.7, 'no room in the stair shaft').toBe(true);
    }
    // Start at the ordinary platform, then follow the actual station route to the first stair landing.
    const w = walker(l, {...l.playerSpawn, y: l.grid.floorAt(l.playerSpawn.x, l.playerSpawn.z)});
    walk(w, approach); walk(w, access); walk(w, approach);
    expect(w.maxDy, 'continuous steps, no floor snap').toBeLessThan(0.12);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(appendSurfaceAccess(l, 'subway')).toBe(access); expect(l.props.length).toBe(originalProps + 1);
  }, 120000);

  it.each(['office', 'mall'] as const)('%s access uses an actual exterior exit approached on its real floor', level => {
    const l = level === 'office' ? generateOfficeLevel({levelSeed: 4242}) : generateMallLevel({levelSeed: 4242});
    const props = l.props.length, access = appendSurfaceAccess(l, level);
    expect(access.kind).toBe('exterior-exit'); expect(l.props.length).toBe(props);
    const levels = levelsOf(l);
    expect(levels.circleClear(access.x, access.z, 0.28, access.y)).toBe(true);
    expect(levels.supportAt(access.x, access.z, access.y + 0.1)?.floor).toBeCloseTo(access.y, 2);
  });
});
