// Zombie wardrobe configuration (iteration 06): bodies + slot wearables are data. Add an entry (and a
// source) and rerun build-wardrobe.mjs. Slots: upper (torso garments), lower (pants), head (hats /
// helmets), face (masks / respirators). Kinds = fitting method:
//   garment - lib/garment.mjs canonical fit + lib/fit.mjs per-body retarget (sleeved/sleeveless tops)
//   pants   - lib/pants.mjs radial leg/waist profile fit, per body directly
//   rigid   - lib/rigid.mjs rigid head/face item (scale to the head, drop/forward contact solve), 100% Head weights
// Newly generated sources are resolved from Lane G's per-asset ledger (native GLB path + sha256), so each
// asset is picked up as soon as it lands; iteration-05 sources from the iteration-05 ledger.
import fs from 'node:fs';
import path from 'node:path';
import {REPO, MASTERS} from './lib/master.mjs';
import {OUTFITS as OUTFITS05} from './variants.config.mjs';
import {t25Source, T25_SUFFIX} from './lib/t25.mjs';

// ---- Meshy T2.5 migration (task studio-meshy-game-replacement-20261029-01, lane CHARS) -------------------------
// Each entry switches one body / wearable from its old local Pixal3D master to the ACCEPTED Meshy T2.5 native GLB
// (reference/tasks/meshy-game-replacement-20261029/assets/DELIVERED.json), pinned by sha256 + attempt. Added only when
// that asset's replacement is integrated; everything else keeps its old master. A pinned source that is missing or
// differs fails the build (never a silent fallback). Bodies: facing auto-detected; wearables: Meshy outputs face +Z
// (verified on the delivery contact views), the old Pixal3D sources faced -Z.
// densify: max edge after densification as a fraction of the source bbox height (lib/densify.mjs):
//   bodies 0.0045 (~8 mm at 1.78 m), wearables 0.007 (~8 mm in the 1.2-unit nominal garment space).
export const T25 = {
  heavyset: {asset: 'body:heavyset', attempt: 'a1', sha256: 'a88bad7d4f74038fd4b3f383eefdda5565c2aef21c7f88093c67478c2b9f738c'},
  // batch2-chars (lanes/batches/batch2-chars.json): remaining bodies (a-pose) and wearables, accepted deliveries
  lastshift: {asset: 'body:lastshift', attempt: 'a1', sha256: 'ec77a1c28537a87d68ae4ea496a6dd48427051b5e195365999fc6804730b0d1b'},
  courier: {asset: 'body:courier', attempt: 'a1', sha256: '5608e648e52874a5d28f61c0117464353f47374449ae433b995eaec8636c8cde'},
  // agent a1 (task 01a189d5-31ae-7673-a7d7-ba1449455a77) was flagged: head tilted back ~20-30 deg (hats over the eyes);
  // a2 = the primary-approved replacement (lanes/batches/replace-2.json), head level like the original
  agent: {asset: 'body:agent', attempt: 'a2', sha256: '6721c5404914a7f072338e903959d8221414c7ed3230ff52f0d9491525703c0a'},
  tall: {asset: 'body:tall', attempt: 'a1', sha256: 'dfd58b18c055c0aab164daa41ba06bf8de381f136aa49fc925efd22f06c01875'},
  scavenger: {asset: 'body:scavenger', attempt: 'a1', sha256: 'b93da7c038fded9b23edf88ce9e139adbc0af06148b5cd818b03fe0b630d5892'}, // RECREATED reference (user update 01), not an original
  coat: {asset: 'garment:coat', attempt: 'a1', sha256: '8dab13875cc683af3a3eaba4c2ace27436f09c1870458d11e4ee648b5e94a4b0', facing: 1},
  trench: {asset: 'garment:trench', attempt: 'a1', sha256: '0745c0388be7f09da591cc9ff685067defaaf9b19544e06629648d89ddc6b9b9', facing: 1},
  hivis: {asset: 'garment:hivis', attempt: 'a1', sha256: '2b706bf354ef481332efeef9c7b6f404227e2a8b28fa559a4e78eb861b909f99', facing: 1},
  blazer: {asset: 'garment:blazer', attempt: 'a1', sha256: '05f04056f2abc0dbae09a10a841cf8a9cfd12f7386a519022079524d650f5020', facing: 1},
  flannel: {asset: 'garment:flannel', attempt: 'a1', sha256: 'ccf22d234ff534c7448c1edc6730706d4fa2166df63bae0bd230db53c1cc6638', facing: 1},
  sweater: {asset: 'garment:sweater', attempt: 'a1', sha256: '1a11c7865ed0eea91e5f07efae1e5d61d9a39660d15a84713e69a4c8a59934e0', facing: 1},
  cargo: {asset: 'garment:cargo', attempt: 'a1', sha256: '11933bb04879b4dba67c5c2ed44a08efd1a78340d46730500ebb7eb6f7cc845f', facing: 1},
  jeans: {asset: 'garment:jeans', attempt: 'a1', sha256: '23aa400234c5a08dda51919151b297052459f124ea5f3a4e840c04c05ad39adc', facing: 1,
    // the T2.5 jeans close the waist opening with an upward-facing lid (~0.06 m2-equivalent in the top 4 %); fitted, it was
    // pushed out into a dark frill round the waist and the fit07 gate failed on 4 bodies -> lid trimmed at load
    // (lib/t25.mjs trimTopCap; cargo / slacks have open waists)
    trimTopCap: 0.94},
  slacks: {asset: 'garment:slacks', attempt: 'a1', sha256: 'e0a8ac124a8da2368385097ada48df5e7b92a3b85e9ba0a8fb0d283c651c44be', facing: 1},
  hardhat: {asset: 'garment:hardhat', attempt: 'a1', sha256: '0dcde4fed2151fe1697ff91b202f144520a753e2890fad3d0ed179185e6751f6', facing: 1},
  cap: {asset: 'garment:cap', attempt: 'a1', sha256: '4f6009e9dda1e4cd67935aaa2d4335cafd29107fd09b4b1f358a9c8acd7724e8', facing: 1},
  beanie: {asset: 'garment:beanie', attempt: 'a1', sha256: '266a4e571fccfa1476f28d95df3a3130fd957153f799e8163106bcccc6733b20', facing: 1},
  gasmask: {asset: 'garment:gasmask', attempt: 'a1', sha256: '123161cea8c08200e15caf270accec2ee815da9c52cc8070ac31db50d300a8dc', facing: 1},
  respirator: {asset: 'garment:respirator', attempt: 'a1', sha256: '6d53a2c3db3ae118e9f845917b92cdbddfd8fa489a5c9ee2c559acc362f2dbbe', facing: 1},
  hoodie: {asset: 'garment:hoodie', attempt: 'a1', sha256: 'fd09ada122a10c8411fbbe9700082845cbfa51a66d520252b81c7c315d0a04b3', facing: 1,
    // accepted deviation fix (primary review vs the ORIGINAL outfitHoodie image: the T2.5 hoodie reads lighter / pinker than
    // the reference's deep worn red). Measured: the Meshy provider render is lit much brighter, but the T2.5 ALBEDO itself
    // (UV-covered texels) is already about as bright as the reference photo's garment pixels (lin R .122 vs .131); what is
    // off is the hue: G/R .25, B/R .30 (B > G: pink / magenta) vs the reference .30 / .30 (brick red). Grade = per-channel
    // linear gains giving the albedo the reference's mean chromaticity at an unchanged mean luminance (lib/grade.mjs,
    // computed at build time from the stage atlas + the original image; numbers recorded in outfit-hoodie.json).
    grade: {mode: 'reference-chroma', luminance: 1, note: 'albedo chromaticity -> the original reference image mean (alpha-masked garment pixels); mean luminance unchanged (the reference is a lit photo)'}},
};
export const T25_DENSIFY = {body: 0.0045, wearable: 0.007};
/**
 * Colour policy for every T2.5 body / wearable without its own `grade` (primary-approved for the hoodie, applied with the
 * same documented method to the rest): the Meshy albedo (UV-covered texels) takes the ORIGINAL reference image's mean
 * chromaticity (G/R, B/R of its alpha-masked pixels) at UNCHANGED mean luminance (references are lit photos) - only when
 * the chroma deviation is real (> 8 %) and the per-channel linear gains stay modest ([0.8, 1.25]); otherwise no grade and
 * the reason is recorded (e.g. near-zero blue of a saturated yellow). lib/grade.mjs; numbers in each derivative manifest.
 */
