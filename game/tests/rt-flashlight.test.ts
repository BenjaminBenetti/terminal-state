// Task studio-rt-flashlight-compute-20261115-233136-01: RT FLASHLIGHT — the flashlight's bounce traced by WebGPU compute (render/rt/).
// The light rays (equal flux, the old bounce's cone math), the light variants (the RT programs read the traced textures INSTEAD of
// the fourteen virtual lights; the standard programs are untouched), the probe (real limits, every kernel compiled), the device
// resources (only while a station is traced; Off frees everything and the materials read the zero placeholders again), the frame
// (gate, history restarts) and the kernels' own contract (bindings, the frame block). The estimator itself — light rays through the
// station's BVH, the gather, the visibility — is mirrored on the CPU (tests/helpers/rtEstimator.ts) in rt-flashlight-estimator.test.ts.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {MeshStandardNodeMaterial, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {GpuLog, validatingDevice} from './helpers/validatingWebgpu';
import {coneCosAt, makeRtCone} from '../src/render/rt/rtCone';
import {RT_GPU_SPARE, RT_GRID_MAX, RT_PROBE_REASONS, RT_REQUIRED_LIMITS, RtGpu, probeRtCompute, rtGridSize, type RtProbe} from '../src/render/rt/rtGpu';
import {BLAS_TRI_FLOATS, BVH_NODE_FLOATS, RtSceneBuffers} from '../src/render/rt/rtFormat';
import {FRAME_FLOATS, KERNEL_STORAGE_BUFFERS, RT_KERNELS, VPL_COUNT, VPL_GRID, kernelSource} from '../src/render/rt/rtKernels';
import {RT_ALPHA, RT_CAMERA_JUMP, RtFlashlight, rtStratum} from '../src/render/rt/rtFlashlightRuntime';
import {RtScene} from '../src/render/rt/rtScene';
import {spotConeSolidAngle} from '../src/world/flashBounce';
import {LightFieldLight, installLightFieldNode, stationFieldLight} from '../src/world/lightFieldNode';
import {installReflectNode, stationReflectLight} from '../src/world/reflectionNode';
import {RTB} from '../src/world/rtBounceNode';
import {bindingRefreshStats} from '../src/render/bindingRefresh';
import '../src/world/lights'; // (registers the full lights' bounce terms: FULL_IRRADIANCE / FULL_RADIANCE)

afterEach(() => { vi.unstubAllGlobals(); });

const GAME_CONE = {angle: 0.58, penumbra: 0.7} as const;

