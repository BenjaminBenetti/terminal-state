// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane BOUNCE): what stops the flashlight's beam in a station besides its fixed
// architecture, for the live flashlight bounce (world/flashBounce.ts FlashOccluders) — the Game-independent part, made from a layout:
//  - the layout's LIVE prop list (`layout.props`: the boxes bullets and the beam's own spot hit — combat/hitscan.ts raycastWorld). It
//    is read anew at every update: the train's shell / door leaves / armour and carried cargo are pushed to and spliced from it at run
//    time, and boxes are edited in place (a prop gone loose, broken, melted or carried off has h = 0; a door leaf follows its leaf);
//  - which of those boxes are GLASS, and so pass the beam (below);
//  - a colour per prop kind (no CPU albedo exists per prop: the kind's damage class stands in);
//  - the characters in the beam's reach, as upright cylinders (setBodies, each frame).
//
// GLASS. A box passes the beam when it is
//  - glazing by kind (FLASH_GLAZING): `shopGlazing` — a shopfront's glazed span in every level that has shopfronts (shot out, the box
//    is cut down to its plinth: that passes too) — whole; `hkRinkBoard` (the hockey store's dasher boards) above its boards;
//  - a pane by the caller's own word (`glass`): the player train's window glass (PlayerTrainRuntime.isGlass — the car's boxes all
//    carry one kind);
//  - a collision-only box (`annexMachine`, not sight-blocking) drawn as nothing but an upright glass pane standing in it
//    (`layout.decor`: the Bunker isolation ward's glazed cubicle fronts and side walls).
// Everything else is its box, also where the model has glass in it: the ticket booth (one box, glazed above its counter on three
// sides), display cases and coolers, vending fronts, screens. Glass that is no prop is not in the list at all: tower and bridge
// windows are solid wall to every ray, glass balustrades and the mall's lift are not boxes.

import type {PropPlacement} from '../gen/props';
import type {ShopBox} from '../gen/storefronts';
import {HK_RINK_BOARD} from '../gen/skyways/stores/hockeyParts';
import {DAMAGE_MATERIALS, propDamageSpec} from '../damage/materials';
import type {FlashBox, FlashOccluders} from './flashBounce';

/** Glazing by prop kind: the height (m, from the box's base) up to which the box is solid; above it the beam passes. 0 = a pane. */
export const FLASH_GLAZING: ReadonlyMap<string, number> = new Map([['shopGlazing', 0], ['hkRinkBoard', HK_RINK_BOARD.boardTop]]);
/** The colour of a prop kind nothing better is known of (a see-through body: what shows is what is in or behind it). */
export const FLASH_PROP_GREY = 0.25;
/** No prop sends back more than this (the palest finish the builder draws is about 0.57). */
const ALBEDO_MAX = 0.6;
/** Characters kept per frame (the nearest), and how far (m) one may stand: the flashlight's cutoff. */
export const FLASH_BODIES_MAX = 32;
export const FLASH_BODY_REACH = 30;
/** A character's cylinder is this tall (m) when its stats name no height. */
const BODY_HEIGHT = 1.7;

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * A linear albedo for a damage class: the mean of its fragment palette, drawn half way to its own grey (the palette holds accent
 * colours too: the class leans warm or cool, it does not tint), capped. Glass: the neutral grey.
 */
function classAlbedo(cls: keyof typeof DAMAGE_MATERIALS): Float32Array {
  if (cls === 'glass') return new Float32Array([FLASH_PROP_GREY, FLASH_PROP_GREY, FLASH_PROP_GREY]);
  const palette = DAMAGE_MATERIALS[cls].palette;
  let r = 0, g = 0, b = 0;
  for (const hex of palette) { r += linear((hex >> 16 & 255) / 255); g += linear((hex >> 8 & 255) / 255); b += linear((hex & 255) / 255); }
  if (!palette.length) return new Float32Array([FLASH_PROP_GREY, FLASH_PROP_GREY, FLASH_PROP_GREY]);
  r /= palette.length; g /= palette.length; b /= palette.length;
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return new Float32Array([r, g, b].map(v => Math.min(ALBEDO_MAX, (v + grey) / 2)));
}

/** The linear albedo the beam's bounce gives a prop kind (cached per kind). */
const kindAlbedo = new Map<string, Float32Array>();
export function flashPropAlbedo(kind: string): Float32Array {
  let a = kindAlbedo.get(kind);
  if (!a) kindAlbedo.set(kind, (a = classAlbedo(propDamageSpec(kind).cls)));
  return a;
}

/** What flashOccluders needs of a layout. */
export interface FlashOccluderLayout { props: PropPlacement[]; decor?: readonly ShopBox[] }
/** What setBodies needs of a character (ai/creatureArchetypes.ts EnemyActor has it). */
export interface FlashBodyActor {
  brain: {x: number; y: number; z: number; alive: boolean; climbing?: boolean; stats: {radius: number; height?: number}};
  ragdolled: boolean;
  placesRoot?: boolean;
}

