// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): THE SURFACE's OUTSIDE VISUALS at runtime — the ruined city,
// the rain, the clear sky / air round the roof aperture once the reactor is ONLINE. installReactorSurface(game) is called ONCE from
// the Game constructor right after the startup runtime (it reads STARTUP's shown state each frame) and only REGISTERS; it is inert on
// every level without `layout.reactor`.
//  - sectionModelKeys: the kit registry's models (surfaceKit.ts) behind the Reactor's loading screen (the lazy library; nothing fetched
//    mid-play);
//  - sectionHooks.build: plan (surfacePlan.ts, seeded) -> build (surfaceCity.ts) one group into the scene, hidden; warm pool
//    'reactor-surface' (compiled behind the loading screen, never on the first step outside);
//  - frameHooks (after STARTUP's): THE EYE GATE (surfaceSite.ts) — inside the pit the outdoor group is invisible (0 draws); outside:
//    the city, the outdoor sky (following the eye), the near rain, the wet look, and the pit's olive FogExp2 swapped for the light rain
//    mist (restored exactly on the way back in); in the pit after the win only the rain falling through the aperture (one draw).
//    The clearing / rain follow STARTUP's ONLINE sky (startupPlan.ts skyClearAt via ReactorStartup.shown.clear): nothing before the
//    win, a restored restarted world is wet at once. The city stays ruined; nothing here touches enemies, gas or the hazard.
//  - AMBIENCE FLAG for lane AUDIO: reactorSurfaceAmbience() = {outside, open, rain} (the visuals' own gate; AUDIO's listener rule
//    audioRain.ts surfaceRainExposure covers the same regions: plaza open, head house / stair sheltered, the pit silent).

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import {REACTOR_FOG} from './archInstall';
import {reactorStartupOf} from './startup';
import {reactorTexture} from './archAssets';
import {surfaceModelKeys, SURFACE_KIT} from './surfaceKit';
import {planSurfaceCity, type SurfaceCityPlan} from './surfacePlan';
import {planSurfacePlant, type SurfacePlantPlan} from './surfacePlantPlan';
import {buildSurfacePlant, type SurfacePlantView} from './surfacePlant';
import {surfaceEyeOpen, surfaceEyeOutside, surfaceSiteOf, type SurfaceSite} from './surfaceSite';
import {buildSurfaceView, disposeSurfaceView, type SurfaceView} from './surfaceCity';
import {SURFACE_LOOK, SURF_U, surfaceTune} from './surfaceLook';
import {SURFACE_RAIN} from './surfaceRain';
import {BEAM} from './startupSky';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

/** The runtime's tunables (s, m). */
export const SURFACE_RT = {
  /** Rain starts as the sky clears: rain = smoothstep(rainFrom, 1, clear). Wetness builds over wetS (a restored world: at once). */
  rainFrom: 0.3, wetS: 18,
  /** The aperture column is drawn from inside the pit within this horizontal distance of the opening. */
  columnReach: 70,
  /** Outside, the scene FogExp2 eases to the rain mist over this long (s). */
  fogS: 1.2,
  /** The beam meets the cloud deck this high over the deck (the outdoor sky's glow point; the beam itself ends at BEAM.aboveRoof). */
  cloudBase: BEAM.aboveRoof - 10,
  /** Outside, the camera far plane rises to this (the city reaches SURFACE_CITY.maxR 175 m round the opening, the sky dome 320 m round the eye; the pit keeps archInstall.ts REACTOR_FOG.far 230). */
  far: 360,
} as const;

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface SurfaceHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  propModels?: {get(key: string): GLTF | undefined};
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  renderer?: {domElement?: {height?: number}};
}

/** The surface ambience for lane AUDIO (and QA): the eye outside (city visible), in the open air (not sheltered), the rain 0..1. */
export interface SurfaceAmbience { outside: boolean; open: boolean; rain: number }
const ambience: SurfaceAmbience = {outside: false, open: false, rain: 0};
/** Lane AUDIO's read hook (a live object: read, never keep a copy across frames). */
export const reactorSurfaceAmbience = (): Readonly<SurfaceAmbience> => ambience;

const runtimes = new WeakMap<object, ReactorSurface>();
/** The runtime installed into a host (QA / tests). */
export const reactorSurfaceOf = (host: object): ReactorSurface | undefined => runtimes.get(host);

