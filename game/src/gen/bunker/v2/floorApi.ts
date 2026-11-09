// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — the FLOOR CONTRACT between the lead's pipeline (gen/bunker/v2/index.ts)
// and the six floor modules (gen/bunker/v2/floor0.ts … floor5.ts, one designer each). Pure types + small helpers.
//
// A floor module owns ONE storey's character: its programme, its spatial layout (open halls, galleries, constrained rooms, corridors),
// its dressing and its share of the hazards. It works inside its storey's frame (gen/bunker/v2/spine.ts: the envelope, the keep-outs,
// the anchors it must serve, the void it owns or the well it must leave open) and talks to the shared Kit only through FloorCarveCtx.
//
// Pipeline (per attempt): spine carve (bed / platform / vestibule / cores / lift shaft) → floor.carve() for storeys 0..5 → anchor doors
// cut into the areas over the aprons → crop / links / apertures / rails → objectives (vault door, generators in the floors' generator
// rooms, the core cluster in floor 5's core hall) → hazards from the floors' declarations → ONE station dresser pass → floor.dress()
// for storeys 0..5 → lift landings → enemies / supplies / weapon finds (shared) → lighting → floor.light() → traversal → record → checks.

import type {Rng} from '../../../core/rng';
import type {Kit} from '../../stationKit';
import type {Area, AreaKind, AreaRole, Door, Rect, RoomType, Side, StationLayout} from '../../stationTypes';
import type {BunkerSpine, V2StoreyFrame} from './spine';

/** Gas leak strength class (gen/bunker/hazards.ts GAS_STRENGTH ranges: weak 0.34-0.42, medium 0.50-0.62, strong 0.86-0.95). */
export type V2GasClass = 'weak' | 'medium' | 'strong';

export interface FloorAreaOpts {
  label?: string;
  /** Default false (shelter rooms are back-of-house); true = public finish (terrazzo / tiles). */
  publicSpace?: boolean;
  role?: AreaRole;
  /** gen/purposes.ts purpose id (the station dresser's furniture rules + the loot tables read it). */
  purpose?: string;
  /** No loose FLOOR supplies here (its loot is on shelves / counters / in containers). */
  noFloorLoot?: boolean;
}

/** What a floor module sees while carving (one storey). */
export interface FloorCarveCtx {
  readonly k: Kit;
  readonly spine: BunkerSpine;
  readonly frame: V2StoreyFrame;
  readonly level: number;
  /** Absolute floor of this storey (world y). */
  readonly base: number;
  readonly rng: Rng;
  /**
   * Adds an area of this storey: `clear` is the clear height ABOVE THIS STOREY'S FLOOR (m). The rect must be free rock with a 1-cell
   * wall margin (Kit.rectFree on this level), inside the envelope and off every keep-out; returns null otherwise (nothing carved).
   */
  room(r: Rect, kind: AreaKind, type: RoomType, clear: number, parent: number, opts?: FloorAreaOpts): Area | null;
  /** An opening between two of this storey's areas through their shared 1-cell wall (`height` above the storey floor). */
  door(gap: Rect, a: Area, b: Area, height: number, arch?: boolean): Door;
  /** Kit.wallGap + door in one: a centred / random gap of `width` cells in the shared wall of a and b (null when they share none). */
  connect(a: Area, b: Area, width: number, height: number, pick?: 'mid' | 'rand' | 'lo' | 'hi' | number): Door | null;
  /** The rect is free rock (with the 1-cell margin) on this storey, inside the envelope and off every keep-out. */
  free(r: Rect): boolean;
}

/** What a floor module returns from carve(). */
export interface FloorCarveResult {
  /** The floor's named areas (its own keys; QA, docs and its dress() read them). */
  areas: Record<string, number>;
  /** Storeys 2-4: the generator's plant room (the pipeline stands the 5.6 x 1.7 m generator back to a wall with 2 m clear in front). */
  generator?: {area: number; label: string; walls?: Side[]};
  /** Storey 5: the hall holding the core cluster (6.0 x 2.2 m against a wall, 3 m clear in front). */
  core?: {area: number; walls?: Side[]};
  /** Storey 0: the openings from the platform into the floor's arrival areas (the start stands in front of the one nearest the vault). */
  openings?: Rect[];
  /** Gas leaks this floor proposes (the pipeline keeps 3-6 over the level, at least one strong; a strong one only in a dead-end room). */
  gas?: {area: number; strength: V2GasClass}[];
  /** Damp / water-damaged areas (the Strainer's habitat; storey 4 is the damp storey: level role 'lower'). */
  damp?: number[];
  /** Aged / damaged areas (dark or sputtering lights, fallen ceiling panels kept off the doorways). */
  aged?: number[];
}

/** What a floor module sees while dressing (after the station dresser ran over the whole level). */
export interface FloorDressCtx {
  readonly layout: StationLayout;
  readonly spine: BunkerSpine;
  readonly frame: V2StoreyFrame;
  readonly level: number;
  readonly base: number;
  readonly rng: Rng;
  /** The floor's carve result (area ids are layout.areas ids). */
  readonly carved: FloorCarveResult;
  /** Cells (this storey's grid indices) that must stay clear: anchor aprons, the objectives' fronts, the vault threshold. */
  readonly held: ReadonlySet<number>;
}

export interface BunkerFloorModule {
  level: number;
  /** One-line identity (docs / QA). */
  title: string;
  /** Carve the storey; null = this attempt does not fit (the pipeline retries the level with a new fork). */
  carve(ctx: FloorCarveCtx): FloorCarveResult | null;
  /** Bespoke dressing after the station dresser (props / decor / signs / lights on the floor's own areas). */
  dress?(ctx: FloorDressCtx): void;
}
