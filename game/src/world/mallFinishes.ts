// Task track3-eaton-centre-20261031 (lane ARCH): The Eaton's Center surface finishes — PURE DATA (no three.js).
//
// User: "make sure the walls are different. I know in the office level initially the walls were not different, apply different
// textures and different flooring stuff like that really make it feel alive and distinct". Every mall surface resolves to a
// FINISH: a wall / floor / ceiling pattern code + colours + parameters, read per vertex by the shared mall surface shaders
// (world/mallSurfaces.ts: ONE program per surface kind, the finish row index is a vertex attribute), so a ring full of shops in
// twenty different programs costs the same draw calls as one finish (bounded material count, no per-shop material).
//  - common spaces: concentric-ring terrazzo plaza at the pit bottom; polished terrazzo galleries (a slightly different palette
//    per ring: you can tell Level 2 from Level 5 by the floor); dark stone bridge decks; white rendered gallery walls and slab
//    fascias with shadow-gap reveals (the reference's white atrium);
//  - shops: a distinct wall (upper + lower pattern), floor and ceiling per program (gun shop dark board-formed concrete over
//    walnut wainscot on polished dark concrete under an open black ceiling, pharmacy white tile over mint tile on clinical vinyl,
//    electronics graphite with a cyan band on dark porcelain, clothing greige over oak on oak planks under timber slats, food
//    court white tile with a red band on a black / white checker, ...), never the station's tile / painted block or the office's
//    plasterboard;
//  - back of house: painted concrete block (service corridors with a safety stripe, stock rooms in the shop's accent dado),
//    concrete stair cores, tiled washrooms, raw plant rooms;
//  - the station storey keeps its own subway finishes (the builder's station materials).
// Colours are sRGB hex (converted to linear by the shader table). Codes are small integers matched in the shaders.

import type {MallProgram} from '../gen/mall/mallTypes';

/** Wall pattern codes (world/mallSurfaces.ts WALL graph). */
export const WALL = {
  plain: 0, block: 1, tile: 2, slat: 3, peg: 4, plank: 5, concrete: 6, stone: 7, brick: 8, stripe: 9, diamond: 10, band: 11, fascia: 12,
} as const;
/** Floor pattern codes (FLOOR graph). */
export const FLOOR = {
  terrazzo: 0, rings: 1, stone: 2, tile: 3, checker: 4, plank: 5, concrete: 6, vinyl: 7, carpet: 8,
} as const;
/** Ceiling pattern codes (CEIL graph). */
export const CEIL = {plaster: 0, grid: 1, open: 2, slats: 3, panel: 4} as const;

export type WallCode = (typeof WALL)[keyof typeof WALL];
export type FloorCode = (typeof FLOOR)[keyof typeof FLOOR];
export type CeilCode = (typeof CEIL)[keyof typeof CEIL];

/** A wall finish: an upper pattern over a lower (wainscot / dado) pattern, skirting and a trim colour. */
export interface MallWallFinish {
  upper: WallCode; upperColor: number;
  lower: WallCode; lowerColor: number;
  /** Top of the lower zone above the floor (m; 0 = none). */
  lowerTop: number;
  /** Skirting height (m; 0 = none) and trim / rail / accent band colour. */
  skirt: number; trim: number;
  /** Pattern scale (m): tile size, plank / slat / stripe width, block / brick course (pattern dependent). */
  scale: number;
  /** Accent band height above the floor (band / tile codes; 0 = none) and roughness. */
  band: number; rough: number;
}

/** A floor finish: pattern, two / three colours, module size (m), roughness. */
export interface MallFloorFinish {
  code: FloorCode; a: number; b: number; c: number;
  /** Module (m): tile / plank width / divider spacing. */
  w: number; d: number;
  rough: number;
}

export interface MallCeilFinish { code: CeilCode; a: number; b: number; module: number; rough: number }

/** The finish set of one program / space. */
export interface MallFinishSet { wall: MallWallFinish; floor: MallFloorFinish; ceil: MallCeilFinish }

