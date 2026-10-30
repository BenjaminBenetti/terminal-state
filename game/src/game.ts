// Game orchestration: state machine (title/playing/paused/inventory/dead/won), the frame loop,
// combat resolution, zombie updates, pickups and the station lifecycle (new seed per run).

import * as THREE from 'three';
import {freshSeed, mulberry32, seedToCode} from './core/rng';
import {PropIndex, moveCircle} from './core/physics';
import {CELL, PathFinder, nearestWalkable} from './gen/grid';
import {BODY_CLEAR, levelsOf, type Levels} from './gen/levels';
import type {StationLayout} from './gen/station';
import {PropModelLibrary, loadAssets, type AssetBundle} from './assets/loader';
import {P7_FILES, dropUnloadedP7, p7ModelKeysFor} from './gen/props07';
import {buildWorld, type BuiltWorld} from './world/builder';
import {fogCullDistance} from './world/levelCulling';
import {WorldMaterials} from './world/materials';
import {MOOD, StationLighting} from './world/lights';
import {VolumetricAtmosphere} from './render/volumetric';
import {PickupManager, makeSupplyMesh, registerItemModels, type Pickup} from './world/pickups';
import {Survival, survivalTicks} from './player/survival';
import {ContainerManager, type ContainerEvent, type ContainerTarget} from './world/containers';
import {SoundGate} from './world/openables';
import {Effects} from './world/fx';
import {Input} from './player/input';
import {Player, WALK_SPEED, stanceRecoilMult, stanceSpreadMult} from './player/player';
import {Inventory, type SlotRef} from './items/inventory';
import {ITEMS, itemDef, throwHint, useHint, useLabel} from './items/items';
import {WEAPONS, WeaponController, type WeaponDef} from './weapons/weapons';
import {Viewmodel} from './weapons/viewmodel';
import {devPistolRequested, makePistolDevPlaceholder, PISTOL_ART_READY, startWeaponFor, type StartWeapon} from './weapons/pistol';
import {ConsumeView} from './weapons/consumeView';
import {buildItemIcons} from './ui/itemIcons';
import {ZombieActor} from './ai/zombieActor';
import {createEnemyActor, enemyCues, type EnemyActor} from './ai/creatureArchetypes'; // iteration 07 (Lane Q): generic enemy archetypes (rat/dog)
import type {ZombieSpawn} from './gen/station';
import {ZombieLookLibrary, pickZombieLook} from './ai/outfits';
import {hearingMuffle, slabsBetween, type BrainWorld} from './ai/brain';
import {lureWorld} from './ai/lightLure'; // Iteration 12 (AI): light attracts enemies
import {moveZombie, sameLevel, settleZombie} from './ai/motor';
import {ladderTarget, type Ladder} from './gen/traversal';
import {raycastWorld, rayCapsule, raySphere, type Vec3} from './combat/hitscan';
import {Hud} from './ui/hud';
import {InventoryUI} from './ui/inventoryUI';
import {Sfx, humEmitters, roomKindFor} from './audio/sfx';
import {PhysicsSystem, killImpulseStrength} from './physics/world';
import {DamageSystem} from './damage/system';
import {ShelfStock} from './world/shelfStock';
import {LightSources} from './world/lightSources';
import {PlayerLight, applyBatteryItem} from './player/flashlight'; // Iteration 12 (LIGHT): flashlight battery + body glow
import {FlareSystem, throwOneFlare, type FlareSmokeHost} from './weapons/throwables'; // Iteration 12 (LIGHT): thrown road flares (grenade slot)
import {FlareHold} from './weapons/flareHold'; // Iteration 15: hold to ready, release to throw
import {BASE_MODIFIERS, combineModifiers, type ModifierSource, type PlayerModifiers} from './player/modifiers'; // Iteration 16 (shared contract)
import {armorFor, meleeHitLocation, type PlayerHit, type ResolvedHit} from './player/hits'; // Iteration 16 (shared contract)
import {biteHitLocation, installInjuries, injuryStatusHtml, type InjurySystem} from './player/injuries'; // Iteration 16 (lane INJURY)
import {installGear, type GearSystem} from './gear/system'; // Iteration 16 (lane GEAR): gear slots, deployable backpack, grounded bags
import {installTower, type TowerRuntime} from './world/towerRuntime'; // Iteration 16 (lane TOWER): elevator, stair doors, windows, exterior
import {preloadMedicalModels} from './world/medicalItems'; // Iteration 16 (lane INJURY): Meshy A7 / A8 treatment models
import {archetypeOf} from './ai/creatureArchetypes'; // Iteration 16 (lane INJURY): rat / dog bites go low
import type {StationLayout as Iter16Layout} from './gen/stationTypes';
// Iteration 16 (lane RUN): logical levels / sections, travel, run carryover (levels/registry.ts, run/*)
import {LEVELS, LEVEL_IDS, arrivalPose, clearLabel, sectionLabel, storeyLabel} from './levels/registry';
import {rollLevelGear} from './levels/gearAdapter';
import type {Arrival, LevelId, SectionKey, TravelRequest} from './levels/types';
import {createRun, type RunState} from './run/runState';
import {enemiesToSpawn, mergeKilled, pickupPlan} from './run/memory';
import {resetParticipants, restoreCarry, restoreParticipants, takeSnapshot, type RunParticipant, type RunSnapshot} from './run/snapshot';
import {starterInventory} from './run/starter';
import {applyHolders, captureHolders, capturePickups, restorePickup} from './run/worldMemory';
import {runBagStore} from './run/bagStore';
import {SingleFlight, travelRefusal, type TravelResult} from './run/travelGate';
import {OFFICE_MODEL_FILES} from './assets/officeAssets'; // Iteration 16 (lane ASSETS registry): office models load through propModels
import {officeModelKeysFor} from './gen/office/index'; // Iteration 16 (lane WORLD-GEN): the office models a section placed
import {preloadOfficeAssets} from './world/officeProps'; // Iteration 16 (lane WORLD-GEN): carpet / ceiling / partition textures
import {placementBox} from './items/lootLayout';
import {adaptToSoftwareGl, type SoftwareGlState} from './render/softwareGl';
// Iteration 13 (CORE): WebGPURenderer (WebGPU backend, WebGL 2 fallback), backend diagnostics, viewmodel overlay pass
import type {WebGPURenderer} from 'three/webgpu';
import {createGameRenderer, describeBackend, maxTexture3DSize, recordGpuError, rendererRequest, watchDevice, type GameRenderer, type GpuInfo} from './render/backend';
import {OverlayPass} from './render/overlay';
import {installFlareLightNode} from './world/flareLight'; // Iteration 15
import {WarmupRegistry, prepareObjects, runWarmup, skippedWarmup, warmupLabel, warmupNote, type WarmupMode, type WarmupProgress, type WarmupRenderer, type WarmupResult} from './render/warmup'; // Iteration 14

export type GameState = 'loading' | 'title' | 'playing' | 'paused' | 'inventory' | 'dead' | 'won' | 'error';

export interface Settings { sens: number; fov: number; volume: number; muted: boolean; invertY: boolean; quality: 'low' | 'high' }

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

/**
 * Iteration 14: warm-up scope. `?warmup=off|view|full` overrides; otherwise the whole station on a hardware GPU and only
 * the spawn neighbourhood on a software rasterizer (it JITs every program into system memory; render/warmup.ts).
 */
/** Iteration 14: where a warm-up shows its progress (the title's loading bar, or the pause panel's status line). */
export interface WarmupUi { bar: HTMLElement | null; label: HTMLElement; button: HTMLButtonElement | null }
const titleWarmupUi = (): WarmupUi => ({bar: $('#load .fill'), label: $('#load .label'), button: $('#btn-start') as HTMLButtonElement});
/** Iteration 16: let the browser paint a loading screen / overlay before a long synchronous generation. */
const nextPaint = () => new Promise<void>(r => setTimeout(r, 30));

export function warmupMode(search: string, software: boolean): WarmupMode {
  const v = new URLSearchParams(search).get('warmup');
  if (v === 'off' || v === 'view' || v === 'full') return v;
  return software ? 'view' : 'full';
}

interface UseAction { uid: number; itemId: string; t: number; total: number }

export class Game {
  /** Iteration 13 (CORE): three r186 WebGPURenderer — usable only after `await initRenderer()` (main.ts boot). */
  readonly renderer: WebGPURenderer;
  /** Iteration 13 (CORE): the backend that actually initialized (render/backend.ts); null until initRenderer() resolves. */
  gpu: GpuInfo | null = null;
  private readonly gpuBoot: GameRenderer;
  private gpuInit: Promise<GpuInfo> | null = null;
  /** Iteration 13 (CORE): viewmodel overlay target + composite (render/overlay.ts). */
  readonly overlay: OverlayPass;
  /** Iteration 13 (CORE): set when the atmosphere module cannot run on this renderer; the station then renders directly. */
  atmosphereBypass: string | null = null;
  readonly scene = new THREE.Scene();
  // Far plane just past where FogExp2(0.038) is ~99.8% opaque: on the 130 m+ platforms this lets
  // chunked instancing cull far fixtures/props that would be invisible anyway.
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  readonly input: Input;
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly settings: Settings = {sens: 1, fov: 75, volume: 0.7, muted: false, invertY: false, quality: 'high'};
  state: GameState = 'loading';
  assets!: AssetBundle;
  /** Iteration 07 (Lane P2): lazy per-station prop models (gen/props07.ts); only the kinds a station placed are fetched. */
  readonly propModels = new PropModelLibrary({...P7_FILES, ...OFFICE_MODEL_FILES}); // Iteration 16 (RUN): + the office GLBs (lane ASSETS)
  /** Pistol lane: legacy `?devpistol=1` flag (pre-art staging); no longer needed now that PISTOL_ART_READY. */
  readonly devPistol = devPistolRequested();
  /** Starting weapon: the pistol (PISTOL_ART_READY: the user's pistol.glb is in), so rifle + shotgun are seeded finds. Generation receives it. */
  readonly startWeapon: StartWeapon = startWeaponFor(this.devPistol);
  mats!: WorldMaterials;
  viewmodel!: Viewmodel;
  layout!: StationLayout;
  world!: BuiltWorld;
  /** Station lighting (iteration 05: baked persistent light field + tube glow; historical field name). */
  lightPool!: StationLighting;
  propIndex!: PropIndex;
  pathfinder!: PathFinder;
  /**
   * Iteration 08 (Lane B): the station's stacked levels — every y-aware world query (support,
   * collision, ceilings, 3D raycasts / sight, nav). One level on single-storey layouts.
   */
  levels!: Levels;
  readonly player = new Player();
  /** Hunger/thirst (FOOD/WATER bars): 80/80 on every spawn, slow drain while playing. */
  readonly survival = new Survival();
  inv = new Inventory();
  weapon = new WeaponController();
  /** Every enemy actor (zombies + iteration-07 archetypes such as the rat/dog; ai/creatureArchetypes.ts EnemyActor). */
  zombies: EnemyActor[] = [];
  /** Spawns whose archetype model was missing and fell back to a zombie (QA). */
  enemyFallbacks = 0;
  /** Iteration 05 body x outfit registry/assembler (ai/outfits.ts), built once from the loaded GLBs. */
  private zombieLooks: ZombieLookLibrary | null = null;
  pickups!: PickupManager;
  readonly fx = new Effects();
  /** Ragdolls (cannon-es) + pooled casings; rebuilt per station, stepped only while playing. */
  readonly physics = new PhysicsSystem(this.scene, this.sfx);
  /** Iteration 06 (Lane D): material damage — craters, debris, per-instance prop damage / breaking, zombie wounds. */
  readonly damage = new DamageSystem(this.fx, this.sfx);
  /** Iteration 08 (Lane S): real 3D filler stock on retail shelving — physical on demand, never loot (world/shelfStock.ts). */
  readonly stock = new ShelfStock(this.fx, this.sfx);
  /** Iteration 12 (primary contract): player-made light the world reacts to (flashlight, flares, body glow); world/lightSources.ts. */
  readonly lightSources = new LightSources();
  readonly invUI: InventoryUI;
  private readonly flashlight: THREE.SpotLight;
  /** Iteration 12 (LIGHT): flashlight battery / flicker + body glow + their light sources (player/flashlight.ts). */
  readonly torch: PlayerLight;
  /** Iteration 12 (LIGHT): thrown road flares (weapons/throwables.ts; a cannon BodySource of `physics`). */
  readonly flares = new FlareSystem(this.scene, this.physics, this.lightSources);
  /** Iteration 15: grenade-style flare input (T, or left click with a flare in hand): hold readies, release throws once. */
  readonly flareHold = new FlareHold();
  /** Iteration 15: the left button belonged to a flare hold; the gun ignores it until it is released. */
  private lmbLatch = false;

