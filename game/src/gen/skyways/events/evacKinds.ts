// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the Evac event's NEW prop kinds (hand-built simple meshes:
// code-drawn parts + canvas faces; existing kinds are reused wherever they fit). Every kind is classified honestly for the prop rules
// (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md): physics (dynamic / static reason), openables, damage, and a
// scale record. Merged by gen/skyways/events/kinds.ts.
//
// The evacuation centre REUSES the existing furniture wherever one fits (gen/skyways/events/evacDress.ts header lists them: folding /
// stack chairs, the convention's cloth-draped tables, crowd barriers and folding barricades, bedrolls, carton stacks, crates, storage
// totes, flap boxes, water coolers, notice boards, stretchers, IV poles, crash carts, medical cabinets, wheelchairs, vitals monitors,
// trash bags, suitcases, strollers, bean bags). Four things no existing kind is:
//  - evacCot: an aluminium-tube CAMP COT with an olive canvas bed (1.9 x 0.7 m, bed 0.40 m): the dormitory's rows. Light (~8 kg) and
//    loose: a dynamic prop (rule 2) — shoved by a walker, knocked by a shot. Variants: bare canvas; made up with a pillow and a folded
//    blanket; slept-in (blanket spread). The pillow / blanket are the cot's BEDDING (permanent soft parts, like the bedroll's sleeping
//    bag), never loose takeable clutter (rule 4).
//  - evacScreen: a three-panel hospital PRIVACY SCREEN (sage fabric on a steel tube frame, castor feet; 1.6 x 1.75 m): between cots in
//    the medical bay / triage and round a few dormitory family pods. Light (~6 kg): dynamic.
//  - evacNote: ONE SHEET of paper (a printed notice, a lined pad page or a torn scrap) lying flat on a table / bedroll / the floor, or
//    pinned to a notice board: its face shows the note's own text (world/skywaysEvacDraw.ts painter 'evac-note': dynamic per-placement
//    text, root CLAUDE.md exemption) and world/skywaysNotes.ts reads it up close. Static 'flat' (a 3 mm sheet: nothing to shove or tip).
//  - evacWarnBoard: a sheet of PLYWOOD screwed to the wall beside the barricaded quarantine, a warning brushed onto its whitewash coat
//    (painter 'evac-warn': dynamic text). Mounted, static.
// Rule 4: nothing loose is baked into any of them (the pillow / blanket are bedding; the note IS the loose thing).

import type {EventFace, EventKindSpec} from './eventKindTypes';
import type {DestDrawnPart} from '../destinations/kindTypes';

export const EVAC_KINDS = ['evacCot', 'evacScreen', 'evacNote', 'evacWarnBoard'] as const;
export type EvacKind = (typeof EVAC_KINDS)[number];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The cot: footprint (long axis = local Z, head at -Z, foot at +Z = its front), its canvas bed height, its variants. */
export const EVAC_COT = {w: 0.7, d: 1.9, h: 0.5, bed: 0.4, variants: 3} as const;
/** The privacy screen. */
export const EVAC_SCREEN = {w: 1.6, d: 0.45, h: 1.75} as const;
/** One sheet of paper (US letter-ish), its thickness; pinned notes use variant + PINNED (a vertical sheet on a board). */
export const EVAC_NOTE = {w: 0.216, d: 0.279, h: 0.003, pinned: 32} as const;
/** The plywood warning board (mounted with its back on the wall). */
export const EVAC_WARN = {w: 1.2, d: 0.03, h: 0.8, y: 1.15} as const;
/** The warning boards' painted texts (variant). */
export const EVAC_WARN_TEXTS: readonly (readonly string[])[] = [['QUARANTINE', 'DO NOT ENTER'], ['SICK INSIDE', 'KEEP OUT'], ['DO NOT OPEN', 'THEY BITE']];

/** A note prop's variant for a text index (gen/skyways/events/evacNotes.ts) lying flat / pinned. */
export const evacNoteVariant = (index: number, pinned: boolean): number => index + (pinned ? EVAC_NOTE.pinned : 0);
/** The text index and pin of a note variant. */
export const evacNoteOf = (variant: number): {index: number; pinned: boolean} => ({index: variant % EVAC_NOTE.pinned, pinned: variant >= EVAC_NOTE.pinned});

