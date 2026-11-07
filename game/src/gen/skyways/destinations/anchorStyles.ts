// Task studio-skyways-rework-20261107-054512-01: the ANCHOR STORES' own architecture finishes (user: "distinct major-store walls /
// materials instead of default Subway walls (wood in bookstore etc)"). Pure data, consumed by world/skywaysArch.ts (class 'anchor'):
// every area of an anchor (its sales floor + stair-well pieces, the upper storey, the zones) takes its family's wall / floor / ceiling;
// a zone may override (e.g. the cinema auditorium's dark walls and carpet). The stock rooms keep the back-of-house finish. Render
// only: no layout change, so it reaches stations of every layout version.
//
// Ownership: the CONTENT of this table belongs to the store lanes (the Alpha studio's ten store owners); the wiring belongs to the
// Skyways lead. Finishes reuse the office architecture's programs (world/officeArch.ts): `lower` = the lower wall / full-height
// feature finish ('wood' panelling, 'tile', 'stone', 'concrete', 'paint', 'none'), `lowerTop` its height (m; >= 3 = full height),
// `panel` the panel joint strength (0..1), `peel` the decay; floors 'wood' | 'carpet' | 'tile' | 'stone' | 'vinyl' | 'concrete';
// ceilings 'plain' | 'grid' | 'raw' (exposed concrete). Colours sRGB hex.

import type {SkywaysShopFamily} from '../skywaysTypes';

export type AnchorLower = 'none' | 'paint' | 'wood' | 'tile' | 'stone' | 'concrete';
export type AnchorFloor = 'carpet' | 'vinyl' | 'tile' | 'stone' | 'concrete' | 'wood';
export type AnchorCeiling = 'grid' | 'plain' | 'raw';

export interface AnchorFinish {
  wall: {paint: number; lower: number; trim: number; kind: AnchorLower; lowerTop: number; skirt?: number; rail?: number; panel?: number; peel?: number};
  floor: {kind: AnchorFloor; tint?: number};
  ceiling: {kind: AnchorCeiling; tint?: number};
}
export interface AnchorStyle extends AnchorFinish {
  /** Per-zone overrides (index into SkywaysAnchor.zones: the cinema auditorium, the music booths). */
  zones?: Partial<AnchorFinish>;
}

/** Each family's finishes (defaults by the lead; the store owners refine them). */
export const ANCHOR_STYLES: Record<SkywaysShopFamily, AnchorStyle> = {
  // warm oak panelling to the picture rail, cream plaster over it, oak boards
  books: {wall: {paint: 0xe6dcc6, lower: 0x7a5232, trim: 0x3b2716, kind: 'wood', lowerTop: 2.2, panel: 0.7, peel: 0.15}, floor: {kind: 'wood', tint: 0x8a6440}, ceiling: {kind: 'plain', tint: 0xe9e0cc}},
  // cedar boarding full height, slate floor
  outfitter: {wall: {paint: 0xd8cdb4, lower: 0x9a6a42, trim: 0x2f3a2c, kind: 'wood', lowerTop: 3.2, panel: 0.9, peel: 0.2}, floor: {kind: 'stone', tint: 0x7c7f78}, ceiling: {kind: 'raw'}},
  // dark painted walls, black ceiling, worn vinyl
  music: {wall: {paint: 0x2e2a36, lower: 0x1d1b22, trim: 0x8a6d2a, kind: 'paint', lowerTop: 1.0, panel: 0.2, peel: 0.25}, floor: {kind: 'vinyl', tint: 0x3a3438}, ceiling: {kind: 'raw', tint: 0x2a2a2e}},
  // warm workshop: plywood lower, mustard paint, timber floor
  hobby: {wall: {paint: 0xd9b45e, lower: 0xb08a5a, trim: 0x4a3420, kind: 'wood', lowerTop: 1.2, panel: 0.5, peel: 0.2}, floor: {kind: 'wood', tint: 0xa07a52}, ceiling: {kind: 'plain', tint: 0xeee6d4}},
  // gallery white, pale oak floor
  design: {wall: {paint: 0xf1eee8, lower: 0xe4ded3, trim: 0xc9c2b4, kind: 'paint', lowerTop: 0.12, panel: 0.1, peel: 0.08}, floor: {kind: 'wood', tint: 0xc9ad84}, ceiling: {kind: 'plain', tint: 0xf3f1ec}},
  // glasshouse: whitewashed brick-like tile lower, terracotta tile floor
  garden: {wall: {paint: 0xe8ebe2, lower: 0xb7654a, trim: 0x3d5a3e, kind: 'tile', lowerTop: 1.1, panel: 0.4, peel: 0.3}, floor: {kind: 'tile', tint: 0xa8603f}, ceiling: {kind: 'raw', tint: 0xd8dcd2}},
  // deep violet, black ceiling, carpet
  arcade: {wall: {paint: 0x3a1f52, lower: 0x1c1428, trim: 0xd040c0, kind: 'paint', lowerTop: 1.0, panel: 0.15, peel: 0.2}, floor: {kind: 'carpet', tint: 0x2a1d3d}, ceiling: {kind: 'raw', tint: 0x1c1a22}},
  // red velvet lobby; the auditorium dark
  cinema: {wall: {paint: 0x7a1e26, lower: 0x4a1218, trim: 0xb8923a, kind: 'paint', lowerTop: 1.1, panel: 0.6, peel: 0.2}, floor: {kind: 'carpet', tint: 0x6a1a22}, ceiling: {kind: 'plain', tint: 0x2a1e20},
    zones: {wall: {paint: 0x221a1c, lower: 0x161012, trim: 0x3a2a24, kind: 'paint', lowerTop: 1.0, panel: 0.4, peel: 0.15}, floor: {kind: 'carpet', tint: 0x3a1418}, ceiling: {kind: 'raw', tint: 0x141214}}},
  // midnight blue, star-white trim, stone floor
  science: {wall: {paint: 0x1f3550, lower: 0x172636, trim: 0xd8dde4, kind: 'paint', lowerTop: 1.0, panel: 0.3, peel: 0.15}, floor: {kind: 'stone', tint: 0x6c7480}, ceiling: {kind: 'raw', tint: 0x1a2230}},
  // rink white boards with a blue line, rubber-look floor
  hockey: {wall: {paint: 0xe9edf2, lower: 0xf4f6f8, trim: 0x1d3f8f, kind: 'paint', lowerTop: 1.07, panel: 0.25, peel: 0.15}, floor: {kind: 'vinyl', tint: 0x2c2f33}, ceiling: {kind: 'grid'}},
};
