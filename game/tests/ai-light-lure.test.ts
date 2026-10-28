// Iteration 12 (AI lane, mandate E): LIGHT ATTRACTS ENEMIES. The brain's 'investigate' state on hand-made fixtures driven
// exactly like game.ts updateZombies (brain -> body turn -> height-aware motor), with the game's BrainWorld (3D sight on
// Levels, level-aware PathFinder, ai/lightLure.ts lureWorld over a world/lightSources.ts registry):
//  - a seen flare / flashlight spot / flashlight lens draws an enemy at a SLOW walk (wander pace), it gathers near a flare;
//  - only with line of sight (walls, slabs between storeys block) and within the light's range / the enemy's view;
//  - seeing the player always wins (normal chase); gunfire / damage still alert it;
//  - the light going out -> it walks on to the last seen spot, lingers, returns to wander; a light that comes back is re-acquired;
//  - the body glow never lures; the flashlight lures only while on, its range follows the battery (light lane's attractRange);
//  - bounded, staggered re-evaluation; the rat/dog is lured too and never uses ladder links.

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, Grid, PathFinder} from '../src/gen/grid';
import {levelsOf, singleLevel, type Levels} from '../src/gen/levels';
import {ZombieBrain, type BrainOutput, type BrainWorld} from '../src/ai/brain';
import {CreatureBrain, RATDOG_STATS} from '../src/ai/creatureActor';
import {moveZombie, settleZombie} from '../src/ai/motor';
import {LURE, lurePoints, lureRange, lureWorld, perceiveLight} from '../src/ai/lightLure';
import {LightSources, type LightSource} from '../src/world/lightSources';
import {FIX, levelFixture} from './helpers/levelFixture';

const DT = 1 / 30;

// --- fixture: a 60 x 20 m hall (floor 0, ceiling 4) split north of z = 14 by a wall at x = 30..30.5 -------------------
const HALL = {wallX0: 60, wallZ1: 27} as const; // wall cells x = 60, y = 1..27 (z 0.5..14); open strip z 14..19.5
function hall(): Levels {
  const g = new Grid(120, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 119; x++) {
    const i = g.idx(x, y);
    g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0;
  }
  for (let y = 1; y <= HALL.wallZ1; y++) { const i = g.idx(HALL.wallX0, y); g.cells[i] = 0; g.ceil[i] = 0; g.area[i] = -1; }
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
  L: Levels; pf: PathFinder; sources: LightSources; player: Pl; rand: () => number;
  /** findPath calls (opts) and seePoint rays this run. */
  paths: {noLinks?: boolean; drops?: boolean}[]; rays: number;
  wander: boolean;
}
function sim(L: Levels, pf: PathFinder, player: Partial<Pl> = {}): Sim {
  return {L, pf, sources: new LightSources(), player: {x: 55, y: 0, z: 5, alive: true, ...player}, rand: mulberry(7), paths: [], rays: 0, wander: true};
}
/** The game's BrainWorld (game.ts brainWorld, stacked-levels branch) + the iteration-12 lure fields. */
function worldOf(s: Sim): BrainWorld {
  const {L, pf, player: p} = s;
  const lw = lureWorld(L, s.sources);
  return {
    px: p.x, pz: p.z, py: p.y, playerAlive: p.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, o) => { s.paths.push({...o}); return pf.find(ax, az, bx, bz, 0.34, 26000, o); },
    randomNear: (x, z, _r, y) => {
      if (!s.wander) return null;
      for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) {
        const sup = L.supportIn(x + ox, z + oz, (y ?? 0) + 0.05);
        if (sup && L.grid(sup.level).passable(Math.floor((x + ox) / CELL), Math.floor((z + oz) / CELL))) return [x + ox, z + oz, sup.floor];
      }
      return null;
    },
    rand: s.rand,
    ...lw,
    seePoint: (ax, ay, az, bx, by, bz) => { s.rays++; return lw.seePoint(ax, ay, az, bx, by, bz); },
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
interface Trace { states: Set<string>; maxCmd: number; maxGround: number; frames: number }
function run(s: Sim, b: ZombieBrain, seconds: number, until?: (b: ZombieBrain) => boolean): Trace {
  const tr: Trace = {states: new Set(), maxCmd: 0, maxGround: 0, frames: 0};
  for (let f = 0; f < seconds / DT; f++) {
    const x0 = b.x, z0 = b.z;
    const out = frame(s, b);
    tr.frames++;
    tr.states.add(b.state);
    tr.maxCmd = Math.max(tr.maxCmd, out.speed);
    tr.maxGround = Math.max(tr.maxGround, Math.hypot(b.x - x0, b.z - z0) / DT);
    if (until?.(b)) break;
  }
  return tr;
}
const flare = (s: Sim, x: number, y: number, z: number, range = 28): LightSource =>
  s.sources.add({kind: 'flare', active: true, x, y, z, dir: null, cosHalfAngle: 1, spot: {x, y, z}, attractRange: range, intensity: 1});
