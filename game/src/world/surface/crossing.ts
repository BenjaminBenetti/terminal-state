// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): CROSSING PARTICIPANTS — runtime systems that carry
// something of the player's across a station <-> district crossing (Game.crossSurface, lane ACCESS): e.g. the train equipment unit in
// the player's hands / on the dolly (lane CARGO). One registry per game (no Game field: a WeakMap keyed by the game object).
//
// Order inside Game.crossSurface (ACCESS): `depart(from, to)` on every participant while the OLD world is still intact and still in
// play (it takes what it carries out of the old section — never leaving a copy behind; lane ACCESS follow-up 1: BEFORE the loading
// screen, whose state change would make a lane let go of what is in the hands) → the loading screen; the destination is prepared
// (generated + its models fetched) → the old section is left (memory saved) and torn down → the new section is built → `arrive(to)` on
// every participant (it puts what it carries into the new section, next to the arrival pose) → warm-up → play. A crossing that fails
// after `depart` calls `abort(from)` (the participant restores what it took into the old section, exactly). Every participant must
// keep SOLE ownership of what it carries at every point (never in two sections, never lost).

//
// Lane ACCESS (this file's owner) — the details Game.crossSurface guarantees:
//  - `refuse` is asked for every participant before anything happens (the first refusal wins; nothing changes). It is also asked by
//    the access prompt every frame the player stands at a way up / down, so it must be cheap and side-effect free.
//  - `depart` runs in registration order; if one throws, the ones that departed before it are aborted (reverse order) with the old
//    world still intact, and the crossing is refused ('failed': the player stays).
//  - `arrive` runs in registration order once the new world is built, BEFORE its warm-up (whatever a participant adds compiles).
//  - `abort(from)` runs with the OLD section live again: either it was never left (a failed preparation) or it was rebuilt where the
//    player stood (the access / portal pose) after the destination failed to build.

import type {SectionKey} from '../../levels/types';

export interface SurfaceCrosser {
  readonly name: string;
  /** May the player cross now? A string = the refusal shown in the prompt (e.g. "Set the cart down first"); null = yes. */
  refuse?(from: SectionKey, to: SectionKey): string | null;
  depart(from: SectionKey, to: SectionKey): void;
  arrive(to: SectionKey): void;
  abort?(from: SectionKey): void;
}

const registry = new WeakMap<object, SurfaceCrosser[]>();

/** The crossing participants of `game` (registered at install, in order). */
export function surfaceCrossers(game: object): SurfaceCrosser[] {
  let list = registry.get(game);
  if (!list) registry.set(game, (list = []));
  return list;
}

const ways = new WeakMap<object, () => boolean>();

/**
 * (lane ACCESS, follow-up 1) Whether the player stands at a way up / down looking at it now (the [E] there crosses). The access runtime
 * registers it. A grabbed / carried train unit's own [E] (let go / put down / secure) YIELDS while it is true, so [E] at the way crosses
 * WITH the unit (participant 'cargo') instead of dropping it at the door.
 */
export function setSurfaceWayAimed(game: object, aimed: () => boolean): void { ways.set(game, aimed); }
export const surfaceWayAimed = (game: object): boolean => ways.get(game)?.() ?? false;

// ---------------------------------------------------------------------------------------------------------------------------
// Lane ACCESS: the crossing gate (pure) and the participant runners (Game.crossSurface)

/** Why a crossing cannot start now (the code is the result's reason; `text` is what the prompt / toast says). */
export interface SurfaceCrossRefusal {
  code: 'busy' | 'dead' | 'not-ready' | 'not-playing' | 'moving' | 'seated' | 'climbing' | 'no-access' | 'carrying';
  text: string;
}

/** Game.crossSurface's result: where the player is now, or why nothing changed ('failed': the player stays where they were). */
export type SurfaceCrossResult = {ok: true; to: SectionKey} | {ok: false; reason: SurfaceCrossRefusal['code'] | 'cancelled' | 'failed'; error: string};

/** Everything the gate reads (Game.surfaceCrossGate fills it from the live game). */
export interface SurfaceCrossGate {
  /** A lifecycle flight (travel, new game, retry, continue, another crossing) is running. */
  busy: boolean;
  alive: boolean;
  /** Game.state ('playing' only: a menu / the map / the inventory / a loading screen is open otherwise). */
  state: string;
  /** A world and a renderer exist. */
  ready: boolean;
  /** The train is moving / a journey is pending / the transit gap / a menu travel. */
  moving: boolean;
  /** In the truck's (vehicle controller's) seat. */
  seated: boolean;
  /** On a ladder. */
  climbing: boolean;
  /** The section's way up / down: the destination key (null: this section has none). */
  to: SectionKey | null;
}

/** The first reason a crossing from `from` cannot start (null: it can). Participants' refusals come last (game state first). */
export function surfaceCrossRefusal(g: SurfaceCrossGate, from: SectionKey, crossers: readonly SurfaceCrosser[] = []): SurfaceCrossRefusal | null {
  if (g.busy) return {code: 'busy', text: 'Busy — try again in a moment.'};
  if (!g.alive || g.state === 'dead') return {code: 'dead', text: 'You are dead.'};
  if (!g.ready) return {code: 'not-ready', text: 'Not ready yet.'};
  if (g.state !== 'playing') return {code: 'not-playing', text: 'Close the menu first.'};
  if (!g.to) return {code: 'no-access', text: 'There is no way out here.'};
  if (g.moving) return {code: 'moving', text: 'Not while the train is moving.'};
  if (g.seated) return {code: 'seated', text: 'Get out of the truck first.'};
  if (g.climbing) return {code: 'climbing', text: 'Get off the ladder first.'};
  for (const c of crossers) {
    let r: string | null = null;
    try { r = c.refuse?.(from, g.to) ?? null; } catch (err) { console.warn(`surface crossing: ${c.name}.refuse failed`, err); r = 'Not now.'; }
    if (r) return {code: 'carrying', text: r};
  }
  return null;
}

/**
 * Every participant departs `from` for `to`, in order. A throw aborts the ones already departed (reverse order, the old world still
 * intact) and rethrows: the crossing does not happen. Returns the departed participants (all of them).
 */
export function departCrossers(crossers: readonly SurfaceCrosser[], from: SectionKey, to: SectionKey): SurfaceCrosser[] {
  const done: SurfaceCrosser[] = [];
  for (const c of crossers) {
    try { c.depart(from, to); done.push(c); } catch (err) {
      abortCrossers(done, from);
      throw new Error(`surface crossing: ${c.name} could not depart (${String((err as Error)?.message ?? err)})`);
    }
  }
  return done;
}

/** Every departed participant arrives in `to` (a failure is logged; the others still arrive). Returns the names that failed. */
export function arriveCrossers(crossers: readonly SurfaceCrosser[], to: SectionKey): string[] {
  const failed: string[] = [];
  for (const c of crossers) { try { c.arrive(to); } catch (err) { failed.push(c.name); console.error(`surface crossing: ${c.name} could not arrive`, err); } }
  return failed;
}

/** The departed participants restore what they took into the (live again) old section — reverse order; failures are logged. */
export function abortCrossers(crossers: readonly SurfaceCrosser[], from: SectionKey): void {
  for (const c of [...crossers].reverse()) { try { c.abort?.(from); } catch (err) { console.error(`surface crossing: ${c.name} could not abort`, err); } }
}
