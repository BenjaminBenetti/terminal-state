// Task studio-refinement-batch-20261113-035659-01 (lane MELT; user: "Acid Scrapper Grenade ... Throw at zombies or props; damage zombies
// and stick to props. Melt world props including containers/portable devices (not just movable/cargo). Non-graphic dissolve/melt
// presentation; each destroyed prop yields EXACTLY 1 scrap_metal OR 1 electrical_parts, once. ... Containers physically spill real
// contents, conserving UIDs/rounds. Protect TRAIN STRUCTURE and ALL FIXED TRAIN-MOUNTED FIXTURES ... Portable cargo/containers/devices
// NOT protected merely by being aboard. Use common physical traits/ownership, not per-kind whitelists."): ACID MELTS WORLD PROPS.
// The lead's grenade (weapons/grenades.ts: canister, burst, the pool's look, actor damage, sound) asks this system what its pool and its
// stuck canister touch (inDisc / atPoint), feeds pool contact (expose) and starts a melt on a burst (start); everything about the props
// melting is here. Installed through the Game's registries only (sectionLayoutHooks, sectionHooks, frameHooks, warmRegistry).
//
// WHAT MELTS (traits / ownership, never a list of kinds): every thing the player sees as an object standing in the world —
//  - station layout props (furniture, containers, machines, benches, shelves, crates, bins, lockers, desks, counters, devices), loose
//    ones (physics/dynamicItems.ts bodies) where they lie, carried props (world/trainPropCargo.ts, `prop.cargo`) wherever they lie —
//    aboard or not: portable cargo is not protected by being in the car;
//  - crafted train equipment standing in the world (TrainEquipmentSystem 'world' units: chest / radar / sentry / scanner — aboard too);
//  - fuel carts standing in the world (aboard too).
// NOT CANDIDATES (each with its reason, `protection()`):
//  - not a layout placement: the train's own boxes (shell, curbs, door leaves: PlayerTrainRuntime.train.layoutBoxes, by identity) and
//    any box another system pushes at run time — only GENERATED placements (identity captured before anything is appended) and carried
//    props are candidates. The fixed train fixtures (original Lockbox, bench, chipper, plugs, drive console, Save CRT, armour kit) are
//    drawn on the car's view root and are never placements: no query can reach them;
//  - building structure: the physics audit's 'structure' / 'partition' classes (columns, stairs, glazing, shutters, partitions, stages ...).
//    Wall / ceiling MOUNTED props (cabinets, kits, phones, boards) are objects, not structure: they melt (a floor pool rarely reaches
//    them — their base is above its band —, a canister stuck to one does);
//  - an objective: the Bunker's generator slots and core cluster (gen/bunker/bunkerKinds.ts isBunkerObjectiveKind: world/bunker owns
//    them) — and anything drawn by another system (not in the shared prop render index: the Reactor's gensets — collision-only
//    'annexMachine' boxes under world/reactor's models —, its hero models) is never hidden here ('not drawn');
//  - trader stock: the market stalls' ware displays (market/wares/slots.ts vendorDisplayHosts: the stall's finite stock, never loot);
//  - collision owned elsewhere: a placement the live walk index does not hold (world/stalls.ts rebuilds it with its own partition /
//    door boxes per toilet stall: dissolving the placement would leave them standing);
//  - decor RIDING a host (damage/materials.ts ridesHost: garments on a rail): part of its host — it melts with it;
//  - holding up a prop that may not melt (a static one of the classes above resting on it / hosted by it): nothing is left floating;
//  - nothing gone, broken to rubble or riding the train.
// Pickups are not props: they stay; ones resting on a melted surface fall (woken). Nothing a level's progress needs is lost: a holder's
// contents always spill (a progression item in one lies on the floor afterwards).
//
// LIFECYCLE. expose(ref, dt) accumulates pool contact; MELT.exposure s of it (or start(ref): the canister burst on it) STARTS a melt. At
// most MELT.maxActive dissolve at once; later ones wait their turn intact (queued). A melt BEGINS: the thing leaves every system — a loose
// prop's body is withdrawn (DynamicItems.withdraw), a carried prop's record consumed (TrainPropCargo.consume), a holder's lots snapshotted
// and the holder removed (never opened / taken from again), the render handed over (PropDamage.retire: its parts become the dissolving
// copy; the prop is never detached / marked again), a unit / cart taken out of its system (destroy: grab / hose / plug / records); a
// static prop's collider stays until it is gone. Everything resting on it or hosted by it that cannot stand on its own (static decor, a
// static stack) joins the melt as members (each one its own salvage). After MELT.seconds it COMPLETES, exactly once:
//  - colliders / sight gone (h 0, blocksSight false, cargoGone: never stocked / roped again; physics.propsChanged), loose decor on it
//    woken first (it falls), then pickups / loose props / shelf filler resting on it woken (the stocked boards out of the filler's way);
//  - contents spill as real pickups at valid floor spots inside its footprint (Levels.supportAt: never through a wall): holder lots incl.
//    closed compartments (same item / count, lot id as provenance — the game's spill rule), a unit's slots (the SAME ItemStack objects:
//    uid / mag / count / bag kept; legacy sentry rounds as fresh stacks), a fuel cart's units as fuel cans (FUEL.canUnits each, stacks of
//    FUEL.canStackMax; a remainder below one can — none while canUnits is 1 — is never invented);
//  - salvage: EXACTLY one pickup per destroyed thing at its base — `electrical_parts` for powered / electronic things (a screen, the
//    audit's machinery, a humming appliance: audio/sfx.ts humEmitters, a plug-in device), `scrap_metal` for everything else;
//  - persisted: a generated prop in ACID_MELT_LANE (run/acidMeltRecord.ts; re-applied on every build: hidden, no collider / holder /
//    stock, never a second spill or salvage); carried props / units / carts are dropped from their own records (consume / destroy).
// clear() (the section teardown, FIRST — unshifted — before every lane records and before the memory is saved; also safe mid-world):
// every started melt completes at once (spill, salvage, persistence), visuals dropped. A save taken WITHOUT a teardown (the ending,
// a mid-world save point) should call clear() first, or a melt in progress at that moment is saved half done.
// Nav: the grid stays as generated (a melted prop's cells stay blocked for enemies: conservative, no softlock).
//
// PRESENTATION (non-graphic, no fog / gas / smoke): over MELT.seconds the copy (the prop's own parts, damage materials and marks as drawn;
// a unit's / cart's own view) is overlaid by an acid-tinted shell (its own geometry, a transparent yellow-green glow) that rises, then
// sags / shrinks into the floor about its base and fades; a few small bubbles rise off it (one pooled InstancedMesh); a soft fizz
// (`fizz`: the existing positional hiss by default, Sfx.blightHiss — assignable). Bounded: MELT.maxActive dissolves, one shell material
// per slot, one bubble mesh, no allocation per frame (the copy is built once when a melt begins); the shell / bubble prototypes are
// warmed with the station (pool 'acid-melt').

import * as THREE from 'three';
import type {Game} from '../game';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import type {SectionKey} from '../levels/types';
import type {ItemStack} from '../items/inventory';
import {PROP_PHYSICS_AUDIT} from '../damage/physicsAudit';
import {propDamageSpec, ridesHost} from '../damage/materials';
import {humEmitters} from '../audio/sfx';
import {isBunkerObjectiveKind} from '../gen/bunker/bunkerKinds';
import {vendorDisplayHosts} from '../market/wares/slots';
import {HOLDER_LABEL} from '../items/loot';
import {itemDef} from '../items/items';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../items/craftMaterials';
import {FUEL} from '../fuel/fuel';
import {dynamicKind} from '../physics/merchOnHost';
import {ACID_MELT_LANE, acidMeltedOf, type AcidMeltedJSON} from '../run/acidMeltRecord';
import {CART} from './fuelCartPhysics';

export const MELT = {
  /** Seconds of pool contact before a thing starts to melt. */
  exposure: 0.8,
  /** Dissolve time (s): begin -> gone. */
  seconds: 2.4,
  /** inDisc: a thing's base within this of the pool's floor height (m). */
  band: 0.7,
  /** atPoint: default reach from the surface (m). */
  reach: 0.3,
  /** Dissolves drawn at once (more wait their turn intact). */
  maxActive: 6,
  /** Rising bubbles per dissolve. */
  bubbles: 6,
  /** The copy's final height / footprint scale about its base. */
  sag: 0.02,
  shrink: 0.8,
  /** Peak opacity of the acid shell. */
  tint: 0.72,
  /** Acid yellow-green (shell / bubbles) and its glow. */
  color: 0xa6d42e,
  glow: 0x587d12,
  /** Resting on a melted support: inside its footprint + pad (m), above its base + lift, at most `over` above its top. */
  restPad: 0.05,
  restLift: 0.04,
  restOver: 0.4,
  /** A spill / salvage spot's floor may lie this far below the thing's base (decor on a counter) / above it (m). */
  dropMax: 2.5,
  stepMax: 0.35,
  /** The tiny shove that wakes loose decor / props resting on a melted support (N s: lets gravity act, no throw). */
  nudge: 0.02,
} as const;

