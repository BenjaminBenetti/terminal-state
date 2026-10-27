// Iteration 07 (Lane K): PHYSICAL chunks — real rigid bodies in the station's bounded cannon-es world.
//
// Two kinds, each with a hard budget:
//  - world chunks: the bigger concrete / tile / plaster pieces, wood planks, glass shards and carton
//    flakes of a hit or a prop break. They stay ordinary pooled debris instances (damage/debris.ts,
//    no extra draw calls) whose pose is DRIVEN by a box body (mass from material density x volume)
//    until it sleeps; a recycled / over-budget body hands its piece back to the ballistic debris
//    integrator, so nothing ever freezes in mid-air.
//  - flesh / cloth chunks: actual pieces of a zombie's posed body or garment (damage/fleshPatch.ts),
//    each its own small mesh with the actor's texture, a box collider matching the patch, the actor's
//    velocity at the hit + the bullet's shove. They tumble, slap down, slide, settle and SLEEP; the
//    body is then removed from the world (the mesh stays) and the chunk shrinks away at end of life.
// Contacts: floors at every cell height (track beds, stair treads, underpass), walls, prop boxes,
// loot-holder shelves, loose items and each other (physics/world.ts static chunks). Sleeping bodies
// are retired, so the solver only ever sees awake chunks.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_STATIC} from './ragdoll';
import type {StaticQuery} from './staticQuery';
import type {Piece} from '../damage/debris';
import type {PhysMat} from '../damage/materials';

export const MAX_WORLD_CHUNK_BODIES = 28;
export const MAX_FLESH_CHUNKS = 24;
export const FLESH_CHUNK_LIFE = 45;
const FADE = 1.6;
/** Seconds a body must sleep before it is removed from the solver. */
const RETIRE_SLEEP = 0.3;
/** Hard cap: a chunk body never simulates longer than this. */
const MAX_SIM = 9;

/** Impact sound hook (audio/sfx.ts physImpact): family + contact speed (m/s). */
export type ImpactFamily = 'can' | 'light' | 'heavy' | 'prop' | 'flesh' | 'stone' | 'wood' | 'glass' | 'metal';
export interface PhysAudio {
  physImpact?(x: number, y: number, z: number, speed: number, family: ImpactFamily): void;
}

/** What a chunk / item body needs from the physics system. */
export interface BodyHost {
  readonly world: CANNON.World | null;
  readonly statics: StaticQuery | null;
  material(m: PhysMat): CANNON.Material;
  /** Bodies were added: refresh the static collision chunks around them now. */
  bodiesChanged(): void;
  /** A prop's box changed (a light prop went loose): rebuild the static chunk there. */
  propsChanged?(x: number, z: number): void;
  readonly audio: PhysAudio | null;
}

export const CHUNK_MASK = GROUP_STATIC | GROUP_ITEM | GROUP_CHUNK;

/**
 * Rest detection shared by chunks and items: cannon's own sleep flickers on small / polygonal bodies
 * (micro-bounces of a 2 cm chip, a can rocking on its 12-gon side), so a body also counts as at rest
 * while its fastest surface point (v + w x size) stays slow and it does not drift. Returns the new
 * at-rest time (seconds).
 */
export function restTime(b: CANNON.Body, size: number, prev: number, dt: number): number {
  if (b.sleepState === CANNON.Body.SLEEPING) return prev + dt;
  const v = b.velocity.length(), w = b.angularVelocity.length();
  return v + w * size < 0.06 || (v < 0.06 && w < 0.9) ? prev + dt : 0;
}

/**
 * Safety net for small bodies on the static station: if a body's lowest point sank below the floor of
 * its cell (a thin piece squeezed into the seam between two static slabs), lift it back on top and
 * kill its downward / spin velocity. Returns true when it corrected.
 */
export function groundClamp(b: CANNON.Body, statics: StaticQuery | null): boolean {
  if (!statics) return false;
  const g = statics.cellGround(b.position.x, b.position.z);
  if (!Number.isFinite(g)) return false;
  if (b.aabbNeedsUpdate) b.updateAABB();
  const low = b.aabb.lowerBound.y;
  if (low >= g - 0.012 || b.position.y < g - 0.6) return false; // fine, or genuinely below (fell into a trench cell edge)
  b.position.y += g - low + 0.001;
  if (b.velocity.y < 0) b.velocity.y = 0;
  b.velocity.x *= 0.5; b.velocity.z *= 0.5;
  b.angularVelocity.scale(0.3, b.angularVelocity);
  b.aabbNeedsUpdate = true;
  return true;
}

