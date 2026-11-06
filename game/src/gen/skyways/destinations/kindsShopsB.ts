// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-B (C): garden, arcade, cinema, science, hockey): this lane's Skyways DESTINATION prop kinds (kindTypes.ts
// DestKindSpec each). Merged by registry.ts into the shared tables — never edit the shared tables for these kinds.
//
// Footprints and support heights come from the kit model table (assets/skywaysDestProps.generated.ts: the lead's planned sizes until lane
// KITS writes the measured ones under the same keys) — never literals, so the measured values flow through. One code-drawn kind: the cinema
// SCREEN (a flat projection screen in a black masking frame, mounted on the auditorium's screen wall; no model).
//
// Affordances (root CLAUDE.md "Props — core design rules"; docs/prop-affordances.md):
//  - rule 1: none of these reads as openable storage — the coin-op machines, the popcorn cart and the ticket booth are sealed equipment
//    (explicit exceptions below, honest reasons); the shops' storage / loot lives in the EXISTING holders the dresser places beside them
//    (counters, shelving, coolers, the vending machine, the display tables);
//  - rule 2: the loose / light things are dynamic with plausible masses (palms, geranium pots, the wheelbarrow, the popcorn cart, the
//    telescopes, the globes, the rocket model, the hockey nets, the goalie mannequin); the pots are on-host decor of the plant benches
//    (they go loose only on a static host: the benches stay put so a pot never floats);
//  - rule 3: the heavy coin-op machines (pinball, air hockey, claw crane: 110-180 kg, over the 50 kg contact-physics ceiling) and the
//    ticket booth are 'too heavy'; the cinema seat rows are bolted to their floor rail; the planet mobile and the screen are mounted;
//  - rule 4: the bench model is EMPTY (the pots are separate props on its measured top); the claw crane's plush pile and the popcorn
//    cart's kettle are sealed behind their machines' glass (part of the equipment, like a vending machine's display).

import type {DestKindSpec} from './kindTypes';
import {SKYWAYS_DEST_PROPS, type SkywaysDestProp, type SkywaysDestPropKey} from '../../../assets/skywaysDestProps.generated';

export const SHOPS_B_KINDS = [
  // Glasshouse Garden Co.
  'skyDPlantBench', 'skyDPottedPalm', 'skyDGeraniumPot', 'skyDWheelbarrow',
  // Starfall Arcade
  'skyDPinball', 'skyDAirHockey', 'skyDClawCrane',
  // Aurora Picture House
  'skyDPopcornCart', 'skyDCinemaSeats', 'skyDTicketBooth', 'skyDCinemaScreen',
  // Big Sky Wonders
  'skyDTelescope', 'skyDGiantGlobe', 'skyDRocketModel', 'skyDPlanetMobile',
  // Blue Line Sports
  'skyDHockeyNet', 'skyDGoalieMannequin',
] as const;
export type ShopsBKind = (typeof SHOPS_B_KINDS)[number];

/** The kit model each model-backed kind renders with (the cinema screen is drawn by code). */
export const SHOPS_B_MODEL: Readonly<Partial<Record<ShopsBKind, SkywaysDestPropKey>>> = {
  skyDPlantBench: 'skyways_d_gd_bench', skyDPottedPalm: 'skyways_d_gd_palm', skyDGeraniumPot: 'skyways_d_gd_pot', skyDWheelbarrow: 'skyways_d_gd_barrow',
  skyDPinball: 'skyways_d_ar_pinball', skyDAirHockey: 'skyways_d_ar_airhockey', skyDClawCrane: 'skyways_d_ar_claw',
  skyDPopcornCart: 'skyways_d_cn_popcorn', skyDCinemaSeats: 'skyways_d_cn_seats', skyDTicketBooth: 'skyways_d_cn_booth',
  skyDTelescope: 'skyways_d_sc_telescope', skyDGiantGlobe: 'skyways_d_sc_globe', skyDRocketModel: 'skyways_d_sc_rocket', skyDPlanetMobile: 'skyways_d_sc_mobile',
  skyDHockeyNet: 'skyways_d_hk_net', skyDGoalieMannequin: 'skyways_d_hk_goalie',
};

/** A kit model's measured row (lane KITS' table: runtime bounds + the measured support heights). */
export const shopsBModel = (k: SkywaysDestPropKey): SkywaysDestProp => SKYWAYS_DEST_PROPS[k];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The cinema SCREEN (code-drawn, kind skyDCinemaScreen): a matte-white projection surface `w` x `h` inside a black masking frame
 * `border` wide, `d` deep off the wall; its frame bottom `y` above the auditorium floor (lowered in a low room so its top stays
 * `ceilGap` under the ceiling). The renderer draws: the black frame box (w + 2 border) x (h + 2 border) x d, the white face inset on its +Z.
 */
export const SKYD_SCREEN = {w: 7.0, h: 3.0, border: 0.1, d: 0.1, y: 0.9, minY: 0.5, ceilGap: 0.1} as const;

