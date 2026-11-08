// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train's FUEL CAP (refuel with fuel cans) and the HUD fuel readout.
//
// installFuelPort(game) is called ONCE from the Game constructor (after installGasMask); like installGear / installGasMask it only
// REGISTERS into the Game's registries:
// - frameHooks: the cap's aim (crosshair on the cap within PORT.reach, eye outside the car on the platform side, nothing in between),
//   the timed POUR (progress, cancel rules, completion), the cap's aim glow and the HUD fuel readout (near / aboard the train);
// - interactHandlers: [E] on the aimed cap starts a pour or says why not — the press is consumed ONLY while the cap is the aim target;
//   pointerHandlers: a left click with a fuel can in the hand on the aimed cap does the same (the press is consumed / latched by Game),
//   and while a pour runs EVERY left press is the pour's (task fuel-feedback: it never fires a gun the moment the pour ends);
// - promptProviders: the cap's prompt (only while aimed) and the pour's progress; inputOwners: no fire / ADS / item use / flare while
//   pouring; hitListeners: a hit cancels the pour; stateListeners: leaving 'playing' (pause, Tab, death, travel) cancels it;
// - sectionHooks: teardown cancels the pour (the car goes); warmRegistry pool 'fuel-port': the cap (attached to the car, with the hidden
//   pour view inside it) and a hidden fuel-can prototype (a dropped can never compiles cold).
//
// THE CAP (visible fixture): a small recessed housing plate, a filler neck and a screw cap (procedural, plain-colour materials: a fixture
// of the existing train model, no textures) at fuel/trainPort.ts fuelPortLocal() on the platform-side (-Z) outer skin, a child of the
// train view's root (world/playerTrain.ts PlayerTrainRuntime.view: the parked car, or the riding car's held view) — it moves with the
// car. Attached lazily (the train's own build runs after this system's hooks): every frame / warm-up re-parents it to the current view.
//
// POUR (E or a held can + left click at the aimed cap): refused with a short toast and nothing used when the car is moving ("Not while
// moving"), the tank is full ("The tank is full — 1 tank"), or no fuel can is at hand ("No fuel can"). Otherwise a FUEL_PORT.pourS timed
// pour runs (the prompt shows its progress; sfx.fuelPour): walking out of reach, looking off the cap for longer than awayGraceS, a hit,
// sprinting, a menu / pause / input clear, climbing, death, the car moving or a section teardown CANCEL it with nothing used
// (sfx.stopFuelPour). At the end the rules are re-checked (the tank may have been filled meanwhile, the can dropped), then EXACTLY ONE
// `fuel_can` is taken — the can in the hand first (the selected quick slot), else Inventory.take (pockets, quick slots, grenade / melee
// slot: never a worn backpack's contents) — and the tank gains FUEL.canUnits. Not routed through the consumable use (startUse /
// consumeReturn / lmbLatch are untouched: fuel_can is a 'supply').
//
// VISIBLE POUR (task studio-beta-fuel-feedback-20261106-064128-01, lane POUR; the user: "See an animation of the can being poured into
// train"): world/fuelPourView.ts — while the pour runs, a world-space copy of the can is lifted from where the held can sits, tipped
// over the uncapped neck (the screw cap comes off, the neck's opening shows) pouring an amber stream, and swung back to the hand. It
// runs on the pour's own clock (the one can is used only at the real completion); completion and every cancel remove it at once (cap
// back on); meanwhile the viewmodel's held can is hidden (no duplicate; the inventory selection is never touched) and comes back after.
// Both paths (E with the can in pockets / quick slots, a held can + left click) show the same pour.
//
// HELD VIEW: a fuel can in the selected quick slot is held in front of you (the delivered GLB, world/fuelCanModel.ts): this system
// adds it to the viewmodel once per build (Viewmodel.addHeldItem, before the warm-up, like the readied backpack) and Game.syncHeld shows
// a SUPPLY that has a registered held model (only the fuel can). It never becomes a consumable use (no startUse / consume view).
// The model loads with the boot assets (preloadFuelCanModel: started here, awaited by Game.load before item templates / icons).
//
// HUD (ui/hud.ts setFuel; DOM written only on change): shown while the player is inside or within FUEL_PORT.hudNear of the parked car,
// and while riding — the tank as four quarter pips + "Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)" (fuel/fuel.ts reservesOf: the
// train chest = the Lockbox's slots, carts = game.fuelCarts?.aboard?.(), optional: the cart system may be absent).