export const T25_GRADE = {mode: 'reference-chroma', luminance: 1, minDeviation: 0.08, gainRange: [0.8, 1.25], note: 'T25_GRADE policy: albedo chromaticity -> original reference mean (alpha-masked), luminance unchanged; only deviations > 8 % with gains in [0.8, 1.25]'};
/**
 * Bodies whose shipped geometry must stay exactly as it is (verified by the build) while they have no T2.5 replacement:
 * body:scavenger (user-uploaded Pixal3D result; its T2.5 job uses a RECREATED reference, user update 01) until pinned.
 */
export const KEEP_BODY_FILES = ['scavenger'].filter(id => !T25[id]);
/** Wearables left out of the build entirely (unreferenced by the runtime; not part of the migration). */
export const SKIP_WEARABLES = [{id: 'puffer', reason: 'excluded on every body by the iteration-07 fit gate; no runtime model key (outfit-puffer.glb is an inert, unreferenced file); not in the T2.5 replacement inventory - left untouched'}];
// Output files (build-wardrobe.mjs): every CHANGED runtime GLB is written at '<name>${T25_SUFFIX}.glb' (new URL); a rebuild that
// is byte-identical to the shipped legacy file keeps that file.
/** Garment / pants / rigid stages place sources by `cfg.facing` (default -1 = the old Pixal3D sources). */
const t25Facing = id => (T25[id]?.facing ? {facing: T25[id].facing} : {});
const withT25 = (id, kind, fallback) => () => {
  const p = T25[id];
  if (!p) return fallback();
  const s = t25Source(p.asset, p, T25_DENSIFY[kind], p.trimTopCap ? {trimTopCap: p.trimTopCap} : {});
  if (!s) throw new Error(`T2.5 source ${p.asset} (${id}) pinned in wardrobe.config.mjs is not an accepted delivery`);
  return s;
};

