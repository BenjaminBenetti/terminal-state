// Task track3-eaton-centre-20261031 (lane HORDE): ROAMING HORDES at runtime — the director that walks each placed group
// (layout.hordes, ai/hordePlace.ts) along the patrol graph (layout.mall.patrol) as one loose crowd. Pure logic (no three.js):
// the game builds one per section (game.ts buildSection) and calls update() once per frame before the brains think.
//
// MODEL
//  - Each group has a virtual ANCHOR (its patrol intent) that walks a real PathFinder route from patrol node to patrol node
//    (escalator / stair / bridge / gallery legs: whatever the route crosses is real walkable geometry — the route comes from the
//    game's own path search with ladders excluded) at the group's slow roam pace, pausing now and then at nodes. ONE route per
//    group (never per member). The anchor leaves a TRAIL of crumbs (every 0.5 m, with the feet height: stairs / escalators /
//    bridges are on it).
//  - Members hold FORMATION SLOTS: slot 0 (the leader) is the anchor itself, the others stand in staggered rows (1, 2, 3, 2, 3…)
//    behind it ALONG THE TRAIL — row r at r × 1.3 m of trail behind the anchor, offset sideways by ±1.2 m (seeded jitter per
//    member), so the crowd bends round corners and files up a stair instead of cutting through walls or the void. A slot whose
//    sideways step is not walkable from its trail point (wall, railing, void edge, stair side) is pulled in to half / zero
//    offset (checked by the height-aware walk test every 0.3 s per group, staggered). A dead member's slot is taken by the next
//    one (the leader is always the first living member), so the crowd tightens as it is shot down.
//  - Members steer to their slot with their own brain / motor (state 'patrol', ai/brain.ts): no teleport, the usual collision,
//    stairs and railings. A member that cannot walk straight to its slot follows the trail crumbs (always walkable: the anchor
//    walked there); one that is far away and cut off (after a chase) asks for ONE regroup path to its slot through the game's
//    path service (deferrable: far / unseen requests run as frame-budget chunks). Soft separation between group mates keeps
//    them from clumping; the game's body separation still applies.
//  - The anchor waits for its crowd: its pace falls from full at a slot error (80th percentile) of 1.6 m to a stop at 4.5 m, and
//    a leg stalled for 12 s is abandoned (that link is avoided for a while; the group turns back / picks another).
//  - PERCEPTION is the existing brain's: a member that sees the player chases it (gunfire / damage / lights as for every enemy);
//    there is NO group-wide aggro. A member that becomes alerted calls out: group mates within 6 m HEAR it through the existing
//    hearing rule (brain.hear with the wall / slab muffle) and come to look. While any member is engaged the group halts (its
//    anchor holds: the crowd mills where it was); once nobody is engaged for 4 s it resumes. Members return to their slots after
//    the brain's usual search / idle (idle -> patrol).
//  - Members that cannot rejoin (3 failed regroup searches) leave the group and stay ordinary enemies.
// PERFORMANCE: per group per frame O(1) anchor work + O(members) cached-slot reads; the slot walk tests run every 0.3 s per group
// (phase-staggered); a group farther than 45 m (3D) from the player thinks every 3rd frame (staggered by group); member blocked
// probes every 0.35 s (staggered by member). Path searches: one per patrol leg per group and rare regroups, through the game's
// path service (immediate near the player, background chunks far away). Far calm members animate every 3rd frame (animStep).
// AUDIO: one idle groan per group per 1.6 s at most (vocalGate), on top of the Sfx's global 3-voice enemy vocal cap.

import type {Waypoint} from '../gen/grid';
import type {Levels} from '../gen/levels';
import type {MallPatrolNode} from '../gen/mall/mallTypes';
import type {StationLayout} from '../gen/stationTypes';
import {hearingMuffle, slabsBetween, type BrainOutput, type BrainWorld, type PatrolLink, type ZombieBrain} from './brain';
import {groundOf} from './motor';
import type {HordeGroupSpec, HordePatrolRules} from './hordeSpec';
import {MALL_HORDE_RULES} from './hordeSpec';
import {VOCAL_GATE} from './vocalReach';

/** Director tuning (see the file comment). Lengths m, times s, speeds m/s. */
export const HORDE_AI = {
  rowSpacing: 1.3,
  latSpacing: 1.2,
  /** Seeded per-member slot jitter (m, each axis). */
  slotJitter: 0.22,
  /** Trail crumb spacing and the crumbs kept (80 x 0.5 m = 40 m: longer than a 20-member column). */
  trailStep: 0.5,
  trailCrumbs: 80,
  /** A member this close to its slot stands. */
  arriveR: 0.5,
  /** Catch-up: anchor speed + catchK per metre of slot error, capped at maxCatch x the member's wander speed (a hurried walk). */
  catchK: 0.8,
  maxCatch: 1.6,
  /** Anchor pace vs the 80th-percentile slot error of the formed members: full at lagOK, stopped at lagStop. */
  lagOK: 1.6,
  lagStop: 4.5,
  /** A leg whose anchor stood still (waiting for its crowd) this long is abandoned. */
  stallGiveUp: 12,
  /** Slot walk-test pass period per group; member blocked-probe period. */
  validateEvery: 0.3,
  probeEvery: 0.35,
  /** A member holding no slot yet (the column still unspooling) walks to the trail tail when farther than this. */
  holdM: 8,
  /** A blocked member farther than this from its slot (or on another storey) asks for a regroup path; crumbs within viaM help first. */
  regroupM: 6,
  viaM: 7,
  regroupFails: 3,
  /** Seconds with no member engaged before the group walks on. */
  calmResume: 4,
  /** Beyond this 3D distance from the player a group thinks every farStride frames (staggered by group id). */
  farM: 45,
  farStride: 3,
  /** An alerted member's call: group mates within this (x the wall / slab muffle) hear it (brain.hear). */
  alertCallM: 6,
  /** Minimum gap between two idle groans of one group. */
  vocalGap: 1.6,
  /** Calm members farther than animFarM from the player animate every animStride frames. */
  animFarM: 32,
  animStride: 3,
  /** A patrol leg longer than detour x straight + detourSlack m is not a real link (avoided); bad legs may be retried after legRetry s. */
  detour: 3,
  detourSlack: 25,
  legRetry: 30,
  /** Initial pause range before a group sets off (desyncs the groups). */
  startPause: [0.5, 4] as readonly [number, number],
  /** Body radius used for the slot / blocked walk tests. */
  probeR: 0.3,
} as const;

