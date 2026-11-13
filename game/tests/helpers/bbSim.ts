// Task studio-bb-production-20261112-234540-01: a deterministic Node scenario of ONE BB on a REAL generated level — its runtime brain
// (ai/bb.ts BbBrain) driven exactly as Game.updateZombies drives an enemy (brain.update -> turn -> the height-aware motor -> the
// player separation -> settle), with the level's real collision geometry as its CrawlWorld (ai/bbSurface.ts levelsCrawlWorld: the
// bullet ray over structure + solid props), immediate path searches, a scripted player and a seeded world RNG.
//
// Every step is audited (BbAudit): the body centre stays in free space, off the floor it never moves through anything solid and
// never further than a body can in one step, a hit happens only inside a leap, at most once per leap, and only after that leap's
// wind-up ran its time.

import {expect} from 'vitest';
import {mulberry32} from '../../src/core/rng';
import {levelsOf, type Levels} from '../../src/gen/levels';
import {CELL, PathFinder} from '../../src/gen/grid';
import {PropIndex} from '../../src/core/physics';
import type {BrainOutput, BrainWorld} from '../../src/ai/brain';
import {BB_BODY, BB_POUNCE, BbBrain, bbShoveStep, type BbPhase, type BbSurface} from '../../src/ai/bb';
import {levelsCrawlWorld, type CrawlWorld} from '../../src/ai/bbSurface';
import {moveZombie, sameLevel, settleZombie} from '../../src/ai/motor';
import {searchExpand} from '../../src/ai/chaseShare';
import {lureWorld} from '../../src/ai/lightLure';
import type {ScentLures} from '../../src/ai/scentLure';
import type {StationLayout} from '../../src/gen/stationTypes';

export interface BbSimPlayer { x: number; y: number; z: number; eye: number; alive: boolean; radius: number }
export interface BbAudit {
  /** Steps taken; steps with the body on a wall / on a ceiling / in the air. */
  steps: number; wall: number; ceiling: number; air: number;
  /** Body centre outside free space; a step off the floor that crossed something solid; a step longer than a body can move. */
  inSolid: number; crossed: number; jumps: number;
  /**
   * Checks that do not go through the brain's own rays: steps with the body centre more than 0.12 m inside a solid prop's exact box
   * (off the floor), and steps with the floor body (as the motor left it) outside every free band of the level.
   */
  inProp: number; floorOut: number;
  /** On the floor (the game's motor + body separation): a step of more than 0.5 m (a shove no walk explains). */
  shoves: number;
  /**
   * The pose's basis not unit / not perpendicular; the largest turn of the basis in one step (rad); steps on which it turned faster
   * than the pose's turn limit allows for that step's own frame time (14 rad/s).
   */
  badBasis: number; maxTurn: number; fastTurns: number;
  /** Steps on which it "saw" the player with no real sight line from its eye. */
  blindSight: number;
  /** The longest single step of the body centre (m) and the fastest (m/s). */
  maxStep: number; maxSpeed: number;
  /** Wind-ups begun, leaps launched, hits on the player. */
  windups: number; leaps: number; hits: number;
  /** A hit outside a leap, a second hit in one leap, a leap launched before its wind-up ran its time, a wind-up begun during the cooldown. */
  freeHits: number; doubleHits: number; earlyLeaps: number; earlyWindups: number;
  /** Shortest time between a landing and the next wind-up (s; Infinity: none). */
  minRestS: number;
  /** Every phase / surface seen. */
  phases: Set<BbPhase>; surfaces: Set<BbSurface>;
  /** Time-stamped events (cackle, windup, leap, hit, land, surface changes). */
  events: string[];
}

/** The fastest the rendered basis may turn (rad/s): the pose's own turn limit (ai/bb.ts turnPose calls). */
const POSE_TURN = 14;

const STATIC = new WeakMap<object, {L: Levels; idx: PropIndex; pf: PathFinder; cw: CrawlWorld}>();
export function bbStatic(layout: StationLayout): {L: Levels; idx: PropIndex; pf: PathFinder; cw: CrawlWorld} {
  let s = STATIC.get(layout);
  if (!s) {
    const L = levelsOf(layout);
    STATIC.set(layout, (s = {L, idx: new PropIndex(L, layout.props), pf: new PathFinder(L), cw: levelsCrawlWorld(L, layout.props, layout.trench.floorY)}));
  }
  return s;
}

