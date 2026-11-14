// Task studio-refinement-batch-20261113-035659-01: the CRAFTED THROWABLES' canisters — the Acid Scrapper grenade and the Zombie Lure
// grenade (items/grenades.ts; crafted at the train's bench from bio mater, craft/recipes.ts MADE_RECIPES).
//
// THROW: exactly the flare's input (G from the grenade slot, or hold click while one is in the hand: weapons/flareHold.ts; Game.throwHeld
// dispatches by item id). ONE item is consumed only when the throw happens (refused at the cap / cooldown / without physics, with a HUD
// message and nothing removed: throwOneGrenade, the throwOneFlare rule).
//  - Physics: a cannon-es body (the ~0.15 m canister as two spheres r 34 mm along its axis, 0.32 kg, 'metal' contact) in the station's
//    bounded world (physics/world.ts BodySource: the world steps while one flies and keeps the static chunks around it), thrown from just
//    right of / below the eye at 10 m/s along the view + 2.4 m/s up + the player's velocity, tumbling. Ground clamp + an out-of-world
//    guard (restore the last good pose), like the flare.
//  - ZOMBIES: every step the canister's path (last -> now) is tested against the live enemies' hit volumes (combat/enemyRay.ts, the
//    bullets' own test): a hit stops it there.
//
// ACID (user: "Throw at zombies or props; damage zombies and stick to props ... 10-active-second acid pool harming all exposed actors
// (incl. player) and eligible props"):
//  - a ZOMBIE hit bursts it at once: ACID.direct damage to that zombie;
//  - touching a PROP the acid can melt (world/acidMelt.ts atPoint: the melt system's own eligibility — never the train, its fitted
//    fixtures or building structure) it STICKS there (no body; it follows the prop) and bursts ACID.stickFuse later, the prop starting
//    to melt at that burst (AcidMelt.start);
//  - anything else (floor, wall, the train, a fixture): a hard hit (>= ACID.burstSpeed) bursts it, a soft one bounces; at rest it bursts.
//  BURST: a splash (ACID.splash to the zombies, ACID.playerSplash to the player within ACID.splashR — the thrower too) and an ACID POOL on
//  the floor under the burst: a disc of ACID.poolR for ACID.poolSeconds ACTIVE seconds (it only ages while the game updates: paused /
//  menus / loading never spend it). Everyone standing in it burns — zombies ACID.zombieDps (a shambler ~3.3 s), the player ACID.playerDps
//  (no armour: it is not a hit) — counted every frame, applied in ACID.burnEvery batches (a zombie's damage() re-plans it, so never per
//  frame; the source is the zombie's own feet, so the burn never draws it into the pool), the strength thinning with the film as it dries.
//  Every ACID.propEvery s the melt system is told which eligible props it touches (AcidMelt.expose: after MELT.exposure s they melt; one
//  salvage each, contents spilled — world/acidMelt.ts). One function decides "in the pool" for damage AND for what is drawn (inPool over
//  the film's drawn radius, poolReach). The pool is a LIQUID: a glossy yellow-green film with a few bubbles, never a gas / fog volume
//  (CLAUDE.md's green-fog rule is for toxic gas). At most ACID.maxPools pools + acid canisters not yet burst at once (refused with a
//  message, nothing consumed). An acid kill crumples (ACID.killImpulse), it is no blast.
//
// LURE (user: "Scent reaches 20 m without LOS for 20 active seconds. Zombies investigate the ACTUAL emitter, not the player"; the reach
// is ai/scentLure.ts SCENT.radius — 30 m since task studio-scanner-console-refinements-20261114-031614-01):
//  - it lands, rolls and comes to rest (a zombie hit just stops it); at rest it OPENS: a scent emitter at the canister itself
//    (env.scents: ai/scentLure.ts ScentLures — the AI side: reach, no line of sight, path-finding to the emitter) for LURE.seconds active
//    seconds, with a faint tan vent plume (the atmosphere smoke API; not green, not a hazard) and a hiss; then it is spent, the empty
//    canister lies there LURE.husk s and goes. At most LURE.maxActive at once.
//
// clear() (new station / retry; also via PhysicsSystem.dispose) removes canisters, pools, emitters and plumes silently.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_STATIC} from '../physics/ragdoll';
import {groundClamp, restTime, type BodyHost} from '../physics/chunks';
import type {BodySource} from '../physics/world';
import {nearestEnemyHit, type RayEnemy} from '../combat/enemyRay';
import {itemDims} from '../items/items';
import {grenadeKind, type GrenadeId} from '../items/grenades';
import {grenadeModel} from '../world/grenadeModels';
import type {FlareSmokeHost, SmokeHandle} from './throwables';
import {SCENT} from '../ai/scentLure';

export const GRENADE = {
  /** Seconds between throws (any grenade). */
  cooldown: 0.6,
  throwSpeed: 10,
  throwLift: 2.4,
  /** End-over-end tumble (rad/s). */
  spin: 7,
  mass: 0.32,
  /** The canister's collider: two spheres of this radius, this far either side of its centre along its axis. */
  radius: 0.034,
  halfAxis: 0.038,
  /** Still moving after this long: laid down where it is (s). */
  maxFlight: 8,
  /** Seconds still before it counts as at rest. */
  restAfter: 0.3,
} as const;

