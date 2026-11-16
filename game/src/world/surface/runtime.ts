/** Local expedition presentation. Underground builds contain only their closed access door, never a city scene or city tick. */
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceAccess, SurfaceInfo, SurfacePose} from '../../gen/surface/types';
import type {SectionKey} from '../../levels/types';
import type {WorldMaterials} from '../materials';
import {SurfaceNodeMaterial, surfaceMaterial} from '../materials';
import {tagReflect} from '../../render/reflectTag';
import {fogCullDistance} from '../levelCulling';
import {ROOF_FOG} from '../roofAir';
import {syncGlowFog} from '../lights';
import {drawSurfaceMap, exploreSurface, readSurfaceExploration, surfaceMapState, SURFACE_EXPLORATION_LANE, type SurfaceExploration, type SurfaceMapState} from '../../ui/surfaceMap';
import {buildSurfaceCity, surfaceCityModelKeysFor, type SurfaceCityView} from './city';
import {preloadSurfaceArch} from './arch';

export interface SurfaceRunHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  flashlight?: THREE.SpotLight;
  player: {x: number; y: number; z: number; yaw: number; alive: boolean};
  layout: StationLayout;
  mats: WorldMaterials;
  propModels: {get(key: string): GLTF | undefined};
  world?: {culler: {maxDistance: number}};
  skywaysCar?: {body: {x: number; z: number; yaw: number} | null; driving: boolean};
  state: string;
  run: {
    current: SectionKey;
    laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined;
    setLaneStore(lane: string, data: unknown, key?: SectionKey): void;
  };
  surfaceTravel(section: 'surface' | 'main'): Promise<{ok: boolean; reason?: string}>;
  hud: {toast(text: string, warn?: boolean): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sectionModelKeys?: ((layout: StationLayout) => readonly string[])[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  promptProviders?: (() => string | null)[];
  interactHandlers: (() => boolean)[];
  inputOwners?: (() => boolean)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  warmRegistry: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  warming?: boolean;
}

const SKY_COLOR = 0x263128;
const MAP_W = 1200, MAP_H = 930;

/** The closed leaf sits against the top landing's real exterior wall. */
export function surfaceAccessDoorPose(access: SurfacePose, returning = false): SurfacePose {
  const distance = returning ? -1.1 : 0.7;
  return {...access, x: access.x - Math.sin(access.yaw) * distance, z: access.z - Math.cos(access.yaw) * distance, yaw: access.yaw + (returning ? Math.PI : 0)};
}

function doorView(pose: SurfacePose): {root: THREE.Group; dispose(): void} {
  const root = new THREE.Group(); root.name = 'surface-expedition-airlock';
  root.position.set(pose.x, pose.y, pose.z); root.rotation.y = pose.yaw;
  const geo = new THREE.BoxGeometry(1, 1, 1), mat = tagReflect(surfaceMaterial('paintedSteel', {color: 0x626958, metalness: 0.25}, {grime: [0.3, 0.8], macro: 0.08}), 'metal');
  const handle = tagReflect(surfaceMaterial('brushedSteel', {color: 0x8d8e7e, metalness: 0.6}), 'metal');
  const add = (x: number, y: number, z: number, w: number, h: number, d: number, material = mat) => {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = m.receiveShadow = true; root.add(m);
  };
  add(0, 1.275, 0, 1.4, 2.55, 0.12);
  add(-0.75, 1.325, 0, 0.1, 2.65, 0.2); add(0.75, 1.325, 0, 0.1, 2.65, 0.2); add(0, 2.6, 0, 1.6, 0.1, 0.2);
  add(0.44, 1.1, 0.105, 0.11, 0.1, 0.12, handle);
  let text: THREE.CanvasTexture | null = null, textMat: SurfaceNodeMaterial | null = null, textGeo: THREE.PlaneGeometry | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#333e31'; ctx.fillRect(0, 0, 512, 256); ctx.strokeStyle = '#b6ad7c'; ctx.lineWidth = 10; ctx.strokeRect(7, 7, 498, 242);
      ctx.fillStyle = '#ddd6ac'; ctx.textAlign = 'center'; ctx.font = 'bold 46px monospace'; ctx.fillText('SURFACE RUN', 256, 83);
      ctx.font = '27px monospace'; ctx.fillText('CHECKPOINT ACCESS', 256, 135); ctx.fillText('TOXIC AIR OUTSIDE', 256, 181);
      ctx.font = '22px monospace'; ctx.fillText('KEEP THIS DOOR SEALED', 256, 224);
      text = new THREE.CanvasTexture(c); text.colorSpace = THREE.SRGBColorSpace;
      textMat = new SurfaceNodeMaterial({map: text, roughness: 0.94}); textGeo = new THREE.PlaneGeometry(1.18, 0.59);
      const face = new THREE.Mesh(textGeo, textMat); face.position.set(0, 1.87, 0.071); root.add(face);
    }
  }
  return {root, dispose() {root.removeFromParent(); geo.dispose(); mat.dispose(); handle.dispose(); text?.dispose(); textMat?.dispose(); textGeo?.dispose();}};
}