const W = (o: Partial<MallWallFinish> & Pick<MallWallFinish, 'upper' | 'upperColor'>): MallWallFinish =>
  ({lower: o.upper, lowerColor: o.upperColor, lowerTop: 0, skirt: 0.1, trim: 0x2c2c2e, scale: 0.6, band: 0, rough: 0.85, ...o});
const F = (code: FloorCode, a: number, b: number, c: number, w: number, d: number, rough: number): MallFloorFinish => ({code, a, b, c, w, d, rough});
const C = (code: CeilCode, a: number, b: number, module: number, rough = 0.9): MallCeilFinish => ({code, a, b, module, rough});

/**
 * Shop finishes per program. Distinct per program (tests/mall-arch.test.ts: no two programs share a wall + floor signature, none
 * uses the station or office wall keys). Programs whose themes are close still differ in pattern AND colour.
 */
export const PROGRAM_FINISH: Record<MallProgram, MallFinishSet> = {
  // Guns / outdoors: dark board-formed concrete over a walnut wainscot, polished dark concrete, open black ceiling.
  guns: {wall: W({upper: WALL.concrete, upperColor: 0x5b5a55, lower: WALL.plank, lowerColor: 0x4a3020, lowerTop: 1.2, skirt: 0.12, trim: 0x161616, scale: 1.2, rough: 0.8}),
    floor: F(FLOOR.concrete, 0x4e4d49, 0x3a3936, 0x2a2a28, 2.4, 2.4, 0.45), ceil: C(CEIL.open, 0x1f2021, 0x111212, 2.4)},
  outdoors: {wall: W({upper: WALL.plank, upperColor: 0x8b6744, lower: WALL.brick, lowerColor: 0x6e4434, lowerTop: 1.0, trim: 0x2a2018, scale: 0.18, rough: 0.9}),
    floor: F(FLOOR.plank, 0x6f5236, 0x4a3522, 0x2c2018, 0.24, 1.8, 0.7), ceil: C(CEIL.open, 0x2a2e2a, 0x1a1c1a, 2.4)},
  // Pharmacy / clinic: clinical white tile over a mint tile dado, pale sheet vinyl, white T-bar grid.
  pharmacy: {wall: W({upper: WALL.tile, upperColor: 0xe6ebe8, lower: WALL.tile, lowerColor: 0x9fd4c0, lowerTop: 1.2, skirt: 0.1, trim: 0x5fa88e, scale: 0.3, band: 1.2, rough: 0.35}),
    floor: F(FLOOR.vinyl, 0xd5d9d3, 0x9fd4c0, 0xb9c0b8, 1.8, 1.8, 0.45), ceil: C(CEIL.grid, 0xf2f2ee, 0xd6d8d4, 0.6)},
  clinic: {wall: W({upper: WALL.plain, upperColor: 0xdde6ea, lower: WALL.plain, lowerColor: 0x9fbccc, lowerTop: 1.0, skirt: 0.1, trim: 0x6d8fa0, rough: 0.6}),
    floor: F(FLOOR.vinyl, 0xb8c4c8, 0x6d8fa0, 0x9aa8ad, 1.2, 1.2, 0.5), ceil: C(CEIL.grid, 0xeef0f0, 0xcfd3d4, 0.6)},
  // Electronics / phone / hardware: graphite with a cyan band on dark porcelain; white gloss phone store; pegboard hardware.
  electronics: {wall: W({upper: WALL.band, upperColor: 0x2b2e33, lower: WALL.slat, lowerColor: 0x23262a, lowerTop: 1.1, trim: 0x2aa8c8, scale: 0.12, band: 2.5, rough: 0.55}),
    floor: F(FLOOR.tile, 0x3c3f43, 0x2a2c2f, 0x55595e, 0.6, 0.6, 0.35), ceil: C(CEIL.open, 0x1b1c1e, 0x0f1011, 2.4)},
  phone: {wall: W({upper: WALL.plain, upperColor: 0xeeeeec, lower: WALL.stone, lowerColor: 0xb9bbbd, lowerTop: 0.9, trim: 0xe0702a, scale: 1.2, rough: 0.4}),
    floor: F(FLOOR.tile, 0xcfd0cf, 0xb5b7b6, 0xe4e4e2, 0.6, 0.6, 0.3), ceil: C(CEIL.plaster, 0xf0f0ee, 0xdcdcda, 1.2)},
  hardware: {wall: W({upper: WALL.peg, upperColor: 0x9a7a52, lower: WALL.block, lowerColor: 0x7d8288, lowerTop: 1.0, trim: 0xd29a1e, scale: 0.1, rough: 0.9}),
    floor: F(FLOOR.concrete, 0x8a8780, 0x6e6c66, 0x5a5854, 3.0, 3.0, 0.6), ceil: C(CEIL.open, 0x4a4c4e, 0x2e3032, 2.4)},
  // Clothing / shoes / department: warm boutique wood; white slatwall shoe wall on travertine; marble anchor store.
  clothing: {wall: W({upper: WALL.plain, upperColor: 0xd9cfc0, lower: WALL.plank, lowerColor: 0xa47a50, lowerTop: 1.0, trim: 0x6a4a30, scale: 0.15, rough: 0.75}),
    floor: F(FLOOR.plank, 0xb08a60, 0x8a6a48, 0x5e4630, 0.18, 1.2, 0.55), ceil: C(CEIL.slats, 0xa07850, 0x2a2420, 0.15)},
  shoes: {wall: W({upper: WALL.slat, upperColor: 0xe8e6e0, lower: WALL.plain, lowerColor: 0x3a3a3c, lowerTop: 0.45, trim: 0x2a2a2c, scale: 0.15, rough: 0.6}),
    floor: F(FLOOR.stone, 0xc8b89e, 0xa89878, 0x8a7c64, 0.9, 0.6, 0.4), ceil: C(CEIL.plaster, 0xeeeae2, 0xd8d4cc, 1.2)},
  department: {wall: W({upper: WALL.stone, upperColor: 0xdcd6cc, lower: WALL.stone, lowerColor: 0xc4bcae, lowerTop: 0.3, skirt: 0, trim: 0x8a7a62, scale: 1.2, rough: 0.35}),
    floor: F(FLOOR.stone, 0xd6cfc2, 0xb8ae9e, 0x9c9282, 1.2, 1.2, 0.25), ceil: C(CEIL.plaster, 0xf2efe8, 0xdedad2, 1.8)},
  // Food: tiled food court (white tile, red band, black / white checker), brick cafe on a brown checker, green grocer tile.
  'food-court': {wall: W({upper: WALL.tile, upperColor: 0xe9e6de, lower: WALL.tile, lowerColor: 0xa8553a, lowerTop: 1.1, trim: 0xb03a2e, scale: 0.15, band: 1.6, rough: 0.35}),
    floor: F(FLOOR.checker, 0x232323, 0xe0ddd5, 0x8a8680, 0.3, 0.3, 0.35), ceil: C(CEIL.panel, 0xb8bcbe, 0x8a8e90, 0.6, 0.5)},
  cafe: {wall: W({upper: WALL.brick, upperColor: 0x8a4c38, lower: WALL.plank, lowerColor: 0x4e3424, lowerTop: 1.05, trim: 0x2a1c14, scale: 0.075, rough: 0.9}),
    floor: F(FLOOR.checker, 0x6a4a32, 0xd8c8a8, 0x4a3424, 0.25, 0.25, 0.45), ceil: C(CEIL.slats, 0x4a3424, 0x1a1410, 0.12)},
  grocery: {wall: W({upper: WALL.plain, upperColor: 0xcfdcc6, lower: WALL.tile, lowerColor: 0x6f9a6a, lowerTop: 1.3, trim: 0x3e6a3a, scale: 0.2, rough: 0.5}),
    floor: F(FLOOR.tile, 0xc8c0ae, 0xa49c8a, 0xd8d2c2, 0.3, 0.3, 0.45), ceil: C(CEIL.grid, 0xeeeee8, 0xc8cac4, 0.6)},
  // Books: deep green over a walnut wainscot, oak planks, cream plaster.
  books: {wall: W({upper: WALL.plain, upperColor: 0x2f4a3c, lower: WALL.plank, lowerColor: 0x5a3c26, lowerTop: 1.1, trim: 0xb08a3a, scale: 0.3, rough: 0.8}),
    floor: F(FLOOR.plank, 0x6a4a30, 0x4e3624, 0x3a2818, 0.14, 0.9, 0.6), ceil: C(CEIL.plaster, 0xe6dccb, 0xcfc4b0, 1.2)},
  // Toys: yellow / sky-blue diamond paper over a red dado, blue / white checker.
  toys: {wall: W({upper: WALL.diamond, upperColor: 0xe8c547, lower: WALL.plain, lowerColor: 0xc8413a, lowerTop: 0.9, trim: 0x5aa9d6, scale: 0.6, rough: 0.7}),
    floor: F(FLOOR.checker, 0x3a7fc1, 0xe8e8e8, 0xd0d0d0, 0.5, 0.5, 0.5), ceil: C(CEIL.grid, 0xf4f4f0, 0xe0c84a, 0.6)},
  // Sports: navy with a red band over grey slatwall, maple gym strips, open ceiling.
  sports: {wall: W({upper: WALL.band, upperColor: 0x23304a, lower: WALL.slat, lowerColor: 0x8a8e92, lowerTop: 1.2, trim: 0xc8323a, scale: 0.15, band: 2.2, rough: 0.6}),
    floor: F(FLOOR.plank, 0xc49a62, 0xa47c48, 0x8a6638, 0.06, 2.4, 0.4), ceil: C(CEIL.open, 0x23262c, 0x14161a, 2.4)},
  // Jewellery: black marble with gold veins, white marble floor.
  jewelry: {wall: W({upper: WALL.stone, upperColor: 0x24221f, lower: WALL.stone, lowerColor: 0x2e2b27, lowerTop: 0.1, skirt: 0, trim: 0xb8963e, scale: 0.9, rough: 0.2}),
    floor: F(FLOOR.stone, 0xe6e2da, 0xcfc8bc, 0xb8963e, 0.6, 0.6, 0.18), ceil: C(CEIL.plaster, 0xf4efe4, 0xe0d8c8, 1.2)},
  // Home: sage / cream striped paper over a white wainscot, oak planks.
  home: {wall: W({upper: WALL.stripe, upperColor: 0xa9b79a, lower: WALL.plank, lowerColor: 0xe2ded4, lowerTop: 1.0, trim: 0xd8d2c4, scale: 0.12, rough: 0.8}),
    floor: F(FLOOR.plank, 0x8f6c48, 0x6e5236, 0x4e3a26, 0.2, 1.5, 0.55), ceil: C(CEIL.plaster, 0xf0ece2, 0xdcd8ce, 1.2)},
  // Beauty: blush pink over white marble, white gloss tile.
  beauty: {wall: W({upper: WALL.plain, upperColor: 0xe8c8c4, lower: WALL.stone, lowerColor: 0xe8e4de, lowerTop: 1.0, trim: 0xc8a08a, scale: 0.8, rough: 0.45}),
    floor: F(FLOOR.tile, 0xeeeae6, 0xd8d2cc, 0xf6f4f0, 0.6, 0.6, 0.2), ceil: C(CEIL.plaster, 0xf6f0ee, 0xe6dcd8, 1.2)},
  // Music: black with a purple band over dark planks, black / white checker.
  music: {wall: W({upper: WALL.band, upperColor: 0x1c1c1e, lower: WALL.plank, lowerColor: 0x3a2a20, lowerTop: 1.0, trim: 0x7a3fa8, scale: 0.2, band: 2.3, rough: 0.7}),
    floor: F(FLOOR.checker, 0x161616, 0xd8d6d0, 0x6a6a6a, 0.3, 0.3, 0.4), ceil: C(CEIL.open, 0x18181a, 0x0c0c0e, 2.4)},
  // Pet: light teal over white tile, pale vinyl.
  pet: {wall: W({upper: WALL.plain, upperColor: 0xbfe0da, lower: WALL.tile, lowerColor: 0xeef0ec, lowerTop: 1.2, trim: 0x3e8a80, scale: 0.2, rough: 0.55}),
    floor: F(FLOOR.vinyl, 0xc9d2c4, 0x3e8a80, 0xaab4a6, 1.5, 1.5, 0.5), ceil: C(CEIL.grid, 0xf0f2ee, 0xcfd4ce, 0.6)},
  // Arcade: near-black with a magenta band over a cyan-banded dado, confetti carpet.
  arcade: {wall: W({upper: WALL.band, upperColor: 0x141418, lower: WALL.band, lowerColor: 0x101014, lowerTop: 0.8, trim: 0xd23ca0, scale: 0.4, band: 2.4, rough: 0.7}),
    floor: F(FLOOR.carpet, 0x1d2140, 0xd23ca0, 0x2ad0d8, 0.5, 0.5, 1.0), ceil: C(CEIL.open, 0x101012, 0x08080a, 2.4)},
  // Luggage: taupe over dark wood, charcoal carpet.
  luggage: {wall: W({upper: WALL.plain, upperColor: 0xb8ab98, lower: WALL.plank, lowerColor: 0x4e3a2a, lowerTop: 0.95, trim: 0x2e2218, scale: 0.4, rough: 0.8}),
    floor: F(FLOOR.carpet, 0x3c3c40, 0x56565c, 0x2a2a2e, 0.5, 0.5, 1.0), ceil: C(CEIL.plaster, 0xe8e2d8, 0xd4ccc0, 1.2)},
  // Optical: clean white over pale stone, white oak.
  optical: {wall: W({upper: WALL.plain, upperColor: 0xf0f0ee, lower: WALL.stone, lowerColor: 0xc8cacb, lowerTop: 1.0, trim: 0x2c4a6a, scale: 0.6, rough: 0.4}),
    floor: F(FLOOR.plank, 0xc8b496, 0xa8946e, 0x8a7656, 0.2, 2.0, 0.45), ceil: C(CEIL.plaster, 0xf6f6f4, 0xe0e0de, 1.2)},
  // Florist: whitewashed brick over green tile, terracotta floor tile.
  florist: {wall: W({upper: WALL.brick, upperColor: 0xd8d0c4, lower: WALL.tile, lowerColor: 0x5a8a5a, lowerTop: 0.9, trim: 0x3a5a3a, scale: 0.075, rough: 0.85}),
    floor: F(FLOOR.tile, 0xa2583c, 0x7e4430, 0xb86a4a, 0.3, 0.3, 0.6), ceil: C(CEIL.slats, 0x9a8a6a, 0x2a2620, 0.2)},
  // Kiosk: white with a bronze accent on the gallery terrazzo.
  kiosk: {wall: W({upper: WALL.plain, upperColor: 0xe6e2da, lower: WALL.stone, lowerColor: 0x8a7a62, lowerTop: 1.0, trim: 0x6a5a42, scale: 0.6, rough: 0.5}),
    floor: F(FLOOR.terrazzo, 0xd2cbbd, 0x6a645a, 0x8a6a3a, 1.8, 1.8, 0.35), ceil: C(CEIL.plaster, 0xf0eee8, 0xdad8d2, 1.2)},
  // Service unit (security / customer service): painted block, vinyl, grid.
  service: {wall: W({upper: WALL.block, upperColor: 0xc9c6b8, lower: WALL.block, lowerColor: 0x6a7a86, lowerTop: 1.0, trim: 0x2c3a46, scale: 0.4, rough: 0.85}),
    floor: F(FLOOR.vinyl, 0xa8aca4, 0x6a7a86, 0x8a8e88, 0.6, 0.6, 0.6), ceil: C(CEIL.grid, 0xe6e6e0, 0xc4c6c0, 0.6)},
  // Vacant: stripped to bare block and concrete (adhesive marks), the services exposed.
  vacant: {wall: W({upper: WALL.block, upperColor: 0x9a9893, lower: WALL.block, lowerColor: 0x8e8c87, lowerTop: 0, skirt: 0, trim: 0x6a6864, scale: 0.4, rough: 0.95}),
    floor: F(FLOOR.concrete, 0x86837c, 0x5e5c56, 0x4a4844, 1.8, 1.8, 0.8), ceil: C(CEIL.open, 0x5a5c5e, 0x3a3c3e, 2.4)},
};

