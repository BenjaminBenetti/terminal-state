// Fragment colours sampled from the hit surface's own texture (iteration 06, Lane D): concrete chips
// take the wall's real paint / tile glaze / band colour at the hit height, prop flakes the model's
// texture average. Each texture image is read ONCE into a 32 x 32 RGBA thumbnail (browser only; in
// Node tests or for undrawable images the class palette is used instead).

import * as THREE from 'three';
import {sampleSource} from '../assets/textureRelease'; // Task track3-eaton-centre-20261031 (lane PERF): exact chip colours after a mall image release

const SIZE = 32;
const thumbs = new WeakMap<object, Uint8ClampedArray | null>();

function thumb(tex: THREE.Texture | null | undefined): Uint8ClampedArray | null {
  const img = tex?.image as (CanvasImageSource & {width?: number; height?: number}) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return null;
  if (thumbs.has(img as object)) return thumbs.get(img as object) ?? null;
  let data: Uint8ClampedArray | null = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d', {willReadFrequently: true});
    if (ctx) { ctx.drawImage(sampleSource(img, SIZE), 0, 0, SIZE, SIZE); data = ctx.getImageData(0, 0, SIZE, SIZE).data; } // (lane PERF: exact 32² draw of a released image)
  } catch { data = null; }
  thumbs.set(img as object, data);
  return data;
}

/** Linear colour of `tex` at (u, v) (repeat-wrapped, v = 0 at the image bottom), or null. */
export function sampleTexture(tex: THREE.Texture | null | undefined, u: number, v: number, out = new THREE.Color()): THREE.Color | null {
  const d = thumb(tex);
  if (!d) return null;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const flip = tex?.flipY !== false;
  const x = Math.min(SIZE - 1, Math.floor(fu * SIZE)), y = Math.min(SIZE - 1, Math.floor((flip ? 1 - fv : fv) * SIZE));
  const i = (y * SIZE + x) * 4;
  return out.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
}

/** Mean linear colour of a texture (ignoring transparent / near-black atlas background), or null. */
export function textureMean(tex: THREE.Texture | null | undefined, out = new THREE.Color()): THREE.Color | null {
  const d = thumb(tex);
  if (!d) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128 || d[i] + d[i + 1] + d[i + 2] < 12) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return null;
  return out.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

/** Linear base colour of a material: colour x texture mean (x optional instance tint). */
export function materialBaseColor(mat: THREE.Material | undefined, tint?: THREE.Color | null, fallback = 0x808080): THREE.Color {
  const m = mat as THREE.MeshStandardMaterial | undefined;
  const c = m?.color ? m.color.clone() : new THREE.Color(fallback);
  const mean = textureMean(m?.map);
  if (mean) c.multiply(mean);
  if (tint) c.multiply(tint);
  return c;
}
