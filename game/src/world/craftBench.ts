// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTING BENCH in the player's train — the fixture in the rear
// compartment opposite the Lockbox (craft/trainFixtures.ts benchPlacement), its look-at prompt, [E] -> the recipe list (ui/craftView.ts)
// and the atomic craft (craft/crafting.ts) that puts a real unit on the car floor (Game.trainEquipment.craft).
//
// installCraftBench(game) is called ONCE from the Game constructor (after the train, the ride and the train equipment); it only
// REGISTERS: sectionHooks (build = attach the bench to the car's view root; teardown = close the view and, unless the riding car keeps
// its view, detach), frameHooks (only while playing: the aim, the open view's close rules and redraw), interactHandlers + promptProviders
// (pushed AFTER the train's and the equipment's, so a door, the Lockbox or a unit under the crosshair keeps its own [E] and prompt),
// inputOwners (the mouse belongs to the open view), hitListeners, stateListeners, the pointer-lock wrap and a keydown capture listener
// (both exactly like the Lockbox view's), warmRegistry pool 'train-bench'. It also installs the chest's store view
// (world/equipmentChestStore.ts), which hangs on the equipment system's `uses.chest`.
//
// FIXTURE (prop rules: an ANCHORED fixture, never loot or cargo; NOT storage — it holds nothing, so it has nothing to open; no loose
// item is part of it: whatever lies on its worktop is an ordinary pickup / cargo item): every train has one. The cooked model
// (assets/trainEquipment.generated.ts TRAIN_EQUIPMENT_MODELS.bench, loaded with the car's other models) is cloned from the prop library
// and mounted at the placement, its +Z front to the aisle; while the library has no model (Node tests, a failed fetch) a plain STAND-IN of
// the measured size stands there instead (a carcass, a worktop slab, a back panel — plain materials), replaced as soon as the model is
// there. Its solid box (to the worktop) is the train's (world/playerTrain.ts trainColliders, world/trainRideLocal.ts): nothing here
// collides. The group is parented to the car's view root, so it rides with the car and is adopted by the next station's build like the
// woodchipper (world/chipper.ts). No lights, no per-frame work while the player is elsewhere (one squared-distance test).
//
// AIM / [E]: the crosshair on the bench's box (its footprint, floor to the top of its fixtures — BENCH_RT.aimLow) in the CAR frame within
// BENCH_RT.reach of the eye, the eye inside the car, no partition wall and nothing of the station in between -> '[E] Crafting bench'.
// A loose item under the crosshair (something lying on the worktop) keeps its own "Take" prompt and [E]: the bench yields to the game's
// pickup target. Usable only while the train is PARKED in a live world, the game plays, the player is alive, not climbing, not using an
// item, and no other lane owns the hands (a carried body / chest, a grabbed cart, an open Lockbox / bag / chest view …: the same
// inputOwners rule as the Skyways car's door). While the train moves there is no prompt and no [E] (v1).
//
// THE VIEW opens WITHOUT pausing (state stays 'playing'; the pointer is released like the Lockbox view's). A row's Craft button runs
// craft/crafting.ts craft() over the four sources — the carried inventory, the worn backpack, the Lockbox, the chests standing in the
// car — and the equipment system (task train-interaction-ux-20261112-063646: there is NO crafting shortcut; while the list is open
// every digit key is swallowed and does nothing). A craft: the list is redrawn with the new counts, a toast + the view's note say
// "Crafted: <Name> — <hint>" (the hint from the unit's traits: carried kinds "hold E to carry it", plug kinds "roll it to a free plug"),
// the cue is the existing pickup sound + the existing metal 'clank' at the bench. A refusal: the note in red + the denied sound,
// nothing changed. It CLOSES on E / Esc / Tab / I / Close (user), a hit, walking away (BENCH_RT.closeRange from the bench's footprint),
// any state but playing, death, the train starting to move, the bench gone, teardown. It redraws when the inventory or the Lockbox
// changes (their versions, every frame) and when the chests' contents or the equipment system's answers change (looked at
// BENCH_RT.refreshS apart: craftBlock may test the floor).
//
// THE ROWS' 3D PREVIEWS (task train-interaction-ux-20261112-063646, lane CRAFT-UI): world/craftPreview.ts registers one source per recipe
// with the inventory's icon pass (ui/itemIcons.ts) — the unit as the live equipment system's look builds it, real models only. The
// bench only says WHEN: its update, while the car stands parked in a live world, costs one integer compare and asks for a render when
// the look's models changed; an open asks again only for a preview still missing. The view redraws when the icon cache reports one.