/** The light lane's flashlight source: emitter at the eye, beam dir, spot where it lands, range 20 m x battery output. */
const torch = (s: Sim, eye: {x: number; y: number; z: number}, spot: {x: number; y: number; z: number}, output = 1): LightSource => {
  const dx = spot.x - eye.x, dy = spot.y - eye.y, dz = spot.z - eye.z, d = Math.hypot(dx, dy, dz);
  return s.sources.add({kind: 'flashlight', active: output > 0, ...eye, dir: {x: dx / d, y: dy / d, z: dz / d}, cosHalfAngle: Math.cos(0.58), spot, attractRange: 20 * output, intensity: output});
};
const lureSpeed = (b: ZombieBrain) => b.stats.wanderSpeed * LURE.speedMult;

describe('light lure: perception module', () => {
  it('points sit just off the lit surface; ranges come from the light lane (capped); off / body glow / tiny ranges never lure', () => {
    const s = new LightSources();
    const f = s.add({kind: 'flare', active: true, x: 3, y: 0.02, z: 4, dir: null, cosHalfAngle: 1, spot: {x: 3, y: 0.02, z: 4}, attractRange: 28, intensity: 1});
    expect(lurePoints(f)).toEqual([{part: 'spot', x: 3, y: 0.02 + LURE.surfaceOffset, z: 4}]); // the flare itself, lifted off the floor
    const t = s.add({kind: 'flashlight', active: true, x: 0, y: 1.6, z: 0, dir: {x: 0, y: 0, z: 1}, cosHalfAngle: Math.cos(0.58), spot: {x: 0, y: 1.6, z: 10}, attractRange: 20, intensity: 1});
    const tp = lurePoints(t);
    expect(tp.map(p => p.part)).toEqual(['emitter', 'spot']); // the lens first: seen, it overrides its spot
    expect(tp[1].z).toBeCloseTo(10 - LURE.surfaceOffset, 6); // pulled back along the beam (the lit side of the wall)
    expect(lureRange(f)).toBe(28);
    expect(lureRange(t)).toBe(20);
    expect(lureRange({...f, attractRange: 500})).toBe(LURE.maxRange); // never an across-map beacon
    expect(lureRange({...t, active: false})).toBe(0);
    expect(lureRange({...f, attractRange: 1.5})).toBe(0);
    const glow = s.add({kind: 'bodyGlow', active: true, x: 0, y: 1.05, z: 0, dir: null, cosHalfAngle: 1, spot: {x: 0, y: 1.05, z: 0}, attractRange: 0, intensity: 1});
    expect(lureRange(glow)).toBe(0);
    expect(lureRange({...glow, attractRange: 15})).toBe(0); // excluded by kind even if a range were published
    expect(s.attracting().map(l => l.kind).sort()).toEqual(['flare', 'flashlight']);
  });
});