const runtimes = new WeakMap<object, SurfaceRunRuntime>();
export const surfaceRunOf = (host: object): SurfaceRunRuntime | undefined => runtimes.get(host);

export class SurfaceRunRuntime {
  city: SurfaceCityView | null = null;
  info: SurfaceInfo | null = null;
  access: SurfaceAccess | SurfacePose | null = null;
  mapOpen = false;
  readonly stats = {builds: 0, frames: 0, mapDraws: 0, opens: 0, transitions: 0, active: false};
  private explored: SurfaceExploration = {v: 1, blocks: [], destinations: []};
  private key: SectionKey | null = null;
  private door: ReturnType<typeof doorView> | null = null;
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapTexture: THREE.CanvasTexture | null = null;
  private overlay: HTMLDivElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private exploreIn = 0;
  private drawIn = 0;
  private airApplied = false;
  private oldBackground: THREE.Scene['background'] = null;
  private oldFog: THREE.Scene['fog'] = null;
  private oldFar = 0;
  private oldCuller: {maxDistance: number} | null = null;
  private oldCullDistance = 0;
  private readonly eye = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly skyColor = new THREE.Color(SKY_COLOR);

  constructor(readonly host: SurfaceRunHost) {}

  install(): this {
    const h = this.host; runtimes.set(h, this);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.sectionModelKeys?.push(surfaceCityModelKeysFor);
    h.sectionPreloads?.push(preloadSurfaceArch);
    // Installed after truck cargo: the access door claims E before "put down" while carrying salvage through it.
    h.interactHandlers.unshift(() => this.interact());
    h.promptProviders?.unshift(() => this.prompt());
    h.inputOwners?.push(() => this.mapOpen);
    h.stateListeners?.push(((state: string) => {if (state !== 'playing') this.closeMap();}) as (s: never, p: never) => void);
    h.warmRegistry.addPool('surface-run-city', () => this.city ? [this.city.root] : []);
    h.warmRegistry.addPool('surface-run-access', () => this.door ? [this.door.root] : []);
    return this;
  }

  build(layout: StationLayout): void {
    this.teardown();
    this.stats.builds++;
    this.key = {...this.host.run.current};
    this.info = layout.surface ?? null;
    this.access = this.info?.checkpoint.return ?? layout.surfaceAccess ?? null;
    if (this.access) {
      this.door = doorView(surfaceAccessDoorPose(this.access, !!this.info));
      this.host.scene.add(this.door.root); this.host.atmosphere?.markShadows(this.door.root, true);
    }
    if (!this.info) return;
    this.stats.active = true;
    this.explored = readSurfaceExploration(this.host.run.laneStore(SURFACE_EXPLORATION_LANE, this.key), this.info);
    if (typeof document !== 'undefined') {
      this.mapCanvas = document.createElement('canvas'); this.mapCanvas.width = MAP_W; this.mapCanvas.height = MAP_H;
      this.mapTexture = new THREE.CanvasTexture(this.mapCanvas); this.mapTexture.colorSpace = THREE.SRGBColorSpace;
    }
    this.city = buildSurfaceCity(layout, this.host.mats, this.host.propModels, this.mapTexture);
    if (this.city) {this.host.scene.add(this.city.root); this.host.atmosphere?.markShadows(this.city.root, true);}
    this.oldBackground = this.host.scene.background;
    this.oldFog = this.host.scene.fog?.clone() ?? null;
    this.oldFar = this.host.camera.far;
    this.oldCuller = this.host.world?.culler ?? null; this.oldCullDistance = this.oldCuller?.maxDistance ?? 0;
    this.airApplied = true;
    this.applyAir();
    this.drawMap();
    this.beforeRender();
  }

