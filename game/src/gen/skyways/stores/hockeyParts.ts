// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOCKEY): the CODE-DRAWN geometry of Blue Line Sports' own kinds
// (stores/kinds/hockey.ts). Pure data: box parts in the prop frame (origin bottom centre, front +Z, metres), each a shape material
// (gen/propShapes.ts: steel, black, glass, porcelain) or a purpose paint (gen/purposeShapes.ts: paintRed / paintBlue / paintWhite /
// paintYellow / paintGreen / paintOrange). Drawn by world/skywaysDestinations.ts (DestKindSpec.parts, merged per material, one batch per
// variant); rendered for the scale check by tools/asset-pipeline/props/scale-check.mjs --kind <kind>.
//
// Geometry, not art: the team colours are flat paint blocks (stripes, yokes, cuffs) — no drawn texture, no text, no logos, no real
// team. Real-world sizes (root CLAUDE.md rule 5): a senior stick 1.5 m, skates ~0.27 m long, a helmet 0.22 m wide, dasher boards
// 1.07 m with their shielding glass above.
//
// Root CLAUDE.md rule 4: the rack and the boards carry nothing baked: the sticks are their own kind standing in the rack, the jerseys
// hang on the jersey wall's rail, the skates / helmets / gloves / shin pads stand on the shelves as separate props.

import type {DestDrawnPart} from '../destinations/kindTypes';
import type {PartMat} from '../../purposeShapes';

type V3 = readonly [number, number, number];
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const P = (m: PartMat, s: V3, p: V3, o: {rx?: number; ry?: number} = {}): DestDrawnPart => ({m, s: [r4(s[0]), r4(s[1]), r4(s[2])], p: [r4(p[0]), r4(p[1]), r4(p[2])], ...o});
const wrapV = (v: number, n: number) => ((Math.trunc(v) % n) + n) % n;

// ---------------------------------------------------------------------------------------------
// Sizes (the kinds' PROP_DEFS boxes read these)

/** The floor stick rack: a steel base trough (the blades stand in it), end posts, a slotted top rail. */
export const HK_STICK_RACK = {w: 1.6, d: 0.5, h: 1.16, trayY: 0.05, railY: 1.08, shaftZ: -0.12} as const;
/** A rack's sticks (12 senior sticks, 1.5 m): the rider box over the rack. */
export const HK_STICKS = {w: 1.42, d: 0.42, h: 1.6, n: 12, pitch: 0.12, len: 1.5} as const;
/** A jersey hung face-out from a rail (sleeves hanging beside the body): hook top = the rail. */
export const HK_JERSEY = {w: 0.84, d: 0.04, h: 0.8} as const;
/** Skates (a pair, side by side, toes along +x: the profile faces the shopper). */
export const HK_SKATES = {w: 0.28, d: 0.2, h: 0.22} as const;
/** A helmet with its full-face cage (face +Z). */
export const HK_HELMET = {w: 0.22, d: 0.29, h: 0.18} as const;
/** Hockey gloves (a pair, palms down, cuffs to the front). */
export const HK_GLOVES = {w: 0.37, d: 0.32, h: 0.11} as const;
/** Shin guards (a pair lying flat, knee caps toward +x). */
export const HK_SHIN_PADS = {w: 0.44, d: 0.3, h: 0.1} as const;
/** A dasher-board section with its shielding glass (both faces alike). */
export const HK_RINK_BOARD = {w: 2.0, d: 0.14, h: 1.88, boardTop: 1.1} as const;

// ---------------------------------------------------------------------------------------------
// Palettes (variants)

