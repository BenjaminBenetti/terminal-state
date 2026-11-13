// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): THE TRAIN ARMOUR — a permanent one-time upgrade of the player's train.
// User: "Train plating/blades: permanent ONE-TIME 10-scrap_metal upgrade, no durability. Deliver striking all-around Mad Max: Fury
// Road-inspired plating/blades. About 5 seconds of continuous contact kills a regular zombie; contact damage targets zombies ONLY.
// Preserve doors, windows, controls, Save and travel." Answer (final): the permanent armour is a FIXED train fixture (acid-safe: part of
// the car, never a layout / loose prop, crafted equipment or fuel cart).
//
// installTrainArmor(game) is called ONCE from the Game constructor (after the train, the ride, the equipment and the bench) and only
// REGISTERS: sectionHooks (build = attach the kit to the car's view root and sync it; teardown = detach unless the riding car keeps its
// view), frameHooks (a change of the record -> sync; the models' arrival; the zombies-only contact damage while parked; the recipe
// preview's one-time render), warmRegistry pool 'train-armor', the recipe-row preview source 'upgrade:armor' (ui/itemIcons.ts).
//
// THE SEAM (Game.trainUpgrades, run/trainUpgrades.ts TrainUpgradesApi) — the crafting code (the lead's recipe) debits the scrap FIRST, then
// calls install('armor'); a false install() means it refunds:
//   installed(id)   fitted for good (the train record: PlayerTrainRecord.upgrades — saved with the record, NewGame none, Travel keeps it,
//                   Retry / Load / Continue / import exactly as the rest of the train record);
//   block(id)       why it cannot be fitted now: already fitted / no parked car here / the train is moving / an unknown id — else null;
//   install(id)     fits it now: the record, the kit shown, the parked colliders and the riding collision at once.
//
// THE KIT (world/trainArmorLayout.ts: where every piece sits and the contact rule; the lead's cooked Meshy models with their own PBR maps,
// assets/trainArmor.generated.ts, loaded with the car's other models through the prop library): one InstancedMesh per model (8 side
// skirt segments, 2 end ploughs: two draws) under one group parented to the car's view root, so it rides with the car and is adopted by
// the next station's build like the bench / chipper. The meshes are HIDDEN while the armour is not fitted and shown the moment it is; the
// group is a warm pool root, so the warm-up compiles them while hidden (the first frame with armour compiles nothing). No model yet (Node
// tests, a failed fetch): nothing is drawn — never a stand-in — while the colliders / damage still follow the record. Not culler-registered
// (it moves with a riding car; the bench and the chipper are not either); flashlight shadow casters like the bench (markShadows, not
// structure: the library's materials are never changed). Geometry / materials are the library's (never disposed here).
//
// COLLISION: world/playerTrain.ts armorColliders (the parked car: grounded columns in game.propIndex, exact boxes in layout.props — part of
// the car's own boxes, removed with it) and world/trainRideLocal.ts setRideArmorBoxes (the riding car's local model).
//
// CONTACT DAMAGE (zombies only): every frame while the car stands PARKED in a live world (never while riding: the car's frame through the
// runtime's carLocal), each living enemy of game.zombies — never the player, a market person (their own list), a corpse (dead /
// ragdolled), one climbing a ladder or a prop — whose body meets the rule of trainArmorLayout.ts armorContact takes ARMOR_CONTACT.dps x dt
// through its brain (damage(..., {stagger: false}); the hit makes it aware, as any hit). A kill is Game.blastKill (the kill count, the
// death cue, the ragdoll thrown off the blades). The rule: 20 hp/s flat for every enemy — a regular zombie (shambler, 100 hp) dies after
// 5.0 s of continuous contact, a coated one (165 hp) after 8.25 s, a special by its own hp. Feedback: the damage system's own blood puff
// (fx.impact 'flesh') every ARMOR_CONTACT.feedbackS on a body in contact (bounded per frame); no new sound. Cost: O(zombies) a frame, a
// box reject per body before the per-piece test.

