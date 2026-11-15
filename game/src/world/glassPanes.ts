// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the station's FLAT VERTICAL GLASS as data — the registry the live
// glass mirror (render/glassMirror.ts) picks its plane from.
//
// Source of truth: the same boxes the renderer draws, never the meshes.
//  - storefront glazing: gen/storefronts.ts storefrontParts(layout, sf, {anchorSign: true}) — exactly the call
//    world/storefrontBuilder.ts merges into the `shopfront-glassShopfront` mesh — its `glassShopfront` boxes (one per glazing span);
//  - station decor (layout.decor) boxes of that material, when a generator places a free-standing pane;
//  - the ticket booth: gen/propShapes.ts propShape('booth') `glass` parts, placed by the prop's quarter-turn yaw exactly as
//    world/builder.ts addProceduralProp instances them (`prop-booth-glass`).
// Only upright rectangles count (a thin box along x or z; a display case's top pane, a sloped pane or a model's own glass do not:
// those keep the cached probes).
//
// PLANES: panes of the same axis, the same level slot and the same coordinate (within MERGE_EPS) are one plane — a hall's whole
// glazed wall is one mirror, however many bays and spans it has. A plane keeps its panes: a mirror only draws for the panes that
// are still there.
//
// SHOT-OUT PANES: damage/propDamage.ts breaks glazing per blocker prop (one `shopGlazing` prop per span, one booth per booth) —
// the whole span's glass goes at once. Each pane names its prop (the same rule the damage system cuts triangles with: the pane's
// centre inside the prop's box), and `pane.intact()` asks, per call and without allocating:
//  - the layout itself: a shattered `shopGlazing` blocker is cut down to its plinth (prop.h <= 0.3; propDamage breakGlass);
//  - the caller's `broken(prop)` (the Game passes the damage system's state: glass broken, prop broken or dissolved).
//
// Deterministic (stable order and ids from the layout alone: no clock, no RNG, nothing written to the layout or the save); built
// once per station; nothing here runs per frame except intact().

import {PROP_DEFS, type PropPlacement} from '../gen/props';
import {propShape} from '../gen/propShapes';
import {storefrontParts, type ShopBox} from '../gen/storefronts';
import type {StationLayout} from '../gen/station';
import {levelOf, stationLevels} from './levelGeometry';

/** Panes whose plane coordinates differ by at most this (m) are one plane. */
export const GLASS_MERGE_EPS = 0.015;
/** A glass box at most this thick (m) along x or z is a pane ... */
export const GLASS_MAX_THICKNESS = 0.06;
/** ... when it is at least this wide and this tall (m). */
export const GLASS_MIN_SIDE = 0.3;
/** A shattered `shopGlazing` blocker is cut down to this height (damage/propDamage.ts breakGlass). */
export const GLAZING_BROKEN_H = 0.3;

export type GlassSource = 'storefront' | 'decor' | 'booth';

/** One glass rectangle of a plane. */
export class GlassPane {
  constructor(
    /** Extent along the plane (m): world z for an 'x' plane, world x for a 'z' plane. */
    readonly u0: number, readonly u1: number,
    readonly y0: number, readonly y1: number,
    /** The pane's own mid-thickness coordinate along the plane's axis and half its thickness (m). */
    readonly coord: number, readonly half: number,
    readonly source: GlassSource,
    /** The prop whose glass state decides `intact` (null: nothing can break this pane). */
    readonly prop: PropPlacement | null,
    private readonly broken: ((prop: PropPlacement) => boolean) | null,
  ) {}

  /** Still there (not shot out, its holder not broken / dissolved). Cheap: called per frame for the panes in view. */
  intact(): boolean {
    const p = this.prop;
    if (!p) return true;
    if (p.kind === 'shopGlazing' && p.h <= GLAZING_BROKEN_H + 1e-6) return false;
    return !(this.broken !== null && this.broken(p));
  }
}

/**
 * A flat vertical glass plane. `axis` is the axis of its NORMAL: an 'x' plane lies at world x = coord and runs along z (u = z);
 * a 'z' plane lies at world z = coord and runs along x (u = x). `u0..u1`, `y0..y1`: the box around its panes. `half`: half the
 * glass thickness (the two faces are at coord - half and coord + half). `slot`: index of its level in stationLevels(layout).
 */
export interface GlassPlane {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly coord: number;
  readonly half: number;
  readonly u0: number; readonly u1: number;
  readonly y0: number; readonly y1: number;
  readonly slot: number;
  readonly panes: readonly GlassPane[];
}

export interface GlassPlaneOptions {
  /** The run-time glass state of a prop (the damage system's): true = its glass is gone. Asked by GlassPane.intact(). */
  broken?: (prop: PropPlacement) => boolean;
}

interface RawPane { axis: 'x' | 'z'; coord: number; half: number; u0: number; u1: number; y0: number; y1: number; slot: number; source: GlassSource; prop: PropPlacement | null }

/** A world box as an upright pane (null: not thin along exactly one horizontal axis, or too small). */
function paneOfBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, slot: number, source: GlassSource, prop: PropPlacement | null): RawPane | null {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  if (!(dy >= GLASS_MIN_SIDE)) return null;
  const thinX = dx <= GLASS_MAX_THICKNESS, thinZ = dz <= GLASS_MAX_THICKNESS;
  if (thinX === thinZ) return null;
  if (thinX) return dz >= GLASS_MIN_SIDE ? {axis: 'x', coord: (x0 + x1) / 2, half: dx / 2, u0: z0, u1: z1, y0, y1, slot, source, prop} : null;
  return dx >= GLASS_MIN_SIDE ? {axis: 'z', coord: (z0 + z1) / 2, half: dz / 2, u0: x0, u1: x1, y0, y1, slot, source, prop} : null;
}