import * as THREE from 'three';
import type {Game} from '../game';
import {TRAIN_EQUIPMENT_MODELS} from '../assets/trainEquipment.generated';
import {countMaterials, craft, craftSources, type CraftResult, type MaterialSource} from '../craft/crafting';
import {EQUIPMENT, type EquipmentDef, type EquipmentKind} from '../craft/equipment';
import type {EquipmentSystemLike} from '../craft/equipmentApi';
import {RECIPE_MATERIALS, recipeFor} from '../craft/recipes';
import {benchFootprint, benchPlacement, type BenchPlacement} from '../craft/trainFixtures';
import type {Inventory, ItemStack} from '../items/inventory';
import type {WarmupRegistry} from '../render/warmup';
import {CraftView, craftKeyAction, craftModel, type CraftViewModel} from '../ui/craftView';
import {CraftPreviews, type PreviewLook} from './craftPreview';
import {EquipmentChestStore, chestStoreQaApi, installEquipmentChestStore} from './equipmentChestStore';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {TRAIN_VIEW, partitionsOf} from './playerTrainView';
import {rayBox, towerCue, type Box3Like} from './towerShared';

/** Tuning (one place). */
export const BENCH_RT = {
  /** The aim: eye -> the bench's box along the crosshair (m). */
  reach: 1.9,
  /** The aim box's underside over the car floor (m): 0 = the whole bench, its carcass included (its top is the fixtures' top). */
  aimLow: 0,
  /** The open view closes beyond this (m, horizontal) from the bench's footprint, or with the feet this far off the car floor. */
  closeRange: 2.4,
  closeRise: 1.2,
  /** Further than this (m, horizontal) from the bench there is no aim test at all. */
  near: 3.6,
  /** The open view looks at the chests' contents / the equipment system's answers this often (s). */
  refreshS: 0.25,
  /** The stand-in's worktop slab and back panel thickness (m). */
  slab: 0.04,
} as const;

/** Prompt / toast / note texts. */
export const BENCH_TEXT = {
  open: '<b>[E]</b> Crafting bench',
  hit: 'Hit! You let go of the crafting bench',
  far: 'Too far from the crafting bench — it closed',
  /** No equipment system / no train to put a unit into. */
  unavailable: 'The bench cannot build anything here',
  hintCarry: 'hold E to carry it',
  hintPlug: 'roll it to a free plug',
  crafted: (name: string, hint: string) => `Crafted: ${name}${hint ? ` — ${hint}` : ''}`,
} as const;

/** What to do with a freshly crafted unit, from its traits (never a per-kind list). */
export function craftedHint(def: Pick<EquipmentDef, 'move' | 'plug'>): string {
  return def.move === 'carry' ? BENCH_TEXT.hintCarry : def.plug ? BENCH_TEXT.hintPlug : '';
}

export type BenchCloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone';

interface V3 { x: number; y: number; z: number }