export interface MeltRef { readonly key: string; readonly x: number; readonly y: number; readonly z: number; readonly label: string }

/** Why a prop never melts (null: it can). */
export type MeltProtection = 'not a placement' | 'train structure' | 'gone' | 'unclassified' | 'building structure' | 'objective'
  | 'trader stock' | 'collision owned elsewhere' | 'rides its host' | 'not drawn' | 'holds up a protected prop';

// ---------------------------------------------------------------------------------------------------------------------
// Host (structural: the Node tests drive it with the real physics / damage / containers / pickups / train / equipment / carts)

interface LotLike { itemId: string; count: number; id: number }
interface PickupLike { stack: {itemId: string; count: number; uid?: number}; x: number; y: number; z: number; obj: THREE.Object3D }
interface LooseLike { prop: PropPlacement; index: number; matrix: THREE.Matrix4; center: THREE.Vector3; half: THREE.Vector3; riders: readonly {prop: PropPlacement; index: number}[] }
interface UnitLike {
  uid: string; mode: string;
  def: {name: string; plug: boolean; slotItem: string | null; radius: number; height: number};
  body: {x: number; y: number; z: number; r?: number; h?: number};
  store: {slots: (ItemStack | null)[]} | null;
  legacyAmmo: number;
  touchStore?(): void;
  view: {group: THREE.Object3D};
}
interface CartLike { uid: string; mode: string; body: {x: number; y: number; z: number; r?: number; h?: number} }
interface DestroyedCart { uid: string; units: number; x: number; y: number; z: number; yaw: number; level: number; view: {group: THREE.Object3D} }
interface PropDamageLike {
  index: {inst: Map<PropPlacement, {mesh: THREE.InstancedMesh; index: number}[]>; merged: readonly {box: THREE.Box3; blockersOnly: boolean}[]};
  retire(prop: PropPlacement, index?: number, copies?: boolean): {meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[]} | null;
  isRetired(prop: PropPlacement): boolean;
}

export interface AcidMeltHost {
  scene: THREE.Object3D;
  run: {current: SectionKey; laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined; setLaneStore(lane: string, data: unknown, key?: SectionKey): void};
  layout: StationLayout | null;
  levels: {
    supportAt(x: number, z: number, y: number, tol?: number): {floor: number} | null;
    lineOfSight?(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}, o?: {sightProps?: boolean}): boolean;
  } | null;
  propIndex: {props: readonly PropPlacement[]} | null;
  inv: {makeStack(itemId: string, count: number, mag?: number): ItemStack};
  pickups: {readonly list: readonly PickupLike[]; add(stack: ItemStack, x: number, y: number, z: number, yaw?: number): unknown; addAt?(stack: ItemStack, m: THREE.Matrix4, fromLot?: {holder: number; lot: number}): unknown};
  containers: {holderFor(p: PropPlacement): {serial: number; state: {lots: readonly LotLike[]}} | null; removeHolder(p: PropPlacement): boolean; emptyHolder(p: PropPlacement): boolean; ownRoot?(p: PropPlacement): THREE.Object3D | null} | null;
  physics: {
    dynamicItems: {
      propMatrix(prop: PropPlacement, out: THREE.Matrix4): boolean;
      loose(): LooseLike[];
      withdraw(prop: PropPlacement, o?: {detach?: boolean}): {matrix: THREE.Matrix4; parts: THREE.Object3D[]} | null;
      isDynamicProp(prop: PropPlacement): boolean;
      shootProp(prop: PropPlacement, index: number, point: THREE.Vector3, dir: THREE.Vector3, impulse: number): boolean;
      wakePickup(p: PickupLike): boolean;
      restHeight(prop: PropPlacement): number;
    };
    propsChanged(x: number, z: number): void;
  };
  damage: {props: PropDamageLike};
  stock?: {holders: readonly {prop: PropPlacement; colliders: THREE.Box3[]}[]; filler: {restingIn(box: THREE.Box3, out?: never[]): readonly unknown[]; wake(p: never, why?: 'support'): unknown}} | null;
  trainRuntime?: {train: {layoutBoxes: readonly PropPlacement[]} | null} | null;
  trainPropCargo?: {consume(prop: PropPlacement): boolean} | null;
  trainEquipment?: {units(): readonly UnitLike[]; destroy(uid: string): UnitLike | null} | null;
  fuelCarts?: {bodies(): readonly CartLike[]; destroy(uid: string): DestroyedCart | null} | null;
  sfx?: unknown;
  sectionLayoutHooks: ((layout: StationLayout, key: SectionKey, run: never, phase: 'prepare' | 'build') => void)[];
  sectionHooks: {holders?(layout: StationLayout, key: SectionKey): void; build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  warmRegistry?: {addPool(name: string, f: () => readonly THREE.Object3D[]): void} | null;
  acidMelt?: AcidMelt | null;
}

// ---------------------------------------------------------------------------------------------------------------------

type Kind = 'prop' | 'unit' | 'cart';
/** idle (untouched: whether it may melt is protection(), checked live) / melting (started: queued or dissolving) / done (gone for good). */
type State = 'idle' | 'melting' | 'done';

class Ref implements MeltRef {
  x = 0; y = 0; z = 0;
  constructor(readonly key: string, public label: string) {}
}

interface Target {
  ref: Ref;
  kind: Kind;
  prop: PropPlacement | null;
  uid: string | null;
  exposure: number;
  state: State;
  melt: Melt | null;
}

interface Member {
  t: Target;
  prop: PropPlacement;
  index: number;
  /** Its generated index (persisted), else undefined (carried). */
  gen: number | undefined;
  /** World AABB at the begin (spill / wake / salvage). */
  box: THREE.Box3;
  /** Holder lots snapshotted at the begin (the holder is removed then) and its serial (provenance). */
  lots: LotLike[];
  serial: number;
}

interface Melt {
  t: Target;
  members: Member[];
  unit: UnitLike | null;
  cart: DestroyedCart | null;
  /** The whole thing's world AABB at the begin. */
  box: THREE.Box3;
  /** Base centre (sag pivot, salvage of a unit / cart, where()). */
  base: THREE.Vector3;
  /** Seconds since it began dissolving; -1: queued (intact, waiting for a slot). */
  age: number;
  slot: number;
  root: THREE.Group | null;
  geometries: THREE.BufferGeometry[];
  /** Bubble state per bubble: phase, speed, x / z offset fractions, size. */
  bub: Float32Array;
  done: boolean;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
const B = new THREE.Box3(), DB = new THREE.Box3();
const BUCKET = 4;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FAR = -1e5;
const smooth = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const decamel = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

/** A prop kind's display label (the loot holder label where it has one). */
export function meltLabel(kind: string): string {
  return (HOLDER_LABEL as Record<string, string | undefined>)[kind] ?? decamel(kind);
}

/**
 * The salvage trait: powered / electronic things give electrical parts — a screen (damage/materials.ts: a screen part or a screen body),
 * the audit's machinery, a humming appliance (audio/sfx.ts humEmitters: vending machines, coolers, fridges) — everything else scrap metal.
 */
export function propSalvage(kind: string): typeof ELECTRICAL_PARTS | typeof SCRAP_METAL {
  const spec = propDamageSpec(kind);
  if (spec.cls === 'screen' || spec.glass?.cls === 'screen') return ELECTRICAL_PARTS;
  if (PROP_PHYSICS_AUDIT[kind]?.why === 'machinery') return ELECTRICAL_PARTS;
  if (humEmitters([{kind, x: 0, y: 0, z: 0, h: 1}]).length) return ELECTRICAL_PARTS;
  return SCRAP_METAL;
}

/** The world AABB of an oriented box (object matrix `m`, object-frame centre / half extents) into `out`. */
function obbBox(m: THREE.Matrix4, c: THREE.Vector3, h: THREE.Vector3, out: THREE.Box3): THREE.Box3 {
  const e = m.elements;
  const cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], cy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13], cz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
  const ex = Math.abs(e[0]) * h.x + Math.abs(e[4]) * h.y + Math.abs(e[8]) * h.z;
  const ey = Math.abs(e[1]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[9]) * h.z;
  const ez = Math.abs(e[2]) * h.x + Math.abs(e[6]) * h.y + Math.abs(e[10]) * h.z;
  out.min.set(cx - ex, cy - ey, cz - ez);
  out.max.set(cx + ex, cy + ey, cz + ez);
  return out;
}

