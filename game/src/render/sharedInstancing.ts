// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD): SHARED NODE BUILDS FOR INSTANCED MESHES — one node build per
// instanced material variant instead of one per InstancedMesh.
//
// Measured (the real Game in Node on a validating WebGPU device, the Subway start station, Enhanced lighting Auto): the loading
// warm-up's stage 1 is ~90 % of a station load, and 903 of its 1044 node builds (125.7 s of 141.5 s of JavaScript) are InstancedMeshes
// — every one built on its own, because three r186 puts `object.uuid` into the cache key of anything instanced
// (RenderObject.getMaterialCacheKey). With the uuid taken out those 903 builds fall into 55 groups: the pools of one material differ in
// nothing a build reads, except WHICH instance buffers it captured.
//
// Why three keys them apart, and what is done about it here. On the attribute path (render/instancing.ts: four instanced vec4
// attributes, identical shader text for every pool of a material) the only per-object things left in a build are
//  (a) the instance buffers: the build's attribute nodes hold the FIRST mesh's InstancedInterleavedBuffer (and its instance-colour
//      attribute), and RenderObject.getAttributes hands exactly those to every render object that uses the build;
//  (b) their upkeep: the build's frame hook copies version / update ranges from that first mesh's instanceMatrix / instanceColor only.
// So, for a render object on the shared path:
//  1. KEY: the node manager looks its build up under three's own cache key computed with a SIGNATURE in place of the object's uuid
//     (NodeManager.getForRenderCacheKey, three's seam for exactly this lookup): everything else three puts in the key stays — material
//     values and node graph, geometry layout, receiveShadow, lights / fog / environment, render context, clipping. The signature holds
//     what accessors/Instance.js still branches on: instance colour present or not and the two buffers' usage (static / dynamic).
//     Storage-buffer instances, morph targets, anything that is not a plain InstancedMesh, a pool whose geometry leaves no room
//     for the instance attributes (render/instancing.ts instanceAttributesFit: WebGPU binds 8 vertex buffers / 16 attributes per
//     pipeline — the bullet-crater pool is at 8 already) and a render object built with previous-frame data (a velocity MRT: three's
//     instancing keeps a per-mesh previous matrix there; the game has none) keep three's own key (never shared).
//     The render object's OWN key (initialCacheKey: what decides whether three re-creates it) is untouched.
//  2. PATH: its builder takes the attribute path whatever the level's switch says (forceAttributeInstancing) — a shared key never
//     names a build with the pool's instance count and a global node id in its text (the uniform-buffer path).
//  3. DATA: its getAttributes swaps the build's captured instance buffers for the mesh's OWN — one InstancedInterleavedBuffer over its
//     own instanceMatrix.array (and one InstancedBufferAttribute over its own instanceColor.array), shared by all of the mesh's render
//     objects (scene pass, flashlight shadow pass, the glass mirror), same layout / stride / step mode / usage, so the vertex layout and
//     therefore the pipeline are the build's. Their version and update ranges follow the mesh's own attributes on every full refresh
//     (three asks for the attributes right before it uploads them; an instance that moved forces that refresh:
//     NodeMaterialObserver compares instanceMatrix.version per render object).
// Everything else in a shared build is per render object in three already — this is how ordinary Meshes of one material have always
// shared a build: bindings and uniform groups (NodeBuilderState.createBindings), per-object update nodes (frame.object), the draw's
// instance count (object.count), culling, the observer's per-object versions.
//
// A render object keeps the choice made at its first build lookup (the switch read then), like the attribute path itself: turning the
// switch off or on never invalidates what was built. `?instshare=off` is the kill switch (three's keyed builds everywhere, exactly as
// before this module); `?instshare=on` shares on every level.
//
// LIFETIME (a station change is the case that matters: the new station's pools are warmed while the old station's are still waiting
// to be disposed, so a build made from an OLD pool lives on under the new ones — possibly for the whole session).
//  - What a kept build still holds of the mesh it was made from: that mesh's instanceMatrix / instanceColor attribute objects (in
//    three's frame hook) and three's own InstancedInterleavedBuffer / InstancedBufferAttribute over the SAME arrays (in the build's
//    attribute nodes) — i.e. count x 16 (+ count x 3) floats of one pool per live build, never more: a build has one first mesh, and
//    a later station neither adds to it nor replaces it. Not the mesh, its geometry or its material. three's two buffers are never
//    given to the GPU here: no render object on the shared path, the first mesh's included, hands them to the backend.
//  - GPU side: each mesh's own instance buffers are released when the MESH is disposed (three itself only frees node attributes with
//    the geometry of the render object that first drew it, and leaves the rest to the garbage collector): every renderer that was
//    given them destroys them, and a disposed mesh that is drawn again simply gets new ones. A buffer over an attribute that two
//    meshes share (the Reactor's lamp glass draws with the tubes' instanceColor) goes with the last of them. So what a kept build's
//    first mesh costs on the GPU after its station is gone is nothing.
//  - three r186's WebGPU backend destroys an interleaved buffer with its geometry but keeps the destroyed GPUBuffer in its own record
//    of that buffer (WebGPUAttributeUtils.destroyAttribute deletes the attribute's entry only), so a mesh that lives on would be
//    drawn with a destroyed buffer: such a record is dropped here before the next upload, and three then creates a new buffer.
//  - The first mesh's update RANGES are consumed by three's own frame hook before this module sees them, so a partial instance
//    upload of that one pool becomes a whole-buffer upload (the same bytes; the game sets no ranges on instance attributes).
//
// Both backends: the node manager and RenderObject are the renderer's, not the backend's. On WebGL 2 the programs of one material's
// pools were already shared by their text on the attribute path; what changes there is the same as on WebGPU — the JavaScript node
// build runs once per variant instead of once per pool — and each pool's VAO is made from its own buffers as before.