/**
 * The collision-only boxes of a layout that are drawn as nothing but an upright pane of glass: a decor pane (thin, at least 1.2 m
 * tall) stands inside the box's footprint, runs its whole length and reaches from its foot to its top.
 */
function decorPanes(layout: FlashOccluderLayout): Set<FlashBox> {
  const out = new Set<FlashBox>();
  const panes = (layout.decor ?? []).filter(b => b.m === 'glassShopfront' && b.y1 - b.y0 >= 1.2 && Math.min(b.x1 - b.x0, b.z1 - b.z0) <= 0.1);
  if (!panes.length) return out;
  for (const p of layout.props) {
    if (p.kind !== 'annexMachine' || p.blocksSight) continue;
    for (const b of panes) {
      if (b.x0 < p.x - p.hx - 0.02 || b.x1 > p.x + p.hx + 0.02 || b.z0 < p.z - p.hz - 0.02 || b.z1 > p.z + p.hz + 0.02) continue;
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
      const length = alongX ? b.x1 - b.x0 : b.z1 - b.z0, boxLength = 2 * (alongX ? p.hx : p.hz), boxThick = 2 * (alongX ? p.hz : p.hx);
      if (length >= boxLength - 0.1 && boxThick <= 0.6 && b.y1 >= p.y + p.h - 0.1 && b.y0 <= p.y + 0.2) { out.add(p); break; }
    }
  }
  return out;
}

/** A station's beam occluders (see the module doc). One per built station: hand it to FlashBounce.occlude, drop it with the station. */
export class StationFlashOccluders implements FlashOccluders {
  solidH = 0.5;
  readonly bodies = new Float32Array(FLASH_BODIES_MAX * 5);
  bodyCount = 0;
  readonly bodyAlbedo: Float32Array = classAlbedo('cloth');
  /** The collision-only boxes drawn as a glass pane (found once: they are generated, never pushed later). */
  readonly panes: ReadonlySet<FlashBox>;
  private readonly bodyDist = new Float32Array(FLASH_BODIES_MAX);

  constructor(private readonly layout: FlashOccluderLayout, private readonly glass: ((box: PropPlacement) => boolean) | null = null) {
    this.panes = decorPanes(layout);
  }

  /** The layout's list as it is now (never a copy: a list the layout swaps for another is followed too). */
  get props(): readonly FlashBox[] {
    return this.layout.props;
  }

  stops(box: FlashBox): boolean {
    const p = box as PropPlacement, base = FLASH_GLAZING.get(p.kind);
    if (base !== undefined) {
      if (!(base > 0)) return false;
      this.solidH = base;
      return true;
    }
    if (this.panes.has(box) || (this.glass !== null && this.glass(p))) return false;
    this.solidH = p.h;
    return true;
  }

  albedo(box: FlashBox): Float32Array {
    return flashPropAlbedo((box as PropPlacement).kind);
  }

  /**
   * This frame's characters: the living, standing ones within FLASH_BODY_REACH of `eye` (the nearest FLASH_BODIES_MAX of them), each
   * an upright cylinder from its feet. A dead or ragdolled body and one on a wall or a ceiling are left out. Allocation-free.
   */
  setBodies(actors: readonly FlashBodyActor[], eye: {x: number; z: number}): void {
    const B = this.bodies, D = this.bodyDist, reach2 = FLASH_BODY_REACH * FLASH_BODY_REACH;
    let n = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i], b = a.brain;
      if (!b.alive || a.ragdolled || (a.placesRoot === true && b.climbing === true)) continue;
      const dx = b.x - eye.x, dz = b.z - eye.z, d2 = dx * dx + dz * dz;
      if (d2 > reach2) continue;
      let at = n;
      if (n === FLASH_BODIES_MAX) {
        // full: it takes the farthest one's place when it is nearer
        at = 0;
        for (let q = 1; q < n; q++) if (D[q] > D[at]) at = q;
        if (!(d2 < D[at])) continue;
      } else n++;
      const s = b.stats, h = s.height;
      D[at] = d2;
      B[at * 5] = b.x; B[at * 5 + 1] = b.z; B[at * 5 + 2] = s.radius; B[at * 5 + 3] = b.y; B[at * 5 + 4] = b.y + (h !== undefined && h > 0 ? h : BODY_HEIGHT);
    }
    this.bodyCount = n;
  }
}

/**
 * The beam occluders of a station layout: its live prop boxes, its glass, a colour per prop kind and room for this frame's
 * characters. `glass`: boxes that are glass by the caller's own knowledge (the player train's windows).
 */
export function flashOccluders(layout: FlashOccluderLayout, glass: ((box: PropPlacement) => boolean) | null = null): StationFlashOccluders {
  return new StationFlashOccluders(layout, glass);
}
