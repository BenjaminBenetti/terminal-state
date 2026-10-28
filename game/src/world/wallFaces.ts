// Iteration 08: wall-face contract between the world builder (Lane G, which extracts faces from the
// multi-level layout and renders base walls) and the wall-treatment pass (Lane W, which adds zone
// identity + deterioration detail on top). Types only; see reference/tasks/vertical-slice-iteration08-20261027/design.md.

/** Broad wall identity used to choose a treatment. */
export type WallZone =
  | 'platform'   // platform side walls (track-facing / back walls): tile bands, station name friezes
  | 'trackbed'   // track-bed / tunnel / platform-face concrete
  | 'concourse'  // public halls, passages, ticket hall, mezzanines
  | 'shop'       // storefront bays / food court units
  | 'service'    // back-of-house corridors, rooms, closets
  | 'stair'      // stair cores between levels
  | 'upper'      // upper concourse / catwalk level
  | 'lower';     // lower service / maintenance crossing

/** One straight, axis-aligned wall run facing into open space (merged along cells). */
export interface WallFace {
  /** Level id the face belongs to (its band) and the area it faces into. */
  level: number;
  area: number;
  /** RoomType of that area (e.g. 'platform', 'service-corridor', 'food-court'). */
  areaType: string;
  zone: WallZone;
  /** Endpoints along the face (world metres, on the wall plane); axis-aligned. */
  x0: number; z0: number; x1: number; z1: number;
  /** Outward normal (into the open space): one of ±X / ±Z. */
  nx: number; nz: number;
  /** Vertical extent of the visible face (absolute world y). */
  y0: number; y1: number;
  /** Base material key the builder used for the face (e.g. 'tileLower', 'tileUpper', 'paint', 'concrete'). */
  finish: string;
  /** Spans along the face (metres from x0/z0) that are openings (doors, arches, apertures): keep clear. */
  openings: {s0: number; s1: number; top: number}[];
  /** Stable per-face seed for deterministic detail. */
  seed: number;
  /**
   * Lane G (optional): sloped face (stair-flight side walls). Bottom/top y at the x0/z0 end (b0/t0) and
   * at the x1/z1 end (b1/t1), linear between; y0/y1 are then only the bounds. Absent = rectangle.
   */
  slope?: {b0: number; b1: number; t0: number; t1: number};
}
