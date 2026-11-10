// Task studio-screacher-production-20261110-221858-01: THE SCREACHER IN REAL GEOMETRY — the echo's line rule ("locates the player in
// range but NOT through walls"), sound through real walls and floors, and the blind brain walking to a sound through a real generated
// station with the game's own pathfinder and motor. Node only: real layouts, Levels, PropIndex, PathFinder, raycastWorld — the same
// calls game.ts makes (Game.echoScan / worldNoise / brainWorld), without rendering or audio.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf, type Levels} from '../src/gen/levels';
import {PathFinder} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {raycastWorld} from '../src/combat/hitscan';
import {slabsBetween, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {searchExpand} from '../src/ai/chaseShare';
import {SCREACHER_ECHO, SCREACHER_NOISE, SCREACHER_SPEED, SCREACHER_STATS, SCREACHER_VOICE_Y, ScreacherBrain, deliverNoise, echoLocate} from '../src/ai/screacher';
import {CROUCH_EYE, STAND_EYE} from '../src/player/player';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';

type V = {x: number; y: number; z: number};
/** Game.echoScan's `clear` (the enemies' sight line AND the bullet line), for a layout. */
function echoClear(layout: StationLayout, L: Levels, props: readonly PropPlacement[] = layout.props): (a: V, b: V) => boolean {
  const multi = L.count > 1;
  return (from, to) => {
    if (!(multi ? L.lineOfSight(from, to) : layout.grid.lineOfSight(from.x, from.z, to.x, to.z))) return false;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz);
    const h = raycastWorld(L, props, from, {x: dx / d, y: dy / d, z: dz / d}, d, layout.trench.floorY);
    return h.kind === 'none' || h.t >= d - 0.05;
  };
}
const standing = (x: number, y: number, z: number) => ({x, y, z, eye: y + STAND_EYE});

describe('Screacher echo: the line rule (pure)', () => {
  it('in range with a clear line = the player\'s position; out of range or blocked = nothing; the chest OR the head is enough', () => {
    const body = {x: 0, y: 0, z: 0};
    expect(echoLocate(body, standing(6, 0, 0), 18, () => true)).toEqual({x: 6, z: 0, y: 0});
    expect(echoLocate(body, standing(6, 0, 0), 18, () => false)).toBeNull();
    expect(echoLocate(body, standing(18.5, 0, 0), 18, () => true)).toBeNull(); // beyond the range
    expect(echoLocate(body, standing(0, 30, 0), 18, () => true)).toBeNull(); // 3D: far above
    const lines: number[] = [];
    expect(echoLocate(body, standing(6, 0, 0), 18, (_f, to) => { lines.push(to.y); return to.y > 1.5; })).toEqual({x: 6, z: 0, y: 0}); // only the head line is clear
    expect(lines.length).toBe(2);
    expect(lines[0]).toBeLessThan(lines[1]); // chest, then head
    // the line starts at the stump, not at the feet
    echoLocate(body, standing(6, 0, 0), 18, from => { expect(from).toEqual({x: 0, y: SCREACHER_VOICE_Y, z: 0}); return true; });
    // touching distance: nothing can be between
    expect(echoLocate({x: 0, y: -SCREACHER_VOICE_Y + 1, z: 0}, standing(0.2, 0, 0), 18, () => false)).not.toBeNull();
  });
});