/** What the bench needs from Game (structural: tests drive it with a fake host + the real Player / train runtime). */
export interface CraftBenchHost {
  /** Read on every use (Game replaces the inventory on Retry / Load). */
  inv: Inventory;
  player: {x: number; y: number; z: number; alive: boolean; climbing?: unknown};
  camera: THREE.Camera;
  levels?: {raycast(o: V3, d: V3, maxDist: number): {kind: string; t: number}} | null;
  state: string;
  qa?: boolean;
  /** An item use in progress (Game.use). */
  use?: unknown;
  /** The loose item under the crosshair when no `pickupTarget` option is given (fake hosts in tests; Game passes the option). */
  currentTarget?: unknown;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  playerTrain: {lockbox: {slots: (ItemStack | null)[]; version: number}};
  trainEquipment?: EquipmentSystemLike | null;
  trainRuntime?: {
    view: {root: THREE.Object3D} | null;
    train?: {placement: {level: number}} | null;
    spec?: PlayerTrainSpec;
    carLocal(x: number, y: number, z: number): V3 | null;
    carDir(x: number, y: number, z: number): V3 | null;
    carPoint(x: number, y: number, z: number): V3 | null;
  };
  trainRide?: {riding: boolean};
  propModels?: {get(key: string): {scene: THREE.Object3D} | undefined};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  frameHooks: ((dt: number) => void)[];
  interactHandlers: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  stateListeners?: ((s: never, prev: never) => void)[];
  hitListeners?: ((hit: {amount: number}) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  inputOwners?: (() => boolean)[];
  warmRegistry: WarmupRegistry;
  input?: {onLockChange: (locked: boolean) => void; lock(): Promise<boolean>; unlock(): void; readonly locked: boolean} | null;
  gear?: {session?: unknown; cancelReady?(resync: boolean): void; showResume?(): void} | null;
  syncHeld?(): void;
}

export interface CraftBenchOptions {
  /** The cooked model's scene (default: the prop library's TRAIN_EQUIPMENT_MODELS.bench; null = none yet -> the stand-in). */
  model?: () => THREE.Object3D | null;
  /** The loose item under the crosshair (Game's pickup target, passed at install like world/corpses.ts `targets`): the bench yields to it. */
  pickupTarget?: () => unknown;
  /**
   * The recipe rows' 3D previews (world/craftPreview.ts). `look`: the unit views they are rendered from (default: the live equipment
   * system's own `look`; null: none). `refreshIcons`: render ids into the item-icon cache (Game: ui/itemIcons.ts refreshItemIcons with
   * its renderer) — ABSENT in Node tests: nothing is rendered and every row keeps its empty frame. `rendererReady` / `rendererFree`:
   * the renderer is initialised / resolves when no warm-up owns it (absent: ready, free).
   */
  look?: () => PreviewLook | null;
  refreshIcons?: (ids: readonly string[]) => Promise<void> | void;
  rendererReady?: () => boolean;
  rendererFree?: () => Promise<unknown> | null | undefined;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The stand-in: the measured box as a carcass under a worktop slab with a back panel (model frame: bottom centre, +Z front). */
function buildStandIn(b: BenchPlacement): {root: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.Material[]} {
  const root = new THREE.Group();
  root.name = 'train-bench-standin';
  const t = BENCH_RT.slab, top = Math.max(t * 2, Math.min(b.worktopY, b.height));
  const steel = new THREE.MeshStandardMaterial({name: 'train-bench-standin-steel', color: 0x3b4046, roughness: 0.7, metalness: 0.35});
  const wood = new THREE.MeshStandardMaterial({name: 'train-bench-standin-top', color: 0x6b5a45, roughness: 0.82, metalness: 0});
  const carcass = new THREE.BoxGeometry(b.length, top - t, b.depth).translate(0, (top - t) / 2, 0);
  const slab = new THREE.BoxGeometry(b.length, t, b.depth).translate(0, top - t / 2, 0);
  const geos: THREE.BufferGeometry[] = [carcass, slab];
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => { const o = new THREE.Mesh(g, m); o.name = name; o.raycast = () => {}; root.add(o); };
  mk(carcass, steel, 'train-bench-standin-carcass');
  mk(slab, wood, 'train-bench-standin-worktop');
  if (b.height - top > 1e-3) {
    const back = new THREE.BoxGeometry(b.length, b.height - top, t).translate(0, top + (b.height - top) / 2, -b.depth / 2 + t / 2);
    geos.push(back);
    mk(back, steel, 'train-bench-standin-back');
  }
  return {root, geos, mats: [steel, wood]};
}

export class CraftBenchSystem {
  readonly spec: PlayerTrainSpec;
  /** The bench's placement in the car (null: the spec has no rear compartment it fits — then nothing is built). */
  readonly place: BenchPlacement | null;
  /** Train-local root on the car's view root. */
  readonly group = new THREE.Group();
  /** The bench at its placement (the model or the stand-in inside; model frame). */
  readonly fixture = new THREE.Group();
  /** The cooked model's clone (null: none yet). */
  model: THREE.Object3D | null = null;
  /** The stand-in shown while there is no model. */
  standIn: THREE.Group | null = null;
  readonly view: CraftView;
  /** The recipe rows' 3D previews: their icon sources and when they are rendered (world/craftPreview.ts). */
  readonly previews: CraftPreviews;
  /** The chest's store view (world/equipmentChestStore.ts; set by installCraftBench). */
  chestStore: EquipmentChestStore | null = null;
  /** The crosshair is on the bench and it may be opened (this frame). */
  aimed = false;
  /** Counters (QA / tests). */
  readonly counts = {attached: 0, opens: 0, closes: 0, refusedOpen: 0, crafted: 0, refused: 0, cues: 0};
  lastClose: BenchCloseReason | null = null;
  /** The last craft attempt (QA / tests). */
  lastCraft: CraftResult | null = null;
  private modelSrc: THREE.Object3D | null = null;
  private standInParts: {geos: THREE.BufferGeometry[]; mats: THREE.Material[]} | null = null;
  private openFlag = false;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seenInv = -1;
  private seenBox = -1;
  private seenSlow = '';
  private slowT = 0;
  /** The bench's world point (the worktop's centre) of the current build (null: no parked car). */
  private world: V3 | null = null;
  private readonly fp: {x0: number; x1: number; z0: number; z1: number} | null;
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
  private readonly wall: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();

