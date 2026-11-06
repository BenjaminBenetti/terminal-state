// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train's FUEL CAP (refuel with fuel cans) and the HUD fuel readout.
//
// installFuelPort(game) is called ONCE from the Game constructor (after installGasMask); like installGear / installGasMask it only
// REGISTERS into the Game's registries:
// - frameHooks: the cap's aim (crosshair on the cap within PORT.reach, eye outside the car on the platform side, nothing in between),
//   the timed POUR (progress, cancel rules, completion), the cap's aim glow and the HUD fuel readout (near / aboard the train);
// - interactHandlers: [E] on the aimed cap starts a pour or says why not — the press is consumed ONLY while the cap is the aim target;
//   pointerHandlers: a left click with a fuel can in the hand on the aimed cap does the same (the press is consumed / latched by Game);
// - promptProviders: the cap's prompt (only while aimed) and the pour's progress; inputOwners: no fire / ADS / item use / flare while
//   pouring; hitListeners: a hit cancels the pour; stateListeners: leaving 'playing' (pause, Tab, death, travel) cancels it;
// - sectionHooks: teardown cancels the pour (the car goes); warmRegistry pool 'fuel-port': the cap (attached to the car) and a hidden
//   fuel-can prototype (a dropped can never compiles cold).
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
// HELD VIEW: supplies are not held-visible in this game (Game.syncHeld shows weapons, consumables and throwables only), so a selected
// fuel can shows empty hands like a held gas filter; the left-click pour still works from that quick slot.
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
import type {ItemStack} from '../items/inventory';

/** Tuning (one place). */
export const FUEL_PORT = {
  /** One can's pour (s). */
  pourS: 1.6,
  /** The HUD readout shows within this distance (m) of the parked car's outline (and inside / riding). */
  hudNear: 6,
  /** A pour survives the crosshair drifting off the cap this long (s; arm-injury sway, a glance). */
  awayGraceS: 0.35,
  /** A pour stops when the eye is farther than PORT.reach + this from the cap (m). */
  reachSlack: 0.3,
  /** The cap's aim box (train-local, around fuelPortLocal()): half extents along the car (x) / up (y), and how far out / in (z). */
  aim: {hx: 0.13, hy: 0.1, out: 0.12, in: 0.04},
  /** The visible fixture (m): housing plate, filler neck, cap. */
  part: {plateW: 0.2, plateH: 0.14, plateD: 0.05, plateInset: 0.02, neckR: 0.034, neckLen: 0.05, capR: 0.046, capLen: 0.03},
} as const;

