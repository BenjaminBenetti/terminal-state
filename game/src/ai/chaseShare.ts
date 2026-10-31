// Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): chase-search relief for OPEN-ATRIUM levels (the mall: a layout with
// `mall`). Gated: the game turns these on only for such a layout (BrainWorld.atrium, the path service's atrium options, a
// ChaseShare instance); the Subway and Office Space never see any of it.
//
// The problem (measured on the generated mall, lanes/HORDE.done appendix): in the open atrium enemies SEE the player across / down
// the void from other storeys. A seen player's chase re-plan was always a synchronous A* (ai/brain.ts), and the route from a ring
// gallery down to the pit runs round the void and down the escalators — a 9-10 k expansion, ~80 ms search, repeated every ~0.5-1.3 s
// by every enemy in view, and clusters of chasers re-planning in one frame (18 searches ≈ 74 ms).
//
// The relief (each part keeps near / same-storey AI exactly as immediate as before):
//  1. CROSS-STOREY SIGHTED RE-PLANS ARE DEFERRABLE (brain.ts): a seen player whose feet are more than `dy` above / below is offered
//     to the path service's deferral like an unseen chase re-plan. The service still answers at once when the enemy is NEAR: in the
//     atrium the near rule across storeys (atriumNearRule) needs <= 4 m straight or a KNOWN route <= 16 m by the vocal-reach field —
//     an unknown route is not near, unlike the straight-line fallback of nearPlayerRule (that fallback still holds on the player's
//     own storey); a far one runs as background chunks
//     (the same resumable search, max staleness 250 ms) while the enemy keeps facing / following its current route. Its finished
//     route is handed over within `seenGoalSlack` m of the moving player (a seen player moves: the default 1.5 m would re-issue it
//     forever) — the next re-plan corrects the end.
//  2. RE-PLAN THROTTLE (brain.ts): a chase re-plan whose goal moved less than `moved` m since the route was planned (accumulated:
//     measured from the planned goal), with a route still to follow and the goal farther than `nearM`, keeps the route and checks
//     again `recheck` s later — at most `holdMax` s without a re-plan. Close quarters (<= nearM) re-plan exactly as before.
//  3. SHARED ROUTES (ChaseShare): a chase search (drops allowed) may join a route found < `shareS` s ago from <= `shareStartM` m of its
//     start (same storey) to <= `shareGoalM` m of its goal (same storey, same ladder rule), entering it at one of its first 3
//     waypoints by a straight walk test — the chasers converging on the player share one search. Still answered at once.
//  4. PER-FRAME CAP (path service): at most `syncCap` synchronous chase searches per frame; a further deferrable request that is not
//     critical (>= 4 m straight from the player) is held to the next frame (the enemy asks again every frame; held at most `maxWait`
//     frames = 0.1 s, then it runs) — a burst is spread over a few frames, never dropped. Critical (< 4 m) requests and requests that cannot be
//     deferred (a seen player on the enemy's own storey, wander / search / light paths) are never held.
//  5. LOCAL TARGETS (brain.ts localPath / localOpts + the game's find): a wander / search spot a few metres away that the body can walk
//     to in a straight line takes no search at all (one walk test); otherwise a route needing more than `localExpand` expansions (a
//     detour round a wall / shopfront / the void, or unreachable: measured 3-10 ms of string pulling, up to 26000 nodes when it
//     fails) fails fast — the enemy idles and picks another spot later, as after any failed wander search.

import type {Waypoint} from '../gen/grid';
import type {Levels} from '../gen/levels';
import {nearPlayerRule, nearSeenRule, type PathAtrium} from './pathService';

export const ATRIUM_CHASE = {
  /** A seen player this far (m, feet heights) above / below the enemy is on another storey: the re-plan may be deferred. */
  dy: 1.5,
  /** Re-plan throttle: goal moved less than this (m) since the planned route; recheck period (s); never longer than holdMax (s). */
  moved: 1.0,
  recheck: 0.5,
  holdMax: 2.0,
  /** No throttle within this distance (m) of the goal (close quarters re-plan as before). */
  nearM: 6,
  /**
   * Per-frame synchronous chase searches; frames a held request may wait before it runs regardless (6 = 0.1 s: a burst of N
   * deferrable chasers is served syncCap per frame in ask order — held enemies re-ask first — rather than all together).
   */
  syncCap: 4,
  maxWait: 6,
  /** Hand-over slack (m) of a deferred SEEN re-plan's goal (the player moves while it is searched). */
  seenGoalSlack: 4,
  /** Shared routes: freshness (s), start / goal match (m), routes kept level-wide. */
  shareS: 0.75,
  shareStartM: 5,
  shareGoalM: 1.5,
  shareKeep: 8,
  /** Body radius of the join walk test (m). */
  probeR: 0.3,
  /**
   * Part 5: expansion bound of a LOCAL search (brain wander / search targets within ~6 m that are not straight-walkable; `local:
   * true`) — the game's search otherwise allows 26000. A plain local route expands a few hundred nodes.
   */
  localExpand: 1200,
} as const;