const P = (m: DestDrawnPart['m'], s: readonly [number, number, number], p: readonly [number, number, number], rx?: number): DestDrawnPart =>
  ({m, s: [r3(s[0]), r3(s[1]), r3(s[2])], p: [r3(p[0]), r3(p[1]), r3(p[2])], ...(rx ? {rx} : {})});

/** The cot's parts: tube side rails and end bars, three U-leg frames on floor bars, the canvas bed; its bedding per variant. */
export function evacCotParts(variant: number): DestDrawnPart[] {
  const {w, d, bed} = EVAC_COT, t = 0.026, hw = w / 2 - t / 2, hd = d / 2 - t / 2;
  const out: DestDrawnPart[] = [
    P('vinyl', [w - 0.07, 0.012, d - 0.05], [0, bed - 0.006, 0]),
    P('steelBright', [t, t, d], [-hw, bed - t / 2, 0]), P('steelBright', [t, t, d], [hw, bed - t / 2, 0]),
    P('steelBright', [w, t, t], [0, bed - t / 2 - 0.004, -hd]), P('steelBright', [w, t, t], [0, bed - t / 2 - 0.004, hd]),
  ];
  for (const z of [-0.8, 0, 0.8]) {
    out.push(P('steelBright', [0.022, bed - t, 0.022], [-hw + 0.02, (bed - t) / 2, z]), P('steelBright', [0.022, bed - t, 0.022], [hw - 0.02, (bed - t) / 2, z]));
    out.push(P('steelDark', [w - 0.03, 0.018, 0.03], [0, 0.009, z]));
  }
  const top = bed;
  if (variant % EVAC_COT.variants === 1) {
    // made up: a pillow at the head, a blanket folded at the foot
    out.push(P('paintWhite', [0.5, 0.08, 0.3], [0, top + 0.04, -d / 2 + 0.22]), P('paintBlue', [0.58, 0.06, 0.46], [0, top + 0.03, d / 2 - 0.33]));
  } else if (variant % EVAC_COT.variants === 2) {
    // slept in: the blanket spread over most of the bed and turned back, the pillow pushed aside
    out.push(P('paintBlue', [0.64, 0.03, 1.3], [0, top + 0.015, 0.28]), P('paintBlue', [0.64, 0.025, 0.2], [0, top + 0.042, -0.3]),
      P('paintWhite', [0.48, 0.07, 0.3], [0.04, top + 0.035, -d / 2 + 0.24]));
  }
  return out;
}

/** The screen's parts: four tube posts on castor feet, top / bottom rails, three sage fabric panels. */
export function evacScreenParts(): DestDrawnPart[] {
  const {w, d, h} = EVAC_SCREEN, pw = (w - 0.1) / 3, out: DestDrawnPart[] = [];
  for (const x of [-w / 2 + 0.02, -pw / 2, pw / 2, w / 2 - 0.02]) {
    out.push(P('steelBright', [0.025, h - 0.06, 0.025], [x, 0.06 + (h - 0.06) / 2, 0]));
    out.push(P('steelDark', [0.04, 0.03, d], [x, 0.045, 0]), P('black', [0.04, 0.03, 0.05], [x, 0.015, -d / 2 + 0.03]), P('black', [0.04, 0.03, 0.05], [x, 0.015, d / 2 - 0.03]));
  }
  for (const y of [0.32, h - 0.02]) out.push(P('steelBright', [w, 0.022, 0.022], [0, y, 0]));
  for (const x of [-pw - 0.01, 0, pw + 0.01]) out.push(P('partition', [pw - 0.03, h - 0.42, 0.008], [x, 0.33 + (h - 0.42) / 2, 0]));
  return out;
}

export function evacNoteParts(variant: number): DestDrawnPart[] {
  const {w, d} = EVAC_NOTE;
  if (!evacNoteOf(variant).pinned) return [P('paintWhite', [w, 0.002, d], [0, 0.001, 0])];
  return [P('paintWhite', [w, d, 0.002], [0, d / 2, 0.001]), P('paintRed', [0.012, 0.012, 0.01], [0, d - 0.025, 0.006])];
}
export function evacNoteFaces(variant: number): EventFace[] {
  const {w, d} = EVAC_NOTE;
  return evacNoteOf(variant).pinned ? [{paint: 'evac-note', w, h: d, p: [0, d / 2, 0.0023]}] : [{paint: 'evac-note', w, h: d, p: [0, 0.0023, 0], rx: -Math.PI / 2}];
}

