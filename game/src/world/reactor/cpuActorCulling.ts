// Task studio-reactor-submit-roof-fog-20261102 (lane CPU, user: "Performance is very poor. Again it is a CPU time issue ... CPU spending
// around 20ms in 'submit'"): the Reactor's MOVING render objects through the level culler's exact rules.
//
// The static world, holders and dressing are culler-registered (world/levelCulling.ts: slab + storey occlusion on the Reactor). The
// enemies (each 3-5 skinned meshes, drawn in the scene AND the flashlight's shadow pass) and the floor pickups never were: three's
// frustum test alone submitted every one in the view cone — looking down the pit from the rim, the infected in the side complexes,
// the tier rooms and behind the rock (lane CPU's census, seed 000070S: 32 enemies in the cone, 13 of them behind rock; 29 pickups,
// 20 behind rock). This runtime keeps the culler's TRACKED set (LevelCuller.track) in step with the live enemies and pickups, once
// per frame; the culler decides each one on every update from its box, exactly like a registered mesh:
//  - an enemy's box = the union of its meshes' cull spheres (the bounds three's own frustum test uses — every actor sets one that
//    covers every clip pose: standing, lunging, lying down), in root space, placed at the root's CURRENT world transform;
//  - a pickup's box = its model's box (a sphere round it in its own frame), at its current transform (a pickup shot loose moves);
//  - a ragdolled enemy (physics owns its bones; the root no longer follows) is released: drawn as before (frustum only).
// Hidden = moved to the cull layer (never `visible`); the AI, physics, hit volumes, audio and every gameplay system are untouched.
// Inert on every other level (nothing is tracked: the mall's culler supports it but nothing registers there).

import * as THREE from 'three';

interface TrackingCuller { track(obj: THREE.Object3D, box: (out: THREE.Box3) => boolean): boolean; untrack(obj: THREE.Object3D): void }

export interface ReactorCpuCullingHost {
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  layout?: {reactor?: unknown} | null;
  world?: {culler?: unknown} | null;
  zombies: readonly {root: THREE.Object3D; ragdolled: boolean}[];
  pickups?: {list: readonly {obj: THREE.Object3D}[]} | null;
}

/** A tracked object's cull sphere in its own (root / pickup object) space. */
interface Local { c: THREE.Vector3; r: number }

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _s = new THREE.Sphere(), _v = new THREE.Vector3(), _b = new THREE.Box3();

/**
 * The union of `root`'s mesh cull spheres in root space: a skinned mesh's own `boundingSphere` (every actor sets one covering all its
 * clip poses; three's frustum test uses it), a plain mesh's geometry sphere. null (never tracked: drawn as before) when a skinned
 * mesh has no such sphere — its bind-pose geometry would not bound its animation.
 */
export function actorLocalSphere(root: THREE.Object3D): Local | null {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  let acc: THREE.Sphere | null = null, ok = true;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !ok) return;
    let s = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh).boundingSphere : null;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh && !s) { ok = false; return; }
    if (!s) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); s = m.geometry.boundingSphere; }
    if (!s) return;
    _s.copy(s).applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld));
    if (acc) acc.union(_s); else acc = _s.clone();
  });
  const sph = acc as THREE.Sphere | null;
  return ok && sph && sph.radius > 0 ? {c: sph.center.clone(), r: sph.radius} : null;
}

/** A pickup's model box as a sphere in the pickup object's own space. */
export function pickupLocalSphere(obj: THREE.Object3D): Local | null {
  obj.updateMatrixWorld(true);
  _b.setFromObject(obj);
  if (_b.isEmpty()) return null;
  _inv.copy(obj.matrixWorld).invert();
  const c = _b.getCenter(new THREE.Vector3()).applyMatrix4(_inv);
  const scale = obj.matrixWorld.getMaxScaleOnAxis() || 1;
  return {c, r: _b.getSize(_v).length() / 2 / scale};
}

/** The world box of a local sphere at `obj`'s CURRENT transform (its world matrix refreshed now: the render updates it later). */
function sphereBox(obj: THREE.Object3D, l: Local, out: THREE.Box3): boolean {
  obj.updateWorldMatrix(true, false);
  const r = l.r * obj.matrixWorld.getMaxScaleOnAxis();
  _v.copy(l.c).applyMatrix4(obj.matrixWorld);
  out.min.set(_v.x - r, _v.y - r, _v.z - r);
  out.max.set(_v.x + r, _v.y + r, _v.z + r);
  return true;
}