/**
 * The runtime behaviour in plain sentences, built from the live tuning (for the source-generated enemy reference / docs: the
 * numbers can never drift from the code). `speed` = the profile's patrol pace (m/s).
 */
export function hordeBehaviourNotes(speed: number): string[] {
  const A = HORDE_AI;
  return [
    `Patrol intent: each group's anchor walks a real path-finder route (ladders excluded) from patrol node to patrol node at ${speed} m/s, pausing now and then; one route per group, never per member.`,
    `Formation: the leader (first living member) holds the anchor; the rest stand in staggered rows of 2 / 3 at ${A.rowSpacing} m of the anchor's own trail behind it, ±${A.latSpacing} m to the side (pulled in where a wall, railing, the void edge or a stair side is in the way), so the crowd bends round corners and files up stairs / escalators.`,
    `Cohesion: the anchor slows as its crowd falls behind (full pace up to ${A.lagOK} m of slot error at the 80th percentile, stopped at ${A.lagStop} m) and abandons a leg it stood on for ${A.stallGiveUp} s; members steer to their slots with their own motor (no teleport), follow the trail crumbs when cut off, and ask for one regroup path when far (${A.regroupM} m+); after ${A.regroupFails} failed regroups a member leaves the group and becomes an ordinary enemy.`,
    `Perception: the ordinary enemy AI — a member that sees the player (or hears gunfire / is hit, or sees a light) breaks formation and chases / investigates on its own; its alert call is heard by group mates within ${A.alertCallM} m through the usual wall / slab muffle. There is no group-wide aggro.`,
    `While any member is engaged the group halts where it is; ${A.calmResume} s after the last one calms down it walks on, members returning to their slots after their usual search.`,
    `Performance: groups farther than ${A.farM} m think every ${A.farStride} frames (staggered), slot walk tests run every ${A.validateEvery} s per group, leg / regroup searches go through the path service (background frame-budget chunks when far and unseen), calm members beyond ${A.animFarM} m animate every ${A.animStride} frames.`,
    `Audio: at most one idle groan per group every ${A.vocalGap} s, under the global ${VOCAL_GATE.cap}-voice enemy vocal cap.`,
  ];
}

export type HordePhase = 'patrol' | 'pause' | 'engaged' | 'dead';

/** xorshift32 (a group's private stream for patrol choices: never the game's shared random). */
function xs(s: number): number {
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
  return s | 0;
}

/** Formation offset of slot k: [row, lateral units] (rows of 1, 2, 3, 2, 3, …). */
export function slotOffset(k: number): [number, number] {
  if (k === 0) return [0, 0];
  let row = 1, start = 1;
  for (;;) {
    const n = row % 2 === 1 ? 2 : 3;
    if (k < start + n) {
      const i = k - start;
      return [row, n === 2 ? (i === 0 ? -0.5 : 0.5) : i - 1];
    }
    start += n;
    row++;
  }
}

export interface HordeMemberStats {
  index: number;
  state: string;
  slot: number;
  slotErr: number;
  role: 'leader' | 'follower' | 'engaged' | 'returning' | 'detached' | 'dead';
}

export class HordeMember implements PatrolLink {
  /** Current formation slot (rank among the living, formed members); -1 none. */
  slot = -1;
  row = 0;
  lat = 0;
  /** Validated slot (world, absolute y) and whether it exists (the trail is long enough). */
  sx = 0; sz = 0; sy = 0;
  hasSlot = false;
  detached = false;
  /** Fixed seeded jitter of this member's slot and facing. */
  readonly jr: number;
  readonly jl: number;
  readonly jyaw: number;
  // blocked handling
  private probeT: number;
  private blocked = false;
  private via: {x: number; z: number; y: number; s: number} | null = null;
  private viaArc = -Infinity;
  private path: Waypoint[] | null = null;
  private pathI = 0;
  /** Waiting for a queued regroup path (the director then thinks every frame: a queued ticket must be re-asked). */
  waitPath = false;
  regroupFails = 0;
  regroups = 0;
  private stuckT = 0;
  /** Animation LOD accumulator (s). */
  animAcc = 0;
  /** QA: largest slot error seen while formed (m), seconds spent formed with an error above 3 m. */
  maxErr = 0;
  farT = 0;

