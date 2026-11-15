// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-COURSE): the mini-golf event's NEW prop kinds (hand-built
// simple meshes: code-drawn parts + canvas faces + the turf drawn by world/skywaysGolfDraw.ts; existing kinds are reused wherever they
// fit). Every kind is classified honestly for the prop rules (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md):
// physics (dynamic / static reason), openables, damage, and a scale record. Merged by gen/skyways/events/kinds.ts.
// The collision of the course pieces: gen/skyways/events/golfContract.ts golfColliderBoxes (raised slabs; the cup = a gap).

import type {EventKindSpec} from './eventKindTypes';
import {GOLF_CUP_PIECE, GOLF_GREEN_H} from './golfContract';

export const GOLF_KINDS = ['golfGreen', 'golfCup'] as const;
export type GolfKind = (typeof GOLF_KINDS)[number];
export const GOLF_SPECS: Readonly<Record<GolfKind, EventKindSpec>> = {
  // (lead skeleton; lane GOLF-COURSE refines) a piece of the raised turf deck: its size is the placement's footprint (hx / hz)
  golfGreen: {
    def: {w: 1.0, d: 1.0, h: GOLF_GREEN_H, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'a piece of the course\'s raised turf deck (carpet on a timber frame screwed to the floor): walked on and putted across, never shoved'},
    damage: 'fabric',
    open: {cls: 'none', role: 'surface', how: 'turf deck: nothing to open'},
    parts: () => [{m: 'accent', s: [1.0, GOLF_GREEN_H, 1.0], p: [0, GOLF_GREEN_H / 2, 0]}],
  },
  golfCup: {
    def: {w: GOLF_CUP_PIECE, d: GOLF_CUP_PIECE, h: GOLF_GREEN_H, blocksSight: false},
    phys: {dynamic: false, why: 'built-in', how: 'the turf deck square round a hole\'s cup (a plastic cup liner set into the deck): part of the deck'},
    damage: 'fabric',
    open: {cls: 'none', role: 'surface', how: 'turf deck with a sunk cup: nothing to open (a ball drops into the cup)'},
    parts: () => [{m: 'accent', s: [GOLF_CUP_PIECE, GOLF_GREEN_H, GOLF_CUP_PIECE], p: [0, GOLF_GREEN_H / 2, 0]}],
  },
};
/** Scale-check records (tools/asset-pipeline/props/scale-check.mjs --kind <kind> beside zombie lastshift, viewed): W x H x D, contact. */
export const GOLF_SCALE: Readonly<Partial<Record<GolfKind, string>>> = {};
