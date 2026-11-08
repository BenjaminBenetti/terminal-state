// Task studio-skywalk-variety-20261107-231448-01 (lane MERCH; user: "items on top of counters / shelves should not be part of the
// counter / shelf and have physics, when shot!" — "cover other affected Skyways counter / shelf items consistently"). The merchandise
// still drawn AS PART of a shop fixture is split off as separate, ordinary movable stock in Skyways layout version 4
// (gen/skyways/skywaysMerchSplit.ts, gated on skywaysGenVersion(layout) >= 4; versions 1-3 and every other level keep their fixtures):
//  - techDisplay (the phone shop's demo table): its six demo phones / tablets on their stands were authored box parts of the table
//    (gen/purposeShapes.ts techDisplay). Split: the bare table (its own variant MERCH_BARE_VARIANT: the same parts without the devices,
//    the box down to the 0.76 m top) and six skyMerchDemoPhone / skyMerchDemoTablet props carrying exactly those parts;
//  - deviceWall (tech-display-t25.glb: Meshy T2.5, maps kept): its four display devices on stands were part of the model. Split: the
//    model's own triangles are cut deterministically at runtime (world/skywaysMerch.ts: exact plane cuts of the fitted mesh, the GLB on
//    disk untouched) into the bare wall unit (variant MERCH_BARE_VARIANT) and four skyMerchWallPhone / skyMerchWallTablet props drawn by
//    their own cut triangles with the model's material;
//  - skyMuFacedRecords (one prop for five LP sleeves on a new-arrivals ledge): split into five skyMerchFacedLp sleeves (one cover each)
//    standing on the cover wall's declared ledges.
// (magazineRack / flowerStand need nothing: their stock is already separate physical filler on their real boards — world/shelfStock.ts,
// world/shelfStockCarcass.ts displayTreatment / AUTHORED_CARCASS.)
//
// Affordances (root CLAUDE.md "Props — core design rules"): rule 1 none is storage; rule 2 all are dynamic on-host decor on a known open
// support (physics/merchOnHost.ts: the table top, the wall unit's declared deck, the cover wall's declared ledges) — a shot knocks them
// over / off, nothing is held static; rule 4 nothing baked any more; rule 5 the same geometry at the same size as before the split
// (scale record below). Pure data (no three.js, no dressers).

import type {DestDrawnPart, DestKindSpec} from '../../destinations/kindTypes';
import {COVER_WALL, LP_SLEEVE, facedLean} from '../musicStock';