/** Circle (x, z, r) vs the AABB's footprint. */
function discHits(b: THREE.Box3, x: number, z: number, r: number): boolean {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x), dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return dx * dx + dz * dz <= r * r;
}

function boxDist(b: THREE.Box3, x: number, y: number, z: number): number {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x), dy = Math.max(b.min.y - y, 0, y - b.max.y), dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return Math.hypot(dx, dy, dz);
}

/** The live world's bookkeeping (one station build). */
interface Here {
  key: SectionKey;
  layout: StationLayout;
  gen: Map<PropPlacement, number>;
  /** Generated props melted in this station (the lane, updated on every completion). */
  rec: AcidMeltedJSON;
  /** Static-position candidates bucketed by centre cell; candidates that can move (dynamic kinds, carried props). */
  buckets: Map<number, PropPlacement[]> | null;
  movers: PropPlacement[];
  maxHalf: number;
  /** layout.props.length when the candidates were collected (placements appended later: collected again). */
  collected: number;
  /** Every placement by its 2 m cells and its current index (holdsProtected), built at the first need. */
  grid: Map<number, PropPlacement[]> | null;
  at: Map<PropPlacement, number> | null;
  /** The live walk index's props and their set (inWalkIndex; a stall / train rebuild of the index is a new array: a new set). */
  indexed: readonly PropPlacement[] | null;
  indexSet: Set<PropPlacement> | null;
}

export class AcidMelt {
  /** Things touched in this world (stable refs: the lead may keep one across frames). */
  private readonly targets = new Map<string, Target>();
  private readonly byProp = new Map<PropPlacement, Target>();
  private readonly melts: Melt[] = [];
  private readonly slots: (Melt | null)[] = new Array(MELT.maxActive).fill(null);
  private here: Here | null = null;
  private readonly genIndex = new WeakMap<StationLayout, Map<PropPlacement, number>>();
  private readonly vendorOf = new WeakMap<StationLayout, Set<PropPlacement>>();
  private readonly meltedOf = new WeakMap<StationLayout, Set<PropPlacement>>();
  private readonly keyOf = new WeakMap<StationLayout, SectionKey>();
  private readonly protections = new Map<PropPlacement, MeltProtection | null>();
  private readonly out: MeltRef[] = [];
  /** The fizz when a dissolve begins (default: the existing positional hiss, once per melt). Assignable (the lead's own cue). */
  fizz: ((x: number, y: number, z: number, id: object) => void) | null;
  /** The presentation (scene objects kept across worlds). */
  readonly group = new THREE.Group();
  private readonly shells: THREE.MeshStandardMaterial[] = [];
  private readonly shellProtos: THREE.Mesh[] = [];
  private readonly bubbles: THREE.InstancedMesh;
  private seed = 0x2545f491;
  /** QA / tests. */
  readonly counts = {exposed: 0, started: 0, begun: 0, queued: 0, completed: 0, aborted: 0, salvage: 0, spilled: 0, woken: 0, members: 0, restored: 0, cleared: 0};

