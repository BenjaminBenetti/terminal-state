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

/** Cooked file sizes (bytes; the lazy library's progress weights — tests/skyways-dest-landmarks.test.ts checks them against the files). */
export const SKYWAYS_DEST_MODEL_BYTES: Readonly<Partial<Record<SkywaysDestPropKey, number>>> = {
  skyways_d_lm_clock: 2777308, skyways_d_lm_dino: 2898844, skyways_d_lm_tree: 2950336, skyways_d_lm_fountain: 2485468, skyways_d_lm_geese: 2426976,
  skyways_d_lm_orrery: 2444152, skyways_d_bk_bookcase: 542296, skyways_d_bk_table: 485076, skyways_d_bk_armchair: 576016, skyways_d_bk_stack: 352144,
  skyways_d_of_canoe: 614964, skyways_d_of_tent: 645852, skyways_d_of_backpack: 307140, skyways_d_of_lantern: 349756, skyways_d_of_campchair: 457128,
  skyways_d_mu_bins: 549904, skyways_d_mu_crate: 328288, skyways_d_mu_guitar: 467692, skyways_d_mu_piano: 740732, skyways_d_mu_drums: 1085792,
  skyways_d_mu_amp: 524080, skyways_d_hb_diorama: 1547004, skyways_d_hb_vitrine: 645128, skyways_d_hb_kits: 180668, skyways_d_hb_robot: 605696,
  skyways_d_ds_sofa: 513128, skyways_d_ds_eggchair: 597464, skyways_d_ds_lamp: 450516, skyways_d_ds_table: 534832, skyways_d_ds_bed: 636908,
  skyways_d_gd_bench: 520876, skyways_d_gd_palm: 810832, skyways_d_gd_pot: 346280, skyways_d_gd_barrow: 609824, skyways_d_ar_pinball: 791844,
  skyways_d_ar_airhockey: 655960, skyways_d_ar_claw: 754848, skyways_d_cn_popcorn: 764972, skyways_d_cn_seats: 657832, skyways_d_cn_booth: 566512,
  skyways_d_sc_telescope: 684496, skyways_d_sc_globe: 688488, skyways_d_sc_rocket: 701700, skyways_d_sc_mobile: 810688, skyways_d_hk_net: 733600,
  skyways_d_hk_goalie: 971940,
};
/** Catalogue bytes of a row: the recorded cooked size (KITS's table, else SKYWAYS_DEST_MODEL_BYTES), else an estimate from its tris. */
export function destModelBytes(m: SkywaysDestPropKey): number {
  return destModelRow(m).bytes ?? SKYWAYS_DEST_MODEL_BYTES[m] ?? Math.round(200_000 + destModelRow(m).tris * 45);
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
