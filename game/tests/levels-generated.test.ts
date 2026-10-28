// Iteration 08 (Lane B): gameplay queries on GENERATED stacked stations (Lane A's generator, every
// archetype family): the player walks every stair run between levels up and down by input (no snap,
// no fall), zombies / pickups sit on their own storey's floor, cross-level paths exist and stay
// within budget, a slab between two overlapping storeys blocks rays / sight and is a static box,
// and a zombie chases across a connector. Skips gracefully if a layout has a single level.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {ARCHETYPES, generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, PathFinder, type Waypoint} from '../src/gen/grid';
import {levelsOf, type Levels} from '../src/gen/levels';
import {Player, type MoveInput} from '../src/player/player';
import {PropIndex} from '../src/core/physics';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {StaticQuery} from '../src/physics/staticQuery';
import {PhysicsSystem} from '../src/physics/world';
import type {PickupLike} from '../src/physics/dynamicItems';

const DT = 1 / 60;
const opts = {aiming: false, speedMult: 1, canSprint: true};
class Keys implements MoveInput {
  held = new Set<string>(['KeyW']);
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}
interface Station { l: StationLayout; L: Levels; pf: PathFinder; props: PropIndex; pfMs: number }
const cache = new Map<string, Station>();
function station(a: (typeof ARCHETYPES)[number], i: number): Station {
  let s = cache.get(a);
  if (!s) {
    const l = generateStation(9001 + i * 7919, {archetype: a});
    const L = levelsOf(l);
    const t0 = performance.now();
    const pf = new PathFinder(L);
    s = {l, L, pf, props: new PropIndex(L, l.props), pfMs: performance.now() - t0};
    cache.set(a, s);
  }
  return s;
}

function walkTo(s: Station, p: Player, x: number, y: number, z: number, maxFrames = 60 * 30): {ok: boolean; maxDy: number; airborne: number; path: Waypoint[] | null} {
  const path = s.pf.find(p.x, p.z, x, z, 0.34, 60000, {ay: p.y, by: y});
  if (!path) return {ok: false, maxDy: 0, airborne: 0, path};
  const k = new Keys();
  let i = 0, prev = p.y, maxDy = 0, airborne = 0;
  for (let f = 0; f < maxFrames; f++) {
    while (i < path.length && Math.hypot(path[i][0] - p.x, path[i][1] - p.z) < 0.3 && (path[i][3] === undefined || Math.abs(path[i][3]! - p.y) < 1)) i++;
    if (i >= path.length) return {ok: true, maxDy, airborne, path};
    p.yaw = Math.atan2(-(path[i][0] - p.x), -(path[i][1] - p.z));
    p.update(DT, k, s.L, s.props, opts);
    maxDy = Math.max(maxDy, Math.abs(p.y - prev));
    if (!p.grounded) airborne++;
    prev = p.y;
  }
  return {ok: false, maxDy, airborne, path};
}

