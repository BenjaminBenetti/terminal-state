// Tasks studio-food-shelf-production-20261109-002816-01 (lane COOK: the ruined shelf props' atlas, the first food / drink models) and
// studio-fresh-food-redo-20261109-040427-01 (lane COOK: the 24 food / drink pickups redone as brand-new, factory-fresh products): the
// runtime derivatives of the approved food / drink / ruined-shelf Meshy T2.5 models. Route: Codex native image_gen INITIAL conditioning
// image (a strict straight-on elevation conditioned on the user-approved concept original) -> Meshy T2.5 image-to-3D (smart topology, 2K
// PBR); every model KEEPS Meshy's own PBR maps (base colour, metallic-roughness, normal), downsized / re-encoded / atlas-packed only —
// never a Codex re-texture or projection.
//
// Reads (never modifies) the lead's private task records OUTSIDE Git, one task per family:
//   the 24 collectibles  reference/tasks/fresh-food-redo-20261109-040427/      (FOOD-REDO-ASSET-MANIFEST.json: the 24 ids)
//   the 27 ruined props  reference/tasks/food-shelf-production-20261109-002816/ (PRODUCTION-ASSET-MANIFEST.json: the 51 first ids)
// each with:
//   USER-GENERATION-APPROVAL.json    its sha256 must equal every reservation's approvalSha256
//   gen/LEDGER.jsonl                 the broker's fsynced reserve / posted / settle / raw / accept lines (the ONLY source of raws)
//   gen/raw/<ID>-<RES>-<taskId>.glb  the immutable raw originals (read-only; sha256 + bytes checked against the ledger's raw line)
//   gen/lanes/<lane>/codex.jsonl     the Codex call that produced the reserved conditioning image (matched by sha256; no prompts kept)
// Only the LATEST ACCEPTED reservation per asset id is cooked. The real write needs all 24 collectibles accepted (the registry never
// drops an item); a ruined prop without one is skipped and left out of the registry. The production ledger also names the model each
// collectible REPLACES (its provenance `replaces`).
// --food-only cooks the 24 collectibles ONLY: it never bakes or writes the atlas (shelf-junk-atlas.glb, food-shelf-junk-atlas.json), keeps
// the registry's SHELF_JUNK_ATLAS section and every non-food allowlist entry byte-identical (checked before / after the write).
// Writes deterministically:
//   game/public/assets/models/food-<slug>.glb             24 collectibles: one node / mesh / primitive / material, Meshy maps downsized
//   game/public/assets/models/shelf-junk-atlas.glb        27 ruined props: one mesh node per prop id (P01..P27), ALL on ONE material
//                                                         whose base colour (2048 px) / metallic-roughness / normal (1024 px) maps are one atlas each
//   game/public/assets/derivatives/food-shelf-<slug>-model.json, food-shelf-junk-atlas.json   provenance (no URLs / tokens / prompts)
//   game/src/assets/foodShelfModels.generated.ts          FOOD_ITEM_MODELS (key = ItemDef id = slug) + SHELF_JUNK_ATLAS (three-free)
//   tools/release/public-inputs.json                      ONLY this script's entries added / updated (others untouched)
//
// Collectibles: exact-attribute weld (+ degenerate triangles / unreferenced vertices dropped; lossless), meshoptimizer seam-preserving
// simplification only above the 2500-triangle budget (source UVs / normals kept, so Meshy's maps stay mapped exactly; refused when
// crumpled), posed (Meshy's native frame +Y up, front +Z; a half turn / lay-flat quarter turn / rigid rest-pose roll where recorded),
// UNIFORM scale so the plan's reference measure is its real size (H = the full height, W = the longer horizontal extent = width / length,
// D = the diameter = the horizontal extent), then each axis corrected to the item's EXACT nominal resting-pose extents (NOMINAL: the
// registry w / h / d that container fit and food-variety choice read; scaled about the centre, normals by the inverse transpose; the
// per-axis factors recorded), grounded (min y = 0) and centred on x / z, baked into the vertices (identity node); Meshy's maps downsized
// to 512 / 256 / 256 px (ITEM_TEX_LABEL: a recorded 1024 px base-colour exception for sliver-UV labels). Recorded per-asset processing
// (ADJUST: the lead's binding cook adjustments and the lanes' accept notes): local mesh separation of extruded label islands, pressing /
// squashing an extruded label part onto the face, half turns, lay-flat / stand-up quarter turns and rigid rest-pose rolls; the registry's
// w / h / d describe the final resting pose.
// Ruined props (one atlas GLB, lean for the SHELF lane's stock budget): the leanest position-only simplification step (small parts
// 250-600, big ones 450-900 triangles) within the target error, re-fitted to the plan size, freshly unwrapped into the prop's own
// square atlas cell (cell side by surface area at one uniform texel density, skyline-packed into 2048 px) and baked from the dense
// Meshy model: Meshy's base colour / metallic-roughness resampled, its normal map folded into the baked tangent-space normal
// (lib/bake.mjs). Meshy's 200-1000-chart UV layouts stall a seam-preserving collapse far above these budgets and a seam-crossing
// collapse smears the texture, so baking is the only way to keep Meshy's maps at this triangle count (processing, not authoring).
//
//   node tools/asset-pipeline/props/build-food-shelf-meshy.mjs [--food-only] [--reference <dir>] [--dry-run <scratch dir>]
//   (--reference defaults to <repo>/reference; --dry-run writes the GLBs + provenance + a registry preview only into the scratch dir and
//   accepts a partial set of collectibles; --food-only: the 24 collectibles only, the atlas and its records untouched)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO, TextureInfo} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {unwrap} from './lib/unwrap.mjs';
import {bake, downsample} from './lib/bake.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const REF = path.resolve(arg('--reference') ?? path.join(root, 'reference'));
const DRY = arg('--dry-run');
const FOOD_ONLY = process.argv.includes('--food-only');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/foodShelfModels.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/props/build-food-shelf-meshy.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4), r6 = v => +v.toFixed(6);
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The task records (private, outside Git): the collectibles come from the fresh redo task, the ruined props from the production task.
 * caps = the task's broker caps; codexLane = the lane folder whose codex.jsonl holds the conditioning image's Codex result line.
 */
const TASKS = {
  production: {task: 'studio-food-shelf-production-20261109-002816-01', dir: 'reference/tasks/food-shelf-production-20261109-002816',
    manifest: 'PRODUCTION-ASSET-MANIFEST.json', caps: {credits: 1000, attempts: 66, posts: 100}, codexLane: rv => rv.lane,
    approvalSummary: "the user's fresh food / shelf generation approval: up to 1000 Meshy credits on the 51 approved food, drink and ruined-shelf assets with the T2.5 model (caps 66 attempts / 100 paid POSTs; D03 / D08 excluded); Codex conditioning images recorded",
    route: 'Codex native image_gen INITIAL conditioning image (a strict straight-on front elevation, conditioned on the user-approved concept original) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (downsized / re-encoded / atlas-packed only; no re-texture, projection or hand-painted replacement)',
    licence: "generated for this project (Codex initial image -> Meshy T2.5) under the user's food / shelf generation approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied"},
  redo: {task: 'studio-fresh-food-redo-20261109-040427-01', dir: 'reference/tasks/fresh-food-redo-20261109-040427',
    manifest: 'FOOD-REDO-ASSET-MANIFEST.json', caps: {credits: 500, attempts: 33, posts: 50},
    // the broker accepts a status-ok Codex image of this task from any lane's refs/ (e.g. the lead's pilot refs): the input's own lane folder
    codexLane: rv => path.basename(path.dirname(path.dirname(rv.input))),
    approvalSummary: "the user's clean food / drink redo approval: up to 500 Meshy credits on the 24 food / drink pickups with the T2.5 model (caps 33 attempts / 50 paid POSTs; D03 / D08 excluded), brand-new factory-fresh products from NEW Codex conditioning images (recorded)",
    route: 'Codex native image_gen INITIAL conditioning image (a NEW strict straight-on front elevation of the brand-new, factory-fresh product, conditioned on the user-approved concept original; the previous straight-on reference for framing only) -> a FRESH Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (downsized / re-encoded only; no re-texture, recolour, projection or hand-painted replacement)',
    licence: "generated for this project (Codex initial image -> Meshy T2.5) under the user's clean food / drink redo approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied"},
};

/**
 * The plan's table. fit: the reference measure and its real size (m): h = the full height, w = the longer horizontal extent (width /
 * length), d = the diameter (the longer horizontal extent; `band` = [lo, hi] height fractions it is measured in, e.g. a tin without
 * its brush). nominal (collectibles): the EXACT resting-pose extents [w, h, d] (m, 4 decimals) every model of the item is cooked to:
 * the item dims that container fit and food-variety choice read (items/pantryFood.ts PANTRY_DIMS), fixed by the first production cook.
 */
const ITEMS = [
  ['F01', 'corned_beef', {h: 0.10}, [0.1344, 0.1, 0.065]], ['F02', 'sardines', {w: 0.11}, [0.11, 0.025, 0.075]],
  ['F03', 'field_ration', {h: 0.20}, [0.1436, 0.02, 0.2]], ['F04', 'ration_brick', {w: 0.15}, [0.15, 0.0761, 0.062]],
  ['F05', 'pickles', {h: 0.18}, [0.1096, 0.18, 0.1103]], ['F06', 'peanut_butter', {h: 0.12}, [0.1274, 0.12, 0.1274]],
  ['F07', 'saltines', {w: 0.22}, [0.22, 0.091, 0.0719]], ['F08', 'jerky', {h: 0.20}, [0.1314, 0.2, 0.0248]],
  ['F09', 'trail_mix', {h: 0.20}, [0.1604, 0.2, 0.05]], ['F10', 'honey', {h: 0.17}, [0.0989, 0.17, 0.0563]],
  ['F11', 'butter_cookies', {d: 0.20}, [0.1995, 0.0941, 0.2]], ['F12', 'pudding_cups', {w: 0.15}, [0.15, 0.1389, 0.1302]],
  ['F13', 'fruit_puree', {h: 0.15}, [0.0853, 0.15, 0.0238]], ['F14', 'raisins', {w: 0.12}, [0.12, 0.0645, 0.03]],
  ['F15', 'smoked_sausage', {w: 0.28}, [0.2801, 0.0957, 0.0735]], ['F16', 'wax_cheese', {d: 0.14}, [0.14, 0.065, 0.1399]],
  ['F17', 'rolled_oats', {h: 0.24}, [0.1431, 0.24, 0.1407]], ['F18', 'rice_crackers', {w: 0.22}, [0.22, 0.035, 0.1172]],
  ['D01', 'sports_drink', {h: 0.23}, [0.0793, 0.23, 0.0809]], ['D02', 'iced_coffee', {h: 0.17}, [0.0711, 0.17, 0.0713]],
  ['D04', 'iced_tea', {h: 0.24}, [0.0592, 0.24, 0.0594]], ['D05', 'juice_boxes', {w: 0.15}, [0.15, 0.0964, 0.0586]],
  ['D06', 'uht_milk', {h: 0.20}, [0.095, 0.2, 0.065]], ['D07', 'ginger_soda', {h: 0.22}, [0.0617, 0.22, 0.0629]],
].map(([id, slug, fit, nominal]) => ({id, slug, fit, nominal}));
/** Per-axis exact-fit factors outside this band are listed for the lead's visual check (the console + the provenance `axisFit.review`). */
const AXIS_REVIEW = [0.85, 1.18];
const JUNK = [
  ['P01', 'mouldy_loaf', {w: 0.32}], ['P02', 'bloated_can', {h: 0.12}], ['P03', 'burst_milk', {h: 0.25}], ['P04', 'rotten_fruit_crate', {w: 0.40}],
  ['P05', 'crushed_cereal', {h: 0.30}], ['P06', 'mould_jar', {h: 0.18}], ['P07', 'flour_sack', {h: 0.40}], ['P08', 'deli_clamshell', {w: 0.18}],
  ['P09', 'egg_carton', {w: 0.16}], ['P10', 'potato_sack', {h: 0.40}], ['P11', 'wrapper_cluster', {w: 0.25}], ['P12', 'rusty_tins', {h: 0.30}],
  ['P13', 'retail_carton', {w: 0.20}], ['P14', 'shipping_box', {w: 0.55}], ['P15', 'torn_carton', {w: 0.45}], ['P16', 'crushed_box', {w: 0.45}],
  ['P17', 'blister_card', {h: 0.25}], ['P18', 'carton_bundle', {w: 0.30}], ['P19', 'shelf_tray', {w: 0.40}], ['P20', 'cleaner_jug', {h: 0.30}],
  ['P21', 'trigger_sprayer', {h: 0.28}], ['P22', 'rag_bundle', {w: 0.30}], ['P23', 'tool_tote', {w: 0.45}], ['P24', 'cable_adapter', {w: 0.25}],
  ['P25', 'paint_tin', {d: 0.17, band: [0, 0.1]}], ['P26', 'towel_pack', {w: 0.30}], ['P27', 'binder_stack', {w: 0.32}],
].map(([id, slug, fit]) => ({id, slug, fit}));
const dashed = s => s.replace(/_/g, '-');
/**
 * Recorded per-asset geometry processing (deterministic; the lead's binding cook adjustments + the lane accept notes), applied to the
 * raw mesh (`dropIslands`, `flatten`: raw Meshy units) or after the uniform fit (`depth`, `layFlat`, `settle`):
 *  dropIslands  local mesh separation: position-connected islands lying wholly in front of raw z = minZ, or wholly inside a raw box
 *               (inBox), are removed (expected island / triangle counts checked)
 *  flatten      one position-connected island (matched by its triangle count + raw bounds) is squashed along raw +Z toward z = toZ
 *  press        the islands lying wholly inside a raw box (an extruded label picture) are pressed along z onto the product's own front
 *               surface (a relief of `factor` + `offset` remains; Meshy's UVs / maps unchanged): the picture stays, the face is flush again
 *  stretch      (ruined props only; unused) the named raw axes are scaled about their centre to the real product extents (m; normals by the
 *               inverse transpose); the collectibles' depth comes from the exact per-axis fit to NOMINAL instead
 *  turn         a half turn about y (the clean label faces raw -Z)
 *  layFlat      a quarter turn about x (-90 deg): the front (+Z) face turns up (+Y), the old top goes to -Z (rests on its back, label up)
 *  standUp      (collectibles) a quarter turn about x (+90 deg): a label Meshy built facing up (+Y) turns to the front (+Z)
 *  settle       rigid rolls about z / x onto stable supports (a model that would otherwise stand on a dangling speck)
 * The collectible rows describe the FRESH redo raws (task studio-fresh-food-redo-20261109-040427-01: the art lanes' accept notes + the
 * cook's inspection of each new raw); the first production raws' rows (island counts / bounds of those meshes) are history in Git.
 */
