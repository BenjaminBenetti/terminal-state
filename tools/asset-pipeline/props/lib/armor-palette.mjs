// Task studio-train-armor-palette-20261113-213306-01: THE TRAIN ARMOUR'S PALETTE — a deterministic colour grade of the armour models'
// own Meshy base colour maps (processing of the generated maps, not authoring: no generation, no repaint, no reprojection; the mesh,
// its UVs, the metallic-roughness map and the normal map are not touched).
// User: the rusty metal should blend more seamlessly with the cleaner train — "mostly a color issue". Bring the heavy uniform
// orange-brown closer to the car's weathered grey / steel / off-white, keep rusty detail and accents, texture and PBR character.
//
// The grade (per texel, in OKLab; every number is ARMOR_PALETTE's):
//  - RUST WEIGHT w: the texel's chroma (a small box mean of it, so rust stays in patches rather than single texels) between two
//    QUANTILES of that map's own chroma — the map's most saturated texels stay rust, the uniform brown between them becomes steel.
//    Each map is read against itself, so every piece keeps about the same share of rust whatever its own cast.
//  - STEEL (w = 0): a statistics transfer onto the car body's own light steel (TARGET: the mean of the low-chroma texels of
//    assets/models/player-train-shell.glb's base colour map from lightness 0.55 up — its grey and off-white body, 27 % of that
//    map, sRGB about 157, 159, 155). The map's median lightness lands on the target's and its mean hue on the target's; the texel's
//    own lightness structure is kept (contrast 1, a soft shoulder under white) and a share of its own colour variation around the
//    map's mean, so the steel is never one flat grey. The kit's steel is partly metallic in Meshy's own metallic-roughness map
//    (kept as it is), so it draws darker than this albedo: in the game's renderer it sits at the car's grey waist band.
//  - RUST (w = 1): the texel as generated, its chroma eased a little and a part of the steel's lightness lift (orange rust on
//    light steel rather than dark stains).
//  - HAZARD paint (very high chroma: the yellow stripes) is kept exactly as generated.
// Dark texels keep their depth: the lift fades out toward black, so seams, pits and shadowed recesses stay dark.
//
// Used by the armour models' two cooks (build-refinement-batch.mjs: the skirt strip and the fin grille; build-train-armor-makeover.mjs:
// the plate, the post, the wing and the rail) BEFORE their Lanczos downsize + JPEG encode, so the grade runs once on the raw master's
// full-size map. The raw masters stay untouched outside Git; each cook records the grade in its provenance JSON.

/** The grade's identity and numbers (recorded in the cooks' provenance; a change here re-cooks all six armour models). */
export const ARMOR_PALETTE = Object.freeze({
  id: 'train-armor-palette-20261113',
  task: 'studio-train-armor-palette-20261113-213306-01',
  version: 1,
  space: 'OKLab',
  /** The steel's centre: the car body's light steel (see above). game/tests/train-armor-palette.test.ts measures it on the shipped
   *  shell. */
  target: Object.freeze({L: 0.70, a: -0.0047, b: 0.0047}),
  /** Rust weight: 0 at the `lo` quantile of the map's own chroma, 1 at the `hi` quantile (smoothstep); the chroma it reads is a
   *  (2 * blur + 1)^2 box mean at the reference size `at` px (scaled with the map). `keep`: the chroma a rust texel keeps; `lift`:
   *  the share of the steel's lightness change it takes. */
  rust: Object.freeze({lo: 0.62, hi: 0.94, blur: 4, at: 2048, keep: 0.9, lift: 0.35}),
  /** Steel: `variation` of the texel's own (a, b) offset from the map's mean kept around the target; lightness = target.L +
   *  (L - the map's median L) * contrast, eased under `shoulder[1]` from `shoulder[0]` up (never darker than generated) and fading
   *  in over the `shadow` lightness range (dark texels stay dark). */
  steel: Object.freeze({variation: 0.35, contrast: 1.0, shoulder: Object.freeze([0.8, 0.93]), shadow: Object.freeze([0.1, 0.45])}),
  /** Hazard paint: texels over this chroma range are kept exactly as generated. */
  hazard: Object.freeze([0.085, 0.11]),
});

