// Extract procedural environment textures (read-only sources) into game texture files and measure
// feature positions (bands, joints) from the actual pixels.
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

// Source normal maps were authored with green = -dH/dv (v = image-down), i.e. "green down".
// glTF/three expect green = image-up, so derived copies invert G (verified by grazing-light render).
export async function flipGreenPng(bytes) {
  const {data, info} = await sharp(Buffer.from(bytes)).raw().toBuffer({resolveWithObject: true});
  for (let i = 1; i < data.length; i += info.channels) data[i] = 255 - data[i];
  return {data, info};
}

export async function decodeRGB(bytes) {
  const {data, info} = await sharp(Buffer.from(bytes)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// rows/cols whose mean luminance dips well below the median, as narrow runs (joints/seams)
export function findJoints(img, axis, {maxRun = 12, k = 3, minDip = 8} = {}) {
  const {data, width, height} = img;
  const n = axis === 'row' ? height : width, m = axis === 'row' ? width : height;
  const L = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) { const p = 3 * (axis === 'row' ? i * width + j : j * width + i); s += lum(data[p], data[p + 1], data[p + 2]); }
    L[i] = s / m;
  }
  const sorted = [...L].sort((a, b) => a - b), med = sorted[n >> 1];
  const mad = [...L].map(v => Math.abs(v - med)).sort((a, b) => a - b)[n >> 1];
  const thr = med - Math.max(6, k * mad);
  const runs = [];
  for (let i = 0; i < n;) {
    if (L[i] < thr) {
      let j = i; while (j + 1 < n && L[j + 1] < thr) j++;
      // must be a narrow line that is darker than its immediate surroundings (rejects stains/patches)
      const inner = L[(i + j) >> 1], around = (L[Math.max(0, i - 6)] + L[Math.min(n - 1, j + 6)]) / 2;
      if (j - i + 1 <= maxRun && around - inner >= minDip) runs.push([i, j]);
      i = j + 1;
    } else i++;
  }
  return {runs, median: med, threshold: thr};
}

// fraction of pixels per image row matching a colour predicate
export function rowFractions(img, pred) {
  const {data, width, height} = img;
  const f = new Float64Array(height);
  for (let y = 0; y < height; y++) { let c = 0; for (let x = 0; x < width; x++) { const p = 3 * (y * width + x); if (pred(data[p], data[p + 1], data[p + 2])) c++; } f[y] = c / width; }
  return f;
}
export const runsAbove = (f, t) => { const r = []; for (let i = 0; i < f.length;) { if (f[i] > t) { let j = i; while (j + 1 < f.length && f[j + 1] > t) j++; r.push([i, j]); i = j + 1; } else i++; } return r; };

export async function readProcedural(file) {
  const doc = await new NodeIO().read(file);
  const root = doc.getRoot();
  const mats = root.listMaterials().map(m => ({
    name: m.getName(),
    textures: {color: m.getBaseColorTexture(), orm: m.getMetallicRoughnessTexture(), normal: m.getNormalTexture()},
    normalScale: m.getNormalScale(),
  }));
  const prims = root.listMeshes().flatMap(me => me.listPrimitives().map(p => {
    const pos = p.getAttribute('POSITION');
    return {material: p.getMaterial().getName(), min: pos.getMin([]), max: pos.getMax([]), triangles: p.getIndices().getCount() / 3};
  }));
  return {doc, mats, prims};
}

export async function encodeTexture(bytes, kind, maxSide) {
  let img = sharp(Buffer.from(bytes));
  const meta = await img.metadata();
  const scale = Math.min(1, maxSide / Math.max(meta.width, meta.height));
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  if (kind === 'normal') {
    const flipped = await flipGreenPng(bytes);
    let raw = flipped.data, info = flipped.info;
    if (scale < 1) {
      const r = await sharp(raw, {raw: {width: info.width, height: info.height, channels: info.channels}}).resize(w, h, {kernel: 'lanczos3'}).raw().toBuffer({resolveWithObject: true});
      raw = r.data; info = r.info;
      for (let i = 0; i < raw.length; i += info.channels) { // renormalise after filtering
        const x = raw[i] / 127.5 - 1, y = raw[i + 1] / 127.5 - 1, z = raw[i + 2] / 127.5 - 1, l = Math.hypot(x, y, z) || 1;
        raw[i] = Math.round((x / l * 0.5 + 0.5) * 255); raw[i + 1] = Math.round((y / l * 0.5 + 0.5) * 255); raw[i + 2] = Math.round((z / l * 0.5 + 0.5) * 255);
      }
    }
    const out = await sharp(raw, {raw: {width: info.width, height: info.height, channels: info.channels}}).removeAlpha().png({compressionLevel: 9, adaptiveFiltering: true}).toBuffer();
    return {bytes: out, ext: 'png', mime: 'image/png', width: info.width, height: info.height, greenFlipped: true};
  }
  if (scale < 1) img = img.resize(w, h, {kernel: 'lanczos3'});
  img = img.removeAlpha();
  const q = kind === 'color' ? 85 : 90;
  const out = await img.jpeg({quality: q, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
  return {bytes: out, ext: 'jpg', mime: 'image/jpeg', width: w, height: h, quality: q};
}
