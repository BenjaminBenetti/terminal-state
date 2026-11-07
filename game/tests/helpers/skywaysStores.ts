// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): test helpers for the Skyways major stores (gen/skyways/stores/).
// `findStore('music')` → the first seeds whose version-3 layout has that family's anchor (optionally of a format), cached per run;
// `storeAreas` / `storeProps` / `storePickups` → what belongs to one store (its sales floor + pieces, upper floor, zones, back rooms).
import {LEVELS} from '../../src/levels/registry';
import type {StationLayout} from '../../src/gen/stationTypes';
import type {PropPlacement} from '../../src/gen/props';
import type {SkywaysAnchor, SkywaysAnchorFormat, SkywaysShopFamily} from '../../src/gen/skyways/skywaysTypes';

const cache = new Map<string, StationLayout>();

/** The Skyways main layout of a seed at a layout version (default 3: the stores). Cached. */
export function genSkyways(seed: number, layoutVersion = 3): StationLayout {
  const k = `${seed}:${layoutVersion}`;
  let l = cache.get(k);
  if (!l) { l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion} as never) as StationLayout; cache.set(k, l); }
  return l;
}

export interface StoreHit { seed: number; layout: StationLayout; anchor: SkywaysAnchor }

/** Up to `count` seeds (scanning 1..maxSeed) whose version-3 layout has `family`'s anchor (and `format`, when given). */
export function findStores(family: SkywaysShopFamily, opts: {format?: SkywaysAnchorFormat; count?: number; maxSeed?: number; layoutVersion?: number} = {}): StoreHit[] {
  const out: StoreHit[] = [];
  for (let seed = 1; seed <= (opts.maxSeed ?? 60) && out.length < (opts.count ?? 1); seed++) {
    const layout = genSkyways(seed, opts.layoutVersion ?? 3);
    const anchor = layout.skyways?.anchors?.find(a => a.family === family && (!opts.format || a.format === opts.format));
    if (anchor) out.push({seed, layout, anchor});
  }
  return out;
}

/** The first hit of findStores (throws when no seed has it). */
export function findStore(family: SkywaysShopFamily, opts: {format?: SkywaysAnchorFormat; maxSeed?: number; layoutVersion?: number} = {}): StoreHit {
  const h = findStores(family, {...opts, count: 1})[0];
  if (!h) throw new Error(`no Skyways seed <= ${opts.maxSeed ?? 60} has a ${family} anchor${opts.format ? ` (${opts.format})` : ''}`);
  return h;
}

/** Area ids of one store: the sales floor and its pieces round a stair well, the upper floor and its pieces, the zones, the back rooms. */
export function storeAreas(layout: StationLayout, an: SkywaysAnchor): {floor: number[]; upper: number[]; zones: number[]; stock: number[]; all: Set<number>} {
  const zones = new Set(an.zones);
  const floor = [an.floor, ...layout.areas.filter(a => a.parent === an.floor && a.type === 'shop' && !zones.has(a.id)).map(a => a.id)];
  const upper = an.upper === undefined ? [] : [an.upper, ...layout.areas.filter(a => a.parent === an.upper).map(a => a.id)];
  const all = new Set([...floor, ...upper, ...an.zones, ...an.stock]);
  return {floor, upper, zones: [...an.zones], stock: [...an.stock], all};
}

/** The props standing in one store's areas. */
export function storeProps(layout: StationLayout, an: SkywaysAnchor): PropPlacement[] {
  const {all} = storeAreas(layout, an);
  return (layout.props as PropPlacement[]).filter(p => all.has(p.area));
}

/** The loose pickups placed in one store's areas. */
export function storePickups(layout: StationLayout, an: SkywaysAnchor): StationLayout['pickups'] {
  const {all} = storeAreas(layout, an);
  return layout.pickups.filter(p => all.has(p.area));
}