describe('light lure: investigate a seen light', () => {
  it('a flare in view draws an idle enemy at a slow walk (wander pace, not a charge); it gathers near the flare and never attacks', () => {
    const s = sim(HL, HPF); // player far east behind the wall: unseen
    const b = new ZombieBrain('shambler', 5, 5, Math.PI / 2); // facing +x
    const f = flare(s, 17, 0.02, 5);
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure).toMatchObject({lightId: f.id, kind: 'flare', part: 'spot', phase: 'approach'});
    const tr = run(s, b, 30, q => q.lure?.phase === 'hold' && Math.hypot(q.x - 17, q.z - 5) < q.lure.stop);
    const d = Math.hypot(b.x - 17, b.z - 5);
    console.info(`[lure] flare walk: ${(tr.frames * DT).toFixed(1)} s, cmd <= ${tr.maxCmd.toFixed(2)} m/s, ground <= ${tr.maxGround.toFixed(2)} m/s (chase ${b.stats.chaseSpeed}), stop ${d.toFixed(2)} m from the flare`);
    expect([...tr.states]).toEqual(['investigate']);
    expect(b.lure?.phase).toBe('hold');
    expect(d).toBeLessThanOrEqual(b.lure!.stop + 0.05);
    expect(d).toBeGreaterThan(1.2); // gathers around it, not on it
    expect(tr.maxCmd).toBeLessThanOrEqual(lureSpeed(b) + 1e-9);
    expect(tr.maxCmd).toBeLessThan(b.stats.chaseSpeed * 0.4);
    expect(tr.maxGround).toBeLessThan(lureSpeed(b) + 0.15);
    // it holds there while the flare keeps burning
    const hold = run(s, b, 6);
    expect([...hold.states]).toEqual(['investigate']);
    expect(b.lure?.phase).toBe('hold');
    expect(b.aware).toBe(false); // a light is not the player
  });

  it('needs line of sight and its view: a wall hides a flare; a flare behind an unaware enemy goes unnoticed (an alerted one notices)', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('shambler', 25, 5, Math.PI / 2);
    flare(s, 40, 0.02, 5); // 15 m away (in range) but behind the wall at x = 30
    const tr = run(s, b, 4);
    expect(tr.states.has('investigate')).toBe(false);
    expect(b.lureChecks).toBeGreaterThanOrEqual(7); // it did look
    const s2 = sim(HL, HPF);
    const c = new ZombieBrain('shambler', 20, 5, Math.PI / 2); // facing +x
    flare(s2, 12, 0.02, 5); // 8 m behind it
    expect(run(s2, c, 3).states.has('investigate')).toBe(false);
    c.aware = true; // alerted (e.g. it heard the player earlier): looks around
    run(s2, c, 0.6);
    expect(c.state).toBe('investigate');
    // a light right next to it is noticed whatever the facing
    const s3 = sim(HL, HPF);
    const e = new ZombieBrain('shambler', 20, 5, Math.PI / 2);
    flare(s3, 17.8, 0.02, 5);
    run(s3, e, 0.6);
    expect(e.state).toBe('investigate');
  });

  it('seeing the player takes priority: an investigating enemy switches to the normal chase; light + player in view = chase, never investigate', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('shambler', 5, 5, Math.PI / 2);
    flare(s, 17, 0.02, 5);
    run(s, b, 2);
    expect(b.state).toBe('investigate');
    s.player = {x: 14, y: 0, z: 5.5, alive: true}; // steps into view, 9 m ahead
    const out = frame(s, b);
    expect(b.state).toBe('chase');
    expect(out.alerted).toBe(true);
    expect(out.speed).toBe(b.stats.chaseSpeed);
    expect(b.lure).toBeNull();
    // both in view from the start
    const s2 = sim(HL, HPF, {x: 15, z: 6});
    const c = new ZombieBrain('shambler', 5, 5, Math.PI / 2);
    flare(s2, 12, 0.02, 5);
    const tr = run(s2, c, 2);
    expect(tr.states.has('investigate')).toBe(false);
    expect(tr.states.has('chase')).toBe(true);
  });

  it('gunfire and damage during an investigation alert it as before (chase)', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('coated', 5, 5, Math.PI / 2);
    flare(s, 17, 0.02, 5);
    run(s, b, 1);
    expect(b.state).toBe('investigate');
    b.hear(55, 5, 80, 0);
    expect(b.state).toBe('chase');
    expect(b.lure).toBeNull();
    const c = new ZombieBrain('shambler', 5, 5, Math.PI / 2);
    run(s, c, 1);
    expect(c.state).toBe('investigate');
    c.damage(10, 55, 5, 0);
    expect(c.state).toBe('chase');
  });
});

