// Authored, textured box parts for the iteration-05 PURPOSE props (gen/props.ts
// PURPOSE_PROP_KINDS): store fixtures, kitchen lines, back-of-house furniture. Pure data (no
// three.js); world/storefrontBuilder.ts instances them per (kind, shape variant), one merged
// geometry per material key. Primitive forms stay authored per reference/design/ASSET-METHOD-RULE.md;
// Lane A generated models replace a few of them when present (props.ts PURPOSE_MODEL_KEYS).
// Local frame: origin bottom centre, front +Z, metres; every part stays inside PROP_DEFS[kind]
// and out of the loot volumes in PURPOSE_SURFACES (tests/purpose-shapes.test.ts checks both).

import {KITCHEN_LINE, PROP_DEFS, PURPOSE_PROP_KINDS, PURPOSE_SURFACES, SHELF_TIER_Y, type PurposePropKind} from './props';
import type {ShapeMat} from './propShapes';

/**
 * Purpose material keys (world/purposeTextures.ts). stock* = face-mapped rows of packaged goods
 * (a box's front face shows one row, designed for ~3.6:1 faces); others as named.
 */
export const PURPOSE_MAT_KEYS = [
  'stockSnacks', 'stockGrocery', 'stockPharmacy', 'stockCleaning', 'stockDevices', 'stockCartons', 'stockParts',
  'magazines', 'deviceScreen', 'cctv', 'noticeBoard', 'cardboard', 'keyBlanks', 'flowers', 'bread', 'donuts',
  'pizzaBox', 'fruit', 'hazardLabel', 'firstAid', 'vinyl',
  'paintRed', 'paintYellow', 'paintGreen', 'paintWhite', 'paintBlue', 'paintOrange',
] as const;
export type PurposeMat = (typeof PURPOSE_MAT_KEYS)[number];
export type PartMat = ShapeMat | PurposeMat;
export function isPurposeMat(k: string): k is PurposeMat {
  return (PURPOSE_MAT_KEYS as readonly string[]).includes(k);
}

/** Box part: size [x, y, z], centre, optional rotations about X then Y (radians). */
export interface PurposePart { m: PartMat; s: [number, number, number]; p: [number, number, number]; rx?: number; ry?: number }

/** Stock themes for `stockShelf` (variant index) and stock-room shelving. */
export const STOCK_THEMES = ['snacks', 'grocery', 'pharmacy', 'cleaning', 'devices', 'cartons', 'parts'] as const;
export type StockTheme = (typeof STOCK_THEMES)[number];
export const STOCK_MAT: Record<StockTheme, PurposeMat> = {
  snacks: 'stockSnacks', grocery: 'stockGrocery', pharmacy: 'stockPharmacy', cleaning: 'stockCleaning',
  devices: 'stockDevices', cartons: 'stockCartons', parts: 'stockParts',
};
export const stockVariant = (t: StockTheme): number => STOCK_THEMES.indexOf(t);

/**
 * Instance tint of `accent` parts per kind when the prop does not belong to a storefront
 * (storefront props take the brand colour); picked by placement variant/hash.
 */
export const PURPOSE_ACCENT: Partial<Record<PurposePropKind, number[]>> = {
  staffLockers: [0x4f6f8f, 0x5f7a5a, 0x8a8f94, 0x7a5a3a],
  gunLocker: [0x4a5240, 0x3a3f44, 0x5a5a4a],
  hotdogCart: [0xd8402e, 0xf2b632, 0x2f7a78],
  snackRack: [0xd9a520, 0xc0392b, 0x1e88e5],
  magazineRack: [0xb33a2e, 0x283593],
  techDisplay: [0x00acc1, 0x7e57c2],
  deviceWall: [0x00acc1, 0x7e57c2, 0x212121],
  // lane CACHE (round 2, R5): sleeping bags — navy, olive drab, rust, faded teal
  palletBed: [0x2c3f5c, 0x4a5a34, 0x7a3a26, 0x2f5a5a],
};

// ---------------------------------------------------------------------------------------
// Helpers

const box = (m: PartMat, s: [number, number, number], p: [number, number, number], rx?: number, ry?: number): PurposePart => {
  const part: PurposePart = {m, s, p};
  if (rx) part.rx = rx;
  if (ry) part.ry = ry;
  return part;
};
/** Axis-aligned box from its min/max corners. */
const bb = (m: PartMat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PurposePart =>
  ({m, s: [x1 - x0, y1 - y0, z1 - z0], p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]});
/**
 * A box given relative to a vertical hinge at (hx, hz) (local x0..x1 / z0..z1 before rotation),
 * swung by `a` about Y (three.js rotateY: x' = x cos a + z sin a, z' = -x sin a + z cos a).
 */
function hinged(m: PartMat, hx: number, hz: number, a: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): PurposePart {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, c = Math.cos(a), s = Math.sin(a);
  return box(m, [x1 - x0, y1 - y0, z1 - z0], [hx + cx * c + cz * s, (y0 + y1) / 2, hz - cx * s + cz * c], 0, a);
}
/** Front-face normal (y, z) of a box tilted by rx (three.js rotateX: y' = y cos - z sin, z' = y sin + z cos). */
const tiltNormal = (rx: number): [number, number] => [-Math.sin(rx), Math.cos(rx)];
/** Top-face normal (y, z) after rx. */
const tiltUp = (rx: number): [number, number] => [Math.cos(rx), Math.sin(rx)];

// ---------------------------------------------------------------------------------------
// Retail

function shelfFrame(): PurposePart[] {
  const {w, d, h} = PROP_DEFS.stockShelf;
  const out: PurposePart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box('steelDark', [0.035, h, 0.035], [sx * (w / 2 - 0.018), h / 2, sz * (d / 2 - 0.018)]));
  for (const y of SHELF_TIER_Y) {
    out.push(box('steelBright', [w, 0.025, d], [0, y - 0.0125, 0]));
    out.push(box('steelDark', [w, 0.05, 0.012], [0, y - 0.03, d / 2 - 0.006]));
  }
  // Gondola back panel and a header strip over the top deck (behind the loot volumes).
  out.push(bb('panel', -w / 2 + 0.035, SHELF_TIER_Y[0], -d / 2 + 0.002, w / 2 - 0.035, h - 0.02, -d / 2 + 0.01));
  return out;
}

/** Only the themed back stock of a stock shelf (used over the generated shelf model). */
export function stockShelfStock(variant: number): PurposePart[] {
  const m = STOCK_MAT[STOCK_THEMES[shapeVariant('stockShelf', variant)]];
  return [0, 1, 2].map(i => {
    const y = SHELF_TIER_Y[i], ht = Math.min(0.3, SHELF_TIER_Y[i + 1] - y - 0.08);
    return bb(m, -0.53, y, -0.205, 0.53, y + ht, -0.075);
  });
}

function stockShelf(v: number): PurposePart[] {
  return [...shelfFrame(), ...stockShelfStock(v)];
}