export const ACID = {
  /** Seconds a canister stuck to a prop waits before it bursts. */
  stickFuse: 0.9,
  /** Impact speed (m/s) into a surface it cannot stick to that bursts it at once (a softer hit bounces). */
  burstSpeed: 4.5,
  /** Damage to a zombie the canister hits directly. */
  direct: 45,
  /** Splash damage at the burst to zombies / to the player within splashR (m). */
  splash: 20,
  playerSplash: 8,
  splashR: 1.3,
  /** The pool: radius (m), active seconds, damage per second to zombies / to the player standing in it. */
  poolR: 1.5,
  poolSeconds: 10,
  zombieDps: 30,
  playerDps: 7,
  /** Feet this far (m) above / below the pool's film still stand in it; a body whose centre is within footR (m) of the film's edge has a foot in it. */
  poolRise: 0.45,
  footR: 0.12,
  /** Seconds between the pool's burn batches (the time each actor stood in it, applied at once). */
  burnEvery: 0.25,
  /** The ragdoll impulse of an acid kill (a pistol kill is 38, a shotgun blast up to ~107): it crumples. */
  killImpulse: 12,
  /** Seconds between the player's pain cues (HUD pulse + grunt) while the acid burns. */
  painEvery: 0.9,
  /** Seconds between the pool's prop exposure passes (AcidMelt.inDisc / expose). */
  propEvery: 0.2,
  /** Pools + acid canisters in flight / stuck at once. */
  maxPools: 3,
  /** Pool look: fade in / out (s), film colour, a few bubbles. */
  fadeIn: 0.3,
  fadeOut: 1.6,
  color: 0xa8d02a,
  bubbles: 10,
  /** Seconds between the pool's fizz cues. */
  fizzEvery: 2.6,
} as const;

export const LURE = {
  /** Active seconds the scent works (ai/scentLure.ts SCENT.seconds: 20). */
  seconds: SCENT.seconds,
  /** Lures out at once (= the emitters' cap, SCENT.max). */
  maxActive: SCENT.max,
  /** Seconds the spent canister lies there afterwards. */
  husk: 15,
  /** The vent plume (atmosphere smoke API): tan, faint, small — scent, not smoke and not a gas hazard. */
  smoke: {color: 0x8a7656, rate: 0.35, radius: 0.55, life: 2.6},
} as const;

export type GrenadeKind = 'acid' | 'lure';
export type GrenadeRefusal = 'cap' | 'cooldown' | 'unavailable';

/** The melt system's seam (world/acidMelt.ts AcidMelt). */
export interface MeltRefLike { readonly key: string; readonly x: number; readonly y: number; readonly z: number; readonly label: string }
export interface AcidMeltLike {
  inDisc(x: number, y: number, z: number, r: number): MeltRefLike[];
  atPoint(x: number, y: number, z: number, r?: number): MeltRefLike | null;
  expose(ref: MeltRefLike, dt: number): boolean;
  start(ref: MeltRefLike): boolean;
  alive(ref: MeltRefLike): boolean;
  where(ref: MeltRefLike, out: {x: number; y: number; z: number}): boolean;
}
/** The scent emitters' seam (ai/scentLure.ts ScentLures). */
export interface ScentEmitterLike { readonly id: number }
export interface ScentHostLike {
  add(p: {x: number; y: number; z: number; level?: number}, opts?: {seconds?: number}): ScentEmitterLike | null;
  remove(e: ScentEmitterLike): void;
  /** The canister moved (an elevator cab carried it): the scent comes from where it is now. */
  move?(e: ScentEmitterLike, p: {x: number; y: number; z: number; level?: number}): void;
}
/** What a canister / pool hurts (EnemyActor satisfies it). */
export interface GrenadeEnemy extends RayEnemy {
  readonly brain: {readonly alive: boolean; x: number; y: number; z: number; damage(amount: number, fromX: number, fromZ: number, fromY?: number, o?: {stagger?: boolean}): boolean};
  hitFlash: number;
}
export interface GrenadeAudio {
  breakage?(cue: 'breakGlass', x: number, y: number, z: number, strength?: number): void;
  flareIgnite?(x: number, y: number, z: number): void;
  flareOut?(x: number, y: number, z: number): void;
  physImpact?(x: number, y: number, z: number, speed: number, family: 'light' | 'heavy', mass?: number, a?: unknown, b?: string): void;
}
export interface GrenadeEnv {
  /** The live enemies (Game.zombies). */
  zombies?(): readonly GrenadeEnemy[];
  /** The player (Game.player): splash / pool burns go straight to takeDamage (not an attack: no armour, no injury roll). */
  player?(): {x: number; y: number; z: number; alive: boolean; takeDamage(amount: number): void} | null;
  /** A zombie the acid killed: the game's kill bookkeeping + ragdoll at `strength` (Game.blastKill). */
  kill?(z: GrenadeEnemy, dir: THREE.Vector3, point: THREE.Vector3, strength: number): void;
  /** A zombie the acid hurt (its hurt cue). */
  hurt?(z: GrenadeEnemy): void;
  /** The player stepped into a pool (a HUD hint, once per pool). */
  playerBurn?(): void;
  /** The acid hurt the player (the splash, or a burn — at most every ACID.painEvery s): the pain feedback (HUD pulse + grunt). */
  playerHurt?(amount: number): void;
  melt?(): AcidMeltLike | null;
  scents?(): ScentHostLike | null;
  smoke?: FlareSmokeHost | null;
  audio?: GrenadeAudio | null;
  /** Storey of a world point (gen/levels.ts levelAt). */
  levelAt?(x: number, z: number, y: number): number;
  /** 3D line of sight (never throw through a wall the player leans on). */
  lineOfSight?(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}): boolean;
  /** A burst is heard (Game.worldNoise). */
  noise?(x: number, y: number, z: number): void;
}
export interface GrenadeHost extends BodyHost {
  addSource(s: BodySource): void;
}

type CanisterState = 'flying' | 'stuck' | 'resting' | 'venting' | 'spent';