export interface BbSimOpts {
  /** Where the BB starts (floor). */
  at: {x: number; z: number; y?: number; yaw?: number; level?: number};
  /** Where the player stands (feet y: the floor there unless given). */
  player: {x: number; z: number; y?: number};
  /** No CrawlWorld for the brain (the floor-only fallback). */
  noCrawl?: boolean;
  seed?: number;
  /**
   * Zombie Lure scents (ai/scentLure.ts): the world gets the game's lure fields (lureWorld: no lights) and `scents` = this registry's
   * active list, and every step ends with its tick (Game.update's scents.tick). Absent: the world has no lure fields, as before.
   */
  scents?: ScentLures;
}

export function bbSim(layout: StationLayout, o: BbSimOpts) {
  const {L, idx, pf, cw} = bbStatic(layout);
  const rand = mulberry32(o.seed ?? 7);
  const floorAt = (x: number, z: number, y?: number): number => (y !== undefined ? L.supportIn(x, z, y + 0.05, 0.6)?.floor : undefined) ?? L.grid(0).floorAt(x, z);
  const py = o.player.y ?? floorAt(o.player.x, o.player.z);
  const player: BbSimPlayer = {x: o.player.x, y: py, z: o.player.z, eye: py + 1.62, alive: true, radius: 0.3};
  const b = new BbBrain(o.at.x, o.at.z, o.at.yaw ?? 0);
  b.y = o.at.y ?? L.grid(o.at.level ?? 0).floorAt(o.at.x, o.at.z);
  b.pose.y = b.y;
  const world = (): BrainWorld => ({
    px: player.x, pz: player.z, py: player.y, pEye: player.eye, playerAlive: player.alive,
    los: (ax, az, bx, bz, ay, by) => L.lineOfSight({x: ax, y: (ay ?? 0) + 1.5, z: az}, {x: bx, y: (by ?? 0) + 1.5, z: bz}),
    walkClear: (ax, az, bx, bz, r, ay, by) => L.walkLineClear(ax, ay ?? 0, az, bx, bz, r, by),
    findPath: (ax, az, bx, bz, op) => pf.find(ax, az, bx, bz, 0.34, searchExpand(op), op),
    randomNear: (x, z, r, y) => {
      const lv = y !== undefined ? Math.max(0, L.levelAt(x, z, y + 0.05)) : 0, G = L.grid(lv);
      for (let k = 0; k < 14; k++) {
        const tx = x + (rand() * 2 - 1) * r, tz = z + (rand() * 2 - 1) * r;
        const [cx, cy] = G.cellOf(tx, tz);
        if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) { const c = G.center(cx, cy); return [c[0], c[1], G.cellFloor(cx, cy)]; }
      }
      return null;
    },
    rand,
    ...(o.noCrawl ? {} : {crawl: cw}),
    ...(o.scents ? {...lureWorld(L, {attracting: () => []}), scents: o.scents.list} : {}),
  });

  const solids = layout.props.filter(p => p.hx > 0 && p.hz > 0 && p.h > 0);
  const A: BbAudit = {steps: 0, wall: 0, ceiling: 0, air: 0, inSolid: 0, crossed: 0, jumps: 0, inProp: 0, floorOut: 0, shoves: 0, badBasis: 0, maxTurn: 0, fastTurns: 0, blindSight: 0, maxStep: 0, maxSpeed: 0, windups: 0, leaps: 0, hits: 0,
    freeHits: 0, doubleHits: 0, earlyLeaps: 0, earlyWindups: 0, minRestS: Infinity, phases: new Set(), surfaces: new Set(), events: []};
  let t = 0;
  const P = b.pose;
  const prev = b.centre();
  const foot = {x: b.x, z: b.z};
  const basis = {ux: P.ux, uy: P.uy, uz: P.uz, fx: P.fx, fy: P.fy, fz: P.fz};
  let seq = {cackle: P.cackleSeq, windup: P.windupSeq, pounce: P.pounceSeq, land: P.landSeq};
  let surface: BbSurface = P.surface;
  let windupAt = -Infinity, landAt = -Infinity, leapOpen = false, leapHits = 0, wasOff = false;
  let last: BrainOutput | null = null;
  const ev = (s: string): void => { if (A.events.length < 400) A.events.push(`${t.toFixed(2)} ${s}`); };

  /** One frame, as Game.updateZombies runs an enemy. */
  function step(dt: number): BrainOutput {
    t += dt;
    // the eye its sight is cast from this step (the pose as it stands before the update)
    const eye = {x: P.x + P.ux * BB_BODY.eyeUp + P.fx * BB_BODY.eyeFwd, y: P.y + P.uy * BB_BODY.eyeUp + P.fy * BB_BODY.eyeFwd, z: P.z + P.uz * BB_BODY.eyeUp + P.fz * BB_BODY.eyeFwd};
    const out = b.update(dt, world());
    if (out.face !== null) {
      let d = out.face - b.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = (b.stats.turnRate ?? 4.5) * dt;
      b.yaw += Math.max(-turn, Math.min(turn, d));
    }
    moveZombie(b, out, dt, L, idx);
    if (b.alive && !b.climbing) {
      const dx = b.x - player.x, dz = b.z - player.z, d = Math.hypot(dx, dz), min = b.stats.radius + player.radius + 0.22;
      if (d > 1e-4 && d < min && sameLevel(b.y, player.y)) { const push = Math.min(min - d, bbShoveStep(dt)); b.x += dx / d * push; b.z += dz / d * push; }
      settleZombie(b, L, idx);
    }
    b.syncFloor(); // (as the game does after the motor: the rendered floor body is where the motor left it)
    // ---- audit
    A.steps++;
    const off = b.offFloor;
    // the pose the actor renders, written inside update(): where the brain put the body this step (on the floor the motor and the
    // body separation then move it — the game's own floor motion, audited only for staying in free space)
    const c = b.centre();
    A.phases.add(P.phase); A.surfaces.add(P.surface);
    if (P.surface === 'wall') A.wall++; else if (P.surface === 'ceiling') A.ceiling++; else if (P.surface === 'air') A.air++;
    const d = Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z);
    if (off || wasOff) {
      if (!cw.band(c.x, c.y, c.z)) { A.inSolid++; ev(`IN SOLID at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)} ${P.surface}/${P.phase}`); }
      if (d > 1e-6) {
        const h = cw.ray(prev, {x: (c.x - prev.x) / d, y: (c.y - prev.y) / d, z: (c.z - prev.z) / d}, d);
        if (h.kind !== 'none' && h.t < d - 0.02) { A.crossed++; ev(`CROSSED ${h.kind} at t=${h.t.toFixed(3)} of ${d.toFixed(3)} ${P.surface}/${P.phase}`); }
      }
      // no step off the floor is longer than the fastest body motion (the fastest fall is 18 m/s) allows
      if (d > 19 * dt + 0.03) { A.jumps++; ev(`JUMP ${d.toFixed(3)} m in one step ${P.surface}/${P.phase}`); }
    }
    if (off) {
      // inside a solid prop, by its exact box (a prop the game has made dynamic has h = 0 and is skipped) — not by the brain's rays
      for (const q of solids) {
        if (q.h <= 0) continue;
        const dy = Math.min(c.y - q.y, q.y + q.h - c.y);
        if (dy <= 0.12) continue;
        const depth = q.round ? q.hx - Math.hypot(c.x - q.x, c.z - q.z) : Math.min(c.x - (q.x - q.hx), q.x + q.hx - c.x, c.z - (q.z - q.hz), q.z + q.hz - c.z);
        if (depth > 0.12) { A.inProp++; ev(`INSIDE PROP ${q.kind} by ${Math.min(depth, dy).toFixed(2)} m at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)} ${P.surface}/${P.phase}`); break; }
      }
    } else if (b.alive && !cw.band(b.x, b.y + 0.3, b.z) && !cw.band(b.x, b.y + 0.55, b.z)) {
      // the floor body where the motor left it: in free space (a body set down inside a wall stays there)
      A.floorOut++;
      ev(`FLOOR BODY OUTSIDE FREE SPACE at ${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)} ${P.phase}`);
    }
    if (!off && !wasOff && Math.hypot(b.x - foot.x, b.z - foot.z) > 0.5) { A.shoves++; ev(`SHOVE ${Math.hypot(b.x - foot.x, b.z - foot.z).toFixed(3)} m on the floor ${P.phase}`); }
    foot.x = b.x; foot.z = b.z;
    // the pose contract: a unit, perpendicular basis that turns continuously
    if (Math.abs(Math.hypot(P.ux, P.uy, P.uz) - 1) > 1e-6 || Math.abs(Math.hypot(P.fx, P.fy, P.fz) - 1) > 1e-6 || Math.abs(P.ux * P.fx + P.uy * P.fy + P.uz * P.fz) > 1e-6) A.badBasis++;
    const turn = Math.max(Math.acos(Math.max(-1, Math.min(1, P.ux * basis.ux + P.uy * basis.uy + P.uz * basis.uz))), Math.acos(Math.max(-1, Math.min(1, P.fx * basis.fx + P.fy * basis.fy + P.fz * basis.fz))));
    if (turn > POSE_TURN * dt + 0.02) { A.fastTurns++; ev(`TURN ${turn.toFixed(3)} rad in one ${dt.toFixed(4)} s step ${P.surface}/${P.phase} was ${surface} doing ${JSON.stringify(b.doing)}`); }
    A.maxTurn = Math.max(A.maxTurn, turn);
    // sight is honest: whenever it sees the player there is a real sight line from its eye to the player's head or chest
    if (b.seeing && !o.noCrawl && !L.lineOfSight(eye, {x: player.x, y: player.eye - 0.1, z: player.z}) && !L.lineOfSight(eye, {x: player.x, y: Math.max(player.y + 0.35, player.eye - 0.55), z: player.z})) {
      A.blindSight++;
      ev('SEES THROUGH SOLID');
    }
    basis.ux = P.ux; basis.uy = P.uy; basis.uz = P.uz; basis.fx = P.fx; basis.fy = P.fy; basis.fz = P.fz;
    A.maxStep = Math.max(A.maxStep, d);
    A.maxSpeed = Math.max(A.maxSpeed, d / dt);
    prev.x = c.x; prev.y = c.y; prev.z = c.z;
    wasOff = off;
    if (P.cackleSeq !== seq.cackle) ev('cackle');
    if (P.windupSeq !== seq.windup) {
      A.windups++;
      if (b.cooldown > 0) A.earlyWindups++;
      if (landAt > -Infinity) A.minRestS = Math.min(A.minRestS, t - landAt);
      windupAt = t;
      ev(`windup on ${P.surface} d=${Math.hypot(player.x - c.x, player.y + 1.1 - c.y, player.z - c.z).toFixed(2)}`);
    }
    if (P.pounceSeq !== seq.pounce) {
      A.leaps++;
      if (t - windupAt < BB_POUNCE.windupS - dt - 1e-6) A.earlyLeaps++;
      leapOpen = true; leapHits = 0;
      ev('leap');
    }
    if (out.attackHit) {
      A.hits++;
      if (!leapOpen) { A.freeHits++; ev('FREE HIT'); }
      else if (++leapHits > 1) { A.doubleHits++; ev('DOUBLE HIT'); }
      ev('hit');
    }
    // the cooldown runs from the LEAP's landing: a later hop off a prop top it came down on is not a new landing of that leap
    if (P.landSeq !== seq.land) { if (leapOpen) landAt = t; leapOpen = false; ev(`land ${P.surface}`); }
    if (P.surface !== surface) { ev(`${surface} -> ${P.surface}`); surface = P.surface; }
    seq = {cackle: P.cackleSeq, windup: P.windupSeq, pounce: P.pounceSeq, land: P.landSeq};
    last = out;
    o.scents?.tick(dt); // (Game.update after the enemies: the lure's active seconds)
    return out;
  }
  /** Run `seconds` at `dt`; `each` may move the player / stop early (return false). */
  function run(seconds: number, dt = 1 / 60, each?: (t: number, out: BrainOutput) => boolean | void): void {
    for (let k = 0, n = Math.round(seconds / dt); k < n; k++) {
      const out = step(dt);
      if (each?.(t, out) === false) return;
    }
  }
  return {b, player, L, cw, idx, audit: A, step, run, world, get t() { return t; }, get out() { return last; }};
}