  constructor(readonly host: AcidMeltHost) {
    this.group.name = 'acid-melt';
    for (let i = 0; i < MELT.maxActive; i++) {
      const m = new THREE.MeshStandardMaterial({color: MELT.color, emissive: MELT.glow, emissiveIntensity: 0.8, roughness: 0.32, metalness: 0,
        transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4});
      m.name = `acid-melt-shell-${i}`;
      this.shells.push(m);
      // (a warm-up prototype per shell material: the station warm-up compiles them; never visible in play)
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), m);
      p.name = `acid-melt-shell-proto-${i}`;
      p.visible = false;
      p.castShadow = false;
      this.shellProtos.push(p);
      this.group.add(p);
    }
    const bm = new THREE.MeshStandardMaterial({color: MELT.color, emissive: MELT.glow, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false});
    bm.name = 'acid-melt-bubble';
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), bm, MELT.maxActive * MELT.bubbles);
    this.bubbles.name = 'acid-melt-bubbles';
    this.bubbles.frustumCulled = false;
    this.bubbles.castShadow = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.bubbles.count; i++) this.bubbles.setMatrixAt(i, ZERO);
    this.bubbles.visible = false;
    this.group.add(this.bubbles);
    const sfx = host.sfx as {blightHiss?(id: object, x: number, y: number, z: number, delayS?: number): boolean} | undefined;
    this.fizz = sfx && typeof sfx.blightHiss === 'function' ? (x, y, z, id) => { sfx.blightHiss!(id, x, y, z, 0); } : null;
  }

  install(): this {
    const h = this.host;
    // the layout hook FIRST (before the prop cargo appends carried props: the generated identities), teardown FIRST (before every lane
    // records the section and before its memory is saved: a melt in progress completes), holders / build after the others
    h.sectionLayoutHooks.unshift((layout, key, _run, phase) => this.onLayout(layout, key, phase));
    h.sectionHooks.unshift({teardown: () => this.onTeardown()});
    h.sectionHooks.push({holders: () => this.onHolders(), build: () => this.onBuild()});
    h.frameHooks.push(dt => this.tick(dt));
    h.scene.add(this.group);
    h.warmRegistry?.addPool('acid-melt', () => [...this.shellProtos, this.bubbles]);
    h.acidMelt = this;
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  private onLayout(layout: StationLayout, key: SectionKey, phase: 'prepare' | 'build'): void {
    if (!this.genIndex.has(layout)) {
      const m = new Map<PropPlacement, number>();
      layout.props.forEach((q, i) => { if (!q.cargo) m.set(q, i); });
      this.genIndex.set(layout, m);
      const vend = new Set<PropPlacement>();
      if (layout.market) for (const i of vendorDisplayHosts(layout)) { const q = layout.props[i]; if (q) vend.add(q); }
      this.vendorOf.set(layout, vend);
    }
    if (phase !== 'build') return;
    this.keyOf.set(layout, {...key});
    const rec = acidMeltedOf(this.host.run.laneStore(ACID_MELT_LANE, key));
    const byIndex = new Map<number, PropPlacement>();
    for (const [q, i] of this.genIndex.get(layout)!) byIndex.set(i, q);
    const gone = new Set<PropPlacement>();
    for (const g of rec.gone) {
      const q = byIndex.get(g.i);
      if (!q || q.kind !== g.kind) continue; // (a layout that no longer has that kind there: the row is kept, it simply hides nothing)
      q.cargoGone = true; // (never stocked / roped; the prop cargo empties and hides it too)
      gone.add(q);
    }
    this.meltedOf.set(layout, gone);
  }

  /** Holders built: a holder melted earlier holds nothing (its lots spilled when it dissolved: they lie here as pickups). */
  private onHolders(): void {
    const L = this.host.layout, cm = this.host.containers;
    if (!L || !cm) return;
    for (const q of this.meltedOf.get(L) ?? []) cm.emptyHolder(q);
  }

  private onBuild(): void {
    const h = this.host, L = h.layout;
    if (!L) return;
    let gen = this.genIndex.get(L);
    if (!gen) { // (a world built without the layout hook: its generated props keep their identities, nothing melted)
      gen = new Map();
      L.props.forEach((q, i) => { if (!q.cargo) gen!.set(q, i); });
      this.genIndex.set(L, gen);
      this.vendorOf.set(L, new Set());
    }
    const key = this.keyOf.get(L) ?? {...h.run.current};
    this.here = {key, layout: L, gen, rec: acidMeltedOf(h.run.laneStore(ACID_MELT_LANE, key)), buckets: null, movers: [], maxHalf: 0, collected: -1, grid: null, at: null, indexed: null, indexSet: null};
    // props melted earlier: gone for good (render retired — instances hidden, merged triangles cut —, no holder, no collider, no sight)
    for (const q of this.meltedOf.get(L) ?? []) {
      h.damage.props.retire(q, L.props.indexOf(q), false);
      h.containers?.removeHolder(q);
      q.h = 0;
      q.blocksSight = false;
      this.changed(q.x - q.hx, q.z - q.hz, q.x + q.hx, q.z + q.hz);
      this.counts.restored++;
    }
  }

  private onTeardown(): void {
    this.clear();
    this.here = null;
    this.targets.clear();
    this.byProp.clear();
    this.protections.clear();
    this.melts.length = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Eligibility

  /** Why a layout prop never melts in this world (null: it can). Static traits (cached per world) + its live state. */
  protection(prop: PropPlacement): MeltProtection | null {
    const w = this.here;
    if (!w) return 'not a placement';
    if (prop.cargoGone) return 'gone';
    const p = this.staticOf(prop, w);
    if (p !== null) return p;
    if (!this.inWalkIndex(prop, w)) return 'collision owned elsewhere';
    return null;
  }

  /** The permanent part of protection() (traits / ownership that cannot change within one world), cached per world. */
  private staticOf(prop: PropPlacement, w: Here): MeltProtection | null {
    let p = this.protections.get(prop);
    if (p === undefined) { p = this.staticProtection(prop, w); this.protections.set(prop, p); }
    return p;
  }

  private staticProtection(prop: PropPlacement, w: Here): MeltProtection | null {
    // (the train's own boxes are never generated placements either: named for what they are; the cache lasts one world, as they do)
    if (this.host.trainRuntime?.train?.layoutBoxes.includes(prop)) return 'train structure';
    if (!(w.gen.has(prop) || (!!prop.cargo && !prop.cargo.includes('/')))) return 'not a placement';
    const row = PROP_PHYSICS_AUDIT[prop.kind];
    if (!row) return 'unclassified';
    if (row.why === 'structure' || row.why === 'partition') return 'building structure';
    if (isBunkerObjectiveKind(prop.kind)) return 'objective';
    if (this.vendorOf.get(w.layout)?.has(prop)) return 'trader stock';
    if (prop.host !== undefined && ridesHost(prop.kind)) return 'rides its host';
    if (!this.drawn(prop)) return 'not drawn';
    if (this.holdsProtected(prop, w)) return 'holds up a protected prop';
    return null;
  }

  /**
   * A static prop that may NOT melt rests on this one / is hosted by it (glazing on a counter, another system's model on a plinth): this one
   * stays too — nothing is ever left floating (static decor that may melt goes with it instead; loose decor falls).
   */
  private holdsProtected(prop: PropPlacement, w: Here): boolean {
    const g = this.supportGrid(w), i = w.at!.get(prop) ?? -1, top = prop.y + prop.h;
    for (let cz = Math.floor((prop.z - prop.hz) / 2); cz <= Math.floor((prop.z + prop.hz) / 2); cz++) {
      for (let cx = Math.floor((prop.x - prop.hx) / 2); cx <= Math.floor((prop.x + prop.hx) / 2); cx++) {
        for (const q of g.get((cz + 4096) * 8192 + (cx + 4096)) ?? []) {
          if (q === prop || q.h <= 0.02 || q.cargoGone || (q.level ?? 0) !== (prop.level ?? 0)) continue;
          const hosted = q.host !== undefined && q.host === i && i >= 0;
          if (!hosted && !(Math.abs(q.y - top) < 0.06 && Math.abs(q.x - prop.x) < q.hx + prop.hx - 0.02 && Math.abs(q.z - prop.z) < q.hz + prop.hz - 0.02)) continue;
          if ((hosted && ridesHost(q.kind)) || this.host.physics.dynamicItems.isDynamicProp(q)) continue; // (riders go with it; movable decor falls)
          if (this.staticOf(q, w) !== null) return true;
        }
      }
    }
    return false;
  }

  /** Every placement by its 2 m cells (support queries), with its current index; built once per world. */
  private supportGrid(w: Here): Map<number, PropPlacement[]> {
    if (w.grid) return w.grid;
    const g = new Map<number, PropPlacement[]>(), at = new Map<PropPlacement, number>();
    w.layout.props.forEach((q, i) => {
      at.set(q, i);
      for (let cz = Math.floor((q.z - q.hz) / 2); cz <= Math.floor((q.z + q.hz) / 2); cz++) {
        for (let cx = Math.floor((q.x - q.hx) / 2); cx <= Math.floor((q.x + q.hx) / 2); cx++) {
          const k = (cz + 4096) * 8192 + (cx + 4096);
          let l = g.get(k);
          if (!l) g.set(k, (l = []));
          l.push(q);
        }
      }
    });
    w.grid = g;
    w.at = at;
    return g;
  }

  /** Drawn by the shared prop render (its instances / a merged chunk over its box / a holder's own meshes): what retire can hide. */
  private drawn(prop: PropPlacement): boolean {
    const pd = this.host.damage.props;
    if (pd.index.inst.get(prop)?.length) return true;
    if (this.host.containers?.ownRoot?.(prop)) return true;
    const b = DB; // (its own scratch box: never the queries' shared one)
    b.min.set(prop.x - prop.hx, prop.y, prop.z - prop.hz);
    b.max.set(prop.x + prop.hx, prop.y + Math.max(0.02, prop.h), prop.z + prop.hz);
    for (const m of pd.index.merged) if (!m.blockersOnly && m.box.intersectsBox(b)) return true; // (blocker chunks: glazing / shutters only — structure)
    return false;
  }

  /** The live walk index holds it (world/stalls.ts swaps a toilet stall's box for its own panel / door boxes). */
  private inWalkIndex(prop: PropPlacement, w: Here): boolean {
    const props = this.host.propIndex?.props;
    if (!props || props === w.layout.props) return true;
    if (w.indexed !== props) { w.indexed = props; w.indexSet = new Set(props); }
    return w.indexSet!.has(prop);
  }

  /** The prop stands in the world now: a collider (not rubble / gone) or a loose body. */
  private present(prop: PropPlacement): boolean {
    return prop.h > 0.02 || this.host.physics.dynamicItems.propMatrix(prop, M);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Targets / refs

  private propId(prop: PropPlacement): string | null {
    const w = this.here;
    if (!w) return null;
    if (prop.cargo) return prop.cargo.includes('/') ? null : `c:${prop.cargo}`;
    const i = w.gen.get(prop);
    return i === undefined ? null : `p:${i}`;
  }

  private propTarget(prop: PropPlacement): Target | null {
    let t = this.byProp.get(prop);
    if (t) return t;
    const id = this.propId(prop);
    if (!id) return null;
    t = {ref: new Ref(id, meltLabel(prop.kind)), kind: 'prop', prop, uid: null, exposure: 0, state: 'idle', melt: null}; // (protection is checked live: inDisc / atPoint / standing)
    this.targets.set(id, t);
    this.byProp.set(prop, t);
    return t;
  }

  private thingTarget(kind: 'unit' | 'cart', uid: string, label: string): Target {
    const id = `${kind === 'unit' ? 'eq' : 'cart'}:${uid}`;
    let t = this.targets.get(id);
    if (!t) { t = {ref: new Ref(id, label), kind, prop: null, uid, exposure: 0, state: 'idle', melt: null}; this.targets.set(id, t); }
    return t;
  }

  private unitOf(uid: string): UnitLike | null {
    for (const u of this.host.trainEquipment?.units() ?? []) if (u.uid === uid) return u;
    return null;
  }

  private cartOf(uid: string): CartLike | null {
    for (const c of this.host.fuelCarts?.bodies() ?? []) if (c.uid === uid) return c;
    return null;
  }

  /** A target's thing as it stands now (a prop: its world box into `out`; a unit / cart: its cylinder's box). False: not there. */
  private boxOf(t: Target, out: THREE.Box3): boolean {
    if (t.kind === 'prop') return this.propBox(t.prop!, out);
    const b = t.kind === 'unit' ? this.unitOf(t.uid!) : this.cartOf(t.uid!);
    if (!b || b.mode !== 'world') return false;
    const u = t.kind === 'unit' ? b as UnitLike : null;
    const r = b.body.r ?? u?.def.radius ?? CART.radius, hh = b.body.h ?? u?.def.height ?? CART.height;
    out.min.set(b.body.x - r, b.body.y, b.body.z - r);
    out.max.set(b.body.x + r, b.body.y + hh, b.body.z + r);
    return true;
  }

  /** A prop's world box as it stands now: a loose body's oriented box, else its placement (false: no collider, not loose — gone / rubble). */
  private propBox(p: PropPlacement, out: THREE.Box3): boolean {
    const di = this.host.physics.dynamicItems;
    if (di.propMatrix(p, M)) {
      const rh = di.restHeight(p), q = Math.round(p.rot / (Math.PI / 2)) & 1;
      V.set(0, rh / 2, 0);
      V2.set((q ? p.hz : p.hx), rh / 2, (q ? p.hx : p.hz));
      obbBox(M, V, V2, out);
      return true;
    }
    if (p.h <= 0.02) return false;
    out.min.set(p.x - p.hx, p.y, p.z - p.hz);
    out.max.set(p.x + p.hx, p.y + p.h, p.z + p.hz);
    return true;
  }

  private place(t: Target, b: THREE.Box3): Ref {
    t.ref.x = (b.min.x + b.max.x) / 2;
    t.ref.y = b.min.y;
    t.ref.z = (b.min.z + b.max.z) / 2;
    return t.ref;
  }

  /**
   * The static-position candidate buckets + the movers: every placement whose permanent traits allow a melt (live states — gone, the
   * walk index — are checked per query: a prop the train withdrew on a departure that was then refused is a candidate again). Collected
   * once per world, again when placements were appended (the layout only grows after its build).
   */
  private collect(w: Here): void {
    if (w.buckets && w.collected === w.layout.props.length) return;
    w.buckets = new Map();
    w.movers = [];
    w.maxHalf = 0;
    w.collected = w.layout.props.length;
    for (const p of w.layout.props) {
      if (this.staticOf(p, w) !== null) continue;
      if (p.cargo || dynamicKind(p.kind)) { w.movers.push(p); continue; }
      const k = (Math.floor(p.z / BUCKET) + 4096) * 8192 + (Math.floor(p.x / BUCKET) + 4096);
      let l = w.buckets.get(k);
      if (!l) w.buckets.set(k, (l = []));
      l.push(p);
      w.maxHalf = Math.max(w.maxHalf, p.hx, p.hz);
    }
  }

  /** Candidate props whose box may come within `r` of (x, z), into `out` (static buckets + every mover). */
  private near(x: number, z: number, r: number, out: PropPlacement[]): PropPlacement[] {
    out.length = 0;
    const w = this.here;
    if (!w) return out;
    this.collect(w);
    const R = r + w.maxHalf;
    for (let cz = Math.floor((z - R) / BUCKET); cz <= Math.floor((z + R) / BUCKET); cz++) {
      for (let cx = Math.floor((x - R) / BUCKET); cx <= Math.floor((x + R) / BUCKET); cx++) {
        const l = w.buckets!.get((cz + 4096) * 8192 + (cx + 4096));
        if (l) for (const p of l) out.push(p);
      }
    }
    for (const p of w.movers) out.push(p);
    return out;
  }
  private readonly nearList: PropPlacement[] = [];

  // ---------------------------------------------------------------------------------------------------------------------
  // The seam

  /**
   * Eligible, not yet melting / melted things whose footprint overlaps the floor disc (x, z, r) near floor height y (their base within
   * MELT.band). The returned array is reused: valid until the next call (the refs themselves are stable).
   */
  inDisc(x: number, y: number, z: number, r: number): MeltRef[] {
    const out = this.out;
    out.length = 0;
    if (!this.here) return out;
    for (const p of this.near(x, z, r, this.nearList)) {
      // (geometry first — cheap rejects for the many candidates out of reach — then ownership / state)
      if (!this.propBox(p, B) || Math.abs(B.min.y - y) > MELT.band || !discHits(B, x, z, r)) continue;
      const t = this.byProp.get(p) ?? this.propTarget(p);
      if (!t || t.state !== 'idle' || this.protection(p) !== null) continue;
      out.push(this.place(t, B));
    }
    for (const u of this.host.trainEquipment?.units() ?? []) {
      if (u.mode !== 'world') continue;
      const t = this.thingTarget('unit', u.uid, u.def.name);
      if (t.state !== 'idle' || !this.boxOf(t, B)) continue;
      const rr = (B.max.x - B.min.x) / 2;
      if (Math.abs(B.min.y - y) > MELT.band || (u.body.x - x) ** 2 + (u.body.z - z) ** 2 > (r + rr) ** 2) continue;
      out.push(this.place(t, B));
    }
    for (const c of this.host.fuelCarts?.bodies() ?? []) {
      if (c.mode !== 'world') continue;
      const t = this.thingTarget('cart', c.uid, 'fuel cart');
      if (t.state !== 'idle' || !this.boxOf(t, B)) continue;
      const rr = (B.max.x - B.min.x) / 2;
      if (Math.abs(B.min.y - y) > MELT.band || (c.body.x - x) ** 2 + (c.body.z - z) ** 2 > (r + rr) ** 2) continue;
      out.push(this.place(t, B));
    }
    return out;
  }

  /** The eligible meltable (idle or already melting) whose surface is at / within `r` of a world point — the canister sticks to it. */
  atPoint(x: number, y: number, z: number, r: number = MELT.reach): MeltRef | null {
    if (!this.here) return null;
    const dm = this.host.physics.dynamicItems;
    let best: Target | null = null, bd = r;
    for (const p of this.near(x, z, r, this.nearList)) {
      const t = this.byProp.get(p) ?? this.propTarget(p);
      if (!t || t.state === 'done') continue;
      let d: number;
      if (t.melt && t.melt.age >= 0) d = boxDist(t.melt.box, x, y, z); // (dissolving: its copy's box)
      else if (dm.propMatrix(p, M)) { // a loose prop: the point in its object frame vs its (oriented) box
        const rh = dm.restHeight(p), q = Math.round(p.rot / (Math.PI / 2)) & 1, hx = q ? p.hz : p.hx, hz = q ? p.hx : p.hz;
        V.set(x, y, z).applyMatrix4(M2.copy(M).invert());
        d = Math.hypot(Math.max(Math.abs(V.x) - hx, 0), Math.max(-V.y, 0, V.y - rh), Math.max(Math.abs(V.z) - hz, 0));
      } else if (this.propBox(p, B)) d = boxDist(B, x, y, z);
      else continue;
      if (d > bd || (!(t.melt && t.melt.age >= 0) && this.protection(p) !== null)) continue; // (out of reach first: then ownership)
      bd = d;
      best = t;
    }
    // units / carts standing (idle or queued): their cylinders; dissolving ones (out of their systems): their copies' boxes
    for (const u of this.host.trainEquipment?.units() ?? []) {
      if (u.mode !== 'world') continue;
      const t = this.thingTarget('unit', u.uid, u.def.name);
      if (t.state === 'done' || !this.boxOf(t, B)) continue;
      const d = this.cylDist(u.body.x, u.body.z, B, x, y, z);
      if (d <= bd) { bd = d; best = t; }
    }
    for (const c of this.host.fuelCarts?.bodies() ?? []) {
      if (c.mode !== 'world') continue;
      const t = this.thingTarget('cart', c.uid, 'fuel cart');
      if (t.state === 'done' || !this.boxOf(t, B)) continue;
      const d = this.cylDist(c.body.x, c.body.z, B, x, y, z);
      if (d <= bd) { bd = d; best = t; }
    }
    for (const m of this.melts) {
      if (m.t.kind === 'prop' || m.done || m.age < 0) continue;
      const d = boxDist(m.box, x, y, z);
      if (d <= bd) { bd = d; best = m.t; }
    }
    const t = best as Target | null;
    return t && this.boxNow(t, B) ? this.place(t, B) : null;
  }

  /** The thing's box now: a dissolving one's copy, else as it stands (boxOf). */
  private boxNow(t: Target, out: THREE.Box3): boolean {
    if (t.melt && t.melt.age >= 0) { out.copy(t.melt.box); return true; }
    return this.boxOf(t, out);
  }

  private cylDist(cx: number, cz: number, b: THREE.Box3, x: number, y: number, z: number): number {
    const r = (b.max.x - b.min.x) / 2;
    return Math.hypot(Math.max(Math.hypot(x - cx, z - cz) - r, 0), Math.max(b.min.y - y, 0, y - b.max.y));
  }

  /** The target of a ref this world handed out (by identity: a ref kept from another world names nothing here, whatever its key). */
  private targetOf(ref: MeltRef): Target | null {
    const t = this.targets.get(ref.key);
    return t && t.ref === ref ? t : null;
  }

  /** Pool contact for dt seconds; MELT.exposure of it starts the melt. Idempotent once melting; false = protected / gone. */
  expose(ref: MeltRef, dt: number): boolean {
    const t = this.targetOf(ref);
    if (!t || t.state === 'done') return false;
    if (t.state === 'melting') return true;
    if (!this.standing(t)) return false;
    t.exposure += Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.counts.exposed++;
    if (t.exposure >= MELT.exposure) return this.start(ref);
    return true;
  }

  /** Start melting now (the canister was stuck to it when it burst). True: melting (now or already); false: protected / gone. */
  start(ref: MeltRef): boolean {
    const t = this.targetOf(ref);
    if (!t || t.state === 'done') return false;
    if (t.state === 'melting') return true;
    if (!this.standing(t)) return false;
    this.queue(t);
    this.counts.started++;
    this.pump();
    return true;
  }

  /** True while that thing still exists in the world (standing — idle or waiting its turn — or dissolving). */
  alive(ref: MeltRef): boolean {
    const t = this.targetOf(ref);
    if (!t || t.state === 'done') return false;
    return (!!t.melt && t.melt.age >= 0) || this.standing(t);
  }

  /** Current world position of a ref (its base centre; loose props / units / carts move). False: gone. */
  where(ref: MeltRef, out: {x: number; y: number; z: number}): boolean {
    if (!this.alive(ref)) return false;
    const t = this.targetOf(ref)!;
    if (!this.boxNow(t, B)) return false;
    out.x = (B.min.x + B.max.x) / 2; out.y = B.min.y; out.z = (B.min.z + B.max.z) / 2;
    return true;
  }

  /** An idle target's thing stands in the world and may melt. */
  private standing(t: Target): boolean {
    if (!this.here) return false;
    if (t.kind === 'prop') {
      const p = t.prop!;
      if (this.protection(p) !== null) return false;
      return this.present(p);
    }
    return this.boxOf(t, B);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Melts

  private queue(t: Target): Melt {
    const m: Melt = {t, members: [], unit: null, cart: null, box: new THREE.Box3(), base: new THREE.Vector3(), age: -1, slot: -1, root: null, geometries: [],
      bub: new Float32Array(MELT.bubbles * 5), done: false};
    t.state = 'melting';
    t.melt = m;
    this.melts.push(m);
    this.counts.queued++;
    return m;
  }

  /** Queued melts begin while a slot is free (oldest first). */
  private pump(): void {
    for (const m of this.melts) {
      if (m.age >= 0 || m.done) continue;
      const s = this.slots.indexOf(null);
      if (s < 0) return;
      this.begin(m, s);
    }
  }

  /**
   * The thing leaves every system and its dissolving copy is drawn (`slot` < 0: no copy — a melt completed at once by clear()). A unit /
   * cart that is no longer standing in the world (picked up / riding before its turn came) is not melted (aborted: idle again).
   */
  private begin(m: Melt, slot: number): void {
    const h = this.host, t = m.t, visuals = slot >= 0;
    if (visuals) { m.root = new THREE.Group(); m.root.name = `acid-melt:${t.ref.key}`; m.root.matrixAutoUpdate = false; }
    if (t.kind === 'prop') {
      if (!this.present(t.prop!) || this.protection(t.prop!) !== null) { this.abort(m); return; }
      this.beginProps(m, visuals);
    } else if (t.kind === 'unit') {
      const u = this.unitOf(t.uid!);
      if (!u || u.mode !== 'world') { this.abort(m); return; }
      u.view.group.updateWorldMatrix(true, true);
      M.copy(u.view.group.matrixWorld);
      const d = h.trainEquipment?.destroy(u.uid);
      if (!d) { this.abort(m); return; }
      m.unit = d;
      const r = d.body.r ?? d.def.radius, hh = d.body.h ?? d.def.height;
      m.box.min.set(d.body.x - r, d.body.y, d.body.z - r);
      m.box.max.set(d.body.x + r, d.body.y + hh, d.body.z + r);
      if (m.root) this.adoptView(m, d.view.group, M);
    } else {
      const c = this.cartOf(t.uid!) as (CartLike & {view?: {group: THREE.Object3D}}) | null;
      if (!c || c.mode !== 'world') { this.abort(m); return; }
      c.view?.group.updateWorldMatrix(true, true);
      if (c.view) M.copy(c.view.group.matrixWorld);
      const d = h.fuelCarts?.destroy(t.uid!);
      if (!d) { this.abort(m); return; }
      m.cart = d;
      const r = c.body.r ?? CART.radius, hh = c.body.h ?? CART.height;
      m.box.min.set(d.x - r, d.y, d.z - r);
      m.box.max.set(d.x + r, d.y + hh, d.z + r);
      if (m.root && c.view) this.adoptView(m, d.view.group, M);
    }
    m.base.set((m.box.min.x + m.box.max.x) / 2, m.box.min.y, (m.box.min.z + m.box.max.z) / 2);
    m.age = 0;
    this.counts.begun++;
    if (!visuals) return;
    m.slot = slot;
    this.slots[slot] = m;
    this.shells[slot].opacity = 0;
    // shells: every shown mesh of the copy again with the slot's acid material (the copy root is at identity now: world matrices)
    const meshes: THREE.Mesh[] = [];
    m.root!.updateMatrixWorld(true);
    m.root!.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && me.visible && me.geometry) meshes.push(me); });
    for (const me of meshes) {
      const s = new THREE.Mesh(me.geometry, this.shells[slot]);
      s.name = 'acid-melt-shell';
      s.matrixAutoUpdate = false;
      s.matrix.copy(me.matrixWorld);
      s.castShadow = false;
      s.receiveShadow = false;
      s.renderOrder = (me.renderOrder || 0) + 1;
      if (me.userData.level !== undefined) s.userData.level = me.userData.level;
      m.root!.add(s);
    }
    this.host.scene.add(m.root!);
    m.root!.matrix.identity();
    m.root!.matrixWorldNeedsUpdate = true;
    // bubbles: phase, speed, x / z fraction, size
    for (let i = 0; i < MELT.bubbles; i++) {
      const o = i * 5;
      m.bub[o] = this.rand(); m.bub[o + 1] = 0.7 + this.rand() * 0.8; m.bub[o + 2] = this.rand() * 2 - 1; m.bub[o + 3] = this.rand() * 2 - 1; m.bub[o + 4] = 0.018 + this.rand() * 0.03;
    }
    this.fizz?.(m.base.x, m.base.y + 0.2, m.base.z, m);
  }

  /** A unit's / cart's own view becomes the dissolving copy (its world matrix kept; its meshes, materials and look as drawn). */
  private adoptView(m: Melt, g: THREE.Object3D, world: THREE.Matrix4): void {
    g.removeFromParent();
    g.matrixAutoUpdate = false;
    g.matrix.copy(world);
    g.visible = true;
    m.root!.add(g);
  }

  /** A prop melt begins: its members (the prop + its riders + static decor / stacks on them) leave every system. */
  private beginProps(m: Melt, visuals: boolean): void {
    const h = this.host, L = this.here!.layout, di = h.physics.dynamicItems, pd = h.damage.props;
    const list = this.assembly(m.t.prop!);
    const loose = new Map<PropPlacement, LooseLike>();
    if (list.some(p => di.propMatrix(p, M))) for (const lp of di.loose()) loose.set(lp.prop, lp);
    m.box.makeEmpty();
    const looseMem = new Map<PropPlacement, Member>();
    for (const p of list) {
      const t = this.byProp.get(p) ?? this.propTarget(p)!;
      if (t !== m.t) { t.state = 'melting'; t.melt = m; this.counts.members++; }
      const idx = L.props.indexOf(p);
      const mem: Member = {t, prop: p, index: idx, gen: p.cargo ? undefined : this.here!.gen.get(p), box: new THREE.Box3(), lots: [], serial: -1};
      const lp = loose.get(p), host = p.host !== undefined && ridesHost(p.kind) ? looseMem.get(L.props[p.host]) : undefined;
      if (lp) {
        obbBox(lp.matrix, lp.center, lp.half, mem.box);
        di.withdraw(p); // (its body out of the simulation: nothing pushes, captures or reclaims it while it dissolves)
        looseMem.set(p, mem);
      } else if (host) {
        mem.box.copy(host.box); // (decor riding a loose host lies where the host lies: its placement is stale)
      } else {
        mem.box.min.set(p.x - p.hx, p.y, p.z - p.hz);
        mem.box.max.set(p.x + p.hx, p.y + Math.max(0.02, p.h), p.z + p.hz);
      }
      if (p.cargo) h.trainPropCargo?.consume(p);
      const hd = h.containers?.holderFor(p);
      if (hd) {
        mem.lots = hd.state.lots.map(l => ({itemId: l.itemId, count: l.count, id: l.id}));
        mem.serial = hd.serial;
        h.containers!.removeHolder(p);
      }
      p.cargoGone = true; // (not part of this station any more: never stocked / roped again)
      const r = pd.retire(p, idx, visuals);
      if (r && m.root) { for (const me of r.meshes) m.root.add(me); m.geometries.push(...r.geometries); }
      else if (r) for (const g of r.geometries) g.dispose();
      m.members.push(mem);
      m.box.union(mem.box);
    }
  }

  /**
   * The prop and what cannot outlive it: the decor riding it, every static prop hosted by it or standing on its top (a stack, on-top
   * decor) that may melt and is idle — recursively. Loose / dynamic decor is not a member: it falls when the support goes (wakeResting).
   */
  private assembly(root: PropPlacement): PropPlacement[] {
    const L = this.here!.layout, di = this.host.physics.dynamicItems;
    const out: PropPlacement[] = [root], seen = new Set<PropPlacement>([root]);
    for (let k = 0; k < out.length; k++) {
      const p = out[k], pi = L.props.indexOf(p), top = p.y + di.restHeight(p);
      const loose = di.propMatrix(p, M); // (a loose prop: its placement is stale — only the riders it carries go with it)
      for (const q of L.props) {
        if (seen.has(q) || q.cargoGone || (q.level ?? 0) !== (p.level ?? 0)) continue;
        const hosted = q.host !== undefined && q.host === pi && pi >= 0;
        const onTop = !loose && Math.abs(q.y - top) < 0.06 && Math.abs(q.x - p.x) < q.hx + p.hx - 0.02 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.02;
        if (!hosted && !onTop) continue;
        if (q.host !== undefined && ridesHost(q.kind) && hosted) { seen.add(q); out.push(q); continue; } // (riders melt with their host)
        if (q.h <= 0.02 || di.propMatrix(q, M) || di.isDynamicProp(q)) continue; // (loose / dynamic: it falls instead)
        const t = this.byProp.get(q) ?? this.propTarget(q);
        if (!t || t.state !== 'idle' || this.protection(q) !== null) continue;
        seen.add(q);
        out.push(q);
      }
    }
    return out;
  }

  private abort(m: Melt): void {
    m.done = true;
    m.t.state = 'idle';
    m.t.exposure = 0;
    m.t.melt = null;
    m.root = null;
    const i = this.melts.indexOf(m);
    if (i >= 0) this.melts.splice(i, 1);
    this.counts.aborted++;
  }

  /** The melt completes (exactly once): colliders go, resting things fall, contents spill, one salvage each, the record. */
  private complete(m: Melt): void {
    if (m.done) return;
    m.done = true;
    const h = this.host;
    if (m.unit) {
      const u = m.unit, r = u.body.r ?? u.def.radius;
      const stacks: ItemStack[] = [];
      const slots = u.store?.slots;
      if (slots) for (let i = 0; i < slots.length; i++) { const st = slots[i]; if (st) { stacks.push(st); slots[i] = null; } }
      if (u.legacyAmmo > 0 && u.def.slotItem) { // (rounds of a pre-slot record still aside: real stacks of its feed item)
        const max = itemDef(u.def.slotItem).stackMax;
        for (let n = u.legacyAmmo; n > 0;) { const st = h.inv.makeStack(u.def.slotItem, Math.min(n, max)); stacks.push(st); n -= st.count; }
        u.legacyAmmo = 0;
      }
      u.touchStore?.();
      this.spillStacks(stacks, m.base.x, m.base.z, r * 0.75, r * 0.75, m.base.y);
      this.salvage(u.def.plug ? ELECTRICAL_PARTS : SCRAP_METAL, m.base.x, m.base.z, m.base.y);
      this.wakeResting(m.box, m.base.y);
    } else if (m.cart) {
      const c = m.cart, r = (m.box.max.x - m.box.min.x) / 2;
      const cans = Math.floor(c.units / FUEL.canUnits), stacks: ItemStack[] = [];
      for (let n = cans; n > 0;) { const st = h.inv.makeStack(FUEL.canItem, Math.min(n, FUEL.canStackMax)); stacks.push(st); n -= st.count; }
      this.spillStacks(stacks, m.base.x, m.base.z, r * 0.75, r * 0.75, m.base.y);
      this.salvage(SCRAP_METAL, m.base.x, m.base.z, m.base.y);
      this.wakeResting(m.box, m.base.y);
    } else if (m.members.length) {
      this.completeProps(m);
    }
    this.dropVisuals(m);
    for (const mem of m.members) { mem.t.state = 'done'; mem.t.melt = null; }
    m.t.state = 'done';
    m.t.melt = null;
    const i = this.melts.indexOf(m);
    if (i >= 0) this.melts.splice(i, 1);
    this.counts.completed++;
  }

  private completeProps(m: Melt): void {
    const h = this.host, di = h.physics.dynamicItems, L = this.here!.layout;
    // 1. loose-able decor standing on / hosted by a member (still on its support): a body now, awake — it falls once the support goes
    const members = new Set(m.members.map(x => x.prop));
    for (const mem of m.members) {
      const p = mem.prop, pi = mem.index, top = mem.box.max.y;
      for (let qi = 0; qi < L.props.length; qi++) {
        const q = L.props[qi];
        if (members.has(q) || q.cargoGone || q.h <= 0.02 || (q.level ?? 0) !== (p.level ?? 0)) continue;
        const hosted = q.host !== undefined && q.host === pi && pi >= 0;
        const onTop = Math.abs(q.y - top) < 0.08 && q.x > mem.box.min.x - MELT.restPad && q.x < mem.box.max.x + MELT.restPad && q.z > mem.box.min.z - MELT.restPad && q.z < mem.box.max.z + MELT.restPad;
        if (!hosted && !onTop) continue;
        if (!di.isDynamicProp(q)) continue;
        V.set(q.x, q.y + q.h / 2, q.z);
        if (di.shootProp(q, qi, V, DOWN, MELT.nudge)) this.counts.woken++;
      }
    }
    // 2. colliders / sight gone
    for (const mem of m.members) {
      const p = mem.prop;
      p.h = 0;
      p.blocksSight = false;
      p.cargoGone = true;
      this.changed(mem.box.min.x, mem.box.min.z, mem.box.max.x, mem.box.max.z);
    }
    // 3. what rested on it falls: pickups, loose props, shelf filler (a stocked holder's boards out of the filler's way first)
    for (const mem of m.members) {
      const sh = h.stock?.holders.find(x => x.prop === mem.prop);
      if (sh) for (const b of sh.colliders) { b.min.set(b.min.x, FAR, b.min.z); b.max.set(b.max.x, FAR, b.max.z); }
    }
    const filler = h.stock?.filler;
    if (filler) {
      for (const mem of m.members) {
        B.copy(mem.box).expandByScalar(MELT.restPad);
        for (const piece of filler.restingIn(B)) { filler.wake(piece as never, 'support'); this.counts.woken++; }
      }
    }
    this.wakeResting(m.box, m.box.min.y);
    // 4. contents spill + one salvage per member, at valid floor spots under each
    for (const mem of m.members) {
      const b = mem.box, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      if (mem.lots.length) {
        const stacks = mem.lots.map(l => { const st = h.inv.makeStack(l.itemId, l.count); st.count = l.count; return st; }); // (the game's spill rule: same item / count)
        this.spillStacks(stacks, cx, cz, Math.max(0.05, (b.max.x - b.min.x) / 2 - 0.06), Math.max(0.05, (b.max.z - b.min.z) / 2 - 0.06), b.min.y, mem.lots, mem.serial);
      }
      this.salvage(propSalvage(mem.prop.kind), cx, cz, b.min.y);
    }
    // 5. persisted: the generated members gone for good (carried ones were consumed from the prop cargo when they began)
    const w = this.here!;
    let dirty = false;
    for (const mem of m.members) {
      if (mem.gen === undefined || w.rec.gone.some(g => g.i === mem.gen)) continue;
      w.rec.gone.push({i: mem.gen, kind: mem.prop.kind});
      dirty = true;
    }
    if (dirty) {
      w.rec.gone.sort((a, b) => a.i - b.i);
      h.run.setLaneStore(ACID_MELT_LANE, {v: 1, gone: w.rec.gone.map(g => ({i: g.i, kind: g.kind}))}, w.key);
    }
  }

  /** Pickups and loose props resting inside `box` (above its base `y0`, up to its top + MELT.restOver) are woken: they fall. */
  private wakeResting(box: THREE.Box3, y0: number): void {
    const di = this.host.physics.dynamicItems;
    const x0 = box.min.x - MELT.restPad, x1 = box.max.x + MELT.restPad, z0 = box.min.z - MELT.restPad, z1 = box.max.z + MELT.restPad;
    const ylo = y0 + MELT.restLift, yhi = box.max.y + MELT.restOver;
    for (const p of [...this.host.pickups.list]) {
      const o = p.obj.position;
      if (o.x < x0 || o.x > x1 || o.z < z0 || o.z > z1 || o.y < ylo || o.y > yhi) continue;
      if (di.wakePickup(p)) this.counts.woken++;
    }
    let any = false;
    for (const p of this.here?.movers ?? []) if (di.propMatrix(p, M)) { any = true; break; }
    if (!any) return;
    for (const lp of di.loose()) {
      const e = lp.matrix.elements, x = e[12], y = e[13], z = e[14];
      if (x < x0 || x > x1 || z < z0 || z > z1 || y < ylo || y > yhi) continue;
      V.set(x, y + lp.half.y, z);
      if (di.shootProp(lp.prop, lp.index, V, DOWN, MELT.nudge)) this.counts.woken++;
    }
  }

  /**
   * Stacks laid on the floor inside a footprint (centre cx / cz, half extents hx / hz) under a base at y0 — a golden-angle spread, each
   * spot on a real floor under it (Levels.supportAt: never in a wall, never through a slab more than MELT.dropMax below), else the
   * footprint's centre floor, else the base. `lots`: holder lots (their ids kept as provenance).
   */
  private spillStacks(stacks: readonly ItemStack[], cx: number, cz: number, hx: number, hz: number, y0: number, lots?: readonly LotLike[], serial = -1): void {
    const h = this.host, n = stacks.length;
    if (!n) return;
    const c = this.anchor(cx, cz, y0);
    stacks.forEach((st, k) => {
      const a = k * 2.39996 + 0.7, f = n > 1 ? Math.sqrt((k + 0.5) / n) : 0;
      let x = cx + Math.cos(a) * f * hx, z = cz + Math.sin(a) * f * hz;
      let y = this.floorAt(x, z, y0);
      if (y === null) { x = c.x; z = c.z; y = c.y; }
      const lot = lots?.[k];
      if (lot && h.pickups.addAt) h.pickups.addAt(st, M.makeRotationY(a * 1.7).setPosition(x, y + 0.004, z), {holder: serial, lot: lot.id});
      else h.pickups.add(st, x, y + 0.004, z, a * 1.7);
      this.counts.spilled++;
    });
  }

  /** EXACTLY one salvage pickup at a thing's base. */
  private salvage(itemId: string, x: number, z: number, y0: number): void {
    const c = this.anchor(x, z, y0);
    this.host.pickups.add(this.host.inv.makeStack(itemId, 1), c.x, c.y + 0.004, c.z, this.rand() * Math.PI * 2);
    this.counts.salvage++;
  }

  /**
   * A floor spot for a thing's centre: its own floor; failing that (a wall-hung prop whose centre cell is the wall's) the nearest floor
   * around it that the centre can SEE (Levels.lineOfSight: never through a wall into the next room); failing that the base itself.
   */
  private anchor(cx: number, cz: number, y0: number): {x: number; y: number; z: number} {
    const o = this.spot;
    const f = this.floorAt(cx, cz, y0);
    o.x = cx; o.z = cz; o.y = f ?? y0;
    if (f !== null) return o;
    const L = this.host.levels;
    for (const r of [0.3, 0.6, 0.9, 1.3]) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = this.floorAt(x, z, y0);
        if (y === null) continue;
        if (L?.lineOfSight && !L.lineOfSight({x: cx, y: y0 + 0.4, z: cz}, {x, y: y + 0.3, z})) continue;
        o.x = x; o.z = z; o.y = y;
        return o;
      }
    }
    return o;
  }
  private readonly spot = {x: 0, y: 0, z: 0};

  /**
   * The surface under (x, z) for a thing whose base is at y0: the level's floor (null: a wall / nothing within MELT.dropMax below) or, when
   * higher, the top of a standing prop the thing rested on (decor melted on a counter spills / salvages ON the counter — never into the
   * counter's collider on the floor below it). A scan of the placements: a handful of spots per completed melt.
   */
  private floorAt(x: number, z: number, y0: number): number | null {
    const L = this.host.levels;
    if (!L) return null;
    const s = L.supportAt(x, z, y0 + 0.05, MELT.stepMax);
    if (!s || !Number.isFinite(s.floor) || s.floor < y0 - MELT.dropMax || s.floor > y0 + MELT.stepMax) return null;
    let f = s.floor;
    for (const q of this.here?.layout.props ?? []) {
      if (q.h <= 0.02 || q.cargoGone || q.mounted) continue;
      const top = q.y + q.h;
      if (top <= f || top > y0 + 0.06 || Math.abs(x - q.x) > q.hx || Math.abs(z - q.z) > q.hz) continue;
      f = top;
    }
    return f;
  }

  /** physics.propsChanged over a footprint (each static chunk it touches). */
  private changed(x0: number, z0: number, x1: number, z1: number): void {
    const ph = this.host.physics;
    ph.propsChanged((x0 + x1) / 2, (z0 + z1) / 2);
    ph.propsChanged(x0, z0); ph.propsChanged(x1, z0); ph.propsChanged(x0, z1); ph.propsChanged(x1, z1);
  }

  private dropVisuals(m: Melt): void {
    if (m.slot >= 0 && this.slots[m.slot] === m) { this.slots[m.slot] = null; this.shells[m.slot].opacity = 0; }
    if (m.slot >= 0) for (let i = 0; i < MELT.bubbles; i++) this.bubbles.setMatrixAt(m.slot * MELT.bubbles + i, ZERO);
    this.bubbles.instanceMatrix.needsUpdate = true;
    m.slot = -1;
    m.root?.removeFromParent();
    m.root = null;
    for (const g of m.geometries) g.dispose();
    m.geometries.length = 0;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed ^ (this.seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0;
    return ((this.seed >>> 0) % 100000) / 100000;
  }

  /** Dissolve presentation + completion (a frame hook: installAcidMelt registers it). */
  tick(dt: number): void {
    if (!this.melts.length) { if (this.bubbles.visible) this.bubbles.visible = false; return; }
    const step = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    let shown = false;
    for (let k = this.melts.length - 1; k >= 0; k--) {
      const m = this.melts[k];
      if (m.age < 0 || m.done) continue;
      m.age += step;
      if (m.age >= MELT.seconds) { this.complete(m); continue; }
      if (m.slot >= 0) { this.draw(m); shown = true; }
    }
    this.pump();
    this.bubbles.visible = shown;
    if (shown) this.bubbles.instanceMatrix.needsUpdate = true;
  }

  /** One dissolve's look at its age: the acid shell rises, the copy sags / shrinks about its base and fades; bubbles rise off it. */
  private draw(m: Melt): void {
    const t = m.age / MELT.seconds, b = m.base;
    const tint = smooth(0, 0.45, t) * (1 - smooth(0.82, 1, t));
    this.shells[m.slot].opacity = MELT.tint * tint;
    const sy = 1 - (1 - MELT.sag) * smooth(0.22, 1, t), sxz = 1 - (1 - MELT.shrink) * smooth(0.3, 1, t);
    const root = m.root!;
    // about the base: T(b) S T(-b)
    root.matrix.makeScale(sxz, sy, sxz);
    const e = root.matrix.elements;
    e[12] = b.x - sxz * b.x; e[13] = b.y - sy * b.y - 0.01 * smooth(0.6, 1, t); e[14] = b.z - sxz * b.z;
    root.matrixWorldNeedsUpdate = true;
    // bubbles over the footprint, rising from the sagging top's lower half and popping
    const hx = (m.box.max.x - m.box.min.x) / 2, hz = (m.box.max.z - m.box.min.z) / 2, top = (m.box.max.y - b.y) * sy;
    for (let i = 0; i < MELT.bubbles; i++) {
      const o = i * 5, life = (m.age * m.bub[o + 1] + m.bub[o]) % 1;
      const s = m.bub[o + 4] * Math.sin(Math.PI * life) * (1 - smooth(0.85, 1, t)) * smooth(0, 0.15, t);
      V.set(b.x + m.bub[o + 2] * hx * 0.8 * sxz, b.y + Math.min(top, 0.05 + life * Math.max(0.1, top * 0.9 + 0.12)), b.z + m.bub[o + 3] * hz * 0.8 * sxz);
      M.compose(V, Q.identity(), S.set(s, s, s));
      this.bubbles.setMatrixAt(m.slot * MELT.bubbles + i, M);
    }
  }

  /** Every started melt completes now (spill, salvage, persistence), the visuals dropped; exposures reset (section teardown; mid-world safe). */
  clear(): void {
    for (const m of [...this.melts]) {
      if (m.done) continue;
      if (m.age < 0) this.begin(m, -1);
      if (!m.done) this.complete(m);
    }
    for (const m of this.slots) if (m) this.dropVisuals(m);
    this.slots.fill(null);
    for (let i = 0; i < this.bubbles.count; i++) this.bubbles.setMatrixAt(i, ZERO);
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.bubbles.visible = false;
    for (const s of this.shells) s.opacity = 0;
    for (const t of this.targets.values()) t.exposure = 0;
    this.melts.length = 0;
    this.counts.cleared++;
  }

  /** QA: a compact state report. */
  qa(): unknown {
    return {
      melting: this.melts.map(m => ({key: m.t.ref.key, label: m.t.ref.label, age: Math.round(m.age * 100) / 100, slot: m.slot, members: m.members.map(x => x.prop.kind)})),
      gone: this.here?.rec.gone.length ?? 0,
      targets: this.targets.size,
      counts: {...this.counts},
    };
  }
}

/** Create the acid melt and register it into the Game (sets game.acidMelt; installed beside the other lane installs). */
export function installAcidMelt(game: Game): AcidMelt {
  const host: AcidMeltHost = game;
  return new AcidMelt(host).install();
}
