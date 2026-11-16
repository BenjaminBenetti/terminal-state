// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): CROSSING PARTICIPANTS — runtime systems that carry
// something of the player's across a station <-> district crossing (Game.crossSurface, lane ACCESS): e.g. the train equipment unit in
// the player's hands / on the dolly (lane CARGO). One registry per game (no Game field: a WeakMap keyed by the game object).
//
// Order inside Game.crossSurface (ACCESS): the destination is prepared (generated + its models fetched) → `depart(from, to)` on every
// participant while the OLD world is still intact (it takes what it carries out of the old section — never leaving a copy behind) →
// the old section is left (memory saved) and torn down → the new section is built → `arrive(to)` on every participant (it puts what it
// carries into the new section, next to the arrival pose) → warm-up → play. A crossing that fails after `depart` calls `abort(from)`
// (the participant restores what it took into the old section, exactly). Every participant must keep SOLE ownership of what it
// carries at every point (never in two sections, never lost).

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
