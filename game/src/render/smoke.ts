// Iteration 12 (ATMOS): world-space smoke and extra fog-scattering lights for the volumetric march (render/volumetric.ts).
//
// SMOKE (the thrown flare's red smoke; any caller may use it): an emitter puffs soft spheres that rise (hot, buoyant), slow,
// grow and thin out, drift with the station draft and pool under the local ceiling. They are NOT particles drawn as sprites:
// each puff is analytic density, sigma(p) = d * (1 - |p - c|^2 / r^2)^2 inside radius r, that the existing depth-aware
// raymarch integrates like the haze — lit by the same lights (flashlight with its shadow map, baked fixtures, muzzle flash,
// the scatter lights below), tinted by the emitter's colour, and with its own extinction, so it hides what is behind it
// the way smoke does and never draws through the visible surface. Bounds: at most SMOKE_LIMITS.emitters emitters (a fifth
// evicts the oldest, preferring one already stopping) and SMOKE_LIMITS.puffsPerEmitter live puffs each (the spawn interval
// stretches so a plume never needs more), so the march loop cost is fixed. Puffs move on the station grid (no drifting
// through walls); the rendered density is also gated by an occlusion window around the emitter (VisibilityWindows), so a
// puff's soft edge never shows on the far side of a wall. stop() ends emission and lets the puffs thin out over `fade`
// seconds; clear() (new station / retry) drops everything at once.
//
// SCATTER LIGHTS: up to SMOKE_LIMITS.scatterLights PointLights (the burning flare's red light) also in-scatter in the march,
// each limited to its distance cutoff and gated by its own occlusion window (2D line of sight on the light's storey grid
// at the light's height + the storey's floor..ceiling band), so a flare in the next room does not light this room's haze
// through the wall.
//
// Pure CPU state (no GL): tests drive it directly; volumetric.ts packs it into uniforms each frame.

import * as THREE from 'three';
import {CELL, SOLID, type Grid} from '../gen/grid';

export const SMOKE_LIMITS = {
  emitters: 4,
  puffsPerEmitter: 8,
  scatterLights: 4,
} as const;
/** Occlusion windows: scatter lights use layers 0..3, smoke emitters layers 4..7. */
export const VIS_WINDOWS = SMOKE_LIMITS.scatterLights + SMOKE_LIMITS.emitters;
/** Window size in grid cells (CELL = 0.5 m): 48 cells = 24 m, i.e. +-12 m around the source. */
export const VIS_RES = 48;

export interface SmokeEmitterOptions {
  x: number; y: number; z: number;
  /** Smoke colour (0xRRGGBB or linear [r, g, b]); the puffs' scattering tint keeps its hue, normalised (default grey). */
  color?: number | readonly [number, number, number];
  /** Puffs per second (default 1.2; capped so that rate x life <= puffsPerEmitter). */
  rate?: number;
  /** Grown puff radius in metres (default 1.2; a puff starts at ~22 % of it). */
  radius?: number;
  /** Seconds each puff lives (default 6). */
  life?: number;
  /** Density scale (default 1: a fresh puff's core is ~1.8 / m, thinning as 1 / radius while it grows). */
  density?: number;
}

export interface SmokeHandle {
  readonly id: number;
  /** Emitting, or stopped but still has visible puffs. False once evicted / cleared / faded out. */
  readonly alive: boolean;
  readonly emitting: boolean;
  /** Move the emitter (the puffs already out keep drifting where they are). */
  setPos(x: number, y: number, z: number): void;
  /** Change any option (position too): `handle.update({x, y, z})` from a moving flare each frame. */
  update(o: Partial<SmokeEmitterOptions>): void;
  /** Stop emitting; the plume thins out over `fade` seconds (default 3) and the slot frees itself. */
  stop(fade?: number): void;
}

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  r0: number; r: number;
  /** Current density (scaled; 0 when faded). */
  d: number;
}

export interface Emitter {
  id: number;
  x: number; y: number; z: number;
  tint: [number, number, number];
  rate: number; radius: number; life: number; density: number;
  emitting: boolean;
  /** Seconds left of the stop() fade (Infinity while emitting). */
  fadeLeft: number;
  fade0: number;
  spawnAcc: number;
  puffs: Puff[];
  born: number;
  rnd: () => number;
  /** Emitter position moved since its occlusion window was computed. */
  winX: number; winY: number; winZ: number; winT: number;
}

