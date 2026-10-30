// Iteration 12 (LIGHT): thrown road FLARES — the first grenade-slot item (mandate D).
//
// G — the grenade slot (task office-overhaul-20261030, lane INTERACT; was T) — or left click with a flare in the held quick slot
// strikes a flare and tosses it: ONE item is consumed only when the
// throw actually happens (refused at the cap / without physics, with a HUD message and nothing removed).
//  - Physics: a cannon-es rigid body (the 0.255 m tube as 5 spheres of r 16.5 mm along its axis, 0.22 kg, 'plastic' contact:
//    friction 0.42 / restitution 0.30) in the station's bounded world (physics/world.ts BodySource: the world steps while a
//    flare flies and keeps the lazily built static chunks — floors / slab undersides / treads / walls / railings / props of
//    EVERY storey — around it). Thrown from just right of / below the eye at 9 m/s along the view + 2.4 m/s up + the
//    player's velocity, tumbling end over end. Bounces, rolls and settles; at rest (0.5 s still, or after 10 s) the body
//    leaves the world and the flare lies where it stopped. Ground clamp + an out-of-world guard (restore last good pose).
//  - Burning: 50 s total (0.35 s strike flare-up, steady sputter 0.68..1.0, last 6 s fade), then out; the burnt husk lies
//    there another 20 s and is removed. Red PointLight (0xff2a12, 7 cd, 10 m cutoff, decay 2) 0.1 m above the head, a hot
//    head + additive glow sprite, RED volumetric smoke from the atmosphere lane's emitter and the light registered as a
//    fog scatter light — all moved from the same head position every frame (light, smoke, AI light source, burn sound).
//  - AI: each burning flare is a LightSource {kind 'flare', omni, spot = the flare, attractRange 28 m x fade}.
//  - Cap: at most 3 burning flares (pooled lights: the scene's light count never changes, so no shader recompiles);
//    a 4th is refused with a message, nothing consumed. clear() (new station / retry; also via PhysicsSystem.dispose)
//    removes bodies, meshes, lights, smoke, sounds and light sources.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_STATIC} from '../physics/ragdoll';
import {groundClamp, restTime, type BodyHost} from '../physics/chunks';
import type {BodySource} from '../physics/world';
import type {LightSource, LightSources} from '../world/lightSources';
import {FLARE_AXIS_Y, thrownFlareModel, type ThrownFlareModel} from '../world/authoredItems';
import {FlareLight} from '../world/flareLight'; // Iteration 15: occluded like its fog glow

export const FLARE = {
  /** Seconds of burn (incl. the fade), seconds of fade at the end, strike flare-up, husk lifetime after burn-out. */
  burn: 50,
  fade: 6,
  ignite: 0.35,
  husk: 20,
  /** Burning flares at once (pooled PointLights). */
  maxActive: 3,
  /** Seconds between throws. */
  cooldown: 0.6,
  throwSpeed: 9,
  throwLift: 2.4,
  /** End-over-end tumble (rad/s). */
  spin: 10,
  mass: 0.22,
  radius: 0.0165,
  length: 0.255,
  maxFlight: 10,
  restAfter: 0.5,
  // Iteration 15 (user: "a very strong red light ... really light up an area"): 7 cd / 10 m -> 42 cd (6x) / 11.5 m (inside
  // the +-11.75 m occlusion window: world/flareLight.ts keeps walls / other storeys dark), same red, physical decay 2.
  // At 2 / 5 / 8 m: 10.5 / 1.7 / 0.66 (was 1.75 / 0.28 / 0.11); the fog glow is rebalanced in ATMOSPHERE.scatterLightScatter.
  light: {color: 0xff2a12, intensity: 42, distance: 11.5, decay: 2, lift: 0.1},
  /** Enemies with line of sight within this range notice a burning flare (scaled by the fade). */
  attractRange: 28,
  /** Smoke emitter request (render/atmosphere smoke API; bounded there). */
  smoke: {color: 0xc0261a, rate: 1, radius: 1.4, life: 7},
} as const;

export type ThrowRefusal = 'cap' | 'cooldown' | 'unavailable';
export type ThrowResult = {ok: true; flare: Flare} | {ok: false; reason: ThrowRefusal};

