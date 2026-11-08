// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B): books, outfitter, music, hobby, design): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.
//
// One kind per Meshy kit piece of the five families (Codex initial concept -> Meshy T2.5 image-to-3D, Meshy maps kept; gen/assets.json
// ids bk-* / of-* / mu-* / hb-* / ds-*). Footprints and every support height come from the kit's measured table
// (assets/skywaysDestProps.generated.ts: w / h / d, topY, shelfY, tierY / tierR / tierRIn, seatY, hangY); while a row is still the lead's
// PLACEHOLDER (`planned: true`, no measured extras) the dresser uses the proportional estimates below (DEST_SUPPORT_EST), so the
// measured values flow through unchanged when lane KITS' table lands.
//
// Affordances (root CLAUDE.md "Props — core design rules", docs/prop-affordances.md):
//  - FIXTURES / heavy furniture are static with their reason (an oak bookcase, the tiered display table, the record-bin rack, the
//    piano, the half-stack amp, the diorama, the sofa, the live-edge table, the showroom bed: all over the ~30 kg no-castor line; the
//    display tent is pegged to weighted plates; the canoe hangs from the ceiling);
//  - LOOSE things are dynamic with plausible masses (the wingback, egg and camp chairs, the arc lamp, the drum kit, guitars on their
//    stands, the toy robot; the small merchandise — book stacks, record crates, backpacks, lanterns, boxed kits, the airship model —
//    is `onHost`: it goes loose on a static host's top or (lane MERCH) on a known open shelf inside it, or from the floor);
//  - nothing is storage: the kit is fixtures, furniture, exhibits and merchandise (the anchors' storage / loot holders are EXISTING
//    openable / holder kinds: counters, coolers, shelving, sideboards — gen/skyways/destinations/shopsA.ts). Things that only LOOK
//    openable (the tent's zipped door, a backpack's zips, the boxed kits, the piano lid) are explicit exceptions with their reason;
//  - no loose items are baked in (rule 4): the bookcase, the tiered table and the record bins are EMPTY models; the books, crates,
//    kits and lanterns are these separate loose kinds, placed on the hosts' measured supports by the dresser.

import type {DestKindSpec, DestOpen, DestPhys} from './kindTypes';
import type {DamageClass} from '../../../damage/materials';
import type {PropDef} from '../../props';
import {SKYWAYS_DEST_PROPS, type SkywaysDestPropKey} from '../../../assets/skywaysDestProps.generated';
import {BIN_BAYS, BIN_STYLES, binBlock} from '../stores/musicStock'; // lane MERCH: the record bins' measured trays (pure data)

export const SHOPS_A_KINDS = [
  // books (Paper Prairie Books)
  'skyDBookcase', 'skyDBookTable', 'skyDWingbackChair', 'skyDBookStack',
  // outfitter (Coulee & Canoe Outfitters)
  'skyDCanoe', 'skyDTent', 'skyDBackpack', 'skyDLantern', 'skyDCampChair',
  // music (Northern Groove Records)
  'skyDRecordBins', 'skyDRecordCrate', 'skyDGuitar', 'skyDPiano', 'skyDDrumKit', 'skyDAmpStack',
  // hobby (Grain Elevator Models)
  'skyDDiorama', 'skyDAirshipModel', 'skyDModelKits', 'skyDToyRobot',
  // design (Larch & Loom Home)
  'skyDSofa', 'skyDEggChair', 'skyDArcLamp', 'skyDDiningTable', 'skyDShowroomBed',
] as const;
export type ShopsAKind = (typeof SHOPS_A_KINDS)[number];
const KIND_SET: ReadonlySet<string> = new Set(SHOPS_A_KINDS);
export const isShopsAKind = (k: string): k is ShopsAKind => KIND_SET.has(k);

/** The kit model each kind renders with (assets/skywaysDestProps.generated.ts key). hb-vitrine was re-scoped by the lead (KITS
 *  DECISIONS: the airship display model, without its case): it is the airship model standing on a sideboard. */
