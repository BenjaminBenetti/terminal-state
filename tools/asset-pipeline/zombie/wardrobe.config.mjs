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
  {id: 'lastshift', label: 'Last-shift worker', origin: 'iteration-01 generated master (zombie-body-03)', provenance: 'generated', source: () => ({id: MASTERS.body.id, uploadId: MASTERS.body.uploadId, file: MASTERS.body.file, sha256: MASTERS.body.sha256}), heightM: 1.78, weight: 1, traits: {}, ...BODY_OPTS},
  {id: 'courier', label: 'Bike courier', origin: 'iteration-05 generated (Lane A bodyCourier)', provenance: 'generated', source: src05('bodyCourier'), heightM: 1.8, weight: 1, traits: {}, ...BODY_OPTS},
  // REUSED (not newly generated): the original user-uploaded master. Iteration 06 re-derived it with the
  // fixed T->A repose (torso guard + sleeve-fringe trim, lib/repose.mjs v2) - see zombie-body-scavenger.json.
  {id: 'scavenger', label: 'Masked scavenger (reused original upload)', origin: 'REUSED existing master reference/assets/masters/zombie-pixal3d.glb (user-uploaded, web ChatGPT image -> Pixal3D); not newly generated; T-pose corrected to the A-pose (iteration-06 repose v2: torso guard + sleeve fringe trim)', provenance: 'reused', source: () => ({id: 'zombie-pixal3d', file: 'reference/assets/masters/zombie-pixal3d.glb', sha256: '3f524f2ce69582b80bf672eb1fd860fea3d2fe1ecad01cc633285a47f963ed8a', metadata: 'reference/assets/masters/zombie-pixal3d.metadata.json'}), repose: 'T', heightM: 1.76, weight: 1, traits: {covers: ['head', 'face'], note: 'own hood + built-in gas mask'}, ...BODY_OPTS,
    // iteration-06 quality fix: wide sleeves beside the hip pouches were half torso-weighted (sheets in motion);
    // the fused gas-mask filter was split across Neck/Head
    skin: {armRule: 'proximity', armProximityRatio: 0.55, rigidHeadFront: 0.03}, trimBridges: true},
  {id: 'agent', label: 'Station agent', origin: 'iteration-05 generated (Lane A bodyAgent, 15th manifest type)', provenance: 'generated', source: src05('bodyAgent'), heightM: 1.65, weight: 1, traits: {}, ...BODY_OPTS,
    // the agent's own belted jeans sit high: pants rise to cover the belt line
    pantsFit: {waistAboveHip: 0.2, waistAboveSpineMax: 0.035}},
  {id: 'heavyset', label: 'Heavyset man (base layer)', origin: 'iteration-06 generated (Lane G bodyUnderwearA: opaque tank top + boxer briefs + socks)', provenance: 'generated', source: src06('bodyUnderwearA'), heightM: 1.78, weight: 1, traits: {requires: ['lower'], baseLayer: true}, ...BODY_OPTS},
  {id: 'tall', label: 'Tall woman (base layer)', origin: 'iteration-06 generated (Lane G bodyUnderwearB: opaque t-shirt + bike shorts + socks)', provenance: 'generated', source: src06('bodyUnderwearB'), heightM: 1.75, weight: 1, traits: {requires: ['lower'], baseLayer: true}, ...BODY_OPTS},
];

const old = id => { const o = OUTFITS05.find(x => x.id === id); const {source, ...rest} = o; return rest; };
const SRC05 = {coat: () => ({id: MASTERS.coat.id, uploadId: MASTERS.coat.uploadId, file: MASTERS.coat.file, sha256: MASTERS.coat.sha256}), hivis: src05('outfitHiVis'), hoodie: src05('outfitHoodie'), blazer: src05('outfitBlazer'), puffer: src05('outfitPuffer'), trench: src05('outfitTrench')};