import * as THREE from 'three';
import {NodeUtils} from 'three/webgpu';
import {forceAttributeInstancing, instanceAttributesFit} from './instancing';

/**
 * Counters (QA / tests): renderers wrapped, render objects on the shared path / left on three's keyed path, own buffers made, attribute
 * lists rewritten, builds found without their first mesh's record, GPU-side attribute records released with a disposed mesh, records
 * of a destroyed buffer dropped, releases that threw.
 */
export const sharedInstancingStats = {installs: 0, shared: 0, keyed: 0, matrixBuffers: 0, colorBuffers: 0, remapped: 0, missingTemplate: 0,
  released: 0, staleDropped: 0, releaseErrors: 0};

type Override = 'on' | 'off' | null;

/** `?instshare=on|off` (read from the page URL where there is one). */
export function sharedInstancingOverride(search?: string): Override {
  let s = search;
  if (s === undefined) { try { s = (globalThis as {location?: {search?: string}}).location?.search ?? ''; } catch { s = ''; } }
  let v: string | null = null;
  try { v = new URLSearchParams(s).get('instshare'); } catch { /* no URL: the caller's choice */ }
  return v === 'off' || v === '0' ? 'off' : v === 'on' || v === '1' ? 'on' : null;
}

let wanted = false;
let override: Override | undefined;

/**
 * Shared builds on / off for render objects FIRST built from now on (Game.buildSection, per level). The URL's `?instshare=` wins
 * (off: the kill switch; on: every level).
 */
export function setSharedInstancing(on: boolean): void {
  wanted = on;
}

/** Tests: set / clear the override the URL would give (undefined: read the URL again). */
export function overrideSharedInstancing(v: Override | undefined): void {
  override = v;
}

/** Whether an eligible InstancedMesh's render object built now takes the shared path. */
export function sharedInstancing(): boolean {
  if (override === undefined) override = sharedInstancingOverride();
  return override === null ? wanted : override === 'on';
}

