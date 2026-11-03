// Zombie wardrobe (iteration 06): slot-based, data-driven and level-generic.
//
// A look = one base body + at most one wearable per SLOT (upper garment, lower garment/pants, head
// item, face item). Every wearable is fitted OFFLINE to every body it supports by
// tools/asset-pipeline/zombie (build-wardrobe.mjs) and shipped as
//   outfit-<id>.glb - one SkinnedMesh "Outfit_<id>__<body>" per supported body (shared texture/UVs),
//                     node extras: hideBodyTriangles (body faces covered by it), bulkM, and
//                     hideWear {<otherWearable>: triangles of THAT wearable hidden when both are
//                     worn - e.g. the pants waistband under a jacket hem}.
// A missing node means the build EXCLUDED that body x wearable pair (did not fit cleanly). Bodies
// declare slots their own geometry already fills (`covers`: e.g. a hood + built-in gas mask) and
// slots that must never be empty (`requires`: underwear bases always get pants). Wearables declare
// `incompatibleWith` rules (ids or 'tag:<t>' of other wearables or of the body).
// This module holds the logic only; the default registry data lives in outfits.ts.
// All derivatives are unapproved prototypes (gameReady false).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {hashString, mulberry32} from '../core/rng';
import type {ZombieType} from '../gen/stationTypes';

export type WardrobeSlot = 'upper' | 'lower' | 'head' | 'face';
/** Layering order (inner -> outer): render/hide order; a later slot may hide parts of an earlier one. */
export const SLOTS: readonly WardrobeSlot[] = ['lower', 'upper', 'face', 'head'];
/** Selection order (most visible garment first). */
export const PICK_ORDER: readonly WardrobeSlot[] = ['upper', 'lower', 'head', 'face'];
const SLOT_SET = new Set<string>(SLOTS);
export const isWardrobeSlot = (s: unknown): s is WardrobeSlot => typeof s === 'string' && SLOT_SET.has(s);

export interface ZombieBodyDef {
  id: string;
  label: string;
  /** Asset manifest model key of zombie-body-<id>.glb. */
  model: string;
  /** Default selection weight (a level pool may override). */
  weight: number;
  /** 'generated' = source made for this game; 'reused' = existing master reused; 'uploaded' = a body model the user supplied. */
  origin: 'generated' | 'reused' | 'uploaded';
  /** Slots the body's own geometry already fills (no wearable is ever placed there). */
  covers?: readonly WardrobeSlot[];
  /** Slots that must always hold a wearable (e.g. underwear bases always wear a lower garment). */
  requires?: readonly WardrobeSlot[];
  /**
   * Task mall-lingerie-20261102: the body mesh is UNCLOTHED. Selection already never leaves a `requires` slot empty; build()
   * additionally completes any required slot a look leaves empty (or names an unfitted / incompatible wearable in) with the
   * first fitted, compatible wearable of that slot (registry order), so the body is never assembled bare.
   */
  nude?: boolean;
  /** Descriptive tags wearables can refer to in `incompatibleWith` ('tag:<t>'). */
  tags?: readonly string[];
}

export interface WearableDef {
  id: string;
  slot: WardrobeSlot;
  label: string;
  /** Asset manifest model key of outfit-<id>.glb. */
  model: string;
  weight: number;
  /** Long/heavy upper garment: worn by the tougher 'coated' archetype (padded hit volumes / ragdoll). */
  heavy?: boolean;
  tags?: readonly string[];
  /** Wearable ids, or 'tag:<t>' matching another worn wearable's tags or the body's tags. */
  incompatibleWith?: readonly string[];
  /** 'generated' = new source; 'reused' = existing master reused; 'derived' = cut/derived from an existing master. */
  origin: 'generated' | 'reused' | 'derived';
}

/** Backward-compatible name (iteration 05 "outfits" = upper-slot wearables). */
export type ZombieOutfitDef = WearableDef;