export const LEDGER05 = path.join(REPO, 'reference/tasks/vertical-slice-iteration05-20261026/generation/ledger.json');
export const LEDGER06 = path.join(REPO, 'reference/tasks/vertical-slice-iteration06-20261026/generation/ledger.json');

function ledgerSource(ledger, key) {
  try {
    const l = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    const a = l.assets.find(x => x.key === key);
    if (!a || !a.nativeGlb || !a.nativeGlbSha256 || !fs.existsSync(a.nativeGlb)) return null;
    return {id: key, file: a.nativeGlb, sha256: a.nativeGlbSha256, ledgerKey: key, ledger: path.relative(REPO, ledger), inputPng: a.inputPng, inputPngSha256: a.inputPngSha256, jobId: a.jobId, nativeMetadata: a.nativeMetadata, nativeReceipt: a.nativeReceipt, displayName: a.displayName, imageStatus: a.imageStatus, nativeStatus: a.nativeStatus, preservedXz: a.preservedXz};
  } catch { return null; }
}
const src05 = key => () => ledgerSource(LEDGER05, key);
const src06 = key => () => ledgerSource(LEDGER06, key);

const BODY_OPTS = {
  targetTris: 15000,
  importance: {head: 100, hands: 40, note: 'extra simplifier attribute = position * k'},
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
  density: {head: 1.8, hands: 1.3},
  bake: {size: 2048, cage: 0.015, rayBelow: 0.004},
  textures: {baseColor: 1024, metallicRoughness: 256, jpegQuality: 88},
};
const GARMENT_BASE = {
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
  bake: {size: 2048, cage: 0.012, rayBelow: 0.004},
  textures: {baseColor: 1024, metallicRoughness: 256, jpegQuality: 86},
  pushOut: {margin: 0.012, radius: 0.06, rounds: 8, smoothIters: 6},
  thighFollow: 0.45,
};
const SMALL_BASE = {
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 40, smoothIters: 12, atlas: 512, pad: 4},
  bake: {size: 1024, cage: 0.006, rayBelow: 0.002},
  textures: {baseColor: 512, metallicRoughness: 128, jpegQuality: 88},
};