import * as THREE from 'three';
import type {Game} from '../game';
import {FUEL, reservesOf, tanksText, type CartFuel, type FuelReserves} from '../fuel/fuel';
import {PORT, fuelPortLocal} from '../fuel/trainPort';
import {PLAYER_TRAIN_SPEC} from './playerTrainSpec';
import {makeSupplyMesh} from './pickups';
import {preloadFuelCanModel} from './fuelCanModel';
import {FuelPourView, POUR_VIEW} from './fuelPourView';
import {itemDims} from '../items/items';
import type {ItemStack} from '../items/inventory';

/**
 * The held can's hand pose for a can `h` m tall (viewmodel camera space, the model centred on its holder): low right, front (+Z) to
 * the eye. Proportional to the can's height, so the framing tuned for the first 0.47 m can (hip ~[0.24, -0.43, -0.72]) holds for the
 * smaller medpack-size can (task fuel-feedback, lane ASSET): the same share of the can shows above the screen's lower edge.
 */
export function heldCanPose(h: number): {hip: readonly [number, number, number]; yaw: number; pitch: number; roll: number} {
  return {hip: [0.5 * h, -0.86 * h, -1.55 * h], yaw: -0.35, pitch: 0.08, roll: 0.04};
}

/** Tuning (one place). */
export const FUEL_PORT = {
  /**
   * One can's pour (s). Task fuel-feedback (lane POUR): 1.6 -> 2.4 so the VISIBLE pour (world/fuelPourView.ts: lift 0.55 + tilt 0.3 +
   * pour 1.1 + settle 0.45) reads, close to the 2.58 s pour sound.
   */
  pourS: 2.4,
  /** The HUD readout shows within this distance (m) of the parked car's outline (and inside / riding). */
  hudNear: 6,
  /** A pour survives the crosshair drifting off the cap this long (s; arm-injury sway, a glance). */
  awayGraceS: 0.35,
  /** A pour stops when the eye is farther than PORT.reach + this from the cap (m). */
  reachSlack: 0.3,
  /** The cap's aim box (train-local, around fuelPortLocal()): half extents along the car (x) / up (y), and how far out / in (z). */
  aim: {hx: 0.13, hy: 0.1, out: 0.12, in: 0.04},
  /** The held can's hand pose (heldCanPose for ITEM_DIMS.fuel_can; task fuel-feedback: re-tuned for the smaller can by its height). */
  held: heldCanPose(itemDims(FUEL.canItem).h),
  /** The viewmodel camera's field of view (weapons/viewmodel.ts) when the Game has none (Node shells): the hand pose's re-projection. */
  viewmodelFov: 54,
  /** The visible fixture (m): housing plate, filler neck, cap. */
  part: {plateW: 0.2, plateH: 0.14, plateD: 0.05, plateInset: 0.02, neckR: 0.034, neckLen: 0.05, capR: 0.046, capLen: 0.03},
} as const;

/** The filler neck's open (outer) end, train-local — where the poured stream goes in (the cap screws on there). */
export function fuelNeckMouthLocal(spec = PLAYER_TRAIN_SPEC): {x: number; y: number; z: number} {
  const L = fuelPortLocal(spec), P = FUEL_PORT.part;
  return {x: L.x, y: L.y, z: -spec.width / 2 + P.plateInset - P.plateD - P.neckLen + 0.005};
}

/** The HUD readout (ui/hud.ts setFuel). */
export interface FuelHudView {
  /** Quarter pips lit (0..FUEL.trainTankUnits: two tanks of four). */
  pips: number;
  /** The tank in quarter units. */
  tank: number;
  /** "Fuel ¾ tank · aboard +2 tanks (chest 1, carts 1)". */
  text: string;
  /** Not enough aboard for one hop (amber). */
  low: boolean;
}

/** "1", "¾", "1½", "2" — a quarter-unit amount as a tank count (no word). */
export function tankCount(u: number): string {
  const n = Math.max(0, Math.floor(u)), whole = Math.floor(n / FUEL.tankUnits), q = n % FUEL.tankUnits;
  const frac = q === 0 ? '' : q === 1 ? '¼' : q === 2 ? '½' : '¾';
  return whole ? `${whole}${frac}` : frac || '0';
}