describe('light lure: losing and re-acquiring the light', () => {
  it('the flare goes out at the spot: linger briefly, then back to wander; a light that comes back is re-acquired', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('shambler', 5, 5, Math.PI / 2);
    const f = flare(s, 13, 0.02, 5);
    run(s, b, 30, q => q.lure?.phase === 'hold');
    expect(b.lure?.phase).toBe('hold');
    const starts = b.lureStarts;
    f.active = false; // burnt out
    run(s, b, LURE.lostGrace + LURE.period * 1.2 + 0.3, q => q.lure?.phase === 'linger');
    expect(b.state).toBe('investigate');
    expect(b.lure?.phase).toBe('linger');
    // re-acquire while lingering: the same investigation resumes
    f.active = true;
    run(s, b, LURE.period * 1.3, q => q.lure?.phase !== 'linger');
    expect(b.state).toBe('investigate');
    expect(b.lure?.phase).not.toBe('linger');
    expect(b.lureStarts).toBe(starts);
    // out again: linger, then wander off
    f.active = false;
    const tr = run(s, b, LURE.lostGrace + LURE.period * 1.2 + LURE.linger + LURE.lingerJitter + 0.5, q => q.state !== 'investigate');
    expect(b.state === 'idle' || b.state === 'wander').toBe(true);
    expect(b.lure).toBeNull();
    expect(tr.states.has('chase')).toBe(false);
    const after = run(s, b, 6);
    expect(after.states.has('investigate')).toBe(false); // no phantom lure
    expect(after.states.has('wander')).toBe(true); // it really wanders again
    // lit again later, in its view: a new investigation
    s.wander = false;
    run(s, b, 20, q => q.state === 'idle');
    b.yaw = Math.atan2(f.x - b.x, f.z - b.z);
    f.active = true;
    run(s, b, 1.5, q => q.state === 'investigate');
    expect(b.state).toBe('investigate');
    expect(b.lureStarts).toBe(starts + 1);
  });

  it('the light goes out mid-walk: it walks on to the last seen spot, lingers THERE, then wanders', () => {
    const s = sim(HL, HPF);
    const b = new ZombieBrain('shambler', 4, 5, Math.PI / 2);
    const f = flare(s, 16, 0.02, 5); // 12 m: a long walk
    run(s, b, 2);
    expect(b.state).toBe('investigate');
    f.active = false;
    const x0 = b.x;
    run(s, b, 3);
    expect(b.state).toBe('investigate');
    expect(b.lure?.phase).toBe('approach');
    expect(b.x - x0).toBeGreaterThan(1.5); // still heading for the last seen spot
    run(s, b, LURE.pursueAfterLoss, q => q.lure?.phase === 'linger');
    expect(b.lure?.phase).toBe('linger');
    expect(Math.hypot(b.x - 16, b.z - 5)).toBeLessThanOrEqual(b.lure!.stop + 0.05); // at the last seen spot
    run(s, b, LURE.linger + LURE.lingerJitter + 0.5, q => q.state !== 'investigate');
    expect(b.state === 'idle' || b.state === 'wander').toBe(true);
  });

  it('a lost light whose spot cannot be reached: it gives up (stuck / unreachable) and lingers instead of walking forever', () => {
    // a flare seen through a sight-only gap: a glazed opening (sight passes, bodies cannot) in a sealed wall
    const g = new Grid(60, 20);
    for (let y = 1; y < 19; y++) for (let x = 1; x < 59; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4; g.area[i] = 0; }
    for (let y = 1; y < 19; y++) { const i = g.idx(30, y); g.blocked[i] = 1; } // a full-height glass partition (blocks bodies, not sight)
    const L = singleLevel(g), pf = new PathFinder(L);
    const s = sim(L, pf, {x: 58 * CELL, z: 2});
    s.wander = false;
    const b = new ZombieBrain('shambler', 10, 5, Math.PI / 2);
    flare(s, 20, 0.02, 5);
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    const tr = run(s, b, 20, q => q.state !== 'investigate');
    // it walks up to the glass and stands looking (the flare is still visible: hold / face, no path through)
    expect(tr.states.has('chase')).toBe(false);
    expect(b.x).toBeLessThan(15);
    expect(b.state).toBe('investigate');
    s.sources.list[0].active = false;
    run(s, b, LURE.lostGrace + LURE.pursueAfterLoss + LURE.linger + LURE.lingerJitter + 1, q => q.state !== 'investigate');
    expect(b.state).toBe('idle');
  });
});

