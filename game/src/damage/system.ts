// Damage orchestration (iteration 06, Lane D): one entry point per bullet hit that resolves the hit
// to a damage class (damage/materials.ts) and produces the material-matched response —
//   structural surfaces: persistent crater (deepens with repeated hits) + physical chips + dust;
//   props: per-instance staged damage / breaking (damage/propDamage.ts) + debris + break cues;
//   zombies (alive or dead): rest-space flesh / clothing wounds (damage/wounds.ts) + flesh pieces;
//   loose pickups near the shot line: knocked about (never destroyed).
// Everything is pooled / bounded; this module owns the debris, crater and damaged-prop groups,
// all rendered in the normal depth-tested scene pass.
// Iteration 08 (Lane B): stacked levels — a structural hit reads its material from the grid of the
// level whose band the bullet was in (WorldHit.level: the upper deck's floor, the slab underside
// over the platform, a lower-level wall), stair chips land on that flight's treads, blood finds the
// floor of the storey the body stands on, and knocked loose pickups stay on their own storey.

import * as THREE from 'three';
import type {StationLayout} from '../gen/station';
import type {PropPlacement} from '../gen/props';
import type {Effects} from '../world/fx';
import type {Sfx} from '../audio/sfx';
import type {WorldMaterials, MatKey} from '../world/materials';
import {shapeMaterial} from '../world/shapeMaterials';
import {StaticQuery} from '../physics/staticQuery';
import type {Grid} from '../gen/grid';
import {raySphere, rayCapsule, type HitInfo, type Vec3, type WorldHit} from '../combat/hitscan';
import {CHUNK_PHYS, DAMAGE_MATERIALS, STRUCTURAL_CLASS, itemClass, ridesHost, structuralKeyAt, type DamageClass, type StructuralKey} from './materials'; // (+ ridesHost: task mall-playtest-revision-20261031, lane SHOPS U05)
import {DebrisSystem, type DebrisSpawn} from './debris';
import {CraterField} from './craters';
import {PropDamage, type PropBreakEvent, type PropDamageHooks} from './propDamage';
import {installWounds, woundsOf, type WoundController, type WoundResult, type WoundableActor} from './wounds';
import {materialBaseColor, sampleTexture, textureMean} from './sample';
import {finishClass} from './impactFinish'; // task reactor-expansion-20261101 (lane CONTROLS): impacts take the drawn finish
import {extractPatch, fallbackFlap} from './fleshPatch';
import {knownSupportKind} from '../physics/merchOnHost'; // task studio-skywalk-variety-20261107-231448-01 (lane MERCH)
import type {PhysicsSystem} from '../physics/world';
import type {PickupLike} from '../physics/dynamicItems';
import {S as SPAN} from '../debug/updateProfile'; // task hitch-attribution-recorder-20261105: hit.* span ids (timing only)

/** The opt-in frame profiler's nested-span calls (debug/updateProfile.ts UpdateProfiler; a no-op unless it is recording). */
export interface DamageProfiler { begin(id: number): void; end(id: number): void }

/** What the damage system needs from a zombie (ZombieActor satisfies it). */
export interface DamageZombie extends WoundableActor {
  brain: {alive: boolean; x: number; y?: number; z: number};
  scale: number;
  bone?(name: string): THREE.Object3D | undefined;
  /** Iteration 07: animated bone velocity (chunks inherit it; ZombieActor / RagdollTarget). */
  boneVelocity?(name: string, out: THREE.Vector3): THREE.Vector3;
  /** Iteration 07: non-humanoid actors may supply their own corpse hit volumes (else humanoid bones). */
  corpseVolumes?(): {part: 'head' | 'torso' | 'limb'; a: Vec3; b: Vec3 | null; r: number}[];
  /**
   * Task studio-bb-production-20261112-234540-01 (lane ACTOR): a NON-GRAPHIC body (BB; EnemyActor.nonGraphic). installZombie gives it
   * no wound materials and hitZombie shows no wound, blood, flesh / cloth piece, tear cue or torn-off chunk on it — alive, on the
   * killing hit, or as a corpse: a neutral dust puff marks the hit instead. Damage itself is not this module's business.
   */
  readonly nonGraphic?: boolean;
}

export interface DamagePickup { stack: {itemId: string; uid?: number; count?: number}; x: number; y: number; z: number; obj: THREE.Object3D }