/** Common (public) spaces and back of house. */
export const SPACE_FINISH = {
  /** Gallery walls above / between the shopfronts: white render, a pale stone base (the reference's white atrium). */
  galleryWall: W({upper: WALL.plain, upperColor: 0xe8e6e0, lower: WALL.stone, lowerColor: 0xc6c0b4, lowerTop: 0.35, skirt: 0, trim: 0x9a9284, scale: 1.2, rough: 0.6}),
  /** Slab edge fascias facing the void: white render, shadow-gap reveals, a dark soffit edge. */
  fascia: W({upper: WALL.fascia, upperColor: 0xeceae4, lower: WALL.fascia, lowerColor: 0xeceae4, lowerTop: 0, skirt: 0, trim: 0x34363a, scale: 1, rough: 0.55}),
  /** Gallery ceilings / soffits: white plaster. */
  galleryCeil: C(CEIL.plaster, 0xf0eee8, 0xdcd9d2, 1.2, 0.85),
  /** Bridge decks: dark polished stone with a light border band. */
  bridgeFloor: F(FLOOR.stone, 0x5a5650, 0x3e3b37, 0xc6bfb2, 1.2, 0.6, 0.25),
  // Back of house.
  corridorWall: W({upper: WALL.block, upperColor: 0xc4c8bc, lower: WALL.block, lowerColor: 0x5f6466, lowerTop: 1.0, skirt: 0.12, trim: 0xd8a51e, scale: 0.4, band: 1.0, rough: 0.9}),
  stockWall: W({upper: WALL.block, upperColor: 0xd6d2c6, lower: WALL.block, lowerColor: 0x8a8880, lowerTop: 1.2, skirt: 0.1, trim: 0x4a4844, scale: 0.4, rough: 0.9}),
  coreWall: W({upper: WALL.concrete, upperColor: 0x9a9890, lower: WALL.concrete, lowerColor: 0x6b6e6a, lowerTop: 1.0, skirt: 0.1, trim: 0xc89a1e, scale: 1.2, rough: 0.85}),
  washWall: W({upper: WALL.plain, upperColor: 0xdedcd4, lower: WALL.tile, lowerColor: 0xb8c4c6, lowerTop: 2.0, skirt: 0, trim: 0x8a9496, scale: 0.2, rough: 0.4}),
  plantWall: W({upper: WALL.concrete, upperColor: 0x86847e, lower: WALL.concrete, lowerColor: 0x86847e, lowerTop: 0, skirt: 0.15, trim: 0x2a2a2a, scale: 1.5, rough: 0.95}),
  corridorFloor: F(FLOOR.vinyl, 0x8e928a, 0x5f6466, 0x7a7e76, 0.3, 0.3, 0.6),
  stockFloor: F(FLOOR.concrete, 0x7e7b74, 0x5c5a54, 0x4a4844, 2.4, 2.4, 0.75),
  coreFloor: F(FLOOR.concrete, 0x6f726e, 0x555754, 0x444644, 50, 50, 0.7),
  washFloor: F(FLOOR.tile, 0x8e9392, 0x6a6e6d, 0x9aa09f, 0.2, 0.2, 0.45),
  bohCeil: C(CEIL.grid, 0xd8d6ce, 0xb4b2aa, 0.6),
  coreCeil: C(CEIL.plaster, 0x9a9890, 0x8a8880, 1, 0.9),
  plantCeil: C(CEIL.open, 0x55585a, 0x3a3c3e, 2.4),
} as const;