function snackRack(): PurposePart[] {
  const {w, d, h} = PROP_DEFS.snackRack;
  const out: PurposePart[] = [bb('black', -w / 2, 0, -d / 2, w / 2, 0.06, d / 2)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box('steelDark', [0.02, h - 0.02, 0.02], [sx * (w / 2 - 0.012), (h - 0.02) / 2, sz * (d / 2 - 0.012)]));
  for (const s of PURPOSE_SURFACES.snackRack) {
    out.push(bb('grille', -w / 2 + 0.02, s.y - 0.012, -d / 2 + 0.02, w / 2 - 0.02, s.y, d / 2 - 0.02));
    out.push(bb('steelBright', -w / 2 + 0.02, s.y + 0.035, d / 2 - 0.016, w / 2 - 0.02, s.y + 0.045, d / 2 - 0.006));
  }
  out.push(bb('grille', -w / 2 + 0.02, 0.2, -d / 2 + 0.004, w / 2 - 0.02, 1.22, -d / 2 + 0.012));
  out.push(bb('accent', -0.27, 1.2, -d / 2 + 0.002, 0.27, h, -d / 2 + 0.016));
  out.push(bb('paintWhite', -0.16, 1.25, -d / 2 + 0.016, 0.16, 1.3, -d / 2 + 0.02));
  return out;
}

function magazineRack(): PurposePart[] {
  const {w, d, h} = PROP_DEFS.magazineRack;
  const out: PurposePart[] = [
    bb('steelDark', -w / 2, 0, -d / 2, w / 2, h - 0.1, -d / 2 + 0.03),
    bb('steelDark', -w / 2, 0, -d / 2, -w / 2 + 0.03, h, d / 2 - 0.02),
    bb('steelDark', w / 2 - 0.03, 0, -d / 2, w / 2, h, d / 2 - 0.02),
    bb('black', -w / 2 + 0.03, 0, -d / 2 + 0.03, w / 2 - 0.03, 0.12, d / 2 - 0.02),
    bb('accent', -w / 2 + 0.03, h - 0.1, -d / 2, w / 2 - 0.03, h, -d / 2 + 0.12),
  ];
  const rx = -0.3;
  const [ny, nz] = tiltNormal(rx);
  for (let i = 0; i < 5; i++) {
    const yb = 0.2 + i * 0.3, cy = yb + 0.135, cz = -0.03;
    out.push(bb('steelDark', -w / 2 + 0.03, yb - 0.012, -0.08, w / 2 - 0.03, yb, 0.045));
    out.push(box('panel', [w - 0.08, 0.27, 0.015], [0, cy, cz], rx));
    out.push(box('magazines', [w - 0.1, 0.25, 0.006], [0, cy + ny * 0.011, cz + nz * 0.011], rx));
    out.push(bb('steelBright', -w / 2 + 0.04, yb, 0.03, w / 2 - 0.04, yb + 0.04, 0.045));
  }
  return out;
}

function techDisplay(): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.77, 0, -0.42, 0.77, 0.05, 0.42),
    bb('laminate', -0.78, 0.05, -0.43, 0.78, 0.72, 0.43),
    bb('accent', -0.785, 0.6, -0.435, 0.785, 0.68, 0.435),
    bb('wood', -0.8, 0.72, -0.45, 0.8, 0.76, 0.45),
  ];
  const rx = -0.45;
  const [ny, nz] = tiltNormal(rx);
  for (const [row, z, ry] of [[0, 0.2, 0], [1, -0.2, Math.PI]] as const) {
    const flip = ry ? -1 : 1;
    [-0.5, 0, 0.5].forEach((x, i) => {
      const phone = (i + row) % 2 === 1;
      const [dw, dh] = phone ? [0.08, 0.13] : [0.2, 0.12];
      out.push(bb('black', x - 0.04, 0.76, z - 0.03, x + 0.04, 0.79, z + 0.03));
      const cy = 0.79 + dh / 2;
      out.push(box('black', [dw, dh, 0.012], [x, cy, z], rx, ry));
      out.push(box('deviceScreen', [dw - 0.014, dh - 0.016, 0.004], [x, cy + ny * 0.008, z + flip * nz * 0.008], rx, ry));
      out.push(bb('paintWhite', x + 0.1, 0.76, z - 0.03 * flip - 0.025, x + 0.17, 0.765, z - 0.03 * flip + 0.025));
    });
  }
  return out;
}

function deviceWall(): PurposePart[] {
  const out: PurposePart[] = [
    bb('laminate', -0.75, 0, -0.175, 0.75, 0.45, 0.175),
    bb('black', -0.74, 0.3, 0.175, 0.74, 0.31, 0.178),
    bb('panel', -0.75, 0.45, -0.175, 0.75, 2.08, -0.14),
    bb('accent', -0.75, 2.08, -0.175, 0.75, 2.2, -0.1),
  ];
  for (let k = 0; k < 7; k++) out.push(bb('black', -0.74, 0.52 + k * 0.22, -0.14, 0.74, 0.53 + k * 0.22, -0.136));
  for (const y of [0.62, 0.95, 1.28, 1.61]) {
    out.push(bb('steelBright', -0.72, y + 0.24, -0.14, 0.72, y + 0.255, -0.12));
    out.push(bb('stockDevices', -0.7, y, -0.135, 0.7, y + 0.23, -0.075));
  }
  return out;
}

function showcase(): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.73, 0, -0.28, 0.73, 0.06, 0.28),
    bb('laminate', -0.75, 0.06, -0.3, 0.75, 0.55, 0.3),
    bb('black', -0.73, 0.55, -0.28, 0.73, 0.57, 0.28),
    bb('glassShopfront', -0.725, 0.985, -0.285, 0.725, 0.995, 0.285),
    bb('glassShopfront', -0.725, 0.57, 0.28, 0.725, 0.985, 0.29),
    bb('glassShopfront', -0.725, 0.57, -0.29, 0.725, 0.985, -0.28),
    bb('glassShopfront', -0.73, 0.57, -0.28, -0.72, 0.985, 0.28),
    bb('glassShopfront', 0.72, 0.57, -0.28, 0.73, 0.985, 0.28),
    bb('steelBright', -0.75, 0.99, 0.28, 0.75, 1.0, 0.3),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box('steelBright', [0.025, 0.45, 0.025], [sx * 0.7375, 0.775, sz * 0.2875]));
  const rx = 0.5;
  const [uy, uz] = tiltUp(rx);
  for (const x of [-0.5, -0.17, 0.17, 0.5]) {
    out.push(bb('steelBright', x - 0.05, 0.57, -0.05, x + 0.05, 0.6, 0.05));
    out.push(box('black', [0.09, 0.012, 0.17], [x, 0.63, 0], rx));
    out.push(box('deviceScreen', [0.078, 0.004, 0.15], [x, 0.63 + uy * 0.008, uz * 0.008], rx));
  }
  return out;
}

function flowerStand(): PurposePart[] {
  const out: PurposePart[] = [
    bb('wood', -0.7, 0, -0.35, 0.7, 0.3, 0.35),
    bb('wood', -0.7, 0.3, -0.35, 0.7, 0.6, 0.08),
    bb('wood', -0.7, 0.6, -0.35, 0.7, 0.85, -0.14),
  ];
  for (const x of [-0.48, -0.16, 0.16, 0.48]) {
    out.push(bb('steelBright', x - 0.1, 0.3, 0.13, x + 0.1, 0.52, 0.31));
    out.push(bb('flowers', x - 0.14, 0.52, 0.1, x + 0.14, 0.76, 0.34));
    out.push(bb('steelBright', x - 0.1, 0.6, -0.12, x + 0.1, 0.8, 0.06));
    out.push(bb('flowers', x - 0.14, 0.8, -0.14, x + 0.14, 1.0, 0.08));
  }
  for (const x of [-0.45, 0, 0.45]) {
    out.push(bb('steelBright', x - 0.09, 0.85, -0.33, x + 0.09, 1.0, -0.16));
    out.push(bb('flowers', x - 0.13, 1.0, -0.345, x + 0.13, 1.2, -0.15));
  }
  return out;
}