  constructor(readonly host: CraftBenchHost, readonly opts: CraftBenchOptions = {}) {
    this.spec = host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC;
    this.place = benchPlacement(this.spec);
    this.group.name = 'train-bench-group';
    this.fixture.name = 'train-bench';
    this.group.add(this.fixture);
    const b = this.place;
    if (b) {
      this.fixture.position.set(b.x, b.floorY, b.z);
      this.fixture.rotation.set(0, b.yaw, 0);
      const fp = benchFootprint(b);
      this.fp = fp;
      const B = this.box;
      B.min.x = fp.x0; B.max.x = fp.x1; B.min.z = fp.z0; B.max.z = fp.z1;
      B.min.y = b.floorY + BENCH_RT.aimLow; B.max.y = b.floorY + b.height;
    } else this.fp = null;
    this.view = new CraftView({
      model: () => (this.openFlag ? this.listModel() : null),
      craft: kind => { this.craftKind(kind); },
      close: () => this.close('user'),
    });
    this.previews = new CraftPreviews({
      look: () => (opts.look ? opts.look() : (this.host.trainEquipment as {look?: PreviewLook} | null | undefined)?.look ?? null),
      refreshIcons: opts.refreshIcons, rendererReady: opts.rendererReady, rendererFree: opts.rendererFree,
    });
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  // --- registration ----------------------------------------------------------------------------------------------------

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.update(dt));
    h.interactHandlers.push(() => this.interact());
    h.promptProviders?.push(() => this.prompt());
    h.hitListeners?.push(hit => { if (this.openFlag && hit.amount > 0) this.close('hit'); });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') { this.aimed = false; this.close('state'); } }) as (s: never, p: never) => void);
    h.inputOwners?.push(this.ownsInput); // the mouse belongs to the view: no fire / ADS / item use / flare
    h.warmRegistry.addPool('train-bench', () => this.warmRoots());
    this.previews.install(); // one icon source per recipe (rendered by the inventory's icon pass, when the models are there)
    const inp = h.input;
    if (inp) { // the view releases pointer lock WITHOUT pausing (like the Lockbox / bag view)
      const prev = inp.onLockChange;
      inp.onLockChange = locked => {
        if (!locked && (this.ownsPointer || now() < this.lockGraceUntil) && h.state === 'playing') return;
        prev(locked);
      };
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
    return this;
  }

  private readonly ownsInput = (): boolean => this.openFlag;

  // --- the fixture -------------------------------------------------------------------------------------------------------

