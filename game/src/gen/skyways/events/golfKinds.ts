// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the mini-golf event's NEW prop kinds (hand-built
// simple meshes: code-drawn parts + canvas faces + the turf drawn by world/skywaysGolfDraw.ts; existing kinds are reused wherever they
// fit). Every kind is classified honestly for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md):
// physics (dynamic / static reason), openables, damage, and a scale record. Merged by gen/skyways/events/kinds.ts.
// The collision of the course pieces: gen/skyways/events/golfContract.ts golfColliderBoxes (raised slabs; the cup = a gap).
//
// Sized per placement (the dresser sets hx / hz; world/skywaysGolfDraw.ts scales one unit piece per instance): golfGreen, golfTier
// (the deck), golfRail (a straight run of bumper rail), golfBlock (a painted bumper block). Fixed size: the cup piece, the tunnel arch,
// the tee mat, the tee sign, the flag, the scorecard caddy, the putter rack, the party banner. Variants: the deck's turf tint
// (GOLF_TINTS), a rail / block / arch paint scheme, a sign's hole number + par, the card's course name + pars (canvas faces: DYNAMIC
// per-seed text over code shapes — no static art).

import type {DestDrawnPart} from '../destinations/kindTypes';
import type {EventFace, EventKindSpec} from './eventKindTypes';
import {GOLF_ARCH, GOLF_CUP_PIECE, GOLF_CUP_R, GOLF_GREEN_H, GOLF_RAIL, GOLF_TIER_H} from './golfContract';
import type {PartMat} from '../../purposeShapes';

export const GOLF_KINDS = ['golfGreen', 'golfCup', 'golfTier', 'golfRail', 'golfBlock', 'golfArch', 'golfTeeMat', 'golfTeeSign', 'golfFlag', 'golfScorecardStand', 'golfPutterRack', 'golfPartyBanner'] as const;
export type GolfKind = (typeof GOLF_KINDS)[number];

/** The course carpet's tints (deck variant): classic green, deep fairway, lagoon blue, teal, brick red. */
export const GOLF_TINTS = [0x3f8f3a, 0x2c6b33, 0x2f6fa8, 0x2a8a84, 0x9a3b34] as const;
/** Rail paint schemes (variant): varnished wood, white, red, blue — each with a black rubber bumper cap. */
export const GOLF_RAIL_MATS: readonly PartMat[] = ['wood', 'paintWhite', 'paintRed', 'paintBlue'];
/** Bumper block paints (variant). */
export const GOLF_BLOCK_MATS: readonly PartMat[] = ['paintRed', 'paintYellow', 'paintBlue', 'paintWhite', 'paintOrange', 'concrete'];
/** Tunnel arch paint schemes (variant): posts / lintel. */
export const GOLF_ARCH_MATS: readonly (readonly [PartMat, PartMat])[] = [['paintRed', 'paintWhite'], ['paintBlue', 'paintYellow'], ['paintGreen', 'paintWhite']];
/** The rubber cap on a rail's top (m). */
export const GOLF_RAIL_CAP = 0.012;

/** The tee sign: a hole plate on a post over a weighted base (prop frame, m). */
export const GOLF_TEE_SIGN = {w: 0.34, d: 0.22, h: 0.92, plate: {w: 0.34, h: 0.26, y: 0.79, t: 0.02}} as const;
/** The flag: a pole on a clamp foot with a small pennant (prop frame, m: the pole at x = pole). */
export const GOLF_FLAG = {w: 0.26, d: 0.05, h: 0.62, pole: -0.115, cloth: {w: 0.22, h: 0.13, y: 0.53}} as const;
/** The scorecard caddy (a card in an acrylic stand and a pencil cup) on the front desk. */
export const GOLF_CARD = {w: 0.16, d: 0.09, h: 0.2} as const;
/** The wall putter rack (empty hooks: the one putter lies on the front desk) and the party banner. */
export const GOLF_RACK = {w: 0.9, d: 0.1, h: 0.5, y: 0.95} as const;
export const GOLF_BANNER = {w: 1.8, d: 0.02, h: 0.45, y: 1.55} as const;
/** The tee mat (rubber, on the turf). */
export const GOLF_TEE_MAT = {w: 0.5, d: 0.36, h: 0.004} as const;

