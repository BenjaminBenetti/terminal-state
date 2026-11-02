// Task reactor-build-20261101 (lane ARCH): the Reactor's ARCH runtime, installed into Game through its registries (one anchored
// line in game.ts, like world/mallAtmosphere.ts):
//  - MODEL KEYS: Game.sectionModelKeys asks the lazy library for the lead's Reactor GLB kit on a Reactor layout (archAssets.ts);
//  - SECTION PRELOAD: on a Reactor layout the lead's Codex surface sets (archAssets.ts REACTOR_TEXTURES: colour / normal / ORM) load
//    behind the loading screen through LevelResources (level 'reactor': released when the run leaves the level) into the texture
//    store the reactor materials read while the world is built;
//  - SECTION BUILD / TEARDOWN: the pit is ONE open column ~60-80 m deep: with the subway's near-black FogExp2 (0.043 / m) the far
//    wall and the core would vanish from the rim. While a Reactor world is built the scene fog is a deep olive industrial haze
//    (REACTOR_FOG: ~75 % transmittance at 40 m, ~30 % at 80 m, ~7 % at 120 m — depth reads tier by tier), the glow cards follow,
//    the camera far plane rises past it and the level culler's fog distance matches; teardown restores the indoor values exactly and
//    unregisters the visuals (any other level keeps MOOD). Lane AIR's depth gas strata are a separate term (render/volumetric.ts).
//  - FRAME: the visuals' tick (fan spin / generator jitter / core glow ease; inert without a Reactor world).
// Uniform / camera values only besides the tick: no light set or pipeline change.

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import {MOOD, syncGlowFog} from '../lights';
import {fogCullDistance} from '../levelCulling';
import {REACTOR_LEVEL, reactorModelKeysFor, reactorTextureLoads, setReactorTexture} from './archAssets';
import {activeReactorArchVisuals, registerReactorArchVisuals} from './archVisuals';
import {releaseReactorMaterials} from './archMaterials';
import type {ReactorArch} from './arch';
import {wasteModelKeysFor} from './wasteAssets'; // task reactor-expansion-20261101 (lane WASTE)

/** The Reactor's scene fog (FogExp2): deep olive industrial haze, and the camera far plane. */
export const REACTOR_FOG = {density: 0.0135, color: 0x283020, far: 230} as const;

/** FogExp2 transmittance at distance d. */
export const reactorFogTransmittance = (d: number, density: number = REACTOR_FOG.density): number => Math.exp(-((d * density) ** 2));

interface LevelResourcesLike { load(level: string, url: string, spec: {srgb: boolean; repeat: boolean | 's'; anisotropy?: number}): Promise<THREE.Texture | null> }

export interface ReactorArchHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  /** Game.sectionModelKeys: the lazy model keys a section needs (the Reactor kit on a Reactor layout). */
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  levelResources?: LevelResourcesLike;
  world?: {culler?: {maxDistance: number}; reactorArch?: ReactorArch} | null;
}

export class ReactorArchRuntime {
  active = false;
  private farWas: number | null = null;
  /** Textures resolved by the last preload (QA). */
  textures = {loaded: 0, failed: 0};

  constructor(private readonly host: ReactorArchHost) {
    host.sectionModelKeys?.push(layout => reactorModelKeysFor(layout as {reactor?: unknown}));
    host.sectionModelKeys?.push(layout => wasteModelKeysFor(layout)); // task reactor-expansion-20261101 (lane WASTE): the waste repository's models
    host.sectionPreloads?.push(layout => this.preload(layout));
    host.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    host.frameHooks.push(dt => { const v = activeReactorArchVisuals(); if (v) v.tick(dt); });
  }

