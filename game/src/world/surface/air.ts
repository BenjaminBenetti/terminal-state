// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's AIR — the normal gas rules throughout the district,
// installed by world/surface/install.ts (after GAS: the gas system's section build runs first and asks this runtime's window source).
// Inert outside a Surface Run district layout (`layout.surface`).
//
//  - OUTDOORS: the toxic outdoor air on every outdoor column (world/surface/airMask.ts) — gas.outdoorAir for the ONE exposure calculation
//    (world/gas/system.ts: the roof's 'outdoor' source; mask / filter / Airtank protect as there, no new oxygen system), the SAME function
//    drawn as visible green volumetric fog by the march's surface variant (render/volumetric.ts setStation reads the same column map and
//    uniforms) and, always, the green scene-fog murk at the eye (world/surface/airFog.ts — the in-engine fallback when the pass is off).
//  - INTERIORS: clean while sealed. Their gas comes only through OPENINGS, on a bounded per-building field (world/surface/airField.ts):
//    broken panes (world/surface/airPanes.ts: the district's live glazing through the existing glass path and breach rules; GEN's broken
//    columns pre-breached at the first build; state per district memory, lane SURFACE_WINDOWS_LANE through the gas system's own save /
//    restore), open / smashed doorways and the tent flap (world/surface/airDoors.ts: breaches `door:<id>` while open; shut = the source
//    stops and what came in thins away). The field's storeys are the volumetric layers: what shows indoors is what hurts.
//  - DOORS: physical leaves (world/surface/airDoorView.ts) + 'column' collision boxes, [E] open / shut, enemies push shut doors open, a
//    door opened in play swings shut by itself once its doorway is clear, never on a body; state per district memory (SURFACE_DOORS_LANE).
//  - THE TRUCK CAB: game.ts sets gas.shelter (the enclosed truck seat): exposure 0 inside it, the gas still drawn round it. Follow-up 1:
//    the cab's interior volume (world/surface/airMask.ts cabVolumeOf: the vehicle spec's `interior` on this frame's body pose) is clean
//    air for the outdoor source (surfaceAirAt) AND for the march (render/volumetric.ts setCabSource: no gas drawn inside the cab, the
//    outdoor air unchanged beyond its glass). The scene fog is distance fog (negligible over the cab's few metres) and stays the outdoor
//    murk seen through the glass.

import * as THREE from 'three';
import {PropIndex, type CollisionWorld} from '../../core/physics';
import {CELL} from '../../gen/grid';
import {Levels} from '../../gen/levels';
import type {PropPlacement} from '../../gen/props';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {loadOfficeTexture} from '../../assets/officeAssets';
import type {WarmupRegistry} from '../../render/warmup';
import type {WorldMaterials} from '../materials';
import {buildWindows, type WindowPlan, type WindowView} from '../officeWindows';
import {towerCue} from '../towerShared';
import type {GasField} from '../gas/field';
import type {GasWindowSource, OutdoorAirSource} from '../gas/system';
import {cabVolumeOf, columnTop, outdoorWeight, surfaceAirAt, surfaceOutdoorGasAt, surfaceOutdoorMap, type CabVehicle, type CabVolume, type SurfaceOutdoorMap} from './airMask';
import {SurfaceGasField, surfaceGasZones} from './airField';
import {SURFACE_WINDOWS_LANE, planSurfaceWindows, surfacePrebreached} from './airPanes';
import {DOOR_RT, SURFACE_DOORS_LANE, doorAimHit, doorBoxes, doorBreachId, doorSweeps, fitDoorBoxes, planSurfaceDoors, restoredDoor, saveDoors, shutLeafDistance, type SurfaceDoorState} from './airDoors';
import {propPhysics} from '../../damage/materials'; // (lane FIXES: a movable prop holds a door like a body)
import {buildDoorView, disposeDoorView, poseDoor, type SurfaceDoorView} from './airDoorView';
import {SurfaceAirFog} from './airFog';