export interface ZombieLook {
  body: string;
  wear: Partial<Record<WardrobeSlot, string>>;
}
/** Iteration-05 look shape (body + optional upper outfit); accepted by build()/isValid(). */
export interface LegacyZombieLook { body: string; outfit: string | null }

/** Per-level selection pool; omitted entries use the registry default weights. */
export interface ZombiePool {
  bodies?: Record<string, number>;
  wearables?: Record<string, number>;
  /** Weight of "nothing in this slot", relative to a wearable of weight 1 (defaults: DEFAULT_NONE_WEIGHTS). */
  none?: Partial<Record<WardrobeSlot, number>>;
}

/** Most zombies wear an upper garment; pants are common; hats ~1 in 3; face items (gas mask / respirator) ~1 in 8 of the bodies that can wear one (not mask-defined). */
export const DEFAULT_NONE_WEIGHTS: Readonly<Record<WardrobeSlot, number>> = {upper: 0.8, lower: 2.0, head: 5, face: 14};
export const DEFAULT_ZOMBIE_POOL: ZombiePool = {};

/**
 * Hit-volume calibration: measured mesh radii (body extras `hit` + wearable `bulkM`) times these
 * factors reproduce the iteration-01..04 tuned volumes on the Last-shift body (head 0.135,
 * torso 0.20 / 0.24 coated, arms 0.075 / 0.09 coated, legs 0.10), so gameplay feel is unchanged
 * for the original zombie and scales with every other body/wearable.
 */
export const HIT_CALIBRATION = {head: 1.126, torso: 1.378, arm: 1.062, leg: 0.913} as const;
/**
 * Measured Last-shift radii (zombie-body-lastshift.glb extras `hit` of iterations 01-07): the calibration and ragdoll
 * reference. Meshy T2.5 migration (2026-10-29): KEPT. The calibration maps measured mesh radii to gameplay radii and the
 * ragdoll spheres were tuned on that Last-shift mesh, so every rebuilt body (incl. the gaunter T2.5 Last-shift) gets
 * volumes / ragdoll girth from its OWN measured mesh through the same mapping (derivatives/meshy-t25-chars-20261029.json).
 */
export const REFERENCE_HIT = {head: 0.1199, torso: 0.1451, arm: 0.0706, leg: 0.1095} as const;

export type HitRadii = {head: number; torso: number; arm: number; leg: number};
export type MeshSlot = WardrobeSlot | 'body';

export interface ZombieAppearance {
  look: ZombieLook;
  /** Cloned scene (skeleton + skinned meshes), ready to add to the world. */
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Hit-volume radii in model metres (actor scale applies on top). */
  hit: HitRadii;
  /** Ragdoll sphere multipliers relative to the reference (Last-shift) rig. */
  girth: {torso: number; arm: number; leg: number};
  heavy: boolean;
  /** Body + every worn wearable (one SkinnedMesh each, all bound to the body's skeleton). */
  meshes: {mesh: THREE.SkinnedMesh; slot: MeshSlot; wearable: string | null}[];
}

/** What selection needs: available bodies/wearables and which body x wearable pairs were fitted. */
export interface WardrobeAvailability {
  bodies: readonly ZombieBodyDef[];
  wearables: readonly WearableDef[];
  supports(bodyId: string, wearableId: string): boolean;
  /**
   * Iteration 07: body-specific compatibility of two wearables (registry rules AND the build's per-body
   * layering exclusions, e.g. a coat whose skirt the fitted pants of THAT body still poke through).
   * Optional: when absent only the registry rules (wearablesCompatible) apply.
   */
  compatible?(bodyId: string, a: WearableDef, b: WearableDef): boolean;
  /** Backward compat: available upper-slot wearables. */
  readonly outfits: readonly WearableDef[];
}
/** Iteration-05 availability shape: every outfit (upper) fits every body. */
export interface LegacyAvailability { bodies: readonly ZombieBodyDef[]; outfits: readonly WearableDef[] }

export const outfitNodeName = (wearable: string, body: string) => `Outfit_${wearable}__${body}`;

