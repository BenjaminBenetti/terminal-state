// Iteration 05 (Lane T): vertical traversal — real underpasses below the tracks (stairs down and
// up), a walkable track bed with rescue ladders on both faces, height-aware nav/AI, physics and
// pickups. Uses generated stations of every archetype plus the pure player/brain models.

import {describe, expect, it} from 'vitest';
import {ARCHETYPES, generateStation, type Archetype, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, PathFinder, VOID, rampHeight, stepTop, type Waypoint} from '../src/gen/grid';
import {LADDER, STAIR, UNDERPASS_FLOOR, climbDuration, ladderClimbPath, ladderTarget, traversalIssues} from '../src/gen/traversal';
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
/** Layouts that have at least one underpass (side-platform archetypes). */
const WITH_UNDERPASS = (() => {
  const out: StationLayout[] = [];
  for (const a of ['side-mezzanine', 'interchange', 'deep', 'split'] as Archetype[]) {
    for (let s = 0; s < 12 && out.filter(l => l.archetype === a).length < 1; s++) {
      const l = gen(4000 + s * 131, a);
      if (l.traversal.underpasses.length) out.push(l);
    }
  }
  return out;
})();

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
function walk(p: Player, l: StationLayout, props: PropIndex, path: Waypoint[], maxFrames: number, each?: (p: Player) => void): number {
  const k = new Keys();
  k.held.add('KeyW');
  let i = 0;
  for (let f = 0; f < maxFrames; f++) {
    while (i < path.length && Math.hypot(path[i][0] - p.x, path[i][1] - p.z) < 0.3) i++;
    if (i >= path.length) return f;
    p.yaw = Math.atan2(-(path[i][0] - p.x), -(path[i][1] - p.z));
    p.update(DT, k, l.grid, props, opts);
    each?.(p);
  }
  return -1;
}