/** Longest wait for the window-glass texture before the district is built (then the procedural cracked fallback + a late swap). */
export const SURFACE_GLASS_WAIT_MS = 4000;

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface SurfaceAirHost {
  layout: StationLayout;
  levels: CollisionWorld;
  scene: THREE.Scene;
  camera: THREE.Camera;
  mats: WorldMaterials;
  player: {x: number; y: number; z: number; eye: number; yaw: number; radius: number; alive: boolean};
  zombies: readonly {brain: {x: number; z: number; y: number; alive: boolean; climbing?: boolean; stats: {radius: number}}; ragdolled?: boolean; placesRoot?: boolean}[];
  /** (lane FIXES) Train units / fuel carts standing in the world hold a door like a body (the lift doors' rule). */
  trainEquipment?: {anyAt?(test: (x: number, y: number, z: number, r: number) => boolean): boolean} | null;
  fuelCarts?: {anyAt?(test: (x: number, y: number, z: number, r: number) => boolean): boolean} | null;
  gas: {windowSources: (() => GasWindowSource | null)[]; outdoorAir: OutdoorAirSource | null; field: GasField | null};
  propIndex: PropIndex;
  physics?: {propsChanged?(x: number, z: number): void};
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void};
  readonly clock: number;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  interactHandlers: (() => boolean)[];
  promptProviders: (() => string | null)[];
  warmRegistry: Pick<WarmupRegistry, 'addPool'>;
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  sfx?: unknown;
  hud?: {toast(text: string, warn?: boolean): void};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void; setCabSource?(source: (() => CabVolume | null) | null): void};
  /** (follow-up 1) The vehicle controller (world/skywaysCar.ts): its seat, `enclosed`, body pose and spec interior give the sealed cab. */
  skywaysCar?: CabVehicle | null;
  world?: {culler?: unknown} | null;
}

/** The built district air (one per district world). */
export interface SurfaceAirWorld {
  layout: StationLayout;
  info: SurfaceInfo;
  map: SurfaceOutdoorMap;
  plans: WindowPlan[];
  view: WindowView;
  prebreached: string[];
  field: SurfaceGasField | null;
  doors: SurfaceDoorState[];
  doorView: SurfaceDoorView | null;
  /** Door boxes in layout.props (bullets / melee / the torch) and in game.propIndex (collision); the index before ours. */
  layoutBoxes: PropPlacement[];
  boxes: PropPlacement[];
  prevIndex: PropIndex | null;
  root: THREE.Group;
  /** Each door's leaf group index in doorView (-1: no leaves drawn here — smashed, or the tent flap drawn by tentFlap's owner). */
  viewIndex: number[];
}

export class SurfaceAirRuntime {
  air: SurfaceAirWorld | null = null;
  /** The door the player is aimed at (prompt / [E]). */
  target: SurfaceDoorState | null = null;
  /** The tent flap's material (lane LOOK may set its canvas; default: the painted panel shape material). */
  flapMaterial: THREE.Material | null = null;
  /**
   * The tent flap drawn by the district's architecture (lane LOOK's own flap object: its open / closed seam, 0 = hanging shut .. 1 = tied
   * open). Set before the section build: this runtime then draws no flap leaf of its own and drives this with the flap's swing every frame
   * (state, collision, gas and the prompt stay here). Null: this runtime draws the flap itself.
   */
  tentFlap: ((open: number) => void) | null = null;
  readonly fog: SurfaceAirFog;
  readonly counts = {builds: 0, teardowns: 0, opens: 0, closes: 0, pushOpens: 0, autoCloses: 0, refusals: 0, reopens: 0};
  private glassTex: THREE.Texture | null | undefined = undefined;
  private loading: Promise<void> | null = null;
  private readonly eye = new THREE.Vector3();
  // (lane FIXES) the crosshair ray; the layout's movable props (re-listed when layout.props changes length)
  private readonly aimDir = new THREE.Vector3();
  private movable: {props: readonly unknown[]; n: number; list: PropPlacement[]} | null = null;
  // (follow-up 1) the outdoor air minus the sealed cab the player sits in (surfaceAirAt: the same cab the march leaves clean)
  private readonly outdoor: OutdoorAirSource = {gasAt: (x, y, z) => (this.air ? surfaceAirAt(this.air.map, this.cab(), x, y, z) : 0)};
  private readonly cabSource = (): CabVolume | null => this.cab();