import * as THREE from 'three';
import type {Game} from '../game';
import {itemIconUrl, registerIconSource} from '../ui/itemIcons';
import {TRAIN_ARMOR_MODELS} from '../assets/trainArmor.generated';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {ARMOR_CONTACT, armorContact, armorLayout, type ArmorBox, type ArmorLayout, type ArmorPiece} from './trainArmorLayout';
import {setRideArmorBoxes, type RideLocalModel} from './trainRideLocal';
import {TRAIN_UPGRADE_IDS, type TrainUpgradeId, type TrainUpgrades, type TrainUpgradesApi} from '../run/trainUpgrades';

export type {TrainUpgradeId, TrainUpgradesApi} from '../run/trainUpgrades';

/** The recipe row's preview id (ui/itemIcons.ts extra source; the crafting list reads itemIconUrl of it). */
export const ARMOR_PREVIEW_ID = 'upgrade:armor';
/** The preview camera (degrees: azimuth from the kit's +Z front toward +X, elevation): the front plough and the platform-side skirt. */
export const ARMOR_PREVIEW_VIEW = {az: 38, el: 18} as const;

/** block() reasons (plain, short, truthful). */
export const ARMOR_TEXT = {
  fitted: 'The train armour is already fitted',
  noTrain: 'There is no parked train here to fit it to',
  moving: 'Not while the train is moving',
  unknown: 'Unknown train upgrade',
} as const;

/** A missing preview is asked for again at most this often (s, while playing). */
const PREVIEW_RETRY_S = 15;

interface V3 { x: number; y: number; z: number }

/** An enemy as the contact rule reads it (Game's EnemyActor satisfies it). */
export interface ArmorEnemy {
  brain: {
    x: number; y: number; z: number; readonly alive: boolean; readonly climbing?: boolean; stats: {radius: number; height?: number};
    damage(amount: number, fromX: number, fromZ: number, fromY?: number, o?: {stagger?: boolean}): boolean;
  };
  readonly ragdolled?: boolean;
}

/** What the armour needs from Game (structural: tests drive it with a fake host + the real train runtime). */
export interface TrainArmorHost {
  playerTrain: {upgrades: TrainUpgrades};
  trainRuntime?: {
    spec?: PlayerTrainSpec;
    view: {root: THREE.Object3D} | null;
    train: {placement: {level: number}} | null;
    ride?: unknown;
    carLocal(x: number, y: number, z: number): V3 | null;
    carPoint(x: number, y: number, z: number): V3 | null;
    armorBoxes: (() => readonly ArmorBox[] | null) | null;
    armorFitted(): boolean;
    refitArmor(): void;
  } | null;
  trainRide?: {riding: boolean; model?: RideLocalModel} | null;
  propModels?: {get(key: string): {scene: THREE.Object3D} | undefined};
  zombies: readonly ArmorEnemy[];
  /** Game.blastKill: the kill bookkeeping (stats, death cue, ragdoll). */
  blastKill?(z: never, dir: THREE.Vector3, point: THREE.Vector3): void;
  fx?: {impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'flesh', opts?: object): void} | null;
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  warmRegistry: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
}

export interface TrainArmorOptions {
  /** The cooked models' scenes (default: the prop library's TRAIN_ARMOR_MODELS keys; null = not loaded). */
  model?: (kind: 'side' | 'end') => THREE.Object3D | null;
  /** The recipe preview's render (Game: ui/itemIcons.ts refreshItemIcons with its renderer); absent (Node): never rendered. */
  refreshIcons?: (ids: readonly string[]) => Promise<void> | void;
  rendererReady?: () => boolean;
  rendererFree?: () => Promise<unknown> | null | undefined;
}

