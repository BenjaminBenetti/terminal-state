// Office tower runtime (iteration 16 lane TOWER; task office-seamless-20261029 lane LIFT): installs itself into Game through
// the registries (sectionHooks / frameHooks / interactHandlers / pointerHandlers / promptProviders / stateListeners /
// warmRegistry); no other Game code. Office Space is ONE continuous world (station, lobby, floors 2-8 at their real heights;
// lane GEN): this runtime builds, ONCE per built world and before its warm-up, the physically travelling elevator
// (world/elevator.ts: a cab that rides the shaft through every storey as a Levels dynamic volume — support, collision, rays and
// sight follow it — with landing doors / call stations on every storey), the window glass of every storey
// (world/officeWindows.ts) and the city outside at its real height (world/exterior.ts). Nothing here ever travels, fades, loads
// or changes the game state: the world keeps running while you ride; moving between storeys only changes positions.
//
// Task office-overhaul-20261030 (lane LIFT): every elevator button is a PHYSICAL target — no floor list / submenu. Aim the
// crosshair at a button within reach (BUTTON_REACH, facing it, nothing structural in between) -> a hover ring + a small prompt;
// LEFT CLICK (Game.pointerHandlers: the press is consumed and latched until release — no shot, flare, item use or backpack
// placement) or E presses it: a floor button lights until the cab serves it (also while riding: it is queued), the landing up /
// down buttons light until the cab arrives, door open re-opens / holds within the interlocks, door close shortens the dwell, the
// alarm rings an existing cue.
//
// Per frame (Game.frameHooks: after the player and the enemies moved, before physics / camera / pickups): the elevator
// logic steps, the cab volume follows it (floor, ceiling, reported storey, doorway gate), riders inside the cab are carried
// by its dy (the player and its eye, enemy bodies, resting pickups; physics/world.ts carries bodies, corpses, casings,
// chunks and resting flares in its own pass), the views follow (doors, indicator, lit buttons / lanterns, hover), the targeted
// button + prompt, window push-out, exterior visibility. No lights are added or removed (emissive + the baked field).

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {DynamicVolume, Levels, VolumeGate} from '../gen/levels';
import type {WorldMaterials} from './materials';
import type {WarmupRegistry} from '../render/warmup';
import {loadOfficeAsset, loadOfficeTexture, type OfficeAssetId} from '../assets/officeAssets';
import {BUTTON_REACH, ElevatorLogic, buildElevatorView, planElevator, type ElevatorEvent, type ElevatorPlan, type ElevatorView, type LampState, type LiftButton} from './elevator';
import {buildWindows, planWindows, type WindowPlan, type WindowView} from './officeWindows';
import {EXTERIOR, buildExterior, planExterior, setExteriorEye, setExteriorFootprint, setSkylineTexture, type ExteriorModels, type ExteriorPlan, type ExteriorView} from './exterior';
import {gateLocal, gateWorld, inDoorway, insideRect, pushOutRect, rayBox, rayCylinder, readTowerInfo, stopLabel, towerCue, type P3, type TowerInfo} from './towerShared';
import {RIDE_PAD, doorwayMover} from '../physics/world';

/** What the tower needs from Game (structural: tests drive it with a fake host). */
export interface TowerHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: {x: number; z: number; y: number; vx: number; vz: number; radius: number; alive: boolean; eye?: number};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean; root?: {position: {y: number}}}[];
  levels: Levels;
  layout: StationLayout;
  mats: WorldMaterials;
  sfx: unknown;
  hud: {toast(text: string, warn?: boolean): void};
  warmRegistry: WarmupRegistry;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  interactHandlers: (() => boolean)[];
  /** Task office-overhaul-20261030 (lane LIFT): left-click handlers (Game consumes + latches the press when one returns true). */
  pointerHandlers?: (() => boolean)[];
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  promptProviders?: (() => string | null)[];
  /** Called on every setState (typed loosely: Game's listeners take GameState). */
  stateListeners?: ((state: never, prev: never) => void)[];
  /** Awaited after a layout is generated, before it is built (the exterior models). */
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  state: string;
  warming?: boolean;
  prepareBeforeShow?(root: THREE.Object3D): Promise<void>;
  /** Task studio-bunker-rework-20261109-205115-01: fuel carts (world/fuelCarts.ts) standing in the cab ride along (their storey too). */
  fuelCarts?: {
    carry?(inside: (x: number, y: number, z: number) => boolean, dy: number, level: number): number;
    /** Task studio-fuel-cart-stairs-20261110-004505-01: some cart's footprint (x, y, z, radius) satisfies the test (the doorway). */
    anyAt?(test: (x: number, y: number, z: number, r: number) => boolean): boolean;
  };
  /**
   * Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the crafted train equipment (world/trainEquipment.ts) rides the cab
   * and holds its doors exactly as the fuel carts do.
   */
  trainEquipment?: {
    carry?(inside: (x: number, y: number, z: number) => boolean, dy: number, level: number): number;
    anyAt?(test: (x: number, y: number, z: number, r: number) => boolean): boolean;
  };
  /** Loose pickups (world/pickups.ts): resting ones inside the cab ride along. */
  pickups?: {
    carry(inside: (x: number, y: number, z: number) => boolean, dy: number): number;
    relocate?(move: (x: number, y: number, z: number) => [number, number] | null): number;
    list: readonly {x: number; y: number; z: number}[];
  };
  /** Thrown flares (QA rider counts; physics carries them). */
  flares?: {flares: readonly {pos: {x: number; y: number; z: number}; body: unknown}[]};
  /** The built world: its storey culler (landings / windows registered; eye-in-cab override). */
  world?: {culler?: unknown} | null;
}

/** Reach for the buttons (m, eye to the button). */
export const TOWER_REACH = BUTTON_REACH;
/** Longest wait for the exterior assets before the office world is built (then: fallbacks + late upgrade). */
export const PRELOAD_WAIT_MS = 8000;
/** The motor hum (an existing cue, ~7 s) is re-struck this often while the cab moves. */
const HUM_EVERY = 5;
/** Door open / close buttons stay lit this long after a press; the alarm rings (and stays lit) this long. */
const FLASH = 0.6;
const ALARM_TIME = 1.6;

