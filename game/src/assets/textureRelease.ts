// Task track3-eaton-centre-20261031 (lane PERF): release a lazy model texture's DECODED CPU COPY once the GPU holds it.
//
// GLTFLoader decodes every embedded image into an ImageBitmap (4 B / texel, off the main thread) and three keeps it as the
// texture's source after the upload. Nothing reads those pixels again — three re-uploads only on a version bump (never for
// model textures) or after a dispose (PropModelLibrary.trim drops the whole model; a later use fetches it afresh) — except three
// colour samplers that average a few texels (world/meshSplit.ts averageColor, damage/sample.ts chip colours, damage/wounds.ts
// wound colour). The mall's lazy models hold ~450 MB of such bitmaps (~100 models at 1024² + 2 x 256²), and on a software
// rasterizer the uploaded texture is a second copy in the same system RAM (lanes/PERF.notes).
//
// releaseAfterUpload: when every texture sharing a source has been uploaded (three calls Texture.onUpdate right after the
// upload), the source's image is replaced by a RELEASE_THUMB² colour thumbnail (drawn from the original, so the samplers read
// the same colours: damage/sample.ts draws exactly this 32² image) and the bitmap is closed on the next task (after a WebGPU
// copyExternalImageToTexture is surely captured). The GPU texture, its mips and everything drawn are unchanged.
//
// Scope: Game.buildSection hooks the CURRENT level's lazy models only in the mall; boot models (weapons, zombie wardrobe, the
// light / sign / furniture derivatives shared by every level) and the Subway / Office are never touched.

import type * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

/** Edge (px) of the colour thumbnail that replaces a released image (damage/sample.ts samples a 32² thumbnail). */
export const RELEASE_THUMB = 32;

/** An image we may release: a decoded bitmap (ImageBitmap: has close()), with real dimensions. */
interface Closable { width: number; height: number; close(): void }
const closable = (img: unknown): img is Closable =>
  !!img && typeof (img as Closable).close === 'function' && (img as Closable).width > 0 && (img as Closable).height > 0;

const pending = new WeakMap<object, Set<THREE.Texture>>(); // keyed by texture.source (textures sharing an image)
const previous = new WeakMap<THREE.Texture, ((t: THREE.Texture) => void) | null>();

/** QA / tests: textures hooked, sources released, decoded bytes freed (w x h x 4 of each released image). */
export const textureReleaseStats = {hooked: 0, released: 0, bytes: 0};

/** Colour thumbnail of `img` (null without a 2D canvas, e.g. a Node run without the canvas shim). */
function thumbnail(img: Closable): {width: number; height: number} | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = RELEASE_THUMB;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, RELEASE_THUMB, RELEASE_THUMB);
    return c;
  } catch {
    return null;
  }
}

function uploaded(t: THREE.Texture): void {
  t.onUpdate = previous.get(t) ?? null; // first upload done: the texture's own hook (if any) is back
  previous.delete(t);
  const set = pending.get(t.source);
  if (!set) return;
  set.delete(t);
  if (set.size) return; // another texture sharing this image has not been uploaded yet
  pending.delete(t.source);
  const img = t.source.data as unknown;
  if (!closable(img)) return;
  t.source.data = thumbnail(img) ?? {width: RELEASE_THUMB, height: RELEASE_THUMB};
  textureReleaseStats.released++;
  textureReleaseStats.bytes += img.width * img.height * 4;
  setTimeout(() => { try { img.close(); } catch { /* already closed */ } }, 0);
}

/** Hook `textures` (deduplicated): each source's decoded image is released once every hooked texture of it was uploaded. */
export function releaseAfterUpload(textures: Iterable<THREE.Texture>): number {
  let n = 0;
  for (const t of textures) {
    if (!t?.isTexture || previous.has(t) || !closable(t.source?.data)) continue;
    let set = pending.get(t.source);
    if (!set) pending.set(t.source, (set = new Set()));
    set.add(t);
    previous.set(t, t.onUpdate ?? null);
    const own = t.onUpdate;
    t.onUpdate = (tex: THREE.Texture) => { own?.call(tex, tex); uploaded(tex); };
    textureReleaseStats.hooked++;
    n++;
  }
  return n;
}

/** Every texture referenced by the materials of a loaded model (all of them: textures sharing an image wait for each other). */
export function modelTextures(gltf: Pick<GLTF, 'scene'>): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>();
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) out.add(v as THREE.Texture);
    }
  });
  return out;
}

/** Hook a loaded model's textures (Game.buildSection, mall lazy models). Returns the number of textures hooked now. */
export function releaseModelTexturesAfterUpload(gltf: Pick<GLTF, 'scene'>): number {
  return releaseAfterUpload(modelTextures(gltf));
}