interface InstanceAttr { array: ArrayLike<number>; version: number; usage: number; updateRanges: {start: number; count: number}[]; clearUpdateRanges(): void;
  isInstancedBufferAttribute?: boolean; isStorageInstancedBufferAttribute?: boolean }
interface InstancedLike { uuid: string; isInstancedMesh?: boolean; instanceMatrix?: InstanceAttr | null; instanceColor?: InstanceAttr | null; morphTexture?: unknown;
  geometry?: {morphAttributes?: Record<string, unknown>} | null;
  addEventListener?(type: string, listener: (event: {target?: unknown}) => void): void }
interface AttrLike { isInterleavedBufferAttribute?: boolean; isInstancedBufferAttribute?: boolean; array?: unknown; offset?: number;
  data?: {array?: unknown; isInstancedInterleavedBuffer?: boolean} }
/** three's Attributes (renderers/common): the renderer's record of each attribute it uploaded; delete() destroys the GPU buffer. */
interface AttributeStore { has(attribute: object): boolean; delete(attribute: object): unknown; backend?: {has(o: object): boolean; delete(o: object): void} | null }
interface RenderObjectLike {
  object: InstancedLike;
  attributes: AttrLike[] | null;
  vertexBuffers: unknown[] | null;
  renderer?: {getMRT?(): {has?(name: string): boolean} | null} | null;
  _geometries?: {attributes?: AttributeStore | null} | null;
  getCacheKey(): number;
  getAttributes(): AttrLike[];
  getNodeBuilderState(): object;
}
interface BuilderLike { object?: InstancedLike | null }
interface NodesLike {
  getForRenderCacheKey(renderObject: RenderObjectLike): number;
  _createNodeBuilder(renderObject: RenderObjectLike, material: unknown): BuilderLike;
  _createNodeBuilderState(builder: BuilderLike): object;
}

/**
 * What three's instancing setup (accessors/Instance.js, NodeMaterial.setupPosition / setupDiffuseColor) reads from the OBJECT on the
 * attribute path, as a key part — or null when the object is not a plain attribute-instanced mesh (it keeps three's own key).
 */
export function instancingSignature(object: unknown): string | null {
  const o = object as InstancedLike | null | undefined;
  if (!o || o.isInstancedMesh !== true) return null;
  const m = o.instanceMatrix, c = o.instanceColor;
  if (!m || m.isInstancedBufferAttribute !== true || m.isStorageInstancedBufferAttribute === true) return null;
  if (c && (c.isInstancedBufferAttribute !== true || c.isStorageInstancedBufferAttribute === true)) return null;
  if (o.morphTexture) return null; // (morph targets read the object's own morph texture)
  const morph = o.geometry?.morphAttributes;
  if (morph) for (const _ in morph) return null;
  if (!instanceAttributesFit(o)) return null; // (no room for the instance attributes in one pipeline: three's uniform-buffer path, keyed)
  const dyn = (a: InstanceAttr) => (a.usage === THREE.DynamicDrawUsage ? 'dynamic' : 'static');
  return `shared-instancing:matrix-${dyn(m)}:colour-${c ? dyn(c) : 'none'}`;
}

/** The shared build key of each render object on the shared path (kept for its lifetime: the lookup and the release use the same key). */
const sharedKey = new WeakMap<object, number>();
/** Render objects that keep three's own key (decided once, like the shared ones). */
const keyed = new WeakSet<object>();
/** The mesh a shared build was made from: its instance arrays are what the build's attribute nodes captured. */
const template = new WeakMap<object, {matrix: unknown; color: unknown}>();
/**
 * Who uses one own buffer, and which renderers were given it. Usually one mesh — but two meshes may share an instance attribute (the
 * Reactor's lamp glass draws with the tubes' instanceColor), and then they share the buffer made over it: it is released with the
 * LAST of them. `count` is kept beside the WeakSet so that a mesh that is simply dropped (never disposed) is not held here: the
 * buffer is then left to the garbage collector, as three leaves it.
 */
