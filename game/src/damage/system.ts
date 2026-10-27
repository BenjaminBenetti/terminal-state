// Damage orchestration (iteration 06, Lane D): one entry point per bullet hit that resolves the hit
// to a damage class (damage/materials.ts) and produces the material-matched response —
//   structural surfaces: persistent crater (deepens with repeated hits) + physical chips + dust;
//   props: per-instance staged damage / breaking (damage/propDamage.ts) + debris + break cues;
//   zombies (alive or dead): rest-space flesh / clothing wounds (damage/wounds.ts) + flesh pieces;
//   loose pickups near the shot line: knocked about (never destroyed).
// Everything is pooled / bounded; this module owns the debris, crater and damaged-prop groups,
// all rendered in the normal depth-tested scene pass.

import * as THREE from 'three';
import type {StationLayout} from '../gen/station';
import type {PropPlacement} from '../gen/props';
import type {Effects} from '../world/fx';
import type {Sfx} from '../audio/sfx';
import type {WorldMaterials, MatKey} from '../world/materials';
import {shapeMaterial} from '../world/shapeMaterials';
import {StaticQuery} from '../physics/staticQuery';
import {raySphere, rayCapsule, type HitInfo, type Vec3, type WorldHit} from '../combat/hitscan';
import {DAMAGE_MATERIALS, STRUCTURAL_CLASS, structuralKeyAt, type DamageClass, type StructuralKey} from './materials';
import {DebrisSystem, type DebrisSpawn} from './debris';
import {CraterField} from './craters';
import {PropDamage, type PropBreakEvent, type PropDamageHooks} from './propDamage';
import {installWounds, woundsOf, type WoundController, type WoundableActor} from './wounds';
import {sampleTexture, textureMean} from './sample';

/** What the damage system needs from a zombie (ZombieActor satisfies it). */
export interface DamageZombie extends WoundableActor {
  brain: {alive: boolean; x: number; y?: number; z: number};
  scale: number;
  bone?(name: string): THREE.Object3D | undefined;
}

export interface DamagePickup { stack: {itemId: string; uid?: number}; x: number; y: number; z: number; obj: THREE.Object3D }

export interface DamageHooks extends PropDamageHooks {
  /** Loose pickups (knocked by near-miss shots). */
  pickups?(): readonly DamagePickup[];
}

export interface ShotInput {
  /** Weapon damage of this bullet / pellet after range falloff. */
  damage: number;
  pellet: boolean;
  weapon: string;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tc = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Pickups being knocked: velocity + spin until they settle. */
interface Knock { p: DamagePickup; vx: number; vy: number; vz: number; spin: number; t: number }

export class DamageSystem {
  readonly group = new THREE.Group();
  readonly debris = new DebrisSystem();
  readonly craters = new CraterField();
  readonly props = new PropDamage();
  private layout: StationLayout | null = null;
  private mats: WorldMaterials | null = null;
  private query: StaticQuery | null = null;
  private hooks: DamageHooks = {};
  private knocks: Knock[] = [];
  private actors: WoundController[] = [];
  private shot = 0;
  private tearShot = new WeakMap<object, number>();
  private fallCue = 0;
  rand: () => number = Math.random;
  /** Hits handled per kind (QA). */
  readonly counts = {structural: 0, prop: 0, zombie: 0, corpse: 0, knocked: 0, breaks: 0};

  constructor(private readonly fx: Effects | null, private readonly sfx: Sfx | null) {
    this.group.name = 'damage';
    this.group.add(this.debris.group, this.craters.mesh, this.props.group);
  }

  /** New station: index the station's render groups (call after world + containers are built). */
  build(layout: StationLayout, mats: WorldMaterials | null, roots: readonly THREE.Object3D[], hooks: DamageHooks = {}): void {
    this.clear();
    this.layout = layout;
    this.mats = mats;
    this.hooks = hooks;
    this.query = new StaticQuery(layout);
    this.debris.setStatics(this.query);
    this.props.hooks = {ownMeshes: hooks.ownMeshes, onBreak: e => this.onBreak(e)};
    this.props.build(layout.props, roots);
    this.props.warmup();
    this.warmFrames = 0;
  }
  private warmFrames = 0;