  // ==== Iteration 16 shared plumbing (primary) — lanes REGISTER into these; they do not rewrite each other's code ====
  /** Per-frame modifier contributors (lane GEAR: worn gear; lane INJURY: limb injuries). Combined from base values each frame. */
  readonly modifierSources: ModifierSource[] = [];
  /** This frame's combined modifiers (player/modifiers.ts). */
  mods: PlayerModifiers = {...BASE_MODIFIERS};
  /** Called with every resolved hit on the player, after armor and HP (lane INJURY rolls limb injuries here). */
  readonly hitListeners: ((hit: ResolvedHit) => void)[] = [];
  /** E-key handlers tried before the default interaction (lane GEAR: grounded backpack; lane TOWER: elevator / stair doors). Return true when handled. */
  readonly interactHandlers: (() => boolean)[] = [];
  /** Per-section build hooks: `build` after a section's world is built (before warm-up), `teardown` before it is torn down. */
  readonly sectionHooks: {build?(layout: Iter16Layout): void; teardown?(): void}[] = [];
  /** Aim offset (radians) added to the camera every frame (lane INJURY: restrained arm-injury sway). Shots use the camera, so it is honest. */
  readonly aimOffset = {yaw: 0, pitch: 0};
  /** Per-frame lane updates while playing (after the player moved, before the camera update). */
  readonly frameHooks: ((dt: number) => void)[] = [];
  /** Iteration 16 (lane GEAR; TOWER may use them too): lane prompts shown before the pickup / container / ladder prompt (the matching interactHandler takes E first). */
  readonly promptProviders: (() => string | null)[] = [];
  /** Iteration 16 (lane GEAR): a lane UI / action owns the mouse buttons (readied / open backpack): no fire, ADS, item use or flare while any returns true. */
  readonly inputOwners: (() => boolean)[] = [];
  /** Iteration 16 (lane GEAR): worn gear, the deployable backpack (6) and grounded bags (gear/system.ts). */
  readonly gear: GearSystem;
  /** Iteration 16 (lane INJURY): limb injuries (player/injuries.ts) — RUN carries snapshot() / restore(), NewGame calls reset(). */
  readonly injuries: InjurySystem;
  /** Iteration 16 (lane TOWER): the office tower runtime — elevator, stairwell doors, window glass, exterior city (world/towerRuntime.ts). */
  readonly tower: TowerRuntime;
  // ==== Iteration 16 (lane RUN): the run — logical levels, sections, travel, carryover (lanes/run.notes) ====
  /** The current run (run/runState.ts): level seeds, gear roll, section memories, the Retry-level snapshot. Replaced by NewGame. */
  run: RunState = createRun({seeds: {subway: freshSeed(), office: freshSeed()}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
  /** How the player arrived in the current section (lane TOWER: kind 'elevator' starts inside the cab, doors closed). */
  arrival: Arrival = {kind: 'start'};
  /** Run-scoped lane state (INJURY / GEAR): saved at level entry (Retry), restored by Retry level, reset by NewGame — never by travel. */
  readonly runParticipants: RunParticipant[] = [];
  /** Called on every setState (lanes close their UIs when the state leaves 'playing'). */
  readonly stateListeners: ((state: GameState, prev: GameState) => void)[] = [];
  /** Awaited after a section is generated and before it is built (lazy models / textures the builder needs). */
  readonly sectionPreloads: ((layout: StationLayout) => Promise<void>)[] = [];
  /** Extra `propModels` keys a section needs besides its p7 props (lane WORLD-GEN: office models): fetched before the build, kept by the trim. */
  readonly sectionModelKeys: ((layout: StationLayout) => readonly string[])[] = [officeModelKeysFor];
  /** One lifecycle operation at a time: travel, new game, retry level. */
  private readonly lifecycle = new SingleFlight();
  /** Live pickups that are (what is left of) a generated layout pickup -> its layout.pickups index. */
  private readonly layoutPickup = new Map<Pickup, number>();
  /** Live enemies -> their layout.zombies index (kills are remembered per index). */
  private readonly enemyIndex = new Map<EnemyActor, number>();
  /** The current section was already cleared in this run (no second clear moment). */
  private sectionCleared = false;
  /** Flashlight switched on (Iteration 12: backed by the battery; a flat battery keeps it off). */
  get flashlightOn(): boolean { return this.torch.battery.on; }
  set flashlightOn(v: boolean) { this.torch.battery.setOn(v); }
  private readonly muzzleLight = new THREE.PointLight(0xffb468, 0, 8, 2);
  /** Iteration 06 (Lane F): volumetric haze pass + flashlight shadow map (render/volumetric.ts). */
  readonly atmosphere: VolumetricAtmosphere;
  // Constant dim ambient floor (iteration 05: no longer follows the player's area; the baked light
  // field in world/lights.ts carries all fixture light).
  private readonly hemi = new THREE.HemisphereLight(MOOD.hemiSky, MOOD.hemiGround, MOOD.ambient);
  stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
  private recoilPitch = 0;
  private recoilYaw = 0;
  private bloom = 0;
  private shake = 0;
  private muzzleT = 0;
  private use: UseAction | null = null;
  private lastSlot = 0;
  private aiming = false;
  private wonAt = -1;
  private rand: () => number = Math.random;
  private sharedGeometries = new Set<THREE.BufferGeometry>();
  private lastFrame = performance.now();
  private renderT = 0;
  private time = 0;
  private shotCounter = 0;
  private currentSeed = 0;
  /** Frames rendered while playing (used by QA to confirm the loop runs). */
  frames = 0;
  /** Debug overlay (debug/overlay.ts): main-thread ms of the last frame()'s world update and render submission. */
  readonly frameCpu = {updateMs: 0, renderMs: 0, rendered: false};
  /** Gameplay clock (s; advances only while the world updates). Iteration 17: QA / tests prove traversal never stops it. */
  get clock(): number { return this.time; }
  /**
   * Iteration 17 (seamless): how often each world-lifecycle entry point ran. Traversal inside a level (stairs, the moving
   * elevator) must never move any of these — tests and the browser spot check compare them before / after.
   */
  readonly lifecycleCounts = {generate: 0, prepare: 0, build: 0, leave: 0, travel: 0, warmup: 0, loading: 0};
  /** Iteration 14 (primary): the loading-screen render warm-up is running (render/warmup.ts); the loop neither updates nor renders. */
  warming = false;
  /** Iteration 14: the last warm-up's result (loading note, QA `__LL.warmup()`). */
  warmup: WarmupResult | null = null;
  private warmRun: Promise<WarmupResult> | null = null;
  /**
   * Iteration 14: what the warm-up prepares besides the discovered station scene (docs/rendering-warmup.md): effect pools /
   * runtime prototypes in the scene, and render passes with their own scene / camera / target.
   */
  readonly warmRegistry = new WarmupRegistry();
  /** Iteration 14: the previous station's GPU-side releases, run after the new station's warm-up (see newStation). */
  private retired: (() => void)[] = [];
  /** Iteration 14: bumped by newStation (a running warm-up for the previous station stops at its next chunk). */
  private stationGen = 0;
  /** Iteration 08: renderer string + whether it is a software rasterizer (anisotropy capped at 1 there). Iteration 13: set by initRenderer(). */
  softwareGl: SoftwareGlState | null = null;
  lastError: string | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly qa: boolean) {
    // Iteration 13 (CORE): WebGPURenderer (three/webgpu): WebGPU when the browser yields an adapter + device, else its built-in
    // WebGL 2 backend; ?renderer=webgl2 forces the fallback. Nothing renders / compiles before initRenderer() resolves.
    this.gpuBoot = createGameRenderer(canvas, rendererRequest(location.search, globalThis.navigator as {gpu?: unknown} | undefined, globalThis.isSecureContext !== false));
    this.renderer = this.gpuBoot.renderer;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = MOOD.exposure;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true; // Iteration 13 (CORE): the atmosphere switches it per quality (flashlight shadow)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.overlay = new OverlayPass(this.renderer.samples); // Iteration 13 (CORE)
    this.scene.background = new THREE.Color(0x0a0b0c);
    this.scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    this.scene.add(this.hemi, this.camera, this.muzzleLight, this.fx.group);
    this.scene.add(this.damage.group); // Lane D: debris / craters / damaged props (normal depth-tested scene pass)
    this.camera.rotation.order = 'YXZ';
    // Hot centre (~10 deg) with a wide soft spill to ~33 deg; low decay so it reaches ~20 m.
    this.flashlight = new THREE.SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2);
    this.flashlight.position.set(0.2, -0.15, 0.1);
    this.flashlight.target.position.set(0.04, -0.12, -6);
    this.camera.add(this.flashlight, this.flashlight.target);
    // Iteration 13 (CORE): guarded. An atmosphere (render/volumetric.ts TSL pipeline) that cannot be built on this renderer
    // is kept CPU-side only (smoke / scatter API, shadow marking), the station renders directly and the bypass is recorded.
    const atmoLights = {flashlight: this.flashlight, muzzle: this.muzzleLight};
    let atmosphere: VolumetricAtmosphere;
    try {
      atmosphere = new VolumetricAtmosphere(this.renderer as unknown as ConstructorParameters<typeof VolumetricAtmosphere>[0], atmoLights, this.settings.quality);
    } catch (err) {
      this.atmosphereBypass = `atmosphere module unavailable on WebGPURenderer (${String((err as Error)?.message ?? err).slice(0, 200)}); rendering the station directly`;
      console.warn(`Iteration 13: ${this.atmosphereBypass}`);
      atmosphere = new VolumetricAtmosphere(null, atmoLights, this.settings.quality);
    }
    this.atmosphere = atmosphere;
    // Iteration 12 (LIGHT): battery-driven flashlight + warm body glow (always in the scene: the light count never changes);
    // flares get the atmosphere smoke / scatter API, the Sound Lab flare cues and the storey / sight queries.
    this.torch = new PlayerLight(this.flashlight, MOOD.flashlight);
    this.scene.add(this.torch.glow);
    this.flares.env = {
      smoke: this.atmosphere satisfies FlareSmokeHost, audio: this.sfx, // smoke / scatter API: render/volumetric.ts (atmosphere lane)
      levelAt: (x, z, y) => this.levels ? this.levels.levelAt(x, z, y) : 0,
      lineOfSight: (a, b) => !this.levels || this.levels.lineOfSight(a, b),
    };
    // Iteration 14: effects hidden until the first shot / hit and the thrown-flare prototypes are warmed with the station
    this.warmRegistry.addPool('effects', () => [this.fx.group]);
    this.warmRegistry.addPool('flares', () => this.flares.warmPrototypes());
    this.input = new Input(canvas, qa);
    this.input.onLockChange = locked => {
      if (!locked && this.state === 'playing' && !this.qa) this.setState('paused');
    };
    this.input.onKey = code => this.onKey(code);
    this.invUI = new InventoryUI(() => this.inv, {
      use: ref => this.startUse(ref),
      drop: (ref, count) => this.dropRef(ref, count),
      equip: ref => this.equipRef(ref),
      close: () => this.closeInventory(),
      changed: () => this.syncHeld(),
      vitals: () => ({hp: this.player.hp, maxHp: this.player.maxHp, food: this.survival.hunger, water: this.survival.thirst, limbs: injuryStatusHtml(this.injuries)}),
    });
    // Iteration 16 (lane INJURY): hit listener (arm / leg hits) + frame hook (landings, sway -> aimOffset, HUD) + ModifierSource
    this.injuries = installInjuries(this, {aiming: () => this.aiming});
    this.gear = installGear(this); // Iteration 16 (lane GEAR): modifier source, key 6 / bag view, E on grounded bags, section hooks, warm-up pool
    this.tower = installTower(this); // Iteration 16 (lane TOWER): section hooks, frame hook (doors / collision / exterior), E + prompts, preload, warm-up pool
    this.sectionPreloads.push(layout => preloadOfficeAssets(layout, {models: false})); // Iteration 16 (WORLD-GEN): office textures before the build (models come via propModels)
    void preloadMedicalModels(); // fetched with the main assets; load() awaits it before item templates / icons
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => { if (this.state === 'playing' && !this.qa) this.setState('paused'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.setState('paused'); });
    this.resize();
  }

  /** Iteration 13 (CORE): called once when the GPU device / WebGL context is lost (main.ts shows the error overlay). */
  onDeviceLost: ((text: string) => void) | null = null;

  /**
   * Iteration 13 (CORE): `await renderer.init()` (WebGPU adapter + device, or the WebGL 2 fallback), then record what actually
   * runs (game.gpu, read from the backend object), hook device-lost / GPU-error reporting and the software-rasterizer
   * anisotropy cap. Idempotent: every caller gets the same promise; rejects only when neither backend starts.
   */
  initRenderer(): Promise<GpuInfo> {
    this.gpuInit ??= this.renderer.init().then(() => {
      const gpu = describeBackend(this.renderer.backend as never, this.gpuBoot.request, this.gpuBoot.fallbackError());
      this.gpu = gpu;
      watchDevice(this.renderer, gpu, {onLost: text => { this.lastError = text; this.onDeviceLost?.(text); }});
      this.softwareGl = adaptToSoftwareGl(this.renderer); // iteration 08: no anisotropic filtering on software rasterizers / adapters
      installFlareLightNode(this.renderer); // Iteration 15: flare lights occluded by their window (before the first compile)
      this.overlay.target.samples = this.renderer.samples; // 0 in WebGPU compatibility mode
      console.info(`Terminal State: ${gpu.label}${gpu.adapter ? ` · ${[gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.description].filter(Boolean).join(' ')}` : gpu.glRenderer ? ` · ${gpu.glRenderer}` : ''}`);
      return gpu;
    });
    return this.gpuInit;
  }

  /** First-person consume animation (weapons/consumeView.ts); visual only, `use` stays authoritative. */
  consumeView!: ConsumeView;

