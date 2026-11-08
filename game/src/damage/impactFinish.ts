// Task reactor-expansion-20261101 (lane CONTROLS): the damage class of an ARCH-OWNED finish key (world/finishAt.ts) — what a bullet's
// chips / sparks / dust / crater / sound are made of when it strikes a surface an arch drew (user feedback: "particel effects when
// shooting walls do not match wall material"). Pure data. A key not listed here answers null: the station rule stays.
//  - the Reactor (world/reactor/archMaterials.ts REACTOR_SURFACE_KEYS): pit concrete walls / roof / floors / room ceilings = concrete
//    (dust, chunk chips, craters); bar grating decks, rusted-plate deck undersides, rusted-plate room walls and trim = structural steel
//    (sparks, gouges, metal ring);
//  - the Office (world/officeArch.ts keys): painted drywall = plaster, the core / roof / raw slab = concrete, wet-room walls / tile
//    floors = tile, carpet = fabric, vinyl = plastic, stone = terrazzo, timber = wood, raised server floors = laminate, the T-bar
//    acoustic / plain plaster ceilings = plaster;
//  - the Beyond-the-Station annexes' board-formed wall ('annexWall') = concrete.
// The Mall's finish rows ('mall-…|row') keep the station rule (its gallery terrazzo / tiled walls already match it).

import type {DamageClass} from './materials';
import {skywaysShopImpact} from '../world/skywaysShopFinish'; // task studio-skywalk-variety-20261107-231448-01 (lane DRESS): pure data

const REACTOR: Readonly<Record<string, DamageClass>> = {
  'reactor-wall': 'concrete', 'reactor-roof': 'concrete', 'reactor-floor': 'concrete', 'reactor-ceil': 'concrete',
  'reactor-grating': 'steel', 'reactor-deck-under': 'steel', 'reactor-room-wall': 'steel', 'reactor-trim': 'steel',
};
/** Task reactor-expansion-20261101 (lane CORE): the hero core's undrawn grid keys — the vessel's column = the steel vessel; the goop
 *  pool's floor (under the goop) = a soft wet hit (no sparks / dust). */
const REACTOR_CORE: Readonly<Record<string, DamageClass>> = {'reactor-core-hidden': 'steel', 'reactor-core-goop': 'rubber'};

const OFFICE_FLOOR: Readonly<Record<string, DamageClass>> = {
  carpet: 'fabric', vinyl: 'plastic', tile: 'tile', wet: 'tile', stone: 'terrazzo', concrete: 'concrete', wood: 'wood', server: 'laminate',
  core: 'concrete', roof: 'concrete',
};
const OFFICE_CEIL: Readonly<Record<string, DamageClass>> = {grid: 'plaster', plain: 'plaster', raw: 'concrete', core: 'concrete'};
/** Task studio-skyways-level-20261106-054448 (lane VIEW): the Skyways finishes (world/skywaysArch.ts; the office materials behind them). */
const SKYWAYS: Readonly<Record<string, DamageClass>> = {
  'skyways-wall': 'plaster', 'skyways-reveal': 'plaster', 'skyways-wet': 'tile', 'skyways-boh': 'concrete', 'skyways-trim': 'steel',
  'skyways-floor-public': 'terrazzo', 'skyways-floor-court': 'terrazzo', 'skyways-floor-bridge': 'tile', 'skyways-floor-wet': 'tile', 'skyways-floor-boh': 'concrete',
  'skyways-ceil-plain': 'plaster', 'skyways-ceil-grid': 'plaster', 'skyways-ceil-bridge': 'plaster', 'skyways-ceil-core': 'concrete',
  // (task studio-skyways-rework-20261107-054512-01, lane ARCH) the rework's court / bridge finishes, their stand-ins, the roof light, roof steel
  'skyways-tex-herringbone': 'tile', 'skyways-tex-pavers': 'tile', 'skyways-tex-brick': 'concrete', 'skyways-tex-slats': 'wood',
  'skyways-floor-pavers': 'tile', 'skyways-ceil-slats': 'wood', 'skyways-skylight-sky': 'glass', 'skyways-roof-steel': 'steel',
  // (task studio-skyways-rework-20261107-054512-01) a tenant office wing
  'skyways-office-wall': 'plaster', 'skyways-floor-office': 'fabric',
};

/** Damage class of an arch-owned finish key, or null (not an arch finish this table knows: the station rule applies). */
export function finishClass(key: string | null | undefined): DamageClass | null {
  if (!key) return null;
  if (key in REACTOR) return REACTOR[key];
  if (key in REACTOR_CORE) return REACTOR_CORE[key]; // task reactor-expansion-20261101 (lane CORE)
  if (key === 'annexWall') return 'concrete';
  if (key in SKYWAYS) return SKYWAYS[key]; // task studio-skyways-level-20261106-054448 (lane VIEW): world/skywaysArch.ts keys
  // (task studio-skywalk-variety-20261107-231448-01, lane DRESS) the small shops' palettes: skyways-shop-{wall|floor}|<finish row>
  if (key.startsWith('skyways-shop-')) return skywaysShopImpact(key);
  // (task studio-skyways-rework-20261107-054512-01) the anchor stores' finishes: skyways-anchor-{wall-<class>|floor-<kind>|ceil-<kind>}@<family>
  const an = /^skyways-anchor-(wall|floor|ceil)-([a-z]+)@/.exec(key);
  if (an) return an[1] === 'wall' ? (an[2] as DamageClass) : an[1] === 'floor' ? OFFICE_FLOOR[an[2]] ?? null : OFFICE_CEIL[an[2]] ?? null;
  if (key.startsWith('office-')) {
    const base = key.split('@')[0];
    if (base === 'office-wall' || base === 'office-accent') return 'plaster';
    if (base === 'office-core' || base === 'office-roof') return 'concrete';
    if (base === 'office-wet') return 'tile';
    if (base === 'office-carpet') return 'fabric';
    if (base === 'office-vinyl') return 'plastic';
    if (base.startsWith('office-floor-')) return OFFICE_FLOOR[base.slice('office-floor-'.length)] ?? null;
    if (base.startsWith('office-ceil-')) return OFFICE_CEIL[base.slice('office-ceil-'.length)] ?? null;
  }
  return null;
}

/** Every finish key the table answers for (tests: coverage of the arches' key sets). */
export const FINISH_CLASS_KEYS = {reactor: Object.keys(REACTOR), officeFloor: Object.keys(OFFICE_FLOOR), officeCeil: Object.keys(OFFICE_CEIL), skyways: Object.keys(SKYWAYS)} as const;