/**
 * Tee-sign variant: the hole number and its par (and the course name's index for the plate's footer). The card's variant: the course
 * name, the hole count and every hole's par (base-3 digits of par - 2).
 */
export const golfSignVariant = (n: number, par: number, name: number): number => name * 1000 + n * 10 + par;
export const golfSignOf = (v: number): {n: number; par: number; name: number} => ({n: Math.floor((v % 1000) / 10), par: v % 10, name: Math.floor(v / 1000)});
export function golfCardVariant(name: number, pars: readonly number[]): number {
  let code = 0;
  for (let k = pars.length - 1; k >= 0; k--) code = code * 3 + Math.max(0, Math.min(2, pars[k] - 2));
  return (name * 16 + pars.length) * 19683 + code;
}
export function golfCardOf(v: number): {name: number; pars: number[]} {
  const code = v % 19683, head = Math.floor(v / 19683), n = head % 16, pars: number[] = [];
  let c = code;
  for (let k = 0; k < n; k++) { pars.push(2 + (c % 3)); c = Math.floor(c / 3); }
  return {name: Math.floor(head / 16), pars};
}

const box = (m: PartMat, s: [number, number, number], p: [number, number, number]): DestDrawnPart => ({m, s, p});
const H = GOLF_GREEN_H;

function cupParts(): DestDrawnPart[] {
  // the deck square with a round-ish opening (four slabs round the 108 mm cup) and the liner's floor
  const S = GOLF_CUP_PIECE, c = GOLF_CUP_R, side = (S - 2 * c) / 2, off = c + side / 2;
  return [
    box('paintGreen', [S, H, side], [0, H / 2, off]), box('paintGreen', [S, H, side], [0, H / 2, -off]),
    box('paintGreen', [side, H, 2 * c], [off, H / 2, 0]), box('paintGreen', [side, H, 2 * c], [-off, H / 2, 0]),
    box('paintWhite', [2 * c, 0.004, 2 * c], [0, 0.002, 0]),
  ];
}
function archParts(v: number): DestDrawnPart[] {
  const A = GOLF_ARCH, [post, lintel] = GOLF_ARCH_MATS[v % GOLF_ARCH_MATS.length], px = A.w / 2 - A.post / 2;
  return [
    box(post, [A.post, A.h, A.d], [px, A.h / 2, 0]), box(post, [A.post, A.h, A.d], [-px, A.h / 2, 0]),
    box(lintel, [A.gap, A.h - A.lintel, A.d * 0.9], [0, (A.h + A.lintel) / 2, 0]),
  ];
}
function signParts(): DestDrawnPart[] {
  const S = GOLF_TEE_SIGN, P = S.plate;
  return [
    box('black', [S.w, 0.03, S.d], [0, 0.015, 0]),
    box('steelBright', [0.035, P.y - P.h / 2 - 0.03, 0.035], [0, 0.03 + (P.y - P.h / 2 - 0.03) / 2, 0]),
    box('paintWhite', [P.w, P.h, P.t], [0, P.y, 0]),
  ];
}
const signFaces = (): EventFace[] => {
  const P = GOLF_TEE_SIGN.plate;
  return [{paint: 'golf-hole', w: P.w - 0.02, h: P.h - 0.02, p: [0, P.y, P.t / 2 + 0.0015]}, {paint: 'golf-hole', w: P.w - 0.02, h: P.h - 0.02, p: [0, P.y, -P.t / 2 - 0.0015], ry: Math.PI}];
};
function flagParts(): DestDrawnPart[] {
  const F = GOLF_FLAG, C = F.cloth, cx = F.pole + 0.007 + C.w / 2;
  return [
    box('black', [0.05, 0.03, F.d], [F.pole, 0.015, 0]),
    box('paintWhite', [0.014, F.h - 0.03, 0.014], [F.pole, 0.03 + (F.h - 0.03) / 2, 0]),
    box('paintRed', [C.w, C.h, 0.004], [cx, C.y, 0]),
  ];
}
const flagFaces = (): EventFace[] => {
  const F = GOLF_FLAG, C = F.cloth, cx = F.pole + 0.007 + C.w / 2;
  return [{paint: 'golf-flag', w: C.w, h: C.h, p: [cx, C.y, 0.0025]}, {paint: 'golf-flag', w: C.w, h: C.h, p: [cx, C.y, -0.0025], ry: Math.PI}];
};
function cardParts(): DestDrawnPart[] {
  const C = GOLF_CARD;
  return [
    box('plasticSeat', [C.w, 0.012, C.d], [0, 0.006, 0]),
    box('glass', [0.11, 0.17, 0.008], [-0.02, 0.012 + 0.085, -0.01]),
    box('black', [0.04, 0.075, 0.04], [0.055, 0.012 + 0.0375, 0.015]),
    box('paintYellow', [0.008, 0.09, 0.008], [0.048, 0.012 + 0.075 + 0.02, 0.012]),
    box('paintYellow', [0.008, 0.09, 0.008], [0.062, 0.012 + 0.075 + 0.015, 0.02]),
  ];
}
const cardFaces = (): EventFace[] => [{paint: 'golf-card', w: 0.1, h: 0.15, p: [-0.02, 0.012 + 0.085, -0.0055]}];
function rackParts(): DestDrawnPart[] {
  const R = GOLF_RACK, out: DestDrawnPart[] = [box('wood', [R.w, R.h, 0.02], [0, R.h / 2, -R.d / 2 + 0.01]), box('woodVeneer', [R.w, 0.04, 0.05], [0, 0.3, -R.d / 2 + 0.045])];
  for (let k = 0; k < 6; k++) out.push(box('steelBright', [0.016, 0.016, 0.07], [-0.375 + k * 0.15, 0.32, -R.d / 2 + 0.055]));
  return out;
}
const rackFaces = (): EventFace[] => [{paint: 'golf-rack', w: GOLF_RACK.w - 0.06, h: 0.11, p: [0, 0.43, -GOLF_RACK.d / 2 + 0.0215]}];