  constructor(readonly host: SurfaceAirHost) {
    this.fog = new SurfaceAirFog(host.scene);
  }

  install(): this {
    const h = this.host;
    h.gas.windowSources.push(() => this.gasSource());
    h.sectionPreloads?.push(layout => (layout.surface?.windows.length ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, SURFACE_GLASS_WAIT_MS))]) : Promise.resolve()));
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.interact());
    h.promptProviders.push(() => this.prompt());
    h.warmRegistry.addPool('surface-air', () => (this.air ? [this.air.root] : []));
    return this;
  }

  /** The window-glass texture once (cached by officeAssets; null = not delivered). Never rejects. */
  preload(): Promise<void> {
    return (this.loading ??= loadOfficeTexture('window-glass').then(t => {
      this.glassTex = t;
      const cracked = this.air?.view.cracked;
      if (t && cracked && cracked.map !== t) cracked.map = t;
    }, () => { this.glassTex = null; }));
  }

  /** (follow-up 1) The sealed cab the player sits in right now (the body's current pose), or null — the district only. */
  cab(): CabVolume | null {
    return this.air ? cabVolumeOf(this.host.skywaysCar ?? null) : null;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  /**
   * The district's panes, view and (lazily) field for `layout` — called by the gas system's section build through gasSource() (it runs
   * before this runtime's own build) and again by build(); idempotent per layout.
   */
  private ensure(layout: StationLayout): SurfaceAirWorld | null {
    if (this.air && this.air.layout === layout) return this.air;
    if (this.air) this.teardown();
    const info = layout.surface, map = info ? surfaceOutdoorMap(layout) : null;
    if (!info || !map) return null;
    void this.preload();
    const h = this.host;
    const levels = layout.levels?.length ? layout.levels : [{id: 0, grid: layout.grid, baseY: 0}];
    const plans = planSurfaceWindows(info, levels);
    const view = buildWindows(plans, h.mats, this.glassTex ?? null, {frames: false}); // (the facades' frames / reveals are lane LOOK's)
    view.root.name = 'surface-windows';
    const root = new THREE.Group();
    root.name = 'surface-air';
    root.add(view.root);
    h.atmosphere?.markShadows(view.root, false);
    view.root.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    h.scene.add(root);
    root.updateMatrixWorld(true);
    const culler = h.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(view.root);
    this.air = {layout, info, map, plans, view, prebreached: surfacePrebreached(plans, info), field: null, doors: [], doorView: null, layoutBoxes: [], boxes: [], prevIndex: null, root, viewIndex: []};
    return this.air;
  }

  /** GasSystem.windowSources: the district's panes and its own bounded field (null outside a district). */
  gasSource(): GasWindowSource | null {
    const a = this.ensure(this.host.layout);
    if (!a) return null;
    const ex = {x0: 0, z0: 0, x1: a.map.w * CELL, z1: a.map.h * CELL};
    return {plans: a.plans, view: a.view, exterior: ex, lane: SURFACE_WINDOWS_LANE, prebreached: a.prebreached, field: () => this.makeField(a)};
  }

  private makeField(a: SurfaceAirWorld): SurfaceGasField {
    const L = a.layout.levels?.length ? a.layout.levels : [{id: 0, grid: a.layout.grid}];
    const p = this.host.player;
    a.field = new SurfaceGasField(L.map(l => ({id: l.id, grid: l.grid})), surfaceGasZones(a.info), a.map, () => ({x: p.x, z: p.z}));
    return a.field;
  }

  build(layout: StationLayout): void {
    const a = this.ensure(layout);
    if (!a) return;
    const h = this.host;
    // the gas system built (or not: a test host) its field from our source; adopt it
    if (!a.field && h.gas.field instanceof SurfaceGasField) a.field = h.gas.field;
    h.gas.outdoorAir = this.outdoor;
    h.atmosphere?.setCabSource?.(this.cabSource); // (follow-up 1) the march leaves the sealed cab clean
    // doors: plan, restore (district memory), boxes, leaves, the open ones' gas (aged)
    const g0 = (layout.levels?.find(l => l.id === 0)?.grid ?? layout.grid);
    const plans = planSurfaceDoors(a.info, g0, layout.levels);
    const rec = h.run.laneStore(SURFACE_DOORS_LANE);
    a.doors = plans.map(plan => {
      const r = restoredDoor(plan, rec);
      const d: SurfaceDoorState = {plan, t: r.open ? 1 : 0, target: r.open ? 1 : 0, auto: r.auto, openedAt: r.open ? h.clock - r.age : NaN, clear: 0, push: 0, blocked: false, boxes: doorBoxes(plan), gas: false};
      fitDoorBoxes(d);
      if (r.open) this.startDoorGas(d, r.age);
      return d;
    });
    a.boxes = a.doors.flatMap(d => d.boxes);
    a.layoutBoxes = a.doors.filter(d => !d.plan.tent).flatMap(d => d.boxes); // (the canvas flap blocks walking, never bullets)
    layout.props.push(...a.layoutBoxes);
    a.prevIndex = h.propIndex ?? null;
    if (a.boxes.length) {
      // everything already in the index (game.propIndex.props may BE layout.props, which now holds our layout boxes: never twice) + ours
      const ours = new Set(a.boxes);
      h.propIndex = new PropIndex(h.levels, [...(h.propIndex?.props ?? layout.props).filter(q => !ours.has(q)), ...a.boxes]);
    }
    const drawn = (d: SurfaceDoorState) => d.plan.leaves.length > 0 && !(d.plan.tent && this.tentFlap); // (an external flap: not ours to draw)
    const leafed = a.doors.filter(drawn);
    let k = 0;
    a.viewIndex = a.doors.map(d => (drawn(d) ? k++ : -1));
    if (leafed.length) {
      a.doorView = buildDoorView(leafed, h.mats, this.flapMaterial);
      a.root.add(a.doorView.root);
      a.doorView.root.updateMatrixWorld(true);
      h.atmosphere?.markShadows(a.doorView.root, false);
    }
    // the zones round the arrival point replay their history now (behind the loading screen); the rest as the player nears them
    a.field?.settle(h.player.x, h.player.z);
    this.counts.builds++;
  }

  teardown(): void {
    const a = this.air;
    this.air = null;
    this.target = null;
    this.movable = null; // (lane FIXES)
    this.fog.restore();
    if (!a) return;
    const h = this.host;
    if (a.doors.length) { try { h.run.setLaneStore(SURFACE_DOORS_LANE, saveDoors(a.doors, h.clock)); } catch (err) { console.warn('surface air: saving the doors failed', err); } }
    const mine = new Set(a.layoutBoxes);
    const props = a.layout.props;
    for (let i = props.length - 1; i >= 0; i--) if (mine.has(props[i])) props.splice(i, 1);
    if (a.prevIndex && h.layout === a.layout) h.propIndex = a.prevIndex;
    if (h.gas.outdoorAir === this.outdoor) h.gas.outdoorAir = null;
    h.atmosphere?.setCabSource?.(null); // (follow-up 1)
    if (a.doorView) disposeDoorView(a.doorView);
    a.root.removeFromParent();
    for (const g of a.view.geometries) g.dispose();
    this.counts.teardowns++;
  }

  /** Saves the doors' state without tearing down (a mid-district save, should one ever be offered). */
  flush(): void {
    const a = this.air;
    if (a?.doors.length) this.host.run.setLaneStore(SURFACE_DOORS_LANE, saveDoors(a.doors, this.host.clock));
  }

  // -------------------------------------------------------------------------------------------
  // Doors

  private doorBreach(d: SurfaceDoorState) {
    return {id: doorBreachId(d.plan.id), level: d.plan.level, cells: d.plan.cells};
  }

  private startDoorGas(d: SurfaceDoorState, age: number): void {
    const f = this.air?.field;
    if (d.gas || !f || !d.plan.cells.length) return;
    d.gas = f.addAged(this.doorBreach(d), age);
  }

  private stopDoorGas(d: SurfaceDoorState): void {
    if (!d.gas) return;
    d.gas = false;
    this.air?.field?.removeBreach(doorBreachId(d.plan.id));
  }

  /** Opens door d (by: 'player' = [E], 'enemy' = pushed). A door opened in play shuts by itself once clear. */
  open(d: SurfaceDoorState, by: 'player' | 'enemy' | 'qa' = 'player'): boolean {
    if (!d.plan.leaves.length || d.target === 1) return false;
    d.target = 1;
    d.auto = true;
    d.clear = 0;
    d.push = 0;
    if (by === 'enemy') this.counts.pushOpens++; else this.counts.opens++;
    this.cue(d, 'open');
    return true;
  }

  /** Shuts door d unless something stands in its leaves' path (then: refused, false). */
  close(d: SurfaceDoorState): boolean {
    if (!d.plan.leaves.length || d.target === 0) return false;
    if (this.sweepBlocked(d)) { this.counts.refusals++; return false; }
    d.target = 0;
    d.clear = 0;
    this.counts.closes++;
    this.cue(d, 'closing');
    return true;
  }

  private sameStorey(d: SurfaceDoorState, y: number): boolean {
    return Math.abs(y - d.plan.floor) < DOOR_RT.storey;
  }

  /**
   * (lane FIXES) Something stands in the path the door's leaves take shutting from where they are now (airDoors.ts doorSweeps, d.t -> 0):
   * the living player, a living enemy on its feet (a BB on a wall / ceiling is not in a doorway: the train doors' rule), a train unit or
   * fuel cart standing in the world (the lift doors' rule) or a movable floor prop at its current spot (a dynamic-class kind; its larger
   * half extent as its circle). Anchored props are the building's own; loose pickups are no bodies (the lift doors' rule too).
   */
  private sweepBlocked(d: SurfaceDoorState): boolean {
    const h = this.host, p = h.player, P = d.plan, from = d.t;
    const hit = (x: number, y: number, z: number, r: number): boolean => this.sameStorey(d, y) && doorSweeps(P, from, 0, x, z, r);
    if (p.alive && hit(p.x, p.y, p.z, p.radius)) return true;
    for (const z of h.zombies) {
      const b = z.brain;
      if (b.alive && !z.ragdolled && !(z.placesRoot && b.climbing) && hit(b.x, b.y, b.z, b.stats.radius)) return true;
    }
    if (h.trainEquipment?.anyAt?.(hit) || h.fuelCarts?.anyAt?.(hit)) return true;
    for (const q of this.movableProps()) if (!q.cargoGone && q.y < P.floor + 0.3 && hit(q.x, q.y, q.z, Math.max(q.hx, q.hz))) return true;
    return false;
  }

  /** (lane FIXES) The layout's props of a movable (dynamic-class) kind — ours excluded; their x / z follow a loose one's body. */
  private movableProps(): readonly PropPlacement[] {
    const props = this.air?.layout.props;
    if (!props) return [];
    const m = this.movable;
    if (m && m.props === props && m.n === props.length) return m.list;
    const ours = new Set(this.air!.boxes);
    const list = props.filter(q => !ours.has(q) && propPhysics(q.kind).dynamic);
    this.movable = {props, n: props.length, list};
    return list;
  }

  private cue(d: SurfaceDoorState, what: 'open' | 'closing' | 'shut'): void {
    const at = {x: d.plan.x, y: d.plan.floor + 1.2, z: d.plan.z};
    if (d.plan.tent) { if (what !== 'shut') towerCue(this.host.sfx, 'cabinetOpen', at, {rate: 0.45, gain: 0.35}); return; } // canvas: a soft rustle
    if (what === 'open') towerCue(this.host.sfx, 'cabinetOpen', at, {rate: 0.62, gain: 0.85});
    else if (what === 'closing') towerCue(this.host.sfx, 'cabinetOpen', at, {rate: 0.55, gain: 0.6});
    else towerCue(this.host.sfx, 'cabinetClose', at, {rate: 0.6, gain: 0.85});
  }

  /** One door's frame: bodies in the doorway, enemy push, auto-close, the swing, boxes, leaves, gas. */
  private doorFrame(d: SurfaceDoorState, i: number, dt: number): void {
    const h = this.host, a = this.air!;
    if (!d.plan.leaves.length) { if (!d.gas) this.startDoorGas(d, 0); return; } // smashed: a permanent opening
    d.blocked = d.t > 0 || d.target === 1 ? this.sweepBlocked(d) : false; // (lane FIXES: a shut door has no path to block)
    // a closing door never shuts on a body: it swings open again
    if (d.target === 0 && d.t > 0 && d.blocked) { d.target = 1; this.counts.reopens++; }
    // enemies pressing on a shut leaf push it open
    if (d.target === 0 && d.t < 0.05) {
      let pressing = false;
      for (const z of h.zombies) {
        const b = z.brain;
        if (!b.alive || z.ragdolled || !this.sameStorey(d, b.y)) continue;
        if (shutLeafDistance(d.plan, b.x, b.z) < b.stats.radius + DOOR_RT.pushReach) { pressing = true; break; }
      }
      d.push = pressing ? d.push + dt : 0;
      if (d.push >= DOOR_RT.pushOpen) this.open(d, 'enemy');
    }
    // a door opened in play swings shut by itself once its doorway has been clear for a while
    if (d.target === 1 && d.auto && d.t >= 1) {
      d.clear = d.blocked ? 0 : d.clear + dt;
      if (d.clear >= DOOR_RT.autoClose && this.close(d)) this.counts.autoCloses++;
    }
    // the swing
    const was = d.t;
    if (d.t !== d.target) {
      const step = dt / DOOR_RT.time;
      d.t = d.target === 1 ? Math.min(1, d.t + step) : Math.max(0, d.t - step);
      if (d.t === 0 && was > 0) this.cue(d, 'shut');
    }
    if (fitDoorBoxes(d)) h.physics?.propsChanged?.(d.plan.x, d.plan.z);
    if (a.doorView && i >= 0) poseDoor(a.doorView, d, i);
    else if (d.plan.tent && this.tentFlap) { try { this.tentFlap(d.t); } catch (err) { console.warn('surface air: the tent flap failed', err); this.tentFlap = null; } }
    // the gas: an opening while not shut
    if (d.t > 0.02 && !d.gas) { this.startDoorGas(d, 0); if (!Number.isFinite(d.openedAt)) d.openedAt = h.clock; }
    if (d.t <= 0.02 && d.target === 0 && d.gas) { this.stopDoorGas(d); d.openedAt = NaN; }
  }

  // -------------------------------------------------------------------------------------------
  // Per frame

  frame(dt: number): void {
    const a = this.air;
    if (!a) return;
    const h = this.host;
    // the scene-fog murk at the eye: the same outdoor weight as the exposure / the march (never the mask, never the truck seat)
    h.camera.getWorldPosition(this.eye);
    this.fog.apply(outdoorWeight(a.map, this.eye.x, this.eye.y, this.eye.z));
    for (let k = 0; k < a.doors.length; k++) this.doorFrame(a.doors[k], a.viewIndex[k] ?? -1, dt);
    this.target = this.aimedDoor();
  }

  /**
   * The leafed door the player can work now: on its storey, the crosshair on one of its leaves (at its pose) or its opening within
   * DOOR_RT.reach of the eye (airDoors.ts doorAimHit), nothing structural (a wall, a lintel, a slab) in between; the nearest such door.
   * (lane FIXES: was the doorway CENTRE within 2.1 m in a look cone — a wide door's leaf ends were out of reach.)
   */
  private aimedDoor(): SurfaceDoorState | null {
    const a = this.air, h = this.host, p = h.player;
    if (!a || !p.alive) return null;
    const cam = h.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.eye);
    cam.getWorldDirection(this.aimDir);
    const o = this.eye, dir = this.aimDir;
    let best: SurfaceDoorState | null = null, bt: number = DOOR_RT.reach;
    for (const d of a.doors) {
      if (!d.plan.leaves.length || !this.sameStorey(d, p.y)) continue;
      const dx = d.plan.x - o.x, dz = d.plan.z - o.z, far = DOOR_RT.reach + d.plan.width * 1.15 + DOOR_RT.aimPad + 0.3;
      if (dx * dx + dz * dz > far * far) continue; // (cheap reject: no leaf tip is further than 1.12 x the width from the centre)
      const t = doorAimHit(d.plan, d.t, o, dir, bt);
      if (t !== null && t < bt) { bt = t; best = d; }
    }
    if (!best || !(h.levels instanceof Levels)) return best;
    const wall = h.levels.raycast(o, dir, bt + 0.02);
    return wall.kind !== 'none' && wall.t < bt - 0.01 ? null : best;
  }

  interact(): boolean {
    const d = this.target;
    if (!d || !this.air) return false;
    if (d.target === 1) {
      if (!this.close(d)) this.host.hud?.toast('Something is in the doorway');
    } else this.open(d, 'player');
    return true;
  }

  prompt(): string | null {
    const d = this.target;
    if (!d) return null;
    const what = d.plan.tent ? 'the tent flap' : 'the door';
    return d.target === 1 ? `<b>[E]</b> Close ${what}` : `<b>[E]</b> Open ${what}`;
  }

  // -------------------------------------------------------------------------------------------
  // QA

  summary() {
    const a = this.air;
    if (!a) return null;
    const p = this.host.player;
    return {
      outdoorAtEye: surfaceOutdoorGasAt(a.map, p.x, p.eye, p.z), columnTop: columnTop(a.map, p.x, p.z), fog: this.fog.k,
      outdoorCells: a.map.outdoorCells, indoorCells: a.map.indoorCells, panes: a.plans.reduce((n, q) => n + q.panes.length, 0), prebreached: a.prebreached.length,
      doors: a.doors.map(d => ({id: d.plan.id, gen: d.plan.gen, t: Math.round(d.t * 100) / 100, target: d.target, gas: d.gas, blocked: d.blocked})),
      field: a.field?.stats() ?? null, target: this.target?.plan.id ?? null, counts: {...this.counts},
      cab: this.cab(), airAtEye: surfaceAirAt(a.map, this.cab(), p.x, p.eye, p.z), // (follow-up 1: the sealed cab, the air the eye breathes)
    };
  }
}

let installed: SurfaceAirRuntime | null = null;

/** The installed runtime (tests / QA). */
export const surfaceAirRuntime = (): SurfaceAirRuntime | null => installed;

export function installSurfaceAir(game: SurfaceAirHost): SurfaceAirRuntime {
  return (installed = new SurfaceAirRuntime(game).install());
}

/**
 * QA hooks for short browser spot checks (the lead may spread them into window.__LL: `...surfaceAirQaApi()`):
 *  - surfaceAir() -> outdoor gas / column / fog weight at the eye, panes, doors, field stats, counters;
 *  - surfaceDoor(id, 'open' | 'close') -> works a door as [E] would (no aim needed); surfaceSettle() -> replays every zone now.
 */
export function surfaceAirQaApi() {
  return {
    surfaceAir: () => installed?.summary() ?? null,
    surfaceDoor: (id: string, op: 'open' | 'close') => {
      const d = installed?.air?.doors.find(q => q.plan.id === id);
      return d && installed ? (op === 'open' ? installed.open(d, 'qa') : installed.close(d)) : false;
    },
    surfaceSettle: () => installed?.air?.field?.settle(0, 0, Infinity) ?? 0,
  };
}