const SRGB_TO_LINEAR = Float64Array.from({length: 256}, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb8 = v => { const c = v <= 0 ? 0 : v >= 1 ? 1 : v; return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); };
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** sRGB 8-bit -> OKLab [L, a, b] written at out[o..o+2]. */
function toOklab(r, g, b, out, o) {
  const R = SRGB_TO_LINEAR[r], G = SRGB_TO_LINEAR[g], B = SRGB_TO_LINEAR[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}
/** OKLab -> sRGB 8-bit (clamped to the gamut per channel) written at out[o..o+2]. */
function fromOklab(L, a, b, out, o) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[o] = toSrgb8(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  out[o + 1] = toSrgb8(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  out[o + 2] = toSrgb8(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

/** A (2r + 1)^2 box mean of a w x h float field (edges clamped), separable. */
function boxMean(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / n;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** The value at fraction `p` of a field's sorted values (a 4096-bin histogram over [0, max]); `stride` reads every n-th element. */
function percentile(field, p, max, stride = 1) {
  const bins = 4096, hist = new Uint32Array(bins);
  let count = 0;
  for (let i = 0; i < field.length; i += stride, count++) hist[Math.min(bins - 1, Math.max(0, Math.floor(field[i] / max * bins)))]++;
  let need = p * count;
  for (let k = 0; k < bins; k++) { need -= hist[k]; if (need <= 0) return (k + 0.5) / bins * max; }
  return max;
}

/**
 * The grade of one base colour map: `rgb` = its texels (sRGB 8-bit, 3 channels, w x h). Returns the graded texels (a new buffer) and
 * what the grade measured (the map's own chroma thresholds, median lightness and mean hue, its mean colour before / after, the share
 * of texels left as rust).
 */
export function gradeArmorBaseColor(rgb, w, h, P = ARMOR_PALETTE) {
  const n = w * h;
  if (rgb.length !== n * 3) throw new Error(`armor-palette: expected ${n * 3} bytes of RGB, got ${rgb.length}`);
  const lab = new Float32Array(n * 3), chroma = new Float32Array(n);
  let ma = 0, mb = 0, plain = 0;
  for (let i = 0; i < n; i++) {
    toOklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], lab, i * 3);
    const c = chroma[i] = Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]);
    if (c < P.hazard[0]) { ma += lab[i * 3 + 1]; mb += lab[i * 3 + 2]; plain++; }
  }
  ma /= plain || 1; mb /= plain || 1;
  const lo = percentile(chroma, P.rust.lo, 0.4), hi = Math.max(percentile(chroma, P.rust.hi, 0.4), lo + 1e-4);
  const medL = percentile(lab, 0.5, 1, 3);
  const patch = boxMean(chroma, w, h, Math.round(P.rust.blur * w / P.rust.at));
  const out = new Uint8Array(n * 3), S = P.steel, T = P.target, knee = S.shoulder[0], span = S.shoulder[1] - S.shoulder[0];
  const sum = {before: [0, 0, 0], after: [0, 0, 0]};
  let rust = 0;
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    const keep = smoothstep(P.hazard[0], P.hazard[1], chroma[i]); // (hazard paint: the generated texel itself)
    const wr = smoothstep(lo, hi, patch[i]);
    let Lt = T.L + (L - medL) * S.contrast;
    if (Lt > knee) Lt = knee + span * (1 - Math.exp(-(Lt - knee) / span)); // (the shoulder: light worn edges stay under white)
    const Ls = L + (Math.max(Lt, L) - L) * smoothstep(S.shadow[0], S.shadow[1], L);
    const as = T.a + (a - ma) * S.variation, bs = T.b + (b - mb) * S.variation;
    const Lr = L + (Ls - L) * P.rust.lift;
    const L1 = Ls + (Lr - Ls) * wr, a1 = as + (a * P.rust.keep - as) * wr, b1 = bs + (b * P.rust.keep - bs) * wr;
    fromOklab(L1 + (L - L1) * keep, a1 + (a - a1) * keep, b1 + (b - b1) * keep, out, i * 3);
    if (Math.max(wr, keep) >= 0.5) rust++;
    for (let c = 0; c < 3; c++) { sum.before[c] += SRGB_TO_LINEAR[rgb[i * 3 + c]]; sum.after[c] += SRGB_TO_LINEAR[out[i * 3 + c]]; }
  }
  const mean = s => s.map(v => toSrgb8(v / n));
  return {rgb: out, stats: {chromaLo: +lo.toFixed(4), chromaHi: +hi.toFixed(4), medianL: +medL.toFixed(4), meanAB: [+ma.toFixed(4), +mb.toFixed(4)],
    rustShare: +(rust / n).toFixed(4), meanBefore: mean(sum.before), meanAfter: mean(sum.after)}};
}

