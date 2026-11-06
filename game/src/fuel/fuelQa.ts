// Task studio-beta-train-fuel-system-20261106-024923-01: QA hooks (spread into window.__LL through qa.ts) for SHORT spot checks of the
// train's fuel: a report (tank, reserves aboard, this station's figure and plan) and setters for the tank / a chest can stack.
import type {Game} from '../game';
import {FUEL, reservesOf, stationFuelPlan, tanksText} from './fuel';

export function fuelQaApi(game: Game) {
  const carts = () => ((game as unknown as {fuelCarts?: {aboard?(): {uid: string; units: number}[]}}).fuelCarts?.aboard?.() ?? []);
  return {
    /** Fuel report: tank, reserves aboard (tank / chest / carts), this station's figure (live / remaining / planned) and its plan. */
    fuel: () => {
      const t = game.playerTrain.fuel, r = reservesOf(t.tank, carts(), game.playerTrain.lockbox.slots), st = game.run.current.station;
      const seed = game.run.campaign?.network.seed;
      return {tank: t.tank, reserves: r, text: tanksText(r.total), cargo: t.cargoRecords(), station: st ?? null,
        here: st ? game.fuelStations.nodeFuel(st) : null, plan: st && seed !== undefined ? stationFuelPlan(seed, st) : null, last: game.fuelStations.last};
    },
    /** QA: set the tank (quarter units, clamped 0..4). */
    fuelSetTank: (units: number) => { game.playerTrain.fuel.tank = Math.max(0, Math.min(FUEL.tankUnits, Math.floor(units))); return game.playerTrain.fuel.tank; },
  };
}
