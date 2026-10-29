// Iteration 16 (lane TOWER): the office tower's runtime — installs itself into Game through the iteration-16 registries
// (sectionHooks / frameHooks / interactHandlers / promptProviders / stateListeners / warmRegistry); no other Game code.
//
// Per office section (layout.office, WORLD-GEN): the elevator (world/elevator.ts), stairwell doors (world/stairDoors.ts),
// window glass + frames (world/officeWindows.ts) and the city outside (world/exterior.ts). Everything is built in
// sectionHooks.build — before the section's warm-up, so it is discovered and compiled on the loading screen (plus a
// 'tower' warm-up pool for anything hidden then, e.g. the exterior when no window is in view) — and released in
// teardown: per-section geometry at once, InstancedMesh / per-section materials only on the first played frame after
// the next section's warm-up (the iteration-14 retire pattern: shared programs are reused, not rebuilt).
// Travel between floors is lane RUN's game.travel(): the elevator issues it once per ride behind closed doors; a stair
// door after a short fade. No lights are added or removed (the cab is lit by the baked field + an emissive panel).

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {Levels} from '../gen/levels';
import type {Arrival, TravelRequest} from '../levels/types';
import type {WorldMaterials} from './materials';
import type {WarmupRegistry} from '../render/warmup';
import {loadOfficeAsset, loadOfficeTexture, type OfficeAssetId} from '../assets/officeAssets';
import {ElevatorLogic, buildElevatorView, planElevator, type ElevatorEvent, type ElevatorPlan, type ElevatorView} from './elevator';
import {buildStairDoors, planStairDoors, stairPrompt, type StairChoice, type StairDoorPlan, type StairDoorView} from './stairDoors';
import {buildWindows, planWindows, type WindowPlan, type WindowView} from './officeWindows';
import {EXTERIOR, buildExterior, planExterior, setExteriorFootprint, setSkylineTexture, type ExteriorModels, type ExteriorPlan, type ExteriorView} from './exterior';
import {
  constrainGate, floorLabel, gateLocal, gateSideOf, inDoorway, insideRect, pushOutRect, rayBox, readTowerInfo, sectionForFloor, towerCue,
  type Box3Like, type GateSide, type P3, type TowerInfo,
} from './towerShared';
import {TowerChoice, TowerFade, type ChoiceItem} from '../ui/elevatorPanel';

/** What the tower needs from Game (structural: tests drive it with a fake host). */
export interface TowerHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: {x: number; z: number; y: number; vx: number; vz: number; radius: number; alive: boolean};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean}[];
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
  /** lane RUN: called on every setState (typed loosely: Game's listeners take GameState). */
  stateListeners?: ((state: never, prev: never) => void)[];
  /** lane RUN: awaited after a section is generated, before it is built. */
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  travel?(req: TravelRequest): Promise<{ok: boolean; reason?: string}>;
  arrival?: Arrival;
  state: string;
  warming?: boolean;
  prepareBeforeShow?(root: THREE.Object3D): Promise<void>;
}

/** Reach for the panels / stair doors (m, eye to the box). */
export const TOWER_REACH = 1.9;
/** Longest wait for the exterior assets before an office section is built (then: fallbacks + late upgrade). */
export const PRELOAD_WAIT_MS = 8000;

type Target = {kind: 'call'; t: number} | {kind: 'panel'; t: number} | {kind: 'stair'; index: number; t: number};

interface ElevatorRt {
  plan: ElevatorPlan;
  view: ElevatorView;
  logic: ElevatorLogic;
  sides: WeakMap<object, GateSide>;
  pushT: number;
  /** Indicator arrow (+1 / -1) while departing. */
  dir: number;
  /** The player is the doorway obstruction this frame; last "stand clear" hint time. */
  playerBlocks: boolean;
  hintT: number;
}