  constructor(readonly group: HordeGroup, readonly brain: ZombieBrain, readonly index: number, readonly k: number, seed: number) {
    let s = (seed ^ Math.imul(k + 1, 0x27d4eb2d)) | 0 || 1;
    s = xs(s); this.jr = ((s >>> 0) / 4294967296 - 0.5) * 2 * HORDE_AI.slotJitter;
    s = xs(s); this.jl = ((s >>> 0) / 4294967296 - 0.5) * 2 * HORDE_AI.slotJitter;
    s = xs(s); this.jyaw = ((s >>> 0) / 4294967296 - 0.5) * 0.9;
    this.probeT = (k * 0.071) % HORDE_AI.probeEvery;
  }

  get formed(): boolean {
    return !this.detached && this.brain.alive && this.brain.state === 'patrol';
  }

  /** On its way back to the formation by a regroup path (or waiting for one). */
  get regrouping(): boolean {
    return this.path !== null || this.waitPath;
  }

  /** Slot error (m, plan) of a formed member with a slot; Infinity on another storey. */
  slotErr(): number {
    if (!this.hasSlot) return 0;
    const b = this.brain;
    return Math.abs(b.y - this.sy) > 1.2 ? Infinity : Math.hypot(b.x - this.sx, b.z - this.sz);
  }

  /** PatrolLink: one 'patrol' frame (sight already checked by the brain). */
  steer(b: ZombieBrain, out: BrainOutput, dt: number, w: BrainWorld, moved: number): void {
    const G = this.group, A = HORDE_AI;
    out.speed = 0; out.dirX = out.dirZ = 0; out.anim = 'Idle';
    const stand = () => { out.speed = 0; out.anim = 'Idle'; out.face = G.heading + this.jyaw; };
    // stuck detection (walking but not moving) -> treat as blocked
    if (moved < 0.002 && b.speedCmd > 0) this.stuckT += dt; else this.stuckT = 0;
    // a regroup path in progress
    if (this.path || this.waitPath) {
      if (this.followPath(b, out, dt, w)) return;
    }
    let tx: number, tz: number, ty: number;
    if (this.hasSlot) { tx = this.sx; tz = this.sz; ty = this.sy; }
    else {
      // the column is still unspooling behind the anchor: hold (or close up on the trail tail when far)
      const t = G.tail();
      if (!t || Math.hypot(t.x - b.x, t.z - b.z) <= A.holdM) { stand(); return; }
      tx = t.x; tz = t.z; ty = t.y;
    }
    const sameStorey = Math.abs(ty - b.y) <= 1.2;
    const d = Math.hypot(tx - b.x, tz - b.z);
    if (sameStorey && d < A.arriveR) { this.via = null; this.viaArc = -Infinity; this.blocked = false; stand(); return; }
    // blocked probe (staggered): straight walk to the slot? else the nearest walkable trail crumb ahead; else a regroup path
    this.probeT -= dt;
    if (this.probeT <= 0 || this.stuckT > 1.2) {
      this.probeT = A.probeEvery;
      const st = this.stuckT > 1.2;
      this.stuckT = 0;
      this.blocked = st || !sameStorey || !w.walkClear(b.x, b.z, tx, tz, A.probeR, b.y, ty);
      if (this.blocked) {
        if (this.via && Math.hypot(this.via.x - b.x, this.via.z - b.z) < 0.6) this.viaArc = this.via.s + 1e-3; // reached: move on along the trail
        this.via = G.clearCrumb(b, this.viaArc, w, st ? this.via : null);
        if (!this.via && (d > A.regroupM || !sameStorey || st)) { this.startRegroup(b, tx, tz, ty, w); if (this.followPath(b, out, dt, w)) return; }
      } else { this.via = null; this.viaArc = -Infinity; }
    }
    if (this.blocked && this.via) { tx = this.via.x; tz = this.via.z; }
    else if (this.blocked && !this.via && !sameStorey) { stand(); return; }
    this.walkTo(b, out, tx, tz, d);
  }