  /** Parent the bench to the current train view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.place ? this.host.trainRuntime?.view ?? null : null;
    if (!view) { if (this.group.parent) this.group.removeFromParent(); return false; }
    if (this.group.parent !== view.root) {
      view.root.add(this.group);
      this.counts.attached++;
      this.levelMeshes();
    }
    this.ensureModel();
    return true;
  }

  /** The cooked model once the library has it; until then the stand-in (never nothing, never a crash). */
  private ensureModel(): void {
    const b = this.place;
    if (!b) return;
    const src = this.opts.model ? this.opts.model() : this.host.propModels?.get(TRAIN_EQUIPMENT_MODELS.bench.key)?.scene ?? null;
    if (src) {
      if (src === this.modelSrc) return;
      if (this.model) this.fixture.remove(this.model);
      const m = src.clone(true); // (geometry / materials shared with the library: never disposed here)
      m.name = 'train-bench-model';
      m.traverse(o => { o.raycast = () => {}; }); // the collision box is the bench for rays (world/playerTrain.ts statics)
      this.fixture.add(m);
      this.model = m;
      this.modelSrc = src;
      this.dropStandIn();
      this.levelMeshes();
      this.host.atmosphere?.markShadows(m, false);
    } else if (!this.model && !this.standIn) {
      const s = buildStandIn(b);
      this.standIn = s.root;
      this.standInParts = {geos: s.geos, mats: s.mats};
      this.fixture.add(s.root);
      this.levelMeshes();
      this.host.atmosphere?.markShadows(s.root, false);
    }
  }

  private dropStandIn(): void {
    const s = this.standIn, p = this.standInParts;
    if (!s) return;
    this.fixture.remove(s);
    for (const g of p?.geos ?? []) g.dispose();
    for (const m of p?.mats ?? []) m.dispose();
    this.standIn = null;
    this.standInParts = null;
  }

  /** Every mesh of the bench carries the car's level (the culler's tag). */
  private levelMeshes(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  private warmRoots(): THREE.Object3D[] {
    return this.attach() ? [this.group] : [];
  }

  /** The car stands parked in a live world (built, not riding). */
  parked(): boolean {
    return !!this.host.trainRuntime?.train && !this.host.trainRide?.riding;
  }

  /** The bench's world point (the worktop's centre), null without a car. */
  benchWorld(): V3 | null {
    const b = this.place;
    if (!b) return null;
    return this.host.trainRuntime?.carPoint(b.x, b.floorY + b.worktopY, b.z) ?? null;
  }

  // --- lifecycle ---------------------------------------------------------------------------------------------------------

  build(): void {
    this.close('travel');
    this.attach();
    this.world = this.parked() ? this.benchWorld() : null;
  }

  teardown(): void {
    this.close('travel');
    this.aimed = false;
    this.world = null;
    if (this.host.trainRide?.riding && this.group.parent) return; // the riding car keeps its view (and the bench)
    this.group.removeFromParent();
  }

  // --- aim / prompt / [E] ------------------------------------------------------------------------------------------------

  /** Nothing else has the player's hands (alive, not climbing, no item use, no bag view, no other lane's input). */
  handsFree(): boolean {
    const h = this.host, P = h.player;
    return P.alive && !P.climbing && !h.use && !h.gear?.session && !(h.inputOwners ?? []).some(f => f !== this.ownsInput && f());
  }

  /** The bench may be used now: playing, the train parked in a live world, the bench there, the hands free. */
  usable(): boolean {
    return this.host.state === 'playing' && !!this.place && !!this.group.parent && this.parked() && this.handsFree();
  }

  /** A car-frame ray meets a partition wall / doorway head before `maxT` (the open doorway passes). */
  private partitionBlocks(eye: V3, dir: V3, maxT: number): boolean {
    const s = this.spec, hw = s.interior.halfWidth, pt = TRAIN_VIEW.partition / 2, fy = s.floorY, b = this.wall;
    for (const {x, doorway: dw} of partitionsOf(s)) {
      for (let i = 0; i < 3; i++) {
        b.min.x = x - pt; b.max.x = x + pt;
        b.min.z = i === 0 ? -hw : i === 1 ? dw.z1 : dw.z0;
        b.max.z = i === 0 ? dw.z0 : i === 1 ? hw : dw.z1;
        b.min.y = i === 2 ? fy + dw.height : fy;
        b.max.y = s.ceilingY;
        const hit = rayBox(eye, dir, b, maxT);
        if (hit !== null && hit < maxT - 0.01) return true;
      }
    }
    return false;
  }

  /**
   * The crosshair's distance to the bench's box (car frame; the eye inside the car, within reach, no partition and nothing of the
   * station in between), or null: not on it. Geometry only — `usable()` says whether it may be opened.
   */
  aim(): number | null {
    const h = this.host, tr = h.trainRuntime, b = this.place;
    if (!b || !tr?.view || !this.group.parent || !this.parked()) return null;
    const cam = h.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.vEye);
    cam.getWorldDirection(this.vDir);
    const eye = tr.carLocal(this.vEye.x, this.vEye.y, this.vEye.z), dir = tr.carDir(this.vDir.x, this.vDir.y, this.vDir.z);
    if (!eye || !dir) return null;
    const S = this.spec, I = S.interior;
    // the eye inside the car (never through the wall from the track bed or the platform)
    if (!(eye.x > I.x0 && eye.x < I.x1 && Math.abs(eye.z) < I.halfWidth && eye.y > S.floorY && eye.y < S.ceilingY)) return null;
    const t = rayBox(eye, dir, this.box, BENCH_RT.reach);
    if (t === null) return null;
    if (this.partitionBlocks(eye, dir, t)) return null;
    const L = h.levels;
    if (L) {
      const blocked = L.raycast(this.vEye, this.vDir, t + 0.02);
      if (blocked.kind !== 'none' && blocked.t < t - 0.01) return null;
    }
    return t;
  }

