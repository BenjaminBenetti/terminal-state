// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): a version-2 district's FOG PRESSURE at runtime, for a PEDESTRIAN
// (the truck's dash light / groans / damage are the vehicle's, reading the same field: world/surface/fogPressure.ts):
//  - THE SOUND of the outer fog: a low pressure RUMBLE ('bedRumble') under a thin HISS ('bedWind'), existing Sound Lab bed loops only
//    (Sfx.rideLoop: non-positional, through the master — the volume setting applies; pause / menus mute the master; a menu / the map /
//    any non-playing state silences them here too), their level / rate / low-pass following the pressure at the eye the gas system
//    measured this frame (world/gas/system.ts exposure.pressure: 0 in the sealed cab, indoors, in a v1 district). Bounded: at most these
//    two loops, created when the pressure first reaches FOG_PRESSURE.warn, released after FOG_AUDIO.idleS below it, on death, at the
//    section teardown and on every new world.
//  - QA hooks (window.__LL via qa.ts): surfaceFog() — the boundary, the pressure / its damage / the HUD state at the eye, the fog's
//    fallback state, the sound; surfaceFogAt(x, z); surfaceFogPose(p, side?) — stand on open ground at pressure p looking outward.
// Inert outside a version-2 district (no layout.surface.boundary).

import {CELL, FLOOR} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceBoundary} from '../../gen/surface/surfaceTypes';
import type {RideLoopHandle} from '../../audio/sfx';
import {FOG_PRESSURE, fogPressureAt} from './fogPressure';
import {fogPressureDps, fogPressureHigh} from './fogAir';

/** Mix / tuning (levels x the cue's CUE_GAIN; pressure-driven between FOG_PRESSURE.warn and `top`). */
export const FOG_AUDIO = {
  /** The pressure at which the sound reaches its full mix. */
  top: 1.2,
  rumble: {level: [0.12, 0.85] as const, rate: [0.92, 0.6] as const, lowpass: [160, 760] as const},
  hiss: {level: [0, 0.38] as const, rate: [0.9, 1.3] as const, lowpass: [700, 3600] as const},
  /** Easing (s); the fade at a release; seconds below warn before the loops are released. */
  tau: 0.35, fade: 0.8, idleS: 2.5,
} as const;

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface SurfaceFogHost {
  layout: StationLayout;
  player: {x: number; y: number; z: number; eye: number; alive: boolean};
  gas: {exposure: {c: number; dps: number; protected: boolean; pressure?: number; pressureDps?: number}};
  sfx?: unknown;
  readonly state?: string;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  stateListeners?: ((state: never, prev: never) => void)[];
}

type RideSfx = {rideLoop(cue: 'bedRumble' | 'bedWind', o?: {send?: number}): RideLoopHandle | null};
const hasRide = (s: unknown): s is RideSfx => !!s && typeof (s as {rideLoop?: unknown}).rideLoop === 'function';
const lerp = (a: readonly [number, number], t: number) => a[0] + (a[1] - a[0]) * t;

export class SurfaceFogRuntime {
  boundary: SurfaceBoundary | null = null;
  private rumble: RideLoopHandle | null = null;
  private hiss: RideLoopHandle | null = null;
  private idle = 0;
  /** The sound's last mix 0..1 (QA). */
  level = 0;
  readonly counts = {builds: 0, teardowns: 0, starts: 0, stops: 0};

  constructor(readonly host: SurfaceFogHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    (h.stateListeners as ((state: string, prev: string) => void)[] | undefined)?.push(state => { if (state !== 'playing') this.silence(); });
    return this;
  }

  build(layout: StationLayout): void {
    this.stop();
    this.boundary = layout.surface?.boundary ?? null;
    if (this.boundary) this.counts.builds++;
  }

  teardown(): void {
    if (this.boundary) this.counts.teardowns++;
    this.stop();
    this.boundary = null;
  }

  /** The pressure the eye is under this frame (the gas system's measure: 0 sheltered / indoors / dead). */
  eyePressure(): number {
    const e = this.host.gas.exposure.pressure;
    return this.boundary && this.host.player.alive && Number.isFinite(e) ? Math.max(0, e!) : 0;
  }

  frame(dt: number): void {
    if (!this.boundary) return;
    const p = this.eyePressure();
    if (p < FOG_PRESSURE.warn) {
      if (this.rumble || this.hiss) {
        this.mix(0);
        if ((this.idle += Math.max(0, dt)) >= FOG_AUDIO.idleS || !this.host.player.alive) this.stop();
      }
      return;
    }
    this.idle = 0;
    if (!this.rumble && !this.hiss) this.start();
    this.mix(Math.min(1, (p - FOG_PRESSURE.warn) / (FOG_AUDIO.top - FOG_PRESSURE.warn)));
  }