  private walkTo(b: ZombieBrain, out: BrainOutput, tx: number, tz: number, slotD: number): void {
    const G = this.group, A = HORDE_AI;
    let dx = tx - b.x, dz = tz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) { out.face = G.heading + this.jyaw; return; }
    dx /= d; dz /= d;
    // soft separation from formed group mates (no clumping; the game's body push still applies)
    let sx = 0, sz = 0;
    for (const o of G.members) {
      if (o === this || !o.brain.alive || o.detached) continue;
      const ox = b.x - o.brain.x, oz = b.z - o.brain.z, od = Math.hypot(ox, oz);
      if (od > 1e-4 && od < 0.95 && Math.abs(o.brain.y - b.y) < 1) { const k = (0.95 - od) / 0.95; sx += ox / od * k; sz += oz / od * k; }
    }
    dx += sx * 0.8; dz += sz * 0.8;
    const n = Math.hypot(dx, dz) || 1;
    out.dirX = dx / n; out.dirZ = dz / n;
    out.face = Math.atan2(out.dirX, out.dirZ);
    const cap = b.stats.wanderSpeed * A.maxCatch;
    out.speed = Math.max(0.25, Math.min(cap, G.speedNow + A.catchK * Math.max(0, slotD - A.arriveR)));
    out.anim = 'Walk';
  }

  /** Ask for a regroup path (owner = this member: its own path-service ticket, separate from the brain's chase ticket). */
  private startRegroup(b: ZombieBrain, tx: number, tz: number, ty: number, w: BrainWorld): void {
    if (this.path) return;
    const p = w.findPath(b.x, b.z, tx, tz, {ay: b.y, by: ty, noLinks: true, defer: this});
    if (p === undefined) { this.waitPath = true; this.pending = [tx, tz, ty]; return; }
    this.waitPath = false;
    this.pending = null;
    if (!p || !p.length) {
      this.regroupFails++;
      if (this.regroupFails >= HORDE_AI.regroupFails) this.detach();
      return;
    }
    this.path = p; this.pathI = 0; this.regroups++;
  }
  private pending: [number, number, number] | null = null;

  /** Follow / wait for the regroup path. True = this frame's output is set. */
  private followPath(b: ZombieBrain, out: BrainOutput, dt: number, w: BrainWorld): boolean {
    if (this.waitPath && !this.path) {
      const q = this.pending;
      if (!q) { this.waitPath = false; return false; }
      this.waitPath = false;
      this.startRegroup(b, q[0], q[1], q[2], w); // re-ask (the service hands the queued result over when it is done)
      if (this.waitPath) { out.speed = 0; out.anim = 'Idle'; out.face = Math.atan2(q[0] - b.x, q[1] - b.z); return true; }
      if (!this.path) return false;
    }
    const p = this.path;
    if (!p) return false;
    while (this.pathI < p.length) {
      const wp = p[this.pathI];
      if (Math.hypot(wp[0] - b.x, wp[1] - b.z) < 0.4 && (wp[3] === undefined || Math.abs(wp[3] - b.y) < 1.2)) this.pathI++;
      else break;
    }
    // done, or back in the formation's reach: drop the path
    const slotNear = this.hasSlot && Math.abs(this.sy - b.y) <= 1.2 && Math.hypot(this.sx - b.x, this.sz - b.z) < HORDE_AI.regroupM * 0.5;
    if (this.pathI >= p.length || slotNear) { this.path = null; this.regroupFails = 0; return false; }
    const wp = p[this.pathI];
    this.walkTo(b, out, wp[0], wp[1], HORDE_AI.regroupM);
    void dt;
    return true;
  }

  /** Leave the group for good (an ordinary enemy from now on: the brain idles, then wanders as any other). */
  detach(): void {
    this.detached = true;
    this.path = null;
    this.waitPath = false;
    if (this.brain.escort === this) this.brain.escort = null;
  }

  /** The group re-ranked its members: this one's slot offset. */
  setSlot(k: number): void {
    this.slot = k;
    const [r, l] = slotOffset(k);
    this.row = r; this.lat = l;
  }
}

/** Patrol graph lookup (id -> node). */
type NodeMap = ReadonlyMap<number, MallPatrolNode>;

export class HordeGroup {
  readonly members: HordeMember[] = [];
  phase: HordePhase = 'pause';
  /** Anchor (the patrol intent): plan position, feet height; heading (yaw, model forward +z). */
  ax: number; az: number; ay: number;
  heading: number;
  /** Anchor speed this frame (m/s). */
  speedNow = 0;
  /** Patrol: current node, previous node, leg target; the leg's route. */
  node: number;
  prev = -1;
  target = -1;
  private route: Waypoint[] | null = null;
  private ri = 0;
  private waiting = false;
  pauseT: number;
  calmT = 0;
  stallT = 0;
  lag = 0;
  private validateT: number;
  private rnd: number;
  private readonly bad = new Map<string, number>();
  // trail ring buffer
  private readonly tx: Float64Array; private readonly tz: Float64Array; private readonly ty: Float64Array; private readonly ts: Float64Array;
  private th = -1;
  private tn = 0;
  /** QA counters. */
  legs = 0;
  badLegs = 0;
  stalls = 0;
  distance = 0;
  lastGroan = -Infinity;
  private lastAlive = -1;
  /** Seconds since start (director time). */
  t = 0;
  private skipDt = 0;
  readonly owner = {};

  constructor(readonly spec: HordeGroupSpec, readonly nodes: NodeMap, readonly levels: Levels, readonly rules: HordePatrolRules) {
    this.ax = spec.start.x; this.az = spec.start.z; this.ay = spec.start.y;
    this.node = spec.startNode;
    this.rnd = (spec.seed | 0) || 0x1234567;
    const n0 = nodes.get(spec.startNode);
    const nb = n0?.edges.map(e => nodes.get(e.to)).find(n => n && n.level === n0.level);
    this.heading = nb ? Math.atan2(nb.x - this.ax, nb.z - this.az) : 0;
    const N = HORDE_AI.trailCrumbs;
    this.tx = new Float64Array(N); this.tz = new Float64Array(N); this.ty = new Float64Array(N); this.ts = new Float64Array(N);
    this.pushCrumb(this.ax, this.az, this.ay, 0);
    this.pauseT = HORDE_AI.startPause[0] + this.rand() * (HORDE_AI.startPause[1] - HORDE_AI.startPause[0]);
    this.validateT = (spec.id * 0.37) % HORDE_AI.validateEvery;
  }

  private rand(): number {
    this.rnd = xs(this.rnd);
    return (this.rnd >>> 0) / 4294967296;
  }

