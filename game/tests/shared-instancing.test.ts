// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane LOAD; render/sharedInstancing.ts): the pools of one instanced material
// share ONE node build, and every pool still draws ITS OWN instances.
//
// three r186's REAL WebGPURenderer runs on the validating no-op device (helpers/validatingWebgpu.ts), wrapped here so that the test
// itself knows what the GPU was given: the bytes of every buffer (created mapped, or written through the queue) and, for every draw,
// the buffers bound to the pass's vertex slots at that moment and the instance count. A pool "draws its own instances" when one of the
// vertex buffers bound for ITS draw holds exactly the bytes of ITS instanceMatrix array (and of its instanceColor array) and none
// holds another pool's — judged from those bytes, in the scene pass and in the spot light's shadow pass, on the build's first mesh and
// on the ones that came after it. Builds are counted at the backend's node-builder factory.
import * as THREE from 'three';
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {stubValidatingWebgpu} from './helpers/validatingWebgpu';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {VERTEX_LIMITS, attributeInstancing, instanceAttributesFit, setAttributeInstancing} from '../src/render/instancing';
import {CraterField} from '../src/damage/craters';
import {installSharedInstancing, instancingSignature, isSharedRenderObject, overrideSharedInstancing, releaseInstanceBuffers, setSharedInstancing, sharedInstancing,
  sharedInstancingOverride, sharedInstancingStats, textureSlotSignature} from '../src/render/sharedInstancing';
import {WarmupRegistry, planWarmup, runWarmup, type WarmupProgress, type WarmupRenderer} from '../src/render/warmup';

afterEach(() => { overrideSharedInstancing(undefined); setSharedInstancing(false); setAttributeInstancing(false); });
afterAll(() => { vi.unstubAllGlobals(); });

interface RO { object: THREE.Object3D; material: THREE.Material & {isShadowPassMaterial?: boolean}; getVertexBuffers(): {array: unknown; isInstancedInterleavedBuffer?: boolean; isInstancedBufferAttribute?: boolean}[];
  getNodeBuilderState(): object; getBindings(): unknown[]; getAttributes(): unknown[] }
interface GpuBuffer { destroyed?: boolean }
interface Draw { object: THREE.Object3D; shadow: boolean; ro: RO; bound: Uint8Array[]; buffers: GpuBuffer[]; instances: number }
interface Layout { buffers: number; attributes: number; async: boolean; frontFace: string }
interface Build { object: THREE.Object3D; material: () => THREE.Material & {isShadowPassMaterial?: boolean} }

const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
/** True when `buf` (a GPU buffer's bytes) starts with exactly the bytes of `a` and is no longer than its 4-byte padding allows. */
function holdsExactly(buf: Uint8Array, a: ArrayBufferView): boolean {
  const want = bytesOf(a);
  if (buf.length < want.length || buf.length > want.length + 3) return false;
  for (let i = 0; i < want.length; i++) if (buf[i] !== want[i]) return false;
  return true;
}

/** Record what the device is given (see the file comment). `draws` collects the draws of the render object `current()` names. */
function recordDevice(device: Record<string, any>, current: () => {object: THREE.Object3D; ro: RO} | null) {
  const contents = new WeakMap<object, Uint8Array>();
  const draws: Draw[] = [];
  const layouts: Layout[] = [];
  const modules = {vertex: new Set<string>(), all: new Set<string>()};
  // buffers made and destroyed (GPUBufferUsage.VERTEX = 0x20): `live` is what the device still holds
  const made = {all: 0, vertex: 0}, gone = {all: 0, vertex: 0};
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (d: {size?: number; usage?: number}) => {
    const b = createBuffer(d), bytes = new Uint8Array(Math.max(4, d?.size ?? 4));
    contents.set(b, bytes);
    b.getMappedRange = () => bytes.buffer;
    const vertex = ((d?.usage ?? 0) & 0x20) !== 0;
    made.all++; if (vertex) made.vertex++;
    const destroy = b.destroy.bind(b);
    let destroyed = false;
    b.destroy = () => { if (!destroyed) { destroyed = true; gone.all++; if (vertex) gone.vertex++; } return destroy(); };
    return b;
  };
  const writeBuffer = device.queue.writeBuffer.bind(device.queue);
  // GPUQueue.writeBuffer(buffer, bufferOffset, data, dataOffset?, size?): for a typed array the last two are in ELEMENTS
  device.queue.writeBuffer = (b: object, offset: number, data: ArrayBufferView | ArrayBuffer, dataOffset = 0, size?: number) => {
    const into = contents.get(b);
    if (into) {
      const view = ArrayBuffer.isView(data);
      const bpe = view ? ((data as unknown as {BYTES_PER_ELEMENT?: number}).BYTES_PER_ELEMENT ?? 1) : 1;
      const src = view ? new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength) : new Uint8Array(data as ArrayBuffer);
      const from = dataOffset * bpe, n = size === undefined ? src.length - from : size * bpe;
      into.set(src.subarray(from, from + n), offset);
    }
    return writeBuffer(b, offset, data, dataOffset, size);
  };
  const layout = (d: {vertex?: {buffers?: {attributes?: unknown[]}[]}; primitive?: {frontFace?: string}}, async: boolean) => {
    const vb = d?.vertex?.buffers ?? [];
    layouts.push({buffers: vb.length, attributes: vb.reduce((n, x) => n + (x?.attributes?.length ?? 0), 0), async, frontFace: d?.primitive?.frontFace ?? ''});
  };
  for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
    const inner = device[name].bind(device);
    device[name] = (d: never) => { layout(d, name === 'createRenderPipelineAsync'); return inner(d); };
  }
  const createShaderModule = device.createShaderModule.bind(device);
  device.createShaderModule = (d: {code?: string}) => { const c = d?.code ?? ''; modules.all.add(c); if (/@vertex/.test(c)) modules.vertex.add(c); return createShaderModule(d); };
  const createCommandEncoder = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = (d: unknown) => {
    const enc = createCommandEncoder(d), begin = enc.beginRenderPass.bind(enc);
    enc.beginRenderPass = (pd: unknown) => {
      const pass = begin(pd), slots = new Map<number, object>();
      const setVertexBuffer = pass.setVertexBuffer.bind(pass);
      pass.setVertexBuffer = (s: number, b: object) => { slots.set(s, b); return setVertexBuffer(s, b); };
      for (const name of ['draw', 'drawIndexed']) {
        const inner = pass[name].bind(pass);
        pass[name] = (count: number, instances = 1, ...rest: unknown[]) => {
          const c = current();
          if (c) draws.push({object: c.object, ro: c.ro, shadow: c.ro.material.isShadowPassMaterial === true, instances, buffers: [...slots.values()] as GpuBuffer[],
            bound: [...slots.values()].map(b => contents.get(b) ?? new Uint8Array(0))});
          return inner(count, instances, ...rest);
        };
      }
      return pass;
    };
    return enc;
  };
  return {draws, layouts, modules, live: () => ({all: made.all - gone.all, vertex: made.vertex - gone.vertex})};
}

function pool(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, at: THREE.Vector3, o: {colour?: boolean; dynamic?: boolean} = {}): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.name = name;
  const m = new THREE.Matrix4();
  // (every pool's matrices differ from every other pool's: its own offset, its own spacing)
  for (let i = 0; i < count; i++) im.setMatrixAt(i, m.makeTranslation(at.x + i * (0.31 + name.length * 0.01), at.y, at.z + i * 0.07));
  if (o.colour) for (let i = 0; i < count; i++) im.setColorAt(i, new THREE.Color().setHSL((i + 1) / (count + 1), 0.6, 0.5));
  if (o.dynamic) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  return im;
}