interface WorldChunk { piece: Piece; serial: number; body: CANNON.Body; t: number; sleepT: number; fam: ImpactFamily; soundT: number; size: number }
interface FleshChunk { mesh: THREE.Mesh; body: CANNON.Body | null; t: number; life: number; sleepT: number; fam: ImpactFamily; soundT: number; serial: number; ownGeo: boolean; size: number }

const FAMILY: Partial<Record<PhysMat, ImpactFamily>> = {stone: 'stone', wood: 'wood', glass: 'glass', metal: 'metal', flesh: 'flesh', cloth: 'flesh', soft: 'light', plastic: 'light', heavy: 'heavy'};

const tq = new THREE.Quaternion(), tv = new THREE.Vector3();

export interface ChunkSpawn {
  /** World velocity (inherited actor / surface velocity + throw) and angular velocity. */
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  mat: PhysMat;
  /** kg per m^3 (box volume x 0.5 fill). */
  density: number;
}

export class PhysChunks {
  readonly group = new THREE.Group();
  private world: WorldChunk[] = [];
  private flesh: FleshChunk[] = [];
  private serial = 0;
  /** Spawned / recycled counters (QA/tests). */
  readonly counts = {world: 0, flesh: 0, worldRecycled: 0, fleshRecycled: 0, retired: 0, impacts: 0, clamped: 0};
  private readonly materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();

  constructor(private readonly host: BodyHost) {
    this.group.name = 'physics-chunks';
  }

  get awake(): number {
    let n = 0;
    for (const c of this.world) if (c.body) n++;
    for (const c of this.flesh) if (c.body) n++;
    return n;
  }

  /** World positions of bodies in the solver (static-chunk activation). */
  activePoints(out: CANNON.Vec3[]): void {
    for (const c of this.world) out.push(c.body.position);
    for (const c of this.flesh) if (c.body) out.push(c.body.position);
  }

  private makeBody(half: THREE.Vector3, pos: THREE.Vector3, q: THREE.Quaternion, s: ChunkSpawn, group = GROUP_CHUNK): CANNON.Body {
    const h = new CANNON.Vec3(Math.max(0.005, half.x), Math.max(0.005, half.y), Math.max(0.005, half.z));
    const vol = 8 * h.x * h.y * h.z;
    const body = new CANNON.Body({
      mass: Math.max(0.004, s.density * vol * 0.5), material: this.host.material(s.mat), linearDamping: 0.08, angularDamping: s.mat === 'flesh' || s.mat === 'cloth' ? 0.5 : 0.3,
      collisionFilterGroup: group, collisionFilterMask: CHUNK_MASK, allowSleep: true, sleepSpeedLimit: 0.14, sleepTimeLimit: 0.3,
    });
    body.addShape(new CANNON.Box(h));
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.velocity.set(s.vel.x, s.vel.y, s.vel.z);
    body.angularVelocity.set(s.spin.x, s.spin.y, s.spin.z);
    body.aabbNeedsUpdate = true;
    return body;
  }