export const SHOPS_A_MODEL: Readonly<Record<ShopsAKind, SkywaysDestPropKey>> = {
  skyDBookcase: 'skyways_d_bk_bookcase', skyDBookTable: 'skyways_d_bk_table', skyDWingbackChair: 'skyways_d_bk_armchair', skyDBookStack: 'skyways_d_bk_stack',
  skyDCanoe: 'skyways_d_of_canoe', skyDTent: 'skyways_d_of_tent', skyDBackpack: 'skyways_d_of_backpack', skyDLantern: 'skyways_d_of_lantern', skyDCampChair: 'skyways_d_of_campchair',
  skyDRecordBins: 'skyways_d_mu_bins', skyDRecordCrate: 'skyways_d_mu_crate', skyDGuitar: 'skyways_d_mu_guitar', skyDPiano: 'skyways_d_mu_piano', skyDDrumKit: 'skyways_d_mu_drums',
  skyDAmpStack: 'skyways_d_mu_amp',
  skyDDiorama: 'skyways_d_hb_diorama', skyDAirshipModel: 'skyways_d_hb_vitrine', skyDModelKits: 'skyways_d_hb_kits', skyDToyRobot: 'skyways_d_hb_robot',
  skyDSofa: 'skyways_d_ds_sofa', skyDEggChair: 'skyways_d_ds_eggchair', skyDArcLamp: 'skyways_d_ds_lamp', skyDDiningTable: 'skyways_d_ds_table', skyDShowroomBed: 'skyways_d_ds_bed',
};

/** A kit row as the dresser reads it (the measured extras are optional: absent on the lead's placeholder rows). */
export interface DestModelDims {
  readonly w: number; readonly h: number; readonly d: number; readonly planned?: boolean;
  readonly topY?: number; readonly backY?: number; readonly seatY?: number; readonly hangY?: number;
  readonly shelfY?: readonly number[]; readonly tierY?: readonly number[]; readonly tierR?: readonly number[]; readonly tierRIn?: readonly number[];
}
export const destDims = (k: ShopsAKind): DestModelDims => SKYWAYS_DEST_PROPS[SHOPS_A_MODEL[k]] as DestModelDims;

/**
 * Proportional support estimates used ONLY while a row is the lead's placeholder (no measured extras), as fractions of the row's own
 * h / w (the bookcase's six shelf tops; the tiered table's three tiers, their outer / inner ring radii). The measured row wins.
 */
export const DEST_SUPPORT_EST = {
  bookcaseShelf: [0.09, 0.23, 0.355, 0.495, 0.635, 0.78], tierY: [0.3, 0.667, 0.96], tierR: [0.5, 0.387, 0.293], tierRIn: [0.387, 0.293, 0.1],
} as const;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The bookcase's shelf tops (m above its base, bottom board first). */
export function bookcaseShelves(): number[] {
  const m = destDims('skyDBookcase');
  return (m.shelfY ?? DEST_SUPPORT_EST.bookcaseShelf.map(f => f * m.h)).map(r3);
}
/** The tiered display table's tiers (lowest first): top y, outer radius, inner edge of the visible ring (never place inside it). */
export function bookTableTiers(): {y: number; r: number; rIn: number}[] {
  const m = destDims('skyDBookTable');
  const ys = m.tierY ?? DEST_SUPPORT_EST.tierY.map(f => f * m.h);
  return ys.map((y, i) => ({y: r3(y), r: r3(m.tierR?.[i] ?? DEST_SUPPORT_EST.tierR[i] * m.w), rIn: r3(m.tierRIn?.[i] ?? DEST_SUPPORT_EST.tierRIn[i] * m.w)}));
}
/** The canoe's hanging point above its keel (its model top). */
export const canoeHangY = (): number => r3(destDims('skyDCanoe').hangY ?? destDims('skyDCanoe').h);

