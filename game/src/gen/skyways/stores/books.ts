// Task studio-alpha-skyways-shops-20261107-054512-01: THE BOOKS STORE (layout version >= 3) — owned by its store agent (lane
// STORE-BOOKS). Contract: gen/skyways/stores/types.ts (SkywaysStoreSpec). The store itself (cash desk, category bays, stacks, reading
// nook, children's corner, rare books, back rooms, loose book stock): stores/booksDress.ts; its two new kinds (category signs, rugs):
// stores/kinds/books.ts; their renderer: world/skywaysStoreBooks.ts. Records: docs/skyways-stores/books.md.
//
// Loot (existing purposes only; Skyways anchor areas at version 3): the sales floor and the other storey are the Mall bookstore
// ('mall-books': what customers leave behind — water, chocolate, cola, a dressing, chips — on the counter's till, in the cash-wrap's
// drawers, the bookcases' base drawers, the glass cabinets), the stock room the Mall bookstore's stock room ('mall-books-back': water,
// chocolate, dressings + the stock-room commons — beans, noodles, a torch cell — in the cartons / cabinets / shelving), the shop office
// the Mall management office ('mall-management': personal desk / drawer stock, no sidearm rows). Per-holder overrides (booksDress.ts
// BOOKS_HOLDER_PURPOSE): the children's dresser rolls the toy store ('mall-toys': sweets, chips, juice, a battery), the staff desk the
// management office's desk.
//
// Palette (user: "distinct major-store walls … wood in the bookstore"): full-height walnut panelling (the Office wood wainscot run floor
// to ceiling, 0.9 m panel seams) with a near-black walnut trim, an oak strip floor and a plain warm ceiling on the sales floor; the
// other storey (the mezzanine / lower floor: children's corner, rare books) an oak wainscot under warm cream plaster on a deep green
// library carpet.

import type {SkywaysStoreSpec} from './types';
import {dressBooksStore} from './booksDress';

export const STORE_BOOKS: SkywaysStoreSpec = {
  family: 'books',
  owner: 'lane STORE-BOOKS',
  dress: (layout, rng, anchor) => dressBooksStore(layout, rng, anchor),
  purposes: {floor: 'mall-books', upper: 'mall-books', stock: 'mall-books-back', office: 'mall-management'},
  finish: {
    wall: {paint: 0xe6dccb, lower: 0x6b4428, trim: 0x2a1a10, kind: 'wood', lowerTop: 4.0, skirt: 0.14, rail: 0.035, peel: 0.18, panel: 0.9},
    floor: ['wood', 0x8a5f3c],
    ceil: ['plain', 0xe8dcc6],
    upper: {
      wall: {paint: 0xe9dcc0, lower: 0x8a5a34, trim: 0x2a1a10, kind: 'wood', lowerTop: 1.15, skirt: 0.14, rail: 0.04, peel: 0.2, panel: 0.6},
      floor: ['carpet', 0x3d5240],
      ceil: ['plain', 0xeee4d0],
    },
  },
};
