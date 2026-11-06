// Task mall-horde-performance-20261105: render/uploadDedupe.ts — the redundant per-frame uniform uploads are removed DATA-IDENTICALLY.
// Two real three r186 WebGPURenderers (no-op devices whose queue mirrors every writeBuffer into the bytes of the GPU buffer it targets)
// draw the same scene through the same frames — a skinned mesh (bones posed on some frames), per-object data (the wound / prop-damage
// objectData path, changed once), a moving mesh, a torch-like shadow-casting spot light — one plain, one with the dedupe: after every
// frame every GPU buffer holds the same bytes in both, with far fewer writes in the second.
import * as THREE from 'three';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {appendFileSync} from 'node:fs';
import {stubWebgpuGlobals} from './helpers/fakeWebgpu';
import {RANGE_MERGE_MAX_BYTES, installUploadDedupe, uploadStats} from '../src/render/uploadDedupe';
import {objectData} from '../src/damage/tsl';
import {F, FrameInput, PERF_SCHEMA_MINOR, PerfCapture, type ReportMeta} from '../src/debug/perfRecorder';
import {SPAN_COUNT, UpdateProfiler} from '../src/debug/updateProfile';

afterAll(() => vi.unstubAllGlobals());

interface Mirror { order: object[]; bytes: Map<object, Uint8Array>; writes: number }

/** A renderer on its own no-op device whose writeBuffer calls are mirrored per GPU buffer. */
async function mirroredRenderer(): Promise<{r: import('three/webgpu').WebGPURenderer; m: Mirror}> {
  const canvas = stubWebgpuGlobals();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const m: Mirror = {order: [], bytes: new Map(), writes: 0};
  const gpu = (globalThis.navigator as unknown as {gpu: {requestAdapter: () => Promise<{requestDevice: () => Promise<Record<string, unknown>>}>}}).gpu;
  const ra = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async () => {
    const ad = await ra();
    return {...ad, requestDevice: async () => {
      const dv = await ad.requestDevice(), q = dv.queue as Record<string, (...a: unknown[]) => unknown>;
      const createBuffer = dv.createBuffer as (...a: unknown[]) => object;
      const qp = new Proxy(q, {get: (_t, k) => k === 'writeBuffer' ? (buf: object, off: number, data: ArrayBufferView | ArrayBuffer, dataOff = 0, size?: number) => {
        const view = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
        const el = (view as unknown as {BYTES_PER_ELEMENT?: number}).BYTES_PER_ELEMENT ?? 1;
        const src = new Uint8Array(view.buffer, view.byteOffset + dataOff * el, size !== undefined ? size * el : view.byteLength - dataOff * el);
        let b = m.bytes.get(buf) ?? new Uint8Array(0);
        if (b.length < off + src.length) { const g = new Uint8Array(off + src.length); g.set(b); b = g; }
        b.set(src, off);
        m.bytes.set(buf, b);
        m.writes++;
        return q.writeBuffer(buf, off, data, dataOff, size);
      } : q[k as string]});
      return new Proxy(dv, {get: (_t, k) => k === 'queue' ? qp : k === 'createBuffer' ? (...a: unknown[]) => { const b = createBuffer(...a); m.order.push(b); return b; } : dv[k as string]});
    }};
  };
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas});
  await r.init();
  r.shadowMap.enabled = true;
  return {r, m};
}