/** Smoke / scatter API (atmosphere lane, design.md); every member optional until it lands. */
export interface SmokeHandle {
  update?(p: {x: number; y: number; z: number}): void;
  stop?(): void;
}
export interface FlareSmokeHost {
  addSmokeEmitter?(o: {x: number; y: number; z: number; color: number; rate: number; radius: number; life: number}): SmokeHandle | null | undefined | void;
  addScatterLight?(light: THREE.PointLight): unknown;
  removeScatterLight?(light: THREE.PointLight): unknown;
}
/** Burn sound loop handle (audio lane: Sfx.flareBurnStart). */
export interface BurnLoop { setPos?(x: number, y: number, z: number): void; stop?(): void }
export interface FlareAudio {
  flareIgnite?(x: number, y: number, z: number): void;
  flareBurnStart?(x: number, y: number, z: number): BurnLoop | null | undefined | void;
  flareOut?(x: number, y: number, z: number): void;
}
export interface FlareEnv {
  smoke?: FlareSmokeHost | null;
  audio?: FlareAudio | null;
  /** Storey of a world point (gen/levels.ts levelAt). */
  levelAt?(x: number, z: number, y: number): number;
  /** 3D line of sight (spawn point vs the eye: never throw through a wall the player leans on). */
  lineOfSight?(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}): boolean;
}
export interface FlareHost extends BodyHost {
  addSource(s: BodySource): void;
}

export interface Flare {
  readonly id: number;
  /** Seconds since it was struck. */
  age: number;
  burning: boolean;
  /** Has a simulating physics body (in flight / still settling). */
  body: CANNON.Body | null;
  readonly model: ThrownFlareModel;
  light: THREE.PointLight | null;
  src: LightSource | null;
  smoke: SmokeHandle | null;
  loop: BurnLoop | null;
  /** Burning head, world space: the light / smoke / AI source position. */
  readonly pos: THREE.Vector3;
  /** Current light intensity factor 0..1 (fade x sputter x strike). */
  level01: number;
  restT: number;
  soundT: number;
  /** Out-of-world rescues of this flare (safety net; see tick) and consecutive frames with the body centre out of bounds. */
  rescues: number;
  badT: number;
  readonly phase: number;
  readonly last: THREE.Vector3;
  readonly lastQ: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const AXIS_OFF = new THREE.Vector3(0, -FLARE_AXIS_Y, 0);
/** Spheres in the flare's compound collider (gaps between them stay narrower than a railing box). */
const FLARE_SPHERES = 5;
/** Rolling resistance (m/s^2) while the flare lies on a floor. */
const ROLL_DECEL = 1.1;
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** Light factor of a flare `age` seconds after the strike (no sputter): flare-up, steady, fade, out. */
export function flareEnvelope(age: number): number {
  if (age < 0 || age >= FLARE.burn) return 0;
  const strike = age < FLARE.ignite ? 0.5 + 0.5 * smooth(age / FLARE.ignite) : 1;
  const fade = age > FLARE.burn - FLARE.fade ? smooth((FLARE.burn - age) / FLARE.fade) : 1;
  return strike * fade;
}

/**
 * Throw one flare from an inventory: nothing is removed when the throw would be refused (cap / cooldown / no physics) or
 * there is no flare; otherwise `takeOne()` removes EXACTLY one item first and the throw follows (it cannot fail then).
 */
export function throwOneFlare(sys: FlareSystem, takeOne: () => boolean, hasOne: () => boolean, eye: {x: number; y: number; z: number}, dir: {x: number; y: number; z: number}, inherit: {x?: number; y?: number; z?: number} = {}): ThrowResult | {ok: false; reason: 'none'} {
  if (!hasOne()) return {ok: false, reason: 'none'};
  const why = sys.refusal();
  if (why) { sys.counts.refused++; return {ok: false, reason: why}; }
  if (!takeOne()) return {ok: false, reason: 'none'};
  return sys.throw(eye, dir, inherit);
}

export class FlareSystem implements BodySource {
  readonly group = new THREE.Group();
  readonly flares: Flare[] = [];
  /** Pooled red lights (always in the scene, intensity 0 when free). */
  readonly lights: THREE.PointLight[] = [];
  private readonly free: THREE.PointLight[] = [];
  env: FlareEnv = {};
  cooldown = 0;
  private nextId = 1;
  private readonly tv = new THREE.Vector3();
  private readonly tq = new THREE.Quaternion();
  /** Counters (QA / tests). */
  readonly counts = {thrown: 0, refused: 0, burntOut: 0, removed: 0, settled: 0, clamped: 0, rescued: 0, cleared: 0};