export const GOLF_SPECS: Readonly<Record<GolfKind, EventKindSpec>> = {
  golfGreen: {
    def: {w: 1.0, d: 1.0, h: GOLF_GREEN_H, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a piece of the course\'s raised turf deck (carpet on a timber frame screwed to the floor): walked on and putted across, never shoved (walkers cross it: PropPlacement.walkOver)'},
    damage: 'fabric',
    open: {cls: 'none', role: 'surface', how: 'turf deck: nothing to open'},
    parts: () => [box('paintGreen', [1.0, GOLF_GREEN_H, 1.0], [0, GOLF_GREEN_H / 2, 0])],
  },
  golfCup: {
    def: {w: GOLF_CUP_PIECE, d: GOLF_CUP_PIECE, h: GOLF_GREEN_H, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'the turf deck square round a hole\'s cup (a plastic cup liner set into the deck): part of the deck'},
    damage: 'fabric',
    open: {cls: 'none', role: 'surface', how: 'turf deck with a sunk cup: nothing to open (a ball drops into the cup)'},
    parts: cupParts,
  },
  golfTier: {
    def: {w: 1.0, d: 1.0, h: GOLF_TIER_H, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a raised tier of the course deck (the carpeted frame 5 cm higher than the green it steps down onto): part of the built-in deck'},
    damage: 'fabric',
    open: {cls: 'none', role: 'surface', how: 'raised turf deck: nothing to open'},
    parts: () => [box('paintGreen', [1.0, GOLF_TIER_H, 1.0], [0, GOLF_TIER_H / 2, 0])],
  },
  golfRail: {
    def: {w: 1.0, d: GOLF_RAIL.t, h: GOLF_RAIL.h, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a bumper rail run (an 8 cm timber board with a rubber cap) screwed along the deck\'s edge: balls bounce off it, walkers step over it'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'bumper rail: nothing to open'},
    parts: (v: number) => [box(GOLF_RAIL_MATS[v % GOLF_RAIL_MATS.length], [1.0, GOLF_RAIL.h - GOLF_RAIL_CAP, GOLF_RAIL.t], [0, (GOLF_RAIL.h - GOLF_RAIL_CAP) / 2, 0]),
      box('black', [1.0, GOLF_RAIL_CAP, GOLF_RAIL.t + 0.006], [0, GOLF_RAIL.h - GOLF_RAIL_CAP / 2, 0])],
  },
  golfBlock: {
    def: {w: 0.36, d: 0.36, h: 0.12, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a painted bumper block bolted through the turf into the deck frame (an obstacle to putt round): balls bounce off it, never shoved'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'solid painted block: nothing to open'},
    parts: (v: number) => [box(GOLF_BLOCK_MATS[v % GOLF_BLOCK_MATS.length], [0.36, 0.12, 0.36], [0, 0.06, 0])],
  },
  golfArch: {
    def: {w: GOLF_ARCH.w, d: GOLF_ARCH.d, h: GOLF_ARCH.h, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a painted tunnel gate bolted across the lane (two posts and a lintel over a 34 cm opening): the ball has to thread it'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'solid painted gate: nothing to open'},
    parts: archParts,
  },
  golfTeeMat: {
    def: {w: GOLF_TEE_MAT.w, d: GOLF_TEE_MAT.d, h: GOLF_TEE_MAT.h, blocksSight: false},
    phys: {dynamic: false, why: 'flat', how: 'a 4 mm rubber tee mat glued onto the turf: nothing to shove or tip'},
    damage: 'rubber',
    open: {cls: 'none', role: 'surface', how: 'flat tee mat: nothing to open'},
    parts: () => [box('black', [GOLF_TEE_MAT.w, GOLF_TEE_MAT.h, GOLF_TEE_MAT.d], [0, GOLF_TEE_MAT.h / 2, 0])],
  },
  golfTeeSign: {
    def: {w: GOLF_TEE_SIGN.w, d: GOLF_TEE_SIGN.d, h: GOLF_TEE_SIGN.h, blocksSight: false, physics: {mass: 3.5, dynamic: true, shape: 'box', mat: 'pad', contact: true}},
    phys: {dynamic: true, mass: 3.5, mat: 'pad', shape: 'box', how: 'a hole sign on a steel post over a weighted rubber base (~3.5 kg): walked into it slides, shot it slides / tips over'},
    damage: 'plastic',
    open: {cls: 'none', role: 'decor', how: 'sign on a post: nothing to open'},
    parts: signParts,
    faces: signFaces,
  },
  golfFlag: {
    def: {w: GOLF_FLAG.w, d: GOLF_FLAG.d, h: GOLF_FLAG.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'a short hole flag on a pole clamped to the course frame beside the cup (outside the rail, never in the cup): bullets mark it only'},
    damage: 'cloth',
    open: {cls: 'none', role: 'decor', how: 'flag on a pole: nothing to open'},
    parts: flagParts,
    faces: flagFaces,
  },
  golfScorecardStand: {
    def: {w: GOLF_CARD.w, d: GOLF_CARD.d, h: GOLF_CARD.h, blocksSight: false, physics: {mass: 0.6, dynamic: true, shape: 'box', mat: 'plastic', contact: true, onHost: true}},
    phys: {dynamic: true, mass: 0.6, mat: 'plastic', shape: 'box', onHost: true, how: 'a scorecard in a solid acrylic block stand with a pencil cup (~0.6 kg of acrylic, like the convention\'s print easel) on the front desk: a shot knocks it over or off the desk (on-host decor)'},
    damage: 'plastic',
    open: {cls: 'none', role: 'decor', how: 'card stand and pencil cup: nothing to open'},
    parts: cardParts,
    faces: cardFaces,
  },
  golfPutterRack: {
    def: {w: GOLF_RACK.w, d: GOLF_RACK.d, h: GOLF_RACK.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'a wall-mounted putter rack (a board with six empty hooks: the course\'s one putter is at the front desk): screwed to the wall'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'open hook rack: nothing to open, nothing hung on it'},
    parts: rackParts,
    faces: rackFaces,
  },
  golfPartyBanner: {
    def: {w: GOLF_BANNER.w, d: GOLF_BANNER.d, h: GOLF_BANNER.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'a printed birthday banner on a light board taped flat to the party room wall: bullets mark it only'},
    damage: 'cardboard',
    open: {cls: 'none', role: 'decor', how: 'wall banner: nothing to open'},
    parts: () => [box('paintWhite', [GOLF_BANNER.w, GOLF_BANNER.h, 0.01], [0, GOLF_BANNER.h / 2, -GOLF_BANNER.d / 2 + 0.005])],
    faces: () => [{paint: 'golf-party', w: GOLF_BANNER.w, h: GOLF_BANNER.h, p: [0, GOLF_BANNER.h / 2, -GOLF_BANNER.d / 2 + 0.0115]}],
  },
};
/** Scale-check records (tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift, viewed): W x H x D, contact. */
export const GOLF_SCALE: Readonly<Partial<Record<GolfKind, string>>> = {
  golfGreen: 'unit piece 1.00 x 0.06 x 1.00 m (sized per placement, each piece <= 2.8 m across: GOLF_PIECE_MAX_R); turf top 0.06 m, ankle height; grounded, 4 corners',
  golfCup: '0.50 x 0.06 x 0.50 m deck square, the 108 mm cup open in its top; grounded, full base (the liner floor 1.5 mm over the hall floor)',
  golfTier: 'unit piece 1.00 x 0.11 x 1.00 m (sized per placement): 5 cm over the green it steps down to; grounded, 4 corners',
  golfRail: 'unit run 1.00 x 0.11 x 0.086 m (cap incl.; length per placement), standing on the deck top: 0.17 m over the floor, shin-low; on the deck, 2 ends',
  golfBlock: '0.36 x 0.12 x 0.36 m (sized per placement: the island block 0.7 m wide, in pieces <= 2.8 m long), standing on the turf; on the deck, full base',
  golfArch: '1.00 x 0.30 x 0.16 m tunnel gate (0.34 m wide x 0.20 m high opening) across a 1 m lane, knee-low; on the deck, 2 posts',
  golfTeeMat: '0.50 x 0.004 x 0.36 m rubber mat on the turf; flat, full base',
  golfTeeSign: '0.34 x 0.92 x 0.22 m (plate 0.34 x 0.26 at 0.79 m, about a zombie\'s hip); grounded, 4 corners of its weighted base',
  golfFlag: '0.25 x 0.62 x 0.05 m pole and pennant beside the cup (outside the rail), below a zombie\'s knee + 0.1 m; grounded on its clamp foot, 1 contact',
  golfScorecardStand: '0.16 x 0.18 x 0.09 m card stand + pencil cup on the 1.05 m front desk; on its host top, 2 contacts',
  golfPutterRack: '0.90 x 0.50 x 0.09 m wall board, mounted 0.95-1.45 m (hooks at 1.27 m); wall-mounted (no floor contact in game)',
  golfPartyBanner: '1.80 x 0.45 x 0.01 m banner board, mounted 1.55-2.00 m (over a zombie\'s shoulder); wall-mounted',
};
