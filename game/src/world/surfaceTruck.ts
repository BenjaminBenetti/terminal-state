/** Surface Run's military truck, finite stores and cargo. Movement is the existing SkywaysCar controller. */
import * as THREE from 'three';
import type {Game} from '../game';
import type {StationLayout} from '../gen/stationTypes';
import type {SectionKey} from '../levels/types';
import type {Inventory, StackJSON} from '../items/inventory';
import {TrainLockbox} from '../run/trainLockbox';
import type {RunParticipant} from '../run/snapshot';
import type {EquipmentKind} from '../craft/equipment';
import type {PropPlacement} from '../gen/props';
import {PropIndex, resolveCircle} from '../core/physics';
import type {TrainUpgradesApi} from '../run/trainUpgrades';
import {LockboxView, lockboxKeyAction} from '../ui/lockboxView';
import {loadSkywaysCarModel, releaseSkywaysCarModel} from './skywaysCarModel';
import {carToWorld, worldToCar} from './skywaysCarSpec';
import type {SkywaysCar, SkywaysCarHost} from './skywaysCar';
import {SURFACE_TRUCK_LANE, SURFACE_TRUCK_SPEC, TRUCK_COMPARTMENTS, TRUCK_TIE_POINTS} from './surfaceTruckSpec';
import {SurfaceCargo, type SurfaceCargoKind, type SurfaceCargoRecord} from './surfaceTruckCargo';

export {SURFACE_TRUCK_LANE, SURFACE_TRUCK_SPEC} from './surfaceTruckSpec';

/** Called directly by Game.prepareSection: an asset failure must keep the loading screen up. */
export async function ensureSurfaceTruckReady(layout: StationLayout): Promise<void> {
  if (!layout.surface) return;
  const models = await loadSkywaysCarModel(SURFACE_TRUCK_SPEC);
  if (typeof document !== 'undefined' && !models.car) {
    releaseSkywaysCarModel(); // a retry may fetch again; never cache the failed readiness promise forever
    throw new Error('Military truck model unavailable; retry the surface transition');
  }
}

export interface TruckHost extends SkywaysCarHost {
  skywaysCar: SkywaysCar;
  inv: Inventory;
  run: SkywaysCarHost['run'] & {current: SectionKey; scopeOf(): string};
  runParticipants: RunParticipant[];
  input?: {onLockChange: (locked: boolean) => void; lock(): Promise<boolean>; unlock(): void; readonly locked: boolean};
  qa?: boolean;
  hitListeners?: ((hit: {amount: number}) => void)[];
  syncHeld?(): void;
  trainRuntime?: {train: {placement: {x: number; z: number; floorY: number}} | null} | null;
  trainUpgrades?: TrainUpgradesApi | null;
  trainEquipment?: {craftBlock(kind: EquipmentKind): string | null; craft(kind: EquipmentKind): {uid: string} | null; plugged(kind: EquipmentKind): unknown; carrying?: boolean; dragging?: boolean} | null;
  corpses?: {carrying?: boolean} | null;
  fuelCarts?: {grab?: unknown} | null;
  gear?: SkywaysCarHost['gear'] & {readied?: boolean; viewOpen?: boolean; holdProgress?: number | null};
}

const NAMES: Readonly<Record<SurfaceCargoKind, string>> = {armor: 'Train armour kit', radar: 'Route radar', scanner: 'Item scanner', sentry: 'Defense sentry'};
const KINDS: readonly SurfaceCargoKind[] = ['armor', 'radar', 'scanner', 'sentry'];
const geometry = new THREE.BoxGeometry(1, 1, 1);
const paint = new THREE.MeshStandardMaterial({name: 'surface-salvage-case', color: 0x4b5140, roughness: 0.85, metalness: 0.25});
const band = new THREE.MeshStandardMaterial({name: 'surface-salvage-straps', color: 0x22281f, roughness: 0.95});
const stencil = new THREE.MeshStandardMaterial({name: 'surface-salvage-stencil', color: 0xb4ae82, roughness: 0.9});
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