export interface Canister {
  readonly id: number;
  readonly kind: GrenadeKind;
  readonly itemId: GrenadeId;
  state: CanisterState;
  body: CANNON.Body | null;
  readonly root: THREE.Group;
  /** Seconds since the throw / in the current state. */
  age: number;
  t: number;
  restT: number;
  soundT: number;
  rescues: number;
  badT: number;
  readonly last: THREE.Vector3;
  readonly lastQ: THREE.Quaternion;
  /** Where the body was at the previous tick (the zombie path test). */
  readonly prev: THREE.Vector3;
  /** Acid: stuck to this prop (its offset from the prop's reference point). */
  stuck: {ref: MeltRefLike; ox: number; oy: number; oz: number} | null;
  /** Set by a contact during the step; handled in tick (no world changes inside cannon's step). */
  hit: {v: number} | null;
  emitter: ScentEmitterLike | null;
  smoke: SmokeHandle | null;
}

export interface AcidPool {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly level?: number;
  readonly r: number;
  /** Active seconds left / since it formed. */
  left: number;
  age: number;
  /** Seconds into the current burn batch; each zombie's / the player's exposure in it (s x the film's strength). */
  burnT: number;
  readonly burning: Map<GrenadeEnemy, number>;
  playerS: number;
  propT: number;
  fizzT: number;
  burned: boolean;
  readonly mesh: THREE.Mesh;
  readonly bubbles: THREE.InstancedMesh;
  readonly mat: THREE.MeshStandardMaterial;
  readonly seeds: Float32Array;
}

/** A canister model + its centre offset (the model's origin is its bottom centre). */
const centreY = (id: GrenadeId) => itemDims(id).h / 2;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Throw one grenade from an inventory: nothing is removed when the throw would be refused or there is none; otherwise `takeOne()`
 * removes EXACTLY one item first and the throw follows (it cannot fail then).
 */
export function throwOneGrenade(sys: GrenadeSystem, itemId: GrenadeId, takeOne: () => boolean, hasOne: () => boolean, eye: {x: number; y: number; z: number}, dir: {x: number; y: number; z: number}, inherit: {x?: number; y?: number; z?: number} = {}): {ok: true; canister: Canister} | {ok: false; reason: GrenadeRefusal | 'none'} {
  if (!hasOne()) return {ok: false, reason: 'none'};
  const why = sys.refusal(itemId);
  if (why) { sys.counts.refused++; return {ok: false, reason: why}; }
  if (!takeOne()) return {ok: false, reason: 'none'};
  return sys.throw(itemId, eye, dir, inherit);
}

/**
 * Game's throw dispatch (ONE hold for every throwable, weapons/flareHold.ts): the item a grenade-style hold is about — the readied one
 * while a hold is active, else the grenade slot's on a G press, else the held throwable on a click. Its count and its own system's
 * refusal (a grenade's GrenadeSystem, a flare's FlareSystem) are the hold's `flares` / `refusal` inputs; the release throws it.
 */
export function throwHoldTarget(o: {active: boolean; readied: string | null; keyPressed: boolean; slot: string | null; mousePressed: boolean; held: string | null; heldThrowable: boolean}): string | null {
  return o.active ? o.readied : o.keyPressed ? o.slot : o.mousePressed && o.heldThrowable ? o.held : null;
}

/** The film's drawn radius now: it spreads from 40 % to the full ACID.poolR over ACID.fadeIn (drawPool scales the disc by exactly this). */
export function poolReach(p: Pick<AcidPool, 'r' | 'age'>): number {
  return p.r * (0.4 + 0.6 * Math.min(1, p.age / ACID.fadeIn));
}
/** The film's strength now (0..1): its opacity's fade in / out — the burn thins with it as the pool dries. */
export function poolStrength(p: Pick<AcidPool, 'age' | 'left'>): number {
  return Math.max(0, Math.min(1, p.age / ACID.fadeIn, p.left / ACID.fadeOut));
}
/** Is a point (feet) inside a pool: THE test for its damage and for what it melts — the drawn disc (+ `pad`: a body's foot reach). */
export function inPool(p: Pick<AcidPool, 'x' | 'y' | 'z' | 'r' | 'age'>, x: number, y: number, z: number, pad = 0): boolean {
  const dx = x - p.x, dz = z - p.z, r = poolReach(p) + pad;
  return dx * dx + dz * dz <= r * r && Math.abs(y - p.y) <= ACID.poolRise;
}

let poolGeo: THREE.CircleGeometry | null = null;
let bubbleGeo: THREE.SphereGeometry | null = null;

export class GrenadeSystem implements BodySource {
  readonly group = new THREE.Group();
  readonly canisters: Canister[] = [];
  readonly pools: AcidPool[] = [];
  env: GrenadeEnv = {};
  cooldown = 0;
  private nextId = 1;
  private readonly tv = new THREE.Vector3();
  private readonly tseg = new THREE.Vector3();
  private readonly tq = new THREE.Quaternion();
  private readonly tm = new THREE.Matrix4();
  private readonly tw = {x: 0, y: 0, z: 0};
  /** Counters (QA / tests). */
  readonly counts = {thrown: 0, refused: 0, stuck: 0, bursts: 0, pools: 0, poolsDried: 0, zombieHits: 0, kills: 0, playerBurnS: 0, exposures: 0,
    lures: 0, luresSpent: 0, removed: 0, rescued: 0, clamped: 0, cleared: 0};

  constructor(parent: THREE.Object3D, private readonly host: GrenadeHost, private readonly rng: () => number = Math.random) {
    this.group.name = 'grenades';
    parent.add(this.group);
    host.addSource(this);
  }

