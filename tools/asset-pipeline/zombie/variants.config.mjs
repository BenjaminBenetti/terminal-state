// Body x outfit variety configuration (iteration 05; superseded by wardrobe.config.mjs, which reuses OUTFITS below). Bodies and outfits are data: add an entry
// (and a source) and rerun build-variants.mjs. Newly generated sources are resolved from Lane A's
// per-asset ledger (native GLB path + sha256) so each asset is picked up as soon as it lands.
import fs from 'node:fs';
import path from 'node:path';
import {REPO, MASTERS} from './lib/master.mjs';

export const LEDGER = path.join(REPO, 'reference/tasks/vertical-slice-iteration05-20261026/generation/ledger.json');

function ledgerSource(key) {
  try {
    const l = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    const a = l.assets.find(x => x.key === key);
    if (!a || !a.nativeGlb || !a.nativeGlbSha256 || !fs.existsSync(a.nativeGlb)) return null;
    return {id: key, file: a.nativeGlb, sha256: a.nativeGlbSha256, ledgerKey: key, inputPng: a.inputPng, inputPngSha256: a.inputPngSha256, jobId: a.jobId, nativeMetadata: a.nativeMetadata, nativeReceipt: a.nativeReceipt, displayName: a.displayName, imageStatus: a.imageStatus, nativeStatus: a.nativeStatus};
  } catch { return null; }
}

const BODY_OPTS = {
  targetTris: 17000,
  importance: {head: 100, hands: 40, note: 'extra simplifier attribute = position * k'},
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
  density: {head: 1.8, hands: 1.3},
  bake: {size: 2048, cage: 0.015, rayBelow: 0.004},
  textures: {baseColor: 1024, metallicRoughness: 512, jpegQuality: 90},
};
const GARMENT_BASE = {
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
  bake: {size: 2048, cage: 0.012, rayBelow: 0.004},
  textures: {baseColor: 1024, metallicRoughness: 256, jpegQuality: 88},
  pushOut: {margin: 0.012, radius: 0.06, rounds: 8, smoothIters: 6},
  thighFollow: 0.45,
};

/** Canonical body: garments are fitted to it first, then retargeted to every other body. */
export const CANONICAL_BODY = 'lastshift';

export const BODIES = [
  {id: 'lastshift', label: 'Last-shift worker', origin: 'iteration-01 generated master (zombie-body-03)', source: () => ({id: MASTERS.body.id, uploadId: MASTERS.body.uploadId, file: MASTERS.body.file, sha256: MASTERS.body.sha256}), heightM: 1.78, weight: 1, ...BODY_OPTS},
  {id: 'courier', label: 'Bike courier', origin: 'iteration-05 generated (Lane A bodyCourier)', source: () => ledgerSource('bodyCourier'), heightM: 1.8, weight: 1, ...BODY_OPTS},
  // REUSED (not newly generated): the original user-uploaded master, T-pose -> A-pose corrected (lib/repose.mjs).
  {id: 'scavenger', label: 'Masked scavenger (reused original upload)', origin: 'REUSED existing master reference/assets/masters/zombie-pixal3d.glb (user-uploaded, web ChatGPT image -> Pixal3D); not newly generated; T-pose corrected to the A-pose', source: () => ({id: 'zombie-pixal3d', file: 'reference/assets/masters/zombie-pixal3d.glb', sha256: '3f524f2ce69582b80bf672eb1fd860fea3d2fe1ecad01cc633285a47f963ed8a', metadata: 'reference/assets/masters/zombie-pixal3d.metadata.json'}), repose: 'T', heightM: 1.76, weight: 0.6, ...BODY_OPTS},
  {id: 'agent', label: 'Station agent', origin: 'iteration-05 generated (Lane A bodyAgent, 15th manifest type)', source: () => ledgerSource('bodyAgent'), heightM: 1.65, weight: 1, ...BODY_OPTS},
];

export const OUTFITS = [
  {id: 'coat', label: 'Hi-vis parka (long coat)', origin: 'iteration-01 generated master (zombie-coat-03)', source: () => ({id: MASTERS.coat.id, uploadId: MASTERS.coat.uploadId, file: MASTERS.coat.file, sha256: MASTERS.coat.sha256}),
    weight: 1, heavy: true, ...GARMENT_BASE, targetTris: 9000, textures: {baseColor: 1024, metallicRoughness: 256, jpegQuality: 88},
    fit: {hem: 'knee', armpitDrop: 0.035, widthEase: 1.18, widthAdd: 0.02, depthAdd: 0.07, depthMin: 0.7, depthMax: 1.0},
    backTaper: {hemFactor: 0.3, fullAboveY: 1.25, clearance: 0.015}},
  {id: 'hivis', label: 'Track-worker hi-vis vest', origin: 'iteration-05 generated (Lane A outfitHiVis)', source: () => ledgerSource('outfitHiVis'), weight: 1, ...GARMENT_BASE, targetTris: 5000, pushOut: {margin: 0.02, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {anchor: 'top', topOffset: 0.0, lengthScale: 1.06, armpitDrop: 0.06, widthEase: 1.14, widthAdd: 0.02, depthAdd: 0.06, depthMin: 0.6, depthMax: 1.1}},
  {id: 'hoodie', label: 'Zip hoodie', origin: 'iteration-05 generated (Lane A outfitHoodie)', source: () => ledgerSource('outfitHoodie'), weight: 1, ...GARMENT_BASE, targetTris: 7500,
    fit: {armpitDrop: 0.035, widthEase: 1.15, widthAdd: 0.02, depthAdd: 0.06, depthMin: 0.65, depthMax: 1.05}},
  {id: 'blazer', label: 'Office blazer', origin: 'iteration-05 generated (Lane A outfitBlazer)', source: () => ledgerSource('outfitBlazer'), weight: 1, ...GARMENT_BASE, targetTris: 7500,
    fit: {armpitDrop: 0.035, widthEase: 1.12, widthAdd: 0.02, depthAdd: 0.05, depthMin: 0.65, depthMax: 1.05}},
  {id: 'puffer', label: 'Puffer jacket', origin: 'iteration-05 generated (Lane A outfitPuffer)', source: () => ledgerSource('outfitPuffer'), weight: 1, ...GARMENT_BASE, targetTris: 7500, pushOut: {margin: 0.022, radius: 0.06, rounds: 8, smoothIters: 6},
    fit: {armpitDrop: 0.035, widthEase: 1.25, widthAdd: 0.03, depthAdd: 0.1, depthMin: 0.7, depthMax: 1.1}},
  {id: 'trench', label: 'Trench coat', origin: 'iteration-05 generated (Lane A outfitTrench)', source: () => ledgerSource('outfitTrench'), weight: 1, heavy: true, ...GARMENT_BASE, targetTris: 8500,
    // knee hem (as the coat): a rigid, non-simulated skirt longer than this swings through the floor when the knees bend
    fit: {hem: 'knee', armpitDrop: 0.035, widthEase: 1.15, widthAdd: 0.02, depthAdd: 0.06, depthMin: 0.65, depthMax: 1.05},
    backTaper: {hemFactor: 0.4, fullAboveY: 1.25, clearance: 0.015}},
];

export const SKIN = {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4};