describe('underpass below the tracks', () => {
  it('every side-platform archetype sample has a real underpass: floor ~3.9 m down, >= 2.4 m clear, stairs ~0.17 x 0.28', () => {
    expect(WITH_UNDERPASS.map(l => l.archetype).sort()).toEqual(['deep', 'interchange', 'side-mezzanine', 'split']);
    for (const l of WITH_UNDERPASS) {
      const g = l.grid;
      for (const u of l.traversal.underpasses) {
        const bar = l.areas[u.bar];
        const f = g.floorAt((bar.x + bar.w / 2) * CELL, (bar.y + bar.h / 2) * CELL);
        expect(f).toBeCloseTo(UNDERPASS_FLOOR, 5);
        expect(bar.ceil - f).toBeGreaterThanOrEqual(2.4);
        // Below the track bed with room for the track structure.
        expect(l.trench.floorY - bar.ceil).toBeGreaterThanOrEqual(0.2);
        // The crossing passage spans the track line (north of it to south of it).
        const t = l.trenches[0];
        expect(bar.y * CELL).toBeLessThan(t.z0);
        expect((bar.y + bar.h) * CELL).toBeGreaterThan(t.z1);
        expect(u.legs.length).toBe(2);
        for (const leg of u.legs) {
          expect(leg.flights.length).toBe(2); // two flights with a landing
          const fl = leg.flights.map(i => l.traversal.stairs[i]);
          const risers = fl.reduce((n, x) => n + x.risers, 0);
          expect(fl[0].h0).toBe(0);
          expect(fl[fl.length - 1].h1).toBeCloseTo(UNDERPASS_FLOOR, 5);
          expect(risers).toBe(23);
          for (const x of fl) {
            expect(x.riser).toBeGreaterThan(0.15);
            expect(x.riser).toBeLessThan(0.18);
            expect(x.tread).toBeCloseTo(STAIR.tread, 5);
            expect(x.risers).toBeLessThanOrEqual(STAIR.maxRisers);
            expect(Math.abs(x.s1 - x.s0)).toBeCloseTo(x.risers * x.tread, 5);
            // Headroom over the whole flight.
            const r = g.ramps[x.ramp];
            for (let y = r.y; y < r.y + r.h; y++) for (let cx = r.x; cx < r.x + r.w; cx++) {
              const i = g.idx(cx, y);
              const hi = Math.max(rampHeight(r, cx * CELL), rampHeight(r, (cx + 1) * CELL));
              expect(g.ceil[i] - hi).toBeGreaterThanOrEqual(2.4);
            }
          }
          // Landing between the flights is at least 1.2 m.
          expect(Math.abs(fl[1].s0 - fl[0].s1)).toBeGreaterThanOrEqual(STAIR.landing - 1e-6);
        }
      }
    }
  });

  it('the step profile matches the pitch line at tread centres and ends at the landings', () => {
    const l = WITH_UNDERPASS[0];
    const r = l.grid.ramps[0];
    const d = (r.s1 - r.s0) / r.risers;
    for (let k = 1; k < r.risers; k++) expect(stepTop(r, r.s0 + d * k)).toBeCloseTo(rampHeight(r, r.s0 + d * k), 6);
    expect(stepTop(r, r.s0 - 0.2)).toBe(r.h0);
    expect(stepTop(r, r.s1 + 0.2)).toBeCloseTo(r.h1, 6);
  });

  it('a player walks down one leg, under the tracks and up the other leg without falling', () => {
    for (const l of WITH_UNDERPASS) {
      const props = new PropIndex(l.grid, l.props);
      const pf = new PathFinder(l.grid);
      for (const u of l.traversal.underpasses) {
        const [a, b] = u.legs.map(leg => l.traversal.stairs[leg.flights[0]]);
        const p = new Player();
        p.spawn(a.top.x, a.top.z, 0, l.grid.floorAt(a.top.x, a.top.z));
        // Down to the crossing passage, across, and up to the other platform's door landing.
        const bar = l.areas[u.bar];
        const mid: [number, number] = [(bar.x + bar.w / 2) * CELL, (bar.y + bar.h / 2) * CELL];
        const p1 = pf.find(p.x, p.z, mid[0], mid[1], 0.3, 60000)!;
        expect(p1, `${l.seed} path down`).not.toBeNull();
        let minY = 0, airborne = 0;
        expect(walk(p, l, props, p1, 1200, q => { minY = Math.min(minY, q.y); if (!q.grounded) airborne++; })).toBeGreaterThan(0);
        expect(p.y).toBeCloseTo(UNDERPASS_FLOOR, 2);
        expect(minY).toBeGreaterThan(UNDERPASS_FLOOR - 0.01);
        const p2 = pf.find(p.x, p.z, b.top.x, b.top.z, 0.3, 60000)!;
        expect(walk(p, l, props, p2, 1500, q => { if (!q.grounded) airborne++; })).toBeGreaterThan(0);
        expect(p.y).toBeCloseTo(0, 2);
        expect(airborne, `${l.seed}: stairs must be walked, not fallen down`).toBe(0);
        expect(l.grid.areaAt(p.x, p.z)).toBe(b.area);
      }
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
    for (const l of WITH_UNDERPASS) {
      const pf = new PathFinder(l.grid);
      const u = l.traversal.underpasses[0];
      const bar = l.areas[u.bar];
      const P = l.areas[l.platform];
      const path = pf.find((P.x + P.w / 2) * CELL, (P.y + P.h / 2) * CELL, (bar.x + bar.w / 2) * CELL, (bar.y + bar.h / 2) * CELL, 0.34, 60000);
      expect(path, `${l.seed} platform -> underpass`).not.toBeNull();
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
  it('statics: track bed, stair treads and the underpass floor; casings settle on a stair tread', () => {
    const l = WITH_UNDERPASS[0];
    const q = new StaticQuery(l);
    const f = l.traversal.stairs[0];
    const r = l.grid.ramps[f.ramp];
    const mid = (f.s0 + f.s1) / 2, across = (f.a0 + f.a1) / 2;
    const [x, z] = f.axis === 'x' ? [mid, across] : [across, mid];
    expect(q.cellGround(x, z)).toBeCloseTo(stepTop(r, f.axis === 'x' ? x : z), 6);
    const t = l.trench;
    expect(q.cellGround((t.platformX0 + t.platformX1) / 2 + 0.1, (t.z0 + t.z1) / 2 + 0.3)).toBeCloseTo(t.floorY, 6);
    const bar = l.areas[l.traversal.underpasses[0].bar];
    expect(q.cellGround((bar.x + bar.w / 2) * CELL, (bar.y + bar.h / 2) * CELL)).toBeCloseTo(UNDERPASS_FLOOR, 6);
    const cs = new CasingSystem();
    cs.setStatics(q);
    cs.rand = () => 0.5;
    cs.eject(new THREE.Vector3(x, stepTop(r, f.axis === 'x' ? x : z) + 1.2, z), new THREE.Vector3(0.3, 0.2, 0.1), 'rifle');
    for (let i = 0; i < 400; i++) cs.update(1 / 60);
    const c = cs.list()[0];
    expect(c.mode).toBe(2);
    const ground = q.cellGround(c.x, c.z);
    expect(c.y - ground).toBeGreaterThan(-0.002);
    expect(c.y - ground).toBeLessThan(0.02);
    expect(ground).toBeLessThan(0.01);
  });

  it('ragdoll statics: chunk boxes follow floor heights and stair treads (tread boxes at tread heights, track-bed slab at the bed floor)', () => {
    const l = WITH_UNDERPASS[0];
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
    const l = WITH_UNDERPASS[0];
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
    const sgn = Math.sign(f.s1 - f.s0);
    const o3 = f.axis === 'x' ? {x: f.top.x, y: f.top.y + 1.62, z: f.top.z} : {x: f.top.x, y: f.top.y + 1.62, z: f.top.z};
    const d3 = f.axis === 'x' ? new THREE.Vector3(sgn, -0.9, 0).normalize() : new THREE.Vector3(0, -0.9, sgn).normalize();
    const h3 = raycastWorld(g, l.props, o3, d3, 30, t.floorY);
    expect(h3.kind).toBe('floor');
    const hx = o3.x + d3.x * h3.t, hz = o3.z + d3.z * h3.t;
    // Linear within a cell (a landing kink may fall inside one): within a few cm of the pitch line.
    expect(Math.abs(o3.y + d3.y * h3.t - rampHeight(r, f.axis === 'x' ? hx : hz))).toBeLessThan(0.03);
  });

  it('loose loot, props and zombies sit on their local floor; nothing rests on stairs; deterministic per seed', () => {
    for (const l of [...PER_ARCH, ...WITH_UNDERPASS]) {
      const g = l.grid;
      for (const p of l.pickups) {
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.rampIdx[g.idx(cx, cy)]).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorAt(p.x, p.z) - 1e-6);
      }
      for (const p of l.props) {
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(g.rampIdx[g.idx(cx, cy)], `${p.kind} on stairs`).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorAt(p.x, p.z) - 1e-6);
      }
      for (const zs of l.zombies) expect(g.passable(...g.cellOf(zs.x, zs.z))).toBe(true);
      // Fixtures stay below their local ceilings (flights, landings, the underpass).
      for (const li of l.lights) expect(li.y).toBeLessThanOrEqual(g.ceilAt(li.x, li.z) + 1e-6);
    }
    const a = generateStation(WITH_UNDERPASS[0].seed), b = generateStation(WITH_UNDERPASS[0].seed);
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