describe('the light rays: VPL_COUNT of equal flux in the spot\'s cone', () => {
  it('every ray carries OMEGA / VPL_COUNT; the rays are evenly spread over the flux and fill the cone', () => {
    const cone = makeRtCone(GAME_CONE.angle, GAME_CONE.penumbra);
    expect(cone.dirs.length).toBe(VPL_COUNT * 4);
    expect(cone.weight * VPL_COUNT).toBeCloseTo(spotConeSolidAngle(GAME_CONE.angle, GAME_CONE.penumbra), 12);
    // the share of the flux nearer the axis than each ray: uniform over [0, 1] (every 1/16 band holds 1/16 of the rays, +-1.5 %)
    const shareOf = (c: number): number => {
      let lo = 0, hi = 1;
      for (let q = 0; q < 60; q++) { const m = (lo + hi) / 2; if (coneCosAt(m, GAME_CONE.angle, GAME_CONE.penumbra) > c) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    // (the concentric map puts the cells on square rings: ring k holds 8k + 4 rays, all at the share of its middle; equal flux =
    // the rays nearer the axis plus half the ring are that share of all rays, to one ray)
    const shares: number[] = [];
    let maxOff = 0;
    for (let i = 0; i < VPL_COUNT; i++) {
      const c = cone.dirs[i * 4], s = Math.hypot(cone.dirs[i * 4 + 1], cone.dirs[i * 4 + 2]);
      expect(c * c + s * s).toBeCloseTo(1, 6);
      expect(cone.dirs[i * 4 + 3]).toBe(1);
      shares.push(shareOf(c));
      maxOff = Math.max(maxOff, Math.acos(Math.min(1, c)));
    }
    const rings = new Map<number, number>();
    for (const s of shares) { const k = Math.round((Math.sqrt(s) * VPL_GRID - 1) / 2); rings.set(k, (rings.get(k) ?? 0) + 1); }
    expect([...rings.keys()].sort((a, b) => a - b)).toEqual(Array.from({length: VPL_GRID / 2}, (_, k) => k));
    for (const [k, n] of rings) {
      expect(n).toBe(8 * k + 4);
      const s = ((2 * k + 1) / VPL_GRID) ** 2, below = (2 * k) ** 2;
      expect(Math.abs(below + n / 2 - s * VPL_COUNT)).toBeLessThanOrEqual(1.0001);
    }
    // the outermost ring stands at the share of its middle ((31 / 32)^2 of the flux nearer the axis), inside the cone's edge
    expect(maxOff).toBeCloseTo(Math.acos(coneCosAt(((VPL_GRID - 1) / VPL_GRID) ** 2, GAME_CONE.angle, GAME_CONE.penumbra)), 6);
    expect(maxOff).toBeLessThan(GAME_CONE.angle);
    // the two strata of the gather: either split (columns / rows of the light grid) halves the beam into two halves of the flux
    for (const odd of [false, true]) {
      let a = 0;
      for (let i = 0; i < VPL_COUNT; i++) if (rtStratum(i, odd) === 0) a++;
      expect(a).toBe(VPL_COUNT / 2);
    }
    // left half of the light grid = the beam's side along -u (columns gx < VPL_GRID / 2)
    for (let gy = 0; gy < VPL_GRID; gy++) for (let gx = 0; gx < VPL_GRID; gx++) {
      const u = cone.dirs[(gy * VPL_GRID + gx) * 4 + 1], v = cone.dirs[(gy * VPL_GRID + gx) * 4 + 2];
      if (gx < VPL_GRID / 2) expect(u).toBeLessThanOrEqual(1e-9); else expect(u).toBeGreaterThanOrEqual(-1e-9);
      if (gy < VPL_GRID / 2) expect(v).toBeLessThanOrEqual(1e-9); else expect(v).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('a wall edge entering the beam takes the rays a few at a time (no strip of the beam holds more than its share x 1.6)', () => {
    const cone = makeRtCone(GAME_CONE.angle, GAME_CONE.penumbra);
    // the beam seen along either axis across it: per strip of equal flux, how many rays (a strip of the PROFILE-weighted beam)
    for (const axis of [1, 2]) {
      const xs = Array.from({length: VPL_COUNT}, (_, i) => cone.dirs[i * 4 + axis] / cone.dirs[i * 4]).sort((a, b) => a - b);
      const strips = 32, per = VPL_COUNT / strips;
      // the flux-weighted quantiles: rays are equal flux, so strip k holds rays [k per, (k + 1) per) of the sorted list exactly;
      // what matters is that the GAP between neighbouring rays never jumps (no hole the edge would cross at once)
      let worst = 0;
      for (let k = 1; k < strips; k++) worst = Math.max(worst, xs[k * per] - xs[k * per - 1]);
      expect(worst).toBeLessThan(0.02);
    }
  });
});

describe('the receiver grid and the device limits', () => {
  it('half the drawing buffer, capped at RT_GRID_MAX with the same aspect', () => {
    expect(rtGridSize(1280, 720)).toEqual({w: 640, h: 360});
    expect(rtGridSize(1920, 1080)).toEqual({w: 640, h: 360});
    expect(rtGridSize(640, 360)).toEqual({w: 320, h: 180});
    expect(rtGridSize(2560, 1080)).toEqual({w: 640, h: 270});
    expect(rtGridSize(1280, 1024)).toEqual({w: 450, h: 360});
    expect(rtGridSize(0, 0)).toEqual({w: 1, h: 1});
    for (const [w, h] of [[3840, 2160], [800, 3000], [1, 5000]]) {
      const g = rtGridSize(w, h);
      expect(g.w).toBeLessThanOrEqual(RT_GRID_MAX.w);
      expect(g.h).toBeLessThanOrEqual(RT_GRID_MAX.h);
    }
  });

  it('what the kernels need fits WebGPU\'s DEFAULT limits (three requests none above them)', () => {
    const DEFAULTS = {maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4, maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxUniformBufferBindingSize: 65536, maxComputeWorkgroupsPerDimension: 65535};
    for (const [k, need] of Object.entries(RT_REQUIRED_LIMITS)) expect(need, k).toBeLessThanOrEqual(DEFAULTS[k as keyof typeof DEFAULTS]);
    expect(Math.max(...RT_KERNELS.map(k => KERNEL_STORAGE_BUFFERS[k]))).toBe(5);
  });

  it('every kernel declares exactly the bindings rtGpu binds; the frame block is FRAME_FLOATS floats', () => {
    const bindings = (src: string): number[] => [...src.matchAll(/@binding\((\d+)\)/g)].map(m => Number(m[1])).sort((a, b) => a - b);
    expect(bindings(kernelSource('light'))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bindings(kernelSource('receivers'))).toEqual([0, 1, 2, 3, 4]);
    expect(bindings(kernelSource('gather'))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bindings(kernelSource('temporal'))).toEqual([0, 4, 5]);
    expect(bindings(kernelSource('spatial1'))).toEqual([0, 4, 5]);
    expect(bindings(kernelSource('spatial2'))).toEqual([0, 4, 5, 6, 7]);
    for (const k of RT_KERNELS) {
      const src = kernelSource(k);
      expect(src).toMatch(/fn main\(/);
      expect(src.match(/var<storage, read_write>|var<storage, read>/g)!.length, k).toBe(KERNEL_STORAGE_BUFFERS[k]);
      // (no WGSL reserved word as a name: naga rejected `meta`; the kernels were compiled on a real WebGPU device, see the report)
      expect(src).not.toMatch(/\blet (meta|target|filter|layout|module|self|super|this|type|override)\b/);
    }
    // Frame: 4 vec4 + mat4 + 7 vec4 of f32 + 4 vec4 of u32 = 76 floats
    const frame = kernelSource('temporal').match(/struct Frame \{([^}]*)\}/)![1];
    const fields = frame.split(',').map(s => s.trim()).filter(Boolean);
    const floats = fields.reduce((n, f) => n + (/mat4x4f/.test(f) ? 16 : 4), 0);
    expect(floats).toBe(FRAME_FLOATS);
  });
});

// ---------------------------------------------------------------------------------------------
// The probe and the device resources on the validating no-op device (tests/helpers/validatingWebgpu.ts)

function fakeRenderer(o: {webgpu?: boolean; limits?: Record<string, number>; compileError?: boolean} = {}): {renderer: ConstructorParameters<typeof RtGpu>[0]; log: GpuLog; device: Record<string, unknown>} {
  const log = new GpuLog();
  const device = validatingDevice(log);
  if (o.limits) {
    const base = device.limits as Record<string, number>;
    device.limits = new Proxy({}, {get: (_t, k) => (typeof k === 'string' && k in o.limits! ? o.limits![k] : base[k as string])});
  }
  if (o.compileError) device.createShaderModule = () => ({kind: 'shaderModule', getCompilationInfo: () => Promise.resolve({messages: [{type: 'error', message: 'bad', lineNum: 3}]})});
  const gpu = new Map<object, {texture: unknown}>();
  const renderer = {
    backend: {isWebGPUBackend: o.webgpu !== false, device: device as unknown as GPUDevice, get: (t: object) => gpu.get(t) ?? {}},
    initTexture: (t: THREE.Texture) => { const img = t.image as {width: number; height: number}; gpu.set(t, {texture: (device.createTexture as (d: object) => unknown)({size: [img.width, img.height], label: t.name})}); },
  };
  return {renderer: renderer as never, log, device};
}

describe('the probe: the backend, the real limits, every kernel compiled', () => {
  it('WebGL 2: unsupported, with the reason; a WebGPU device whose limits fit: ok, with its pipelines', async () => {
    const gl = await probeRtCompute({backend: {isWebGPUBackend: false}} as never);
    expect([gl.ok, gl.reason]).toEqual([false, RT_PROBE_REASONS.webgl]);
    const {renderer} = fakeRenderer();
    const p = await probeRtCompute(renderer);
    expect([p.ok, p.reason]).toEqual([true, null]);
    expect(Object.keys(p.pipelines!)).toEqual([...RT_KERNELS]);
  });

  it('limits below what the kernels bind, or a kernel that does not compile: unsupported, saying which', async () => {
    const small = await probeRtCompute(fakeRenderer({limits: {maxStorageBuffersPerShaderStage: 4}}).renderer);
    expect(small.ok).toBe(false);
    expect(small.reason).toMatch(/maxStorageBuffersPerShaderStage 4 < 5/);
    const bad = await probeRtCompute(fakeRenderer({compileError: true}).renderer);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/failed to build \(light: bad \(line 3\)\)/);
  });
});

/** A tiny traced scene: a lit box room (a real RtScene: the kernels' inputs exist and are packed as on a station). */
function stubScene(): RtScene & {syncs: number} {
  const room = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 8), new THREE.MeshStandardMaterial({color: 0x808080, side: THREE.BackSide}));
  room.position.set(3, 1.5, 4);
  const root = new THREE.Group();
  root.add(room);
  const scene = new RtScene() as RtScene & {syncs: number};
  scene.prepare([root]);
  scene.syncs = 0;
  const sync = scene.sync.bind(scene);
  scene.sync = (...a) => { scene.syncs++; sync(...a); };
  return scene;
}

function flashlightRig(): {camera: THREE.PerspectiveCamera; spot: THREE.SpotLight} {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const spot = new THREE.SpotLight(0xfff4e2, 34, 30, 0.58, 0.7, 1.2);
  spot.position.set(0.2, -0.15, 0.1);
  spot.target.position.set(0.04, -0.12, -6);
  camera.add(spot, spot.target);
  camera.position.set(3, 1.6, 4);
  camera.updateMatrixWorld(true);
  return {camera, spot};
}

describe('the device resources: only while a station is traced', () => {
  it('the scene\'s buffers keep room to spare: what play adds is uploaded as its own span, never the whole scene again', async () => {
    const {renderer} = fakeRenderer();
    const probe = await probeRtCompute(renderer);
    const gpu = new RtGpu(renderer, probe as RtProbe);
    gpu.alloc();
    const made: string[] = [];
    const device = gpu.device as unknown as {createBuffer(d: {label?: string}): unknown};
    const createBuffer = device.createBuffer.bind(device);
    device.createBuffer = d => { made.push(d.label ?? ''); return createBuffer(d); };
    // a packed scene with spare capacity in its arrays (as RtScene leaves it): 100 k nodes / triangles used
    const S = new RtSceneBuffers(), used = 100_000, capacity = 140_000;
    S.blasNodes = new Float32Array(capacity * BVH_NODE_FLOATS); S.blasNodeCount = used;
    S.blasTris = new Float32Array(capacity * BLAS_TRI_FLOATS); S.blasTriCount = used;
    S.tlas = new Float32Array(1024 * 4); S.layout.vec4Count = 1024;
    gpu.upload(S);
    expect(made.sort()).toEqual(['rt-bn', 'rt-bt', 'rt-tl']);
    const first = gpu.stats.uploadedBlas;
    expect(first).toBe(used * (BVH_NODE_FLOATS + BLAS_TRI_FLOATS) * 4); // (the used part, whole: a fresh buffer)
    expect(gpu.stats.bytes.bn).toBeGreaterThanOrEqual(used * BVH_NODE_FLOATS * 4 + RT_GPU_SPARE.bn);
    // play adds a model of 12 k triangles (its nodes and triangles appended in the arrays' spare capacity)
    S.blasNodeCount += 12_000; S.blasTriCount += 12_000;
    S.dirtyBlas(used, used + 12_000, used, used + 12_000);
    gpu.upload(S);
    expect(made.length, 'no new buffer').toBe(3);
    expect(gpu.stats.uploadedBlas - first, 'only the new span').toBe(12_000 * (BVH_NODE_FLOATS + BLAS_TRI_FLOATS) * 4);
    gpu.free();
  });

  it('a scene allocates and binds the result textures; none frees every buffer and puts the zero placeholders back', async () => {
    const {renderer, log} = fakeRenderer();
    const probe = await probeRtCompute(renderer);
    const rt = new RtFlashlight(renderer, probe as RtProbe);
    const placeholderE = (RTB.E as unknown as {value: THREE.Texture}).value, placeholderN = (RTB.N as unknown as {value: THREE.Texture}).value;
    expect(rt.gpu.allocated).toBe(false); // (made at boot: nothing on the device until a station is traced)
    const bumps = bindingRefreshStats.bumps;
    // (the cone table's uploads, by the buffer they go to: every allocation needs its own — a new uniform buffer is zeros)
    const coneWrites: unknown[] = [];
    const queue = rt.gpu.device.queue as unknown as {writeBuffer(dst: {label?: string}, ...a: unknown[]): void};
    const writeBuffer = queue.writeBuffer.bind(queue);
    queue.writeBuffer = (dst, ...a) => { if (dst.label === 'rt-cone') coneWrites.push(dst); writeBuffer(dst, ...a); };
    rt.setScene(stubScene());
    expect(rt.gpu.allocated).toBe(true);
    expect((RTB.E as unknown as {value: THREE.Texture}).value).not.toBe(placeholderE);
    expect(bindingRefreshStats.bumps).toBe(bumps + 1);
    const bytes = rt.gpu.stats.bytes;
    expect(bytes.receivers).toBe(2 * RT_GRID_MAX.w * RT_GRID_MAX.h * 64);
    // frames: the traced bounce is bound (gate 1) while the torch is lit; the history restarts after a frame without it
    const {camera, spot} = flashlightRig();
    expect(rt.frame(0, spot, camera, 1280, 720, null, 0)).toBe(true);
    expect(RTB.cam.value.w).toBe(1);
    expect(RTB.grid.value.toArray().slice(0, 2)).toEqual([640, 360]);
    expect(rt.frame(0.016, spot, camera, 1280, 720, null, 0)).toBe(true);
    expect(log.submits).toBe(2);
    expect(coneWrites.length, 'the cone table is written once to the allocation').toBe(1);
    spot.intensity = 0;
    expect(rt.frame(0.033, spot, camera, 1280, 720, null, 0)).toBe(false);
    expect([RTB.cam.value.w, rt.stats.historyReset]).toEqual([0, 'flashlight off']);
    spot.intensity = 34;
    // Off: everything released, the placeholders back; a frame after it dispatches nothing and submits nothing destroyed
    rt.setScene(null);
    expect(rt.gpu.allocated).toBe(false);
    expect([(RTB.E as unknown as {value: THREE.Texture}).value, (RTB.N as unknown as {value: THREE.Texture}).value]).toEqual([placeholderE, placeholderN]);
    expect(rt.frame(0.05, spot, camera, 1280, 720, null, 0)).toBe(false);
    expect(RTB.cam.value.w).toBe(0);
    expect(log.submits).toBe(2);
    // on again (a relight back to RT, the next station): a fresh allocation, frames go on, nothing destroyed was ever submitted
    rt.setScene(stubScene());
    expect(rt.frame(0.066, spot, camera, 1280, 720, null, 0)).toBe(true);
    expect(rt.gpu.lifecycle).toEqual({allocs: 2, frees: 1});
    // the same spot (the runtime keeps its table), yet the NEW allocation's buffer got it: no frame traces with a zero cone
    expect(coneWrites.length, 'the new allocation got the cone table').toBe(2);
    expect(coneWrites[1]).not.toBe(coneWrites[0]);
    expect(rt.frame(0.083, spot, camera, 1280, 720, null, 0)).toBe(true);
    expect(coneWrites.length, 'and only once').toBe(2);
    expect(log.issues).toEqual([]);
    rt.dispose();
    expect(rt.gpu.allocated).toBe(false);
  });

  it('the frame block: the camera basis, the light frame, three\'s falloff, the grid and the history flags', async () => {
    const {renderer} = fakeRenderer();
    const rt = new RtFlashlight(renderer, await probeRtCompute(renderer) as RtProbe);
    const scene = stubScene();
    rt.setScene(scene);
    const {camera, spot} = flashlightRig();
    let block: {f32: Float32Array; u32: Uint32Array} | null = null;
    const dispatch = rt.gpu.dispatch.bind(rt.gpu);
    rt.gpu.dispatch = b => { block = {f32: b.f32.slice(), u32: b.u32.slice()}; return dispatch(b); };
    rt.frame(0, spot, camera, 1280, 720, null, 0);
    const f = block!.f32, u = block!.u32;
    expect([...f.slice(0, 3)].map(v => +v.toFixed(5))).toEqual([3, 1.6, 4]);
    // a ray through the view's top right corner (nx = ny = 1) is the camera's corner ray
    const corner = new THREE.Vector3(1, 1, 0.5).unproject(camera).sub(camera.position).normalize();
    const d = new THREE.Vector3(f[12] + f[4] + f[8], f[13] + f[5] + f[9], f[14] + f[6] + f[10]).normalize();
    expect(d.distanceTo(corner)).toBeLessThan(1e-5);
    const lp = spot.getWorldPosition(new THREE.Vector3()), tp = spot.target.getWorldPosition(new THREE.Vector3());
    expect(new THREE.Vector3(f[32], f[33], f[34]).distanceTo(lp)).toBeLessThan(1e-5);
    expect(new THREE.Vector3(f[36], f[37], f[38]).distanceTo(tp.sub(lp).normalize())).toBeLessThan(1e-5);
    expect([f[39], f[43]].map(v => +v.toFixed(5))).toEqual([30, 1.2]);
    expect(f[47]).toBeCloseTo(spotConeSolidAngle(0.58, 0.7) / VPL_COUNT / Math.PI, 7);
    expect([u[68], u[69], u[66], u[67]]).toEqual([640, 360, 1, VPL_COUNT]);
    expect(f[58]).toBe(0); // (no history on the first frame)
    expect(f[56]).toBeCloseTo(RT_ALPHA.base, 6);
    // the next frame: history valid; the beam turned 0.1 rad -> a higher floor; a resize / a camera jump restart it
    camera.rotation.y += 0.1;
    camera.updateMatrixWorld(true);
    rt.frame(0.016, spot, camera, 1280, 720, null, 0);
    expect(block!.f32[58]).toBe(1);
    expect(block!.f32[56]).toBeGreaterThan(RT_ALPHA.base + RT_ALPHA.perRad * 0.09);
    rt.frame(0.033, spot, camera, 1000, 720, null, 0);
    expect([block!.f32[58], rt.stats.historyReset]).toEqual([0, 'resize']);
    camera.position.x += RT_CAMERA_JUMP + 0.5;
    camera.updateMatrixWorld(true);
    rt.frame(0.05, spot, camera, 1000, 720, null, 0);
    expect([block!.f32[58], rt.stats.historyReset]).toEqual([0, 'camera jump']);
    expect(scene.syncs).toBe(4);
    rt.dispose();
  });

  // task studio-rt-flashlight-toggle-hitch-20261116-052336-01: the toggle hitch was GPU execution (the clock the torch-off load had
  // settled to), so a standby frame must give the device the lit frame's work: the same block, kernels and grid, a positive flux
  it('standby: an unlit flashlight is traced exactly as a lit one, the gate shut; without standby nothing is', async () => {
    const {renderer, log} = fakeRenderer();
    const rt = new RtFlashlight(renderer, await probeRtCompute(renderer) as RtProbe);
    const scene = stubScene();
    rt.setScene(scene);
    const {camera, spot} = flashlightRig();
    let block: {f32: Float32Array; u32: Uint32Array} | null = null;
    const dispatch = rt.gpu.dispatch.bind(rt.gpu);
    rt.gpu.dispatch = b => { block = {f32: b.f32.slice(), u32: b.u32.slice()}; return dispatch(b); };
    /** The block without its frame index and parity (u32 72, 73): what differs between any two frames at one pose. */
    const work = (): number[] => { const u = [...block!.u32]; u[72] = u[73] = 0; return u; };
    // before any lit frame: traced at intensity 1 (the kernels' work does not depend on the scale), the gate shut
    spot.intensity = 0;
    expect(rt.frame(0, spot, camera, 1280, 720, null, 0, true)).toBe(false);
    expect([RTB.cam.value.w, log.submits, rt.stats.dispatched, rt.stats.standby]).toEqual([0, 1, 1, 1]);
    expect([...block!.f32.slice(48, 51)].map(v => +v.toFixed(5))).toEqual([spot.color.r, spot.color.g, spot.color.b].map(v => +v.toFixed(5)));
    spot.intensity = 34;
    expect(rt.frame(0.016, spot, camera, 1280, 720, null, 0, true)).toBe(true);
    expect(RTB.cam.value.w).toBe(1);
    const lit = work();
    expect(block!.f32[58], 'the standby frame\'s history counts').toBe(1);
    RTB.grid.value.set(1, 2, 3, 4);
    const vp = RTB.viewProj.value.clone();
    // the torch off (intensity 0, or the spot hidden): the lit frame's work, nothing shown, nothing of the materials' uniforms touched
    spot.intensity = 0;
    expect(rt.frame(0.033, spot, camera, 1280, 720, null, 0, true)).toBe(false);
    expect(work(), 'the same frame block as the lit frame (light colour x the last lit intensity)').toEqual(lit);
    expect([RTB.cam.value.w, ...RTB.grid.value.toArray(), RTB.viewProj.value.equals(vp)]).toEqual([0, 1, 2, 3, 4, true]);
    spot.intensity = 34;
    spot.visible = false;
    expect(rt.frame(0.05, spot, camera, 1280, 720, null, 0, true)).toBe(false);
    expect(work()).toEqual(lit);
    spot.visible = true;
    expect([log.submits, rt.stats.dispatched, rt.stats.standby, scene.syncs]).toEqual([4, 4, 3, 4]);
    // on again: the history went on through standby (its last restart is still the new scene's), the gate opens
    expect(rt.frame(0.066, spot, camera, 1280, 720, null, 0, true)).toBe(true);
    expect([block!.f32[58], RTB.cam.value.w, rt.stats.historyReset]).toEqual([1, 1, 'scene']);
    // without standby (the menus, a flat battery, ?rtstandby=off): skipped as before — nothing submitted, the history restarts
    spot.intensity = 0;
    expect(rt.frame(0.083, spot, camera, 1280, 720, null, 0)).toBe(false);
    expect([log.submits, RTB.cam.value.w, rt.stats.historyReset, rt.stats.standby]).toEqual([5, 0, 'flashlight off', 3]);
    // no traced scene (RT Off, a fallback, the transit): standby traces nothing either
    rt.setScene(null);
    expect(rt.frame(0.1, spot, camera, 1280, 720, null, 0, true)).toBe(false);
    expect([log.submits, rt.stats.dispatched, RTB.cam.value.w]).toEqual([5, 5, 0]);
    expect(log.issues).toEqual([]);
    rt.dispose();
  });

  it('a device error in its first frames stops the traced bounce for the session and says so', async () => {
    const {renderer, device} = fakeRenderer();
    const rt = new RtFlashlight(renderer, await probeRtCompute(renderer) as RtProbe);
    const failures: string[] = [];
    rt.onFailure = r => failures.push(r);
    device.popErrorScope = () => Promise.resolve({message: 'Buffer binding size too small'});
    rt.setScene(stubScene());
    const {camera, spot} = flashlightRig();
    rt.frame(0, spot, camera, 1280, 720, null, 0);
    await new Promise(r => setImmediate(r));
    expect(failures).toEqual(['its compute work failed on this device (Buffer binding size too small)']);
    expect([rt.failure !== null, rt.gpu.allocated, rt.hasScene, RTB.cam.value.w]).toEqual([true, false, false, 0]);
    rt.setScene(stubScene()); // (a failed runtime is never used again)
    expect(rt.gpu.allocated).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The light variants: the RT programs read the traced textures INSTEAD of the virtual lights

function headless(): WebGPURenderer {
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  const r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement});
  (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  expect(installLightFieldNode(r)).toBe(true);
  expect(installReflectNode(r)).toBe(true);
  return r;
}
let renderer: WebGPURenderer | null = null;
function fragment(light: THREE.Light): string {
  const r = renderer ??= headless();
  const material = new MeshStandardNodeMaterial({color: 0x808080, roughness: 0.6, metalness: 0.2});
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const scene = new THREE.Scene();
  scene.add(mesh, light);
  const errors: string[] = [];
  const oe = console.error, ow = console.warn;
  console.error = console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    const b = new WGSLNodeBuilder(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
    b.scene = scene;
    b.camera = new THREE.PerspectiveCamera();
    b.material = material;
    b.context.material = material;
    b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights([light]);
    b.build();
    expect(errors, 'a clean build').toEqual([]);
    return b.fragmentShader;
  } finally {
    console.error = oe; console.warn = ow;
    scene.remove(light);
  }
}
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
const textures = (frag: string): number => count(frag, /var\s+\w+\s*:\s*texture_\w+(<\w+>)?\s*;/g);
const ubos = (frag: string): number => count(frag, /var<uniform>/g);

describe('the light variants', () => {
  it('one session-wide RT variant per full light; the plain light never has one', () => {
    expect(stationFieldLight(true, true)).toBe(stationFieldLight(true, true));
    expect(stationFieldLight(true, true)).not.toBe(stationFieldLight(true));
    expect(stationFieldLight(false, true)).toBe(stationFieldLight(false)); // (the plain light has no flashlight bounce at all)
    expect([stationFieldLight(true).rt, stationFieldLight(true, true).rt, stationFieldLight(false, true).rt]).toEqual([false, true, false]);
    expect(stationFieldLight(true, true).name).toBe('light-field-full-rt');
    expect(stationReflectLight(true, true, true).name).toBe('light-field-reflect-full-mirror-rt');
    expect(stationReflectLight(true, false, true).name).toBe('light-field-reflect-full-rt');
    expect(stationReflectLight(true, true, true)).not.toBe(stationReflectLight(true, true));
    expect(new LightFieldLight(true, true).rt).toBe(true);
  });

  it('the RT program reads the two traced textures and no virtual light; the standard program has no RT term', () => {
    for (const [std, rt] of [[stationFieldLight(true), stationFieldLight(true, true)], [stationReflectLight(true, true), stationReflectLight(true, true, true)]] as const) {
      const a = fragment(std), b = fragment(rt);
      expect(a).toMatch(/fbPos/);
      expect(a).not.toMatch(/rtCam|rtViewProj|rtGrid/);
      expect(b).not.toMatch(/fbPos|fbNrm|fbCol/);
      expect(b).toMatch(/rtCam/);
      expect(b).toMatch(/rtViewProj/);
      // the traced bounce: two sampled textures more, no uniform buffer more (plain render-group uniforms; WebGPU's 12 per stage)
      expect(textures(b) - textures(a), std.name).toBe(2);
      expect(ubos(b), std.name).toBe(ubos(a));
    }
  });
});