/** The button under the crosshair: kind 'call' = a landing call station, 'panel' = the cab's operating panel. */
export interface Target { kind: 'call' | 'panel'; btn: LiftButton; t: number }

export interface ElevatorRt {
  plan: ElevatorPlan;
  view: ElevatorView;
  logic: ElevatorLogic;
  /** The cab as a Levels dynamic volume (+ its doorway gate) on `levels`. */
  vol: DynamicVolume;
  gate: VolumeGate;
  levels: Levels;
  /** The player is the doorway obstruction this frame; last "stand clear" hint time. */
  playerBlocks: boolean;
  /** Task studio-fuel-cart-stairs-20261110-004505-01: a fuel cart stands in the doorway (it holds the doors like a body); the stop
   *  height the doorway test compares against (NaN while the cab moves); the test itself (one closure per cab). */
  cartBlocks: boolean;
  doorY: number;
  cartInDoor: (x: number, y: number, z: number, r: number) => boolean;
  hintT: number;
  humT: number;
  /** The doorway was open last frame (its shutting sweeps loose things out of it). */
  gateWas: boolean;
  /** Riders carried on the last frame the cab moved (QA). */
  carried: {player: boolean; zombies: number; pickups: number};
  /** Cab floor y at the start of this frame's step (= what the camera saw: per-frame picks use it). */
  prevY: number;
  /** Lit buttons / lanterns, refilled each frame (reused). */
  lamps: LampState;
  /** Remaining lit time of the door open / close / alarm buttons (s). */
  flash: {open: number; close: number; alarm: number};
  /** Indicator floor * 4 + dir + 1 last drawn. */
  indKey: number;
  /** Prompt texts per button id: [idle, lit / requested, here]. */
  prompts: Map<string, [string, string, string]>;
  /** Rider tests at prevY (created once). */
  inside: (x: number, y: number, z: number) => boolean;
  insideLoose: (x: number, y: number, z: number) => boolean;
}

export interface OfficeRt {
  info: TowerInfo;
  root: THREE.Group;
  elevator: ElevatorRt | null;
  windows: {plans: WindowPlan[]; view: WindowView; boxes: THREE.Box3[]} | null;
  exterior: {plan: ExteriorPlan; view: ExteriorView; checkT: number; models: ExteriorModels} | null;
  geometries: THREE.BufferGeometry[];
  deferred: (() => void)[];
}

const EXT_MODEL_IDS: Record<keyof ExteriorModels, OfficeAssetId> = {car: 'car-wreck', bus: 'bus-wreck', rubble: 'rubble-pile', tower: 'ruined-tower', midrise: 'ruined-midrise'};

/**
 * Task mall-round2-20261031 (lane PERF, M05): register a lift view's moving parts — the car and the shaft rig, everything but the
 * landings (registered as static storey pieces) — with the level culler: tagged with every storey the shaft serves (`levels`) and
 * dynamic bounds (world/levelCulling.ts re-derives their boxes every update). The mall's glass lift only.
 */
export function registerMovingLift(culler: {register(root: THREE.Object3D): void}, view: {root: THREE.Object3D; landings: readonly THREE.Object3D[]}, stopLevels: readonly number[]): void {
  const levels = [...new Set(stopLevels)];
  const lands = new Set<THREE.Object3D>(view.landings);
  for (const c of [...view.root.children]) {
    if (lands.has(c)) continue;
    c.traverse(x => { if ((x as THREE.Mesh).isMesh) { x.userData.levels = levels; x.userData.dynamicBounds = true; } });
    culler.register(c);
  }
}

/** Task studio-fuel-cart-stairs-20261110-004505-01: the hint while a fuel cart in the doorway holds a called lift. */
export const LIFT_CART_TEXT = 'A fuel cart is in the lift doorway — push it all the way in or out';

/** Eye pad for the doorway classification (inDoorway radius: 0.4 x this past the cab / landing planes). */
const GATE_EYE_PAD = 0.4;

interface CullerLike { enabled?: boolean; eyeOverride?: number | null; register?(root: THREE.Object3D): void; levelAt?: (x: number, y: number, z: number) => number }

/**
 * The prompt texts of a button: [idle, lit / requested, the cab is here]. Task mall-round2-20261031 (lane RUNTIME, M02): a floor
 * button names its stop by the stop's own label (b.glyph = StopInfo.label) and, when the record authors one, the storey name
 * (`name`: the mall's 'Subway (S)' / 'Level 1'); without a name the Office wording is unchanged ('Lobby (L)', 'Floor 5').
 */
function buttonPrompts(b: LiftButton, stopName?: string): [string, string, string] {
  const k = '<b>[Click / E]</b> ';
  const label = b.glyph;
  switch (b.kind) {
    case 'floor': {
      const name = stopName ? (stopName.endsWith(` ${label}`) ? stopName : `${stopName} (${label})`) : label === 'L' ? 'Lobby (L)' : `Floor ${label}`;
      return [`${k}${name}`, `${k}${name} · lit`, `${k}${name} · here — opens the doors`];
    }
    case 'up': case 'down': {
      const dir = b.kind === 'up' ? 'going up ▲' : 'going down ▼';
      return [`${k}Call the elevator · ${dir}`, `${k}Elevator called · ${dir}`, `${k}Hold the elevator doors`];
    }
    case 'open': return [`${k}Door open ◀|▶`, `${k}Door open ◀|▶`, `${k}Door open ◀|▶`];
    case 'close': return [`${k}Door close ▶|◀`, `${k}Door close ▶|◀`, `${k}Door close ▶|◀`];
    default: return [`${k}Alarm bell`, `${k}Alarm bell`, `${k}Alarm bell`];
  }
}

