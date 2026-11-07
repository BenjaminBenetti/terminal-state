// Task studio-alpha-skyways-shops-20261107-054512-01: the SCIENCE store's OWN new prop kinds (lane STORE-SCIENCE), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Big Sky Wonders furnishes almost entirely with existing kinds (the destinations' telescope / globe / rocket / planet mobile, the
// Office lab bench and its separated glassware, the Mall cash-wrap counter, glass display cabinet and glass counter, the hobby kit boxes
// and tin robot, Subway shelving, the existing openable back-room storage). Its only new kinds are three flat WALL ART panels for its
// Codex-generated art (lane STORE-SCIENCE originals, assets/textures/skyways/stores/science/): code-drawn frames + the art face, drawn
// by world/skywaysStoreScienceArt.ts (a plain board until the art texture is loaded; never drawn substitute art):
//  - skySciStarMap: the STAR-MAP WALL — a large framed star-chart mural (3.6 x 2.4 m of art; hung half as large again high on the back
//    wall of the double-height store, the placement's h records the scale);
//  - skySciChart: a framed periodic-table-style classroom chart (1.5 x 1.0 m) by the hands-on demo bench;
//  - skySciPoster: the kit posters (chemistry set / crystal growing / robot kit; variant 0..2) by the kit shelves.
// Root CLAUDE.md "Props — core design rules": wall-mounted paper / board in a frame — nothing to open (rule 1: not storage), screwed to
// the wall (rule 2: mounted, static), no loose items (rule 4), real sizes (rule 5: docs/skyways-stores/science.md scale record).

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_SCIENCE_KINDS = ['skySciStarMap', 'skySciChart', 'skySciPoster'] as const;
export type StoreScienceKind = (typeof STORE_SCIENCE_KINDS)[number];

/** Frame bar width (m) round each art face and the frames' depth off the wall. */
export const SCI_ART_FRAME = {bar: 0.04, d: 0.035} as const;
/** The art faces (m; the Codex art's own aspect, never stretched): the star-map mural (3:2), the periodic chart (3:2), the kit posters. */
export const SCI_ART_FACE: Readonly<Record<StoreScienceKind, {w: number; h: number}>> = {
  skySciStarMap: {w: 3.6, h: 2.4},
  skySciChart: {w: 1.5, h: 1.0},
  skySciPoster: {w: 0.49, h: 1.01},
};
/** The kit posters' variants (skySciPoster.variant): the art pieces of the kit-poster triptych. */
export const SCI_POSTER_VARIANTS = ['chemistry', 'crystals', 'robot'] as const;

const box = (k: StoreScienceKind) => ({w: SCI_ART_FACE[k].w + 2 * SCI_ART_FRAME.bar, h: SCI_ART_FACE[k].h + 2 * SCI_ART_FRAME.bar, d: SCI_ART_FRAME.d});
const art = (k: StoreScienceKind, how: string, frame: string): DestKindSpec => ({
  def: {...box(k), blocksSight: false},
  phys: {dynamic: false, why: 'mounted', how},
  damage: 'cardboard',
  open: {cls: 'none', role: 'decor', how: `${frame}: nothing to open`},
});

export const STORE_SCIENCE_SPECS: Readonly<Record<StoreScienceKind, DestKindSpec>> = {
  skySciStarMap: art('skySciStarMap', 'printed star-chart mural on a backing board in a slim aluminium frame, screwed to the store\'s back wall (the star-map wall)', 'framed wall mural'),
  skySciChart: art('skySciChart', 'periodic-table-style classroom chart on a backing board in a slim aluminium frame, screwed to the wall by the demo bench', 'framed wall chart'),
  skySciPoster: art('skySciPoster', 'kit poster (chemistry set / crystal growing / robot kit: variant) in an aluminium snap frame screwed to the wall by the kit shelves', 'framed wall poster'),
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * Big Sky Wonders: the cash-wrap back counter (M01, openable), the glass display / specimen cabinets (M02, openable), the till's glass
 * display counter (M15), the back rooms' openable cardboard cartons (M47) and storage totes (M18).
 */
export const STORE_SCIENCE_MALL_MODELS: readonly string[] = [
  'mall-mall-cashwrap-counter.glb', 'mall-glass-display-cabinet.glb', 'mall-glass-display-counter.glb', 'mall-cardboard-box-flaps.glb', 'mall-storage-tote.glb',
];