/** The HUD readout from the live sources (pure). */
export function fuelReadout(tank: number, cartsAboard: readonly CartFuel[], chest: readonly (ItemStack | null)[]): FuelHudView & {reserves: FuelReserves} {
  const r = reservesOf(tank, cartsAboard, chest);
  const extra = r.chest + r.carts;
  const parts = [r.chest ? `chest ${tankCount(r.chest)}` : '', r.carts ? `carts ${tankCount(r.carts)}` : ''].filter(Boolean);
  const text = `Fuel ${tanksText(r.tank)}${extra ? ` · aboard +${tanksText(extra)} (${parts.join(', ')})` : ''}`;
  return {pips: Math.max(0, Math.min(FUEL.trainTankUnits, Math.floor(r.tank))), tank: r.tank, text, low: r.total < FUEL.hopUnits, reserves: r};
}

/** Ray (origin o, unit direction d) vs an axis-aligned box: entry distance within [0, maxT], or null. */
export function rayBoxT(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, min: {x: number; y: number; z: number}, max: {x: number; y: number; z: number}, maxT: number): number | null {
  let t0 = 0, t1 = maxT;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return null; continue; }
    let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

type CancelReason = 'away' | 'hit' | 'sprint' | 'menu' | 'riding' | 'busy' | 'teardown';
/** What a press at the cap did. */
export type FuelPress = 'pouring' | 'full' | 'no-can' | 'riding' | 'busy' | 'ignored';

interface V3 { x: number; y: number; z: number }
/** The train runtime as used here (world/playerTrain.ts PlayerTrainRuntime; structural for Node shells). */
interface TrainLike {
  view: {root: THREE.Object3D} | null;
  train?: {placement: {level: number}} | null;
  carLocal(x: number, y: number, z: number): V3 | null;
  carDir(x: number, y: number, z: number): V3 | null;
  carPoint(x: number, y: number, z: number): V3 | null;
}
/** Game parts read lazily (installed later than this system, optional in Node shells). */
interface HostExtras {
  trainRuntime?: TrainLike;
  trainRide?: {riding: boolean};
  levels?: {raycast(o: V3, d: V3, max: number): {kind: string; t: number}} | null;
  consumeView?: {busy: boolean};
  gasMask?: {transitioning: boolean};
  gear?: {readied?: boolean};
  pointerHandlers?: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  inputOwners?: (() => boolean)[];
  stateListeners?: ((s: string, prev: string) => void)[];
}

export class FuelPortSystem {
  /** The visible cap (housing, neck, screw cap), parented to the train view's root while a car exists. */
  readonly cap = new THREE.Group();
  /** The crosshair is on the cap (within reach, unobstructed) this frame. */
  aimed = false;
  /** The running pour (null: none). */
  pour: {t: number; total: number; clears: number; away: number} | null = null;
  /** Counters (QA / tests). */
  readonly counts = {pours: 0, refused: 0, cancelled: 0, attached: 0};
  /** Why the last pour was cancelled (QA / tests). */
  lastCancel: CancelReason | null = null;
  /** The readout last handed to the HUD (null: hidden) — QA / tests. */
  hud: FuelHudView | null = null;
  private hudKey = '';
  private readonly local = fuelPortLocal(PLAYER_TRAIN_SPEC);
  private readonly capMat: THREE.MeshStandardMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private proto: THREE.Object3D | null = null;
  private time = 0;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  /** Task fuel-feedback (lane POUR): the visible pour (world/fuelPourView.ts; built lazily after the boot assets, then kept). */
  pourView: FuelPourView | null = null;
  /** The viewmodel's held can (this system's object inside the viewmodel holder): hidden while the world-space can pours. */
  heldObj: THREE.Object3D | null = null;
  /** The screw cap + its grip (off while pouring) and the neck's opening (shown instead). */
  private readonly screwCap: THREE.Mesh[] = [];
  private opening: THREE.Mesh | null = null;
  private readonly vHand = new THREE.Vector3();
  private readonly vAxis = new THREE.Vector3();
  private readonly qCam = new THREE.Quaternion();
  private readonly qHeld = new THREE.Quaternion().setFromEuler(new THREE.Euler(FUEL_PORT.held.pitch, FUEL_PORT.held.yaw, FUEL_PORT.held.roll));
  private readonly mBasis = new THREE.Matrix4();
  private readonly basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;

