// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): THE MARKET'S PEOPLE — friendly, healthy survivors living in the
// settlement (user: "wandering/idling residents and distinct identifiable stall traders ... healthy idle/turn/walk/posture rather
// than undead shambling ... actual pathing around player/stalls/stairs without blocking the train. 3D bodies and clothing").
//
//  - TRADERS: one per stall at layout.market.stalls[i].trader, facing the counter's front (the contract's yaw); they talk / gesture
//    and idle, and turn toward a player who comes up in front of the counter (within TURN_MAX of their post yaw). Never displaced.
//  - RESIDENTS (layout.market.residents): each idles at a resident spot (layout.market.spots: its kind picks the loop — sit, work /
//    cook, chat, idle), then walks to another free spot along a PathFinder route (no drops, no ladder links: never into the trench;
//    stairs through the level links as the zombies' paths), turning smoothly, at its own walking pace.
//  - COLLISION: the same height-aware circle collision as every walker (core/physics moveCircle / resolveCircle against the storeys
//    and the props); people keep apart from each other and step away from the player (the player is never pushed); the parked
//    train's car and the aprons in front of its platform doors are a solid keep-out for them (trainKeepout), and no spot / route
//    through it is ever chosen.
//  - NOT ENEMIES: a separate list, never in game.zombies — so never counted in kill memory / clear counts, lured by lights, alerted by
//    gunshots, given growls / zombie attacks, shoved by the physics walkers or carried as train cargo.
//  - Task studio-market-rework-20261108-074144-01 (lane COMBAT): they CAN be attacked (market/combat/marketCombat.ts: the player's
//    bullets / knife through their own hit volumes; one successful attack or a theft turns the settlement hostile). Once hostile the combat
//    system drives everyone (`takeover`: this calm frame stands aside), removes the fled (`remove`) and reuses `settle` for collision.
//  - LAZY MODEL: the cast file is a level-only lazy model (sectionModelKeys: only a layout with `market` asks for it); the people are
//    spawned in the section build (before the loading-screen warm-up, which therefore compiles them); teardown removes them.
//  - SEEDED: looks / posts / initial spots come from the station seed on this system's own hash streams (no game / generator RNG
//    draw); wanderers restart from their seeded spots on every visit (no save state).
//  - COST: one mixer per person; distant people advance their animation every 2nd / 4th frame (accumulated time, no drift).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Game} from '../game';
import type {MarketLayout, MarketSpot, MarketStall, MarketStallId} from '../gen/market/marketTypes';
import type {TrainPlacement} from '../gen/playerTrain';
import type {Waypoint} from '../gen/grid';
import type {Levels} from '../gen/levels';
import {moveCircle, resolveCircle, type PropIndex} from '../core/physics';
import {groundOf} from '../ai/motor';
import {hashString, mulberry32} from '../core/rng';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from '../world/playerTrainSpec';
import {HumanWardrobe} from './humanWardrobe';
import {HumanActor} from './humanActor';
import {MARKET_HUMAN_KEY, marketCast, marketHumanModelKeys, SPOT_CLIP, type HumanClip} from './humanLooks';

/** Tuning. */
export const MARKET_PEOPLE = {
  /** Body circle radius / clear height (m). */
  radius: 0.28, height: 1.75,
  /** Extra gap a person keeps to the player (m). */
  playerGap: 0.2,
  /** Turn rate (rad/s) walking / standing. */
  turnRate: 4.5,
  /** Waypoint reached / spot reached (m). */
  waypoint: 0.3, arrive: 0.35,
  /** Seconds at a spot, by its loop (min, max). */
  dwell: {Idle: [6, 16], Talk: [12, 30], Work: [14, 32], Sit: [20, 50]} as Record<string, [number, number]>,
  /** A walker making less than this progress (m) in `stuckS` seconds re-plans to another spot. */
  stuckM: 0.25, stuckS: 2.5,
  /** Path search budget (cells expanded). */
  maxExpand: 20000,
  /** Traders turn toward a player within `notice` m in front of the counter, by at most `turnMax` rad off their post. */
  notice: 4.5, turnMax: 1.05,
  /** Keep-out round the parked train: car footprint + `body` m; platform-door aprons `apron` m deep, `apronSide` m past the jambs. */
  keepout: {body: 0.6, apron: 1.6, apronSide: 0.5, band: 2.5},
  /** Animation LOD: full rate within `near` m of the player, every 2nd frame within `mid` m, else every 4th. */
  lod: {near: 16, mid: 34},
} as const;

