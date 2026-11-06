// Task studio-skyways-level-20261106-054448-01 (primary): the dressing of the ONE localized add-on of a Skyways level
// (layout.skyways.addon) — the anime convention hall or the prize-car atrium — and the ramen restaurant hook. Pure data (props,
// signs, statue records), run once after the station dresser on its own rng fork.
//
// Task studio-skyways-level-20261106-054448 (lane ADDON): the add-on dressers — gen/skyways/addonConvention.ts (stage + backdrop,
// audience rows, merch table rows with their loose merch, posters / boards, hung banners, the welcome sign, the mascot statues) and
// gen/skyways/addonPrize.ts (the stanchion ring round the prize car's spot, the prize-draw board, planters); the new kinds:
// gen/skyways/addonKinds.ts. The shared hall frame / keep-mask / placement helpers: gen/skyways/addonFrame.ts.
//
// Heights: placed in the storey's local frame and lifted onto its floor before returning (gen/skyways/addonFrame.ts AddonDresser).

import type {Rng} from '../../core/rng';
import type {PropPlacement} from '../props';
import type {StationLayout} from '../stationTypes';
import type {SkywaysAddon} from './skywaysTypes';
import {AddonDresser} from './addonFrame';
import {conventionStatues, dressConvention, type ConventionResult} from './addonConvention';
import {dressPrizeCar, type PrizeCarResult} from './addonPrize';

export interface AddonDressResult {
  id: SkywaysAddon['id'] | null;
  convention?: ConventionResult;
  prize?: PrizeCarResult;
  /** Every prop placed here (layout.props order). */
  props: PropPlacement[];
  /** Pieces that could not be placed (QA). */
  skipped: string[];
}

/** QA / tests: what dressSkywaysAddon placed in a layout (the generator ignores the return value). */
const RESULTS = new WeakMap<StationLayout, AddonDressResult>();
export const skywaysAddonDressOf = (layout: StationLayout): AddonDressResult | undefined => RESULTS.get(layout);

/** Dresses the add-on hall (and records its statues / car). No-op on any other layout. */
export function dressSkywaysAddon(layout: StationLayout, rng: Rng): AddonDressResult {
  const info = layout.skyways;
  const res: AddonDressResult = {id: info?.addon.id ?? null, props: [], skipped: []};
  if (!info) return res;
  const hall = layout.areas[info.addon.areas[0]];
  if (!hall) { res.skipped.push('no hall area'); return res; }
  const d = new AddonDresser(layout, rng, info.addon, hall);
  if (info.addon.id === 'convention') res.convention = dressConvention(d);
  else res.prize = dressPrizeCar(d);
  d.lift();
  // the statue records (absolute: after the lift)
  if (res.convention && info.addon.convention) info.addon.convention.statues = conventionStatues(res.convention, info.addon.level);
  res.props = layout.props.slice(d.p0);
  res.skipped.push(...d.skipped);
  RESULTS.set(layout, res);
  return res;
}

