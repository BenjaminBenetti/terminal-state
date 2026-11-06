// Visible loot rendering: every item resting in a cabinet/crate/shelf/kiosk/vending spill is an
// instance of its item model (world/pickups.ts itemTemplate). Draw calls are bounded by the number
// of item TYPES (one InstancedMesh per template mesh), not by the number of items: each refresh
// writes only the nearby, currently visible lots (open containers, shelves within view distance),
// so a much larger station costs the same per frame. The aimed lot is drawn separately with a
// pulsing highlight copy.
//
// Task office-overhaul-20261030 (lane INTERACT, user feedback #12: "mousing over some small items like water bottles causes
// them to go invisible"). ROOT CAUSE: the aimed lot leaves its instanced batch and only the highlight copy draws it. The
// per-item highlight copies were cached across stations INSIDE this group, and game.ts registers the containers group (this
// group's parent) with every new station's level culler (world/levelCulling.ts). A copy that already existed from an earlier
// station / level / Retry was therefore registered with the box of the lot it last highlighted (stale, possibly another level
// or 60 m away) and moved to the cull layer whenever that stale box was culled — and a copy culled when its culler was
// abandoned kept the cull-layer mask, which the next culler then recorded as its "visible" mask, so it never drew again.
// Hovering that item kind made the lot vanish until the crosshair left it. Only kinds hovered in an earlier build were hit
// (hence "some small items": water bottles are the most hovered). FIX (general, every item kind): the highlight copies are
// taken out of the group whenever the station's instances are dropped (clear(): before every build's culler registration),
// re-attached lazily after it, and every time a copy is shown its meshes are put back on the layers the batches draw on — a
// highlight copy is never culled, never on a stale box, never invisible; selection feedback never hides an item.

import * as THREE from 'three';
import {itemTemplate} from './pickups';

export interface LotInstance { id: number; itemId: string; matrix: THREE.Matrix4 }

interface Batch { parts: {im: THREE.InstancedMesh; local: THREE.Matrix4}[]; cap: number }

/**
 * Task mall-round2-20261031 (lane PERF, user M05 "~1,500 draw calls"): in the mall the batches were the last always-drawn meshes — one
 * per item type, frustumCulled off and never culler-registered, so every type with a lot within LOT_VIEW_DIST (any storey: XZ distance)
 * drew in the scene AND the torch shadow pass looking anywhere. Now (storeyOf set): one batch per (item, storey) — its instances'
 * bounds recomputed on every show, frustum-culled, tagged with its storey and `dynamicBounds` so the level culler's storey / slab /
 * occlusion rules decide it (world/levelCulling.ts) — plus one all-storey batch per item for a lot that left its storey (a holder
 * knocked off a gallery: its loot never loses its instance). Capacity per batch = the item's total lots (no overflow anywhere).
 * Subway / Office: unchanged (storeyOf null).
 */
interface Highlight { obj: THREE.Object3D; mats: THREE.MeshStandardMaterial[]; meshes: THREE.Mesh[] }

/** Layers a fresh object renders on (the camera layers; never the level culler's cull layer). */
const DRAW_MASK = new THREE.Layers().mask;

/** Faint warm self-glow so items read as silhouettes in dim rooms (pickups use the same idea). */
const BASE_GLOW = new THREE.Color(0.03, 0.027, 0.021);

export class LotDisplay {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly mats = new Map<THREE.Material, THREE.Material>();
  private readonly highlights = new Map<string, Highlight>();
  private hl: Highlight | null = null;
  /** Lots drawn by the last refresh (QA). */
  visible = 0;
  /** Task mall-round2 (lane PERF): the storey of a lot height (the mall; null elsewhere: one batch per item type, unbounded). */
  storeyOf: ((y: number) => number) | null = null;

  constructor() {
    this.group.name = 'loot-items';
  }