interface Scene {
  frame(): void; compile(): Promise<void>;
  rec: ReturnType<typeof recordDevice> | null; log: ReturnType<typeof stubValidatingWebgpu>['log'] | null;
  builds: Build[]; pools: Record<string, THREE.InstancedMesh>; ground: THREE.Mesh; lastDraws: Draw[]; ros(): Map<THREE.Object3D, {scene?: RO; shadow?: RO}>;
  scene: THREE.Scene; cam: THREE.PerspectiveCamera; spot: THREE.SpotLight; renderer: unknown;
  materials: {steel: THREE.MeshStandardMaterial; steelTwin: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial};
  geometries: {box: THREE.BufferGeometry; tall: THREE.BufferGeometry};
  /** Render objects three created so far, and the builds its node manager holds right now. */
  made: {renderObjects: number}; cacheSize(): number;
}

/** `empty`: the lights and the ground only (a test adds its own pools before the first frame). */
async function build(backend: 'webgpu' | 'webgl2', o: {share: boolean; attribute?: boolean; empty?: boolean}): Promise<Scene> {
  const v = backend === 'webgpu' ? stubValidatingWebgpu() : {canvas: stubWebgpuGlobals(), log: null};
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // (three: "WebGPU is not available, running under WebGL2 backend")
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas: v.canvas, forceWebGL: backend === 'webgl2'});
  await r.init();
  r.shadowMap.enabled = true;
  expect(installSharedInstancing(r)).toBe(true);
  expect(installSharedInstancing(r)).toBe(true); // (idempotent)
  setSharedInstancing(o.share);
  setAttributeInstancing(o.attribute ?? false);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 3, 9);
  cam.lookAt(0, 0.5, 0);
  const spot = new THREE.SpotLight(0xffffff, 60, 40, 0.9, 0.3);
  spot.position.set(0, 7, 5);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(256, 256);
  scene.add(cam, spot, spot.target, new THREE.HemisphereLight(0xffffff, 0x222222, 0.4));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({color: 0x555555, name: 'ground'}));
  ground.receiveShadow = true;
  scene.add(ground);

  const steel = new THREE.MeshStandardMaterial({color: 0x8899aa, roughness: 0.6, name: 'steel'});
  const steelTwin = steel.clone(); // (value-equal: three keys a build by a material's values, so its pools share with steel's)
  steelTwin.name = 'steel-twin';
  const glass = new THREE.MeshStandardMaterial({color: 0x99ccdd, transparent: true, opacity: 0.5, name: 'glass'});
  const box = new THREE.BoxGeometry(0.3, 0.3, 0.3), tall = new THREE.BoxGeometry(0.2, 0.9, 0.2); // (same attribute layout, different geometry)
  const pools: Record<string, THREE.InstancedMesh> = o.empty ? {} : {
    a: pool('a', box, steel, 3, new THREE.Vector3(-3, 0.2, 0)),
    b: pool('bb', tall, steel, 5, new THREE.Vector3(-3, 0.5, 1)),
    twin: pool('twin', box, steelTwin, 4, new THREE.Vector3(-3, 0.2, 2)),
    coloured: pool('coloured', box, steel, 6, new THREE.Vector3(-3, 0.2, -1), {colour: true}),
    coloured2: pool('coloured-2', tall, steel, 2, new THREE.Vector3(-3, 0.5, -2), {colour: true}),
    dynamic: pool('dynamic', box, steel, 7, new THREE.Vector3(-3, 0.2, 3), {dynamic: true}),
    glass: pool('glass', box, glass, 3, new THREE.Vector3(-3, 1.2, 0)),
  };
  for (const p of Object.values(pools)) scene.add(p);

  const builds: Build[] = [];
  const B = r.backend as unknown as {createNodeBuilder(object: THREE.Object3D, renderer: unknown): {material: THREE.Material}; draw(o: RO, info: unknown): void; device?: Record<string, any>};
  const createNodeBuilder = B.createNodeBuilder.bind(B);
  B.createNodeBuilder = (object, renderer) => { const b = createNodeBuilder(object, renderer); builds.push({object, material: () => b.material}); return b; };
  let cur: {object: THREE.Object3D; ro: RO} | null = null;
  const seen = new Map<THREE.Object3D, {scene?: RO; shadow?: RO}>();
  const glDraws: Draw[] = [];
  const draw = B.draw.bind(B);
  B.draw = (ro: RO, info: unknown) => {
    cur = {object: ro.object, ro};
    const e = seen.get(ro.object) ?? {};
    if (ro.material.isShadowPassMaterial === true) e.shadow = ro; else e.scene = ro;
    seen.set(ro.object, e);
    if (backend === 'webgl2') glDraws.push({object: ro.object, ro, shadow: ro.material.isShadowPassMaterial === true, instances: (ro.object as THREE.InstancedMesh).count ?? 1, bound: [], buffers: []});
    try { draw(ro, info); } finally { cur = null; }
  };
  const rec = backend === 'webgpu' ? recordDevice(B.device!, () => cur) : null;
  const RR = r as unknown as {_nodes: {nodeFrame: {update(): void}; nodeBuilderCache: Map<unknown, unknown>}; _objects: {createRenderObject(...a: unknown[]): unknown}};
  const nodeFrame = RR._nodes.nodeFrame;
  const made = {renderObjects: 0};
  const createRenderObject = RR._objects.createRenderObject.bind(RR._objects);
  RR._objects.createRenderObject = (...a: unknown[]) => { made.renderObjects++; return createRenderObject(...a); };
  const out: Scene = {
    rec, log: v.log, builds, pools, ground, lastDraws: [], ros: () => seen, scene, cam, spot, renderer: r,
    materials: {steel, steelTwin, glass}, geometries: {box, tall}, made, cacheSize: () => RR._nodes.nodeBuilderCache.size,
    frame() {
      const list = rec ? rec.draws : glDraws;
      list.length = 0;
      nodeFrame.update();
      r.render(scene, cam);
      out.lastDraws = [...list];
    },
    compile: () => r.compileAsync(scene, cam) as Promise<void>,
  };
  return out;
}

const instancedBuilds = (s: Scene, shadow: boolean) => s.builds.filter(b => (b.object as THREE.InstancedMesh).isInstancedMesh && (b.material().isShadowPassMaterial === true) === shadow);
const drawsOf = (s: Scene, p: THREE.InstancedMesh, shadow: boolean) => s.lastDraws.filter(d => d.object === p && d.shadow === shadow);

/** Every pool's draws (scene pass, and the shadow pass when it casts) are bound to its own instance data and to no other pool's. */
function expectOwnData(s: Scene, passes: readonly boolean[] = [false, true]): void {
  const all = Object.values(s.pools);
  for (const shadow of passes) {
    for (const p of all) {
      const draws = drawsOf(s, p, shadow);
      expect(draws.length, `${p.name}: drawn in the ${shadow ? 'shadow' : 'scene'} pass`).toBeGreaterThan(0);
      for (const d of draws) {
        expect(d.instances, `${p.name}: instance count`).toBe(p.count);
        expect(d.bound.some(b => holdsExactly(b, p.instanceMatrix.array)), `${p.name} (${shadow ? 'shadow' : 'scene'}): its own matrices are bound`).toBe(true);
        for (const q of all) if (q !== p) expect(d.bound.some(b => holdsExactly(b, q.instanceMatrix.array)), `${p.name} (${shadow ? 'shadow' : 'scene'}): ${q.name}'s matrices are NOT bound`).toBe(false);
        if (p.instanceColor && !shadow) {
          expect(d.bound.some(b => holdsExactly(b, p.instanceColor!.array)), `${p.name}: its own colours are bound`).toBe(true);
          for (const q of all) if (q !== p && q.instanceColor) expect(d.bound.some(b => holdsExactly(b, q.instanceColor!.array)), `${p.name}: ${q.name}'s colours are NOT bound`).toBe(false);
        }
      }
    }
  }
}