export const STORE_MERCH_KINDS = ['skyMerchDemoPhone', 'skyMerchDemoTablet', 'skyMerchWallPhone', 'skyMerchWallTablet', 'skyMerchFacedLp'] as const;
export type StoreMerchKind = (typeof STORE_MERCH_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(STORE_MERCH_KINDS);
export const isStoreMerchKind = (k: string): k is StoreMerchKind => KIND_SET.has(k);

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The variant of a techDisplay / deviceWall whose merchandise stands as separate props (drawn bare). Other levels use 0 only. */
export const MERCH_BARE_VARIANT = 1;

// ---------------------------------------------------------------------------------------------
// The demo table's devices (gen/purposeShapes.ts techDisplay, its device parts unchanged)

/** The demo table's top (m) and its devices: host-local x / z, phone or tablet, facing (row 1 faces -Z: turned half a turn). */
export const DEMO_TABLE = {
  top: 0.76,
  devices: [0, 1].flatMap(row => [-0.5, 0, 0.5].map((x, i) => ({x, z: row ? -0.2 : 0.2, phone: (i + row) % 2 === 1, turn: row === 1}))),
} as const;
/** Device sizes of the table's parts: phone 0.08 x 0.13, tablet 0.2 x 0.12 (m), 12 mm thick, leaning back 0.45 rad on a stand. */
const DEMO_DEV = {phone: [0.08, 0.13], tablet: [0.2, 0.12], t: 0.012, lean: -0.45, stand: {w: 0.08, h: 0.03, d: 0.06}} as const;

/** One demo device on its stand (prop frame: origin on the table top under the stand, front +Z) — the table's own parts, moved here. */
export function demoDeviceParts(phone: boolean): DestDrawnPart[] {
  const [dw, dh] = phone ? DEMO_DEV.phone : DEMO_DEV.tablet, rx = DEMO_DEV.lean, S = DEMO_DEV.stand;
  const ny = -Math.sin(rx), nz = Math.cos(rx), cy = S.h + dh / 2;
  return [
    {m: 'black', s: [S.w, S.h, S.d], p: [0, S.h / 2, 0]},
    {m: 'black', s: [dw, dh, DEMO_DEV.t], p: [0, cy, 0], rx},
    {m: 'deviceScreen', s: [r3(dw - 0.014), r3(dh - 0.016), 0.004], p: [0, r3(cy + ny * 0.008), r3(nz * 0.008)], rx},
  ];
}
/** The box of a demo device on its stand (m): the stand's footprint / the leaning device. */
function demoBox(phone: boolean): {w: number; h: number; d: number} {
  const [dw, dh] = phone ? DEMO_DEV.phone : DEMO_DEV.tablet, a = -DEMO_DEV.lean, S = DEMO_DEV.stand, t = DEMO_DEV.t;
  const top = S.h + dh / 2 + (dh / 2) * Math.cos(a) + (t / 2) * Math.sin(a), deep = dh * Math.sin(a) + t * Math.cos(a);
  return {w: r3(Math.max(S.w, dw) + 0.004), h: r3(top + 0.004), d: r3(Math.max(S.d, deep) + 0.004)};
}

// ---------------------------------------------------------------------------------------------
// The device wall's display devices (tech-display-t25.glb fitted to deviceWall 1.1 x 2.0 x 0.58)

/**
 * The runtime cut of the device wall model (prop frame): triangles with their centroid in y0..y1 / z0..z1 (above the 0.849 m cabinet
 * deck, in front of the pegboard and its hanging accessory cards) belong to a device, split at the xs planes left to right (phone,
 * tablet, phone, tablet); everything else is the wall unit. Exact plane cuts (world/meshSplit.ts partition).
 */
export const WALL_DEVICE_CUT = {y0: 0.853, y1: 1.12, z0: -0.11, z1: 0.29, xs: [-0.3, -0.02, 0.245]} as const;
/** The cabinet deck the devices stand on (m above the unit's base; world/shelfStockCarcass.ts DEVICE_WALL_DECK, ray-cast). */
export const WALL_DEVICE_DECK_Y = 0.849;
/**
 * The four devices left to right as measured from their cut triangles (tests/skyways-merch-split.test.ts checks them against the GLB):
 * the box (prop frame of the wall unit) — the prop stands at its bottom centre and draws its triangles relative to it.
 */
export const WALL_DEVICES: readonly {kind: 'skyMerchWallPhone' | 'skyMerchWallTablet'; variant: number; x0: number; x1: number; y1: number; z0: number; z1: number}[] = [
  {kind: 'skyMerchWallPhone', variant: 0, x0: -0.472, x1: -0.339, y1: 1.032, z0: -0.028, z1: 0.133},
  {kind: 'skyMerchWallTablet', variant: 0, x0: -0.268, x1: -0.048, y1: 1.079, z0: -0.091, z1: 0.118},
  {kind: 'skyMerchWallPhone', variant: 1, x0: 0.059, x1: 0.225, y1: 1.035, z0: -0.04, z1: 0.118},
  {kind: 'skyMerchWallTablet', variant: 1, x0: 0.268, x1: 0.489, y1: 1.05, z0: -0.102, z1: 0.138},
];
/** A wall device's cut bucket (1..4, left to right). */
export const wallDeviceBucket = (kind: string, variant: number): number => 1 + WALL_DEVICES.findIndex(d => d.kind === kind && d.variant === ((variant % 2) + 2) % 2);
/** Largest box of a kind's devices (its collider: the prop's def). */
function wallBox(kind: 'skyMerchWallPhone' | 'skyMerchWallTablet'): {w: number; h: number; d: number} {
  const ds = WALL_DEVICES.filter(d => d.kind === kind);
  return {w: r3(Math.max(...ds.map(d => d.x1 - d.x0))), h: r3(Math.max(...ds.map(d => d.y1 - WALL_DEVICE_CUT.y0))), d: r3(Math.max(...ds.map(d => d.z1 - d.z0)))};
}

// ---------------------------------------------------------------------------------------------
// A faced-out LP (one sleeve of a skyMuFacedRecords row: gen/skyways/stores/musicStock.ts facedRow, world/skywaysStoreMusic.ts)

/** One 12-inch sleeve stood on a ledge leaning on the board (prop frame: origin on the ledge top, centred between the board and the lip). */
export const FACED_LP = {w: r3(LP_SLEEVE.s + 0.01), d: COVER_WALL.ledgeD, h: r3(LP_SLEEVE.s * Math.cos(facedLean()) + LP_SLEEVE.t)} as const;

// ---------------------------------------------------------------------------------------------
// Kind specs

const D = (mass: number, how: string) => ({dynamic: true as const, mass, mat: 'pad' as const, shape: 'box' as const, onHost: true, how});
function spec(box: {w: number; h: number; d: number}, s: Omit<DestKindSpec, 'def'>): DestKindSpec {
  const ph = s.phys as {dynamic: true; mass: number; mat: 'pad'; shape: 'box'};
  return {def: {w: box.w, h: box.h, d: box.d, blocksSight: false, physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat, contact: true, onHost: true}}, ...s};
}