function crate(kind: SurfaceCargoKind): THREE.Group {
  const g = new THREE.Group();
  g.name = `surface-salvage-${kind}`;
  const w = kind === 'armor' ? 1.1 : 0.68, h = kind === 'armor' ? 0.45 : 0.78, d = kind === 'armor' ? 0.76 : 0.7;
  const add = (x: number, y: number, z: number, a: number, b: number, c: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); m.scale.set(a, b, c); m.castShadow = true; m.receiveShadow = true; g.add(m);
  };
  add(0, h / 2, 0, w, h, d, paint);
  for (const s of [-1, 1]) add(s * w * 0.31, h / 2, 0, 0.065, h + 0.02, d + 0.025, band);
  // The number of real stencil ticks identifies the existing kit, without a new art input.
  for (let i = 0; i <= KINDS.indexOf(kind); i++) add(-0.14 + i * 0.095, h * 0.62, -d / 2 - 0.008, 0.05, 0.12, 0.012, stencil);
  return g;
}

export class SurfaceTruck {
  readonly cargo = new SurfaceCargo();
  readonly root = new THREE.Group();
  readonly stores = TRUCK_COMPARTMENTS.map(c => new TrainLockbox(c.slots));
  readonly views: LockboxView[];
  private openIndex = -1;
  private ownsPointer = false;
  private pointerGrace = 0;
  private built = false;
  private station = '';
  private section = '';
  private seen = '';
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly colliders = new Map<string, PropPlacement>();
  private readonly prototype = new THREE.Group();
  private readonly ray = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly oldRear: SkywaysCar['rear'];
  private readonly oldSource: SkywaysCar['trunkSource'];
  private readonly ownsInput = (): boolean => this.openIndex >= 0 || !!this.cargo.carried;

  constructor(readonly host: TruckHost) {
    this.root.name = 'surface-truck-salvage';
    this.prototype.name = 'surface-salvage-warm-kinds';
    for (const kind of KINDS) this.prototype.add(crate(kind));
    this.prototype.visible = false;
    this.root.add(this.prototype);
    this.oldRear = host.skywaysCar.rear;
    this.oldSource = host.skywaysCar.trunkSource;
    this.views = TRUCK_COMPARTMENTS.map((c, i) => new LockboxView({inv: () => host.inv, slots: () => this.openIndex === i ? this.stores[i].slots : null,
      close: () => this.close(), changed: () => { host.syncHeld?.(); host.skywaysCar.store(); }},
    {id: `surface-truck-${c.id}`, name: c.name, the: `the ${c.name.toLowerCase()}`, slots: c.slots, columns: 4,
      heading: `${c.name} · stays with this truck`, help: 'Finite storage · drag or click to transfer · E closes'}));
  }

