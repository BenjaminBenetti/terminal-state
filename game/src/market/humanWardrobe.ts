// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): assembles market humans from market-human-cast.glb (layout:
// tools/asset-pipeline/humans/lib/glb.mjs). Per body: 'Human_<b>' holds the prefixed 18-joint skeleton ('<b>_Hips' ...), the
// skinned body 'HumanBody_<b>' and every fitted wearable 'Wear_<w>__<b>' on the SAME skin; clips '<b>:<Clip>'.
// An actor = a clone of the body's skeleton + body mesh, plus one SkinnedMesh per worn wearable (shared geometry / material, bound
// to the clone's skeleton) — the zombie WardrobeLibrary's method (ai/wardrobe.ts), with its hidden-triangle masks: body triangles
// under the worn set and lower-garment triangles under a worn upper are dropped from a per-combination index buffer (cached and
// shared by every actor wearing that combination). Materials are SHARED (nothing ever edits a human's material at runtime).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {HUMAN_CLIPS, HUMAN_SLOTS, type HumanAvailability, type HumanClip, type HumanLook, type HumanSlot} from './humanLooks';

interface BodyExtras { body: string; label?: string; heightM: number; geometryHash: string; clips?: Record<string, {duration: number; loop: boolean; groundSpeed?: number}> }
interface VariantExtras { wearable: string; slot: HumanSlot; body: string; bodyGeometryHash: string; hideBodyTriangles?: string; hideWear?: Record<string, string>; incompatibleWear?: string[] }
interface CastExtras { bodies: {id: string; wear: string[]}[]; wearables: {id: string; slot: HumanSlot}[]; clips: string[] }

export interface HumanAppearance {
  look: HumanLook;
  /** Cloned skeleton + skinned meshes (body first), at the origin, facing +Z, feet at y = 0 (actor scale NOT applied). */
  root: THREE.Object3D;
  /** The body + every worn wearable. */
  meshes: THREE.SkinnedMesh[];
  /** The body's healthy clips by name (shared AnimationClip objects of the loaded file). */
  clips: Map<HumanClip, THREE.AnimationClip>;
  /** Walk ground speed at timeScale 1 and actor scale 1 (m/s). */
  walkSpeed: number;
  heightM: number;
  /** Joint name prefix ('<body>_'). */
  prefix: string;
}

interface BodyEntry {
  id: string;
  template: THREE.Object3D;
  extras: BodyExtras;
  variants: Map<string, THREE.SkinnedMesh>;
  clips: Map<HumanClip, THREE.AnimationClip>;
}