const ADJUST = {
  F01: {press: {inBox: {min: [-0.24, -0.21, 0.14], max: [0.32, 0, 0.48]}, islands: 11, tris: 833, factor: 0.1, offset: 0.004,
    why: "lane L1 accept of R001 / lead: Meshy extruded the label's plate / meat / parsley illustration into 11 separate islands standing up to ~0.19 raw units proud of the tin's +Z face; the label underneath only carries a faint smudge of it, so the islands are pressed flat onto the face (the crisp picture stays, the tin face is flush)"}},
  F02: {layFlat: 'plan: the sardine tin lies label-up'},
  F03: {layFlat: 'plan: the ration pouch lies flat, label up (its 8 stew-chunk islands stay: ~0.003 raw units proud = ~1 mm after the cook, flush with the label; stripped, the bowl print underneath is an empty pale oval)'},
  F10: {dropIslands: {inBox: [{min: [-0.21, -0.27, 0.13], max: [0.21, 0.15, 0.18]}, {min: [-0.21, -0.27, -0.18], max: [0.21, 0.15, -0.13]}], islands: 2, dropTris: 184, keepTris: 2965,
    why: "local mesh separation (lane L2 accept of R012, lead): the two hexagon HONEY labels were extruded as flat plates standing off the curved bottle front and back; removed, the hexagon labels stay printed on the bottle"}},
  F11: {press: {inBox: {min: [-0.22, -0.16, 0.23], max: [0.23, 0.02, 0.36]}, islands: 4, tris: 1742, factor: 0.1, offset: 0.004,
    why: "lane L2 accept of R023 / lead: the label's cookie illustration was extruded as 4 islands up to ~0.07 raw units proud of the tin's +Z side; the tin underneath only carries a faint smudge of it, so the islands are pressed flat onto the tin (the crisp cookies stay; the seal tape over the lid seam is a real part and kept)"}},
  F12: {standUp: "lead / lane L2 accept of R020: Meshy read the straight-on elevation as a top view (the sleeve card lies across the cup tops, the label faces +Y); stood up, the label faces +Z like the item's current upright box"},
  F13: {press: {inBox: {min: [-0.19, -0.28, -0.07], max: [0.21, 0.05, 0.18]}, islands: 6, tris: 2265, factor: 0.1, offset: 0.004,
    why: "lane L3 accept of R007 / lead: the label's apple / pear / leaf illustration was extruded as 6 islands up to ~0.19 raw units proud of the pouch's +Z face; the pouch underneath only carries a blurred blob of it, so the islands are pressed flat onto the pouch (the crisp fruit stays; the cap and spout parts are kept)"}},
  F15: {settle: 'the paper hang tag hangs ~0.1 raw units below the chub (a hanging pose): resting on the tag alone the chub floats; it rolls onto the tag and the chub end'},
  F16: {layFlat: 'plan: the wax cheese round lies on its flat face, the circular label up'},
  F18: {layFlat: 'plan: the rice cracker tray pack lies label-up'},
  D04: {dropIslands: {inBox: {min: [-0.11, -0.29, 0.05], max: [0.12, -0.03, 0.16]}, islands: 9, dropTris: 585, keepTris: 2423,
    why: "local mesh separation (lane L4 accept of R014, lead): the label's lemon-and-leaf illustration was extruded as 9 islands up to ~0.04 raw units proud of the bottle's +Z label; removed, the art stays printed on the label"}},
  D07: {dropIslands: {inBox: {min: [-0.075, -0.19, 0.07], max: [0.085, -0.1, 0.19]}, islands: 1, dropTris: 1630, keepTris: 1530,
    why: "local mesh separation (lane L4 accept of R024, lead): the label's ginger-root illustration was extruded as a separate closed part ~0.09 raw units proud of the bottle's +Z label; removed, the art stays printed on the label and the bottle is round again"}},
  P11: {layFlat: 'lead: Meshy built the wrapper / cup cluster upright on a narrow base; laid on its back it rests stably like the approved concept',
    settle: 'laid on its back it first touches the floor with one protruding wrapper corner (2.4 cm below the broad back); it rolls onto its back'},
  P24: {layFlat: 'lead / lane A5: the coiled cable and dead adapter were reconstructed standing up (the conditioning image is their top view); laid flat'},
};
/** Collectible triangle budget steps (seam-preserving; the class budget first; see simplifyStepped). */
const ITEM_BUDGETS = [2500, 3000];
/**
 * Ruined-prop budgets (lead, SHELF lane: a station carries ~2.3k-5.3k filler pieces under a 320k-triangle stock budget): the leanest
 * step whose position-only simplification stays within JUNK_TARGET_ERROR (meshoptimizer relative error), small parts (cans, jars,
 * cartons, sprayers, blister card, wrappers, ...) up to 600, big ones (crates, sacks, totes, shipping / torn / crushed boxes, rag
 * bundle) up to 900 triangles; a part with no step within the target takes its class cap (recorded; checked visually).
 */
const JUNK_STEPS = {small: [250, 300, 450, 600], big: [450, 600, 900]};
const JUNK_BIG = new Set(['P04', 'P07', 'P10', 'P14', 'P15', 'P16', 'P22', 'P23']);
/**
 * Lead's per-part caps (SHELF lane: 450-600 modelled pieces per station, the frequent parts dominate a 300k-triangle station budget):
 * these parts are simplified straight to the cap (the bake carries the surface detail); every other part keeps its step rule.
 */
const JUNK_CAP = {P13: 80, P17: 120, P21: 120, P25: 150, P03: 150, P16: 300, P18: 300, P19: 300, P26: 300, P27: 300, P11: 400, P22: 400};
const JUNK_TARGET_ERROR = 0.015;
/** The dense -> low bake (lib/bake.mjs): supersampling and worker threads (one process; the pod has 8 GiB). */
const BAKE = {supersample: 2, workers: 6};
/**
 * Collectible map sizes [base, metallicRoughness, normal] px: the repo's consumable-item class (meshy-t25 items: 512 px colour, 256 px
 * MR / normal; ~2 MB GPU per item). The packaging lettering stays legible at 512 (checked; the exceptions are ITEM_TEX_LABEL);
 * 1024 / 512 / 512 would be ~8 MB GPU each.
 */
const ITEM_TEX = [512, 256, 256];
/**
 * Recorded per-item map-size exceptions [base, metallicRoughness, normal] px (lead, task studio-fresh-food-redo-20261109-040427-01; at
 * most 8 items): Meshy packed these labels into narrow UV slivers, so at the class's 512 px the clean print smears into grime-like streaks.
 */
const ITEM_TEX_LABEL = {D02: [1024, 256, 256], F07: [1024, 256, 256], F04: [1024, 256, 256], F01: [1024, 256, 256], F12: [1024, 256, 256]};
const ITEM_TEX_LABEL_WHY = "lead: Meshy packed this label into narrow UV slivers; at the class's 512 px base colour the clean print smears into grime-like streaks, at 1024 px it stays crisp (metallic-roughness / normal keep the class's 256 px)";
if (Object.keys(ITEM_TEX_LABEL).length > 8 || Object.keys(ITEM_TEX_LABEL).some(id => !ITEMS.some(r => r.id === id))) throw new Error('ITEM_TEX_LABEL: at most 8 collectible ids');
const itemTex = id => ITEM_TEX_LABEL[id] ?? ITEM_TEX;
/**
 * The shared atlas: base colour 2048 px; metallic-roughness and normal stored at 1024 px (lead: texture memory on every stocked level;
 * the same cells, an exact 2 x 2 downsample of the 2048 bake, normals renormalised); square cells on a 16 px grid (even pixels, so the
 * 2 x 2 downsample never mixes two cells); `pad` = the unwrap's chart padding inside a cell (px at 2048).
 */
const ATLAS = {size: 2048, mrNormalDiv: 2, grid: 16, pad: 4, minCell: 64, maxCell: 1024, url: 'assets/models/shelf-junk-atlas.glb', id: 'shelf-junk-atlas',
  background: {baseColor: [128, 128, 128], metallicRoughness: [255, 255, 0], normal: [128, 128, 255]}};
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, targetError: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept)',
  toolPermissive: 'meshoptimizer 1.3 simplifyWithAttributes Permissive (normals x0.5 + UV x1 attribute weights; collapses across UV seams allowed, charged by the UV attribute error; source UVs / normals kept)'};
/** Above this relative error the seam-preserving result counts as visibly crumpled: the source mesh is kept instead. */
const MAX_KEEP_ERROR = 0.05;
/** JPEG encodes per slot (channel-packed metallic-roughness and normals without chroma subsampling). */
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

// ---------- records ----------
/**
 * One task's records (manifest, approval, ledger, Codex lines), cross-checked like its broker: `records(row)` = the latest accepted
 * reservation of an asset (or null), `previous(row)` = the same from the ledger lines only (no raw read: what a new model replaces).
 */
