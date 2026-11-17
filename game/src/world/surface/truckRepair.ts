// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): REPAIRING THE TRUCK — the user's decision: "OOOO repairable,
// you just need 5 scrap metal." — "Repair a stopped damaged/disabled truck for exactly 5 scrap_metal via existing accessible-material
// handling, restoring condition/mobility and extinguishing the damage fire. No extra fees/tools/repair kit. Consume once on successful
// repair, never when healthy/refused/cancelled; don't disturb stored cargo."
//  - THE COST: exactly TRUCK_REPAIR_COST (5 scrap_metal, nothing else) through the crafting bench's own material handling
//    (craft/crafting.ts planCraft / applyCraft / missingText) over the ACCESSIBLE materials: what the player carries and the worn backpack
//    (craftSources with no Lockbox / chests — the train is not here). Never the truck's lockers or its secured cargo (stored cargo is not
//    disturbed: the repair never reads or writes them).
//  - THE TRANSACTION (repairTruck): refused — nothing drawn — without the truck, seated, while it moves, when it is sound (condition 1),
//    or short of scrap (the bench's "Need N more Scrap metal"); else the 5 are drawn ONCE and the condition restored to 1 (mobility back,
//    the engine fire out, the smoke stopping); a restore that fails is refunded exactly (refundCraft).
//  - THE GESTURE: on foot in front of the truck's NOSE (the engine is under the cab), the crosshair on it, a damaged truck: the prompt
//    "[Hold E] Repair the truck · 5 Scrap metal" (short: what is missing); E BEGINS the hold (core/holdGesture.ts HoldGesture: the crosshair
//    ring), held for TRUCK_REPAIR.holdS it repairs; released early, a hit, moving away, looking away, another input owner or any other
//    state CANCELS it — nothing is consumed. Through the vehicle controller's [E] handler / prompt (SkywaysCar.access), so a press does one
//    thing; inert in every world without the truck. The nose zone never meets the doors' stand points (they are beside the cab).

import * as THREE from 'three';
import type {Levels} from '../../gen/levels';
import type {Inventory} from '../../items/inventory';
import {itemDef} from '../../items/items';
import {SCRAP_METAL} from '../../items/craftMaterials';
import {RECIPE_MATERIALS, type RecipeMaterial} from '../../craft/recipes';
import {applyCraft, craftSources, missingText, planCraft, refundCraft, type CraftTake} from '../../craft/crafting';
import {HoldGesture, foreignOwners} from '../../core/holdGesture';
import {rayBox, type Box3Like} from '../towerShared';
import {CARGO_STILL, type SkywaysCar} from '../skywaysCar';
import {worldToCar} from '../skywaysCarSpec';
import {TRUCK_RT} from './truckSpec';
import {truckStateOf} from './truckCondition';

/** What one repair costs: exactly 5 scrap metal, nothing else. */
export const TRUCK_REPAIR_COST: Readonly<Record<RecipeMaterial, number>> = Object.freeze(
  Object.fromEntries(RECIPE_MATERIALS.map(m => [m, m === SCRAP_METAL ? 5 : 0])) as Record<RecipeMaterial, number>);

/** The repair as a bench recipe (planCraft's shape). */
export const TRUCK_REPAIR_RECIPE = Object.freeze({kind: 'truck-repair' as const, cost: TRUCK_REPAIR_COST});

export const TRUCK_REPAIR = {
  /** Hold E this long (s) to repair. */
  holdS: 2.5,
  /** Aim reach (eye -> the nose, m) and the aim box (truck frame): the nose face, the bumper to the windscreen's base. */
  reach: 2.4,
  box: {x0: -1.2, x1: 1.2, y0: 0.3, y1: 2.0, dz: 0.45},
  /** Standing in front of the nose: within `stand` m of its centre (horizontal), ahead of the nose plane less `ahead`, |x| within width / 2 + `side`. */
  stand: 2.4,
  ahead: 0.1,
  side: 0.7,
  /** The hold cancels when the player moves this far (m) from where it began. */
  moveCancel: 0.6,
} as const;

export const TRUCK_REPAIR_TEXT = {
  prompt: (n: number) => `<b>[Hold E]</b> Repair the truck · ${n} ${itemDef(SCRAP_METAL).name}`,
  short: (have: number, n: number) => `Repair the truck · needs ${n} ${itemDef(SCRAP_METAL).name} (you have ${have})`,
  hold: 'Hold <b>[E]</b> to repair the truck',
  done: (n: number) => `Truck repaired — ${n} ${itemDef(SCRAP_METAL).name} used`,
  healthy: 'The truck needs no repair',
  seated: 'Get out to repair the truck',
  moving: 'Stop the truck first',
  failed: 'The repair did not take — your materials were put back',
} as const;