  // --- trail ------------------------------------------------------------------------------------------------------------
  private pushCrumb(x: number, z: number, y: number, s: number): void {
    const N = HORDE_AI.trailCrumbs;
    this.th = (this.th + 1) % N;
    this.tx[this.th] = x; this.tz[this.th] = z; this.ty[this.th] = y; this.ts[this.th] = s;
    if (this.tn < N) this.tn++;
  }
  /** Arc length of the anchor itself (the newest crumb + the way since). */
  private headArc(): number {
    return this.ts[this.th] + Math.hypot(this.ax - this.tx[this.th], this.az - this.tz[this.th]);
  }
  /** Oldest crumb (the trail tail). */
  tail(): {x: number; z: number; y: number} | null {
    if (!this.tn) return null;
    const N = HORDE_AI.trailCrumbs, i = (this.th - this.tn + 1 + N) % N;
    return {x: this.tx[i], z: this.tz[i], y: this.ty[i]};
  }
  /**
   * The trail point `back` metres behind the anchor (+ the unit tangent there, pointing forward), or null when the trail is
   * shorter than that.
   */
  trailAt(back: number, out: {x: number; z: number; y: number; dx: number; dz: number}): boolean {
    const N = HORDE_AI.trailCrumbs;
    const s = this.headArc() - back;
    // from the anchor to the newest crumb
    let nx = this.ax, nz = this.az, ny = this.ay, ns = this.headArc();
    for (let k = 0; k < this.tn; k++) {
      const i = (this.th - k + N) % N;
      const cs = this.ts[i];
      if (cs <= s) {
        const seg = ns - cs, f = seg > 1e-6 ? (s - cs) / seg : 0;
        out.x = this.tx[i] + (nx - this.tx[i]) * f; out.z = this.tz[i] + (nz - this.tz[i]) * f; out.y = this.ty[i] + (ny - this.ty[i]) * f;
        let dx = nx - this.tx[i], dz = nz - this.tz[i];
        const dl = Math.hypot(dx, dz);
        if (dl < 1e-4) { dx = Math.sin(this.heading); dz = Math.cos(this.heading); } else { dx /= dl; dz /= dl; }
        out.dx = dx; out.dz = dz;
        return true;
      }
      nx = this.tx[i]; nz = this.tz[i]; ny = this.ty[i]; ns = cs;
    }
    if (back <= 1e-6) { out.x = this.ax; out.z = this.az; out.y = this.ay; out.dx = Math.sin(this.heading); out.dz = Math.cos(this.heading); return true; }
    return false;
  }
  /**
   * The nearest trail crumb within viaM of member brain `b`, ahead of trail arc `minArc`, that it can walk to in a straight line
   * (up to 4 walk tests), preferring the one closest to the anchor among equals; `not` = a crumb it just got stuck on.
   */
  clearCrumb(b: ZombieBrain, minArc: number, w: BrainWorld, not: {x: number; z: number} | null): {x: number; z: number; y: number; s: number} | null {
    const N = HORDE_AI.trailCrumbs, cand: {i: number; d: number}[] = [];
    for (let k = 0; k < this.tn; k++) {
      const i = (this.th - k + N) % N;
      if (this.ts[i] < minArc || Math.abs(this.ty[i] - b.y) > 1.2) continue;
      if (not && Math.hypot(this.tx[i] - not.x, this.tz[i] - not.z) < 0.3) continue;
      const d = Math.hypot(this.tx[i] - b.x, this.tz[i] - b.z);
      if (d <= HORDE_AI.viaM && d > 0.3) cand.push({i, d});
    }
    cand.sort((p, q) => p.d - q.d);
    for (let k = 0; k < Math.min(4, cand.length); k++) {
      const i = cand[k].i;
      if (w.walkClear(b.x, b.z, this.tx[i], this.tz[i], HORDE_AI.probeR, b.y, this.ty[i])) return {x: this.tx[i], z: this.tz[i], y: this.ty[i], s: this.ts[i]};
    }
    return null;
  }