describe('light lure: the flashlight', () => {
  // Player round the end of the wall in the open strip; the beam passes the wall's end and lands on the floor of the west room.
  const eye = {x: 36, y: 1.6, z: 17};
  const spot = {x: 24, y: 0, z: 12};
  it('its lit spot lures an enemy that cannot see the player — only while it is on, and only as far as the battery allows', () => {
    expect(HL.lineOfSight({x: 20, y: 1.5, z: 5}, {x: 36, y: 1.6, z: 17})).toBe(false); // the player is hidden by the wall
    expect(HL.lineOfSight(eye, {x: spot.x, y: 0.1, z: spot.z})).toBe(true); // the beam reaches the spot
    const off = sim(HL, HPF, {x: 36, z: 17});
    const a = new ZombieBrain('shambler', 20, 5, 0); // facing +z (the spot is 8 m ahead-right)
    torch(off, eye, spot, 0); // switched off / flickered off / empty: inactive, range 0
    expect(run(off, a, 3).states.has('investigate')).toBe(false);
    const dim = sim(HL, HPF, {x: 36, z: 17});
    const c = new ZombieBrain('shambler', 20, 5, 0);
    torch(dim, eye, spot, 0.3); // weak battery: the light lane publishes 20 m x 0.3 = 6 m < 8 m away
    expect(run(dim, c, 3).states.has('investigate')).toBe(false);
    const on = sim(HL, HPF, {x: 36, z: 17});
    const b = new ZombieBrain('shambler', 20, 5, 0);
    const t = torch(on, eye, spot, 1);
    run(on, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure).toMatchObject({lightId: t.id, kind: 'flashlight', part: 'spot'});
    const tr = run(on, b, 20, q => q.lure?.phase === 'hold');
    expect(b.lure?.phase).toBe('hold');
    expect(Math.hypot(b.x - spot.x, b.z - spot.z)).toBeLessThan(b.lure!.stop + 0.3);
    expect(tr.maxCmd).toBeLessThanOrEqual(lureSpeed(b) + 1e-9);
    expect(tr.states.has('chase')).toBe(false);
    // the player switches it off: linger, then wander
    t.active = false; t.attractRange = 0; t.spot = null;
    run(on, b, LURE.lostGrace + LURE.period * 1.2 + LURE.linger + LURE.lingerJitter + 0.6, q => q.state !== 'investigate');
    expect(b.state === 'idle' || b.state === 'wander').toBe(true);
  });

  it('its lens lures a distant enemy inside the beam toward the player, who then takes priority (chase); a beam pointed away does not', () => {
    // enemy 19.5 m down the hall facing the player: beyond its 18 m sight, within the torch's 20 m
    const mk = () => { const s = sim(HL, HPF, {x: 5, z: 5}); s.wander = false; return s; };
    const s = mk();
    const b = new ZombieBrain('shambler', 24.5, 5, -Math.PI / 2);
    const lens = {x: 5.15, y: 1.45, z: 5};
    torch(s, lens, {x: 29.99, y: 1.5, z: 5}); // shines past the enemy onto the wall behind it (out of its view)
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure?.part).toBe('emitter');
    const tr = run(s, b, 15, q => q.state === 'chase');
    expect(b.state).toBe('chase');
    expect(Math.hypot(b.x - 5, b.z - 5)).toBeLessThanOrEqual(b.stats.sightRange + 0.05);
    expect(tr.states.has('investigate')).toBe(true);
    // the same torch pointed away (across the hall): no lens in view, its spot out of range
    const s2 = mk();
    const c = new ZombieBrain('shambler', 24.5, 5, -Math.PI / 2);
    torch(s2, lens, {x: 5.15, y: 1.5, z: 19.4});
    expect(run(s2, c, 3).states.has('investigate')).toBe(false);
  });
});