export class ReactorCpuCulling {
  private culler: TrackingCuller | null = null;
  private readonly actors = new Map<THREE.Object3D, Local | null>();
  private readonly items = new Map<THREE.Object3D, Local | null>();
  /** Ragdolled enemies released this world (never tracked again). */
  private readonly released = new WeakSet<THREE.Object3D>();
  private readonly live = new Set<THREE.Object3D>();
  stats = {actors: 0, pickups: 0, released: 0};

  constructor(private readonly host: ReactorCpuCullingHost) {
    host.frameHooks.push(() => this.sync());
    host.sectionHooks.push({teardown: () => this.clear()});
  }

  /** Brings the tracked set in line with the live enemies / pickups (Reactor only; otherwise releases everything it holds). */
  sync(): void {
    const h = this.host, c = h.world?.culler as Partial<TrackingCuller> | undefined;
    if (!h.layout?.reactor || !c || typeof c.track !== 'function' || typeof c.untrack !== 'function') { this.clear(); return; }
    if (c !== this.culler) { this.clear(); this.culler = c as TrackingCuller; }
    const culler = this.culler!;
    const live = this.live;
    live.clear();
    for (const z of h.zombies) {
      const root = z.root;
      if (z.ragdolled) {
        if (this.actors.has(root)) { culler.untrack(root); this.actors.delete(root); this.stats.released++; }
        this.released.add(root);
        continue;
      }
      if (this.released.has(root)) continue;
      live.add(root);
      if (this.actors.has(root)) continue;
      const l = actorLocalSphere(root);
      this.actors.set(root, l);
      if (l) culler.track(root, out => sphereBox(root, l, out));
    }
    for (const root of this.actors.keys()) if (!live.has(root)) { culler.untrack(root); this.actors.delete(root); }
    live.clear();
    for (const p of h.pickups?.list ?? []) {
      const obj = p.obj;
      live.add(obj);
      if (this.items.has(obj)) continue;
      const l = pickupLocalSphere(obj);
      this.items.set(obj, l);
      if (l) culler.track(obj, out => sphereBox(obj, l, out));
    }
    for (const obj of this.items.keys()) if (!live.has(obj)) { culler.untrack(obj); this.items.delete(obj); }
    this.stats.actors = this.actors.size;
    this.stats.pickups = this.items.size;
  }

  /** Everything shown and forgotten (teardown, another level, a new world). */
  clear(): void {
    if (this.culler) for (const o of [...this.actors.keys(), ...this.items.keys()]) this.culler.untrack(o);
    this.actors.clear();
    this.items.clear();
    this.culler = null;
  }
}

let installed: ReactorCpuCulling | null = null;

/** Installs the runtime (once at startup; inert outside the Reactor). */
export function installReactorCpuCulling(host: ReactorCpuCullingHost): ReactorCpuCulling {
  return (installed = new ReactorCpuCulling(host));
}

interface CullerStats {
  stats: {culled: number; registered: number}; slabCulled: number; occlusionCulled: number; trackedCulled: number; trackedCount: number;
  slabs: boolean; occlusion: boolean; update(camera: THREE.Camera, force?: boolean): void;
}

/**
 * QA hooks (qa.ts `__LL`): `reactorCpu()` — the level culler's last decision (meshes culled, by the slab / storey occlusion, tracked
 * enemies / pickups hidden) and what this runtime tracks; `reactorCpu({rules: false})` = DEBUG A/B: the Reactor culler's slab / storey
 * occlusion off (the atrium rule alone, as before lane CPU; tracked objects then only fog-culled, i.e. shown), `{rules: true}` back on. null off the Reactor.
 */
export function reactorCpuQaApi(game: {world?: {culler?: unknown} | null; layout?: {reactor?: unknown} | null; camera?: THREE.Camera}) {
  return {
    reactorCpu: (o: {rules?: boolean} = {}) => {
      const c = game.world?.culler as CullerStats | undefined;
      if (!installed || !game.layout?.reactor || !c) return null;
      if (o.rules !== undefined) {
        c.slabs = c.occlusion = o.rules;
        if (game.camera) c.update(game.camera, true);
      }
      return {rules: c.slabs && c.occlusion, culled: c.stats.culled, registered: c.stats.registered, slabCulled: c.slabCulled, occlusionCulled: c.occlusionCulled,
        trackedHidden: c.trackedCulled, tracked: c.trackedCount, ...installed.stats};
    },
  };
}
