// Office tower runtime (iteration 16 lane TOWER; task office-seamless-20261029 lane LIFT): installs itself into Game through
// the registries (sectionHooks / frameHooks / interactHandlers / promptProviders / stateListeners / warmRegistry); no other
// Game code. Office Space is ONE continuous world (station, lobby, floors 2-8 at their real heights; lane GEN): this
// runtime builds, ONCE per built world and before its warm-up, the physically travelling elevator (world/elevator.ts: a
// cab that rides the shaft through every storey as a Levels dynamic volume — support, collision, rays and sight follow it —
// with landing doors / call panels on every storey), the window glass of every storey (world/officeWindows.ts) and the city
// outside at its real height (world/exterior.ts). Nothing here ever travels, fades, loads or changes the game state: the
// world keeps running while you ride; moving between storeys only changes positions.
//
// Per frame (Game.frameHooks: after the player and the enemies moved, before physics / camera / pickups): the elevator
// logic steps, the cab volume follows it (floor, ceiling, reported storey, doorway gate), riders inside the cab are carried
// by its dy (the player and its eye, enemy bodies, resting pickups; physics/world.ts carries bodies, corpses, casings,
// chunks and resting flares in its own pass), the views follow, prompts / E targets, window push-out, exterior visibility.
// No lights are added or removed (the cab glows by an emissive panel; the baked field).

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {DynamicVolume, Levels, VolumeGate} from '../gen/levels';
import type {WorldMaterials} from './materials';
import type {WarmupRegistry} from '../render/warmup';
import {loadOfficeAsset, loadOfficeTexture, type OfficeAssetId} from '../assets/officeAssets';
import {ElevatorLogic, buildElevatorView, planElevator, type ElevatorEvent, type ElevatorPlan, type ElevatorView} from './elevator';
import {buildWindows, planWindows, type WindowPlan, type WindowView} from './officeWindows';
import {EXTERIOR, buildExterior, planExterior, setExteriorEye, setExteriorFootprint, setSkylineTexture, type ExteriorModels, type ExteriorPlan, type ExteriorView} from './exterior';
import {floorLabel, gateLocal, gateWorld, inDoorway, insideRect, liftBox, pushOutRect, rayBox, readTowerInfo, towerCue, type Box3Like, type P3, type TowerInfo} from './towerShared';
import {TowerChoice, type ChoiceItem} from '../ui/elevatorPanel';

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
  /** Loose pickups (world/pickups.ts): resting ones inside the cab ride along. */
  pickups?: {carry(inside: (x: number, y: number, z: number) => boolean, dy: number): number; list: readonly {x: number; y: number; z: number}[]};
  /** Thrown flares (QA rider counts; physics carries them). */
  flares?: {flares: readonly {pos: {x: number; y: number; z: number}; body: unknown}[]};
  /** The built world: its storey culler (landings / windows registered; eye-in-cab override). */
  world?: {culler?: unknown} | null;
}

/** Reach for the panels (m, eye to the box). */
export const TOWER_REACH = 1.9;
/** Longest wait for the exterior assets before the office world is built (then: fallbacks + late upgrade). */
export const PRELOAD_WAIT_MS = 8000;
/** The motor hum (an existing cue, ~7 s) is re-struck this often while the cab moves. */
const HUM_EVERY = 5;

type Target = {kind: 'call'; stop: number; t: number} | {kind: 'panel'; t: number};

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
  hintT: number;
  humT: number;
  litKey: string;
  /** Riders carried on the last frame the cab moved (QA). */
  carried: {player: boolean; zombies: number; pickups: number};
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

interface CullerLike { enabled?: boolean; eyeOverride?: number | null; register?(root: THREE.Object3D): void; levelAt?: (x: number, y: number, z: number) => number }

export class TowerRuntime {
  /** The built office tower (null on the Subway / between worlds). */
  office: OfficeRt | null = null;
  /** The list only lives while playing (pause / death close it; it never captures menu keys). */
  readonly choice = new TowerChoice(() => this.host.state === 'playing');
  /** Current E target + its prompt (read by the HUD through promptProviders). */
  target: Target | null = null;
  prompt: string | null = null;
  /** Counters (QA / tests). */
  readonly counts = {calls: 0, picks: 0, departs: 0, arrivals: 0, reopen: 0};
  private retired: (() => void)[] = [];
  private farWas: number | null = null;
  private cullerOff = false;
  private cullerRestore: (() => void) | null = null;
  /** Loaded exterior assets (missing = not resolved yet; null = not delivered / failed). */
  private readonly models: ExteriorModels = {};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private preloading: Promise<void> | null = null;
  private upgradeQueued = false;
  private choiceCtx: (() => boolean) | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();

