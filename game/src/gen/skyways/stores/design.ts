// Task studio-alpha-skyways-shops-20261107-054512-01: THE DESIGN STORE (layout version >= 3) — owned by its store agent (lane
// STORE-DESIGN). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec).
//
// LARCH & LOOM HOME, a Scandinavian home-design showroom: the design desk, a textiles band, a kitchen display, room vignettes on rugs
// (living / dining / bedroom), a lighting gallery, a bedroom + lighting mezzanine (two-level), stocked back rooms — the dresser:
// stores/designDress.ts. Every storage piece is an existing openable kind; the store's own kinds (rugs, folded textiles):
// stores/kinds/design.ts.
//
// Loot (existing purposes only, Skyways anchor areas at v3): the sales floor and the other storey roll the Mall HOME store's tables
// ('mall-home': what people left behind on the displays, the tills; the kitchen display's cupboards the tenant pantry rows), the stock
// room its back room's ('mall-home-back': water, beans, dressings, cells; staff lockers, the staff fridge); the office keeps its room
// purpose as carved. Per holder: the lighting gallery's vitrine / desk-lamp table the electronics store's spare cells
// (designDress.ts DESIGN_LIGHTING_PURPOSE); a staff stock corner on the sales floor (no back room) the home store's back rows.
//
// Finish: warm-white plaster over a pale timber wainscot, larch boards, a plain pale ceiling (the mezzanine: a soft sage plaster) —
// light and calm, unlike the bookshop's dark panelling.

import type {SkywaysStoreSpec} from './types';
import {dressDesignStore} from './designDress';

export const STORE_DESIGN: SkywaysStoreSpec = {
  family: 'design',
  owner: 'lane STORE-DESIGN',
  dress: (layout, rng, anchor) => dressDesignStore(layout, rng, anchor),
  purposes: {floor: 'mall-home', upper: 'mall-home', stock: 'mall-home-back', office: 'mall-management'}, // (+ office: the primary, integration — a Mall management office, not the carve's agent office with its ammo rows)
  finish: {
    wall: {paint: 0xf1ede5, lower: 0xcfb58c, trim: 0xb39670, kind: 'wood', lowerTop: 1.1, skirt: 0.1, rail: 0.025, peel: 0.08, panel: 0.14},
    floor: ['wood', 0xc9a674],
    ceil: ['plain', 0xf2efe8],
    upper: {wall: {paint: 0xe3e6dc, lower: 0xcfb58c, trim: 0xb39670, kind: 'wood', lowerTop: 1.1, skirt: 0.1, rail: 0.025, peel: 0.08, panel: 0.14}},
  },
};
