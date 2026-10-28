// Iteration 05 (Lane T): vertical traversal — a walkable track bed with rescue ladders on both
// faces, height-aware nav/AI, physics and pickups. Iteration 08 (Lane A): the old beyond-the-tunnel
// underpasses are replaced by stacked LEVELS — enclosed stair cores from the platforms up to the
// upper concourse and down to the service crossing beneath the platforms and track beds. Uses
// generated stations of every archetype plus the pure player/brain models.

import {describe, expect, it} from 'vitest';
import {ARCHETYPES, generateStation, type Archetype, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, PathFinder, VOID, rampHeight, stepTop, type Waypoint} from '../src/gen/grid';
import {LADDER, STAIR, climbDuration, ladderClimbPath, ladderTarget, traversalIssues} from '../src/gen/traversal';
import {LOWER_FLOOR, SLAB} from '../src/gen/levelGen';
import {levelsOf, type Levels} from '../src/gen/levels';
import {Player, type MoveInput} from '../src/player/player';
import {PropIndex} from '../src/core/physics';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {moveZombie} from '../src/ai/motor';
import {StaticQuery, rampPieces} from '../src/physics/staticQuery';
import {PhysicsSystem} from '../src/physics/world';
import * as CANNON from 'cannon-es';
import {CasingSystem} from '../src/physics/casings';
import {raycastWorld} from '../src/combat/hitscan';
import * as THREE from 'three';