/** Station queries the smoke uses (render/volumetric.ts binds them per station). */
export interface SmokeEnv {
  /** Local floor and ceiling of the storey band holding (x, y, z), or null outside the station. */
  band?(x: number, y: number, z: number): {floor: number; ceil: number} | null;
  /** Open (walkable / air) cell at (x, z) on the storey holding y. */
  open?(x: number, y: number, z: number): boolean;
  /** Air drift (m/s) at a point — the haze's flow map + station draft (render/atmosphere.ts); default still air. */
  drift?(x: number, y: number, z: number): readonly [number, number, number];
}

const DEFAULTS = {color: 0x8c8c88, rate: 1.2, radius: 1.2, life: 6, density: 1};
/** Peak puff density (1/m) at density 1 for a fresh puff. */
export const PUFF_DENSITY = 1.8;

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Scattering tint of a smoke colour: hue kept, max channel 1, a quarter white (smoke scatters every wavelength). */
export function smokeTint(c: number | readonly [number, number, number] | undefined): [number, number, number] {
  let rgb: [number, number, number];
  if (Array.isArray(c)) rgb = [c[0], c[1], c[2]];
  else { const col = new THREE.Color(typeof c === 'number' ? c : DEFAULTS.color); rgb = [col.r, col.g, col.b]; } // linear (ColorManagement)
  const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  return rgb.map(v => 0.25 + 0.75 * (v / m)) as [number, number, number];
}

/** Puff spawn interval (s) for an emitter: never more than puffsPerEmitter alive at once. */
export const spawnInterval = (rate: number, life: number) => Math.max(1 / Math.max(rate, 1e-3), life / SMOKE_LIMITS.puffsPerEmitter);

export class SmokeField {
  /** Live emitters (emitting or fading), oldest first. */
  readonly emitters: Emitter[] = [];
  private nextId = 1;
  private clock = 0;
  env: SmokeEnv = {};
  /** QA counters. */
  readonly stats = {added: 0, evicted: 0, stopped: 0, finished: 0, cleared: 0};

  add(o: SmokeEmitterOptions): SmokeHandle {
    if (this.emitters.length >= SMOKE_LIMITS.emitters) {
      // evict: the oldest already stopping, else the oldest
      const i = Math.max(0, this.emitters.findIndex(e => !e.emitting));
      this.emitters.splice(i, 1);
      this.stats.evicted++;
    }
    const id = this.nextId++;
    const e: Emitter = {
      id, x: o.x, y: o.y, z: o.z, tint: smokeTint(o.color),
      rate: o.rate ?? DEFAULTS.rate, radius: Math.max(0.2, o.radius ?? DEFAULTS.radius), life: Math.max(0.5, o.life ?? DEFAULTS.life), density: o.density ?? DEFAULTS.density,
      emitting: true, fadeLeft: Infinity, fade0: 1, spawnAcc: 1, puffs: [], born: this.clock, rnd: mulberry(0x5eed ^ (id * 0x9e3779b1)),
      winX: NaN, winY: NaN, winZ: NaN, winT: -Infinity,
    };
    this.emitters.push(e);
    this.stats.added++;
    return this.handle(e);
  }

  private handle(e: Emitter): SmokeHandle {
    const live = () => this.emitters.includes(e);
    const update = (o: Partial<SmokeEmitterOptions>) => {
      if (!live()) return;
      if (o.x !== undefined) e.x = o.x;
      if (o.y !== undefined) e.y = o.y;
      if (o.z !== undefined) e.z = o.z;
      if (o.color !== undefined) e.tint = smokeTint(o.color);
      if (o.rate !== undefined) e.rate = o.rate;
      if (o.radius !== undefined) e.radius = Math.max(0.2, o.radius);
      if (o.life !== undefined) e.life = Math.max(0.5, o.life);
      if (o.density !== undefined) e.density = o.density;
    };
    return {
      id: e.id,
      get alive() { return live(); },
      get emitting() { return live() && e.emitting; },
      setPos: (x, y, z) => update({x, y, z}),
      update,
      stop: (fade = 3) => {
        if (!live() || !e.emitting) return;
        e.emitting = false;
        e.fade0 = e.fadeLeft = Math.max(0.05, fade);
        this.stats.stopped++;
      },
    };
  }

  /** Drop everything (new station / retry / death). Handles go inert. */
  clear(): void {
    this.emitters.length = 0;
    this.stats.cleared++;
  }

  get puffCount(): number {
    let n = 0;
    for (const e of this.emitters) n += e.puffs.length;
    return n;
  }