/** Team jerseys: [main, stripe, trim] — six invented colourways (no real team). */
export const HK_JERSEY_COLOURS: readonly (readonly [PartMat, PartMat, PartMat])[] = [
  ['paintRed', 'paintWhite', 'black'],
  ['paintBlue', 'paintWhite', 'paintRed'],
  ['paintWhite', 'paintBlue', 'paintRed'],
  ['black', 'paintYellow', 'paintWhite'],
  ['paintGreen', 'paintWhite', 'paintYellow'],
  ['paintOrange', 'black', 'paintWhite'],
];
/** Skate accents (heel cap / quarter stripe) and holder colour. */
const SKATE_COLOURS: readonly (readonly [PartMat, PartMat])[] = [['paintRed', 'paintWhite'], ['paintBlue', 'paintWhite'], ['steelBright', 'black'], ['paintYellow', 'black']];
/** Helmet shells. */
const HELMET_COLOURS: readonly PartMat[] = ['paintWhite', 'black', 'paintBlue', 'paintRed'];
/** Gloves: [main, cuff stripe]. */
const GLOVE_COLOURS: readonly (readonly [PartMat, PartMat])[] = [['black', 'paintWhite'], ['paintRed', 'black'], ['paintBlue', 'paintWhite'], ['black', 'paintRed']];
/** Shin guards: [shell, knee cap]. */
const PAD_COLOURS: readonly (readonly [PartMat, PartMat])[] = [['paintWhite', 'paintBlue'], ['black', 'paintRed'], ['paintBlue', 'paintWhite']];

export const HK_VARIANTS = {hkJersey: HK_JERSEY_COLOURS.length, hkSkates: SKATE_COLOURS.length, hkHelmet: HELMET_COLOURS.length, hkGloves: GLOVE_COLOURS.length, hkShinPads: PAD_COLOURS.length} as const;

// ---------------------------------------------------------------------------------------------
// Parts

/** The stick rack (no sticks: they are the hkSticks rider). */
export function stickRackParts(): readonly DestDrawnPart[] {
  const {w, d, trayY, railY, shaftZ} = HK_STICK_RACK, ex = w / 2 - 0.025;
  return [
    // two steel feet and the base trough (floor plate + front / back lips) the blades stand in
    ...[-ex, ex].map(x => P('steelDark', [0.06, 0.03, d], [x, 0.015, 0])),
    P('steelDark', [w - 0.04, 0.02, 0.38], [0, trayY - 0.01, 0.01]),
    P('steelDark', [w, 0.07, 0.02], [0, 0.065, 0.2]),
    P('steelDark', [w, 0.07, 0.02], [0, 0.065, -0.18]),
    // end posts, a back rail at knee height, the slotted top rail with its blue cap
    ...[-ex, ex].map(x => P('steelDark', [0.05, railY + 0.04, 0.05], [x, (railY + 0.04) / 2, shaftZ])),
    P('steelBright', [w - 0.06, 0.03, 0.03], [0, 0.5, shaftZ - 0.04]),
    P('steelBright', [w, 0.04, 0.1], [0, railY, shaftZ]),
    P('paintBlue', [w + 0.02, 0.05, 0.11], [0, railY + 0.045, shaftZ]),
    // the slot teeth on the rail (rubber), between the sticks
    ...Array.from({length: HK_STICKS.n + 1}, (_, i) => P('black', [0.012, 0.035, 0.1], [-HK_STICKS.pitch * HK_STICKS.n / 2 + i * HK_STICKS.pitch, railY + 0.085, shaftZ])),
  ];
}

/** A rack's sticks: shafts upright through the rail's slots, blades forward in the trough, taped blades and knobs, shaft graphics. */
export function sticksParts(): readonly DestDrawnPart[] {
  const {n, pitch, len} = HK_STICKS, z = HK_STICK_RACK.shaftZ, y0 = HK_STICK_RACK.trayY + 0.005;
  const shafts: PartMat[] = ['black', 'paintWhite', 'black', 'paintRed', 'black', 'steelDark', 'paintBlue', 'black', 'paintYellow', 'black', 'paintWhite', 'black'];
  const bands: PartMat[] = ['paintRed', 'black', 'paintBlue', 'paintWhite', 'paintYellow', 'paintRed', 'paintWhite', 'paintGreen', 'black', 'paintBlue', 'paintRed', 'paintOrange'];
  const out: DestDrawnPart[] = [];
  for (let i = 0; i < n; i++) {
    const x = -pitch * (n - 1) / 2 + i * pitch, shaftH = len - 0.06;
    // the shaft (its heel overlapping the blade's back end), its graphic band, the knob tape at the butt end
    out.push(P(shafts[i % shafts.length], [0.028, shaftH, 0.022], [x, y0 + 0.05 + shaftH / 2, z]));
    out.push(P(bands[i % bands.length], [0.03, 0.22, 0.024], [x, y0 + 0.82 + (i % 3) * 0.06, z]));
    out.push(P(i % 4 === 1 ? 'paintWhite' : 'black', [0.034, 0.13, 0.028], [x, y0 + len - 0.075, z]));
    // the blade: a thin vertical plate forward of the heel, cloth tape round its middle
    const bl = i % 5 === 2 ? 'paintWhite' : 'black';
    out.push(P(bl, [0.012, 0.075, 0.28], [x, y0 + 0.0375, z + 0.14]));
    out.push(P(i % 3 === 0 ? 'paintWhite' : 'black', [0.016, 0.062, 0.15], [x, y0 + 0.0375, z + 0.15]));
  }
  return out;
}