/** A keep-out rectangle in world x / z. */
export interface KeepRect { x0: number; x1: number; z0: number; z1: number }

/**
 * The parked train's keep-out: its car footprint (+ MARKET_PEOPLE.keepout.body) and, in front of every door opening onto the platform,
 * an apron reaching `apron` m onto the platform. Empty without a placement.
 */
export function trainKeepout(p: TrainPlacement | null, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): KeepRect[] {
  if (!p) return [];
  const K = MARKET_PEOPLE.keepout;
  const out: KeepRect[] = [{x0: p.x0 - K.body, x1: p.x1 + K.body, z0: p.z - p.width / 2 - K.body, z1: p.z + p.width / 2 + K.body}];
  for (const d of spec.doors) {
    if (p.front * d.side !== p.platformSide) continue; // a door on the far side of the car
    const wx = p.x + p.front * d.x, za = p.platformEdgeZ, zb = p.platformEdgeZ + p.platformSide * K.apron;
    out.push({x0: wx - d.width / 2 - K.apronSide, x1: wx + d.width / 2 + K.apronSide, z0: Math.min(za, zb), z1: Math.max(za, zb)});
  }
  return out;
}

const inRect = (r: KeepRect, x: number, z: number, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

/** What the system needs of Game (structural: Node tests drive it with real levels / path finder and a stand-in model library). */
export interface MarketPeopleHost {
  scene: THREE.Scene;
  player: {x: number; y: number; z: number; radius: number};
  levels: Levels;
  propIndex: PropIndex | null;
  pathfinder: {find(ax: number, az: number, bx: number, bz: number, radius?: number, maxExpand?: number, opts?: {ay?: number; by?: number; noLinks?: boolean; drops?: boolean}): Waypoint[] | null};
  trainPlacement: TrainPlacement | null;
  propModels: {get(key: string): GLTF | undefined; catalogue?: Readonly<Record<string, unknown>>};
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  sectionModelKeys: ((layout: never) => readonly string[])[];
  atmosphere?: {markShadows(root: THREE.Object3D, cast: boolean): void} | null;
}

interface Trader { id: string; stall: MarketStall; actor: HumanActor; postYaw: number; rand: () => number; swapT: number }
interface Resident {
  /** (lane COMBAT) the person's id in the hostility record ('resident:<index>'). */
  id: string;
  index: number; actor: HumanActor; rand: () => number; speed: number;
  state: 'idle' | 'walk';
  /** Spot index it idles at / walks to. */
  spot: number;
  timer: number;
  path: Waypoint[] | null; wp: number;
  /** Stuck detection. */
  checkT: number; checkX: number; checkZ: number;
}

/** The contract's yaw (forward = (-sin, -cos)) -> the model's rotation (the humans face +Z: forward = (sin, cos)). */
export const modelYaw = (contractYaw: number) => contractYaw + Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turnToward = (yaw: number, target: number, max: number) => { const d = wrap(target - yaw); return yaw + Math.max(-max, Math.min(max, d)); };

export class MarketPeople {
  readonly traders: Trader[] = [];
  readonly residents: Resident[] = [];
  /** Spots a resident may use (walkable, off the train keep-out). */
  spots: MarketSpot[] = [];
  keepout: KeepRect[] = [];
  private wardrobe: HumanWardrobe | null = null;
  private market: MarketLayout | null = null;
  private tick = 0;
  /** QA / tests. */
  readonly counts = {built: 0, paths: 0, pathFails: 0, arrivals: 0, replans: 0, greetings: 0};
  /** Optional: called when a greeting starts (the trade lane may hook audio). */
  onGreet: ((stallId: MarketStallId) => void) | null = null;
  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): true = the combat system drives every person this frame (hostile). */
  takeover: (() => boolean) | null = null;

  constructor(readonly host: MarketPeopleHost) {}

  install(): this {
    const h = this.host;
    h.sectionModelKeys.push(marketHumanModelKeys as (layout: never) => readonly string[]);
    h.sectionHooks.push({build: (layout: never) => this.build(layout as {seed: number; market?: MarketLayout}), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    if (h.propModels.catalogue && !h.propModels.catalogue[MARKET_HUMAN_KEY]) console.warn('market people: the prop library has no market-human-cast entry (add MARKET_HUMAN_MODEL_FILES to its file map)');
    return this;
  }

  /** Every person (traders first). */
  get people(): HumanActor[] { return [...this.traders.map(t => t.actor), ...this.residents.map(r => r.actor)]; }

  /** Task studio-market-rework-20261108-074144-01 (lane COMBAT): every person with its record id (traders 'trader:<stall>', residents 'resident:<i>'). */
  get roster(): {id: string; actor: HumanActor; stall?: MarketStallId}[] {
    return [...this.traders.map(t => ({id: t.id, actor: t.actor, stall: t.stall.id})), ...this.residents.map(r => ({id: r.id, actor: r.actor}))];
  }

  /** (lane COMBAT) A person leaves the settlement for good (fled): out of the scene and the lists. */
  remove(actor: HumanActor): void {
    const t = this.traders.findIndex(x => x.actor === actor), r = this.residents.findIndex(x => x.actor === actor);
    if (t < 0 && r < 0) return;
    if (t >= 0) this.traders.splice(t, 1); else this.residents.splice(r, 1);
    actor.dispose();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Trade lane hooks

  /** A stall's trader: its feet position and the contract yaw it faces (forward = (-sin yaw, -cos yaw)); null when absent. */
  traderAt(stallId: MarketStallId): {x: number; y: number; z: number; yaw: number} | null {
    const t = this.traders.find(x => x.stall.id === stallId);
    return t ? {x: t.actor.x, y: t.actor.y, z: t.actor.z, yaw: wrap(t.actor.yaw - Math.PI)} : null;
  }

  /** A stall's trader greets the customer (a brief wave, then back to talking). */
  onTalk(stallId: MarketStallId): void {
    const t = this.traders.find(x => x.stall.id === stallId);
    if (!t || t.actor.busy) return;
    t.actor.play('Greet', 0.25);
    this.counts.greetings++;
    this.onGreet?.(stallId);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  build(layout: {seed: number; market?: MarketLayout}): void {
    this.teardown();
    const M = layout.market;
    if (!M) return;
    const gltf = this.host.propModels.get(MARKET_HUMAN_KEY);
    if (!gltf) { console.warn('market people: market-human-cast not loaded; the market has no people'); return; }
    if (this.wardrobe?.gltf !== gltf) { this.wardrobe?.dispose(); this.wardrobe = new HumanWardrobe(gltf); }
    const W = this.wardrobe;
    this.market = M;
    this.keepout = trainKeepout(this.host.trainPlacement);
    this.spots = M.spots.filter(s => !this.inKeepout(s.x, s.z, s.y, MARKET_PEOPLE.radius));
    const nRes = Math.min(Math.max(0, M.residents | 0), this.spots.length);
    const cast = marketCast(layout.seed, M.stalls.length, nRes, W.available);
    const seed = layout.seed >>> 0;
    M.stalls.forEach((stall, i) => {
      const actor = new HumanActor(W.build(cast.traders[i]), (i * 0.37) % 1);
      actor.x = stall.trader.x; actor.z = stall.trader.z; actor.y = stall.trader.y;
      actor.yaw = modelYaw(stall.trader.yaw);
      const rand = mulberry32(hashString(`market-trader:${stall.id}`, seed));
      actor.play(rand() < 0.6 ? 'Talk' : 'Idle', 0);
      this.add(actor);
      this.traders.push({id: `trader:${stall.id}`, stall, actor, postYaw: actor.yaw, rand, swapT: 4 + rand() * 8});
    });
    // residents start at distinct seeded spots, each with its own remaining dwell
    const order = this.spots.map((_, i) => i);
    const sh = mulberry32(hashString('market-resident-spots', seed));
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(sh() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let i = 0; i < nRes; i++) {
      const rand = mulberry32(hashString(`market-resident:${i}`, seed));
      const actor = new HumanActor(W.build(cast.residents[i]), rand());
      const s = this.spots[order[i]];
      actor.x = s.x; actor.z = s.z; actor.y = s.y; actor.yaw = modelYaw(s.yaw);
      const r: Resident = {id: `resident:${i}`, index: i, actor, rand, speed: actor.walkSpeed * (0.9 + rand() * 0.14), state: 'idle', spot: order[i], timer: 0, path: null, wp: 0, checkT: 0, checkX: s.x, checkZ: s.z};
      this.arrive(r, true);
      this.add(actor);
      this.residents.push(r);
    }
    this.counts.built++;
  }

  private add(a: HumanActor): void {
    a.sync();
    this.host.scene.add(a.root);
    this.host.atmosphere?.markShadows(a.root, false); // people block the flashlight beam like any body
  }

  teardown(): void {
    for (const a of this.people) a.dispose();
    this.traders.length = 0;
    this.residents.length = 0;
    this.market = null;
    this.spots = [];
    this.keepout = [];
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Keep-out

  /** (x, z) at feet height y lies in the train keep-out (grown by `margin`), on the car's storey band. */
  inKeepout(x: number, z: number, y: number, margin = 0): boolean {
    const p = this.host.trainPlacement;
    if (!p || Math.abs(y - p.floorY) > MARKET_PEOPLE.keepout.band) return false;
    return this.keepout.some(r => inRect(r, x, z, margin));
  }

  /** Push a body circle out of the keep-out (nearest rectangle edge). */
  private pushOut(a: HumanActor): void {
    const p = this.host.trainPlacement, R = MARKET_PEOPLE.radius;
    if (!p || Math.abs(a.y - p.floorY) > MARKET_PEOPLE.keepout.band) return;
    for (const r of this.keepout) {
      if (!inRect(r, a.x, a.z, R)) continue;
      const opts = [[r.x0 - R - a.x, 0], [r.x1 + R - a.x, 0], [0, r.z0 - R - a.z], [0, r.z1 + R - a.z]];
      let best = opts[0];
      for (const o of opts) if (Math.hypot(o[0], o[1]) < Math.hypot(best[0], best[1])) best = o;
      a.x += best[0]; a.z += best[1];
    }
  }

  /** A route sampled every 0.25 m stays out of the keep-out. */
  private routeClear(x: number, z: number, y: number, path: Waypoint[]): boolean {
    let px = x, pz = z, py = y;
    for (const w of path) {
      const wy = w[3] ?? py, d = Math.hypot(w[0] - px, w[1] - pz), n = Math.max(1, Math.ceil(d / 0.25));
      for (let k = 1; k <= n; k++) if (this.inKeepout(px + (w[0] - px) * k / n, pz + (w[1] - pz) * k / n, py + (wy - py) * k / n, MARKET_PEOPLE.radius * 0.5)) return false;
      px = w[0]; pz = w[1]; py = wy;
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Residents

  /** Settle at the current spot: its loop and a seeded dwell. */
  private arrive(r: Resident, initial = false): void {
    const s = this.spots[r.spot];
    r.state = 'idle'; r.path = null; r.wp = 0;
    const clip: HumanClip = r.actor.has(SPOT_CLIP[s.kind]) ? SPOT_CLIP[s.kind] : 'Idle';
    r.actor.play(clip, initial ? 0 : 0.6);
    const [a, b] = MARKET_PEOPLE.dwell[clip] ?? MARKET_PEOPLE.dwell.Idle;
    r.timer = (initial ? r.rand() : 1) * (a + r.rand() * (b - a));
    if (!initial) this.counts.arrivals++;
  }

  /** Pick a free spot and a route to it; false (and a short wait) when none was found this time. */
  private depart(r: Resident): boolean {
    const used = new Set(this.residents.filter(o => o !== r).map(o => o.spot));
    const a = r.actor;
    const cands = this.spots.map((s, i) => ({s, i})).filter(c => c.i !== r.spot && !used.has(c.i));
    // nearer spots are likelier (a settlement's short errands), any free spot possible
    const w = cands.map(c => 1 / (4 + Math.hypot(c.s.x - a.x, c.s.z - a.z, (c.s.y - a.y) * 3)));
    for (let tries = 0; tries < 3 && cands.length; tries++) {
      let total = 0; for (const v of w) total += v;
      let x = r.rand() * total, k = 0;
      for (; k < cands.length - 1; k++) { x -= w[k]; if (x < 0) break; }
      const c = cands[k];
      const path = this.host.pathfinder.find(a.x, a.z, c.s.x, c.s.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: a.y, by: c.s.y, noLinks: true});
      this.counts.paths++;
      if (path && path.length && this.routeClear(a.x, a.z, a.y, path)) {
        r.spot = c.i; r.path = path; r.wp = 0; r.state = 'walk';
        r.checkT = 0; r.checkX = a.x; r.checkZ = a.z;
        a.play('Walk', 0.35);
        return true;
      }
      this.counts.pathFails++;
      cands.splice(k, 1); w.splice(k, 1);
    }
    r.timer = 2 + r.rand() * 4;
    return false;
  }

  private stepResident(r: Resident, dt: number): number {
    const a = r.actor, P = MARKET_PEOPLE;
    if (r.state === 'idle') {
      const s = this.spots[r.spot];
      a.yaw = turnToward(a.yaw, modelYaw(s.yaw), P.turnRate * 0.5 * dt);
      // ease onto the spot itself (arrival tolerance, pushes)
      const dx = s.x - a.x, dz = s.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.02 && d < 1.2) { const k = Math.min(1, dt * 1.5); [a.x, a.z] = moveCircle(this.host.levels, this.host.propIndex, a.x, a.z, dx * k, dz * k, P.radius, a.y, P.height); }
      r.timer -= dt;
      if (r.timer <= 0) this.depart(r);
      return 0;
    }
    const path = r.path!;
    let wp = path[r.wp];
    while (wp && r.wp < path.length - 1 && Math.hypot(wp[0] - a.x, wp[1] - a.z) < P.waypoint) wp = path[++r.wp];
    const last = r.wp >= path.length - 1;
    const dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
    if (last && d < P.arrive) { this.arrive(r); return 0; }
    a.yaw = turnToward(a.yaw, Math.atan2(dx, dz), P.turnRate * dt);
    const align = Math.cos(wrap(Math.atan2(dx, dz) - a.yaw));
    const sp = r.speed * Math.max(0.15, align) * (last ? Math.min(1, 0.4 + d) : 1);
    const ox = a.x, oz = a.z;
    const step = Math.min(sp * dt, d);
    [a.x, a.z] = moveCircle(this.host.levels, this.host.propIndex, a.x, a.z, dx / (d || 1) * step, dz / (d || 1) * step, P.radius, a.y, P.height);
    // stuck (the player in a doorway, a crowd): another spot
    r.checkT += dt;
    if (r.checkT >= P.stuckS) {
      if (Math.hypot(a.x - r.checkX, a.z - r.checkZ) < P.stuckM) { this.counts.replans++; this.depart(r) || this.arrive(r); }
      r.checkT = 0; r.checkX = a.x; r.checkZ = a.z;
    }
    return Math.hypot(a.x - ox, a.z - oz) / Math.max(dt, 1e-6);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Frame

  /**
   * One walker's collision after its step: out of the train keep-out, out of walls / props (height-aware circle), feet on the floor.
   * (Task studio-market-rework-20261108-074144-01, lane COMBAT: shared with the hostile people's motion.)
   */
  settle(a: HumanActor): void {
    const h = this.host, R = MARKET_PEOPLE.radius;
    this.pushOut(a);
    [a.x, a.z] = resolveCircle(h.levels, h.propIndex, a.x, a.z, R, a.y, MARKET_PEOPLE.height);
    a.y = groundOf(h.levels, a.x, a.z, a.y);
  }

  /** (lane COMBAT) A path between two feet points (no ladder links), clear of the train keep-out; null when none. */
  route(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Waypoint[] | null {
    const path = this.host.pathfinder.find(ax, az, bx, bz, 0.34, MARKET_PEOPLE.maxExpand, {ay, by, noLinks: true});
    this.counts.paths++;
    if (path && path.length && this.routeClear(ax, az, ay, path)) return path;
    this.counts.pathFails++;
    return null;
  }

  frame(dt: number): void {
    if (!this.market || dt <= 0) return;
    if (this.takeover?.()) return; // (lane COMBAT: hostile — the combat system moves / animates everyone)
    const h = this.host, P = MARKET_PEOPLE, pl = h.player;
    this.tick++;
    const speeds = this.residents.map(r => this.stepResident(r, dt));
    // keep apart: residents from each other, from the (fixed) traders and from the player; then walls / props / the keep-out
    const all = this.people;
    for (const r of this.residents) {
      const a = r.actor;
      for (const o of all) {
        if (o === a || Math.abs(o.y - a.y) > 1) continue;
        const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), min = 2 * P.radius;
        if (d > 1e-4 && d < min) { const k = this.traders.some(t => t.actor === o) ? 1 : 0.5; a.x += dx / d * (min - d) * k; a.z += dz / d * (min - d) * k; }
      }
      const dx = a.x - pl.x, dz = a.z - pl.z, d = Math.hypot(dx, dz), min = P.radius + pl.radius + P.playerGap;
      if (d < min && Math.abs(pl.y - a.y) < 1) {
        if (d > 1e-4) { a.x += dx / d * (min - d); a.z += dz / d * (min - d); } else a.x += min;
      }
      this.settle(a);
    }
    // traders: at their posts; face a customer in front of the counter; alternate talking / idling
    for (const t of this.traders) {
      const a = t.actor;
      const dx = pl.x - a.x, dz = pl.z - a.z, d = Math.hypot(dx, dz);
      const toPlayer = Math.atan2(dx, dz), off = wrap(toPlayer - t.postYaw);
      const engaged = d < P.notice && Math.abs(pl.y - a.y) < 1.5 && Math.abs(off) < Math.PI / 2;
      a.yaw = turnToward(a.yaw, engaged ? t.postYaw + Math.max(-P.turnMax, Math.min(P.turnMax, off)) : t.postYaw, 2.5 * dt);
      t.swapT -= dt;
      if (engaged && a.loop !== 'Talk') a.play('Talk', 0.4);
      else if (t.swapT <= 0) { a.play(a.loop === 'Talk' ? 'Idle' : 'Talk', 0.5); t.swapT = 5 + t.rand() * 9; }
    }
    // animate (distance LOD) + sync
    all.forEach((a, i) => {
      const dist = Math.hypot(a.x - pl.x, a.z - pl.z);
      const stride = dist < P.lod.near ? 1 : dist < P.lod.mid ? 2 : 4;
      const ri = i - this.traders.length;
      a.animate(dt, ri >= 0 ? speeds[ri] : 0, stride, this.tick + i);
      a.sync();
    });
  }
}

/** Game wiring (Game's constructor): lazy model keys, section build / teardown, the frame hook. */
export function installMarketPeople(game: Game): MarketPeople {
  return new MarketPeople(game as unknown as MarketPeopleHost).install();
}