/** Plant bench top (m above its base): the measured `topY` when the kit table carries it, else the model's height. */
export const PLANT_BENCH_TOP = (): number => shopsBModel('skyways_d_gd_bench').topY ?? shopsBModel('skyways_d_gd_bench').h;
/** Planet mobile: its hang point above its base (the top ring) — the measured `hangY`, else its height. */
export const PLANET_MOBILE_HANG = (): number => shopsBModel('skyways_d_sc_mobile').hangY ?? shopsBModel('skyways_d_sc_mobile').h;
/** Clear underside of a hung piece (m above the floor). */
export const HUNG_CLEAR = 2.3;

type Phys = DestKindSpec['phys'];
const D = (mass: number, mat: 'pad' | 'castor', shape: 'box' | 'cylinder', how: string, onHost = false): Phys => ({dynamic: true, mass, mat, shape, how, ...(onHost ? {onHost: true} : {})});

function spec(kind: ShopsBKind, s: Omit<DestKindSpec, 'def' | 'model'> & {blocksSight?: boolean; size?: {w: number; h: number; d: number}}): DestKindSpec {
  const m = SHOPS_B_MODEL[kind];
  const box = s.size ?? (m ? shopsBModel(m) : {w: 1, h: 1, d: 1});
  const ph = s.phys;
  return {
    def: {w: r3(box.w), d: r3(box.d), h: r3(box.h), blocksSight: s.blocksSight ?? false,
      // dynamic kinds: calibrated castor / pad contact + contact wake; on-host decor `onHost` (damage/materials.ts propPhysics)
      ...(ph.dynamic ? {physics: {mass: ph.mass, dynamic: true, shape: ph.shape, mat: ph.mat, contact: true, ...(ph.onHost ? {onHost: true} : {})}} : {})},
    phys: ph, damage: s.damage, open: s.open, ...(m ? {model: m} : {}),
  };
}

const SCREEN_BOX = {w: SKYD_SCREEN.w + 2 * SKYD_SCREEN.border, h: SKYD_SCREEN.h + 2 * SKYD_SCREEN.border, d: SKYD_SCREEN.d};