/** The HUD readout (ui/hud.ts setFuel). */
export interface FuelHudView {
  /** Quarter pips lit (0..FUEL.tankUnits). */
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
  return {pips: Math.max(0, Math.min(FUEL.tankUnits, Math.floor(r.tank))), tank: r.tank, text, low: r.total < FUEL.hopUnits, reserves: r};
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
  fuelCarts?: {aboard?(): CartFuel[]} | null;
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
    this.geos.push(plate, neck, capG, tab);
    for (const [g, m, name] of [[plate, plateMat, 'fuel-cap-housing'], [neck, neckMat, 'fuel-cap-neck'], [capG, this.capMat, 'fuel-cap-cap'], [tab, this.capMat, 'fuel-cap-grip']] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name;
      this.cap.add(mesh);
    }
    this.cap.position.set(L.x, L.y, L.z);
  }

  private get host(): Game & HostExtras {
    return this.game as Game & HostExtras;
  }

  // --- registration --------------------------------------------------------------------------------------------------

  install(): this {
    const g = this.host;
    g.frameHooks.push(dt => this.update(dt));
    g.interactHandlers.push(() => this.onInteract());
    g.pointerHandlers?.push(() => this.onPointer());
    g.promptProviders?.push(() => this.prompt());
    g.inputOwners?.push(() => !!this.pour);
    g.hitListeners.push(hit => { if (this.pour && hit.amount > 0) this.cancel('hit'); });
    g.stateListeners?.push(s => { if (s !== 'playing') { if (this.pour) this.cancel('menu'); this.aimed = false; } });
    g.sectionHooks.push({build: () => this.attach(), teardown: () => { if (this.pour) this.cancel('teardown'); this.aimed = false; this.setHud(null); }});
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
      const level = this.host.trainRuntime?.train?.placement.level ?? 0;
      this.cap.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
      this.counts.attached++;
    }
    return true;
  }

  /** Warm-up roots: the cap on the car and a hidden fuel-can prototype (the pickup factory, materials cloned like a pickup). */
  warmRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
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

  /** Left click (Game.pointerHandlers): a fuel can in the hand on the aimed cap pours like E; anything else is not ours. */
  onPointer(): boolean {
    const g = this.host;
    if (g.state !== 'playing' || g.inv.meleeSelected || g.inv.selectedStack()?.itemId !== FUEL.canItem) return false;
    if (this.pour) return this.aimed;
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
    if (tank >= FUEL.tankUnits) return refuse(`The tank is full — ${tanksText(tank)}`, 'full');
    if (g.inv.count(FUEL.canItem) <= 0) {
      const inBag = (g.inv.wornBag()?.bag ?? []).some(s => s?.itemId === FUEL.canItem);
      return refuse(inBag ? 'No fuel can at hand — the ones in your backpack need it set down' : 'No fuel can', 'no-can');
    }
    if (g.player.climbing || g.consumeView?.busy || g.gasMask?.transitioning || g.gear?.readied) return refuse('Hands busy', 'busy');
    this.pour = {t: 0, total: FUEL_PORT.pourS, clears: g.input.clears, away: 0};
    (g.sfx as {fuelPour?: () => number}).fuelPour?.();
    return 'pouring';
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
    if (p.t >= p.total) this.complete();
  }

  /** The pour ran its time: re-check, take exactly one can (the hand's first), tank + 1. */
  private complete(): void {
    const g = this.host;
    this.pour = null;
    const fuel = g.playerTrain.fuel;
    if (fuel.tank >= FUEL.tankUnits) { g.hud.toast(`The tank is full — ${tanksText(fuel.tank)}`, true); g.sfx.denied(); this.counts.refused++; return; }
    const held = !g.inv.meleeSelected ? g.inv.selectedStack() : null;
    const fromHand = held?.itemId === FUEL.canItem;
    const took = fromHand ? g.inv.consumeAt(g.inv.selectedRef()) : g.inv.take(FUEL.canItem, 1) === 1;
    if (!took) { g.hud.toast('No fuel can', true); g.sfx.denied(); this.counts.refused++; return; }
    fuel.tank = Math.min(FUEL.tankUnits, fuel.tank + FUEL.canUnits);
    this.counts.pours++;
    const left = g.inv.count(FUEL.canItem);
    g.hud.toast(`Fuel in — tank ${tanksText(fuel.tank)}${fuel.tank >= FUEL.tankUnits ? ' (full)' : ''} · ${left ? `${left} can${left > 1 ? 's' : ''} left` : 'no cans left'}`);
    if (fromHand) g.syncHeld();
  }

  /** Stop the running pour: nothing is used. */
  cancel(why: CancelReason): void {
    if (!this.pour) return;
    this.pour = null;
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
    if (tank >= FUEL.tankUnits) return `Fuel cap · the tank is full (${tanksText(tank)})`;
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
    const carts = g.fuelCarts?.aboard?.() ?? [];
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
  qa(): {aimed: boolean; pouring: number | null; tank: number; cans: number; attached: boolean; hud: string | null; counts: FuelPortSystem['counts']; lastCancel: CancelReason | null} {
    const g = this.host;
    return {aimed: this.aimed, pouring: this.pour ? +(this.pour.t / this.pour.total).toFixed(3) : null, tank: g.playerTrain.fuel.tank, cans: g.inv.count(FUEL.canItem),
      attached: !!this.cap.parent, hud: this.hud?.text ?? null, counts: {...this.counts}, lastCancel: this.lastCancel};
  }
}

/** Create the fuel-cap system and register it into the Game (call once from the Game constructor, after installGasMask). */
export function installFuelPort(game: Game): FuelPortSystem {
  return new FuelPortSystem(game).install();
}