export type TruckRepairResult =
  | {ok: true; takes: CraftTake[]}
  | {ok: false; reason: 'none' | 'seated' | 'moving' | 'healthy' | 'missing' | 'failed'; text: string};

/** The accessible materials a repair draws on: carried, then the worn backpack (never the truck's lockers / cargo, nor the train's). */
export const truckRepairSources = (inv: Inventory) => craftSources({inv});

/** Scrap metal the repair can use now. */
export const truckRepairHave = (inv: Inventory): number => truckRepairSources(inv).reduce((n, s) => n + s.count(SCRAP_METAL), 0);

/**
 * THE repair: refused with nothing drawn (no truck / seated / moving / sound / short), else the cost drawn once and `restore()` run (the
 * condition to 1, the fire out); if restore throws, the materials are put back exactly.
 */
export function repairTruck(car: SkywaysCar, inv: Inventory, restore: () => void): TruckRepairResult {
  const b = car.body;
  if (car.vehicle !== 'truck' || !b) return {ok: false, reason: 'none', text: ''};
  if (car.driving) return {ok: false, reason: 'seated', text: TRUCK_REPAIR_TEXT.seated};
  if (Math.abs(b.v) > CARGO_STILL) return {ok: false, reason: 'moving', text: TRUCK_REPAIR_TEXT.moving};
  if (truckStateOf(car).condition >= 1) return {ok: false, reason: 'healthy', text: TRUCK_REPAIR_TEXT.healthy};
  const sources = truckRepairSources(inv);
  const plan = planCraft(TRUCK_REPAIR_RECIPE, sources);
  if (!plan.ok) return {ok: false, reason: 'missing', text: missingText(plan.missing)};
  const receipt = applyCraft(plan, sources);
  if (!receipt) return {ok: false, reason: 'failed', text: TRUCK_REPAIR_TEXT.failed};
  try { restore(); } catch (err) {
    refundCraft(receipt);
    console.warn('surface truck: the repair failed (materials put back)', err);
    return {ok: false, reason: 'failed', text: TRUCK_REPAIR_TEXT.failed};
  }
  return {ok: true, takes: plan.takes};
}

/** What the repair gesture needs from Game (structural: tests drive it with the controller's Node host + a real Inventory). */
export interface TruckRepairHost {
  inv: Inventory;
  player: {x: number; y: number; z: number; alive: boolean; climbing?: boolean};
  camera: THREE.Camera;
  levels: Levels | null;
  state: string;
  hud: {toast(text: string, warn?: boolean): void; setHoldRing?(progress: number | null): void};
  sfx: unknown;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  stateListeners?: ((state: never, prev: never) => void)[];
  hitListeners?: ((hit: {amount: number}) => void)[];
  inputOwners?: (() => boolean)[];
  /** E held now; the input's clear counter (player/input.ts). */
  input?: {down(code: string): boolean; clears?: number} | null;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();

export class TruckRepairAccess {
  readonly hold: HoldGesture<{x: number; z: number}>;
  /** QA / tests. */
  readonly counts = {repairs: 0, refused: 0, holds: 0, cancelled: 0, taps: 0};
  lastResult: TruckRepairResult | null = null;
  private hit = false;
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};

  /** @param restore the condition back to 1 and the fire out (world/surface/truckConditionRuntime.ts) */
  constructor(readonly host: TruckRepairHost, readonly car: SkywaysCar, private readonly restore: () => void) {
    this.hold = new HoldGesture(p => this.host.hud.setHoldRing?.(p), TRUCK_REPAIR.holdS);
  }