export class ReactorSurface {
  site: SurfaceSite | null = null;
  plan: SurfaceCityPlan | null = null;
  /** The plant round the aperture (surfacePlantPlan.ts): vent towers, reserved lots. */
  plant: SurfacePlantPlan | null = null;
  /** The pit's shaft rect (the aperture column is drawn only with the eye in it). */
  pit: {x0: number; z0: number; x1: number; z1: number} | null = null;
  view: SurfaceView | null = null;
  /** The plant's view (surfacePlant.ts: the compound wall, the duct runs, the vent towers and their spinning fans) under view.outdoor. */
  plantView: SurfacePlantView | null = null;
  /** The last shown state (QA / tests). */
  readonly shown = {outside: false, open: false, clear: 0, rain: 0, wet: 0, column: false, near: false, fogged: false, beam: 0};
  readonly counts = {builds: 0, frames: 0};
  /** Read STARTUP's ONLINE state (tests replace it): the sky clearing 0..1 and the beam's brightness. */
  findSky: () => {clear: number; beam: number} = () => {
    const s = reactorStartupOf(this.host)?.shown;
    return {clear: s?.clear ?? 0, beam: s?.beam ?? 0};
  };
  private fogKeep: {density: number; color: THREE.Color} | null = null;
  private farKeep: number | null = null;
  private gust = 0;
  private wetInit = false;
  private readonly eye = new THREE.Vector3();

