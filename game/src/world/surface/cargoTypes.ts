// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): what the bulky cargo needs from THE TRUCK (lane TRUCK: the
// vehicle controller, world/skywaysCar*.ts). User: "Give the truck finite, usable storage compartments and secure physical attachment
// points for bulky salvage/upgrade cargo. Preserve each item's identity, contents, condition and pose, truck state and sole cargo
// ownership through transfer, travel, save and re-entry."
//
// Split of the work: TRUCK owns the truck (its body, pose, record, the small-item lockers); CARGO owns the bulky train units (chests,
// devices, upgrade kits) secured to it (world/surface/cargo.ts, world/trainEquipment.ts mode 'mount'). The seam is ONE method on the truck
// side — `truckAttachPoints()` — read fresh every frame something is secured: CARGO places each secured unit at its point's world pose,
// so it follows the truck rigidly with no physics and no second visual. CARGO keeps its own records (which unit is on which point, lane
// 'surface.cargo'): the truck never stores a unit, and a point's `occupied` means only that something of the TRUCK's takes it.
//
// Discovery (no Game field): the truck side either registers itself — setTruckCargoSource(game, src) — or the vehicle controller on
// `game.skywaysCar` carries the methods itself. NOTE for TRUCK / the lead: until one of the two exists the district simply offers no mount
// points (nothing breaks; units are carried / dragged as everywhere else).

/** One attachment point of the truck (fresh every call: world space, the truck's pose now). */
export interface TruckAttachPoint {
  /** Stable for the truck's life ('bed-0', 'bed-1', …): the secured unit's record names it. */
  readonly id: string;
  /** World pose of the point's floor centre (a unit's footprint centre stands there) and the way the unit faces (rad, +Y). */
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number;
  /** The storey it is on (Levels support level of the truck). */
  readonly level: number;
  /** The truck body's tilt (rad, optional: 0 = level). */
  readonly pitch?: number; readonly roll?: number;
  /** The space it offers: w across, d along its forward, h clear height (m). */
  readonly size: {readonly w: number; readonly d: number; readonly h: number};
  /** Something of the TRUCK's takes it (CARGO tracks its own units itself). */
  readonly occupied: boolean;
}

/** The truck as the bulky cargo sees it. */
export interface TruckCargoSource {
  /** Prompt name ('the truck'; default 'the truck'). */
  readonly label?: string;
  /** Every attachment point of the truck in the current world ([] = no truck here). */
  truckAttachPoints(): readonly TruckAttachPoint[];
  /**
   * Why nothing may be secured / taken off now (the truck moving, the player in its seat): the text; null = it may. Absent: CARGO's own
   * rule (cargo.ts truckBlock: `driving` / the body's speed on game.skywaysCar).
   */
  cargoBlock?(): string | null;
}

const sources = new WeakMap<object, TruckCargoSource>();

/** The truck side registers its source (any time; the last one wins). */
export function setTruckCargoSource(game: object, src: TruckCargoSource | null): void {
  if (src) sources.set(game, src);
  else sources.delete(game);
}

/** The registered source, else the vehicle controller when it carries `truckAttachPoints` itself, else null. */
export function truckCargoSource(game: object): TruckCargoSource | null {
  const reg = sources.get(game);
  if (reg) return reg;
  const car = (game as {skywaysCar?: unknown}).skywaysCar as Partial<TruckCargoSource> | null | undefined;
  return car && typeof car.truckAttachPoints === 'function' ? (car as TruckCargoSource) : null;
}
