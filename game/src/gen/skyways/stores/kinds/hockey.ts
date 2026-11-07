// Task studio-alpha-skyways-shops-20261107-054512-01: the HOCKEY store's OWN new prop kinds (lane STORE-HOCKEY), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Blue Line Sports' stock and two fixtures nothing in the catalogue reads as (no hockey stick, skate, helmet, glove, shin guard, jersey,
// stick rack or dasher board exists): all CODE-DRAWN geometry (stores/hockeyParts.ts; no model file, no texture, no generation).
//
// Affordances (root CLAUDE.md "Props — core design rules"; docs/skyways-stores/hockey.md):
//  - rule 1: none of these is storage (a rack, boards, loose gear); the store's storage is EXISTING openables (staff lockers as the team
//    lockers, the cashwrap counter, the tool chest, the first-aid kit, cartons / totes in the back room);
//  - rule 2: the loose gear on the shelves (skates, helmets, gloves, shin pads) is dynamic on-host decor (it goes loose off its static
//    shelf when shot, out of a walker's legs' reach like an office monitor); the sticks stand captive in their rack's slotted rail and the
//    jerseys hang on the jersey wall's rail (host decor of static hosts: nothing floats); the rack and the boards are fixtures;
//  - rule 4: nothing baked — the rack is empty (its sticks are their own kind), the jersey wall's rail carries separate jerseys;
//  - rule 5: real sizes, checked beside the zombie (scale-check.mjs --kind <kind>; records in docs/skyways-stores/hockey.md).

import type {DestKindSpec} from '../../destinations/kindTypes';
import {HK_GLOVES, HK_HELMET, HK_JERSEY, HK_RINK_BOARD, HK_SHIN_PADS, HK_SKATES, HK_STICKS, HK_STICK_RACK, glovesParts, helmetParts, jerseyParts,
  rinkBoardParts, shinPadsParts, skatesParts, stickRackParts, sticksParts} from '../hockeyParts';

export const STORE_HOCKEY_KINDS = ['hkStickRack', 'hkSticks', 'hkJersey', 'hkSkates', 'hkHelmet', 'hkGloves', 'hkShinPads', 'hkRinkBoard'] as const;
export type StoreHockeyKind = (typeof STORE_HOCKEY_KINDS)[number];

type Phys = DestKindSpec['phys'];
const D = (mass: number, how: string): Phys => ({dynamic: true, mass, mat: 'pad', shape: 'box', onHost: true, how});
const S = (why: 'fixture' | 'host decor' | 'anchored', how: string): Phys => ({dynamic: false, why, how});

function spec(box: {w: number; d: number; h: number}, s: Omit<DestKindSpec, 'def'> & {blocksSight?: boolean}): DestKindSpec {
  const ph = s.phys;
  return {
    def: {w: box.w, d: box.d, h: box.h, blocksSight: s.blocksSight ?? false,
      ...(ph.dynamic ? {physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat, contact: true, ...(ph.onHost ? {onHost: true} : {})}} : {})},
    phys: ph, damage: s.damage, open: s.open, ...(s.parts ? {parts: s.parts} : {}),
  };
}

export const STORE_HOCKEY_SPECS: Readonly<Record<StoreHockeyKind, DestKindSpec>> = {
  hkStickRack: spec(HK_STICK_RACK, {
    phys: S('fixture', 'floor stick rack (~25 kg welded steel: base trough, end posts, slotted top rail) holding its row of sticks: kept static so the sticks standing captive in it never float (a prop something rests on never moves)'),
    damage: 'steel', open: {cls: 'none', role: 'surface', how: 'open stick rack: no door, lid or drawer (the sticks stand in its slots)'},
    parts: () => stickRackParts(),
  }),
  hkSticks: spec(HK_STICKS, {
    phys: S('host decor', 'a row of twelve hockey sticks standing blade-down in the rack\'s trough, their shafts captive in the slotted top rail: they ride the static rack'),
    damage: 'wood', open: {cls: 'none', role: 'decor', how: 'sticks on display: nothing to open'},
    parts: () => sticksParts(),
  }),
  hkJersey: spec(HK_JERSEY, {
    phys: S('host decor', 'a team jersey on its hanger, hooked face-out on the jersey wall\'s rail (the wall unit is a static holder): it rides the rail like the Mall\'s hung garments'),
    damage: 'fabric', open: {cls: 'none', role: 'decor', how: 'hung jersey: nothing to open'},
    parts: v => jerseyParts(v),
  }),
  hkSkates: spec(HK_SKATES, {
    phys: D(1.8, 'a pair of skates (~1.8 kg) standing on a shelf of the boot wall: a shot knocks them over or off the shelf (on-host decor: out of a walker\'s legs\' reach)'),
    damage: 'rubber', open: {cls: 'none', role: 'decor', how: 'skates on display: nothing to open'},
    parts: v => skatesParts(v),
  }),
  hkHelmet: spec(HK_HELMET, {
    phys: D(0.7, 'a caged hockey helmet (~0.7 kg) on a shelf: a shot knocks it over or off (on-host decor)'),
    damage: 'plastic', open: {cls: 'none', role: 'decor', how: 'helmet on display: nothing to open'},
    parts: v => helmetParts(v),
  }),
  hkGloves: spec(HK_GLOVES, {
    phys: D(0.9, 'a pair of padded hockey gloves (~0.9 kg) on a shelf / table top: a shot knocks them off (on-host decor)'),
    damage: 'fabric', open: {cls: 'none', role: 'decor', how: 'gloves on display: nothing to open'},
    parts: v => glovesParts(v),
  }),
  hkShinPads: spec(HK_SHIN_PADS, {
    phys: D(1.0, 'a pair of shin guards (~1 kg) lying on a shelf / table top: a shot knocks them off (on-host decor)'),
    damage: 'plastic', open: {cls: 'none', role: 'decor', how: 'shin guards on display: nothing to open'},
    parts: v => shinPadsParts(v),
  }),
  hkRinkBoard: spec(HK_RINK_BOARD, {
    phys: S('anchored', 'a dasher-board section of the shooting lane (~70 kg: HDPE boards on a steel frame, shielding glass) bolted to the floor and its neighbours: a bump or a bullet does not shove it'),
    damage: 'plastic', open: {cls: 'none', role: 'equipment', how: 'rink boards and glass: nothing to open'},
    parts: () => rinkBoardParts(),
  }),
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * Blue Line Sports: the slatwall bays (boot wall, helmet / pad wall), the jersey wall's clothing bays, the cashwrap back counter, the
 * try-on ottoman, the locker-room bench.
 */
export const STORE_HOCKEY_MALL_MODELS: readonly string[] = [
  'mall-retail-wall-bay.glb', 'mall-clothing-wall-unit.glb', 'mall-mall-cashwrap-counter.glb', 'mall-try-on-ottoman.glb', 'mall-mall-bench.glb',
];