export class TowerRuntime {
  /** The built office tower (null on the Subway / between worlds). */
  office: OfficeRt | null = null;
  /** The button under the crosshair (within reach, in sight) + its prompt (read by the HUD through promptProviders). */
  target: Target | null = null;
  prompt: string | null = null;
  /** Counters (QA / tests): presses = every button press; calls = landing calls; picks = cab floor selections. */
  readonly counts = {presses: 0, calls: 0, picks: 0, departs: 0, arrivals: 0, reopen: 0, alarms: 0, unpowered: 0, parked: 0};
  /**
   * Task studio-bunker-rework-20261109-205115-01: an external POWER source for the car (the Bunker's cargo lift runs on the shelter's
   * three auxiliary generators: world/bunker/objective.ts sets it per build). Unpowered, every button refuses (a denied buzz and the
   * offline reason) and the car stands shut at its stop; `park` records the car's stop when the world is torn down. Null (Office,
   * mall): always powered, nothing recorded — unchanged.
   */
  liftPower: {on(): boolean; offline(): string; park?(floor: number): void} | null = null;
  /** Id of the last pressed button and how (QA). */
  lastPress: {id: string; via: 'click' | 'key' | 'qa'} | null = null;
  private retired: (() => void)[] = [];
  private farWas: number | null = null;
  private cullerOff = false;
  private cullerRestore: (() => void) | null = null;
  /** Loaded exterior assets (missing = not resolved yet; null = not delivered / failed). */
  private readonly models: ExteriorModels = {};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private preloading: Promise<void> | null = null;
  private upgradeQueued = false;
  private time = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly eyeP: P3 = {x: 0, y: 0, z: 0};
  private readonly dirP: P3 = {x: 0, y: 0, z: 0};
  private readonly hit: Target = {kind: 'panel', btn: null as unknown as LiftButton, t: 0};

  constructor(readonly host: TowerHost) {}

