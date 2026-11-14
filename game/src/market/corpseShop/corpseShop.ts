// Task studio-corpse-market-shop-20261114-031614-01 (user: "Spooky tucked-away shop / creepy guy buying zombie corpses only; floor chute
// deposit / physical Rail Ties payout / no corpse purchases"): THE CORPSE BUYER's RUNTIME (Game.corpseShop). The sale maths is pure
// (market/corpseShop/shopState.ts: startSale / advanceSale on the station's lane record, mutated in place and re-read every frame — a load /
// Retry replaces it); the den is the Market layout's version 4 (layout.market.den: gen/market/v4). Inert on every other layout.
//
// installCorpseShop(game) is called ONCE from the Game constructor (after the corpse system and the market's people / combat); it only
// REGISTERS: sectionModelKeys (the buyer's model on a layout with a den), sectionHooks (build: the buyer at his post behind the booth, a
// sale in progress picked up where its record stands; teardown: every visual goes, the record stays), frameHooks (the sink's registration,
// the sale clock, the visuals, the buyer's animation), promptProviders (the look-at line at the chute / booth) and warm pool
// 'market-corpse-buyer' (the buyer and the falling ties compile on the loading screen).
//
// SELLING (a BodySink of Game.corpses; corpse/api.ts): carrying a body, the eye within CORPSE_SHOP_RT.reach of the chute and the crosshair on
// it -> '[E] Drop the body down the chute · 10 Rail Ties', or a refusal (shopState corpseShopRefusal: hostile settlement / a sale running;
// a body that is not a carriable undead one) — refused bodies stay in the hands. take() first SPILLS any loot the body still holds (the
// host's corpseLoot seam: no body in this game holds any today — a future one is never silently lost) as pickups at the customer's spot,
// then converts the record to a station 'lying' record at the chute and startSale()s it in the same call; the buyer owns the body's object
// for the swallow visual (lifted head-down over the hopper, then slid down the shaft: below the floor it is gone) and disposes it
// (corpses.disposeBody) when the swallow ends. After a load mid-swallow the visual is rebuilt from the record (corpses.buildBody; null =
// none, the sale continues honestly).
// PAYING: the buyer counts (his Work clip), then pushes a bundle of Rail Ties through the booth's slot: it slides off the counter's front edge
// and falls to the floor in front of the booth (a kinematic visual of the ties' own pickup model). The instant it lands advanceSale()
// completes the sale and, in the SAME synchronous step, the bundle becomes a real world pickup of CORPSE_SHOP.price `rail_ties` at that
// spot (PickupManager.add: saved with the station's loose items like any dropped item) — never a wallet, never a teleport into the
// inventory. Several unclaimed bundles lie side by side (a few seeded spots round den.booth.tray).
// The settlement turned hostile (market/hostility.ts): the booth goes dark (the buyer steps out of sight) and offers are refused; a sale
// already running still completes. The buyer is NOT one of the market's people (never a combat target, never in their roster): he stays
// behind his welded booth, which takes the bullets (a solid prop box).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {BodyOffer, BodySink, CorpseSystemApi, HeldBody} from '../../corpse/api';
import {copyBody, type BodyRecordJSON} from '../../corpse/bodyRecord';
import {corpseCarriable} from '../../ai/corpseTrait';
import type {MarketDen, MarketLayout} from '../../gen/market/marketTypes';
import type {PropPlacement} from '../../gen/props';
import type {SectionKey} from '../../levels/types';
import type {ItemStack} from '../../items/inventory';
import {RAIL_TIES_ID} from '../../items/railTies';
import {CORPSE_BUYER_MODEL} from '../../assets/corpseBuyer.generated';
import {CORPSE_SHOP_KIT} from '../../assets/corpseShopKit.generated';
import {HumanWardrobe} from '../humanWardrobe';
import {HumanActor} from '../humanActor';
import {advanceSale, CORPSE_SHOP, CORPSE_SHOP_LANE, CORPSE_SHOP_TEXT, corpseShopProblem, corpseShopRefusal, freshCorpseShop, salePhase, startSale,
  type CorpsePayout, type CorpseShopJSON} from './shopState';

