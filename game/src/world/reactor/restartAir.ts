// Task reactor-build-20261101 (lane RESTART): the seam between THE WIN and lane AIR's depth-gas model (world/reactor/air.ts, written
// in parallel) — so neither lane edits the other's files. Lane AIR registers its live air model on section build
// (`setReactorAir(model)`) and clears it on teardown (`setReactorAir(null)`); lane RESTART only calls `reactorAir()?.clearAll(s)`
// when the reactor restarts (once per sequence) and once (`clearAll(0)`) when a world whose reactor was already restarted is
// rebuilt. Pure TS (no three.js here).

export interface ReactorAirControl {
  /** Clear every gas zone of the pit over `durationS` seconds (0 = at once), persisting it like a generator's staged clearing. */
  clearAll(durationS: number): void;
}

let current: ReactorAirControl | null = null;

/** AIR: register the built Reactor world's air model (null = none / torn down). */
export function setReactorAir(air: ReactorAirControl | null): void { current = air; }

/** RESTART: the registered air model, or null (no Reactor world, AIR not built yet, Node tests). */
export function reactorAir(): ReactorAirControl | null { return current; }