/**
 * Grade a glTF-Transform document's ONE material's base colour map in place (decoded with `sharp`, graded, stored as lossless PNG for
 * the cook's own downsize + JPEG encode). Returns the provenance record of the step. Nothing else of the document is read or written.
 */
export async function applyArmorPalette(doc, sharp, sha256, P = ARMOR_PALETTE) {
  const mats = doc.getRoot().listMaterials();
  if (mats.length !== 1) throw new Error(`armor-palette: expected one material, found ${mats.length}`);
  const tex = mats[0].getBaseColorTexture();
  if (!tex) throw new Error('armor-palette: the material has no base colour map');
  if (tex === mats[0].getMetallicRoughnessTexture() || tex === mats[0].getNormalTexture()) throw new Error('armor-palette: the base colour map is shared with another slot');
  const src = Buffer.from(tex.getImage());
  const {data, info} = await sharp(src).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject: true});
  if (info.channels !== 3) throw new Error(`armor-palette: expected 3 channels, got ${info.channels}`);
  const {rgb, stats} = gradeArmorBaseColor(data, info.width, info.height, P);
  const png = await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), {raw: {width: info.width, height: info.height, channels: 3}}).png({compressionLevel: 6}).toBuffer();
  tex.setImage(new Uint8Array(png)).setMimeType('image/png');
  return {id: P.id, version: P.version, source: {slot: 'baseColor', sha256: sha256(src), bytes: src.length, size: [info.width, info.height]}, ...stats};
}

/** The grade as the cooks' top-level provenance record. */
export function armorPaletteRecord(P = ARMOR_PALETTE) {
  return {id: P.id, version: P.version, task: P.task, by: 'tools/asset-pipeline/props/lib/armor-palette.mjs',
    what: 'a deterministic colour grade of the train armour models\' own Meshy base colour maps toward the car body\'s own light steel (rust kept as accents, hazard paint kept); material only: geometry, UVs, metallic-roughness and normal maps unchanged; no generation',
    approval: 'user direction for task ' + P.task + ': a colour / material pass with existing models and maps, non-generative, no paid calls',
    space: P.space, target: {...P.target}, rust: {...P.rust}, steel: {...P.steel, shoulder: [...P.steel.shoulder], shadow: [...P.steel.shadow]}, hazard: [...P.hazard]};
}

/** The grade as its provenance text (one line; the numbers are ARMOR_PALETTE's). */
export function armorPaletteNote(P = ARMOR_PALETTE) {
  return `base colour graded by tools/asset-pipeline/props/lib/armor-palette.mjs (${P.id} v${P.version}, task ${P.task}): a deterministic per-texel ${P.space} grade of Meshy's own map — texels whose chroma (its ${2 * P.rust.blur + 1}x${2 * P.rust.blur + 1} box mean at ${P.rust.at} px) is below the map's own ${P.rust.lo} chroma quantile become weathered steel (the map's median lightness and mean hue moved onto the car body's own light steel, ${P.steel.variation} of the texel's own colour variation kept), those above its ${P.rust.hi} quantile stay rust (chroma x${P.rust.keep}, ${P.rust.lift} of the steel's lightness lift), a smooth blend between; hazard paint (chroma over ${P.hazard[1]}) kept as generated; no generation, repaint or reprojection`;
}
