// Task reactor-build-20261101 (primary): the Reactor's runtime VISUAL hooks — the seam between the lanes, so no lane edits another's
// files. Lane ARCH (world/reactor/arch*.ts) implements ReactorVisuals for the built world and registers it with setReactorVisuals on
// section build (null on teardown / any other level); lane AIR (generators, fans, clearing) and lane RESTART (controls, the win
// sequence) only CALL it through reactorVisuals() — every call is a no-op while nothing is registered (Node tests, other levels).
// Pure TS (no three.js import here).

export interface ReactorVisuals {
  /** Fan blade speed of ReactorFan `id`, 0 (stopped) .. 1 (full speed); ARCH eases the rotation toward it. */
  setFanSpeed(id: number, speed: number): void;
  /** Generator `id` running state (exhaust / vibration / its control-box lamps), 0 (off) .. 1 (running). */
  setGeneratorRunning(id: number, level: number): void;
  /** The vessel's glow (core alive), 0 (dormant: a faint cold glow) .. 1 (restarted). */
  setCoreGlow(level: number): void;
  /** Powered industrial lighting of one tier (layout.levels index), 0 (dead / emergency only) .. 1 (restored) — lamp emissives. */
  setTierPower(level: number, power: number): void;
}

const NOOP: ReactorVisuals = {setFanSpeed() {}, setGeneratorRunning() {}, setCoreGlow() {}, setTierPower() {}};
let current: ReactorVisuals | null = null;

/** ARCH: register the built Reactor world's visuals (null = none). */
export function setReactorVisuals(v: ReactorVisuals | null): void { current = v; }
/** AIR / RESTART: the current visuals (a no-op object when none is registered). */
export function reactorVisuals(): ReactorVisuals { return current ?? NOOP; }
