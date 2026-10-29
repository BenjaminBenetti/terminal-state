// Iteration 16 (WORLD-GEN): office prop kinds — pure data (no three.js), merged into gen/props.ts PROP_DEFS.
//
// Office furniture renders with lane ASSETS' Meshy T2.5 models (assets/officeAssets.ts, model keys `office-<assetId>`, front
// -Z in the file: the builder turns them to the prop frame, front +Z) and falls back to the box forms below when a model is not
// delivered or failed to load (world/officeProps.ts). None of these kinds is a loot holder: office loot sits in the existing
// holders (the `desk` itself — rendered as the Meshy office desk inside office sections —, cabinets, crates, shelves,
// kitchenette / fridge, vending, filing cabinets with drawers …), so the loot / openable / damage plumbing is unchanged.
// `cubiclePartition` is always geometry: a fabric panel whose length comes from each placement's hx / hz (cell-aligned runs).

import type {PropDef} from '../props';
import type {ShapeMat, ShapePart} from '../propShapes';
import type {DamageClass} from '../../damage/materials';

export const OFFICE_KINDS = [
  'officeChair', 'officeMonitor', 'officeFiling', 'officePhotocopier', 'officeWaterCooler', 'conferenceTable', 'deadPlant',
  'receptionDesk', 'serverRack', 'officeWhiteboard', 'officeShelf', 'cubiclePartition',
] as const;
export type OfficeKind = (typeof OFFICE_KINDS)[number];
export function isOfficeKind(kind: string): kind is OfficeKind {
  return (OFFICE_KINDS as readonly string[]).includes(kind);
}

/** Footprints (m; local frame front +Z): the manifest's real sizes (design.md Part 1, B1-B12). */
export const OFFICE_PROP_DEFS: Record<OfficeKind, PropDef> = {
  officeChair: {w: 0.62, d: 0.62, h: 1.0, blocksSight: false},
  officeMonitor: {w: 0.55, d: 0.42, h: 0.45, blocksSight: false},
  officeFiling: {w: 0.47, d: 0.62, h: 1.32, blocksSight: false},
  officePhotocopier: {w: 1.0, d: 0.68, h: 1.1, blocksSight: false},
  officeWaterCooler: {w: 0.36, d: 0.36, h: 1.3, blocksSight: false},
  conferenceTable: {w: 3.0, d: 1.2, h: 0.76, blocksSight: false},
  deadPlant: {w: 0.5, d: 0.5, h: 1.1, blocksSight: false},
  receptionDesk: {w: 2.6, d: 0.9, h: 1.1, blocksSight: false},
  serverRack: {w: 0.62, d: 1.0, h: 2.0, blocksSight: true},
  officeWhiteboard: {w: 1.8, d: 0.55, h: 1.8, blocksSight: false},
  officeShelf: {w: 0.9, d: 0.36, h: 1.8, blocksSight: false},
  /** Unit length (one cell); placements carry their run length in hx / hz. */
  cubiclePartition: {w: 0.5, d: 0.08, h: 1.45, blocksSight: false},
};

/** Asset id (assets/officeAssets.ts) a kind renders with; `desk` uses 'office-desk' inside office sections. */
export const OFFICE_KIND_ASSET: Readonly<Partial<Record<OfficeKind | 'desk', string>>> = {
  desk: 'office-desk', officeChair: 'office-chair', officeMonitor: 'office-monitor', officeFiling: 'filing-cabinet',
  officePhotocopier: 'photocopier', officeWaterCooler: 'water-cooler', conferenceTable: 'conference-table', deadPlant: 'dead-plant',
  receptionDesk: 'reception-desk', serverRack: 'server-rack', officeWhiteboard: 'whiteboard', officeShelf: 'office-shelf',
};
/** Lazy model-library key of an office asset id (ASSETS' OFFICE_MODEL_FILES keys). */
export const officeModelKey = (assetId: string): string => `office-${assetId}`;

const NEVER = (cls: DamageClass) => ({cls, integrity: Infinity, breaks: 'never' as const});
/** Damage specs (damage/materials.ts PROP_DAMAGE spreads this). */
export const OFFICE_PROP_DAMAGE = {
  officeChair: NEVER('fabric'), officeMonitor: {...NEVER('plastic'), glass: {cls: 'screen' as const, integrity: 18, on: 'dead' as const}},
  officeFiling: NEVER('sheetMetal'), officePhotocopier: NEVER('plastic'), officeWaterCooler: NEVER('plastic'), conferenceTable: NEVER('laminate'),
  deadPlant: NEVER('plastic'), receptionDesk: NEVER('laminate'), serverRack: NEVER('sheetMetal'), officeWhiteboard: NEVER('laminate'),
  officeShelf: NEVER('sheetMetal'), cubiclePartition: NEVER('fabric'),
} satisfies Record<OfficeKind, {cls: DamageClass; integrity: number; breaks: 'never'; glass?: unknown}>;

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