interface SectionRt {
  info: TowerInfo;
  root: THREE.Group;
  elevator: ElevatorRt | null;
  stairs: {plans: StairDoorPlan[]; view: StairDoorView; swing: {i: number; t: number; dir: number} | null} | null;
  windows: {plans: WindowPlan[]; view: WindowView; boxes: THREE.Box3[]} | null;
  exterior: {plan: ExteriorPlan; view: ExteriorView; checkT: number; models: ExteriorModels} | null;
  geometries: THREE.BufferGeometry[];
  deferred: (() => void)[];
  first: boolean;
  arrival: Arrival | null;
}

const EXT_MODEL_IDS: Record<keyof ExteriorModels, OfficeAssetId> = {car: 'car-wreck', bus: 'bus-wreck', rubble: 'rubble-pile', tower: 'ruined-tower', midrise: 'ruined-midrise'};

export class TowerRuntime {
  section: SectionRt | null = null;
  /** The list only lives while playing (pause / travel / death close it; it never captures menu keys). */
  readonly choice = new TowerChoice(() => this.host.state === 'playing');
  readonly fade = new TowerFade();
  /** Current E target + its prompt (read by the HUD through promptProviders). */
  target: Target | null = null;
  prompt: string | null = null;
  /** Ride / stair requests issued (QA / tests). */
  readonly requests: TravelRequest[] = [];
  private retired: (() => void)[] = [];
  private farWas: number | null = null;
  private stairBusy = false;
  private fadeInPending = false;
  /** Loaded exterior assets (missing = not resolved yet; null = not delivered / failed). */
  private readonly models: ExteriorModels = {};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private preloading: Promise<void> | null = null;
  private upgradeQueued = false;
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
    h.warmRegistry.addPool('tower', () => (this.section ? [this.section.root] : []));
    // office sections: fetch the exterior models / skyline / glass before the build (bounded: a slow network falls back
    // to the procedural stand-ins, upgraded in place behind prepareBeforeShow when they arrive)
    h.sectionPreloads?.push(layout => (readTowerInfo(layout) ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, PRELOAD_WAIT_MS))]) : Promise.resolve()));
  }

  // -------------------------------------------------------------------------------------------
  // Section lifecycle

  build(layout: StationLayout): void {
    // (the previous section's deferred releases stay queued until the first played frame after this warm-up)
    if (this.section) this.teardown();
    const info = readTowerInfo(layout);
    if (this.fade.dark) this.fadeInPending = true;
    if (!info) return;
    void this.preload();
    const h = this.host;
    const root = new THREE.Group();
    root.name = 'tower-section';
    const sec: SectionRt = {info, root, elevator: null, stairs: null, windows: null, exterior: null, geometries: [], deferred: [], first: true, arrival: h.arrival ?? null};
    const g = h.levels.grid(Math.min(info.levelId, h.levels.count - 1));
    // --- elevator ---
    if (info.elevator) {
      const plan = planElevator(info.elevator, g);
      const cab = info.elevator.cab;
      const fixture = layout.lights.some(l => insideRect(cab, l.x, l.z, -0.05) && Math.abs(l.y - info.elevator!.floorY) < 3.5);
      // the station builder frames Door records (steel jambs + head): is the elevator opening one?
      const G = plan.gate, oc = g.cellOf(G.cx + G.nx * G.depth * 0.5, G.cz + G.nz * G.depth * 0.5);
      const builderFrame = layout.doors.some(d => !d.shopfront && oc[0] >= d.x && oc[0] < d.x + d.w && oc[1] >= d.y && oc[1] < d.y + d.h);
      const view = buildElevatorView(plan, h.mats, info.floor, info.floors, {fixture, builderFrame});
      const logic = new ElevatorLogic(info.floor, info.floors);
      if (sec.arrival?.kind === 'elevator') logic.arrive();
      view.setDoor(logic.door);
      view.setIndicator(info.floor, 0);
      root.add(view.root);
      sec.geometries.push(...view.geometries);
      h.atmosphere?.markShadows(view.shell, false);
      h.atmosphere?.markShadows(view.doors, false);
      sec.elevator = {plan, view, logic, sides: new WeakMap(), pushT: 0, dir: 0, playerBlocks: false, hintT: 1e9};
    }
    // --- stairwell doors ---
    if (info.stairDoors.length) {
      const L = h.levels;
      const plans = planStairDoors(info.stairDoors, g, (x, z) => { const f = L.floorAt(x, z, info.baseY + 0.3); return Number.isFinite(f) ? f : info.baseY; }, info.floor);
      const view = buildStairDoors(plans, h.mats);
      root.add(view.root);
      sec.geometries.push(...view.geometries);
      sec.deferred.push(...view.disposables.map(d => () => d.dispose()));
      h.atmosphere?.markShadows(view.root, false);
      sec.stairs = {plans, view, swing: null};
    }
    // --- windows ---
    if (info.windows.length) {
      const plans = planWindows(info);
      const view = buildWindows(plans, h.mats, this.glassTex ?? null);
      root.add(view.root);
      sec.geometries.push(...view.geometries);
      h.atmosphere?.markShadows(view.root, false); // frames / sills / boards block the torch like the walls (glass is skipped: not opaque)
      const boxes = plans.map(p => p.along === 'x'
        ? new THREE.Box3(new THREE.Vector3(p.a0, p.y0, Math.min(p.glass, p.inner) - 0.15), new THREE.Vector3(p.a1, p.y1, Math.max(p.glass, p.inner) + 0.15))
        : new THREE.Box3(new THREE.Vector3(Math.min(p.glass, p.inner) - 0.15, p.y0, p.a0), new THREE.Vector3(Math.max(p.glass, p.inner) + 0.15, p.y1, p.a1)));
      sec.windows = {plans, view, boxes};
    }
    // --- exterior (scenery outside the windows) ---
    if (info.windows.length) {
      setExteriorFootprint(info.exterior);
      const models = this.exteriorModels();
      const plan = planExterior({foot: info.exterior, groundY: info.groundY, eyeAbove: info.baseY - info.groundY + 1.6, seed: info.seed});
      const view = buildExterior(plan, models);
      root.add(view.root);
      sec.exterior = {plan, view, checkT: 0, models};
      // the city / skyline lie beyond the station's 70 m far plane: raise it while an office section is built
      if (this.farWas === null) this.farWas = h.camera.far;
      h.camera.far = Math.max(this.farWas, EXTERIOR.far);
      h.camera.updateProjectionMatrix();
    }
    h.scene.add(root);
    this.section = sec;
  }

  teardown(): void {
    this.choice.close();
    const sec = this.section;
    this.section = null;
    this.target = null;
    this.prompt = null;
    if (this.farWas !== null) {
      this.host.camera.far = this.farWas;
      this.host.camera.updateProjectionMatrix();
      this.farWas = null;
    }
    if (!sec) return;
    this.host.scene.remove(sec.root);
    for (const g of sec.geometries) g.dispose();
    if (sec.exterior) {
      for (const g of sec.exterior.view.geometries) g.dispose();
      const inst = sec.exterior.view.instanced;
      this.retired.push(() => { for (const im of inst) im.dispose(); });
    }
    this.retired.push(...sec.deferred);
  }

  /** Releases queued after the next warm-up (first played frame) or before the next build. */
  private flushRetired(): void {
    const list = this.retired;
    this.retired = [];
    for (const fn of list) { try { fn(); } catch (err) { console.warn('tower: releasing previous-section resources failed', err); } }
  }

  // -------------------------------------------------------------------------------------------
  // Assets (lazy; procedural fallbacks until / unless delivered)

  /**
   * Fetches the exterior models + skyline / glass textures once (cached by officeAssets; null = not delivered).
   * Started by the first office section build; lane RUN may also await it before building an office section
   * (`await game.tower?.preload()`) so the first view already uses the delivered models. Never rejects.
   */
  preload(): Promise<void> {
    if (this.preloading) return this.preloading;
    const jobs: Promise<unknown>[] = [];
    for (const [k, id] of Object.entries(EXT_MODEL_IDS) as [keyof ExteriorModels, OfficeAssetId][]) {
      jobs.push(loadOfficeAsset(id).then(gl => {
        this.models[k] = gl;
        if (gl && this.section?.exterior && !this.section.exterior.models[k]) this.upgradeQueued = true;
      }));
    }
    jobs.push(loadOfficeTexture('skyline').then(t => { if (t) setSkylineTexture(t); }));
    jobs.push(loadOfficeTexture('window-glass').then(t => {
      this.glassTex = t;
      const cracked = this.section?.windows?.view.cracked;
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
    const sec = this.section, h = this.host;
    if (!sec?.exterior || !h.prepareBeforeShow) return;
    const models = this.exteriorModels();
    const view = buildExterior(sec.exterior.plan, models);
    view.root.visible = false;
    sec.root.add(view.root);
    try { await h.prepareBeforeShow(view.root); } catch (err) { console.warn('tower: exterior upgrade not prepared', err); }
    if (this.section !== sec || !sec.exterior) { sec.root.remove(view.root); for (const g of view.geometries) g.dispose(); for (const im of view.instanced) im.dispose(); return; }
    const old = sec.exterior.view;
    view.root.visible = old.root.visible;
    sec.root.remove(old.root);
    sec.exterior = {...sec.exterior, view, models};
    for (const g of old.geometries) g.dispose();
    this.retired.push(() => { for (const im of old.instanced) im.dispose(); });
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (while playing, after the player / enemies moved)

  frame(dt: number): void {
    this.flushRetired();
    if (this.fadeInPending) { this.fadeInPending = false; this.fade.in(); }
    const sec = this.section;
    if (!sec) { this.prompt = null; return; }
    const h = this.host;
    if (sec.first) {
      sec.first = false;
      const k = sec.arrival?.kind;
      if (k === 'stairs-up' || k === 'stairs-down') {
        this.fade.in();
        const near = sec.stairs?.plans.reduce<StairDoorPlan | null>((b, p) => (!b || Math.hypot(p.x - h.player.x, p.z - h.player.z) < Math.hypot(b.x - h.player.x, b.z - h.player.z) ? p : b), null);
        if (near) towerCue(h.sfx, 'cabinetClose', {x: near.x, y: near.y + 1, z: near.z}, {rate: 0.62, gain: 0.9});
        this.steps(2, 0);
      }
    }
    if (this.upgradeQueued && !h.warming) { this.upgradeQueued = false; void this.upgradeExterior(); }
    if (sec.elevator) this.updateElevator(sec, sec.elevator, dt);
    if (sec.windows) this.windowConstraints(sec);
    if (sec.stairs?.swing) {
      const s = sec.stairs.swing;
      s.t += dt * s.dir;
      const leaf = sec.stairs.view.leaves[s.i];
      if (leaf) leaf.rotation.y = -Math.min(1, Math.max(0, s.t / 0.35)) * 0.8;
      if (s.dir < 0 && s.t <= 0) sec.stairs.swing = null;
    }
    this.updateTarget(sec);
    if (sec.exterior) this.updateExterior(sec, dt);
    // the list closes when its context goes away
    if (this.choice.isOpen && this.choiceCtx && !this.choiceCtx()) this.choice.close();
  }

  private choiceCtx: (() => boolean) | null = null;

  private onLevel(sec: SectionRt, y: number): boolean {
    const fy = sec.elevator?.plan.info.floorY ?? sec.info.baseY;
    return Math.abs(y - fy) < 1.2;
  }

  private updateElevator(sec: SectionRt, e: ElevatorRt, dt: number): void {
    const h = this.host, P = h.player, G = e.plan.gate, cab = e.plan.info.cab;
    const playerOn = this.onLevel(sec, P.y);
    const occupant = P.alive && playerOn && insideRect(cab, P.x, P.z) && gateLocal(G, P.x, P.z)[0] < -0.02;
    let doorway = P.alive && playerOn && inDoorway(G, P.x, P.z, P.radius);
    e.playerBlocks = doorway;
    e.hintT += dt;
    let enemyInside = false;
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || !this.onLevel(sec, b.y)) continue;
      if (inDoorway(G, b.x, b.z, b.stats.radius)) doorway = true;
      if (insideRect(cab, b.x, b.z, -0.05) && gateLocal(G, b.x, b.z)[0] < 0) enemyInside = true;
    }
    const ev = e.logic.update(dt, {occupant, doorway, enemyInside});
    this.onElevatorEvents(sec, e, ev);
    e.view.setDoor(e.logic.door);
    e.view.setIndicator(sec.info.floor, e.logic.phase === 'departing' || e.logic.phase === 'riding' ? e.dir : 0);
    // collision: bodies stay on their side of doors that are not open (side memory: no tunnelling)
    if (playerOn) {
      const side = e.sides.get(P) ?? gateSideOf(G, P.x, P.z);
      const r = constrainGate(G, e.logic.door, P.x, P.z, P.radius, side);
      if (r.x !== P.x || r.z !== P.z) {
        // kill the velocity into the doors
        const vn = P.vx * G.nx + P.vz * G.nz;
        if ((side === 'in' && vn > 0) || (side === 'out' && vn < 0)) { P.vx -= vn * G.nx; P.vz -= vn * G.nz; }
        P.x = r.x; P.z = r.z;
      }
      e.sides.set(P, r.side);
      // pushing against the closed doors from inside opens them (never trapped)
      if (r.pushed && r.side === 'in' && e.logic.sealed && e.logic.phase === 'idle') {
        e.pushT += dt;
        if (e.pushT > 0.7) { e.pushT = 0; this.onElevatorEvents(sec, e, e.logic.requestOpen()); }
      } else e.pushT = 0;
    }
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || z.ragdolled || !this.onLevel(sec, b.y)) continue;
      const side = e.sides.get(b) ?? gateSideOf(G, b.x, b.z);
      const r = constrainGate(G, e.logic.door, b.x, b.z, b.stats.radius, side);
      b.x = r.x; b.z = r.z;
      e.sides.set(b, r.side);
    }
  }

  private onElevatorEvents(sec: SectionRt, e: ElevatorRt, ev: readonly ElevatorEvent[]): void {
    const h = this.host, G = e.plan.gate, info = e.plan.info;
    const at: P3 = {x: G.cx + G.nx * G.depth * 0.5, y: info.floorY + 1.2, z: G.cz + G.nz * G.depth * 0.5};
    for (const x of ev) {
      switch (x.type) {
        // door motor slide (a metal cabinet door, pitched down) and the closing clunk when the leaves meet
        case 'opening': towerCue(h.sfx, 'cabinetOpen', at, {rate: 0.72, gain: 0.8}); break;
        case 'closing': towerCue(h.sfx, 'cabinetOpen', at, {rate: 0.62, gain: 0.55}); break;
        case 'closed': towerCue(h.sfx, 'cabinetClose', at, {rate: 0.7, gain: 0.8}); break;
        case 'reopen':
          if (x.why === 'enemy') h.hud.toast('The doors won’t close with something inside', true);
          else if (e.playerBlocks && e.logic.target !== null && e.hintT > 4) { e.hintT = 0; h.hud.toast('Stand clear of the doors'); }
          break;
        case 'chime':
          towerCue(h.sfx, 'click', at, {rate: 2.1, gain: 1});
          towerCue(h.sfx, 'click', at, {rate: 1.6, gain: 0.9, delay: 0.22});
          break;
        case 'depart':
          e.dir = x.floor > sec.info.floor ? 1 : -1;
          towerCue(h.sfx, 'trainDistant', at, {rate: 1.35, gain: 0.4}); // the motor's rumble (runs on under the travel overlay)
          towerCue(h.sfx, 'clank', at, {rate: 0.8, gain: 0.5});
          break;
        case 'ride': void this.ride(sec, e, x.floor); break;
        case 'cancelled': if (x.why === 'empty') { /* nobody inside when the doors closed: no ride */ } break;
        default: break;
      }
    }
  }

  private async ride(sec: SectionRt, e: ElevatorRt, floor: number): Promise<void> {
    const h = this.host;
    const req: TravelRequest = {
      to: {level: 'office', section: sectionForFloor(floor)}, arrival: {kind: 'elevator', floor},
      label: `Elevator · ${floor <= 1 ? 'lobby' : `floor ${floor}`}`, via: 'local',
    };
    this.requests.push(req);
    let ok = false, reason = 'unavailable';
    try {
      const r = h.travel ? await h.travel(req) : {ok: false, reason: 'unavailable'};
      ok = r.ok; reason = r.reason ?? reason;
    } catch (err) { reason = String((err as Error)?.message ?? err); }
    if (ok) return;
    // still the same section (the travel did not happen): back to idle, doors open
    if (this.section === sec && sec.elevator === e) {
      this.onElevatorEvents(sec, e, e.logic.rideFailed());
      if (reason !== 'dead') h.hud.toast(reason === 'busy' ? 'The elevator is busy' : 'The elevator won’t move', true);
    }
  }

  private windowConstraints(sec: SectionRt): void {
    const h = this.host, plans = sec.windows!.plans;
    const fix = (b: {x: number; z: number; y: number}, r: number): void => {
      if (Math.abs(b.y - sec.info.baseY) > 2.6) return;
      for (const p of plans) {
        const c = p.collider;
        if (b.x < c.x0 - r - 0.5 || b.x > c.x1 + r + 0.5 || b.z < c.z0 - r - 0.5 || b.z > c.z1 + r + 0.5) continue;
        const o = pushOutRect(b.x, b.z, r, c, [-p.n[0], -p.n[1]]);
        if (o) { b.x = o[0]; b.z = o[1]; }
      }
    };
    if (h.player.alive) fix(h.player, h.player.radius);
    for (const z of h.zombies) if (z.brain.alive && !z.ragdolled) fix(z.brain, z.brain.stats.radius);
  }

  // -------------------------------------------------------------------------------------------
  // Targeting / interaction

  private eyeRay(): {o: P3; d: P3} {
    const cam = this.host.camera;
    const o = cam.getWorldPosition(this.vEye), d = cam.getWorldDirection(this.vDir);
    return {o: {x: o.x, y: o.y, z: o.z}, d: {x: d.x, y: d.y, z: d.z}};
  }

  /** The panel / door under the crosshair within reach and in sight (never through a wall or slab). */
  pick(sec: SectionRt): Target | null {
    const {o, d} = this.eyeRay();
    const L = this.host.levels;
    let best: Target | null = null;
    const test = (box: Box3Like, eye: P3, make: (t: number) => Target): void => {
      const t = rayBox(o, d, box, TOWER_REACH);
      if (t === null || (best && t >= best.t)) return;
      if (!L.lineOfSight(o, eye, {slack: 0.12})) return;
      best = make(t);
    };
    const e = sec.elevator;
    if (e && !e.logic.busy) {
      test(e.plan.callBox, e.plan.callEye, t => ({kind: 'call', t}));
      test(e.plan.panelBox, e.plan.panelEye, t => ({kind: 'panel', t}));
    }
    sec.stairs?.plans.forEach((p, i) => test(p.box, p.eye, t => ({kind: 'stair', index: i, t})));
    return best;
  }

  private updateTarget(sec: SectionRt): void {
    const t = this.choice.isOpen || this.stairBusy || !this.host.player.alive ? null : this.pick(sec);
    this.target = t;
    if (!t) { this.prompt = null; return; }
    const e = sec.elevator;
    if (t.kind === 'call') this.prompt = e && e.logic.door > 0.5 ? '<b>[E]</b> Hold the elevator' : '<b>[E]</b> Call the elevator';
    else if (t.kind === 'panel') this.prompt = `<b>[E]</b> Elevator panel · floor ${floorLabel(sec.info.floor)}`;
    else this.prompt = stairPrompt(sec.stairs!.plans[t.index]);
  }

  /** E handler (Game.interactHandlers): true when the tower handled it. */
  interact(): boolean {
    const sec = this.section;
    if (!sec || this.choice.isOpen || this.stairBusy) return false;
    const t = this.pick(sec);
    if (!t) return false;
    const h = this.host, e = sec.elevator;
    if (t.kind === 'call' && e) {
      towerCue(h.sfx, 'click', e.plan.callAt, {rate: 1.4});
      this.onElevatorEvents(sec, e, e.logic.call());
      return true;
    }
    if (t.kind === 'panel' && e) {
      towerCue(h.sfx, 'click', e.plan.panelAt, {rate: 1.4});
      this.openFloorList(sec, e);
      return true;
    }
    if (t.kind === 'stair' && sec.stairs) {
      const p = sec.stairs.plans[t.index];
      if (p.choices.length === 1) void this.takeStairs(sec, t.index, p.choices[0]);
      else this.openStairList(sec, t.index, p);
      return true;
    }
    return false;
  }

  /** The floor list (inside the cab): floors top-down, current marked, plus "Open doors". */
  openFloorList(sec: SectionRt, e: ElevatorRt): void {
    const info = sec.info;
    const items: ChoiceItem[] = [...info.floors].sort((a, b) => b - a).map(f => ({
      id: `f${f}`, label: f === info.floor ? `${floorLabel(f)}  · here` : f <= 1 ? 'L  · lobby / street' : `${f}`,
      key: f <= 9 ? f : undefined, current: f === info.floor,
    }));
    items.push({id: 'open', label: '◀ ▶  open doors'});
    // highlight: the pending target, else the next floor up (down from the top floor)
    const top = Math.max(...info.floors), next = e.logic.target ?? (info.floor < top ? info.floor + 1 : info.floor - 1);
    const start = Math.max(0, items.findIndex(i => i.id === `f${next}`));
    this.choiceCtx = () => this.section === sec && !e.logic.busy && this.host.player.alive && insideRect(e.plan.info.cab, this.host.player.x, this.host.player.z, -0.6);
    this.choice.open(`Elevator · floor ${floorLabel(info.floor)}`, items, start, id => this.pickFloor(sec, e, id));
  }

  /** Inside-panel choice without the list (QA / tests): a floor number or 'open'. False when there is no live elevator. */
  panelPick(floor: number | 'open'): boolean {
    const sec = this.section, e = sec?.elevator;
    if (!sec || !e) return false;
    this.choice.close();
    this.pickFloor(sec, e, floor === 'open' ? 'open' : `f${floor}`);
    return true;
  }

  private pickFloor(sec: SectionRt, e: ElevatorRt, id: string): void {
    if (this.section !== sec) return;
    const h = this.host;
    towerCue(h.sfx, 'click', e.plan.panelAt, {rate: 1.5});
    if (id === 'open') { this.onElevatorEvents(sec, e, e.logic.requestOpen()); return; }
    const floor = Number(id.slice(1));
    const r = e.logic.select(floor);
    if (!r.ok) { h.hud.toast('The elevator is busy', true); return; }
    this.onElevatorEvents(sec, e, r.events);
    if (floor !== sec.info.floor) h.hud.toast(`Floor ${floorLabel(floor)} — doors closing`);
  }

  private openStairList(sec: SectionRt, index: number, p: StairDoorPlan): void {
    const items: ChoiceItem[] = p.choices.map((c, i) => ({id: String(i), label: `${c.dir === 'up' ? '↑ Up' : '↓ Down'} to ${c.toFloor <= 1 ? 'the lobby' : `floor ${c.toFloor}`}`, key: i + 1}));
    const P = this.host.player;
    this.choiceCtx = () => this.section === sec && Math.hypot(P.x - p.x, P.z - p.z) < 2.6;
    this.choice.open('Stairwell', items, 0, id => { const c = p.choices[Number(id)]; if (c) void this.takeStairs(sec, index, c); });
  }

  /** Stair door: swing, footsteps, short fade, then travel to the adjacent floor (fade back in on refusal). */
  async takeStairs(sec: SectionRt, index: number, c: StairChoice): Promise<void> {
    if (this.stairBusy || this.section !== sec) return;
    const h = this.host;
    this.stairBusy = true;
    const p = sec.stairs!.plans[index];
    towerCue(h.sfx, 'cabinetOpen', {x: p.x, y: p.y + 1, z: p.z}, {rate: 0.6, gain: 0.9});
    sec.stairs!.swing = {i: index, t: 0, dir: 1};
    this.steps(2, 120);
    const req: TravelRequest = {
      to: {level: 'office', section: sectionForFloor(c.toFloor)}, arrival: {kind: c.dir === 'up' ? 'stairs-up' : 'stairs-down', floor: c.toFloor},
      label: `Stairs · ${c.toFloor <= 1 ? 'lobby' : `floor ${c.toFloor}`}`, via: 'local',
    };
    this.requests.push(req);
    try {
      await this.fade.out(320);
      let ok = false, reason = 'unavailable';
      if (h.player.alive && this.section === sec) {
        try {
          const r = h.travel ? await h.travel(req) : {ok: false, reason: 'unavailable'};
          ok = r.ok; reason = r.reason ?? reason;
        } catch (err) { reason = String((err as Error)?.message ?? err); }
      } else reason = 'dead';
      if (!ok) {
        this.fade.in(260);
        if (this.section === sec && sec.stairs) sec.stairs.swing = {i: index, t: 0.35, dir: -1};
        if (reason !== 'dead') h.hud.toast(reason === 'busy' ? 'Not now' : 'The stairwell is blocked', true);
      }
    } finally {
      this.stairBusy = false;
    }
  }

  private steps(n: number, startMs: number): void {
    const s = this.host.sfx as {footstep?(sprint: boolean, crouched?: boolean): void};
    if (typeof s?.footstep !== 'function' || typeof setTimeout === 'undefined') return;
    for (let i = 0; i < n; i++) setTimeout(() => { try { s.footstep!(false, false); } catch { /* best effort */ } }, startMs + i * 260);
  }

  // -------------------------------------------------------------------------------------------
  // Exterior: the dome follows the eye; everything outside is hidden while no window can be seen

  private updateExterior(sec: SectionRt, dt: number): void {
    const ex = sec.exterior!, cam = this.host.camera;
    const eye = cam.getWorldPosition(this.vEye);
    ex.view.dome.position.copy(eye);
    ex.checkT -= dt;
    if (ex.checkT > 0) return;
    ex.checkT = 0.12;
    ex.view.root.visible = this.windowVisible(sec, eye);
  }

  /** Some window span is in the view frustum, within 80 m and in line of sight (3D: slabs / walls hide it). */
  windowVisible(sec: SectionRt, eye: THREE.Vector3): boolean {
    const w = sec.windows;
    if (!w) return false;
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const L = this.host.levels;
    for (let i = 0; i < w.plans.length; i++) {
      const p = w.plans[i], b = w.boxes[i];
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
