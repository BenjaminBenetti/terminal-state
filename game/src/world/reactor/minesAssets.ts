// Task reactor-expansion-20261101 (lane MINES): the old mine workings' hero models — the lead's Meshy T2.5 set pieces of the expansion
// kit (assets/reactorExpansionKit.generated.ts REACTOR_X_KIT: real size, +Y up, front +Z, grounded, centred; Meshy maps kept): the
// timber support set instanced along the drifts, the narrow-gauge ore cart, the hoist winch, the rubber-tyred drill jumbo. Referenced
// from runtime code here (the release packager drops unreferenced GLBs); fetched by the lazy prop library behind the Reactor's loading
// screen only when the layout has a mines complex (the 'reactor-' file prefix is level-only).

import {REACTOR_X_KIT} from '../../assets/reactorExpansionKit.generated';

export const MINES_MODELS = {
  timberSet: REACTOR_X_KIT.timberSet,
  mineCart: REACTOR_X_KIT.mineCart,
  hoistWinch: REACTOR_X_KIT.hoistWinch,
  drillRig: REACTOR_X_KIT.drillRig,
} as const;
export type MinesModel = keyof typeof MINES_MODELS;

/**
 * Measured anchors of the cooked GLBs (vertex bounds probed 2026-11-02): the timber set's posts' inner faces at x = ±1.03 and the cap's
 * underside at y = 1.79 (clear opening 2.06 x 1.79 m at scale 1, top 2.516 m); the ore cart's wheels at z = ±0.30 (600 mm gauge), its
 * wheelbase along x.
 */
export const MINES_ANCHORS = {timberSet: {postInner: 1.03, capUnder: 1.79, top: 2.516}, mineCart: {gauge: 0.6}} as const;

/** Lazy-library file map of the expansion kit (every REACTOR_X_KIT url referenced from runtime code). */
export const REACTOR_X_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  Object.values(REACTOR_X_KIT).map(m => [m.key, {url: m.url, bytes: m.bytes}]));

/** The lazy keys a layout needs for its mines complex (none without one). */
export function minesModelKeysFor(layout: {reactor?: {complexes?: readonly {id: string}[]}}): readonly string[] {
  return layout.reactor?.complexes?.some(c => c.id === 'mines') ? Object.values(MINES_MODELS).map(m => m.key) : [];
}