  /** A loose item is under the crosshair (the game's pickup target): it keeps its own prompt and [E]. */
  private pickupAimed(): boolean {
    return !!(this.opts.pickupTarget ? this.opts.pickupTarget() : this.host.currentTarget);
  }

  /** The look-at prompt (null: not aimed / not usable / the train moving / a loose item under the crosshair / the view open). */
  prompt(): string | null {
    if (this.openFlag || !this.aimed || this.pickupAimed() || !this.usable()) return null;
    return BENCH_TEXT.open;
  }

  /** E handler (Game.interactHandlers): opens the recipe list when the bench is under the crosshair; true when it took the key. */
  interact(): boolean {
    if (this.openFlag) { this.close('user'); return true; } // (normally the capture listener's: this is the fallback)
    if (!this.usable() || this.pickupAimed() || this.aim() === null) return false;
    return this.open();
  }

  // --- the view ----------------------------------------------------------------------------------------------------------

  private equipment(): EquipmentSystemLike | null {
    return this.host.trainEquipment ?? null;
  }

  /** The four material sources as they are NOW (carried, the worn backpack, the Lockbox, the chests standing in the car). */
  sources(): MaterialSource[] {
    return craftSources({inv: this.host.inv, lockbox: this.host.playerTrain.lockbox, stores: this.equipment()?.storesAboard() ?? []});
  }

  /** Why the equipment system would not take a new unit of `kind` now (null: it would). */
  block(kind: EquipmentKind): string | null {
    const eq = this.equipment();
    if (!eq || !this.parked()) return BENCH_TEXT.unavailable;
    return eq.craftBlock(kind);
  }

  /** The recipe list as it stands (and what the redraw check last saw). */
  private listModel(): CraftViewModel {
    const m = craftModel(this.sources(), kind => this.block(kind));
    this.seenInv = this.host.inv.version;
    this.seenBox = this.host.playerTrain.lockbox.version;
    this.seenSlow = this.slowKey(m);
    this.slowT = 0;
    return m;
  }

  /** Everything the list shows that has no version to watch: each row's button and refusal, each chip's count and where it is. */
  private slowKey(m: CraftViewModel): string {
    let k = '';
    for (const r of m.rows) {
      k += `|${r.can ? 1 : 0}${r.reason}`;
      for (const n of r.needs) k += `;${n.have}:${n.where}`;
    }
    return k;
  }

  /** Open the recipe list ([E] on the bench; QA). Refused when the bench may not be used now. */
  open(): boolean {
    const h = this.host;
    if (this.openFlag) return true;
    if (!this.usable()) { this.counts.refusedOpen++; return false; }
    h.gear?.cancelReady?.(true);
    this.openFlag = true;
    this.ownsPointer = true;
    this.lockGraceUntil = now() + 500;
    if (!h.qa) h.input?.unlock();
    this.lastCraft = null;
    this.previews.opened(); // (only when a preview is still missing: normally they were rendered right after the station was built)
    this.view.show();
    this.counts.opens++;
    return true;
  }