/** A jersey on its hanger: body, hanging sleeves, shoulder yoke, collar, sleeve / hem stripes and cuffs (one colourway per variant). */
export function jerseyParts(variant: number): readonly DestDrawnPart[] {
  const [main, stripe, trim] = HK_JERSEY_COLOURS[wrapV(variant, HK_JERSEY_COLOURS.length)];
  const bodyW = 0.54, slW = 0.15, sx = bodyW / 2 + slW / 2, top = 0.74, bodyH = 0.7, slH = 0.48;
  const out: DestDrawnPart[] = [
    // hanger hook (to the rail) and bar behind the shoulders
    P('steelBright', [0.008, 0.05, 0.008], [0, 0.775, -0.006]),
    P('steelBright', [0.44, 0.014, 0.012], [0, 0.745, -0.012]),
    // body, sleeves hanging beside it, the yoke across the shoulders, the collar
    P(main, [bodyW, bodyH, 0.03], [0, top - bodyH / 2, 0]),
    ...[-sx, sx].map(x => P(main, [slW, slH, 0.028], [x, top - slH / 2 - 0.01, 0])),
    P(stripe, [bodyW + 2 * slW, 0.09, 0.032], [0, top - 0.045, 0]),
    P(trim, [0.14, 0.05, 0.034], [0, top - 0.02, 0]),
    // hem stripes: a wide band and a thin trim line
    P(stripe, [bodyW + 0.002, 0.07, 0.032], [0, 0.16, 0]),
    P(trim, [bodyW + 0.002, 0.035, 0.033], [0, 0.105, 0]),
  ];
  for (const x of [-sx, sx]) {
    out.push(P(stripe, [slW + 0.002, 0.05, 0.03], [x, 0.37, 0]));
    out.push(P(trim, [slW + 0.002, 0.03, 0.031], [x, 0.33, 0]));
    out.push(P(trim, [slW + 0.002, 0.04, 0.031], [x, top - slH - 0.01 + 0.02, 0]));
  }
  return out;
}

/** A pair of skates: steel runners, blade holders, boots (lower + ankle), tongues, heel caps and a side stripe. */
export function skatesParts(variant: number): readonly DestDrawnPart[] {
  const [accent, holder] = SKATE_COLOURS[wrapV(variant, SKATE_COLOURS.length)];
  const out: DestDrawnPart[] = [];
  for (const z of [-0.052, 0.052]) {
    out.push(P('steelBright', [0.27, 0.012, 0.006], [0, 0.006, z]));
    out.push(P(holder, [0.25, 0.045, 0.03], [0, 0.0345, z]));
    out.push(P('black', [0.25, 0.06, 0.09], [0, 0.087, z]));
    out.push(P('black', [0.13, 0.08, 0.09], [-0.05, 0.157, z]));
    out.push(P('paintWhite', [0.04, 0.1, 0.06], [0.035, 0.167, z]));
    out.push(P(accent, [0.03, 0.065, 0.092], [-0.112, 0.125, z]));
    out.push(P(accent, [0.1, 0.022, 0.092], [-0.02, 0.105, z]));
  }
  return out;
}

