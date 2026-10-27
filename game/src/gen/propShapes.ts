// Procedural prop forms as pure box data (no three.js). Primitive-based furniture stays procedural
// per reference/design/ASSET-METHOD-RULE.md; stall/vending/shelf are stand-ins used only until the
// generated derivatives exist. Local frame: origin at the bottom centre, front faces +Z, metres.

import {PROP_DEFS, SHELF_TIER_Y, STALL_BACK_SHELF_Y, STALL_BACK_SHELF_Z, STALL_COUNTER_Y, STALL_COUNTER_Z, type PropKind} from './props';

/**
 * Every shape-material key; each maps to a shared textured material in world/shapeMaterials.ts
 * (world-space metre mapping unless noted there). Storefront building blocks (gen/storefronts.ts)
 * use the same keys: see lane-contracts.md. Extra menuBoard* variants are optional per-shop menus.
 */
export const SHAPE_MAT_KEYS = [
  'steelDark', 'steelBright', 'accent', 'counter', 'panel', 'glass', 'screen', 'vendFront',
  'porcelain', 'partition', 'concrete', 'grille', 'black', 'wood', 'mirror', 'shutter',
  // Iteration 04 storefront keys.
  'shopFrame', 'signBand', 'menuBoard', 'shutterSteel', 'kitchenSteel', 'laminate', 'tileShop', 'quarryTile',
  'woodVeneer', 'plasticSeat', 'glassShopfront', 'menuBoardNoodle', 'menuBoardCoffee', 'menuBoardPizza',
] as const;
export type ShapeMat = (typeof SHAPE_MAT_KEYS)[number];

/** Box part: size, centre, optional rotation about X (radians). */
export interface ShapePart { m: ShapeMat; s: [number, number, number]; p: [number, number, number]; rx?: number }

/** Instance tint for the `accent` material, per prop variant. */
export const ACCENT_COLORS: Partial<Record<PropKind, number[]>> = {
  stall: [0xa8362b, 0xc99a2e, 0x2f7a78, 0xd9cfb4],
  vending: [0xa3271f, 0x2a4f8a, 0x2b2d30],
  table: [0x7d5a3c, 0x4f6f6c],
  booth: [0xc99a2e],
  ticketMachine: [0xc99a2e],
};

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number], rx?: number): ShapePart => ({m, s, p, rx});

function stall(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.stall;
  const hw = w / 2, hd = d / 2;
  const top = STALL_COUNTER_Y;
  const cz = (STALL_COUNTER_Z[0] + STALL_COUNTER_Z[1]) / 2, cd = STALL_COUNTER_Z[1] - STALL_COUNTER_Z[0];
  const bz = (STALL_BACK_SHELF_Z[0] + STALL_BACK_SHELF_Z[1]) / 2, bd = STALL_BACK_SHELF_Z[1] - STALL_BACK_SHELF_Z[0];
  const parts: ShapePart[] = [
    // Counter: painted front, laminate top whose upper face is the loot surface.
    box('accent', [w - 0.1, top - 0.04, cd - 0.08], [0, (top - 0.04) / 2, cz]),
    box('counter', [w - 0.04, 0.04, cd + 0.06], [0, top - 0.02, cz]),
    // Back panel, back counter and back shelves.
    box('panel', [w, h - 0.04, 0.05], [0, (h - 0.04) / 2, -hd + 0.025]),
    box('panel', [w - 0.12, 0.85, bd], [0, 0.425, bz]),
    // Side frames, roof and the coloured fascia band.
    box('steelDark', [0.05, h, d], [-hw + 0.025, h / 2, 0]),
    box('steelDark', [0.05, h, d], [hw - 0.025, h / 2, 0]),
    box('steelDark', [w, 0.04, d], [0, h - 0.02, 0]),
    box('accent', [w, 0.4, 0.08], [0, h - 0.24, hd - 0.04]),
    box('black', [w - 0.2, 0.04, 0.02], [0, h - 0.43, hd - 0.05]),
  ];
  for (const y of STALL_BACK_SHELF_Y) parts.push(box('steelBright', [w - 0.14, 0.025, bd + 0.02], [0, y - 0.0125, bz]));
  return parts;
}

function vending(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.vending;
  const fz = d / 2 + 0.006;
  return [
    box('accent', [w, h, d], [0, h / 2, 0]),
    box('vendFront', [w * 0.64, h * 0.66, 0.012], [-w * 0.1, h * 0.58, fz]),
    box('steelDark', [w * 0.2, h * 0.3, 0.012], [w * 0.34, h * 0.6, fz]),
    box('black', [w * 0.62, 0.14, 0.03], [-w * 0.1, 0.27, fz]),
    box('steelDark', [w, 0.08, d], [0, 0.04, 0]),
  ];
}