  clear(): void {
    this.debris.clear();
    this.craters.clear();
    this.props.clear();
    this.knocks = [];
    for (const w of this.actors) w.dispose();
    this.actors = [];
    for (const k in this.counts) (this.counts as Record<string, number>)[k] = 0;
  }

  /** Give a freshly built zombie its own wound-patched materials (lane contract). */
  installZombie(z: WoundableActor): void {
    this.actors.push(installWounds(z));
  }

  /** Call once per trigger pull (groups pellets: one tear cue per zombie per shot). */
  beginShot(): void {
    this.shot++;
  }

  // ---------------------------------------------------------------------------------------
  // World (grid surfaces + props)

  hitWorld(wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, shot: ShotInput): HitInfo {
    const L = this.layout;
    const normal = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
    if (wh.kind === 'prop' && L && wh.prop !== undefined && L.props[wh.prop]) {
      const prop = L.props[wh.prop];
      const r = this.props.hit({prop, index: wh.prop, point, dir, normal, damage: shot.damage, pellet: shot.pellet});
      if (!r.rubble) {
        this.counts.prop++;
        const spec = DAMAGE_MATERIALS[r.cls];
        this.fx?.impact(r.point, r.normal, spec.fx, {decal: !r.marked, chips: r.marked ? 1 : undefined});
        this.sfx?.impact(r.point.x, r.point.y, r.point.z, spec.sound);
        if (spec.sparks && r.cls === 'screen') this.fx?.sparks(r.point, r.normal, 6);
        this.burst(r.point, r.normal, dir, r.cls, r.color, shot.pellet ? 0.45 : 1);
        if (r.broke) this.breakBurst(prop, r.broke, r.boxes, r.cls, r.color, dir);
        return {point: v3(r.point), normal: v3(r.normal), object: 'prop', instanceId: wh.prop, material: r.cls, stage: r.stage, broke: r.broke};
      }
      // a broken (rubble-height) prop: the floor under it takes the hit
      return this.hitStructural('floor', point, UP.clone(), dir, shot);
    }
    if (wh.kind === 'none') return {point: v3(point), normal: v3(normal), object: 'wall', instanceId: null, material: 'concrete'};
    return this.hitStructural(wh.kind === 'prop' ? 'wall' : wh.kind, point, normal, dir, shot);
  }

  private hitStructural(kind: 'wall' | 'floor' | 'ceiling', point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, shot: ShotInput): HitInfo {
    this.counts.structural++;
    const L = this.layout!;
    const key = structuralKeyAt(kind, point.x, point.y, point.z, normal.x, normal.z, {grid: L.grid, areas: L.areas, trenches: L.trenches, safetyStrip: this.mats?.scale.safetyEdge.v});
    const cls = STRUCTURAL_CLASS[key];
    const spec = DAMAGE_MATERIALS[cls];
    // stair flights are a linear ramp for hitscan but drawn as treads: put the chip on the tread top
    if (key === 'stairs' && kind === 'floor') { point = point.clone(); point.y = L.grid.stepAt(point.x, point.z) + 0.001; }
    const surface = this.structuralColor(key, kind, point, normal) ?? new THREE.Color(spec.palette[Math.floor(this.rand() * spec.palette.length)]);
    const substrate = new THREE.Color(spec.substrate);
    if (key === 'tileLower' || key === 'tileUpper' || key === 'tileShop' || key === 'quarryTile') substrate.lerp(surface, 0.15);
    const dk = (1 - spec.hardness * 0.55) * (shot.pellet ? 0.22 : 0.38) * Math.min(1.5, shot.damage / 24 + 0.2);
    const crater = this.craters.hit(point, normal, {
      size: spec.markSize * (shot.pellet ? 0.62 : 1), maxSize: spec.markMax, depth: dk,
      substrate, surface: surface.clone(), style: cls === 'ballast' ? 1 : cls === 'tile' ? 2 : 0,
    }, this.rand);
    this.fx?.impact(point, normal, spec.fx, {decal: false, chips: 1, dustColor: surface.clone().lerp(new THREE.Color(spec.dust ?? 0x999999), 0.5)});
    this.sfx?.impact(point.x, point.y, point.z, spec.sound);
    // deeper craters shed bigger pieces
    this.burst(point, normal, dir, cls, surface, (shot.pellet ? 0.45 : 1) * (1 + crater.depth * 0.6), 1 + crater.depth * 0.5);
    if (crater.depth > 0.55 && spec.breakSound === 'debrisFall' && this.fallCue <= 0 && !shot.pellet) {
      this.fallCue = 0.35;
      this.sfx?.breakage('debrisFall', point.x, point.y, point.z, crater.depth * 0.7);
    }
    return {point: v3(point), normal: v3(normal), object: kind, instanceId: null, material: cls, stage: crater.depth >= 0.99 ? 2 : 1};
  }

