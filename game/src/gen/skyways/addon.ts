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

/** QA / tests: what dressSkywaysAddon placed in a layout (the generator ignores the return value), with each prop's layout index. */
const RESULTS = new WeakMap<StationLayout, {res: AddonDressResult; index: Map<PropPlacement, number>}>();
/**
 * QA / tests: the dress result of a layout, its prop references resolved against the layout's CURRENT props (a later re-frame —
 * gen/trackExt finishExtensions — replaces the placements with translated copies in the same order).
 */
export function skywaysAddonDressOf(layout: StationLayout): AddonDressResult | undefined {
  const r = RESULTS.get(layout);
  if (!r) return undefined;
  const map = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(map);
    if (v && typeof v === 'object') {
      const i = r.index.get(v as PropPlacement);
      if (i !== undefined) return layout.props[i];
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
    }
    return v;
  };
  return map(r.res) as AddonDressResult;
}

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
  RESULTS.set(layout, {res, index: new Map(layout.props.map((p, i) => [p, i] as const).filter(([, i]) => i >= d.p0))});
  return res;
}

