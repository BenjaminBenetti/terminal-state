// Task reactor-expansion-20261101 (lane CORE): THE STAGED STARTUP as pure data — user: "It needs to come to life as you do each task, like
// putting the fuses in or turning on the coolent pumps, the effect should be visible in game (for example blue coolant flowing). I want
// substantial light cast from the green and blue liquids". Driven ONLY by the persisted restart record (world/reactor/runState.ts), so a
// rebuilt / reloaded world shows exactly the stage reached (instant restore) and nothing is a one-shot that could replay:
//
//  stage (ReactorRunState)   at the action site                                at the core
//  dormant (nothing done)    switchgear fuse lamps red                          goop dormant but clearly GREEN, slow; green glow lights
//                                                                               the pit fog from the rim; loop panels dark; pumps still
//  fuse k seated             that slot's lamp AMBER                             -
//  breaker closed            every switchgear lamp GREEN (control power)        loop panels / turbine panel power lamps GREEN
//  valve open                valve beacon AMBER                                 sight glasses FILL with coolant (dim blue), pressure lamps
//                                                                               AMBER, a faint blue light
//  pump started              pump beacon BLUE                                   BLUE FLOW streams through every loop (hot / cold /
//                                                                               crossover legs, manifold feeds), pump flywheels spin up,
//                                                                               the blue light grows (casts on the gantries / fog)
//  key in                    console key lamp AMBER (armed)                     CRDM platform rod lamps AMBER
//  rods withdrawn (restart)  console rods lamp GREEN                            the CORE comes alive: goop brightens + churns, green
//                                                                               light x4, turbine spins up, rod lamps GREEN; then ARCH's
//                                                                               tier-by-tier lights / fans / gas clearing (restartWin)
//
// Levels ease per frame (CORE_EASE) unless the change is an instant restore (build / reload).

import type {ReactorRunState} from './runState';
import type {CoreLampGroup} from './coreHero';

/** The stage levels (0..1; fuse slots 0 missing / 1 seated / 2 powered). */
export interface CoreStageLevels {
  fuse0: number;
  fuse1: number;
  /** Control power (breaker closed). */
  power: number;
  /** Coolant pressure (valve open): sight glasses fill. */
  pressure: number;
  /** Coolant flow (pump running): the blue flow, pump rotors. */
  flow: number;
  /** Startup key in the console (armed). */
  armed: number;
  /** The core alive (rods withdrawn / restarted): goop, green light, turbine. */
  core: number;
}

export const coreStageTargets = (s: Readonly<ReactorRunState>): CoreStageLevels => ({
  fuse0: s.fuses[0] ? (s.breaker ? 2 : 1) : 0,
  fuse1: s.fuses[1] ? (s.breaker ? 2 : 1) : 0,
  power: s.breaker ? 1 : 0,
  pressure: s.valve ? 1 : 0,
  flow: s.pump ? 1 : 0,
  armed: s.keyInserted ? 1 : 0,
  core: s.rods || s.restarted ? 1 : 0,
});

/** Ramp durations (s per unit, linear): lamps / control power switch, the glasses fill over 3 s, the pumps spool over 4 s, the core
 *  wakes over 6 s (= restartWin's WIN.coreS: the vessel glow ramps alongside). */
export const CORE_EASE: Readonly<Record<keyof CoreStageLevels, number>> = {fuse0: 0.25, fuse1: 0.25, power: 0.35, pressure: 3, flow: 4, armed: 0.25, core: 6};

/** What the visuals show at a set of levels (pure: tests read it; coreVisuals.ts applies it). */
export interface CoreLook {
  /** Goop emissive strength (dormant ~0.55: clearly green from the rim) and its churn speed. */
  goop: number;
  churn: number;
  /** Coolant sleeves: streak brightness, scroll speed (m/s), the sight glasses' fill. */
  flowGlow: number;
  flowSpeed: number;
  fill: number;
  /** Rotor speeds (rev / s): pumps, turbine. */
  pumpRev: number;
  turbineRev: number;
  /** Light intensities (candela): the two green goop lights, the blue coolant light. */
  green: number;
  blue: number;
}

