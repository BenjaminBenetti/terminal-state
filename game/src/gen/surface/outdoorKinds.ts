// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's OUTDOOR PROP placement — the district's street / checkpoint
// / wreck props placed on real street-level floors (quarter-turn yaws, no overlaps, nothing in a doorway front, the truck's box or a
// junction's through lanes).
//
// Lane KIT owns the new kinds (gen/surface/kinds.ts, the PropKind union, OPENABLE_AUDIT / physics classification, visuals). Until a kind
// is in PROP_DEFS this module plans it with the provisional dims below (SR_DIMS: the kinds' published approximate sizes; wrecks = the
// measured wreck GLBs) and keeps the placement PENDING: it occupies its cells for every later placement (so the layout around it is the
// same either way), but nothing is written to layout.props / grid.blocked (no invisible collider without its model). Once KIT's kind is
// defined, the SAME placement is emitted as an ordinary prop with KIT's real dims (PROP_DEFS wins). The merge is therefore just KIT's
// own union line + defs; nothing here changes.

import {CELL, FLOOR} from '../grid';
import type {Grid} from '../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import {cellsOfBox} from '../placeKit';

/**
 * Lane KIT's kinds (names fixed by the lead) with w (local X) x d (local Z, the front) x h (m) = KIT's published PropDefs (its report's
 * kind table; wrecks at their catalogue fit), so the merged defs leave every placement unchanged. Wrecks: nose toward +X.
 */
export const SR_DIMS = {
  srSandbagWall: {w: 1.6, d: 0.6, h: 0.9, sight: false},
  srJerseyBarrier: {w: 2.0, d: 0.6, h: 0.81, sight: false},
  srTrafficCone: {w: 0.36, d: 0.36, h: 0.7, sight: false},
  srFireHydrant: {w: 0.4, d: 0.4, h: 0.8, sight: false},
  srStreetLamp: {w: 0.4, d: 0.4, h: 7.5, sight: false},
  srTrafficSignal: {w: 0.5, d: 0.5, h: 5.5, sight: false},
  srStreetSign: {w: 0.3, d: 0.3, h: 3.0, sight: false},
  srChainFence: {w: 3.0, d: 0.2, h: 2.2, sight: false},
  srBollard: {w: 0.25, d: 0.25, h: 1.0, sight: false},
  srMapTable: {w: 2.0, d: 1.2, h: 0.95, sight: false},
  srFieldRadio: {w: 0.45, d: 0.3, h: 0.3, sight: false},
  srCot: {w: 1.9, d: 0.7, h: 0.45, sight: false},
  srMilitaryCrate: {w: 1.2, d: 0.6, h: 0.55, sight: false},
  srWreckSedanStripped: {w: 4.6, d: 1.8254, h: 1.3667, sight: false},
  srWreckSedanRust: {w: 4.75, d: 2.0531, h: 1.6254, sight: false},
  srWreckSedanBurnt: {w: 4.75, d: 1.9993, h: 1.4828, sight: false},
  srWreckSuv: {w: 4.9, d: 2.1385, h: 1.6602, sight: false},
  srWreckArmyTruck: {w: 7.6, d: 2.8666, h: 3.2591, sight: true},
  srWreckCar: {w: 4.6, d: 1.7809, h: 1.3055, sight: false},
  srWreckBus: {w: 9.36, d: 2.9337, h: 3.3865, sight: true},
} as const;

/**
 * Street-sign variant (mirrors lane KIT's srStreetSignVariant in gen/surface/kinds.ts — one formula): blade A (local X) names
 * SurfaceStreet `a`, blade B (local Z) names street `b` (-1 / absent = no blade B).
 */
export const streetSignVariant = (a: number, b?: number): number => (a + 1) + (b === undefined || b < 0 ? 0 : (b + 1) * 4096);
export type SrKind = keyof typeof SR_DIMS;
export const SR_KINDS = Object.keys(SR_DIMS) as SrKind[];
export const SR_CAR_WRECKS: readonly SrKind[] = ['srWreckSedanStripped', 'srWreckSedanRust', 'srWreckSedanBurnt', 'srWreckSuv', 'srWreckCar'];

/** Is the kind a defined PropKind (in PROP_DEFS) right now? */
export const isDefinedKind = (k: string): k is PropKind => Object.prototype.hasOwnProperty.call(PROP_DEFS, k);

/** A kind's dims: KIT's / the catalogue's real def when defined, else the provisional table. */
export function kindDims(kind: string): {w: number; d: number; h: number; sight: boolean} | null {
  if (isDefinedKind(kind)) { const d = PROP_DEFS[kind]; return {w: d.w, d: d.d, h: d.h, sight: d.blocksSight}; }
  const s = (SR_DIMS as Record<string, {w: number; d: number; h: number; sight: boolean}>)[kind];
  return s ?? null;
}

/** The world AABB half extents of a kind at a quarter-turn yaw. */
export function halfExtents(kind: string, rot: number): {hx: number; hz: number} | null {
  const d = kindDims(kind);
  if (!d) return null;
  const q = Math.round(rot / (Math.PI / 2)) & 1;
  return q ? {hx: d.d / 2, hz: d.w / 2} : {hx: d.w / 2, hz: d.d / 2};
}

/** Every outdoor placement as planned (pending ones included: `index` = -1 until the kind is defined). */
export interface PlannedProp {
  kind: string;
  x: number; z: number; y: number; rot: number;
  hx: number; hz: number; h: number;
  area: number;
  variant: number;
  /** Index in layout.props, or -1 while the kind is pending. */
  index: number;
  /** What it is for (QA: 'checkpoint', 'blocked', 'parked', 'furniture', …). */
  role: string;
}