/** The game's path search expansion bound for a request (26000 as always; ATRIUM_CHASE.localExpand for a `local` one). */
export function searchExpand(o: object | undefined): number {
  return (o as {local?: boolean} | undefined)?.local ? ATRIUM_CHASE.localExpand : 26000;
}

/**
 * The path service's atrium options (pathService.ts): `critical` = within 4 m straight of the player (never held); `near` = the
 * atrium near rule (atriumNearRule over the game's vocal-reach route field).
 */
export function atriumPathOptions(critical: (x: number, z: number, y: number | undefined) => boolean, near: (x: number, z: number, y: number | undefined) => boolean): PathAtrium {
  return {syncCap: ATRIUM_CHASE.syncCap, maxWait: ATRIUM_CHASE.maxWait, seenGoalSlack: ATRIUM_CHASE.seenGoalSlack, critical, near};
}

/**
 * The near rule of a deferrable path request in an atrium level: `d` = 3D straight distance to the player, `dy` = feet height
 * difference, `route` = the navigable route from the player (null: no route field). On the player's storey (|dy| <= ATRIUM_CHASE.dy)
 * the ordinary nearPlayerRule; across storeys nearSeenRule — no straight-line fallback (across the void a few metres in a line is
 * often 50-100 m by the escalators).
 */
export function atriumNearRule(d: number, dy: number, route: () => number | null): boolean {
  return Math.abs(dy) > ATRIUM_CHASE.dy ? nearSeenRule(d, route) : nearPlayerRule(d, route);
}

type ChaseOpts = {drops?: boolean; noLinks?: boolean; ay?: number; by?: number} | undefined;

interface SharedRoute { t: number; ax: number; az: number; ay: number; bx: number; bz: number; by: number; noLinks: boolean; path: Waypoint[] }

/** Level-wide recent chase routes (part 3). One per built section (game.ts), for open-atrium layouts only. */
export class ChaseShare {
  private readonly routes: SharedRoute[] = [];
  time = 0;
  /** QA counters: chase asks answered from a recent route / searched as usual (lookups that found nothing). */
  hits = 0;
  misses = 0;
  stored = 0;

  constructor(readonly levels: Levels) {}

  /** Once per frame. */
  tick(dt: number): void {
    this.time += dt;
  }

  /** A recent route that serves this chase request (a copy, joined at a walkable early waypoint), or undefined = search. */
  lookup(ax: number, az: number, bx: number, bz: number, o: ChaseOpts): Waypoint[] | undefined {
    if (!o?.drops) return undefined;
    const A = ATRIUM_CHASE, ay = o.ay ?? 0, by = o.by ?? ay, nl = !!o.noLinks;
    for (const r of this.routes) {
      if (this.time - r.t > A.shareS || r.noLinks !== nl || Math.abs(r.ay - ay) > 1 || Math.abs(r.by - by) > 1) continue;
      if (Math.hypot(r.bx - bx, r.bz - bz) > A.shareGoalM || Math.hypot(r.ax - ax, r.az - az) > A.shareStartM) continue;
      for (let k = 0; k < Math.min(3, r.path.length); k++) {
        const wp = r.path[k];
        if (wp[2] !== undefined) break; // a ladder waypoint: search instead
        if (this.levels.walkLineClear(ax, ay, az, wp[0], wp[1], A.probeR, wp[3] ?? ay)) {
          this.hits++;
          return r.path.slice(k).map(p => [...p] as Waypoint);
        }
      }
    }
    this.misses++;
    return undefined;
  }

  /** A chase search's own result (kept for shareS s). */
  remember(ax: number, az: number, bx: number, bz: number, o: ChaseOpts, path: Waypoint[] | null | undefined): void {
    if (!o?.drops || !path || !path.length) return;
    const ay = o.ay ?? 0;
    this.routes.unshift({t: this.time, ax, az, ay, bx, bz, by: o.by ?? ay, noLinks: !!o.noLinks, path});
    if (this.routes.length > ATRIUM_CHASE.shareKeep) this.routes.length = ATRIUM_CHASE.shareKeep;
    this.stored++;
  }
}
