// Task office-overhaul-20261030 (lane ARCH): the office level's outdoor atmosphere hooks, installed into Game through its
// registries (one anchored line in game.ts; no other Game code):
//  - section preload: the office architecture textures (T4 wall, T1 carpet, T2 ceiling: world/officeArch.ts) before the build;
//  - the ROOF (layout role 'roof', lane STRUCT's storey above floor 8) is outdoors: while the eye is up there the scene fog
//    turns from the indoor near-black FogExp2 into the outdoor green murk (world/exterior.ts EXT_U.haze, a lighter density),
//    blended over the hatch climb so it never pops, and the city / sky stay shown (the tower runtime shows the exterior only
//    when a window is in view: on the roof there is none). Leaving the roof restores the indoor fog exactly.
// Uniform values only (no light / material / pipeline change); no per-frame allocation.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {MOOD, syncGlowFog} from './lights';
import {EXT_U, exteriorFogTune, type ExteriorFogTune} from './exterior';
import {preloadOfficeArch, type OfficeArch, type OfficeSurfaceMaterial} from './officeArch';

/** Scene fog on the roof: FogExp2 density (1/m). Colour = the outdoor murk (EXT_U.haze). */
export const ROOF_FOG = {density: 0.016, below: 0.6, above: 0.9} as const;

interface AtmosphereHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

/** Roof blend 0..1 for an eye at (x, y, z): 1 standing on the deck inside the tower footprint, 0 indoors; ramps over the hatch. */
export function roofBlend(x: number, y: number, z: number, roof: {baseY: number; foot: {x0: number; z0: number; x1: number; z1: number}} | null): number {
  if (!roof) return 0;
  const f = roof.foot;
  if (x < f.x0 - 1.5 || x > f.x1 + 1.5 || z < f.z0 - 1.5 || z > f.z1 + 1.5) return 0;
  const t = (y - (roof.baseY - ROOF_FOG.below)) / (ROOF_FOG.below + ROOF_FOG.above);
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

export class OfficeAtmosphere {
  private roof: {baseY: number; foot: {x0: number; z0: number; x1: number; z1: number}} | null = null;
  private exterior: THREE.Object3D | null = null;
  private searched = false;
  private applied = 0;
  private readonly eye = new THREE.Vector3();
  private readonly indoor = new THREE.Color(MOOD.fogColor);
  /** Current roof blend (QA). */
  blend = 0;

  constructor(private readonly host: AtmosphereHost) {
    host.sectionPreloads?.push(layout => preloadOfficeArch(layout));
    host.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    host.frameHooks.push(() => this.frame());
  }

  private build(layout: StationLayout): void {
    const o = layout.office;
    const roof = o?.roof;
    this.roof = roof && o ? {baseY: roof.baseY, foot: o.exterior} : null;
    this.exterior = null;
    this.searched = false;
    this.restore();
  }

  private teardown(): void {
    this.restore();
    this.roof = null;
    this.exterior = null;
  }

  /** Indoor fog back exactly (MOOD values). */
  private restore(): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && (fog as THREE.FogExp2).isFogExp2 && this.applied > 0) {
      fog.color.copy(this.indoor);
      fog.density = MOOD.fogDensity;
      syncGlowFog(fog);
    }
    this.applied = 0;
    this.blend = 0;
  }

  frame(): void {
    if (!this.roof) return;
    this.host.camera.getWorldPosition(this.eye);
    const k = roofBlend(this.eye.x, this.eye.y, this.eye.z, this.roof);
    this.blend = k;
    if (k <= 0) { if (this.applied > 0) this.restore(); return; }
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2 && Math.abs(k - this.applied) > 1e-3) {
      fog.color.copy(this.indoor).lerp(EXT_U.haze.value as THREE.Color, k);
      fog.density = MOOD.fogDensity + (ROOF_FOG.density - MOOD.fogDensity) * k;
      syncGlowFog(fog);
      this.applied = k;
    }
    // the city and the green sky stay shown up here (after the tower runtime's window check this frame); looked up once per
    // build, again only when the tower swapped its exterior root (late Meshy upgrade)
    if ((!this.exterior && !this.searched) || (this.exterior && !this.exterior.parent)) {
      this.searched = true;
      this.exterior = this.host.scene.getObjectByName('tower-exterior') ?? null;
    }
    if (this.exterior) this.exterior.visible = true;
  }
}

let installed: OfficeAtmosphere | null = null;

/** Installs the office atmosphere hooks (call once, after the tower runtime so its frame hook runs after the tower's). */
export function installOfficeAtmosphere(host: AtmosphereHost): OfficeAtmosphere {
  return (installed = new OfficeAtmosphere(host));
}

/**
 * QA hooks for short browser spot checks (spread into window.__LL by qa.ts: `...officeArchQaApi(game)`). Uniform values only:
 *  - exteriorFogTune({color, base, ground, height, range, noise, drift, skyline, sun, sky, zenith}) -> current values + mirror opacity;
 *  - officeArch() -> per-storey finish / wall / accent / carpet colours, material and accent-wall counts;
 *  - officeArchTune({level, wall, accent, carpet, peel}) -> recolour one storey's office materials live (sRGB hex);
 *  - roofFog() -> the current roof blend and scene fog.
 */
export function officeArchQaApi(game: {world?: {officeArch?: OfficeArch} | null; scene?: THREE.Scene}) {
  return {
    exteriorFogTune: (o: ExteriorFogTune = {}) => exteriorFogTune(o),
    officeArch: () => game.world?.officeArch?.summary() ?? null,
    officeArchTune: (o: {level: number; wall?: number; accent?: number; carpet?: number; peel?: number}) => {
      const a = game.world?.officeArch;
      if (!a) return null;
      const set = (key: string, hex: number | undefined, peel?: number) => {
        const m = a.material(key) as OfficeSurfaceMaterial | undefined;
        if (!m) return false;
        if (typeof hex === 'number') m.ofA.setHex(hex, THREE.SRGBColorSpace);
        if (typeof peel === 'number') m.ofQ.x = peel;
        return true;
      };
      return {wall: set(`office-wall@${o.level}`, o.wall, o.peel), accent: set(`office-accent@${o.level}`, o.accent, o.peel), carpet: set(`office-carpet@${o.level}`, o.carpet)};
    },
    roofFog: () => {
      const f = game.scene?.fog as THREE.FogExp2 | null | undefined;
      return {blend: installed?.blend ?? 0, density: f?.density ?? null, color: f?.color?.toArray() ?? null};
    },
  };
}