export const SHOPS_B_SPECS: Readonly<Record<ShopsBKind, DestKindSpec>> = {
  // --- Glasshouse Garden Co. ---
  skyDPlantBench: spec('skyDPlantBench', {
    phys: {dynamic: false, why: 'fixture', how: 'slatted timber greenhouse plant bench on galvanised steel legs (~35 kg) set out in its bench row as the host of its geranium pots: kept static so the pots on its top can be shot off it (on-host decor goes loose only on a static host; a prop something rests on never moves — no floating pots)'},
    damage: 'wood', open: {cls: 'none', role: 'surface', how: 'open slatted bench top (the pots stand on it): no door, lid or drawer'},
  }),
  skyDPottedPalm: spec('skyDPottedPalm', {
    phys: D(40, 'pad', 'cylinder', 'tall kentia palm in a big glazed ceramic planter of soil (~40 kg): walked into it slides / rocks, buckshot rocks / tips it'),
    damage: 'porcelain', open: {cls: 'none', role: 'decor', how: 'potted palm: nothing to open'},
  }),
  skyDGeraniumPot: spec('skyDGeraniumPot', {
    phys: D(2.5, 'pad', 'cylinder', 'terracotta pot of soil with a geranium (~2.5 kg) standing on a plant bench: a shot knocks it over or off the bench (on-host decor: out of reach of a walker\'s legs)', true),
    damage: 'porcelain', open: {cls: 'none', role: 'decor', how: 'flower pot: nothing to open'},
  }),
  skyDWheelbarrow: spec('skyDWheelbarrow', {
    phys: D(18, 'pad', 'box', 'empty garden wheelbarrow (~18 kg: steel tray, one wheel, two legs): walked into it slides / rolls on, shot it slides / tips'),
    damage: 'steel', open: {cls: 'none', role: 'equipment', how: 'open steel tray (empty): nothing to open'},
  }),
  // --- Starfall Arcade ---
  skyDPinball: spec('skyDPinball', {
    phys: {dynamic: false, why: 'too heavy', how: 'coin-op pinball machine (~115 kg: cabinet, playfield, backbox) on levelled legs: a bump or a bullet does not shove it'},
    damage: 'wood', open: {cls: 'exception', role: 'equipment', how: 'sealed coin-op machine: its locked coin door and playfield glass are service panels (the coin box is empty), not storage'},
  }),
  skyDAirHockey: spec('skyDAirHockey', {
    phys: {dynamic: false, why: 'too heavy', how: 'coin-op air-hockey table (~140 kg cabinet base with its blower) on levelling feet: a bump or a bullet does not shove it'},
    damage: 'laminate', open: {cls: 'exception', role: 'equipment', how: 'sealed coin-op table: the coin mech and puck return are service panels of the machine, not storage'},
  }),
  skyDClawCrane: spec('skyDClawCrane', {
    phys: {dynamic: false, why: 'too heavy', how: 'claw crane prize machine (~180 kg glass-fronted cabinet): a bump or a bullet does not shove it'},
    damage: 'glass', open: {cls: 'exception', role: 'equipment', how: 'sealed coin-op machine: the plush prize pile is behind its locked glass (part of the machine, like a vending machine\'s display); the coin door is a service panel'},
  }),
  // --- Aurora Picture House ---
  skyDPopcornCart: spec('skyDPopcornCart', {
    phys: D(45, 'castor', 'box', 'vintage popcorn cart on spoked wheels (~45 kg: steel cart, glass kettle cabinet): walked into it rolls ahead, shot it rolls / rocks'),
    damage: 'sheetMetal', open: {cls: 'exception', role: 'equipment', how: 'popcorn machine: its glass kettle cabinet holds the stale popcorn of the machine (sealed food equipment, not storage)'},
  }),
  skyDCinemaSeats: spec('skyDCinemaSeats', {
    phys: {dynamic: false, why: 'anchored', how: 'row of four tip-up cinema seats on a shared steel rail bolted to the auditorium floor'},
    damage: 'fabric', open: {cls: 'none', role: 'equipment', how: 'fixed seat row: tip-up seats, nothing to open'},
  }),
  skyDTicketBooth: spec('skyDTicketBooth', {
    blocksSight: true,
    phys: {dynamic: false, why: 'too heavy', how: 'freestanding art-deco ticket kiosk (~350 kg: steel frame, curved glass, panelled base): a bump or a bullet does not shove it'},
    damage: 'wood', open: {cls: 'exception', role: 'equipment', how: 'ticket kiosk: its rear staff door opens onto the cashier\'s standing space (a counter shelf, no shelves or drawers): equipment, not storage'},
  }),
  skyDCinemaScreen: spec('skyDCinemaScreen', {
    size: SCREEN_BOX,
    phys: {dynamic: false, why: 'mounted', how: 'projection screen in its black masking frame fixed to the auditorium\'s screen wall'},
    damage: 'fabric', open: {cls: 'none', role: 'decor', how: 'wall-mounted projection screen'},
  }),
  // --- Big Sky Wonders ---
  skyDTelescope: spec('skyDTelescope', {
    phys: D(14, 'pad', 'box', 'refracting telescope on a tall wooden tripod (~14 kg): walked into it slides / rocks, shot it slides / topples (its collider is the full tripod spread)'),
    damage: 'sheetMetal', open: {cls: 'none', role: 'equipment', how: 'telescope on a tripod: nothing to open'},
  }),
  skyDGiantGlobe: spec('skyDGiantGlobe', {
    phys: D(16, 'pad', 'cylinder', 'large world globe on a wooden floor stand (~16 kg): walked into it slides / rocks, shot it rocks / tips'),
    damage: 'wood', open: {cls: 'none', role: 'decor', how: 'globe on a stand: nothing to open'},
  }),
  skyDRocketModel: spec('skyDRocketModel', {
    phys: D(28, 'pad', 'cylinder', 'tall fibreglass display rocket on its launch-pad base (~28 kg): walked into it slides / rocks, buckshot tips it over'),
    damage: 'plastic', open: {cls: 'none', role: 'decor', how: 'solid display model: nothing to open'},
  }),
  skyDPlanetMobile: spec('skyDPlanetMobile', {
    phys: {dynamic: false, why: 'mounted', how: 'planetary mobile hung from the ceiling by its top ring (painted spheres on wire arms; clear underside >= 2.3 m)'},
    damage: 'plastic', open: {cls: 'none', role: 'decor', how: 'ceiling-hung mobile'},
  }),
  // --- Blue Line Sports ---
  skyDHockeyNet: spec('skyDHockeyNet', {
    phys: D(38, 'pad', 'box', 'regulation hockey goal (~38 kg: steel tube frame, netting, padded base): walked into it slides, shot it slides / rocks'),
    damage: 'steel', open: {cls: 'none', role: 'equipment', how: 'goal net frame: nothing to open'},
  }),
  skyDGoalieMannequin: spec('skyDGoalieMannequin', {
    phys: D(24, 'pad', 'box', 'display mannequin in full goalie gear on a round steel base (~24 kg): walked into it slides / rocks, shot it tips over'),
    damage: 'plastic', open: {cls: 'none', role: 'decor', how: 'dressed display mannequin (the gear is worn, part of the display): nothing to open'},
  }),
};

/**
 * Scale-check record (tools/asset-pipeline/props/scale-check.mjs beside zombie `lastshift` at runtime scale 1.0, viewed): W x H x D, grounded
 * contact, support heights. Pending until lane KITS delivers the measured models (the placeholder table has no files yet).
 */
export const SHOPS_B_SCALE: Readonly<Partial<Record<ShopsBKind, string>>> = {};