function repairBench(v: number): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.78, 0, -0.28, 0.78, 0.08, 0.28),
    bb('laminate', -0.8, 0.08, -0.3, 0.8, 0.86, 0.3),
    bb('black', -0.78, 0.6, 0.3, 0.78, 0.61, 0.304),
    bb('black', -0.005, 0.1, 0.3, 0.005, 0.84, 0.304),
    bb('counter', -0.8, 0.86, -0.3, 0.8, 0.9, 0.3),
    bb('panel', -0.8, 0.9, -0.3, 0.8, 2.0, -0.28),
    bb('wood', -0.8, 1.96, -0.3, 0.8, 2.0, -0.24),
  ];
  if (v === 0) {
    // Key cutting + shoe repair: key-blank pegboard, duplicator, shoe last.
    out.push(
      bb('keyBlanks', -0.76, 1.0, -0.28, 0.76, 1.94, -0.26),
      bb('steelDark', -0.55, 0.9, -0.15, -0.25, 1.08, 0.1),
      bb('black', -0.5, 1.08, -0.08, -0.3, 1.14, 0.06),
      box('steelBright', [0.02, 0.13, 0.13], [-0.23, 1.15, -0.05]),
      bb('steelBright', -0.46, 1.14, -0.02, -0.44, 1.2, 0.0),
      bb('steelDark', 0.2, 0.9, -0.1, 0.24, 1.15, -0.06),
      bb('black', 0.1, 1.15, -0.16, 0.34, 1.22, -0.0),
      bb('paintRed', 0.45, 0.9, -0.2, 0.55, 0.98, -0.1),
      bb('stockParts', 0.45, 0.9, 0.0, 0.75, 1.0, 0.15),
    );
  } else {
    // Phone repair: accessory rail, anti-static mats, opened phones, parts drawers, magnifier lamp.
    out.push(
      bb('stockDevices', -0.74, 1.3, -0.28, 0.74, 1.6, -0.24),
      bb('steelBright', -0.74, 1.6, -0.28, 0.74, 1.615, -0.22),
      bb('black', -0.65, 0.9, -0.2, -0.1, 0.905, 0.2),
      bb('black', 0.0, 0.9, -0.2, 0.42, 0.905, 0.2),
      bb('deviceScreen', -0.5, 0.905, -0.05, -0.42, 0.913, 0.11),
      bb('black', -0.35, 0.905, -0.05, -0.27, 0.913, 0.11),
      bb('deviceScreen', 0.1, 0.905, -0.1, 0.18, 0.913, 0.06),
      bb('paintBlue', 0.5, 0.9, -0.25, 0.78, 1.25, -0.02),
      bb('black', 0.52, 1.0, -0.02, 0.76, 1.01, -0.015),
      bb('black', 0.52, 1.1, -0.02, 0.76, 1.11, -0.015),
      bb('black', 0.52, 1.2, -0.02, 0.76, 1.21, -0.015),
      bb('steelDark', -0.77, 0.9, -0.26, -0.74, 1.45, -0.23),
      bb('steelDark', -0.77, 1.42, -0.26, -0.45, 1.45, -0.23),
      bb('paintWhite', -0.55, 1.36, -0.27, -0.4, 1.42, -0.12),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Food service

function hotdogCart(): PurposePart[] {
  const out: PurposePart[] = [
    // Lower compartment (open at the front): floor board, back panel, accent side panels.
    bb('kitchenSteel', -0.72, 0.17, -0.33, 0.72, 0.2, 0.33),
    bb('kitchenSteel', -0.72, 0.17, -0.35, 0.72, 0.89, -0.33),
    bb('accent', -0.75, 0.12, -0.35, -0.72, 0.89, 0.35),
    bb('accent', 0.72, 0.12, -0.35, 0.75, 0.89, 0.35),
    bb('kitchenSteel', -0.72, 0.6, -0.33, 0.72, 0.62, 0.33),
    bb('kitchenSteel', -0.72, 0.62, 0.33, 0.72, 0.89, 0.35),
    bb('accent', -0.45, 0.66, 0.35, 0.45, 0.85, 0.36),
    // Worktop, steam wells + lids on the left, condiments.
    bb('kitchenSteel', -0.75, 0.89, -0.35, 0.75, 0.92, 0.35),
    bb('black', -0.68, 0.92, -0.25, 0.02, 0.93, 0.25),
    bb('steelBright', -0.66, 0.92, -0.23, -0.34, 0.98, 0.23),
    bb('steelBright', -0.32, 0.92, -0.23, 0.0, 0.98, 0.23),
    bb('paintRed', 0.06, 0.92, 0.04, 0.12, 1.1, 0.1),
    bb('paintYellow', 0.06, 0.92, -0.1, 0.12, 1.1, -0.04),
    // Wheels at one end, legs at the other, push handle.
    bb('black', -0.67, 0, 0.355, -0.43, 0.24, 0.415),
    bb('black', -0.67, 0, -0.415, -0.43, 0.24, -0.355),
    bb('steelDark', -0.56, 0.1, -0.36, -0.54, 0.14, 0.36),
    bb('steelDark', 0.63, 0, 0.28, 0.67, 0.17, 0.32),
    bb('steelDark', 0.63, 0, -0.32, 0.67, 0.17, -0.28),
    bb('steelBright', 0.76, 0.84, -0.3, 0.8, 0.88, 0.3),
    bb('steelBright', 0.75, 0.84, -0.3, 0.8, 0.88, -0.27),
    bb('steelBright', 0.75, 0.84, 0.27, 0.8, 0.88, 0.3),
    // Canopy on four poles.
    bb('accent', -0.84, 2.05, -0.42, 0.84, 2.15, 0.42),
    bb('paintWhite', -0.84, 2.15, -0.42, 0.84, 2.2, 0.42),
    bb('paintWhite', -0.84, 1.99, 0.4, 0.84, 2.05, 0.42),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bb('steelBright', sx * 0.72 - 0.015, 0.92, sz * 0.3 - 0.015, sx * 0.72 + 0.015, 2.05, sz * 0.3 + 0.015));
  return out;
}

/** Shared kitchen-line carcass: base cabinet, worktop, splashback, over-shelf on rear posts. */
function lineBase(): PurposePart[] {
  const {w, d, h} = PROP_DEFS.grillLine;
  const {top, shelfY} = KITCHEN_LINE;
  return [
    bb('black', -w / 2 + 0.02, 0, -d / 2 + 0.02, w / 2 - 0.02, 0.08, d / 2 - 0.04),
    bb('kitchenSteel', -w / 2 + 0.01, 0.08, -d / 2 + 0.01, w / 2 - 0.01, top - 0.04, d / 2 - 0.01),
    bb('black', -w / 2 + 0.03, 0.47, d / 2 - 0.01, w / 2 - 0.03, 0.482, d / 2),
    bb('kitchenSteel', -w / 2, top - 0.04, -d / 2, w / 2, top, d / 2),
    bb('kitchenSteel', -w / 2, top, -d / 2, w / 2, shelfY - 0.03, -d / 2 + 0.01),
    bb('kitchenSteel', -w / 2, shelfY - 0.03, -d / 2, w / 2, shelfY, 0.01),
    bb('steelDark', -w / 2 + 0.005, top, -d / 2 + 0.01, -w / 2 + 0.045, h, -d / 2 + 0.05),
    bb('steelDark', w / 2 - 0.045, top, -d / 2 + 0.01, w / 2 - 0.005, h, -d / 2 + 0.05),
    bb('steelDark', -w / 2, h - 0.03, -d / 2, w / 2, h, -d / 2 + 0.03),
  ];
}

function grillLine(v: number): PurposePart[] {
  const t = KITCHEN_LINE.top;
  const out = lineBase();
  if (v === 0) {
    // Burger: flat-top griddle with splash guards, two-basket fryer, heat-lamp strip.
    out.push(
      bb('black', -0.82, t, -0.27, -0.22, t + 0.04, 0.28),
      bb('steelBright', -0.82, t + 0.04, -0.28, -0.22, t + 0.16, -0.27),
      bb('steelBright', -0.83, t + 0.04, -0.28, -0.82, t + 0.12, 0.2),
      bb('steelBright', -0.82, t + 0.02, 0.28, -0.22, t + 0.05, 0.33),
      bb('kitchenSteel', -0.18, t, -0.27, 0.22, t + 0.12, 0.28),
      bb('black', -0.15, t + 0.12, -0.2, 0.19, t + 0.125, 0.15),
      bb('grille', -0.14, t + 0.09, -0.18, 0.0, t + 0.2, 0.05),
      bb('grille', 0.04, t + 0.09, -0.18, 0.18, t + 0.2, 0.05),
      bb('black', -0.09, t + 0.17, 0.05, -0.05, t + 0.19, 0.2),
      bb('black', 0.09, t + 0.17, 0.05, 0.13, t + 0.19, 0.2),
      bb('black', -0.84, 1.49, -0.04, 0.22, 1.55, 0.1),
      bb('paintOrange', -0.82, 1.485, -0.02, 0.2, 1.49, 0.08),
      bb('steelDark', -0.6, 1.55, 0.0, -0.58, 1.59, 0.01),
      bb('steelDark', 0.0, 1.55, 0.0, 0.02, 1.59, 0.01),
    );
  } else if (v === 1) {
    // Shawarma: vertical spit (stacked shrinking cone) before a radiant panel, small griddle.
    out.push(
      bb('steelBright', -0.75, t, -0.15, -0.45, t + 0.06, 0.15),
      bb('black', -0.78, t + 0.04, -0.3, -0.42, t + 0.6, -0.26),
      bb('paintOrange', -0.75, t + 0.08, -0.26, -0.45, t + 0.56, -0.255),
    );
    const sizes = [0.26, 0.24, 0.22, 0.2, 0.17, 0.14];
    sizes.forEach((s, i) => out.push(box('wood', [s, 0.08, s], [-0.6, t + 0.06 + 0.04 + i * 0.08, 0])));
    out.push(
      bb('steelBright', -0.61, t + 0.06, -0.01, -0.59, t + 0.66, 0.01),
      bb('steelBright', -0.63, t + 0.66, -0.03, -0.57, t + 0.69, 0.03),
      bb('black', -0.3, t, -0.25, 0.2, t + 0.04, 0.25),
      bb('steelBright', -0.3, t + 0.04, -0.26, 0.2, t + 0.14, -0.25),
      bb('wood', -0.25, t + 0.04, 0.05, 0.05, t + 0.06, 0.2),
    );
  } else {
    // Hot dogs: roller grill with franks, bun-warmer drawer, condiment pumps.
    out.push(bb('kitchenSteel', -0.8, t, -0.22, -0.2, t + 0.12, 0.23));
    for (let i = 0; i < 7; i++) {
      const z = -0.18 + i * 0.06;
      out.push(bb('steelBright', -0.78, t + 0.12, z - 0.0125, -0.22, t + 0.145, z + 0.0125));
      if (i % 2 === 0) for (const x of [-0.66, -0.43]) out.push(bb(i % 4 === 0 ? 'paintRed' : 'paintOrange', x - 0.09, t + 0.145, z - 0.015, x + 0.09, t + 0.175, z + 0.015));
    }
    out.push(
      bb('steelBright', -0.18, t, -0.22, 0.22, t + 0.3, 0.23),
      bb('black', -0.16, t + 0.03, 0.23, 0.2, t + 0.14, 0.235),
      bb('steelDark', -0.06, t + 0.07, 0.235, 0.08, t + 0.09, 0.26),
      bb('glass', -0.16, t + 0.17, 0.23, 0.2, t + 0.28, 0.232),
      bb('paintYellow', -0.15, t + 0.3, -0.12, -0.05, t + 0.5, -0.02),
      bb('paintRed', 0.05, t + 0.3, -0.12, 0.15, t + 0.5, -0.02),
      bb('black', -0.11, t + 0.5, -0.08, -0.09, t + 0.56, 0.02),
      bb('black', 0.09, t + 0.5, -0.08, 0.11, t + 0.56, 0.02),
    );
  }
  return out;
}

function espressoBar(): PurposePart[] {
  const t = KITCHEN_LINE.top;
  const out = lineBase();
  out.push(
    bb('kitchenSteel', -0.825, t, -0.25, -0.075, t + 0.42, 0.22),
    bb('black', -0.82, t + 0.3, 0.22, -0.08, t + 0.36, 0.225),
    bb('black', -0.78, t, 0.22, -0.12, t + 0.03, 0.32),
    bb('grille', -0.77, t + 0.03, 0.23, -0.13, t + 0.035, 0.31),
    bb('black', -0.62, t + 0.2, 0.22, -0.54, t + 0.26, 0.3),
    bb('black', -0.36, t + 0.2, 0.22, -0.28, t + 0.26, 0.3),
    bb('steelBright', -0.15, t + 0.12, 0.22, -0.13, t + 0.3, 0.24),
    bb('steelBright', -0.84, t + 0.08, -0.06, -0.825, t + 0.12, 0.02),
  );
  for (const [x, z] of [[-0.75, -0.12], [-0.62, -0.12], [-0.49, -0.12], [-0.75, 0.02], [-0.62, 0.02]] as const) out.push(bb('paintWhite', x - 0.04, t + 0.42, z - 0.04, x + 0.04, t + 0.5, z + 0.04));
  out.push(
    bb('black', 0.03, t, -0.12, 0.21, t + 0.3, 0.1),
    bb('glass', 0.05, t + 0.3, -0.08, 0.19, t + 0.5, 0.06),
    bb('black', 0.06, t + 0.5, -0.07, 0.18, t + 0.53, 0.05),
    bb('black', -0.03, t, 0.12, 0.2, t + 0.1, 0.28),
  );
  return out;
}

function wokLine(): PurposePart[] {
  const t = KITCHEN_LINE.top;
  const out = lineBase();
  out.push(
    bb('black', -0.835, t, -0.28, -0.035, t + 0.08, 0.3),
    bb('grille', -0.78, t + 0.08, -0.13, -0.5, t + 0.1, 0.15),
    bb('grille', -0.38, t + 0.08, -0.13, -0.1, t + 0.1, 0.15),
    bb('black', -0.8, t + 0.02, 0.3, -0.07, t + 0.06, 0.32),
    box('steelDark', [0.34, 0.07, 0.34], [-0.64, t + 0.14, 0.01], 0.15),
    bb('steelDark', -0.66, t + 0.16, 0.17, -0.62, t + 0.19, 0.33),
    bb('steelBright', -0.37, t + 0.1, -0.12, -0.11, t + 0.4, 0.14),
    bb('steelBright', -0.38, t + 0.4, -0.13, -0.1, t + 0.42, 0.15),
    bb('paintWhite', -0.04, t, -0.18, 0.22, t + 0.24, 0.08),
    bb('black', -0.02, t + 0.24, -0.16, 0.2, t + 0.27, 0.06),
    bb('steelBright', 0.0, t, 0.12, 0.22, t + 0.12, 0.3),
  );
  return out;
}

function deliLine(): PurposePart[] {
  const t = KITCHEN_LINE.top;
  const out = lineBase();
  out.push(bb('kitchenSteel', -0.83, t, -0.24, -0.03, t + 0.1, 0.18));
  const pans: ('paintGreen' | 'paintRed' | 'paintYellow')[] = ['paintGreen', 'paintRed', 'paintYellow', 'paintGreen', 'paintYellow', 'paintRed', 'paintGreen', 'paintRed'];
  let k = 0;
  for (const z of [-0.12, 0.06]) for (const x of [-0.715, -0.525, -0.335, -0.145]) out.push(bb(pans[k++], x - 0.08, t + 0.1, z - 0.07, x + 0.08, t + 0.112, z + 0.07));
  out.push(
    box('steelBright', [0.8, 0.02, 0.24], [-0.43, t + 0.22, -0.2], -1.0),
    bb('paintWhite', -0.8, t, 0.19, -0.06, t + 0.02, 0.33),
    bb('steelBright', -0.05, t, -0.16, 0.24, t + 0.14, 0.16),
    box('steelBright', [0.03, 0.22, 0.22], [0.12, t + 0.24, 0.0], 0, 0.3),
    bb('black', 0.16, t + 0.14, 0.04, 0.22, t + 0.2, 0.14),
  );
  return out;
}

function blenderBar(): PurposePart[] {
  const t = KITCHEN_LINE.top;
  const out = lineBase();
  for (const x of [-0.72, -0.48, -0.24]) {
    out.push(
      bb('black', x - 0.08, t, -0.1, x + 0.08, t + 0.12, 0.06),
      bb('glass', x - 0.065, t + 0.12, -0.085, x + 0.065, t + 0.36, 0.045),
      bb('black', x - 0.065, t + 0.36, -0.085, x + 0.065, t + 0.39, 0.045),
    );
  }
  out.push(
    bb('wood', -0.14, t, -0.26, 0.22, t + 0.14, 0.04),
    bb('fruit', -0.12, t + 0.14, -0.24, 0.2, t + 0.17, 0.02),
    bb('wood', -0.12, t, 0.08, 0.2, t + 0.12, 0.3),
    bb('fruit', -0.1, t + 0.12, 0.1, 0.18, t + 0.15, 0.28),
    bb('paintWhite', -0.82, t, 0.12, -0.56, t + 0.02, 0.3),
  );
  return out;
}

function pizzaOven(): PurposePart[] {
  const {w, d} = PROP_DEFS.pizzaOven;
  const hw = w / 2, hd = d / 2;
  const out: PurposePart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box('steelDark', [0.06, 0.5, 0.06], [sx * (hw - 0.06), 0.25, sz * (hd - 0.06)]));
  for (const y0 of [0.5, 1.07]) {
    out.push(
      bb('kitchenSteel', -hw + 0.01, y0, -hd + 0.01, hw - 0.01, y0 + 0.55, hd - 0.03),
      bb('black', -0.7, y0 + 0.1, hd - 0.03, 0.55, y0 + 0.42, hd - 0.012),
      bb('glass', -0.45, y0 + 0.2, hd - 0.012, 0.3, y0 + 0.32, hd - 0.008),
      bb('steelBright', -0.65, y0 + 0.44, hd - 0.012, 0.5, y0 + 0.47, hd),
      bb('steelBright', 0.62, y0 + 0.08, hd - 0.03, 0.84, y0 + 0.47, hd - 0.012),
      bb('black', 0.68, y0 + 0.3, hd - 0.012, 0.72, y0 + 0.34, hd - 0.004),
      bb('black', 0.76, y0 + 0.3, hd - 0.012, 0.8, y0 + 0.34, hd - 0.004),
    );
  }
  out.push(bb('steelDark', -0.1, 1.62, -hd + 0.05, 0.1, 1.95, -hd + 0.25));
  for (let i = 0; i < 5; i++) out.push(box('pizzaBox', [0.48, 0.05, 0.48], [-0.5 + (i % 2) * 0.01, 1.62 + 0.025 + i * 0.05, 0.05], 0, i === 4 ? 0.12 : 0));
  for (let i = 0; i < 3; i++) out.push(box('pizzaBox', [0.42, 0.05, 0.42], [0.45, 1.62 + 0.025 + i * 0.05, 0.08]));
  return out;
}

function breadRack(v: number): PurposePart[] {
  const {w, d, h} = PROP_DEFS.breadRack;
  const out: PurposePart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(box('steelBright', [0.025, h - 0.06, 0.025], [sx * (w / 2 - 0.0125), 0.04 + (h - 0.06) / 2, sz * (d / 2 - 0.0125)]));
    out.push(box('black', [0.04, 0.04, 0.04], [sx * (w / 2 - 0.03), 0.02, sz * (d / 2 - 0.03)]));
  }
  [0.18, 0.52, 0.86, 1.2, 1.54].forEach((y, i) => {
    out.push(bb('steelDark', -w / 2 + 0.03, y - 0.02, -d / 2 + 0.03, w / 2 - 0.03, y, d / 2 - 0.03));
    if (i === 4) return; // top tray sold out
    const x1 = i === 2 ? 0.1 : w / 2 - 0.06;
    out.push(v === 0 ? bb('bread', -w / 2 + 0.06, y, -d / 2 + 0.05, x1, y + 0.11, d / 2 - 0.05) : bb('donuts', -w / 2 + 0.06, y, -d / 2 + 0.05, x1, y + 0.055, d / 2 - 0.05));
  });
  out.push(bb('steelBright', -w / 2, h - 0.02, -d / 2, w / 2, h, d / 2));
  return out;
}