/** Rigid-body row or static reason per kind (the live body comes from def.physics, built from this row). */
const PHYS: Readonly<Record<ShopsAKind, DestPhys>> = {
  skyDBookcase: {dynamic: false, why: 'too heavy', how: 'solid oak six-shelf bookcase (~85 kg, 2.4 m tall) standing against the shop wall: a bump or a bullet does not shift it; its book stacks are separate loose props on its measured shelves'},
  skyDBookTable: {dynamic: false, why: 'too heavy', how: 'three-tier round oak display table on a pedestal plinth (~45 kg, no castors): a bump cannot slide it; the book stacks / lanterns on its tiers are separate loose props'},
  skyDWingbackChair: {dynamic: true, mass: 24, mat: 'pad', shape: 'box', how: 'leather wingback armchair on wooden feet (~24 kg): shoved across the floor when walked into, slides / tips under buckshot'},
  skyDBookStack: {dynamic: true, mass: 5, mat: 'pad', shape: 'box', onHost: true, how: 'stack of six hardcover books (~5 kg) on a shelf / tier / sideboard: a shot knocks it over or off its shelf / top (on-host decor on a known open support: physics/merchOnHost.ts)'},
  skyDCanoe: {dynamic: false, why: 'mounted', how: 'wood-and-canvas canoe (~30 kg) hung from the ceiling on two steel cables: out of reach overhead (a clear underside >= 2.3 m), bullets mark it only'},
  skyDTent: {dynamic: false, why: 'anchored', how: 'pitched two-person display dome tent: its poles and guy lines are clipped to weighted display plates on the shop floor, so a bump or a bullet does not drag it'},
  skyDBackpack: {dynamic: true, mass: 6, mat: 'pad', shape: 'box', onHost: true, how: 'stuffed display hiking pack (~6 kg) standing on the floor: buckshot knocks it over, a bump shoves it'},
  skyDLantern: {dynamic: true, mass: 1.4, mat: 'pad', shape: 'cylinder', onHost: true, how: 'enamel camping lantern with a glass globe (~1.4 kg) on a display tier / shelf or the floor: knocked off / over when shot or bumped'},
  skyDCampChair: {dynamic: true, mass: 3.5, mat: 'pad', shape: 'box', how: 'folding camp chair on a steel X-frame (~3.5 kg): slides / tips when bumped or shot'},
  skyDRecordBins: {dynamic: false, why: 'too heavy', how: 'black-painted timber record-browser rack with two sloped bin rows (~55 kg, no castors): a bump cannot slide it'},
  skyDRecordCrate: {dynamic: true, mass: 11, mat: 'pad', shape: 'box', onHost: true, how: 'wooden crate packed with ~30 LP sleeves (~11 kg) on the floor / a counter: shoved when walked into, a shot slides / tips it'},
  skyDGuitar: {dynamic: true, mass: 5, mat: 'pad', shape: 'box', how: 'electric guitar on a folding floor stand (~5 kg together): knocked over by a shot, shoved when bumped'},
  skyDPiano: {dynamic: false, why: 'too heavy', how: 'upright piano (~220 kg of walnut and cast iron): it does not move under a bump or a bullet'},
  skyDDrumKit: {dynamic: true, mass: 28, mat: 'pad', shape: 'box', how: 'five-piece drum kit on its chrome stands (~28 kg, one display set on a rug): shoved across the floor when walked into, slides under buckshot'},
  skyDAmpStack: {dynamic: false, why: 'too heavy', how: 'guitar half stack: amplifier head on a speaker cabinet (~45 kg, no castors): a bump cannot slide it'},
  skyDDiorama: {dynamic: false, why: 'too heavy', how: 'model-railway diorama built on a sturdy 3 m wooden table (~120 kg): it does not move'},
  skyDAirshipModel: {dynamic: true, mass: 2.5, mat: 'pad', shape: 'box', onHost: true, how: 'display model airship on its little brass stand (~2.5 kg) on a sideboard: a shot knocks it off the top (on-host decor)'},
  skyDModelKits: {dynamic: true, mass: 2, mat: 'pad', shape: 'box', onHost: true, how: 'stack of five boxed plastic model kits (~2 kg of cardboard) on a shelf tier or a top: a shot knocks it over or off its shelf (on-host decor on a known open support: physics/merchOnHost.ts)'},
  skyDToyRobot: {dynamic: true, mass: 12, mat: 'pad', shape: 'box', how: 'metre-tall tin-toy robot on its round display base (~12 kg): buckshot tips it, a bump shoves it'},
  skyDSofa: {dynamic: false, why: 'too heavy', how: 'mid-century three-seat sofa (~55 kg, no castors): a bump cannot slide it'},
  skyDEggChair: {dynamic: true, mass: 25, mat: 'pad', shape: 'box', how: 'egg lounge chair on a swivel star base (~25 kg): shoved across the showroom floor when walked into, tips under buckshot'},
  skyDArcLamp: {dynamic: true, mass: 18, mat: 'pad', shape: 'box', how: 'arc floor lamp: a marble base (~15 kg) and a steel arm with its dome shade: buckshot topples it, a bump shoves it'},
  skyDDiningTable: {dynamic: false, why: 'too heavy', how: 'solid oak live-edge dining table on black steel trestles (~75 kg): a bump cannot slide it'},
  skyDShowroomBed: {dynamic: false, why: 'too heavy', how: 'queen showroom bed: upholstered headboard, wooden frame and mattress (~70 kg): it does not move'},
};