describe('generated stacked stations (Lane A layouts)', () => {
  it('every family: each stair run between levels is walked up and down by input — right storey, no snap, no fall', () => {
    const report: string[] = [];
    for (const [i, a] of ARCHETYPES.entries()) {
      const s = station(a, i);
      if (s.L.count < 2) { report.push(`${a}: single level (skipped)`); continue; }
      for (const k of s.l.levelLinks.filter(q => q.kind === 'stairs')) {
        const p = new Player();
        p.spawn(k.bottom.x, k.bottom.z, 0, k.bottom.y);
        const up = walkTo(s, p, k.top.x, k.top.y, k.top.z);
        expect(up.ok, `${a} link ${k.id} up (at ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)})`).toBe(true);
        expect(p.y, `${a} link ${k.id} up: on the upper storey`).toBeCloseTo(k.top.y, 1);
        expect(s.L.levelAt(p.x, p.z, p.y + 0.05)).toBe(s.L.supportAt(k.top.x, k.top.z, k.top.y + 0.05)!.level);
        expect(up.maxDy, `${a} link ${k.id} up: no snap`).toBeLessThan(0.46);
        expect(up.airborne, `${a} link ${k.id} up: no fall`).toBe(0);
        const down = walkTo(s, p, k.bottom.x, k.bottom.y, k.bottom.z);
        expect(down.ok, `${a} link ${k.id} down`).toBe(true);
        expect(p.y).toBeCloseTo(k.bottom.y, 1);
        expect(down.maxDy).toBeLessThan(0.46);
        expect(down.airborne).toBe(0);
        expect(p.hp).toBe(p.maxHp);
      }
      report.push(`${a}: ${s.l.levelLinks.length} runs walked both ways`);
    }
    console.info(`[levels-gen] ${report.join('; ')}`);
  });

  it('zombie spawns and loose loot sit on their own storey floor; spawn cells are passable on their level', () => {
    for (const [i, a] of ARCHETYPES.entries()) {
      const {l, L} = station(a, i);
      for (const z of l.zombies) {
        const lv = z.level ?? 0;
        const y = z.y ?? L.grid(lv).floorAt(z.x, z.z);
        const s = L.supportIn(z.x, z.z, y + 0.05);
        expect(s, `${a} zombie at ${z.x},${z.z}`).not.toBeNull();
        expect(s!.level).toBe(lv);
        expect(Math.abs(s!.floor - y)).toBeLessThan(0.02);
        expect(L.grid(lv).passable(...L.grid(lv).cellOf(z.x, z.z))).toBe(true);
      }
      for (const p of l.pickups) {
        const lv = p.level ?? 0;
        const s = L.supportAt(p.x, p.z, p.y + 0.05);
        expect(s, `${a} pickup ${p.itemId}`).not.toBeNull();
        expect(s!.level, `${a} pickup ${p.itemId} level`).toBe(lv);
        expect(p.y).toBeGreaterThanOrEqual(s!.floor - 1e-4);
      }
    }
  });

  it('cross-level paths from the spawn to every connector end and between the upper and lower levels (timing)', () => {
    const times: string[] = [];
    for (const [i, a] of ARCHETYPES.entries()) {
      const s = station(a, i);
      if (s.L.count < 2) continue;
      const sp = s.l.playerSpawn;
      let worst = 0, n = 0, sum = 0;
      const ends = s.l.levelLinks.flatMap(k => [k.bottom, k.top]);
      for (const e of ends) {
        const t0 = performance.now();
        const path = s.pf.find(sp.x, sp.z, e.x, e.z, 0.34, 60000, {ay: s.L.grid(0).floorAt(sp.x, sp.z), by: e.y, drops: true});
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms); sum += ms; n++;
        expect(path, `${a}: spawn -> (${e.x},${e.y},${e.z})`).not.toBeNull();
      }
      // upper <-> lower (via the main level)
      const ups = s.l.levelLinks.filter(k => k.upper !== 0), lows = s.l.levelLinks.filter(k => k.lower !== 0);
      if (ups.length && lows.length) {
        const t0 = performance.now();
        const path = s.pf.find(ups[0].top.x, ups[0].top.z, lows[0].bottom.x, lows[0].bottom.z, 0.34, 60000, {ay: ups[0].top.y, by: lows[0].bottom.y, drops: true});
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms); sum += ms; n++;
        expect(path, `${a}: upper -> lower`).not.toBeNull();
      }
      times.push(`${a} build ${s.pfMs.toFixed(0)} ms, find avg ${(sum / n).toFixed(1)} / worst ${worst.toFixed(1)} ms`);
      expect(worst).toBeLessThan(250);
    }
    console.info(`[levels-gen] paths: ${times.join('; ')}`);
  });

  it('where an upper storey overlaps the main one: the slab stops rays and sight both ways and is a static box', () => {
    for (const [i, a] of ARCHETYPES.entries()) {
      const {l, L} = station(a, i);
      if (L.count < 2) continue;
      const q = new StaticQuery(l);
      const g0 = L.grid(0), up = L.list.findIndex(v => v.role === 'upper');
      if (up < 0) continue;
      const g1 = L.grid(up);
      let checked = 0;
      for (let c = 0; c < g0.cells.length && checked < 6; c += 97) {
        if (g0.cells[c] !== FLOOR || g1.cells[c] !== FLOOR || g0.rampIdx[c] >= 0 || g1.rampIdx[c] >= 0 || g0.blocked[c] || g1.blocked[c]) continue;
        const cx = c % g0.w, cy = Math.floor(c / g0.w), x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
        const f0 = g0.floorOf(c), c0 = g0.ceil[c], f1 = g1.floorOf(c);
        if (!(f1 > c0)) continue;
        const upHit = L.raycast({x, y: f0 + 1.6, z}, {x: 0, y: 1, z: 0}, 30);
        expect(upHit.kind, `${a} cell ${cx},${cy}`).toBe('ceiling');
        expect(upHit.level).toBe(0);
        expect(f0 + 1.6 + upHit.t).toBeCloseTo(c0, 4);
        const downHit = L.raycast({x, y: f1 + 1.6, z}, {x: 0, y: -1, z: 0}, 30);
        expect(downHit.kind).toBe('floor');
        expect(downHit.level).toBe(up);
        expect(f1 + 1.6 - downHit.t).toBeCloseTo(f1, 4);
        expect(L.lineOfSight({x, y: f0 + 1.5, z}, {x: x + 0.1, y: f1 + 1.5, z})).toBe(false);
        expect(L.supportAt(x, z, f0 + 0.05)!.level).toBe(0);
        expect(L.supportAt(x, z, f1 + 0.05)!.level).toBe(up);
        const solids = q.columnSolids(cx, cy, q.minFloor - 0.5).solids;
        expect(solids.some(sl => Math.abs(sl.y0 - c0) < 1e-3 && Math.abs(sl.y1 - f1) < 1e-3), `${a}: slab box`).toBe(true);
        checked++;
      }
      expect(checked, `${a}: overlapping columns found`).toBeGreaterThan(0);
    }
  });

  it('a zombie on the lower level chases the player up to the main level (and one on the main level up to the upper deck)', () => {
    const {l, L, pf, props} = station(ARCHETYPES[0], 0);
    if (L.count < 2) return;
    const run = (k: (typeof l.levelLinks)[number], fromBottom: boolean) => {
      const start = fromBottom ? k.bottom : k.top, goal = fromBottom ? k.top : k.bottom;
      const z = new ZombieBrain('shambler', start.x, start.z, 0);
      z.y = start.y;
      let rnd = 5;
      const w: BrainWorld = {
        px: goal.x, pz: goal.z, py: goal.y, playerAlive: true,
        los: (ax, az, bx, bz, ay, by) => (ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : L.main.lineOfSight(ax, az, bx, bz)),
        walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
        findPath: (ax, az, bx, bz, o) => pf.find(ax, az, bx, bz, 0.34, 26000, o),
        randomNear: () => null,
        rand: () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647),
      };
      z.hear(goal.x, goal.z, 80, goal.y);
      for (let f = 0; f < 60 * 40; f++) {
        const out = z.update(DT, w);
        if (out.face !== null) { let d = out.face - z.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); const t = 4.5 * DT; z.yaw += Math.max(-t, Math.min(t, d)); }
        moveZombie(z, out, DT, L, props);
        settleZombie(z, L, props);
        if (Math.abs(z.y - goal.y) < 0.15 && Math.hypot(z.x - goal.x, z.z - goal.z) < 1.6) return true;
      }
      return `stuck at ${z.x.toFixed(1)},${z.y.toFixed(2)},${z.z.toFixed(1)} (${z.state})`;
    };
    const lower = l.levelLinks.find(k => k.lower !== 0), upper = l.levelLinks.find(k => k.upper !== 0);
    if (lower) expect(run(lower, true), 'lower -> main').toBe(true);
    if (upper) expect(run(upper, true), 'main -> upper').toBe(true);
  });

  it('a can dropped on the upper storey settles there (not on the floor below)', () => {
    const {l, L} = station(ARCHETYPES[2], 2);
    if (L.count < 2) return;
    const k = l.levelLinks.find(q => q.upper !== 0);
    if (!k) return;
    const ph = new PhysicsSystem(null);
    ph.build(l);
    const obj = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12);
    geo.translate(0, 0.061, 0);
    obj.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
    obj.position.set(k.top.x, k.top.y + 0.4, k.top.z);
    new THREE.Group().add(obj);
    obj.parent!.updateMatrixWorld(true);
    const pk: PickupLike = {stack: {itemId: 'cola', uid: 1, count: 1}, x: k.top.x, y: k.top.y + 0.4, z: k.top.z, obj};
    ph.dynamicItems.shootPickup(pk, new THREE.Vector3(k.top.x, k.top.y + 0.45, k.top.z), new THREE.Vector3(0, -1, 0), 0.2);
    for (let t = 0; t < 6; t += DT) ph.update(DT);
    const b = new THREE.Box3().setFromObject(obj);
    expect(b.min.y).toBeGreaterThan(k.top.y - 0.05);
    expect(b.min.y).toBeLessThan(k.top.y + 0.1);
    ph.dispose();
  });
});