export interface PlaceOpts {
  /** Required area (else any of the allowed outdoor areas). */
  area?: number;
  /** Floor heights under the footprint may differ by this much (m; default 0.02: one flat surface). */
  floorTol?: number;
  variant?: number;
  /** Ignore the reserve mask (but never another prop). */
  ignoreReserve?: boolean;
  /** Wall-mounted (does not block walking) and its render lift. */
  mounted?: boolean;
  lift?: number;
  role?: string;
}

export class OutdoorProps {
  /** Level-0 cells taken by a placed / pending prop. */
  readonly taken: Uint8Array;
  /** Level-0 cells kept clear (doorway fronts, the truck's box, the portal approach, through lanes). */
  readonly reserve: Uint8Array;
  readonly planned: PlannedProp[] = [];
  /** Placements that did not fit (QA) and the last reason. */
  misses = 0;
  why = '';
  /** QA: every miss of these roles (kind, position, reason). */
  readonly missLog: {kind: string; x: number; z: number; role: string; why: string}[] = [];
  constructor(readonly g: Grid, readonly props: PropPlacement[], readonly outdoor: ReadonlySet<number>) {
    this.taken = new Uint8Array(g.w * g.h);
    this.reserve = new Uint8Array(g.w * g.h);
  }

  reserveRect(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.g;
    for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) this.reserve[g.idx(x, y)] = 1;
  }
  /** Reserve a world box (m). */
  reserveBox(x0: number, z0: number, x1: number, z1: number): void {
    this.reserveRect(Math.floor(x0 / CELL), Math.floor(z0 / CELL), Math.ceil(x1 / CELL), Math.ceil(z1 / CELL));
  }
  /** Mark cells taken (a rubble mound: no prop stands on it). */
  takeRect(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.g;
    for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) this.taken[g.idx(x, y)] = 1;
  }
  /** Any cell of the rect reserved or taken? */
  busy(x0: number, y0: number, x1: number, y1: number): boolean {
    const g = this.g;
    for (let y = Math.max(0, y0); y < Math.min(g.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(g.w, x1); x++) { const i = g.idx(x, y); if (this.reserve[i] || this.taken[i]) return true; }
    return false;
  }

  /** Can the kind stand at (x, z, rot)? Returns its floor height (the centre cell's) or null. */
  fits(kind: string, x: number, z: number, rot: number, o: PlaceOpts = {}): number | null {
    const e = halfExtents(kind, rot);
    if (!e) return null;
    const g = this.g;
    const [x0, y0, x1, y1] = cellsOfBox(x, z, e.hx, e.hz);
    const no = (why: string) => { this.why = why; return null; };
    if (x0 < 0 || y0 < 0 || x1 >= g.w || y1 >= g.h) return no('bounds');
    const ci = g.idx(Math.floor(x / CELL), Math.floor(z / CELL));
    if (g.cells[ci] !== FLOOR) return no('centre');
    const fy = g.floor[ci], tol = o.floorTol ?? 0.02;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const i = g.idx(xx, y);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return no('wall');
      if (this.taken[i] || g.blocked[i]) return no('taken');
      if (!o.ignoreReserve && this.reserve[i]) return no('reserved');
      if (o.area !== undefined ? g.area[i] !== o.area && !this.outdoor.has(g.area[i]) : !this.outdoor.has(g.area[i])) return no('area');
      if (o.area !== undefined && g.area[ci] !== o.area) return no('area');
      if (Math.abs(g.floor[i] - fy) > tol) return no('floor');
    }
    return fy;
  }

  /** Places the kind (null: it does not fit). Pending kinds take their cells but are not emitted. */
  place(kind: string, x: number, z: number, rot: number, o: PlaceOpts = {}): PlannedProp | null {
    const fy = this.fits(kind, x, z, rot, o);
    if (fy === null) {
      this.misses++;
      if (o.role?.startsWith('checkpoint')) this.missLog.push({kind, x, z, role: o.role, why: this.why});
      return null;
    }
    const e = halfExtents(kind, rot)!, d = kindDims(kind)!;
    const g = this.g;
    const [x0, y0, x1, y1] = cellsOfBox(x, z, e.hx, e.hz);
    let index = -1;
    const area = g.area[g.idx(Math.floor(x / CELL), Math.floor(z / CELL))];
    if (isDefinedKind(kind)) {
      index = this.props.length;
      const p: PropPlacement = {kind, x, z, y: fy, rot, area, hx: e.hx, hz: e.hz, h: d.h, blocksSight: d.sight, variant: o.variant ?? 0, level: 0};
      if (o.mounted) { p.mounted = true; if (o.lift) p.lift = o.lift; }
      this.props.push(p);
    }
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const i = g.idx(xx, y);
      this.taken[i] = 1;
      if (index >= 0 && !o.mounted) { g.blocked[i] = 1; if (d.sight) g.sightBlocked[i] = 1; }
    }
    const pp: PlannedProp = {kind, x, z, y: fy, rot, hx: e.hx, hz: e.hz, h: d.h, area, variant: o.variant ?? 0, index, role: o.role ?? ''};
    this.planned.push(pp);
    return pp;
  }
}

/** Quarter-turn prop yaw whose FRONT (+Z local) faces the given side's outward direction: N = -Z, S = +Z, W = -X, E = +X. */
export const FACE_ROT = {N: Math.PI, S: 0, W: -Math.PI / 2, E: Math.PI / 2} as const;
