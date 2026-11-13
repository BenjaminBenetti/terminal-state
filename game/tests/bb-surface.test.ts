// Task studio-bb-production-20261112-234540-01: BB's surface locomotion (ai/bbSurface.ts) — crawling on floors, walls and ceilings
// of solid geometry, decided only by rays. First on an exact box world (a room, a beam, a partition with a doorway, a prop), where
// every corner is known; then on real generated levels (the game's own collision: the bullet line over structure + props).

import {describe, expect, it} from 'vitest';
import {
  CRAWL, anchorValid, arcClear, centreValid, clingCentre, clingKind, crawlStep, findMounts, flatCrawlWorld, flightClear, flightStep, floorBelow, launchVelocity, layoutCrawlWorld, mountWall,
  steerCling, type Cling, type CrawlHit, type CrawlWorld, type Vec3,
} from '../src/ai/bbSurface';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import type {LevelId} from '../src/levels/types';

interface Box { min: Vec3; max: Vec3; prop?: boolean }

/**
 * An exact world: a closed room (its inner faces) holding solid boxes. Free space = inside the room and outside every box.
 */
function boxWorld(room: Box, boxes: Box[]): CrawlWorld {
  const kindOf = (ny: number, prop: boolean | undefined): CrawlHit['kind'] => (prop ? 'prop' : ny > 0.5 ? 'floor' : ny < -0.5 ? 'ceiling' : 'wall');
  const inBox = (b: Box, p: Vec3, e = 0): boolean => p.x > b.min.x + e && p.x < b.max.x - e && p.y > b.min.y + e && p.y < b.max.y - e && p.z > b.min.z + e && p.z < b.max.z - e;
  const axes = ['x', 'y', 'z'] as const;
  return {
    ray(o, d, max) {
      let best: CrawlHit = {t: max, kind: 'none', nx: 0, ny: 0, nz: 0};
      // the room, from inside: the face the ray leaves through
      for (const a of axes) {
        if (Math.abs(d[a]) < 1e-12) continue;
        const plane = d[a] > 0 ? room.max[a] : room.min[a];
        const t = (plane - o[a]) / d[a];
        if (t >= 0 && t < best.t) {
          const n = {x: 0, y: 0, z: 0};
          n[a] = d[a] > 0 ? -1 : 1;
          best = {t, kind: kindOf(n.y, false), nx: n.x, ny: n.y, nz: n.z};
        }
      }
      // the boxes, from outside: slab test
      for (const b of boxes) {
        let t0 = 0, t1 = best.t, na: 'x' | 'y' | 'z' | null = null, ns = 0, ok = true;
        for (const a of axes) {
          if (Math.abs(d[a]) < 1e-12) { if (o[a] <= b.min[a] || o[a] >= b.max[a]) { ok = false; break; } continue; }
          let ta = (b.min[a] - o[a]) / d[a], tb = (b.max[a] - o[a]) / d[a], s = -1;
          if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
          if (ta > t0) { t0 = ta; na = a; ns = s; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) { ok = false; break; }
        }
        if (!ok || na === null || t0 >= best.t) continue;
        const n = {x: 0, y: 0, z: 0};
        n[na] = ns;
        best = {t: t0, kind: kindOf(n.y, b.prop), nx: n.x, ny: n.y, nz: n.z};
      }
      return best;
    },
    band(x, y, z) {
      const p = {x, y, z};
      if (!inBox(room, p, -1e-3) || boxes.some(b => inBox(b, p, 1e-6))) return null;
      let floor = room.min.y, ceil = room.max.y;
      for (const b of boxes) {
        if (x <= b.min.x || x >= b.max.x || z <= b.min.z || z >= b.max.z) continue;
        if (b.max.y <= y + 1e-6) floor = Math.max(floor, b.max.y);
        if (b.min.y >= y - 1e-6) ceil = Math.min(ceil, b.min.y);
      }
      return {floor, ceil};
    },
    stand(x, y, z, r) {
      if (Math.abs(y - room.min.y) > 0.4) return null;
      if (x - r < room.min.x || x + r > room.max.x || z - r < room.min.z || z + r > room.max.z) return null;
      for (const b of boxes) if (b.min.y < room.min.y + 0.6 && x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z) return null;
      return room.min.y;
    },
  };
}