  constructor(private readonly game: Game) {
    this.cap.name = 'train-fuel-cap';
    const P = FUEL_PORT.part, L = this.local;
    // plain painted-steel fixture (no textures): dark housing, steel neck, a yellow screw cap the eye finds on the grey skin
    const plateMat = new THREE.MeshStandardMaterial({name: 'fuel-cap-housing', color: 0x34383b, roughness: 0.6, metalness: 0.5});
    const neckMat = new THREE.MeshStandardMaterial({name: 'fuel-cap-neck', color: 0x6b6f72, roughness: 0.4, metalness: 0.7});
    this.capMat = new THREE.MeshStandardMaterial({name: 'fuel-cap-cap', color: 0xc99a1e, roughness: 0.5, metalness: 0.3, emissive: 0x4a3608, emissiveIntensity: 0});
    // the train-local frame at the cap: +x along the car, +y up, -z outward (the platform side)
    const skin = -PLAYER_TRAIN_SPEC.width / 2;
    const plate = new THREE.BoxGeometry(P.plateW, P.plateH, P.plateD);
    plate.translate(0, 0, skin + P.plateInset - P.plateD / 2 - L.z); // back face inside the skin by plateInset (no gap on a curved shell)
    const neck = new THREE.CylinderGeometry(P.neckR, P.neckR, P.neckLen, 14);
    neck.rotateX(Math.PI / 2);
    const plateFront = skin + P.plateInset - P.plateD - L.z;
    neck.translate(0, 0, plateFront - P.neckLen / 2 + 0.005);
    const capG = new THREE.CylinderGeometry(P.capR, P.capR, P.capLen, 16);
    capG.rotateX(Math.PI / 2);
    capG.translate(0, 0, plateFront - P.neckLen - P.capLen / 2 + 0.008);
    const tab = new THREE.BoxGeometry(P.capR * 1.5, 0.014, 0.012); // the cap's grip bar
    tab.translate(0, 0, plateFront - P.neckLen - P.capLen + 0.004);
    // (task fuel-feedback, lane POUR) the neck's dark opening, shown while the screw cap is off for a pour (the housing's material)
    const hole = new THREE.CircleGeometry(P.neckR * 0.72, 14);
    hole.rotateY(Math.PI); // faces out (-z)
    hole.translate(0, 0, plateFront - P.neckLen + 0.005 - 0.0015);
    this.geos.push(plate, neck, capG, tab, hole);
    for (const [g, m, name] of [[plate, plateMat, 'fuel-cap-housing'], [neck, neckMat, 'fuel-cap-neck'], [capG, this.capMat, 'fuel-cap-cap'], [tab, this.capMat, 'fuel-cap-grip'], [hole, plateMat, 'fuel-cap-opening']] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name;
      this.cap.add(mesh);
      if (name === 'fuel-cap-cap' || name === 'fuel-cap-grip') this.screwCap.push(mesh);
      if (name === 'fuel-cap-opening') { this.opening = mesh; mesh.visible = false; }
    }
    this.cap.position.set(L.x, L.y, L.z);
  }

  private get host(): Game & HostExtras {
    return this.game as Game & HostExtras;
  }

  // --- registration --------------------------------------------------------------------------------------------------

  install(): this {
    const g = this.host;
    void preloadFuelCanModel(); // the GLB download overlaps the boot assets (Game.load awaits it before the item templates)
    g.frameHooks.push(dt => this.update(dt));
    g.interactHandlers.push(() => this.onInteract());
    g.pointerHandlers?.push(() => this.onPointer());
    g.promptProviders?.push(() => this.prompt());
    g.inputOwners?.push(() => !!this.pour);
    g.hitListeners.push(hit => { if (this.pour && hit.amount > 0) this.cancel('hit'); });
    g.stateListeners?.push(s => { if (s !== 'playing') { if (this.pour) this.cancel('menu'); this.aimed = false; } });
    g.sectionHooks.push({build: () => { this.attach(); this.ensureHeldModel(); this.ensurePourView(); }, teardown: () => {
      if (this.pour) this.cancel('teardown');
      this.aimed = false;
      if (!g.trainRide?.riding) this.setHud(null); // (riding: the readout stays through the tunnel gap, where no frame hook runs)
    }});
    g.warmRegistry.addPool('fuel-port', () => this.warmRoots());
    return this;
  }

  // --- the cap fixture -----------------------------------------------------------------------------------------------

  /** Parent the cap to the current train view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.host.trainRuntime?.view ?? null;
    if (!view) { if (this.cap.parent) this.cap.parent.remove(this.cap); return false; }
    if (this.cap.parent !== view.root) {
      view.root.add(this.cap);
      this.levelMeshes();
      this.counts.attached++;
    }
    return true;
  }

  /** The cap's meshes (and the pour view's, a child of the cap) carry the car's level (the culler's tag). */
  private levelMeshes(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.cap.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
  }