  constructor(parent: THREE.Object3D, private readonly host: FlareHost, private readonly sources: LightSources, private readonly rng: () => number = Math.random) {
    this.group.name = 'flares';
    parent.add(this.group);
    for (let i = 0; i < FLARE.maxActive; i++) {
      const l = new FlareLight(FLARE.light.color, 0, FLARE.light.distance, FLARE.light.decay);
      l.name = `flare-light-${i}`;
      l.castShadow = false;
      this.lights.push(l);
      this.free.push(l);
      parent.add(l);
    }
    host.addSource(this);
  }

  /** Burning flares (the cap counts these; burnt-out husks do not). */
  get burningCount(): number {
    let n = 0;
    for (const f of this.flares) if (f.burning) n++;
    return n;
  }

  // BodySource -----------------------------------------------------------------------------------
  get awake(): number {
    let n = 0;
    for (const f of this.flares) if (f.body) n++;
    return n;
  }
  activePoints(out: CANNON.Vec3[]): void {
    for (const f of this.flares) if (f.body) out.push(f.body.position);
  }

  /**
   * BodySource.carry (task office-seamless, lane LIFT): flares lying inside the moving elevator cab ride its dy — the model,
   * the burning head (light / smoke / sound / AI source follow it in tick) and the last good pose. Flying flares are bodies
   * (carried by the physics system).
   */
  carry(inside: (x: number, y: number, z: number) => boolean, dy: number): void {
    for (const f of this.flares) {
      // tested at the tube's centre (the model root ~ the body centre), not the burning head: a flare lying across the cab
      // door plane has its head past it while its body rests on the cab floor
      const c = f.model.root.position;
      if (f.body || !inside(c.x, c.y, c.z)) continue;
      c.y += dy;
      f.model.root.updateMatrixWorld(true);
      f.pos.y += dy;
      f.last.y += dy;
      if (f.light) f.light.position.y += dy;
    }
  }

  /** BodySource.relocate (lane LIFT): a flare lying in a doorway the landing doors shut on goes to the nearer side (its centre decides). */
  relocate(move: (x: number, y: number, z: number) => [number, number] | null): void {
    for (const f of this.flares) {
      if (f.body) continue;
      const c = f.model.root.position, to = move(c.x, c.y, c.z);
      if (!to) continue;
      const dx = to[0] - c.x, dz = to[1] - c.z;
      c.x += dx; c.z += dz;
      f.model.root.updateMatrixWorld(true);
      f.pos.x += dx; f.pos.z += dz;
      f.last.x += dx; f.last.z += dz;
      if (f.light) { f.light.position.x += dx; f.light.position.z += dz; }
    }
  }

  /** Why a throw would be refused right now (null = OK). */
  refusal(): ThrowRefusal | null {
    if (!this.host.world) return 'unavailable';
    if (this.burningCount >= FLARE.maxActive) return 'cap';
    if (this.cooldown > 0) return 'cooldown';
    return null;
  }