/** The prop of `list` whose footprint holds (x, z) (the damage system's rule: centre inside the box, 12 mm slack). */
function propAt(list: readonly PropPlacement[], x: number, z: number): PropPlacement | null {
  const eps = 0.012;
  for (const p of list) if (x >= p.x - p.hx - eps && x <= p.x + p.hx + eps && z >= p.z - p.hz - eps && z <= p.z + p.hz + eps) return p;
  return null;
}

/** The booth's glass parts in world space (the prop's yaw is a quarter turn; addProceduralProp's transform). */
export function boothGlassBoxes(p: PropPlacement): {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number}[] {
  const out: {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number}[] = [];
  const q = ((Math.round(p.rot / (Math.PI / 2)) % 4) + 4) % 4;
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  for (const part of propShape('booth') ?? []) {
    if (part.m !== 'glass' || part.rx) continue;
    const [sx, sy, sz] = part.s, [px, py, pz] = part.p;
    // rotation about +y by rot: x' = x cos + z sin, z' = -x sin + z cos
    const cx = p.x + px * c + pz * s, cz = p.z - px * s + pz * c;
    const hx = (q & 1 ? sz : sx) / 2, hz = (q & 1 ? sx : sz) / 2;
    out.push({x0: cx - hx, y0: p.y + py - sy / 2, z0: cz - hz, x1: cx + hx, y1: p.y + py + sy / 2, z1: cz + hz});
  }
  return out;
}

/**
 * Every flat vertical glass plane of a station (see the module doc), in a stable order: by level slot, axis ('x' first), then
 * coordinate; a plane's panes by u0, then y0.
 */
export function collectGlassPlanes(layout: StationLayout, opts: GlassPlaneOptions = {}): GlassPlane[] {
  const levels = stationLevels(layout);
  const slotOf = (o: object | null | undefined): number => {
    const id = levelOf(o);
    const i = levels.findIndex(l => l.id === id);
    return i >= 0 ? i : 0;
  };
  const broken = opts.broken ?? null;
  const raw: RawPane[] = [];
  const glazing = layout.props.filter(p => p.kind === 'shopGlazing');

  // storefront glazing: one box per glazed span; its blocker prop carries the span's glass state
  for (const sf of layout.storefronts ?? []) {
    let own: PropPlacement[] | null = null;
    for (const b of storefrontParts(layout, sf, {anchorSign: true}).boxes) {
      if (b.m !== 'glassShopfront') continue;
      own ??= glazing.filter(p => p.shop === sf.id);
      const r = paneOfBox(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, slotOf(sf), 'storefront', propAt(own, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));
      if (r) raw.push(r);
    }
  }
  // free-standing decor panes
  for (const b of (layout.decor ?? []) as readonly ShopBox[]) {
    if (b.m !== 'glassShopfront') continue;
    const r = paneOfBox(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, 0, 'decor', propAt(glazing, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));
    if (r) raw.push(r);
  }
  // ticket booths
  if (PROP_DEFS.booth) {
    for (const p of layout.props) {
      if (p.kind !== 'booth') continue;
      for (const b of boothGlassBoxes(p)) {
        const r = paneOfBox(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, slotOf(p), 'booth', p);
        if (r) raw.push(r);
      }
    }
  }

  // merge: same slot, same axis, coordinates within GLASS_MERGE_EPS of the group's first
  raw.sort((a, b) => a.slot - b.slot || (a.axis === b.axis ? 0 : a.axis === 'x' ? -1 : 1) || a.coord - b.coord || a.u0 - b.u0 || a.y0 - b.y0 || a.u1 - b.u1);
  const planes: GlassPlane[] = [];
  for (let i = 0; i < raw.length;) {
    let j = i + 1;
    while (j < raw.length && raw[j].slot === raw[i].slot && raw[j].axis === raw[i].axis && raw[j].coord - raw[i].coord <= GLASS_MERGE_EPS) j++;
    const group = raw.slice(i, j).sort((a, b) => a.u0 - b.u0 || a.y0 - b.y0 || a.u1 - b.u1 || a.coord - b.coord);
    let coord = 0, half = 0, u0 = Infinity, u1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const g of group) {
      coord += g.coord / group.length; half = Math.max(half, g.half);
      u0 = Math.min(u0, g.u0); u1 = Math.max(u1, g.u1); y0 = Math.min(y0, g.y0); y1 = Math.max(y1, g.y1);
    }
    const first = raw[i];
    planes.push({
      id: `${first.axis}${first.slot}:${coord.toFixed(3)}`, axis: first.axis, coord, half, u0, u1, y0, y1, slot: first.slot,
      panes: group.map(g => new GlassPane(g.u0, g.u1, g.y0, g.y1, g.coord, g.half, g.source, g.prop, broken)),
    });
    i = j;
  }
  // (two planes may share an id only when two groups round to the same millimetre: number them apart, in order)
  const seen = new Map<string, number>();
  return planes.map(p => {
    const k = seen.get(p.id) ?? 0;
    seen.set(p.id, k + 1);
    return k ? {...p, id: `${p.id}#${k}`} : p;
  });
}