// ---------------------------------------------------------------------------------------
// Back-of-house

function staffLockers(): PurposePart[] {
  const out: PurposePart[] = [
    bb('steelDark', -0.6, 0, -0.25, 0.6, 1.9, -0.23),
    bb('steelDark', -0.6, 0, -0.25, -0.585, 1.9, 0.2),
    bb('steelDark', 0.585, 0, -0.25, 0.6, 1.9, 0.2),
    bb('steelDark', -0.207, 0.08, -0.23, -0.193, 1.88, 0.2),
    bb('steelDark', 0.193, 0.08, -0.23, 0.207, 1.88, 0.2),
    bb('steelDark', -0.6, 1.88, -0.25, 0.6, 1.9, 0.22),
    bb('black', -0.585, 0, -0.23, 0.585, 0.08, 0.2),
    bb('black', 0.207, 0.1, -0.229, 0.585, 1.87, -0.22),
  ];
  [-0.4, 0].forEach(x => {
    out.push(bb('accent', x - 0.19, 0.09, 0.2, x + 0.19, 1.87, 0.22));
    for (const yv of [1.6, 1.64, 1.68, 0.2, 0.24]) out.push(bb('black', x - 0.12, yv, 0.22, x + 0.12, yv + 0.012, 0.224));
    out.push(bb('steelBright', x + 0.13, 0.95, 0.22, x + 0.15, 1.08, 0.235));
    out.push(bb('paintWhite', x - 0.04, 1.75, 0.22, x + 0.04, 1.79, 0.223));
  });
  // Third door hanging slightly open on its right-hand hinge.
  const hx = 0.59, hz = 0.2, a = 0.1;
  out.push(hinged('accent', hx, hz, a, -0.38, 0, 0.09, 1.87, 0, 0.02));
  for (const yv of [1.6, 1.64, 1.68, 0.2, 0.24]) out.push(hinged('black', hx, hz, a, -0.31, -0.07, yv, yv + 0.012, 0.02, 0.024));
  out.push(hinged('steelBright', hx, hz, a, -0.06, -0.04, 0.95, 1.08, 0.02, 0.035));
  return out;
}