function shelf(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.shelf;
  const parts: ShapePart[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box('steelDark', [0.035, h, 0.035], [sx * (w / 2 - 0.018), h / 2, sz * (d / 2 - 0.018)]));
  for (const y of [...SHELF_TIER_Y, h - 0.02]) {
    parts.push(box('steelBright', [w, 0.025, d], [0, y - 0.0125, 0]));
    parts.push(box('steelDark', [w, 0.05, 0.012], [0, y - 0.03, d / 2 - 0.006]));
  }
  // Back stiffener rail.
  parts.push(box('steelDark', [w - 0.04, 0.02, 0.02], [0, h * 0.78, -d / 2 + 0.02]));
  return parts;
}

function table(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.table;
  const parts: ShapePart[] = [
    box('counter', [w, 0.04, d], [0, h - 0.02, 0]),
    box('steelDark', [w - 0.1, 0.06, 0.04], [0, h - 0.07, d / 2 - 0.05]),
    box('steelDark', [w - 0.1, 0.06, 0.04], [0, h - 0.07, -d / 2 + 0.05]),
    box('steelDark', [0.1, h - 0.06, 0.1], [0, (h - 0.06) / 2, -d / 4]),
    box('steelDark', [0.1, h - 0.06, 0.1], [0, (h - 0.06) / 2, d / 4]),
    box('steelDark', [0.5, 0.03, 0.5], [0, 0.015, -d / 4]),
    box('steelDark', [0.5, 0.03, 0.5], [0, 0.015, d / 4]),
  ];
  // Stools tucked under the long sides (inside the footprint, so nothing pokes out of the collision box).
  for (const sx of [-1, 1]) for (const z of [-d * 0.3, 0, d * 0.3]) {
    parts.push(box('accent', [0.3, 0.05, 0.3], [sx * (w / 2 - 0.2), 0.45, z]));
    parts.push(box('steelDark', [0.05, 0.43, 0.05], [sx * (w / 2 - 0.2), 0.215, z]));
  }
  return parts;
}

function desk(): ShapePart[] {
  const {w, d} = PROP_DEFS.desk;
  return [
    box('counter', [w, 0.04, d], [0, 0.74, 0]),
    box('steelDark', [0.45, 0.72, d - 0.05], [w / 2 - 0.25, 0.36, 0]),
    box('steelDark', [0.04, 0.72, d - 0.05], [-w / 2 + 0.03, 0.36, 0]),
    box('panel', [w - 0.1, 0.4, 0.02], [0, 0.5, -d / 2 + 0.03]),
    box('screen', [0.42, 0.28, 0.03], [-0.25, 0.92, -0.15]),
  ];
}

function booth(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.booth;
  const hw = w / 2, hd = d / 2;
  const parts: ShapePart[] = [
    box('steelDark', [w, 1.0, d], [0, 0.5, 0]),
    box('panel', [w, h - 1.0, 0.06], [0, 1.0 + (h - 1.0) / 2, -hd + 0.03]),
    box('glass', [w - 0.1, 1.3, 0.02], [0, 1.68, hd - 0.03]),
    box('glass', [0.02, 1.3, d - 0.1], [-hw + 0.03, 1.68, 0]),
    box('glass', [0.02, 1.3, d - 0.1], [hw - 0.03, 1.68, 0]),
    box('steelDark', [w + 0.1, 0.16, d + 0.1], [0, h - 0.08, 0]),
    box('accent', [w + 0.1, 0.3, 0.04], [0, h - 0.3, hd + 0.05]),
    box('counter', [1.3, 0.04, 0.34], [0, 1.02, hd + 0.14]),
    box('black', [0.5, 0.02, 0.2], [0, 1.0, hd + 0.02]),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box('steelDark', [0.06, 1.4, 0.06], [sx * (hw - 0.03), 1.7, sz * (hd - 0.03)]));
  return parts;
}

function ticketMachine(): ShapePart[] {
  const {w, d, h} = PROP_DEFS.ticketMachine;
  const fz = d / 2 + 0.006;
  return [
    box('steelDark', [w, h - 0.12, d], [0, (h - 0.12) / 2, 0]),
    box('accent', [w, 0.12, d], [0, h - 0.06, 0]),
    box('screen', [w * 0.56, 0.36, 0.012], [0, 1.28, fz]),
    box('black', [w * 0.6, 0.08, 0.02], [0, 0.95, fz]),
    box('steelBright', [w * 0.18, 0.12, 0.02], [w * 0.28, 1.02, fz]),
    box('black', [w * 0.5, 0.12, 0.03], [0, 0.45, fz]),
  ];
}