  /** Fragment colour of a structural surface at the hit: its own texture where it can be read. */
  private structuralColor(key: StructuralKey, kind: string, p: THREE.Vector3, n: THREE.Vector3): THREE.Color | null {
    const mats = this.mats;
    if (!mats) return null;
    const L = this.layout!;
    try {
      if (key === 'tileShop' || key === 'quarryTile') return textureMean((shapeMaterial(mats, key) as THREE.MeshStandardMaterial).map, new THREE.Color());
      const mk: MatKey = key === 'stairs' ? 'concrete' : key;
      const m = mats.get(mk) as THREE.MeshStandardMaterial;
      const sc = mats.scale[mk];
      let u: number, v: number;
      if (kind === 'wall') {
        const along = Math.abs(n.x) > 0.5 ? p.z : p.x;
        const base = L.grid.floorAt(p.x + n.x * 0.25, p.z + n.z * 0.25) + (mk === 'tileUpper' ? mats.tileLowerHeight : 0);
        u = along / sc.u;
        v = (p.y - base) / sc.v;
      } else if (kind === 'floor') { u = p.x / sc.u; v = -p.z / sc.v; } else { u = p.x / sc.u; v = p.z / sc.v; }
      const c = sampleTexture(m.map, u, v, new THREE.Color());
      if (c && m.color) c.multiply(m.color);
      return c;
    } catch {
      return null;
    }
  }

  /** Material-matched pieces flying off a hit point. `k` scales the count, `sizeK` the size. */
  burst(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, cls: DamageClass, surface: THREE.Color, k = 1, sizeK = 1): number {
    const spec = DAMAGE_MATERIALS[cls], R = this.rand;
    const [lo, hi] = spec.chips;
    const n = Math.round((lo + R() * (hi - lo)) * k);
    let made = 0;
    const refl = tv2.copy(dir).addScaledVector(normal, -2 * dir.dot(normal)).normalize();
    for (let i = 0; i < n; i++) {
      const useSurface = R() < (spec.shape === 'shard' || spec.shape === 'flake' ? 0.7 : 0.5);
      const col = (useSurface ? tc.copy(surface) : tc.set(spec.substrate)).multiplyScalar(0.8 + R() * 0.35);
      const shape = cls === 'tile' && !useSurface ? 'chunk' : spec.shape;
      const sp = 1.3 + R() * 2.4;
      const v = tv.copy(normal).multiplyScalar(sp).addScaledVector(refl, 0.6 + R()).add(tv2.set((R() - 0.5) * 2.2, R() * 1.6, (R() - 0.5) * 2.2));
      const size = (spec.chip[0] + (spec.chip[1] - spec.chip[0]) * Math.pow(R(), 1.6)) * sizeK;
      const s: DebrisSpawn = {x: point.x + normal.x * 0.02, y: point.y + normal.y * 0.02, z: point.z + normal.z * 0.02, vx: v.x, vy: v.y, vz: v.z, size, color: col, shape};
      if (this.debris.spawn(s)) made++;
    }
    return made;
  }

  private onBreak(e: PropBreakEvent): void {
    this.counts.breaks++;
    this.hooks.onBreak?.(e);
  }