  install(): this {
    const h = this.host;
    this.car.access.push(this);
    h.frameHooks.push(dt => this.step(dt));
    h.hitListeners?.push(hit => { if (hit.amount > 0 && this.hold.pending) this.hit = true; });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.cancel(); }) as (s: never, p: never) => void);
    h.sectionHooks.push({build: () => this.cancel(), teardown: () => this.cancel()});
    return this;
  }

  /** The truck needs a repair (a truck world, damaged). */
  get needed(): boolean {
    return this.car.vehicle === 'truck' && !!this.car.body && truckStateOf(this.car).condition < 1;
  }

  /** SkywaysCar.access prompt: the cost (or what is missing). */
  get prompt(): string {
    const n = TRUCK_REPAIR_COST[SCRAP_METAL], have = truckRepairHave(this.host.inv);
    return have >= n ? TRUCK_REPAIR_TEXT.prompt(n) : TRUCK_REPAIR_TEXT.short(have, n);
  }

  /** On foot in front of the truck's nose, the truck's storey. */
  standingBy(): boolean {
    const b = this.car.body, P = this.host.player, S = this.car.spec, R = TRUCK_REPAIR;
    if (!b || Math.abs(P.y - b.y) > TRUCK_RT.storeyY) return false;
    const lp = worldToCar(b.x, b.z, b.yaw, P.x, P.z), nose = -S.length / 2;
    if (lp.z > nose - R.ahead || Math.abs(lp.x) > S.width / 2 + R.side) return false;
    return Math.hypot(lp.x, lp.z - nose) <= R.stand;
  }

  /** The crosshair's hit on the nose within reach, nothing structural in between (null: not). */
  aimHit(): {t: number} | null {
    const h = this.host, b = this.car.body, L = h.levels, S = this.car.spec, R = TRUCK_REPAIR;
    if (!b || !L) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), co = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: tv2.x * co - tv2.z * s, y: tv2.y, z: tv2.x * s + tv2.z * co};
    const X = this.box, nose = -S.length / 2;
    X.min.x = R.box.x0; X.min.y = R.box.y0; X.min.z = nose - 0.05;
    X.max.x = R.box.x1; X.max.y = R.box.y1; X.max.z = nose + R.box.dz;
    const t = rayBox({x: lo.x, y: tv.y - b.y, z: lo.z}, ld, X, R.reach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t};
  }

  /** The repair may be offered here now: a damaged, parked truck; on foot by its nose, aiming at it; nothing else owning the hands. */
  private live(): boolean {
    const h = this.host, car = this.car, b = car.body;
    if (!this.needed || !b || car.driving || h.state !== 'playing' || !h.player.alive || h.player.climbing) return false;
    if (Math.abs(b.v) > CARGO_STILL || !car.canEnter()) return false;
    return this.standingBy();
  }

  /** SkywaysCar.access: aimed at a damaged truck's nose from in front of it (also while the hold runs: its prompt stays). */
  aimed(): boolean {
    return this.live() && this.aimHit() !== null;
  }

  /** SkywaysCar.access: [E] — short of scrap: refused at once (the bench's text, nothing drawn); else the hold begins. */
  interact(): boolean {
    if (!this.needed) return false;
    if (this.hold.pending) return true; // (a hold already runs: the press is its own)
    const n = TRUCK_REPAIR_COST[SCRAP_METAL], have = truckRepairHave(this.host.inv);
    if (have < n) {
      this.counts.refused++;
      this.lastResult = {ok: false, reason: 'missing', text: missingText({[SCRAP_METAL]: n - have})};
      this.host.hud.toast(this.lastResult.text, true);
      (this.host.sfx as {denied?(): void} | null)?.denied?.();
      return true;
    }
    const P = this.host.player;
    this.hit = false;
    this.hold.begin({x: P.x, z: P.z}, this.host.input?.clears ?? 0, foreignOwners(this.host.inputOwners, null));
    this.counts.holds++;
    return true;
  }

  /** Per frame: the pending hold — completed (the repair), released (a tap: the hint), or cancelled (nothing consumed). */
  step(dt: number): void {
    const g = this.hold, at = g.target;
    if (!at) return;
    const P = this.host.player;
    const r = g.step(dt, {
      down: !!this.host.input?.down('KeyE'),
      clears: this.host.input?.clears ?? 0,
      live: this.live() && !this.hit && Math.hypot(P.x - at.x, P.z - at.z) <= TRUCK_REPAIR.moveCancel,
      aimed: this.aimHit() !== null,
      foreign: foreignOwners(this.host.inputOwners, null),
    });
    if (r === 'cancelled') this.counts.cancelled++;
    else if (r === 'tap') { this.counts.taps++; this.host.hud.toast(TRUCK_REPAIR_TEXT.hold); }
    else if (r === 'hold') this.repair();
  }

  /** The repair now (the completed hold; QA): the transaction, its feedback. */
  repair(): TruckRepairResult {
    const res = repairTruck(this.car, this.host.inv, this.restore);
    this.lastResult = res;
    const h = this.host;
    if (res.ok) {
      this.counts.repairs++;
      h.hud.toast(TRUCK_REPAIR_TEXT.done(TRUCK_REPAIR_COST[SCRAP_METAL]));
    } else {
      this.counts.refused++;
      if (res.text) h.hud.toast(res.text, true);
      if (res.reason !== 'none') (h.sfx as {denied?(): void} | null)?.denied?.();
    }
    return res;
  }

  /** Drop a pending hold (nothing consumed). */
  cancel(): void {
    if (this.hold.cancel()) this.counts.cancelled++;
    this.hit = false;
  }

  qa() {
    return {needed: this.needed, by: this.standingBy(), aimed: this.aimed(), holding: this.hold.progress, have: truckRepairHave(this.host.inv), last: this.lastResult, counts: {...this.counts}};
  }
}