/** Canonical body: upper garments are fitted to it first, then retargeted to every other body. */
export const CANONICAL_BODY = 'lastshift';

/**
 * traits.covers: slots the body's own geometry already fills (no wearable is fitted there);
 * traits.requires: slots that must always be filled at runtime (base-layer bodies wear pants).
 */
export const BODIES = [
  {id: 'lastshift', label: 'Last-shift worker', origin: 'iteration-01 generated master (zombie-body-03)', provenance: 'generated', source: withT25('lastshift', 'body', () => ({id: MASTERS.body.id, uploadId: MASTERS.body.uploadId, file: MASTERS.body.file, sha256: MASTERS.body.sha256})), heightM: 1.78, weight: 1, traits: {}, ...BODY_OPTS},
  {id: 'courier', label: 'Bike courier', origin: 'iteration-05 generated (Lane A bodyCourier)', provenance: 'generated', source: withT25('courier', 'body', src05('bodyCourier')), heightM: 1.8, weight: 1, traits: {}, ...BODY_OPTS},
  // REUSED (not newly generated): the original user-uploaded master. Iteration 06 re-derived it with the
  // fixed T->A repose (torso guard + sleeve-fringe trim, lib/repose.mjs v2) - see zombie-body-scavenger.json.
  {id: 'scavenger', label: 'Masked scavenger (reused original upload)', origin: 'REUSED existing master reference/assets/masters/zombie-pixal3d.glb (user-uploaded, web ChatGPT image -> Pixal3D); not newly generated; T-pose corrected to the A-pose (iteration-06 repose v2: torso guard + sleeve fringe trim)', provenance: 'reused', source: withT25('scavenger', 'body', () => ({id: 'zombie-pixal3d', file: 'reference/assets/masters/zombie-pixal3d.glb', sha256: '3f524f2ce69582b80bf672eb1fd860fea3d2fe1ecad01cc633285a47f963ed8a', metadata: 'reference/assets/masters/zombie-pixal3d.metadata.json'})), ...(T25.scavenger ? {} : {repose: 'T'}), heightM: 1.76, weight: 1, traits: {covers: ['head', 'face'], note: 'own hood + built-in gas mask'}, ...BODY_OPTS,
    // iteration-06 quality fix: wide sleeves beside the hip pouches were half torso-weighted (sheets in motion);
    // the fused gas-mask filter was split across Neck/Head
    skin: {armRule: 'proximity', armProximityRatio: 0.55, rigidHeadFront: 0.03}, trimBridges: true},
  {id: 'agent', label: 'Station agent', origin: 'iteration-05 generated (Lane A bodyAgent, 15th manifest type)', provenance: 'generated', source: withT25('agent', 'body', src05('bodyAgent')), heightM: 1.65, weight: 1, traits: {}, ...BODY_OPTS,
    // the agent's own belted jeans sit high: pants rise to cover the belt line
    pantsFit: {waistAboveHip: 0.2, waistAboveSpineMax: 0.035}},
  {id: 'heavyset', label: 'Heavyset man (base layer)', origin: 'iteration-06 generated (Lane G bodyUnderwearA: opaque tank top + boxer briefs + socks)', provenance: 'generated', source: withT25('heavyset', 'body', src06('bodyUnderwearA')), heightM: 1.78, weight: 1, traits: {requires: ['lower'], baseLayer: true}, ...BODY_OPTS},
  {id: 'tall', label: 'Tall woman (base layer)', origin: 'iteration-06 generated (Lane G bodyUnderwearB: opaque t-shirt + bike shorts + socks)', provenance: 'generated', source: withT25('tall', 'body', src06('bodyUnderwearB')), heightM: 1.75, weight: 1, traits: {requires: ['lower'], baseLayer: true}, ...BODY_OPTS},
];

