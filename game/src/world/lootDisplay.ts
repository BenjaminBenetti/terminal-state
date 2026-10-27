// Visible loot rendering: every item resting in a cabinet/crate/shelf/kiosk/vending spill is an
// instance of its item model (world/pickups.ts itemTemplate). Draw calls are bounded by the number
// of item TYPES (one InstancedMesh per template mesh), not by the number of items: each refresh
// writes only the nearby, currently visible lots (open containers, shelves within view distance),
// so a much larger station costs the same per frame. The aimed lot is drawn separately with a
// pulsing highlight copy.

import * as THREE from 'three';
import {itemTemplate} from './pickups';

export interface LotInstance { id: number; itemId: string; matrix: THREE.Matrix4 }

interface Batch { parts: {im: THREE.InstancedMesh; local: THREE.Matrix4}[]; cap: number }
interface Highlight { obj: THREE.Object3D; mats: THREE.MeshStandardMaterial[] }

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

  /** (Re)allocates instance capacity for this station: lot count per item id. */
  allocate(counts: Map<string, number>): void {
    this.clear();
    for (const [itemId, cap] of counts) {
      if (cap <= 0) continue;
      const tpl = itemTemplate(itemId);
      tpl.updateMatrixWorld(true);
      const parts: Batch['parts'] = [];
      tpl.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = Array.isArray(mesh.material) ? mesh.material.map(m => this.batchMat(m)) : this.batchMat(mesh.material);
        const im = new THREE.InstancedMesh(mesh.geometry, mat, cap);
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false; // instances move in/out each refresh; the set is already distance-bounded
        im.name = `loot-${itemId}`;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        parts.push({im, local: mesh.matrixWorld.clone()});
      });
      this.batches.set(itemId, {parts, cap});
    }
  }

  /** Draws exactly `list` (the aimed lot, if any, as the highlight copy instead). */
  show(list: readonly LotInstance[], highlightId: number | null): void {
    const fill = new Map<string, number>();
    const m = new THREE.Matrix4();
    let hlLot: LotInstance | null = null;
    for (const l of list) {
      if (l.id === highlightId) { hlLot = l; continue; }
      const b = this.batches.get(l.itemId);
      if (!b) continue;
      const i = fill.get(l.itemId) ?? 0;
      if (i >= b.cap) continue;
      for (const p of b.parts) p.im.setMatrixAt(i, m.multiplyMatrices(l.matrix, p.local));
      fill.set(l.itemId, i + 1);
    }
    this.visible = 0;
    for (const [itemId, b] of this.batches) {
      const n = fill.get(itemId) ?? 0;
      this.visible += n;
      for (const p of b.parts) {
        if (p.im.count === 0 && n === 0) continue;
        p.im.count = n;
        p.im.visible = n > 0;
        p.im.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.hl) { this.hl.obj.visible = false; this.hl = null; }
    if (hlLot) {
      this.hl = this.highlight(hlLot.itemId);
      this.hl.obj.matrix.copy(hlLot.matrix);
      this.hl.obj.matrixWorldNeedsUpdate = true;
      this.hl.obj.visible = true;
      this.visible++;
    }
  }

  private highlight(itemId: string): Highlight {
    let h = this.highlights.get(itemId);
    if (!h) {
      const obj = itemTemplate(itemId).clone(true);
      const mats: THREE.MeshStandardMaterial[] = [];
      obj.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
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
      this.group.add(obj);
      h = {obj, mats};
      this.highlights.set(itemId, h);
    }
    return h;
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
    if (this.hl) this.hl.obj.visible = false;
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