  /** The Codex surface sets behind the Reactor's loading screen (any other level: nothing). */
  async preload(layout: StationLayout): Promise<void> {
    if (!(layout as {reactor?: unknown}).reactor || !this.host.levelResources) return;
    const res = this.host.levelResources;
    const loads = reactorTextureLoads();
    const got = await Promise.all(loads.map(l => res.load(REACTOR_LEVEL, l.url, {srgb: l.srgb, repeat: true, anisotropy: l.map === 'color' ? 8 : 4})));
    this.textures = {loaded: 0, failed: 0};
    loads.forEach((l, i) => { setReactorTexture(l.slot, l.map, got[i]); if (got[i]) this.textures.loaded++; else this.textures.failed++; });
  }

  build(layout: StationLayout): void {
    if (!(layout as {reactor?: unknown}).reactor) { this.restore(); releaseReactorMaterials(); return; }
    this.apply(REACTOR_FOG.density, REACTOR_FOG.color);
  }

  teardown(): void {
    this.host.world?.reactorArch?.dispose();
    registerReactorArchVisuals(null);
    this.restore();
  }

  /** Reactor fog / far plane / culler distance (density, colour: tunable from QA). */
  apply(density: number, color: number): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && (fog as THREE.FogExp2).isFogExp2) {
      fog.density = density;
      fog.color.setHex(color);
      syncGlowFog(fog);
    }
    const cam = this.host.camera;
    if (this.farWas === null) this.farWas = cam.far;
    cam.far = Math.max(this.farWas, REACTOR_FOG.far);
    cam.updateProjectionMatrix();
    const culler = this.host.world?.culler;
    if (culler) culler.maxDistance = Math.min(fogCullDistance(density), REACTOR_FOG.far);
    this.active = true;
  }

  /** The indoor values back exactly (MOOD fog, the original far plane). */
  restore(): void {
    if (!this.active) return;
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && (fog as THREE.FogExp2).isFogExp2) {
      fog.density = MOOD.fogDensity;
      fog.color.setHex(MOOD.fogColor);
      syncGlowFog(fog);
    }
    if (this.farWas !== null) { this.host.camera.far = this.farWas; this.host.camera.updateProjectionMatrix(); }
    this.farWas = null;
    this.active = false;
  }
}

let installed: ReactorArchRuntime | null = null;

/** Installs the Reactor ARCH runtime (call once at startup; inert outside the Reactor). */
export function installReactorArch(host: ReactorArchHost): ReactorArchRuntime {
  return (installed = new ReactorArchRuntime(host));
}

/** QA hooks (qa.ts `__LL`): the kit summary / draw cost, the fog tune, the visuals API. */
export function reactorArchQaApi(game: {world?: {reactorArch?: ReactorArch} | null; layout?: StationLayout; scene?: THREE.Scene}) {
  return {
    reactorArch: () => game.world?.reactorArch?.summary() ?? null,
    reactorFog: (o: {density?: number; color?: number} = {}) => {
      if (!installed || !(game.layout as {reactor?: unknown} | undefined)?.reactor) return null;
      installed.apply(o.density ?? REACTOR_FOG.density, o.color ?? REACTOR_FOG.color);
      const f = game.scene?.fog as THREE.FogExp2 | null | undefined;
      return {density: f?.density ?? null, color: f?.color?.getHex() ?? null, t40: reactorFogTransmittance(40, f?.density), t80: reactorFogTransmittance(80, f?.density), textures: installed.textures};
    },
    /** DEBUG: drive the visuals directly (fan / generator / core / tier) — what AIR / RESTART do through reactorVisuals(). */
    reactorVisualsSet: (o: {fan?: [number, number]; generator?: [number, number]; core?: number; tier?: [number, number]} = {}) => {
      const v = activeReactorArchVisuals();
      if (!v) return null;
      if (o.fan) v.setFanSpeed(o.fan[0], o.fan[1]);
      if (o.generator) v.setGeneratorRunning(o.generator[0], o.generator[1]);
      if (o.core !== undefined) v.setCoreGlow(o.core);
      if (o.tier) v.setTierPower(o.tier[0], o.tier[1]);
      return v.state();
    },
  };
}