  /** The viewmodel's held fuel can (the shared item template, centred on its holder), added once — before the warm-up compiles it. */
  ensureHeldModel(): boolean {
    const vm = (this.game as {viewmodel?: {hasItem?(id: string): boolean; addHeldItem?(id: string, obj: THREE.Object3D, pose: {hip: readonly [number, number, number]; yaw?: number; pitch?: number; roll?: number}): void}}).viewmodel;
    if (!vm || typeof vm.addHeldItem !== 'function' || typeof vm.hasItem !== 'function') return false;
    if (vm.hasItem(FUEL.canItem)) return true;
    const obj = makeSupplyMesh(FUEL.canItem);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) obj.position.y -= (box.min.y + box.max.y) / 2; // centre on the holder (the template's origin is bottom-centre)
    vm.addHeldItem(FUEL.canItem, obj, FUEL_PORT.held);
    this.heldObj = obj;
    (this.game as {syncHeld?: () => void}).syncHeld?.(); // a can already selected shows at once
    return true;
  }

  /**
   * Task fuel-feedback (lane POUR): the visible pour (world/fuelPourView.ts), built once — at a section build (after the boot assets:
   * the item template is the loaded GLB), before the warm-up, as a hidden child of the cap (so the 'fuel-port' pool compiles it).
   */
  ensurePourView(): FuelPourView {
    if (this.pourView) return this.pourView;
    const P = FUEL_PORT.part, skinZ = -PLAYER_TRAIN_SPEC.width / 2;
    const v = new FuelPourView(FUEL.canItem, fuelNeckMouthLocal(), {plateZ: skinZ + P.plateInset - P.plateD, skinZ}, (pos, q) => this.handPose(pos, q));
    v.root.position.set(-this.local.x, -this.local.y, -this.local.z); // the cap's frame -> train-local
    this.cap.add(v.root);
    this.levelMeshes();
    this.pourView = v;
    return v;
  }

  /**
   * Where the hand holds the can (train-local model origin + orientation): the viewmodel's held pose (FUEL_PORT.held, camera space)
   * re-projected into the world camera — depth scaled by tan(world fov / 2) / tan(viewmodel fov / 2), so the world can covers the same
   * screen spot at the same size as the held one — and never inside the car's outline (a player hugging the skin).
   */
  handPose(pos: THREE.Vector3, q: THREE.Quaternion): boolean {
    const g = this.host, tr = g.trainRuntime, cam = g.camera, v = this.pourView;
    if (!tr || !cam || !v) return false;
    cam.updateMatrixWorld();
    const vmFov = (g as {viewmodel?: {camera?: {fov?: number}}}).viewmodel?.camera?.fov ?? FUEL_PORT.viewmodelFov;
    const k = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(vmFov) / 2);
    const H = FUEL_PORT.held.hip;
    const c = this.vHand.set(H[0], H[1], H[2] / k);
    cam.localToWorld(c);
    const cl = tr.carLocal(c.x, c.y, c.z);
    if (!cl) return false;
    // the camera's axes in the car frame -> its orientation there, then the held pose's rotation on top
    cam.getWorldQuaternion(this.qCam);
    for (let i = 0; i < 3; i++) {
      this.vAxis.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(this.qCam);
      const d = tr.carDir(this.vAxis.x, this.vAxis.y, this.vAxis.z);
      if (!d) return false;
      this.basis[i].set(d.x, d.y, d.z);
    }
    q.setFromRotationMatrix(this.mBasis.makeBasis(this.basis[0], this.basis[1], this.basis[2])).multiply(this.qHeld);
    const lim = -PLAYER_TRAIN_SPEC.width / 2 - v.radius;
    if (cl.z > lim) cl.z = lim;
    v.originFromCentre(cl, q, pos);
    return true;
  }

  /** Warm-up roots: the cap on the car (with the hidden pour view) and a hidden fuel-can prototype (the pickup factory, materials cloned like a pickup). */
  warmRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.ensurePourView();
    if (this.attach()) out.push(this.cap);
    if (!this.proto) {
      const root = makeSupplyMesh(FUEL.canItem);
      root.name = 'fuel-can-warm-prototype';
      root.position.set(0, -1000, 0);
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
        m.visible = false;
        m.raycast = () => {};
      });
      this.game.scene.add(root);
      this.proto = root;
    }
    out.push(this.proto);
    return out;
  }

  /** The cap's world point (null: no car). */
  capWorld(): V3 | null {
    const L = this.local;
    return this.host.trainRuntime?.carPoint(L.x, L.y, L.z) ?? null;
  }

  // --- aim -----------------------------------------------------------------------------------------------------------

  /**
   * The crosshair is on the cap: the camera ray (in the car frame) enters the cap's aim box within PORT.reach, the eye is OUTSIDE the
   * car on the platform side (never through the skin from inside), and (parked) the station's geometry does not block it.
   */
  aim(): boolean {
    const g = this.host, tr = g.trainRuntime;
    if (!tr || !g.player?.alive || g.state !== 'playing') return false;
    const pl = tr.carLocal(g.player.x, g.player.y, g.player.z);
    if (!pl) return false;
    const L = this.local, A = FUEL_PORT.aim;
    if (Math.abs(pl.x - L.x) > PORT.reach + 1.5 || Math.abs(pl.z - L.z) > PORT.reach + 1.5) return false; // cheap reject
    const cam = g.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.vEye);
    cam.getWorldDirection(this.vDir);
    const eye = tr.carLocal(this.vEye.x, this.vEye.y, this.vEye.z), dir = tr.carDir(this.vDir.x, this.vDir.y, this.vDir.z);
    if (!eye || !dir) return false;
    if (eye.z > -PLAYER_TRAIN_SPEC.width / 2) return false; // inside the car's outline (or beyond it on the far side)
    const t = rayBoxT(eye, dir, {x: L.x - A.hx, y: L.y - A.hy, z: L.z - A.out}, {x: L.x + A.hx, y: L.y + A.hy, z: L.z + A.in}, PORT.reach);
    if (t === null) return false;
    if (!g.trainRide?.riding && g.levels?.raycast) {
      const w = {x: this.vEye.x, y: this.vEye.y, z: this.vEye.z}, d = {x: this.vDir.x, y: this.vDir.y, z: this.vDir.z};
      const hit = g.levels.raycast(w, d, t + 0.02);
      if (hit.kind !== 'none' && hit.t < t - 0.01) return false;
    }
    return true;
  }

  // --- input ---------------------------------------------------------------------------------------------------------

  /** E (Game.interactHandlers): consumed only while the cap is the aim target. */
  onInteract(): boolean {
    if (this.host.state !== 'playing') return false;
    if (this.pour) return this.aimed || this.aim(); // a second press on the cap while pouring does nothing (consumed)
    if (!this.aim()) return false;
    this.aimed = true;
    this.press();
    return true;
  }

  /**
   * Left click (Game.pointerHandlers): a fuel can in the hand on the aimed cap pours like E; anything else is not ours — except that
   * WHILE a pour runs every press is (task fuel-feedback): Game consumes and latches it, so a button pressed mid-pour (e.g. a pour
   * started with E while a gun is held) never fires the moment the pour ends — it must be released first.
   */
  onPointer(): boolean {
    const g = this.host;
    if (g.state !== 'playing') return false;
    if (this.pour) return true;
    if (g.inv.meleeSelected || g.inv.selectedStack()?.itemId !== FUEL.canItem) return false;
    if (!this.aim()) return false;
    this.aimed = true;
    this.press();
    return true;
  }

  /** A press at the aimed cap: start a pour, or refuse with a short toast (nothing used). */
  press(): FuelPress {
    const g = this.host;
    if (this.pour) return 'ignored';
    const refuse = (text: string, why: FuelPress): FuelPress => { g.hud.toast(text, true); g.sfx.denied(); this.counts.refused++; return why; };
    if (g.trainRide?.riding) return refuse('Not while moving', 'riding');
    const tank = g.playerTrain.fuel.tank;
    if (tank >= FUEL.trainTankUnits) return refuse(`The tank is full — ${tanksText(tank)}`, 'full');
    if (g.inv.count(FUEL.canItem) <= 0) {
      const inBag = (g.inv.wornBag()?.bag ?? []).some(s => s?.itemId === FUEL.canItem);
      return refuse(inBag ? 'No fuel can at hand — the ones in your backpack need it set down' : 'No fuel can', 'no-can');
    }
    if (g.player.climbing || g.consumeView?.busy || g.gasMask?.transitioning || g.gear?.readied) return refuse('Hands busy', 'busy');
    this.pour = {t: 0, total: FUEL_PORT.pourS, clears: g.input.clears, away: 0};
    (g.sfx as {fuelPour?: () => number}).fuelPour?.();
    this.showPour(true);
    return 'pouring';
  }

  /**
   * Task fuel-feedback (lane POUR): the visible pour on / off. On: the world-space can appears where the held can is (the held one is
   * hidden meanwhile: no duplicate; the inventory selection is untouched). Off (completion / any cancel): the can, stream and drops
   * vanish, the screw cap is back on, the held view returns (a can still in the hand rises from below, like an equip).
   */
  private showPour(on: boolean): void {
    if (on) {
      this.ensurePourView().begin();
      this.pourView!.update(0, FUEL_PORT.pourS);
      if (this.heldObj) this.heldObj.visible = false;
      return;
    }
    this.pourView?.end();
    this.setUncapped(false);
    if (this.heldObj && !this.heldObj.visible) {
      this.heldObj.visible = true;
      const vm = (this.game as {viewmodel?: {heldItem?: string | null; setItem?(id: string | null): void}}).viewmodel;
      if (vm?.heldItem === FUEL.canItem && typeof vm.setItem === 'function') { vm.setItem(null); vm.setItem(FUEL.canItem); } // replay the raise
    }
  }

  /** The screw cap off (the neck's opening shows) / back on. */
  private setUncapped(off: boolean): void {
    for (const m of this.screwCap) m.visible = !off;
    if (this.opening) this.opening.visible = off;
  }

  /** Whether the screw cap is off (QA / tests). */
  get uncapped(): boolean {
    return !!this.opening?.visible;
  }

  // --- per frame -----------------------------------------------------------------------------------------------------

  update(dt: number): void {
    const g = this.host;
    this.time += dt;
    this.attach();
    this.aimed = this.aim();
    if (this.pour) this.stepPour(dt);
    // the aimed cap glows (its own material: emissive intensity only — no new program)
    this.capMat.emissiveIntensity = this.aimed || this.pour ? 0.35 + 0.25 * Math.sin(this.time * 6) : 0;
    this.updateHud(g);
  }

  private stepPour(dt: number): void {
    const g = this.host, p = this.pour!;
    if (g.state !== 'playing' || g.input.clears !== p.clears) { this.cancel('menu'); return; }
    if (g.trainRide?.riding) { this.cancel('riding'); return; }
    if (!g.player.alive || g.player.climbing || g.consumeView?.busy) { this.cancel('busy'); return; }
    if (g.player.sprinting) { this.cancel('sprint'); return; }
    const c = this.capWorld();
    g.camera.getWorldPosition(this.vEye);
    if (!c || Math.hypot(c.x - this.vEye.x, c.y - this.vEye.y, c.z - this.vEye.z) > PORT.reach + FUEL_PORT.reachSlack) { this.cancel('away'); return; }
    p.away = this.aimed ? 0 : p.away + dt;
    if (p.away > FUEL_PORT.awayGraceS) { this.cancel('away'); return; }
    p.t += dt;
    if (p.t >= p.total) { this.complete(); return; }
    // the visible pour follows the transaction's own clock (the screw cap comes off as the can arrives)
    this.pourView?.update(p.t, p.total);
    this.setUncapped(p.t >= 0.6 * POUR_VIEW.liftS);
  }

  /** The pour ran its time: re-check, take exactly one can (the hand's first), tank + 1. */
  private complete(): void {
    const g = this.host;
    this.pour = null;
    this.showPour(false);
    const fuel = g.playerTrain.fuel;
    if (fuel.tank >= FUEL.trainTankUnits) { g.hud.toast(`The tank is full — ${tanksText(fuel.tank)}`, true); g.sfx.denied(); this.counts.refused++; return; }
    const held = !g.inv.meleeSelected ? g.inv.selectedStack() : null;
    const fromHand = held?.itemId === FUEL.canItem;
    const took = fromHand ? g.inv.consumeAt(g.inv.selectedRef()) : g.inv.take(FUEL.canItem, 1) === 1;
    if (!took) { g.hud.toast('No fuel can', true); g.sfx.denied(); this.counts.refused++; return; }
    fuel.tank = Math.min(FUEL.trainTankUnits, fuel.tank + FUEL.canUnits);
    this.counts.pours++;
    const left = g.inv.count(FUEL.canItem);
    g.hud.toast(`Fuel in — tank ${tanksText(fuel.tank)}${fuel.tank >= FUEL.trainTankUnits ? ' (full)' : ''} · ${left ? `${left} can${left > 1 ? 's' : ''} left` : 'no cans left'}`);
    if (fromHand) g.syncHeld();
  }

  /** Stop the running pour: nothing is used. */
  cancel(why: CancelReason): void {
    if (!this.pour) return;
    this.pour = null;
    this.showPour(false);
    this.lastCancel = why;
    this.counts.cancelled++;
    const g = this.host;
    (g.sfx as {stopFuelPour?: () => void}).stopFuelPour?.();
    if (why === 'riding') g.hud.toast('Not while moving', true);
    else if (why === 'hit' || why === 'away' || why === 'sprint') g.hud.toast('Pour stopped — nothing used', true);
  }

  /** The cap's prompt (only while aimed) / the pour's progress. */
  prompt(): string | null {
    const g = this.host;
    if (this.pour) return `<b>Pouring fuel…</b> ${Math.min(99, Math.floor(this.pour.t / this.pour.total * 100))} %`;
    if (!this.aimed) return null;
    const tank = g.playerTrain.fuel.tank, n = g.inv.count(FUEL.canItem);
    if (tank >= FUEL.trainTankUnits) return `Fuel cap · the tank is full (${tanksText(tank)})`;
    return n ? `<b>[E]</b> Pour a fuel can · tank ${tanksText(tank)} · ${n} can${n > 1 ? 's' : ''}` : `<b>[E]</b> Fuel cap · tank ${tanksText(tank)} · no fuel can`;
  }

  // --- HUD -----------------------------------------------------------------------------------------------------------

  /** The player is inside / within FUEL_PORT.hudNear of the car (or riding it). */
  nearTrain(): boolean {
    const g = this.host, tr = g.trainRuntime;
    if (!tr || !tr.view) return false;
    if (g.trainRide?.riding) return true;
    const p = tr.carLocal(g.player.x, g.player.y, g.player.z);
    if (!p) return false;
    const S = PLAYER_TRAIN_SPEC;
    const dx = Math.max(0, Math.abs(p.x) - S.length / 2), dz = Math.max(0, Math.abs(p.z) - S.width / 2);
    return Math.hypot(dx, dz) <= FUEL_PORT.hudNear && p.y > -3 && p.y < 6;
  }

  private updateHud(g: Game & HostExtras): void {
    if (!this.nearTrain()) { this.setHud(null); return; }
    // the cart system (world/fuelCarts.ts, lane CART) may be absent: Game.fuelCarts is then not a cart system (no aboard())
    const fc = (this.game as unknown as {fuelCarts?: {aboard?: unknown}}).fuelCarts;
    const carts = fc && typeof fc.aboard === 'function' ? (fc.aboard as () => CartFuel[]).call(fc) ?? [] : [];
    this.setHud(fuelReadout(g.playerTrain.fuel.tank, carts, g.playerTrain.lockbox.slots));
  }

  private setHud(v: FuelHudView | null): void {
    const key = v ? `${v.pips}|${v.text}|${v.low}` : '';
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud = v ? {pips: v.pips, tank: v.tank, text: v.text, low: v.low} : null;
    (this.game.hud as {setFuel?: (v: FuelHudView | null) => void}).setFuel?.(this.hud);
  }

  /** QA / tests: a compact state report. */
  qa(): {aimed: boolean; pouring: number | null; tank: number; cans: number; attached: boolean; hud: string | null; counts: FuelPortSystem['counts']; lastCancel: CancelReason | null;
    view: ReturnType<FuelPourView['qa']> | null; uncapped: boolean; heldHidden: boolean} {
    const g = this.host;
    return {aimed: this.aimed, pouring: this.pour ? +(this.pour.t / this.pour.total).toFixed(3) : null, tank: g.playerTrain.fuel.tank, cans: g.inv.count(FUEL.canItem),
      attached: !!this.cap.parent, hud: this.hud?.text ?? null, counts: {...this.counts}, lastCancel: this.lastCancel,
      view: this.pourView?.qa() ?? null, uncapped: this.uncapped, heldHidden: !!this.heldObj && !this.heldObj.visible};
  }
}

/** Create the fuel-cap system and register it into the Game (call once from the Game constructor, after installGasMask). */
export function installFuelPort(game: Game): FuelPortSystem {
  return new FuelPortSystem(game).install();
}