  /** Close the view. A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: BenchCloseReason): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.counts.closes++;
    this.lastClose = reason;
    const h = this.host;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    if (reason === 'hit') h.hud.toast(BENCH_TEXT.hit, true);
    if (reason === 'distance') h.hud.toast(BENCH_TEXT.far, true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** Craft one unit of `kind` from the open list (the row's Craft button, QA). Null: the view is closed. */
  craftKind(kind: EquipmentKind): CraftResult | null {
    if (!this.openFlag) return null;
    const h = this.host, recipe = recipeFor(kind), eq = this.equipment();
    let res: CraftResult;
    if (!recipe || !eq || !this.usable()) res = {ok: false, reason: 'blocked', text: BENCH_TEXT.unavailable};
    else res = craft(recipe, {sources: this.sources(), equipment: eq});
    this.lastCraft = res;
    const sfx = h.sfx as {pickup?(): void; denied?(): void} | null;
    if (res.ok) {
      this.counts.crafted++;
      const def = res.unit.def ?? EQUIPMENT[kind], text = BENCH_TEXT.crafted(def.name, craftedHint(def));
      this.view.say(text, false);
      h.hud.toast(text);
      sfx?.pickup?.();
      const at = this.world ?? this.benchWorld();
      if (at) towerCue(h.sfx, 'clank', at, {rate: 1.15, gain: 1.6});
      this.counts.cues++;
      h.syncHeld?.();
    } else {
      this.counts.refused++;
      if (res.error !== undefined) console.warn('crafting bench: the equipment system failed to build a unit (materials refunded)', res.error);
      this.view.say(res.text, true);
      sfx?.denied?.();
    }
    this.view.render();
    return res;
  }

  // --- per frame ---------------------------------------------------------------------------------------------------------

  /** Per playing frame: the fixture stays on the car, the aim; the open view's close rules and redraw. */
  update(dt: number): void {
    const h = this.host, P = h.player;
    if (!this.attach()) { this.aimed = false; this.close('gone'); return; }
    const parked = this.parked();
    if (parked) this.previews.tick(); // (one compare; a render only when the units' real models arrived / changed)
    if (this.openFlag) {
      this.aimed = false;
      if (!P.alive) { this.close('state'); return; }
      if (!parked) { this.close('travel'); return; }
      const fp = this.fp!, b = this.place!, pl = h.trainRuntime!.carLocal(P.x, P.y, P.z);
      if (!pl) { this.close('gone'); return; }
      const dx = Math.max(fp.x0 - pl.x, 0, pl.x - fp.x1), dz = Math.max(fp.z0 - pl.z, 0, pl.z - fp.z1);
      if (dx * dx + dz * dz > BENCH_RT.closeRange * BENCH_RT.closeRange || Math.abs(pl.y - b.floorY) > BENCH_RT.closeRise) { this.close('distance'); return; }
      // redraw: the inventory / the Lockbox at once, the chests and the equipment system's answers every refreshS
      let stale = h.inv.version !== this.seenInv || h.playerTrain.lockbox.version !== this.seenBox;
      this.slowT += dt;
      if (!stale && this.slowT >= BENCH_RT.refreshS) {
        this.slowT = 0;
        stale = this.slowKey(craftModel(this.sources(), kind => this.block(kind))) !== this.seenSlow;
      }
      if (stale) this.view.render();
      return;
    }
    // closed: the aim, only near the bench of a parked car
    const w = this.world ??= parked ? this.benchWorld() : null;
    if (!parked || !w) { this.aimed = false; if (!parked) this.world = null; return; }
    const ex = P.x - w.x, ez = P.z - w.z;
    this.aimed = ex * ex + ez * ez <= BENCH_RT.near * BENCH_RT.near && h.state === 'playing' && P.alive && this.aim() !== null;
  }

  /** The keydown capture listener while open: E closes, Esc / Tab / I close and go on, every digit is swallowed (no shortcut, no quick slot). */
  onKeyCapture(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopPropagation'>): void {
    const a = craftKeyAction(e, this.openFlag);
    if (a.kind === 'pass') return;
    if (a.kind === 'close-pass') { this.close('state'); return; }
    e.preventDefault();
    e.stopPropagation(); // never reaches player/input.ts ([E] interact, quick slots 1-5, 6)
    if (a.kind === 'close') this.close('user');
  }

