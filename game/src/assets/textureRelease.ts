// Task track3-eaton-centre-20261031 (lane PERF): release a model texture's DECODED CPU COPY once the GPU holds it.
//
// GLTFLoader decodes every embedded image into an ImageBitmap (4 B / texel) and three keeps it as the texture's source after
// the upload. three never reads those pixels again — it re-uploads only on a version bump (never for model textures: audited,
// lanes/PERF.done) or after a dispose (PropModelLibrary.trim drops the whole model; a later use fetches it afresh) — and no
// texture is cloned from a model texture (world/materials.ts thinTrim clones canvas surface maps only). The CPU readers of model
// images are exactly three colour samplers, each drawing the image into a tiny canvas and reading it back:
//   world/meshSplit.ts averageColor (24 x 24: openable / container paint), damage/wounds.ts materialColor (16 x 16: wound
//   colour), damage/sample.ts thumb (32 x 32: chip / flake colours).
// On release the image is replaced by its 32² thumbnail, and the EXACT thumbnail each sampler would draw (same drawImage, same
// `willReadFrequently` 2D context) is kept per size (SAMPLE_SIZES): the samplers draw `sampleSource(img, size)` 1:1, so their
// pixels — and the colours they compute — are identical to reading the original image. GPU textures, mips and everything drawn
// on screen are untouched (the user's guns and the Siren included).
//
// Lifecycle (all mall-gated by Game; the trackers alone change nothing):
//  - trackUploads(textures): records each texture's upload (a wrapper around Texture.onUpdate that also calls the texture's own
//    hook). Game tracks the boot models right after loading (before the item icons upload many of them) and every lazy model
//    after it is fetched.
//  - releaseAfterUpload(textures): a source is released as soon as EVERY tracked texture sharing it has been uploaded (now, if
//    that already happened; else at its last upload). The bitmap is closed on the next task (after a WebGPU
//    copyExternalImageToTexture has surely captured it).
//  - stageUploads(init, textures): uploads not-yet-uploaded textures in byte-bounded batches behind the loading screen, yielding
//    between batches so each batch's bitmaps are closed before the next one is uploaded (the title frame no longer holds every
//    decoded image AND its GPU copy at once).

import type * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

/** Edge (px) of the image that replaces a released one. */
export const RELEASE_THUMB = 32;
/** Canvas sizes the colour samplers draw a model image at (wounds 16, meshSplit.averageColor 24, damage/sample 32). */
export const SAMPLE_SIZES = [16, 24, 32] as const;

/** An image we may release: a decoded bitmap (ImageBitmap: has close()), with real dimensions. */
interface Closable { width: number; height: number; close(): void }
const closable = (img: unknown): img is Closable =>
  !!img && typeof (img as Closable).close === 'function' && (img as Closable).width > 0 && (img as Closable).height > 0;

const tracked = new WeakSet<THREE.Texture>();
const uploaded = new WeakSet<THREE.Texture>();
/** Every tracked texture of a source (GLTFLoader clones a texture per sampler: clones share the source). */
const bySource = new WeakMap<object, Set<THREE.Texture>>();
/** Sources to release once all their textures are uploaded. */
const wanted = new WeakSet<object>();
/** Replacement image -> the exact sampler thumbnails (size -> canvas). */
const thumbsOf = new WeakMap<object, Map<number, unknown>>();

/** QA / tests: textures tracked / hooked for release, sources released, decoded bytes freed (w x h x 4 per released image). */
export const textureReleaseStats = {tracked: 0, hooked: 0, released: 0, bytes: 0, staged: 0};

/** The image a colour sampler should draw at `size` x `size`: the exact pre-release thumbnail when `img` was released, else `img`. */
export function sampleSource<T>(img: T, size: number): T {
  return ((img && thumbsOf.get(img as object)?.get(size)) ?? img) as T;
}

/** `img` drawn at size x size exactly as the samplers draw it (null without a 2D canvas, e.g. Node without the canvas shim). */
function sampled(img: Closable, size: number): {width: number; height: number} | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d', {willReadFrequently: true});
    if (!ctx) return null;
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, size, size);
    return c;
  } catch {
    return null;
  }
}