  // --- patrol -----------------------------------------------------------------------------------------------------------
  /** Patrol node y (its storey floor at the node). */
  private nodeY(n: MallPatrolNode): number {
    const g = this.levels.grid(n.level), [cx, cy] = g.cellOf(n.x, n.z);
    return g.cellFloor(cx, cy);
  }
  private legKey(a: number, b: number): string {
    return `${a}>${b}`;
  }
  /**
   * Next patrol node from the current one: no immediate backtrack (unless a dead end). A VERTICAL choice (with `storeyChange`
   * whenever there is one) is an edge that changes storey OR leads to a run-mouth node (one with a storey-changing edge); having
   * chosen to head for a mouth, the group takes its run there (commit) instead of turning away at the escalator foot.
   */
  private chooseNext(): number {
    const n = this.nodes.get(this.node);
    if (!n) return -1;
    const ok = n.edges.filter(e => this.nodes.has(e.to) && (this.bad.get(this.legKey(this.node, e.to)) ?? -Infinity) <= this.t);
    if (!ok.length) { this.commit = false; return -1; }
    const fwd = ok.filter(e => e.to !== this.prev);
    const pool = fwd.length ? fwd : ok;
    const changes = (from: MallPatrolNode, e: {to: number; via?: string}) => this.nodes.get(e.to)?.level !== from.level || e.via === 'escalator' || e.via === 'stair' || e.via === 'service';
    const vertical = (e: {to: number; via?: string}) => changes(n, e);
    const leads = (e: {to: number; via?: string}) => { if (vertical(e)) return true; const m = this.nodes.get(e.to)!; return m.edges.some(f => changes(m, f)); };
    if (this.commit) {
      this.commit = false;
      const v = pool.filter(vertical);
      if (v.length) return v[Math.floor(this.rand() * v.length)].to;
    }
    const V = pool.filter(leads), S = pool.filter(e => !leads(e));
    const takeV = V.length > 0 && (!S.length || this.rand() < this.rules.storeyChange);
    const from = takeV ? V : S;
    const e = from[Math.floor(this.rand() * from.length)];
    if (takeV && !vertical(e)) this.commit = true; // heading for a run mouth: take the run when there
    return e.to;
  }
  /** Chose to head for a run mouth: take its storey-changing edge at the next choice. */
  private commit = false;
  private markBad(a: number, b: number): void {
    this.bad.set(this.legKey(a, b), this.t + HORDE_AI.legRetry);
    this.badLegs++;
  }
  /** Ask for the route of the current leg (one per group). */
  private requestLeg(w: BrainWorld): void {
    if (this.target < 0) {
      this.target = this.chooseNext();
      if (this.target < 0) { this.phase = 'pause'; this.pauseT = 3; this.prev = -1; return; }
    }
    const n = this.nodes.get(this.target)!;
    const by = this.nodeY(n);
    const r = w.findPath(this.ax, this.az, n.x, n.z, {ay: this.ay, by, noLinks: true, defer: this.owner});
    if (r === undefined) { this.waiting = true; return; }
    this.waiting = false;
    const straight = Math.hypot(n.x - this.ax, n.z - this.az, by - this.ay);
    let len = 0, px = this.ax, pz = this.az;
    for (const p of r ?? []) { len += Math.hypot(p[0] - px, p[1] - pz); px = p[0]; pz = p[1]; }
    const endOk = r && r.length > 0 && Math.hypot(px - n.x, pz - n.z) < 1.5 && Math.abs((r[r.length - 1][3] ?? by) - by) < 0.6;
    if (!r || !endOk || len > HORDE_AI.detour * straight + HORDE_AI.detourSlack) {
      this.markBad(this.node, this.target);
      this.target = -1;
      return;
    }
    this.route = r;
    this.ri = 0;
  }
  private arrive(): void {
    this.prev = this.node;
    this.node = this.target;
    this.target = -1;
    this.route = null;
    this.legs++;
    this.stallT = 0;
    if (this.rand() < this.rules.pauseChance) { this.phase = 'pause'; this.pauseT = this.rules.pause[0] + this.rand() * (this.rules.pause[1] - this.rules.pause[0]); }
  }
  /** The anchor's pace factor from the crowd's slot error (lag). */
  private pace(): number {
    const A = HORDE_AI;
    return this.lag <= A.lagOK ? 1 : this.lag >= A.lagStop ? 0 : 1 - (this.lag - A.lagOK) / (A.lagStop - A.lagOK);
  }
  /** `returning` = members still coming back (idle after a chase, or on a regroup path): waiting for them is no stall. */
  private moveAnchor(dt: number, w: BrainWorld, returning: number): void {
    if (!this.route) { this.requestLeg(w); if (!this.route) { this.speedNow = 0; return; } }
    const v = this.rules.speed * this.pace();
    this.speedNow = v;
    if (v <= 0) {
      if (!returning) this.stallT += dt;
      if (this.stallT > HORDE_AI.stallGiveUp) {
        // the crowd cannot follow this leg (blocked): avoid it for a while and turn back from here
        this.stalls++;
        this.markBad(this.node, this.target);
        const back = this.node;
        this.route = null;
        this.target = back;
        this.stallT = 0;
      }
      return;
    }
    this.stallT = 0;
    let step = v * dt;
    const ox = this.ax, oz = this.az;
    while (step > 0 && this.route) {
      const wp = this.route[this.ri];
      const dx = wp[0] - this.ax, dz = wp[1] - this.az, d = Math.hypot(dx, dz);
      if (d <= step) {
        this.ax = wp[0]; this.az = wp[1];
        step -= d;
        this.ri++;
        if (this.ri >= this.route.length) this.arrive();
      } else { this.ax += dx / d * step; this.az += dz / d * step; step = 0; }
    }
    this.ay = groundOf(this.levels, this.ax, this.az, this.ay);
    const mx = this.ax - ox, mz = this.az - oz, md = Math.hypot(mx, mz);
    if (md > 1e-5) {
      this.distance += md;
      // heading eases toward the walking direction (no snapping on a waypoint)
      const want = Math.atan2(mx, mz);
      let dh = want - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 3);
    }
    const lastS = this.ts[this.th];
    const sep = Math.hypot(this.ax - this.tx[this.th], this.az - this.tz[this.th]);
    if (sep >= HORDE_AI.trailStep || Math.abs(this.ay - this.ty[this.th]) > 0.25) this.pushCrumb(this.ax, this.az, this.ay, lastS + sep);
  }

  /** Re-rank the living formed members into slots (the leader = the first living member) when the roster changed. */
  private rerank(): void {
    let k = 0;
    for (const m of this.members) {
      if (!m.brain.alive || m.detached) { m.slot = -1; continue; }
      m.setSlot(k++);
    }
  }

  /** Slot positions (trail + validated sideways offset) and the crowd's lag. */
  private validate(w: BrainWorld): void {
    const A = HORDE_AI, P = {x: 0, z: 0, y: 0, dx: 0, dz: 0};
    const errs: number[] = [];
    for (const m of this.members) {
      if (m.slot < 0) { m.hasSlot = false; continue; }
      const back = m.row * A.rowSpacing + (m.row > 0 ? m.jr : 0);
      if (!this.trailAt(Math.max(0, back), P)) { m.hasSlot = false; continue; }
      // left normal of the forward tangent (dx, dz): (dz, -dx) is to the right in this frame; the sign is a convention
      const nx = P.dz, nz = -P.dx;
      const lat = m.lat * A.latSpacing + (m.row > 0 ? m.jl : 0);
      let placed = false;
      for (const f of lat === 0 ? [0] : [1, 0.5, 0]) {
        const x = P.x + nx * lat * f, z = P.z + nz * lat * f;
        if (f === 0 || w.walkClear(P.x, P.z, x, z, A.probeR, P.y, P.y)) { m.sx = x; m.sz = z; m.sy = P.y; placed = true; break; }
      }
      m.hasSlot = placed;
      if (m.formed && placed) {
        const e = m.slotErr();
        errs.push(e);
      }
    }
    errs.sort((a, b) => a - b);
    this.lag = errs.length ? errs[Math.min(errs.length - 1, Math.floor(errs.length * 0.8))] : 0;
    if (!Number.isFinite(this.lag)) this.lag = A.lagStop;
  }

  /** One frame (dt may be the sum of skipped far frames). */
  think(dt: number, w: BrainWorld): void {
    if (this.phase === 'dead') return;
    this.t += dt;
    let alive = 0, engaged = 0, returning = 0;
    for (const m of this.members) {
      if (!m.brain.alive || m.detached) continue;
      alive++;
      const s = m.brain.state;
      if (s !== 'patrol' && s !== 'idle' && s !== 'wander') engaged++;
      else if (s === 'wander') m.brain.joinPatrol(); // never wanders off on its own while in a group
      if (s === 'idle' || m.regrouping) returning++;
    }
    if (!alive) { this.phase = 'dead'; this.speedNow = 0; this.route = null; return; }
    if (alive !== this.lastAlive) { this.lastAlive = alive; this.rerank(); }
    if (engaged > 0) { this.phase = 'engaged'; this.calmT = 0; this.speedNow = 0; }
    else if (this.phase === 'engaged') { this.calmT += dt; if (this.calmT >= HORDE_AI.calmResume) this.phase = 'patrol'; }
    this.validateT -= dt;
    if (this.validateT <= 0) { this.validateT += HORDE_AI.validateEvery; if (this.validateT <= 0) this.validateT = HORDE_AI.validateEvery; this.validate(w); }
    if (this.phase === 'pause') {
      this.speedNow = 0;
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.phase = 'patrol';
    } else if (this.phase === 'patrol') this.moveAnchor(dt, w, returning);
    // QA cohesion metrics
    for (const m of this.members) {
      if (!m.formed || !m.hasSlot) continue;
      const e = m.slotErr();
      if (Number.isFinite(e)) { if (e > m.maxErr) m.maxErr = e; if (e > 3) m.farT += dt; }
    }
  }

  /** Waiting for a queued route (must ask every frame: no far-stride skipping then). */
  get busy(): boolean {
    return this.waiting || this.members.some(m => m.waitPath);
  }
  /** Far-stride bookkeeping: true = think now with the returned accumulated dt. */
  stride(dt: number, far: boolean, frame: number): number {
    this.skipDt += dt;
    if (far && !this.busy && (frame + this.spec.id) % HORDE_AI.farStride !== 0) return 0;
    const d = this.skipDt;
    this.skipDt = 0;
    return d;
  }
  /** QA: remaining route waypoints. */
  get routeLeft(): number {
    return this.route ? this.route.length - this.ri : 0;
  }
  get waitingRoute(): boolean {
    return this.waiting;
  }
}