export const STORE_MERCH_SPECS: Readonly<Record<StoreMerchKind, DestKindSpec>> = {
  skyMerchDemoPhone: spec(demoBox(true), {
    phys: D(0.3, 'a demo phone on its little stand (~0.3 kg) on the phone shop\'s demo table: a shot knocks it over or off the table (on-host decor)'),
    damage: 'screen', open: {cls: 'none', role: 'equipment', how: 'a demo phone on a stand: nothing to open'},
    parts: () => demoDeviceParts(true),
  }),
  skyMerchDemoTablet: spec(demoBox(false), {
    phys: D(0.7, 'a demo tablet on its stand (~0.7 kg) on the demo table: a shot knocks it over or off the table (on-host decor)'),
    damage: 'screen', open: {cls: 'none', role: 'equipment', how: 'a demo tablet on a stand: nothing to open'},
    parts: () => demoDeviceParts(false),
  }),
  skyMerchWallPhone: spec(wallBox('skyMerchWallPhone'), {
    phys: D(0.35, 'a display phone on its stand (~0.35 kg) on the device wall\'s cabinet deck: a shot knocks it over or off the deck (on-host decor on the unit\'s declared deck)'),
    damage: 'screen', open: {cls: 'none', role: 'equipment', how: 'a display phone on a stand: nothing to open'},
  }),
  skyMerchWallTablet: spec(wallBox('skyMerchWallTablet'), {
    phys: D(0.75, 'a display tablet on its stand (~0.75 kg) on the device wall\'s cabinet deck: a shot knocks it over or off the deck (on-host decor on the unit\'s declared deck)'),
    damage: 'screen', open: {cls: 'none', role: 'equipment', how: 'a display tablet on a stand: nothing to open'},
  }),
  skyMerchFacedLp: spec(FACED_LP, {
    phys: D(0.3, 'one 12-inch LP in its sleeve (~0.3 kg) stood face-out on a ledge of the new-arrivals board: a shot knocks it over the lip (on-host decor on the board\'s declared ledges)'),
    damage: 'cardboard', open: {cls: 'none', role: 'decor', how: 'a record in its sleeve on display: nothing to open (records are not inventory items)'},
  }),
};

/** No Mall model files. */
export const STORE_MERCH_MALL_MODELS: readonly string[] = [];

/**
 * Scale record (root CLAUDE.md rule 5): the same geometry at the same size as before the split, viewed beside zombie `lastshift` at runtime
 * scale 1.0 — `node tools/asset-pipeline/props/scale-check.mjs --prop game/public/assets/models/tech-display-t25.glb --fit 1.1,2.0,0.58`
 * (the unit with its devices, deck 0.85 m) and `--kind techDisplay` (the demo table, top 0.76 m). W x H x D:
 */
export const MERCH_SCALE: Readonly<Record<StoreMerchKind, string>> = {
  skyMerchDemoPhone: '0.08 x 0.16 x 0.07 m on the 0.76 m table top (stand 0.08 x 0.03 x 0.06; phone 0.08 x 0.13 leaning back 26 deg)',
  skyMerchDemoTablet: '0.20 x 0.15 x 0.07 m on the 0.76 m table top (tablet 0.20 x 0.12 leaning back 26 deg)',
  skyMerchWallPhone: '0.13-0.17 x 0.18 x 0.16 m on the 0.85 m cabinet deck (the model\'s two display phones on stands)',
  skyMerchWallTablet: '0.22 x 0.20-0.23 x 0.21-0.24 m on the 0.85 m cabinet deck (the model\'s two display tablets on stands)',
  skyMerchFacedLp: '0.32 x 0.30 x 0.09 m: a 31.5 cm sleeve leaning on the board, on a 9 cm ledge (1.0 / 1.5 / 2.0 m above the floor)',
};
