// Task studio-train-armor-palette-20261113-213306-01: THE TRAIN ARMOUR'S PALETTE (user: the 67-piece kit's shape is liked; its rusty
// metal should blend more seamlessly with the cleaner train — "mostly a color issue"; no model generation). A material-only pass: the
// six armour models' own Meshy base colour maps carry a deterministic grade (tools/asset-pipeline/props/lib/armor-palette.mjs) toward
// the car body's own light steel, with rust kept as accents and the hazard paint kept.
//  - THE GRADE on a small synthetic map: uniform brown becomes steel on the target, the most saturated texels stay rust, hazard paint
//    is not touched, light edges stay under white, black stays black; pure and deterministic;
//  - THE TARGET is the car body's own grey / off-white steel, measured here on the shipped shell;
//  - THE COOKED MODELS: nothing but the base colour image changed — the mesh (every vertex attribute, the UVs, the indices), the
//    node / material settings, the metallic-roughness and normal maps are the approved kit's, byte for byte; the base colour is now
//    mostly neutral steel around the body's own with a share of rust, the hazard paint and the lightness range kept;
//  - PROVENANCE: both cooks record the grade, the raw masters are the same files, the throwables are untouched;
//  - EXISTING SAVES: the armoured record and the model files' names are unchanged, so a save shows the new palette as it loads.
// (The kit's geometry, clearances, collision and the save round trip: tests/train-armor-makeover.test.ts, tests/train-armor.test.ts,
// tests/train-armor-save.test.ts.)
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {GRENADE_MODELS} from '../src/assets/grenades.generated';
import {PLAYER_TRAIN_MODELS} from '../src/assets/playerTrain.generated';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {ARMOR_MODELS, ARMOR_MODEL_IDS, type ArmorModelId} from '../src/world/trainArmorLayout';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface Palette {
  id: string; version: number; task: string; space: string;
  target: {L: number; a: number; b: number};
  rust: {lo: number; hi: number; blur: number; at: number; keep: number; lift: number};
  steel: {variation: number; contrast: number; shoulder: readonly [number, number]; shadow: readonly [number, number]};
  hazard: readonly [number, number];
}
interface GradeStats { chromaLo: number; chromaHi: number; medianL: number; meanAB: [number, number]; rustShare: number; meanBefore: number[]; meanAfter: number[] }
interface PaletteLib {
  ARMOR_PALETTE: Palette;
  gradeArmorBaseColor(rgb: Uint8Array, w: number, h: number, P?: Palette): {rgb: Uint8Array; stats: GradeStats};
  armorPaletteRecord(): Record<string, unknown>;
}
let lib: PaletteLib;
beforeAll(async () => { lib = await import(pathToFileURL(repo('tools/asset-pipeline/props/lib/armor-palette.mjs')).href) as PaletteLib; });

// --- colour helpers (OKLab, as the grade reads it) ------------------------------------------------------------------------
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const labAt = (rgb: Uint8Array, i: number) => oklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
const chromaOf = (q: readonly number[]) => Math.hypot(q[1], q[2]);
const hueOf = (q: readonly number[]) => Math.atan2(q[2], q[1]) * 180 / Math.PI;