const ROOM: Box = {min: {x: 0, y: 0, z: 0}, max: {x: 8, y: 3, z: 6}};
const floorCling = (x: number, z: number, hx: number, hz: number): Cling => ({x, y: 0, z, nx: 0, ny: 1, nz: 0, hx, hy: 0, hz});

/** Crawl up to `metres`, following corners; returns the kinds of surface visited and why it stopped. */
function crawl(w: CrawlWorld, c: Cling, metres: number, lim = {maxHeightM: CRAWL.maxHeightM}): {cling: Cling; path: string[]; end: string; moved: number} {
  const path: string[] = [clingKind(c)];
  let cur = c, moved = 0, end = 'distance';
  for (let k = 0; k < 4000 && moved < metres; k++) {
    const r = crawlStep(w, cur, 0.05, lim);
    moved += r.moved;
    if (r.event === 'inner' || r.event === 'outer') {
      // the corner is turned through free space: both body centres are valid and the straight line between them is clear
      const a = clingCentre(cur), b = clingCentre(r.next!);
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(w.ray(a, {x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d}, d).kind, `corner ${r.event} passes through solid`).toBe('none');
      expect(d).toBeLessThan(0.6);
      cur = r.next!;
      path.push(`${r.event}:${clingKind(cur)}`);
    } else if (r.event === 'blocked') { end = `blocked:${r.by}`; break; } else {
      expect(centreValid(w, cur, lim), 'body centre left free space').toBe(true);
      expect(anchorValid(w, cur), 'no surface under the body').toBe(true);
    }
    // the heading stays a unit vector in the surface's plane
    expect(Math.abs(cur.hx * cur.nx + cur.hy * cur.ny + cur.hz * cur.nz)).toBeLessThan(1e-6);
    expect(Math.hypot(cur.hx, cur.hy, cur.hz)).toBeCloseTo(1, 6);
  }
  return {cling: cur, path, end, moved};
}

