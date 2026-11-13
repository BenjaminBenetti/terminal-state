// Task studio-bb-production-20261112-234540-01: places a BB must never end up in, and stand-offs it must not fall into.
//
// The first group replays, on the exact generated layouts, the cases the delegated review of the first version found: a body left
// inside a wall after a leap at a player 0.26 m away, a drop through a desk it had landed on, a pass through the end of a long
// machine, and BBs that stopped attacking beside a drop or a thing in the way. The second group is a compact sweep over other
// seeds, moving players and frame times (60 / 30 / 144 Hz and a hitching frame).
//
// Every run is driven as the game drives an enemy (tests/helpers/bbSim.ts) and audited each step (bbClean).

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';
import {ROSTER_VERSION} from '../src/ai/enemyRoster';
import {BB_CLIMB} from '../src/ai/bb';
import {findMounts} from '../src/ai/bbSurface';
import {bbClean, bbMover, bbSim, bbStatic, standNear, type BbPlayerMove, type BbSimOpts} from './helpers/bbSim';

const LEVEL_IDS: LevelId[] = ['subway', 'office', 'mall', 'bunker', 'skyways', 'reactor'];
const layouts = new Map<string, StationLayout>();
/** A level as a new game generates it now (the current roster: its BBs are placed). */
function layoutOf(level: LevelId, seed: number): StationLayout {
  const k = `${level}:${seed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION})));
  return l;
}

/** A start on a spawn point of the layout, facing a player placed 7 m (else 4 m) away on the same floor. */
function sceneAt(layout: StationLayout, s: {x: number; z: number; y?: number; level?: number}): BbSimOpts | null {
  const {L} = bbStatic(layout), y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
  const p = standNear(layout, s.x, s.z, y, 7) ?? standNear(layout, s.x, s.z, y, 4);
  return p ? {at: {x: s.x, z: s.z, y, yaw: Math.atan2(p.x - s.x, p.z - s.z), level: s.level}, player: {x: p.x, z: p.z, y}} : null;
}
/** The scene of the roster's own BB at (x, z). */
function rosterScene(level: LevelId, seed: number, x: number, z: number): {layout: StationLayout; opts: BbSimOpts} {
  const layout = layoutOf(level, seed);
  const s = layout.zombies.find(q => q.archetype === 'bb' && Math.abs(q.x - x) < 0.01 && Math.abs(q.z - z) < 0.01);
  expect(s, `${level} seed ${seed}: the roster no longer places a BB at ${x}, ${z}`).toBeDefined();
  const opts = sceneAt(layout, s!);
  expect(opts, `${level} seed ${seed}: no place for the player`).not.toBeNull();
  return {layout, opts: opts!};
}

/** What the runs of this file exercised, summed (the last test asks that the rarer ways out were really taken). */
const seen = {runs: 0, sits: 0, hops: 0, mounts: 0};

interface Played {
  sim: ReturnType<typeof bbSim>;
  /** Longest unbroken time (s): in the air; at rest on a thing it cannot stay on. */
  airS: number; sitS: number;
  /**
   * Longest time (s) it had every reason to attack and began no wind-up: aware, the player in sight within 3.2 m on its own floor,
   * no cooldown, not recovering.
   */
  idleNearS: number;
}
/** Run a scene for `seconds` with a scripted player; `dtOf(k)`: the frame time of step k. */
function play(layout: StationLayout, opts: BbSimOpts, mode: BbPlayerMove, seconds: number, dtOf: (k: number) => number = () => 1 / 60): Played {
  const sim = bbSim(layout, opts), move = bbMover(sim, mode), b = sim.b, P = b.pose;
  const r: Played = {sim, airS: 0, sitS: 0, idleNearS: 0};
  let air = 0, sit = 0, idle = 0, wind = P.windupSeq;
  for (let k = 0, t = 0; t < seconds; k++) {
    const dt = dtOf(k);
    t += dt;
    move(dt);
    sim.step(dt);
    air = P.surface === 'air' ? air + dt : 0;
    sit = b.doing.mode === 'sit' ? sit + dt : 0;
    if (P.windupSeq !== wind) { wind = P.windupSeq; idle = 0; }
    const c = b.centre(), pl = sim.player;
    const could = b.alive && b.aware && b.seeing && b.cooldown <= 0 && Math.hypot(pl.x - c.x, pl.z - c.z) < 3.2 && Math.abs(pl.y - b.y) < 0.8 && P.phase !== 'land' && P.phase !== 'stagger';
    idle = could ? idle + dt : 0;
    r.airS = Math.max(r.airS, air); r.sitS = Math.max(r.sitS, sit); r.idleNearS = Math.max(r.idleNearS, idle);
  }
  seen.runs++; seen.sits += b.tally.sits; seen.hops += b.tally.hops; seen.mounts += b.tally.mounts;
  return r;
}
/** Never long in the air, never long at rest on a thing, never long beside the player without attacking. */
function lively(r: Played, where: string): void {
  expect(r.airS, `${where}: in the air too long`).toBeLessThan(4);
  expect(r.sitS, `${where}: stayed on a thing it cannot stay on`).toBeLessThan(6);
  expect(r.idleNearS, `${where}: beside the player with every reason to attack, and did not`).toBeLessThan(8);
}

describe('BB: the cases the review found, on their exact layouts', () => {
  it('subway: leaping at a player 0.26 m away against a wall, it never ends up outside free space', () => {
    const layout = layoutOf('subway', 5);
    const at = {x: 195.25, z: 29.75, y: 0, yaw: 0.6190867604313852}, px = 195.1191949656312, pz = 29.973560558009144;
    // the exact case, then the player standing a little to each side of it
    const spots: [number, number, number][] = [[px, pz, 40]];
    for (const dx of [-0.15, 0, 0.15]) for (const dz of [-0.15, 0, 0.15]) if (dx || dz) spots.push([px + dx, pz + dz, 30]);
    let leaps = 0;
    for (const [x, z, secs] of spots) {
      const r = play(layout, {at, player: {x, z, y: 0}, seed: 7}, 'still', secs);
      // (the player stands inside its body's reach at the start: the body separation moves it)
      bbClean(r.sim.audit, r.sim.b, `player at ${x.toFixed(2)}, ${z.toFixed(2)}`, true);
      lively(r, `player at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      leaps += r.sim.audit.leaps;
    }
    expect(leaps).toBeGreaterThanOrEqual(spots.length * 3);
  }, 60000);

  it('office: coming down on a desk it rests on the desk and hops off — it never drops through it', () => {
    const {layout, opts} = rosterScene('office', 15, 23.25, 26.75);
    const r = play(layout, opts, 'strafe-sprint', 60);
    bbClean(r.sim.audit, r.sim.b, 'office desk');
    lively(r, 'office desk');
    // (it leaves the desk by a leap at the player or by a hop to the floor: `lively` bounds how long it may stay)
    expect(r.sim.b.tally.sits, 'this scene no longer lands it on a prop').toBeGreaterThanOrEqual(1);
    expect(r.sim.audit.leaps).toBeGreaterThanOrEqual(4);
  }, 60000);

  it('bunker: the end of a long machine is as solid as its middle', () => {
    const {layout, opts} = rosterScene('bunker', 7, 40.25, 64.75);
    const r = play(layout, opts, 'strafe-walk', 60);
    bbClean(r.sim.audit, r.sim.b, 'bunker machine');
    lively(r, 'bunker machine');
    expect(r.sim.audit.leaps).toBeGreaterThanOrEqual(4);
  }, 60000);

  it('office, mall: come down at the player\'s feet, it is eased out of them — never shoved through the wall beside them', () => {
    // (the game's body separation moved it the whole overlap in one frame: 0.6 m, through a door jamb on the office roof and into
    // a shop-front corner in the mall)
    for (const [level, seed, x, z, mode] of [['office', 15, 29.25, 5.75, 'circle-walk'], ['mall', 15, 63.75, 22.25, 'juke']] as [LevelId, number, number, number, BbPlayerMove][]) {
      const {layout, opts} = rosterScene(level, seed, x, z), where = `${level} seed ${seed} ${mode}`;
      const r = play(layout, opts, mode, 60);
      bbClean(r.sim.audit, r.sim.b, where);
      lively(r, where);
      expect(r.sim.audit.leaps, `${where}: leaps`).toBeGreaterThanOrEqual(4);
    }
  }, 60000);

  it('reactor, subway, office: beside a drop or a thing in the way it finds another line and keeps attacking', () => {
    const cases: [LevelId, number, number, number, BbPlayerMove][] = [
      ['reactor', 21, 53.75, 35.75, 'still'], ['reactor', 21, 53.75, 35.75, 'strafe-sprint'],
      ['subway', 43, 82.75, 116.25, 'juke'], ['office', 23, 29.25, 25.75, 'juke'],
    ];
    for (const [level, seed, x, z, mode] of cases) {
      const {layout, opts} = rosterScene(level, seed, x, z), where = `${level} seed ${seed} ${mode}`;
      const r = play(layout, opts, mode, 45);
      bbClean(r.sim.audit, r.sim.b, where);
      lively(r, where);
      expect(r.sim.audit.leaps, `${where}: leaps`).toBeGreaterThanOrEqual(3);
    }
  }, 60000);
});