/** One cooked model's mesh: its geometry / material (the library's) and its transform inside the model's scene. */
interface ModelPart { src: THREE.Object3D; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; rel: THREE.Matrix4 }

/** The first mesh of a cooked model scene (one mesh, one material by the cook's rule), with its node transform in the scene's frame. */
function partOf(scene: THREE.Object3D): ModelPart | null {
  scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  scene.traverse(o => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
  if (!mesh) return null;
  const m = mesh as THREE.Mesh;
  const rel = new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(m.matrixWorld);
  return {src: scene, geometry: m.geometry, material: m.material, rel};
}

const vPos = new THREE.Vector3(), vScale = new THREE.Vector3(), qRot = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);

/** A piece's instance matrix (car frame): T(pos) . R_y(yaw) . S(scale) . the model node's own transform. */
export function pieceMatrix(p: ArmorPiece, rel: THREE.Matrix4 | null = null, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.compose(vPos.set(p.pos[0], p.pos[1], p.pos[2]), qRot.setFromAxisAngle(yAxis, p.yaw), vScale.set(p.scale[0], p.scale[1], p.scale[2]));
  if (rel) out.multiply(rel);
  return out;
}

export class TrainArmorSystem implements TrainUpgradesApi {
  readonly spec: PlayerTrainSpec;
  readonly layout: ArmorLayout;
  /** The kit's root on the car's view root (car frame). */
  readonly group = new THREE.Group();
  /** The side skirt segments / the end ploughs (null until their model is loaded). */
  sideMesh: THREE.InstancedMesh | null = null;
  endMesh: THREE.InstancedMesh | null = null;
  /** Counters (QA / tests). */
  readonly counts = {installs: 0, refused: 0, syncs: 0, refits: 0, contactFrames: 0, damage: 0, kills: 0, fx: 0, previews: 0};
  /** The last block() reason install() met (QA). */
  lastRefusal: string | null = null;
  private parts: {side: ModelPart | null; end: ModelPart | null} = {side: null, end: null};
  /** Bumped when a model arrives / changes (the preview renders once per generation). */
  private modelGen = 0;
  private seenVersion = -1;
  /** What the riding car's local model carries (null: never set). */
  private rideFitted: boolean | null = null;
  /** Seconds since a body's last blood puff (absent: none in contact). */
  private fxClock = new WeakMap<object, number>();
  private previewAsked = -1;
  private previewT = 0;
  private previewRun: Promise<void> | null = null;
  private unregister: (() => void) | null = null;
  private readonly mtx = new THREE.Matrix4();
  private readonly vHit = new THREE.Vector3();
  private readonly vN = new THREE.Vector3();

  constructor(readonly host: TrainArmorHost, readonly opts: TrainArmorOptions = {}) {
    this.spec = host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC;
    this.layout = armorLayout(this.spec);
    this.group.name = 'train-armor';
  }

  private get record(): TrainUpgrades {
    return this.host.playerTrain.upgrades;
  }

  /** The armour is fitted to the run's train. */
  get fitted(): boolean {
    return this.record.has('armor');
  }

  // --- registration ----------------------------------------------------------------------------------------------------

