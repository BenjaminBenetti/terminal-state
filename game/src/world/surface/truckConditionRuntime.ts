// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE TRUCK'S CONDITION AT RUNTIME — what lowers it, how it
// shows and sounds, and the cab that takes the hits (the rules: world/surface/truckCondition.ts; the pressure: truckPressure.ts).
//
// User: "Zombies must not damage the player through the seated truck cab. Their hits damage the truck instead (once per real hit); outside
// the truck normal player damage remains."
//  - THE CAB SHIELD (shieldTruckHit, called first in Game.hurtPlayer and Game.blastPlayer): while the player sits in the closed truck cab
//    (SkywaysCar.enclosed) an enemy's claw / bite / pounce (one call per real hit: the brain's attackHit), a Blightbelly's blast and a
//    survivor's round land on the TRUCK — its condition drops by the hit's raw damage x TRUCK_CONDITION.perHitPoint / perBlastPoint, a metal
//    impact sounds at the cab side toward the attacker, the view shakes a little — and NOTHING reaches the player (no HP, no armour wear,
//    no injury roll, no hit listeners). Out of the seat (or in the car, which is open) every hit is the player's as before.
//  - PER FRAME (a truck world only; the fog pressure at the body from lane FOG's field over layout.surface.boundary — none in a v1
//    district): the pressure's strain / seated wear (truckPressureLoss), the engine fire eating the rest (burnPerS), the stage changes'
//    cues (the fire catching, the engine stalling at the breakdown) and notes (seated or near), the dash's red FOG PRESSURE lamp blinking
//    (faster deeper), the body's groans while seated in the pressure (louder, more often deeper: audio/sfx.ts truckGroan over the existing
//    steel-creak takes), and the damage shown:
//      SMOKE — grey thickening and darkening as the condition falls (never green: green fog is the toxic gas, CLAUDE.md): sprite billows
//      from the engine's top behind the cab (fire/fireFx.ts FireFx.standing: the pooled rings, visible with the fog pass off) + ONE real
//      volumetric plume in the fog march, a neutral grey growing denser (render/smoke.ts: one of its 4 emitters; asked again at most
//      every 8 s if a newer emitter evicted it);
//      FIRE — flame tongues licking out of both sides of the engine bay under the cab (FireFx.standing: NON-damaging, never FireSystem:
//      nothing is ignited or hurt), the existing fire-bed loop (reactorLoop 'fireBurn') at the engine.
//  - THE ENGINE SOUND: a broken-down truck's engine never starts (the train's engine-stall take instead) nor runs (the controller's audio
//    hook diverted while it is broken down; the other vehicle's untouched).
//  - REPAIR (world/surface/truckRepair.ts) restores the condition through restore(): 1, the fire out (a hiss / clunk cue), the smoke
//    stopping, the record written at once.
// Lifecycle: every handle (the plume, the fire loop) is dropped at the section teardown and on a repair; the dash lamp is dark at build;
// a new world starts from the record's condition (no heal, no re-roll). Inert in every world without the truck.

import type {SkywaysCar, CarAudio} from '../skywaysCar';
import type {SmokeEmitterOptions, SmokeHandle} from '../../render/smoke';
import type {SurfaceBoundary} from '../../gen/surface/surfaceTypes';
import {carToWorld} from '../skywaysCarSpec';
import {FOG_PRESSURE, fogPressureAt} from './fogPressure';
import {TRUCK_CONDITION, TRUCK_CONDITION_TEXT, clampCondition, truckBurning, truckDisabled, truckFireLevel, truckSmokeLevel, truckStage, truckStateOf, type TruckStage} from './truckCondition';
import {TRUCK_PRESSURE, TRUCK_PRESSURE_TEXT, dashBlinkHz, groanAt, truckPressureLoss} from './truckPressure';
import {setDashLamp} from './truckPressureDash';
import type {TruckView} from './truckModel';