export function lookKey(look: ZombieLook): string {
  return [look.body, ...PICK_ORDER.filter(s => look.wear[s]).map(s => `${s}=${look.wear[s]}`)].join('|');
}

export function normalizeLook(look: ZombieLook | LegacyZombieLook): ZombieLook {
  if ('wear' in look) return look;
  return {body: look.body, wear: look.outfit ? {upper: look.outfit} : {}};
}

function normalizeAvailability(a: WardrobeAvailability | LegacyAvailability): WardrobeAvailability {
  if ('supports' in a) return a;
  const ws = a.outfits.map(o => ({...o, slot: o.slot ?? 'upper'}));
  return {bodies: a.bodies, wearables: ws, supports: () => true, outfits: ws};
}

const ruleHits = (rules: readonly string[] | undefined, id: string, tags: readonly string[] | undefined): boolean =>
  !!rules?.some(r => (r.startsWith('tag:') ? !!tags?.includes(r.slice(4)) : r === id));

/** Symmetric compatibility of two wearables (ids or tags in either's `incompatibleWith`). */
export function wearablesCompatible(a: WearableDef, b: WearableDef): boolean {
  return !ruleHits(a.incompatibleWith, b.id, b.tags) && !ruleHits(b.incompatibleWith, a.id, a.tags);
}
/** A wearable may refuse a body by tag ('tag:<t>') or id. */
export function wearableFitsBodyRules(w: WearableDef, body: ZombieBodyDef): boolean {
  return !ruleHits(w.incompatibleWith, body.id, body.tags);
}

/**
 * Deterministic per (station seed, spawn index): independent of other random streams. Picks a body
 * by weight, then one wearable or nothing per slot (upper, lower, head, face) among the wearables
 * fitted for that body and compatible with what was already picked. 'coated' zombies always wear a
 * heavy upper when one fits the body; shamblers wear a light upper or none. Required slots never
 * stay empty (a body whose requirement cannot be met is skipped).
 */
export function pickZombieLook(seed: number, index: number, type: ZombieType, available: WardrobeAvailability | LegacyAvailability, pool: ZombiePool = DEFAULT_ZOMBIE_POOL): ZombieLook {
  const av = normalizeAvailability(available);
  const rand = mulberry32(hashString(`zombie-look:${index}`, seed >>> 0));
  rand(); // decorrelate from the seed-adjacent first value
  const pickW = <T>(items: [T, number][]): T | undefined => {
    const live = items.filter(([, w]) => w > 0);
    let total = 0;
    for (const [, w] of live) total += w;
    let r = rand() * total;
    for (const [v, w] of live) { r -= w; if (r < 0) return v; }
    return live[live.length - 1]?.[0];
  };
  const bw = (b: ZombieBodyDef) => pool.bodies?.[b.id] ?? b.weight;
  const ww = (w: WearableDef) => pool.wearables?.[w.id] ?? w.weight;
  let bodies = av.bodies.filter(b => bw(b) > 0);
  if (!bodies.length) bodies = [...av.bodies];
  while (bodies.length) {
    const bodyId = pickW(bodies.map(b => [b.id, bw(b)] as [string, number])) ?? bodies[0].id;
    const body = bodies.find(b => b.id === bodyId)!;
    const wear: Partial<Record<WardrobeSlot, string>> = {};
    const picked: WearableDef[] = [];
    let ok = true;
    const compat = (a: WearableDef, b: WearableDef) => (av.compatible ? av.compatible(body.id, a, b) : wearablesCompatible(a, b));
    const fits = (w: WearableDef) => ww(w) > 0 && av.supports(body.id, w.id) && wearableFitsBodyRules(w, body);
    for (const [si, slot] of PICK_ORDER.entries()) {
      if (body.covers?.includes(slot)) continue;
      // a candidate must leave every later REQUIRED slot fillable with something compatible
      const laterRequired = PICK_ORDER.slice(si + 1).filter(s => body.requires?.includes(s) && !body.covers?.includes(s));
      let cands = av.wearables.filter(w => w.slot === slot && fits(w) && picked.every(p => compat(p, w))
        && laterRequired.every(r => av.wearables.some(x => x.slot === r && fits(x) && compat(w, x) && picked.every(p => compat(p, x)))));
      const required = !!body.requires?.includes(slot);
      let allowNone = !required;
      if (slot === 'upper') {
        const heavy = cands.filter(w => w.heavy);
        if (type === 'coated') {
          if (heavy.length) { cands = heavy; allowNone = false; } else if (cands.length) allowNone = false;
        } else cands = cands.filter(w => !w.heavy);
      }
      if (!cands.length) {
        if (required) { ok = false; break; }
        continue;
      }
      const items: [WearableDef | null, number][] = cands.map(w => [w, ww(w)]);
      if (allowNone) items.unshift([null, pool.none?.[slot] ?? DEFAULT_NONE_WEIGHTS[slot]]);
      const w = pickW(items) ?? null;
      if (w) { wear[slot] = w.id; picked.push(w); }
    }
    if (ok) return {body: body.id, wear};
    bodies = bodies.filter(b => b !== body);
  }
  return {body: av.bodies[0]?.id ?? 'lastshift', wear: {}};
}