  /** Big piece bursts for a full break (glass shatter, crate splinter, carton collapse, vending front). */
  private breakBurst(prop: PropPlacement, kind: string, boxes: THREE.Box3[], cls: DamageClass, color: THREE.Color, dir: THREE.Vector3): void {
    const R = this.rand;
    const c = boxes[0]?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(prop.x, prop.y + prop.h / 2, prop.z);
    if (kind === 'shatter' || kind === 'open' || kind === 'dead') {
      this.sfx?.breakage('breakGlass', c.x, c.y, c.z, kind === 'dead' ? 0.4 : 1);
      if (kind === 'dead') this.fx?.sparks(c, tv.copy(dir).negate(), 14);
      for (const b of boxes) {
        const sz = b.getSize(new THREE.Vector3());
        const area = sz.x * sz.y + sz.z * sz.y + sz.x * sz.z;
        const n = Math.max(8, Math.min(kind === 'dead' ? 10 : 46, Math.round(area * 40)));
        for (let i = 0; i < n; i++) {
          const x = b.min.x + R() * sz.x, y = b.min.y + R() * sz.y, z = b.min.z + R() * sz.z;
          const v = tv.copy(dir).multiplyScalar(0.8 + R() * 1.6).add(tv2.set((R() - 0.5) * 1.6, R() * 0.8, (R() - 0.5) * 1.6));
          this.debris.spawn({x, y, z, vx: v.x, vy: v.y, vz: v.z, size: 0.03 + Math.pow(R(), 1.5) * 0.1, color: tc.set(DAMAGE_MATERIALS.glass.palette[i % 3]), shape: 'glass', life: 45});
        }
      }
      return;
    }
    const b = boxes[0];
    const sz = b.getSize(new THREE.Vector3());
    if (kind === 'splinter') {
      this.sfx?.breakage('breakWood', c.x, c.y, c.z, 1);
      for (let i = 0; i < 18; i++) {
        const x = b.min.x + R() * sz.x, y = b.min.y + R() * sz.y, z = b.min.z + R() * sz.z;
        const out = tv2.set(x - c.x, 0, z - c.z).normalize();
        const v = tv.copy(out).multiplyScalar(0.6 + R() * 1.6).addScaledVector(dir, 0.8 + R()).add(tv2.set(0, 1 + R() * 2, 0));
        const plank = i < 10;
        this.debris.spawn({x, y, z, vx: v.x, vy: v.y, vz: v.z, size: plank ? 0.18 + R() * 0.3 : 0.04 + R() * 0.08, color: tc.copy(color).multiplyScalar(0.75 + R() * 0.4), shape: 'splinter', life: 70,
          aspect: plank ? [0.5 + R() * 0.6, 0.35 + R() * 0.3, 1] : undefined});
      }
      this.burst(c, tv.set(0, 1, 0), dir, 'wood', color, 1.5);
    } else if (kind === 'collapse') {
      this.sfx?.breakage('breakWood', c.x, c.y, c.z, 0.55);
      this.sfx?.breakage('debrisFall', c.x, c.y, c.z, 0.4);
      for (let i = 0; i < 14; i++) {
        const x = b.min.x + R() * sz.x, y = b.min.y + R() * sz.y, z = b.min.z + R() * sz.z;
        const v = tv.copy(dir).multiplyScalar(0.4 + R()).add(tv2.set((R() - 0.5) * 1.5, R() * 1.2, (R() - 0.5) * 1.5));
        this.debris.spawn({x, y, z, vx: v.x, vy: v.y, vz: v.z, size: i < 8 ? 0.22 + R() * 0.22 : 0.05 + R() * 0.08, color: tc.copy(color).multiplyScalar(0.8 + R() * 0.35), shape: 'flake', life: 75});
      }
    }
    void cls;
  }

  // ---------------------------------------------------------------------------------------
  // Zombies

