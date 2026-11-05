// Task mall-horde-performance-20261105 (the user's native GAME71 Mall trace): per-frame uniform-buffer uploads on the WebGPU backend.
//
// The trace (Chrome 156 / WebGPU / AMD, quality high): with the Mall horde in view the frame's render submission took 20-27 ms of main
// thread (GPU render passes 7-8 ms, AI <= 1.5 ms, culling <= 2 ms), every other refresh missed. At the SAME view and draw count (979)
// it fell to 7 ms in the frame the horde calmed down (the AI span halved with it; across the horde-facing frames render tracks the AI
// span, r 0.88, far more than the draw count, r 0.31): lured zombies (ai/lightLure.ts 'investigate') move and animate every frame.
// three's own JavaScript does not explain it (tests/rendercpu-horde-investigate.test.ts, the real Mall on three's WebGPU path with a
// no-op device: static / animated / moving enemies differ by <= 1 ms); what changes is the GPU upload traffic — device.queue.writeBuffer
// per frame: 41 with the enemies hidden, 242 with them standing, 441 moving:
//  - three r186 writes every NodeUniformBuffer binding (buffer nodes: a skinned draw's bone matrices, the per-object wound data) IN
//    FULL every frame for every render object of every pass — `Buffer.update()` returns true — whether the bytes changed or not
//    (a zombie's 18-joint bones, 1152 B, and its 688 B wound data, once per mesh per pass);
//  - a uniform group (UniformsGroup) writes one call per changed range, merged only when contiguous (a moving mesh: its model matrix
//    and normal matrix are two writes).
// Every write is a separate command serialized to the browser's GPU process (staging copy + buffer usage transition), outside the
// render passes the GPU timestamps measure; its native cost is not observable here.
//
// This module removes the redundant ones, data-identically (the CPU array three writes from mirrors the GPU buffer):
//  - a FULL write is skipped when its bytes equal the last bytes written to the SAME GPU buffer (bitwise; a new / recreated GPU buffer
//    or any changed word writes as before);
//  - a RANGED write's ranges are merged into ONE write of their span when the span is small (<= RANGE_MERGE_MAX_BYTES): the bytes in
//    the gaps are the CPU mirror's current values, i.e. what the GPU buffer already holds (or zero padding never read).
// WebGPU backend only (the WebGL 2 fallback is untouched). Installed once on the game's renderer after init (Game.initRenderer).

/** Ranged writes whose span is at most this many bytes are merged into one write (larger spans keep three's per-range writes). */
export const RANGE_MERGE_MAX_BYTES = 4096;

/**
 * Counters (QA / tests / the performance recorder's uniformWrites columns): renderers wrapped, full writes issued / skipped as identical,
 * ranged writes merged / passed through, writes saved by merging.
 */
export const uploadStats = {installs: 0, full: 0, skipped: 0, merged: 0, ranged: 0, rangeWritesSaved: 0};

/** Uniform-buffer uploads issued so far (every write the wrapper let through or merged). */
export const uploadsIssued = (): number => uploadStats.full + uploadStats.merged + uploadStats.ranged;

interface Range { start: number; count: number }
interface Binding { buffer: ArrayLike<number> & {buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number; BYTES_PER_ELEMENT?: number}; updateRanges: Range[] }
interface Backend { isWebGPUBackend?: boolean; get(o: object): {buffer?: unknown}; bindingUtils?: {updateBinding(b: Binding): void} }

/** Last bytes written per binding (and the GPU buffer they went to). */
const written = new WeakMap<Binding, {gpu: unknown; words: Uint32Array}>();
const installed = new WeakSet<object>();

function wordsOf(a: Binding['buffer']): Uint32Array | null {
  if (!ArrayBuffer.isView(a) || a instanceof DataView || !a.buffer || a.byteLength === undefined || (a.byteLength & 3) !== 0 || ((a.byteOffset ?? 0) & 3) !== 0) return null;
  return new Uint32Array(a.buffer, a.byteOffset ?? 0, a.byteLength >> 2);
}

/** True when `words` equals `prev` (same length, every word). */
function same(prev: Uint32Array, words: Uint32Array): boolean {
  if (prev.length !== words.length) return false;
  for (let i = 0; i < words.length; i++) if (prev[i] !== words[i]) return false;
  return true;
}

/**
 * Wrap the WebGPU backend's binding upload (see the file comment). Idempotent; returns whether it is (now) installed — false on
 * any other backend (the WebGL 2 fallback) or a renderer without one.
 */
export function installUploadDedupe(renderer: unknown): boolean {
  const backend = (renderer as {backend?: Backend} | null)?.backend;
  const utils = backend?.bindingUtils;
  if (!backend || backend.isWebGPUBackend !== true || !utils || typeof utils.updateBinding !== 'function') return false;
  if (installed.has(utils)) return true;
  const inner = utils.updateBinding.bind(utils);
  utils.updateBinding = (binding: Binding) => {
    const ranges = binding.updateRanges;
    if (ranges.length === 0) {
      const words = wordsOf(binding.buffer), gpu = backend.get(binding as object).buffer;
      const prev = words ? written.get(binding) : undefined;
      if (words && prev && prev.gpu === gpu && same(prev.words, words)) { uploadStats.skipped++; return; }
      inner(binding);
      uploadStats.full++;
      if (words) {
        if (prev && prev.words.length === words.length) { prev.words.set(words); prev.gpu = gpu; } else written.set(binding, {gpu, words: words.slice()});
      }
      return;
    }
    // a ranged write changes the GPU bytes outside any full-write record: forget it (the next full write compares afresh)
    written.delete(binding);
    const el = binding.buffer.BYTES_PER_ELEMENT ?? 4;
    const first = ranges[0], last = ranges[ranges.length - 1], span = last.start + last.count - first.start;
    if (ranges.length < 2 || span * el > RANGE_MERGE_MAX_BYTES) { uploadStats.ranged++; inner(binding); return; }
    let writes = 1; // (the writes three would issue: it merges contiguous ranges only)
    for (let i = 1; i < ranges.length; i++) if (ranges[i].start !== ranges[i - 1].start + ranges[i - 1].count) writes++;
    if (writes < 2) { uploadStats.ranged++; inner(binding); return; }
    const saved = ranges.slice();
    ranges.length = 0;
    ranges.push({start: first.start, count: span});
    try { inner(binding); } finally { ranges.length = 0; for (const r of saved) ranges.push(r); }
    uploadStats.merged++;
    uploadStats.rangeWritesSaved += writes - 1;
  };
  installed.add(utils);
  uploadStats.installs++;
  return true;
}