  private batchMat(src: THREE.Material): THREE.Material {
    let m = this.mats.get(src);
    if (!m) {
      m = src.clone();
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        std.emissive.copy(BASE_GLOW);
        if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
      }
      this.mats.set(src, m);
    }
    return m;
  }

  /**
   * (Re)allocates instance capacity for this station: lot count per item id. `storeys` (the mall, with storeyOf): the storeys each
   * item initially lies on and every storey id -> one batch per (item, storey) + one all-storey batch (see the note above).
   */
  allocate(counts: Map<string, number>, storeys?: {perStorey: Map<string, Set<number>>; all: readonly number[]}): void {
    this.clear();
    for (const [itemId, cap] of counts) {
      if (cap <= 0) continue;
      const tpl = itemTemplate(itemId);
      tpl.updateMatrixWorld(true);
      const make = (key: string, tag: {level?: number; levels?: number[]} | null) => {
        const parts: Batch['parts'] = [];
        tpl.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = Array.isArray(mesh.material) ? mesh.material.map(m => this.batchMat(m)) : this.batchMat(mesh.material);
          const im = new THREE.InstancedMesh(mesh.geometry, mat, cap);
          im.count = 0;
          im.visible = false;
          im.name = `loot-${itemId}`;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (tag) {
            // bounds follow the instances (show); the level culler decides it per storey (dynamic bounds: may start empty)
            im.computeBoundingBox();
            im.computeBoundingSphere();
            if (tag.level !== undefined) im.userData.level = tag.level; else im.userData.levels = tag.levels;
            im.userData.dynamicBounds = true;
          } else im.frustumCulled = false; // instances move in/out each refresh; the set is already distance-bounded
          this.group.add(im);
          parts.push({im, local: mesh.matrixWorld.clone()});
        });
        this.batches.set(key, {parts, cap});
      };
      if (!storeys || !this.storeyOf) { make(itemId, null); continue; }
      for (const s of storeys.perStorey.get(itemId) ?? []) make(`${itemId}|${s}`, {level: s});
      make(`${itemId}|*`, {levels: [...storeys.all]});
    }
  }

  /** The batch of a lot (the mall: its storey's, else the item's all-storey batch). */
  private batchKey(l: LotInstance): string {
    if (!this.storeyOf) return l.itemId;
    const k = `${l.itemId}|${this.storeyOf(l.matrix.elements[13])}`;
    return this.batches.has(k) ? k : `${l.itemId}|*`;
  }

  /** Draws exactly `list` (the aimed lot, if any, as the highlight copy instead). */
  show(list: readonly LotInstance[], highlightId: number | null): void {
    const fill = new Map<string, number>();
    const m = new THREE.Matrix4();
    let hlLot: LotInstance | null = null;
    for (const l of list) {
      if (l.id === highlightId) { hlLot = l; continue; }
      const key = this.batchKey(l);
      const b = this.batches.get(key);
      if (!b) continue;
      const i = fill.get(key) ?? 0;
      if (i >= b.cap) continue;
      for (const p of b.parts) p.im.setMatrixAt(i, m.multiplyMatrices(l.matrix, p.local));
      fill.set(key, i + 1);
    }
    this.visible = 0;
    for (const [key, b] of this.batches) {
      const n = fill.get(key) ?? 0;
      this.visible += n;
      for (const p of b.parts) {
        if (p.im.count === 0 && n === 0) continue;
        p.im.count = n;
        p.im.visible = n > 0;
        p.im.instanceMatrix.needsUpdate = true;
        if (this.storeyOf) { p.im.computeBoundingBox(); p.im.computeBoundingSphere(); } // task mall-round2 (lane PERF): bounded batches
      }
    }
    if (this.hl) { this.hl.obj.visible = false; this.hl = null; }
    if (hlLot) {
      this.hl = this.highlight(hlLot.itemId);
      this.hl.obj.matrix.copy(hlLot.matrix);
      this.hl.obj.matrixWorldNeedsUpdate = true;
      this.hl.obj.visible = true;
      // Task office-overhaul-20261030 (INTERACT, #12): the copy stands in for the batch instance — always on the drawn layers
      for (const m of this.hl.meshes) if (m.layers.mask !== DRAW_MASK) m.layers.mask = DRAW_MASK;
      if (this.hl.obj.layers.mask !== DRAW_MASK) this.hl.obj.layers.mask = DRAW_MASK;
      this.visible++;
    }
  }

  private highlight(itemId: string): Highlight {
    let h = this.highlights.get(itemId);
    if (!h) {
      const obj = itemTemplate(itemId).clone(true);
      const mats: THREE.MeshStandardMaterial[] = [];
      const meshes: THREE.Mesh[] = [];
      obj.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        meshes.push(mesh);
        const clone = (src: THREE.Material) => {
          const c = src.clone() as THREE.MeshStandardMaterial;
          if (c.isMeshStandardMaterial) { if (c.map && !c.emissiveMap) c.emissiveMap = c.map; mats.push(c); }
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      });
      obj.matrixAutoUpdate = false;
      obj.visible = false;
      obj.name = `loot-highlight-${itemId}`;
      h = {obj, mats, meshes};
      this.highlights.set(itemId, h);
    }
    // Task office-overhaul-20261030 (INTERACT, #12): (re)attached lazily — after this station's culler registration
    if (h.obj.parent !== this.group) this.group.add(h.obj);
    return h;
  }

  /**
   * Task runtime-variant-warmup-20261105: make the highlight copy of every item type allocated this station now (the same cached
   * copies the first aim at a lot shows), hidden in the group — under the containers group, a registered warm-up pool, so the warm-up
   * and the journey compile prepare them (a copy is non-instanced and owns material clones: a first aim built its variants). Done at
   * warm-up time, i.e. after this station's culler registration (#12 above). Render cache only: no lot, aim or batch state. Returns
   * the item types prepared.
   */
  prepareHighlights(): number {
    const ids = new Set<string>();
    for (const key of this.batches.keys()) ids.add(key.split('|')[0]);
    for (const id of ids) this.highlight(id).obj.userData.runtimeVariant = true; // (render/runtimeVariants.ts RUNTIME_VARIANT: journey order)
    return ids.size;
  }

  /** Task office-overhaul-20261030 (INTERACT, #12): a cached highlight copy leaves the group (and any cull layer) until next used. */
  private detachHighlight(h: Highlight): void {
    h.obj.visible = false;
    h.obj.parent?.remove(h.obj);
    h.obj.layers.mask = DRAW_MASK;
    for (const m of h.meshes) m.layers.mask = DRAW_MASK;
  }

  /** QA / tests: the highlight copy currently shown (null when no lot is aimed at). */
  get highlightObject(): THREE.Object3D | null {
    return this.hl?.obj ?? null;
  }

  pulse(time: number): void {
    if (!this.hl) return;
    const k = 0.16 + 0.1 * Math.sin(time * 6);
    for (const m of this.hl.mats) m.emissive.setRGB(k, k * 0.85, k * 0.5);
  }

  /** Drops this station's instance buffers (templates/materials are kept for reuse). */
  clear(): void {
    for (const b of this.batches.values()) for (const p of b.parts) { this.group.remove(p.im); p.im.dispose(); }
    this.batches.clear();
    // Task office-overhaul-20261030 (INTERACT, #12): cached copies (and their materials / pipelines) are kept, but never stay in
    // the group across a build, so the next station's culler can never register them with a stale box / cull mask.
    for (const h of this.highlights.values()) this.detachHighlight(h);
    this.hl = null;
    this.visible = 0;
  }

  dispose(): void {
    this.clear();
    for (const h of this.highlights.values()) { this.group.remove(h.obj); for (const m of h.mats) m.dispose(); }
    this.highlights.clear();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }

  /** Draw calls this display can issue at most (one per template mesh/material group). */
  drawBudget(): number {
    let n = 0;
    for (const b of this.batches.values()) for (const p of b.parts) n += Array.isArray(p.im.material) ? p.im.material.length : 1;
    return n + 1;
  }
}