function exitStair(): ShapePart[] {
  const {w, d} = PROP_DEFS.exitStair;
  const hw = w / 2, hd = d / 2;
  const parts: ShapePart[] = [];
  const steps = 17, run = 0.3, rise = 0.17;
  const z0 = hd - 0.35; // landing between the grille and the first step
  for (let i = 0; i < steps; i++) {
    const hgt = (i + 1) * rise;
    parts.push(box('concrete', [w - 0.1, hgt, run], [0, hgt / 2, z0 - run / 2 - i * run]));
    parts.push(box('steelBright', [w - 0.1, 0.012, 0.04], [0, hgt + 0.006, z0 - 0.02 - i * run]));
  }
  const topZ = z0 - steps * run;
  const topH = steps * rise;
  parts.push(box('concrete', [w - 0.1, topH, topZ + hd], [0, topH / 2, (topZ - hd) / 2]));
  // Rolled-down street shutter at the top of the flight.
  parts.push(box('shutter', [w - 0.1, 2.1, 0.08], [0, topH + 1.05, -hd + 0.06]));
  // Handrails following the pitch.
  const len = Math.hypot(steps * run, steps * rise);
  const ang = Math.atan2(rise, run);
  for (const sx of [-1, 1]) {
    parts.push(box('steelBright', [0.05, 0.05, len], [sx * (hw - 0.12), 0.9 + topH / 2, z0 - steps * run / 2], ang));
    parts.push(box('steelDark', [0.06, topH / 2 + 0.9, 0.06], [sx * (hw - 0.12), (topH / 2 + 0.9) / 2, z0 - steps * run / 2]));
  }
  // Locked grille gate across the foot of the stair.
  const gz = hd - 0.05;
  parts.push(box('grille', [0.08, 2.7, 0.08], [-hw + 0.04, 1.35, gz]));
  parts.push(box('grille', [0.08, 2.7, 0.08], [hw - 0.04, 1.35, gz]));
  parts.push(box('grille', [w, 0.1, 0.08], [0, 2.65, gz]));
  parts.push(box('grille', [w, 0.06, 0.06], [0, 0.08, gz]));
  parts.push(box('grille', [w, 0.05, 0.05], [0, 1.3, gz]));
  for (let x = -hw + 0.16; x < hw - 0.1; x += 0.13) parts.push(box('grille', [0.022, 2.55, 0.022], [x, 1.36, gz]));
  parts.push(box('accent', [0.12, 0.16, 0.06], [0.04, 1.18, gz + 0.06]));
  return parts;
}

function toiletStall(): ShapePart[] {
  const {w, d} = PROP_DEFS.toiletStall;
  const hw = w / 2, hd = d / 2;
  return [
    box('partition', [0.03, 1.8, d], [-hw + 0.015, 1.05, 0]),
    box('partition', [0.03, 1.8, d], [hw - 0.015, 1.05, 0]),
    box('partition', [w - 0.1, 1.72, 0.03], [0, 1.03, hd - 0.02]),
    box('steelBright', [w, 0.04, 0.04], [0, 2.0, hd - 0.02]),
    box('steelBright', [0.025, 0.15, 0.025], [-hw + 0.015, 0.075, hd - 0.03]),
    box('steelBright', [0.025, 0.15, 0.025], [hw - 0.015, 0.075, hd - 0.03]),
    box('porcelain', [0.38, 0.4, 0.5], [0, 0.2, -hd + 0.35]),
    box('porcelain', [0.42, 0.36, 0.16], [0, 0.6, -hd + 0.1]),
    box('black', [0.1, 0.03, 0.01], [0.3, 1.0, hd - 0.003]),
  ];
}

function washCounter(): ShapePart[] {
  const {w, d} = PROP_DEFS.washCounter;
  const parts: ShapePart[] = [
    box('counter', [w, 0.08, d], [0, 0.86, 0]),
    box('panel', [w, 0.24, 0.03], [0, 0.7, d / 2 - 0.02]),
    box('steelDark', [0.05, 0.82, d - 0.1], [-w / 2 + 0.1, 0.41, 0]),
    box('steelDark', [0.05, 0.82, d - 0.1], [w / 2 - 0.1, 0.41, 0]),
    box('mirror', [w - 0.2, 0.9, 0.02], [0, 1.65, -d / 2 + 0.01]),
  ];
  for (const x of [-0.6, 0.6]) {
    parts.push(box('porcelain', [0.46, 0.03, 0.34], [x, 0.905, 0.04]));
    parts.push(box('steelBright', [0.03, 0.18, 0.03], [x, 0.99, -0.2]));
    parts.push(box('steelBright', [0.03, 0.03, 0.14], [x, 1.07, -0.14]));
  }
  return parts;
}

const FACTORIES: Partial<Record<PropKind, () => ShapePart[]>> = {stall, vending, shelf, table, desk, booth, ticketMachine, exitStair, toiletStall, washCounter};

/** Box parts for a procedural prop kind (fresh array), or null for kinds built elsewhere. */
export function propShape(kind: PropKind): ShapePart[] | null {
  return FACTORIES[kind]?.() ?? null;
}