  // ---------------------------------------------------------------------------------------
  async load(onProgress: (f: number, label: string) => void): Promise<void> {
    this.assets = await loadAssets(onProgress);
    const m = this.assets.models;
    for (const g of Object.values(m)) g.scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) this.sharedGeometries.add(mesh.geometry); });
    const lb = new THREE.Box3().setFromObject(m.light.scene).getSize(new THREE.Vector3());
    this.mats = new WorldMaterials(this.assets.textures, 20261025, {w: lb.x, h: lb.y, d: lb.z});
    // Food/drink use the generated item models when the manifest has them (else stand-ins).
    await preloadMedicalModels(); // Iteration 16 (lane INJURY): Meshy splint / sling (null urls / failures -> authored models)
    registerItemModels(m as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>);
    const consumables: Record<string, THREE.Object3D> = {};
    for (const id of Object.values(ITEMS).filter(d => d.kind === 'consumable' || d.kind === 'throwable').map(d => d.id)) {
      const o = makeSupplyMesh(id);
      // Iteration 12 (LIGHT): a held flare is gripped mid-tube, cap (head) pointing forward and a little up
      if (itemDef(id).kind === 'throwable') o.rotation.set(0.35, Math.PI / 2 + 0.12, 0.1); else o.rotation.set(0.5, -0.4, 0.15);
      o.traverse(x => { const mm = x as THREE.Mesh; if (mm.isMesh) mm.frustumCulled = false; });
      consumables[id] = o;
    }
    // Pistol lane: the user's real pistol.glb (PISTOL_ART_READY), like the rifle/shotgun: viewmodel, item icon and pickups.
    // The dev placeholder is only reachable if the gate were off (pre-art staging with ?devpistol=1); never with the real model.
    const pistolGltf = PISTOL_ART_READY ? m.pistol
      : this.devPistol ? ({scene: makePistolDevPlaceholder()} as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF) : undefined;
    const guns = {rifle: m.rifle, shotgun: m.shotgun, ...(pistolGltf ? {pistol: pistolGltf} : {})};
    this.viewmodel = new Viewmodel(guns, consumables);
    // Lane D (iteration 04): eat/drink/apply with the real item model in hand, and inventory icons
    // rendered once from the runtime models through this renderer (ui/itemIcons.ts).
    this.consumeView = new ConsumeView(this.viewmodel, makeSupplyMesh);
    // Iteration 14: the viewmodel overlay is its own render pass (own scene / camera / target): every held item and the
    // muzzle flash compile there on the loading screen
    const vm = this.viewmodel;
    this.warmRegistry.addPass({name: 'weapons and held items', scene: vm.scene, camera: vm.camera, target: () => this.overlay.target, hidden: () => vm.warmRoots()});
    await this.initRenderer(); // Iteration 13 (CORE): the icon renders are the first GPU work (init overlapped the download)
    await buildItemIcons(this.renderer, guns); // a pistol without a model keeps its SVG icon (ui/icons.ts)
    this.pickups = new PickupManager(guns);
    this.scene.add(this.pickups.group);
    this.resize();
  }

  get seed(): number {
    return this.currentSeed;
  }

  // ==== Iteration 16 (lane RUN): sections, travel and run carryover =====================================================
  // A RUN lasts from NewGame to the next NewGame. Travel (elevator / stair door / pause-menu level change) moves the SAME
  // live player state (inventory with gear and backpack contents, hp / stamina, hunger / thirst, battery, injuries) to
  // another section; only NewGame resets it, and Retry level restores the snapshot taken when the level was entered.

  /** Generate a section of `run` (levels/registry.ts; the section's gear from the run's level-wide roll). Deterministic. */
  generateSection(key: SectionKey, run: RunState = this.run): StationLayout {
    this.lifecycleCounts.generate++;
    return LEVELS[key.level].generate(key.section, {levelSeed: run.seeds[key.level], startWeapon: this.startWeapon, gear: run.gearFor(key)});
  }

  /**
   * Iteration 07 (Lane P2) / 16: generates a section and fetches exactly the lazy prop models it placed (plus the lanes'
   * section preloads) BEFORE it is built and revealed. Cached models resolve at once; a model that fails is dropped from
   * the section, never boxed.
   */
  async prepareSection(key: SectionKey, run: RunState = this.run, onProgress?: (frac: number, label: string) => void): Promise<StationLayout> {
    this.lifecycleCounts.prepare++;
    const layout = this.generateSection(key, run);
    await this.propModels.ensure(this.modelKeysFor(layout), onProgress);
    for (const pre of this.sectionPreloads) {
      try { await pre(layout); } catch (err) { console.warn('Iteration 16: a section preload failed', err); }
    }
    return layout;
  }

  /** Iteration 16: every lazy model key a section uses (p7 props + lane keys, e.g. office models). */
  private modelKeysFor(layout: StationLayout): string[] {
    const extra = this.sectionModelKeys.flatMap(f => { try { return [...f(layout)]; } catch (err) { console.warn('Iteration 16: section model keys failed', err); return []; } });
    return [...new Set([...p7ModelKeysFor(layout), ...extra])];
  }

  /**
   * Iteration 16: tear the live section down. Lane hooks first (run.current is still this section and its world is alive:
   * lanes save their section data), then — on a travel — RUN's memory of it, then the world itself.
   */
  private leaveSection(save: boolean): void {
    this.lifecycleCounts.leave++;
    this.stationGen++; // Iteration 14: invalidates a warm-up of the previous station
    // Iteration 14 (user: "when I load a new station the stutters come back"): three r186 frees a node build / pipeline /
    // program when its LAST user is disposed, and the next station needs the same ones (zombie + wound materials, glow,
    // instanced variants). The old station leaves the scene now; its GPU releases are queued and run only after the new
    // station's warm-up re-used those programs (prepareGraphics), instead of rebuilding them at the start of the level.
    this.flushRetired(); // anything still queued from an earlier station
    if (this.world) for (const h of this.sectionHooks) h.teardown?.(); // Iteration 16: lane section state (elevator, grounded bags, …)
    if (this.world && save) this.saveSectionMemory();
    if (this.world) {
      const oldGroup = this.world.group;
      this.scene.remove(oldGroup);
      const instanced: THREE.InstancedMesh[] = [];
      oldGroup.traverse(o => {
        const mesh = o as THREE.Mesh;
        if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh);
        // geometry buffers go now (a geometry dispose never releases three's node builds / pipelines)
        if (mesh.isMesh && !this.sharedGeometries.has(mesh.geometry) && !this.propModels.ownsGeometry(mesh.geometry)) mesh.geometry.dispose();
      });
      this.retire(() => { for (const im of instanced) im.dispose(); }); // the object 'dispose' event frees its render objects
      this.lightPool.dispose(this.scene, fn => this.retire(fn));
    }
    for (const z of this.zombies) { this.scene.remove(z.root); const old = z; this.retire(() => old.dispose()); }
    this.zombies = [];
    this.enemyIndex.clear();
    this.pickups.clear();
    this.layoutPickup.clear();
    this.containers?.clear();
    this.containerTarget = null;
    this.currentTarget = null;
    this.fx.clear();
    this.damage.clear(fn => this.retire(fn)); // Iteration 14: the zombies' wound material clones are released after the warm-up too
    this.use = null;
    this.consumeView?.reset();
    this.flares.clear(); // Iteration 12 (LIGHT): burning / thrown flares, their lights, smoke, loops and light sources
    this.flareHold.cancel(); // Iteration 15: a readied flare is dropped (nothing spent)
    this.lmbLatch = false;
    this.aiming = false;
  }

  /** Iteration 16: what the player changed in the live section -> its run memory (loose items with poses, holder lots, kills). */
  private saveSectionMemory(): void {
    const mem = this.run.memory(this.run.current);
    mem.pickups = capturePickups(this.pickups.list, p => this.layoutPickup.get(p));
    if (this.containers) mem.holders = captureHolders(this.containers);
    const dead = this.zombies.filter(z => !z.brain.alive).map(z => this.enemyIndex.get(z)).filter((i): i is number => i !== undefined);
    mem.killed = mergeKilled(mem.killed, dead);
  }

  /**
   * Iteration 16: build `layout` as the live section `key` and put the player in it by `arrival`. `fresh` = NewGame
   * (Player.spawn: full health); otherwise Player.place keeps hp / stamina. The inventory, survival, battery and lane
   * state are NOT touched here (callers: newGame resets them before, retryLevel restores them before, travel keeps them).
   * The section's memory is applied: killed enemies stay dead, taken loot stays taken, dropped items come back once.
   */
  private buildSection(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean): void {
    this.lifecycleCounts.build++;
    const t0 = performance.now();
    this.layout = layout;
    this.currentSeed = layout.seed >>> 0;
    this.rand = mulberry32(layout.seed ^ 0x5bd1e995);
    // Iteration 07 (Lane P2): the prepared layout (its lazy prop models loaded); placements whose model is missing are dropped.
    const p7Keys = p7ModelKeysFor(this.layout), keep = new Set(this.modelKeysFor(this.layout));
    dropUnloadedP7(this.layout, new Set(p7Keys.filter(k => this.propModels.has(k))));
    this.propModels.trim(keep);
    this.world = buildWorld(this.layout, this.mats, {...this.assets.models, ...this.propModels.record()} as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>);
    this.scene.add(this.world.group);
    if (!this.containers) {
      this.containers = new ContainerManager(this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>, this.mats, () => this.inv);
      this.containers.onEvent = e => this.onContainerEvent(e);
      this.scene.add(this.containers.group);
    }
    // Searchable cabinets/crates; loot is rolled from the station seed + container index.
    this.containers.build(this.layout, this.propModels.record() as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>); // iteration 08 (Lane I): openables split the lazy p7 models too
    this.levels = levelsOf(this.layout);
    this.propIndex = new PropIndex(this.levels, this.layout.props);
    this.pathfinder = new PathFinder(this.levels); // Lane B: (level, cell) nodes; stairs join levels
    this.physics.build(this.layout); // disposes the previous station's bodies and casings
    // Lane D: index the shared prop renderables for per-instance damage; breaks update holders + ragdoll statics.
    const cm = this.containers;
    // Iteration 07 (Lane K): items / chunks rest on real holder shelves; walkers shove loose light props.
    // Iteration 08 (Lane S): stocked shelving also collides by its real boards / backs (filler, items, chunks land on the right board).
    this.physics.holderBoxes = p => this.stock.physicsBoxes(p, cm.physicsBoxes(p));
    // Iteration 08 (Lane S): 3D filler stock dressed around the real loot lots (rest meshes + bodies on demand; no respawn per station).
    if (!this.stock.group.parent) { this.scene.add(this.stock.group); this.stock.filler.attach(this.physics); }
    this.stock.build(this.layout, {models: this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF>,
      lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
    // Iteration 16 (RUN): holders as the player left them (taken lots stay taken; the shelf filler keeps the gaps)
    const mem = this.run.memory(key);
    applyHolders(cm, mem.holders);
    // Iteration 08 (Lane I): a shot trash can / wheelie bin still goes loose — its lid pops, its finite lots spill as pickups.
    this.physics.dynamicItems.holderLoose = p => { const carried = cm.goLoose(p); this.world.culler.release(carried); return carried; }; // Lane G: moving now
    this.physics.dynamicItems.walkers = () => [{id: this.player, x: this.player.x, z: this.player.z, y: this.player.y, r: this.player.radius},
      ...this.zombies.filter(z => z.brain.alive && !z.ragdolled).map(z => ({id: z, x: z.brain.x, z: z.brain.z, y: z.brain.y, r: z.brain.stats.radius}))];
    this.damage.build(this.layout, this.mats, [this.world.group, cm.group], {
      ownMeshes: p => cm.ownMeshes(p),
      onBreak: e => { const h = cm.holderFor(e.prop); if (h) cm.breakHolder(h, e.kind); this.physics.propsChanged(e.prop.x, e.prop.z); },
      pickups: () => this.pickups.list,
      // Iteration 07 (Lane K): shot items move — rigid items / chunks, loot lots lifted off holders (same item / count, never duplicated)
      physics: this.physics,
      lots: (o, d, maxT) => cm.shotLots(o, d, maxT).map(l => ({holder: l.holder, lotId: l.lotId, t: l.t})),
      lotsIn: box => cm.lotsInBox(box),
      detachLot: (h, lotId) => {
        const r = cm.detachLot(h as Parameters<typeof cm.detachLot>[0], lotId);
        if (!r) return null;
        const st = this.inv.makeStack(r.lot.itemId, r.lot.count);
        st.count = r.lot.count; // a lot may hold more than one stack (ammo): keep its finite count exactly
        return this.pickups.addAt(st, r.matrix, {holder: r.holder, lot: r.lot.id});
      },
    });
    // Audio: occlusion-lite (no line of sight -> muffled) + humming vending/stall emitters. Same Sfx/context.
    this.sfx.setWorld({occlusion: (x, z, y) => this.soundOccluded(x, z, y) ? 1 : 0, emitters: humEmitters(this.layout.props)});
    // Iteration 05: every fixture baked into a persistent light field (camera-independent; no pooled lights).
    const max3D = maxTexture3DSize(this.renderer.backend as never); // Iteration 13 (CORE): WebGPU device limit / WebGL 2 MAX_3D_TEXTURE_SIZE
    // Iteration 13 (LIGHTING): `renderer` registers the TSL light-field node (world/lightFieldNode.ts) in its node library.
    this.lightPool = new StationLighting(this.scene, this.layout, this.world.fixtures, this.world.tubes, {hemi: this.hemi, fogDensity: MOOD.fogDensity, far: this.camera.far, max3DTextureSize: max3D, renderer: this.renderer});
    // Iteration 06 (Lane F): haze density map + light-field rebind; station structure/containers cast the flashlight shadow.
    this.atmosphere.setStation(this.layout, this.lightPool.volume);
    this.atmosphere.markShadows(this.world.group, true);
    this.atmosphere.markShadows(this.containers.group, true);
    this.atmosphere.markShadows(this.stock.group, false); // Lane S: shelf stock casts the flashlight shadow too
    // Iteration 08 (Lane G): hide levels behind slabs (portal visibility) and chunks inside opaque fog.
    this.world.culler.register(this.containers.group);
    this.world.culler.register(this.stock.group);
    this.world.culler.maxDistance = fogCullDistance(MOOD.fogDensity);

    // Iteration 16 (RUN) / 17: the level's world is now the run's current one; the player starts at its start pose
    this.run.current = {...key};
    this.run.arrival = {...arrival};
    this.arrival = {...arrival};
    mem.visits++;
    const pose = arrivalPose(this.layout, arrival);
    const lv = pose.level !== undefined && pose.level > 0 && pose.level < this.levels.count ? pose.level : 0;
    const y = pose.y ?? this.levels.grid(lv).floorAt(pose.x, pose.z); // Lane B: the arrival's own storey
    if (fresh) this.player.spawn(pose.x, pose.z, pose.yaw, y); else this.player.place(pose.x, pose.z, pose.yaw, y);
    this.ladderAim = null;
    this.recoilPitch = this.recoilYaw = this.bloom = this.shake = 0;
    this.lightSources.clear(); // Iteration 12: lights of the previous section (the flashlight / body glow re-register on the next update)
    // A fresh controller re-equips the held weapon (a reload in progress is cancelled: ammo is only taken when it completes)
    this.weapon = new WeaponController();
    this.syncHeld();

    // Iteration 05: each zombie wears a seeded body x outfit look (deterministic per station seed + spawn index; 'coated' = heavy coat outfit).
    // Falls back to the legacy single template (zombie-rigged.glb: Last-shift body + coat) when no registry body model is loaded.
    // Iteration 07 (Lane Q): each spawn's archetype comes from the layout (~5 % rat/dog, ai/creatureSpawn.ts).
    // Iteration 16 (RUN): enemies killed earlier in this run stay dead (not spawned again).
    this.enemyFallbacks = 0;
    for (const i of enemiesToSpawn(this.layout.zombies.length, mem)) this.enemyIndex.set(this.spawnEnemy(this.layout.zombies[i], i), i);
    // Iteration 16 (RUN): first visit: the generated pickups; afterwards exactly the remembered loose items (dropped ones too)
    const plan = pickupPlan(this.layout.pickups.length, mem);
    for (const i of plan.fromLayout) {
      const p = this.layout.pickups[i];
      this.layoutPickup.set(this.pickups.add(this.inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, this.rand() * Math.PI * 2), i);
    }
    for (const rec of plan.restored) {
      const pk = restorePickup(this.pickups, this.inv, rec);
      if (rec.layoutIndex !== undefined) this.layoutPickup.set(pk, rec.layoutIndex);
    }
    this.wonAt = -1;
    this.wonShown = false;
    this.sectionCleared = mem.cleared;
    this.hud.reset();
    // Lane F: enemies block the flashlight beam — marked once per actor in spawnEnemy (iteration 07, Lane Q)
    this.genMs = performance.now() - t0;
    const codes = LEVEL_IDS.map(l => `${LEVELS[l].name} ${seedToCode(this.run.seeds[l])}`).join(' · ');
    $('#seed-line').textContent = `${LEVELS[key.level].name} · ${sectionLabel(key)}: ${this.layout.name}. Run codes: ${codes} (debug/share only; reloading the page always starts a new run).`;
    const obj = document.querySelector('#objective .obj-title');
    if (obj) obj.textContent = key.level === 'office' ? 'Clear the station and the tower' : 'Clear the station';
    for (const h of this.sectionHooks) h.build?.(this.layout); // Iteration 16: lane section content (before the warm-up runs)
    this.updateCamera(0);
  }
  genMs = 0;

  /** Iteration 16: run-scoped lane systems that exist but registered no participant (INJURY / GEAR) — wired once, idempotent. */
  private wireRunLanes(): void {
    const self = this as unknown as {
      injuries?: {snapshot?(): unknown; restore?(d: unknown): void; reset?(): void};
      gear?: {reset?(): void; setStore?(s: unknown): void};
    };
    const inj = self.injuries;
    if (inj?.snapshot && inj.restore && inj.reset && !this.runParticipants.some(p => p.id === 'injuries')) {
      this.runParticipants.push({id: 'injuries', save: () => inj.snapshot!(), load: d => inj.restore!(d), reset: () => inj.reset!()});
    }
    const gear = self.gear;
    if (gear?.setStore && !this.bagStoreWired) { gear.setStore(runBagStore(() => this.run)); this.bagStoreWired = true; }
    // GEAR's own state (open bag view, readied bag) is closed by its section teardown; NewGame resets it. Its bags and worn
    // gear live in RUN memory / the Inventory, so a snapshot needs nothing from it.
    if (gear?.reset && !this.runParticipants.some(p => p.id === 'gear')) this.runParticipants.push({id: 'gear', save: () => null, load: () => {}, reset: () => gear.reset!()});
  }
  private bagStoreWired = false;

  /** Iteration 16: install an inventory (in place when lane GEAR's loadJSON exists, keeping the object identity; else replace). */
  private installInventory(inv: Inventory): void {
    const live = this.inv as unknown as {loadJSON?(j: unknown): void};
    const next = inv as unknown as {toJSON?(): unknown};
    if (typeof live.loadJSON === 'function' && typeof next.toJSON === 'function') live.loadJSON(next.toJSON());
    else this.inv = inv;
    this.lastSlot = this.inv.selected;
  }

  /** Iteration 16: NewGame state — fresh starter kit, survival 80/80, battery 80 %, lane state reset, run stats zeroed (hp: Player.spawn). */
  private resetCarry(): void {
    this.survival.reset(); // food/water 80/80
    this.torch.reset(); // Iteration 12 (LIGHT): battery back to its 80 % start, light on, no dip in progress
    // Pistol lane: start with the pistol (15 + 45 x 9 mm) now that its art is ready; the rifle branch is the gate-off fallback.
    this.installInventory(starterInventory(this.startWeapon));
    this.lastSlot = 0;
    this.stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
    resetParticipants(this.runParticipants);
  }

  /** Iteration 16: Retry level — the carry state exactly as it was when the level was entered (no free heal or refill). */
  private restoreCarryFrom(snap: RunSnapshot): void {
    this.torch.reset(snap.battery.charge); // re-registers the light sources; the exact on / died flags follow
    this.survival.reset();
    const inv = restoreCarry(snap, {player: this.player, survival: this.survival, battery: this.torch.battery, stats: this.stats});
    this.torch.battery.update(0); // output from the restored flags
    this.installInventory(inv);
    this.player.alive = this.player.hp > 0;
    restoreParticipants(snap, this.runParticipants);
  }

  /** Iteration 16: the Retry-level snapshot of the level just entered (carry state + that level's section memories). */
  private levelEntrySnapshot(): RunSnapshot {
    const k = this.run.current;
    return takeSnapshot({level: k.level, section: k.section, arrival: this.arrival},
      {inv: this.inv, player: this.player, survival: this.survival, battery: this.torch.battery, participants: this.runParticipants, stats: this.stats},
      this.run.levelMemories(k.level));
  }

  /** Iteration 16: from a click — audio resumes and pointer lock is requested inside the gesture (the rebuild can outlast it). */
  private beginGesture(): Promise<boolean> {
    this.sfx.init();
    return this.input.lock();
  }

  /** Iteration 16: the title panel as the loading screen (menu travel, new game, retry). */
  private showLoading(intro: string, label: string): WarmupUi {
    this.lifecycleCounts.loading++;
    const ui = titleWarmupUi();
    $('#station-intro').textContent = intro;
    if (ui.bar) ui.bar.style.width = '0%';
    ui.label.textContent = label;
    if (ui.button) ui.button.disabled = true;
    $('#title').dataset.mode = 'loading';
    if (this.state !== 'loading') this.setState('loading');
    return ui;
  }

  /** Iteration 16: lazy-model progress on a warm-up UI. */
  private progressTo(ui: WarmupUi, what: string): (f: number, file: string) => void {
    return (f, file) => { if (ui.bar) ui.bar.style.width = `${Math.round(f * 100)}%`; ui.label.textContent = `${what} · ${file} · ${Math.round(f * 100)}%`; };
  }

  /** Iteration 16: the warm-up is done — the loading screen's ready line (and the start button). */
  private readyLine(ui: WarmupUi, w: WarmupResult): void {
    const note = warmupNote(w);
    ui.label.textContent = `Ready · ${this.layout.areas.length} spaces generated${note ? ` · ${note}` : ''}`;
    if (ui.bar) ui.bar.style.width = '100%';
    if (ui.button) ui.button.disabled = false;
  }

  /**
   * Iteration 16 (RUN): NEW GAME — a fresh run starting at `level`'s entry section: the iteration-15 starter kit, full
   * health, survival 80/80, battery 80 %, no injuries / gear, new level seeds (unless given) with a new gear roll, no
   * section memories. `enter` (a click): pointer lock is requested inside the gesture and play starts after the
   * warm-up; otherwise the caller shows the title (boot, the title's level choice). Single flight with travel / retry:
   * resolves null if another lifecycle operation is running.
   */
  newGame(level: LevelId, o: {seeds?: Partial<Record<LevelId, number>>; enter?: boolean; onProgress?: (frac: number, label: string) => void} = {}): Promise<WarmupResult | null> {
    if (this.lifecycle.busy) return Promise.resolve(null);
    const lock = o.enter ? this.beginGesture() : null;
    const back = this.state;
    const flight = this.lifecycle.run(async () => {
      this.wireRunLanes();
      const def = LEVELS[level];
      const seeds: Record<LevelId, number> = {subway: o.seeds?.subway ?? freshSeed(), office: o.seeds?.office ?? freshSeed()};
      const key: SectionKey = {level, section: def.entry};
      const run = createRun({seeds, start: key, levels: LEVELS, rollGear: rollLevelGear});
      const ui = this.showLoading(`New run · ${def.name}. ${def.blurb}`, `Generating ${def.name}…`);
      await nextPaint();
      let layout: StationLayout;
      try { layout = await this.prepareSection(key, run, o.onProgress ?? this.progressTo(ui, 'Loading station props')); } catch (err) { this.lifecycleFailed(err, back, ui); return null; }
      await this.warmRun; // Iteration 14: never rebuild under a running warm-up (it owns the renderer state)
      this.leaveSection(false); // the old run is discarded (lane teardown still runs against it)
      this.run = run;
      this.resetCarry();
      this.buildSection(key, layout, {kind: 'start'}, true);
      this.run.entered.push(level);
      this.run.entry = this.levelEntrySnapshot();
      this.updateStationIntro();
      // Iteration 14: the new station's first-use graphics are prepared on the loading screen before play (pipelines
      // already built for the previous station are cache hits; new instanced meshes / models are not)
      const w = await this.prepareGraphics(ui);
      if (w.status === 'cancelled') return w; // the device was lost
      this.readyLine(ui, w);
      if (lock) void lock.then(() => this.enterPlay());
      return w;
    });
    return flight ?? Promise.resolve(null);
  }

  /**
   * Iteration 16 (RUN): RETRY LEVEL (death screen) — back to the snapshot taken when this logical level was entered: the
   * inventory, hp / stamina, hunger / thirst, battery, injuries and run stats as they were then, and the level's
   * sections as they were then. Nothing is healed or refilled beyond that state. Single flight.
   */
  retryLevel(): Promise<WarmupResult | null> {
    const snap = this.run.entry;
    if (!snap) return this.newGame(this.run.current.level, {enter: true});
    if (this.lifecycle.busy) return Promise.resolve(null);
    const lock = this.beginGesture();
    const flight = this.lifecycle.run(async () => {
      const key: SectionKey = {level: snap.level, section: snap.section};
      const def = LEVELS[key.level];
      const ui = this.showLoading(`Retry · ${def.name}: back to how you entered it — the same kit, health and supplies as then.`, `Rebuilding ${def.name}…`);
      await nextPaint();
      let layout: StationLayout;
      try { layout = await this.prepareSection(key, this.run, this.progressTo(ui, 'Loading station props')); } catch (err) { this.lifecycleFailed(err, 'dead', ui); return null; }
      await this.warmRun;
      this.leaveSection(false); // this level's memories are replaced by the snapshot's
      this.run.restoreLevelMemories(snap.level, snap.memories);
      this.restoreCarryFrom(snap);
      this.buildSection(key, layout, snap.arrival, false); // (the loading screen keeps saying what Retry restores)
      const w = await this.prepareGraphics(ui);
      if (w.status === 'cancelled') return w;
      this.readyLine(ui, w);
      void lock.then(() => this.enterPlay());
      return w;
    });
    return flight ?? Promise.resolve(null);
  }

  /** Iteration 16: generating / preparing a section failed BEFORE the live world was touched: back to `back` (the error screen at boot). */
  private lifecycleFailed(err: unknown, back: GameState, ui: WarmupUi): void {
    console.error('Iteration 16: building a section failed', err);
    this.lastError = String((err as Error)?.stack ?? err);
    const msg = String((err as Error)?.message ?? err).slice(0, 160);
    ui.label.textContent = `Could not build that level (${msg})`;
    if (ui.button) ui.button.disabled = !this.world;
    if (!this.world) {
      $('#error-msg').textContent = `Building the level failed: ${msg}`;
      this.setState('error');
    } else this.setState(back === 'loading' ? 'title' : back);
  }

  /** Iteration 16: a travel is in flight. */
  get travelling(): boolean {
    return this.travelReq !== null;
  }
  private travelReq: TravelRequest | null = null;

  /**
   * Iteration 16 (RUN) / 17: TRAVEL to another LOGICAL level (the pause / clear menus). Nothing inside a level travels:
   * its storeys are one continuous world (stairs, the moving elevator). Single flight; refused when dead. Cancels
   * transient actions (timed use, flare hold, ADS, open UIs), saves the current level's memory, generates + builds the
   * target behind the full loading screen, applies its memory, places the player at its start (nothing about the player
   * is reset), runs the iteration-14 warm-up, then resumes play. Entering another level takes its Retry snapshot.
   */
  travel(req: TravelRequest): Promise<TravelResult> {
    this.lifecycleCounts.travel++;
    const refusal = travelRefusal(req, {
      busy: this.lifecycle.busy, alive: this.player.alive, state: this.state, ready: !!this.world && !!this.gpu,
      sections: l => LEVELS[l]?.sections(this.run.seeds[l]) ?? null, current: this.run.current.level,
    });
    if (refusal) return Promise.resolve({ok: false, reason: refusal});
    const lock = this.beginGesture(); // a menu click: pointer lock is requested inside the gesture
    const flight = this.lifecycle.run(async (): Promise<TravelResult> => {
      const from = {...this.run.current};
      const levelChange = req.to.level !== from.level;
      const def = LEVELS[req.to.level];
      this.travelReq = req;
      this.cancelUse('travel');
      this.cancelFlareHold();
      this.aiming = false;
      const ui = this.showLoading(`${req.label}. Your inventory, gear, health, food and water, battery and injuries come with you.`, `Building ${def.name} · ${sectionLabel(req.to)}…`);
      let built = false;
      try {
        await nextPaint();
        const layout = await this.prepareSection(req.to, this.run, this.progressTo(ui, 'Loading props'));
        await this.warmRun;
        this.leaveSection(true);
        built = true;
        this.buildSection(req.to, layout, req.arrival, false);
        if (levelChange) { this.run.entered.push(req.to.level); this.run.entry = this.levelEntrySnapshot(); }
        const w = await this.prepareGraphics(ui); // (a menu travel's loading screen keeps its carry-over line)
        if (w.status === 'cancelled') return {ok: false, reason: 'cancelled'};
        this.readyLine(ui, w);
        const ok = await lock;
        if (ok) await this.enterPlay();
        else this.setState('paused');
        if (this.state === 'paused') $('#pause .fine').textContent = 'The browser did not capture the mouse — click Resume to try again.';
        this.hud.toast(levelChange ? `${def.name} · ${sectionLabel(req.to)} — your kit and condition came with you` : req.label);
        return {ok: true};
      } catch (err) {
        console.error('Iteration 16: travel failed', err);
        this.lastError = String((err as Error)?.stack ?? err);
        if (!built) { this.setState('paused'); $('#pause .fine').textContent = `Travel failed (${String((err as Error)?.message ?? err).slice(0, 120)}) — you are still here.`; }
        else { $('#error-msg').textContent = `Travel failed while building the next area: ${String((err as Error)?.message ?? err).slice(0, 160)}`; this.setState('error'); }
        return {ok: false, reason: 'failed'};
      } finally {
        this.travelReq = null;
      }
    });
    return flight ?? Promise.resolve({ok: false, reason: 'busy'});
  }

  /**
   * Iteration 14: a quality change (pause menu) rebuilds the atmosphere's targets — a new render context, so every
   * station pipeline would compile again on the first frames after Resume. Re-run the warm-up right here (progress in
   * the pause panel, Resume held until it finishes). Shader-affecting configuration changes call this hook.
   */
  async rewarmAfterSettings(): Promise<void> {
    if (!this.world || this.state !== 'paused') return;
    const line = $('#pause .fine'), resume = $('#btn-resume') as HTMLButtonElement;
    const was = line.textContent;
    const w = await this.prepareGraphics({bar: null, label: line, button: resume});
    const note = warmupNote(w);
    line.textContent = w.status === 'complete' || !note ? was : `${was} (${note})`;
  }

  /** Iteration 14: queue a GPU-side release of the previous station (run after the next warm-up). */
  private retire(fn: () => void): void {
    this.retired.push(fn);
  }

  /** Iteration 14: run the queued releases (after the new station's warm-up, or before the next teardown). */
  private flushRetired(): void {
    const list = this.retired;
    this.retired = [];
    for (const fn of list) {
      try { fn(); } catch (err) { console.warn('Iteration 14: releasing previous-station GPU resources failed', err); }
    }
  }

  /**
   * Iteration 14: readiness boundary for content added AFTER the loading screen (render/warmup.ts prepareObjects): add
   * `root` to the scene hidden, await this, then show it. Things created on use that recur (effects, thrown items) should
   * instead be registered as warm-up pools / prototypes (warmRegistry) so the loading screen covers them.
   */
  prepareBeforeShow(root: THREE.Object3D): Promise<void> {
    const target = this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera);
    return prepareObjects(this.renderer as unknown as WarmupRenderer, this.scene, this.camera, root, target);
  }

  /** Iteration 14: the title / loading screen's station line (boot and restarts). */
  updateStationIntro(): void {
    // Iteration 16 (RUN) / 17: per level — what is still alive here (kills earlier in the run stay dead)
    const k = this.run.current, n = this.zombies.filter(z => z.brain.alive).length;
    $('#station-intro').textContent = k.level === 'office'
      ? `Office Space — ${this.layout.name} and the tower above it, lobby to floor 8. ${n} infected reported in the station and on the floors. Clear them out.`
      : `${this.layout.name}. ${n} infected reported below street level. Clear them out.`;
  }

  /**
   * Iteration 14 (primary): the loading-screen render warm-up for the current station (render/warmup.ts) on the
   * backend / quality that will actually run, with its truthful progress on the loading bar. Single flight (a second
   * call while one runs gets the same promise); resolves (never rejects) once the renderer state is restored, with the
   * status — complete / partial (time budget) / cancelled (station replaced, device lost) / failed / skipped. Only
   * renderer-side preparation: no update tick, AI, physics, loot, battery / flare timers or sound. A later quality
   * change rebuilds the atmosphere's targets (a new render context), so those first frames compile again.
   */
  prepareGraphics(ui: WarmupUi = titleWarmupUi()): Promise<WarmupResult> {
    if (this.warmRun) return this.warmRun;
    const run = this.runWarmup(ui).finally(() => { this.warming = false; this.warmRun = null; this.flushRetired(); });
    this.warmRun = run;
    return run;
  }

  private async runWarmup(ui: WarmupUi): Promise<WarmupResult> {
    this.lifecycleCounts.warmup++;
    const {bar, label, button} = ui;
    const mode = warmupMode(location.search, this.softwareGl?.software === true);
    if (mode === 'off') return (this.warmup = skippedWarmup('disabled by ?warmup=off'));
    if (!this.world || !this.gpu || this.gpu.deviceLost || !this.renderer.initialized) return (this.warmup = skippedWarmup('renderer or station not ready'));
    this.warming = true;
    if (button) button.disabled = true;
    // a quality change mid-run would dispose the render target being compiled into
    const quality = document.querySelector<HTMLSelectElement>('#set-quality');
    const qualityWas = quality?.disabled ?? false;
    if (quality) quality.disabled = true;
    if (bar) bar.style.width = '0%';
    label.textContent = 'Preparing graphics…';
    const gen = this.stationGen;
    const res = await runWarmup({
      renderer: this.renderer as unknown as WarmupRenderer,
      scene: this.scene, camera: this.camera, mode, registry: this.warmRegistry,
      near: {center: this.camera.getWorldPosition(new THREE.Vector3()), radius: 24},
      sceneTarget: () => this.atmosphereBypass ? null : this.atmosphere.warmTarget(this.scene, this.camera),
      torch: this.flashlight, torchIntensity: MOOD.flashlight,
      frame: () => this.drawFrame(),
      finish: () => { this.world.culler.update(this.camera, true); this.atmosphere.resetHistory(); this.render(); },
      hide: hidden => { this.canvas.style.visibility = hidden ? 'hidden' : ''; },
      alive: () => gen === this.stationGen && !this.gpu?.deviceLost,
    }, {
      onProgress: (p: WarmupProgress) => { if (bar) bar.style.width = `${Math.floor(p.done / Math.max(1, p.total) * 100)}%`; label.textContent = warmupLabel(p); },
    });
    this.warmup = res;
    const st = res.stages;
    if (button) button.disabled = false;
    if (quality) quality.disabled = qualityWas;
    console.info(`Terminal State: graphics warm-up ${res.status}${res.reason ? ` (${res.reason})` : ''} · ${res.mode} · ${(res.ms / 1000).toFixed(1)} s · `
      + `materials ${st.materials.done}/${st.materials.total} · passes ${st.passes.done}/${st.passes.total} · shadow frames ${st.shadows.done}/${st.shadows.total}`);
    return res;
  }

  /**
   * Iteration 07 (Lane Q): build + register one enemy for a spawn (zombie look or archetype actor).
   * Zombies wear a seeded body x outfit look (deterministic per station seed + spawn index; 'coated' =
   * heavy coat outfit), falling back to the legacy single template when no registry body is loaded.
   */
  spawnEnemy(s: ZombieSpawn, i: number): EnemyActor {
    const models = this.assets.models as unknown as Record<string, import('three/addons/loaders/GLTFLoader.js').GLTF | undefined>;
    const looks = (this.zombieLooks ??= new ZombieLookLibrary(models));
    const {actor: z, fallback} = createEnemyActor(s, models, this.rand, () => {
      const source = looks.bodies.length ? looks.build(pickZombieLook(this.currentSeed, i, s.type, looks.available)) : models.zombie;
      if (!source) throw new Error('no zombie body model loaded (registry bodies and legacy zombie-rigged.glb both missing)');
      return new ZombieActor(source, s, this.rand);
    });
    if (fallback) this.enemyFallbacks++;
    this.damage.installZombie(z); // Lane D: own wound-patched material clones (body + every wearable)
    // Lane T: spawn on the local floor height; Lane B (iteration 08): of the spawn's own level
    z.brain.y = z.root.position.y = s.y ?? this.levels.grid(s.level ?? 0).floorAt(s.x, s.z);
    this.zombies.push(z);
    this.scene.add(z.root);
    this.atmosphere.markShadows(z.root, false); // Lane F: enemies block the flashlight beam
    return z;
  }

  // ---------------------------------------------------------------------------------------
  setState(s: GameState): void {
    if (this.gpu?.deviceLost) s = 'error'; // Iteration 13 (CORE): a lost device keeps the error screen up (nothing can render)
    const prev = this.state;
    this.state = s;
    this.input.active = s === 'playing';
    if (s !== 'playing') { this.input.clear(); this.cancelUse(s); this.cancelFlareHold(); }
    this.invUI.cancelDrag();
    for (const id of ['title', 'pause', 'inventory', 'death', 'win', 'error']) $('#' + id).classList.add('hidden');
    const screen: Partial<Record<GameState, string>> = {title: 'title', paused: 'pause', inventory: 'inventory', dead: 'death', won: 'win', error: 'error', loading: 'title'};
    if (screen[s]) $('#' + screen[s]).classList.remove('hidden');
    this.hud.show(s === 'playing' || s === 'paused' || s === 'inventory');
    // Only frozen menus silence audio; any other (incl. future overlay) state keeps it running.
    this.sfx.suspend(s === 'paused' || s === 'inventory' || s === 'title' || s === 'loading' || s === 'error');
    if (s === 'inventory') { this.invUI.selected = null; this.invUI.render(); }
    if (s !== 'playing' && prev === 'playing') this.input.unlock();
    this.lastFrame = performance.now();
    for (const fn of this.stateListeners) { try { fn(s, prev); } catch (err) { console.warn('Iteration 16: a state listener failed', err); } }
  }

  /** Called from a click (user gesture): audio + pointer lock, then play. */
  async enterPlay(): Promise<void> {
    this.sfx.init();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    const ok = await this.input.lock();
    this.setState(ok ? 'playing' : 'paused');
    if (!ok) $('#pause .fine').textContent = 'The browser did not capture the mouse — click Resume to try again.';
    else $('#pause .fine').textContent = 'Combat is frozen while this menu is open.';
  }

  private onKey(code: string): void {
    if (code === 'KeyM' && this.state !== 'loading') {
      this.settings.muted = !this.settings.muted;
      this.sfx.setMuted(this.settings.muted);
      ($('#set-mute') as HTMLInputElement).checked = this.settings.muted;
      if (this.state === 'playing') this.hud.toast(this.settings.muted ? 'Audio muted' : 'Audio on');
    }
    if (this.state === 'playing') {
      if (code === 'Tab' || code === 'KeyI') this.openInventory();
      // Browsers normally swallow Esc to exit pointer lock (handled by onLockChange); if the
      // page does receive it, pause directly.
      else if (code === 'Escape') this.setState('paused');
    } else if (this.state === 'inventory') {
      if (code === 'Tab' || code === 'KeyI' || code === 'Escape') this.closeInventory();
      const m = /^Digit([1-5])$/.exec(code);
      if (m) this.invUI.assign(Number(m[1]) - 1);
    } else if (this.state === 'paused' && code === 'Escape' && this.qa) {
      void this.enterPlay();
    }
  }

  openInventory(): void {
    this.cancelUse('inventory');
    this.setState('inventory');
  }

  /** Abort a timed use without consuming (slot switch, sprint, hit, menus, death); the gun comes back up. */
  private cancelUse(reason: string): void {
    if (!this.use) return;
    this.use = null;
    this.consumeView?.cancel(reason);
  }

  closeInventory(): void {
    void this.enterPlay();
  }

  // ---------------------------------------------------------------------------------------
  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'high' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.settings.quality === 'high' ? dpr : Math.min(dpr, 0.85));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.setAspect(w / h);
    // Lane F: atmosphere quality follows the settings quality (?fog= overrides); targets track the drawing buffer.
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.atmosphere.setQuality(this.settings.quality);
    this.atmosphere.setSize(db.x, db.y);
    this.overlay.setSize(db.x, db.y); // Iteration 13 (CORE): viewmodel overlay target tracks the drawing buffer
  }

  applySettings(): void {
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.sfx.setVolume(this.settings.volume);
    this.sfx.setMuted(this.settings.muted);
    this.resize();
  }

  frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const cpu = this.frameCpu;
    cpu.updateMs = cpu.renderMs = 0;
    cpu.rendered = false;
    // Iteration 14: the warm-up owns the renderer (render target / layers / hidden frames) until it resolves
    if (this.warming) { this.input.endFrame(); return; }
    if (this.state === 'playing' || (this.state === 'won' && this.wonAt >= 0)) {
      const playing = this.state === 'playing';
      if (playing) this.update(dt);
      const r0 = performance.now();
      if (playing) cpu.updateMs = r0 - now;
      cpu.rendered = this.render();
      cpu.renderMs = performance.now() - r0;
      this.frames++;
    } else if (this.world) {
      // menus: keep the frozen frame fresh at a low rate
      this.renderT -= dt;
      if (this.renderT <= 0) {
        this.renderT = 0.25;
        const r0 = performance.now();
        cpu.rendered = this.render();
        cpu.renderMs = performance.now() - r0;
      }
    }
    this.input.endFrame();
  }

  /** Draws the frame; false when there is nothing to draw with (lost device / renderer not initialized). */
  render(): boolean {
    if (this.gpu?.deviceLost || !this.renderer.initialized) return false; // Iteration 13 (CORE): lost device / not initialized: nothing to draw with
    this.world?.culler.update(this.camera); // Iteration 08 (Lane G): level / fog culling (cheap; skipped while still)
    this.drawFrame();
    return true;
  }

  /** Iteration 14: the frame itself (station + atmosphere, then the viewmodel overlay); the warm-up's hidden frames call it without the culler. */
  private drawFrame(): void {
    if (this.gpu?.deviceLost || !this.renderer.initialized) return;
    this.renderer.info.reset();
    // Iteration 06 (Lane F): station scene + volumetric haze composited onto the canvas (direct r5 path when
    // off/unsupported); the viewmodel overlay is drawn on top afterwards, never fogged.
    // Iteration 13 (CORE): an atmosphere that throws on this renderer is bypassed (recorded, logged) -> direct scene render.
    if (!this.atmosphereBypass) {
      const sceneState = {background: this.scene.background, backgroundNode: this.scene.backgroundNode, fog: this.scene.fog};
      try {
        this.atmosphere.render(this.scene, this.camera, this.time);
      } catch (err) {
        this.atmosphereBypass = `atmosphere render failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`;
        if (this.gpu) recordGpuError(this.gpu, this.atmosphereBypass);
        console.error('Iteration 13: atmosphere render failed; rendering the station directly', err);
        // a pipeline that threw mid-pass may have left the output transform switched off (RenderPipeline does that per pass)
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.autoClear = false;
        // Iteration 13 (primary): three r186's ShadowNode.updateShadow has no finally. A throw inside the flashlight
        // shadow pass leaves its render-object function (casters only, shadow material), the override material, MRT /
        // render target and the scene's cleared background in place, and every later frame draws nothing. Put them back.
        this.renderer.setRenderObjectFunction(null);
        this.renderer.setMRT(null);
        this.renderer.setRenderTarget(null);
        this.renderer.setClearColor(0x000000, 1);
        Object.assign(this.scene, sceneState, {overrideMaterial: null});
        this.renderDirect();
      }
    } else this.renderDirect();
    // Iteration 13 (CORE): the viewmodel renders into its own target and is composited over the frame (render/overlay.ts),
    // replacing clearDepth() + a second canvas render (WebGPURenderer tone-maps in a separate output pass).
    if (OverlayPass.hasVisible(this.viewmodel.scene)) this.overlay.render(this.renderer, this.viewmodel.scene, this.viewmodel.camera);
  }

  /** Iteration 13 (CORE): the station straight to the canvas (scene background clears; the renderer's output pass tone-maps). */
  private renderDirect(): void {
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------------------
  private selectSlot(i: number): void {
    if (i === this.inv.selected) return;
    this.lastSlot = this.inv.selected;
    this.inv.select(i);
    this.cancelUse('slot');
    this.syncHeld();
  }

  /** Equip whatever is in the selected quick slot. */
  syncHeld(): void {
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    if (def?.kind === 'weapon') {
      if (this.weapon.stack !== st) { this.weapon.equip(st); this.sfx.equip(); }
      this.viewmodel.setItem(st!.itemId);
    } else {
      this.weapon.equip(null);
      this.viewmodel.setItem(def?.kind === 'consumable' || def?.kind === 'throwable' ? st!.itemId : null); // Iteration 12 (LIGHT): a held flare shows
    }
    // Iteration 15: while a flare is readied the hand shows it (whatever pickups / inventory changes happen meanwhile)
    if (this.flareHold.active) { this.weapon.equip(null); this.viewmodel.setItem('flare'); }
  }

  /** Iteration 15: drop a readied flare without throwing (nothing spent); the held item comes back. */
  private cancelFlareHold(): void {
    if (this.flareHold.cancel()) this.syncHeld();
  }

  /**
   * Iteration 12 (LIGHT): strike + toss one flare (T from anywhere in the inventory; left click with a flare held). Exactly one
   * item is removed, and only once the throw happened: at the cap / cooldown / without physics nothing is used (HUD message).
   */
  private throwFlare(fromHeld: boolean): void {
    const ref = fromHeld && this.inv.selectedStack()?.itemId === 'flare' ? {bar: 'hotbar' as const, index: this.inv.selected} : null;
    if (this.use || this.consumeView.busy || this.player.climbing) return;
    const p = this.player;
    // throwOneFlare: refused (cap / cooldown / no physics / none) -> nothing removed; else exactly one removed, then thrown
    const r = throwOneFlare(this.flares, () => (ref ? this.inv.consumeAt(ref) : this.inv.take('flare', 1) === 1), () => this.inv.count('flare') > 0,
      this.camera.getWorldPosition(new THREE.Vector3()), this.forward(), {x: p.vx, y: p.grounded ? 0 : p.vy * 0.5, z: p.vz});
    if (!r.ok) {
      if (r.reason === 'none') { this.hud.toast('No flares — find one first', true); this.sfx.denied(); }
      else if (r.reason === 'cap') { this.hud.toast('Three flares already burning — wait for one to burn out', true); this.sfx.denied(); }
      return; // 'cooldown' (a double press) / 'unavailable': silent
    }
    this.stats.itemsUsed++;
    const left = this.inv.count('flare');
    this.hud.toast(`Flare thrown · ${left ? `${left} left` : 'last one'}`);
    // the hands were busy: the held item / gun comes back up from below
    this.viewmodel.setItem(null);
    this.syncHeld();
  }

  /** Iteration 12 (LIGHT): F — switch click; with a flat battery the light stays off (dry click + hint, at most every 4 s). */
  private toggleFlashlight(): void {
    const r = this.torch.toggle();
    if (r !== 'dead') { this.sfx.click(1.4); return; }
    this.sfx.click(0.6);
    if (this.time - this.deadHintAt > 4) { this.deadHintAt = this.time; this.hud.toast(this.inv.count('battery') ? 'Flashlight battery is flat — use a battery' : 'Flashlight battery is flat — find a battery', true); }
  }
  private deadHintAt = -Infinity;

  /** Iteration 12 (LIGHT): battery / flicker -> SpotLight + body glow + their light sources; HUD warnings; flicker crackle. */
  private updatePlayerLight(dt: number, eye: THREE.Vector3): void {
    const p = this.player, L = this.levels;
    const ev = this.torch.update(dt, {
      sources: this.lightSources, eye, feet: {x: p.x, y: p.y, z: p.z}, yaw: p.yaw, level: L.levelAt(p.x, p.z, p.y + 0.05),
      raycast: (o, d, max) => raycastWorld(L, this.layout.props, o, d, max, this.layout.trench.floorY).t,
    });
    for (const e of ev) {
      if (e === 'low') this.hud.toast('Flashlight battery low — it will start to flicker', true);
      else if (e === 'critical') this.hud.toast('Flashlight battery almost flat', true);
      else if (e === 'died') { this.hud.toast(this.inv.count('battery') ? 'Flashlight battery died — use a battery' : 'Flashlight battery died', true); this.sfx.click(0.7); }
      else if (e === 'dip') this.sfx.flashlightFlicker?.(this.torch.battery.flicker);
    }
  }

  private equipRef(ref: SlotRef): void {
    if (ref.bar === 'hotbar') { this.selectSlot(ref.index); return; }
    this.inv.move(ref, {bar: 'hotbar', index: this.inv.selected});
    this.invUI.selected = {bar: 'hotbar', index: this.inv.selected};
    this.syncHeld();
  }

  private forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  /** Drop `count` (default: all) of a slot on the floor in front of the player (G, inventory drag-out / Drop). */
  dropRef(ref: SlotRef, count?: number): void {
    const st = this.inv.detach(ref, count);
    if (!st) return;
    if (this.use && !this.inv.find(this.use.uid)) this.cancelUse('dropped');
    const g = this.layout.grid, L = this.levels, p = this.player;
    const f = this.forward();
    let x = p.x + f.x * 0.9, z = p.z + f.z * 0.9;
    let y: number;
    if (L.count > 1) {
      // Lane B (iteration 08): on the player's own storey, in sight (not through a railing / slab), on its floor / tread.
      const s = L.supportIn(x, z, p.y + 0.05);
      const ok = !!s && L.grid(s.level).passable(...g.cellOf(x, z)) && Math.abs(s.floor - p.y) <= 0.45 && L.lineOfSight({x: p.x, y: p.y + 0.6, z: p.z}, {x, y: p.y + 0.6, z}) && !L.railCrosses(p.x, p.z, x, z, 0.05, p.y);
      if (!ok) { x = p.x; z = p.z; }
      y = L.stepAt(x, z, p.y + 0.05);
      if (!Number.isFinite(y)) y = p.y;
    } else {
      // Lane T: same level only (not over the platform edge), resting on the local floor / stair tread.
      if (!g.passable(...g.cellOf(x, z)) || Math.abs(g.floorAt(x, z) - p.y) > 0.45 || !g.lineOfSight(p.x, p.z, x, z)) { x = p.x; z = p.z; }
      y = g.stepAt(x, z);
    }
    this.pickups.add(st, x, y, z, p.yaw);
    this.hud.toast(`Dropped ${st.count > 1 ? `${st.count} × ` : ''}${itemDef(st.itemId).short}`);
    this.syncHeld();
  }

  private startUse(ref: SlotRef): void {
    const st = this.inv.get(ref);
    if (!st) return;
    const def = itemDef(st.itemId);
    if (def.kind !== 'consumable') return;
    // Iteration 12 (LIGHT): a battery is refused at >= 99 % charge (nothing used)
    // Iteration 16 (lane INJURY): a limb treatment needs its injury ("No leg injury to treat"); it heals no HP, so the HP check is skipped
    const blocked = (def.recharge ? this.torch.battery.refuseReason() : null)
      ?? (def.treats?.length ? this.injuries.refuseReason(def) : this.survival.blockReason(def, this.player.hp, this.player.maxHp));
    if (blocked) { this.hud.toast(`${blocked}${def.heal ? this.injuries.healNote() : ''}`); this.sfx.denied(); return; } // a bandage never fixes a limb
    const useTime = (def.useTime ?? 1) * this.mods.handlingMult; // Iteration 16 (lane GEAR): gloves x0.92 / arm injury (combined mods)
    this.use = {uid: st.uid, itemId: st.itemId, t: 0, total: useTime};
    // Consume view: the held gun/item lowers and this item's model comes up to the face.
    const held = this.inv.selectedStack();
    this.consumeView.start(st.itemId, useTime, held === st ? 'hand' : held ? 'swap' : 'empty');
    if (this.state === 'inventory') this.closeInventory();
  }

  private quickHeal(): void {
    const missing = this.player.maxHp - this.player.hp;
    if (missing <= 0) { this.hud.toast(`Already at full health${this.injuries.healNote()}`); this.sfx.denied(); return; } // Iteration 16: limbs need a splint / sling
    const order = missing <= 25 ? ['bandage', 'medkit'] : ['medkit', 'bandage'];
    for (const id of order) {
      for (const bar of ['hotbar', 'pack'] as const) {
        const list = bar === 'hotbar' ? this.inv.hotbar : this.inv.pack;
        const i = list.findIndex(s => s?.itemId === id);
        if (i >= 0) { this.startUse({bar, index: i}); return; }
      }
    }
    this.hud.toast('No medical supplies', true);
    this.sfx.denied();
  }

  private interact(): void {
    for (const h of this.interactHandlers) if (h()) return; // Iteration 16: lane handlers first (grounded backpack, elevator, stair doors)
    if (this.containerTarget) { this.containers?.interact(this.containerTarget); return; }
    const p = this.currentTarget;
    if (!p) {
      // Lane T (iteration 05): rescue ladder under the crosshair -> scripted climb (Space / S lets go).
      if (this.ladderAim && !this.player.climbing) {
        this.cancelUse('climb');
        this.player.startClimb(this.ladderAim.ladder, this.ladderAim.up);
        this.sfx.ladder(); // Lane S: Sound Lab ladder-rung clip
        this.ladderAim = null;
      }
      return;
    }
    const def = itemDef(p.stack.itemId);
    const before = p.stack.count;
    const prevSelectedEmpty = !this.inv.selectedStack();
    const left = this.inv.add(p.stack);
    if (left === before) { this.hud.toast('No room in inventory — drop something (Tab)', true); this.sfx.denied(); return; }
    this.sfx.pickup();
    const got = before - left;
    if (left > 0) { p.stack.count = left; this.hud.toast(`Took ${got} ${def.short} (no room for ${left})`); }
    else {
      this.pickups.remove(p);
      const ref = this.inv.find(p.stack.uid);
      if (def.kind === 'weapon' && ref?.bar === 'hotbar') {
        this.hud.toast(`${def.short} → quick slot ${ref.index + 1}${prevSelectedEmpty ? '' : ` (press ${ref.index + 1})`}`);
        if (prevSelectedEmpty) { this.selectSlot(ref.index); }
      } else this.hud.toast(def.kind === 'weapon' ? `${def.short} stored in backpack` : `+${got} ${def.name}`);
    }
    this.syncHeld();
  }

  /**
   * Container feedback (open/close start, search results). Audio hook: wire the audio lane's
   * sfx.containerOpen / containerClose / search here on e.type 'open' | 'close' | 'search'.
   */
  private onContainerEvent(e: ContainerEvent): void {
    if (e.message) this.hud.toast(e.message, e.warn);
    // Iteration 08 (Lane I): openables name an existing holder's door cues (Sound Lab bank reused) and are rate-limited.
    const sound: string = e.sound ?? e.container.kind, cp = e.container.prop;
    const at = {x: cp.x, y: cp.y + cp.h * 0.5, z: cp.z};
    const door = e.type !== 'open' && e.type !== 'close' || this.doorSounds.allow(e.container.serial, this.time);
    if (e.type === 'spill') {
      for (const s of e.spilled ?? []) {
        const st = this.inv.makeStack(s.lot.itemId, s.lot.count);
        st.count = s.lot.count; // finite: the same lot (id kept as provenance), never re-rolled
        this.pickups.addAt(st, s.matrix, {holder: e.container.serial, lot: s.lot.id});
      }
    } else if (e.type === 'open') { if (door) this.sfx.containerOpen(sound, at); if (e.rummage !== false && door) this.sfx.search(); }
    else if (e.type === 'close') { if (door) this.sfx.containerClose(sound, at); }
    // an openable's item / chunk collision follows its open compartments (world/containers.ts openPhysicsBoxes)
    if ((e.type === 'open' || e.type === 'close') && e.container.open) this.physics.propsChanged(cp.x, cp.z);
    else if (e.type === 'search') this.sfx.pry(sound, at); // Lane S: pry start (vending): strain + latch snap
    if (e.result?.taken.length) { this.sfx.pickup(); this.syncHeld(); }
    else if (e.result?.remaining.length) this.sfx.denied();
  }

  private currentTarget: ReturnType<PickupManager['target']> = null;
  /** Lane T: rescue ladder under the crosshair within reach ([E] climbs up / down). */
  ladderAim: {ladder: Ladder; up: boolean; t: number} | null = null;
  containers: ContainerManager | null = null;
  private containerTarget: ContainerTarget | null = null;
  private readonly doorSounds = new SoundGate();

  currentSpread(def: WeaponDef): number {
    const moving = Math.min(1, this.player.speed / WALK_SPEED);
    const base = this.aiming ? def.spreadAim : def.spreadHip;
    return (base + def.spreadMove * moving * (this.aiming ? 0.4 : 1) + this.bloom + (this.player.sprinting ? 0.05 : 0)) * stanceSpreadMult(this.player.crouched)
      * this.mods.spreadMult; // Iteration 16: gloves / arm injury
  }

  // ---------------------------------------------------------------------------------------
  update(dt: number): void {
    this.time += dt;
    this.stats.time += dt;
    this.mods = combineModifiers(this.modifierSources); // Iteration 16: gear + injuries, from base values every frame
    const inp = this.input;
    const p = this.player;
    const sens = this.settings.sens * 0.0022 * (this.aiming ? 0.65 : 1);
    p.yaw -= inp.dx * sens;
    p.pitch -= inp.dy * sens * (this.settings.invertY ? -1 : 1);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

    for (let i = 0; i < 5; i++) if (inp.hit(`Digit${i + 1}`)) this.selectSlot(i);
    if (inp.wheel) { const i = (this.inv.selected + Math.sign(inp.wheel) + 5) % 5; this.selectSlot(i); }
    if (inp.hit('KeyQ')) this.selectSlot(this.lastSlot);
    if (inp.hit('KeyF')) this.toggleFlashlight(); // Iteration 12 (LIGHT): battery-aware (flat: dry click only)
    if (inp.hit('KeyG')) this.dropRef({bar: 'hotbar', index: this.inv.selected});
    if (inp.hit('KeyH')) this.quickHeal();
    if (inp.hit('KeyE')) this.interact();

    const held = this.inv.selectedStack();
    const heldDef = held ? itemDef(held.itemId) : null;
    const wdef = heldDef?.kind === 'weapon' ? WEAPONS[heldDef.weaponId!] : null;
    // Iteration 15: flares are readied while T / left click (flare in hand) is held and thrown on release (weapons/flareHold.ts)
    const laneOwns = this.inputOwners.some(f => f()); // Iteration 16 (lane GEAR): a readied / open backpack owns the mouse buttons
    if (this.lmbLatch && !inp.mouse[0]) this.lmbLatch = false;
    for (const e of this.flareHold.update(dt, {
      keyDown: inp.down('KeyT'), keyPressed: inp.hit('KeyT'), mouseDown: inp.mouse[0], mousePressed: inp.mousePressed[0],
      heldIsFlare: heldDef?.kind === 'throwable' && held?.itemId === 'flare', busy: !!this.use || this.consumeView.busy || p.climbing || laneOwns,
      flares: this.inv.count('flare'), refusal: this.flares.refusal(), clears: inp.clears,
    })) {
      if (e.type === 'ready') { this.weapon.equip(null); this.viewmodel.setItem('flare'); }
      else if (e.type === 'release') this.throwFlare(e.source === 'mouse');
      else if (e.type === 'cancel') this.syncHeld();
      else if (e.reason === 'none') { this.hud.toast('No flares — find one first', true); this.sfx.denied(); }
      else { this.hud.toast('Three flares already burning — wait for one to burn out', true); this.sfx.denied(); }
      if ((e.type === 'release' || e.type === 'cancel') && inp.mouse[0]) this.lmbLatch = true; // never bleeds into the gun
    }
    const flareOwns = this.flareHold.active || this.lmbLatch || laneOwns;
    // A fresh sprint (Shift while moving forward) interrupts a timed use. Until the consume view has
    // brought the gun back up it stays lowered: no aiming, firing or reloading.
    if (this.use && (inp.hit('ShiftLeft') || inp.hit('ShiftRight')) && (inp.down('KeyW') || inp.down('ArrowUp'))) this.cancelUse('sprint');
    const vmBusy = !!this.use || this.consumeView.busy;
    this.aiming = !!wdef && inp.mouse[2] && !this.weapon.reloading && !p.sprinting && !vmBusy && !p.climbing && !this.flareHold.active && !laneOwns;
    const step = p.update(dt, inp, this.levels, this.propIndex, {aiming: this.aiming, speedMult: (this.use ? 0.6 : wdef?.moveMult ?? 1) * this.mods.speedMult, canSprint: !this.use && !inp.mouse[0]});
    if (step) this.sfx.footstep(p.sprinting, p.crouched);
    if (p.justJumped) this.sfx.jump();
    if (p.justLanded) this.sfx.land(Math.min(1, p.landSpeed / 6));
    if (p.justRung) this.sfx.ladder(); // Lane T: hand/foot on a ladder rung (Lane S: Sound Lab rung clip)
    if (p.stanceChanged) this.sfx.crouch(p.crouched);

    if (wdef && !this.flareHold.active) {
      const ev = this.weapon.update(dt, {held: inp.mouse[0] && !flareOwns, pressed: inp.mousePressed[0] && !flareOwns, reload: inp.hit('KeyR') && !vmBusy, lowered: p.sprinting || vmBusy || p.climbing}, this.inv);
      for (const e of ev) {
        if (e.type === 'fire') this.fire(e.def);
        else if (e.type === 'dry') { this.sfx.dry(e.def.sound); if (this.inv.count(e.def.ammoItem) === 0) this.hud.toast(`Out of ${itemDef(e.def.ammoItem).name.toLowerCase()}`, true); }
        else if (e.type === 'reloadStart') this.sfx.reloadStart(e.def.sound, e.empty);
        else if (e.type === 'shellIn') { this.sfx.shellIn(); this.viewmodel.shellBump(); }
        else if (e.type === 'reloadEnd') this.sfx.reloadEnd(e.def.sound);
      }
    } else if (heldDef?.kind === 'consumable' && inp.mousePressed[0] && !this.use && !flareOwns) {
      this.startUse({bar: 'hotbar', index: this.inv.selected});
    }

    if (this.use) {
      this.use.t += dt;
      if (this.use.t >= this.use.total) {
        const ref = this.inv.find(this.use.uid);
        const def = itemDef(this.use.itemId);
        // Iteration 12 (LIGHT): a battery is applied by applyBatteryItem — refused at >= 99 % (nothing used), else exactly one removed
        const refused = def.recharge ? applyBatteryItem(this.torch.battery, () => !!ref && this.inv.consumeAt(ref), def.recharge) : null;
        if (refused) this.hud.toast(refused);
        // Iteration 16 (lane INJURY): a limb treatment re-checks its injury, is consumed exactly once and cures only its limbs
        const treat = def.treats?.length ? this.injuries.completeTreatment(def, () => !!ref && this.inv.consumeAt(ref)) : null;
        if (treat?.text) this.hud.toast(treat.text, !treat.ok);
        if (treat?.ok) { this.stats.itemsUsed++; this.sfx.heal(); }
        const used = treat ? false : def.recharge ? !refused : !!ref && this.inv.consumeAt(ref);
        if (used && def.recharge) {
          this.stats.itemsUsed++;
          this.sfx.batteryInsert?.();
          this.hud.toast(`Battery swapped in: flashlight ${this.torch.battery.percent} %${this.torch.battery.on ? '' : ' (F to switch on)'}`);
        } else if (used && (def.verb === 'eat' || def.verb === 'drink')) {
          // Food/drink: restore hunger/thirst (HUD bars animate up and pop "+N").
          const d = this.survival.consume(def);
          this.stats.itemsUsed++;
          if (def.verb === 'drink') this.sfx.drink(def.id); else this.sfx.eat(def.id);
          this.hud.toast(`${def.verb === 'drink' ? 'Drank' : 'Ate'} ${def.name.toLowerCase()}: ${Survival.describe(d)}`);
        } else if (used) {
          const healed = p.heal(def.heal ?? 0);
          this.stats.healed += healed;
          this.stats.itemsUsed++;
          this.sfx.heal();
          this.hud.toast(`${def.short} used: +${Math.round(healed)} health${this.injuries.healNote()}`); // Iteration 16: HP only, never a limb
        }
        // Item lowers away (or back into the hand if the held stack remains), then the gun returns.
        this.consumeView.complete(this.inv.selectedStack()?.uid === this.use.uid);
        this.use = null;
        this.syncHeld();
      }
    }

    // Hunger/thirst: slow long-term drain in play time only (menus freeze it); at 0, slow health loss.
    const surv = this.survival.update(survivalTicks(this.state) ? dt : 0);
    if (surv.hpLoss > 0) p.takeDamage(surv.hpLoss);
    for (const w of surv.warnings) this.hud.toast(w.text, w.warn);

    this.updateZombies(dt);
    for (const fn of this.frameHooks) fn(dt); // Iteration 16: lane per-frame systems (gear / backpack, injuries, elevator)
    this.physics.update(dt); // ragdolls (fixed 1/60 steps) + casings; update() only runs while playing
    this.flares.tick(dt); // Iteration 12 (LIGHT): flare bodies -> mesh / light / smoke / sound / light-source positions, burn-out

    // recoil recovery and bloom decay
    const rec = wdef ? wdef.recoil.recover : 8;
    this.recoilPitch -= this.recoilPitch * Math.min(1, rec * dt);
    this.recoilYaw -= this.recoilYaw * Math.min(1, rec * dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.06);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.updateCamera(dt);

    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const look = this.forward();
    const reachWorld = this.levels.count > 1 ? this.levels : this.layout.grid; // Lane B: 3D occlusion on stacked levels
    this.currentTarget = this.pickups.target(eye, look, reachWorld);
    // Containers under the crosshair within reach; a closer targeted floor pickup wins.
    const tp = this.currentTarget;
    this.containerTarget = this.containers?.target(eye, look, reachWorld, tp ? Math.hypot(tp.x - eye.x, tp.y + 0.08 - eye.y, tp.z - eye.z) : Infinity) ?? null;
    // Iteration 07 (Lane K): a loose item resting INSIDE a holder's box (shot down to a lower shelf tier) wins over the holder body.
    const ct = this.containerTarget;
    if (ct && !ct.lot && tp && tp.x > ct.container.min.x && tp.x < ct.container.max.x && tp.z > ct.container.min.z && tp.z < ct.container.max.z && tp.y + 0.08 < ct.container.max.y) this.containerTarget = null;
    // Container wins: clear the pickup target + its highlight (an unreachable eye matches nothing).
    if (this.containerTarget && tp) this.currentTarget = this.pickups.target(new THREE.Vector3(0, 1e6, 0), look, reachWorld);
    // Lane T: a rescue ladder under the crosshair (only when nothing else is targeted).
    this.ladderAim = !this.currentTarget && !this.containerTarget && !p.climbing ? ladderTarget(this.layout.traversal.ladders, eye, look, p.y) : null;
    this.pickups.update(this.time);
    this.containers?.update(dt, this.time);

    this.muzzleT -= dt;
    this.muzzleLight.intensity = this.muzzleT > 0 ? 18 * (0.65 + Math.random() * 0.7) : 0; // flicker
    this.updatePlayerLight(dt, eye); // Iteration 12 (LIGHT): battery drain / flicker -> SpotLight, body glow, light sources
    this.lightPool.update(dt, eye);
    this.fx.update(dt);
    this.damage.update(dt); // Lane D: debris physics, knocked pickups
    // Audio: listener follows the camera; reverb room + ambience beds follow the current area.
    this.sfx.setListener(eye.x, eye.y, eye.z, p.yaw);
    const audioArea = this.layout.areas[this.levels.count > 1 ? this.levels.areaAt(p.x, p.z, p.y) : this.layout.grid.areaAt(p.x, p.z)];
    if (audioArea) this.sfx.setRoom(roomKindFor(audioArea), audioArea.type);
    this.sfx.vitals(dt, p.hp / p.maxHp, p.stamina / 100);
    this.sfx.ambience(dt);
    // viewmodel brightness follows nearby light
    this.viewmodel.setLightLevel(this.lightPool.viewLevel(eye, this.torch.battery.emitting)); // Iteration 12 (LIGHT): actual output
    this.consumeView.update(dt); // item-to-face pose + gun holster level, before the gun pose
    this.viewmodel.update(dt, {
      moving: Math.min(1, p.speed / WALK_SPEED), sprint: p.sprinting, aiming: this.aiming, lookDX: inp.dx, lookDY: inp.dy,
      reloading: this.weapon.reloading, reloadProgress: this.weapon.progress, using: !!this.use, useProgress: this.use ? this.use.t / this.use.total : 0, bobT: p.bobT,
      crouch: p.crouchBlend, vy: p.grounded ? 0 : p.vy, landDip: p.landDip,
      throwReady: this.flareHold.ready01, // Iteration 15: grenade-style pull-back
    });
    this.hud.setStance(p.crouched, p.standBlocked);
    this.updateHud(wdef);
    // Iteration 04 (Lane E): while sighted through the rifle optic its lens draws the reticle, so the HUD crosshair hides.
    const crosshair = document.getElementById('crosshair');
    const opticHide = this.viewmodel.opticAim > 0.6;
    if (crosshair && (crosshair.style.visibility === 'hidden') !== opticHide) crosshair.style.visibility = opticHide ? 'hidden' : '';

    if (!p.alive) this.die();
    // Iteration 16 (RUN): a SECTION is cleared once per run (remembered); the clear screen shows when its whole LEVEL is clear
    // (the subway: its one station; the office: the street station and every floor), else a toast points onward.
    const remaining = this.zombies.filter(z => z.brain.alive).length;
    if (remaining === 0 && this.wonAt < 0 && !this.sectionCleared && this.layout.zombies.length > 0 && this.state === 'playing') {
      this.wonAt = this.time;
      this.sectionCleared = true;
      this.run.memory().cleared = true;
      this.sfx.win();
      this.hud.toast(clearLabel(this.run.current));
    }
    if (this.wonAt >= 0 && this.time - this.wonAt > 1.6 && this.wonAt > -1 && !this.wonShown) {
      this.wonShown = true;
      const lvl = this.run.current.level, secs = LEVELS[lvl].sections(this.run.seeds[lvl]);
      if (this.run.levelCleared(lvl, secs)) this.showEnd('won');
    }
  }
  private wonShown = false;

  private updateCamera(dt: number): void {
    const p = this.player;
    const bob = Math.sin(p.bobT * 2) * 0.025 * Math.min(1, p.speed / WALK_SPEED);
    this.camera.position.set(p.x, p.eye + bob, p.z);
    const sh = this.shake * this.shake;
    const t = this.time;
    // Iteration 16: `aimOffset` (lane INJURY: arm-injury sway) moves the real aim — shots, crosshair and the optic dot follow it
    this.camera.rotation.set(p.pitch + this.recoilPitch + this.aimOffset.pitch + Math.sin(t * 37) * 0.02 * sh, p.yaw + this.recoilYaw + this.aimOffset.yaw + Math.sin(t * 29) * 0.02 * sh, Math.sin(t * 23) * 0.015 * sh);
    const targetFov = this.aiming ? (WEAPONS[this.weapon.def?.id ?? 'rifle']?.aimFov ?? 60) : this.settings.fov;
    const fov = this.camera.fov + (targetFov - this.camera.fov) * Math.min(1, dt * 14 || 1);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
  }

  private updateHud(wdef: WeaponDef | null): void {
    const p = this.player;
    const st = this.inv.selectedStack();
    const def = st ? itemDef(st.itemId) : null;
    let hint = '';
    if (wdef && st) {
      if (this.weapon.reloading) hint = 'Reloading…';
      else if ((st.mag ?? 0) === 0) hint = this.inv.count(wdef.ammoItem) ? 'Empty — press R' : 'No ammo';
      else if ((st.mag ?? 0) <= wdef.magazine * 0.25 && this.inv.count(wdef.ammoItem)) hint = 'Low — R to reload';
    } else if (def?.kind === 'consumable') hint = def.treats?.length ? this.injuries.treatmentHint(def) : useHint(def); // Iteration 16 (lane INJURY)
    else if (def?.kind === 'throwable') hint = throwHint(def); // Iteration 12 (LIGHT)
    let prompt = '';
    for (const f of this.promptProviders) { const lp = f(); if (lp) { prompt = lp; break; } } // Iteration 16: lane prompts (grounded bag, elevator, …)
    const lanePrompt = !!prompt;
    if (lanePrompt) { /* the lane's interactHandler takes E */ } else if (this.currentTarget) {
      const d = itemDef(this.currentTarget.stack.itemId);
      const n = this.currentTarget.stack.count;
      prompt = `<b>[E]</b> Take ${d.kind === 'weapon' ? d.name : `${n > 1 ? n + ' × ' : ''}${d.name}`}`;
    } else if (this.containerTarget && this.containers) prompt = this.containers.prompt(this.containerTarget);
    else if (this.ladderAim) prompt = this.ladderAim.up ? '<b>[E]</b> Climb ladder' : '<b>[E]</b> Climb down ladder';
    else if (p.climbing) prompt = '<b>[Space]</b> Let go';
    const spread = wdef ? this.currentSpread(wdef) : 0.02;
    const spreadPx = Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (window.innerHeight / 2);
    const multi = this.levels.count > 1; // Lane B: the area / track bed of the player's own storey
    const area = multi ? this.levels.areaAt(p.x, p.z, p.y) : this.layout.grid.areaAt(p.x, p.z);
    // Iteration 17: the office tower's storey ("Open-plan office · Floor 5 · Bramley House")
    const storey = this.layout.office && area >= 0 ? storeyLabel(this.layout, this.layout.areas[area].level ?? 0) : '';
    const storeyName = storey ? (storey === 'L' ? 'Lobby' : `Floor ${storey}`) : '';
    const storeyText = storeyName && !(area >= 0 && this.layout.areas[area].label.includes(storeyName)) ? ` · ${storeyName}` : ''; // (a stairwell label already names its floor)
    this.hud.update({
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina,
      weaponName: def ? def.short : 'Empty hands',
      mag: wdef && st ? st.mag ?? 0 : null, reserve: wdef ? this.inv.count(wdef.ammoItem) : 0,
      hint, prompt, promptItem: lanePrompt ? undefined : this.currentTarget?.stack.itemId,
      remaining: this.zombies.filter(z => z.brain.alive).length, total: this.layout.zombies.length, // Iteration 16: kills earlier in the run stay dead (not spawned)
      area: area >= 0 ? `${this.layout.areas[area].label}${storeyText} · ${this.layout.name}` : (multi ? this.levels.cellKindAt(p.x, p.z, p.y) : this.layout.grid.get(...this.layout.grid.cellOf(p.x, p.z))) === 2 ? `Track bed · ${this.layout.name}` : this.layout.name,
      spreadPx, aiming: this.aiming, flashlight: this.flashlightOn,
      use: this.use ? {label: useLabel(itemDef(this.use.itemId)), progress: this.use.t / this.use.total} : null,
      food: this.survival.hunger, water: this.survival.thirst,
      // Iteration 12 (LIGHT): battery meter + flare (grenade slot) count
      battery: {charge: this.torch.battery.charge, on: this.flashlightOn, flicker: this.torch.battery.flicker, spares: this.inv.count('battery')},
      flares: {count: this.inv.count('flare'), burning: this.flares.burningCount},
    }, this.inv);
  }

  // ---------------------------------------------------------------------------------------
  private fire(def: WeaponDef): void {
    this.stats.shots++;
    this.damage.beginShot();
    this.shotCounter++;
    this.sfx.shot(def.sound);
    this.viewmodel.fire(def, stanceRecoilMult(this.player.crouched));
    this.muzzleT = 0.05;
    const f0 = this.forward();
    this.muzzleLight.position.copy(this.camera.position).addScaledVector(f0, 0.8);
    const spread = this.currentSpread(def);
    const kickMul = (this.aiming ? 0.6 : 1) * stanceRecoilMult(this.player.crouched);
    this.recoilPitch += def.recoil.pitch * kickMul;
    this.recoilYaw += (this.rand() - 0.5) * 2 * def.recoil.yaw * kickMul;
    this.player.pitch = Math.min(1.45, this.player.pitch + def.recoil.pitch * 0.3 * kickMul);
    if (def.pellets === 1) this.bloom = Math.min(0.03, this.bloom + 0.0035);

    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const o: Vec3 = {x: origin.x, y: origin.y, z: origin.z};
    const dmg = new Map<EnemyActor, {total: number; pellets: number; head: boolean; point: THREE.Vector3}>();
    const muzzle = this.viewmodel.muzzleWorld(this.camera);
    this.fx.muzzle(muzzle, fwd, def.pellets > 1);
    this.physics.onFire(def.id, this.viewmodel, this.camera, this.player); // brass now; shotgun hull on the pump
    for (let i = 0; i < def.pellets; i++) {
      const a = this.rand() * Math.PI * 2, r = spread * Math.sqrt(this.rand());
      const dir = fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
      const d: Vec3 = {x: dir.x, y: dir.y, z: dir.z};
      // Lane B (iteration 08): through every level's bands — a slab between shooter and target stops the bullet
      const wh = raycastWorld(this.levels, this.layout.props, o, d, def.range, this.layout.trench.floorY);
      let bestT = wh.t, bestZ: EnemyActor | null = null, bestPart = 'torso';
      for (const z of this.zombies) {
        if (!z.brain.alive) continue;
        // reject zombies far from the ray
        const tx = z.brain.x - o.x, tz = z.brain.z - o.z;
        const along = tx * d.x + tz * d.z;
        if (along < -1 || along > bestT + 1) continue;
        const px = o.x + d.x * along, pz = o.z + d.z * along;
        if ((px - z.brain.x) ** 2 + (pz - z.brain.z) ** 2 > 1.6) continue;
        for (const v of z.hitVolumes) {
          const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
          if (t < bestT) { bestT = t; bestZ = z; bestPart = v.part; }
        }
      }
      // Lane D: corpses stop (and tear under) bullets too; shots passing close knock loose pickups about.
      const corpse = this.damage.corpseHit(this.zombies, o, d, bestT);
      if (corpse) { bestT = corpse.t; bestZ = null; }
      // Iteration 08 (Lane S): a filler stock piece on the pellet line (exact per-piece test; inside a stocked shelf when its box is the
      // world hit) takes the pellet: its impulse at the hit point. Loot items / pickups in front of it still take it first (Lane K path).
      const fh = this.stock.pelletHit(o, d, bestT, wh, this.layout.props, !!bestZ || !!corpse);
      if (fh) { bestT = fh.t; bestZ = null; }
      const end = origin.clone().addScaledVector(dir, bestT);
      const shot = {damage: def.damage * WeaponController.falloff(def, bestT), pellet: def.pellets > 1, weapon: def.id};
      // Iteration 07 (Lane K): items / lots / light props on the shot line take the bullet's impulse (it passes on through them)
      if (!fh) this.damage.knockPickups(o, d, bestT, wh, shot);
      else {
        if (!this.damage.knockPickups(o, d, fh.t, undefined, shot)) this.stock.shoot(fh, dir, shot.damage);
        if (fh.glass) this.damage.hitWorld(wh, origin.clone().addScaledVector(dir, wh.t), dir, shot); // through a cooler's glass
      }
      if (bestZ) {
        const mult = bestPart === 'head' ? def.headMult : bestPart === 'limb' ? def.limbMult : 1;
        const amount = def.damage * WeaponController.falloff(def, bestT) * mult;
        const e = dmg.get(bestZ) ?? {total: 0, pellets: 0, head: false, point: end};
        e.total += amount;
        e.pellets++;
        e.head ||= bestPart === 'head';
        dmg.set(bestZ, e);
        // Lane D: rest-space flesh / clothing wound + blood + flesh pieces (was fx.bodyHit only)
        this.damage.hitZombie(bestZ, end, dir, bestPart as 'head' | 'torso' | 'limb', {...shot, damage: amount});
      } else if (corpse && !fh) {
        this.damage.hitZombie(corpse.z, end, dir, corpse.part, shot, true);
        this.sfx.impact(end.x, end.y, end.z, 'flesh');
      } else if (!fh && wh.kind !== 'none') {
        // Lane D: material-matched persistent damage (craters / per-instance prop damage / breaking) + fx + sound
        this.damage.hitWorld(wh, end, dir, shot);
      }
      if (def.pellets === 1 ? this.shotCounter % 3 === 0 : i < 3) this.fx.tracer(muzzle, end);
    }
    let anyKill = false;
    for (const [z, e] of dmg) {
      const killed = z.brain.damage(e.total, this.player.x, this.player.z, this.player.y);
      z.hitFlash = 1;
      this.sfx.hitConfirm(e.point.x, e.point.y, e.point.z, z); // Iteration 12 (AUDIO): foreground (non-spatial) flesh confirm, once per enemy per shot (pellets aggregated in dmg; `z` de-dups)
      if (e.head) this.stats.headshots++;
      // knockback along the shot direction (stays out of walls)
      const k = def.knockback * (e.pellets / def.pellets) * (killed ? 1.4 : 1);
      if (!z.brain.climbing) [z.brain.x, z.brain.z] = moveCircle(this.levels, this.propIndex, z.brain.x, z.brain.z, fwd.x * k, fwd.z * k, z.brain.stats.radius, z.brain.y, z.brain.stats.height ?? BODY_CLEAR);
      if (!killed) enemyCues(z).hurt(this.sfx, z); // Lane Q: rat/dog yelp (zombies: none)
      if (killed) {
        anyKill = true;
        this.stats.kills++;
        enemyCues(z).death(this.sfx, z); // zombie death cue / rat/dog death (Lane Q adapter)
        // articulated ragdoll from the current pose, shoved by this shot (falls back to the Death clip)
        this.physics.ragdoll(z, {dir: fwd, point: e.point, strength: killImpulseStrength(def.id, e.pellets, def.pellets), bone: e.head ? 'head' : undefined});
      }
    }
    if (dmg.size) {
      this.stats.hits++;
      this.hud.hitmarker(anyKill);
      this.sfx.hitTick(anyKill);
    }
    // gunfire alerts zombies; walls muffle it (Lane B, iteration 08: a slab between storeys muffles it more). Task
    // office-seamless-20261029 (ENGINE): 3D distance, x0.35 per slab between the storeys (ai/brain.ts hearingMuffle); no
    // sight test for a zombie already beyond earshot (9 storeys of zombies per shot).
    const multi = this.levels.count > 1, P = this.player, bases = multi ? this.levels.list.map(l => l.baseY) : null;
    for (const z of this.zombies) {
      const b = z.brain;
      if (!b.alive || Math.hypot(b.x - P.x, b.z - P.z, b.y - P.y) > def.noise) continue;
      const los = multi ? this.levels.lineOfSight({x: P.x, y: P.eye, z: P.z}, {x: b.x, y: b.y + 1.5, z: b.z}) : this.layout.grid.lineOfSight(P.x, P.z, b.x, b.z);
      const muffle = hearingMuffle(los, bases ? slabsBetween(bases, P.y, b.y) : 0);
      b.hear(P.x, P.z, def.noise * muffle, P.y);
    }
  }

  private panOf(x: number, z: number): [number, number] {
    const dx = x - this.player.x, dz = z - this.player.z;
    const dist = Math.hypot(dx, dz);
    const s = Math.sin(this.player.yaw), c = Math.cos(this.player.yaw);
    const rightComp = (dx * c - dz * s) / (dist || 1);
    return [rightComp, dist];
  }

  private brainWorld(): BrainWorld {
    const g = this.layout.grid, L = this.levels, multi = L.count > 1;
    return {
      px: this.player.x, pz: this.player.z, playerAlive: this.player.alive,
      // Lane B (iteration 08): stacked levels — 3D sight between eye lines (1.5 m over the feet), so a slab between storeys blocks it.
      los: (ax, az, bx, bz, ay, by) => multi && ay !== undefined && by !== undefined ? L.lineOfSight({x: ax, y: ay + 1.5, z: az}, {x: bx, y: by + 1.5, z: bz}) : g.lineOfSight(ax, az, bx, bz),
      // Lane T (iteration 05): height-aware lines/paths (stairs, platform-edge drops, rescue-ladder links); Lane B: on the right storey.
      walkClear: (ax, az, bx, bz, r, ay, by) => multi && ay !== undefined ? L.walkLineClear(ax, ay, az, bx, bz, r, by) : g.walkLineClearH(ax, az, bx, bz, r),
      // Large station: cross-track detours via the underpasses need ~20k expansions (brain backs off on failure).
      findPath: (ax, az, bx, bz, opts) => this.pathfinder.find(ax, az, bx, bz, 0.34, 26000, opts),
      py: this.player.y,
      ladder: id => this.layout.traversal.ladders[id],
      randomNear: (x, z, r, y) => {
        // Lane B: wander targets on the zombie's own storey
        const lv = multi && y !== undefined ? L.levelAt(x, z, y + 0.05) : 0;
        const G = lv > 0 ? L.grid(lv) : g;
        for (let i = 0; i < 14; i++) {
          const tx = x + (this.rand() * 2 - 1) * r, tz = z + (this.rand() * 2 - 1) * r;
          const [cx, cy] = G.cellOf(tx, tz);
          if (G.walkable(cx, cy) && G.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.36)) {
            const c = G.center(cx, cy);
            return multi ? [c[0], c[1], G.cellFloor(cx, cy)] : c;
          }
        }
        return null;
      },
      rand: this.rand,
      // Iteration 12 (AI): light lure — this frame's attracting lights, 3D eye-to-point sight, standable goal near a lit spot (ai/lightLure.ts).
      ...lureWorld(L, this.lightSources),
    };
  }

  /** Lane B (iteration 08): a sound at (x, y, z) is occluded from the player (3D on stacked levels; 2D walls otherwise). */
  private soundOccluded(x: number, z: number, y?: number): boolean {
    const p = this.player;
    if (this.levels.count > 1 && y !== undefined) return !this.levels.lineOfSight({x: p.x, y: p.eye, z: p.z}, {x, y: y + 0.05, z}, {slack: 0.3});
    return !this.layout.grid.lineOfSight(p.x, p.z, x, z);
  }

  private updateZombies(dt: number): void {
    const w = this.brainWorld();
    const p = this.player;
    for (const z of this.zombies) {
      const b = z.brain;
      const seqBefore = b.attackSeq;
      const out = b.update(dt, w);
      if (out.face !== null) {
        let d = out.face - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = (b.state === 'attack' ? Math.max(7, b.stats.turnRate ?? 0) : b.stats.turnRate ?? 4.5) * dt;
        b.yaw += Math.max(-turn, Math.min(turn, d));
      }
      // Lane T (iteration 05): height-aware motor (stairs, drops into the track bed, ladder climbs by the brain).
      const moved = moveZombie(b, out, dt, this.levels, this.propIndex); // Lane B: stacked levels
      if (b.alive && !b.climbing) {
        // keep bodies apart: other zombies and the player (same level only: platform vs track bed do not shove)
        for (const o of this.zombies) {
          if (o === z || !o.brain.alive || !sameLevel(b.y, o.brain.y)) continue;
          const dx = b.x - o.brain.x, dz = b.z - o.brain.z, d = Math.hypot(dx, dz), min = b.stats.radius + o.brain.stats.radius;
          if (d > 1e-4 && d < min) { const push = (min - d) * 0.5; b.x += dx / d * push; b.z += dz / d * push; }
        }
        const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = b.stats.radius + p.radius + 0.22;
        if (d > 1e-4 && d < min && sameLevel(b.y, p.y)) { b.x += dx / d * (min - d); b.z += dz / d * (min - d); }
        settleZombie(b, this.levels, this.propIndex);
      }
      // positional (panner) enemy audio: vocals, swings, footfalls — per archetype (Lane Q cue adapter;
      // the zombie adapter makes exactly the previous groan / swing / gait / ladder calls)
      const [, dist] = this.panOf(b.x, b.z);
      const cues = enemyCues(z);
      if (out.alerted) cues.alert(this.sfx, z);
      if (b.attackSeq !== seqBefore) cues.attack(this.sfx, z);
      cues.tick(this.sfx, z, dt, moved, dist, this.rand);
      if (out.attackHit) this.hurtPlayer(z);
      z.animate(dt, out.anim, moved);
      z.syncTransform();
      if (!z.ragdolled) z.root.position.y = b.y; // Lane T: feet on stairs / track bed / underpass / ladder
      z.updateVolumes();
    }
  }

  private hurtPlayer(z: EnemyActor): void {
    const p = this.player;
    // Iteration 16: one hit pipeline — location -> armor (worn gear) -> HP -> listeners (limb injuries)
    // Iteration 16 (lane INJURY): rat / dog bites are 'creature' hits that land low (legs ~58 %, player/injuries.ts biteHitLocation)
    const creature = archetypeOf(z) !== 'zombie';
    const hit: PlayerHit = {amount: z.brain.stats.attackDamage, source: creature ? 'creature' : 'zombie',
      location: creature ? biteHitLocation(this.rand(), p.crouched) : meleeHitLocation(this.rand(), p.crouched), attacker: creature ? archetypeOf(z) : z.brain.type};
    const resolved = this.applyPlayerHit(hit);
    const amount = resolved.applied;
    const dx = z.brain.x - p.x, dz = z.brain.z - p.z;
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const fwd = -dx * s - dz * c, right = dx * c - dz * s;
    this.hud.damage(Math.atan2(right, fwd), amount);
    this.shake = Math.min(1, this.shake + 0.6);
    // directional camera punch: head snaps up and away from the attacker (recovers with recoil)
    this.recoilPitch += 0.035;
    this.recoilYaw += Math.sign(right) * 0.03;
    this.sfx.hurt();
    this.cancelUse('hit'); // a zombie hit knocks the item away from the face (nothing consumed)
  }

  /** Iteration 16: apply a hit to the player through armor; notifies hitListeners. Other damage sources (falls) use this too. */
  applyPlayerHit(hit: PlayerHit): ResolvedHit {
    const {applied, absorbed} = armorFor(hit, this.mods.armorHead, this.mods.armorTorso);
    this.player.takeDamage(applied);
    const resolved: ResolvedHit = {...hit, applied, absorbed};
    for (const fn of this.hitListeners) fn(resolved);
    return resolved;
  }

  private die(): void {
    if (this.state !== 'playing') return;
    this.sfx.death();
    this.showEnd('dead');
  }

  private showEnd(kind: 'dead' | 'won'): void {
    const s = this.stats, k = this.run.current;
    const acc = s.shots ? Math.round(s.hits / s.shots * 100) : 0;
    const total = this.layout.zombies.length, down = total - this.zombies.filter(z => z.brain.alive).length;
    // Iteration 16 (RUN): the section / level, its code, this section's kills and the run totals (time, kills, shots, damage)
    const text = `${LEVELS[k.level].name} · ${sectionLabel(k)} · ${this.layout.name} · code ${seedToCode(this.run.seeds[k.level])}\n`
      + `Run time ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')} · Infected down here ${down}/${total} · this run ${s.kills}\n`
      + `Shots ${s.shots} · Hits ${s.hits} (${acc}%) · Headshot hits ${s.headshots} · Damage taken ${Math.round(this.player.damageTaken)}`;
    $(kind === 'dead' ? '#death-stats' : '#win-stats').textContent = text;
    this.setState(kind);
  }

  keepExploring(): void {
    void this.enterPlay();
  }

  /** Back-compat (iteration 14 callers): restart(true) = Retry level, restart(false) = New game in the current level. */
  restart(sameSeed: boolean): void {
    void (sameSeed ? this.retryLevel() : this.newGame(this.run.current.level, {enter: true}));
  }

  /** Nearest walkable world point (helper for QA hooks); Lane B: `level` = on that level's grid. */
  snap(x: number, z: number, level = 0): [number, number] | null {
    const g = level > 0 && level < this.levels.count ? this.levels.grid(level) : this.layout.grid;
    const c = nearestWalkable(g, ...g.cellOf(x, z), 4);
    return c ? g.center(c[0], c[1]) : null;
  }
}