  private listen(body: CANNON.Body, rec: {fam: ImpactFamily; soundT: number}): void {
    body.addEventListener('collide', (e: {contact: CANNON.ContactEquation; body: CANNON.Body}) => {
      if (rec.soundT > 0) return;
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < 0.9) return;
      rec.soundT = 0.25;
      this.counts.impacts++;
      this.host.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, rec.fam);
    });
  }

  /**
   * A debris piece becomes a rigid body (world chunk). The piece must be a DRIVEN piece
   * (DebrisSystem.spawnDriven). Over budget the oldest world chunk body is retired (its piece flies
   * on ballistically). False when there is no physics world (the piece is released to ballistic).
   */
  spawnWorld(piece: Piece, half: THREE.Vector3, s: ChunkSpawn): boolean {
    const w = this.host.world;
    if (!w) { this.release(piece, false); return false; }
    while (this.world.length >= MAX_WORLD_CHUNK_BODIES) { this.retireWorld(this.world[0], true); this.counts.worldRecycled++; }
    // never start inside a wall / prop: nudge out along the throw
    const q = this.host.statics;
    if (q) for (let i = 0; i < 4 && q.insideSolid(piece.pos.x, piece.pos.y, piece.pos.z); i++) piece.pos.addScaledVector(tv.copy(s.vel).normalize(), 0.03);
    const body = this.makeBody(half, piece.pos, piece.q, s);
    const rec: WorldChunk = {piece, serial: piece.serial, body, t: 0, sleepT: 0, fam: FAMILY[s.mat] ?? 'stone', soundT: 0.05, size: Math.max(half.x, half.y, half.z)};
    this.listen(body, rec);
    w.addBody(body);
    this.world.push(rec);
    this.counts.world++;
    this.host.bodiesChanged();
    return true;
  }

  private release(piece: Piece, rest: boolean, vel?: CANNON.Vec3, ang?: CANNON.Vec3): void {
    if (!piece.live || piece.mode !== 3) return;
    if (rest) { piece.mode = 2; piece.vel.set(0, 0, 0); piece.w.set(0, 0, 0); return; }
    piece.mode = 0;
    if (vel) piece.vel.set(vel.x, vel.y, vel.z); else piece.vel.set(0, 0, 0);
    if (ang) piece.w.set(ang.x, ang.y, ang.z);
  }

  private retireWorld(c: WorldChunk, moving: boolean): void {
    this.host.world?.removeBody(c.body);
    this.world.splice(this.world.indexOf(c), 1);
    if (c.piece.serial === c.serial) {
      if (moving && c.body.velocity.length() > 0.25) this.release(c.piece, false, c.body.velocity, c.body.angularVelocity);
      else { this.syncPiece(c, false); this.release(c.piece, true); }
    }
    this.counts.retired++;
  }

  /** Material for a flesh / cloth chunk cut from an actor layer: same textures, no skinning / wound hooks, vertex colours. */
  chunkMaterial(src: THREE.Material): THREE.MeshStandardMaterial {
    let m = this.materials.get(src);
    if (m) return m;
    const s = src as THREE.MeshStandardMaterial;
    m = new THREE.MeshStandardMaterial({
      color: s.color?.clone() ?? new THREE.Color(0xffffff), map: s.map ?? null, normalMap: s.normalMap ?? null, roughness: s.roughness ?? 0.8,
      metalness: s.metalness ?? 0, roughnessMap: s.roughnessMap ?? null, metalnessMap: s.metalnessMap ?? null, vertexColors: true, side: THREE.DoubleSide,
    });
    if (s.normalScale) m.normalScale.copy(s.normalScale);
    m.name = `chunk:${src.name || 'layer'}`;
    this.materials.set(src, m);
    return m;
  }

  /**
   * A torn-off actor piece (flesh / cloth / rubber / plastic patch). `geometry` is chunk-local
   * (centred on `half`'s box). Over budget the oldest flesh chunk is removed (never gameplay loot).
   */
  spawnFlesh(geometry: THREE.BufferGeometry, material: THREE.Material, pos: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, s: ChunkSpawn, life = FLESH_CHUNK_LIFE): THREE.Mesh | null {
    while (this.flesh.length >= MAX_FLESH_CHUNKS) { this.removeFlesh(this.flesh[0]); this.counts.fleshRecycled++; }
    // never start inside a wall / prop: nudge out along the throw
    const qs = this.host.statics;
    if (qs) for (let i = 0; i < 4 && qs.insideSolid(pos.x, pos.y, pos.z); i++) pos.addScaledVector(tv.copy(s.vel).normalize(), 0.03);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'flesh-chunk';
    mesh.position.copy(pos);
    mesh.quaternion.copy(q);
    mesh.frustumCulled = true;
    this.group.add(mesh);
    const rec: FleshChunk = {mesh, body: null, t: 0, life: life * (0.9 + Math.random() * 0.2), sleepT: 0, fam: FAMILY[s.mat] ?? 'flesh', soundT: 0.06, serial: ++this.serial, ownGeo: true, size: Math.max(half.x, half.y, half.z)};
    const w = this.host.world;
    if (w) {
      rec.body = this.makeBody(half, pos, q, s);
      this.listen(rec.body, rec);
      w.addBody(rec.body);
      this.host.bodiesChanged();
    }
    this.flesh.push(rec);
    this.counts.flesh++;
    return mesh;
  }

  private removeFlesh(c: FleshChunk): void {
    if (c.body) this.host.world?.removeBody(c.body);
    c.body = null;
    this.group.remove(c.mesh);
    if (c.ownGeo) c.mesh.geometry.dispose();
    this.flesh.splice(this.flesh.indexOf(c), 1);
  }

  private syncPiece(c: WorldChunk, interp: boolean): void {
    const p = interp ? c.body.interpolatedPosition : c.body.position, q = interp ? c.body.interpolatedQuaternion : c.body.quaternion;
    c.piece.pos.set(p.x, p.y, p.z);
    c.piece.q.set(q.x, q.y, q.z, q.w);
  }

  /** Per frame after the world step: write poses, retire sleeping / expired bodies, fade. */
  update(dt: number): void {
    for (const c of this.world.slice()) {
      c.t += dt;
      c.soundT = Math.max(0, c.soundT - dt);
      if (c.piece.serial !== c.serial || !c.piece.live || c.piece.mode !== 3) {
        // the debris pool recycled the piece (or it expired): drop the body
        this.host.world?.removeBody(c.body);
        this.world.splice(this.world.indexOf(c), 1);
        continue;
      }
      if (!Number.isFinite(c.body.position.x + c.body.position.y + c.body.position.z)) { this.host.world?.removeBody(c.body); this.world.splice(this.world.indexOf(c), 1); c.piece.mode = 0; c.piece.age = c.piece.life; continue; }
      if (groundClamp(c.body, this.host.statics)) this.counts.clamped++;
      this.syncPiece(c, true);
      c.sleepT = restTime(c.body, c.size, c.sleepT, dt);
      if (c.sleepT > RETIRE_SLEEP) this.retireWorld(c, false);
      else if (c.t > MAX_SIM) this.retireWorld(c, true);
    }
    for (const c of this.flesh.slice()) {
      c.t += dt;
      c.soundT = Math.max(0, c.soundT - dt);
      if (c.t >= c.life) { this.removeFlesh(c); continue; }
      const b = c.body;
      if (b) {
        if (!Number.isFinite(b.position.x + b.position.y + b.position.z)) { this.removeFlesh(c); continue; }
        if (groundClamp(b, this.host.statics)) this.counts.clamped++;
        const p = b.interpolatedPosition, q = b.interpolatedQuaternion;
        c.mesh.position.set(p.x, p.y, p.z);
        c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        c.sleepT = restTime(b, c.size, c.sleepT, dt);
        if (c.sleepT > RETIRE_SLEEP || c.t > MAX_SIM) {
          this.host.world?.removeBody(b);
          c.body = null;
          c.mesh.position.set(b.position.x, b.position.y, b.position.z);
          c.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          this.counts.retired++;
        }
      }
      const left = c.life - c.t;
      if (left < FADE) c.mesh.scale.setScalar(Math.max(0.001, left / FADE));
    }
  }

  /** Remove every chunk body + flesh mesh (New Station); driven debris pieces are released to rest. */
  clear(): void {
    for (const c of this.world) { this.host.world?.removeBody(c.body); if (c.piece.serial === c.serial) this.release(c.piece, true); }
    this.world = [];
    for (const c of this.flesh.slice()) this.removeFlesh(c);
    this.flesh = [];
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }

  stats(): {worldBodies: number; flesh: number; fleshAwake: number; awake: number; counts: Record<string, number>} {
    return {worldBodies: this.world.length, flesh: this.flesh.length, fleshAwake: this.flesh.filter(c => c.body).length, awake: this.awake, counts: {...this.counts}};
  }

  /** QA: live flesh chunks (bounded list). */
  listFlesh(max = 24): {x: number; y: number; z: number; awake: boolean; age: number; tris: number}[] {
    return this.flesh.slice(-max).map(c => ({x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z, awake: !!c.body, age: c.t,
      tris: (c.mesh.geometry.attributes.position?.count ?? 0) / 3}));
  }
}

void tq;
