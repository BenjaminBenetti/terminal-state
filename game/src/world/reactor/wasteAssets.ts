// Task reactor-expansion-20261101 (lane WASTE): the waste repository's MODEL SEAM — the lead's approved models it places (pure data, no
// three.js): the expansion's waste set (assets/reactorExpansionKit.generated.ts REACTOR_X_KIT: wasteDrum, storageCask, deconShower,
// hotCellWindow — Meshy T2.5 from Codex references made with the selected B; Meshy maps KEPT) and REACTOR_KIT pieces (switchgear,
// control console, coolant valve, the fan housing). Every REACTOR_X_KIT url used here is referenced from runtime code through
// WASTE_MODEL_FILES (game.ts propModels: the release packager drops unreferenced GLBs); the 'reactor-' filenames are level-only
// (assets/levelAssets.ts), fetched behind the Reactor's loading screen (wasteModelKeysFor via Game.sectionModelKeys).

import {REACTOR_X_KIT} from '../../assets/reactorExpansionKit.generated';
import {REACTOR_KIT, type ReactorKitModel} from '../../assets/reactorKit.generated';
import type {WasteDecor, WasteModelPiece} from '../../gen/reactor/complex/wasteTypes';

/** The cooked model behind each piece the complex places (+ the fan housing for its ventilation fans). */
export const WASTE_MODELS: Readonly<Record<WasteModelPiece | 'fanHousing', ReactorKitModel>> = {
  wasteDrum: REACTOR_X_KIT.wasteDrum,
  storageCask: REACTOR_X_KIT.storageCask,
  deconShower: REACTOR_X_KIT.deconShower,
  hotCellWindow: REACTOR_X_KIT.hotCellWindow,
  switchgear: REACTOR_KIT.switchgear,
  controlConsole: REACTOR_KIT.controlConsole,
  coolantValve: REACTOR_KIT.coolantValve,
  fanHousing: REACTOR_KIT.fanHousing,
};

/** Lazy-library file map of the expansion's waste models (the REACTOR_KIT ones are already in REACTOR_MODEL_FILES). */
export const WASTE_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  (['wasteDrum', 'storageCask', 'deconShower', 'hotCellWindow'] as const).map(p => [REACTOR_X_KIT[p].key, {url: REACTOR_X_KIT[p].url, bytes: REACTOR_X_KIT[p].bytes}]),
);

/** Game.sectionModelKeys: the models a layout's waste repository places (none without one). */
export function wasteModelKeysFor(layout: {reactorWaste?: WasteDecor}): readonly string[] {
  const d = layout.reactorWaste;
  if (!d) return [];
  const keys = new Set<string>();
  for (const m of d.models) keys.add(WASTE_MODELS[m.piece].key);
  if (d.fans.length) keys.add(WASTE_MODELS.fanHousing.key);
  return [...keys];
}

/** Fan housing anchors (archAssets.ts REACTOR_MODELS.fanHousing, probed from the cooked GLB): back flange / ring centre / rotor plane. */
export const FAN_HOUSING = {back: -0.679, ringY: 1.256, ringR: 0.7, bladeZ: 0.14, bladeR: 0.66} as const;