const old = id => { const o = OUTFITS05.find(x => x.id === id); const {source, ...rest} = o; return rest; };
const SRC05 = {coat: () => ({id: MASTERS.coat.id, uploadId: MASTERS.coat.uploadId, file: MASTERS.coat.file, sha256: MASTERS.coat.sha256}), hivis: src05('outfitHiVis'), hoodie: src05('outfitHoodie'), blazer: src05('outfitBlazer'), puffer: src05('outfitPuffer'), trench: src05('outfitTrench')};

export const WEARABLES = [
  // ---- upper (iteration 05 garments, unchanged fit parameters)
  ...['coat', 'trench', 'hivis', 'hoodie', 'blazer', 'puffer'].map(id => ({...old(id), ...GARMENT_BASE, ...pick(old(id), ['targetTris', 'pushOut', 'textures']), slot: 'upper', kind: 'garment', provenance: id === 'coat' ? 'generated (iteration 01)' : 'generated (iteration 05)', source: withT25(id, 'wearable', SRC05[id]), ...t25Facing(id)})),
  {id: 'flannel', slot: 'upper', kind: 'garment', label: 'Plaid flannel shirt', origin: 'iteration-06 generated (Lane G upperFlannel)', provenance: 'generated', source: withT25('flannel', 'wearable', src06('upperFlannel')), ...t25Facing('flannel'), weight: 1, ...GARMENT_BASE, targetTris: 6500,
    pushOut: {margin: 0.008, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {armpitDrop: 0.03, widthEase: 1.08, widthAdd: 0.015, depthAdd: 0.04, depthMin: 0.6, depthMax: 1.05}},
  {id: 'sweater', slot: 'upper', kind: 'garment', label: 'Cable-knit sweater', origin: 'iteration-06 generated (Lane G upperSweater)', provenance: 'generated', source: withT25('sweater', 'wearable', src06('upperSweater')), ...t25Facing('sweater'), weight: 1, ...GARMENT_BASE, targetTris: 6500,
    pushOut: {margin: 0.01, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {armpitDrop: 0.03, widthEase: 1.1, widthAdd: 0.015, depthAdd: 0.045, depthMin: 0.6, depthMax: 1.05}},
  // ---- lower (pants): fitted to every body's legs/waist; layered UNDER every upper
  ...[['cargo', 'Olive cargo work pants', 'lowerCargoPants', 0.016], ['jeans', 'Dark-wash jeans', 'lowerJeans', 0.01], ['slacks', 'Grey office slacks', 'lowerSlacks', 0.012]].map(([id, label, key, ease]) => ({
    id, slot: 'lower', kind: 'pants', label, origin: `iteration-06 generated (Lane G ${key})`, provenance: 'generated', source: withT25(id, 'wearable', src06(key)), ...t25Facing(id), weight: 1,
    ...GARMENT_BASE, targetTris: 6000, pushOut: {margin: 0.008, radius: 0.05, rounds: 8, smoothIters: 5},
    fit: {ease, waistAboveHip: 0.15, crotchDrop: 0.03, hemAboveAnkle: -0.015}})),
  // ---- head (rigid to Head)
  // iteration 07: hats are fitted to the measured CRANIUM (lib/headwear.mjs 'hat07'; the iteration-06 'hat'
  // mode sized them from hair/ear envelope widths and lifted them above the eyes: ~0.27 m hard hats).
  // gapSide / gapFB = clearance cranium -> inside of the band (hard-hat suspension ~2 cm, cap / beanie snug),
  // gapTop = crown suspension, bandAboveBrow = where the band sits on the forehead.
  {id: 'hardhat', slot: 'head', kind: 'rigid', label: 'Transit hard hat', origin: 'iteration-06 generated (Lane G headHardHat)', provenance: 'generated', source: withT25('hardhat', 'wearable', src06('headHardHat')), ...t25Facing('hardhat'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.28, gapSide: 0.016, gapFB: 0.018, gapTop: 0.022, thick: 0.004, bandAboveBrow: 0.028, lengthFrom: 'back', rings: false}},
  {id: 'cap', slot: 'head', kind: 'rigid', label: 'Faded baseball cap', origin: 'iteration-06 generated (Lane G headCap)', provenance: 'generated', source: withT25('cap', 'wearable', src06('headCap')), ...t25Facing('cap'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.28, gapSide: 0.004, gapFB: 0.004, gapTop: 0.0, thick: 0.002, bandAboveBrow: 0.022, lengthFrom: 'back'}},
  {id: 'beanie', slot: 'head', kind: 'rigid', label: 'Knit beanie', origin: 'iteration-06 generated (Lane G headBeanie)', provenance: 'generated', source: withT25('beanie', 'wearable', src06('headBeanie')), ...t25Facing('beanie'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.3, gapSide: 0.004, gapFB: 0.004, gapTop: -0.004, thick: 0.004, bandAboveBrow: 0.03, lengthFrom: 'full'}},
  // ---- face (rigid to Head)
  {id: 'gasmask', slot: 'face', kind: 'rigid', label: 'Full-face gas mask', origin: 'iteration-06 generated (Lane G faceGasMask)', provenance: 'generated', source: withT25('gasmask', 'wearable', src06('faceGasMask')), ...t25Facing('gasmask'), weight: 1, ...SMALL_BASE, targetTris: 3000, trimBehind: 0.69, textures: {baseColor: 512, metallicRoughness: 128, jpegQuality: 88}, fit: {mode: 'face', widthLevel: 0.62, above: 0.075, below: 0.03, minWidthEase: 1.0, zone: [0.04, -0.04, 0.07], gap: 0.006}},
  {id: 'respirator', slot: 'face', kind: 'rigid', label: 'Half-face respirator', origin: 'iteration-06 generated (Lane G faceRespirator)', provenance: 'generated', source: withT25('respirator', 'wearable', src06('faceRespirator')), ...t25Facing('respirator'), weight: 1, ...SMALL_BASE, targetTris: 2200, trimBehind: 0.81, fit: {mode: 'face', widthLevel: 0.6, above: 0.022, below: 0.008, minWidthEase: 0.8, zone: [0.03, -0.045, 0.0], gap: 0.006}},
];
function pick(o, keys) { return Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])); }
// T2.5 per-asset fit parameter overrides (documented in the T25 entry; only while that asset is T2.5-sourced)
for (const w of WEARABLES) if (T25[w.id]?.fitOverride) w.fit = {...w.fit, ...T25[w.id].fitOverride};

