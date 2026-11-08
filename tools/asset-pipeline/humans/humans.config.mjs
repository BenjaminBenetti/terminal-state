// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the friendly market humans' build configuration (data; rerun
// build-humans.mjs after a change). Five Meshy T2.5 human bases (private masters, lib/sources.mjs) x a per-body subset of the
// zombie wardrobe's EXISTING ordinary wearables (the same accepted T2.5 garment sources, stages and fit libraries; the gas mask /
// respirator / lingerie are not used). Outputs (level-only, LEVEL_ONLY_RULES 'market-*' -> 'market'):
//   game/public/assets/models/market-human-cast.glb      every body (skeleton + skinned body + its healthy clips) and every fitted
//                                                        wearable variant, ONE file (shared wearable textures; the 1000-file
//                                                        release cap): see lib/glb.mjs for the node / clip naming
//   game/public/assets/derivatives/market-human-cast.json provenance / fit / clip / QA record (one combined record)
import {WEARABLES as ZOMBIE_WEARABLES} from '../zombie/wardrobe.config.mjs';

export const OUT = {glb: 'assets/models/market-human-cast.glb', manifest: 'assets/derivatives/market-human-cast.json'};

const TEXTURES = {baseColor: 2048, normal: 1024, metallicRoughness: 512, jpegQuality: 85, normalQuality: 90};

/**
 * The bases. heightM: believable adult statures (1.62-1.85 m brief); the runtime varies them 0.95-1.05 x per person.
 * skeleton: zombie/lib/skeleton.mjs options; fix: lib/body.mjs applyFixes (documented landmark fixes, logged per body).
 * wear: the shipped subset of wearables per body (character + file size: one cast file); `none` weights in market/humanLooks.ts.
 */
export const HUMAN_BODIES = [
  {id: 'm1', label: 'Man, about 40, medium build, trimmed beard', heightM: 1.78, textures: TEXTURES,
    wear: ['flannel', 'hivis', 'hoodie', 'coat', 'cargo', 'jeans', 'cap', 'beanie']},
  // braids hang behind the neck: the neck cluster centre lands ~13 cm behind the throat -> head / neck depth from the nose tip
  {id: 'f1', label: 'Woman, about 30, athletic, braids', heightM: 1.68, textures: TEXTURES, fix: {headZ: 'nose'},
    wear: ['hoodie', 'sweater', 'flannel', 'hivis', 'cargo', 'jeans', 'cap', 'beanie']},
  {id: 'm2', label: 'Man, about 60, heavy build, grey hair', heightM: 1.76, textures: TEXTURES,
    wear: ['coat', 'sweater', 'flannel', 'blazer', 'slacks', 'cargo', 'cap', 'hardhat']},
  // slim shoulders: no acromion slope break in the top-surface scan -> glenohumeral centre from the armpit wall
  {id: 'f2', label: 'Woman, about 50, slim, ponytail', heightM: 1.64, textures: TEXTURES, fix: {shoulder: 'armpit'},
    wear: ['sweater', 'trench', 'coat', 'flannel', 'slacks', 'jeans', 'beanie', 'cap']},
  // slim jeans: the inner thighs touch -> crotch from the midline strip (as the pale zombie bodies)
  {id: 'm3', label: 'Young man, about 22, lean, auburn hair', heightM: 1.82, textures: TEXTURES, skeleton: {crotch: 'midline'},
    wear: ['hoodie', 'hivis', 'flannel', 'sweater', 'jeans', 'cargo', 'beanie', 'hardhat']},
];

/** Ordinary wearables used here (zombie/wardrobe.config.mjs WEARABLES: the same definitions, sources, stage / fit parameters). */
export const HUMAN_WEARABLE_IDS = ['flannel', 'hoodie', 'sweater', 'hivis', 'coat', 'blazer', 'trench', 'cargo', 'jeans', 'slacks', 'cap', 'beanie', 'hardhat'];
export const HUMAN_WEARABLES = HUMAN_WEARABLE_IDS.map(id => {
  const w = ZOMBIE_WEARABLES.find(x => x.id === id);
  if (!w) throw new Error('unknown wearable ' + id);
  return w;
});

/**
 * Pose-aware fit gate (zombie/wardrobe.config.mjs FIT07 limits; validation poses = the bind pose + every 3rd frame of the HEALTHY
 * clips; no ragdoll extremes: the humans never ragdoll).
 */
export const HUMAN_FIT = {everyFrames: 3, gate: {bind: 0.005, animated: 0.01, layerAnimated: 0.015}};
/** Motion-quality gate (as the zombie wardrobe QUALITY). */
export const HUMAN_QUALITY = {stretchRatio: 3, maxFractionOver: 0.05};
export const HUMAN_SKIN = {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4};