  /** A bullet / pellet into a zombie (alive or a corpse): wound + blood + flesh / cloth pieces. */
  hitZombie(z: DamageZombie, point: THREE.Vector3, dir: THREE.Vector3, part: 'head' | 'torso' | 'limb', shot: ShotInput, corpse = false): HitInfo {
    if (corpse) this.counts.corpse++; else this.counts.zombie++;
    const w = woundsOf(z);
    const r = w?.add({point, dir, part, damage: shot.damage, pellet: shot.pellet}) ?? null;
    const at = r?.entry ?? point;
    const floorY = this.layout ? this.layout.grid.stepAt(at.x, at.z) : 0;
    this.fx?.bodyHit(at, dir, floorY);
    const R = this.rand;
    const strength = r?.strength ?? 0.3;
    const pieces = shot.pellet ? (R() < 0.35 + strength * 0.3 ? 1 : 0) : 1 + (strength > 0.5 ? 1 : 0) + (part !== 'torso' && R() < 0.5 ? 1 : 0);
    for (let i = 0; i < pieces; i++) {
      const v = tv.copy(dir).multiplyScalar(0.6 + R() * 1.6).add(tv2.set((R() - 0.5) * 1.4, 0.4 + R() * 1.4, (R() - 0.5) * 1.4));
      this.debris.spawn({x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z, size: 0.018 + R() * 0.03 * (1 + strength), color: tc.set(DAMAGE_MATERIALS.flesh.palette[i % 3]).multiplyScalar(0.8 + R() * 0.4), shape: 'blob'});
    }
    if (r && (r.cls === 'cloth' || r.cls === 'rubber') && (!shot.pellet || R() < 0.4)) {
      const v = tv.copy(dir).multiplyScalar(-0.4).add(tv2.set((R() - 0.5) * 1.2, 0.6 + R(), (R() - 0.5) * 1.2));
      this.debris.spawn({x: at.x, y: at.y, z: at.z, vx: v.x, vy: v.y, vz: v.z, size: 0.03 + R() * 0.035, color: tc.copy(r.color).multiplyScalar(0.85), shape: 'flake', life: 30});
    }
    if (r && this.tearShot.get(z) !== this.shot && (strength > 0.45 || (shot.pellet && r.merged && strength > 0.3))) {
      this.tearShot.set(z, this.shot);
      this.sfx?.breakage('fleshTear', at.x, at.y, at.z, Math.min(1, 0.4 + strength));
    }
    const restP = r ? w!.wounds[r.index]?.c : null;
    return {point: v3(at), normal: v3(tv.copy(dir).negate()), object: corpse ? 'corpse' : 'zombie', instanceId: null, material: r?.cls ?? 'flesh', bone: r?.bone,
      localPoint: restP ? v3(restP) : undefined};
  }