  // BodySource -----------------------------------------------------------------------------------
  get awake(): number {
    let n = 0;
    for (const c of this.canisters) if (c.body) n++;
    return n;
  }
  activePoints(out: CANNON.Vec3[]): void {
    for (const c of this.canisters) if (c.body) out.push(c.body.position);
  }

  /** BodySource.carry (lane LIFT): resting canisters and pools inside the moving elevator cab ride its dy. */
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number): void {
    for (const c of this.canisters) {
      const p = c.root.position;
      if (c.body || c.stuck || !inside(p.x, p.y, p.z)) continue;
      p.y += dy;
      c.root.updateMatrixWorld(true);
      c.last.y += dy;
      if (c.emitter) this.moveScent(c);
    }
    for (const q of this.pools) {
      if (!inside(q.x, q.y, q.z)) continue;
      (q as {y: number}).y += dy;
      q.mesh.position.y += dy;
      q.bubbles.position.y += dy;
    }
  }

  /** BodySource.relocate (lane LIFT): a resting canister in a doorway the landing doors shut on goes to the nearer side. */
  relocate(move: (x: number, y: number, z: number) => [number, number] | null): void {
    for (const c of this.canisters) {
      if (c.body || c.stuck) continue;
      const p = c.root.position, to = move(p.x, p.y, p.z);
      if (!to) continue;
      p.x = to[0]; p.z = to[1];
      c.root.updateMatrixWorld(true);
      if (c.emitter) this.moveScent(c);
    }
  }

  /** A venting lure was moved (elevator): its emitter and its plume follow the canister. */
  private moveScent(c: Canister): void {
    const p = this.centre(c, new THREE.Vector3());
    this.env.scents?.()?.move?.(c.emitter!, {x: p.x, y: p.y, z: p.z, level: this.levelOf(p.x, p.y, p.z)});
    c.smoke?.update?.({x: p.x, y: p.y + 0.1, z: p.z});
  }

  /** Pools + acid canisters not yet burst (the acid cap counts these). */
  get acidCount(): number {
    let n = this.pools.length;
    for (const c of this.canisters) if (c.kind === 'acid' && (c.state === 'flying' || c.state === 'stuck')) n++;
    return n;
  }

  /** Lure canisters not yet spent (the lure cap counts these). */
  get lureCount(): number {
    let n = 0;
    for (const c of this.canisters) if (c.kind === 'lure' && c.state !== 'spent') n++;
    return n;
  }

  /** Why a throw of `itemId` would be refused right now (null = OK). */
  refusal(itemId: GrenadeId): GrenadeRefusal | null {
    if (!this.host.world) return 'unavailable';
    if (grenadeKind(itemId) === 'acid' ? this.acidCount >= ACID.maxPools : this.lureCount >= LURE.maxActive) return 'cap';
    if (this.cooldown > 0) return 'cooldown';
    return null;
  }

  /** Toss a canister from the eye along unit `dir` (+ the thrower's velocity). The CALLER removes exactly one item when this returns ok. */
  throw(itemId: GrenadeId, eye: {x: number; y: number; z: number}, dir: {x: number; y: number; z: number}, inherit: {x?: number; y?: number; z?: number} = {}): {ok: true; canister: Canister} | {ok: false; reason: GrenadeRefusal} {
    const why = this.refusal(itemId);
    if (why) { this.counts.refused++; return {ok: false, reason: why}; }
    const w = this.host.world!;
    const d = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const right = new THREE.Vector3().crossVectors(d, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const E = new THREE.Vector3(eye.x, eye.y, eye.z);
    const start = E.clone().addScaledVector(d, 0.32).addScaledVector(right, 0.1).add(new THREE.Vector3(0, -0.1, 0));
    const q = this.host.statics;
    for (let i = 0; i < 6 && q?.blocked(start.x, start.y, start.z, 0.045); i++) start.lerp(E, 0.4);
    if (this.env.lineOfSight && !this.env.lineOfSight(E, start)) start.copy(E).addScaledVector(d, 0.05);

    const body = new CANNON.Body({
      mass: GRENADE.mass, material: this.host.material('metal'), linearDamping: 0.06, angularDamping: 0.5,
      collisionFilterGroup: GROUP_ITEM, collisionFilterMask: GROUP_STATIC | GROUP_ITEM | GROUP_CHUNK,
      allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.3,
    });
    // the canister as two spheres along its axis (body +Y = the model's up): sphere-box contacts hold at 10 m/s
    for (const s of [-1, 1]) body.addShape(new CANNON.Sphere(GRENADE.radius), new CANNON.Vec3(0, s * GRENADE.halfAxis, 0));
    // its axis along the throw (it tumbles end over end about `right`)
    const orient = new THREE.Quaternion().setFromUnitVectors(UP, d);
    body.position.set(start.x, start.y, start.z);
    body.quaternion.set(orient.x, orient.y, orient.z, orient.w);
    body.velocity.set(d.x * GRENADE.throwSpeed + (inherit.x ?? 0), d.y * GRENADE.throwSpeed + GRENADE.throwLift + (inherit.y ?? 0), d.z * GRENADE.throwSpeed + (inherit.z ?? 0));
    const spin = GRENADE.spin * (0.8 + this.rng() * 0.4);
    body.angularVelocity.set(right.x * spin, (this.rng() - 0.5) * 2, right.z * spin);
    for (const k of ['previousPosition', 'interpolatedPosition'] as const) body[k].copy(body.position);
    for (const k of ['previousQuaternion', 'interpolatedQuaternion'] as const) body[k].copy(body.quaternion);
    body.aabbNeedsUpdate = true;

    const kind = grenadeKind(itemId);
    const root = grenadeModel(itemId);
    root.traverse(o => { o.raycast = () => {}; }); // never a pickup / shot target while it flies
    this.group.add(root);
    const c: Canister = {
      id: this.nextId++, kind, itemId, state: 'flying', body, root, age: 0, t: 0, restT: 0, soundT: 0, rescues: 0, badT: 0,
      last: start.clone(), lastQ: orient.clone(), prev: start.clone(), stuck: null, hit: null, emitter: null, smoke: null,
    };
    body.addEventListener('collide', (ev: {contact: CANNON.ContactEquation}) => {
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (c.state === 'flying' && (!c.hit || v > c.hit.v)) c.hit = {v};
      if (c.soundT > 0 || v < 0.7) return;
      c.soundT = 0.12;
      this.host.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, 'light', undefined, 'thrown');
    });
    w.addBody(body);
    this.host.bodiesChanged();
    this.syncBody(c);
    this.canisters.push(c);
    this.cooldown = GRENADE.cooldown;
    this.counts.thrown++;
    return {ok: true, canister: c};
  }

  private levelOf(x: number, y: number, z: number): number | undefined {
    return this.env.levelAt?.(x, z, y + 0.05);
  }

  /** Model transform from the body (its centre -> the model's bottom-centre origin). */
  private syncBody(c: Canister): void {
    const b = c.body;
    if (!b) return;
    const bp = b.interpolatedPosition, bq = b.interpolatedQuaternion;
    this.tq.set(bq.x, bq.y, bq.z, bq.w);
    c.root.quaternion.copy(this.tq);
    c.root.position.set(bp.x, bp.y, bp.z).add(this.tv.set(0, -centreY(c.itemId), 0).applyQuaternion(this.tq));
    c.root.updateMatrixWorld(true);
  }

  /** The body leaves the world; the canister lies where it is. */
  private settle(c: Canister): void {
    const b = c.body;
    if (!b) return;
    if (b.world) b.world.removeBody(b);
    c.body = null;
  }

  /** The canister's centre (world). */
  private centre(c: Canister, out: THREE.Vector3): THREE.Vector3 {
    if (c.body) return out.set(c.body.position.x, c.body.position.y, c.body.position.z);
    return out.set(0, centreY(c.itemId), 0).applyMatrix4(c.root.matrixWorld);
  }

  /** Per frame, AFTER PhysicsSystem.update (named `tick`, like FlareSystem): canisters, bursts, pools, lures. */
  tick(dt: number): void {
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.canisters.length && !this.pools.length) return;
    for (const c of [...this.canisters]) this.tickCanister(c, dt);
    for (const p of [...this.pools]) this.tickPool(p, dt);
  }

  private tickCanister(c: Canister, dt: number): void {
    c.age += dt;
    c.t += dt;
    c.soundT -= dt;
    if (c.state === 'flying') {
      const b = c.body;
      if (!b) { this.land(c); return; }
      this.guard(c, dt);
      if (!c.body) { this.land(c); return; }
      // the path since the last tick against the live enemies (the bullets' test)
      const zs = this.env.zombies?.();
      if (zs?.length) {
        const seg = this.tseg.set(b.position.x, b.position.y, b.position.z).sub(c.prev), len = seg.length();
        if (len > 1e-4) {
          const hit = nearestEnemyHit(c.prev, seg.divideScalar(len), len + GRENADE.radius, zs);
          if (hit) {
            const at = c.prev.clone().addScaledVector(seg, Math.max(0, hit.t - GRENADE.radius));
            b.position.set(at.x, at.y, at.z);
            b.velocity.scale(0.1, b.velocity);
            this.syncBody(c);
            this.counts.zombieHits++;
            if (c.kind === 'acid') { this.burst(c, at, hit.enemy as GrenadeEnemy, null); return; }
            b.velocity.set(0, Math.min(0, b.velocity.y), 0); // a lure just drops at the zombie's feet
          }
        }
      }
      c.prev.set(b.position.x, b.position.y, b.position.z);
      this.syncBody(c);
      if (c.kind === 'acid') {
        const contact = c.hit;
        c.hit = null;
        if (contact) {
          const melt = this.env.melt?.();
          const ref = melt?.atPoint(b.position.x, b.position.y, b.position.z, GRENADE.radius + 0.09) ?? null;
          if (ref) { this.stick(c, ref); return; }
          if (contact.v >= ACID.burstSpeed) { this.burst(c, this.centre(c, new THREE.Vector3()), null, null); return; }
        }
      }
      c.restT = restTime(b, 0.1, c.restT, dt);
      if (c.restT >= GRENADE.restAfter || c.age >= GRENADE.maxFlight) this.land(c);
      return;
    }
    if (c.state === 'stuck') {
      const s = c.stuck!, melt = this.env.melt?.();
      if (!melt || !melt.alive(s.ref)) { this.burst(c, this.centre(c, new THREE.Vector3()), null, null); return; } // the prop is gone
      if (melt.where(s.ref, this.tw)) {
        c.root.position.set(this.tw.x + s.ox, this.tw.y + s.oy, this.tw.z + s.oz);
        c.root.updateMatrixWorld(true);
      }
      if (c.t >= ACID.stickFuse) this.burst(c, this.centre(c, new THREE.Vector3()), null, s.ref);
      return;
    }
    if (c.state === 'venting') {
      if (c.t >= LURE.seconds) this.spend(c);
      return;
    }
    if (c.state === 'spent' && c.t >= LURE.husk) this.remove(c);
  }

  /** The flare's safety net: ground clamp, out-of-world rescue (last good pose), never left hanging. */
  private guard(c: Canister, _dt: number): void {
    const b = c.body!, statics = this.host.statics;
    if (groundClamp(b, statics)) this.counts.clamped++;
    const g = statics?.cellGround(b.position.x, b.position.z, b.position.y);
    const bad = g === Infinity || (g !== undefined && b.position.y < g - 1.5) || !Number.isFinite(b.position.x + b.position.y + b.position.z);
    c.badT = bad ? c.badT + 1 : 0;
    if (bad && c.badT < 4 && Number.isFinite(b.position.x + b.position.y + b.position.z)) return;
    if (bad) {
      this.counts.rescued++;
      c.rescues++;
      const v = b.velocity;
      b.position.set(c.last.x, c.last.y, c.last.z);
      b.quaternion.set(c.lastQ.x, c.lastQ.y, c.lastQ.z, c.lastQ.w);
      if (Number.isFinite(v.x + v.y + v.z) && c.rescues <= 3) v.set(-v.x * 0.3, Math.min(0, v.y) * 0.3, -v.z * 0.3);
      else {
        v.setZero();
        const fl = statics?.cellGround(c.last.x, c.last.z, c.last.y);
        if (fl !== undefined && Number.isFinite(fl)) b.position.y = fl + GRENADE.radius;
      }
      b.angularVelocity.scale(0.3, b.angularVelocity);
      b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position); b.interpolatedQuaternion.copy(b.quaternion);
      b.aabbNeedsUpdate = true;
      c.prev.set(b.position.x, b.position.y, b.position.z);
      if (c.rescues > 3) { this.syncBody(c); this.settle(c); } // (the model lies at the restored pose, not at the bad one)
      return;
    }
    c.last.set(b.position.x, b.position.y, b.position.z);
    c.lastQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }

  /** Came to rest (or flew too long): acid bursts, a lure opens. */
  private land(c: Canister): void {
    if (c.body) { this.syncBody(c); this.settle(c); }
    if (c.kind === 'acid') { this.burst(c, this.centre(c, new THREE.Vector3()), null, null); return; }
    this.vent(c);
  }

  /** Acid on a meltable prop: it sticks there (no body) and bursts after the fuse. */
  private stick(c: Canister, ref: MeltRefLike): void {
    this.syncBody(c);
    this.settle(c);
    const melt = this.env.melt?.(), p = c.root.position;
    const at = melt?.where(ref, this.tw) ? this.tw : ref;
    c.stuck = {ref, ox: p.x - at.x, oy: p.y - at.y, oz: p.z - at.z};
    c.state = 'stuck';
    c.t = 0;
    this.counts.stuck++;
    this.env.audio?.flareIgnite?.(p.x, p.y, p.z); // (the canister's seal goes: a sharp hiss)
  }

  /**
   * THE BURST at `at`: the direct zombie's damage, the splash, the pool on the floor under it, the stuck prop starts melting. The canister
   * is gone (it shattered).
   */
  private burst(c: Canister, at: THREE.Vector3, direct: GrenadeEnemy | null, stuckTo: MeltRefLike | null): void {
    this.counts.bursts++;
    this.remove(c);
    const env = this.env, a = env.audio;
    a?.breakage?.('breakGlass', at.x, at.y, at.z, 0.55);
    a?.flareOut?.(at.x, at.y, at.z);
    env.noise?.(at.x, at.y, at.z);
    if (stuckTo) env.melt?.()?.start(stuckTo);
    // the splash (and the direct hit)
    const zs = env.zombies?.() ?? [];
    const S2 = ACID.splashR * ACID.splashR;
    for (const z of zs) {
      const b = z.brain;
      if (!b.alive) continue;
      const dx = b.x - at.x, dz = b.z - at.z, dy = at.y - b.y;
      const amount = z === direct ? ACID.direct : dx * dx + dz * dz <= S2 && dy > -0.6 && dy < 2.2 ? ACID.splash : 0;
      if (amount > 0) this.hurtZombie(z, amount, at.x, at.z, at.y);
    }
    const pl = env.player?.();
    if (pl?.alive) {
      const dx = pl.x - at.x, dz = pl.z - at.z, dy = at.y - pl.y;
      if (dx * dx + dz * dz <= S2 && dy > -0.6 && dy < 2.2) {
        pl.takeDamage(ACID.playerSplash);
        this.painAt = this.clock;
        env.playerHurt?.(ACID.playerSplash);
      }
    }
    // the pool: on the floor under the burst (none when there is no floor under it)
    const fy = this.host.statics?.cellGround(at.x, at.z, at.y + 0.05);
    const y = fy === undefined ? at.y - 0.05 : fy;
    if (!Number.isFinite(y) || at.y - y > 3.5) return;
    this.addPool(at.x, y, at.z);
  }

  /** Acid damage to a zombie from (fx, fy, fz) (its brain's `damage`: aware, its last-known spot there; no stagger); a kill crumples it. */
  private hurtZombie(z: GrenadeEnemy, amount: number, fx: number, fz: number, fy: number): void {
    const b = z.brain;
    const killed = b.damage(amount, fx, fz, fy, {stagger: false});
    z.hitFlash = Math.max(z.hitFlash, 0.6);
    if (killed) {
      this.counts.kills++;
      const dir = new THREE.Vector3(b.x - fx, 0.4, b.z - fz);
      if (dir.lengthSq() < 0.17) dir.set(0, 1, 0); // (a pool burn comes from its own feet: it just sinks)
      this.env.kill?.(z, dir.normalize(), new THREE.Vector3(b.x, b.y + 0.9, b.z), ACID.killImpulse);
    } else if (this.clock - (this.hurtAt.get(z) ?? -1e9) >= 1.1) { // (a pool burns in batches: its hurt cue at most about once a second)
      this.hurtAt.set(z, this.clock);
      this.env.hurt?.(z);
    }
  }
  /** Active seconds ticked (the cue throttles), when each zombie last cried out, when the player last had a pain cue. */
  private clock = 0;
  private readonly hurtAt = new WeakMap<object, number>();
  private painAt = -1e9;

  private addPool(x: number, y: number, z: number): AcidPool {
    poolGeo ??= new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    bubbleGeo ??= new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      name: 'acid-pool', color: ACID.color, emissive: 0x253d00, roughness: 0.12, metalness: 0, transparent: true, opacity: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const r = ACID.poolR;
    const mesh = new THREE.Mesh(poolGeo, mat);
    mesh.name = 'acid-pool';
    mesh.position.set(x, y + 0.012, z);
    mesh.scale.setScalar(r * 0.4);
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    const bubbles = new THREE.InstancedMesh(bubbleGeo, mat, ACID.bubbles);
    bubbles.name = 'acid-pool-bubbles';
    bubbles.position.set(x, y + 0.012, z);
    bubbles.raycast = () => {};
    bubbles.frustumCulled = false;
    const seeds = new Float32Array(ACID.bubbles * 4);
    for (let i = 0; i < ACID.bubbles; i++) {
      const a = this.rng() * Math.PI * 2, d = Math.sqrt(this.rng()) * r * 0.85;
      seeds.set([Math.cos(a) * d, Math.sin(a) * d, this.rng() * 1.7, 0.012 + this.rng() * 0.018], i * 4);
    }
    this.group.add(mesh, bubbles);
    const p: AcidPool = {id: this.nextId++, x, y, z, level: this.levelOf(x, y, z), r, left: ACID.poolSeconds, age: 0, burnT: 0, burning: new Map(), playerS: 0,
      propT: 0, fizzT: ACID.fizzEvery, burned: false, mesh, bubbles, mat, seeds};
    this.pools.push(p);
    this.counts.pools++;
    this.drawPool(p);
    return p;
  }

  /** The pool's look from its age / time left: film opacity + spread, the bubbles rising and popping. */
  private drawPool(p: AcidPool): void {
    const fin = Math.min(1, p.age / ACID.fadeIn);
    const k = poolStrength(p);
    p.mat.opacity = 0.82 * k;
    p.mesh.scale.setScalar(poolReach(p));
    const m = this.tm, s = p.seeds;
    for (let i = 0; i < ACID.bubbles; i++) {
      const ph = (p.age * 0.9 + s[i * 4 + 2]) % 1.7, life = ph / 1.7; // each bubble swells for 1.7 s, then pops and starts again
      const rad = s[i * 4 + 3] * Math.sin(Math.PI * life) * k;
      m.makeScale(rad, rad * 0.7, rad).setPosition(s[i * 4] * (0.4 + 0.6 * fin), rad * 0.35, s[i * 4 + 1] * (0.4 + 0.6 * fin));
      p.bubbles.setMatrixAt(i, m);
    }
    p.bubbles.instanceMatrix.needsUpdate = true;
  }

  private tickPool(p: AcidPool, dt: number): void {
    // the active seconds of this frame the pool still had (a long frame never burns past its ACID.poolSeconds)
    const live = Math.max(0, Math.min(dt, p.left));
    // everyone standing in it burns as much as the film is there (its strength at the middle of this frame's live part)
    const k = live * poolStrength({age: p.age + live / 2, left: p.left - live / 2});
    p.left -= dt;
    p.age += dt;
    const dry = p.left <= 0;
    if (live > 0) {
      // (inPool: the drawn disc; counted every frame, applied per batch)
      for (const z of this.env.zombies?.() ?? []) {
        const b = z.brain;
        if (b.alive && inPool(p, b.x, b.y, b.z, ACID.footR)) p.burning.set(z, (p.burning.get(z) ?? 0) + k);
      }
      const pl = this.env.player?.();
      if (pl?.alive && inPool(p, pl.x, pl.y, pl.z, ACID.footR)) {
        p.playerS += k;
        this.counts.playerBurnS += live;
        if (!p.burned) { p.burned = true; this.env.playerBurn?.(); }
      }
      p.burnT += live;
      if (p.burnT >= ACID.burnEvery - 1e-9 || dry) this.burnBatch(p);
      // and the props it touches (the melt system decides what is eligible)
      p.propT += live;
      if (p.propT >= ACID.propEvery - 1e-9 || dry) {
        const melt = this.env.melt?.();
        if (melt) for (const ref of melt.inDisc(p.x, p.y, p.z, poolReach(p))) { melt.expose(ref, p.propT); this.counts.exposures++; }
        p.propT = 0;
      }
      p.fizzT -= live;
      if (p.fizzT <= 0 && p.left > 2) { p.fizzT = ACID.fizzEvery; this.env.audio?.flareOut?.(p.x, p.y + 0.05, p.z); }
    }
    if (dry) { this.dropPool(p); this.counts.poolsDried++; return; }
    this.drawPool(p);
  }

  /** One burn batch: each zombie / the player takes the acid for the time it stood in the pool since the last batch. */
  private burnBatch(p: AcidPool): void {
    p.burnT = 0;
    for (const [z, s] of p.burning) {
      const b = z.brain;
      if (b.alive) this.hurtZombie(z, ACID.zombieDps * s, b.x, b.z, b.y); // (from its own feet: aware, but not drawn to the pool's centre)
    }
    p.burning.clear();
    const pl = this.env.player?.();
    if (p.playerS > 0 && pl?.alive) {
      const amount = ACID.playerDps * p.playerS;
      pl.takeDamage(amount);
      if (this.clock - this.painAt >= ACID.painEvery - 1e-9) { this.painAt = this.clock; this.env.playerHurt?.(amount); }
    }
    p.playerS = 0;
  }

  private dropPool(p: AcidPool): void {
    const i = this.pools.indexOf(p);
    if (i >= 0) this.pools.splice(i, 1);
    this.group.remove(p.mesh, p.bubbles);
    p.mat.dispose();
    p.bubbles.dispose();
  }

  /** A lure at rest opens: the scent emitter at the canister + its plume and hiss. */
  private vent(c: Canister): void {
    c.state = 'venting';
    c.t = 0;
    this.counts.lures++;
    const p = this.centre(c, new THREE.Vector3());
    c.emitter = this.env.scents?.()?.add({x: p.x, y: p.y, z: p.z, level: this.levelOf(p.x, p.y, p.z)}, {seconds: LURE.seconds}) ?? null;
    const s = LURE.smoke;
    c.smoke = (this.env.smoke?.addSmokeEmitter?.({x: p.x, y: p.y + 0.1, z: p.z, color: s.color, rate: s.rate, radius: s.radius, life: s.life}) as SmokeHandle | null | undefined) ?? null;
    this.env.audio?.flareIgnite?.(p.x, p.y, p.z);
  }

  /** The lure ran out: the emitter and plume stop; the empty canister lies there a while. */
  private spend(c: Canister): void {
    if (c.emitter) { this.env.scents?.()?.remove(c.emitter); c.emitter = null; }
    c.smoke?.stop?.();
    c.smoke = null;
    c.state = 'spent';
    c.t = 0;
    this.counts.luresSpent++;
  }

  private remove(c: Canister): void {
    if (c.emitter) { this.env.scents?.()?.remove(c.emitter); c.emitter = null; }
    c.smoke?.stop?.();
    c.smoke = null;
    this.settle(c);
    this.group.remove(c.root);
    const i = this.canisters.indexOf(c);
    if (i >= 0) this.canisters.splice(i, 1);
    this.counts.removed++;
  }

  /** New station / retry (also PhysicsSystem.dispose): everything goes, silently (a stuck canister's prop is not melted by it). */
  clear(): void {
    for (const c of [...this.canisters]) this.remove(c);
    for (const p of [...this.pools]) this.dropPool(p);
    this.cooldown = 0;
    this.counts.cleared++;
  }

  /**
   * render/warmup.ts pool 'grenades': hidden prototypes of both thrown canisters and of a pool's film + bubbles, built by the same
   * factories as a throw / a burst, so the loading-screen warm-up compiles them. Never shown, never simulated, never a raycast hit.
   */
  warmPrototypes(): THREE.Object3D[] {
    if (!this.protos) {
      poolGeo ??= new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
      bubbleGeo ??= new THREE.SphereGeometry(1, 8, 6);
      const out: THREE.Object3D[] = [];
      for (const id of ['acid_grenade', 'lure_grenade'] as const) {
        const m = grenadeModel(id);
        m.name = `${id}-warm-prototype`;
        out.push(m);
      }
      const mat = new THREE.MeshStandardMaterial({name: 'acid-pool', color: ACID.color, emissive: 0x253d00, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.8,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
      const film = new THREE.Mesh(poolGeo, mat);
      film.name = 'acid-pool-warm-prototype';
      const bub = new THREE.InstancedMesh(bubbleGeo, mat, 1);
      bub.name = 'acid-pool-bubbles-warm-prototype';
      out.push(film, bub);
      // (only the MESHES are hidden: the warm-up un-hides warm roots + meshes, an invisible group in between would block the compile)
      for (const o of out) {
        o.position.set(0, -1000, 0);
        o.traverse(x => { if ((x as THREE.Mesh).isMesh) x.visible = false; x.raycast = () => {}; });
        this.group.add(o);
      }
      this.protos = out;
    }
    return this.protos;
  }
  private protos: THREE.Object3D[] | null = null;

  qa() {
    return {
      cooldown: +this.cooldown.toFixed(2), acid: this.acidCount, lures: this.lureCount, counts: {...this.counts},
      canisters: this.canisters.map(c => {
        const p = this.centre(c, new THREE.Vector3());
        return {id: c.id, kind: c.kind, state: c.state, age: +c.age.toFixed(2), moving: !!c.body, stuck: c.stuck?.ref.key ?? null, emitter: c.emitter?.id ?? null,
          x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3)};
      }),
      pools: this.pools.map(p => ({id: p.id, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), r: p.r, left: +p.left.toFixed(2), opacity: +p.mat.opacity.toFixed(2)})),
    };
  }
}