/** Iteration 07 (Lane K): a visible loot lot crossed by a shot (ContainerManager.shotLots). */
export interface ShotLot { holder: object; lotId: number; t: number }

export interface DamageHooks extends PropDamageHooks {
  /** Loose pickups (shot items become rigid bodies; legacy: knocked by near-miss shots). */
  pickups?(): readonly DamagePickup[];
  /** Iteration 07 (Lane K): the station physics (rigid items / chunks); none = legacy knock + ballistic debris. */
  physics?: PhysicsSystem | null;
  /** Visible loot lots along a shot ray (nearest first, before maxT). */
  lots?(o: Vec3, d: Vec3, maxT: number): readonly ShotLot[];
  /**
   * Lift a lot off its holder into a loose pickup at its exact transform (same item id / count; the lot
   * is removed from the holder so it can never be taken twice). null if it is no longer there.
   */
  detachLot?(holder: object, lotId: number): PickupLike | null;
  /** Visible loot lots overlapping a world box (a flying item knocks them over). */
  lotsIn?(box: THREE.Box3): readonly {holder: object; lotId: number}[];
  /**
   * Task reactor-expansion-20261101 (lane CONTROLS): the arch-owned finish key the builder DREW at a structural hit (world/finishAt.ts:
   * the Reactor's pit concrete / steel grating / rusted plate, the Office's drywall / carpet …); null = the station rule.
   */
  finishAt?: ((kind: 'wall' | 'floor' | 'ceiling', levelIndex: number, x: number, y: number, z: number, nx: number, nz: number) => string | null) | null;
  /** The material behind a finish key (its texture colours the chips). */
  finishMaterial?(key: string): THREE.Material | undefined;
}