const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: Archetype) => {
  const k = `${seed}:${archetype ?? ''}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
const PER_ARCH = ARCHETYPES.map((a, i) => gen(9001 + i * 7919, a));

class Keys implements MoveInput {
  held = new Set<string>();
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}
const opts = {aiming: false, speedMult: 1, canSprint: true};
const DT = 1 / 60;

/** Drives the player along waypoints (yaw toward the next one, W held). Returns frames used or -1. */
function walk(p: Player, world: StationLayout['grid'] | Levels, props: PropIndex, path: Waypoint[], maxFrames: number, each?: (p: Player) => void): number {
  const k = new Keys();
  k.held.add('KeyW');
  let i = 0;
  for (let f = 0; f < maxFrames; f++) {
    while (i < path.length && Math.hypot(path[i][0] - p.x, path[i][1] - p.z) < 0.3) i++;
    if (i >= path.length) return f;
    p.yaw = Math.atan2(-(path[i][0] - p.x), -(path[i][1] - p.z));
    p.update(DT, k, world, props, opts);
    each?.(p);
  }
  return -1;
}

/** Flights of the stair run a level link starts with (same area), in walking order from h0 = 0. */
const runFlights = (l: StationLayout, traversalId: number) => {
  const first = l.traversal.stairs[traversalId];
  return l.traversal.stairs.filter(f => f.area === first.area);
};

describe('stair cores between levels (iteration 08: replaces the underpass beyond the tunnel)', () => {
  it('every family: cores up to the upper concourse and down beneath the tracks; 0.17 x 0.28 m steps, >= 1.2 m landings, >= 2.4 m clear', () => {
    for (const l of PER_ARCH) {
      const tag = `${l.seed}/${l.archetype}`;
      const plan = l.levelPlan!;
      expect(plan, tag).toBeDefined();
      const P1 = l.areas[l.platform];
      expect(plan.hu, `${tag} upper floor = platform ceiling + slab`).toBeCloseTo(P1.ceil + SLAB, 5);
      // The service level lies a slab below the track bed with >= 2.4 m clear.
      expect(l.trench.floorY - plan.lowerCeil, tag).toBeGreaterThanOrEqual(SLAB - 1e-6);
      expect(plan.lowerCeil - plan.lowerFloor).toBeGreaterThanOrEqual(2.4);
      // The service crossing runs BENEATH the visible platforms and beds (not beyond the tunnel mouth).
      const X = l.areas[plan.crossing];
      expect(X.level).toBe(2);
      for (const t of l.trenches.slice(0, 1)) {
        expect(X.x * CELL, `${tag} crossing within the platform span`).toBeGreaterThanOrEqual(t.platformX0);
        expect((X.x + X.w) * CELL).toBeLessThanOrEqual(t.platformX1);
        expect(X.y * CELL, `${tag} crossing spans the bed`).toBeLessThanOrEqual(t.z0);
        expect((X.y + X.h) * CELL).toBeGreaterThanOrEqual(t.z1);
      }
      const ups = l.levelLinks.filter(k => k.upper === 1), downs = l.levelLinks.filter(k => k.lower === 2);
      expect(ups.length, tag).toBeGreaterThanOrEqual(2);
      expect(downs.length, tag).toBeGreaterThanOrEqual(1);
      for (const k of [...ups, ...downs]) {
        const fl = runFlights(l, k.traversalId!);
        const up = k.upper === 1;
        expect(fl[0].h0).toBe(0);
        expect(fl[fl.length - 1].h1).toBeCloseTo(up ? plan.hu : LOWER_FLOOR, 5);
        expect(fl.length, `${tag} flights of ${up ? 'up' : 'down'} run`).toBe(Math.ceil(Math.round(Math.abs(fl[fl.length - 1].h1) / STAIR.riser) / STAIR.maxRisers));
        for (const x of fl) {
          expect(x.riser).toBeGreaterThan(0.15);
          expect(x.riser).toBeLessThan(0.18);
          expect(x.tread).toBeCloseTo(STAIR.tread, 5);
          expect(x.risers).toBeLessThanOrEqual(STAIR.maxRisers);
          expect(Math.abs(x.s1 - x.s0)).toBeCloseTo(x.risers * x.tread, 5);
          expect(Math.abs(x.a1 - x.a0), 'flight width').toBeGreaterThanOrEqual(1.8);
          // The same ramp, same index, carved into BOTH connected level grids; headroom over the whole flight.
          for (const lv of [k.lower, k.upper]) {
            const g = l.levels[lv].grid, r = g.ramps[x.ramp];
            expect(r).toBe(l.grid.ramps[x.ramp]);
            for (let y = r.y; y < r.y + r.h; y++) for (let cx = r.x; cx < r.x + r.w; cx++) {
              const i = g.idx(cx, y);
              expect(g.rampIdx[i], `${tag} ramp ${x.ramp} on level ${lv}`).toBe(x.ramp);
              const hi = Math.max(rampHeight(r, cx * CELL), rampHeight(r, (cx + 1) * CELL));
              expect(g.ceil[i] - hi).toBeGreaterThanOrEqual(2.4);
            }
          }
        }
        for (let i = 1; i < fl.length; i++) expect(Math.abs(fl[i].s0 - fl[i - 1].s1), 'landing').toBeGreaterThanOrEqual(STAIR.landing - 1e-6);
      }
    }
  });

  it('the step profile matches the pitch line at tread centres and ends at the landings', () => {
    const r = PER_ARCH[0].grid.ramps[0];
    const d = (r.s1 - r.s0) / r.risers;
    for (let k = 1; k < r.risers; k++) expect(stepTop(r, r.s0 + d * k)).toBeCloseTo(rampHeight(r, r.s0 + d * k), 6);
    expect(stepTop(r, r.s0 - 0.2)).toBe(r.h0);
    expect(stepTop(r, r.s1 + 0.2)).toBeCloseTo(r.h1, 6);
  });

  it('a player walks the level loop on real stairs: up a core, across the crossover, down again, down beneath the tracks and back up', () => {
    for (const l of PER_ARCH) {
      const tag = `${l.seed}/${l.archetype}`;
      const L = levelsOf(l);
      const props = new PropIndex(L, l.props);
      const pf = new PathFinder(L);
      const ups = l.levelLinks.filter(k => k.upper === 1), downs = l.levelLinks.filter(k => k.lower === 2);
      // Up core A -> upper level -> down core B (its up run) -> core B / platform -> service level -> back up core A.
      const a = ups[0], b = ups[1], dn = downs[downs.length - 1], dnA = downs[0];
      const route = [a.top, b.top, b.bottom, dn.top, dn.bottom, dnA.bottom, dnA.top];
      const p = new Player();
      p.spawn(a.bottom.x, a.bottom.z, 0, a.bottom.y);
      let airborne = 0, minY = Infinity, maxY = -Infinity;
      for (const t of route) {
        const path = pf.find(p.x, p.z, t.x, t.z, 0.3, 200000, {ay: p.y, by: t.y});
        expect(path, `${tag} path to ${t.x.toFixed(1)},${t.y.toFixed(2)},${t.z.toFixed(1)}`).not.toBeNull();
        const frames = walk(p, L, props, path!, 4000, q => { if (!q.grounded) airborne++; minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); });
        expect(frames, `${tag} reached ${t.x.toFixed(1)},${t.y.toFixed(2)},${t.z.toFixed(1)} (at ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(0);
        expect(p.y, tag).toBeCloseTo(t.y, 1);
      }
      expect(maxY, `${tag} reached the upper level`).toBeGreaterThan(l.levelPlan!.hu - 0.05);
      expect(minY, `${tag} reached the service level`).toBeLessThan(LOWER_FLOOR + 0.05);
      expect(minY).toBeGreaterThan(LOWER_FLOOR - 0.02);
      expect(airborne, `${tag}: stairs must be walked, not fallen down`).toBeLessThan(6);
    }
  });
});