/** The per-section horde director (game.ts). */
export class HordeDirector {
  readonly groups: HordeGroup[] = [];
  private readonly byBrain = new Map<ZombieBrain, HordeMember>();
  private frame = 0;
  time = 0;
  /** QA counters. */
  alertsCalled = 0;
  callsHeard = 0;
  groansAllowed = 0;
  groansDeferred = 0;
  thinks = 0;
  private readonly bases: number[];

  /**
   * `layout.hordes` + the patrol graph; `brainOf(i)` = the live brain of layout.zombies[i] (undefined: killed earlier in the run —
   * not spawned). Members are put into 'patrol' at once.
   */
  constructor(layout: StationLayout, readonly levels: Levels, brainOf: (index: number) => ZombieBrain | undefined, rules: HordePatrolRules = MALL_HORDE_RULES.patrol, patrol?: readonly MallPatrolNode[]) {
    const nodes = new Map<number, MallPatrolNode>((patrol ?? layout.mall?.patrol ?? []).map(n => [n.id, n]));
    this.bases = levels.list.map(l => l.baseY);
    for (const spec of layout.hordes ?? []) {
      const g = new HordeGroup(spec, nodes, levels, rules);
      spec.members.forEach((idx, k) => {
        const b = brainOf(idx);
        if (!b || !b.alive) return;
        const m = new HordeMember(g, b, idx, k, spec.seed);
        g.members.push(m);
        b.escort = m;
        b.joinPatrol();
        this.byBrain.set(b, m);
      });
      if (!g.members.length) g.phase = 'dead'; // every member was killed earlier in the run: the group stays dead
      this.groups.push(g);
    }
  }