describe('BB: a sweep over seeds, moving players and frame times', () => {
  const MODES: BbPlayerMove[] = ['strafe-walk', 'strafe-sprint', 'back-walk', 'circle-walk', 'juke', 'still'];
  /** Frame times: steady 60 / 30 / 144 Hz, and 60 Hz with a 50 ms frame every 70th. */
  const FRAMES: [string, (k: number) => number][] = [
    ['60 Hz', () => 1 / 60], ['30 Hz', () => 1 / 30], ['144 Hz', () => 1 / 144], ['hitching', k => (k % 70 === 69 ? 0.05 : 1 / 60)],
  ];
  /** Up to `n` starts 8 m apart: the roster's BBs first, then ordinary spawn points with a wall to climb in reach. */
  function starts(layout: StationLayout, n: number): BbSimOpts[] {
    const {L, cw} = bbStatic(layout), out: BbSimOpts[] = [];
    const add = (s: StationLayout['zombies'][number]): void => {
      if (out.length >= n || out.some(o => Math.hypot(o.at.x - s.x, o.at.z - s.z) < 8)) return;
      const o = sceneAt(layout, s);
      if (o) out.push(o);
    };
    for (const s of layout.zombies) if (s.archetype === 'bb') add(s);
    for (const s of layout.zombies) {
      if (out.length >= n) break;
      const y = s.y ?? L.grid(s.level ?? 0).floorAt(s.x, s.z);
      if (findMounts(cw, s.x, y, s.z, BB_CLIMB.mountReachM).length) add(s);
    }
    return out;
  }

  for (const level of LEVEL_IDS) {
    it(`${level}: every run stays in free space, on valid geometry, with one bounded attack`, () => {
      let runs = 0, leaps = 0, k = LEVEL_IDS.indexOf(level);
      for (const seed of [3, 11]) {
        const layout = layoutOf(level, seed);
        for (const opts of starts(layout, 2)) {
          // two of the 24 (movement, frame time) pairs per start, rotating so that every level sees different ones
          for (let j = 0; j < 2; j++, k++) {
            const mode = MODES[k % MODES.length], [hz, dtOf] = FRAMES[(k * 3 + j) % FRAMES.length];
            const where = `${level} seed ${seed} bb@${opts.at.x},${opts.at.z} ${mode} ${hz}`;
            const r = play(layout, opts, mode, 30, dtOf);
            bbClean(r.sim.audit, r.sim.b, where);
            lively(r, where);
            runs++;
            leaps += r.sim.audit.leaps;
          }
        }
      }
      expect(runs).toBeGreaterThanOrEqual(6);
      expect(leaps).toBeGreaterThanOrEqual(runs * 2);
    }, 120000);
  }
});

describe('BB: what the runs above exercised', () => {
  it('it came to rest on things, hopped off them, and climbed (65 runs: 6 rests, 5 hops, 245 climbs when this was written)', () => {
    if (seen.runs < 60) return; // (a filtered run of this file: nothing to sum)
    expect(seen.sits).toBeGreaterThanOrEqual(2);
    expect(seen.hops).toBeGreaterThanOrEqual(1);
    expect(seen.mounts).toBeGreaterThanOrEqual(seen.runs);
  });
});