function kitchenette(): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.88, 0, -0.27, 0.88, 0.08, 0.27),
    bb('laminate', -0.9, 0.08, -0.31, 0.9, 0.88, 0.29),
    bb('counter', -0.9, 0.88, -0.31, 0.9, 0.92, 0.31),
    bb('tileShop', -0.9, 0.92, -0.31, 0.9, 1.45, -0.3),
    bb('woodVeneer', -0.9, 1.45, -0.31, 0.9, 2.1, 0.0),
    bb('black', -0.88, 1.47, 0.0, 0.88, 1.48, 0.004),
    // Sink + faucet, microwave, coffee maker (left of the free worktop).
    bb('steelBright', -0.33, 0.92, -0.18, 0.13, 0.932, 0.18),
    bb('black', -0.3, 0.925, -0.15, 0.1, 0.933, 0.15),
    bb('steelBright', -0.115, 0.92, -0.25, -0.085, 1.17, -0.22),
    bb('steelBright', -0.115, 1.14, -0.25, -0.085, 1.17, -0.1),
    bb('black', -0.86, 0.92, -0.28, -0.36, 1.22, 0.08),
    bb('glass', -0.8, 0.97, 0.08, -0.52, 1.17, 0.084),
    bb('steelBright', -0.49, 0.97, 0.08, -0.4, 1.17, 0.085),
    bb('black', 0.17, 0.92, -0.25, 0.33, 1.22, -0.05),
    bb('glass', 0.19, 0.93, -0.05, 0.31, 1.06, 0.03),
  ];
  for (const x of [-0.675, -0.225, 0.225, 0.675]) {
    out.push(bb('woodVeneer', x - 0.21, 0.12, 0.29, x + 0.21, 0.84, 0.302));
    out.push(bb('steelBright', x + 0.13, 0.72, 0.302, x + 0.17, 0.74, 0.31));
  }
  return out;
}