  /** Advance the simulation by dt seconds (game time; frozen in menus). */
  step(dt: number): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const env = this.env, still = [0, 0, 0] as const;
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      if (e.emitting) {
        const every = spawnInterval(e.rate, e.life);
        e.spawnAcc += dt / every;
        while (e.spawnAcc >= 1) {
          e.spawnAcc -= 1;
          if (e.puffs.length >= SMOKE_LIMITS.puffsPerEmitter) e.puffs.shift(); // never above the cap (rate changed mid-plume)
          const r0 = Math.max(0.08, e.radius * 0.22);
          const a = e.rnd() * Math.PI * 2, j = 0.05 + e.rnd() * 0.07;
          e.puffs.push({x: e.x + Math.cos(a) * 0.04, y: e.y + 0.05, z: e.z + Math.sin(a) * 0.04, vx: Math.cos(a) * j, vy: 0.45 + e.rnd() * 0.15, vz: Math.sin(a) * j,
            age: 0, life: e.life * (0.85 + e.rnd() * 0.3), r0, r: r0, d: 0});
        }
      } else {
        e.fadeLeft -= dt;
      }
      const fadeK = e.emitting ? 1 : Math.max(0, e.fadeLeft / e.fade0);
      for (let i = e.puffs.length - 1; i >= 0; i--) {
        const q = e.puffs[i];
        q.age += dt;
        if (q.age >= q.life || fadeK <= 0) { e.puffs.splice(i, 1); continue; }
        // buoyancy decays (the hot core cools); lateral motion relaxes toward the station draft
        const rise = 0.12 + 0.5 * Math.exp(-q.age / 2.5);
        q.vy += (rise - q.vy) * Math.min(1, dt / 0.6);
        const relax = Math.min(1, dt / 1.6), wind = env.drift?.(q.x, q.y, q.z) ?? still;
        q.vx += (wind[0] - q.vx) * relax;
        q.vz += (wind[2] - q.vz) * relax;
        q.r = q.r0 + (e.radius - q.r0) * (1 - Math.exp(-q.age / (0.32 * q.life)));
        let nx = q.x + q.vx * dt, ny = q.y + q.vy * dt, nz = q.z + q.vz * dt;
        // the storey's walls (slide along them) and floor / ceiling (pool under it)
        if (env.open) {
          if (!env.open(nx, q.y, q.z)) { nx = q.x; q.vx *= -0.2; }
          if (!env.open(nx, q.y, nz)) { nz = q.z; q.vz *= -0.2; }
        }
        const band = env.band?.(nx, q.y, nz);
        if (band) {
          const top = band.ceil - 0.08 - 0.45 * q.r;
          if (ny > top) { ny = Math.max(band.floor + 0.05, top); q.vy = Math.min(q.vy, 0); }
          ny = Math.max(ny, band.floor + 0.05);
        }
        q.x = nx; q.y = ny; q.z = nz;
        const fin = Math.min(1, q.age / 0.45);
        const fout = Math.min(1, (q.life - q.age) / (0.35 * q.life));
        q.d = e.density * PUFF_DENSITY * fin * fout * fadeK * (q.r0 / q.r);
      }
      if (!e.emitting && (e.puffs.length === 0 || e.fadeLeft <= 0)) { this.emitters.splice(k, 1); this.stats.finished++; }
    }
  }

  /** Bounding sphere of an emitter's puffs (march culling): centre + radius; null when it has none. */
  bound(e: Emitter): [number, number, number, number] | null {
    if (!e.puffs.length) return null;
    let cx = 0, cy = 0, cz = 0;
    for (const q of e.puffs) { cx += q.x; cy += q.y; cz += q.z; }
    cx /= e.puffs.length; cy /= e.puffs.length; cz /= e.puffs.length;
    let r = 0;
    for (const q of e.puffs) r = Math.max(r, Math.hypot(q.x - cx, q.y - cy, q.z - cz) + q.r);
    return [cx, cy, cz, r];
  }

  /** CPU mirror of the march's smoke term at p: total density and tinted density (before the occlusion window / wisps). */
  densityAt(p: readonly [number, number, number]): {sigma: number; tinted: [number, number, number]; byEmitter: number[]} {
    let sigma = 0;
    const tinted: [number, number, number] = [0, 0, 0], byEmitter: number[] = [];
    for (const e of this.emitters) {
      let s = 0;
      for (const q of e.puffs) s += puffKernel(p, q);
      byEmitter.push(s);
      sigma += s;
      tinted[0] += e.tint[0] * s; tinted[1] += e.tint[1] * s; tinted[2] += e.tint[2] * s;
    }
    return {sigma, tinted, byEmitter};
  }
}

