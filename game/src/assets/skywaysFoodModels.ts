// Task studio-skyways-level-20261106-054448 (lane FOOD): the ONE place the Skyways ramen restaurant's models are described — the four
// edible item models (shared boot files: food travels between levels) and the four kitchen / counter prop models (level-only
// `skyways-*.glb` files, lazy). Pure data (no three.js).
//
// Lane ASSET-A cooks the runtime derivatives (tools/asset-pipeline/props/build-skyways-sources.mjs) from the user's community-supplied
// Meshy sources and writes their MEASURED bounds to assets/skywaysProps.generated.ts (SKYWAYS_PROP_MODELS, the same keys as below).
// Until that file is merged the rows below carry ASSET-A's target sizes; the merge swaps them with ONE line:
//   export const SKYWAYS_FOOD_MODELS = {...NOMINAL, ...pick(SKYWAYS_PROP_MODELS)}
// Everything else (item dims, prop footprints, the restaurant dresser, the renderer, the tests) reads SKYWAYS_FOOD_MODELS only.
// Frame of every file: metres, +Y up, front +Z, grounded (min y = 0), centred on x / z. `bytes` = the lazy-library / boot progress
// weight (an estimate until the cooked files are measured; the loader never trusts it for anything else).

export type SkywaysFoodModelKey =
  | 'item_ramen_bowl' | 'item_ramen_chashu' | 'item_sushi_bento' | 'item_bubble_tea'
  | 'skyways_sushi_mascot' | 'skyways_stock_pot' | 'skyways_saucepan' | 'skyways_commercial_range';

export interface SkywaysModelSpec {
  /** Runtime file under game/public/. */
  url: string;
  /** Real-world bounds (m): w = x, h = y, d = z. */
  w: number;
  h: number;
  d: number;
}

/**
 * ASSET-A's target sizes (lane brief): bowl rim diameters 0.20 / 0.22 m, the bento's long side 0.24 m, the bubble tea 0.24 m tall with
 * its straw, the figurine 0.32 m tall, the stock pot 0.42 m wide with its handles, the saucepan 0.46 m long with its handle, the range
 * 1.52 x ~1.40 x ~0.90 m (front +Z: knobs and oven doors). Unstated heights / depths are ordinary real-world proportions.
 */
const NOMINAL: Readonly<Record<SkywaysFoodModelKey, SkywaysModelSpec>> = {
  item_ramen_bowl: {url: 'assets/models/item-ramen-bowl.glb', w: 0.2, h: 0.1, d: 0.2},
  item_ramen_chashu: {url: 'assets/models/item-ramen-chashu.glb', w: 0.22, h: 0.11, d: 0.22},
  item_sushi_bento: {url: 'assets/models/item-sushi-bento.glb', w: 0.24, h: 0.065, d: 0.17},
  item_bubble_tea: {url: 'assets/models/item-bubble-tea.glb', w: 0.095, h: 0.24, d: 0.095},
  skyways_sushi_mascot: {url: 'assets/models/skyways-sushi-mascot.glb', w: 0.24, h: 0.32, d: 0.2},
  skyways_stock_pot: {url: 'assets/models/skyways-stock-pot.glb', w: 0.42, h: 0.3, d: 0.3},
  skyways_saucepan: {url: 'assets/models/skyways-saucepan.glb', w: 0.46, h: 0.11, d: 0.2},
  skyways_commercial_range: {url: 'assets/models/skyways-commercial-range.glb', w: 1.52, h: 1.4, d: 0.9},
};

/** The models (url + real bounds). The swap point for ASSET-A's measured SKYWAYS_PROP_MODELS (see the header). */
export const SKYWAYS_FOOD_MODELS: Readonly<Record<SkywaysFoodModelKey, SkywaysModelSpec>> = NOMINAL;

/** Progress weights (bytes, estimates within ASSET-A's budgets: 512 px maps; the range 1024 px base colour). */
export const SKYWAYS_FOOD_MODEL_BYTES: Readonly<Record<SkywaysFoodModelKey, number>> = {
  item_ramen_bowl: 220_000, item_ramen_chashu: 220_000, item_sushi_bento: 200_000, item_bubble_tea: 160_000,
  skyways_sushi_mascot: 260_000, skyways_stock_pot: 200_000, skyways_saucepan: 180_000, skyways_commercial_range: 700_000,
};

/**
 * Height of the range's COOKTOP above its base (m): the work surface its pots stand on — the prop's collision top (gen/skyways/
 * kitchenKinds.ts). The model's thin backguard / high shelf rises above it to the full model height. A commercial range's cooking
 * height is ~0.91-0.95 m; re-measure on the cooked GLB (vertical ray cast over the burners) when ASSET-A's file lands.
 */
export const SKYWAYS_RANGE_COOKTOP_Y = 0.93;
