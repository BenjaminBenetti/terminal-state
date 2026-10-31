// Track 2 (Beyond the Station), lane VIS: localized, NON-HAZARDOUS steam in the service annexes (DESIGN §3).
//
// Vents are plain positions + directions (CONTENT / GEN can supply them later; `annexVents` derives a few from the annex
// walls until then). Each frame only vents within STEAM.radius of the player emit (nearest STEAM.maxActive first), in
// irregular hissing bursts, into Effects' own bounded steam ring (world/fx.ts STEAM_FX.puffs = 24 live puffs per level).
// Steam is visual only: no damage, no gas field, no breath / mask interaction, no audio dependency, no collision.

import * as THREE from 'three';
import {CELL, FLOOR, SOLID} from '../../gen/grid';
import type {StationLayout} from '../../gen/station';
import {STEAM_FX} from '../fx';
import {extensionsOf} from './view';
import {hashOf, prng} from './mesh';

/** A steam vent: where puffs start and the direction they leave in (unit-ish; up is added by buoyancy). */
export interface SteamVent { x: number; y: number; z: number; dir: {x: number; y: number; z: number}; area?: number }

/** Steam limits and look. Puff cap = the effects ring (STEAM_FX.puffs). */
export const STEAM = {
  puffs: STEAM_FX.puffs,
  /** Vents farther than this from the player are silent (m). */
  radius: 25,
  /** At most this many vents emit at once (nearest first). */
  maxActive: 4,
  /** Puffs per second while a vent hisses; burst / pause lengths (s). */
  rate: 3.2, burst: [2.5, 6] as const, pause: [1.5, 5] as const,
  /** Puff look: start size (m), growth (/s), life (s), alpha, exit speed (m/s), buoyancy (m/s²). */
  size: [0.16, 0.26] as const, grow: 0.75, life: [2.0, 3.4] as const, alpha: [0.13, 0.22] as const, speed: [0.5, 1.1] as const, rise: 0.22,
  /** Unlit tint (linear) — relit per frame by the light at each puff. */
  tint: 0.78,
  /** Default vents per annex (annexVents). */
  perAnnex: 3,
} as const;

/** What SteamVents needs from Effects (world/fx.ts). */
export interface SteamSink {
  steam(pos: {x: number; y: number; z: number}, vx: number, vy: number, vz: number, size: number, life: number, color: THREE.Color, alpha: number, grow?: number, rise?: number, drag?: number): boolean;
  steamLive(): number;
  relightSteam(light: (x: number, y: number, z: number) => number): void;
}

interface VentState { v: SteamVent; on: boolean; t: number; acc: number; rnd: () => number }

export class SteamVents {
  private readonly vents: VentState[];
  private readonly color = new THREE.Color();
  private readonly order: number[] = [];
  private active = 0;

  constructor(private readonly fx: SteamSink, vents: readonly SteamVent[], seed = 0) {
    this.vents = vents.map((v, i) => {
      const rnd = prng(hashOf('steam-vent', seed, i));
      return {v, on: rnd() < 0.5, t: rnd() * 3, acc: 0, rnd};
    });
  }

  get count(): number { return this.vents.length; }

  /**
   * Advance the vents. `eye` = the player; `light(x, y, z)` (0..~1.5) scales the puffs' colour (light field + torch;
   * omitted = a dim constant). Cheap when no vent is near (distance checks only).
   */
  update(dt: number, eye: {x: number; y: number; z: number}, light?: (x: number, y: number, z: number) => number): void {
    this.active = 0;
    if (this.vents.length) {
      const r2 = STEAM.radius * STEAM.radius;
      this.order.length = 0;
      for (let i = 0; i < this.vents.length; i++) {
        const v = this.vents[i].v, dx = v.x - eye.x, dy = v.y - eye.y, dz = v.z - eye.z;
        if (dx * dx + dy * dy + dz * dz <= r2) this.order.push(i);
      }
      if (this.order.length > STEAM.maxActive) {
        const d = (i: number) => { const v = this.vents[i].v; return (v.x - eye.x) ** 2 + (v.y - eye.y) ** 2 + (v.z - eye.z) ** 2; };
        this.order.sort((a, b) => d(a) - d(b));
        this.order.length = STEAM.maxActive;
      }
      for (const i of this.order) {
        const st = this.vents[i];
        st.t -= dt;
        if (st.t <= 0) {
          st.on = !st.on;
          const [a, b] = st.on ? STEAM.burst : STEAM.pause;
          st.t = a + st.rnd() * (b - a);
        }
        if (!st.on) continue;
        this.active++;
        st.acc += dt * STEAM.rate;
        while (st.acc >= 1) {
          st.acc -= 1;
          if (!this.emit(st)) { st.acc = 0; break; }
        }
      }
    }
    if (this.fx.steamLive() > 0) this.fx.relightSteam(light ?? (() => 0.25));
  }