/** A walkable point about `dist` m from (x, z) on the same floor with a clear walk line from it (deterministic: sampled round the compass). */
export function standNear(layout: StationLayout, x: number, z: number, y: number, dist: number, clear = true): {x: number; z: number} | null {
  const {L} = bbStatic(layout);
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, px = x + Math.sin(a) * dist, pz = z + Math.cos(a) * dist;
    const s = L.supportIn(px, pz, y + 0.05, 0.3);
    if (!s || Math.abs(s.floor - y) > 0.2 || !L.circleClear(px, pz, 0.34, s.floor)) continue;
    if (clear && !L.walkLineClear(x, y, z, px, pz, 0.25, y)) continue;
    return {x: px, z: pz};
  }
  return null;
}

/**
 * The invariants every run must keep. `pushed`: the player kept walking into it, or stood inside its body's reach — the game's body
 * separation and wall resolve (the floor motor every enemy shares) may then shove it; that is not its own motion.
 */
export function bbClean(A: BbAudit, b: BbBrain, where: string, pushed = false): void {
  const bad = A.events.filter(e => /[A-Z]{4}/.test(e)).slice(0, 3).join(' | ');
  expect(A.inSolid, `${where}: body inside solid geometry: ${bad}`).toBe(0);
  expect(A.inProp, `${where}: body inside a prop: ${bad}`).toBe(0);
  expect(A.floorOut, `${where}: floor body outside free space: ${bad}`).toBe(0);
  expect(A.crossed, `${where}: moved through solid geometry: ${bad}`).toBe(0);
  expect(A.jumps, `${where}: a step no body could make: ${bad}`).toBe(0);
  if (!pushed) expect(A.shoves, `${where}: shoved across the floor: ${bad}`).toBe(0);
  expect(A.badBasis, `${where}: pose basis not orthonormal`).toBe(0);
  expect(A.fastTurns, `${where}: the pose turned too far in one step: ${A.events.filter(e => / TURN /.test(e)).slice(-2).join(' | ')}`).toBe(0);
  expect(A.blindSight, `${where}: saw the player through solid geometry`).toBe(0);
  expect(A.freeHits, `${where}: a hit outside a leap`).toBe(0);
  expect(A.doubleHits, `${where}: two hits in one leap`).toBe(0);
  expect(A.earlyLeaps, `${where}: a leap before its wind-up ran its time`).toBe(0);
  expect(A.earlyWindups, `${where}: a wind-up during the cooldown`).toBe(0);
  expect(b.tally.recoveries, `${where}: recovered from an invalid place`).toBe(0);
  expect(b.tally.forced, `${where}: was put on the floor by force`).toBe(0);
}

