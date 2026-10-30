// Task office-props-physics-scale-20261030 (lane FURN): LOOSE CLUTTER kinds — the objects that used to be baked into the lab bench
// and the trading desk models, now separate props standing on their furniture's top (pure data, no three.js; merged into
// gen/office/kinds.ts OFFICE_KINDS so PROP_DEFS, the damage specs, the physics / openables audits and the office render path see them).
//
// User (2026-10-30): "all the beakers and lab equipment on top are part of the model, they shouldn't be! They must be cut out in to
// there own assets. And placed randomly on top. This way they will have phsyics and be interactable! ... Never bake items on top of
// furnature in to the furnature model always place props on top instead." and (curved monitor desk) "monitors are baked in to desk
// model instead of being placed on top".
//
// Models: one representative of each object type cut out of the same Meshy derivative (tools/asset-pipeline/props/build-office-overhaul.mjs
// FURNITURE + lib/clutter-split.mjs; assets/companyAssets.ts COMPANY_PART_ASSETS, lazy keys `office-<partId>`), each at its OWN real
// size, front -Z (world/officeProps.ts turns it like every office model). Footprints = their measured runtime bounds
// (assets/companyDims.generated.ts COMPANY_PART_DIMS) or the nominal box below while a model is missing.
// Placement: gen/office/hostClutter.ts puts a seeded, finite assortment on each lab bench / trading desk top (host decor). Physics:
// gen/office/physics.ts rows (dynamic, `onHost`: they go loose on their static host's top, react to bullets and knock-on).

import type {PropDef} from '../props';
import type {ShapeMat, ShapePart} from '../propShapes';
import type {DamageClass} from '../../damage/materials';
import {COMPANY_PART_DIMS} from '../../assets/companyDims.generated';

/** Furniture the clutter stands on (wave 2: + the drafting table, the mixing console, the espresso machine's cabinetLow counter). */
export type ClutterHost = 'labBench' | 'tradingDesk' | 'draftingTable' | 'mixingConsole' | 'cabinetLow';
interface ClutterSpec {
  /** Separated part id (assets/companyAssets.ts COMPANY_PART_ASSETS). */
  asset: string;
  /** Nominal box [w (x), d (z), h (y)] m until the model's measured dims exist. */
  box: readonly [number, number, number];
  cls: DamageClass;
  /** The furniture kind it was separated from (and stands on); the espresso cups stand on the espresso machine's sideboard. */
  host: ClutterHost;
}

const SPECS = {
  labFlask: {asset: 'lab-flask', box: [0.12, 0.11, 0.18], cls: 'glass', host: 'labBench'},
  labFlaskLarge: {asset: 'lab-flask-large', box: [0.17, 0.18, 0.3], cls: 'glass', host: 'labBench'},
  labMicroscope: {asset: 'lab-microscope', box: [0.27, 0.38, 0.4], cls: 'steel', host: 'labBench'},
  labBottle: {asset: 'lab-bottle', box: [0.08, 0.11, 0.22], cls: 'glass', host: 'labBench'},
  labBottleRack: {asset: 'lab-bottle-rack', box: [0.38, 0.19, 0.4], cls: 'glass', host: 'labBench'},
  labTubeRack: {asset: 'lab-tube-rack', box: [0.26, 0.16, 0.13], cls: 'plastic', host: 'labBench'},
  tradingMonitor: {asset: 'trading-monitor', box: [0.62, 0.18, 0.48], cls: 'plastic', host: 'tradingDesk'},
  tradingKeyboard: {asset: 'trading-keyboard', box: [0.62, 0.18, 0.05], cls: 'plastic', host: 'tradingDesk'},
  // Wave 2 (lane SCALE's catalog review): the drafting table's arm lamp, the mixing desk's studio monitors, the espresso machine's cups
  draftingLamp: {asset: 'drafting-lamp', box: [0.75, 0.22, 0.55], cls: 'steel', host: 'draftingTable'},
  studioMonitor: {asset: 'studio-monitor', box: [0.42, 0.45, 0.45], cls: 'plastic', host: 'mixingConsole'},
  studioMonitorSmall: {asset: 'studio-monitor-small', box: [0.42, 0.38, 0.22], cls: 'plastic', host: 'mixingConsole'},
  espressoCups: {asset: 'espresso-cups', box: [0.11, 0.1, 0.14], cls: 'porcelain', host: 'cabinetLow'},
} as const satisfies Record<string, ClutterSpec>;

