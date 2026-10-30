// Task office-overhaul-20261030 (Studio Beta): shared pure-data contracts of the office overhaul — company tenants, the roof
// storey and the high-capacity transit connection (escalators). Types only; written by the primary, read by every lane.
// Producers: lane TENANTS (tenants), lane STRUCT (roof, transit). Consumers: ARCH (materials / palette / fog), LIFT, render.

/** Company ids of the 20-company tenant pool (gen/office/companies.ts holds the definitions). */
export type CompanyId =
  | 'bubblr' | 'pixelforge' | 'halden' | 'crestmark' | 'verdant' | 'arcline' | 'metro9' | 'ember' | 'stride' | 'wonderbox'
  | 'lowtide' | 'calloway' | 'ardent' | 'tidewater' | 'nimbus' | 'ironclad' | 'pemberton' | 'pawprint' | 'goldencrust' | 'orbital';

/** Linear-ish sRGB hex colours (0xRRGGBB) a tenant's spaces are finished in. */
export interface TenantPalette {
  /** Main wall paint. */
  wall: number;
  /** Accent / feature wall (reception logo wall, one wall per room). */
  accent: number;
  /** Carpet / floor tint (multiplied over the carpet texture). */
  floor: number;
  /** Trim: door frames, skirting, signage plates. */
  trim: number;
  /** Signage text / logo colour. */
  sign: number;
}

/** Wall / floor finish family of a tenant (lane ARCH maps these to materials; all office, never the station's tile / block). */
export type TenantFinish = 'corporate' | 'warm-wood' | 'industrial' | 'clinical' | 'creative' | 'luxury';

/** One company floor of the tower (floors 2..8; the lobby, floor 1, is neutral and never a tenant). */
export interface TenantFloor {
  floor: number;
  company: CompanyId;
  /** Display name, e.g. "Bubblr Gum Co.". */
  name: string;
  /** Short tagline / division shown on the reception sign ("Confectionery · Brand HQ"). */
  tagline: string;
  palette: TenantPalette;
  finish: TenantFinish;
  /** Index of this floor within the company's run of floors (0 = its first / reception floor), and the run length (1 or 2). */
  part: number;
  parts: number;
}

/** Roof storey (layout level = OFFICE_ROOF_LEVEL): open sky, parapet, reached by an access ladder from the top office floor. */
export interface RoofInfo {
  level: number;
  /** Roof deck y (absolute) = top floor + floorHeight. */
  baseY: number;
  /** Parapet height above the deck (m). */
  parapet: number;
  /** The access ladder: bottom (top office floor) and top (roof hatch) stand points, the hatch opening rect (world m). */
  ladder: {
    bottom: {x: number; y: number; z: number};
    top: {x: number; y: number; z: number};
    /** Ladder face direction (yaw the climber faces while on it). */
    yaw: number;
    hatch: {x0: number; z0: number; x1: number; z1: number};
    /** layout.traversal.ladders index / layout.levelLinks id of the climb (STRUCT decides the exact representation). */
    link?: number;
  };
  /** Rooftop structures the render dresses (HVAC, water tower, dish, stair/hatch housing): world footprint + yaw. */
  structures: {kind: string; x: number; z: number; yaw: number}[];
  /**
   * Task office-interactions-layout-20261030 (lane ROOF): the roof reward cache (gen/office/roof.ts placeRoofReward) — the holder's
   * kind, loot key, pose and the anchor it is tucked against. Absent: the level's loot profile has no roof reward; null: no spot
   * was found (roofIssues rejects the attempt).
   */
  reward?: {kind: string; key: string; x: number; y: number; z: number; rot: number; anchor: string} | null;
  /**
   * Task gas-mask-roof-feedback-20261030 (item 10): the roof FIND (gen/office/roof.ts placeRoofFind) — the item laid on the deck
   * (a non-starter weapon + its own ammo box, or a gear piece), as placed: the two layout pickups carry `reward: key`. Absent: the
   * level's loot profile has no roof find; null: no verified spot was found (roofIssues rejects the attempt).
   */
  find?: {key: string; itemId: string; x: number; y: number; z: number; ammo: {itemId: string; count: number; x: number; z: number} | null} | null;
}

/** One escalator of the station <-> lobby transit hall (lane STRUCT carves it as a stair run; the render adds the escalator). */
export interface EscalatorInfo {
  /** layout.traversal.stairs flight ids the escalator dresses (walkable as stairs: power is out, the steps are stopped). */
  flights: number[];
  lower: {x: number; y: number; z: number};
  upper: {x: number; y: number; z: number};
  /** Inner width between balustrades (m). */
  width: number;
  /** Rising direction yaw. */
  yaw: number;
}

/** The high-capacity station <-> lobby connection (replaces the single narrow stair core). */
export interface TransitInfo {
  /** Broad fixed stair runs (layout.levelLinks ids). */
  stairLinks: number[];
  escalators: EscalatorInfo[];
  /** Concourse areas on the station level and the lobby level (layout.areas ids). */
  lowerHall: number;
  upperHall: number;
}