describe('the switch and the signature (render/sharedInstancing.ts)', () => {
  it('?instshare=off is the kill switch, ?instshare=on shares everywhere, anything else leaves the level\'s choice', () => {
    expect(sharedInstancingOverride('?instshare=off')).toBe('off');
    expect(sharedInstancingOverride('?quality=low&instshare=0')).toBe('off');
    expect(sharedInstancingOverride('?instshare=on')).toBe('on');
    expect(sharedInstancingOverride('?instshare=1')).toBe('on');
    expect(sharedInstancingOverride('?instshare=maybe')).toBeNull();
    expect(sharedInstancingOverride('')).toBeNull();
    overrideSharedInstancing(null);
    setSharedInstancing(true);
    expect(sharedInstancing()).toBe(true);
    setSharedInstancing(false);
    expect(sharedInstancing()).toBe(false);
    overrideSharedInstancing('on');
    expect(sharedInstancing()).toBe(true);
    overrideSharedInstancing('off');
    setSharedInstancing(true);
    expect(sharedInstancing()).toBe(false);
  });

  it('the signature holds what three\'s instancing reads from the object; anything else keeps three\'s own key', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();
    const plain = new THREE.InstancedMesh(geo, mat, 2);
    const sig = instancingSignature(plain);
    expect(sig).toMatch(/^shared-instancing:/);
    expect(instancingSignature(new THREE.InstancedMesh(geo, mat, 900))).toBe(sig); // (the count is not part of an attribute-path build)
    const coloured = new THREE.InstancedMesh(geo, mat, 2);
    coloured.setColorAt(0, new THREE.Color(1, 0, 0));
    expect(instancingSignature(coloured)).not.toBe(sig);
    const dynamic = new THREE.InstancedMesh(geo, mat, 2);
    dynamic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    expect(instancingSignature(dynamic)).not.toBe(sig);
    const dynColour = new THREE.InstancedMesh(geo, mat, 2);
    dynColour.setColorAt(0, new THREE.Color(1, 0, 0));
    dynColour.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    expect(new Set([sig, instancingSignature(coloured), instancingSignature(dynamic), instancingSignature(dynColour)]).size).toBe(4);
    expect(instancingSignature(new THREE.Mesh(geo, mat))).toBeNull();
    expect(instancingSignature(new THREE.Sprite())).toBeNull();
    expect(instancingSignature(null)).toBeNull();
    const storage = new THREE.InstancedMesh(geo, mat, 2);
    (storage.instanceMatrix as unknown as {isStorageInstancedBufferAttribute: boolean}).isStorageInstancedBufferAttribute = true;
    expect(instancingSignature(storage)).toBeNull();
    const morphGeo = new THREE.BoxGeometry(1, 1, 1);
    morphGeo.morphAttributes.position = [morphGeo.attributes.position.clone() as THREE.BufferAttribute];
    expect(instancingSignature(new THREE.InstancedMesh(morphGeo, mat, 2))).toBeNull();
  });

  it('the material\'s part of the signature: WHICH texture slots hold one texture (nothing when every slot has its own)', () => {
    const tex = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const a = tex(), b = tex(), c = tex();
    const packed = textureSlotSignature(new THREE.MeshStandardMaterial({map: a, roughnessMap: b, metalnessMap: b}));
    expect(packed).not.toBe('');
    // a texture per slot, no texture at all, nothing to read: no part (the key is three's own with the object's signature)
    expect(textureSlotSignature(new THREE.MeshStandardMaterial({map: a, roughnessMap: b, metalnessMap: c}))).toBe('');
    expect(textureSlotSignature(new THREE.MeshStandardMaterial({map: a, roughnessMap: b, metalnessMap: b.clone()}))).toBe(''); // (a clone is another texture)
    expect(textureSlotSignature(new THREE.MeshStandardMaterial())).toBe('');
    expect(textureSlotSignature(null)).toBe('');
    expect(textureSlotSignature(undefined)).toBe('');
    // which TEXTURE it is does not matter (three's key does not hold it either), which SLOTS do
    expect(textureSlotSignature(new THREE.MeshStandardMaterial({map: c, roughnessMap: a, metalnessMap: a}))).toBe(packed);
    expect(textureSlotSignature(new THREE.MeshStandardMaterial({map: a, roughnessMap: a, metalnessMap: b}))).not.toBe(packed);
    expect(textureSlotSignature(new THREE.MeshStandardMaterial({map: a, roughnessMap: a, metalnessMap: a}))).not.toBe(packed);
  });
});

