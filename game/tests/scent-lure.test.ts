// Task studio-refinement-batch-20261113-035659-01 (lane LURE): the ZOMBIE LURE GRENADE's scent (ai/scentLure.ts + the brain's
// 'investigate' state with LureState.kind 'scent'). User: "Scent reaches 20 metres without line-of-sight requirements for 20 active
// seconds. Zombies investigate the ACTUAL emitter, not the player. Retain valid navigation/collision: no wall-phasing."
// Hand-made fixtures driven exactly like game.ts updateZombies (brain -> body turn -> height-aware motor) with the game's BrainWorld
// (3D sight on Levels, the level-aware PathFinder, lightLure.ts lureWorld) + `scents` = a ScentLures registry's active list:
//  - an enemy 15 m away behind a wall (no sight line) walks round the wall to the canister; every frame's step is a valid walk
//    (height-aware, body circle clear, never across the wall); 25 m away it ignores it; it reaches across storeys (3D distance);
//  - active seconds count only while ticked (a paused game never ticks), the scent ends after 20 ticked s, enemies then linger
//    and return to their ordinary behaviour;
//  - seeing the player always wins; a pursuer that lost sight of the player is pulled (a fresh gunshot / hit is hunted first);
//  - the goal is the canister (the player stands elsewhere; the last known player position / awareness never move toward the
//    player); move() retargets, remove() / clear() end it; the cap; bounded staggered checks; the path service's deferral;
//  - families: rat/dog (no ladder links), awake Siren, Strainer, the BB drawn; a dormant Siren never woken / drawn; the Screacher never.

import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CELL, FLOOR, Grid, PathFinder} from '../src/gen/grid';
import {BODY_CLEAR, levelsOf, singleLevel, type Levels} from '../src/gen/levels';
import {resolveCircle} from '../src/core/physics';
import {ZombieBrain, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {CreatureBrain} from '../src/ai/creatureActor';
import {SIREN_STATS, SirenBrain} from '../src/ai/siren';
import {StrainerBrain} from '../src/ai/strainer';
import {BlightbellyBrain} from '../src/ai/blightbelly';
import {ScreacherBrain} from '../src/ai/screacher';
import {BbBrain} from '../src/ai/bb';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {LURE, lureWorld} from '../src/ai/lightLure';
import {SCENT, SCENT_MAX, ScentLures, perceiveScent, type ScentEmitter} from '../src/ai/scentLure';
import {LightSources} from '../src/world/lightSources';
import {FIX, levelFixture} from './helpers/levelFixture';

const DT = 1 / 30;

// --- fixture: the light-lure hall — 60 x 20 m (floor 0, ceiling 4), a wall at x = 30..30.5 from z = 0.5 to 14, open strip z 14..19.5
const WALL = {x0: 30, x1: 30.5, z0: 0.5, z1: 14} as const;
function hall(): Levels {
  const g = new Grid(120, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 119; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0; }
  for (let y = 1; y <= 27; y++) { const i = g.idx(60, y); g.cells[i] = 0; g.ceil[i] = 0; g.area[i] = -1; }
  return singleLevel(g);
}
const HL = hall();
const HPF = new PathFinder(HL);
const FL = levelsOf(levelFixture());
const FPF = new PathFinder(FL);

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Pl { x: number; y: number; z: number; alive: boolean }
interface Sim {
  L: Levels; pf: PathFinder; scents: ScentLures; lights: LightSources; player: Pl; rand: () => number; wander: boolean;
  /** findPath requests this run (defer offered? ladder links off?). */
  paths: {defer: boolean; noLinks?: boolean}[];
  /** Optional: answer a deferrable request "queued" (undefined) this many times per owner before searching. */
  deferAsks?: number;
  asked?: Map<object, number>;
}
// the player stands far west in the hall's west room by default: unseen (> 18 m / behind the enemy)
const sim = (L: Levels, pf: PathFinder, player: Partial<Pl> = {}): Sim =>
  ({L, pf, scents: new ScentLures(), lights: new LightSources(), player: {x: 2, y: 0, z: 2, alive: true, ...player}, rand: mulberry(11), wander: true, paths: []});
/** The game's BrainWorld (game.ts brainWorld, stacked-levels branch) + the lure fields + this sim's scents. */
function worldOf(s: Sim): BrainWorld {
  const {L, pf, player: p} = s;
  return {
    px: p.x, pz: p.z, py: p.y, playerAlive: p.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, o) => {
      s.paths.push({defer: !!o?.defer, noLinks: o?.noLinks});
      if (o?.defer && s.deferAsks) {
        const m = (s.asked ??= new Map()), n = m.get(o.defer) ?? 0;
        if (n < s.deferAsks) { m.set(o.defer, n + 1); return undefined; }
        m.delete(o.defer);
      }
      return pf.find(ax, az, bx, bz, 0.34, 26000, o);
    },
    randomNear: (x, z, _r, y) => {
      if (!s.wander) return null;
      for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
        const sup = L.supportIn(x + ox, z + oz, (y ?? 0) + 0.05);
        if (sup && L.grid(sup.level).passable(Math.floor((x + ox) / CELL), Math.floor((z + oz) / CELL))) return [x + ox, z + oz, sup.floor];
      }
      return null;
    },
    rand: s.rand,
    ...lureWorld(L, s.lights),
    scents: s.scents.list,
  };
}
/** One frame of game.ts updateZombies for one enemy (brain, body turn, motor). */
function frame(s: Sim, b: ZombieBrain): BrainOutput {
  const out = b.update(DT, worldOf(s));
  if (out.face !== null) {
    let d = out.face - b.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * DT;
    b.yaw += Math.max(-turn, Math.min(turn, d));
  }
  moveZombie(b, out, DT, s.L, null);
  settleZombie(b, s.L, null);
  return out;
}
interface Trace { states: Set<string>; frames: number; maxCmd: number; bad: string[]; minPlayerGap: number }
/**
 * Runs `seconds` of play (one game update per frame: the enemies, then Game.update's scents.tick). Every frame's step is checked:
 * a walking step (no jump), feet on a floor band of a passable cell, the body clear of everything the motor treats as solid (walls,
 * slab edges, ledges up), and in the hall the body never overlaps the wall and only changes side round its open end.
 */