  /**
   * Strike and toss a flare from the eye along unit `dir` (+ the thrower's velocity). The CALLER removes exactly one flare
   * item when this returns ok (and nothing otherwise).
   */
  throw(eye: {x: number; y: number; z: number}, dir: {x: number; y: number; z: number}, inherit: {x?: number; y?: number; z?: number} = {}): ThrowResult {
    const why = this.refusal();
    if (why) { this.counts.refused++; return {ok: false, reason: why}; }
    const w = this.host.world!;
    const d = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const right = new THREE.Vector3().crossVectors(d, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const E = new THREE.Vector3(eye.x, eye.y, eye.z);
    const start = E.clone().addScaledVector(d, 0.32).addScaledVector(right, 0.1).add(new THREE.Vector3(0, -0.1, 0));
    const q = this.host.statics;
    for (let i = 0; i < 6 && q?.blocked(start.x, start.y, start.z, 0.035); i++) start.lerp(E, 0.4);
    if (this.env.lineOfSight && !this.env.lineOfSight(E, start)) start.copy(E).addScaledVector(d, 0.05);

    const body = new CANNON.Body({
      mass: FLARE.mass, material: this.host.material('plastic'), linearDamping: 0.08, angularDamping: 0.55,
      collisionFilterGroup: GROUP_ITEM, collisionFilterMask: GROUP_STATIC | GROUP_ITEM | GROUP_CHUNK,
      allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.4,
    });
    // The tube as FLARE_SPHERES small spheres along its axis (model +X): sphere-box contacts resolve along the box face even at
    // 9 m/s, where a thin convex cylinder's SAT picks its own radial axis and slides through a wall; it rolls like a tube.
    for (let i = 0; i < FLARE_SPHERES; i++) {
      const x = (i / (FLARE_SPHERES - 1) - 0.5) * (FLARE.length - 2 * FLARE.radius);
      body.addShape(new CANNON.Sphere(FLARE.radius), new CANNON.Vec3(x, 0, 0));
    }
    // head (+X) along the throw's horizontal direction
    const flat = new THREE.Vector3(d.x, 0, d.z);
    const orient = flat.lengthSq() > 1e-6 ? new THREE.Quaternion().setFromUnitVectors(X, flat.normalize()) : new THREE.Quaternion();
    body.position.set(start.x, start.y, start.z);
    body.quaternion.set(orient.x, orient.y, orient.z, orient.w);
    body.velocity.set(d.x * FLARE.throwSpeed + (inherit.x ?? 0), d.y * FLARE.throwSpeed + FLARE.throwLift + (inherit.y ?? 0), d.z * FLARE.throwSpeed + (inherit.z ?? 0));
    const spin = FLARE.spin * (0.8 + this.rng() * 0.4);
    body.angularVelocity.set(right.x * spin, (this.rng() - 0.5) * 3, right.z * spin);
    for (const k of ['previousPosition', 'interpolatedPosition'] as const) body[k].copy(body.position);
    for (const k of ['previousQuaternion', 'interpolatedQuaternion'] as const) body[k].copy(body.quaternion);
    body.aabbNeedsUpdate = true;

    const model = thrownFlareModel();
    model.setBurning(true);
    this.group.add(model.root);
    const f: Flare = {
      id: this.nextId++, age: 0, burning: true, body, model, light: this.free.pop() ?? null, src: null, smoke: null, loop: null,
      pos: new THREE.Vector3(), level01: 0, restT: 0, soundT: 0, rescues: 0, badT: 0, phase: this.rng() * Math.PI * 2,
      last: start.clone(), lastQ: orient.clone(),
    };
    body.addEventListener('collide', (ev: {contact: CANNON.ContactEquation}) => {
      if (f.soundT > 0) return;
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (v < 0.7) return;
      f.soundT = 0.12;
      this.host.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, 'light');
    });
    w.addBody(body);
    this.host.bodiesChanged(); // static collision around the new body now
    this.sync(f);
    const p = f.pos;
    if (f.light) { f.light.position.set(p.x, p.y + FLARE.light.lift, p.z); this.env.smoke?.addScatterLight?.(f.light); }
    f.src = this.sources.add({kind: 'flare', active: true, x: p.x, y: p.y, z: p.z, level: this.levelOf(p), dir: null, cosHalfAngle: 1, spot: {x: p.x, y: p.y, z: p.z}, attractRange: FLARE.attractRange, intensity: 0.5});
    const s = FLARE.smoke;
    f.smoke = (this.env.smoke?.addSmokeEmitter?.({x: p.x, y: p.y, z: p.z, color: s.color, rate: s.rate, radius: s.radius, life: s.life}) as SmokeHandle | null | undefined) ?? null;
    this.env.audio?.flareIgnite?.(p.x, p.y, p.z);
    f.loop = (this.env.audio?.flareBurnStart?.(p.x, p.y, p.z) as BurnLoop | null | undefined) ?? null;
    this.flares.push(f);
    this.cooldown = FLARE.cooldown;
    this.counts.thrown++;
    this.tick(0);
    return {ok: true, flare: f};
  }

  private levelOf(p: THREE.Vector3): number | undefined {
    return this.env.levelAt?.(p.x, p.z, p.y + 0.05);
  }

  /** Model transform + head position from the body (or the resting pose). */
  private sync(f: Flare): void {
    const b = f.body;
    const root = f.model.root;
    if (b) {
      const bp = b.interpolatedPosition, bq = b.interpolatedQuaternion;
      this.tq.set(bq.x, bq.y, bq.z, bq.w);
      root.quaternion.copy(this.tq);
      root.position.set(bp.x, bp.y, bp.z).add(this.tv.copy(AXIS_OFF).applyQuaternion(this.tq));
    }
    root.updateMatrixWorld(true);
    f.pos.copy(f.model.headLocal).applyMatrix4(root.matrixWorld);
  }

  private settle(f: Flare): void {
    const b = f.body;
    if (!b) return;
    if (b.world) b.world.removeBody(b);
    f.body = null;
    this.counts.settled++;
  }