describe('WebGPU: pools of one material share a node build and draw their own instances', () => {
  it('three alone (switch off): one build per pool and pass; the recorder sees every pool\'s own data (the baseline)', async () => {
    const s = await build('webgpu', {share: false});
    for (let i = 0; i < 2; i++) s.frame();
    expect(instancedBuilds(s, false).length).toBe(7);
    expect(instancedBuilds(s, true).length).toBe(7);
    expect(new Set(instancedBuilds(s, false).map(b => b.object)).size).toBe(7);
    // (three's uniform-buffer path here: the matrices are not vertex data at all, so only the instance counts are judged)
    for (const p of Object.values(s.pools)) for (const d of drawsOf(s, p, false)) expect(d.instances).toBe(p.count);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  it('three alone on the attribute path (the mall\'s switch): still one build per pool, own data bound', async () => {
    const s = await build('webgpu', {share: false, attribute: true});
    expect(attributeInstancing()).toBe(true);
    for (let i = 0; i < 2; i++) s.frame();
    expect(instancedBuilds(s, false).length).toBe(7);
    expect(instancedBuilds(s, true).length).toBe(7);
    expectOwnData(s);
    expect(s.log!.issues).toEqual([]);
  }, 120_000);

  it('shared: one build per material variant; every pool is bound to its own matrices and colours in both passes', async () => {
    const before = {...sharedInstancingStats};
    const s = await build('webgpu', {share: true});
    for (let i = 0; i < 2; i++) s.frame();
    // scene pass: steel (a, bb, twin: value-equal materials, static, no colour) / steel + instance colour (coloured, coloured-2) /
    // steel with a dynamic matrix buffer / glass
    const sceneBuilds = instancedBuilds(s, false), shadowBuilds = instancedBuilds(s, true);
    expect(sceneBuilds.length).toBe(4);
    expect(shadowBuilds.length).toBeLessThanOrEqual(4);
    expect(shadowBuilds.length).toBeGreaterThan(0);
    expectOwnData(s);
    // the pools of a group really draw with ONE build, and with bindings of their own
    const ro = (k: string) => s.ros().get(s.pools[k])!;
    expect(ro('a').scene!.getNodeBuilderState()).toBe(ro('b').scene!.getNodeBuilderState());
    expect(ro('a').scene!.getNodeBuilderState()).toBe(ro('twin').scene!.getNodeBuilderState());
    expect(ro('coloured').scene!.getNodeBuilderState()).toBe(ro('coloured2').scene!.getNodeBuilderState());
    expect(ro('a').scene!.getNodeBuilderState()).not.toBe(ro('coloured').scene!.getNodeBuilderState());
    expect(ro('a').scene!.getNodeBuilderState()).not.toBe(ro('dynamic').scene!.getNodeBuilderState());
    expect(ro('a').scene!.getNodeBuilderState()).not.toBe(ro('glass').scene!.getNodeBuilderState());
    expect(ro('a').shadow!.getNodeBuilderState()).toBe(ro('b').shadow!.getNodeBuilderState());
    expect(ro('a').scene!.getBindings()).not.toBe(ro('b').scene!.getBindings());
    for (const k of Object.keys(s.pools)) { expect(isSharedRenderObject(ro(k).scene!)).toBe(true); expect(isSharedRenderObject(ro(k).shadow!)).toBe(true); }
    expect(isSharedRenderObject(s.ros().get(s.ground)!.scene!)).toBe(false);
    // one GPU buffer per pool for its matrices, whatever the pass (the scene and the shadow render object name the same buffer)
    for (const k of Object.keys(s.pools)) {
      const own = (r: RO) => r.getVertexBuffers().filter(b => b.isInstancedInterleavedBuffer === true);
      expect(own(ro(k).scene!).length).toBe(1);
      expect(own(ro(k).scene!)[0].array).toBe(s.pools[k].instanceMatrix.array);
      expect(own(ro(k).shadow!)[0]).toBe(own(ro(k).scene!)[0]);
    }
    expect(sharedInstancingStats.shared - before.shared).toBe(14); // (7 pools x scene + shadow)
    expect(sharedInstancingStats.matrixBuffers - before.matrixBuffers).toBe(7);
    expect(sharedInstancingStats.colorBuffers - before.colorBuffers).toBe(2);
    expect(sharedInstancingStats.missingTemplate - before.missingTemplate).toBe(0);
    // WebGPU's default limits: 8 vertex buffers, 16 vertex attributes per pipeline
    expect(s.rec!.layouts.length).toBeGreaterThan(0);
    expect(Math.max(...s.rec!.layouts.map(l => l.buffers))).toBeLessThanOrEqual(8);
    expect(Math.max(...s.rec!.layouts.map(l => l.attributes))).toBeLessThanOrEqual(16);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  it('shared: an instance moved (and recoloured) after the build reaches ITS pool\'s buffer — the first mesh of a build and a later one', async () => {
    const s = await build('webgpu', {share: true});
    for (let i = 0; i < 2; i++) s.frame();
    const n = s.builds.length;
    const m = new THREE.Matrix4();
    const move = (p: THREE.InstancedMesh, i: number, x: number) => { p.setMatrixAt(i, m.makeTranslation(x, 2.5, -0.5)); p.instanceMatrix.needsUpdate = true; };
    // which mesh a build was made from is the draw order's business: move one pool of each group, then the other, then both
    move(s.pools.b, 1, 1.75);
    s.frame();
    expectOwnData(s);
    move(s.pools.a, 2, -1.25);
    s.frame();
    expectOwnData(s);
    move(s.pools.twin, 0, 0.5); move(s.pools.coloured2, 1, 2.25); move(s.pools.dynamic, 3, 3.5);
    s.pools.coloured.setColorAt(2, new THREE.Color(0.1, 0.9, 0.2)); s.pools.coloured.instanceColor!.needsUpdate = true;
    s.pools.coloured2.setColorAt(0, new THREE.Color(0.9, 0.1, 0.7)); s.pools.coloured2.instanceColor!.needsUpdate = true;
    s.frame();
    expectOwnData(s);
    // a dynamic pool written without a version bump still reaches the GPU (three uploads dynamic buffers on every render)
    s.pools.dynamic.setMatrixAt(5, m.makeTranslation(4.5, 2, 2));
    s.pools.dynamic.instanceMatrix.needsUpdate = true;
    s.frame();
    expectOwnData(s);
    // a smaller instance count is the draw's, not the build's
    s.pools.b.count = 2;
    s.frame();
    expect(drawsOf(s, s.pools.b, false).every(d => d.instances === 2)).toBe(true);
    s.pools.b.count = 5;
    s.frame();
    expectOwnData(s);
    expect(s.builds.length, 'nothing was built after the first frames').toBe(n);
    expect(s.log!.issues).toEqual([]);
  }, 120_000);

  it('shared: compileAsync (the loading warm-up\'s path) builds one per variant too, and the frames after it build nothing', async () => {
    const s = await build('webgpu', {share: true});
    await s.compile();
    expect(instancedBuilds(s, false).length).toBe(4);
    const n = instancedBuilds(s, false).length;
    for (let i = 0; i < 2; i++) s.frame();
    expect(instancedBuilds(s, false).length, 'the scene pass builds nothing after compileAsync').toBe(n);
    expectOwnData(s);
    expect(s.log!.issues).toEqual([]);
  }, 120_000);

  it('shared: a pool added later (a new station\'s) joins the existing build; the kill switch leaves later pools on three\'s keyed path', async () => {
    const s = await build('webgpu', {share: true});
    for (let i = 0; i < 2; i++) s.frame();
    const n = s.builds.length;
    const late = pool('late', s.pools.a.geometry, s.pools.a.material as THREE.Material, 9, new THREE.Vector3(2, 0.2, 1));
    s.pools.late = late;
    s.pools.a.parent!.add(late);
    s.frame();
    expect(s.builds.length, 'a later pool of a built variant builds nothing').toBe(n);
    expectOwnData(s);
    overrideSharedInstancing('off');
    const keyedPool = pool('keyed', s.pools.a.geometry, s.pools.a.material as THREE.Material, 4, new THREE.Vector3(2, 0.2, 2));
    s.pools.a.parent!.add(keyedPool);
    s.frame();
    expect(s.builds.length, 'with the kill switch a new pool is built on its own (scene + shadow)').toBe(n + 2);
    expect(isSharedRenderObject(s.ros().get(keyedPool)!.scene!)).toBe(false);
    expectOwnData(s); // (what was built shared keeps drawing its own data)
    expect(s.log!.issues).toEqual([]);
  }, 120_000);
});

describe('a pool with no room for the instance attributes keeps three\'s uniform-buffer path (render/instancing.ts instanceAttributesFit)', () => {
  it('the rule: one more buffer and four more attributes (+ one each for colours) must fit 8 buffers / 16 attributes', () => {
    expect(VERTEX_LIMITS).toEqual({buffers: 8, attributes: 16});
    const mat = new THREE.MeshStandardMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1); // position, normal, uv
    expect(instanceAttributesFit(new THREE.InstancedMesh(box, mat, 2))).toBe(true);
    const withN = (n: number) => { const g = new THREE.BoxGeometry(1, 1, 1); for (let i = 0; i < n; i++) g.setAttribute(`a${i}`, new THREE.InstancedBufferAttribute(new Float32Array(6), 3)); return g; };
    expect(instanceAttributesFit(new THREE.InstancedMesh(withN(4), mat, 2))).toBe(true); // 7 + 1 = 8 buffers
    expect(instanceAttributesFit(new THREE.InstancedMesh(withN(5), mat, 2))).toBe(false); // 8 + 1 = 9
    const coloured = new THREE.InstancedMesh(withN(4), mat, 2);
    coloured.setColorAt(0, new THREE.Color(1, 0, 0));
    expect(instanceAttributesFit(coloured)).toBe(false); // 7 + 1 + 1 = 9
    // interleaved attributes share ONE buffer: 13 attributes in one buffer + 4 = 17 attributes
    const il = new THREE.BufferGeometry(), data = new THREE.InterleavedBuffer(new Float32Array(26), 13);
    for (let i = 0; i < 12; i++) il.setAttribute(i === 0 ? 'position' : `a${i}`, new THREE.InterleavedBufferAttribute(data, 1, i));
    expect(instanceAttributesFit(new THREE.InstancedMesh(il, mat, 2))).toBe(true); // 1 + 1 buffers, 12 + 4 attributes
    il.setAttribute('a12', new THREE.InterleavedBufferAttribute(data, 1, 12));
    expect(instanceAttributesFit(new THREE.InstancedMesh(il, mat, 2))).toBe(false); // 13 + 4 attributes
    expect(instancingSignature(new THREE.InstancedMesh(withN(5), mat, 2))).toBeNull();
    expect(instancingSignature(new THREE.InstancedMesh(withN(4), mat, 2))).not.toBeNull();
  });

  for (const mode of ['attribute switch (the mall / Reactor)', 'shared builds'] as const) {
    // The real case: the game's own crater pool (damage/craters.ts CraterField, mesh and material named 'damage-craters'), in the
    // scene on every level. Three geometry buffers + five per-crater instanced ones = 8, the most one WebGPU pipeline binds; the
    // attribute path would make it 9. The devices of these tests do not enforce the limit, so the test counts the pipeline's buffers.
    it(`'damage-craters', the bullet-crater pool (8 vertex buffers of its own), under the ${mode}: its pipeline stays at 8`, async () => {
      const s = await build('webgpu', mode === 'shared builds' ? {share: true} : {share: false, attribute: true});
      const craters = new CraterField();
      expect(craters.mesh.name).toBe('damage-craters');
      expect((craters.mesh.material as THREE.Material).name).toBe('damage-craters');
      expect(Object.keys(craters.mesh.geometry.attributes).length).toBe(8);
      expect(instanceAttributesFit(craters.mesh)).toBe(false);
      craters.mesh.count = 2;
      s.scene.add(craters.mesh);
      const before = s.rec!.layouts.length;
      for (let i = 0; i < 2; i++) s.frame();
      expect(s.ros().get(craters.mesh)?.scene, 'the crater pool is drawn').toBeDefined();
      expect(isSharedRenderObject(s.ros().get(craters.mesh)!.scene!)).toBe(false);
      expect(s.rec!.layouts.length).toBeGreaterThan(before);
      expect(Math.max(...s.rec!.layouts.map(l => l.buffers))).toBe(8); // (the crater pipeline; never 9)
      expect(Math.max(...s.rec!.layouts.map(l => l.attributes))).toBeLessThanOrEqual(16);
      expectOwnData(s); // (the other pools are untouched by it)
      expect(s.log!.issues).toEqual([]);
      craters.dispose();
    }, 120_000);
  }
});

/** A station's pools: their own meshes, two of them on ONE geometry that outlives the station (the game's shared geometries). */
function stationPools(s: Scene, n: number, sharedGeo: THREE.BufferGeometry): Record<string, THREE.InstancedMesh> {
  const {steel, glass} = s.materials;
  const at = (z: number) => new THREE.Vector3(-3 + n * 0.37, 0.2, z + n * 0.11);
  const own = () => new THREE.BoxGeometry(0.3, 0.3, 0.3);
  return {
    a: pool(`s${n}-a`, sharedGeo, steel, 3 + n, at(0)),
    b: pool(`s${n}-b`, sharedGeo, steel, 5, at(1)),
    c: pool(`s${n}-c`, own(), steel, 4, at(2)),
    coloured: pool(`s${n}-coloured`, own(), steel, 4, at(-1), {colour: true}),
    dynamic: pool(`s${n}-dynamic`, own(), steel, 6, at(3), {dynamic: true}),
    glass: pool(`s${n}-glass`, own(), glass, 3, at(-2)),
  };
}
/** The GPU buffer that held `p`'s matrices in its last scene-pass draw. */
function matrixGpuBuffer(s: Scene, p: THREE.InstancedMesh): GpuBuffer {
  const d = drawsOf(s, p, false)[0];
  const i = d.bound.findIndex(b => holdsExactly(b, p.instanceMatrix.array));
  expect(i, `${p.name}: a bound buffer holds its matrices`).toBeGreaterThanOrEqual(0);
  return d.buffers[i];
}

describe('lifetime: a station change (the build\'s first mesh goes, later pools keep the build)', () => {
  it('WebGPU: old geometries destroyed at once, old meshes disposed after the next station is warm — the new pools draw their own bytes, no destroyed buffer is used, nothing grows over four stations', async () => {
    const s = await build('webgpu', {share: true, empty: true});
    const sharedGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    let cur = stationPools(s, 1, sharedGeo);
    for (const p of Object.values(cur)) s.scene.add(p);
    s.pools = cur;
    for (let i = 0; i < 2; i++) s.frame();
    expectOwnData(s);
    const state = (p: THREE.InstancedMesh, pass: 'scene' | 'shadow' = 'scene') => s.ros().get(p)![pass]!.getNodeBuilderState();
    // station 1's builds: every one of them was made from a station-1 mesh (there was nothing else to make it from)
    const kept = {steel: state(cur.a), steelShadow: state(cur.a, 'shadow'), coloured: state(cur.coloured), dynamic: state(cur.dynamic), glass: state(cur.glass)};
    expect(state(cur.b)).toBe(kept.steel);
    expect(state(cur.c)).toBe(kept.steel);
    const builds1 = s.builds.length;
    const sizes: {cache: number; live: {all: number; vertex: number}}[] = [];
    const releasedBefore = sharedInstancingStats.released;
    for (let n = 2; n <= 4; n++) {
      const old = cur, oldGpu = new Map(Object.values(old).map(p => [p, matrixGpuBuffer(s, p)] as const));
      // LEAVE (Game.leaveSection): the old pools leave the scene and their own geometries are destroyed right away; the meshes
      // themselves wait for the next warm-up to finish
      for (const p of Object.values(old)) { s.scene.remove(p); if (p.geometry !== sharedGeo) p.geometry.dispose(); }
      cur = stationPools(s, n, sharedGeo);
      for (const p of Object.values(cur)) s.scene.add(p);
      s.pools = cur;
      // the new station is warmed and drawn while the old meshes still exist
      await s.compile();
      for (let i = 0; i < 2; i++) s.frame();
      expectOwnData(s);
      expect(state(cur.a), `station ${n}: its steel pools draw with the build made from a station-1 mesh`).toBe(kept.steel);
      expect(state(cur.a, 'shadow')).toBe(kept.steelShadow);
      expect([state(cur.coloured), state(cur.dynamic), state(cur.glass)]).toEqual([kept.coloured, kept.dynamic, kept.glass]);
      // (a pool on the shared geometry still has its instance buffer: nothing has disposed that mesh yet)
      expect(oldGpu.get(old.a)!.destroyed).toBe(false);
      // RETIRE: the old station's meshes are disposed
      for (const p of Object.values(old)) p.dispose();
      for (const [p, b] of oldGpu) expect(b.destroyed, `${p.name}: its instance buffer is destroyed with the mesh`).toBe(true);
      for (let i = 0; i < 3; i++) s.frame();
      expectOwnData(s);
      // no pool of this station is bound to a buffer of a station that is gone
      for (const d of s.lastDraws) for (const b of d.buffers) expect(b.destroyed === true, `${d.object.name}: a destroyed buffer is bound`).toBe(false);
      for (const d of s.lastDraws) for (const o of Object.values(old)) expect(d.bound.some(b => holdsExactly(b, o.instanceMatrix.array)), `${d.object.name}: ${o.name}'s matrices are bound`).toBe(false);
      expect(s.builds.length, `station ${n} built nothing`).toBe(builds1);
      sizes.push({cache: s.cacheSize(), live: s.rec!.live()});
    }
    // what the device and the node manager hold after station 3 and after station 4 is what they held after station 2
    expect(sizes[1]).toEqual(sizes[0]);
    expect(sizes[2]).toEqual(sizes[0]);
    expect(sharedInstancingStats.released, 'instance buffers were released by the mesh disposals').toBeGreaterThan(releasedBefore);
    expect(sharedInstancingStats.releaseErrors).toBe(0);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 180_000);

  it('WebGPU: a pool whose geometry is replaced (the old one destroyed) and a pool disposed while still in the scene get new buffers with their own bytes', async () => {
    const s = await build('webgpu', {share: true});
    const solo = pool('solo', new THREE.BoxGeometry(0.3, 0.3, 0.3), s.materials.steel, 4, new THREE.Vector3(1, 0.2, 2));
    s.pools.solo = solo;
    s.scene.add(solo);
    for (let i = 0; i < 2; i++) s.frame();
    const n = s.builds.length;
    const g0 = solo.geometry, b0 = matrixGpuBuffer(s, solo);
    solo.geometry = new THREE.BoxGeometry(0.4, 0.2, 0.4);
    g0.dispose(); // (three destroys the instance buffer with the geometry of the render object that first drew it)
    for (let i = 0; i < 2; i++) s.frame();
    expectOwnData(s);
    expect(b0.destroyed).toBe(true);
    expect(matrixGpuBuffer(s, solo)).not.toBe(b0);
    expect(matrixGpuBuffer(s, solo).destroyed).toBe(false);
    // a mesh disposed while it stays in the scene: three makes it new render objects, and it gets new instance buffers
    const a0 = matrixGpuBuffer(s, s.pools.a);
    s.pools.a.dispose();
    expect(a0.destroyed).toBe(true);
    expect(releaseInstanceBuffers(s.pools.a), 'nothing is left to release').toBe(0);
    for (let i = 0; i < 2; i++) s.frame();
    expectOwnData(s);
    expect(matrixGpuBuffer(s, s.pools.a).destroyed).toBe(false);
    expect(s.builds.length, 'neither needed a build (their variant\'s build is still in use by other pools)').toBe(n);
    for (const d of s.lastDraws) for (const b of d.buffers) expect(b.destroyed === true).toBe(false);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  it('WebGPU: two pools on ONE instanceColor attribute (the Reactor\'s lamp glass draws with the tubes\' colours) share its buffer, and it is released with the last of them', async () => {
    const s = await build('webgpu', {share: true});
    const tubes = pool('tubes', s.geometries.box, s.materials.steel, 5, new THREE.Vector3(1, 0.2, -1), {colour: true});
    const lens = pool('lens', s.geometries.tall, s.materials.steel, 5, new THREE.Vector3(1, 0.5, -2));
    lens.instanceColor = tubes.instanceColor;
    s.scene.add(tubes, lens);
    for (let i = 0; i < 2; i++) s.frame();
    const colours = tubes.instanceColor!;
    const bound = (p: THREE.InstancedMesh, a: THREE.InstancedBufferAttribute): GpuBuffer | null => {
      const d = drawsOf(s, p, false)[0], i = d.bound.findIndex(b => holdsExactly(b, a.array));
      return i < 0 ? null : d.buffers[i];
    };
    const gpu = bound(tubes, colours);
    expect(gpu, 'the tubes draw with their colours').not.toBeNull();
    expect(bound(lens, colours), 'the lens draws with the SAME buffer').toBe(gpu);
    expect(bound(tubes, tubes.instanceMatrix)).not.toBe(bound(lens, lens.instanceMatrix));
    // a colour written through the one attribute reaches both draws
    tubes.setColorAt(1, new THREE.Color(0.2, 0.7, 0.1));
    colours.needsUpdate = true;
    s.frame();
    expect([bound(tubes, colours), bound(lens, colours)]).toEqual([gpu, gpu]);
    // the tubes go; the lens still draws with the colours
    const tubesMatrices = bound(tubes, tubes.instanceMatrix)!;
    s.scene.remove(tubes);
    tubes.dispose();
    expect(tubesMatrices.destroyed).toBe(true);
    expect(gpu!.destroyed, 'the lens still uses it').toBe(false);
    lens.setColorAt(3, new THREE.Color(0.9, 0.2, 0.2));
    colours.needsUpdate = true;
    for (let i = 0; i < 2; i++) s.frame();
    expect(bound(lens, colours)).toBe(gpu);
    expect(bound(lens, lens.instanceMatrix)).not.toBeNull();
    expectOwnData(s);
    // the last user goes
    s.scene.remove(lens);
    lens.dispose();
    expect(gpu!.destroyed).toBe(true);
    s.frame();
    expect(sharedInstancingStats.releaseErrors).toBe(0);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  it('WebGL 2: the same station change — later pools name their own arrays, the builds are kept, nothing throws', async () => {
    const s = await build('webgl2', {share: true, empty: true});
    const sharedGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    let cur = stationPools(s, 1, sharedGeo);
    for (const p of Object.values(cur)) s.scene.add(p);
    s.pools = cur;
    for (let i = 0; i < 2; i++) s.frame();
    const builds1 = s.builds.length, cache1 = s.cacheSize();
    for (let n = 2; n <= 4; n++) {
      const old = cur;
      for (const p of Object.values(old)) { s.scene.remove(p); if (p.geometry !== sharedGeo) p.geometry.dispose(); }
      cur = stationPools(s, n, sharedGeo);
      for (const p of Object.values(cur)) s.scene.add(p);
      s.pools = cur;
      await s.compile();
      for (let i = 0; i < 2; i++) s.frame();
      for (const p of Object.values(old)) p.dispose();
      for (let i = 0; i < 2; i++) s.frame();
      for (const p of Object.values(cur)) {
        const draws = drawsOf(s, p, false);
        expect(draws.length, `${p.name} is drawn`).toBeGreaterThan(0);
        const mats = draws[0].ro.getVertexBuffers().filter(b => b.isInstancedInterleavedBuffer === true);
        expect(mats.length).toBe(1);
        expect(mats[0].array).toBe(p.instanceMatrix.array);
      }
      expect(s.builds.length, `station ${n} built nothing`).toBe(builds1);
      expect(s.cacheSize()).toBe(cache1);
    }
    expect(sharedInstancingStats.releaseErrors).toBe(0);
  }, 180_000);
});

describe('what a build is keyed by besides the material (three\'s own key, kept)', () => {
  it('receiveShadow is part of the key; castShadow is not (the pool only leaves the shadow pass); a flagged-for-velocity, a morphed and a skinned mesh stay on three\'s path', async () => {
    const s = await build('webgpu', {share: true});
    const {steel} = s.materials, {box} = s.geometries;
    const noReceive = pool('no-receive', box, steel, 3, new THREE.Vector3(1, 0.2, 0));
    noReceive.receiveShadow = false;
    const noCast = pool('no-cast', box, steel, 4, new THREE.Vector3(1, 0.2, 1));
    noCast.castShadow = false;
    const velocity = pool('velocity', box, steel, 2, new THREE.Vector3(1, 0.2, 2));
    const W = await import('three/webgpu');
    (W.NodeUtils as unknown as {getDataFromObject(o: object): {useVelocity?: boolean}}).getDataFromObject(velocity).useVelocity = true;
    const morphGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    morphGeo.morphAttributes.position = [new THREE.Float32BufferAttribute(Array.from(morphGeo.attributes.position.array, v => v * 1.5), 3)];
    morphGeo.morphTargetsRelative = true;
    const morph = pool('morph', morphGeo, steel, 2, new THREE.Vector3(1, 0.2, 3));
    // (an InstancedMesh morphs per instance, from its morph texture: InstancedMesh.setMorphAt)
    const morphSource = new THREE.Mesh(morphGeo, steel);
    morphSource.morphTargetInfluences![0] = 0.5;
    for (let i = 0; i < morph.count; i++) morph.setMorphAt(i, morphSource);
    const skinGeo = new THREE.BoxGeometry(0.3, 0.9, 0.3), nv = skinGeo.attributes.position.count;
    skinGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(nv * 4), 4));
    skinGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from({length: nv * 4}, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const skinned = new THREE.SkinnedMesh(skinGeo, steel);
    const bone = new THREE.Bone();
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    skinned.position.set(2, 0.5, 0);
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.frustumCulled = false;
    Object.assign(s.pools, {noReceive, noCast}); // (velocity / morph / skinned: three's uniform-buffer path — no instance vertex data to judge)
    s.scene.add(noReceive, noCast, velocity, morph, skinned);
    for (let i = 0; i < 2; i++) s.frame();
    const ro = (o: THREE.Object3D) => s.ros().get(o)!;
    const steelState = ro(s.pools.a).scene!.getNodeBuilderState();
    // receiveShadow: its own build (three's key holds it), still on the shared path and bound to its own data
    expect(isSharedRenderObject(ro(noReceive).scene!)).toBe(true);
    expect(ro(noReceive).scene!.getNodeBuilderState()).not.toBe(steelState);
    // castShadow: the scene build is the receivers' one; the pool is simply not in the shadow pass
    expect(ro(noCast).scene!.getNodeBuilderState()).toBe(steelState);
    expect(ro(noCast).shadow).toBeUndefined();
    expect(drawsOf(s, noCast, true).length).toBe(0);
    // previous-frame data, morph targets, a skinned mesh: three's own keyed builds
    for (const o of [velocity, morph, skinned]) {
      expect(ro(o).scene, `${o.name || 'skinned'} is drawn`).toBeDefined();
      expect(isSharedRenderObject(ro(o).scene!), `${o.name || 'skinned'} keeps three's key`).toBe(false);
      expect(ro(o).scene!.getNodeBuilderState()).not.toBe(steelState);
    }
    expect(instancingSignature(skinned)).toBeNull();
    expectOwnData(s, [false]);
    for (const p of Object.values(s.pools)) if (p !== noCast) for (const d of drawsOf(s, p, true)) expect(d.bound.some(b => holdsExactly(b, p.instanceMatrix.array)), `${p.name} (shadow)`).toBe(true);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  it('two texture slots on ONE texture get a single binding, and three\'s key does not say so: the pools of such a material never share a build with a texture-per-slot one', async () => {
    const s = await build('webgpu', {share: true, empty: true});
    const {box, tall} = s.geometries;
    const tex = (v: number) => { const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1); t.needsUpdate = true; return t; };
    const copy = (t: THREE.Texture) => { const c = t.clone(); c.needsUpdate = true; return c; };
    const colour = tex(200), orm = tex(120);
    // equal in everything three keys a build by (the same slots filled, the same samplers): a packed roughness / metalness map — and a
    // texture per slot (world/materials.ts thinTrim leaves the Reactor's steel with one clone of its packed map per slot)
    const packed = new THREE.MeshStandardMaterial({map: colour, roughnessMap: orm, metalnessMap: orm, name: 'packed'});
    const packedTwin = new THREE.MeshStandardMaterial({map: tex(90), roughnessMap: colour, metalnessMap: colour, name: 'packed-twin'});
    const perSlot = new THREE.MeshStandardMaterial({map: colour, roughnessMap: copy(orm), metalnessMap: copy(orm), name: 'per-slot'});
    const perSlotTwin = new THREE.MeshStandardMaterial({map: tex(60), roughnessMap: tex(30), metalnessMap: tex(10), name: 'per-slot-twin'});
    const pools = {
      packed: pool('packed', box, packed, 3, new THREE.Vector3(-1, 0.2, 0)),
      packedTwin: pool('packed-twin', tall, packedTwin, 4, new THREE.Vector3(-1, 0.5, 1)),
      perSlot: pool('per-slot', box, perSlot, 5, new THREE.Vector3(-1, 0.2, 2)),
      perSlotTwin: pool('per-slot-twin', tall, perSlotTwin, 2, new THREE.Vector3(-1, 0.5, 3)),
    };
    Object.assign(s.pools, pools);
    // three's own rule, on plain meshes (no instancing in it): ONE build for the two kinds of material, whichever is drawn first
    const plain = [packed, perSlot].map((m, i) => { const o = new THREE.Mesh(box, m); o.position.set(2, 0.2, i); o.frustumCulled = false; return o; });
    s.scene.add(...Object.values(pools), ...plain);
    for (let i = 0; i < 2; i++) s.frame();
    const ro = (o: THREE.Object3D) => s.ros().get(o)!.scene!;
    const state = (o: THREE.Object3D) => ro(o).getNodeBuilderState() as {fragmentShader: string};
    const textures = (o: THREE.Object3D) => (state(o).fragmentShader.match(/:\s*texture_2d<\s*f32\s*>/g) ?? []).length;
    expect(state(plain[1]), 'three: plain meshes of the two materials share one build').toBe(state(plain[0]));
    for (const p of Object.values(pools)) expect(isSharedRenderObject(ro(p)), `${p.name} is on the shared path`).toBe(true);
    // shared builds: one per kind — the twins join their kind's build, the two kinds stay apart
    expect(state(pools.packedTwin)).toBe(state(pools.packed));
    expect(state(pools.perSlotTwin)).toBe(state(pools.perSlot));
    expect(state(pools.perSlot)).not.toBe(state(pools.packed));
    expect(instancedBuilds(s, false).length).toBe(2);
    // and each kind's text has its own bindings: one texture for the packed map, one per slot otherwise (besides the colour map and
    // whatever three itself samples for a standard material)
    expect(textures(pools.packed)).toBeGreaterThanOrEqual(2);
    expect(textures(pools.perSlot) - textures(pools.packed)).toBe(1);
    expect(textures(pools.packedTwin)).toBe(textures(pools.packed));
    expectOwnData(s);
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 120_000);

  for (const share of [true, false]) {
    it(`a pool's own onBeforeRender, its count and its frustum culling are the draw's, not the build's (shared builds ${share ? 'on' : 'off: the same calls and draws'})`, async () => {
      const s = await build('webgpu', {share, attribute: !share});
      const calls = new Map<THREE.Object3D, number>();
      const m = new THREE.Matrix4();
      let tick = 0;
      // two pools of ONE build with hooks of their own: each moves one of ITS instances before its draw
      for (const [p, i] of [[s.pools.a, 1], [s.pools.b, 3]] as const) {
        p.onBeforeRender = () => {
          calls.set(p, (calls.get(p) ?? 0) + 1);
          p.setMatrixAt(i, m.makeTranslation(i + tick * 0.125, 2.25, -1.5));
          p.instanceMatrix.needsUpdate = true;
        };
      }
      // a pool behind the camera: frustum-culled until it is told not to be
      const behind = pool('behind', s.geometries.box, s.materials.steel, 3, new THREE.Vector3(0, 0.2, 40));
      behind.frustumCulled = true;
      s.scene.add(behind);
      for (tick = 1; tick <= 3; tick++) {
        calls.clear();
        s.frame();
        // three calls the hook before every draw of the pool (the shadow pass draws through the same renderObject call)
        const drawn = (p: THREE.InstancedMesh) => drawsOf(s, p, false).length + drawsOf(s, p, true).length;
        expect([calls.get(s.pools.a), calls.get(s.pools.b)]).toEqual([drawn(s.pools.a), drawn(s.pools.b)]);
        expect(drawsOf(s, s.pools.a, false).length).toBeGreaterThan(0);
        expectOwnData(s, [false]); // (the instance each hook moved is in the bytes bound for that very draw)
        expect(drawsOf(s, behind, false).length, 'culled: not drawn').toBe(0);
      }
      const n = s.builds.length;
      behind.frustumCulled = false;
      s.pools.behind = behind;
      s.pools.coloured.count = 1;
      s.frame();
      expect(drawsOf(s, behind, false).length).toBeGreaterThan(0);
      expect(drawsOf(s, s.pools.coloured, false).every(d => d.instances === 1)).toBe(true);
      s.pools.coloured.count = 6;
      s.frame();
      expectOwnData(s, [false]);
      // the culled pool's first draw: no build with shared builds (its variant exists); three alone builds it (scene + shadow)
      expect(s.builds.length - n).toBe(share ? 0 : 2);
      expect(s.log!.issues).toEqual([]);
    }, 120_000);
  }

  it('the attribute switch (mall / Reactor) with shared builds on top: the same shader texts and vertex layouts as the switch alone, one build per variant, no second patch of the builder', async () => {
    const W = await import('three/webgpu');
    const limit = () => (W.NodeBuilder.prototype as unknown as {getUniformBufferLimit: unknown}).getUniformBufferLimit;
    const alone = await build('webgpu', {share: false, attribute: true});
    const patched = limit();
    for (let i = 0; i < 2; i++) alone.frame();
    const both = await build('webgpu', {share: true, attribute: true});
    for (let i = 0; i < 2; i++) both.frame();
    const sharedOnly = await build('webgpu', {share: true});
    for (let i = 0; i < 2; i++) sharedOnly.frame();
    expect(limit(), 'the builder\'s limit hook is installed once').toBe(patched);
    expect(instancedBuilds(alone, false).length).toBe(7);
    expect(instancedBuilds(both, false).length).toBe(4);
    expect(instancedBuilds(sharedOnly, false).length).toBe(4);
    expectOwnData(both);
    expectOwnData(sharedOnly);
    // the shader modules the device was given: exactly the same texts (the pools of a variant already had one text on the attribute path)
    const texts = (s: Scene) => [...s.rec!.modules.all].sort();
    expect(texts(both)).toEqual(texts(alone));
    expect(texts(sharedOnly)).toEqual(texts(alone));
    // and the same pipelines: as many, with the same vertex layouts and front faces
    const pipes = (s: Scene) => s.rec!.layouts.map(l => `${l.buffers}/${l.attributes}/${l.frontFace}`).sort();
    expect(pipes(both)).toEqual(pipes(alone));
    expect(pipes(sharedOnly)).toEqual(pipes(alone));
    for (const s of [alone, both, sharedOnly]) expect(s.log!.issues).toEqual([]);
  }, 180_000);
});

describe('the loading warm-up with shared builds (render/warmup.ts)', () => {
  /** The scene with two more steel pools: a mirrored one (its pipeline's front face differs) and one whose geometry has no uv. */
  async function warmScene(share: boolean) {
    const s = await build('webgpu', {share});
    const mirrored = pool('mirrored', s.geometries.box, s.materials.steel, 3, new THREE.Vector3(2, 0.2, 0));
    mirrored.scale.x = -1;
    const bare = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    bare.deleteAttribute('uv');
    const noUv = pool('no-uv', bare, s.materials.steel, 3, new THREE.Vector3(2, 0.2, 1));
    Object.assign(s.pools, {mirrored, noUv});
    s.scene.add(mirrored, noUv);
    return s;
  }
  const instanced = (items: {object: THREE.Object3D}[]) => items.filter(i => (i.object as THREE.InstancedMesh).isInstancedMesh).map(i => i.object.name).sort();

  it('the plan: one representative per variant in \'full\' mode (the other pools are drawn once in the hidden frames); one per pool in \'view\' mode and with shared builds off', async () => {
    const s = await warmScene(true);
    const mask = s.cam.layers.mask;
    const full = planWarmup(s.scene, {mode: 'full', cameraMask: mask});
    // steel: a (bb and the mirrored pool have its layout: covered) / the value-equal twin material (the plan keys by material identity)
    // / steel + colours (coloured-2 covered) / dynamic / glass / the pool without uv (another geometry layout = another build)
    expect(instanced(full.items)).toEqual(['a', 'coloured', 'dynamic', 'glass', 'no-uv', 'twin']);
    expect(instanced(full.others)).toEqual(['bb', 'coloured-2', 'mirrored']);
    const view = planWarmup(s.scene, {mode: 'view', cameraMask: mask});
    expect(instanced(view.items).length).toBe(9);
    expect(instanced(planWarmup(s.scene, {mode: 'view', cameraMask: mask, shareInstanced: true}).items).length).toBe(6);
    expect(instanced(planWarmup(s.scene, {mode: 'full', cameraMask: mask, shareInstanced: false}).items).length).toBe(9);
    overrideSharedInstancing('off'); // (the kill switch: the plan is the old one)
    expect(instanced(planWarmup(s.scene, {mode: 'full', cameraMask: mask}).items).length).toBe(9);
  }, 120_000);

  it('a full warm-up: the count shown is the representatives really compiled; every other pool gets its render objects, buffers and pipeline in the hidden frames; the frames after it build and create nothing', async () => {
    const s = await warmScene(true);
    const progress: WarmupProgress[] = [];
    const hidden: Layout[] = [];
    let inWarmup = true;
    const frame = () => { const n = s.rec!.layouts.length; s.frame(); if (inWarmup) hidden.push(...s.rec!.layouts.slice(n)); };
    const res = await runWarmup({
      renderer: s.renderer as WarmupRenderer, scene: s.scene, camera: s.cam, mode: 'full', registry: new WarmupRegistry(),
      sceneTarget: () => null, torch: s.spot, torchIntensity: 60, frame, finish: frame, hide: () => {}, alive: () => true,
    }, {yieldFrame: () => Promise.resolve(), compileChunk: 3, frameChunk: 3, onProgress: p => progress.push({...p})});
    inWarmup = false;
    expect(res.status).toBe('complete');
    // 6 instanced representatives + the ground; 3 covered pools
    expect(res.plan).toMatchObject({items: 7, others: 3});
    expect(res.stages.materials).toMatchObject({done: 7, total: 7});
    const materials = progress.filter(p => p.stage === 'materials');
    expect(materials.every(p => p.stageTotal === 7)).toBe(true);
    expect(materials[materials.length - 1].stageDone).toBe(7);
    expect(progress[progress.length - 1]).toMatchObject({stage: 'view', done: res.plan.items + res.stages.passes.total + res.stages.shadows.total + 1});
    expect(progress[progress.length - 1].done).toBe(progress[progress.length - 1].total);
    // scene-pass builds: steel (a; the twin's is the same build) / coloured / dynamic / glass / no-uv
    expect(instancedBuilds(s, false).length).toBe(5);
    // the mirrored pool was no representative: its clockwise-front pipelines were created by a hidden frame (synchronously), none by
    // the compile stage
    expect(hidden.some(l => l.frontFace === 'cw' && !l.async)).toBe(true);
    expect(s.rec!.layouts.some(l => l.frontFace === 'cw' && l.async)).toBe(false);
    for (const p of Object.values(s.pools)) expect(s.ros().get(p)?.scene, `${p.name} was drawn before the warm-up ended`).toBeDefined();

    // play: a full turn — every pool is in every frame (never culled here)
    const n0 = {builds: s.builds.length, pipelines: s.rec!.layouts.length, renderObjects: s.made.renderObjects, live: s.rec!.live().vertex};
    for (let st = 0; st < 8; st++) {
      s.cam.position.set(Math.sin(st * Math.PI / 4) * 9, 3, Math.cos(st * Math.PI / 4) * 9);
      s.cam.lookAt(0, 0.5, 0);
      s.frame();
      expectOwnData(s);
    }
    expect({builds: s.builds.length - n0.builds, pipelines: s.rec!.layouts.length - n0.pipelines, renderObjects: s.made.renderObjects - n0.renderObjects, vertexBuffers: s.rec!.live().vertex - n0.live})
      .toEqual({builds: 0, pipelines: 0, renderObjects: 0, vertexBuffers: 0});
    expect(s.log!.issues).toEqual([]);
    expect(s.log!.dropped).toBe(0);
  }, 180_000);
});

describe('WebGL 2 backend: the same node manager, the same per-pool buffers', () => {
  it('shared: one build per variant; every pool\'s render objects name its own instance arrays', async () => {
    const s = await build('webgl2', {share: true});
    for (let i = 0; i < 2; i++) s.frame();
    expect(instancedBuilds(s, false).length).toBe(4);
    for (const p of Object.values(s.pools)) {
      const draws = drawsOf(s, p, false);
      expect(draws.length, `${p.name} is drawn`).toBeGreaterThan(0);
      for (const d of draws) {
        const vb = d.ro.getVertexBuffers();
        const mats = vb.filter(b => b.isInstancedInterleavedBuffer === true);
        expect(mats.length).toBe(1);
        expect(mats[0].array).toBe(p.instanceMatrix.array);
        const cols = vb.filter(b => b.isInstancedBufferAttribute === true && b.isInstancedInterleavedBuffer !== true);
        if (p.instanceColor) { expect(cols.length).toBe(1); expect(cols[0].array).toBe(p.instanceColor.array); } else expect(cols.length).toBe(0);
      }
    }
  }, 120_000);

  it('switch off: one build per pool (three\'s keyed builds)', async () => {
    const s = await build('webgl2', {share: false});
    for (let i = 0; i < 2; i++) s.frame();
    expect(instancedBuilds(s, false).length).toBe(7);
  }, 120_000);
});