const DAMAGE: Readonly<Record<ShopsAKind, DamageClass>> = {
  skyDBookcase: 'wood', skyDBookTable: 'wood', skyDWingbackChair: 'fabric', skyDBookStack: 'cardboard',
  skyDCanoe: 'wood', skyDTent: 'fabric', skyDBackpack: 'fabric', skyDLantern: 'sheetMetal', skyDCampChair: 'fabric',
  skyDRecordBins: 'wood', skyDRecordCrate: 'wood', skyDGuitar: 'wood', skyDPiano: 'wood', skyDDrumKit: 'sheetMetal', skyDAmpStack: 'wood',
  skyDDiorama: 'wood', skyDAirshipModel: 'plastic', skyDModelKits: 'cardboard', skyDToyRobot: 'sheetMetal',
  skyDSofa: 'fabric', skyDEggChair: 'fabric', skyDArcLamp: 'steel', skyDDiningTable: 'wood', skyDShowroomBed: 'fabric',
};

const OPEN: Readonly<Record<ShopsAKind, DestOpen>> = {
  skyDBookcase: {cls: 'none', role: 'surface', how: 'open six-shelf bookcase: no doors or drawers (its books are separate loose stacks on the shelves)'},
  skyDBookTable: {cls: 'none', role: 'surface', how: 'open three-tier display table: no doors, lids or drawers'},
  skyDWingbackChair: {cls: 'none', role: 'decor', how: 'solid upholstered armchair: nothing to open'},
  skyDBookStack: {cls: 'none', role: 'decor', how: 'a stack of closed hardcover books: nothing to open'},
  skyDCanoe: {cls: 'none', role: 'decor', how: 'open canoe hull hung overhead: no lid or compartment'},
  skyDTent: {cls: 'exception', role: 'decor', how: 'pitched display tent: its zipped door stays shut — an empty showroom tent (merchandise display, not storage; nothing inside)'},
  skyDBackpack: {cls: 'exception', role: 'decor', how: 'display backpack stuffed with tissue paper: its zips are shop-tagged shut — merchandise on display, not a container (no contents)'},
  skyDLantern: {cls: 'none', role: 'equipment', how: 'camping lantern: a sealed fuel base and a glass globe — no door or lid'},
  skyDCampChair: {cls: 'none', role: 'decor', how: 'folding camp chair: no storage (its cup holder is open)'},
  skyDRecordBins: {cls: 'none', role: 'surface', how: 'open sloped record-bin rack: no doors, lids or drawers'},
  skyDRecordCrate: {cls: 'none', role: 'decor', how: 'open-topped wooden crate packed with record sleeves: no lid'},
  skyDGuitar: {cls: 'none', role: 'equipment', how: 'guitar on its floor stand: nothing to open'},
  skyDPiano: {cls: 'exception', role: 'equipment', how: 'upright piano: its hinged top lid and keyboard fall cover the strings and keys — an instrument, not storage; they stay as they are'},
  skyDDrumKit: {cls: 'none', role: 'equipment', how: 'drum kit on stands: no door, lid or drawer'},
  skyDAmpStack: {cls: 'none', role: 'equipment', how: 'amplifier head on a closed speaker cabinet: sealed electronics, no door or drawer'},
  skyDDiorama: {cls: 'none', role: 'decor', how: 'model-railway diorama on its table: no drawers modelled, a fixed exhibit'},
  skyDAirshipModel: {cls: 'none', role: 'decor', how: 'display model airship on its stand: nothing to open'},
  skyDModelKits: {cls: 'exception', role: 'decor', how: 'boxed plastic model kits: sealed, shrink-wrapped boxes on display — merchandise, not storage (nothing to take out)'},
  skyDToyRobot: {cls: 'none', role: 'decor', how: 'tin-toy robot on its display base: a solid display piece, nothing to open'},
  skyDSofa: {cls: 'none', role: 'decor', how: 'upholstered sofa: no storage'},
  skyDEggChair: {cls: 'none', role: 'decor', how: 'egg lounge chair: no storage'},
  skyDArcLamp: {cls: 'none', role: 'equipment', how: 'arc floor lamp: nothing to open'},
  skyDDiningTable: {cls: 'none', role: 'surface', how: 'live-edge dining table on trestles: no drawers'},
  skyDShowroomBed: {cls: 'none', role: 'decor', how: 'showroom bed: a platform frame without drawers'},
};