/** One puff's density at p: d * (1 - q)^2 with q = |p - c|^2 / r^2 (compact, smooth). Same in the GLSL. */
export function puffKernel(p: readonly [number, number, number], q: {x: number; y: number; z: number; r: number; d: number}): number {
  const dx = p[0] - q.x, dy = p[1] - q.y, dz = p[2] - q.z;
  const k = (dx * dx + dy * dy + dz * dz) / (q.r * q.r);
  if (k >= 1) return 0;
  const f = 1 - k;
  return q.d * f * f;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scatter lights

export interface ScatterLightState {
  light: THREE.PointLight;
  winX: number; winY: number; winZ: number; winT: number;
}

export class ScatterLights {
  readonly list: ScatterLightState[] = [];
  /** Registers a PointLight for in-scattering; false when SMOKE_LIMITS.scatterLights are already in use (or it is in). */
  add(light: THREE.PointLight): boolean {
    if (this.list.some(s => s.light === light)) return true;
    if (this.list.length >= SMOKE_LIMITS.scatterLights) return false;
    this.list.push({light, winX: NaN, winY: NaN, winZ: NaN, winT: -Infinity});
    return true;
  }
  remove(light: THREE.PointLight): boolean {
    const i = this.list.findIndex(s => s.light === light);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }
  clear(): void { this.list.length = 0; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Occlusion windows (CPU line of sight -> small R8 masks the march samples)

export interface VisSource { x: number; y: number; z: number }
/** Storey grid + band for a source (render/volumetric.ts: from the layout's level grids and the density map's bands). */
export interface VisLookup {
  grid(x: number, y: number, z: number): {grid: Grid; floor: number; ceil: number} | null;
}

/**
 * 2D line of sight on a storey grid between two world points (Amanatides-Woo over CELL cells): false if a SOLID cell lies
 * between them (the start cell never blocks: a flare resting against a wall). Out of bounds blocks.
 */
export function gridLineOfSight(g: Grid, x0: number, z0: number, x1: number, z1: number): boolean {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(z0 / CELL);
  const ex = Math.floor(x1 / CELL), ey = Math.floor(z1 / CELL);
  const dx = x1 - x0, dz = z1 - z0;
  const sx = dx > 0 ? 1 : -1, sy = dz > 0 ? 1 : -1;
  const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity, tdy = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
  let tmx = Math.abs(dx) > 1e-9 ? ((sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
  let tmy = Math.abs(dz) > 1e-9 ? ((sy > 0 ? (cy + 1) * CELL - z0 : z0 - cy * CELL) / Math.abs(dz)) : Infinity;
  for (let n = 0; n < 4 * VIS_RES && (cx !== ex || cy !== ey); n++) {
    if (tmx < tmy) { cx += sx; tmx += tdx; } else { cy += sy; tmy += tdy; }
    if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] === SOLID) return false;
  }
  return true;
}

export interface VisWindow {
  /** World x / z of the window's first texel edge, texel = CELL. */
  x0: number; z0: number;
  /** Storey band the source stands in (the march fades the window out above / below it). */
  floor: number; ceil: number;
}

/** Fills `out` (VIS_RES^2 bytes, row-major z then x) with the source's 2D visibility at its height; returns the window. */
export function computeVisWindow(src: VisSource, lookup: VisLookup, out: Uint8Array): VisWindow | null {
  const at = lookup.grid(src.x, src.y, src.z);
  if (!at) { out.fill(0); return null; }
  const half = VIS_RES / 2;
  const x0 = (Math.floor(src.x / CELL) - half + 1) * CELL, z0 = (Math.floor(src.z / CELL) - half + 1) * CELL;
  for (let j = 0; j < VIS_RES; j++) for (let i = 0; i < VIS_RES; i++) {
    const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL;
    const near = Math.hypot(cx - src.x, cz - src.z) < 0.6;
    out[j * VIS_RES + i] = near || gridLineOfSight(at.grid, src.x, src.z, cx, cz) ? 255 : 0;
  }
  return {x0, z0, floor: at.floor, ceil: at.ceil};
}

/** Recompute a window only when its source moved (> 0.3 m) and at most every `minDt` seconds (flares in flight). */
export function windowStale(s: {winX: number; winY: number; winZ: number; winT: number}, x: number, y: number, z: number, now: number, minDt = 0.2): boolean {
  if (!Number.isFinite(s.winX)) return true;
  if (now - s.winT < minDt) return false;
  return Math.hypot(x - s.winX, y - s.winY, z - s.winZ) > 0.3;
}