function run(s: Sim, bs: ZombieBrain | ZombieBrain[], seconds: number, until?: (b: ZombieBrain) => boolean, tick = true): Trace {
  const list = Array.isArray(bs) ? bs : [bs];
  const tr: Trace = {states: new Set(), frames: 0, maxCmd: 0, bad: [], minPlayerGap: Infinity};
  for (let f = 0; f < seconds / DT; f++) {
    for (const b of list) {
      const p0 = {x: b.x, y: b.y, z: b.z}, climbing0 = b.climbing;
      const out = frame(s, b);
      tr.states.add(b.state);
      tr.maxCmd = Math.max(tr.maxCmd, out.speed);
      tr.minPlayerGap = Math.min(tr.minPlayerGap, Math.hypot(b.x - s.player.x, b.z - s.player.z));
      if (!climbing0 && !b.climbing && b.alive) {
        const r = b.stats.radius, at = `(${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})`;
        // a step of a walk, never a jump through anything (a wall cell is 0.5 m; the scent walk moves < 0.04 m a frame, the motor's
        // push-out after landing off a ledge less than a body radius)
        if (Math.hypot(b.x - p0.x, b.z - p0.z) > b.stats.chaseSpeed * DT + r) tr.bad.push(`jump to ${at}`);
        // standing on a real floor band of a passable cell of its storey ...
        const sup = s.L.supportIn(b.x, b.z, b.y + 0.05);
        if (!sup || !s.L.grid(sup.level).passable(Math.floor(b.x / CELL), Math.floor(b.z / CELL))) tr.bad.push(`off the floor at ${at}`);
        // ... and clear of everything the motor treats as solid for a body at its feet (walls, slab edges, ledges up; a drop off a
        // ledge is allowed, as the walk searches allow it): the body circle (0.9 r) needs no push out
        const [qx, qz] = resolveCircle(s.L, null, b.x, b.z, r * 0.9, b.y, b.stats.height ?? BODY_CLEAR);
        if (Math.hypot(qx - b.x, qz - b.z) > 1e-6) tr.bad.push(`body inside geometry at ${at}`);
        if (s.L === HL) {
          const cx = Math.max(WALL.x0, Math.min(b.x, WALL.x1)), cz = Math.max(WALL.z0, Math.min(b.z, WALL.z1));
          if (Math.hypot(b.x - cx, b.z - cz) < r - 0.01) tr.bad.push(`body in the wall at (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
          const mid = (WALL.x0 + WALL.x1) / 2;
          if (Math.sign(p0.x - mid) !== Math.sign(b.x - mid) && Math.min(p0.z, b.z) < WALL.z1 + r - 0.01) tr.bad.push(`crossed the wall at z ${b.z.toFixed(2)}`);
        }
      }
    }
    if (tick) s.scents.tick(DT);
    tr.frames++;
    if (list.length === 1 && until?.(list[0])) break;
  }
  return tr;
}
const lastKnown = (b: ZombieBrain) => (b as unknown as {lastKnown: [number, number, number?] | null}).lastKnown;
const canister = (s: Sim, x: number, y: number, z: number, opts?: {radius?: number; seconds?: number}): ScentEmitter => s.scents.add({x, y, z}, opts);
const holding = (e: ScentEmitter) => (q: ZombieBrain) => q.lure?.kind === 'scent' && q.lure.phase === 'hold' && Math.hypot(q.x - e.x, q.z - e.z) < q.lure.stop + 0.05;

describe('scent lure: the emitter registry', () => {
  it('add / move / remove / tick / clear; ACTIVE seconds only; the cap of 3 (a 4th retires the one with the least time left)', () => {
    const S = new ScentLures();
    expect(SCENT.radius).toBe(20);
    expect(SCENT.seconds).toBe(20);
    expect(SCENT_MAX).toBe(3);
    const a = S.add({x: 1, y: 0.05, z: 2, level: 0});
    expect(a).toMatchObject({x: 1, y: 0.05, z: 2, level: 0, left: 20, active: true, radius: 20, seconds: 20});
    expect(S.list).toEqual([a]);
    S.tick(5);
    expect(a.left).toBe(15);
    S.tick(0); S.tick(-3); S.tick(NaN); // a paused / bogus frame counts nothing
    expect(a.left).toBe(15);
    S.move(a, {x: 4, y: 1.2, z: 6});
    expect([a.x, a.y, a.z, a.level]).toEqual([4, 1.2, 6, 0]);
    const b = S.add({x: 0, y: 0, z: 0}, {seconds: 8, radius: 12});
    const c = S.add({x: 0, y: 0, z: 0});
    expect(S.full).toBe(true);
    const d = S.add({x: 9, y: 0, z: 9}); // past the cap: b (8 s left) is retired
    expect(S.list).toEqual([a, c, d]);
    expect(b.active).toBe(false);
    expect(S.counts.retired).toBe(1);
    S.remove(c);
    expect(c.active).toBe(false);
    expect(S.list).toEqual([a, d]);
    S.remove(c); // twice: nothing
    expect(S.counts.removed).toBe(1);
    S.tick(15); // a runs out (15 s left), d has 5 s left
    expect(a.active).toBe(false);
    expect(a.left).toBe(0);
    expect(S.list).toEqual([d]);
    expect(d.left).toBe(5);
    S.clear(); // station teardown / Retry
    expect(S.list).toEqual([]);
    expect(d.active).toBe(false);
    expect(S.qa()).toMatchObject({cap: 3, count: 0, full: false, emitters: [], counts: {added: 4, expired: 1, removed: 1, retired: 1, cleared: 1}});
  });

  it('perception: 3D feet-to-canister distance within the radius, nothing else (no sight, no view); sticky; given-up ones skipped', () => {
    const S = new ScentLures();
    const near = S.add({x: 10, y: 0, z: 0}), far = S.add({x: 0, y: 0, z: 21});
    const o = {x: 0, y: 0, z: 0};
    expect(perceiveScent(o, S.list)?.emitter).toBe(near);
    expect(perceiveScent(o, S.list, null, [near.id])).toBeNull(); // far is 21 m away
    expect(perceiveScent({x: 0, y: 0, z: 2}, S.list, far.id)?.emitter).toBe(near); // 10.2 vs 19 x 0.8: still the nearer
    expect(perceiveScent({x: 0, y: 0, z: 9}, S.list, far.id)?.emitter).toBe(far); // 13.5 vs 12 x 0.8 = 9.6: the followed one
    // 3D: a storey above, 16 m along and 12 m up = 20 m (in reach); 13 m up = 20.6 m (out)
    const up = new ScentLures(); up.add({x: 16, y: 12, z: 0});
    expect(perceiveScent(o, up.list)?.dist).toBeCloseTo(20, 6);
    up.move(up.list[0], {x: 16, y: 13, z: 0});
    expect(perceiveScent(o, up.list)).toBeNull();
  });
});

describe('scent lure: the walk to the canister', () => {
  it('an enemy 15 m away BEHIND A WALL (no sight line) walks round the wall to the canister; every step is a valid walk, never through the wall', () => {
    const s = sim(HL, HPF); // player far west (2, 2): unseen
    const b = new ZombieBrain('shambler', 22.5, 5, -Math.PI / 2); // facing AWAY from the canister
    const e = canister(s, 37.5, 0.05, 5, {seconds: 60});
    expect(HL.lineOfSight({x: b.x, y: 1.5, z: b.z}, {x: e.x, y: e.y + 0.25, z: e.z})).toBe(false); // no sight line at all
    expect(Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z)).toBeCloseTo(15, 2);
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure).toMatchObject({kind: 'scent', lightId: e.id, x: e.x, z: e.z, phase: 'approach'});
    expect(b.aware).toBe(false);
    const tr = run(s, b, 50, holding(e));
    console.info(`[scent] behind-wall walk: ${(tr.frames * DT).toFixed(1)} s, cmd <= ${tr.maxCmd.toFixed(2)} m/s, stop ${Math.hypot(b.x - e.x, b.z - e.z).toFixed(2)} m`);
    expect(tr.bad).toEqual([]);
    expect([...tr.states]).toEqual(['investigate']);
    expect(holding(e)(b)).toBe(true);
    expect(b.x).toBeGreaterThan(WALL.x1); // it is on the canister's side of the wall now
    expect(Math.hypot(b.x - e.x, b.z - e.z)).toBeGreaterThan(1.2); // gathers around it, not on it
    expect(tr.maxCmd).toBeLessThanOrEqual(b.stats.wanderSpeed * SCENT.speedMult + 1e-9); // a walk (search pace), not a charge
    expect(tr.maxCmd).toBeLessThan(b.stats.chaseSpeed * 0.5);
    expect(b.aware).toBe(false); // a scent is not the player
    expect(lastKnown(b)).toBeNull();
    expect(s.paths.length).toBeGreaterThan(0);
    expect(s.paths.every(p => p.defer)).toBe(true); // every scent walk search is offered to the path service's deferral
    // it holds there while the scent lasts
    const hold = run(s, b, 6);
    expect([...hold.states]).toEqual(['investigate']);
    expect(b.lure?.phase).toBe('hold');
  });

  it('25 m (or 21 m) away it ignores the canister; 19 m away it is drawn', () => {
    const s = sim(HL, HPF, {x: 58, z: 18});
    s.wander = false;
    const e = canister(s, 37.5, 0, 5, {seconds: 60});
    const far = new ZombieBrain('shambler', 12.5, 5, Math.PI / 2), edge = new ZombieBrain('shambler', 16.5, 5, Math.PI / 2);
    const inside = new ZombieBrain('shambler', 18.5, 5, Math.PI / 2);
    run(s, [far, edge, inside], 3);
    expect(far.state).not.toBe('investigate');
    expect(edge.state).not.toBe('investigate');
    expect(far.scentChecks).toBeGreaterThan(4); // it did check
    expect(inside.state).toBe('investigate');
    expect(inside.lure?.lightId).toBe(e.id);
  });

  it('reaches across storeys (3D): an enemy on the deck above smells a canister on the platform UNDER the deck slab and takes the stairs down to it', () => {
    const hidden = {x: 6.5, y: FIX.lowerY, z: 3}; // the player down in the lower crossing, under platform A: never in its sight
    const s = sim(FL, FPF, hidden);
    s.wander = false;
    const b = new ZombieBrain('shambler', 23, 16, Math.PI); b.y = FIX.upperY; // on the deck, over platform B
    const e = canister(s, 23, 0.05, 5.5, {seconds: 120}); // on platform A under the deck (main ceiling 4.4 there)
    expect(FL.levelAt(b.x, b.z, b.y + 0.05)).toBe(1);
    expect(FL.levelAt(e.x, e.z, e.y + 0.05)).toBe(0);
    expect(FL.lineOfSight({x: b.x, y: b.y + 1.5, z: b.z}, {x: e.x, y: e.y + 0.25, z: e.z})).toBe(false); // the slab hides it
    expect(Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z)).toBeLessThan(SCENT.radius);
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure!.gy).toBeCloseTo(0, 2); // the goal is on the platform, not on the deck above it
    const tr = run(s, b, 100, holding(e));
    expect(tr.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true);
    expect(b.y).toBeCloseTo(0, 1); // down on the canister's storey
    expect(tr.states.has('chase')).toBe(false);
    // a deck enemy whose 3D distance exceeds the radius is not drawn
    const s2 = sim(FL, FPF, hidden);
    s2.wander = false;
    const c = new ZombieBrain('shambler', 24, 21.5, Math.PI); c.y = FIX.upperY;
    canister(s2, 4, 0.05, 3, {seconds: 60});
    expect(Math.hypot(4 - c.x, 0.05 - c.y, 3 - c.z)).toBeGreaterThan(SCENT.radius);
    expect(run(s2, c, 3).states.has('investigate')).toBe(false);
  });
});

describe('scent lure: 20 ACTIVE seconds', () => {
  it('only ticked (playing) seconds count; the scent ends after 20 of them; the enemy lingers, then returns to its ordinary behaviour', async () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('shambler', 34, 5, 0);
    const e = canister(s, 37.5, 0.05, 5); // the default 20 s
    run(s, b, 10); // playing: the brain and Game.update's scents.tick
    expect(b.state).toBe('investigate');
    expect(e.left).toBeCloseTo(10, 6);
    // paused / in a menu / loading: Game.update does not run (no brain frame, no tick) — real time passing counts nothing
    const before = {x: b.x, z: b.z, state: b.state, t: b.t};
    await new Promise(r => setTimeout(r, 60));
    expect(e.left).toBeCloseTo(10, 6);
    expect(e.active).toBe(true);
    expect({x: b.x, z: b.z, state: b.state, t: b.t}).toEqual(before);
    // 9.9 more playing seconds: still on (19.9 ticked)
    run(s, b, 9.9 - 1e-6);
    expect(e.active).toBe(true);
    expect(s.scents.list).toEqual([e]);
    expect(b.lure?.phase).toBe('hold');
    run(s, b, 0.1 + 2 * DT);
    expect(e.active).toBe(false);
    expect(s.scents.list).toEqual([]);
    // the scent is gone: it lingers by the canister, then idles / wanders again
    const tr = run(s, b, SCENT.lostGrace + LURE.period * 1.2 + LURE.linger + LURE.lingerJitter + 0.5, q => q.state !== 'investigate');
    expect(tr.states.has('chase')).toBe(false);
    expect(b.state === 'idle' || b.state === 'wander').toBe(true);
    expect(b.lure).toBeNull();
    const after = run(s, b, 8);
    expect(after.states.has('investigate')).toBe(false); // no phantom lure
    expect(after.states.has('wander')).toBe(true);
  });

  it('remove() ends it like running out (linger, then normal)', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('coated', 34, 5, 0);
    const e = canister(s, 37.5, 0.05, 5);
    run(s, b, 10, holding(e));
    expect(holding(e)(b)).toBe(true);
    s.scents.remove(e);
    run(s, b, SCENT.lostGrace + LURE.period * 1.2 + LURE.linger + LURE.lingerJitter + 0.5, q => q.state !== 'investigate');
    expect(b.state === 'idle' || b.state === 'wander').toBe(true);
  });
});

describe('scent lure: the player, the goal and priorities', () => {
  it('an enemy that SEES the player keeps chasing it (scent in reach); once it has lost sight it is pulled to the canister, not to the player', () => {
    const s = sim(HL, HPF, {x: 16, y: 0, z: 5}); // 6 m ahead, in view
    s.wander = false;
    const b = new ZombieBrain('shambler', 10, 5, Math.PI / 2);
    const e = canister(s, 5, 0.05, 5, {seconds: 120}); // 5 m behind it
    const tr = run(s, b, 3);
    expect(tr.states.has('investigate')).toBe(false);
    expect(tr.states.has('chase')).toBe(true);
    expect(b.lure).toBeNull();
    const seen = lastKnown(b)!;
    expect(seen[0]).toBeCloseTo(16, 6);
    // the player slips away behind the wall, unseen (east room, out of sight range)
    s.player = {x: 55, y: 0, z: 5, alive: true};
    const t0 = b.t;
    run(s, b, SCENT.lostSightS + LURE.period * 1.2 + 0.2, q => q.state === 'investigate');
    expect(b.state).toBe('investigate');
    expect(b.t - t0).toBeGreaterThanOrEqual(SCENT.lostSightS - DT);
    expect(b.lure).toMatchObject({kind: 'scent', lightId: e.id});
    // its idea of the player when the scent took over: the last point it SAW the player (or none: its own chase gave that up)
    const lk = lastKnown(b);
    expect(lk === null || (lk[0] === seen[0] && lk[1] === seen[1])).toBe(true);
    const walk = run(s, b, 40, holding(e));
    expect(walk.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true); // at the canister, 50 m from the player
    expect(Math.hypot(b.x - s.player.x, b.z - s.player.z)).toBeGreaterThan(45);
    // the scent never moved its idea of the player toward the player, and it is still aware (it looks all round)
    expect(lastKnown(b)).toEqual(lk);
    expect(b.aware).toBe(true);
    // the player steps into its view again: the player wins at once
    s.player = {x: 12, y: 0, z: 5, alive: true};
    b.yaw = Math.atan2(12 - b.x, 5 - b.z);
    frame(s, b);
    expect(b.state).toBe('chase');
    expect(b.lure).toBeNull();
  });

  it('the goal is the emitter: an unaware enemy goes to the canister while the player stands elsewhere unseen (it never nears the player)', () => {
    const s = sim(HL, HPF, {x: 20, y: 0, z: 18}); // across the hall, behind the enemy, never in its view
    s.wander = false;
    const b = new ZombieBrain('shambler', 20, 4, Math.PI); // facing -z (away from the player)
    const e = canister(s, 10, 0.05, 2, {seconds: 60});
    const gap0 = Math.hypot(b.x - s.player.x, b.z - s.player.z);
    const tr = run(s, b, 30, holding(e));
    expect(tr.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true);
    expect(tr.states.has('chase')).toBe(false);
    expect(tr.minPlayerGap).toBeGreaterThanOrEqual(gap0 - 0.05); // never one step toward the player
    expect(b.aware).toBe(false);
    expect(lastKnown(b)).toBeNull();
  });

  it('a fresh gunshot / hit is hunted first: the scent pulls only SCENT.alertHoldS after it', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const b = new ZombieBrain('shambler', 34, 8, 0);
    canister(s, 37.5, 0.05, 5, {seconds: 60});
    b.hear(45, 12, 80, 0); // a shot in the east room
    expect(b.state).toBe('chase');
    const t0 = b.t;
    const tr = run(s, b, SCENT.alertHoldS + 2, q => q.state === 'investigate');
    expect(b.state).toBe('investigate');
    expect(b.t - t0).toBeGreaterThanOrEqual(SCENT.alertHoldS - DT);
    expect(tr.states.has('chase')).toBe(true);
    // a hit while it investigates: the normal chase (as with a light), and the hold again
    b.damage(10, 2, 2, 0);
    expect(b.state).toBe('chase');
    const t1 = b.t;
    run(s, b, SCENT.alertHoldS + 2, q => q.state === 'investigate');
    expect(b.state).toBe('investigate');
    expect(b.t - t1).toBeGreaterThanOrEqual(SCENT.alertHoldS - DT);
  });

  it('an active scent beats a flare in view; light-lure path requests stay immediate (no deferral offered)', () => {
    const s = sim(HL, HPF, {x: 58, z: 18}); // player in the east room: never in its view
    s.wander = false;
    const b = new ZombieBrain('shambler', 20, 5, Math.PI / 2);
    s.lights.add({kind: 'flare', active: true, x: 26, y: 0.02, z: 5, dir: null, cosHalfAngle: 1, spot: {x: 26, y: 0.02, z: 5}, attractRange: 28, intensity: 1});
    run(s, b, 1);
    expect(b.lure?.kind).toBe('flare');
    expect(s.paths.length).toBeGreaterThan(0);
    expect(s.paths.some(p => p.defer)).toBe(false);
    const e = canister(s, 12, 0.05, 9, {seconds: 30});
    run(s, b, LURE.period * 1.3);
    expect(b.lure).toMatchObject({kind: 'scent', lightId: e.id});
    run(s, b, 30, holding(e));
    expect(holding(e)(b)).toBe(true);
  });
});

describe('scent lure: retarget, teardown, cost, deferral', () => {
  it('move() retargets: the canister rolls / rides away and the enemy follows it to where it is now', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const b = new ZombieBrain('shambler', 34, 5, 0);
    const e = canister(s, 37.5, 0.05, 5, {seconds: 90});
    run(s, b, 15, holding(e));
    expect(holding(e)(b)).toBe(true);
    const starts = b.scentStarts;
    s.scents.move(e, {x: 50, y: 0.05, z: 12});
    const tr = run(s, b, 30, holding(e));
    expect(tr.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true);
    expect(b.lure).toMatchObject({x: 50, z: 12});
    expect(b.scentStarts).toBe(starts); // the same investigation, retargeted
  });

  it('clear() (station teardown / Retry) ends every scent: nothing draws an enemy afterwards', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    canister(s, 37.5, 0.05, 5); canister(s, 40, 0.05, 8);
    s.scents.clear();
    expect(s.scents.list).toEqual([]);
    const b = new ZombieBrain('shambler', 34, 5, 0);
    const tr = run(s, b, 3);
    expect(tr.states.has('investigate')).toBe(false);
    expect(b.scentChecks).toBe(0); // an empty list costs nothing
  });

  it('checks at the light-lure rate (~2.5 / s per enemy, staggered); no scents = no checks; each check is O(emitters), no rays', () => {
    const s = sim(HL, HPF, {x: 58, z: 18});
    s.wander = false;
    canister(s, 50, 0.05, 2, {seconds: 60, radius: 1}); // in the list, never in reach
    const a = new ZombieBrain('shambler', 10, 30 * CELL, Math.PI / 2), c = new ZombieBrain('shambler', 12.5, 32 * CELL, Math.PI / 2);
    run(s, [a, c], 10);
    for (const q of [a, c]) {
      expect(q.scentChecks).toBeGreaterThanOrEqual(10 / (LURE.period * 1.2) - 1);
      expect(q.scentChecks).toBeLessThanOrEqual(10 / (LURE.period * 0.8) + 1);
      expect(q.lureChecks).toBe(0); // no lights: no light checks (and no rays)
    }
    const n = sim(HL, HPF);
    const z = new ZombieBrain('shambler', 10, 5, Math.PI / 2);
    run(n, z, 5);
    expect(z.scentChecks).toBe(0);
  });

  it('a far scent walk queued by the path service (undefined): it stands facing the canister, asks again each frame, then walks', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    s.deferAsks = 12;
    const b = new ZombieBrain('shambler', 22.5, 5, -Math.PI / 2);
    const e = canister(s, 37.5, 0.05, 5, {seconds: 90});
    run(s, b, 0.6, q => q.state === 'investigate');
    const x0 = b.x, z0 = b.z, n0 = s.paths.length;
    const wait = run(s, b, 10 * DT);
    expect(b.state).toBe('investigate');
    expect(Math.hypot(b.x - x0, b.z - z0)).toBeLessThan(0.02); // stood still while queued
    expect(s.paths.length - n0).toBe(10); // re-asked every frame
    expect(wait.maxCmd).toBe(0);
    const tr = run(s, b, 50, holding(e));
    expect(tr.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true);
  });

  it('an unreachable canister: it gives up after LURE.stuckGiveUp failed searches, ignores that canister and returns to normal', () => {
    // a sealed east room: the wall runs the whole hall (no open end)
    const g = new Grid(120, 40);
    for (let y = 1; y < 39; y++) for (let x = 1; x < 119; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0; }
    for (let y = 1; y < 39; y++) { const i = g.idx(60, y); g.cells[i] = 0; g.ceil[i] = 0; g.area[i] = -1; }
    const L = singleLevel(g), pf = new PathFinder(L);
    const s = sim(L, pf);
    s.wander = false;
    const b = new ZombieBrain('shambler', 25, 5, 0);
    const e = canister(s, 35, 0.05, 5, {seconds: 120});
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    const tr = run(s, b, 30, q => q.state !== 'investigate');
    expect(tr.bad).toEqual([]);
    expect(b.state).toBe('idle');
    expect(b.x).toBeLessThan(30); // never through the wall
    expect(e.active).toBe(true); // still smelling: it simply gave up on that one
    expect(run(s, b, 6).states.has('investigate')).toBe(false);
  });
});

describe('scent lure: families', () => {
  it('the rat/dog is drawn (no ladder links); the Strainer, the Blightbelly and an AWAKE Siren are drawn', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const r = new CreatureBrain(30, 17, 0);
    const e = canister(s, 37.5, 0.05, 5, {seconds: 60});
    run(s, r, 0.6);
    expect(r.state).toBe('investigate');
    run(s, r, 30, holding(e));
    expect(holding(e)(r)).toBe(true);
    expect(s.paths.length).toBeGreaterThan(0);
    expect(s.paths.every(p => p.noLinks === true && p.defer)).toBe(true);
    for (const b of [new StrainerBrain(34, 9, 0), new BlightbellyBrain(34, 9, 0), new SirenBrain(34, 9, 0, SIREN_STATS, false)]) {
      run(s, b, 0.6);
      expect(b.state).toBe('investigate');
      expect(b.lure?.lightId).toBe(e.id);
    }
  });

  it('the BB (its own crawling brain) is drawn too and walks round the wall to the canister (on real levels, off its walls and ceilings: bb-lure.test.ts)', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const b = new BbBrain(22.5, 5, -Math.PI / 2); // behind the wall, facing away (no CrawlWorld here: it stays on the floor)
    const e = canister(s, 37.5, 0.05, 5, {seconds: 60});
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure).toMatchObject({kind: 'scent', lightId: e.id});
    const tr = run(s, b, 40, holding(e));
    expect(tr.bad).toEqual([]);
    expect(holding(e)(b)).toBe(true);
    expect(b.x).toBeGreaterThan(WALL.x1);
    expect(b.aware).toBe(false);
    expect(s.paths.every(p => p.noLinks === true && p.defer)).toBe(true); // (no ladders: it climbs walls)
  });

  it('a DORMANT Siren is never drawn or woken by a scent (it is no light); the Screacher (sound only) never smells it', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    canister(s, 37.5, 0.05, 5, {seconds: 60});
    const siren = new SirenBrain(36, 5, 0);
    const sc = new ScreacherBrain(34, 7, 0);
    const tr = run(s, [siren, sc], 12);
    expect(siren.dormant).toBe(true);
    expect(siren.wakes).toBe(0);
    expect(siren.scentChecks).toBe(0);
    expect(tr.states.has('investigate')).toBe(false);
    expect(sc.lure).toBeNull();
    expect(sc.scentChecks).toBe(0);
  });
});

describe('scent lure: game wiring', () => {
  it('Game owns one registry: brain world `scents`, ticked in update() beside the flares, cleared with them in leaveSection', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/readonly scents = new ScentLures\(\);/);
    expect(src).toMatch(/this\.flares\.tick\(dt\);[^\n]*\n\s*this\.scents\.tick\(dt\);/);
    expect(src).toMatch(/this\.flares\.clear\(\);[^\n]*\n\s*this\.scents\.clear\(\);/);
    const bw = src.slice(src.indexOf('private brainWorld(): BrainWorld {'), src.indexOf('private soundOccluded('));
    expect(bw).toMatch(/scents: this\.scents\.list,/);
    // update() — and so the scent clock — only runs while playing (menus / pause / loading never tick)
    expect(src).toMatch(/if \(playing\) this\.update\(dt\);/);
  });
});