  constructor(readonly host: TowerHost) {}

  /** Registers every hook (called once from the Game constructor). */
  install(): void {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt);
    h.stateListeners?.push(((state: string) => { if (state !== 'playing') this.choice.close(); }) as (state: never, prev: never) => void);
    h.warmRegistry.addPool('tower', () => (this.office ? [this.office.root] : []));
    // the office: fetch the exterior models / skyline / glass before the build (bounded: a slow network falls back to the
    // procedural stand-ins, upgraded in place behind prepareBeforeShow when they arrive)
    h.sectionPreloads?.push(layout => (readTowerInfo(layout) ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, PRELOAD_WAIT_MS))]) : Promise.resolve()));
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle (once per built world; nothing is built or torn down while traversing it)

  build(layout: StationLayout): void {
    if (this.office) this.teardown();
    const info = readTowerInfo(layout);
    if (!info) return;
    void this.preload();
    const h = this.host;
    const root = new THREE.Group();
    root.name = 'tower-office';
    const o: OfficeRt = {info, root, elevator: null, windows: null, exterior: null, geometries: [], deferred: []};
    // --- elevator: one cab in one shaft through every storey ---
    if (info.elevator && info.elevator.stops.length) {
      const plan = planElevator(info.elevator);
      const stops = info.elevator.stops;
      const logic = new ElevatorLogic(stops.map(s => ({floor: s.floor, y: s.y})), {floor: stops[0].floor});
      const G = plan.gate, cab = info.elevator.cab;
      const along = Math.abs(G.nx) > 0.5 ? G.cz : G.cx;
      const gate: VolumeGate = {side: info.elevator.doorSide, a0: along - G.hw, a1: along + G.hw, depth: G.depth, height: plan.doorH, open: false};
      const s0 = stops[logic.stop ?? 0];
      const vol: DynamicVolume = {x0: cab.x0, z0: cab.z0, x1: cab.x1, z1: cab.z1, floorY: logic.y, ceilY: logic.y + plan.cabH, level: s0.levelId, area: s0.area, gates: [gate], stops: stops.map(s => s.y), name: 'elevator-cab'};
      h.levels.addDynamicVolume(vol);
      const view = buildElevatorView(plan, h.mats);
      view.setCab(logic.y, 0);
      view.setIndicator(floorLabel(logic.floor), 0);
      root.add(view.root);
      o.geometries.push(...view.geometries);
      h.atmosphere?.markShadows(view.root, false);
      o.elevator = {plan, view, logic, vol, gate, levels: h.levels, playerBlocks: false, hintT: 1e9, humT: 0, litKey: '', carried: {player: false, zombies: 0, pickups: 0}};
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
    }
    // An eye in the cab (inside the shaft, solid on every storey grid) is on the cab's storey: updateCuller sets the
    // culler's public LevelCuller.eyeOverride each frame (ENGINE, task office-seamless-20261029; no private-field patch).
  }

  teardown(): void {
    this.choice.close();
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
    const o = this.office;
    if (!o) { this.prompt = null; return; }
    const h = this.host;
    if (this.upgradeQueued && !h.warming) { this.upgradeQueued = false; void this.upgradeExterior(); }
    if (o.elevator) this.updateElevator(o.elevator, dt);
    if (o.windows) this.windowConstraints(o);
    this.updateTarget(o);
    this.updateCuller(o);
    if (o.exterior) this.updateExterior(o, dt);
    // the list closes when its context goes away
    if (this.choice.isOpen && this.choiceCtx && !this.choiceCtx()) this.choice.close();
  }

  /** The player stands inside the cab right now. */
  playerInCab(): boolean {
    const e = this.office?.elevator, P = this.host.player;
    return !!e && P.alive && insideRect(e.plan.info.cab, P.x, P.z) && P.y > e.logic.y - 0.3 && P.y < e.logic.y + e.plan.cabH;
  }

  private updateElevator(e: ElevatorRt, dt: number): void {
    const h = this.host, P = h.player, L = e.logic, G = e.plan.gate, cab = e.plan.info.cab, cabH = e.plan.cabH;
    const prevY = L.y;
    const inside = (x: number, y: number, z: number): boolean => insideRect(cab, x, z) && y > prevY - 0.3 && y < prevY + cabH;
    const stopY = !L.moving && L.stop !== null ? L.stops[L.stop].y : NaN;
    const atStop = (y: number) => Math.abs(y - stopY) < 1.2;
    // --- sense ---
    const playerIn = P.alive && inside(P.x, P.y, P.z);
    let doorway = P.alive && atStop(P.y) && inDoorway(G, P.x, P.z, P.radius);
    e.playerBlocks = doorway;
    e.hintT += dt;
    let enemyInside = false;
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || z.ragdolled) continue;
      if (atStop(b.y) && inDoorway(G, b.x, b.z, b.stats.radius)) doorway = true;
      if (inside(b.x, b.y, b.z)) enemyInside = true;
    }
    const [ps, pl] = gateLocal(G, P.x, P.z);
    const pushOpen = playerIn && ps > -0.55 && Math.abs(pl) < G.hw;
    const ev = L.update(dt, {occupant: playerIn, doorway, enemyInside, pushOpen});
    const dy = L.y - prevY;
    // --- the cab volume follows the cab: support / collision / rays / sight inside it, the doorway gate ---
    const v = e.vol, near = e.plan.info.stops[L.nearest];
    v.floorY = L.y; v.ceilY = L.y + cabH; v.level = near.levelId; v.area = near.area;
    e.gate.open = L.gateOpen;
    // --- riders: carried by the cab's dy (the cab frame is exact: no jitter, no falling through, no ceiling crush) ---
    if (dy !== 0) {
      e.carried = {player: false, zombies: 0, pickups: 0};
      if (playerIn) { P.y += dy; if (typeof P.eye === 'number') P.eye += dy; e.carried.player = true; }
      for (const z of h.zombies) {
        const b = z.brain;
        if (z.ragdolled || !inside(b.x, b.y, b.z)) continue; // ragdolls: physics/world.ts carries their bodies / frozen roots
        b.y += dy;
        if (z.root) z.root.position.y += dy;
        e.carried.zombies++;
      }
      e.carried.pickups = h.pickups?.carry(inside, dy) ?? 0;
    }
    // --- views ---
    e.view.setCab(L.y, L.door);
    for (let i = 0; i < L.stops.length; i++) e.view.setLanding(i, L.landingDoor(i));
    e.view.setIndicator(floorLabel(L.floor), L.moving ? Math.sign(L.v) || L.dir : 0);
    const lit = `${[...L.hall].sort().join(',')}|${[...L.car].sort().join(',')}`;
    if (lit !== e.litKey) { e.litKey = lit; e.view.setLit(L.hall, L.car); }
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
    const inCab = insideRect(e.plan.info.cab, eye.x, eye.z, -0.05) && eye.y > e.vol.floorY - 0.1 && eye.y < e.vol.ceilY + 0.2;
    if ('eyeOverride' in c) {
      const want = inCab ? e.vol.level : null;
      if (c.eyeOverride !== want) c.eyeOverride = want;
    } else if (inCab && !this.cullerOff && c.enabled !== false) { c.enabled = false; this.cullerOff = true; }
    else if (!inCab && this.cullerOff) { c.enabled = true; this.cullerOff = false; }
  }

  // -------------------------------------------------------------------------------------------
  // Targeting / interaction

  private eyeRay(): {o: P3; d: P3} {
    const cam = this.host.camera;
    const o = cam.getWorldPosition(this.vEye), d = cam.getWorldDirection(this.vDir);
    return {o: {x: o.x, y: o.y, z: o.z}, d: {x: d.x, y: d.y, z: d.z}};
  }

  /** The panel under the crosshair within reach and in sight (never through a wall, slab or shut door). */
  pick(o: OfficeRt): Target | null {
    const e = o.elevator;
    if (!e) return null;
    const {o: eye, d} = this.eyeRay();
    const L = this.host.levels, P = this.host.player;
    let best: Target | null = null;
    const test = (box: Box3Like, at: P3, make: (t: number) => Target): void => {
      const t = rayBox(eye, d, box, TOWER_REACH);
      if (t === null || (best && t >= best.t)) return;
      if (!L.lineOfSight(eye, at, {slack: 0.12})) return;
      best = make(t);
    };
    // landing call panels of the player's storey
    e.plan.calls.forEach((c, i) => { if (Math.abs(e.plan.info.stops[i].y - P.y) < 2.5) test(c.box, c.eye, t => ({kind: 'call', stop: i, t})); });
    // the floor panel inside the cab (moves with it)
    if (this.playerInCab()) {
      const y = e.logic.y, pe = e.plan.panelEye;
      test(liftBox(e.plan.panelBox, y), {x: pe.x, y: pe.y + y, z: pe.z}, t => ({kind: 'panel', t}));
    }
    return best;
  }

  private updateTarget(o: OfficeRt): void {
    const t = this.choice.isOpen || !this.host.player.alive ? null : this.pick(o);
    this.target = t;
    if (!t) { this.prompt = null; return; }
    const e = o.elevator!, L = e.logic;
    if (t.kind === 'call') {
      const here = !L.moving && L.stop === t.stop;
      this.prompt = here && L.door > 0.5 ? '<b>[E]</b> Hold the elevator doors' : L.hall.has(t.stop) ? '<b>[E]</b> Elevator called — on its way' : '<b>[E]</b> Call the elevator';
    } else this.prompt = `<b>[E]</b> Elevator panel · ${L.moving ? `passing ${floorLabel(L.floor)}` : `floor ${floorLabel(L.floor)}`}`;
  }

  /** E handler (Game.interactHandlers): true when the tower handled it. */
  interact(): boolean {
    const o = this.office;
    if (!o || this.choice.isOpen) return false;
    const t = this.pick(o);
    if (!t || !o.elevator) return false;
    const e = o.elevator, h = this.host;
    if (t.kind === 'call') {
      towerCue(h.sfx, 'click', e.plan.calls[t.stop].at, {rate: 1.4});
      this.callStop(e, t.stop);
      return true;
    }
    towerCue(h.sfx, 'click', this.panelWorld(e), {rate: 1.4});
    this.openFloorList(o, e);
    return true;
  }

  private panelWorld(e: ElevatorRt): P3 {
    const p = e.plan.panelLocal;
    return {x: p.x, y: p.y + e.logic.y, z: p.z};
  }

  private callStop(e: ElevatorRt, i: number): void {
    this.counts.calls++;
    const ev = e.logic.call(e.logic.stops[i].floor);
    if (ev.some(x => x.type === 'called')) this.host.hud.toast(`Elevator called to ${floorLabel(e.logic.stops[i].floor) === 'L' ? 'the lobby' : `floor ${e.logic.stops[i].floor}`}`);
    this.onElevatorEvents(e, ev);
  }

  /** QA / tests: press the landing call button of `floor` (no position requirement). False when there is no such stop. */
  callFloor(floor: number): boolean {
    const e = this.office?.elevator;
    if (!e) return false;
    const i = e.logic.indexOf(floor);
    if (i < 0) return false;
    this.callStop(e, i);
    return true;
  }

  /** The floor list (inside the cab): floors top-down, current / requested marked, plus "Open doors". */
  openFloorList(o: OfficeRt, e: ElevatorRt): void {
    const L = e.logic;
    const items: ChoiceItem[] = L.stops.map((s, i) => ({s, i})).sort((a, b) => b.s.y - a.s.y).map(({s, i}) => {
      const here = !L.moving && L.stop === i;
      const lbl = s.floor <= 1 ? 'L  · lobby / street' : `${s.floor}`;
      return {id: `f${s.floor}`, label: here ? `${floorLabel(s.floor)}  · here` : L.car.has(i) || L.hall.has(i) ? `${lbl}  ·  ●` : lbl, key: s.floor <= 9 ? s.floor : undefined, current: here, lit: L.car.has(i) || L.hall.has(i)};
    });
    items.push({id: 'open', label: '◀ ▶  open doors', disabled: L.moving});
    // highlight: the next floor up (down from the top floor)
    const cur = L.nearest, next = L.stops[cur + 1] ?? L.stops[cur - 1] ?? L.stops[cur];
    const start = Math.max(0, items.findIndex(i => i.id === `f${next.floor}`));
    this.choiceCtx = () => this.office === o && this.playerInCab();
    this.choice.open(`Elevator · ${L.moving ? 'moving' : `floor ${floorLabel(L.floor)}`}`, items, start, id => this.pickFloor(e, id));
  }

  /** Cab panel choice without the list (QA / tests): a floor number or 'open'. False when not standing in the cab. */
  panelPick(floor: number | 'open'): boolean {
    const e = this.office?.elevator;
    if (!e || !this.playerInCab()) return false;
    this.choice.close();
    this.pickFloor(e, floor === 'open' ? 'open' : `f${floor}`);
    return true;
  }

  private pickFloor(e: ElevatorRt, id: string): void {
    if (this.office?.elevator !== e) return;
    const h = this.host;
    towerCue(h.sfx, 'click', this.panelWorld(e), {rate: 1.5});
    if (id === 'open') { this.onElevatorEvents(e, e.logic.requestOpen()); return; }
    const floor = Number(id.slice(1));
    const r = e.logic.select(floor);
    if (!r.ok) return;
    this.counts.picks++;
    if (r.events.some(x => x.type === 'selected')) h.hud.toast(`Floor ${floorLabel(floor)}`);
    this.onElevatorEvents(e, r.events);
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
