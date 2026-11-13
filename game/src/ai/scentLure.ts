// Task studio-refinement-batch-20261113-035659-01 (lane LURE): the ZOMBIE LURE GRENADE's SCENT — the emitters and their perception.
//
//   User: "Zombie Lure Grenade: 3 bio_mater crafts 3. Scent reaches 20 metres without line-of-sight requirements for 20 active
//    seconds. Zombies investigate the ACTUAL emitter, not the player. Retain valid navigation/collision: no wall-phasing."
//
// The lead's item / throw / landed canister (weapons/throwables.ts) owns the canister's body and its own small effect; it calls this
// registry (Game.scents): add() when the canister lands, move() when it rolls / rides a lift cab, remove() when it goes. Nothing here
// draws, sounds or makes gas (the lure is harmless: no fog, no toxic-gas visuals).
//  * An emitter is ACTIVE for SCENT.seconds of PLAY: tick(dt) is called from Game.update, which never runs while paused, in menus
//    or loading, so only active seconds count. Expired / removed emitters leave the list at once; at most SCENT.max are active
//    (the throw refuses a 4th: `full`; add() past the cap retires the one with the least time left, a safety net for the bound).
//  * PERCEPTION (perceiveScent; ai/brain.ts calls it on the light-lure check timer, ~every 0.4 s per enemy, staggered): an enemy
//    smells an emitter when the straight 3D distance from its feet to the canister is within the emitter's radius (SCENT.radius
//    20 m). NO line of sight and NO field of view: walls, closed doors, floors and slabs do not stop it, so an enemy on another
//    storey inside that sphere is drawn too. Cost: O(emitters) per check, no rays, no scans.
//  * BEHAVIOUR (ai/brain.ts 'investigate' with LureState.kind 'scent'): the enemy walks to a standable point beside the canister
//    (lightLure.ts lureGoal on the canister's storey) with the normal level-aware path search (the path service may run a far one
//    in the background) and the normal motor / collision (ai/motor.ts) — never through a wall — at its search pace (wander x
//    SCENT.speedMult), stands around it while the scent lasts, then (scent spent / out of reach) walks on to it if still on the way,
//    lingers a few seconds and returns to its ordinary behaviour. The GOAL is the canister: the scent never touches the brain's
//    last known player position or awareness. An enemy with no route there (LURE.stuckGiveUp failed searches / stalls) gives up
//    and ignores that canister.
//  * PRIORITY: the player in sight always wins (the normal chase; no scent check in a frame it sees the player). An enemy that has
//    LOST sight of the player (a chase without sight for SCENT.lostSightS) is pulled too — the lure is how the player shakes
//    pursuers — unless a gunshot / hit reached it in the last SCENT.alertHoldS (it hunts that first). An active scent in reach
//    beats any light (flare / flashlight): the lure is the dedicated tool.
//  * FAMILIES: ordinary zombies (sprinters included), the coated, the rat/dog, the Strainer, the Blightbelly, horde members and an
//    AWAKE Siren are drawn (all run the base brain). A DORMANT / rising Siren never is (her dormant front end has no perception but
//    proximity / flashlight / damage, and the scent is no LightSource: it can never light or wake her). The SCREACHER is never drawn:
//    it reacts only to sound (user rule) and the scent is silent (ai/screacher.ts subWorld: scents undefined). Market people are not
//    enemies.

/** Lure tuning (see the file comment). */
export const SCENT = {
  /** Reach (m): straight 3D distance from an enemy's feet to the canister; nothing blocks it. */
  radius: 20,
  /** Active seconds of scent (play time only). */
  seconds: 20,
  /** At most this many emitters at once (the throw refuses beyond it). */
  max: 3,
  /** Investigation walk = the archetype's wander speed x this (= the search pace: shambler 0.91, coated 0.77, rat/dog 1.05 m/s; chase 2.55 / 1.75 / 4.4). */
  speedMult: 1.4,
  /** The scent being followed is sticky against a nearer one (score x this; lower wins). */
  stick: 0.8,
  /** A chasing enemy that has not seen the player for this long (s) is pulled (the chase's own give-up-and-search threshold). */
  lostSightS: 1.5,
  /** ...unless a gunshot was heard / a hit taken this recently (s): it hunts that first. */
  alertHoldS: 5,
  /** The scent no longer reaches it for this long (s): it ended, was removed or the canister moved out of reach. */
  lostGrace: 1.0,
  /** Height (m) over the canister for the standable-goal lookup (the flare's surface offset: a canister on the floor). */
  goalLift: 0.25,
} as const;

/** The cap the throw checks (SCENT.max). */
export const SCENT_MAX = SCENT.max;

