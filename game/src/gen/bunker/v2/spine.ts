// Task studio-bunker-rework-20261109-205115-01: THE BUNKER, layout version 2 — the lead-owned SHARED SPINE every floor builds round.
// Pure data. The spine fixes everything that must line up between storeys, so six floor designers can work in parallel without
// conflicting stairs, shafts or slabs:
//
//  - the canvas (one grid size for all six storeys; canvas cells = grid cells, 0.5 m) and the storey floors (7 m apart, descending);
//  - the STATION's fixed pieces (storey 0): the track bed + side platform (the train parks here), the vault bulkhead with its lane, and
//    the VAULT VESTIBULE behind it (the vertical hub: the main stair's head and the cargo lift's top landing open off it);
//  - the two scissor STAIR CORES (the main stair A, storeys 0-5; the service stair B, storeys 1-5): real shafts, the same footprint on
//    every storey, one landing per storey at alternating ends and ONE fixed landing door per storey;
//  - the CARGO LIFT SHAFT (storeys 0-5): solid on every storey grid (the car is a moving volume, world/bunker/cargoLift.ts), its gate on
//    the north face at every stop, and a clear loading APRON in front of the gate on every storey;
//  - the two DOUBLE-HEIGHT VOIDS: a lower storey's hall rising through the slab of the storey above, which keeps the void as an open
//    well with a railed gallery round it (V12: the habitation commons seen from the entry storey; V45: the processing core's nave seen
//    from the maintenance storey);
//  - every storey's ENVELOPE (where its rooms may be carved) and its keep-outs.
//
// Anchors are fixed (canonical frame, never mirrored): a floor's own design is seeded inside them. Floors CONNECT to an anchor by
// carving one of their areas over its apron; the pipeline (gen/bunker/v2/index.ts) then cuts the anchor's door into that area.

import {STAIR, stairRunCells} from '../../traversal';
import {SINGLE_BED_CELLS, type Rect, type Side} from '../../stationTypes';
import {TUN} from '../../stationKit';

/** Storeys: 0 = the station, 1..5 the shelter descending (5 = the central processing core, the lowest walkable storey). */
export const V2_LEVELS = 6;
export const V2_CORE_LEVEL = 5;
/** Storey rise (m) and the absolute floor of every storey. */
export const V2_RISE = 7;
export const V2_BASES: readonly number[] = Array.from({length: V2_LEVELS}, (_, i) => -i * V2_RISE);
/** Storey programmes (BunkerStorey.programme) and labels (HUD storey line / directory plates). */
export const V2_PROGRAMMES: readonly string[] = ['station', 'entry', 'habitation', 'services', 'maintenance', 'core'];
export const V2_STOREY_LABELS: readonly string[] = [
  'Station', 'Level 1 — Entry & security', 'Level 2 — Habitation', 'Level 3 — Services & medical', 'Level 4 — Maintenance & water', 'Level 5 — Central processing core',
];
/** Short plate text of a storey ("LEVEL 2 · HABITATION"; directory plates, the lift's floor indicator). */
export const V2_STOREY_PLATES: readonly string[] = ['STATION', 'LEVEL 1 · ENTRY & SECURITY', 'LEVEL 2 · HABITATION', 'LEVEL 3 · SERVICES & MEDICAL', 'LEVEL 4 · MAINTENANCE & WATER', 'LEVEL 5 · PROCESSING CORE'];
/** The generator storeys (gen-0 .. gen-2 in this order). */
export const V2_GENERATOR_LEVELS: readonly number[] = [2, 3, 4];

/** One storey run of a scissor core (cells along the run: flights + the top landing). */
export const V2_RUN_CELLS = stairRunCells(V2_RISE, STAIR);

/** The fixed module sizes and positions (cells unless noted). */
export const V2 = {
  /** The canvas (= every storey grid). */
  W: 140, H: 150,
  /** Scissor cores: lane widths (A main / B service), the landing depth at each end, the core length. */
  core: {laneA: 5, laneB: 4, landing: 4, len: 4 + V2_RUN_CELLS + 4},
  /** Core A (main stair, storeys 0-5) and core B (service stair, storeys 1-5): west column / north row. */
  coreA: {x: 44, y: 72},
  coreB: {x: 98, y: 80},
  /** Landing door width (cells) on a core's end wall (centred). */
  landingDoor: {A: 9, B: 7},
  /** Landing door height (m). */
  landingDoorH: 2.8,
  /** The cargo lift shaft (solid on every storey; the car moves inside) and the clear apron in front of its north gate. */
  shaft: {x: 57, y: 71, w: 10, h: 12},
  liftApronDepth: 8,
  /** The car: clear height (m) and its gate's clear height (m) at every stop. */
  liftCabH: 3.2,
  liftDoorH: 2.9,
  /** The station (storey 0). */
  station: {
    bedY: 3,
    /** Platform: west column, length, depth. */
    px0: 18, Lp: 76, Pd: 12,
    /** The arrival envelope (rows between the platform wall and the bulkhead), the bulkhead rows, the vestibule. */
    arrivalY0: 25,
    bulkheadY: 51,
    bulkheadRows: 2,
    vest: {x: 38, y: 53, w: 35, h: 18},
    /** The vault lane (3 cells, centred on the vestibule). */
    laneX: 54, laneW: 3,
  },
  /** Clear heights (m). */
  clear: {platform: 5.2, vest: 4.8, landing: 3.2, gallery: 4.6},
} as const;