interface Use { count: number; meshes: WeakSet<object>; stores: Set<AttributeStore> }
interface OwnMatrix { buffer: THREE.InstancedInterleavedBuffer; columns: THREE.InterleavedBufferAttribute[]; use: Use }
interface OwnColour { attribute: THREE.InstancedBufferAttribute; use: Use }
const newUse = (): Use => ({count: 0, meshes: new WeakSet(), stores: new Set()});
/** The own instance buffers, by the instanceMatrix / instanceColor attribute they were made over (one GPU buffer each, whatever the pass). */
const ownMatrix = new WeakMap<object, OwnMatrix>();
const ownColor = new WeakMap<object, OwnColour>();
const installed = new WeakSet<object>();
const BUILT_SHARED = Symbol('sharedInstancingBuilder');
let warned = false;

function matrixBuffers(m: InstanceAttr): OwnMatrix {
  let own = ownMatrix.get(m);
  if (!own) {
    // as three builds them (accessors/Instance.js createInstanceMatrixNode + BufferAttributeNode.setup): the mesh's own array, 16 floats
    // per instance, four vec4 columns at offsets 0 / 4 / 8 / 12
    const buffer = new THREE.InstancedInterleavedBuffer(m.array as THREE.TypedArray, 16, 1);
    buffer.setUsage(m.usage as THREE.Usage);
    const columns = [0, 4, 8, 12].map(offset => {
      const a = new THREE.InterleavedBufferAttribute(buffer, 4, offset);
      (a as unknown as {isInstancedBufferAttribute: boolean}).isInstancedBufferAttribute = true;
      return a;
    });
    own = {buffer, columns, use: newUse()};
    ownMatrix.set(m, own);
    sharedInstancingStats.matrixBuffers++;
  }
  return own;
}

function colorBuffer(c: InstanceAttr): OwnColour {
  let own = ownColor.get(c);
  if (!own) {
    const attribute = new THREE.InstancedBufferAttribute(c.array as THREE.TypedArray, 3);
    attribute.setUsage(c.usage as THREE.Usage);
    own = {attribute, use: newUse()};
    ownColor.set(c, own);
    sharedInstancingStats.colorBuffers++;
  }
  return own;
}

/**
 * True when three would build `ro` with previous-frame data (NodeBuilder.needsPreviousData: a velocity MRT, or an object flagged by a
 * shadow pass under one): its instancing then keeps a previous matrix per MESH, which a shared build cannot hold.
 */
function needsPreviousData(ro: RenderObjectLike): boolean {
  try {
    const mrt = ro.renderer?.getMRT?.();
    if (mrt && typeof mrt.has === 'function' && mrt.has('velocity')) return true;
    const data = (NodeUtils as unknown as {getDataFromObject?: (o: object) => {useVelocity?: boolean}}).getDataFromObject?.(ro.object);
    return data?.useVelocity === true;
  } catch { return true; } // (cannot tell: three's own keyed build)
}

/** The own buffers each mesh draws with (as handed to a renderer). */
interface Handed { matrices: Set<OwnMatrix>; colours: Set<OwnColour> }
const handed = new WeakMap<object, Handed>();

/**
 * Release the GPU side of `mesh`'s own instance buffers in every renderer that was given them (the mesh's 'dispose' event; exported
 * for tests) — each one with the last mesh that uses it. The buffer objects stay with the mesh: drawn again, it gets new GPU
 * buffers. Returns the attribute records released.
 */