function decodeBits(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class HumanWardrobe {
  readonly bodies: string[] = [];
  private readonly entries = new Map<string, BodyEntry>();
  private readonly slots = new Map<string, HumanSlot>();
  private readonly masked = new Map<string, THREE.BufferGeometry>();

  constructor(readonly gltf: GLTF) {
    const cast = gltf.scene.userData?.marketHumans as CastExtras | undefined;
    if (!cast) throw new Error('market-human-cast: no marketHumans scene extras');
    for (const w of cast.wearables) this.slots.set(w.id, w.slot);
    for (const b of cast.bodies) {
      const holder = gltf.scene.getObjectByName('Human_' + b.id);
      const body = gltf.scene.getObjectByName('HumanBody_' + b.id) as THREE.SkinnedMesh | undefined;
      if (!holder || !body?.isSkinnedMesh) continue;
      const extras = body.userData as BodyExtras;
      const variants = new Map<string, THREE.SkinnedMesh>();
      for (const w of b.wear) {
        const m = holder.getObjectByName(`Wear_${w}__${b.id}`) as THREE.SkinnedMesh | undefined;
        const ex = m?.userData as VariantExtras | undefined;
        // the masks index this exact body build: refuse a stale pairing
        if (m?.isSkinnedMesh && ex && ex.bodyGeometryHash === extras.geometryHash) variants.set(w, m);
      }
      // the actor template: skeleton + body only (the loaded file itself is never modified)
      const template = SkeletonUtils.clone(holder);
      for (const o of [...template.children]) if (o.name.startsWith('Wear_')) template.remove(o);
      const clips = new Map<HumanClip, THREE.AnimationClip>();
      for (const c of gltf.animations) {
        const [bid, name] = c.name.split(':');
        if (bid === b.id && (HUMAN_CLIPS as readonly string[]).includes(name)) clips.set(name as HumanClip, c);
      }
      this.entries.set(b.id, {id: b.id, template, extras, variants, clips});
      this.bodies.push(b.id);
    }
  }

  /** Selection data (market/humanLooks.ts). */
  get available(): HumanAvailability {
    return {
      bodies: this.bodies,
      wear: body => [...(this.entries.get(body)?.variants.keys() ?? [])].map(id => ({id, slot: this.slots.get(id)!})),
      compatible: (body, a, b) => this.compatible(body, a, b),
    };
  }

  compatible(body: string, a: string, b: string): boolean {
    const e = this.entries.get(body);
    const ea = e?.variants.get(a)?.userData as VariantExtras | undefined, eb = e?.variants.get(b)?.userData as VariantExtras | undefined;
    return !ea?.incompatibleWear?.includes(b) && !eb?.incompatibleWear?.includes(a);
  }

  clipsOf(body: string): ReadonlyMap<HumanClip, THREE.AnimationClip> {
    return this.entries.get(body)?.clips ?? new Map();
  }

  private maskedGeometry(key: string, src: THREE.BufferGeometry, bitsets: string[]): THREE.BufferGeometry {
    if (!bitsets.length) return src;
    let g = this.masked.get(key);
    if (g) return g;
    g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    const index = src.index!;
    const hide = bitsets.map(decodeBits);
    const keep: number[] = [];
    for (let t = 0; t < index.count / 3; t++) {
      if (hide.some(h => h[t >> 3] & (1 << (t & 7)))) continue;
      keep.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
    }
    g.setIndex(keep);
    g.boundingBox = src.boundingBox;
    g.boundingSphere = src.boundingSphere;
    this.masked.set(key, g);
    return g;
  }

  /** Builds an actor's appearance; unknown / unfitted / incompatible wearables are skipped (never a wrong mesh). */
  build(look: HumanLook): HumanAppearance {
    const e = this.entries.get(look.body) ?? this.entries.get(this.bodies[0]);
    if (!e) throw new Error('market-human-cast: no body loaded');
    const root = SkeletonUtils.clone(e.template);
    root.name = 'human-' + e.id;
    root.visible = true;
    const body = root.getObjectByName('HumanBody_' + e.id) as THREE.SkinnedMesh;
    const worn: {slot: HumanSlot; id: string; src: THREE.SkinnedMesh; ex: VariantExtras}[] = [];
    for (const slot of HUMAN_SLOTS) {
      const id = look.wear[slot];
      const src = id ? e.variants.get(id) : undefined;
      if (!id || !src || this.slots.get(id) !== slot || !worn.every(o => this.compatible(e.id, o.id, id))) continue;
      worn.push({slot, id, src, ex: src.userData as VariantExtras});
    }
    const meshes: THREE.SkinnedMesh[] = [body];
    // inner -> outer: lower, upper, head
    for (const o of [...worn].sort((a, b) => ['lower', 'upper', 'head'].indexOf(a.slot) - ['lower', 'upper', 'head'].indexOf(b.slot))) {
      const over = worn.filter(x => x !== o && x.ex.hideWear?.[o.id]);
      const geom = this.maskedGeometry(`wear:${o.id}@${e.id}|${over.map(x => x.id).sort().join(',')}`, o.src.geometry, over.map(x => x.ex.hideWear![o.id]));
      const mesh = new THREE.SkinnedMesh(geom, o.src.material);
      mesh.name = `HumanWear_${o.slot}`;
      mesh.userData = {slot: o.slot, wearable: o.id};
      body.parent!.add(mesh);
      mesh.bind(body.skeleton, body.bindMatrix);
      meshes.push(mesh);
    }
    const bodyBits = worn.map(o => o.ex.hideBodyTriangles).filter((s): s is string => !!s);
    body.geometry = this.maskedGeometry(`body:${e.id}|${worn.map(o => o.id).sort().join(',')}`, body.geometry, bodyBits);
    const wear: Partial<Record<HumanSlot, string>> = {};
    for (const o of worn) wear[o.slot] = o.id;
    return {look: {body: e.id, wear, scale: look.scale}, root, meshes, clips: e.clips, walkSpeed: e.extras.clips?.Walk?.groundSpeed ?? 1.25, heightM: e.extras.heightM, prefix: e.id + '_'};
  }

  /** Masked index buffers made for actor combinations (released with the level). */
  dispose(): void {
    for (const g of this.masked.values()) g.dispose();
    this.masked.clear();
  }
}