export interface ScentEmitter {
  readonly id: number;
  /** Canister position (world metres, absolute y). */
  x: number; y: number; z: number;
  /** Storey index when known (QA; perception uses the 3D distance). */
  level?: number;
  /** Active seconds left. */
  left: number;
  active: boolean;
  /** Reach (m) and total active seconds this emitter started with. */
  readonly radius: number;
  readonly seconds: number;
}

export interface ScentSighting {
  emitter: ScentEmitter;
  /** Feet-to-canister distance (m). */
  dist: number;
  /** dist / radius (x SCENT.stick when tracked); lower wins. */
  score: number;
}

/**
 * The scent this observer (feet at y) smells most strongly now, or null: active emitters whose canister lies within their radius
 * (3D, nothing blocks it); `trackId` = the emitter it already follows (sticky); `ignore` = emitters it gave up on (no route).
 */
export function perceiveScent(o: {x: number; y: number; z: number}, scents: readonly ScentEmitter[], trackId: number | null = null,
  ignore: readonly number[] | null = null): ScentSighting | null {
  let best: ScentSighting | null = null;
  for (const e of scents) {
    if (!e.active || !(e.left > 0) || !(e.radius > 0) || ignore?.includes(e.id)) continue;
    const d = Math.hypot(e.x - o.x, e.y - o.y, e.z - o.z);
    if (!(d <= e.radius)) continue;
    const score = d / e.radius * (e.id === trackId ? SCENT.stick : 1);
    if (!best || score < best.score) best = {emitter: e, dist: d, score};
  }
  return best;
}

/** The registry of lure scents (Game.scents). Positions are written by the canister's owner; brains read `list` (active only). */
export class ScentLures {
  private nextId = 1;
  /** The ACTIVE emitters (expired / removed / cleared ones leave at once). */
  readonly list: ScentEmitter[] = [];
  /** QA counters: emitters started, run out, removed, retired by the cap, cleared by a teardown. */
  readonly counts = {added: 0, expired: 0, removed: 0, retired: 0, cleared: 0};

  /** Active emitters now. */
  get count(): number { return this.list.length; }
  /** At the cap: the throw refuses a new lure. */
  get full(): boolean { return this.list.length >= SCENT.max; }

  /** A canister landed: a new active emitter (past the cap the emitter with the least time left is retired first). */
  add(p: {x: number; y: number; z: number; level?: number}, opts: {radius?: number; seconds?: number} = {}): ScentEmitter {
    while (this.list.length >= SCENT.max) {
      let k = 0;
      for (let i = 1; i < this.list.length; i++) if (this.list[i].left < this.list[k].left) k = i;
      const [old] = this.list.splice(k, 1);
      old.active = false; old.left = 0;
      this.counts.retired++;
    }
    const radius = opts.radius ?? SCENT.radius, seconds = opts.seconds ?? SCENT.seconds;
    const e: ScentEmitter = {id: this.nextId++, x: p.x, y: p.y, z: p.z, ...(p.level !== undefined ? {level: p.level} : {}),
      left: Math.max(0, seconds), active: seconds > 0 && radius > 0, radius, seconds};
    if (e.active) { this.list.push(e); this.counts.added++; }
    return e;
  }

  /** The canister moved (rolled, rides a lift cab): the scent comes from where it is now. */
  move(e: ScentEmitter, p: {x: number; y: number; z: number; level?: number}): void {
    e.x = p.x; e.y = p.y; e.z = p.z;
    if (p.level !== undefined) e.level = p.level;
  }

  /** The canister is gone (picked up / destroyed): its scent ends now. */
  remove(e: ScentEmitter): void {
    const i = this.list.indexOf(e);
    e.active = false;
    if (i >= 0) { this.list.splice(i, 1); this.counts.removed++; }
  }

  /** Counts ACTIVE seconds only (Game.update: never while paused / in menus / loading); a spent emitter leaves the list. */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.left = Math.max(0, e.left - dt);
      if (e.left <= 0) { e.active = false; this.list.splice(i, 1); this.counts.expired++; }
    }
  }

  /** Station teardown / Retry / new game: every scent ends. */
  clear(): void {
    for (const e of this.list) e.active = false;
    this.counts.cleared += this.list.length;
    this.list.length = 0;
  }

  /** QA snapshot: the active emitters, the cap, the counters and the tuning. */
  qa(): {cap: number; count: number; full: boolean; emitters: {id: number; x: number; y: number; z: number; level: number | null; left: number; radius: number; seconds: number}[]; counts: ScentLures['counts']; tuning: typeof SCENT} {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {cap: SCENT.max, count: this.list.length, full: this.full,
      emitters: this.list.map(e => ({id: e.id, x: r2(e.x), y: r2(e.y), z: r2(e.z), level: e.level ?? null, left: r2(e.left), radius: e.radius, seconds: e.seconds})),
      counts: {...this.counts}, tuning: SCENT};
  }
}