  /** Registers every hook (called once from the Game constructor). */
  install(): void {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.pointerHandlers?.push(() => this.pointer());
    h.promptProviders?.push(() => this.prompt);
    h.stateListeners?.push(((state: string) => { if (state !== 'playing') this.clearTarget(); }) as (state: never, prev: never) => void);
    h.warmRegistry.addPool('tower', () => (this.office ? [this.office.root] : []));
    // the office: fetch the exterior models / skyline / glass before the build (bounded: a slow network falls back to the
    // procedural stand-ins, upgraded in place behind prepareBeforeShow when they arrive)
    // (task track3-eaton-centre-20261031, lane GEN: only a world with windows — the Office — fetches the exterior city; the mall's elevator needs none)
    h.sectionPreloads?.push(layout => (readTowerInfo(layout)?.windows.length ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, PRELOAD_WAIT_MS))]) : Promise.resolve()));
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle (once per built world; nothing is built or torn down while traversing it)

  build(layout: StationLayout): void {
    if (this.office) this.teardown();
    const info = readTowerInfo(layout);
    if (!info) return;
    if (info.windows.length) void this.preload(); // (lane GEN: the mall's elevator-only world fetches no exterior assets)
    const h = this.host;
    const root = new THREE.Group();
    root.name = 'tower-office';
    const o: OfficeRt = {info, root, elevator: null, windows: null, exterior: null, geometries: [], deferred: []};
    // --- elevator: one cab in one shaft through every storey ---
    if (info.elevator && info.elevator.stops.length) {
      const plan = planElevator(info.elevator);
      const stops = info.elevator.stops;
      const logic = new ElevatorLogic(stops.map(s => ({floor: s.floor, y: s.y})), {floor: info.elevator.home ?? stops[0].floor}); // (+ a record's home stop: the Bunker's cargo lift)
      const G = plan.gate, cab = info.elevator.cab;
      const along = Math.abs(G.nx) > 0.5 ? G.cz : G.cx;
      const gate: VolumeGate = {side: info.elevator.doorSide, a0: along - G.hw, a1: along + G.hw, depth: G.depth, height: plan.doorH, open: false};
      const s0 = stops[logic.stop ?? 0];
      const vol: DynamicVolume = {x0: cab.x0, z0: cab.z0, x1: cab.x1, z1: cab.z1, floorY: logic.y, ceilY: logic.y + plan.cabH, level: s0.levelId, area: s0.area, gates: [gate], stops: stops.map(s => s.y), name: 'elevator-cab'};
      h.levels.addDynamicVolume(vol);
      const view = buildElevatorView(plan, h.mats, {glass: !!layout.mall, cargo: !!info.elevator.cargo}); // task track3 (lane ARCH): the mall's glass car (+ the Bunker's freight car)
      view.setCab(logic.y, 0);
      view.setIndicator(stopLabel(stops, logic.floor), 0);
      root.add(view.root);
      o.geometries.push(...view.geometries);
      h.atmosphere?.markShadows(view.root, false);
      const cabH = plan.cabH;
      const e: ElevatorRt = {
        plan, view, logic, vol, gate, levels: h.levels, playerBlocks: false, hintT: 1e9, humT: 0, gateWas: false, carried: {player: false, zombies: 0, pickups: 0},
        // (a cart's whole footprint clear of the door planes: 2.5 x inDoorway's 0.4 r pad = its radius)
        cartBlocks: false, doorY: NaN, cartInDoor: (x, y, z, r) => Math.abs(y - e.doorY) < 1.2 && inDoorway(plan.gate, x, z, r * 2.5),
        prevY: logic.y,
        lamps: {car: logic.car, hallUp: logic.hallUp, hallDown: logic.hallDown, open: false, close: false, alarm: false, lanternStop: -1, lanternDir: 0},
        flash: {open: 0, close: 0, alarm: 0}, indKey: logic.floor * 4 + 1,
        prompts: new Map(plan.buttons.map(b => [b.id, buttonPrompts(b, stops[b.stop]?.name)])),
        inside: (x, y, z) => insideRect(cab, x, z) && y > e.prevY - 0.3 && y < e.prevY + cabH,
        // loose things ride when their centre is within RIDE_PAD of the cab (lying across the door plane included)
        insideLoose: (x, y, z) => insideRect(cab, x, z, -RIDE_PAD) && y > e.prevY - 0.3 && y < e.prevY + cabH,
      };
      o.elevator = e;
    }
    // --- windows: every span of every storey ---
    if (info.windows.length) {
      const plans = planWindows(info);
      const view = buildWindows(plans, h.mats, this.glassTex ?? null);
      root.add(view.root);
      o.geometries.push(...view.geometries);
      h.atmosphere?.markShadows(view.root, false); // frames / sills / boards block the torch like the walls (glass is skipped: not opaque)
      const boxes = plans.map(p => p.along === 'x'
        ? new THREE.Box3(new THREE.Vector3(p.a0, p.y0, Math.min(p.glass, p.inner) - 0.15), new THREE.Vector3(p.a1, p.y1, Math.max(p.glass, p.inner) + 0.15))
        : new THREE.Box3(new THREE.Vector3(Math.min(p.glass, p.inner) - 0.15, p.y0, p.a0), new THREE.Vector3(Math.max(p.glass, p.inner) + 0.15, p.y1, p.a1)));
      o.windows = {plans, view, boxes};
    }
    // --- the city outside: built ONCE, its street at the lobby floor in real world coordinates ---
    if (info.windows.length) {
      setExteriorFootprint(info.exterior);
      const models = this.exteriorModels();
      const top = info.storeys.length ? info.storeys[info.storeys.length - 1].baseY : info.groundY;
      const plan = planExterior({foot: info.exterior, groundY: info.groundY, eyeAbove: top - info.groundY + 1.6, seed: info.seed});
      const view = buildExterior(plan, models);
      root.add(view.root);
      o.exterior = {plan, view, checkT: 0, models};
      // the city / skyline lie beyond the station's 70 m far plane: raise it while the office world is built
      if (this.farWas === null) this.farWas = h.camera.far;
      h.camera.far = Math.max(this.farWas, EXTERIOR.far);
      h.camera.updateProjectionMatrix();
    }
    h.scene.add(root);
    this.office = o;
    // storey culling of the static per-storey pieces (landings, windows; tagged userData.level). The cab moves (never
    // registered) and the exterior keeps its own visibility.
    const culler = h.world?.culler as CullerLike | undefined;
    if (culler && typeof culler.register === 'function') {
      if (o.elevator) for (const g of o.elevator.view.landings) culler.register(g);
      if (o.windows) culler.register(o.windows.view.root);
      // Task mall-round2-20261031 (lane PERF, M05): the mall's glass car + shaft rig (~35 meshes, drawn in both passes whenever in the
      // frustum) obey the culler too: tagged with every storey the shaft serves and DYNAMIC bounds (the car, ropes, counterweight and
      // travelling cable move: world/levelCulling.ts re-derives their boxes every update from the current matrices). Office unchanged.
      if (o.elevator && (layout.mall || o.elevator.plan.info.cargo)) registerMovingLift(culler as {register(root: THREE.Object3D): void}, o.elevator.view, o.elevator.plan.info.stops.map(s => s.levelId)); // (+ the Bunker's cargo car and shaft liner)
    }
    // An eye in the cab (inside the shaft, solid on every storey grid) is on the cab's storey: updateCuller sets the
    // culler's public LevelCuller.eyeOverride each frame (ENGINE, task office-seamless-20261029; no private-field patch).
  }

  teardown(): void {
    this.parkCar();
    const o = this.office;
    this.office = null;
    this.target = null;
    this.prompt = null;
    if (this.farWas !== null) {
      this.host.camera.far = this.farWas;
      this.host.camera.updateProjectionMatrix();
      this.farWas = null;
    }
    if (this.cullerOff) {
      const c = this.host.world?.culler as CullerLike | undefined;
      if (c) c.enabled = true;
      this.cullerOff = false;
    }
    this.cullerRestore?.();
    this.cullerRestore = null;
    if (!o) return;
    if (o.elevator) o.elevator.levels.removeDynamicVolume(o.elevator.vol);
    this.host.scene.remove(o.root);
    for (const g of o.geometries) g.dispose();
    if (o.exterior) {
      for (const g of o.exterior.view.geometries) g.dispose();
      const inst = o.exterior.view.instanced;
      this.retired.push(() => { for (const im of inst) im.dispose(); });
    }
    this.retired.push(...o.deferred);
  }

  /** Releases queued after the next warm-up (first played frame) or before the next build. */
  private flushRetired(): void {
    if (!this.retired.length) return;
    const list = this.retired;
    this.retired = [];
    for (const fn of list) { try { fn(); } catch (err) { console.warn('tower: releasing previous-world resources failed', err); } }
  }

  // -------------------------------------------------------------------------------------------
  // Assets (lazy; procedural fallbacks until / unless delivered)

  /** Fetches the exterior models + skyline / glass textures once (cached by officeAssets; null = not delivered). Never rejects. */
  preload(): Promise<void> {
    if (this.preloading) return this.preloading;
    const jobs: Promise<unknown>[] = [];
    for (const [k, id] of Object.entries(EXT_MODEL_IDS) as [keyof ExteriorModels, OfficeAssetId][]) {
      jobs.push(loadOfficeAsset(id).then(gl => {
        this.models[k] = gl;
        if (gl && this.office?.exterior && !this.office.exterior.models[k]) this.upgradeQueued = true;
      }));
    }
    jobs.push(loadOfficeTexture('skyline').then(t => { if (t) setSkylineTexture(t); }));
    jobs.push(loadOfficeTexture('window-glass').then(t => {
      this.glassTex = t;
      const cracked = this.office?.windows?.view.cracked;
      if (t && cracked && cracked.map !== t) cracked.map = t;
    }));
    return (this.preloading = Promise.all(jobs).then(() => undefined, () => undefined));
  }

  private exteriorModels(): ExteriorModels {
    const m: ExteriorModels = {};
    for (const k of Object.keys(EXT_MODEL_IDS) as (keyof ExteriorModels)[]) if (this.models[k]) m[k] = this.models[k] as ExteriorModels[typeof k];
    return m;
  }

  /** Late Meshy models: rebuild the exterior hidden, prepare it (no cold compile on screen), then swap. */
  private async upgradeExterior(): Promise<void> {
    const o = this.office, h = this.host;
    if (!o?.exterior || !h.prepareBeforeShow) return;
    const models = this.exteriorModels();
    const view = buildExterior(o.exterior.plan, models);
    view.root.visible = false;
    o.root.add(view.root);
    try { await h.prepareBeforeShow(view.root); } catch (err) { console.warn('tower: exterior upgrade not prepared', err); }
    if (this.office !== o || !o.exterior) { o.root.remove(view.root); for (const g of view.geometries) g.dispose(); for (const im of view.instanced) im.dispose(); return; }
    const old = o.exterior.view;
    view.root.visible = old.root.visible;
    o.root.remove(old.root);
    o.exterior = {...o.exterior, view, models};
    for (const g of old.geometries) g.dispose();
    this.retired.push(() => { for (const im of old.instanced) im.dispose(); });
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (while playing, after the player / enemies moved)

  frame(dt: number): void {
    this.flushRetired();
    this.time += dt;
    const o = this.office;
    if (!o) { this.prompt = null; return; }
    const h = this.host;
    if (this.upgradeQueued && !h.warming) { this.upgradeQueued = false; void this.upgradeExterior(); }
    if (o.elevator) this.updateElevator(o.elevator, dt);
    if (o.windows) this.windowConstraints(o);
    if (o.elevator) this.updateTarget(o, o.elevator.prevY);
    this.updateCuller(o);
    if (o.exterior) this.updateExterior(o, dt);
  }

  /**
   * Task studio-bunker-rework-20261109-205115-01: the car's stop when the world goes (the power source records it: a revisit / load
   * finds the car where it was left). A car still travelling finishes its run at once — the loose things in it (pickups, fuel carts)
   * carried the rest of the way, so nothing is saved hanging in the shaft.
   */
  parkCar(): void {
    const e = this.office?.elevator, park = this.liftPower?.park;
    if (!e || !park) return;
    const L = e.logic;
    const i = L.moving && L.target !== null ? L.target : L.stop ?? L.nearest;
    const st = L.stops[i];
    if (!st) return;
    const dy = st.y - L.y;
    if (Math.abs(dy) > 1e-6) {
      const h = this.host;
      h.pickups?.carry(e.insideLoose, dy);
      h.fuelCarts?.carry?.(e.insideLoose, dy, e.plan.info.stops[i]?.levelId ?? 0);
      h.trainEquipment?.carry?.(e.insideLoose, dy, e.plan.info.stops[i]?.levelId ?? 0); // (task train-crafting, lane EQUIP)
      // (task studio-fuel-cart-stairs-20261110-004505-01: the car IS at that stop now — the fuel carts' teardown hook, which runs
      // before this runtime's, parks it first so the carts it records stand at the stop; this runtime's own call then moves nothing)
      this.placeCar(st.floor);
    }
    this.counts.parked++;
    park(st.floor);
  }

  /**
   * Task studio-bunker-rework-20261109-205115-01: stands the car at `floor`'s stop, gates shut (the remembered stop, right after the
   * world was built — before anything ran). False when there is no car / no such stop.
   */
  placeCar(floor: number): boolean {
    const e = this.office?.elevator;
    if (!e) return false;
    const stops = e.plan.info.stops, i = stops.findIndex(q => q.floor === floor);
    if (i < 0) return false;
    const logic = new ElevatorLogic(stops.map(q => ({floor: q.floor, y: q.y})), {floor});
    e.logic = logic;
    e.lamps.car = logic.car; e.lamps.hallUp = logic.hallUp; e.lamps.hallDown = logic.hallDown;
    e.prevY = logic.y;
    const v = e.vol;
    v.floorY = logic.y; v.ceilY = logic.y + e.plan.cabH; v.level = stops[i].levelId; v.area = stops[i].area;
    e.gate.open = false;
    e.view.setCab(logic.y, 0);
    e.view.setIndicator(stopLabel(stops, logic.floor), 0);
    e.indKey = -1;
    return true;
  }

  /** The player stands inside the cab right now. */
  playerInCab(): boolean {
    const e = this.office?.elevator, P = this.host.player;
    return !!e && P.alive && insideRect(e.plan.info.cab, P.x, P.z) && P.y > e.logic.y - 0.3 && P.y < e.logic.y + e.plan.cabH;
  }

  private updateElevator(e: ElevatorRt, dt: number): void {
    const h = this.host, P = h.player, L = e.logic, G = e.plan.gate;
    e.prevY = L.y;
    const stopY = !L.moving && L.stop !== null ? L.stops[L.stop].y : NaN;
    // --- sense ---
    const playerIn = P.alive && e.inside(P.x, P.y, P.z);
    let doorway = P.alive && Math.abs(P.y - stopY) < 1.2 && inDoorway(G, P.x, P.z, P.radius);
    e.playerBlocks = doorway;
    // (task studio-fuel-cart-stairs-20261110-004505-01: a fuel cart standing in the doorway holds the doors like a body: they never
    // shut on it and the cab never leaves it half in the wall)
    e.doorY = stopY;
    e.cartBlocks = !Number.isNaN(stopY) && (!!h.fuelCarts?.anyAt?.(e.cartInDoor) || !!h.trainEquipment?.anyAt?.(e.cartInDoor)); // (task train-crafting, lane EQUIP: + a crafted unit in the doorway)
    if (e.cartBlocks) doorway = true;
    e.hintT += dt;
    let enemyInside = false;
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || z.ragdolled) continue;
      if (Math.abs(b.y - stopY) < 1.2 && inDoorway(G, b.x, b.z, b.stats.radius)) doorway = true;
      if (e.inside(b.x, b.y, b.z)) enemyInside = true;
    }
    const [ps, pl] = gateLocal(G, P.x, P.z);
    const pushOpen = playerIn && ps > -0.55 && Math.abs(pl) < G.hw;
    const ev = L.update(dt, {occupant: playerIn, doorway, enemyInside, pushOpen});
    const dy = L.y - e.prevY;
    // --- the cab volume follows the cab: support / collision / rays / sight inside it, the doorway gate ---
    const v = e.vol, near = e.plan.info.stops[L.nearest];
    v.floorY = L.y; v.ceilY = L.y + e.plan.cabH; v.level = near.levelId; v.area = near.area;
    e.gate.open = L.gateOpen;
    // the landing doors shut: loose things lying in the doorway go to the nearer side (into the cab / onto the landing)
    if (e.gateWas && !e.gate.open && L.stop !== null) h.pickups?.relocate?.(doorwayMover(v, e.gate, L.stops[L.stop].y));
    e.gateWas = e.gate.open;
    // --- riders: carried by the cab's dy (the cab frame is exact: no jitter, no falling through, no ceiling crush) ---
    if (dy !== 0) {
      const c = e.carried;
      c.player = false; c.zombies = 0;
      if (playerIn) { P.y += dy; if (typeof P.eye === 'number') P.eye += dy; c.player = true; }
      for (const z of h.zombies) {
        const b = z.brain;
        if (z.ragdolled || !e.inside(b.x, b.y, b.z)) continue; // ragdolls: physics/world.ts carries their bodies / frozen roots
        b.y += dy;
        if (z.root) z.root.position.y += dy;
        c.zombies++;
      }
      c.pickups = h.pickups?.carry(e.insideLoose, dy) ?? 0;
      h.fuelCarts?.carry?.(e.insideLoose, dy, near.levelId); // (task studio-bunker-rework-20261109-205115-01: fuel carts ride the cargo lift)
      h.trainEquipment?.carry?.(e.insideLoose, dy, near.levelId); // (task train-crafting, lane EQUIP: so does the crafted equipment)
    }
    // --- views: doors, indicator, lit buttons / lanterns, emissive flicker ---
    e.view.setCab(L.y, L.door);
    for (let i = 0; i < L.stops.length; i++) e.view.setLanding(i, L.landingDoor(i));
    const dir = L.moving ? Math.sign(L.v) || L.dir : 0, floor = L.floor, key = floor * 4 + dir + 1;
    if (key !== e.indKey) { e.indKey = key; e.view.setIndicator(stopLabel(e.plan.info.stops, floor), dir); }
    const f = e.flash, lp = e.lamps;
    f.open = Math.max(0, f.open - dt); f.close = Math.max(0, f.close - dt); f.alarm = Math.max(0, f.alarm - dt);
    lp.open = f.open > 0; lp.close = f.close > 0 || L.closeRequested; lp.alarm = f.alarm > 0;
    const top = L.stops.length - 1;
    lp.lanternStop = !L.moving && L.stop !== null && L.door > 0.02 ? L.stop : -1;
    lp.lanternDir = L.dir !== 0 ? L.dir : L.stop === top ? -1 : L.stop === 0 ? 1 : L.arrivalDir || L.lastDir;
    e.view.setLamps(lp);
    e.view.tick(this.time);
    if (L.moving) {
      e.humT += dt;
      if (e.humT >= HUM_EVERY) { e.humT = 0; towerCue(h.sfx, 'trainDistant', this.cabPoint(e, 1.4), {rate: 1.35, gain: 0.32}); }
    }
    this.onElevatorEvents(e, ev);
  }

  /** A point in the cab (local height above its floor), world coordinates. */
  private cabPoint(e: ElevatorRt, up: number): P3 {
    const c = e.plan.info.cab;
    return {x: (c.x0 + c.x1) / 2, y: e.logic.y + up, z: (c.z0 + c.z1) / 2};
  }

  private onElevatorEvents(e: ElevatorRt, ev: readonly ElevatorEvent[]): void {
    if (!ev.length) return;
    const h = this.host, G = e.plan.gate;
    const [dx, dz] = gateWorld(G, G.depth * 0.5, 0);
    const at: P3 = {x: dx, y: e.logic.y + 1.2, z: dz};
    for (const x of ev) {
      switch (x.type) {
        // door motor slide (a metal cabinet door, pitched down) and the closing clunk when the leaves meet
        case 'opening': towerCue(h.sfx, 'cabinetOpen', at, {rate: 0.72, gain: 0.8}); break;
        case 'closing': towerCue(h.sfx, 'cabinetOpen', at, {rate: 0.62, gain: 0.55}); break;
        case 'closed': towerCue(h.sfx, 'cabinetClose', at, {rate: 0.7, gain: 0.8}); break;
        case 'reopen':
        case 'held':
          if (x.type === 'reopen') this.counts.reopen++;
          if (x.why === 'enemy') { if (e.hintT > 3) { e.hintT = 0; h.hud.toast('The doors won’t close with something inside', true); } }
          else if (e.playerBlocks && e.logic.requests.size && e.hintT > 4) { e.hintT = 0; h.hud.toast('Stand clear of the doors'); }
          else if (e.cartBlocks && e.logic.requests.size && e.hintT > 4) { e.hintT = 0; h.hud.toast(LIFT_CART_TEXT, true); }
          break;
        case 'chime':
          // arrival "ding": an existing click, pitched up, twice (no new audio)
          towerCue(h.sfx, 'click', at, {rate: 2.1, gain: 1});
          towerCue(h.sfx, 'click', at, {rate: 1.6, gain: 0.9, delay: 0.22});
          break;
        case 'depart':
          this.counts.departs++;
          e.humT = 0;
          towerCue(h.sfx, 'clank', at, {rate: 0.8, gain: 0.5});
          towerCue(h.sfx, 'trainDistant', this.cabPoint(e, 1.4), {rate: 1.35, gain: 0.4}); // the motor's rumble
          break;
        case 'arrive':
          this.counts.arrivals++;
          towerCue(h.sfx, 'clank', at, {rate: 0.95, gain: 0.3}); // the brake clunk at the floor
          break;
        default: break;
      }
    }
  }

  private windowConstraints(o: OfficeRt): void {
    const h = this.host, plans = o.windows!.plans;
    const fix = (b: {x: number; z: number; y: number}, r: number): void => {
      for (const p of plans) {
        if (Math.abs(b.y - p.baseY) > 2.6) continue; // that span's own storey only
        const c = p.collider;
        if (b.x < c.x0 - r - 0.5 || b.x > c.x1 + r + 0.5 || b.z < c.z0 - r - 0.5 || b.z > c.z1 + r + 0.5) continue;
        const q = pushOutRect(b.x, b.z, r, c, [-p.n[0], -p.n[1]]);
        if (q) { b.x = q[0]; b.z = q[1]; }
      }
    };
    if (h.player.alive) fix(h.player, h.player.radius);
    for (const z of h.zombies) if (z.brain.alive && !z.ragdolled) fix(z.brain, z.brain.stats.radius);
  }

  /**
   * The storey culler would place an eye inside the solid shaft at level 0: while the camera is in the cab, its storey is the
   * cab's (LevelCuller.eyeOverride, the culler's public hook; a culler without one: culling is
   * switched off while the eye is in the cab).
   */
  private updateCuller(o: OfficeRt): void {
    const c = this.host.world?.culler as CullerLike | undefined, e = o.elevator;
    if (!c || !e || this.cullerRestore) return;
    const eye = this.host.camera.getWorldPosition(this.vEye);
    const inBand = eye.y > e.vol.floorY - 0.1 && eye.y < e.vol.ceilY + 0.2;
    // task office-elevator-visibility-20261104-063115 (user: "if you stand right in the door way, the level disappears"): the doorway
    // between the cab plane and the landing plane is the shaft's door wall — solid on every storey grid like the shaft — so an eye
    // standing on the threshold resolved to storey 0 and the culler hid the whole storey around it. It belongs to the storey the cab
    // stands at, exactly like the cab (a little past both planes; the jamb-wide opening only).
    const inCab = inBand && (insideRect(e.plan.info.cab, eye.x, eye.z, -0.05) || inDoorway(e.plan.gate, eye.x, eye.z, GATE_EYE_PAD));
    if ('eyeOverride' in c) {
      const want = inCab ? e.vol.level : null;
      if (c.eyeOverride !== want) c.eyeOverride = want;
    } else if (inCab && !this.cullerOff && c.enabled !== false) { c.enabled = false; this.cullerOff = true; }
    else if (!inCab && this.cullerOff) { c.enabled = true; this.cullerOff = false; }
  }

  // -------------------------------------------------------------------------------------------
  // Buttons: targeting and pressing (no menus)

  /**
   * The button under the crosshair: within TOWER_REACH, its face toward the eye, nothing structural on the ray before it (a wall,
   * slab or shut door never lets you press through) and no living enemy in front of it (the click is then the gun's). Cab buttons only from inside the cab (`cabY`: the cab floor the camera saw),
   * landing buttons of the eye's storey. Allocation-free; the returned target is reused (copy what you keep).
   */
  pickButton(o: OfficeRt, cabY: number): Target | null {
    const e = o.elevator, h = this.host;
    if (!e || !h.player.alive) return null;
    const cam = h.camera;
    cam.getWorldPosition(this.vEye); cam.getWorldDirection(this.vDir);
    const eye = this.eyeP, d = this.dirP;
    eye.x = this.vEye.x; eye.y = this.vEye.y; eye.z = this.vEye.z;
    d.x = this.vDir.x; d.y = this.vDir.y; d.z = this.vDir.z;
    const plan = e.plan;
    let best: LiftButton | null = null, bt = TOWER_REACH;
    if (insideRect(plan.info.cab, eye.x, eye.z, -0.02) && eye.y > cabY && eye.y < cabY + plan.cabH) {
      for (const b of plan.carButtons) {
        if (d.x * b.n[0] + d.z * b.n[1] > -0.05) continue; // its face must look at the eye
        const t = rayBox(eye, d, b.box, bt, cabY);
        if (t !== null && t < bt) { bt = t; best = b; }
      }
    }
    const stops = plan.info.stops;
    for (let i = 0; i < stops.length; i++) {
      const sy = stops[i].y;
      if (eye.y < sy || eye.y > sy + 2.7) continue;
      for (const b of plan.hallButtons[i]) {
        if (d.x * b.n[0] + d.z * b.n[1] > -0.05) continue;
        const t = rayBox(eye, d, b.box, bt);
        if (t !== null && t < bt) { bt = t; best = b; }
      }
    }
    if (!best) return null;
    // unobstructed: no wall / floor / ceiling / shut door between the eye and the button
    const blocked = h.levels.raycast(eye, d, bt + 0.02);
    if (blocked.kind !== 'none' && blocked.t < bt - 0.01) return null;
    // a living enemy in front of the button takes the click: you can always shoot what stands before a panel
    for (const z of h.zombies) {
      const zb = z.brain;
      if (!zb.alive || z.ragdolled) continue;
      const dx = zb.x - eye.x, dz = zb.z - eye.z;
      if (dx * dx + dz * dz > (bt + 1) * (bt + 1)) continue;
      if (rayCylinder(eye, d, zb.x, zb.z, zb.stats.radius + 0.05, zb.y, zb.y + 1.9, bt) !== null) return null;
    }
    const hit = this.hit;
    hit.kind = best.where === 'car' ? 'panel' : 'call'; hit.btn = best; hit.t = bt;
    return hit;
  }

  private updateTarget(o: OfficeRt, cabY: number): void {
    const e = o.elevator;
    const t = e && this.host.state === 'playing' ? this.pickButton(o, cabY) : null;
    this.target = t;
    e?.view.setHover(t?.btn ?? null);
    this.prompt = t && e ? (this.liftPower && !this.liftPower.on() && t.btn.kind !== 'alarm' ? `<b>Cargo lift · NO POWER</b> · ${this.liftPower.offline()}` : this.promptFor(e, t.btn)) : null;
  }

  /** QA: re-target with the current camera now (after aiming the view directly). */
  refreshTarget(): Target | null {
    const o = this.office;
    if (o?.elevator) this.updateTarget(o, o.elevator.logic.y);
    return this.target;
  }

  private clearTarget(): void {
    this.target = null;
    this.prompt = null;
    this.office?.elevator?.view.setHover(null);
  }

  private promptFor(e: ElevatorRt, b: LiftButton): string {
    const p = e.prompts.get(b.id)!, L = e.logic;
    const here = !L.moving && L.stop === b.stop;
    if (b.kind === 'floor') return L.car.has(b.stop) ? p[1] : here ? p[2] : p[0];
    if (b.kind === 'up' || b.kind === 'down') return here && L.door > 0.5 ? p[2] : (b.kind === 'up' ? L.hallUp : L.hallDown).has(b.stop) ? p[1] : p[0];
    return p[0];
  }

  /** E handler (Game.interactHandlers): presses the button under the crosshair; true when the tower handled it. */
  interact(): boolean {
    return this.pressTargeted('key');
  }

  /** Left click (Game.pointerHandlers): presses the button under the crosshair; true = the click was the button's (no shot). */
  pointer(): boolean {
    return this.pressTargeted('click');
  }

  private pressTargeted(via: 'click' | 'key'): boolean {
    const o = this.office, e = o?.elevator;
    if (!o || !e || this.host.state !== 'playing') return false;
    // called from Game.update before the frame hooks: the camera matches the cab at its current y
    const t = this.pickButton(o, e.logic.y);
    if (!t) return false;
    this.press(e, t.btn, via);
    return true;
  }

  /** Presses a button through the elevator logic (the panels' rules: what a real press does). */
  private press(e: ElevatorRt, b: LiftButton, via: 'click' | 'key' | 'qa'): void {
    const h = this.host, L = e.logic;
    this.counts.presses++;
    this.lastPress = {id: b.id, via};
    const at: P3 = b.where === 'car' ? {x: b.at.x, y: b.at.y + L.y, z: b.at.z} : b.at;
    towerCue(h.sfx, 'click', at, {rate: 1.5, gain: 0.8});
    // (task studio-bunker-rework-20261109-205115-01: a car without power — the Bunker's cargo lift before its generators run — answers
    // nothing but the alarm bell: a dead buzz and the reason)
    if (this.liftPower && !this.liftPower.on() && b.kind !== 'alarm') {
      this.counts.unpowered++;
      towerCue(h.sfx, 'denied', at, {rate: 0.8, gain: 0.7});
      h.hud.toast(this.liftPower.offline(), true);
      return;
    }
    switch (b.kind) {
      case 'floor': {
        const r = L.select(b.floor);
        if (r.ok) { this.counts.picks++; this.onElevatorEvents(e, r.events); }
        break;
      }
      case 'up': case 'down':
        this.counts.calls++;
        this.onElevatorEvents(e, L.call(b.floor, b.kind === 'up' ? 1 : -1));
        break;
      case 'open':
        e.flash.open = FLASH;
        this.onElevatorEvents(e, L.requestOpen());
        break;
      case 'close':
        e.flash.close = FLASH;
        L.requestClose();
        break;
      case 'alarm':
        if (e.flash.alarm > 0) break; // already ringing
        e.flash.alarm = ALARM_TIME;
        this.counts.alarms++;
        // the alarm: a buzz and a rattling bell from existing cues (pitched), no new audio
        towerCue(h.sfx, 'denied', at, {rate: 0.7, gain: 1});
        for (let i = 0; i < 6; i++) towerCue(h.sfx, 'click', at, {rate: 2.6 + (i % 2) * 0.3, gain: 0.85, delay: 0.08 + i * 0.11});
        break;
    }
  }

  /** QA / tests: press a button by id through the logic (no aim / reach requirement). False when there is no such button. */
  pressButton(id: string): boolean {
    const e = this.office?.elevator;
    const b = e?.plan.buttons.find(x => x.id === id);
    if (!e || !b) return false;
    this.press(e, b, 'qa');
    return true;
  }

  /** QA / tests: press the landing call button of `floor` (up, or down on the top floor; no position requirement). */
  callFloor(floor: number): boolean {
    const e = this.office?.elevator;
    if (!e) return false;
    const i = e.logic.indexOf(floor);
    if (i < 0) return false;
    const b = e.plan.hallButtons[i]?.[0];
    if (b) this.press(e, b, 'qa');
    else { this.counts.calls++; this.onElevatorEvents(e, e.logic.call(floor)); }
    return true;
  }

  /** QA / tests: a cab panel button (a floor number, 'open' / 'close' / 'alarm'); false when not standing in the cab. */
  panelPick(floor: number | 'open' | 'close' | 'alarm'): boolean {
    const e = this.office?.elevator;
    if (!e || !this.playerInCab()) return false;
    const b = typeof floor === 'number' ? e.plan.carButtons.find(x => x.kind === 'floor' && x.floor === floor) : e.plan.carButtons.find(x => x.kind === floor);
    if (!b) return false;
    this.press(e, b, 'qa');
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Exterior: the dome follows the eye; everything outside is hidden in the station and while no window can be seen

  private updateExterior(o: OfficeRt, dt: number): void {
    const ex = o.exterior!, cam = this.host.camera;
    const eye = cam.getWorldPosition(this.vEye);
    ex.view.dome.position.copy(eye);
    setExteriorEye(eye.y - o.info.groundY);
    ex.checkT -= dt;
    if (ex.checkT > 0) return;
    ex.checkT = 0.12;
    // down in the station (below the street) the city is never visible
    ex.view.root.visible = eye.y > o.info.groundY - 2 && this.windowVisible(o, eye);
  }

  /** Some window span of a storey near the eye is in the view frustum, within 80 m and in line of sight (slabs / walls hide it). */
  windowVisible(o: OfficeRt, eye: THREE.Vector3): boolean {
    const w = o.windows;
    if (!w) return false;
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const L = this.host.levels;
    for (let i = 0; i < w.plans.length; i++) {
      const p = w.plans[i], b = w.boxes[i];
      if (Math.abs(p.baseY + 1.5 - eye.y) > 6) continue; // another storey: behind its slab
      if (b.distanceToPoint(eye) > 80 || !this.frustum.intersectsBox(b)) continue;
      // nearest point on the span's room-side face, 0.3 m into the room
      const a = Math.max(p.a0 + 0.1, Math.min(p.a1 - 0.1, p.along === 'x' ? eye.x : eye.z));
      const y = Math.max(p.y0 + 0.1, Math.min(p.y1 - 0.1, eye.y));
      const c = p.inner - (p.n[0] + p.n[1]) * 0.3;
      const pts: P3[] = [p.along === 'x' ? {x: a, y, z: c} : {x: c, y, z: a}];
      const mid = (p.a0 + p.a1) / 2;
      pts.push(p.along === 'x' ? {x: mid, y: (p.y0 + p.y1) / 2, z: c} : {x: c, y: (p.y0 + p.y1) / 2, z: mid});
      for (const q of pts) if (L.lineOfSight({x: eye.x, y: eye.y, z: eye.z}, q, {slack: 0.25})) return true;
    }
    return false;
  }
}

/** Installs the office tower runtime into a Game (one call in the Game constructor). */
export function installTower(host: TowerHost): TowerRuntime {
  const rt = new TowerRuntime(host);
  rt.install();
  return rt;
}
