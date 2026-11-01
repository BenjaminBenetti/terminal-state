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

/** An approved Reactor kit model placed in the complex (REACTOR_KIT piece; real size, front +Z rotated by `yaw` about y). */
export interface WasteModel { piece: 'switchgear' | 'controlConsole' | 'coolantValve' | 'coolantPump'; x: number; y: number; z: number; yaw: number; w: number; d: number; h: number }

/** A wall ventilation fan: hub centre (absolute y), the wall's outward normal (into the room), duct ring radius (m). */
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
}

/** Real sizes (m) of the repository's stored goods and kit (scale: the 1.8 m player / zombie). */
export const WASTE_SIZES = {
  /** A 200 L steel drum: 0.585 m diameter x 0.88 m (ISO 15750). */
  drum: {r: 0.29, h: 0.88},
  /** Drum rack bay: 2 drums across (1.4 m), 2 deep back-to-back (1.3 m), 2 tiers (beam at 1.05 m, top rail 2.2 m). */
  rackBay: {w: 1.4, d: 1.3, tier: 1.05, top: 2.2},
  /** Banded 4-drum pallet: 1.2 x 1.2 m, deck 0.14 m. */
  pallet: {w: 1.2, deck: 0.14},
  /** Dry storage cask (vertical concrete overpack): ~3.3 m diameter, 5.0-5.8 m tall (ceiling permitting). */
  cask: {r: 1.65, h: 5.4, minH: 4.2},
  /** Decon shower stall 1.0 x 1.0 x 2.3 m. */
  shower: {w: 1.0, h: 2.3},
} as const;

/** Collision-prop purpose tags (QA) of the complex's anchored decor. */
export type WasteTag = 'waste:rack' | 'waste:pallet' | 'waste:cask' | 'waste:shower' | 'waste:compactor' | 'waste:conveyor' | 'waste:machine' | 'waste:fan' | 'waste:door-leaf' | 'waste:portal';