  install(): this {
    const h = this.host, car = h.skywaysCar;
    const truck = this;
    car.variant = {matches: l => !!l.surface, spec: SURFACE_TRUCK_SPEC, lane: SURFACE_TRUCK_LANE, spawn: l => l.surface?.truck};
    car.rear = {aimed: () => this.isSurface ? this.compartmentAim() >= 0 : !!this.oldRear?.aimed(),
      interact: () => this.isSurface ? this.open(this.compartmentAim()) : !!this.oldRear?.interact(),
      get prompt() { return truck.isSurface ? '<b>[E]</b> Open truck compartment' : truck.oldRear?.prompt ?? ''; }};
    car.trunkSource = () => this.isSurface && this.built ? this.slotsJSON() : this.oldSource?.() ?? car.trunkJSON;
    h.scene.add(this.root);
    h.runParticipants.push(this.cargo.participant());
    h.sectionHooks.push({build: ((layout: StationLayout) => this.onBuild(layout)) as (l: never) => void, teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    h.interactHandlers.unshift(() => this.interact());
    h.promptProviders?.unshift(() => this.prompt());
    h.inputOwners?.push(this.ownsInput);
    h.gear?.placeRules?.push(() => this.carrying ? 'Put down the salvage before setting down a backpack' : null);
    h.stateListeners?.push(((state: string) => { if (state !== 'playing') this.close(false); }) as (s: never, p: never) => void);
    h.hitListeners?.push(() => this.close());
    h.warmRegistry.addPool('surface-salvage', () => [this.prototype, this.root]);
    if (h.input) {
      const prev = h.input.onLockChange;
      h.input.onLockChange = locked => { if (!locked && (this.ownsPointer || now() < this.pointerGrace) && h.state === 'playing') return; prev(locked); };
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => {
      const action = lockboxKeyAction(e, this.openIndex >= 0);
      if (action.kind === 'pass' || action.kind === 'reset') return;
      this.close(action.kind !== 'close-pass');
      if (action.kind !== 'close-pass') { e.preventDefault(); e.stopPropagation(); }
    }, {capture: true});
    return this;
  }

  get isSurface(): boolean { return !!this.host.layout?.surface; }
  get carrying(): boolean { return !!this.cargo.carried; }
  get holster(): number { return this.carrying ? 1 : 0; }
  private get otherHandsBusy(): boolean {
    const h = this.host;
    return !!h.use || !!h.corpses?.carrying || !!h.trainEquipment?.carrying || !!h.trainEquipment?.dragging || !!h.fuelCarts?.grab ||
      !!h.gear?.readied || !!h.gear?.viewOpen || h.gear?.holdProgress != null || !!h.inputOwners?.some(f => f !== this.ownsInput && f());
  }
  private slotsJSON(): (StackJSON | null)[] { return this.stores.flatMap(s => s.toJSON().slots); }
  private onBuild(layout: StationLayout): void {
    this.close(false);
    this.station = this.host.run.scopeOf(); this.section = this.host.run.current.section;
    this.built = !!layout.surface;
    if (layout.surface) {
      this.cargo.ensure(layout.surface.seed, this.stationKey(), layout.surface.depotCargo);
      for (let i = 0; i < TRUCK_COMPARTMENTS.length; i++) {
        const c = TRUCK_COMPARTMENTS[i]; this.stores[i].load({v: 1, slots: this.host.skywaysCar.trunkJSON.slice(c.start, c.start + c.slots)});
        this.host.inv.reserveUids(this.stores[i].maxUid());
      }
      this.addTruckFixtures();
    }
    this.syncMeshes();
  }
  private teardown(): void {
    this.close(false);
    this.clearMeshes();
    for (const store of this.stores) store.clear(); // car's earlier teardown has captured the only persistent slot record
    const props = this.host.layout?.props;
    if (props && this.colliders.size) {
      const mine = new Set(this.colliders.values());
      for (let i = props.length - 1; i >= 0; i--) if (mine.has(props[i])) props.splice(i, 1);
    }
    this.colliders.clear();
    this.built = false;
    this.station = ''; this.section = '';
  }
  private clearMeshes(): void { for (const m of this.meshes.values()) m.removeFromParent(); this.meshes.clear(); }

  private addTruckFixtures(): void {
    const view = this.host.skywaysCar.view;
    if (!view) return;
    view.group.userData.provenance = 'assets/derivatives/surface-military-truck.json';
    for (const p of TRUCK_TIE_POINTS) {
      const strap = new THREE.Mesh(geometry, band); strap.position.set(p.x, p.y - 0.07, p.z); strap.scale.set(0.09, 0.12, 1.05); view.group.add(strap);
    }
    // A simple salvage rack sits above the supplied covered bed, so tied cargo is physically visible.
    const rail = (x: number, y: number, z: number, w: number, h: number, d: number) => {
      const m = new THREE.Mesh(geometry, band); m.position.set(x, y, z); m.scale.set(w, h, d); view.group.add(m);
    };
    for (const side of [-1, 1]) {
      rail(side * 0.99, 3.05, 1.12, 0.065, 0.14, 2.9);
      rail(side * 0.77, 1.68, 3.47, 0.055, 2.65, 0.055);
    }
    for (const z of [-0.33, 1.05, 2.57]) rail(0, 2.98, z, 2.05, 0.065, 0.07);
    for (let i = 0; i < 8; i++) rail(0, 0.45 + i * 0.34, 3.5, 1.55, 0.045, 0.065);
    // Physical locker faces. Their contents live solely in the 16 saved slots.
    for (const c of TRUCK_COMPARTMENTS) {
      const face = new THREE.Mesh(geometry, paint); face.position.set(c.x, c.y, c.z); face.scale.set(c.id === 'bed' ? 1.65 : 0.045, 0.42, c.id === 'bed' ? 0.045 : 0.85); view.group.add(face);
    }
  }

  private compartmentAnchor(index: number): {x: number; y: number; z: number} | null {
    const b = this.host.skywaysCar.body, c = TRUCK_COMPARTMENTS[index];
    if (!b || !c) return null;
    return {...carToWorld(b.x, b.z, b.yaw, c.x, c.z), y: b.y + c.y};
  }
  compartmentAim(): number {
    const h = this.host, car = h.skywaysCar;
    if (!this.isSurface || !this.built || car.driving || this.carrying || this.otherHandsBusy || h.state !== 'playing') return -1;
    h.camera.getWorldPosition(this.eye); h.camera.getWorldDirection(this.ray);
    for (let i = 0; i < TRUCK_COMPARTMENTS.length; i++) {
      const a = this.compartmentAnchor(i); if (!a) continue;
      const dx = a.x - this.eye.x, dy = a.y - this.eye.y, dz = a.z - this.eye.z, d = Math.hypot(dx, dy, dz);
      if (d <= 2.5 && (dx * this.ray.x + dy * this.ray.y + dz * this.ray.z) / d > 0.87 && h.levels?.lineOfSight(this.eye, a, {slack: 0.2})) return i;
    }
    return -1;
  }
  open(index: number): boolean {
    const car = this.host.skywaysCar;
    if (!this.isSurface || !this.built || !TRUCK_COMPARTMENTS[index] || car.driving || this.carrying || this.otherHandsBusy || this.host.state !== 'playing') return false;
    this.close(false); this.openIndex = index; this.ownsPointer = true; this.pointerGrace = now() + 500;
    if (!this.host.qa) this.host.input?.unlock();
    this.views[index].show(); return true;
  }
  close(relock = true): void {
    if (this.openIndex < 0) return;
    this.views[this.openIndex].hide(); this.openIndex = -1; this.ownsPointer = false; this.pointerGrace = now() + 300;
    this.host.skywaysCar.store();
    if (relock && this.host.state === 'playing' && !this.host.qa) void this.host.input?.lock();
  }

  private nearTruckRear(max = 3): boolean {
    const b = this.host.skywaysCar.body, p = this.host.player;
    if (!this.isSurface || !b || Math.abs(b.v) > 0.15) return false;
    const q = worldToCar(b.x, b.z, b.yaw, p.x, p.z);
    return Math.hypot(q.x, q.z - SURFACE_TRUCK_SPEC.length / 2) <= max && Math.abs(p.y - b.y) < 1.2;
  }
  private nearTrain(): boolean {
    const p = this.host.trainRuntime?.train?.placement;
    return !this.isSurface && !!p && Math.hypot(this.host.player.x - p.x, this.host.player.z - p.z) < 12 && Math.abs(this.host.player.y - p.floorY) < 1.5;
  }
  /** The expedition door owns E while carrying a crate. Otherwise a carry action would put it down before travel. */
  private nearAccess(): boolean {
    const layout = this.host.layout, p = this.host.player;
    const access = layout?.surface?.checkpoint.return ?? layout?.surfaceAccess;
    return !!access && Math.hypot(p.x - access.x, p.z - access.z) <= 3 && Math.abs(p.y - access.y) < 1.5;
  }
  private aimedCargo(): SurfaceCargoRecord | null {
    const h = this.host;
    if (this.otherHandsBusy) return null;
    h.camera.getWorldPosition(this.eye); h.camera.getWorldDirection(this.ray);
    let best: SurfaceCargoRecord | null = null, nearest = 4.8;
    for (const r of this.cargo.records) {
      if (r.station !== this.stationKey() || r.state === 'installed' || r.state === 'carried' || (r.state === 'truck' && !this.isSurface)) continue;
      const m = this.meshes.get(r.uid); if (!m?.visible) continue;
      m.getWorldPosition(tmp);
      const dx = tmp.x - this.eye.x, dy = tmp.y + 0.3 - this.eye.y, dz = tmp.z - this.eye.z, d = Math.hypot(dx, dy, dz);
      if (d < Math.min(nearest, r.state === 'truck' ? 4.8 : 3) && (dx * this.ray.x + dy * this.ray.y + dz * this.ray.z) / d > 0.86 && h.levels?.lineOfSight(this.eye, {x: tmp.x, y: tmp.y + 0.3, z: tmp.z}, {slack: 0.2})) { best = r; nearest = d; }
    }
    return best;
  }
  prompt(): string | null {
    if (this.host.state !== 'playing' || !this.host.player.alive || this.host.skywaysCar.driving) return null;
    const c = this.cargo.carried;
    if (c && this.nearAccess()) return null;
    if (c) return this.nearTruckRear() ? `<b>[E]</b> Secure ${NAMES[c.kind]} to truck` : this.nearTrain() ? `<b>[E]</b> Recover ${NAMES[c.kind]} into train` : `<b>[E]</b> Put down ${NAMES[c.kind]} · carry through the checkpoint access`;
    const r = this.aimedCargo();
    if (r) return r.state === 'truck' ? `<b>[E]</b> Detach and carry ${NAMES[r.kind]}` : `<b>[E]</b> Carry ${NAMES[r.kind]}`;
    const i = this.compartmentAim();
    return i >= 0 ? `<b>[E]</b> Open ${TRUCK_COMPARTMENTS[i].name}` : null;
  }
  interact(): boolean {
    const h = this.host;
    if (h.state !== 'playing' || !h.player.alive || h.skywaysCar.driving || this.openIndex >= 0) return false;
    const c = this.cargo.carried;
    if (c) {
      if (this.nearAccess()) return false;
      let error: string | null = null;
      if (this.nearTruckRear()) error = this.cargo.secure(c.uid, this.stationKey());
      else if (this.nearTrain()) error = this.cargo.recover(kind => this.recover(kind));
      else {
        const p = h.player, x = p.x - Math.sin(p.yaw) * 1.1, z = p.z - Math.cos(p.yaw) * 1.1;
        // A solid wall / absent support refuses the put-down without changing ownership.
        const L = h.levels, support = L?.supportIn(x, z, p.y, 0.25), radius = c.kind === 'armor' ? 0.68 : 0.5;
        const free = !!L && !!support && !support.volume && L.circleClear(x, z, radius, support.floor) &&
          L.lineOfSight({x: p.x, y: p.y + 0.35, z: p.z}, {x, y: support.floor + 0.35, z}, {slack: 0.1});
        const fit = free ? resolveCircle(L!, h.propIndex, x, z, radius, support!.floor, c.kind === 'armor' ? 0.45 : 0.78) : null;
        if (!fit || Math.hypot(fit[0] - x, fit[1] - z) > 0.005) error = 'No room to put down the cargo';
        else this.cargo.drop(this.stationKey(), {x, y: support!.floor, z, yaw: p.yaw});
      }
      if (error) h.hud.toast(error, true); else { h.syncHeld?.(); this.syncMeshes(); }
      return true;
    }
    const r = this.aimedCargo();
    if (r) {
      if (r.state === 'truck' && !this.nearTruckRear(4.6)) { h.hud.toast('Stop the truck and stand at the rear to release its cargo', true); return true; }
      const err = this.cargo.take(r.uid); if (err) h.hud.toast(err, true); else this.syncMeshes(); return true;
    }
    const index = this.compartmentAim(); return index >= 0 && this.open(index);
  }
  private stationKey(): string { return `${this.station}:${this.section}`; }
  private recover(kind: SurfaceCargoKind): {uid?: string; error?: string} {
    if (kind === 'armor') {
      const api = this.host.trainUpgrades; if (!api) return {error: 'The parked train is unavailable'};
      const error = api.block('armor'); if (error) return {error};
      return api.install('armor') ? {uid: 'armor'} : {error: 'Armour installation refused; cargo kept'};
    }
    const api = this.host.trainEquipment; if (!api) return {error: 'The parked train is unavailable'};
    if (api.plugged(kind)) return {error: `A ${NAMES[kind].toLowerCase()} is already fitted; cargo kept`};
    const error = api.craftBlock(kind); if (error) return {error};
    const unit = api.craft(kind); return unit ? {uid: unit.uid} : {error: 'No free train floor for this device; cargo kept'};
  }
  private syncMeshes(): void {
    // Keep the objects/materials prepared at this section's loading boundary. Inventory moves never rebuild cargo meshes.
    let collisionChanged = false;
    for (const r of this.cargo.records) {
      const here = r.station === this.stationKey();
      const present = r.state !== 'installed' && (here || r.state === 'carried') &&
        (this.isSurface || (r.state !== 'depot' && r.state !== 'truck'));
      let m = this.meshes.get(r.uid);
      if (!m && present) {
        m = crate(r.kind); m.name = `surface-salvage:${r.uid}`; m.userData.surfaceCargoUid = r.uid;
        this.meshes.set(r.uid, m); this.root.add(m);
        this.host.atmosphere?.markShadows(m, false);
      }
      if (m) m.visible = present;
      const physical = present && (r.state === 'ground' || r.state === 'depot');
      let p = this.colliders.get(r.uid);
      if (physical && !p && this.host.layout) {
        p = {kind: 'annexMachine', x: r.x, y: r.y, z: r.z, rot: r.yaw, area: 0, hx: 0, hz: 0, h: 0, blocksSight: false, variant: 0};
        this.colliders.set(r.uid, p); this.host.layout.props.push(p); collisionChanged = true;
      }
      if (p) {
        const [w, h, d] = r.kind === 'armor' ? [1.1, 0.45, 0.76] : [0.68, 0.78, 0.7];
        const c = Math.abs(Math.cos(r.yaw)), s = Math.abs(Math.sin(r.yaw));
        const hx = physical ? (w * c + d * s) / 2 : 0, hz = physical ? (w * s + d * c) / 2 : 0;
        const changed = p.x !== r.x || p.y !== r.y || p.z !== r.z || p.h !== (physical ? h : 0) || p.hx !== hx || p.hz !== hz;
        if (changed) collisionChanged = true;
        const oldX = p.x, oldZ = p.z;
        Object.assign(p, {x: r.x, y: r.y, z: r.z, rot: r.yaw, hx, hz, h: physical ? h : 0});
        if (changed) {
          const physics = this.host.physics as (SkywaysCarHost['physics'] & {propsChanged?(x: number, z: number): void});
          physics?.propsChanged?.(oldX, oldZ);
          if (oldX !== p.x || oldZ !== p.z) physics?.propsChanged?.(p.x, p.z);
        }
      }
    }
    if (collisionChanged && this.host.levels && this.host.layout) this.host.propIndex = new PropIndex(this.host.levels, this.host.layout.props);
    this.updatePoses(); this.seen = `${this.cargo.version}:${this.host.inv.version}:${this.stores.map(s => s.version).join(':')}`;
  }
  private updatePoses(): void {
    const car = this.host.skywaysCar;
    for (const r of this.cargo.records) {
      const m = this.meshes.get(r.uid); if (!m) continue;
      if (r.state === 'truck') {
        const p = TRUCK_TIE_POINTS[r.slot ?? -1], b = car.body; if (!p || !b) { m.visible = false; continue; }
        const w = carToWorld(b.x, b.z, b.yaw, p.x, p.z); m.position.set(w.x, b.y + p.y, w.z); m.rotation.y = b.yaw;
      } else if (r.state === 'carried') {
        const p = this.host.player; m.position.set(p.x - Math.sin(p.yaw) * 0.8, p.y + 0.65, p.z - Math.cos(p.yaw) * 0.8); m.rotation.y = p.yaw;
      } else { m.position.set(r.x, r.y, r.z); m.rotation.y = r.yaw; }
    }
  }
  frame(): void {
    if (!this.station) return;
    if (this.openIndex >= 0) {
      const a = this.compartmentAnchor(this.openIndex), p = this.host.player, car = this.host.skywaysCar;
      if (!a || car.driving || Math.abs(car.body?.v ?? 0) > 0.15 || Math.hypot(a.x - p.x, a.z - p.z) > 3.2 || !p.alive) this.close();
    }
    const key = `${this.cargo.version}:${this.host.inv.version}:${this.stores.map(s => s.version).join(':')}`;
    if (key !== this.seen) { this.syncMeshes(); if (this.openIndex >= 0) this.views[this.openIndex].render(); }
    this.updatePoses();
  }
  qa() { return {surface: this.isSurface, carrying: this.cargo.carried?.uid ?? null, records: this.cargo.save().records,
    compartments: TRUCK_COMPARTMENTS.map((c, i) => ({name: c.name, slots: c.slots, used: this.stores[i].used})), open: this.openIndex,
    truck: this.host.skywaysCar.body ? {...this.host.skywaysCar.body} : null, cabProtects: this.isSurface && this.host.skywaysCar.driving}; }
}
const tmp = new THREE.Vector3();

/** Install after the existing prize-car trunk; both vehicles use game.skywaysCar for all input and movement. */
export function installSurfaceTruck(game: Game): SurfaceTruck { return new SurfaceTruck(game as unknown as TruckHost).install(); }