export function evacWarnParts(): DestDrawnPart[] {
  const {w, d, h} = EVAC_WARN, out: DestDrawnPart[] = [P('wood', [w, h, 0.018], [0, h / 2, -d / 2 + 0.009])];
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const y of [0.05, h - 0.05]) out.push(P('steelDark', [0.016, 0.016, 0.006], [x, y, -d / 2 + 0.021]));
  return out;
}

export const EVAC_SPECS: Readonly<Record<EvacKind, EventKindSpec>> = {
  evacCot: {
    def: {w: EVAC_COT.w, d: EVAC_COT.d, h: EVAC_COT.h, blocksSight: false, physics: {mass: 8, dynamic: true, shape: 'box', mat: 'pad', contact: true}},
    phys: {dynamic: true, mass: 8, mat: 'pad', shape: 'box', how: 'folding camp cot (aluminium tube frame, canvas bed, ~8 kg) standing on its rubber-capped leg bars: walked into it slides, shot it skids / tips (its pillow and blanket are its bedding, part of the body)'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'camp cot: a canvas bed on a tube frame, nothing to open'},
    parts: evacCotParts,
  },
  evacScreen: {
    def: {w: EVAC_SCREEN.w, d: EVAC_SCREEN.d, h: EVAC_SCREEN.h, blocksSight: false, physics: {mass: 6, dynamic: true, shape: 'box', mat: 'castor', contact: true}},
    phys: {dynamic: true, mass: 6, mat: 'castor', shape: 'box', how: 'three-panel hospital privacy screen (fabric on a steel tube frame, castor feet, ~6 kg): walked into it rolls aside, shot it rocks / tips over'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'privacy screen: fabric panels on a frame, nothing to open'},
    parts: () => evacScreenParts(),
  },
  evacNote: {
    def: {w: EVAC_NOTE.w, d: EVAC_NOTE.d, h: EVAC_NOTE.h, blocksSight: false},
    phys: {dynamic: false, why: 'flat', how: 'one sheet of paper (~5 g, 3 mm) lying flat on a table top, a bedroll or the floor, or pinned to a notice board: no rigid body worth shoving or tipping; it is read (E), never taken'},
    damage: 'cardboard',
    open: {cls: 'none', role: 'decor', how: 'a single sheet of paper: read up close (world/skywaysNotes.ts), nothing to open'},
    parts: evacNoteParts,
    faces: evacNoteFaces,
  },
  evacWarnBoard: {
    def: {w: EVAC_WARN.w, d: EVAC_WARN.d, h: EVAC_WARN.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'plywood sheet (~6 kg) screwed to the wall beside the quarantine door with a hand-painted warning: out of the way of feet and bodies; bullets splinter it only'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'painted plywood warning: nothing to open'},
    parts: () => evacWarnParts(),
    faces: () => [{paint: 'evac-warn', w: EVAC_WARN.w - 0.04, h: EVAC_WARN.h - 0.04, p: [0, EVAC_WARN.h / 2, -EVAC_WARN.d / 2 + 0.0185]}],
  },
};
/** Scale-check records (tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift, viewed): W x H x D, contact. */
export const EVAC_SCALE: Readonly<Partial<Record<EvacKind, string>>> = {
  evacCot: '0.70 x 0.40 (bare; 0.47-0.48 with pillow / blanket) x 1.90 m; grounded, 6 contacts (three floor bars, rubber caps), bed at 0.40 m: just under the 0.45 m seat line, a camp cot',
  evacScreen: '1.60 x 1.75 x 0.45 m; grounded, 8 contacts (feet / castors); panels to 1.74 m: head height of the reference zombie',
  evacNote: 'flat 0.216 x 0.002 x 0.279 m (a letter-size sheet), lies on its support (4 contacts); pinned 0.216 x 0.279 x 0.011 m on the board face, no floor contact (mounted)',
  evacWarnBoard: '1.20 x 0.80 x 0.024 m plywood sheet, wall-mounted 1.15-1.95 m (eye level of the reference zombie), no floor contact (mounted)',
};