function taskRecords(name) {
  const cfg = TASKS[name], T = path.join(REF, path.relative('reference', cfg.dir)), GEN = path.join(T, 'gen');
  const manifest = JSON.parse(fs.readFileSync(path.join(T, cfg.manifest), 'utf8'));
  const approved = new Map(manifest.assets.map(a => [a.id, a]));
  const approvalSha = sha(fs.readFileSync(path.join(T, 'USER-GENERATION-APPROVAL.json')));
  const ledgerLines = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map((l, i) => ({...JSON.parse(l), seq: i + 1}));

  /** The broker's own state machine (gen/broker.py state()) over the ledger, keeping the line numbers. */
  function ledgerState() {
    const res = new Map();
    for (const l of ledgerLines) {
      if (l.type === 'reserve') { res.set(l.res, {reserve: l, state: 'reserved', billed: 0, lines: {reserve: l.seq}}); continue; }
      const x = res.get(l.res);
      if (!x) continue;
      if (l.asset !== x.reserve.asset) throw new Error(`${name} ledger line ${l.seq}: asset ${l.asset} != reservation ${l.res} asset ${x.reserve.asset}`);
      if (l.type === 'posted') Object.assign(x, {state: 'posted', taskId: l.taskId, posted: l});
      else if (l.type === 'uncertain') x.state = 'uncertain';
      else if (l.type === 'reconciled') { if (l.taskId) Object.assign(x, {state: 'posted', taskId: l.taskId, posted: l}); else x.state = 'released'; }
      else if (l.type === 'settle') Object.assign(x, {state: l.status.toLowerCase(), billed: l.billed, settle: l});
      else if (l.type === 'raw') x.raw = l;
      else if (l.type === 'accept') Object.assign(x, {accepted: true, accept: l});
      else if (l.type === 'reject') Object.assign(x, {accepted: false, reject: l});
      x.lines[l.type] = l.seq;
    }
    const all = [...res.values()];
    const billed = all.reduce((s, x) => s + x.billed, 0);
    const reserved = all.filter(x => ['reserved', 'posted', 'uncertain'].includes(x.state)).reduce((s, x) => s + x.reserve.credits, 0);
    return {res, billed, reserved, attempts: all.length, posts: all.length};
  }
  const ledger = ledgerState(), CAPS = cfg.caps;
  if (ledger.billed + ledger.reserved > CAPS.credits || ledger.attempts > CAPS.attempts || ledger.posts > CAPS.posts) throw new Error(`${name} ledger outside the caps: ${JSON.stringify({billed: ledger.billed, reserved: ledger.reserved, attempts: ledger.attempts})}`);

  const codexLines = new Map();
  function codexOf(lane, inputSha, asset) {
    if (!codexLines.has(lane)) {
      const f = path.join(GEN, 'lanes', lane, 'codex.jsonl');
      codexLines.set(lane, fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim().startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
    }
    const hit = codexLines.get(lane).filter(l => l.phase === 'result' && l.sha256 === inputSha);
    if (!hit.length) return null;
    const h = hit[hit.length - 1];
    const intent = codexLines.get(lane).find(l => l.phase === 'intent' && l.id === h.id && l.attempt === h.attempt);
    const base = {lane, asset: h.id, attempt: h.attempt, session: h.session, status: h.status, size: h.size, bytes: h.bytes, sha256: h.sha256};
    if (name === 'production') return {...base, identityReferenceSha256: intent?.inputSha256 ?? h.inputSha256 ?? null, promptSha256: intent?.promptSha256 ?? null,
      generator: 'OpenAI Codex CLI built-in image_gen (image model id not reported)'};
    // the redo's intent lines list every attached image (Image 1 = the approved concept original; Image 2 = the previous straight-on
    // reference, framing only, unless --identity-only); the extra note text is prompt content (not kept: only whether one was given)
    const ins = intent?.inputSha256 ?? [];
    return {...base, inputImages: ins.map((s, i) => ({image: i + 1, sha256: s, role: s === approved.get(asset)?.sourceImageSha256 ? 'the user-approved concept original (identity)' : 'the previous production straight-on reference (framing only)'})),
      identityOnly: intent?.identityOnly ?? null, extraInstruction: intent ? !!intent.extra : null, promptSha256: intent?.promptSha256 ?? null,
      imageGenGenerations: h.imageGenGenerations ?? null, generator: 'OpenAI Codex CLI built-in image_gen (image model id not reported)'};
  }
  const relT = f => { const rel = path.relative(T, f); if (rel.startsWith('..')) throw new Error(`${f} is outside the task dir`); return `${cfg.dir}/${rel.split(path.sep).join('/')}`; };
  const latestAccepted = id => [...ledger.res.values()].filter(x => x.reserve.asset === id && x.accepted === true).sort((p, q) => q.accept.seq - p.accept.seq)[0] ?? null;

  function records(row) {
    const a = approved.get(row.id);
    const x = latestAccepted(row.id);
    if (!x) return null;
    const rv = x.reserve;
    const fail = m => { throw new Error(`${row.id} ${rv.res}: ${m}`); };
    if (x.state !== 'succeeded' || !x.settle || x.settle.status !== 'SUCCEEDED') fail(`accepted but not SUCCEEDED (${x.state})`);
    if (!x.taskId || !x.raw) fail('no task id / raw line');
    if (rv.approvalSha256 !== approvalSha) fail('reservation approval sha256 != USER-GENERATION-APPROVAL.json');
    if (rv.approvedSourceSha256 !== a.sourceImageSha256) fail('approved concept sha256 mismatch');
    if (rv.params?.file_path !== rv.input || rv.params?.ai_model !== 'meshy-t2.5' || rv.params?.model_type !== 'smart-topology' || rv.params?.enable_pbr !== true) fail('reservation params are not the approved T2.5 PBR recipe');
    const inputBytes = fs.readFileSync(rv.input);
    if (sha(inputBytes) !== rv.inputSha256 || inputBytes.length !== rv.inputBytes) fail('conditioning image sha256 / bytes mismatch');
    const rawFile = x.raw.file;
    if (path.dirname(path.resolve(rawFile)) !== path.join(GEN, 'raw') || !path.basename(rawFile).startsWith(`${row.id}-`) || !path.basename(rawFile).includes(x.taskId)) fail(`raw file name ${rawFile} is not gen/raw/<ID>-<RES>-<taskId>.glb`);
    const bytes = fs.readFileSync(rawFile);
    if (sha(bytes) !== x.raw.sha256 || bytes.length !== x.raw.bytes) fail(`raw original sha256 / bytes mismatch (${rawFile})`);
    const codex = codexOf(cfg.codexLane(rv), rv.inputSha256, row.id);
    if (name === 'redo') { // the redo broker's own admission rule: a status-ok Codex image of THIS task for this asset id, the session it recorded
      if (!codex || codex.status !== 'ok' || codex.asset !== row.id) fail('no status-ok Codex result line of this task for the conditioning image');
      if (rv.codexSession !== codex.session || rv.codexAttempt !== codex.attempt) fail('the reservation\'s Codex session / attempt != the Codex result line');
    }
    return {task: taskApi, res: rv.res, lane: rv.lane, taskId: x.taskId, reserve: rv, settle: x.settle, raw: x.raw, accept: x.accept, lines: x.lines, bytes, inputBytes, codex, approvedAsset: a,
      attemptsForAsset: [...ledger.res.values()].filter(y => y.reserve.asset === row.id).map(y => ({res: y.reserve.res, state: y.state, accepted: y.accepted ?? null}))};
  }
  function previous(row) {
    const x = latestAccepted(row.id);
    return x && {task: cfg.task, reservation: x.reserve.res, lane: x.reserve.lane, meshyTask: x.taskId, conditioningImageSha256: x.reserve.inputSha256,
      raw: {file: `${relT(x.raw.file)} (raw original, read-only, outside Git)`, sha256: x.raw.sha256, bytes: x.raw.bytes}};
  }
  const taskApi = {name, ...cfg, approved, excluded: manifest.excluded ?? [], approvalSha, records, previous, relT, ledger,
    approval: {userGenerationApprovalSha256: approvalSha, summary: cfg.approvalSummary}};
  return taskApi;
}
const PROD = taskRecords('production'), FOOD = taskRecords('redo');
for (const r of JUNK) if (!PROD.approved.has(r.id) || PROD.excluded.includes(r.id)) throw new Error(`${r.id}: not an approved production asset`);
if (ITEMS.length + JUNK.length !== PROD.approved.size) throw new Error('the plan table does not cover the production manifest');
for (const r of ITEMS) if (!FOOD.approved.has(r.id) || FOOD.excluded.includes(r.id) || !PROD.approved.has(r.id)) throw new Error(`${r.id}: not an approved redo asset`);
if (ITEMS.length !== FOOD.approved.size) throw new Error('the plan table does not cover the redo manifest');
for (const r of ITEMS) if (FOOD.approved.get(r.id).itemDef !== r.slug) throw new Error(`${r.id}: redo manifest itemDef ${FOOD.approved.get(r.id).itemDef} != ${r.slug}`);
for (const r of ITEMS) for (const k of Object.keys(ADJUST[r.id] ?? {})) if (!['dropIslands', 'flatten', 'press', 'turn', 'layFlat', 'standUp', 'settle'].includes(k)) throw new Error(`${r.id}: ADJUST.${k} is not a collectible adjustment (the exact per-axis fit sets the extents)`);
for (const r of JUNK) if (ADJUST[r.id]?.standUp) throw new Error(`${r.id}: standUp is a collectible adjustment`);

// ---------- geometry ----------
async function readSource(id, rec) {
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh());
  const fail = m => { throw new Error(`${id}: ${m}`); };
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) fail('expected one mesh node / mesh / material');
  const M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) fail('non-identity source node');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) fail('expected one triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`missing ${s}`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) fail('unexpected material (alpha / occlusion / emissive)');
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) if (!info || info.getTexCoord() !== 0) fail('a map is missing or uses TEXCOORD_1');
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: p.getAttribute('POSITION').getCount()}, (_, i) => i);
  const m = {P: Float32Array.from(p.getAttribute('POSITION').getArray()), N: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), I};
  const textures = {baseColor: mat.getBaseColorTexture(), metallicRoughness: mat.getMetallicRoughnessTexture(), normal: mat.getNormalTexture()};
  const maps = SLOTS.map(slot => { const t = textures[slot]; return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}; });
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  const extraSemantics = p.listSemantics().filter(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s));
  return {doc, prim: p, mat, m, maps, material, textures, extraSemantics};
}

/** Exact-attribute weld (bitwise-equal position / normal / uv) + degenerate-triangle and unreferenced-vertex removal; lossless. */
function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) {
    A.set(m.P.subarray(3 * v, 3 * v + 3), v * stride); A.set(m.N.subarray(3 * v, 3 * v + 3), v * stride + 3); A.set(m.UV.subarray(2 * v, 2 * v + 2), v * stride + 6);
  }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [], used = new Uint8Array(nv);
  for (let i = 0; i < m.I.length; i++) used[m.I[i]] = 1;
  let unreferenced = 0;
  for (let v = 0; v < nv; v++) {
    if (!used[v]) { unreferenced++; continue; }
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    for (let s = (h >>> 0) & (cap - 1); ; s = (s + 1) & (cap - 1)) {
      const w = table[s];
      if (w < 0) { table[s] = first.length; remap[v] = first.length; first.push(v); break; }
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[first[w] * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = w; break; }
    }
  }
  const n = first.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  first.forEach((v, i) => { P.set(m.P.subarray(3 * v, 3 * v + 3), 3 * i); N.set(m.N.subarray(3 * v, 3 * v + 3), 3 * i); UV.set(m.UV.subarray(2 * v, 2 * v + 2), 2 * i); });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {P, N, UV, I: Uint32Array.from(I), weld: {verticesBefore: nv, verticesAfter: n, unreferencedVerticesDropped: unreferenced, degenerateTrianglesDropped: degenerate}};
}

/** UV charts = index-connected triangle groups (Meshy splits vertices at chart borders). */
function uvCharts(m) {
  const nv = m.P.length / 3, parent = Int32Array.from({length: nv}, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let f = 0; f < m.I.length; f += 3) for (const [a, b] of [[m.I[f], m.I[f + 1]], [m.I[f + 1], m.I[f + 2]]]) { const x = find(a), y = find(b); if (x !== y) parent[x] = y; }
  const roots = new Set();
  for (let f = 0; f < m.I.length; f += 3) roots.add(find(m.I[f]));
  return roots.size;
}

/**
 * The budget steps: the class budget first; a model whose seam-preserving result at a step is visibly crumpled (relative error >
 * MAX_KEEP_ERROR, e.g. a crate full of fruit under a torn wrap) takes the next step (recorded), never a crumpled mesh.
 */
async function simplifyStepped(m, budgets) {
  const tried = [];
  for (const budget of budgets) {
    const r = await simplify(m, budget);
    if (r.info.applied || r.info.reason.startsWith('already')) return {m: r.m, info: {...r.info, budgetSteps: budgets, ...(tried.length ? {raisedFrom: tried} : {})}};
    tried.push({budget, reason: r.info.reason, attempt: r.info.attempt});
  }
  return {m, info: {applied: false, reason: `no budget step gives an uncrumpled seam-preserving result: source mesh kept`, triangles: m.I.length / 3, budgetSteps: budgets, raisedFrom: tried}};
}