/** A fixed connection a floor must serve: its door (cut by the pipeline) and the apron the floor carves as one of its areas. */
export interface V2Anchor {
  id: 'stairA' | 'stairB' | 'lift' | 'vaultHall';
  level: number;
  /** The door cells (cut into the floor's area over the apron: the wall between the anchor and the floor). */
  gate: Rect;
  /** Cells outside the gate the floor MUST carve as open floor of ONE of its areas, kept free of furniture. */
  apron: Rect;
  /** The side of the gate the apron lies on (the direction a person walks OUT of the anchor). */
  out: Side;
  /** Door height (m above the storey floor). */
  height: number;
  /** The pipeline cuts `gate` into the floor's area (stair landing doors); false = the spine owns the opening (lift gate, vault lane). */
  cut: boolean;
}

/** A double-height void: the LOWER storey's area covers `rect` with its ceiling at `ceil` (absolute); the UPPER storey leaves it uncarved. */
export interface V2Void {
  id: 'V12' | 'V45';
  lower: number;
  upper: number;
  rect: Rect;
  /** Absolute ceiling over the void (the upper storey's gallery ceiling: base(upper) + V2.clear.gallery). */
  ceil: number;
  /** Who it is for (docs / QA). */
  label: string;
}

/** One storey's frame. */
export interface V2StoreyFrame {
  level: number;
  base: number;
  label: string;
  programme: string;
  /** Rooms may be carved inside this rect (with the Kit's 1-cell wall margin), never over a keep-out. */
  envelope: Rect;
  /** The anchors this storey must serve. */
  anchors: V2Anchor[];
  /** The void this storey OWNS (its hall rises through the storey above) / the void it must leave open (a railed well). */
  owns: V2Void | null;
  well: V2Void | null;
  /** Rects (incl. their 1-cell wall) carved or reserved by the spine on this storey: never carve into them. */
  keepOut: Rect[];
}

export interface V2Core {
  id: 'A' | 'B';
  rect: Rect;
  laneW: number;
  from: number;
  to: number;
  /** Landing end per storey ('lo' = the north end). */
  end: Record<number, 'lo' | 'hi'>;
}

export interface BunkerSpine {
  W: number;
  H: number;
  storeys: V2StoreyFrame[];
  cores: V2Core[];
  /** The lift shaft (cells; solid on every storey), its gate side, the car's stops (bottom-up: storey 5 first). */
  shaft: Rect;
  gateSide: Side;
  voids: V2Void[];
  station: {bed: Rect; platform: Rect; arrival: Rect; bulkhead: Rect; lane: Rect; vest: Rect};
}

const grow = (r: Rect, d = 1): Rect => ({x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d});

