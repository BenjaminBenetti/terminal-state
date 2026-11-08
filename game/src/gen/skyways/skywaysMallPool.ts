// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES): the POOL of Mall store families the Skywalk lets (layout version >= 5;
// gen/skyways/skywaysMallStores.ts lets them, world/skywaysMallFinish.ts reserves their finish rows). Pure data, no imports beyond types:
// the render / damage side reads it without pulling in the Mall dresser.

import type {MallProgram} from '../mall/mallTypes';

/**
 * Mall programme ids: families that fit the Skywalk's small units (their Mall minimum size and the Mall lot family such a unit reads as:
 * a 4-8 m unit reads as the Mall's compact square, which lets these and not, e.g., the toy shop or the clothing store) and add variety
 * beside the base shop pools and the ten major stores — women's fashion, shoes, jewellery, beauty, optician, luggage, pets (no gun shop,
 * pharmacy, phone, florist, books, music, sports / outdoors or arcade: the Skywalk has those already). APPEND only: the order fixes the
 * finish-table rows.
 */
export const SKYWAYS_MALL_STORE_PROGRAMS = ['womenswear', 'shoes', 'jewelry', 'beauty', 'optical', 'luggage', 'pet'] as const satisfies readonly MallProgram[];
export type SkywaysMallStoreProgram = (typeof SKYWAYS_MALL_STORE_PROGRAMS)[number];