/** A helmet: open-faced shell (crown, sides, back), dark liner, ear guards, the steel full-face cage and its chin cup. */
export function helmetParts(variant: number): readonly DestDrawnPart[] {
  const c = HELMET_COLOURS[wrapV(variant, HELMET_COLOURS.length)];
  const out: DestDrawnPart[] = [
    P(c, [0.21, 0.07, 0.25], [0, 0.135, -0.01]),
    P(c, [0.17, 0.035, 0.21], [0, 0.1625, -0.02]),
    ...[-0.095, 0.095].map(x => P(c, [0.02, 0.1, 0.25], [x, 0.05, -0.01])),
    P(c, [0.17, 0.1, 0.04], [0, 0.05, -0.115]),
    P('black', [0.17, 0.08, 0.01], [0, 0.055, -0.08]),
    ...[-0.108, 0.108].map(x => P('black', [0.012, 0.07, 0.08], [x, 0.045, 0.03])),
    // the cage: uprights, cross bars, side bars, the chin cup (its rim rests on the shelf with the shell)
    ...[-0.07, -0.035, 0, 0.035, 0.07].map(x => P('steelBright', [0.004, 0.11, 0.004], [x, 0.065, 0.135])),
    ...[0.03, 0.07, 0.11].map(y => P('steelBright', [0.16, 0.004, 0.004], [0, y, 0.135])),
    ...[-0.082, 0.082].map(x => P('steelBright', [0.004, 0.1, 0.03], [x, 0.06, 0.12])),
    P('black', [0.06, 0.03, 0.03], [0, 0.015, 0.13]),
  ];
  return out;
}

/** A pair of gloves: cuff, backhand, finger rolls and thumb (mirrored), a stripe round each cuff. */
export function glovesParts(variant: number): readonly DestDrawnPart[] {
  const [main, stripe] = GLOVE_COLOURS[wrapV(variant, GLOVE_COLOURS.length)];
  const out: DestDrawnPart[] = [];
  for (const s of [-1, 1]) {
    const x = s * 0.087;
    out.push(P(main, [0.16, 0.11, 0.1], [x, 0.055, 0.11]));
    out.push(P(stripe, [0.162, 0.03, 0.102], [x, 0.085, 0.11]));
    out.push(P(main, [0.15, 0.1, 0.13], [x, 0.05, -0.005]));
    out.push(P(main, [0.15, 0.075, 0.09], [x, 0.0375, -0.115]));
    out.push(P('black', [0.152, 0.004, 0.02], [x, 0.077, -0.09]));
    out.push(P(main, [0.03, 0.06, 0.09], [x + s * 0.08, 0.03, -0.04]));
  }
  return out;
}

/** A pair of shin guards lying flat: shin shell, knee cap, the black liner / strap underneath. */
export function shinPadsParts(variant: number): readonly DestDrawnPart[] {
  const [shell, knee] = PAD_COLOURS[wrapV(variant, PAD_COLOURS.length)];
  const out: DestDrawnPart[] = [];
  for (const z of [-0.072, 0.072]) {
    out.push(P('black', [0.4, 0.02, 0.12], [0, 0.01, z]));
    out.push(P(shell, [0.29, 0.065, 0.13], [-0.06, 0.0525, z]));
    out.push(P(knee, [0.13, 0.08, 0.135], [0.15, 0.06, z]));
    out.push(P('black', [0.02, 0.07, 0.132], [0.08, 0.055, z]));
  }
  return out;
}

/** A dasher-board section: yellow kick plate, white boards, the blue top cap, shielding glass between two stanchions. */
export function rinkBoardParts(): readonly DestDrawnPart[] {
  const {w, d, boardTop, h} = HK_RINK_BOARD, glassH = h - boardTop - 0.02;
  return [
    P('paintYellow', [w, 0.22, d - 0.02], [0, 0.11, 0]),
    P('paintWhite', [w, boardTop - 0.27, d - 0.04], [0, 0.22 + (boardTop - 0.27) / 2, 0]),
    P('paintBlue', [w, 0.05, d], [0, boardTop - 0.025, 0]),
    P('glass', [w - 0.06, glassH, 0.012], [0, boardTop + glassH / 2, 0]),
    ...[-(w / 2 - 0.015), w / 2 - 0.015].map(x => P('steelBright', [0.03, glassH + 0.02, 0.06], [x, boardTop + (glassH + 0.02) / 2, 0])),
  ];
}