/** Simplification on the welded source buffer (UVs / normals kept); `kept` + reason when it stalls or crumples. mode: seam | permissive. */
async function simplify(m, budget, mode = 'seam', maxError = MAX_KEEP_ERROR) {
  const tris0 = m.I.length / 3;
  if (tris0 <= budget) return {m, info: {applied: false, reason: `already within the ${budget} budget`, triangles: tris0, budget}};
  await MeshoptSimplifier.ready;
  const nv = m.P.length / 3, attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) attrs[5 * v + k] = m.N[3 * v + k] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  const flags = mode === 'permissive' ? ['Permissive'] : [];
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget (or makes no progress)
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 10; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, SIMPLIFY.targetError, flags);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  const attempt = {mode, fromTriangles: tris0, triangles: out.length / 3, budget, askedTriangles: ask, passes: passes + 1, errorRelative: r6(err)};
  if (out.length / 3 > budget) return {m, info: {applied: false, reason: `the UV seams stall the ${mode} collapse at ${out.length / 3} triangles (> the ${budget} budget): source mesh kept rather than smear the texture`, triangles: tris0, budget, attempt}};
  if (err > maxError) return {m, info: {applied: false, reason: `the ${mode} result at the budget is visibly crumpled (relative error ${r6(err)} > ${maxError}): source mesh kept`, triangles: tris0, budget, attempt}};
  const map = new Int32Array(nv).fill(-1), P = [], N = [], UV = [], I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (map[v] < 0) { map[v] = P.length / 3; P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    I[i] = map[v];
  }
  return {m: {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I},
    info: {applied: true, tool: mode === 'permissive' ? SIMPLIFY.toolPermissive : SIMPLIFY.tool, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, targetError: SIMPLIFY.targetError, ...attempt,
      errorSourceUnits: r6(err * MeshoptSimplifier.getScale(m.P, 3))}};
}

/** Position-connected islands (exact positions; as the lanes' islands.mjs): [{tris: [triangle indices], verts: Set, min, max}], largest first. */
function islands(m) {
  const nv = m.P.length / 3, key = new Map(), rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${m.P[3 * v]},${m.P[3 * v + 1]},${m.P[3 * v + 2]}`; if (!key.has(k)) key.set(k, key.size); rep[v] = key.get(k); }
  const par = Int32Array.from({length: key.size}, (_, i) => i);
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const T = m.I.length / 3;
  for (let t = 0; t < T; t++) { const a = rep[m.I[3 * t]], b = rep[m.I[3 * t + 1]], c = rep[m.I[3 * t + 2]]; par[f(a)] = f(b); par[f(b)] = f(c); }
  const comps = new Map();
  for (let t = 0; t < T; t++) {
    const c = f(rep[m.I[3 * t]]);
    if (!comps.has(c)) comps.set(c, {tris: [], verts: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
    const o = comps.get(c); o.tris.push(t);
    for (let k = 0; k < 3; k++) { const v = m.I[3 * t + k]; o.verts.add(v); for (let r = 0; r < 3; r++) { o.min[r] = Math.min(o.min[r], m.P[3 * v + r]); o.max[r] = Math.max(o.max[r], m.P[3 * v + r]); } }
  }
  return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length);
}

/** The raw-mesh adjustments (ADJUST.dropIslands / flatten), in raw Meshy units; returns the new mesh + a record. */
function preAdjust(id, m, adj) {
  const rec = {};
  if (adj?.dropIslands) {
    // minZ: islands lying wholly in front of raw z = minZ; inBox: islands lying wholly inside the raw box (an extruded label illustration
    // in front of the face, clear of the product's own parts); the dropped / kept triangle counts must match the recorded ones
    const a = adj.dropIslands, list = islands(m), boxes = a.inBox ? [a.inBox].flat() : [];
    const inside = o => boxes.some(b => [0, 1, 2].every(k => o.min[k] >= b.min[k] && o.max[k] <= b.max[k]));
    const drop = list.filter(o => (a.inBox ? inside(o) : o.min[2] >= a.minZ));
    const dropTris = drop.reduce((s, o) => s + o.tris.length, 0), keepTris = m.I.length / 3 - dropTris;
    if (dropTris !== a.dropTris || keepTris !== a.keepTris || (a.islands != null && drop.length !== a.islands)) throw new Error(`${id}: island drop ${drop.length} islands / ${dropTris} tris, keep ${keepTris} != the expected ${a.islands ?? '-'} / ${a.dropTris} / ${a.keepTris}`);
    const gone = new Set(drop.flatMap(o => o.tris)), I = [];
    for (let t = 0; t < m.I.length / 3; t++) if (!gone.has(t)) I.push(m.I[3 * t], m.I[3 * t + 1], m.I[3 * t + 2]);
    m = {...m, I: Uint32Array.from(I)};
    rec.dropIslands = {rule: a.inBox ? `position-connected islands lying wholly inside the raw box${boxes.length > 1 ? 'es' : ''} ${boxes.map(b => `min ${JSON.stringify(b.min)} max ${JSON.stringify(b.max)}`).join(' / ')} (Meshy units)` : `position-connected islands lying wholly in front of raw z = ${a.minZ} (min z >= ${a.minZ})`,
      islands: drop.length, ofIslands: list.length, droppedTriangles: dropTris, keptTriangles: keepTris, droppedBounds: drop.map(o => ({tris: o.tris.length, min: o.min.map(r4), max: o.max.map(r4)})), why: a.why};
  }
  if (adj?.flatten) {
    const a = adj.flatten, list = islands(m);
    const hit = list.filter(o => o.tris.length === a.tris && o.min.every((v, k) => Math.abs(v - a.min[k]) < 0.002) && o.max.every((v, k) => Math.abs(v - a.max[k]) < 0.002));
    if (hit.length !== 1) throw new Error(`${id}: expected exactly one island of ${a.tris} triangles at the recorded raw bounds, found ${hit.length}`);
    const P = Float32Array.from(m.P), N = Float32Array.from(m.N);
    for (const v of hit[0].verts) {
      P[3 * v + 2] = a.toZ + (P[3 * v + 2] - a.toZ) * a.factor;
      const x = N[3 * v], y = N[3 * v + 1], z = N[3 * v + 2] / a.factor, l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    m = {...m, P, N};
    rec.flatten = {island: {tris: a.tris, min: hit[0].min.map(r4), max: hit[0].max.map(r4)}, rule: `z' = ${a.toZ} + (z - ${a.toZ}) * ${a.factor} for the island's vertices (raw units); normals inverse-transpose, renormalised`, why: a.why};
  }
  if (adj?.press) m = press(id, m, adj.press, rec);
  return {m, rec};
}

/**
 * ADJUST.press: the islands lying wholly inside the raw box(es) (an extruded label illustration) are pressed along z onto the rest of the
 * mesh's front surface: each island vertex at (x, y, z) over the front-most surface point zs (a ray along -z against the other triangles)
 * goes to zs + offset + (z - zs) * factor in front of it, or zs + (z - zs) * factor behind it; the front side takes the surface's normal
 * there (the picture lies on the label like print), the hidden side the inverse transpose of the z squash. Meshy's UVs / maps unchanged.
 */
function press(id, m, a, rec) {
  const list = islands(m), boxes = [a.inBox].flat();
  const sel = list.filter(o => boxes.some(b => [0, 1, 2].every(k => o.min[k] >= b.min[k] && o.max[k] <= b.max[k])));
  const selTris = sel.reduce((s, o) => s + o.tris.length, 0);
  if (sel.length !== a.islands || selTris !== a.tris) throw new Error(`${id}: press selects ${sel.length} islands / ${selTris} tris != the expected ${a.islands} / ${a.tris}`);
  const own = new Set(sel.flatMap(o => o.tris)), T = m.I.length / 3, body = [];
  for (let t = 0; t < T; t++) if (!own.has(t)) body.push(t);
  // x-y grid of the receiving triangles' projected bounds
  const G = 64, bb = boundsOf(m.P), cx = (bb.max[0] - bb.min[0]) / G || 1, cy = (bb.max[1] - bb.min[1]) / G || 1;
  const cell = (x, y) => [Math.min(G - 1, Math.max(0, Math.floor((x - bb.min[0]) / cx))), Math.min(G - 1, Math.max(0, Math.floor((y - bb.min[1]) / cy)))];
  const grid = Array.from({length: G * G}, () => []);
  for (const t of body) {
    const v = [0, 1, 2].map(k => m.I[3 * t + k]);
    const [x0, y0] = cell(Math.min(...v.map(q => m.P[3 * q])), Math.min(...v.map(q => m.P[3 * q + 1]))), [x1, y1] = cell(Math.max(...v.map(q => m.P[3 * q])), Math.max(...v.map(q => m.P[3 * q + 1])));
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) grid[gy * G + gx].push(t);
  }
  const front = (x, y) => { // the front-most receiving surface over (x, y): z + interpolated (outward) normal
    let best = null;
    const [gx, gy] = cell(x, y);
    for (const t of grid[gy * G + gx]) {
      const [i, j, k] = [0, 1, 2].map(q => 3 * m.I[3 * t + q]);
      const d = (m.P[j + 1] - m.P[k + 1]) * (m.P[i] - m.P[k]) + (m.P[k] - m.P[j]) * (m.P[i + 1] - m.P[k + 1]);
      if (Math.abs(d) < 1e-14) continue;
      const b0 = ((m.P[j + 1] - m.P[k + 1]) * (x - m.P[k]) + (m.P[k] - m.P[j]) * (y - m.P[k + 1])) / d;
      const b1 = ((m.P[k + 1] - m.P[i + 1]) * (x - m.P[k]) + (m.P[i] - m.P[k]) * (y - m.P[k + 1])) / d, b2 = 1 - b0 - b1;
      if (b0 < -1e-9 || b1 < -1e-9 || b2 < -1e-9) continue;
      const z = b0 * m.P[i + 2] + b1 * m.P[j + 2] + b2 * m.P[k + 2];
      if (!best || z > best.z) best = {z, n: [0, 1, 2].map(c => b0 * m.N[i + c] + b1 * m.N[j + c] + b2 * m.N[k + c])};
    }
    return best;
  };
  const P = Float32Array.from(m.P), N = Float32Array.from(m.N);
  let misses = 0, maxRelief = 0;
  for (const o of sel) for (const v of o.verts) {
    const x = m.P[3 * v], y = m.P[3 * v + 1], z = m.P[3 * v + 2], s = front(x, y);
    if (!s) { misses++; continue; }
    const dz = z - s.z, nz = dz > 0 ? s.z + a.offset + dz * a.factor : s.z + dz * a.factor;
    P[3 * v + 2] = nz;
    maxRelief = Math.max(maxRelief, nz - s.z);
    const n = dz > 0 ? s.n : [m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2] / a.factor], l = Math.hypot(...n) || 1;
    for (let c = 0; c < 3; c++) N[3 * v + c] = n[c] / l;
  }
  if (misses) throw new Error(`${id}: press: ${misses} island vertices have no receiving surface behind them`);
  rec.press = {rule: `position-connected islands lying wholly inside the raw box${boxes.length > 1 ? 'es' : ''} ${boxes.map(b => `min ${JSON.stringify(b.min)} max ${JSON.stringify(b.max)}`).join(' / ')} (Meshy units) pressed along z onto the front-most other surface zs: z' = zs + ${a.offset} + (z - zs) * ${a.factor} in front of it, zs + (z - zs) * ${a.factor} behind it; the front side takes the surface normal, the hidden side the inverse transpose`,
    islands: sel.length, triangles: selTris, maxReliefRaw: r4(maxRelief), pressedBounds: sel.map(o => ({tris: o.tris.length, min: o.min.map(r4), max: o.max.map(r4)})), why: a.why};
  return {...m, P, N};
}

function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return {min, max};
}

/** The plan's reference measure on a mesh in its final frame (a laid-flat model: H on z, W / D on the x / y footprint). */
function measureOf(P, fit, layFlat) {
  const b = boundsOf(P), e = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  if (fit.h) return layFlat ? e[2] : e[1];
  if (layFlat) return Math.max(e[0], e[1]);
  if (!fit.band) return Math.max(e[0], e[2]);
  const lo = b.min[1] + fit.band[0] * e[1], hi = b.min[1] + fit.band[1] * e[1];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= lo && P[i + 1] <= hi) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  return Math.max(x1 - x0, z1 - z0);
}