  private start(): void {
    const s = this.host.sfx;
    if (!hasRide(s)) return;
    this.rumble = s.rideLoop('bedRumble');
    this.hiss = s.rideLoop('bedWind');
    if (this.rumble || this.hiss) this.counts.starts++;
  }

  private mix(k: number): void {
    this.level = k;
    const A = FOG_AUDIO, t = A.tau;
    const r = this.rumble, h = this.hiss;
    if (r) { r.setLevel(k > 0 ? lerp(A.rumble.level, k) : 0, t); r.setRate(lerp(A.rumble.rate, k), t); r.setLowpass(lerp(A.rumble.lowpass, k), t); }
    if (h) { h.setLevel(k > 0 ? lerp(A.hiss.level, k) : 0, t); h.setRate(lerp(A.hiss.rate, k), t); h.setLowpass(lerp(A.hiss.lowpass, k), t); }
  }

  /** A menu / the map / any non-playing state: quiet now (the loops stay; the next play frame sets the mix again). */
  silence(): void {
    this.rumble?.setLevel(0, 0.1);
    this.hiss?.setLevel(0, 0.1);
    this.level = 0;
  }

  /** Fade out and release both loops (idempotent). */
  stop(): void {
    if (this.rumble || this.hiss) this.counts.stops++;
    this.rumble?.stop(FOG_AUDIO.fade);
    this.hiss?.stop(FOG_AUDIO.fade);
    this.rumble = this.hiss = null;
    this.idle = 0;
    this.level = 0;
  }

  get playing(): boolean { return !!(this.rumble?.playing || this.hiss?.playing); }

  // -------------------------------------------------------------------------------------------
  // QA

  summary() {
    const b = this.boundary, h = this.host, p = h.player, e = h.gas.exposure;
    if (!b) return {v2: false};
    const field = fogPressureAt(b, p.x, p.z);
    return {
      v2: true, boundary: b, fieldAtPlayer: field, pressureAtEye: e.pressure ?? 0, pressureDps: e.pressureDps ?? 0, dps: e.dps, protected: e.protected, c: e.c,
      high: fogPressureHigh(e.pressure ?? 0), levels: FOG_PRESSURE, dpsAt1: fogPressureDps(1),
      audio: {playing: this.playing, level: this.level}, counts: {...this.counts},
    };
  }

  /**
   * A standing pose on open level-0 ground at field pressure `p` on side `side` of the clear rect (looking outward), or null: from the
   * side's middle `p x ramp` m out, the nearest walkable cell along the side (+-80 m).
   */
  poseAt(p: number, side: 'N' | 'S' | 'W' | 'E' = 'N'): {x: number; z: number; yaw: number; p: number} | null {
    const b = this.boundary, L = this.host.layout;
    if (!b || !(p >= 0)) return null;
    const g = L.levels?.find(l => l.id === 0)?.grid ?? L.grid, c = b.clear, d = p * b.ramp;
    const alongX = side === 'N' || side === 'S';
    const s0 = alongX ? (c.x0 + c.x1) / 2 : (c.z0 + c.z1) / 2;
    const at = side === 'N' ? c.z0 - d : side === 'S' ? c.z1 + d : side === 'W' ? c.x0 - d : c.x1 + d;
    const yaw = side === 'N' ? 0 : side === 'S' ? Math.PI : side === 'W' ? Math.PI / 2 : -Math.PI / 2;
    for (let k = 0; k <= 160; k++) for (const sg of [1, -1]) {
      const s = s0 + sg * k * CELL;
      const x = alongX ? s : at, z = alongX ? at : s, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (!g.inBounds(cx, cz) || g.cells[g.idx(cx, cz)] !== FLOOR) continue;
      const a = g.area[g.idx(cx, cz)];
      if (!L.surface?.outdoorAreas.includes(a)) continue;
      const px = (cx + 0.5) * CELL, pz = (cz + 0.5) * CELL;
      return {x: px, z: pz, yaw, p: fogPressureAt(b, px, pz)};
    }
    return null;
  }
}

let installed: SurfaceFogRuntime | null = null;

/** The installed runtime (tests / QA). */
export const surfaceFogRuntime = (): SurfaceFogRuntime | null => installed;

export function installSurfaceFog(game: SurfaceFogHost): SurfaceFogRuntime {
  return (installed = new SurfaceFogRuntime(game).install());
}

type Teleport = (x: number, z: number, yaw?: number, level?: number) => boolean;

/** QA hooks (qa.ts spreads them into window.__LL). */
export function surfaceFogQaApi(teleport: Teleport) {
  return {
    surfaceFog: () => installed?.summary() ?? {installed: false},
    surfaceFogAt: (x: number, z: number) => fogPressureAt(installed?.boundary ?? null, x, z),
    surfaceFogPose: (p: number, side: 'N' | 'S' | 'W' | 'E' = 'N') => {
      const q = installed?.poseAt(p, side) ?? null;
      if (q) teleport(q.x, q.z, q.yaw, 0);
      return q;
    },
  };
}