function fridge(): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.37, 0, -0.725, 0.37, 0.1, -0.025),
    bb('paintWhite', -0.37, 0.1, -0.725, 0.37, 1.8, -0.695),
    bb('paintWhite', -0.37, 0.1, -0.725, -0.34, 1.8, -0.025),
    bb('paintWhite', 0.34, 0.1, -0.725, 0.37, 1.8, -0.025),
    bb('paintWhite', -0.37, 1.74, -0.725, 0.37, 1.8, -0.025),
    bb('panel', -0.34, 0.12, -0.695, 0.34, 1.74, -0.69),
    bb('panel', -0.34, 0.12, -0.69, -0.335, 1.74, -0.03),
    bb('panel', 0.335, 0.12, -0.69, 0.34, 1.74, -0.03),
    // Crisper drawer (its lid is the first surface), wire/glass shelves under the others.
    bb('paintWhite', -0.335, 0.1, -0.69, 0.335, 0.3, -0.07),
    bb('glass', -0.3, 0.12, -0.07, 0.3, 0.28, -0.06),
    bb('black', -0.37, 0.1, -0.04, 0.37, 0.12, -0.025),
    bb('black', -0.37, 1.72, -0.04, 0.37, 1.74, -0.025),
    // Door hanging open 90° on its +X hinge, door bins on its inner face.
    bb('paintWhite', 0.33, 0.1, -0.025, 0.38, 1.78, 0.715),
    bb('black', 0.325, 0.12, 0.0, 0.33, 1.76, 0.69),
    bb('steelBright', 0.38, 0.9, 0.55, 0.395, 1.3, 0.58),
  ];
  for (const y of [0.72, 1.1, 1.45]) out.push(bb('glass', -0.335, y - 0.012, -0.69, 0.335, y, -0.05));
  for (const y of [0.45, 0.85, 1.25]) out.push(bb('panel', 0.27, y, 0.03, 0.325, y + 0.08, 0.66));
  return out;
}

function couch(): PurposePart[] {
  const out: PurposePart[] = [
    bb('steelDark', -0.92, 0.08, -0.4, 0.92, 0.14, 0.4),
    bb('vinyl', -0.93, 0.14, -0.41, 0.93, 0.37, 0.41),
    bb('vinyl', -0.93, 0.37, -0.425, 0.93, 0.85, -0.22),
    bb('vinyl', -0.95, 0.37, -0.41, -0.8, 0.62, 0.41),
    bb('vinyl', 0.8, 0.37, -0.41, 0.95, 0.62, 0.41),
  ];
  for (const x of [-0.53, 0, 0.53]) out.push(bb('vinyl', x - 0.26, 0.37, -0.22, x + 0.26, 0.5, 0.4));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bb('steelDark', sx * 0.88 - 0.025, 0, sz * 0.36 - 0.025, sx * 0.88 + 0.025, 0.08, sz * 0.36 + 0.025));
  return out;
}

function noticeBoard(): PurposePart[] {
  return [
    bb('noticeBoard', -0.56, 0.04, -0.025, 0.56, 0.86, 0.008),
    bb('wood', -0.6, 0, -0.025, 0.6, 0.04, 0.025),
    bb('wood', -0.6, 0.86, -0.025, 0.6, 0.9, 0.025),
    bb('wood', -0.6, 0.04, -0.025, -0.56, 0.86, 0.025),
    bb('wood', 0.56, 0.04, -0.025, 0.6, 0.86, 0.025),
  ];
}

function janitorCart(): PurposePart[] {
  const out: PurposePart[] = [
    bb('paintYellow', -0.52, 0.1, -0.25, 0.52, 0.18, 0.25),
    bb('paintYellow', 0.1, 0.18, -0.21, 0.5, 0.85, 0.2),
    bb('black', 0.12, 0.45, 0.2, 0.48, 0.46, 0.205),
    bb('black', 0.22, 0.25, 0.2, 0.48, 0.72, 0.28),
    bb('steelBright', 0.5, 0.82, -0.2, 0.54, 0.86, 0.2),
    bb('steelDark', -0.48, 0.18, -0.16, -0.12, 0.48, 0.16),
    bb('paintYellow', -0.48, 0.48, -0.16, -0.12, 0.6, -0.06),
    bb('black', -0.3, 0.6, -0.12, -0.26, 0.64, -0.08),
    box('wood', [0.03, 0.6, 0.03], [-0.3, 0.73, 0.04], -0.12),
    bb('paintBlue', 0.14, 0.85, -0.15, 0.2, 1.03, -0.09),
    bb('paintGreen', 0.26, 0.85, -0.15, 0.32, 1.03, -0.09),
    bb('paintWhite', 0.38, 0.85, -0.12, 0.48, 0.97, -0.02),
    bb('paintBlue', 0.15, 1.0, -0.1, 0.19, 1.04, -0.06),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bb('black', sx * 0.46 - 0.04, 0, sz * 0.2 - 0.04, sx * 0.46 + 0.04, 0.1, sz * 0.2 + 0.04));
  return out;
}

