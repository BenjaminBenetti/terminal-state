// Task studio-beta-train-fuel-system-20261106-024923-01: the train's FUEL CAP and the "aboard" rule — the shared, pure contract between
// the travel transaction (game.ts), the fuel cap / can refuel (world/fuelPort.ts) and the fuel carts + hose (world/fuelCarts.ts).
// Train-local frame (world/playerTrainSpec.ts): origin = car centre at rail-top height, +X front, -Z = the PLATFORM side.
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';
import type {CartFuel} from './fuel';

/**
 * The fuel cap: on the platform-side (-Z) outer skin between the middle and the front door, 0.9 m above the platform (= the door
 * sill / interior floor). Train-local metres.
 */
export function fuelPortLocal(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): {x: number; y: number; z: number} {
  const plat = spec.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const x = plat.length >= 3 ? (plat[1] + plat[2]) / 2 : 0;
  return {x, y: spec.floorY + 0.9, z: -(spec.width / 2 + 0.02)};
}

/** Reach for E at the cap (eye -> cap, m), the hose's longest run (cart nozzle -> cap, m) and a cart's footprint radius (m). */
export const PORT = {reach: 1.7, hoseMax: 3.6, cartRadius: 0.36} as const;

/** A cart (centre at train-local x / z, footprint radius r) lies WHOLLY inside the car's walkable interior (it rides as cargo). */
export function cartAboard(x: number, z: number, r: number = PORT.cartRadius, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): boolean {
  const I = spec.interior;
  return x - r >= I.x0 && x + r <= I.x1 && Math.abs(z) + r <= I.halfWidth;
}

/** A cart partly in and partly out (in a doorway / against the skin): a departure is refused until it is wholly in or out. */
export function cartStraddles(x: number, z: number, r: number = PORT.cartRadius, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): boolean {
  if (cartAboard(x, z, r, spec)) return false;
  const halfOuter = spec.width / 2;
  const inLength = x + r > spec.interior.x0 && x - r < spec.interior.x1;
  return inLength && Math.abs(z) - r < halfOuter + 0.05; // some of its footprint is inside the body's outline
}

/** The world's fuel carts as the travel transaction sees them (world/fuelCarts.ts implements it; absent = no carts anywhere). */
export interface FuelCartsLike {
  /** Carts wholly inside the parked car right now; `units` are LIVE (the departure debit mutates them). */
  aboard(): CartFuel[];
  /** A cart straddling the car's edge / a doorway: the refusal text for a departure, else null. */
  departBlock(): string | null;
  /** Just before the car moves: the carts aboard become cargo (kinematic, riding the car; their hoses disconnected). Idempotent. */
  captureCargo(): void;
  /** The departure was refused before the car left: cargo back to ordinary carts where they stand. */
  releaseCargo(): void;
}