/** Tuning (one place). */
export const CORPSE_SHOP_RT = {
  /** Selling: the eye within this of the chute's footprint (m, horizontal) and the crosshair on its box within `look` (m). */
  reach: 1.7,
  look: 2.6,
  /** The look-at line: the crosshair on the chute or the booth within this (m). */
  hint: 3.2,
  /** The swallow: the body is turned head-down over the mouth until this share of swallowMs, then slides down the shaft. */
  lift: 0.32,
  /** It hangs this far above the rim when turned (m), and ends this far below the floor (m). */
  above: 0.08, below: 0.25,
  /** The bundle: the buyer's hand height (m above the floor), the slide along the counter (share of the drop), its fall's tumble (rad). */
  handY: 1.15, slide: 0.45, tumble: 1.1,
  /** Where the bundles land round den.booth.tray: offsets across the booth (m), cycled by sale uid. */
  spots: [0, -0.3, 0.3, -0.15, 0.15],
  /** The buyer's stare: the head turns toward the player by at most this (rad), smoothed at this rate (1/s), within this range (m). */
  stare: 1.0, stareRate: 3, stareRange: 7,
  /** A missing body visual (its model not loaded yet) is retried this often (s). */
  rebuildS: 1,
} as const;

/** The lazy prop-library file of the buyer (game.ts propModels). */
export const CORPSE_BUYER_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {[CORPSE_BUYER_MODEL.key]: {url: CORPSE_BUYER_MODEL.url, bytes: CORPSE_BUYER_MODEL.bytes}};

/** The buyer's model key on a layout with a den (game.ts sectionModelKeys; only a version-4 market ever fetches it). */
export function corpseBuyerModelKeys(layout: {market?: {den?: unknown}}): string[] {
  return layout.market?.den ? [CORPSE_BUYER_MODEL.key] : [];
}

interface V3 { x: number; y: number; z: number }

/** What the shop needs from Game (structural: tests drive it with a fake host). */
export interface CorpseShopHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: {x: number; y: number; z: number; alive: boolean};
  state: string;
  hud: {toast(text: string, warn?: boolean): void};
  run: {current: SectionKey; laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined; setLaneStore(lane: string, data: unknown, key?: SectionKey): void};
  layout: {market?: MarketLayout; props: readonly PropPlacement[]} | null;
  levels?: {raycast(o: V3, d: V3, maxDist: number, opts?: {props?: readonly PropPlacement[]}): {kind: string; t: number}} | null;
  pickups: {add(stack: ItemStack, x: number, y: number, z: number, yaw?: number): unknown; meshFor(itemId: string): THREE.Object3D};
  inv: {makeStack(itemId: string, count: number): ItemStack};
  propModels: {get(key: string): GLTF | undefined};
  corpses?: CorpseSystemApi | null;
  marketHostility?: {readonly hostile: boolean} | null;
  /** A loose item under the crosshair (its own [E] Take wins over the look-at line). */
  currentTarget?: unknown;
  sfx?: {bodyFall?(x: number, y: number, z: number, strength: number): void; marketCash?(): boolean};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  sectionModelKeys: ((layout: never) => readonly string[])[];
  promptProviders?: (() => string | null)[];
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  /**
   * Loot a body still holds, spilled as pickups at the customer's spot BEFORE the body is consumed (never silently lost). No body in this
   * game holds any (an enemy's finds are world items when it dies): absent = none.
   */
  corpseLoot?: (body: BodyRecordJSON) => readonly ItemStack[];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), V = new THREE.Vector3(), E = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