/** The UNIFORM fit on the plan's reference measure: scale, grounded, centred on x / z (normals unchanged under a uniform scale). */
function fitMesh(low, fit) {
  const b = boundsOf(low.P);
  let s, info;
  if (fit.h) { s = fit.h / (b.max[1] - b.min[1]); info = {measure: 'H', kind: 'the full height (y extent)', size: fit.h}; }
  else {
    const size = fit.w ?? fit.d;
    let x0 = b.min[0], x1 = b.max[0], z0 = b.min[2], z1 = b.max[2];
    if (fit.band) {
      const lo = b.min[1] + fit.band[0] * (b.max[1] - b.min[1]), hi = b.min[1] + fit.band[1] * (b.max[1] - b.min[1]);
      x0 = z0 = Infinity; x1 = z1 = -Infinity;
      for (let i = 0; i < low.P.length; i += 3) if (low.P[i + 1] >= lo && low.P[i + 1] <= hi) { x0 = Math.min(x0, low.P[i]); x1 = Math.max(x1, low.P[i]); z0 = Math.min(z0, low.P[i + 2]); z1 = Math.max(z1, low.P[i + 2]); }
    }
    const ex = x1 - x0, ez = z1 - z0, axis = ex >= ez ? 'x' : 'z';
    s = size / Math.max(ex, ez);
    info = {measure: fit.w ? 'W' : 'D', kind: `${fit.w ? 'the width / length' : 'the diameter'} = the longer horizontal extent (${axis})${fit.band ? ` within the ${fit.band.map(v => `${v * 100} %`).join(' - ')} height band` : ''}`, size, axis};
  }
  const P = low.P.map(v => v * s), N = Float32Array.from(low.N);
  const out = {...info, scale: r6(s), measuredOn: 'the welded (and simplified) mesh that ships'};
  // stretch: a face-on conditioning image leaves the reconstructed depth (z) of flat-faced packaging a guess; the named raw axes are
  // scaled about their centre to the real product extents (normals by the inverse transpose)
  if (fit.stretch) {
    const bz = boundsOf(P), k = [1, 1, 1], from = {};
    ['x', 'y', 'z'].forEach((ax, i) => { if (fit.stretch[ax]) { from[ax] = r4(bz.max[i] - bz.min[i]); k[i] = fit.stretch[ax] / (bz.max[i] - bz.min[i]); } });
    const c = [0, 1, 2].map(i => (bz.min[i] + bz.max[i]) / 2);
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = c[a] + (P[i + a] - c[a]) * k[a];
    for (let i = 0; i < N.length; i += 3) { const x = N[i] / k[0], y = N[i + 1] / k[1], z = N[i + 2] / k[2], l = Math.hypot(x, y, z) || 1; N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l; }
    out.stretch = {axes: 'raw (before any turn / lay-flat)', fromM: from, toM: Object.fromEntries(['x', 'y', 'z'].filter(a => fit.stretch[a]).map(a => [a, fit.stretch[a]])),
      factors: k.map(r6), reason: fit.stretch.why, normals: 'inverse-transpose, renormalised'};
  }
  if (fit.turn) {
    for (const A of [P, N]) for (let i = 0; i < A.length; i += 3) { A[i] = -A[i]; A[i + 2] = -A[i + 2]; }
    out.turn = {rotation: 'a half turn about y: (x, y, z) -> (-x, y, -z)', reason: fit.turn};
  }
  // lie flat: a quarter turn about x, the front (+Z) face up (+Y), the old top to -Z
  if (fit.layFlat) {
    for (const A of [P, N]) for (let i = 0; i < A.length; i += 3) { const y = A[i + 1], z = A[i + 2]; A[i + 1] = z; A[i + 2] = -y; }
    out.layFlat = {rotation: 'a quarter turn about x: (x, y, z) -> (x, z, -y); the front (+Z) face up, the old top at -Z', reason: fit.layFlat};
  }
  // rest pose: a model standing on a speck (a dangling tag) is rolled about z, rigidly, onto the support edge of its x-y hull on the side
  // of its centre of mass (two contacts), as it would settle under gravity
  if (fit.settle) {
    const rolls = {aboutZDeg: 0, aboutXDeg: 0};
    for (let it = 0; it < 8; it++) {
      let moved = false;
      for (const h of [0, 2]) { // h = the horizontal axis of the tipping plane: x (a roll about z) or z (a roll about x)
        let minY = Infinity;
        for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]);
        let h0 = Infinity, h1 = -Infinity, i0 = -1, i1 = -1;
        for (let i = 0; i < P.length; i += 3) if (P[i + 1] < minY + 1e-5) { if (P[i + h] < h0) { h0 = P[i + h]; i0 = i; } if (P[i + h] > h1) { h1 = P[i + h]; i1 = i; } }
        const C = centroid(P, low.I)[h];
        if (C >= h0 - 1e-4 && C <= h1 + 1e-4) continue; // the centre of mass is over the contacts along this axis
        const dir = C < h0 ? -1 : 1, li = dir < 0 ? i0 : i1, L = [P[li + h], P[li + 1]];
        let best = null;
        for (let i = 0; i < P.length; i += 3) {
          const d = dir * (P[i + h] - L[0]);
          if (d < 1e-4) continue;
          const ang = Math.atan2(P[i + 1] - L[1], d);
          if (!best || ang < best) best = ang;
        }
        if (best == null) continue;
        const th = dir < 0 ? best : -best, c = Math.cos(th), sn = Math.sin(th);
        for (let i = 0; i < P.length; i += 3) { const x = P[i + h] - L[0], y = P[i + 1] - L[1]; P[i + h] = x * c - y * sn + L[0]; P[i + 1] = x * sn + y * c + L[1]; }
        for (let i = 0; i < N.length; i += 3) { const x = N[i + h], y = N[i + 1]; N[i + h] = x * c - y * sn; N[i + 1] = x * sn + y * c; }
        rolls[h ? 'aboutXDeg' : 'aboutZDeg'] += (h ? -1 : 1) * th * 180 / Math.PI;
        moved = true;
      }
      if (!moved) break;
    }
    out.restPose = {rollAboutZDeg: r4(rolls.aboutZDeg), rollAboutXDeg: r4(rolls.aboutXDeg), reason: fit.settle,
      method: 'rigid rolls about z and x (alternating), each pivoting on the outermost floor contact toward the centre of mass (surface-weighted centroid) onto the next hull support, until the centre of mass is over the contacts on both axes'};
  }
  const bb = boundsOf(P), tx = -(bb.min[0] + bb.max[0]) / 2, ty = -bb.min[1], tz = -(bb.min[2] + bb.max[2]) / 2;
  for (let i = 0; i < P.length; i += 3) { P[i] += tx; P[i + 1] += ty; P[i + 2] += tz; }
  return {P, N, fit: {...out, translate: [tx, ty, tz].map(r6), rotation: fit.layFlat ? 'laid flat (front face up)' : fit.turn ? 'a half turn about y (the clean label to the front)' : fit.settle ? 'the rest-pose roll about z only (front +Z, +Y up kept)' : 'none (Meshy native front +Z, +Y up kept)'}};
}

/** Surface-area-weighted centroid (x, y, z) of an indexed mesh (the centre of mass of a thin shell). */
function centroid(P, I) {
  let A = 0, x = 0, y = 0, z = 0;
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const w = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    A += w; x += w * (P[a] + P[b] + P[c]) / 3; y += w * (P[a + 1] + P[b + 1] + P[c + 1]) / 3; z += w * (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
  }
  return [x / A, y / A, z / A];
}

/** Cooks one model's geometry (weld -> simplify -> uniform fit) and its measurements. */
async function cookGeometry(row, rec) {
  const src = await readSource(row.id, rec);
  const srcB = boundsOf(src.m.P);
  const extent = [0, 1, 2].map(k => r4(srcB.max[k] - srcB.min[k]));
  const uv = src.m.UV;
  let umin = Infinity, umax = -Infinity;
  for (let i = 0; i < uv.length; i++) { umin = Math.min(umin, uv[i]); umax = Math.max(umax, uv[i]); }
  if (umin < -1e-4 || umax > 1 + 1e-4) throw new Error(`${row.id}: UVs outside [0, 1] (${umin} .. ${umax}); wrapping cannot be atlas-packed`);
  const adj = ADJUST[row.id] ?? {};
  const pre = preAdjust(row.id, src.m, adj);
  const welded = weld(pre.m); // (the weld also drops vertices no longer referenced after an island removal)
  const charts = uvCharts(welded);
  const {m: low, info: simp} = await simplifyStepped(welded, ITEM_BUDGETS);
  // the pose (half turn / lay-flat / rest-pose roll) and the uniform fit on the plan's reference measure (rigid poses commute with the
  // uniform scale: the measure is the plan's, as fitMesh defines it), then the exact per-axis fit to the item's nominal extents
  // standUp (collectibles): a quarter turn about x the other way round from layFlat, (x, y, z) -> (x, -z, y): a label Meshy built facing
  // up (+Y) turns to the front (+Z); applied rigidly before the fit (the reference measure is then taken in the upright frame)
  const up = adj.standUp ? {...low, P: Float32Array.from(low.P), N: Float32Array.from(low.N)} : low;
  if (adj.standUp) for (const A of [up.P, up.N]) for (let i = 0; i < A.length; i += 3) { const y = A[i + 1], z = A[i + 2]; A[i + 1] = -z; A[i + 2] = y; }
  const posed = fitMesh(up, {...row.fit, turn: adj.turn, layFlat: adj.layFlat, settle: adj.settle});
  const {P, N, axisFit} = exactFit(row, posed.P, posed.N);
  const stood = adj.standUp ? {standUp: {rotation: 'a quarter turn about x: (x, y, z) -> (x, -z, y); the raw up (+Y) face to the front (+Z), the raw front (+Z) down', reason: adj.standUp}} : {};
  const fit = {...posed.fit, ...stood, axisFit, rotation: adj.standUp ? 'stood up (the label Meshy built facing up turned to the front +Z)' : posed.fit.rotation, translate: axisFit.translate, uniformTranslate: posed.fit.translate};
  const b = boundsOf(P);
  const dims = [0, 1, 2].map(k => r4(b.max[k] - b.min[k]));
  return {src, extent, welded, charts, simp, fit, adjust: Object.keys(pre.rec).length ? pre.rec : null, mesh: {P, N, UV: low.UV, I: low.I}, dims, min: b.min.map(r6), max: b.max.map(r6), uvRange: [r6(umin), r6(umax)]};
}

/**
 * The exact per-axis fit of a posed, uniformly fitted collectible: each axis is scaled about the box centre to the item's NOMINAL
 * resting-pose extent (normals by the inverse transpose, renormalised), then grounded (min y = 0) and centred on x / z. The factors show
 * how far the new model's proportions differ from the item box (1 = the uniform fit already matches); those outside AXIS_REVIEW are flagged.
 */
function exactFit(row, P0, N0) {
  const P = Float32Array.from(P0), N = Float32Array.from(N0), b = boundsOf(P);
  const ext = [0, 1, 2].map(a => b.max[a] - b.min[a]), c = [0, 1, 2].map(a => (b.min[a] + b.max[a]) / 2);
  const k = row.nominal.map((v, a) => v / ext[a]);
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = c[a] + (P[i + a] - c[a]) * k[a];
  for (let i = 0; i < N.length; i += 3) { const x = N[i] / k[0], y = N[i + 1] / k[1], z = N[i + 2] / k[2], l = Math.hypot(x, y, z) || 1; N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l; }
  const bb = boundsOf(P), t = [-(bb.min[0] + bb.max[0]) / 2, -bb.min[1], -(bb.min[2] + bb.max[2]) / 2];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] += t[a];
  const fb = boundsOf(P), dims = [0, 1, 2].map(a => r4(fb.max[a] - fb.min[a]));
  if (dims.some((v, a) => v !== row.nominal[a])) throw new Error(`${row.id}: exact fit ${dims.join(' x ')} != nominal ${row.nominal.join(' x ')}`);
  const review = ['x', 'y', 'z'].filter((_, a) => k[a] < AXIS_REVIEW[0] || k[a] > AXIS_REVIEW[1]);
  return {P, N, axisFit: {nominalM: row.nominal, fromM: ext.map(r4), factors: k.map(r6), axes: 'the final resting-pose frame (x = w, y = h, z = d)',
    rule: 'each axis scaled about the box centre to the exact nominal extent (the item dims container fit and food-variety choice read), normals inverse-transpose, renormalised; then grounded / centred',
    reviewBand: AXIS_REVIEW, review: review.length ? `factor(s) outside ${AXIS_REVIEW.join(' - ')} on ${review.join(', ')}: checked visually` : null, translate: t.map(r6)}};
}