describe('Screacher in a real Subway station', () => {
  const layout = LEVELS.subway.generate('main', {levelSeed: 1201});
  const L = levelsOf(layout), g = layout.grid, clear = echoClear(layout, L);
  const floor = (x: number, z: number): number => g.floorAt(x, z);
  /** Walkable cell centres within [r0, r1] m of (x, z) on the main grid. */
  const ring = (x: number, z: number, r0: number, r1: number): [number, number][] => {
    const out: [number, number][] = [], [cx, cy] = g.cellOf(x, z), n = Math.ceil(r1 / 0.5);
    for (let dy = -n; dy <= n; dy += 2) for (let dx = -n; dx <= n; dx += 2) {
      const X = cx + dx, Y = cy + dy;
      if (X < 0 || Y < 0 || X >= g.w || Y >= g.h || !g.walkable(X, Y)) continue;
      const c = g.center(X, Y), d = Math.hypot(c[0] - x, c[1] - z);
      if (d >= r0 && d <= r1) out.push([c[0], c[1]]);
    }
    return out;
  };
  const bodies = layout.zombies.filter(z => (z.level ?? 0) === 0).slice(0, 12);

  it('the echo NEVER locates a player behind a wall, and does locate players in the open (hundreds of real point pairs)', () => {
    let through = 0, located = 0, walled = 0, open = 0;
    for (const b of bodies) {
      const by = floor(b.x, b.z);
      for (const [px, pz] of ring(b.x, b.z, 2, SCREACHER_ECHO.rangeM - 1)) {
        const py = floor(px, pz);
        if (Math.abs(py - by) > 0.4) continue; // same floor height (platform vs track bed is its own case)
        const hit = echoLocate({x: b.x, y: by, z: b.z}, standing(px, py, pz), SCREACHER_ECHO.rangeM, clear);
        // ground truth from the 2D sight grid: a wall (or a sight-blocking prop) between — for the line itself AND for the two lines
        // 0.35 m to either side (a line that only grazes a wall corner is not "behind a wall": the 3D line may pass it)
        const d = Math.hypot(px - b.x, pz - b.z), nx = -(pz - b.z) / d * 0.35, nz = (px - b.x) / d * 0.35;
        const mid = g.lineOfSight(b.x, b.z, px, pz);
        const behindWall = !mid && !g.lineOfSight(b.x + nx, b.z + nz, px + nx, pz + nz) && !g.lineOfSight(b.x - nx, b.z - nz, px - nx, pz - nz);
        if (behindWall) { walled++; if (hit) through++; }
        else if (mid) { open++; if (hit) { located++; expect(hit).toEqual({x: px, z: pz, y: py}); } }
      }
    }
    expect(walled).toBeGreaterThan(300); // the sample really has walls between
    expect(through).toBe(0); // NOT through walls
    expect(open).toBeGreaterThan(300);
    expect(located / open).toBeGreaterThan(0.6); // (the rest: solid props in the way)
  });

  it('out of range is out of range, however open the hall', () => {
    for (const b of bodies) for (const [px, pz] of ring(b.x, b.z, SCREACHER_ECHO.rangeM + 1.5, SCREACHER_ECHO.rangeM + 6)) {
      expect(echoLocate({x: b.x, y: floor(b.x, b.z), z: b.z}, standing(px, floor(px, pz), pz), SCREACHER_ECHO.rangeM, clear)).toBeNull();
    }
  });

  it('solid cover works: crouched behind a 1.2 m counter = not found; standing up behind it = found', () => {
    // a body and a point 6 m away in the open (a clear line with the station's own props)
    let found: {b: V; p: V} | null = null;
    for (const z of bodies) {
      const by = floor(z.x, z.z);
      for (const [px, pz] of ring(z.x, z.z, 5.5, 6.5)) {
        const py = floor(px, pz);
        if (Math.abs(py - by) > 0.05) continue;
        const stand = standing(px, py, pz), crouch = {x: px, y: py, z: pz, eye: py + CROUCH_EYE};
        if (echoLocate({x: z.x, y: by, z: z.z}, stand, 18, clear) && echoLocate({x: z.x, y: by, z: z.z}, crouch, 18, clear)) { found = {b: {x: z.x, y: by, z: z.z}, p: {x: px, y: py, z: pz}}; break; }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const {b, p} = found!, d = Math.hypot(p.x - b.x, p.z - b.z), ux = (b.x - p.x) / d, uz = (b.z - p.z) / d;
    // a solid counter 0.8 m in front of the player, between the two
    const counter = {kind: 'crate', x: p.x + ux * 0.8, z: p.z + uz * 0.8, y: p.y, rot: 0, area: 0, hx: 0.9, hz: 0.9, h: 1.2, blocksSight: false, variant: 0} as unknown as PropPlacement;
    const withCounter = echoClear(layout, L, [...layout.props, counter]);
    expect(echoLocate(b, {...p, eye: p.y + CROUCH_EYE}, 18, withCounter)).toBeNull();
    expect(echoLocate(b, standing(p.x, p.y, p.z), 18, withCounter)).toEqual({x: p.x, z: p.z, y: p.y});
  });

  it('a sprinting footstep carries about 11 m in the open and only ~6.6 m through a wall (the gunfire muffle)', () => {
    let openHeard = 0, openN = 0, wallHeard = 0, wallN = 0;
    for (const b of bodies.slice(0, 8)) {
      for (const [sx, sz] of ring(b.x, b.z, 7.2, 9.5)) {
        const sy = floor(sx, sz);
        if (Math.abs(sy - floor(b.x, b.z)) > 0.4) continue;
        const ear = new ScreacherBrain(b.x, b.z, 0);
        ear.y = floor(b.x, b.z);
        const los = g.lineOfSight(sx, sz, b.x, b.z);
        const n = deliverNoise([ear], {x: sx, y: sy, z: sz}, SCREACHER_NOISE.run, 'run', () => los, null);
        if (los) { openN++; openHeard += n; } else { wallN++; wallHeard += n; }
      }
    }
    expect(openN).toBeGreaterThan(40);
    expect(wallN).toBeGreaterThan(40);
    expect(openHeard).toBe(openN); // 7.2-9.5 m in the open: always heard (radius 11)
    expect(wallHeard).toBe(0); // the same distance behind a wall: never (11 x 0.6 = 6.6)
  });

  it('walks to a sound in another part of the station through the real pathfinder and motor, swings at the spot, then searches', () => {
    const props = new PropIndex(L, layout.props), pf = new PathFinder(L);
    const multi = L.count > 1;
    // a body and a sound source 14-30 m apart on the same floor height, in different areas
    let a = -1, t = -1;
    outer: for (let i = 0; i < layout.zombies.length; i++) for (let j = 0; j < layout.zombies.length; j++) {
      const p = layout.zombies[i], q = layout.zombies[j];
      if (i === j || (p.level ?? 0) !== 0 || (q.level ?? 0) !== 0 || p.area === q.area) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < 14 || d > 30 || Math.abs(floor(p.x, p.z) - floor(q.x, q.z)) > 0.05) continue;
      if (g.lineOfSight(p.x, p.z, q.x, q.z)) continue; // not in plain line: it must find its way round
      if (!pf.find(p.x, p.z, q.x, q.z, 0.34, 26000, {noLinks: true, drops: true, ay: floor(p.x, p.z), by: floor(q.x, q.z)})) continue;
      a = i; t = j; break outer;
    }
    expect(a).toBeGreaterThanOrEqual(0);
    const A = layout.zombies[a], T = layout.zombies[t], ty = floor(T.x, T.z);
    const b = new ScreacherBrain(A.x, A.z, A.yaw);
    b.echoT = 1e6;
    b.y = floor(A.x, A.z);
    const player = {x: A.x, z: A.z, y: b.y - 50}; // silent and nowhere near (another height: never touched, never hit)
    const linkOpts: unknown[] = [];
    const world = (): BrainWorld => ({
      px: player.x, pz: player.z, py: player.y, playerAlive: true,
      los: (ax, az, bx, bz, ay, by) => (multi && ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : g.lineOfSight(ax, az, bx, bz)),
      walkClear: (ax, az, bx, bz, r, ay, by) => (multi && ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : g.walkLineClearH(ax, az, bx, bz, r)),
      findPath: (ax, az, bx, bz, opts) => { linkOpts.push(opts); return pf.find(ax, az, bx, bz, 0.34, searchExpand(opts), opts); },
      randomNear: () => null,
      rand: () => 0.5,
      ladder: id => layout.traversal.ladders[id],
    });
    expect(b.hearNoise(T.x, T.z, 40, ty, 'impact')).toBe(true);
    const d0 = Math.hypot(b.x - T.x, b.z - T.z), DT = 1 / 60;
    let hits = 0, best = d0, off = 0, speedMax = 0, arrivedAt = -1;
    const seq0 = b.attackSeq;
    for (let time = 0; time < 70 && !(b.attackSeq > seq0 && b.state !== 'attack' && b.belief === null); time += DT) {
      const out: BrainOutput = b.update(DT, world());
      if (out.face !== null) { let d = out.face - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * DT; b.yaw += Math.max(-turn, Math.min(turn, d)); }
      moveZombie(b, out, DT, L, props);
      settleZombie(b, L, props);
      if (out.attackHit) hits++;
      speedMax = Math.max(speedMax, out.speed);
      const d = Math.hypot(b.x - T.x, b.z - T.z);
      best = Math.min(best, d);
      if (d <= SCREACHER_STATS.attackRange + 0.05 && arrivedAt < 0) arrivedAt = time;
      const [cx, cy] = g.cellOf(b.x, b.z);
      if (!g.walkable(cx, cy)) off++;
    }
    expect(best).toBeLessThanOrEqual(SCREACHER_STATS.attackRange + 0.05); // it reached the sound's spot
    expect(arrivedAt).toBeGreaterThan(d0 / SCREACHER_SPEED.investigate * 0.9); // at the stalking walk (one sound): no faster than its pace allows
    expect(speedMax).toBe(SCREACHER_SPEED.investigate);
    expect(b.attackSeq - seq0).toBe(1); // one swing at the spot
    expect(hits).toBe(0); // nobody there
    expect(off).toBe(0); // never through a wall
    expect(b.belief).toBeNull();
    expect(linkOpts.length).toBeGreaterThan(0);
    for (const o of linkOpts) expect((o as {noLinks?: boolean}).noLinks).toBe(true);
  }, 120_000);
});

describe('Screacher in a real multi-storey level (Office): floors block the echo and muffle sound', () => {
  const layout = LEVELS.office.generate('main', {levelSeed: 1201});
  const L = levelsOf(layout), clear = echoClear(layout, L);
  const bases = L.list.map(l => l.baseY);

  it('a player on another storey with a slab between is never located, even a few metres away in plan', () => {
    let pairs = 0, located = 0;
    const byLevel = new Map<number, typeof layout.zombies>();
    for (const z of layout.zombies) { const k = z.level ?? 0; byLevel.set(k, [...(byLevel.get(k) ?? []), z]); }
    for (const [k, list] of byLevel) for (const b of list) {
      const by = b.y ?? L.grid(k).floorAt(b.x, b.z);
      for (const [k2, others] of byLevel) {
        if (k2 === k) continue;
        for (const o of others) {
          const oy = o.y ?? L.grid(k2).floorAt(o.x, o.z);
          if (slabsBetween(bases, by, oy) < 1 || Math.hypot(o.x - b.x, oy - by, o.z - b.z) > SCREACHER_ECHO.rangeM) continue;
          if (L.lineOfSight({x: b.x, y: by + SCREACHER_VOICE_Y, z: b.z}, {x: o.x, y: oy + 1.0, z: o.z})) continue; // an open stairwell / void line is not "through a floor"
          pairs++;
          if (echoLocate({x: b.x, y: by, z: b.z}, standing(o.x, oy, o.z), SCREACHER_ECHO.rangeM, clear)) located++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(20);
    expect(located).toBe(0);
  });

  it('a sprint directly above or below is muffled by the slab (11 m x 0.35 = 3.85 m: a storey away is out of earshot)', () => {
    const z = layout.zombies.find(s => (s.level ?? 0) >= 2)!;
    const ear = new ScreacherBrain(z.x, z.z, 0);
    ear.y = z.y ?? 0;
    const below = bases.filter(b => b < ear.y - 1).sort((p, q) => q - p)[0];
    expect(below).toBeDefined();
    expect(deliverNoise([ear], {x: z.x, y: below, z: z.z}, SCREACHER_NOISE.run, 'run', () => false, bases)).toBe(0);
    expect(deliverNoise([ear], {x: z.x + 3, y: ear.y, z: z.z}, SCREACHER_NOISE.run, 'run', () => true, bases)).toBe(1); // the same sprint on its own floor
  });
});