  install(): this;
  install(id: TrainUpgradeId): boolean;
  /** No argument: register into the host (once, from installTrainArmor). With an id: THE SEAM — fit it now (see the file header). */
  install(id?: TrainUpgradeId): this | boolean {
    if (id !== undefined) return this.fit(id);
    const h = this.host;
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.update(dt));
    h.warmRegistry.addPool('train-armor', () => this.warmRoots());
    if (h.trainRuntime) h.trainRuntime.armorBoxes = () => (this.fitted ? this.layout.boxes : null);
    this.unregister ??= registerIconSource(ARMOR_PREVIEW_ID, {build: () => this.previewObject(), view: ARMOR_PREVIEW_VIEW});
    return this;
  }

  dispose(): void {
    this.unregister?.();
    this.unregister = null;
  }

  // --- the seam (TrainUpgradesApi) ----------------------------------------------------------------------------------------

  installed(id: TrainUpgradeId): boolean {
    return this.record.has(id);
  }

  block(id: TrainUpgradeId): string | null {
    if (!(TRAIN_UPGRADE_IDS as readonly string[]).includes(id)) return ARMOR_TEXT.unknown;
    if (this.record.has(id)) return ARMOR_TEXT.fitted;
    const rt = this.host.trainRuntime;
    if (rt?.ride || this.host.trainRide?.riding) return ARMOR_TEXT.moving;
    if (!rt?.train) return ARMOR_TEXT.noTrain;
    return null;
  }

  private fit(id: TrainUpgradeId): boolean {
    const why = this.block(id);
    if (why || !this.record.fit(id)) {
      this.lastRefusal = why ?? ARMOR_TEXT.fitted;
      this.counts.refused++;
      return false;
    }
    this.lastRefusal = null;
    this.counts.installs++;
    this.sync();
    return true;
  }

  // --- the kit -------------------------------------------------------------------------------------------------------------

  /** Parent the kit to the car's current view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.host.trainRuntime?.view ?? null;
    if (!view) { if (this.group.parent) this.group.removeFromParent(); return false; }
    if (this.group.parent !== view.root) { view.root.add(this.group); this.levelMeshes(); }
    this.ensureMeshes();
    return true;
  }

  private modelScene(kind: 'side' | 'end'): THREE.Object3D | null {
    return this.opts.model ? this.opts.model(kind) : this.host.propModels?.get(TRAIN_ARMOR_MODELS[kind].key)?.scene ?? null;
  }

  /** The instanced meshes from the cooked models once the library has them (rebuilt only when a model object changes). */
  private ensureMeshes(): void {
    for (const kind of ['side', 'end'] as const) {
      const src = this.modelScene(kind), had = this.parts[kind];
      if (src === (had?.src ?? null)) continue;
      const part = src ? partOf(src) : null;
      this.parts[kind] = part;
      this.modelGen++;
      const old = kind === 'side' ? this.sideMesh : this.endMesh;
      if (old) { this.group.remove(old); old.dispose(); } // (the InstancedMesh's own instance buffer only: geometry / material are the library's)
      let im: THREE.InstancedMesh | null = null;
      if (part) {
        const pieces = this.layout.pieces.filter(p => p.kind === kind);
        im = new THREE.InstancedMesh(part.geometry, part.material, pieces.length);
        im.name = `train-armor-${kind}`;
        pieces.forEach((p, i) => im!.setMatrixAt(i, pieceMatrix(p, part.rel, this.mtx)));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingBox();
        im.computeBoundingSphere();
        im.raycast = () => {}; // the car's armour boxes are the kit for rays (world/playerTrain.ts armorColliders)
        im.visible = this.fitted;
        this.group.add(im);
        this.host.atmosphere?.markShadows(im, false);
      }
      if (kind === 'side') this.sideMesh = im; else this.endMesh = im;
      if (im) this.levelMeshes();
    }
  }

  /** Every mesh of the kit carries the car's level (the culler's tag). */
  private levelMeshes(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  private warmRoots(): THREE.Object3D[] {
    return this.attach() && (this.sideMesh || this.endMesh) ? [this.group] : [];
  }

  /** The kit is drawn now (fitted and at least one model loaded, on the car). */
  get shown(): boolean {
    return !!this.group.parent && [this.sideMesh, this.endMesh].some(m => !!m && m.visible);
  }

  /** Bring everything in line with the record: the meshes' visibility, the parked car's colliders, the riding car's collision. */
  sync(): void {
    const fitted = this.fitted, h = this.host;
    this.counts.syncs++;
    this.seenVersion = this.record.version;
    this.ensureMeshes();
    for (const m of [this.sideMesh, this.endMesh]) if (m) m.visible = fitted;
    const rt = h.trainRuntime;
    if (rt?.train && rt.armorFitted() !== fitted) { rt.refitArmor(); this.counts.refits++; }
    const model = h.trainRide?.model;
    if (model && this.rideFitted !== fitted) { setRideArmorBoxes(model, fitted ? this.layout.boxes : null); this.rideFitted = fitted; }
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------------------

  build(): void {
    this.fxClock = new WeakMap();
    if (this.attach()) this.levelMeshes(); // (an adopted view keeps the group: the new level's tag)
    this.sync();
  }

  teardown(): void {
    this.fxClock = new WeakMap();
    if (this.host.trainRide?.riding && this.group.parent) return; // the riding car keeps its view (and its armour)
    this.group.removeFromParent();
  }

  update(dt: number): void {
    if (this.record.version !== this.seenVersion) this.sync();
    if (this.group.parent) this.ensureMeshes(); // (a model that arrived after the build: two lookups)
    this.tickPreview(dt);
    if (this.fitted) this.contact(dt);
  }

  // --- contact damage --------------------------------------------------------------------------------------------------------

  /** The car stands parked in a live world (built, not riding). */
  parked(): boolean {
    const rt = this.host.trainRuntime;
    return !!rt?.train && !rt.ride && !this.host.trainRide?.riding;
  }

  /** One frame of the contact rule (see the file header). */
  contact(dt: number): void {
    const h = this.host, rt = h.trainRuntime;
    if (!(dt > 0) || !rt || !this.parked()) return;
    const C = ARMOR_CONTACT, S = this.spec;
    const nearX = S.length / 2 + 1.5, nearZ = S.width / 2 + 1.5;
    let puffs = 0;
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || b.climbing || z.ragdolled) continue;
      const q = rt.carLocal(b.x, b.y, b.z);
      if (!q || Math.abs(q.x) > nearX || Math.abs(q.z) > nearZ) continue; // the cheap reject
      const hit = armorContact(this.layout, q.x, q.y, q.z, b.stats.radius, b.stats.height ?? C.height);
      if (!hit) { this.fxClock.delete(z); continue; }
      // the outward normal in world space (the car's frame: exact for the parked yaws) and the body's side facing the blades
      const o = rt.carPoint(0, 0, 0)!, e = rt.carPoint(hit.nx, 0, hit.nz)!;
      const nx = e.x - o.x, nz = e.z - o.z, r = b.stats.radius, hy = rt.carPoint(0, hit.y, 0)!.y;
      const amount = C.dps * dt;
      this.counts.contactFrames++;
      this.counts.damage += Math.min(amount, (b as {hp?: number}).hp ?? amount);
      const p = rt.carPoint(hit.x, hit.y, hit.z)!;
      if (b.damage(amount, p.x, p.z, p.y, {stagger: false})) {
        this.counts.kills++;
        this.fxClock.delete(z);
        h.blastKill?.(z as never, new THREE.Vector3(nx, 0.35, nz).normalize(), new THREE.Vector3(b.x - nx * r, hy, b.z - nz * r));
        continue;
      }
      const t = (this.fxClock.get(z) ?? C.feedbackS) + dt;
      if (t >= C.feedbackS && puffs < C.maxFx && h.fx) {
        // the damage system's blood on the body's side facing the blades, spraying away from them (impact normal = the body's surface)
        h.fx.impact(this.vHit.set(b.x - nx * r, hy, b.z - nz * r), this.vN.set(-nx, 0, -nz), 'flesh');
        this.counts.fx++;
        puffs++;
        this.fxClock.set(z, 0);
      } else this.fxClock.set(z, t);
    }
  }

  // --- the recipe row's preview ('upgrade:armor') ------------------------------------------------------------------------------

  /**
   * A FRESH object of the fitted kit for the icon pass: the front plough and the platform-side cab skirt segment, posed as on the car and
   * turned so the car's front faces +Z (the camera sees the plough's blades and the skirt down the side). Real models only: null while
   * either is not loaded (the row keeps its empty frame — never a proxy).
   */
  previewObject(): THREE.Object3D | null {
    const side = this.parts.side ?? (this.modelScene('side') ? partOf(this.modelScene('side')!) : null);
    const end = this.parts.end ?? (this.modelScene('end') ? partOf(this.modelScene('end')!) : null);
    if (!side || !end) return null;
    const plough = this.layout.pieces.find(p => p.kind === 'end' && p.dir > 0);
    const skirt = this.layout.pieces.filter(p => p.kind === 'side' && p.dir < 0).sort((a, b) => b.box.x1 - a.box.x1)[0];
    if (!plough || !skirt) return null;
    const g = new THREE.Group();
    g.name = 'train-armor-preview';
    for (const [piece, part] of [[plough, end], [skirt, side]] as const) {
      const m = new THREE.Mesh(part.geometry, part.material);
      m.matrixAutoUpdate = false;
      pieceMatrix(piece, part.rel, m.matrix);
      g.add(m);
    }
    g.rotation.y = -Math.PI / 2; // the car's +X (front) -> +Z
    return g;
  }

  /** Render the preview once per model generation (and retry a missing one now and then); never without a renderer (Node). */
  private tickPreview(dt: number): void {
    const o = this.opts, refresh = o.refreshIcons;
    if (!refresh || this.previewRun || !this.parts.side || !this.parts.end) return;
    this.previewT += dt;
    const missing = !itemIconUrl(ARMOR_PREVIEW_ID);
    if (this.previewAsked === this.modelGen && !(missing && this.previewT >= PREVIEW_RETRY_S)) return;
    if (o.rendererReady && !o.rendererReady()) return;
    this.previewAsked = this.modelGen;
    this.previewT = 0;
    this.counts.previews++;
    this.previewRun = (async () => {
      try {
        for (let free = o.rendererFree?.(); free; free = o.rendererFree?.()) await free.catch(() => undefined);
        await refresh([ARMOR_PREVIEW_ID]);
      } catch (err) {
        console.warn('train armour: the recipe preview could not be rendered (its frame stays empty)', err);
      } finally {
        this.previewRun = null;
      }
    })();
  }

  // --- QA ----------------------------------------------------------------------------------------------------------------------

  qa() {
    const rt = this.host.trainRuntime;
    return {
      fitted: this.fitted, block: this.block('armor'), shown: this.shown, attached: !!this.group.parent,
      models: {side: !!this.parts.side, end: !!this.parts.end}, pieces: {side: this.layout.pieces.filter(p => p.kind === 'side').length, end: this.layout.pieces.filter(p => p.kind === 'end').length},
      colliders: rt?.armorFitted() ?? false, ride: this.rideFitted, parked: this.parked(), preview: !!itemIconUrl(ARMOR_PREVIEW_ID),
      lastRefusal: this.lastRefusal, counts: {...this.counts, damage: Math.round(this.counts.damage)},
    };
  }
}

/** Installs the train armour (one call in the Game constructor, after the train, the ride, the equipment and the bench; registries only). */
export function installTrainArmor(game: Game, opts: TrainArmorOptions = {}): TrainArmorSystem {
  return new TrainArmorSystem(game as unknown as TrainArmorHost, opts).install();
}

/** QA hooks for the lead's short serial browser spot check (spread into window.__LL by qa.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trainArmorQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {trainArmor?: TrainArmorSystem};
  return {
    /** The armour: fitted / shown / models / colliders / riding collision / preview, the contact counters, block('armor'). */
    trainArmor: () => g.trainArmor?.qa() ?? null,
    /** QA only: fit the armour through the seam WITHOUT a craft (the result of install('armor'), false + lastRefusal when blocked). */
    trainArmorFit: () => g.trainArmor?.install('armor') ?? null,
  };
}