export type ClutterKind = keyof typeof SPECS;
export const CLUTTER_KINDS = Object.keys(SPECS) as ClutterKind[];
export function isClutterKind(kind: string): kind is ClutterKind {
  return kind in SPECS;
}
/** The furniture kind a clutter kind belongs on. */
export const clutterHost = (k: ClutterKind): ClutterHost => SPECS[k].host;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function defOf(k: ClutterKind): PropDef {
  const s: ClutterSpec = SPECS[k];
  const dims = COMPANY_PART_DIMS[s.asset];
  const [w, d, h] = dims ? [dims[0], dims[2], dims[1]] : s.box;
  return {w: r3(w), d: r3(d), h: r3(h), blocksSight: false};
}
export const CLUTTER_PROP_DEFS = Object.fromEntries(CLUTTER_KINDS.map(k => [k, defOf(k)])) as Record<ClutterKind, PropDef>;

/** Part id (assets/companyAssets.ts COMPANY_PART_ASSETS) a clutter kind renders with (lazy library key `office-<id>`). */
export const CLUTTER_KIND_ASSET: Readonly<Record<ClutterKind, string>> = Object.fromEntries(CLUTTER_KINDS.map(k => [k, SPECS[k].asset])) as Record<ClutterKind, string>;

/** Damage specs (spread into kinds.ts OFFICE_PROP_DAMAGE): never destroyed (knocked about only); monitors' screens die like the office monitor's. */
export const CLUTTER_PROP_DAMAGE = Object.fromEntries(CLUTTER_KINDS.map(k => [k, {cls: SPECS[k].cls as DamageClass, integrity: Infinity, breaks: 'never' as const,
  ...(k === 'tradingMonitor' ? {glass: {cls: 'screen' as const, integrity: 18, on: 'dead' as const}} : {})}])) as
  Record<ClutterKind, {cls: DamageClass; integrity: number; breaks: 'never'; glass?: {cls: 'screen'; integrity: number; on: 'dead'}}>;

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

/** Box stand-ins (prop frame: origin bottom centre, front +Z) while a model is not loaded. */
export function clutterShape(kind: ClutterKind): ShapePart[] {
  const {w, d, h} = CLUTTER_PROP_DEFS[kind];
  switch (kind) {
    case 'labFlask': case 'labFlaskLarge': case 'labBottle':
      return [box('glass', [w * 0.85, h * 0.65, d * 0.85], [0, h * 0.325, 0]), box('glass', [w * 0.35, h * 0.35, d * 0.35], [0, h * 0.825, 0])];
    case 'labMicroscope':
      return [box('steelBright', [w * 0.8, h * 0.08, d * 0.6], [0, h * 0.04, 0]), box('steelBright', [w * 0.2, h * 0.85, d * 0.2], [0, h * 0.5, -d * 0.2]), box('black', [w * 0.6, h * 0.04, d * 0.5], [0, h * 0.45, d * 0.05])];
    case 'labBottleRack':
      return [box('steelBright', [w, 0.02, d], [0, h * 0.55, 0]), box('glass', [w * 0.8, h * 0.4, d * 0.6], [0, h * 0.78, 0]), box('steelBright', [w, 0.02, d], [0, 0.01, 0])];
    case 'labTubeRack':
      return [box('porcelain', [w, h * 0.25, d], [0, h * 0.125, 0]), box('glass', [w * 0.9, h * 0.75, d * 0.5], [0, h * 0.625, 0])];
    case 'tradingMonitor':
      return [box('panel', [w, h * 0.68, 0.04], [0, h * 0.64, d * 0.2]), box('screen', [w * 0.94, h * 0.6, 0.005], [0, h * 0.64, d * 0.2 + 0.023]), box('steelDark', [0.06, h * 0.32, 0.05], [0, h * 0.16, -d * 0.1]), box('steelDark', [w * 0.35, 0.015, d * 0.8], [0, 0.008, 0])];
    case 'tradingKeyboard':
      return [box('black', [w * 0.72, h * 0.5, d * 0.9], [-w * 0.13, h * 0.25, 0]), box('black', [w * 0.12, h, d * 0.55], [w * 0.4, h * 0.5, 0])];
    case 'draftingLamp':
      return [box('black', [0.18, 0.02, d * 0.9], [-w * 0.35, 0.01, 0]), box('steelDark', [0.02, h * 0.7, 0.02], [-w * 0.35, h * 0.35, 0]), box('steelDark', [w * 0.8, 0.02, 0.02], [0, h * 0.75, 0]), box('black', [0.16, 0.12, 0.16], [w * 0.38, h * 0.85, 0])];
    case 'studioMonitor': case 'studioMonitorSmall':
      return [box('black', [w, h, d], [0, h / 2, 0]), box('steelDark', [w * 0.5, w * 0.5, 0.01], [0, h * 0.45, d / 2 + 0.005])];
    case 'espressoCups':
      return [box('porcelain', [w, h, d], [0, h / 2, 0])];
  }
}