describe('light lure: storeys and the body glow', () => {
  it('no lure through a slab between storeys (either way); the same light on its own storey lures', () => {
    // deck (level 1, floor 4.75) right over platform A (main, ceiling 4.4 under the deck)
    const s = sim(FL, FPF, {x: 4, y: 0, z: 20}); // player far away on platform B's west end
    s.wander = false;
    const up = new ZombieBrain('shambler', 23, 6, 0); up.y = FIX.upperY; up.aware = true; // looks everywhere
    flare(s, 23.5, 0.02, 7.5); // platform A, under the deck slab, 4.7 m below
    expect(run(s, up, 3).states.has('investigate')).toBe(false);
    const s2 = sim(FL, FPF, {x: 4, y: 0, z: 20});
    s2.wander = false;
    const down = new ZombieBrain('shambler', 23, 7.5, 0); down.y = 0; down.aware = true;
    flare(s2, 23.5, FIX.upperY + 0.02, 6.5); // on the deck above it
    expect(run(s2, down, 3).states.has('investigate')).toBe(false);
    // positive control: a flare on the deck seen from the deck
    const s3 = sim(FL, FPF, {x: 4, y: 0, z: 20});
    s3.wander = false;
    const deck = new ZombieBrain('shambler', 24, 18, Math.PI); deck.y = FIX.upperY; // facing -z
    flare(s3, 24.5, FIX.upperY + 0.02, 8);
    run(s3, deck, 0.6);
    expect(deck.state).toBe('investigate');
    run(s3, deck, 25, q => q.lure?.phase === 'hold');
    expect(deck.lure?.phase).toBe('hold');
    expect(deck.y).toBeCloseTo(FIX.upperY, 3);
  });

  it('a flare seen up an open stair draws the enemy up the stairs to it (level-aware path)', () => {
    // U1 rises steeper than a sight line from the platform (with a mid-flight landing), so the view is from the platform's far end
    // to a flare just past the stair head on the deck: find such a stand (clear with a 10 cm lower eye too) and flare spot.
    let from: {x: number; z: number; tx: number} | null = null;
    for (const tx of [20.2, 20.3, 20.4]) for (let x = 2.25; x <= 8 && !from; x += 0.25) for (const z of [3.25, 3.5, 3.75]) {
      const pt = {x: tx, y: FIX.upperY + 0.02 + LURE.surfaceOffset, z: 3.5};
      if ([1.5, 1.4].every(e => FL.lineOfSight({x, y: e, z}, pt)) && FL.levelAt(x, z, 0.05) === 0) { from = {x, z, tx}; break; }
    }
    expect(from, 'a view up the open stair exists').not.toBeNull();
    const target = {x: from!.tx, y: FIX.upperY + 0.02, z: 3.5};
    const s = sim(FL, FPF, {x: 29, y: 0, z: 21}); // far east on platform B: out of its sight
    s.wander = false;
    const b = new ZombieBrain('shambler', from!.x, from!.z, Math.PI / 2); b.y = 0;
    flare(s, target.x, target.y, target.z);
    run(s, b, 0.6);
    expect(b.state).toBe('investigate');
    expect(b.lure!.gy).toBeCloseTo(FIX.upperY, 2); // the goal is on the deck
    const y0 = b.y;
    const tr = run(s, b, 45, q => q.lure?.phase === 'hold');
    expect(b.lure?.phase).toBe('hold');
    expect(tr.states.has('chase')).toBe(false);
    // climbed the open flight (stops within its stop distance of the flare: the top steps or the deck)
    expect(b.y - y0).toBeGreaterThan(FIX.upperY - 0.8);
    expect(Math.hypot(b.x - target.x, b.z - target.z)).toBeLessThanOrEqual(b.lure!.stop + 0.05);
  });

  it('the body glow (range 0, or any range) and tiny-range lights never lure', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const b = new ZombieBrain('shambler', 10, 5, Math.PI / 2);
    s.sources.add({kind: 'bodyGlow', active: true, x: 14, y: 1.05, z: 5, dir: null, cosHalfAngle: 1, spot: {x: 14, y: 1.05, z: 5}, attractRange: 0, intensity: 1});
    s.sources.add({kind: 'bodyGlow', active: true, x: 15, y: 1.05, z: 5, dir: null, cosHalfAngle: 1, spot: {x: 15, y: 1.05, z: 5}, attractRange: 15, intensity: 1});
    flare(s, 16, 0.02, 5, 1.5);
    const tr = run(s, b, 4);
    expect(tr.states.has('investigate')).toBe(false);
    expect(perceiveLight(b, s.sources.list, () => true)).toBeNull();
  });
});