function mopSink(): PurposePart[] {
  const out: PurposePart[] = [
    bb('porcelain', -0.4, 0, -0.3, 0.4, 0.06, 0.3),
    bb('porcelain', -0.4, 0.06, 0.24, 0.4, 0.3, 0.3),
    bb('porcelain', -0.4, 0.06, -0.3, 0.4, 0.3, -0.24),
    bb('porcelain', -0.4, 0.06, -0.24, -0.34, 0.3, 0.24),
    bb('porcelain', 0.34, 0.06, -0.24, 0.4, 0.3, 0.24),
    bb('concrete', -0.34, 0.06, -0.24, 0.34, 0.065, 0.24),
    bb('steelBright', -0.4, 0.3, -0.3, 0.4, 0.9, -0.28),
    bb('steelBright', -0.02, 0.75, -0.28, 0.02, 1.05, -0.24),
    bb('steelBright', -0.02, 1.0, -0.24, 0.02, 1.04, -0.08),
    bb('paintRed', -0.1, 0.92, -0.28, -0.05, 0.96, -0.24),
    bb('paintBlue', 0.05, 0.92, -0.28, 0.1, 0.96, -0.24),
    bb('paintYellow', -0.3, 0.065, -0.16, -0.02, 0.36, 0.12),
    bb('black', -0.28, 0.33, -0.14, -0.04, 0.34, 0.1),
    bb('paintWhite', 0.1, 0.065, -0.12, 0.3, 0.16, 0.06),
  ];
  // Mop resting in the basin, handle leaning back against the wall.
  out.push(box('wood', [0.03, 1.1, 0.03], [0.2, 0.69, -0.1], -0.17));
  return out;
}

function electricalPanel(): PurposePart[] {
  const out: PurposePart[] = [
    bb('concrete', -0.6, 0, -0.22, 0.6, 0.1, 0.22),
    bb('steelDark', -0.585, 1.98, -0.215, 0.585, 2.02, -0.17),
  ];
  for (const x of [-0.3, 0.3]) {
    out.push(
      bb('panel', x - 0.29, 0.1, -0.225, x + 0.29, 2.0, 0.175),
      bb('grille', x - 0.25, 0.2, 0.175, x + 0.25, 1.9, 0.185),
      bb('hazardLabel', x - 0.12, 1.47, 0.185, x + 0.12, 1.63, 0.19),
      bb('black', x + 0.17, 0.95, 0.185, x + 0.2, 1.09, 0.205),
      bb('glass', x - 0.06, 1.15, 0.185, x + 0.06, 1.27, 0.19),
      bb('steelDark', x - 0.12, 2.0, -0.12, x - 0.06, 2.1, -0.06),
      bb('steelDark', x + 0.06, 2.0, -0.12, x + 0.12, 2.1, -0.06),
    );
  }
  out.push(bb('steelDark', -0.6, 2.04, -0.22, 0.6, 2.09, -0.17));
  return out;
}

function gunLocker(): PurposePart[] {
  const out: PurposePart[] = [
    bb('steelDark', -0.5, 0, -0.5, 0.5, 0.1, 0.0),
    bb('accent', -0.5, 0.1, -0.5, 0.5, 1.9, -0.47),
    bb('accent', -0.5, 0.1, -0.5, -0.47, 1.9, 0.0),
    bb('accent', 0.47, 0.1, -0.5, 0.5, 1.9, 0.0),
    bb('accent', -0.5, 1.86, -0.5, 0.5, 1.9, 0.0),
    bb('panel', -0.47, 0.1, -0.47, 0.47, 1.86, -0.465),
    bb('black', -0.47, 0.1, -0.02, 0.47, 0.12, 0.0),
  ];
  for (const y of [0.75, 1.3]) out.push(bb('steelDark', -0.47, y - 0.02, -0.465, 0.47, y, -0.01));
  for (const s of [-1, 1]) {
    // Doors forced open 90°, slabs along the sides, handles and a bent latch plate inside.
    out.push(
      bb('accent', s > 0 ? 0.46 : -0.5, 0.06, 0.0, s > 0 ? 0.5 : -0.46, 1.84, 0.5),
      bb('panel', s > 0 ? 0.455 : -0.46, 0.1, 0.02, s > 0 ? 0.46 : -0.455, 1.8, 0.48),
      bb('steelBright', s > 0 ? 0.445 : -0.455, 0.9, 0.38, s > 0 ? 0.455 : -0.445, 1.05, 0.42),
      bb('black', s > 0 ? 0.445 : -0.455, 1.2, 0.44, s > 0 ? 0.455 : -0.445, 1.26, 0.47),
    );
  }
  return out;
}

function monitorDesk(): PurposePart[] {
  const out: PurposePart[] = [
    bb('counter', -0.8, 0.72, -0.375, 0.8, 0.76, 0.375),
    bb('steelDark', 0.35, 0, -0.35, 0.79, 0.72, 0.35),
    bb('black', 0.37, 0.48, 0.35, 0.77, 0.49, 0.355),
    bb('black', 0.37, 0.24, 0.35, 0.77, 0.25, 0.355),
    bb('steelDark', -0.79, 0, -0.35, -0.75, 0.72, 0.35),
    bb('panel', -0.75, 0.3, -0.36, 0.35, 0.7, -0.34),
    bb('black', -0.22, 0.76, -0.175, 0.23, 0.78, -0.025),
    bb('black', 0.3, 0.76, -0.12, 0.35, 0.775, -0.06),
    bb('black', 0.55, 0.76, -0.2, 0.65, 0.84, -0.12),
    bb('black', 0.585, 0.84, -0.17, 0.595, 1.0, -0.16),
  ];
  for (const x of [-0.52, 0, 0.52]) {
    out.push(
      bb('steelDark', x - 0.03, 0.76, -0.33, x + 0.03, 0.87, -0.29),
      bb('steelDark', x - 0.1, 0.76, -0.35, x + 0.1, 0.775, -0.25),
      bb('black', x - 0.25, 0.87, -0.315, x + 0.25, 1.23, -0.265),
      bb('cctv', x - 0.23, 0.89, -0.265, x + 0.23, 1.21, -0.26),
    );
  }
  return out;
}

function medCabinet(): PurposePart[] {
  const out: PurposePart[] = [
    bb('paintWhite', -0.45, 0, -0.2, 0.45, 0.12, 0.19),
    bb('paintWhite', -0.45, 0.12, -0.2, 0.45, 1.9, -0.18),
    bb('paintWhite', -0.45, 0.12, -0.2, -0.42, 1.8, 0.2),
    bb('paintWhite', 0.42, 0.12, -0.2, 0.45, 1.8, 0.2),
    bb('paintWhite', -0.45, 1.8, -0.2, 0.45, 1.9, 0.2),
    bb('firstAid', -0.17, 1.805, 0.2, 0.17, 1.895, 0.204),
    bb('black', -0.42, 0.11, 0.18, 0.42, 0.12, 0.19),
  ];
  for (const y of [0.55, 0.98, 1.41]) out.push(bb('paintWhite', -0.42, y - 0.02, -0.18, 0.42, y, 0.18));
  return out;
}

