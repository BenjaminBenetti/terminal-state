// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's outdoor toxic air in the SCENE FOG — the Office roof's
// rule (world/officeAtmosphere.ts): while the eye stands in the outdoor air, the scene's FogExp2 turns to the outdoor green murk (world/
// exterior.ts EXT_FOG.color, ROOF_FOG.density), weighted by the SAME outdoor weight the exposure and the volumetric march read
// (world/surface/airMask.ts outdoorWeight at the eye). It is always drawn, so the gas stays visible on every material with the
// volumetric pass off / unsupported (the in-engine fallback), on both backends; inside an intact building the weight is 0 and the base
// fog is back exactly. Whatever the district's look (lane LOOK) sets as its base fog is adopted (a change since our last write = a new
// base); the mask never changes it, nor does sitting in the truck (the gas still shows around it). Uniform values only.

//
// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): a version-2 district's FOG PRESSURE at the eye (world/surface/
// airMask.ts surfacePressureAt: the field x the outdoor weight x the bank) thickens and greens this murk by the SAME density the march
// draws (world/surface/fogAir.ts fogDensity) — handed in only while the volumetric pass is NOT drawing the gas (world/surface/air.ts):
// the in-engine fallback shows the outer fog wherever the eye stands in it. 0 (every v1 district, the pass on) = exactly as before.

import * as THREE from 'three';
import {syncGlowFog} from '../lights';
import {EXT_FOG} from '../exterior';
import {ROOF_FOG} from '../roofAir';
import {GAS_FALLBACK} from '../gaslightRules';
import {FOG_AIR, fogDensity} from './fogAir';
import {SURFACE_AIR} from './airMask';

/** The outdoor murk (linear rgb, three's working space) and density (FogExp2, 1/m) at weight 1. */
export const SURFACE_FOG = {color: EXT_FOG.color as readonly [number, number, number], density: ROOF_FOG.density} as const;

/**
 * The fog at outdoor weight k over a base fog (pure: the tests read it). Never thinner than the base. (lane FOG) `p` = the fog pressure at
 * the eye (the fallback's: 0 with the pass on / in a v1 district): the density x (1 + fallbackGain (fogDensity − 1)), the colour toward
 * the gas fallback's green by the pressure (capped).
 */
export function surfaceFogAt(k: number, base: {color: readonly [number, number, number]; density: number}, p = 0): {color: [number, number, number]; density: number} {
  const w = Math.max(0, Math.min(1, k)), c = SURFACE_FOG.color;
  const out: {color: [number, number, number]; density: number} = {
    color: [base.color[0] + (c[0] - base.color[0]) * w, base.color[1] + (c[1] - base.color[1]) * w, base.color[2] + (c[2] - base.color[2]) * w],
    density: Math.max(base.density, base.density + (SURFACE_FOG.density - base.density) * w),
  };
  if (p > 0) {
    // (the street-level bank: `p` already carries the eye's bank and outdoor weight)
    out.density *= 1 + FOG_AIR.fallbackGain * (fogDensity(SURFACE_AIR.C, p, 0) - 1);
    const b = Math.min(FOG_AIR.fallbackBlend, p * FOG_AIR.fallbackBlend), g = GAS_FALLBACK.color;
    for (let i = 0; i < 3; i++) out.color[i] += (g[i] - out.color[i]) * b;
  }
  return out;
}

export class SurfaceAirFog {
  /** Current weight applied (QA). */
  k = 0;
  /** (lane FOG) Current fallback fog pressure applied (QA). */
  p = 0;
  private fog: THREE.FogExp2 | null = null;
  private applied = false;
  private readonly base = new THREE.Color();
  private baseDensity = 0;
  private readonly wrote = new THREE.Color();
  private wroteDensity = 0;

  constructor(private readonly scene: THREE.Scene) {}

  private ours(fog: THREE.FogExp2): boolean {
    return this.applied && fog.density === this.wroteDensity && fog.color.equals(this.wrote);
  }

  /** Per frame: blend the scene fog toward the outdoor murk by k (the eye's outdoor weight); (lane FOG) + the fallback's eye pressure p. */
  apply(k: number, p = 0): void {
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (!fog || !fog.isFogExp2) { this.fog = null; this.applied = false; this.k = 0; this.p = 0; return; }
    // a new fog, or not (or no longer) our write: what is there now is the base (the district look's own fog / a mood change)
    if (fog !== this.fog || !this.ours(fog)) {
      this.fog = fog;
      this.base.copy(fog.color);
      this.baseDensity = fog.density;
      this.applied = false;
      this.k = 0;
      this.p = 0;
    }
    const w = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
    const q = Math.max(0, Number.isFinite(p) ? p : 0);
    if (w <= 1e-3 && q <= 1e-3) { this.restore(); return; }
    if (this.applied && Math.abs(w - this.k) < 1e-3 && Math.abs(q - this.p) < 1e-3) return;
    const f = surfaceFogAt(w, {color: [this.base.r, this.base.g, this.base.b], density: this.baseDensity}, q);
    fog.color.setRGB(f.color[0], f.color[1], f.color[2]);
    fog.density = f.density;
    syncGlowFog(fog);
    this.wrote.copy(fog.color);
    this.wroteDensity = fog.density;
    this.applied = true;
    this.k = w;
    this.p = q;
  }

  /** The base fog back exactly (teardown / leaving the outdoor air); a fog someone else has written since is left alone. */
  restore(): void {
    const fog = this.fog;
    if (fog && this.ours(fog)) {
      fog.color.copy(this.base);
      fog.density = this.baseDensity;
      syncGlowFog(fog);
    }
    this.applied = false;
    this.k = 0;
    this.p = 0;
  }
}