/**
 * Gallery floor terrazzo per ring (index = ring 1..6; 0 = the station plaza courts): a cream binder with grey / bronze chips, the
 * palette shifting a little per ring (warm cream, grey, sand, cool, pale green-grey, charcoal) so each storey reads as its own.
 */
export const GALLERY_FLOOR: readonly MallFloorFinish[] = [
  F(FLOOR.terrazzo, 0xd8d0c0, 0x5a554c, 0x9a7a4a, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0xddd4c2, 0x4e4a44, 0xa07c48, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0xc9c8c2, 0x3e3e40, 0x8a8a8c, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0xd6c8ac, 0x6a5a44, 0xb08a52, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0xc4cac8, 0x4a5256, 0x7a8a90, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0xc8d0c4, 0x4a5a4c, 0x8a9a7a, 1.8, 1.8, 0.3),
  F(FLOOR.terrazzo, 0x9a9690, 0x2e2c2a, 0xc8c0b0, 1.8, 1.8, 0.3),
];

/** The concentric-ring terrazzo of the pit-bottom plaza: black / grey / cream bands (reference photo), ring module (m). */
export const PLAZA_FLOOR: MallFloorFinish = F(FLOOR.rings, 0xddd6c6, 0x2c2b29, 0x8e8b84, 1.3, 1.3, 0.3);