describe('walkable track bed and rescue ladders', () => {
  it('ladders on both faces of two-sided beds (opposite pairs), near each platform end, every <= 34 m', () => {
    let pairs = 0;
    for (const l of PER_ARCH) {
      expect(traversalIssues(l), `${l.seed}/${l.archetype}`).toEqual([]);
      const g = l.grid;
      l.trenches.forEach((t, ti) => {
        const own = l.traversal.ladders.filter(x => x.trench === ti);
        const north = own.filter(x => x.dir < 0), south = own.filter(x => x.dir > 0);
        const rowN = Math.round(t.z0 / CELL) - 1, rowS = Math.round(t.z1 / CELL);
        const midX = Math.floor((t.platformX0 + t.platformX1) / 2 / CELL);
        const platN = g.get(midX, rowN) === FLOOR, platS = g.get(midX, rowS) === FLOOR;
        expect(north.length > 0).toBe(platN);
        expect(south.length > 0).toBe(platS);
        for (const side of [north, south]) {
          if (!side.length) continue;
          const xs = side.map(x => x.x).sort((a, b) => a - b);
          expect(xs[0] - t.platformX0).toBeLessThanOrEqual(LADDER.endInset + 2.1);
          expect(t.platformX1 - xs[xs.length - 1]).toBeLessThanOrEqual(LADDER.endInset + 2.1);
          for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(LADDER.maxSpacing + 4.1);
        }
        if (platN && platS) {
          for (const x of own) {
            expect(x.pair, `${l.archetype} ladder ${x.id} unpaired`).toBeGreaterThanOrEqual(0);
            const o = l.traversal.ladders[x.pair];
            expect(o.dir).toBe(-x.dir as 1 | -1);
            expect(Math.abs(o.x - x.x)).toBeLessThan(1.6);
            pairs++;
          }
        }
        for (const x of own) {
          // Foot in the track bed, head on the platform, at the right heights.
          expect(g.get(...g.cellOf(x.bottom.x, x.bottom.z))).toBe(VOID);
          expect(g.get(...g.cellOf(x.top.x, x.top.z))).toBe(FLOOR);
          expect(x.bottomY).toBeCloseTo(t.floorY, 5);
          expect(x.topY).toBe(0);
          expect(l.grid.links[x.link].id).toBe(x.id);
        }
      });
    }
    expect(pairs).toBeGreaterThan(8);
  });

  it('no softlock: from every track-bed cell the platforms are reachable again, and everything the spawn reaches leads back', () => {
    for (const l of PER_ARCH) {
      const g = l.grid;
      const [sx, sy] = g.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const from = g.distanceField(sx, sy);
      // Reverse reachability: BFS from each sampled reached cell back to the spawn.
      const sample: number[] = [];
      for (let i = 0; i < from.length; i += 97) if (from[i] >= 0) sample.push(i);
      for (let t = 0; t < l.trenches.length; t++) {
        const tr = l.trenches[t];
        for (const x of [tr.x0 + 0.75, (tr.platformX0 + tr.platformX1) / 2, tr.x1 - 0.75]) sample.push(g.idx(...g.cellOf(x, (tr.z0 + tr.z1) / 2 + 0.6)));
      }
      for (const i of sample.slice(0, 60)) {
        const x = i % g.w, y = (i - x) / g.w;
        if (!g.passable(x, y)) continue;
        expect(g.distanceField(x, y)[g.idx(sx, sy)], `${l.archetype} cell ${x},${y} cannot get back`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('dropping off the platform edge lands in the track bed (no damage) and the face blocks walking back up', () => {
    const l = PER_ARCH[0];
    const t = l.trench;
    const P = l.areas[l.platform];
    const props = new PropIndex(l.grid, l.props);
    const north = Math.abs(P.y * CELL - t.z1) < 1e-6; // platform 1 south of the bed: walk -Z
    const x = l.traversal.ladders.filter(q => q.platform === P.id)[0].x + 6;
    const p = new Player();
    const z0 = north ? t.z1 + 1.2 : t.z0 - 1.2;
    p.spawn(x, z0, north ? 0 : Math.PI, 0);
    const k = new Keys();
    k.held.add('KeyW');
    let landed = false;
    for (let f = 0; f < 120; f++) { p.update(DT, k, l.grid, props, opts); if (p.justLanded) landed = true; }
    expect(landed).toBe(true);
    expect(p.y).toBeCloseTo(t.floorY, 3);
    expect(p.hp).toBe(p.maxHp);
    // Walk back toward the platform: the 1.15 m face stops you (and jumping does not clear it).
    p.yaw += Math.PI;
    k.taps.add('Space');
    for (let f = 0; f < 120; f++) { p.update(DT, k, l.grid, props, opts); k.taps.clear(); }
    expect(p.y).toBeLessThan(-1);
    expect(north ? p.z : -p.z).toBeLessThan(north ? t.z1 : -t.z0);
  });

  it('the QA stand points (goLadder) see the climb prompt from the bed and from the platform for every ladder', () => {
    for (const l of PER_ARCH) {
      for (const lad of l.traversal.ladders) {
        for (const end of ['bottom', 'top'] as const) {
          const s = end === 'bottom' ? lad.bottom : lad.top;
          const x = s.x, z = s.z - lad.dir * (end === 'bottom' ? 0.3 : -0.45), y = l.grid.floorAt(x, z);
          const yaw = (end === 'bottom') === (lad.dir > 0) ? Math.PI : 0, pitch = end === 'bottom' ? -0.3 : -1.0;
          const fwd = {x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch)};
          const aim = ladderTarget(l.traversal.ladders, {x, y: y + 1.62, z}, fwd, y);
          expect(aim?.ladder.id, `${l.archetype} ladder ${lad.id} ${end}`).toBe(lad.id);
          expect(aim?.up).toBe(end === 'bottom');
        }
      }
    }
  });

  it('[E]-style climb up and down a ladder; letting go mid-climb drops safely into the track bed', () => {
    const l = PER_ARCH[0];
    const props = new PropIndex(l.grid, l.props);
    const lad = l.traversal.ladders[0];
    const p = new Player();
    p.spawn(lad.bottom.x, lad.bottom.z - lad.dir * 0.3, lad.dir > 0 ? Math.PI : 0, lad.bottomY);
    // Looking at the ladder from the track bed targets it (climb up).
    const eye = {x: p.x, y: p.y + 1.62, z: p.z};
    const look = new THREE.Vector3(-Math.sin(p.yaw), Math.sin(-0.3), -Math.cos(p.yaw)).normalize();
    const aim = ladderTarget(l.traversal.ladders, eye, look, p.y);
    expect(aim?.ladder.id).toBe(lad.id);
    expect(aim?.up).toBe(true);
    p.startClimb(lad, true);
    const k = new Keys();
    let rungs = 0, frames = 0;
    while (p.climbing && frames++ < 600) { p.update(DT, k, l.grid, props, opts); if (p.justRung) rungs++; }
    expect(p.climbing).toBe(false);
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(0);
    expect(l.grid.area[l.grid.idx(...l.grid.cellOf(p.x, p.z))]).toBe(lad.platform);
    expect(rungs).toBeGreaterThanOrEqual(3);
    expect(frames * DT).toBeLessThan(climbDuration(ladderClimbPath(lad, true, lad.bottom)) + 0.5);
    // From the platform, looking down at the ladder head targets it (climb down).
    const eye2 = {x: p.x, y: p.y + 1.62, z: p.z - lad.dir * -0.45};
    p.z = eye2.z;
    const down = new THREE.Vector3(0, -Math.sin(1.0), -lad.dir * Math.cos(1.0)).normalize();
    const aim2 = ladderTarget(l.traversal.ladders, eye2, down, p.y);
    expect(aim2?.up).toBe(false);
    p.startClimb(lad, false);
    frames = 0;
    while (p.climbing && frames++ < 600) p.update(DT, k, l.grid, props, opts);
    expect(p.y).toBeCloseTo(lad.bottomY, 3);
    // Up again, let go half way: falls back to the track-bed floor, standing, unhurt.
    p.startClimb(lad, true);
    for (let f = 0; f < 50; f++) p.update(DT, k, l.grid, props, opts);
    expect(p.y).toBeGreaterThan(lad.bottomY + 0.2);
    k.taps.add('Space');
    p.update(DT, k, l.grid, props, opts);
    k.taps.clear();
    expect(p.climbing).toBe(false);
    for (let f = 0; f < 90; f++) p.update(DT, k, l.grid, props, opts);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(lad.bottomY, 3);
    expect(p.hp).toBe(p.maxHp);
  });
});

describe('height-aware nav and zombies', () => {
  it('paths cross levels: track bed -> platform by ladder link, platform -> track bed by drop (chase only), platform -> underpass by stairs', () => {
    for (const l of PER_ARCH) {
      const pf = new PathFinder(l.grid);
      const lad = l.traversal.ladders.find(q => q.trench === 0)!;
      const inBed = {x: lad.x + 9, z: lad.bottom.z};
      const top = lad.top;
      const t0 = performance.now();
      const up = pf.find(inBed.x, inBed.z, top.x + 4, top.z + lad.dir * 2, 0.34, 26000);
      expect(performance.now() - t0).toBeLessThan(60);
      expect(up, `${l.archetype} bed->platform`).not.toBeNull();
      expect(up!.some(w => w[2] !== undefined), `${l.archetype} uses a ladder`).toBe(true);
      // Without drops a platform -> bed path climbs down a ladder; with drops it may jump in.
      const down = pf.find(top.x + 4, top.z + lad.dir * 2, inBed.x, inBed.z, 0.34, 26000)!;
      expect(down.some(w => w[2] !== undefined)).toBe(true);
      const drop = pf.find(top.x + 4, top.z + lad.dir * 2, inBed.x, inBed.z, 0.34, 26000, {drops: true})!;
      expect(drop).not.toBeNull();
      expect(drop.length).toBeLessThanOrEqual(down.length + 2);
    }
    // Iteration 08: platform -> service crossing (down a core) and platform -> upper concourse (up a core).
    for (const l of PER_ARCH) {
      const pf = new PathFinder(levelsOf(l));
      const X = l.areas[l.levelPlan!.crossing];
      const D = l.areas[l.levelPlan!.decks[0]];
      const P = l.areas[l.platform];
      const sp = l.playerSpawn;
      const down = pf.find(sp.x, sp.z, (X.x + X.w / 2) * CELL, (X.y + X.h / 2) * CELL, 0.34, 200000, {ay: 0, by: LOWER_FLOOR});
      expect(down, `${l.seed} platform -> service crossing`).not.toBeNull();
      expect(down!.some(w => (w[3] ?? 0) < -2), 'the route descends').toBe(true);
      const up = pf.find(sp.x, sp.z, (D.x + D.w / 2) * CELL, (D.y + D.h / 2) * CELL, 0.34, 200000, {ay: 0, by: l.levelPlan!.hu});
      expect(up, `${l.seed} platform -> upper concourse`).not.toBeNull();
      void P;
    }
  });

  it('a zombie in the track bed chases a player on the platform: walks to a ladder, climbs out, reaches the player', () => {
    for (const l of PER_ARCH.filter(x => x.trenches.length)) {
      const g = l.grid;
      const props = new PropIndex(g, l.props);
      const pf = new PathFinder(g);
      const lad = l.traversal.ladders[1] ?? l.traversal.ladders[0];
      const z = new ZombieBrain('shambler', lad.x + 7, lad.bottom.z, 0);
      z.y = g.floorAt(z.x, z.z);
      const px = lad.top.x - 3, pz = lad.top.z + lad.dir * 1.5;
      let rnd = 7;
      const w: BrainWorld = {
        px, pz, py: 0, playerAlive: true,
        los: (ax, az, bx, bz) => g.lineOfSight(ax, az, bx, bz),
        walkClear: (ax, az, bx, bz, r) => g.walkLineClearH(ax, az, bx, bz, r),
        findPath: (ax, az, bx, bz, o) => pf.find(ax, az, bx, bz, 0.34, 26000, o),
        randomNear: () => null,
        rand: () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647),
        ladder: id => l.traversal.ladders[id],
      };
      z.hear(px, pz, 50);
      let climbed = false, reached = false;
      for (let f = 0; f < 60 * 25 && !reached; f++) {
        const out = z.update(DT, w);
        if (z.climbing) climbed = true;
        moveZombie(z, out, DT, g, props);
        if (Math.abs(z.y) < 0.05 && Math.hypot(z.x - px, z.z - pz) < 1.6) reached = true;
      }
      expect(climbed, `${l.archetype} climbed a ladder`).toBe(true);
      expect(reached, `${l.archetype} reached the player (y ${z.y.toFixed(2)} at ${z.x.toFixed(1)},${z.z.toFixed(1)}; state ${z.state})`).toBe(true);
    }
  });

  it('a zombie on the platform drops into the track bed after a player there, and cannot swipe from above', () => {
    const l = PER_ARCH[0];
    const g = l.grid;
    const props = new PropIndex(g, l.props);
    const pf = new PathFinder(g);
    const lad = l.traversal.ladders[2] ?? l.traversal.ladders[0];
    const px = lad.x + 12, pz = lad.bottom.z - lad.dir * 1.2, py = g.floorAt(px, pz);
    const z = new ZombieBrain('shambler', px, lad.top.z + lad.dir * 0.4, 0);
    z.y = 0;
    let rnd = 3;
    const w: BrainWorld = {
      px, pz, py, playerAlive: true,
      los: (ax, az, bx, bz) => g.lineOfSight(ax, az, bx, bz),
      walkClear: (ax, az, bx, bz, r) => g.walkLineClearH(ax, az, bx, bz, r),
      findPath: (ax, az, bx, bz, o) => pf.find(ax, az, bx, bz, 0.34, 26000, o),
      randomNear: () => null,
      rand: () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647),
      ladder: id => l.traversal.ladders[id],
    };
    z.hear(px, pz, 50);
    let hitFromAbove = false, landed = false;
    for (let f = 0; f < 60 * 10; f++) {
      const out = z.update(DT, w);
      if (out.attackHit && z.y > -0.5) hitFromAbove = true;
      moveZombie(z, out, DT, g, props);
      if (z.y < py + 0.05) landed = true;
      if (landed && Math.hypot(z.x - px, z.z - pz) < 1.5) break;
    }
    expect(hitFromAbove).toBe(false);
    expect(landed).toBe(true);
    expect(Math.hypot(z.x - px, z.z - pz)).toBeLessThan(1.6);
  });
});

describe('physics, hitscan and loot follow floor heights', () => {
  it('statics: track bed, stair treads and the service-level floor; casings settle on a stair tread', () => {
    const l = PER_ARCH[0];
    const q = new StaticQuery(l);
    const f = l.traversal.stairs[0];
    const r = l.grid.ramps[f.ramp];
    const mid = (f.s0 + f.s1) / 2, across = (f.a0 + f.a1) / 2;
    const [x, z] = f.axis === 'x' ? [mid, across] : [across, mid];
    expect(q.cellGround(x, z, stepTop(r, f.axis === 'x' ? x : z) + 0.5)).toBeCloseTo(stepTop(r, f.axis === 'x' ? x : z), 6);
    const t = l.trench;
    const bx = (t.platformX0 + t.platformX1) / 2 + 0.1, bz = (t.z0 + t.z1) / 2 + 0.3;
    expect(q.cellGround(bx, bz, t.floorY + 0.5)).toBeCloseTo(t.floorY, 6);
    // Iteration 08: the service crossing runs beneath the platforms and track bed.
    const X = l.areas[l.levelPlan!.crossing];
    const xx = (X.x + X.w / 2) * CELL, xz = (l.trench.z0 + l.trench.z1) / 2;
    expect(q.cellGround(xx, xz, LOWER_FLOOR + 0.5)).toBeCloseTo(LOWER_FLOOR, 6);
    expect(q.cellGround(xx, xz, t.floorY + 0.5)).toBeCloseTo(t.floorY, 6);
    const cs = new CasingSystem();
    cs.setStatics(q);
    cs.rand = () => 0.5;
    cs.eject(new THREE.Vector3(x, stepTop(r, f.axis === 'x' ? x : z) + 1.2, z), new THREE.Vector3(0.3, 0.2, 0.1), 'rifle');
    for (let i = 0; i < 400; i++) cs.update(1 / 60);
    const c = cs.list()[0];
    expect(c.mode).toBe(2);
    const ground = q.cellGround(c.x, c.z, c.y + 0.05);
    expect(c.y - ground).toBeGreaterThan(-0.002);
    expect(c.y - ground).toBeLessThan(0.02);
    // It rests on the flight (a tread or a landing of it), not inside the core walls or on the slab above.
    expect(ground).toBeGreaterThanOrEqual(Math.min(r.h0, r.h1) - 0.01);
    expect(ground).toBeLessThanOrEqual(Math.max(r.h0, r.h1) + 0.01);
  });

  it('ragdoll statics: chunk boxes follow floor heights and stair treads (tread boxes at tread heights, track-bed slab at the bed floor)', () => {
    const l = PER_ARCH[0];
    const ph = new PhysicsSystem(null);
    ph.build(l);
    const f = l.traversal.stairs[1];
    const r = l.grid.ramps[f.ramp];
    const span = 8 * CELL;
    const key = (x: number, z: number) => (Math.floor(z / span) + 4096) * 8192 + (Math.floor(x / span) + 4096);
    const pieces = rampPieces(r);
    expect(pieces.length).toBe(r.risers + 1);
    for (const p of pieces) expect(p.h).toBeCloseTo(stepTop(r, (p.s0 + p.s1) / 2), 6);
    const mid = pieces[Math.floor(pieces.length / 2)];
    const sx = (mid.s0 + mid.s1) / 2, ax = (mid.a0 + mid.a1) / 2;
    const [x, z] = f.axis === 'x' ? [sx, ax] : [ax, sx];
    const bodies = (ph as unknown as {buildChunk(k: number): CANNON.Body[]}).buildChunk(key(x, z));
    const tops = bodies.map(b => b.position.y + (b.shapes[0] as CANNON.Box).halfExtents.y);
    expect(tops.some(t => Math.abs(t - mid.h) < 1e-4), 'a tread box at the tread height').toBe(true);
    const t = l.trench;
    const bx = (t.platformX0 + t.platformX1) / 2, bz = (t.z0 + t.z1) / 2 + 0.3;
    const bedTops = (ph as unknown as {buildChunk(k: number): CANNON.Body[]}).buildChunk(key(bx, bz)).map(b => b.position.y + (b.shapes[0] as CANNON.Box).halfExtents.y);
    expect(bedTops.some(h => Math.abs(h - t.floorY) < 1e-4)).toBe(true);
    ph.dispose();
  });

  it('bullets hit the track bed, the platform face from below and stair treads at their heights', () => {
    const l = PER_ARCH[0];
    const g = l.grid;
    const t = l.trench;
    const P = l.areas[l.platform];
    const southPlat = Math.abs(P.y * CELL - t.z1) < 1e-6;
    const x = (t.platformX0 + t.platformX1) / 2 + 1.3;
    const zEdge = southPlat ? t.z1 : t.z0, dir = southPlat ? -1 : 1;
    // From the platform, down into the bed.
    const o = {x, y: 1.62, z: zEdge - dir * 1.0};
    const d = new THREE.Vector3(0, -1, dir * 1.6).normalize();
    const h = raycastWorld(g, l.props, o, d, 60, t.floorY);
    expect(h.kind).toBe('floor');
    expect(o.y + d.y * h.t).toBeCloseTo(t.floorY, 3);
    // From the bed, low toward the platform: hits the face, not the platform floor beyond.
    const o2 = {x, y: t.floorY + 0.5, z: zEdge + dir * 2.0};
    const h2 = raycastWorld(g, l.props, o2, {x: 0, y: 0, z: -dir}, 60, t.floorY);
    expect(h2.kind).toBe('wall');
    expect(o2.z + -dir * h2.t).toBeCloseTo(zEdge, 3);
    // Down the stairs: a ray from the top landing hits the flight at about the pitch line.
    const f = l.traversal.stairs[0], r = g.ramps[f.ramp];
    // Look back down the flight from its top landing (iteration 08 flights may climb: s0 is the low end then).
    const sgn = Math.sign(f.s1 - f.s0) * (f.h1 > f.h0 ? -1 : 1);
    const o3 = f.axis === 'x' ? {x: f.top.x, y: f.top.y + 1.62, z: f.top.z} : {x: f.top.x, y: f.top.y + 1.62, z: f.top.z};
    const d3 = f.axis === 'x' ? new THREE.Vector3(sgn, -0.9, 0).normalize() : new THREE.Vector3(0, -0.9, sgn).normalize();
    const h3 = raycastWorld(g, l.props, o3, d3, 30, t.floorY);
    expect(h3.kind).toBe('floor');
    const hx = o3.x + d3.x * h3.t, hz = o3.z + d3.z * h3.t;
    // Linear within a cell (a landing kink may fall inside one): within a few cm of the pitch line.
    expect(Math.abs(o3.y + d3.y * h3.t - rampHeight(r, f.axis === 'x' ? hx : hz))).toBeLessThan(0.03);
  });

  it('loose loot, props and zombies sit on their local floor; nothing rests on stairs; deterministic per seed', () => {
    for (const l of PER_ARCH) {
      // Iteration 08: every placement on its own level's grid.
      const gridOf = (lv?: number, area?: number) => l.levels[lv ?? (area !== undefined ? l.areas[area]?.level : 0) ?? 0].grid;
      for (const p of l.pickups) {
        const g = gridOf(p.level);
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.rampIdx[g.idx(cx, cy)]).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorAt(p.x, p.z) - 1e-6);
      }
      for (const p of l.props) {
        const g = gridOf(p.level);
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.rampIdx[g.idx(cx, cy)], `${p.kind} on stairs`).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorAt(p.x, p.z) - 1e-6);
      }
      for (const zs of l.zombies) { const g = gridOf(zs.level); expect(g.passable(...g.cellOf(zs.x, zs.z))).toBe(true); }
      // Fixtures stay below their local ceilings (flights, landings, the wells and the levels).
      for (const li of l.lights) { const g = gridOf(li.level, li.area); expect(li.y).toBeLessThanOrEqual(g.ceilAt(li.x, li.z) + 1e-6); }
    }
    const a = generateStation(PER_ARCH[0].seed), b = generateStation(PER_ARCH[0].seed);
    expect(JSON.stringify(a.traversal)).toBe(JSON.stringify(b.traversal));
    expect(Buffer.from(a.grid.floor.buffer).equals(Buffer.from(b.grid.floor.buffer))).toBe(true);
  });

  it('chase paths stay within the game cap on every archetype (with drops and ladders)', () => {
    for (const l of PER_ARCH) {
      if (l.platforms.length < 2) continue;
      const pf = new PathFinder(l.grid);
      const p1 = l.areas[l.platforms[0]], p2 = l.areas[l.platforms[1]];
      const a = l.grid.center(p2.x + Math.floor(p2.w * 0.3), p2.y + Math.floor(p2.h / 2));
      const b = l.grid.center(p1.x + Math.floor(p1.w * 0.7), p1.y + Math.floor(p1.h / 2));
      const t0 = performance.now();
      const path = pf.find(a[0], a[1], b[0], b[1], 0.34, 26000, {drops: true});
      expect(performance.now() - t0).toBeLessThan(80);
      expect(path, `${l.archetype}`).not.toBeNull();
    }
  });
});