  private applyAir(): void {
    if (!this.info || !this.airApplied) return;
    const h = this.host;
    h.scene.background = this.skyColor;
    if (!h.scene.fog || !(h.scene.fog as THREE.FogExp2).isFogExp2) h.scene.fog = new THREE.FogExp2(this.skyColor, ROOF_FOG.density);
    const fog = h.scene.fog as THREE.FogExp2;
    fog.color.copy(this.skyColor); fog.density = ROOF_FOG.density; syncGlowFog(fog);
    if (h.world) h.world.culler.maxDistance = fogCullDistance(fog.density);
    const far = Math.max(this.oldFar, 160);
    if (h.camera.far !== far) {h.camera.far = far; h.camera.updateProjectionMatrix();}
  }

  private saveExploration(): void {
    if (this.info && this.key) this.host.run.setLaneStore(SURFACE_EXPLORATION_LANE, structuredClone(this.explored), this.key);
  }

  teardown(): void {
    this.saveExploration(); this.closeMap();
    this.overlay?.remove(); this.overlay = null; this.overlayCanvas = null;
    this.city?.dispose(); this.city = null;
    this.door?.dispose(); this.door = null;
    this.mapTexture?.dispose(); this.mapTexture = null; this.mapCanvas = null;
    if (this.airApplied) {
      const h = this.host, fog = h.scene.fog;
      h.scene.background = this.oldBackground;
      if (fog && this.oldFog && (fog as THREE.FogExp2).isFogExp2 && (this.oldFog as THREE.FogExp2).isFogExp2) {
        fog.color.copy(this.oldFog.color); (fog as THREE.FogExp2).density = (this.oldFog as THREE.FogExp2).density;
      } else h.scene.fog = this.oldFog;
      syncGlowFog(h.scene.fog);
      if (h.camera.far !== this.oldFar) {h.camera.far = this.oldFar; h.camera.updateProjectionMatrix();}
      if (this.oldCuller) this.oldCuller.maxDistance = this.oldCullDistance;
    }
    this.airApplied = false; this.oldFog = null; this.oldBackground = null; this.oldCuller = null;
    this.info = null; this.access = null; this.key = null;
    this.stats.active = false;
    this.drawIn = this.exploreIn = 0;
  }

  mapState(): SurfaceMapState | null {
    return this.info ? surfaceMapState(this.info, this.explored, this.host.player, this.host.skywaysCar?.body ?? null) : null;
  }