export function releaseInstanceBuffers(mesh: unknown): number {
  const h = mesh ? handed.get(mesh as object) : undefined;
  if (!h) return 0;
  let n = 0;
  /** True when `mesh` was the last user: the stores to release in are returned through `use.stores` (emptied by the caller). */
  const last = (use: Use): boolean => { if (use.meshes.delete(mesh as object)) use.count--; return use.count <= 0; };
  try {
    for (const om of h.matrices) {
      if (!last(om.use)) continue;
      for (const store of om.use.stores) {
        for (const c of om.columns) if (store.delete(c) != null) n++; // (three: destroys the GPU buffer with the first of its attributes)
        store.backend?.delete(om.buffer); // (and the backend's record of the interleaved buffer: see LIFETIME above)
      }
      om.use.stores.clear();
    }
    for (const oc of h.colours) {
      if (!last(oc.use)) continue;
      for (const store of oc.use.stores) if (store.delete(oc.attribute) != null) n++;
      oc.use.stores.clear();
    }
  } catch (e) {
    sharedInstancingStats.releaseErrors++;
    if (!warned) { warned = true; console.warn('shared instancing: releasing a disposed pool\'s instance buffers failed', e); }
  }
  h.matrices.clear(); h.colours.clear();
  sharedInstancingStats.released += n;
  return n;
}

const onMeshDispose = (event: {target?: unknown}): void => { releaseInstanceBuffers(event.target); };

/** Note that a renderer (its attribute store) is given `o`'s own buffers (first time for this mesh: listen for its disposal). */
function hand(o: InstancedLike, store: AttributeStore | null | undefined, own: OwnMatrix | null, colour: OwnColour | null): void {
  if (!store) return;
  let h = handed.get(o);
  if (!h) {
    h = {matrices: new Set(), colours: new Set()};
    handed.set(o, h);
    o.addEventListener?.('dispose', onMeshDispose);
  }
  const use = (u: Use): void => { if (!u.meshes.has(o)) { u.meshes.add(o); u.count++; } u.stores.add(store); };
  if (own) { h.matrices.add(own); use(own.use); }
  if (colour) { h.colours.add(colour); use(colour.use); }
}

/**
 * Version / update ranges of a mesh's own buffers follow its instanceMatrix / instanceColor (three's Instance.js frame hook, per mesh).
 * With `store` (the asking renderer's): a record of the matrix buffer that outlived its attributes names a destroyed GPUBuffer (see
 * LIFETIME above) and is dropped, so that three creates the buffer again at the upload that follows.
 */
function sync(o: InstancedLike, store?: AttributeStore | null): void {
  const m = o.instanceMatrix, c = o.instanceColor;
  const om = m ? ownMatrix.get(m) : undefined;
  if (om && store && store.backend && !store.has(om.columns[0]) && store.backend.has(om.buffer)) {
    store.backend.delete(om.buffer);
    sharedInstancingStats.staleDropped++;
  }
  if (m && om && om.buffer.version !== m.version) {
    om.buffer.clearUpdateRanges();
    for (const r of m.updateRanges) om.buffer.addUpdateRange(r.start, r.count);
    m.clearUpdateRanges(); // (the source is never uploaded itself)
    om.buffer.version = m.version;
  }
  const oc = c ? ownColor.get(c)?.attribute : undefined;
  if (c && oc && oc.version !== c.version) {
    oc.clearUpdateRanges();
    for (const r of c.updateRanges) oc.addUpdateRange(r.start, r.count);
    c.clearUpdateRanges();
    oc.version = c.version;
  }
}

let protoGetAttributes: ((this: RenderObjectLike) => AttrLike[]) | null = null;