/** Procedural stand-in forms (box parts, prop frame: origin bottom centre, front +Z). Partitions are built per placement. */
export function officeShape(kind: OfficeKind): ShapePart[] | null {
  const D = OFFICE_PROP_DEFS[kind];
  const {w, d, h} = D;
  switch (kind) {
    case 'officeChair': return [
      box('black', [0.56, 0.05, 0.56], [0, 0.03, 0]), box('steelDark', [0.05, 0.4, 0.05], [0, 0.25, 0]),
      box('plasticSeat', [0.5, 0.09, 0.5], [0, 0.48, 0.02]), box('plasticSeat', [0.48, 0.5, 0.08], [0, 0.76, -0.24]),
    ];
    case 'officeMonitor': return [
      box('panel', [0.5, 0.36, 0.05], [0, 0.27, -0.1]), box('screen', [0.44, 0.3, 0.01], [0, 0.27, -0.072]),
      box('steelDark', [0.06, 0.1, 0.06], [0, 0.05, -0.12]), box('panel', [0.44, 0.025, 0.15], [0, 0.0125, 0.12]),
    ];
    case 'officeFiling': return [
      box('steelBright', [w, h, d], [0, h / 2, 0]),
      ...[0.18, 0.5, 0.82, 1.14].map(y => box('black', [w * 0.5, 0.03, 0.01], [0, y, d / 2 + 0.005])),
    ];
    case 'officePhotocopier': return [
      box('panel', [w, 0.85, d], [0, 0.425, 0]), box('counter', [w * 0.9, 0.12, d * 0.85], [0, 0.91, 0]),
      box('black', [w * 0.35, 0.05, 0.25], [w * 0.25, 1.0, 0.1]), box('steelDark', [w * 0.3, 0.06, d * 0.6], [-w * 0.42, 0.8, 0]),
    ];
    case 'officeWaterCooler': return [
      box('panel', [w, 0.95, d], [0, 0.475, 0]), box('glass', [0.28, 0.35, 0.28], [0, 1.12, 0]),
    ];
    case 'conferenceTable': return [
      box('woodVeneer', [w, 0.05, d], [0, h - 0.025, 0]),
      box('steelDark', [0.08, h - 0.05, d * 0.7], [-w * 0.35, (h - 0.05) / 2, 0]), box('steelDark', [0.08, h - 0.05, d * 0.7], [w * 0.35, (h - 0.05) / 2, 0]),
    ];
    case 'deadPlant': return [
      box('concrete', [0.42, 0.42, 0.42], [0, 0.21, 0]), box('wood', [0.06, 0.5, 0.06], [0, 0.65, 0]), box('black', [0.42, 0.25, 0.42], [0, 0.85, 0]),
    ];
    case 'receptionDesk': return [
      box('counter', [w, h - 0.04, 0.08], [0, (h - 0.04) / 2, d / 2 - 0.04]), box('counter', [w, 0.04, d], [0, h - 0.02, 0]),
      box('laminate', [w - 0.1, 0.04, d - 0.3], [0, 0.74, -0.1]), box('panel', [0.06, h - 0.04, d - 0.08], [-w / 2 + 0.03, (h - 0.04) / 2, -0.04]),
      box('panel', [0.06, h - 0.04, d - 0.08], [w / 2 - 0.03, (h - 0.04) / 2, -0.04]),
    ];
    case 'serverRack': return [
      box('black', [w, h, d], [0, h / 2, 0]), box('screen', [w * 0.8, h * 0.85, 0.01], [0, h / 2, d / 2 + 0.006]),
    ];
    case 'officeWhiteboard': return [
      box('panel', [w, 1.0, 0.04], [0, 1.25, 0]), box('steelBright', [w * 0.96, 0.92, 0.01], [0, 1.25, 0.025]),
      box('steelDark', [0.05, 1.75, 0.05], [-w / 2 + 0.05, 0.875, 0]), box('steelDark', [0.05, 1.75, 0.05], [w / 2 - 0.05, 0.875, 0]),
      box('steelDark', [0.05, 0.05, d], [-w / 2 + 0.05, 0.05, 0]), box('steelDark', [0.05, 0.05, d], [w / 2 - 0.05, 0.05, 0]),
    ];
    case 'officeShelf': return [
      box('steelDark', [0.04, h, d], [-w / 2 + 0.02, h / 2, 0]), box('steelDark', [0.04, h, d], [w / 2 - 0.02, h / 2, 0]),
      box('steelDark', [w, h, 0.02], [0, h / 2, -d / 2 + 0.01]),
      ...[0.06, 0.48, 0.9, 1.32, 1.76].map(y => box('steelBright', [w - 0.04, 0.025, d - 0.02], [0, y, 0])),
      box('accent', [0.3, 0.3, 0.24], [-0.2, 0.62, 0.02]), box('wood', [0.2, 0.28, 0.22], [0.25, 1.04, 0.02]),
    ];
    case 'cubiclePartition': return null;
  }
}

/**
 * Lazy model-library keys (ASSETS' OFFICE_MODEL_FILES) the layout's office props render with — for a preload hook
 * (game.sectionPreloads: `propModels.ensure(officeModelKeysFor(layout))` once the library knows OFFICE_MODEL_FILES).
 * `desk` maps to the office desk only inside office sections (the Subway keeps its procedural desk).
 */
export function officeModelKeysFor(layout: {props: readonly {kind: string}[]; office?: unknown}): string[] {
  const s = new Set<string>();
  for (const p of layout.props) {
    const id = OFFICE_KIND_ASSET[p.kind as OfficeKind | 'desk'];
    if (id && (p.kind !== 'desk' || layout.office)) s.add(officeModelKey(id));
  }
  return [...s].sort();
}
