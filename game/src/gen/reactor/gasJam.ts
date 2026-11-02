// Task reactor-playtest-round2-20261102 (lane GAS, user bullet 8 — a DESIGN CHANGE): "I think the final generator to clear the fog out of
// the bottom level should "jam" and so the final level of fog cannot be cleared and you must wear a gas mask down there. Once the
// reactor comes on line then the fog at the bottom will clear out."
//
// THE RULE (pure data, one source for every surface): the auxiliary generator of the DEEPEST gas zone (the core floor's: zone 2, in the
// tier-4 waste repository) is jammed for the whole run. Its fan drive is seized, so a start cranks and stalls, and its zone is never
// cleared by a generator. The bottom stays gassed until the reactor is ONLINE (the rods withdrawn: the win's whole-pit clearing,
// world/reactor/generators.ts clearAll), never at a fuse, the breaker, the valve or the pump. The upper generators work as before. So
// the deep core tasks (pump hall, control room) need the gas mask + filters. The level's guaranteed mask and filters
// (gen/maskLoot.ts) are placed only UPSTREAM of the jammed zone (`jamLevels`), and every upstream storey is reachable without a mask
// through the working generators. This supersedes the old "the generator route needs no mask all the way down" design.
// Readers: world/reactor/{air,generators,restart,restartScreens,mapBoard*}.ts, gen/maskLoot.ts (placement), the tests.

import type {ReactorInfo} from './reactorTypes';

/** The stalled start's timing (s). */
export const REACTOR_JAM = {
  /** After the 2 s start hold: the starter cranks this long, then the fan drive seizes. */
  STALL_S: 2.4,
} as const;

export interface ReactorJam {
  /** The jammed generator (ReactorGenerator.id) and the zone it would have cleared (ReactorZone.id). */
  generator: number;
  zone: number;
  /** The storeys (layout.levels indices) inside that zone: gassed until the reactor is online. */
  levels: readonly number[];
  /** The zone's band top (absolute y): below it the air stays toxic. */
  yTop: number;
}

/**
 * The jammed generator of a Reactor: the generator of the deepest gas zone (lowest band top), when there are at least two zones (the
 * upper generators always work). null: one zone, or the deepest zone has no generator.
 */
export function reactorJam(info: Pick<ReactorInfo, 'zones' | 'generators'>): ReactorJam | null {
  if (info.zones.length < 2) return null;
  const deep = info.zones.reduce((a, z) => (z.yTop < a.yTop ? z : a));
  const gen = deep.generator >= 0 && info.generators.some(g => g.id === deep.generator) ? deep.generator : info.generators.find(g => g.zone === deep.id)?.id ?? -1;
  if (gen < 0) return null;
  return {generator: gen, zone: deep.id, levels: [...deep.levels], yTop: deep.yTop};
}

/** Zone label as the HUD / boards print it ("Zone 3" for id 2). */
export const zoneName = (zone: number): string => `Zone ${zone + 1}`;

/**
 * Every player-facing line about the jam (one wording across the prompt, toast, HUD, boards and the floor maps). Task
 * reactor-surface-ending-20261102 (lane OBJECTIVES, user: "the objective text is to wordy, saying "core floor generator is jammed" and all
 * that … The player will know its jammed when they try to start it"): the HUD objective's jam paragraph is gone (the HUD objective has no
 * jam text at all: world/reactor/objectiveText.ts); the HUD air line only says the air is toxic; the board marks are terse. The jam itself
 * is told AT the generator, when the player tries it: the stall, the flashing fault lamp, the short toast and its prompt.
 */
export const JAM_TEXT = {
  /** Generator prompt before any try / after a stall. */
  promptTry: (zone: number) => `<b>Hold [E]</b> Try to start the auxiliary generator (${zoneName(zone)} extraction fans) · FAULT lamp flashing`,
  promptJammed: (zone: number) => `Auxiliary generator JAMMED — ${zoneName(zone)} fan drive seized · <b>Hold [E]</b> try again`,
  promptStalling: (zone: number) => `Auxiliary generator cranking… (${zoneName(zone)} extraction fans)`,
  /** The toast when a start stalls (short: the jam is learnt here). */
  stalled: (zone: number) => `The generator seizes: ${zoneName(zone)} fan drive JAMMED. The core floor stays gassed until the reactor is online.`,
  /** HUD air line on a jammed zone's storey: toxic, nothing about the jam. */
  hud: 'toxic air · gas mask on',
  /** Pit board row (the zone's clearing bar is replaced while it stays gassed). */
  board: 'JAMMED · MASK',
  /** Switchgear board hint once control power is on (the last stop before the core floor). */
  switchgear: 'Control power on — core floor next: gas mask on',
  /** The pit board's "Next: …" suffix for a step on a jammed storey. */
  next: 'gas mask',
  /** Floor-map banner on a jammed storey, and the generator's legend entry. */
  map: 'TOXIC AIR — GAS MASK REQUIRED',
  legend: 'Generator JAMMED (no fans)',
} as const;