/** Where the damage shows (truck frame, m): the engine's top behind the cab (smoke) and the engine bay's two sides under it (flames). */
export const TRUCK_DAMAGE_FX = {
  smoke: {x: 0.05, y: 2.45, z: -1.55, r: 0.3},
  fire: [{x: -1.12, y: 0.62, z: -1.6}, {x: 1.13, y: 0.62, z: -1.6}],
  fireR: 0.2,
  /** The volumetric plume (render/smoke.ts options) from a smoking engine (k 0) to a burning one (k 1): grey -> black. */
  plume: {grey: [0.54, 0.53, 0.5] as const, black: [0.13, 0.12, 0.11] as const, rate: [0.5, 1.2] as const, radius: [0.9, 1.6] as const, density: [0.35, 1.0] as const, life: 5},
  /** Notes for the stage changes reach the player seated or within this (m). */
  noteNear: 30,
  /** The cab-side metal impact for a shielded hit (closing m/s for the vehicle impact cue) and the shake it adds. */
  hitSpeed: 3.2,
} as const;

type Sfx = {
  carImpact?(x: number, y: number, z: number, speed: number, what: 'car' | 'flesh'): boolean;
  impact?(x: number, y: number, z: number, surface: 'metal'): void;
  engineStall?(): number;
  reactorCue?(cue: 'fireCatch' | 'reactorRodStop', x: number, y: number, z: number, o?: {gain?: number}): void;
  reactorLoop?(cue: 'fireBurn', x: number, y: number, z: number, o?: {level?: number}): {setPos(x: number, y: number, z: number): void; stop(fadeS?: number): void; readonly playing: boolean; setLevel?(k: number, tauS?: number): void} | null;
  truckGroan?(x: number, y: number, z: number, strength: number): boolean;
};
type Loop = NonNullable<ReturnType<NonNullable<Sfx['reactorLoop']>>>;

/** What the condition needs from Game (structural: tests drive it with the controller's Node host). */
export interface TruckConditionHost {
  player: {x: number; y: number; z: number; alive: boolean};
  layout: {surface?: {boundary?: SurfaceBoundary} | null} | null;
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  atmosphere?: {addSmokeEmitter?(o: SmokeEmitterOptions): SmokeHandle} | null;
  fireFx?: {standing?(key: object, x: number, y: number, z: number, r: number, flames: number, smoke: number, dark: number, dt: number): void} | null;
}

const RANK: Record<TruckStage, number> = {sound: 0, smoking: 1, heavy: 2, burning: 3, disabled: 4};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const systems = new WeakMap<object, TruckConditionSystem>();
/** The truck condition system installed into a game (QA / tests / Game's hit paths). */
export const truckConditionOf = (game: object): TruckConditionSystem | undefined => systems.get(game);

/**
 * Game.hurtPlayer / Game.blastPlayer, first: the player sits in the closed truck cab -> the hit lands on the truck (see the header) and
 * true (the caller does nothing more to the player); else false (the player's hit as ever).
 */
export function shieldTruckHit(game: object, amount: number, fromX: number, fromZ: number, kind: 'claw' | 'blast'): boolean {
  return systems.get(game)?.shieldHit(amount, fromX, fromZ, kind) ?? false;
}

export class TruckConditionSystem {
  /** The fog pressure at the truck this frame (0 without a boundary). */
  pressure = 0;
  /** QA / tests. */
  readonly counts = {shielded: 0, groans: 0, stalls: 0, catches: 0, plumes: 0, fireLoops: 0, notes: 0, restores: 0, blinks: 0};
  private lastP: number | null = null;
  private stage: TruckStage = 'sound';
  private plume: SmokeHandle | null = null;
  private plumeRetry = 0;
  private fireLoop: Loop | null = null;
  private loopRetry = 0;
  private groanT = 0.6;
  private blink = 0;
  private lampOn = false;
  private pressureNoteT: number = TRUCK_PRESSURE.noteEvery;
  private readonly smokeKey = {};
  private readonly fireKeys = TRUCK_DAMAGE_FX.fire.map(() => ({}));
  private readonly plumeOpts: SmokeEmitterOptions = {x: 0, y: 0, z: 0, color: [0.5, 0.5, 0.5], rate: 1, radius: 1, life: TRUCK_DAMAGE_FX.plume.life, density: 1};