function decodeBits(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

interface BodyExtras { id: string; heightM: number; hit: HitRadii; bodyTriangles: number; geometryHash: string }
interface VariantExtras {
  outfit: string; slot?: WardrobeSlot; body: string; bodyTriangles: number; bodyGeometryHash: string;
  hideBodyTriangles?: string; hiddenCount?: number;
  bulkM?: {torso?: number; arm?: number; leg?: number; head?: number};
  hideWear?: Record<string, string>;
  /** Iteration 07: wearables this fitted variant must never be combined with on this body (layering gate). */
  incompatibleWear?: string[];
}
interface WearableSceneExtras { id?: string; slot?: WardrobeSlot; kind?: string; heavy?: boolean }

export interface LookCounts {
  /** Valid looks per body (at least one wearable worn; base looks excluded). */
  perBody: Record<string, number>;
  /** Total valid fitted looks (sum of perBody). */
  validLooks: number;
  /** Supported body x wearable pairs (each fitted per body). */
  pairCount: number;
  /** Available wearables per slot. */
  wearablesPerSlot: Record<WardrobeSlot, number>;
  /** Supported pairs per slot. */
  pairsPerSlot: Record<WardrobeSlot, number>;
  bodies: number;
}

/**
 * Assembles actors from the loaded GLBs. Bodies whose model is not loaded (or whose required slots
 * cannot be filled) and wearables without any fitted variant are simply unavailable. Masked
 * geometries (body under the worn set; a wearable under the other worn wearables) are cached per
 * combination and shared by every actor wearing it (attributes are shared with the template; only
 * the index buffer differs).
 */
export class WardrobeLibrary {
  readonly bodies: ZombieBodyDef[];
  readonly wearables: WearableDef[];
  private readonly support = new Map<string, Map<string, THREE.SkinnedMesh>>();
  private readonly masked = new Map<string, THREE.BufferGeometry>();
  private readonly allBodies: ZombieBodyDef[];

  constructor(private readonly models: Record<string, GLTF | undefined>, bodies: readonly ZombieBodyDef[], wearables: readonly WearableDef[]) {
    const loaded = bodies.filter(b => this.bodyMesh(b) !== null);
    this.allBodies = loaded;
    for (const b of loaded) {
      const m = new Map<string, THREE.SkinnedMesh>();
      for (const w of wearables) {
        if (b.covers?.includes(w.slot) || !wearableFitsBodyRules(w, b)) continue;
        const v = this.findVariant(w, b);
        if (v) m.set(w.id, v);
      }
      this.support.set(b.id, m);
    }
    this.wearables = wearables.filter(w => loaded.some(b => this.support.get(b.id)!.has(w.id)));
    // a body is selectable only if each required slot has at least one fitted wearable
    this.bodies = loaded.filter(b => (b.requires ?? []).every(s => this.wearables.some(w => w.slot === s && this.support.get(b.id)!.has(w.id))));
  }

  get available(): WardrobeAvailability {
    const outfits = this.outfits;
    return {bodies: this.bodies, wearables: this.wearables, supports: (b, w) => this.supports(b, w), compatible: (b, x, y) => this.compatible(b, x, y), outfits};
  }

  /** Backward compat: available upper-slot wearables. */
  get outfits(): WearableDef[] {
    return this.wearables.filter(w => w.slot === 'upper');
  }

  supports(bodyId: string, wearableId: string): boolean {
    return !!this.support.get(bodyId)?.has(wearableId);
  }

  /** Registry rules AND the build's per-body layering exclusions (variant extras incompatibleWear). */
  compatible(bodyId: string, a: WearableDef, b: WearableDef): boolean {
    if (!wearablesCompatible(a, b)) return false;
    const ea = this.support.get(bodyId)?.get(a.id)?.userData as VariantExtras | undefined, eb = this.support.get(bodyId)?.get(b.id)?.userData as VariantExtras | undefined;
    return !ea?.incompatibleWear?.includes(b.id) && !eb?.incompatibleWear?.includes(a.id);
  }

  /** Supported (fitted) body x wearable pairs over every slot. */
  get comboCount(): number {
    return this.pairs().length;
  }

  pairs(): {body: string; wearable: string; slot: WardrobeSlot}[] {
    const out: {body: string; wearable: string; slot: WardrobeSlot}[] = [];
    for (const b of this.bodies) for (const w of this.wearables) if (this.supports(b.id, w.id)) out.push({body: b.id, wearable: w.id, slot: w.slot});
    return out;
  }

  wearable(id: string): WearableDef | undefined {
    return this.wearables.find(w => w.id === id);
  }

  /** True if the look can be built exactly: known body, each slot holds a fitted, compatible wearable of that slot, requirements met. */
  isValid(look: ZombieLook | LegacyZombieLook): boolean {
    const l = normalizeLook(look);
    const b = this.bodies.find(x => x.id === l.body);
    if (!b) return false;
    const worn: WearableDef[] = [];
    for (const [slot, id] of Object.entries(l.wear) as [WardrobeSlot, string | undefined][]) {
      if (!id) continue;
      if (!isWardrobeSlot(slot)) return false;
      const w = this.wearable(id);
      if (!w || w.slot !== slot || b.covers?.includes(slot) || !this.supports(b.id, id)) return false;
      worn.push(w);
    }
    for (let i = 0; i < worn.length; i++) for (let j = i + 1; j < worn.length; j++) if (!this.compatible(b.id, worn[i], worn[j])) return false;
    return (b.requires ?? []).every(s => !!l.wear[s]);
  }

  /** Every valid look (at least one wearable; base looks excluded), optionally capped per slot. */
  enumerateLooks({maxPerSlot = Infinity, bodies}: {maxPerSlot?: number; bodies?: readonly string[]} = {}): ZombieLook[] {
    const out: ZombieLook[] = [];
    for (const b of this.bodies) {
      if (bodies && !bodies.includes(b.id)) continue;
      const slots = PICK_ORDER.filter(s => !b.covers?.includes(s));
      const options = slots.map(s => [null, ...this.wearables.filter(w => w.slot === s && this.supports(b.id, w.id)).slice(0, maxPerSlot)] as (WearableDef | null)[]);
      const rec = (k: number, wear: Partial<Record<WardrobeSlot, string>>, picked: WearableDef[]) => {
        if (k === slots.length) {
          if (picked.length && (b.requires ?? []).every(s => !!wear[s])) out.push({body: b.id, wear: {...wear}});
          return;
        }
        for (const w of options[k]) {
          if (!w) { rec(k + 1, wear, picked); continue; }
          if (!picked.every(p => this.compatible(b.id, p, w))) continue;
          wear[slots[k]] = w.id;
          rec(k + 1, wear, [...picked, w]);
          delete wear[slots[k]];
        }
      };
      rec(0, {}, []);
    }
    return out;
  }

  countLooks(): LookCounts {
    const perBody: Record<string, number> = {};
    for (const b of this.bodies) perBody[b.id] = 0;
    for (const l of this.enumerateLooks()) perBody[l.body]++;
    const pairs = this.pairs();
    const zero = (): Record<WardrobeSlot, number> => ({upper: 0, lower: 0, head: 0, face: 0});
    const wearablesPerSlot = zero(), pairsPerSlot = zero();
    for (const w of this.wearables) wearablesPerSlot[w.slot]++;
    for (const p of pairs) pairsPerSlot[p.slot]++;
    return {perBody, validLooks: Object.values(perBody).reduce((a, v) => a + v, 0), pairCount: pairs.length, wearablesPerSlot, pairsPerSlot, bodies: this.bodies.length};
  }

  /** The fitted template mesh of a wearable for a body (null if that pair is not supported). */
  variant(wearableId: string, bodyId: string): THREE.SkinnedMesh | null {
    return this.support.get(bodyId)?.get(wearableId) ?? null;
  }

  private bodyMesh(b: ZombieBodyDef): THREE.SkinnedMesh | null {
    const g = this.models[b.model];
    const m = g?.scene.getObjectByName('ZombieBody') as THREE.SkinnedMesh | undefined;
    return m?.isSkinnedMesh ? m : null;
  }

  private bodyExtras(b: ZombieBodyDef): BodyExtras | null {
    return (this.models[b.model]?.scene.userData?.zombieBody as BodyExtras | undefined) ?? null;
  }

  private findVariant(w: WearableDef, b: ZombieBodyDef): THREE.SkinnedMesh | null {
    const g = this.models[w.model];
    if (!g) return null;
    const sx = (g.scene.userData?.zombieWearable ?? g.scene.userData?.zombieOutfit) as WearableSceneExtras | undefined;
    // the GLB's own slot (legacy zombieOutfit files = upper) must agree with the registry
    const glbSlot = g.scene.userData?.zombieWearable ? sx?.slot : 'upper';
    if (glbSlot && glbSlot !== w.slot) return null;
    const m = g.scene.getObjectByName(outfitNodeName(w.id, b.id)) as THREE.SkinnedMesh | undefined;
    if (!m?.isSkinnedMesh) return null;
    const ex = m.userData as VariantExtras;
    const be = this.bodyExtras(b);
    // the mask indexes this exact body build; refuse a stale wearable/body pairing
    if (be && ex.bodyGeometryHash && ex.bodyGeometryHash !== be.geometryHash) return null;
    return m;
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

  /** Fills the body's empty required slots (pick order) with the first fitted wearables compatible with everything worn. */
  private completeRequired(b: ZombieBodyDef, worn: {w: WearableDef; src: THREE.SkinnedMesh; ex: VariantExtras}[]): void {
    const missing = PICK_ORDER.filter(s => b.requires?.includes(s) && !b.covers?.includes(s) && !worn.some(o => o.w.slot === s));
    const fill = (k: number): boolean => {
      if (k === missing.length) return true;
      for (const w of this.wearables) {
        if (w.slot !== missing[k] || !this.supports(b.id, w.id) || !worn.every(o => this.compatible(b.id, o.w, w))) continue;
        const src = this.variant(w.id, b.id)!;
        worn.push({w, src, ex: src.userData as VariantExtras});
        if (fill(k + 1)) return true;
        worn.pop();
      }
      return false;
    };
    fill(0);
  }

  build(lookIn: ZombieLook | LegacyZombieLook): ZombieAppearance {
    const look = normalizeLook(lookIn);
    // (an unclothed body whose required slots cannot be filled is never selectable, and never built: bodies[0] instead)
    const b = this.bodies.find(x => x.id === look.body) ?? this.allBodies.find(x => x.id === look.body && !x.nude) ?? this.bodies[0];
    if (!b) throw new Error('no zombie body model loaded');
    const gltf = this.models[b.model]!;
    const root = SkeletonUtils.clone(gltf.scene);
    root.userData = {};
    const body = root.getObjectByName('ZombieBody') as THREE.SkinnedMesh;
    body.userData = {...body.userData, slot: 'body', wearable: null};
    const be = this.bodyExtras(b);
    const hit: HitRadii = {...(be?.hit ?? REFERENCE_HIT)};
    // worn set: only fitted, compatible wearables of the right slot (conflicts resolved in pick
    // order, as selection does), then sorted inner -> outer
    const worn: {w: WearableDef; src: THREE.SkinnedMesh; ex: VariantExtras}[] = [];
    for (const slot of PICK_ORDER) {
      const id = look.wear[slot];
      if (!id) continue;
      const w = this.wearable(id);
      const src = w && w.slot === slot ? this.variant(id, b.id) : null;
      if (!w || !src || !worn.every(o => this.compatible(b.id, o.w, w))) continue;
      worn.push({w, src, ex: src.userData as VariantExtras});
    }
    if (b.nude) this.completeRequired(b, worn);
    worn.sort((x, y) => SLOTS.indexOf(x.w.slot) - SLOTS.indexOf(y.w.slot));
    const ids = worn.map(o => o.w.id).sort();
    const meshes: ZombieAppearance['meshes'] = [{mesh: body, slot: 'body', wearable: null}];
    for (const o of worn) {
      const others = worn.filter(x => x !== o && x.ex.hideWear?.[o.w.id]);
      const geom = this.maskedGeometry(`wear:${o.w.id}@${b.id}|${others.map(x => x.w.id).sort().join(',')}`, o.src.geometry, others.map(x => x.ex.hideWear![o.w.id]));
      const mesh = new THREE.SkinnedMesh(geom, o.src.material);
      mesh.name = `ZombieWear_${o.w.slot}`;
      mesh.userData = {slot: o.w.slot, wearable: o.w.id};
      body.parent!.add(mesh);
      mesh.bind(body.skeleton, body.bindMatrix);
      meshes.push({mesh, slot: o.w.slot, wearable: o.w.id});
    }
    const bodyBits = worn.map(o => o.ex.hideBodyTriangles).filter((s): s is string => !!s);
    body.geometry = this.maskedGeometry(`body:${b.id}|${ids.join(',')}`, body.geometry, bodyBits);
    const upper = worn.find(o => o.w.slot === 'upper');
    const lower = worn.find(o => o.w.slot === 'lower');
    const headItems = worn.filter(o => o.w.slot === 'head' || o.w.slot === 'face');
    const bulk = {torso: upper?.ex.bulkM?.torso ?? 0, arm: upper?.ex.bulkM?.arm ?? 0, leg: lower?.ex.bulkM?.leg ?? 0, head: Math.max(0, ...headItems.map(o => o.ex.bulkM?.head ?? 0))};
    const K = HIT_CALIBRATION;
    const heavy = !!upper?.w.heavy;
    const radii: HitRadii = {head: (hit.head + bulk.head) * K.head, torso: (hit.torso + bulk.torso) * K.torso, arm: (hit.arm + bulk.arm) * K.arm, leg: (hit.leg + (heavy ? 0.01 : 0) + bulk.leg) * K.leg};
    // ragdoll spheres were tuned on Last-shift; heavy uppers add the ragdoll's own coat padding
    const girth = {torso: hit.torso / REFERENCE_HIT.torso, arm: hit.arm / REFERENCE_HIT.arm, leg: hit.leg / REFERENCE_HIT.leg};
    if (upper && !heavy) { girth.torso *= 1 + bulk.torso / REFERENCE_HIT.torso * 0.5; girth.arm *= 1 + bulk.arm / REFERENCE_HIT.arm * 0.5; }
    if (lower) girth.leg *= 1 + bulk.leg / REFERENCE_HIT.leg * 0.5;
    const wear: Partial<Record<WardrobeSlot, string>> = {};
    for (const o of worn) wear[o.w.slot] = o.w.id;
    return {look: {body: b.id, wear}, root, animations: gltf.animations, hit: radii, girth, heavy, meshes};
  }
}