  /** Light, smoke, sound and AI source go out; the husk stays a while. `quiet`: no burn-out sound (clear()). */
  private extinguish(f: Flare, quiet = false): void {
    if (!f.burning) return;
    f.burning = false;
    f.level01 = 0;
    if (f.light) {
      f.light.intensity = 0;
      (f.light as FlareLight).clearWindow?.();
      this.env.smoke?.removeScatterLight?.(f.light);
      this.free.push(f.light);
      f.light = null;
    }
    if (f.src) { this.sources.remove(f.src); f.src = null; }
    f.smoke?.stop?.();
    f.smoke = null;
    f.loop?.stop?.();
    f.loop = null;
    f.model.setBurning(false);
    if (!quiet) { this.env.audio?.flareOut?.(f.pos.x, f.pos.y, f.pos.z); this.counts.burntOut++; }
  }

  private dispose(f: Flare): void {
    this.extinguish(f, true);
    this.settle(f);
    this.group.remove(f.model.root);
    this.counts.removed++;
  }

  /**
   * Per frame, AFTER PhysicsSystem.update (named `tick`, not BodySource.update, which the physics system would call as well):
   * physics sync, burn, light / smoke / sound / AI source positions.
   */
  tick(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const statics = this.host.statics;
    for (const f of this.flares) {
      f.age += dt;
      f.soundT -= dt;
      const b = f.body;
      if (b) {
        if (groundClamp(b, statics)) this.counts.clamped++;
        const g = statics?.cellGround(b.position.x, b.position.z, b.position.y);
        const bad = g === Infinity || (g !== undefined && b.position.y < g - 1.5) || !Number.isFinite(b.position.x + b.position.y + b.position.z);
        // (an end-first hit at 9 m/s puts the centre a few cm into the wall for a step or two while the contact pushes it out)
        f.badT = bad ? f.badT + 1 : 0;
        if (bad && f.badT < 4 && Number.isFinite(b.position.x + b.position.y + b.position.z)) {
          this.sync(f);
        } else if (bad) {
          // safety net (got into a wall / fell out of the station): back to the last good pose bouncing back off the obstacle;
          // after 3 rescues it is laid on the floor under that pose instead (never left hanging in the air)
          this.counts.rescued++;
          f.rescues++;
          const v = b.velocity;
          b.position.set(f.last.x, f.last.y, f.last.z);
          b.quaternion.set(f.lastQ.x, f.lastQ.y, f.lastQ.z, f.lastQ.w);
          if (Number.isFinite(v.x + v.y + v.z) && f.rescues <= 3) v.set(-v.x * 0.3, Math.min(0, v.y) * 0.3, -v.z * 0.3);
          else {
            v.setZero();
            const fl = statics?.cellGround(f.last.x, f.last.z, f.last.y);
            if (fl !== undefined && Number.isFinite(fl)) b.position.y = fl + FLARE_AXIS_Y;
          }
          b.angularVelocity.scale(0.3, b.angularVelocity);
          b.previousPosition.copy(b.position); b.interpolatedPosition.copy(b.position); b.interpolatedQuaternion.copy(b.quaternion);
          b.aabbNeedsUpdate = true;
          this.sync(f);
          if (f.rescues > 3) this.settle(f);
        } else {
          f.last.set(b.position.x, b.position.y, b.position.z);
          f.lastQ.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          // rolling resistance of a waxed-paper tube on concrete (cannon has none): lying on the floor it slows by ROLL_DECEL
          if (g !== undefined && Number.isFinite(g) && b.position.y - g < FLARE.radius + 0.012 && Math.abs(b.velocity.y) < 0.3) {
            const hv = Math.hypot(b.velocity.x, b.velocity.z);
            if (hv > 1e-6) {
              const k = Math.max(0, hv - ROLL_DECEL * dt) / hv;
              b.velocity.x *= k; b.velocity.z *= k;
              b.angularVelocity.scale(k, b.angularVelocity);
            }
          }
          // at rest: cannon asleep / the shared rest test, or just crawling (a tube keeps rolling a few cm/s on a level floor
          // for seconds: treat < 7 cm/s without vertical motion as stopped)
          const v = b.velocity.length();
          f.restT = v < 0.07 && Math.abs(b.velocity.y) < 0.05 ? f.restT + dt : restTime(b, 0.13, f.restT, dt);
          if (f.restT < FLARE.restAfter && f.age >= FLARE.maxFlight) {
            // still moving after 10 s (rolling down a long flight): laid on the floor under it, level, then settled
            const fl = statics?.cellGround(b.position.x, b.position.z, b.position.y);
            if (fl !== undefined && Number.isFinite(fl) && fl <= b.position.y) {
              b.position.y = fl + FLARE_AXIS_Y;
              const yaw = Math.atan2(-2 * (b.quaternion.x * b.quaternion.z - b.quaternion.w * b.quaternion.y), 1 - 2 * (b.quaternion.y ** 2 + b.quaternion.z ** 2));
              b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
              b.interpolatedPosition.copy(b.position); b.interpolatedQuaternion.copy(b.quaternion);
            }
          }
          this.sync(f);
          if (f.restT >= FLARE.restAfter || f.age >= FLARE.maxFlight) this.settle(f);
        }
      } else if (dt === 0) this.sync(f);
      if (f.burning && f.age >= FLARE.burn) this.extinguish(f);
      if (!f.burning) continue;
      const t = f.age;
      const sputter = 0.84 + 0.1 * Math.sin(t * 13.3 + f.phase) + 0.06 * Math.sin(t * 31.7 + 2 * f.phase);
      const env = flareEnvelope(t);
      f.level01 = env * sputter;
      const p = f.pos;
      if (f.light) {
        f.light.position.set(p.x, p.y + FLARE.light.lift, p.z);
        f.light.intensity = FLARE.light.intensity * f.level01;
      }
      f.model.glow.scale.setScalar(0.18 + 0.16 * f.level01);
      const fade = t > FLARE.burn - FLARE.fade ? env : 1;
      if (f.src) {
        f.src.x = p.x; f.src.y = p.y; f.src.z = p.z;
        f.src.level = this.levelOf(p);
        f.src.spot = {x: p.x, y: p.y, z: p.z};
        f.src.intensity = env;
        f.src.attractRange = FLARE.attractRange * fade;
        f.src.active = env > 0.02;
      }
      f.smoke?.update?.({x: p.x, y: p.y, z: p.z});
      f.loop?.setPos?.(p.x, p.y, p.z);
    }
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      if (!f.burning && !f.body && f.age >= FLARE.burn + FLARE.husk) { this.dispose(f); this.flares.splice(i, 1); }
    }
  }

