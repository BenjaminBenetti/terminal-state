// Meshy T2.5 migration (lane CHARS): optional, documented colour grade of a T2.5 derivative's base-colour texture toward
// the ORIGINAL reference image's tint (wardrobe.config.mjs T25[id].grade). Deterministic.
//   mode 'reference-chroma': per-channel LINEAR gains that give the albedo (UV-covered texels of the stage atlas) the
//     reference's mean chromaticity (G/R, B/R of the alpha-masked reference pixels) while keeping the albedo's mean
//     luminance x `luminance` (1 = unchanged). The reference is a lit photo, so its brightness is not an albedo target;
//     its chroma is.
// Applied to the lossless stage preview (else the stage JPEG) and encoded once with the stage's JPEG settings.
import sharp from 'sharp';

const toLin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
const LUMA = [0.2126, 0.7152, 0.0722];
const r4 = v => +v.toFixed(4);

/** Mean linear RGB of the texels covered by the mesh's UV triangles. */
function coveredMean(rgb, S, uv, idx) {
  const mask = new Uint8Array(S * S);
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map(k => [uv[idx[t + k] * 2] * S, uv[idx[t + k] * 2 + 1] * S]);
    const [a, b, c] = p, area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((b[0] - qx) * (c[1] - qy) - (c[0] - qx) * (b[1] - qy)) / area, w1 = ((c[0] - qx) * (a[1] - qy) - (a[0] - qx) * (c[1] - qy)) / area;
      if (w0 >= 0 && w1 >= 0 && 1 - w0 - w1 >= 0) mask[y * S + x] = 1;
    }
  }
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < S * S; i++) if (mask[i]) { for (let c = 0; c < 3; c++) s[c] += toLin(rgb[i * 3 + c]); n++; }
  return {mean: s.map(v => v / n), texels: n};
}

/** Mean linear RGB of the opaque, non-black pixels of the reference image. */
async function referenceMean(file) {
  const {data} = await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 200 || data[i] + data[i + 1] + data[i + 2] < 60) continue; for (let c = 0; c < 3; c++) s[c] += toLin(data[i + c]); n++; }
  return {mean: s.map(v => v / n), pixels: n};
}

/** @returns {jpg: Buffer, stats} */
export async function gradeBase(enc, low, grade, quality, referenceImage) {
  const src = enc.basePreview ?? enc.baseJpg;
  const {data, info} = await sharp(Buffer.from(src)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  if (info.width !== info.height) throw new Error('grade: square atlas expected');
  const alb = coveredMean(data, info.width, low.uv, low.idx);
  let gains = grade.gainLinear, ref = null;
  if (grade.mode === 'reference-chroma') {
    ref = await referenceMean(referenceImage);
    const R = ref.mean, A = alb.mean;
    const yA = LUMA.reduce((s, w, c) => s + w * A[c], 0) * (grade.luminance ?? 1);
    const k = yA / LUMA.reduce((s, w, c) => s + w * R[c], 0); // target = reference chromaticity at the albedo's luminance
    gains = A.map((a, c) => (k * R[c]) / a);
  }
  const lut = [0, 1, 2].map(c => Uint8Array.from({length: 256}, (_, v) => toSrgb(toLin(v) * gains[c])));
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) data[i + c] = lut[c][data[i + c]];
  const after = coveredMean(data, info.width, low.uv, low.idx);
  const jpg = await sharp(data, {raw: {width: info.width, height: info.height, channels: 3}}).jpeg({quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const ratios = m => ({GR: r4(m[1] / m[0]), BR: r4(m[2] / m[0])});
  return {jpg, stats: {mode: grade.mode ?? 'gains', gainLinear: gains.map(r4), luminance: grade.luminance ?? 1, from: enc.basePreview ? 'lossless stage preview (PNG)' : 'stage JPEG',
    albedoMeanLinearBefore: alb.mean.map(r4), albedoMeanLinearAfter: after.mean.map(r4), coveredTexels: alb.texels, albedoRatiosBefore: ratios(alb.mean), albedoRatiosAfter: ratios(after.mean),
    ...(ref ? {referenceMeanLinear: ref.mean.map(r4), referenceRatios: ratios(ref.mean), referencePixels: ref.pixels} : {}), note: grade.note}};
}