  /**
   * Corpses stop bullets too (their flesh tears like the living): nearest dead zombie whose
   * bone capsules the ray crosses before maxT.
   */
  corpseHit(zombies: readonly DamageZombie[], o: Vec3, d: Vec3, maxT: number): {z: DamageZombie; t: number; part: 'head' | 'torso' | 'limb'} | null {
    let best: {z: DamageZombie; t: number; part: 'head' | 'torso' | 'limb'} | null = null;
    for (const z of zombies) {
      if (z.brain.alive || !z.bone) continue;
      const dx = z.brain.x - o.x, dz = z.brain.z - o.z;
      const along = dx * d.x + dz * d.z;
      if (along < -2 || along > maxT + 2) continue;
      const vols = corpseVolumes(z);
      for (const v of vols) {
        const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r);
        if (t < (best?.t ?? maxT)) best = {z, t, part: v.part};
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------
  // Loose pickups: knocked by shots passing close (never destroyed, stay reachable)

  knockPickups(o: Vec3, d: Vec3, maxT: number): number {
    const list = this.hooks.pickups?.() ?? [];
    let n = 0;
    for (const p of list) {
      const t = raySphere(o, d, {x: p.x, y: p.y + 0.08, z: p.z}, 0.13);
      if (!(t < maxT)) continue;
      const hl = Math.hypot(d.x, d.z) || 1;
      const k = this.knocks.find(q => q.p === p);
      const vx = d.x / hl * (1.4 + this.rand() * 0.8), vz = d.z / hl * (1.4 + this.rand() * 0.8);
      if (k) { k.vx += vx * 0.6; k.vz += vz * 0.6; k.vy = Math.max(k.vy, 1.2); k.t = 0; }
      else this.knocks.push({p, vx, vy: 1.3 + this.rand() * 0.6, vz, spin: (this.rand() - 0.5) * 14, t: 0});
      this.sfx?.impact(p.x, p.y + 0.05, p.z, 'sheet');
      n++;
      this.counts.knocked++;
    }
    return n;
  }

  private updateKnocks(dt: number): void {
    const L = this.layout, q = this.query;
    if (!L || !q || !this.knocks.length) { this.knocks.length = 0; return; }
    const g = L.grid;
    for (const k of this.knocks) {
      k.t += dt;
      const p = k.p;
      const nx = p.x + k.vx * dt, nz = p.z + k.vz * dt;
      // stay on reachable floor at about the same level, never through walls or off into a wall cell
      const [cx, cy] = g.cellOf(nx, nz);
      const ok = g.passable(cx, cy) && Math.abs(g.floorAt(nx, nz) - g.floorAt(p.x, p.z)) < 0.3 && g.lineOfSight(p.x, p.z, nx, nz) && !q.blocked(nx, p.y + 0.06, nz, 0.06);
      if (ok) { p.x = nx; p.z = nz; } else { k.vx *= -0.3; k.vz *= -0.3; }
      k.vy -= 9.81 * dt;
      p.y += k.vy * dt;
      const ground = q.surfaceBelow(p.x, p.z, p.y + 0.1);
      if (p.y <= ground) {
        p.y = ground === Infinity ? g.stepAt(p.x, p.z) : ground;
        k.vy = Math.abs(k.vy) > 1.2 ? Math.abs(k.vy) * 0.25 : 0;
        k.vx *= 0.55; k.vz *= 0.55; k.spin *= 0.5;
      }
      p.obj.position.set(p.x, p.y, p.z);
      p.obj.rotation.y += k.spin * dt;
    }
    this.knocks = this.knocks.filter(k => k.t < 3 && (Math.abs(k.vx) + Math.abs(k.vz) > 0.05 || k.vy !== 0));
  }

  // ---------------------------------------------------------------------------------------

  update(dt: number): void {
    // pre-warm meshes have been rendered (compiled) by now: drop them
    if (this.props.warming && ++this.warmFrames > 3) this.props.dropWarmup();
    this.fallCue -= dt;
    this.debris.update(dt);
    this.updateKnocks(dt);
  }

  stats(zombies: readonly object[] = []): {
    debrisLive: number; debrisByShape: Record<string, number>; debrisResting: number; debrisSpawned: number; debrisDropped: number;
    craters: number; craterMerges: number; props: ReturnType<PropDamage['stats']>; woundsPerZombie: number[]; counts: Record<string, number>; knocking: number;
  } {
    return {
      debrisLive: this.debris.live, debrisByShape: this.debris.liveByShape(), debrisResting: this.debris.resting(), debrisSpawned: this.debris.spawned, debrisDropped: this.debris.dropped,
      craters: this.craters.count, craterMerges: this.craters.merges, props: this.props.stats(),
      woundsPerZombie: zombies.map(z => woundsOf(z)?.count ?? 0), counts: {...this.counts}, knocking: this.knocks.length,
    };
  }
}

const v3 = (v: THREE.Vector3): Vec3 => ({x: v.x, y: v.y, z: v.z});

/** Corpse hit volumes from the (ragdolled / death-clip) bones. */
const DEFAULT_RADII = {head: 0.135, torso: 0.2, arm: 0.075, leg: 0.1};
export function corpseVolumes(z: DamageZombie): {part: 'head' | 'torso' | 'limb'; a: Vec3; b: Vec3 | null; r: number}[] {
  const at = (n: string): Vec3 | null => { const b = z.bone?.(n); if (!b) return null; b.getWorldPosition(tv); return {x: tv.x, y: tv.y, z: tv.z}; };
  const H = ((z as unknown as {hit?: typeof DEFAULT_RADII}).hit) ?? DEFAULT_RADII;
  const s = z.scale || 1;
  const out: {part: 'head' | 'torso' | 'limb'; a: Vec3; b: Vec3 | null; r: number}[] = [];
  const head = at('Head'), neck = at('Neck'), hips = at('Hips');
  if (head) out.push({part: 'head', a: head, b: null, r: H.head * s});
  if (hips && neck) out.push({part: 'torso', a: hips, b: neck, r: H.torso * s});
  for (const [a, b, r] of [['L_UpperArm', 'L_Hand', H.arm], ['R_UpperArm', 'R_Hand', H.arm], ['L_Thigh', 'L_Foot', H.leg], ['R_Thigh', 'R_Foot', H.leg]] as const) {
    const pa = at(a), pb = at(b);
    if (pa && pb) out.push({part: 'limb', a: pa, b: pb, r: r * s});
  }
  return out;
}