/** What a base colour map looks like, in the grade's own terms. */
function paletteFacts(rgb: Uint8Array) {
  const n = rgb.length / 3, Ls = new Float32Array(n);
  let sa = 0, sb = 0, neutral = 0, na = 0, nb = 0, rust = 0, hazard = 0;
  for (let i = 0; i < n; i++) {
    const q = labAt(rgb, i), C = chromaOf(q), h = hueOf(q);
    Ls[i] = q[0]; sa += q[1]; sb += q[2];
    if (C < 0.03) { neutral++; na += q[1]; nb += q[2]; }
    if (C >= 0.045 && C < 0.11 && h > 20 && h < 80) rust++; // orange-brown, short of the hazard paint
    if (C >= 0.11) hazard++;
  }
  Ls.sort();
  return {medianL: Ls[n >> 1], L5: Ls[Math.floor(n * 0.05)], L95: Ls[Math.floor(n * 0.95)], chromaOfMean: Math.hypot(sa / n, sb / n),
    neutralShare: neutral / n, neutralAB: [na / (neutral || 1), nb / (neutral || 1)] as const, rustShare: rust / n, hazardShare: hazard / n};
}

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function baseColorOf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await io().readBinary(bytes);
  const {data, info} = await sharp(Buffer.from(doc.getRoot().listMaterials()[0].getBaseColorTexture()!.getImage()!)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  expect(info.channels).toBe(3);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// ---------------------------------------------------------------------------------------------
describe('train armour palette: the grade', () => {
  // a 64 x 64 map: 40 rows of the uniform brown (a ramp in x), 4 of light worn edges, 12 of saturated rust, 2 of hazard yellow, 3 of
  // dark seams, 3 of black
  const W = 64, H = 64;
  const ROWS = {brown: [0, 40], worn: [40, 44], rust: [44, 56], hazard: [56, 58], dark: [58, 61], black: [61, 64]} as const;
  function synthetic(): Uint8Array {
    const rgb = new Uint8Array(W * H * 3);
    const put = (i: number, c: readonly number[]) => { rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = x / (W - 1);
      if (y < ROWS.brown[1]) put(i, [100 + 35 * t, 75 + 26 * t, 60 + 21 * t].map(Math.round));
      else if (y < ROWS.worn[1]) put(i, [185, 168, 158]);
      else if (y < ROWS.rust[1]) put(i, [132 + Math.round(8 * t), 88, 62 - Math.round(6 * t)]);
      else if (y < ROWS.hazard[1]) put(i, [225, 165, 25]);
      else if (y < ROWS.dark[1]) put(i, [40, 30, 25]);
      else put(i, [8, 6, 5]);
    }
    return rgb;
  }
  const rowsOf = (k: keyof typeof ROWS) => { const out: number[] = []; for (let y = ROWS[k][0]; y < ROWS[k][1]; y++) for (let x = 0; x < W; x++) out.push(y * W + x); return out; };

  it('uniform brown becomes steel on the target, the most saturated texels stay rust, hazard paint and black are left alone', () => {
    const P = lib.ARMOR_PALETTE, src = synthetic(), keepSrc = src.slice();
    const {rgb, stats} = lib.gradeArmorBaseColor(src, W, H);
    const lift = P.target.L - stats.medianL; // (what the steel's lightness gains: the map's median onto the target's)
    expect(lift).toBeGreaterThan(0.08);
    expect(src).toEqual(keepSrc); // (the input is read only)
    expect(rgb).toHaveLength(src.length);
    expect(stats.chromaLo).toBeGreaterThan(0.04);
    expect(stats.chromaHi).toBeGreaterThan(stats.chromaLo + 0.01);
    expect(stats.chromaHi).toBeLessThan(P.hazard[0]);
    let steel = 0, rust = 0;
    for (const i of rowsOf('brown')) {
      const q = labAt(src, i), o = labAt(rgb, i);
      if (chromaOf(q) > stats.chromaLo - 0.001) { // the blend toward rust: never past either end
        expect(chromaOf(o)).toBeLessThan(chromaOf(q));
        continue;
      }
      steel++;
      // steel: near neutral around the target's hue, the map's median lightness moved onto the target's (the lightness structure kept)
      expect(chromaOf(o), `brown ${i}`).toBeLessThan(0.012);
      expect(Math.hypot(o[1] - P.target.a, o[2] - P.target.b), `brown ${i}`).toBeLessThan(0.012);
      expect(o[0] - q[0], `brown ${i}`).toBeCloseTo(lift, 1.9);
    }
    for (const i of rowsOf('rust')) {
      const q = labAt(src, i), o = labAt(rgb, i);
      if (chromaOf(q) < stats.chromaHi) continue;
      rust++;
      // rust: the texel's own hue, its chroma eased, a part of the steel's lift
      expect(o[0] - q[0], `rust ${i}`).toBeCloseTo(P.rust.lift * lift, 1.9);
      expect(Math.abs(hueOf(o) - hueOf(q)), `rust ${i}`).toBeLessThan(3);
      expect(chromaOf(o) / chromaOf(q), `rust ${i}`).toBeGreaterThan(P.rust.keep - 0.06);
      expect(chromaOf(o) / chromaOf(q), `rust ${i}`).toBeLessThan(P.rust.keep + 0.06);
    }
    expect(steel).toBeGreaterThan(W * 20);
    expect(rust).toBeGreaterThan(W / 2); // (the top of the rust rows' own ramp)
    // hazard paint: the generated texel itself
    for (const i of rowsOf('hazard')) expect([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], `hazard ${i}`).toEqual([225, 165, 25]);
    // light worn edges go to light steel: lighter than the brown's steel, far less orange than they were, eased under white
    for (const i of rowsOf('worn')) {
      const o = labAt(rgb, i);
      expect(o[0], `worn ${i}`).toBeGreaterThan(P.target.L + 0.1);
      expect(o[0], `worn ${i}`).toBeLessThan(P.steel.shoulder[1]);
      expect(chromaOf(o), `worn ${i}`).toBeLessThan(0.015);
    }
    // the dark end keeps its depth: black does not move, a dark seam is lifted far less than the brown is
    for (const i of rowsOf('black')) { const q = labAt(src, i), o = labAt(rgb, i); expect(Math.abs(o[0] - q[0]), `black ${i}`).toBeLessThan(0.012); }
    for (const i of rowsOf('dark')) { const q = labAt(src, i), o = labAt(rgb, i); expect(o[0] - q[0], `dark ${i}`).toBeLessThan(lift * 0.5); expect(o[0], `dark ${i}`).toBeLessThan(0.36); }
    expect(stats.rustShare).toBeGreaterThan(0.15); // (the rust and hazard rows, a little of the blend)
    expect(stats.rustShare).toBeLessThan(0.4);
    // the map's mean colour: from orange-brown to near neutral
    expect(stats.meanBefore[0] - stats.meanBefore[2]).toBeGreaterThan(30);
    expect(stats.meanAfter[0] - stats.meanAfter[2]).toBeLessThan(stats.meanBefore[0] - stats.meanBefore[2] - 15);
  });

  it('is pure and deterministic; a wrong buffer is refused', () => {
    const a = lib.gradeArmorBaseColor(synthetic(), W, H), b = lib.gradeArmorBaseColor(synthetic(), W, H);
    expect(sha(a.rgb)).toBe(sha(b.rgb));
    expect(a.stats).toEqual(b.stats);
    expect(() => lib.gradeArmorBaseColor(new Uint8Array(W * H * 4), W, H)).toThrow(/expected/);
  });

  it('its target is the car body\'s own light steel (the shipped shell\'s low-chroma texels from lightness 0.55 up: its grey and off-white body)', async () => {
    const rgb = await baseColorOf(readFileSync(pub(PLAYER_TRAIN_MODELS['player-train-shell'].url)));
    let n = 0, L = 0, a = 0, b = 0;
    for (let i = 0; i < rgb.length / 3; i++) {
      const q = labAt(rgb, i);
      if (chromaOf(q) >= 0.04 || q[0] < 0.55) continue;
      n++; L += q[0]; a += q[1]; b += q[2];
    }
    expect(n).toBeGreaterThan(rgb.length / 3 * 0.2); // (a real share of the shell's map: 27 %)
    const T = lib.ARMOR_PALETTE.target;
    expect(Math.abs(L / n - T.L)).toBeLessThan(0.01);
    expect(Math.abs(a / n - T.a)).toBeLessThan(0.001);
    expect(Math.abs(b / n - T.b)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour palette: the cooked models', () => {
  // The approved kit's data (main 7948de0e, PR #109), hashed: `mesh` = every vertex attribute (name + bytes, in name order) and the
  // indices of the one primitive; the two maps the grade never reads; `was` = the base colour image before this task; `hazard` =
  // the share of hazard-paint texels it had (0: none worth counting).
  const KIT: Record<ArmorModelId, {mesh: string; metallicRoughness: string; normal: string; was: string; hazard: number}> = {
    strip: {mesh: '1af2f1dfbd97eb2e3905133d1efa810f83995ab9696f96c40937b2a9e0e450f5', metallicRoughness: '660049433c86849faebd4e3343e41f83815564a6653b38cb8dbb901226f92d35', normal: 'cb4d9ac5d2893f0e9e4ce289e1936f6e39e3969e7c1121b8428999b328b193b2', was: 'e501329d2e460db15b16be6bb12ea8ece6622da9e924781ad5cb94b4aae32b96', hazard: 0},
    grille: {mesh: '6237e7ab088336d467385fa942936b7bfcfaa76f3b9b7db4dc65b3dd5545c888', metallicRoughness: 'acbd856c258f0504e69de26cbf5f90dbae953eb925beb777006a6de5a18d99b2', normal: '823255f77edbe8bc8fe939a16e1861678a90a25ad6cc30097b77b02a5728c4b7', was: '71a6d514fc04d5d4477a67bd460222bfc334ab0208cecbbb9259a8dcdfdcd067', hazard: 0},
    plate: {mesh: 'eba7e43c7613f3dea71259fcf9ae24662154f6ab939f18780fb23547194d2def', metallicRoughness: 'dd4a94cf2b4d7104c5f9ffb21376e5a0cd71bd406e80b0e3f3289bce953d1dc1', normal: '842568f08901e396baef09be9cc762ddfe15326d7a8e8f47083f3e529d7ce745', was: '6edd25ace3dbe5f8d0877d3a424d832b145acd75ec3b1b5f0286ec5ce9c27d6c', hazard: 0.0029},
    post: {mesh: 'd8688f2d4ad66093212a883d08570c5522e5950a789d40b25712a2aa15945335', metallicRoughness: '465fc08e45782036692eb9f4d73e357b79044afbc02590c2da27657f99c696f6', normal: '40c7f5bfd723edb853c813f1ef5355ef22d87c29574e731874d09ee374a5092d', was: 'f113a2288b963346cdea6705918688a6ec5202b2d636cb2b9253221e5e77fd5d', hazard: 0.0017},
    wing: {mesh: '29b36ef4856d47078954e45335c751d2130c7decef15c12c88ed8302d74a6a6d', metallicRoughness: '9cc3fae7fe382af5bb67c82fb1826bc361c365c2c35d6f532f613eff9c157306', normal: 'df42cd603549ca951ebd8e357e29188ef48a418e2dd9cd9bacc2bb51ca6787d9', was: '187e39cc8a3525ea9c2bfca2ae5ab49671cdb36b9b90f257d8480b6cbec4d879', hazard: 0.0046},
    rail: {mesh: 'c82931514f5b8ebc30b216b34d018e8f22884200f31ec73e7439e530263d214f', metallicRoughness: '05eb2ad8391e23bfa7b33eb3671f5cb03d763f5e9f48ab3f438a271fd135d4c3', normal: 'bd4e7f873afea608c65da18e840989d6670bb1c39cac0af62385bbe50aa1ac90', was: 'a94785fa847b001802299b3b3cc901f67c691e67ddfd2c7979206a34caa4a933', hazard: 0},
  };
  /** The raw masters (outside Git) the cooks read: the same files as before this task. */
  const RAW: Record<ArmorModelId, string> = {
    strip: '5769b6710cb8d06830f14cafbc83215ffdb61809c267157c7d38ff23c600e188', grille: '3d6a8ffbeaebbfe81831ca594cb9310acb5ec2981696fe248089ea6b9a403b89',
    plate: 'd37291ffc3463c9360d74b7de766b7ceb3ef96ab74f4c159d99a893f9c433763', post: 'e9d13e07294b444527ee1d4e03b8a984014e3c8b1a0ab5ccad142bd9a862718e',
    wing: '098324d7d8029396db59ace851045afaaa7df04b8c8c0190c02ed123e172d8dc', rail: '8ceff13de1ffc1671f9b726e7b20f069d06efb83f3d15d3ac9d63252a1d0ae41',
  };
  const SIDECARS = {batch: 'assets/derivatives/refinement-batch-20261113.json', makeover: 'assets/derivatives/train-armor-makeover-20261113.json'} as const;
  const sidecarOf = (id: ArmorModelId) => (id === 'strip' || id === 'grille' ? SIDECARS.batch : SIDECARS.makeover);

  it('covers the whole kit', () => {
    expect([...ARMOR_MODEL_IDS].sort()).toEqual(Object.keys(KIT).sort());
  });

  it('only the base colour image changed: the mesh, the UVs, the settings, the metallic-roughness and normal maps are the approved kit\'s', async () => {
    for (const id of ARMOR_MODEL_IDS) {
      const doc = await io().readBinary(new Uint8Array(readFileSync(pub(ARMOR_MODELS[id].url)))), root = doc.getRoot();
      const prims = root.listMeshes().flatMap(m => m.listPrimitives()), mats = root.listMaterials();
      expect([root.listMeshes().length, prims.length, mats.length, root.listTextures().length], id).toEqual([1, 1, 1, 3]);
      const h = createHash('sha256');
      for (const sem of prims[0].listSemantics().sort()) { const a = prims[0].getAttribute(sem)!.getArray()!; h.update(sem).update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); }
      const idx = prims[0].getIndices()!.getArray()!;
      h.update('indices').update(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength));
      expect(prims[0].listSemantics().sort(), id).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
      expect(h.digest('hex'), `${id} mesh`).toBe(KIT[id].mesh);
      const m = mats[0];
      expect({base: m.getBaseColorFactor(), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), emissive: m.getEmissiveFactor(), alpha: m.getAlphaMode(), doubleSided: m.getDoubleSided(), normalScale: m.getNormalScale()}, id)
        .toEqual({base: [1, 1, 1, 1], metallic: 1, roughness: 1, emissive: [0, 0, 0], alpha: 'OPAQUE', doubleSided: true, normalScale: 1});
      expect(sha(m.getMetallicRoughnessTexture()!.getImage()!), `${id} metallic-roughness`).toBe(KIT[id].metallicRoughness);
      expect(sha(m.getNormalTexture()!.getImage()!), `${id} normal`).toBe(KIT[id].normal);
      const base = m.getBaseColorTexture()!;
      expect(sha(base.getImage()!), `${id} base colour`).not.toBe(KIT[id].was);
      expect([base.getMimeType(), base.getSize()], id).toEqual(['image/jpeg', [1024, 1024]]);
    }
  });

  it('the base colour: mostly neutral steel around the car body\'s own, rust as accents, hazard paint and the lightness range kept', async () => {
    const T = lib.ARMOR_PALETTE.target;
    for (const id of ARMOR_MODEL_IDS) {
      const f = paletteFacts(await baseColorOf(new Uint8Array(readFileSync(pub(ARMOR_MODELS[id].url)))));
      // (before the grade: 0.3-30 % of the texels neutral, 17-87 % rust-coloured, the mean colour's chroma 0.035-0.054)
      expect(f.neutralShare, `${id} neutral share`).toBeGreaterThan(0.8);
      expect(Math.hypot(f.neutralAB[0] - T.a, f.neutralAB[1] - T.b), `${id} steel hue`).toBeLessThan(0.004);
      expect(f.chromaOfMean, `${id} mean chroma`).toBeLessThan(0.015);
      expect(Math.abs(f.medianL - T.L), `${id} median lightness`).toBeLessThan(0.08);
      // rust is still there, as accents rather than the whole surface
      expect(f.rustShare, `${id} rust share`).toBeGreaterThan(0.03);
      expect(f.rustShare, `${id} rust share`).toBeLessThan(0.15);
      // never one flat grey: the dark seams and the light worn edges are both still in the map (a wider range than the brown
      // had: 0.21-0.36), the light end under white
      expect(f.L5, `${id} dark end`).toBeLessThan(0.55);
      expect(f.L95, `${id} light end`).toBeGreaterThan(0.78);
      expect(f.L95, `${id} light end`).toBeLessThan(lib.ARMOR_PALETTE.steel.shoulder[1]);
      expect(f.L95 - f.L5, `${id} lightness range`).toBeGreaterThan(0.25);
      if (KIT[id].hazard) expect(f.hazardShare / KIT[id].hazard, `${id} hazard paint`).toBeGreaterThan(0.9);
    }
  });

  it('provenance: both cooks record the grade over the same raw masters; CREDITS says so; the throwables are untouched', () => {
    const record = lib.armorPaletteRecord(), credits = readFileSync(pub('assets/CREDITS.md'), 'utf8');
    const prov = Object.fromEntries(Object.entries(SIDECARS).map(([k, rel]) => [k, JSON.parse(readFileSync(pub(rel), 'utf8'))])) as Record<keyof typeof SIDECARS, {palette: Record<string, unknown>; models: {id: string}[]}>;
    expect(record).toMatchObject({id: 'train-armor-palette-20261113', version: 1, task: 'studio-train-armor-palette-20261113-213306-01', by: 'tools/asset-pipeline/props/lib/armor-palette.mjs'});
    expect(prov.makeover.palette).toEqual(record);
    expect(prov.batch.palette).toEqual({...record, models: ['train-armor-side', 'train-armor-end']});
    for (const id of ARMOR_MODEL_IDS) {
      const M = ARMOR_MODELS[id], bytes = readFileSync(pub(M.url));
      const m = prov[id === 'strip' || id === 'grille' ? 'batch' : 'makeover'].models.find((q: {id: string}) => q.id === M.key) as unknown as {
        source: {sha256: string; textures: {size: number[]}[]}; output: {sha256: string; bytes: number}; texturePolicy: string;
        palette: {id: string; version: number; source: {slot: string; sha256: string; size: number[]}; rustShare: number; meanBefore: number[]; meanAfter: number[]};
        textures: {slot: string; sha256: string}[];
      };
      expect(m, `${id} in ${sidecarOf(id)}`).toBeTruthy();
      expect(m.source.sha256, `${id} raw master`).toBe(RAW[id]);
      expect(m.output, id).toMatchObject({sha256: sha(bytes), bytes: bytes.length});
      expect(M.bytes, id).toBe(bytes.length);
      expect(m.palette, id).toMatchObject({id: record.id, version: 1, source: {slot: 'baseColor', size: [2048, 2048]}});
      expect(m.palette.source.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(m.palette.rustShare, id).toBeGreaterThan(0.08);
      expect(m.palette.rustShare, id).toBeLessThan(0.2);
      // the recorded mean colour: orange-brown before (red well over blue), near neutral after
      expect(m.palette.meanBefore[0] - m.palette.meanBefore[2], id).toBeGreaterThan(30);
      expect(Math.abs(m.palette.meanAfter[0] - m.palette.meanAfter[2]), id).toBeLessThan(10);
      expect(m.texturePolicy, id).toMatch(/Meshy maps kept/);
      expect(m.texturePolicy, id).toMatch(/metallic-roughness and normal channel for channel/);
      expect(m.texturePolicy, id).toMatch(/lib\/armor-palette\.mjs .*deterministic.*no generation, repaint or reprojection/);
      const tex = Object.fromEntries(m.textures.map(t => [t.slot, t.sha256]));
      expect([tex.metallicRoughness, tex.normal], id).toEqual([KIT[id].metallicRoughness, KIT[id].normal]);
      expect(tex.baseColor, id).not.toBe(KIT[id].was);
    }
    expect(credits.match(/palette grade `train-armor-palette-20261113`/g)).toHaveLength(2);
    // the batch's two throwables: no grade, their files as they were
    const was = {acid: '4a8dd2990a36587498df1d48fb044edb8815fff5063d813190f6d1bdd71e8868', lure: 'b8d078baded6b68b2e6092047aa3ee2baa96ea3193fddbf24e33badcf6d1f01e'} as const;
    for (const k of ['acid', 'lure'] as const) {
      const G = GRENADE_MODELS[k], m = prov.batch.models.find((q: {id: string}) => q.id === G.key) as unknown as {palette?: unknown; texturePolicy: string};
      expect(sha(readFileSync(pub(G.url))), k).toBe(was[k]);
      expect(m.palette, k).toBeUndefined();
      expect(m.texturePolicy, k).toMatch(/channel for channel.*no reprojection \/ retexture \/ repaint/);
    }
  });

  it('an existing armoured save shows the new palette as it loads: the same record, the same model files', () => {
    const record = new PlayerTrainRecord();
    record.upgrades.load({v: 1, fitted: ['armor']});
    expect(record.upgrades.has('armor')).toBe(true);
    expect(record.upgrades.toJSON()).toEqual({v: 1, fitted: ['armor']});
    expect(Object.fromEntries(ARMOR_MODEL_IDS.map(id => [id, ARMOR_MODELS[id].url]))).toEqual({
      strip: 'assets/models/train-armor-side.glb', grille: 'assets/models/train-armor-end.glb', plate: 'assets/models/train-armor-plate.glb',
      post: 'assets/models/train-armor-post.glb', wing: 'assets/models/train-armor-wing.glb', rail: 'assets/models/train-armor-rail.glb',
    });
  });
});