/** QA hooks (qa.ts): grenades() — canisters / pools / counters; grenadeGive(id, n) — into the inventory; grenadeThrow(id) — one throw along the view. */
export function grenadeQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  type Inv = {makeStack(id: string, n: number): {count: number}; add(s: unknown): number; count(id: string): number; take(id: string, n: number): number};
  const g = game as {grenades: GrenadeSystem; inv: Inv; syncHeld(): void; camera: THREE.Camera; player: {vx: number; vz: number}};
  return {
    grenades: () => g.grenades.qa(),
    grenadeGive: (id: GrenadeId = 'acid_grenade', n = 5) => {
      const left = g.inv.add(g.inv.makeStack(id, n));
      g.syncHeld();
      return {left, total: g.inv.count(id)};
    },
    grenadeThrow: (id: GrenadeId = 'acid_grenade') => {
      const eye = g.camera.getWorldPosition(new THREE.Vector3()), dir = g.camera.getWorldDirection(new THREE.Vector3());
      const r = throwOneGrenade(g.grenades, id, () => g.inv.take(id, 1) === 1, () => g.inv.count(id) > 0, eye, dir, {x: g.player.vx, z: g.player.vz});
      return r.ok ? {ok: true, id: r.canister.id, left: g.inv.count(id)} : r;
    },
  };
}
