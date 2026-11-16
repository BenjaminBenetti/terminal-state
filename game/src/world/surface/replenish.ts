// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): SURFACE RUN's OUTDOOR REPLENISHER — pure logic (no three.js, no DOM,
// no Game import; world/surface/replenishRuntime.ts is the Game adapter). User: "Outdoor zombies replenish indefinitely within a bounded
// active population, spawning sensibly away/off-camera with sector/pause cleanup. Prevent unbounded actors, corpses, loot or save growth.
// Interior enemies retain normal permanent kills and do not respawn. Keep these systems distinct; do not change global enemy respawning."
//
// TWO SYSTEMS, KEPT DISTINCT:
//  - INTERIOR enemies are the district layout's ordinary `layout.zombies` (lane ROOMS places them): spawned by the section build with their
//    layout index, killed for good (the section's kill memory, mem.killed), never respawned — this module never touches them.
//  - OUTDOOR enemies are this replenisher's: runtime actors with NO layout index (Game.enemyIndex never holds them, so mem.killed / the
//    corpse system / the hordes never see them), excluded from the section's alive / clear / HUD counts (Game.uncountedEnemies), never
//    saved (nothing of them is written to the run: the save stays the same size however long the player stays), dropping nothing (no
//    zombie drops loot in this game: the kill path only ragdolls the body). Nothing else in the game respawns: global enemy respawning is
//    unchanged (there is none).
//
// THE RULES (REPLENISH, one place):
//  - POPULATION: at most `cap` living outdoor actors at once (18); a fresh district starts with `initial` of them (placed by the section
//    build, before the warm-up compiles their programs); afterwards at most one spawn per `tickS` (two while fewer than half the cap
//    live), so a kill is replenished within seconds, indefinitely, never above the cap.
//  - WHERE: a candidate is drawn in the ANNULUS `spawnMin`..`spawnMax` m around the player (35-80 m, area-uniform), and kept only when it
//    is (a) inside one of the layout's outdoor spawn zones (surface.outdoor.spawnZones; none listed = anywhere outdoors), (b) outside
//    the safe box (surface.outdoor.safe: the checkpoint / portal), (c) a standable OUTDOOR street cell (level 0, an outdoor area, a clear
//    body circle: no wall, building, blocking prop — host.standable) outside every building footprint, (d) clear of the truck, and (e)
//    OFF-CAMERA: outside the view cone of the player's eye AND without a line of sight from the eye to its head or chest.
//  - DESPAWN: a living outdoor actor farther than `despawnM` (110 m) that the player has not seen for `unseenS` (3 s) is removed (it never
//    vanishes in view); beyond `hardM` (220 m) it goes whatever (the fog hides that far).
//  - CORPSES: an outdoor kill's body lies as any corpse; outdoor bodies are retired when unseen and farther than `corpseFarM`, the oldest
//    UNSEEN ones beyond `corpseSoft` bodies, and the oldest at all beyond `corpseHard` (the bound: never more than cap + corpseHard
//    outdoor actors exist). Retiring = the actor leaves the AI list, physics (its ragdoll / frozen record), the damage bookkeeping, the
//    scene and its GPU materials (host.remove). A body still burning is kept until the fire is out (host.removable). Interior kills'
//    bodies are never touched.
//  - WHEN: only while host.active() (the game is playing: never paused, in a menu, the planning map, loading or warming up; the frame
//    hooks that call tick() run only in play anyway). Underground there is no district: nothing of this exists (the section teardown).
//  - RNG: every draw is the replenisher's OWN stream (seeded from the district seed and the visit): the station's seeded streams
//    (Game.rand: the build's spawn / pickup draws) never move.
//  - FAMILIES: the host level's own spawn table (ai/spawnTables.ts) as an outdoor 'street' context would read it: the level pool (or its
//    'street' context's own pool), opt-in / eligibility-ruled families whose rule does not admit 'street' fall back to their fallback
//    (the Office / Mall Siren -> a zombie), roster-only and context-locked families never (Screacher, BB, Strainer). No new family.