/** Kinds whose collision box stops at their top support (a static host's top: its loose items can go loose there). */
const BOX_TO_TOP: Partial<Record<ShopsAKind, () => number>> = {
  // the tiered table: its box tops at the top tier (the hollow column's lip above it is drawn by the model only)
  skyDBookTable: () => bookTableTiers().at(-1)!.y,
};
const BLOCKS_SIGHT: ReadonlySet<ShopsAKind> = new Set(['skyDBookcase']);

type Shelves = NonNullable<PropDef['shelves']>;
/**
 * Task studio-skywalk-variety-20261107-231448-01 (lane MERCH): the declared OPEN supports (gen/props.ts PropDef.shelves, host frame) of the
 * kit's three non-holder hosts, from the same measured data their dressers place the stock by — so a book stack / lantern / bin block
 * shot loose lands on its real shelf (physics/merchOnHost.ts, physics/world.ts):
 *  - the bookcase: its six measured shelf tops and its top, between the side panels, back panel to front edge;
 *  - the tiered table: each round tier as five nested rectangles (15-75 deg: the union is the disc within 1 %);
 *  - the record bins (gen/skyways/stores/musicStock.ts): the front row's tray under its blocks (a solid base the whole depth of the
 *    rack) and the back row's sloped tray as one board under its lowest block, stopping short of the front row's sleeves.
 */
function shelvesOf(k: ShopsAKind): Shelves | undefined {
  const m = destDims(k);
  if (k === 'skyDBookcase') {
    const x = r3(m.w / 2 - 0.06), z0 = r3(-m.d / 2 + 0.03), z1 = r3(m.d / 2 - 0.02), ys = [...bookcaseShelves(), r3(m.h)];
    return ys.map((y, i) => ({y, x0: -x, x1: x, z0, z1, clear: r3((ys[i + 1] ?? y + 0.5) - y - 0.03)}));
  }
  if (k === 'skyDBookTable') {
    const tiers = bookTableTiers(), out: Shelves[number][] = [];
    tiers.forEach((t, i) => {
      const r = t.r - 0.01, clear = r3((tiers[i + 1]?.y ?? t.y + 0.5) - t.y - 0.03);
      for (const deg of [15, 30, 45, 60, 75]) {
        const a = deg * Math.PI / 180, hx = r3(r * Math.cos(a)), hz = r3(r * Math.sin(a));
        out.push({y: t.y, x0: -hx, x1: hx, z0: -hz, z1: hz, clear});
      }
    });
    return out;
  }
  if (k === 'skyDRecordBins') {
    const blocks = Array.from({length: 2 * BIN_STYLES}, (_, v) => binBlock(v));
    const front = blocks.filter(b => b.row === 0), back = blocks.filter(b => b.row === 1);
    const x0 = BIN_BAYS[0][0], x1 = BIN_BAYS[BIN_BAYS.length - 1][1], zb = r3(-m.d / 2 + 0.01);
    const yf = r3(Math.min(...front.map(b => b.y0)) - 0.002), yb = r3(Math.min(...back.map(b => b.y0)) - 0.002);
    return [
      {y: yf, x0, x1, z0: zb, z1: r3(Math.max(...front.map(b => b.z1)) + 0.12), clear: r3(yb - yf)},
      // (its board stops 2.5 cm short of the front row's sleeves: physics/holderShapes.ts grows each board 1.5 cm)
      {y: yb, x0, x1, z0: zb, z1: r3(Math.min(...front.map(b => b.z0)) - 0.025), clear: r3(m.h - yb)},
    ];
  }
  return undefined;
}

function defOf(k: ShopsAKind): PropDef {
  const m = destDims(k), ph = PHYS[k], shelves = shelvesOf(k);
  return {w: r3(m.w), d: r3(m.d), h: r3(BOX_TO_TOP[k]?.() ?? m.h), blocksSight: BLOCKS_SIGHT.has(k),
    // dynamic: the calibrated contact-wake rules (`contact`) + `onHost` small merchandise (goes loose on a static host's top)
    ...(ph.dynamic ? {physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat, contact: true, ...(ph.onHost ? {onHost: true} : {})}} : {}),
    ...(shelves ? {shelves} : {})};
}

export const SHOPS_A_SPECS: Readonly<Record<ShopsAKind, DestKindSpec>> = Object.fromEntries(SHOPS_A_KINDS.map(k =>
  [k, {def: defOf(k), phys: PHYS[k], damage: DAMAGE[k], open: OPEN[k], model: SHOPS_A_MODEL[k]} satisfies DestKindSpec])) as Record<ShopsAKind, DestKindSpec>;