describe('BB surface crawl: an exact room', () => {
  it('floor -> wall -> ceiling -> far wall -> floor: every inner corner is turned, right round the room', () => {
    const w = boxWorld(ROOM, []);
    const r = crawl(w, floorCling(4, 3, 1, 0), 30);
    expect(r.path.slice(0, 5)).toEqual(['floor', 'inner:wall', 'inner:ceiling', 'inner:wall', 'inner:floor']);
    expect(r.end).toBe('distance');
    // a full lap of the 8 x 3 section is ~ (8 + 3) * 2 - the corner cuts: it kept going
    expect(r.moved).toBeGreaterThanOrEqual(30 - 0.05);
  });

  it('the body centre is one body-lift off its surface, and a mounted wall is climbed straight up', () => {
    const w = boxWorld(ROOM, []);
    const c = mountWall(w, 7.5, 0, 3, 1, 0, 0.9);
    expect(c).not.toBeNull();
    expect(c!.x).toBeCloseTo(8, 6);
    expect([c!.nx, c!.ny, c!.nz]).toEqual([-1, 0, 0]);
    expect([c!.hx, c!.hy, c!.hz]).toEqual([0, 1, 0]);
    expect(clingCentre(c!).x).toBeCloseTo(8 - CRAWL.lift, 6);
    expect(mountWall(w, 4, 0, 3, 1, 0, 0.9)).toBeNull(); // no wall within reach
  });

  it('a beam under the ceiling is crossed by its own faces: down its side, under it, up the far side, back onto the ceiling', () => {
    const beam: Box = {min: {x: 3, y: 2.5, z: 0}, max: {x: 3.6, y: 3, z: 6}};
    const w = boxWorld(ROOM, [beam]);
    const start: Cling = {x: 1.5, y: 3, z: 3, nx: 0, ny: -1, nz: 0, hx: 1, hy: 0, hz: 0};
    const r = crawl(w, start, 4);
    expect(r.path.slice(0, 5)).toEqual(['ceiling', 'inner:wall', 'outer:ceiling', 'outer:wall', 'inner:ceiling']);
    expect(r.cling.x).toBeGreaterThan(3.6);
    expect(r.cling.y).toBeCloseTo(3, 6);
  });

  it('a doorway in a partition: over the lintel from the wall above the door, and the partition is never passed through', () => {
    // a partition across the room at x 4..4.5 (one wall cell thick) with a doorway z 2.4..3.6 up to y 2.1
    const boxes: Box[] = [
      {min: {x: 4, y: 0, z: 0}, max: {x: 4.5, y: 3, z: 2.4}},
      {min: {x: 4, y: 0, z: 3.6}, max: {x: 4.5, y: 3, z: 6}},
      {min: {x: 4, y: 2.1, z: 2.4}, max: {x: 4.5, y: 3, z: 3.6}},
    ];
    const w = boxWorld(ROOM, boxes);
    // on the ceiling toward the lintel: down its face, under it, up the far side, onto the next room's ceiling
    const over = crawl(w, {x: 2.5, y: 3, z: 3, nx: 0, ny: -1, nz: 0, hx: 1, hy: 0, hz: 0}, 5);
    expect(over.path.slice(0, 5)).toEqual(['ceiling', 'inner:wall', 'outer:ceiling', 'outer:wall', 'inner:ceiling']);
    expect(over.cling.x).toBeGreaterThan(4.5);
    // on the ceiling toward the solid part of the partition: down the wall to the floor, on the SAME side
    const solid = crawl(w, {x: 2.5, y: 3, z: 1, nx: 0, ny: -1, nz: 0, hx: 1, hy: 0, hz: 0}, 4.5);
    expect(solid.path.slice(0, 3)).toEqual(['ceiling', 'inner:wall', 'inner:floor']);
    expect(solid.cling.x).toBeLessThan(4);
  });

  it('a prop is an obstacle, never a surface: blocked in front of it, and never clung to', () => {
    const crate: Box = {min: {x: 5, y: 0, z: 2}, max: {x: 6, y: 1, z: 4}, prop: true};
    const w = boxWorld(ROOM, [crate]);
    const r = crawl(w, floorCling(3, 3, 1, 0), 5);
    expect(r.end).toBe('blocked:prop');
    expect(r.cling.x).toBeLessThan(5 - CRAWL.reach + 0.06);
    expect(anchorValid(w, {x: 5.5, y: 1, z: 3, nx: 0, ny: 1, nz: 0, hx: 1, hy: 0, hz: 0})).toBe(false); // a prop's top holds no cling
    expect(mountWall(w, 4.6, 0, 3, 1, 0, 0.9)).toBeNull(); // nor is its side a wall to mount
  });

  it('the climb limit: a wall is climbed only as high as the limit above the floor below', () => {
    const tall: Box = {min: {x: 0, y: 0, z: 0}, max: {x: 8, y: 9, z: 6}};
    const w = boxWorld(tall, []);
    const c = mountWall(w, 7.6, 0, 3, 1, 0, 0.9)!;
    const r = crawl(w, c, 12);
    expect(r.end).toBe('blocked:height');
    expect(clingCentre(r.cling).y).toBeLessThanOrEqual(CRAWL.maxHeightM + 1e-6);
    expect(clingCentre(r.cling).y).toBeGreaterThan(CRAWL.maxHeightM - 0.06);
  });

  it('a ledge on the wall is crawled round: under it, up its front, across its top, and on up the wall', () => {
    const ledge: Box = {min: {x: 7, y: 1.3, z: 0}, max: {x: 8, y: 1.7, z: 6}};
    const w = boxWorld(ROOM, [ledge]);
    const c = mountWall(w, 7.6, 0, 3, 1, 0, 0.9)!;
    const r = crawl(w, c, 6);
    // up the wall, onto the ledge's underside (an inner corner), out to its edge, up its front face, onto its top, back to the wall, up
    expect(r.path.slice(0, 6)).toEqual(['wall', 'inner:ceiling', 'outer:wall', 'outer:floor', 'inner:wall', 'inner:ceiling']);
  });

  it('steering turns the heading in the surface plane by at most the given angle', () => {
    const c = floorCling(4, 3, 1, 0);
    steerCling(c, 0, 0, 1, 0.1);
    expect(Math.atan2(c.hz, c.hx)).toBeCloseTo(0.1, 6);
    expect(c.hy).toBe(0);
    steerCling(c, 0, 5, 0, 1); // straight along the normal: nothing in the plane -> unchanged
    expect(Math.atan2(c.hz, c.hx)).toBeCloseTo(0.1, 6);
    const wall: Cling = {x: 8, y: 1, z: 3, nx: -1, ny: 0, nz: 0, hx: 0, hy: 1, hz: 0};
    steerCling(wall, -3, 0, 2, 10); // a target out in the room and to the side: only the part along the wall counts
    expect(wall.hx).toBeCloseTo(0, 6);
    expect(wall.hz).toBeCloseTo(1, 6);
  });

  it('mount spots: walls in reach that go up far enough, with a clear floor in front; a low kerb is not one', () => {
    const kerb: Box = {min: {x: 0, y: 0, z: 0}, max: {x: 0.5, y: 0.4, z: 6}};
    const w = boxWorld(ROOM, [kerb]);
    const spots = findMounts(w, 2, 0, 3, 6);
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(s.up).toBeGreaterThanOrEqual(1.4);
      expect(Math.abs(s.x - 0.5 - CRAWL.radius - 0.06), 'the kerb front is no mount').toBeGreaterThan(0.05);
      expect(w.stand(s.x, 0, s.z, CRAWL.radius)).not.toBeNull();
    }
    expect(spots[0].dist).toBeLessThanOrEqual(spots[spots.length - 1].dist);
  });
});