/** Bullet impulse handed to a loose item / light prop (N.s per point of weapon damage: rifle ~1.3, buckshot pellet ~0.8). */
export const SHOT_IMPULSE_PER_DAMAGE = 0.055;
/** Torn-off actor pieces per actor (bounded; later hits still wound). */
export const MAX_TEARS_PER_ACTOR = 12;

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
  private patchShot = new WeakMap<object, number>();
  private fallCue = 0;
  private physics: PhysicsSystem | null = null;
  rand: () => number = Math.random;
  /**
   * Task hitch-attribution-recorder-20261105: the game's frame profiler (Game sets it), for the hit.zombie / hit.tearChunk /
   * hit.extractPatch spans. Timing only — every outcome (wounds, chunks, debris, RNG draws) is the same with or without it.
   */
  prof: DamageProfiler | null = null;
  /** Hits handled per kind (QA). */
  readonly counts = {structural: 0, prop: 0, zombie: 0, corpse: 0, knocked: 0, breaks: 0, itemsShot: 0, lotsLifted: 0, propsShoved: 0, patches: 0, flaps: 0, worldChunks: 0};

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
    this.physics = hooks.physics ?? null;
    if (this.physics) {
      const di = this.physics.dynamicItems;
      di.detacher = this.props;
      di.pickups = () => (hooks.pickups?.() ?? []) as readonly PickupLike[];
      di.liftLots = box => {
        const out: PickupLike[] = [];
        for (const l of hooks.lotsIn?.(box) ?? []) { const pk = hooks.detachLot?.(l.holder, l.lotId); if (pk) { out.push(pk); this.counts.lotsLifted++; } }
        return out;
      };
    }
    this.props.warmup();
    this.warmFrames = 0;
  }
  private warmFrames = 0;

  /**
   * `retire` (iteration 14): when given, the wound material clones' GPU release is handed to it (the game runs it after
   * the next station's warm-up, so three keeps the shared zombie programs instead of rebuilding them); else immediate. The prop
   * damage materials go the same way (task runtime-variant-warmup-20261105).
   */
  clear(retire?: (release: () => void) => void): void {
    this.debris.clear();
    this.craters.clear();
    this.props.clear(retire);
    this.knocks = [];
    const actors = this.actors;
    if (retire) retire(() => { for (const w of actors) w.dispose(); });
    else for (const w of actors) w.dispose();
    this.actors = [];
    for (const k in this.counts) (this.counts as Record<string, number>)[k] = 0;
  }

  /**
   * Give a freshly built zombie its own wound-patched materials (lane contract). A non-graphic body (BB) gets none: it keeps its own
   * materials and has no wound controller, so nothing can ever mark or tear it (task studio-bb-production-20261112-234540-01).
   */
  installZombie(z: WoundableActor & {readonly nonGraphic?: boolean}): void {
    if (z.nonGraphic) return;
    this.actors.push(installWounds(z));
  }

  /**
   * Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): `z` leaves this station's damage bookkeeping (a picked-up body: the
   * corpse system owns it and disposes its materials with the actor) — its wound controller is no longer released by clear(). False when
   * it was not installed here.
   */
  releaseZombie(z: WoundableActor): boolean {
    const w = woundsOf(z);
    const i = w ? this.actors.indexOf(w) : -1;
    if (i < 0) return false;
    this.actors.splice(i, 1);
    return true;
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
      // Iteration 07: a light prop (trash can …) takes the shot's impulse at the hit point and goes loose
      if (!r.rubble && this.physics?.world && this.physics.dynamicItems.isDynamicProp(prop)) {
        if (this.physics.dynamicItems.shootProp(prop, wh.prop, r.point, dir, shot.damage * SHOT_IMPULSE_PER_DAMAGE)) this.counts.propsShoved++;
      } else if (!r.rubble && this.physics?.world && prop.host !== undefined && ridesHost(prop.kind)) {
        // Task mall-playtest-revision-20261031 (lane SHOPS, U05): a shot into garments hung on a garment rail shoves the rail they ride
        const host = L.props[prop.host];
        if (host && this.physics.dynamicItems.isDynamicProp(host) && this.physics.dynamicItems.shootProp(host, prop.host, r.point, dir, shot.damage * SHOT_IMPULSE_PER_DAMAGE)) this.counts.propsShoved++;
      }
      if (!r.rubble) {
        this.counts.prop++;
        const spec = DAMAGE_MATERIALS[r.cls];
        this.fx?.impact(r.point, r.normal, spec.fx, {decal: !r.marked, chips: r.marked ? 1 : undefined});
        this.sfx?.impact(r.point.x, r.point.y, r.point.z, spec.sound);
        if (spec.sparks && r.cls === 'screen') this.fx?.sparks(r.point, r.normal, 6);
        this.burst(r.point, r.normal, dir, r.cls, r.color, shot.pellet ? 0.45 : 1);
        if (r.broke) this.breakBurst(prop, r.broke, r.boxes, r.cls, r.color, dir);
        return {point: v3(r.point), normal: v3(r.normal), object: 'prop', instanceId: wh.prop, material: r.cls, stage: r.stage, broke: r.broke, level: prop.level ?? wh.level ?? 0};
      }
      // a broken (rubble-height) prop: the floor under it takes the hit (its own storey)
      return this.hitStructural('floor', point, UP.clone(), dir, shot, prop.level);
    }
    if (wh.kind === 'none') return {point: v3(point), normal: v3(normal), object: 'wall', instanceId: null, material: 'concrete'};
    return this.hitStructural(wh.kind === 'prop' ? 'wall' : wh.kind, point, normal, dir, shot, wh.level);
  }

  /** Iteration 08: grid of the level a structural hit belongs to (the ray's band; else the band holding the point). */
  private levelGrid(level: number | undefined, point: THREE.Vector3): Grid {
    const L = this.layout!, lv = this.query?.levels;
    if (!lv || lv.count < 2) return L.grid;
    const k = level !== undefined && level >= 0 && level < lv.count ? level : lv.levelAt(point.x, point.z, point.y + 0.05, 0.1);
    return k >= 0 ? lv.grid(k) : L.grid;
  }

  private hitStructural(kind: 'wall' | 'floor' | 'ceiling', point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, shot: ShotInput, level?: number): HitInfo {
    this.counts.structural++;
    const L = this.layout!;
    const G = this.levelGrid(level, point);
    const key = structuralKeyAt(kind, point.x, point.y, point.z, normal.x, normal.z, {grid: G, areas: L.areas, trenches: L.trenches, safetyStrip: this.mats?.scale.safetyEdge.v});
    // task reactor-expansion-20261101 (lane CONTROLS): the finish the arch actually DREW here decides the effect (pit concrete, steel
    // grating, rusted plate, drywall, carpet …); damage numbers are untouched (structural hits deal no damage — chips / sound / crater only)
    const fk = this.finishKeyAt(kind, level, point, normal);
    const fcls = finishClass(fk);
    const cls = fcls ?? STRUCTURAL_CLASS[key];
    const spec = DAMAGE_MATERIALS[cls];
    // stair flights are a linear ramp for hitscan but drawn as treads: put the chip on the tread top
    if (key === 'stairs' && kind === 'floor') { point = point.clone(); point.y = G.stepAt(point.x, point.z) + 0.001; }
    const surface = (fcls ? this.finishColor(fk!) : this.structuralColor(key, kind, point, normal, G)) ?? new THREE.Color(spec.palette[Math.floor(this.rand() * spec.palette.length)]);
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
    return {point: v3(point), normal: v3(normal), object: kind, instanceId: null, material: cls, stage: crater.depth >= 0.99 ? 2 : 1, level: level ?? -1};
  }

  /** Task reactor-expansion-20261101 (lane CONTROLS): the arch finish key at a structural hit (hooks.finishAt), or null. */
  finishKeyAt(kind: 'wall' | 'floor' | 'ceiling', level: number | undefined, point: THREE.Vector3, normal: THREE.Vector3): string | null {
    const f = this.hooks.finishAt;
    if (!f) return null;
    const lv = this.query?.levels;
    const k = !lv || lv.count < 2 ? 0 : level !== undefined && level >= 0 && level < lv.count ? level : lv.levelAt(point.x, point.z, point.y + (kind === 'ceiling' ? -0.05 : 0.05), 0.1);
    try { return f(kind, Math.max(0, k), point.x, point.y, point.z, normal.x, normal.z); } catch { return null; }
  }

  /** The damage class at a structural hit: the drawn arch finish's, else the station rule's (knife contacts, QA). */
  structuralClassAt(kind: 'wall' | 'floor' | 'ceiling', level: number | undefined, point: THREE.Vector3, normal: THREE.Vector3): DamageClass {
    const fcls = finishClass(this.finishKeyAt(kind, level, point, normal));
    if (fcls) return fcls;
    const L = this.layout;
    if (!L) return 'concrete';
    return STRUCTURAL_CLASS[structuralKeyAt(kind, point.x, point.y, point.z, normal.x, normal.z, {grid: this.levelGrid(level, point), areas: L.areas, trenches: L.trenches, safetyStrip: this.mats?.scale.safetyEdge.v})];
  }

  /** Fragment colour of an arch finish: its material's texture mean x colour (null: unreadable). */
  private finishColor(key: string): THREE.Color | null {
    const m = this.hooks.finishMaterial?.(key);
    if (!m) return null;
    try { return textureMean((m as THREE.MeshStandardMaterial).map) ? materialBaseColor(m) : null; } catch { return null; }
  }

  /** Fragment colour of a structural surface at the hit: its own texture where it can be read. */
  private structuralColor(key: StructuralKey, kind: string, p: THREE.Vector3, n: THREE.Vector3, G: Grid): THREE.Color | null {
    const mats = this.mats;
    if (!mats) return null;
    try {
      if (key === 'tileShop' || key === 'quarryTile') return textureMean((shapeMaterial(mats, key) as THREE.MeshStandardMaterial).map, new THREE.Color());
      const mk: MatKey = key === 'stairs' ? 'concrete' : key;
      const m = mats.get(mk) as THREE.MeshStandardMaterial;
      const sc = mats.scale[mk];
      let u: number, v: number;
      if (kind === 'wall') {
        const along = Math.abs(n.x) > 0.5 ? p.z : p.x;
        const base = G.floorAt(p.x + n.x * 0.25, p.z + n.z * 0.25) + (mk === 'tileUpper' ? mats.tileLowerHeight : 0);
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
    const refl = new THREE.Vector3().copy(dir).addScaledVector(normal, -2 * dir.dot(normal)).normalize();
    // Iteration 07 (Lane K): the biggest piece of a full hit (a fraction of pellet hits) is a real rigid body
    const phys = this.physics?.world && spec.chip[1] >= 0.02 ? (k >= 0.9 ? 1 : R() < 0.35 ? 1 : 0) : 0;
    for (let i = 0; i < n; i++) {
      const useSurface = R() < (spec.shape === 'shard' || spec.shape === 'flake' ? 0.7 : 0.5);
      const col = (useSurface ? tc.copy(surface) : tc.set(spec.substrate)).multiplyScalar(0.8 + R() * 0.35);
      const shape = cls === 'tile' && !useSurface ? 'chunk' : spec.shape;
      const sp = 1.3 + R() * 2.4;
      const v = tv.copy(normal).multiplyScalar(sp).addScaledVector(refl, 0.6 + R()).add(tv2.set((R() - 0.5) * 2.2, R() * 1.6, (R() - 0.5) * 2.2));
      const big = i < phys;
      const size = (big ? spec.chip[1] * (0.85 + R() * 0.45) : spec.chip[0] + (spec.chip[1] - spec.chip[0]) * Math.pow(R(), 1.6)) * sizeK;
      const s: DebrisSpawn = {x: point.x + normal.x * 0.02, y: point.y + normal.y * 0.02, z: point.z + normal.z * 0.02, vx: v.x, vy: v.y, vz: v.z, size, color: col, shape};
      if (big ? this.physicalPiece(s, cls) : this.debris.spawn(s)) made++;
    }
    return made;
  }

  /** Iteration 07: a debris piece driven by a rigid body (falls back to an ordinary ballistic piece). */
  private physicalPiece(s: DebrisSpawn, cls: DamageClass): boolean {
    const ph = this.physics;
    if (!ph?.world) return this.debris.spawn(s);
    const d = this.debris.spawnDriven(s);
    if (!d) return false;
    const R = this.rand, c = CHUNK_PHYS[cls];
    const spin = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(2 * (cls === 'wood' || cls === 'glass' ? 18 : 24));
    ph.chunks.spawnWorld(d.piece, d.half, {vel: new THREE.Vector3(s.vx, s.vy, s.vz), spin, mat: c.mat, density: c.density});
    this.counts.worldChunks++;
    return true;
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
          // Iteration 07: the first few big shards are rigid bodies (slide / clink / settle on the real floor)
          const big = kind === 'shatter' && i < 4;
          const sp: DebrisSpawn = {x, y, z, vx: v.x, vy: v.y, vz: v.z, size: big ? 0.09 + R() * 0.06 : 0.03 + Math.pow(R(), 1.5) * 0.1, color: tc.set(DAMAGE_MATERIALS.glass.palette[i % 3]), shape: 'glass', life: 45};
          if (big) this.physicalPiece(sp, 'glass'); else this.debris.spawn(sp);
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
        const sp: DebrisSpawn = {x, y, z, vx: v.x, vy: v.y, vz: v.z, size: plank ? 0.18 + R() * 0.3 : 0.04 + R() * 0.08, color: tc.copy(color).multiplyScalar(0.75 + R() * 0.4), shape: 'splinter', life: 70,
          aspect: plank ? [0.5 + R() * 0.6, 0.35 + R() * 0.3, 1] : undefined};
        // Iteration 07: crate boards are rigid bodies (tumble, stack, settle)
        if (i < 6) this.physicalPiece(sp, 'wood'); else this.debris.spawn(sp);
      }
      this.burst(c, tv.set(0, 1, 0), dir, 'wood', color, 1.5);
    } else if (kind === 'collapse') {
      this.sfx?.breakage('breakWood', c.x, c.y, c.z, 0.55);
      this.sfx?.breakage('debrisFall', c.x, c.y, c.z, 0.4);
      for (let i = 0; i < 14; i++) {
        const x = b.min.x + R() * sz.x, y = b.min.y + R() * sz.y, z = b.min.z + R() * sz.z;
        const v = tv.copy(dir).multiplyScalar(0.4 + R()).add(tv2.set((R() - 0.5) * 1.5, R() * 1.2, (R() - 0.5) * 1.5));
        const sp: DebrisSpawn = {x, y, z, vx: v.x, vy: v.y, vz: v.z, size: i < 8 ? 0.22 + R() * 0.22 : 0.05 + R() * 0.08, color: tc.copy(color).multiplyScalar(0.8 + R() * 0.35), shape: 'flake', life: 75};
        if (i < 6) this.physicalPiece(sp, 'cardboard'); else this.debris.spawn(sp);
      }
    }
    void cls;
  }

  // ---------------------------------------------------------------------------------------
  // Zombies

  /** A bullet / pellet into a zombie (alive or a corpse): wound + blood + flesh / cloth pieces. */
  hitZombie(z: DamageZombie, point: THREE.Vector3, dir: THREE.Vector3, part: 'head' | 'torso' | 'limb', shot: ShotInput, corpse = false): HitInfo {
    this.prof?.begin(SPAN.hitZombie);
    if (corpse) this.counts.corpse++; else this.counts.zombie++;
    if (z.nonGraphic) {
      // Task studio-bb-production-20261112-234540-01 (lane ACTOR): a non-graphic body (BB) — no wound, no blood spray / floor splat, no
      // flesh or cloth piece, no tear cue, no torn-off chunk; alive, on the killing hit and as a corpse alike. The hit is marked by the
      // existing soft-goods dust puff (no decal, no chips). No RNG draw: the game's stream is the same as if the shot had missed.
      const back = tv.copy(dir).negate();
      this.fx?.impact(point, back, 'soft', {decal: false, chips: 0});
      const hit: HitInfo = {point: v3(point), normal: v3(back), object: corpse ? 'corpse' : 'zombie', instanceId: null, material: 'cloth'};
      this.prof?.end(SPAN.hitZombie);
      return hit;
    }
    const w = woundsOf(z);
    const r = w?.add({point, dir, part, damage: shot.damage, pellet: shot.pellet}) ?? null;
    const at = r?.entry ?? point;
    // iteration 08: the floor of the storey the body is on (not the deck above / the floor below)
    const lv = this.query?.levels;
    const floorY = !this.layout ? 0 : lv && lv.count > 1 ? (lv.supportAt(at.x, at.z, at.y, 0.1)?.floor ?? this.layout.grid.stepAt(at.x, at.z)) : this.layout.grid.stepAt(at.x, at.z);
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
    if (r && w) { this.prof?.begin(SPAN.tearChunk); this.tearChunk(z, w, r, dir, shot, part); this.prof?.end(SPAN.tearChunk); }
    const restP = r ? w!.wounds[r.index]?.c : null;
    const info: HitInfo = {point: v3(at), normal: v3(tv.copy(dir).negate()), object: corpse ? 'corpse' : 'zombie', instanceId: null, material: r?.cls ?? 'flesh', bone: r?.bone,
      localPoint: restP ? v3(restP) : undefined};
    this.prof?.end(SPAN.hitZombie);
    return info;
  }

  /**
   * Iteration 07 (Lane K): a real piece comes OFF the actor where it was shot — the triangles around
   * the wound on the entered layer (skin, garment, mask, hat) baked in their current posed / ragdolled
   * positions (damage/fleshPatch.ts) into a rigid chunk that inherits the actor's velocity there plus
   * the bullet's shove; the wound becomes a persistent missing area (WoundController.tear). A too
   * coarse layer gives a material-matched torn flap instead. Bounded per actor and per shot.
   */
  private tearChunk(z: DamageZombie, w: WoundController, r: WoundResult, dir: THREE.Vector3, shot: ShotInput, part: 'head' | 'torso' | 'limb'): void {
    const ph = this.physics;
    if (!ph?.world || w.tears >= MAX_TEARS_PER_ACTOR) return;
    if (this.patchShot.get(z) === this.shot) return; // one piece per actor per trigger pull
    if (shot.pellet ? r.strength < 0.38 : r.strength < 0.2) return;
    const layer = w.layers[r.layer];
    if (!layer) return;
    this.patchShot.set(z, this.shot);
    const R = this.rand;
    // patch radius ~3.5-4.5 cm for a rifle round, bigger for merged buckshot tears (the body / garment meshes have ~3 cm triangles)
    const partK = part === 'limb' ? 0.85 : part === 'head' ? 0.9 : 1;
    const radiusM = Math.max(0.025, Math.min(0.06, r.radius * 0.8 * partK * (0.9 + r.strength * 0.4)));
    const cls = layer.cls;
    const th = cls === 'flesh' ? 0.012 + 0.014 * r.strength : cls === 'cloth' ? 0.005 : cls === 'rubber' ? 0.007 : 0.006;
    z.root.updateMatrixWorld(true);
    // coarse layers: widen the cut until it holds a few real triangles (the chunk stays as small as the mesh allows)
    let patch: ReturnType<typeof extractPatch> = null, usedR = radiusM;
    for (const f of [1, 1.5, 2.1]) {
      usedR = Math.min(0.085, radiusM * f);
      this.prof?.begin(SPAN.extractPatch);
      patch = extractPatch(layer, r.restEntry, r.restDir, usedR * r.k, {thickness: th});
      this.prof?.end(SPAN.extractPatch);
      if (patch) break;
    }
    // velocity: the body there (ragdoll part / animated bone) + the bullet's throw
    const vel = new THREE.Vector3();
    if (!ph.actorVelocity(z, r.entry, vel)) z.boneVelocity?.(r.bone, vel);
    if (vel.length() > 6) vel.setLength(6);
    const n = patch?.normal ?? dir.clone().negate();
    vel.addScaledVector(dir, 1.3 + R() * 1.6).addScaledVector(n, 0.5 + R() * 0.9).add(tv.set((R() - 0.5) * 0.9, 0.7 + R() * 1.1, (R() - 0.5) * 0.9));
    const spin = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(cls === 'flesh' ? 18 : 26);
    const c = CHUNK_PHYS[cls];
    const mat = ph.chunks.chunkMaterial(layer.material);
    if (patch) {
      ph.chunks.spawnFlesh(patch.geometry, mat, patch.position, patch.quaternion, patch.half, {vel, spin, mat: c.mat, density: c.density});
      w.tear(r.index, Math.min(patch.restRadius, usedR * 1.3 * r.k), patch.restCenter);
      this.counts.patches++;
    } else {
      const size = radiusM * 1.4;
      const geo = fallbackFlap(size, th, tc.copy(r.color).lerp(new THREE.Color(DAMAGE_MATERIALS[cls].substrate), 0.25), (this.shot * 7919 + w.hits) | 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      const pos = r.entry.clone().addScaledVector(dir, -0.01);
      ph.chunks.spawnFlesh(geo, mat, pos, q, new THREE.Vector3(size / 2, Math.max(0.004, th / 2), size / 2), {vel, spin, mat: c.mat, density: c.density});
      w.tear(r.index, radiusM * 0.8 * r.k);
      this.counts.flaps++;
    }
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
  // Loose items, loot lots and light props hit by a shot (never destroyed, stay reachable)

  /**
   * Iteration 07 (Lane K): every loose pickup, visible loot lot (a can on a shelf / in an open cooler)
   * and loose light prop the bullet passes through before `maxT` (the first world / actor hit; a loot
   * holder hit first lets the shot reach the items INSIDE it, up to its far side) becomes a rigid body
   * and takes the bullet's impulse at the hit point. Bullets pass on through them (at most 2 per
   * bullet, 1 per pellet). Lots are lifted off their holder into pickups with the same item / count
   * first. Without a physics world: the iteration-06 near-miss knock.
   */
  knockPickups(o: Vec3, d: Vec3, maxT: number, wh?: WorldHit, shot?: ShotInput): number {
    const ph = this.physics;
    if (!ph?.world) return this.knockLegacy(o, d, maxT);
    const L = this.layout;
    let limit = maxT;
    if (wh && wh.kind === 'prop' && wh.prop !== undefined && L && Math.abs(wh.t - maxT) < 1e-4) {
      const p = L.props[wh.prop];
      // (lane MERCH: + a host's declared open shelves — knocked-loose stock lying back on them is hit through its box too)
      if (p && knownSupportKind(p.kind)) limit = Math.min(maxT + 2, rayExitT(o, d, p, maxT));
    }
    const dir = new THREE.Vector3(d.x, d.y, d.z).normalize();
    const pickups = (this.hooks.pickups?.() ?? []) as readonly PickupLike[];
    type Cand = {t: number; point: THREE.Vector3; pickup?: PickupLike; prop?: import('../gen/props').PropPlacement; propIndex?: number; lot?: ShotLot};
    const cands: Cand[] = ph.dynamicItems.rayHits(o, d, limit, pickups).map(h => ({t: h.t, point: h.point, pickup: h.pickup, prop: h.prop, propIndex: h.propIndex}));
    for (const lot of this.hooks.lots?.(o, d, limit) ?? []) cands.push({t: lot.t, point: new THREE.Vector3(o.x + d.x * lot.t, o.y + d.y * lot.t, o.z + d.z * lot.t), lot});
    cands.sort((a, b) => a.t - b.t);
    const damage = shot?.damage ?? 24, pellet = shot?.pellet ?? false;
    const J = damage * SHOT_IMPULSE_PER_DAMAGE;
    let n = 0;
    for (const c of cands) {
      if (n >= (pellet ? 1 : 2)) break;
      let surface: DamageClass = 'plastic';
      if (c.lot) {
        const pk = this.hooks.detachLot?.(c.lot.holder, c.lot.lotId) ?? null;
        if (!pk) continue;
        this.counts.lotsLifted++;
        ph.dynamicItems.shootPickup(pk, c.point, dir, J);
        surface = itemClass(pk.stack.itemId);
      } else if (c.pickup) {
        ph.dynamicItems.shootPickup(c.pickup, c.point, dir, J);
        surface = itemClass(c.pickup.stack.itemId);
      } else if (c.prop && c.propIndex !== undefined) {
        const r = this.props.hit({prop: c.prop, index: c.propIndex, point: c.point, dir, normal: dir.clone().negate(), damage, pellet});
        ph.dynamicItems.shootProp(c.prop, c.propIndex, r.point, dir, J);
        surface = r.cls;
        this.counts.propsShoved++;
      } else continue;
      n++;
      this.counts.itemsShot++;
      this.counts.knocked++;
      this.sfx?.impact(c.point.x, c.point.y, c.point.z, DAMAGE_MATERIALS[surface].sound);
    }
    return n;
  }

  /** Iteration-06 behaviour without a physics world: near-miss knock along the floor. */
  private knockLegacy(o: Vec3, d: Vec3, maxT: number): number {
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
    const g = L.grid, lv = q.levels.count > 1 ? q.levels : null;
    for (const k of this.knocks) {
      k.t += dt;
      const p = k.p;
      const nx = p.x + k.vx * dt, nz = p.z + k.vz * dt;
      // stay on reachable floor at about the same level, never through walls or off into a wall cell
      const [cx, cy] = g.cellOf(nx, nz);
      let ok: boolean;
      if (lv) {
        // iteration 08: on the pickup's own storey (never onto the deck above / through to the floor below)
        const s0 = lv.supportIn(p.x, p.z, p.y + 0.05, 0.3), s1 = lv.supportIn(nx, nz, p.y + 0.05, 0.3);
        ok = !!s0 && !!s1 && lv.grid(s1.level).passable(cx, cy) && Math.abs(s1.floor - s0.floor) < 0.3 && lv.lineOfSight({x: p.x, y: p.y + 0.1, z: p.z}, {x: nx, y: p.y + 0.1, z: nz}) && !q.blocked(nx, p.y + 0.06, nz, 0.06);
      } else ok = g.passable(cx, cy) && Math.abs(g.floorAt(nx, nz) - g.floorAt(p.x, p.z)) < 0.3 && g.lineOfSight(p.x, p.z, nx, nz) && !q.blocked(nx, p.y + 0.06, nz, 0.06);
      if (ok) { p.x = nx; p.z = nz; } else { k.vx *= -0.3; k.vz *= -0.3; }
      k.vy -= 9.81 * dt;
      p.y += k.vy * dt;
      const ground = q.surfaceBelow(p.x, p.z, p.y + 0.1);
      if (p.y <= ground) {
        p.y = ground === Infinity ? (lv ? lv.stepAt(p.x, p.z, p.y) || g.stepAt(p.x, p.z) : g.stepAt(p.x, p.z)) : ground;
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

/** Ray parameter where the ray leaves a prop's AABB (the far side), or `fallback`. */
function rayExitT(o: Vec3, d: Vec3, p: {x: number; y: number; z: number; hx: number; hz: number; h: number}, fallback: number): number {
  let tmax = Infinity;
  const lo = [p.x - p.hx, p.y, p.z - p.hz], hi = [p.x + p.hx, p.y + p.h, p.z + p.hz], O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-12) continue;
    const t1 = (lo[a] - O[a]) / D[a], t2 = (hi[a] - O[a]) / D[a];
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return Number.isFinite(tmax) ? Math.max(fallback, tmax) : fallback;
}

/** Corpse hit volumes from the (ragdolled / death-clip) bones. */
const DEFAULT_RADII = {head: 0.135, torso: 0.2, arm: 0.075, leg: 0.1};
export function corpseVolumes(z: DamageZombie): {part: 'head' | 'torso' | 'limb'; a: Vec3; b: Vec3 | null; r: number}[] {
  const own = z.corpseVolumes?.();
  if (own) return own;
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