  constructor(readonly host: TruckConditionHost, readonly car: SkywaysCar) {}

  private get sfx(): Sfx | null {
    return (this.host.sfx as Sfx | null) ?? null;
  }

  /** This world's truck condition (1 without the truck). */
  get condition(): number {
    return this.car.vehicle === 'truck' ? truckStateOf(this.car).condition : 1;
  }

  install(): this {
    systems.set(this.host, this);
    this.host.frameHooks.push(dt => this.frame(dt));
    // after the controller's section hook (installed earlier): its build has read the record (the condition with it)
    this.host.sectionHooks.push({build: () => this.onBuild(), teardown: () => this.onTeardown()});
    // a broken-down truck's engine never starts nor runs (the other vehicle's sound untouched)
    const car = this.car, base: CarAudio = car.audio, dead = () => car.vehicle === 'truck' && truckDisabled(truckStateOf(car).condition);
    car.audio = {
      ...base,
      start: (x, y, z) => { if (dead()) { this.stall(); return; } base.start(x, y, z); },
      engine: (k, th, x, y, z, r) => { if (!dead()) base.engine(k, th, x, y, z, r); },
    };
    return this;
  }

  private onBuild(): void {
    this.dropHandles();
    this.lastP = null;
    this.stage = truckStage(this.condition); // (the record's state: no notes for what it already was)
    this.groanT = 0.6;
    this.blink = 0;
    this.lampOn = false;
  }

  private onTeardown(): void {
    this.dropHandles();
    this.lastP = null;
  }