function safe(): PurposePart[] {
  const out: PurposePart[] = [
    bb('steelDark', -0.35, 0.08, -0.35, 0.35, 1.0, 0.1),
    bb('black', -0.3, 0.14, 0.098, 0.3, 0.94, 0.102),
    bb('steelDark', -0.15, 0.6, -0.3, 0.15, 0.62, 0.08),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bb('black', sx * 0.3 - 0.04, 0, sz * 0.25 - 0.04 - 0.05, sx * 0.3 + 0.04, 0.08, sz * 0.25 + 0.04 - 0.05));
  // Door swung open about 20° on its left hinge (looted), dial and handle on its face.
  const hx = -0.3, hz = 0.1, a = -0.34;
  out.push(
    hinged('steelDark', hx, hz, a, 0, 0.6, 0.12, 0.96, 0, 0.06),
    hinged('black', hx, hz, a, 0.35, 0.47, 0.6, 0.72, 0.06, 0.08),
    hinged('steelBright', hx, hz, a, 0.38, 0.44, 0.45, 0.48, 0.06, 0.09),
  );
  return out;
}

function signalRack(): PurposePart[] {
  const out: PurposePart[] = [
    bb('black', -0.6, 0, -0.3, 0.6, 0.08, 0.3),
    bb('steelDark', -0.6, 2.04, -0.3, 0.6, 2.1, 0.3),
    bb('steelBright', -0.55, 1.98, -0.12, 0.55, 2.04, 0.12),
  ];
  for (const cx of [-0.3, 0.3]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box('steelDark', [0.04, 1.96, 0.04], [cx + sx * 0.27, 1.06, sz * 0.26]));
    for (let i = 0; i < 6; i++) {
      const y = 0.18 + i * 0.3;
      out.push(bb('black', cx - 0.25, y, -0.2, cx + 0.25, y + 0.22, 0.22));
      out.push(bb(i % 3 === 1 ? 'paintRed' : 'paintGreen', cx + 0.17, y + 0.15, 0.22, cx + 0.2, y + 0.18, 0.23));
    }
  }
  return out;
}

function cartonStack(): PurposePart[] {
  return [
    bb('wood', -0.5, 0, -0.4, 0.5, 0.12, 0.4),
    bb('black', -0.45, 0.02, 0.38, 0.45, 0.09, 0.4),
    bb('cardboard', -0.49, 0.12, -0.39, -0.01, 0.5, -0.01),
    bb('cardboard', 0.01, 0.12, -0.39, 0.49, 0.5, -0.01),
    bb('cardboard', -0.49, 0.12, 0.01, -0.01, 0.5, 0.39),
    bb('cardboard', 0.01, 0.12, 0.01, 0.47, 0.46, 0.37),
    bb('cardboard', -0.48, 0.5, -0.38, 0.02, 0.84, 0.02),
    bb('cardboard', 0.04, 0.5, -0.38, 0.46, 0.86, 0.04),
    bb('cardboard', -0.46, 0.5, 0.06, -0.04, 0.82, 0.36),
    box('cardboard', [0.44, 0.3, 0.36], [-0.18, 0.99, -0.14], 0, 0.12),
    bb('cardboard', 0.1, 0.86, -0.3, 0.42, 1.12, -0.04),
    bb('cardboard', 0.14, 1.12, -0.26, 0.38, 1.28, -0.08),
  ];
}

/**
 * Task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a survivor's camp bed in an annex cache room — two 1.0 x 0.8 m wooden
 * pallets (three runners + five deck boards each, deck at 0.12 m) under a 14 cm foam mattress (vinyl cover, mattress top 0.26 m), an
 * open sleeping bag (accent: the kind's palette) with its top flap turned back, a pillow at the head (-X) and a folded blanket at the
 * foot. Bedding only (like a couch's cushions) — no loose takeable clutter is baked in. Long side (X) to a wall, front +Z.
 */
function palletBed(): PurposePart[] {
  const out: PurposePart[] = [];
  for (const cx of [-0.5, 0.5]) {
    const x0 = cx - 0.495, x1 = cx + 0.495;
    for (const z of [-0.35, 0, 0.35]) out.push(bb('wood', x0, 0, z - 0.05, x1, 0.1, z + 0.05));
    for (let k = 0; k < 5; k++) { const x = cx - 0.435 + k * 0.2175; out.push(bb('wood', x - 0.06, 0.1, -0.4, x + 0.06, 0.122, 0.4)); }
  }
  out.push(
    bb('vinyl', -0.98, 0.122, -0.4, 0.95, 0.262, 0.39),
    bb('accent', -0.56, 0.262, -0.37, 0.92, 0.305, 0.35),
    box('accent', [0.3, 0.03, 0.74], [-0.4, 0.32, -0.01], 0, 0.06),
    box('paintWhite', [0.36, 0.1, 0.52], [-0.78, 0.312, -0.04], 0, 0.1),
    bb('paintRed', 0.56, 0.305, -0.34, 0.9, 0.355, 0.04),
  );
  return out;
}

// ---------------------------------------------------------------------------------------
// Registry

type Factory = (variant: number) => PurposePart[];
const FACTORIES: Record<PurposePropKind, Factory> = {
  stockShelf, snackRack, magazineRack, techDisplay, deviceWall, showcase, flowerStand, repairBench,
  hotdogCart, grillLine, pizzaOven, espressoBar, wokLine, deliLine, blenderBar, breadRack,
  staffLockers, kitchenette, fridge, couch, noticeBoard, janitorCart, mopSink, electricalPanel,
  gunLocker, monitorDesk, medCabinet, safe, signalRack, cartonStack,
  palletBed, // lane CACHE (round 2, R5)
};

/** Every purpose kind with an authored shape (all of them). */
export const PURPOSE_KINDS_AUTHORED: readonly PurposePropKind[] = PURPOSE_PROP_KINDS.filter(k => !!FACTORIES[k]);

/** Distinct shape variants per kind (placements group by variant % count). */
export const SHAPE_VARIANTS: Partial<Record<PurposePropKind, number>> = {stockShelf: STOCK_THEMES.length, grillLine: 3, repairBench: 2, breadRack: 2};

export function shapeVariant(kind: PurposePropKind, variant: number): number {
  const n = SHAPE_VARIANTS[kind] ?? 1;
  return ((variant % n) + n) % n;
}

/** Box parts for a purpose prop (fresh array), or null when not authored. */
/**
 * Footprints the authored fallbacks were designed for, where PROP_DEFS now follows a generated
 * model's measured size (iteration-05 integration). The fallback is scaled per axis to the current
 * box, so it still fits if the model is ever missing.
 */
const AUTHORED_DIMS: Partial<Record<PurposePropKind, () => {w: number; d: number; h: number}>> = {
  // magazineRack's factory already reads w/d from PROP_DEFS; only its fixed tier spacing assumed 1.8 m.
  magazineRack: () => ({w: PROP_DEFS.magazineRack.w, d: PROP_DEFS.magazineRack.d, h: 1.8}),
  deviceWall: () => ({w: 1.5, d: 0.35, h: 2.2}), janitorCart: () => ({w: 1.1, d: 0.55, h: 1.05}),
};

export function purposePropShape(kind: PurposePropKind, variant = 0): PurposePart[] | null {
  const parts = FACTORIES[kind]?.(shapeVariant(kind, variant)) ?? null;
  const a = AUTHORED_DIMS[kind]?.();
  if (!parts || !a) return parts;
  const {w, d, h} = PROP_DEFS[kind];
  const k = [w / a.w, h / a.h, d / a.d] as const;
  // Tilted parts scale uniformly (by the smallest factor) so their rotated extents stay in the box.
  const u = Math.min(k[0], k[1], k[2]);
  return parts.map(q => {
    const ks = q.rx || q.ry ? [u, u, u] : k;
    return {...q, s: [q.s[0] * ks[0], q.s[1] * ks[1], q.s[2] * ks[2]], p: [q.p[0] * k[0], q.p[1] * k[1], q.p[2] * k[2]]};
  });
}