const checkFactors = (id, mt) => {
  const one = v => Math.abs(v - 1) < 1e-6;
  if (!mt.baseColorFactor.every(one) || !one(mt.metallicFactor) || !one(mt.roughnessFactor) || !one(mt.normalScale)) throw new Error(`${id}: Meshy material factors are not all 1 (${JSON.stringify(mt)}); the shared atlas material cannot hold them`);
};
const indexArray = (I, nv) => (nv < 65536 ? Uint16Array.from(I) : Uint32Array.from(I));
const resizeMap = async (img, px) => sharp(Buffer.from(img)).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'});
const noUrls = (id, glb) => { const j = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString(); if (/https?:|Signature|X-Amz|token/i.test(j)) throw new Error(`${id}: URL / token-like string inside the glTF JSON`); };

// ---------- collectibles ----------
const itemOut = [], skipped = [];
for (const row of ITEMS) {
  const rec = FOOD.records(row);
  if (!rec) { skipped.push(row.id); continue; }
  const id = `food-${dashed(row.slug)}`, url = `assets/models/${id}.glb`, provRel = `assets/derivatives/food-shelf-${dashed(row.slug)}-model.json`;
  const g = await cookGeometry(row, rec);
  const {doc, prim, mat} = g.src;
  const r = doc.getRoot();
  const nv = g.mesh.P.length / 3;
  for (const s of g.src.extraSemantics) prim.setAttribute(s, null);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.mesh.P).setBuffer(r.listBuffers()[0]));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.mesh.N)).setBuffer(r.listBuffers()[0]));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(g.mesh.UV)).setBuffer(r.listBuffers()[0]));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indexArray(g.mesh.I, nv)).setBuffer(r.listBuffers()[0]));
  const tx = itemTex(row.id), px = {baseColor: tx[0], metallicRoughness: tx[1], normal: tx[2]};
  for (const slot of SLOTS) {
    const t = g.src.textures[slot];
    const img = await (await resizeMap(t.getImage(), px[slot])).jpeg(JPEG[slot]).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI(`${id}-${slot}.jpg`).setName(`${id}-${slot}`);
  }
  r.listMeshes()[0].setName(id); r.listNodes().forEach(n => n.setName(id)); mat.setName(id);
  r.listScenes().forEach(sc => sc.setName(id));
  await doc.transform(dedup(), prune());
  r.getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  noUrls(id, glb);
  // ---- verify the written bytes + measure on them
  const chk = await io.readBinary(new Uint8Array(glb));
  const cr = chk.getRoot();
  if (cr.listNodes().length !== 1 || cr.listMeshes().length !== 1 || cr.listMeshes()[0].listPrimitives().length !== 1 || cr.listMaterials().length !== 1 || cr.listTextures().length !== 3) throw new Error(`${id}: not one node / mesh / primitive / material with three maps`);
  const bb = getBounds(cr.getDefaultScene() ?? cr.listScenes()[0]);
  const dims = [0, 1, 2].map(k => r4(bb.max[k] - bb.min[k]));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 1e-3 || Math.abs(bb.min[2] + bb.max[2]) > 1e-3) throw new Error(`${id}: not grounded / centred`);
  const cp = cr.listMeshes()[0].listPrimitives()[0];
  const tris = cp.getIndices().getCount() / 3;
  if (g.simp.applied && tris > g.simp.budget) throw new Error(`${id}: over budget`);
  const m0 = cr.listMaterials()[0];
  const slotOf = t => SLOTS.find(s => ({baseColor: m0.getBaseColorTexture(), metallicRoughness: m0.getMetallicRoughnessTexture(), normal: m0.getNormalTexture()})[s] === t) ?? 'unused';
  const textures = cr.listTextures().map(t => ({slot: slotOf(t), size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  if (dims.some((v, a) => v !== row.nominal[a])) throw new Error(`${id}: written extents ${dims.join(' x ')} != nominal ${row.nominal.join(' x ')}`);
  if (tris > ITEM_BUDGETS[0]) console.log(`${row.id}: NOTE ${tris} triangles > the ${ITEM_BUDGETS[0]} class budget (raised step: ${JSON.stringify(g.simp.raisedFrom ?? null)})`);
  if (g.fit.axisFit.review) console.log(`${row.id}: REVIEW axis factors ${g.fit.axisFit.factors.join(' / ')} (${g.fit.axisFit.review})`);
  itemOut.push({row, id, url, provRel, rec: {...rec, bytes: null, inputBytes: null}, g, glb, dims, min: bb.min.map(r6), max: bb.max.map(r6), tris, vertices: cp.getAttribute('POSITION').getCount(), textures});
  console.log(`${row.id} ${id}: ${rec.bytes.length} B ${g.src.m.I.length / 3} tris -> ${glb.length} B ${tris} tris (${g.simp.applied ? `simplified to the ${g.simp.budget} step, err ${g.simp.errorRelative}` : g.simp.reason}; ${g.charts} UV charts), ` +
    `dims ${dims.join(' x ')} m (${g.fit.measure} ${g.fit.size}${g.fit.axis ? ` on ${g.fit.axis}` : ''}, uniform scale ${g.fit.scale}; axis factors ${g.fit.axisFit.factors.join(' / ')}); maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}

// ---------- ruined props: one shared atlas (lean low-poly + a bake of Meshy's own maps) ----------
// Meshy's UV layouts (200-1000 charts) stall a seam-preserving collapse at 500-1700 triangles and a seam-crossing one smears the
// texture, so the lean parts are re-baked: the dense (raw, fitted) model keeps Meshy's UVs and maps; a position-welded copy is simplified
// by position only (best silhouette) to the leanest budget step within JUNK_TARGET_ERROR, freshly unwrapped (lib/unwrap.mjs box
// projection charts) into the prop's own atlas cell, and Meshy's base colour / metallic-roughness / normal maps are resampled onto it
// (lib/bake.mjs: closest same-facing dense surface; the Meshy normal map folded into the dense normal) — UV baking, not re-authoring.
const parts = [];
for (const row of FOOD_ONLY ? [] : JUNK) { // --food-only: no ruined prop is read, cooked or baked
  const rec = PROD.records(row);
  if (!rec) { skipped.push(row.id); continue; }
  const src = await readSource(row.id, rec);
  checkFactors(row.id, src.material);
  if (src.material.doubleSided !== true) throw new Error(`${row.id}: the shared atlas material is double-sided like every Meshy material; this source is not`);
  const srcB = boundsOf(src.m.P);
  const adj = ADJUST[row.id] ?? {};
  const pre = preAdjust(row.id, src.m, adj);
  const welded = weld(pre.m);
  const {P: Pd, N: Nd, fit} = fitMesh(welded, {...row.fit, stretch: adj.stretch, turn: adj.turn, layFlat: adj.layFlat, settle: adj.settle});
  // low: positional weld -> position-only simplification at the leanest step within the target error
  const key = new Map(), rep = new Uint32Array(Pd.length / 3), Pu = [];
  for (let v = 0; v < Pd.length / 3; v++) { const k = `${Pd[3 * v]},${Pd[3 * v + 1]},${Pd[3 * v + 2]}`; if (!key.has(k)) { key.set(k, key.size); Pu.push(Pd[3 * v], Pd[3 * v + 1], Pd[3 * v + 2]); } rep[v] = key.get(k); }
  const Iu = Uint32Array.from(welded.I, i => rep[i]), PuF = Float32Array.from(Pu);
  await MeshoptSimplifier.ready;
  const steps = JUNK_CAP[row.id] ? [JUNK_CAP[row.id]] : JUNK_STEPS[JUNK_BIG.has(row.id) ? 'big' : 'small'], tried = [];
  let out = null, err = 0, budget = 0;
  for (const t of steps) {
    [out, err] = MeshoptSimplifier.simplify(Iu, PuF, 3, t * 3, 1, []);
    budget = t; tried.push({budget: t, triangles: out.length / 3, errorRelative: r6(err)});
    if (err <= JUNK_TARGET_ERROR) break;
  }
  const map = new Int32Array(PuF.length / 3).fill(-1), lp = [], li = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) { const v = out[i]; if (map[v] < 0) { map[v] = lp.length / 3; lp.push(PuF[3 * v], PuF[3 * v + 1], PuF[3 * v + 2]); } li[i] = map[v]; }
  const lowP = Float32Array.from(lp);
  // the low mesh (a vertex subset of the dense one) loses extreme vertices: it is re-fitted UNIFORMLY so the plan's reference measure is
  // exact on the mesh that ships, grounded / centred; the dense model moves with it so the bake stays aligned
  const refit = measureOf(Pd, row.fit, !!adj.layFlat) / measureOf(lowP, row.fit, !!adj.layFlat);
  for (const A of [lowP, Pd]) for (let i = 0; i < A.length; i++) A[i] *= refit;
  const lb = boundsOf(lowP), t3 = [-(lb.min[0] + lb.max[0]) / 2, -lb.min[1], -(lb.min[2] + lb.max[2]) / 2];
  for (const A of [lowP, Pd]) for (let i = 0; i < A.length; i += 3) for (let k = 0; k < 3; k++) A[i + k] += t3[k];
  const simp = {applied: true, tool: 'meshoptimizer 1.3 simplify, position only, on the position-welded mesh (UVs / normals are re-made by the unwrap + bake)',
    budget, budgetSteps: steps, targetError: JUNK_TARGET_ERROR, tried, fromTriangles: Iu.length / 3, triangles: li.length / 3, errorRelative: r6(err),
    errorM: r6(err * MeshoptSimplifier.getScale(PuF, 3)), ...(JUNK_CAP[row.id] ? {leadCap: JUNK_CAP[row.id], note: `the lead's per-part cap (station triangle budget); silhouette checked visually`} : err > JUNK_TARGET_ERROR ? {note: `no step within the ${JUNK_TARGET_ERROR} target: the class cap ${budget}, checked visually`} : {}),
    refitScale: r6(refit), regroundM: t3.map(r6)};
  let A = 0;
  for (let f = 0; f < li.length; f += 3) {
    const a = 3 * li[f], b = 3 * li[f + 1], c = 3 * li[f + 2];
    const ux = lowP[b] - lowP[a], uy = lowP[b + 1] - lowP[a + 1], uz = lowP[b + 2] - lowP[a + 2], vx = lowP[c] - lowP[a], vy = lowP[c + 1] - lowP[a + 1], vz = lowP[c + 2] - lowP[a + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const probe = unwrap(lowP, li, {atlas: 512, pad: ATLAS.pad});
  const g = {src, extent: [0, 1, 2].map(k => r4(srcB.max[k] - srcB.min[k])), welded, charts: uvCharts(welded), simp, fit: {...fit, scale: r6(fit.scale * refit), lowPolyRefit: r6(refit), translate: 'per node: grounded / centred after the low-poly re-fit'},
    adjust: Object.keys(pre.rec).length ? pre.rec : null, uvRange: null};
  parts.push({row, rec, g, dense: {P: Pd, N: Nd, UV: welded.UV, I: welded.I}, low: {P: lowP, I: li}, surfaceM2: A, chartFill: probe.stats.chartAreaFraction,
    need: Math.sqrt(A / probe.stats.chartAreaFraction)});
  const lb2 = boundsOf(lowP);
  console.log(`${row.id} ${row.slug}: ${rec.bytes.length} B ${src.m.I.length / 3} tris -> ${li.length / 3} tris (position-only at the ${budget} step, err ${r6(err)}${JUNK_CAP[row.id] ? ': lead cap' : err > JUNK_TARGET_ERROR ? ' > target: class cap' : ''}), ` +
    `dims ${[0, 1, 2].map(k => r4(lb2.max[k] - lb2.min[k])).join(' x ')} m (${fit.measure} ${fit.size}${fit.axis ? ` on ${fit.axis}` : ''}), scale ${fit.scale}, surface ${r4(A)} m², chart fill ${r4(probe.stats.chartAreaFraction)}`);
}

/** Skyline bottom-left packing of squares (side px, multiples of the grid) into the atlas; null when they do not fit. */
function skyline(sizes, W) {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  let sky = [{x: 0, w: W, y: 0}];
  const at = new Array(sizes.length);
  for (const i of order) {
    const s = sizes[i];
    let best = null;
    for (let k = 0; k < sky.length; k++) {
      const x = sky[k].x;
      if (x + s > W) break;
      let y = 0;
      for (let j = k; j < sky.length && sky[j].x < x + s; j++) y = Math.max(y, sky[j].y);
      if (y + s > W) continue;
      if (!best || y < best.y || (y === best.y && x < best.x)) best = {x, y};
    }
    if (!best) return null;
    at[i] = best;
    const next = [];
    for (const seg of sky) {
      const a = seg.x, b = seg.x + seg.w;
      if (b <= best.x || a >= best.x + s) { next.push(seg); continue; }
      if (a < best.x) next.push({x: a, w: best.x - a, y: seg.y});
      if (b > best.x + s) next.push({x: best.x + s, w: b - best.x - s, y: seg.y});
    }
    next.push({x: best.x, w: s, y: best.y + s});
    next.sort((p, q) => p.x - q.x);
    sky = [];
    for (const seg of next) { const l = sky[sky.length - 1]; if (l && l.y === seg.y && l.x + l.w === seg.x) l.w += seg.w; else sky.push({...seg}); }
  }
  return at;
}
const cellSizes = k => parts.map(p => Math.min(ATLAS.maxCell, Math.max(ATLAS.minCell, ATLAS.grid * Math.round(k * p.need / ATLAS.grid))));
const rawRGBA = async img => { const {data, info} = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({resolveWithObject: true}); return {data: new Uint8Array(data), width: info.width, height: info.height}; };

let atlasOut = null;
if (parts.length) {
  // the largest uniform texel density (px / m) whose cells pack: binary search on k
  let lo = 0, hi = ATLAS.size / Math.min(...parts.map(p => p.need));
  for (let it = 0; it < 40; it++) { const k = (lo + hi) / 2; if (skyline(cellSizes(k), ATLAS.size)) lo = k; else hi = k; }
  const k = lo, sizes = cellSizes(k), at = skyline(sizes, ATLAS.size);
  if (!at) throw new Error('atlas: no packing');
  const used = sizes.reduce((s, c) => s + c * c, 0) / (ATLAS.size * ATLAS.size);
  const S = ATLAS.size, img = Object.fromEntries(SLOTS.map(slot => { const a = new Uint8Array(S * S * 3); const bg = ATLAS.background[slot]; for (let i = 0; i < S * S; i++) a.set(bg, 3 * i); return [slot, a]; }));
  for (const [i, p] of parts.entries()) {
    const size = sizes[i];
    const un = unwrap(p.low.P, p.low.I, {atlas: size, pad: ATLAS.pad});
    const tex = {};
    for (const slot of SLOTS) tex[slot] = await rawRGBA(p.g.src.textures[slot].getImage());
    const dims = boundsOf(p.low.P);
    const searchRadius = Math.max(0.01, 0.08 * Math.max(...[0, 1, 2].map(q => dims.max[q] - dims.min[q])));
    const baked = await bake({...p.dense, bc: tex.baseColor, mr: tex.metallicRoughness, nm: tex.normal}, {pos: un.pos, nrm: un.nrm, uv: un.uv, idx: un.idx},
      {atlas: size, supersample: BAKE.supersample, mrDiv: 1, normalDiv: 1, searchRadius, workers: BAKE.workers});
    for (const [slot, b] of [['baseColor', baked.color], ['metallicRoughness', baked.mr], ['normal', baked.normal]]) {
      if (b.size !== size) throw new Error(`${p.row.id}: ${slot} bake size ${b.size} != cell ${size}`);
      for (let y = 0; y < size; y++) img[slot].set(b.data.subarray(3 * y * size, 3 * (y + 1) * size), 3 * ((at[i].y + y) * S + at[i].x));
    }
    p.mesh = {P: un.pos, N: un.nrm, I: un.idx, UV: Float32Array.from(un.uv, (v, j) => (j % 2 ? at[i].y + v * size : at[i].x + v * size) / S)};
    const st = baked.stats;
    p.cell = {x: at[i].x, y: at[i].y, size, chartPad: ATLAS.pad, uvRect: [at[i].x / S, at[i].y / S, (at[i].x + size) / S, (at[i].y + size) / S].map(r6),
      texelsPerMetre: r4(un.stats.texelsPerSourceUnit), surfaceM2: r6(p.surfaceM2), chartAreaFraction: r6(un.stats.chartAreaFraction)};
    p.bake = {unwrap: {tool: 'lib/unwrap.mjs (box-projection charts, smoothing-group normals, shelf-packed into the cell)', charts: un.stats.charts, mergedSmallCharts: un.stats.mergedSmallCharts, vertices: un.stats.vertices},
      bake: {tool: "lib/bake.mjs + bake-worker.mjs (closest same-facing dense surface; bilinear Meshy base colour / metallic-roughness; dense normal perturbed by Meshy's normal map, re-encoded in the low-poly tangent frame)",
        supersample: BAKE.supersample, searchRadiusM: r6(searchRadius), samples: st.samples, matchedSameFacing: st.matchedSameFacing, matchedFallbackAnyFacing: st.matchedFallbackAnyFacing, unmatched: st.unmatched,
        projectionDistanceM: Object.fromEntries(Object.entries(st.projectionDistanceSourceUnits).map(([q, v]) => [q, v == null ? null : r6(v)])), uvOverlapInteriorTexels: st.uvOverlapInteriorTexels}};
    console.log(`${p.row.id}: cell ${size} px at ${at[i].x},${at[i].y}; ${un.stats.charts} charts, ${r4(un.stats.texelsPerSourceUnit)} px/m; bake matched ${st.matchedSameFacing} + fallback ${st.matchedFallbackAnyFacing} / unmatched ${st.unmatched}, p90 dist ${r6(st.projectionDistanceSourceUnits.p90 ?? 0)} m`);
  }
  const atlasImages = {};
  for (const slot of SLOTS) {
    const f = slot === 'baseColor' ? 1 : ATLAS.mrNormalDiv, px = S / f, data = f === 1 ? img[slot] : downsample(img[slot], S, f, slot === 'normal');
    atlasImages[slot] = await sharp(Buffer.from(data), {raw: {width: px, height: px, channels: 3}}).jpeg(JPEG[slot]).toBuffer();
  }
  // the document: one material, one mesh node per prop (identity transforms; geometry grounded / centred per node)
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`${ATLAS.id}-${slot}`).setImage(new Uint8Array(atlasImages[slot])).setMimeType('image/jpeg').setURI(`${ATLAS.id}-${slot}.jpg`)]));
  const mat = doc.createMaterial(ATLAS.id).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(true).setAlphaMode('OPAQUE')
    .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(1);
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) info.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
  const scene = doc.createScene(ATLAS.id);
  doc.getRoot().setDefaultScene(scene);
  for (const p of parts) {
    const {P, N, UV, I} = p.mesh;
    const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
    const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', Float32Array.from(P))).setAttribute('NORMAL', acc('VEC3', Float32Array.from(N)))
      .setAttribute('TEXCOORD_0', acc('VEC2', UV)).setIndices(acc('SCALAR', indexArray(I, P.length / 3)));
    scene.addChild(doc.createNode(p.row.id).setMesh(doc.createMesh(p.row.id).addPrimitive(prim)));
  }
  doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  noUrls(ATLAS.id, glb);
  // ---- verify the written bytes: per node grounded / centred, one material, UVs inside the cell
  const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
  if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3 || chk.listNodes().length !== parts.length) throw new Error('atlas: not one material / three maps / one node per prop');
  for (const p of parts) {
    const node = chk.listNodes().find(n => n.getName() === p.row.id);
    const prims = node?.getMesh()?.listPrimitives() ?? [];
    if (!node || prims.length !== 1 || prims[0].getMaterial() !== chk.listMaterials()[0]) throw new Error(`${p.row.id}: missing node / not on the shared material`);
    if (node.getMatrix().some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-12)) throw new Error(`${p.row.id}: non-identity node`);
    const P = prims[0].getAttribute('POSITION').getArray(), U = prims[0].getAttribute('TEXCOORD_0').getArray(), b = boundsOf(P);
    if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 || Math.abs(b.min[2] + b.max[2]) > 1e-3) throw new Error(`${p.row.id}: not grounded / centred`);
    for (let i = 0; i < U.length; i += 2) if (U[i] < p.cell.uvRect[0] - 1e-6 || U[i] > p.cell.uvRect[2] + 1e-6 || U[i + 1] < p.cell.uvRect[1] - 1e-6 || U[i + 1] > p.cell.uvRect[3] + 1e-6) throw new Error(`${p.row.id}: UV outside its cell`);
    p.tris = prims[0].getIndices().getCount() / 3; p.vertices = P.length / 3;
    p.dims = [0, 1, 2].map(k => r4(b.max[k] - b.min[k])); p.min = b.min.map(r6); p.max = b.max.map(r6);
    if (p.tris > p.g.simp.budget) throw new Error(`${p.row.id}: over budget`);
  }
  const textures = chk.listTextures().map((t, i) => ({slot: SLOTS[i], size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  atlasOut = {glb, textures, k: r4(k), used: r4(used), provRel: 'assets/derivatives/food-shelf-junk-atlas.json'};
  console.log(`${ATLAS.id}: ${parts.length} props, ${glb.length} B, ${parts.reduce((s, p) => s + p.tris, 0)} tris; atlas ${ATLAS.size} px, k ${r4(k)}, cells use ${(used * 100).toFixed(1)} %; maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}
if (skipped.length) console.log(`not accepted yet (skipped, left out of the registry): ${skipped.join(' ')}`);

// ---------- provenance ----------
const lineOf = l => { const {seq: _s, type: _t, ...rest} = l; return rest; };
function sourceProv(row, rec, g) {
  const a = rec.approvedAsset, tk = rec.task;
  return {
    asset: row.id, name: a.name, class: a.class,
    approvedConcept: {sha256: a.sourceImageSha256, file: `${path.relative(root, a.workerApprovedOriginal).split(path.sep).join('/')} (approved concept original, outside Git)`},
    conditioningImage: {sha256: rec.reserve.inputSha256, bytes: rec.reserve.inputBytes, file: `${tk.relT(rec.reserve.input)} (outside Git)`,
      codex: rec.codex ?? 'no matching Codex result line found in the lane record'},
    meshy: {tool: rec.reserve.tool, request: (({file_path: _f, ...rest}) => rest)(rec.reserve.params), task: rec.taskId, reservation: rec.res, lane: rec.lane,
      status: rec.settle.status, billedCredits: rec.settle.billed, attemptsForAsset: rec.attemptsForAsset, acceptNote: rec.accept.note || null,
      ledger: {file: `${tk.dir}/gen/LEDGER.jsonl (outside Git)`, lines: rec.lines, accept: lineOf(rec.accept)}},
    source: {file: `${tk.relT(rec.raw.file)} (raw original, read-only, outside Git; never shipped)`, sha256: rec.raw.sha256, bytes: rec.raw.bytes,
      triangles: g.src.m.I.length / 3, vertices: g.src.m.P.length / 3, extent: g.extent, uvRange: g.uvRange, uvCharts: g.charts, material: g.src.material, maps: g.src.maps,
      droppedAttributes: g.src.extraSemantics},
    rawAdjustments: g.adjust, fit: g.fit, weld: g.welded.weld, simplify: g.simp,
  };
}
const written = new Map();
const guard = (id, buf) => { const hit = buf.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=).{0,20}/i); if (hit) throw new Error(`${id}: URL / token-like string in public provenance: ...${hit[0]}...`); return buf; };
for (const o of itemOut) {
  const a = FOOD.approved.get(o.row.id), prev = PROD.previous(o.row);
  const prov = {
    schema: 'terminal-state-derivative-v1', id: o.id, itemId: o.row.slug, asset: o.row.id,
    role: `collectible ${a.class === 'collectible_drink' ? 'drink' : 'food'} pickup model: ${a.name} (brand-new, factory-fresh product)`,
    task: `${FOOD.task} (lane COOK; fresh models generated by the art lanes through the task's single broker / ledger)`, approval: FOOD.approval, accepted: true, route: FOOD.route,
    ...sourceProv(o.row, o.rec, o.g),
    replaces: prev ? {...prev, url: o.url, note: 'the previous (weathered) production model of this item at the same path; same item id, url and nominal w / h / d'} : null,
    output: {url: o.url, file: `game/public/${o.url}`, bytes: o.glb.length, sha256: sha(o.glb), triangles: o.tris, vertices: o.vertices, dims: o.dims, min: o.min, max: o.max},
    textures: o.textures,
    texturePolicy: `Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal), lanczos3 downsize to ${itemTex(o.row.id).join(' / ')} px, JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4 (no recolour, tint, brightening or re-texture)`,
    ...(ITEM_TEX_LABEL[o.row.id] ? {textureException: {mapsPx: ITEM_TEX_LABEL[o.row.id], classMapsPx: ITEM_TEX, reason: ITEM_TEX_LABEL_WHY}} : {}),
    convention: `metres at real size, +Y up; ${o.g.fit.rotation === 'none (Meshy native front +Z, +Y up kept)' ? 'Meshy native frame (front +Z = the straight-on elevation the model was conditioned on)' : `final resting pose: ${o.g.fit.rotation} (see fit)`}; grounded (min y = 0), centred on x / z; one node / mesh / primitive / material, identity node (transform baked into the vertices); w / h / d = the resting-pose extents = the item's exact nominal extents (fit.axisFit)`,
    licence: FOOD.licence, rebuild: `node ${SELF} --food-only [--reference <dir holding tasks/fresh-food-redo-20261109-040427 + tasks/food-shelf-production-20261109-002816>]`,
  };
  written.set(o.url, o.glb);
  written.set(o.provRel, guard(o.id, Buffer.from(JSON.stringify(prov, null, 1) + '\n')));
}
if (atlasOut) {
  const prov = {
    schema: 'terminal-state-derivative-v1', id: ATLAS.id, role: 'non-collectible ruined shelf props (physics filler): one GLB, one mesh node per prop id on ONE shared material with one atlas per PBR slot (base colour 2048 px, metallic-roughness / normal 1024 px)',
    task: `${PROD.task} (lane COOK; models generated by the asset lanes through the task's single broker / ledger)`, approval: PROD.approval, accepted: true, route: PROD.route,
    output: {url: ATLAS.url, file: `game/public/${ATLAS.url}`, bytes: atlasOut.glb.length, sha256: sha(atlasOut.glb), nodes: parts.map(p => p.row.id), triangles: parts.reduce((s, p) => s + p.tris, 0)},
    textures: atlasOut.textures,
    atlas: {size: ATLAS.size, grid: ATLAS.grid, chartPad: ATLAS.pad, cellRule: 'square cell per prop, side = k * sqrt(low-poly surface area m² / unwrap chart fill), rounded to the grid, clamped to ' +
      `${ATLAS.minCell}..${ATLAS.maxCell} px; skyline bottom-left packing (largest first); k = the largest uniform density that packs (binary search)`, k: atlasOut.k, cellsUse: atlasOut.used,
      fill: "each prop's low-poly is unwrapped into its own cell (charts padded inside the cell) and baked from its dense Meshy model at 2x supersampling; dilated chart gutters, the rest of the cell = the prop's mean colour; unused atlas area = neutral grey / rough non-metal / flat normal",
      background: ATLAS.background},
    method: "lean low-poly + bake: Meshy's UV layouts (200-1000 charts) stall a seam-preserving collapse at 500-1700 triangles and a seam-crossing collapse smears the texture (both tried and rejected on sight), so each part is simplified by position only, freshly unwrapped and baked from its dense Meshy model (UV baking = processing; Meshy's own base colour / metallic-roughness / normal maps are the only texture source)",
    texturePolicy: "Meshy's own maps resampled slot for slot (base colour / metallic-roughness bilinear; the Meshy normal map folded into the baked tangent-space normal) into one atlas per slot at a uniform texel density: base colour 2048 px, metallic-roughness and normal 1024 px (the same cells; an exact 2 x 2 box downsample of the 2048 bake, normals renormalised; lead: texture memory), JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4; Meshy material factors all 1 (checked), so one shared material is exact",
    convention: 'metres at real size, +Y up; Meshy native frame (front +Z = the straight-on elevation each model was conditioned on); every node an identity transform, its geometry grounded (min y = 0) and centred on x / z at the node origin (the nodes overlap at the origin by design; use one node per prop instance)',
    parts: Object.fromEntries(parts.map(p => [p.row.id, {slug: p.row.slug, node: p.row.id, ...sourceProv(p.row, p.rec, p.g),
      output: {node: p.row.id, triangles: p.tris, vertices: p.vertices, dims: p.dims, min: p.min, max: p.max},
      cell: p.cell, ...p.bake}])),
    licence: PROD.licence, rebuild: `node ${SELF} [--reference <dir holding tasks/food-shelf-production-20261109-002816>]`,
  };
  written.set(ATLAS.url, atlasOut.glb);
  written.set(atlasOut.provRel, guard(ATLAS.id, Buffer.from(JSON.stringify(prov, null, 1) + '\n')));
}

// ---------- registry ----------
// FOOD_ITEM_MODELS (+ the header) always comes from this run; SHELF_JUNK_ATLAS (from JUNK_MARK to the end) is this run's bake, or with
// --food-only the CURRENT file's section, byte for byte.
const JUNK_MARK = 'export interface ShelfJunkPart';
const regNow = fs.existsSync(REG) ? fs.readFileSync(REG, 'utf8') : '';
const junkNow = regNow.includes(JUNK_MARK) ? regNow.slice(regNow.indexOf(JUNK_MARK)) : null;
if (FOOD_ONLY) {
  if (!junkNow) throw new Error(`--food-only: ${path.relative(root, REG)} has no SHELF_JUNK_ATLAS section to keep`);
  // the item dims are fixed: the current registry must already list every item at exactly this id / url / nominal w / h / d
  for (const r of ITEMS) {
    const m = regNow.match(new RegExp(`^  ${r.slug}: \\{id: '(\\w+)', url: '([^']+)', w: ([\\d.]+), h: ([\\d.]+), d: ([\\d.]+), tris: \\d+\\},$`, 'm'));
    if (!m || m[1] !== r.id || m[2] !== `assets/models/food-${dashed(r.slug)}.glb` || [m[3], m[4], m[5]].some((v, a) => +v !== r.nominal[a])) throw new Error(`--food-only: the current registry entry of ${r.slug} != id ${r.id} / its url / nominal ${r.nominal.join(' x ')}`);
  }
}
const ids = (k, list) => list.filter(r => ADJUST[r.id]?.[k]).map(r => r.id);
const poseIds = k => [...ids(k, ITEMS), ...ids(k, JUNK)];
const poses = [[poseIds('layFlat'), 'lie flat (label / front up)', 'lies flat (label / front up)'], [poseIds('turn'), 'are turned so their clean labels face +Z', 'is turned so its clean label faces +Z'],
  [poseIds('standUp'), 'are stood up (labels Meshy built facing up turned to +Z)', 'is stood up (the label Meshy built facing up turned to +Z)'],
  [poseIds('settle'), 'rest rolled onto stable supports', 'rests rolled onto stable supports']].filter(([l]) => l.length).map(([l, many, one]) => `${l.join(' / ')} ${l.length > 1 ? many : one}`);
const wrap = (text, w = 136) => text.split(' ').reduce((ls, word) => { const l = ls[ls.length - 1]; if (l.length && (l + ' ' + word).length > w) ls.push(word); else ls[ls.length - 1] = l.length ? `${l} ${word}` : word; return ls; }, ['']).map(l => `// ${l}`).join('\n');
const registryHead = `// GENERATED by ${SELF} — do not edit.
${wrap(`FOOD_ITEM_MODELS: task ${FOOD.task} (the 24 food / drink pickups redone as brand-new, factory-fresh products: fresh Meshy models cooked to the items' exact nominal extents); SHELF_JUNK_ATLAS: task ${PROD.task}.`)}
// The food / drink pickups' runtime models (FOOD_ITEM_MODELS, keyed by ItemDef id) and the non-collectible ruined shelf props' shared atlas
// (SHELF_JUNK_ATLAS, one mesh node per prop id P01..P27 on ONE material). Three-free. Meshy T2.5 models (Codex initial conditioning image ->
// Meshy image-to-3D): the collectibles keep Meshy's own PBR maps (downsized); the ruined props are lean low-poly parts baked from their Meshy
// models (Meshy's maps resampled into one shared atlas: base colour 2048 px, metallic-roughness / normal 1024 px). Provenance in
// assets/derivatives/food-shelf-*.json.
${wrap(`Metres at real size, +Y up, grounded (min y = 0), centred on x / z (atlas: per node, identity node transforms). w / h / d = the measured RESTING-POSE extents (x / y / z): most models stand upright facing +Z; ${poses.join(', ')} (see each provenance fit).`)}
// id = the approved asset id; tris = triangles. Only accepted models are listed.

export interface FoodShelfModel { id: string; url: string; w: number; h: number; d: number; tris: number }
export const FOOD_ITEM_MODELS: Readonly<Record<string, FoodShelfModel>> = {
${itemOut.map(o => `  ${o.row.slug}: {id: '${o.row.id}', url: '${o.url}', w: ${o.dims[0]}, h: ${o.dims[1]}, d: ${o.dims[2]}, tris: ${o.tris}},`).join('\n')}
};

`;
const registryJunk = FOOD_ONLY ? junkNow : `${JUNK_MARK} { id: string; slug: string; node: string; w: number; h: number; d: number; tris: number }
export const SHELF_JUNK_ATLAS: {url: string; parts: Readonly<Record<string, ShelfJunkPart>>} = {url: '${ATLAS.url}', parts: {
${parts.map(p => `  ${p.row.id}: {id: '${p.row.id}', slug: '${p.row.slug}', node: '${p.row.id}', w: ${p.dims[0]}, h: ${p.dims[1]}, d: ${p.dims[2]}, tris: ${p.tris}},`).join('\n')}
}};
`;
const registry = registryHead + registryJunk;

if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, buf] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), buf);
  fs.writeFileSync(path.join(DRY, 'foodShelfModels.generated.ts'), registry);
  console.log(`dry run${FOOD_ONLY ? ' (--food-only)' : ''}: ${written.size} files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + registry preview written to ${DRY}${skipped.length ? `; partial: ${skipped.join(' ')} not accepted yet` : ''}`);
  process.exit(0);
}

// the real write: every collectible is cooked (the registry never drops an item)
const missing = ITEMS.filter(r => !itemOut.some(o => o.row.id === r.id)).map(r => r.id);
if (missing.length) throw new Error(`refusing the real write: ${missing.join(' ')} not accepted yet (dry-run a partial set instead); nothing written`);
const ATLAS_FILES = [ATLAS.url, 'assets/derivatives/food-shelf-junk-atlas.json'];
const foodPaths = new Set(ITEMS.flatMap(r => [`assets/models/food-${dashed(r.slug)}.glb`, `assets/derivatives/food-shelf-${dashed(r.slug)}-model.json`]));
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
// --food-only: what must stay byte-identical (the atlas files, the registry's SHELF_JUNK_ATLAS section, every non-food allowlist entry)
const untouched = () => {
  const al = JSON.parse(fs.readFileSync(ALLOW, 'utf8')), reg = fs.readFileSync(REG, 'utf8');
  return JSON.stringify({atlas: ATLAS_FILES.map(f => sha(fs.readFileSync(path.join(PUB, f)))), junk: sha(reg.slice(reg.indexOf(JUNK_MARK))), allow: al.files.filter(f => !foodPaths.has(f.path))});
};
const before = FOOD_ONLY ? untouched() : null;
if (FOOD_ONLY && ([...written.keys()].some(p => !foodPaths.has(p)) || written.size !== foodPaths.size)) throw new Error('--food-only: the write set is not exactly the 48 collectible files');
for (const [rel, buf] of written) fs.writeFileSync(path.join(PUB, rel), buf);
fs.writeFileSync(REG, registry);
const ownPaths = new Set([...foodPaths, ...(FOOD_ONLY ? [] : ATLAS_FILES)]);
allow.files = [...allow.files.filter(f => !ownPaths.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
if (FOOD_ONLY && untouched() !== before) throw new Error('--food-only: an atlas file, the SHELF_JUNK_ATLAS section or a non-food allowlist entry changed');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json${FOOD_ONLY ? ' (--food-only: atlas, SHELF_JUNK_ATLAS and non-food allowlist entries verified byte-identical)' : ''}`);