  // --- QA ----------------------------------------------------------------------------------------------------------------

  /** QA / tests: a compact state report. */
  qa() {
    const b = this.place, counts = this.place ? countMaterials(this.sources()) : null;
    return {
      placed: !!b, attached: !!this.group.parent, model: !!this.model, standIn: !!this.standIn, parked: this.parked(),
      at: b ? {x: b.x, z: b.z, yaw: b.yaw, side: b.side} : null, size: b ? {l: b.length, h: b.height, d: b.depth, worktopY: b.worktopY} : null,
      aimed: this.aimed, usable: this.usable(), prompt: this.prompt(), open: this.openFlag, lastClose: this.lastClose,
      note: this.view.note, noteBad: this.view.noteBad,
      materials: counts ? Object.fromEntries(RECIPE_MATERIALS.map(m => [m, {total: counts[m].total, carried: counts[m].carried, backpack: counts[m].backpack, lockbox: counts[m].lockbox, chests: counts[m].chests}])) : null,
      rows: this.view.last?.rows.map(r => ({kind: r.kind, can: r.can, reason: r.reason, needs: r.needs.map(n => ({material: n.material, have: n.have, need: n.need, state: n.state}))})) ?? null,
      previews: this.previews.qa(),
      lastCraft: this.lastCraft ? (this.lastCraft.ok ? {ok: true, unit: this.lastCraft.unit.uid} : {ok: false, reason: this.lastCraft.reason, text: this.lastCraft.text}) : null,
      counts: {...this.counts},
    };
  }
}

/** Installs the crafting bench (one call in the Game constructor, after the train, the ride and the train equipment; registries only). */
export function installCraftBench(game: Game, opts: CraftBenchOptions = {}): CraftBenchSystem {
  const bench = new CraftBenchSystem(game as unknown as CraftBenchHost, opts).install();
  // the chest's store view (lane BENCH too): it hangs on the equipment system's `uses.chest`
  bench.chestStore = installEquipmentChestStore(game);
  return bench;
}

/** QA hooks for the lead's short serial browser spot check (to be spread into window.__LL by qa.ts like the chipper's). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function craftBenchQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {craftBench?: CraftBenchSystem; player: {x: number; y: number; z: number; yaw: number; pitch: number; vy: number; grounded: boolean}};
  return {
    /** The bench: placement, model / stand-in, aim, prompt, the open view's rows (+ each chip's have / need), the 3D previews, the material counts per source, the last craft. */
    bench: () => g.craftBench?.qa() ?? null,
    /** Stand in the aisle in front of the bench, looking at its worktop (the prompt shows on the next frame). */
    benchGo: () => {
      const c = g.craftBench, b = c?.place, tr = c?.host.trainRuntime;
      if (!c || !b || !tr) return false;
      const front = b.yaw === 0 ? 1 : -1; // (the model's +Z front in the car frame)
      const at = tr.carPoint(b.x, b.floorY, b.z + front * (b.depth / 2 + 0.55)), aim = tr.carPoint(b.x, b.floorY + b.worktopY, b.z);
      if (!at || !aim) return false;
      const P = g.player;
      P.x = at.x; P.z = at.z; P.y = at.y; P.vy = 0; P.grounded = true;
      P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
      P.pitch = Math.atan2(aim.y - (at.y + 1.62), Math.hypot(aim.x - at.x, aim.z - at.z));
      return true;
    },
    /** Open the recipe list as [E] on the bench would (false: not usable now). */
    benchOpen: () => g.craftBench?.open() ?? false,
    benchClose: () => g.craftBench?.close('user'),
    /** Craft a kind from the open list ('chest' | 'radar' | 'sentry' | 'scanner'): the result ({ok, …}). */
    benchCraft: (kind: EquipmentKind) => {
      const r = g.craftBench?.craftKind(kind) ?? null;
      return r ? (r.ok ? {ok: true, unit: r.unit.uid, kind: r.unit.kind} : {ok: false, reason: r.reason, text: r.text}) : null;
    },
    ...chestStoreQaApi(game),
  };
}
