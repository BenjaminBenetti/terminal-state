// Task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS (A)): the lazy, level-only MODELS of every Skyways DESTINATION
// kind (all three lanes: the kinds' `model` keys, registry.ts SKYWAYS_DEST_SPECS -> assets/skywaysDestProps.generated.ts rows). Pure data
// (no three.js): the model-library catalogue entries (game.ts propModels), the per-layout key list (game.ts sectionModelKeys, like
// skywaysAddonModelKeysFor: only the kinds a layout placed, only Skyways layouts), and which rows hang from the ceiling.
//
// A row still flagged `planned` (the lead's placeholder size, no runtime file yet) is never fetched: its kind draws the fitted stand-in
// box (world/skywaysDestinations.ts) until lane KITS writes the measured row.

import {SKYWAYS_DEST_PROPS, type SkywaysDestProp, type SkywaysDestPropKey} from '../../../assets/skywaysDestProps.generated';
import {SKYWAYS_DEST_SPECS, isSkywaysDestKind, type SkywaysDestKind} from './registry';

/** A model row with the measured extras lane KITS may add (support / hanging heights, the cooked file size). */
export type DestModelRow = SkywaysDestProp & {bytes?: number; hangY?: number; shelfY?: readonly number[]; seatY?: number};
export const destModelRow = (m: SkywaysDestPropKey): DestModelRow => SKYWAYS_DEST_PROPS[m] as DestModelRow;

/** Lazy model-library key of a runtime file (`skyways-d-lm-clock`: 'skyways-' prefix = level-only Skyways file, assets/levelAssets.ts). */
export const destModelKey = (m: SkywaysDestPropKey): string => SKYWAYS_DEST_PROPS[m].url.replace(/^.*\//, '').replace(/\.glb$/, '');
/** Is the row's runtime file built (not the placeholder)? */
export const destModelBuilt = (m: SkywaysDestPropKey): boolean => !destModelRow(m).planned;
/** The model a kind renders with (null: drawn by code — the art panels). */
export const destModelOf = (kind: SkywaysDestKind): SkywaysDestPropKey | null => SKYWAYS_DEST_SPECS[kind].model ?? null;

/**
 * Catalogue bytes of a row (the library's progress weights / resident report): the cooked size when KITS records it, else an estimate
 * from the tris budget (maps by tier) — tests/skyways-dest-landmarks.test.ts checks recorded sizes against the files.
 */
export function destModelBytes(m: SkywaysDestPropKey): number {
  const row = destModelRow(m);
  return row.bytes ?? Math.round(200_000 + row.tris * 45);
}

/** Lazy file map (game.ts propModels catalogue) of the BUILT rows: `skyways-d-lm-clock` -> assets/models/skyways-d-lm-clock.glb, ... */
export const SKYWAYS_DEST_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  (Object.keys(SKYWAYS_DEST_PROPS) as SkywaysDestPropKey[]).filter(destModelBuilt).map(m => [destModelKey(m), {url: SKYWAYS_DEST_PROPS[m].url, bytes: destModelBytes(m)}]));

/** Game.sectionModelKeys: the lazy model keys of the destination kinds a layout placed (none outside a Skyways level). */
export function skywaysDestModelKeysFor(layout: {props?: readonly {kind: string}[]}): readonly string[] {
  const out = new Set<string>();
  for (const p of layout.props ?? []) {
    if (!isSkywaysDestKind(p.kind)) continue;
    const m = destModelOf(p.kind);
    if (m && destModelBuilt(m)) out.add(destModelKey(m));
  }
  return [...out].sort();
}

/**
 * Rows that HANG from the ceiling (gen/assets.json physics 'hung'), with their suspension points as fractions of the row's w (x) and h
 * (y) — measured on lane KITS's runtime files (lane LANDMARKS, 2026-11-06): the geese's beam hangs from two rods rising at its ends
 * (rod tops x +-0.46 w at the model top = hangY); the canoe is slung at +-0.3 of its length just under its gunwale ends; the planet
 * mobile hangs from the hook on its centre top. A row with `hangY` and no entry here hangs from one centred point.
 */
const HUNG: Readonly<Partial<Record<SkywaysDestPropKey, {xs: readonly number[]; y: number}>>> = {
  skyways_d_lm_geese: {xs: [-0.46, 0.46], y: 1}, skyways_d_of_canoe: {xs: [-0.3, 0.3], y: 0.85}, skyways_d_sc_mobile: {xs: [0], y: 1},
};
export const destModelHung = (m: SkywaysDestPropKey): boolean => HUNG[m] !== undefined || destModelRow(m).hangY !== undefined;
/** A hung model's suspension points (model frame, metres): the renderer draws each cable from there straight up to the ceiling. */
export function destHangCables(m: SkywaysDestPropKey): {y: number; xs: number[]} {
  const row = destModelRow(m), spec = HUNG[m];
  return spec ? {y: spec.y * row.h, xs: spec.xs.map(f => f * row.w)} : {y: row.hangY ?? row.h, xs: [0]};
}