  constructor(readonly host: SurfaceHost) {}

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    h.sectionModelKeys?.push(layout => (layout.reactor ? surfaceModelKeys() : []));
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.warmRegistry?.addPool('reactor-surface', () => (this.view ? [this.view.root] : []));
    return this;
  }

  build(layout: StationLayout): void {
    if (this.view) this.teardown();
    const site = surfaceSiteOf(layout);
    if (!site || !layout.reactor) return;
    const lib = this.host.propModels;
    this.site = site;
    this.pit = {...layout.reactor.pit.bounds};
    // (task reactor-surface-redesign-credits-20261103: the plant first — its towers / structures reserve their lots in the city)
    this.plant = planSurfacePlant(site, layout.seed >>> 0, layout.reactor.pit.bounds);
    this.plan = planSurfaceCity(site, layout.seed >>> 0, key => !!lib?.get(key), layout.reactor.pit.bounds, this.plant.reserved);
    this.view = buildSurfaceView(site, this.plan, key => lib?.get(key), (reactorTexture('pitConcrete', 'color') as THREE.Texture | undefined) ?? null, layout.seed >>> 0, SURFACE_KIT);
    SURF_U.beam.value.set(site.hole.x, site.hole.z, 0, 0);
    SURF_U.beamTop.value.set(site.hole.x, site.y + SURFACE_RT.cloudBase, site.hole.z);
    for (const L of [this.view.near, this.view.column]) L.u.beam.value.set(site.hole.x, site.hole.z, 0, 0);
    this.plantView = buildSurfacePlant(site, this.plant, key => lib?.get(key));
    this.view.outdoor.add(this.plantView.root);
    this.host.scene.add(this.view.root);
    this.view.root.visible = true;
    this.view.outdoor.visible = false;
    this.wetInit = false;
    this.counts.builds++;
  }

  teardown(): void {
    this.restoreFog();
    this.applyFar(false);
    this.plantView?.dispose();
    this.plantView = null;
    if (this.view) disposeSurfaceView(this.view);
    this.view = null;
    this.site = null;
    this.plan = null;
    this.plant = null;
    ambience.outside = ambience.open = false;
    ambience.rain = 0;
    SURF_U.wet.value = 0;
  }

  /** Per frame (while playing; after STARTUP's frame). */
  frame(dt: number): void {
    const v = this.view, site = this.site;
    if (!v || !site) return;
    this.counts.frames++;
    const cam = this.host.camera, eye = cam.getWorldPosition(this.eye);
    const {clear, beam} = this.findSky();
    const t = Math.min(1, Math.max(0, (clear - SURFACE_RT.rainFrom) / (1 - SURFACE_RT.rainFrom))), rain = t * t * (3 - 2 * t);
    // wetness: builds with the rain; a world built already restarted (clear at 1 on its first frame) is wet at once
    if (!this.wetInit) { SURF_U.wet.value = rain >= 1 ? 1 : 0; this.wetInit = true; }
    const wet = SURF_U.wet.value as number;
    SURF_U.wet.value = rain > wet ? Math.min(rain, wet + dt / SURFACE_RT.wetS) : rain;
    SURF_U.skyOn.value = clear;
    SURF_U.beam.value.z = beam;
    const outside = surfaceEyeOutside(site, eye), open = outside && surfaceEyeOpen(site, eye);
    v.outdoor.visible = outside;
    this.plantView?.tick(dt, outside, clear); // (the fans spool up when the surface first shows ONLINE, then turn steadily)
    // the near rain round the eye (outside) / the column through the aperture (from the pit)
    this.gust += dt;
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(240, this.host.renderer?.domElement?.height ?? 1080);
    const nearOn = outside && rain > 0.001;
    v.near.mesh.visible = nearOn;
    if (nearOn) { v.near.follow(eye); v.near.tick(dt, this.gust); v.near.u.on.value = rain; v.near.u.px.value = px; v.near.u.beam.value.z = beam; }
    // (in the pit's open shaft only: never from the rock rooms / complexes behind its walls)
    const pb = this.pit, inShaft = !!pb && eye.x > pb.x0 - 1 && eye.x < pb.x1 + 1 && eye.z > pb.z0 - 1 && eye.z < pb.z1 + 1;
    const colOn = !outside && rain > 0.001 && inShaft && Math.hypot(eye.x - site.hole.x, eye.z - site.hole.z) < SURFACE_RT.columnReach && eye.y < site.y;
    v.column.mesh.visible = colOn;
    if (colOn) { v.column.tick(dt, this.gust); v.column.u.on.value = rain; v.column.u.px.value = px; v.column.u.beam.value.z = beam; }
    if (outside) {
      v.sky.position.copy(eye);
      v.sky.updateMatrix();
      // STARTUP's cleared-sky dome over the opening (r 140) would paint over the far city: the outdoor sky replaces it out here
      const dome = reactorStartupOf(this.host)?.sky?.dome;
      if (dome && clear > 0) dome.visible = false;
    }
    this.applyFog(outside ? clear : 0, dt);
    this.applyFar(outside);
    const s = this.shown;
    s.outside = outside; s.open = open; s.clear = clear; s.rain = rain; s.wet = SURF_U.wet.value as number; s.column = colOn; s.near = nearOn; s.beam = beam;
    ambience.outside = outside; ambience.open = open; ambience.rain = rain;
  }

  /** Outside after the win: the pit's olive FogExp2 eases to the light rain mist (uniform values only); inside: back exactly. */
  private applyFog(k: number, dt: number): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (!fog || !(fog as THREE.FogExp2).isFogExp2) return;
    if (k <= 0.001) { this.restoreFog(); return; }
    if (!this.fogKeep) this.fogKeep = {density: fog.density, color: fog.color.clone()};
    const a = Math.min(1, dt / SURFACE_RT.fogS), H = SURFACE_LOOK.horizon;
    const wantD = this.fogKeep.density + (SURFACE_LOOK.mist - this.fogKeep.density) * k;
    fog.density += (wantD - fog.density) * a;
    fog.color.lerp(new THREE.Color().copy(this.fogKeep.color).lerp(new THREE.Color(H[0], H[1], H[2]), k), a);
    this.shown.fogged = true;
  }

  /**
   * Outside: the far plane rises to SURFACE_RT.far (depth precision near the eye is set by the near plane: unchanged); back in the pit
   * it returns to the value it had — only if it is still ours (another section hook may already have restored its own on teardown).
   */
  private applyFar(outside: boolean): void {
    const cam = this.host.camera;
    if (outside && this.farKeep === null && cam.far < SURFACE_RT.far) { this.farKeep = cam.far; cam.far = SURFACE_RT.far; cam.updateProjectionMatrix(); }
    else if (!outside && this.farKeep !== null) {
      if (cam.far === SURFACE_RT.far) { cam.far = this.farKeep; cam.updateProjectionMatrix(); }
      this.farKeep = null;
    }
  }

  private restoreFog(): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (this.fogKeep && fog && (fog as THREE.FogExp2).isFogExp2) { fog.density = this.fogKeep.density; fog.color.copy(this.fogKeep.color); }
    this.fogKeep = null;
    this.shown.fogged = false;
  }

  /** QA: state, the plan's census, draw / triangle costs; `tune` = surfaceLook.ts uniforms. */
  qa(tune?: Parameters<typeof surfaceTune>[0]): object {
    const v = this.view, p = this.plan;
    let draws = 0;
    v?.root.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible) { let a: THREE.Object3D | null = o, vis = true; while (a) { if (!a.visible) vis = false; a = a.parent; } if (vis) draws++; } });
    return {
      site: this.site ? {contract: this.site.contract, level: this.site.level, y: this.site.y, hole: this.site.hole, walk: this.site.walk.length, edges: this.site.edges.length} : null,
      shown: {...this.shown}, plan: p?.stats ?? null, drawn: v?.drawn ?? null, meshes: v ? v.instanced.length + 6 : 0, visibleMeshes: draws, tris: v?.tris ?? 0,
      rain: v ? {near: v.near.stats(), column: v.column.stats(), floor: {w: v.floor.w, h: v.floor.h}} : null, look: surfaceTune(tune ?? {}), fogDefault: REACTOR_FOG,
      caps: {nearDrops: SURFACE_RAIN.near.count, columnDrops: SURFACE_RAIN.column.count},
      plant: this.plantView ? {...this.plantView.stats, started: this.plantView.started, speed: this.plantView.fans.map(f => +f.speed.toFixed(3)), angle: this.plantView.fans.map(f => +f.angle.toFixed(3))} : null,
    };
  }
}

/** Installs the surface runtime into a Game (one call in the Game constructor, right after installReactorStartup). */
export function installReactorSurface(host: SurfaceHost): ReactorSurface {
  return new ReactorSurface(host).install();
}