/** RenderObject.getAttributes of a render object on the shared path (an own property of that render object). */
function sharedGetAttributes(this: RenderObjectLike): AttrLike[] {
  let list = this.attributes;
  if (list === null) {
    list = protoGetAttributes!.call(this); // (three's list: the build's attribute nodes, i.e. the template mesh's instance buffers)
    const t = template.get(this.getNodeBuilderState());
    const o = this.object, m = o.instanceMatrix, c = o.instanceColor;
    if (!t) {
      sharedInstancingStats.missingTemplate++;
      if (!warned) { warned = true; console.warn('shared instancing: a shared build without its template (drawn with the build\'s own instance buffers)'); }
    } else if (m) {
      const out: AttrLike[] = [], buffers = new Set<unknown>();
      let own: OwnMatrix | null = null, colour: OwnColour | null = null;
      for (const a of list) {
        let b: AttrLike = a;
        if (a.isInterleavedBufferAttribute === true && a.data?.isInstancedInterleavedBuffer === true && a.data.array === t.matrix) {
          own = matrixBuffers(m);
          b = own.columns[(a.offset ?? 0) >> 2] as unknown as AttrLike;
        } else if (a.isInterleavedBufferAttribute !== true && a.isInstancedBufferAttribute === true && t.color !== null && a.array === t.color && c) {
          colour = colorBuffer(c);
          b = colour.attribute as unknown as AttrLike;
        }
        out.push(b);
        buffers.add(b.isInterleavedBufferAttribute === true ? b.data : b);
      }
      this.attributes = list = out;
      this.vertexBuffers = [...buffers];
      hand(o, this._geometries?.attributes, own, colour);
      sharedInstancingStats.remapped++;
    }
  }
  sync(this.object, this._geometries?.attributes);
  return list;
}

/**
 * Wrap `renderer`'s node manager (after renderer.init(): three creates it there). Idempotent; false when the renderer has none. Inert
 * until setSharedInstancing(true) (or `?instshare=on`): with the switch off every lookup is three's own.
 */
export function installSharedInstancing(renderer: unknown): boolean {
  const nodes = (renderer as {_nodes?: NodesLike | null} | null)?._nodes;
  if (!nodes || typeof nodes.getForRenderCacheKey !== 'function' || typeof nodes._createNodeBuilder !== 'function' || typeof nodes._createNodeBuilderState !== 'function') return false;
  if (installed.has(nodes)) return true;
  installed.add(nodes);
  sharedInstancingStats.installs++;
  const innerKey = nodes.getForRenderCacheKey.bind(nodes);
  const innerBuilder = nodes._createNodeBuilder.bind(nodes);
  const innerState = nodes._createNodeBuilderState.bind(nodes);
  nodes.getForRenderCacheKey = (ro: RenderObjectLike): number => {
    const known = sharedKey.get(ro);
    if (known !== undefined) return known;
    if (keyed.has(ro)) return innerKey(ro);
    let sig = sharedInstancing() ? instancingSignature(ro.object) : null;
    if (sig !== null && needsPreviousData(ro)) sig = null;
    const proto = Object.getPrototypeOf(ro) as {getAttributes?: (this: RenderObjectLike) => AttrLike[]} | null;
    if (sig === null || typeof proto?.getAttributes !== 'function') { keyed.add(ro); sharedInstancingStats.keyed++; return innerKey(ro); }
    // three's own key of this render object, with the signature where the object's uuid goes (the only use of the uuid in it)
    const o = ro.object, uuid = o.uuid;
    let key: number;
    o.uuid = sig;
    try { key = ro.getCacheKey(); } finally { o.uuid = uuid; }
    sharedKey.set(ro, key);
    protoGetAttributes ??= proto.getAttributes;
    ro.getAttributes = sharedGetAttributes;
    sharedInstancingStats.shared++;
    return key;
  };
  nodes._createNodeBuilder = (ro: RenderObjectLike, material: unknown): BuilderLike => {
    const b = innerBuilder(ro, material);
    if (sharedKey.has(ro)) { forceAttributeInstancing(b); (b as {[BUILT_SHARED]?: boolean})[BUILT_SHARED] = true; }
    return b;
  };
  nodes._createNodeBuilderState = (b: BuilderLike): object => {
    const state = innerState(b);
    if ((b as {[BUILT_SHARED]?: boolean})[BUILT_SHARED] === true && b.object) {
      template.set(state, {matrix: b.object.instanceMatrix?.array ?? null, color: b.object.instanceColor?.array ?? null});
    }
    return state;
  };
  return true;
}

/** True when `renderObject` (three's RenderObject) draws on the shared path (QA / tests). */
export function isSharedRenderObject(renderObject: object): boolean {
  return sharedKey.has(renderObject);
}