import type {ZombieSpawn, ZombieType} from '../../gen/stationTypes';
import type {SRect, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import type {EnemyArchetypeId} from '../../ai/creatureSpawn';
import {CONTEXT_LOCKED_FAMILIES, ROSTER_ONLY_FAMILIES, spawnProfile, type EnemyFamilyId, type FamilyPool} from '../../ai/spawnTables';
import {hashString, mulberry32} from '../../core/rng';

/** The replenisher's tuning (one place; tests read it). */
export const REPLENISH = {
  /** Living outdoor actors at most (the bounded active population). */
  cap: 18,
  /** Placed by the section build (before the warm-up). */
  initial: 8,
  /** Spawn annulus around the player (m). */
  spawnMin: 35,
  spawnMax: 80,
  /** Seconds between spawn rounds; candidates tried per spawn. */
  tickS: 1,
  tries: 24,
  /** A living outdoor actor this far (m) and unseen this long (s) is removed; beyond hardM always. */
  despawnM: 110,
  unseenS: 3,
  hardM: 220,
  /** Outdoor bodies: retired when unseen beyond corpseFarM (m); oldest unseen beyond corpseSoft; oldest at all beyond corpseHard. */
  corpseFarM: 80,
  corpseSoft: 6,
  corpseHard: 10,
  /** Body radius kept clear at a spawn (m) and the truck's extra keep-off (m). */
  clearR: 0.6,
  truckKeepM: 3,
  /** Visibility: the view cone's extra margin (rad) beyond the camera's half-angles; head / chest heights (m above the floor). */
  coneMargin: 0.2,
  headY: 1.6,
  chestY: 1.0,
  /** The look index of an outdoor actor (chooseSpawnLook(seed, index)): far beyond any layout index. */
  indexBase: 1_000_000,
} as const;

export interface P3 { x: number; y: number; z: number }

/** The eye this frame: position, unit view direction, the cone's half-angles (rad: vertical, horizontal). */
export interface Viewer { x: number; y: number; z: number; dx: number; dy: number; dz: number; halfV: number; halfH: number }

/** The view of a player pose (yaw / pitch in the camera convention: forward = (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch)). */
export function viewerOf(eye: P3, yaw: number, pitch: number, vfovDeg: number, aspect: number): Viewer {
  const cp = Math.cos(pitch), halfV = (vfovDeg * Math.PI / 180) / 2;
  return {x: eye.x, y: eye.y, z: eye.z, dx: -Math.sin(yaw) * cp, dy: Math.sin(pitch), dz: -Math.cos(yaw) * cp, halfV, halfH: Math.atan(Math.tan(halfV) * Math.max(0.1, aspect))};
}

/**
 * Is `p` inside the viewer's view cone (the camera frustum's angular extent + `margin`, no far plane: a lane may push the camera's far
 * plane out for the city)? Conservative: a point near the frustum edge counts as in view.
 */
export function inViewCone(v: Viewer, p: P3, margin: number = REPLENISH.coneMargin): boolean {
  const ox = p.x - v.x, oy = p.y - v.y, oz = p.z - v.z;
  const d = Math.hypot(ox, oy, oz);
  if (d < 1e-6) return true;
  const fwd = (ox * v.dx + oy * v.dy + oz * v.dz);
  if (fwd <= 0) return false; // behind the eye
  // right / up axes of the view (right = forward x world up, normalised; up = right x forward): the frustum's rectangular pyramid
  let rx = -v.dz, rz = v.dx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = -rz * v.dy, uy = rz * v.dx - rx * v.dz, uz = rx * v.dy;
  const side = ox * rx + oz * rz, up = ox * ux + oy * uy + oz * uz;
  return Math.abs(Math.atan2(side, fwd)) <= v.halfH + margin && Math.abs(Math.atan2(up, fwd)) <= v.halfV + margin;
}

/** The minimal actor the replenisher tracks (an EnemyActor in the game). */
export interface ReplenishActor { brain: {x: number; y: number; z: number; alive: boolean} }

/** A standable outdoor street point (host.standable). */
export interface Standable { floor: number; area: number }

export interface ReplenishHost<A extends ReplenishActor> {
  /** Spawn an outdoor actor from `spawn` (no layout index; `index` only picks its look) on the replenisher's `rand`; null = refused. */
  spawn(spawn: ZombieSpawn, index: number, rand: () => number): A | null;
  /** Remove the actor from the world for good (live or dead): AI list, physics, damage bookkeeping, scene, GPU. */
  remove(actor: A): void;
  /** May it be removed now (false: e.g. still burning)? Absent = always. */
  removable?(actor: A): boolean;
  /** The player's eye and view this frame. */
  viewer(): Viewer;
  /** 3D line of sight (walls, slabs, sight-blocking props). */
  lineOfSight(a: P3, b: P3): boolean;
  /** A standable OUTDOOR street point at (x, z) (level 0, an outdoor area, a clear body circle), else null. */
  standable(x: number, z: number, r: number): Standable | null;
  /** The truck's keep-out circle this frame (null: no truck). */
  truck(): {x: number; z: number; r: number} | null;
  /** May anything spawn / be retired now (playing; no menu / map / loading / warm-up)? */
  active(): boolean;
}

/** Where outdoor actors may appear (the layout's outdoor rules). */
export interface OutdoorRules {
  zones: readonly (SRect & {weight: number})[];
  safe: SRect | null;
  /** Building footprints (never spawn inside one, whatever the grid says). */
  footprints: readonly SRect[];
  /** The playable boundary (the 8 x 8 footprint). */
  extent: SRect;
}

export function outdoorRulesOf(s: SurfaceInfo): OutdoorRules {
  return {zones: s.outdoor.spawnZones.filter(z => z.weight > 0 && z.x1 > z.x0 && z.z1 > z.z0), safe: s.outdoor.safe ?? null, footprints: s.buildings.map(b => b.footprint), extent: s.extent};
}

const inRect = (r: SRect, x: number, z: number, pad = 0): boolean => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

/**
 * The host level's family pool for OUTDOOR spawns (see the header): the 'street' context's own pool when the profile has one, else the
 * level pool; a family whose eligibility rule does not admit the 'street' context hands its weight to its fallback; roster-only and
 * context-locked families get 0. Same roll order (ENEMY_FAMILY_IDS) as every pool.
 */
export function outdoorFamilyPool(host: 'subway' | 'office' | 'mall'): FamilyPool {
  const p = spawnProfile(host);
  const base = p.contexts.street?.families ?? p.families;
  const w = new Map<EnemyFamilyId, number>(base.map(([f, x]) => [f, Math.max(0, x)]));
  for (const [f] of base) {
    const rule = p.eligibility?.[f];
    const banned = ROSTER_ONLY_FAMILIES.includes(f) || !!CONTEXT_LOCKED_FAMILIES[f] || (rule && !rule.contexts.includes('street'));
    if (!banned) continue;
    const x = w.get(f) ?? 0;
    w.set(f, 0);
    const to = rule?.fallback ?? 'zombie';
    if (x > 0 && to !== f) w.set(to, (w.get(to) ?? 0) + x);
  }
  return base.map(([f]) => [f, w.get(f) ?? 0] as const);
}

/** One family from `pool` on `rand` (the pool's roll order; never a weight-0 family). */
export function pickFamily(pool: FamilyPool, rand: () => number): EnemyFamilyId {
  let total = 0;
  for (const [, x] of pool) total += x;
  let r = rand() * total;
  for (const [f, x] of pool) { if (x <= 0) continue; r -= x; if (r < 0) return f; }
  for (let k = pool.length - 1; k >= 0; k--) if (pool[k][1] > 0) return pool[k][0];
  return 'zombie';
}

interface Tracked<A> { actor: A; serial: number; seenAt: number; diedAt: number }

/** Counters (QA / tests). */
export interface ReplenishCounts { spawned: number; initial: number; despawned: number; retired: number; refused: number; tries: number; rejected: Record<string, number> }

export class OutdoorReplenisher<A extends ReplenishActor> {
  readonly rules: OutdoorRules;
  readonly pool: FamilyPool;
  readonly coated: number;
  private readonly rand: () => number;
  private readonly live: Tracked<A>[] = [];
  private readonly dead: Tracked<A>[] = [];
  private clock = 0;
  private due = 0;
  private serial = 0;
  readonly counts: ReplenishCounts = {spawned: 0, initial: 0, despawned: 0, retired: 0, refused: 0, tries: 0, rejected: {}};
  /** Families the host can build now (a lazily loaded model missing -> that family becomes an ordinary zombie). */
  familyReady: (f: EnemyFamilyId) => boolean = () => true;

  /**
   * `seed` = the district seed, `visit` = the district memory's visit count: the replenisher's own stream (never a station stream);
   * `pool` = the outdoor family pool (outdoorFamilyPool), `coatedChance` = the level's zombie-type rule.
   */
  constructor(readonly host: ReplenishHost<A>, rules: OutdoorRules, o: {seed: number; visit: number; pool: FamilyPool; coatedChance: number}) {
    this.rules = rules;
    this.pool = o.pool;
    this.coated = o.coatedChance;
    this.rand = mulberry32(hashString(`surface-replenish:${o.visit >>> 0}`, o.seed >>> 0));
  }

  /** Living outdoor actors (tracked). */
  get alive(): number { return this.live.length; }
  /** Outdoor bodies lying in the world. */
  get corpses(): number { return this.dead.length; }
  /** Every outdoor actor in the world (living + bodies). */
  actors(): A[] { return [...this.live.map(t => t.actor), ...this.dead.map(t => t.actor)]; }
  /** Is `a` one of this replenisher's (living or dead)? */
  owns(a: A): boolean { return this.live.some(t => t.actor === a) || this.dead.some(t => t.actor === a); }

  /** The section build (before the warm-up): the initial outdoor population around the arrival. Returns how many were placed. */
  seed(n: number = REPLENISH.initial): number {
    let placed = 0;
    for (let k = 0; k < n && this.live.length < REPLENISH.cap; k++) if (this.trySpawn(REPLENISH.tries * 2)) { placed++; this.counts.initial++; }
    return placed;
  }

  /** One frame of play (`dt` s). Inert unless host.active(). */
  tick(dt: number): void {
    if (!this.host.active()) return;
    this.clock += dt;
    const v = this.host.viewer();
    this.sweepLive(v);
    this.sweepDead(v);
    if (this.clock < this.due) return;
    this.due = this.clock + REPLENISH.tickS;
    const want = this.live.length < REPLENISH.cap / 2 ? 2 : 1;
    for (let k = 0; k < want && this.live.length < REPLENISH.cap; k++) this.trySpawn(REPLENISH.tries);
  }

  /** The section teardown: forget everything (the Game's teardown removes every actor of the world itself). */
  reset(): void {
    this.live.length = 0;
    this.dead.length = 0;
  }

  /** Is `p` (feet at floor y) seen from `v` (in the view cone and in a line of sight to its head or chest)? */
  seen(v: Viewer, x: number, y: number, z: number): boolean {
    const head = {x, y: y + REPLENISH.headY, z}, chest = {x, y: y + REPLENISH.chestY, z};
    if (!inViewCone(v, head) && !inViewCone(v, chest) && !inViewCone(v, {x, y, z})) return false;
    return this.host.lineOfSight(v, head) || this.host.lineOfSight(v, chest);
  }

  /**
   * Is (x, z) a legal outdoor spawn now (every rule of the header but the actor itself)? Returns the reason it is not, or the standable
   * point. Exposed for tests / QA.
   */
  check(v: Viewer, x: number, z: number): {ok: true; at: Standable} | {ok: false; why: string} {
    const R = this.rules, d = Math.hypot(x - v.x, z - v.z);
    if (d < REPLENISH.spawnMin || d > REPLENISH.spawnMax) return {ok: false, why: 'distance'};
    if (!inRect(R.extent, x, z, -1)) return {ok: false, why: 'extent'};
    if (R.zones.length && !R.zones.some(r => inRect(r, x, z))) return {ok: false, why: 'zone'};
    if (R.safe && inRect(R.safe, x, z, REPLENISH.clearR)) return {ok: false, why: 'safe'};
    if (R.footprints.some(r => inRect(r, x, z, REPLENISH.clearR))) return {ok: false, why: 'building'};
    const t = this.host.truck();
    if (t && Math.hypot(x - t.x, z - t.z) < t.r + REPLENISH.truckKeepM) return {ok: false, why: 'truck'};
    const at = this.host.standable(x, z, REPLENISH.clearR);
    if (!at) return {ok: false, why: 'standable'};
    // off-camera: outside the view cone AND no line of sight (both: a point behind the player in an open street is still refused)
    const head = {x, y: at.floor + REPLENISH.headY, z}, chest = {x, y: at.floor + REPLENISH.chestY, z}, feet = {x, y: at.floor, z};
    if (inViewCone(v, head) || inViewCone(v, chest) || inViewCone(v, feet)) return {ok: false, why: 'in-view'};
    if (this.host.lineOfSight(v, head) || this.host.lineOfSight(v, chest)) return {ok: false, why: 'line-of-sight'};
    return {ok: true, at};
  }

  private trySpawn(tries: number): boolean {
    const v = this.host.viewer(), r = this.rand;
    for (let k = 0; k < tries; k++) {
      this.counts.tries++;
      // area-uniform in the annulus
      const a = r() * Math.PI * 2, m0 = REPLENISH.spawnMin ** 2, m1 = REPLENISH.spawnMax ** 2, d = Math.sqrt(m0 + r() * (m1 - m0));
      const x = v.x - Math.sin(a) * d, z = v.z - Math.cos(a) * d;
      const c = this.check(v, x, z);
      if (!c.ok) { this.counts.rejected[c.why] = (this.counts.rejected[c.why] ?? 0) + 1; continue; }
      let fam = pickFamily(this.pool, r);
      if (fam !== 'zombie' && !this.familyReady(fam)) fam = 'zombie';
      const type: ZombieType = r() < this.coated ? 'coated' : 'shambler';
      const spawn: ZombieSpawn = {x, z, yaw: r() * Math.PI * 2, type, area: c.at.area, level: 0, y: c.at.floor};
      if (fam !== 'zombie') spawn.archetype = fam as EnemyArchetypeId;
      const serial = this.serial++;
      const actor = this.host.spawn(spawn, REPLENISH.indexBase + serial, r);
      if (!actor) { this.counts.refused++; return false; }
      this.live.push({actor, serial, seenAt: this.clock, diedAt: -1});
      this.counts.spawned++;
      return true;
    }
    return false;
  }

  private sweepLive(v: Viewer): void {
    for (let k = this.live.length - 1; k >= 0; k--) {
      const t = this.live[k], b = t.actor.brain;
      if (!b.alive) { this.live.splice(k, 1); t.diedAt = this.clock; this.dead.push(t); continue; }
      const d = Math.hypot(b.x - v.x, b.z - v.z);
      if (d <= REPLENISH.despawnM) { t.seenAt = this.clock; continue; } // near: never despawned (its "unseen" clock starts beyond the band)
      if (d <= REPLENISH.hardM && this.seen(v, b.x, b.y, b.z)) { t.seenAt = this.clock; continue; }
      if (d <= REPLENISH.hardM && this.clock - t.seenAt < REPLENISH.unseenS) continue;
      if (this.host.removable && !this.host.removable(t.actor)) continue;
      this.live.splice(k, 1);
      this.host.remove(t.actor);
      this.counts.despawned++;
    }
  }

  private sweepDead(v: Viewer): void {
    const D = this.dead;
    const can = (t: Tracked<A>) => !this.host.removable || this.host.removable(t.actor);
    const retire = (t: Tracked<A>) => { D.splice(D.indexOf(t), 1); this.host.remove(t.actor); this.counts.retired++; };
    // far and unseen
    for (const t of [...D]) {
      const b = t.actor.brain;
      if (Math.hypot(b.x - v.x, b.z - v.z) > REPLENISH.corpseFarM && can(t) && !this.seen(v, b.x, b.y, b.z)) retire(t);
    }
    // beyond the soft count: the oldest unseen first
    if (D.length > REPLENISH.corpseSoft) {
      const old = [...D].sort((a, b) => a.diedAt - b.diedAt);
      for (const t of old) {
        if (D.length <= REPLENISH.corpseSoft) break;
        const b = t.actor.brain;
        if (can(t) && !this.seen(v, b.x, b.y, b.z)) retire(t);
      }
    }
    // beyond the hard count: the oldest whatever
    if (D.length > REPLENISH.corpseHard) {
      const old = [...D].sort((a, b) => a.diedAt - b.diedAt);
      for (const t of old) { if (D.length <= REPLENISH.corpseHard) break; if (can(t)) retire(t); }
    }
  }

  /** QA: a compact report. */
  qa(): Record<string, unknown> {
    const v = this.host.viewer();
    return {
      alive: this.live.length, corpses: this.dead.length, cap: REPLENISH.cap, corpseHard: REPLENISH.corpseHard, counts: {...this.counts, rejected: {...this.counts.rejected}},
      nearest: this.live.map(t => Math.round(Math.hypot(t.actor.brain.x - v.x, t.actor.brain.z - v.z))).sort((a, b) => a - b).slice(0, 6),
      pool: this.pool.filter(([, w]) => w > 0).map(([f, w]) => `${f} ${w}`),
    };
  }
}