describe('light lure: cost and archetypes', () => {
  it('re-evaluates at a modest staggered rate (~2.5 checks / s, first checks out of phase); no lights = no checks', () => {
    const s = sim(HL, HPF);
    s.wander = false;
    const a = new ZombieBrain('shambler', 10, 30 * CELL, Math.PI / 2), b = new ZombieBrain('shambler', 12.5, 32 * CELL, Math.PI / 2);
    flare(s, 40, 0.02, 3); // behind the wall: checked, never seen
    let firstA = -1, firstB = -1;
    for (let f = 0; f < 10 / DT; f++) {
      frame(s, a); frame(s, b);
      if (firstA < 0 && a.lureChecks) firstA = f;
      if (firstB < 0 && b.lureChecks) firstB = f;
    }
    for (const q of [a, b]) {
      expect(q.lureChecks).toBeGreaterThanOrEqual(10 / (LURE.period * 1.2) - 1);
      expect(q.lureChecks).toBeLessThanOrEqual(10 / (LURE.period * 0.8) + 1);
    }
    expect(firstA).not.toBe(firstB);
    expect(s.rays).toBeLessThanOrEqual(a.lureChecks + b.lureChecks); // one point (the flare) per check at most
    const n = sim(HL, HPF);
    const c = new ZombieBrain('shambler', 10, 5, Math.PI / 2);
    run(n, c, 5);
    expect(c.lureChecks).toBe(0);
    expect(n.rays).toBe(0);
  });

  it('the rat/dog is lured too (its own slow wander pace) and never paths over ladder links', () => {
    const s = sim(HL, HPF);
    const r = new CreatureBrain(5, 5, Math.PI / 2);
    flare(s, 15, 0.02, 5);
    run(s, r, 0.6);
    expect(r.state).toBe('investigate');
    const tr = run(s, r, 20, q => q.lure?.phase === 'hold');
    expect(r.lure?.phase).toBe('hold');
    expect(tr.maxCmd).toBeLessThanOrEqual(RATDOG_STATS.wanderSpeed * LURE.speedMult + 1e-9);
    expect(tr.maxCmd).toBeLessThan(RATDOG_STATS.chaseSpeed * 0.3);
    expect(s.paths.length).toBeGreaterThan(0);
    expect(s.paths.every(o => o.noLinks === true)).toBe(true);
  });
});