/** The scene (built the same way for both renderers): skinned + per-object data, a mover, a static floor, a shadowing spot light. */
async function scene() {
  const W = await import('three/webgpu');
  const s = new THREE.Scene();
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[1].position.y = 0.5; bones[2].position.y = 0.5;
  bones[0].add(bones[1]); bones[1].add(bones[2]);
  const g = new THREE.BoxGeometry(0.4, 1.5, 0.4, 1, 6, 1);
  const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i) + 0.75; si[i * 4] = Math.min(2, Math.floor(y / 0.5)); sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const D = objectData('uploadDedupeTest', 3);
  const skinMat = new W.MeshStandardNodeMaterial({color: 0x887766});
  (skinMat as unknown as {colorNode: unknown}).colorNode = (D.element(0) as unknown as {xyz: unknown}).xyz;
  const skinned = new THREE.SkinnedMesh(g, skinMat);
  skinned.add(bones[0]);
  skinned.bind(new THREE.Skeleton(bones));
  skinned.userData.uploadDedupeTest = new Float32Array(12).fill(0.5);
  skinned.castShadow = skinned.receiveShadow = true;
  skinned.frustumCulled = false;
  const mover = new THREE.Mesh(new THREE.SphereGeometry(0.3), new W.MeshStandardNodeMaterial({color: 0x44aa66}));
  mover.castShadow = true;
  mover.position.set(1, 0.5, 0);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new W.MeshStandardNodeMaterial({color: 0x555555}));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; floor.receiveShadow = true;
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.05, 50);
  cam.position.set(0, 0.5, 4);
  const torch = new THREE.SpotLight(0xffffff, 3, 20, 0.6, 0.5, 1);
  torch.castShadow = true;
  torch.shadow.mapSize.set(256, 256);
  cam.add(torch, torch.target);
  torch.target.position.set(0, 0, -5);
  s.add(skinned, mover, floor, cam, new THREE.HemisphereLight(0xffffff, 0x222222, 0.4));
  /** Frame k's changes: bones posed on frames 0, 3, 6, … (a far horde member's every-3rd-frame step); the mover moves on even frames; a wound lands at frame 5. */
  const step = (k: number) => {
    if (k % 3 === 0) bones[1].rotation.z = Math.sin(k * 0.7) * 0.6;
    if (k % 2 === 0) mover.position.x = 1 + k * 0.05;
    if (k === 5) (skinned.userData.uploadDedupeTest as Float32Array)[1] = 0.9;
  };
  return {s, cam, step};
}