  /** New station / retry (also PhysicsSystem.dispose): everything goes, silently. */
  clear(): void {
    for (const f of this.flares) this.dispose(f);
    this.flares.length = 0;
    this.free.length = 0;
    for (const l of this.lights) { l.intensity = 0; (l as FlareLight).clearWindow?.(); this.free.push(l); }
    this.cooldown = 0;
    this.counts.cleared++;
  }

  /**
   * Iteration 14 (render/warmup.ts pool 'flares'): hidden prototypes of a burning and a burnt-out thrown flare, built by
   * the same factory as a throw, so the loading-screen warm-up compiles them (the first throw no longer builds its
   * pipelines mid-play). Never shown (every mesh hidden), never simulated, far below the station, never a raycast hit.
   */
  warmPrototypes(): THREE.Object3D[] {
    if (!this.protos) {
      this.protos = [true, false].map(burning => {
        const m = thrownFlareModel();
        m.setBurning(burning);
        m.root.name = `flare-warm-prototype-${burning ? 'burning' : 'husk'}`;
        m.root.position.set(0, -1000, 0);
        for (const c of m.root.children) { c.visible = false; c.raycast = () => {}; }
        this.group.add(m.root);
        return m.root;
      });
    }
    return this.protos;
  }
  private protos: THREE.Object3D[] | null = null;

  qa(): {burning: number; total: number; cooldown: number; counts: FlareSystem['counts']; list: {id: number; age: number; burning: boolean; moving: boolean; x: number; y: number; z: number; level?: number; light: number; attract: number}[]} {
    return {
      burning: this.burningCount, total: this.flares.length, cooldown: +this.cooldown.toFixed(2), counts: {...this.counts},
      list: this.flares.map(f => ({id: f.id, age: +f.age.toFixed(2), burning: f.burning, moving: !!f.body, x: +f.pos.x.toFixed(3), y: +f.pos.y.toFixed(3), z: +f.pos.z.toFixed(3),
        level: f.src?.level, light: +(f.light?.intensity ?? 0).toFixed(2), attract: +(f.src?.attractRange ?? 0).toFixed(1)})),
    };
  }
}