describe('BB leap: a swept ballistic body', () => {
  const w = boxWorld(ROOM, [{min: {x: 4, y: 0, z: 0}, max: {x: 4.5, y: 3, z: 2.4}}]);

  it('the launch velocity carries the body to its target under gravity', () => {
    const from = {x: 1, y: 0.2, z: 4}, to = {x: 3.5, y: 1.1, z: 4.5};
    const v = launchVelocity(from, to, 7.5, 16);
    const x = from.x + v.vx * v.T, y = from.y + v.vy * v.T - 8 * v.T * v.T, z = from.z + v.vz * v.T;
    expect([x, y, z].map(n => +n.toFixed(6))).toEqual([3.5, 1.1, 4.5]);
    expect(v.T).toBeGreaterThanOrEqual(0.2);
    expect(v.T).toBeLessThanOrEqual(0.65);
    expect(arcClear(w, from, v, 16, v.T)).toBe(true);
  });

  it('an arc through a wall is not clear, and a flying body stops at the wall instead of passing it', () => {
    const from = {x: 3, y: 0.2, z: 1}, to = {x: 5.5, y: 1.1, z: 1};
    const v = launchVelocity(from, to, 7.5, 16);
    expect(arcClear(w, from, v, 16, v.T)).toBe(false);
    const f = {...from, vx: v.vx, vy: v.vy, vz: v.vz};
    let hit = null;
    for (let k = 0; k < 120 && !hit; k++) hit = flightStep(w, f, 1 / 60, 16);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('wall');
    expect(f.x).toBeLessThan(4);
    expect(hit!.x).toBeCloseTo(4, 3);
  });

  it('a free fall lands on the floor (the body stops just above it), and floorBelow finds a level floor but not a prop top', () => {
    const f = {x: 2, y: 2.5, z: 4, vx: 0, vy: 0, vz: 0};
    let hit = null;
    for (let k = 0; k < 200 && !hit; k++) hit = flightStep(w, f, 1 / 60, 16);
    expect(hit!.kind).toBe('floor');
    expect(hit!.y).toBeCloseTo(0, 6);
    expect(f.y).toBeGreaterThan(0);
    expect(f.y).toBeLessThan(0.2);
    expect(floorBelow(w, 2, 2.5, 4, 5)).toBeCloseTo(0, 6);
    const withProp = boxWorld(ROOM, [{min: {x: 1, y: 0, z: 3}, max: {x: 3, y: 1, z: 5}, prop: true}]);
    expect(floorBelow(withProp, 2, 2.5, 4, 5)).toBeNull();
  });

  it('flightClear holds the body\'s centre off the walls it passes, keeps its velocity, and never pushes it into anything', () => {
    const R = CRAWL.radius;
    // along the wall's face (x = 4), 0.1 m from it: pushed out to the clearance, its speed untouched
    const along = {x: 3.9, y: 1.5, z: 1, vx: 0, vy: -1, vz: 3};
    expect(flightClear(w, along, R)).toBe(true);
    expect(along.x).toBeCloseTo(4 - R, 6);
    expect([along.z, along.vx, along.vy, along.vz]).toEqual([1, 0, -1, 3]);
    // in the open: nothing near, nothing changes
    const open = {x: 2, y: 1.5, z: 4, vx: 3, vy: 0, vz: 0};
    expect(flightClear(w, open, R)).toBe(false);
    expect(open).toEqual({x: 2, y: 1.5, z: 4, vx: 3, vy: 0, vz: 0});
    // drifting INTO the face at a shallow angle it is held at the clearance and slides along it, its velocity as it was
    // (a head-on flight meets the wall in flightStep: the test above)
    const into = {x: 3.6, y: 2.5, z: 0.4, vx: 0.5, vy: 0, vz: 3};
    let nearest = Infinity;
    for (let k = 0; k < 30; k++) {
      expect(flightStep(w, into, 1 / 60, 0)).toBeNull();
      flightClear(w, into, R);
      nearest = Math.min(nearest, 4 - into.x);
    }
    expect(nearest).toBeCloseTo(R, 6);
    expect(4 - into.x).toBeCloseTo(R, 6);
    expect(into.z).toBeCloseTo(0.4 + 3 * 30 / 60, 6);
    expect([into.vx, into.vz]).toEqual([0.5, 3]);
    // grazing the wall's END (its face z = 2.4) it is held off while beside it and goes on once past: it still arrives
    const graze = {x: 3.5, y: 1.5, z: 2.5, vx: 6, vy: 2, vz: 0};
    for (let k = 0; k < 20; k++) { expect(flightStep(w, graze, 1 / 60, 16)).toBeNull(); flightClear(w, graze, R); }
    expect(graze.x).toBeCloseTo(3.5 + 6 * 20 / 60, 6);
    expect(graze.z).toBeCloseTo(2.4 + R, 6);
    // in a slot narrower than its body it goes to the middle and stays there (no hopping from side to side)
    const slot = boxWorld(ROOM, [{min: {x: 4, y: 0, z: 0}, max: {x: 4.5, y: 3, z: 6}}, {min: {x: 3.2, y: 0, z: 0}, max: {x: 3.7, y: 3, z: 6}}]);
    const s = {x: 3.78, y: 1.5, z: 3, vx: 0, vy: 0, vz: 2};
    for (let k = 0; k < 4; k++) { flightClear(slot, s, R); expect(s.x).toBeCloseTo(3.85, 6); }
  });

  it('the flat stand-in world: one endless floor, nothing to climb', () => {
    const flat = flatCrawlWorld(2);
    expect(findMounts(flat, 0, 2, 0, 6)).toEqual([]);
    expect(flat.ray({x: 0, y: 3, z: 0}, {x: 0, y: -1, z: 0}, 5)).toMatchObject({t: 1, kind: 'floor'});
    expect(flat.ray({x: 0, y: 3, z: 0}, {x: 1, y: 0, z: 0}, 5).kind).toBe('none');
    expect(flat.stand(5, 2, 5, 0.22)).toBe(2);
    expect(flat.band(0, 1, 0)).toBeNull();
  });
});