export const WEARABLES = [
  // ---- upper (iteration 05 garments, unchanged fit parameters)
  ...['coat', 'trench', 'hivis', 'hoodie', 'blazer', 'puffer'].map(id => ({...old(id), ...GARMENT_BASE, ...pick(old(id), ['targetTris', 'pushOut', 'textures']), slot: 'upper', kind: 'garment', provenance: id === 'coat' ? 'generated (iteration 01)' : 'generated (iteration 05)', source: SRC05[id]})),
  {id: 'flannel', slot: 'upper', kind: 'garment', label: 'Plaid flannel shirt', origin: 'iteration-06 generated (Lane G upperFlannel)', provenance: 'generated', source: src06('upperFlannel'), weight: 1, ...GARMENT_BASE, targetTris: 6500,
    pushOut: {margin: 0.008, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {armpitDrop: 0.03, widthEase: 1.08, widthAdd: 0.015, depthAdd: 0.04, depthMin: 0.6, depthMax: 1.05}},
  {id: 'sweater', slot: 'upper', kind: 'garment', label: 'Cable-knit sweater', origin: 'iteration-06 generated (Lane G upperSweater)', provenance: 'generated', source: src06('upperSweater'), weight: 1, ...GARMENT_BASE, targetTris: 6500,
    pushOut: {margin: 0.01, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {armpitDrop: 0.03, widthEase: 1.1, widthAdd: 0.015, depthAdd: 0.045, depthMin: 0.6, depthMax: 1.05}},
  // ---- lower (pants): fitted to every body's legs/waist; layered UNDER every upper
  ...[['cargo', 'Olive cargo work pants', 'lowerCargoPants', 0.016], ['jeans', 'Dark-wash jeans', 'lowerJeans', 0.01], ['slacks', 'Grey office slacks', 'lowerSlacks', 0.012]].map(([id, label, key, ease]) => ({
    id, slot: 'lower', kind: 'pants', label, origin: `iteration-06 generated (Lane G ${key})`, provenance: 'generated', source: src06(key), weight: 1,
    ...GARMENT_BASE, targetTris: 6000, pushOut: {margin: 0.008, radius: 0.05, rounds: 8, smoothIters: 5},
    fit: {ease, waistAboveHip: 0.15, crotchDrop: 0.03, hemAboveAnkle: -0.015}})),
  // ---- head (rigid to Head)
  // iteration 07: hats are fitted to the measured CRANIUM (lib/headwear.mjs 'hat07'; the iteration-06 'hat'
  // mode sized them from hair/ear envelope widths and lifted them above the eyes: ~0.27 m hard hats).
  // gapSide / gapFB = clearance cranium -> inside of the band (hard-hat suspension ~2 cm, cap / beanie snug),
  // gapTop = crown suspension, bandAboveBrow = where the band sits on the forehead.
  {id: 'hardhat', slot: 'head', kind: 'rigid', label: 'Transit hard hat', origin: 'iteration-06 generated (Lane G headHardHat)', provenance: 'generated', source: src06('headHardHat'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.28, gapSide: 0.016, gapFB: 0.018, gapTop: 0.022, thick: 0.004, bandAboveBrow: 0.028, lengthFrom: 'back', rings: false}},
  {id: 'cap', slot: 'head', kind: 'rigid', label: 'Faded baseball cap', origin: 'iteration-06 generated (Lane G headCap)', provenance: 'generated', source: src06('headCap'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.28, gapSide: 0.004, gapFB: 0.004, gapTop: 0.0, thick: 0.002, bandAboveBrow: 0.022, lengthFrom: 'back'}},
  {id: 'beanie', slot: 'head', kind: 'rigid', label: 'Knit beanie', origin: 'iteration-06 generated (Lane G headBeanie)', provenance: 'generated', source: src06('headBeanie'), weight: 1, ...SMALL_BASE, targetTris: 2200,
    fit: {mode: 'hat07', bandLevel: 0.3, gapSide: 0.004, gapFB: 0.004, gapTop: -0.004, thick: 0.004, bandAboveBrow: 0.03, lengthFrom: 'full'}},
  // ---- face (rigid to Head)
  {id: 'gasmask', slot: 'face', kind: 'rigid', label: 'Full-face gas mask', origin: 'iteration-06 generated (Lane G faceGasMask)', provenance: 'generated', source: src06('faceGasMask'), weight: 1, ...SMALL_BASE, targetTris: 3000, trimBehind: 0.69, textures: {baseColor: 512, metallicRoughness: 128, jpegQuality: 88}, fit: {mode: 'face', widthLevel: 0.62, above: 0.075, below: 0.03, minWidthEase: 1.0, zone: [0.04, -0.04, 0.07], gap: 0.006}},
  {id: 'respirator', slot: 'face', kind: 'rigid', label: 'Half-face respirator', origin: 'iteration-06 generated (Lane G faceRespirator)', provenance: 'generated', source: src06('faceRespirator'), weight: 1, ...SMALL_BASE, targetTris: 2200, trimBehind: 0.81, fit: {mode: 'face', widthLevel: 0.6, above: 0.022, below: 0.008, minWidthEase: 0.8, zone: [0.03, -0.045, 0.0], gap: 0.006}},
];
function pick(o, keys) { return Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])); }

/**
 * Pairs the build refuses to fit (reason recorded in zombie-variants.json). Use only for real,
 * evidenced problems (QA contact sheets / stretch audit), never to hide by rarity.
 */
export const EXCLUDED_PAIRS = [];

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