describe('uploadDedupe: redundant per-frame uniform uploads removed data-identically (render/uploadDedupe.ts)', () => {
  it('two renderers, the same frames: every GPU buffer holds the same bytes after every frame, with far fewer writes', async () => {
    const A = await mirroredRenderer();
    const sa = await scene();
    const B = await mirroredRenderer();
    const sb = await scene();
    expect(installUploadDedupe(B.r)).toBe(true);
    expect(installUploadDedupe(B.r)).toBe(true); // (idempotent)
    expect(installUploadDedupe(null)).toBe(false);
    const s0 = {...uploadStats};
    const writesAt: [number, number][] = [];
    for (let k = 0; k < 12; k++) {
      sa.step(k); sb.step(k);
      const a0 = A.m.writes, b0 = B.m.writes;
      // (a new node frame per rendered frame, as the game's animation loop does: three updates a skeleton once per frame id)
      for (const R of [A.r, B.r]) (R as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame.update();
      A.r.render(sa.s, sa.cam);
      B.r.render(sb.s, sb.cam);
      writesAt.push([A.m.writes - a0, B.m.writes - b0]);
      // the same buffers in the same creation order (the same scene built the same way)
      expect(B.m.order.length).toBe(A.m.order.length);
      for (let i = 0; i < A.m.order.length; i++) {
        const x = A.m.bytes.get(A.m.order[i]) ?? new Uint8Array(0), y = B.m.bytes.get(B.m.order[i]) ?? new Uint8Array(0);
        const len = Math.max(x.length, y.length), at = (u: Uint8Array, j: number) => (j < u.length ? u[j] : 0); // (unwritten = the zero-initialized buffer)
        let diff = -1;
        for (let j = 0; j < len && diff < 0; j++) if (at(x, j) !== at(y, j)) diff = j;
        expect(diff, `frame ${k}: buffer ${i} differs at byte ${diff}`).toBe(-1);
      }
    }
    const after = writesAt.slice(1); // (frame 0 uploads everything in both)
    const sumA = after.reduce((s, [a]) => s + a, 0), sumB = after.reduce((s, [, b]) => s + b, 0);
    expect(sumB).toBeLessThan(sumA * 0.6);
    expect(uploadStats.skipped).toBeGreaterThan(s0.skipped);
    expect(uploadStats.merged + uploadStats.ranged).toBeGreaterThan(s0.merged + s0.ranged);
    // a still frame writes (almost) nothing; a frame with posed bones writes them
    try { appendFileSync('/tmp/upload-dedupe-test.txt', `writes per frame plain/dedupe: ${writesAt.map(([a, b]) => `${a}/${b}`).join(' ')} · buffers ${A.m.order.length}\n`); } catch { /* best effort (vitest swallows console) */ }
  }, 120_000);

  it('only the WebGPU backend is wrapped; RANGE_MERGE_MAX_BYTES bounds the merged span', () => {
    expect(installUploadDedupe({backend: {isWebGPUBackend: false, bindingUtils: {updateBinding() {}}}})).toBe(false);
    expect(installUploadDedupe({backend: {isWebGPUBackend: true}})).toBe(false);
    expect(RANGE_MERGE_MAX_BYTES).toBeGreaterThanOrEqual(256);
  });

  it('a skipped write needs the same GPU buffer: a recreated buffer, a changed word or a ranged write in between always writes', () => {
    const writes: string[] = [];
    const data = {buffer: new Float32Array([1, 2, 3, 4]), updateRanges: [] as {start: number; count: number}[]};
    let gpu: object = {id: 1};
    const backend = {isWebGPUBackend: true, get: () => ({buffer: gpu}), bindingUtils: {updateBinding: (b: typeof data) => { writes.push(b.updateRanges.length ? `range ${JSON.stringify(b.updateRanges)}` : `full ${Array.from(b.buffer).join(',')}`); }}};
    expect(installUploadDedupe({backend})).toBe(true);
    const up = (b: typeof data) => backend.bindingUtils.updateBinding(b);
    up(data); up(data); // second: identical -> skipped
    expect(writes).toEqual(['full 1,2,3,4']);
    data.buffer[2] = 9; up(data); // changed word
    gpu = {id: 2}; up(data); // recreated GPU buffer (device restore)
    data.updateRanges.push({start: 0, count: 1}, {start: 2, count: 1}); up(data); // ranged: merged into one span
    expect(data.updateRanges).toEqual([{start: 0, count: 1}, {start: 2, count: 1}]); // (three's ranges are restored)
    data.updateRanges.length = 0; up(data); // after a ranged write the next full write is never skipped
    expect(writes).toEqual(['full 1,2,3,4', 'full 1,2,9,4', 'full 1,2,9,4', 'range [{"start":0,"count":3}]', 'full 1,2,9,4']);
  });

  it('the performance recorder (schemaMinor 4): per-frame uniformWrites / uniformWritesSkipped deltas; null when not installed', () => {
    expect(PERF_SCHEMA_MINOR).toBeGreaterThanOrEqual(4); // (4 added these columns; later minors are additive)
    const names = (() => { const p = new UpdateProfiler(2); return Array.from({length: SPAN_COUNT}, (_, j) => p.name(j)); })();
    const meta = (): ReportMeta => ({build: {label: 'test'}, environment: {}, capabilities: [], spanNames: names, capturedAtUTC: '2026-11-05T00:00:00.000Z', endedAtUTC: '2026-11-05T00:01:00.000Z'});
    const run = (installed: boolean) => {
      const c = new PerfCapture();
      c.start(0);
      const i = new FrameInput();
      let w = 1000, k0 = 500;
      for (let k = 0; k < 6; k++) {
        i.time += 1000 / 60; i.cpuMs = 5; i.flags = F.rendered;
        w += k; k0 += 2 * k;
        i.uniformWrites = installed ? w : -1; i.uniformWritesSkipped = installed ? k0 : -1;
        c.frame(i, null);
      }
      c.stop(i.time + 20, 'manual');
      return JSON.parse(c.serializeSync(meta())) as {schemaMinor: number; frames: {columns: Record<string, (number | null)[]>; units: Record<string, string>}};
    };
    const r = run(true);
    expect(r.schemaMinor).toBe(PERF_SCHEMA_MINOR);
    expect(r.frames.columns.uniformWrites).toEqual([0, 1, 2, 3, 4, 5]); // (the first frame: no baseline yet)
    expect(r.frames.columns.uniformWritesSkipped).toEqual([0, 2, 4, 6, 8, 10]);
    expect(r.frames.units.uniformWrites).toMatch(/schemaMinor 4/);
    const off = run(false);
    expect(off.frames.columns.uniformWrites.every(v => v === null)).toBe(true);
    expect(off.frames.columns.uniformWritesSkipped.every(v => v === null)).toBe(true);
  });
});