  /** Final camera/torch cull. The explicit override is only for warm-up's final view after all hidden variants are prepared. */
  beforeRender(finalWarmupView = false): void {
    if (!this.info || this.host.warming && !finalWarmupView) return;
    this.applyAir();
    const light = this.host.flashlight;
    if (light && light.intensity > 0) {
      light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false); light.shadow.updateMatrices(light);
    }
    this.city?.sectors.update(this.host.camera, ROOF_FOG.density, true, light && light.intensity > 0 ? light.shadow.camera : null);
  }

  frame(dt: number): void {
    if (!this.info && !this.access) return;
    if (this.host.state !== 'playing' || !this.host.player.alive) {this.closeMap(); return;}
    if (!this.info) return;
    this.stats.frames++;
    this.applyAir();
    this.exploreIn -= dt; this.drawIn -= dt;
    if (this.exploreIn <= 0) {
      this.exploreIn = 0.25;
      if (exploreSurface(this.explored, this.info, this.host.player)) this.saveExploration();
    }
    if (this.mapOpen && !this.mapAimed()) this.closeMap();
    const map = this.info.checkpoint.map;
    if (this.drawIn <= 0 && (this.mapOpen || Math.hypot(this.host.player.x - map.x, this.host.player.z - map.z) < 18)) {this.drawIn = 0.5; this.drawMap();}
  }

  private drawMap(): void {
    const state = this.mapState(); if (!state) return;
    const ctx = this.mapCanvas?.getContext('2d');
    if (ctx) {drawSurfaceMap(ctx, state, MAP_W, MAP_H); if (this.mapTexture) this.mapTexture.needsUpdate = true; this.stats.mapDraws++;}
    const overlayCtx = this.overlayCanvas?.getContext('2d');
    if (overlayCtx && this.mapOpen) drawSurfaceMap(overlayCtx, state, MAP_W, MAP_H);
  }

  private aimed(at: {x: number; y: number; z: number}, reach: number, look: number): boolean {
    const h = this.host;
    if (h.state !== 'playing' || !h.player.alive || h.skywaysCar?.driving) return false;
    h.camera.getWorldPosition(this.eye); h.camera.getWorldDirection(this.direction);
    const dx = at.x - this.eye.x, dy = at.y - this.eye.y, dz = at.z - this.eye.z, distance = Math.hypot(dx, dy, dz);
    return distance <= reach && distance > 0.05 && (dx * this.direction.x + dy * this.direction.y + dz * this.direction.z) / distance >= look;
  }

  accessAimed(): boolean {
    if (!this.access) return false;
    const door = surfaceAccessDoorPose(this.access, !!this.info);
    return Math.abs(this.host.player.y - door.y) < 1 && this.aimed({x: door.x, y: door.y + 1.25, z: door.z}, 3, 0.68);
  }

  mapAimed(): boolean {
    const map = this.info?.checkpoint.map;
    return !!map && Math.abs(this.host.player.y - this.info!.checkpoint.y) < 1 && this.aimed({x: map.x, y: map.y + 0.05, z: map.z}, 3.3, 0.72);
  }

  prompt(): string | null {
    if (this.mapOpen) return '<b>[E]</b> Fold the operations map';
    if (this.accessAimed()) return this.info ? '<b>[E]</b> Return underground · train and supplies remain there' : '<b>[E]</b> Enter the Surface Run checkpoint · toxic air';
    return this.mapAimed() ? '<b>[E]</b> Read the operations map' : null;
  }

  interact(): boolean {
    if (this.mapOpen) {this.closeMap(); return true;}
    if (this.accessAimed()) {
      this.stats.transitions++;
      void this.host.surfaceTravel(this.info ? 'main' : 'surface').then(result => {
        if (!result.ok) this.host.hud.toast(result.reason === 'busy' ? 'The checkpoint door is busy; finish what you are moving first' : 'The checkpoint door could not be opened', true);
      });
      return true;
    }
    return this.openMap();
  }

  openMap(): boolean {
    if (!this.mapAimed()) return false;
    this.mapOpen = true; this.stats.opens++;
    if (typeof document !== 'undefined' && document.body) {
      if (!this.overlay) {
        this.overlay = document.createElement('div'); this.overlay.id = 'surface-operations-map';
        this.overlay.style.cssText = 'position:fixed;inset:0;z-index:17;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(5,9,7,.75)';
        this.overlayCanvas = document.createElement('canvas'); this.overlayCanvas.width = MAP_W; this.overlayCanvas.height = MAP_H;
        this.overlayCanvas.style.cssText = 'width:min(94vw,119vh);height:auto;max-height:92vh;box-shadow:0 0 0 7px #586149,0 10px 50px #000;';
        this.overlay.appendChild(this.overlayCanvas); document.body.appendChild(this.overlay);
      }
      this.overlay.style.display = 'flex';
    }
    this.drawMap(); return true;
  }

  closeMap(): void {this.mapOpen = false; if (this.overlay) this.overlay.style.display = 'none';}

  summary() {
    return {stats: {...this.stats}, section: this.key ? {...this.key} : null, city: this.city ? {...this.city.stats} : null,
      sectors: this.city ? {...this.city.sectors.stats} : null, explored: structuredClone(this.explored), map: this.mapState(), access: this.access ? {...this.access} : null};
  }
}

export function installSurfaceRun(host: SurfaceRunHost): SurfaceRunRuntime {return new SurfaceRunRuntime(host).install();}