  private emit(st: VentState): boolean {
    const {v, rnd} = st;
    const sp = STEAM.speed[0] + rnd() * (STEAM.speed[1] - STEAM.speed[0]);
    const jx = (rnd() - 0.5) * 0.35, jy = (rnd() - 0.5) * 0.25, jz = (rnd() - 0.5) * 0.35;
    const k = STEAM.tint * (0.9 + rnd() * 0.15);
    this.color.setRGB(k, k * 1.01, k * 0.98);
    return this.fx.steam(v, (v.dir.x + jx) * sp, (v.dir.y + jy) * sp, (v.dir.z + jz) * sp,
      STEAM.size[0] + rnd() * (STEAM.size[1] - STEAM.size[0]), STEAM.life[0] + rnd() * (STEAM.life[1] - STEAM.life[0]), this.color,
      STEAM.alpha[0] + rnd() * (STEAM.alpha[1] - STEAM.alpha[0]), STEAM.grow, STEAM.rise, 1.1);
  }

  /** Vents emitting in the last update (QA). */
  stats(): {vents: number; active: number; live: number} {
    return {vents: this.vents.length, active: this.active, live: this.fx.steamLive()};
  }
}

/**
 * Default vent spots for the service annexes (until CONTENT / GEN supply `ventSpots`): per annex up to STEAM.perAnnex
 * wall points of its areas (rooms before corridors), deterministic per layout seed, at pipe height, blowing out of the
 * wall and slightly up. A layout may override with `extensions.vents` ({x, y, z, dir}[]).
 */
export function annexVents(layout: StationLayout): SteamVent[] {
  const ext = extensionsOf(layout);
  if (!ext) return [];
  const given = (ext as {vents?: SteamVent[]}).vents;
  if (Array.isArray(given)) return given;
  const g = layout.grid, out: SteamVent[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const an of ext.annexes) {
    const rnd = prng(hashOf('annex-vents', layout.seed >>> 0, an.id));
    const areas = an.areas.map(id => layout.areas[id]).filter(Boolean).sort((a, b) => (a.kind === 'room' ? 0 : 1) - (b.kind === 'room' ? 0 : 1) || a.id - b.id);
    const picks: SteamVent[] = [];
    for (const a of areas) {
      if (picks.length >= STEAM.perAnnex) break;
      // Wall-adjacent floor cells of this area (not in doorways: the wall neighbour must be SOLID).
      const cand: {x: number; y: number; d: readonly [number, number]}[] = [];
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
        const i = g.idx(x, y);
        if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i]) continue;
        for (const d of dirs) if (g.get(x + d[0], y + d[1]) === SOLID) cand.push({x, y, d});
      }
      if (!cand.length) continue;
      const c = cand[Math.floor(rnd() * cand.length)];
      if (picks.some(p => Math.hypot(p.x - (c.x + 0.5) * CELL, p.z - (c.y + 0.5) * CELL) < 3)) continue;
      const floor = g.floorOf(g.idx(c.x, c.y)), ceil = g.hasCeil(g.idx(c.x, c.y)) ? g.ceil[g.idx(c.x, c.y)] : floor + 2.6;
      const y = Math.min(ceil - 0.35, floor + 0.5 + rnd() * 1.4);
      // On the wall face (cell edge toward the SOLID neighbour), blowing back into the room and a little up.
      const wx = (c.x + 0.5 + c.d[0] * 0.45) * CELL, wz = (c.y + 0.5 + c.d[1] * 0.45) * CELL;
      picks.push({x: wx, y, z: wz, dir: {x: -c.d[0] * 0.8, y: 0.35, z: -c.d[1] * 0.8}, area: a.id});
    }
    out.push(...picks);
  }
  return out;
}

/**
 * Light at a puff for SteamVents.update: the baked field's luminance (StationLighting.sample) plus the torch cone.
 * `sample` returns the field's ambient + directional colours at a point.
 */
export function steamLight(sample: (x: number, y: number, z: number) => {amb: readonly number[]; dirColor: readonly number[]}, torch: {eye: {x: number; y: number; z: number}; dir: {x: number; y: number; z: number}; on: boolean; range?: number}): (x: number, y: number, z: number) => number {
  const lum = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const range = torch.range ?? 18;
  return (x, y, z) => {
    const s = sample(x, y, z);
    let k = 0.06 + (lum(s.amb) + lum(s.dirColor)) * 0.35;
    if (torch.on) {
      const dx = x - torch.eye.x, dy = y - torch.eye.y, dz = z - torch.eye.z, d = Math.hypot(dx, dy, dz) || 1;
      const cos = (dx * torch.dir.x + dy * torch.dir.y + dz * torch.dir.z) / d;
      if (cos > 0.8 && d < range) k += ((cos - 0.8) / 0.2) * 1.1 / (1 + 0.06 * d * d);
    }
    return Math.min(1.4, k);
  };
}