/** The spine (fixed; the same for every Bunker station of layout version 2). */
export function bunkerSpine(): BunkerSpine {
  const S = V2.station, C = V2.core;
  const W = V2.W, H = V2.H;
  const bed: Rect = {x: S.px0 - TUN, y: S.bedY, w: S.Lp + 2 * TUN, h: SINGLE_BED_CELLS};
  const pY = S.bedY + SINGLE_BED_CELLS;
  const platform: Rect = {x: S.px0, y: pY, w: S.Lp, h: S.Pd};
  const arrival: Rect = {x: 6, y: S.arrivalY0, w: W - 12, h: S.bulkheadY - S.arrivalY0};
  const bulkhead: Rect = {x: 0, y: S.bulkheadY, w: W, h: S.bulkheadRows};
  const lane: Rect = {x: S.laneX, y: S.bulkheadY, w: S.laneW, h: S.bulkheadRows};
  const vest: Rect = {...S.vest};
  const coreA: V2Core = {id: 'A', rect: {x: V2.coreA.x, y: V2.coreA.y, w: C.laneA * 2 + 1, h: C.len}, laneW: C.laneA, from: 0, to: V2_LEVELS - 1, end: {}};
  const coreB: V2Core = {id: 'B', rect: {x: V2.coreB.x, y: V2.coreB.y, w: C.laneB * 2 + 1, h: C.len}, laneW: C.laneB, from: 1, to: V2_LEVELS - 1, end: {}};
  for (let L = coreA.from; L <= coreA.to; L++) coreA.end[L] = (L - coreA.from) % 2 === 0 ? 'lo' : 'hi';
  for (let L = coreB.from; L <= coreB.to; L++) coreB.end[L] = (L - coreB.from) % 2 === 0 ? 'lo' : 'hi';
  const shaft: Rect = {...V2.shaft};
  const voids: V2Void[] = [
    {id: 'V12', lower: 2, upper: 1, rect: {x: 10, y: 78, w: 28, h: 24}, ceil: V2_BASES[1] + V2.clear.gallery, label: 'the habitation commons, open to the entry storey'},
    {id: 'V45', lower: 5, upper: 4, rect: {x: 50, y: 124, w: 42, h: 20}, ceil: V2_BASES[4] + V2.clear.gallery, label: 'the processing core nave, open to the maintenance storey'},
  ];
  const coreDoor = (c: V2Core, L: number): V2Anchor => {
    const dw = c.id === 'A' ? V2.landingDoor.A : V2.landingDoor.B;
    const x = c.rect.x + Math.floor((c.rect.w - dw) / 2);
    const lo = c.end[L] === 'lo';
    const gate: Rect = {x, y: lo ? c.rect.y - 1 : c.rect.y + c.rect.h, w: dw, h: 1};
    const apron: Rect = {x, y: lo ? gate.y - 4 : gate.y + 1, w: dw, h: 4};
    return {id: c.id === 'A' ? 'stairA' : 'stairB', level: L, gate, apron, out: lo ? 'N' : 'S', height: V2.landingDoorH, cut: true};
  };
  // the lift: the shaft rect includes its 1-cell wall ring (solid on every storey; the car's interior is the ring's inside). Its gate
  // is the north wall's inner cells, opened at runtime by the car's volume gate (never cut here); the floor's area over the apron
  // runs right up to that wall (flush with core A's north wall row).
  const liftAnchor = (L: number): V2Anchor => {
    const gate: Rect = {x: shaft.x + 1, y: shaft.y, w: shaft.w - 2, h: 1};
    const apron: Rect = {x: shaft.x - 1, y: shaft.y - V2.liftApronDepth, w: shaft.w + 2, h: V2.liftApronDepth};
    return {id: 'lift', level: L, gate, apron, out: 'N', height: V2.liftDoorH, cut: false};
  };
  const storeys: V2StoreyFrame[] = [];
  for (let L = 0; L < V2_LEVELS; L++) {
    const anchors: V2Anchor[] = [];
    const keepOut: Rect[] = [];
    for (const c of [coreA, coreB]) if (L >= c.from && L <= c.to) { anchors.push(coreDoor(c, L)); keepOut.push(grow(c.rect)); }
    else if (c.id === 'B' && L === 0) keepOut.push(grow(c.rect)); // (the service stair's shaft rises no higher; its rock stays rock)
    anchors.push(liftAnchor(L));
    keepOut.push({...shaft});
    let envelope: Rect = {x: 3, y: 3, w: W - 6, h: H - 6};
    if (L === 0) {
      // the station: the arrival envelope is the floor's; the bed, platform, bulkhead and vestibule are the spine's
      envelope = {...arrival};
      keepOut.push(grow(bed), grow(platform), grow(vest), bulkhead);
      // (the stair head and the lift's top landing open into the spine's vestibule; the floor serves the vault's hall side only, and
      // returns its own openings off the platform: FloorCarveResult.openings)
      anchors.push({id: 'vaultHall', level: 0, gate: {...lane}, apron: {x: lane.x - 6, y: lane.y - 7, w: lane.w + 12, h: 7}, out: 'N', height: 3.1, cut: false});
    }
    const owns = voids.find(v => v.lower === L) ?? null, well = voids.find(v => v.upper === L) ?? null;
    if (well) keepOut.push(well.rect);
    storeys.push({level: L, base: V2_BASES[L], label: V2_STOREY_LABELS[L], programme: V2_PROGRAMMES[L], envelope, anchors, owns, well, keepOut});
  }
  return {W, H, storeys, cores: [coreA, coreB], shaft, gateSide: 'N', voids, station: {bed, platform, arrival, bulkhead, lane, vest}};
}

/** Two rects overlap (cells). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A rect lies inside another (cells). */
export function rectInside(a: Rect, outer: Rect): boolean {
  return a.x >= outer.x && a.y >= outer.y && a.x + a.w <= outer.x + outer.w && a.y + a.h <= outer.y + outer.h;
}