export type BbPlayerMove = 'still' | 'strafe-walk' | 'strafe-sprint' | 'circle-walk' | 'back-walk' | 'juke';
/**
 * A scripted player for a sim: call the returned function BEFORE each step. Walk 3.4 m/s, sprint 5.8 m/s, always relative to the BB:
 * strafing (turning back at a wall), circling, backing away, or a 0.45 s sprint to the side the frame each leap launches (`juke`).
 * The player never walks into anything solid.
 */
export function bbMover(sim: ReturnType<typeof bbSim>, mode: BbPlayerMove): (dt: number) => void {
  let dir = 1, jukeT = 0, seq = sim.b.pose.pounceSeq;
  return (dt: number): void => {
    if (mode === 'still') return;
    const P = sim.player, b = sim.b, dx = P.x - b.x, dz = P.z - b.z, d = Math.hypot(dx, dz) || 1;
    let vx = 0, vz = 0;
    if (mode === 'strafe-walk' || mode === 'strafe-sprint') { const sp = mode === 'strafe-walk' ? 3.4 : 5.8; vx = -dz / d * sp * dir; vz = dx / d * sp * dir; }
    else if (mode === 'circle-walk') { vx = -dz / d * 3.4; vz = dx / d * 3.4; }
    else if (mode === 'back-walk') { vx = dx / d * 3.4; vz = dz / d * 3.4; }
    else {
      if (b.pose.pounceSeq !== seq) { seq = b.pose.pounceSeq; jukeT = 0.45; dir = -dir; }
      if (jukeT > 0) { jukeT -= dt; vx = -dz / d * 5.8 * dir; vz = dx / d * 5.8 * dir; }
    }
    if (!vx && !vz) return;
    const nx = P.x + vx * dt, nz = P.z + vz * dt;
    if (sim.L.circleClear(nx, nz, 0.3, P.y)) { P.x = nx; P.z = nz; } else dir = -dir;
  };
}