/**
 * Pairs the build refuses to fit (reason recorded in zombie-variants.json). Use only for real,
 * evidenced problems (QA contact sheets / stretch audit), never to hide by rarity.
 */
export const EXCLUDED_PAIRS = [
  // T2.5 migration: the LEGACY hivis refit onto the new T2.5 heavyset passes the build's fit07 gate (animated 0.89 %,
  // every 3rd frame) but the independent audit (qa/fit-audit.mjs, every 2nd frame) measures 1.21 % > its 1.2 % limit;
  // excluded while hivis still uses its old master (re-evaluated when the T2.5 hivis is pinned)
  ...(T25.hivis ? [] : [{body: 'heavyset', wearable: 'hivis', reason: 'independent fit audit (every 2nd clip frame): animated visible poke-through 1.21 % > 1.2 % on the T2.5 heavyset (legacy hivis master)'}]),
];

/** Motion-quality gate per fitted variant (stretch audit over every clip, lib/stretch.mjs). */
export const QUALITY = {stretchRatio: 3, maxFractionOver: 0.05};

export const SKIN = {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4};

/**
 * Iteration 07 pose-aware refit (lib/fit07.mjs) for upper garments and pants: validation poses = the bind
 * pose + every `everyFrames`-th frame of the six clips + 3 ragdoll-like extreme poses. A variant whose
 * cloth still lets the body VISIBLY poke through afterwards (vertices of unhidden body triangles whose
 * skin lies outside the cloth's outward face) is EXCLUDED: gate = max fraction of the covered body
 * vertices in the bind pose / any clip frame / any extreme pose. An upper whose cloth the body's fitted
 * pants visibly poke through over `layerAnimated` becomes a per-body incompatibility with those pants.
 */
export const FIT07 = {everyFrames: 3, gate: {enforce: true, bind: 0.005, animated: 0.01, extreme: 0.025, layerAnimated: 0.015}};
