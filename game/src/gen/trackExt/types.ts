// Track 2 (Beyond the Station): data model of the track extensions — DESIGN.md §1 (GEN owns; VIS and CONTENT consume).
// Placeholder written by the VIS lane exactly per the contract; the GEN lane's version replaces it at integration.

export interface TrackTunnel {
  id: number;                       // index in layout.extensions.tunnels
  trench: number;                   // index into layout.trenches (the bed it continues)
  from: 'x0' | 'x1';                // which bed end
  floorY: number;                   // trackbed height (TRENCH floorY, -1.15)
  ceilY: number;                    // flat box-section ceiling (= that bed's ceiling)
  width: number;                    // inner wall-to-wall width (m) = bed width
  /** Smooth centreline, world metres, starting ON the bed end face, sample spacing <= 0.5 m; straight runs + circular arcs. */
  path: {x: number; z: number}[];
  length: number;                   // m along path
  rails: number[];                  // lateral offsets (m, +left) of each track centreline from the path (from the bed's tracks)
  cap: {kind: 'rubble' | 'bulkhead' | 'gate'; s: number};  // physical terminal at arc length s (= length)
  areas: number[];                  // layout.areas ids whose cells are this tunnel's walkable cells
  doors: {annex: number; door: number; s: number; side: 1 | -1}[];   // side door(s) to annexes: layout.doors index, arc pos, side (+1 = left of travel)
  clues: {s: number; side: 1 | -1; kind: 'arrow' | 'tag'; toward: 1 | -1}[];  // graffiti ONLY when the route really exists (toward = +1 further along path)
}
export interface ServiceAnnex {
  id: number; tunnel: number; door: number;          // entry door (layout.doors index) on the tunnel wall
  areas: number[];                                   // all annex rooms + corridors (layout.areas ids)
  floorY: number; ceilY: number;                     // cramped: ceiling ~2.4–2.8 m above floor
  cells: number; areaM2: number;                     // walkable FLOOR cells / m²
  exit: {x: number; z: number};                      // the door (identifiable way out)
}
export interface TrackExtensions {
  tunnels: TrackTunnel[]; annexes: ServiceAnnex[];
  /** What was tried and omitted (for census / tests): candidate ends, rejected reasons. */
  log: {trench: number; from: 'x0' | 'x1'; result: string}[];
}
// StationLayout.extensions?: TrackExtensions   (absent on non-track levels)
// Area.ext?: 'tunnel' | 'annex'  (+ Area.extId)  — the marker every existing pass skips