/** Stable signature of a finish set (distinctness tests). */
export function finishSignature(f: MallFinishSet): string {
  const w = f.wall, fl = f.floor;
  return `${w.upper}:${w.upperColor.toString(16)}|${w.lower}:${w.lowerColor.toString(16)}@${w.lowerTop}|${fl.code}:${fl.a.toString(16)}:${fl.b.toString(16)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Area classes of the mall (which finish a surface takes)

/** What a mall area is for its finishes. */
export type MallSpace = 'gallery' | 'bridge' | 'plaza' | 'shop' | 'stock' | 'corridor' | 'core' | 'wash' | 'plant' | 'station';

/** Back-of-house class of a non-shop, non-gallery area from its type / purpose / label (robust to GEN's naming). */
export function bohClass(a: {type?: string; kind?: string; purpose?: string; label?: string; role?: string; publicSpace?: boolean} | undefined): MallSpace {
  if (!a) return 'corridor';
  const s = `${a.type ?? ''} ${a.purpose ?? ''} ${a.label ?? ''} ${a.role ?? ''}`.toLowerCase();
  if (/stair|landing|lift|elevator|shaft|riser|ladder/.test(s) || a.kind === 'closet') return 'core';
  if (/wash ?room|toilet|restroom|\bwc\b|shower|locker/.test(s)) return 'wash';
  if (/plant|mechanical|electrical|boiler|pump|loading|dock|refuse|compactor|generator/.test(s)) return 'plant';
  if (/stock|storage|store ?room|backroom|back room|receiving|warehouse|supply/.test(s)) return 'stock';
  return 'corridor';
}

/** Finishes of a back-of-house class. */
export function bohFinish(c: MallSpace): MallFinishSet {
  const S = SPACE_FINISH;
  switch (c) {
    case 'core': return {wall: S.coreWall, floor: S.coreFloor, ceil: S.coreCeil};
    case 'wash': return {wall: S.washWall, floor: S.washFloor, ceil: S.bohCeil};
    case 'plant': return {wall: S.plantWall, floor: S.stockFloor, ceil: S.plantCeil};
    case 'stock': return {wall: S.stockWall, floor: S.stockFloor, ceil: S.bohCeil};
    default: return {wall: S.corridorWall, floor: S.corridorFloor, ceil: S.bohCeil};
  }
}

/** A shop's stock room: the stock-room block walls with the program's trim colour as the dado (a hint of the brand). */
export function stockFinish(program: MallProgram): MallFinishSet {
  const base = bohFinish('stock');
  const accent = PROGRAM_FINISH[program].wall.trim;
  return {...base, wall: {...base.wall, lowerColor: mixHex(base.wall.lowerColor, accent, 0.45), trim: accent}};
}

/** sRGB mix of two hex colours. */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (x: number, s: number) => (x >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return (m(16) | m(8) | m(0)) >>> 0;
}