describe('BB surface crawl: the real levels', () => {
  // from the foot of walls near real spawn points: mount, climb, and keep crawling wherever the surfaces lead
  const LEVEL_IDS: LevelId[] = ['subway', 'office', 'mall', 'bunker', 'skyways', 'reactor'];
  for (const level of LEVEL_IDS) {
    it(`${level}: walls are mounted and crawled on valid geometry only`, () => {
      const layout = LEVELS[level].generate('main', {levelSeed: 1201});
      const L = levelsOf(layout), w = layoutCrawlWorld(layout);
      let tried = 0, mounted = 0, ceilings = 0, corners = 0, metres = 0;
      for (const s of layout.zombies) {
        if (tried >= 14) break;
        const y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
        const spots = findMounts(w, s.x, y, s.z, 6);
        if (!spots.length) continue;
        tried++;
        const m = spots[0];
        expect(w.stand(m.x, y, m.z, CRAWL.radius), 'a mount spot is a floor to stand on').not.toBeNull();
        const c = mountWall(w, m.x, y, m.z, -m.nx, -m.nz, 0.9);
        if (!c) continue;
        mounted++;
        const r = crawl(w, c, 14);
        metres += r.moved;
        corners += r.path.length - 1;
        if (r.path.some(p => p.endsWith('ceiling'))) ceilings++;
      }
      expect(tried).toBeGreaterThanOrEqual(8);
      expect(mounted).toBeGreaterThanOrEqual(Math.ceil(tried * 0.5));
      expect(ceilings).toBeGreaterThanOrEqual(3);
      expect(corners).toBeGreaterThanOrEqual(mounted);
      expect(metres).toBeGreaterThan(mounted * 2.5);
    }, 60000);
  }
});