  private dropHandles(): void {
    this.plume?.stop(0);
    this.plume = null;
    this.fireLoop?.stop(0.2);
    this.fireLoop = null;
    this.plumeRetry = this.loopRetry = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The condition

  /** Lower the condition by `amount` (clamped; the stage change's cues / notes). */
  lose(amount: number): void {
    if (this.car.vehicle !== 'truck' || !(amount > 0)) return;
    const st = truckStateOf(this.car);
    st.condition = clampCondition(st.condition - amount);
    this.stageChanged();
  }

  /** Set the condition (QA / tests: the stage cues as for a change; a raise only through here or the repair). */
  setCondition(c: number): void {
    if (this.car.vehicle !== 'truck') return;
    truckStateOf(this.car).condition = clampCondition(c);
    this.stageChanged();
  }

  /** The repair's restore (world/surface/truckRepair.ts): condition 1, the fire out, the smoke stopping, the record written now. */
  restore(): void {
    const car = this.car, b = car.body;
    if (car.vehicle !== 'truck' || !b) throw new Error('no truck to restore');
    const wasBurning = truckBurning(truckStateOf(car).condition);
    truckStateOf(car).condition = 1;
    truckStateOf(car).counts.repairs++;
    this.stage = 'sound';
    this.plume?.stop(2.5);
    this.plume = null;
    this.fireLoop?.stop(0.8);
    this.fireLoop = null;
    const e = this.at(TRUCK_DAMAGE_FX.smoke);
    this.sfx?.reactorCue?.('reactorRodStop', e.x, e.y - 1, e.z, {gain: wasBurning ? 1 : 0.8}); // (a heavy steel clunk + a hiss)
    this.counts.restores++;
    car.store();
  }

  private stageChanged(): void {
    const s = truckStage(this.condition), prev = this.stage;
    if (s === prev) return;
    this.stage = s;
    if (RANK[s] <= RANK[prev]) return;
    const car = this.car, near = this.near();
    if (s === 'burning' || (s === 'disabled' && RANK[prev] < RANK.burning)) {
      const f = this.at(TRUCK_DAMAGE_FX.fire[0]);
      this.sfx?.reactorCue?.('fireCatch', f.x, f.y, f.z);
      this.counts.catches++;
    }
    if (s === 'disabled') {
      if (car.driving) { this.stall(); car.audio.stop(); }
      this.note(car.driving ? TRUCK_CONDITION_TEXT.dead : TRUCK_CONDITION_TEXT.disabled, near);
    } else if (s === 'burning') this.note(TRUCK_CONDITION_TEXT.burning, near);
    else if (s === 'smoking' && prev === 'sound') this.note(TRUCK_CONDITION_TEXT.smoking, near);
  }

  private stall(): void {
    if ((this.sfx?.engineStall?.() ?? 0) > 0) this.counts.stalls++;
  }

  private near(): boolean {
    const b = this.car.body, P = this.host.player;
    return this.car.driving || (!!b && Math.hypot(P.x - b.x, P.z - b.z) <= TRUCK_DAMAGE_FX.noteNear);
  }

  private note(text: string, near: boolean): void {
    if (!near) return;
    this.counts.notes++;
    this.host.hud.toast(text, true);
  }

  /** Game's hit paths (shieldTruckHit): seated in the closed cab -> the truck takes it (see the header). */
  shieldHit(amount: number, fromX: number, fromZ: number, kind: 'claw' | 'blast'): boolean {
    const car = this.car, b = car.body;
    if (!car.enclosed || car.vehicle !== 'truck' || !b) return false;
    const st = truckStateOf(car);
    if (kind === 'claw') st.counts.hits++; else st.counts.blasts++;
    this.counts.shielded++;
    this.lose(Math.max(0, Number.isFinite(amount) ? amount : 0) * (kind === 'claw' ? TRUCK_CONDITION.perHitPoint : TRUCK_CONDITION.perBlastPoint));
    // the metal impact at the cab side toward the attacker
    const dx = fromX - b.x, dz = fromZ - b.z, d = Math.hypot(dx, dz), k = d > 1e-3 ? Math.min(d, 1.3) / d : 0;
    const x = b.x + dx * k, z = b.z + dz * k, y = b.y + 1.4, s = this.sfx;
    if (!s?.carImpact?.(x, y, z, TRUCK_DAMAGE_FX.hitSpeed, 'car')) s?.impact?.(x, y, z, 'metal');
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame

  /** A truck-frame point in the world (the body's pose; the truck never pitches: no flights). */
  private at(p: {x: number; y: number; z: number}): {x: number; y: number; z: number} {
    const b = this.car.body!, w = carToWorld(b.x, b.z, b.yaw, p.x, p.z);
    return {x: w.x, y: b.y + p.y, z: w.z};
  }

  frame(dt: number): void {
    const car = this.car, b = car.body;
    if (car.vehicle !== 'truck' || !b) return;
    const st = truckStateOf(car);
    const p = fogPressureAt(this.host.layout?.surface?.boundary, b.x, b.z);
    this.pressure = p;
    let loss = this.lastP === null ? 0 : truckPressureLoss(this.lastP, p, car.driving, dt);
    this.lastP = p;
    if (truckBurning(st.condition) && st.condition > 0) loss += TRUCK_CONDITION.burnPerS * Math.max(0, dt);
    if (loss > 0) this.lose(loss);
    this.effects(dt);
    this.sounds(dt, p);
    this.dash(dt, p);
  }

  /** The smoke (sprites + one volumetric plume) and the flames, from the condition. */
  private effects(dt: number): void {
    const c = this.condition, sm = truckSmokeLevel(c), fl = truckFireLevel(c), F = TRUCK_DAMAGE_FX, fx = this.host.fireFx;
    const dark = Math.min(1, Math.max(0, (TRUCK_CONDITION.smoke - c) / (TRUCK_CONDITION.smoke - TRUCK_CONDITION.fire)));
    const s = this.at(F.smoke);
    if (sm > 0) {
      fx?.standing?.(this.smokeKey, s.x, s.y, s.z, F.smoke.r, 0, sm, dark, dt);
      const o = this.plumeOpts, P = F.plume;
      o.x = s.x; o.y = s.y; o.z = s.z;
      o.color = [lerp(P.grey[0], P.black[0], dark), lerp(P.grey[1], P.black[1], dark), lerp(P.grey[2], P.black[2], dark)];
      o.rate = lerp(P.rate[0], P.rate[1], sm); o.radius = lerp(P.radius[0], P.radius[1], sm); o.density = lerp(P.density[0], P.density[1], sm);
      if (this.plume && !this.plume.alive) this.plume = null;
      if (this.plume) this.plume.update(o);
      else if ((this.plumeRetry -= dt) <= 0 && this.host.atmosphere?.addSmokeEmitter) {
        this.plumeRetry = 8; // (evicted by a newer emitter: asked again at most this often, never a thrash; the sprite smoke stays)
        this.plume = this.host.atmosphere.addSmokeEmitter({...o});
        this.counts.plumes++;
      }
    } else if (this.plume) { this.plume.stop(3); this.plume = null; }
    if (fl > 0) for (let i = 0; i < F.fire.length; i++) { const f = this.at(F.fire[i]); fx?.standing?.(this.fireKeys[i], f.x, f.y, f.z, F.fireR, fl, 0.7 * fl, 1, dt); }
  }

  /** The fire bed loop while burning; the groans while seated in the pressure; the pressure note. */
  private sounds(dt: number, p: number): void {
    const car = this.car, b = car.body!, fl = truckFireLevel(this.condition), s = this.sfx;
    if (fl > 0) {
      const f = this.at({x: 0, y: 0.8, z: TRUCK_DAMAGE_FX.fire[0].z});
      if (this.fireLoop && !this.fireLoop.playing) this.fireLoop = null;
      if (this.fireLoop) { this.fireLoop.setPos(f.x, f.y, f.z); this.fireLoop.setLevel?.(0.5 + 0.5 * fl, 0.6); }
      else if ((this.loopRetry -= dt) <= 0) {
        this.loopRetry = 1.5;
        this.fireLoop = s?.reactorLoop?.('fireBurn', f.x, f.y, f.z, {level: 0.5 + 0.5 * fl}) ?? null;
        if (this.fireLoop) this.counts.fireLoops++;
      }
    } else if (this.fireLoop) { this.fireLoop.stop(0.8); this.fireLoop = null; }
    this.pressureNoteT += dt;
    const g = car.driving ? groanAt(p) : null;
    if (!g) { this.groanT = Math.min(Math.max(this.groanT, 0.6), 0.6); return; }
    if (this.pressureNoteT >= TRUCK_PRESSURE.noteEvery) { this.pressureNoteT = 0; this.counts.notes++; this.host.hud.toast(TRUCK_PRESSURE_TEXT.warn, true); }
    this.groanT -= dt;
    if (this.groanT > 0) return;
    this.groanT = g.every * (0.8 + 0.4 * Math.random()); // (sound timing only: never the game's seeded stream)
    if (s?.truckGroan?.(b.x, b.y + 1.5, b.z, g.strength)) this.counts.groans++;
  }

  /** The dash's FOG PRESSURE lamp: blinking from the warning pressure, faster deeper; dark otherwise. */
  private dash(dt: number, p: number): void {
    const hz = dashBlinkHz(p);
    let on = false;
    if (hz > 0) { this.blink = (this.blink + hz * Math.max(0, dt)) % 1; on = this.blink < 0.5; }
    else this.blink = 0;
    if (on && !this.lampOn) this.counts.blinks++;
    this.lampOn = on;
    setDashLamp((this.car.view as TruckView | null)?.dash, on);
  }

  /** The lamp is lit now (QA / tests). */
  get lamp(): boolean {
    return this.lampOn;
  }

  /** QA: a compact state report. */
  qa() {
    const c = this.condition, st = this.car.vehicle === 'truck' ? truckStateOf(this.car) : null;
    return {condition: +c.toFixed(4), stage: truckStage(c), burning: truckBurning(c), disabled: truckDisabled(c), pressure: +this.pressure.toFixed(4),
      warn: this.pressure >= FOG_PRESSURE.warn, lamp: this.lampOn, plume: !!this.plume?.alive, fireLoop: !!this.fireLoop?.playing, counts: {...this.counts}, hits: st ? {...st.counts} : null};
  }
}