function release(source: object): void {
  const src = source as {data: unknown};
  const img = src.data;
  if (!closable(img)) return;
  const thumbs = new Map<number, unknown>();
  for (const s of SAMPLE_SIZES) { const c = sampled(img, s); if (c) thumbs.set(s, c); }
  const repl = (thumbs.get(RELEASE_THUMB) ?? {width: RELEASE_THUMB, height: RELEASE_THUMB}) as object;
  thumbsOf.set(repl, thumbs);
  src.data = repl;
  textureReleaseStats.released++;
  textureReleaseStats.bytes += img.width * img.height * 4;
  setTimeout(() => { try { img.close(); } catch { /* already closed */ } }, 0);
}

function tryRelease(source: object): void {
  if (!wanted.has(source)) return;
  const set = bySource.get(source);
  if (!set) return;
  for (const t of set) if (!uploaded.has(t)) return; // another texture of this image has not been uploaded yet
  wanted.delete(source);
  release(source);
}

/** Record uploads of `textures` (idempotent; three calls Texture.onUpdate right after an upload). Returns how many are new. */
export function trackUploads(textures: Iterable<THREE.Texture>): number {
  let n = 0;
  for (const t of textures) {
    if (!t?.isTexture || tracked.has(t) || !t.source) continue;
    tracked.add(t);
    let set = bySource.get(t.source);
    if (!set) bySource.set(t.source, (set = new Set()));
    set.add(t);
    const own = t.onUpdate;
    t.onUpdate = (tex: THREE.Texture) => {
      own?.call(tex, tex);
      uploaded.add(tex);
      tryRelease(tex.source);
    };
    textureReleaseStats.tracked++;
    n++;
  }
  return n;
}

/** Release `textures`' decoded images once uploaded (tracks them first). Returns the number newly hooked. */
export function releaseAfterUpload(textures: Iterable<THREE.Texture>): number {
  let n = 0;
  const sources = new Set<object>();
  for (const t of textures) {
    if (!t?.isTexture || !closable(t.source?.data)) continue;
    trackUploads([t]);
    if (!wanted.has(t.source)) { wanted.add(t.source); n++; textureReleaseStats.hooked++; }
    sources.add(t.source);
  }
  for (const s of sources) tryRelease(s); // already uploaded (e.g. by the item icons): released now
  return n;
}

/** Every texture referenced by the materials of a loaded model (all of them: textures sharing an image wait for each other). */
export function modelTextures(gltf: Pick<GLTF, 'scene'>): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>();
  gltf.scene.traverse(o => collectTextures(o, out));
  return out;
}

/** Textures in the material slots of `o` (meshes only), added to `out`. */
export function collectTextures(o: THREE.Object3D, out: Set<THREE.Texture>): void {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    if (!mat) continue;
    for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) out.add(v as THREE.Texture);
  }
}

/** Hook a loaded model's textures. Returns the number of sources newly hooked. */
export function releaseModelTexturesAfterUpload(gltf: Pick<GLTF, 'scene'>): number {
  return releaseAfterUpload(modelTextures(gltf));
}

/** Textures hooked for release whose image is still decoded and which are not uploaded yet (what staging would upload). */
export function pendingUploads(textures: Iterable<THREE.Texture>): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const t of textures) if (t?.isTexture && tracked.has(t) && !uploaded.has(t) && wanted.has(t.source) && closable(t.source.data)) out.push(t);
  return out;
}

/**
 * Upload `textures` (only those pendingUploads selects) in batches of about `batchBytes` decoded bytes via `init` (the
 * renderer's initTexture), yielding to the event loop after each batch so the released bitmaps are closed before the next
 * batch is uploaded. `progress(done, total)` after each batch; stops early when `alive()` turns false.
 */
export async function stageUploads(init: (t: THREE.Texture) => void, textures: Iterable<THREE.Texture>,
  o: {batchBytes?: number; progress?: (done: number, total: number) => void; alive?: () => boolean} = {}): Promise<number> {
  const list = pendingUploads(textures);
  const batch = o.batchBytes ?? 48 * 1048576;
  let done = 0, acc = 0;
  for (const t of list) {
    if (o.alive && !o.alive()) break;
    if (uploaded.has(t)) continue;
    const img = t.source.data as Partial<Closable>;
    try { init(t); } catch { continue; }
    done++;
    textureReleaseStats.staged++;
    acc += (img.width ?? 0) * (img.height ?? 0) * 4;
    if (acc >= batch) {
      acc = 0;
      o.progress?.(done, list.length);
      await new Promise(r => setTimeout(r, 0)); // the batch's deferred close() calls run first
      await new Promise(r => setTimeout(r, 0));
    }
  }
  o.progress?.(done, list.length);
  await new Promise(r => setTimeout(r, 0));
  return done;
}