/** Look tunables (the lead tunes them in the browser: __LL.reactorCore({...})). */
export const CORE_LOOK = {
  goopDormant: 0.55, goopAlive: 1.6, churnDormant: 0.25, churnAlive: 1,
  flowPressure: 0.12, flowRun: 1, flowSpeed: 3.2,
  pumpRev: 3.2, turbineRev: 5,
  greenDormant: 90, greenAlive: 380, bluePressure: 18, blueFlow: 160, blueAlive: 210,
} as const;

export function coreLook(l: Readonly<CoreStageLevels>, k: {[K in keyof typeof CORE_LOOK]: number} = CORE_LOOK, out?: CoreLook): CoreLook {
  const o = out ?? ({} as CoreLook), run = l.flow;
  o.goop = k.goopDormant + (k.goopAlive - k.goopDormant) * l.core;
  o.churn = k.churnDormant + (k.churnAlive - k.churnDormant) * l.core;
  o.flowGlow = Math.max(k.flowPressure * l.pressure, k.flowRun * run);
  o.flowSpeed = k.flowSpeed * run;
  o.fill = l.pressure;
  o.pumpRev = k.pumpRev * run;
  o.turbineRev = k.turbineRev * l.core;
  o.green = k.greenDormant + (k.greenAlive - k.greenDormant) * l.core;
  o.blue = Math.max(k.bluePressure * l.pressure, k.blueFlow * run) + (k.blueAlive - k.blueFlow) * l.core * run;
  return o;
}

/** Lamp colours (linear RGB) per group at the levels: [r, g, b]. */
const OFF: readonly [number, number, number] = [0.025, 0.025, 0.025];
const RED: readonly [number, number, number] = [0.9, 0.06, 0.03];
const AMBER: readonly [number, number, number] = [1.6, 0.75, 0.08];
const GREEN: readonly [number, number, number] = [0.25, 1.8, 0.35];
const BLUE: readonly [number, number, number] = [0.25, 0.85, 2.2];

const mix = (a: readonly number[], b: readonly number[], t: number, out: [number, number, number]): [number, number, number] => {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
};

/** A status lamp's colour (written into `out`: no allocation per call). */
export function lampColor(group: CoreLampGroup, l: Readonly<CoreStageLevels>, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  switch (group) {
    case 'fuse0': case 'fuse1': {
      const v = group === 'fuse0' ? l.fuse0 : l.fuse1;
      return v <= 1 ? mix(RED, AMBER, v, out) : mix(AMBER, GREEN, v - 1, out);
    }
    case 'power': return mix(RED, GREEN, l.power, out);
    case 'valve': return mix(OFF, AMBER, l.pressure, out);
    case 'pump': return mix(OFF, BLUE, l.flow, out);
    case 'key': return l.core > 0 ? mix(AMBER, GREEN, l.core, out) : mix(OFF, AMBER, l.armed, out);
    case 'rods': return mix(OFF, GREEN, l.core, out);
  }
}

/** Eases `cur` toward `target` (in place) over dt; returns whether anything moved. */
export function easeLevels(cur: CoreStageLevels, target: Readonly<CoreStageLevels>, dt: number): boolean {
  let moved = false;
  for (const k of Object.keys(CORE_EASE) as (keyof CoreStageLevels)[]) {
    const a = cur[k], b = target[k];
    if (a === b) continue;
    const step = dt / CORE_EASE[k];
    cur[k] = b > a ? Math.min(b, a + step) : Math.max(b, a - step);
    moved = true;
  }
  return moved;
}

export const sameLevels = (a: Readonly<CoreStageLevels>, b: Readonly<CoreStageLevels>): boolean =>
  a.fuse0 === b.fuse0 && a.fuse1 === b.fuse1 && a.power === b.power && a.pressure === b.pressure && a.flow === b.flow && a.armed === b.armed && a.core === b.core;