  memberOf(b: ZombieBrain): HordeMember | undefined {
    return this.byBrain.get(b);
  }

  /** Once per frame before the brains think. `player` = feet position. */
  update(dt: number, w: BrainWorld, player: {x: number; y: number; z: number}): void {
    this.frame++;
    this.time += dt;
    for (const g of this.groups) {
      if (g.phase === 'dead') continue;
      const far = Math.hypot(g.ax - player.x, g.az - player.z, g.ay - player.y) > HORDE_AI.farM;
      const d = g.stride(dt, far, this.frame);
      if (d > 0) { g.think(d, w); this.thinks++; }
    }
  }

  /**
   * A member just became alerted (saw the player: its brain's `alerted`): group mates within alertCallM hear its call through the
   * existing hearing rule (distance x wall / slab muffle; brain.hear) — never the whole group, never another storey through slabs.
   */
  alerted(b: ZombieBrain): void {
    const m = this.byBrain.get(b);
    if (!m || m.detached) return;
    this.alertsCalled++;
    const R = HORDE_AI.alertCallM;
    for (const o of m.group.members) {
      const ob = o.brain;
      if (o === m || o.detached || !ob.alive || ob.state === 'chase' || ob.state === 'attack') continue;
      const d = Math.hypot(ob.x - b.x, ob.z - b.z, ob.y - b.y);
      if (d > R) continue;
      const los = this.levels.lineOfSight({x: b.x, y: b.y + 1.5, z: b.z}, {x: ob.x, y: ob.y + 1.5, z: ob.z});
      const r = R * hearingMuffle(los, slabsBetween(this.bases, b.y, ob.y));
      if (d > r) continue;
      ob.hear(b.x, b.z, r, b.y);
      this.callsHeard++;
    }
  }

  /**
   * Before a member's idle-vocal tick: at most one idle groan per group per vocalGap s (the Sfx's 3-voice vocal cap still
   * applies on top). A member about to groan while its group just groaned waits 1-3 s more (its own groan timer).
   */
  vocalGate(b: ZombieBrain, timer: {groanT: number}, dt: number, rand: () => number): void {
    const m = this.byBrain.get(b);
    if (!m || m.detached || !b.alive || timer.groanT - dt > 0) return;
    const g = m.group;
    if (this.time - g.lastGroan < HORDE_AI.vocalGap) { timer.groanT += 1 + rand() * 2; this.groansDeferred++; return; }
    g.lastGroan = this.time;
    this.groansAllowed++;
  }

  /**
   * Animation LOD of calm far members: the dt to animate with now (0 = skip this frame; the skipped time is applied on the
   * next animated frame). Everyone else: dt unchanged.
   */
  animStep(b: ZombieBrain, dt: number, dist: number): number {
    const m = this.byBrain.get(b);
    if (!m) return dt;
    const calm = b.alive && (b.state === 'patrol' || b.state === 'idle');
    if (!calm || dist <= HORDE_AI.animFarM) { const r = dt + m.animAcc; m.animAcc = 0; return r; }
    m.animAcc += dt;
    if ((this.frame + m.k) % HORDE_AI.animStride !== 0) return 0;
    const r = m.animAcc;
    m.animAcc = 0;
    return r;
  }

  /** QA / tests summary. */
  summary(player?: {x: number; y: number; z: number}) {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return this.groups.map(g => {
      const ms = g.members.map(m => {
        const b = m.brain;
        const role: HordeMemberStats['role'] = !b.alive ? 'dead' : m.detached ? 'detached' : b.state === 'patrol' ? (m.slot === 0 ? 'leader' : 'follower') : b.state === 'idle' ? 'returning' : 'engaged';
        return {index: m.index, state: b.state, slot: m.slot, slotErr: r2(m.formed && m.hasSlot ? m.slotErr() : -1), role, at: {x: r2(b.x), y: r2(b.y), z: r2(b.z)}, maxErr: r2(m.maxErr), farT: r2(m.farT), regroups: m.regroups};
      });
      const count = (role: string) => ms.filter(x => x.role === role).length;
      const lv = this.levels.levelAt(g.ax, g.az, g.ay + 0.05);
      return {
        id: g.spec.id, phase: g.phase, startLevel: g.spec.level, level: lv, anchor: {x: r2(g.ax), y: r2(g.ay), z: r2(g.az)}, heading: r2(g.heading),
        speed: r2(g.speedNow), node: g.node, target: g.target, prev: g.prev, routeLeft: g.routeLeft, waitingRoute: g.waitingRoute,
        lag: r2(g.lag), legs: g.legs, badLegs: g.badLegs, stalls: g.stalls, walked: r2(g.distance),
        initial: g.spec.members.length, alive: ms.filter(x => x.role !== 'dead').length, formed: count('leader') + count('follower'),
        engaged: count('engaged'), returning: count('returning'), detached: count('detached'), dead: count('dead'),
        playerDist: player ? r2(Math.hypot(g.ax - player.x, g.az - player.z, g.ay - player.y)) : undefined,
        members: ms,
      };
    });
  }
}
