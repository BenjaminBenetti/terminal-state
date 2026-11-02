// Task reactor-expansion-20261101 (lane WASTE): pure-data records of THE NUCLEAR-WASTE REPOSITORY (gen/reactor/complex/waste*.ts) —
// the side complex off the Reactor's main shaft that houses zone 2's auxiliary generator (the core-floor fans) on tier 4.
//
// `layout.reactorWaste` (StationLayout, optional; written by the complex's dress hook after the crop, world metres, absolute y) is the
// complex's DECOR: the drum racks and their drums, the dry casks, the compactor, ventilation fans, ducts, cable trays, crane runway,
// vault-door frames, hazard floor bands and the yellow-green status beacons. world/reactor/wasteVisuals.ts instances it with the
// Reactor's EXISTING kit materials (archMaterials.ts reactorDress: the lead's Codex rusted-steel / pit-concrete / grating sets, the
// repo's painted-steel fallbacks) and the lead's approved REACTOR_KIT models where a record names one — never an untextured block,
// never hand-drawn texture art. Every SOLID piece a player could walk into also has an 'annexMachine' collision prop (anchored plant /
// racked-and-banded stores: OPENABLE_AUDIT 'exception', static physics), tagged `purpose: 'waste:<what>'` for QA.
// Pure data (no three.js).

/** Kit dressing materials a decor piece may use (world/reactor/archMaterials.ts reactorDress keys). */
export type WasteMat = 'steel' | 'steelDark' | 'yellow' | 'black' | 'pipe' | 'machine' | 'grating' | 'concrete' | 'cable';

/** An axis-aligned box (world metres, absolute y). */
export interface WasteBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m: WasteMat; c?: number }

/**
 * A cylinder of radius `r` and length `h`. Upright by default: (x, y, z) = the centre of its BASE. `ax` 'x' / 'z' lays it along that
 * world axis: then (x, y, z) = the middle of its axis (pipes, ducts). `c` = instance colour (0xRRGGBB, multiplies the material's
 * texture: painted drums).
 */
export interface WasteCyl { x: number; y: number; z: number; r: number; h: number; m: WasteMat; c?: number; ax?: 'x' | 'z' }

/** A floor hazard band (yellow / black diagonal stripes) over a rectangle, `y` = the floor it lies on. */
export interface WasteStripe { x0: number; z0: number; x1: number; z1: number; y: number }

/** A status beacon (unlit glow, no light source): yellow-green when `on`, dead grey otherwise. */
export interface WasteBeacon { x: number; y: number; z: number; on: boolean }

/**
 * The lead's approved models the complex places: REACTOR_KIT pieces (switchgear, control console, coolant valve) and the expansion's
 * waste set (assets/reactorExpansionKit.generated.ts REACTOR_X_KIT: wasteDrum, storageCask, deconShower, hotCellWindow).
 */
export type WasteModelPiece = 'switchgear' | 'controlConsole' | 'coolantValve' | 'wasteDrum' | 'storageCask' | 'deconShower' | 'hotCellWindow';

/**
 * An approved model placed in the complex: real size (the cooked dims), base centre (x, y, z), front +Z turned by `yaw` about +y
 * (three.js rotation.y: front = (sin yaw, cos yaw)). w / d / h = its footprint / height as placed (collision / fallback box).
 */
export interface WasteModel { piece: WasteModelPiece; x: number; y: number; z: number; yaw: number; w: number; d: number; h: number }

/**
 * A ventilation fan standing against a wall (on its plinth): (x, z) = the wall face point behind the hub, y = the hub height
 * (absolute), (nx, nz) = the normal from the wall into the room, r = duct ring radius (m). Drawn as the lead's REACTOR_KIT fan housing
 * (back flange on the wall) with its rotor, or a procedural duct ring when the model is not loaded.
 */
export interface WasteFan { x: number; y: number; z: number; nx: number; nz: number; r: number }

export interface WasteDecor {
  version: 1;
  /** layout.levels index of the complex's storey. */
  level: number;
  /** Complex bounds (world, for culling / QA). */
  bounds: {x0: number; z0: number; x1: number; z1: number};
  boxes: WasteBox[];
  cyls: WasteCyl[];
  stripes: WasteStripe[];
  beacons: WasteBeacon[];
  models: WasteModel[];
  fans: WasteFan[];
  /**
   * The generator's power route out of the complex (world polyline, absolute y): the floor trench from the skid to the plant door, then
   * the ceiling cable tray through the sealed corridor, the drum vault and the receiving bay to the entrance on the shaft deck. ARCH /
   * the host may continue ReactorGenerator.cable from its last point.
   */
  cable: {x: number; y: number; z: number}[];
}

/** Real sizes (m) of the repository's stored goods and kit (scale: the 1.8 m player / zombie; the hero models' cooked dims). */
export const WASTE_SIZES = {
  /** A 200 L steel drum (REACTOR_X_KIT.wasteDrum 0.63 x 0.90 x 0.63). */
  drum: {r: 0.315, h: 0.9},
  /** Drum rack bay: 2 drums across (1.4 m), 2 deep back-to-back (1.3 m), 2 tiers (deck at 1.06 m, top rail 2.2 m). */
  rackBay: {w: 1.4, d: 1.3, tier: 1.06, top: 2.2},
  /** Banded 4-drum pallet: 1.3 x 1.3 m steel skid, deck 0.12 m. */
  pallet: {w: 1.3, deck: 0.12},
  /** Vented dry storage cask (REACTOR_X_KIT.storageCask 3.88 x 4.60 x 3.23). */
  cask: {w: 3.88, h: 4.6, d: 3.23},
  /** Decon shower booth (REACTOR_X_KIT.deconShower 1.76 x 2.40 x 1.50). */
  shower: {w: 1.76, h: 2.4, d: 1.5},
  /** Hot-cell window wall section with two manipulator arms (REACTOR_X_KIT.hotCellWindow 3.60 x 3.00 x 1.76), set into a wall. */
  hotCell: {w: 3.6, h: 3.0, d: 1.76},
} as const;

/** Most hero drums instanced in one complex (~3 k triangles each: the racks hold at most this many; the rest of a rack stays empty). */
export const WASTE_DRUM_CAP = 160;

/** Collision-prop purpose tags (QA) of the complex's anchored decor. */
export type WasteTag = 'waste:rack' | 'waste:pallet' | 'waste:cask' | 'waste:shower' | 'waste:compactor' | 'waste:conveyor' | 'waste:machine' | 'waste:fan' | 'waste:door-leaf' | 'waste:portal';