/** Bones that bound a body for the swallow (the shared rig's names; missing ones are skipped). */
const EXTENT_BONES = ['Head', 'Neck', 'Hips', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot', 'L_Shin', 'R_Shin'] as const;

/** A body going down the chute: its object, its start transform (world), the head-down pose over the mouth, its height. */
interface Swallow { uid: number; obj: THREE.Object3D; p0: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; low: number; high: number; dx: number; dz: number }

export class CorpseShop {
  /** The den of the built layout (null: no den here — everything is inert). */
  den: MarketDen | null = null;
  private key: SectionKey | null = null;
  private props: readonly PropPlacement[] = [];
  private buyer: HumanActor | null = null;
  private wardrobe: HumanWardrobe | null = null;
  private body: Swallow | null = null;
  private ties: THREE.Object3D | null = null;
  private tiesUid = 0;
  private warmTies: THREE.Object3D | null = null;
  private stareYaw = 0;
  private stareApplied = 0;
  private stareQ: THREE.Quaternion | null = null;
  private dt = 1 / 60;
  private acc = 0;
  private time = 0;
  private rebuildAt = 0;
  private sinkOwner: CorpseSystemApi | null = null;
  private dark = false;
  readonly sink: BodySink = {offer: held => this.offer(held), take: held => this.take(held)};
  readonly counts = {built: 0, sold: 0, paid: 0, refused: 0, spilled: 0, swallowed: 0, rebuilt: 0, disposed: 0};

  constructor(readonly host: CorpseShopHost) {}

  install(): this {
    const h = this.host;
    h.sectionModelKeys.push(corpseBuyerModelKeys as (layout: never) => readonly string[]);
    h.sectionHooks.push({build: (layout: never) => this.build(layout as {market?: MarketLayout; props: readonly PropPlacement[]}), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.promptProviders?.push(() => this.prompt());
    h.warmRegistry?.addPool('market-corpse-buyer', () => this.warmRoots());
    return this;
  }

  // --- the record ----------------------------------------------------------------------------------------------------

  /** THE record of this station (null: none yet — a fresh one is written on the first sale). Re-read every call. */
  record(): CorpseShopJSON | null {
    if (!this.key) return null;
    const r = this.host.run.laneStore<CorpseShopJSON>(CORPSE_SHOP_LANE, this.key);
    return r !== undefined && corpseShopProblem(r, corpseCarriable) === null ? r : null;
  }

  private writable(): CorpseShopJSON {
    const r = this.record();
    if (r) return r;
    const fresh = freshCorpseShop();
    this.host.run.setLaneStore(CORPSE_SHOP_LANE, fresh, this.key!);
    return fresh;
  }

  // --- section lifecycle ---------------------------------------------------------------------------------------------

  build(layout: {market?: MarketLayout; props: readonly PropPlacement[]}): void {
    this.teardown();
    const den = layout.market?.den ?? null;
    if (!den) return;
    this.den = den;
    this.props = layout.props;
    this.key = {...this.host.run.current};
    this.acc = 0;
    this.rebuildAt = 0;
    this.ensureBuyer();
    this.ensureWarmTies();
  }

  teardown(): void {
    this.dropBody();
    this.dropTies();
    this.buyer?.dispose();
    this.buyer = null;
    this.warmTies?.removeFromParent();
    this.warmTies = null;
    this.den = null;
    this.key = null;
    this.props = [];
  }

  /** The buyer at his post (once his model is in the library). */
  private ensureBuyer(): void {
    const den = this.den;
    if (!den || this.buyer) return;
    const gltf = this.host.propModels.get(CORPSE_BUYER_MODEL.key);
    if (!gltf) return;
    if (this.wardrobe?.gltf !== gltf) { this.wardrobe?.dispose(); this.wardrobe = new HumanWardrobe(gltf); }
    const a = new HumanActor(this.wardrobe.build({body: CORPSE_BUYER_MODEL.body, wear: {}, scale: 1}), 0.21);
    a.x = den.buyer.x; a.y = den.buyer.y; a.z = den.buyer.z;
    a.yaw = den.buyer.yaw + Math.PI; // (contract yaw: forward = (-sin, -cos); the model faces +Z)
    a.postPose = () => this.stare(a);
    a.play('Idle', 0);
    a.sync();
    this.host.scene.add(a.root);
    this.host.atmosphere?.markShadows(a.root, false);
    this.buyer = a;
    this.counts.built++;
  }

  /** A hidden bundle of ties beside the booth: its pipeline compiles on the loading screen (never on the first payout). */
  private ensureWarmTies(): void {
    const den = this.den;
    if (!den || this.warmTies) return;
    const o = this.host.pickups.meshFor(RAIL_TIES_ID);
    o.position.set(den.booth.tray.x, den.booth.tray.y, den.booth.tray.z);
    o.traverse(m => { if ((m as THREE.Mesh).isMesh) m.visible = false; });
    this.host.scene.add(o);
    this.warmTies = o;
  }

  private warmRoots(): THREE.Object3D[] {
    return [this.buyer?.root, this.warmTies].filter((o): o is THREE.Object3D => !!o);
  }

  // --- geometry ------------------------------------------------------------------------------------------------------

  private propOf(i: number): PropPlacement | null {
    return this.props[i] ?? null;
  }

  /** The booth's front direction (its prop's +Z: rot is a quarter turn). */
  private boothFront(): {x: number; z: number} {
    const b = this.den ? this.propOf(this.den.booth.prop) : null;
    const r = b?.rot ?? this.den?.booth.yaw ?? 0;
    return {x: Math.sin(r), z: Math.cos(r)};
  }

  /** Ray (o, unit d) vs a prop's world box: entry distance within [0, maxT], or null. */
  private rayProp(p: PropPlacement, o: V3, d: V3, maxT: number): number | null {
    let t0 = 0, t1 = maxT;
    const lo = [p.x - p.hx, p.y, p.z - p.hz], hi = [p.x + p.hx, p.y + p.h, p.z + p.hz], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < lo[k] || oo[k] > hi[k]) return null; continue; }
      let a = (lo[k] - oo[k]) / dd[k], b = (hi[k] - oo[k]) / dd[k];
      if (a > b) { const s = a; a = b; b = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    return t0;
  }

  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  /** What the crosshair is on: the chute / the booth (nearest, in sight, within `maxT`), with the eye's distance to the chute. */
  aim(maxT: number): {what: 'chute' | 'booth' | null; t: number; chuteDist: number} {
    const none = {what: null, t: Infinity, chuteDist: Infinity};
    const h = this.host, den = this.den;
    if (!den || !h.player.alive || h.state !== 'playing') return none;
    const chute = this.propOf(den.chute.prop), booth = this.propOf(den.booth.prop);
    if (!chute || !booth) return none;
    if (Math.hypot(h.player.x - den.front.x, h.player.z - den.front.z) > maxT + 4) return none; // (cheap reject)
    h.camera.updateMatrixWorld();
    h.camera.getWorldPosition(this.eye);
    h.camera.getWorldDirection(this.dir);
    const o = {x: this.eye.x, y: this.eye.y, z: this.eye.z}, d = {x: this.dir.x, y: this.dir.y, z: this.dir.z};
    const tc = this.rayProp(chute, o, d, maxT), tb = this.rayProp(booth, o, d, maxT);
    const what = tc !== null && (tb === null || tc <= tb) ? 'chute' : tb !== null ? 'booth' : null;
    const t = what === 'chute' ? tc! : what === 'booth' ? tb! : Infinity;
    if (what && h.levels) { // (a wall / another prop in between hides it)
      const hit = h.levels.raycast(o, d, t + 0.05, {props: this.props});
      if (hit.kind !== 'none' && hit.t < t - 0.05) return none;
    }
    const chuteDist = Math.hypot(Math.max(0, Math.abs(o.x - chute.x) - chute.hx), Math.max(0, Math.abs(o.z - chute.z) - chute.hz));
    return {what, t, chuteDist};
  }

  // --- the sink ------------------------------------------------------------------------------------------------------

  /** The station 'lying' record of a sold body (the sale's copy): at the chute, its storey. */
  saleRecord(r: BodyRecordJSON): BodyRecordJSON {
    const den = this.den!, b = copyBody(r);
    delete b.bones; delete b.hips; delete b.falling;
    b.pose = 'lying';
    b.x = +den.chute.x.toFixed(4); b.y = +den.chute.y.toFixed(4); b.z = +den.chute.z.toFixed(4);
    b.q = [0, 0, 0, 1];
    b.level = den.chute.level;
    return b;
  }

  /** BodySink.offer: in reach + looking at the chute -> sell, or why not (null: not ours). */
  offer(held: HeldBody): BodyOffer | null {
    const a = this.aim(CORPSE_SHOP_RT.look);
    if (a.what !== 'chute' || a.chuteDist > CORPSE_SHOP_RT.reach) return null;
    if (!corpseCarriable(held.record.arch)) return {ok: false, text: CORPSE_SHOP_TEXT.notUndead};
    const r = corpseShopRefusal(this.record() ?? freshCorpseShop(), {hostile: !!this.host.marketHostility?.hostile});
    if (r) return {ok: false, text: r};
    if (this.record()?.sold.includes(held.record.id)) return {ok: false, text: CORPSE_SHOP_TEXT.already}; // (never twice: cannot happen in play)
    return {ok: true, text: CORPSE_SHOP_TEXT.sell};
  }

  /** BodySink.take: the body is the buyer's now — its loot spilled first, its record the sale (same call), its object the swallow visual. */
  take(held: HeldBody): boolean {
    const o = this.offer(held);
    if (!o?.ok) { this.counts.refused++; return false; }
    this.spill(held.record);
    const st = this.writable();
    const job = startSale(st, this.saleRecord(held.record));
    this.counts.sold++;
    this.acc = 0;
    this.adoptBody(held.object, job.uid, 0);
    this.buyer?.play('Greet', 0.25);
    const den = this.den!;
    this.host.sfx?.bodyFall?.(den.chute.x, den.chute.rimY, den.chute.z, 0.5);
    return true;
  }

  /** Whatever loot the body still holds goes to the floor at the customer's spot first (none in this game today: the seam). */
  private spill(body: BodyRecordJSON): void {
    const loot = this.host.corpseLoot?.(body) ?? [];
    const den = this.den!;
    loot.forEach((s, i) => {
      const a = i * 2.39996;
      this.host.pickups.add(s, den.front.x + Math.cos(a) * 0.25, den.front.y + 0.004, den.front.z + Math.sin(a) * 0.25, a);
      this.counts.spilled++;
    });
  }

  // --- the swallow ---------------------------------------------------------------------------------------------------

  /** Own a body object as the swallow visual: its start transform (world), the head-down pose over the mouth, its extent. */
  private adoptBody(obj: THREE.Object3D, uid: number, ms: number): void {
    this.dropBody();
    const den = this.den!;
    obj.updateMatrixWorld(true);
    this.host.scene.attach(obj);
    obj.traverse(m => { if ((m as THREE.Mesh).isMesh) { m.frustumCulled = false; m.userData.level = den.chute.level; } });
    const p0 = obj.position.clone(), q0 = obj.quaternion.clone();
    // head-down over the mouth: the lying body's head is toward its root's -Z (corpse/bodyPose.ts) -> a pitch of -90 deg points it down,
    // its back to the booth (a yaw that turns the body's +Y toward the booth's front direction)
    const f = this.boothFront();
    const q1 = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-f.x, -f.z)).multiply(Q.setFromEuler(E.set(-Math.PI / 2, 0, 0)));
    // its extent in that pose (bones, at the origin): the lowest / highest point and the horizontal offset of its middle
    obj.position.set(0, 0, 0);
    obj.quaternion.copy(q1);
    obj.updateMatrixWorld(true);
    let low = Infinity, high = -Infinity, sx = 0, sz = 0, n = 0;
    for (const name of EXTENT_BONES) {
      const b = obj.getObjectByName(name);
      if (!b) continue;
      b.getWorldPosition(V);
      low = Math.min(low, V.y); high = Math.max(high, V.y); sx += V.x; sz += V.z; n++;
    }
    if (!n) { low = -1; high = 0.2; }
    low -= 0.12; high += 0.12; // (the skin round the bones)
    obj.position.copy(p0);
    obj.quaternion.copy(q0);
    obj.updateMatrixWorld(true);
    this.body = {uid, obj, p0, q0, q1, low, high, dx: n ? sx / n : 0, dz: n ? sz / n : 0};
    this.counts.swallowed++;
    this.poseBody(ms);
  }

  /** The visual at the sale's ms: turned head-down over the mouth, then down the shaft. */
  private poseBody(ms: number): void {
    const b = this.body, den = this.den;
    if (!b || !den) return;
    const t = clamp01(ms / CORPSE_SHOP.swallowMs), L = CORPSE_SHOP_RT.lift;
    // over the mouth: the lowest point just above the rim; at the end: the highest point below the floor
    const x1 = den.chute.x - b.dx, z1 = den.chute.z - b.dz;
    const yTop = den.chute.rimY + CORPSE_SHOP_RT.above - b.low, yEnd = den.chute.y - CORPSE_SHOP_RT.below - b.high;
    if (t < L) {
      const k = ease(t / L);
      b.obj.position.set(b.p0.x + (x1 - b.p0.x) * k, b.p0.y + (yTop - b.p0.y) * k, b.p0.z + (z1 - b.p0.z) * k);
      b.obj.quaternion.copy(Q2.copy(b.q0).slerp(b.q1, k));
    } else {
      const k = (t - L) / (1 - L);
      b.obj.position.set(x1, yTop + (yEnd - yTop) * k * k, z1); // (accelerating: it drops down the shaft)
      b.obj.quaternion.copy(b.q1);
    }
    b.obj.updateMatrixWorld(true);
  }

  /** Dispose the body visual (the corpse system frees its model). */
  private dropBody(): void {
    const b = this.body;
    if (!b) return;
    this.body = null;
    b.obj.removeFromParent();
    this.host.corpses?.disposeBody(b.obj);
    this.counts.disposed++;
  }

  // --- the ties ------------------------------------------------------------------------------------------------------

  /** Where sale `uid`'s bundle lands (on the floor round den.booth.tray, across the booth) and its resting yaw. */
  landing(uid: number): {x: number; y: number; z: number; yaw: number} {
    const den = this.den!, f = this.boothFront(), o = CORPSE_SHOP_RT.spots[(uid - 1) % CORPSE_SHOP_RT.spots.length];
    const yaw = Math.atan2(f.x, f.z) + Math.PI / 2 + (((uid * 0.6180339887) % 1) - 0.5) * 0.6;
    return {x: den.booth.tray.x + f.z * o, y: den.booth.tray.y, z: den.booth.tray.z - f.x * o, yaw};
  }

  /** The falling bundle at the sale's ms (drop phase): from the buyer's hand through the slot, off the counter's edge, to the floor. */
  private poseTies(uid: number, ms: number): void {
    const den = this.den;
    if (!den) return;
    if (!this.ties || this.tiesUid !== uid) {
      this.dropTies();
      this.ties = this.host.pickups.meshFor(RAIL_TIES_ID);
      this.ties.traverse(m => { if ((m as THREE.Mesh).isMesh) m.userData.level = den.booth.level; });
      this.host.scene.add(this.ties);
      this.tiesUid = uid;
    }
    const t = clamp01((ms - CORPSE_SHOP.dropMs) / (CORPSE_SHOP.saleMs - CORPSE_SHOP.dropMs)), S = CORPSE_SHOP_RT.slide;
    const f = this.boothFront(), land = this.landing(uid), K = CORPSE_SHOP_KIT.booth;
    const top = den.booth.y + (K.counterY ?? 0.9) + 0.01;
    const edge = {x: den.booth.x + f.x * (K.counterZ ?? 0.2), z: den.booth.z + f.z * (K.counterZ ?? 0.2)};
    const hand = {x: den.buyer.x, y: den.buyer.y + CORPSE_SHOP_RT.handY, z: den.buyer.z};
    const o = this.ties;
    if (t < S) { // in the hand, then pushed through the slot onto the counter
      const k = ease(t / S);
      o.position.set(hand.x + (edge.x - hand.x) * k, hand.y + (top - hand.y) * Math.min(1, k * 1.6), hand.z + (edge.z - hand.z) * k);
      o.rotation.set(0, land.yaw, 0);
    } else { // off the edge: a fall to the floor with a little tumble
      const k = (t - S) / (1 - S);
      o.position.set(edge.x + (land.x - edge.x) * k, top + (land.y - top) * k * k, edge.z + (land.z - edge.z) * k);
      o.rotation.set(Math.sin(k * Math.PI) * CORPSE_SHOP_RT.tumble * 0.4, land.yaw, Math.sin(k * Math.PI) * CORPSE_SHOP_RT.tumble);
    }
  }

  private dropTies(): void {
    const o = this.ties;
    if (!o) return;
    this.ties = null;
    this.tiesUid = 0;
    o.removeFromParent();
    o.traverse(m => { const mm = m as THREE.Mesh; if (mm.isMesh && !mm.userData.shared) mm.geometry.dispose(); });
  }

  /** The completion instant (same step as advanceSale): the bundle is a real Rail Ties pickup where it landed. */
  private payout(pay: CorpsePayout): void {
    const h = this.host, land = this.landing(pay.uid);
    this.dropTies();
    h.pickups.add(h.inv.makeStack(RAIL_TIES_ID, pay.ties), land.x, land.y, land.z, land.yaw);
    this.counts.paid++;
    h.sfx?.bodyFall?.(land.x, land.y + 0.1, land.z, 0.18);
    h.sfx?.marketCash?.();
    h.hud.toast(CORPSE_SHOP_TEXT.sold);
  }

  // --- frame ---------------------------------------------------------------------------------------------------------

  frame(dt: number): void {
    const den = this.den;
    if (!den) return;
    this.time += dt;
    const h = this.host;
    this.ensureSink();
    this.ensureBuyer();
    const st = this.record();
    const job = st?.job ?? null;
    if (job && h.state === 'playing') {
      this.acc += dt * 1000;
      const step = Math.floor(this.acc);
      this.acc -= step;
      const was = job.ms;
      const pay = advanceSale(st!, step);
      if (pay) this.payout(pay);
      else this.sync(job.uid, job.ms, was);
    } else if (!job) {
      if (this.body) this.dropBody();
      if (this.ties) this.dropTies();
    }
    this.animateBuyer(dt, st?.job ? salePhase(st.job.ms) : null);
  }

  /** The visuals follow the record (a load / Retry mid-sale: rebuilt from it). */
  private sync(uid: number, ms: number, was: number): void {
    const phase = salePhase(ms), den = this.den!;
    if (phase === 'swallow') {
      if (this.body && this.body.uid !== uid) this.dropBody();
      if (!this.body && this.time >= this.rebuildAt) { // (a load mid-swallow: the body back from its record)
        const job = this.record()?.job;
        const obj = job ? this.host.corpses?.buildBody(job.body) ?? null : null;
        if (obj) { this.adoptBody(obj, uid, ms); this.counts.rebuilt++; } else this.rebuildAt = this.time + CORPSE_SHOP_RT.rebuildS;
      }
      this.poseBody(ms);
      const thud = CORPSE_SHOP.swallowMs * 0.85;
      if (was < thud && ms >= thud) this.host.sfx?.bodyFall?.(den.chute.x, den.chute.y - 0.6, den.chute.z, 0.9);
    } else if (this.body) this.dropBody();
    if (phase === 'drop') this.poseTies(uid, ms);
  }

  /** The buyer: dark (out of sight) while the settlement is hostile; counting during a sale; always watching the player. */
  private animateBuyer(dt: number, phase: 'swallow' | 'count' | 'drop' | null): void {
    const a = this.buyer;
    if (!a) return;
    const dark = !!this.host.marketHostility?.hostile;
    if (dark !== this.dark) { this.dark = dark; a.root.visible = !dark; }
    if (dark) return;
    const want = phase === 'count' || phase === 'drop' ? 'Work' : 'Idle';
    if (a.loop !== want) a.play(want, 0.35); // (a greeting running: it returns to this loop)
    this.dt = dt;
    a.animate(dt);
    a.sync();
  }

  /**
   * postPose: the head turns toward the player (smoothed, bounded) — a still, watchful stare. On top of the clip's head rotation; a clip that
   * leaves the head alone gets last frame's turn undone first (never an accumulating spin).
   */
  private stare(a: HumanActor): void {
    const h = this.host, head = a.bone('Head');
    if (!head) return;
    if (this.stareQ && head.quaternion.equals(this.stareQ)) head.quaternion.multiply(Q.setFromAxisAngle(UP, -this.stareApplied));
    const dx = h.player.x - a.x, dz = h.player.z - a.z;
    const near = Math.hypot(dx, dz) < CORPSE_SHOP_RT.stareRange;
    const target = near ? Math.max(-CORPSE_SHOP_RT.stare, Math.min(CORPSE_SHOP_RT.stare, wrap(Math.atan2(dx, dz) - a.yaw))) : 0;
    this.stareYaw += (target - this.stareYaw) * Math.min(1, CORPSE_SHOP_RT.stareRate * this.dt);
    head.quaternion.multiply(Q.setFromAxisAngle(UP, this.stareYaw));
    this.stareApplied = this.stareYaw;
    (this.stareQ ??= new THREE.Quaternion()).copy(head.quaternion);
  }

  /** The corpse system (installed earlier or later): the sink is registered once it exists. */
  private ensureSink(): void {
    const c = this.host.corpses ?? null;
    if (!c || c === this.sinkOwner) return;
    c.addSink(this.sink);
    this.sinkOwner = c;
  }

  // --- the look-at line ----------------------------------------------------------------------------------------------

  prompt(): string | null {
    const den = this.den, h = this.host;
    if (!den || h.currentTarget || h.corpses?.held()) return null; // (a loose item's Take / the carry's own prompt win)
    const a = this.aim(CORPSE_SHOP_RT.hint);
    if (!a.what) return null;
    if (h.marketHostility?.hostile) return CORPSE_SHOP_TEXT.closed;
    const job = this.record()?.job;
    if (job && salePhase(job.ms) !== 'swallow') return CORPSE_SHOP_TEXT.counting;
    return CORPSE_SHOP_TEXT.hint;
  }

  // --- QA ------------------------------------------------------------------------------------------------------------

  qa() {
    const r = this.record();
    return {den: !!this.den, buyer: !!this.buyer, buyerVisible: !!this.buyer?.root.visible, buyerClip: this.buyer?.current ?? null,
      body: !!this.body, ties: !!this.ties, record: r ? JSON.parse(JSON.stringify(r)) as CorpseShopJSON : null, counts: {...this.counts}};
  }
}

export function installCorpseShop(game: unknown): CorpseShop {
  return new CorpseShop(game as CorpseShopHost).install();
}
